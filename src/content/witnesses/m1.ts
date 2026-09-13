import compact from "./m1.json" with { type: "json" };
import { expandWitnessCollection } from "./compact.ts";

export default expandWitnessCollection(compact);
