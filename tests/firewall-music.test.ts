import assert from "node:assert/strict";
import test from "node:test";
import {
  createFirewallMusic,
  FIREWALL_MUSIC_SAMPLE_RATE,
  FIREWALL_MUSIC_SAMPLE_COUNT,
} from "../scripts/firewall-music.ts";
import {
  FIREWALL_MUSIC_IDS,
  firewallMusicPlayback,
  firewallMusicId,
} from "../src/audio/firewall-music.ts";
import { assembleContent } from "../src/content/assemble.ts";

const definitions = assembleContent("M1").realtimeChallenges.filter(
  (definition) => definition.kind === "firewall",
);

test("三首配乐是不同的连续32拍PCM，具有实际声部、确定字节且不削波", () => {
  const tracks = FIREWALL_MUSIC_IDS.map(createFirewallMusic);
  for (const [index, bytes] of tracks.entries()) {
    assert.deepEqual(bytes, createFirewallMusic(FIREWALL_MUSIC_IDS[index]!));
    assert.equal(bytes.readUInt32LE(24), 44100);
    assert.equal(bytes.readUInt32LE(40) / 2, FIREWALL_MUSIC_SAMPLE_COUNT);
    assert.equal(bytes.readInt16LE(44), 0);
    assert.equal(bytes.readInt16LE(bytes.length - 2), 0);
    let energy = 0;
    let peak = 0;
    for (let offset = 44; offset < bytes.length; offset += 2) {
      const sample = bytes.readInt16LE(offset);
      energy += sample ** 2;
      peak = Math.max(peak, Math.abs(sample));
    }
    assert.ok(peak > 15000 && peak < 32767);
    assert.ok(Math.sqrt(energy / FIREWALL_MUSIC_SAMPLE_COUNT) > 3000);
  }
  assert.notDeepEqual(tracks[0], tracks[1]);
  assert.notDeepEqual(tracks[1], tracks[2]);
});

test("音乐首拍、循环后与延迟启用均映射到同一权威拍表，并补偿输出延迟", () => {
  const bufferDuration = FIREWALL_MUSIC_SAMPLE_COUNT / FIREWALL_MUSIC_SAMPLE_RATE;
  for (const definition of definitions) {
    const period = 60000 / definition.rules.bpm;
    const first = firewallMusicPlayback(definition, bufferDuration, 0, 9.92, 10);
    assert.ok(Math.abs(first.atAudioTime - (9.92 + definition.rules.firstBeatMs / 1000)) < 1e-9);
    assert.ok(first.offsetSeconds < 1e-9);
    for (const beat of [0, 1, 31, 32, 65, 80]) {
      const time = definition.rules.firstBeatMs + beat * period;
      const plan = firewallMusicPlayback(definition, bufferDuration, time, 9.92, 10);
      assert.equal(plan.atAudioTime, 10.005);
      const audibleAtStart = plan.offsetSeconds / plan.playbackRate;
      const expected =
        ((time - definition.rules.firstBeatMs) / 1000 + 0.085) % plan.loopDurationSeconds;
      assert.ok(Math.abs(audibleAtStart - expected) < 1e-9);
      assert.ok(Math.abs(bufferDuration / plan.playbackRate - (32 * period) / 1000) < 1e-9);
    }
  }
  assert.deepEqual(definitions.map(firewallMusicId), [
    FIREWALL_MUSIC_IDS[0],
    ...FIREWALL_MUSIC_IDS,
  ]);
});
