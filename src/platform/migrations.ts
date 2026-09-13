import { sameJsonValue } from "../core/json-value.ts";
import { r1RoomLayoutMappings } from "../content/history/r1-room-map.ts";
import * as historicalStatic from "../content/history/pre-r1/static-puzzle.ts";
import {
  validateCompletedStaticLayout,
  isCompletedStaticPosition,
  validateStaticState,
} from "../core/static-puzzle.ts";
import { gateSatisfied } from "../core/progress.ts";
import type { GameContent, PlayerPosition, ProfileId } from "../core/types.ts";
import type { CompletedStaticLayout, StaticLayout } from "../core/static-puzzle.ts";
import type { SavePayload } from "./save-payload.ts";

export interface ReleaseVersion {
  readonly profileId: ProfileId;
  readonly contentVersion: number;
  readonly ruleVersion: number;
}

export type RoomLayoutMigration =
  | {
      readonly kind: "archive";
      readonly targetRoomId: string | null;
      readonly safeEntrance: PlayerPosition;
      readonly successExit: PlayerPosition;
      readonly objectiveId: string;
    }
  | { readonly kind: "compatible"; readonly mappingId: string; readonly targetRoomId: string };

export interface ContentMapping {
  readonly roomLayouts?: Readonly<Record<string, RoomLayoutMigration>>;
  readonly tileIds?: Readonly<Record<string, string>>;
  readonly boardIds?: Readonly<Record<string, string>>;
  readonly objectiveIds?: Readonly<Record<string, string>>;
  readonly rewardIds?: Readonly<Record<string, string>>;
  /** These unfinished local attempts explicitly return to their mapped safe entrance. */
  readonly exitRoomIds?: readonly string[];
}

export type MigrationStep = {
  readonly from: ReleaseVersion;
  readonly to: ReleaseVersion;
} & (
  | { readonly kind: "additive" | "rules" }
  | { readonly kind: "mapped"; readonly mapping: ContentMapping }
);

export interface MigrationRegistry {
  /** Actual historical content views, including their original scoring definitions. */
  readonly releases: readonly GameContent[];
  readonly steps: readonly MigrationStep[];
}

export interface ResolvedMigrationStep {
  readonly definition: MigrationStep;
  readonly from: GameContent;
  readonly to: GameContent;
}

export type MigrationPlan =
  | {
      readonly ok: true;
      readonly source: GameContent;
      readonly releases: readonly GameContent[];
      readonly steps: readonly ResolvedMigrationStep[];
    }
  | { readonly ok: false; readonly error: string };

export function releaseVersion(content: GameContent): ReleaseVersion {
  return {
    profileId: content.profile.id,
    contentVersion: content.contentVersion,
    ruleVersion: content.ruleVersion,
  };
}

function key(version: ReleaseVersion): string {
  return `${version.profileId}:${version.contentVersion}:${version.ruleVersion}`;
}

function additiveVersionsMatch(from: GameContent, to: GameContent): boolean {
  return (
    Number(to.profile.id.slice(1)) === Number(from.profile.id.slice(1)) + 1 &&
    from.ruleVersion === to.ruleVersion &&
    to.contentVersion ===
      from.contentVersion + (from.profile.id === "M4" && to.profile.id === "M5" ? 0 : 1)
  );
}

/** Callers provide published views; no version or old coordinates are inferred from a save. */
export function additiveProfileMigrations(releases: readonly GameContent[]): MigrationRegistry {
  const sorted = [...releases].sort(
    (left, right) => Number(left.profile.id.slice(1)) - Number(right.profile.id.slice(1)),
  );
  const steps: MigrationStep[] = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const from = sorted[index - 1];
    const to = sorted[index];
    if (!from || !to || !additiveVersionsMatch(from, to))
      throw new Error("新增内容迁移必须提供连续 profile、原始版本及相同规则版本");
    steps.push({ from: releaseVersion(from), to: releaseVersion(to), kind: "additive" });
  }
  return { releases: sorted, steps };
}

