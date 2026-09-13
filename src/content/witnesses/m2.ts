import compact from "./m2.json" with { type: "json" };
import { expandWitnessCollection } from "./compact.ts";

export default expandWitnessCollection(compact);
