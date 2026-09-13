import archive from "./realtime.json" with { type: "json" };
import { expandLegacyRealtime } from "../legacy-realtime-references.ts";
import type { LegacyRealtimeReferences } from "../legacy-realtime-references.ts";

export default expandLegacyRealtime(archive as unknown as LegacyRealtimeReferences);
