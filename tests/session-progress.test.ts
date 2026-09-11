// These tests replay the original v1 recordings/exports against their published content view.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assembleLegacyContent as assembleContent } from "../src/content/assemble.ts";
import { createGame, dispatch } from "../src/core/engine.ts";
import type { GameCommand } from "../src/core/types.ts";
import { restorePayload, stablePayload, validatePayload } from "../src/platform/save-payload.ts";
import type { SavePayload } from "../src/platform/save-payload.ts";
import { createSaveStore, SAVE_KEYS } from "../src/platform/save-store.ts";
import type { SaveEnvelope, SaveStorage } from "../src/platform/save-store.ts";
import {
  LoadedProgressAccess,
  originalSlotExportChoices,
} from "../src/platform/session-progress.ts";

const content = assembleContent("M5");
const savedAt = "2026-09-11T08:00:00.000Z";
const retainedRaw = readFileSync(
  new URL("../docs/verification/evidence/m5-production-iab-save.json", import.meta.url),
  "utf8",
);
const latestRaw = readFileSync(
  new URL("../docs/verification/evidence/m5-production-chrome-restored-save.json", import.meta.url),
  "utf8",
);
const retained = JSON.parse(retainedRaw) as SaveEnvelope<SavePayload>;
const latest = JSON.parse(latestRaw) as SaveEnvelope<SavePayload>;

class MemoryStorage implements SaveStorage {
  readonly values = new Map<string, string>();
  writes = 0;
  failNextWrite = false;

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.writes += 1;
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error("测试存储失败");
    }
    this.values.set(key, value);
  }
}

function sessionHarness() {
  const storage = new MemoryStorage();
  storage.values.set(SAVE_KEYS.a, retainedRaw);
  let held = true;
  let temporary = false;
  const store = createSaveStore(
    storage,
    (payload) => validatePayload(payload, content),
    () => held && !temporary,
  );
  let inspection = store.inspect();
  const access = new LoadedProgressAccess();
  access.activate(retained.saveGeneration);
  let state = restorePayload(retained.payload, content, 1000);
  let now = 1000;
  return {
    storage,
    store,
    access,
    get state() {
      return state;
    },
    get inspection() {
      return inspection;
    },
    get held() {
      return held;
    },
    setHeld(value: boolean) {
      held = value;
    },
    setTemporary(value: boolean) {
      temporary = value;
    },
    inspect() {
      inspection = store.inspect();
      return inspection;
    },
    activate(payload: SavePayload, generation: number) {
      state = restorePayload(payload, content, now);
      access.activate(generation);
    },
    send(command: GameCommand) {
      if (!access.canPlay(held, temporary)) return null;
      now += 180;
      const result = dispatch(content, state, command, now, savedAt);
      state = result.state;
      if (result.stable && !temporary) this.save();
      return result;
    },
    save() {
      if (!access.canPlay(held, temporary)) return null;
      const result = store.write(stablePayload(state), {
        expected: inspection,
        intent: "retry",
        savedAt,
      });
      inspection = result.retryInspection;
      if (result.ok) access.recordSavedGeneration(result.envelope.saveGeneration);
      return result;
    },
  };
}

test("P10 恢复页 busy：原槽导出使用新磁盘原文，旧内存保留自己的代数且不能继续", () => {
  const game = sessionHarness();
  const memoryBefore = structuredClone(game.state);
  game.access.suspend();
  game.setHeld(false);
  game.storage.values.set(SAVE_KEYS.a, latestRaw);
  game.inspect();
  assert.equal(game.inspection.maxGeneration, latest.saveGeneration);

  let shownRaw: string | null = null;
  let onReturn: (() => void) | undefined;
  let returnedToSessionDecision = 0;
  const choices = originalSlotExportChoices(
    game.inspection,
    (original, close) => {
      shownRaw = original.raw;
      onReturn = close;
    },
    () => {
      returnedToSessionDecision += 1;
    },
  );
  assert.equal(choices.length, 1);
  choices[0]!.action();
  assert.equal(shownRaw, latestRaw);
  assert.ok(onReturn);
  onReturn();
  assert.equal(returnedToSessionDecision, 1);

  const commands: GameCommand[] = [
    { kind: "Resume", pageVisible: true, canvasOperable: true, graphicsAvailable: true },
    { kind: "Move", direction: "left" },
    { kind: "Tick" },
    { kind: "Interact" },
    { kind: "Settings", settings: { ...game.state.settings, masterVolume: 0.1 } },
  ];
  for (const command of commands) assert.equal(game.send(command), null);
  assert.equal(game.save(), null);
  assert.deepEqual(game.state, memoryBefore);
  const memory = game.store.exportMemory(
    stablePayload(game.state),
    savedAt,
    game.access.exportGeneration(),
  );
  assert.equal(memory.ok, true);
  const memoryEnvelope = JSON.parse(memory.raw) as SaveEnvelope<SavePayload>;
  assert.equal(memoryEnvelope.saveGeneration, retained.saveGeneration);
  assert.deepEqual(memoryEnvelope.payload, retained.payload);
  assert.notDeepEqual(memoryEnvelope.payload, latest.payload);
  assert.equal(game.storage.writes, 0);
  assert.equal(game.storage.values.get(SAVE_KEYS.a), latestRaw);
});

