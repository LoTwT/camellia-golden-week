import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import captureJson from "../src/content/challenges/capture-r1.json" with { type: "json" };
import evidence from "../tests/fixtures/r1/capture-state-space.json" with { type: "json" };
import { captureSolved, moveCapture } from "../src/core/capture.ts";
import type { CaptureDefinition, CaptureLayout } from "../src/core/capture.ts";
import type { TheftDirection } from "../src/core/data-theft.ts";
import {
  createStatic,
  moveStatic,
  undoStatic,
  resetStatic,
  replayStaticWitness,
} from "../src/core/static-puzzle.ts";
import type { StaticWitness } from "../src/core/static-puzzle.ts";

const directions: TheftDirection[] = ["up", "right", "down", "left"];
/** Independent forward search from the concrete claimed dead end, not the initial-state reverse classifier. */
function successReachable(
  definition: CaptureDefinition,
  initial: { playerTileId: string; layout: CaptureLayout },
): boolean {
  const queue = [initial];
  const seen = new Set<string>();
  for (let index = 0; index < queue.length; index++) {
    const node = queue[index]!;
    if (captureSolved(definition, node.layout)) return true;
    for (const direction of directions) {
      const moved = moveCapture(definition, node.layout, node.playerTileId, direction);
      if (!moved.legal) continue;
      const key = JSON.stringify([
        moved.playerTileId,
        definition.cartIds.map((id) => moved.layout.cartTileById[id]),
        definition.bangbooIds.map((id) => moved.layout.bangbooTileById[id] ?? null),
        [...moved.layout.capturedBangbooIds].sort(),
      ]);
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push({ playerTileId: moved.playerTileId, layout: moved.layout });
    }
  }
  return false;
}

test("R1 四张捕获固定图完整枚举与冻结证据逐字段一致；--check 不修改证据", () => {
  const path = new URL("../tests/fixtures/r1/capture-state-space.json", import.meta.url);
  const before = readFileSync(path);
  const result = spawnSync(process.execPath, ["scripts/author-r1-capture-analysis.ts", "--check"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(readFileSync(path), before);
  assert.deepEqual(
    evidence.analyses.map((entry) => [
      entry.reachableStateCount,
      entry.statesReachingSuccess,
      entry.deadEndStateCount,
    ]),
    [
      [872, 494, 378],
      [1636, 892, 744],
      [308, 207, 101],
      [308, 207, 101],
    ],
  );
  for (const entry of evidence.analyses) {
    assert.equal(entry.initialStateSolvable, true);
    assert.equal(entry.reachableStateCount, entry.statesReachingSuccess + entry.deadEndStateCount);
    assert.ok(entry.successStateCount > 0);
  }
});

for (const definition of captureJson.definitions as CaptureDefinition[]) {
  test(`${definition.id}：正常输入到真实死角，独立搜索证明无解，撤销恢复可解，再重置完成`, () => {
    const analysis = evidence.analyses.find((item) => item.definitionId === definition.id)!;
    const deadEnd = analysis.firstDeadEnd!;
    let instance = createStatic(definition);
    for (const direction of deadEnd.actions as TheftDirection[]) {
      const result = moveStatic(definition, instance.state, instance.playerTileId, direction);
      assert.equal(result.legal, true);
      assert.equal(result.success, false);
      instance = { playerTileId: result.playerTileId, state: result.state };
    }
    assert.deepEqual(
      { playerTileId: instance.playerTileId, layout: instance.state.currentLayout.capture },
      deadEnd.state,
    );
    assert.equal(successReachable(definition, deadEnd.state), false);
    const undone = undoStatic(definition, instance.state, instance.playerTileId);
    assert.equal(undone.code, "undone");
    assert.deepEqual(
      { playerTileId: undone.playerTileId, layout: undone.state.currentLayout.capture },
      deadEnd.undoState,
    );
    assert.equal(successReachable(definition, deadEnd.undoState!), true);
    const reset = resetStatic(definition, undone.state, undone.playerTileId);
    assert.deepEqual(
      { playerTileId: reset.playerTileId, state: reset.state },
      createStatic(definition),
    );
    const recovery = captureJson.witnesses.find(
      (w) => w.definitionId === definition.id && w.id.endsWith(".recovery"),
    ) as StaticWitness;
    assert.equal(recovery.kind, "deadEndRecovery");
    assert.deepEqual(recovery.actions.slice(0, deadEnd.actions.length), deadEnd.actions);
    assert.deepEqual(recovery.actions.slice(deadEnd.actions.length, deadEnd.actions.length + 2), [
      "undo",
      "reset",
    ]);
    const success = captureJson.witnesses.find(
      (w) => w.definitionId === definition.id && w.kind === "success",
    )!;
    assert.deepEqual(recovery.actions.slice(deadEnd.actions.length + 2), success.actions);
    const completed = replayStaticWitness(definition, recovery);
    assert.deepEqual(completed.errors, []);
    assert.equal(completed.state.phase, "complete");
    const blocked = analysis.firstBlockedMove!;
    const denied = moveCapture(
      definition,
      blocked.state.layout,
      blocked.state.playerTileId,
      blocked.direction as TheftDirection,
    );
    assert.equal(denied.legal, false);
    assert.equal(denied.reason, blocked.reason);
    assert.deepEqual(denied.layout, blocked.state.layout);
    assert.equal(denied.playerTileId, blocked.state.playerTileId);
  });
}
