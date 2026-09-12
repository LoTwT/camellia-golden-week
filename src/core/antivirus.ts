import type {
  AntivirusState,
  AntivirusTargetKind,
  RealtimeFeedback,
  RealtimeInput,
  RealtimeTile,
} from "./realtime.ts";

export const ANTIVIRUS_R1_DECISION = "R1-B-ACCUMULATION-01";

export const ANTIVIRUS_R1_PROFILES = {
  light: { durationMs: 32_000, spawnIntervalMs: 1100, targetScore: 24 },
  medium: { durationMs: 40_000, spawnIntervalMs: 850, targetScore: 40 },
  heavy: { durationMs: 48_000, spawnIntervalMs: 650, targetScore: 60 },
} as const;

export interface R1AntivirusSpawn {
  readonly id: string;
  readonly tileId: string;
  readonly kind: AntivirusTargetKind;
  readonly spawnAtMs: number;
}

export interface R1AntivirusDefinition {
  readonly id: string;
  readonly boardId: string;
  readonly kind: "antivirus";
  readonly ruleVersion: 4;
  readonly tiles: readonly RealtimeTile[];
  readonly entry: { readonly tileId: string };
  readonly effectBundleId: string;
  readonly witnessIds: readonly string[];
  readonly goal: { readonly kind: "score" };
  readonly rules: {
    readonly adaptationDecisionId: typeof ANTIVIRUS_R1_DECISION;
    readonly durationMs: number;
    readonly completionRules: {
      readonly kind: "scoreReachedBeforeDeadline";
      readonly targetScore: number;
    };
    readonly maxActiveCorruption: 9;
    readonly countedTargetKinds: readonly ["blue", "purple"];
    readonly overflowResolution: "immediateFailureBeforeInput";
    readonly occupiedSpawnPolicy: "nextFreeRowMajorOrFailure";
    readonly eventOrder: readonly [
      "deadline",
      "spawnBatch",
      "overflow",
      "inputSequence",
      "completion",
    ];
    readonly targetRules: {
      readonly blue: { readonly lifetime: "untilCleared"; readonly score: 1 };
      readonly purple: { readonly lifetime: "untilCleared"; readonly score: 2 };
      readonly star: {
        readonly lifetime: "untilCleared";
        readonly score: 0;
        readonly clear: "allCorruptionWithoutStarChain";
      };
    };
    readonly spawnPlan: readonly R1AntivirusSpawn[];
  };
}

export interface R1AntivirusState extends AntivirusState {
  readonly ruleVersion: 4;
  /** The runtime tile may differ from the scheduled candidate after an occupied spawn. */
  readonly activeTargets: readonly R1AntivirusSpawn[];
  readonly failureReason: "overflow" | "deadline" | "boardFull" | null;
}

export interface R1AntivirusAdvance {
  readonly state: R1AntivirusState;
  readonly result: R1AntivirusState["status"];
  readonly feedback: readonly RealtimeFeedback[];
}

type Mutable<T> = { -readonly [Key in keyof T]: T[Key] };

export function createR1Antivirus(definition: R1AntivirusDefinition): R1AntivirusState {
  return {
    kind: "antivirus",
    ruleVersion: 4,
    challengeId: definition.id,
    activeTimeMs: 0,
    playerTileId: definition.entry.tileId,
    status: "running",
    eventSequence: 0,
    lastInputSequence: -1,
    score: 0,
    activeTargets: [],
    activeTargetIds: [],
    clearedTargetIds: [],
    expiredTargetIds: [],
    nextSpawnIndex: 0,
    bestStarClearCount: 0,
    lastStarClearCount: 0,
    failureReason: null,
  };
}

export function antivirusCorruptionCount(state: R1AntivirusState): number {
  return state.activeTargets.filter((target) => target.kind !== "star").length;
}

