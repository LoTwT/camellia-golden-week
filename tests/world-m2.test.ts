// These tests replay the original v1 recordings/exports against their published content view.
import assert from "node:assert/strict";
import test from "node:test";
import {
  assembleLegacyContent as assembleContent,
  staticContent,
} from "../src/content/assemble.ts";
import {
  replayWorldWitness,
  validateContent,
  validateWorldWitness,
} from "../src/content/validate.ts";
import type { WorldWitness, WorldWitnessExpectation } from "../src/content/validate.ts";
import { createGame, dispatch, tileCleared } from "../src/core/engine.ts";
import { areaData, currentObjective, gateOpen, supplyProgress } from "../src/core/progress.ts";
import type { GameCommand, GameState } from "../src/core/types.ts";
import { restorePayload, stablePayload, validatePayload } from "../src/platform/save-payload.ts";
import { additiveProfileMigrations } from "../src/platform/migrations.ts";
import m1Json from "../src/content/witnesses/m1.json" with { type: "json" };
import m2Json from "../src/content/witnesses/m2.json" with { type: "json" };

interface Continuation extends WorldWitness {
  readonly initialStateId: string;
  readonly initialProfileId: "M1";
  readonly initialization: "stable-payload-migration";
  readonly expectedBData: number;
}

const content = assembleContent("M2");
const m1Content = assembleContent("M1");
const migrationRegistry = additiveProfileMigrations([m1Content, content]);
const witnesses = m2Json.witnesses as WorldWitness[];
const mainWitness = witnesses.find((witness) => witness.id === "m2.world.main-path")!;
const fullWitness = witnesses.find(
  (witness) => witness.id === "m2.world.full-collection-and-return",
)!;
const main = replayWorldWitness(content, mainWitness);
const full = replayWorldWitness(content, fullWitness);
const continuations = m2Json.continuations as Continuation[];

class Session {
  state: GameState;
  now: number;

  constructor(state: GameState, now: number) {
    this.state = state;
    this.now = now;
  }

  send(command: GameCommand, expectedCode = "accepted", delta = 140) {
    this.now += delta;
    const result = dispatch(content, this.state, command, this.now);
    assert.equal(result.code, expectedCode, `${command.kind}: ${result.state.lastResult.message}`);
    this.state = result.state;
    return result;
  }

  wait(milliseconds: number): void {
    for (let remaining = milliseconds; remaining > 0;) {
      const delta = Math.min(250, remaining);
      remaining -= delta;
      this.send({ kind: "Tick" }, "accepted", delta);
    }
  }
}

function firstState(predicate: (state: GameState) => boolean, witness = fullWitness): Session {
  let state = createGame(content, 0);
  for (const step of witness.steps) {
    state = dispatch(content, state, step.command, step.atMs).state;
    if (predicate(state)) return new Session(state, step.atMs);
  }
  throw new Error("固定见证未到达所需状态");
}

function matchesExpectation(state: GameState, expected: WorldWitnessExpectation): void {
  assert.equal(state.playerPosition.areaId, expected.areaId);
  assert.equal(state.playerPosition.tileId, expected.tileId);
  assert.equal(state.mode, expected.mode);
  for (const id of expected.completedObjectiveIds)
    assert.ok(state.completedObjectiveIds.includes(id), id);
  for (const id of expected.absentObjectiveIds)
    assert.ok(!state.completedObjectiveIds.includes(id), id);
  assert.deepEqual(new Set(state.claimedRewardIds), new Set(expected.claimedRewardIds));
  assert.equal(supplyProgress(content, state).collected, expected.supplyUnits);
  assert.equal(areaData(content, state, "a").collected, expected.aData);
}

test("M2 已加载 B 固定地图、房间 / 效应 / 来源和 51 单位账本闭合", () => {
  assert.deepEqual(validateContent(content), []);
  assert.equal(content.tiles.filter((tile) => tile.boardId === "b").length, 44);
  assert.equal(content.rooms.filter((room) => room.areaId === "b").length, 5);
  assert.equal(content.profile.includedRewardIds.length, 11);
  assert.equal(
    content.rewards.reduce((sum, reward) => sum + reward.units, 0),
    51,
  );
  assert.equal(
    content.tiles.some((tile) => tile.id.includes("revisit")),
    false,
  );
  assert.equal(
    content.entities.some((entity) => entity.id === "b.to.c"),
    false,
  );
  assert.equal(
    content.entities.find((entity) => entity.id === "b.to.c.unavailable")?.kind,
    "unavailable",
  );
});

