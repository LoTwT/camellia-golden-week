import { areaData, gateReason } from "../core/progress.ts";
import type { GameContent, ProgressState } from "../core/types.ts";

export function contentUpgradeSummary(
  originalPayload: unknown,
  upgradedProgress: ProgressState,
  content: GameContent,
): string {
  if (
    originalPayload === null ||
    typeof originalPayload !== "object" ||
    !("releaseProfileId" in originalPayload)
  )
    return "";
  const source = content.releaseProfiles.find(
    (profile) => profile.id === originalPayload.releaseProfileId,
  );
  if (!source || source.id === content.profile.id) return "";
  const revisits = content.areas.filter(
    (area) =>
      (area.id === "a" || area.id === "b") &&
      content.profile.includedObjectiveIds.includes(`${area.id}.revisit.terminal`) &&
      !source.includedObjectiveIds.includes(`${area.id}.revisit.terminal`),
  );
  if (revisits.length === 0) return "";
  const openingConditions = new Set(
    revisits.flatMap((area) => {
      const entrance = content.entities.find((entity) => entity.id === `${area.id}.revisit.door`);
      return entrance ? [gateReason(content, entrance.gateId)] : [];
    }),
  );
  const retainedData = revisits
    .filter((area) => source.includedAreaIds.includes(area.id))
    .map((area) => {
      const data = areaData(content, upgradedProgress, area.id);
      return `${area.label} ${data.collected} / ${data.total}`;
    });
  return `${content.profile.id} 新增${revisits.map((area) => area.label).join("、")}回访；${[...openingConditions].join("；")}。已有首访数据与已领取物资保留（${retainedData.join("；")}）。请按主路径提示继续推进。`;
}

export function saveUpgradeSummary(
  originalPayload: unknown,
  upgradedProgress: ProgressState,
  content: GameContent,
  migrationNotes: readonly string[] = [],
): string {
  return (
    migrationNotes.join("") + contentUpgradeSummary(originalPayload, upgradedProgress, content)
  );
}
