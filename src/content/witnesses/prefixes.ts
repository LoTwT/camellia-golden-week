import { expandWitnessCollection } from "./compact.ts";

type Route = { readonly id: string; readonly runs: readonly unknown[] };
type Collection = {
  readonly encoding: string;
  readonly commands: Readonly<Record<string, unknown>>;
  readonly witnesses: readonly Route[];
};
type WitnessPrefix = { witnessId: string; runCount: number };
type PrefixedCollection<T extends Collection> = Omit<T, "encoding" | "witnesses"> & {
  encoding: "world-witness-prefixes-v1";
  witnesses: (T["witnesses"][number] & { prefix?: WitnessPrefix })[];
};
type FlatCollection<T extends Collection> = Omit<T, "encoding" | "witnesses"> & {
  encoding: "world-witness-runs-v1";
  witnesses: Omit<T["witnesses"][number], "prefix">[];
};

function checkCollection(source: Collection): void {
  if (!Array.isArray(source.witnesses) || Object.hasOwn(source, "continuations"))
    throw new Error("Witness prefixes require a collection without continuations");
}

function checkRoute(route: Route, previous: ReadonlyMap<string, unknown>): void {
  if (
    !route ||
    typeof route.id !== "string" ||
    !route.id.trim() ||
    previous.has(route.id) ||
    !Array.isArray(route.runs)
  )
    throw new Error("Invalid or duplicate witness prefix route");
}

/** A single forward pass resolves earlier routes; references never execute game commands. */
export function expandWitnessPrefixes<T extends Collection>(source: T): FlatCollection<T> {
  if (source.encoding !== "world-witness-prefixes-v1")
    throw new Error("Invalid witness prefix encoding");
  checkCollection(source);
  const previous = new Map<string, readonly unknown[]>();
  const witnesses = source.witnesses.map((route) => {
    checkRoute(route, previous);
    const { prefix, ...metadata } = route as Route & { prefix?: unknown };
    let prefixRuns: readonly unknown[] = [];
    if (Object.hasOwn(route, "prefix")) {
      if (
        !prefix ||
        typeof prefix !== "object" ||
        Array.isArray(prefix) ||
        Object.keys(prefix).length !== 2 ||
        !("witnessId" in prefix) ||
        !("runCount" in prefix) ||
        typeof prefix.witnessId !== "string" ||
        typeof prefix.runCount !== "number" ||
        !Number.isSafeInteger(prefix.runCount) ||
        prefix.runCount < 1
      )
        throw new Error("Invalid witness prefix reference");
      const referenced = previous.get(prefix.witnessId);
      if (!referenced || prefix.runCount > referenced.length)
        throw new Error("Witness prefix must reference an earlier route within its run count");
      prefixRuns = referenced.slice(0, prefix.runCount);
    }
    // Each run produces at least one step; bound allocation before the step decoder's limit.
    if (prefixRuns.length + route.runs.length > 20000)
      throw new Error("Witness prefix route exceeds the step limit");
    const runs = structuredClone([...prefixRuns, ...route.runs]);
    previous.set(route.id, runs);
    return { ...structuredClone(metadata), runs };
  });
  return {
    ...structuredClone(source),
    encoding: "world-witness-runs-v1",
    witnesses,
  } as FlatCollection<T>;
}

/** Explicit authoring only: store the longest identical prefix of a preceding route. */
export function compactWitnessPrefixes<T extends Collection>(source: T): PrefixedCollection<T> {
  checkCollection(source);
  expandWitnessCollection(source);
  const previous = new Map<string, string[]>();
  const witnesses = source.witnesses.map((route) => {
    checkRoute(route, previous);
    if (Object.hasOwn(route, "prefix")) throw new Error("Witness route already has a prefix");
    const serialized = route.runs.map((run) => JSON.stringify(run));
    let prefix: WitnessPrefix | undefined;
    for (const [witnessId, candidate] of previous) {
      let runCount = 0;
      while (runCount < serialized.length && serialized[runCount] === candidate[runCount])
        runCount++;
      if (runCount >= 8 && runCount > (prefix?.runCount ?? 0)) prefix = { witnessId, runCount };
    }
    previous.set(route.id, serialized);
    return {
      ...structuredClone(route),
      ...(prefix ? { prefix } : {}),
      runs: structuredClone(route.runs.slice(prefix?.runCount ?? 0)),
    };
  });
  return {
    ...structuredClone(source),
    encoding: "world-witness-prefixes-v1",
    witnesses,
  } as PrefixedCollection<T>;
}