test("G02/G03/G10：新档 A/B 各仅20数据即可到 M2 主终点，杀毒未玩", () => {
  assert.deepEqual(main.issues, []);
  assert.equal(main.commandCount, 78);
  assert.equal(areaData(content, main.state, "a").collected, 20);
  assert.equal(areaData(content, main.state, "b").collected, 20);
  assert.equal(gateOpen(content, main.state, "gate.b.main"), true);
  assert.equal(main.state.bestResults.length, 0);
  assert.equal(supplyProgress(content, main.state).collected, 11);
  assert.deepEqual(main.state.scopeCompletionHistory, ["M2"]);
  assert.equal(main.state.campaignCompletedAt, null);
  assert.match(currentObjective(content, main.state), /本版本主路径完成/);
  assert.equal(main.checkpoints["unreleased-c-boundary"]?.playerPosition.tileId, "b.t.8.0");
});

test("G03：一笔画01和捷径按钮前无法沿回环或主终端门绕过", () => {
  const beforeLine = firstState((state) => state.playerPosition.tileId === "b.t.1.1", mainWitness);
  const noLine = beforeLine.send({ kind: "Move", direction: "right" }, "unmetCondition");
  assert.equal(noLine.stable, false);
  assert.equal(noLine.state.playerPosition.tileId, "b.t.1.1");
  assert.equal(noLine.state.completedObjectiveIds.includes("b.line.01"), false);
  const beforeButton = firstState(
    (state) => state.playerPosition.tileId === "b.t.5.0",
    mainWitness,
  );
  assert.equal(beforeButton.state.completedObjectiveIds.includes("b.line.01"), true);
  beforeButton.send({ kind: "Move", direction: "right" }, "unmetCondition");
  beforeButton.send({ kind: "Interact" });
  assert.equal(gateOpen(content, beforeButton.state, "gate.b.switch.shortcut"), true);
  beforeButton.send({ kind: "Move", direction: "right" });
  assert.equal(beforeButton.state.playerPosition.tileId, "b.t.6.0");
  assert.equal(main.checkpoints["shortcut-return-to-entry"]?.playerPosition.tileId, "b.t.0.0");
});

test("I05：B 北侧增幅只清指定覆盖，20数据必须走到末端 F 取得", () => {
  const session = firstState((state) => state.playerPosition.tileId === "b.t.-2.0");
  assert.equal(tileCleared(content, session.state, "b.t.-2.-1"), false);
  session.send({ kind: "Move", direction: "up" }, "blocked");
  assert.equal(areaData(content, session.state, "b").collected, 40);
  session.send({ kind: "Amplify" });
  assert.equal(tileCleared(content, session.state, "b.t.-2.-1"), true);
  assert.equal(areaData(content, session.state, "b").collected, 40);
  assert.equal(session.state.completedObjectiveIds.includes("b.north.terminal"), false);
  session.send({ kind: "Move", direction: "up" });
  session.send({ kind: "Move", direction: "up" });
  session.send({ kind: "Interact" });
  assert.equal(areaData(content, session.state, "b").collected, 60);
});

test("G09/G10：新档全收集与往返练习后累计11个奖励ID、51物资和A/B各80数据", () => {
  assert.deepEqual(full.issues, []);
  assert.equal(full.commandCount, 2480);
  assert.equal(full.pickupEventCount, 11);
  assert.deepEqual(
    new Set(full.state.claimedRewardIds),
    new Set(content.profile.includedRewardIds),
  );
  assert.deepEqual(
    new Set(full.state.completedObjectiveIds),
    new Set(content.profile.includedObjectiveIds),
  );
  assert.equal(supplyProgress(content, full.state).collected, 51);
  for (const areaId of ["a", "b"] as const) {
    assert.equal(areaData(content, full.state, areaId).collected, 80);
    assert.equal(areaData(content, full.state, areaId).includedTotal, 80);
    assert.equal(areaData(content, full.state, areaId).complete, false);
  }
  assert.equal(full.state.campaignCompletedAt, null);
  assert.deepEqual(full.state.scopeCompletionHistory, ["M2"]);
});

