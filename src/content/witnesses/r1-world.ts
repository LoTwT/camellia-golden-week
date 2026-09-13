import compact from "./r1-world.json" with { type: "json" };
import { expandWitnessCollection } from "./compact.ts";

export default expandWitnessCollection(compact);
