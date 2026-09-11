// These tests replay the original v1 recordings/exports against their published content view.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assembleLegacyContent as assembleContent,
  legacyRealtimeContent as realtimeContent,
} from "../src/content/assemble.ts";
import { validateContent } from "../src/content/validate.ts";
import { dispatch } from "../src/core/engine.ts";
import { areaData, gateOpen, supplyProgress } from "../src/core/progress.ts";
import type { GhostsState, RealtimeWitness } from "../src/core/realtime.ts";
import type { Direction, FeedbackEvent, GameCommand, GameState } from "../src/core/types.ts";
import { additiveProfileMigrations } from "../src/platform/migrations.ts";
import { restorePayload, stablePayload, validatePayload } from "../src/platform/save-payload.ts";

const content = assembleContent("M4");
const sourceContent = assembleContent("M3");
const registry = additiveProfileMigrations([sourceContent, content]);
const originalRaw = readFileSync(
  new URL("../docs/verification/evidence/m3-browser-main-save.json", import.meta.url),
  "utf8",
);
const original = JSON.parse(originalRaw) as { payload: unknown };
const migrated = validatePayload(original.payload, content, registry);
assert.ok(migrated.ok, migrated.ok ? "" : migrated.error);
const initialPayload = migrated.value;
const ids = ["d.ghost.01", "d.ghost.02"] as const;
type GhostId = (typeof ids)[number];
const directions: Record<GhostId, Direction> = {
  "d.ghost.01": "right",
  "d.ghost.02": "up",
};
const permissionIds: Record<GhostId, string> = {
  "d.ghost.01": "d.permission.01",
  "d.ghost.02": "d.permission.02",
};
const rewardIds: Record<GhostId, string> = {
  "d.ghost.01": "d.supply.permission01",
  "d.ghost.02": "d.supply.permission02",
};

class Session {
  state: GameState;
  now = 0;
  readonly events: FeedbackEvent[] = [];

  constructor(state = restorePayload(initialPayload, content, 0)) {
    this.state = state;
  }

  send(command: GameCommand, after = 140, expectedCode = "accepted") {
    this.now += after;
    const result = dispatch(content, this.state, command, this.now);
    assert.equal(
      result.code,
      expectedCode,
      `${this.state.playerPosition.tileId} ${JSON.stringify(command)}: ${result.state.lastResult.message}`,
    );
    this.state = result.state;
    this.events.push(...result.events);
    return result;
  }

  wait(milliseconds: number) {
    assert.ok(milliseconds >= 0);
    for (let remaining = milliseconds; remaining > 0;) {
      const delta = Math.min(250, remaining);
      this.send({ kind: "Tick" }, delta);
      remaining -= delta;
    }
  }

  move(direction: Direction, count = 1) {
    for (let index = 0; index < count; index++) this.send({ kind: "Move", direction });
  }

  enter(id: GhostId) {
    this.send({ kind: "Teleport", teleportId: "d.teleport" });
    this.move(directions[id], 2);
    assert.equal(this.state.mode, "explore");
    const result = this.send({ kind: "Interact" });
    assert.equal(this.state.mode, "challengeReady");
    assert.equal(result.clearInputs, true);
  }

  start(id: GhostId) {
    const result = this.send({ kind: "StartChallenge", challengeId: id });
    assert.equal(result.stable, true);
    assert.equal(result.clearInputs, true);
    assert.equal(this.state.mode, "challengeRunning");
    assert.equal(this.state.activeRealtime?.roomId, id);
    assert.equal(this.state.clock.activeTimeMs, 0);
    assert.equal(this.state.clock.countdownRemainingMs, 3000);
    return result;
  }

  play(id: GhostId, outcome: "success" | "failure") {
    const witness = (realtimeContent.witnesses as RealtimeWitness[]).find(
      (candidate) => candidate.id === `${id}.witness.${outcome}`,
    );
    assert.ok(witness);
    this.wait(this.state.clock.countdownRemainingMs);
    for (const command of witness.commands) {
      assert.equal(command.kind, "move");
      assert.ok(command.kind === "move");
      this.wait(command.activeTimeMs - this.state.clock.activeTimeMs);
      this.send({ kind: "Move", direction: command.direction }, 0);
    }
    assert.equal(this.state.mode, "challengeResult");
    assert.equal(this.state.phase, outcome);
    assert.equal(activeGhost(this).status, outcome);
  }
}

