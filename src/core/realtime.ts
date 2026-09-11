export type RealtimeDirection = "up" | "right" | "down" | "left";
export type RealtimeResult = "running" | "success" | "failure";

export interface RealtimeTile {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

interface RealtimeDefinitionBase {
  readonly id: string;
  readonly boardId: string;
  readonly tiles: readonly RealtimeTile[];
  readonly entry: { readonly tileId: string };
  readonly effectBundleId: string;
  readonly ruleVersion: number;
  readonly witnessIds: readonly string[];
}

export interface FirewallDefinition extends RealtimeDefinitionBase {
  readonly kind: "firewall";
  readonly rules: {
    readonly durationMs: number;
    readonly bpm: number;
    readonly firstBeatMs: number;
    readonly windowMs: number;
    readonly comboTarget: number;
    readonly offbeatPenalty: number;
    readonly beatMasks: readonly (readonly string[])[];
  };
  readonly goal: { readonly kind: "highestCombo" };
}

export type AntivirusTargetKind = "blue" | "purple" | "star";

export interface AntivirusSpawn {
  readonly id: string;
  readonly tileId: string;
  readonly kind: AntivirusTargetKind;
  readonly spawnAtMs: number;
  readonly expiresAtMs: number;
}

export interface AntivirusDefinition extends RealtimeDefinitionBase {
  readonly kind: "antivirus";
  readonly rules: {
    readonly durationMs: number;
    readonly targetScore: number;
    readonly spawns: readonly AntivirusSpawn[];
  };
  readonly goal: { readonly kind: "score" };
}

export interface GhostDefinition {
  readonly id: string;
  readonly path: readonly string[];
  readonly stepMs: number;
  readonly initialIndex: number;
}

export interface GhostLamp {
  readonly id: string;
  readonly tileId: string;
  readonly ghostIds: readonly string[];
}

export interface GhostsDefinition extends RealtimeDefinitionBase {
  readonly kind: "ghosts";
  readonly rules: {
    readonly ghosts: readonly GhostDefinition[];
    readonly lamps: readonly GhostLamp[];
    readonly playerStepMinMs: number;
    readonly exitTileId: string;
  };
  readonly goal: { readonly kind: "exit" };
}

export type RealtimeDefinition = FirewallDefinition | AntivirusDefinition | GhostsDefinition;

interface RealtimeInputBase {
  readonly sequence: number;
  readonly activeTimeMs: number;
}

export type RealtimeInput =
  | (RealtimeInputBase & {
      readonly kind: "move";
      readonly direction: RealtimeDirection;
      readonly repeat?: boolean;
    })
  | (RealtimeInputBase & {
      readonly kind: "click";
      readonly tileId: string;
      readonly targetId?: string;
    })
  | (RealtimeInputBase & { readonly kind: "interact" });

interface RealtimeStateBase {
  readonly challengeId: string;
  readonly activeTimeMs: number;
  readonly playerTileId: string;
  readonly status: RealtimeResult;
  readonly eventSequence: number;
  readonly lastInputSequence: number;
}

export interface FirewallState extends RealtimeStateBase {
  readonly kind: "firewall";
  readonly combo: number;
  readonly bestCombo: number;
  readonly scoredBeatIndices: readonly number[];
  readonly nextBeatIndex: number;
  readonly maskIndex: number;
}

export interface AntivirusState extends RealtimeStateBase {
  readonly kind: "antivirus";
  readonly score: number;
  readonly activeTargetIds: readonly string[];
  readonly clearedTargetIds: readonly string[];
  readonly expiredTargetIds: readonly string[];
  readonly nextSpawnIndex: number;
  readonly bestStarClearCount: number;
  readonly lastStarClearCount: number;
}

export interface GhostsState extends RealtimeStateBase {
  readonly kind: "ghosts";
  readonly ghostPathIndices: Readonly<Record<string, number>>;
  readonly nextGhostStepAtMs: Readonly<Record<string, number>>;
  readonly removedGhostIds: readonly string[];
  readonly litLampIds: readonly string[];
  readonly lastPlayerMoveAtMs: number | null;
  readonly lastPlayerInputAtMs: number | null;
}

export type RealtimeState = FirewallState | AntivirusState | GhostsState;

export type RealtimeFeedbackKind =
  | "move"
  | "blocked"
  | "invalidInput"
  | "beat"
  | "hit"
  | "miss"
  | "targetSpawned"
  | "targetExpired"
  | "targetCleared"
  | "starCleared"
  | "ghostStep"
  | "lampLit"
  | "collision"
  | "success"
  | "failure";

export interface RealtimeFeedback {
  readonly id: string;
  readonly sequence: number;
  readonly kind: RealtimeFeedbackKind;
  readonly activeTimeMs: number;
  readonly tileId?: string;
  readonly targetId?: string;
  readonly ghostIds?: readonly string[];
  readonly value?: number;
  readonly reason?: string;
}

export interface RealtimeAdvance {
  readonly state: RealtimeState;
  readonly result: RealtimeResult;
  readonly feedback: readonly RealtimeFeedback[];
}

export interface RealtimeWitness {
  readonly id: string;
  readonly challengeId: string;
  readonly profileId: string;
  readonly contentVersion: number;
  readonly ruleVersion: number;
  readonly initialStateId: string;
  readonly commands: readonly RealtimeInput[];
  readonly finishAtMs: number;
  readonly expectedResult: "success" | "failure";
  readonly expectedObjectives: readonly string[];
  readonly expectedRewards: readonly string[];
  readonly expectedFinalState: {
    readonly playerTileId: string;
    readonly bestCombo?: number;
    readonly score?: number;
    readonly litLampIds?: readonly string[];
  };
}

type Mutable<T> = { -readonly [Key in keyof T]: T[Key] };
type FeedbackDetails = Omit<RealtimeFeedback, "id" | "sequence" | "kind" | "activeTimeMs">;
type EmitFeedback = (kind: RealtimeFeedbackKind, timeMs: number, details?: FeedbackDetails) => void;

const DIRECTION_VECTORS: Readonly<Record<RealtimeDirection, readonly [number, number]>> = {
  up: [0, -1],
  right: [1, 0],
  down: [0, 1],
  left: [-1, 0],
};

export function createRealtime(definition: FirewallDefinition): FirewallState;
export function createRealtime(definition: AntivirusDefinition): AntivirusState;
export function createRealtime(definition: GhostsDefinition): GhostsState;
export function createRealtime(definition: RealtimeDefinition): RealtimeState;
export function createRealtime(definition: RealtimeDefinition): RealtimeState {
  const base: RealtimeStateBase = {
    challengeId: definition.id,
    activeTimeMs: 0,
    playerTileId: definition.entry.tileId,
    status: "running",
    eventSequence: 0,
    lastInputSequence: -1,
  };
  switch (definition.kind) {
    case "firewall":
      return {
        ...base,
        kind: "firewall",
        combo: 0,
        bestCombo: 0,
        scoredBeatIndices: [],
        nextBeatIndex: 0,
        maskIndex: 0,
      };
    case "antivirus":
      return {
        ...base,
        kind: "antivirus",
        score: 0,
        activeTargetIds: [],
        clearedTargetIds: [],
        expiredTargetIds: [],
        nextSpawnIndex: 0,
        bestStarClearCount: 0,
        lastStarClearCount: 0,
      };
    case "ghosts":
      return {
        ...base,
        kind: "ghosts",
        ghostPathIndices: Object.fromEntries(
          definition.rules.ghosts.map((ghost) => [ghost.id, ghost.initialIndex]),
        ),
        nextGhostStepAtMs: Object.fromEntries(
          definition.rules.ghosts.map((ghost) => [ghost.id, ghost.stepMs]),
        ),
        removedGhostIds: [],
        litLampIds: [],
        lastPlayerMoveAtMs: null,
        lastPlayerInputAtMs: null,
      };
  }
}

function inputDestination(
  definition: RealtimeDefinition,
  playerTileId: string,
  input: RealtimeInput,
  adjacentOnly: boolean,
): string | null {
  const from = definition.tiles.find((tile) => tile.id === playerTileId);
  if (!from || input.kind === "interact") return null;
  if (input.kind === "click") {
    const target = definition.tiles.find((tile) => tile.id === input.tileId);
    if (
      !target ||
      (adjacentOnly && Math.abs(target.x - from.x) + Math.abs(target.y - from.y) !== 1)
    )
      return null;
    return target.id;
  }
  const vector = DIRECTION_VECTORS[input.direction];
  if (!vector) return null;
  return (
    definition.tiles.find((tile) => tile.x === from.x + vector[0] && tile.y === from.y + vector[1])
      ?.id ?? null
  );
}

function sortedInputs(
  state: RealtimeState,
  activeTimeMs: number,
  input: RealtimeInput | readonly RealtimeInput[] | undefined,
): readonly RealtimeInput[] {
  const inputs: readonly RealtimeInput[] =
    input === undefined ? [] : Array.isArray(input) ? input : [input as RealtimeInput];
  return inputs
    .filter(
      (command) =>
        Number.isSafeInteger(command.sequence) &&
        command.sequence >= 0 &&
        command.sequence > state.lastInputSequence &&
        Number.isFinite(command.activeTimeMs) &&
        command.activeTimeMs >= state.activeTimeMs &&
        command.activeTimeMs <= activeTimeMs,
    )
    .toSorted(
      (left, right) => left.activeTimeMs - right.activeTimeMs || left.sequence - right.sequence,
    );
}

export function advanceRealtime(
  definition: RealtimeDefinition,
  previous: RealtimeState,
  activeTimeMs: number,
  input?: RealtimeInput | readonly RealtimeInput[],
): RealtimeAdvance {
  if (definition.id !== previous.challengeId || definition.kind !== previous.kind) {
    throw new TypeError("实时状态与挑战定义不匹配。");
  }
  if (
    previous.status !== "running" ||
    !Number.isFinite(activeTimeMs) ||
    activeTimeMs < previous.activeTimeMs
  ) {
    return { state: previous, result: previous.status, feedback: [] };
  }
  const feedback: RealtimeFeedback[] = [];
  let eventSequence = previous.eventSequence;
  const emit: EmitFeedback = (kind, timeMs, details = {}) => {
    eventSequence += 1;
    feedback.push({
      id: `${definition.id}:${eventSequence}`,
      sequence: eventSequence,
      kind,
      activeTimeMs: timeMs,
      ...details,
    });
  };
  const inputs = sortedInputs(previous, activeTimeMs, input);
  let state: RealtimeState;
  if (definition.kind === "firewall" && previous.kind === "firewall") {
    state = advanceFirewall(definition, previous, activeTimeMs, inputs, emit);
  } else if (definition.kind === "antivirus" && previous.kind === "antivirus") {
    state = advanceAntivirus(definition, previous, activeTimeMs, inputs, emit);
  } else if (definition.kind === "ghosts" && previous.kind === "ghosts") {
    state = advanceGhosts(definition, previous, activeTimeMs, inputs, emit);
  } else {
    throw new TypeError("未知实时状态。");
  }
  return { state: { ...state, eventSequence }, result: state.status, feedback };
}

export function firewallDangerTileIds(
  definition: FirewallDefinition,
  activeTimeMs: number,
): readonly string[] {
  const intervalMs = 60_000 / definition.rules.bpm;
  const firstMaskMs = definition.rules.firstBeatMs - intervalMs / 2;
  const index = Math.floor((activeTimeMs - firstMaskMs) / intervalMs);
  return definition.rules.beatMasks[index] ?? [];
}

function advanceFirewall(
  definition: FirewallDefinition,
  previous: FirewallState,
  activeTimeMs: number,
  inputs: readonly RealtimeInput[],
  emit: EmitFeedback,
): FirewallState {
  const state: Mutable<FirewallState> = { ...previous };
  const rules = definition.rules;
  const intervalMs = 60_000 / rules.bpm;
  const advanceBeats = (timeMs: number) => {
    while (state.nextBeatIndex < rules.beatMasks.length) {
      const beatMs = rules.firstBeatMs + state.nextBeatIndex * intervalMs;
      if (beatMs > timeMs || beatMs >= rules.durationMs) break;
      emit("beat", beatMs, { value: state.nextBeatIndex });
      state.nextBeatIndex += 1;
    }
  };
  for (const command of inputs) {
    if (command.sequence <= state.lastInputSequence) continue;
    state.lastInputSequence = command.sequence;
    advanceBeats(Math.min(command.activeTimeMs, rules.durationMs));
    if (command.activeTimeMs >= rules.durationMs) break;
    if (command.kind === "interact" || (command.kind === "move" && command.repeat)) {
      emit("invalidInput", command.activeTimeMs, {
        reason: "防火墙每次物理按下只移动一次，交互键无效。",
      });
      continue;
    }
    const destination = inputDestination(definition, state.playerTileId, command, false);
    if (destination === null || destination === state.playerTileId) {
      emit("blocked", command.activeTimeMs, { reason: "请选择棋盘内的不同格。" });
      continue;
    }
    state.playerTileId = destination;
    emit("move", command.activeTimeMs, { tileId: destination });
    const beatIndex = Math.round((command.activeTimeMs - rules.firstBeatMs) / intervalMs);
    const beatMs = rules.firstBeatMs + beatIndex * intervalMs;
    const onBeat =
      beatIndex >= 0 &&
      beatIndex < rules.beatMasks.length &&
      Math.abs(command.activeTimeMs - beatMs) <= rules.windowMs;
    if (onBeat) {
      if (!state.scoredBeatIndices.includes(beatIndex)) {
        state.combo += 1;
        state.bestCombo = Math.max(state.bestCombo, state.combo);
        state.scoredBeatIndices = [...state.scoredBeatIndices, beatIndex];
        emit("hit", command.activeTimeMs, { tileId: destination, value: state.combo });
      }
    } else {
      const danger = firewallDangerTileIds(definition, command.activeTimeMs).includes(destination);
      state.combo = danger ? 0 : Math.max(0, state.combo - rules.offbeatPenalty);
      emit("miss", command.activeTimeMs, {
        tileId: destination,
        value: state.combo,
        reason: danger ? "错拍进入危险格，Combo 清零。" : "错拍，Combo 减少 5。",
      });
    }
  }
  advanceBeats(Math.min(activeTimeMs, rules.durationMs));
  state.activeTimeMs = Math.min(activeTimeMs, rules.durationMs);
  state.maskIndex = Math.min(
    rules.beatMasks.length - 1,
    Math.max(0, Math.floor((state.activeTimeMs - rules.firstBeatMs + intervalMs / 2) / intervalMs)),
  );
  if (activeTimeMs >= rules.durationMs) {
    state.status = state.bestCombo >= rules.comboTarget ? "success" : "failure";
    emit(state.status, rules.durationMs, { value: state.bestCombo });
  }
  return state;
}

export function antivirusTargetValue(kind: AntivirusTargetKind): number {
  return kind === "purple" ? 2 : kind === "blue" ? 1 : 0;
}

function advanceAntivirus(
  definition: AntivirusDefinition,
  previous: AntivirusState,
  activeTimeMs: number,
  inputs: readonly RealtimeInput[],
  emit: EmitFeedback,
): AntivirusState {
  const state: Mutable<AntivirusState> = { ...previous };
  const rules = definition.rules;
  const byId = new Map(rules.spawns.map((spawn) => [spawn.id, spawn]));
  const advanceSchedule = (timeMs: number) => {
    while (true) {
      const nextSpawn = rules.spawns[state.nextSpawnIndex];
      const nextExpiry = state.activeTargetIds
        .map((id) => byId.get(id))
        .filter((target): target is AntivirusSpawn => target !== undefined)
        .toSorted(
          (left, right) => left.expiresAtMs - right.expiresAtMs || left.id.localeCompare(right.id),
        )[0];
      const spawnMs = nextSpawn?.spawnAtMs ?? Infinity;
      const expiryMs = nextExpiry?.expiresAtMs ?? Infinity;
      const eventTimeMs = Math.min(spawnMs, expiryMs);
      if (eventTimeMs > timeMs || eventTimeMs >= rules.durationMs) break;
      if (nextExpiry && expiryMs <= spawnMs) {
        state.activeTargetIds = state.activeTargetIds.filter((id) => id !== nextExpiry.id);
        state.expiredTargetIds = [...state.expiredTargetIds, nextExpiry.id];
        emit("targetExpired", expiryMs, { targetId: nextExpiry.id, tileId: nextExpiry.tileId });
      } else if (nextSpawn) {
        state.activeTargetIds = [...state.activeTargetIds, nextSpawn.id];
        state.nextSpawnIndex += 1;
        emit("targetSpawned", spawnMs, { targetId: nextSpawn.id, tileId: nextSpawn.tileId });
      }
    }
  };
  const clearTarget = (target: AntivirusSpawn, timeMs: number) => {
    if (!state.activeTargetIds.includes(target.id)) return;
    const targets =
      target.kind === "star"
        ? [
            target,
            ...state.activeTargetIds
              .map((id) => byId.get(id))
              .filter(
                (active): active is AntivirusSpawn =>
                  active !== undefined && active.kind !== "star",
              ),
          ]
        : [target];
    const clearedIds = targets.map((active) => active.id);
    state.activeTargetIds = state.activeTargetIds.filter((id) => !clearedIds.includes(id));
    state.clearedTargetIds = [...state.clearedTargetIds, ...clearedIds];
    for (const cleared of targets) {
      state.score += antivirusTargetValue(cleared.kind);
      emit("targetCleared", timeMs, {
        targetId: cleared.id,
        tileId: cleared.tileId,
        value: antivirusTargetValue(cleared.kind),
      });
    }
    if (target.kind === "star") {
      state.lastStarClearCount = targets.length - 1;
      state.bestStarClearCount = Math.max(state.bestStarClearCount, state.lastStarClearCount);
      emit("starCleared", timeMs, { targetId: target.id, value: state.lastStarClearCount });
    }
  };
  for (const command of inputs) {
    if (command.sequence <= state.lastInputSequence) continue;
    state.lastInputSequence = command.sequence;
    advanceSchedule(Math.min(command.activeTimeMs, rules.durationMs));
    if (command.activeTimeMs >= rules.durationMs) break;
    if (command.kind === "click" && command.targetId !== undefined) {
      const target = byId.get(command.targetId);
      if (
        !target ||
        target.tileId !== command.tileId ||
        !state.activeTargetIds.includes(target.id)
      ) {
        emit("invalidInput", command.activeTimeMs, { reason: "目标已经消失。" });
        continue;
      }
    }
    const destination =
      command.kind === "interact"
        ? state.playerTileId
        : inputDestination(definition, state.playerTileId, command, false);
    if (destination === null) {
      emit("blocked", command.activeTimeMs, { reason: "请选择棋盘内的格子。" });
      continue;
    }
    if (destination !== state.playerTileId) {
      state.playerTileId = destination;
      emit("move", command.activeTimeMs, { tileId: destination });
    }
    const target = state.activeTargetIds
      .map((id) => byId.get(id))
      .find((active) => active?.tileId === destination);
    if (target) clearTarget(target, command.activeTimeMs);
  }
  advanceSchedule(Math.min(activeTimeMs, rules.durationMs));
  state.activeTimeMs = Math.min(activeTimeMs, rules.durationMs);
  if (activeTimeMs >= rules.durationMs) {
    state.activeTargetIds = [];
    state.status = state.score >= rules.targetScore ? "success" : "failure";
    emit(state.status, rules.durationMs, { value: state.score });
  }
  return state;
}

export function ghostTileIds(
  definition: GhostsDefinition,
  state: GhostsState,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    definition.rules.ghosts
      .filter((ghost) => !state.removedGhostIds.includes(ghost.id))
      .map((ghost) => {
        const tileId = ghost.path[state.ghostPathIndices[ghost.id] ?? ghost.initialIndex];
        if (tileId === undefined) throw new TypeError(`幽灵 ${ghost.id} 的路径索引无效。`);
        return [ghost.id, tileId];
      }),
  );
}

