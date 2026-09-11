import m1 from "./m1.json" with { type: "json" };
import m2 from "./m2.json" with { type: "json" };
import m3 from "./m3.json" with { type: "json" };
import m4 from "./m4.json" with { type: "json" };
import { m5WorldWitnesses } from "./m5.ts";
import type { WorldWitness } from "../validate.ts";

export const worldWitnesses = [
  ...m1.witnesses,
  ...m2.witnesses,
  ...m3.witnesses,
  ...m4.witnesses,
  ...m5WorldWitnesses,
] as WorldWitness[];