function atD(): Session {
  const playing = new Session();
  assert.equal(playing.state.playerPosition.tileId, "c.t.7.0");
  playing.move("right");
  playing.send({ kind: "Interact" });
  assert.equal(playing.state.playerPosition.tileId, "d.t.0.0");
  assert.equal(areaData(content, playing.state, "c").collected, 20);
  assert.ok(playing.state.activatedTeleportIds.includes("d.teleport"));
  return playing;
}

function activeGhost(playing: Session): GhostsState {
  const state = playing.state.activeRealtime?.state;
  assert.ok(state?.kind === "ghosts");
  return state;
}

function permanent(state: GameState) {
  return structuredClone({
    completedObjectiveIds: state.completedObjectiveIds,
    completedRoomLayouts: state.completedRoomLayouts,
    claimedRewardIds: state.claimedRewardIds,
    capabilities: state.capabilities,
    clearedEtherNodeIds: state.clearedEtherNodeIds,
    revealedGroupIds: state.revealedGroupIds,
    scopeCompletionHistory: state.scopeCompletionHistory,
    campaignCompletedAt: state.campaignCompletedAt,
  });
}

function validatedSnapshot(playing: Session) {
  const payload = stablePayload(playing.state);
  const result = validatePayload(payload, content, registry);
  assert.ok(result.ok, result.ok ? "" : result.error);
  return result.value;
}

function initialGhosts(playing: Session, id: GhostId) {
  const current = activeGhost(playing);
  const definition = content.realtimeChallenges.find((challenge) => challenge.id === id);
  assert.ok(definition?.kind === "ghosts");
  assert.equal(current.playerTileId, definition.entry.tileId);
  assert.deepEqual(current.litLampIds, []);
  assert.deepEqual(current.removedGhostIds, []);
  for (const ghost of definition.rules.ghosts) {
    assert.equal(current.ghostPathIndices[ghost.id], 0);
    assert.equal(current.nextGhostStepAtMs[ghost.id], 500);
  }
}

test("M4 实际世界接入两个冻结幽灵棋盘，入口/恢复锚点/成功侧与正常 C 主线档闭合", () => {
  assert.deepEqual(validateContent(content), []);
  assert.equal(content.areas.find((area) => area.id === "d")?.tileIds.length, 39);
  for (const id of ids) {
    const room = content.rooms.find((room) => room.id === id);
    assert.ok(room);
    assert.equal(room.mode, "challengeRunning");
    assert.equal(room.returnTileId, room.worldEntranceTileId);
    assert.notEqual(room.successExitTileId, room.returnTileId);
    assert.equal(
      content.entities.find((entity) => entity.id === `${id}.entrance`)?.kind,
      "roomEntrance",
    );
  }
  const playing = atD();
  assert.deepEqual(permanent(playing.state), permanent(restorePayload(initialPayload, content, 0)));
  assert.equal(supplyProgress(content, playing.state).collected, 51);
  assert.equal(areaData(content, playing.state, "d").collected, 0);
});

