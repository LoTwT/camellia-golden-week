import assert from "node:assert/strict";
import test from "node:test";
import { assembleContent } from "../src/content/assemble.ts";
import { createGame, dispatch } from "../src/core/engine.ts";
import { firewallBeatCount } from "../src/core/realtime.ts";
import type { GameCommand } from "../src/core/types.ts";

test("暂停输入所在截止时刻先提交实时结算，再冻结；重复暂停不重复事件", () => {
  const content = assembleContent("M1");
  let state = createGame(content);
  let now = 0;
  const send = (command: GameCommand, delta = 140) => {
    now += delta;
    const result = dispatch(content, state, command, now);
    state = result.state;
    return result;
  };
  for (let step = 0; step < 3; step++) send({ kind: "Move", direction: "right" });
  send({ kind: "Amplify" });
  for (let step = 0; step < 3; step++) send({ kind: "Move", direction: "right" });
  send({ kind: "Interact" });
  for (let step = 0; step < 3; step++) send({ kind: "Move", direction: "up" });
  send({ kind: "Interact" });
  send({ kind: "StartChallenge", challengeId: "a.firewall.tutorial" });
  for (let tick = 0; tick < 30; tick++) send({ kind: "Tick" }, 100);
  const definition = content.realtimeChallenges.find(
    (challenge) => challenge.id === "a.firewall.tutorial",
  );
  assert.ok(definition?.kind === "firewall");
  for (let beat = 0; beat < firewallBeatCount(definition); beat++) {
    const target = Math.round(
      definition.rules.firstBeatMs + beat * (60_000 / definition.rules.bpm),
    );
    while (state.clock.activeTimeMs < target)
      send({ kind: "Tick" }, Math.min(100, target - state.clock.activeTimeMs));
    send({ kind: "Move", direction: beat % 2 === 0 ? "right" : "left" }, 0);
  }
  while (state.clock.activeTimeMs < 14999)
    send({ kind: "Tick" }, Math.min(100, 14999 - state.clock.activeTimeMs));
  assert.equal(state.mode, "challengeRunning");
  const paused = send({ kind: "Pause", reason: "manual", present: true }, 1);
  assert.equal(state.clock.activeTimeMs, 15000);
  assert.equal(state.mode, "challengeResult");
  assert.equal(state.phase, "success");
  assert.ok(state.completedObjectiveIds.includes("a.firewall.tutorial"));
  assert.equal(paused.events.filter((event) => event.kind === "success").length, 1);
  assert.equal(paused.stable, true);
  const revision = state.stateRevision;
  const again = send({ kind: "Pause", reason: "manual", present: true }, 0);
  assert.equal(again.events.length, 0);
  assert.equal(state.stateRevision, revision);
  send({ kind: "Resume", pageVisible: true, canvasOperable: true, graphicsAvailable: true }, 100);
  assert.equal(state.clock.countdownRemainingMs, 0);
  const settled = structuredClone(state.bestResults);
  for (let frame = 0; frame < 600; frame++) {
    const tick = send({ kind: "Tick" }, 100);
    assert.equal(tick.events.length, 0);
    assert.equal(tick.stable, false);
  }
  assert.equal(state.clock.activeTimeMs, 15000);
  assert.deepEqual(state.bestResults, settled);
  assert.equal(state.stateRevision, revision);
});
