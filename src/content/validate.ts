import { createGame, dispatch } from "../core/engine.ts";
import { areaData, supplyProgress } from "../core/progress.ts";
import { validateStaticDefinition } from "../core/static-puzzle.ts";
import { validateRealtimeDefinition } from "../core/realtime.ts";
import type {
  GameCommand,
  GameContent,
  GameState,
  GateCondition,
  ProfileId,
  WorldDefinition,
} from "../core/types.ts";

export interface ContentValidationIssue {
  readonly path: string;
  readonly message: string;
}
type RecordValue = Record<string, unknown>;
const profiles: readonly ProfileId[] = ["M1", "M2", "M3", "M4", "M5"];
const areaIds = ["hub", "a", "b", "c", "d", "warehouse"] as const;
const expectedSupply = [26, 51, 81, 130, 130];
const expectedScope = ["a.main", "b.main", "c.main", "warehouse.complete", "warehouse.complete"];
const expectedRewardIds = [
  "hub.supply.tutorial",
  "hub.supply.final",
  "a.supply.maze01",
  "a.supply.maze03",
  "a.supply.firewall.inner",
  "a.supply.firewall.deep",
  "a.supply.firewall.core",
  "a.supply.revisit",
  "b.supply.line01",
  "b.supply.line02",
  "b.supply.antivirus.light",
  "b.supply.antivirus.medium",
  "b.supply.antivirus.heavy",
  "b.supply.revisit",
  "c.supply.route.entry",
  "c.supply.route.exit",
  "c.supply.theft01",
  "c.supply.theft02",
  "c.supply.theft03",
  "c.supply.side",
  "d.supply.permission01",
  "d.supply.permission02",
  "d.supply.permission03",
  "d.supply.permission04",
  "d.supply.hidden",
  "d.supply.ghosts",
];

function record(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function id(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 160 &&
    /^[a-z][a-z0-9]*(?:[._-][a-z0-9-]+)*$/.test(value)
  );
}
function oneOf(value: unknown, choices: readonly string[]): boolean {
  return typeof value === "string" && choices.includes(value);
}
function issue(issues: ContentValidationIssue[], path: string, message: string): void {
  issues.push({ path, message });
}
function keys(
  value: RecordValue,
  required: readonly string[],
  path: string,
  issues: ContentValidationIssue[],
): void {
  for (const key of required)
    if (!Object.hasOwn(value, key)) issue(issues, `${path}.${key}`, "缺少必需字段");
  for (const key of Object.keys(value))
    if (!required.includes(key)) issue(issues, `${path}.${key}`, "未知字段");
}
function ids(
  value: unknown,
  path: string,
  issues: ContentValidationIssue[],
  allowed?: readonly string[],
): string[] {
  if (!Array.isArray(value)) {
    issue(issues, path, "必须是 ID 数组");
    return [];
  }
  const result: string[] = [];
  for (const entry of value) {
    if (!(allowed ? oneOf(entry, allowed) : id(entry)))
      issue(issues, path, `非法 ID ${String(entry)}`);
    else if (result.includes(entry as string)) issue(issues, path, `重复 ID ${String(entry)}`);
    else result.push(entry as string);
  }
  return result;
}
function textField(value: unknown, path: string, issues: ContentValidationIssue[]): void {
  if (typeof value !== "string" || value.trim().length === 0) issue(issues, path, "必须是非空文字");
}
function integer(
  value: unknown,
  path: string,
  issues: ContentValidationIssue[],
  min = 1,
  max = Number.MAX_SAFE_INTEGER,
): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max)
    issue(issues, path, `必须是 ${min}–${max} 的安全整数`);
}
function idField(value: unknown, path: string, issues: ContentValidationIssue[]): void {
  if (!id(value)) issue(issues, path, "非法稳定 ID");
}
function entries(raw: RecordValue, key: string, issues: ContentValidationIssue[]): RecordValue[] {
  const values = raw[key];
  if (!Array.isArray(values)) {
    issue(issues, key, "必须是数组");
    return [];
  }
  const result: RecordValue[] = [];
  const seen = new Set<string>();
  for (const [index, value] of values.entries()) {
    if (!record(value)) {
      issue(issues, `${key}[${index}]`, "必须是对象");
      continue;
    }
    if (typeof value.id !== "string") issue(issues, `${key}[${index}].id`, "缺少 ID");
    else {
      if (seen.has(value.id)) issue(issues, `${key}.${value.id}`, "重复 ID");
      seen.add(value.id);
    }
    result.push(value);
  }
  return result;
}
function condition(
  value: unknown,
  path: string,
  issues: ContentValidationIssue[],
  allowAreaData = false,
  depth = 0,
): void {
  if (!record(value) || depth > 32) {
    issue(issues, path, "无效条件或超过 32 层");
    return;
  }
  switch (value.kind) {
    case "always":
      keys(value, ["kind"], path, issues);
      break;
    case "objective":
      keys(value, ["kind", "objectiveId"], path, issues);
      idField(value.objectiveId, path, issues);
      break;
    case "capability":
      keys(value, ["kind", "capabilityId"], path, issues);
      if (!oneOf(value.capabilityId, ["amplifier", "unlimitedAmplifier"]))
        issue(issues, path, "未知能力");
      break;
    case "all":
      keys(value, ["kind", "conditions"], path, issues);
      if (!Array.isArray(value.conditions) || value.conditions.length === 0)
        issue(issues, path, "all 必须含至少一个条件");
      else
        value.conditions.forEach((child, index) =>
          condition(child, `${path}.conditions[${index}]`, issues, allowAreaData, depth + 1),
        );
      break;
    case "areaDataComplete":
      keys(value, ["kind", "areaId"], path, issues);
      if (!allowAreaData || !oneOf(value.areaId, ["a", "b", "c", "d"]))
        issue(issues, path, "全区数据条件只允许中央仓库门及其最终终端");
      break;
    default:
      issue(issues, path, "未知 gate kind，禁止脚本条件");
  }
}
function references(gate: GateCondition, nodes: WorldDefinition["dataNodes"]): string[] {
  switch (gate.kind) {
    case "always":
      return [];
    case "objective":
      return [gate.objectiveId];
    case "capability":
      return [gate.capabilityId === "amplifier" ? "hub.amplifier" : "hub.tutorial"];
    case "all":
      return gate.conditions.flatMap((child) => references(child, nodes));
    case "areaDataComplete":
      return nodes
        .filter((node) => node.areaId === gate.areaId)
        .map((node) => node.completionObjectiveId);
  }
}
function sameIds(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((entry) => expected.includes(entry));
}
function sameData(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(actual) && Array.isArray(expected))
    return (
      actual.length === expected.length &&
      actual.every((value, index) => sameData(value, expected[index]))
    );
  if (record(actual) && record(expected))
    return (
      Object.keys(actual).length === Object.keys(expected).length &&
      Object.keys(actual).every(
        (key) => Object.hasOwn(expected, key) && sameData(actual[key], expected[key]),
      )
    );
  return Object.is(actual, expected);
}
function requireReference(
  value: string,
  available: ReadonlySet<string>,
  path: string,
  issues: ContentValidationIssue[],
): void {
  if (!available.has(value)) issue(issues, path, `未解析引用 ${value}`);
}

