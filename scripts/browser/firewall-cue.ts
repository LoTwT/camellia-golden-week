import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Browser, Page } from "playwright";
import { startNewGame, pressGameKey, waitForGameReady } from "./support.ts";

type FormalDifficulty = "inner" | "deep" | "core";
type FirewallDifficulty = "tutorial" | FormalDifficulty;

interface MusicTiming {
  id: string;
  atAudioTime: number;
  offsetSeconds: number;
  playbackRate: number;
  loopDurationSeconds: number;
  firstBeatMs: number;
  driftMs: number;
}

interface FirewallInspection {
  activeTimeMs: number;
  audio: { enabled: boolean; music: MusicTiming | null };
  render: { tileCount: number; firewallScoreboards: number };
  realtimeRoom: {
    state: { lastJudgment: { kind: "perfect" | "miss"; activeTimeMs: number } | null };
  } | null;
  lastResult: { code: string; message: string };
}

async function inspect(page: Page): Promise<FirewallInspection> {
  return page.evaluate(() => {
    const observer = Reflect.get(window, "__CAMELLIA_INSPECT__") as {
      snapshot(): FirewallInspection;
    };
    return observer.snapshot();
  });
}

function timingDistribution(values: readonly number[]) {
  assert.ok(values.length > 0, "性能统计必须包含实际样本");
  assert.ok(values.every((value) => Number.isFinite(value) && value >= 0));
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return {
    samples: sorted.length,
    medianMs: sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2,
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1]!,
    maxMs: sorted.at(-1)!,
  };
}

async function sampleActiveFrameIntervals(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{
        intervalsMs: number[];
        firstEligibleFrameMs: number | null;
        lastEligibleFrameMs: number | null;
        excludedFrames: number;
        stopReason: string;
        environment: { userAgent: string; devicePixelRatio: number; width: number; height: number };
      }>((resolve) => {
        const rhythm = document.querySelector("#firewall-rhythm");
        const dialog = document.querySelector<HTMLDialogElement>("#game-dialog");
        const shell = document.querySelector(".game-shell");
        const eligiblePhases = new Set(["waiting", "ready", "hit"]);
        const intervalsMs: number[] = [];
        let previousEligibleFrame: number | null = null;
        let firstEligibleFrameMs: number | null = null;
        let lastEligibleFrameMs: number | null = null;
        let excludedFrames = 0;
        let frameRequest = 0;
        let finished = false;
        const resetBoundary = () => {
          previousEligibleFrame = null;
        };
        const boundaryObserver = new MutationObserver(() => {
          if (dialog?.open || !eligiblePhases.has(rhythm?.getAttribute("data-phase") ?? ""))
            resetBoundary();
        });
        if (dialog)
          boundaryObserver.observe(dialog, { attributes: true, attributeFilter: ["open"] });
        if (rhythm)
          boundaryObserver.observe(rhythm, { attributes: true, attributeFilter: ["data-phase"] });
        document.addEventListener("visibilitychange", resetBoundary);
        window.addEventListener("blur", resetBoundary);
        window.addEventListener("focus", resetBoundary);
        const finish = (stopReason: string) => {
          if (finished) return;
          finished = true;
          cancelAnimationFrame(frameRequest);
          clearTimeout(deadline);
          boundaryObserver.disconnect();
          document.removeEventListener("visibilitychange", resetBoundary);
          window.removeEventListener("blur", resetBoundary);
          window.removeEventListener("focus", resetBoundary);
          resolve({
            intervalsMs,
            firstEligibleFrameMs,
            lastEligibleFrameMs,
            excludedFrames,
            stopReason,
            environment: {
              userAgent: navigator.userAgent,
              devicePixelRatio,
              width: innerWidth,
              height: innerHeight,
            },
          });
        };
        const sample = (timestamp: number) => {
          const phase = rhythm?.getAttribute("data-phase") ?? "";
          if (phase === "ended") return finish("natural-settlement");
          if (shell?.getAttribute("data-challenge") !== "firewall")
            return finish("left-before-observing-settlement");
          if (
            eligiblePhases.has(phase) &&
            !dialog?.open &&
            document.visibilityState === "visible" &&
            document.hasFocus()
          ) {
            firstEligibleFrameMs ??= timestamp;
            if (previousEligibleFrame !== null) intervalsMs.push(timestamp - previousEligibleFrame);
            previousEligibleFrame = timestamp;
            lastEligibleFrameMs = timestamp;
          } else {
            previousEligibleFrame = null;
            excludedFrames += 1;
          }
          frameRequest = requestAnimationFrame(sample);
        };
        const deadline = setTimeout(() => finish("timeout"), 60_000);
        frameRequest = requestAnimationFrame(sample);
      }),
  );
}

