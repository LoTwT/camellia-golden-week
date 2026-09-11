import assert from "node:assert/strict";
import test from "node:test";
import { assembleContent, realtimeContent } from "../src/content/assemble.ts";
import type { WorldWitness } from "../src/content/validate.ts";
import { worldWitnesses } from "../src/content/witnesses/index.ts";
import { createGame, dispatch } from "../src/core/engine.ts";
import type { RealtimeInput, RealtimeWitness } from "../src/core/realtime.ts";
import type { GameCommand, GameSettings, GameState, RuleResult } from "../src/core/types.ts";

const content = assembleContent("M5");
const challengeIds = [
  "a.firewall.tutorial",
  "a.firewall.inner",
  "a.firewall.deep",
  "a.firewall.core",
  "b.antivirus.light",
  "b.antivirus.medium",
  "b.antivirus.heavy",
] as const;
const settingVariants: readonly { label: string; changes: Partial<GameSettings> }[] = [
  { label: "静音", changes: { muted: true } },
  { label: "音量0但未静音", changes: { masterVolume: 0 } },
  { label: "音量1", changes: { masterVolume: 1 } },
  { label: "减少闪烁", changes: { reducedFlash: true } },
  { label: "减少动态", changes: { reducedMotion: true } },
  { label: "低画质", changes: { quality: "low" } },
  {
    label: "全部组合",
    changes: {
      masterVolume: 0.2,
      muted: true,
      reducedFlash: true,
      reducedMotion: true,
      quality: "low",
    },
  },
];

interface ChallengeEntrance {
  readonly state: GameState;
  readonly startAtMs: number;
}

function reachChallengeEntrances(): Map<string, ChallengeEntrance> {
  const worldWitness = (worldWitnesses as WorldWitness[]).find(
    (candidate) => candidate.id === "m4.world.full-collection-and-return",
  );
  assert.ok(worldWitness);
  const entrances = new Map<string, ChallengeEntrance>();
  let state = createGame(content, 0);
  // Replay the existing route against M5; never manufacture terminal access or progress.
  for (const step of worldWitness.steps) {
    const command = step.command;
    if (
      command.kind === "StartChallenge" &&
      challengeIds.some((id) => id === command.challengeId) &&
      !entrances.has(command.challengeId)
    ) {
      assert.equal(state.releaseProfileId, "M5");
      assert.equal(state.mode, "challengeReady");
      assert.equal(state.completedObjectiveIds.includes(command.challengeId), false);
      entrances.set(command.challengeId, { state: structuredClone(state), startAtMs: step.atMs });
      if (entrances.size === challengeIds.length) break;
    }
    const result = dispatch(content, state, command, step.atMs);
    assert.equal(result.code, step.expectedCode, `${worldWitness.id} @ ${step.atMs}`);
    state = result.state;
  }
  assert.equal(entrances.size, challengeIds.length);
  return entrances;
}

const entrances = reachChallengeEntrances();

function gameCommand(input: RealtimeInput): GameCommand {
  if (input.kind === "move") {
    assert.notEqual(input.repeat, true);
    return { kind: "Move", direction: input.direction };
  }
  if (input.kind === "click") return { kind: "ClickTile", tileId: input.tileId };
  return { kind: "Interact" };
}

