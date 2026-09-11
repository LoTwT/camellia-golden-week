import type { CompletedStaticLayout, StaticDefinition, StaticState } from "./static-puzzle.ts";
import type { RealtimeDefinition, RealtimeState } from "./realtime.ts";
import type { ClockState } from "./clock.ts";

export type AreaId = "hub" | "a" | "b" | "c" | "d" | "warehouse";
export type ProfileId = "M1" | "M2" | "M3" | "M4" | "M5";
export type Direction = "up" | "right" | "down" | "left";
export type GateCondition =
  | { kind: "always" }
  | { kind: "objective"; objectiveId: string }
  | { kind: "capability"; capabilityId: "amplifier" | "unlimitedAmplifier" }
  | { kind: "all"; conditions: GateCondition[] }
  | { kind: "areaDataComplete"; areaId: "a" | "b" | "c" | "d" };
export interface TileDefinition {
  id: string;
  boardId: string;
  x: number;
  y: number;
  terrain: "floor" | "wall";
  initialDiscovery: boolean;
  etherGroupId: string | null;
  hiddenGroupId: string | null;
  overlayIds: string[];
  includedFrom: number;
}
interface EntityBase {
  id: string;
  tileId: string;
  gateId: string;
  effectBundleId: string | null;
  sourceRecordIds: string[];
  label: string;
  includedFrom: number;
}
export type EntityDefinition = EntityBase &
  (
    | { kind: "amplifier"; params: { completionObjectiveId: string } }
    | {
        kind: "nexus";
        params: {
          clearsTileIds: string[];
          revealsGroupIds: string[];
          capabilityRequired: "amplifier";
          completionObjectiveId: string;
        };
      }
    | {
        kind: "terminal" | "switch" | "observer";
        params: {
          interactionMode: "interact";
          prerequisites: GateCondition;
          effectBundleId: string;
        };
      }
    | { kind: "door"; params: { closedBlocksMovement: boolean; lockedReasonKey: string } }
    | { kind: "supply"; params: { rewardId: string } }
    | { kind: "data"; params: { objectiveId: string } }
    | {
        kind: "teleport";
        params: {
          destinationAreaId: AreaId;
          destinationTileId: string;
          activationObjectiveId: string | null;
        };
      }
    | { kind: "checkpoint"; params: { teleportId: string } }
    | { kind: "roomEntrance"; params: { roomId: string; interactionMode: "enter" | "interact" } }
    | { kind: "challengeAccess"; params: { challengeIds: string[] } }
    | { kind: "unavailable"; params: { message: string } }
  );