/** Published releases upgrade in place before adding later profile content. */
export function publishedProfileMigrations(
  releases: readonly GameContent[],
  r1RoomLayouts: Readonly<Record<string, RoomLayoutMigration>> = r1RoomLayoutMappings,
): MigrationRegistry {
  const r1 = releases.filter((release) => release.ruleVersion === 4);
  if (r1.length) {
    const previous = publishedProfileMigrations(
      releases.filter((release) => release.ruleVersion < 4),
    );
    const additive = additiveProfileMigrations(r1);
    const steps = additive.releases.map((to): MigrationStep => {
      const from = previous.releases.find(
        (release) => release.profile.id === to.profile.id && release.ruleVersion === 3,
      );
      if (!from || to.contentVersion !== from.contentVersion + 1)
        throw new Error(`缺少 ${to.profile.id} 从 v3 到 R1 的明确版本提升`);
      const roomLayouts = Object.fromEntries(
        from.staticChallenges.map((room) => {
          const mapping = r1RoomLayouts[room.id];
          if (!mapping) throw new Error(`R1 迁移未登记静态房间 ${room.id}`);
          return [room.id, mapping];
        }),
      );
      return {
        from: releaseVersion(from),
        to: releaseVersion(to),
        kind: "mapped",
        mapping: { roomLayouts },
      };
    });
    return {
      releases: [...previous.releases, ...r1],
      steps: [
        ...previous.steps.filter((step) => step.kind !== "additive"),
        ...steps,
        ...additive.steps,
      ],
    };
  }
  const current = releases.filter((release) => release.ruleVersion === 3);
  const second = releases.filter((release) => release.ruleVersion === 2);
  const legacy = releases.filter((release) => release.ruleVersion === 1);
  if (
    current.length === 0 ||
    current.length !== legacy.length ||
    current.length !== second.length ||
    current.length + second.length + legacy.length !== releases.length ||
    new Set(releases.map((release) => key(releaseVersion(release)))).size !== releases.length
  )
    throw new Error("当前发布迁移需要每个已收录 profile 的唯一 v1、v2、v3 内容视图");
  const additive = additiveProfileMigrations(current);
  if (additive.releases[0]?.profile.id !== "M1") throw new Error("当前发布迁移必须从 M1 开始收录");
  const mappedSteps = second.map((to): MigrationStep => {
    const from = legacy.find((candidate) => candidate.profile.id === to.profile.id);
    const originalContentVersion = Math.min(Number(to.profile.id.slice(1)), 4);
    if (
      !from ||
      from.contentVersion !== originalContentVersion ||
      to.contentVersion !== originalContentVersion + 1
    )
      throw new Error(`缺少 ${to.profile.id} 从原始内容到防火墙重建版本的明确映射`);
    // Realtime attempts persist their outer safe anchor, never their local board coordinates.
    return { from: releaseVersion(from), to: releaseVersion(to), kind: "mapped", mapping: {} };
  });
  const ruleSteps = additive.releases.map((to): MigrationStep => {
    const from = second.find((candidate) => candidate.profile.id === to.profile.id);
    if (
      !from ||
      from.contentVersion !== to.contentVersion ||
      to.contentVersion !== Math.min(Number(to.profile.id.slice(1)), 4) + 1
    )
      throw new Error(`缺少 ${to.profile.id} 从 v2 到警报判定 v3 的明确规则升级`);
    return { from: releaseVersion(from), to: releaseVersion(to), kind: "rules" };
  });
  return {
    releases: [...legacy, ...second, ...additive.releases],
    steps: [...mappedSteps, ...ruleSteps, ...additive.steps],
  };
}

