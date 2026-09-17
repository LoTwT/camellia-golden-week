const fields = ["completedObjectiveIds", "absentObjectiveIds", "claimedRewardIds"] as const;
type ListField = (typeof fields)[number];
type Pools = { format: "world-witness-expectation-lists-v1" } & Record<ListField, string[][]>;
type Route = { readonly runs: readonly unknown[]; readonly expected?: unknown };
type Collection = {
  readonly witnesses: readonly Route[];
  readonly continuations?: readonly Route[] | undefined;
};
type MappedExpectation<T, Value> = { [K in keyof T]: K extends ListField ? Value : T[K] };
type MappedRoute<T, Value> = {
  [K in keyof T]: K extends "runs"
    ? unknown[]
    : K extends "expected"
      ? MappedExpectation<NonNullable<T[K]>, Value>
      : T[K];
};
type MappedCollection<T, Value> = {
  [K in keyof T as K extends "expectationLists" ? never : K]: K extends
    | "witnesses"
    | "continuations"
    ? NonNullable<T[K]> extends readonly (infer R)[]
      ? MappedRoute<R, Value>[]
      : never
    : T[K];
};
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

/** Visit only route expectations and checkpoint expectations, never unrelated metadata. */
function visitExpectations(source: Collection, visit: (expected: Record<string, unknown>) => void) {
  if (
    !Array.isArray(source.witnesses) ||
    (source.continuations !== undefined && !Array.isArray(source.continuations))
  )
    throw new Error("Invalid expectation list route collection");
  const visitExpected = (owner: Record<string, unknown>) => {
    if (Object.hasOwn(owner, "expected")) {
      if (!isRecord(owner.expected)) throw new Error("Invalid witness expectation");
      visit(owner.expected);
    }
  };
  for (const route of [...source.witnesses, ...(source.continuations ?? [])]) {
    if (!isRecord(route) || !Array.isArray(route.runs))
      throw new Error("Invalid expectation list route");
    visitExpected(route);
    for (const run of route.runs)
      if (Array.isArray(run) && run.length === 6 && isRecord(run[5])) visitExpected(run[5]);
  }
}

/** Restore ordered assertion lists; this does not derive expectations from game state. */
export function expandExpectationLists<T extends Collection>(
  source: T,
): MappedCollection<T, string[]> {
  const { expectationLists, ...stored } = source as T & { expectationLists?: unknown };
  if (
    !isRecord(expectationLists) ||
    expectationLists.format !== "world-witness-expectation-lists-v1" ||
    Object.keys(expectationLists).some(
      (key) => key !== "format" && !fields.includes(key as ListField),
    )
  )
    throw new Error("Invalid witness expectation list format");
  for (const field of fields) {
    const pool = expectationLists[field];
    if (!Array.isArray(pool) || !pool.every(isStringList))
      throw new Error(`Invalid witness expectation list pool: ${field}`);
  }
  const pools = expectationLists as Pools;
  const expanded = structuredClone(stored);
  visitExpectations(expanded, (expected) => {
    for (const field of fields) {
      if (!Object.hasOwn(expected, field)) continue;
      const value = expected[field];
      if (isStringList(value)) expected[field] = [...value];
      else {
        if (
          typeof value !== "number" ||
          !Number.isSafeInteger(value) ||
          value < 0 ||
          value >= pools[field].length
        )
          throw new Error(`Invalid witness expectation list reference: ${field}`);
        expected[field] = [...pools[field][value]!];
      }
    }
  });
  return expanded as unknown as MappedCollection<T, string[]>;
}

/** Explicit authoring: share repeated lists within one file and one semantic field. */
export function compactExpectationLists<T extends Collection>(
  source: T,
): MappedCollection<T, string[] | number> & { expectationLists: Pools } {
  if (Object.hasOwn(source, "expectationLists"))
    throw new Error("Witness already has expectation lists");
  const pools: Pools = {
    format: "world-witness-expectation-lists-v1",
    completedObjectiveIds: [],
    absentObjectiveIds: [],
    claimedRewardIds: [],
  };
  const counts = new Map<ListField, Map<string, number>>(fields.map((field) => [field, new Map()]));
  visitExpectations(source, (expected) => {
    for (const field of fields) {
      if (!Object.hasOwn(expected, field)) continue;
      const value = expected[field];
      if (!isStringList(value)) throw new Error(`Invalid authored expectation list: ${field}`);
      const serialized = JSON.stringify(value);
      const byValue = counts.get(field)!;
      byValue.set(serialized, (byValue.get(serialized) ?? 0) + 1);
    }
  });
  const indices = new Map<ListField, Map<string, number>>(
    fields.map((field) => [field, new Map()]),
  );
  const compact = structuredClone(source);
  visitExpectations(compact, (expected) => {
    for (const field of fields) {
      const value = expected[field];
      if (!isStringList(value) || value.length < 2) continue;
      const serialized = JSON.stringify(value);
      if (counts.get(field)!.get(serialized)! < 2) continue;
      const byValue = indices.get(field)!;
      let index = byValue.get(serialized);
      if (index === undefined) {
        index = pools[field].length;
        pools[field].push([...value]);
        byValue.set(serialized, index);
      }
      expected[field] = index;
    }
  });
  return { ...compact, expectationLists: pools } as MappedCollection<T, string[] | number> & {
    expectationLists: Pools;
  };
}
