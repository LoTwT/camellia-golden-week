/** Explicit authoring only. Neither build nor validation imports or executes this writer. */
import { writeFileSync } from "node:fs";
import { compactWitnessCollection } from "../src/content/witnesses/compact.ts";
import { compactWitnessPrefixes } from "../src/content/witnesses/prefixes.ts";
import { assembleContent, staticContent, realtimeContent } from "../src/content/assemble.ts";
import { frozenContentRelease } from "../src/content/history/frozen-releases.ts";
import {
  createGame as createHistoricalGame,
  dispatch as historicalDispatch,
} from "../src/content/history/pre-r1/engine.ts";
import type {
  GameContent as HistoricalContent,
  GameState as HistoricalState,
} from "../src/content/history/pre-r1/types.ts";
import { createGame, dispatch } from "../src/core/engine.ts";
import { moveCompletedStatic } from "../src/core/static-puzzle.ts";
import type { Direction, GameCommand, GameContent, GameState } from "../src/core/types.ts";
import type { WorldWitness, WorldWitnessStep } from "../src/content/validate.ts";
import m1 from "../src/content/witnesses/m1.ts";
import m2 from "../src/content/witnesses/m2.ts";
import m3 from "../src/content/witnesses/m3.ts";
import m4 from "../src/content/witnesses/m4.ts";

if (process.argv[2] !== "--write" || process.argv.length !== 3)
  throw new Error("Explicit authoring requires --write");
const directions: Direction[] = ["up", "right", "down", "left"];
const active = (state: HistoricalState) =>
  state.activeStatic ?? state.activeRealtime ?? state.activeCompletedRoom;