/** Validates the full design ledger without claiming unreleased maps have been built. */
export function validateCatalog(raw: unknown): ContentValidationIssue[] {
  const issues: ContentValidationIssue[] = [];
  if (!record(raw)) return [{ path: "world.json", message: "必须是对象" }];
  if (raw.gameId !== "camellia-golden-week") issue(issues, "gameId", "错误的项目标识");
  integer(raw.contentVersion, "contentVersion", issues);
  integer(raw.ruleVersion, "ruleVersion", issues);
  ids(raw.areaIds, "areaIds", issues, areaIds);
  const objectives = entries(raw, "objectives", issues);
  const dataNodes = entries(raw, "dataNodes", issues);
  const rewards = entries(raw, "rewards", issues);
  const gates = entries(raw, "gates", issues);
  const releaseProfiles = entries(raw, "releaseProfiles", issues);
  for (const value of objectives) {
    const path = `objectives.${String(value.id)}`;
    keys(value, ["id", "kind", "producer", "prerequisites", "includedFrom"], path, issues);
    idField(value.id, path, issues);
    idField(value.producer, `${path}.producer`, issues);
    if (!oneOf(value.kind, ["route", "puzzle", "terminal", "challenge", "aggregate", "ending"]))
      issue(issues, path, "未知 objective kind");
    integer(value.includedFrom, `${path}.includedFrom`, issues, 1, 5);
    condition(
      value.prerequisites,
      `${path}.prerequisites`,
      issues,
      value.id === "warehouse.complete",
    );
  }
  for (const value of dataNodes) {
    const path = `dataNodes.${String(value.id)}`;
    keys(value, ["id", "areaId", "weight", "completionObjectiveId", "includedFrom"], path, issues);
    idField(value.id, path, issues);
    idField(value.completionObjectiveId, `${path}.completionObjectiveId`, issues);
    if (!oneOf(value.areaId, ["a", "b", "c", "d"])) issue(issues, path, "数据只能归属 A–D");
    if (value.weight !== 20) issue(issues, path, "数据节点权重必须为 20");
    integer(value.includedFrom, `${path}.includedFrom`, issues, 1, 5);
  }
  for (const value of rewards) {
    const path = `rewards.${String(value.id)}`;
    keys(
      value,
      ["id", "statsAreaId", "units", "claimMode", "producerId", "prerequisites", "includedFrom"],
      path,
      issues,
    );
    idField(value.id, path, issues);
    idField(value.producerId, `${path}.producerId`, issues);
    if (!oneOf(value.statsAreaId, ["hub", "a", "b", "c", "d"])) issue(issues, path, "非法统计区域");
    integer(value.units, `${path}.units`, issues);
    integer(value.includedFrom, `${path}.includedFrom`, issues, 1, 5);
    if (!oneOf(value.claimMode, ["pickup", "grant"])) issue(issues, path, "未知领取方式");
    condition(value.prerequisites, `${path}.prerequisites`, issues);
  }
  for (const value of gates) {
    const path = `gates.${String(value.id)}`;
    keys(value, ["id", "condition", "reason"], path, issues);
    idField(value.id, path, issues);
    if (value.id === "always") {
      if (typeof value.reason !== "string")
        issue(issues, `${path}.reason`, "无条件门说明必须是文字");
    } else textField(value.reason, `${path}.reason`, issues);
    condition(value.condition, `${path}.condition`, issues, value.id === "gate.warehouse");
  }
  for (const value of releaseProfiles) {
    const path = `releaseProfiles.${String(value.id)}`;
    keys(
      value,
      [
        "id",
        "includedAreaIds",
        "includedRoomIds",
        "includedObjectiveIds",
        "includedRewardIds",
        "scopeTerminalObjectiveId",
        "fullCampaign",
      ],
      path,
      issues,
    );
    if (!oneOf(value.id, profiles)) issue(issues, path, "未知发布 profile");
    ids(value.includedAreaIds, `${path}.includedAreaIds`, issues, areaIds);
    for (const key of ["includedRoomIds", "includedObjectiveIds", "includedRewardIds"])
      ids(value[key], `${path}.${key}`, issues);
    idField(value.scopeTerminalObjectiveId, `${path}.scopeTerminalObjectiveId`, issues);
    if (typeof value.fullCampaign !== "boolean") issue(issues, path, "fullCampaign 必须是布尔值");
  }
  if (issues.length > 0) return issues;
  const catalog = raw as unknown as WorldDefinition;
  const objectiveIds = new Set(catalog.objectives.map((value) => value.id));
  const producers = new Map<string, string[]>();
  const dependencies = new Map(
    catalog.objectives.map((value) => [
      value.id,
      references(value.prerequisites, catalog.dataNodes),
    ]),
  );
  for (const value of catalog.objectives) {
    for (const dependency of dependencies.get(value.id) ?? []) {
      requireReference(dependency, objectiveIds, `objectives.${value.id}.prerequisites`, issues);
      const prerequisite = catalog.objectives.find((candidate) => candidate.id === dependency);
      if (prerequisite && prerequisite.includedFrom > value.includedFrom)
        issue(issues, `objectives.${value.id}`, `依赖未收录目标 ${dependency}`);
    }
    if (value.kind !== "aggregate")
      producers.set(value.producer, [...(producers.get(value.producer) ?? []), value.id]);
  }
  for (const [producer, values] of producers)
    if (values.length > 1)
      issue(issues, `objectives.${producer}`, "一个生产者声明了多个独立事件目标");
  const complete = new Set<string>();
  const visiting = new Set<string>();
  const visit = (current: string, chain: string[]): void => {
    if (visiting.has(current)) {
      issue(issues, `objectives.${current}`, `依赖环：${[...chain, current].join(" → ")}`);
      return;
    }
    if (complete.has(current)) return;
    visiting.add(current);
    for (const dependency of dependencies.get(current) ?? [])
      visit(dependency, [...chain, current]);
    visiting.delete(current);
    complete.add(current);
  };
  for (const value of objectiveIds) visit(value, []);
  const ancestors = (start: string): Set<string> => {
    const found = new Set<string>();
    const pending = [...(dependencies.get(start) ?? [])];
    while (pending.length) {
      const next = pending.pop();
      if (!next || found.has(next)) continue;
      found.add(next);
      pending.push(...(dependencies.get(next) ?? []));
    }
    return found;
  };
  for (const main of ["a.main", "b.main", "c.main", "d.main"]) {
    const forbidden = [...ancestors(main)].filter(
      (value) =>
        /firewall|antivirus|revisit|warehouse/.test(value) ||
        [
          "a.maze.02",
          "a.maze.03",
          "b.line.02",
          "c.theft.01",
          "c.theft.02",
          "c.theft.03",
          "d.hidden.terminal",
        ].includes(value),
    );
    if (forbidden.length)
      issue(issues, `objectives.${main}`, `主路径错误读取可选 / 开库支路：${forbidden.join(", ")}`);
  }
  for (const revisit of ["a.revisit.terminal", "b.revisit.terminal"]) {
    if (
      !ancestors(revisit).has("d.main") ||
      [...ancestors(revisit)].some((value) => value.startsWith("warehouse"))
    )
      issue(issues, `objectives.${revisit}`, "回访应由 D 四权限开放，不依赖仓库");
  }
  for (const value of catalog.gates)
    for (const dependency of references(value.condition, catalog.dataNodes))
      requireReference(dependency, objectiveIds, `gates.${value.id}`, issues);
  for (const value of catalog.dataNodes) {
    requireReference(value.completionObjectiveId, objectiveIds, `dataNodes.${value.id}`, issues);
    const producer = catalog.objectives.find(
      (candidate) => candidate.id === value.completionObjectiveId,
    );
    if (
      producer &&
      (producer.includedFrom > value.includedFrom || /firewall|antivirus/.test(producer.id))
    )
      issue(issues, `dataNodes.${value.id}`, "数据目标引用计分挑战或未来目标");
  }
  if (
    catalog.dataNodes.length !== 20 ||
    new Set(catalog.dataNodes.map((value) => value.completionObjectiveId)).size !== 20
  )
    issue(issues, "dataNodes", "必须是 20 个唯一事件对应的数据节点");
  for (const area of ["a", "b", "c", "d"])
    if (catalog.dataNodes.filter((value) => value.areaId === area).length !== 5)
      issue(issues, `dataNodes.${area}`, "每区必须有 5 × 20 数据");
  if (
    !sameIds(
      catalog.rewards.map((value) => value.id),
      expectedRewardIds,
    )
  )
    issue(issues, "rewards", "奖励必须保留合同的 26 个唯一稳定 ID");
  for (const value of catalog.rewards) {
    const expectedUnits =
      value.id === "hub.supply.tutorial" ? 1 : value.id === "hub.supply.final" ? 9 : 5;
    if (value.units !== expectedUnits || !value.id.startsWith(`${value.statsAreaId}.`))
      issue(issues, `rewards.${value.id}`, "奖励数量或统计区域违反合同");
    if ((value.claimMode === "grant") !== value.id.startsWith("hub."))
      issue(issues, `rewards.${value.id}`, "只有中心教学 / 最终终端直接 grant，其余必须 pickup");
    for (const dependency of references(value.prerequisites, catalog.dataNodes))
      requireReference(dependency, objectiveIds, `rewards.${value.id}`, issues);
  }
  if (new Set(catalog.rewards.map((value) => value.producerId)).size !== 26)
    issue(issues, "rewards", "每个奖励必须有唯一生产者");
  if (
    !sameIds(
      catalog.releaseProfiles.map((value) => value.id),
      profiles,
    )
  )
    issue(issues, "releaseProfiles", "需要 M1–M5 五个 profile");
  for (const [index, profileId] of profiles.entries()) {
    const profile = catalog.releaseProfiles.find((value) => value.id === profileId);
    if (!profile) continue;
    const stage = index + 1;
    const included = catalog.rewards.filter((value) => value.includedFrom <= stage);
    if (included.reduce((sum, value) => sum + value.units, 0) !== expectedSupply[index])
      issue(issues, `releaseProfiles.${profileId}`, `物资总量必须为 ${expectedSupply[index]}`);
    if (
      !sameIds(
        profile.includedRewardIds,
        included.map((value) => value.id),
      )
    )
      issue(issues, `releaseProfiles.${profileId}.includedRewardIds`, "奖励清单与收录阶段不一致");
    if (
      !sameIds(
        profile.includedObjectiveIds,
        catalog.objectives.filter((value) => value.includedFrom <= stage).map((value) => value.id),
      )
    )
      issue(
        issues,
        `releaseProfiles.${profileId}.includedObjectiveIds`,
        "目标清单与收录阶段不一致",
      );
    if (!sameIds(profile.includedAreaIds, stage < 4 ? areaIds.slice(0, stage + 1) : areaIds))
      issue(issues, `releaseProfiles.${profileId}.includedAreaIds`, "地区范围与阶段不一致");
    if (
      profile.fullCampaign !== stage >= 4 ||
      profile.scopeTerminalObjectiveId !== expectedScope[index]
    )
      issue(issues, `releaseProfiles.${profileId}`, "包内终点 / 完整版标记错误");
    for (const roomId of profile.includedRoomIds) {
      const objective = catalog.objectives.find((value) => value.id === roomId);
      if (
        !objective ||
        !["puzzle", "challenge"].includes(objective.kind) ||
        objective.includedFrom > stage
      )
        issue(issues, `releaseProfiles.${profileId}.includedRoomIds`, `非法房间引用 ${roomId}`);
    }
  }
  return issues;
}

