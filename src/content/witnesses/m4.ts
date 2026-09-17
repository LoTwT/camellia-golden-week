import compact from "./m4.json" with { type: "json" };
import { expandWitnessCollection } from "./compact.ts";
import { expandExpectationLists } from "./expectation-lists.ts";

export default expandWitnessCollection(expandExpectationLists(compact));
