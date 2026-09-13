import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { createSessionDiagnostics } from "../src/platform/session-diagnostics.ts";
import type { SessionDiagnosticsOptions } from "../src/platform/session-diagnostics.ts";
import { createSessionLock, SAVE_WRITER_LOCK_NAME } from "../src/platform/session-lock.ts";
import { SAVE_KEYS } from "../src/platform/save-store.ts";

class DiagnosticStorage {
  readonly values = new Map<string, string>();
  readonly touched = new Set<string>();
  fail = false;
  getItem(key: string) {
    this.touched.add(key);
    if (this.fail) throw new Error("读取被拒绝");
    return this.values.get(key) ?? null;
  }
  setItem(key: string, raw: string) {
    this.touched.add(key);
    if (this.fail) throw new Error("写入被拒绝");
    this.values.set(key, raw);
  }
}
function options(storage = new DiagnosticStorage()): SessionDiagnosticsOptions {
  return {
    buildMode: "acceptance",
    storage,
    manager: undefined,
    pageId: "page-a",
    path: "/",
    timeOriginMs: 1000,
    navigationType: "navigate",
    now: () => 5,
    visibility: () => "visible",
  };
}

test("验收会话观察原样传递参数及两个 Promise，锁仍由原回调结束后释放", async () => {
  let releaseWaiting: (() => void) | undefined;
  const waiting = new Promise<void>((resolve) => {
    releaseWaiting = resolve;
  });
  let finishNative: (() => void) | undefined;
  const nativeRequest = new Promise<void>((resolve) => {
    finishNative = resolve;
  });
  const requestOptions = { mode: "exclusive", ifAvailable: true } as const;
  const lock = {};
  const diagnostics = createSessionDiagnostics({
    ...options(),
    manager: {
      request: (name, passedOptions, callback) => {
        assert.equal(name, SAVE_WRITER_LOCK_NAME);
        assert.equal(passedOptions, requestOptions);
        assert.equal(callback(lock), waiting);
        return nativeRequest;
      },
    },
  });
  assert.ok(diagnostics?.manager);
  const observed = diagnostics.manager.request(
    SAVE_WRITER_LOCK_NAME,
    requestOptions,
    (passedLock) => {
      assert.equal(passedLock, lock);
      return waiting;
    },
  );
  assert.equal(observed, nativeRequest);
  assert.deepEqual(
    diagnostics.snapshot().events.map((event) => event.kind),
    ["page-start", "request-start", "request-callback"],
  );
  diagnostics.record("release-start");
  assert.ok(releaseWaiting);
  releaseWaiting();
  await setImmediate();
  assert.equal(diagnostics.snapshot().events.at(-1)?.kind, "callback-complete");
  assert.ok(finishNative);
  finishNative();
  await observed;
  assert.equal(diagnostics.snapshot().events.at(-1)?.kind, "request-complete");
});

test("同标签导航合并原页 pagehide 与新页轨迹，BFCache 旧页后续事件不覆盖新页", () => {
  const storage = new DiagnosticStorage();
  storage.values.set(SAVE_KEYS.a, "原槽 A 字节");
  storage.values.set(SAVE_KEYS.b, "原槽 B 字节");
  const first = createSessionDiagnostics(options(storage));
  assert.ok(first);
  first.record("pagehide-start", { persisted: true });
  first.record("release-end", { session: "idle" });
  const second = createSessionDiagnostics({
    ...options(storage),
    pageId: "page-b",
    path: "/?session-check=1",
    timeOriginMs: 2000,
  });
  assert.ok(second);
  second.record("acquire-result", { outcome: "busy" });
  first.record("callback-complete", { requestId: 1 });
  const restored = createSessionDiagnostics({
    ...options(storage),
    pageId: "page-c",
    timeOriginMs: 3000,
    navigationType: "back_forward",
  });
  assert.ok(restored);
  assert.deepEqual(
    restored.snapshot().events.map((event) => [event.sequence, event.pageId, event.kind]),
    [
      [1, "page-a", "page-start"],
      [2, "page-a", "pagehide-start"],
      [3, "page-a", "release-end"],
      [4, "page-b", "page-start"],
      [5, "page-b", "acquire-result"],
      [6, "page-a", "callback-complete"],
      [7, "page-c", "page-start"],
    ],
  );
  assert.equal(storage.touched.size, 1);
  assert.ok(!storage.touched.has(SAVE_KEYS.a) && !storage.touched.has(SAVE_KEYS.b));
  assert.equal(storage.values.get(SAVE_KEYS.a), "原槽 A 字节");
  assert.equal(storage.values.get(SAVE_KEYS.b), "原槽 B 字节");
});

