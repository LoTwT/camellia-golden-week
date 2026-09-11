import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import type { Browser, Page } from "playwright";
import type { ProfileId } from "../../src/core/types.ts";
import { exportThroughUi, pressGameKey, startNewGame, waitForGameReady } from "./support.ts";

const supplyTotals: Record<ProfileId, number> = { M1: 26, M2: 51, M3: 81, M4: 130, M5: 130 };

async function assertProductionBoundaries(page: Page): Promise<void> {
  assert.equal(await page.locator("#camellia-inspection, [data-acceptance-faults]").count(), 0);
  assert.equal(
    await page.evaluate(() => Reflect.has(window, "__CAMELLIA_INSPECT__")),
    false,
    "生产包不提供验收快照入口",
  );
}

async function captureBoardPixels(page: Page): Promise<Buffer> {
  const canvas = await page.locator("#game-canvas").boundingBox();
  assert.ok(canvas);
  // The canvas fills the playfield; its screenshot would include overlaid HUD text.
  // This central crop contains television screens and excludes HUD, tips and controls.
  return page.screenshot({
    clip: {
      x: canvas.x + canvas.width * 0.3,
      y: canvas.y + canvas.height * 0.25,
      width: canvas.width * 0.4,
      height: canvas.height * 0.5,
    },
  });
}

async function captureSettledBoard(page: Page): Promise<Buffer> {
  let previous = await captureBoardPixels(page);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await page.waitForTimeout(120);
    const current = await captureBoardPixels(page);
    if (current.equals(previous)) return current;
    previous = current;
  }
  throw new Error("关闭动态效果后，静止棋盘未能形成连续相同的画面。");
}

export async function verifyProductionProfile(options: {
  browser: Browser;
  url: string;
  profile: ProfileId;
  outputDir: string;
  completeJourney: boolean;
}): Promise<unknown> {
  const { browser, url, profile, outputDir, completeJourney } = options;
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  const errors: string[] = [];
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  await context.tracing.start({ screenshots: true, snapshots: true });
  try {
    await page.goto(url);
    await page.bringToFront();
    await page.getByRole("button", { name: "新游戏", exact: true }).waitFor({ state: "visible" });
    assert.match(await page.locator("#game-dialog").innerText(), new RegExp(`${profile} ·`));
    await assertProductionBoundaries(page);
    await startNewGame(page);
    assert.equal(await page.locator("#supplies").innerText(), `0 / ${supplyTotals[profile]}`);
    assert.equal(await page.locator("#amplifier").innerText(), "增幅仪待领取");
    const beforeMove = await captureSettledBoard(page);
    await pressGameKey(page, "ArrowRight");
    await page.waitForFunction(() =>
      document.querySelector("#amplifier")?.textContent?.includes("阳炎增幅仪"),
    );
    const afterMove = await captureSettledBoard(page);
    assert.notEqual(
      createHash("sha256").update(afterMove).digest("hex"),
      createHash("sha256").update(beforeMove).digest("hex"),
      "正常移动后，关闭动态效果的实际棋盘画面必须更新",
    );
    await writeFile(join(outputDir, `${profile.toLowerCase()}-before-move.png`), beforeMove);
    await writeFile(join(outputDir, `${profile.toLowerCase()}-after-move.png`), afterMove);
    if (completeJourney) {
      for (const key of [
        "ArrowRight",
        "ArrowRight",
        "r",
        "ArrowRight",
        "ArrowRight",
        "ArrowRight",
        "f",
      ])
        await pressGameKey(page, key);
      await waitForGameReady(page);
      assert.equal(await page.locator("#area-name").innerText(), "仓储区 A");
      for (const key of ["ArrowRight", "r", "ArrowRight", "ArrowRight", "ArrowRight"])
        await pressGameKey(page, key);
      await waitForGameReady(page);
      assert.match(await page.locator("#area-coordinates").innerText(), /机关内/);
      await page.waitForFunction(() => document.querySelector("#mode-banner")?.textContent === "");
      for (const key of [
        "ArrowUp",
        "ArrowUp",
        "ArrowUp",
        "ArrowUp",
        "ArrowRight",
        "ArrowRight",
        "ArrowRight",
        "ArrowRight",
      ])
        await pressGameKey(page, key);
      await waitForGameReady(page);
      await pressGameKey(page, "ArrowRight");
      assert.equal(await page.locator("#supplies").innerText(), `6 / ${supplyTotals[profile]}`);
    }
    assert.match(await page.locator("#save-status").innerText(), /^已保存/);
    const beforeReload = await exportThroughUi(page);
    assert.equal(beforeReload.payload.releaseProfileId, profile);
    assert.ok(beforeReload.payload.completedObjectiveIds.includes("hub.amplifier"));
    assert.equal(
      beforeReload.payload.playerPosition.tileId,
      completeJourney ? "a.t.6.0" : "hub.t.1.2",
    );
    if (completeJourney) {
      assert.ok(beforeReload.payload.completedObjectiveIds.includes("a.maze.01"));
      assert.deepEqual(beforeReload.payload.claimedRewardIds, [
        "hub.supply.tutorial",
        "a.supply.maze01",
      ]);
    }
    await page.reload();
    await page.getByRole("button", { name: "继续游戏", exact: true }).click();
    await waitForGameReady(page);
    assert.equal(
      await page.locator("#supplies").innerText(),
      `${completeJourney ? 6 : 0} / ${supplyTotals[profile]}`,
    );
    const afterReload = await exportThroughUi(page);
    assert.deepEqual(
      afterReload.payload,
      beforeReload.payload,
      "刷新必须恢复最后实际行动和收集的完整稳定载荷",
    );
    await assertProductionBoundaries(page);
    assert.deepEqual(errors, [], "浏览器不应出现运行或资源请求错误");
    await page.screenshot({ path: join(outputDir, `${profile.toLowerCase()}-restored.png`) });
    return {
      profile,
      completeJourney,
      actions: completeJourney
        ? "新游戏→增幅仪→中心教学→A迷宫01→首物资→导出→刷新继续"
        : "新游戏→增幅仪→导出→刷新继续",
      claimedRewardIds: afterReload.payload.claimedRewardIds,
      position: afterReload.payload.playerPosition,
      saveGeneration: afterReload.saveGeneration,
      errors,
    };
  } catch (error) {
    await page
      .screenshot({ path: join(outputDir, `${profile.toLowerCase()}-failure.png`) })
      .catch(() => {});
    throw error;
  } finally {
    await context.tracing.stop({ path: join(outputDir, `${profile.toLowerCase()}-trace.zip`) });
    await context.close();
  }
}
