// These tests replay the original v1 recordings/exports against their published content view.
import assert from "node:assert/strict";
import test from "node:test";
import { assembleLegacyContent as assembleContent } from "../src/content/assemble.ts";
import { replayWorldWitness } from "../src/content/validate.ts";
import type { WorldWitness } from "../src/content/validate.ts";
import { createGame, dispatch, safePath, tileCleared } from "../src/core/engine.ts";
import { areaData, currentObjective, gateOpen, supplyProgress } from "../src/core/progress.ts";
import type { GameState } from "../src/core/types.ts";
import witnessContent from "../src/content/witnesses/m1.json" with { type: "json" };

const content = assembleContent("M1");
const witnesses = witnessContent.witnesses as WorldWitness[];
const mainWitness = witnesses.find((witness) => witness.id === "m1.world.main-path")!;
const fullWitness = witnesses.find(
  (witness) => witness.id === "m1.world.full-collection-and-return",
)!;
const main = replayWorldWitness(content, mainWitness);
const full = replayWorldWitness(content, fullWitness);

function firstState(
  predicate: (state: GameState) => boolean,
  witness = fullWitness,
): { state: GameState; now: number } {
  let state = createGame(content, 0);
  for (const step of witness.steps) {
    state = dispatch(content, state, step.command, step.atMs).state;
    if (predicate(state)) return { state, now: step.atMs };
  }
  throw new Error("Witness never reached required state");
}
function advance(
  initial: { state: GameState; now: number },
  duration: number,
): { state: GameState; now: number } {
  let { state, now } = initial;
  for (let remaining = duration; remaining > 0;) {
    const delta = Math.min(250, remaining);
    remaining -= delta;
    now += delta;
    state = dispatch(content, state, { kind: "Tick" }, now).state;
  }
  return { state, now };
}

test("G01/G02/G10：新档经真实命令完成 M1 主路径，不要求数据支路或防火墙", () => {
  assert.deepEqual(main.issues, []);
  assert.equal(main.commandCount, 40);
  assert.deepEqual(
    new Set(main.state.completedObjectiveIds),
    new Set(["hub.amplifier", "hub.tutorial", "a.nexus.route", "a.maze.01", "a.main"]),
  );
  assert.equal(main.state.playerPosition.tileId, "a.t.7.0");
  assert.equal(supplyProgress(content, main.state).collected, 6);
  assert.equal(areaData(content, main.state, "a").collected, 20);
  assert.equal(main.state.bestResults.length, 0);
  assert.deepEqual(main.state.scopeCompletionHistory, ["M1"]);
  assert.match(currentObjective(content, main.state), /本版本主路径完成/);
  assert.equal(main.state.campaignCompletedAt, null);
});

test("G09/G10：M1 完整收集、重玩和往返后仍只有六个奖励 ID 与 26 单位", () => {
  assert.deepEqual(full.issues, []);
  assert.equal(full.commandCount, 1309);
  assert.equal(full.pickupEventCount, 6);
  assert.deepEqual(
    new Set(full.state.claimedRewardIds),
    new Set(content.profile.includedRewardIds),
  );
  assert.equal(
    full.state.completedObjectiveIds.length,
    content.profile.includedObjectiveIds.length,
  );
  assert.deepEqual(supplyProgress(content, full.state), { collected: 26, total: 26, count: 6 });
  assert.deepEqual(areaData(content, full.state, "a"), {
    collected: 80,
    total: 100,
    includedCollected: 80,
    includedTotal: 80,
    complete: false,
  });
  assert.equal(gateOpen(content, full.state, "gate.warehouse"), false);
  assert.equal(full.state.playerPosition.tileId, "a.t.0.0");
});

test("G10：B 和仓库未收录边界保留提示，不加载未来可执行目的地", () => {
  const checkpoint = full.checkpoints["unreleased-b-boundary"]!;
  assert.equal(checkpoint.playerPosition.areaId, "a");
  assert.equal(checkpoint.playerPosition.tileId, "a.t.8.0");
  assert.equal(checkpoint.lastResult.code, "blocked");
  assert.equal(checkpoint.completedObjectiveIds.includes("b.main"), false);
  const attempted = dispatch(
    content,
    createGame(content),
    { kind: "Teleport", teleportId: "b.teleport" },
    0,
  );
  assert.equal(attempted.code, "unmetCondition");
  assert.equal(attempted.stable, false);
});