function advanceGhosts(
  definition: GhostsDefinition,
  previous: GhostsState,
  activeTimeMs: number,
  inputs: readonly RealtimeInput[],
  emit: EmitFeedback,
): GhostsState {
  const state: Mutable<GhostsState> = { ...previous };
  const rules = definition.rules;
  const nextStepTime = () =>
    Math.min(
      ...rules.ghosts
        .filter((ghost) => !state.removedGhostIds.includes(ghost.id))
        .map((ghost) => state.nextGhostStepAtMs[ghost.id] ?? ghost.stepMs),
    );
  const resolveMoment = (timeMs: number, commands: readonly RealtimeInput[]) => {
    const playerFrom = state.playerTileId;
    let playerTo = playerFrom;
    let moved = false;
    for (const command of commands) {
      if (command.sequence <= state.lastInputSequence) continue;
      state.lastInputSequence = command.sequence;
      if (command.kind === "interact") {
        emit("invalidInput", timeMs, { reason: "灯在踏入后自动点亮。" });
        continue;
      }
      if (state.lastPlayerInputAtMs === timeMs) continue;
      state.lastPlayerInputAtMs = timeMs;
      if (
        state.lastPlayerMoveAtMs !== null &&
        timeMs - state.lastPlayerMoveAtMs < rules.playerStepMinMs
      ) {
        emit("blocked", timeMs, { reason: "两次移动至少间隔 140ms。" });
        continue;
      }
      const destination = inputDestination(definition, playerFrom, command, true);
      if (destination === null || destination === playerFrom) {
        emit("blocked", timeMs, { reason: "幽灵房间只能移动到四向相邻格。" });
        continue;
      }
      playerTo = destination;
      moved = true;
    }
    const indices = { ...state.ghostPathIndices };
    const nextSteps = { ...state.nextGhostStepAtMs };
    const intents = rules.ghosts
      .filter((ghost) => !state.removedGhostIds.includes(ghost.id))
      .map((ghost) => {
        const index = indices[ghost.id] ?? ghost.initialIndex;
        const from = ghost.path[index];
        const steps = nextSteps[ghost.id] ?? ghost.stepMs;
        const moves = steps === timeMs;
        const nextIndex = moves ? (index + 1) % ghost.path.length : index;
        const to = ghost.path[nextIndex];
        if (from === undefined || to === undefined)
          throw new TypeError(`幽灵 ${ghost.id} 的路径无效。`);
        if (moves) {
          indices[ghost.id] = nextIndex;
          nextSteps[ghost.id] = steps + ghost.stepMs;
        }
        return { id: ghost.id, from, to, moves };
      });
    const collisions = intents.filter(
      (intent) =>
        intent.to === playerTo ||
        (moved && intent.moves && intent.from === playerTo && intent.to === playerFrom),
    );
    if (collisions.length > 0) {
      emit("collision", timeMs, {
        tileId: playerTo,
        ghostIds: collisions.map((collision) => collision.id),
      });
      state.status = "failure";
      state.playerTileId = definition.entry.tileId;
      state.ghostPathIndices = Object.fromEntries(
        rules.ghosts.map((ghost) => [ghost.id, ghost.initialIndex]),
      );
      state.nextGhostStepAtMs = Object.fromEntries(
        rules.ghosts.map((ghost) => [ghost.id, ghost.stepMs]),
      );
      state.removedGhostIds = [];
      state.litLampIds = [];
      state.activeTimeMs = timeMs;
      emit("failure", timeMs);
      return;
    }
    state.ghostPathIndices = indices;
    state.nextGhostStepAtMs = nextSteps;
    for (const intent of intents) {
      if (intent.moves) emit("ghostStep", timeMs, { tileId: intent.to, ghostIds: [intent.id] });
    }
    if (!moved) return;
    state.playerTileId = playerTo;
    state.lastPlayerMoveAtMs = timeMs;
    emit("move", timeMs, { tileId: playerTo });
    for (const lamp of rules.lamps) {
      if (lamp.tileId !== playerTo || state.litLampIds.includes(lamp.id)) continue;
      state.litLampIds = [...state.litLampIds, lamp.id];
      state.removedGhostIds = [...new Set([...state.removedGhostIds, ...lamp.ghostIds])];
      emit("lampLit", timeMs, { tileId: playerTo, targetId: lamp.id, ghostIds: lamp.ghostIds });
    }
    if (playerTo === rules.exitTileId) {
      state.status = "success";
      state.activeTimeMs = timeMs;
      emit("success", timeMs);
    }
  };
  let inputIndex = 0;
  while (state.status === "running") {
    const nextInput = inputs[inputIndex];
    const stepMs = nextStepTime();
    const nextTimeMs = Math.min(stepMs, nextInput?.activeTimeMs ?? Infinity);
    // Keep a tick exactly at a render-only boundary open for a subsequently delivered input.
    if (
      nextTimeMs > activeTimeMs ||
      (nextTimeMs === activeTimeMs && nextInput?.activeTimeMs !== activeTimeMs)
    )
      break;
    const commands: RealtimeInput[] = [];
    while (inputs[inputIndex]?.activeTimeMs === nextTimeMs) {
      const command = inputs[inputIndex];
      if (command) commands.push(command);
      inputIndex += 1;
    }
    resolveMoment(nextTimeMs, commands);
  }
  if (state.status === "running") state.activeTimeMs = activeTimeMs;
  return state;
}

