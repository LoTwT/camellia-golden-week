// These tests replay the original v1 recordings/exports against their published content view.
import assert from "node:assert/strict";
import test from "node:test";
import {
  assembleLegacyContent as assembleContent,
  staticContent,
} from "../src/content/history/pre-r1/assemble.ts";
import {
  replayWorldWitness,
  validateContent,
  validateWorldWitness,
} from "../src/content/history/pre-r1/validate.ts";
import type {
  WorldWitness,
  WorldWitnessExpectation,
} from "../src/content/history/pre-r1/validate.ts";
import { createGame, dispatch } from "../src/content/history/pre-r1/engine.ts";
import {
  areaData,
  currentObjective,
  gateOpen,
  supplyProgress,
} from "../src/content/history/pre-r1/progress.ts";
import {
  completedStaticExitTileId,
  isCompletedStaticPosition,
  replayStaticWitness,
  validateCompletedStaticLayout,
} from "../src/content/history/pre-r1/static-puzzle.ts";
import type {
  StaticDirection,
  StaticTile,
  StaticWitness,
} from "../src/content/history/pre-r1/static-puzzle.ts";
import type { GameCommand, GameState } from "../src/content/history/pre-r1/types.ts";
import { additiveProfileMigrations } from "../src/content/history/pre-r1/migrations.ts";
import {
  restorePayload,
  stablePayload,
  validatePayload,
} from "../src/content/history/pre-r1/save-payload.ts";
import m2Json from "../src/content/witnesses/m2.json" with { type: "json" };
import m3Json from "../src/content/witnesses/m3.json" with { type: "json" };

interface Continuation extends WorldWitness {
  readonly initialStateId: string;
  readonly initialProfileId: "M2";
  readonly initialization: "stable-payload-migration";
  readonly expectedBData: number;
  readonly expectedCData: number;
}

const content = assembleContent("M3");
const m2Content = assembleContent("M2");
const migrationRegistry = additiveProfileMigrations([assembleContent("M1"), m2Content, content]);
const witnesses = m3Json.witnesses as WorldWitness[];
const mainWitness = witnesses.find((witness) => witness.id === "m3.world.main-path")!;
const fullWitness = witnesses.find(
  (witness) => witness.id === "m3.world.full-collection-and-return",
)!;
const main = replayWorldWitness(content, mainWitness);
const full = replayWorldWitness(content, fullWitness);
const continuations = m3Json.continuations as Continuation[];
const roomIds = ["c.routing.01", "c.theft.01", "c.theft.02", "c.theft.03"] as const;
const directionOffsets: ReadonlyArray<readonly [StaticDirection, number, number]> = [
  ["up", 0, -1],
  ["right", 1, 0],
  ["down", 0, 1],
  ["left", -1, 0],
];

class Session {
  state: GameState;
  now: number;

  constructor(state: GameState, now: number) {
    this.state = state;
    this.now = now;
  }

  send(command: GameCommand, expectedCode = "accepted", delta = 140) {
    this.now += delta;
    const result = dispatch(content, this.state, command, this.now);
    assert.equal(
      result.code,
      expectedCode,
      `${this.state.playerPosition.tileId} ${JSON.stringify(command)}: ${result.state.lastResult.message}`,
    );
    this.state = result.state;
    return result;
  }

  move(...directions: StaticDirection[]): void {
    for (const direction of directions) this.send({ kind: "Move", direction });
  }
}

function firstState(predicate: (state: GameState) => boolean, witness = fullWitness): Session {
  let state = createGame(content, 0);
  for (const step of witness.steps) {
    const result = dispatch(content, state, step.command, step.atMs);
    assert.equal(result.code, step.expectedCode);
    state = result.state;
    if (predicate(state)) return new Session(state, step.atMs);
  }
  throw new Error("固定世界见证未到达所需状态");
}

function staticWitness(roomId: string, variant: "success" | "alternative" | "recovery") {
  const witness = staticContent.witnesses.find(
    (candidate) => candidate.id === `${roomId}.witness.${variant}`,
  );
  assert.ok(witness);
  return witness;
}

