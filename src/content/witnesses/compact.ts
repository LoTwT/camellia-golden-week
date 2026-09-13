import type { GameCommand } from "../../core/types.ts";
import type { WorldWitnessStep } from "../validate.ts";

/** [first absolute time, command key, result, optional count/interval/checkpoint]. */
export type WitnessRun =
  | readonly [number, string, string]
  | readonly [number, string, string, number, number]
  | readonly [number, string, string, 1, 0, NonNullable<WorldWitnessStep["checkpoint"]>];

type CompactRoute = { readonly runs: readonly unknown[] };
type CompactCollection = {
  readonly encoding: string;
  readonly commands: Readonly<Record<string, unknown>>;
  readonly witnesses: readonly CompactRoute[];
  readonly continuations?: readonly CompactRoute[];
};
type ExpandedRoute<T> = Omit<T, "runs"> & { steps: WorldWitnessStep[] };
type ExpandedCollection<T> = {
  [K in keyof T as K extends "encoding" | "commands" ? never : K]: K extends
    | "witnesses"
    | "continuations"
    ? T[K] extends readonly (infer R)[]
      ? ExpandedRoute<R>[]
      : never
    : T[K];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const nonnegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** Only changes storage: every repeated command remains a separate dispatch at its original time. */
export function expandWitnessCollection<T extends CompactCollection>(
  raw: T,
): ExpandedCollection<T> {
  if (raw.encoding !== "world-witness-runs-v1" || !isRecord(raw.commands))
    throw new Error("Invalid world witness encoding or command dictionary");
  for (const [key, command] of Object.entries(raw.commands))
    if (!key || !isRecord(command) || typeof command.kind !== "string")
      throw new Error(`Invalid world witness command: ${key}`);
  const expandRoute = (route: CompactRoute): ExpandedRoute<CompactRoute> => {
    if (!isRecord(route) || !Array.isArray(route.runs) || Object.hasOwn(route, "steps"))
      throw new Error("Invalid world witness route runs");
    const steps: WorldWitnessStep[] = [];
    for (const run of route.runs) {
      if (!Array.isArray(run) || ![3, 5, 6].includes(run.length))
        throw new Error("Invalid world witness run fields");
      const [firstAtMs, commandKey, expectedCode] = run;
      const count = run.length === 3 ? 1 : run[3];
      const intervalMs = run.length === 3 ? 0 : run[4];
      if (
        !nonnegativeInteger(firstAtMs) ||
        typeof commandKey !== "string" ||
        !Object.hasOwn(raw.commands, commandKey) ||
        typeof expectedCode !== "string" ||
        !expectedCode.trim() ||
        !nonnegativeInteger(count) ||
        count < 1 ||
        count + steps.length > 20000 ||
        !nonnegativeInteger(intervalMs) ||
        (count === 1 && intervalMs !== 0) ||
        !nonnegativeInteger(firstAtMs + (count - 1) * intervalMs) ||
        firstAtMs < (steps.at(-1)?.atMs ?? 0)
      )
        throw new Error("Invalid world witness run command, result, count or time");
      const checkpoint = run[5];
      if (
        run.length === 6 &&
        (count !== 1 ||
          !isRecord(checkpoint) ||
          typeof checkpoint.id !== "string" ||
          !isRecord(checkpoint.expected))
      )
        throw new Error("Invalid world witness checkpoint");
      for (let index = 0; index < count; index++)
        steps.push({
          atMs: firstAtMs + index * intervalMs,
          command: structuredClone(raw.commands[commandKey]) as GameCommand,
          expectedCode,
          ...(run.length === 6
            ? {
                checkpoint: structuredClone(checkpoint) as NonNullable<
                  WorldWitnessStep["checkpoint"]
                >,
              }
            : {}),
        });
    }
    if (!steps.length) throw new Error("World witness route has no steps");
    const { runs: _runs, ...metadata } = route;
    return { ...structuredClone(metadata), steps };
  };
  if (
    !Array.isArray(raw.witnesses) ||
    (raw.continuations !== undefined && !Array.isArray(raw.continuations))
  )
    throw new Error("Invalid world witness route collection");
  const { encoding: _encoding, commands: _commands, ...metadata } = raw;
  return {
    ...structuredClone(metadata),
    witnesses: raw.witnesses.map(expandRoute),
    ...(raw.continuations ? { continuations: raw.continuations.map(expandRoute) } : {}),
  } as ExpandedCollection<T>;
}

type AuthoredRoute = { readonly steps: readonly WorldWitnessStep[] };
type AuthoredCollection = {
  readonly witnesses: readonly AuthoredRoute[];
  readonly continuations?: readonly AuthoredRoute[];
};

/** Explicit authors call this encoder; imports, tests and builds never write data. */
export function compactWitnessCollection<T extends AuthoredCollection>(source: T) {
  if (Object.hasOwn(source, "encoding") || Object.hasOwn(source, "commands"))
    throw new Error("Authored witnesses contain reserved encoding fields");
  const commands: Record<string, GameCommand> = {};
  const commandKeys = new Map<string, string>();
  const compactRoute = (route: AuthoredRoute) => {
    if (Object.hasOwn(route, "runs")) throw new Error("Authored witness already has runs");
    for (const step of route.steps)
      if (
        Object.keys(step).some(
          (key) => !["atMs", "command", "expectedCode", "checkpoint"].includes(key),
        )
      )
        throw new Error("Authored witness step contains unsupported fields");
    const runs: WitnessRun[] = [];
    let index = 0;
    while (index < route.steps.length) {
      const step = route.steps[index]!;
      const serialized = JSON.stringify(step.command);
      let key = commandKeys.get(serialized);
      if (!key) {
        key = Object.values(step.command).join(":");
        if (Object.hasOwn(commands, key)) throw new Error(`Ambiguous witness command key: ${key}`);
        commands[key] = structuredClone(step.command);
        commandKeys.set(serialized, key);
      }
      const next = route.steps[index + 1];
      const intervalMs = next ? next.atMs - step.atMs : 0;
      let count = 1;
      while (!step.checkpoint && index + count < route.steps.length) {
        const candidate = route.steps[index + count]!;
        if (
          candidate.checkpoint ||
          candidate.atMs !== step.atMs + count * intervalMs ||
          candidate.expectedCode !== step.expectedCode ||
          JSON.stringify(candidate.command) !== serialized
        )
          break;
        count++;
      }
      runs.push(
        step.checkpoint
          ? [step.atMs, key, step.expectedCode, 1, 0, structuredClone(step.checkpoint)]
          : count > 1
            ? [step.atMs, key, step.expectedCode, count, intervalMs]
            : [step.atMs, key, step.expectedCode],
      );
      index += count;
    }
    const { steps: _steps, ...metadata } = route;
    return { ...structuredClone(metadata), runs };
  };
  const result = {
    encoding: "world-witness-runs-v1",
    commands,
    ...structuredClone(source),
    witnesses: source.witnesses.map(compactRoute),
    ...(source.continuations ? { continuations: source.continuations.map(compactRoute) } : {}),
  };
  expandWitnessCollection(result);
  return result;
}
