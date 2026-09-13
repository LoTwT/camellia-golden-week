import assert from "node:assert/strict";
import test from "node:test";
import { advanceClock, createClock } from "../src/core/clock.ts";
import { createAcceptanceFaults } from "../src/platform/acceptance-faults.ts";
import type {
  AcceptanceFaultController,
  AcceptanceFaultOptions,
  AcceptanceStorageTarget,
  AcceptanceWebGLContext,
} from "../src/platform/acceptance-faults.ts";
import { createSaveStore, SAVE_KEYS } from "../src/platform/save-store.ts";
import type { PayloadValidation, SaveStorage } from "../src/platform/save-store.ts";

class MemoryStorage implements SaveStorage {
  readonly values = new Map<string, string>();
  readonly reads: string[] = [];
  readonly writes: { key: string; value: string }[] = [];
  failNextWrite = false;

  getItem(key: string): string | null {
    this.reads.push(key);
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error("Underlying storage write failed");
    }
    this.writes.push({ key, value });
    this.values.set(key, value);
  }
}

function controller(
  storage = new MemoryStorage(),
  options: Partial<Omit<AcceptanceFaultOptions, "storage">> = {},
): AcceptanceFaultController {
  const result = createAcceptanceFaults({
    buildMode: "acceptance",
    storage,
    getContext: () => null,
    isForeground: () => true,
    ...options,
  });
  assert.ok(result);
  return result;
}

const savedAt = "2026-09-11T12:00:00.000Z";

// Storage-port fixtures have no world coordinates, objectives, scores, or game commands.
interface StorageFixture {
  readonly label: string;
}

function validateFixture(payload: unknown): PayloadValidation<StorageFixture> {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload) ||
    !("label" in payload) ||
    typeof payload.label !== "string"
  )
    return { ok: false, error: "Invalid storage fixture", kind: "invalid" };
  return { ok: true, value: { label: payload.label } };
}

function raw(generation: number, label: string): string {
  return JSON.stringify({ saveGeneration: generation, savedAt, payload: { label } });
}

test("验收开关仅接受 acceptance；生产、开发或 URL 参数不能启用控制器，也不访问平台", () => {
  for (const buildMode of ["production", "development", "m5", "Acceptance", ""]) {
    const options: AcceptanceFaultOptions = {
      buildMode,
      get storage(): SaveStorage {
        return assert.fail("disabled factory must not access storage");
      },
      getContext: () => assert.fail("disabled factory must not inspect graphics"),
      isForeground: () => assert.fail("disabled factory must not inspect the page"),
      startupSearch: "?acceptanceFault=webgl2-unavailable",
    };
    assert.equal(createAcceptanceFaults(options), null);
  }
});

test("实际存储夹具严格限定A/B且必须持有会话，未知键和超大原文不能写入", () => {
  const storage = new MemoryStorage();
  storage.setItem(SAVE_KEYS.a, "original a");
  storage.setItem(SAVE_KEYS.b, "original b");
  let held = false;
  const faults = controller(storage, { mayWriteTestSlots: () => held });
  assert.equal(faults.injectRawSlot("a", "{broken").ok, false);
  assert.equal(storage.getItem(SAVE_KEYS.a), "original a");
  held = true;
  assert.equal(faults.injectRawSlot("preMigration" as never, "broken").ok, false);
  assert.equal(faults.injectRawSlot("a", "x".repeat(512 * 1024 + 1)).ok, false);
  assert.equal(faults.injectRawSlot("a", "{broken").ok, true);
  assert.equal(storage.getItem(SAVE_KEYS.a), "{broken");
  assert.equal(storage.getItem(SAVE_KEYS.b), "original b");
  faults.dispose();
  assert.equal(faults.injectRawSlot("a", "restore").ok, false);
});

test("音频拒绝只消耗一次，解除后正常启用不再抛错", () => {
  const faults = controller();
  faults.armAudioRejection();
  assert.throws(() => faults.beforeAudioEnable(), { name: "NotAllowedError" });
  assert.equal(faults.snapshot().audioEnable, false);
  assert.doesNotThrow(() => faults.beforeAudioEnable());
  faults.armAudioRejection();
  faults.clearArmedFaults();
  assert.doesNotThrow(() => faults.beforeAudioEnable());
});