function actionCommand(action: StaticWitness["actions"][number]): GameCommand {
  if (action === "undo") return { kind: "Undo" };
  if (action === "reset") return { kind: "ResetRoom" };
  assert.notEqual(action, "activate", "C 机关无观察计时或激活后门");
  return { kind: "Move", direction: action as StaticDirection };
}

function playStatic(session: Session, witness: StaticWitness): void {
  for (const [index, action] of witness.actions.entries())
    session.send(actionCommand(action), witness.expectedCodes[index]);
}

function permanentPuzzleProgress(state: GameState) {
  return {
    completedObjectiveIds: state.completedObjectiveIds,
    claimedRewardIds: state.claimedRewardIds,
    completedRoomLayouts: state.completedRoomLayouts,
    bestResults: state.bestResults,
  };
}

function matchesExpectation(state: GameState, expected: WorldWitnessExpectation): void {
  assert.equal(state.playerPosition.areaId, expected.areaId);
  assert.equal(state.playerPosition.tileId, expected.tileId);
  assert.equal(state.mode, expected.mode);
  for (const id of expected.completedObjectiveIds)
    assert.ok(state.completedObjectiveIds.includes(id), id);
  for (const id of expected.absentObjectiveIds)
    assert.ok(!state.completedObjectiveIds.includes(id), id);
  assert.deepEqual(new Set(state.claimedRewardIds), new Set(expected.claimedRewardIds));
  assert.equal(supplyProgress(content, state).collected, expected.supplyUnits);
  assert.equal(areaData(content, state, "a").collected, expected.aData);
}

function enterCompletedRoom(session: Session, roomId: (typeof roomIds)[number]): void {
  assert.equal(session.state.playerPosition.tileId, "c.t.0.0");
  if (roomId === "c.routing.01") session.move("right", "right");
  else {
    session.move("up", "up");
    for (let count = 0; count < Number(roomId.slice(-2)) * 2; count += 1) session.move("left");
    session.send({ kind: "Interact" });
  }
  assert.equal(session.state.mode, "completedRoom");
  assert.equal(session.state.activeCompletedRoom?.roomId, roomId);
}

/** Navigate only free completed-layout floors; every edge is still a normal Move command. */
function walkBesideFrozenObject(session: Session): StaticDirection {
  const roomId = session.state.activeCompletedRoom?.roomId;
  const definition = content.staticChallenges.find((candidate) => candidate.id === roomId);
  assert.ok(definition);
  const layout = session.state.completedRoomLayouts[definition.id];
  assert.ok(layout);
  const exitTileId = completedStaticExitTileId(definition);
  const occupied = new Set(Object.values(layout.objectTileById));
  const queue: { tileId: string; path: StaticDirection[] }[] = [
    { tileId: session.state.playerPosition.tileId, path: [] },
  ];
  const seen = new Set([session.state.playerPosition.tileId]);
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]!;
    const from = definition.tiles.find((tile) => tile.id === current.tileId)!;
    for (const [direction, dx, dy] of directionOffsets) {
      const next = definition.tiles.find(
        (tile) => tile.x === from.x + dx && tile.y === from.y + dy,
      );
      if (!next) continue;
      if (occupied.has(next.id)) {
        session.move(...current.path);
        return direction;
      }
      if (
        next.id === exitTileId ||
        seen.has(next.id) ||
        !isCompletedStaticPosition(definition, layout, next.id)
      )
        continue;
      seen.add(next.id);
      queue.push({ tileId: next.id, path: [...current.path, direction] });
    }
  }
  throw new Error("实际完成布局没有可步行访问的对象侧面");
}

test("M3 正式装配 C 的41格/4房闭合，固定17奖励81单位与260本版数据", () => {
  assert.deepEqual(validateContent(content), []);
  assert.equal(content.areas.length, 4);
  assert.equal(content.tiles.length, 146);
  assert.equal(content.tiles.filter((tile) => tile.boardId === "c").length, 41);
  assert.equal(content.rooms.length, 16);
  assert.equal(content.rooms.filter((room) => room.areaId === "c").length, 4);
  assert.equal(content.profile.includedRewardIds.length, 17);
  assert.equal(
    content.rewards.reduce((sum, reward) => sum + reward.units, 0),
    81,
  );
  assert.equal(
    content.dataNodes.reduce((sum, node) => sum + node.weight, 0),
    260,
  );
  assert.equal(
    content.tiles.some((tile) => tile.boardId === "d" || tile.id.includes("revisit")),
    false,
  );
  assert.equal(
    content.entities.some((entity) => entity.id === "c.to.d"),
    false,
  );
  assert.equal(
    content.entities.find((entity) => entity.id === "c.to.d.unavailable")?.kind,
    "unavailable",
  );
});

