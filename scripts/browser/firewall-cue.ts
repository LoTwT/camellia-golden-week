import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Browser, Page } from "playwright";
import { startNewGame, pressGameKey, waitForGameReady } from "./support.ts";

async function readScreenLight(page: Page) {
  return page.locator("#firewall-screen-light").evaluate((element) => {
    const style = getComputedStyle(element);
    const field = document.querySelector(".playfield")!.getBoundingClientRect();
    return {
      phase: element.getAttribute("data-phase"),
      opacity: Number(style.opacity),
      borderWidth: parseFloat(style.borderTopWidth),
      borderColor: style.borderTopColor,
      pointerEvents: style.pointerEvents,
      animation: style.animationName,
      bounds: element.getBoundingClientRect().toJSON(),
      field: field.toJSON(),
    };
  });
}

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
      await page.getByRole("button", { name: "打开暂停菜单", exact: true }).click();
      await page.getByRole("button", { name: "声音与显示", exact: true }).click();
      for (const name of reduced ? ["静音", "减少闪烁", "减少动态效果"] : ["静音"])
        await page.getByRole("checkbox", { name, exact: true }).check();
      await page.keyboard.press("Escape");
      await waitForGameReady(page);
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
      const screenLight = page.locator("#firewall-screen-light");
      assert.equal(await screenLight.count(), 1, "挑战画面必须有随拍点亮起的周边白光");
      await page.waitForFunction(
        () => document.querySelector("#firewall-rhythm")?.getAttribute("data-phase") === "waiting",
      );
      await page.keyboard.press("Escape");
      await page.getByRole("heading", { name: "探索已暂停", exact: true }).waitFor();
      assert.equal(await cue.getAttribute("data-phase"), "paused");
      const pausedLight = await readScreenLight(page);
      assert.equal(pausedLight.phase, "paused");
      assert.equal(pausedLight.opacity, 0, "暂停时不能继续闪动或提示输入");
      const frozenCount = await page.locator("#firewall-beat-count").textContent();
      await page.waitForTimeout(250);
      assert.equal(await page.locator("#firewall-beat-count").textContent(), frozenCount);
      await page.getByRole("button", { name: "继续探索", exact: true }).click();
      await page.waitForFunction(
        () =>
          document.querySelector("#firewall-rhythm")?.getAttribute("data-phase") === "preparing",
      );
      assert.equal(await page.locator("#firewall-beat-status").innerText(), "准备跟拍");
      assert.equal((await readScreenLight(page)).opacity, 0, "恢复倒数期间关闭白光");
      const hitCounts: string[] = [];
      const screenLightSamples = [];
      const waitingLightSamples = [];
      for (let input = 0; input < 14; input += 1) {
        // Observe the visible waiting→ready cue; never inject game time or progress.
        await page.waitForFunction(
          () =>
            document.querySelector("#firewall-rhythm")?.getAttribute("data-phase") === "waiting",
        );
        const waitingLight = await readScreenLight(page);
        assert.equal(waitingLight.phase, "waiting");
        assert.equal(waitingLight.opacity, 0, "两拍之间白光必须熄灭");
        waitingLightSamples.push(waitingLight);
        await page.waitForFunction(
          () => document.querySelector("#firewall-rhythm")?.getAttribute("data-phase") === "ready",
        );
        if (!reduced)
          await page.waitForFunction(() => {
            const light = document.querySelector("#firewall-screen-light");
            return light && Number(getComputedStyle(light).opacity) >= 0.6;
          });
        const light = await readScreenLight(page);
        assert.equal(light.phase, "ready");
        assert.equal(light.pointerEvents, "none", "白光不能遮住正常棋盘点选");
        assert.equal(light.animation, "none", "白光必须读取有效时钟，不能用独立 CSS 计时");
        if (reduced) assert.equal(light.opacity, 0, "减少闪烁必须关闭周边白光");
        else {
          assert.ok(light.opacity >= 0.6 && light.opacity <= 1, "实际白光必须可见");
          assert.ok(light.borderWidth >= 4);
          assert.equal(light.borderColor, "rgb(255, 255, 255)");
          assert.deepEqual(light.bounds, light.field, "白光应围绕整个挑战画面");
        }
        screenLightSamples.push(light);
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
      assert.equal((await readScreenLight(page)).opacity, 0, "结算后不能继续闪动");
      assert.match(await page.locator(".result-score").innerText(), /最高 14/);
      await page.screenshot({
        path: join(options.outputDir, `${id}-completed.png`),
        fullPage: true,
      });
      await page.getByRole("button", { name: "返回地图", exact: true }).click();
      await waitForGameReady(page);
      assert.equal(await cue.isVisible(), false, "离开挑战后不残留拍点");
      assert.equal(await screenLight.isVisible(), false, "离开挑战后不残留周边白光");
      assert.deepEqual(errors, []);
      results.push({
        id,
        viewport,
        reduced,
        muted: true,
        hitCounts,
        screenLightSamples,
        waitingLightSamples,
        pausedLight,
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
