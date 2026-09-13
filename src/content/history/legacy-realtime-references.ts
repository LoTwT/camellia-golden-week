import releases from "./pre-r1/releases.json" with { type: "json" };
import type { RealtimeDefinition, RealtimeWitness } from "./pre-r1/realtime.ts";

export interface LegacyRealtimeContent {
  contentVersion: number;
  ruleVersion: number;
  definitions: RealtimeDefinition[];
  witnesses: RealtimeWitness[];
}

export interface LegacyRealtimeReferences extends Omit<LegacyRealtimeContent, "definitions"> {
  format: "legacy-realtime-references-v1";
  definitions: { index: number; id: string }[];
}

/** Historical definitions resolve only against the immutable published release pool. */
export function expandLegacyRealtime(archive: LegacyRealtimeReferences): LegacyRealtimeContent {
  if (archive.format !== "legacy-realtime-references-v1")
    throw new Error("Unknown legacy realtime reference format");
  const { format: _format, ...stored } = archive;
  const expanded = structuredClone(stored) as unknown as LegacyRealtimeContent;
  expanded.definitions = archive.definitions.map(({ index, id }) => {
    const pool = releases.shared.realtimeChallenges;
    if (!Number.isSafeInteger(index) || index < 0 || index >= pool.length)
      throw new Error(`Legacy realtime reference out of range: ${index}`);
    const definition = pool[index]!;
    if (definition.id !== id || definition.ruleVersion !== archive.ruleVersion)
      throw new Error(`Legacy realtime reference identity mismatch: ${id}/v${archive.ruleVersion}`);
    return structuredClone(definition) as unknown as RealtimeDefinition;
  });
  return expanded;
}
