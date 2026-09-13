import assert from "node:assert/strict";
import test from "node:test";
import content from "../src/content/challenges/antivirus-r1.json" with { type: "json" };
import current from "../src/content/challenges/realtime.json" with { type: "json" };
import {
  advanceR1Antivirus,
  antivirusCorruptionCount,
  createR1Antivirus,
  validateR1Antivirus,
} from "../src/core/antivirus.ts";
import type { R1AntivirusDefinition, R1AntivirusSpawn } from "../src/core/antivirus.ts";
import type { RealtimeFeedback, RealtimeInput } from "../src/core/realtime.ts";
import {
  advanceRealtime,
  createRealtime,
  replayRealtimeWitness,
  validateRealtimeDefinition,
  antivirusActiveTargets,
  antivirusRequiredScore,
  antivirusSpawns,
  isR1AntivirusState,
} from "../src/core/realtime.ts";
import type { RealtimeWitness } from "../src/core/realtime.ts";

const definitions = content.definitions as unknown as readonly R1AntivirusDefinition[];
const light = definitions[0]!;

test("current realtime bundle dispatches R1 antivirus while firewall and ghosts retain their rule versions", () => {
  assert.equal(current.contentVersion, 3);
  assert.equal(current.ruleVersion, 4);
  assert.deepEqual(
    current.definitions.filter((definition) => definition.kind === "antivirus"),
    content.definitions,
  );
  for (const definition of current.definitions) {
    assert.deepEqual(validateRealtimeDefinition(definition), [], definition.id);
    if (definition.kind === "firewall") assert.equal(definition.ruleVersion, 3);
  }
  for (const definition of definitions) {
    const state = createRealtime(definition);
    assert.deepEqual(state, createR1Antivirus(definition));
    assert.equal(isR1AntivirusState(state), true);
    assert.equal(antivirusRequiredScore(definition), definition.rules.completionRules.targetScore);
    assert.deepEqual(antivirusSpawns(definition), definition.rules.spawnPlan);
    for (const witness of content.witnesses.filter(
      (candidate) => candidate.challengeId === definition.id,
    )) {
      const direct = advanceR1Antivirus(
        definition,
        state,
        witness.finishAtMs,
        witness.commands as readonly RealtimeInput[],
      );
      assert.deepEqual(replayRealtimeWitness(definition, witness as RealtimeWitness), direct);
      assert.deepEqual(
        antivirusActiveTargets(definition, direct.state),
        direct.state.activeTargets,
      );
    }
    const { activeTargets: _activeTargets, ruleVersion: _ruleVersion, ...legacyState } = state;
    assert.throws(() => advanceRealtime(definition, legacyState, 1000));
  }
});
const click = (target: R1AntivirusSpawn, activeTimeMs: number, sequence = 1): RealtimeInput => ({
  kind: "click",
  tileId: target.tileId,
  targetId: target.id,
  activeTimeMs,
  sequence,
});
function boundary(
  spawns: readonly R1AntivirusSpawn[],
  durationMs = 30_000,
  targetScore = 100,
): R1AntivirusDefinition {
  return {
    ...light,
    id: "antivirus.boundary",
    rules: {
      ...light.rules,
      durationMs,
      completionRules: { kind: "scoreReachedBeforeDeadline", targetScore },
      spawnPlan: spawns,
    },
  };
}
function spawn(
  id: string,
  spawnAtMs: number,
  position = 0,
  kind: R1AntivirusSpawn["kind"] = "blue",
): R1AntivirusSpawn {
  return { id, spawnAtMs, tileId: light.tiles[position]!.id, kind };
}

