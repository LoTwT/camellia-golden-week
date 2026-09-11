import assert from "node:assert/strict";
import test from "node:test";
import { createClock } from "../src/core/clock.ts";
import { advanceRealtime, createRealtime } from "../src/core/realtime.ts";
import type { FirewallDefinition, RealtimeDefinition } from "../src/core/realtime.ts";
import content from "../src/content/challenges/realtime.json" with { type: "json" };
import { firewallCue } from "../src/ui/firewall-cue.ts";

const definitions = (content.definitions as RealtimeDefinition[]).filter(
  (definition): definition is FirewallDefinition => definition.kind === "firewall",
);
const tutorial = definitions.find((definition) => definition.id === "a.firewall.tutorial")!;
const clockAt = (activeTimeMs: number) => ({ ...createClock(0, { realtime: true }), activeTimeMs });

test("防火墙视觉可移动窗口与四档真实评分的首末边界完全一致", () => {
  for (const definition of definitions) {
    const lastBeat = definition.rules.durationMs - 250;
    for (const at of [
      0,
      99,
      100,
      250,
      400,
      401,
      599,
      600,
      lastBeat - 151,
      lastBeat - 150,
      lastBeat,
      lastBeat + 150,
      lastBeat + 151,
      definition.rules.durationMs,
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
  const definition: FirewallDefinition = {
    ...tutorial,
    rules: {
      ...tutorial.rules,
      firstBeatMs: 400,
      bpm: 100,
      windowMs: 80,
      durationMs: 1800,
      beatMasks: [[], [], []],
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
  const result = advanceRealtime(tutorial, initial, 250, [
    { kind: "move", direction: "right", activeTimeMs: 250, sequence: 1 },
  ]);
  assert.equal(result.state.kind, "firewall");
  if (result.state.kind !== "firewall") assert.fail();
  assert.equal(firewallCue(tutorial, result.state, clockAt(300)).label, "本拍命中");
  assert.equal(firewallCue(tutorial, result.state, clockAt(450)).label, "等待拍点");
  assert.equal(firewallCue(tutorial, result.state, clockAt(750)).label, "现在移动");
  assert.equal(firewallCue(tutorial, result.state, clockAt(750)).beatNumber, 2);
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
  assert.equal(firewallCue(tutorial, active, clockAt(20000)).beatNumber, 30);
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
