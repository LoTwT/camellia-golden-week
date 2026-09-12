import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Browser, BrowserContext, Page } from "playwright";
import { assembleContent, migrationContentReleases } from "../../src/content/assemble.ts";
import { areaData, supplyProgress } from "../../src/core/progress.ts";
import { publishedProfileMigrations } from "../../src/platform/migrations.ts";
import { validatePayload } from "../../src/platform/save-payload.ts";
import type { SavePayload } from "../../src/platform/save-payload.ts";
import { inspectSaveSlots, SAVE_KEYS, saveRawSha256 } from "../../src/platform/save-store.ts";
import type { SaveEnvelope } from "../../src/platform/save-store.ts";
import { exportThroughUi, waitForGameReady } from "./support.ts";

type TargetProfile = "M2" | "M3" | "M4";
const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const permanentFields = [
  "completedObjectiveIds",
  "claimedRewardIds",
  "activatedTeleportIds",
  "capabilities",
  "clearedEtherNodeIds",
  "revealedGroupIds",
  "discoveredTileIds",
  "visitedTileIds",
  "bestResults",
  "scopeCompletionHistory",
  "campaignCompletedAt",
  "settings",
] as const;

async function closeExport(page: Page) {
  await page.getByRole("button", { name: "返回存档菜单", exact: true }).click();
  await page.getByRole("button", { name: "继续探索", exact: true }).click();
  await waitForGameReady(page);
}

