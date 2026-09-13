import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  expandFrozenReleases,
  frozenReleaseArrayFields,
} from "../src/content/history/frozen-release-blocks.ts";
import type { FrozenReleaseBlocks } from "../src/content/history/frozen-release-blocks.ts";
import type { GameContent } from "../src/core/types.ts";

/** Conversion accepts the original frozen snapshots, never freshly assembled content. */
export function compactFrozenReleases(releases: GameContent[]): FrozenReleaseBlocks {
  const archive: FrozenReleaseBlocks = {
    format: "frozen-release-blocks-v1",
    shared: Object.fromEntries(
      frozenReleaseArrayFields.map((field) => [field, []]),
    ) as unknown as FrozenReleaseBlocks["shared"],
    releases: structuredClone(releases) as unknown as FrozenReleaseBlocks["releases"],
  };
  for (const field of frozenReleaseArrayFields) {
    const indices = new Map<string, number>();
    for (const [releaseIndex, release] of releases.entries()) {
      const references = release[field].map((value) => {
        const serialized = JSON.stringify(value);
        const existing = indices.get(serialized);
        if (existing !== undefined) return existing;
        const index = archive.shared[field].length;
        indices.set(serialized, index);
        (archive.shared[field] as unknown[]).push(structuredClone(value));
        return index;
      });
      archive.releases[releaseIndex]![field] = references;
    }
  }
  const expanded = expandFrozenReleases(archive);
  if (
    !isDeepStrictEqual(expanded, releases) ||
    JSON.stringify(expanded) !== JSON.stringify(releases)
  )
    throw new Error("历史内容转换改变了快照值或顺序。");
  return archive;
}

if (import.meta.main) {
  const [source, destination] = process.argv.slice(2);
  if (!source || !destination || resolve(source) === resolve(destination))
    throw new Error(
      "用法：node scripts/compact-frozen-releases.ts <原始冻结JSON> <不同的输出JSON>",
    );
  const releases = JSON.parse(await readFile(source, "utf8")) as GameContent[];
  await writeFile(destination, JSON.stringify(compactFrozenReleases(releases), null, 2) + "\n");
}
