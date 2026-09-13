import type { GameState } from "../core/types.ts";

export function boardProjectionKey(state: GameState): string {
  const presentationIntervalMs = state.activeRealtime?.state.kind === "firewall" ? 16 : 500;
  const { inputEpoch, pauseReasons, awaitingResume, countdownRemainingMs } = state.clock;
  return `${state.stateRevision}:${state.playerPosition.tileId}:${state.mode}:${state.phase}:${state.activeRealtime?.state.eventSequence ?? 0}:${Math.floor(state.clock.activeTimeMs / presentationIntervalMs)}:${inputEpoch}:${pauseReasons.length > 0}:${awaitingResume}:${countdownRemainingMs > 0}:${JSON.stringify(state.settings)}`;
}
