import { createGame, worldPosition } from "../core/engine.ts";
import { createClock } from "../core/clock.ts";
import { createStatic, validateStaticState } from "../core/static-puzzle.ts";
import type { StaticLayout, StaticSnapshot, StaticState } from "../core/static-puzzle.ts";
import { gateSatisfied } from "../core/progress.ts";
import type {
  GameContent,
  GameState,
  PlayerPosition,
  ProfileId,
  ProgressState,
} from "../core/types.ts";

export interface StableRoom {
  roomId: string;
  status: "preview" | "active";
  returnAnchor: PlayerPosition;
  currentLayout: StaticLayout;
  attemptBaseline: StaticSnapshot;
  pendingEffects: { objectiveIds: string[]; rewardIds: string[] };
  practice: boolean;
}
export interface SavePayload extends ProgressState {
  room: StableRoom | null;
  resumeHint: { kind: "restartChallenge"; challengeId: string } | null;
}
export type PayloadValidation =
  | { ok: true; value: SavePayload; migrated?: boolean }
  | { ok: false; kind: "future" | "invalid"; error: string };
const PROGRESS_FIELDS = [
  "gameId",
  "schemaVersion",
  "contentVersion",
  "ruleVersion",
  "releaseProfileId",
  "completedObjectiveIds",
  "claimedRewardIds",
  "activatedTeleportIds",
  "capabilities",
  "playerPosition",
  "discoveredTileIds",
  "visitedTileIds",
  "clearedEtherNodeIds",
  "revealedGroupIds",
  "bestResults",
  "scopeCompletionHistory",
  "campaignCompletedAt",
  "settings",
  "stateRevision",
] as const;
const identifier = /^[a-z0-9][a-z0-9.-]*$/;
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function stringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((id) => typeof id === "string" && identifier.test(id)) &&
    new Set(value).size === value.length
  );
}
function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => required.includes(key) || optional.includes(key))
  );
}

export function stablePayload(state: GameState): SavePayload {
  const progress = Object.fromEntries(
    PROGRESS_FIELDS.map((key) => [key, structuredClone(state[key])]),
  ) as unknown as ProgressState;
  let room: StableRoom | null = null;
  let resumeHint: SavePayload["resumeHint"] = null;
  if (state.activeStatic) {
    const active = state.activeStatic;
    room = {
      roomId: active.roomId,
      status: active.state.phase === "preview" ? "preview" : "active",
      returnAnchor: structuredClone(active.returnAnchor),
      currentLayout: structuredClone(active.state.currentLayout),
      attemptBaseline: structuredClone(active.state.attemptBaseline),
      pendingEffects: {
        objectiveIds: [...active.state.currentLayout.pendingObjectiveIds],
        rewardIds: [...active.state.currentLayout.pendingRewardIds],
      },
      practice: active.practice,
    };
  } else if (state.activeRealtime) {
    progress.playerPosition = structuredClone(state.activeRealtime.returnAnchor);
    if (state.mode === "challengeRunning")
      resumeHint = { kind: "restartChallenge", challengeId: state.activeRealtime.roomId };
  }
  return { ...progress, room, resumeHint };
}

