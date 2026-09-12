import type { TheftDirection, TheftTile } from "./data-theft.ts";

export interface CaptureDefinition {
  readonly kind: "capture";
  readonly id: string;
  readonly boardId: string;
  readonly title: string;
  readonly includedFrom: "M3";
  readonly sourceRecordIds: readonly string[];
  readonly tiles: readonly TheftTile[];
  readonly startTileId: string;
  readonly completedEntryTileId: string;
  readonly cartIds: readonly string[];
  readonly bangbooIds: readonly string[];
  readonly initialCartTileById: Readonly<Record<string, string>>;
  readonly initialBangbooTileById: Readonly<Record<string, string>>;
  readonly escapeRules: {
    readonly kind: "adjacent-player-action";
    readonly escapeTileIds: readonly string[];
    readonly priority: readonly TheftDirection[];
  };
  readonly captureConditions: "no-legal-escape-on-approach";
  readonly cartUnlockObjectiveId: string | null;
}
export interface CaptureLayout {
  readonly cartTileById: Readonly<Record<string, string>>;
  readonly bangbooTileById: Readonly<Record<string, string>>;
  readonly capturedBangbooIds: readonly string[];
}
const offsets: Readonly<Record<TheftDirection, readonly [number, number]>> = {
  up: [0, -1],
  right: [1, 0],
  down: [0, 1],
  left: [-1, 0],
};
export function createCaptureLayout(definition: CaptureDefinition): CaptureLayout {
  return {
    cartTileById: { ...definition.initialCartTileById },
    bangbooTileById: { ...definition.initialBangbooTileById },
    capturedBangbooIds: [],
  };
}
export function captureSolved(definition: CaptureDefinition, layout: CaptureLayout): boolean {
  return definition.bangbooIds.every((id) => layout.capturedBangbooIds.includes(id));
}
export function captureOccupiedTiles(layout: CaptureLayout): string[] {
  return [...Object.values(layout.cartTileById), ...Object.values(layout.bangbooTileById)];
}
export function moveCapture(
  definition: CaptureDefinition,
  layout: CaptureLayout,
  playerTileId: string,
  direction: TheftDirection,
): {
  legal: boolean;
  playerTileId: string;
  layout: CaptureLayout;
  reason: string;
} {
  const reject = (reason: string) => ({ legal: false, playerTileId, layout, reason });
  if (!Object.hasOwn(offsets, direction)) return reject("只能四向移动");
  const player = definition.tiles.find((tile) => tile.id === playerTileId);
  if (!player) return reject("玩家不在当前捕获区域");
  const [dx, dy] = offsets[direction];
  const target = definition.tiles.find(
    (tile) => tile.x === player.x + dx && tile.y === player.y + dy,
  );
  if (!target || target.terrain === "wall") return reject("捕获区域边界或墙");
  const pushedId = definition.cartIds.find((id) => layout.cartTileById[id] === target.id);
  const carts = { ...layout.cartTileById };
  if (pushedId) {
    const landing = definition.tiles.find(
      (tile) => tile.x === target.x + dx && tile.y === target.y + dy,
    );
    if (
      !landing ||
      landing.terrain !== "floor" ||
      captureOccupiedTiles(layout).includes(landing.id)
    )
      return reject("推车前方没有空间，不能串推或撞入邦布");
    carts[pushedId] = landing.id;
  }
  const bangboos = { ...layout.bangbooTileById };
  const captured = [...layout.capturedBangbooIds];
  let escaped = false;
  for (const id of definition.bangbooIds) {
    const origin = definition.tiles.find((tile) => tile.id === bangboos[id]);
    if (!origin || Math.abs(origin.x - target.x) + Math.abs(origin.y - target.y) > 1) continue;
    const candidates = definition.escapeRules.priority.flatMap((candidateDirection) => {
      const [ex, ey] = offsets[candidateDirection];
      const tile = definition.tiles.find(
        (candidate) => candidate.x === origin.x + ex && candidate.y === origin.y + ey,
      );
      return tile &&
        tile.terrain === "floor" &&
        definition.escapeRules.escapeTileIds.includes(tile.id) &&
        tile.id !== target.id &&
        !Object.values(carts).includes(tile.id) &&
        !Object.values(bangboos).includes(tile.id)
        ? [tile]
        : [];
    });
    candidates.sort(
      (a, b) =>
        Math.abs(b.x - target.x) +
        Math.abs(b.y - target.y) -
        (Math.abs(a.x - target.x) + Math.abs(a.y - target.y)),
    );
    const escape = candidates[0];
    if (escape) {
      bangboos[id] = escape.id;
      escaped = true;
    } else {
      delete bangboos[id];
      captured.push(id);
    }
  }
  return {
    legal: true,
    playerTileId: target.id,
    layout: { cartTileById: carts, bangbooTileById: bangboos, capturedBangbooIds: captured },
    reason:
      captured.length > layout.capturedBangbooIds.length
        ? "逃路已封住，邦布捕获成功"
        : escaped
          ? "邦布逃向尚未堵住的道路"
          : pushedId
            ? "推车已移动一格"
            : "已移动",
  };
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return (
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}
export function validateCaptureLayout(
  definition: CaptureDefinition,
  raw: unknown,
  playerTileId?: string,
): string[] {
  if (
    !object(raw) ||
    !keys(raw, ["cartTileById", "bangbooTileById", "capturedBangbooIds"]) ||
    !object(raw.cartTileById) ||
    !object(raw.bangbooTileById) ||
    !Array.isArray(raw.capturedBangbooIds)
  )
    return ["捕获布局字段不合法"];
  const errors: string[] = [];
  const captured = raw.capturedBangbooIds;
  if (
    new Set(captured).size !== captured.length ||
    captured.some((id) => typeof id !== "string" || !definition.bangbooIds.includes(id))
  )
    errors.push("捕获ID未知或重复");
  if (
    !keys(raw.cartTileById, definition.cartIds) ||
    !keys(
      raw.bangbooTileById,
      definition.bangbooIds.filter((id) => !captured.includes(id)),
    )
  )
    errors.push("推车或邦布不守恒");
  const occupied = [...Object.values(raw.cartTileById), ...Object.values(raw.bangbooTileById)];
  if (new Set(occupied).size !== occupied.length) errors.push("捕获对象重复占格");
  for (const tileId of occupied)
    if (!definition.tiles.some((tile) => tile.id === tileId && tile.terrain === "floor"))
      errors.push("捕获对象超出地板边界");
  for (const tileId of Object.values(raw.bangbooTileById))
    if (typeof tileId !== "string" || !definition.escapeRules.escapeTileIds.includes(tileId))
      errors.push("邦布离开逃跑通路");
  if (
    playerTileId !== undefined &&
    (!definition.tiles.some((tile) => tile.id === playerTileId && tile.terrain !== "wall") ||
      occupied.includes(playerTileId))
  )
    errors.push("玩家位置与捕获布局不兼容");
  return errors;
}

export function validateCaptureDefinition(raw: unknown): string[] {
  const fields = [
    "kind",
    "id",
    "boardId",
    "title",
    "includedFrom",
    "sourceRecordIds",
    "tiles",
    "startTileId",
    "completedEntryTileId",
    "cartIds",
    "bangbooIds",
    "initialCartTileById",
    "initialBangbooTileById",
    "escapeRules",
    "captureConditions",
    "cartUnlockObjectiveId",
  ];
  if (!object(raw) || !keys(raw, fields)) return ["捕获定义字段不完整或含未知字段"];
  const errors: string[] = [];
  const id = (value: unknown): value is string =>
    typeof value === "string" &&
    value.length <= 128 &&
    /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(value);
  const ids = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every(id) && new Set(value).size === value.length;
  if (
    raw.kind !== "capture" ||
    raw.includedFrom !== "M3" ||
    !id(raw.id) ||
    !id(raw.boardId) ||
    !id(raw.startTileId) ||
    !id(raw.completedEntryTileId) ||
    typeof raw.title !== "string" ||
    !raw.title ||
    !ids(raw.sourceRecordIds) ||
    raw.sourceRecordIds.length === 0 ||
    !ids(raw.cartIds) ||
    !raw.cartIds.length ||
    !ids(raw.bangbooIds) ||
    !raw.bangbooIds.length ||
    raw.captureConditions !== "no-legal-escape-on-approach" ||
    (raw.cartUnlockObjectiveId !== null && !id(raw.cartUnlockObjectiveId))
  )
    errors.push("捕获定义类型或ID不合法");
  if (
    !object(raw.escapeRules) ||
    !keys(raw.escapeRules, ["kind", "escapeTileIds", "priority"]) ||
    raw.escapeRules.kind !== "adjacent-player-action" ||
    !ids(raw.escapeRules.escapeTileIds) ||
    !Array.isArray(raw.escapeRules.priority) ||
    raw.escapeRules.priority.length !== 4 ||
    new Set(raw.escapeRules.priority).size !== 4 ||
    raw.escapeRules.priority.some((value) => !Object.hasOwn(offsets, String(value)))
  )
    errors.push("逃跑路域或方向顺序未明确");
  if (!Array.isArray(raw.tiles) || !raw.tiles.length || raw.tiles.length > 256)
    errors.push("捕获棋盘预算不合法");
  else {
    const seen = new Set();
    const coordinates = new Set();
    for (const tile of raw.tiles) {
      if (
        !object(tile) ||
        !keys(tile, ["id", "boardId", "x", "y", "terrain"]) ||
        !id(tile.id) ||
        tile.boardId !== raw.boardId ||
        !Number.isSafeInteger(tile.x) ||
        !Number.isSafeInteger(tile.y) ||
        !["floor", "wall", "buffer"].includes(String(tile.terrain))
      ) {
        errors.push("捕获格子字段不合法");
        continue;
      }
      if (seen.has(tile.id) || coordinates.has(`${tile.x},${tile.y}`))
        errors.push("捕获坐标或ID重复");
      seen.add(tile.id);
      coordinates.add(`${tile.x},${tile.y}`);
    }
  }
  if (errors.length) return errors;
  const d = raw as unknown as CaptureDefinition;
  if (!object(d.initialCartTileById) || !object(d.initialBangbooTileById)) return ["缺少初始占格"];
  if (new Set([...d.cartIds, ...d.bangbooIds]).size !== d.cartIds.length + d.bangbooIds.length)
    errors.push("推车与邦布ID重复");
  if (!d.tiles.some((tile) => tile.id === d.completedEntryTileId && tile.terrain === "buffer"))
    errors.push("完成访问入口必须是明确玩家专用安全格");
  if (
    d.escapeRules.escapeTileIds.some(
      (tileId) => !d.tiles.some((tile) => tile.id === tileId && tile.terrain === "floor"),
    )
  )
    errors.push("逃路必须在捕获地板内");
  errors.push(...validateCaptureLayout(d, createCaptureLayout(d), d.startTileId));
  return errors;
}