/** Validates only the maps and references actually materialized in this profile. */
export function validateContent(raw: unknown): ContentValidationIssue[] {
  const issues: ContentValidationIssue[] = [];
  if (!record(raw)) return [{ path: "content", message: "必须是已装配的内容对象" }];
  const areaValues = entries(raw, "areas", issues);
  const tileValues = entries(raw, "tiles", issues);
  const entityValues = entries(raw, "entities", issues);
  const roomValues = entries(raw, "rooms", issues);
  const effects = entries(raw, "effects", issues);
  const sources = entries(raw, "sources", issues);
  for (const key of [
    "objectives",
    "dataNodes",
    "rewards",
    "gates",
    "catalogObjectives",
    "catalogDataNodes",
    "catalogRewards",
    "staticChallenges",
    "realtimeChallenges",
  ])
    entries(raw, key, issues);
  if (!record(raw.profile) || !oneOf(raw.profile.id, profiles))
    issue(issues, "profile", "缺少有效的已加载 profile");
  else {
    keys(
      raw.profile,
      [
        "id",
        "includedAreaIds",
        "includedRoomIds",
        "includedObjectiveIds",
        "includedRewardIds",
        "scopeTerminalObjectiveId",
        "fullCampaign",
      ],
      "profile",
      issues,
    );
    ids(raw.profile.includedAreaIds, "profile.includedAreaIds", issues, areaIds);
    for (const key of ["includedRoomIds", "includedObjectiveIds", "includedRewardIds"])
      ids(raw.profile[key], `profile.${key}`, issues);
    idField(raw.profile.scopeTerminalObjectiveId, "profile.scopeTerminalObjectiveId", issues);
    if (typeof raw.profile.fullCampaign !== "boolean")
      issue(issues, "profile.fullCampaign", "必须是布尔值");
  }
  if (!record(raw.entry) || !oneOf(raw.entry.areaId, areaIds) || !id(raw.entry.tileId))
    issue(issues, "entry", "缺少世界入口");
  for (const value of areaValues) {
    const path = `areas.${String(value.id)}`;
    keys(
      value,
      [
        "id",
        "label",
        "subtitle",
        "statsAreaId",
        "tileIds",
        "roomIds",
        "entryTileId",
        "teleportId",
        "entityIds",
        "revealGroups",
        "sourceRecordIds",
        "includedFrom",
      ],
      path,
      issues,
    );
    if (!oneOf(value.id, areaIds) || !oneOf(value.statsAreaId, areaIds.slice(0, -1)))
      issue(issues, path, "非法场景 / 统计区");
    textField(value.label, path, issues);
    textField(value.subtitle, path, issues);
    for (const key of ["tileIds", "roomIds", "entityIds", "sourceRecordIds"])
      ids(value[key], `${path}.${key}`, issues);
    for (const key of ["entryTileId", "teleportId"]) idField(value[key], `${path}.${key}`, issues);
    integer(value.includedFrom, path, issues, 1, 5);
    if (!Array.isArray(value.revealGroups)) issue(issues, path, "revealGroups 必须是数组");
    else
      for (const group of value.revealGroups) {
        if (!record(group)) issue(issues, path, "非法显露组");
        else {
          keys(group, ["id", "tileIds"], `${path}.revealGroups`, issues);
          idField(group.id, path, issues);
          ids(group.tileIds, path, issues);
        }
      }
  }
  for (const value of tileValues) {
    const path = `tiles.${String(value.id)}`;
    keys(
      value,
      [
        "id",
        "boardId",
        "x",
        "y",
        "terrain",
        "initialDiscovery",
        "etherGroupId",
        "hiddenGroupId",
        "overlayIds",
        "includedFrom",
      ],
      path,
      issues,
    );
    idField(value.id, path, issues);
    idField(value.boardId, `${path}.boardId`, issues);
    integer(value.x, `${path}.x`, issues, Number.MIN_SAFE_INTEGER);
    integer(value.y, `${path}.y`, issues, Number.MIN_SAFE_INTEGER);
    if (!oneOf(value.terrain, ["floor", "wall"]) || typeof value.initialDiscovery !== "boolean")
      issue(issues, path, "非法地形或发现状态");
    for (const key of ["etherGroupId", "hiddenGroupId"])
      if (value[key] !== null) idField(value[key], `${path}.${key}`, issues);
    ids(value.overlayIds, `${path}.overlayIds`, issues);
    integer(value.includedFrom, path, issues, 1, 5);
  }
  const paramFields: Record<string, readonly string[]> = {
    amplifier: ["completionObjectiveId"],
    nexus: ["clearsTileIds", "revealsGroupIds", "capabilityRequired", "completionObjectiveId"],
    terminal: ["interactionMode", "prerequisites", "effectBundleId"],
    switch: ["interactionMode", "prerequisites", "effectBundleId"],
    observer: ["interactionMode", "prerequisites", "effectBundleId"],
    door: ["closedBlocksMovement", "lockedReasonKey"],
    supply: ["rewardId"],
    data: ["objectiveId"],
    teleport: ["destinationAreaId", "destinationTileId", "activationObjectiveId"],
    checkpoint: ["teleportId"],
    roomEntrance: ["roomId", "interactionMode"],
    challengeAccess: ["challengeIds"],
    unavailable: ["message"],
  };
  for (const value of entityValues) {
    const path = `entities.${String(value.id)}`;
    keys(
      value,
      [
        "id",
        "kind",
        "tileId",
        "gateId",
        "effectBundleId",
        "sourceRecordIds",
        "label",
        "includedFrom",
        "params",
      ],
      path,
      issues,
    );
    for (const key of ["id", "tileId", "gateId"]) idField(value[key], `${path}.${key}`, issues);
    if (value.effectBundleId !== null)
      idField(value.effectBundleId, `${path}.effectBundleId`, issues);
    ids(value.sourceRecordIds, path, issues);
    textField(value.label, path, issues);
    integer(value.includedFrom, path, issues, 1, 5);
    const expected = typeof value.kind === "string" ? paramFields[value.kind] : undefined;
    if (!expected || !record(value.params)) {
      issue(issues, path, "未知实体 kind 或非法 params");
      continue;
    }
    keys(value.params, expected, `${path}.params`, issues);
    for (const [key, parameter] of Object.entries(value.params)) {
      if (key === "prerequisites")
        condition(
          parameter,
          `${path}.params.prerequisites`,
          issues,
          value.id === "warehouse.final.terminal",
        );
      else if (["clearsTileIds", "revealsGroupIds", "challengeIds"].includes(key))
        ids(parameter, `${path}.params.${key}`, issues);
      else if (key === "closedBlocksMovement") {
        if (typeof parameter !== "boolean") issue(issues, path, "门阻挡标记必须是布尔值");
      } else if (key === "destinationAreaId") {
        if (!oneOf(parameter, areaIds)) issue(issues, path, "未知目标区域");
      } else if (key === "capabilityRequired") {
        if (parameter !== "amplifier") issue(issues, path, "富集节点只能要求增幅仪");
      } else if (key === "interactionMode") {
        if (!oneOf(parameter, value.kind === "roomEntrance" ? ["enter", "interact"] : ["interact"]))
          issue(issues, path, "未知交互模式");
      } else if (key === "message" || key === "lockedReasonKey") textField(parameter, path, issues);
      else if (key !== "activationObjectiveId" || parameter !== null)
        idField(parameter, `${path}.params.${key}`, issues);
    }
  }
  for (const value of roomValues) {
    const path = `rooms.${String(value.id)}`;
    keys(
      value,
      [
        "id",
        "areaId",
        "boardId",
        "mode",
        "worldEntranceTileId",
        "entryTileId",
        "returnTileId",
        "successExitTileId",
        "resetState",
        "goal",
        "effectBundleId",
        "witnessIds",
        "includedFrom",
      ],
      path,
      issues,
    );
    for (const key of [
      "id",
      "boardId",
      "worldEntranceTileId",
      "entryTileId",
      "returnTileId",
      "successExitTileId",
      "resetState",
      "goal",
      "effectBundleId",
    ])
      idField(value[key], `${path}.${key}`, issues);
    if (!oneOf(value.areaId, areaIds) || !oneOf(value.mode, ["staticPuzzle", "challengeRunning"]))
      issue(issues, path, "非法房间场景 / 模式");
    ids(value.witnessIds, path, issues);
    integer(value.includedFrom, path, issues, 1, 5);
  }
  for (const value of effects) {
    const path = `effects.${String(value.id)}`;
    keys(
      value,
      ["id", "completeObjectiveIds", "grantRewardIds", "revealGroupIds", "clearEtherTileIds"],
      path,
      issues,
    );
    idField(value.id, path, issues);
    for (const key of [
      "completeObjectiveIds",
      "grantRewardIds",
      "revealGroupIds",
      "clearEtherTileIds",
    ])
      ids(value[key], `${path}.${key}`, issues);
  }
  for (const value of sources) {
    const path = `sources.${String(value.id)}`;
    keys(
      value,
      [
        "id",
        "urlOrPath",
        "locator",
        "checkedAt",
        "evidenceLevel",
        "supportedClaim",
        "limitation",
        "adaptedElementIds",
      ],
      path,
      issues,
    );
    idField(value.id, path, issues);
    ids(value.adaptedElementIds, path, issues);
    for (const key of ["urlOrPath", "locator", "checkedAt", "supportedClaim", "limitation"])
      textField(value[key], `${path}.${key}`, issues);
    if (!oneOf(value.evidenceLevel, ["reconstruction", "measured", "reference"]))
      issue(issues, path, "未知来源证据等级");
    if (
      value.evidenceLevel === "measured" &&
      typeof value.locator === "string" &&
      /未取得|未观看|没有定位/.test(value.locator)
    )
      issue(issues, path, "没有原参考定位时不能标已测绘");
  }
  if (Array.isArray(raw.staticChallenges))
    for (const value of raw.staticChallenges)
      issues.push(
        ...validateStaticDefinition(value).map((message) => ({
          path: "staticChallenges",
          message,
        })),
      );
  if (Array.isArray(raw.realtimeChallenges))
    for (const value of raw.realtimeChallenges)
      issues.push(
        ...validateRealtimeDefinition(value).map((value) => ({
          path: "realtimeChallenges",
          message: JSON.stringify(value),
        })),
      );
  if (issues.length > 0) return issues;
  const content = raw as unknown as GameContent;
  issues.push(
    ...validateCatalog({
      ...content,
      objectives: content.catalogObjectives,
      dataNodes: content.catalogDataNodes,
      rewards: content.catalogRewards,
    }),
  );
  if (issues.length > 0) return issues;
  for (const [loaded, catalog, path] of [
    [content.objectives, content.catalogObjectives, "objectives"],
    [content.dataNodes, content.catalogDataNodes, "dataNodes"],
    [content.rewards, content.catalogRewards, "rewards"],
  ] as const) {
    for (const value of loaded) {
      const canonical = catalog.find((entry) => entry.id === value.id);
      if (!canonical || !sameData(value, canonical))
        issue(issues, `${path}.${value.id}`, "已加载条目与已验证的权威目录不一致");
    }
  }
  if (issues.length > 0) return issues;
  const stage = Number(content.profile.id.slice(1));
  if (
    content.profile.fullCampaign !== stage >= 4 ||
    content.profile.scopeTerminalObjectiveId !== expectedScope[stage - 1]
  )
    issue(issues, "profile", "已加载 profile 的完成标记或终点违反阶段合同");
  const objectiveIds = new Set(content.objectives.map((value) => value.id));
  const rewardIds = new Set(content.rewards.map((value) => value.id));
  const tileIds = new Set(content.tiles.map((value) => value.id));
  const entityIds = new Set(content.entities.map((value) => value.id));
  const roomIds = new Set(content.rooms.map((value) => value.id));
  const gateIds = new Set(content.gates.map((value) => value.id));
  const effectIds = new Set(content.effects.map((value) => value.id));
  const sourceIds = new Set(content.sources.map((value) => value.id));
  const groupIds = new Set(
    content.areas.flatMap((area) => area.revealGroups.map((group) => group.id)),
  );
  const floor = (tileId: string, boardId?: string) =>
    content.tiles.some(
      (value) =>
        value.id === tileId &&
        value.terrain === "floor" &&
        (boardId === undefined || value.boardId === boardId),
    );
  const referencesIncluded = (gate: GateCondition, path: string) => {
    for (const dependency of references(gate, content.dataNodes))
      requireReference(dependency, objectiveIds, path, issues);
  };
  const coordinates = new Set<string>();
  for (const value of content.gates)
    condition(
      value.condition,
      `gates.${value.id}.condition`,
      issues,
      value.id === "gate.warehouse",
    );
  if (issues.length > 0) return issues;
  for (const value of content.tiles) {
    const coordinate = `${value.boardId}:${value.x},${value.y}`;
    if (coordinates.has(coordinate)) issue(issues, `tiles.${value.id}`, "同棋盘坐标重复");
    coordinates.add(coordinate);
    if (value.includedFrom > stage) issue(issues, `tiles.${value.id}`, "加载了未来地图坐标");
    if (!content.areas.some((area) => area.id === value.boardId && area.tileIds.includes(value.id)))
      issue(issues, `tiles.${value.id}`, "格子不属于任何已加载区域");
    if (value.hiddenGroupId)
      requireReference(value.hiddenGroupId, groupIds, `tiles.${value.id}`, issues);
  }
  if (
    !sameIds(
      content.profile.includedAreaIds,
      content.areas.map((area) => area.id),
    )
  )
    issue(issues, "profile.includedAreaIds", "已加载地区与声明不一致；未来地图不能假称通过");
  if (!sameIds(content.profile.includedRoomIds, [...roomIds]))
    issue(issues, "profile.includedRoomIds", "已加载房间与声明不一致");
  if (
    !sameIds(content.profile.includedObjectiveIds, [...objectiveIds]) ||
    !sameIds(content.profile.includedRewardIds, [...rewardIds])
  )
    issue(issues, "profile", "已加载目标 / 奖励与 profile 不一致");
  if (!floor(content.entry.tileId, content.entry.areaId))
    issue(issues, "entry", "世界出生点不在安全地板");
  for (const area of content.areas) {
    if (area.tileIds.length > 2048 || !floor(area.entryTileId, area.id))
      issue(issues, `areas.${area.id}`, "区域预算超限或入口不是本区地板");
    for (const reference of area.tileIds)
      requireReference(reference, tileIds, `areas.${area.id}.tileIds`, issues);
    for (const reference of area.entityIds)
      requireReference(reference, entityIds, `areas.${area.id}.entityIds`, issues);
    for (const reference of area.roomIds)
      requireReference(reference, roomIds, `areas.${area.id}.roomIds`, issues);
    for (const reference of area.sourceRecordIds)
      requireReference(reference, sourceIds, `areas.${area.id}.sourceRecordIds`, issues);
    for (const group of area.revealGroups)
      for (const reference of group.tileIds)
        if (!area.tileIds.includes(reference))
          issue(issues, `areas.${area.id}.revealGroups.${group.id}`, `跨区或缺失格 ${reference}`);
    const reachable = new Set([area.entryTileId]);
    const queue = [area.entryTileId];
    for (let index = 0; index < queue.length; index += 1) {
      const current = content.tiles.find((value) => value.id === queue[index]);
      if (!current) continue;
      for (const next of content.tiles)
        if (
          next.boardId === area.id &&
          next.terrain === "floor" &&
          Math.abs(next.x - current.x) + Math.abs(next.y - current.y) === 1 &&
          !reachable.has(next.id)
        ) {
          reachable.add(next.id);
          queue.push(next.id);
        }
    }
    for (const entity of content.entities.filter((value) => area.entityIds.includes(value.id)))
      if (!reachable.has(entity.tileId))
        issue(issues, `entities.${entity.id}`, "连忽略门条件的必要几何路径都不可达");
  }
  const ownersByObjective = new Map<string, Set<string>>();
  const registerEffects = (effectId: string | null, owner: string): void => {
    if (!effectId) return;
    requireReference(effectId, effectIds, owner, issues);
    for (const objective of content.effects.find((value) => value.id === effectId)
      ?.completeObjectiveIds ?? []) {
      const owners = ownersByObjective.get(objective) ?? new Set<string>();
      owners.add(owner);
      ownersByObjective.set(objective, owners);
    }
  };
  for (const entity of content.entities) {
    const path = `entities.${entity.id}`;
    if (!floor(entity.tileId)) issue(issues, path, "实体必须位于已加载地板");
    requireReference(entity.gateId, gateIds, `${path}.gateId`, issues);
    for (const reference of entity.sourceRecordIds)
      requireReference(reference, sourceIds, `${path}.sourceRecordIds`, issues);
    registerEffects(entity.effectBundleId, entity.id);
    if (entity.includedFrom > stage && entity.kind !== "unavailable")
      issue(issues, path, "未来实体仍有可执行内容");
    switch (entity.kind) {
      case "amplifier":
        requireReference(entity.params.completionObjectiveId, objectiveIds, path, issues);
        break;
      case "nexus": {
        requireReference(entity.params.completionObjectiveId, objectiveIds, path, issues);
        for (const reference of entity.params.clearsTileIds)
          if (!floor(reference, content.tiles.find((value) => value.id === entity.tileId)?.boardId))
            issue(issues, path, `清除目标不在本区地板：${reference}`);
        for (const reference of entity.params.revealsGroupIds)
          requireReference(reference, groupIds, path, issues);
        const effect = content.effects.find((value) => value.id === entity.effectBundleId);
        if (
          !effect ||
          !sameIds(effect.clearEtherTileIds, entity.params.clearsTileIds) ||
          !sameIds(effect.revealGroupIds, entity.params.revealsGroupIds) ||
          !effect.completeObjectiveIds.includes(entity.params.completionObjectiveId)
        )
          issue(issues, path, "富集节点参数与效应包不一致");
        break;
      }
      case "terminal":
      case "switch":
      case "observer":
        referencesIncluded(entity.params.prerequisites, path);
        if (entity.params.effectBundleId !== entity.effectBundleId)
          issue(issues, path, "交互参数与实体效应包不一致");
        break;
      case "supply": {
        requireReference(entity.params.rewardId, rewardIds, path, issues);
        const reward = content.rewards.find((value) => value.id === entity.params.rewardId);
        if (reward?.claimMode !== "pickup" || reward.producerId !== entity.id)
          issue(issues, path, "物资格与奖励唯一生产者不一致");
        break;
      }
      case "data": {
        requireReference(entity.params.objectiveId, objectiveIds, path, issues);
        const owners = ownersByObjective.get(entity.params.objectiveId) ?? new Set<string>();
        owners.add(entity.id);
        ownersByObjective.set(entity.params.objectiveId, owners);
        break;
      }
      case "checkpoint":
        if (
          !content.areas.some(
            (area) =>
              area.teleportId === entity.params.teleportId && area.entryTileId === entity.tileId,
          )
        )
          issue(issues, path, "传送检查点与区域入口不一致");
        break;
      case "teleport":
        if (
          !content.areas.some((area) => area.id === entity.params.destinationAreaId) ||
          !floor(entity.params.destinationTileId, entity.params.destinationAreaId)
        )
          issue(issues, path, "传送目的地未加载或不是地板");
        if (entity.params.activationObjectiveId)
          requireReference(entity.params.activationObjectiveId, objectiveIds, path, issues);
        if (
          content.tiles.some(
            (tile) =>
              tile.id === entity.params.destinationTileId &&
              (tile.etherGroupId !== null || tile.hiddenGroupId !== null),
          )
        )
          issue(issues, path, "传送落点不能被以太覆盖或隐藏");
        if (
          content.entities.some(
            (next) =>
              next.tileId === entity.params.destinationTileId &&
              next.kind === "door" &&
              next.gateId !== "always",
          )
        )
          issue(issues, path, "传送落点不能在关闭的条件门内");
        if (
          content.entities.some(
            (next) =>
              next.tileId === entity.params.destinationTileId &&
              next.kind === "roomEntrance" &&
              next.params.interactionMode === "enter",
          )
        )
          issue(issues, path, "传送落点不能自动进入另一个房间");
        if (entity.tileId === entity.params.destinationTileId)
          issue(issues, path, "传送不能落回自身");
        break;
      case "roomEntrance":
        requireReference(entity.params.roomId, roomIds, path, issues);
        break;
      case "challengeAccess":
        for (const reference of entity.params.challengeIds)
          requireReference(reference, roomIds, path, issues);
        break;
      case "unavailable":
        if (entity.effectBundleId !== null || entity.gateId !== "always")
          issue(issues, path, "未收录展示不得有可执行效应或门条件");
        break;
      case "door":
        break;
    }
  }
  for (const effect of content.effects) {
    for (const reference of effect.completeObjectiveIds)
      requireReference(reference, objectiveIds, `effects.${effect.id}`, issues);
    for (const reference of effect.grantRewardIds) {
      requireReference(reference, rewardIds, `effects.${effect.id}`, issues);
      const reward = content.rewards.find((value) => value.id === reference);
      if (reward?.claimMode !== "grant" || !effect.completeObjectiveIds.includes(reward.producerId))
        issue(issues, `effects.${effect.id}`, "pickup 不能自动 grant；grant 须属于本事务目标");
    }
    for (const reference of effect.revealGroupIds)
      requireReference(reference, groupIds, `effects.${effect.id}`, issues);
    for (const reference of effect.clearEtherTileIds)
      requireReference(reference, tileIds, `effects.${effect.id}`, issues);
  }
  for (const room of content.rooms) {
    const path = `rooms.${room.id}`;
    registerEffects(room.effectBundleId, room.id);
    if (
      !floor(room.worldEntranceTileId, room.areaId) ||
      !floor(room.returnTileId, room.areaId) ||
      !floor(room.successExitTileId, room.areaId)
    )
      issue(issues, path, "入口 / 返回 / 成功出口必须是本区安全地板");
    for (const reference of [room.returnTileId, room.successExitTileId]) {
      const anchor = content.tiles.find((value) => value.id === reference);
      if (
        anchor?.etherGroupId ||
        anchor?.hiddenGroupId ||
        content.entities.some(
          (entity) =>
            entity.tileId === reference &&
            (entity.kind === "door" ||
              (entity.kind === "roomEntrance" && entity.params.interactionMode === "enter")),
        )
      )
        issue(issues, path, "恢复锚点不能受覆盖 / 隐藏 / 门阻挡或自动重入");
    }
    if (
      !content.entities.some(
        (entity) =>
          entity.tileId === room.worldEntranceTileId &&
          ((entity.kind === "roomEntrance" && entity.params.roomId === room.id) ||
            (entity.kind === "challengeAccess" && entity.params.challengeIds.includes(room.id))),
      )
    )
      issue(issues, path, "房间没有对应的物理地图入口");
    const definition =
      content.staticChallenges.find((value) => value.id === room.id) ??
      content.realtimeChallenges.find((value) => value.id === room.id);
    if (!definition) {
      issue(issues, path, "房间没有已加载挑战定义");
      continue;
    }
    if (
      room.boardId !== definition.boardId ||
      room.resetState !== definition.id ||
      room.goal !== definition.id
    )
      issue(issues, path, "棋盘 / 重置 / 目标与定义不一致");
    if (
      room.entryTileId !==
      ("startTileId" in definition ? definition.startTileId : definition.entry.tileId)
    )
      issue(issues, path, "内部出生点与固定布局不一致");
    if ("effectBundleId" in definition && definition.effectBundleId !== room.effectBundleId)
      issue(issues, path, "实时定义与房间效应包不一致");
    if ("witnessIds" in definition && !sameIds(room.witnessIds, definition.witnessIds))
      issue(issues, path, "房间见证 ID 与实时定义不一致");
    if ((room.mode === "staticPuzzle") !== "startTileId" in definition)
      issue(issues, path, "房间模式与规则类型不一致");
    requireReference(room.goal, objectiveIds, path, issues);
  }
  for (const definition of content.staticChallenges) {
    issues.push(
      ...validateStaticDefinition(definition).map((message) => ({
        path: `staticChallenges.${definition.id}`,
        message,
      })),
    );
    requireReference(definition.id, roomIds, `staticChallenges.${definition.id}`, issues);
    for (const reference of definition.sourceRecordIds)
      requireReference(
        reference,
        sourceIds,
        `staticChallenges.${definition.id}.sourceRecordIds`,
        issues,
      );
  }
  for (const definition of content.realtimeChallenges) {
    issues.push(
      ...validateRealtimeDefinition(definition).map((value) => ({
        path: `realtimeChallenges.${definition.id}`,
        message: JSON.stringify(value),
      })),
    );
    requireReference(definition.id, roomIds, `realtimeChallenges.${definition.id}`, issues);
    requireReference(
      definition.effectBundleId,
      effectIds,
      `realtimeChallenges.${definition.id}`,
      issues,
    );
  }
  for (const objective of content.objectives) {
    referencesIncluded(objective.prerequisites, `objectives.${objective.id}`);
    const owners = ownersByObjective.get(objective.id) ?? new Set<string>();
    if (objective.kind === "aggregate") {
      if (owners.size > 0)
        issue(issues, `objectives.${objective.id}`, "聚合目标不能同时由实体直接产生");
    } else if (owners.size !== 1 || !owners.has(objective.producer))
      issue(
        issues,
        `objectives.${objective.id}.producer`,
        `声明 ${objective.producer} 与实际生产者 [${[...owners].join(", ")}] 不一致`,
      );
  }
  for (const gate of content.gates) referencesIncluded(gate.condition, `gates.${gate.id}`);
  for (const reward of content.rewards) {
    referencesIncluded(reward.prerequisites, `rewards.${reward.id}`);
    if (
      reward.claimMode === "pickup" &&
      content.entities.filter(
        (entity) => entity.kind === "supply" && entity.params.rewardId === reward.id,
      ).length !== 1
    )
      issue(issues, `rewards.${reward.id}`, "已收录 pickup 没有且仅有一个可领取物资格");
    if (
      reward.claimMode === "grant" &&
      content.effects.filter((effect) => effect.grantRewardIds.includes(reward.id)).length !== 1
    )
      issue(issues, `rewards.${reward.id}`, "grant 没有且仅有一个事务来源");
  }
  for (const tile of content.tiles)
    if (
      tile.etherGroupId &&
      !content.entities.some(
        (entity) => entity.kind === "nexus" && entity.params.clearsTileIds.includes(tile.id),
      )
    )
      issue(issues, `tiles.${tile.id}`, "以太覆盖没有明确可用的清除节点");
  return issues;
}

