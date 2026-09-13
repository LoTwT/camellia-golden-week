import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import originalDigests from "./fixtures/legacy-static-digests.json" with { type: "json" };
import releases from "../src/content/history/pre-r1/releases.json" with { type: "json" };
import content from "../src/content/history/pre-r1/static-content.ts";
import { expandLegacyStatic } from "../src/content/history/legacy-static-references.ts";
import type { LegacyStaticReferences } from "../src/content/history/legacy-static-references.ts";

function readReferences(): LegacyStaticReferences {
  return JSON.parse(
    readFileSync(new URL(`../${originalDigests.files[0]!.path}`, import.meta.url), "utf8"),
  ) as LegacyStaticReferences;
}

// Captured from the original Git bytes before introducing references. Never refresh
// these digests from decoder output when changing the storage format.
test("legacy static references reproduce every original definition, witness and property order", () => {
  const source = originalDigests.files[0]!;
  const expanded = expandLegacyStatic(readReferences());
  assert.equal(
    createHash("sha256").update(JSON.stringify(expanded)).digest("hex"),
    source.expandedSha256,
  );
  assert.equal(expanded.definitions.length, source.definitions);
  assert.equal(expanded.witnesses.length, source.witnesses);
  assert.deepEqual(content, expanded);
});

test("legacy static loads isolate every reference, witness and frozen source occurrence", () => {
  const archive = readReferences();
  archive.definitions.push(archive.definitions[0]!);
  const expected = expandLegacyStatic(archive);
  const changed = expandLegacyStatic(archive);
  Object.assign(changed.definitions[0]!.tiles[0]!, { id: "mutated-tile" });
  Object.assign(changed.witnesses[0]!.actions, { 0: "mutated-action" });
  assert.deepEqual(changed.definitions.at(-1), expected.definitions.at(-1));
  assert.deepEqual(expandLegacyStatic(archive), expected);
  assert.notEqual(releases.shared.staticChallenges[0]!.tiles[0]!.id, "mutated-tile");
});

test("legacy static references reject invalid indexes, identities and formats", () => {
  for (const index of [-1, 0.5, NaN, Infinity, releases.shared.staticChallenges.length]) {
    const archive = readReferences();
    archive.definitions[0]!.index = index;
    assert.throws(() => expandLegacyStatic(archive), /reference out of range/);
  }
  const archive = readReferences();
  archive.definitions[0]!.index = 1;
  assert.throws(() => expandLegacyStatic(archive), /reference identity mismatch/);
  archive.definitions[0]!.id = "missing-challenge";
  assert.throws(() => expandLegacyStatic(archive), /reference identity mismatch/);
  assert.throws(
    () =>
      expandLegacyStatic({
        ...archive,
        format: "unknown",
      } as unknown as LegacyStaticReferences),
    /Unknown legacy static reference format/,
  );
});
