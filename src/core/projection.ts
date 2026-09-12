import { entitiesAt, tileCleared } from "./engine.ts";
import {
  firewallAlarmContacts,
  firewallDangerTileIds,
  firewallWarningTileIds,
  ghostTileIds,
} from "./realtime.ts";
import { firewallFeedback } from "./firewall-feedback.ts";
import type { FirewallJudgment } from "./firewall-feedback.ts";
import type { RealtimeDirection } from "./realtime.ts";
import { gateOpen } from "./progress.ts";
import { completedStaticExitTileId } from "./static-puzzle.ts";
import type { GameContent, GameState } from "./types.ts";

export interface ScreenTile {
  id: string;
  x: number;
  y: number;
  known: boolean;
  color: string;
  icon: string | null;
  label: string;
  mark: string;
  player: boolean;
  visited: boolean;
  hazardPhase?: "active" | "warning";
  hazardDirections?: readonly RealtimeDirection[];
}
export interface BoardProjection {
  id: string;
  tiles: ScreenTile[];
  focus: { x: number; y: number };
  local: boolean;
  firewall?: { combo: number; judgment: FirewallJudgment };
}
const COLORS = {
  floor: "#363345",
  unknown: "#17181e",
  ether: "#594648",
  danger: "#ca6684",
  reward: "#d7cc83",
  data: "#6bb5c4",
  terminal: "#bccc90",
  portal: "#6986ab",
  player: "#e2e1dc",
};

