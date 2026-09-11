import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  createSaveStore,
  MAX_IMPORT_BYTES,
  SAVE_KEYS,
  saveRawSha256,
} from "../src/platform/save-store.ts";
import type { PayloadValidation, SaveEnvelope, SaveStorage } from "../src/platform/save-store.ts";
import { createSessionLock, SAVE_WRITER_LOCK_NAME } from "../src/platform/session-lock.ts";
import type { SessionLockManager } from "../src/platform/session-lock.ts";

interface TestPayload {
  readonly gameId: "camellia-golden-week";
  readonly version: number;
  readonly progress: number;
  readonly memo?: string;
}

const savedAt = "2026-09-11T08:00:00.000Z";

function payload(progress = 0, version = 2): TestPayload {
  return { gameId: "camellia-golden-week", version, progress };
}

function validate(input: unknown): PayloadValidation<TestPayload> {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    return { ok: false, error: "需要存档对象。", kind: "invalid" };
  const value = input as Record<string, unknown>;
  if (value.gameId !== "camellia-golden-week")
    return { ok: false, error: "错误项目。", kind: "invalid" };
  if (typeof value.version === "number" && value.version > 2)
    return { ok: false, error: "较新内容版本。", kind: "future" };
  if (
    (value.version !== 1 && value.version !== 2) ||
    typeof value.progress !== "number" ||
    !Number.isSafeInteger(value.progress) ||
    value.progress < 0 ||
    Object.keys(value).some((key) => !["gameId", "version", "progress", "memo"].includes(key)) ||
    (value.memo !== undefined && typeof value.memo !== "string")
  )
    return { ok: false, error: "非法存档字段。", kind: "invalid" };
  return {
    ok: true,
    value: {
      gameId: "camellia-golden-week",
      version: 2,
      progress: value.progress,
      ...(typeof value.memo === "string" ? { memo: value.memo } : {}),
    },
    migrated: value.version === 1,
  };
}

function envelope(generation: number, value: unknown, time = savedAt): string {
  return JSON.stringify({ saveGeneration: generation, savedAt: time, payload: value });
}

class MemoryStorage implements SaveStorage {
  readonly values = new Map<string, string>();
  readonly writes: { key: string; value: string }[] = [];
  readonly failReadKeys = new Set<string>();
  readonly failWriteKeys = new Set<string>();
  corruptWriteKey: string | null = null;
  afterWrite: ((key: string) => void) | null = null;

  getItem(key: string): string | null {
    if (this.failReadKeys.has(key)) throw new Error("SecurityError");
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failWriteKeys.has(key)) throw new Error("QuotaExceededError");
    this.writes.push({ key, value });
    this.values.set(key, this.corruptWriteKey === key ? "{truncated" : value);
    this.afterWrite?.(key);
  }
}

test("P01 双槽交替写入完整快照，回读成功后才返回已保存，始终保留上一有效槽", () => {
  const storage = new MemoryStorage();
  const store = createSaveStore(storage, validate, () => true);
  let inspection = store.inspect();
  assert.equal(inspection.status, "empty");
  for (let progress = 1; progress <= 4; progress += 1) {
    const previousRaw = inspection.latest?.raw;
    const result = store.write(payload(progress), {
      expected: inspection,
      intent: "auto",
      savedAt,
    });
    assert.ok(result.ok);
    assert.equal(result.envelope.saveGeneration, progress);
    assert.equal(result.slot, progress % 2 === 1 ? "a" : "b");
    if (previousRaw) assert.equal(result.inspection.backup?.raw, previousRaw);
    inspection = result.inspection;
  }
  assert.equal(inspection.latest?.payload?.progress, 4);
  assert.equal(inspection.backup?.payload?.progress, 3);
  assert.equal(storage.writes.length, 4);
});

test("P03 setItem 抛错或回读不匹配都不标为已保存，上一有效原槽仍可导出", () => {
  for (const fault of ["write", "readback"] as const) {
    const storage = new MemoryStorage();
    const original = envelope(5, payload(5));
    storage.values.set(SAVE_KEYS.a, original);
    if (fault === "write") storage.failWriteKeys.add(SAVE_KEYS.b);
    else storage.corruptWriteKey = SAVE_KEYS.b;
    const store = createSaveStore(storage, validate, () => true);
    const expected = store.inspect();
    const memory = Object.freeze(payload(6));
    const result = store.write(memory, { expected, intent: "auto", savedAt });
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.code === (fault === "write" ? "writeFailed" : "readbackFailed"));
    assert.equal(storage.getItem(SAVE_KEYS.a), original);
    assert.equal(memory.progress, 6);
    assert.equal(store.exportRaw(store.inspect()).a, original);
  }
});

