import assert from "node:assert/strict";
import test from "node:test";
import { assembleContent, realtimeContent } from "../src/content/assemble.ts";
import routes from "../src/content/witnesses/r1-world.json" with { type: "json" };
import { createGame, dispatch } from "../src/core/engine.ts";
import {
  advanceRealtime,
  createRealtime,
  ghostTileIds,
  replayRealtimeWitness,
} from "../src/core/realtime.ts";
import type { GhostsDefinition, RealtimeInput, RealtimeFeedback } from "../src/core/realtime.ts";
import type { Direction, GameCommand } from "../src/core/types.ts";
import type { WorldWitness } from "../src/content/validate.ts";

const definitions = realtimeContent.definitions.filter(
  (item): item is GhostsDefinition => item.kind === "ghosts",
);
const delta: readonly [Direction, number, number][] = [
  ["up", 0, -1],
  ["right", 1, 0],
  ["down", 0, 1],
  ["left", -1, 0],
];
function directionBetween(definition: GhostsDefinition, fromId: string, toId: string): Direction {
  const from = definition.tiles.find((item) => item.id === fromId)!,
    to = definition.tiles.find((item) => item.id === toId)!;
  const result = delta.find(([, dx, dy]) => to.x === from.x + dx && to.y === from.y + dy);
  assert.ok(result);
  return result[0];
}
for (const definition of definitions) {
  const ghost = definition.rules.ghosts[0]!,
    origin = ghost.path[0]!,
    next = ghost.path[1]!;
  const move = (direction: Direction, at = 500): RealtimeInput => ({
    kind: "move",
    direction,
    sequence: 1,
    activeTimeMs: at,
  });
  test(`${definition.id} R1 T09: real route ghost enters stationary player, swaps, or follows`, () => {
    // Synthetic player-only placements isolate collisions on the actual current map/ghost route.
    const placed = { ...createRealtime(definition), playerTileId: next };
    const held = advanceRealtime(definition, placed, 500);
    assert.equal(held.result, "running");
    const hit = advanceRealtime(definition, held.state, 501);
    assert.equal(hit.result, "failure");
    assert.equal(hit.feedback.find((event) => event.kind === "collision")?.activeTimeMs, 500);
    assert.equal(
      advanceRealtime(definition, held.state, 500, move(directionBetween(definition, next, origin)))
        .result,
      "failure",
    );
    const originTile = definition.tiles.find((tile) => tile.id === origin)!;
    const follower = definition.tiles.find(
      (tile) =>
        tile.id !== next && Math.abs(tile.x - originTile.x) + Math.abs(tile.y - originTile.y) === 1,
    )!;
    const followed = advanceRealtime(
      definition,
      { ...createRealtime(definition), playerTileId: follower.id },
      500,
      move(directionBetween(definition, follower.id, origin)),
    );
    assert.equal(followed.result, "running");
    assert.equal(followed.state.playerTileId, origin);
    assert.equal(followed.feedback.filter((event) => event.kind === "collision").length, 0);
  });
  test(`${definition.id} R1 T10: collision beats synthetic lamp, surviving lamp clears only its group`, () => {
    const originTile = definition.tiles.find((tile) => tile.id === origin)!;
    const adjacent = definition.tiles.find(
      (tile) =>
        tile.id !== next && Math.abs(tile.x - originTile.x) + Math.abs(tile.y - originTile.y) === 1,
    )!;
    const lamp = { id: "boundary.lamp", tileId: origin, ghostIds: [ghost.id] };
    const boundary = {
      ...definition,
      rules: { ...definition.rules, lamps: [lamp, ...definition.rules.lamps] },
    };
    const initial = { ...createRealtime(boundary), playerTileId: adjacent.id };
    const collision = advanceRealtime(
      boundary,
      initial,
      100,
      move(directionBetween(boundary, adjacent.id, origin), 100),
    );
    assert.equal(collision.result, "failure");
    assert.ok(collision.state.kind === "ghosts");
    assert.deepEqual(collision.state.litLampIds, []);
    const survived = advanceRealtime(
      boundary,
      initial,
      500,
      move(directionBetween(boundary, adjacent.id, origin)),
    );
    assert.ok(survived.state.kind === "ghosts");
    assert.equal(survived.result, "running");
    assert.deepEqual(survived.state.removedGhostIds, [ghost.id]);
    assert.equal(
      Object.keys(ghostTileIds(boundary, survived.state)).length,
      definition.rules.ghosts.length - 1,
    );
    assert.deepEqual(createRealtime(boundary).litLampIds, []);
    assert.deepEqual(createRealtime(boundary).removedGhostIds, []);
  });
  test(`${definition.id} R1 T13: every success, alternative and failure has identical state/events at 30/60/120fps`, () => {
    for (const witness of realtimeContent.witnesses.filter(
      (item) => item.challengeId === definition.id,
    )) {
      const expected = replayRealtimeWitness(definition, witness);
      for (const fps of [30, 60, 120]) {
        let state = createRealtime(definition),
          cursor = 0;
        const feedback: RealtimeFeedback[] = [];
        const finish = witness.finishAtMs + 1;
        for (let frame = 0; state.status === "running"; frame++) {
          const at = Math.min(finish, (frame * 1000) / fps),
            inputs: RealtimeInput[] = [];
          while (witness.commands[cursor] && witness.commands[cursor]!.activeTimeMs <= at)
            inputs.push(witness.commands[cursor++]!);
          const result = advanceRealtime(definition, state, at, inputs);
          assert.ok(result.state.kind === "ghosts");
          state = result.state;
          feedback.push(...result.feedback);
          if (at === finish) break;
        }
        assert.deepEqual(
          { state, result: state.status, feedback },
          expected,
          `${witness.id}@${fps}`,
        );
      }
    }
  });
  test(`${definition.id} R1 T11/T12: actual world start pauses at 499ms and resumes with exactly 1ms remaining`, () => {
    const content = assembleContent("M5");
    const witness = routes.witnesses.find(
      (item) => item.id === "m5.world.main-path-without-scored-challenges",
    ) as WorldWitness;
    let state = createGame(content, 0),
      now = 0;
    for (const step of witness.steps) {
      const result = dispatch(content, state, step.command, step.atMs);
      assert.equal(result.code, step.expectedCode);
      state = result.state;
      now = step.atMs;
      if (step.command.kind === "StartChallenge" && step.command.challengeId === definition.id)
        break;
    }
    assert.equal(state.activeRealtime?.roomId, definition.id);
    const send = (command: GameCommand, ms = 0) => {
      now += ms;
      const result = dispatch(content, state, command, now);
      state = result.state;
      return result;
    };
    const wait = (ms: number) => {
      for (let left = ms; left > 0;) {
        const chunk = Math.min(200, left);
        send({ kind: "Tick" }, chunk);
        left -= chunk;
      }
    };
    wait(3000);
    wait(499);
    const before = structuredClone(state.activeRealtime),
      permanent = structuredClone([state.completedObjectiveIds, state.claimedRewardIds]);
    assert.equal(send({ kind: "Pause", reason: "hidden", present: true }).clearInputs, true);
    send({ kind: "Tick" }, 30_000);
    assert.equal(state.clock.activeTimeMs, 499);
    assert.deepEqual(state.activeRealtime, before);
    send({ kind: "Pause", reason: "hidden", present: false });
    send({ kind: "Resume", pageVisible: true, canvasOperable: true, graphicsAvailable: true });
    wait(2999);
    assert.equal(state.clock.countdownRemainingMs, 1);
    assert.equal(state.clock.activeTimeMs, 499);
    wait(1);
    assert.deepEqual(state.activeRealtime, before);
    wait(1);
    wait(1); // Exact timestamp is held for same-time intent; next tick commits only that one step.
    assert.ok(state.activeRealtime?.state.kind === "ghosts");
    assert.equal(state.activeRealtime.state.ghostPathIndices[ghost.id], 1);
    const afterStep = structuredClone(state.activeRealtime);
    const interrupted = send({ kind: "Move", direction: "down" }, 300);
    assert.equal(interrupted.code, "paused");
    assert.equal(interrupted.clearInputs, true);
    assert.deepEqual(state.activeRealtime, afterStep);
    assert.equal(state.clock.activeTimeMs, 501);
    assert.deepEqual([state.completedObjectiveIds, state.claimedRewardIds], permanent);
  });
}
