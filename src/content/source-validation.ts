import type { WorldDefinition } from "../core/types.ts";

export type AreaSource = Pick<WorldDefinition, "tiles" | "entities" | "rooms"> & {
  area: WorldDefinition["areas"][number];
};
export type AreaExtension = Pick<WorldDefinition, "tiles" | "entities" | "rooms"> & {
  areaId: string;
  sourceRecordIds: string[];
};

/** Checks authored membership before merging extensions or filtering a release view. */
export function assertSourceIntegrity(
  areas: readonly AreaSource[],
  extensions: readonly AreaExtension[],
  catalog: WorldDefinition,
  extensionStage: number,
  challengeIds: readonly string[],
): void {
  const issues: string[] = [];
  const fail = (path: string, message: string) => issues.push(`${path}: ${message}`);
  const uniqueIds = <T extends { id: string }>(values: readonly T[], path: string) => {
    const result = new Map<string, T>();
    for (const value of values) {
      if (result.has(value.id)) fail(`${path}.${value.id}`, "重复 ID");
      result.set(value.id, value);
    }
    return result;
  };
  const membership = (actual: readonly string[], expected: readonly string[], path: string) => {
    const seen = new Set<string>();
    for (const id of actual) {
      if (seen.has(id)) fail(path, `${id} 重复 ID`);
      if (!expected.includes(id)) fail(path, `${id} 没有对应的本区定义`);
      seen.add(id);
    }
    for (const id of expected) if (!seen.has(id)) fail(path, `${id} 未登记，不能静默补齐`);
  };
  const stage = (value: number, minimum: number, path: string) => {
    if (!Number.isSafeInteger(value) || value < minimum || value > 5)
      fail(path, `收录阶段必须是 ${minimum}–5 的整数`);
  };
  const areaById = uniqueIds(
    areas.map((source) => source.area),
    "areas",
  );
  membership([...areaById.keys()], catalog.areaIds, "areas");
  stage(extensionStage, 1, "revisits.includedFrom");
  const extended = new Set<string>();
  for (const extension of extensions) {
    if (!areaById.has(extension.areaId))
      fail(`revisits.${extension.areaId}`, "未解析区域，不能丢弃整个扩展");
    if (extended.has(extension.areaId)) fail(`revisits.${extension.areaId}`, "重复区域扩展");
    extended.add(extension.areaId);
  }
  for (const source of areas) {
    stage(source.area.includedFrom, 1, `areas.${source.area.id}.includedFrom`);
    membership(
      source.area.tileIds,
      source.tiles.map((tile) => tile.id),
      `areas.${source.area.id}.tileIds`,
    );
    membership(
      source.area.entityIds,
      source.entities.map((entity) => entity.id),
      `areas.${source.area.id}.entityIds`,
    );
    membership(
      source.area.roomIds,
      source.rooms.map((room) => room.id),
      `areas.${source.area.id}.roomIds`,
    );
  }
  const parts = [
    ...areas.map((source) => ({
      ...source,
      areaId: source.area.id,
      minimumStage: source.area.includedFrom,
      path: `areas.${source.area.id}`,
    })),
    ...extensions.map((extension) => ({
      ...extension,
      minimumStage: Math.max(extensionStage, areaById.get(extension.areaId)?.includedFrom ?? 1),
      path: `revisits.${extension.areaId}`,
    })),
  ];
  const tileById = uniqueIds(
    parts.flatMap((part) => part.tiles),
    "tiles",
  );
  const entities = parts.flatMap((part) => part.entities);
  const rooms = parts.flatMap((part) => part.rooms);
  uniqueIds(entities, "entities");
  const roomById = uniqueIds(rooms, "rooms");
  const challengeIdSet = new Set<string>();
  for (const id of challengeIds) {
    if (challengeIdSet.has(id)) fail(`challenges.${id}`, "重复 ID");
    if (!roomById.has(id)) fail(`challenges.${id}`, "没有注册房间的孤儿挑战定义");
    challengeIdSet.add(id);
  }
  for (const room of rooms)
    if (!challengeIdSet.has(room.id)) fail(`rooms.${room.id}`, "未解析挑战定义");
  const effects = uniqueIds(catalog.effects, "effects");
  uniqueIds(catalog.sources, "sources");
  const sourceIds = new Set(catalog.sources.map((source) => source.id));
  const coordinates = new Set<string>();
  const referenceTile = (tileId: string, areaId: string, includedFrom: number, path: string) => {
    const tile = tileById.get(tileId);
    if (!tile || tile.boardId !== areaId || tile.terrain !== "floor")
      fail(path, `${tileId} 必须引用本区实际地板`);
    else if (tile.includedFrom > includedFrom) fail(path, `${tileId} 尚未收录，不能先收录其使用者`);
  };
  for (const part of parts) {
    for (const tile of part.tiles) {
      const path = `${part.path}.tiles.${tile.id}`;
      stage(tile.includedFrom, part.minimumStage, `${path}.includedFrom`);
      if (tile.boardId !== part.areaId) fail(path, `boardId ${tile.boardId} 与文件归属不一致`);
      const coordinate = `${tile.boardId}:${tile.x},${tile.y}`;
      if (coordinates.has(coordinate)) fail(path, `坐标重复 ${coordinate}`);
      coordinates.add(coordinate);
    }
    for (const entity of part.entities) {
      const path = `${part.path}.entities.${entity.id}`;
      stage(entity.includedFrom, part.minimumStage, `${path}.includedFrom`);
      referenceTile(entity.tileId, part.areaId, entity.includedFrom, `${path}.tileId`);
      if (!catalog.gates.some((gate) => gate.id === entity.gateId))
        fail(`${path}.gateId`, `未解析引用 ${entity.gateId}`);
      if (entity.effectBundleId !== null && !effects.has(entity.effectBundleId))
        fail(`${path}.effectBundleId`, `未解析引用 ${entity.effectBundleId}`);
      for (const id of entity.sourceRecordIds)
        if (!sourceIds.has(id)) fail(`${path}.sourceRecordIds`, `未解析引用 ${id}`);
    }
    for (const room of part.rooms) {
      const path = `${part.path}.rooms.${room.id}`;
      stage(room.includedFrom, part.minimumStage, `${path}.includedFrom`);
      if (room.areaId !== part.areaId) fail(path, `areaId ${room.areaId} 与文件归属不一致`);
      for (const field of ["worldEntranceTileId", "returnTileId", "successExitTileId"] as const)
        referenceTile(room[field], part.areaId, room.includedFrom, `${path}.${field}`);
      if (!effects.has(room.effectBundleId))
        fail(`${path}.effectBundleId`, `未解析引用 ${room.effectBundleId}`);
    }
    const sourceRecordIds = "area" in part ? part.area.sourceRecordIds : part.sourceRecordIds;
    for (const id of sourceRecordIds)
      if (!sourceIds.has(id)) fail(`${part.path}.sourceRecordIds`, `未解析引用 ${id}`);
  }
  for (const source of areas)
    referenceTile(
      source.area.entryTileId,
      source.area.id,
      source.area.includedFrom,
      `areas.${source.area.id}.entryTileId`,
    );
  const usedEffects = new Set([
    ...entities.flatMap((entity) =>
      entity.effectBundleId === null ? [] : [entity.effectBundleId],
    ),
    ...rooms.map((room) => room.effectBundleId),
  ]);
  for (const effect of catalog.effects)
    if (!usedEffects.has(effect.id)) fail(`effects.${effect.id}`, "没有实体或房间使用的孤儿效应包");
  for (const profile of catalog.releaseProfiles)
    membership(
      profile.includedRoomIds,
      rooms
        .filter((room) => room.includedFrom <= Number(profile.id.slice(1)))
        .map((room) => room.id),
      `releaseProfiles.${profile.id}.includedRoomIds`,
    );
  if (issues.length) throw new Error(issues.join("\n"));
}
