export type TheftDirection = "up" | "right" | "down" | "left";
export type ComponentColor = "cyan" | "amber" | "magenta";
export interface TheftTile {
  readonly id: string;
  readonly boardId: string;
  readonly x: number;
  readonly y: number;
  readonly terrain: "floor" | "wall" | "buffer";
}
export interface AssemblyTheftDefinition {
  readonly kind: "theft";
  readonly id: string;
  readonly boardId: string;
  readonly title: string;
  readonly includedFrom: "M3";
  readonly sourceRecordIds: readonly string[];
  readonly tiles: readonly TheftTile[];
  readonly startTileId: string;
  readonly ballIds: readonly string[];
  readonly baseStationIds: readonly string[];
  readonly amplifierIds: readonly string[];
  readonly powerPortIds: readonly string[];
  readonly initialBallTileById: Readonly<Record<string, string>>;
  readonly initialStationTileById: Readonly<Record<string, string>>;
  readonly stationByAmplifierId: Readonly<Record<string, string>>;
  readonly portTileById: Readonly<Record<string, string>>;
  readonly componentCompatibility: {
    readonly colorByBallId: Readonly<Record<string, ComponentColor>>;
    readonly colorByStationId: Readonly<Record<string, ComponentColor>>;
  };
  readonly portCompatibility: Readonly<Record<string, ComponentColor>>;
  readonly bufferTileIds: readonly string[];
  readonly interactionRules: "c-r1-component-boundaries";
}
export interface TheftLayout {
  readonly ballTileById: Readonly<Record<string, string>>;
  readonly stationTileById: Readonly<Record<string, string>>;
  readonly amplifierTileById: Readonly<Record<string, string>>;
  readonly assemblyByAmplifierId: Readonly<Record<string, { ballId: string; stationId: string }>>;
}
export interface TheftMove {
  readonly legal: boolean;
  readonly playerTileId: string;
  readonly layout: TheftLayout;
  readonly assembledAmplifierId: string | null;
  readonly reason: string;
}
const offsets: Readonly<Record<TheftDirection, readonly [number, number]>> = {
  up: [0, -1],
  right: [1, 0],
  down: [0, 1],
  left: [-1, 0],
};

export function createTheftLayout(definition: AssemblyTheftDefinition): TheftLayout {
  return {
    ballTileById: { ...definition.initialBallTileById },
    stationTileById: { ...definition.initialStationTileById },
    amplifierTileById: {},
    assemblyByAmplifierId: {},
  };
}
export function theftOccupiedTiles(layout: TheftLayout): string[] {
  return [
    ...Object.values(layout.ballTileById),
    ...Object.values(layout.stationTileById),
    ...Object.values(layout.amplifierTileById),
  ];
}
export function theftPowerActive(
  definition: AssemblyTheftDefinition,
  layout: TheftLayout,
): boolean {
  return definition.amplifierIds.every((id) => layout.assemblyByAmplifierId[id] !== undefined);
}
export function theftPortSatisfied(
  definition: AssemblyTheftDefinition,
  layout: TheftLayout,
  portId: string,
): boolean {
  if (!theftPowerActive(definition, layout)) return false;
  const amplifierId = definition.amplifierIds.find(
    (id) => layout.amplifierTileById[id] === definition.portTileById[portId],
  );
  const assembly = amplifierId ? layout.assemblyByAmplifierId[amplifierId] : undefined;
  return (
    !!assembly &&
    definition.componentCompatibility.colorByStationId[assembly.stationId] ===
      definition.portCompatibility[portId]
  );
}
export function theftSolved(definition: AssemblyTheftDefinition, layout: TheftLayout): boolean {
  return (
    theftPowerActive(definition, layout) &&
    definition.powerPortIds.every((id) => theftPortSatisfied(definition, layout, id))
  );
}
function neighbor(
  definition: AssemblyTheftDefinition,
  tileId: string,
  direction: TheftDirection,
): TheftTile | undefined {
  const tile = definition.tiles.find((candidate) => candidate.id === tileId);
  if (!tile) return undefined;
  const [dx, dy] = offsets[direction];
  return definition.tiles.find(
    (candidate) => candidate.x === tile.x + dx && candidate.y === tile.y + dy,
  );
}
const at = (positions: Readonly<Record<string, string>>, tileId: string): string | undefined =>
  Object.keys(positions).find((id) => positions[id] === tileId);

