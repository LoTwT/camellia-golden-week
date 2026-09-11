import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assembleContent, realtimeContent } from "../src/content/assemble.ts";
import {
  replayWorldWitness,
  validateContent,
  validateWorldWitness,
} from "../src/content/validate.ts";
import type { WorldWitness, WorldWitnessExpectation } from "../src/content/validate.ts";
import { createGame, dispatch, tileCleared, tileRevealed } from "../src/core/engine.ts";
import { areaData, currentObjective, gateOpen, supplyProgress } from "../src/core/progress.ts";
import { projectBoard } from "../src/core/projection.ts";
import type { Direction, GameCommand, GameState } from "../src/core/types.ts";
import { additiveProfileMigrations } from "../src/platform/migrations.ts";
import { restorePayload, stablePayload, validatePayload } from "../src/platform/save-payload.ts";
import m3Json from "../src/content/witnesses/m3.json" with { type: "json" };
import m4Json from "../src/content/witnesses/m4.json" with { type: "json" };

interface Continuation extends WorldWitness {
  readonly initialStateId: string;
  readonly initialProfileId: "M3";
  readonly initialization: "stable-payload-migration";
  readonly expectedBData: number;
  readonly expectedCData: number;
  readonly expectedDData: number;
}
interface GhostWitness {
  readonly id: string;
  readonly commands: readonly { readonly direction: Direction; readonly activeTimeMs: number }[];
  readonly expectedResult: "success" | "failure";
}

const content = assembleContent("M4");
const m3Content = assembleContent("M3");
const migrationRegistry = additiveProfileMigrations([m3Content, content]);
const witnesses = m4Json.witnesses as WorldWitness[];
const mainWitness = witnesses.find(
  (witness) => witness.id === "m4.world.main-path-without-scored-challenges",
)!;
const fullWitness = witnesses.find(
  (witness) => witness.id === "m4.world.full-collection-and-return",
)!;
const main = replayWorldWitness(content, mainWitness);
const full = replayWorldWitness(content, fullWitness);
const continuations = m4Json.continuations as Continuation[];
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

function checkpointSession(name: string, useFull = false): Session {
  const witness = useFull ? fullWitness : mainWitness;
  const state = (useFull ? full : main).checkpoints[name];
  const step = witness.steps.find((candidate) => candidate.checkpoint?.id === name);
  assert.ok(state && step, name);
  return new Session(state, step.atMs);
}

function permanentResults(state: GameState) {
  return {
    objectives: state.completedObjectiveIds,
    rewards: state.claimedRewardIds,
    layouts: state.completedRoomLayouts,
    bestResults: state.bestResults,
    scopeHistory: state.scopeCompletionHistory,
    campaignCompletedAt: state.campaignCompletedAt,
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

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length === 0) return [[]];
  return items.flatMap((item, index) =>
    permutations(items.filter((_, candidate) => candidate !== index)).map((tail) => [
      item,
      ...tail,
    ]),
  );
}

test("M4 正式内容闭合：四区400数据、26奖励130物资、回访和仓库已加载", () => {
  assert.deepEqual(validateContent(content), []);
  assert.equal(content.areas.length, 6);
  assert.equal(content.tiles.length, 214);
  assert.equal(content.tiles.filter((tile) => tile.boardId === "d").length, 39);
  assert.equal(content.rooms.length, 18);
  assert.equal(content.rooms.filter((room) => room.areaId === "d").length, 2);
  assert.equal(content.profile.fullCampaign, true);
  assert.equal(content.profile.scopeTerminalObjectiveId, "warehouse.complete");
  assert.equal(content.dataNodes.length, 20);
  assert.equal(
    content.dataNodes.reduce((sum, node) => sum + node.weight, 0),
    400,
  );
  assert.equal(content.profile.includedRewardIds.length, 26);
  assert.equal(
    content.rewards.reduce((sum, reward) => sum + reward.units, 0),
    130,
  );
  for (const areaId of ["a", "b"] as const) {
    assert.equal(
      content.tiles.filter((tile) => tile.boardId === areaId && tile.includedFrom === 4).length,
      8,
    );
    assert.equal(
      content.entities.find((entity) => entity.id === `${areaId}.revisit.door`)?.gateId,
      "gate.d.main",
    );
  }
  assert.equal(
    content.entities.some((entity) => entity.kind === "unavailable"),
    false,
  );
});

