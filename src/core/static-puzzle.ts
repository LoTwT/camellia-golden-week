import { sameJsonValue } from "./json-value.ts";
import {
  createTheftLayout,
  moveTheft,
  theftSolved,
  theftOccupiedTiles,
  validateTheftLayout,
  validateTheftDefinition,
} from "./data-theft.ts";
import type { AssemblyTheftDefinition, TheftLayout } from "./data-theft.ts";
import {
  createCaptureLayout,
  moveCapture,
  captureSolved,
  captureOccupiedTiles,
  validateCaptureLayout,
  validateCaptureDefinition,
} from "./capture.ts";
import type { CaptureDefinition, CaptureLayout } from "./capture.ts";
export type StaticDirection = "up" | "right" | "down" | "left";
export type StaticPhase = "preview" | "active" | "complete";
export type StaticColor = "cyan" | "magenta" | "amber";

export interface StaticTile {
  readonly id: string;
  readonly boardId: string;
  readonly x: number;
  readonly y: number;
  readonly terrain: "floor" | "wall" | "buffer";
}

interface StaticDefinitionBase {
  readonly id: string;
  readonly boardId: string;
  readonly title: string;
  readonly includedFrom: "M1" | "M2" | "M3";
  readonly sourceRecordIds: readonly string[];
  readonly tiles: readonly StaticTile[];
  readonly startTileId: string;
}

export interface MemoryDefinition extends StaticDefinitionBase {
  readonly kind: "memory";
  readonly exitTileId: string;
  readonly safeTileIds: readonly string[];
  readonly hazardTileIds: readonly string[];
  readonly previewMs: 4000;
}

export interface OneStrokeDefinition extends StaticDefinitionBase {
  readonly kind: "oneStroke";
  readonly endTileId: string;
  readonly requiredTileIds: readonly string[];
}

export interface RoutingDefinition extends StaticDefinitionBase {
  readonly kind: "routing";
  readonly ballIds: readonly string[];
  readonly cartIds: readonly string[];
  readonly stationIds: readonly string[];
  readonly initialObjectTileById: Readonly<Record<string, string>>;
  readonly stationTileById: Readonly<Record<string, string>>;
  readonly targetStationByBallId: Readonly<Record<string, string>>;
}

export type TheftDefinition = AssemblyTheftDefinition;

export type StaticDefinition =
  | MemoryDefinition
  | OneStrokeDefinition
  | RoutingDefinition
  | TheftDefinition
  | CaptureDefinition;

/** Current player position lives only in the engine, never in this layout. */
export interface StaticLayout {
  readonly theft?: TheftLayout;
  readonly capture?: CaptureLayout;
  readonly objectTileById: Readonly<Record<string, string>>;
  readonly visitedTileIds: readonly string[];
  readonly activatedLocalIds: readonly string[];
  readonly pendingObjectiveIds: readonly string[];
  readonly pendingRewardIds: readonly string[];
}

/** The first successful layout is permanent; practice never replaces this record. */
export interface CompletedStaticLayout {
  readonly theft?: TheftLayout;
  readonly capture?: CaptureLayout;
  readonly objectTileById: Readonly<Record<string, string>>;
  /** R1 one-stroke completion retains the actual ordered walk, including ordinary floor. */
  readonly visitedTileIds: readonly string[];
  readonly activatedLocalIds: readonly string[];
}

export interface CompletedStaticMove {
  readonly playerTileId: string;
  readonly legal: boolean;
  readonly exited: boolean;
  readonly code: "accepted" | "blocked" | "invalidTarget";
  readonly message: string;
}

export interface StaticSnapshot {
  readonly playerTileId: string;
  readonly layout: StaticLayout;
}

export interface StaticState {
  readonly phase: StaticPhase;
  readonly currentLayout: StaticLayout;
  readonly attemptBaseline: StaticSnapshot;
  /** Session only. Stable saves discard this stack. */
  readonly undoStack: readonly StaticSnapshot[];
}

export interface StaticInstance {
  readonly state: StaticState;
  readonly playerTileId: string;
}

export type StaticResultCode =
  | "accepted"
  | "blocked"
  | "wrongMode"
  | "alreadyCompleted"
  | "invalidTarget"
  | "alreadyVisited"
  | "endTooEarly"
  | "failed"
  | "success"
  | "undone"
  | "noHistory"
  | "reset";

export interface StaticTransition extends StaticInstance {
  readonly before: StaticSnapshot;
  readonly after: StaticSnapshot;
  readonly legal: boolean;
  readonly success: boolean;
  readonly failed: boolean;
  readonly code: StaticResultCode;
  readonly message: string;
}

export interface StaticWitness {
  readonly id: string;
  readonly definitionId: string;
  readonly kind: "success" | "alternative" | "failureRecovery" | "deadEndRecovery";
  readonly description: string;
  readonly actions: readonly (StaticDirection | "undo" | "reset" | "activate")[];
  readonly expectedCodes: readonly StaticResultCode[];
  readonly expectedPhase: StaticPhase;
  readonly expectedPlayerTileId: string;
}

export interface StaticContent {
  readonly definitions: readonly StaticDefinition[];
  readonly witnesses: readonly StaticWitness[];
}

const directionOffsets: Readonly<Record<StaticDirection, readonly [number, number]>> = {
  up: [0, -1],
  right: [1, 0],
  down: [0, 1],
  left: [-1, 0],
};

export const STATIC_UNDO_LIMIT = 256;

function cloneLayout(layout: StaticLayout): StaticLayout {
  return {
    ...(layout.theft ? { theft: structuredClone(layout.theft) } : {}),
    ...(layout.capture ? { capture: structuredClone(layout.capture) } : {}),
    objectTileById: { ...layout.objectTileById },
    visitedTileIds: [...layout.visitedTileIds],
    activatedLocalIds: [...layout.activatedLocalIds],
    pendingObjectiveIds: [...layout.pendingObjectiveIds],
    pendingRewardIds: [...layout.pendingRewardIds],
  };
}

