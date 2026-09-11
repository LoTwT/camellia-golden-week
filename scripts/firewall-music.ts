import { Buffer } from "node:buffer";
import {
  FIREWALL_MUSIC_BPM,
  FIREWALL_MUSIC_LOOP_BEATS,
  FIREWALL_MUSIC_IDS,
} from "../src/audio/firewall-music.ts";
import type { FirewallMusicId } from "../src/audio/firewall-music.ts";
export { FIREWALL_MUSIC_BPM, FIREWALL_MUSIC_LOOP_BEATS, FIREWALL_MUSIC_IDS };
export type { FirewallMusicId };
export const FIREWALL_MUSIC_SAMPLE_RATE = 44_100;
export const FIREWALL_MUSIC_SAMPLE_COUNT = Math.round(
  (FIREWALL_MUSIC_SAMPLE_RATE * FIREWALL_MUSIC_LOOP_BEATS * 60) / FIREWALL_MUSIC_BPM,
);
const secondsPerBeat = 60 / FIREWALL_MUSIC_BPM;
const tau = Math.PI * 2;

interface Chord {
  bass: number;
  notes: readonly number[];
}

const progression: readonly Chord[] = [
  { bass: 38, notes: [62, 65, 69, 72] },
  { bass: 38, notes: [62, 65, 69, 72] },
  { bass: 34, notes: [62, 65, 69, 70] },
  { bass: 34, notes: [62, 65, 69, 70] },
  { bass: 41, notes: [60, 64, 65, 69] },
  { bass: 41, notes: [60, 64, 65, 69] },
  { bass: 36, notes: [60, 62, 67, 70] },
  { bass: 36, notes: [60, 62, 67, 70] },
];

function frequency(midiNote: number): number {
  return 440 * 2 ** ((midiNote - 69) / 12);
}

function createNoise(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x8000_0000 - 1;
  };
}

function envelope(time: number, duration: number, attack: number, decay: number): number {
  const opening = Math.min(1, time / attack);
  const closing = Math.min(1, Math.max(0, (duration - time) / 0.018));
  return opening * closing * Math.exp(-time / decay);
}

function addVoice(
  mix: Float64Array,
  beat: number,
  duration: number,
  gain: number,
  sample: (time: number) => number,
): void {
  const start = Math.round(beat * secondsPerBeat * FIREWALL_MUSIC_SAMPLE_RATE);
  const count = Math.ceil(duration * FIREWALL_MUSIC_SAMPLE_RATE);
  for (let frame = 0; frame < count; frame += 1) {
    const destination = (start + frame) % mix.length;
    mix[destination] = mix[destination]! + sample(frame / FIREWALL_MUSIC_SAMPLE_RATE) * gain;
  }
}

function addKick(mix: Float64Array, beat: number, gain: number, noise: () => number): void {
  const duration = 0.3;
  addVoice(mix, beat, duration, gain, (time) => {
    const phase = tau * (49 * time + 92 * 0.025 * (1 - Math.exp(-time / 0.025)));
    const body = Math.sin(phase) * Math.exp(-time / 0.095);
    const click = noise() * Math.exp(-time / 0.006) * 0.055;
    return (body + click) * Math.min(1, time / 0.0015) * Math.min(1, (duration - time) / 0.02);
  });
}

function addSnare(mix: Float64Array, beat: number, gain: number, noise: () => number): void {
  let lowpass = 0;
  const duration = 0.19;
  addVoice(mix, beat, duration, gain, (time) => {
    const white = noise();
    lowpass += (white - lowpass) * 0.16;
    const rattle = (white - lowpass) * Math.exp(-time / 0.045);
    const body = (Math.sin(tau * 185 * time) + 0.3 * Math.sin(tau * 330 * time)) * 0.26;
    return (rattle + body * Math.exp(-time / 0.038)) * envelope(time, duration, 0.001, 0.14);
  });
}

function addHat(
  mix: Float64Array,
  beat: number,
  gain: number,
  open: boolean,
  noise: () => number,
): void {
  let lowpass = 0;
  const duration = open ? 0.21 : 0.07;
  addVoice(mix, beat, duration, gain, (time) => {
    const white = noise();
    lowpass += (white - lowpass) * 0.55;
    const metal = Math.sin(tau * 6230 * time) * Math.sin(tau * 4110 * time);
    return (
      (white - lowpass + metal * 0.09) * envelope(time, duration, 0.0008, open ? 0.055 : 0.018)
    );
  });
}

function addBass(mix: Float64Array, beat: number, midiNote: number, gain: number): void {
  const fundamental = frequency(midiNote);
  const duration = secondsPerBeat * 0.43;
  addVoice(mix, beat, duration, gain, (time) => {
    const phase = tau * fundamental * time;
    const upper = Math.exp(-time / 0.065);
    const voice =
      Math.sin(phase) + upper * (0.27 * Math.sin(2 * phase) + 0.13 * Math.sin(3 * phase));
    return voice * envelope(time, duration, 0.006, 0.16);
  });
}

