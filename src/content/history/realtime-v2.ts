import archive from "./realtime-v2.json" with { type: "json" };
import { expandLegacyRealtime } from "./legacy-realtime-references.ts";
import type { LegacyRealtimeReferences } from "./legacy-realtime-references.ts";

export default expandLegacyRealtime(archive as unknown as LegacyRealtimeReferences);
