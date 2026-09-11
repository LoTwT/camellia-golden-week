// V1 timing boundaries remain covered for historical release compatibility. V2 has its own suite.
import assert from "node:assert/strict";
import test from "node:test";
import content from "../src/content/history/realtime-v1.json" with { type: "json" };
import {
  advanceRealtime,
  antivirusTargetValue,
  createRealtime,
  firewallDangerTileIds,
  ghostTileIds,
  replayRealtimeWitness,
  validateRealtimeDefinition,
} from "../src/core/realtime.ts";
import type {
  AntivirusDefinition,
  AntivirusSpawn,
  AntivirusState,
  FirewallDefinition,
  FirewallState,
  GhostsDefinition,
  RealtimeAdvance,
  RealtimeDefinition,
  RealtimeFeedback,
  RealtimeInput,
  RealtimeState,
  RealtimeWitness,
} from "../src/core/realtime.ts";

const definitions = content.definitions as readonly RealtimeDefinition[];
const witnesses = content.witnesses as readonly RealtimeWitness[];

function firewall(difficulty = "tutorial"): FirewallDefinition {
  const definition = definitions.find((candidate) => candidate.id === `a.firewall.${difficulty}`);
  assert.ok(definition?.kind === "firewall");
  return definition;
}

function antivirus(): AntivirusDefinition {
  const definition = definitions.find((candidate) => candidate.id === "b.antivirus.light");
  assert.ok(definition?.kind === "antivirus");
  return definition;
}

function ghosts(segment = "01"): GhostsDefinition {
  const definition = definitions.find((candidate) => candidate.id === `d.ghost.${segment}`);
  assert.ok(definition?.kind === "ghosts");
  return definition;
}

function tile(definition: RealtimeDefinition, x: number, y: number): string {
  const selected = definition.tiles.find((candidate) => candidate.x === x && candidate.y === y);
  assert.ok(selected);
  return selected.id;
}

function move(
  activeTimeMs: number,
  sequence = 1,
  direction: "up" | "right" | "down" | "left" = "right",
): RealtimeInput {
  return { kind: "move", activeTimeMs, sequence, direction };
}

function click(
  definition: RealtimeDefinition,
  x: number,
  y: number,
  activeTimeMs: number,
  sequence = 1,
): Extract<RealtimeInput, { kind: "click" }> {
  return { kind: "click", tileId: tile(definition, x, y), activeTimeMs, sequence };
}

function firewallResult(result: RealtimeAdvance): FirewallState {
  assert.ok(result.state.kind === "firewall");
  return result.state;
}

function antivirusResult(result: RealtimeAdvance): AntivirusState {
  assert.ok(result.state.kind === "antivirus");
  return result.state;
}

function scriptedAntivirus(
  spawns: readonly AntivirusSpawn[],
  durationMs = 45000,
): AntivirusDefinition {
  const definition = antivirus();
  return { ...definition, rules: { ...definition.rules, spawns, durationMs, targetScore: 1 } };
}

test("冻结的 9 个实时定义均通过结构、谱面、生命周期和幽灵同步路线校验", () => {
  assert.equal(definitions.length, 9);
  for (const definition of definitions)
    assert.deepEqual(validateRealtimeDefinition(definition), [], definition.id);
});

test("全部 18 条成功 / 失败见证通过权威规则重放，终态与逐项预期一致", () => {
  assert.equal(witnesses.length, 18);
  for (const witness of witnesses) {
    const definition = definitions.find((candidate) => candidate.id === witness.challengeId);
    assert.ok(definition);
    const result = replayRealtimeWitness(definition, witness);
    assert.equal(result.result, witness.expectedResult, witness.id);
    for (const [field, expected] of Object.entries(witness.expectedFinalState)) {
      assert.deepEqual(
        (result.state as unknown as Record<string, unknown>)[field],
        expected,
        `${witness.id}.${field}`,
      );
    }
    assert.equal(new Set(result.feedback.map((event) => event.id)).size, result.feedback.length);
  }
});