export function validatePayload(raw: unknown, content: GameContent): PayloadValidation {
  const invalid = (error: string): PayloadValidation => ({ ok: false, kind: "invalid", error });
  if (!object(raw)) return invalid("存档载荷必须是对象");
  if (raw.gameId !== content.gameId) return invalid("此文件不属于沙罗黄金周");
  for (const field of ["schemaVersion", "contentVersion", "ruleVersion"] as const)
    if (!Number.isSafeInteger(raw[field]) || (raw[field] as number) < 1)
      return invalid(`版本字段不合法：${field}`);
  if (
    (raw.schemaVersion as number) > 1 ||
    (raw.contentVersion as number) > content.contentVersion ||
    (raw.ruleVersion as number) > content.ruleVersion
  )
    return {
      ok: false,
      kind: "future",
      error: "此进度来自较新版本，请使用匹配或更新的构建；原档已保护",
    };
  if (!exactKeys(raw, [...PROGRESS_FIELDS, "room", "resumeHint"]))
    return invalid("存档缺少必需字段或包含未知字段");
  const profile = content.releaseProfiles.find(
    (candidate) => candidate.id === raw.releaseProfileId,
  );
  if (!profile) return invalid("未知发布 profile");
  const sourceStage = Number(profile.id.slice(1));
  if (sourceStage > Number(content.profile.id.slice(1)))
    return { ok: false, kind: "future", error: "此存档来自较新的内容包，不能在当前包覆盖" };
  if (raw.contentVersion !== Math.min(sourceStage, 4))
    return invalid("contentVersion 与来源 profile 不对应，缺少明确迁移");
  if (raw.schemaVersion !== 1) return invalid("不支持此结构版本");
  if (!Number.isSafeInteger(raw.stateRevision) || (raw.stateRevision as number) < 0)
    return invalid("状态修订号无效");
  for (const field of [
    "completedObjectiveIds",
    "claimedRewardIds",
    "activatedTeleportIds",
    "discoveredTileIds",
    "visitedTileIds",
    "clearedEtherNodeIds",
    "revealedGroupIds",
  ] as const)
    if (!stringArray(raw[field])) return invalid(`集合包含非法或重复 ID：${field}`);
  if (
    !Array.isArray(raw.capabilities) ||
    raw.capabilities.some((id) => id !== "amplifier" && id !== "unlimitedAmplifier") ||
    new Set(raw.capabilities).size !== raw.capabilities.length
  )
    return invalid("未知或重复能力");
  if (
    !Array.isArray(raw.scopeCompletionHistory) ||
    raw.scopeCompletionHistory.some((id) => typeof id !== "string" || !/^M[1-5]$/.test(id)) ||
    new Set(raw.scopeCompletionHistory).size !== raw.scopeCompletionHistory.length
  )
    return invalid("包内完成记录不合法");
  if (
    raw.campaignCompletedAt !== null &&
    (typeof raw.campaignCompletedAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T/.test(raw.campaignCompletedAt) ||
      !Number.isFinite(Date.parse(raw.campaignCompletedAt)))
  )
    return invalid("完成时间不合法");
  if (
    !object(raw.settings) ||
    !exactKeys(raw.settings, [
      "masterVolume",
      "muted",
      "reducedFlash",
      "reducedMotion",
      "quality",
      "zoom",
    ])
  )
    return invalid("设置字段不合法");
  const settings = raw.settings;
  if (
    typeof settings.masterVolume !== "number" ||
    !Number.isFinite(settings.masterVolume) ||
    typeof settings.zoom !== "number" ||
    !Number.isFinite(settings.zoom) ||
    [settings.muted, settings.reducedFlash, settings.reducedMotion].some(
      (flag) => typeof flag !== "boolean",
    ) ||
    !["standard", "low"].includes(String(settings.quality))
  )
    return invalid("设置包含非法数值或选项");
  if (!Array.isArray(raw.bestResults)) return invalid("成绩列表无效");
  for (const entry of raw.bestResults) {
    if (
      !object(entry) ||
      !exactKeys(
        entry,
        ["challengeId", "ruleVersion"],
        ["bestScore", "bestCombo", "bestStarClear"],
      ) ||
      typeof entry.challengeId !== "string" ||
      !Number.isSafeInteger(entry.ruleVersion) ||
      (entry.ruleVersion as number) < 1 ||
      (entry.ruleVersion as number) > content.ruleVersion
    )
      return invalid("成绩版本或结构无效");
    const definition = content.realtimeChallenges.find(
      (candidate) => candidate.id === entry.challengeId,
    );
    if (!definition || !profile.includedObjectiveIds.includes(entry.challengeId))
      return invalid(`未知挑战成绩：${entry.challengeId}`);
    for (const field of ["bestScore", "bestCombo", "bestStarClear"] as const)
      if (
        entry[field] !== undefined &&
        (!Number.isSafeInteger(entry[field]) || (entry[field] as number) < 0)
      )
        return invalid(`成绩不是非负整数：${field}`);
    if (
      definition.kind === "firewall" &&
      (entry.bestScore !== undefined ||
        entry.bestStarClear !== undefined ||
        typeof entry.bestCombo !== "number" ||
        entry.bestCombo > definition.rules.beatMasks.length)
    )
      return invalid("防火墙成绩超出理论范围");
    if (
      definition.kind === "antivirus" &&
      (entry.bestCombo !== undefined ||
        typeof entry.bestScore !== "number" ||
        entry.bestScore >
          definition.rules.spawns.reduce(
            (sum, spawn) => sum + (spawn.kind === "blue" ? 1 : spawn.kind === "purple" ? 2 : 0),
            0,
          ) ||
        typeof entry.bestStarClear !== "number" ||
        entry.bestStarClear > definition.rules.spawns.length)
    )
      return invalid("杀毒成绩超出理论范围");
  }
  const resultKeys = raw.bestResults.map(
    (entry: { challengeId: string; ruleVersion: number }) =>
      `${entry.challengeId}:${entry.ruleVersion}`,
  );
  if (new Set(resultKeys).size !== resultKeys.length) return invalid("重复的挑战成绩版本");
  const payload = structuredClone(raw) as unknown as SavePayload;
  const sourceContent = { ...content, profile };
  for (const id of payload.completedObjectiveIds) {
    const objective = content.catalogObjectives.find((candidate) => candidate.id === id);
    if (!objective || !profile.includedObjectiveIds.includes(id))
      return invalid(`未知或来源包未收录的目标：${id}`);
    if (!gateSatisfied(sourceContent, payload, objective.prerequisites))
      return invalid(`目标前置未满足：${id}`);
  }
  for (const objective of content.catalogObjectives.filter(
    (item) => item.kind === "aggregate" && item.includedFrom <= sourceStage,
  ))
    if (
      gateSatisfied(sourceContent, payload, objective.prerequisites) !==
      payload.completedObjectiveIds.includes(objective.id)
    )
      return invalid(`聚合目标与前置不一致：${objective.id}`);
  for (const id of payload.claimedRewardIds) {
    const reward = content.catalogRewards.find((candidate) => candidate.id === id);
    if (
      !reward ||
      !profile.includedRewardIds.includes(id) ||
      !gateSatisfied(sourceContent, payload, reward.prerequisites)
    )
      return invalid(`奖励来源或前置不合法：${id}`);
  }
  for (const reward of content.catalogRewards.filter(
    (item) => item.includedFrom <= sourceStage && item.claimMode === "grant",
  ))
    if (
      gateSatisfied(sourceContent, payload, reward.prerequisites) !==
      payload.claimedRewardIds.includes(reward.id)
    )
      return invalid(`成功事务与奖励不一致：${reward.id}`);
  const expectedCapabilities = (
    [
      payload.completedObjectiveIds.includes("hub.amplifier") ? "amplifier" : null,
      payload.completedObjectiveIds.includes("hub.tutorial") ? "unlimitedAmplifier" : null,
    ] as const
  ).filter((id) => id !== null);
  if (
    expectedCapabilities.length !== payload.capabilities.length ||
    expectedCapabilities.some((id) => !payload.capabilities.includes(id))
  )
    return invalid("能力与取得目标不一致");
  const sourceTile = (id: string) =>
    content.tiles.find((tile) => tile.id === id && tile.includedFrom <= sourceStage);
  for (const id of payload.discoveredTileIds) {
    const tile = sourceTile(id);
    if (!tile) return invalid(`未知已发现格：${id}`);
    if (tile.hiddenGroupId && !payload.revealedGroupIds.includes(tile.hiddenGroupId))
      return invalid(`隐藏格尚未揭示：${id}`);
  }
  for (const id of payload.visitedTileIds)
    if (!payload.discoveredTileIds.includes(id) || sourceTile(id)?.terrain !== "floor")
      return invalid(`访问格未发现或不可通行：${id}`);
  for (const id of payload.clearedEtherNodeIds) {
    const nexus = content.entities.find((entity) => entity.id === id);
    if (
      nexus?.kind !== "nexus" ||
      nexus.includedFrom > sourceStage ||
      !payload.completedObjectiveIds.includes(nexus.params.completionObjectiveId)
    )
      return invalid(`富集清除记录不合法：${id}`);
  }
  for (const nexus of content.entities.filter(
    (entity) => entity.kind === "nexus" && entity.includedFrom <= sourceStage,
  )) {
    if (
      nexus.kind === "nexus" &&
      payload.clearedEtherNodeIds.includes(nexus.id) !==
        payload.completedObjectiveIds.includes(nexus.params.completionObjectiveId)
    )
      return invalid(`富集目标与清除记录不一致：${nexus.id}`);
  }
  for (const id of payload.revealedGroupIds)
    if (!content.areas.some((area) => area.revealGroups.some((group) => group.id === id)))
      return invalid(`未知显露组：${id}`);
  for (const area of content.areas.filter((item) => item.includedFrom <= sourceStage)) {
    if (
      payload.activatedTeleportIds.includes(area.teleportId) !==
      payload.visitedTileIds.includes(area.entryTileId)
    )
      return invalid(`传送点激活来源不一致：${area.teleportId}`);
  }
  for (const id of payload.activatedTeleportIds)
    if (!content.areas.some((area) => area.teleportId === id && area.includedFrom <= sourceStage))
      return invalid(`未知传送点：${id}`);
  const validatePosition = (position: unknown, worldOnly: boolean): string | null => {
    if (
      !object(position) ||
      !exactKeys(position, ["space", "areaId", "boardId", "tileId"]) ||
      (position.space !== "world" && position.space !== "room") ||
      typeof position.areaId !== "string" ||
      typeof position.boardId !== "string" ||
      typeof position.tileId !== "string"
    )
      return "位置结构无效";
    if (!profile.includedAreaIds.includes(position.areaId as PlayerPosition["areaId"]))
      return "位置所属区域未收录";
    if (position.space === "world") {
      const tile = sourceTile(position.tileId);
      if (
        !tile ||
        tile.terrain !== "floor" ||
        tile.boardId !== position.areaId ||
        position.boardId !== position.areaId ||
        !payload.discoveredTileIds.includes(tile.id) ||
        !payload.visitedTileIds.includes(tile.id)
      )
        return "位置不是已发现且可通行的合法格";
      if (
        tile.etherGroupId &&
        !payload.clearedEtherNodeIds.some((id) => {
          const entity = content.entities.find((candidate) => candidate.id === id);
          return entity?.kind === "nexus" && entity.params.clearsTileIds.includes(tile.id);
        })
      )
        return "位置仍被以太覆盖";
      for (const entity of content.entities.filter(
        (candidate) =>
          candidate.tileId === tile.id &&
          (candidate.kind === "door" || candidate.kind === "supply"),
      )) {
        const gate = content.gates.find((candidate) => candidate.id === entity.gateId);
        if (!gate || !gateSatisfied(sourceContent, payload, gate.condition))
          return "位置位于未开放的门或奖励格";
      }
    } else if (worldOnly) return "返回入口必须在世界空间";
    return null;
  };
  const positionError = validatePosition(raw.playerPosition, false);
  if (positionError) return invalid(positionError);
  if (payload.room !== null) {
    if (
      !object(raw.room) ||
      !exactKeys(raw.room, [
        "roomId",
        "status",
        "returnAnchor",
        "currentLayout",
        "attemptBaseline",
        "pendingEffects",
        "practice",
      ]) ||
      typeof raw.room.roomId !== "string" ||
      !["preview", "active"].includes(String(raw.room.status)) ||
      typeof raw.room.practice !== "boolean"
    )
      return invalid("静态房间结构不合法");
    const definition = content.staticChallenges.find(
      (candidate) => candidate.id === payload.room?.roomId,
    );
    const room = content.rooms.find((candidate) => candidate.id === payload.room?.roomId);
    if (
      !definition ||
      !room ||
      room.includedFrom > sourceStage ||
      payload.playerPosition.space !== "room" ||
      payload.playerPosition.boardId !== definition.boardId ||
      payload.playerPosition.areaId !== room.areaId
    )
      return invalid("活动房间与玩家空间不一致");
    const anchorError = validatePosition(payload.room.returnAnchor, true);
    if (
      anchorError ||
      payload.room.returnAnchor.tileId !== room.returnTileId ||
      payload.room.returnAnchor.areaId !== room.areaId
    )
      return invalid(anchorError ?? "房间返回锚点不匹配");
    const staticState: StaticState = {
      phase: payload.room.status,
      currentLayout: payload.room.currentLayout,
      attemptBaseline: payload.room.attemptBaseline,
      undoStack: [],
    };
    const errors = validateStaticState(definition, staticState, payload.playerPosition.tileId);
    if (errors.length) return invalid(`非法房间布局：${errors.join("；")}`);
    if (
      !object(raw.room.pendingEffects) ||
      !exactKeys(raw.room.pendingEffects, ["objectiveIds", "rewardIds"]) ||
      !stringArray(raw.room.pendingEffects.objectiveIds) ||
      !stringArray(raw.room.pendingEffects.rewardIds)
    )
      return invalid("待发结果结构无效");
    const effect = content.effects.find((candidate) => candidate.id === room.effectBundleId);
    for (const id of payload.room.pendingEffects.objectiveIds)
      if (!effect?.completeObjectiveIds.includes(id) || payload.completedObjectiveIds.includes(id))
        return invalid(`待发目标不属于当前尝试：${id}`);
    for (const id of payload.room.pendingEffects.rewardIds)
      if (!effect?.grantRewardIds.includes(id) || payload.claimedRewardIds.includes(id))
        return invalid(`待发奖励不属于当前尝试：${id}`);
    if (
      JSON.stringify(payload.room.pendingEffects.objectiveIds) !==
        JSON.stringify(payload.room.currentLayout.pendingObjectiveIds) ||
      JSON.stringify(payload.room.pendingEffects.rewardIds) !==
        JSON.stringify(payload.room.currentLayout.pendingRewardIds)
    )
      return invalid("局部布局与待发结果不一致");
    if (payload.room.practice !== payload.completedObjectiveIds.includes(room.goal))
      return invalid("练习状态与房间完成记录不一致");
  } else if (payload.playerPosition.space !== "world") return invalid("局部玩家位置缺少活动房间");
  if (payload.resumeHint !== null) {
    if (
      !object(raw.resumeHint) ||
      !exactKeys(raw.resumeHint, ["kind", "challengeId"]) ||
      raw.resumeHint.kind !== "restartChallenge" ||
      typeof raw.resumeHint.challengeId !== "string"
    )
      return invalid("实时恢复提示不合法");
    const room = content.rooms.find(
      (candidate) => candidate.id === payload.resumeHint?.challengeId,
    );
    if (
      !room ||
      room.mode !== "challengeRunning" ||
      room.includedFrom > sourceStage ||
      payload.room !== null ||
      payload.playerPosition.tileId !== room.returnTileId ||
      payload.playerPosition.areaId !== room.areaId
    )
      return invalid("实时恢复入口不匹配");
  }
  for (const history of payload.scopeCompletionHistory) {
    const historicalProfile = content.releaseProfiles.find((candidate) => candidate.id === history);
    if (
      !historicalProfile ||
      Number(history.slice(1)) > sourceStage ||
      !payload.completedObjectiveIds.includes(historicalProfile.scopeTerminalObjectiveId)
    )
      return invalid("包内结算记录与目标不一致");
  }
  if (
    payload.completedObjectiveIds.includes("warehouse.complete") !==
    (payload.campaignCompletedAt !== null)
  )
    return invalid("最终结算记录与仓库目标不一致");
  payload.settings.masterVolume = Math.min(1, Math.max(0, payload.settings.masterVolume));
  payload.settings.zoom = Math.min(1.5, Math.max(0.75, payload.settings.zoom));
  const migrated =
    payload.contentVersion !== content.contentVersion ||
    payload.releaseProfileId !== content.profile.id ||
    payload.ruleVersion !== content.ruleVersion;
  // v1–v4 are additive releases. Existing coordinates and IDs remain unchanged;
  // any layout/ID rewrite requires a separately registered, reviewed mapping.
  payload.contentVersion = content.contentVersion;
  payload.releaseProfileId = content.profile.id;
  payload.ruleVersion = content.ruleVersion;
  return migrated ? { ok: true, value: payload, migrated: true } : { ok: true, value: payload };
}