export interface RealtimeValidationIssue {
  readonly path: string;
  readonly message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9.-]*$/.test(value);
}

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function validNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function validateRealtimeDefinition(value: unknown): readonly RealtimeValidationIssue[] {
  const issues: RealtimeValidationIssue[] = [];
  const report = (path: string, message: string) => issues.push({ path, message });
  if (!isRecord(value)) return [{ path: "", message: "挑战必须为对象。" }];
  for (const field of ["id", "boardId", "effectBundleId"]) {
    if (!validId(value[field])) report(field, "缺少合法稳定 ID。");
  }
  if (!validNonnegativeInteger(value.ruleVersion) || value.ruleVersion === 0)
    report("ruleVersion", "规则版本必须为正整数。");
  if (
    !Array.isArray(value.witnessIds) ||
    value.witnessIds.length === 0 ||
    value.witnessIds.some((id: unknown) => !validId(id))
  )
    report("witnessIds", "至少引用一条合法见证。");
  if (!["firewall", "antivirus", "ghosts"].includes(String(value.kind))) {
    report("kind", "未知实时挑战类型。");
    return issues;
  }
  if (!Array.isArray(value.tiles) || value.tiles.length === 0)
    return [...issues, { path: "tiles", message: "棋盘必须包含固定格子。" }];
  const tiles: RealtimeTile[] = [];
  const tileIds = new Set<string>();
  const coordinates = new Set<string>();
  for (const [index, tile] of value.tiles.entries()) {
    if (
      !isRecord(tile) ||
      !validId(tile.id) ||
      typeof tile.x !== "number" ||
      !Number.isSafeInteger(tile.x) ||
      typeof tile.y !== "number" ||
      !Number.isSafeInteger(tile.y)
    ) {
      report(`tiles[${index}]`, "格子需要稳定 ID 和整数坐标。");
      continue;
    }
    if (tileIds.has(tile.id)) report(`tiles[${index}].id`, "格子 ID 重复。");
    const coordinate = `${tile.x},${tile.y}`;
    if (coordinates.has(coordinate)) report(`tiles[${index}]`, "格子坐标重复。");
    tileIds.add(tile.id);
    coordinates.add(coordinate);
    tiles.push({ id: tile.id, x: tile.x, y: tile.y });
  }
  const entryTileId = isRecord(value.entry) ? value.entry.tileId : undefined;
  if (typeof entryTileId !== "string" || !tileIds.has(entryTileId))
    report("entry.tileId", "入口不在棋盘内。");
  if (!isRecord(value.rules)) return [...issues, { path: "rules", message: "缺少类型专属规则。" }];
  const rules = value.rules;
  const expectedGoal =
    value.kind === "firewall" ? "highestCombo" : value.kind === "antivirus" ? "score" : "exit";
  if (!isRecord(value.goal) || value.goal.kind !== expectedGoal)
    report("goal", "目标与挑战类型不一致。");
  if (value.kind !== "ghosts") {
    if (
      tiles.length !== 25 ||
      [...coordinates].some((coordinate) => !/^[0-4],[0-4]$/.test(coordinate))
    )
      report("tiles", "防火墙和杀毒必须为完整 5 × 5 棋盘。");
    if (
      tiles.find((tile) => tile.id === entryTileId)?.x !== 2 ||
      tiles.find((tile) => tile.id === entryTileId)?.y !== 2
    )
      report("entry", "光标必须从中心格开始。");
    if (!finitePositive(rules.durationMs)) report("rules.durationMs", "时长必须为有限正数。");
  }
  if (value.kind === "firewall") validateFirewallRules(rules, tileIds, report);
  if (value.kind === "antivirus") validateAntivirusRules(rules, tileIds, report);
  if (value.kind === "ghosts") validateGhostRules(rules, tiles, entryTileId, report);
  validateCanonicalChallenge(value, rules, tiles, report);
  return issues;
}