test("T01 防火墙窗口的 100 / 400ms 命中，99 / 401ms 错拍", () => {
  const definition = firewall();
  for (const [timeMs, combo] of [
    [100, 1],
    [400, 1],
    [99, 0],
    [401, 0],
  ]) {
    assert.ok(timeMs !== undefined && combo !== undefined);
    const result = firewallResult(
      advanceRealtime(definition, createRealtime(definition), timeMs, move(timeMs)),
    );
    assert.equal(result.combo, combo, String(timeMs));
  }
});

test("T02 同拍多个输入只加一；当前格、越界、按键重复都不计分", () => {
  const definition = firewall();
  let result = advanceRealtime(definition, createRealtime(definition), 250, [
    move(250, 1),
    move(250, 2, "left"),
    move(250, 3),
  ]);
  assert.equal(firewallResult(result).combo, 1);
  assert.equal(result.feedback.filter((event) => event.kind === "hit").length, 1);
  const same = {
    kind: "click",
    tileId: result.state.playerTileId,
    activeTimeMs: 750,
    sequence: 4,
  } as const;
  result = advanceRealtime(definition, result.state, 750, same);
  assert.equal(firewallResult(result).combo, 1);
  result = advanceRealtime(definition, result.state, 1250, {
    kind: "move",
    direction: "left",
    repeat: true,
    activeTimeMs: 1250,
    sequence: 5,
  });
  assert.equal(firewallResult(result).combo, 1);
  result = advanceRealtime(definition, result.state, 1750, {
    kind: "click",
    tileId: "missing",
    activeTimeMs: 1750,
    sequence: 6,
  });
  assert.equal(firewallResult(result).combo, 1);
});

test("T02 错拍普通格减 5 且最低 0；危险格归零；最高 Combo 保留", () => {
  const definition = firewall("core");
  let state = createRealtime(definition);
  for (let index = 0; index < 8; index += 1) {
    state = firewallResult(
      advanceRealtime(
        definition,
        state,
        250 + index * 500,
        move(250 + index * 500, index + 1, index % 2 === 0 ? "right" : "left"),
      ),
    );
  }
  const safe = definition.tiles.find(
    (candidate) =>
      candidate.id !== state.playerTileId &&
      !firewallDangerTileIds(definition, 3901).includes(candidate.id),
  );
  assert.ok(safe);
  state = firewallResult(
    advanceRealtime(definition, state, 3901, {
      kind: "click",
      tileId: safe.id,
      sequence: 9,
      activeTimeMs: 3901,
    }),
  );
  assert.equal(state.combo, 3);
  const danger = firewallDangerTileIds(definition, 3999).find((id) => id !== state.playerTileId);
  assert.ok(danger);
  state = firewallResult(
    advanceRealtime(definition, state, 3999, {
      kind: "click",
      tileId: danger,
      sequence: 10,
      activeTimeMs: 3999,
    }),
  );
  assert.equal(state.combo, 0);
  assert.equal(state.bestCombo, 8);
  const safeAgain = definition.tiles.find(
    (candidate) =>
      candidate.id !== state.playerTileId &&
      !firewallDangerTileIds(definition, 4001).includes(candidate.id),
  );
  assert.ok(safeAgain);
  state = firewallResult(
    advanceRealtime(definition, state, 4001, {
      kind: "click",
      tileId: safeAgain.id,
      sequence: 11,
      activeTimeMs: 4001,
    }),
  );
  assert.equal(state.combo, 0);
});

test("T03 有效拍可跨危险格，危险图案在站立脚下替换不扣分，重试一致", () => {
  const definition = firewall("core");
  const dangerId = firewallDangerTileIds(definition, 250).find(
    (id) => id !== definition.entry.tileId,
  );
  assert.ok(dangerId);
  const hit = advanceRealtime(definition, createRealtime(definition), 250, {
    kind: "click",
    tileId: dangerId,
    activeTimeMs: 250,
    sequence: 1,
  });
  assert.equal(firewallResult(hit).combo, 1);
  const waited = advanceRealtime(definition, hit.state, 14999);
  assert.equal(firewallResult(waited).combo, 1);
  assert.equal(waited.feedback.filter((event) => event.kind === "miss").length, 0);
  assert.deepEqual(createRealtime(definition), createRealtime(definition));
  assert.deepEqual(firewallDangerTileIds(definition, 750), definition.rules.beatMasks[1]);
});

