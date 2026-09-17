import type { GameContent } from "../../core/types.ts";

/** Separate pools preserve the meaning and order of each historical content field. */
export const frozenReleaseArrayFields = [
  "areaIds",
  "objectives",
  "dataNodes",
  "rewards",
  "gates",
  "releaseProfiles",
  "effects",
  "sources",
  "areas",
  "tiles",
  "entities",
  "rooms",
  "staticChallenges",
  "realtimeChallenges",
  "catalogDataNodes",
  "catalogRewards",
  "catalogObjectives",
] as const satisfies readonly (keyof GameContent)[];

type ArrayField = (typeof frozenReleaseArrayFields)[number];
type ReleaseReferences = Omit<GameContent, ArrayField> & {
  [Field in ArrayField]: number[];
};

export interface FrozenReleaseBlocks {
  format: "frozen-release-blocks-v1";
  shared: Pick<GameContent, ArrayField>;
  releases: ReleaseReferences[];
}

/** Only expands stored references: no dependency on current content or rule generators. */
export function expandFrozenReleases(archive: FrozenReleaseBlocks): GameContent[] {
  if (archive.format !== "frozen-release-blocks-v1")
    throw new Error("Unknown frozen release block format");
  return archive.releases.map((release) => {
    const expanded = structuredClone(release) as unknown as GameContent;
    for (const field of frozenReleaseArrayFields) {
      const values = release[field].map((index) => {
        if (!Number.isSafeInteger(index) || index < 0 || index >= archive.shared[field].length)
          throw new Error(
            `Frozen release block reference out of range：${release.profile.id}/v${release.ruleVersion}/${field}/${index}`,
          );
        // Clone each occurrence, including identical entries within one release.
        return structuredClone(archive.shared[field][index]);
      });
      Object.assign(expanded, { [field]: values });
    }
    return expanded;
  });
}