export function resolveMigrationPlan(
  sourceVersion: ReleaseVersion,
  target: GameContent,
  registry: MigrationRegistry = { releases: [target], steps: [] },
): MigrationPlan {
  const releases = new Map<string, GameContent>();
  for (const content of [...registry.releases, target]) {
    if (content.gameId !== target.gameId) return { ok: false, error: "迁移登记混入其他项目" };
    const id = key(releaseVersion(content));
    const previous = releases.get(id);
    if (previous && previous !== content && JSON.stringify(previous) !== JSON.stringify(content))
      return { ok: false, error: `同一版本有冲突的内容定义：${id}` };
    releases.set(id, content);
  }
  const sourceKey = key(sourceVersion);
  const targetKey = key(releaseVersion(target));
  const source = releases.get(sourceKey);
  if (!source) return { ok: false, error: `缺少明确的来源内容版本：${sourceKey}` };
  const resolved: ResolvedMigrationStep[] = [];
  for (const definition of registry.steps) {
    const from = releases.get(key(definition.from));
    const to = releases.get(key(definition.to));
    if (!from || !to) return { ok: false, error: "迁移步骤缺少来源或目标内容定义" };
    if (
      to.contentVersion < from.contentVersion ||
      to.ruleVersion < from.ruleVersion ||
      Number(to.profile.id.slice(1)) < Number(from.profile.id.slice(1)) ||
      key(definition.from) === key(definition.to)
    )
      return { ok: false, error: "迁移步骤不能降级或原地循环" };
    if (definition.kind === "additive" && !additiveVersionsMatch(from, to))
      return { ok: false, error: "新增内容步骤只能连接相邻 profile 并保留规则版本" };
    if (
      definition.kind === "rules" &&
      (to.contentVersion !== from.contentVersion ||
        to.profile.id !== from.profile.id ||
        to.ruleVersion <= from.ruleVersion)
    )
      return { ok: false, error: "规则步骤必须明确提升规则版本并保留地图与 profile" };
    if (definition.kind === "mapped" && to.contentVersion <= from.contentVersion)
      return { ok: false, error: "坐标或 ID 映射必须提升 contentVersion" };
    resolved.push({ definition, from, to });
  }
  const paths: ResolvedMigrationStep[][] = [];
  const visit = (at: string, path: ResolvedMigrationStep[]) => {
    if (paths.length > 1) return;
    if (at === targetKey) {
      paths.push(path);
      return;
    }
    for (const step of resolved.filter((candidate) => key(candidate.definition.from) === at))
      visit(key(step.definition.to), [...path, step]);
  };
  visit(sourceKey, []);
  if (paths.length !== 1)
    return {
      ok: false,
      error:
        paths.length === 0
          ? "没有登记到当前版本的完整迁移路径"
          : "迁移路径不唯一，必须消除版本歧义",
    };
  return { ok: true, source, releases: [...releases.values()], steps: paths[0]! };
}

function mapped(id: string, mapping: Readonly<Record<string, string>> | undefined): string {
  return mapping?.[id] ?? id;
}

function validateMapping(
  mapping: Readonly<Record<string, string>> | undefined,
  source: readonly string[],
  target: readonly string[],
  name: string,
): string | null {
  for (const [from, to] of Object.entries(mapping ?? {}))
    if (!source.includes(from) || !target.includes(to))
      return `${name}映射引用未知 ID：${from} → ${to}`;
  const mappedIds = source.map((id) => mapped(id, mapping));
  if (new Set(mappedIds).size !== mappedIds.length)
    return `${name}映射必须一对一；合并需要单独登记数额和开门语义`;
  return null;
}

function mapPosition(position: PlayerPosition, mapping: ContentMapping): PlayerPosition {
  return {
    ...position,
    boardId: mapped(position.boardId, mapping.boardIds),
    tileId: mapped(position.tileId, mapping.tileIds),
  };
}

function mapLayoutCoordinates<T extends StaticLayout | CompletedStaticLayout>(
  layout: T,
  mapping: ContentMapping,
): T {
  return JSON.parse(JSON.stringify(layout), (_key, value: unknown) =>
    typeof value === "string" ? mapped(value, mapping.tileIds) : value,
  ) as T;
}

function mapLayout(layout: StaticLayout, mapping: ContentMapping): StaticLayout {
  return {
    ...mapLayoutCoordinates(layout, mapping),
    objectTileById: Object.fromEntries(
      Object.entries(layout.objectTileById).map(([id, tileId]) => [
        id,
        mapped(tileId, mapping.tileIds),
      ]),
    ),
    visitedTileIds: layout.visitedTileIds.map((id) => mapped(id, mapping.tileIds)),
    activatedLocalIds: [...layout.activatedLocalIds],
    pendingObjectiveIds: layout.pendingObjectiveIds.map((id) => mapped(id, mapping.objectiveIds)),
    pendingRewardIds: layout.pendingRewardIds.map((id) => mapped(id, mapping.rewardIds)),
  };
}

