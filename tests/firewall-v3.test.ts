import assert from "node:assert/strict";
import test from "node:test";
import {
  assembleContent,
  assembleV2Content,
  migrationContentReleases,
  realtimeContent,
  v2RealtimeContent,
} from "../src/content/assemble.ts";
import legacyDigests from "./fixtures/legacy-realtime-digests.json" with { type: "json" };
import { v2WorldWitnesses } from "../src/content/witnesses/index.ts";
import { replayWorldWitness } from "../src/content/history/pre-r1/validate.ts";
import type { GameContent as HistoricalContent } from "../src/content/history/pre-r1/types.ts";
import { stablePayload as historicalPayload } from "../src/content/history/pre-r1/save-payload.ts";
import {
  advanceRealtime,
  createRealtime,
  firewallAlarmContacts,
  firewallBeatCount,
  firewallDangerTileIds,
  firewallWarningTileIds,
  replayRealtimeWitness,
  validateRealtimeDefinition,
} from "../src/core/realtime.ts";
import type {
  DirectionalFirewallDefinition,
  FirewallAlarm,
  FirewallState,
  RealtimeFeedback,
  RealtimeInput,
  RealtimeWitness,
} from "../src/core/realtime.ts";
import { gateOpen, supplyProgress } from "../src/core/progress.ts";
import {
  gateOpen as historicalGateOpen,
  supplyProgress as historicalSupplyProgress,
} from "../src/content/history/pre-r1/progress.ts";
import {
  publishedProfileMigrations,
  releaseVersion,
  resolveMigrationPlan,
} from "../src/platform/migrations.ts";
import { validatePayload } from "../src/platform/save-payload.ts";
import { createHash } from "node:crypto";

const template = realtimeContent.definitions.find(
  (item): item is DirectionalFirewallDefinition =>
    item.kind === "firewall" && item.id === "a.firewall.tutorial" && item.ruleVersion === 3,
)!;
const tile = (x: number, y: number) =>
  template.tiles.find((item) => item.x === x && item.y === y)!.id;
function fixture(alarms: readonly FirewallAlarm[] = []): DirectionalFirewallDefinition {
  return {
    ...template,
    id: "test.firewall",
    rules: {
      ...template.rules,
      bpm: 120,
      firstBeatMs: 250,
      durationMs: 10000,
      beatCount: 20,
      comboTarget: 4,
      alarms,
    },
  };
}
function alarm(
  tileIds = [tile(3, 2)],
  approachFrom: FirewallAlarm["approachFrom"] = "right",
): FirewallAlarm {
  return {
    id: "test.alarm",
    startsAtMs: 3000,
    endsAtMs: 4000,
    approachFrom,
    frames: [{ atMs: 3000, tileIds }],
  };
}
function prepared(definition: DirectionalFirewallDefinition): FirewallState {
  let state = createRealtime(definition);
  for (let index = 0; index < 6; index++) {
    const activeTimeMs = 250 + index * 500;
    const result = advanceRealtime(definition, state, activeTimeMs, {
      kind: "move",
      direction: index % 2 === 0 ? "right" : "left",
      sequence: index + 1,
      activeTimeMs,
    });
    assert.ok(result.state.kind === "firewall");
    state = result.state;
  }
  assert.equal(state.combo, 6);
  return state;
}
function movement(
  activeTimeMs: number,
  direction: "up" | "right" | "down" | "left" = "right",
  sequence = 7,
): RealtimeInput {
  return { kind: "move", direction, sequence, activeTimeMs };
}
function firewallState(result: ReturnType<typeof advanceRealtime>): FirewallState {
  assert.ok(result.state.kind === "firewall");
  return result.state;
}

test("原版录像回归：普通格错拍只减 1，保留本轮最高 Combo", () => {
  const definition = realtimeContent.definitions.find((item) => item.id === "a.firewall.tutorial")!;
  assert.equal(definition.kind, "firewall");
  if (definition.kind !== "firewall") return;
  const period = 60_000 / definition.rules.bpm;
  let state = createRealtime(definition);
  for (let index = 0; index < 6; index++) {
    const activeTimeMs = definition.rules.firstBeatMs + index * period;
    state = advanceRealtime(definition, state, activeTimeMs, {
      kind: "move",
      direction: index % 2 === 0 ? "right" : "left",
      sequence: index + 1,
      activeTimeMs,
    }).state as typeof state;
  }
  const activeTimeMs = definition.rules.firstBeatMs + 5 * period + 151;
  const result = advanceRealtime(definition, state, activeTimeMs, {
    kind: "move",
    direction: "right",
    sequence: 7,
    activeTimeMs,
  });
  assert.ok(result.state.kind === "firewall");
  assert.equal(result.state.combo, 5);
  assert.equal(result.state.bestCombo, 6);
});

