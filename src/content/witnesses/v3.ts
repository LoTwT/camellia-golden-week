import frozenRealtime from "../history/pre-r1/realtime-content.ts";
import type { RealtimeDefinition } from "../../core/realtime.ts";
const realtimeContent = frozenRealtime as unknown as {
  definitions: RealtimeDefinition[];
  witnesses: RealtimeWitness[];
};
import type { RealtimeWitness } from "../../core/realtime.ts";
import type { WorldWitness } from "../validate.ts";
import { v2WorldWitness } from "./v2.ts";

/** Published recordings retain their world actions; v3 replaces firewall routes with fixed keyboard witnesses. */
export function v3WorldWitness(witness: WorldWitness): WorldWitness {
  const previous = v2WorldWitness(witness);
  const intervals = previous.steps.flatMap((step) => {
    if (
      step.command.kind !== "StartChallenge" ||
      !step.command.challengeId.startsWith("a.firewall.")
    )
      return [];
    const challengeId = step.command.challengeId;
    const definition = realtimeContent.definitions.find((item) => item.id === challengeId);
    if (!definition || definition.kind !== "firewall") throw new Error("缺少当前防火墙定义");
    const route = (realtimeContent.witnesses as unknown as RealtimeWitness[]).find(
      (item) => item.challengeId === definition.id && item.expectedResult === "success",
    );
    if (!route) throw new Error("缺少当前防火墙方向键见证");
    return [
      { startMs: step.atMs + 3000, endMs: step.atMs + 3000 + definition.rules.durationMs, route },
    ];
  });
  const retained = previous.steps.filter(
    (step) =>
      !(
        ["Move", "ClickTile"].includes(step.command.kind) &&
        intervals.some((interval) => step.atMs >= interval.startMs && step.atMs < interval.endMs)
      ),
  );
  const replacements = intervals.flatMap((interval) =>
    interval.route.commands.map((command) => {
      if (command.kind !== "move") throw new Error("世界防火墙见证只接受正常方向键路线");
      return {
        atMs: interval.startMs + command.activeTimeMs,
        command: { kind: "Move" as const, direction: command.direction },
        expectedCode: "accepted" as const,
      };
    }),
  );
  return {
    ...previous,
    ruleVersion: 3,
    steps: [...retained, ...replacements].toSorted((left, right) => left.atMs - right.atMs),
  };
}