test("G02/G03/G10：新档完成 C 主线只需球车机关，三盗取与计分均未完成", () => {
  assert.deepEqual(main.issues, []);
  assert.equal(main.commandCount, 131);
  assert.equal(main.pickupEventCount, 3);
  for (const areaId of ["a", "b", "c"] as const)
    assert.equal(areaData(content, main.state, areaId).collected, 20);
  assert.deepEqual(main.state.completedObjectiveIds.filter((id) => id.startsWith("c.")).sort(), [
    "c.main",
    "c.routing.01",
  ]);
  assert.equal(main.state.bestResults.length, 0);
  assert.equal(gateOpen(content, main.state, "gate.c.main"), true);
  assert.equal(supplyProgress(content, main.state).collected, 11);
  assert.deepEqual(main.state.scopeCompletionHistory, ["M3"]);
  assert.equal(main.state.campaignCompletedAt, null);
  assert.match(currentObjective(content, main.state), /本版本主路径完成/);
  assert.equal(main.checkpoints["unreleased-d-boundary"]?.playerPosition.tileId, "c.t.8.0");
  assert.equal(main.checkpoints["routing-return-loop"]?.playerPosition.tileId, "c.t.0.0");
});

test("G03/I09：主机关未完成时返程门阻挡，放弃回安全入口且无目标泄漏", () => {
  const beforeRoom = firstState((state) => state.playerPosition.tileId === "c.t.1.1", mainWitness);
  const blocked = beforeRoom.send({ kind: "Move", direction: "right" }, "unmetCondition");
  assert.equal(blocked.stable, false);
  assert.equal(beforeRoom.state.playerPosition.tileId, "c.t.1.1");
  assert.equal(gateOpen(content, beforeRoom.state, "gate.c.routing.01"), false);
  const inRoom = firstState((state) => state.activeStatic?.roomId === "c.routing.01", mainWitness);
  const before = permanentPuzzleProgress(inRoom.state);
  inRoom.move("up", "up", "right");
  inRoom.send({ kind: "ExitRoom" });
  assert.equal(inRoom.state.playerPosition.tileId, "c.t.1.0");
  assert.equal(inRoom.state.mode, "explore");
  assert.deepEqual(permanentPuzzleProgress(inRoom.state), before);
  inRoom.move("right");
  assert.deepEqual(
    inRoom.state.activeStatic?.state.currentLayout,
    inRoom.state.activeStatic?.state.attemptBaseline.layout,
  );
});

test("G09/S04：前后两份机关物资独立，三盗取及侧路可先于主机关取得80数据", () => {
  const entry = full.checkpoints["entry-supply-before-routing"]!;
  assert.equal(supplyProgress(content, entry).collected, 56);
  assert.equal(entry.completedObjectiveIds.includes("c.routing.01"), false);
  assert.equal(entry.claimedRewardIds.includes("c.supply.route.entry"), true);
  assert.equal(entry.claimedRewardIds.includes("c.supply.route.exit"), false);
  const optional = full.checkpoints["optional-c-before-routing"]!;
  assert.equal(optional.completedObjectiveIds.includes("c.routing.01"), false);
  assert.equal(optional.completedObjectiveIds.includes("c.main"), false);
  assert.equal(areaData(content, optional, "c").collected, 80);
  assert.equal(supplyProgress(content, optional).collected, 76);
  const exit = full.checkpoints["route-exit-supply-before-main"]!;
  assert.equal(exit.completedObjectiveIds.includes("c.routing.01"), true);
  assert.equal(exit.completedObjectiveIds.includes("c.main"), false);
  assert.equal(areaData(content, exit, "c").collected, 80);
  assert.equal(supplyProgress(content, exit).collected, 81);
});