function snapshot(playerTileId: string, layout: StaticLayout): StaticSnapshot {
  return { playerTileId, layout: cloneLayout(layout) };
}

function initialLayout(definition: StaticDefinition): StaticLayout {
  return {
    ...(definition.kind === "theft" ? { theft: createTheftLayout(definition) } : {}),
    ...(definition.kind === "capture" ? { capture: createCaptureLayout(definition) } : {}),
    objectTileById: definition.kind === "routing" ? { ...definition.initialObjectTileById } : {},
    visitedTileIds: definition.kind === "oneStroke" ? [definition.startTileId] : [],
    activatedLocalIds: [],
    pendingObjectiveIds: [],
    pendingRewardIds: [],
  };
}

export function createStatic(definition: StaticDefinition): StaticInstance {
  const layout = initialLayout(definition);
  return {
    state: {
      phase: definition.kind === "memory" ? "preview" : "active",
      currentLayout: cloneLayout(layout),
      attemptBaseline: snapshot(definition.startTileId, layout),
      undoStack: [],
    },
    playerTileId: definition.startTileId,
  };
}

/** The engine calls this only after its effective 4,000 ms preview timer expires. */
export function activateStatic(definition: StaticDefinition, state: StaticState): StaticState {
  if (definition.kind !== "memory" || state.phase !== "preview") return state;
  return { ...state, phase: "active" };
}

function transition(
  previous: StaticState,
  previousPlayerTileId: string,
  state: StaticState,
  playerTileId: string,
  code: StaticResultCode,
  message: string,
  legal: boolean,
): StaticTransition {
  return {
    state,
    playerTileId,
    before: snapshot(previousPlayerTileId, previous.currentLayout),
    after: snapshot(playerTileId, state.currentLayout),
    code,
    message,
    legal,
    success: code === "success",
    failed: code === "failed",
  };
}

function reject(
  state: StaticState,
  playerTileId: string,
  code: StaticResultCode,
  message: string,
): StaticTransition {
  return transition(state, playerTileId, state, playerTileId, code, message, false);
}

function adjacentTile(
  definition: StaticDefinition,
  tileId: string,
  direction: StaticDirection,
): StaticTile | undefined {
  const tile = definition.tiles.find((candidate) => candidate.id === tileId);
  if (!tile) return undefined;
  const [dx, dy] = directionOffsets[direction];
  return definition.tiles.find(
    (candidate) => candidate.x === tile.x + dx && candidate.y === tile.y + dy,
  );
}

function objectAt(layout: StaticLayout, tileId: string): string | undefined {
  return Object.keys(layout.objectTileById).find((id) => layout.objectTileById[id] === tileId);
}

export function isStaticSolved(
  definition: StaticDefinition,
  layout: StaticLayout,
  playerTileId: string,
): boolean {
  switch (definition.kind) {
    case "memory":
      return playerTileId === definition.exitTileId;
    case "oneStroke":
      return (
        playerTileId === definition.endTileId &&
        definition.requiredTileIds.every((id) => layout.visitedTileIds.includes(id))
      );
    case "routing":
      return definition.ballIds.every((id) => {
        const stationId = definition.targetStationByBallId[id];
        return (
          stationId !== undefined &&
          layout.objectTileById[id] === definition.stationTileById[stationId]
        );
      });
    case "theft":
      return !!layout.theft && theftSolved(definition, layout.theft);
    case "capture":
      return !!layout.capture && captureSolved(definition, layout.capture);
  }
}

export function moveStatic(
  definition: StaticDefinition,
  state: StaticState,
  playerTileId: string,
  direction: StaticDirection,
): StaticTransition {
  if (state.phase === "complete")
    return reject(state, playerTileId, "alreadyCompleted", "房间已完成；可从入口选择独立练习。");
  if (state.phase !== "active")
    return reject(state, playerTileId, "wrongMode", "正在观察，记住安全路径后再移动。");
  if (!Object.hasOwn(directionOffsets, direction))
    return reject(state, playerTileId, "invalidTarget", "只能向相邻的四个方向移动。");
  if (!definition.tiles.some((tile) => tile.id === playerTileId && tile.terrain !== "wall"))
    return reject(state, playerTileId, "invalidTarget", "玩家不在当前房间的有效格子。");
  const target = adjacentTile(definition, playerTileId, direction);
  if (!target || target.terrain === "wall")
    return reject(state, playerTileId, "blocked", "这里是墙或房间边界。");

  if (definition.kind === "memory" && definition.hazardTileIds.includes(target.id)) {
    const reset = resetStatic(definition, state, playerTileId);
    return transition(
      state,
      playerTileId,
      reset.state,
      reset.playerTileId,
      "failed",
      "踩到危险格。已回到起点，重新观察 4 秒。",
      true,
    );
  }

  let layout = cloneLayout(state.currentLayout);
  let actionMessage = "已移动。";
  if (definition.kind === "oneStroke") {
    if (layout.visitedTileIds.includes(target.id)) {
      const reset = resetStatic(definition, state, playerTileId);
      return transition(
        state,
        playerTileId,
        reset.state,
        reset.playerTileId,
        "failed",
        "重复经过旧格，已回起点并清空本次路径。",
        true,
      );
    }
    if (
      target.id === definition.endTileId &&
      definition.requiredTileIds.some(
        (id) => id !== target.id && !layout.visitedTileIds.includes(id),
      )
    )
      return reject(state, playerTileId, "endTooEarly", "先走完其他必经格，最后到达终点。");
    layout = { ...layout, visitedTileIds: [...layout.visitedTileIds, target.id] };
  }

  if (definition.kind === "theft") {
    if (!layout.theft) return reject(state, playerTileId, "invalidTarget", "组件布局缺失");
    const moved = moveTheft(definition, layout.theft, playerTileId, direction);
    if (!moved.legal) return reject(state, playerTileId, "blocked", moved.reason);
    layout = { ...layout, theft: moved.layout };
    actionMessage = moved.reason;
  }
  if (definition.kind === "capture") {
    if (!layout.capture) return reject(state, playerTileId, "invalidTarget", "捕获布局缺失");
    const moved = moveCapture(definition, layout.capture, playerTileId, direction);
    if (!moved.legal) return reject(state, playerTileId, "blocked", moved.reason);
    layout = { ...layout, capture: moved.layout };
    actionMessage = moved.reason;
  }
  if (definition.kind === "routing") {
    const pushedId = objectAt(layout, target.id);
    if (pushedId) {
      const firstLanding = adjacentTile(definition, target.id, direction);
      if (!firstLanding || firstLanding.terrain !== "floor" || objectAt(layout, firstLanding.id))
        return reject(state, playerTileId, "blocked", "物体前方没有空间；不能串推或推过边界。");
      let landing = firstLanding;
      if (definition.kind === "routing" && definition.ballIds.includes(pushedId)) {
        const stationTiles = Object.values(definition.stationTileById);
        while (!stationTiles.includes(landing.id)) {
          const next = adjacentTile(definition, landing.id, direction);
          if (!next || next.terrain !== "floor" || objectAt(layout, next.id)) break;
          landing = next;
        }
      }
      layout = { ...layout, objectTileById: { ...layout.objectTileById, [pushedId]: landing.id } };
    }
  }

  const success = isStaticSolved(definition, layout, target.id);
  const undoStack = success
    ? []
    : [...state.undoStack, snapshot(playerTileId, state.currentLayout)].slice(-STATIC_UNDO_LIMIT);
  const next: StaticState = {
    ...state,
    phase: success ? "complete" : "active",
    currentLayout: layout,
    undoStack,
  };
  return transition(
    state,
    playerTileId,
    next,
    target.id,
    success ? "success" : "accepted",
    success ? "机关完成。" : actionMessage,
    true,
  );
}

