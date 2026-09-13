// These tests replay the original v1 recordings/exports against their published content view.
import assert from "node:assert/strict";
import test from "node:test";
import { assembleLegacyContent as assembleContent } from "../src/content/assemble.ts";
import { replayWorldWitness } from "../src/content/validate.ts";
import type { WorldWitness } from "../src/content/validate.ts";
import { dispatch, safePath } from "../src/core/engine.ts";
import type { EntityDefinition, GameCommand, GameContent, GameState } from "../src/core/types.ts";
import { AutoWalkScheduler, InputAdapter } from "../src/platform/input.ts";
import witnessContent from "../src/content/witnesses/m1.ts";

const content = assembleContent("M1");
const witness = (witnessContent.witnesses as WorldWitness[]).find(
  (candidate) => candidate.id === "m1.world.full-collection-and-return",
)!;
const completedWorld = replayWorldWitness(content, witness).state;

function harness() {
  const gameContent = structuredClone(content);
  let state = structuredClone(completedWorld);
  const scheduler = new AutoWalkScheduler();
  const start = state.clock.lastMonotonicTimeMs + 140;
  const sent: { command: GameCommand; time: number; tileId: string }[] = [];
  const send = (command: GameCommand, now: number) => {
    const result = dispatch(gameContent, state, command, now);
    state = result.state;
    scheduler.observe(command, state, now);
    sent.push({ command, time: now, tileId: state.playerPosition.tileId });
    return result;
  };
  return {
    content: gameContent,
    get state() {
      return state;
    },
    start,
    sent,
    send,
    frame(now: number, canPlay = true) {
      send({ kind: "Tick" }, now);
      const command = scheduler.nextCommand(now, canPlay);
      return command ? send(command, now) : null;
    },
  };
}

test("I03 自动续步从物理点击的首步起等待 140ms，最后一格也按同一节奏", () => {
  const game = harness();
  game.send({ kind: "ClickTile", tileId: "a.t.2.-2" }, game.start);
  assert.equal(game.state.playerPosition.tileId, "a.t.0.-1");
  assert.deepEqual(game.state.autoPath, ["a.t.0.-2", "a.t.1.-2", "a.t.2.-2"]);
  for (const offset of [1, 139]) assert.equal(game.frame(game.start + offset), null);
  assert.equal(game.frame(game.start + 140)?.code, "accepted");
  assert.equal(game.state.playerPosition.tileId, "a.t.0.-2");
  assert.equal(game.frame(game.start + 279), null);
  game.frame(game.start + 280);
  assert.equal(game.state.playerPosition.tileId, "a.t.1.-2");
  game.frame(game.start + 420);
  assert.equal(game.state.playerPosition.tileId, "a.t.2.-2");
  assert.deepEqual(game.state.autoPath, []);
  assert.equal(game.frame(game.start + 560), null);
  assert.deepEqual(
    game.sent.filter((item) => item.command.kind === "AdvanceAutoPath").map((item) => item.time),
    [game.start + 140, game.start + 280, game.start + 420],
  );
});

test("I03 迟到帧只续走一格，下一步从实际执行时刻再等 140ms，不补跑", () => {
  const game = harness();
  game.send({ kind: "ClickTile", tileId: "a.t.2.-2" }, game.start);
  game.frame(game.start + 239);
  assert.equal(game.state.playerPosition.tileId, "a.t.0.-2");
  assert.equal(game.frame(game.start + 240), null);
  assert.equal(game.frame(game.start + 378), null);
  game.frame(game.start + 379);
  assert.equal(game.state.playerPosition.tileId, "a.t.1.-2");
  assert.equal(game.frame(game.start + 380), null);
});

type BoundaryChange = (content: GameContent, state: GameState, tileId: string) => void;
const boundaryChanges: [string, BoundaryChange][] = [
  [
    "不再已访问",
    (_content, state, tileId) => {
      state.visitedTileIds = state.visitedTileIds.filter((id) => id !== tileId);
    },
  ],
  [
    "不再已发现",
    (_content, state, tileId) => {
      state.discoveredTileIds = state.discoveredTileIds.filter((id) => id !== tileId);
    },
  ],
  [
    "隐藏组尚未揭示",
    (content, _state, tileId) => {
      content.tiles.find((tile) => tile.id === tileId)!.hiddenGroupId = "fixture.hidden";
    },
  ],
  [
    "覆盖尚未驱散",
    (content, _state, tileId) => {
      content.tiles.find((tile) => tile.id === tileId)!.etherGroupId = "fixture.ether";
    },
  ],
  [
    "道路变成墙",
    (content, _state, tileId) => {
      content.tiles.find((tile) => tile.id === tileId)!.terrain = "wall";
    },
  ],
];
for (const kind of ["supply", "roomEntrance", "nexus", "teleport", "challengeAccess"] as const)
  boundaryChanges.push([
    `${kind} 事件出现`,
    (content, _state, tileId) => {
      const entity = content.entities.find((candidate) => candidate.kind === kind)!;
      content.entities.push({ ...structuredClone(entity), id: `fixture.${kind}`, tileId });
    },
  ]);
