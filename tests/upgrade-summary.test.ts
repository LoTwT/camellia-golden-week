import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assembleContent } from "../src/content/assemble.ts";
import { areaData, gateOpen, supplyProgress } from "../src/core/progress.ts";
import type { GameContent, ProfileId } from "../src/core/types.ts";
import { additiveProfileMigrations } from "../src/platform/migrations.ts";
import { restorePayload, validatePayload } from "../src/platform/save-payload.ts";
import type { SavePayload } from "../src/platform/save-payload.ts";
import { createSaveStore, SAVE_KEYS } from "../src/platform/save-store.ts";
import type { SaveEnvelope, SaveStorage } from "../src/platform/save-store.ts";
import { contentUpgradeSummary } from "../src/platform/upgrade-summary.ts";

const releases = (["M1", "M2", "M3", "M4", "M5"] as const).map(assembleContent);
const migrations = additiveProfileMigrations(releases);
const partialExports = [
  { profileId: "M1", file: "m1-browser-save.json", supply: 26, rewardCount: 6 },
  { profileId: "M2", file: "m2-browser-save.json", supply: 51, rewardCount: 11 },
  { profileId: "M3", file: "m3-browser-save.json", supply: 81, rewardCount: 17 },
] as const;
const fullExports = [
  { profileId: "M4", file: "m4-chrome-browser-full-save.json" },
  { profileId: "M5", file: "m5-chrome-before-storage-faults-save.json" },
] as const;
const savedAt = "2026-09-11T12:00:00.000Z";

function release(profileId: ProfileId): GameContent {
  const content = releases.find((candidate) => candidate.profile.id === profileId);
  assert.ok(content);
  return content;
}

class MemoryStorage implements SaveStorage {
  readonly values: Map<string, string>;
  writes = 0;

  constructor(raw: string) {
    this.values = new Map([[SAVE_KEYS.a, raw]]);
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.writes += 1;
    this.values.set(key, value);
  }
}

function openExport(file: string, target: GameContent, entry: "continue" | "import") {
  const url = new URL(`../docs/verification/evidence/${file}`, import.meta.url);
  const originalBytes = readFileSync(url);
  const raw = originalBytes.toString("utf8");
  const originalEnvelope = JSON.parse(raw) as SaveEnvelope<unknown>;
  const storage = new MemoryStorage(raw);
  const store = createSaveStore<SavePayload>(
    storage,
    (payload) => validatePayload(payload, target, migrations),
    () => true,
  );
  const inspection = store.inspect();
  assert.equal(inspection.status, "ready");
  let envelope: SaveEnvelope<unknown>;
  let payload: SavePayload;
  let migrationRequired: boolean;
  if (entry === "continue") {
    assert.ok(inspection.latest?.envelope && inspection.latest.payload);
    ({ envelope, payload, migrationRequired } = inspection.latest);
  } else {
    const prepared = store.prepareImport(raw);
    assert.ok(prepared.ok, prepared.ok ? "" : prepared.message);
    ({ envelope, payload, migrationRequired } = prepared);
  }
  assert.deepEqual(envelope, originalEnvelope, "UI must receive the original version separately");
  assert.equal(storage.writes, 0, "inspection and import preview must not persist the upgrade");
  const beforeSummary = structuredClone(payload);
  const summary = contentUpgradeSummary(envelope.payload, payload, target);
  const state = restorePayload(payload, target, 1000);
  assert.equal(contentUpgradeSummary(envelope.payload, state, target), summary);
  assert.deepEqual(payload, beforeSummary, "the summary is read-only");
  assert.deepEqual(readFileSync(url), originalBytes);
  return {
    summary,
    state,
    payload,
    migrationRequired,
    originalPayload: originalEnvelope.payload,
    commitAndReadSummary() {
      const result = store.write(payload, {
        expected: inspection,
        intent: entry === "continue" ? "migration" : "import",
        confirmedReplacement: entry === "import",
        migrationRequired,
        savedAt,
      });
      assert.ok(result.ok, result.ok ? "" : result.message);
      const refreshed = store.inspect();
      assert.ok(refreshed.latest?.envelope && refreshed.latest.payload);
      assert.equal(refreshed.latest.migrationRequired, false);
      assert.deepEqual(refreshed.latest.payload, payload);
      assert.deepEqual(readFileSync(url), originalBytes);
      return contentUpgradeSummary(
        refreshed.latest.envelope.payload,
        refreshed.latest.payload,
        target,
      );
    },
  };
}