function validateCanonicalChallenge(
  value: Record<string, unknown>,
  rules: Record<string, unknown>,
  tiles: readonly RealtimeTile[],
  report: (path: string, message: string) => void,
): void {
  const firewallContracts: Readonly<Record<string, readonly [number, number, number]>> = {
    "a.firewall.tutorial": [15000, 12, 0],
    "a.firewall.inner": [45000, 40, 5],
    "a.firewall.deep": [45000, 55, 9],
    "a.firewall.core": [45000, 70, 13],
  };
  const firewallContract = typeof value.id === "string" ? firewallContracts[value.id] : undefined;
  if (value.kind === "firewall" && firewallContract) {
    const [durationMs, comboTarget, maskLimit] = firewallContract;
    if (
      rules.durationMs !== durationMs ||
      rules.comboTarget !== comboTarget ||
      rules.bpm !== 120 ||
      rules.firstBeatMs !== 250 ||
      rules.windowMs !== 150 ||
      rules.offbeatPenalty !== 5
    )
      report("rules", "防火墙正式档位参数与玩法合同不一致。");
    if (
      Array.isArray(rules.beatMasks) &&
      rules.beatMasks.some((mask: unknown) => Array.isArray(mask) && mask.length > maskLimit)
    )
      report("rules.beatMasks", `本档危险格上限为 ${maskLimit}。`);
  }
  const antivirusContracts: Readonly<Record<string, readonly [number, number]>> = {
    "b.antivirus.light": [700, 40],
    "b.antivirus.medium": [500, 60],
    "b.antivirus.heavy": [350, 80],
  };
  const antivirusContract = typeof value.id === "string" ? antivirusContracts[value.id] : undefined;
  if (value.kind !== "antivirus" || !antivirusContract) return;
  const [intervalMs, targetScore] = antivirusContract;
  if (rules.durationMs !== 45000 || rules.targetScore !== targetScore)
    report("rules", "杀毒正式档位参数与玩法合同不一致。");
  if (!Array.isArray(rules.spawns)) return;
  const expectedLength = Math.ceil((45000 - 500) / intervalMs);
  if (rules.spawns.length !== expectedLength)
    report("rules.spawns", "冻结排表目标数与生成间隔不一致。");
  const sortedTiles = tiles.toSorted((left, right) => left.y - right.y || left.x - right.x);
  const planned: { tileId: string; spawnAtMs: number; expiresAtMs: number }[] = [];
  for (const [index, spawn] of rules.spawns.entries()) {
    if (!isRecord(spawn)) continue;
    const spawnAtMs = 500 + index * intervalMs;
    const expectedKind = index % 10 === 9 ? "star" : index % 4 === 3 ? "purple" : "blue";
    const expiresAtMs = spawnAtMs + (expectedKind === "purple" ? 1000 : 1800);
    if (
      spawn.spawnAtMs !== spawnAtMs ||
      spawn.expiresAtMs !== expiresAtMs ||
      spawn.kind !== expectedKind
    )
      report(`rules.spawns[${index}]`, "出现时间、寿命或种类与冻结生成合同不一致。");
    let expectedTileId: string | undefined;
    for (let offset = 0; offset < 25; offset += 1) {
      const candidate = sortedTiles[(7 * index + offset) % 25];
      if (
        candidate &&
        !planned.some(
          (other) =>
            other.tileId === candidate.id &&
            other.spawnAtMs < expiresAtMs &&
            spawnAtMs < other.expiresAtMs,
        )
      ) {
        expectedTileId = candidate.id;
        break;
      }
    }
    if (spawn.tileId !== expectedTileId)
      report(
        `rules.spawns[${index}].tileId`,
        "格子与制作时固定排表不一致，不能依玩家清除速度生成。",
      );
    if (expectedTileId) planned.push({ tileId: expectedTileId, spawnAtMs, expiresAtMs });
  }
}

