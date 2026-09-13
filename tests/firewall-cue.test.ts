import assert from "node:assert/strict";
import test from "node:test";
import { createClock } from "../src/core/clock.ts";
import { advanceRealtime, createRealtime, firewallBeatCount } from "../src/core/realtime.ts";
import type {
  DirectionalFirewallDefinition,
  FirewallDefinition,
  RealtimeDefinition,
} from "../src/core/realtime.ts";
import content from "../src/content/challenges/realtime.json" with { type: "json" };
import { firewallCue } from "../src/ui/firewall-cue.ts";

const definitions = (content.definitions as RealtimeDefinition[]).filter(
  (definition): definition is FirewallDefinition => definition.kind === "firewall",
);
const tutorial = definitions.find((definition) => definition.id === "a.firewall.tutorial")!;
const clockAt = (activeTimeMs: number) => ({ ...createClock(0, { realtime: true }), activeTimeMs });

test("没有警报接触时，视觉拍点窗口与四档真实评分的首末边界完全一致", () => {
  for (const original of definitions) {
    const definition: FirewallDefinition =
      original.ruleVersion === 3
        ? { ...original, rules: { ...original.rules, alarms: [] } }
        : {
            ...original,
            rules: { ...original.rules, beatMasks: original.rules.beatMasks.map(() => []) },
          };
    const { firstBeatMs, bpm, windowMs, durationMs } = definition.rules;
    const period = 60_000 / bpm;
    const lastBeat = firstBeatMs + (firewallBeatCount(definition) - 1) * period;
    for (const at of [
      0,
      firstBeatMs - windowMs - 1,
      firstBeatMs - windowMs,
      firstBeatMs,
      firstBeatMs + windowMs,
      firstBeatMs + windowMs + 1,
      firstBeatMs + period - windowMs - 1,
      firstBeatMs + period - windowMs,
      lastBeat - windowMs - 1,
      lastBeat - windowMs,
      lastBeat,
      lastBeat + windowMs,
      lastBeat + windowMs + 1,
      durationMs,
    ]) {
      const active = createRealtime(definition);
      const cue = firewallCue(definition, active, clockAt(at));
      const judged = advanceRealtime(definition, active, at, [
        { kind: "move", direction: "right", activeTimeMs: at, sequence: 1 },
      ]);
      assert.equal(
        cue.phase === "ready",
        judged.feedback.some((event) => event.kind === "hit"),
        `${definition.id} / ${at}ms`,
      );
      assert.ok(cue.beatNumber >= 1 && cue.beatNumber <= cue.totalBeats);
    }
  }
});

test("拍点提示读取内容参数，不另写一套250/500/150ms常数", () => {
  const definition: DirectionalFirewallDefinition = {
    ...tutorial,
    ruleVersion: 3,
    rules: {
      firstBeatMs: 400,
      bpm: 100,
      windowMs: 80,
      durationMs: 1800,
      comboTarget: 1,
      offbeatPenalty: 1,
      beatCount: 3,
      hazardPenalty: 5,
      dodgeWindowMs: 150,
      alarms: [],
    },
  };
  for (const at of [319, 320, 400, 480, 481, 919, 920, 1000, 1080, 1081]) {
    const active = createRealtime(definition);
    const cue = firewallCue(definition, active, clockAt(at));
    const result = advanceRealtime(definition, active, at, [
      { kind: "move", direction: "left", activeTimeMs: at, sequence: 1 },
    ]);
    assert.equal(
      cue.phase === "ready",
      result.feedback.some((event) => event.kind === "hit"),
    );
  }
  assert.equal(firewallCue(definition, createRealtime(definition), clockAt(400)).cursorPercent, 50);
});

test("已经计分的同一拍显示命中，下一拍重新提示移动", () => {
  const initial = createRealtime(tutorial);
  const firstBeat = tutorial.rules.firstBeatMs;
  const nextBeat = firstBeat + 60_000 / tutorial.rules.bpm;
  const result = advanceRealtime(tutorial, initial, firstBeat, [
    { kind: "move", direction: "right", activeTimeMs: firstBeat, sequence: 1 },
  ]);
  assert.equal(result.state.kind, "firewall");
  if (result.state.kind !== "firewall") assert.fail();
  assert.equal(firewallCue(tutorial, result.state, clockAt(firstBeat + 50)).label, "本拍命中");
  assert.equal(
    firewallCue(tutorial, result.state, clockAt(firstBeat + tutorial.rules.windowMs + 1)).label,
    "等待拍点",
  );
  assert.equal(firewallCue(tutorial, result.state, clockAt(nextBeat)).label, "现在移动");
  assert.equal(firewallCue(tutorial, result.state, clockAt(nextBeat)).beatNumber, 2);
});

