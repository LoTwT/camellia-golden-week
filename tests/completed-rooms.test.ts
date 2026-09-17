import assert from "node:assert/strict";
import test from "node:test";
import { staticContent } from "../src/content/assemble.ts";
import { createGame, dispatch } from "../src/core/engine.ts";
import { projectBoard } from "../src/core/projection.ts";
import {
  completedStaticExitTileId,
  completedStaticEntryTileId,
  staticOccupiedTiles,
  createStatic,
  createCompletedStaticLayout,
  isCompletedStaticPosition,
  replayStaticWitness,
  validateCompletedStaticEntrySafety,
  validateCompletedStaticLayout,
  validateStaticDefinition,
} from "../src/core/static-puzzle.ts";
import type { StaticDefinition, StaticDirection } from "../src/core/static-puzzle.ts";
import type { GameCommand, GameContent, GameState } from "../src/core/types.ts";

/** Isolated room fixtures test core transactions; full-world acceptance uses the real witnesses. */
function roomContent(definition: StaticDefinition): GameContent {
  const tiles = [0, 1, 2].map((x) => ({
    id: `a.t.${x}.0`,
    boardId: "a",
    x,
    y: 0,
    terrain: "floor" as const,
    initialDiscovery: true,
    etherGroupId: null,
    hiddenGroupId: null,
    overlayIds: [],
    includedFrom: 1,
  }));
  const objectives = [
    {
      id: definition.id,
      kind: "puzzle" as const,
      producer: definition.id,
      prerequisites: { kind: "always" as const },
      includedFrom: 1,
    },
  ];
  const rewards = [
    {
      id: "test.supply",
      statsAreaId: "a" as const,
      units: 5,
      claimMode: "grant" as const,
      producerId: definition.id,
      prerequisites: { kind: "objective" as const, objectiveId: definition.id },
      includedFrom: 1,
    },
  ];
  const profile = {
    id: "M1" as const,
    includedAreaIds: ["a" as const],
    includedRoomIds: [definition.id],
    includedObjectiveIds: [definition.id],
    includedRewardIds: ["test.supply"],
    scopeTerminalObjectiveId: definition.id,
    fullCampaign: false,
  };
  return {
    gameId: "camellia-golden-week",
    contentVersion: 1,
    ruleVersion: 4,
    areaIds: ["a"],
    entry: { areaId: "a", tileId: "a.t.0.0" },
    objectives,
    dataNodes: [],
    rewards,
    gates: [{ id: "always", condition: { kind: "always" }, reason: "" }],
    releaseProfiles: [profile],
    profile,
    areas: [
      {
        id: "a",
        label: "独立房间测试",
        subtitle: "",
        statsAreaId: "a",
        tileIds: tiles.map((tile) => tile.id),
        roomIds: [definition.id],
        entryTileId: "a.t.0.0",
        teleportId: "a.teleport",
        entityIds: ["test.entrance"],
        revealGroups: [],
        sourceRecordIds: [],
        includedFrom: 1,
      },
    ],
    tiles,
    entities: [
      {
        id: "test.entrance",
        kind: "roomEntrance",
        tileId: "a.t.1.0",
        label: "测试入口",
        params: { roomId: definition.id, interactionMode: "enter" },
        gateId: "always",
        effectBundleId: null,
        sourceRecordIds: [],
        includedFrom: 1,
      },
    ],
    effects: [
      {
        id: "test.effects",
        completeObjectiveIds: [definition.id],
        grantRewardIds: ["test.supply"],
        revealGroupIds: [],
        clearEtherTileIds: [],
      },
    ],
    rooms: [
      {
        id: definition.id,
        areaId: "a",
        boardId: definition.boardId,
        mode: "staticPuzzle",
        worldEntranceTileId: "a.t.1.0",
        entryTileId: definition.startTileId,
        returnTileId: "a.t.0.0",
        successExitTileId: "a.t.2.0",
        resetState: definition.id,
        goal: definition.id,
        effectBundleId: "test.effects",
        witnessIds: [],
        includedFrom: 1,
      },
    ],
    sources: [],
    staticChallenges: [definition],
    realtimeChallenges: [],
    catalogDataNodes: [],
    catalogRewards: rewards,
    catalogObjectives: objectives,
  };
}

class RoomSession {
  readonly definition: StaticDefinition;
  readonly content: GameContent;
  state: GameState;
  now = 0;
  pickups = 0;

  constructor(definition: StaticDefinition) {
    this.definition = definition;
    this.content = roomContent(definition);
    this.state = createGame(this.content);
  }

