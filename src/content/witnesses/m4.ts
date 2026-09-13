import compact from "./m4.json" with { type: "json" };
import { expandWitnessCollection } from "./compact.ts";

export default expandWitnessCollection(compact);