export function undoStatic(
  _definition: StaticDefinition,
  state: StaticState,
  playerTileId: string,
): StaticTransition {
  if (state.phase !== "active")
    return reject(
      state,
      playerTileId,
      "wrongMode",
      state.phase === "complete" ? "成功已提交，不能撤销领奖。" : "观察阶段不能撤销。",
    );
  const previous = state.undoStack.at(-1);
  if (!previous)
    return reject(state, playerTileId, "noHistory", "没有可撤销的行动，仍可重置房间。");
  const next = {
    ...state,
    currentLayout: cloneLayout(previous.layout),
    undoStack: state.undoStack.slice(0, -1),
  };
  return transition(
    state,
    playerTileId,
    next,
    previous.playerTileId,
    "undone",
    "已撤销上一步。",
    true,
  );
}

export function resetStatic(
  definition: StaticDefinition,
  state: StaticState,
  playerTileId: string,
): StaticTransition {
  if (state.phase === "complete")
    return reject(
      state,
      playerTileId,
      "alreadyCompleted",
      "房间已完成；重玩请从入口选择独立练习。",
    );
  const next: StaticState = {
    ...state,
    phase: definition.kind === "memory" ? "preview" : "active",
    currentLayout: cloneLayout(state.attemptBaseline.layout),
    undoStack: [],
  };
  return transition(
    state,
    playerTileId,
    next,
    state.attemptBaseline.playerTileId,
    "reset",
    definition.kind === "memory" ? "已回到起点，重新观察 4 秒。" : "已恢复进入房间时的布局。",
    true,
  );
}

/** Object rooms use their safe entry pad as the return-to-world exit after a visit. */
export function completedStaticExitTileId(definition: StaticDefinition): string {
  return definition.kind === "memory"
    ? definition.exitTileId
    : definition.kind === "oneStroke"
      ? definition.endTileId
      : completedStaticEntryTileId(definition);
}

export function completedStaticEntryTileId(definition: StaticDefinition): string {
  return definition.kind === "capture" ? definition.completedEntryTileId : definition.startTileId;
}

export function staticOccupiedTiles(layout: CompletedStaticLayout): string[] {
  return [
    ...Object.values(layout.objectTileById),
    ...(layout.theft ? theftOccupiedTiles(layout.theft) : []),
    ...(layout.capture ? captureOccupiedTiles(layout.capture) : []),
  ];
}

export function isCompletedStaticPosition(
  definition: StaticDefinition,
  layout: CompletedStaticLayout,
  playerTileId: string,
): boolean {
  return (
    definition.tiles.some((tile) => tile.id === playerTileId && tile.terrain !== "wall") &&
    !staticOccupiedTiles(layout).includes(playerTileId)
  );
}

/** Completed traversal has ordinary adjacency and frozen objects, with no puzzle effects. */
export function moveCompletedStatic(
  definition: StaticDefinition,
  layout: CompletedStaticLayout,
  playerTileId: string,
  direction: StaticDirection,
): CompletedStaticMove {
  const rejected = (code: "blocked" | "invalidTarget", message: string): CompletedStaticMove => ({
    playerTileId,
    legal: false,
    exited: false,
    code,
    message,
  });
  if (
    !isCompletedStaticPosition(definition, layout, playerTileId) ||
    !Object.hasOwn(directionOffsets, direction)
  )
    return rejected("invalidTarget", "已完成房间的位置或方向不合法。");
  const from = definition.tiles.find((tile) => tile.id === playerTileId)!;
  const [dx, dy] = directionOffsets[direction];
  const target = definition.tiles.find((tile) => tile.x === from.x + dx && tile.y === from.y + dy);
  if (!target || target.terrain === "wall") return rejected("blocked", "此处没有可通行道路。");
  if (!isCompletedStaticPosition(definition, layout, target.id))
    return rejected("blocked", "已完成的物体保持原位；按 F 可开始独立练习。");
  return {
    playerTileId: target.id,
    legal: true,
    exited: target.id === completedStaticExitTileId(definition),
    code: "accepted",
    message: "已完成房间 · 自由通行，不再触发机关。",
  };
}