async function pressAndMeasureVisibleHit(page: Page, key: string, expectedCombo: number) {
  // Install the observer before pressing: protocol round trips are outside the measured interval.
  const observer = await page.evaluateHandle(
    ({ key, expectedCombo }) => {
      let resolveResult: (value: {
        matched: boolean;
        keydownAtMs: number | null;
        visibleAfterPaintAtMs: number;
        latencyMs: number | null;
      }) => void;
      const result = new Promise<{
        matched: boolean;
        keydownAtMs: number | null;
        visibleAfterPaintAtMs: number;
        latencyMs: number | null;
      }>((resolve) => {
        resolveResult = resolve;
      });
      let keydownAtMs: number | null = null;
      let frameRequest = 0;
      let finished = false;
      const finish = (matched: boolean) => {
        if (finished) return;
        finished = true;
        const visibleAfterPaintAtMs = performance.now();
        document.removeEventListener("keydown", onKey, true);
        cancelAnimationFrame(frameRequest);
        clearTimeout(deadline);
        resolveResult({
          matched,
          keydownAtMs,
          visibleAfterPaintAtMs,
          latencyMs: keydownAtMs === null ? null : visibleAfterPaintAtMs - keydownAtMs,
        });
      };
      const sampleVisibleHit = () => {
        const status = document.querySelector<HTMLElement>("#firewall-beat-status");
        if (
          status?.textContent === "本拍命中" &&
          Number(document.querySelector("#firewall-combo-value")?.textContent) === expectedCombo
        ) {
          const bounds = status.getBoundingClientRect();
          const style = getComputedStyle(status);
          if (
            bounds.width > 0 &&
            bounds.height > 0 &&
            bounds.top < innerHeight &&
            bounds.bottom > 0 &&
            style.visibility === "visible" &&
            Number(style.opacity) > 0
          ) {
            // A following frame places one paint opportunity after the visible DOM observation.
            frameRequest = requestAnimationFrame(() => finish(true));
            return;
          }
        }
        frameRequest = requestAnimationFrame(sampleVisibleHit);
      };
      const onKey = (event: KeyboardEvent) => {
        if (event.key !== key || event.repeat || keydownAtMs !== null) return;
        keydownAtMs = performance.now();
        frameRequest = requestAnimationFrame(sampleVisibleHit);
      };
      document.addEventListener("keydown", onKey, true);
      const deadline = setTimeout(() => finish(false), 2_000);
      return { result, cancel: () => finish(false) };
    },
    { key, expectedCombo },
  );
  try {
    await page.keyboard.press(key);
    const reading = await observer.evaluate((observer) => observer.result);
    assert.equal(reading.matched, true, "实际按键后必须出现对应的可见命中反馈");
    assert.ok(reading.latencyMs !== null && reading.latencyMs >= 0);
    assert.ok(
      reading.latencyMs <= 100 + 1e-6,
      `按下至可见命中反馈 ${reading.latencyMs.toFixed(3)}ms，要求不超过100ms`,
    );
    return { ...reading, latencyMs: reading.latencyMs };
  } finally {
    await observer.evaluate((observer) => observer.cancel());
    await observer.dispose();
  }
}