boundaryChanges.push([
  "门条件关闭",
  (content, state, tileId) => {
    const door = content.entities.find((entity) => entity.id === "a.firewall.inner.door")!;
    content.entities.push({ ...structuredClone(door), id: "fixture.door", tileId });
    state.completedObjectiveIds = state.completedObjectiveIds.filter(
      (id) => id !== "a.firewall.inner",
    );
  },
]);

test("I03 中途及最后一格重新校验全部安全条件，变化时停在前格且不拾取、不入房、不另算绕路", () => {
  for (const destination of ["a.t.0.-2", "a.t.1.-2"])
    for (const [name, change] of boundaryChanges) {
      const game = harness();
      game.send({ kind: "ClickTile", tileId: destination }, game.start);
      assert.equal(game.state.playerPosition.tileId, "a.t.0.-1");
      // 唯一注入是排好路径后的边界变化；起点与已访问路径来自正常 M1 命令见证。
      change(game.content, game.state, "a.t.0.-2");
      if (name === "道路变成墙" && destination === "a.t.1.-2")
        assert.deepEqual(safePath(game.content, game.state, destination), ["a.t.1.-1", "a.t.1.-2"]);
      const before = structuredClone(game.state);
      const result = game.frame(game.start + 140)!;
      const label = `${name} -> ${destination}`;
      assert.equal(result.code, "blocked", label);
      assert.deepEqual(result.state.playerPosition, before.playerPosition, label);
      assert.equal(result.state.mode, "explore", label);
      assert.deepEqual(result.state.autoPath, [], label);
      assert.deepEqual(result.state.claimedRewardIds, before.claimedRewardIds, label);
      assert.deepEqual(result.state.completedObjectiveIds, before.completedObjectiveIds, label);
      assert.deepEqual(result.state.completedRoomLayouts, before.completedRoomLayouts, label);
      assert.equal(result.state.stateRevision, before.stateRevision, label);
      assert.equal(result.stable, false, label);
      assert.deepEqual(
        result.events.map((event) => event.kind),
        ["invalid"],
        label,
      );
      assert.equal(game.frame(game.start + 280), null, label);
    }
});

test("I03 已开且无其他事件的门仍可逐步通过；新点击替换目标并重锚续步", () => {
  const game = harness();
  assert.ok(safePath(game.content, game.state, "a.t.-4.-3").includes("a.t.-2.-3"));
  game.send({ kind: "ClickTile", tileId: "a.t.-4.-3" }, game.start);
  for (let step = 1; game.state.autoPath.length; step += 1) game.frame(game.start + step * 140);
  assert.equal(game.state.playerPosition.tileId, "a.t.-4.-3");

  const changed = harness();
  changed.send({ kind: "ClickTile", tileId: "a.t.2.-2" }, changed.start);
  changed.send({ kind: "ClickTile", tileId: "a.t.-2.-2" }, changed.start + 50);
  assert.equal(changed.state.playerPosition.tileId, "a.t.0.-2");
  assert.deepEqual(changed.state.autoPath, ["a.t.-1.-2", "a.t.-2.-2"]);
  assert.equal(changed.frame(changed.start + 189), null);
  changed.frame(changed.start + 190);
  assert.equal(changed.state.playerPosition.tileId, "a.t.-1.-2");
  changed.send({ kind: "ClickTile", tileId: "missing.tile" }, changed.start + 200);
  assert.deepEqual(changed.state.autoPath, []);
  assert.equal(changed.frame(changed.start + 340), null);
});

test("I03 取消是瞬时临时命令，不改变时钟、稳定 revision、永久进度或反馈", () => {
  const game = harness();
  game.send({ kind: "ClickTile", tileId: "a.t.0.-2" }, game.start);
  const before = structuredClone(game.state);
  const cancelled = game.send({ kind: "CancelAutoPath" }, game.start + 500);
  assert.deepEqual(cancelled.state, { ...before, autoPath: [] });
  assert.equal(cancelled.stable, false);
  assert.deepEqual(cancelled.events, []);
});