function compareSettingsReplay(
  entrance: ChallengeEntrance,
  witness: RealtimeWitness,
  variant: (typeof settingVariants)[number],
): void {
  let baseline = structuredClone(entrance.state);
  let changed = structuredClone(entrance.state);
  let now = baseline.clock.lastMonotonicTimeMs;
  const defaultSettings = { ...baseline.settings };
  const variantSettings = { ...defaultSettings, ...variant.changes };
  const label = `${witness.id} / ${variant.label}`;
  assert.notDeepEqual(variantSettings, defaultSettings, label);
  const settlementEvents: string[] = [];

  function sendPair(command: GameCommand, changedCommand = command): RuleResult {
    const expected = dispatch(content, baseline, command, now);
    const actual = dispatch(content, changed, changedCommand, now);
    // Both sides receive the same Settings calls, so even revision/event counters must agree.
    assert.deepEqual(
      { ...actual, state: { ...actual.state, settings: null } },
      { ...expected, state: { ...expected.state, settings: null } },
      `${label}: ${command.kind} @ ${now}`,
    );
    baseline = expected.state;
    changed = actual.state;
    for (const event of actual.events)
      if (event.kind === "success" || event.kind === "failure") settlementEvents.push(event.kind);
    assert.deepEqual(actual.state.clock.pauseReasons, [], label);
    return actual;
  }

  function applySettings(settings: GameSettings): void {
    const result = sendPair(
      { kind: "Settings", settings: defaultSettings },
      { kind: "Settings", settings },
    );
    assert.equal(result.code, "accepted", label);
    assert.equal(result.stable, true, label);
    assert.deepEqual(baseline.settings, defaultSettings, label);
    assert.deepEqual(changed.settings, settings, label);
  }

  function advanceTo(targetMs: number): void {
    assert.ok(targetMs >= now, label);
    while (now < targetMs) {
      now += Math.min(100, targetMs - now);
      sendPair({ kind: "Tick" });
    }
  }

  applySettings(variantSettings);
  now = entrance.startAtMs;
  assert.equal(
    sendPair({ kind: "StartChallenge", challengeId: witness.challengeId }).code,
    "accepted",
  );
  assert.equal(changed.activeRealtime?.practice, false, label);
  const activeOriginMs = now + 3000;
  advanceTo(activeOriginMs);
  assert.equal(changed.clock.activeTimeMs, 0, label);
  assert.equal(changed.clock.countdownRemainingMs, 0, label);

  type ScheduledStep =
    | { kind: "input"; atMs: number; input: RealtimeInput }
    | { kind: "settings"; atMs: number; settings: GameSettings };
  const steps: ScheduledStep[] = [
    { kind: "settings", atMs: witness.finishAtMs / 3, settings: defaultSettings },
    { kind: "settings", atMs: (witness.finishAtMs * 2) / 3, settings: variantSettings },
    { kind: "settings", atMs: witness.finishAtMs - 1, settings: defaultSettings },
    ...witness.commands.map((input): ScheduledStep => ({
      kind: "input",
      atMs: input.activeTimeMs,
      input,
    })),
  ];
  steps.sort((left, right) => left.atMs - right.atMs);
  for (const step of steps) {
    advanceTo(activeOriginMs + step.atMs);
    assert.equal(changed.mode, "challengeRunning", label);
    assert.equal(changed.clock.activeTimeMs, step.atMs, label);
    if (step.kind === "settings") applySettings(step.settings);
    else sendPair(gameCommand(step.input));
  }
  advanceTo(activeOriginMs + witness.finishAtMs);

  assert.equal(changed.mode, "challengeResult", label);
  assert.equal(changed.phase, witness.expectedResult, label);
  assert.equal(changed.clock.activeTimeMs, witness.finishAtMs, label);
  assert.deepEqual(settlementEvents, [witness.expectedResult], label);
  assert.deepEqual(changed.claimedRewardIds, entrance.state.claimedRewardIds, label);
  assert.equal(
    changed.completedObjectiveIds.includes(witness.challengeId),
    witness.expectedResult === "success",
    label,
  );
  const realtime = changed.activeRealtime?.state;
  const best = changed.bestResults.find((result) => result.challengeId === witness.challengeId);
  assert.ok(realtime && best, label);
  assert.equal(realtime.playerTileId, witness.expectedFinalState.playerTileId, label);
  if (realtime.kind === "firewall") {
    assert.equal(realtime.bestCombo, witness.expectedFinalState.bestCombo, label);
    assert.equal(best.bestCombo, witness.expectedFinalState.bestCombo, label);
  } else {
    assert.equal(realtime.kind, "antivirus", label);
    assert.ok(realtime.kind === "antivirus");
    assert.equal(realtime.score, witness.expectedFinalState.score, label);
    assert.equal(best.bestScore, witness.expectedFinalState.score, label);
  }
}

// This covers authoritative Settings wiring; rendered beat/target legibility still needs a browser.
for (const challengeId of challengeIds) {
  for (const outcome of ["success", "failure"] as const) {
    test(`T08 ${challengeId} ${outcome}：7种设置经公开命令切换后，时钟/分数/反馈/永久结果一致`, () => {
      const entrance = entrances.get(challengeId);
      const witness = (realtimeContent.witnesses as RealtimeWitness[]).find(
        (candidate) => candidate.id === `${challengeId}.witness.${outcome}`,
      );
      assert.ok(entrance && witness);
      for (const variant of settingVariants) compareSettingsReplay(entrance, witness, variant);
    });
  }
}
