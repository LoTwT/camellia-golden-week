import assert from "node:assert/strict";
import test from "node:test";
import { assembleContent } from "../src/content/assemble.ts";
import { createGame, dispatch, worldPosition } from "../src/core/engine.ts";
import { projectBoard } from "../src/core/projection.ts";
import type { Direction, GameCommand, GameState, RuleResult } from "../src/core/types.ts";
import {
  payloadSummary,
  restorePayload,
  stablePayload,
  validatePayload,
} from "../src/platform/save-payload.ts";
import type { SavePayload } from "../src/platform/save-payload.ts";
import { createSaveStore, SAVE_KEYS } from "../src/platform/save-store.ts";
import type { SaveStorage } from "../src/platform/save-store.ts";

const content = assembleContent("M1");
const savedAt = "2026-09-11T10:00:00.000Z";

class PlaySession {
  state: GameState;
  now: number;

  constructor(state = createGame(content), now = 0) {
    this.state = state;
    this.now = now;
  }

  wait(milliseconds: number): void {
    const end = this.now + milliseconds;
    while (this.now < end) {
      this.now = Math.min(end, this.now + 100);
      this.state = dispatch(content, this.state, { kind: "Tick" }, this.now, savedAt).state;
      assert.equal(this.state.clock.awaitingResume, false, "正常时间源不应触发卡顿暂停");
    }
  }

  send(command: GameCommand, delay = 140): RuleResult {
    this.wait(delay);
    const result = dispatch(content, this.state, command, this.now, savedAt);
    this.state = result.state;
    return result;
  }

  move(...directions: Direction[]): void {
    for (const direction of directions) {
      const result = this.send({ kind: "Move", direction });
      assert.ok(
        ["accepted", "success"].includes(result.code),
        `${direction}: ${result.code} ${result.state.lastResult.message}`,
      );
    }
  }

  enterA(): void {
    this.move("right", "right", "right");
    assert.equal(this.send({ kind: "Amplify" }).code, "accepted");
    this.move("right", "right", "right");
    assert.equal(this.send({ kind: "Interact" }).code, "accepted");
    assert.equal(this.state.playerPosition.tileId, "a.t.0.0");
  }

  enterMaze(): void {
    this.enterA();
    this.move("right");
    assert.equal(this.send({ kind: "Amplify" }).code, "accepted");
    this.move("right", "right", "right");
    assert.equal(this.state.activeStatic?.roomId, "a.maze.01");
    assert.equal(this.state.phase, "preview");
  }

  completeMaze(): void {
    this.wait(4000);
    this.move("up", "up", "up", "up", "right", "right", "right", "right");
    assert.equal(this.state.mode, "explore");
    assert.equal(this.state.playerPosition.tileId, "a.t.5.0");
  }

  startFirewall(): void {
    this.enterA();
    this.move("up", "up", "up");
    assert.equal(this.send({ kind: "Interact" }).code, "accepted");
    assert.equal(
      this.send({ kind: "StartChallenge", challengeId: "a.firewall.tutorial" }).code,
      "accepted",
    );
    assert.equal(this.state.mode, "challengeRunning");
  }
}

function requireValid(payload: SavePayload): SavePayload {
  const result = validatePayload(payload, content);
  assert.ok(result.ok, result.ok ? "" : result.error);
  return result.value;
}

function expectInvalid(payload: SavePayload, mutate: (fault: SavePayload) => void): void {
  const fault = structuredClone(payload);
  mutate(fault);
  const result = validatePayload(fault, content);
  assert.equal(result.ok, false, `非法载荷被接受：${JSON.stringify(fault)}`);
  assert.ok(!result.ok && result.kind === "invalid");
}

test("P01 真实新档与正常中心教学到 A 区的载荷逐步合法，导出没有会话或渲染状态", () => {
  const session = new PlaySession();
  requireValid(stablePayload(session.state));
  session.enterA();
  const payload = requireValid(stablePayload(session.state));
  assert.deepEqual(payload.completedObjectiveIds, ["hub.amplifier", "hub.tutorial"]);
  assert.deepEqual(payload.claimedRewardIds, ["hub.supply.tutorial"]);
  assert.deepEqual(payload.capabilities, ["amplifier", "unlimitedAmplifier"]);
  assert.deepEqual(payload.activatedTeleportIds, ["hub.teleport", "a.teleport"]);
  for (const field of [
    "mode",
    "phase",
    "clock",
    "activeRealtime",
    "activeStatic",
    "autoPath",
    "feedbackSequence",
    "lastResult",
  ])
    assert.equal(Object.hasOwn(payload, field), false, field);
  assert.equal(payload.room, null);
  assert.match(payloadSummary(payload, content), /1 单位物资/);
});

