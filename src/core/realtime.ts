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

interface FirewallTimingRules {
  readonly durationMs: number;
  readonly bpm: number;
  readonly firstBeatMs: number;
  readonly windowMs: number;
  readonly comboTarget: number;
  readonly offbeatPenalty: number;
}

export interface LegacyFirewallDefinition extends RealtimeDefinitionBase {
  readonly kind: "firewall";
  readonly ruleVersion: 1 | 2;
  readonly rules: FirewallTimingRules & {
    readonly beatMasks: readonly (readonly string[])[];
  };
  readonly goal: { readonly kind: "highestCombo" };
}

export interface FirewallAlarm {
  readonly id: string;
  readonly startsAtMs: number;
  readonly endsAtMs: number;
  /** The movement direction that faces this incoming alarm. */
  readonly approachFrom: RealtimeDirection;
  readonly frames: readonly { readonly atMs: number; readonly tileIds: readonly string[] }[];
}

export interface DirectionalFirewallDefinition extends RealtimeDefinitionBase {
  readonly kind: "firewall";
  readonly ruleVersion: 3;
  readonly rules: FirewallTimingRules & {
    readonly beatCount: number;
    readonly hazardPenalty: number;
    readonly dodgeWindowMs: number;
    readonly alarms: readonly FirewallAlarm[];
  };
  readonly goal: { readonly kind: "highestCombo" };
}

export type FirewallDefinition = LegacyFirewallDefinition | DirectionalFirewallDefinition;

export interface FirewallAlarmContact {
  readonly alarmId: string;
  readonly tileIds: readonly string[];
  readonly warningTileIds: readonly string[];
  readonly approachFrom: RealtimeDirection;
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
  readonly nextAlarmEventIndex: number;
  readonly judgedBeatIndices: readonly number[];
  readonly dodge: {
    readonly direction: RealtimeDirection;
    readonly untilMs: number;
    readonly beatIndex: number;
  } | null;
  readonly contactedAlarmIds: readonly string[];
  readonly dodgedAlarmIds: readonly string[];
  readonly lastDodgeAtMs: number | null;
  readonly lastHazardHit: {
    readonly activeTimeMs: number;
    readonly alarmIds: readonly string[];
    readonly penalty: number;
  } | null;
  readonly lastJudgment: {
    readonly kind: "perfect" | "miss";
    readonly activeTimeMs: number;
  } | null;
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
  | "hazardHit"
  | "dodged"
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
  readonly alarmIds?: readonly string[];
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
        nextAlarmEventIndex: 0,
        judgedBeatIndices: [],
        dodge: null,
        contactedAlarmIds: [],
        dodgedAlarmIds: [],
        lastDodgeAtMs: null,
        lastHazardHit: null,
        lastJudgment: null,
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
  if (
    !Number.isFinite(activeTimeMs) ||
    activeTimeMs < 0 ||
    activeTimeMs >= definition.rules.durationMs
  )
    return [];
  if (definition.ruleVersion === 3)
    return [
      ...new Set(firewallAlarmContacts(definition, activeTimeMs).flatMap((alarm) => alarm.tileIds)),
    ];
  const intervalMs = 60_000 / definition.rules.bpm;
  const firstMaskMs = definition.rules.firstBeatMs - intervalMs / 2;
  const index = Math.min(
    definition.rules.beatMasks.length - 1,
    Math.floor((activeTimeMs - firstMaskMs) / intervalMs),
  );
  return definition.rules.beatMasks[index] ?? [];
}