test("存储拒绝仅命中指定完整键并消耗一次，其余键和原字节保持可用", () => {
  for (const target of ["a", "b", "preMigration"] as const) {
    for (const operation of ["get", "set"] as const) {
      const storage = new MemoryStorage();
      for (const key of [...Object.values(SAVE_KEYS), `${SAVE_KEYS[target]}.other`, "unrelated"])
        storage.values.set(key, `original:${key}`);
      const faults = controller(storage);
      faults.armStorage(operation, target);
      for (const key of storage.values.keys()) {
        if (key === SAVE_KEYS[target]) continue;
        assert.equal(faults.storage.getItem(key), `original:${key}`);
        faults.storage.setItem(key, `other:${key}`);
      }
      assert.equal(faults.snapshot().storage?.target, target);
      const targetKey = SAVE_KEYS[target];
      assert.throws(
        () =>
          operation === "get"
            ? faults.storage.getItem(targetKey)
            : faults.storage.setItem(targetKey, "new-value"),
        { name: operation === "get" ? "SecurityError" : "QuotaExceededError" },
      );
      assert.equal(storage.values.get(targetKey), `original:${targetKey}`);
      assert.equal(faults.snapshot().storage, null);
      assert.equal(faults.storage.getItem(targetKey), `original:${targetKey}`);
      faults.storage.setItem(targetKey, "retry-value");
      assert.equal(faults.storage.getItem(targetKey), "retry-value");
    }
  }
});

test("回读故障等待目标成功写入；提前读取、其他键写入、底层写失败均不消耗", () => {
  const storage = new MemoryStorage();
  storage.values.set(SAVE_KEYS.b, "old-b");
  const faults = controller(storage);
  faults.armStorage("readback", "b");
  assert.equal(faults.storage.getItem(SAVE_KEYS.b), "old-b");
  faults.storage.setItem(SAVE_KEYS.a, "other-slot");
  assert.equal(faults.storage.getItem(SAVE_KEYS.a), "other-slot");
  storage.failNextWrite = true;
  assert.throws(() => faults.storage.setItem(SAVE_KEYS.b, "failed-write"), /Underlying/);
  assert.equal(faults.snapshot().storage?.awaitingReadback, false);
  assert.equal(faults.storage.getItem(SAVE_KEYS.b), "old-b");
  faults.storage.setItem(SAVE_KEYS.b, "complete-new-b");
  assert.equal(faults.snapshot().storage?.awaitingReadback, true);
  assert.equal(faults.storage.getItem(SAVE_KEYS.a), "other-slot");
  assert.notEqual(faults.storage.getItem(SAVE_KEYS.b), "complete-new-b");
  assert.equal(storage.values.get(SAVE_KEYS.b), "complete-new-b");
  assert.equal(faults.storage.getItem(SAVE_KEYS.b), "complete-new-b");
  assert.equal(faults.snapshot().storage, null);
});

test("P03/P09 故障端口接真实双槽服务返回明确失败，原槽与内存保留且正常重试可保存", () => {
  for (const operation of ["get", "set", "readback"] as const) {
    const storage = new MemoryStorage();
    const original = raw(5, "previous");
    storage.values.set(SAVE_KEYS.a, original);
    const faults = controller(storage);
    const store = createSaveStore(faults.storage, validateFixture, () => true);
    const expected = store.inspect();
    const memory = Object.freeze({ label: "committed-in-memory" });
    faults.armStorage(operation, "b");
    const failed = store.write(memory, { expected, intent: "auto", savedAt });
    assert.equal(failed.ok, false);
    assert.ok(!failed.ok);
    assert.equal(
      failed.code,
      operation === "get"
        ? "storageUnavailable"
        : operation === "set"
          ? "writeFailed"
          : "readbackFailed",
    );
    assert.equal(storage.values.get(SAVE_KEYS.a), original);
    assert.deepEqual(memory, { label: "committed-in-memory" });
    assert.equal(store.exportRaw(store.inspect()).a, original);
    assert.ok(store.exportMemory(memory, savedAt).ok);
    const retried = store.write(memory, { expected: store.inspect(), intent: "retry", savedAt });
    assert.ok(retried.ok);
    assert.deepEqual(retried.envelope.payload, memory);
    assert.equal(retried.envelope.saveGeneration, operation === "readback" ? 7 : 6);
  }
});

