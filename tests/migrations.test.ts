import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assembleContent, staticContent } from "../src/content/assemble.ts";
import { replayWorldWitness, validateContent } from "../src/content/validate.ts";
import type { WorldWitness } from "../src/content/validate.ts";
import witnessJson from "../src/content/witnesses/m1.json" with { type: "json" };
import { createGame, dispatch } from "../src/core/engine.ts";
import { areaData, gateOpen, supplyProgress } from "../src/core/progress.ts";
import type { GameCommand, GameContent, GameState } from "../src/core/types.ts";
import { additiveProfileMigrations, releaseVersion } from "../src/platform/migrations.ts";
import type {
  ContentMapping,
  MigrationRegistry,
  MigrationStep,
} from "../src/platform/migrations.ts";
import { restorePayload, stablePayload, validatePayload } from "../src/platform/save-payload.ts";
import type { SavePayload } from "../src/platform/save-payload.ts";
import { createSaveStore, SAVE_KEYS } from "../src/platform/save-store.ts";
import type { SaveStorage } from "../src/platform/save-store.ts";

const savedAt = "2026-09-11T12:00:00.000Z";
const m1 = assembleContent("M1");
const m2 = assembleContent("M2");

// These synthetic targets intentionally retain only the M2 maps. They test migration mechanics,
// not actual M3/M4 map closure, full playthrough, or release acceptance.
function syntheticProfileView(profileId: "M3" | "M4" | "M5", contentVersion: number): GameContent {
  const base = structuredClone(m2);
  const profile = base.releaseProfiles.find((candidate) => candidate.id === profileId)!;
  const stage = Number(profileId.slice(1));
  return {
    ...base,
    contentVersion,
    profile: { ...profile, includedRoomIds: [...base.profile.includedRoomIds] },
    objectives: base.catalogObjectives.filter((objective) => objective.includedFrom <= stage),
    rewards: base.catalogRewards.filter((reward) => reward.includedFrom <= stage),
    dataNodes: base.catalogDataNodes.filter((node) => node.includedFrom <= stage),
  };
}
const m4 = syntheticProfileView("M4", 4);
const releases = [m1, m2, syntheticProfileView("M3", 3), m4];
const registry = additiveProfileMigrations(releases);
const witnesses = witnessJson.witnesses as WorldWitness[];
const fullWitness = witnesses.find(
  (witness) => witness.id === "m1.world.full-collection-and-return",
)!;
const mainWitness = witnesses.find((witness) => witness.id === "m1.world.main-path")!;
const fullReplay = replayWorldWitness(m1, fullWitness);
assert.deepEqual(fullReplay.issues, []);
const realM1 = stablePayload(fullReplay.state);
const browserM2Raw = readFileSync(
  new URL("../docs/verification/evidence/m2-browser-save-schema1.json", import.meta.url),
  "utf8",
);
const browserM2 = JSON.parse(browserM2Raw) as {
  saveGeneration: number;
  savedAt: string;
  payload: SavePayload;
};

function schema1Payload(payload: SavePayload): Record<string, unknown> {
  const legacy = structuredClone(payload) as unknown as Record<string, unknown>;
  legacy.schemaVersion = 1;
  delete legacy.completedRoomLayouts;
  return legacy;
}

function valid(
  payload: unknown,
  content: GameContent,
  migrations: MigrationRegistry = { releases: [content], steps: [] },
) {
  const result = validatePayload(payload, content, migrations);
  assert.ok(result.ok, result.ok ? "" : result.error);
  return result;
}

function rejected(
  payload: unknown,
  content: GameContent,
  migrations: MigrationRegistry,
  message?: RegExp,
) {
  const result = validatePayload(payload, content, migrations);
  assert.ok(!result.ok);
  assert.equal(result.kind, "invalid");
  if (message) assert.match(result.error, message);
}

function pair(
  source: GameContent,
  target: GameContent,
  definition: Pick<MigrationStep, "kind"> & { mapping?: ContentMapping },
): MigrationRegistry {
  const edge =
    definition.kind === "mapped"
      ? {
          from: releaseVersion(source),
          to: releaseVersion(target),
          kind: "mapped" as const,
          mapping: definition.mapping ?? {},
        }
      : { from: releaseVersion(source), to: releaseVersion(target), kind: definition.kind };
  return { releases: [source, target], steps: [edge] };
}

function firstRoomPayload(phase: "preview" | "active"): SavePayload {
  let state = createGame(m1);
  for (const step of mainWitness.steps) {
    state = dispatch(m1, state, step.command, step.atMs, savedAt).state;
    if (
      state.activeStatic &&
      state.phase === phase &&
      (phase === "preview" || state.playerPosition.tileId === "a.maze.01.t.0.2")
    )
      return stablePayload(state);
  }
  throw new Error("正常 M1 见证未到达所需静态状态");
}

class Session {
  state: GameState;
  now = 0;
  readonly content: GameContent;
  constructor(content: GameContent, state = createGame(content)) {
    this.content = content;
    this.state = state;
  }
  wait(duration: number) {
    const end = this.now + duration;
    while (this.now < end) {
      this.now = Math.min(end, this.now + 100);
      this.state = dispatch(this.content, this.state, { kind: "Tick" }, this.now, savedAt).state;
      assert.equal(this.state.clock.awaitingResume, false);
    }
  }
  send(command: GameCommand, after = 140) {
    this.wait(after);
    const result = dispatch(this.content, this.state, command, this.now, savedAt);
    this.state = result.state;
    assert.ok(
      ["accepted", "success", "reset"].includes(result.code),
      `${command.kind}: ${result.code} ${result.state.lastResult.message}`,
    );
  }
  enterFirstRoom() {
    for (let i = 0; i < 3; i += 1) this.send({ kind: "Move", direction: "right" });
    this.send({ kind: "Amplify" });
    for (let i = 0; i < 3; i += 1) this.send({ kind: "Move", direction: "right" });
    this.send({ kind: "Interact" });
    this.send({ kind: "Move", direction: "right" });
    this.send({ kind: "Amplify" });
    for (let i = 0; i < 3; i += 1) this.send({ kind: "Move", direction: "right" });
    assert.equal(this.state.activeStatic?.roomId, "a.maze.01");
  }
}

class MemoryStorage implements SaveStorage {
  readonly values = new Map<string, string>();
  failBackup = false;
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.failBackup && key === SAVE_KEYS.preMigration) throw new Error("QuotaExceededError");
    this.values.set(key, value);
  }
}

function replaceContentIds(
  content: GameContent,
  replacements: Readonly<Record<string, string>>,
  contentVersion: number,
): GameContent {
  const next = JSON.parse(JSON.stringify(content), (_key, value: unknown) =>
    typeof value === "string" ? (replacements[value] ?? value) : value,
  ) as GameContent;
  next.contentVersion = contentVersion;
  return next;
}