export function mapCompletedLayout(
  layout: CompletedStaticLayout,
  mapping: ContentMapping,
): CompletedStaticLayout {
  return {
    ...mapLayoutCoordinates(layout, mapping),
    objectTileById: Object.fromEntries(
      Object.entries(layout.objectTileById).map(([id, tileId]) => [
        id,
        mapped(tileId, mapping.tileIds),
      ]),
    ),
    visitedTileIds: layout.visitedTileIds.map((id) => mapped(id, mapping.tileIds)),
    activatedLocalIds: [...layout.activatedLocalIds],
  };
}

function rulesOnlyTopology(content: GameContent): string {
  return JSON.stringify({
    tiles: content.tiles,
    rooms: content.rooms,
    staticChallenges: content.staticChallenges,
    realtimeBoards: content.realtimeChallenges.map(
      ({ id, boardId, tiles, entry, effectBundleId }) => ({
        id,
        boardId,
        tiles,
        entry,
        effectBundleId,
      }),
    ),
    objectives: content.objectives,
    rewards: content.rewards,
    gates: content.gates,
    entities: content.entities,
  });
}

function checkContentPreservation(
  from: GameContent,
  to: GameContent,
  definition: MigrationStep,
): string | null {
  const mapping = definition.kind === "mapped" ? definition.mapping : {};
  for (const [name, map, before, after] of [
    [
      "目标",
      mapping.objectiveIds,
      from.objectives.map((item) => item.id),
      to.objectives.map((item) => item.id),
    ],
    [
      "奖励",
      mapping.rewardIds,
      from.rewards.map((item) => item.id),
      to.rewards.map((item) => item.id),
    ],
  ] as const) {
    const error = validateMapping(map, before, after, name);
    if (error) return error;
    for (const id of before)
      if (!after.includes(mapped(id, map))) return `${name} ${id} 被删除或重命名，缺少明确映射`;
  }
  for (const reward of from.rewards) {
    const destination = to.rewards.find(
      (candidate) => candidate.id === mapped(reward.id, mapping.rewardIds),
    );
    if (!destination || destination.units !== reward.units)
      return `奖励 ${reward.id} 的映射改变物资数额`;
  }
  if (definition.kind === "rules" && rulesOnlyTopology(from) !== rulesOnlyTopology(to))
    return "规则升级同时改变地图或目标，必须另行登记 contentVersion 迁移";
  if (from.ruleVersion === to.ruleVersion) {
    for (const challenge of from.staticChallenges) {
      const destination = to.staticChallenges.find((candidate) => candidate.id === challenge.id);
      if (
        !destination ||
        JSON.stringify(mapDefinition(challenge, mapping)) !== JSON.stringify(destination)
      )
        return `静态机关 ${challenge.id} 的定义改变但没有提升 ruleVersion`;
    }
    for (const challenge of from.realtimeChallenges) {
      const destination = to.realtimeChallenges.find((candidate) => candidate.id === challenge.id);
      const mappedRules = JSON.parse(JSON.stringify(challenge.rules), (_key, value: unknown) =>
        typeof value === "string" ? mapped(value, mapping.tileIds) : value,
      ) as unknown;
      if (
        !destination ||
        challenge.kind !== destination.kind ||
        challenge.ruleVersion !== destination.ruleVersion ||
        JSON.stringify(mappedRules) !== JSON.stringify(destination.rules)
      )
        return `挑战 ${challenge.id} 的规则改变但没有提升 ruleVersion`;
    }
  }
  if (definition.kind === "additive") {
    for (const tile of from.tiles) {
      const destination = to.tiles.find((candidate) => candidate.id === tile.id);
      if (!destination || JSON.stringify(destination) !== JSON.stringify(tile))
        return `新增内容步骤改变既有格子 ${tile.id}，需要明确坐标迁移`;
    }
    for (const challenge of [...from.staticChallenges, ...from.realtimeChallenges]) {
      const destination = [...to.staticChallenges, ...to.realtimeChallenges].find(
        (candidate) => candidate.id === challenge.id,
      );
      if (!destination || JSON.stringify(destination) !== JSON.stringify(challenge))
        return `新增内容步骤改变既有房间 ${challenge.id}，需要明确内容或规则迁移`;
    }
  }
  const fromTiles = [
    ...from.tiles,
    ...from.staticChallenges.flatMap((room) => room.tiles),
    ...from.realtimeChallenges.flatMap((room) =>
      room.tiles.map((tile) => ({ ...tile, boardId: room.boardId })),
    ),
  ];
  const toTiles = [
    ...to.tiles,
    ...to.staticChallenges.flatMap((room) => room.tiles),
    ...to.realtimeChallenges.flatMap((room) =>
      room.tiles.map((tile) => ({ ...tile, boardId: room.boardId })),
    ),
  ];
  const tileError = validateMapping(
    mapping.tileIds,
    fromTiles.map((tile) => tile.id),
    toTiles.map((tile) => tile.id),
    "格子",
  );
  if (tileError) return tileError;
  const boardError = validateMapping(
    mapping.boardIds,
    [...new Set(fromTiles.map((tile) => tile.boardId))],
    [...new Set(toTiles.map((tile) => tile.boardId))],
    "棋盘",
  );
  if (boardError) return boardError;
  for (const id of mapping.exitRoomIds ?? [])
    if (!from.staticChallenges.some((room) => room.id === id))
      return `退出映射引用未知静态房间：${id}`;
  for (const [roomId, operation] of Object.entries(mapping.roomLayouts ?? {})) {
    const oldRoom = from.rooms.find((room) => room.id === roomId);
    const newRoom = to.rooms.find((room) => room.id === operation.targetRoomId);
    if (!oldRoom || !from.staticChallenges.some((room) => room.id === roomId))
      return `布局映射引用未知旧静态房间：${roomId}`;
    if (operation.targetRoomId !== null && !newRoom) return `布局映射引用未知新房间：${roomId}`;
    if (operation.kind === "archive") {
      if (
        operation.objectiveId !== mapped(oldRoom.goal, mapping.objectiveIds) ||
        !to.objectives.some((objective) => objective.id === operation.objectiveId)
      )
        return `归档房间缺少合法通行目标：${roomId}`;
      for (const [position, oldId, newId] of [
        [operation.safeEntrance, oldRoom.returnTileId, newRoom?.returnTileId],
        [operation.successExit, oldRoom.successExitTileId, newRoom?.successExitTileId],
      ] as const) {
        const tile = to.tiles.find((candidate) => candidate.id === position.tileId);
        if (
          position.space !== "world" ||
          !tile ||
          tile.terrain !== "floor" ||
          tile.boardId !== position.boardId ||
          position.boardId !== position.areaId ||
          position.tileId !== (newId ?? mapped(oldId, mapping.tileIds))
        )
          return `归档房间缺少明确合法安全入口或成功出口：${roomId}`;
      }
    } else {
      const oldDefinition = from.staticChallenges.find((room) => room.id === roomId)!;
      const newDefinition = to.staticChallenges.find((room) => room.id === operation.targetRoomId);
      if (
        !operation.mappingId ||
        !newDefinition ||
        JSON.stringify(mapDefinition(oldDefinition, mapping)) !== JSON.stringify(newDefinition)
      )
        return `兼容布局缺少一一语义证明：${roomId}`;
    }
  }
  return null;
}

