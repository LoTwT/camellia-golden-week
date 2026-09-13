// Historical pre-R1 rules only. Current assembly/capture boundaries are tested in r1-static.test.ts.
import assert from "node:assert/strict";
import test from "node:test";
import rawContent from "../src/content/history/pre-r1/static-content.ts";
import {
  STATIC_UNDO_LIMIT,
  activateStatic,
  assertStaticContent,
  createStatic,
  isStaticSolved,
  moveStatic,
  replayStaticWitness,
  resetStatic,
  undoStatic,
  validateStaticContent,
  validateStaticDefinition,
  validateStaticState,
} from "../src/content/history/pre-r1/static-puzzle.ts";
import type {
  StaticDefinition,
  StaticDirection,
  StaticInstance,
  StaticLayout,
  StaticState,
} from "../src/content/history/pre-r1/static-puzzle.ts";

assertStaticContent(rawContent);
const content = rawContent;

function definition<K extends StaticDefinition["kind"]>(
  id: string,
  kind: K,
): Extract<StaticDefinition, { kind: K }> {
  const result = content.definitions.find((candidate) => candidate.id === id);
  assert.ok(result && result.kind === kind, `${id} must be ${kind}`);
  return result as Extract<StaticDefinition, { kind: K }>;
}

const maze = definition("a.maze.01", "memory");
const line = definition("b.line.01", "oneStroke");
const routing = definition("c.routing.01", "routing");
const theft = definition("c.theft.01", "theft");
const sameColor = definition("c.theft.02", "theft");

function tile(def: StaticDefinition, x: number, y: number): string {
  const result = def.tiles.find((candidate) => candidate.x === x && candidate.y === y);
  assert.ok(result, `${def.id} contains ${x},${y}`);
  return result.id;
}

function active(def: StaticDefinition): StaticInstance {
  const instance = createStatic(def);
  return { ...instance, state: activateStatic(def, instance.state) };
}