function validateFirewallRules(
  rules: Record<string, unknown>,
  tileIds: ReadonlySet<string>,
  report: (path: string, message: string) => void,
): void {
  for (const field of ["bpm", "windowMs", "comboTarget", "offbeatPenalty"]) {
    if (!finitePositive(rules[field])) report(`rules.${field}`, "参数必须为有限正数。");
  }
  if (!validNonnegativeInteger(rules.firstBeatMs))
    report("rules.firstBeatMs", "首拍时间必须为非负整数。");
  if (!Array.isArray(rules.beatMasks) || rules.beatMasks.length === 0) {
    report("rules.beatMasks", "必须冻结逐拍危险图案。");
    return;
  }
  for (const [index, mask] of rules.beatMasks.entries()) {
    if (
      !Array.isArray(mask) ||
      mask.some((id: unknown) => typeof id !== "string" || !tileIds.has(id)) ||
      new Set(mask).size !== mask.length
    )
      report(`rules.beatMasks[${index}]`, "危险图案必须引用不同的已知格子。");
    else if (mask.length > 13) report(`rules.beatMasks[${index}]`, "危险格不能超过 13 格。");
  }
  if (
    finitePositive(rules.bpm) &&
    finitePositive(rules.windowMs) &&
    validNonnegativeInteger(rules.firstBeatMs) &&
    finitePositive(rules.durationMs)
  ) {
    const intervalMs = 60_000 / rules.bpm;
    const lastBeatMs = rules.firstBeatMs + (rules.beatMasks.length - 1) * intervalMs;
    if (2 * rules.windowMs >= intervalMs) report("rules.windowMs", "节拍窗口重叠或相接。");
    if (rules.firstBeatMs - rules.windowMs < 0 || lastBeatMs + rules.windowMs >= rules.durationMs)
      report("rules.beatMasks", "首末窗口必须完整位于挑战内。");
    if (lastBeatMs + intervalMs < rules.durationMs)
      report("rules.beatMasks", "逐拍危险图案不完整。");
  }
  if (
    typeof rules.comboTarget === "number" &&
    (!Number.isSafeInteger(rules.comboTarget) || rules.comboTarget >= rules.beatMasks.length)
  )
    report("rules.comboTarget", "Combo 门槛必须为低于拍数的正整数。");
}