test("T04 四档阈值 12 / 40 / 55 / 70，最大命中数 30 / 90，结束事件仅一次", () => {
  for (const difficulty of ["tutorial", "inner", "deep", "core"]) {
    const definition = firewall(difficulty);
    const commands = definition.rules.beatMasks.map((_, index) =>
      move(250 + index * 500, index + 1, index % 2 === 0 ? "right" : "left"),
    );
    const result = advanceRealtime(
      definition,
      createRealtime(definition),
      definition.rules.durationMs,
      commands,
    );
    assert.equal(result.result, "success");
    assert.equal(firewallResult(result).bestCombo, difficulty === "tutorial" ? 30 : 90);
    assert.equal(result.feedback.filter((event) => event.kind === "success").length, 1);
    const again = advanceRealtime(
      definition,
      result.state,
      definition.rules.durationMs + 1000,
      move(definition.rules.durationMs + 1000, 1000),
    );
    assert.equal(again.state, result.state);
    assert.equal(again.feedback.length, 0);
    const empty = advanceRealtime(
      definition,
      createRealtime(definition),
      definition.rules.durationMs,
    );
    assert.equal(empty.result, "failure");
  }
});

test("T05 出现时与过期前 1ms 可清除，过期时优先移除，脚下出现不自动清除", () => {
  const base = antivirus();
  const spawn: AntivirusSpawn = {
    id: "test.target",
    tileId: base.entry.tileId,
    kind: "blue",
    spawnAtMs: 500,
    expiresAtMs: 2300,
  };
  const definition = scriptedAntivirus([spawn]);
  for (const [timeMs, score] of [
    [500, 1],
    [2299, 1],
    [2300, 0],
  ]) {
    assert.ok(timeMs !== undefined && score !== undefined);
    const result = advanceRealtime(definition, createRealtime(definition), timeMs, {
      kind: "interact",
      activeTimeMs: timeMs,
      sequence: 1,
    });
    assert.equal(antivirusResult(result).score, score, String(timeMs));
  }
  const spawned = advanceRealtime(definition, createRealtime(definition), 500);
  assert.equal(antivirusResult(spawned).score, 0);
  assert.deepEqual(antivirusResult(spawned).activeTargetIds, [spawn.id]);
});

test("T05 同刻顺序为过期→出现→输入，同一格的新实例可被清除", () => {
  const base = antivirus();
  const definition = scriptedAntivirus([
    { id: "test.old", tileId: base.entry.tileId, kind: "blue", spawnAtMs: 500, expiresAtMs: 2300 },
    {
      id: "test.new",
      tileId: base.entry.tileId,
      kind: "purple",
      spawnAtMs: 2300,
      expiresAtMs: 3300,
    },
  ]);
  const result = advanceRealtime(definition, createRealtime(definition), 2300, {
    kind: "interact",
    activeTimeMs: 2300,
    sequence: 1,
  });
  assert.equal(antivirusResult(result).score, 2);
  assert.deepEqual(
    result.feedback.filter((event) => event.activeTimeMs === 2300).map((event) => event.kind),
    ["targetExpired", "targetSpawned", "targetCleared"],
  );
});

