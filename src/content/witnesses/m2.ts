import compact from "./m2.json" with { type: "json" };
import { expandWitnessCollection } from "./compact.ts";
import { expandExpectationLists } from "./expectation-lists.ts";

export default expandWitnessCollection(expandExpectationLists(compact));