test("P07 真实 M1 全收集迁入真实 M2 内容，26 单位与旧终点历史保留，分母更新为 51", () => {
  const migrated = valid(realM1, m2, additiveProfileMigrations([m1, m2])).value;
  assert.ok(m2.areas.some((area) => area.id === "b"));
  assert.deepEqual(supplyProgress(m2, migrated), { collected: 26, total: 51, count: 6 });
  assert.deepEqual(migrated.completedObjectiveIds, realM1.completedObjectiveIds);
  assert.deepEqual(migrated.claimedRewardIds, realM1.claimedRewardIds);
  assert.deepEqual(migrated.scopeCompletionHistory, ["M1"]);
  assert.equal(areaData(m2, migrated, "b").collected, 0);
});

test("P07 真实 M1 来源经逐期与直升合成 M3/M4 目标一致，不替代完整内容迁移验收", () => {
  const original = structuredClone(realM1);
  let sequential = realM1;
  for (const [index, release] of releases.entries()) {
    const result = valid(sequential, release, registry);
    assert.equal(result.migrated ?? false, index !== 0);
    sequential = result.value;
    assert.deepEqual(supplyProgress(release, sequential), {
      collected: 26,
      total: [26, 51, 81, 130][index],
      count: 6,
    });
    assert.deepEqual(sequential.scopeCompletionHistory, ["M1"]);
    assert.equal(sequential.campaignCompletedAt, null);
    for (const area of ["b", "c", "d"] as const)
      assert.equal(areaData(release, sequential, area).collected, 0);
  }
  const direct = valid(realM1, m4, registry);
  assert.deepEqual(direct.value, sequential);
  assert.deepEqual(valid(realM1, m4, registry).value, direct.value);
  const repeated = valid(direct.value, m4, registry);
  assert.equal(repeated.migrated, undefined);
  assert.deepEqual(repeated.value, direct.value);
  assert.deepEqual(realM1, original);
  assert.deepEqual(direct.value.completedObjectiveIds, realM1.completedObjectiveIds);
  assert.deepEqual(direct.value.claimedRewardIds, realM1.claimedRewardIds);
  assert.equal(gateOpen(m4, direct.value, "gate.warehouse"), false);
});

test("P07 真实迷宫预览和活动布局迁入合成 M4 目标保持，恢复清空撤销且仍能重置", () => {
  for (const phase of ["preview", "active"] as const) {
    const source = firstRoomPayload(phase);
    assert.ok(source.room && source.room.status !== "completedVisit");
    const migrated = valid(source, m4, registry).value;
    assert.deepEqual(migrated.room, source.room);
    assert.deepEqual(migrated.playerPosition, source.playerPosition);
    const restored = new Session(m4, restorePayload(migrated, m4, 0));
    assert.deepEqual(restored.state.activeStatic?.state.undoStack, []);
    if (phase === "preview") restored.wait(4000);
    restored.send({ kind: "ResetRoom" });
    assert.equal(restored.state.playerPosition.tileId, source.room?.attemptBaseline.playerTileId);
    assert.deepEqual(restored.state.claimedRewardIds, source.claimedRewardIds);
  }
});

test("P07 双槽真实 M1 进度先备份原文再持久升级，重复载入与普通保存不覆盖迁移备份", () => {
  const storage = new MemoryStorage();
  const previous = stablePayload(replayWorldWitness(m1, mainWitness).state);
  const raw = {
    a: JSON.stringify({ saveGeneration: 19, savedAt, payload: previous }),
    b: JSON.stringify({ saveGeneration: 20, savedAt, payload: realM1 }),
  };
  storage.values.set(SAVE_KEYS.a, raw.a);
  storage.values.set(SAVE_KEYS.b, raw.b);
  const target = releases[1]!;
  const store = createSaveStore(
    storage,
    (payload) => validatePayload(payload, target, registry),
    () => true,
  );
  const before = store.inspect();
  assert.equal(before.status, "ready");
  assert.equal(before.latest?.migrationRequired, true);
  assert.deepEqual(store.exportRaw(before), raw);
  assert.ok(before.latest?.payload);
  const write = store.write(before.latest.payload, {
    expected: before,
    intent: "migration",
    savedAt,
  });
  assert.ok(write.ok);
  assert.equal(write.envelope.saveGeneration, 21);
  const backupRaw = storage.getItem(SAVE_KEYS.preMigration);
  assert.ok(backupRaw);
  const backup = JSON.parse(backupRaw) as { saves: typeof raw };
  assert.deepEqual(backup.saves, raw);
  for (const entry of Object.values(backup.saves))
    valid((JSON.parse(entry) as { payload: unknown }).payload, m1);
  assert.equal(write.inspection.latest?.migrationRequired, false);
  assert.equal(write.inspection.backup?.raw, raw.b);
  const automatic = store.write(write.envelope.payload, {
    expected: write.inspection,
    intent: "auto",
    savedAt,
  });
  assert.ok(automatic.ok);
  assert.equal(storage.getItem(SAVE_KEYS.preMigration), backupRaw);
  assert.deepEqual(automatic.envelope.payload.claimedRewardIds, realM1.claimedRewardIds);
});

test("P09 真实 M1→M2 的迁移备份额度不足时停止，两个原槽逐字可导出", () => {
  const storage = new MemoryStorage();
  const oldRaw = JSON.stringify({ saveGeneration: 8, savedAt, payload: realM1 });
  storage.values.set(SAVE_KEYS.a, oldRaw);
  storage.failBackup = true;
  const store = createSaveStore(
    storage,
    (payload) => validatePayload(payload, m2, registry),
    () => true,
  );
  const before = store.inspect();
  assert.ok(before.latest?.payload);
  const result = store.write(before.latest.payload, {
    expected: before,
    intent: "migration",
    savedAt,
  });
  assert.ok(!result.ok && result.code === "backupFailed");
  assert.deepEqual(store.exportRaw(store.inspect()), { a: oldRaw, b: null });
});