function addChord(mix: Float64Array, beat: number, notes: readonly number[], gain: number): void {
  const duration = secondsPerBeat * 0.64;
  for (const midiNote of notes) {
    const fundamental = frequency(midiNote);
    addVoice(mix, beat, duration, gain / Math.sqrt(notes.length), (time) => {
      const phase = tau * fundamental * time;
      const voice =
        Math.sin(phase) +
        Math.sin(phase * 1.002) * 0.3 +
        Math.sin(phase * 2) * Math.exp(-time / 0.045) * 0.21;
      return voice * envelope(time, duration, 0.009, 0.11);
    });
  }
}

function addArpeggio(mix: Float64Array, beat: number, midiNote: number, gain: number): void {
  const fundamental = frequency(midiNote);
  const duration = secondsPerBeat * 0.38;
  addVoice(mix, beat, duration, gain, (time) => {
    const phase = tau * fundamental * time;
    const voice = Math.sin(phase + Math.sin(phase * 2) * Math.exp(-time / 0.035) * 1.2);
    return voice * envelope(time, duration, 0.004, 0.06);
  });
}

function encodeWave(mix: Float64Array): Buffer {
  const mean = mix.reduce((sum, sample) => sum + sample, 0) / mix.length;
  const edgeFrames = Math.round(FIREWALL_MUSIC_SAMPLE_RATE * 0.008);
  let peak = 0;
  for (let frame = 0; frame < mix.length; frame += 1) {
    const edge = Math.min(1, frame / edgeFrames, (mix.length - 1 - frame) / edgeFrames);
    const fade = 0.5 - Math.cos(Math.PI * edge) * 0.5;
    const sample = Math.tanh((mix[frame]! - mean) * 1.15) * fade;
    mix[frame] = sample;
    peak = Math.max(peak, Math.abs(sample));
  }
  if (!Number.isFinite(peak) || peak === 0) throw new Error("Invalid firewall music mix");

  const pcmBytes = mix.length * 2;
  const wave = Buffer.alloc(44 + pcmBytes);
  wave.write("RIFF", 0);
  wave.writeUInt32LE(36 + pcmBytes, 4);
  wave.write("WAVEfmt ", 8);
  wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20);
  wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(FIREWALL_MUSIC_SAMPLE_RATE, 24);
  wave.writeUInt32LE(FIREWALL_MUSIC_SAMPLE_RATE * 2, 28);
  wave.writeUInt16LE(2, 32);
  wave.writeUInt16LE(16, 34);
  wave.write("data", 36);
  wave.writeUInt32LE(pcmBytes, 40);
  const gain = (0.66 * 32_767) / peak;
  for (let frame = 0; frame < mix.length; frame += 1) {
    wave.writeInt16LE(Math.round(mix[frame]! * gain), 44 + frame * 2);
  }
  return wave;
}

/** Original synthetic score; no recordings, samples, or melody from the game are used. */
export function createFirewallMusic(id: FirewallMusicId): Buffer {
  const density = FIREWALL_MUSIC_IDS.indexOf(id);
  if (density < 0) throw new Error(`Unknown firewall music: ${id}`);
  const mix = new Float64Array(FIREWALL_MUSIC_SAMPLE_COUNT);
  const noise = createNoise(0x43ab_791d + density * 0x1021);

  for (let beat = 0; beat < FIREWALL_MUSIC_LOOP_BEATS; beat += 1) {
    addKick(mix, beat, beat % 4 === 0 ? 0.6 : 0.53, noise);
    if (beat % 2 === 1) addSnare(mix, beat, 0.29 + density * 0.025, noise);
    addHat(mix, beat, 0.065, false, noise);
    addHat(mix, beat + 0.5, 0.11, beat % 4 === 3, noise);
    if (density > 0 && beat % 2 === 1) addHat(mix, beat + 0.75, 0.048, false, noise);
    if (density === 2) addHat(mix, beat + 0.25, 0.039, false, noise);
  }

  for (const [bar, chord] of progression.entries()) {
    const firstBeat = bar * 4;
    const bassBeats = density === 0 ? [0, 1.5, 2, 3.5] : [0, 0.75, 1.5, 2, 2.75, 3.5];
    for (const [index, beat] of bassBeats.entries()) {
      const interval = index === bassBeats.length - 1 ? 7 : index % 3 === 1 ? 12 : 0;
      addBass(mix, firstBeat + beat, chord.bass + interval, 0.25);
    }
    const chordBeats = density === 0 ? [0.5, 2.5] : [0.5, 1.75, 2.5, 3.75];
    for (const beat of chordBeats) addChord(mix, firstBeat + beat, chord.notes, 0.115);
    if (density > 0) {
      const arpeggioBeats =
        density === 1 ? [0.75, 1.75, 2.75] : [0.25, 0.75, 1.25, 1.75, 2.25, 2.75, 3.25, 3.75];
      const arpeggioNotes = [0, 2, 1, 3, 2, 0, 3, 1];
      for (const [index, beat] of arpeggioBeats.entries()) {
        const noteIndex = arpeggioNotes[(index + (bar % 2)) % arpeggioNotes.length]!;
        addArpeggio(mix, firstBeat + beat, chord.notes[noteIndex]! + 12, 0.085);
      }
    }
    if (density === 2 && bar % 4 === 3) {
      for (const beat of [3.25, 3.5, 3.75]) addSnare(mix, firstBeat + beat, 0.085, noise);
    }
  }
  return encodeWave(mix);
}