test("P10 重新取得锁仍不能操作旧副本；显式继续重读的最新槽后才正常写下一代", () => {
  const game = sessionHarness();
  game.access.suspend();
  game.setHeld(false);
  game.storage.values.set(SAVE_KEYS.a, latestRaw);
  game.setHeld(true);
  game.inspect();
  assert.equal(game.send({ kind: "Move", direction: "left" }), null);
  assert.equal(game.save(), null);
  assert.equal(game.storage.writes, 0);
  const slot = game.inspection.latest;
  assert.ok(slot?.payload && slot.envelope);
  game.activate(slot.payload, slot.envelope.saveGeneration);
  const result = game.send({ kind: "Move", direction: "left" });
  assert.equal(result?.code, "accepted");
  assert.equal(game.state.playerPosition.tileId, "warehouse.t.6.0");
  assert.equal(game.inspection.maxGeneration, latest.saveGeneration + 1);
  assert.equal(game.access.exportGeneration(), latest.saveGeneration + 1);
  assert.deepEqual(game.state.claimedRewardIds, latest.payload.claimedRewardIds);
  assert.equal(game.storage.values.get(SAVE_KEYS.a), latestRaw);
});

test("P10 离开后不沿用显式临时授权；重新确认新临时进度才可操作且不写原槽", () => {
  const game = sessionHarness();
  game.setHeld(false);
  game.setTemporary(true);
  game.access.suspend();
  assert.equal(game.send({ kind: "Move", direction: "right" }), null);
  const initial = stablePayload(createGame(content, 1000));
  game.activate(initial, 1);
  const result = game.send({ kind: "Move", direction: "right" });
  assert.equal(result?.code, "accepted");
  assert.equal(game.state.playerPosition.tileId, "hub.t.1.2");
  assert.equal(game.access.exportGeneration(), 1);
  assert.equal(game.storage.writes, 0);
  assert.equal(game.storage.values.get(SAVE_KEYS.a), retainedRaw);
});

test("P03/P10 未保存的当前内存导出沿用最后确认代数，成功重试后再更新", () => {
  const game = sessionHarness();
  game.storage.failNextWrite = true;
  assert.equal(game.send({ kind: "Move", direction: "left" })?.code, "accepted");
  assert.equal(game.access.exportGeneration(), retained.saveGeneration);
  assert.equal(game.inspection.maxGeneration, retained.saveGeneration);
  const unsaved = stablePayload(game.state);
  assert.notDeepEqual(unsaved, retained.payload);
  const result = game.save();
  assert.equal(result?.ok, true);
  assert.equal(game.access.exportGeneration(), retained.saveGeneration + 1);
  assert.deepEqual(game.inspection.latest?.payload, unsaved);
});

test("P04/P10 只读原槽包含损坏和较新版本字节，每次关闭都回原会话决定", () => {
  const storage = new MemoryStorage();
  const corrupt = "{\n  broken json\n";
  const future = JSON.parse(latestRaw) as SaveEnvelope<SavePayload>;
  future.payload.schemaVersion += 1;
  const futureRaw = JSON.stringify(future, null, 3) + "\n";
  storage.values.set(SAVE_KEYS.a, corrupt);
  storage.values.set(SAVE_KEYS.b, futureRaw);
  const store = createSaveStore(
    storage,
    (payload) => validatePayload(payload, content),
    () => false,
  );
  const inspection = store.inspect();
  assert.equal(inspection.status, "future");
  const shown: string[] = [];
  let returned = 0;
  const choices = originalSlotExportChoices(
    inspection,
    ({ raw }, close) => {
      shown.push(raw);
      close();
    },
    () => {
      returned += 1;
    },
  );
  for (const choice of choices) choice.action();
  assert.deepEqual(shown, [corrupt, futureRaw]);
  assert.equal(returned, 2);
  assert.equal(storage.writes, 0);
});

test("P09/P10 读取失败不把旧内存伪装为可读取原槽", () => {
  const store = createSaveStore(
    {
      getItem() {
        throw new Error("读取被拒绝");
      },
      setItem() {
        throw new Error("只读会话不能写入");
      },
    },
    (payload) => validatePayload(payload, content),
    () => false,
  );
  const inspection = store.inspect();
  assert.equal(inspection.status, "unavailable");
  const choices = originalSlotExportChoices(
    inspection,
    () => assert.fail("不可读原槽不应有导出动作"),
    () => assert.fail("没有打开导出视图"),
  );
  assert.deepEqual(choices, []);
});