/** One complete slide / assembly / push is a single immutable rule transaction. */
export function moveTheft(
  definition: AssemblyTheftDefinition,
  layout: TheftLayout,
  playerTileId: string,
  direction: TheftDirection,
): TheftMove {
  const reject = (reason: string): TheftMove => ({
    legal: false,
    playerTileId,
    layout,
    assembledAmplifierId: null,
    reason,
  });
  if (!Object.hasOwn(offsets, direction)) return reject("只能四向移动");
  const target = neighbor(definition, playerTileId, direction);
  if (!target || target.terrain === "wall") return reject("面板边界或墙");
  if (at(layout.stationTileById, target.id)) return reject("基站不能单独推动；先用同色球组装");
  const amplifierId = at(layout.amplifierTileById, target.id);
  const ballId = at(layout.ballTileById, target.id);
  if (!amplifierId && !ballId)
    return {
      legal: true,
      playerTileId: target.id,
      layout,
      assembledAmplifierId: null,
      reason: "已移动",
    };
  if (amplifierId) {
    const landing = neighbor(definition, target.id, direction);
    if (!landing || landing.terrain !== "floor" || theftOccupiedTiles(layout).includes(landing.id))
      return reject("组合体只能推一格，不能串推或进入缓冲区");
    return {
      legal: true,
      playerTileId: target.id,
      layout: {
        ...layout,
        amplifierTileById: { ...layout.amplifierTileById, [amplifierId]: landing.id },
      },
      assembledAmplifierId: null,
      reason: "组合体已推动一格",
    };
  }
  if (!ballId) return reject("组件身份缺失");
  let landing = target;
  let matchingStationId: string | undefined;
  while (true) {
    const next = neighbor(definition, landing.id, direction);
    if (
      !next ||
      next.terrain !== "floor" ||
      at(layout.ballTileById, next.id) ||
      at(layout.amplifierTileById, next.id)
    )
      break;
    const stationId = at(layout.stationTileById, next.id);
    if (stationId) {
      if (
        definition.componentCompatibility.colorByBallId[ballId] ===
        definition.componentCompatibility.colorByStationId[stationId]
      ) {
        landing = next;
        matchingStationId = stationId;
      }
      break;
    }
    landing = next;
  }
  if (landing.id === target.id) return reject("球前方被阻挡，无法滑行");
  if (!matchingStationId)
    return {
      legal: true,
      playerTileId: target.id,
      layout: { ...layout, ballTileById: { ...layout.ballTileById, [ballId]: landing.id } },
      assembledAmplifierId: null,
      reason: "信号球滑到阻挡前",
    };
  const assembledId = definition.amplifierIds.find(
    (id) => definition.stationByAmplifierId[id] === matchingStationId,
  );
  if (!assembledId || layout.assemblyByAmplifierId[assembledId]) return reject("组合身份不合法");
  const balls = { ...layout.ballTileById };
  const stations = { ...layout.stationTileById };
  delete balls[ballId];
  delete stations[matchingStationId];
  return {
    legal: true,
    playerTileId: target.id,
    assembledAmplifierId: assembledId,
    reason: "同色球与基站已组合",
    layout: {
      ballTileById: balls,
      stationTileById: stations,
      amplifierTileById: { ...layout.amplifierTileById, [assembledId]: landing.id },
      assemblyByAmplifierId: {
        ...layout.assemblyByAmplifierId,
        [assembledId]: { ballId, stationId: matchingStationId },
      },
    },
  };
}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function sameKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return (
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}
/** Validate identity conservation as well as geometry, including untrusted saved attempts. */
export function validateTheftLayout(
  definition: AssemblyTheftDefinition,
  raw: unknown,
  playerTileId?: string,
): string[] {
  const errors: string[] = [];
  if (
    !object(raw) ||
    !sameKeys(raw, [
      "ballTileById",
      "stationTileById",
      "amplifierTileById",
      "assemblyByAmplifierId",
    ])
  )
    return ["盗取布局字段不完整或含未知字段"];
  const {
    ballTileById: balls,
    stationTileById: stations,
    amplifierTileById: amplifiers,
    assemblyByAmplifierId: assemblies,
  } = raw;
  if (!object(balls) || !object(stations) || !object(amplifiers) || !object(assemblies))
    return ["盗取组件映射必须是对象"];
  const usedBalls = new Set<string>();
  const usedStations = new Set<string>();
  for (const [id, pair] of Object.entries(assemblies)) {
    if (
      !definition.amplifierIds.includes(id) ||
      !object(pair) ||
      !sameKeys(pair, ["ballId", "stationId"]) ||
      typeof pair.ballId !== "string" ||
      typeof pair.stationId !== "string"
    ) {
      errors.push("非法组合身份");
      continue;
    }
    if (
      !definition.ballIds.includes(pair.ballId) ||
      !definition.baseStationIds.includes(pair.stationId) ||
      usedBalls.has(pair.ballId) ||
      usedStations.has(pair.stationId) ||
      definition.stationByAmplifierId[id] !== pair.stationId ||
      definition.componentCompatibility.colorByBallId[pair.ballId] !==
        definition.componentCompatibility.colorByStationId[pair.stationId]
    )
      errors.push("组合组件丢失、重复或不匹配");
    usedBalls.add(pair.ballId);
    usedStations.add(pair.stationId);
  }
  if (
    !sameKeys(
      balls,
      definition.ballIds.filter((id) => !usedBalls.has(id)),
    ) ||
    !sameKeys(
      stations,
      definition.baseStationIds.filter((id) => !usedStations.has(id)),
    ) ||
    !sameKeys(amplifiers, Object.keys(assemblies))
  )
    errors.push("组合前后组件不守恒");
  const occupied = [
    ...Object.values(balls),
    ...Object.values(stations),
    ...Object.values(amplifiers),
  ];
  if (new Set(occupied).size !== occupied.length) errors.push("盗取组件重复占格");
  for (const tileId of occupied)
    if (
      typeof tileId !== "string" ||
      !definition.tiles.some((tile) => tile.id === tileId && tile.terrain === "floor")
    )
      errors.push("组件落在墙、缓冲区或地图外");
  for (const [id, tileId] of Object.entries(stations))
    if (definition.initialStationTileById[id] !== tileId) errors.push("未组合基站被非法移动");
  if (
    playerTileId !== undefined &&
    (!definition.tiles.some((tile) => tile.id === playerTileId && tile.terrain !== "wall") ||
      occupied.includes(playerTileId))
  )
    errors.push("玩家位置越界或与组件重叠");
  return errors;
}

