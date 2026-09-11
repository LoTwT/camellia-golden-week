import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Browser } from "playwright";
import { startNewGame, pressGameKey, waitForGameReady } from "./support.ts";

export async function verifyFirewallCue(options: {
  browser: Browser;
  url: string;
  outputDir: string;
}) {
  const results = [];
  for (const reduced of [false, true]) {
    const id = reduced ? "firewall-cue-reduced" : "firewall-cue-standard";
    const viewport = reduced ? { width: 1024, height: 640 } : { width: 1512, height: 771 };
    const context = await options.browser.newContext({ viewport });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto(options.url);
      await startNewGame(page);
      if (reduced) {
        await page.getByRole("button", { name: "打开暂停菜单", exact: true }).click();
        await page.getByRole("button", { name: "声音与显示", exact: true }).click();
        for (const name of ["静音", "减少闪烁", "减少动态效果"])
          await page.getByRole("checkbox", { name, exact: true }).check();
        await page.keyboard.press("Escape");
        await waitForGameReady(page);
      }
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
      assert.match(await page.locator(".dialog-description").innerText(), /左侧拍点条/);
      await page.getByRole("button", { name: "教学 · 15 秒 / Combo 12", exact: true }).click();
      await waitForGameReady(page);
      const cue = page.locator("#firewall-rhythm");
      await cue.waitFor({ state: "visible" });
      await page.waitForFunction(
        () => document.querySelector("#firewall-rhythm")?.getAttribute("data-phase") === "waiting",
      );
      await page.keyboard.press("Escape");
      await page.getByRole("heading", { name: "探索已暂停", exact: true }).waitFor();
      assert.equal(await cue.getAttribute("data-phase"), "paused");
      const frozenCount = await page.locator("#firewall-beat-count").textContent();
      await page.waitForTimeout(250);
      assert.equal(await page.locator("#firewall-beat-count").textContent(), frozenCount);
      await page.getByRole("button", { name: "继续探索", exact: true }).click();
      await page.waitForFunction(
        () =>
          document.querySelector("#firewall-rhythm")?.getAttribute("data-phase") === "preparing",
      );
      assert.equal(await page.locator("#firewall-beat-status").innerText(), "准备跟拍");
      const hitCounts: string[] = [];
      for (let input = 0; input < 14; input += 1) {
        // Observe the visible waiting→ready cue; never inject game time or progress.
        await page.waitForFunction(
          () =>
            document.querySelector("#firewall-rhythm")?.getAttribute("data-phase") === "waiting",
        );
        await page.waitForFunction(
          () => document.querySelector("#firewall-rhythm")?.getAttribute("data-phase") === "ready",
        );
        await page.keyboard.press(input % 2 ? "ArrowLeft" : "ArrowRight");
        await page.waitForFunction(
          () => document.querySelector("#firewall-beat-status")?.textContent === "本拍命中",
        );
        hitCounts.push((await page.locator("#firewall-beat-count").textContent())!);
      }
      const layout = await cue.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const status = document.querySelector("#firewall-beat-status")!;
        const style = getComputedStyle(status);
        const field = document.querySelector(".playfield")!.getBoundingClientRect();
        return {
          bounds: bounds.toJSON(),
          fieldBottom: field.bottom,
          boardLeft: parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue("--board-inset-left"),
          ),
          fontSize: style.fontSize,
          color: style.color,
          background: style.backgroundColor,
          cursorVisibility: getComputedStyle(document.querySelector(".firewall-cursor")!)
            .visibility,
          textFits: status.scrollWidth <= status.clientWidth,
        };
      });
      assert.ok(layout.bounds.right < layout.boardLeft, "拍点不能遮挡棋盘");
      assert.ok(layout.bounds.bottom < layout.fieldBottom - 80, "拍点与底部反馈保留空间");
      assert.ok(parseFloat(layout.fontSize) >= 20 && layout.textFits);
      assert.equal(layout.cursorVisibility, reduced ? "hidden" : "visible");
      await page.screenshot({ path: join(options.outputDir, `${id}.png`), fullPage: true });
      await page.getByRole("heading", { name: "挑战完成", exact: true }).waitFor();
      assert.match(await page.locator(".result-score").innerText(), /最高 14/);
      await page.screenshot({
        path: join(options.outputDir, `${id}-completed.png`),
        fullPage: true,
      });
      await page.getByRole("button", { name: "返回地图", exact: true }).click();
      await waitForGameReady(page);
      assert.equal(await cue.isVisible(), false, "离开挑战后不残留拍点");
      assert.deepEqual(errors, []);
      results.push({
        id,
        viewport,
        reduced,
        muted: reduced,
        hitCounts,
        layout,
        completed: true,
        pauseAndResume: true,
        hiddenAfterExit: true,
        errors,
      });
      console.log(`Chrome visual cue passed: ${id}`);
    } catch (error) {
      await page.screenshot({ path: join(options.outputDir, `${id}-failed.png`), fullPage: true });
      throw error;
    } finally {
      await context.close();
    }
  }
  await writeFile(
    join(options.outputDir, "firewall-cue-results.json"),
    JSON.stringify(results, null, 2) + "\n",
  );
  return results;
}
