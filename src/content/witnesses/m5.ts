import m4 from "./m4.ts";
import type { WorldWitness } from "../validate.ts";
import { currentWorldWitness } from "./current.ts";

// M5 retains M4 gameplay content; historical raw commands are retimed once for the current chart.
export const m5WorldWitnesses = m4.witnesses.map((witness) => ({
  ...currentWorldWitness(witness as WorldWitness),
  id: witness.id.replace("m4.", "m5."),
  profileId: "M5",
  description: `${witness.description} M5沿用M4固定内容与同一条公开命令路径。`,
})) as WorldWitness[];