function play(
  def: StaticDefinition,
  instance: StaticInstance,
  directions: readonly StaticDirection[],
): StaticInstance {
  let current = instance;
  for (const direction of directions) {
    const next = moveStatic(def, current.state, current.playerTileId, direction);
    assert.equal(next.legal, true, `${def.id}: ${direction}: ${next.code}`);
    current = { state: next.state, playerTileId: next.playerTileId };
  }
  return current;
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

test("固定内容包含 M1–M3 的九个房间和每房三条完整见证", () => {
  assert.deepEqual(validateStaticContent(content), []);
  assert.equal(content.definitions.length, 9);
  assert.equal(content.witnesses.length, 27);
  assert.deepEqual(
    ["M1", "M2", "M3"].map(
      (profile) => content.definitions.filter((def) => def.includedFrom === profile).length,
    ),
    [3, 2, 4],
  );
  for (const def of content.definitions) {
    const relevant = content.witnesses.filter((witness) => witness.definitionId === def.id);
    assert.equal(relevant.length, 3);
    assert.equal(relevant.filter((witness) => witness.kind === "alternative").length, 1);
  }
});

for (const witness of content.witnesses) {
  test(`权威规则见证：${witness.id}`, () => {
    const def = content.definitions.find((candidate) => candidate.id === witness.definitionId);
    assert.ok(def);
    const before = JSON.stringify(def);
    const result = replayStaticWitness(freeze(def), freeze(witness));
    assert.deepEqual(result.errors, []);
    assert.equal(result.state.phase, "complete");
    assert.equal(result.codes.filter((code) => code === "success").length, 1);
    assert.deepEqual(result.state.undoStack, []);
    assert.equal(JSON.stringify(def), before);
  });
}

test("S01：观察阶段拒绝移动，时钟显式完成观察后才接收方向", () => {
  const initial = createStatic(maze);
  const rejected = moveStatic(maze, initial.state, initial.playerTileId, "up");
  assert.equal(maze.previewMs, 4000);
  assert.equal(rejected.code, "wrongMode");
  assert.equal(rejected.state, initial.state);
  assert.equal(rejected.legal, false);
  const state = activateStatic(maze, initial.state);
  assert.equal(state.phase, "active");
  assert.equal(moveStatic(maze, state, initial.playerTileId, "up").code, "accepted");
  assert.equal(activateStatic(maze, state), state);
  const nonMemory = createStatic(line);
  assert.equal(activateStatic(line, nonMemory.state), nonMemory.state);
});

test("S01/S02：危险步丢弃临时结果、返回基线并重新观察，墙不会触发失败", () => {
  const initial = active(maze);
  const pending: StaticState = {
    ...initial.state,
    currentLayout: {
      ...initial.state.currentLayout,
      pendingObjectiveIds: ["a.maze.01.pending"],
      pendingRewardIds: ["a.supply.pending"],
    },
  };
  const first = moveStatic(maze, pending, initial.playerTileId, "up");
  const failure = moveStatic(maze, first.state, first.playerTileId, "right");
  assert.equal(failure.legal, true);
  assert.equal(failure.failed, true);
  assert.equal(failure.success, false);
  assert.equal(failure.state.phase, "preview");
  assert.equal(failure.playerTileId, maze.startTileId);
  assert.deepEqual(failure.state.currentLayout, initial.state.attemptBaseline.layout);
  assert.deepEqual(failure.state.undoStack, []);
  assert.deepEqual(failure.before.layout.pendingRewardIds, ["a.supply.pending"]);
  assert.deepEqual(failure.after.layout.pendingRewardIds, []);
  const atWall = play(maze, initial, ["right", "right", "up"]);
  const wall = moveStatic(maze, atWall.state, atWall.playerTileId, "up");
  assert.equal(wall.code, "blocked");
  assert.equal(wall.failed, false);
  assert.equal(wall.state, atWall.state);
});

test("I01：缺少的整数坐标保持地图外，无效方向或位置不改变状态", () => {
  const missingId = tile(maze, 1, 4);
  const sparse = {
    ...maze,
    tiles: maze.tiles.filter((entry) => entry.id !== missingId),
    safeTileIds: maze.safeTileIds.filter((id) => id !== missingId),
  };
  assert.deepEqual(validateStaticDefinition(sparse), []);
  const initial = active(sparse);
  assert.equal(moveStatic(sparse, initial.state, initial.playerTileId, "right").code, "blocked");
  assert.equal(
    moveStatic(sparse, initial.state, initial.playerTileId, "diagonal" as StaticDirection).code,
    "invalidTarget",
  );
  assert.equal(moveStatic(sparse, initial.state, "a.unknown", "up").code, "invalidTarget");
  assert.deepEqual(initial.state.undoStack, []);
});

test("S03：重复路径和提前终点被拒，撤销还原精确访问集合", () => {
  const initial = active(line);
  const current = play(line, initial, ["right", "right"]);
  const early = moveStatic(line, current.state, current.playerTileId, "right");
  assert.equal(early.code, "endTooEarly");
  assert.equal(early.state, current.state);
  const repeated = moveStatic(line, current.state, current.playerTileId, "left");
  assert.equal(repeated.code, "alreadyVisited");
  assert.equal(repeated.state.undoStack.length, 2);
  const undone = undoStatic(line, current.state, current.playerTileId);
  assert.equal(undone.playerTileId, tile(line, 1, 0));
  assert.deepEqual(undone.state.currentLayout.visitedTileIds, [line.startTileId, tile(line, 1, 0)]);
  assert.equal(moveStatic(line, undone.state, undone.playerTileId, "down").code, "accepted");
  const limited = {
    ...line,
    requiredTileIds: line.requiredTileIds.filter(
      (id) => line.tiles.find((entry) => entry.id === id)?.y === 0,
    ),
  };
  const limitedInitial = active(limited);
  assert.equal(
    moveStatic(limited, limitedInitial.state, limitedInitial.playerTileId, "down").code,
    "blocked",
  );
});

test("S04：同方向推动时信号球滑到第一基站，盗取对象仅前进一格", () => {
  const initial = active(routing);
  const ball = routing.ballIds[0];
  const second = routing.ballIds[1];
  assert.ok(ball && second);
  const adjusted: StaticState = {
    ...initial.state,
    currentLayout: {
      ...initial.state.currentLayout,
      objectTileById: {
        ...initial.state.currentLayout.objectTileById,
        [second]: tile(routing, 3, 2),
      },
    },
  };
  assert.deepEqual(validateStaticState(routing, adjusted, tile(routing, 2, 4)), []);
  const ballPush = moveStatic(routing, adjusted, tile(routing, 2, 4), "up");
  assert.equal(ballPush.state.currentLayout.objectTileById[ball], tile(routing, 2, 1));
  assert.equal(ballPush.playerTileId, tile(routing, 2, 3));
  assert.equal(ballPush.success, false);
  const object = theft.objectIds[0];
  assert.ok(object);
  const theftInitial = active(theft);
  const objectPush = moveStatic(theft, theftInitial.state, tile(theft, 2, 4), "up");
  assert.equal(objectPush.state.currentLayout.objectTileById[object], tile(theft, 2, 2));
  assert.equal(objectPush.playerTileId, tile(theft, 2, 3));
});

test("S05：推车前进一格并改变滑球原子落点，撤销恢复完整布局", () => {
  const initial = active(routing);
  const cart = routing.cartIds[0];
  const ball = routing.ballIds[0];
  assert.ok(cart && ball);
  const unprepared = moveStatic(routing, initial.state, tile(routing, 1, 3), "right");
  assert.equal(unprepared.state.currentLayout.objectTileById[ball], tile(routing, 5, 3));
  const prepared = play(routing, initial, ["right", "right", "right", "right", "up"]);
  assert.equal(prepared.state.currentLayout.objectTileById[cart], tile(routing, 5, 3));
  assert.equal(prepared.playerTileId, tile(routing, 5, 4));
  const approach = play(routing, prepared, ["left", "left", "left", "left", "up"]);
  const push = moveStatic(routing, approach.state, approach.playerTileId, "right");
  assert.equal(push.state.currentLayout.objectTileById[ball], tile(routing, 4, 3));
  assert.equal(push.playerTileId, tile(routing, 2, 3));
  assert.equal(push.state.undoStack.length, approach.state.undoStack.length + 1);
  const undone = undoStatic(routing, push.state, push.playerTileId);
  assert.deepEqual(undone.state.currentLayout, approach.state.currentLayout);
  assert.equal(undone.playerTileId, approach.playerTileId);
  assert.equal(undone.state.currentLayout.objectTileById[cart], tile(routing, 5, 3));
});

test("S05：不串推，墙边和边界推动不部分改变物体或历史", () => {
  const initial = active(routing);
  const cart = routing.cartIds[0];
  assert.ok(cart);
  const blockedState = {
    ...initial.state,
    currentLayout: {
      ...initial.state.currentLayout,
      objectTileById: {
        ...initial.state.currentLayout.objectTileById,
        [cart]: tile(routing, 3, 3),
      },
    },
  };
  const blocked = moveStatic(routing, freeze(blockedState), tile(routing, 1, 3), "right");
  assert.equal(blocked.code, "blocked");
  assert.equal(blocked.state, blockedState);
  assert.deepEqual(blocked.before, blocked.after);
  const cartDown = moveStatic(routing, initial.state, tile(routing, 5, 3), "down");
  assert.equal(cartDown.state.currentLayout.objectTileById[cart], tile(routing, 5, 5));
  const wallPush = moveStatic(routing, cartDown.state, cartDown.playerTileId, "down");
  assert.equal(wallPush.code, "blocked");
  assert.equal(wallPush.state, cartDown.state);
  const [first, second] = sameColor.objectIds;
  assert.ok(first && second);
  const theftInitial = active(sameColor);
  const adjacent = {
    ...theftInitial.state,
    currentLayout: {
      ...theftInitial.state.currentLayout,
      objectTileById: { [first]: tile(sameColor, 2, 3), [second]: tile(sameColor, 3, 3) },
    },
  };
  assert.equal(moveStatic(sameColor, adjacent, tile(sameColor, 1, 3), "right").code, "blocked");
});

test("S05：任意基站都能停止球，错误站不销毁球，成功前正确入站仍可推离", () => {
  const initial = active(routing);
  const [first, second] = routing.ballIds;
  assert.ok(first && second);
  const adjusted = {
    ...initial.state,
    currentLayout: {
      ...initial.state.currentLayout,
      objectTileById: {
        ...initial.state.currentLayout.objectTileById,
        [second]: tile(routing, 3, 2),
      },
    },
  };
  const wrongStation = moveStatic(routing, adjusted, tile(routing, 2, 4), "up");
  assert.equal(wrongStation.code, "accepted");
  assert.equal(wrongStation.state.currentLayout.objectTileById[first], tile(routing, 2, 1));
  const approach = play(routing, wrongStation, ["left", "up", "up"]);
  const correctStation = moveStatic(routing, approach.state, approach.playerTileId, "right");
  assert.equal(correctStation.state.currentLayout.objectTileById[first], tile(routing, 4, 1));
  assert.equal(correctStation.success, false);
  const pushedOff = play(routing, correctStation, ["right", "right"]);
  assert.equal(pushedOff.state.currentLayout.objectTileById[first], tile(routing, 5, 1));
  assert.equal(
    isStaticSolved(routing, pushedOff.state.currentLayout, pushedOff.playerTileId),
    false,
  );
});

test("S06：槽是可通行地板；异色互换不成功，正确物体在整体成功前不锁死", () => {
  const initial = active(theft);
  assert.equal(moveStatic(theft, initial.state, tile(theft, 1, 1), "right").code, "accepted");
  const [cyan, magenta] = theft.objectIds;
  assert.ok(cyan && magenta);
  const wrong: StaticLayout = {
    ...initial.state.currentLayout,
    objectTileById: { [cyan]: tile(theft, 4, 1), [magenta]: tile(theft, 2, 1) },
  };
  assert.equal(isStaticSolved(theft, wrong, tile(theft, 3, 1)), false);
  const partial = {
    ...initial.state,
    currentLayout: {
      ...initial.state.currentLayout,
      objectTileById: { ...initial.state.currentLayout.objectTileById, [cyan]: tile(theft, 2, 1) },
    },
  };
  const moved = moveStatic(theft, partial, tile(theft, 1, 1), "right");
  assert.equal(moved.code, "accepted");
  assert.equal(moved.state.currentLayout.objectTileById[cyan], tile(theft, 3, 1));
  assert.equal(isStaticSolved(theft, moved.state.currentLayout, moved.playerTileId), false);
});

test("S06：固定盗取 02 的第二条成功见证交换同色物体的最终槽位", () => {
  const witness = content.witnesses.find(
    (candidate) => candidate.id === "c.theft.02.witness.alternative",
  );
  assert.ok(witness);
  const result = replayStaticWitness(sameColor, witness);
  const [first, second] = sameColor.objectIds;
  const [firstSocket, secondSocket] = sameColor.socketIds;
  assert.ok(first && second && firstSocket && secondSocket);
  assert.equal(
    result.state.currentLayout.objectTileById[first],
    sameColor.socketTileById[secondSocket],
  );
  assert.equal(
    result.state.currentLayout.objectTileById[second],
    sameColor.socketTileById[firstSocket],
  );
  assert.equal(result.state.phase, "complete");
});

test("S07：第 257 步淘汰最老历史；只撤销最近 256 步后仍可重置", () => {
  let current = active(maze);
  for (let index = 0; index < 301; index += 1) {
    current = moveStatic(
      maze,
      current.state,
      current.playerTileId,
      index % 2 === 0 ? "right" : "left",
    );
    assert.ok(current.state.undoStack.length <= STATIC_UNDO_LIMIT);
  }
  assert.equal(current.state.undoStack.length, 256);
  for (let index = 0; index < 256; index += 1) {
    const undone = undoStatic(maze, current.state, current.playerTileId);
    assert.equal(undone.code, "undone");
    current = undone;
  }
  assert.equal(current.playerTileId, tile(maze, 1, 4));
  assert.equal(undoStatic(maze, current.state, current.playerTileId).code, "noHistory");
  const reset = resetStatic(maze, current.state, current.playerTileId);
  assert.equal(reset.playerTileId, maze.startTileId);
  assert.equal(reset.state.phase, "preview");
  assert.deepEqual(reset.state.currentLayout, createStatic(maze).state.currentLayout);
});

test("S07/S08：完整前态包含临时结果，快照与调用者输入互不别名", () => {
  const initial = active(theft);
  const pending: StaticState = {
    ...initial.state,
    currentLayout: {
      ...initial.state.currentLayout,
      pendingObjectiveIds: ["c.theft.01.pending"],
      pendingRewardIds: ["c.supply.pending"],
    },
  };
  const original = JSON.stringify(pending);
  const moved = moveStatic(theft, freeze(pending), initial.playerTileId, "up");
  assert.equal(JSON.stringify(pending), original);
  const undone = undoStatic(theft, moved.state, moved.playerTileId);
  assert.deepEqual(undone.state.currentLayout, pending.currentLayout);
  (moved.after.layout.pendingRewardIds as string[]).push("c.supply.injected");
  assert.deepEqual(moved.state.currentLayout.pendingRewardIds, ["c.supply.pending"]);
  assert.deepEqual(moved.before.layout.pendingRewardIds, ["c.supply.pending"]);
  assert.deepEqual(undone.state.currentLayout.pendingRewardIds, ["c.supply.pending"]);
});

test("S07：四个推物恢复见证确实先将指定物体送入不可逆边界死角", () => {
  const cases = [
    { def: routing, objectId: routing.ballIds[0], x: 5, y: 3, boundary: "right" as const },
    { def: theft, objectId: theft.objectIds[0], x: 2, y: 5, boundary: "down" as const },
    { def: sameColor, objectId: sameColor.objectIds[0], x: 2, y: 5, boundary: "down" as const },
    {
      def: definition("c.theft.03", "theft"),
      objectId: "c.theft.03.object.01",
      x: 2,
      y: 6,
      boundary: "down" as const,
    },
  ];
  for (const entry of cases) {
    assert.ok(entry.objectId);
    const witness = content.witnesses.find(
      (candidate) => candidate.id === `${entry.def.id}.witness.recovery`,
    );
    assert.ok(witness);
    let current = active(entry.def);
    for (const action of witness.actions) {
      if (action === "undo") break;
      assert.ok(action !== "activate" && action !== "reset");
      const result = moveStatic(entry.def, current.state, current.playerTileId, action);
      current = result;
    }
    assert.equal(
      current.state.currentLayout.objectTileById[entry.objectId],
      tile(entry.def, entry.x, entry.y),
    );
    const outside = entry.def.tiles.filter((candidate) =>
      entry.boundary === "right" ? candidate.x === entry.x + 1 : candidate.y === entry.y + 1,
    );
    assert.ok(outside.length > 0 && outside.every((candidate) => candidate.terrain === "wall"));
    assert.equal(current.state.phase, "active");
    const reset = resetStatic(entry.def, current.state, current.playerTileId);
    assert.deepEqual(reset.state.currentLayout, createStatic(entry.def).state.currentLayout);
    assert.equal(reset.playerTileId, entry.def.startTileId);
  }
});

test("S02/S08/P01：活动布局可序列化恢复，当前玩家只保存在调用方，历史丢弃后重置仍完整", () => {
  for (const def of [maze, line, routing, theft]) {
    const direction = def === line ? "right" : "up";
    const current = play(def, active(def), [direction]);
    const restored = JSON.parse(
      JSON.stringify({
        state: { ...current.state, undoStack: [] },
        playerTileId: current.playerTileId,
      }),
    ) as StaticInstance;
    assert.equal(Object.hasOwn(restored.state.currentLayout, "playerTileId"), false);
    assert.equal(Object.hasOwn(restored.state, "playerTileId"), false);
    assert.deepEqual(validateStaticState(def, restored.state, restored.playerTileId), []);
    assert.equal(undoStatic(def, restored.state, restored.playerTileId).code, "noHistory");
    const reset = resetStatic(def, restored.state, restored.playerTileId);
    assert.deepEqual(reset.state.currentLayout, createStatic(def).state.currentLayout);
    assert.equal(reset.playerTileId, def.startTileId);
  }
});

test("S09：成功是撤销与重置边界，独立练习从固定基线重建", () => {
  for (const def of content.definitions) {
    const witness = content.witnesses.find(
      (candidate) => candidate.definitionId === def.id && candidate.kind === "success",
    );
    assert.ok(witness);
    const completed = replayStaticWitness(def, witness);
    assert.equal(undoStatic(def, completed.state, completed.playerTileId).code, "wrongMode");
    assert.equal(
      resetStatic(def, completed.state, completed.playerTileId).code,
      "alreadyCompleted",
    );
    assert.equal(
      moveStatic(def, completed.state, completed.playerTileId, "left").code,
      "alreadyCompleted",
    );
    assert.deepEqual(createStatic(def).state.currentLayout, completed.state.attemptBaseline.layout);
    assert.equal(completed.state.phase, "complete");
  }
});

test("内容校验拒绝非法类型、坐标、引用、危险起点和颜色账本", () => {
  const invalid: unknown[] = [
    { ...maze, kind: "javascript" },
    { ...maze, includedFrom: ["M1"] },
    { ...maze, previewMs: 3999 },
    { ...maze, startTileId: maze.hazardTileIds[0] },
    { ...maze, hazardTileIds: [...maze.hazardTileIds, maze.startTileId] },
    { ...maze, tiles: [...maze.tiles, maze.tiles[0]] },
    {
      ...maze,
      tiles: maze.tiles.map((entry, index) => (index === 0 ? { ...entry, x: Number.NaN } : entry)),
    },
    {
      ...maze,
      tiles: maze.tiles.map((entry, index) =>
        index === 0 ? { ...entry, terrain: ["floor"] } : entry,
      ),
    },
    { ...maze, script: "globalThis.unsafe = true" },
    { ...line, requiredTileIds: [line.startTileId, line.endTileId] },
    {
      ...routing,
      targetStationByBallId: Object.fromEntries(
        routing.ballIds.map((id) => [id, routing.stationIds[0]]),
      ),
    },
    {
      ...routing,
      initialObjectTileById: { ...routing.initialObjectTileById, unknown: routing.startTileId },
    },
    { ...theft, colorByObjectId: Object.fromEntries(theft.objectIds.map((id) => [id, "cyan"])) },
    { ...theft, socketIds: theft.socketIds.slice(1) },
  ];
  for (const value of invalid)
    assert.ok(validateStaticDefinition(value).length > 0, JSON.stringify(value));
});

test("内容校验拒绝缺见证、伪结果码、重复答案和数组伪装动作", () => {
  const primary = content.witnesses.find((witness) => witness.id === "a.maze.01.witness.success");
  assert.ok(primary);
  const cases: unknown[] = [
    { ...content, witnesses: [] },
    {
      ...content,
      witnesses: content.witnesses.map((witness) =>
        witness === primary
          ? { ...witness, expectedCodes: witness.expectedCodes.map(() => "success") }
          : witness,
      ),
    },
    {
      ...content,
      witnesses: content.witnesses.map((witness) =>
        witness.id === "a.maze.01.witness.alternative"
          ? { ...primary, id: witness.id, kind: "alternative" }
          : witness,
      ),
    },
    {
      ...content,
      witnesses: content.witnesses.map((witness) =>
        witness === primary
          ? { ...witness, actions: witness.actions.map((action) => [action]) }
          : witness,
      ),
    },
  ];
  for (const value of cases) assert.ok(validateStaticContent(value).length > 0);
});

test("P06：存档校验拒绝重复玩家、坏路径、非法占格和篡改重置基线", () => {
  const initial = active(maze);
  const invalidMaze: unknown[] = [
    { ...initial.state, playerTileId: initial.playerTileId },
    { ...initial.state, phase: ["active"] },
    { ...initial.state, phase: "complete" },
    {
      ...initial.state,
      currentLayout: { ...initial.state.currentLayout, playerTileId: initial.playerTileId },
    },
    {
      ...initial.state,
      attemptBaseline: { ...initial.state.attemptBaseline, playerTileId: tile(maze, 1, 4) },
    },
    {
      ...initial.state,
      undoStack: Array.from({ length: 257 }, () => initial.state.attemptBaseline),
    },
    {
      ...initial.state,
      currentLayout: { ...initial.state.currentLayout, pendingObjectiveIds: ["eval('unsafe')"] },
    },
  ];
  for (const value of invalidMaze)
    assert.ok(validateStaticState(maze, value, initial.playerTileId).length > 0);
  assert.ok(
    validateStaticState(maze, initial.state, maze.hazardTileIds[0] ?? "invalid").length > 0,
  );
  const lineState = active(line);
  const brokenPath = {
    ...lineState.state,
    currentLayout: {
      ...lineState.state.currentLayout,
      visitedTileIds: [line.startTileId, tile(line, 2, 0)],
    },
  };
  assert.ok(validateStaticState(line, brokenPath, tile(line, 2, 0)).length > 0);
  const theftState = active(theft);
  const collision = {
    ...theftState.state,
    currentLayout: {
      ...theftState.state.currentLayout,
      objectTileById: Object.fromEntries(theft.objectIds.map((id) => [id, theft.startTileId])),
    },
  };
  assert.ok(validateStaticState(theft, collision, theft.startTileId).length > 0);
});
