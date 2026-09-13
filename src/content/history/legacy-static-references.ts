import releases from "./pre-r1/releases.json" with { type: "json" };
import type { StaticContent, StaticDefinition } from "./pre-r1/static-puzzle.ts";

export interface LegacyStaticReferences extends Omit<StaticContent, "definitions"> {
  format: "legacy-static-references-v1";
  definitions: { index: number; id: string }[];
}

/** Historical definitions resolve only against the immutable published release pool. */
export function expandLegacyStatic(archive: LegacyStaticReferences): StaticContent {
  if (archive.format !== "legacy-static-references-v1")
    throw new Error("Unknown legacy static reference format");
  const { format: _format, ...stored } = archive;
  return {
    ...structuredClone(stored),
    definitions: archive.definitions.map(({ index, id }) => {
      const pool = releases.shared.staticChallenges;
      if (!Number.isSafeInteger(index) || index < 0 || index >= pool.length)
        throw new Error(`Legacy static reference out of range: ${index}`);
      const definition = pool[index]!;
      if (definition.id !== id) throw new Error(`Legacy static reference identity mismatch: ${id}`);
      return structuredClone(definition) as unknown as StaticDefinition;
    }),
  };
}