export function projectBoard(content: GameContent, state: GameState): BoardProjection {
  const position = state.playerPosition;
  let tiles: ScreenTile[] = [];
  if (position.space === "world") {
    tiles = content.tiles
      .filter(
        (tile) => tile.boardId === position.boardId && state.discoveredTileIds.includes(tile.id),
      )
      .map((tile) => {
        const cleared = tileCleared(content, state, tile.id);
        const entity = entitiesAt(content, tile.id)[0];
        let color = cleared ? COLORS.floor : COLORS.ether;
        let icon: string | null = cleared ? null : "enrichment-ready";
        let label = cleared ? "道路" : "以太覆盖";
        if (entity && cleared) {
          label = entity.label;
          const ready = gateOpen(content, state, entity.gateId);
          if (entity.kind === "amplifier") {
            icon = "enrichment-ready";
            color = COLORS.terminal;
          }
          if (entity.kind === "nexus") {
            icon = state.clearedEtherNodeIds.includes(entity.id)
              ? "enrichment-used"
              : "enrichment-ready";
            color = COLORS.terminal;
          }
          if (entity.kind === "supply") {
            icon = state.claimedRewardIds.includes(entity.params.rewardId)
              ? "supply-collected"
              : "supply-ready";
            color = ready ? COLORS.reward : COLORS.floor;
          }
          if (entity.kind === "data") {
            icon = state.completedObjectiveIds.includes(entity.params.objectiveId)
              ? "data-collected"
              : "data-ready";
            color = COLORS.data;
          }
          if (entity.kind === "checkpoint" || entity.kind === "teleport") {
            icon = ready ? "portal-ready" : "portal-locked";
            color = COLORS.portal;
          }
          if (entity.kind === "door") {
            icon = ready ? "door-open" : "door-closed";
            color = ready ? COLORS.floor : "#ad9768";
          }
          if (
            entity.kind === "terminal" ||
            entity.kind === "switch" ||
            entity.kind === "observer"
          ) {
            icon = entity.kind === "observer" ? "observation" : "terminal-ready";
            color = COLORS.terminal;
            const effect = content.effects.find((item) => item.id === entity.effectBundleId);
            if (
              effect?.completeObjectiveIds.every((id) => state.completedObjectiveIds.includes(id))
            )
              icon = "terminal-complete";
          }
          if (entity.kind === "challengeAccess") {
            icon = entity.id.startsWith("a.") ? "firewall" : "antivirus";
            color = COLORS.danger;
          }
          if (entity.kind === "roomEntrance") {
            icon = state.completedObjectiveIds.includes(entity.params.roomId)
              ? "terminal-complete"
              : entity.params.roomId.includes("maze")
                ? "observation"
                : "terminal-ready";
            color = COLORS.terminal;
            if (state.completedRoomLayouts[entity.params.roomId])
              label = `${entity.label} · 已完成布局`;
          }
          if (entity.kind === "unavailable") {
            icon = "portal-locked";
            color = COLORS.unknown;
          }
        }
        return {
          id: tile.id,
          x: tile.x,
          y: tile.y,
          known: true,
          color,
          icon,
          label,
          mark: "",
          player: tile.id === position.tileId,
          visited: state.visitedTileIds.includes(tile.id),
        };
      });
    const fringe = content.tiles.filter(
      (tile) =>
        tile.boardId === position.boardId &&
        !state.discoveredTileIds.includes(tile.id) &&
        !tile.hiddenGroupId &&
        tiles.some((known) => Math.abs(known.x - tile.x) + Math.abs(known.y - tile.y) === 1),
    );
    tiles.push(
      ...fringe.map((tile) => ({
        id: tile.id,
        x: tile.x,
        y: tile.y,
        known: false,
        color: COLORS.unknown,
        icon: "unknown",
        label: "未发现",
        mark: "",
        player: false,
        visited: false,
      })),
    );
  } else if (state.activeStatic || state.activeCompletedRoom) {
    const roomId = state.activeStatic?.roomId ?? state.activeCompletedRoom!.roomId;
    const completed = state.activeCompletedRoom !== null;
    const layout = state.activeStatic?.state.currentLayout ?? state.completedRoomLayouts[roomId];
    const definition = content.staticChallenges.find((candidate) => candidate.id === roomId);
    if (definition && layout)
      tiles = definition.tiles.map((tile) => {
        let color = tile.terrain === "wall" ? "#121318" : COLORS.floor;
        let icon: string | null = null;
        let label = tile.terrain === "wall" ? "墙" : "道路";
        let mark = "";
        if (definition.kind === "memory") {
          if (
            state.activeStatic?.state.phase === "preview" &&
            definition.hazardTileIds.includes(tile.id)
          ) {
            color = COLORS.danger;
            icon = "hazard-active";
            label = "危险格";
          }
          if (tile.id === definition.exitTileId) {
            icon = "portal-ready";
            color = COLORS.portal;
            label = "出口";
          }
        }
        if (definition.kind === "oneStroke") {
          if (layout.visitedTileIds.includes(tile.id)) {
            color = "#70764b";
            mark = "•";
          }
          if (definition.endTileId === tile.id) {
            icon = "portal-ready";
            label = "终点";
          }
        }
        if (definition.kind === "routing") {
          const station = Object.entries(definition.stationTileById).find(
            ([, id]) => id === tile.id,
          );
          if (station) {
            icon = "station";
            mark = String(definition.stationIds.indexOf(station[0]) + 1);
            color = COLORS.data;
            label = `基站 ${mark}`;
          }
          const object = Object.entries(layout.objectTileById).find(([, id]) => id === tile.id);
          if (object) {
            icon = definition.ballIds.includes(object[0]) ? "signal-ball" : "cart";
            if (definition.ballIds.includes(object[0])) {
              mark = String(
                definition.stationIds.indexOf(definition.targetStationByBallId[object[0]]!) + 1,
              );
              label = `信号球 ${mark}`;
            } else label = "推车";
          }
        }
        if (definition.kind === "theft") {
          const slot = Object.entries(definition.socketTileById).find(([, id]) => id === tile.id);
          const object = Object.entries(layout.objectTileById).find(([, id]) => id === tile.id);
          const colorId = object
            ? definition.colorByObjectId[object[0]]
            : slot
              ? definition.colorBySocketId[slot[0]]
              : undefined;
          if (colorId) {
            mark = { cyan: "A", magenta: "B", amber: "C" }[colorId];
            color = { cyan: "#6ab7cb", magenta: "#c887ab", amber: "#d0b473" }[colorId];
            icon = object ? "data-object" : "socket";
            label = object ? `对象 ${mark}` : `接收槽 ${mark}`;
          }
        }
        if (completed && tile.id === completedStaticExitTileId(definition)) {
          icon = "portal-ready";
          color = COLORS.portal;
          label = "已完成房间出口";
        } else if (completed && tile.terrain === "floor") {
          label = Object.values(layout.objectTileById).includes(tile.id)
            ? `${label} · 保留完成位置`
            : `${label} · 可自由通行`;
        }
        return {
          id: tile.id,
          x: tile.x,
          y: tile.y,
          known: true,
          color,
          icon,
          label,
          mark,
          player: tile.id === position.tileId,
          visited: layout.visitedTileIds.includes(tile.id),
        };
      });
  } else if (state.activeRealtime) {
    const definition = content.realtimeChallenges.find(
      (candidate) => candidate.id === state.activeRealtime?.roomId,
    );
    const active = state.activeRealtime.state;
    const alarms =
      definition?.kind === "firewall"
        ? firewallAlarmContacts(definition, state.clock.activeTimeMs)
        : [];
    const dangerIds = new Set(
      definition?.kind === "firewall"
        ? firewallDangerTileIds(definition, state.clock.activeTimeMs)
        : [],
    );
    const warningIds = new Set(
      definition?.kind === "firewall"
        ? firewallWarningTileIds(definition, state.clock.activeTimeMs)
        : [],
    );
    if (definition)
      tiles = definition.tiles.map((tile) => {
        let color = COLORS.floor;
        let icon: string | null = null;
        let label = "挑战格";
        let hazardPhase: "active" | "warning" | null = null;
        if (definition.kind === "firewall" && dangerIds.has(tile.id)) {
          color = COLORS.danger;
          icon = "hazard-active";
          label = "警报标记 · 触碰扣 5 连击";
          hazardPhase = "active";
        } else if (definition.kind === "firewall" && warningIds.has(tile.id)) {
          icon = "hazard-active";
          label = "即将出现危险格";
          hazardPhase = "warning";
        }
        if (definition.kind === "antivirus" && active.kind === "antivirus") {
          const target = definition.rules.spawns.find(
            (spawn) => spawn.tileId === tile.id && active.activeTargetIds.includes(spawn.id),
          );
          if (target) {
            icon = `target-${target.kind}`;
            color =
              target.kind === "blue"
                ? COLORS.data
                : target.kind === "purple"
                  ? COLORS.danger
                  : COLORS.reward;
            label = target.kind === "star" ? "星星 · 清除所有活跃普通目标" : "待清除数据";
          }
        }
        if (definition.kind === "ghosts" && active.kind === "ghosts") {
          const lamp = definition.rules.lamps.find((candidate) => candidate.tileId === tile.id);
          if (lamp) {
            const lit = active.litLampIds.includes(lamp.id);
            icon = lit ? "lamp-lit" : "lamp-unlit";
            color = lit ? COLORS.reward : "#302d3d";
            label = lit ? "已点亮的灯" : "未点亮的灯";
          }
          if (Object.values(ghostTileIds(definition, active)).includes(tile.id)) {
            icon = "ghost";
            color = "#242232";
            label = "幽灵";
          }
          if (definition.rules.exitTileId === tile.id) {
            icon = "portal-ready";
            label = "安全出口";
          }
        }
        const approaches = [
          ...new Set(
            alarms
              .filter(
                (alarm) =>
                  alarm.tileIds.includes(tile.id) || alarm.warningTileIds.includes(tile.id),
              )
              .map((alarm) => alarm.approachFrom),
          ),
        ];
        const directionLabels = { up: "上", right: "右", down: "下", left: "左" };
        const directionMarks = { up: "↑", right: "→", down: "↓", left: "←" };
        if (approaches.length)
          label += ` · 来自${approaches.map((direction) => directionLabels[direction]).join(" / ")}，迎向来处踩拍可闪避`;
        return {
          id: tile.id,
          x: tile.x,
          y: tile.y,
          known: true,
          color,
          icon,
          label,
          mark:
            definition.kind === "firewall"
              ? approaches.length
                ? approaches.map((direction) => directionMarks[direction]).join("")
                : label === "即将出现危险格"
                  ? "!"
                  : state.settings.reducedFlash && icon === "hazard-active"
                    ? "×"
                    : ""
              : "",
          player: tile.id === position.tileId,
          visited: false,
          ...(hazardPhase ? { hazardPhase, hazardDirections: approaches } : {}),
        };
      });
  }
  const player = tiles.find((tile) => tile.player);
  return {
    id: position.boardId,
    tiles,
    focus: { x: player?.x ?? 0, y: player?.y ?? 0 },
    local: position.space === "room",
    ...(state.activeRealtime?.state.kind === "firewall"
      ? {
          firewall: {
            combo: state.activeRealtime.state.combo,
            judgment:
              state.mode === "challengeRunning"
                ? firewallFeedback(state.activeRealtime.state, state.clock).judgment
                : null,
          },
        }
      : {}),
  };
}
