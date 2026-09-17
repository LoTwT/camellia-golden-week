import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { createSessionLock, SAVE_WRITER_LOCK_NAME } from "../src/platform/session-lock.ts";
import type { SessionLockManager } from "../src/platform/session-lock.ts";

class SharedLockManager implements SessionLockManager {
  owner: object | null = null;
  requests: { name: string; mode: string; ifAvailable: boolean }[] = [];

  async request(
    name: string,
    options: { readonly mode: "exclusive"; readonly ifAvailable: true },
    callback: (lock: unknown | null) => Promise<void>,
  ): Promise<void> {
    this.requests.push({ name, ...options });
    await Promise.resolve();
    if (this.owner) {
      await callback(null);
      return;
    }
    const owner = {};
    this.owner = owner;
    try {
      await callback(owner);
    } finally {
      if (this.owner === owner) this.owner = null;
    }
  }
}

test("P10 首次 busy 后仅等待 100ms 再试；旧持有者在间隔内释放后可取得会话", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const manager = new SharedLockManager();
  const previousPage = createSessionLock(manager);
  assert.equal(await previousPage.acquire(), "acquired");
  const nextPage = createSessionLock(manager);
  const outcome = nextPage.acquire();
  await setImmediate();
  assert.equal(nextPage.status(), "acquiring");
  assert.equal(nextPage.isHeld(), false);
  assert.equal(manager.requests.length, 2);

  previousPage.release();
  await setImmediate();
  context.mock.timers.tick(99);
  await setImmediate();
  assert.equal(manager.requests.length, 2);
  context.mock.timers.tick(1);
  assert.equal(await outcome, "acquired");
  assert.equal(nextPage.isHeld(), true);
  assert.equal(previousPage.isHeld(), false);
  assert.equal(manager.requests.length, 3);
  assert.deepEqual(
    manager.requests,
    Array.from({ length: 3 }, () => ({
      name: SAVE_WRITER_LOCK_NAME,
      mode: "exclusive",
      ifAvailable: true,
    })),
  );
  nextPage.release();
});

test("P10 真实另一页持续持有时只额外尝试一次，随后保持 busy 且不排队抢占", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const manager = new SharedLockManager();
  const writer = createSessionLock(manager);
  const reader = createSessionLock(manager);
  assert.equal(await writer.acquire(), "acquired");
  const outcome = reader.acquire();
  await setImmediate();
  context.mock.timers.tick(100);
  assert.equal(await outcome, "busy");
  assert.equal(reader.status(), "busy");
  assert.equal(reader.isHeld(), false);
  assert.equal(writer.isHeld(), true);
  assert.equal(manager.requests.length, 3);

  writer.release();
  await setImmediate();
  context.mock.timers.tick(10_000);
  await setImmediate();
  assert.equal(manager.requests.length, 3);
  assert.equal(reader.isHeld(), false);
  assert.equal(await reader.acquire(), "acquired");
  reader.release();
});

test("P10 延迟期间 release 立即取消，不留下定时获取或改变后续会话", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const manager = new SharedLockManager();
  manager.owner = {};
  const lock = createSessionLock(manager);
  const cancelled = lock.acquire();
  await setImmediate();
  lock.release();
  assert.equal(await cancelled, "cancelled");
  assert.equal(lock.status(), "idle");
  manager.owner = null;
  assert.equal(await lock.acquire(), "acquired");
  context.mock.timers.tick(10_000);
  await setImmediate();
  assert.equal(manager.requests.length, 2);
  assert.equal(lock.isHeld(), true);
  lock.release();
});

test("P10 隐藏页面的 AbortSignal 取消 pending；已获取后中止信号不能释放持锁会话", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const manager = new SharedLockManager();
  manager.owner = {};
  const lock = createSessionLock(manager);
  const hidden = new AbortController();
  const cancelled = lock.acquire(hidden.signal);
  await setImmediate();
  hidden.abort();
  assert.equal(await cancelled, "cancelled");
  assert.equal(lock.status(), "idle");
  manager.owner = null;
  context.mock.timers.tick(10_000);
  await setImmediate();
  assert.equal(manager.requests.length, 1);

  const visible = new AbortController();
  assert.equal(await lock.acquire(visible.signal), "acquired");
  assert.equal(getEventListeners(visible.signal, "abort").length, 0);
  visible.abort();
  assert.equal(lock.isHeld(), true);
  const otherPage = createSessionLock(manager);
  const busy = otherPage.acquire();
  await setImmediate();
  context.mock.timers.tick(100);
  assert.equal(await busy, "busy");
  assert.equal(lock.isHeld(), true);
  lock.release();
});

test("P10 并发 acquire 复用同一 pending，显式中止旧请求后新请求有自己的重试窗口", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const manager = new SharedLockManager();
  manager.owner = {};
  const lock = createSessionLock(manager);
  const controller = new AbortController();
  const concurrentController = new AbortController();
  const first = lock.acquire(controller.signal);
  const duplicate = lock.acquire(concurrentController.signal);
  assert.equal(duplicate, first);
  await setImmediate();
  context.mock.timers.tick(50);
  controller.abort();
  assert.equal(await first, "cancelled");
  assert.equal(await duplicate, "cancelled");
  assert.equal(getEventListeners(concurrentController.signal, "abort").length, 0);

  const newer = lock.acquire();
  await setImmediate();
  manager.owner = null;
  context.mock.timers.tick(50);
  await setImmediate();
  assert.equal(manager.requests.length, 2);
  assert.equal(lock.status(), "acquiring");
  context.mock.timers.tick(50);
  assert.equal(await newer, "acquired");
  assert.equal(manager.requests.length, 3);
  lock.release();
});

test("P10 未返回的旧请求被取消后，迟到的成功或拒绝均不得改变新会话", async () => {
  for (const staleResult of ["granted", "error"] as const) {
    let finishFirst: (() => void) | undefined;
    let calls = 0;
    const manager: SessionLockManager = {
      request: async (_name, _options, callback) => {
        calls += 1;
        if (calls === 1) {
          await new Promise<void>((resolve) => {
            finishFirst = resolve;
          });
          if (staleResult === "error") throw new Error("旧请求拒绝");
        }
        await callback({});
      },
    };
    const lock = createSessionLock(manager);
    const controller = new AbortController();
    const oldOutcome = lock.acquire(controller.signal);
    controller.abort();
    assert.equal(await oldOutcome, "cancelled");
    assert.equal(await lock.acquire(), "acquired");
    assert.ok(finishFirst);
    finishFirst();
    await setImmediate();
    assert.equal(lock.status(), "held", staleResult);
    assert.equal(lock.isHeld(), true, staleResult);
    lock.release();
  }
});

test("P10 已中止信号不发请求，API 拒绝不当作 busy 重试", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  const manager: SessionLockManager = {
    request: async () => {
      calls += 1;
      throw new Error("SecurityError");
    },
  };
  const lock = createSessionLock(manager);
  const controller = new AbortController();
  controller.abort();
  assert.equal(await lock.acquire(controller.signal), "cancelled");
  assert.equal(calls, 0);
  assert.equal(await lock.acquire(), "error");
  assert.equal(lock.isHeld(), false);
  context.mock.timers.tick(10_000);
  await setImmediate();
  assert.equal(calls, 1);
  assert.equal(lock.status(), "error");
});