test("轨迹按数量和 UTF-8 字节双重限量，损坏或超大旧诊断不进入快照", () => {
  const storage = new DiagnosticStorage();
  const diagnostics = createSessionDiagnostics(options(storage));
  assert.ok(diagnostics);
  for (let index = 0; index < 100; index += 1) diagnostics.record("event", { index });
  assert.equal(diagnostics.snapshot().events.length, 80);
  assert.equal(diagnostics.snapshot().events[0]?.sequence, 22);
  assert.equal(diagnostics.snapshot().events.at(-1)?.details.index, 99);
  for (let index = 0; index < 80; index += 1)
    diagnostics.record(
      "large-detail",
      Object.fromEntries(
        Array.from({ length: 8 }, (_, field) => [`field${field}`, "界".repeat(300)]),
      ),
    );
  const key = [...storage.touched][0];
  assert.ok(key);
  assert.ok(new TextEncoder().encode(storage.values.get(key)).length <= 48 * 1024);
  assert.ok(diagnostics.snapshot().events.length < 80);
  const snapshot = diagnostics.snapshot();
  assert.ok(
    snapshot.events.every((event) =>
      Object.values(event.details).every(
        (detail) => typeof detail !== "string" || detail.length <= 160,
      ),
    ),
  );
  storage.values.set(key, " ".repeat(49 * 1024));
  const recovered = createSessionDiagnostics({ ...options(storage), pageId: "after-invalid" });
  assert.ok(recovered);
  assert.equal(recovered.snapshot().discardedStoredTraces, 1);
  assert.equal(recovered.snapshot().events.length, 1);
  storage.values.set(key, "{broken-json");
  const afterCorruption = createSessionDiagnostics(options(storage));
  assert.ok(afterCorruption);
  assert.equal(afterCorruption.snapshot().discardedStoredTraces, 1);
  assert.equal(afterCorruption.snapshot().events.length, 1);
});

test("诊断存储拒绝不会改变锁获取/释放；生产模式不读取存储或请求锁", async () => {
  const storage = new DiagnosticStorage();
  storage.fail = true;
  let held = false;
  let requests = 0;
  const native: NonNullable<SessionDiagnosticsOptions["manager"]> = {
    request: async (_name, _requestOptions, callback) => {
      requests += 1;
      held = true;
      try {
        await callback({});
      } finally {
        held = false;
      }
    },
  };
  const production = createSessionDiagnostics({
    ...options(storage),
    buildMode: "production",
    manager: native,
  });
  assert.equal(production, null);
  assert.equal(storage.touched.size, 0);
  assert.equal(requests, 0);
  const diagnostics = createSessionDiagnostics({ ...options(storage), manager: native });
  assert.ok(diagnostics);
  const session = createSessionLock(diagnostics.manager);
  assert.equal(await session.acquire(), "acquired");
  assert.equal(session.isHeld(), true);
  assert.equal(held, true);
  assert.equal(diagnostics.snapshot().storage, "unavailable");
  session.release();
  await setImmediate();
  assert.equal(held, false);
  assert.equal(requests, 1);
});

test("query 仅记录指定锁及 clientId；只读查询失败不获取/释放或传播异常", async () => {
  let requests = 0;
  let failQuery = false;
  const diagnostics = createSessionDiagnostics({
    ...options(),
    manager: {
      request: async () => {
        requests += 1;
      },
      query: async () => {
        if (failQuery) throw new Error("query denied");
        return {
          held: [
            { name: SAVE_WRITER_LOCK_NAME, mode: "exclusive", clientId: "previous-page" },
            { name: "unrelated-lock", mode: "exclusive", clientId: "unrelated-client" },
          ],
          pending: [{ name: SAVE_WRITER_LOCK_NAME, mode: "exclusive", clientId: "next-page" }],
        };
      },
    },
  });
  assert.ok(diagnostics);
  diagnostics.query("busy");
  await setImmediate();
  const queried = diagnostics.snapshot().events.at(-1);
  assert.equal(queried?.kind, "query-result");
  assert.deepEqual(queried?.locks, {
    held: [{ name: SAVE_WRITER_LOCK_NAME, mode: "exclusive", clientId: "previous-page" }],
    pending: [{ name: SAVE_WRITER_LOCK_NAME, mode: "exclusive", clientId: "next-page" }],
  });
  failQuery = true;
  diagnostics.query("acquired");
  await setImmediate();
  assert.equal(diagnostics.snapshot().events.at(-1)?.kind, "query-error");
  assert.equal(requests, 0);
});

test("原生 request 拒绝保持原 Promise 和错误，观察者不产生新的未处理拒绝", async () => {
  const failure = new Error("original rejection");
  const nativeRequest = Promise.reject(failure);
  const diagnostics = createSessionDiagnostics({
    ...options(),
    manager: { request: () => nativeRequest },
  });
  assert.ok(diagnostics?.manager);
  const result = diagnostics.manager.request(
    SAVE_WRITER_LOCK_NAME,
    { mode: "exclusive", ifAvailable: true },
    async () => {},
  );
  assert.equal(result, nativeRequest);
  await assert.rejects(result, (error) => error === failure);
  assert.equal(diagnostics.snapshot().events.at(-1)?.kind, "request-error");
});
