import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assembleContent,
  migrationContentReleases,
  staticContent,
} from "../src/content/assemble.ts";
import { worldWitnesses } from "../src/content/witnesses/index.ts";
import { replayWorldWitness } from "../src/content/validate.ts";
import { createGame, dispatch } from "../src/core/engine.ts";
import { supplyProgress } from "../src/core/progress.ts";
import type {
  CompletedRoomLayoutRecord,
  GameCommand,
  GameContent,
  GameState,
} from "../src/core/types.ts";
import { publishedProfileMigrations } from "../src/platform/migrations.ts";
import { restorePayload, stablePayload, validatePayload } from "../src/platform/save-payload.ts";

const profiles = ["M1", "M2", "M3", "M4", "M5"] as const;
function registry(content: GameContent) {
  return publishedProfileMigrations(migrationContentReleases(content.profile.id));
}
for (const witness of worldWitnesses) {
  test(`R1 冻结正常命令见证：${witness.id}`, () => {
    const content = assembleContent(witness.profileId);
    const result = replayWorldWitness(content, witness);
    assert.deepEqual(result.issues, []);
    const payload = stablePayload(result.state);
    const validated = validatePayload(payload, content, registry(content));
    assert.ok(validated.ok, validated.ok ? "" : validated.error);
    assert.deepEqual(validated.value, payload);
    assert.equal(payload.schemaVersion, 3);
    assert.equal(payload.ruleVersion, 4);
    assert.deepEqual(payload.archivedCompletedRoomLayouts, []);
    if (witness.id.includes("main-path")) {
      assert.deepEqual(
        payload.bestResults.filter(
          (result) => result.bestScore !== undefined || result.bestCombo !== undefined,
        ),
        [],
        "计分挑战可跳过而正常完成主推进",
      );
    } else {
      assert.equal(
        supplyProgress(content, payload).collected,
        [26, 51, 81, 130, 130][profiles.indexOf(witness.profileId)],
      );
      for (const definition of content.staticChallenges) {
        const record = payload.completedRoomLayouts[definition.id];
        assert.ok(record, `缺少真实新版布局 ${definition.id}`);
        assert.equal(record.contentVersion, content.contentVersion);
        assert.equal(record.ruleVersion, content.ruleVersion);
      }
      if (Number(witness.profileId.slice(1)) >= 3)
        for (const id of [
          "c.capture.01",
          "c.capture.02",
          "c.capture.03",
          "c.capture.04",
          "c.theft.01",
          "c.theft.02",
          "c.theft.03",
        ])
          assert.ok(payload.completedObjectiveIds.includes(id), id);
    }
  });
}

for (let index = 0; index < profiles.length - 1; index++) {
  const sourceProfile = profiles[index]!;
  const targetProfile = profiles[index + 1]!;
  test(`R1 ${sourceProfile}→${targetProfile}：正常路线共同检查点保存后迁移，公开命令续玩至全收集`, () => {
    const source = assembleContent(sourceProfile);
    const target = assembleContent(targetProfile);
    const before = worldWitnesses.find(
      (w) => w.profileId === sourceProfile && w.id.includes("full-collection"),
    )!;
    const after = worldWitnesses.find(
      (w) => w.profileId === targetProfile && w.id.includes("full-collection"),
    )!;
    let shared = 0;
    while (
      shared < before.steps.length &&
      JSON.stringify(before.steps[shared]) === JSON.stringify(after.steps[shared])
    )
      shared++;
    assert.ok(shared > 0);
    let state = createGame(source, 0);
    for (const step of before.steps.slice(0, shared)) {
      const result = dispatch(source, state, step.command, step.atMs);
      assert.equal(result.code, step.expectedCode);
      state = result.state;
    }
    const old = stablePayload(state);
    const migrated = validatePayload(old, target, registry(target));
    assert.ok(migrated.ok, migrated.ok ? "" : migrated.error);
    assert.deepEqual(migrated.value.claimedRewardIds, old.claimedRewardIds);
    assert.deepEqual(migrated.value.completedObjectiveIds, old.completedObjectiveIds);
    for (const [id, record] of Object.entries(old.completedRoomLayouts)) {
      const mapped: CompletedRoomLayoutRecord = migrated.value.completedRoomLayouts[id]!;
      assert.deepEqual(mapped.layout, record.layout);
      assert.equal(mapped.contentVersion, target.contentVersion);
      if (target.contentVersion !== source.contentVersion) assert.ok(mapped.source?.mappingId);
    }
    const offset = before.steps[shared - 1]!.atMs;
    state = restorePayload(migrated.value, target, 0);
    for (const step of after.steps.slice(shared)) {
      const result = dispatch(target, state, step.command, step.atMs - offset);
      assert.equal(result.code, step.expectedCode, JSON.stringify(step));
      state = result.state;
    }
    assert.equal(supplyProgress(target, state).collected, [26, 51, 81, 130, 130][index + 1]);
    for (const id of after.expected.completedObjectiveIds)
      assert.ok(state.completedObjectiveIds.includes(id), id);
    const final = validatePayload(stablePayload(state), target, registry(target));
    assert.ok(final.ok, final.ok ? "" : final.error);
  });
}

class Session {
  state: GameState;
  time = 0;
  readonly content: GameContent;
  constructor(content: GameContent, state: GameState) {
    this.content = content;
    this.state = state;
  }
  send(command: GameCommand, expected = "accepted", elapsed = 140) {
    this.time += elapsed;
    const result = dispatch(this.content, this.state, command, this.time);
    assert.ok(
      expected.split("|").includes(result.code),
      `${JSON.stringify(command)}: ${result.state.lastResult.message}`,
    );
    this.state = result.state;
  }
}