test("P08 合成规则 v2 的较低上限不误拒真实 v1 成绩；旧奖励保留，新成绩独立结算", () => {
  const target = structuredClone(m1);
  target.ruleVersion = 2;
  target.realtimeChallenges = target.realtimeChallenges.map((definition) =>
    definition.kind === "firewall"
      ? {
          ...definition,
          ruleVersion: 2,
          rules: {
            ...definition.rules,
            durationMs: 2500,
            comboTarget: 3,
            beatMasks: [[], [], [], [], []],
          },
        }
      : { ...definition, ruleVersion: 2 },
  );
  const rulesRegistry = pair(m1, target, { kind: "rules" });
  const migrated = valid(realM1, target, rulesRegistry);
  assert.deepEqual(migrated.value.bestResults, realM1.bestResults);
  assert.deepEqual(migrated.value.claimedRewardIds, realM1.claimedRewardIds);
  assert.ok(migrated.migrationNotes?.some((note) => note.includes("历史记录")));
  const playing = new Session(target, restorePayload(migrated.value, target, 0));
  for (let i = 0; i < 3; i += 1) playing.send({ kind: "Move", direction: "up" });
  playing.send({ kind: "Interact" });
  playing.send({ kind: "StartChallenge", challengeId: "a.firewall.inner" });
  playing.wait(3000);
  playing.send({ kind: "Move", direction: "right" }, 250);
  playing.send({ kind: "Move", direction: "left" }, 500);
  playing.send({ kind: "Move", direction: "right" }, 500);
  playing.wait(1250);
  assert.equal(playing.state.mode, "challengeResult");
  assert.equal(playing.state.phase, "success");
  const saved = valid(stablePayload(playing.state), target, rulesRegistry).value;
  assert.deepEqual(
    saved.bestResults.filter((score) => score.ruleVersion === 1),
    realM1.bestResults,
  );
  assert.deepEqual(
    saved.bestResults.filter((score) => score.ruleVersion === 2),
    [{ challengeId: "a.firewall.inner", ruleVersion: 2, bestCombo: 3 }],
  );
  assert.deepEqual(saved.claimedRewardIds, realM1.claimedRewardIds);
  const forged = structuredClone(realM1);
  forged.bestResults[0]!.bestCombo = 999;
  rejected(forged, target, rulesRegistry, /理论范围/);
  rejected(saved, target, { releases: [target], steps: [] }, /未知挑战成绩/);
  assert.equal(validatePayload(saved, m1).ok, false);
});

test("P08 未登记规则路径或未提供原始内容定义时拒绝，不从载荷版本猜修复", () => {
  const target = { ...m1, ruleVersion: 2 };
  rejected(realM1, target, { releases: [m1, target], steps: [] }, /没有登记/);
  rejected(realM1, target, { releases: [target], steps: [] }, /来源内容版本/);
  rejected(
    { ...realM1, contentVersion: 2 },
    { ...m1, contentVersion: 3 },
    { releases: [m1], steps: [] },
    /来源内容版本/,
  );
});

test("P08 世界坐标只按显式旧格→新格映射，玩家、发现和已访问集合一起迁移", () => {
  const tileIds = { "a.t.0.0": "a.t.entry.v2" };
  const target = replaceContentIds(m1, tileIds, 2);
  rejected(realM1, target, pair(m1, target, { kind: "mapped" }), /迁移后校验失败/);
  const result = valid(
    realM1,
    target,
    pair(m1, target, { kind: "mapped", mapping: { tileIds } }),
  ).value;
  assert.equal(result.playerPosition.tileId, "a.t.entry.v2");
  assert.ok(result.discoveredTileIds.includes("a.t.entry.v2"));
  assert.ok(result.visitedTileIds.includes("a.t.entry.v2"));
  assert.equal(result.discoveredTileIds.includes("a.t.0.0"), false);
  assert.equal(result.visitedTileIds.includes("a.t.0.0"), false);
});

test("P08 静态坐标映射覆盖玩家、棋盘、返回锚点与重置基线，恢复后可正常移动和重置", () => {
  const payload = firstRoomPayload("active");
  assert.ok(payload.room && payload.room.status !== "completedVisit");
  const definition = m1.staticChallenges.find((room) => room.id === "a.maze.01")!;
  const tileIds = Object.fromEntries([
    ...definition.tiles.map((tile) => [tile.id, `${tile.id}.v2`]),
    [payload.room.returnAnchor.tileId, "a.t.maze-entry.v2"],
  ]);
  const target = replaceContentIds(m1, tileIds, 2);
  const newBoard = "a.maze.01.board.v2";
  target.staticChallenges = target.staticChallenges.map((room) =>
    room.id === definition.id
      ? {
          ...room,
          boardId: newBoard,
          tiles: room.tiles.map((tile) => ({ ...tile, boardId: newBoard })),
        }
      : room,
  );
  target.rooms = target.rooms.map((room) =>
    room.id === definition.id ? { ...room, boardId: newBoard } : room,
  );
  const mapping = { tileIds, boardIds: { [definition.boardId]: newBoard } };
  const mappedRegistry = pair(m1, target, { kind: "mapped", mapping });
  const migrated = valid(payload, target, mappedRegistry).value;
  assert.equal(migrated.playerPosition.boardId, newBoard);
  assert.equal(migrated.playerPosition.tileId, "a.maze.01.t.0.2.v2");
  assert.equal(migrated.room?.returnAnchor.tileId, "a.t.maze-entry.v2");
  assert.ok(migrated.room && migrated.room.status !== "completedVisit");
  assert.equal(migrated.room.attemptBaseline.playerTileId, "a.maze.01.t.0.4.v2");
  const playing = new Session(target, restorePayload(migrated, target, 0));
  playing.send({ kind: "Move", direction: "up" });
  assert.equal(playing.state.playerPosition.tileId, "a.maze.01.t.0.1.v2");
  playing.send({ kind: "ResetRoom" });
  assert.equal(playing.state.playerPosition.tileId, "a.maze.01.t.0.4.v2");
});

test("P08 合成静态初态的路径访问集合与物体占格、基线布局全部经同一坐标映射", () => {
  for (const fixtureId of ["b.line.01", "c.routing.01"]) {
    const definition = staticContent.definitions.find((room) => room.id === fixtureId)!;
    const source = structuredClone(m1);
    source.contentVersion = 10;
    const synthetic = { ...definition, id: "a.maze.01", includedFrom: "M1" as const };
    source.staticChallenges = source.staticChallenges.map((room) =>
      room.id === "a.maze.01" ? synthetic : room,
    );
    source.rooms = source.rooms.map((room) =>
      room.id === "a.maze.01"
        ? { ...room, boardId: synthetic.boardId, entryTileId: synthetic.startTileId }
        : room,
    );
    const playing = new Session(source);
    playing.enterFirstRoom();
    const witness = staticContent.witnesses.find(
      (item) => item.definitionId === fixtureId && item.kind === "success",
    )!;
    const firstDirection = witness.actions.find(
      (action) => !["activate", "reset", "undo"].includes(action),
    );
    assert.ok(
      firstDirection &&
        firstDirection !== "activate" &&
        firstDirection !== "reset" &&
        firstDirection !== "undo",
    );
    playing.send({ kind: "Move", direction: firstDirection });
    const payload = valid(stablePayload(playing.state), source).value;
    assert.ok(payload.room && payload.room.status !== "completedVisit");
    const tileIds = Object.fromEntries(
      synthetic.tiles.map((tile) => [tile.id, `${tile.id}.moved`]),
    );
    const target = replaceContentIds(source, tileIds, 11);
    const migrated = valid(
      payload,
      target,
      pair(source, target, { kind: "mapped", mapping: { tileIds } }),
    ).value;
    assert.ok(migrated.room && migrated.room.status !== "completedVisit");
    for (const [before, after] of [
      [payload.room.currentLayout, migrated.room.currentLayout],
      [payload.room.attemptBaseline.layout, migrated.room.attemptBaseline.layout],
    ] as const) {
      assert.deepEqual(
        after.visitedTileIds,
        before.visitedTileIds.map((id) => tileIds[id]),
      );
      assert.deepEqual(
        after.objectTileById,
        Object.fromEntries(
          Object.entries(before.objectTileById).map(([id, tile]) => [id, tileIds[tile]]),
        ),
      );
    }
    assert.ok(
      fixtureId === "b.line.01"
        ? migrated.room.currentLayout.visitedTileIds.length > 1
        : Object.keys(migrated.room.currentLayout.objectTileById).length > 0,
    );
  }
});