export function advanceR1Antivirus(
  definition: R1AntivirusDefinition,
  previous: R1AntivirusState,
  activeTimeMs: number,
  input?: RealtimeInput | readonly RealtimeInput[],
): R1AntivirusAdvance {
  if (definition.id !== previous.challengeId || previous.ruleVersion !== 4)
    throw new TypeError("R1 杀毒状态与挑战定义不匹配。");
  if (
    previous.status !== "running" ||
    !Number.isFinite(activeTimeMs) ||
    activeTimeMs < previous.activeTimeMs
  )
    return { state: previous, result: previous.status, feedback: [] };

  const state: Mutable<R1AntivirusState> = { ...previous };
  const feedback: RealtimeFeedback[] = [];
  const { rules } = definition;
  const tiles = definition.tiles.toSorted((a, b) => a.y - b.y || a.x - b.x);
  const emit = (
    kind: RealtimeFeedback["kind"],
    atMs: number,
    details: Partial<RealtimeFeedback> = {},
  ) => {
    state.eventSequence += 1;
    feedback.push({
      ...details,
      id: `${definition.id}:${state.eventSequence}`,
      sequence: state.eventSequence,
      kind,
      activeTimeMs: atMs,
    });
  };
  const fail = (reason: NonNullable<R1AntivirusState["failureReason"]>, atMs: number) => {
    state.status = "failure";
    state.failureReason = reason;
    state.activeTimeMs = atMs;
    emit("failure", atMs, { reason, value: state.score });
  };
  const advanceSchedule = (untilMs: number) => {
    while (state.status === "running") {
      const next = rules.spawnPlan[state.nextSpawnIndex];
      if (!next || next.spawnAtMs > untilMs || next.spawnAtMs >= rules.durationMs) break;
      const batchTime = next.spawnAtMs;
      const batch: R1AntivirusSpawn[] = [];
      while (rules.spawnPlan[state.nextSpawnIndex]?.spawnAtMs === batchTime)
        batch.push(rules.spawnPlan[state.nextSpawnIndex++]!);
      batch.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      for (const candidate of batch) {
        const start = tiles.findIndex((tile) => tile.id === candidate.tileId);
        const occupied = new Set(state.activeTargets.map((target) => target.tileId));
        let destination: RealtimeTile | undefined;
        for (let offset = 0; offset < tiles.length; offset += 1) {
          const tile = tiles[(start + offset) % tiles.length];
          if (tile && !occupied.has(tile.id)) {
            destination = tile;
            break;
          }
        }
        if (!destination) {
          fail("boardFull", batchTime);
          return;
        }
        const target = { ...candidate, tileId: destination.id };
        state.activeTargets = [...state.activeTargets, target];
        state.activeTargetIds = state.activeTargets.map((active) => active.id);
        emit("targetSpawned", batchTime, { targetId: target.id, tileId: target.tileId });
      }
      if (antivirusCorruptionCount(state) > rules.maxActiveCorruption) {
        fail("overflow", batchTime);
        return;
      }
    }
    if (state.status === "running" && untilMs >= rules.durationMs)
      fail("deadline", rules.durationMs);
  };
  const clear = (target: R1AntivirusSpawn, atMs: number) => {
    const cleared =
      target.kind === "star"
        ? [target, ...state.activeTargets.filter((active) => active.kind !== "star")]
        : [target];
    const ids = new Set(cleared.map((active) => active.id));
    state.activeTargets = state.activeTargets.filter((active) => !ids.has(active.id));
    state.activeTargetIds = state.activeTargets.map((active) => active.id);
    state.clearedTargetIds = [...state.clearedTargetIds, ...ids];
    for (const active of cleared) {
      const value = rules.targetRules[active.kind].score;
      state.score += value;
      emit("targetCleared", atMs, { targetId: active.id, tileId: active.tileId, value });
    }
    if (target.kind === "star") {
      state.lastStarClearCount = cleared.length - 1;
      state.bestStarClearCount = Math.max(state.bestStarClearCount, state.lastStarClearCount);
      emit("starCleared", atMs, { targetId: target.id, value: state.lastStarClearCount });
    }
    if (state.score >= rules.completionRules.targetScore) {
      state.status = "success";
      state.activeTimeMs = atMs;
      emit("success", atMs, { value: state.score });
    }
  };
  const inputs: readonly RealtimeInput[] =
    input === undefined ? [] : Array.isArray(input) ? input : [input as RealtimeInput];
  const sorted = inputs
    .filter(
      (command) =>
        Number.isSafeInteger(command.sequence) &&
        command.sequence >= 0 &&
        command.sequence > previous.lastInputSequence &&
        Number.isFinite(command.activeTimeMs) &&
        command.activeTimeMs >= previous.activeTimeMs &&
        command.activeTimeMs <= activeTimeMs,
    )
    .toSorted((a, b) => a.activeTimeMs - b.activeTimeMs || a.sequence - b.sequence);
  for (const command of sorted) {
    if (state.status !== "running") break;
    if (command.sequence <= state.lastInputSequence) continue;
    advanceSchedule(command.activeTimeMs);
    if (state.status !== "running") break;
    state.lastInputSequence = command.sequence;
    if (
      command.kind === "click" &&
      command.targetId !== undefined &&
      !state.activeTargets.some(
        (target) => target.id === command.targetId && target.tileId === command.tileId,
      )
    ) {
      emit("invalidInput", command.activeTimeMs, { reason: "目标已经消失或位置不匹配。" });
      continue;
    }
    let destination = state.playerTileId;
    if (command.kind === "click") destination = command.tileId;
    if (command.kind === "move") {
      const origin = tiles.find((tile) => tile.id === state.playerTileId)!;
      const delta = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] }[command.direction]!;
      destination =
        tiles.find((tile) => tile.x === origin.x + delta[0]! && tile.y === origin.y + delta[1]!)
          ?.id ?? "";
    }
    if (!tiles.some((tile) => tile.id === destination)) {
      emit("blocked", command.activeTimeMs, { reason: "请选择棋盘内的格子。" });
      continue;
    }
    if (destination !== state.playerTileId) {
      state.playerTileId = destination;
      emit("move", command.activeTimeMs, { tileId: destination });
    }
    const target = state.activeTargets.find((active) => active.tileId === destination);
    if (target) clear(target, command.activeTimeMs);
  }
  if (state.status === "running") advanceSchedule(activeTimeMs);
  if (state.status === "running") state.activeTimeMs = activeTimeMs;
  return { state, result: state.status, feedback };
}

