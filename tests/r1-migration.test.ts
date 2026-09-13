import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  frozenContentRelease,
  frozenContentReleases,
} from "../src/content/history/frozen-releases.ts";
import provenance from "../src/content/history/pre-r1/provenance.json" with { type: "json" };
import type { GameContent, ProfileId } from "../src/core/types.ts";
import {
  releaseVersion,
  publishedProfileMigrations,
  migrationMappingId,
} from "../src/platform/migrations.ts";
import type { MigrationRegistry, RoomLayoutMigration } from "../src/platform/migrations.ts";
import type { SavePayload } from "../src/platform/save-payload.ts";
import { supplyProgress } from "../src/core/progress.ts";
import { validatePayload } from "../src/platform/save-payload.ts";

const historical = frozenContentRelease("M5", 3);
const raw = JSON.parse(
  readFileSync(
    new URL(
      "../tests/fixtures/historical/controls-readability/v1-full-collection-migration-save.json",
      import.meta.url,
    ),
    "utf8",
  ),
).payload;

// Explicit synthetic destination removes retired static boards. This isolates migration
// proofs and does not claim R1 gameplay or new-map acceptance.
function fixture() {
  const target: GameContent = {
    ...structuredClone(historical),
    contentVersion: 6,
    ruleVersion: 4,
    staticChallenges: [],
    realtimeChallenges: [],
    rooms: [],
  };
  const roomLayouts: Record<string, RoomLayoutMigration> = Object.fromEntries(
    historical.staticChallenges.map((definition) => {
      const room = historical.rooms.find((candidate) => candidate.id === definition.id)!;
      const position = (tileId: string) => ({
        space: "world" as const,
        areaId: room.areaId,
        boardId: room.areaId,
        tileId,
      });
      return [
        room.id,
        {
          kind: "archive" as const,
          targetRoomId: null,
          objectiveId: room.goal,
          safeEntrance: position(room.returnTileId),
          successExit: position(room.successExitTileId),
        },
      ];
    }),
  );
  const registry: MigrationRegistry = {
    releases: [...frozenContentReleases(), target],
    steps: [
      {
        from: releaseVersion(historical),
        to: releaseVersion(target),
        kind: "mapped",
        mapping: { roomLayouts },
      },
    ],
  };
  return { target, registry, roomLayouts };
}

test("R1 baseline independently freezes all 15 published views, old rules and actual save bytes", () => {
  const releases = frozenContentReleases();
  assert.equal(releases.length, 15);
  assert.equal(
    new Set(
      releases.map(
        (release) => `${release.profile.id}:${release.contentVersion}:${release.ruleVersion}`,
      ),
    ).size,
    15,
  );
  for (const entry of provenance.files) {
    const data = readFileSync(new URL(`../${entry.frozen}`, import.meta.url));
    assert.equal(createHash("sha256").update(data).digest("hex"), entry.sha256);
  }
  for (const entry of provenance.existingSaveEvidence) {
    const data = readFileSync(new URL(`../${entry.path}`, import.meta.url));
    assert.equal(createHash("sha256").update(data).digest("hex"), entry.sha256);
    const payload = JSON.parse(data.toString()).payload;
    const source = frozenContentRelease(payload.releaseProfileId, payload.ruleVersion);
    const result = validatePayload(payload, source, { releases, steps: [] });
    assert.ok(result.ok, result.ok ? "" : result.error);
  }
  const another = frozenContentReleases();
  releases[0]!.tiles = [];
  assert.ok(another[0]!.tiles.length > 0);
});

test("R1 real v3 full save archives exact completed layouts and preserves all permanent progress", () => {
  const { target, registry } = fixture();
  const result = validatePayload(raw, target, registry);
  assert.ok(result.ok, result.ok ? "" : result.error);
  assert.equal(result.value.schemaVersion, 3);
  assert.deepEqual(result.value.completedRoomLayouts, {});
  assert.equal(
    result.value.archivedCompletedRoomLayouts.length,
    Object.keys(raw.completedRoomLayouts).length,
  );
  for (const archive of result.value.archivedCompletedRoomLayouts) {
    assert.equal(archive.contentVersion, 5);
    assert.equal(archive.ruleVersion, 3);
    assert.deepEqual(archive.layout, raw.completedRoomLayouts[archive.roomId]);
  }
  for (const field of [
    "completedObjectiveIds",
    "claimedRewardIds",
    "capabilities",
    "bestResults",
  ] as const)
    assert.deepEqual(result.value[field], raw[field]);
  assert.ok(!result.value.completedObjectiveIds.some((id) => id.startsWith("c.capture.")));
  const repeat = validatePayload(result.value, target, registry);
  assert.ok(repeat.ok, repeat.ok ? "" : repeat.error);
  assert.equal(repeat.migrated, undefined);
  assert.deepEqual(repeat.value, result.value);
});

test("R1 completedVisit returns to its exact registered safe entrance rather than the new board", () => {
  const { target, registry } = fixture();
  const room = historical.rooms.find((candidate) => candidate.id === "c.theft.01")!;
  const payload = structuredClone(raw);
  payload.room = {
    roomId: room.id,
    status: "completedVisit",
    returnAnchor: {
      space: "world",
      areaId: room.areaId,
      boardId: room.areaId,
      tileId: room.returnTileId,
    },
  };
  payload.playerPosition = {
    space: "room",
    areaId: room.areaId,
    boardId: room.boardId,
    tileId: room.entryTileId,
  };
  const result = validatePayload(payload, target, registry);
  assert.ok(result.ok, result.ok ? "" : result.error);
  assert.equal(result.value.room, null);
  assert.equal(result.value.playerPosition.tileId, room.returnTileId);
  assert.equal(result.value.playerPosition.space, "world");
  assert.ok(result.value.archivedCompletedRoomLayouts.some((record) => record.roomId === room.id));
});