test("P01 普通位置、已发现和已访问集合恢复一致，读回时钟和输入从空白开始", () => {
  const session = new PlaySession();
  session.enterA();
  session.move("up", "up");
  const payload = requireValid(stablePayload(session.state));
  const restored = restorePayload(payload, content, 50000);
  assert.deepEqual(restored.playerPosition, session.state.playerPosition);
  assert.deepEqual(restored.discoveredTileIds, session.state.discoveredTileIds);
  assert.deepEqual(restored.visitedTileIds, session.state.visitedTileIds);
  assert.equal(restored.clock.activeTimeMs, 0);
  assert.equal(restored.clock.lastMonotonicTimeMs, 50000);
  assert.deepEqual(restored.autoPath, []);
  assert.equal(restored.mode, "explore");
});

test("P06 未知或重复目标、奖励、格子、富集节点、显露组和传送点逐项被拒", () => {
  const session = new PlaySession();
  session.enterA();
  const payload = stablePayload(session.state);
  for (const field of [
    "completedObjectiveIds",
    "claimedRewardIds",
    "discoveredTileIds",
    "visitedTileIds",
    "clearedEtherNodeIds",
    "revealedGroupIds",
    "activatedTeleportIds",
  ] as const) {
    expectInvalid(payload, (fault) => {
      fault[field].push("unknown.id");
    });
  }
  for (const field of [
    "completedObjectiveIds",
    "claimedRewardIds",
    "discoveredTileIds",
    "visitedTileIds",
    "clearedEtherNodeIds",
    "activatedTeleportIds",
  ] as const) {
    expectInvalid(payload, (fault) => {
      const first = fault[field][0];
      assert.ok(first);
      fault[field].push(first);
    });
  }
  expectInvalid(payload, (fault) => {
    fault.completedObjectiveIds.push("b.main");
  });
  expectInvalid(payload, (fault) => {
    fault.claimedRewardIds.push("b.supply.line01");
  });
});

test("P06 目标漏前置、能力或自动奖励与教学事务不一致时拒绝", () => {
  const session = new PlaySession();
  session.enterA();
  const payload = stablePayload(session.state);
  expectInvalid(payload, (fault) => {
    fault.completedObjectiveIds.push("a.main");
  });
  expectInvalid(payload, (fault) => {
    fault.completedObjectiveIds = fault.completedObjectiveIds.filter(
      (id) => id !== "hub.amplifier",
    );
  });
  expectInvalid(payload, (fault) => {
    fault.capabilities = ["amplifier"];
  });
  expectInvalid(payload, (fault) => {
    fault.capabilities = [];
  });
  expectInvalid(payload, (fault) => {
    fault.claimedRewardIds = [];
  });
  const fresh = stablePayload(createGame(content));
  expectInvalid(fresh, (fault) => {
    fault.capabilities = ["unlimitedAmplifier"];
  });
  expectInvalid(fresh, (fault) => {
    fault.claimedRewardIds = ["hub.supply.tutorial"];
  });
});

test("P06 当前世界位置不能是未访问格、以太覆盖格、未开放门或未知棋盘", () => {
  const session = new PlaySession();
  session.enterA();
  const payload = stablePayload(session.state);
  expectInvalid(payload, (fault) => {
    fault.playerPosition.tileId = "a.t.8.0";
  });
  expectInvalid(payload, (fault) => {
    fault.playerPosition = worldPosition("a", "a.t.2.0");
    if (!fault.discoveredTileIds.includes("a.t.2.0")) fault.discoveredTileIds.push("a.t.2.0");
    fault.visitedTileIds.push("a.t.2.0");
  });
  expectInvalid(payload, (fault) => {
    fault.playerPosition = worldPosition("a", "a.t.-2.-3");
    fault.discoveredTileIds.push("a.t.-2.-3");
    fault.visitedTileIds.push("a.t.-2.-3");
  });
  expectInvalid(payload, (fault) => {
    fault.playerPosition.boardId = "other.board";
  });
  expectInvalid(payload, (fault) => {
    fault.playerPosition.space = "room";
  });
  expectInvalid(payload, (fault) => {
    fault.activatedTeleportIds = ["hub.teleport"];
  });
});