/** Visual preview only: entering a warning cell never changes the danger judgment. */
export function firewallWarningTileIds(
  definition: FirewallDefinition,
  activeTimeMs: number,
): readonly string[] {
  if (
    !Number.isFinite(activeTimeMs) ||
    activeTimeMs < 0 ||
    activeTimeMs >= definition.rules.durationMs
  )
    return [];
  if (definition.ruleVersion === 3)
    return [
      ...new Set(
        firewallAlarmContacts(definition, activeTimeMs).flatMap((alarm) => alarm.warningTileIds),
      ),
    ];
  const intervalMs = 60_000 / definition.rules.bpm;
  const firstMaskMs = definition.rules.firstBeatMs - intervalMs / 2;
  const nextIndex = Math.floor((activeTimeMs - firstMaskMs) / intervalMs) + 1;
  const untilNextMask = firstMaskMs + nextIndex * intervalMs - activeTimeMs;
  if (untilNextMask <= 0 || untilNextMask > 150) return [];
  const active = new Set(firewallDangerTileIds(definition, activeTimeMs));
  return (definition.rules.beatMasks[nextIndex] ?? []).filter((tileId) => !active.has(tileId));
}

export function firewallBeatCount(definition: FirewallDefinition): number {
  return definition.ruleVersion === 3
    ? definition.rules.beatCount
    : definition.rules.beatMasks.length;
}

function alarmTilesAt(alarm: FirewallAlarm, activeTimeMs: number): readonly string[] {
  if (activeTimeMs < alarm.startsAtMs || activeTimeMs >= alarm.endsAtMs) return [];
  return alarm.frames.findLast((frame) => frame.atMs <= activeTimeMs)?.tileIds ?? [];
}

export function firewallAlarmContacts(
  definition: FirewallDefinition,
  activeTimeMs: number,
): readonly FirewallAlarmContact[] {
  if (
    definition.ruleVersion !== 3 ||
    !Number.isFinite(activeTimeMs) ||
    activeTimeMs < 0 ||
    activeTimeMs >= definition.rules.durationMs
  )
    return [];
  const activeTiles = new Set(
    definition.rules.alarms.flatMap((alarm) => alarmTilesAt(alarm, activeTimeMs)),
  );
  return definition.rules.alarms.flatMap((alarm): FirewallAlarmContact[] => {
    const tileIds = alarmTilesAt(alarm, activeTimeMs);
    const next = alarm.frames.find((frame) => frame.atMs > activeTimeMs);
    const warningTileIds =
      next && next.atMs - activeTimeMs <= 150
        ? next.tileIds.filter((tileId) => !activeTiles.has(tileId))
        : [];
    return tileIds.length || warningTileIds.length
      ? [{ alarmId: alarm.id, tileIds, warningTileIds, approachFrom: alarm.approachFrom }]
      : [];
  });
}

