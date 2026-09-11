import {
  activateStatic,
  createCompletedStaticLayout,
  createStatic,
  moveCompletedStatic,
  moveStatic,
  resetStatic,
  undoStatic,
  validateCompletedStaticLayout,
} from "./static-puzzle.ts";
import { advanceRealtime, createRealtime } from "./realtime.ts";
import type { RealtimeInput } from "./realtime.ts";
import {
  advanceClock,
  clockAcceptsInput,
  createClock,
  resumeClock,
  setClockPauseReason,
} from "./clock.ts";
import { addUnique, gateOpen, gateReason, gateSatisfied } from "./progress.ts";
import type {
  ActiveRealtimeRoom,
  Direction,
  EntityDefinition,
  FeedbackEvent,
  GameCommand,
  GameContent,
  GameState,
  PlayerPosition,
  RuleResult,
} from "./types.ts";

export const DIRECTION_OFFSETS: Record<Direction, readonly [number, number]> = {
  up: [0, -1],
  right: [1, 0],
  down: [0, 1],
  left: [-1, 0],
};
const DIRECTIONS: Direction[] = ["up", "right", "down", "left"];

export function worldPosition(areaId: PlayerPosition["areaId"], tileId: string): PlayerPosition {
  return { space: "world", areaId, boardId: areaId, tileId };
}

export function entitiesAt(content: GameContent, tileId: string): EntityDefinition[] {
  return content.entities.filter((entity) => entity.tileId === tileId);
}

export function tileCleared(content: GameContent, state: GameState, tileId: string): boolean {
  const tile = content.tiles.find((candidate) => candidate.id === tileId);
  if (!tile?.etherGroupId) return true;
  return content.entities.some(
    (entity) =>
      entity.kind === "nexus" &&
      state.clearedEtherNodeIds.includes(entity.id) &&
      entity.params.clearsTileIds.includes(tileId),
  );
}

export function tileRevealed(content: GameContent, state: GameState, tileId: string): boolean {
  const tile = content.tiles.find((candidate) => candidate.id === tileId);
  return !!tile && (!tile.hiddenGroupId || state.revealedGroupIds.includes(tile.hiddenGroupId));
}

function discover(content: GameContent, state: GameState, tileId: string): number {
  const tile = content.tiles.find((candidate) => candidate.id === tileId);
  if (!tile) return 0;
  let count = 0;
  for (const candidate of content.tiles) {
    if (
      candidate.boardId === tile.boardId &&
      Math.abs(candidate.x - tile.x) + Math.abs(candidate.y - tile.y) <= 1 &&
      tileRevealed(content, state, candidate.id)
    ) {
      if (addUnique(state.discoveredTileIds, candidate.id)) count += 1;
    }
  }
  addUnique(state.visitedTileIds, tileId);
  return count;
}

export function createGame(content: GameContent, monotonicTimeMs = 0): GameState {
  const state: GameState = {
    gameId: content.gameId,
    schemaVersion: 2,
    contentVersion: content.contentVersion,
    ruleVersion: content.ruleVersion,
    releaseProfileId: content.profile.id,
    completedObjectiveIds: [],
    completedRoomLayouts: {},
    claimedRewardIds: [],
    activatedTeleportIds: [],
    capabilities: [],
    playerPosition: worldPosition(content.entry.areaId, content.entry.tileId),
    discoveredTileIds: content.tiles.filter((tile) => tile.initialDiscovery).map((tile) => tile.id),
    visitedTileIds: [],
    clearedEtherNodeIds: [],
    revealedGroupIds: [],
    bestResults: [],
    scopeCompletionHistory: [],
    campaignCompletedAt: null,
    settings: {
      masterVolume: 0.6,
      muted: false,
      reducedFlash: false,
      reducedMotion: false,
      quality: "standard",
      zoom: 1,
    },
    stateRevision: 0,
    mode: "explore",
    phase: "active",
    clock: createClock(monotonicTimeMs),
    activeStatic: null,
    activeCompletedRoom: null,
    activeRealtime: null,
    autoPath: [],
    feedbackSequence: 0,
    lastResult: { code: "accepted", message: "欢迎进入中心区 · 方向键移动，F 交互" },
    resumeHint: null,
  };
  discover(content, state, content.entry.tileId);
  const area = content.areas.find((candidate) => candidate.id === content.entry.areaId);
  if (area) addUnique(state.activatedTeleportIds, area.teleportId);
  return state;
}

