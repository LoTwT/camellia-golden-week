import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceClock,
  clockAcceptsInput,
  createClock,
  resumeClock,
  setClockPauseReason,
} from "../src/core/clock.ts";
import type { ClockState, PauseReason } from "../src/core/clock.ts";

const resumeConditions = { pageVisible: true, canvasOperable: true, graphicsAvailable: true };

function advanceSmoothly(state: ClockState, untilMs: number, stepMs = 50): ClockState {
  let current = state;
  while (current.lastMonotonicTimeMs < untilMs) {
    current = advanceClock(current, Math.min(untilMs, current.lastMonotonicTimeMs + stepMs)).state;
  }
  return current;
}

test("有效时间使用单调毫秒；30 / 60 / 120fps 推进结果一致", () => {
  for (const fps of [30, 60, 120]) {
    const clock = advanceSmoothly(createClock(100), 10_100, 1000 / fps);
    assert.equal(clock.activeTimeMs, 10_000);
    assert.equal(clockAcceptsInput(clock), true);
  }
});

test("3 秒准备倒数不消耗挑战时间，跨倒数末端只增加剩余部分", () => {
  let clock = advanceSmoothly(createClock(100, { realtime: true, preparationMs: 3000 }), 3050);
  assert.equal(clock.activeTimeMs, 0);
  assert.equal(clock.countdownRemainingMs, 50);
  assert.equal(clockAcceptsInput(clock), false);
  const advanced = advanceClock(clock, 3150);
  clock = advanced.state;
  assert.equal(clock.activeTimeMs, 50);
  assert.equal(clock.countdownRemainingMs, 0);
  assert.equal(advanced.clearInputs, true);
  assert.equal(advanced.feedback[0]?.kind, "countdownFinished");
  assert.equal(clockAcceptsInput(clock), true);
});

test("T11 首步前 1ms 暂停、后台 30 秒、恢复 3 秒后仍剩 1ms", () => {
  let clock = advanceSmoothly(createClock(0, { realtime: true }), 499);
  clock = setClockPauseReason(clock, "hidden", true, 499).state;
  assert.equal(clock.activeTimeMs, 499);
  clock = advanceClock(clock, 30_499).state;
  clock = setClockPauseReason(clock, "hidden", false, 30_499).state;
  assert.equal(clock.awaitingResume, true);
  assert.equal(clockAcceptsInput(clock), false);
  assert.equal(clock.activeTimeMs, 499);
  clock = resumeClock(clock, 30_499, resumeConditions).state;
  clock = advanceSmoothly(clock, 33_498);
  assert.equal(clock.activeTimeMs, 499);
  assert.equal(clock.countdownRemainingMs, 1);
  clock = advanceClock(clock, 33_499).state;
  assert.equal(clock.activeTimeMs, 499);
  clock = advanceClock(clock, 33_500).state;
  assert.equal(clock.activeTimeMs, 500);
});

test("T12 前台 300ms 卡顿冻结到最后已处理时间并清输入，不补算时间", () => {
  const previous = advanceClock(createClock(0, { realtime: true }), 100).state;
  const paused = advanceClock(previous, 400);
  assert.equal(paused.state.activeTimeMs, 100);
  assert.equal(paused.activeDeltaMs, 0);
  assert.deepEqual(paused.state.pauseReasons, ["clockGap"]);
  assert.equal(paused.state.awaitingResume, true);
  assert.equal(paused.clearInputs, true);
  assert.equal(paused.state.inputEpoch, previous.inputEpoch + 1);
  assert.equal(advanceClock(paused.state, 450).state.activeTimeMs, 100);
  let resumed = resumeClock(paused.state, 450, resumeConditions).state;
  resumed = advanceSmoothly(resumed, 3450);
  assert.equal(resumed.activeTimeMs, 100);
  assert.equal(advanceClock(resumed, 3451).state.activeTimeMs, 101);
});

test("间隔 250ms 合法，250ms 以上才进入 clockGap", () => {
  assert.equal(advanceClock(createClock(0), 250).state.activeTimeMs, 250);
  const result = advanceClock(createClock(0), 250.001);
  assert.equal(result.state.activeTimeMs, 0);
  assert.deepEqual(result.state.pauseReasons, ["clockGap"]);
});