export function assertContent(value: unknown): asserts value is GameContent {
  const issues = validateContent(value);
  if (issues.length)
    throw new Error(issues.map((value) => `${value.path}: ${value.message}`).join("\n"));
}

export interface WorldWitnessExpectation {
  readonly areaId: string;
  readonly tileId: string;
  readonly mode: string;
  readonly completedObjectiveIds: readonly string[];
  readonly absentObjectiveIds: readonly string[];
  readonly claimedRewardIds: readonly string[];
  readonly supplyUnits: number;
  readonly aData: number;
}
export interface WorldWitnessStep {
  readonly atMs: number;
  readonly command: GameCommand;
  readonly expectedCode: string;
  readonly checkpoint?: { readonly id: string; readonly expected: WorldWitnessExpectation };
}
export interface WorldWitness {
  readonly id: string;
  readonly profileId: ProfileId;
  readonly contentVersion: number;
  readonly ruleVersion: number;
  readonly description: string;
  readonly steps: readonly WorldWitnessStep[];
  readonly expected: WorldWitnessExpectation;
}
export interface WorldWitnessResult {
  readonly state: GameState;
  readonly issues: readonly ContentValidationIssue[];
  readonly commandCount: number;
  readonly pickupEventCount: number;
  readonly checkpoints: Readonly<Record<string, GameState>>;
}

