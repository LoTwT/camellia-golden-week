import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createTheftLayout,
  moveTheft,
  theftSolved,
  theftOccupiedTiles,
} from "../src/core/data-theft.ts";
import type {
  AssemblyTheftDefinition,
  TheftLayout,
  TheftDirection,
} from "../src/core/data-theft.ts";
import {
  createStatic,
  moveStatic,
  resetStatic,
  undoStatic,
  validateStaticState,
} from "../src/core/static-puzzle.ts";
import type { StaticWitness } from "../src/core/static-puzzle.ts";
type StaticAction = StaticWitness["actions"][number];

const directions = [
  ["left", -1, 0],
  ["down", 0, 1],
  ["right", 1, 0],
  ["up", 0, -1],
] as const;
interface Node {
  layout: TheftLayout;
  player: string;
  actions: TheftDirection[];
  paths: Map<string, TheftDirection[]>;
  parents: number[];
}
/** Exhaust all reachable pushes, collapsing only mutually reachable player-only walking states. */
export function analyzeTheftStateSpace(
  definition: AssemblyTheftDefinition,
  selection: { avoidFinalPlayerId?: string } = {},
) {
  const coordinates = new Map(definition.tiles.map((tile) => [`${tile.x},${tile.y}`, tile]));
  const tiles = new Map(definition.tiles.map((tile) => [tile.id, tile]));
  const reach = (player: string, layout: TheftLayout) => {
    const blocked = new Set(theftOccupiedTiles(layout));
    const paths = new Map<string, TheftDirection[]>([[player, []]]),
      queue = [player];
    for (let index = 0; index < queue.length; index++) {
      const tile = tiles.get(queue[index]!)!;
      for (const [direction, dx, dy] of directions) {
        const next = coordinates.get(`${tile.x + dx},${tile.y + dy}`);
        if (!next || next.terrain === "wall" || blocked.has(next.id) || paths.has(next.id))
          continue;
        paths.set(next.id, [...paths.get(tile.id)!, direction]);
        queue.push(next.id);
      }
    }
    return paths;
  };
  const key = (layout: TheftLayout, paths: Map<string, TheftDirection[]>) =>
    JSON.stringify([
      Object.entries(layout.ballTileById).sort(),
      Object.entries(layout.stationTileById).sort(),
      Object.entries(layout.amplifierTileById).sort(),
      Object.entries(layout.assemblyByAmplifierId).sort(),
      [...paths.keys()].sort()[0],
    ]);
  const layout = createTheftLayout(definition),
    paths = reach(definition.startTileId, layout);
  const nodes: Node[] = [
    { layout, player: definition.startTileId, actions: [], paths, parents: [] },
  ];
  const seen = new Map([[key(layout, paths), 0]]),
    success: number[] = [];
  let alternative: Node | undefined;
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]!;
    if (theftSolved(definition, node.layout)) {
      success.push(index);
      if (!selection.avoidFinalPlayerId || node.player !== selection.avoidFinalPlayerId)
        alternative ??= node;
      continue;
    }
    const occupied = new Set(theftOccupiedTiles(node.layout));
    for (const [from, walk] of node.paths)
      for (const [direction, dx, dy] of directions) {
        const tile = tiles.get(from)!,
          destination = coordinates.get(`${tile.x + dx},${tile.y + dy}`);
        if (!destination || !occupied.has(destination.id)) continue;
        const result = moveTheft(definition, node.layout, from, direction);
        if (!result.legal) continue;
        const paths = reach(result.playerTileId, result.layout),
          signature = key(result.layout, paths);
        if (
          !alternative &&
          theftSolved(definition, result.layout) &&
          result.playerTileId !== selection.avoidFinalPlayerId
        )
          alternative = {
            layout: result.layout,
            player: result.playerTileId,
            actions: [...node.actions, ...walk, direction],
            paths,
            parents: [],
          };
        let target = seen.get(signature);
        if (target === undefined) {
          target = nodes.length;
          seen.set(signature, target);
          nodes.push({
            layout: result.layout,
            player: result.playerTileId,
            actions: [...node.actions, ...walk, direction],
            paths,
            parents: [],
          });
        }
        nodes[target]!.parents.push(index);
      }
    assert.ok(
      nodes.length <= 500_000,
      "Analysis must finish exhaustively; reaching the cap is a failure, not a proof",
    );
  }
  assert.ok(alternative);
  const winning = new Set(success),
    pending = [...success];
  for (let index = 0; index < pending.length; index++)
    for (const parent of nodes[pending[index]!]!.parents)
      if (!winning.has(parent)) {
        winning.add(parent);
        pending.push(parent);
      }
  const dead = nodes.find((_, index) => !winning.has(index));
  const snapshot = (node: Node) => ({
    actions: node.actions,
    player: node.player,
    layout: node.layout,
  });
  return {
    definitionId: definition.id,
    completeStateCount: nodes.length,
    winningStateCount: winning.size,
    successStateCount: success.length,
    deadEnd: dead ? snapshot(dead) : null,
    alternative: snapshot(alternative),
  };
}

