import archive from "./static.json" with { type: "json" };
import { expandLegacyStatic } from "../legacy-static-references.ts";
import type { LegacyStaticReferences } from "../legacy-static-references.ts";

export default expandLegacyStatic(archive as unknown as LegacyStaticReferences);
