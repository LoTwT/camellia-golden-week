// R1 progression proofs use current maps and public dispatch; only labelled gate faults are synthetic.
import assert from "node:assert/strict";
import test from "node:test";
import { assembleContent, realtimeContent } from "../src/content/assemble.ts";
import { worldWitnesses } from "../src/content/witnesses/index.ts";
import { createGame, dispatch, tileCleared, tileRevealed } from "../src/core/engine.ts";
import { areaData, currentObjective, gateOpen, supplyProgress } from "../src/core/progress.ts";
import type { Direction, GameCommand, GameState } from "../src/core/types.ts";

interface GhostWitness {
  readonly id: string;
  readonly commands: readonly { readonly direction: Direction; readonly activeTimeMs: number }[];
  readonly expectedResult: "success" | "failure";
}
const content = assembleContent("M4");
const mainWitness = worldWitnesses.find(
  (witness) => witness.id === "m4.world.main-path-without-scored-challenges",
)!;
const fullWitness = worldWitnesses.find(
  (witness) => witness.id === "m4.world.full-collection-and-return",
)!;
const permissionIds = ["01", "02", "03", "04"] as const;
const directions: ReadonlyArray<readonly [Direction, number, number]> = [
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

  wait(milliseconds: number): void {
    for (let remaining = milliseconds; remaining > 0;) {
      const delta = Math.min(250, remaining);
      this.send({ kind: "Tick" }, "accepted", delta);
      remaining -= delta;
    }
  }

  /** Find geometry only; every traversed edge remains a validated public Move command. */
  walk(targetTileId: string): void {
    assert.equal(this.state.mode, "explore");
    const queue = [{ tileId: this.state.playerPosition.tileId, path: [] as Direction[] }];
    const seen = new Set([this.state.playerPosition.tileId]);
    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index]!;
      if (current.tileId === targetTileId) {
        for (const direction of current.path) this.send({ kind: "Move", direction });
        assert.equal(this.state.playerPosition.tileId, targetTileId);
        return;
      }
      const from = content.tiles.find((tile) => tile.id === current.tileId)!;
      for (const [direction, dx, dy] of directions) {
        const next = content.tiles.find(
          (tile) =>
            tile.boardId === from.boardId && tile.x === from.x + dx && tile.y === from.y + dy,
        );
        if (
          !next ||
          seen.has(next.id) ||
          next.terrain !== "floor" ||
          !tileCleared(content, this.state, next.id) ||
          !tileRevealed(content, this.state, next.id)
        )
          continue;
        const entities = content.entities.filter((entity) => entity.tileId === next.id);
        if (
          entities.some(
            (entity) =>
              (entity.kind === "door" || entity.kind === "supply") &&
              !gateOpen(content, this.state, entity.gateId),
          )
        )
          continue;
        if (
          next.id !== targetTileId &&
          entities.some(
            (entity) => entity.kind === "roomEntrance" && entity.params.interactionMode === "enter",
          )
        )
          continue;
        seen.add(next.id);
        queue.push({ tileId: next.id, path: [...current.path, direction] });
      }
    }
    throw new Error(`无合法世界路线 ${this.state.playerPosition.tileId} → ${targetTileId}`);
  }

  interact(entityId: string, expectedCode = "accepted"): void {
    const entity = content.entities.find((candidate) => candidate.id === entityId);
    assert.ok(entity, entityId);
    this.walk(entity.tileId);
    this.send({ kind: "Interact" }, expectedCode);
  }

  collect(rewardId: string): void {
    const entity = content.entities.find(
      (candidate) => candidate.kind === "supply" && candidate.params.rewardId === rewardId,
    );
    assert.ok(entity);
    this.walk(entity.tileId);
    assert.ok(this.state.claimedRewardIds.includes(rewardId));
  }

  startGhost(id: string): void {
    this.interact(`${id}.entrance`);
    this.send({ kind: "StartChallenge", challengeId: id });
    this.wait(3000);
    assert.equal(this.state.clock.activeTimeMs, 0);
  }

  playGhost(id: string, variant: "success" | "failure" = "success"): void {
    const witness = (realtimeContent.witnesses as GhostWitness[]).find(
      (candidate) => candidate.id === `${id}.witness.${variant}`,
    );
    assert.ok(witness);
    for (const input of witness.commands) {
      let gap = input.activeTimeMs - this.state.clock.activeTimeMs;
      while (gap > 250) {
        this.send({ kind: "Tick" }, "accepted", Math.min(250, gap - 140));
        gap = input.activeTimeMs - this.state.clock.activeTimeMs;
      }
      this.send({ kind: "Move", direction: input.direction }, "accepted", gap);
    }
    assert.equal(this.state.mode, "challengeResult");
    assert.equal(this.state.phase, variant);
  }

  ghost(id: string): void {
    this.startGhost(id);
    this.playGhost(id);
    this.send({ kind: "ExitRoom" });
  }

  permission(number: (typeof permissionIds)[number]): void {
    if (number === "01" || number === "02") this.ghost(`d.ghost.${number}`);
    else if (number === "03") this.interact("d.reveal.03");
    else {
      this.walk("d.t.0.1");
      this.send({ kind: "Amplify" });
    }
    this.interact(`d.permission.${number}`);
    this.walk("d.t.0.0");
  }

  revisit(areaId: "a" | "b"): void {
    this.send({ kind: "Teleport", teleportId: `${areaId}.teleport` });
    const nexus = content.entities.find((entity) => entity.id === `${areaId}.revisit.nexus`)!;
    this.walk(nexus.tileId);
    this.send({ kind: "Move", direction: "down" }, "blocked");
    const beforeData = areaData(content, this.state, areaId).collected;
    this.send({ kind: "Amplify" });
    assert.equal(areaData(content, this.state, areaId).collected, beforeData);
    this.interact(`${areaId}.revisit.terminal`);
    assert.equal(areaData(content, this.state, areaId).collected, beforeData + 20);
    assert.equal(this.state.claimedRewardIds.includes(`${areaId}.supply.revisit`), false);
    this.collect(`${areaId}.supply.revisit`);
    this.walk(`${areaId}.t.0.0`);
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
  throw new Error("公开命令见证未到达所需状态");
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length === 0) return [[]];
  return items.flatMap((item, index) =>
    permutations(items.filter((_, candidate) => candidate !== index)).map((tail) => [
      item,
      ...tail,
    ]),
  );
}

