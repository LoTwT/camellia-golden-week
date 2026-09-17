import assert from "node:assert/strict";
import test from "node:test";
import { assembleContent } from "../src/content/assemble.ts";
import { createGame, dispatch, tileCleared } from "../src/core/engine.ts";
import { gateOpen } from "../src/core/progress.ts";
import type { GameCommand } from "../src/core/types.ts";

for (const profile of ["M1", "M2", "M3", "M4", "M5"] as const)
  test(`I05 / ${profile} 绕过能力拾取到达真实富集节点，必须先领取增幅仪才可清除`, () => {
    const content = assembleContent(profile);
    let state = createGame(content, 0);
    let now = 0;
    const send = (command: GameCommand) => {
      now += 140;
      const result = dispatch(content, state, command, now);
      state = result.state;
      return result;
    };
    for (const direction of ["down", "right", "right", "up", "right"] as const)
      assert.equal(send({ kind: "Move", direction }).code, "accepted");
    assert.equal(state.playerPosition.tileId, "hub.t.3.2");
    assert.equal(state.capabilities.length, 0);
    const revision = state.stateRevision;
    const rejected = send({ kind: "Amplify" });
    assert.equal(rejected.code, "unmetCondition");
    assert.equal(rejected.stable, false);
    assert.equal(state.stateRevision, revision);
    assert.deepEqual(state.clearedEtherNodeIds, []);
    assert.deepEqual(state.completedObjectiveIds, []);
    assert.deepEqual(state.claimedRewardIds, []);
    assert.equal(tileCleared(content, state, "hub.t.4.2"), false);
    assert.equal(gateOpen(content, state, "gate.hub.tutorial"), false);

    for (const direction of ["left", "left", "right", "right"] as const)
      assert.equal(send({ kind: "Move", direction }).code, "accepted");
    assert.ok(state.capabilities.includes("amplifier"));
    assert.equal(send({ kind: "Amplify" }).code, "accepted");
    assert.deepEqual(state.clearedEtherNodeIds, ["hub.nexus"]);
    assert.equal(tileCleared(content, state, "hub.t.4.2"), true);
    assert.equal(gateOpen(content, state, "gate.hub.tutorial"), true);
  });
