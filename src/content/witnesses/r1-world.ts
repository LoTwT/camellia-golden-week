import compact from "./r1-world.json" with { type: "json" };
import { expandWitnessCollection } from "./compact.ts";
import { expandWitnessPrefixes } from "./prefixes.ts";

export default expandWitnessCollection(expandWitnessPrefixes(compact));
