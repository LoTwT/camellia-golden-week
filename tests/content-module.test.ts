import assert from "node:assert/strict";
import test from "node:test";
import { contentModuleSource } from "../scripts/content-module.ts";
import { assembleContent } from "../src/content/assemble.ts";
import { m5WorldWitnesses } from "../src/content/witnesses/m5.ts";
import { replayWorldWitness, validateContent } from "../src/content/validate.ts";
import type { GameContent, ProfileId } from "../src/core/types.ts";

test("构建共享内容模块保留M1–M5全部历史结构；实际执行视图可完整通关", async () => {
  const originals = (["M1", "M2", "M3", "M4", "M5"] as ProfileId[]).map(assembleContent);
  const sourceBefore = JSON.stringify(originals);
  const moduleSource = contentModuleSource(originals);
  const module = (await import(`data:text/javascript,${encodeURIComponent(moduleSource)}`)) as {
    default: GameContent;
    migrationReleases: GameContent[];
  };
  assert.deepEqual(module.migrationReleases, originals);
  assert.equal(JSON.stringify(originals), sourceBefore);
  assert.equal(module.default, module.migrationReleases[4]);
  assert.ok(moduleSource.length < sourceBefore.length / 2, "共享结构应实质减少重复发布内容");
  for (const release of module.migrationReleases) assert.deepEqual(validateContent(release), []);
  for (const witness of m5WorldWitnesses) {
    const result = replayWorldWitness(module.default, witness);
    assert.deepEqual(result.issues, []);
    assert.equal(result.state.claimedRewardIds.length, witness.expected.claimedRewardIds.length);
  }
  assert.deepEqual(module.migrationReleases, originals, "运行不能改写共享的任何历史内容");
});

test("单独M1包只有该阶段内容，中文和引号可安全往返", async () => {
  const original = assembleContent("M1");
  original.areas[0]!.subtitle = '中文 "引号" 与反斜杠 \\';
  const module = await import(
    `data:text/javascript,${encodeURIComponent(contentModuleSource([original]))}`
  );
  assert.deepEqual(module.default, original);
  assert.equal(module.migrationReleases.length, 1);
  assert.equal(
    module.default.entities.some((entity: { id: string }) => entity.id.startsWith("d.")),
    false,
  );
  assert.throws(() => contentModuleSource([]));
});
