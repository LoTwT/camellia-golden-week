import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Browser, Page, Route } from "playwright";
import type { SaveEnvelope } from "../../src/platform/save-store.ts";
import { SAVE_KEYS } from "../../src/platform/save-store.ts";
import { projectGridPoint } from "../../src/render/layout.ts";
import type { BoardLayout, Point2 } from "../../src/render/layout.ts";
import { exportThroughUi, pressGameKey, startNewGame, waitForGameReady } from "./support.ts";

interface Inspection {
  position: { tileId: string };
  mode: string;
  phase: string;
  audio: { enabled: boolean; music: { id: string; atAudioTime: number } | null };
  saveGeneration: number;
  render: { layout: BoardLayout & { displayedFocus: Point2 } };
}

async function inspect(page: Page): Promise<Inspection> {
  return page.evaluate(() => {
    const observer = Reflect.get(window, "__CAMELLIA_INSPECT__") as { snapshot(): Inspection };
    return observer.snapshot();
  });
}

async function waitForPosition(page: Page, tileId: string) {
  await page.waitForFunction((expected) => {
    const observer = Reflect.get(window, "__CAMELLIA_INSPECT__") as { snapshot(): Inspection };
    return observer.snapshot().position?.tileId === expected;
  }, tileId);
}

async function importThroughUi(page: Page, value: SaveEnvelope<unknown>) {
  const returnButton = page.getByRole("button", { name: "返回存档菜单", exact: true });
  if (await returnButton.isVisible()) await returnButton.click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "导入存档", exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: "review-boundary.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(value)),
  });
}

async function readSlots(page: Page) {
  return page.evaluate(
    (keys) => ({ a: localStorage.getItem(keys.a), b: localStorage.getItem(keys.b) }),
    SAVE_KEYS,
  );
}

async function enterA(page: Page) {
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
  await waitForPosition(page, "a.t.0.0");
}

async function installAudioObserver(page: Page) {
  await page.addInitScript(() => {
    const starts: { aheadSeconds: number; at: number; loop: boolean; duration: number }[] = [];
    Reflect.set(window, "__CGW_TEST_AUDIO_STARTS__", starts);
    const original = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (when = 0, offset = 0, duration?: number) {
      starts.push({
        aheadSeconds: when - this.context.currentTime,
        at: performance.now(),
        loop: this.loop,
        duration: this.buffer?.duration ?? 0,
      });
      if (duration === undefined) original.call(this, when, offset);
      else original.call(this, when, offset, duration);
    };
  });
}