test("P09 迁移备份的写入或回读故障不会触碰两个原槽，解除后正常迁移可继续", () => {
  for (const operation of ["set", "readback"] as const) {
    const storage = new MemoryStorage();
    const originalA = raw(4, "older");
    const originalB = raw(5, "latest");
    storage.values.set(SAVE_KEYS.a, originalA);
    storage.values.set(SAVE_KEYS.b, originalB);
    const faults = controller(storage);
    const store = createSaveStore(faults.storage, validateFixture, () => true);
    const expected = store.inspect();
    faults.armStorage(operation, "preMigration");
    const failed = store.write({ label: "migrated" }, { expected, intent: "migration", savedAt });
    assert.ok(!failed.ok && failed.code === "backupFailed");
    assert.equal(storage.values.get(SAVE_KEYS.a), originalA);
    assert.equal(storage.values.get(SAVE_KEYS.b), originalB);
    const retried = store.write(
      { label: "migrated" },
      { expected: store.inspect(), intent: "migration", savedAt },
    );
    assert.ok(retried.ok);
    const backup = JSON.parse(storage.getItem(SAVE_KEYS.preMigration)!) as {
      saves: { a: string; b: string };
    };
    assert.deepEqual(backup.saves, { a: originalA, b: originalB });
  }
});

test("成功反馈异常只由指定通道的实际 success 描述消耗，普通反馈不消耗，重复调用不再抛错", () => {
  const faults = controller();
  const success = Object.freeze([Object.freeze({ kind: "success" })]);
  for (const channel of ["audio", "render"] as const) {
    faults.armFeedback(channel);
    for (const kind of ["move", "score", "pickup", "door", "failure"])
      assert.doesNotThrow(() => faults.beforeFeedback(channel, [{ kind }]));
    assert.doesNotThrow(() =>
      faults.beforeFeedback(channel === "audio" ? "render" : "audio", success),
    );
    assert.equal(faults.snapshot().feedback, channel);
    assert.throws(() => faults.beforeFeedback(channel, success), /验收故障.*反馈异常/);
    assert.equal(faults.snapshot().feedback, null);
    assert.doesNotThrow(() => faults.beforeFeedback(channel, success));
    assert.deepEqual(success, [{ kind: "success" }]);
  }
});

test("启动故障只识别规定参数并在初始化前消耗一次；错误参数不会改变任何平台", () => {
  for (const startupSearch of ["", "?webgl2-unavailable", "?acceptanceFault=complete-game"])
    assert.doesNotThrow(() => controller(undefined, { startupSearch }).beforeRendererStart());
  const faults = controller(undefined, {
    startupSearch: "?acceptanceFault=webgl2-unavailable&acceptanceFault=webgl2-unavailable",
  });
  assert.equal(faults.snapshot().rendererStartup, true);
  assert.throws(() => faults.beforeRendererStart(), /WebGL2/);
  assert.equal(faults.snapshot().rendererStartup, false);
  assert.doesNotThrow(() => faults.beforeRendererStart());
});