test("G08：新档从未进入防火墙或杀毒，完成20项数据仍能开库与结算100/130", () => {
  assert.deepEqual(main.issues, []);
  assert.equal(main.pickupEventCount, 20);
  assert.equal(supplyProgress(content, main.state).collected, 100);
  assert.equal(main.state.claimedRewardIds.length, 20);
  assert.equal(
    main.state.completedObjectiveIds.some((id) => /^a\.firewall\.|^b\.antivirus\./.test(id)),
    false,
  );
  assert.equal(
    mainWitness.steps.some(
      (step) =>
        step.command.kind === "StartChallenge" &&
        /^a\.firewall\.|^b\.antivirus\./.test(step.command.challengeId),
    ),
    false,
  );
  assert.equal(
    main.state.bestResults.some((result) =>
      /^a\.firewall\.|^b\.antivirus\./.test(result.challengeId),
    ),
    false,
  );
  for (const areaId of ["a", "b", "c", "d"] as const)
    assert.equal(areaData(content, main.state, areaId).collected, 100);
  assert.equal(gateOpen(content, main.state, "gate.warehouse"), true);
  assert.ok(main.state.completedObjectiveIds.includes("warehouse.complete"));
  assert.deepEqual(main.state.scopeCompletionHistory, ["M4"]);
  assert.equal(main.state.campaignCompletedAt, "1970-01-01T00:00:00.000Z");
  assert.match(currentObjective(content, main.state), /主目标完成/);
  const firstD = main.checkpoints["first-d-entry"]!;
  for (const areaId of ["a", "b", "c"] as const)
    assert.equal(areaData(content, firstD, areaId).collected, 20);
  assert.equal(
    firstD.completedObjectiveIds.some((id) => id.startsWith("c.theft.")),
    false,
  );
});

test("G09：新档全收集恰好26个唯一奖励和130单位，不以计分或重复拾取增加物资", () => {
  assert.deepEqual(full.issues, []);
  assert.equal(full.pickupEventCount, 26);
  assert.equal(full.state.claimedRewardIds.length, 26);
  assert.equal(supplyProgress(content, full.state).collected, 130);
  assert.deepEqual(
    new Set(full.state.claimedRewardIds),
    new Set(content.profile.includedRewardIds),
  );
  assert.deepEqual(
    new Set(full.state.completedObjectiveIds),
    new Set(content.profile.includedObjectiveIds),
  );
  assert.deepEqual(full.state.scopeCompletionHistory, ["M4"]);
  assert.ok(full.state.campaignCompletedAt);
});

