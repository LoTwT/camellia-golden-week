import releases from "./pre-r1/releases.json" with { type: "json" };
import type { GameContent, ProfileId } from "../../core/types.ts";

/** Immutable published snapshots. Never rebuild these from current maps or rules. */
export function frozenContentReleases(profileId: ProfileId = "M5"): GameContent[] {
  return structuredClone(releases).filter(
    (release) => Number(release.profile.id.slice(1)) <= Number(profileId.slice(1)),
  ) as unknown as GameContent[];
}

export function frozenContentRelease(profileId: ProfileId, ruleVersion: number): GameContent {
  const release = frozenContentReleases(profileId).find(
    (candidate) => candidate.profile.id === profileId && candidate.ruleVersion === ruleVersion,
  );
  if (!release) throw new Error(`缺少冻结的历史内容：${profileId}/v${ruleVersion}`);
  return release;
}