function record(
  definition: AssemblyTheftDefinition,
  actions: StaticAction[],
  kind: StaticWitness["kind"],
  suffix: string,
  description: string,
): StaticWitness {
  let { state, playerTileId } = createStatic(definition);
  const expectedCodes: StaticWitness["expectedCodes"][number][] = [];
  for (const action of actions) {
    assert.notEqual(action, "activate");
    const result =
      action === "reset"
        ? resetStatic(definition, state, playerTileId)
        : action === "undo"
          ? undoStatic(definition, state, playerTileId)
          : moveStatic(definition, state, playerTileId, action as TheftDirection);
    state = result.state;
    playerTileId = result.playerTileId;
    expectedCodes.push(result.code);
    assert.deepEqual(validateStaticState(definition, state, playerTileId), []);
  }
  assert.equal(state.phase, "complete");
  return {
    id: `${definition.id}.witness.${suffix}`,
    definitionId: definition.id,
    kind,
    description,
    actions,
    expectedCodes,
    expectedPhase: state.phase,
    expectedPlayerTileId: playerTileId,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const mode = process.argv[2];
  assert.ok(
    mode === "--write" || mode === "--check",
    "Explicit --write or read-only --check required",
  );
  const sourcePath = resolve("src/content/challenges/theft-r1.json");
  const evidencePath = resolve("tests/fixtures/r1/theft-state-space.json");
  const source = JSON.parse(readFileSync(sourcePath, "utf8")) as {
    definitions: AssemblyTheftDefinition[];
    witnesses: StaticWitness[];
  };
  const results = source.definitions.map((definition) => analyzeTheftStateSpace(definition));
  const evidence = {
    definitionHash: createHash("sha256").update(JSON.stringify(source.definitions)).digest("hex"),
    ruleHash: createHash("sha256")
      .update(readFileSync(resolve("src/core/data-theft.ts")))
      .digest("hex"),
    method:
      "Exhaustive push-state graph; player reachability components collapsed; reverse reachability from all valid success states; normal moves only",
    results,
  };
  const witnesses = source.definitions.flatMap((definition, index) => {
    const result = results[index]!;
    const success = source.witnesses.find(
      (witness) => witness.definitionId === definition.id && witness.kind === "success",
    )!;
    assert.ok(success);
    const alternate = analyzeTheftStateSpace(definition, {
      avoidFinalPlayerId: success.expectedPlayerTileId,
    }).alternative;
    const failure: StaticAction[] = result.deadEnd?.actions ?? ["up", "left", "left", "up"];
    return [
      success,
      record(
        definition,
        alternate.actions,
        "alternative",
        "alternative",
        "改变组合体推动路线及最后接入方向；最终接口固定，玩家成功站位不同",
      ),
      record(
        definition,
        [...failure, "undo", "reset", ...success.actions],
        result.deadEnd ? "deadEndRecovery" : "failureRecovery",
        "recovery",
        result.deadEnd
          ? "正常滑行/组装进入有限状态图证明的不可解状态，撤销最后事务、重置再实际完成"
          : "全部20个可达机关状态都可解；正常走到不可单推基站并受阻，撤销/重置后实际完成",
      ),
    ];
  });
  if (mode === "--write") {
    writeFileSync(sourcePath, JSON.stringify({ ...source, witnesses }, null, 2) + "\n");
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + "\n");
  } else {
    assert.deepEqual(JSON.parse(readFileSync(evidencePath, "utf8")), evidence);
    assert.deepEqual(source.witnesses, witnesses);
  }
  console.log(
    results
      .map(
        (result) =>
          `${result.definitionId}: ${result.winningStateCount}/${result.completeStateCount} reachable states can solve`,
      )
      .join("\n"),
  );
}
