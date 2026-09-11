import assert from "node:assert/strict";
import test from "node:test";
import { assembleContent } from "../src/content/assemble.ts";
import { createGame, dispatch } from "../src/core/engine.ts";
import { restorePayload, stablePayload, validatePayload } from "../src/platform/save-payload.ts";
import { createSaveStore, MAX_IMPORT_BYTES, SAVE_KEYS } from "../src/platform/save-store.ts";

const content = assembleContent("M5");
const savedAt = "2026-09-11T12:00:00.000Z";
const newPayload = () => stablePayload(createGame(content));
const envelope = (payload: unknown, generation = 1) =>
  JSON.stringify({ saveGeneration: generation, savedAt, payload });

function memoryStore() {
  const values = new Map<string, string>();
  const store = createSaveStore(
    {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
      },
    },
    (payload) => validatePayload(payload, content),
    () => true,
  );
  return { values, store };
}

for (const revision of [
  Number.MAX_SAFE_INTEGER,
  Number.MAX_SAFE_INTEGER - 1,
  Number.MAX_SAFE_INTEGER - 2,
]) {
  test(`P06 极大修订号 ${revision} 导入后可连续移动、保存、导出并恢复`, () => {
    const { store, values } = memoryStore();
    const raw = envelope({ ...newPayload(), stateRevision: revision });
    const prepared = store.prepareImport(raw);
    assert.ok(prepared.ok);
    const imported = store.write(prepared.payload, {
      expected: store.inspect(),
      intent: "import",
      confirmedReplacement: true,
      savedAt,
    });
    assert.ok(imported.ok);
    let state = restorePayload(imported.envelope.payload, content, 0);
    let now = 0;
    for (const direction of ["right", "right", "left", "right"] as const) {
      const result = dispatch(content, state, { kind: "Move", direction }, (now += 140), savedAt);
      assert.equal(result.code, "accepted");
      assert.equal(result.stable, true);
      assert.equal(result.state.stateRevision, state.stateRevision + 1);
      state = result.state;
      const saved = store.write(stablePayload(state), {
        expected: store.inspect(),
        intent: "auto",
        savedAt,
      });
      assert.ok(saved.ok, saved.ok ? "" : saved.message);
      const exported = store.exportMemory(
        stablePayload(state),
        savedAt,
        saved.envelope.saveGeneration,
      );
      assert.ok(exported.ok, exported.ok ? "" : exported.message);
      assert.ok(store.prepareImport(exported.raw).ok);
      assert.deepEqual(
        stablePayload(restorePayload(saved.envelope.payload, content, now)),
        stablePayload(state),
      );
    }
    assert.equal(store.inspect().maxGeneration, 5, "本地保存代数正常递增，与玩法修订号独立");
    assert.equal(values.size, 2);
    assert.equal(JSON.parse(raw).payload.stateRevision, revision, "不改写导入原文");
  });
}

test("P01 普通修订号恢复保留原值与全部进度", () => {
  const payload = { ...newPayload(), stateRevision: 123 };
  assert.deepEqual(stablePayload(restorePayload(payload, content, 0)), payload);
});

test("P06 画质仅接受字符串枚举，拒绝可转换为合法文字的数组且保留原槽", () => {
  const { store, values } = memoryStore();
  const original = envelope(newPayload(), 7);
  values.set(SAVE_KEYS.a, original);
  for (const quality of [["low"], [["low"]], ["standard"], null, 0, {}]) {
    const payload = newPayload();
    const malformed = { ...payload, settings: { ...payload.settings, quality } };
    const result = store.prepareImport(envelope(malformed));
    assert.ok(!result.ok && result.code === "invalidPayload", JSON.stringify(quality));
    assert.deepEqual(store.exportRaw(store.inspect()), { a: original, b: null });
  }
  for (const quality of ["low", "standard"] as const) {
    const payload = newPayload();
    payload.settings.quality = quality;
    const prepared = store.prepareImport(envelope(payload));
    assert.ok(prepared.ok);
    const state = restorePayload(prepared.payload, content, 0);
    const result = dispatch(
      content,
      state,
      { kind: "Settings", settings: { ...state.settings, muted: true } },
      140,
    );
    assert.equal(result.code, "accepted");
    assert.equal(result.state.settings.muted, true);
  }
});

test("P04 同代深层坏档保持冲突与原始导出，不使启动检查抛错", () => {
  for (const nesting of ["array", "object"] as const) {
    const { store, values } = memoryStore();
    const valid = envelope(newPayload());
    const depth = 12_000;
    const nested =
      nesting === "array"
        ? "[".repeat(depth) + "0" + "]".repeat(depth)
        : '{"child":'.repeat(depth) + "0" + "}".repeat(depth);
    const damaged = `{"saveGeneration":1,"savedAt":"${savedAt}","payload":${nested}}`;
    values.set(SAVE_KEYS.a, valid);
    values.set(SAVE_KEYS.b, damaged);
    const inspection = store.inspect();
    assert.equal(inspection.status, "conflict");
    assert.deepEqual(store.exportRaw(inspection), { a: valid, b: damaged });
    const refused = store.write(newPayload(), { expected: inspection, intent: "auto", savedAt });
    assert.ok(!refused.ok && refused.code === "recoveryRequired");
    const restored = store.write(newPayload(), {
      expected: inspection,
      intent: "restoreBackup",
      confirmedReplacement: true,
      savedAt,
    });
    assert.ok(restored.ok);
    assert.equal(restored.envelope.saveGeneration, 2);
    assert.equal(values.get(SAVE_KEYS.a), valid, "显式恢复仍保留上一有效槽");
  }
});

test("P04 两份同代深层相同坏载荷被归为损坏而非空档，比较不依赖递归栈", () => {
  const { store, values } = memoryStore();
  const nested = "[".repeat(12_000) + "0" + "]".repeat(12_000);
  const raw = `{"saveGeneration":1,"savedAt":"${savedAt}","payload":${nested}}`;
  values.set(SAVE_KEYS.a, raw);
  values.set(SAVE_KEYS.b, raw);
  assert.equal(store.inspect().status, "corrupt");
  assert.deepEqual(store.exportRaw(store.inspect()), { a: raw, b: raw });
});

test("P06 1 MiB 导入边界使用合法 JSON 与尾部空白，不能被解析失败掩盖", () => {
  const { store } = memoryStore();
  const raw = envelope(newPayload());
  const remaining = MAX_IMPORT_BYTES - new TextEncoder().encode(raw).byteLength;
  const atLimit = raw + " ".repeat(remaining);
  assert.ok(store.prepareImport(atLimit).ok);
  const oversized = store.prepareImport(atLimit + " ");
  assert.ok(!oversized.ok && oversized.code === "tooLarge");
  assert.equal(store.inspect().status, "empty");
});
