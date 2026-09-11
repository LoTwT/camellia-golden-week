import m1 from "./m1.json" with { type: "json" };
import m2 from "./m2.json" with { type: "json" };
import m3 from "./m3.json" with { type: "json" };
import m4 from "./m4.json" with { type: "json" };
import { m5WorldWitnesses } from "./m5.ts";
import type { WorldWitness } from "../validate.ts";
import { currentWorldWitness } from "./current.ts";

export const worldWitnesses = [
  ...(m1.witnesses as WorldWitness[]).map(currentWorldWitness),
  ...(m2.witnesses as WorldWitness[]).map(currentWorldWitness),
  ...(m3.witnesses as WorldWitness[]).map(currentWorldWitness),
  ...(m4.witnesses as WorldWitness[]).map(currentWorldWitness),
  ...m5WorldWitnesses,
] as WorldWitness[];