test("P08 仅已登记的无法映射房间可退回安全入口并说明；原本坏档不能借退出映射洗白", () => {
  const payload = firstRoomPayload("active");
  const target = structuredClone(m1);
  target.contentVersion = 2;
  target.staticChallenges = target.staticChallenges.map((room) =>
    room.id === "a.maze.01"
      ? { ...room, tiles: room.tiles.filter((tile) => tile.id !== payload.playerPosition.tileId) }
      : room,
  );
  rejected(payload, target, pair(m1, target, { kind: "mapped" }), /迁移后校验失败/);
  const fallback = pair(m1, target, { kind: "mapped", mapping: { exitRoomIds: ["a.maze.01"] } });
  const result = valid(payload, target, fallback);
  assert.equal(result.value.room, null);
  assert.deepEqual(result.value.playerPosition, payload.room?.returnAnchor);
  assert.deepEqual(result.value.claimedRewardIds, payload.claimedRewardIds);
  assert.deepEqual(result.value.completedObjectiveIds, payload.completedObjectiveIds);
  assert.ok(
    result.migrationNotes?.some((note) => note.includes("无法映射") && note.includes("安全入口")),
  );
  const corrupted = structuredClone(payload);
  corrupted.playerPosition.tileId = "a.maze.01.t.1.3";
  rejected(corrupted, target, fallback, /非法房间布局/);
});

test("P08 目标和奖励重命名必须显式一对一映射，保持物资与既有门禁结果", () => {
  const replacements = { "a.supply.maze01": "a.supply.maze01.v2", "a.main": "a.main.v2" };
  const target = replaceContentIds(m1, replacements, 2);
  rejected(realM1, target, pair(m1, target, { kind: "mapped" }), /缺少明确映射/);
  const mappedRegistry = pair(m1, target, {
    kind: "mapped",
    mapping: {
      objectiveIds: { "a.main": "a.main.v2" },
      rewardIds: { "a.supply.maze01": "a.supply.maze01.v2" },
    },
  });
  const result = valid(realM1, target, mappedRegistry).value;
  assert.ok(result.completedObjectiveIds.includes("a.main.v2"));
  assert.ok(result.claimedRewardIds.includes("a.supply.maze01.v2"));
  assert.deepEqual(supplyProgress(target, result), { collected: 26, total: 26, count: 6 });
  for (const gate of m1.gates)
    assert.equal(gateOpen(target, result, gate.id), gateOpen(m1, realM1, gate.id));
  const unclaimed = stablePayload(createGame(m1));
  rejected(unclaimed, target, pair(m1, target, { kind: "mapped" }), /缺少明确映射/);
});

test("P08 改变奖励数额、合并奖励或改变既有门禁的映射均停止迁移", () => {
  const target = structuredClone(m1);
  target.contentVersion = 2;
  target.rewards.find((reward) => reward.id === "a.supply.maze01")!.units = 10;
  rejected(realM1, target, pair(m1, target, { kind: "mapped" }), /改变物资数额/);
  const unchanged = { ...m1, contentVersion: 2 };
  rejected(
    realM1,
    unchanged,
    pair(m1, unchanged, {
      kind: "mapped",
      mapping: { rewardIds: { "a.supply.maze01": "a.supply.maze03" } },
    }),
    /一对一/,
  );
  const gateChanged = structuredClone(unchanged);
  gateChanged.gates.find((gate) => gate.id === "gate.a.firewall.inner")!.condition = {
    kind: "objective",
    objectiveId: "a.revisit.terminal",
  };
  rejected(realM1, gateChanged, pair(m1, gateChanged, { kind: "mapped" }), /改变既有门禁/);
});

test("迁移拒绝伪装为 additive 的坐标或规则改动、降级路径及多条歧义路径", () => {
  const changed = structuredClone(releases[1]!);
  changed.tiles.find((tile) => tile.id === "a.t.0.0")!.x += 1;
  rejected(realM1, changed, additiveProfileMigrations([m1, changed]), /需要明确坐标迁移/);
  const ambiguous: MigrationRegistry = {
    releases,
    steps: [
      ...registry.steps,
      { from: releaseVersion(m1), to: releaseVersion(m4), kind: "mapped", mapping: {} },
    ],
  };
  rejected(realM1, m4, ambiguous, /路径不唯一/);
  const downgrade: MigrationRegistry = {
    releases,
    steps: [{ from: releaseVersion(m4), to: releaseVersion(m1), kind: "mapped", mapping: {} }],
  };
  rejected(realM1, m4, downgrade, /不能降级/);
});

test("P07 合成 M4→M5 只更新发布 profile，内容与规则版本、游戏进度均保持", () => {
  const m5 = syntheticProfileView("M5", 4);
  const upgraded = valid(realM1, m4, registry).value;
  const result = valid(upgraded, m5, additiveProfileMigrations([m4, m5])).value;
  assert.deepEqual(result, { ...upgraded, releaseProfileId: "M5" });
  assert.deepEqual(supplyProgress(m5, result), { collected: 26, total: 130, count: 6 });
});

test("P08 坐标步骤不能暗改实时规则，规则步骤不能暗改局部棋盘坐标", () => {
  const ruleChanged = structuredClone(m1);
  ruleChanged.contentVersion = 2;
  ruleChanged.realtimeChallenges = ruleChanged.realtimeChallenges.map((challenge) =>
    challenge.kind === "firewall"
      ? {
          ...challenge,
          rules: { ...challenge.rules, comboTarget: challenge.rules.comboTarget + 1 },
        }
      : challenge,
  );
  rejected(realM1, ruleChanged, pair(m1, ruleChanged, { kind: "mapped" }), /没有提升 ruleVersion/);
  const boardChanged = structuredClone(m1);
  boardChanged.ruleVersion = 2;
  boardChanged.realtimeChallenges = boardChanged.realtimeChallenges.map((challenge) => ({
    ...challenge,
    ruleVersion: 2,
    tiles: challenge.tiles.map((tile) => ({ ...tile, x: tile.x + 1 })),
  }));
  rejected(realM1, boardChanged, pair(m1, boardChanged, { kind: "rules" }), /同时改变地图/);
  assert.throws(
    () => additiveProfileMigrations([m1, { ...m2, contentVersion: 1 }]),
    /新增内容迁移/,
  );
});

