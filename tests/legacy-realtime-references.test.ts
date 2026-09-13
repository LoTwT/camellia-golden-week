import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import originalDigests from "./fixtures/legacy-realtime-digests.json" with { type: "json" };
import releases from "../src/content/history/pre-r1/releases.json" with { type: "json" };
import v1 from "../src/content/history/realtime-v1.ts";
import v2 from "../src/content/history/realtime-v2.ts";
import v3 from "../src/content/history/pre-r1/realtime-content.ts";
import { expandLegacyRealtime } from "../src/content/history/legacy-realtime-references.ts";
import type { LegacyRealtimeReferences } from "../src/content/history/legacy-realtime-references.ts";

function readReferences(index: number): LegacyRealtimeReferences {
  return JSON.parse(
    readFileSync(new URL(`../${originalDigests.files[index]!.path}`, import.meta.url), "utf8"),
  ) as LegacyRealtimeReferences;
}

// Digests were captured from the original Git bytes before introducing references.
// Never refresh them from the decoder output when changing this storage format.
for (const [index, exported] of [v1, v2, v3].entries()) {
  test(`v${index + 1} references reproduce every original definition, witness and property order`, () => {
    const source = originalDigests.files[index]!;
    const expanded = expandLegacyRealtime(readReferences(index));
    assert.equal(
      createHash("sha256").update(JSON.stringify(expanded)).digest("hex"),
      source.expandedSha256,
    );
    assert.equal(expanded.definitions.length, source.definitions);
    assert.equal(expanded.witnesses.length, source.witnesses);
    assert.deepEqual(exported, expanded);
  });
}

test("legacy realtime loads isolate every reference, witness and frozen source occurrence", () => {
  const archive = readReferences(0);
  archive.definitions.push(archive.definitions[0]!);
  const expected = expandLegacyRealtime(archive);
  const changed = expandLegacyRealtime(archive);
  Object.assign(changed.definitions[0]!.tiles[0]!, { id: "mutated-tile" });
  Object.assign(changed.witnesses[0]!.commands[0]!, { activeTimeMs: -1 });
  assert.deepEqual(changed.definitions.at(-1), expected.definitions.at(-1));
  assert.deepEqual(expandLegacyRealtime(archive), expected);
  assert.notEqual(releases.shared.realtimeChallenges[0]!.tiles[0]!.id, "mutated-tile");
});

test("legacy realtime references reject invalid indexes, identities, versions and formats", () => {
  for (const index of [-1, 0.5, NaN, Infinity, releases.shared.realtimeChallenges.length]) {
    const archive = readReferences(0);
    archive.definitions[0]!.index = index;
    assert.throws(() => expandLegacyRealtime(archive), /reference out of range/);
  }
  for (const index of [1, 9]) {
    const archive = readReferences(0);
    archive.definitions[0]!.index = index;
    assert.throws(() => expandLegacyRealtime(archive), /reference identity mismatch/);
  }
  const archive = readReferences(0);
  archive.definitions[0]!.id = "missing-challenge";
  assert.throws(() => expandLegacyRealtime(archive), /reference identity mismatch/);
  assert.throws(
    () =>
      expandLegacyRealtime({
        ...archive,
        format: "unknown",
      } as unknown as LegacyRealtimeReferences),
    /Unknown legacy realtime reference format/,
  );
});
