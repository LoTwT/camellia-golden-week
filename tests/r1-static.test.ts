import assert from "node:assert/strict";
import test from "node:test";
import theftJson from "../src/content/challenges/theft-r1.json" with { type: "json" };
import captureJson from "../src/content/challenges/capture-r1.json" with { type: "json" };
import theftAnalysis from "../tests/fixtures/r1/theft-state-space.json" with { type: "json" };
import { analyzeTheftStateSpace } from "../scripts/author-r1-theft-analysis.ts";
import {
  createTheftLayout,
  moveTheft,
  theftPowerActive,
  theftPortSatisfied,
  theftSolved,
  validateTheftLayout,
} from "../src/core/data-theft.ts";
import type { AssemblyTheftDefinition } from "../src/core/data-theft.ts";
import { createCaptureLayout, moveCapture, captureSolved } from "../src/core/capture.ts";
import type { CaptureDefinition } from "../src/core/capture.ts";
import {
  createStatic,
  moveStatic,
  undoStatic,
  resetStatic,
  createCompletedStaticLayout,
  validateCompletedStaticLayout,
  validateStaticContent,
  replayStaticWitness,
} from "../src/core/static-puzzle.ts";
import type { StaticContent } from "../src/core/static-puzzle.ts";

const theftContent = theftJson as unknown as StaticContent;
const captureContent = captureJson as unknown as StaticContent;
const first = theftJson.definitions[0] as AssemblyTheftDefinition;
const t = (x: number, y: number) => `${first.id}.t.${x}.${y}`;
for (const definition of theftJson.definitions as AssemblyTheftDefinition[])
  test(`${definition.id}: exhaustive reachable graph verifies actual dead ends or absence`, () => {
    const result = analyzeTheftStateSpace(definition);
    assert.deepEqual(
      result,
      theftAnalysis.results.find((item) => item.definitionId === definition.id),
    );
    if (result.deadEnd) {
      let state = createStatic(definition);
      for (const direction of result.deadEnd.actions) {
        const next = moveStatic(definition, state.state, state.playerTileId, direction);
        assert.equal(next.legal, true);
        assert.equal(next.success, false);
        state = next;
      }
      assert.deepEqual(state.state.currentLayout.theft, result.deadEnd.layout);
      const reset = resetStatic(definition, state.state, state.playerTileId);
      assert.deepEqual(
        { state: reset.state, playerTileId: reset.playerTileId },
        createStatic(definition),
      );
    } else assert.equal(result.winningStateCount, result.completeStateCount);
  });
for (const definition of theftJson.definitions as AssemblyTheftDefinition[])
  test(`${definition.id}: alternative changes component pushes and final approach`, () => {
    const traces = (["success", "alternative"] as const).map((kind) => {
      const witness = theftContent.witnesses.find(
        (item) => item.definitionId === definition.id && item.kind === kind,
      )!;
      let instance = createStatic(definition);
      const pushes: unknown[] = [];
      for (const action of witness.actions) {
        assert.ok(action !== "activate" && action !== "reset" && action !== "undo");
        const next = moveStatic(definition, instance.state, instance.playerTileId, action);
        if (
          JSON.stringify(next.state.currentLayout.theft) !==
          JSON.stringify(instance.state.currentLayout.theft)
        )
          pushes.push(next.state.currentLayout.theft);
        instance = next;
      }
      assert.equal(instance.state.phase, "complete");
      return { pushes, player: instance.playerTileId };
    });
    assert.notDeepEqual(traces[0]!.pushes, traces[1]!.pushes);
    assert.notEqual(traces[0]!.player, traces[1]!.player);
  });
function assembled() {
  const initial = createTheftLayout(first);
  const layout = { ...initial, ballTileById: { [first.ballIds[0]!]: t(1, 3) } };
  const result = moveTheft(first, layout, t(0, 3), "right");
  assert.equal(result.legal, true);
  return result;
}
test("R1 seven C boards and all fixed normal-action witnesses pass independent validation", () => {
  assert.deepEqual(validateStaticContent(theftContent), []);
  assert.deepEqual(validateStaticContent(captureContent), []);
  assert.equal(theftContent.definitions.length, 3);
  assert.equal(captureContent.definitions.length, 4);
});
for (const content of [theftContent, captureContent])
  for (const definition of content.definitions) {
    test(`${definition.id}: actual successful layout validates; undo cannot cross success`, () => {
      const witness = content.witnesses.find(
        (candidate) => candidate.definitionId === definition.id && candidate.kind === "success",
      )!;
      const result = replayStaticWitness(definition, witness);
      assert.deepEqual(result.errors, []);
      assert.deepEqual(
        validateCompletedStaticLayout(
          definition,
          createCompletedStaticLayout(definition, result.state, result.playerTileId),
        ),
        [],
      );
      assert.equal(undoStatic(definition, result.state, result.playerTileId).legal, false);
    });
    test(`${definition.id}: every pre-success action reverses all identities and player position`, () => {
      const witness = content.witnesses.find(
        (candidate) => candidate.definitionId === definition.id && candidate.kind === "success",
      )!;
      let instance = createStatic(definition);
      for (const action of witness.actions) {
        if (action === "activate" || action === "undo" || action === "reset") continue;
        const before = structuredClone(instance);
        const next = moveStatic(definition, instance.state, instance.playerTileId, action);
        if (next.success) break;
        assert.equal(next.legal, true);
        const reversed = undoStatic(definition, next.state, next.playerTileId);
        assert.deepEqual({ state: reversed.state, playerTileId: reversed.playerTileId }, before);
        instance = { state: next.state, playerTileId: next.playerTileId };
      }
      const reset = resetStatic(definition, instance.state, instance.playerTileId);
      assert.deepEqual(
        { state: reset.state, playerTileId: reset.playerTileId },
        createStatic(definition),
      );
    });
  }