/** Snapshot only a successful authoritative attempt; never manufacture a solved answer. */
export function createCompletedStaticLayout(
  definition: StaticDefinition,
  state: StaticState,
  playerTileId: string,
): CompletedStaticLayout {
  if (state.phase !== "complete" || !isStaticSolved(definition, state.currentLayout, playerTileId))
    throw new Error(`${definition.id}: 只有真实成功布局可以提交`);
  const layout: CompletedStaticLayout = {
    ...(state.currentLayout.theft ? { theft: structuredClone(state.currentLayout.theft) } : {}),
    ...(state.currentLayout.capture
      ? { capture: structuredClone(state.currentLayout.capture) }
      : {}),
    objectTileById: { ...state.currentLayout.objectTileById },
    visitedTileIds: [...state.currentLayout.visitedTileIds],
    activatedLocalIds: [...state.currentLayout.activatedLocalIds],
  };
  const errors = validateCompletedStaticLayout(definition, layout);
  if (errors.length > 0) throw new Error(errors.join("\n"));
  return layout;
}

/** Proves entry safety for every solution, using a conservative cart movement envelope. */
export function validateCompletedStaticEntrySafety(definition: StaticDefinition): string[] {
  if (definition.kind === "memory" || definition.kind === "oneStroke") return [];
  if (definition.kind === "theft")
    return Object.values(definition.portTileById).includes(definition.startTileId)
      ? [`${definition.id}: 完成态接收槽不能覆盖安全访问入口`]
      : [];
  if (definition.kind === "capture") return [];
  if (
    Object.values(definition.targetStationByBallId).some(
      (id) => definition.stationTileById[id] === definition.startTileId,
    )
  )
    return [`${definition.id}: 完成态基站不能覆盖安全访问入口`];
  const floors = definition.tiles.filter((tile) => tile.terrain === "floor");
  for (const cartId of definition.cartIds) {
    const initialTileId = definition.initialObjectTileById[cartId];
    if (!initialTileId) continue;
    const seen = new Set([initialTileId]);
    const queue = [initialTileId];
    for (let index = 0; index < queue.length; index += 1) {
      const tile = floors.find((candidate) => candidate.id === queue[index]);
      if (!tile) continue;
      for (const [dx, dy] of Object.values(directionOffsets)) {
        const behind = floors.find(
          (candidate) => candidate.x === tile.x - dx && candidate.y === tile.y - dy,
        );
        const ahead = floors.find(
          (candidate) => candidate.x === tile.x + dx && candidate.y === tile.y + dy,
        );
        if (!behind || !ahead || seen.has(ahead.id)) continue;
        seen.add(ahead.id);
        queue.push(ahead.id);
      }
    }
    if (seen.has(definition.startTileId))
      return [`${definition.id}: 推车可能覆盖完成态安全入口；内容须提供不会堵入口的固定结构`];
  }
  return [];
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStableId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 128 &&
    /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(value)
  );
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && allowed.includes(value as T);
}

function checkKeys(
  value: UnknownRecord,
  allowed: readonly string[],
  path: string,
  errors: string[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(`${path}.${key}: 未知字段`);
  }
  for (const key of allowed) {
    if (!Object.hasOwn(value, key)) errors.push(`${path}.${key}: 缺少字段`);
  }
}

function readIds(value: unknown, path: string, errors: string[]): string[] {
  if (!Array.isArray(value)) {
    errors.push(`${path}: 必须是稳定 ID 数组`);
    return [];
  }
  const ids: string[] = [];
  for (const id of value) {
    if (!isStableId(id)) errors.push(`${path}: 非法 ID ${String(id)}`);
    else if (ids.includes(id)) errors.push(`${path}: 重复 ID ${id}`);
    else ids.push(id);
  }
  return ids;
}

function readIdMap(
  value: unknown,
  keys: readonly string[],
  path: string,
  errors: string[],
): Record<string, string> {
  if (!isRecord(value)) {
    errors.push(`${path}: 必须是 ID 映射`);
    return {};
  }
  const result: Record<string, string> = {};
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) errors.push(`${path}.${key}: 未知对象引用`);
    const id = value[key];
    if (!isStableId(id)) errors.push(`${path}.${key}: 非法 ID`);
    else result[key] = id;
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) errors.push(`${path}.${key}: 缺少对象引用`);
  }
  return result;
}

function checkFloorReferences(
  ids: readonly string[],
  floors: ReadonlySet<string>,
  path: string,
  errors: string[],
): void {
  for (const id of ids) {
    if (!floors.has(id)) errors.push(`${path}: ${id} 不引用当前棋盘的地板`);
  }
}

function checkDistinct(values: readonly string[], path: string, errors: string[]): void {
  if (new Set(values).size !== values.length) errors.push(`${path}: 多个阻挡对象或目标重叠`);
}

function connectedTileIds(
  tiles: readonly StaticTile[],
  candidates: readonly string[],
  startTileId: string,
): Set<string> {
  const visited = new Set<string>();
  const queue = [startTileId];
  const allowed = new Set(candidates);
  while (queue.length > 0) {
    const currentId = queue.pop();
    if (!currentId || visited.has(currentId) || !allowed.has(currentId)) continue;
    visited.add(currentId);
    const current = tiles.find((tile) => tile.id === currentId);
    if (!current) continue;
    for (const next of tiles) {
      if (
        Math.abs(next.x - current.x) + Math.abs(next.y - current.y) === 1 &&
        allowed.has(next.id) &&
        !visited.has(next.id)
      )
        queue.push(next.id);
    }
  }
  return visited;
}

