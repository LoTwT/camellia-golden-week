import assert from "node:assert/strict";
import test from "node:test";
import { assembleContent, worldCatalog } from "../src/content/assemble.ts";
import { REWARD_LABELS } from "../src/ui/labels.ts";

test("G09 收集列表为完整奖励账本提供中文名称，不能退回稳定 ID 或遗漏奖励", () => {
  assert.deepEqual(
    Object.keys(REWARD_LABELS).sort(),
    worldCatalog.rewards.map((reward) => reward.id).sort(),
  );
  for (const reward of worldCatalog.rewards) {
    const label = REWARD_LABELS[reward.id];
    assert.ok(label, `${reward.id} 缺少可显示名称`);
    assert.ok(label.trim(), `${reward.id} 的名称不能为空白`);
    assert.notEqual(label, reward.id);
    assert.match(label, /\p{Script=Han}/u, `${reward.id} 缺少中文名称`);
  }
});

test("G10 所有分期收集列表的奖励都能取得完整账本中的名称", () => {
  for (const profile of worldCatalog.releaseProfiles) {
    const content = assembleContent(profile.id);
    assert.ok(content.rewards.length > 0);
    for (const rewardId of content.profile.includedRewardIds)
      assert.ok(REWARD_LABELS[rewardId]?.trim(), `${profile.id}: ${rewardId}`);
  }
});