const permissionOrders = permutations(permissionIds);
assert.equal(permissionOrders.length, 24);
for (const order of permissionOrders) {
  test(`G05：D 四权限实际路线 ${order.join("→")} 无相互门禁且第4项即时开放回访`, () => {
    const session = checkpointSession("first-d-entry");
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
  test(`G06：A/B 回访实际顺序 ${order.join("→")} 只需四权限，旧数据20也可进入`, () => {
    const session = checkpointSession("four-permissions-before-hidden");
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

test("G05/G06/I05：D 四权限之前 A/B 回访实体门不能进入，原区主路径保持可达", () => {
  for (const areaId of ["a", "b"] as const) {
    const session = checkpointSession(`${areaId}-revisit-locked-before-d`);
    const position = session.state.playerPosition.tileId;
    session.send({ kind: "Move", direction: "right" }, "unmetCondition");
    assert.equal(session.state.playerPosition.tileId, position);
    assert.equal(gateOpen(content, session.state, "gate.d.main"), false);
    assert.equal(session.state.completedObjectiveIds.includes(`${areaId}.main`), true);
  }
});

test("I06：19个隐藏格初态不投影、点击或邻接发现，三个揭示组分别由指定节点开放", () => {
  const session = checkpointSession("first-d-entry");
  const hiddenTiles = content.tiles.filter(
    (tile) => tile.boardId === "d" && tile.hiddenGroupId !== null,
  );
  assert.equal(hiddenTiles.length, 19);
  const hiddenIds = new Set(hiddenTiles.map((tile) => tile.id));
  const assertHidden = () => {
    assert.equal(
      session.state.discoveredTileIds.some((id) => hiddenIds.has(id)),
      false,
    );
    assert.equal(
      projectBoard(content, session.state).tiles.some((tile) => hiddenIds.has(tile.id)),
      false,
    );
  };
  assertHidden();
  session.walk("d.t.-1.-1");
  assertHidden();
  session.send({ kind: "Move", direction: "left" }, "blocked");
  session.send({ kind: "ClickTile", tileId: "d.t.-2.-1" }, "invalidTarget");
  assertHidden();
  session.walk("d.t.0.1");
  session.send({ kind: "Amplify" });
  assert.deepEqual(
    session.state.revealedGroupIds.filter((id) => id.startsWith("d.")),
    ["d.group.permission04"],
  );
  assert.ok(session.state.clearedEtherNodeIds.includes("d.reveal.04"));
  const etherBefore = [...session.state.clearedEtherNodeIds];
  session.interact("d.reveal.03");
  assert.deepEqual(session.state.clearedEtherNodeIds, etherBefore);
  assert.equal(session.state.revealedGroupIds.includes("d.group.hidden"), false);
  session.interact("d.reveal.hidden");
  assert.deepEqual(
    new Set(session.state.revealedGroupIds.filter((id) => id.startsWith("d."))),
    new Set(["d.group.permission03", "d.group.permission04", "d.group.hidden"]),
  );
  assert.deepEqual(session.state.clearedEtherNodeIds, etherBefore);
});

test("G05/I06：D 隐藏数据可先于全部权限取得，仅隐藏终端 F 给20数据", () => {
  const session = checkpointSession("first-d-entry");
  session.interact("d.reveal.hidden");
  assert.equal(areaData(content, session.state, "d").collected, 0);
  session.interact("d.hidden.terminal");
  assert.equal(areaData(content, session.state, "d").collected, 20);
  assert.equal(session.state.completedObjectiveIds.includes("d.main"), false);
  assert.equal(
    permissionIds.some((id) => session.state.completedObjectiveIds.includes(`d.permission.${id}`)),
    false,
  );
  assert.equal(session.state.claimedRewardIds.includes("d.supply.hidden"), false);
  session.collect("d.supply.hidden");
  session.interact("d.hidden.terminal", "alreadyCompleted");
  assert.equal(areaData(content, session.state, "d").collected, 20);
  assert.equal(session.state.claimedRewardIds.filter((id) => id === "d.supply.hidden").length, 1);
});

test("G09：两幽灵段即可领取专属物资，不要求任何权限 F 或四权限聚合", () => {
  const session = checkpointSession("first-d-entry");
  session.ghost("d.ghost.01");
  assert.equal(gateOpen(content, session.state, "gate.d.ghosts.cleared"), false);
  session.ghost("d.ghost.02");
  assert.equal(gateOpen(content, session.state, "gate.d.ghosts.cleared"), true);
  assert.equal(areaData(content, session.state, "d").collected, 0);
  session.collect("d.supply.ghosts");
  assert.equal(
    permissionIds.some((id) => session.state.completedObjectiveIds.includes(`d.permission.${id}`)),
    false,
  );
  assert.equal(session.state.completedObjectiveIds.includes("d.main"), false);
  assert.equal(
    session.state.claimedRewardIds.some((id) => id.startsWith("d.supply.permission")),
    false,
  );
});

const warehouseEntrance = content.entities.find((entity) => entity.id === "hub.to.warehouse")!;
const warehouseReady = firstState(
  (state) =>
    state.playerPosition.tileId === warehouseEntrance.tileId &&
    gateOpen(content, state, "gate.warehouse") &&
    !state.completedObjectiveIds.includes("warehouse.complete"),
);
for (const dataNode of content.dataNodes) {
  test(`G07：合成门禁边界仅移除 ${dataNode.id} 时仓库仍拒绝进入`, () => {
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

test("G07：真实流程的最后一项D隐藏数据同事务开库，不等待130物资", () => {
  const before = full.checkpoints["warehouse-locked-without-d-hidden"]!;
  const after = full.checkpoints["last-data-opens-warehouse"]!;
  assert.equal(gateOpen(content, before, "gate.warehouse"), false);
  assert.equal(gateOpen(content, after, "gate.warehouse"), true);
  for (const areaId of ["a", "b", "c", "d"] as const)
    assert.equal(areaData(content, after, areaId).collected, 100);
  assert.equal(supplyProgress(content, after).collected, 116);
  assert.equal(after.claimedRewardIds.includes("d.supply.hidden"), false);
  assert.equal(after.claimedRewardIds.includes("hub.supply.final"), false);
  assert.match(currentObjective(content, after), /中央仓库/);
});

test("G08/G09：最终F同事务完成目标/九单位/结算历史，重复F与自由回访不再发奖", () => {
  const before = checkpointSession("before-final-transaction", true);
  const result = before.send({ kind: "Interact" });
  assert.equal(result.stable, true);
  assert.ok(before.state.completedObjectiveIds.includes("warehouse.complete"));
  assert.ok(before.state.claimedRewardIds.includes("hub.supply.final"));
  assert.equal(supplyProgress(content, before.state).collected, 130);
  assert.deepEqual(before.state.scopeCompletionHistory, ["M4"]);
  assert.ok(before.state.campaignCompletedAt);
  assert.equal(result.events.filter((event) => event.kind === "pickup").length, 1);
  const committed = permanentResults(before.state);
  for (let count = 0; count < 10; count += 1) {
    const repeated = before.send({ kind: "Interact" }, "alreadyCompleted");
    assert.equal(repeated.events.filter((event) => event.kind === "pickup").length, 0);
    assert.deepEqual(permanentResults(before.state), committed);
  }
  for (const checkpoint of [
    "repeat-final-preserves-result",
    "returned-to-hub-after-ending",
    "warehouse-reentry-idempotent",
    "post-ending-ghost-practice",
    "final-free-return",
  ]) {
    assert.deepEqual(permanentResults(full.checkpoints[checkpoint]!), committed, checkpoint);
  }
});

test("G09：整条公开全收集路线的目标、奖励和已开门单调，首次开库前没有结束标记", () => {
  let state = createGame(content, 0);
  let warehouseOpened = false;
  let finalTransactions = 0;
  for (const step of fullWitness.steps) {
    const before = state;
    state = dispatch(content, state, step.command, step.atMs).state;
    for (const id of before.completedObjectiveIds)
      assert.ok(state.completedObjectiveIds.includes(id));
    for (const id of before.claimedRewardIds) assert.ok(state.claimedRewardIds.includes(id));
    if (warehouseOpened) assert.equal(gateOpen(content, state, "gate.warehouse"), true);
    warehouseOpened ||= gateOpen(content, state, "gate.warehouse");
    if (!warehouseOpened) assert.equal(state.campaignCompletedAt, null);
    if (
      !before.completedObjectiveIds.includes("warehouse.complete") &&
      state.completedObjectiveIds.includes("warehouse.complete")
    ) {
      assert.equal(step.command.kind, "Interact");
      assert.equal(before.playerPosition.tileId, "warehouse.t.7.0");
      assert.equal(
        supplyProgress(content, state).collected - supplyProgress(content, before).collected,
        9,
      );
      finalTransactions += 1;
    }
  }
  assert.equal(finalTransactions, 1);
});

for (const ghostId of ["d.ghost.01", "d.ghost.02"]) {
  test(`T09/P02：实际 ${ghostId} 碰撞不发权限/物资，保存回安全终端，重试含亮灯可成功`, () => {
    const session = checkpointSession("first-d-entry");
    const beforeObjectives = [...session.state.completedObjectiveIds];
    const beforeRewards = [...session.state.claimedRewardIds];
    session.startGhost(ghostId);
    const checked = validatePayload(stablePayload(session.state), content);
    assert.equal(checked.ok, true);
    if (!checked.ok) return;
    const restored = restorePayload(checked.value, content, 0);
    assert.equal(restored.mode, "explore");
    assert.equal(
      restored.playerPosition.tileId,
      content.rooms.find((room) => room.id === ghostId)?.returnTileId,
    );
    assert.equal(restored.resumeHint?.challengeId, ghostId);
    session.playGhost(ghostId, "failure");
    assert.deepEqual(session.state.completedObjectiveIds, beforeObjectives);
    assert.deepEqual(session.state.claimedRewardIds, beforeRewards);
    const failedTime = session.state.clock.activeTimeMs;
    session.wait(2000);
    assert.equal(session.state.clock.activeTimeMs, failedTime);
    session.send({ kind: "RetryChallenge" });
    session.send({ kind: "StartChallenge", challengeId: ghostId });
    session.wait(3000);
    session.playGhost(ghostId);
    const realtime = session.state.activeRealtime?.state;
    assert.equal(realtime?.kind, "ghosts");
    if (realtime?.kind === "ghosts") assert.ok(realtime.litLampIds.length >= 1);
    assert.ok(session.state.completedObjectiveIds.includes(ghostId));
    assert.deepEqual(session.state.claimedRewardIds, beforeRewards);
    session.send({ kind: "ExitRoom" });
    assert.equal(session.state.mode, "explore");
  });
}

test("G09/S09：通关后幽灵进入独立练习，普通安全路线与永久结算保持", () => {
  const practice = firstState(
    (state) =>
      state.activeRealtime?.roomId === "d.ghost.01" &&
      state.completedObjectiveIds.includes("warehouse.complete"),
  );
  assert.equal(practice.state.activeRealtime?.practice, true);
  const before = permanentResults(practice.state);
  practice.send({ kind: "ExitRoom" });
  practice.walk("d.t.5.0");
  assert.equal(practice.state.mode, "explore");
  assert.deepEqual(permanentResults(practice.state), before);
  practice.walk("d.t.0.0");
  assert.equal(practice.state.playerPosition.tileId, "d.t.0.0");
});

for (const continuation of continuations) {
  test(`P07：真实M3稳定载荷升级并继续 ${continuation.id}`, () => {
    const sourceWitness = (m3Json.witnesses as WorldWitness[]).find(
      (witness) => witness.id === continuation.initialStateId,
    );
    assert.ok(sourceWitness);
    const source = replayWorldWitness(m3Content, sourceWitness);
    assert.deepEqual(source.issues, []);
    const payload = stablePayload(source.state);
    const originalJSON = JSON.stringify(payload);
    const migrated = validatePayload(payload, content, migrationRegistry);
    assert.equal(migrated.ok, true);
    if (!migrated.ok) return;
    assert.equal(migrated.migrated, true);
    assert.equal(JSON.stringify(payload), originalJSON);
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
    const session = new Session(restorePayload(migrated.value, content, 0), 0);
    assert.equal(session.state.releaseProfileId, "M4");
    assert.equal(areaData(content, session.state, "d").collected, 0);
    assert.equal(session.state.activatedTeleportIds.includes("d.teleport"), false);
    assert.equal(
      session.state.completedObjectiveIds.some((id) => id.includes("revisit")),
      false,
    );
    assert.equal(areaData(content, session.state, "a").includedTotal, 100);
    assert.equal(areaData(content, session.state, "b").includedTotal, 100);
    assert.equal(
      supplyProgress(content, session.state).collected,
      continuation.expected.supplyUnits === 130 ? 81 : 11,
    );
    const {
      initialStateId: _state,
      initialProfileId: _profile,
      initialization: _initialization,
      expectedBData,
      expectedCData,
      expectedDData,
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
    assert.equal(areaData(content, session.state, "d").collected, expectedDData);
    assert.equal(pickupEvents, continuation.expected.supplyUnits === 130 ? 9 : 17);
    assert.deepEqual(session.state.scopeCompletionHistory, ["M3", "M4"]);
    for (const [roomId, layout] of Object.entries(payload.completedRoomLayouts))
      assert.deepEqual(session.state.completedRoomLayouts[roomId], layout);
    for (const best of payload.bestResults)
      assert.deepEqual(
        session.state.bestResults.find((candidate) => candidate.challengeId === best.challengeId),
        best,
      );
    const finalPayload = stablePayload(session.state);
    const finalChecked = validatePayload(finalPayload, content);
    assert.equal(finalChecked.ok, true);
    if (!finalChecked.ok) return;
    assert.equal(finalChecked.migrated, undefined);
    const restored = restorePayload(finalChecked.value, content, 0);
    matchesExpectation(restored, continuation.expected);
    assert.deepEqual(permanentResults(restored), permanentResults(session.state));
  });
}

test("P07：实际浏览器导出的M3全收集81载荷，保留M1/M2/M3历史后用同一公开路线到130", () => {
  const text = readFileSync(
    new URL("../docs/verification/evidence/m3-browser-save.json", import.meta.url),
    "utf8",
  );
  const envelope = JSON.parse(text) as { payload: unknown };
  const source = validatePayload(envelope.payload, m3Content);
  assert.equal(source.ok, true);
  if (!source.ok) return;
  const migrated = validatePayload(source.value, content, migrationRegistry);
  assert.equal(migrated.ok, true);
  if (!migrated.ok) return;
  assert.equal(supplyProgress(m3Content, source.value).collected, 81);
  const session = new Session(restorePayload(migrated.value, content, 0), 0);
  const continuation = continuations.find((candidate) => candidate.expected.supplyUnits === 130)!;
  for (const step of continuation.steps)
    session.send(step.command, step.expectedCode, step.atMs - session.now);
  matchesExpectation(session.state, continuation.expected);
  assert.deepEqual(session.state.scopeCompletionHistory, ["M1", "M2", "M3", "M4"]);
  for (const [roomId, layout] of Object.entries(source.value.completedRoomLayouts))
    assert.deepEqual(session.state.completedRoomLayouts[roomId], layout);
  assert.equal(
    readFileSync(
      new URL("../docs/verification/evidence/m3-browser-save.json", import.meta.url),
      "utf8",
    ),
    text,
  );
});

test("I09/G09：仓库与中心实体入口连续30次往返无自动回跳，最终物资仍130", () => {
  const session = new Session(full.state, fullWitness.steps.at(-1)!.atMs);
  const before = permanentResults(session.state);
  for (let count = 0; count < 30; count += 1) {
    session.interact("hub.to.warehouse");
    assert.equal(session.state.playerPosition.tileId, "warehouse.t.0.0");
    session.send({ kind: "Tick" });
    assert.equal(session.state.playerPosition.tileId, "warehouse.t.0.0");
    session.interact("warehouse.to.hub");
    assert.equal(session.state.playerPosition.tileId, "hub.t.0.0");
    session.send({ kind: "Tick" });
    assert.equal(session.state.playerPosition.tileId, "hub.t.0.0");
  }
  assert.deepEqual(permanentResults(session.state), before);
  assert.equal(supplyProgress(content, session.state).collected, 130);
});
