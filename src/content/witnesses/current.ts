import r1 from "./r1-world.ts";
import type { WorldWitness } from "../validate.ts";

/** Returns authored, frozen R1 commands. Validation and builds never regenerate a route. */
export function currentWorldWitness(source: WorldWitness): WorldWitness {
  const witness = r1.witnesses.find(
    (candidate) => candidate.id === source.id && candidate.profileId === source.profileId,
  );
  if (!witness) throw new Error(`缺少已冻结 R1 世界见证：${source.id}`);
  return structuredClone(witness) as WorldWitness;
}