test("P06 富集节点完成与清除记录必须是同一完整事务", () => {
  const session = new PlaySession();
  session.enterA();
  const payload = stablePayload(session.state);
  expectInvalid(payload, (fault) => {
    fault.clearedEtherNodeIds = [];
  });
  expectInvalid(stablePayload(createGame(content)), (fault) => {
    fault.clearedEtherNodeIds = ["hub.nexus"];
  });
});

test("P01 / S02 迷宫预览刷新后重新观察完整 4 秒；危险格仅在预览显示", () => {
  const session = new PlaySession();
  session.enterMaze();
  session.wait(2000);
  const payload = requireValid(stablePayload(session.state));
  assert.equal(payload.room?.status, "preview");
  assert.ok(
    projectBoard(content, session.state).tiles.some((tile) => tile.icon === "hazard-active"),
  );
  const resumed = new PlaySession(restorePayload(payload, content, 20000), 20000);
  assert.equal(resumed.state.playerPosition.tileId, "a.maze.01.t.0.4");
  resumed.wait(3999);
  assert.equal(resumed.state.activeStatic?.state.phase, "preview");
  resumed.wait(1);
  assert.equal(resumed.state.activeStatic?.state.phase, "active");
  assert.equal(
    projectBoard(content, resumed.state).tiles.some((tile) => tile.icon === "hazard-active"),
    false,
  );
});

test("P01 / S02 迷宫活动态刷新保留玩家与布局，撤销历史丢弃，重置仍回完整出生基线", () => {
  const session = new PlaySession();
  session.enterMaze();
  session.wait(4000);
  session.move("up", "up");
  assert.equal(session.state.activeStatic?.state.undoStack.length, 2);
  const payload = requireValid(stablePayload(session.state));
  const resumed = new PlaySession(restorePayload(payload, content, 30000), 30000);
  assert.equal(resumed.state.playerPosition.tileId, "a.maze.01.t.0.2");
  assert.deepEqual(
    resumed.state.activeStatic?.state.currentLayout,
    session.state.activeStatic?.state.currentLayout,
  );
  assert.deepEqual(resumed.state.activeStatic?.state.undoStack, []);
  assert.equal(
    projectBoard(content, resumed.state).tiles.some((tile) => tile.icon === "hazard-active"),
    false,
  );
  assert.equal(resumed.send({ kind: "Undo" }).code, "noHistory");
  assert.equal(resumed.send({ kind: "ResetRoom" }).code, "reset");
  assert.equal(resumed.state.playerPosition.tileId, "a.maze.01.t.0.4");
  assert.equal(resumed.state.activeStatic?.state.phase, "preview");
  assert.deepEqual(resumed.state.claimedRewardIds, payload.claimedRewardIds);
});

test("P01 / S01 真正踩危险格后保存合法恢复预览，临时结果与错误步不泄露", () => {
  const session = new PlaySession();
  session.enterMaze();
  session.wait(4000);
  session.move("up");
  const failed = session.send({ kind: "Move", direction: "right" });
  assert.equal(failed.code, "failed");
  assert.equal(session.state.playerPosition.tileId, "a.maze.01.t.0.4");
  const payload = requireValid(stablePayload(session.state));
  assert.equal(payload.room?.status, "preview");
  assert.deepEqual(payload.room?.pendingEffects, { objectiveIds: [], rewardIds: [] });
  assert.equal(payload.completedObjectiveIds.includes("a.maze.01"), false);
  assert.equal(payload.claimedRewardIds.includes("a.supply.maze01"), false);
});

test("P06 静态存档拒绝危险或墙占格、重复对象、坏基线、错误锚点和待发结果注入", () => {
  const session = new PlaySession();
  session.enterMaze();
  session.wait(4000);
  session.move("up");
  const payload = stablePayload(session.state);
  expectInvalid(payload, (fault) => {
    fault.playerPosition.tileId = "a.maze.01.t.1.3";
  });
  expectInvalid(payload, (fault) => {
    fault.playerPosition.tileId = "a.maze.01.t.2.2";
  });
  expectInvalid(payload, (fault) => {
    assert.ok(fault.room && fault.room.status !== "completedVisit");
    fault.room.currentLayout = {
      ...fault.room.currentLayout,
      objectTileById: { "unknown.object": fault.playerPosition.tileId },
    };
  });
  expectInvalid(payload, (fault) => {
    assert.ok(fault.room && fault.room.status !== "completedVisit");
    fault.room.attemptBaseline = { ...fault.room.attemptBaseline, playerTileId: "a.maze.01.t.1.3" };
  });
  expectInvalid(payload, (fault) => {
    assert.ok(fault.room && fault.room.status !== "completedVisit");
    fault.room.returnAnchor = worldPosition("a", "a.t.0.0");
  });
  expectInvalid(payload, (fault) => {
    assert.ok(fault.room && fault.room.status !== "completedVisit");
    fault.room.pendingEffects.objectiveIds.push("a.main");
  });
  expectInvalid(payload, (fault) => {
    assert.ok(fault.room && fault.room.status !== "completedVisit");
    fault.room.pendingEffects.objectiveIds.push("a.main");
    fault.room.currentLayout = {
      ...fault.room.currentLayout,
      pendingObjectiveIds: [...fault.room.currentLayout.pendingObjectiveIds, "a.main"],
    };
  });
});

