import type { AreaId, GameContent, GateCondition, ProgressState } from "./types.ts";

export const AREA_LABELS: Record<AreaId, string> = {
  hub: "中心区",
  a: "仓储区 A",
  b: "仓储区 B",
  c: "仓储区 C",
  d: "仓储区 D",
  warehouse: "中央仓库",
};

export function areaData(content: GameContent, state: ProgressState, areaId: AreaId) {
  const all = content.catalogDataNodes.filter((node) => node.areaId === areaId);
  const included = content.dataNodes.filter((node) => node.areaId === areaId);
  const weight = (nodes: typeof all) =>
    nodes.reduce(
      (sum, node) =>
        sum + (state.completedObjectiveIds.includes(node.completionObjectiveId) ? node.weight : 0),
      0,
    );
  return {
    collected: weight(all),
    total: all.reduce((sum, node) => sum + node.weight, 0),
    includedCollected: weight(included),
    includedTotal: included.reduce((sum, node) => sum + node.weight, 0),
    complete:
      all.length === 5 &&
      all.every((node) => state.completedObjectiveIds.includes(node.completionObjectiveId)),
  };
}

export function supplyProgress(content: GameContent, state: ProgressState, areaId?: AreaId) {
  const rewards = content.rewards.filter(
    (reward) => areaId === undefined || reward.statsAreaId === areaId,
  );
  return {
    collected: rewards.reduce(
      (sum, reward) => sum + (state.claimedRewardIds.includes(reward.id) ? reward.units : 0),
      0,
    ),
    total: rewards.reduce((sum, reward) => sum + reward.units, 0),
    count: rewards.filter((reward) => state.claimedRewardIds.includes(reward.id)).length,
  };
}

export function gateSatisfied(
  content: GameContent,
  state: ProgressState,
  condition: GateCondition,
): boolean {
  switch (condition.kind) {
    case "always":
      return true;
    case "objective":
      return state.completedObjectiveIds.includes(condition.objectiveId);
    case "capability":
      return state.capabilities.includes(condition.capabilityId);
    case "all":
      return (
        condition.conditions.length > 0 &&
        condition.conditions.every((child) => gateSatisfied(content, state, child))
      );
    case "areaDataComplete":
      return content.profile.fullCampaign && areaData(content, state, condition.areaId).complete;
  }
}

export function gateOpen(content: GameContent, state: ProgressState, gateId: string): boolean {
  const gate = content.gates.find((item) => item.id === gateId);
  return gate !== undefined && gateSatisfied(content, state, gate.condition);
}

export function gateReason(content: GameContent, gateId: string): string {
  const gate = content.gates.find((item) => item.id === gateId);
  if (gateId === "gate.hub.tutorial") return "在教学富集节点使用一次阳炎增幅仪后开放";
  if (gateId === "gate.a.main") return "完成 A 区主路径终端后开放";
  if (gateId === "gate.b.main") return "完成 B 区主路径终端后开放";
  if (gateId === "gate.c.main") return "完成 C 区主路径终端后开放";
  if (gateId === "gate.d.main") return "完成 D 区四处权限后开放";
  if (gateId.includes("firewall")) return "完成对应防火墙档位后开放";
  if (gateId.includes("antivirus")) return "完成对应杀毒档位后开放";
  return gate?.reason ?? "内容尚未收录";
}

export function currentObjective(content: GameContent, state: ProgressState): string {
  const done = (id: string) => state.completedObjectiveIds.includes(id);
  if (!done("hub.amplifier")) return "领取阳炎增幅仪";
  if (!done("hub.tutorial")) return "走到富集节点，按 R 清除以太覆盖";
  if (!content.profile.fullCampaign && done(content.profile.scopeTerminalObjectiveId))
    return "本版本主路径完成，可继续收集";
  for (const area of ["a", "b", "c", "d"] as const) {
    if (!content.profile.includedAreaIds.includes(area)) break;
    if (!done(`${area}.main`)) {
      if (area === "d")
        return `取得 D 区四处权限 · ${["01", "02", "03", "04"].filter((id) => done(`d.permission.${id}`)).length} / 4`;
      return `完成${AREA_LABELS[area]}的主路径终端`;
    }
  }
  if (content.profile.fullCampaign) {
    for (const area of ["a", "b"] as const)
      if (!done(`${area}.revisit.terminal`)) return `回访${AREA_LABELS[area]}，取得新增数据`;
    for (const area of ["a", "b", "c", "d"] as const)
      if (!areaData(content, state, area).complete)
        return `补齐${AREA_LABELS[area]}必需数据 · ${areaData(content, state, area).collected} / 100`;
    if (!done("warehouse.complete")) return "返回中心区，进入中央仓库并激活最终终端";
    return "主目标完成 · 可自由回访与补齐物资";
  }
  return "继续探索已开放区域";
}

export function addUnique(items: string[], id: string): boolean {
  if (items.includes(id)) return false;
  items.push(id);
  return true;
}