function advanceFirewall(
  definition: FirewallDefinition,
  previous: FirewallState,
  activeTimeMs: number,
  inputs: readonly RealtimeInput[],
  emit: EmitFeedback,
): FirewallState {
  if (definition.ruleVersion === 3)
    return advanceDirectionalFirewall(definition, previous, activeTimeMs, inputs, emit);
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
        state.lastJudgment = { kind: "perfect", activeTimeMs: command.activeTimeMs };
        emit("hit", command.activeTimeMs, { tileId: destination, value: state.combo });
      }
    } else {
      const danger = firewallDangerTileIds(definition, command.activeTimeMs).includes(destination);
      state.combo = danger ? 0 : Math.max(0, state.combo - rules.offbeatPenalty);
      state.lastJudgment = { kind: "miss", activeTimeMs: command.activeTimeMs };
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

function advanceDirectionalFirewall(
  definition: DirectionalFirewallDefinition,
  previous: FirewallState,
  activeTimeMs: number,
  inputs: readonly RealtimeInput[],
  emit: EmitFeedback,
): FirewallState {
  const state: Mutable<FirewallState> = { ...previous };
  const rules = definition.rules;
  const intervalMs = 60_000 / rules.bpm;
  const alarmTimes = [
    ...new Set(
      rules.alarms.flatMap((alarm) => [...alarm.frames.map((frame) => frame.atMs), alarm.endsAtMs]),
    ),
  ].sort((left, right) => left - right);

  const contactsAt = (timeMs: number, from?: string) =>
    rules.alarms.filter((alarm) => {
      const now = alarmTilesAt(alarm, timeMs);
      if (now.includes(state.playerTileId)) return true;
      if (!from || from === state.playerTileId || !now.includes(from)) return false;
      const before = alarm.frames.findLast((frame) => frame.atMs < timeMs);
      return (
        alarm.startsAtMs < timeMs &&
        alarm.endsAtMs > timeMs &&
        before?.tileIds.includes(state.playerTileId)
      );
    });
  const resolveContacts = (timeMs: number, from?: string): boolean => {
    const contacts = contactsAt(timeMs, from);
    const ids = contacts.map((alarm) => alarm.id);
    state.contactedAlarmIds = state.contactedAlarmIds.filter((id) => ids.includes(id));
    state.dodgedAlarmIds = state.dodgedAlarmIds.filter((id) => ids.includes(id));
    const protectedIds = contacts
      .filter(
        (alarm) =>
          state.dodge &&
          timeMs < state.dodge.untilMs &&
          state.dodge.direction === alarm.approachFrom,
      )
      .map((alarm) => alarm.id);
    const newlyDodged = protectedIds.filter((id) => !state.dodgedAlarmIds.includes(id));
    if (newlyDodged.length) {
      state.dodgedAlarmIds = [...state.dodgedAlarmIds, ...newlyDodged];
      state.lastDodgeAtMs = timeMs;
      emit("dodged", timeMs, { tileId: state.playerTileId, alarmIds: newlyDodged });
    }
    const hits = ids.filter(
      (id) => !protectedIds.includes(id) && !state.contactedAlarmIds.includes(id),
    );
    if (!hits.length) return false;
    state.contactedAlarmIds = [...state.contactedAlarmIds, ...hits];
    state.combo = Math.max(0, state.combo - rules.hazardPenalty);
    state.lastHazardHit = { activeTimeMs: timeMs, alarmIds: hits, penalty: rules.hazardPenalty };
    emit("hazardHit", timeMs, {
      tileId: state.playerTileId,
      alarmIds: hits,
      value: state.combo,
      reason: `警报命中，Combo 减少 ${rules.hazardPenalty}。`,
    });
    return true;
  };
  const resolveInput = (command: RealtimeInput) => {
    state.lastInputSequence = command.sequence;
    const timeMs = command.activeTimeMs;
    if (command.kind === "interact" || (command.kind === "move" && command.repeat)) {
      emit("invalidInput", timeMs, { reason: "防火墙每次物理按下只移动一次，交互键无效。" });
      resolveContacts(timeMs);
      return;
    }
    const from = state.playerTileId;
    const destination = inputDestination(definition, from, command, false);
    if (destination === null || destination === from) {
      emit("blocked", timeMs, { reason: "请选择棋盘内的不同格。" });
      resolveContacts(timeMs);
      return;
    }
    const before = definition.tiles.find((tile) => tile.id === from)!;
    const after = definition.tiles.find((tile) => tile.id === destination)!;
    const direction: RealtimeDirection | null =
      before.x === after.x
        ? after.y < before.y
          ? "up"
          : "down"
        : before.y === after.y
          ? after.x < before.x
            ? "left"
            : "right"
          : null;
    if (state.dodge && direction !== state.dodge.direction) state.dodge = null;
    state.playerTileId = destination;
    emit("move", timeMs, { tileId: destination });
    const beatIndex = Math.round((timeMs - rules.firstBeatMs) / intervalMs);
    const beatMs = rules.firstBeatMs + beatIndex * intervalMs;
    const onBeat =
      beatIndex >= 0 && beatIndex < rules.beatCount && Math.abs(timeMs - beatMs) <= rules.windowMs;
    const firstOnBeat = onBeat && !state.judgedBeatIndices.includes(beatIndex);
    if (firstOnBeat) {
      state.judgedBeatIndices = [...state.judgedBeatIndices, beatIndex];
      state.dodge = direction
        ? { direction, untilMs: Math.max(timeMs, beatMs) + rules.dodgeWindowMs, beatIndex }
        : null;
    }
    // Reconstructed priority: one new alarm contact replaces this input's ordinary beat result.
    if (resolveContacts(timeMs, from)) return;
    if (firstOnBeat) {
      state.combo += 1;
      state.bestCombo = Math.max(state.bestCombo, state.combo);
      state.scoredBeatIndices = [...state.scoredBeatIndices, beatIndex];
      state.lastJudgment = { kind: "perfect", activeTimeMs: timeMs };
      emit("hit", timeMs, { tileId: destination, value: state.combo });
    } else if (!onBeat) {
      state.combo = Math.max(0, state.combo - rules.offbeatPenalty);
      state.lastJudgment = { kind: "miss", activeTimeMs: timeMs };
      emit("miss", timeMs, {
        tileId: destination,
        value: state.combo,
        reason: `错拍，Combo 减少 ${rules.offbeatPenalty}。`,
      });
    }
  };

  let inputIndex = 0;
  while (true) {
    const command = inputs[inputIndex];
    const nextBeat =
      state.nextBeatIndex < rules.beatCount
        ? rules.firstBeatMs + state.nextBeatIndex * intervalMs
        : Infinity;
    const nextTimeMs = Math.min(
      alarmTimes[state.nextAlarmEventIndex] ?? Infinity,
      state.dodge?.untilMs ?? Infinity,
      nextBeat,
      command?.activeTimeMs ?? Infinity,
    );
    if (
      nextTimeMs >= rules.durationMs ||
      nextTimeMs > activeTimeMs ||
      (nextTimeMs === activeTimeMs && command?.activeTimeMs !== activeTimeMs)
    )
      break;
    while ((alarmTimes[state.nextAlarmEventIndex] ?? Infinity) <= nextTimeMs)
      state.nextAlarmEventIndex += 1;
    if (state.dodge && state.dodge.untilMs <= nextTimeMs) state.dodge = null;
    if (nextBeat === nextTimeMs) {
      emit("beat", nextTimeMs, { value: state.nextBeatIndex });
      state.nextBeatIndex += 1;
    }
    let processedInput = false;
    while (inputs[inputIndex]?.activeTimeMs === nextTimeMs) {
      const input = inputs[inputIndex++]!;
      if (input.sequence <= state.lastInputSequence) continue;
      resolveInput(input);
      processedInput = true;
    }
    if (!processedInput) resolveContacts(nextTimeMs);
  }
  state.activeTimeMs = Math.min(activeTimeMs, rules.durationMs);
  state.maskIndex = Math.max(0, state.nextAlarmEventIndex - 1);
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
    const rows = value.kind === "firewall" && Number(value.ruleVersion) >= 2 ? 4 : 5;
    if (
      tiles.length !== 5 * rows ||
      tiles.some((tile) => tile.x < 0 || tile.x > 4 || tile.y < 0 || tile.y >= rows)
    )
      report(
        "tiles",
        `本规则版本的${value.kind === "firewall" ? "防火墙" : "杀毒"}必须为完整 5 × ${rows} 棋盘。`,
      );
    if (
      tiles.find((tile) => tile.id === entryTileId)?.x !== 2 ||
      tiles.find((tile) => tile.id === entryTileId)?.y !== 2
    )
      report("entry", "光标必须从中心格开始。");
    if (!finitePositive(rules.durationMs)) report("rules.durationMs", "时长必须为有限正数。");
  }
  if (value.kind === "firewall") validateFirewallRules(rules, tiles, value.ruleVersion, report);
  if (value.kind === "antivirus") validateAntivirusRules(rules, tileIds, report);
  if (value.kind === "ghosts") validateGhostRules(rules, tiles, entryTileId, report);
  validateCanonicalChallenge(value, rules, tiles, report);
  if (value.kind === "firewall" && value.ruleVersion === 3 && issues.length === 0) {
    const definition = value as unknown as DirectionalFirewallDefinition;
    const limits: Readonly<Record<string, number>> = {
      "a.firewall.tutorial": 4,
      "a.firewall.inner": 5,
      "a.firewall.deep": 8,
      "a.firewall.core": 12,
    };
    const limit = limits[definition.id];
    if (
      limit !== undefined &&
      definition.rules.alarms.some((alarm) =>
        alarm.frames.some((frame) => firewallDangerTileIds(definition, frame.atMs).length > limit),
      )
    )
      report("rules.alarms", `本档同时危险格上限为 ${limit}。`);
    if (firewallDangerTileIds(definition, 0).includes(definition.entry.tileId))
      report("entry", "防火墙不能在初始时刻将警报放在玩家脚下。");
  }
  return issues;
}

