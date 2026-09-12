import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assembleContent,
  assembleLegacyContent,
  assembleV2Content,
  legacyRealtimeContent,
  migrationContentReleases,
  v2RealtimeContent,
} from "../src/content/assemble.ts";
import oldM1 from "../src/content/witnesses/m1.json" with { type: "json" };
import { worldWitnesses, v2WorldWitnesses } from "../src/content/witnesses/index.ts";
import {
  replayWorldWitness as historicalReplay,
  validateContent as historicalValidate,
} from "../src/content/history/pre-r1/validate.ts";
import type { GameContent as HistoricalContent } from "../src/content/history/pre-r1/types.ts";
import type { WorldWitness } from "../src/content/validate.ts";
import { createGame, dispatch } from "../src/core/engine.ts";
import { gateOpen, supplyProgress } from "../src/core/progress.ts";
import {
  advanceRealtime,
  createRealtime,
  firewallDangerTileIds,
  firewallWarningTileIds,
  replayRealtimeWitness,
  validateRealtimeDefinition,
} from "../src/core/realtime.ts";
import type {
  LegacyFirewallDefinition as FirewallDefinition,
  RealtimeFeedback,
  RealtimeInput,
  RealtimeWitness,
} from "../src/core/realtime.ts";
import type { GameCommand, GameContent, ProfileId } from "../src/core/types.ts";
import {
  additiveProfileMigrations,
  publishedProfileMigrations,
  releaseVersion,
  resolveMigrationPlan,
} from "../src/platform/migrations.ts";
import { restorePayload, stablePayload, validatePayload } from "../src/platform/save-payload.ts";
import type { SavePayload } from "../src/platform/save-payload.ts";
import { createSaveStore, SAVE_KEYS } from "../src/platform/save-store.ts";
import type { SaveEnvelope, SaveStorage } from "../src/platform/save-store.ts";
import { contentModuleSource } from "../scripts/content-module.ts";

const profiles = ["M1", "M2", "M3", "M4", "M5"] as const;
const firewalls = v2RealtimeContent.definitions.filter(
  (definition): definition is FirewallDefinition =>
    definition.kind === "firewall" && definition.ruleVersion === 2,
);
const savedAt = "2026-09-11T18:00:00.000Z";

function playToFirewall(content: GameContent, challengeId = "a.firewall.core") {
  const witnesses =
    content.ruleVersion === 1
      ? (oldM1.witnesses as WorldWitness[])
      : content.ruleVersion === 2
        ? v2WorldWitnesses
        : worldWitnesses;
  const witness = witnesses.find((item) => item.id === "m1.world.full-collection-and-return")!;
  let state = createGame(content);
  let now = 0;
  for (const step of witness.steps) {
    const result = dispatch(content, state, step.command, step.atMs, savedAt);
    state = result.state;
    now = step.atMs;
    assert.equal(result.code, step.expectedCode);
    if (step.command.kind === "StartChallenge" && step.command.challengeId === challengeId) break;
  }
  assert.equal(state.activeRealtime?.roomId, challengeId);
  return {
    get state() {
      return state;
    },
    wait(milliseconds: number) {
      const end = now + milliseconds;
      while (now < end) {
        now = Math.min(end, now + 100);
        state = dispatch(content, state, { kind: "Tick" }, now, savedAt).state;
        assert.equal(state.clock.awaitingResume, false);
      }
    },
    send(command: GameCommand) {
      const result = dispatch(content, state, command, now, savedAt);
      state = result.state;
      return result;
    },
  };
}

test("v2 防火墙固定 5×4 / 110 BPM，27/82 拍均有完整窗口，奖励目标保持", () => {
  assert.equal(firewalls.length, 4);
  for (const [index, definition] of firewalls.entries()) {
    assert.equal(definition.tiles.length, 20);
    assert.deepEqual(new Set(definition.tiles.map((tile) => tile.y)), new Set([0, 1, 2, 3]));
    assert.equal(definition.ruleVersion, 2);
    assert.equal(definition.rules.bpm, 110);
    assert.equal(definition.rules.firstBeatMs, 60_000 / 110 / 2);
    assert.equal(definition.rules.windowMs, 150);
    assert.equal(definition.rules.beatMasks.length, index === 0 ? 27 : 82);
    assert.equal(definition.rules.comboTarget, [12, 40, 55, 70][index]);
    assert.deepEqual(validateRealtimeDefinition(definition), []);
  }
  for (const definition of v2RealtimeContent.definitions) assert.equal(definition.ruleVersion, 2);
  for (const profile of profiles) {
    const content = assembleV2Content(profile);
    assert.equal(content.contentVersion, Math.min(Number(profile.slice(1)), 4) + 1);
    assert.equal(content.ruleVersion, 2);
    assert.deepEqual(historicalValidate(content as unknown as HistoricalContent), []);
  }
});