test("G09/T14：重度先成功并领取，不依赖轻中档；三个奖励均为门后独立拾取", () => {
  const heavy = full.checkpoints["heavy-before-light-and-medium"]!;
  assert.ok(heavy.completedObjectiveIds.includes("b.antivirus.heavy"));
  assert.equal(heavy.completedObjectiveIds.includes("b.antivirus.light"), false);
  assert.equal(heavy.completedObjectiveIds.includes("b.antivirus.medium"), false);
  assert.equal(gateOpen(content, heavy, "gate.b.antivirus.heavy"), true);
  assert.equal(gateOpen(content, heavy, "gate.b.antivirus.medium"), false);
  assert.equal(gateOpen(content, heavy, "gate.b.antivirus.light"), false);
  assert.equal(heavy.playerPosition.tileId, "b.t.-6.4");
  assert.equal(supplyProgress(content, heavy).collected, 41);
  const settled = firstState(
    (state) => state.activeRealtime?.roomId === "b.antivirus.heavy" && state.phase === "success",
  );
  assert.equal(settled.state.claimedRewardIds.includes("b.supply.antivirus.heavy"), false);
  assert.equal(areaData(content, settled.state, "b").collected, 80);
  for (const tier of ["light", "medium", "heavy"] as const) {
    const score = full.state.bestResults.find(
      (result) => result.challengeId === `b.antivirus.${tier}`,
    )?.bestScore;
    assert.ok(score !== undefined && score >= { light: 40, medium: 60, heavy: 80 }[tier]);
  }
});

test("T14：完整世界见证的三档杀毒点击都在固定目标出现至少150ms后执行", () => {
  let state = createGame(content, 0);
  const counts: Record<string, number> = {};
  for (const step of fullWitness.steps) {
    state = dispatch(content, state, step.command, step.atMs).state;
    if (step.command.kind !== "ClickTile" || state.activeRealtime?.state.kind !== "antivirus")
      continue;
    const definition = content.realtimeChallenges.find(
      (candidate) => candidate.id === state.activeRealtime?.roomId,
    );
    assert.ok(definition?.kind === "antivirus");
    const tileId = step.command.tileId;
    const target = definition.rules.spawns.find(
      (spawn) =>
        spawn.tileId === tileId &&
        spawn.spawnAtMs <= state.clock.activeTimeMs &&
        spawn.expiresAtMs > state.clock.activeTimeMs,
    );
    assert.ok(target);
    assert.ok(state.clock.activeTimeMs - target.spawnAtMs >= 150);
    counts[definition.id] = (counts[definition.id] ?? 0) + 1;
  }
  assert.deepEqual(counts, {
    "b.antivirus.heavy": 127,
    "b.antivirus.medium": 89,
    "b.antivirus.light": 64,
  });
});

test("S03：B实际入口的一笔画提前终点/重复步不提交，Z与重置精确恢复", () => {
  const session = firstState((state) => state.activeStatic?.roomId === "b.line.01", mainWitness);
  session.send({ kind: "Move", direction: "right" });
  session.send({ kind: "Move", direction: "right" });
  const before = structuredClone(session.state.activeStatic?.state);
  session.send({ kind: "Move", direction: "right" }, "endTooEarly");
  session.send({ kind: "Move", direction: "left" }, "alreadyVisited");
  assert.deepEqual(session.state.activeStatic?.state, before);
  session.send({ kind: "Undo" }, "undone");
  assert.equal(session.state.activeStatic?.state.currentLayout.visitedTileIds.length, 2);
  session.send({ kind: "ResetRoom" }, "reset");
  assert.equal(session.state.activeStatic?.state.currentLayout.visitedTileIds.length, 1);
  assert.equal(session.state.completedObjectiveIds.includes("b.line.01"), false);
  assert.equal(session.state.claimedRewardIds.includes("b.supply.line01"), false);
});