/** Runtime validation is shared by content checks and untrusted-save checks. */
export function validateStaticDefinition(raw: unknown): string[] {
  if (isRecord(raw) && raw.kind === "theft") return validateTheftDefinition(raw);
  if (isRecord(raw) && raw.kind === "capture") return validateCaptureDefinition(raw);
  const errors: string[] = [];
  if (!isRecord(raw)) return ["static: 必须是对象"];
  const path = typeof raw.id === "string" ? raw.id : "static";
  const baseKeys = [
    "id",
    "boardId",
    "title",
    "includedFrom",
    "sourceRecordIds",
    "tiles",
    "startTileId",
  ];
  let extraKeys: string[];
  switch (raw.kind) {
    case "memory":
      extraKeys = ["exitTileId", "safeTileIds", "hazardTileIds", "previewMs"];
      break;
    case "oneStroke":
      extraKeys = ["endTileId", "requiredTileIds"];
      break;
    case "routing":
      extraKeys = [
        "ballIds",
        "cartIds",
        "stationIds",
        "initialObjectTileById",
        "stationTileById",
        "targetStationByBallId",
      ];
      break;
    default:
      return [`${path}.kind: 未知静态谜题类型`];
  }
  checkKeys(raw, [...baseKeys, "kind", ...extraKeys], path, errors);
  for (const key of ["id", "boardId", "startTileId"]) {
    if (!isStableId(raw[key])) errors.push(`${path}.${key}: 非法 ID`);
  }
  if (typeof raw.title !== "string" || raw.title.length === 0 || raw.title.length > 100)
    errors.push(`${path}.title: 缺少有效标题`);
  if (!isOneOf(raw.includedFrom, ["M1", "M2", "M3"]))
    errors.push(`${path}.includedFrom: 非法发布阶段`);
  if (readIds(raw.sourceRecordIds, `${path}.sourceRecordIds`, errors).length === 0)
    errors.push(`${path}.sourceRecordIds: 必须记录来源或重建记录`);
  if (!Array.isArray(raw.tiles) || raw.tiles.length === 0 || raw.tiles.length > 256)
    return [...errors, `${path}.tiles: 必须有 1–256 个实际格子`];
  const tiles: StaticTile[] = [];
  const ids = new Set<string>();
  const coordinates = new Set<string>();
  for (const value of raw.tiles) {
    if (!isRecord(value)) {
      errors.push(`${path}.tiles: 格子必须是对象`);
      continue;
    }
    checkKeys(value, ["id", "boardId", "x", "y", "terrain"], `${path}.tiles`, errors);
    if (
      !isStableId(value.id) ||
      value.boardId !== raw.boardId ||
      !Number.isSafeInteger(value.x) ||
      !Number.isSafeInteger(value.y) ||
      !isOneOf(value.terrain, ["floor", "wall"])
    ) {
      errors.push(`${path}.tiles.${String(value.id)}: 非法 ID、棋盘、整数坐标或地形`);
      continue;
    }
    const tile = value as unknown as StaticTile;
    const coordinate = `${tile.x},${tile.y}`;
    if (ids.has(tile.id)) errors.push(`${path}.tiles: 重复 ID ${tile.id}`);
    if (coordinates.has(coordinate)) errors.push(`${path}.tiles: 重复坐标 ${coordinate}`);
    ids.add(tile.id);
    coordinates.add(coordinate);
    tiles.push(tile);
  }
  const floors = new Set(tiles.filter((tile) => tile.terrain === "floor").map((tile) => tile.id));
  const startTileId = typeof raw.startTileId === "string" ? raw.startTileId : "";
  checkFloorReferences([startTileId], floors, `${path}.startTileId`, errors);
  if (raw.kind === "memory") {
    const safe = readIds(raw.safeTileIds, `${path}.safeTileIds`, errors);
    const hazards = readIds(raw.hazardTileIds, `${path}.hazardTileIds`, errors);
    checkFloorReferences([...safe, ...hazards], floors, `${path}.memory`, errors);
    if (raw.previewMs !== 4000) errors.push(`${path}.previewMs: 观察有效时间必须为 4000`);
    if (!isStableId(raw.exitTileId) || !safe.includes(raw.exitTileId))
      errors.push(`${path}.exitTileId: 出口必须是安全格`);
    if (!safe.includes(startTileId)) errors.push(`${path}.startTileId: 起点必须是安全格`);
    if (safe.some((id) => hazards.includes(id))) errors.push(`${path}: 安全格与危险格重叠`);
    if (new Set([...safe, ...hazards]).size !== floors.size)
      errors.push(`${path}: 每个地板必须明确为安全或危险`);
    if (raw.exitTileId === startTileId) errors.push(`${path}: 起终点必须不同`);
    if (
      typeof raw.exitTileId === "string" &&
      !connectedTileIds(tiles, safe, startTileId).has(raw.exitTileId)
    )
      errors.push(`${path}: 安全路径不能到达出口`);
  } else if (raw.kind === "oneStroke") {
    const required = readIds(raw.requiredTileIds, `${path}.requiredTileIds`, errors);
    checkFloorReferences(required, floors, `${path}.requiredTileIds`, errors);
    if (
      required.length < 2 ||
      typeof raw.endTileId !== "string" ||
      !required.includes(raw.endTileId) ||
      raw.endTileId === startTileId
    )
      errors.push(`${path}: 必经路径必须包含不同的起终点`);
    const reachable = connectedTileIds(tiles, [...floors], startTileId);
    if (required.some((id) => !reachable.has(id))) errors.push(`${path}: 必取目标不可达`);
  } else {
    const objectIds =
      raw.kind === "routing"
        ? [
            ...readIds(raw.ballIds, `${path}.ballIds`, errors),
            ...readIds(raw.cartIds, `${path}.cartIds`, errors),
          ]
        : [];
    if (objectIds.length === 0) errors.push(`${path}: 至少需要一个可移动对象`);
    checkDistinct(objectIds, `${path}.objectIds`, errors);
    const objects = readIdMap(
      raw.initialObjectTileById,
      objectIds,
      `${path}.initialObjectTileById`,
      errors,
    );
    checkFloorReferences(Object.values(objects), floors, `${path}.initialObjectTileById`, errors);
    checkDistinct(Object.values(objects), `${path}.initialObjectTileById`, errors);
    if (Object.values(objects).includes(startTileId)) errors.push(`${path}: 出生点不能被物体占据`);
    if (raw.kind === "routing") {
      const ballIds = readIds(raw.ballIds, `${path}.ballIds`, errors);
      const stations = readIds(raw.stationIds, `${path}.stationIds`, errors);
      const stationTiles = readIdMap(
        raw.stationTileById,
        stations,
        `${path}.stationTileById`,
        errors,
      );
      const targets = readIdMap(
        raw.targetStationByBallId,
        ballIds,
        `${path}.targetStationByBallId`,
        errors,
      );
      if (ballIds.length === 0) errors.push(`${path}.ballIds: 至少需要一个信号球`);
      checkFloorReferences(Object.values(stationTiles), floors, `${path}.stationTileById`, errors);
      checkDistinct(Object.values(stationTiles), `${path}.stationTileById`, errors);
      checkDistinct(Object.values(targets), `${path}.targetStationByBallId`, errors);
      for (const station of Object.values(targets))
        if (!stations.includes(station))
          errors.push(`${path}.targetStationByBallId: 未知基站 ${station}`);
    }
  }
  if (errors.length === 0)
    errors.push(...validateCompletedStaticEntrySafety(raw as unknown as StaticDefinition));
  return errors;
}