export interface AreaDefinition {
  id: AreaId;
  label: string;
  subtitle: string;
  statsAreaId: Exclude<AreaId, "warehouse">;
  tileIds: string[];
  roomIds: string[];
  entryTileId: string;
  teleportId: string;
  entityIds: string[];
  revealGroups: { id: string; tileIds: string[] }[];
  sourceRecordIds: string[];
  includedFrom: number;
}
export interface ObjectiveDefinition {
  id: string;
  kind: "route" | "puzzle" | "terminal" | "challenge" | "aggregate" | "ending";
  producer: string;
  prerequisites: GateCondition;
  includedFrom: number;
}
export interface RewardDefinition {
  id: string;
  statsAreaId: Exclude<AreaId, "warehouse">;
  units: number;
  claimMode: "pickup" | "grant";
  producerId: string;
  prerequisites: GateCondition;
  includedFrom: number;
}
export interface DataNodeDefinition {
  id: string;
  areaId: "a" | "b" | "c" | "d";
  weight: number;
  completionObjectiveId: string;
  includedFrom: number;
}
export interface EffectBundle {
  id: string;
  completeObjectiveIds: string[];
  grantRewardIds: string[];
  revealGroupIds: string[];
  clearEtherTileIds: string[];
}
export interface RoomDefinition {
  id: string;
  areaId: AreaId;
  boardId: string;
  mode: "staticPuzzle" | "challengeRunning";
  worldEntranceTileId: string;
  entryTileId: string;
  returnTileId: string;
  successExitTileId: string;
  resetState: string;
  goal: string;
  effectBundleId: string;
  witnessIds: string[];
  includedFrom: number;
}
export interface ReleaseProfile {
  id: ProfileId;
  includedAreaIds: AreaId[];
  includedRoomIds: string[];
  includedObjectiveIds: string[];
  includedRewardIds: string[];
  scopeTerminalObjectiveId: string;
  fullCampaign: boolean;
}
export interface SourceRecord {
  id: string;
  urlOrPath: string;
  locator: string;
  checkedAt: string;
  evidenceLevel: "reconstruction" | "measured" | "reference";
  supportedClaim: string;
  limitation: string;
  adaptedElementIds: string[];
}
export interface WorldDefinition {
  gameId: "camellia-golden-week";
  contentVersion: number;
  ruleVersion: number;
  areaIds: AreaId[];
  entry: { areaId: AreaId; tileId: string };
  objectives: ObjectiveDefinition[];
  dataNodes: DataNodeDefinition[];
  rewards: RewardDefinition[];
  gates: { id: string; condition: GateCondition; reason: string }[];
  releaseProfiles: ReleaseProfile[];
  areas: AreaDefinition[];
  tiles: TileDefinition[];
  entities: EntityDefinition[];
  effects: EffectBundle[];
  rooms: RoomDefinition[];
  sources: SourceRecord[];
}
export interface GameContent extends WorldDefinition {
  profile: ReleaseProfile;
  staticChallenges: StaticDefinition[];
  realtimeChallenges: RealtimeDefinition[];
  catalogDataNodes: DataNodeDefinition[];
  catalogRewards: RewardDefinition[];
  catalogObjectives: ObjectiveDefinition[];
}
export interface PlayerPosition {
  space: "world" | "room";
  areaId: AreaId;
  boardId: string;
  tileId: string;
}
export interface GameSettings {
  masterVolume: number;
  muted: boolean;
  reducedFlash: boolean;
  reducedMotion: boolean;
  quality: "standard" | "low";
  zoom: number;
}
export interface BestResult {
  challengeId: string;
  ruleVersion: number;
  bestScore?: number;
  bestCombo?: number;
  bestStarClear?: number;
}
export interface ProgressState {
  gameId: "camellia-golden-week";
  schemaVersion: number;
  contentVersion: number;
  ruleVersion: number;
  releaseProfileId: ProfileId;
  completedObjectiveIds: string[];
  completedRoomLayouts: Record<string, CompletedStaticLayout>;
  claimedRewardIds: string[];
  activatedTeleportIds: string[];
  capabilities: ("amplifier" | "unlimitedAmplifier")[];
  playerPosition: PlayerPosition;
  discoveredTileIds: string[];
  visitedTileIds: string[];
  clearedEtherNodeIds: string[];
  revealedGroupIds: string[];
  bestResults: BestResult[];
  scopeCompletionHistory: ProfileId[];
  campaignCompletedAt: string | null;
  settings: GameSettings;
  stateRevision: number;
}
export interface ActiveStaticRoom {
  roomId: string;
  returnAnchor: PlayerPosition;
  state: StaticState;
  practice: boolean;
}
export interface ActiveRealtimeRoom {
  roomId: string;
  returnAnchor: PlayerPosition;
  state: RealtimeState;
  practice: boolean;
}
export interface ActiveCompletedRoom {
  roomId: string;
  returnAnchor: PlayerPosition;
}
export type GameMode =
  | "explore"
  | "staticPuzzle"
  | "completedRoom"
  | "challengeReady"
  | "challengeRunning"
  | "challengeResult"
  | "transition";
export interface GameState extends ProgressState {
  mode: GameMode;
  phase: string;
  clock: ClockState;
  activeStatic: ActiveStaticRoom | null;
  activeCompletedRoom: ActiveCompletedRoom | null;
  activeRealtime: ActiveRealtimeRoom | null;
  autoPath: string[];
  feedbackSequence: number;
  lastResult: { code: string; message: string };
  resumeHint: { kind: "restartChallenge"; challengeId: string } | null;
}
export type GameCommand =
  | { kind: "Move"; direction: Direction }
  | { kind: "ClickTile"; tileId: string }
  | {
      kind:
        | "Interact"
        | "Amplify"
        | "Undo"
        | "ResetRoom"
        | "RetryChallenge"
        | "ExitRoom"
        | "PracticeRoom";
    }
  | { kind: "StartChallenge"; challengeId: string }
  | { kind: "Teleport"; teleportId: string }
  | {
      kind: "Pause";
      reason: "manual" | "hidden" | "blur" | "clockGap" | "graphicsLost";
      present: boolean;
    }
  | { kind: "Resume"; pageVisible: boolean; canvasOperable: boolean; graphicsAvailable: boolean }
  | { kind: "Settings"; settings: GameSettings }
  | { kind: "Tick" };
export interface FeedbackEvent {
  id: number;
  kind:
    | "move"
    | "invalid"
    | "pickup"
    | "score"
    | "reveal"
    | "amplify"
    | "door"
    | "success"
    | "failure"
    | "portal";
  message: string;
}
export interface RuleResult {
  state: GameState;
  code: string;
  events: FeedbackEvent[];
  stable: boolean;
  clearInputs: boolean;
}
