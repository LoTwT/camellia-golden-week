// Replay current R1 routes through the current engine and projection.
import assert from "node:assert/strict";
import test from "node:test";
import { assembleContent } from "../src/content/assemble.ts";
import type { WorldWitness } from "../src/content/validate.ts";
import r1Witnesses from "../src/content/witnesses/r1-world.ts";
import { createGame, dispatch } from "../src/core/engine.ts";
import { projectBoard } from "../src/core/projection.ts";
import type { GameContent, GameState } from "../src/core/types.ts";

const content = assembleContent("M1");
const fullWitness = (r1Witnesses.witnesses as WorldWitness[]).find(
  (witness) => witness.id === "m1.world.full-collection-and-return",
)!;

function firstState(
  predicate: (state: GameState) => boolean,
  gameContent = content,
  witness = fullWitness,
) {
  let state = createGame(gameContent, 0);
  for (const step of witness.steps) {
    const result = dispatch(gameContent, state, step.command, step.atMs);
    assert.equal(result.code, step.expectedCode, `${witness.id}: ${step.atMs}`);
    state = result.state;
    if (predicate(state)) return state;
  }
  assert.fail(`${witness.id} 没有到达投影检查要求的状态`);
}

function screen(state: GameState, tileId: string, gameContent: GameContent = content) {
  const tile = projectBoard(gameContent, state).tiles.find((candidate) => candidate.id === tileId);
  assert.ok(tile, `${tileId} 应出现在当前棋盘`);
  return tile;
}

test("I04 未发现边界仅显示未知占位，移动显露后投影跟随权威位置且不泄漏其他棋盘", () => {
  const initial = createGame(content, 0);
  assert.deepEqual(screen(initial, "hub.t.2.2"), {
    id: "hub.t.2.2",
    x: 2,
    y: 2,
    known: false,
    color: "#17181e",
    icon: "unknown",
    label: "未发现",
    mark: "",
    player: false,
    visited: false,
  });
  const moved = dispatch(content, initial, { kind: "Move", direction: "right" }, 140).state;
  assert.equal(screen(moved, "hub.t.2.2").known, true);
  assert.equal(screen(moved, "hub.t.2.2").icon, null);
  assert.equal(screen(moved, "hub.t.2.2").label, "道路");
  const board = projectBoard(content, moved);
  assert.deepEqual(board.focus, { x: 1, y: 2 });
  assert.deepEqual(
    board.tiles.filter((tile) => tile.player).map((tile) => tile.id),
    ["hub.t.1.2"],
  );
  assert.ok(board.tiles.every((tile) => tile.id.startsWith("hub.")));
});

test("I05 覆盖显露仍显示覆盖，真实增幅后节点变为已使用、被清除格变为道路", () => {
  const before = firstState((state) => state.playerPosition.tileId === "hub.t.3.2");
  assert.equal(screen(before, "hub.t.3.2").icon, "enrichment-ready");
  assert.equal(screen(before, "hub.t.4.2").label, "以太覆盖");
  const after = dispatch(
    content,
    before,
    { kind: "Amplify" },
    before.clock.lastMonotonicTimeMs + 140,
  ).state;
  assert.equal(screen(after, "hub.t.3.2").icon, "enrichment-used");
  assert.equal(screen(after, "hub.t.4.2").label, "道路");
  assert.equal(screen(after, "hub.t.4.2").icon, null);
  assert.equal(screen(after, "hub.t.4.2").visited, false);
});

test("G09 物资实际领取前后保留同一实体，图标从可领取切换到已收集", () => {
  const before = firstState(
    (state) =>
      state.playerPosition.boardId === "a" &&
      state.discoveredTileIds.includes("a.t.6.0") &&
      !state.claimedRewardIds.includes("a.supply.maze01"),
  );
  const after = firstState((state) => state.claimedRewardIds.includes("a.supply.maze01"));
  assert.equal(screen(before, "a.t.6.0").icon, "supply-ready");
  assert.equal(screen(after, "a.t.6.0").icon, "supply-collected");
  assert.equal(screen(before, "a.t.6.0").label, screen(after, "a.t.6.0").label);
});

test("G02 主终端交互完成才切换完成图标，可选挑战完成后对应奖励门才显示开放", () => {
  const beforeTerminal = firstState((state) => state.playerPosition.tileId === "a.t.7.0");
  const afterTerminal = firstState((state) => state.completedObjectiveIds.includes("a.main"));
  assert.equal(screen(beforeTerminal, "a.t.7.0").icon, "terminal-ready");
  assert.equal(screen(afterTerminal, "a.t.7.0").icon, "terminal-complete");
  const beforeDoor = firstState(
    (state) =>
      state.playerPosition.boardId === "a" &&
      state.discoveredTileIds.includes("a.t.-2.-3") &&
      !state.completedObjectiveIds.includes("a.firewall.inner"),
  );
  const afterDoor = firstState(
    (state) =>
      state.playerPosition.boardId === "a" &&
      state.completedObjectiveIds.includes("a.firewall.inner"),
  );
  assert.equal(screen(beforeDoor, "a.t.-2.-3").icon, "door-closed");
  assert.equal(screen(afterDoor, "a.t.-2.-3").icon, "door-open");
});