test("P07 历史 M1 schema1 只回填记忆迷宫确定的空布局，重复迁移不再变更", () => {
  const legacy = schema1Payload(realM1);
  const result = valid(legacy, m1);
  assert.equal(result.migrated, true);
  assert.equal(result.value.schemaVersion, 2);
  assert.deepEqual(result.value.completedRoomLayouts, realM1.completedRoomLayouts);
  assert.deepEqual(result.value.claimedRewardIds, realM1.claimedRewardIds);
  assert.equal(valid(result.value, m1).migrated, undefined);
  assert.equal(Object.hasOwn(legacy, "completedRoomLayouts"), false);
  rejected({ ...legacy, completedRoomLayouts: {} }, m1, { releases: [m1], steps: [] }, /旧版结构/);
  rejected({ ...legacy, schemaVersion: 2 }, m1, { releases: [m1], steps: [] }, /缺少必需字段/);
  const syntheticM3 = releases[2]!;
  rejected(
    { ...legacy, releaseProfileId: "M3", contentVersion: 3 },
    syntheticM3,
    registry,
    /缺失的推物完成布局不能猜测/,
  );
});

test("P07 真实浏览器 M2 schema1 全收集文件升级 schema2，51物资与全部成绩原样保留", () => {
  assert.equal(browserM2.payload.schemaVersion, 1);
  assert.equal(browserM2.payload.releaseProfileId, "M2");
  const result = valid(browserM2.payload, m2, registry);
  assert.equal(result.migrated, true);
  assert.equal(result.value.schemaVersion, 2);
  assert.deepEqual(supplyProgress(m2, result.value), { collected: 51, total: 51, count: 11 });
  assert.deepEqual(result.value.bestResults, browserM2.payload.bestResults);
  assert.deepEqual(result.value.completedObjectiveIds, browserM2.payload.completedObjectiveIds);
  assert.deepEqual(result.value.claimedRewardIds, browserM2.payload.claimedRewardIds);
  for (const definition of m2.staticChallenges) {
    const layout = result.value.completedRoomLayouts[definition.id];
    assert.ok(layout);
    assert.deepEqual(layout.objectTileById, {});
    assert.deepEqual(
      new Set(layout.visitedTileIds),
      new Set(definition.kind === "oneStroke" ? definition.requiredTileIds : []),
    );
  }
  const playing = new Session(m2, restorePayload(result.value, m2, 0));
  playing.send({ kind: "Teleport", teleportId: "b.teleport" });
  playing.send({ kind: "Move", direction: "right" });
  playing.send({ kind: "Move", direction: "right" });
  assert.equal(playing.state.mode, "completedRoom");
  playing.send({ kind: "Move", direction: "right" });
  playing.send({ kind: "Move", direction: "left" });
  const visit = valid(stablePayload(playing.state), m2, registry).value;
  assert.equal(visit.room?.status, "completedVisit");
  assert.deepEqual(visit.completedRoomLayouts, result.value.completedRoomLayouts);
  assert.deepEqual(stablePayload(restorePayload(visit, m2, 50000)), visit);
});

test("P07 真实 schema1 M2 文件持久升级前保存两槽原文，恢复当前 schema 后不重复补布局", () => {
  const storage = new MemoryStorage();
  storage.values.set(SAVE_KEYS.a, browserM2Raw);
  const store = createSaveStore(
    storage,
    (payload) => validatePayload(payload, m2, registry),
    () => true,
  );
  const before = store.inspect();
  assert.equal(before.latest?.migrationRequired, true);
  assert.ok(before.latest?.payload);
  const written = store.write(before.latest.payload, {
    expected: before,
    intent: "migration",
    savedAt,
  });
  assert.ok(written.ok);
  assert.equal(written.envelope.saveGeneration, browserM2.saveGeneration + 1);
  const original = JSON.parse(storage.getItem(SAVE_KEYS.preMigration)!) as {
    saves: { a: string; b: null };
  };
  assert.deepEqual(original.saves, { a: browserM2Raw, b: null });
  assert.equal(written.inspection.latest?.migrationRequired, false);
  assert.deepEqual(
    written.inspection.latest?.payload?.completedRoomLayouts,
    written.envelope.payload.completedRoomLayouts,
  );
});

test("P08 永久完成的一笔画集合与回访玩家坐标同步映射，不重算或替换提交结果", () => {
  const source = valid(browserM2.payload, m2, registry).value;
  const playing = new Session(m2, restorePayload(source, m2, 0));
  playing.send({ kind: "Teleport", teleportId: "b.teleport" });
  playing.send({ kind: "Move", direction: "right" });
  playing.send({ kind: "Move", direction: "right" });
  playing.send({ kind: "Move", direction: "right" });
  const visit = valid(stablePayload(playing.state), m2, registry).value;
  const definition = m2.staticChallenges.find((room) => room.id === "b.line.01")!;
  const tileIds = Object.fromEntries(definition.tiles.map((tile) => [tile.id, `${tile.id}.moved`]));
  const target = replaceContentIds(m2, tileIds, 3);
  const result = valid(
    visit,
    target,
    pair(m2, target, { kind: "mapped", mapping: { tileIds } }),
  ).value;
  assert.equal(result.playerPosition.tileId, tileIds[visit.playerPosition.tileId]);
  assert.deepEqual(
    result.completedRoomLayouts[definition.id]?.visitedTileIds,
    visit.completedRoomLayouts[definition.id]?.visitedTileIds.map((id) => tileIds[id]),
  );
  assert.deepEqual(result.claimedRewardIds, source.claimedRewardIds);
  assert.equal(restorePayload(result, target, 0).mode, "completedRoom");
});

const actualM3 = assembleContent("M3");
const actualM4 = assembleContent("M4");
const actualM5 = assembleContent("M5");
const actualReleases = [m1, m2, actualM3, actualM4, actualM5];
const actualRegistry = additiveProfileMigrations(actualReleases);
const browserM3Samples = [
  {
    file: "m3-browser-main-save.json",
    supplyUnits: 51,
    rewardCount: 11,
    layoutCount: 6,
    cData: 20,
  },
  { file: "m3-browser-save.json", supplyUnits: 81, rewardCount: 17, layoutCount: 9, cData: 100 },
].map((sample) => {
  const url = new URL(`../docs/verification/evidence/${sample.file}`, import.meta.url);
  const raw = readFileSync(url, "utf8");
  const envelope = JSON.parse(raw) as {
    saveGeneration: number;
    savedAt: string;
    payload: SavePayload;
  };
  return { ...sample, url, raw, envelope };
});
const browserM3Main = browserM3Samples[0]!;
const browserM3Full = browserM3Samples[1]!;

