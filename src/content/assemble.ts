import worldJson from "./world.json" with { type: "json" };
import hubJson from "./areas/hub.json" with { type: "json" };
import aJson from "./areas/a.json" with { type: "json" };
import staticJson from "./challenges/static.json" with { type: "json" };
import realtimeJson from "./challenges/realtime.json" with { type: "json" };
import type { StaticContent } from "../core/static-puzzle.ts";
import type { RealtimeDefinition } from "../core/realtime.ts";
import type {
  GameContent,
  WorldDefinition,
  ProfileId,
  GateCondition,
  EntityDefinition,
} from "../core/types.ts";

export const AVAILABLE_PROFILE: ProfileId = "M1";
export const staticContent = staticJson as unknown as StaticContent;
export const realtimeContent = realtimeJson as unknown as {
  definitions: RealtimeDefinition[];
  witnesses: unknown[];
};
export const worldCatalog = worldJson as unknown as WorldDefinition;

export function assembleContent(profileId: ProfileId = AVAILABLE_PROFILE): GameContent {
  const stage = Number(profileId.slice(1));
  const profileSource = worldCatalog.releaseProfiles.find(
    (candidate) => candidate.id === profileId,
  );
  if (!profileSource) throw new Error(`未知 profile：${profileId}`);
  const sourceAreas = [hubJson, aJson] as unknown as Pick<
    WorldDefinition,
    "areas" | "tiles" | "entities" | "rooms"
  >[];
  const areas = sourceAreas
    .map((source) => (source as unknown as { area: WorldDefinition["areas"][number] }).area)
    .filter((area) => area.includedFrom <= stage);
  const tiles = sourceAreas
    .flatMap((source) => source.tiles)
    .filter((tile) => tile.includedFrom <= stage);
  const tileIds = new Set(tiles.map((tile) => tile.id));
  const rooms = sourceAreas
    .flatMap((source) => source.rooms)
    .filter((room) => room.includedFrom <= stage);
  const objectives = worldCatalog.objectives.filter((item) => item.includedFrom <= stage);
  const objectiveIds = new Set(objectives.map((item) => item.id));
  const conditionIncluded = (condition: GateCondition): boolean => {
    if (condition.kind === "objective") return objectiveIds.has(condition.objectiveId);
    if (condition.kind === "all") return condition.conditions.every(conditionIncluded);
    if (condition.kind === "areaDataComplete") return stage >= 4;
    return true;
  };
  const entities: EntityDefinition[] = sourceAreas
    .flatMap((source) => source.entities)
    .flatMap((entity): EntityDefinition[] => {
      if (!tileIds.has(entity.tileId)) return [];
      if (entity.includedFrom <= stage) return [entity];
      if (entity.kind !== "teleport") return [];
      return [
        {
          ...entity,
          id: `${entity.id}.unavailable`,
          kind: "unavailable",
          gateId: "always",
          effectBundleId: null,
          params: { message: "本版本未收录" },
        },
      ];
    });
  const staticChallenges = staticContent.definitions.filter((definition) =>
    rooms.some((room) => room.id === definition.id),
  );
  const realtimeChallenges = realtimeContent.definitions.filter((definition) =>
    rooms.some((room) => room.id === definition.id),
  );
  const resolvedRooms = rooms.map((room) => {
    const staticDefinition = staticChallenges.find((definition) => definition.id === room.id);
    const realtimeDefinition = realtimeChallenges.find((definition) => definition.id === room.id);
    return {
      ...room,
      boardId: staticDefinition?.boardId ?? realtimeDefinition?.boardId ?? room.boardId,
      entryTileId:
        staticDefinition?.startTileId ?? realtimeDefinition?.entry.tileId ?? room.entryTileId,
      witnessIds: staticDefinition
        ? staticContent.witnesses
            .filter((witness) => witness.definitionId === room.id)
            .map((witness) => witness.id)
        : realtimeDefinition
          ? [...realtimeDefinition.witnessIds]
          : room.witnessIds,
    };
  });
  const effectIds = new Set([
    ...entities.flatMap((entity) => (entity.effectBundleId ? [entity.effectBundleId] : [])),
    ...rooms.map((room) => room.effectBundleId),
  ]);
  return {
    ...worldCatalog,
    contentVersion: stage,
    areaIds: areas.map((area) => area.id),
    profile: { ...profileSource, includedRoomIds: rooms.map((room) => room.id) },
    areas: areas.map((area) => ({
      ...area,
      tileIds: area.tileIds.filter((id) => tileIds.has(id)),
      entityIds: entities
        .filter(
          (entity) =>
            tileIds.has(entity.tileId) &&
            tiles.find((tile) => tile.id === entity.tileId)?.boardId === area.id,
        )
        .map((entity) => entity.id),
      roomIds: rooms.filter((room) => room.areaId === area.id).map((room) => room.id),
    })),
    tiles,
    entities,
    rooms: resolvedRooms,
    objectives,
    dataNodes: worldCatalog.dataNodes.filter((node) => node.includedFrom <= stage),
    rewards: worldCatalog.rewards.filter((reward) => reward.includedFrom <= stage),
    effects: worldCatalog.effects.filter((effect) => effectIds.has(effect.id)),
    gates: worldCatalog.gates.filter((gate) => conditionIncluded(gate.condition)),
    staticChallenges: [...staticChallenges],
    realtimeChallenges,
    catalogDataNodes: worldCatalog.dataNodes,
    catalogRewards: worldCatalog.rewards,
    catalogObjectives: worldCatalog.objectives,
  };
}