test("S01 迷宫危险只在真实观察阶段展示，观察结束后投影不保留答案图标或文字", () => {
  let state = firstState((candidate) => candidate.activeStatic?.roomId === "a.maze.01");
  const definition = content.staticChallenges.find((candidate) => candidate.id === "a.maze.01");
  assert.ok(definition?.kind === "memory");
  assert.equal(state.activeStatic?.state.phase, "preview");
  for (const hazardId of definition.hazardTileIds) {
    assert.equal(screen(state, hazardId).icon, "hazard-active");
    assert.equal(screen(state, hazardId).label, "危险格");
  }
  for (let elapsed = 0; elapsed < 4000; elapsed += 250)
    state = dispatch(content, state, { kind: "Tick" }, state.clock.lastMonotonicTimeMs + 250).state;
  assert.equal(state.activeStatic?.state.phase, "active");
  for (const hazardId of definition.hazardTileIds) {
    assert.equal(screen(state, hazardId).icon, null);
    assert.equal(screen(state, hazardId).label, "道路");
    assert.equal(screen(state, hazardId).mark, "");
  }
});

test("I04 / D 未揭示的隐藏路线不作为未知边界泄漏，揭示并走近后才展示", () => {
  const m4 = assembleContent("M4");
  const witness = (r1Witnesses.witnesses as WorldWitness[]).find(
    (candidate) => candidate.id === "m4.world.main-path-without-scored-challenges",
  )!;
  const before = firstState((state) => state.playerPosition.boardId === "d", m4, witness);
  const hiddenIds = m4.tiles.filter((tile) => tile.hiddenGroupId).map((tile) => tile.id);
  assert.ok(hiddenIds.length > 0);
  assert.equal(before.revealedGroupIds.length, 0);
  assert.ok(projectBoard(m4, before).tiles.every((tile) => !hiddenIds.includes(tile.id)));
  const after = firstState(
    (state) =>
      state.playerPosition.boardId === "d" &&
      state.revealedGroupIds.includes("d.group.permission03") &&
      state.discoveredTileIds.includes("d.t.-2.0"),
    m4,
    witness,
  );
  assert.equal(screen(after, "d.t.-2.0", m4).known, true);
  assert.notEqual(screen(after, "d.t.-2.0", m4).icon, "unknown");
});

test("R1 one-stroke exposes exactly six required data tiles and keeps ordinary floor distinct", () => {
  const m2 = assembleContent("M2");
  const witness = (r1Witnesses.witnesses as WorldWitness[]).find(
    (item) => item.id === "m2.world.main-path",
  )!;
  const state = firstState((item) => item.activeStatic?.roomId === "b.line.01", m2, witness);
  const definition = m2.staticChallenges.find((item) => item.id === "b.line.01")!;
  assert.ok(definition.kind === "oneStroke");
  for (const tile of projectBoard(m2, state).tiles) {
    if (tile.id === definition.endTileId) assert.equal(tile.icon, "portal-ready");
    else if (definition.requiredTileIds.includes(tile.id)) assert.equal(tile.icon, "data-ready");
    else assert.equal(tile.icon, null);
  }
});

test("R1 D brick obstacles are visible walls, distinct from missing floor; ghost/lamp remain readable", () => {
  const m4 = assembleContent("M4");
  const witness = (r1Witnesses.witnesses as WorldWitness[]).find(
    (item) => item.id === "m4.world.main-path-without-scored-challenges",
  )!;
  const state = firstState((item) => item.activeRealtime?.roomId === "d.ghost.01", m4, witness);
  const definition = m4.realtimeChallenges.find((item) => item.id === "d.ghost.01")!;
  assert.ok(definition.kind === "ghosts");
  const board = projectBoard(m4, state);
  assert.equal(board.tiles.length, definition.tiles.length + definition.walls!.length);
  for (const wall of definition.walls!) {
    const tile = screen(state, wall.id, m4);
    assert.equal(tile.icon, "brick-wall");
    assert.equal(tile.label, "砖墙 · 不可通行");
    assert.equal(tile.player, false);
  }
  assert.equal(board.tiles.filter((tile) => tile.icon === "lamp-unlit").length, 1);
  assert.equal(board.tiles.filter((tile) => tile.icon === "ghost").length, 2);
});
