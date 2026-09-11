export type PauseReason = "manual" | "hidden" | "blur" | "clockGap" | "graphicsLost";

export interface ClockState {
  readonly activeTimeMs: number;
  readonly lastMonotonicTimeMs: number;
  readonly pauseReasons: readonly PauseReason[];
  readonly awaitingResume: boolean;
  readonly countdownRemainingMs: number;
  readonly realtime: boolean;
  readonly inputEpoch: number;
}

export interface ClockFeedback {
  readonly kind: "paused" | "resumeBlocked" | "resumed" | "countdownFinished" | "invalidTime";
  readonly reason?: PauseReason;
}

export interface ClockAdvance {
  readonly state: ClockState;
  readonly activeDeltaMs: number;
  readonly clearInputs: boolean;
  readonly feedback: readonly ClockFeedback[];
}

export interface ClockResumeConditions {
  readonly pageVisible: boolean;
  readonly canvasOperable: boolean;
  readonly graphicsAvailable: boolean;
}

export const CLOCK_GAP_LIMIT_MS = 250;
export const REALTIME_RESUME_COUNTDOWN_MS = 3_000;

const PAUSE_ORDER: readonly PauseReason[] = [
  "manual",
  "hidden",
  "blur",
  "clockGap",
  "graphicsLost",
];

export function createClock(
  monotonicTimeMs = 0,
  options: { readonly realtime?: boolean; readonly preparationMs?: number } = {},
): ClockState {
  if (!Number.isFinite(monotonicTimeMs) || monotonicTimeMs < 0) {
    throw new RangeError("单调时间必须为有限非负毫秒。");
  }
  const preparationMs = options.preparationMs ?? 0;
  if (!Number.isFinite(preparationMs) || preparationMs < 0) {
    throw new RangeError("准备时间必须为有限非负毫秒。");
  }
  return {
    activeTimeMs: 0,
    lastMonotonicTimeMs: monotonicTimeMs,
    pauseReasons: [],
    awaitingResume: false,
    countdownRemainingMs: preparationMs,
    realtime: options.realtime ?? false,
    inputEpoch: 0,
  };
}

export function clockAcceptsInput(state: ClockState): boolean {
  return (
    state.pauseReasons.length === 0 && !state.awaitingResume && state.countdownRemainingMs === 0
  );
}

export function advanceClock(state: ClockState, monotonicTimeMs: number): ClockAdvance {
  if (!Number.isFinite(monotonicTimeMs) || monotonicTimeMs < state.lastMonotonicTimeMs) {
    return { state, activeDeltaMs: 0, clearInputs: false, feedback: [{ kind: "invalidTime" }] };
  }
  const elapsedMs = monotonicTimeMs - state.lastMonotonicTimeMs;
  if (elapsedMs === 0) return { state, activeDeltaMs: 0, clearInputs: false, feedback: [] };

  if (state.pauseReasons.length > 0 || state.awaitingResume) {
    return {
      state: { ...state, lastMonotonicTimeMs: monotonicTimeMs },
      activeDeltaMs: 0,
      clearInputs: false,
      feedback: [],
    };
  }
  if (elapsedMs > CLOCK_GAP_LIMIT_MS) {
    return {
      state: {
        ...state,
        lastMonotonicTimeMs: monotonicTimeMs,
        pauseReasons: ["clockGap"],
        awaitingResume: true,
        inputEpoch: state.inputEpoch + 1,
      },
      activeDeltaMs: 0,
      clearInputs: true,
      feedback: [{ kind: "paused", reason: "clockGap" }],
    };
  }

  const preparationElapsedMs = Math.min(elapsedMs, state.countdownRemainingMs);
  const activeDeltaMs = elapsedMs - preparationElapsedMs;
  const countdownRemainingMs = state.countdownRemainingMs - preparationElapsedMs;
  const countdownFinished = state.countdownRemainingMs > 0 && countdownRemainingMs === 0;
  return {
    state: {
      ...state,
      activeTimeMs: state.activeTimeMs + activeDeltaMs,
      lastMonotonicTimeMs: monotonicTimeMs,
      countdownRemainingMs,
      inputEpoch: state.inputEpoch + (countdownFinished ? 1 : 0),
    },
    activeDeltaMs,
    clearInputs: countdownFinished,
    feedback: countdownFinished ? [{ kind: "countdownFinished" }] : [],
  };
}

export function setClockPauseReason(
  state: ClockState,
  reason: PauseReason,
  present: boolean,
  monotonicTimeMs: number,
): ClockAdvance {
  if (!PAUSE_ORDER.includes(reason)) throw new TypeError("未知暂停原因。");
  const advanced = advanceClock(state, monotonicTimeMs);
  if (advanced.feedback.some((event) => event.kind === "invalidTime")) return advanced;
  const current = advanced.state;
  const alreadyPresent = current.pauseReasons.includes(reason);
  if (alreadyPresent === present) return advanced;

  const pauseReasons = PAUSE_ORDER.filter((candidate) =>
    candidate === reason ? present : current.pauseReasons.includes(candidate),
  );
  return {
    state: {
      ...current,
      pauseReasons,
      awaitingResume: present || current.awaitingResume,
      inputEpoch: current.inputEpoch + (present ? 1 : 0),
    },
    activeDeltaMs: advanced.activeDeltaMs,
    clearInputs: present || advanced.clearInputs,
    feedback: present ? [...advanced.feedback, { kind: "paused", reason }] : advanced.feedback,
  };
}

export function resumeClock(
  state: ClockState,
  monotonicTimeMs: number,
  conditions: ClockResumeConditions,
): ClockAdvance {
  if (!Number.isFinite(monotonicTimeMs) || monotonicTimeMs < state.lastMonotonicTimeMs) {
    return { state, activeDeltaMs: 0, clearInputs: false, feedback: [{ kind: "invalidTime" }] };
  }
  const systemReasons = state.pauseReasons.filter(
    (reason) => reason !== "manual" && reason !== "clockGap",
  );
  if (
    !conditions.pageVisible ||
    !conditions.canvasOperable ||
    !conditions.graphicsAvailable ||
    systemReasons.length > 0
  ) {
    return {
      state: { ...state, lastMonotonicTimeMs: monotonicTimeMs },
      activeDeltaMs: 0,
      clearInputs: false,
      feedback: [{ kind: "resumeBlocked" }],
    };
  }
  if (!state.awaitingResume && state.pauseReasons.length === 0) {
    return { state, activeDeltaMs: 0, clearInputs: false, feedback: [] };
  }
  return {
    state: {
      ...state,
      lastMonotonicTimeMs: monotonicTimeMs,
      pauseReasons: [],
      awaitingResume: false,
      countdownRemainingMs: state.realtime ? REALTIME_RESUME_COUNTDOWN_MS : 0,
      inputEpoch: state.inputEpoch + 1,
    },
    activeDeltaMs: 0,
    clearInputs: true,
    feedback: [{ kind: "resumed" }],
  };
}