async function readScreenLight(page: Page) {
  return page.locator("#firewall-screen-light").evaluate((element) => {
    const style = getComputedStyle(element);
    const field = document.querySelector(".playfield")!.getBoundingClientRect();
    return {
      phase: element.getAttribute("data-phase"),
      opacity: Number(style.opacity),
      borderWidth: parseFloat(style.borderBottomWidth),
      borderColor: style.borderBottomColor,
      pointerEvents: style.pointerEvents,
      animation: style.animationName,
      bounds: element.getBoundingClientRect().toJSON(),
      field: field.toJSON(),
    };
  });
}

async function openFirewallFromNewGame(page: Page, reduced: boolean): Promise<void> {
  await startNewGame(page);
  await page.getByRole("button", { name: "打开暂停菜单", exact: true }).click();
  await page.getByRole("button", { name: "声音与显示", exact: true }).click();
  await page.getByRole("checkbox", { name: "静音", exact: true }).setChecked(reduced);
  for (const name of ["减少闪烁", "减少动态效果"])
    await page.getByRole("checkbox", { name, exact: true }).setChecked(reduced);
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
  const description = await page.locator(".dialog-description").innerText();
  assert.match(description, /跟随音乐/);
  assert.match(description, /两侧电视/);
  assert.match(description, /底部文字/);
  assert.doesNotMatch(description, /左侧拍点条/);
}

async function startFirewall(page: Page, difficulty: FirewallDifficulty): Promise<void> {
  const names: Record<FirewallDifficulty, string> = {
    tutorial: "教学 · 15 秒 / Combo 12",
    inner: "内层 · 45 秒 / Combo 40",
    deep: "深层 · 45 秒 / Combo 55",
    core: "核心 · 45 秒 / Combo 70",
  };
  const name = names[difficulty];
  await page.getByRole("button", { name, exact: true }).click();
  await waitForGameReady(page);
  await page.locator("#firewall-rhythm").waitFor({ state: "visible" });
  assert.equal(await page.locator(".game-shell").getAttribute("data-challenge"), "firewall");
  assert.equal(await page.locator("#firewall-overlay").isVisible(), true);
  assert.equal(await page.locator("#firewall-screen-light").count(), 1);
  assert.equal(await page.locator(".firewall-track").isVisible(), false);
  assert.equal(await page.locator(".progress-rail").isVisible(), false);
  assert.equal(await page.locator(".area-title").isVisible(), false);
  assert.equal(await page.locator(".brand").isVisible(), false);
}

async function waitForMusic(
  page: Page,
  difficulty: FirewallDifficulty = "tutorial",
): Promise<FirewallInspection> {
  await page.waitForFunction(() => {
    const observer = Reflect.get(window, "__CAMELLIA_INSPECT__") as {
      snapshot(): FirewallInspection;
    };
    return observer.snapshot().audio.music !== null;
  });
  const reading = await inspect(page);
  assert.equal(reading.audio.enabled, true);
  assert.ok(reading.audio.music);
  assert.equal(
    reading.audio.music.id,
    `firewall-music-${difficulty === "tutorial" ? "inner" : difficulty}`,
  );
  assert.ok(Math.abs(reading.audio.music.driftMs) <= 60, "音频与有效时钟偏移须小于判定窗");
  return reading;
}

