import assert from "node:assert/strict";
import test from "node:test";
import { assembleContent, migrationContentReleases } from "../src/content/assemble.ts";
import { worldWitnesses } from "../src/content/witnesses/index.ts";
import { createGame, dispatch } from "../src/core/engine.ts";
import { publishedProfileMigrations } from "../src/platform/migrations.ts";
import { stablePayload, validatePayload } from "../src/platform/save-payload.ts";
import type { SavePayload } from "../src/platform/save-payload.ts";
import { prepareSaveImport } from "../src/platform/save-store.ts";

const content = assembleContent("M5");
const registry = publishedProfileMigrations(migrationContentReleases(content.profile.id));
const roomEntries = new Map<string, SavePayload>();
const route = worldWitnesses.find(
  (witness) => witness.profileId === "M5" && witness.id.includes("full-collection"),
);
assert.ok(route);
let state = createGame(content, 0);
for (const step of route.steps) {
  const result = dispatch(content, state, step.command, step.atMs);
  assert.equal(result.code, step.expectedCode);
  state = result.state;
  const roomId = state.activeStatic?.roomId;
  if (roomId && /c\.(capture|theft)\./.test(roomId) && !roomEntries.has(roomId))
    roomEntries.set(roomId, stablePayload(state));
}
assert.equal(roomEntries.size, 7);

function sortedObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedObjectKeys);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortedObjectKeys(item)]),
    );
  return value;
}
function prepare(payload: unknown) {
  return prepareSaveImport(
    JSON.stringify({
      saveGeneration: 1,
      savedAt: "2026-09-13T12:00:00.000Z",
      payload,
    }),
    (raw) => validatePayload(raw, content, registry),
  );
}

for (const [roomId, payload] of roomEntries) {
  test(`${roomId}: complete save import accepts reordered object keys without changing values or array order`, () => {
    const original = prepare(payload);
    assert.ok(original.ok, original.ok ? "" : original.message);
    const sorted = sortedObjectKeys(payload);
    assert.deepEqual(sorted, payload);
    assert.notEqual(JSON.stringify(sorted), JSON.stringify(payload));
    const imported = prepare(sorted);
    assert.ok(imported.ok, imported.ok ? "" : imported.message);
    assert.deepEqual(imported.payload, original.payload);
  });

  test(`${roomId}: reordered keys do not conceal a changed reset layout`, () => {
    const changed = structuredClone(payload);
    assert.ok(changed.room && changed.room.status !== "completedVisit");
    const layout = changed.room.attemptBaseline.layout;
    const positions = layout.capture?.cartTileById ?? layout.theft?.ballTileById;
    assert.ok(positions);
    const objectId = Object.keys(positions)[0]!;
    const definition = content.staticChallenges.find((room) => room.id === roomId)!;
    const occupied = new Set(
      layout.capture
        ? [
            ...Object.values(layout.capture.cartTileById),
            ...Object.values(layout.capture.bangbooTileById),
          ]
        : [
            ...Object.values(layout.theft!.ballTileById),
            ...Object.values(layout.theft!.stationTileById),
          ],
    );
    const target = definition.tiles.find(
      (tile) =>
        tile.terrain === "floor" && !occupied.has(tile.id) && tile.id !== definition.startTileId,
    );
    assert.ok(target);
    (positions as Record<string, string>)[objectId] = target.id;
    const imported = prepare(sortedObjectKeys(changed));
    assert.ok(!imported.ok);
    assert.equal(imported.code, "invalidPayload");
    assert.match(imported.message, /重置基线不符合本版固定入口布局/);
  });

  test(`${roomId}: reordered keys retain strict layout field validation`, () => {
    const changed = structuredClone(payload);
    assert.ok(changed.room && changed.room.status !== "completedVisit");
    const layout = changed.room.attemptBaseline.layout;
    const mechanism = layout.capture ?? layout.theft;
    assert.ok(mechanism);
    Object.assign(mechanism, { unexpected: true });
    const imported = prepare(sortedObjectKeys(changed));
    assert.ok(!imported.ok);
    assert.equal(imported.code, "invalidPayload");
  });
}

test("mapped completed layouts accept equivalent object keys and still reject changed ordered paths", () => {
  const source = assembleContent("M3");
  const witness = worldWitnesses.find(
    (item) => item.profileId === "M3" && item.id.includes("full-collection"),
  );
  assert.ok(witness);
  let prior = createGame(source, 0);
  for (const step of witness.steps) {
    const result = dispatch(source, prior, step.command, step.atMs);
    assert.equal(result.code, step.expectedCode);
    prior = result.state;
  }
  const migrated = validatePayload(stablePayload(prior), content, registry);
  assert.ok(migrated.ok, migrated.ok ? "" : migrated.error);
  assert.ok(Object.values(migrated.value.completedRoomLayouts).some((record) => record.source));
  const original = prepare(migrated.value);
  assert.ok(original.ok, original.ok ? "" : original.message);
  const reordered = structuredClone(migrated.value);
  for (const record of Object.values(reordered.completedRoomLayouts))
    record.layout = sortedObjectKeys(record.layout) as typeof record.layout;
  const sorted = prepare(reordered);
  assert.ok(sorted.ok, sorted.ok ? "" : sorted.message);
  assert.deepEqual(sorted.payload, original.payload);
  const changed = structuredClone(migrated.value);
  const path = Object.values(changed.completedRoomLayouts).find(
    (record) => record.source && record.layout.visitedTileIds.length > 1,
  )?.layout.visitedTileIds;
  assert.ok(path);
  (path as string[]).reverse();
  const rejected = prepare(sortedObjectKeys(changed));
  assert.ok(!rejected.ok);
  assert.equal(rejected.code, "invalidPayload");
  assert.match(rejected.message, /完成布局缺少已登记的一一语义映射或与来源不符/);
});

test("migration accepts equivalent existing archive key order", () => {
  const source = assembleContent("M3");
  const witness = worldWitnesses.find(
    (item) => item.profileId === "M3" && item.id.includes("full-collection"),
  );
  assert.ok(witness);
  let prior = createGame(source, 0);
  for (const step of witness.steps) prior = dispatch(source, prior, step.command, step.atMs).state;
  const payload = stablePayload(prior);
  const [roomId, record] = Object.entries(payload.completedRoomLayouts)[0]!;
  payload.archivedCompletedRoomLayouts.push({
    roomId,
    contentVersion: record.contentVersion,
    ruleVersion: record.ruleVersion,
    layout: structuredClone(record.layout),
  });
  const original = prepare(payload);
  assert.ok(original.ok, original.ok ? "" : original.message);
  const archive = payload.archivedCompletedRoomLayouts[0]!;
  archive.layout = sortedObjectKeys(archive.layout) as typeof archive.layout;
  const reordered = prepare(payload);
  assert.ok(reordered.ok, reordered.ok ? "" : reordered.message);
  assert.deepEqual(reordered.payload, original.payload);
});