/** No input adapter, renderer, persistence callback, or witness may mutate progress. */
export function dispatch(
  content: GameContent,
  previous: GameState,
  command: GameCommand,
  monotonicTimeMs: number,
  displayTimeIso = "1970-01-01T00:00:00.000Z",
): RuleResult {
  const state: GameState = command.kind === "Tick" ? { ...previous } : structuredClone(previous);
  const events: FeedbackEvent[] = [];
  let stable = false;
  let clearInputs = false;
  let code = "accepted";
  const emit = (kind: FeedbackEvent["kind"], message: string) => {
    state.feedbackSequence += 1;
    events.push({ id: state.feedbackSequence, kind, message });
  };
  const result = (nextCode = code, message?: string): RuleResult => {
    if (message !== undefined) state.lastResult = { code: nextCode, message };
    if (stable) state.stateRevision = previous.stateRevision + 1;
    return { state, code: nextCode, events, stable, clearInputs };
  };
  const reject = (reason: string, message: string) => {
    emit("invalid", message);
    return result(reason, message);
  };
  const claim = (id: string) => {
    const reward = content.rewards.find((item) => item.id === id);
    if (!reward || !gateSatisfied(content, state, reward.prerequisites)) return false;
    if (!addUnique(state.claimedRewardIds, id)) return false;
    emit("pickup", `物资 +${reward.units}`);
    return true;
  };
  const derive = () => {
    let changed: boolean;
    do {
      changed = false;
      for (const objective of content.objectives) {
        if (
          objective.kind === "aggregate" &&
          gateSatisfied(content, state, objective.prerequisites) &&
          addUnique(state.completedObjectiveIds, objective.id)
        )
          changed = true;
      }
    } while (changed);
    if (
      state.completedObjectiveIds.includes("hub.amplifier") &&
      !state.capabilities.includes("amplifier")
    )
      state.capabilities.push("amplifier");
    if (
      state.completedObjectiveIds.includes("hub.tutorial") &&
      !state.capabilities.includes("unlimitedAmplifier")
    )
      state.capabilities.push("unlimitedAmplifier");
    if (
      state.completedObjectiveIds.includes(content.profile.scopeTerminalObjectiveId) &&
      !state.scopeCompletionHistory.includes(content.profile.id)
    ) {
      state.scopeCompletionHistory.push(content.profile.id);
      emit(
        "success",
        content.profile.fullCampaign ? "主目标完成 · 可自由回访" : "本版本主路径完成，可继续收集",
      );
    }
    if (
      state.completedObjectiveIds.includes("warehouse.complete") &&
      state.campaignCompletedAt === null
    )
      state.campaignCompletedAt = displayTimeIso;
  };
  const applyEffect = (effectId: string): boolean => {
    const effect = content.effects.find((item) => item.id === effectId);
    if (!effect) return false;
    for (const id of effect.completeObjectiveIds) {
      const objective = content.objectives.find((item) => item.id === id);
      if (!objective || !gateSatisfied(content, state, objective.prerequisites)) return false;
    }
    let changed = false;
    for (const id of effect.completeObjectiveIds)
      changed = addUnique(state.completedObjectiveIds, id) || changed;
    for (const id of effect.revealGroupIds)
      changed = addUnique(state.revealedGroupIds, id) || changed;
    derive();
    for (const id of effect.grantRewardIds) changed = claim(id) || changed;
    if (changed) {
      stable = true;
      if (
        effect.completeObjectiveIds.some(
          (id) =>
            id.endsWith(".main") ||
            id.includes("permission") ||
            id.includes("firewall") ||
            id.includes("maze"),
        )
      )
        emit("door", "机关已完成 · 通路已开放");
    }
    return changed;
  };
  const arrive = (areaId: PlayerPosition["areaId"], tileId: string) => {
    state.playerPosition = worldPosition(areaId, tileId);
    discover(content, state, tileId);
    const area = content.areas.find((candidate) => candidate.id === areaId);
    if (area && area.entryTileId === tileId) addUnique(state.activatedTeleportIds, area.teleportId);
    state.mode = "explore";
    state.phase = "active";
    state.activeStatic = null;
    state.activeCompletedRoom = null;
    state.activeRealtime = null;
    state.clock = createClock(monotonicTimeMs);
    state.autoPath = [];
    state.resumeHint = null;
    clearInputs = true;
    stable = true;
  };
  const enterStatic = (roomId: string, practice = false): boolean => {
    const room = content.rooms.find((candidate) => candidate.id === roomId);
    const definition = content.staticChallenges.find((candidate) => candidate.id === roomId);
    if (!room || !definition) return false;
    const instance = createStatic(definition);
    state.activeCompletedRoom = null;
    state.activeStatic = {
      roomId,
      returnAnchor: worldPosition(room.areaId, room.returnTileId),
      state: instance.state,
      practice,
    };
    state.playerPosition = {
      space: "room",
      areaId: room.areaId,
      boardId: room.boardId,
      tileId: instance.playerTileId,
    };
    state.mode = "staticPuzzle";
    state.phase = instance.state.phase;
    state.clock = createClock(monotonicTimeMs);
    state.autoPath = [];
    clearInputs = true;
    stable = true;
    emit(
      "portal",
      definition.kind === "memory"
        ? "记住安全路线 · 观察 4 秒后开始"
        : "机关已启动 · Z 撤销，随时可重置",
    );
    return true;
  };
  const enterCompletedRoom = (roomId: string): boolean => {
    const room = content.rooms.find((candidate) => candidate.id === roomId);
    const definition = content.staticChallenges.find((candidate) => candidate.id === roomId);
    const layout = state.completedRoomLayouts[roomId];
    if (
      !room ||
      !definition ||
      !layout ||
      !state.completedObjectiveIds.includes(room.goal) ||
      validateCompletedStaticLayout(definition, layout).length > 0
    )
      return false;
    state.activeCompletedRoom = {
      roomId,
      returnAnchor: worldPosition(room.areaId, room.returnTileId),
    };
    state.activeStatic = null;
    state.activeRealtime = null;
    state.playerPosition = {
      space: "room",
      areaId: room.areaId,
      boardId: room.boardId,
      tileId: definition.startTileId,
    };
    state.mode = "completedRoom";
    state.phase = "complete";
    state.clock = createClock(monotonicTimeMs);
    state.autoPath = [];
    state.resumeHint = null;
    clearInputs = true;
    stable = true;
    emit("portal", "已完成布局 · 可自由行走，F 开始独立练习");
    return true;
  };
  const settleRealtime = (active: ActiveRealtimeRoom, succeeded: boolean) => {
    const room = content.rooms.find((candidate) => candidate.id === active.roomId);
    if (!room) return;
    if (succeeded && !active.practice) applyEffect(room.effectBundleId);
    const challenge = active.state;
    const record = state.bestResults.find(
      (item) => item.challengeId === active.roomId && item.ruleVersion === content.ruleVersion,
    ) ?? { challengeId: active.roomId, ruleVersion: content.ruleVersion };
    if (challenge.kind === "firewall")
      record.bestCombo = Math.max(record.bestCombo ?? 0, challenge.bestCombo);
    if (challenge.kind === "antivirus") {
      record.bestScore = Math.max(record.bestScore ?? 0, challenge.score);
      record.bestStarClear = Math.max(record.bestStarClear ?? 0, challenge.bestStarClearCount);
    }
    if (!state.bestResults.includes(record)) state.bestResults.push(record);
    state.mode = "challengeResult";
    state.clock = {
      ...state.clock,
      activeTimeMs: challenge.activeTimeMs,
      realtime: false,
      countdownRemainingMs: 0,
    };
    state.phase = succeeded ? "success" : "failure";
    state.lastResult = {
      code: succeeded ? "success" : "failure",
      message: succeeded ? "挑战成功 · 永久结果已提交" : "本次未达标 · 可重试",
    };
    state.resumeHint = null;
    state.autoPath = [];
    clearInputs = true;
    stable = true;
    emit(
      succeeded ? "success" : "failure",
      succeeded ? "挑战成功 · 奖励物资格已开放" : "挑战未完成 · 可重试，无物资损失",
    );
  };

  if (command.kind === "Pause") {
    const untilPause = dispatch(
      content,
      previous,
      { kind: "Tick" },
      monotonicTimeMs,
      displayTimeIso,
    );
    Object.assign(state, untilPause.state);
    events.push(...untilPause.events);
    stable = untilPause.stable;
    const advanced = setClockPauseReason(
      state.clock,
      command.reason,
      command.present,
      monotonicTimeMs,
    );
    state.clock = advanced.state;
    state.autoPath = [];
    clearInputs = advanced.clearInputs || untilPause.clearInputs;
    return result("paused", "已暂停 · 返回后请点击继续");
  }
  if (command.kind === "Resume") {
    const resumed = resumeClock(state.clock, monotonicTimeMs, command);
    state.clock = resumed.state;
    clearInputs = resumed.clearInputs;
    return result(
      resumed.feedback.some((item) => item.kind === "resumeBlocked") ? "paused" : "accepted",
      state.clock.countdownRemainingMs ? "准备继续 · 3 秒倒数" : "已继续",
    );
  }
  if (command.kind === "Settings") {
    const settings = command.settings;
    if (
      ![settings.masterVolume, settings.zoom].every(Number.isFinite) ||
      settings.masterVolume < 0 ||
      settings.masterVolume > 1 ||
      settings.zoom < 0.75 ||
      settings.zoom > 1.5 ||
      !["low", "standard"].includes(settings.quality)
    )
      return reject("invalidTarget", "设置值不合法");
    state.settings = { ...settings };
    stable = true;
    return result("accepted", "设置已更新");
  }

  if (
    state.mode === "challengeResult" &&
    Number.isFinite(monotonicTimeMs) &&
    monotonicTimeMs >= state.clock.lastMonotonicTimeMs
  )
    state.clock = { ...state.clock, lastMonotonicTimeMs: monotonicTimeMs };
  const advanced = advanceClock(state.clock, monotonicTimeMs);
  state.clock = advanced.state;
  clearInputs = advanced.clearInputs;
  if (advanced.clearInputs) state.autoPath = [];
  if (state.clock.pauseReasons.length || state.clock.awaitingResume)
    return result("paused", "已暂停 · 请点击继续");
  if (state.mode === "staticPuzzle" && state.activeStatic) {
    const definition = content.staticChallenges.find(
      (candidate) => candidate.id === state.activeStatic?.roomId,
    );
    if (
      definition?.kind === "memory" &&
      state.activeStatic.state.phase === "preview" &&
      state.clock.activeTimeMs >= definition.previewMs
    ) {
      state.activeStatic = {
        ...state.activeStatic,
        state: activateStatic(definition, state.activeStatic.state),
      };
      state.phase = "active";
      stable = true;
      emit("reveal", "危险标记已隐藏 · 沿记忆前往出口");
    }
  }

  if (state.mode === "challengeRunning" && state.activeRealtime && clockAcceptsInput(state.clock)) {
    const definition = content.realtimeChallenges.find(
      (candidate) => candidate.id === state.activeRealtime?.roomId,
    );
    if (definition) {
      const sequence = state.activeRealtime.state.lastInputSequence + 1;
      const stamp = { sequence, activeTimeMs: state.clock.activeTimeMs };
      let input: RealtimeInput | undefined;
      if (command.kind === "Move") input = { ...stamp, kind: "move", direction: command.direction };
      if (command.kind === "ClickTile") input = { ...stamp, kind: "click", tileId: command.tileId };
      if (command.kind === "Interact") input = { ...stamp, kind: "interact" };
      const update = advanceRealtime(
        definition,
        state.activeRealtime.state,
        state.clock.activeTimeMs,
        input,
      );
      state.activeRealtime = { ...state.activeRealtime, state: update.state };
      state.playerPosition = { ...state.playerPosition, tileId: update.state.playerTileId };
      if (input && update.state.playerTileId !== previous.playerPosition.tileId)
        emit("move", "移动");
      const hit = update.feedback.find((event) => event.kind === "hit");
      const star = update.feedback.find((event) => event.kind === "starCleared");
      const cleared = update.feedback.filter((event) => event.kind === "targetCleared");
      const lamp = update.feedback.find((event) => event.kind === "lampLit");
      const error = update.feedback.findLast((event) =>
        ["blocked", "invalidInput", "miss"].includes(event.kind),
      );
      if (hit || star || cleared.length) {
        const message = hit
          ? `拍点命中 · Combo ${update.state.kind === "firewall" ? update.state.combo : ""}`
          : star
            ? `星星清除 · ${star.value ?? cleared.length} 个数据`
            : `清除数据 · +${cleared.reduce((sum, event) => sum + (event.value ?? 0), 0)}`;
        emit("score", message);
        state.lastResult = { code: "accepted", message };
      }
      if (lamp) {
        emit("reveal", "灯已点亮 · 指定幽灵组消散");
        state.lastResult = { code: "accepted", message: "灯已点亮" };
      }
      if (error) {
        code = error.kind;
        emit("invalid", error.reason ?? "未命中拍点");
        state.lastResult = { code, message: error.reason ?? "未命中拍点 · Combo 已重算" };
      }
      if (update.result !== "running") {
        // Timed reducers return fresh state, so commits always mutate a private progress copy.
        state.completedObjectiveIds = [...state.completedObjectiveIds];
        state.claimedRewardIds = [...state.claimedRewardIds];
        state.bestResults = structuredClone(state.bestResults);
        state.scopeCompletionHistory = [...state.scopeCompletionHistory];
        settleRealtime(state.activeRealtime, update.result === "success");
      }
      if (input || command.kind === "Tick") return result();
    }
  }
  if (command.kind === "Tick") return result();
  if (command.kind === "ExitRoom") {
    const active = state.activeStatic ?? state.activeRealtime ?? state.activeCompletedRoom;
    if (active) {
      arrive(active.returnAnchor.areaId, active.returnAnchor.tileId);
      return result("accepted", "已返回安全入口");
    }
    if (state.mode === "challengeReady") {
      state.mode = "explore";
      clearInputs = true;
      return result("accepted", "已返回地图");
    }
    return reject("wrongMode", "当前没有活动房间");
  }
  if (command.kind === "RetryChallenge") {
    if (!state.activeRealtime) return reject("wrongMode", "当前没有可重试的挑战");
    const id = state.activeRealtime.roomId;
    const anchor = state.activeRealtime.returnAnchor;
    arrive(anchor.areaId, anchor.tileId);
    state.mode = "challengeReady";
    state.lastResult = { code: "accepted", message: `准备重新挑战 · ${id}` };
    return result();
  }
  if (command.kind === "StartChallenge") {
    const definition = content.realtimeChallenges.find(
      (candidate) => candidate.id === command.challengeId,
    );
    const room = content.rooms.find((candidate) => candidate.id === command.challengeId);
    const access = entitiesAt(content, state.playerPosition.tileId).find(
      (entity) =>
        (entity.kind === "challengeAccess" &&
          entity.params.challengeIds.includes(command.challengeId)) ||
        (entity.kind === "roomEntrance" && entity.params.roomId === command.challengeId),
    );
    if (!definition || !room || !access || state.mode !== "challengeReady")
      return reject("wrongMode", "请从地图上的挑战终端进入");
    const objective = content.objectives.find((item) => item.id === command.challengeId);
    if (!objective || !gateSatisfied(content, state, objective.prerequisites))
      return reject("unmetCondition", "先完成防火墙教学，再选择正式档位");
    const realtimeState = createRealtime(definition);
    state.activeRealtime = {
      roomId: room.id,
      returnAnchor: worldPosition(room.areaId, room.returnTileId),
      state: realtimeState,
      practice: false,
    };
    state.playerPosition = {
      space: "room",
      areaId: room.areaId,
      boardId: room.boardId,
      tileId: realtimeState.playerTileId,
    };
    state.mode = "challengeRunning";
    state.phase = "running";
    state.clock = createClock(monotonicTimeMs, { realtime: true, preparationMs: 3000 });
    state.resumeHint = { kind: "restartChallenge", challengeId: room.id };
    state.autoPath = [];
    stable = true;
    clearInputs = true;
    return result("accepted", "准备倒数 · 3 秒");
  }
  if (command.kind === "Teleport") {
    if (state.mode !== "explore") return reject("wrongMode", "挑战中请先返回入口");
    const area = content.areas.find((candidate) => candidate.teleportId === command.teleportId);
    if (!area || !state.activatedTeleportIds.includes(command.teleportId))
      return reject("unmetCondition", "传送点尚未激活或本版本未收录");
    arrive(area.id, area.entryTileId);
    emit("portal", `已传送至${area.label}`);
    return result();
  }
  if (state.mode === "completedRoom" && state.activeCompletedRoom) {
    const active = state.activeCompletedRoom;
    const room = content.rooms.find((candidate) => candidate.id === active.roomId);
    const definition = content.staticChallenges.find((candidate) => candidate.id === active.roomId);
    const layout = state.completedRoomLayouts[active.roomId];
    if (!room || !definition || !layout || !state.completedObjectiveIds.includes(room.goal))
      return reject("invalidTarget", "已完成房间内容缺失");
    if (command.kind === "Interact" || command.kind === "PracticeRoom") {
      if (enterStatic(room.id, true)) return result("accepted", "独立练习 · 永久完成布局保留");
      return reject("invalidTarget", "练习房间内容缺失");
    }
    if (command.kind === "Undo" || command.kind === "ResetRoom")
      return reject("alreadyCompleted", "已完成布局不能撤销或重置；按 F 开始独立练习");
    let direction: Direction | undefined;
    if (command.kind === "Move") direction = command.direction;
    if (command.kind === "ClickTile") {
      const from = definition.tiles.find((tile) => tile.id === state.playerPosition.tileId);
      const target = definition.tiles.find((tile) => tile.id === command.tileId);
      if (!from || !target) return reject("invalidTarget", "目标不在当前房间");
      direction = DIRECTIONS.find(
        (candidate) =>
          from.x + DIRECTION_OFFSETS[candidate][0] === target.x &&
          from.y + DIRECTION_OFFSETS[candidate][1] === target.y,
      );
      if (!direction) return reject("invalidTarget", "房间内只允许相邻移动");
    }
    if (!direction) return reject("wrongMode", "已完成房间可行走、返回或开始独立练习");
    const update = moveCompletedStatic(definition, layout, state.playerPosition.tileId, direction);
    if (!update.legal) return reject(update.code, update.message);
    state.playerPosition = { ...state.playerPosition, tileId: update.playerTileId };
    stable = true;
    emit("move", update.message);
    if (update.exited) {
      arrive(room.areaId, room.successExitTileId);
      emit("portal", "已穿过完成布局，返回安全出口");
    }
    return result("accepted", update.exited ? "已返回安全出口" : update.message);
  }
  if (state.mode === "staticPuzzle" && state.activeStatic) {
    const active = state.activeStatic;
    const definition = content.staticChallenges.find((candidate) => candidate.id === active.roomId);
    const room = content.rooms.find((candidate) => candidate.id === active.roomId);
    if (!definition || !room) return reject("invalidTarget", "房间内容缺失");
    let direction: Direction | undefined;
    if (command.kind === "Move") direction = command.direction;
    if (command.kind === "ClickTile") {
      const from = definition.tiles.find((tile) => tile.id === state.playerPosition.tileId);
      const to = definition.tiles.find((tile) => tile.id === command.tileId);
      direction = DIRECTIONS.find(
        (candidate) =>
          from &&
          to &&
          from.x + DIRECTION_OFFSETS[candidate][0] === to.x &&
          from.y + DIRECTION_OFFSETS[candidate][1] === to.y,
      );
      if (!direction) return reject("invalidTarget", "解谜只允许相邻移动");
    }
    const update = direction
      ? moveStatic(definition, active.state, state.playerPosition.tileId, direction)
      : command.kind === "Undo"
        ? undoStatic(definition, active.state, state.playerPosition.tileId)
        : command.kind === "ResetRoom"
          ? resetStatic(definition, active.state, state.playerPosition.tileId)
          : null;
    if (!update) return reject("wrongMode", "当前机关不支持此操作");
    if (!update.legal) return reject(update.code, update.message);
    const completedLayout =
      update.success && !active.practice
        ? createCompletedStaticLayout(definition, update.state, update.playerTileId)
        : null;
    if (completedLayout) {
      const effect = content.effects.find((candidate) => candidate.id === room.effectBundleId);
      if (
        !effect?.completeObjectiveIds.includes(room.goal) ||
        effect.completeObjectiveIds.some((id) => {
          const objective = content.objectives.find((candidate) => candidate.id === id);
          return !objective || !gateSatisfied(content, state, objective.prerequisites);
        })
      )
        return reject("unmetCondition", "成功布局的前置目标不满足，未提交永久结果");
    }
    state.activeStatic = { ...active, state: update.state };
    state.playerPosition = { ...state.playerPosition, tileId: update.playerTileId };
    state.phase = update.state.phase;
    stable = true;
    code = update.code;
    if (update.failed || command.kind === "ResetRoom") {
      state.clock = createClock(monotonicTimeMs);
      clearInputs = true;
      emit(update.failed ? "failure" : "reveal", update.message);
    } else emit("move", update.message);
    if (update.success) {
      if (completedLayout) {
        applyEffect(room.effectBundleId);
        state.completedRoomLayouts = { ...state.completedRoomLayouts, [room.id]: completedLayout };
      }
      arrive(room.areaId, active.practice ? room.returnTileId : room.successExitTileId);
      emit("success", "机关完成 · 已抵达安全出口");
    }
    return result(code, update.message);
  }
  if (state.mode !== "explore") return reject("wrongMode", "请使用当前挑战面板上的操作");

  const currentEntities = entitiesAt(content, state.playerPosition.tileId);
  if (command.kind === "Amplify") {
    const nexus = currentEntities.find((entity) => entity.kind === "nexus");
    if (!nexus || nexus.kind !== "nexus")
      return reject("invalidTarget", "请站在富集节点上使用增幅仪");
    if (!state.capabilities.includes(nexus.params.capabilityRequired))
      return reject("unmetCondition", "先领取阳炎增幅仪");
    if (state.clearedEtherNodeIds.includes(nexus.id))
      return result("alreadyCompleted", "此处以太覆盖已清除");
    addUnique(state.clearedEtherNodeIds, nexus.id);
    for (const group of nexus.params.revealsGroupIds) addUnique(state.revealedGroupIds, group);
    if (nexus.effectBundleId) applyEffect(nexus.effectBundleId);
    discover(content, state, state.playerPosition.tileId);
    stable = true;
    emit("amplify", "阳炎增幅 · 指定以太覆盖已清除");
    return result(
      "accepted",
      state.capabilities.includes("unlimitedAmplifier")
        ? "增幅仪 ∞ · 可无限使用"
        : "以太覆盖已清除",
    );
  }
  if (command.kind === "Interact") {
    const entity = currentEntities.find(
      (candidate) => !["door", "supply"].includes(candidate.kind),
    );
    if (!entity) return reject("invalidTarget", "当前格没有可交互对象");
    if (!gateOpen(content, state, entity.gateId))
      return reject("unmetCondition", gateReason(content, entity.gateId));
    if (entity.kind === "unavailable") return result("unmetCondition", entity.params.message);
    if (entity.kind === "nexus") return result("accepted", "按 R 使用阳炎增幅仪");
    if (entity.kind === "teleport") {
      const destination = content.areas.find((area) => area.id === entity.params.destinationAreaId);
      if (!destination) return reject("unmetCondition", "本版本未收录");
      arrive(destination.id, entity.params.destinationTileId);
      emit("portal", `进入${destination.label}`);
      return result();
    }
    if (entity.kind === "roomEntrance") {
      const room = content.rooms.find((candidate) => candidate.id === entity.params.roomId);
      if (
        room &&
        state.completedObjectiveIds.includes(room.goal) &&
        content.staticChallenges.some((candidate) => candidate.id === room.id)
      ) {
        if (enterCompletedRoom(room.id)) return result();
        return reject("invalidTarget", "已完成房间缺少可恢复的提交布局");
      }
      if (
        enterStatic(
          entity.params.roomId,
          state.completedObjectiveIds.includes(entity.params.roomId),
        )
      )
        return result();
      state.mode = "challengeReady";
      clearInputs = true;
      return result("accepted", "阅读规则后开始挑战");
    }
    if (entity.kind === "challengeAccess") {
      if (entity.effectBundleId) applyEffect(entity.effectBundleId);
      state.mode = "challengeReady";
      clearInputs = true;
      return result("accepted", "选择挑战档位");
    }
    if (entity.kind === "checkpoint") return result("accepted", "按 M 打开区域图与已激活传送点");
    if (
      entity.kind === "terminal" ||
      entity.kind === "switch" ||
      entity.kind === "observer" ||
      entity.kind === "amplifier"
    ) {
      if (entity.effectBundleId && applyEffect(entity.effectBundleId)) {
        discover(content, state, state.playerPosition.tileId);
        emit("success", `${entity.label} · 已激活`);
        return result("accepted", `${entity.label} · 已完成`);
      }
      const objectiveId =
        entity.kind === "amplifier"
          ? entity.params.completionObjectiveId
          : content.effects.find((effect) => effect.id === entity.effectBundleId)
              ?.completeObjectiveIds[0];
      if (objectiveId && state.completedObjectiveIds.includes(objectiveId))
        return result("alreadyCompleted", "已完成，永久结果保留");
      return reject("unmetCondition", "先完成本区主路径机关，再激活终端");
    }
    return reject("invalidTarget", "此对象无需交互");
  }
  let targetTileId: string | undefined;
  const from = content.tiles.find((tile) => tile.id === state.playerPosition.tileId);
  if (command.kind === "Move") {
    state.autoPath = [];
    const [dx, dy] = DIRECTION_OFFSETS[command.direction];
    targetTileId = content.tiles.find(
      (tile) =>
        tile.boardId === state.playerPosition.boardId &&
        tile.x === (from?.x ?? NaN) + dx &&
        tile.y === (from?.y ?? NaN) + dy,
    )?.id;
  } else if (command.kind === "ClickTile") {
    state.autoPath = [];
    const target = content.tiles.find((tile) => tile.id === command.tileId);
    if (
      !from ||
      !target ||
      target.boardId !== from.boardId ||
      !state.discoveredTileIds.includes(target.id)
    )
      return reject("invalidTarget", "只能选择已发现的本区格子");
    if (Math.abs(target.x - from.x) + Math.abs(target.y - from.y) === 1) targetTileId = target.id;
    else {
      const path = safePath(content, state, target.id);
      if (path.length === 0) return reject("invalidTarget", "远距离行走只通过已访问的安全普通格");
      targetTileId = path[0];
      state.autoPath = path.slice(1);
    }
  } else return reject("wrongMode", "撤销和重置仅用于活动静态房间");
  const target = content.tiles.find((tile) => tile.id === targetTileId);
  if (!target || target.terrain !== "floor" || !tileRevealed(content, state, target.id))
    return reject("blocked", "此处没有可通行道路");
  if (!tileCleared(content, state, target.id))
    return reject("blocked", "以太覆盖 · 寻找对应富集节点并按 R");
  for (const entity of entitiesAt(content, target.id)) {
    if (
      (entity.kind === "door" || entity.kind === "supply") &&
      !gateOpen(content, state, entity.gateId)
    )
      return reject("unmetCondition", gateReason(content, entity.gateId));
  }
  state.playerPosition = worldPosition(state.playerPosition.areaId, target.id);
  const revealed = discover(content, state, target.id);
  emit("move", "移动");
  if (revealed > 0) emit("reveal", "发现新的电视格");
  stable = true;
  for (const entity of entitiesAt(content, target.id)) {
    if (entity.kind === "supply") claim(entity.params.rewardId);
    if (entity.kind === "amplifier" && entity.effectBundleId) applyEffect(entity.effectBundleId);
    if (entity.kind === "data") {
      const objective = content.objectives.find((item) => item.id === entity.params.objectiveId);
      if (objective && gateSatisfied(content, state, objective.prerequisites))
        addUnique(state.completedObjectiveIds, objective.id);
      derive();
    }
    if (entity.kind === "checkpoint")
      addUnique(state.activatedTeleportIds, entity.params.teleportId);
    if (entity.kind === "roomEntrance" && entity.params.interactionMode === "enter") {
      const room = content.rooms.find((candidate) => candidate.id === entity.params.roomId);
      if (room && state.completedObjectiveIds.includes(room.goal)) {
        if (!enterCompletedRoom(room.id))
          return reject("invalidTarget", "已完成房间缺少可恢复的提交布局");
      } else enterStatic(entity.params.roomId);
      break;
    }
  }
  return result(
    "accepted",
    entitiesAt(content, target.id)
      .map((entity) => entity.label)
      .join(" · ") || "继续探索",
  );
}