export interface AntivirusValidationIssue {
  readonly path: string;
  readonly message: string;
}

export function validateR1Antivirus(value: unknown): readonly AntivirusValidationIssue[] {
  const issues: AntivirusValidationIssue[] = [];
  const report = (path: string, message: string) => {
    issues.push({ path, message });
  };
  const record = (candidate: unknown): candidate is Record<string, unknown> =>
    candidate !== null && typeof candidate === "object" && !Array.isArray(candidate);
  const finite = (candidate: unknown): candidate is number =>
    typeof candidate === "number" && Number.isFinite(candidate);
  if (!record(value)) return [{ path: "definition", message: "杀毒定义必须为对象。" }];
  if (value.kind !== "antivirus" || value.ruleVersion !== 4)
    report("ruleVersion", "R1 杀毒必须为 ruleVersion 4。");
  const tiles = Array.isArray(value.tiles) ? value.tiles.filter(record) : [];
  const ids = new Set(tiles.map((tile) => tile.id));
  if (
    tiles.length !== 20 ||
    ids.size !== 20 ||
    !tiles.every(
      (tile) =>
        typeof tile.id === "string" &&
        Number.isInteger(tile.x) &&
        Number.isInteger(tile.y) &&
        Number(tile.x) >= 0 &&
        Number(tile.x) < 5 &&
        Number(tile.y) >= 0 &&
        Number(tile.y) < 4,
    ) ||
    new Set(tiles.map((tile) => `${tile.x},${tile.y}`)).size !== 20
  )
    report("tiles", "R1 杀毒必须为完整 5×4 棋盘且 ID / 坐标唯一。");
  if (!record(value.entry) || !ids.has(value.entry.tileId))
    report("entry", "入口必须引用中央棋盘。");
  if (!record(value.rules)) return [...issues, { path: "rules", message: "缺少 R1 杀毒规则。" }];
  const rules = value.rules;
  if (
    rules.adaptationDecisionId !== ANTIVIRUS_R1_DECISION ||
    rules.maxActiveCorruption !== 9 ||
    rules.overflowResolution !== "immediateFailureBeforeInput" ||
    rules.occupiedSpawnPolicy !== "nextFreeRowMajorOrFailure" ||
    JSON.stringify(rules.countedTargetKinds) !== '["blue","purple"]' ||
    JSON.stringify(rules.eventOrder) !==
      '["deadline","spawnBatch","overflow","inputSequence","completion"]'
  )
    report("rules", "缺失具名适配或数量 / 占格 / 同刻规则不匹配。");
  const completion = record(rules.completionRules) ? rules.completionRules : {};
  if (
    completion.kind !== "scoreReachedBeforeDeadline" ||
    !Number.isSafeInteger(completion.targetScore) ||
    Number(completion.targetScore) <= 0
  )
    report("rules.completionRules", "成功门槛必须为正整数并在截止前立即结算。");
  const targets = record(rules.targetRules) ? rules.targetRules : {};
  for (const [kind, score] of [
    ["blue", 1],
    ["purple", 2],
    ["star", 0],
  ] as const) {
    const rule = targets[kind];
    if (
      !record(rule) ||
      rule.lifetime !== "untilCleared" ||
      rule.score !== score ||
      (kind === "star" && rule.clear !== "allCorruptionWithoutStarChain")
    )
      report(`rules.targetRules.${kind}`, "目标必须持续存在，且分值 / 星清除符合冻结规则。");
  }
  if (!finite(rules.durationMs) || rules.durationMs <= 0)
    report("rules.durationMs", "截止时间必须为正有限数。");
  const plan = Array.isArray(rules.spawnPlan) ? rules.spawnPlan : [];
  if (!plan.length || plan.length > 500)
    report("rules.spawnPlan", "固定排表必须包含 1 至 500 个实例。");
  const seen = new Set<string>();
  let lastTime = -Infinity;
  let availableScore = 0;
  let corruption = 0;
  for (const [index, spawn] of plan.entries()) {
    const path = `rules.spawnPlan[${index}]`;
    if (!record(spawn)) {
      report(path, "生成实例必须为对象。");
      continue;
    }
    if (typeof spawn.id !== "string" || !spawn.id || seen.has(spawn.id))
      report(`${path}.id`, "实例 ID 必须唯一且非空。");
    if (typeof spawn.id === "string") seen.add(spawn.id);
    if (!ids.has(spawn.tileId)) report(`${path}.tileId`, "候选位置必须引用棋盘。");
    if (
      !finite(spawn.spawnAtMs) ||
      spawn.spawnAtMs < 150 ||
      spawn.spawnAtMs - lastTime < 150 ||
      (finite(rules.durationMs) && spawn.spawnAtMs > rules.durationMs - 150)
    )
      report(`${path}.spawnAtMs`, "排期必须递增并保留至少 150ms 反应时间。");
    if (finite(spawn.spawnAtMs)) lastTime = spawn.spawnAtMs;
    if (!["blue", "purple", "star"].includes(String(spawn.kind)))
      report(`${path}.kind`, "未知目标种类。");
    if ("expiresAtMs" in spawn) report(`${path}.expiresAtMs`, "R1 持续目标不能设置 TTL。");
    if (spawn.kind === "blue" || spawn.kind === "purple") {
      availableScore += spawn.kind === "purple" ? 2 : 1;
      corruption += 1;
    }
  }
  if (availableScore < Number(completion.targetScore))
    report("rules.completionRules.targetScore", "排表总分不能达到门槛。");
  if (corruption <= 9) report("rules.spawnPlan", "不输入必须产生超过 9 个蓝紫的真实数量压力。");
  const tier = String(value.id).replace("b.antivirus.", "") as keyof typeof ANTIVIRUS_R1_PROFILES;
  const profile = ANTIVIRUS_R1_PROFILES[tier];
  if (profile) {
    if (rules.durationMs !== profile.durationMs || completion.targetScore !== profile.targetScore)
      report("rules", "正式档位的时长与门槛不符合具名冻结配置。");
    if (!record(value.entry) || value.entry.tileId !== `${value.id}.tile.2.0`)
      report("entry", "正式档位从 (2,0) 开始。");
    const expectedCount =
      Math.floor((profile.durationMs - 150 - 1000) / profile.spawnIntervalMs) + 1;
    if (plan.length !== expectedCount) report("rules.spawnPlan", "正式档位的固定排表长度不符。");
    for (const [index, spawn] of plan.entries()) {
      const row = Math.floor((index % 20) / 5);
      const column = row % 2 === 0 ? index % 5 : 4 - (index % 5);
      const kind = (index + 1) % 8 === 0 ? "star" : (index + 1) % 4 === 0 ? "purple" : "blue";
      if (
        !record(spawn) ||
        spawn.spawnAtMs !== 1000 + index * profile.spawnIntervalMs ||
        spawn.kind !== kind ||
        spawn.tileId !== `${value.id}.tile.${column}.${row}` ||
        spawn.id !== `${value.id}.r1.target.${String(index).padStart(3, "0")}`
      )
        report(`rules.spawnPlan[${index}]`, "正式档位必须使用冻结的实例、蛇形候选格、类型和时序。");
    }
  }
  return issues;
}