function mapDefinition(definition: unknown, mapping: ContentMapping): unknown {
  return JSON.parse(JSON.stringify(definition), (_key, value: unknown) =>
    typeof value === "string"
      ? mapped(value, _key === "boardId" ? mapping.boardIds : mapping.tileIds)
      : value,
  ) as unknown;
}

export function hasCompatibleLayoutMapping(
  step: MigrationStep,
  roomId: string,
  releases: readonly GameContent[],
): boolean {
  const mapping = step.kind === "mapped" ? step.mapping : {};
  const explicit = Object.entries(mapping.roomLayouts ?? {}).find(
    ([id, operation]) => id === roomId || operation.targetRoomId === roomId,
  );
  if (explicit?.[1].kind === "archive") return false;
  const source = releases.find((release) => key(releaseVersion(release)) === key(step.from));
  const target = releases.find((release) => key(releaseVersion(release)) === key(step.to));
  const before = source?.staticChallenges.find((room) => room.id === (explicit?.[0] ?? roomId));
  const after = target?.staticChallenges.find((room) => room.id === roomId);
  return (
    !!before && !!after && JSON.stringify(mapDefinition(before, mapping)) === JSON.stringify(after)
  );
}

export function migrationMappingId(step: MigrationStep): string {
  return `migration.${step.kind}.${key(step.from).replaceAll(":", ".").toLowerCase()}-to-${key(step.to).replaceAll(":", ".").toLowerCase()}`;
}