for (const id of ids) {
  test(`I06/I07 ${id} 必须在物理入口 F 后开始；入场快照安全，倒数清输入且不移动`, () => {
    const playing = atD();
    playing.send({ kind: "StartChallenge", challengeId: id }, 140, "wrongMode");
    playing.enter(id);
    const wrongId = id === ids[0] ? ids[1] : ids[0];
    playing.send({ kind: "StartChallenge", challengeId: wrongId }, 140, "wrongMode");
    playing.start(id);
    assert.equal(playing.state.activeRealtime?.practice, false);
    const payload = validatedSnapshot(playing);
    assert.equal(payload.playerPosition.space, "world");
    assert.equal(
      payload.playerPosition.tileId,
      content.rooms.find((room) => room.id === id)?.returnTileId,
    );
    assert.deepEqual(payload.resumeHint, { kind: "restartChallenge", challengeId: id });
    assert.equal(payload.room, null);
    playing.wait(2999);
    assert.equal(playing.state.clock.activeTimeMs, 0);
    assert.equal(playing.state.clock.countdownRemainingMs, 1);
    initialGhosts(playing, id);
    const ready = playing.send({ kind: "Tick" }, 1);
    assert.equal(ready.clearInputs, true);
    assert.equal(playing.state.clock.activeTimeMs, 0);
    initialGhosts(playing, id);
    const before = permanent(playing.state);
    playing.send({ kind: "Teleport", teleportId: "hub.teleport" }, 0, "wrongMode");
    assert.deepEqual(permanent(playing.state), before);
    const far = playing.send(
      { kind: "ClickTile", tileId: `${id}.tile.${id === ids[0] ? 6 : 8}.2` },
      0,
      "blocked",
    );
    assert.ok(far.events.some((event) => event.kind === "invalid"));
    assert.equal(playing.state.playerPosition.tileId, `${id}.tile.0.2`);
    assert.deepEqual(playing.state.autoPath, []);
  });

  test(`P02/S08 ${id} 碰撞与放弃不发权限/物资，失败时钟停止，刷新或重试回安全入口`, () => {
    const playing = atD();
    playing.enter(id);
    playing.start(id);
    const before = permanent(playing.state);
    playing.play(id, "failure");
    assert.deepEqual(permanent(playing.state), before);
    assert.equal(playing.events.filter((event) => event.kind === "failure").length, 1);
    assert.equal(gateOpen(content, playing.state, `gate.${id}`), false);
    assert.equal(playing.state.clock.activeTimeMs, 280);
    playing.send({ kind: "Tick" }, 30000);
    assert.equal(playing.state.clock.activeTimeMs, 280);
    assert.equal(playing.events.filter((event) => event.kind === "failure").length, 1);
    const failed = validatedSnapshot(playing);
    assert.equal(failed.resumeHint, null);
    const refreshed = restorePayload(failed, content, 0);
    assert.equal(refreshed.mode, "explore");
    assert.equal(
      refreshed.playerPosition.tileId,
      content.rooms.find((room) => room.id === id)?.returnTileId,
    );
    assert.equal(refreshed.activeRealtime, null);
    playing.send({ kind: "RetryChallenge" });
    assert.equal(playing.state.mode, "challengeReady");
    playing.start(id);
    initialGhosts(playing, id);
    playing.wait(3000);
    playing.send({ kind: "Move", direction: "right" }, 250);
    playing.send({ kind: "ExitRoom" });
    assert.equal(playing.state.mode, "explore");
    assert.equal(playing.state.activeRealtime, null);
    assert.equal(playing.state.playerPosition.tileId, failed.playerPosition.tileId);
    assert.deepEqual(permanent(playing.state), before);
    assert.equal(validatedSnapshot(playing).resumeHint, null);
  });

  test(`G09/S09 ${id} 成功只先开安全门，终端与物资分别提交；重复练习保留权限且不重复领取`, () => {
    const playing = atD();
    playing.enter(id);
    playing.start(id);
    playing.play(id, "success");
    assert.equal(gateOpen(content, playing.state, `gate.${id}`), true);
    assert.equal(playing.state.completedObjectiveIds.includes(permissionIds[id]), false);
    assert.equal(playing.state.claimedRewardIds.includes(rewardIds[id]), false);
    assert.equal(areaData(content, playing.state, "d").collected, 0);
    const successPayload = validatedSnapshot(playing);
    assert.equal(successPayload.resumeHint, null);
    assert.ok(successPayload.completedObjectiveIds.includes(id));
    assert.equal(restorePayload(successPayload, content, 0).mode, "explore");
    const finishedAt = playing.state.clock.activeTimeMs;
    playing.send({ kind: "Tick" }, 60000);
    assert.equal(playing.state.clock.activeTimeMs, finishedAt);
    playing.send({ kind: "ExitRoom" });
    playing.move(directions[id], 3);
    assert.equal(playing.state.mode, "explore");
    assert.equal(playing.state.completedObjectiveIds.includes(permissionIds[id]), false);
    playing.send({ kind: "Interact" });
    assert.ok(playing.state.completedObjectiveIds.includes(permissionIds[id]));
    assert.equal(areaData(content, playing.state, "d").collected, 20);
    assert.equal(playing.state.claimedRewardIds.includes(rewardIds[id]), false);
    const pickup = playing.send({ kind: "Move", direction: directions[id] });
    assert.equal(pickup.events.filter((event) => event.kind === "pickup").length, 1);
    assert.equal(supplyProgress(content, playing.state).collected, 56);
    const complete = permanent(playing.state);
    playing.enter(id);
    playing.start(id);
    assert.equal(playing.state.activeRealtime?.practice, true);
    initialGhosts(playing, id);
    const eventStart = playing.events.length;
    playing.play(id, "success");
    assert.deepEqual(permanent(playing.state), complete);
    assert.equal(
      playing.events
        .slice(eventStart)
        .filter((event) => event.kind === "door" || event.kind === "pickup").length,
      0,
    );
    playing.send({ kind: "ExitRoom" });
    playing.move(directions[id], 4);
    assert.equal(supplyProgress(content, playing.state).collected, 56);
    playing.enter(id);
    playing.start(id);
    assert.equal(playing.state.activeRealtime?.practice, true);
    playing.play(id, "failure");
    assert.deepEqual(permanent(playing.state), complete);
    assert.equal(gateOpen(content, playing.state, `gate.${id}`), true);
    assert.equal(gateOpen(content, playing.state, `gate.${rewardIds[id]}`), true);
    assert.deepEqual(
      validatedSnapshot(playing).completedRoomLayouts,
      initialPayload.completedRoomLayouts,
    );
  });

  test(`P02 ${id} 灯已亮的进行中快照仍只恢复世界安全点，灯和幽灵从冻结初态重开`, () => {
    const playing = atD();
    playing.enter(id);
    playing.start(id);
    playing.wait(3000);
    playing.send({ kind: "Move", direction: "right" }, 250);
    playing.wait(160);
    playing.send({ kind: "Move", direction: "right" }, 140);
    playing.send({ kind: "Move", direction: "right" }, 140);
    assert.deepEqual(activeGhost(playing).litLampIds, [`${id}.lamp.01`]);
    assert.equal(playing.state.mode, "challengeRunning");
    assert.equal(playing.state.completedObjectiveIds.includes(id), false);
    const payload = validatedSnapshot(playing);
    assert.equal(
      payload.playerPosition.tileId,
      content.rooms.find((room) => room.id === id)?.returnTileId,
    );
    assert.equal(payload.room, null);
    assert.deepEqual(payload.resumeHint, { kind: "restartChallenge", challengeId: id });
    const restarted = new Session(restorePayload(payload, content, 0));
    assert.equal(restarted.state.mode, "explore");
    assert.equal(restarted.state.activeRealtime, null);
    restarted.send({ kind: "Interact" });
    restarted.start(id);
    initialGhosts(restarted, id);
    assert.deepEqual(permanent(restarted.state), permanent(playing.state));
  });
}

