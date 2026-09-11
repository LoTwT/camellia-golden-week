import type { FeedbackEvent, GameSettings, GameState } from "../core/types.ts";
import type { FirewallDefinition } from "../core/realtime.ts";

export class GameAudio {
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly scheduled = new Set<AudioBufferSourceNode>();
  private lastInvalid = -Infinity;
  private beatKey = "";
  private lastBeatIndex = -1;
  private configuredVolume = -1;
  enabled = false;
  async enable() {
    try {
      this.context ??= new AudioContext();
      if (!this.gain) {
        this.gain = this.context.createGain();
        this.gain.connect(this.context.destination);
      }
      await this.context.resume();
      this.enabled = this.context.state === "running";
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
        ].map(async (id) => {
          if (this.buffers.has(id)) return;
          const response = await fetch(`/assets/audio/${id}.wav`);
          if (!response.ok || !this.context) throw new Error(`声音资源读取失败：${id}`);
          this.buffers.set(id, await this.context.decodeAudioData(await response.arrayBuffer()));
        }),
      );
    } catch {
      this.enabled = false;
    }
    return this.enabled;
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
      this.play(event.kind === "score" ? "pickup" : event.kind);
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
      state.clock.countdownRemainingMs > 0
    ) {
      this.cancelBeats();
      return;
    }
    const key = `${definition.id}:${state.clock.inputEpoch}`;
    if (key !== this.beatKey) {
      this.cancelBeats();
      this.beatKey = key;
      this.lastBeatIndex =
        Math.ceil((state.clock.activeTimeMs - definition.rules.firstBeatMs) / 500) - 1;
    }
    const timestamp = this.context.getOutputTimestamp?.();
    const audioAnchor =
      timestamp?.contextTime !== undefined &&
      timestamp.performanceTime !== undefined &&
      timestamp.contextTime > 0
        ? timestamp.contextTime + (now - timestamp.performanceTime) / 1000
        : this.context.currentTime;
    const nextIndex = Math.max(
      0,
      this.lastBeatIndex + 1,
      Math.ceil((state.clock.activeTimeMs - definition.rules.firstBeatMs) / 500),
    );
    const beatTime = definition.rules.firstBeatMs + nextIndex * 500;
    if (
      beatTime < definition.rules.durationMs &&
      beatTime - state.clock.activeTimeMs <= 100 &&
      beatTime >= state.clock.activeTimeMs
    ) {
      this.play(
        "beat",
        Math.max(
          this.context.currentTime,
          audioAnchor + (beatTime - state.clock.activeTimeMs) / 1000,
        ),
      );
      this.lastBeatIndex = nextIndex;
    }
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
    this.lastBeatIndex = -1;
  }
  dispose() {
    this.cancelBeats();
    void this.context?.close();
  }
}