function validateAntivirusRules(
  rules: Record<string, unknown>,
  tileIds: ReadonlySet<string>,
  report: (path: string, message: string) => void,
): void {
  if (!validNonnegativeInteger(rules.targetScore) || rules.targetScore === 0)
    report("rules.targetScore", "通过分数必须为正整数。");
  if (!Array.isArray(rules.spawns) || rules.spawns.length === 0) {
    report("rules.spawns", "必须提供冻结生成表。");
    return;
  }
  const spawns: AntivirusSpawn[] = [];
  const ids = new Set<string>();
  for (const [index, spawn] of rules.spawns.entries()) {
    const path = `rules.spawns[${index}]`;
    if (
      !isRecord(spawn) ||
      !validId(spawn.id) ||
      typeof spawn.tileId !== "string" ||
      !tileIds.has(spawn.tileId) ||
      !["blue", "purple", "star"].includes(String(spawn.kind)) ||
      !validNonnegativeInteger(spawn.spawnAtMs) ||
      !finitePositive(spawn.expiresAtMs)
    ) {
      report(path, "目标字段不完整或引用非法。");
      continue;
    }
    if (ids.has(spawn.id)) report(`${path}.id`, "目标实例 ID 重复。");
    ids.add(spawn.id);
    if (spawn.expiresAtMs <= spawn.spawnAtMs) report(path, "目标寿命必须为正。");
    if (typeof rules.durationMs === "number" && spawn.spawnAtMs >= rules.durationMs)
      report(path, "目标不能在截止时或之后出现。");
    if (spawns.length > 0 && spawn.spawnAtMs < (spawns.at(-1)?.spawnAtMs ?? 0))
      report(path, "生成表必须按出现时间排序。");
    spawns.push({
      id: spawn.id,
      tileId: spawn.tileId,
      kind: spawn.kind as AntivirusTargetKind,
      spawnAtMs: spawn.spawnAtMs,
      expiresAtMs: spawn.expiresAtMs,
    });
  }
  for (const [index, spawn] of spawns.entries()) {
    if (
      spawns
        .slice(0, index)
        .some(
          (other) =>
            other.tileId === spawn.tileId &&
            other.spawnAtMs < spawn.expiresAtMs &&
            spawn.spawnAtMs < other.expiresAtMs,
        )
    )
      report(`rules.spawns[${index}]`, "同格目标生命周期重叠。");
  }
  if (
    typeof rules.targetScore === "number" &&
    spawns.reduce((score, spawn) => score + antivirusTargetValue(spawn.kind), 0) < rules.targetScore
  )
    report("rules.targetScore", "固定脚本理论总分不足。");
}

