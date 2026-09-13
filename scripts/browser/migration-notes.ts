import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Browser, Page } from "playwright";
import { assembleContent, migrationContentReleases } from "../../src/content/assemble.ts";
import { frozenContentRelease } from "../../src/content/history/frozen-releases.ts";
import { publishedProfileMigrations } from "../../src/platform/migrations.ts";
import { validatePayload } from "../../src/platform/save-payload.ts";
import { SAVE_KEYS } from "../../src/platform/save-store.ts";
import { exportThroughUi, startNewGame, waitForGameReady } from "./support.ts";

// A synthetic valid completed visit based on an authentic historical export, not a new journey.
function completedVisit() {
  const envelope = JSON.parse(
    readFileSync(
      new URL(
        "../../tests/fixtures/historical/controls-readability/v1-full-collection-migration-save.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const historical = frozenContentRelease("M5", envelope.payload.ruleVersion);
  const room = historical.rooms.find((candidate) => candidate.id === "c.theft.01")!;
  envelope.payload.room = {
    roomId: room.id,
    status: "completedVisit",
    returnAnchor: {
      space: "world",
      areaId: room.areaId,
      boardId: room.areaId,
      tileId: room.returnTileId,
    },
  };
  envelope.payload.playerPosition = {
    space: "room",
    areaId: room.areaId,
    boardId: room.boardId,
    tileId: room.entryTileId,
  };
  const registry = publishedProfileMigrations(migrationContentReleases("M5"));
  const source = validatePayload(envelope.payload, historical, registry);
  assert.ok(source.ok, source.ok ? "" : source.error);
  const migrated = validatePayload(envelope.payload, assembleContent("M5"), registry);
  assert.ok(migrated.ok, migrated.ok ? "" : migrated.error);
  return { envelope, migrated };
}

async function chooseImport(page: Page, raw: string) {
  const back = page.getByRole("button", { name: "返回存档菜单", exact: true });
  if (await back.isVisible()) await back.click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "导入存档", exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: "old-completed-visit.json",
    mimeType: "application/json",
    buffer: Buffer.from(raw),
  });
  await page.getByRole("heading", { name: "确认导入进度", exact: true }).waitFor();
}

export async function verifyMigrationNotes(options: {
  browser: Browser;
  productionUrl: string;
  outputDir: string;
}): Promise<unknown> {
  await mkdir(options.outputDir, { recursive: true });
  const { envelope, migrated } = completedVisit();
  const raw = JSON.stringify(envelope);
  const results: { entry: string; summary: string; failedImportPreservedWorld: boolean }[] = [];
  for (const entry of ["continue", "backup", "import"] as const) {
    const context = await options.browser.newContext({ viewport: { width: 1366, height: 768 } });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.addInitScript(
        ({ keys, input, recovery, importing }) => {
          if (!sessionStorage.getItem("migration-notes-fixture-installed")) {
            sessionStorage.setItem("migration-notes-fixture-installed", "yes");
            if (!importing) {
              localStorage.setItem(keys.a, input);
              if (recovery) {
                const source = JSON.parse(input);
                localStorage.setItem(
                  keys.b,
                  JSON.stringify({
                    saveGeneration: source.saveGeneration + 1,
                    savedAt: source.savedAt,
                    payload: {},
                  }),
                );
              }
            }
          }
          const original = Storage.prototype.setItem;
          Storage.prototype.setItem = function (key, value) {
            if (
              this === localStorage &&
              Reflect.get(window, "__MIGRATION_REJECT_WRITE__") &&
              Object.values(keys).some((slotKey) => slotKey === key)
            )
              throw new DOMException("Synthetic migration write rejection", "QuotaExceededError");
            return original.call(this, key, value);
          };
        },
        {
          keys: SAVE_KEYS,
          input: raw,
          recovery: entry === "backup",
          importing: entry === "import",
        },
      );
      await page.goto(options.productionUrl);
      let baseline;
      if (entry === "import") {
        await startNewGame(page);
        baseline = await exportThroughUi(page);
        await chooseImport(page, raw);
      } else
        await page
          .getByRole("heading", {
            name: entry === "continue" ? "继续探索" : "选择存档恢复方式",
            exact: true,
          })
          .waitFor();
      const summary = await page.locator("#game-dialog").innerText();
      for (const note of migrated.migrationNotes ?? [])
        assert.ok(summary.includes(note), `${entry}: missing migration explanation: ${note}`);
      await page.screenshot({
        path: join(options.outputDir, `${entry}-preview.png`),
        fullPage: true,
      });
      if (entry === "import") {
        const before = await page.evaluate(
          (keys) => Object.values(keys).map((key) => localStorage.getItem(key)),
          SAVE_KEYS,
        );
        await page.evaluate(() => Reflect.set(window, "__MIGRATION_REJECT_WRITE__", true));
        await page.getByRole("button", { name: "确认替换", exact: true }).click();
        await page.getByRole("heading", { name: "导入未生效", exact: true }).waitFor();
        assert.match(await page.locator("#game-dialog").innerText(), /当前世界保持不变/);
        assert.deepEqual(
          await page.evaluate(
            (keys) => Object.values(keys).map((key) => localStorage.getItem(key)),
            SAVE_KEYS,
          ),
          before,
        );
        await page.evaluate(() => Reflect.set(window, "__MIGRATION_REJECT_WRITE__", false));
        await page.getByRole("button", { name: "返回", exact: true }).click();
        const preserved = await exportThroughUi(page);
        assert.deepEqual(preserved.payload, baseline!.payload);
        await chooseImport(page, raw);
      }
      await page
        .getByRole("button", {
          name:
            entry === "continue" ? "继续游戏" : entry === "import" ? "确认替换" : /^使用备份继续/,
        })
        .click();
      await waitForGameReady(page);
      const restored = await exportThroughUi(page);
      assert.equal(restored.payload.room, null);
      assert.equal(restored.payload.playerPosition.tileId, "c.t.-2.-2");
      assert.deepEqual(
        restored.payload.completedObjectiveIds,
        migrated.value.completedObjectiveIds,
      );
      assert.deepEqual(restored.payload.claimedRewardIds, migrated.value.claimedRewardIds);
      assert.deepEqual(
        restored.payload.archivedCompletedRoomLayouts,
        migrated.value.archivedCompletedRoomLayouts,
      );
      await page.reload();
      await page.getByRole("heading", { name: "继续探索", exact: true }).waitFor();
      assert.doesNotMatch(
        await page.locator("#game-dialog").innerText(),
        /旧布局无法映射|旧完成布局已归档/,
      );
      assert.deepEqual(errors, []);
      results.push({ entry, summary, failedImportPreservedWorld: entry === "import" });
      console.log(`Chrome migration notes passed: ${entry}`);
    } catch (error) {
      await page
        .screenshot({ path: join(options.outputDir, `${entry}-failed.png`), fullPage: true })
        .catch(() => {});
      await writeFile(
        join(options.outputDir, `${entry}-failed.json`),
        JSON.stringify(
          { errors, error: String(error), body: await page.locator("body").innerText() },
          null,
          2,
        ),
      );
      throw error;
    } finally {
      await context.close();
    }
  }
  return results;
}