test("v2 每档首末拍 ±150ms 端点有效，窗外 1ms 无分；每拍只计一次", () => {
  for (const definition of firewalls) {
    const beatTimes = [
      definition.rules.firstBeatMs,
      definition.rules.firstBeatMs + (definition.rules.beatMasks.length - 1) * (60_000 / 110),
    ];
    for (const beatMs of beatTimes) {
      for (const [offset, expected] of [
        [-151, 0],
        [-150, 1],
        [150, 1],
        [151, 0],
      ] as const) {
        const activeTimeMs = beatMs + offset;
        const result = advanceRealtime(definition, createRealtime(definition), activeTimeMs, {
          kind: "move",
          direction: "right",
          sequence: 1,
          activeTimeMs,
        });
        assert.ok(result.state.kind === "firewall");
        assert.equal(result.state.combo, expected, `${definition.id} @ ${activeTimeMs}`);
      }
    }
    const activeTimeMs = definition.rules.firstBeatMs;
    const result = advanceRealtime(definition, createRealtime(definition), activeTimeMs, [
      { kind: "move", direction: "right", sequence: 1, activeTimeMs },
      { kind: "move", direction: "left", sequence: 2, activeTimeMs },
    ]);
    assert.ok(result.state.kind === "firewall");
    assert.equal(result.state.combo, 1);
    assert.equal(result.feedback.filter((event) => event.kind === "hit").length, 1);
  }
});

test("v2 内容校验拒绝深层或核心沿用旧棋盘的危险格数量上限", () => {
  for (const [id, oversizedCount] of [
    ["a.firewall.deep", 9],
    ["a.firewall.core", 13],
  ] as const) {
    const definition = firewalls.find((item) => item.id === id)!;
    const oversized = {
      ...definition,
      rules: {
        ...definition.rules,
        beatMasks: [
          definition.tiles.slice(0, oversizedCount).map((tile) => tile.id),
          ...definition.rules.beatMasks.slice(1),
        ],
      },
    };
    assert.ok(
      validateRealtimeDefinition(oversized).some(
        (issue) => issue.path === "rules.beatMasks" && issue.message.includes("上限"),
      ),
    );
  }
});

test("v2 全拍正常交替移动可达 27/82，输入终点不能补分，结算幂等", () => {
  for (const definition of firewalls) {
    const inputs = definition.rules.beatMasks.map((_, index) => ({
      kind: "move" as const,
      direction: index % 2 === 0 ? ("right" as const) : ("left" as const),
      sequence: index + 1,
      activeTimeMs: definition.rules.firstBeatMs + index * (60_000 / definition.rules.bpm),
    }));
    const result = advanceRealtime(
      definition,
      createRealtime(definition),
      definition.rules.durationMs,
      inputs,
    );
    assert.equal(result.result, "success");
    assert.ok(result.state.kind === "firewall");
    assert.equal(result.state.bestCombo, definition.rules.beatMasks.length);
    const again = advanceRealtime(definition, result.state, definition.rules.durationMs + 1, {
      kind: "move",
      direction: "right",
      sequence: 100,
      activeTimeMs: definition.rules.durationMs,
    });
    assert.deepEqual(again.state, result.state);
    assert.deepEqual(again.feedback, []);
  }
});

test("PERFECT/MISS 只由一次真实规则判定产生；同拍重复、按住、越界不刷新", () => {
  const definition = firewalls[0]!;
  let state = createRealtime(definition);
  assert.equal(state.lastJudgment, null);
  const beat = Math.round(definition.rules.firstBeatMs);
  const commands = [
    { kind: "move" as const, direction: "right" as const, sequence: 1, activeTimeMs: beat },
    { kind: "move" as const, direction: "left" as const, sequence: 2, activeTimeMs: beat + 10 },
    {
      kind: "move" as const,
      direction: "right" as const,
      sequence: 3,
      activeTimeMs: beat + 20,
      repeat: true,
    },
    { kind: "click" as const, tileId: "missing.tile", sequence: 4, activeTimeMs: beat + 30 },
  ];
  for (const command of commands) {
    const result = advanceRealtime(definition, state, command.activeTimeMs, command);
    assert.ok(result.state.kind === "firewall");
    state = result.state;
    assert.deepEqual(state.lastJudgment, { kind: "perfect", activeTimeMs: beat });
  }
  const result = advanceRealtime(definition, state, 500, {
    kind: "move",
    direction: "right",
    sequence: 5,
    activeTimeMs: 500,
  });
  assert.ok(result.state.kind === "firewall");
  assert.deepEqual(result.state.lastJudgment, { kind: "miss", activeTimeMs: 500 });
});

