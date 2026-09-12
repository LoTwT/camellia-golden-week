import type { PlayerPosition } from "../../core/types.ts";

const world = (areaId: PlayerPosition["areaId"], tileId: string): PlayerPosition => ({
  space: "world",
  areaId,
  boardId: areaId,
  tileId,
});

/** Reviewed R1 safety registration; changing a world anchor requires updating this table. */
export const r1RoomLayoutMappings = {
  "a.maze.01": {
    kind: "archive",
    targetRoomId: "a.maze.01",
    objectiveId: "a.maze.01",
    safeEntrance: world("a", "a.t.3.0"),
    successExit: world("a", "a.t.5.0"),
  },
  "a.maze.02": {
    kind: "archive",
    targetRoomId: "a.maze.02",
    objectiveId: "a.maze.02",
    safeEntrance: world("a", "a.t.1.-2"),
    successExit: world("a", "a.t.1.-4"),
  },
  "a.maze.03": {
    kind: "archive",
    targetRoomId: "a.maze.03",
    objectiveId: "a.maze.03",
    safeEntrance: world("a", "a.t.1.2"),
    successExit: world("a", "a.t.1.4"),
  },
  "b.line.01": {
    kind: "archive",
    targetRoomId: "b.line.01",
    objectiveId: "b.line.01",
    safeEntrance: world("b", "b.t.1.0"),
    successExit: world("b", "b.t.3.0"),
  },
  "b.line.02": {
    kind: "archive",
    targetRoomId: "b.line.02",
    objectiveId: "b.line.02",
    safeEntrance: world("b", "b.t.0.-2"),
    successExit: world("b", "b.t.0.-4"),
  },
  "c.routing.01": {
    kind: "archive",
    targetRoomId: null,
    objectiveId: "c.routing.01",
    safeEntrance: world("c", "c.t.1.0"),
    successExit: world("c", "c.t.3.0"),
  },
  "c.theft.01": {
    kind: "archive",
    targetRoomId: "c.theft.01",
    objectiveId: "c.theft.01",
    safeEntrance: world("c", "c.t.-2.-2"),
    successExit: world("c", "c.t.-2.-2"),
  },
  "c.theft.02": {
    kind: "archive",
    targetRoomId: "c.theft.02",
    objectiveId: "c.theft.02",
    safeEntrance: world("c", "c.t.-4.-2"),
    successExit: world("c", "c.t.-4.-2"),
  },
  "c.theft.03": {
    kind: "archive",
    targetRoomId: "c.theft.03",
    objectiveId: "c.theft.03",
    safeEntrance: world("c", "c.t.-6.-2"),
    successExit: world("c", "c.t.-6.-2"),
  },
} as const;