for (const sample of browserM3Samples) {
  test(`P07 实际 ${sample.file} 迁入完整 M4 / 同 content4 的 M5，原成绩和完成布局逐项保持`, () => {
    assert.deepEqual(validateContent(actualM4), []);
    assert.deepEqual(validateContent(actualM5), []);
    assert.equal(actualM4.contentVersion, 4);
    assert.equal(actualM5.contentVersion, 4);
    const source = sample.envelope.payload;
    const before = structuredClone(source);
    valid(source, actualM3);
    assert.equal(source.contentVersion, 3);
    assert.equal(Object.keys(source.completedRoomLayouts).length, sample.layoutCount);
    assert.equal(source.bestResults.length, 7);
    const migrated = valid(source, actualM4, actualRegistry);
    assert.equal(migrated.migrated, true);
    assert.deepEqual(migrated.value, { ...source, contentVersion: 4, releaseProfileId: "M4" });
    assert.deepEqual(supplyProgress(actualM4, migrated.value), {
      collected: sample.supplyUnits,
      total: 130,
      count: sample.rewardCount,
    });
    for (const area of ["a", "b"] as const) {
      assert.equal(areaData(actualM4, migrated.value, area).collected, 80);
      assert.equal(areaData(actualM4, migrated.value, area).complete, false);
    }
    assert.equal(areaData(actualM4, migrated.value, "c").collected, sample.cData);
    assert.equal(areaData(actualM4, migrated.value, "d").collected, 0);
    assert.equal(gateOpen(actualM4, migrated.value, "gate.d.main"), false);
    assert.equal(gateOpen(actualM4, migrated.value, "gate.warehouse"), false);
    const directM5 = valid(source, actualM5, actualRegistry).value;
    const viaM4 = valid(migrated.value, actualM5, actualRegistry).value;
    assert.deepEqual(directM5, viaM4);
    assert.deepEqual(viaM4, { ...migrated.value, releaseProfileId: "M5" });
    for (const target of [actualM4, actualM5]) {
      const upgraded = target === actualM4 ? migrated.value : directM5;
      const repeated = valid(upgraded, target, actualRegistry);
      assert.equal(repeated.migrated, undefined);
      assert.deepEqual(repeated.value, upgraded);
      assert.deepEqual(stablePayload(restorePayload(upgraded, target, 100000)), upgraded);
    }
    assert.deepEqual(source, before);
    assert.equal(readFileSync(sample.url, "utf8"), sample.raw);
  });
}

test("P07 真实 M1 全收集按实际 M1→M2→M3→M4 与直接 M1→M4 迁移一致", () => {
  let sequential = realM1;
  for (const target of actualReleases.slice(0, 4)) {
    assert.deepEqual(validateContent(target), []);
    sequential = valid(sequential, target, actualRegistry).value;
  }
  assert.deepEqual(valid(realM1, actualM4, actualRegistry).value, sequential);
  assert.deepEqual(sequential.completedRoomLayouts, realM1.completedRoomLayouts);
  assert.deepEqual(sequential.bestResults, realM1.bestResults);
  assert.deepEqual(sequential.scopeCompletionHistory, ["M1"]);
  assert.deepEqual(supplyProgress(actualM4, sequential), { collected: 26, total: 130, count: 6 });
  assert.equal(sequential.campaignCompletedAt, null);
  assert.equal(gateOpen(actualM4, sequential, "gate.warehouse"), false);
});

test("G04/P07 实际 C 主线档升级 M4 后只用移动和 F 即进入 D，三盗取仍未完成", () => {
  const payload = valid(browserM3Main.envelope.payload, actualM4, actualRegistry).value;
  const playing = new Session(actualM4, restorePayload(payload, actualM4, 0));
  assert.equal(playing.state.playerPosition.tileId, "c.t.7.0");
  assert.equal(areaData(actualM4, playing.state, "c").collected, 20);
  playing.send({ kind: "Move", direction: "right" });
  playing.send({ kind: "Interact" });
  assert.equal(playing.state.playerPosition.tileId, "d.t.0.0");
  assert.equal(playing.state.mode, "explore");
  assert.ok(playing.state.activatedTeleportIds.includes("d.teleport"));
  assert.deepEqual(playing.state.completedObjectiveIds, payload.completedObjectiveIds);
  assert.deepEqual(playing.state.claimedRewardIds, payload.claimedRewardIds);
  for (const id of ["c.theft.01", "c.theft.02", "c.theft.03", "d.main"])
    assert.equal(playing.state.completedObjectiveIds.includes(id), false);
  valid(stablePayload(playing.state), actualM4);
});

test("P01/P07 真实 C 完成态访问在 M4→M5 保留九个首次布局，载入后仍可正常离开", () => {
  const migrated = valid(browserM3Full.envelope.payload, actualM4, actualRegistry).value;
  const playing = new Session(actualM4, restorePayload(migrated, actualM4, 0));
  assert.equal(playing.state.playerPosition.tileId, "c.t.-4.-2");
  playing.send({ kind: "Interact" });
  assert.equal(playing.state.activeCompletedRoom?.roomId, "c.theft.02");
  playing.send({ kind: "Move", direction: "left" });
  const current = stablePayload(playing.state);
  assert.equal(current.room?.status, "completedVisit");
  const upgraded = valid(current, actualM5, actualRegistry).value;
  assert.deepEqual(
    upgraded.completedRoomLayouts,
    browserM3Full.envelope.payload.completedRoomLayouts,
  );
  assert.deepEqual(upgraded.room, current.room);
  assert.deepEqual(upgraded.playerPosition, current.playerPosition);
  const continued = new Session(actualM5, restorePayload(upgraded, actualM5, 0));
  continued.send({ kind: "Move", direction: "right" });
  assert.equal(continued.state.mode, "explore");
  assert.equal(continued.state.playerPosition.tileId, "c.t.-4.-2");
  assert.deepEqual(continued.state.completedRoomLayouts, migrated.completedRoomLayouts);
  assert.deepEqual(continued.state.claimedRewardIds, migrated.claimedRewardIds);
});

test("P07 实际 M3 双槽升级 M4 / M5 前保留 content3 原文，代数增加且九完成布局不变", () => {
  for (const target of [actualM4, actualM5]) {
    const storage = new MemoryStorage();
    const raw = { a: browserM3Main.raw, b: browserM3Full.raw };
    storage.values.set(SAVE_KEYS.a, raw.a);
    storage.values.set(SAVE_KEYS.b, raw.b);
    const store = createSaveStore(
      storage,
      (payload) => validatePayload(payload, target, actualRegistry),
      () => true,
    );
    const before = store.inspect();
    assert.equal(before.status, "ready");
    assert.equal(before.latest?.migrationRequired, true);
    assert.ok(before.latest?.payload);
    const written = store.write(before.latest.payload, {
      expected: before,
      intent: "migration",
      savedAt,
    });
    assert.ok(written.ok);
    assert.equal(written.envelope.saveGeneration, browserM3Full.envelope.saveGeneration + 1);
    assert.equal(written.inspection.latest?.migrationRequired, false);
    assert.equal(written.inspection.backup?.raw, browserM3Full.raw);
    const backup = JSON.parse(storage.getItem(SAVE_KEYS.preMigration)!) as { saves: typeof raw };
    assert.deepEqual(backup.saves, raw);
    for (const original of Object.values(backup.saves))
      valid((JSON.parse(original) as { payload: unknown }).payload, actualM3);
    assert.deepEqual(
      written.envelope.payload.completedRoomLayouts,
      browserM3Full.envelope.payload.completedRoomLayouts,
    );
    assert.deepEqual(
      written.envelope.payload.bestResults,
      browserM3Full.envelope.payload.bestResults,
    );
    assert.deepEqual(supplyProgress(target, written.envelope.payload), {
      collected: 81,
      total: 130,
      count: 17,
    });
  }
});