test("危险预告提前 150ms，当前危险优先；预告本身不会触发危险判定", () => {
  const definition = firewalls[1]!;
  const boundary = 4 * (60_000 / definition.rules.bpm);
  assert.deepEqual(firewallWarningTileIds(definition, boundary - 151), []);
  assert.ok(firewallWarningTileIds(definition, boundary - 150).length > 0);
  const warning = firewallWarningTileIds(definition, boundary - 149);
  assert.ok(warning.length > 0);
  const current = firewallDangerTileIds(definition, boundary - 149);
  assert.equal(
    warning.some((tile) => current.includes(tile)),
    false,
  );
  assert.ok(
    warning.every((tile) => firewallDangerTileIds(definition, boundary + 1).includes(tile)),
  );
  assert.deepEqual(firewallWarningTileIds(definition, boundary), []);
  for (const time of [-1, NaN, Infinity, definition.rules.durationMs])
    assert.deepEqual(firewallWarningTileIds(definition, time), []);
  assert.deepEqual(
    firewallDangerTileIds(definition, definition.rules.durationMs - 1),
    definition.rules.beatMasks.at(-1),
    "末组危险在没有下一组时保留至结算",
  );
  assert.deepEqual(firewallDangerTileIds(definition, definition.rules.durationMs), []);
});

test("v1 原始实时定义保留 25 格、120 BPM、30/90 拍，历史文件按发布校验值冻结", () => {
  const bytes = readFileSync(new URL("../src/content/history/realtime-v1.json", import.meta.url));
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    "3600214a533fffc2152184ba99d30d008d36584bb73778c85745638915249edf",
  );
  for (const definition of legacyRealtimeContent.definitions) {
    assert.deepEqual(validateRealtimeDefinition(definition), []);
    assert.equal(definition.ruleVersion, 1);
    if (definition.kind !== "firewall") continue;
    assert.equal(definition.tiles.length, 25);
    assert.equal(definition.rules.bpm, 120);
    assert.equal(definition.rules.beatMasks.length, definition.id.endsWith("tutorial") ? 30 : 90);
  }
});

test("v2 十条世界见证与十八条实时见证公开命令重放均保持目标与完整物资账本", () => {
  for (const witness of v2WorldWitnesses) {
    const result = historicalReplay(
      assembleV2Content(witness.profileId) as unknown as HistoricalContent,
      witness,
    );
    assert.deepEqual(result.issues, [], witness.id);
  }
  for (const witness of v2RealtimeContent.witnesses as RealtimeWitness[]) {
    const release = assembleV2Content(witness.profileId as ProfileId);
    assert.equal(witness.contentVersion, release.contentVersion);
    assert.equal(witness.ruleVersion, release.ruleVersion);
    const definition = v2RealtimeContent.definitions.find(
      (candidate) => candidate.id === witness.challengeId,
    )!;
    const result = replayRealtimeWitness(definition, witness);
    assert.equal(result.result, witness.expectedResult);
    for (const [key, expected] of Object.entries(witness.expectedFinalState))
      assert.deepEqual((result.state as unknown as Record<string, unknown>)[key], expected);
  }
});

test("v2 非整数节拍在 30/60/120fps 下判定、提示事件与结算完全相同", () => {
  for (const definition of firewalls) {
    for (const witness of (v2RealtimeContent.witnesses as RealtimeWitness[]).filter(
      (item) => item.challengeId === definition.id,
    )) {
      const expected = replayRealtimeWitness(definition, witness);
      for (const fps of [30, 60, 120]) {
        let state = createRealtime(definition);
        let inputIndex = 0;
        const feedback: RealtimeFeedback[] = [];
        for (let frame = 0; state.status === "running"; frame++) {
          const atMs = Math.min(definition.rules.durationMs, (frame * 1000) / fps);
          const inputs: RealtimeInput[] = [];
          while ((witness.commands[inputIndex]?.activeTimeMs ?? Infinity) <= atMs)
            inputs.push(witness.commands[inputIndex++]!);
          const result = advanceRealtime(definition, state, atMs, inputs);
          assert.ok(result.state.kind === "firewall");
          state = result.state;
          feedback.push(...result.feedback);
          if (atMs === definition.rules.durationMs) break;
        }
        assert.deepEqual(
          { state, feedback, result: state.status },
          expected,
          `${witness.id} @ ${fps}fps`,
        );
      }
    }
  }
});

