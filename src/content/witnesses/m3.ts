import compact from "./m3.json" with { type: "json" };
import { expandWitnessCollection } from "./compact.ts";

export default expandWitnessCollection(compact);