test("G09：先完成核心并领取，内层与深层未完成也不会阻挡可选路线", () => {
  const { state } = firstState((state) =>
    state.claimedRewardIds.includes("a.supply.firewall.core"),
  );
  assert.equal(state.completedObjectiveIds.includes("a.firewall.core"), true);
  assert.equal(state.completedObjectiveIds.includes("a.firewall.inner"), false);
  assert.equal(state.completedObjectiveIds.includes("a.firewall.deep"), false);
  assert.equal(state.playerPosition.tileId, "a.t.-4.-4");
});

test("I05：发现覆盖格不会清除；增幅只改变当前节点列出的覆盖与教学事务", () => {
  let state = createGame(content, 0);
  let now = 0;
  for (let count = 0; count < 3; count += 1) {
    now += 140;
    state = dispatch(content, state, { kind: "Move", direction: "right" }, now).state;
  }
  assert.equal(state.playerPosition.tileId, "hub.t.3.2");
  assert.equal(state.discoveredTileIds.includes("hub.t.4.2"), true);
  assert.equal(tileCleared(content, state, "hub.t.4.2"), false);
  const blocked = dispatch(content, state, { kind: "Move", direction: "right" }, now + 140);
  assert.equal(blocked.code, "blocked");
  assert.equal(blocked.stable, false);
  assert.equal(blocked.state.stateRevision, state.stateRevision);
  state = dispatch(content, blocked.state, { kind: "Amplify" }, now + 280).state;
  assert.equal(tileCleared(content, state, "hub.t.4.2"), true);
  assert.equal(tileCleared(content, state, "hub.t.5.2"), true);
  assert.equal(tileCleared(content, state, "a.t.2.0"), false);
  assert.equal(state.visitedTileIds.includes("hub.t.5.2"), false);
  assert.deepEqual(state.capabilities, ["amplifier", "unlimitedAmplifier"]);
  assert.deepEqual(state.claimedRewardIds, ["hub.supply.tutorial"]);
});

test("S01：迷宫观察在有效 3,999ms 仍拒绝移动，4,000ms 转活动态", () => {
  const entered = firstState((state) => state.mode === "staticPuzzle", mainWitness);
  const before = advance(entered, 3999);
  const early = dispatch(content, before.state, { kind: "Move", direction: "up" }, before.now);
  assert.equal(early.code, "wrongMode");
  assert.equal(early.state.phase, "preview");
  const ready = dispatch(content, early.state, { kind: "Tick" }, before.now + 1);
  assert.equal(ready.state.phase, "active");
  assert.equal(ready.state.clock.activeTimeMs, 4000);
  assert.equal(
    dispatch(content, ready.state, { kind: "Move", direction: "up" }, before.now + 141).code,
    "accepted",
  );
});

test("S01/T11：观察中失焦 30 秒不消耗时间，重新显露仍须显式恢复", () => {
  const entered = firstState((state) => state.mode === "staticPuzzle", mainWitness);
  const before = advance(entered, 3999);
  let state = dispatch(
    content,
    before.state,
    { kind: "Pause", reason: "hidden", present: true },
    before.now,
  ).state;
  state = dispatch(content, state, { kind: "Tick" }, before.now + 30000).state;
  assert.equal(state.clock.activeTimeMs, 3999);
  state = dispatch(
    content,
    state,
    { kind: "Pause", reason: "hidden", present: false },
    before.now + 30000,
  ).state;
  assert.equal(
    dispatch(content, state, { kind: "Move", direction: "up" }, before.now + 30000).code,
    "paused",
  );
  state = dispatch(
    content,
    state,
    { kind: "Resume", pageVisible: true, canvasOperable: true, graphicsAvailable: true },
    before.now + 30000,
  ).state;
  assert.equal(state.clock.countdownRemainingMs, 0);
  state = dispatch(content, state, { kind: "Tick" }, before.now + 30001).state;
  assert.equal(state.phase, "active");
});

