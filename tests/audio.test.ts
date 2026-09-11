import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import { GameAudio } from "../src/audio/audio.ts";
import { assembleContent } from "../src/content/assemble.ts";
import { createGame } from "../src/core/engine.ts";
import { createClock } from "../src/core/clock.ts";

function audioHarness(context: TestContext) {
  let rejectResume = false;
  let resourceStatus = 200;
  let requests = 0;
  let responseOverride: (url: string) => Promise<Response> | null = () => null;
  let resumeOverride: () => Promise<void> | null = () => null;
  const starts: number[] = [];
  const offsets: number[] = [];
  const rates: number[] = [];
  let audioTime = 10;
  let outputLatencySeconds = 0;
  let monotonicTime = 0;
  const gains: number[] = [];
  let stopped = 0;
  class FakeAudioContext {
    get currentTime() {
      return audioTime;
    }
    getOutputTimestamp() {
      return { contextTime: audioTime - outputLatencySeconds, performanceTime: monotonicTime };
    }
    state = "running";
    destination = {};
    resume() {
      const overridden = resumeOverride();
      if (overridden) return overridden;
      return rejectResume ? Promise.reject(new Error("gesture rejected")) : Promise.resolve();
    }
    close() {
      return Promise.resolve();
    }
    createGain() {
      return {
        connect() {},
        gain: {
          setTargetAtTime(value: number) {
            gains.push(value);
          },
        },
      };
    }
    createBufferSource() {
      return {
        buffer: null,
        onended: null,
        playbackRate: {
          setValueAtTime(value: number) {
            rates.push(value);
          },
        },
        connect() {},
        disconnect() {},
        start(at: number, offset = 0) {
          starts.push(at);
          offsets.push(offset);
        },
        stop() {
          stopped += 1;
        },
      };
    }
    decodeAudioData() {
      return Promise.resolve({ duration: (32 * 60) / 110 });
    }
  }
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "AudioContext");
  Object.defineProperty(globalThis, "AudioContext", {
    configurable: true,
    value: FakeAudioContext,
  });
  context.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    requests += 1;
    const overridden = responseOverride(String(input));
    if (overridden) return overridden;
    return new Response(new Uint8Array(8), { status: resourceStatus });
  });
  context.after(() => {
    if (descriptor) Object.defineProperty(globalThis, "AudioContext", descriptor);
    else Reflect.deleteProperty(globalThis, "AudioContext");
  });
  const content = assembleContent("M1");
  const state = createGame(content, 0);
  state.mode = "challengeRunning";
  state.clock = createClock(0, { realtime: true });
  const definition = content.realtimeChallenges.find((item) => item.id === "a.firewall.tutorial");
  assert.ok(definition?.kind === "firewall");
  const audio = new GameAudio();
  context.after(() => audio.dispose());
  return {
    audio,
    state,
    definition,
    starts,
    offsets,
    rates,
    gains,
    stopped: () => stopped,
    requests: () => requests,
    denyResume(value: boolean) {
      rejectResume = value;
    },
    resourceStatus(value: number) {
      resourceStatus = value;
    },
    interceptResponse(handler: typeof responseOverride) {
      responseOverride = handler;
    },
    interceptResume(handler: typeof resumeOverride) {
      resumeOverride = handler;
    },
    outputLatency(seconds: number) {
      outputLatencySeconds = seconds;
    },
    sync(activeTimeMs: number) {
      monotonicTime = activeTimeMs;
      audioTime = 10 + activeTimeMs / 1000;
      state.clock = { ...state.clock, activeTimeMs };
      audio.syncFirewall(state, definition, activeTimeMs);
    },
  };
}

test("配乐迟到启用时从当前乐句位置播放，逐帧同步不重播或叠加循环", async (context) => {
  const h = audioHarness(context);
  assert.equal(await h.audio.enable(), true);
  h.sync(310);
  assert.equal(h.starts.length, 1);
  assert.ok(Math.abs(h.starts[0]! - 10.315) < 1e-9);
  assert.ok(h.offsets[0]! > 0.04 && h.offsets[0]! < 0.05);
  h.sync(660);
  h.sync(660);
  assert.equal(h.starts.length, 1);
  h.sync(1160);
  assert.equal(h.starts.length, 1);
  assert.deepEqual(h.rates, [1]);
  assert.ok(Math.abs(h.audio.metrics().music!.driftMs) < 0.001);
});