test("警报错拍接触只扣 5，不清零、不另扣普通 MISS，最高 Combo 保留", () => {
  const definition = fixture([alarm()]);
  const result = advanceRealtime(definition, prepared(definition), 3000, movement(3000));
  assert.equal(firewallState(result).combo, 1);
  assert.equal(firewallState(result).bestCombo, 6);
  assert.deepEqual(
    result.feedback
      .filter((event) => ["hazardHit", "miss", "hit"].includes(event.kind))
      .map((event) => event.kind),
    ["hazardHit"],
  );
});

test("时间推进会命中驻留玩家；连续接触不按 Tick、帧或拍点重复扣分", () => {
  const definition = fixture([alarm([tile(2, 2)])]);
  let result = advanceRealtime(definition, prepared(definition), 3001);
  assert.equal(firewallState(result).combo, 1);
  assert.deepEqual(
    result.feedback
      .filter((event) => event.kind === "hazardHit")
      .map((event) => event.activeTimeMs),
    [3000],
  );
  for (const time of [3001, 3100, 3250, 3500, 3999, 4000, 4001]) {
    result = advanceRealtime(definition, result.state, time);
    assert.equal(firewallState(result).combo, 1);
    assert.equal(
      result.feedback.some((event) => event.kind === "hazardHit"),
      false,
    );
  }
});

test("被动受击不占用尚未输入的拍点，窗内随后移到安全格仍可加 1", () => {
  const wave = {
    ...alarm([tile(2, 2)]),
    startsAtMs: 3250,
    frames: [{ atMs: 3250, tileIds: [tile(2, 2)] }],
  };
  const definition = fixture([wave]);
  const contact = advanceRealtime(definition, prepared(definition), 3251);
  assert.equal(firewallState(contact).combo, 1);
  const escaped = advanceRealtime(definition, contact.state, 3252, movement(3252));
  assert.equal(firewallState(escaped).combo, 2);
  assert.equal(firewallState(escaped).bestCombo, 6);
  assert.equal(
    escaped.feedback.some((event) => event.kind === "hit"),
    true,
  );
  assert.equal(
    escaped.feedback.some((event) => event.kind === "hazardHit"),
    false,
  );
});

test("迎向来袭方向的早/中/晚踩拍均保护到拍点或输入较晚者后 150ms，期满驻留可受击", () => {
  for (const offset of [-150, 0, 150]) {
    const definition = fixture([alarm()]);
    const atMs = 3250 + offset;
    let result = advanceRealtime(definition, prepared(definition), atMs, movement(atMs));
    const expiresAtMs = Math.max(atMs, 3250) + 150;
    assert.equal(firewallState(result).combo, 7);
    assert.equal(firewallState(result).dodge?.untilMs, expiresAtMs);
    assert.equal(firewallState(result).lastDodgeAtMs, atMs);
    assert.equal(result.feedback.filter((event) => event.kind === "dodged").length, 1);
    result = advanceRealtime(definition, result.state, expiresAtMs);
    assert.equal(firewallState(result).combo, 7, "精确边界仍接受同刻输入");
    result = advanceRealtime(definition, result.state, expiresAtMs + 1);
    assert.equal(firewallState(result).combo, 2);
    assert.equal(firewallState(result).lastHazardHit?.activeTimeMs, expiresAtMs);
    assert.equal(firewallState(result).bestCombo, 7);
  }
});

test("普通踩拍不会伪报 DODGE；踩拍向错方向入警报不能取得瞬时最高分", () => {
  const safe = fixture();
  let result = advanceRealtime(safe, prepared(safe), 3250, movement(3250));
  assert.equal(firewallState(result).lastDodgeAtMs, null);
  assert.equal(
    result.feedback.some((event) => event.kind === "dodged"),
    false,
  );
  const dangerous = fixture([alarm([tile(3, 2)], "left")]);
  result = advanceRealtime(dangerous, prepared(dangerous), 3250, movement(3250));
  assert.equal(firewallState(result).combo, 1);
  assert.equal(firewallState(result).bestCombo, 6);
  assert.equal(
    result.feedback.some((event) => ["hit", "dodged"].includes(event.kind)),
    false,
  );
});