function validateExpectation(value: unknown, path: string, issues: ContentValidationIssue[]): void {
  if (!record(value)) {
    issue(issues, path, "缺少预期状态");
    return;
  }
  keys(
    value,
    [
      "areaId",
      "tileId",
      "mode",
      "completedObjectiveIds",
      "absentObjectiveIds",
      "claimedRewardIds",
      "supplyUnits",
      "aData",
    ],
    path,
    issues,
  );
  if (
    !oneOf(value.areaId, areaIds) ||
    !oneOf(value.mode, [
      "explore",
      "staticPuzzle",
      "completedRoom",
      "challengeReady",
      "challengeRunning",
      "challengeResult",
      "transition",
    ])
  )
    issue(issues, path, "非法预期场景或模式");
  idField(value.tileId, `${path}.tileId`, issues);
  for (const key of ["completedObjectiveIds", "absentObjectiveIds", "claimedRewardIds"])
    ids(value[key], `${path}.${key}`, issues);
  integer(value.supplyUnits, `${path}.supplyUnits`, issues, 0, 130);
  integer(value.aData, `${path}.aData`, issues, 0, 100);
}

/** Witnesses are data: no code, synthetic positions, or progress setters are accepted. */
export function validateWorldWitness(raw: unknown): ContentValidationIssue[] {
  const issues: ContentValidationIssue[] = [];
  if (!record(raw)) return [{ path: "worldWitness", message: "见证必须是对象" }];
  keys(
    raw,
    ["id", "profileId", "contentVersion", "ruleVersion", "description", "steps", "expected"],
    "worldWitness",
    issues,
  );
  idField(raw.id, "worldWitness.id", issues);
  textField(raw.description, "worldWitness.description", issues);
  if (!oneOf(raw.profileId, profiles)) issue(issues, "worldWitness.profileId", "未知 profile");
  integer(raw.contentVersion, "worldWitness.contentVersion", issues);
  integer(raw.ruleVersion, "worldWitness.ruleVersion", issues);
  validateExpectation(raw.expected, "worldWitness.expected", issues);
  if (!Array.isArray(raw.steps) || raw.steps.length === 0 || raw.steps.length > 20000)
    return [...issues, { path: "worldWitness.steps", message: "见证须有 1–20000 条公开命令" }];
  let previousTime = 0;
  const checkpoints = new Set<string>();
  for (const [index, step] of raw.steps.entries()) {
    const path = `worldWitness.steps[${index}]`;
    if (!record(step)) {
      issue(issues, path, "步骤必须是对象");
      continue;
    }
    keys(
      step,
      Object.hasOwn(step, "checkpoint")
        ? ["atMs", "command", "expectedCode", "checkpoint"]
        : ["atMs", "command", "expectedCode"],
      path,
      issues,
    );
    integer(step.atMs, `${path}.atMs`, issues, 0);
    if (typeof step.atMs === "number") {
      if (step.atMs < previousTime) issue(issues, path, "单调时间倒退");
      previousTime = step.atMs;
    }
    textField(step.expectedCode, `${path}.expectedCode`, issues);
    const command = step.command;
    if (!record(command)) issue(issues, `${path}.command`, "命令必须是对象");
    else {
      switch (command.kind) {
        case "Move":
          keys(command, ["kind", "direction"], path, issues);
          if (!oneOf(command.direction, ["up", "right", "down", "left"]))
            issue(issues, path, "方向非法");
          break;
        case "ClickTile":
          keys(command, ["kind", "tileId"], path, issues);
          idField(command.tileId, path, issues);
          break;
        case "StartChallenge":
          keys(command, ["kind", "challengeId"], path, issues);
          idField(command.challengeId, path, issues);
          break;
        case "Teleport":
          keys(command, ["kind", "teleportId"], path, issues);
          idField(command.teleportId, path, issues);
          break;
        case "Interact":
        case "Amplify":
        case "Undo":
        case "ResetRoom":
        case "RetryChallenge":
        case "PracticeRoom":
        case "ExitRoom":
        case "Tick":
          keys(command, ["kind"], path, issues);
          break;
        case "Pause":
          keys(command, ["kind", "reason", "present"], path, issues);
          if (
            !oneOf(command.reason, ["manual", "hidden", "blur", "clockGap", "graphicsLost"]) ||
            typeof command.present !== "boolean"
          )
            issue(issues, path, "暂停命令参数错误");
          break;
        case "Resume":
          keys(
            command,
            ["kind", "pageVisible", "canvasOperable", "graphicsAvailable"],
            path,
            issues,
          );
          if (
            [command.pageVisible, command.canvasOperable, command.graphicsAvailable].some(
              (value) => typeof value !== "boolean",
            )
          )
            issue(issues, path, "恢复条件必须是布尔值");
          break;
        default:
          issue(issues, path, "未知见证命令；禁止设置目标、位置、分数或门");
      }
    }
    if (Object.hasOwn(step, "checkpoint")) {
      if (!record(step.checkpoint)) issue(issues, path, "检查点必须是对象");
      else {
        keys(step.checkpoint, ["id", "expected"], `${path}.checkpoint`, issues);
        idField(step.checkpoint.id, `${path}.checkpoint.id`, issues);
        if (typeof step.checkpoint.id === "string") {
          if (checkpoints.has(step.checkpoint.id)) issue(issues, path, "重复检查点");
          checkpoints.add(step.checkpoint.id);
        }
        validateExpectation(step.checkpoint.expected, `${path}.checkpoint.expected`, issues);
      }
    }
  }
  return issues;
}

