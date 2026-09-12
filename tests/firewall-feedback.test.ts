import assert from "node:assert/strict";
import test from "node:test";
import { assembleContent } from "../src/content/assemble.ts";
import { createClock } from "../src/core/clock.ts";
import { createGame, dispatch } from "../src/core/engine.ts";
import { firewallFeedback } from "../src/core/firewall-feedback.ts";
import { projectBoard } from "../src/core/projection.ts";
import { createRealtime } from "../src/core/realtime.ts";
import type { DirectionalFirewallDefinition, FirewallState } from "../src/core/realtime.ts";
import { boardProjectionKey } from "../src/render/projection-key.ts";

const definition: DirectionalFirewallDefinition = {
  id: "a.firewall.tutorial",
  kind: "firewall",
  ruleVersion: 3,
  boardId: "firewall-feedback-fixture",
  tiles: [
    { id: "below", x: 0, y: 1 },
    { id: "above", x: 0, y: 0 },
  ],
  entry: { tileId: "below" },
  effectBundleId: "unused-display-fixture",
  witnessIds: [],
  goal: { kind: "highestCombo" },
  rules: {
    durationMs: 2000,
    bpm: 60,
    firstBeatMs: 500,
    windowMs: 150,
    comboTarget: 1,
    offbeatPenalty: 1,
    beatCount: 2,
    hazardPenalty: 5,
    dodgeWindowMs: 150,
    alarms: [
      {
        id: "from-above",
        startsAtMs: 100,
        endsAtMs: 1200,
        approachFrom: "up",
        frames: [{ atMs: 100, tileIds: ["below"] }],
      },
    ],
  },
};

test("受击有独立扣分反馈，不被上一拍PERFECT掩盖，显示函数不改变规则状态", () => {
  const active: FirewallState = {
    ...createRealtime(definition),
    combo: 47,
    bestCombo: 52,
    lastJudgment: { kind: "perfect", activeTimeMs: 950 },
    lastHazardHit: { activeTimeMs: 1000, alarmIds: ["from-above"], penalty: 5 },
  };
  const before = structuredClone(active);
  const clock = { ...createClock(), activeTimeMs: 1001 };
  const shown = firewallFeedback(active, clock);
  assert.equal(shown.judgment, "hazardHit");
  assert.equal(shown.message, "警报命中 · 连击 −5");
  assert.ok(shown.impactOpacity > 0);
  assert.equal(firewallFeedback(active, { ...clock, activeTimeMs: 1300 }).impactOpacity, 0);
  assert.equal(firewallFeedback(active, { ...clock, activeTimeMs: 1600 }).judgment, null);
  assert.deepEqual(active, before);
});

test("闪避提示只来自真实接触事件，普通踩拍的保护窗口不冒充闪避", () => {
  const active: FirewallState = {
    ...createRealtime(definition),
    dodge: { direction: "up", untilMs: 650, beatIndex: 0 },
    lastJudgment: { kind: "perfect", activeTimeMs: 500 },
  };
  const clock = { ...createClock(), activeTimeMs: 501 };
  assert.equal(firewallFeedback(active, clock).judgment, "perfect");
  const actualDodge = { ...active, lastDodgeAtMs: 501 };
  assert.equal(firewallFeedback(actualDodge, clock).judgment, "dodged");
  assert.equal(firewallFeedback(actualDodge, { ...clock, activeTimeMs: 801 }).judgment, null);
});

test("受击后的下一次踩拍或闪避立即更新文字，旧扣分不会覆盖新判定", () => {
  const active: FirewallState = {
    ...createRealtime(definition),
    lastHazardHit: { activeTimeMs: 1000, alarmIds: ["from-above"], penalty: 5 },
    lastJudgment: { kind: "perfect", activeTimeMs: 1450 },
  };
  const clock = { ...createClock(), activeTimeMs: 1451 };
  assert.equal(firewallFeedback(active, clock).judgment, "perfect");
  assert.equal(firewallFeedback({ ...active, lastDodgeAtMs: 1451 }, clock).judgment, "dodged");
});

test("暂停、失焦、准备与已结束状态同时收起受击红晕和文字", () => {
  const active = {
    ...createRealtime(definition),
    lastHazardHit: { activeTimeMs: 100, alarmIds: ["from-above"], penalty: 5 },
  };
  const clock = { ...createClock(), activeTimeMs: 101 };
  for (const hidden of [
    { ...clock, pauseReasons: ["manual"] as const },
    { ...clock, pauseReasons: ["blur"] as const },
    { ...clock, awaitingResume: true },
    { ...clock, countdownRemainingMs: 1000 },
  ])
    assert.deepEqual(firewallFeedback(active, hidden), {
      judgment: null,
      message: "",
      impactOpacity: 0,
    });
  assert.deepEqual(firewallFeedback({ ...active, status: "success" }, clock), {
    judgment: null,
    message: "",
    impactOpacity: 0,
  });
});

test("警报时间推进的受击接入世界事件和四屏投影，永久进度不受影响", () => {
  // Synthetic local state tests time-driven feedback; browser completion uses normal inputs.
  const content = { ...assembleContent("M1"), ruleVersion: 3, realtimeChallenges: [definition] };
  const state = createGame(content, 0);
  const returnAnchor = state.playerPosition;
  state.mode = "challengeRunning";
  state.clock = createClock(0, { realtime: true });
  state.activeRealtime = {
    roomId: definition.id,
    returnAnchor,
    practice: true,
    state: { ...createRealtime(definition), combo: 52, bestCombo: 52 },
  };
  state.playerPosition = {
    space: "room",
    areaId: "a",
    boardId: definition.boardId,
    tileId: "below",
  };
  const warning = projectBoard(content, state).tiles.find((tile) => tile.id === "below")!;
  assert.equal(warning.mark, "↑");
  assert.equal(warning.hazardPhase, "warning");
  assert.match(warning.label, /来自上/);
  const result = dispatch(content, state, { kind: "Tick" }, 101);
  assert.equal(result.code, "hazardHit");
  assert.equal(result.events.filter((event) => event.kind === "hazardHit").length, 1);
  assert.equal(
    result.events.some((event) => event.kind === "invalid"),
    false,
  );
  assert.equal(projectBoard(content, result.state).firewall?.judgment, "hazardHit");
  assert.equal(projectBoard(content, result.state).firewall?.combo, 47);
  assert.equal(
    projectBoard(content, result.state).tiles.find((tile) => tile.id === "below")?.hazardPhase,
    "active",
  );
  assert.match(result.state.lastResult.message, /警报命中/);
  assert.deepEqual(result.state.claimedRewardIds, state.claimedRewardIds);
  assert.deepEqual(result.state.completedObjectiveIds, state.completedObjectiveIds);
  const repeated = dispatch(content, result.state, { kind: "Tick" }, 102);
  assert.equal(repeated.events.length, 0);
  const paused = dispatch(
    content,
    repeated.state,
    { kind: "Pause", reason: "manual", present: true },
    103,
  ).state;
  assert.equal(projectBoard(content, paused).firewall?.judgment, null);
  assert.notEqual(boardProjectionKey(repeated.state), boardProjectionKey(paused));
});