function validateLayoutSnapshot(
  definition: StaticDefinition,
  raw: unknown,
  path: string,
): string[] {
  const errors: string[] = [];
  if (!isRecord(raw)) return [`${path}: 缺少布局快照`];
  checkKeys(raw, ["playerTileId", "layout"], path, errors);
  if (!isStableId(raw.playerTileId)) errors.push(`${path}.playerTileId: 非法 ID`);
  const floors = new Set(
    definition.tiles.filter((tile) => tile.terrain !== "wall").map((tile) => tile.id),
  );
  const playerTileId = typeof raw.playerTileId === "string" ? raw.playerTileId : "";
  checkFloorReferences([playerTileId], floors, `${path}.playerTileId`, errors);
  if (!isRecord(raw.layout)) return [...errors, `${path}.layout: 缺少布局`];
  const layout = raw.layout;
  checkKeys(
    layout,
    [
      "objectTileById",
      "visitedTileIds",
      "activatedLocalIds",
      "pendingObjectiveIds",
      "pendingRewardIds",
      ...(definition.kind === "theft" ? ["theft"] : []),
      ...(definition.kind === "capture" ? ["capture"] : []),
    ],
    `${path}.layout`,
    errors,
  );
  const objectIds =
    definition.kind === "routing" ? [...definition.ballIds, ...definition.cartIds] : [];
  const objects = readIdMap(
    layout.objectTileById,
    objectIds,
    `${path}.layout.objectTileById`,
    errors,
  );
  checkFloorReferences(Object.values(objects), floors, `${path}.layout.objectTileById`, errors);
  checkDistinct(Object.values(objects), `${path}.layout.objectTileById`, errors);
  if (Object.values(objects).includes(playerTileId)) errors.push(`${path}: 玩家与阻挡对象重合`);
  if (definition.kind === "theft")
    errors.push(...validateTheftLayout(definition, layout.theft, playerTileId));
  if (definition.kind === "capture")
    errors.push(...validateCaptureLayout(definition, layout.capture, playerTileId));
  const visited = readIds(layout.visitedTileIds, `${path}.layout.visitedTileIds`, errors);
  const local = readIds(layout.activatedLocalIds, `${path}.layout.activatedLocalIds`, errors);
  readIds(layout.pendingObjectiveIds, `${path}.layout.pendingObjectiveIds`, errors);
  readIds(layout.pendingRewardIds, `${path}.layout.pendingRewardIds`, errors);
  if (local.length > 0) errors.push(`${path}: 当前房间没有可逆开关定义`);
  if (definition.kind === "oneStroke") {
    if (visited[0] !== definition.startTileId || visited.at(-1) !== playerTileId)
      errors.push(`${path}: 路径起点或末端与玩家位置不一致`);
    for (let index = 0; index < visited.length; index += 1) {
      const id = visited[index];
      if (!id || !floors.has(id)) errors.push(`${path}: 路径引用不可走格`);
      if (index > 0) {
        const previous = definition.tiles.find((tile) => tile.id === visited[index - 1]);
        const current = definition.tiles.find((tile) => tile.id === id);
        if (
          !previous ||
          !current ||
          Math.abs(previous.x - current.x) + Math.abs(previous.y - current.y) !== 1
        )
          errors.push(`${path}: 已走路径不相邻`);
      }
    }
    if (
      visited.includes(definition.endTileId) &&
      (definition.requiredTileIds.some((id) => !visited.includes(id)) ||
        visited.at(-1) !== definition.endTileId)
    )
      errors.push(`${path}: 在走完必经格前进入终点`);
  } else if (visited.length > 0) errors.push(`${path}: 只有一笔画保存必经路径`);
  if (definition.kind === "memory" && !definition.safeTileIds.includes(playerTileId))
    errors.push(`${path}: 迷宫稳定状态不能留在危险格`);
  return errors;
}

/** A committed layout has no live player, pending effects, undo stack, or completion boolean. */
export function validateCompletedStaticLayout(
  definition: StaticDefinition,
  raw: unknown,
): string[] {
  const path = `${definition.id}.completedLayout`;
  if (!isRecord(raw)) return [`${path}: 缺少已提交布局`];
  const errors: string[] = [];
  checkKeys(
    raw,
    [
      "objectTileById",
      "visitedTileIds",
      "activatedLocalIds",
      ...(definition.kind === "theft" ? ["theft"] : []),
      ...(definition.kind === "capture" ? ["capture"] : []),
    ],
    path,
    errors,
  );
  const completionTileId =
    definition.kind === "memory"
      ? definition.exitTileId
      : definition.kind === "oneStroke"
        ? definition.endTileId
        : completedStaticEntryTileId(definition);
  const layout = { ...raw, pendingObjectiveIds: [], pendingRewardIds: [] };
  errors.push(
    ...validateLayoutSnapshot(definition, { playerTileId: completionTileId, layout }, path),
  );
  if (errors.length > 0) return errors;
  const completed = raw as unknown as CompletedStaticLayout;
  if (!isStaticSolved(definition, layout as unknown as StaticLayout, completionTileId))
    errors.push(`${path}: 提交的布局不满足房间成功条件`);
  if (!isCompletedStaticPosition(definition, completed, completedStaticEntryTileId(definition)))
    errors.push(`${path}: 已完成布局覆盖安全访问入口`);
  if (!isCompletedStaticPosition(definition, completed, completedStaticExitTileId(definition)))
    errors.push(`${path}: 已完成布局覆盖访问出口`);
  return errors;
}