  send(command: GameCommand, code = "accepted", delta = 140) {
    this.now += delta;
    const result = dispatch(this.content, this.state, command, this.now);
    assert.equal(result.code, code, result.state.lastResult.message);
    this.state = result.state;
    this.pickups += result.events.filter((event) => event.kind === "pickup").length;
    return result;
  }
}

function solve(session: RoomSession, kind: "success" | "alternative" = "success") {
  if (session.state.mode === "explore") session.send({ kind: "Move", direction: "right" });
  assert.equal(session.state.mode, "staticPuzzle");
  const witness =
    staticContent.witnesses.find(
      (candidate) => candidate.id === `${session.definition.id}.witness.${kind}`,
    ) ??
    staticContent.witnesses.find(
      (candidate) => candidate.id === `${session.definition.id}.witness.success`,
    )!;
  for (const [index, action] of witness.actions.entries()) {
    if (action === "activate")
      for (let tick = 0; tick < 16; tick += 1) session.send({ kind: "Tick" }, "accepted", 250);
    else if (action === "undo") session.send({ kind: "Undo" }, "undone");
    else if (action === "reset") session.send({ kind: "ResetRoom" }, "reset");
    else
      session.send(
        { kind: "Move", direction: action },
        index === witness.actions.length - 1 ? "success" : "accepted",
      );
  }
}

const directions = [
  ["up", 0, -1],
  ["right", 1, 0],
  ["down", 0, 1],
  ["left", -1, 0],
] as const;
function completedPath(session: RoomSession, destination: string): StaticDirection[] {
  const definition = session.definition;
  const layout = session.state.completedRoomLayouts[definition.id]!.layout;
  const queue = [{ id: session.state.playerPosition.tileId, path: [] as StaticDirection[] }];
  const seen = new Set([session.state.playerPosition.tileId]);
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]!;
    if (current.id === destination) return current.path;
    const from = definition.tiles.find((tile) => tile.id === current.id)!;
    for (const [direction, dx, dy] of directions) {
      const next = definition.tiles.find(
        (tile) => tile.x === from.x + dx && tile.y === from.y + dy,
      );
      if (!next || seen.has(next.id) || !isCompletedStaticPosition(definition, layout, next.id))
        continue;
      if (next.id === completedStaticExitTileId(definition) && next.id !== destination) continue;
      seen.add(next.id);
      queue.push({ id: next.id, path: [...current.path, direction] });
    }
  }
  throw new Error(`No completed path to ${destination}`);
}

for (const definition of staticContent.definitions) {
  test(`首次真实成功原子保存并自动重访完整布局：${definition.id}`, () => {
    const session = new RoomSession(definition);
    assert.deepEqual(session.state.completedRoomLayouts, {});
    solve(session, "alternative");
    const witness =
      staticContent.witnesses.find(
        (candidate) => candidate.id === `${definition.id}.witness.alternative`,
      ) ??
      staticContent.witnesses.find(
        (candidate) => candidate.id === `${definition.id}.witness.success`,
      )!;
    const actual = replayStaticWitness(definition, witness);
    const record = session.state.completedRoomLayouts[definition.id]!;
    assert.deepEqual(
      record.layout,
      createCompletedStaticLayout(definition, actual.state, actual.playerTileId),
    );
    assert.equal(record.ruleVersion, 4);
    assert.equal(record.contentVersion, session.content.contentVersion);
    assert.deepEqual(validateCompletedStaticLayout(definition, record.layout), []);
    assert.equal(Object.hasOwn(record, "playerTileId"), false);
    assert.equal(Object.hasOwn(record, "phase"), false);
    assert.equal(Object.hasOwn(record, "pendingObjectiveIds"), false);
    assert.equal(session.state.playerPosition.tileId, "a.t.2.0");
    assert.equal(session.state.activeStatic, null);
    assert.equal(session.pickups, 1);
    session.send({ kind: "Move", direction: "left" });
    assert.equal(session.state.mode, "completedRoom");
    assert.equal(session.state.phase, "complete");
    assert.equal(session.state.activeStatic, null);
    assert.equal(session.state.activeCompletedRoom?.roomId, definition.id);
    assert.equal(session.state.playerPosition.tileId, completedStaticEntryTileId(definition));
    assert.equal(session.state.playerPosition.space, "room");
    session.send({ kind: "Tick" });
    assert.equal(session.state.mode, "completedRoom", "入口不会连锁退出");
    const projected = projectBoard(session.content, session.state);
    assert.equal(projected.tiles.length, definition.tiles.length);
    assert.equal(
      projected.tiles.find((tile) => tile.id === completedStaticExitTileId(definition))?.label,
      "已完成房间出口",
    );
    assert.equal(
      projected.tiles.some((tile) => tile.icon === "hazard-active"),
      false,
    );
    session.send({ kind: "Undo" }, "alreadyCompleted");
    session.send({ kind: "ResetRoom" }, "alreadyCompleted");
    assert.deepEqual(session.state.completedRoomLayouts[definition.id], record);
    session.send({ kind: "ExitRoom" });
    assert.equal(session.state.playerPosition.tileId, "a.t.0.0");
    assert.equal(session.state.activeCompletedRoom, null);
    assert.equal(session.pickups, 1);
  });
}