function checkExpectation(
  content: GameContent,
  state: GameState,
  expected: WorldWitnessExpectation,
  path: string,
  issues: ContentValidationIssue[],
): void {
  if (
    state.playerPosition.areaId !== expected.areaId ||
    state.playerPosition.tileId !== expected.tileId ||
    state.mode !== expected.mode
  )
    issue(issues, path, "场景 / 玩家格 / 模式与见证不符");
  for (const id of expected.completedObjectiveIds)
    if (!state.completedObjectiveIds.includes(id)) issue(issues, path, `应完成目标 ${id}`);
  for (const id of expected.absentObjectiveIds)
    if (state.completedObjectiveIds.includes(id)) issue(issues, path, `不应完成目标 ${id}`);
  if (!sameIds(state.claimedRewardIds, expected.claimedRewardIds))
    issue(issues, path, "已领取奖励集合不一致");
  if (supplyProgress(content, state).collected !== expected.supplyUnits)
    issue(issues, path, "物资总量不一致");
  if (areaData(content, state, "a").collected !== expected.aData)
    issue(issues, path, "A 区数据量不一致");
  if (
    !content.profile.fullCampaign &&
    (state.campaignCompletedAt !== null ||
      state.completedObjectiveIds.includes("warehouse.complete"))
  )
    issue(issues, path, "阶段版本不能宣称完整版通关");
}

