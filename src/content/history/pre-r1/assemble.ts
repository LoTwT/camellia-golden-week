import { frozenContentRelease } from "../frozen-releases.ts";
import staticJson from "./static.json" with { type: "json" };
import realtimeJson from "../realtime-v1.json" with { type: "json" };
import type { StaticContent } from "./static-puzzle.ts";
import type { RealtimeDefinition, RealtimeWitness } from "./realtime.ts";
import type { GameContent, ProfileId } from "./types.ts";

/** Historical test adapter: old rules and old content remain an independent pair. */
export const assembleLegacyContent = (profileId: ProfileId): GameContent =>
  frozenContentRelease(profileId, 1) as unknown as GameContent;
export const staticContent = staticJson as unknown as StaticContent;
export const legacyRealtimeContent = realtimeJson as unknown as {
  definitions: RealtimeDefinition[];
  witnesses: RealtimeWitness[];
  contentVersion: number;
  ruleVersion: number;
};