test("完成态迷宫可踏原危险格，一笔画可重复访问，不改已提交路线", () => {
  for (const definition of staticContent.definitions.filter(
    (candidate) => candidate.kind === "memory" || candidate.kind === "oneStroke",
  )) {
    const session = new RoomSession(definition);
    solve(session);
    session.send({ kind: "Move", direction: "left" });
    const before = structuredClone(session.state.completedRoomLayouts);
    if (definition.kind === "memory") {
      const hazard = definition.hazardTileIds[0]!;
      for (const direction of completedPath(session, hazard))
        session.send({ kind: "Move", direction });
      assert.equal(session.state.playerPosition.tileId, hazard);
      assert.equal(session.state.mode, "completedRoom");
    } else {
      const first = staticContent.witnesses.find(
        (w) => w.id === `${definition.id}.witness.success`,
      )!.actions[0] as StaticDirection;
      session.send({ kind: "Move", direction: first });
      session.send({
        kind: "Move",
        direction: ({ up: "down", down: "up", left: "right", right: "left" } as const)[first],
      });
      assert.equal(session.state.playerPosition.tileId, completedStaticEntryTileId(definition));
    }
    assert.deepEqual(session.state.completedRoomLayouts, before);
    assert.equal(session.pickups, 1);
  }
});

test("完成态通过出口到世界成功出口；对象房走开再返回入口垫才离开", () => {
  for (const definition of staticContent.definitions) {
    const session = new RoomSession(definition);
    solve(session);
    session.send({ kind: "Move", direction: "left" });
    if (session.state.playerPosition.tileId === completedStaticExitTileId(definition)) {
      const start = definition.tiles.find(
        (tile) => tile.id === session.state.playerPosition.tileId,
      )!;
      const first = directions.find(([, dx, dy]) =>
        definition.tiles.some(
          (tile) =>
            tile.x === start.x + dx &&
            tile.y === start.y + dy &&
            isCompletedStaticPosition(
              definition,
              session.state.completedRoomLayouts[definition.id]!.layout,
              tile.id,
            ),
        ),
      )!;
      assert.ok(first);
      session.send({ kind: "Move", direction: first[0] });
    }
    for (const direction of completedPath(session, completedStaticExitTileId(definition)))
      session.send({ kind: "Move", direction });
    assert.equal(session.state.playerPosition.tileId, "a.t.2.0");
    assert.equal(session.state.mode, "explore");
    assert.equal(session.pickups, 1);
  }
});

test("完成态信号球/推车/盗取对象阻挡移动并保持真实位置，不执行推动", () => {
  for (const definition of staticContent.definitions.filter(
    (candidate) => candidate.kind === "capture" || candidate.kind === "theft",
  )) {
    const session = new RoomSession(definition);
    solve(session);
    session.send({ kind: "Move", direction: "left" });
    const record = structuredClone(session.state.completedRoomLayouts[definition.id]!);
    const objectTile = definition.tiles.find(
      (tile) => tile.id === staticOccupiedTiles(record.layout)[0],
    )!;
    const adjacent = directions
      .map(([direction, dx, dy]) => ({
        direction,
        tile: definition.tiles.find(
          (tile) => tile.x === objectTile.x - dx && tile.y === objectTile.y - dy,
        ),
      }))
      .find(
        (candidate) =>
          candidate.tile && isCompletedStaticPosition(definition, record.layout, candidate.tile.id),
      );
    assert.ok(adjacent?.tile);
    for (const direction of completedPath(session, adjacent.tile.id))
      session.send({ kind: "Move", direction });
    const before = session.state.playerPosition.tileId;
    const rejected = session.send({ kind: "Move", direction: adjacent.direction }, "blocked");
    assert.equal(rejected.stable, false);
    assert.equal(session.state.playerPosition.tileId, before);
    assert.deepEqual(session.state.completedRoomLayouts[definition.id], record);
    const projection = projectBoard(session.content, session.state);
    assert.match(projection.tiles.find((tile) => tile.id === objectTile.id)!.label, /保留完成位置/);
  }
});

