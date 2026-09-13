import m1 from "./m1.ts";
import m2 from "./m2.ts";
import m3 from "./m3.ts";
import m4 from "./m4.ts";
import { m5WorldWitnesses } from "./m5.ts";
import type { WorldWitness } from "../validate.ts";
import { currentWorldWitness } from "./current.ts";
import { v2WorldWitness } from "./v2.ts";

export const v2WorldWitnesses = [
  ...[m1, m2, m3, m4].flatMap((source) => (source.witnesses as WorldWitness[]).map(v2WorldWitness)),
  ...(m4.witnesses as WorldWitness[]).map((witness) => ({
    ...v2WorldWitness(witness),
    id: witness.id.replace("m4.", "m5."),
    profileId: "M5" as const,
  })),
];

export const worldWitnesses = [
  ...(m1.witnesses as WorldWitness[]).map(currentWorldWitness),
  ...(m2.witnesses as WorldWitness[]).map(currentWorldWitness),
  ...(m3.witnesses as WorldWitness[]).map(currentWorldWitness),
  ...(m4.witnesses as WorldWitness[]).map(currentWorldWitness),
  ...m5WorldWitnesses,
] as WorldWitness[];
