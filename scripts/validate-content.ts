import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import {
  AVAILABLE_PROFILE,
  assembleContent,
  realtimeContent,
  staticContent,
  worldCatalog,
} from "../src/content/assemble.ts";
import {
  validateCatalog,
  validateContent,
  replayWorldWitness,
  validateWorldWitness,
} from "../src/content/validate.ts";
import type { WorldWitness } from "../src/content/validate.ts";
import type { ProfileId } from "../src/core/types.ts";
import { validateStaticContent } from "../src/core/static-puzzle.ts";
import { replayRealtimeWitness, validateRealtimeDefinition } from "../src/core/realtime.ts";
import type { RealtimeWitness } from "../src/core/realtime.ts";
import m1WorldWitnessContent from "../src/content/witnesses/m1.json" with { type: "json" };
import m2WorldWitnessContent from "../src/content/witnesses/m2.json" with { type: "json" };
import m3WorldWitnessContent from "../src/content/witnesses/m3.json" with { type: "json" };
import m4WorldWitnessContent from "../src/content/witnesses/m4.json" with { type: "json" };

assert.deepEqual(validateCatalog(worldCatalog), [], "完整设计目录与分期账本");
for (const profile of worldCatalog.releaseProfiles) {
  const units = worldCatalog.rewards
    .filter((reward) => profile.includedRewardIds.includes(reward.id))
    .reduce((sum, reward) => sum + reward.units, 0);
  const stage = Number(profile.id.slice(1));
  const available = Number(AVAILABLE_PROFILE.slice(1));
  console.log(
    `${profile.id} 目录账本：${profile.includedRewardIds.length} 个奖励 ID / ${units} 单位；世界地图${stage <= available ? "已收录，继续校验" : "未验证（阶段尚未实现）"}`,
  );
  if (stage > available) continue;
  const content = assembleContent(profile.id as ProfileId);
  const issues = validateContent(content);
  if (issues.length)
    throw new Error(
      issues.map((issue) => `${profile.id}: ${issue.path}: ${issue.message}`).join("\n"),
    );
  const usedSources = new Set([
    ...content.areas.flatMap((area) => area.sourceRecordIds),
    ...content.entities.flatMap((entity) => entity.sourceRecordIds),
    ...content.staticChallenges.flatMap((definition) => definition.sourceRecordIds),
  ]);
  for (const source of content.sources.filter((source) => usedSources.has(source.id))) {
    if (!/^https?:\/\//.test(source.urlOrPath))
      assert.equal(
        existsSync(new URL(`../${source.urlOrPath}`, import.meta.url)),
        true,
        `${source.id}: 来源记录文件存在`,
      );
  }
  for (const room of content.rooms)
    for (const witnessId of room.witnessIds)
      assert.ok(
        staticContent.witnesses.some((witness) => witness.id === witnessId) ||
          (realtimeContent.witnesses as RealtimeWitness[]).some(
            (witness) => witness.id === witnessId,
          ),
        `${room.id}: 见证引用 ${witnessId}`,
      );
  console.log(
    `${profile.id} 世界结构：${content.areas.length} 区 / ${content.tiles.length} 格 / ${content.rooms.length} 房 / ${content.dataNodes.reduce((sum, node) => sum + node.weight, 0)} 本版数据，引用闭合通过`,
  );
}

assert.deepEqual(validateStaticContent(staticContent), [], "静态内容与逐步见证");
console.log(
  `静态独立规则：${staticContent.definitions.length} 个固定定义 / ${staticContent.witnesses.length} 条成功、替代解与恢复见证通过`,
);
for (const definition of realtimeContent.definitions)
  assert.deepEqual(validateRealtimeDefinition(definition), [], definition.id);
const realtimeWitnesses = realtimeContent.witnesses as RealtimeWitness[];
for (const witness of realtimeWitnesses) {
  const definition = realtimeContent.definitions.find(
    (candidate) => candidate.id === witness.challengeId,
  );
  assert.ok(definition, `${witness.id}: 定义存在`);
  const result = replayRealtimeWitness(definition, witness);
  assert.equal(result.result, witness.expectedResult, witness.id);
  for (const [field, expected] of Object.entries(witness.expectedFinalState))
    assert.deepEqual(
      (result.state as unknown as Record<string, unknown>)[field],
      expected,
      `${witness.id}.${field}`,
    );
  assert.equal(
    new Set(result.feedback.map((event) => event.id)).size,
    result.feedback.length,
    `${witness.id}: 反馈事件唯一`,
  );
}
console.log(
  `实时独立规则：${realtimeContent.definitions.length} 个固定定义 / ${realtimeWitnesses.length} 条成功与失败见证通过；尚未收录区域不据此视为世界验收通过`,
);

for (const rawWitness of [
  ...m1WorldWitnessContent.witnesses,
  ...m2WorldWitnessContent.witnesses,
  ...m3WorldWitnessContent.witnesses,
  ...m4WorldWitnessContent.witnesses,
]) {
  assert.deepEqual(validateWorldWitness(rawWitness), [], rawWitness.id);
  const witness = rawWitness as WorldWitness;
  const result = replayWorldWitness(assembleContent(witness.profileId), witness);
  if (result.issues.length)
    throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n"));
  assert.equal(
    result.pickupEventCount,
    result.state.claimedRewardIds.length,
    `${witness.id}: 奖励事务幂等`,
  );
  console.log(
    `${witness.id}：${result.commandCount} 条公开命令，${result.pickupEventCount} 次首次领取；${witness.expected.supplyUnits} 物资，通过`,
  );
}
console.log("内容校验只读完成。浏览器、存档故障与视听验收由各自记录承担。");