function sameLayout(left: StaticLayout, right: StaticLayout): boolean {
  return (
    sameJsonValue(left.theft, right.theft) &&
    sameJsonValue(left.capture, right.capture) &&
    Object.keys(left.objectTileById).length === Object.keys(right.objectTileById).length &&
    Object.entries(left.objectTileById).every(
      ([key, value]) => right.objectTileById[key] === value,
    ) &&
    JSON.stringify(left.visitedTileIds) === JSON.stringify(right.visitedTileIds) &&
    JSON.stringify(left.activatedLocalIds) === JSON.stringify(right.activatedLocalIds) &&
    JSON.stringify(left.pendingObjectiveIds) === JSON.stringify(right.pendingObjectiveIds) &&
    JSON.stringify(left.pendingRewardIds) === JSON.stringify(right.pendingRewardIds)
  );
}

/** Save validation receives the engine's single authoritative player tile separately. */
export function validateStaticState(
  definition: StaticDefinition,
  raw: unknown,
  playerTileId: string,
): string[] {
  if (!isRecord(raw)) return [`${definition.id}.state: 缺少静态状态`];
  const errors: string[] = [];
  const path = `${definition.id}.state`;
  checkKeys(raw, ["phase", "currentLayout", "attemptBaseline", "undoStack"], path, errors);
  if (!isOneOf(raw.phase, ["preview", "active", "complete"]))
    errors.push(`${path}.phase: 未知阶段`);
  if (raw.phase === "preview" && definition.kind !== "memory")
    errors.push(`${path}.phase: 只有迷宫能处于观察阶段`);
  errors.push(
    ...validateLayoutSnapshot(
      definition,
      { playerTileId, layout: raw.currentLayout },
      `${path}.current`,
    ),
  );
  errors.push(
    ...validateLayoutSnapshot(definition, raw.attemptBaseline, `${path}.attemptBaseline`),
  );
  if (!Array.isArray(raw.undoStack) || raw.undoStack.length > STATIC_UNDO_LIMIT)
    errors.push(`${path}.undoStack: 历史必须是最多 256 步的数组`);
  else {
    if (raw.phase !== "active" && raw.undoStack.length > 0)
      errors.push(`${path}.undoStack: 观察或完成阶段不能保留历史`);
    for (let index = 0; index < raw.undoStack.length; index += 1)
      errors.push(
        ...validateLayoutSnapshot(definition, raw.undoStack[index], `${path}.undoStack[${index}]`),
      );
  }
  if (errors.length > 0) return errors;
  const state = raw as unknown as StaticState;
  const canonical = createStatic(definition);
  if (
    state.attemptBaseline.playerTileId !== canonical.playerTileId ||
    !sameLayout(state.attemptBaseline.layout, canonical.state.attemptBaseline.layout)
  )
    errors.push(`${path}.attemptBaseline: 重置基线不符合本版固定入口布局`);
  if (
    state.phase === "preview" &&
    (playerTileId !== state.attemptBaseline.playerTileId ||
      !sameLayout(state.currentLayout, state.attemptBaseline.layout))
  )
    errors.push(`${path}: 观察阶段必须处于入口基线`);
  const solved = isStaticSolved(definition, state.currentLayout, playerTileId);
  if ((state.phase === "complete") !== solved)
    errors.push(`${path}.phase: 完成状态与当前目标布局不一致`);
  return errors;
}

export interface StaticWitnessResult extends StaticInstance {
  readonly codes: readonly StaticResultCode[];
  readonly errors: readonly string[];
}

export function replayStaticWitness(
  definition: StaticDefinition,
  witness: StaticWitness,
): StaticWitnessResult {
  let instance = createStatic(definition);
  const errors: string[] = [];
  const codes: StaticResultCode[] = [];
  if (witness.definitionId !== definition.id) errors.push(`${witness.id}: 房间引用不匹配`);
  for (const action of witness.actions) {
    if (action === "activate") {
      const next = activateStatic(definition, instance.state);
      codes.push(next === instance.state ? "wrongMode" : "accepted");
      instance = { ...instance, state: next };
    } else {
      const result =
        action === "undo"
          ? undoStatic(definition, instance.state, instance.playerTileId)
          : action === "reset"
            ? resetStatic(definition, instance.state, instance.playerTileId)
            : moveStatic(definition, instance.state, instance.playerTileId, action);
      codes.push(result.code);
      instance = { state: result.state, playerTileId: result.playerTileId };
    }
    errors.push(
      ...validateStaticState(definition, instance.state, instance.playerTileId).map(
        (error) => `${witness.id}[${codes.length - 1}]: ${error}`,
      ),
    );
  }
  if (JSON.stringify(codes) !== JSON.stringify(witness.expectedCodes))
    errors.push(`${witness.id}: 实际结果码 ${codes.join(",")} 与见证不符`);
  if (instance.state.phase !== witness.expectedPhase)
    errors.push(
      `${witness.id}: 最终阶段应为 ${witness.expectedPhase}，实际 ${instance.state.phase}`,
    );
  if (instance.playerTileId !== witness.expectedPlayerTileId)
    errors.push(`${witness.id}: 最终位置不符`);
  if (
    (witness.kind === "success" || witness.kind === "alternative") &&
    instance.state.phase !== "complete"
  )
    errors.push(`${witness.id}: 通关见证未成功`);
  return { ...instance, codes, errors };
}