interface Segment {
  start: number;
  end: number;
  roomId: string;
  completed: boolean;
  destination: string;
}
function segments(witness: WorldWitness): Map<number, Segment> {
  const source = frozenContentRelease(witness.profileId, 1) as unknown as HistoricalContent;
  let state = createHistoricalGame(source, 0);
  let start: number | null = null;
  const result = new Map<number, Segment>();
  for (const [index, step] of witness.steps.entries()) {
    const previous = state;
    state = historicalDispatch(source, state, step.command, step.atMs).state;
    if (!active(previous) && active(state)) start = index;
    if (active(previous) && !active(state)) {
      if (start === null) throw new Error("Historical scene has no start");
      const roomId = active(previous)!.roomId;
      result.set(start, {
        start,
        end: index,
        roomId,
        completed: state.completedObjectiveIds.includes(roomId),
        destination: state.playerPosition.tileId,
      });
      start = null;
    }
  }
  if (start !== null) throw new Error("Historical scene never exited");
  return result;
}
class AuthorSession {
  state: GameState;
  time = 0;
  steps: WorldWitnessStep[] = [];
  readonly content: GameContent;
  constructor(content: GameContent) {
    this.content = content;
    this.state = createGame(content, 0);
  }
  send(command: GameCommand, delay = 140, expected = "accepted") {
    if (delay > 250) this.wait(delay - 140);
    this.time += Math.min(delay, 250);
    const result = dispatch(this.content, this.state, command, this.time);
    if (!expected.split("|").includes(result.code))
      throw new Error(
        `${this.content.profile.id} ${this.state.playerPosition.tileId} ${JSON.stringify(command)} expected ${expected}: ${result.code} ${result.state.lastResult.message}`,
      );
    this.state = result.state;
    this.steps.push({ atMs: this.time, command, expectedCode: result.code });
  }
  wait(durationMs: number) {
    const end = this.time + durationMs;
    while (this.time < end) this.send({ kind: "Tick" }, Math.min(100, end - this.time));
  }
  finishStatic() {
    const roomId = this.state.activeStatic?.roomId;
    const definition = this.content.staticChallenges.find((room) => room.id === roomId);
    const witness = staticContent.witnesses.find(
      (item) => item.definitionId === roomId && item.kind === "success",
    );
    if (!roomId || !definition || !witness) throw new Error(`No static witness: ${roomId}`);
    if (this.state.activeStatic!.state.phase === "preview")
      this.wait(definition.kind === "memory" ? definition.previewMs : 4000);
    for (const action of witness.actions) {
      if (action === "activate") continue;
      if (!this.state.activeStatic)
        throw new Error(`Static witness has actions after success: ${roomId}`);
      this.send(
        action === "undo"
          ? { kind: "Undo" }
          : action === "reset"
            ? { kind: "ResetRoom" }
            : { kind: "Move", direction: action },
        140,
        "accepted|success",
      );
    }
    if (this.state.activeStatic || !this.state.completedObjectiveIds.includes(roomId))
      throw new Error(`Static witness did not finish ${roomId}`);
  }
  finishCompleted() {
    const roomId = this.state.activeCompletedRoom?.roomId;
    const definition = this.content.staticChallenges.find((room) => room.id === roomId);
    const layout = this.state.completedRoomLayouts[roomId!]?.layout;
    if (!definition || !layout) throw new Error(`Missing completed room: ${roomId}`);
    const queue = [{ tile: this.state.playerPosition.tileId, path: [] as Direction[] }];
    const seen = new Set<string>();
    while (queue.length) {
      const next = queue.shift()!;
      for (const direction of directions) {
        const step = moveCompletedStatic(definition, layout, next.tile, direction);
        if (!step.legal) continue;
        const path = [...next.path, direction];
        if (step.exited) {
          for (const move of path) this.send({ kind: "Move", direction: move });
          return;
        }
        if (!seen.has(step.playerTileId)) {
          seen.add(step.playerTileId);
          queue.push({ tile: step.playerTileId, path });
        }
      }
    }
    throw new Error(`Completed board has no actual exit path: ${roomId}`);
  }
  finishRealtime() {
    const roomId = this.state.activeRealtime?.roomId;
    const definition = this.content.realtimeChallenges.find((room) => room.id === roomId);
    const witness = realtimeContent.witnesses.find(
      (item) => item.challengeId === roomId && item.expectedResult === "success",
    );
    if (!definition || !witness) throw new Error(`Missing realtime witness: ${roomId}`);
    this.wait(3000);
    for (const action of witness.commands) {
      if (this.state.mode === "challengeResult") break;
      const elapsed = this.state.activeRealtime!.state.activeTimeMs;
      const delay = action.activeTimeMs - elapsed;
      if (delay < 0) throw new Error(`Realtime witness time reversed: ${roomId}`);
      if (delay > 0) this.wait(Math.max(0, delay - 1));
      this.send(
        action.kind === "move"
          ? { kind: "Move", direction: action.direction }
          : action.kind === "click"
            ? { kind: "ClickTile", tileId: action.tileId }
            : { kind: "Interact" },
        delay > 0 ? 1 : 0,
      );
    }
    let guard = 0;
    while (this.state.mode !== "challengeResult" && guard++ < 2000) this.wait(100);
    if (this.state.phase !== "success")
      throw new Error(`Realtime witness failed: ${roomId} ${this.state.lastResult.message}`);
    this.send({ kind: "ExitRoom" });
  }
  scene(segment: Segment) {
    const roomId = segment.roomId === "c.routing.01" ? "c.capture.01" : segment.roomId;
    const room = this.content.rooms.find((candidate) => candidate.id === roomId)!;
    if (!this.state.activeStatic && !this.state.activeRealtime && !this.state.activeCompletedRoom)
      this.send({ kind: "Interact" });
    if (this.state.activeRealtime) this.finishRealtime();
    else if (
      !segment.completed ||
      (this.state.activeCompletedRoom && segment.destination === room.returnTileId)
    )
      this.send({ kind: "ExitRoom" });
    else if (this.state.activeCompletedRoom) this.finishCompleted();
    else this.finishStatic();
    if (this.state.playerPosition.tileId !== segment.destination)
      throw new Error(
        `Scene ${roomId} exited ${this.state.playerPosition.tileId}, old world continuation requires ${segment.destination}`,
      );
  }
}
function author(source: WorldWitness, profileId = source.profileId): WorldWitness {
  const session = new AuthorSession(assembleContent(profileId));
  const scenes = segments(source);
  for (let index = 0; index < source.steps.length; index++) {
    const step = source.steps[index]!;
    session.send(step.command, 140, step.expectedCode);
    const segment = scenes.get(index);
    if (segment) {
      session.scene(segment);
      index = segment.end;
      if (source.id.includes("full-collection") && segment.roomId.startsWith("c.theft.")) {
        const captureId = `c.capture.0${Number(segment.roomId.at(-1)) + 1}`;
        if (!session.state.completedObjectiveIds.includes(captureId)) {
          session.send({ kind: "Move", direction: "left" });
          session.send({ kind: "Interact" });
          session.finishStatic();
          if (!session.state.completedObjectiveIds.includes(captureId))
            throw new Error(`Missing actual capture ${captureId}`);
          session.send({ kind: "Move", direction: "right" });
        }
      }
    }
  }
  return {
    ...source,
    profileId,
    id: source.id.replace(source.profileId.toLowerCase() + ".", profileId.toLowerCase() + "."),
    contentVersion: session.content.contentVersion,
    ruleVersion: session.content.ruleVersion,
    description: `R1 正常规则命令路线；外层导航顺序来源 ${source.id}，局部机关已独立替换并实际重放当前固定成功见证。`,
    steps: session.steps,
    expected: {
      ...source.expected,
      completedObjectiveIds: [
        ...source.expected.completedObjectiveIds,
        ...(Number(profileId.slice(1)) >= 3
          ? source.id.includes("full-collection")
            ? ["c.capture.01", "c.capture.02", "c.capture.03", "c.capture.04"]
            : ["c.capture.01"]
          : []),
      ],
    },
  };
}
const inputs = [m1, m2, m3, m4].flatMap((item) => item.witnesses as WorldWitness[]);
const witnesses = inputs.map((source) => {
  console.log(`Author ${source.id}`);
  return author(source);
});
for (const source of m4.witnesses as WorldWitness[]) witnesses.push(author(source, "M5"));
writeFileSync(
  new URL("../src/content/witnesses/r1-world.json", import.meta.url),
  JSON.stringify(
    compactWitnessPrefixes(
      compactWitnessCollection({
        authoredFrom: "7fe7d8e world navigation plus R1 fixed puzzle witnesses",
        witnesses,
      }),
    ),
    null,
    2,
  ) + "\n",
);