test("T11 两个幽灵世界接口在首步前1ms失焦/后台后显式恢复，3秒倒数不消耗剩余1ms", () => {
  for (const id of ids) {
    const playing = atD();
    playing.enter(id);
    playing.start(id);
    playing.wait(3000);
    playing.wait(499);
    const snapshot = structuredClone(activeGhost(playing));
    const paused = playing.send({ kind: "Pause", reason: "blur", present: true }, 0, "paused");
    assert.equal(paused.clearInputs, true);
    playing.send({ kind: "Pause", reason: "hidden", present: true }, 0, "paused");
    playing.send({ kind: "Tick" }, 30000, "paused");
    playing.send(
      { kind: "Resume", pageVisible: true, canvasOperable: true, graphicsAvailable: true },
      0,
      "paused",
    );
    playing.send({ kind: "Pause", reason: "blur", present: false }, 0, "paused");
    playing.send({ kind: "Pause", reason: "hidden", present: false }, 0, "paused");
    playing.send({ kind: "Move", direction: "right" }, 0, "paused");
    assert.deepEqual(activeGhost(playing), snapshot);
    assert.equal(playing.state.clock.activeTimeMs, 499);
    playing.send(
      { kind: "Resume", pageVisible: true, canvasOperable: true, graphicsAvailable: true },
      0,
    );
    assert.equal(playing.state.clock.countdownRemainingMs, 3000);
    playing.wait(2999);
    assert.equal(playing.state.clock.activeTimeMs, 499);
    assert.deepEqual(activeGhost(playing), snapshot);
    playing.wait(1);
    playing.send({ kind: "Move", direction: "right" }, 1);
    assert.equal(playing.state.clock.activeTimeMs, 500);
    assert.equal(activeGhost(playing).ghostPathIndices[`${id}.ghost.01`], 1);
    assert.equal(playing.state.playerPosition.tileId, `${id}.tile.1.2`);
    assert.equal(playing.state.mode, "challengeRunning");
  }
});