export function validateStaticContent(raw: unknown): string[] {
  if (!isRecord(raw)) return ["static.json: 必须是对象"];
  const errors: string[] = [];
  checkKeys(raw, ["definitions", "witnesses"], "static.json", errors);
  if (!Array.isArray(raw.definitions) || !Array.isArray(raw.witnesses))
    return [...errors, "static.json: 缺少 definitions 或 witnesses 数组"];
  if (raw.definitions.length === 0) errors.push("static.json: 至少需要一个静态房间");
  const definitions = new Map<string, StaticDefinition>();
  const boardIds = new Set<string>();
  const tileIds = new Set<string>();
  const entityIds = new Set<string>();
  for (const value of raw.definitions) {
    const issues = validateStaticDefinition(value);
    errors.push(...issues);
    if (issues.length > 0) continue;
    const definition = value as StaticDefinition;
    if (definitions.has(definition.id)) errors.push(`static.json: 重复房间 ${definition.id}`);
    definitions.set(definition.id, definition);
    if (boardIds.has(definition.boardId))
      errors.push(`static.json: 跨房间重复棋盘 ${definition.boardId}`);
    boardIds.add(definition.boardId);
    for (const tile of definition.tiles) {
      if (tileIds.has(tile.id)) errors.push(`static.json: 跨房间重复格 ID ${tile.id}`);
      tileIds.add(tile.id);
    }
    const objects =
      definition.kind === "routing"
        ? [...definition.ballIds, ...definition.cartIds, ...definition.stationIds]
        : definition.kind === "theft"
          ? [
              ...definition.ballIds,
              ...definition.baseStationIds,
              ...definition.amplifierIds,
              ...definition.powerPortIds,
            ]
          : definition.kind === "capture"
            ? [...definition.cartIds, ...definition.bangbooIds]
            : [];
    for (const id of objects) {
      if (entityIds.has(id)) errors.push(`static.json: 跨房间重复对象 ${id}`);
      entityIds.add(id);
    }
  }
  const witnessIds = new Set<string>();
  const witnesses: StaticWitness[] = [];
  for (const value of raw.witnesses) {
    if (!isRecord(value)) {
      errors.push("static.json.witnesses: 见证必须是对象");
      continue;
    }
    const witnessErrors: string[] = [];
    checkKeys(
      value,
      [
        "id",
        "definitionId",
        "kind",
        "description",
        "actions",
        "expectedCodes",
        "expectedPhase",
        "expectedPlayerTileId",
      ],
      "static.json.witnesses",
      witnessErrors,
    );
    if (
      !isStableId(value.id) ||
      !isStableId(value.definitionId) ||
      !isStableId(value.expectedPlayerTileId)
    )
      witnessErrors.push("static.json.witnesses: 非法见证 ID / 引用");
    if (!isOneOf(value.kind, ["success", "alternative", "failureRecovery", "deadEndRecovery"]))
      witnessErrors.push("static.json.witnesses: 未知见证类型");
    if (typeof value.description !== "string" || value.description.length === 0)
      witnessErrors.push("static.json.witnesses: 缺少说明");
    if (!isOneOf(value.expectedPhase, ["preview", "active", "complete"]))
      witnessErrors.push("static.json.witnesses: 未知预期阶段");
    if (
      !Array.isArray(value.actions) ||
      value.actions.length === 0 ||
      value.actions.length > 10000 ||
      value.actions.some(
        (action) => !isOneOf(action, ["up", "right", "down", "left", "undo", "reset", "activate"]),
      )
    )
      witnessErrors.push("static.json.witnesses: 非法见证动作");
    const validCodes: StaticResultCode[] = [
      "accepted",
      "blocked",
      "wrongMode",
      "alreadyCompleted",
      "invalidTarget",
      "alreadyVisited",
      "endTooEarly",
      "failed",
      "success",
      "undone",
      "noHistory",
      "reset",
    ];
    if (
      !Array.isArray(value.expectedCodes) ||
      !Array.isArray(value.actions) ||
      value.expectedCodes.length !== value.actions.length ||
      value.expectedCodes.some((code) => !validCodes.includes(code as StaticResultCode))
    )
      witnessErrors.push("static.json.witnesses: 预期结果码与动作不对应");
    errors.push(...witnessErrors);
    if (witnessErrors.length > 0) continue;
    const witness = value as unknown as StaticWitness;
    if (witnessIds.has(witness.id)) errors.push(`static.json: 重复见证 ${witness.id}`);
    witnessIds.add(witness.id);
    witnesses.push(witness);
    const definition = definitions.get(witness.definitionId);
    if (!definition) errors.push(`${witness.id}: 未知房间 ${witness.definitionId}`);
    else errors.push(...replayStaticWitness(definition, witness).errors);
  }
  for (const definition of definitions.values()) {
    const relevant = witnesses.filter((witness) => witness.definitionId === definition.id);
    if (!relevant.some((witness) => witness.kind === "success"))
      errors.push(`${definition.id}: 缺少成功见证`);
    if (
      !relevant.some(
        (witness) => witness.kind === "failureRecovery" || witness.kind === "deadEndRecovery",
      )
    )
      errors.push(`${definition.id}: 缺少失败 / 死角恢复见证`);
    for (const alternative of relevant.filter((witness) => witness.kind === "alternative")) {
      if (
        relevant.some(
          (witness) =>
            witness.kind === "success" &&
            JSON.stringify(witness.actions) === JSON.stringify(alternative.actions),
        )
      )
        errors.push(`${alternative.id}: 替代解与主见证相同`);
    }
  }
  return errors;
}

export function assertStaticContent(raw: unknown): asserts raw is StaticContent {
  const errors = validateStaticContent(raw);
  if (errors.length > 0) throw new Error(errors.join("\n"));
}
