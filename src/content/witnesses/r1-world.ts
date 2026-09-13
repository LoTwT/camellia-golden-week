import compact from "./r1-world.json" with { type: "json" };
import { expandWitnessCollection } from "./compact.ts";
import { expandWitnessPrefixes } from "./prefixes.ts";
import { expandExpectationLists } from "./expectation-lists.ts";

export default expandWitnessCollection(expandWitnessPrefixes(expandExpectationLists(compact)));