test("S08/P01：B一笔画中途载荷恢复保留路径、清空撤销，重置后仍能正常解出", () => {
  const session = firstState((state) => state.activeStatic?.roomId === "b.line.02");
  session.send({ kind: "Move", direction: "right" });
  session.send({ kind: "Move", direction: "right" });
  const checked = validatePayload(stablePayload(session.state), content);
  assert.equal(checked.ok, true);
  if (!checked.ok) return;
  const restored = new Session(restorePayload(checked.value, content, 0), 0);
  assert.equal(restored.state.playerPosition.tileId, session.state.playerPosition.tileId);
  assert.deepEqual(
    restored.state.activeStatic?.state.currentLayout,
    session.state.activeStatic?.state.currentLayout,
  );
  assert.deepEqual(restored.state.activeStatic?.state.undoStack, []);
  restored.send({ kind: "Undo" }, "noHistory");
  restored.send({ kind: "ResetRoom" }, "reset");
  const success = staticContent.witnesses.find(
    (witness) => witness.id === "b.line.02.witness.success",
  )!;
  for (const [index, direction] of success.actions.entries()) {
    assert.notEqual(direction, "activate");
    assert.notEqual(direction, "undo");
    assert.notEqual(direction, "reset");
    restored.send(
      { kind: "Move", direction: direction as "up" | "right" | "down" | "left" },
      index === success.actions.length - 1 ? "success" : "accepted",
    );
  }
  assert.equal(restored.state.playerPosition.tileId, "b.t.0.-4");
  assert.equal(areaData(content, restored.state, "b").collected, 40);
  assert.equal(restored.state.claimedRewardIds.includes("b.supply.line02"), false);
  restored.send({ kind: "Move", direction: "right" });
  assert.equal(restored.state.claimedRewardIds.includes("b.supply.line02"), true);
});

test("S08：B房间放弃回入口安全侧，未完成的一笔画不泄漏数据和奖励", () => {
  for (const roomId of ["b.line.01", "b.line.02"]) {
    const session = firstState((state) => state.activeStatic?.roomId === roomId);
    const objectives = [...session.state.completedObjectiveIds];
    const rewards = [...session.state.claimedRewardIds];
    session.send({ kind: "Move", direction: "right" });
    session.send({ kind: "ExitRoom" });
    assert.equal(session.state.mode, "explore");
    assert.equal(
      session.state.playerPosition.tileId,
      content.rooms.find((room) => room.id === roomId)?.returnTileId,
    );
    assert.deepEqual(session.state.completedObjectiveIds, objectives);
    assert.deepEqual(session.state.claimedRewardIds, rewards);
    session.send({ kind: "Move", direction: roomId === "b.line.01" ? "right" : "up" });
    assert.equal(session.state.activeStatic?.state.currentLayout.visitedTileIds.length, 1);
  }
});

test("T07/P02：杀毒不操作至失败不开发奖门，放弃/恢复均回安全终端可重试", () => {
  const session = firstState((state) => state.activeRealtime?.roomId === "b.antivirus.heavy");
  const before = [...session.state.completedObjectiveIds];
  const checkpoint = validatePayload(stablePayload(session.state), content);
  assert.equal(checkpoint.ok, true);
  if (!checkpoint.ok) return;
  const restored = restorePayload(checkpoint.value, content, 0);
  assert.equal(restored.playerPosition.tileId, "b.t.0.3");
  assert.equal(restored.mode, "explore");
  assert.equal(restored.resumeHint?.challengeId, "b.antivirus.heavy");
  session.wait(48000);
  assert.equal(session.state.mode, "challengeResult");
  assert.equal(session.state.phase, "failure");
  assert.deepEqual(session.state.completedObjectiveIds, before);
  assert.equal(gateOpen(content, session.state, "gate.b.antivirus.heavy"), false);
  session.send({ kind: "RetryChallenge" });
  assert.equal(session.state.playerPosition.tileId, "b.t.0.3");
  session.send({ kind: "StartChallenge", challengeId: "b.antivirus.heavy" });
  assert.equal(session.state.activeRealtime?.state.kind, "antivirus");
  if (session.state.activeRealtime?.state.kind === "antivirus")
    assert.equal(session.state.activeRealtime.state.score, 0);
  session.send({ kind: "ExitRoom" });
  assert.equal(session.state.playerPosition.tileId, "b.t.0.3");
});

test("S09：一笔画练习和重复拾取/终端/增幅保留永久进度、三档最佳分与51物资", () => {
  const before = full.checkpoints["all-first-visit-collection"]!;
  for (const name of [
    "one-stroke-practice-preserves-progress",
    "repeated-pickups-still-51",
    "activated-map-teleports",
  ]) {
    const after = full.checkpoints[name]!;
    assert.deepEqual(after.completedObjectiveIds, before.completedObjectiveIds);
    assert.deepEqual(after.claimedRewardIds, before.claimedRewardIds);
    assert.deepEqual(after.bestResults, before.bestResults);
    assert.equal(gateOpen(content, after, "gate.b.switch.shortcut"), true);
  }
});