test("P06 未完成房间不能仅篡改 practice 标记冒充独立练习", () => {
  const session = new PlaySession();
  session.enterMaze();
  expectInvalid(stablePayload(session.state), (fault) => {
    assert.ok(fault.room && fault.room.status !== "completedVisit");
    fault.room.practice = true;
  });
});

test("P01 / S09 已完成迷宫重新进入的练习载荷可恢复，不能伪装成首次尝试", () => {
  const session = new PlaySession();
  session.enterMaze();
  session.completeMaze();
  session.move("left");
  assert.equal(session.send({ kind: "Interact" }).code, "accepted");
  assert.equal(session.state.activeStatic?.practice, true);
  const payload = requireValid(stablePayload(session.state));
  const restored = restorePayload(payload, content, 45000);
  assert.equal(restored.activeStatic?.practice, true);
  assert.deepEqual(restored.completedObjectiveIds, session.state.completedObjectiveIds);
  assert.deepEqual(restored.claimedRewardIds, session.state.claimedRewardIds);
  expectInvalid(payload, (fault) => {
    assert.ok(fault.room && fault.room.status !== "completedVisit");
    fault.room.practice = false;
  });
});

test("P01 / S09 正常完成迷宫、拾取物资与 M1 终端后的稳定记录可恢复", () => {
  const session = new PlaySession();
  session.enterMaze();
  session.completeMaze();
  session.move("right", "right");
  assert.equal(session.send({ kind: "Interact" }).code, "accepted");
  const payload = requireValid(stablePayload(session.state));
  assert.equal(payload.room, null);
  assert.equal(payload.completedObjectiveIds.includes("a.main"), true);
  assert.equal(payload.claimedRewardIds.includes("a.supply.maze01"), true);
  assert.deepEqual(payload.scopeCompletionHistory, ["M1"]);
  assert.equal(payload.campaignCompletedAt, null);
  const restored = restorePayload(payload, content, 50000);
  assert.deepEqual(stablePayload(restored), payload);
});

test("P01 / S09 完成布局访问态保存唯一玩家位置，恢复后危险失效且永久布局保持", () => {
  const session = new PlaySession();
  session.enterMaze();
  session.completeMaze();
  session.move("left");
  assert.equal(session.state.mode, "completedRoom");
  session.move("right");
  const payload = requireValid(stablePayload(session.state));
  assert.equal(payload.schemaVersion, 2);
  assert.equal(payload.room?.status, "completedVisit");
  assert.deepEqual(Object.keys(payload.room ?? {}).sort(), ["returnAnchor", "roomId", "status"]);
  assert.deepEqual(payload.completedRoomLayouts["a.maze.01"], {
    objectTileById: {},
    visitedTileIds: [],
    activatedLocalIds: [],
  });
  const restored = new PlaySession(restorePayload(payload, content, 65000), 65000);
  assert.equal(restored.state.mode, "completedRoom");
  assert.equal(restored.state.activeStatic, null);
  assert.deepEqual(restored.state.playerPosition, payload.playerPosition);
  restored.move("up");
  assert.equal(restored.state.mode, "completedRoom");
  assert.equal(restored.state.playerPosition.tileId, "a.maze.01.t.1.3");
  assert.deepEqual(restored.state.completedRoomLayouts, payload.completedRoomLayouts);
  assert.deepEqual(restored.state.claimedRewardIds, payload.claimedRewardIds);
  assert.notEqual(restored.state.completedRoomLayouts, payload.completedRoomLayouts);
  assert.equal(restored.send({ kind: "ExitRoom" }).code, "accepted");
  assert.deepEqual(restored.state.playerPosition, payload.room?.returnAnchor);
});