test("T09/T13 先渲染同刻Tick再发真实移动仍统一幽灵意图，同刻重绘不多走一次", () => {
  for (const id of ids) {
    const playing = atD();
    playing.enter(id);
    playing.start(id);
    playing.wait(3000);
    playing.send({ kind: "Move", direction: "right" }, 250);
    playing.send({ kind: "Tick" }, 250);
    const move = playing.send({ kind: "Move", direction: "right" }, 0);
    assert.equal(playing.state.playerPosition.tileId, `${id}.tile.2.2`);
    assert.equal(activeGhost(playing).ghostPathIndices[`${id}.ghost.01`], 1);
    const snapshot = structuredClone(activeGhost(playing));
    playing.send({ kind: "Tick" }, 0);
    playing.send({ kind: "Tick" }, 0);
    assert.deepEqual(activeGhost(playing), snapshot);
    assert.equal(move.events.filter((event) => event.kind === "move").length, 1);
    playing.send({ kind: "Move", direction: "right" }, 150);
    assert.ok(activeGhost(playing).litLampIds.includes(`${id}.lamp.01`));
    assert.equal(playing.events.filter((event) => event.kind === "failure").length, 0);
  }
});

test("T12 世界入口中的300ms调度间断先冻结并丢弃输入，保留幽灵灯态和永久进度", () => {
  const playing = atD();
  playing.enter(ids[1]);
  playing.start(ids[1]);
  playing.wait(3000);
  playing.wait(499);
  const before = structuredClone(activeGhost(playing));
  const progress = permanent(playing.state);
  const interrupted = playing.send({ kind: "Move", direction: "right" }, 300, "paused");
  assert.equal(interrupted.clearInputs, true);
  assert.ok(playing.state.clock.pauseReasons.includes("clockGap"));
  assert.equal(playing.state.clock.activeTimeMs, 499);
  assert.deepEqual(activeGhost(playing), before);
  assert.deepEqual(permanent(playing.state), progress);
  assert.equal(playing.events.filter((event) => event.kind === "failure").length, 0);
});

test("G09 双幽灵成功但四权限均未确认时可独立领额外物资，关闭的双段门仍不可绕过", () => {
  const playing = atD();
  playing.enter(ids[0]);
  playing.start(ids[0]);
  playing.play(ids[0], "success");
  playing.send({ kind: "ExitRoom" });
  playing.move("right", 3);
  playing.send({ kind: "Move", direction: "right" }, 140, "unmetCondition");
  playing.move("down");
  assert.equal(playing.state.playerPosition.tileId, "d.t.5.1");
  playing.send({ kind: "Move", direction: "right" }, 140, "unmetCondition");
  assert.equal(gateOpen(content, playing.state, "gate.d.ghosts.cleared"), false);
  playing.enter(ids[1]);
  playing.start(ids[1]);
  playing.play(ids[1], "success");
  playing.send({ kind: "ExitRoom" });
  assert.equal(gateOpen(content, playing.state, "gate.d.ghosts.cleared"), true);
  assert.equal(gateOpen(content, playing.state, "gate.d.main"), false);
  assert.equal(areaData(content, playing.state, "d").collected, 0);
  playing.send({ kind: "Teleport", teleportId: "d.teleport" });
  playing.move("right", 5);
  playing.move("down");
  playing.move("right");
  const pickup = playing.send({ kind: "Move", direction: "down" });
  assert.equal(pickup.events.filter((event) => event.kind === "pickup").length, 1);
  assert.ok(playing.state.claimedRewardIds.includes("d.supply.ghosts"));
  assert.equal(supplyProgress(content, playing.state).collected, 56);
  for (const id of ["01", "02", "03", "04"])
    assert.equal(playing.state.completedObjectiveIds.includes(`d.permission.${id}`), false);
  assert.equal(playing.state.claimedRewardIds.includes("d.supply.permission01"), false);
  assert.equal(playing.state.claimedRewardIds.includes("d.supply.permission02"), false);
  validatedSnapshot(playing);
});

test("S08/S09 已正常取得权限04及物资后，其他幽灵段失败和放弃均不移除永久权限", () => {
  const playing = atD();
  playing.move("down");
  playing.send({ kind: "Amplify" });
  playing.move("down", 3);
  playing.move("right", 2);
  playing.send({ kind: "Interact" });
  playing.move("right");
  const before = permanent(playing.state);
  assert.ok(before.completedObjectiveIds.includes("d.permission.04"));
  assert.ok(before.claimedRewardIds.includes("d.supply.permission04"));
  for (const id of ids) {
    playing.enter(id);
    playing.start(id);
    playing.play(id, "failure");
    assert.deepEqual(permanent(playing.state), before);
    playing.send({ kind: "ExitRoom" });
    playing.enter(id);
    playing.start(id);
    playing.wait(3000);
    playing.send({ kind: "ExitRoom" });
    assert.deepEqual(permanent(playing.state), before);
    assert.equal(areaData(content, playing.state, "d").collected, 20);
    validatedSnapshot(playing);
  }
});