async function pauseAndResume(
  page: Page,
  inspectAudio: boolean,
  difficulty: FirewallDifficulty = "tutorial",
) {
  await page.waitForFunction(
    () =>
      document.querySelector<HTMLProgressElement>("#firewall-song-progress")!.value > 0.06 &&
      document.querySelector("#firewall-rhythm")?.getAttribute("data-phase") === "waiting",
  );
  const before = inspectAudio ? await waitForMusic(page, difficulty) : null;
  await page.keyboard.press("Escape");
  await page.getByRole("heading", { name: "探索已暂停", exact: true }).waitFor();
  assert.equal(await page.locator("#firewall-rhythm").getAttribute("data-phase"), "paused");
  const pausedLight = await readScreenLight(page);
  assert.equal(pausedLight.phase, "paused");
  assert.equal(pausedLight.opacity, 0, "暂停时不能继续闪动或提示输入");
  const frozenTime = await page.locator("#firewall-time").textContent();
  const paused = inspectAudio ? await inspect(page) : null;
  if (paused) assert.equal(paused.audio.music, null, "暂停时停止配乐声源");
  await page.waitForTimeout(250);
  assert.equal(await page.locator("#firewall-time").textContent(), frozenTime);
  if (paused) assert.equal((await inspect(page)).activeTimeMs, paused.activeTimeMs);
  await page.getByRole("button", { name: "继续探索", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector("#firewall-rhythm")?.getAttribute("data-phase") === "preparing",
  );
  assert.equal(await page.locator("#firewall-beat-status").innerText(), "准备跟拍");
  assert.equal((await readScreenLight(page)).opacity, 0, "恢复倒数期间关闭白光");
  if (inspectAudio) assert.equal((await inspect(page)).audio.music, null);
  await waitForGameReady(page);
  const resumed = inspectAudio ? await waitForMusic(page, difficulty) : null;
  if (before?.audio.music && resumed?.audio.music) {
    assert.ok(resumed.audio.music.atAudioTime > before.audio.music.atAudioTime);
    assert.ok(resumed.audio.music.offsetSeconds > 0, "恢复须续播当前乐句，不能从头播放");
  }
  return { pausedLight, before, paused, resumed, frozenTime };
}

async function playVisibleBeats(page: Page, count: number, reduced: boolean) {
  const hitCounts: string[] = [];
  const comboSequence: number[] = [];
  const screenLightSamples = [];
  const waitingLightSamples = [];
  const inputResponses = [];
  for (let input = 0; input < count; input += 1) {
    // Only the displayed cue drives these ordinary key presses; no rule clock or state is written.
    await page.waitForFunction(
      () => document.querySelector("#firewall-rhythm")?.getAttribute("data-phase") === "waiting",
    );
    const waitingLight = await readScreenLight(page);
    assert.equal(waitingLight.phase, "waiting");
    assert.equal(waitingLight.opacity, 0, "两拍之间白光必须熄灭");
    waitingLightSamples.push(waitingLight);
    await page.waitForFunction(
      () => document.querySelector("#firewall-beat-status")?.textContent === "现在移动",
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
      assert.deepEqual(light.bounds, light.field, "白光应围绕整个挑战画面并覆盖底边");
    }
    screenLightSamples.push(light);
    inputResponses.push(
      await pressAndMeasureVisibleHit(page, input % 2 ? "ArrowLeft" : "ArrowRight", input + 1),
    );
    hitCounts.push((await page.locator("#firewall-beat-count").textContent())!);
    comboSequence.push(Number(await page.locator("#firewall-combo-value").textContent()));
  }
  return {
    hitCounts,
    comboSequence,
    screenLightSamples,
    waitingLightSamples,
    inputResponses,
    inputLatency: timingDistribution(inputResponses.map((item) => item.latencyMs)),
  };
}

async function observeNaturalMiss(page: Page, outputDir: string, id: string) {
  const warmup = await playVisibleBeats(page, 5, false);
  assert.equal(Number(await page.locator("#firewall-combo-value").textContent()), 5);
  await page.waitForFunction(
    () =>
      document.querySelector("#firewall-beat-status")?.textContent === "等待拍点" &&
      [...document.querySelectorAll<HTMLElement>(".firewall-tile-mark")].some(
        (element) =>
          element.textContent === "!" && getComputedStyle(element).visibility === "visible",
      ),
  );
  // Five alternating hits end one cell to the right; this ordinary offbeat key returns to the start.
  await page.keyboard.press("ArrowLeft");
  await page.waitForFunction(() => {
    const observer = Reflect.get(window, "__CAMELLIA_INSPECT__") as {
      snapshot(): FirewallInspection;
    };
    return (
      Number(document.querySelector("#firewall-combo-value")?.textContent) === 0 &&
      observer.snapshot().realtimeRoom?.state.lastJudgment?.kind === "miss"
    );
  });
  await page.screenshot({ path: join(outputDir, `${id}-miss.png`), fullPage: true });
  const missed = await inspect(page);
  assert.equal(missed.realtimeRoom?.state.lastJudgment?.kind, "miss");
  assert.match(missed.lastResult.message, /错拍/);
  assert.equal(
    Number(await page.locator("#firewall-combo-value").textContent()),
    0,
    "自然错拍须处罚已取得的五次连击",
  );
  await page.waitForFunction(() =>
    [...document.querySelectorAll<HTMLElement>(".firewall-tile-mark")].some(
      (element) =>
        element.textContent === "!" && getComputedStyle(element).visibility === "visible",
    ),
  );
  const warnings = await page
    .locator(".firewall-tile-mark")
    .evaluateAll((elements) =>
      elements
        .filter(
          (element) =>
            element.textContent === "!" && getComputedStyle(element).visibility === "visible",
        )
        .map((element) => element.getAttribute("data-tile-id")),
    );
  assert.ok(warnings.length > 0, "危险出现前须显示感叹号预告");
  await page.screenshot({ path: join(outputDir, `${id}-warning.png`), fullPage: true });
  return { warmup, missed, warnings, comboBefore: 5, comboAfter: 0 };
}

async function readAndAssertLayout(page: Page) {
  const layout = await page.locator("#firewall-beat-status").evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const field = document.querySelector(".playfield")!.getBoundingClientRect();
    const canvas = document.querySelector("#game-canvas")!.getBoundingClientRect();
    return {
      bounds: bounds.toJSON(),
      field: field.toJSON(),
      canvas: canvas.toJSON(),
      fontSize: style.fontSize,
      color: style.color,
      background: style.backgroundColor,
      textFits: element.scrollWidth <= element.clientWidth,
      trackDisplay: getComputedStyle(document.querySelector(".firewall-track")!).display,
      viewport: { width: innerWidth, height: innerHeight },
    };
  });
  assert.ok(layout.bounds.top >= layout.field.bottom - 70, "拍点文字应位于画面底部");
  assert.ok(layout.bounds.bottom <= layout.field.bottom, "底部拍点不能被窗口裁切");
  assert.ok(
    Math.abs(layout.bounds.x + layout.bounds.width / 2 - layout.field.width / 2) <= 2,
    "底部提示应水平居中",
  );
  assert.ok(parseFloat(layout.fontSize) >= 20 && layout.textFits);
  assert.equal(layout.trackDisplay, "none", "不保留原来的侧栏轨道");
  assert.equal(layout.field.width, layout.viewport.width);
  assert.equal(layout.field.height, layout.viewport.height);
  assert.deepEqual(layout.canvas, layout.field, "电视舞台使用完整画布");
  return layout;
}

