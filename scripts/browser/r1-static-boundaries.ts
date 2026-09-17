import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Browser, Page } from "playwright";
import { staticContent } from "../../src/content/assemble.ts";
import {
  activateStatic,
  createStatic,
  moveStatic,
  resetStatic,
  undoStatic,
} from "../../src/core/static-puzzle.ts";
import type { StaticWitness } from "../../src/core/static-puzzle.ts";
import { R1NormalDriver, observeR1 } from "./r1-visual-performance.ts";
import { exportThroughUi, pressGameKey, waitForGameReady } from "./support.ts";
const keys = { up: "ArrowUp", right: "ArrowRight", down: "ArrowDown", left: "ArrowLeft" };
async function closeExport(page: Page) {
  await page.getByRole("button", { name: "返回存档菜单", exact: true }).click();
  await page.getByRole("button", { name: "继续探索", exact: true }).click();
  await waitForGameReady(page);
}
/** All initial progress comes from the normally earned full-collection file; no synthetic browser state. */
export async function verifyR1StaticBoundaries(options: {
  browser: Browser;
  url: string;
  outputDir: string;
  sourceSavePath: string;
}) {
  const output = join(options.outputDir, "static-boundaries");
  await mkdir(output, { recursive: true });
  const results: unknown[] = [];
  for (const definition of staticContent.definitions) {
    const context = await options.browser.newContext({ viewport: { width: 1512, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const steps: unknown[] = [],
      errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const directory = join(output, definition.id);
    await mkdir(directory, { recursive: true });
    try {
      const driver = await R1NormalDriver.importEarned(page, options.url, options.sourceSavePath);
      const original = await observeR1(page);
      await driver.enterRoom(definition.id);
      let local = createStatic(definition);
      const initial = await observeR1(page);
      assert.equal(initial.staticRoom?.practice, true);
      async function act(action: StaticWitness["actions"][number]) {
        if (action === "activate") {
          const started = Date.now();
          await page.waitForFunction(
            () => document.querySelector("#mode-banner")?.textContent === "",
          );
          local = { ...local, state: activateStatic(definition, local.state) };
          steps.push({ action, waitedMs: Date.now() - started });
          return;
        }
        if (definition.kind === "memory" && local.state.phase === "preview") await act("activate");
        const before = local;
        const next =
          action === "undo"
            ? undoStatic(definition, local.state, local.playerTileId)
            : action === "reset"
              ? resetStatic(definition, local.state, local.playerTileId)
              : moveStatic(definition, local.state, local.playerTileId, action);
        if (action === "reset")
          await page.getByRole("button", { name: "重置房间", exact: true }).click();
        else await pressGameKey(page, action === "undo" ? "z" : keys[action]);
        local = next;
        const actual = await observeR1(page);
        assert.deepEqual(actual.completedObjectiveIds, original.completedObjectiveIds);
        assert.deepEqual(actual.claimedRewardIds, original.claimedRewardIds);
        assert.deepEqual(actual.completedRoomLayouts, original.completedRoomLayouts);
        if (!next.success) {
          assert.equal(actual.position.tileId, next.playerTileId, `${definition.id}: ${action}`);
          assert.deepEqual(actual.staticRoom?.layout, next.state.currentLayout);
          assert.equal(actual.staticRoom?.undoDepth, next.state.undoStack.length);
        }
        const oldAssemblies = Object.keys(
          before.state.currentLayout.theft?.assemblyByAmplifierId ?? {},
        ).length;
        const assemblies = Object.keys(
          next.state.currentLayout.theft?.assemblyByAmplifierId ?? {},
        ).length;
        if (next.code === "failed" || next.success || assemblies !== oldAssemblies) {
          await page.screenshot({
            path: join(directory, `state-${steps.length}-${next.code}-${assemblies}.png`),
          });
        }
        steps.push({
          action,
          code: next.code,
          player: actual.position,
          layout: actual.staticRoom?.layout,
          phase: actual.phase,
        });
      }
      const recovery = staticContent.witnesses.find(
        (item) =>
          item.definitionId === definition.id &&
          (item.kind === "failureRecovery" || item.kind === "deadEndRecovery"),
      )!;
      const prefixEnd =
        definition.kind === "memory" || definition.kind === "oneStroke"
          ? recovery.expectedCodes.indexOf("failed") + 1
          : recovery.actions.indexOf("reset") + 1;
      assert.ok(prefixEnd > 0);
      for (const action of recovery.actions.slice(0, prefixEnd)) await act(action);
      await act("reset");
      if (definition.kind === "oneStroke") {
        const early = definition.id.endsWith("01")
          ? (["up", "up", "up", "up"] as const)
          : (["down", "right", "right"] as const);
        for (const action of early) await act(action);
        assert.equal((await observeR1(page)).lastResult.code, "endTooEarly");
        await act("reset");
      }
      const successful = staticContent.witnesses.find(
        (item) => item.definitionId === definition.id && item.kind === "success",
      )!;
      for (const action of successful.actions.slice(0, definition.kind === "memory" ? 2 : 1))
        await act(action);
      const beforeRefresh = await observeR1(page);
      const midway = await exportThroughUi(page);
      await writeFile(join(directory, "midway-save.json"), JSON.stringify(midway, null, 2));
      await page.reload();
      await page.getByRole("button", { name: "继续游戏", exact: true }).click();
      await waitForGameReady(page);
      const restored = await observeR1(page);
      assert.deepEqual(restored.position, beforeRefresh.position);
      assert.deepEqual(restored.staticRoom?.layout, beforeRefresh.staticRoom?.layout);
      assert.equal(restored.staticRoom?.undoDepth, 0);
      if (definition.kind === "memory") assert.equal(restored.phase, "active");
      local = { ...local, state: { ...local.state, undoStack: [] } };
      await act("reset");
      await page.getByRole("button", { name: "打开暂停菜单", exact: true }).click();
      await page.getByRole("button", { name: "放弃本次尝试，返回入口", exact: true }).click();
      await waitForGameReady(page);
      const abandoned = await observeR1(page);
      assert.equal(abandoned.position.space, "world");
      assert.deepEqual(abandoned.completedRoomLayouts, original.completedRoomLayouts);
      const abandonedSave = await exportThroughUi(page);
      await closeExport(page);
      const reentry = new R1NormalDriver(page, abandonedSave.payload);
      await reentry.enterRoom(definition.id);
      steps.push({ normalReentry: reentry.commands });
      assert.equal((await observeR1(page)).staticRoom?.roomId, definition.id);
      local = createStatic(definition);
      const alternate = staticContent.witnesses.find(
        (item) => item.definitionId === definition.id && item.kind === "alternative",
      );
      const chosen = alternate ?? successful;
      for (const action of chosen.actions) await act(action);
      assert.equal(local.state.phase, "complete");
      const finalSave = await exportThroughUi(page);
      await closeExport(page);
      await page.reload();
      await page.getByRole("button", { name: "继续游戏", exact: true }).click();
      await waitForGameReady(page);
      const refreshedFinal = await exportThroughUi(page);
      assert.deepEqual(refreshedFinal.payload, finalSave.payload);
      assert.deepEqual(errors, []);
      const result = {
        roomId: definition.id,
        source: options.sourceSavePath,
        browser: options.browser.version(),
        contentVersion: initial.contentVersion,
        ruleVersion: initial.ruleVersion,
        navigation: driver.commands,
        recovery: recovery.id,
        completion: chosen.id,
        uniqueRoute: !alternate,
        beforeRefresh,
        restored,
        abandoned,
        steps,
        finalSave,
        errors,
        success: true,
      };
      await writeFile(join(directory, "result.json"), JSON.stringify(result, null, 2));
      results.push({ roomId: definition.id, success: true, completion: chosen.id });
      console.log(
        `R1 static browser ${definition.id}: failure/recovery, refresh, abandon, ${chosen.kind}, immutable first layout`,
      );
    } catch (error) {
      await page.screenshot({ path: join(directory, `failure-${Date.now()}.png`) }).catch(() => {});
      await writeFile(
        join(directory, `failure-${Date.now()}.json`),
        JSON.stringify(
          {
            steps,
            errors,
            error: String(error),
            observed: await observeR1(page).catch(() => null),
          },
          null,
          2,
        ),
      );
      throw error;
    } finally {
      await context.close();
    }
  }
  await writeFile(join(output, "results.json"), JSON.stringify(results, null, 2));
  return results;
}
