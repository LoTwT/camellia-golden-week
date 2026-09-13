import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import { build, preview } from "vite";
import oldStatic from "../../src/content/history/pre-r1/static-content.ts";
import {
  createStatic as createOldStatic,
  moveStatic as moveOldStatic,
} from "../../src/content/history/pre-r1/static-puzzle.ts";
import type { StaticContent as OldStaticContent } from "../../src/content/history/pre-r1/static-puzzle.ts";
import { r1RoomLayoutMappings } from "../../src/content/history/r1-room-map.ts";
import { assembleContent, staticContent } from "../../src/content/assemble.ts";
import {
  createStatic,
  createCompletedStaticLayout,
  moveStatic,
  replayStaticWitness,
} from "../../src/core/static-puzzle.ts";
import type { StaticState, StaticWitness } from "../../src/core/static-puzzle.ts";
import type { GameState } from "../../src/core/types.ts";
import type { SavePayload } from "../../src/platform/save-payload.ts";
import type { SavePayload as HistoricalSavePayload } from "../../src/content/history/pre-r1/save-payload.ts";
import type { SaveEnvelope } from "../../src/platform/save-store.ts";
import { exportThroughUi, pressGameKey, waitForGameReady } from "./support.ts";

interface Observation {
  position: GameState["playerPosition"];
  mode: GameState["mode"];
  phase: string;
  pauseReasons: string[];
  completedObjectiveIds: string[];
  completedRoomLayouts: GameState["completedRoomLayouts"];
  claimedRewardIds: string[];
  staticRoom: {
    roomId: string;
    layout: StaticState["currentLayout"];
    undoDepth: number;
    practice: boolean;
  } | null;
  completedRoom: GameState["activeCompletedRoom"];
  transition: { active: boolean };
  lastResult: GameState["lastResult"];
}
const sourceUrl = new URL(
  "../../tests/fixtures/historical/controls-readability/v1-full-collection-migration-save.json",
  import.meta.url,
);
const sourceSha256 = "875124f82484520f3bc84c90e25dca69c3f5883b1184e923f66144333cdfcefb";
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const keys = { up: "ArrowUp", right: "ArrowRight", down: "ArrowDown", left: "ArrowLeft" };
async function observe(page: Page): Promise<Observation> {
  return page.evaluate(() =>
    (Reflect.get(window, "__CAMELLIA_INSPECT__") as { snapshot(): Observation }).snapshot(),
  );
}
async function startIsolatedGame(page: Page) {
  await page.getByRole("button", { name: "新游戏", exact: true }).click();
  await page.locator("#game-canvas[aria-busy='false']").waitFor({ state: "visible" });
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => done())));
  const startup = await observe(page);
  if (startup.pauseReasons.length) {
    assert.deepEqual(startup.pauseReasons, ["clockGap"]);
    assert.equal(
      await page.evaluate(() => document.hasFocus() && document.visibilityState === "visible"),
      true,
    );
    await page.getByRole("button", { name: "继续探索", exact: true }).click();
  }
  await waitForGameReady(page);
  return startup.pauseReasons.length ? startup : null;
}

async function closeExport(page: Page) {
  await page.getByRole("button", { name: "返回存档菜单", exact: true }).click();
  await page.getByRole("button", { name: "继续探索", exact: true }).click();
  await waitForGameReady(page);
}