export function applyMigrationStep(
  payload: SavePayload,
  step: ResolvedMigrationStep,
): { ok: true; value: SavePayload; notes: string[] } | { ok: false; error: string } {
  const { from, to, definition } = step;
  const conflict = checkContentPreservation(from, to, definition);
  if (conflict) return { ok: false, error: conflict };
  const mapping: ContentMapping = definition.kind === "mapped" ? definition.mapping : {};
  const next = structuredClone(payload);
  next.playerPosition = mapPosition(next.playerPosition, mapping);
  next.discoveredTileIds = next.discoveredTileIds.map((id) => mapped(id, mapping.tileIds));
  next.visitedTileIds = next.visitedTileIds.map((id) => mapped(id, mapping.tileIds));
  next.completedObjectiveIds = next.completedObjectiveIds.map((id) =>
    mapped(id, mapping.objectiveIds),
  );
  next.claimedRewardIds = next.claimedRewardIds.map((id) => mapped(id, mapping.rewardIds));
  const notes: string[] = [];
  next.completedRoomLayouts = {};
  for (const [roomId, record] of Object.entries(payload.completedRoomLayouts)) {
    if (from.contentVersion === to.contentVersion && from.ruleVersion === to.ruleVersion) {
      next.completedRoomLayouts[roomId] = structuredClone(record);
      continue;
    }
    const operation = mapping.roomLayouts?.[roomId];
    const definitionFrom = from.staticChallenges.find((room) => room.id === roomId);
    const definitionTo = to.staticChallenges.find(
      (room) => room.id === (operation?.targetRoomId ?? roomId),
    );
    if (!definitionFrom) return { ok: false, error: `缺少旧布局来源房间：${roomId}` };
    const changed =
      !definitionTo ||
      JSON.stringify(mapDefinition(definitionFrom, mapping)) !== JSON.stringify(definitionTo);
    if (changed && operation?.kind !== "archive")
      return { ok: false, error: `旧完成布局没有明确归档或兼容映射：${roomId}` };
    const archive = {
      roomId,
      contentVersion: record.contentVersion,
      ruleVersion: record.ruleVersion,
      layout: structuredClone(record.layout),
    };
    const existing = next.archivedCompletedRoomLayouts.find(
      (item) =>
        item.roomId === archive.roomId &&
        item.contentVersion === archive.contentVersion &&
        item.ruleVersion === archive.ruleVersion,
    );
    if (existing && !sameJsonValue(existing.layout, archive.layout))
      return { ok: false, error: `历史完成布局键冲突：${roomId}` };
    if (!existing) next.archivedCompletedRoomLayouts.push(archive);
    if (operation?.kind !== "archive") {
      const mappedLayout = mapCompletedLayout(record.layout, mapping);
      next.completedRoomLayouts[operation?.targetRoomId ?? roomId] = {
        contentVersion: to.contentVersion,
        ruleVersion: to.ruleVersion,
        layout: mappedLayout,
        source: {
          contentVersion: record.contentVersion,
          ruleVersion: record.ruleVersion,
          mappingId:
            operation?.kind === "compatible" ? operation.mappingId : migrationMappingId(definition),
        },
      };
    } else
      notes.push(`房间 ${roomId} 已更新；旧完成布局已归档，原通行及奖励保留，可主动重新体验。`);
  }
  if (next.room) {
    next.room.returnAnchor = mapPosition(next.room.returnAnchor, mapping);
    const roomOperation = mapping.roomLayouts?.[next.room.roomId];
    const archivedVisit = roomOperation?.kind === "archive";
    if (mapping.exitRoomIds?.includes(next.room.roomId) || archivedVisit) {
      notes.push(
        `房间 ${next.room.roomId} 的旧布局无法映射，已回到安全入口；已完成目标与物资保留。`,
      );
      next.playerPosition = structuredClone(
        archivedVisit ? roomOperation.safeEntrance : next.room.returnAnchor,
      );
      if (!next.discoveredTileIds.includes(next.playerPosition.tileId))
        next.discoveredTileIds.push(next.playerPosition.tileId);
      if (!next.visitedTileIds.includes(next.playerPosition.tileId))
        next.visitedTileIds.push(next.playerPosition.tileId);
      next.room = null;
    } else if (next.room.status !== "completedVisit") {
      next.room.currentLayout = mapLayout(next.room.currentLayout, mapping);
      next.room.attemptBaseline = {
        playerTileId: mapped(next.room.attemptBaseline.playerTileId, mapping.tileIds),
        layout: mapLayout(next.room.attemptBaseline.layout, mapping),
      };
      next.room.pendingEffects = {
        objectiveIds: next.room.pendingEffects.objectiveIds.map((id) =>
          mapped(id, mapping.objectiveIds),
        ),
        rewardIds: next.room.pendingEffects.rewardIds.map((id) => mapped(id, mapping.rewardIds)),
      };
    }
  }
  if (next.room) {
    const roomOperation = mapping.roomLayouts?.[next.room.roomId];
    if (roomOperation?.kind === "compatible") next.room.roomId = roomOperation.targetRoomId;
    const definitionTo = to.staticChallenges.find((room) => room.id === next.room?.roomId);
    if (!definitionTo) return { ok: false, error: "迁移缺少当前活动房间定义" };
    const compatible =
      next.room.status === "completedVisit"
        ? (() => {
            const layout = next.completedRoomLayouts[next.room!.roomId]?.layout;
            return (
              layout &&
              (to.ruleVersion < 4
                ? historicalStatic.isCompletedStaticPosition(
                    definitionTo as unknown as historicalStatic.StaticDefinition,
                    layout as unknown as historicalStatic.CompletedStaticLayout,
                    next.playerPosition.tileId,
                  )
                : validateCompletedStaticLayout(definitionTo, layout).length === 0 &&
                  isCompletedStaticPosition(definitionTo, layout, next.playerPosition.tileId))
            );
          })()
        : (to.ruleVersion < 4 ? historicalStatic.validateStaticState : validateStaticState)(
            definitionTo as never,
            {
              phase: next.room.status,
              currentLayout: next.room.currentLayout,
              attemptBaseline: next.room.attemptBaseline,
              undoStack: [],
            } as never,
            next.playerPosition.tileId,
          ).length === 0;
    if (!compatible)
      return { ok: false, error: "旧活动或完成访问布局/玩家坐标不兼容，缺少明确安全退出映射" };
  }
  next.contentVersion = to.contentVersion;
  next.ruleVersion = to.ruleVersion;
  next.releaseProfileId = to.profile.id;
  const units = (content: GameContent, value: SavePayload) =>
    content.rewards.reduce(
      (sum, reward) => sum + (value.claimedRewardIds.includes(reward.id) ? reward.units : 0),
      0,
    );
  if (units(from, payload) !== units(to, next))
    return { ok: false, error: "迁移改变了已领取物资总额" };
  for (const gate of from.gates) {
    const destination = to.gates.find((candidate) => candidate.id === gate.id);
    if (
      !destination ||
      gateSatisfied(from, payload, gate.condition) !==
        gateSatisfied(to, next, destination.condition)
    )
      return { ok: false, error: `迁移改变既有门禁 ${gate.id} 的结果` };
  }
  if (from.ruleVersion !== to.ruleVersion)
    notes.push(
      `规则集已升级至 v${to.ruleVersion}；成绩按各挑战规则版本保留，规则变更的旧成绩为历史记录，已领取物资不变。`,
    );
  if (from.profile.id !== to.profile.id)
    notes.push(`新增 ${to.profile.id} 内容；既有进度保留，新增区域从初始状态开始。`);
  return { ok: true, value: next, notes };
}