async function finishFirewall(
  page: Page,
  options: { outputDir: string; id: string; combo: number },
) {
  await page.getByRole("heading", { name: "挑战完成", exact: true }).waitFor({ timeout: 50_000 });
  assert.equal((await readScreenLight(page)).opacity, 0, "结算后不能继续闪动");
  assert.match(
    await page.locator(".result-score").innerText(),
    new RegExp(`最高 ${options.combo}`),
  );
  await page.screenshot({
    path: join(options.outputDir, `${options.id}-completed.png`),
    fullPage: true,
  });
  await page.getByRole("button", { name: "返回地图", exact: true }).click();
  await waitForGameReady(page);
  for (const selector of ["#firewall-rhythm", "#firewall-screen-light", "#firewall-overlay"])
    assert.equal(await page.locator(selector).isVisible(), false, "离开挑战后不残留专用界面");
  assert.equal(await page.locator(".game-shell").getAttribute("data-challenge"), "");
}

export async function verifyFirewallCue(options: {
  browser: Browser;
  url: string;
  outputDir: string;
  acceptanceUrl?: string;
}) {
  const results = [];
  const scenarios = [
    {
      id: "firewall-cue-standard",
      reduced: false,
      acceptance: false,
      viewport: { width: 1512, height: 771 },
    },
    {
      id: "firewall-cue-reduced",
      reduced: true,
      acceptance: false,
      viewport: { width: 1024, height: 640 },
    },
    ...(options.acceptanceUrl
      ? [
          {
            id: "firewall-music-levels",
            reduced: false,
            acceptance: true,
            viewport: { width: 1920, height: 1080 },
          },
        ]
      : []),
  ];
  for (const scenario of scenarios) {
    const { id, reduced, acceptance, viewport } = scenario;
    const context = await options.browser.newContext({ viewport });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    const errors: string[] = [];
    const musicResponses: { path: string; status: number }[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      const path = new URL(response.url()).pathname;
      if (/\/assets\/audio\/firewall-music-(inner|deep|core)\.wav$/.test(path))
        musicResponses.push({ path, status: response.status() });
    });
    try {
      await page.goto(acceptance ? options.acceptanceUrl! : options.url);
      if (!acceptance) {
        assert.equal(
          await page.locator("#camellia-inspection, [data-acceptance-faults]").count(),
          0,
        );
        assert.equal(await page.evaluate(() => Reflect.has(window, "__CAMELLIA_INSPECT__")), false);
      }
      await openFirewallFromNewGame(page, reduced);
      await startFirewall(page, "tutorial");
      const pause = await pauseAndResume(page, acceptance);
      const tutorial = await playVisibleBeats(page, 14, reduced);
      const layout = await readAndAssertLayout(page);
      assert.equal(await page.locator(".audio-prompt").isVisible(), false, "本地声音应加载成功");
      const stage = acceptance ? (await inspect(page)).render : null;
      if (stage) {
        assert.equal(stage.tileCount, 20, "中央电视格须为 5×4");
        assert.equal(stage.firewallScoreboards, 4, "两侧须有四块独立的 COMBO 电视");
      }
      await page.screenshot({ path: join(options.outputDir, `${id}.png`), fullPage: true });
      await finishFirewall(page, { outputDir: options.outputDir, id, combo: 14 });
      const formal = [];
      if (acceptance) {
        assert.equal((await inspect(page)).audio.music, null, "离开挑战后停止配乐");
        assert.equal((await inspect(page)).render.firewallScoreboards, 0);
        for (const [difficulty, combo] of [
          ["inner", 47],
          ["deep", 57],
          ["core", 72],
        ] as const) {
          const formalId = `${id}-${difficulty}`;
          await pressGameKey(page, "f");
          await startFirewall(page, difficulty);
          const musicStart = await waitForMusic(page, difficulty);
          await page.waitForTimeout(650);
          const continuous = await waitForMusic(page, difficulty);
          assert.equal(
            continuous.audio.music!.atAudioTime,
            musicStart.audio.music!.atAudioTime,
            "连续帧不能反复从头启动曲目",
          );
          assert.equal(
            continuous.audio.music!.offsetSeconds,
            musicStart.audio.music!.offsetSeconds,
          );
          assert.ok(continuous.activeTimeMs > musicStart.activeTimeMs + 400);
          const formalPause = await pauseAndResume(page, true, difficulty);
          // A closure-owned observer records timings without modifying game state, DOM, or clocks.
          const frameSampling = sampleActiveFrameIntervals(page).catch((error: unknown) => ({
            error: error instanceof Error ? error.message : String(error),
          }));
          const miss =
            difficulty === "inner"
              ? await observeNaturalMiss(page, options.outputDir, formalId)
              : null;
          const performance = await playVisibleBeats(page, combo, false);
          const playing = await waitForMusic(page, difficulty);
          assert.equal(playing.render.tileCount, 20);
          assert.equal(playing.render.firewallScoreboards, 4);
          assert.equal(
            playing.audio.music!.atAudioTime,
            formalPause.resumed!.audio.music!.atAudioTime,
            "循环配乐经过整段游玩仍保持同一个声源",
          );
          assert.ok(
            playing.activeTimeMs - formalPause.resumed!.activeTimeMs >
              playing.audio.music!.loopDurationSeconds * 1000,
            "实际游玩须跨过至少一整段配乐循环",
          );
          await page.screenshot({
            path: join(options.outputDir, `${formalId}.png`),
            fullPage: true,
          });
          await finishFirewall(page, { outputDir: options.outputDir, id: formalId, combo });
          const sampledFrames = await frameSampling;
          if ("error" in sampledFrames) throw new Error(sampledFrames.error);
          assert.equal(sampledFrames.stopReason, "natural-settlement");
          const frameTiming = timingDistribution(sampledFrames.intervalsMs);
          assert.ok(
            frameTiming.medianMs <= 16.7 + 1e-6,
            `${difficulty} 帧间隔中位数 ${frameTiming.medianMs}ms，要求不超过16.7ms`,
          );
          assert.ok(
            frameTiming.p95Ms <= 25 + 1e-6,
            `${difficulty} 帧间隔p95 ${frameTiming.p95Ms}ms，要求不超过25ms`,
          );
          const inputLatency = timingDistribution(
            [...(miss?.warmup.inputResponses ?? []), ...performance.inputResponses].map(
              (response) => response.latencyMs,
            ),
          );
          const scenePerformance = {
            scope:
              "本次45秒防火墙专项；恢复倒数结束至自然结算，不替代V05的60秒最密地图或30次往返验收。",
            environment: {
              browser: options.browser.version(),
              engine: options.browser.browserType().name(),
              headless: process.env.CAMELLIA_HEADED !== "1",
              launchModeSource: "verify-browser.ts uses CAMELLIA_HEADED",
              platform: process.platform,
              architecture: process.arch,
              ...sampledFrames.environment,
            },
            frameTiming: {
              method:
                "相邻rAF仅在waiting/ready/hit、无菜单且页面可见并聚焦时纳入；暂停/倒数/菜单/焦点边界重置前帧。",
              ...frameTiming,
              coverageSeconds:
                sampledFrames.intervalsMs.reduce((sum, value) => sum + value, 0) / 1000,
              firstEligibleFrameMs: sampledFrames.firstEligibleFrameMs,
              lastEligibleFrameMs: sampledFrames.lastEligibleFrameMs,
              excludedFrames: sampledFrames.excludedFrames,
              stopReason: sampledFrames.stopReason,
              intervalsMs: sampledFrames.intervalsMs,
            },
            inputLatency: {
              method:
                "捕获实际keydown至rAF观察到对应可见命中提示，再至下一rAF留出一次绘制机会；不含自动化协议往返。",
              ...inputLatency,
              thresholdMs: 100,
              includesWarmupHits: miss !== null,
              excludesIntentionalMiss: true,
            },
          };
          const exited = await inspect(page);
          assert.equal(exited.audio.music, null, "正式挑战结束后须停止配乐");
          assert.equal(exited.render.firewallScoreboards, 0, "返回终端后须释放四块大屏");
          formal.push({
            difficulty,
            combo,
            musicStart,
            continuous,
            pause: formalPause,
            miss,
            ...performance,
            playing,
            scenePerformance,
            exited,
            completed: true,
          });
          console.log(`Chrome firewall level passed: ${difficulty} / ${combo} Combo`);
        }
      }
      assert.deepEqual(errors, []);
      assert.deepEqual(
        [...new Set(musicResponses.map((item) => item.path))].sort(),
        ["core", "deep", "inner"].map(
          (difficulty) => `/assets/audio/firewall-music-${difficulty}.wav`,
        ),
      );
      assert.ok(musicResponses.every((item) => item.status === 200));
      results.push({
        id,
        viewport,
        reduced,
        muted: reduced,
        acceptance,
        ...tutorial,
        pause,
        layout,
        stage,
        musicResponses,
        formal,
        completed: true,
        hiddenAfterExit: true,
        errors,
      });
      console.log(`Chrome firewall restoration passed: ${id}`);
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
