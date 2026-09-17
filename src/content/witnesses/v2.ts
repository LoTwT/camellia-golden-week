import { legacyRealtimeContent, v2RealtimeContent as realtimeContent } from "../assemble.ts";
import type { WorldWitness } from "../validate.ts";

/** Keep published v1 recordings intact, retiming only their firewall moves for the v2 chart. */
export function v2WorldWitness(witness: WorldWitness): WorldWitness {
  if (
    witness.ruleVersion !== 1 ||
    witness.contentVersion !== Math.min(Number(witness.profileId.slice(1)), 4)
  )
    throw new Error("只能重定时已发布 v1 世界见证；其他版本需要明确转换");
  let firewall: { challengeId: string; activeStartMs: number; endMs: number } | null = null;
  const steps = witness.steps
    .map((step) => {
      if (
        step.command.kind === "StartChallenge" &&
        step.command.challengeId.startsWith("a.firewall.")
      ) {
        const challengeId = step.command.challengeId;
        const definition = realtimeContent.definitions.find(
          (candidate) => candidate.id === challengeId,
        );
        if (!definition || definition.kind !== "firewall") throw new Error("未知防火墙见证");
        firewall = {
          challengeId: definition.id,
          activeStartMs: step.atMs + 3000,
          endMs: step.atMs + 3000 + definition.rules.durationMs,
        };
      }
      if (firewall && step.atMs > firewall.endMs) firewall = null;
      if (
        !firewall ||
        step.atMs < firewall.activeStartMs ||
        !["Move", "ClickTile"].includes(step.command.kind)
      )
        return step;
      const challengeId = firewall.challengeId;
      const before = legacyRealtimeContent.definitions.find(
        (definition) => definition.id === challengeId,
      );
      const after = realtimeContent.definitions.find((definition) => definition.id === challengeId);
      if (before?.kind !== "firewall" || after?.kind !== "firewall")
        throw new Error("缺少见证的原始或当前防火墙");
      const originalTimeMs = step.atMs - firewall.activeStartMs;
      const oldIntervalMs = 60_000 / before.rules.bpm;
      const beatIndex = Math.round((originalTimeMs - before.rules.firstBeatMs) / oldIntervalMs);
      const offsetMs = originalTimeMs - before.rules.firstBeatMs - beatIndex * oldIntervalMs;
      const atMs = Math.round(
        firewall.activeStartMs +
          after.rules.firstBeatMs +
          beatIndex * (60_000 / after.rules.bpm) +
          offsetMs,
      );
      if (atMs >= firewall.endMs) throw new Error("旧见证操作无法完整落在新谱面内，必须重新制作");
      return { ...step, atMs };
    })
    .toSorted((left, right) => left.atMs - right.atMs);
  return {
    ...witness,
    contentVersion: 2 + Math.min(Number(witness.profileId.slice(1)), 4) - 1,
    ruleVersion: 2,
    steps,
  };
}