function validateGhostRules(
  rules: Record<string, unknown>,
  tiles: readonly RealtimeTile[],
  entryTileId: unknown,
  report: (path: string, message: string) => void,
): void {
  const byTile = new Map(tiles.map((tile) => [tile.id, tile]));
  if (
    typeof rules.exitTileId !== "string" ||
    !byTile.has(rules.exitTileId) ||
    rules.exitTileId === entryTileId
  )
    report("rules.exitTileId", "出口必须为不同于入口的已知格子。");
  if (rules.playerStepMinMs !== 140)
    report("rules.playerStepMinMs", "玩家最短移动间隔必须为 140ms。");
  if (
    !Array.isArray(rules.ghosts) ||
    rules.ghosts.length === 0 ||
    !Array.isArray(rules.lamps) ||
    rules.lamps.length === 0
  ) {
    report("rules", "幽灵房间需要固定路线和至少一盏灯。");
    return;
  }
  const ghosts: GhostDefinition[] = [];
  const ghostIds = new Set<string>();
  for (const [index, ghost] of rules.ghosts.entries()) {
    const path = `rules.ghosts[${index}]`;
    if (
      !isRecord(ghost) ||
      !validId(ghost.id) ||
      !Array.isArray(ghost.path) ||
      ghost.path.length < 2 ||
      ghost.path.some((id: unknown) => typeof id !== "string" || !byTile.has(id)) ||
      ghost.initialIndex !== 0 ||
      ghost.stepMs !== 500
    ) {
      report(path, "幽灵需要已知格子组成的循环路径、500ms 步频和合法初始索引。");
      continue;
    }
    if (ghostIds.has(ghost.id)) report(`${path}.id`, "幽灵 ID 重复。");
    ghostIds.add(ghost.id);
    const route = ghost.path as string[];
    for (const [routeIndex, tileId] of route.entries()) {
      const from = byTile.get(tileId);
      const nextId = route[(routeIndex + 1) % route.length];
      const to = nextId === undefined ? undefined : byTile.get(nextId);
      if (!from || !to || Math.abs(from.x - to.x) + Math.abs(from.y - to.y) !== 1)
        report(`${path}.path[${routeIndex}]`, "路径包括首尾必须四向连续。");
    }
    if (route[ghost.initialIndex] === entryTileId) report(path, "入口不能与初始幽灵重合。");
    ghosts.push({
      id: ghost.id,
      path: route,
      stepMs: ghost.stepMs,
      initialIndex: ghost.initialIndex,
    });
  }
  for (const [index, ghost] of ghosts.entries()) {
    for (const other of ghosts.slice(0, index)) {
      const period = leastCommonMultiple(ghost.path.length, other.path.length);
      for (let step = 0; step < period; step += 1) {
        const from = ghost.path[(ghost.initialIndex + step) % ghost.path.length];
        const to = ghost.path[(ghost.initialIndex + step + 1) % ghost.path.length];
        const otherFrom = other.path[(other.initialIndex + step) % other.path.length];
        const otherTo = other.path[(other.initialIndex + step + 1) % other.path.length];
        if (from === otherFrom || (from === otherTo && to === otherFrom)) {
          report(`rules.ghosts[${index}]`, `与 ${other.id} 在第 ${step} 步重合或交换。`);
          break;
        }
      }
    }
  }
  const lampIds = new Set<string>();
  for (const [index, lamp] of rules.lamps.entries()) {
    if (
      !isRecord(lamp) ||
      !validId(lamp.id) ||
      typeof lamp.tileId !== "string" ||
      !byTile.has(lamp.tileId) ||
      !Array.isArray(lamp.ghostIds) ||
      lamp.ghostIds.length === 0 ||
      lamp.ghostIds.some((id: unknown) => typeof id !== "string" || !ghostIds.has(id))
    ) {
      report(`rules.lamps[${index}]`, "灯必须引用已知格子和幽灵分组。");
      continue;
    }
    if (lampIds.has(lamp.id)) report(`rules.lamps[${index}].id`, "灯 ID 重复。");
    lampIds.add(lamp.id);
  }
}

function leastCommonMultiple(left: number, right: number): number {
  let divisorLeft = left;
  let divisorRight = right;
  while (divisorRight !== 0) {
    const remainder = divisorLeft % divisorRight;
    divisorLeft = divisorRight;
    divisorRight = remainder;
  }
  return (left / divisorLeft) * right;
}

export function replayRealtimeWitness(
  definition: RealtimeDefinition,
  witness: RealtimeWitness,
): RealtimeAdvance {
  let state = createRealtime(definition);
  const feedback: RealtimeFeedback[] = [];
  let index = 0;
  while (index < witness.commands.length) {
    const command = witness.commands[index];
    if (!command) break;
    const simultaneous: RealtimeInput[] = [];
    while (witness.commands[index]?.activeTimeMs === command.activeTimeMs) {
      const next = witness.commands[index];
      if (next) simultaneous.push(next);
      index += 1;
    }
    const advanced = advanceRealtime(definition, state, command.activeTimeMs, simultaneous);
    state = advanced.state;
    feedback.push(...advanced.feedback);
  }
  const finished = advanceRealtime(definition, state, witness.finishAtMs);
  feedback.push(...finished.feedback);
  return { state: finished.state, result: finished.result, feedback };
}