test("各暂停原因均清输入；系统原因移除不自动恢复", () => {
  const reasons: readonly PauseReason[] = ["manual", "hidden", "blur", "clockGap", "graphicsLost"];
  for (const reason of reasons) {
    const paused = setClockPauseReason(createClock(0), reason, true, 100);
    assert.equal(paused.state.activeTimeMs, 100);
    assert.equal(paused.clearInputs, true);
    const removed = setClockPauseReason(paused.state, reason, false, 200);
    assert.equal(removed.state.awaitingResume, true);
    assert.equal(clockAcceptsInput(removed.state), false);
    assert.equal(advanceClock(removed.state, 300).state.activeTimeMs, 100);
  }
});

test("Resume 不能强制清理仍在生效的系统原因或无效画布条件", () => {
  for (const reason of ["hidden", "blur", "graphicsLost"] as const) {
    const paused = setClockPauseReason(createClock(0, { realtime: true }), reason, true, 50).state;
    const result = resumeClock(paused, 100, resumeConditions);
    assert.equal(result.feedback[0]?.kind, "resumeBlocked");
    assert.ok(result.state.pauseReasons.includes(reason));
    assert.equal(clockAcceptsInput(result.state), false);
  }
  const paused = setClockPauseReason(createClock(0), "manual", true, 0).state;
  for (const conditions of [
    { ...resumeConditions, pageVisible: false },
    { ...resumeConditions, canvasOperable: false },
    { ...resumeConditions, graphicsAvailable: false },
  ]) {
    assert.equal(resumeClock(paused, 0, conditions).feedback[0]?.kind, "resumeBlocked");
  }
});

test("多个原因必须独立解除；静态恢复可立即继续观察有效时间", () => {
  let clock = setClockPauseReason(createClock(0), "manual", true, 100).state;
  clock = setClockPauseReason(clock, "hidden", true, 200).state;
  clock = setClockPauseReason(clock, "blur", true, 300).state;
  clock = setClockPauseReason(clock, "hidden", false, 400).state;
  assert.equal(resumeClock(clock, 500, resumeConditions).feedback[0]?.kind, "resumeBlocked");
  clock = setClockPauseReason(clock, "blur", false, 500).state;
  const resumed = resumeClock(clock, 500, resumeConditions);
  assert.equal(clockAcceptsInput(resumed.state), true);
  assert.deepEqual(resumed.state.pauseReasons, []);
  assert.equal(resumed.state.countdownRemainingMs, 0);
  assert.equal(advanceClock(resumed.state, 600).state.activeTimeMs, 200);
});

test("重复 Resume 不重启倒数，重复暂停不重复生成事件", () => {
  const paused = setClockPauseReason(createClock(0, { realtime: true }), "manual", true, 0).state;
  assert.equal(setClockPauseReason(paused, "manual", true, 0).feedback.length, 0);
  const resumed = resumeClock(paused, 0, resumeConditions).state;
  const halfway = advanceSmoothly(resumed, 1000);
  assert.equal(resumeClock(halfway, 1000, resumeConditions).state.countdownRemainingMs, 2000);
});

test("倒数中卡顿仍暂停，恢复时重建完整倒数；回退或非有限时钟不污染状态", () => {
  const clock = createClock(100, { realtime: true, preparationMs: 3000 });
  const paused = advanceClock(clock, 500).state;
  assert.equal(paused.activeTimeMs, 0);
  assert.equal(paused.countdownRemainingMs, 3000);
  assert.equal(resumeClock(paused, 500, resumeConditions).state.countdownRemainingMs, 3000);
  for (const time of [99, -1, NaN, Infinity]) {
    const result = advanceClock(clock, time);
    assert.equal(result.state, clock);
    assert.equal(result.feedback[0]?.kind, "invalidTime");
  }
  assert.throws(() => createClock(NaN), RangeError);
  assert.throws(() => createClock(0, { preparationMs: -1 }), RangeError);
});

test("时钟不会修改传入快照", () => {
  const clock = Object.freeze({ ...createClock(0), pauseReasons: Object.freeze([]) });
  const advanced = advanceClock(clock, 100);
  assert.equal(clock.activeTimeMs, 0);
  assert.equal(advanced.state.activeTimeMs, 100);
  assert.notEqual(clock, advanced.state);
});