test("T06 星星原子清除活跃蓝紫，同刻重复点击不重复计分，不连锁其他星星或未来目标", () => {
  const base = antivirus();
  const spawns: readonly AntivirusSpawn[] = [
    { id: "test.blue", tileId: tile(base, 0, 0), kind: "blue", spawnAtMs: 500, expiresAtMs: 2300 },
    {
      id: "test.purple",
      tileId: tile(base, 1, 0),
      kind: "purple",
      spawnAtMs: 500,
      expiresAtMs: 1500,
    },
    { id: "test.star", tileId: tile(base, 2, 0), kind: "star", spawnAtMs: 500, expiresAtMs: 2300 },
    {
      id: "test.other-star",
      tileId: tile(base, 3, 0),
      kind: "star",
      spawnAtMs: 500,
      expiresAtMs: 2300,
    },
    {
      id: "test.future",
      tileId: tile(base, 4, 0),
      kind: "blue",
      spawnAtMs: 1000,
      expiresAtMs: 2800,
    },
  ];
  const definition = scriptedAntivirus(spawns);
  const result = advanceRealtime(definition, createRealtime(definition), 650, [
    { ...click(definition, 2, 0, 650, 1), targetId: "test.star" },
    { ...click(definition, 0, 0, 650, 2), targetId: "test.blue" },
  ]);
  const state = antivirusResult(result);
  assert.equal(state.score, 3);
  assert.equal(state.bestStarClearCount, 2);
  assert.deepEqual(state.activeTargetIds, ["test.other-star"]);
  assert.equal(state.clearedTargetIds.length, 3);
  assert.equal(
    result.feedback.filter(
      (event) => event.kind === "targetCleared" && event.targetId === "test.blue",
    ).length,
    1,
  );
  const future = advanceRealtime(definition, state, 1000);
  assert.ok(antivirusResult(future).activeTargetIds.includes("test.future"));
  assert.equal(antivirusResult(future).score, 3);
});

test("T07 截止时先结束；duration-1ms 的输入按各自规则处理", () => {
  const firewallDefinition = firewall();
  const before = advanceRealtime(
    firewallDefinition,
    createRealtime(firewallDefinition),
    14999,
    move(14999),
  );
  assert.equal(before.state.playerTileId, tile(firewallDefinition, 3, 2));
  const at = advanceRealtime(
    firewallDefinition,
    createRealtime(firewallDefinition),
    15000,
    move(15000),
  );
  assert.equal(at.state.playerTileId, firewallDefinition.entry.tileId);
  assert.equal(at.feedback.filter((event) => event.kind === "move").length, 0);
  const base = antivirus();
  const definition = scriptedAntivirus([
    {
      id: "test.last",
      tileId: base.entry.tileId,
      kind: "blue",
      spawnAtMs: 44900,
      expiresAtMs: 46700,
    },
  ]);
  for (const [timeMs, score] of [
    [44999, 1],
    [45000, 0],
  ]) {
    assert.ok(timeMs !== undefined && score !== undefined);
    const result = advanceRealtime(definition, createRealtime(definition), timeMs, {
      kind: "interact",
      sequence: 1,
      activeTimeMs: timeMs,
    });
    assert.equal(antivirusResult(result).score, score);
  }
  assert.deepEqual(
    antivirusResult(advanceRealtime(definition, createRealtime(definition), 45000)).activeTargetIds,
    [],
  );
});

test("输入序号去重，回退时间及未来输入不污染规则，传入状态保持不变", () => {
  const definition = firewall();
  const initial = Object.freeze(createRealtime(definition));
  const accepted = advanceRealtime(definition, initial, 250, move(250));
  assert.equal(initial.combo, 0);
  assert.equal(advanceRealtime(definition, accepted.state, 250, move(250)).feedback.length, 0);
  assert.equal(
    advanceRealtime(definition, accepted.state, 249, move(249, 2)).state,
    accepted.state,
  );
  const ignored = advanceRealtime(definition, accepted.state, 300, move(750, 2));
  assert.equal(ignored.state.playerTileId, accepted.state.playerTileId);
  assert.equal(advanceRealtime(definition, accepted.state, NaN).state, accepted.state);
});