test("P06 schema2 必须完整保存已完成静态布局，拒绝漏记、假布局、未知房间及非法访问占格", () => {
  const session = new PlaySession();
  session.enterMaze();
  session.completeMaze();
  const payload = requireValid(stablePayload(session.state));
  expectInvalid(payload, (fault) => {
    delete fault.completedRoomLayouts["a.maze.01"];
  });
  expectInvalid(payload, (fault) => {
    fault.completedRoomLayouts["unknown.room"] = {
      objectTileById: {},
      visitedTileIds: [],
      activatedLocalIds: [],
    };
  });
  expectInvalid(payload, (fault) => {
    fault.completedRoomLayouts["a.maze.02"] = {
      objectTileById: {},
      visitedTileIds: [],
      activatedLocalIds: [],
    };
  });
  expectInvalid(payload, (fault) => {
    fault.completedRoomLayouts["a.maze.01"] = {
      objectTileById: { "unknown.object": "a.maze.01.t.0.0" },
      visitedTileIds: [],
      activatedLocalIds: [],
    };
  });
  session.move("left");
  const visit = requireValid(stablePayload(session.state));
  expectInvalid(visit, (fault) => {
    fault.playerPosition.tileId = "a.maze.01.t.2.2";
  });
  const extraFields = structuredClone(visit) as unknown as { room: Record<string, unknown> };
  extraFields.room.practice = false;
  assert.equal(validatePayload(extraFields, content).ok, false);
});

test("P02 实时准备及运行中只保存外层安全入口，分数与倒数不会进入载荷", () => {
  const session = new PlaySession();
  session.startFirewall();
  for (const phase of ["preparation", "running"]) {
    if (phase === "running") {
      session.wait(3000);
      session.send({ kind: "Move", direction: "right" }, 250);
      assert.equal(session.state.activeRealtime?.state.kind, "firewall");
    }
    const payload = requireValid(stablePayload(session.state));
    assert.deepEqual(payload.playerPosition, worldPosition("a", "a.t.0.-3"));
    assert.equal(payload.room, null);
    assert.deepEqual(payload.resumeHint, {
      kind: "restartChallenge",
      challengeId: "a.firewall.tutorial",
    });
    assert.deepEqual(payload.bestResults, []);
    const restored = restorePayload(payload, content, 70000);
    assert.equal(restored.mode, "explore");
    assert.equal(restored.activeRealtime, null);
    assert.equal(restored.clock.activeTimeMs, 0);
    assert.deepEqual(restored.playerPosition, payload.playerPosition);
    assert.match(restored.lastResult.message, /上次挑战未结算/);
  }
});

test("P02 防火墙真实达标后立即保存结果，恢复不强制重打或重复发奖励", () => {
  const session = new PlaySession();
  session.startFirewall();
  session.wait(3000);
  for (let index = 0; index < 12; index += 1)
    session.send(
      { kind: "Move", direction: index % 2 === 0 ? "right" : "left" },
      index === 0 ? 250 : 500,
    );
  session.wait(15000 - session.state.clock.activeTimeMs);
  assert.equal(session.state.mode, "challengeResult");
  assert.equal(session.state.phase, "success");
  const payload = requireValid(stablePayload(session.state));
  assert.equal(payload.resumeHint, null);
  assert.equal(payload.completedObjectiveIds.includes("a.firewall.tutorial"), true);
  assert.equal(
    payload.bestResults.find((record) => record.challengeId === "a.firewall.tutorial")?.bestCombo,
    12,
  );
  const restored = restorePayload(payload, content, 90000);
  assert.deepEqual(stablePayload(restored), payload);
  assert.deepEqual(restored.claimedRewardIds, ["hub.supply.tutorial"]);
  expectInvalid(payload, (fault) => {
    fault.bestResults.push({ challengeId: "unknown.challenge", ruleVersion: 1, bestCombo: 12 });
  });
  expectInvalid(payload, (fault) => {
    const record = fault.bestResults[0];
    assert.ok(record);
    record.bestCombo = 31;
  });
  expectInvalid(payload, (fault) => {
    const record = fault.bestResults[0];
    assert.ok(record);
    fault.bestResults.push({ ...record });
  });
});