test("P05 实际 M3 旧槽旁的较新 schema / content / rule / profile 均受保护，不能静默退回旧档", () => {
  const source = valid(browserM3Full.envelope.payload, actualM4, actualRegistry).value;
  for (const change of [
    { schemaVersion: 3 },
    { contentVersion: 5 },
    { ruleVersion: 2 },
    { releaseProfileId: "M5" },
  ]) {
    const future = { ...source, ...change };
    const validation = validatePayload(future, actualM4, actualRegistry);
    assert.ok(!validation.ok && validation.kind === "future");
    const storage = new MemoryStorage();
    const raw = {
      a: browserM3Full.raw,
      b: JSON.stringify({
        saveGeneration: browserM3Full.envelope.saveGeneration + 1,
        savedAt,
        payload: future,
      }),
    };
    storage.values.set(SAVE_KEYS.a, raw.a);
    storage.values.set(SAVE_KEYS.b, raw.b);
    const store = createSaveStore(
      storage,
      (payload) => validatePayload(payload, actualM4, actualRegistry),
      () => true,
    );
    assert.equal(store.inspect().status, "future");
    const written = store.write(source, {
      expected: store.inspect(),
      intent: "migration",
      savedAt,
    });
    assert.ok(!written.ok && written.code === "futureProtected");
    assert.deepEqual(store.exportRaw(store.inspect()), raw);
    assert.equal(storage.getItem(SAVE_KEYS.preMigration), null);
  }
});

test("P06 实际 M4 显露集合须与观察和增幅事件双向闭合，多组/漏组坏导入保持原世界", () => {
  const source = valid(browserM3Main.envelope.payload, actualM4, actualRegistry).value;
  const playing = new Session(actualM4, restorePayload(source, actualM4, 0));
  const unchanged = structuredClone(playing.state);
  for (const ids of [
    ["d.group.hidden"],
    ["d.group.permission03", "d.group.permission04", "d.group.hidden"],
  ]) {
    const forged = { ...source, revealedGroupIds: ids };
    rejected(forged, actualM4, actualRegistry, /显露组.*揭示事件/);
    assert.deepEqual(playing.state, unchanged);
  }
  playing.send({ kind: "Move", direction: "right" });
  playing.send({ kind: "Interact" });
  playing.send({ kind: "Move", direction: "left" });
  playing.send({ kind: "Interact" });
  playing.send({ kind: "Move", direction: "right" });
  playing.send({ kind: "Move", direction: "down" });
  playing.send({ kind: "Amplify" });
  const revealed = valid(stablePayload(playing.state), actualM4).value;
  assert.deepEqual(
    new Set(revealed.revealedGroupIds),
    new Set(["d.group.permission03", "d.group.permission04"]),
  );
  for (const missing of revealed.revealedGroupIds) {
    const faulty = structuredClone(revealed);
    faulty.revealedGroupIds = faulty.revealedGroupIds.filter((id) => id !== missing);
    const tiles = new Set(
      actualM4.tiles.filter((tile) => tile.hiddenGroupId === missing).map((tile) => tile.id),
    );
    faulty.discoveredTileIds = faulty.discoveredTileIds.filter((id) => !tiles.has(id));
    faulty.visitedTileIds = faulty.visitedTileIds.filter((id) => !tiles.has(id));
    rejected(faulty, actualM4, actualRegistry, /显露组.*揭示事件/);
  }
  const withoutNexusRecord = structuredClone(revealed);
  withoutNexusRecord.clearedEtherNodeIds = withoutNexusRecord.clearedEtherNodeIds.filter(
    (id) => id !== "d.reveal.04",
  );
  rejected(withoutNexusRecord, actualM4, actualRegistry, /富集目标与清除记录不一致/);
  const withoutNexusObjective = structuredClone(revealed);
  withoutNexusObjective.completedObjectiveIds = withoutNexusObjective.completedObjectiveIds.filter(
    (id) => id !== "d.reveal.04",
  );
  rejected(withoutNexusObjective, actualM4, actualRegistry, /富集清除记录不合法/);
  assert.deepEqual(stablePayload(playing.state), revealed);
});

test("P06/P07 显露组闭合校验仍接受真实 M1–M3 浏览器导出及其实际完整内容升级", () => {
  for (const [file, source] of [
    ["m1-browser-save.json", m1],
    ["m2-browser-save-schema1.json", m2],
    ["m2-browser-save.json", m2],
    ["m3-browser-main-save.json", actualM3],
    ["m3-browser-save.json", actualM3],
  ] as const) {
    const url = new URL(`../docs/verification/evidence/${file}`, import.meta.url);
    const raw = readFileSync(url, "utf8");
    const payload = (JSON.parse(raw) as { payload: unknown }).payload;
    const compatible = valid(payload, source, actualRegistry).value;
    assert.deepEqual(compatible.revealedGroupIds, []);
    const upgraded = valid(payload, actualM4, actualRegistry).value;
    assert.deepEqual(upgraded.revealedGroupIds, []);
    assert.deepEqual(upgraded.completedObjectiveIds, compatible.completedObjectiveIds);
    assert.deepEqual(upgraded.claimedRewardIds, compatible.claimedRewardIds);
    assert.equal(readFileSync(url, "utf8"), raw);
  }
});

test("P06/P07 真实 M4 全收集浏览器导出含三组合法揭示，升同 content4 M5 保留130与九完成布局", () => {
  const url = new URL("../docs/verification/evidence/m4-browser-save.json", import.meta.url);
  const raw = readFileSync(url, "utf8");
  const original = (JSON.parse(raw) as { payload: SavePayload }).payload;
  const source = valid(original, actualM4, actualRegistry);
  assert.equal(source.migrated, undefined);
  assert.deepEqual(
    new Set(source.value.revealedGroupIds),
    new Set(["d.group.permission03", "d.group.permission04", "d.group.hidden"]),
  );
  assert.equal(Object.keys(source.value.completedRoomLayouts).length, 9);
  assert.deepEqual(supplyProgress(actualM4, source.value), {
    collected: 130,
    total: 130,
    count: 26,
  });
  for (const area of ["a", "b", "c", "d"] as const)
    assert.equal(areaData(actualM4, source.value, area).complete, true);
  assert.ok(source.value.completedObjectiveIds.includes("warehouse.complete"));
  const target = valid(source.value, actualM5, actualRegistry);
  assert.equal(target.migrated, true);
  assert.equal(target.value.contentVersion, 4);
  assert.equal(target.value.ruleVersion, 1);
  assert.deepEqual(target.value, { ...original, releaseProfileId: "M5" });
  assert.deepEqual(stablePayload(restorePayload(target.value, actualM5, 0)), target.value);
  assert.equal(valid(target.value, actualM5, actualRegistry).migrated, undefined);
  assert.equal(readFileSync(url, "utf8"), raw);
});