test("G09/G10：新档全收集17个唯一奖励、81物资，A80/B80/C100且未伪造完整通关", () => {
  assert.deepEqual(full.issues, []);
  assert.equal(full.commandCount, 2788);
  assert.equal(full.pickupEventCount, 17);
  assert.deepEqual(
    new Set(full.state.claimedRewardIds),
    new Set(content.profile.includedRewardIds),
  );
  assert.deepEqual(
    new Set(full.state.completedObjectiveIds),
    new Set(content.profile.includedObjectiveIds),
  );
  assert.equal(supplyProgress(content, full.state).collected, 81);
  for (const areaId of ["a", "b"] as const) {
    assert.equal(areaData(content, full.state, areaId).collected, 80);
    assert.equal(areaData(content, full.state, areaId).includedTotal, 80);
    assert.equal(areaData(content, full.state, areaId).complete, false);
  }
  assert.equal(areaData(content, full.state, "c").collected, 100);
  assert.equal(areaData(content, full.state, "c").complete, true);
  assert.deepEqual(full.state.scopeCompletionHistory, ["M3"]);
  assert.equal(full.state.campaignCompletedAt, null);
});

for (const roomId of roomIds) {
  for (const variant of ["success", "alternative", "recovery"] as const) {
    test(`S04/S05/S06/S08：真实入口 ${roomId} ${variant} 按布局成功且提交前不泄漏`, () => {
      const session = firstState((state) => state.activeStatic?.roomId === roomId);
      const before = permanentPuzzleProgress(session.state);
      const beforeData = areaData(content, session.state, "c").collected;
      const definition = content.staticChallenges.find((candidate) => candidate.id === roomId)!;
      const witness = staticWitness(roomId, variant);
      const localResult = replayStaticWitness(definition, witness);
      assert.deepEqual(localResult.errors, []);
      let movedObjects = 0;
      for (const [index, action] of witness.actions.entries()) {
        const prior = session.state.activeStatic!.state;
        const result = session.send(actionCommand(action), witness.expectedCodes[index]);
        const current = session.state.activeStatic?.state;
        if (result.code === "success") {
          assert.equal(index, witness.actions.length - 1);
          assert.equal(result.stable, true);
          continue;
        }
        assert.deepEqual(permanentPuzzleProgress(session.state), before);
        assert.equal(areaData(content, session.state, "c").collected, beforeData);
        assert.ok(current);
        if (action === "undo") {
          const previousStep = prior.undoStack.at(-1)!;
          assert.equal(session.state.playerPosition.tileId, previousStep.playerTileId);
          assert.deepEqual(current.currentLayout, previousStep.layout);
        } else if (action === "reset") {
          assert.equal(session.state.playerPosition.tileId, prior.attemptBaseline.playerTileId);
          assert.deepEqual(current.currentLayout, prior.attemptBaseline.layout);
          assert.deepEqual(current.undoStack, []);
        } else if (result.code === "blocked") {
          assert.equal(result.stable, false);
          assert.deepEqual(current, prior);
        } else if (definition.kind === "theft") {
          const changed = definition.objectIds.filter(
            (id) =>
              prior.currentLayout.objectTileById[id] !== current.currentLayout.objectTileById[id],
          );
          assert.ok(changed.length <= 1, "一次命令不串推");
          for (const id of changed) {
            const fromTile: StaticTile = definition.tiles.find(
              (tile) => tile.id === prior.currentLayout.objectTileById[id],
            )!;
            const toTile: StaticTile = definition.tiles.find(
              (tile) => tile.id === current.currentLayout.objectTileById[id],
            )!;
            assert.equal(Math.abs(fromTile.x - toTile.x) + Math.abs(fromTile.y - toTile.y), 1);
            assert.equal(session.state.playerPosition.tileId, fromTile.id);
            movedObjects += 1;
          }
        }
      }
      if (definition.kind === "theft") assert.ok(movedObjects > 0);
      assert.equal(session.state.mode, "explore");
      assert.equal(
        session.state.playerPosition.tileId,
        content.rooms.find((room) => room.id === roomId)?.successExitTileId,
      );
      assert.deepEqual(
        session.state.claimedRewardIds,
        before.claimedRewardIds,
        "成功只开独立拾取门",
      );
      assert.equal(
        areaData(content, session.state, "c").collected,
        beforeData + (roomId === "c.routing.01" ? 0 : 20),
      );
      assert.deepEqual(
        session.state.completedRoomLayouts[roomId]?.objectTileById,
        localResult.state.currentLayout.objectTileById,
      );
      assert.deepEqual(
        validateCompletedStaticLayout(definition, session.state.completedRoomLayouts[roomId]),
        [],
      );
      assert.equal(session.state.completedObjectiveIds.filter((id) => id === roomId).length, 1);
      if (roomId !== "c.routing.01") {
        assert.equal(session.state.completedObjectiveIds.includes("c.main"), false);
        const claimedBefore = session.state.claimedRewardIds.length;
        session.move("up", "up");
        assert.equal(session.state.claimedRewardIds.length, claimedBefore + 1);
        session.move("down", "up");
        assert.equal(session.state.claimedRewardIds.length, claimedBefore + 1);
      }
    });
  }
}