test("T09 幽灵走入静止玩家会失败；恰好帧边界先保留 tick 直到同刻输入或下一时刻", () => {
  const base = ghosts();
  const definition: GhostsDefinition = { ...base, entry: { tileId: tile(base, 2, 1) } };
  const held = advanceRealtime(definition, createRealtime(definition), 500);
  assert.equal(held.result, "running");
  assert.equal(
    ghostTileIds(definition, held.state as ReturnType<typeof createRealtime> & { kind: "ghosts" })[
      definition.rules.ghosts[0]?.id ?? ""
    ],
    tile(definition, 2, 2),
  );
  const failed = advanceRealtime(definition, held.state, 501);
  assert.equal(failed.result, "failure");
  assert.equal(failed.state.activeTimeMs, 500);
  assert.equal(failed.feedback.find((event) => event.kind === "collision")?.activeTimeMs, 500);
});

test("T09 同刻交换失败，双方跟随且不重合或交换则存活", () => {
  const base = ghosts();
  const swap: GhostsDefinition = { ...base, entry: { tileId: tile(base, 2, 1) } };
  const held = advanceRealtime(swap, createRealtime(swap), 500);
  const failed = advanceRealtime(swap, held.state, 500, move(500, 1, "down"));
  assert.equal(failed.result, "failure");
  const following: GhostsDefinition = { ...base, entry: { tileId: tile(base, 1, 2) } };
  const survived = advanceRealtime(following, createRealtime(following), 500, move(500));
  assert.equal(survived.result, "running");
  assert.equal(survived.state.playerTileId, tile(following, 2, 2));
  assert.equal(survived.feedback.filter((event) => event.kind === "collision").length, 0);
});

test("T10 灯与碰撞同刻时失败优先，正常亮灯只清指定组，重试恢复全部初态", () => {
  const base = ghosts("02");
  const initialGhost = base.rules.ghosts[0];
  assert.ok(initialGhost);
  const definition: GhostsDefinition = {
    ...base,
    entry: { tileId: tile(base, 1, 2) },
    rules: {
      ...base.rules,
      lamps: [
        { id: "test.lamp", tileId: tile(base, 2, 2), ghostIds: [initialGhost.id] },
        ...base.rules.lamps,
      ],
    },
  };
  const failed = advanceRealtime(definition, createRealtime(definition), 100, move(100));
  assert.equal(failed.result, "failure");
  assert.ok(failed.state.kind === "ghosts");
  assert.deepEqual(failed.state.litLampIds, []);
  assert.equal(failed.feedback.filter((event) => event.kind === "lampLit").length, 0);
  const survived = advanceRealtime(definition, createRealtime(definition), 500, move(500));
  assert.ok(survived.state.kind === "ghosts");
  assert.equal(survived.result, "running");
  assert.deepEqual(survived.state.removedGhostIds, [initialGhost.id]);
  assert.equal(Object.keys(ghostTileIds(definition, survived.state)).length, 1);
  assert.equal(Object.keys(ghostTileIds(definition, createRealtime(definition))).length, 2);
});

test("幽灵移动间隔 140ms，远点击拒绝，同刻最多一个玩家移动", () => {
  const definition = ghosts();
  let result = advanceRealtime(definition, createRealtime(definition), 100, [
    move(100, 1),
    move(100, 2),
  ]);
  assert.equal(result.state.playerTileId, tile(definition, 1, 2));
  result = advanceRealtime(definition, result.state, 239, move(239, 3, "left"));
  assert.equal(result.state.playerTileId, tile(definition, 1, 2));
  result = advanceRealtime(definition, result.state, 240, move(240, 4, "left"));
  assert.equal(result.state.playerTileId, tile(definition, 0, 2));
  result = advanceRealtime(definition, result.state, 400, click(definition, 3, 2, 400, 5));
  assert.equal(result.state.playerTileId, tile(definition, 0, 2));
});