test("ball slides several cells and player advances only into its original cell", () => {
  const layout = createTheftLayout(first);
  const result = moveTheft(first, layout, t(0, 1), "right");
  assert.equal(result.playerTileId, t(1, 1));
  assert.equal(result.layout.ballTileById[first.ballIds[0]!], t(4, 1));
  assert.equal(layout.ballTileById[first.ballIds[0]!], t(1, 1));
});
test("buffer permits player movement and prevents the signal ball crossing it", () => {
  const layout = createTheftLayout(first);
  assert.equal(moveTheft(first, layout, t(5, 5), "left").legal, true);
  const result = moveTheft(first, layout, t(2, 1), "left");
  assert.equal(result.legal, false);
  assert.equal(result.layout, layout);
});
test("unassembled station cannot be pushed", () => {
  const layout = createTheftLayout(first);
  const result = moveTheft(first, layout, t(3, 4), "up");
  assert.equal(result.legal, false);
  assert.equal(result.layout, layout);
});
test("matching ball merges at station and stops; original identities remain exactly once", () => {
  const result = assembled(),
    layout = result.layout;
  assert.deepEqual(layout.ballTileById, {});
  assert.deepEqual(layout.stationTileById, {});
  assert.equal(layout.amplifierTileById[first.amplifierIds[0]!], t(3, 3));
  assert.deepEqual(layout.assemblyByAmplifierId[first.amplifierIds[0]!], {
    ballId: first.ballIds[0],
    stationId: first.baseStationIds[0],
  });
  assert.deepEqual(validateTheftLayout(first, layout, result.playerTileId), []);
  assert.equal(theftPowerActive(first, layout), true);
});
test("wrong color station stops the ball before the station and does not assemble", () => {
  const definition = {
    ...first,
    componentCompatibility: {
      ...first.componentCompatibility,
      colorByStationId: { [first.baseStationIds[0]!]: "amber" as const },
    },
  };
  const layout = { ...createTheftLayout(first), ballTileById: { [first.ballIds[0]!]: t(1, 3) } };
  const result = moveTheft(definition, layout, t(0, 3), "right");
  assert.equal(result.layout.ballTileById[first.ballIds[0]!], t(2, 3));
  assert.equal(result.assembledAmplifierId, null);
});
test("assembled amplifier moves one cell and cannot enter the perimeter buffer", () => {
  const result = assembled();
  const pushed = moveTheft(first, result.layout, t(3, 2), "down");
  assert.equal(pushed.layout.amplifierTileById[first.amplifierIds[0]!], t(3, 4));
  assert.equal(pushed.playerTileId, t(3, 3));
  assert.equal(moveTheft(first, pushed.layout, t(3, 3), "down").legal, false);
});

test("a connected amplifier can leave its port before the other port is satisfied", () => {
  const d = theftJson.definitions[1] as AssemblyTheftDefinition;
  const tile = (x: number, y: number) => `${d.id}.t.${x}.${y}`;
  const layout = {
    ballTileById: {},
    stationTileById: {},
    amplifierTileById: { [d.amplifierIds[0]!]: tile(6, 3), [d.amplifierIds[1]!]: tile(4, 4) },
    assemblyByAmplifierId: Object.fromEntries(
      d.amplifierIds.map((id, index) => [
        id,
        { ballId: d.ballIds[index]!, stationId: d.baseStationIds[index]! },
      ]),
    ),
  };
  assert.deepEqual(validateTheftLayout(d, layout, tile(6, 2)), []);
  assert.equal(theftPortSatisfied(d, layout, d.powerPortIds[0]!), true);
  assert.equal(theftSolved(d, layout), false);
  const next = moveTheft(d, layout, tile(6, 2), "down");
  assert.equal(next.legal, true);
  assert.equal(theftPortSatisfied(d, next.layout, d.powerPortIds[0]!), false);
});