test("P03 写后读取抛错也保留上一槽，恢复能力后重读发现已写入槽，不重复奖励事务", () => {
  const storage = new MemoryStorage();
  const original = envelope(5, payload(5));
  storage.values.set(SAVE_KEYS.a, original);
  storage.afterWrite = (key) => storage.failReadKeys.add(key);
  const store = createSaveStore(storage, validate, () => true);
  const result = store.write(payload(6), { expected: store.inspect(), intent: "auto", savedAt });
  assert.ok(!result.ok && result.code === "readbackFailed");
  assert.equal(storage.values.get(SAVE_KEYS.a), original);
  storage.failReadKeys.clear();
  storage.afterWrite = null;
  assert.equal(store.inspect().latest?.payload?.progress, 6);
  assert.equal(store.inspect().maxGeneration, 6);
});

test("P04 以代数而非槽名、日期选择；坏 JSON 不等于空档，有效备份须明确恢复", () => {
  const storage = new MemoryStorage();
  storage.values.set(SAVE_KEYS.a, envelope(8, payload(8), "2001-01-01T00:00:00Z"));
  storage.values.set(SAVE_KEYS.b, envelope(7, payload(7), "2099-01-01T00:00:00Z"));
  const store = createSaveStore(storage, validate, () => true);
  assert.equal(store.inspect().latest?.payload?.progress, 8);
  storage.values.set(SAVE_KEYS.b, "{broken-json");
  const damaged = store.inspect();
  assert.equal(damaged.status, "recovery");
  assert.equal(damaged.backup?.payload?.progress, 8);
  const forbidden = store.write(payload(8), { expected: damaged, intent: "auto", savedAt });
  assert.ok(!forbidden.ok && forbidden.code === "recoveryRequired");
  const restored = store.write(payload(8), {
    expected: damaged,
    intent: "restoreBackup",
    confirmedReplacement: true,
    savedAt,
  });
  assert.ok(restored.ok);
  assert.equal(restored.slot, "b");
  assert.equal(restored.envelope.saveGeneration, 9);
  assert.equal(restored.inspection.status, "ready");
});

test("P04 最新可解析代数的载荷损坏或时间字段损坏，不静默跳到旧槽", () => {
  const storage = new MemoryStorage();
  storage.values.set(SAVE_KEYS.a, envelope(40, { ...payload(), progress: -1 }));
  storage.values.set(SAVE_KEYS.b, envelope(30, payload(30)));
  const store = createSaveStore(storage, validate, () => true);
  assert.equal(store.inspect().status, "recovery");
  assert.equal(store.inspect().maxGeneration, 40);
  storage.values.set(SAVE_KEYS.a, envelope(50, payload(50), "broken-date"));
  const damaged = store.inspect();
  assert.equal(damaged.status, "recovery");
  assert.equal(damaged.maxGeneration, 50);
  const result = store.write(payload(30), {
    expected: damaged,
    intent: "restoreBackup",
    confirmedReplacement: true,
    savedAt,
  });
  assert.ok(result.ok);
  assert.equal(result.envelope.saveGeneration, 51);
});

test("P04 同代数不同载荷冲突停止自动载入；同载荷仅字段顺序和日期不同不冲突", () => {
  const storage = new MemoryStorage();
  storage.values.set(SAVE_KEYS.a, envelope(10, payload(10)));
  storage.values.set(SAVE_KEYS.b, envelope(10, payload(11)));
  const store = createSaveStore(storage, validate, () => true);
  assert.equal(store.inspect().status, "conflict");
  assert.deepEqual(store.exportRaw(store.inspect()), {
    a: storage.values.get(SAVE_KEYS.a),
    b: storage.values.get(SAVE_KEYS.b),
  });
  storage.values.set(
    SAVE_KEYS.b,
    envelope(
      10,
      { progress: 10, version: 2, gameId: "camellia-golden-week" },
      "2001-01-01T00:00:00Z",
    ),
  );
  assert.equal(store.inspect().status, "ready");
});