/** G11/P07: every edge consumes the preceding actual UI export; no gameplay progress is added. */
export async function verifyR1ProfileUpgrades(options: {
  browser: Browser;
  urls: Record<TargetProfile, string>;
  sourceSavePath: string;
  outputDir: string;
}) {
  const output = join(options.outputDir, "profile-upgrades");
  await mkdir(output, { recursive: true });
  const sourceBytes = await readFile(options.sourceSavePath);
  const source = JSON.parse(sourceBytes.toString("utf8")) as SaveEnvelope<SavePayload>;
  const sourceContent = assembleContent("M1");
  const sourceValidation = validatePayload(
    source.payload,
    sourceContent,
    publishedProfileMigrations(migrationContentReleases("M1")),
  );
  assert.ok(
    sourceValidation.ok && !sourceValidation.migrated,
    "Require an actual current M1 export",
  );
  assert.equal(source.payload.releaseProfileId, "M1");
  assert.equal(source.payload.schemaVersion, 3);
  assert.equal(source.payload.ruleVersion, 4);
  assert.equal(supplyProgress(sourceContent, source.payload).collected, 26);
  assert.equal(source.payload.campaignCompletedAt, null);
  const results: unknown[] = [];

  async function upgrade(inputPath: string, profile: TargetProfile, label: string) {
    const directory = join(output, label);
    await mkdir(directory, { recursive: true });
    const inputBytes = await readFile(inputPath);
    const original = JSON.parse(inputBytes.toString("utf8")) as SaveEnvelope<SavePayload>;
    const content = assembleContent(profile);
    const validator = (payload: unknown) =>
      validatePayload(
        payload,
        content,
        publishedProfileMigrations(migrationContentReleases(profile)),
      );
    const expected = validator(original.payload);
    assert.ok(expected.ok && expected.migrated, `${label} must cross an actual version edge`);
    const context = await options.browser.newContext({
      viewport: { width: 1512, height: 900 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const errors: string[] = [];
    const actions: unknown[] = [];
    let stage = "startup";
    const startedAt = new Date().toISOString();
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
    });
    await context.tracing.start({ screenshots: true, snapshots: true });

    async function storageSnapshot(selectedContext: BrowserContext) {
      // Read-only Playwright storage export; it is never passed to newContext or mutated.
      const snapshot = await selectedContext.storageState();
      const origin = snapshot.origins.find(
        (item) => item.origin === new URL(options.urls[profile]).origin,
      );
      assert.ok(origin);
      return Object.fromEntries(origin.localStorage.map((entry) => [entry.name, entry.value]));
    }
    async function verifyBackups(before: Record<string, string>, iteration: string) {
      const stored = await storageSnapshot(context);
      const backupRaw = stored[SAVE_KEYS.preMigration];
      assert.ok(backupRaw, "A version-changing import protects the existing destination slots");
      const backup = JSON.parse(backupRaw) as {
        saves: { a: string | null; b: string | null };
        savesSha256: string;
      };
      assert.deepEqual(backup.saves, {
        a: before[SAVE_KEYS.a] ?? null,
        b: before[SAVE_KEYS.b] ?? null,
      });
      assert.equal(backup.savesSha256, saveRawSha256(JSON.stringify(backup.saves)));
      for (const raw of Object.values(backup.saves))
        if (raw !== null)
          assert.ok(
            validator(JSON.parse(raw).payload).ok,
            "Original destination backup is readable",
          );
      const inspection = inspectSaveSlots(
        {
          getItem: (key) => stored[key] ?? null,
          setItem: () => {
            throw new Error("Read-only inspection");
          },
        },
        validator,
      );
      assert.equal(inspection.status, "ready");
      assert.equal(inspection.latest?.status, "valid");
      assert.equal(inspection.backup?.status, "valid");
      await writeFile(
        join(directory, `${iteration}-storage.json`),
        JSON.stringify({ stored, backup, inspection }, null, 2),
      );
      return backupRaw;
    }

    try {
      await page.goto(options.urls[profile]);
      await page.getByRole("button", { name: "新游戏", exact: true }).click();
      await page.locator("#game-canvas[aria-busy='false']").waitFor({ state: "visible" });
      await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => done())));
      const pauses = await page.evaluate(
        () =>
          (
            Reflect.get(window, "__CAMELLIA_INSPECT__") as {
              snapshot(): { pauseReasons: string[] };
            }
          ).snapshot().pauseReasons,
      );
      if (pauses.length) {
        assert.deepEqual(pauses, ["clockGap"]);
        assert.equal(
          await page.evaluate(() => document.hasFocus() && document.visibilityState === "visible"),
          true,
        );
        actions.push({ label: "startup-clock-gap-public-resume", pauses });
        await page.getByRole("button", { name: "继续探索", exact: true }).click();
      }
      await waitForGameReady(page);
      const before = await storageSnapshot(context);
      stage = "normal-ui-import-preview";
      await page.getByRole("button", { name: "打开暂停菜单", exact: true }).click();
      await page.getByRole("button", { name: "进度与存档", exact: true }).click();
      const chooser = page.waitForEvent("filechooser");
      await page.getByRole("button", { name: "导入存档", exact: true }).click();
      await (await chooser).setFiles(resolve(inputPath));
      await page.getByRole("heading", { name: "确认导入进度", exact: true }).waitFor();
      const preview = await page.locator(".dialog-description").innerText();
      if (profile === "M4") {
        assert.match(preview, /新增.*回访/);
        assert.match(preview, /80\s*\/\s*100/);
      }
      await page.screenshot({ path: join(directory, "import-preview.png") });
      actions.push({ label: stage, inputPath, sourceSha256: sha256(inputBytes), preview });
      await page.getByRole("button", { name: "确认替换", exact: true }).click();
      await waitForGameReady(page);
      stage = "export-after-import";
      const actual = (await exportThroughUi(page)) as SaveEnvelope<SavePayload>;
      const current = validator(actual.payload);
      assert.ok(current.ok && !current.migrated, "Actual exported payload is already current");
      for (const field of permanentFields)
        assert.deepEqual(actual.payload[field], source.payload[field], `${label}: ${field}`);
      assert.deepEqual(actual.payload.playerPosition, original.payload.playerPosition);
      assert.deepEqual(actual.payload.completedRoomLayouts, expected.value.completedRoomLayouts);
      assert.deepEqual(
        actual.payload.archivedCompletedRoomLayouts,
        expected.value.archivedCompletedRoomLayouts,
      );
      assert.equal(supplyProgress(content, actual.payload).collected, 26);
      assert.equal(supplyProgress(content, actual.payload, "a").collected, 25);
      assert.equal(areaData(content, actual.payload, "a").collected, 80);
      assert.equal(areaData(content, actual.payload, "a").total, 100);
      assert.equal(actual.payload.campaignCompletedAt, null);
      assert.ok(
        !actual.payload.completedObjectiveIds.includes(content.profile.scopeTerminalObjectiveId),
        "An earlier profile completion cannot complete the destination scope",
      );
      const exportPath = join(directory, "earned-save.json");
      // Preserve the exact public export text as the next import, including its envelope.
      const exportText = await page
        .getByRole("textbox", { name: "完整存档文本", exact: true })
        .inputValue();
      assert.deepEqual(JSON.parse(exportText), actual);
      await writeFile(exportPath, exportText);
      const migrationBackup = await verifyBackups(before, "after-import");
      actions.push({ label: stage, exportedSha256: sha256(exportText), payload: actual.payload });
      await closeExport(page);
      for (let iteration = 1; iteration <= 2; iteration++) {
        stage = `reload-${iteration}`;
        await page.reload();
        await page.getByRole("button", { name: "继续游戏", exact: true }).click();
        await waitForGameReady(page);
        const reloaded = (await exportThroughUi(page)) as SaveEnvelope<SavePayload>;
        assert.deepEqual(
          reloaded.payload,
          actual.payload,
          "Reload cannot add progress or remigrate completed layouts",
        );
        assert.equal(
          await verifyBackups(before, stage),
          migrationBackup,
          "Verified pre-migration bytes survive reload",
        );
        await writeFile(join(directory, `${stage}-export.json`), JSON.stringify(reloaded, null, 2));
        actions.push({ label: stage, saveGeneration: reloaded.saveGeneration });
        await closeExport(page);
      }
      assert.deepEqual(errors, []);
      const result = {
        status: "passed",
        label,
        profile,
        sourceProfile: original.payload.releaseProfileId,
        inputPath,
        sourceSha256: sha256(inputBytes),
        exportedSha256: sha256(exportText),
        exportPath,
        startedAt,
        finishedAt: new Date().toISOString(),
        preview,
        actions,
        errors,
      };
      await writeFile(join(directory, "result.json"), JSON.stringify(result, null, 2));
      results.push(result);
      return exportPath;
    } catch (error) {
      const failureId = `failure-${Date.now()}`;
      await writeFile(
        join(directory, `${failureId}.json`),
        JSON.stringify(
          {
            stage,
            error: String(error),
            startedAt,
            failedAt: new Date().toISOString(),
            actions,
            errors,
          },
          null,
          2,
        ),
      );
      await page.screenshot({ path: join(directory, `${failureId}.png`) }).catch(() => {});
      throw error;
    } finally {
      try {
        await context.tracing.stop({ path: join(directory, `trace-${Date.now()}.zip`) });
      } finally {
        await context.close();
      }
    }
  }

  let path = options.sourceSavePath;
  for (const profile of ["M2", "M3", "M4"] as const)
    path = await upgrade(path, profile, `chain-${profile.toLowerCase()}`);
  await upgrade(options.sourceSavePath, "M4", "direct-m1-m4");
  const result = {
    status: "passed",
    sourceSavePath: options.sourceSavePath,
    sourceSha256: sha256(sourceBytes),
    browserVersion: options.browser.version(),
    results,
  };
  await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2));
  return result;
}
