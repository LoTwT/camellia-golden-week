import type { ClockState } from "./clock.ts";
import type { FirewallState } from "./realtime.ts";

export type FirewallJudgment = "perfect" | "miss" | "hazardHit" | "dodged" | null;

/** Display lifetime only; none of these durations participates in scoring or invulnerability. */
export function firewallFeedback(state: FirewallState, clock: ClockState) {
  const hidden =
    state.status !== "running" ||
    clock.pauseReasons.length > 0 ||
    clock.awaitingResume ||
    clock.countdownRemainingMs > 0;
  const age = (atMs: number | null | undefined) =>
    atMs === null || atMs === undefined ? Infinity : clock.activeTimeMs - atMs;
  const hazardAge = age(state.lastHazardHit?.activeTimeMs);
  const dodgeAge = age(state.lastDodgeAtMs);
  const judgmentAge = age(state.lastJudgment?.activeTimeMs);
  let judgment: FirewallJudgment = null;
  let message = "";
  if (!hidden) {
    if (hazardAge >= 0 && hazardAge < 600 && hazardAge <= dodgeAge && hazardAge <= judgmentAge) {
      judgment = "hazardHit";
      message = `警报命中 · 连击 −${state.lastHazardHit!.penalty}`;
    } else if (dodgeAge >= 0 && dodgeAge < 300 && dodgeAge <= judgmentAge) {
      judgment = "dodged";
      message = "完美闪避";
    } else if (judgmentAge >= 0 && judgmentAge < 220 && state.lastJudgment) {
      judgment = state.lastJudgment.kind;
      message = judgment === "miss" ? "错拍 · 连击 −1" : "PERFECT";
    }
  }
  return {
    judgment,
    message,
    impactOpacity: !hidden && hazardAge >= 0 && hazardAge < 300 ? 1 - hazardAge / 300 : 0,
  };
}
