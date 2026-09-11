import m4 from "./m4.json" with { type: "json" };
import type { WorldWitness } from "../validate.ts";

// M5 retains content4/rule1: commands and expected gameplay results have one source.
export const m5WorldWitnesses = m4.witnesses.map((witness) => ({
  ...witness,
  id: witness.id.replace("m4.", "m5."),
  profileId: "M5",
  description: `${witness.description} M5沿用M4固定内容与同一条公开命令路径。`,
})) as WorldWitness[];