for (const continuation of continuations) {
  test(`P07：真实 M1 载荷迁移续玩 ${continuation.id}`, () => {
    const original = (m1Json.witnesses as WorldWitness[]).find(
      (witness) => witness.id === continuation.initialStateId,
    );
    assert.ok(original);
    const source = replayWorldWitness(m1Content, original);
    assert.deepEqual(source.issues, []);
    const payload = stablePayload(source.state);
    const originalJson = JSON.stringify(payload);
    const migrated = validatePayload(payload, content, migrationRegistry);
    assert.equal(migrated.ok, true);
    if (!migrated.ok) return;
    assert.equal(migrated.migrated, true);
    assert.equal(JSON.stringify(payload), originalJson, "旧载荷未修改");
    assert.deepEqual(migrated.value.completedObjectiveIds, payload.completedObjectiveIds);
    assert.deepEqual(migrated.value.claimedRewardIds, payload.claimedRewardIds);
    assert.deepEqual(migrated.value.discoveredTileIds, payload.discoveredTileIds);
    assert.deepEqual(migrated.value.bestResults, payload.bestResults);
    assert.deepEqual(migrated.value.scopeCompletionHistory, ["M1"]);
    const repeated = validatePayload(migrated.value, content, migrationRegistry);
    assert.equal(repeated.ok, true);
    if (!repeated.ok) return;
    assert.equal(repeated.migrated, undefined);
    assert.deepEqual(repeated.value, migrated.value);
    const session = new Session(restorePayload(migrated.value, content, 0), 0);
    assert.equal(areaData(content, session.state, "b").collected, 0);
    assert.equal(session.state.activatedTeleportIds.includes("b.teleport"), false);
    const {
      initialStateId: _state,
      initialProfileId: _profile,
      initialization: _initialization,
      expectedBData,
      ...publicWitness
    } = continuation;
    assert.deepEqual(validateWorldWitness(publicWitness), []);
    let pickups = 0;
    for (const step of continuation.steps) {
      const result = session.send(step.command, step.expectedCode, step.atMs - session.now);
      pickups += result.events.filter((event) => event.kind === "pickup").length;
      if (step.checkpoint) matchesExpectation(session.state, step.checkpoint.expected);
    }
    matchesExpectation(session.state, continuation.expected);
    assert.equal(areaData(content, session.state, "b").collected, expectedBData);
    assert.deepEqual(session.state.scopeCompletionHistory, ["M1", "M2"]);
    assert.equal(pickups, expectedBData === 80 ? 5 : 1);
    assert.deepEqual(
      session.state.bestResults,
      expectedBData === 80 ? full.state.bestResults : main.state.bestResults,
    );
    assert.equal(session.state.campaignCompletedAt, null);
  });
}

test("I09：A/B物理传送连续30个往返保持落点和同一进度，不自动反向跳转", () => {
  const session = new Session(full.state, fullWitness.steps.at(-1)!.atMs);
  const before = stablePayload(session.state);
  for (let count = 0; count < 30; count += 1) {
    session.send({ kind: "Move", direction: "down" });
    session.send({ kind: "Move", direction: "down" });
    session.send({ kind: "Interact" });
    assert.equal(session.state.playerPosition.tileId, "a.t.0.0");
    session.send({ kind: "Tick" });
    assert.equal(session.state.playerPosition.tileId, "a.t.0.0");
    for (let step = 0; step < 4; step += 1) session.send({ kind: "Move", direction: "right" });
    assert.equal(session.state.mode, "completedRoom");
    assert.equal(session.state.activeCompletedRoom?.roomId, "a.maze.01");
    for (let step = 0; step < 4; step += 1) session.send({ kind: "Move", direction: "up" });
    for (let step = 0; step < 4; step += 1) session.send({ kind: "Move", direction: "right" });
    assert.equal(session.state.playerPosition.tileId, "a.t.5.0");
    for (let step = 0; step < 3; step += 1) session.send({ kind: "Move", direction: "right" });
    session.send({ kind: "Interact" });
    assert.equal(session.state.playerPosition.tileId, "b.t.0.0");
    session.send({ kind: "Tick" });
    assert.equal(session.state.playerPosition.tileId, "b.t.0.0");
  }
  assert.deepEqual(session.state.completedObjectiveIds, before.completedObjectiveIds);
  assert.deepEqual(session.state.claimedRewardIds, before.claimedRewardIds);
  assert.deepEqual(session.state.bestResults, before.bestResults);
  assert.deepEqual(session.state.completedRoomLayouts, before.completedRoomLayouts);
  assert.equal(supplyProgress(content, session.state).collected, 51);
});