test("S04：实际球车房间车只推一格，未布置车时滑球可进死角且 Z 恢复整个移动", () => {
  const session = firstState((state) => state.activeStatic?.roomId === "c.routing.01");
  const definition = content.staticChallenges.find((candidate) => candidate.id === "c.routing.01")!;
  assert.equal(definition.kind, "routing");
  if (definition.kind !== "routing") return;
  const initial = session.state.activeStatic!.state.currentLayout;
  session.move("right", "right", "right", "right", "up");
  assert.equal(
    session.state.activeStatic?.state.currentLayout.objectTileById[definition.cartIds[0]!],
    "c.routing.01.t.5.3",
  );
  assert.equal(session.state.playerPosition.tileId, "c.routing.01.t.5.4");
  session.send({ kind: "ResetRoom" }, "reset");
  session.move("up", "up");
  const playerBefore = session.state.playerPosition.tileId;
  session.move("right");
  assert.equal(
    session.state.activeStatic?.state.currentLayout.objectTileById[definition.ballIds[0]!],
    "c.routing.01.t.5.3",
  );
  assert.equal(session.state.playerPosition.tileId, "c.routing.01.t.2.3");
  session.send({ kind: "Undo" }, "undone");
  assert.equal(session.state.playerPosition.tileId, playerBefore);
  assert.deepEqual(session.state.activeStatic?.state.currentLayout, initial);
  assert.equal(session.state.completedObjectiveIds.includes("c.routing.01"), false);
});

test("S06：盗取02的世界替代解真实交换同色对象，按颜色和槽集合成功", () => {
  const definition = content.staticChallenges.find((candidate) => candidate.id === "c.theft.02")!;
  assert.equal(definition.kind, "theft");
  if (definition.kind !== "theft") return;
  const ordinary = replayStaticWitness(definition, staticWitness(definition.id, "success"));
  const actual = full.state.completedRoomLayouts[definition.id]!;
  for (const objectId of definition.objectIds)
    assert.notEqual(
      actual.objectTileById[objectId],
      ordinary.state.currentLayout.objectTileById[objectId],
    );
  assert.deepEqual(
    new Set(Object.values(actual.objectTileById)),
    new Set(Object.values(definition.socketTileById)),
  );
  assert.deepEqual(validateCompletedStaticLayout(definition, actual), []);
});