test("P06 实时安全恢复提示不能改为其他房间、其他入口或混入静态活动存档", () => {
  const session = new PlaySession();
  session.startFirewall();
  const payload = stablePayload(session.state);
  expectInvalid(payload, (fault) => {
    fault.resumeHint = { kind: "restartChallenge", challengeId: "a.maze.01" };
  });
  expectInvalid(payload, (fault) => {
    fault.playerPosition = worldPosition("a", "a.t.0.0");
  });
  const maze = new PlaySession();
  maze.enterMaze();
  expectInvalid(stablePayload(maze.state), (fault) => {
    fault.resumeHint = { kind: "restartChallenge", challengeId: "a.firewall.tutorial" };
  });
});

test("P05 高版本 schema / content / rule 和较新 profile 受保护，未登记迁移不猜测修复", () => {
  const payload = stablePayload(createGame(content));
  for (const field of ["schemaVersion", "contentVersion", "ruleVersion"] as const) {
    const future = { ...payload, [field]: 99 };
    const result = validatePayload(future, content);
    assert.ok(!result.ok && result.kind === "future");
  }
  const futureProfile = validatePayload(
    { ...payload, releaseProfileId: "M2", contentVersion: 2 },
    content,
  );
  assert.ok(!futureProfile.ok && futureProfile.kind === "future");
  expectInvalid(payload, (fault) => {
    fault.schemaVersion = 0;
  });
  expectInvalid(payload, (fault) => {
    fault.scopeCompletionHistory = ["M1"];
  });
  expectInvalid(payload, (fault) => {
    fault.campaignCompletedAt = savedAt;
  });
});

test("P06 设置有限值按合同约束范围，NaN、未知字段和非 JSON 数据被拒", () => {
  const payload = stablePayload(createGame(content));
  const adjusted = structuredClone(payload);
  adjusted.settings.masterVolume = 10;
  adjusted.settings.zoom = -10;
  const validated = requireValid(adjusted);
  assert.equal(validated.settings.masterVolume, 1);
  assert.equal(validated.settings.zoom, 0.75);
  assert.equal(adjusted.settings.masterVolume, 10, "校验不能修改调用方原载荷");
  expectInvalid(payload, (fault) => {
    fault.settings.masterVolume = NaN;
  });
  for (const malformed of [
    null,
    [],
    "window.alert(1)",
    { ...payload, injectedScript: "globalThis.win = true" },
    { ...payload, stateRevision: Infinity },
  ])
    assert.equal(validatePayload(malformed, content).ok, false);
});

test("稳定载荷与源世界互不别名，恢复的活动房间与输入载荷也互不别名", () => {
  const session = new PlaySession();
  session.enterMaze();
  session.wait(4000);
  session.move("up");
  const payload = requireValid(stablePayload(session.state));
  const before = structuredClone(payload);
  payload.settings.muted = true;
  assert.equal(session.state.settings.muted, false);
  const restored = restorePayload(before, content, 120000);
  assert.ok(restored.activeStatic && before.room && before.room.status !== "completedVisit");
  assert.notEqual(restored.activeStatic.returnAnchor, before.room.returnAnchor);
  assert.notEqual(restored.activeStatic.state.currentLayout, before.room.currentLayout);
  assert.notEqual(restored.activeStatic.state.attemptBaseline, before.room.attemptBaseline);
});

test("P06 真实进度的非法导入或合法导入写入失败不改变原世界及旧有效槽", () => {
  const session = new PlaySession();
  session.enterA();
  const oldWorld = structuredClone(session.state);
  const oldPayload = stablePayload(session.state);
  const originalRaw = JSON.stringify({ saveGeneration: 9, savedAt, payload: oldPayload });
  const values = new Map<string, string>([[SAVE_KEYS.a, originalRaw]]);
  const storage: SaveStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
  };
  const store = createSaveStore(
    storage,
    (payload) => validatePayload(payload, content),
    () => true,
  );
  const corrupted = structuredClone(oldPayload);
  corrupted.playerPosition.tileId = "unknown.tile";
  const badImport = store.prepareImport(
    JSON.stringify({ saveGeneration: 1, savedAt, payload: corrupted }),
  );
  assert.equal(badImport.ok, false);
  assert.deepEqual(session.state, oldWorld);
  const prepared = store.prepareImport(
    JSON.stringify({ saveGeneration: 1, savedAt, payload: stablePayload(createGame(content)) }),
  );
  assert.ok(prepared.ok);
  const outcome = store.write(prepared.payload, {
    expected: store.inspect(),
    intent: "import",
    confirmedReplacement: true,
    savedAt,
    migrationRequired: prepared.migrationRequired,
  });
  assert.equal(outcome.ok, false);
  assert.deepEqual(session.state, oldWorld);
  assert.equal(values.get(SAVE_KEYS.a), originalRaw);
});