for (const definition of definitions) {
  test(`${definition.id}: validates fixed 5×4 persistent pressure rules`, () => {
    assert.deepEqual(validateR1Antivirus(definition), []);
    assert.equal(definition.tiles.length, 20);
    assert.equal(definition.rules.maxActiveCorruption, 9);
    assert.ok(definition.rules.spawnPlan.every((target) => !("expiresAtMs" in target)));
  });
  for (const witness of content.witnesses.filter(
    (candidate) => candidate.challengeId === definition.id,
  )) {
    test(`${witness.id}: fixed normal input replay`, () => {
      const initial = createR1Antivirus(definition);
      const inputs = witness.commands as readonly RealtimeInput[];
      const result = advanceR1Antivirus(definition, initial, witness.finishAtMs, inputs);
      assert.equal(result.result, witness.expectedResult);
      assert.equal(result.state.playerTileId, witness.expectedFinalState.playerTileId);
      assert.equal(result.state.score, witness.expectedFinalState.score);
      assert.equal(result.state.bestStarClearCount, witness.expectedBestStarClearCount);
      assert.deepEqual(
        initial,
        createR1Antivirus(definition),
        "advancement cannot mutate the initial state",
      );
      assert.deepEqual(advanceR1Antivirus(definition, initial, witness.finishAtMs, inputs), result);
      if (witness.id.endsWith("failure")) {
        assert.equal(inputs.length, 0);
        assert.equal(result.state.failureReason, "overflow");
        assert.equal(antivirusCorruptionCount(result.state), 10);
        assert.ok(result.state.activeTimeMs < definition.rules.durationMs);
      } else assert.ok(result.state.score >= definition.rules.completionRules.targetScore);
      if (witness.id.endsWith("star-recovery")) assert.ok(result.state.bestStarClearCount >= 5);
      if (witness.id.endsWith("keyboard"))
        assert.ok(inputs.every((input) => input.kind !== "click"));
    });
  }
  test(`${definition.id}: frame partitions preserve state and event sequence`, () => {
    const witness = content.witnesses.find(
      (candidate) => candidate.id === `${definition.id}.r1.witness.star-recovery`,
    )!;
    const commands = witness.commands as readonly RealtimeInput[];
    const expected = advanceR1Antivirus(
      definition,
      createR1Antivirus(definition),
      witness.finishAtMs,
      commands,
    );
    for (const frameMs of [1000 / 30, 1000 / 60, 1000 / 120, 1000 / 144, 137]) {
      let state = createR1Antivirus(definition);
      const feedback: RealtimeFeedback[] = [];
      let cursor = 0;
      for (let time = frameMs; state.status === "running"; time += frameMs) {
        const at = Math.min(time, witness.finishAtMs);
        const batch: RealtimeInput[] = [];
        while (commands[cursor] && commands[cursor]!.activeTimeMs <= at)
          batch.push(commands[cursor++]!);
        const next = advanceR1Antivirus(definition, state, at, batch);
        state = next.state;
        feedback.push(...next.feedback);
      }
      assert.deepEqual(state, expected.state);
      assert.deepEqual(feedback, expected.feedback);
    }
  });
  test(`${definition.id}: observed mouse reaction windows are at least 150ms`, () => {
    const witness = content.witnesses.find(
      (candidate) => candidate.id === `${definition.id}.r1.witness.success`,
    )!;
    const spawns = new Map(definition.rules.spawnPlan.map((target) => [target.id, target]));
    for (const input of witness.commands as readonly RealtimeInput[]) {
      assert.equal(input.kind, "click");
      if (input.kind !== "click") continue;
      const target = spawns.get(input.targetId!);
      assert.ok(target);
      assert.ok(input.activeTimeMs - target.spawnAtMs >= 150);
    }
    const failure = advanceR1Antivirus(
      definition,
      createR1Antivirus(definition),
      definition.rules.durationMs,
    );
    const ninth = definition.rules.spawnPlan.filter((target) => target.kind !== "star")[8]!;
    assert.ok(failure.state.activeTimeMs - ninth.spawnAtMs >= 150);
  });
}

test("persistent blue and purple targets do not disappear even after old TTLs", () => {
  const definition = boundary([spawn("blue", 1000), spawn("purple", 1200, 1, "purple")]);
  const result = advanceR1Antivirus(definition, createR1Antivirus(definition), 25_000);
  assert.equal(result.result, "running");
  assert.equal(antivirusCorruptionCount(result.state), 2);
  assert.deepEqual(result.state.expiredTargetIds, []);
  assert.deepEqual(result.state.clearedTargetIds, []);
});

test("nine corruption targets are allowed; tenth defeats a same-time star clear", () => {
  const spawns = Array.from({ length: 10 }, (_, index) =>
    spawn(`normal.${index}`, 1000 + index * 500, index),
  );
  const star = spawn("star", 2000, 15, "star");
  const definition = boundary([...spawns, star].toSorted((a, b) => a.spawnAtMs - b.spawnAtMs));
  const atNine = advanceR1Antivirus(definition, createR1Antivirus(definition), 5499).state;
  assert.equal(atNine.status, "running");
  assert.equal(antivirusCorruptionCount(atNine), 9);
  const failure = advanceR1Antivirus(definition, atNine, 5500, click(star, 5500));
  assert.equal(failure.state.failureReason, "overflow");
  assert.equal(failure.state.score, 0);
  assert.ok(failure.state.activeTargetIds.includes(star.id));
  const saved = advanceR1Antivirus(definition, atNine, 5499, click(star, 5499));
  assert.equal(saved.state.bestStarClearCount, 9);
  assert.equal(advanceR1Antivirus(definition, saved.state, 5500).result, "running");
});

