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
  const starts: number[] = [];
  const gains: number[] = [];
  let stopped = 0;
  class FakeAudioContext {
    currentTime = 10;
    state = "running";
    destination = {};
    resume() {
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
        connect() {},
        disconnect() {},
        start(at: number) {
          starts.push(at);
        },
        stop() {
          stopped += 1;
        },
      };
    }
    decodeAudioData() {
      return Promise.resolve({});
    }
  }
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "AudioContext");
  Object.defineProperty(globalThis, "AudioContext", {
    configurable: true,
    value: FakeAudioContext,
  });
  context.mock.method(globalThis, "fetch", async () => {
    requests += 1;
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
    gains,
    stopped: () => stopped,
    requests: () => requests,
    denyResume(value: boolean) {
      rejectResume = value;
    },
    resourceStatus(value: number) {
      resourceStatus = value;
    },
    sync(activeTimeMs: number) {
      state.clock = { ...state.clock, activeTimeMs };
      audio.syncFirewall(state, definition, activeTimeMs);
    },
  };
}

test("音频错过一个调度窗口后跳过过期拍，后续节拍继续且不补播", async (context) => {
  const h = audioHarness(context);
  assert.equal(await h.audio.enable(), true);
  h.sync(310);
  assert.deepEqual(h.starts, []);
  h.sync(660);
  assert.deepEqual(h.starts, [10.09]);
  h.sync(660);
  assert.equal(h.starts.length, 1);
  h.sync(1160);
  assert.equal(h.starts.length, 2);
  assert.deepEqual(h.starts, [10.09, 10.09]);
});

test("暂停取消已排节拍，恢复倒数期间不播积压声音", async (context) => {
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
  assert.equal(h.starts[1], 10.05);
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