const originalExports = [
  "m1-browser-save.json",
  "m2-browser-save.json",
  "m3-browser-save.json",
  "m4-chrome-browser-full-save.json",
  "m5-chrome-before-storage-faults-save.json",
];

test("五个历史 profile 到本版同/较后 profile 有唯一迁移；旧物资、门禁和成绩不变", () => {
  for (const [sourceIndex, sourceProfile] of profiles.entries()) {
    const original = JSON.parse(
      readFileSync(
        new URL(`../docs/verification/evidence/${originalExports[sourceIndex]}`, import.meta.url),
        "utf8",
      ),
    ) as SaveEnvelope<SavePayload>;
    const before = JSON.stringify(original);
    const sourceContent = assembleLegacyContent(sourceProfile);
    const source = validatePayload(original.payload, sourceContent);
    assert.ok(source.ok, source.ok ? "" : source.error);
    for (const targetProfile of profiles.slice(sourceIndex)) {
      const target = assembleContent(targetProfile);
      const registry = publishedProfileMigrations(migrationContentReleases(targetProfile));
      const plan = resolveMigrationPlan(releaseVersion(sourceContent), target, registry);
      assert.ok(plan.ok, plan.ok ? "" : plan.error);
      assert.equal(plan.steps[0]?.definition.kind, "mapped");
      assert.equal(plan.steps[0]?.to.profile.id, sourceProfile);
      assert.equal(plan.steps[1]?.definition.kind, "rules");
      assert.equal(plan.steps[2]?.definition.kind, "mapped");
      assert.ok(plan.steps.slice(3).every((step) => step.definition.kind === "additive"));
      const migrated = validatePayload(original.payload, target, registry);
      assert.ok(migrated.ok, migrated.ok ? "" : migrated.error);
      assert.equal(migrated.value.ruleVersion, 4);
      assert.deepEqual(migrated.value.bestResults, source.value.bestResults);
      assert.deepEqual(migrated.value.claimedRewardIds, source.value.claimedRewardIds);
      assert.deepEqual(migrated.value.completedObjectiveIds, source.value.completedObjectiveIds);
      assert.equal(
        supplyProgress(target, migrated.value).collected,
        supplyProgress(sourceContent, source.value).collected,
      );
      for (const gate of sourceContent.gates)
        assert.equal(
          gateOpen(target, migrated.value, gate.id),
          gateOpen(sourceContent, source.value, gate.id),
        );
      const repeated = validatePayload(migrated.value, target, registry);
      assert.ok(repeated.ok);
      assert.deepEqual(repeated.value, migrated.value);
      assert.equal(repeated.migrated, undefined);
    }
    assert.equal(JSON.stringify(original), before);
  }
});

test("旧 90 Combo 由正常命令产生，升级后保留历史且 v2/v3 拒绝 90 分伪造记录", () => {
  const oldContent = assembleLegacyContent("M1");
  const session = playToFirewall(oldContent);
  session.wait(3000);
  for (let index = 0; index < 90; index++) {
    session.wait(index === 0 ? 250 : 500);
    session.send({ kind: "Move", direction: index % 2 === 0 ? "right" : "left" });
  }
  session.wait(250);
  const payload = stablePayload(session.state);
  assert.equal(
    payload.bestResults.find((result) => result.challengeId === "a.firewall.core")?.bestCombo,
    90,
  );
  const current = assembleContent("M1");
  const registry = publishedProfileMigrations(migrationContentReleases("M1"));
  const migrated = validatePayload(payload, current, registry);
  assert.ok(migrated.ok, migrated.ok ? "" : migrated.error);
  assert.deepEqual(migrated.value.bestResults, payload.bestResults);
  for (const ruleVersion of [2, 3]) {
    const forged = structuredClone(migrated.value);
    forged.bestResults.push({ challengeId: "a.firewall.core", ruleVersion, bestCombo: 90 });
    const rejected = validatePayload(forged, current, registry);
    assert.ok(!rejected.ok);
    assert.match(rejected.error, /超出理论范围/);
  }
  assert.equal(
    validatePayload(migrated.value, current).ok,
    false,
    "缺少原始规则时不能凭新规则猜测历史成绩合法性",
  );
});