test("解除和停用恢复端口透传；快照不暴露可改写的故障状态，未知键不能被配置", () => {
  const storage = new MemoryStorage();
  const faults = controller(storage, { startupSearch: "?acceptanceFault=webgl2-unavailable" });
  faults.armStorage("readback", "a");
  faults.storage.setItem(SAVE_KEYS.a, "completed-write");
  faults.armFeedback("render");
  const snapshot = faults.snapshot();
  if (snapshot.storage) Object.assign(snapshot.storage, { target: "b" });
  assert.equal(faults.snapshot().storage?.target, "a");
  assert.equal(faults.armStorage("get", "unrelated" as AcceptanceStorageTarget).ok, false);
  assert.equal(faults.snapshot().storage?.target, "a");
  faults.clearArmedFaults();
  assert.equal(faults.storage.getItem(SAVE_KEYS.a), "completed-write");
  assert.doesNotThrow(() => faults.beforeRendererStart());
  assert.doesNotThrow(() => faults.beforeFeedback("render", [{ kind: "success" }]));
  faults.armStorage("set", "a");
  faults.armFeedback("audio");
  faults.dispose();
  faults.dispose();
  assert.equal(faults.snapshot().active, false);
  faults.storage.setItem(SAVE_KEYS.a, "after-dispose");
  assert.equal(faults.storage.getItem(SAVE_KEYS.a), "after-dispose");
  assert.doesNotThrow(() => faults.beforeFeedback("audio", [{ kind: "success" }]));
  assert.equal(faults.armStorage("get", "a").ok, false);
  assert.equal(faults.armFeedback("audio").ok, false);
  assert.equal(faults.requestContextLoss().ok, false);
  assert.equal(faults.requestContextRestore().ok, false);
  assert.equal(faults.blockForeground().ok, false);
});

test("上下文操作仅请求真实扩展，等浏览器报告丢失才允许恢复，保留原上下文恢复句柄", () => {
  let lost = false;
  let lossRequests = 0;
  let restoreRequests = 0;
  const extension = {
    loseContext() {
      lossRequests += 1;
    },
    restoreContext() {
      restoreRequests += 1;
    },
  };
  const context: AcceptanceWebGLContext = {
    getExtension(name) {
      assert.equal(name, "WEBGL_lose_context");
      return extension;
    },
    isContextLost: () => lost,
  };
  let rendererContext: AcceptanceWebGLContext | null = context;
  const faults = controller(undefined, { getContext: () => rendererContext });
  assert.equal(faults.requestContextRestore().ok, false);
  assert.equal(faults.requestContextLoss().ok, true);
  assert.equal(lossRequests, 1);
  assert.equal(lost, false);
  assert.equal(faults.requestContextRestore().ok, false);
  assert.equal(restoreRequests, 0);
  // This transition represents the browser's asynchronous context-loss report.
  lost = true;
  rendererContext = null;
  faults.clearArmedFaults();
  assert.equal(faults.requestContextRestore().ok, true);
  assert.equal(restoreRequests, 1);
  assert.equal(lost, true);
  assert.equal(faults.requestContextRestore().ok, false);
  assert.equal(restoreRequests, 1);
  lost = false;
  assert.equal(faults.requestContextRestore().ok, false);
});

test("没有 WebGL 扩展或浏览器拒绝请求时明确失败，不生成替代图形事件", () => {
  const cases: (() => AcceptanceWebGLContext | null)[] = [
    () => null,
    () => ({ isContextLost: () => false, getExtension: () => null }),
    () => {
      throw new Error("Browser refused context access");
    },
    () => ({
      isContextLost: () => false,
      getExtension: () => ({
        loseContext: () => {
          throw new Error("Browser refused loss");
        },
        restoreContext: () => assert.fail("loss never happened"),
      }),
    }),
  ];
  for (const getContext of cases) {
    const faults = controller(undefined, { getContext });
    assert.equal(faults.requestContextLoss().ok, false);
    assert.equal(faults.requestContextRestore().ok, false);
    assert.equal(faults.snapshot().records.length, 2);
  }
});

test("T12 只在前台执行真实 300ms 阻塞；现有有效时钟在下一次正常推进时冻结为 clockGap", () => {
  const background = controller(undefined, { isForeground: () => false });
  assert.equal(background.blockForeground().ok, false);
  const faults = controller();
  const before = createClock(performance.now(), { realtime: true });
  const frozen = structuredClone(before);
  const result = faults.blockForeground();
  assert.equal(result.ok, true);
  assert.ok(result.elapsedMs !== undefined && result.elapsedMs >= 300);
  assert.deepEqual(before, frozen);
  const advanced = advanceClock(before, performance.now());
  assert.equal(advanced.activeDeltaMs, 0);
  assert.equal(advanced.state.activeTimeMs, 0);
  assert.deepEqual(advanced.state.pauseReasons, ["clockGap"]);
  assert.equal(advanced.clearInputs, true);
});
