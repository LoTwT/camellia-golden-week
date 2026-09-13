import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import archive from "../src/content/history/pre-r1/releases.json" with { type: "json" };
import provenance from "../src/content/history/pre-r1/provenance.json" with { type: "json" };
import { expandFrozenReleases } from "../src/content/history/frozen-release-blocks.ts";
import type { FrozenReleaseBlocks } from "../src/content/history/frozen-release-blocks.ts";
import {
  frozenContentRelease,
  frozenContentReleases,
} from "../src/content/history/frozen-releases.ts";
import type { ProfileId } from "../src/core/types.ts";

test("shared historical blocks reproduce all 15 original snapshots including property and array order", () => {
  const source = provenance.files.find(
    (entry) => entry.frozen === "src/content/history/pre-r1/releases.json",
  )!;
  assert.equal(
    source.originalSha256,
    "270b610d5775260750a5bb9965cce00c1a5e91a3215a0d659869c6f83e6d68d6",
  );
  const releases = frozenContentReleases();
  assert.equal(releases.length, 15);
  assert.equal(source.expandedSnapshots!.length, 15);
  for (const [index, release] of releases.entries()) {
    const expected: {
      profile: string;
      contentVersion: number;
      ruleVersion: number;
      sha256: string;
    } = source.expandedSnapshots![index]!;
    assert.deepEqual(
      [release.profile.id, release.contentVersion, release.ruleVersion],
      [expected.profile, expected.contentVersion, expected.ruleVersion],
    );
    assert.equal(
      createHash("sha256").update(JSON.stringify(release)).digest("hex"),
      expected.sha256,
      `${expected.profile}/v${expected.ruleVersion} frozen snapshot changed`,
    );
  }
  for (const profile of ["M1", "M2", "M3", "M4", "M5"] satisfies ProfileId[]) {
    const filtered = releases.filter(
      (release) => Number(release.profile.id.slice(1)) <= Number(profile.slice(1)),
    );
    assert.deepEqual(frozenContentReleases(profile), filtered);
    for (const version of [1, 2, 3])
      assert.deepEqual(
        frozenContentRelease(profile, version),
        filtered.find(
          (release) => release.profile.id === profile && release.ruleVersion === version,
        ),
      );
  }
});

test("shared source blocks never alias mutable arrays, nested entries or separate loads", () => {
  const releases = frozenContentReleases();
  const original = frozenContentReleases();
  releases[0]!.tiles[0]!.id = "mutated-tile";
  releases[0]!.sources[0]!.adaptedElementIds.push("mutated-source");
  releases[0]!.profile.id = "M5";
  assert.deepEqual(releases.slice(1), original.slice(1));
  assert.deepEqual(frozenContentReleases(), original);

  const repeated = structuredClone(archive) as unknown as FrozenReleaseBlocks;
  repeated.releases[0]!.tiles = [0, 0];
  const expanded = expandFrozenReleases(repeated);
  expanded[0]!.tiles[0]!.id = "mutated-repeat";
  assert.notEqual(expanded[0]!.tiles[1]!.id, "mutated-repeat");
  assert.notEqual(repeated.shared.tiles[0]!.id, "mutated-repeat");
});

test("corrupt frozen block references fail explicitly instead of silently changing old content", () => {
  for (const index of [-1, 0.5, archive.shared.tiles.length]) {
    const corrupt = structuredClone(archive) as unknown as FrozenReleaseBlocks;
    corrupt.releases[0]!.tiles[0] = index;
    assert.throws(
      () => expandFrozenReleases(corrupt),
      /Frozen release block reference out of range/,
    );
  }
  const corrupt = { ...archive, format: "unknown" } as unknown as FrozenReleaseBlocks;
  assert.throws(() => expandFrozenReleases(corrupt), /Unknown frozen release block format/);
});