test("v1/v2/v3 挑战中保存只保留外层锚点，升级与恢复不带局部格/闪避/接触/分数", () => {
  const target = assembleContent("M1");
  const registry = publishedProfileMigrations(migrationContentReleases("M1"));
  for (const source of [assembleLegacyContent("M1"), assembleV2Content("M1"), target]) {
    const session = playToFirewall(source, "a.firewall.tutorial");
    session.wait(3000);
    session.wait(source.ruleVersion === 1 ? 250 : 273);
    session.send({ kind: "Move", direction: "right" });
    assert.ok(session.state.activeRealtime?.state.kind === "firewall");
    assert.equal(session.state.activeRealtime.state.combo, 1);
    const payload = stablePayload(session.state);
    const result = validatePayload(payload, target, registry);
    assert.ok(result.ok, result.ok ? "" : result.error);
    assert.equal(result.value.playerPosition.tileId, "a.t.0.-3");
    assert.equal(result.value.room, null);
    assert.deepEqual(result.value.resumeHint, {
      kind: "restartChallenge",
      challengeId: "a.firewall.tutorial",
    });
    assert.equal(JSON.stringify(result.value).includes("lastJudgment"), false);
    for (const key of [
      "nextAlarmEventIndex",
      "judgedBeatIndices",
      "dodge",
      "contactedAlarmIds",
      "dodgedAlarmIds",
      "lastDodgeAtMs",
      "lastHazardHit",
    ])
      assert.equal(JSON.stringify(result.value).includes(`"${key}"`), false);
    const restored = restorePayload(result.value, target, 99_000);
    assert.equal(restored.activeRealtime, null);
    assert.equal(restored.mode, "explore");
    assert.equal(restored.clock.activeTimeMs, 0);
    assert.deepEqual(restored.claimedRewardIds, payload.claimedRewardIds);
  }
});

test("部分构建只带本期/较早四版本视图，当前版本最后；每个视图可解析正确迁移", async () => {
  for (const [index, profile] of profiles.entries()) {
    const releases = migrationContentReleases(profile);
    const source = contentModuleSource(releases);
    const module = (await import(`data:text/javascript,${encodeURIComponent(source)}`)) as {
      default: GameContent;
      migrationReleases: GameContent[];
    };
    assert.equal(module.migrationReleases.length, (index + 1) * 4);
    assert.deepEqual(module.default, assembleContent(profile));
    assert.equal(module.default, module.migrationReleases.at(-1));
    assert.ok(
      module.migrationReleases.every((release) => Number(release.profile.id.slice(1)) <= index + 1),
    );
    assert.ok(
      module.migrationReleases.every((release) =>
        release.areas.every((area) => area.includedFrom <= index + 1),
      ),
    );
    const registry = publishedProfileMigrations(module.migrationReleases);
    for (const release of module.migrationReleases)
      assert.equal(
        resolveMigrationPlan(releaseVersion(release), module.default, registry).ok,
        true,
      );
  }
  assert.throws(() => publishedProfileMigrations([assembleContent("M1")]));
  assert.throws(() =>
    publishedProfileMigrations([...migrationContentReleases("M1"), assembleLegacyContent("M1")]),
  );
  assert.throws(() =>
    publishedProfileMigrations([assembleLegacyContent("M2"), assembleContent("M2")]),
  );
  assert.doesNotThrow(() => additiveProfileMigrations(profiles.map(assembleLegacyContent)));
  assert.doesNotThrow(() => additiveProfileMigrations(profiles.map(assembleContent)));
});

test("迁移前保存双槽原文；备份存储失败时拒绝写入新版本", () => {
  const raw = readFileSync(
    new URL("../docs/verification/evidence/m1-browser-save.json", import.meta.url),
    "utf8",
  );
  for (const failBackup of [false, true]) {
    const values = new Map<string, string>([
      [SAVE_KEYS.a, raw],
      [SAVE_KEYS.b, raw],
    ]);
    const storage: SaveStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        if (failBackup && key === SAVE_KEYS.preMigration) throw new Error("QuotaExceededError");
        values.set(key, value);
      },
    };
    const target = assembleContent("M1");
    const registry = publishedProfileMigrations(migrationContentReleases("M1"));
    const store = createSaveStore(
      storage,
      (payload) => validatePayload(payload, target, registry),
      () => true,
    );
    const inspection = store.inspect();
    const latest = inspection.latest;
    assert.ok(latest?.payload && latest.envelope);
    assert.equal(latest.migrationRequired, true);
    const result = store.write(latest.payload, {
      savedAt,
      intent: "migration",
      expected: inspection,
    });
    if (failBackup) {
      assert.equal(result.ok, false);
      assert.equal(values.get(SAVE_KEYS.a), raw);
      assert.equal(values.get(SAVE_KEYS.b), raw);
    } else {
      assert.equal(result.ok, true);
      const backup = JSON.parse(values.get(SAVE_KEYS.preMigration)!);
      assert.deepEqual(backup.saves, { a: raw, b: raw });
    }
  }
});