/** Replays only public commands and monotonic timestamps from a fresh game. */
export function replayWorldWitness(
  content: GameContent,
  witness: WorldWitness,
): WorldWitnessResult {
  const issues = validateWorldWitness(witness);
  let state = createGame(content, 0);
  let pickupEventCount = 0;
  let previousTime = 0;
  let commandCount = 0;
  const checkpoints: Record<string, GameState> = {};
  if (issues.length) return { state, issues, commandCount, pickupEventCount, checkpoints };
  if (
    witness.profileId !== content.profile.id ||
    witness.contentVersion !== content.contentVersion ||
    witness.ruleVersion !== content.ruleVersion
  )
    issue(issues, witness.id, "见证版本或 profile 不一致");
  for (const [index, step] of witness.steps.entries()) {
    if (!Number.isFinite(step.atMs) || step.atMs < previousTime) {
      issue(issues, `${witness.id}[${index}]`, "命令时间无效或倒退");
      break;
    }
    const result = dispatch(content, state, step.command, step.atMs);
    commandCount += 1;
    if (result.state.stateRevision !== state.stateRevision + (result.stable ? 1 : 0))
      issue(issues, `${witness.id}[${index}]`, "稳定事务的权威修订号不一致");
    state = result.state;
    previousTime = step.atMs;
    pickupEventCount += result.events.filter((event) => event.kind === "pickup").length;
    if (result.code !== step.expectedCode) {
      issue(
        issues,
        `${witness.id}[${index}]`,
        `命令 ${step.command.kind}: 预期 ${step.expectedCode}，实际 ${result.code}：${state.lastResult.message}`,
      );
      break;
    }
    if (step.checkpoint) {
      checkExpectation(
        content,
        state,
        step.checkpoint.expected,
        `${witness.id}.${step.checkpoint.id}`,
        issues,
      );
      checkpoints[step.checkpoint.id] = structuredClone(state);
    }
  }
  checkExpectation(content, state, witness.expected, `${witness.id}.final`, issues);
  return { state, issues, commandCount, pickupEventCount, checkpoints };
}