test("独立练习的替代解不会替换首个实际完成布局或重复奖励", () => {
  for (const id of ["a.maze.01", "c.capture.02"]) {
    const definition = staticContent.definitions.find((candidate) => candidate.id === id)!;
    const session = new RoomSession(definition);
    solve(session);
    const original = structuredClone(session.state.completedRoomLayouts[id]);
    session.send({ kind: "Move", direction: "left" });
    session.send({ kind: id.startsWith("a.") ? "Interact" : "PracticeRoom" });
    assert.equal(session.state.activeStatic?.practice, true);
    assert.equal(session.state.activeCompletedRoom, null);
    solve(session, "alternative");
    assert.equal(session.state.playerPosition.tileId, "a.t.0.0");
    assert.deepEqual(session.state.completedRoomLayouts[id], original);
    assert.equal(session.pickups, 1);
    const alternative = replayStaticWitness(
      definition,
      staticContent.witnesses.find((witness) => witness.id === `${id}.witness.alternative`)!,
    );
    assert.deepEqual(
      validateCompletedStaticLayout(
        definition,
        createCompletedStaticLayout(definition, alternative.state, alternative.playerTileId),
      ),
      [],
    );
    if (definition.kind === "capture")
      assert.notDeepEqual(
        createCompletedStaticLayout(definition, alternative.state, alternative.playerTileId),
        original?.layout,
      );
  }
});

test("完成布局校验拒绝未解决对象、假完整路径、玩家/待发字段和入口堵塞", () => {
  for (const definition of staticContent.definitions) {
    assert.deepEqual(validateCompletedStaticEntrySafety(definition), []);
    const solved = replayStaticWitness(
      definition,
      staticContent.witnesses.find((witness) => witness.id === `${definition.id}.witness.success`)!,
    );
    const layout = createCompletedStaticLayout(definition, solved.state, solved.playerTileId);
    for (const extra of [
      { playerTileId: definition.startTileId },
      { pendingObjectiveIds: [definition.id] },
      { completed: true },
    ])
      assert.ok(validateCompletedStaticLayout(definition, { ...layout, ...extra }).length > 0);
    const initial = createStatic(definition);
    assert.throws(() =>
      createCompletedStaticLayout(definition, initial.state, initial.playerTileId),
    );
    if (definition.kind === "oneStroke") {
      assert.ok(
        validateCompletedStaticLayout(definition, {
          ...layout,
          visitedTileIds: [...definition.requiredTileIds].reverse(),
        }).length > 0,
      );
      assert.ok(
        validateCompletedStaticLayout(definition, {
          ...layout,
          visitedTileIds: [definition.startTileId, definition.endTileId],
        }).length > 0,
      );
    }
    if (definition.kind === "theft" || definition.kind === "capture")
      assert.ok(
        validateCompletedStaticLayout(definition, {
          ...layout,
          ...(definition.kind === "theft"
            ? { theft: initial.state.currentLayout.theft }
            : { capture: initial.state.currentLayout.capture }),
        }).length > 0,
      );
  }
  const capture = staticContent.definitions.find((definition) => definition.kind === "capture")!;
  assert.ok(
    validateStaticDefinition({ ...capture, completedEntryTileId: "missing.safe.entry" }).length > 0,
  );
});

test("成功布局、目标和奖励在同一修订中提交，旧调用方状态保持原样", () => {
  const definition = staticContent.definitions.find((candidate) => candidate.id === "b.line.01")!;
  const session = new RoomSession(definition);
  session.send({ kind: "Move", direction: "right" });
  const witness = staticContent.witnesses.find(
    (candidate) => candidate.id === "b.line.01.witness.success",
  )!;
  for (const direction of witness.actions.slice(0, -1))
    session.send({ kind: "Move", direction: direction as StaticDirection });
  const before = session.state;
  const frozen = JSON.stringify(before);
  const result = session.send(
    { kind: "Move", direction: witness.actions.at(-1) as StaticDirection },
    "success",
  );
  assert.equal(result.state.stateRevision, before.stateRevision + 1);
  assert.equal(JSON.stringify(before), frozen);
  assert.ok(result.state.completedRoomLayouts[definition.id]);
  assert.ok(result.state.completedObjectiveIds.includes(definition.id));
  assert.deepEqual(result.state.claimedRewardIds, ["test.supply"]);
  assert.equal(result.state.playerPosition.tileId, "a.t.2.0");
});
