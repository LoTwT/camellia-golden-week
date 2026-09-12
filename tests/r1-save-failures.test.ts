import assert from "node:assert/strict";
import test from "node:test";
import { createSaveStore, SAVE_KEYS } from "../src/platform/save-store.ts";
import type { PayloadValidator, SaveStorage } from "../src/platform/save-store.ts";

const savedAt = "2026-09-12T10:00:00.000Z";
const validate: PayloadValidator<{ version: number; progress: number }> = (raw) => {
  const value = raw as { version: number; progress: number };
  return { ok: true, value: { ...value, version: 4 }, migrated: value.version === 3 };
};
const original = (generation: number) =>
  JSON.stringify({
    saveGeneration: generation,
    savedAt,
    payload: { version: 3, progress: generation },
  });

for (const fault of ["backup", "write", "readback", "readThrow", "validation"] as const) {
  test(`R1 P03/P07/P09 migration ${fault} preserves the documented failure phase`, () => {
    const values = new Map<string, string>([
      [SAVE_KEYS.a, original(3)],
      [SAVE_KEYS.b, original(2)],
    ]);
    const before = new Map(values);
    let written = false;
    let failedRead = false;
    const storage: SaveStorage = {
      getItem(key) {
        if (
          written &&
          key === SAVE_KEYS.b &&
          !failedRead &&
          (fault === "readback" || fault === "readThrow")
        ) {
          failedRead = true;
          if (fault === "readThrow") throw new Error("read failed");
          return "{bad read";
        }
        return values.get(key) ?? null;
      },
      setItem(key, value) {
        if (
          (fault === "backup" && key === SAVE_KEYS.preMigration) ||
          (fault === "write" && key === SAVE_KEYS.b)
        )
          throw new Error("quota");
        values.set(key, value);
        if (key === SAVE_KEYS.b) written = true;
      },
    };
    const validator: typeof validate = (raw) => {
      if (fault === "validation" && written && (raw as { version: number }).version === 4)
        return { ok: false, kind: "invalid", error: "injected post-write validation failure" };
      return validate(raw);
    };
    const store = createSaveStore(storage, validator, () => true);
    const expected = store.inspect();
    const result = store.write(
      { version: 4, progress: 3 },
      { expected, intent: "migration", savedAt },
    );
    assert.ok(!result.ok);
    assert.equal(
      result.phase,
      fault === "backup" ? "beforeWrite" : fault === "write" ? "writeRejected" : "afterWrite",
    );
    assert.equal(result.migrationBackupVerified, fault !== "backup");
    assert.equal(values.get(SAVE_KEYS.a), before.get(SAVE_KEYS.a));
    if (fault === "backup" || fault === "write")
      assert.equal(values.get(SAVE_KEYS.b), before.get(SAVE_KEYS.b));
    else assert.notEqual(values.get(SAVE_KEYS.b), before.get(SAVE_KEYS.b));
    if (fault !== "backup") {
      const backup = JSON.parse(values.get(SAVE_KEYS.preMigration)!);
      assert.deepEqual(backup.saves, { a: before.get(SAVE_KEYS.a), b: before.get(SAVE_KEYS.b) });
    }
  });
}

test("R1 migration import retry after readback failure retains verified originals across store recreation", () => {
  const values = new Map<string, string>([
    [SAVE_KEYS.a, original(3)],
    [SAVE_KEYS.b, original(2)],
  ]);
  let inject = true;
  let written = false;
  const storage: SaveStorage = {
    getItem(key) {
      if (inject && written && key === SAVE_KEYS.b) {
        inject = false;
        return "{bad";
      }
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
      if (key === SAVE_KEYS.b) written = true;
    },
  };
  const store = createSaveStore(storage, validate, () => true);
  const result = store.write(
    { version: 4, progress: 3 },
    { expected: store.inspect(), intent: "migration", savedAt },
  );
  assert.ok(!result.ok && result.phase === "afterWrite");
  const backupRaw = values.get(SAVE_KEYS.preMigration);
  const corruptBackup = JSON.parse(backupRaw!);
  corruptBackup.saves.a += "corruption";
  values.set(SAVE_KEYS.preMigration, JSON.stringify(corruptBackup));
  const aBeforeRetry = values.get(SAVE_KEYS.a);
  const bBeforeRetry = values.get(SAVE_KEYS.b);
  const damagedStore = createSaveStore(storage, validate, () => true);
  const damagedRetry = damagedStore.write(
    { version: 4, progress: 3 },
    {
      expected: damagedStore.inspect(),
      intent: "import",
      confirmedReplacement: true,
      migrationRequired: true,
      savedAt,
    },
  );
  assert.ok(
    !damagedRetry.ok &&
      damagedRetry.code === "backupFailed" &&
      damagedRetry.phase === "beforeWrite",
  );
  assert.equal(values.get(SAVE_KEYS.a), aBeforeRetry);
  assert.equal(values.get(SAVE_KEYS.b), bBeforeRetry);
  values.set(SAVE_KEYS.preMigration, backupRaw!);
  const freshStore = createSaveStore(storage, validate, () => true);
  const retry = freshStore.write(
    { version: 4, progress: 3 },
    {
      expected: freshStore.inspect(),
      intent: "import",
      confirmedReplacement: true,
      migrationRequired: true,
      savedAt,
    },
  );
  assert.ok(retry.ok);
  assert.equal(retry.envelope.saveGeneration, 5);
  assert.equal(values.get(SAVE_KEYS.preMigration), backupRaw);
});