test("同拍重复不刷新保护；转向取消旧方向保护，不能借它横穿另一警报", () => {
  const definition = fixture([alarm([tile(3, 2), tile(4, 2)])]);
  let result = advanceRealtime(definition, prepared(definition), 3250, movement(3250));
  result = advanceRealtime(definition, result.state, 3270, movement(3270, "right", 8));
  assert.equal(firewallState(result).dodge?.untilMs, 3400);
  assert.equal(firewallState(result).combo, 7);
  assert.equal(
    result.feedback.some((event) => ["dodged", "hit"].includes(event.kind)),
    false,
  );
  result = advanceRealtime(definition, result.state, 3401);
  assert.equal(firewallState(result).combo, 2);
  const crossed = fixture([alarm(), { ...alarm([tile(3, 1)]), id: "test.second" }]);
  result = advanceRealtime(crossed, prepared(crossed), 3250, movement(3250));
  result = advanceRealtime(crossed, result.state, 3260, movement(3260, "up", 8));
  assert.equal(firewallState(result).dodge, null);
  assert.equal(firewallState(result).combo, 2);
  assert.equal(result.feedback.filter((event) => event.kind === "hazardHit").length, 1);
});

test("闪避后离开重入不能在同拍重开保护；新波次与重入均能再受击", () => {
  const definition = fixture([alarm()]);
  let result = advanceRealtime(definition, prepared(definition), 3250, movement(3250));
  result = advanceRealtime(definition, result.state, 3260, movement(3260, "left", 8));
  result = advanceRealtime(definition, result.state, 3270, movement(3270, "right", 9));
  assert.equal(firewallState(result).combo, 2);
  assert.equal(firewallState(result).dodge, null);
  result = advanceRealtime(definition, result.state, 3280, movement(3280, "left", 10));
  result = advanceRealtime(definition, result.state, 3290, movement(3290, "right", 11));
  assert.equal(result.feedback.filter((event) => event.kind === "hazardHit").length, 1);
  const waves = fixture([
    alarm([tile(2, 2)]),
    {
      ...alarm([tile(2, 2)]),
      id: "test.new-wave",
      startsAtMs: 3500,
      endsAtMs: 4500,
      frames: [{ atMs: 3500, tileIds: [tile(2, 2)] }],
    },
  ]);
  result = advanceRealtime(waves, prepared(waves), 3501);
  assert.deepEqual(
    result.feedback
      .filter((event) => event.kind === "hazardHit")
      .map((event) => event.activeTimeMs),
    [3000, 3500],
  );
});

test("同刻多警报合并一次 -5；无效、重复或同格输入不能吞掉被动接触", () => {
  const alarms = [alarm([tile(2, 2)]), { ...alarm([tile(2, 2)]), id: "test.second" }];
  const definition = fixture(alarms);
  for (const command of [
    { kind: "interact" as const, activeTimeMs: 3000, sequence: 7 },
    { ...movement(3000), repeat: true },
    { kind: "click" as const, tileId: tile(2, 2), activeTimeMs: 3000, sequence: 7 },
  ]) {
    const result = advanceRealtime(definition, prepared(definition), 3000, command);
    assert.equal(firewallState(result).combo, 1);
    assert.deepEqual(
      firewallState(result).lastHazardHit?.alarmIds,
      alarms.map((item) => item.id),
    );
    assert.equal(result.feedback.filter((event) => event.kind === "hazardHit").length, 1);
  }
});

test("精确警报/拍点边界 Tick(t)→Input(t) 与同刻批处理完全一致", () => {
  const wave = {
    ...alarm([tile(2, 2)]),
    startsAtMs: 3250,
    frames: [{ atMs: 3250, tileIds: [tile(2, 2)] }],
  };
  const definition = fixture([wave]);
  const before = prepared(definition);
  const tick = advanceRealtime(definition, before, 3250);
  const after = advanceRealtime(definition, tick.state, 3250, movement(3250));
  const together = advanceRealtime(definition, before, 3250, movement(3250));
  assert.deepEqual(after.state, together.state);
  assert.deepEqual([...tick.feedback, ...after.feedback], together.feedback);
  assert.equal(firewallState(after).combo, 7);
  const replay = advanceRealtime(definition, after.state, 3250, movement(3250));
  assert.deepEqual(replay.state, after.state);
  assert.deepEqual(replay.feedback, []);
});