export async function verifyReviewRegressions(options: {
  browser: Browser;
  productionUrl: string;
  acceptanceUrl: string;
  outputDir: string;
}): Promise<unknown> {
  const results: { id: string; result: unknown }[] = [];
  await mkdir(options.outputDir, { recursive: true });
  async function scenario(
    id: string,
    url: string,
    run: (page: Page) => Promise<unknown>,
    beforeNavigation?: (page: Page) => Promise<void>,
  ) {
    const context = await options.browser.newContext({ viewport: { width: 1366, height: 768 } });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await beforeNavigation?.(page);
      await page.goto(url);
      const result = await run(page);
      assert.deepEqual(errors, [], `${id}: browser execution errors`);
      await page.screenshot({ path: join(options.outputDir, `${id}.png`), fullPage: true });
      results.push({ id, result });
      console.log(`Chrome regression passed: ${id}`);
    } catch (error) {
      await page
        .screenshot({ path: join(options.outputDir, `${id}-failed.png`), fullPage: true })
        .catch(() => {});
      await writeFile(
        join(options.outputDir, `${id}-failed.json`),
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

  await scenario("revision-import", options.productionUrl, async (page) => {
    await startNewGame(page);
    const baseline = await exportThroughUi(page);
    const external = structuredClone(baseline);
    external.payload.stateRevision = Number.MAX_SAFE_INTEGER;
    await importThroughUi(page, external);
    await page.getByRole("button", { name: "确认替换", exact: true }).click();
    await waitForGameReady(page);
    for (const key of ["ArrowRight", "ArrowRight", "ArrowLeft", "ArrowRight"])
      await pressGameKey(page, key);
    assert.match(await page.locator("#save-status").innerText(), /已保存/);
    const progressed = await exportThroughUi(page);
    assert.equal(progressed.payload.playerPosition.tileId, "hub.t.2.2");
    assert.equal(progressed.payload.stateRevision, 4);
    assert.ok(progressed.payload.completedObjectiveIds.includes("hub.amplifier"));
    await page.reload();
    await page.getByRole("button", { name: "继续游戏", exact: true }).click();
    await waitForGameReady(page);
    const restored = await exportThroughUi(page);
    assert.deepEqual(restored.payload, progressed.payload);
    return { importedRevision: external.payload.stateRevision, progressed, restored };
  });

  await scenario("quality-import", options.productionUrl, async (page) => {
    await startNewGame(page);
    const baseline = await exportThroughUi(page);
    const originalSlots = await readSlots(page);
    await importThroughUi(page, {
      ...baseline,
      payload: {
        ...baseline.payload,
        settings: { ...baseline.payload.settings, quality: ["low"] },
      },
    });
    await page.getByRole("heading", { name: "导入失败", exact: true }).waitFor();
    assert.deepEqual(await readSlots(page), originalSlots);
    await page.getByRole("button", { name: "返回", exact: true }).click();
    await page.getByRole("button", { name: "返回暂停菜单", exact: true }).click();
    await page.getByRole("button", { name: "声音与显示", exact: true }).click();
    await page.getByRole("checkbox", { name: "静音", exact: true }).check();
    await page.getByRole("button", { name: "返回暂停菜单", exact: true }).click();
    const after = await exportThroughUi(page);
    assert.equal(after.payload.settings.muted, true);
    assert.equal(after.payload.settings.quality, "standard");
    assert.deepEqual(after.payload.playerPosition, baseline.payload.playerPosition);
    return { invalidImportRetainedOriginalSlots: true, settings: after.payload.settings };
  });

  await scenario("nested-corrupt-slots", options.productionUrl, async (page) => {
    await startNewGame(page);
    const baseline = await exportThroughUi(page);
    const original = JSON.stringify(baseline);
    const nested = "[".repeat(12_000) + "0" + "]".repeat(12_000);
    const corrupt = `{"saveGeneration":${baseline.saveGeneration},"savedAt":"${baseline.savedAt}","payload":${nested}}`;
    // This case explicitly tests storage corruption; the normal-play scenario never writes state.
    await page.evaluate(
      ({ keys, valid, damaged }) => {
        localStorage.setItem(keys.a, valid);
        localStorage.setItem(keys.b, damaged);
      },
      { keys: SAVE_KEYS, valid: original, damaged: corrupt },
    );
    await page.reload();
    await page.getByRole("heading", { name: "需要处理本地存档", exact: true }).waitFor();
    assert.match(await page.locator("#game-dialog").innerText(), /代数相同但进度不同/);
    for (const [slot, expected] of [
      ["A", original],
      ["B", corrupt],
    ]) {
      await page.getByRole("button", { name: `导出原始槽 ${slot}`, exact: true }).click();
      assert.equal(
        await page.getByRole("textbox", { name: "完整存档文本", exact: true }).inputValue(),
        expected,
      );
      await page.getByRole("button", { name: "返回存档菜单", exact: true }).click();
    }
    assert.deepEqual(await readSlots(page), { a: original, b: corrupt });
    return { depth: 12_000, status: "conflict", bothRawExportsPreserved: true };
  });

  let delayedRoute: Route | undefined;
  let moveRequests = 0;
  await scenario(
    "audio-late-failure",
    options.acceptanceUrl,
    async (page) => {
      await startNewGame(page);
      assert.ok(delayedRoute, "首次音效资源请求必须被故障路由阻塞");
      await page.getByRole("button", { name: "打开暂停菜单", exact: true }).click();
      await page.getByRole("button", { name: "声音与显示", exact: true }).click();
      const response = page.waitForResponse(
        (item) => item.url().endsWith("/assets/audio/move.wav") && item.status() === 200,
      );
      await page.getByRole("button", { name: "启用声音", exact: true }).click();
      await response;
      await page.waitForFunction(
        () =>
          (Reflect.get(window, "__CAMELLIA_INSPECT__") as { snapshot(): Inspection }).snapshot()
            .audio.enabled,
      );
      await delayedRoute.fulfill({ status: 503, body: "Intentional late audio failure" });
      await page.waitForTimeout(250);
      assert.equal((await inspect(page)).audio.enabled, true);
      assert.equal(await page.locator(".audio-prompt").isVisible(), false);
      await page.getByRole("button", { name: "继续探索", exact: true }).click();
      await waitForGameReady(page);
      const before = await page.evaluate(
        () => (Reflect.get(window, "__CGW_TEST_AUDIO_STARTS__") as unknown[]).length,
      );
      await pressGameKey(page, "ArrowRight");
      const after = await page.evaluate(
        () => (Reflect.get(window, "__CGW_TEST_AUDIO_STARTS__") as unknown[]).length,
      );
      assert.ok(after > before, "较旧失败之后，正常移动仍实际启动声音源");
      return { moveRequests, enabled: true, soundSourcesStartedAfterFailure: after - before };
    },
    async (page) => {
      await installAudioObserver(page);
      await page.route("**/assets/audio/move.wav", async (route) => {
        moveRequests += 1;
        if (moveRequests === 1) delayedRoute = route;
        else await route.continue();
      });
    },
  );

  await scenario("main-auto-walk", options.acceptanceUrl, async (page) => {
    await startNewGame(page);
    for (const key of ["ArrowUp", "ArrowUp", "ArrowRight", "ArrowRight", "ArrowRight"])
      await pressGameKey(page, key);
    const before = await inspect(page);
    assert.equal(before.position.tileId, "hub.t.3.0");
    const layout = before.render.layout;
    const target = projectGridPoint({ x: 0, y: 1 });
    const canvas = await page.locator("#game-canvas").boundingBox();
    assert.ok(canvas);
    await page.mouse.click(
      canvas.x +
        layout.available.left +
        layout.available.width / 2 +
        (target.x - layout.displayedFocus.x) * layout.pixelsPerWorldUnit,
      canvas.y +
        layout.available.top +
        layout.available.height / 2 +
        (target.y - layout.displayedFocus.y) * layout.pixelsPerWorldUnit,
    );
    await waitForPosition(page, "hub.t.0.1");
    const after = await inspect(page);
    assert.equal(after.saveGeneration - before.saveGeneration, 4);
    return { from: before.position.tileId, to: after.position.tileId, stableSteps: 4 };
  });

  await scenario("main-clear-held-input", options.acceptanceUrl, async (page) => {
    await startNewGame(page);
    await enterA(page);
    for (const key of ["ArrowRight", "r", "ArrowRight", "ArrowRight", "ArrowRight"])
      await pressGameKey(page, key);
    await waitForGameReady(page);
    await page.waitForFunction(
      () =>
        (Reflect.get(window, "__CAMELLIA_INSPECT__") as { snapshot(): Inspection }).snapshot()
          .phase === "active",
    );
    await pressGameKey(page, "ArrowRight");
    await waitForPosition(page, "a.maze.01.t.0.2");
    await page.keyboard.down("ArrowRight");
    try {
      await page.waitForFunction(
        () =>
          (Reflect.get(window, "__CAMELLIA_INSPECT__") as { snapshot(): Inspection }).snapshot()
            .phase === "preview",
      );
      await waitForPosition(page, "a.maze.01.t.n1.2");
      await page.waitForFunction(
        () =>
          (Reflect.get(window, "__CAMELLIA_INSPECT__") as { snapshot(): Inspection }).snapshot()
            .phase === "active",
      );
      await page.waitForTimeout(350);
      assert.equal(
        (await inspect(page)).position.tileId,
        "a.maze.01.t.n1.2",
        "失败前按住的方向不能在重试观察结束后继续移动",
      );
    } finally {
      await page.keyboard.up("ArrowRight");
    }
    await pressGameKey(page, "ArrowRight");
    await waitForPosition(page, "a.maze.01.t.0.2");
    return { failedIntoPreview: true, heldInputCleared: true, newPressStillWorks: true };
  });

  await scenario(
    "main-firewall-beats",
    options.acceptanceUrl,
    async (page) => {
      await startNewGame(page);
      await enterA(page);
      for (const key of ["ArrowUp", "ArrowUp", "ArrowUp", "f"]) await pressGameKey(page, key);
      await page.getByRole("button", { name: "教学 · 15 秒 / Combo 12", exact: true }).click();
      await waitForGameReady(page);
      await page.waitForFunction(() =>
        (
          Reflect.get(window, "__CGW_TEST_AUDIO_STARTS__") as { loop: boolean; duration: number }[]
        ).some((item) => item.loop && item.duration > 17),
      );
      assert.equal((await inspect(page)).mode, "challengeRunning");
      const music = (await inspect(page)).audio.music;
      assert.equal(music?.id, "firewall-music-inner");
      await page.waitForTimeout(650);
      assert.equal(
        (await inspect(page)).audio.music?.atAudioTime,
        music!.atAudioTime,
        "主程序应维持同一连续配乐声源，而非逐帧重新启动",
      );
      await page.keyboard.press("Escape");
      await page.getByRole("heading", { name: "探索已暂停", exact: true }).waitFor();
      assert.equal((await inspect(page)).audio.music, null, "暂停停止连续配乐");
      const count = await page.evaluate(
        () => (Reflect.get(window, "__CGW_TEST_AUDIO_STARTS__") as unknown[]).length,
      );
      await page.waitForTimeout(350);
      assert.equal(
        await page.evaluate(
          () => (Reflect.get(window, "__CGW_TEST_AUDIO_STARTS__") as unknown[]).length,
        ),
        count,
      );
      return {
        continuousMusicSources: await page.evaluate(() =>
          (Reflect.get(window, "__CGW_TEST_AUDIO_STARTS__") as { loop: boolean }[]).filter(
            (item) => item.loop,
          ),
        ),
        pauseStoppedScheduling: true,
      };
    },
    installAudioObserver,
  );

  await writeFile(
    join(options.outputDir, "review-regressions.json"),
    JSON.stringify(results, null, 2) + "\n",
  );
  return results;
}