/** P08 continuous UI chain. Browser/context state is observed only; all changes use visible game controls. */
export async function verifyR1LayoutMigration(options: {
  browser: Browser;
  url: string;
  outputDir: string;
  source?: { path: string; sha256: string };
  claimTheftReward?: boolean;
}) {
  const output = join(
    options.outputDir,
    options.claimTheftReward ? "layout-migration-unclaimed" : "layout-migration",
  );
  await mkdir(output, { recursive: true });
  const selectedSource = options.source ? pathToFileURL(resolve(options.source.path)) : sourceUrl;
  const expectedSourceHash = options.source?.sha256 ?? sourceSha256;
  const sourceBytes = await readFile(selectedSource);
  assert.equal(
    hash(sourceBytes),
    expectedSourceHash,
    "The historical source must remain the authentic recorded bytes",
  );
  const original = JSON.parse(sourceBytes.toString("utf8")) as SaveEnvelope<HistoricalSavePayload>;
  assert.equal(original.payload.schemaVersion, 2);
  assert.equal(original.payload.ruleVersion, 3);
  const oldVisit =
    original.payload.room?.status === "completedVisit" ? original.payload.room : null;
  if (!oldVisit) {
    assert.equal(original.payload.playerPosition.space, "world");
    assert.equal(original.payload.room, null);
  }
  const oldMapping = oldVisit
    ? r1RoomLayoutMappings[oldVisit.roomId as keyof typeof r1RoomLayoutMappings]
    : undefined;
  if (oldVisit) assert.ok(oldMapping?.kind === "archive");
  const importedPosition =
    oldMapping?.kind === "archive" ? oldMapping.safeEntrance : original.payload.playerPosition;
  const content = assembleContent("M5");
  const definition = content.staticChallenges.find((item) => item.id === "c.theft.01")!;
  assert.equal(definition.kind, "theft");
  const success = staticContent.witnesses.find(
    (item) => item.definitionId === definition.id && item.kind === "success",
  )!;
  const alternative = staticContent.witnesses.find(
    (item) => item.definitionId === definition.id && item.kind === "alternative",
  )!;
  assert.notDeepEqual(alternative.actions, success.actions);
  const solved = replayStaticWitness(definition, success);
  const other = replayStaticWitness(definition, alternative);
  assert.deepEqual(solved.errors, []);
  assert.deepEqual(other.errors, []);
  const expectedLayout = createCompletedStaticLayout(definition, solved.state, solved.playerTileId);
  const alternateLayout = createCompletedStaticLayout(definition, other.state, other.playerTileId);
  const expectedArchives = Object.entries(original.payload.completedRoomLayouts).map(
    ([roomId, layout]) => ({
      roomId,
      contentVersion: original.payload.contentVersion,
      ruleVersion: original.payload.ruleVersion,
      layout,
    }),
  );
  assert.equal(expectedArchives.length, options.claimTheftReward ? 6 : 9);
  const context = await options.browser.newContext({
    viewport: { width: 1512, height: 900 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const errors: string[] = [];
  const actions: Array<{
    index: number;
    label: string;
    startedAt: string;
    before: Observation | null;
    after?: Observation | null;
    failure?: string;
  }> = [];
  const startedAt = new Date().toISOString();
  let stage = "startup";
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  await context.tracing.start({ screenshots: true, snapshots: true });
  async function action(label: string, operation: () => Promise<void>) {
    stage = label;
    const entry: (typeof actions)[number] = {
      index: actions.length,
      label,
      startedAt: new Date().toISOString(),
      before: await observe(page).catch(() => null),
    };
    actions.push(entry);
    try {
      await operation();
      entry.after = await observe(page).catch(() => null);
    } catch (error) {
      entry.failure = String(error);
      throw error;
    }
  }
  async function ready() {
    await waitForGameReady(page);
    await page.waitForFunction(
      () =>
        !(Reflect.get(window, "__CAMELLIA_INSPECT__") as { snapshot(): Observation }).snapshot()
          .transition.active,
    );
    assert.deepEqual(
      (await observe(page)).pauseReasons,
      [],
      `${stage}: unexpected scheduling/focus pause`,
    );
  }
  async function expectPosition(tileId: string, mode?: Observation["mode"]) {
    await page.waitForFunction(
      ({ tileId, mode }) => {
        const state = (
          Reflect.get(window, "__CAMELLIA_INSPECT__") as { snapshot(): Observation }
        ).snapshot();
        return (
          state.position.tileId === tileId &&
          (!mode || state.mode === mode) &&
          !state.transition.active
        );
      },
      { tileId, mode },
    );
    await ready();
  }
  function preserved(payload: SavePayload) {
    assert.deepEqual(
      payload.archivedCompletedRoomLayouts,
      expectedArchives,
      "All original layouts remain archived unchanged",
    );
    for (const field of [
      "completedObjectiveIds",
      "claimedRewardIds",
      "bestResults",
      "capabilities",
      "activatedTeleportIds",
      "scopeCompletionHistory",
      "campaignCompletedAt",
    ] as const)
      assert.deepEqual(
        payload[field],
        original.payload[field],
        `practice/import preserves ${field}`,
      );
  }
  async function save(name: string, close = true): Promise<SaveEnvelope<SavePayload>> {
    const exported = await exportThroughUi(page);
    preserved(exported.payload);
    await writeFile(join(output, `${name}.json`), JSON.stringify(exported, null, 2) + "\n");
    if (close) await closeExport(page);
    return exported;
  }
  async function reloadAndExport(name: string) {
    await page.reload();
    await page.getByRole("button", { name: "继续游戏", exact: true }).click();
    await ready();
    return save(name);
  }
  async function enterPractice(expectExisting: boolean) {
    await ready();
    await pressGameKey(page, "f");
    if (expectExisting) {
      await expectPosition(definition.startTileId, "completedRoom");
      await pressGameKey(page, "f");
    }
    await expectPosition(definition.startTileId, "staticPuzzle");
    assert.equal((await observe(page)).staticRoom?.practice, true);
  }
  async function play(witness: StaticWitness, actionLimit = witness.actions.length) {
    let instance = createStatic(definition);
    for (const [index, direction] of witness.actions.slice(0, actionLimit).entries()) {
      assert.ok(
        direction === "up" || direction === "right" || direction === "down" || direction === "left",
      );
      const next = moveStatic(definition, instance.state, instance.playerTileId, direction);
      assert.equal(next.code, witness.expectedCodes[index]);
      await action(`${witness.id}:${index}:${direction}`, async () => {
        await ready();
        await pressGameKey(page, keys[direction]);
        if (next.success) await expectPosition("c.t.-2.-2", "explore");
        else {
          await expectPosition(next.playerTileId, "staticPuzzle");
          const actual = await observe(page);
          assert.deepEqual(actual.staticRoom?.layout, next.state.currentLayout);
        }
      });
      instance = { state: next.state, playerTileId: next.playerTileId };
    }
    return instance;
  }
  try {
    await action("new-isolated-game", async () => {
      await page.goto(options.url);
      await page.bringToFront();
      const startupPause = await startIsolatedGame(page);
      if (startupPause)
        await writeFile(join(output, "startup-pause.json"), JSON.stringify(startupPause, null, 2));
      await ready();
    });
    await action("import-authentic-v3-source", async () => {
      await page.getByRole("button", { name: "打开暂停菜单", exact: true }).click();
      await page.getByRole("button", { name: "进度与存档", exact: true }).click();
      const chooser = page.waitForEvent("filechooser");
      await page.getByRole("button", { name: "导入存档", exact: true }).click();
      await (await chooser).setFiles(fileURLToPath(selectedSource));
      await page.getByRole("heading", { name: "确认导入进度", exact: true }).waitFor();
      await page.screenshot({ path: join(output, "import-preview.png"), fullPage: true });
      await page.getByRole("button", { name: "确认替换", exact: true }).click();
      await expectPosition(importedPosition.tileId, "explore");
    });
    const imported = await save("01-imported");
    assert.equal(imported.payload.schemaVersion, 3);
    assert.equal(imported.payload.contentVersion, content.contentVersion);
    assert.equal(imported.payload.ruleVersion, 4);
    assert.deepEqual(imported.payload.completedRoomLayouts, {});
    assert.deepEqual(imported.payload.playerPosition, importedPosition);
    assert.equal(imported.payload.room, null);
    if (options.claimTheftReward)
      await action("old-unclaimed-gate-open-immediately-before-new-practice", async () => {
        await ready();
        await pressGameKey(page, "ArrowUp");
        await expectPosition("c.t.-2.-3", "explore");
        assert.equal((await observe(page)).claimedRewardIds.includes("c.supply.theft01"), false);
        await pressGameKey(page, "ArrowDown");
        await expectPosition("c.t.-2.-2", "explore");
      });
    await action("archived-maze-current-practice-real-hazard-failure", async () => {
      await pressGameKey(page, "m");
      await page
        .getByRole("button", {
          name: `${content.areas.find((area) => area.id === "a")!.label} · 已激活`,
          exact: true,
        })
        .click();
      await expectPosition("a.t.0.0", "explore");
      for (let index = 0; index < 4; index++) {
        await ready();
        await pressGameKey(page, "ArrowRight");
      }
      await expectPosition("a.t.4.0", "explore");
      await pressGameKey(page, "f");
      await page.waitForFunction(
        () =>
          (Reflect.get(window, "__CAMELLIA_INSPECT__") as { snapshot(): Observation }).snapshot()
            .phase === "active",
      );
      await ready();
      await pressGameKey(page, "ArrowRight");
      await pressGameKey(page, "ArrowRight");
      const failed = await observe(page);
      assert.equal(failed.phase, "preview");
      assert.equal(failed.lastResult.code, "failed");
      assert.equal(failed.staticRoom?.practice, true);
      const failedSave = await save("01a-real-failed-practice");
      assert.deepEqual(failedSave.payload.completedRoomLayouts, {});
      await page.getByRole("button", { name: "打开暂停菜单", exact: true }).click();
      await page.getByRole("button", { name: "放弃本次尝试，返回入口", exact: true }).click();
      await expectPosition("a.t.3.0", "explore");
    });
    await action("normal-teleport-and-walk-to-theft01", async () => {
      await pressGameKey(page, "m");
      await page
        .getByRole("button", {
          name: `${content.areas.find((area) => area.id === "c")!.label} · 已激活`,
          exact: true,
        })
        .click();
      await expectPosition("c.t.0.0", "explore");
      for (const direction of ["up", "up", "left", "left"] as const) {
        await ready();
        await pressGameKey(page, keys[direction]);
      }
      await expectPosition("c.t.-2.-2", "explore");
    });
    await action("explicit-new-practice-without-current-layout", () => enterPractice(false));
    let prefix = createStatic(definition),
      prefixCount = 0;
    for (const direction of success.actions) {
      assert.ok(
        direction === "up" || direction === "right" || direction === "down" || direction === "left",
      );
      const next = moveStatic(definition, prefix.state, prefix.playerTileId, direction);
      prefix = { state: next.state, playerTileId: next.playerTileId };
      prefixCount++;
      if (Object.keys(prefix.state.currentLayout.theft!.assemblyByAmplifierId).length > 0) break;
    }
    assert.ok(prefixCount < success.actions.length);
    await play(success, prefixCount);
    const midway = await save("02-midway-first-assembly", false);
    assert.deepEqual(midway.payload.completedRoomLayouts, {});
    assert.equal(midway.payload.room?.status, "active");
    const refreshed = await reloadAndExport("03-midway-refreshed");
    assert.deepEqual(refreshed.payload, midway.payload);
    assert.equal(
      (await observe(page)).staticRoom?.undoDepth,
      0,
      "refresh discards undo history only",
    );
    await action("abandon-does-not-create-current-layout", async () => {
      await page.getByRole("button", { name: "打开暂停菜单", exact: true }).click();
      await page.getByRole("button", { name: "放弃本次尝试，返回入口", exact: true }).click();
      await expectPosition("c.t.-2.-2", "explore");
    });
    assert.deepEqual((await save("04-abandoned")).payload.completedRoomLayouts, {});
    await action("restart-first-current-attempt", () => enterPractice(false));
    await play(success);
    const first = await save("05-first-actual-success", false);
    assert.deepEqual(Object.keys(first.payload.completedRoomLayouts), [definition.id]);
    const firstRecord = first.payload.completedRoomLayouts[definition.id]!;
    assert.deepEqual(firstRecord, {
      contentVersion: content.contentVersion,
      ruleVersion: content.ruleVersion,
      layout: expectedLayout,
    });
    const firstReload = await reloadAndExport("06-first-success-refreshed");
    assert.deepEqual(firstReload.payload, first.payload);
    await action("revisit-first-current-layout-and-enter-independent-practice", () =>
      enterPractice(true),
    );
    await play(alternative);
    const replayed = await save("07-alternative-success", false);
    assert.deepEqual(replayed.payload.completedRoomLayouts[definition.id], firstRecord);
    const final = await reloadAndExport("08-alternative-refreshed");
    assert.deepEqual(final.payload, replayed.payload);
    assert.deepEqual(final.payload.completedRoomLayouts[definition.id], firstRecord);
    let claimedOnce: SaveEnvelope<SavePayload> | null = null;
    if (options.claimTheftReward) {
      assert.equal(original.payload.claimedRewardIds.includes("c.supply.theft01"), false);
      await action("old-unclaimed-reward-still-reachable-and-claimed-once", async () => {
        await ready();
        await pressGameKey(page, "ArrowUp");
        await expectPosition("c.t.-2.-3", "explore");
        await pressGameKey(page, "ArrowUp");
        await expectPosition("c.t.-2.-4", "explore");
        const earned = await exportThroughUi(page);
        assert.equal(content.rewards.find((reward) => reward.id === "c.supply.theft01")?.units, 5);
        assert.deepEqual(earned.payload.claimedRewardIds, [
          ...original.payload.claimedRewardIds,
          "c.supply.theft01",
        ]);
        assert.deepEqual(
          earned.payload.completedObjectiveIds,
          original.payload.completedObjectiveIds,
        );
        assert.deepEqual(earned.payload.archivedCompletedRoomLayouts, expectedArchives);
        assert.deepEqual(earned.payload.completedRoomLayouts, final.payload.completedRoomLayouts);
        await writeFile(
          join(output, "09-old-unclaimed-reward-earned.json"),
          JSON.stringify(earned, null, 2) + "\n",
        );
        await closeExport(page);
        await pressGameKey(page, "ArrowDown");
        await pressGameKey(page, "ArrowUp");
        await expectPosition("c.t.-2.-4", "explore");
        const repeated = await exportThroughUi(page);
        assert.deepEqual(repeated.payload.claimedRewardIds, earned.payload.claimedRewardIds);
        await page.reload();
        await page.getByRole("button", { name: "继续游戏", exact: true }).click();
        await ready();
        const reloaded = await exportThroughUi(page);
        assert.deepEqual(reloaded.payload, repeated.payload);
        await writeFile(
          join(output, "10-old-reward-repeat-refreshed.json"),
          JSON.stringify(reloaded, null, 2) + "\n",
        );
        claimedOnce = reloaded;
        await closeExport(page);
      });
    }
    await page.screenshot({ path: join(output, "final-preserved-world.png"), fullPage: true });
    assert.deepEqual(errors, []);
    assert.equal(hash(await readFile(selectedSource)), expectedSourceHash);
    const result = {
      sourcePath: fileURLToPath(selectedSource),
      sourceSha256: expectedSourceHash,
      sourceVersion: { schema: 2, content: original.payload.contentVersion, rule: 3 },
      sourcePosition: original.payload.playerPosition,
      completedVisitMigration: oldVisit
        ? { roomId: oldVisit.roomId, restoredTo: importedPosition, normalHistoricalUiSource: true }
        : "not covered: authentic source is world-positioned; no synthetic completedVisit is presented as a normal UI chain",
      browser: options.browser.version(),
      startedAt,
      finishedAt: new Date().toISOString(),
      initialArchiveCount: expectedArchives.length,
      normalUiOnly: true,
      midpointAfterActions: prefixCount,
      firstSuccessWitness: success.id,
      alternativeWitness: alternative.id,
      alternativeMeaning:
        "A different legal walking sequence; fixed colored ports yield the same final component layout. Distinct final-layout nonreplacement remains independently covered by capture02 rule tests.",
      alternativeFinalLayoutEqualsFirst:
        JSON.stringify(alternateLayout) === JSON.stringify(expectedLayout),
      finalCurrentRoomIds: Object.keys(final.payload.completedRoomLayouts),
      oldUnclaimedReward: claimedOnce
        ? { rewardId: "c.supply.theft01", claimedExactlyOnce: true, remainsAfterReload: true }
        : null,
      actions,
      errors,
    };
    await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2) + "\n");
    return result;
  } catch (error) {
    const id = `failure-${Date.now()}`;
    await page.screenshot({ path: join(output, `${id}.png`), fullPage: true }).catch(() => {});
    await writeFile(
      join(output, `${id}.json`),
      JSON.stringify(
        {
          sourcePath: fileURLToPath(selectedSource),
          sourceSha256: expectedSourceHash,
          startedAt,
          stage,
          actions,
          errors,
          observed: await observe(page).catch(() => null),
          error: String(error),
        },
        null,
        2,
      ) + "\n",
    );
    throw error;
  } finally {
    await context.tracing.stop({ path: join(output, `trace-${Date.now()}.zip`) }).catch(() => {});
    await context.close();
  }
}

/** Generate a genuine old completedVisit by importing and playing only the frozen historical UI. */
export async function authorHistoricalCompletedVisit(options: {
  browser: Browser;
  url: string;
  outputDir: string;
  baselineCommit: string;
  unclaimed?: boolean;
}) {
  const output = join(
    options.outputDir,
    options.unclaimed ? "historical-unclaimed-theft" : "historical-completed-visit",
  );
  await mkdir(output, { recursive: true });
  const authorSourceUrl = options.unclaimed
    ? new URL("../../tests/fixtures/historical/m2-browser-save.json", import.meta.url)
    : sourceUrl;
  const authorSourceHash = options.unclaimed
    ? "b8e6fcaac082820270ccc4c19c214d6f1f98d786426b9904a037aefcfc13fe18"
    : sourceSha256;
  const bytes = await readFile(authorSourceUrl);
  assert.equal(hash(bytes), authorSourceHash);
  const original = JSON.parse(bytes.toString()) as SaveEnvelope<HistoricalSavePayload>;
  const context = await options.browser.newContext({ viewport: { width: 1512, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const steps: unknown[] = [],
    errors: string[] = [];
  const startedAt = new Date().toISOString();
  page.on("pageerror", (error) => errors.push(error.message));
  await context.tracing.start({ screenshots: true, snapshots: true });
  let stage = "startup";
  async function expected(tileId: string, mode: string) {
    await page.waitForFunction(
      ({ tileId, mode }) => {
        const state = (
          Reflect.get(window, "__CAMELLIA_INSPECT__") as { snapshot(): Observation }
        ).snapshot();
        return state.position.tileId === tileId && state.mode === mode && !state.transition.active;
      },
      { tileId, mode },
    );
    await waitForGameReady(page);
    assert.deepEqual((await observe(page)).pauseReasons, []);
    steps.push({ stage, observed: await observe(page) });
  }
  try {
    await page.goto(options.url);
    await page.bringToFront();
    const startupPause = await startIsolatedGame(page);
    if (startupPause)
      await writeFile(join(output, "startup-pause.json"), JSON.stringify(startupPause, null, 2));
    await page.getByRole("button", { name: "打开暂停菜单", exact: true }).click();
    await page.getByRole("button", { name: "进度与存档", exact: true }).click();
    stage = "import-authentic-v3-world-source";
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "导入存档", exact: true }).click();
    await (await chooser).setFiles(fileURLToPath(authorSourceUrl));
    await page.getByRole("button", { name: "确认替换", exact: true }).click();
    await expected(original.payload.playerPosition.tileId, "explore");
    const imported = await exportThroughUi(page);
    if (!options.unclaimed) assert.deepEqual(imported.payload, original.payload);
    else
      for (const key of ["completedObjectiveIds", "claimedRewardIds", "bestResults"] as const)
        assert.deepEqual(imported.payload[key], original.payload[key]);
    await closeExport(page);
    if (options.unclaimed) {
      stage = "normal-B-to-C-after-real-M2-upgrade";
      for (let x = 5; x <= 8; x++) {
        await pressGameKey(page, "ArrowRight");
        await expected(`b.t.${x}.0`, "explore");
      }
      await pressGameKey(page, "f");
    } else {
      stage = "normal-map-teleport-to-C";
      await pressGameKey(page, "m");
      await page.getByRole("button", { name: "仓储区 C · 已激活", exact: true }).click();
    }
    await expected("c.t.0.0", "explore");
    for (const [direction, tile] of [
      ["up", "c.t.0.-1"],
      ["up", "c.t.0.-2"],
      ["left", "c.t.-1.-2"],
      ["left", "c.t.-2.-2"],
    ] as const) {
      stage = `normal-key-${direction}`;
      await pressGameKey(page, keys[direction]);
      await expected(tile, "explore");
    }
    if (options.unclaimed) {
      stage = "normal-old-theft-first-success-without-pickup";
      await pressGameKey(page, "f");
      const oldContent = oldStatic as unknown as OldStaticContent;
      const definition = oldContent.definitions.find((item) => item.id === "c.theft.01")!;
      const witness = oldContent.witnesses.find(
        (item) => item.id === "c.theft.01.witness.success",
      )!;
      let instance = createOldStatic(definition);
      await expected(instance.playerTileId, "staticPuzzle");
      for (const direction of witness.actions) {
        assert.ok(
          direction === "up" ||
            direction === "right" ||
            direction === "down" ||
            direction === "left",
        );
        const next = moveOldStatic(definition, instance.state, instance.playerTileId, direction);
        stage = `normal-old-theft-${direction}`;
        await pressGameKey(page, keys[direction]);
        await expected(
          next.success ? "c.t.-2.-2" : next.playerTileId,
          next.success ? "explore" : "staticPuzzle",
        );
        instance = { state: next.state, playerTileId: next.playerTileId };
      }
      const observation = await observe(page);
      assert.ok(observation.completedObjectiveIds.includes("c.theft.01"));
      assert.equal(observation.claimedRewardIds.includes("c.supply.theft01"), false);
    }
    stage = "normal-F-old-completed-visit";
    await pressGameKey(page, "f");
    await page.waitForFunction(
      () =>
        (Reflect.get(window, "__CAMELLIA_INSPECT__") as { snapshot(): Observation }).snapshot()
          .mode === "completedRoom",
    );
    await waitForGameReady(page);
    steps.push({ stage, observed: await observe(page) });
    await page.screenshot({ path: join(output, "old-completed-visit.png"), fullPage: true });
    const saved = await exportThroughUi(page);
    const historical = saved as unknown as SaveEnvelope<HistoricalSavePayload>;
    assert.equal(historical.payload.schemaVersion, 2);
    assert.equal(historical.payload.ruleVersion, 3);
    assert.equal(historical.payload.room?.status, "completedVisit");
    assert.equal(historical.payload.room?.roomId, "c.theft.01");
    assert.equal(historical.payload.playerPosition.space, "room");
    if (options.unclaimed) {
      assert.deepEqual(historical.payload.claimedRewardIds, original.payload.claimedRewardIds);
      assert.deepEqual(historical.payload.bestResults, original.payload.bestResults);
      assert.deepEqual(historical.payload.completedObjectiveIds, [
        ...original.payload.completedObjectiveIds,
        "c.theft.01",
      ]);
      assert.equal(historical.payload.claimedRewardIds.includes("c.supply.theft01"), false);
      assert.equal(Object.keys(historical.payload.completedRoomLayouts).length, 6);
    } else
      for (const key of [
        "completedObjectiveIds",
        "completedRoomLayouts",
        "claimedRewardIds",
        "bestResults",
      ] as const)
        assert.deepEqual(historical.payload[key], original.payload[key]);
    const raw = await page.getByRole("textbox", { name: "完整存档文本", exact: true }).inputValue();
    const savePath = join(output, "old-completed-visit-save.json");
    await writeFile(savePath, raw);
    const result = {
      baselineCommit: options.baselineCommit,
      startedAt,
      finishedAt: new Date().toISOString(),
      browser: options.browser.version(),
      sourcePath: fileURLToPath(authorSourceUrl),
      sourceSha256: authorSourceHash,
      unclaimedRewardId: options.unclaimed ? "c.supply.theft01" : null,
      savePath,
      saveSha256: hash(Buffer.from(raw)),
      inputMethod: options.unclaimed
        ? "Normal UI import of authentic M2, four right keys and portal F to C, normal old theft success without northern supply pickup, F completed visit, UI export; no state or storage injection"
        : "Normal UI file chooser, map button, four direction keys, F completed visit and UI export; no state or storage injection",
      steps,
      errors,
    };
    assert.deepEqual(errors, []);
    await writeFile(join(output, "source-provenance.json"), JSON.stringify(result, null, 2) + "\n");
    return result;
  } catch (error) {
    const id = `failure-${Date.now()}`;
    await page.screenshot({ path: join(output, `${id}.png`) }).catch(() => {});
    await writeFile(
      join(output, `${id}.json`),
      JSON.stringify(
        {
          startedAt,
          stage,
          steps,
          errors,
          observed: await observe(page).catch(() => null),
          error: String(error),
        },
        null,
        2,
      ) + "\n",
    );
    throw error;
  } finally {
    await context.tracing.stop({ path: join(output, `trace-${Date.now()}.zip`) }).catch(() => {});
    await context.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const oldIndex = process.argv.indexOf("--author-old");
  const oldRoot = oldIndex >= 0 ? resolve(process.argv[oldIndex + 1]!) : undefined;
  const directory = resolve(
    oldRoot ? "test-results/r1-old-layout-source-build" : "test-results/r1-layout-migration-build",
  );
  const oldConfig = oldRoot ? { root: oldRoot, configFile: join(oldRoot, "vite.config.ts") } : {};
  const outputDir = resolve("test-results/r1-browser");
  await build({ ...oldConfig, mode: "acceptance", build: { outDir: directory } });
  const server = await preview({
    ...oldConfig,
    mode: "acceptance",
    build: { outDir: directory },
    preview: { host: "127.0.0.1", port: 0, strictPort: true },
  });
  const address = server.httpServer.address();
  assert.ok(address && typeof address !== "string");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const url = `http://127.0.0.1:${address.port}`;
    if (oldRoot)
      await authorHistoricalCompletedVisit({
        browser,
        url,
        outputDir,
        baselineCommit: "7fe7d8e9179e0c9dcef505f454232a9a38321234",
        unclaimed: process.argv.includes("--unclaimed"),
      });
    else {
      const sourceIndex = process.argv.indexOf("--source");
      const shaIndex = process.argv.indexOf("--source-sha");
      if (sourceIndex >= 0) assert.ok(shaIndex >= 0, "--source requires the recorded --source-sha");
      await verifyR1LayoutMigration({
        claimTheftReward: process.argv.includes("--unclaimed"),
        browser,
        url,
        outputDir,
        ...(sourceIndex >= 0
          ? {
              source: { path: process.argv[sourceIndex + 1]!, sha256: process.argv[shaIndex + 1]! },
            }
          : {}),
      });
    }
  } finally {
    await browser.close();
    await new Promise<void>((done) => server.httpServer.close(() => done()));
  }
}
