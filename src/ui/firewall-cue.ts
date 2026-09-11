import type { ClockState } from "../core/clock.ts";
import type { FirewallDefinition, FirewallState } from "../core/realtime.ts";

export function firewallCue(
  definition: FirewallDefinition,
  active: FirewallState,
  clock: ClockState,
) {
  const rules = definition.rules;
  const intervalMs = 60_000 / rules.bpm;
  const timeMs = clock.activeTimeMs;
  const nearestBeat = Math.round((timeMs - rules.firstBeatMs) / intervalMs);
  const beatMs = rules.firstBeatMs + nearestBeat * intervalMs;
  const totalBeats = rules.beatMasks.length;
  const inWindow =
    nearestBeat >= 0 && nearestBeat < totalBeats && Math.abs(timeMs - beatMs) <= rules.windowMs;
  const phase =
    active.status !== "running" || timeMs >= rules.durationMs
      ? "ended"
      : clock.pauseReasons.length || clock.awaitingResume
        ? "paused"
        : clock.countdownRemainingMs > 0
          ? "preparing"
          : inWindow
            ? active.scoredBeatIndices.includes(nearestBeat)
              ? "hit"
              : "ready"
            : "waiting";
  const labels = {
    ended: "挑战结束",
    paused: "拍点已暂停",
    preparing: "准备跟拍",
    hit: "本拍命中",
    ready: "现在移动",
    waiting: "等待拍点",
  };
  return {
    phase,
    label: labels[phase],
    beatNumber: Math.max(1, Math.min(totalBeats, nearestBeat + 1)),
    totalBeats,
    screenLightOpacity:
      phase === "ready" || phase === "hit"
        ? 1 - (Math.abs(timeMs - beatMs) / rules.windowMs) * 0.65
        : 0,
    cursorPercent: Math.max(0, Math.min(100, 50 + ((timeMs - beatMs) / intervalMs) * 100)),
    windowStartPercent: 50 - (rules.windowMs / intervalMs) * 100,
    windowWidthPercent: (rules.windowMs / intervalMs) * 200,
  };
}