const firstD = firstState(
  (state) => state.mode === "explore" && state.playerPosition.tileId === "d.t.0.0",
  mainWitness,
);
assert.equal(content.ruleVersion, 4);
assert.equal(firstD.state.completedObjectiveIds.includes("d.main"), false);
assert.equal(areaData(content, firstD.state, "d").collected, 0);
const fourPermissions = firstState(
  (state) => state.mode === "explore" && state.completedObjectiveIds.includes("d.main"),
  mainWitness,
);
assert.equal(fourPermissions.state.completedObjectiveIds.includes("d.hidden.terminal"), false);
const permissionOrders = permutations(permissionIds);
assert.equal(permissionOrders.length, 24);
for (const order of permissionOrders) {
  test(`R1 G05：D 四权限实际路线 ${order.join("→")} 无相互门禁且第4项即时开放回访`, () => {
    const session = new Session(structuredClone(firstD.state), firstD.now);
    const rewardsBefore = [...session.state.claimedRewardIds];
    for (const [index, number] of order.entries()) {
      session.permission(number);
      assert.equal(areaData(content, session.state, "d").collected, (index + 1) * 20);
      assert.equal(session.state.completedObjectiveIds.includes("d.main"), index === 3);
      assert.equal(gateOpen(content, session.state, "gate.d.main"), index === 3);
      assert.equal(session.state.completedObjectiveIds.includes("d.hidden.terminal"), false);
      assert.equal(session.state.revealedGroupIds.includes("d.group.hidden"), false);
      assert.equal(session.state.playerPosition.tileId, "d.t.0.0");
      assert.equal(session.state.mode, "explore");
      assert.deepEqual(session.state.claimedRewardIds, rewardsBefore, "权限 F 与门后物资独立");
      if (index < 3)
        assert.match(currentObjective(content, session.state), new RegExp(`${index + 1} / 4`));
    }
    assert.equal(gateOpen(content, session.state, "gate.warehouse"), false);
    assert.ok(session.state.completedObjectiveIds.includes("d.ghosts.cleared"));
    assert.match(currentObjective(content, session.state), /回访/);
  });
}