test("P05 最新较新版本与旧兼容槽并存，任何保存、导入、新游戏或备份恢复均保护原槽", () => {
  const storage = new MemoryStorage();
  storage.values.set(SAVE_KEYS.a, envelope(20, payload(20, 3)));
  storage.values.set(SAVE_KEYS.b, envelope(19, payload(19)));
  const store = createSaveStore(storage, validate, () => true);
  const original = store.exportRaw(store.inspect());
  for (const intent of [
    "auto",
    "retry",
    "newGame",
    "import",
    "restoreBackup",
    "migration",
  ] as const) {
    const result = store.write(payload(), {
      expected: store.inspect(),
      intent,
      confirmedReplacement: true,
      savedAt,
    });
    assert.ok(!result.ok && result.code === "futureProtected");
  }
  assert.equal(storage.writes.length, 0);
  assert.deepEqual(store.exportRaw(store.inspect()), original);
});

test("P06 导入先大小、JSON、项目与语义校验；预览和失败均不写存储，脚本作为数据被拒", () => {
  const storage = new MemoryStorage();
  storage.values.set(SAVE_KEYS.a, envelope(5, payload(5)));
  const store = createSaveStore(storage, validate, () => true);
  for (const raw of [
    " ".repeat(MAX_IMPORT_BYTES + 1),
    "{broken",
    envelope(1, { ...payload(), gameId: "other-game" }),
    envelope(1, { ...payload(), progress: -1 }),
    envelope(1, { ...payload(), script: "globalThis.progress = 999" }),
    envelope(1, payload(1, 3)),
  ])
    assert.equal(store.prepareImport(raw).ok, false);
  const prepared = store.prepareImport(envelope(5000, payload(90)));
  assert.ok(prepared.ok);
  assert.equal(prepared.payload.progress, 90);
  assert.equal(storage.writes.length, 0);
  const blocked = store.write(prepared.payload, {
    expected: store.inspect(),
    intent: "import",
    savedAt,
  });
  assert.ok(!blocked.ok && blocked.code === "confirmationRequired");
  assert.equal(store.inspect().latest?.payload?.progress, 5);
});

test("P06 单槽预算按 UTF-8 字节计算；导入虽低于 1 MiB 但迁移后超过 512 KiB 仍拒绝", () => {
  const storage = new MemoryStorage();
  const store = createSaveStore(storage, validate, () => true);
  const oversized = { ...payload(), memo: "中".repeat(180000) };
  const raw = envelope(1, oversized);
  assert.ok(raw.length < 512 * 1024);
  assert.ok(new TextEncoder().encode(raw).byteLength > 512 * 1024);
  assert.ok(new TextEncoder().encode(raw).byteLength < MAX_IMPORT_BYTES);
  const prepared = store.prepareImport(raw);
  assert.ok(!prepared.ok && prepared.code === "tooLarge");
  const result = store.write(oversized, { expected: store.inspect(), intent: "auto", savedAt });
  assert.ok(!result.ok && result.code === "tooLarge");
  assert.equal(storage.writes.length, 0);
});

test("P07 迁移先以单键保存两槽完整原文并回读；普通保存不覆盖迁移备份", () => {
  const storage = new MemoryStorage();
  const originals = { a: envelope(12, payload(12, 1)), b: envelope(11, payload(11, 1)) };
  storage.values.set(SAVE_KEYS.a, originals.a);
  storage.values.set(SAVE_KEYS.b, originals.b);
  const store = createSaveStore(storage, validate, () => true);
  const inspection = store.inspect();
  assert.equal(inspection.latest?.migrationRequired, true);
  const forbidden = store.write(payload(12), { expected: inspection, intent: "auto", savedAt });
  assert.ok(!forbidden.ok && forbidden.code === "migrationRequired");
  const result = store.write(payload(12), { expected: inspection, intent: "migration", savedAt });
  assert.ok(result.ok);
  assert.equal(storage.writes[0]?.key, SAVE_KEYS.preMigration);
  assert.equal(storage.writes[1]?.key, SAVE_KEYS.b);
  const backupRaw = storage.getItem(SAVE_KEYS.preMigration);
  assert.ok(backupRaw);
  assert.deepEqual((JSON.parse(backupRaw) as { saves: unknown }).saves, originals);
  assert.equal(result.inspection.latest?.migrationRequired, false);
  const next = store.write(payload(13), { expected: result.inspection, intent: "auto", savedAt });
  assert.ok(next.ok);
  assert.equal(storage.getItem(SAVE_KEYS.preMigration), backupRaw);
});