test("R1 真实 v3 全收集旧档归档后正常导航体验新版盗取，退出/刷新不补存，首个成功才补存且不覆盖旧档", () => {
  const content = assembleContent("M5");
  const raw = readFileSync(
    new URL(
      "../docs/verification/evidence/controls-readability/v1-full-collection-migration-save.json",
      import.meta.url,
    ),
    "utf8",
  );
  const original = JSON.parse(raw);
  const valid = validatePayload(original.payload, content, registry(content));
  assert.ok(valid.ok, valid.ok ? "" : valid.error);
  const session = new Session(content, restorePayload(valid.value, content, 0));
  const permanent = {
    objectives: [...session.state.completedObjectiveIds],
    rewards: [...session.state.claimedRewardIds],
    archives: structuredClone(session.state.archivedCompletedRoomLayouts),
  };
  assert.equal(permanent.archives.length, 9);
  assert.deepEqual(session.state.completedRoomLayouts, {});
  session.send({ kind: "Teleport", teleportId: "c.teleport" });
  for (const direction of ["up", "up", "left", "left"] as const)
    session.send({ kind: "Move", direction });
  assert.equal(session.state.playerPosition.tileId, "c.t.-2.-2");
  assert.equal(session.state.mode, "explore", "旧完成经过入口仍能自然通行");
  session.send({ kind: "Interact" });
  assert.equal(session.state.activeStatic?.practice, true);
  session.send({ kind: "ExitRoom" });
  assert.deepEqual(session.state.completedRoomLayouts, {});
  session.send({ kind: "Interact" });
  const refreshed = validatePayload(stablePayload(session.state), content, registry(content));
  assert.ok(refreshed.ok, refreshed.ok ? "" : refreshed.error);
  session.state = restorePayload(refreshed.value, content, session.time);
  assert.deepEqual(session.state.completedRoomLayouts, {});
  const witness = staticContent.witnesses.find(
    (w) => w.definitionId === "c.theft.01" && w.kind === "success",
  )!;
  for (const action of witness.actions) {
    assert.ok(action === "up" || action === "right" || action === "down" || action === "left");
    session.send({ kind: "Move", direction: action }, "accepted|success");
  }
  const first = structuredClone(session.state.completedRoomLayouts["c.theft.01"]);
  assert.ok(first);
  assert.deepEqual(session.state.completedObjectiveIds, permanent.objectives);
  assert.deepEqual(session.state.claimedRewardIds, permanent.rewards);
  assert.deepEqual(session.state.archivedCompletedRoomLayouts, permanent.archives);
  session.send({ kind: "Move", direction: "right" });
  session.send({ kind: "Move", direction: "left" });
  session.send({ kind: "Interact" });
  assert.equal(session.state.mode, "completedRoom");
  session.send({ kind: "PracticeRoom" });
  for (const action of witness.actions) {
    assert.ok(action === "up" || action === "right" || action === "down" || action === "left");
    session.send({ kind: "Move", direction: action }, "accepted|success");
  }
  assert.deepEqual(session.state.completedRoomLayouts["c.theft.01"], first);
  assert.deepEqual(session.state.archivedCompletedRoomLayouts, permanent.archives);
  assert.deepEqual(session.state.claimedRewardIds, permanent.rewards);
  const checked = validatePayload(stablePayload(session.state), content, registry(content));
  assert.ok(checked.ok, checked.ok ? "" : checked.error);
});

test("R1 旧完成迷宫保留入口至出口自然通行；显式新版练习失败不生成完成布局", () => {
  const content = assembleContent("M5");
  const raw = JSON.parse(
    readFileSync(
      new URL(
        "../docs/verification/evidence/controls-readability/v1-full-collection-migration-save.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const validated = validatePayload(raw.payload, content, registry(content));
  assert.ok(validated.ok, validated.ok ? "" : validated.error);
  const session = new Session(content, restorePayload(validated.value, content, 0));
  const archives = structuredClone(session.state.archivedCompletedRoomLayouts);
  const rewards = [...session.state.claimedRewardIds];
  session.send({ kind: "Teleport", teleportId: "a.teleport" });
  for (let index = 0; index < 5; index++) session.send({ kind: "Move", direction: "right" });
  assert.equal(session.state.mode, "explore");
  assert.equal(session.state.playerPosition.tileId, "a.t.5.0");
  session.send({ kind: "Move", direction: "left" });
  session.send({ kind: "Interact" });
  assert.equal(session.state.activeStatic?.practice, true);
  for (let elapsed = 0; elapsed < 4000; elapsed += 100)
    session.send({ kind: "Tick" }, "accepted", 100);
  session.send({ kind: "Move", direction: "right" });
  session.send({ kind: "Move", direction: "right" }, "failed");
  assert.deepEqual(session.state.completedRoomLayouts, {});
  assert.deepEqual(session.state.archivedCompletedRoomLayouts, archives);
  assert.deepEqual(session.state.claimedRewardIds, rewards);
  const failed = validatePayload(stablePayload(session.state), content, registry(content));
  assert.ok(failed.ok, failed.ok ? "" : failed.error);
  assert.deepEqual(restorePayload(failed.value, content, session.time).completedRoomLayouts, {});
});