for (const sample of [
  {
    file: "m4-chrome-browser-main-save.json",
    label: "无评分仓库通关",
    generation: 447,
    supplyUnits: 100,
    rewardCount: 20,
    scoredComplete: false,
  },
  {
    file: "m4-chrome-browser-full-save.json",
    label: "完整收集",
    generation: 516,
    supplyUnits: 130,
    rewardCount: 26,
    scoredComplete: true,
  },
] as const) {
  test(`P01/P07 Chrome 新档正常游玩 M4 ${sample.label}导出升级同 content4 M5，恢复完整载荷且原字节不变`, () => {
    const url = new URL(`../docs/verification/evidence/${sample.file}`, import.meta.url);
    const sourceBytes = readFileSync(url);
    const envelope = JSON.parse(sourceBytes.toString("utf8")) as {
      saveGeneration: number;
      payload: SavePayload;
    };
    const original = envelope.payload;
    const unchanged = structuredClone(original);
    assert.equal(envelope.saveGeneration, sample.generation);
    const compatible = valid(original, actualM4, actualRegistry);
    assert.equal(compatible.migrated, undefined);
    assert.equal(original.schemaVersion, 2);
    assert.equal(original.contentVersion, 4);
    assert.equal(original.ruleVersion, 1);
    assert.equal(original.releaseProfileId, "M4");
    assert.deepEqual(original.scopeCompletionHistory, ["M4"]);
    assert.ok(original.completedObjectiveIds.includes("warehouse.complete"));
    assert.equal(typeof original.campaignCompletedAt, "string");
    assert.equal(Object.keys(original.completedRoomLayouts).length, 9);
    assert.deepEqual(
      new Set(Object.keys(original.completedRoomLayouts)),
      new Set(actualM4.staticChallenges.map((definition) => definition.id)),
    );
    assert.deepEqual(
      new Set(original.revealedGroupIds),
      new Set(["d.group.permission03", "d.group.permission04", "d.group.hidden"]),
    );

    const upgraded = valid(original, actualM5, actualRegistry);
    assert.equal(upgraded.migrated, true);
    assert.deepEqual(upgraded.value, { ...original, releaseProfileId: "M5" });
    for (const payload of [original, upgraded.value]) {
      assert.deepEqual(supplyProgress(actualM5, payload), {
        collected: sample.supplyUnits,
        total: 130,
        count: sample.rewardCount,
      });
      for (const area of ["a", "b", "c", "d"] as const) {
        const data = areaData(actualM5, payload, area);
        assert.equal(data.collected, 100);
        assert.equal(data.complete, true);
      }
      for (const [objectiveId, rewardId] of [
        ["a.firewall.inner", "a.supply.firewall.inner"],
        ["a.firewall.deep", "a.supply.firewall.deep"],
        ["a.firewall.core", "a.supply.firewall.core"],
        ["b.antivirus.light", "b.supply.antivirus.light"],
        ["b.antivirus.medium", "b.supply.antivirus.medium"],
        ["b.antivirus.heavy", "b.supply.antivirus.heavy"],
      ] as const) {
        assert.equal(payload.completedObjectiveIds.includes(objectiveId), sample.scoredComplete);
        assert.equal(payload.claimedRewardIds.includes(rewardId), sample.scoredComplete);
        assert.equal(
          payload.bestResults.some((result) => result.challengeId === objectiveId),
          sample.scoredComplete,
        );
      }
    }
    const restored = restorePayload(upgraded.value, actualM5, 123456);
    assert.deepEqual(stablePayload(restored), upgraded.value);
    assert.deepEqual(restored.completedRoomLayouts, original.completedRoomLayouts);
    assert.deepEqual(restored.bestResults, original.bestResults);
    assert.deepEqual(restored.revealedGroupIds, original.revealedGroupIds);
    assert.deepEqual(restored.playerPosition, original.playerPosition);
    assert.equal(valid(stablePayload(restored), actualM5, actualRegistry).migrated, undefined);

    const continued = new Session(actualM5, restored);
    continued.send({ kind: "Teleport", teleportId: "hub.teleport" });
    assert.equal(continued.state.playerPosition.tileId, "hub.t.0.2");
    assert.deepEqual(continued.state.claimedRewardIds, original.claimedRewardIds);
    assert.deepEqual(continued.state.completedRoomLayouts, original.completedRoomLayouts);
    assert.deepEqual(continued.state.bestResults, original.bestResults);
    valid(stablePayload(continued.state), actualM5, actualRegistry);
    assert.deepEqual(original, unchanged);
    assert.deepEqual(readFileSync(url), sourceBytes);
  });
}

test("G09/P07 M4 已完成仓库的真实全收集档在 M5 首次访问挑战不重复结算事件", () => {
  const url = new URL(
    "../docs/verification/evidence/m4-chrome-browser-full-save.json",
    import.meta.url,
  );
  const bytes = readFileSync(url);
  const original = (JSON.parse(bytes.toString("utf8")) as { payload: SavePayload }).payload;
  const payload = valid(original, actualM5, actualRegistry).value;
  let state = restorePayload(payload, actualM5, 0);
  const events = [];
  const commands: GameCommand[] = [
    { kind: "Teleport", teleportId: "a.teleport" },
    { kind: "Move", direction: "up" },
    { kind: "Move", direction: "up" },
    { kind: "Move", direction: "up" },
    { kind: "Interact" },
  ];
  for (const [index, command] of commands.entries()) {
    const result = dispatch(actualM5, state, command, (index + 1) * 140, savedAt);
    assert.equal(result.code, "accepted");
    state = result.state;
    events.push(...result.events);
  }
  assert.equal(state.mode, "challengeReady");
  assert.deepEqual(state.scopeCompletionHistory, ["M4", "M5"]);
  assert.equal(events.filter((event) => event.kind === "success").length, 0);
  assert.equal(events.filter((event) => event.kind === "pickup").length, 0);
  assert.deepEqual(state.claimedRewardIds, original.claimedRewardIds);
  assert.equal(state.campaignCompletedAt, original.campaignCompletedAt);
  const restored = restorePayload(
    valid(stablePayload(state), actualM5, actualRegistry).value,
    actualM5,
    0,
  );
  assert.deepEqual(restored.scopeCompletionHistory, ["M4", "M5"]);
  assert.deepEqual(readFileSync(url), bytes);
});
