import worldJson from "./world.json" with { type: "json" };
import hubJson from "./areas/hub.json" with { type: "json" };
import aJson from "./areas/a.json" with { type: "json" };
import bJson from "./areas/b.json" with { type: "json" };
import bRegistration from "./areas/b-registration.json" with { type: "json" };
import cJson from "./areas/c.json" with { type: "json" };
import cRegistration from "./areas/c-registration.json" with { type: "json" };
import dJson from "./areas/d.json" with { type: "json" };
import dRegistration from "./areas/d-registration.json" with { type: "json" };
import revisitsJson from "./areas/revisits.json" with { type: "json" };
import warehouseJson from "./areas/warehouse.json" with { type: "json" };
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

export const AVAILABLE_PROFILE: ProfileId = "M4";
export const staticContent = staticJson as unknown as StaticContent;
export const realtimeContent = realtimeJson as unknown as {
  definitions: RealtimeDefinition[];
  witnesses: unknown[];
};
const baseCatalog = worldJson as unknown as WorldDefinition;
const registrations = [bRegistration, cRegistration, dRegistration];
export const worldCatalog = {
  ...baseCatalog,
  objectives: [
    ...baseCatalog.objectives,
    ...registrations.flatMap((registration) => registration.objectiveAdditions),
  ],
  effects: [
    ...baseCatalog.effects,
    ...registrations.flatMap((registration) => registration.effects),
  ],
  gates: [...baseCatalog.gates, ...registrations.flatMap((registration) => registration.gates)],
  sources: [
    ...baseCatalog.sources,
    ...registrations.flatMap((registration) => registration.sources),
  ],
  releaseProfiles: baseCatalog.releaseProfiles.map((profile) => {
    const included = registrations.filter(
      (registration) => Number(profile.id.slice(1)) >= registration.includedFrom,
    );
    return {
      ...profile,
      includedRoomIds: [
        ...profile.includedRoomIds,
        ...included.flatMap((registration) => registration.profileAdditions.includedRoomIds),
      ],
      includedObjectiveIds: [
        ...profile.includedObjectiveIds,
        ...included.flatMap((registration) => registration.profileAdditions.includedObjectiveIds),
      ],
    };
  }),
} as WorldDefinition;

type AreaFile = Pick<WorldDefinition, "tiles" | "entities" | "rooms"> & {
  area: WorldDefinition["areas"][number];
};

const sourceAreas = (
  [hubJson, aJson, bJson, cJson, dJson, warehouseJson] as unknown as AreaFile[]
).map((source): AreaFile => {
  const extension = revisitsJson.areas.find((candidate) => candidate.areaId === source.area.id);
  if (!extension) return source;
  const tiles = [...source.tiles, ...extension.tiles] as WorldDefinition["tiles"];
  const entities = [...source.entities, ...extension.entities] as WorldDefinition["entities"];
  const rooms = [...source.rooms, ...extension.rooms] as WorldDefinition["rooms"];
  return {
    area: {
      ...source.area,
      tileIds: tiles.map((tile) => tile.id),
      entityIds: entities.map((entity) => entity.id),
      roomIds: rooms.map((room) => room.id),
      sourceRecordIds: [...source.area.sourceRecordIds, ...extension.sourceRecordIds],
    },
    tiles,
    entities,
    rooms,
  };
});

export function assembleContent(profileId: ProfileId = AVAILABLE_PROFILE): GameContent {
  const stage = Number(profileId.slice(1));
  const profileSource = worldCatalog.releaseProfiles.find(
    (candidate) => candidate.id === profileId,
  );
  if (!profileSource) throw new Error(`未知 profile：${profileId}`);
  const areas = sourceAreas
    .map((source) => source.area)
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
    contentVersion: Math.min(stage, 4),
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
