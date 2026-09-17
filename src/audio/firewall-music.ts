import type { FirewallDefinition } from "../core/realtime.ts";

export const FIREWALL_MUSIC_BPM = 110;
export const FIREWALL_MUSIC_LOOP_BEATS = 32;
export const FIREWALL_MUSIC_IDS = [
  "firewall-music-inner",
  "firewall-music-deep",
  "firewall-music-core",
] as const;
export type FirewallMusicId = (typeof FIREWALL_MUSIC_IDS)[number];

export function firewallMusicId(definition: FirewallDefinition): FirewallMusicId {
  return definition.id.endsWith(".core")
    ? "firewall-music-core"
    : definition.id.endsWith(".deep")
      ? "firewall-music-deep"
      : "firewall-music-inner";
}

export function firewallMusicPlayback(
  definition: FirewallDefinition,
  bufferDurationSeconds: number,
  activeTimeMs: number,
  audibleAudioTime: number,
  currentAudioTime: number,
) {
  if (!Number.isFinite(bufferDurationSeconds) || bufferDurationSeconds <= 0)
    throw new Error("防火墙配乐没有有效时长。");
  const loopDurationSeconds = (FIREWALL_MUSIC_LOOP_BEATS * 60) / definition.rules.bpm;
  const playbackRate = bufferDurationSeconds / loopDurationSeconds;
  const songTimeSeconds = (activeTimeMs - definition.rules.firstBeatMs) / 1000;
  // Output timestamp compensates device latency. A late start seeks ahead instead of replaying beats.
  const atAudioTime = Math.max(
    currentAudioTime + 0.005,
    audibleAudioTime - songTimeSeconds,
    audibleAudioTime,
  );
  const offsetSeconds =
    (Math.max(0, songTimeSeconds + atAudioTime - audibleAudioTime) % loopDurationSeconds) *
    playbackRate;
  return { atAudioTime, offsetSeconds, playbackRate, loopDurationSeconds };
}