for (const order of [
  ["a", "b"],
  ["b", "a"],
] as const) {
  test(`R1 G06：A/B 回访实际顺序 ${order.join("→")} 只需四权限，旧数据20也可进入`, () => {
    const session = new Session(structuredClone(fourPermissions.state), fourPermissions.now);
    for (const areaId of ["a", "b"] as const)
      assert.equal(areaData(content, session.state, areaId).collected, 20);
    const before = supplyProgress(content, session.state).collected;
    session.revisit(order[0]);
    assert.equal(
      session.state.completedObjectiveIds.includes(`${order[1]}.revisit.terminal`),
      false,
    );
    assert.equal(areaData(content, session.state, order[0]).collected, 40);
    assert.equal(areaData(content, session.state, order[1]).collected, 20);
    session.revisit(order[1]);
    assert.equal(supplyProgress(content, session.state).collected, before + 10);
    assert.equal(session.state.completedObjectiveIds.includes("d.hidden.terminal"), false);
    assert.equal(gateOpen(content, session.state, "gate.warehouse"), false);
  });
}

const warehouseEntrance = content.entities.find((entity) => entity.id === "hub.to.warehouse")!;
const warehouseReady = firstState(
  (state) =>
    state.playerPosition.tileId === warehouseEntrance.tileId &&
    gateOpen(content, state, "gate.warehouse") &&
    !state.completedObjectiveIds.includes("warehouse.complete"),
);
for (const dataNode of content.dataNodes) {
  test(`R1 G07：合成门禁边界仅移除 ${dataNode.id} 时仓库仍拒绝进入`, () => {
    // Deliberate gate-only fault injection; this is not a playable or importable save fixture.
    const incomplete: GameState = {
      ...warehouseReady.state,
      completedObjectiveIds: warehouseReady.state.completedObjectiveIds.filter(
        (id) => id !== dataNode.completionObjectiveId,
      ),
    };
    assert.equal(
      incomplete.completedObjectiveIds.length,
      warehouseReady.state.completedObjectiveIds.length - 1,
    );
    assert.equal(areaData(content, incomplete, dataNode.areaId).collected, 80);
    assert.equal(gateOpen(content, incomplete, "gate.warehouse"), false);
    const session = new Session(incomplete, warehouseReady.now);
    const result = session.send({ kind: "Interact" }, "unmetCondition");
    assert.equal(result.stable, false);
    assert.equal(session.state.playerPosition.tileId, warehouseEntrance.tileId);
    assert.equal(session.state.completedObjectiveIds.includes("warehouse.complete"), false);
    assert.deepEqual(session.state.claimedRewardIds, incomplete.claimedRewardIds);
  });
}

test("R1 G07：真实全收集路线最后一项数据同事务开库，不等待全部130物资", () => {
  let state = createGame(content, 0);
  for (const step of fullWitness.steps) {
    const before = state;
    const result = dispatch(content, state, step.command, step.atMs);
    assert.equal(result.code, step.expectedCode);
    state = result.state;
    if (
      !gateOpen(content, before, "gate.warehouse") &&
      gateOpen(content, state, "gate.warehouse")
    ) {
      assert.equal(result.stable, true);
      assert.equal(before.completedObjectiveIds.includes("d.hidden.terminal"), false);
      assert.equal(state.completedObjectiveIds.includes("d.hidden.terminal"), true);
      for (const areaId of ["a", "b", "c", "d"] as const)
        assert.equal(areaData(content, state, areaId).collected, 100);
      assert.equal(supplyProgress(content, state).collected, 116);
      assert.equal(state.claimedRewardIds.includes("d.supply.hidden"), false);
      assert.equal(state.claimedRewardIds.includes("hub.supply.final"), false);
      assert.match(currentObjective(content, state), /中央仓库/);
      return;
    }
  }
  assert.fail("当前完整见证必须包含由真实最后一项数据开库的事务");
});

test("R1 G05/G06：权限集未完成前，两处回访门拒绝进入且原区主终端仍保留", () => {
  for (const areaId of ["a", "b"] as const) {
    const session = new Session(structuredClone(firstD.state), firstD.now);
    session.send({ kind: "Teleport", teleportId: `${areaId}.teleport` });
    const door = content.entities.find((entity) => entity.id === `${areaId}.revisit.door`)!;
    const tile = content.tiles.find((tile) => tile.id === door.tileId)!;
    const before = content.tiles.find(
      (candidate) =>
        candidate.boardId === tile.boardId && candidate.x === tile.x - 1 && candidate.y === tile.y,
    )!;
    session.walk(before.id);
    session.send({ kind: "Move", direction: "right" }, "unmetCondition");
    assert.equal(session.state.playerPosition.tileId, before.id);
    assert.equal(gateOpen(content, session.state, "gate.d.main"), false);
    assert.equal(session.state.completedObjectiveIds.includes(`${areaId}.main`), true);
  }
});