test("警报与玩家同刻对穿也判接触，正确迎向踩拍可闪避", () => {
  const definition = fixture([
    {
      ...alarm(),
      frames: [
        { atMs: 3000, tileIds: [tile(3, 2)] },
        { atMs: 3250, tileIds: [tile(2, 2)] },
      ],
    },
  ]);
  const result = advanceRealtime(definition, prepared(definition), 3250, movement(3250));
  assert.equal(firewallState(result).combo, 7);
  assert.equal(result.feedback.filter((event) => event.kind === "dodged").length, 1);
  assert.deepEqual(firewallDangerTileIds(definition, 3250), [tile(2, 2)]);
});

test("警报来向与 150ms 预告共用排表，预告不受击、当前危险优先", () => {
  const definition = fixture([alarm()]);
  assert.deepEqual(firewallWarningTileIds(definition, 2849), []);
  assert.deepEqual(firewallWarningTileIds(definition, 2850), [tile(3, 2)]);
  assert.equal(firewallAlarmContacts(definition, 2850)[0]?.approachFrom, "right");
  assert.deepEqual(firewallDangerTileIds(definition, 2850), []);
  const result = advanceRealtime(definition, prepared(definition), 2850, movement(2850));
  assert.equal(
    result.feedback.some((event) => event.kind === "hazardHit"),
    false,
  );
  assert.deepEqual(firewallWarningTileIds(definition, 3000), []);
  assert.deepEqual(firewallDangerTileIds(definition, 3000), [tile(3, 2)]);
  assert.deepEqual(firewallAlarmContacts(definition, 4000), []);
});

test("v3 四档键盘见证都有实际方向闪避，无受击完成 27/82，帧率和分段不改变结果", () => {
  for (const definition of realtimeContent.definitions) {
    if (definition.kind !== "firewall") continue;
    assert.equal(definition.ruleVersion, 3);
    assert.deepEqual(validateRealtimeDefinition(definition), []);
    const witness = (realtimeContent.witnesses as RealtimeWitness[]).find(
      (item) => item.challengeId === definition.id && item.expectedResult === "success",
    )!;
    assert.ok(witness.commands.every((command) => command.kind === "move"));
    const expected = replayRealtimeWitness(definition, witness);
    assert.equal(firewallState(expected).bestCombo, firewallBeatCount(definition));
    assert.ok(expected.feedback.some((event) => event.kind === "dodged"));
    assert.equal(
      expected.feedback.some((event) => event.kind === "hazardHit"),
      false,
    );
    for (const fps of [30, 60, 120]) {
      let state: FirewallState = createRealtime(definition);
      let inputIndex = 0;
      const feedback: RealtimeFeedback[] = [];
      for (let frame = 1; state.status === "running"; frame++) {
        const atMs = Math.min(definition.rules.durationMs, (frame * 1000) / fps);
        const commands: RealtimeInput[] = [];
        while (witness.commands[inputIndex] && witness.commands[inputIndex]!.activeTimeMs <= atMs)
          commands.push(witness.commands[inputIndex++]!);
        const result = advanceRealtime(definition, state, atMs, commands);
        state = firewallState(result);
        feedback.push(...result.feedback);
      }
      assert.deepEqual(state, expected.state, `${definition.id} @ ${fps}fps`);
      assert.deepEqual(feedback, expected.feedback, `${definition.id} @ ${fps}fps events`);
    }
  }
});