for (const roomId of roomIds) {
  test(`S08/P01：${roomId} 推物中途保存恢复后无撤销历史、重置回原布局仍可解`, () => {
    const session = firstState((state) => state.activeStatic?.roomId === roomId);
    const before = permanentPuzzleProgress(session.state);
    const witness = staticWitness(roomId, "recovery");
    const undoIndex = witness.actions.indexOf("undo");
    assert.ok(undoIndex > 0);
    for (let index = 0; index < undoIndex; index += 1)
      session.send(actionCommand(witness.actions[index]!), witness.expectedCodes[index]);
    const payload = stablePayload(session.state);
    const checked = validatePayload(payload, content);
    assert.equal(checked.ok, true);
    if (!checked.ok) return;
    const restored = new Session(restorePayload(checked.value, content, 0), 0);
    assert.equal(restored.state.playerPosition.tileId, session.state.playerPosition.tileId);
    assert.deepEqual(
      restored.state.activeStatic?.state.currentLayout,
      session.state.activeStatic?.state.currentLayout,
    );
    assert.deepEqual(restored.state.activeStatic?.state.undoStack, []);
    assert.deepEqual(permanentPuzzleProgress(restored.state), before);
    restored.send({ kind: "Undo" }, "noHistory");
    restored.send({ kind: "ResetRoom" }, "reset");
    assert.deepEqual(
      restored.state.activeStatic?.state.currentLayout,
      session.state.activeStatic?.state.attemptBaseline.layout,
    );
    playStatic(restored, staticWitness(roomId, "success"));
    assert.ok(restored.state.completedObjectiveIds.includes(roomId));
    assert.deepEqual(restored.state.claimedRewardIds, before.claimedRewardIds);
  });

  test(`S09/P01：${roomId} 完成访问保留实际布局、对象不再推动，保存与独立练习均保持`, () => {
    const session = new Session(full.state, fullWitness.steps.at(-1)!.atMs);
    const before = permanentPuzzleProgress(session.state);
    enterCompletedRoom(session, roomId);
    const direction = walkBesideFrozenObject(session);
    const playerBefore = session.state.playerPosition.tileId;
    session.send({ kind: "Move", direction }, "blocked");
    assert.equal(session.state.playerPosition.tileId, playerBefore);
    assert.deepEqual(permanentPuzzleProgress(session.state), before);
    const checked = validatePayload(stablePayload(session.state), content);
    assert.equal(checked.ok, true);
    if (!checked.ok) return;
    const restored = new Session(restorePayload(checked.value, content, 0), 0);
    assert.equal(restored.state.mode, "completedRoom");
    assert.equal(restored.state.playerPosition.tileId, playerBefore);
    assert.deepEqual(permanentPuzzleProgress(restored.state), before);
    restored.send({ kind: "Move", direction }, "blocked");
    restored.send({ kind: "Undo" }, "alreadyCompleted");
    restored.send({ kind: "ResetRoom" }, "alreadyCompleted");
    restored.send({ kind: "ExitRoom" });
    assert.equal(
      restored.state.playerPosition.tileId,
      content.rooms.find((room) => room.id === roomId)?.returnTileId,
    );
    if (roomId === "c.routing.01") restored.move("right");
    else restored.send({ kind: "Interact" });
    restored.send({ kind: "PracticeRoom" });
    assert.equal(restored.state.activeStatic?.practice, true);
    assert.deepEqual(
      restored.state.activeStatic?.state.currentLayout.objectTileById,
      (
        content.staticChallenges.find((candidate) => candidate.id === roomId) as {
          initialObjectTileById: Readonly<Record<string, string>>;
        }
      ).initialObjectTileById,
    );
    playStatic(
      restored,
      staticWitness(roomId, roomId === "c.theft.02" ? "success" : "alternative"),
    );
    assert.deepEqual(permanentPuzzleProgress(restored.state), before);
    assert.equal(supplyProgress(content, restored.state).collected, 81);
  });
}

test("S09/G09：完整公开见证里的完成出口、独立练习、重复拾取和区域往返不重复发奖", () => {
  const before = full.checkpoints["all-first-visit-collection"]!;
  for (const name of [
    "completed-routing-safe-return",
    "completed-routing-exit-pad",
    "routing-practice-preserves-layout",
    "same-color-practice-preserves-layout",
    "repeated-c-pickups-still-81",
    "physical-return-to-b",
    "physical-reentry-c",
    "activated-c-map-teleport",
  ]) {
    const after = full.checkpoints[name]!;
    assert.ok(after, name);
    assert.deepEqual(permanentPuzzleProgress(after), permanentPuzzleProgress(before), name);
    assert.equal(supplyProgress(content, after).collected, 81);
  }
});