function isSafeAutoTile(content: GameContent, state: GameState, tileId: string): boolean {
  const tile = content.tiles.find((item) => item.id === tileId);
  return (
    !!tile &&
    tile.terrain === "floor" &&
    state.visitedTileIds.includes(tileId) &&
    state.discoveredTileIds.includes(tileId) &&
    tileRevealed(content, state, tileId) &&
    tileCleared(content, state, tileId) &&
    entitiesAt(content, tileId).every(
      (entity) => entity.kind === "door" && gateOpen(content, state, entity.gateId),
    )
  );
}

export function safePath(content: GameContent, state: GameState, destination: string): string[] {
  if (
    state.mode !== "explore" ||
    !isSafeAutoTile(content, state, destination) ||
    destination === state.playerPosition.tileId
  )
    return [];
  const queue: { tileId: string; path: string[] }[] = [
    { tileId: state.playerPosition.tileId, path: [] },
  ];
  const visited = new Set([state.playerPosition.tileId]);
  for (let index = 0; index < queue.length; index += 1) {
    const item = queue[index];
    if (!item) continue;
    const tile = content.tiles.find((candidate) => candidate.id === item.tileId);
    if (!tile) continue;
    for (const direction of DIRECTIONS) {
      const [dx, dy] = DIRECTION_OFFSETS[direction];
      const next = content.tiles.find(
        (candidate) =>
          candidate.boardId === tile.boardId &&
          candidate.x === tile.x + dx &&
          candidate.y === tile.y + dy,
      );
      if (!next || visited.has(next.id) || !isSafeAutoTile(content, state, next.id)) continue;
      const path = [...item.path, next.id];
      if (next.id === destination) return path;
      visited.add(next.id);
      queue.push({ tileId: next.id, path });
    }
  }
  return [];
}