test("R1 rejects missing safe mapping and invalid historical completion proof before migration", () => {
  const { target, registry, roomLayouts } = fixture();
  delete roomLayouts["c.theft.01"];
  assert.equal(validatePayload(raw, target, registry).ok, false);
  const good = fixture();
  const invalid = structuredClone(raw);
  invalid.completedRoomLayouts["c.theft.01"].objectTileById = {};
  assert.equal(validatePayload(invalid, good.target, good.registry).ok, false);
  const missing = structuredClone(raw);
  delete missing.completedRoomLayouts["c.theft.01"];
  assert.equal(validatePayload(missing, good.target, good.registry).ok, false);
});

test("R1 rejects conflicting archives, unknown source versions and archive-only completion visits", () => {
  const { target, registry } = fixture();
  const result = validatePayload(raw, target, registry);
  assert.ok(result.ok, result.ok ? "" : result.error);
  for (const alteration of ["duplicate", "source", "layout"] as const) {
    const changed: SavePayload = structuredClone(result.value);
    if (alteration === "duplicate")
      changed.archivedCompletedRoomLayouts.push(
        structuredClone(changed.archivedCompletedRoomLayouts[0]!),
      );
    if (alteration === "source") changed.archivedCompletedRoomLayouts[0]!.ruleVersion = 99;
    if (alteration === "layout") changed.archivedCompletedRoomLayouts[0]!.layout = null;
    assert.equal(validatePayload(changed, target, registry).ok, false);
  }
});

const actualProfileSaves = [
  ["M1", "m1-browser-save.json"],
  ["M2", "m2-browser-save-schema1.json"],
  ["M3", "m3-browser-save.json"],
  ["M4", "m4-chrome-browser-full-save.json"],
  ["M5", "controls-readability/v1-full-collection-migration-save.json"],
] as const;

test("R1 P07 five profiles and all forward upgrades preserve real original permanent collections", () => {
  const { roomLayouts } = fixture();
  const profileIds: ProfileId[] = ["M1", "M2", "M3", "M4", "M5"];
  for (const [sourceProfile, path] of actualProfileSaves) {
    const input = JSON.parse(
      readFileSync(new URL(`../tests/fixtures/historical/${path}`, import.meta.url), "utf8"),
    ).payload;
    const source = frozenContentRelease(sourceProfile, input.ruleVersion);
    for (const profileId of profileIds.filter((id) => id >= sourceProfile)) {
      const oldReleases = frozenContentReleases(profileId);
      const destinations = profileIds
        .filter((id) => id <= profileId)
        .map((id): GameContent => {
          const old = frozenContentRelease(id, 3);
          return {
            ...old,
            contentVersion: old.contentVersion + 1,
            ruleVersion: 4,
            staticChallenges: [],
            realtimeChallenges: [],
            rooms: [],
          };
        });
      const target = destinations.at(-1)!;
      const registry = publishedProfileMigrations([...oldReleases, ...destinations], roomLayouts);
      const result = validatePayload(input, target, registry);
      assert.ok(result.ok, `${sourceProfile} → ${profileId}: ${result.ok ? "" : result.error}`);
      assert.equal(
        supplyProgress(target, result.value).collected,
        supplyProgress(source, input).collected,
      );
      assert.equal(
        supplyProgress(target, result.value).total,
        [26, 51, 81, 130, 130][profileIds.indexOf(profileId)],
      );
      assert.deepEqual(result.value.completedObjectiveIds, input.completedObjectiveIds);
      assert.deepEqual(result.value.claimedRewardIds, input.claimedRewardIds);
      assert.deepEqual(result.value.bestResults, input.bestResults);
      const repeated = validatePayload(result.value, target, registry);
      assert.ok(repeated.ok, repeated.ok ? "" : repeated.error);
      assert.equal(repeated.migrated, undefined);
      assert.deepEqual(repeated.value, result.value);
    }
  }
});

test("R1 archive-only registration cannot be forged into a compatible completion even on identical geometry", () => {
  const { target, registry, roomLayouts } = fixture();
  const room = historical.rooms.find((candidate) => candidate.id === "a.maze.01")!;
  target.rooms = [room];
  target.staticChallenges = historical.staticChallenges.filter(
    (definition) => definition.id === room.id,
  );
  const operation = roomLayouts[room.id]!;
  assert.equal(operation.kind, "archive");
  roomLayouts[room.id] = { ...operation, targetRoomId: room.id };
  const result = validatePayload(raw, target, registry);
  assert.ok(result.ok, result.ok ? "" : result.error);
  const forged: SavePayload = structuredClone(result.value);
  forged.completedRoomLayouts[room.id] = {
    contentVersion: 6,
    ruleVersion: 4,
    layout: structuredClone(raw.completedRoomLayouts[room.id]),
    source: {
      contentVersion: 5,
      ruleVersion: 3,
      mappingId: migrationMappingId(registry.steps[0]!),
    },
  };
  assert.equal(validatePayload(forged, target, registry).ok, false);
  const proofRemoved: SavePayload = structuredClone(result.value);
  proofRemoved.archivedCompletedRoomLayouts = proofRemoved.archivedCompletedRoomLayouts.filter(
    (record) => record.roomId !== "c.routing.01",
  );
  assert.equal(validatePayload(proofRemoved, target, registry).ok, false);
});