for (const continuation of continuations) {
  test(`P07：真实 M2 保存载荷升级后正常续玩 ${continuation.id}`, () => {
    const original = (m2Json.witnesses as WorldWitness[]).find(
      (witness) => witness.id === continuation.initialStateId,
    );
    assert.ok(original);
    const source = replayWorldWitness(m2Content, original);
    assert.deepEqual(source.issues, []);
    const payload = stablePayload(source.state);
    const originalJSON = JSON.stringify(payload);
    const migrated = validatePayload(payload, content, migrationRegistry);
    assert.equal(migrated.ok, true);
    if (!migrated.ok) return;
    assert.equal(migrated.migrated, true);
    assert.equal(JSON.stringify(payload), originalJSON);
    assert.equal(migrated.value.releaseProfileId, "M3");
    for (const field of [
      "completedObjectiveIds",
      "claimedRewardIds",
      "completedRoomLayouts",
      "bestResults",
      "discoveredTileIds",
      "visitedTileIds",
      "clearedEtherNodeIds",
      "revealedGroupIds",
      "activatedTeleportIds",
    ] as const)
      assert.deepEqual(migrated.value[field], payload[field], field);
    assert.deepEqual(migrated.value.scopeCompletionHistory, ["M2"]);
    const repeated = validatePayload(migrated.value, content, migrationRegistry);
    assert.equal(repeated.ok, true);
    if (!repeated.ok) return;
    assert.equal(repeated.migrated, undefined);
    assert.deepEqual(repeated.value, migrated.value);
    const session = new Session(restorePayload(migrated.value, content, 0), 0);
    assert.equal(areaData(content, session.state, "c").collected, 0);
    assert.equal(session.state.activatedTeleportIds.includes("c.teleport"), false);
    assert.equal(
      supplyProgress(content, session.state).collected,
      continuation.expectedCData === 100 ? 51 : 11,
    );
    const {
      initialStateId: _state,
      initialProfileId: _profile,
      initialization: _initialization,
      expectedBData,
      expectedCData,
      ...publicWitness
    } = continuation;
    assert.deepEqual(validateWorldWitness(publicWitness), []);
    let pickupEvents = 0;
    for (const step of continuation.steps) {
      const result = session.send(step.command, step.expectedCode, step.atMs - session.now);
      pickupEvents += result.events.filter((event) => event.kind === "pickup").length;
      if (step.checkpoint) matchesExpectation(session.state, step.checkpoint.expected);
    }
    matchesExpectation(session.state, continuation.expected);
    assert.equal(areaData(content, session.state, "b").collected, expectedBData);
    assert.equal(areaData(content, session.state, "c").collected, expectedCData);
    assert.equal(pickupEvents, expectedCData === 100 ? 6 : 0);
    assert.equal(continuation.steps.length, expectedCData === 100 ? 309 : 54);
    assert.deepEqual(session.state.scopeCompletionHistory, ["M2", "M3"]);
    assert.deepEqual(session.state.bestResults, payload.bestResults);
    for (const [roomId, layout] of Object.entries(payload.completedRoomLayouts))
      assert.deepEqual(session.state.completedRoomLayouts[roomId], layout);
    assert.equal(session.state.campaignCompletedAt, null);
    const finalSaved = validatePayload(stablePayload(session.state), content);
    assert.equal(finalSaved.ok, true);
    if (!finalSaved.ok) return;
    const finalRestored = restorePayload(finalSaved.value, content, 0);
    matchesExpectation(finalRestored, continuation.expected);
    assert.deepEqual(
      permanentPuzzleProgress(finalRestored),
      permanentPuzzleProgress(session.state),
    );
  });
}

test("I09：C/B实体入口连续30次往返，落点安全且无自动回跳", () => {
  const session = new Session(full.state, fullWitness.steps.at(-1)!.atMs);
  const before = permanentPuzzleProgress(session.state);
  for (let count = 0; count < 30; count += 1) {
    session.move("down", "down");
    session.send({ kind: "Interact" });
    assert.equal(session.state.playerPosition.tileId, "b.t.0.0");
    session.send({ kind: "Tick" });
    assert.equal(session.state.playerPosition.tileId, "b.t.0.0");
    session.move(
      "down",
      "right",
      "right",
      "right",
      "right",
      "right",
      "up",
      "right",
      "right",
      "right",
    );
    session.send({ kind: "Interact" });
    assert.equal(session.state.playerPosition.tileId, "c.t.0.0");
    session.send({ kind: "Tick" });
    assert.equal(session.state.playerPosition.tileId, "c.t.0.0");
  }
  assert.deepEqual(permanentPuzzleProgress(session.state), before);
  assert.equal(supplyProgress(content, session.state).collected, 81);
});
