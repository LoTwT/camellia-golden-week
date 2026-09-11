import type { FeedbackEvent, GameSettings, GameState } from "../core/types.ts";
import type { FirewallDefinition } from "../core/realtime.ts";
import { FIREWALL_MUSIC_IDS, firewallMusicId, firewallMusicPlayback } from "./firewall-music.ts";

export class GameAudio {
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly scheduled = new Set<AudioBufferSourceNode>();
  private lastInvalid = -Infinity;
  private beatKey = "";
  private musicTiming:
    | (ReturnType<typeof firewallMusicPlayback> & {
        id: string;
        firstBeatMs: number;
        driftMs: number;
      })
    | null = null;
  private configuredVolume = -1;
  private enableSequence = 0;
  enabled = false;
  async enable() {
    const sequence = ++this.enableSequence;
    try {
      this.context ??= new AudioContext();
      if (!this.gain) {
        this.gain = this.context.createGain();
        this.gain.connect(this.context.destination);
      }
      await this.context.resume();
      if (sequence !== this.enableSequence) return this.enabled;
      await Promise.all(
        [
          "move",
          "invalid",
          "pickup",
          "reveal",
          "amplify",
          "door",
          "success",
          "failure",
          "portal",
          "beat",
          ...FIREWALL_MUSIC_IDS,
        ].map(async (id) => {
          if (this.buffers.has(id)) return;
          const response = await fetch(`/assets/audio/${id}.wav`);
          if (!response.ok || !this.context) throw new Error(`声音资源读取失败：${id}`);
          this.buffers.set(id, await this.context.decodeAudioData(await response.arrayBuffer()));
        }),
      );
      if (sequence === this.enableSequence) this.enabled = this.context.state === "running";
    } catch {
      if (sequence === this.enableSequence) this.enabled = false;
    }
    return this.enabled;
  }
  disable() {
    this.enableSequence += 1;
    this.enabled = false;
    this.cancelBeats();
  }
  configure(settings: GameSettings) {
    const volume = settings.muted ? 0 : settings.masterVolume;
    if (this.gain && this.context && volume !== this.configuredVolume) {
      this.gain.gain.setTargetAtTime(volume, this.context.currentTime, 0.015);
      this.configuredVolume = volume;
    }
  }
  play(id: string, atAudioTime?: number) {
    const context = this.context;
    const buffer = this.buffers.get(id);
    if (!this.enabled || !context || !this.gain || !buffer) return;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gain);
    if (id === "beat") this.scheduled.add(source);
    source.onended = () => {
      this.scheduled.delete(source);
      source.disconnect();
    };
    source.start(atAudioTime ?? context.currentTime);
  }
  feedback(events: FeedbackEvent[], now: number) {
    for (const event of events) {
      if (event.kind === "invalid") {
        if (now - this.lastInvalid < 180) continue;
        this.lastInvalid = now;
      }
      if (event.kind === "reveal" && events.some((item) => item.kind === "move")) continue;
      this.play(event.kind === "score" ? (this.beatKey ? "beat" : "pickup") : event.kind);
    }
  }
  syncFirewall(state: GameState, definition: FirewallDefinition | undefined, now: number) {
    if (
      !this.context ||
      !this.enabled ||
      !definition ||
      state.mode !== "challengeRunning" ||
      state.clock.pauseReasons.length ||
      state.clock.awaitingResume ||
      state.clock.countdownRemainingMs > 0 ||
      state.clock.activeTimeMs >= definition.rules.durationMs
    ) {
      this.cancelBeats();
      return;
    }
    const key = `${definition.id}:${state.clock.inputEpoch}`;
    const timestamp = this.context.getOutputTimestamp?.();
    const audioAnchor =
      timestamp?.contextTime !== undefined &&
      timestamp.performanceTime !== undefined &&
      timestamp.contextTime > 0
        ? timestamp.contextTime + (now - timestamp.performanceTime) / 1000
        : this.context.currentTime;
    if (this.musicTiming && key === this.beatKey) {
      const drift = this.musicDriftMs(audioAnchor, state.clock.activeTimeMs);
      // Device changes can shift the output clock without pausing the game. Ignore small jitter.
      if (Math.abs(drift) > 40) this.cancelBeats();
    }
    if (key !== this.beatKey) {
      this.cancelBeats();
      const id = firewallMusicId(definition);
      const buffer = this.buffers.get(id);
      if (!buffer || !this.gain) throw new Error("防火墙配乐未完成加载。");
      const timing = firewallMusicPlayback(
        definition,
        buffer.duration,
        state.clock.activeTimeMs,
        audioAnchor,
        this.context.currentTime,
      );
      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.loopStart = 0;
      source.loopEnd = buffer.duration;
      source.playbackRate.setValueAtTime(timing.playbackRate, this.context.currentTime);
      source.connect(this.gain);
      this.scheduled.add(source);
      source.onended = () => {
        this.scheduled.delete(source);
        source.disconnect();
      };
      source.start(timing.atAudioTime, timing.offsetSeconds);
      this.beatKey = key;
      this.musicTiming = { ...timing, id, firstBeatMs: definition.rules.firstBeatMs, driftMs: 0 };
    }
    if (this.musicTiming) {
      this.musicTiming.driftMs = this.musicDriftMs(audioAnchor, state.clock.activeTimeMs);
    }
  }
  private musicDriftMs(audioAnchor: number, activeTimeMs: number) {
    const timing = this.musicTiming!;
    const audibleSongTime =
      timing.offsetSeconds / timing.playbackRate + audioAnchor - timing.atAudioTime;
    const expectedSongTime = (activeTimeMs - timing.firstBeatMs) / 1000;
    const loop = timing.loopDurationSeconds;
    return (
      (((((audibleSongTime - expectedSongTime) % loop) + loop * 1.5) % loop) - loop / 2) * 1000
    );
  }
  cancelBeats() {
    for (const source of this.scheduled) {
      try {
        source.stop();
      } catch {
        /* Already ended. */
      }
    }
    this.scheduled.clear();
    this.beatKey = "";
    this.musicTiming = null;
  }
  metrics() {
    return { enabled: this.enabled, music: this.musicTiming ? { ...this.musicTiming } : null };
  }
  dispose() {
    this.disable();
    void this.context?.close();
  }
}
