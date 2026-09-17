import assert from "node:assert/strict";
import test from "node:test";
import { assembleContent, migrationContentReleases } from "../src/content/assemble.ts";
import { worldWitnesses } from "../src/content/witnesses/index.ts";
import { createGame, dispatch } from "../src/core/engine.ts";
import type { GameCommand } from "../src/core/types.ts";
import { publishedProfileMigrations } from "../src/platform/migrations.ts";
import { restorePayload, stablePayload, validatePayload } from "../src/platform/save-payload.ts";
import { createSaveStore } from "../src/platform/save-store.ts";

const content = assembleContent("M5");
const registry = publishedProfileMigrations(migrationContentReleases("M5"));
const validate = (value: unknown) => validatePayload(value, content, registry);
const entranceCommands: GameCommand[] = [
  ...Array.from({ length: 3 }, (): GameCommand => ({ kind: "Move", direction: "right" })),
  { kind: "Amplify" },
  ...Array.from({ length: 3 }, (): GameCommand => ({ kind: "Move", direction: "right" })),
  { kind: "Interact" },
  ...Array.from({ length: 3 }, (): GameCommand => ({ kind: "Move", direction: "up" })),
  { kind: "Move", direction: "right" },
];

function enterFromSide() {
  let state = createGame(content);
  let now = 0;
  for (const command of entranceCommands)
    state = dispatch(content, state, command, (now += 140)).state;
  assert.equal(state.activeStatic?.roomId, "a.maze.02");
  assert.equal(state.visitedTileIds.includes("a.t.1.-2"), false);
  assert.equal(state.discoveredTileIds.includes("a.t.1.-2"), true);
  return { state, now };
}

test("侧路首次进入迷宫：入口、观察后移动和重置均能写入双槽、导入与恢复，不虚构返回点访问", () => {
  const values = new Map<string, string>();
  const store = createSaveStore(
    {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
      },
    },
    validate,
    () => true,
  );
  let { state, now } = enterFromSide();
  function saveAndRestore() {
    const payload = stablePayload(state);
    const saved = store.write(payload, {
      expected: store.inspect(),
      intent: "auto",
      savedAt: "2026-09-13T00:00:00.000Z",
    });
    assert.ok(saved.ok, saved.ok ? "" : saved.message);
    const imported = store.prepareImport(JSON.stringify(saved.envelope));
    assert.ok(imported.ok, imported.ok ? "" : imported.message);
    assert.deepEqual(imported.payload, payload);
    const restored = restorePayload(imported.payload, content, now);
    assert.deepEqual(restored.playerPosition, state.playerPosition);
    assert.deepEqual(
      restored.activeStatic?.state.currentLayout,
      state.activeStatic?.state.currentLayout,
    );
    assert.equal(restored.visitedTileIds.includes("a.t.1.-2"), false);
  }
  saveAndRestore();
  for (let index = 0; index < 40; index++)
    state = dispatch(content, state, { kind: "Tick" }, (now += 100)).state;
  assert.equal(state.activeStatic?.state.phase, "active");
  state = dispatch(content, state, { kind: "Move", direction: "right" }, (now += 140)).state;
  saveAndRestore();
  state = dispatch(content, state, { kind: "ResetRoom" }, (now += 140)).state;
  saveAndRestore();
  state = dispatch(content, state, { kind: "ExitRoom" }, (now += 140)).state;
  assert.equal(state.playerPosition.tileId, "a.t.1.-2");
  assert.equal(state.visitedTileIds.includes("a.t.1.-2"), true);
  assert.ok(validate(stablePayload(state)).ok);
});

test("返回锚点仍须为本房间固定安全点；真实玩家位置仍须已访问", () => {
  const { state } = enterFromSide();
  const valid = stablePayload(state);
  assert.ok(validate(valid).ok);
  const wrongAnchor = structuredClone(valid);
  assert.ok(wrongAnchor.room);
  wrongAnchor.room.returnAnchor.tileId = "a.t.0.-3";
  assert.equal(validate(wrongAnchor).ok, false, "已访问的其他安全格不能冒充固定返回点");
  const undiscovered = structuredClone(valid);
  undiscovered.discoveredTileIds = undiscovered.discoveredTileIds.filter((id) => id !== "a.t.1.-2");
  assert.equal(validate(undiscovered).ok, false);
  const playerAtUnvisited = structuredClone(valid);
  assert.ok(playerAtUnvisited.room);
  playerAtUnvisited.playerPosition = playerAtUnvisited.room.returnAnchor;
  playerAtUnvisited.room = null;
  assert.equal(validate(playerAtUnvisited).ok, false, "仅返回锚点可尚未访问");
});

for (const witness of worldWitnesses) {
  test(`每个稳定事务的存档有效：${witness.id}`, () => {
    const source = assembleContent(witness.profileId);
    const migrations = publishedProfileMigrations(migrationContentReleases(witness.profileId));
    let state = createGame(source);
    let checked = 0;
    for (const [index, step] of witness.steps.entries()) {
      const result = dispatch(source, state, step.command, step.atMs);
      state = result.state;
      if (!result.stable) continue;
      const payload = stablePayload(state);
      const validated = validatePayload(payload, source, migrations);
      assert.ok(validated.ok, `步骤 ${index + 1}: ${validated.ok ? "" : validated.error}`);
      const restored = restorePayload(validated.value, source, step.atMs);
      assert.deepEqual(restored.playerPosition, payload.playerPosition);
      assert.deepEqual(restored.resumeHint, payload.resumeHint);
      const recovered = stablePayload(restored);
      assert.ok(validatePayload(recovered, source, migrations).ok);
      assert.deepEqual(recovered.room, payload.room);
      assert.deepEqual(recovered.completedObjectiveIds, payload.completedObjectiveIds);
      assert.deepEqual(recovered.claimedRewardIds, payload.claimedRewardIds);
      checked++;
    }
    assert.ok(checked > 0);
  });
}