test("P09 迁移备份写不下或回读不匹配时停止，两个原槽逐字保持", () => {
  for (const fault of ["write", "readback"]) {
    const storage = new MemoryStorage();
    storage.values.set(SAVE_KEYS.a, envelope(12, payload(12, 1)));
    storage.values.set(SAVE_KEYS.b, envelope(11, payload(11, 1)));
    if (fault === "write") storage.failWriteKeys.add(SAVE_KEYS.preMigration);
    else storage.corruptWriteKey = SAVE_KEYS.preMigration;
    const store = createSaveStore(storage, validate, () => true);
    const expected = store.inspect();
    const originals = store.exportRaw(expected);
    const result = store.write(payload(12), { expected, intent: "migration", savedAt });
    assert.ok(!result.ok && result.code === "backupFailed");
    assert.deepEqual(store.exportRaw(store.inspect()), originals);
  }
});

test("P09 不可读不等于无档；临时模式不写原槽，仍可导出内存快照", () => {
  const storage = new MemoryStorage();
  storage.failReadKeys.add(SAVE_KEYS.a);
  const store = createSaveStore(storage, validate, () => true);
  assert.equal(store.inspect().status, "unavailable");
  const denied = store.write(payload(), { expected: store.inspect(), intent: "newGame", savedAt });
  assert.ok(!denied.ok && denied.code === "storageUnavailable");
  const temporary = createSaveStore(storage, validate, () => false);
  const exported = temporary.exportMemory(payload(90), savedAt);
  assert.ok(exported.ok);
  assert.equal((JSON.parse(exported.raw) as SaveEnvelope<TestPayload>).payload.progress, 90);
  const result = temporary.write(payload(90), {
    expected: temporary.inspect(),
    intent: "auto",
    savedAt,
  });
  assert.ok(!result.ok && result.code === "notWriter");
  assert.equal(storage.writes.length, 0);
});

test("P10 写前重新读取，代数变化或同代数原文变化均拒绝过期快照", () => {
  for (const generation of [6, 5]) {
    const storage = new MemoryStorage();
    storage.values.set(SAVE_KEYS.a, envelope(5, payload(5)));
    const store = createSaveStore(storage, validate, () => true);
    const expected = store.inspect();
    const foreign = envelope(generation, payload(100));
    storage.values.set(SAVE_KEYS.a, foreign);
    const result = store.write(payload(6), { expected, intent: "auto", savedAt });
    assert.ok(!result.ok && result.code === "generationConflict");
    assert.equal(storage.getItem(SAVE_KEYS.a), foreign);
    assert.equal(storage.writes.length, 0);
  }
});

test("P10 保存最后一步再次核对会话锁，已释放的会话无法写入", () => {
  const storage = new MemoryStorage();
  let checks = 0;
  const store = createSaveStore(storage, validate, () => ++checks === 1);
  const result = store.write(payload(), { expected: store.inspect(), intent: "auto", savedAt });
  assert.ok(!result.ok && result.code === "notWriter");
  assert.equal(storage.writes.length, 0);
});

test("P11 新游戏和导入都延续本地最大代数，旧高代数不能复活，原有效槽保留", () => {
  for (const intent of ["newGame", "import"] as const) {
    const storage = new MemoryStorage();
    const original = envelope(80, payload(80));
    storage.values.set(SAVE_KEYS.b, original);
    storage.values.set(SAVE_KEYS.a, envelope(79, payload(79)));
    const store = createSaveStore(storage, validate, () => true);
    const result = store.write(payload(), {
      expected: store.inspect(),
      intent,
      confirmedReplacement: true,
      savedAt,
    });
    assert.ok(result.ok);
    assert.equal(result.envelope.saveGeneration, 81);
    assert.equal(store.inspect().latest?.payload?.progress, 0);
    assert.equal(storage.getItem(SAVE_KEYS.b), original);
  }
});

test("P11 两槽都坏时新游戏须明确确认；保留原文的确认摘要跨刷新有效", () => {
  const storage = new MemoryStorage();
  storage.values.set(SAVE_KEYS.a, "{broken-a");
  storage.values.set(SAVE_KEYS.b, "{broken-b");
  const store = createSaveStore(storage, validate, () => true);
  assert.equal(store.inspect().status, "corrupt");
  const denied = store.write(payload(), { expected: store.inspect(), intent: "newGame", savedAt });
  assert.ok(!denied.ok && denied.code === "confirmationRequired");
  const result = store.write(payload(), {
    expected: store.inspect(),
    intent: "newGame",
    confirmedReplacement: true,
    savedAt,
  });
  assert.ok(result.ok);
  assert.equal(result.inspection.status, "ready");
  assert.equal(storage.getItem(SAVE_KEYS.b), "{broken-b");
  assert.equal(createSaveStore(storage, validate, () => true).inspect().status, "ready");
  storage.values.set(SAVE_KEYS.b, "{different-corrupt-raw");
  assert.equal(store.inspect().status, "recovery");
});

