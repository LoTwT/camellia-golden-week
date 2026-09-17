/** Exhaustive rule analysis. Writes evidence only with an explicit --write invocation. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  captureSolved,
  createCaptureLayout,
  moveCapture,
  validateCaptureLayout,
} from "../src/core/capture.ts";
import type { CaptureDefinition, CaptureLayout } from "../src/core/capture.ts";
import type { TheftDirection } from "../src/core/data-theft.ts";

const directions: TheftDirection[] = ["up", "right", "down", "left"];
interface Node {
  playerTileId: string;
  layout: CaptureLayout;
  previous: number | null;
  action: TheftDirection | null;
  edges: Array<{ action: TheftDirection; to: number }>;
}
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
function key(definition: CaptureDefinition, node: Pick<Node, "playerTileId" | "layout">) {
  return JSON.stringify([
    node.playerTileId,
    definition.cartIds.map((id) => node.layout.cartTileById[id]),
    definition.bangbooIds.map((id) => node.layout.bangbooTileById[id] ?? null),
    [...node.layout.capturedBangbooIds].sort(),
  ]);
}
export function analyzeCapture(definition: CaptureDefinition) {
  const nodes: Node[] = [
    {
      playerTileId: definition.startTileId,
      layout: createCaptureLayout(definition),
      previous: null,
      action: null,
      edges: [],
    },
  ];
  const known = new Map([[key(definition, nodes[0]!), 0]]);
  const reverse: number[][] = [[]];
  const terminals: number[] = [];
  let blockedMoveCount = 0;
  let firstBlocked: { node: number; direction: TheftDirection; reason: string } | null = null;
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]!;
    assert.deepEqual(validateCaptureLayout(definition, node.layout, node.playerTileId), []);
    // Actual static gameplay exits immediately on success; terminal moves do not exist.
    if (captureSolved(definition, node.layout)) {
      terminals.push(index);
      continue;
    }
    for (const direction of directions) {
      const next = moveCapture(definition, node.layout, node.playerTileId, direction);
      if (!next.legal) {
        blockedMoveCount++;
        firstBlocked ??= { node: index, direction, reason: next.reason };
        continue;
      }
      const id = key(definition, next);
      let target = known.get(id);
      if (target === undefined) {
        target = nodes.length;
        known.set(id, target);
        nodes.push({
          playerTileId: next.playerTileId,
          layout: next.layout,
          previous: index,
          action: direction,
          edges: [],
        });
        reverse.push([]);
      }
      node.edges.push({ action: direction, to: target });
      reverse[target]!.push(index);
    }
  }
  const solvable = new Set(terminals);
  const queue = [...terminals];
  for (let index = 0; index < queue.length; index++)
    for (const previous of reverse[queue[index]!]!)
      if (!solvable.has(previous)) {
        solvable.add(previous);
        queue.push(previous);
      }
  const deadEnds = nodes.flatMap((_, index) => (solvable.has(index) ? [] : [index]));
  const path = (id: number) => {
    const result: TheftDirection[] = [];
    for (let cursor = nodes[id]!; cursor.previous !== null; cursor = nodes[cursor.previous]!)
      result.push(cursor.action!);
    return result.reverse();
  };
  const snapshot = (id: number) => ({
    playerTileId: nodes[id]!.playerTileId,
    layout: nodes[id]!.layout,
  });
  return {
    definitionId: definition.id,
    definitionSha256: sha256(JSON.stringify(definition)),
    reachableStateCount: nodes.length,
    legalTransitionCount: nodes.reduce((sum, node) => sum + node.edges.length, 0),
    blockedMoveCount,
    successStateCount: terminals.length,
    statesReachingSuccess: solvable.size,
    deadEndStateCount: deadEnds.length,
    initialStateSolvable: solvable.has(0),
    graphSha256: sha256(JSON.stringify(nodes.map((node) => [key(definition, node), node.edges]))),
    shortestSuccess: terminals.length
      ? { actions: path(terminals[0]!), state: snapshot(terminals[0]!) }
      : null,
    firstDeadEnd: deadEnds.length
      ? {
          actions: path(deadEnds[0]!),
          state: snapshot(deadEnds[0]!),
          undoRestoresSolvableState:
            nodes[deadEnds[0]!]!.previous !== null && solvable.has(nodes[deadEnds[0]!]!.previous!),
          undoState:
            nodes[deadEnds[0]!]!.previous !== null
              ? snapshot(nodes[deadEnds[0]!]!.previous!)
              : null,
        }
      : null,
    firstBlockedMove: firstBlocked
      ? {
          actions: path(firstBlocked.node),
          direction: firstBlocked.direction,
          reason: firstBlocked.reason,
          state: snapshot(firstBlocked.node),
        }
      : null,
  };
}
export function captureAnalysisEvidence() {
  const source = JSON.parse(
    readFileSync(new URL("../src/content/challenges/capture-r1.json", import.meta.url), "utf8"),
  ) as { definitions: CaptureDefinition[] };
  return {
    formatVersion: 1,
    ruleVersion: 4,
    captureRuleSha256: sha256(
      readFileSync(new URL("../src/core/capture.ts", import.meta.url), "utf8"),
    ),
    method:
      "Breadth-first enumeration from the authored initial state through moveCapture; successful captures are terminal. Node identity includes player, named carts, named uncaptured bangboo positions and the sorted captured IDs. Undo/reset are excluded. Reverse reachability from every successful terminal classifies every reachable node.",
    directionOrder: directions,
    analyses: source.definitions.map(analyzeCapture),
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  if (process.argv.length !== 3 || (mode !== "--write" && mode !== "--check"))
    throw new Error("Use --write to author evidence or --check for read-only verification");
  const path = new URL("../tests/fixtures/r1/capture-state-space.json", import.meta.url);
  const evidence = captureAnalysisEvidence();
  if (mode === "--write") writeFileSync(path, JSON.stringify(evidence, null, 2) + "\n");
  else assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), evidence);
  for (const entry of evidence.analyses)
    console.log(
      `${entry.definitionId}: ${entry.reachableStateCount} reachable, ${entry.statesReachingSuccess} can reach success, ${entry.deadEndStateCount} dead-end states`,
    );
}