test("踩拍受击消耗本拍后不再提示现在移动，节拍白光仍与时间同步", () => {
  assert.ok(tutorial.ruleVersion === 3);
  const entry = tutorial.tiles.find((tile) => tile.id === tutorial.entry.tileId)!;
  const destination = tutorial.tiles.find((tile) => tile.x === entry.x + 1 && tile.y === entry.y)!;
  const beat = tutorial.rules.firstBeatMs;
  const definition: DirectionalFirewallDefinition = {
    ...tutorial,
    rules: {
      ...tutorial.rules,
      alarms: [
        {
          id: "cue-hit",
          approachFrom: "left",
          startsAtMs: beat,
          endsAtMs: beat + 500,
          frames: [{ atMs: beat, tileIds: [destination.id] }],
        },
      ],
    },
  };
  const result = advanceRealtime(definition, createRealtime(definition), beat, {
    kind: "move",
    direction: "right",
    activeTimeMs: beat,
    sequence: 1,
  });
  assert.ok(result.state.kind === "firewall");
  assert.ok(result.feedback.some((event) => event.kind === "hazardHit"));
  const cue = firewallCue(definition, result.state, clockAt(beat));
  assert.equal(cue.label, "本拍受击");
  assert.equal(cue.phase, "judged");
  assert.equal(cue.screenLightOpacity, 1);
  assert.equal(
    firewallCue(definition, result.state, clockAt(beat + 60_000 / definition.rules.bpm)).phase,
    "ready",
  );
});

test("暂停、失焦待恢复和准备倒数不提示玩家输入", () => {
  const active = createRealtime(tutorial);
  assert.equal(
    firewallCue(tutorial, active, { ...clockAt(250), pauseReasons: ["manual"] }).phase,
    "paused",
  );
  assert.equal(
    firewallCue(tutorial, active, { ...clockAt(250), awaitingResume: true }).phase,
    "paused",
  );
  assert.equal(
    firewallCue(tutorial, active, { ...clockAt(250), countdownRemainingMs: 1000 }).phase,
    "preparing",
  );
  assert.equal(firewallCue(tutorial, active, clockAt(250)).phase, "ready");
});

test("时间终点与已结算状态都关闭输入提示，拍数不会越界", () => {
  const active = createRealtime(tutorial);
  assert.equal(firewallCue(tutorial, active, clockAt(15000)).phase, "ended");
  assert.equal(
    firewallCue(tutorial, { ...active, status: "success" }, clockAt(14750)).phase,
    "ended",
  );
  assert.equal(
    firewallCue(tutorial, active, clockAt(20000)).beatNumber,
    firewallBeatCount(tutorial),
  );
});

test("画面白光只在有效窗口亮起，拍点达到峰值，命中后仍保持同一节拍", () => {
  for (const definition of definitions) {
    const active = createRealtime(definition);
    const beat = definition.rules.firstBeatMs;
    const window = definition.rules.windowMs;
    const lightAt = (time: number) =>
      firewallCue(definition, active, clockAt(time)).screenLightOpacity;
    assert.equal(lightAt(beat - window - 1), 0);
    assert.ok(lightAt(beat - window) >= 0.3);
    assert.ok(lightAt(beat - window / 2) > lightAt(beat - window));
    assert.equal(lightAt(beat), 1);
    assert.equal(lightAt(beat - window / 2), lightAt(beat + window / 2));
    assert.equal(lightAt(beat + window + 1), 0);
    assert.equal(
      firewallCue(definition, { ...active, scoredBeatIndices: [0] }, clockAt(beat))
        .screenLightOpacity,
      1,
    );
    for (const clock of [
      { ...clockAt(beat), pauseReasons: ["manual"] as const },
      { ...clockAt(beat), awaitingResume: true },
      { ...clockAt(beat), countdownRemainingMs: 1000 },
      clockAt(definition.rules.durationMs),
    ])
      assert.equal(firewallCue(definition, active, clock).screenLightOpacity, 0);
    assert.equal(
      firewallCue(definition, { ...active, status: "success" }, clockAt(beat)).screenLightOpacity,
      0,
    );
  }
});