test("deadline beats same-time spawn and a score-reaching click", () => {
  const old = spawn("old", 1000);
  const definition = boundary([old, spawn("deadline", 2000, 1)], 2000, 1);
  const result = advanceR1Antivirus(
    definition,
    createR1Antivirus(definition),
    2000,
    click(old, 2000),
  );
  assert.equal(result.state.failureReason, "deadline");
  assert.equal(result.state.score, 0);
  assert.deepEqual(result.state.activeTargetIds, [old.id]);
  assert.ok(!result.feedback.some((event) => event.targetId === "deadline"));
  assert.equal(
    advanceR1Antivirus(definition, createR1Antivirus(definition), 1999, click(old, 1999)).result,
    "success",
  );
});

test("same-time spawn batch is ASCII-id ordered before star clearing", () => {
  const star = spawn("z.star", 1000, 0, "star");
  const blue = spawn("a.blue", 1000, 1);
  const purple = spawn("b.purple", 1000, 2, "purple");
  const definition = boundary([star, purple, blue]);
  const result = advanceR1Antivirus(
    definition,
    createR1Antivirus(definition),
    1000,
    click(star, 1000),
  );
  assert.deepEqual(
    result.feedback
      .filter((event) => event.kind === "targetSpawned")
      .map((event) => event.targetId),
    [blue.id, purple.id, star.id],
  );
  assert.equal(result.state.score, 3);
  assert.equal(result.state.bestStarClearCount, 2);
  assert.deepEqual(result.state.activeTargets, []);
  const split = advanceR1Antivirus(definition, createR1Antivirus(definition), 1000);
  const after = advanceR1Antivirus(definition, split.state, 1000, click(star, 1000));
  assert.deepEqual(after.state, result.state);
  assert.deepEqual([...split.feedback, ...after.feedback], result.feedback);
});

test("star transaction counts all corruption once, keeps other stars, and completes atomically", () => {
  const star = spawn("star.1", 1000, 2, "star");
  const otherStar = spawn("star.2", 1100, 3, "star");
  const definition = boundary(
    [spawn("blue", 500), spawn("purple", 700, 1, "purple"), star, otherStar],
    5000,
    1,
  );
  const input = click(star, 1200);
  const result = advanceR1Antivirus(definition, createR1Antivirus(definition), 1200, [
    input,
    { ...input, sequence: 2 },
  ]);
  assert.equal(result.result, "success");
  assert.equal(result.state.score, 3);
  assert.deepEqual(result.state.activeTargetIds, [otherStar.id]);
  assert.equal(new Set(result.state.clearedTargetIds).size, 3);
  assert.equal(result.feedback.filter((event) => event.kind === "success").length, 1);
  assert.deepEqual(advanceR1Antivirus(definition, result.state, 6000, input), {
    state: result.state,
    result: "success",
    feedback: [],
  });
});

test("occupied spawn probes row-major cyclic slots; actual target coordinates govern input", () => {
  const a = spawn("a", 500, 19);
  const b = spawn("b", 800, 19);
  const c = spawn("c", 1100, 19);
  const definition = boundary([a, b, c]);
  const state = advanceR1Antivirus(definition, createR1Antivirus(definition), 1300).state;
  assert.deepEqual(
    state.activeTargets.map((target) => target.tileId),
    [light.tiles[19]!.id, light.tiles[0]!.id, light.tiles[1]!.id],
  );
  const wrong = advanceR1Antivirus(definition, state, 1400, click(b, 1400));
  assert.equal(wrong.state.score, 0);
  assert.equal(wrong.feedback[0]?.kind, "invalidInput");
  const right = advanceR1Antivirus(definition, state, 1400, click(state.activeTargets[1]!, 1400));
  assert.equal(right.state.score, 1);
  assert.deepEqual(right.state.activeTargetIds, [a.id, c.id]);
});

test("a board full of persistent stars fails explicitly without replacing a target", () => {
  const definition = boundary(
    Array.from({ length: 21 }, (_, index) => spawn(`star.${index}`, 500 + index * 200, 0, "star")),
  );
  const result = advanceR1Antivirus(definition, createR1Antivirus(definition), 6000);
  assert.equal(result.state.failureReason, "boardFull");
  assert.equal(result.state.activeTargets.length, 20);
  assert.equal(new Set(result.state.activeTargets.map((target) => target.tileId)).size, 20);
  assert.equal(antivirusCorruptionCount(result.state), 0);
  assert.equal(result.state.score, 0);
});