function validateCanonicalChallenge(
  value: Record<string, unknown>,
  rules: Record<string, unknown>,
  tiles: readonly RealtimeTile[],
  report: (path: string, message: string) => void,
): void {
  const firewallContracts: Readonly<Record<string, readonly [number, number, number, number]>> = {
    "a.firewall.tutorial": [15000, 12, 0, 0],
    "a.firewall.inner": [45000, 40, 5, 5],
    "a.firewall.deep": [45000, 55, 9, 8],
    "a.firewall.core": [45000, 70, 13, 12],
  };
  const firewallContract = typeof value.id === "string" ? firewallContracts[value.id] : undefined;
  if (value.kind === "firewall" && firewallContract) {
    const [durationMs, comboTarget, legacyMaskLimit, currentMaskLimit] = firewallContract;
    const maskLimit = value.ruleVersion === 1 ? legacyMaskLimit : currentMaskLimit;
    const bpm = value.ruleVersion === 1 ? 120 : 110;
    if (
      rules.durationMs !== durationMs ||
      rules.comboTarget !== comboTarget ||
      rules.bpm !== bpm ||
      rules.firstBeatMs !== 60_000 / bpm / 2 ||
      rules.windowMs !== 150 ||
      rules.offbeatPenalty !== (value.ruleVersion === 3 ? 1 : 5) ||
      (value.ruleVersion === 3 && (rules.hazardPenalty !== 5 || rules.dodgeWindowMs !== 150))
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
  tiles: readonly RealtimeTile[],
  ruleVersion: unknown,
  report: (path: string, message: string) => void,
): void {
  const tileIds = new Set(tiles.map((tile) => tile.id));
  for (const field of ["bpm", "windowMs", "comboTarget", "offbeatPenalty"]) {
    if (!finitePositive(rules[field])) report(`rules.${field}`, "参数必须为有限正数。");
  }
  if (!Number.isSafeInteger(rules.offbeatPenalty))
    report("rules.offbeatPenalty", "错拍扣分必须为整数。");
  const firstBeatMs = rules.firstBeatMs;
  const validFirstBeat =
    typeof firstBeatMs === "number" && Number.isFinite(firstBeatMs) && firstBeatMs >= 0;
  if (!validFirstBeat) report("rules.firstBeatMs", "首拍时间必须为有限非负毫秒。");
  if (![1, 2, 3].includes(Number(ruleVersion))) report("ruleVersion", "没有登记此防火墙规则版本。");
  if (ruleVersion === 3) validateFirewallAlarms(rules, tiles, report);
  if (ruleVersion !== 3 && (!Array.isArray(rules.beatMasks) || rules.beatMasks.length === 0)) {
    report("rules.beatMasks", "必须冻结逐拍危险图案。");
    return;
  }
  const beatCount = ruleVersion === 3 ? rules.beatCount : (rules.beatMasks as unknown[]).length;
  if (!validNonnegativeInteger(beatCount) || beatCount === 0) {
    report("rules.beatCount", "拍数必须为正整数。");
    return;
  }
  for (const [index, mask] of (ruleVersion === 3 ? [] : (rules.beatMasks as unknown[])).entries()) {
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
    validFirstBeat &&
    finitePositive(rules.durationMs)
  ) {
    const beatPath = ruleVersion === 3 ? "rules.beatCount" : "rules.beatMasks";
    const intervalMs = 60_000 / rules.bpm;
    const lastBeatMs = firstBeatMs + (beatCount - 1) * intervalMs;
    if (2 * rules.windowMs >= intervalMs) report("rules.windowMs", "节拍窗口重叠或相接。");
    if (firstBeatMs - rules.windowMs < 0 || lastBeatMs + rules.windowMs >= rules.durationMs)
      report(beatPath, "首末窗口必须完整位于挑战内。");
    if (lastBeatMs + intervalMs < rules.durationMs)
      report(beatPath, ruleVersion === 3 ? "节拍序列不完整。" : "逐拍危险图案不完整。");
  }
  if (
    typeof rules.comboTarget === "number" &&
    (!Number.isSafeInteger(rules.comboTarget) || rules.comboTarget >= beatCount)
  )
    report("rules.comboTarget", "Combo 门槛必须为低于拍数的正整数。");
}

function validateFirewallAlarms(
  rules: Record<string, unknown>,
  tiles: readonly RealtimeTile[],
  report: (path: string, message: string) => void,
): void {
  const tileIds = new Set(tiles.map((tile) => tile.id));
  if (!finitePositive(rules.hazardPenalty) || !Number.isSafeInteger(rules.hazardPenalty))
    report("rules.hazardPenalty", "警报扣分必须为正整数。");
  if (!finitePositive(rules.dodgeWindowMs))
    report("rules.dodgeWindowMs", "闪避时段必须为有限正数。");
  if (!Array.isArray(rules.alarms)) {
    report("rules.alarms", "必须明确提供固定警报排表。");
    return;
  }
  const ids = new Set<string>();
  for (const [index, alarm] of rules.alarms.entries()) {
    const path = `rules.alarms[${index}]`;
    if (
      !isRecord(alarm) ||
      !validId(alarm.id) ||
      !["up", "right", "down", "left"].includes(String(alarm.approachFrom)) ||
      typeof alarm.startsAtMs !== "number" ||
      !Number.isFinite(alarm.startsAtMs) ||
      alarm.startsAtMs < 0 ||
      !finitePositive(alarm.endsAtMs) ||
      alarm.endsAtMs <= alarm.startsAtMs ||
      (typeof rules.durationMs === "number" && alarm.endsAtMs > rules.durationMs) ||
      !Array.isArray(alarm.frames) ||
      alarm.frames.length === 0
    ) {
      report(path, "警报需要稳定身份、有效来向、半开活跃时段及固定移动帧。");
      continue;
    }
    if (ids.has(alarm.id)) report(`${path}.id`, "警报实例 ID 重复。");
    ids.add(alarm.id);
    let previousTime = -Infinity;
    let previousTileIds: readonly string[] | null = null;
    for (const [frameIndex, frame] of alarm.frames.entries()) {
      if (
        !isRecord(frame) ||
        typeof frame.atMs !== "number" ||
        !Number.isFinite(frame.atMs) ||
        frame.atMs < alarm.startsAtMs ||
        frame.atMs >= alarm.endsAtMs ||
        frame.atMs <= previousTime ||
        (frameIndex === 0 && frame.atMs !== alarm.startsAtMs) ||
        !Array.isArray(frame.tileIds) ||
        frame.tileIds.length === 0 ||
        frame.tileIds.some((id: unknown) => typeof id !== "string" || !tileIds.has(id)) ||
        new Set(frame.tileIds).size !== frame.tileIds.length
      ) {
        report(
          `${path}.frames[${frameIndex}]`,
          "警报帧必须按有效时间严格递增，起帧与出现时间一致，并引用不同的已知格。",
        );
        continue;
      }
      if (previousTileIds) {
        const [dx, dy] = DIRECTION_VECTORS[alarm.approachFrom as RealtimeDirection];
        const expected = previousTileIds.map((id) => {
          const from = tiles.find((tile) => tile.id === id)!;
          return tiles.find((tile) => tile.x === from.x - dx && tile.y === from.y - dy)?.id;
        });
        if (
          expected.length !== frame.tileIds.length ||
          expected.some((id) => id === undefined || !(frame.tileIds as unknown[]).includes(id))
        )
          report(
            `${path}.frames[${frameIndex}]`,
            "每个警报帧必须从所标来向四邻接移动一步，不能跳格或逆向。",
          );
      }
      previousTime = frame.atMs;
      previousTileIds = frame.tileIds as string[];
    }
  }
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