test("同局音频设备延迟变化后重新对齐当前乐句，小幅测量抖动不会重启", async (context) => {
  const h = audioHarness(context);
  h.outputLatency(0.08);
  assert.equal(await h.audio.enable(), true);
  h.sync(310);
  h.sync(500);
  assert.equal(h.starts.length, 1);
  h.outputLatency(0.3);
  h.sync(600);
  assert.equal(h.starts.length, 2, "设备延迟增加220ms后必须修复超出判定窗的相位偏差");
  assert.equal(h.stopped(), 1);
  assert.ok(Math.abs(h.audio.metrics().music!.driftMs) < 0.001);
  for (let tick = 1; tick <= 8; tick += 1) {
    h.outputLatency(tick % 2 ? 0.304 : 0.297);
    h.sync(600 + tick * 16);
  }
  assert.equal(h.starts.length, 2);
  assert.ok(Math.abs(h.audio.metrics().music!.driftMs) <= 4.001);
});

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("V04 新一次启用成功后，旧声音请求迟到失败不能关闭声音", async (context) => {
  const h = audioHarness(context);
  const firstMove = deferred<Response>();
  const firstMoveRequested = deferred<void>();
  let intercepted = false;
  h.interceptResponse((url) => {
    if (url.endsWith("/move.wav") && !intercepted) {
      intercepted = true;
      firstMoveRequested.resolve();
      return firstMove.promise;
    }
    return null;
  });
  const earlier = h.audio.enable();
  await firstMoveRequested.promise;
  assert.equal(await h.audio.enable(), true);
  firstMove.reject(new Error("earlier download failed late"));
  await earlier;
  assert.equal(h.audio.enabled, true);
  h.audio.play("move");
  assert.deepEqual(h.starts, [10], "迟到失败后仍可播放已解码声音");
});

test("V04 新一次启用失败后，旧 resume 迟到成功不能覆盖最新失败", async (context) => {
  const h = audioHarness(context);
  const firstResume = deferred<void>();
  let resumes = 0;
  h.interceptResume(() => (++resumes === 1 ? firstResume.promise : null));
  const earlier = h.audio.enable();
  h.denyResume(true);
  assert.equal(await h.audio.enable(), false);
  firstResume.resolve();
  await earlier;
  assert.equal(h.audio.enabled, false);
  h.audio.play("move");
  assert.deepEqual(h.starts, []);
  h.denyResume(false);
  assert.equal(await h.audio.enable(), true, "新手势仍可在失败后重试");
});

for (const action of ["disable", "dispose"] as const)
  test(`V04 ${action} 使尚未完成的音频启用失效，迟到资源不会重新启用`, async (context) => {
    const h = audioHarness(context);
    const firstMove = deferred<Response>();
    const requested = deferred<void>();
    h.interceptResponse((url) => {
      if (!url.endsWith("/move.wav")) return null;
      requested.resolve();
      return firstMove.promise;
    });
    const pending = h.audio.enable();
    await requested.promise;
    assert.equal(h.audio.enabled, false, "资源未齐时不能报告声音可用");
    h.audio[action]();
    firstMove.resolve(new Response(new Uint8Array(8)));
    assert.equal(await pending, false);
    assert.equal(h.audio.enabled, false);
    h.audio.play("move");
    assert.deepEqual(h.starts, []);
  });

test("暂停停止配乐，恢复倒数不播放，倒数结束从冻结的乐句位置继续", async (context) => {
  const h = audioHarness(context);
  await h.audio.enable();
  h.sync(180);
  assert.equal(h.starts.length, 1);
  h.state.clock = { ...h.state.clock, pauseReasons: ["manual"], awaitingResume: true };
  h.sync(180);
  assert.equal(h.stopped(), 1);
  h.sync(180);
  assert.equal(h.stopped(), 1);
  h.state.clock = {
    ...h.state.clock,
    pauseReasons: [],
    awaitingResume: false,
    countdownRemainingMs: 3000,
    inputEpoch: 1,
  };
  h.sync(180);
  assert.equal(h.starts.length, 1);
  h.state.clock = { ...h.state.clock, countdownRemainingMs: 0, inputEpoch: 2 };
  h.sync(200);
  assert.equal(h.starts.length, 2);
  assert.ok(Math.abs(h.starts[1]! - (10 + h.definition.rules.firstBeatMs / 1000)) < 1e-9);
  assert.ok(h.offsets[1]! < 1e-9);
});

test("浏览器拒绝声音和本地声音缺失均可再次启用，不静默标为正常", async (context) => {
  const h = audioHarness(context);
  h.denyResume(true);
  assert.equal(await h.audio.enable(), false);
  assert.equal(h.requests(), 0);
  h.denyResume(false);
  h.resourceStatus(503);
  assert.equal(await h.audio.enable(), false);
  assert.equal(h.audio.enabled, false);
  h.resourceStatus(200);
  assert.equal(await h.audio.enable(), true);
  const count = h.requests();
  await h.audio.enable();
  assert.equal(h.requests(), count, "已经解码的声音不重复下载");
});

test("无效音效180ms限频不作用于成功反馈，未变音量不反复调度", async (context) => {
  const h = audioHarness(context);
  await h.audio.enable();
  h.audio.feedback([{ id: 1, kind: "invalid", message: "" }], 0);
  h.audio.feedback([{ id: 2, kind: "invalid", message: "" }], 179);
  assert.equal(h.starts.length, 1);
  h.audio.feedback([{ id: 3, kind: "success", message: "" }], 179);
  h.audio.feedback([{ id: 4, kind: "invalid", message: "" }], 180);
  assert.equal(h.starts.length, 3);
  h.audio.configure(h.state.settings);
  h.audio.configure(h.state.settings);
  h.audio.configure({ ...h.state.settings, muted: true });
  assert.deepEqual(h.gains, [0.6, 0]);
});