test("v2 原发布 JSON 展开后按校验值冻结，v2 五个完整 profile 通过唯一规则升级保留成绩/物资/门禁", () => {
  const source = legacyDigests.files.find((entry) => entry.path.endsWith("/realtime-v2.json"))!;
  assert.equal(
    source.originalSha256,
    "fe746e9e816a88a0956de297014e2ab19c7b3fccd3e883cf65ccfa04d666e353",
  );
  assert.equal(
    createHash("sha256").update(JSON.stringify(v2RealtimeContent)).digest("hex"),
    source.expandedSha256,
  );
  const profiles = ["M1", "M2", "M3", "M4", "M5"] as const;
  for (const [index, profile] of profiles.entries()) {
    const source = assembleV2Content(profile);
    const witness = v2WorldWitnesses.find(
      (item) => item.profileId === profile && item.id.endsWith("full-collection-and-return"),
    )!;
    const played = replayWorldWitness(source as unknown as HistoricalContent, witness);
    assert.deepEqual(played.issues, []);
    const payload = historicalPayload(played.state);
    for (const targetProfile of profiles.slice(index)) {
      const target = assembleContent(targetProfile);
      const registry = publishedProfileMigrations(migrationContentReleases(targetProfile));
      const plan = resolveMigrationPlan(releaseVersion(source), target, registry);
      assert.ok(plan.ok, plan.ok ? "" : plan.error);
      assert.equal(plan.steps[0]?.definition.kind, "rules");
      assert.equal(plan.steps[1]?.definition.kind, "mapped");
      assert.ok(plan.steps.slice(2).every((step) => step.definition.kind === "additive"));
      const migrated = validatePayload(payload, target, registry);
      assert.ok(migrated.ok, migrated.ok ? "" : migrated.error);
      assert.equal(migrated.value.ruleVersion, 4);
      assert.deepEqual(migrated.value.bestResults, payload.bestResults);
      assert.deepEqual(migrated.value.completedObjectiveIds, payload.completedObjectiveIds);
      assert.deepEqual(migrated.value.claimedRewardIds, payload.claimedRewardIds);
      assert.equal(
        supplyProgress(target, migrated.value).collected,
        historicalSupplyProgress(source as unknown as HistoricalContent, payload).collected,
      );
      for (const gate of source.gates)
        assert.equal(
          gateOpen(target, migrated.value, gate.id),
          historicalGateOpen(source as unknown as HistoricalContent, payload, gate.id),
        );
      const repeated = validatePayload(migrated.value, target, registry);
      assert.ok(repeated.ok);
      assert.deepEqual(repeated.value, migrated.value);
    }
  }
});

test("警报排表拒绝重复身份、无效时间、非法格、跳格、反向帧与非整数处罚", () => {
  const valid = fixture([alarm()]);
  assert.deepEqual(validateRealtimeDefinition(valid), []);
  const invalidRules = [
    { ...valid.rules, alarms: [alarm(), alarm()] },
    { ...valid.rules, hazardPenalty: 0.5 },
    { ...valid.rules, offbeatPenalty: 0.5 },
    { ...valid.rules, dodgeWindowMs: Infinity },
    { ...valid.rules, alarms: [{ ...alarm(), endsAtMs: 3000 }] },
    {
      ...valid.rules,
      alarms: [{ ...alarm(), frames: [{ atMs: 3000, tileIds: ["missing.tile"] }] }],
    },
    {
      ...valid.rules,
      alarms: [
        {
          ...alarm(),
          frames: [
            { atMs: 3000, tileIds: [tile(3, 2)] },
            { atMs: 3500, tileIds: [tile(1, 2)] },
          ],
        },
      ],
    },
    {
      ...valid.rules,
      alarms: [
        {
          ...alarm(),
          frames: [
            { atMs: 3000, tileIds: [tile(3, 2)] },
            { atMs: 3500, tileIds: [tile(4, 2)] },
          ],
        },
      ],
    },
  ];
  for (const rules of invalidRules)
    assert.ok(validateRealtimeDefinition({ ...valid, rules }).length > 0);
});

test("v3 截止时先结算，终点输入不补分；过期、倒退和重复序号均不重复事务", () => {
  const definition = fixture();
  const before = prepared(definition);
  const result = advanceRealtime(definition, before, 10000, movement(10000));
  assert.equal(result.result, "success");
  assert.equal(firewallState(result).combo, 6);
  assert.equal(result.state.playerTileId, before.playerTileId);
  assert.equal(result.feedback.filter((event) => event.kind === "success").length, 1);
  for (const time of [10000, 10001, 20000]) {
    const repeated = advanceRealtime(definition, result.state, time, movement(time, "right", 8));
    assert.deepEqual(repeated.state, result.state);
    assert.deepEqual(repeated.feedback, []);
  }
  assert.deepEqual(advanceRealtime(definition, before, 2749).state, before);
  assert.deepEqual(advanceRealtime(definition, before, NaN).state, before);
  assert.equal(
    advanceRealtime(definition, before, 3000, movement(3250)).feedback.some(
      (event) => event.kind === "move",
    ),
    false,
  );
});