export function restorePayload(
  payload: SavePayload,
  content: GameContent,
  monotonicTimeMs: number,
): GameState {
  const state = createGame(content, monotonicTimeMs);
  for (const field of PROGRESS_FIELDS)
    Object.assign(state, { [field]: structuredClone(payload[field]) });
  state.resumeHint = structuredClone(payload.resumeHint);
  if (payload.room) {
    const definition = content.staticChallenges.find(
      (candidate) => candidate.id === payload.room?.roomId,
    );
    if (!definition) throw new Error("房间定义未找到");
    const room = structuredClone(payload.room);
    if (room.status === "preview") {
      const reset = createStatic(definition);
      state.activeStatic = {
        roomId: room.roomId,
        returnAnchor: room.returnAnchor,
        state: reset.state,
        practice: room.practice,
      };
      state.playerPosition = { ...payload.playerPosition, tileId: reset.playerTileId };
    } else
      state.activeStatic = {
        roomId: room.roomId,
        returnAnchor: room.returnAnchor,
        state: {
          phase: "active",
          currentLayout: room.currentLayout,
          attemptBaseline: room.attemptBaseline,
          undoStack: [],
        },
        practice: room.practice,
      };
    state.mode = "staticPuzzle";
    state.phase = room.status;
    state.lastResult = {
      code: "accepted",
      message:
        room.status === "preview"
          ? "已恢复 · 重新完整观察 4 秒"
          : "已恢复当前布局 · 撤销历史已清空，可重置房间",
    };
  } else {
    state.playerPosition = worldPosition(
      payload.playerPosition.areaId,
      payload.playerPosition.tileId,
    );
    state.lastResult = {
      code: "accepted",
      message: payload.resumeHint ? "上次挑战未结算，可重新开始" : "进度已恢复",
    };
  }
  state.clock = createClock(monotonicTimeMs);
  return state;
}

export function payloadSummary(payload: SavePayload, content: GameContent): string {
  const units = content.catalogRewards.reduce(
    (sum, reward) => sum + (payload.claimedRewardIds.includes(reward.id) ? reward.units : 0),
    0,
  );
  return `${payload.releaseProfileId} · ${payload.playerPosition.areaId.toUpperCase()} 区 · ${units} 单位物资 · 已完成 ${payload.completedObjectiveIds.filter((id) => id.endsWith(".main")).length} 区主路径`;
}

export function previousProfile(id: ProfileId): ProfileId | null {
  const stage = Number(id.slice(1));
  return stage > 1 ? (`M${stage - 1}` as ProfileId) : null;
}