test("a combined amplifier blocks another signal ball without receiving transmitted force", () => {
  const d = theftJson.definitions[1] as AssemblyTheftDefinition;
  const tile = (x: number, y: number) => `${d.id}.t.${x}.${y}`;
  const layout = {
    ballTileById: { [d.ballIds[1]!]: tile(1, 3) },
    stationTileById: { [d.baseStationIds[1]!]: d.initialStationTileById[d.baseStationIds[1]!]! },
    amplifierTileById: { [d.amplifierIds[0]!]: tile(3, 3) },
    assemblyByAmplifierId: {
      [d.amplifierIds[0]!]: { ballId: d.ballIds[0]!, stationId: d.baseStationIds[0]! },
    },
  };
  assert.deepEqual(validateTheftLayout(d, layout, tile(0, 3)), []);
  const next = moveTheft(d, layout, tile(0, 3), "right");
  assert.equal(next.layout.ballTileById[d.ballIds[1]!], tile(2, 3));
  assert.deepEqual(next.layout.amplifierTileById, layout.amplifierTileById);
});

test("invalid cart push does not move the player or trigger an adjacent escape", () => {
  const d = captureJson.definitions[0] as CaptureDefinition;
  const tile = (x: number, y: number) => `${d.id}.t.${x}.${y}`;
  const layout = {
    ...createCaptureLayout(d),
    cartTileById: { [d.cartIds[0]!]: tile(2, 3) },
    bangbooTileById: { [d.bangbooIds[0]!]: tile(2, 2) },
  };
  const next = moveCapture(d, layout, tile(1, 3), "right");
  assert.equal(next.legal, false);
  assert.equal(next.layout, layout);
  assert.equal(next.playerTileId, tile(1, 3));
});

test("escape ties follow the declared priority rather than object insertion order", () => {
  const d = captureJson.definitions[0] as CaptureDefinition;
  const tile = (x: number, y: number) => `${d.id}.t.${x}.${y}`;
  const layout = {
    ...createCaptureLayout(d),
    cartTileById: { [d.cartIds[0]!]: tile(1, 3) },
    bangbooTileById: { [d.bangbooIds[0]!]: tile(1, 0) },
  };
  assert.equal(
    moveCapture(d, layout, tile(1, 2), "up").layout.bangbooTileById[d.bangbooIds[0]!],
    tile(2, 0),
  );
  const changed: CaptureDefinition = {
    ...d,
    escapeRules: { ...d.escapeRules, priority: ["left", "up", "right", "down"] },
  };
  assert.equal(
    moveCapture(changed, layout, tile(1, 2), "up").layout.bangbooTileById[d.bangbooIds[0]!],
    tile(0, 0),
  );
});
test("unassembled components cannot satisfy an interface, even at its coordinate", () => {
  const layout = { ...createTheftLayout(first), ballTileById: { [first.ballIds[0]!]: t(1, 4) } };
  assert.equal(theftSolved(first, layout), false);
  assert.equal(theftPowerActive(first, layout), false);
});
test("save validation rejects duplicated, lost, moved-station and buffer components", () => {
  const layout = createTheftLayout(first);
  assert.ok(validateTheftLayout(first, { ...layout, ballTileById: {} }).length);
  assert.ok(
    validateTheftLayout(first, { ...layout, ballTileById: { [first.ballIds[0]!]: t(0, 0) } })
      .length,
  );
  assert.ok(
    validateTheftLayout(first, {
      ...layout,
      stationTileById: { [first.baseStationIds[0]!]: t(2, 3) },
    }).length,
  );
  const combined = assembled().layout;
  assert.ok(validateTheftLayout(first, { ...combined, ballTileById: layout.ballTileById }).length);
});
test("undo is bounded at 256 complete player and component snapshots", () => {
  let instance = createStatic(first);
  for (let i = 0; i < 300; i++) {
    const next = moveStatic(
      first,
      instance.state,
      instance.playerTileId,
      i % 2 === 0 ? "left" : "right",
    );
    assert.equal(next.legal, true);
    instance = { state: next.state, playerTileId: next.playerTileId };
  }
  assert.equal(instance.state.undoStack.length, 256);
  for (let i = 0; i < 256; i++) {
    const next = undoStatic(first, instance.state, instance.playerTileId);
    instance = { state: next.state, playerTileId: next.playerTileId };
  }
  assert.equal(undoStatic(first, instance.state, instance.playerTileId).code, "noHistory");
  const reset = resetStatic(first, instance.state, instance.playerTileId);
  assert.deepEqual({ state: reset.state, playerTileId: reset.playerTileId }, createStatic(first));
});
for (const definition of captureJson.definitions as CaptureDefinition[])
  test(`${definition.id}: without a cart every reachable chase state remains uncaptured`, () => {
    const start = {
      layout: { ...createCaptureLayout(definition), cartTileById: {} },
      player: definition.startTileId,
    };
    const queue = [start],
      seen = new Set<string>();
    for (let i = 0; i < queue.length; i++) {
      const current = queue[i]!;
      for (const direction of ["up", "right", "down", "left"] as const) {
        const next = moveCapture(definition, current.layout, current.player, direction);
        if (!next.legal) continue;
        assert.equal(captureSolved(definition, next.layout), false);
        const key = JSON.stringify([next.playerTileId, next.layout]);
        if (seen.has(key)) continue;
        seen.add(key);
        queue.push({ layout: next.layout, player: next.playerTileId });
      }
    }
    assert.ok(seen.size > 10);
  });