test("S01/S08：危险失败与放弃只丢弃房间尝试，永久教学和入口不变", () => {
  const initial = advance(
    firstState((state) => state.mode === "staticPuzzle", mainWitness),
    4000,
  );
  const first = dispatch(
    content,
    initial.state,
    { kind: "Move", direction: "up" },
    initial.now + 140,
  );
  const failure = dispatch(
    content,
    first.state,
    { kind: "Move", direction: "right" },
    initial.now + 280,
  );
  assert.equal(failure.code, "failed");
  assert.equal(failure.state.phase, "preview");
  assert.equal(failure.state.playerPosition.tileId, "a.maze.01.t.0.4");
  assert.equal(failure.state.clock.activeTimeMs, 0);
  assert.deepEqual(failure.state.claimedRewardIds, ["hub.supply.tutorial"]);
  assert.deepEqual(failure.state.completedObjectiveIds, initial.state.completedObjectiveIds);
  const exit = dispatch(content, failure.state, { kind: "ExitRoom" }, initial.now + 420);
  assert.equal(exit.state.playerPosition.tileId, "a.t.3.0");
  assert.equal(exit.state.activeStatic, null);
  assert.equal(exit.state.mode, "explore");
});

test("S09：独立练习与重复实时成功保留门、奖励和最好成绩", () => {
  const practiced = full.checkpoints["practice-preserves-permanent-results"]!;
  const repeated = full.checkpoints["repeated-reward-still-26"]!;
  assert.equal(practiced.playerPosition.tileId, "a.t.3.0");
  assert.deepEqual(practiced.claimedRewardIds, repeated.claimedRewardIds);
  assert.equal(gateOpen(content, practiced, "gate.a.maze.01"), true);
  assert.equal(gateOpen(content, repeated, "gate.a.firewall.inner"), true);
  assert.deepEqual(
    repeated.bestResults.map((result) => [result.challengeId, result.bestCombo]),
    [
      ["a.firewall.tutorial", 12],
      ["a.firewall.core", 70],
      ["a.firewall.deep", 55],
      ["a.firewall.inner", 40],
    ],
  );
});

test("I03/I06：远距离点击只走已访问安全路径一步，静态棋盘不允许远点击", () => {
  const final = full.state;
  const now = final.clock.lastMonotonicTimeMs;
  assert.deepEqual(safePath(content, final, "a.t.0.-2"), ["a.t.0.-1", "a.t.0.-2"]);
  const first = dispatch(content, final, { kind: "ClickTile", tileId: "a.t.0.-2" }, now + 140);
  assert.equal(first.state.playerPosition.tileId, "a.t.0.-1");
  assert.deepEqual(first.state.autoPath, ["a.t.0.-2"]);
  const changed = dispatch(content, first.state, { kind: "Move", direction: "down" }, now + 280);
  assert.deepEqual(changed.state.autoPath, []);
  const initial = advance(
    firstState((state) => state.mode === "staticPuzzle", mainWitness),
    4000,
  );
  const jump = dispatch(
    content,
    initial.state,
    { kind: "ClickTile", tileId: "a.maze.01.t.4.0" },
    initial.now + 140,
  );
  assert.equal(jump.code, "invalidTarget");
  assert.equal(jump.state.playerPosition.tileId, initial.state.playerPosition.tileId);
});

test("I09：物理传送与地图传送都保持同一进度，落点 Tick 不反向回跳", () => {
  const hub = full.checkpoints["returned-to-hub"]!;
  const reentered = full.checkpoints["reentered-a"]!;
  assert.equal(hub.playerPosition.tileId, "hub.t.0.2");
  assert.equal(reentered.playerPosition.tileId, "a.t.0.0");
  assert.deepEqual(hub.claimedRewardIds, reentered.claimedRewardIds);
  assert.deepEqual(
    new Set(reentered.activatedTeleportIds),
    new Set(["hub.teleport", "a.teleport"]),
  );
  const tick = dispatch(
    content,
    reentered,
    { kind: "Tick" },
    reentered.clock.lastMonotonicTimeMs + 140,
  );
  assert.deepEqual(tick.state.playerPosition, reentered.playerPosition);
});

test("I08：完整重放不修改调用者旧快照，所有反馈事件 ID 唯一且修订号仅随稳定动作增加", () => {
  let state = createGame(content, 0);
  const eventIds = new Set<number>();
  for (const step of fullWitness.steps) {
    const before = JSON.stringify(state);
    const result = dispatch(content, state, step.command, step.atMs);
    assert.equal(JSON.stringify(state), before, `${step.atMs}: previous snapshot changed`);
    assert.equal(result.state.stateRevision, state.stateRevision + (result.stable ? 1 : 0));
    for (const event of result.events) {
      assert.equal(eventIds.has(event.id), false);
      eventIds.add(event.id);
    }
    state = result.state;
  }
  assert.equal(state.claimedRewardIds.length, 6);
});
