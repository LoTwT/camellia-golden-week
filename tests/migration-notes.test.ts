import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assembleContent, migrationContentReleases } from "../src/content/assemble.ts";
import { frozenContentRelease } from "../src/content/history/frozen-releases.ts";
import { createGame } from "../src/core/engine.ts";
import { publishedProfileMigrations } from "../src/platform/migrations.ts";
import { stablePayload, validatePayload } from "../src/platform/save-payload.ts";
import { createSaveStore, SAVE_KEYS } from "../src/platform/save-store.ts";
import { saveUpgradeSummary } from "../src/platform/upgrade-summary.ts";

const content = assembleContent("M5");
const registry = publishedProfileMigrations(migrationContentReleases("M5"));
const validate = (payload: unknown) => validatePayload(payload, content, registry);
const savedAt = "2026-09-13T12:00:00.000Z";

function oldCompletedVisit() {
  const envelope = JSON.parse(
    readFileSync(
      new URL(
        "./fixtures/historical/controls-readability/v1-full-collection-migration-save.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const historical = frozenContentRelease("M5", envelope.payload.ruleVersion);
  const room = historical.rooms.find((candidate) => candidate.id === "c.theft.01")!;
  envelope.payload.room = {
    roomId: room.id,
    status: "completedVisit",
    returnAnchor: {
      space: "world",
      areaId: room.areaId,
      boardId: room.areaId,
      tileId: room.returnTileId,
    },
  };
  envelope.payload.playerPosition = {
    space: "room",
    areaId: room.areaId,
    boardId: room.boardId,
    tileId: room.entryTileId,
  };
  const source = validatePayload(envelope.payload, historical, registry);
  assert.ok(source.ok, source.ok ? "" : source.error);
  return envelope;
}

for (const entry of ["continue", "import", "backup"] as const) {
  test(`R1 ${entry} preserves real migration reasons for an old completed visit before replacement`, () => {
    const envelope = oldCompletedVisit();
    const raw = JSON.stringify(envelope);
    const expected = validate(envelope.payload);
    assert.ok(expected.ok, expected.ok ? "" : expected.error);
    const values = new Map([[SAVE_KEYS.a as string, raw]]);
    if (entry === "backup")
      values.set(
        SAVE_KEYS.b,
        JSON.stringify({ saveGeneration: envelope.saveGeneration + 1, savedAt, payload: {} }),
      );
    const before = new Map(values);
    let writes = 0;
    const store = createSaveStore(
      {
        getItem: (key) => values.get(key) ?? null,
        setItem: () => {
          writes += 1;
          throw new Error("read-only probe");
        },
      },
      validate,
      () => true,
    );
    const inspection = store.inspect();
    const selected =
      entry === "import"
        ? store.prepareImport(raw)
        : entry === "backup"
          ? inspection.backup
          : inspection.latest;
    assert.ok(selected && ("ok" in selected ? selected.ok : selected.status === "valid"));
    assert.ok("payload" in selected && selected.payload);
    assert.deepEqual(selected.migrationNotes, expected.migrationNotes);
    assert.equal(selected.migrationRequired, true);
    assert.equal(selected.payload.room, null);
    assert.equal(selected.payload.playerPosition.tileId, "c.t.-2.-2");
    const summary = saveUpgradeSummary(
      envelope.payload,
      selected.payload,
      content,
      selected.migrationNotes,
    );
    assert.match(summary, /旧布局无法映射，已回到安全入口/);
    assert.match(summary, /旧完成布局已归档/);
    assert.match(summary, /已完成目标与物资保留/);
    assert.match(summary, /可主动重新体验/);
    assert.equal(writes, 0, "previewing migration must not write storage");
    assert.deepEqual(values, before);
    const write = store.write(selected.payload, {
      expected: inspection,
      intent: entry === "continue" ? "migration" : entry === "backup" ? "restoreBackup" : "import",
      confirmedReplacement: entry !== "continue",
      migrationRequired: true,
      savedAt,
    });
    assert.equal(write.ok, false);
    assert.deepEqual(values, before, "failed persistence must preserve the original bytes");
    const retry = entry === "import" ? store.prepareImport(raw) : store.inspect().slots.a;
    assert.ok("migrationNotes" in retry);
    assert.deepEqual(retry.migrationNotes, expected.migrationNotes);
  });
}

test("current saves and already migrated payloads do not repeat migration explanations", () => {
  const legacy = oldCompletedVisit();
  const upgraded = validate(legacy.payload);
  assert.ok(upgraded.ok, upgraded.ok ? "" : upgraded.error);
  for (const payload of [stablePayload(createGame(content)), upgraded.value]) {
    const raw = JSON.stringify({ saveGeneration: 1, savedAt, payload });
    const store = createSaveStore(
      { getItem: (key) => (key === SAVE_KEYS.a ? raw : null), setItem() {} },
      validate,
      () => true,
    );
    const slot = store.inspect().latest!;
    const imported = store.prepareImport(raw);
    assert.ok(imported.ok);
    for (const candidate of [slot, imported]) {
      assert.equal(candidate.migrationRequired, false);
      assert.deepEqual(candidate.migrationNotes, []);
      assert.equal(saveUpgradeSummary(payload, payload, content, candidate.migrationNotes), "");
    }
  }
});