test("损坏原文的 SHA-256 与 Node 原生实现一致，覆盖中文、多块与尾部边界", () => {
  for (const raw of [
    "",
    "abc",
    "坏档电视",
    "x".repeat(55),
    "x".repeat(56),
    "x".repeat(64),
    "数据".repeat(1000),
  ]) {
    assert.equal(saveRawSha256(raw), createHash("sha256").update(raw).digest("hex"));
  }
});

test("代数安全整数耗尽、循环 JSON 与校验器异常均失败且不写槽", () => {
  const storage = new MemoryStorage();
  storage.values.set(SAVE_KEYS.a, envelope(Number.MAX_SAFE_INTEGER, payload()));
  const store = createSaveStore(storage, validate, () => true);
  const exhausted = store.write(payload(), { expected: store.inspect(), intent: "auto", savedAt });
  assert.ok(!exhausted.ok && exhausted.code === "generationExhausted");
  const brokenValidator = createSaveStore(
    storage,
    () => {
      throw new Error("Internal details should not be shown");
    },
    () => true,
  );
  assert.equal(brokenValidator.inspect().status, "corrupt");
  const cycle: { self?: unknown } = {};
  cycle.self = cycle;
  const cyclicStore = createSaveStore(
    new MemoryStorage(),
    () => ({ ok: true, value: cycle }),
    () => true,
  );
  assert.equal(cyclicStore.exportMemory(cycle, savedAt).ok, false);
  assert.equal(storage.writes.length, 0);
});

class FakeLockManager implements SessionLockManager {
  held = false;
  requests: { name: string; ifAvailable: boolean; mode: string }[] = [];

  async request(
    name: string,
    options: { readonly mode: "exclusive"; readonly ifAvailable: true },
    callback: (lock: unknown | null) => Promise<void>,
  ): Promise<void> {
    this.requests.push({ name, ...options });
    if (this.held) {
      await callback(null);
      return;
    }
    this.held = true;
    try {
      await callback({ name });
    } finally {
      this.held = false;
    }
  }
}

test("P10 Web Locks 同源会话只一位持锁者；第二窗口不排队抢占，释放后显式重试可获取", async () => {
  const manager = new FakeLockManager();
  const first = createSessionLock(manager);
  const second = createSessionLock(manager);
  assert.equal(await first.acquire(), "acquired");
  assert.equal(first.isHeld(), true);
  assert.equal(await second.acquire(), "busy");
  assert.equal(second.isHeld(), false);
  assert.ok(
    manager.requests.every(
      (request) =>
        request.name === SAVE_WRITER_LOCK_NAME &&
        request.ifAvailable &&
        request.mode === "exclusive",
    ),
  );
  first.release();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(first.isHeld(), false);
  assert.equal(await second.acquire(), "acquired");
  second.release();
});

test("重复获取锁复用当前会话；不支持或 API 拒绝时不会假装可写", async () => {
  const manager = new FakeLockManager();
  const lock = createSessionLock(manager);
  assert.equal(await lock.acquire(), "acquired");
  assert.equal(await lock.acquire(), "acquired");
  assert.equal(manager.requests.length, 1);
  lock.release();
  const unsupported = createSessionLock(null);
  assert.equal(await unsupported.acquire(), "unsupported");
  assert.equal(unsupported.isHeld(), false);
  const rejected = createSessionLock({
    request: async () => {
      throw new Error("SecurityError");
    },
  });
  assert.equal(await rejected.acquire(), "error");
  assert.equal(rejected.isHeld(), false);
});

test("页面在获取锁完成前离开，迟到回调立即释放，不留下后台写会话", async () => {
  let complete: (() => void) | null = null;
  const manager: SessionLockManager = {
    request: async (_name, _options, callback) => {
      await new Promise<void>((resolve) => {
        complete = resolve;
      });
      await callback({});
    },
  };
  const lock = createSessionLock(manager);
  const acquisition = lock.acquire();
  lock.release();
  assert.ok(complete);
  (complete as () => void)();
  assert.equal(await acquisition, "cancelled");
  assert.equal(lock.isHeld(), false);
});
