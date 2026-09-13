import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Browser } from "playwright";
import { exportThroughUi, pressGameKey, startNewGame, waitForGameReady } from "./support.ts";

/** Run only against the independently verified, frozen rule-v2 production archive. */
export async function verifyLegacyFirewallSave(options: {
  browser: Browser;
  url: string;
  outputDir: string;
}) {
  await mkdir(options.outputDir, { recursive: true });
  const context = await options.browser.newContext({ viewport: { width: 1512, height: 771 } });
  await context.tracing.start({ screenshots: true, snapshots: true });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const errors: string[] = [];
  const inputs: { key: string; beat: string | null; combo: number }[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(options.url);
    assert.equal(await page.evaluate(() => Reflect.has(window, "__CAMELLIA_INSPECT__")), false);
    await startNewGame(page);
    for (const key of [
      "ArrowRight",
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
    for (const key of ["ArrowUp", "ArrowUp", "ArrowUp", "f"]) await pressGameKey(page, key);
    await page.getByRole("button", { name: "教学 · 15 秒 / Combo 12", exact: true }).click();
    await waitForGameReady(page);
    for (let index = 0; index < 14; index += 1) {
      await page.waitForFunction(
        () => document.querySelector("#firewall-rhythm")?.getAttribute("data-phase") === "waiting",
      );
      await page.waitForFunction(
        () => document.querySelector("#firewall-beat-status")?.textContent === "现在移动",
      );
      const key = index % 2 ? "ArrowLeft" : "ArrowRight";
      await page.keyboard.press(key);
      await page.waitForFunction(
        (combo) =>
          document.querySelector("#firewall-beat-status")?.textContent === "本拍命中" &&
          Number(document.querySelector("#firewall-combo-value")?.textContent) === combo,
        index + 1,
      );
      inputs.push({
        key,
        beat: await page.locator("#firewall-beat-count").textContent(),
        combo: Number(await page.locator("#firewall-combo-value").textContent()),
      });
    }
    await page.screenshot({
      path: join(options.outputDir, "legacy-v2-tutorial-playing.png"),
      fullPage: true,
    });
    await page.getByRole("heading", { name: "挑战完成", exact: true }).waitFor({ timeout: 20_000 });
    const score = await page.locator(".result-score").innerText();
    assert.match(score, /最高 14/);
    await page.screenshot({
      path: join(options.outputDir, "legacy-v2-tutorial-completed.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "返回地图", exact: true }).click();
    await waitForGameReady(page);
    const exported = await exportThroughUi(page);
    assert.equal(exported.payload.ruleVersion, 2);
    assert.equal(exported.payload.contentVersion, 5);
    const tutorial = exported.payload.bestResults.find(
      (entry) => entry.challengeId === "a.firewall.tutorial" && entry.ruleVersion === 2,
    );
    assert.ok(tutorial, "必须由正常教学生成真正的 v2 成绩，不能只导出含 v1 成绩的 v2 外壳");
    assert.equal(tutorial.bestCombo, 14);
    assert.deepEqual(errors, []);
    await writeFile(
      join(options.outputDir, "legacy-v2-earned-save.json"),
      `${JSON.stringify(exported, null, 2)}\n`,
    );
    const result = {
      method:
        "Frozen v2 production ZIP, fresh context, normal new-game route and visible-ready direction keys; natural 15-second settlement; UI export only.",
      url: options.url,
      browser: options.browser.version(),
      viewport: page.viewportSize(),
      environment: await page.evaluate(() => ({ userAgent: navigator.userAgent })),
      inputs,
      score,
      bestResults: exported.payload.bestResults,
      errors,
    };
    await writeFile(
      join(options.outputDir, "legacy-v2-earned-results.json"),
      `${JSON.stringify(result, null, 2)}\n`,
    );
    return result;
  } catch (error) {
    await page.screenshot({
      path: join(options.outputDir, "legacy-v2-failed.png"),
      fullPage: true,
    });
    throw error;
  } finally {
    await context.tracing.stop({ path: join(options.outputDir, "legacy-v2-trace.zip") });
    await context.close();
  }
}