export function validateTheftDefinition(raw: unknown): string[] {
  const fields = [
    "kind",
    "id",
    "boardId",
    "title",
    "includedFrom",
    "sourceRecordIds",
    "tiles",
    "startTileId",
    "ballIds",
    "baseStationIds",
    "amplifierIds",
    "powerPortIds",
    "initialBallTileById",
    "initialStationTileById",
    "stationByAmplifierId",
    "portTileById",
    "componentCompatibility",
    "portCompatibility",
    "bufferTileIds",
    "interactionRules",
  ];
  if (!object(raw) || !sameKeys(raw, fields)) return ["盗取定义缺少字段或含未知字段"];
  const errors: string[] = [];
  const stableId = (value: unknown): value is string =>
    typeof value === "string" &&
    value.length <= 128 &&
    /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(value);
  const ids = (value: unknown): value is string[] =>
    Array.isArray(value) && new Set(value).size === value.length && value.every(stableId);
  if (
    raw.kind !== "theft" ||
    raw.includedFrom !== "M3" ||
    raw.interactionRules !== "c-r1-component-boundaries" ||
    !stableId(raw.id) ||
    !stableId(raw.boardId) ||
    !stableId(raw.startTileId) ||
    typeof raw.title !== "string" ||
    !raw.title ||
    !ids(raw.sourceRecordIds) ||
    raw.sourceRecordIds.length === 0
  )
    errors.push("盗取类型、版本、来源或ID不合法");
  for (const field of [
    "ballIds",
    "baseStationIds",
    "amplifierIds",
    "powerPortIds",
    "bufferTileIds",
  ])
    if (!ids(raw[field]) || (raw[field] as string[]).length === 0)
      errors.push(`盗取 ${field} 不合法`);
  if (!Array.isArray(raw.tiles) || raw.tiles.length === 0 || raw.tiles.length > 81)
    errors.push("盗取棋盘超出9×9预算");
  else {
    const seenIds = new Set();
    const seenCoordinates = new Set();
    for (const tile of raw.tiles) {
      if (
        !object(tile) ||
        !sameKeys(tile, ["id", "boardId", "x", "y", "terrain"]) ||
        !stableId(tile.id) ||
        tile.boardId !== raw.boardId ||
        !Number.isSafeInteger(tile.x) ||
        !Number.isSafeInteger(tile.y) ||
        !["floor", "wall", "buffer"].includes(String(tile.terrain))
      ) {
        errors.push("盗取格子字段不合法");
        continue;
      }
      if (seenIds.has(tile.id) || seenCoordinates.has(`${tile.x},${tile.y}`))
        errors.push("盗取格子ID或坐标重复");
      seenIds.add(tile.id);
      seenCoordinates.add(`${tile.x},${tile.y}`);
    }
  }
  if (errors.length) return errors;
  const d = raw as unknown as AssemblyTheftDefinition;
  if (
    new Set([...d.ballIds, ...d.baseStationIds, ...d.amplifierIds, ...d.powerPortIds]).size !==
    d.ballIds.length + d.baseStationIds.length + d.amplifierIds.length + d.powerPortIds.length
  )
    errors.push("组件ID跨类别重复");
  for (const count of [d.baseStationIds.length, d.amplifierIds.length, d.powerPortIds.length])
    if (count !== d.ballIds.length) errors.push("必需组件及接口数量不闭合");
  const maps: [unknown, readonly string[]][] = [
    [d.initialBallTileById, d.ballIds],
    [d.initialStationTileById, d.baseStationIds],
    [d.stationByAmplifierId, d.amplifierIds],
    [d.portTileById, d.powerPortIds],
    [d.portCompatibility, d.powerPortIds],
  ];
  if (
    !object(d.componentCompatibility) ||
    !sameKeys(d.componentCompatibility, ["colorByBallId", "colorByStationId"])
  )
    return [...errors, "组件匹配结构不合法"];
  maps.push(
    [d.componentCompatibility.colorByBallId, d.ballIds],
    [d.componentCompatibility.colorByStationId, d.baseStationIds],
  );
  if (
    maps.some(
      ([map, expected]) =>
        !object(map) ||
        !sameKeys(map, expected) ||
        Object.values(map).some((value) => typeof value !== "string"),
    )
  )
    return [...errors, "组件映射键或值不完整"];
  const colorMaps = [
    d.componentCompatibility.colorByBallId,
    d.componentCompatibility.colorByStationId,
    d.portCompatibility,
  ];
  for (const map of colorMaps)
    if (Object.values(map).some((color) => !["cyan", "amber", "magenta"].includes(color)))
      errors.push("未知组件颜色");
  for (const color of ["cyan", "amber", "magenta"]) {
    const counts = colorMaps.map(
      (map) => Object.values(map).filter((value) => value === color).length,
    );
    if (counts.some((count) => count !== counts[0])) errors.push("同色球、基站及接口数量不闭合");
  }
  if (
    new Set(Object.values(d.stationByAmplifierId)).size !== d.baseStationIds.length ||
    Object.values(d.stationByAmplifierId).some((id) => !d.baseStationIds.includes(id))
  )
    errors.push("组合体必须一一登记基站身份");
  if (
    new Set(Object.values(d.portTileById)).size !== d.powerPortIds.length ||
    Object.values(d.portTileById).some(
      (id) => !d.tiles.some((tile) => tile.id === id && tile.terrain === "floor"),
    )
  )
    errors.push("接口重叠或不在普通地板");
  const buffers = d.tiles.filter((tile) => tile.terrain === "buffer").map((tile) => tile.id);
  if (
    buffers.length !== d.bufferTileIds.length ||
    buffers.some((id) => !d.bufferTileIds.includes(id))
  )
    errors.push("缓冲区集合与地形不一致");
  const xs = d.tiles.map((tile) => tile.x),
    ys = d.tiles.map((tile) => tile.y);
  if (Math.max(...xs) - Math.min(...xs) >= 9 || Math.max(...ys) - Math.min(...ys) >= 9)
    errors.push("盗取棋盘超过9列或9行");
  errors.push(...validateTheftLayout(d, createTheftLayout(d), d.startTileId));
  if (theftSolved(d, createTheftLayout(d))) errors.push("盗取初态不能已经成功");
  return errors;
}