test("I03 暂停或时钟断档丢弃旧路径，恢复后不补走", () => {
  for (const reason of ["manual", "clockGap"] as const) {
    const game = harness();
    game.send({ kind: "ClickTile", tileId: "a.t.2.-2" }, game.start);
    if (reason === "manual")
      game.send({ kind: "Pause", reason: "manual", present: true }, game.start + 50);
    else game.frame(game.start + 251);
    assert.deepEqual(game.state.autoPath, []);
    assert.ok(game.state.clock.pauseReasons.includes(reason));
    game.send(
      { kind: "Resume", pageVisible: true, canvasOperable: true, graphicsAvailable: true },
      game.start + 1000,
    );
    assert.equal(game.frame(game.start + 1100), null);
    assert.equal(game.state.playerPosition.tileId, "a.t.0.-1");
  }
});

test("I03 物理相邻点击仍可探索未访问格并触发对象，自动续步没有改变手动规则", () => {
  const game = harness();
  const supply = game.content.entities.find((entity) => entity.kind === "supply")!;
  assert.equal(supply.kind, "supply");
  const target = "a.t.0.-1";
  game.state.visitedTileIds = game.state.visitedTileIds.filter((id) => id !== target);
  game.state.claimedRewardIds = game.state.claimedRewardIds.filter(
    (id) => id !== supply.params.rewardId,
  );
  game.content.entities.push({
    ...structuredClone(supply),
    id: "fixture.manual-supply",
    tileId: target,
  } satisfies EntityDefinition);
  const result = game.send({ kind: "ClickTile", tileId: target }, game.start);
  assert.equal(result.code, "accepted");
  assert.equal(result.state.playerPosition.tileId, target);
  assert.ok(result.state.visitedTileIds.includes(target));
  assert.ok(result.state.claimedRewardIds.includes(supply.params.rewardId));
  assert.equal(result.events.filter((event) => event.kind === "pickup").length, 1);
});

test("I03 新物理方向即使进入 140ms 等待队列也立即取消旧路径，随后只执行等待方向", (context) => {
  class TestDocument extends EventTarget {
    activeElement: EventTarget | null = null;
  }
  const document = new TestDocument();
  const canvas = new EventTarget();
  document.activeElement = canvas;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: document });
  const game = harness();
  let now = game.start;
  context.mock.method(performance, "now", () => now);
  const adapter = new InputAdapter(
    canvas as unknown as HTMLCanvasElement,
    game.send,
    () => ({ firewall: false, canPlay: true }),
    () => {},
    () => {},
    (time) => {
      if (game.state.autoPath.length) game.send({ kind: "CancelAutoPath" }, time);
    },
  );
  context.after(() => {
    adapter.dispose();
    if (descriptor) Object.defineProperty(globalThis, "document", descriptor);
    else Reflect.deleteProperty(globalThis, "document");
  });
  const key = (code: string, time: number) => {
    now = time;
    document.dispatchEvent(Object.assign(new Event("keydown", { cancelable: true }), { code }));
    document.dispatchEvent(Object.assign(new Event("keyup"), { code }));
  };
  key("ArrowUp", game.start);
  game.send({ kind: "ClickTile", tileId: "a.t.2.-2" }, game.start + 20);
  assert.equal(game.state.playerPosition.tileId, "a.t.0.-2");
  assert.deepEqual(game.state.autoPath, ["a.t.1.-2", "a.t.2.-2"]);
  key("ArrowDown", game.start + 30);
  assert.deepEqual(game.state.autoPath, []);
  assert.equal(game.sent.at(-1)!.command.kind, "CancelAutoPath");
  adapter.frame(game.start + 139);
  assert.equal(game.state.playerPosition.tileId, "a.t.0.-2");
  adapter.frame(game.start + 140);
  assert.equal(game.state.playerPosition.tileId, "a.t.0.-1");
  assert.equal(game.frame(game.start + 160), null);
  assert.deepEqual(
    game.sent
      .filter((item) => item.command.kind !== "Tick")
      .map(({ command, time }) => [command, time]),
    [
      [{ kind: "Move", direction: "up" }, game.start],
      [{ kind: "ClickTile", tileId: "a.t.2.-2" }, game.start + 20],
      [{ kind: "CancelAutoPath" }, game.start + 30],
      [{ kind: "Move", direction: "down" }, game.start + 140],
    ],
  );
});