for (const targetId of ["M4", "M5"] as const) {
  const target = release(targetId);
  for (const source of partialExports) {
    test(`G11 真实${source.profileId}→${targetId}：继续/导入保留80数据，说明D四权限回访，保存后不重复提示`, () => {
      for (const entry of ["continue", "import"] as const) {
        const opened = openExport(source.file, target, entry);
        assert.equal(opened.migrationRequired, true);
        assert.equal(opened.payload.releaseProfileId, targetId);
        assert.equal(opened.payload.contentVersion, 4);
        assert.match(opened.summary, new RegExp(`^${targetId} 新增仓储区 A、仓储区 B回访`));
        assert.equal(opened.summary.match(/完成 D 区四处权限后开放/g)?.length, 1);
        assert.match(opened.summary, /已有首访数据与已领取物资保留/);
        assert.match(opened.summary, /仓储区 A 80 \/ 100/);
        if (source.profileId === "M1") assert.doesNotMatch(opened.summary, /仓储区 B \d/);
        else assert.match(opened.summary, /仓储区 B 80 \/ 100/);
        assert.doesNotMatch(opened.summary, /100 \/ 100/);
        assert.match(opened.summary, /按主路径提示继续推进/);
        assert.equal(gateOpen(target, opened.state, "gate.d.main"), false);
        assert.equal(areaData(target, opened.state, "a").complete, false);
        assert.equal(
          areaData(target, opened.state, "b").collected,
          source.profileId === "M1" ? 0 : 80,
        );
        assert.deepEqual(supplyProgress(target, opened.state), {
          collected: source.supply,
          total: 130,
          count: source.rewardCount,
        });
        const validatedSource = validatePayload(
          opened.originalPayload,
          release(source.profileId),
          migrations,
        );
        assert.ok(validatedSource.ok);
        assert.deepEqual(
          opened.payload.completedObjectiveIds,
          validatedSource.value.completedObjectiveIds,
        );
        assert.deepEqual(opened.payload.claimedRewardIds, validatedSource.value.claimedRewardIds);
        assert.deepEqual(opened.payload.bestResults, validatedSource.value.bestResults);
        assert.equal(
          opened.commitAndReadSummary(),
          "",
          "the saved target profile is no longer new",
        );
      }
    });
  }
}

for (const source of fullExports) {
  test(`G11 真实${source.profileId}同profile继续/导入：130完整进度不误报新增回访`, () => {
    for (const entry of ["continue", "import"] as const) {
      const target = release(source.profileId);
      const opened = openExport(source.file, target, entry);
      assert.equal(opened.migrationRequired, false);
      assert.equal(opened.summary, "");
      assert.deepEqual(supplyProgress(target, opened.state), {
        collected: 130,
        total: 130,
        count: 26,
      });
      assert.equal(areaData(target, opened.state, "a").complete, true);
      assert.equal(areaData(target, opened.state, "b").complete, true);
      assert.equal(opened.state.completedObjectiveIds.includes("warehouse.complete"), true);
    }
  });
}

test("G11 真实M4→M5仅profile升级：两种入口不把已有回访或130物资称为新增", () => {
  const target = release("M5");
  for (const entry of ["continue", "import"] as const) {
    const opened = openExport(fullExports[0].file, target, entry);
    assert.equal(opened.migrationRequired, true);
    assert.equal(opened.payload.releaseProfileId, "M5");
    assert.equal(opened.payload.contentVersion, 4);
    assert.equal(opened.summary, "");
    assert.deepEqual(supplyProgress(target, opened.state), {
      collected: 130,
      total: 130,
      count: 26,
    });
    assert.equal(opened.commitAndReadSummary(), "");
  }
});

test("G11 真实M1同profile仅schema1→2：需要迁移但没有新增回访提示", () => {
  const target = release("M1");
  for (const entry of ["continue", "import"] as const) {
    const opened = openExport(partialExports[0].file, target, entry);
    assert.equal(opened.migrationRequired, true);
    assert.equal(opened.payload.releaseProfileId, "M1");
    assert.equal(opened.payload.schemaVersion, 2);
    assert.equal(opened.summary, "");
    assert.deepEqual(supplyProgress(target, opened.state), { collected: 26, total: 26, count: 6 });
  }
});