test("underfoot spawns need input; edge moves do not clear them; F does", () => {
  const target = spawn("foot", 1000, 2);
  const definition = boundary([target]);
  const state = advanceR1Antivirus(definition, createR1Antivirus(definition), 1300).state;
  assert.equal(state.score, 0);
  const edge = advanceR1Antivirus(definition, state, 1400, {
    kind: "move",
    direction: "up",
    activeTimeMs: 1400,
    sequence: 1,
  });
  assert.equal(edge.state.score, 0);
  const cleared = advanceR1Antivirus(definition, edge.state, 1500, {
    kind: "interact",
    activeTimeMs: 1500,
    sequence: 2,
  });
  assert.equal(cleared.state.score, 1);
});

test("old instance clicks do not clear a replacement and duplicates cannot score twice", () => {
  const old = spawn("old", 500),
    replacement = spawn("new", 1000);
  const definition = boundary([old, replacement]);
  const cleared = advanceR1Antivirus(
    definition,
    createR1Antivirus(definition),
    750,
    click(old, 750),
  );
  const stale = advanceR1Antivirus(definition, cleared.state, 1250, click(old, 1250, 2));
  assert.equal(stale.state.score, 1);
  assert.deepEqual(stale.state.activeTargetIds, [replacement.id]);
  const command = click(replacement, 1300, 3);
  const once = advanceR1Antivirus(definition, stale.state, 1300, [
    command,
    command,
    { ...command, sequence: 4 },
  ]);
  assert.equal(once.state.score, 2);
  assert.deepEqual(once.state.clearedTargetIds, [old.id, replacement.id]);
});

test("input order is deterministic and invalid clock / sequence inputs are inert", () => {
  const one = spawn("one", 500),
    two = spawn("two", 500, 1);
  const definition = boundary([one, two]);
  const initial = createR1Antivirus(definition);
  const inputs = [click(one, 800, 1), click(two, 800, 2)];
  assert.deepEqual(
    advanceR1Antivirus(definition, initial, 1000, inputs),
    advanceR1Antivirus(definition, initial, 1000, inputs.toReversed()),
  );
  for (const invalid of [
    click(one, 1001),
    click(one, -1),
    click(one, 800, NaN),
    click(one, 800, -1),
  ])
    assert.deepEqual(
      advanceR1Antivirus(definition, initial, 1000, invalid),
      advanceR1Antivirus(definition, initial, 1000),
    );
  const progressed = advanceR1Antivirus(definition, initial, 1000).state;
  for (const time of [NaN, Infinity, -1, 999])
    assert.equal(advanceR1Antivirus(definition, progressed, time).state, progressed);
  assert.throws(() => advanceR1Antivirus({ ...definition, id: "wrong" }, progressed, 1000));
});

test("validator rejects absent pressure, TTL, unsafe reaction time, drift and malformed structure", () => {
  const mutate = (change: (candidate: Record<string, any>) => void) => {
    const candidate = structuredClone(light);
    change(candidate);
    assert.ok(validateR1Antivirus(candidate).length > 0);
  };
  mutate((candidate) => {
    candidate.rules.spawnPlan = candidate.rules.spawnPlan.slice(0, 9);
  });
  mutate((candidate) => {
    candidate.rules.spawnPlan[0].expiresAtMs = 1800;
  });
  mutate((candidate) => {
    candidate.rules.spawnPlan[1].spawnAtMs = 1149;
  });
  mutate((candidate) => {
    candidate.rules.targetRules.blue.lifetime = "ttl";
  });
  mutate((candidate) => {
    candidate.rules.maxActiveCorruption = 10;
  });
  mutate((candidate) => {
    candidate.rules.spawnPlan[1].id = candidate.rules.spawnPlan[0].id;
  });
  mutate((candidate) => {
    candidate.rules.completionRules.targetScore = 10000;
  });
  mutate((candidate) => {
    candidate.tiles[0].x = 1;
  });
  mutate((candidate) => {
    candidate.rules.eventOrder = ["inputSequence", "overflow"];
  });
  for (const malformed of [null, [], {}, { tiles: [null], rules: null }])
    assert.ok(validateR1Antivirus(malformed).length > 0);
});