function replayAtFrameRate(
  definition: RealtimeDefinition,
  witness: RealtimeWitness,
  fps: number,
): RealtimeAdvance {
  let state: RealtimeState = createRealtime(definition);
  const feedback: RealtimeFeedback[] = [];
  let commandIndex = 0;
  const finishAtMs = witness.finishAtMs + (definition.kind === "ghosts" ? 1 : 0);
  for (let frame = 0; state.status === "running"; frame += 1) {
    const timeMs = Math.min(finishAtMs, (frame * 1000) / fps);
    const inputs: RealtimeInput[] = [];
    while ((witness.commands[commandIndex]?.activeTimeMs ?? Infinity) <= timeMs) {
      const command = witness.commands[commandIndex];
      if (command) inputs.push(command);
      commandIndex += 1;
    }
    const result = advanceRealtime(definition, state, timeMs, inputs);
    state = result.state;
    feedback.push(...result.feedback);
    if (timeMs === finishAtMs) break;
  }
  return { state, result: state.status, feedback };
}

test("T13 所有实时成功与失败见证在 30 / 60 / 120fps 下终态、结果及反馈完全一致", () => {
  for (const witness of witnesses) {
    const definition = definitions.find((candidate) => candidate.id === witness.challengeId);
    assert.ok(definition);
    const expected = replayRealtimeWitness(definition, witness);
    for (const fps of [30, 60, 120]) {
      const result = replayAtFrameRate(definition, witness, fps);
      assert.deepEqual(result, expected, `${witness.id} @ ${fps}fps`);
    }
  }
});

test("T14 三档固定杀毒排表见证均在每目标出现后至少 150ms 操作并达标", () => {
  for (const definition of definitions) {
    if (definition.kind !== "antivirus") continue;
    const witness = witnesses.find(
      (candidate) =>
        candidate.challengeId === definition.id && candidate.expectedResult === "success",
    );
    assert.ok(witness);
    const byId = new Map(definition.rules.spawns.map((spawn) => [spawn.id, spawn]));
    for (const command of witness.commands) {
      assert.ok(command.kind === "click" && command.targetId !== undefined);
      const spawn = byId.get(command.targetId);
      assert.ok(spawn);
      assert.ok(command.activeTimeMs - spawn.spawnAtMs >= 150);
      assert.ok(command.activeTimeMs < spawn.expiresAtMs);
    }
    const result = replayRealtimeWitness(definition, witness);
    assert.equal(result.result, "success");
    assert.ok(antivirusResult(result).score >= definition.rules.targetScore);
    const maximum = definition.rules.spawns.reduce(
      (sum, spawn) => sum + antivirusTargetValue(spawn.kind),
      0,
    );
    assert.ok(antivirusResult(result).score <= maximum);
  }
});

test("内容校验拒绝未知类型、非有限时间、重复格、超上限门槛、同格重叠与非连续幽灵路径", () => {
  assert.ok(validateRealtimeDefinition({ ...firewall(), kind: "unknown" }).length > 0);
  assert.ok(
    validateRealtimeDefinition({
      ...firewall(),
      rules: { ...firewall().rules, durationMs: Infinity },
    }).length > 0,
  );
  assert.ok(
    validateRealtimeDefinition({ ...firewall(), tiles: [...firewall().tiles, firewall().tiles[0]] })
      .length > 0,
  );
  assert.ok(
    validateRealtimeDefinition({ ...firewall(), rules: { ...firewall().rules, comboTarget: 31 } })
      .length > 0,
  );
  assert.ok(
    validateRealtimeDefinition({ ...firewall(), rules: { ...firewall().rules, windowMs: 250 } })
      .length > 0,
  );
  const base = antivirus();
  const first = base.rules.spawns[0];
  assert.ok(first);
  assert.ok(
    validateRealtimeDefinition({
      ...base,
      rules: { ...base.rules, spawns: [first, { ...first, id: "test.overlap" }] },
    }).some((issue) => issue.message.includes("重叠")),
  );
  const ghostBase = ghosts();
  const ghost = ghostBase.rules.ghosts[0];
  assert.ok(ghost);
  assert.ok(
    validateRealtimeDefinition({
      ...ghostBase,
      rules: {
        ...ghostBase.rules,
        ghosts: [{ ...ghost, path: [tile(ghostBase, 2, 2), tile(ghostBase, 3, 1)] }],
      },
    }).some((issue) => issue.message.includes("连续")),
  );
});
