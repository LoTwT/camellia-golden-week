import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, Page } from "playwright";
import { assembleContent } from "../../src/content/assemble.ts";
import type {
  DirectionalFirewallDefinition,
  FirewallState,
  RealtimeDirection,
} from "../../src/core/realtime.ts";
import type { SaveEnvelope } from "../../src/platform/save-store.ts";
import type { SavePayload } from "../../src/platform/save-payload.ts";
import { exportThroughUi, startNewGame, pressGameKey, waitForGameReady } from "./support.ts";

type FormalDifficulty = "inner" | "deep" | "core";
type FirewallDifficulty = "tutorial" | FormalDifficulty;
const preparationRecoveryCounts = new WeakMap<Page, number>();

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
    state: FirewallState;
  } | null;
  lastResult: { code: string; message: string };
}

const directionKeys: Record<RealtimeDirection, string> = {
  up: "ArrowUp",
  right: "ArrowRight",
  down: "ArrowDown",
  left: "ArrowLeft",
};

interface FirewallRoute {
  definition: DirectionalFirewallDefinition;
  playerTileId: string;
}

async function createFirewallRoute(difficulty: FirewallDifficulty): Promise<FirewallRoute> {
  const content = JSON.parse(
    await readFile(new URL("../../src/content/challenges/realtime.json", import.meta.url), "utf8"),
  ) as { definitions: DirectionalFirewallDefinition[] };
  const definition = content.definitions.find((entry) => entry.id === `a.firewall.${difficulty}`);
  assert.ok(definition?.ruleVersion === 3, "本轮浏览器回归只针对规则 v3 固定内容");
  return { definition, playerTileId: definition.entry.tileId };
}

function routeCandidates(route: FirewallRoute, playerTileId: string, beatIndex: number) {
  const { definition } = route;
  const tile = definition.tiles.find((entry) => entry.id === playerTileId)!;
  const beatMs = definition.rules.firstBeatMs + (beatIndex * 60_000) / definition.rules.bpm;
  const alarmTiles = (
    alarm: DirectionalFirewallDefinition["rules"]["alarms"][number],
    time: number,
  ) =>
    time < alarm.startsAtMs || time >= alarm.endsAtMs
      ? []
      : (alarm.frames.findLast((frame) => frame.atMs <= time)?.tileIds ?? []);
  return (["up", "right", "down", "left"] as const).flatMap((direction) => {
    const vector = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] }[direction]!;
    const destination = definition.tiles.find(
      (candidate) => candidate.x === tile.x + vector[0]! && candidate.y === tile.y + vector[1]!,
    );
    if (!destination) return [];
    const current = definition.rules.alarms.filter((alarm) =>
      alarmTiles(alarm, beatMs).includes(destination.id),
    );
    // A candidate may cross the existing wave toward its source. It must be clear after the
    // scheduled wave movement, so ending the finite dodge cannot cause an unobserved hit.
    if (
      current.some((alarm) => alarm.approachFrom !== direction) ||
      definition.rules.alarms.some((alarm) =>
        alarmTiles(alarm, beatMs + 151).includes(destination.id),
      )
    )
      return [];
    return [
      {
        direction,
        destination: destination.id,
        crossesAlarm: current.length > 0,
        distanceFromCenter: Math.abs(destination.x - 2) + Math.abs(destination.y - 1.5),
      },
    ];
  });
}

function chooseRouteInput(route: FirewallRoute, beatIndex: number) {
  const memo = new Map<string, number>();
  const safeBeats = (tile: string, beat: number): number => {
    if (beat >= route.definition.rules.beatCount) return 0;
    const key = `${tile}:${beat}`;
    if (memo.has(key)) return memo.get(key)!;
    const candidates = routeCandidates(route, tile, beat);
    const result = candidates.length
      ? 1 + Math.max(...candidates.map((candidate) => safeBeats(candidate.destination, beat + 1)))
      : 0;
    memo.set(key, result);
    return result;
  };
  const candidates = routeCandidates(route, route.playerTileId, beatIndex).map((candidate) => ({
    ...candidate,
    safeBeats: safeBeats(candidate.destination, beatIndex + 1),
  }));
  candidates.sort(
    (a, b) =>
      b.safeBeats - a.safeBeats ||
      Number(b.crossesAlarm) - Number(a.crossesAlarm) ||
      a.distanceFromCenter - b.distanceFromCenter,
  );
  assert.ok(candidates[0], `固定地图在可见第 ${beatIndex + 1} 拍没有可规划的合法方向`);
  return candidates[0];
}

async function readVisibleFeedback(page: Page) {
  return page.evaluate(() => {
    const impact = document.querySelector<HTMLElement>("#firewall-impact")!;
    const style = getComputedStyle(impact);
    const bounds = impact.getBoundingClientRect();
    return {
      combo: Number(document.querySelector("#firewall-combo-value")?.textContent),
      beat: document.querySelector("#firewall-beat-count")?.textContent ?? "",
      status: document.querySelector("#firewall-beat-status")?.textContent ?? "",
      feedback: document.querySelector("#firewall-feedback")?.textContent ?? "",
      kind: document.querySelector<HTMLElement>("#firewall-feedback")?.dataset.kind ?? "none",
      impactOpacity: Number(style.opacity),
      impactDisplay: style.display,
      impactVisible:
        style.display !== "none" &&
        style.visibility === "visible" &&
        Number(style.opacity) > 0 &&
        bounds.width > 0 &&
        bounds.height > 0,
      marks: [...document.querySelectorAll<HTMLElement>(".firewall-tile-mark")]
        .filter((element) => getComputedStyle(element).visibility === "visible")
        .map((element) => ({
          tileId: element.dataset.tileId!,
          mark: element.textContent ?? "",
          phase: element.dataset.hazardPhase ?? "",
        })),
    };
  });
}

async function assertReadableAlarmDirections(page: Page) {
  const marks = await page
    .locator(".firewall-tile-mark[data-hazard-phase]")
    .evaluateAll((elements) =>
      elements.map((element) => {
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return {
          tileId: (element as HTMLElement).dataset.tileId,
          phase: (element as HTMLElement).dataset.hazardPhase,
          text: element.textContent,
          background: style.backgroundColor,
          color: style.color,
          borderStyle: style.borderStyle,
          visibility: style.visibility,
          viewport: { width: innerWidth, height: innerHeight },
          box: { x: box.x, y: box.y, width: box.width, height: box.height },
          arrows: [...element.querySelectorAll<SVGSVGElement>("svg")].map((arrow) => {
            const bounds = arrow.getBoundingClientRect();
            return {
              direction: arrow.dataset.direction,
              rotation: getComputedStyle(arrow).rotate,
              width: bounds.width,
              height: bounds.height,
              path: arrow.querySelector("path")?.getAttribute("d"),
            };
          }),
        };
      }),
    );
  const visible = marks.filter((mark) => mark.visibility === "visible");
  assert.ok(visible.length > 0, "必须在实际警报出现时检查方向标记");
  for (const mark of visible) {
    const directions = { "↑": "up", "→": "right", "↓": "down", "←": "left" } as const;
    const expectedDirections = [...(mark.text ?? "")]
      .filter((value): value is keyof typeof directions => value in directions)
      .map((value) => directions[value]);
    assert.ok(expectedDirections.length > 0);
    assert.equal(
      mark.arrows.length,
      expectedDirections.length,
      "方向必须使用粗实心图形，不能依赖细字体箭头",
    );
    assert.ok(mark.box.height >= 36, "最小视口中的方向标记至少36 CSS px高");
    assert.deepEqual(
      mark.arrows.map((arrow) => arrow.direction),
      expectedDirections,
    );
    assert.ok(
      mark.box.x >= 0 &&
        mark.box.y >= 0 &&
        mark.box.x + mark.box.width <= mark.viewport.width &&
        mark.box.y + mark.box.height <= mark.viewport.height,
      "屏幕边缘的方向标记也须完整可见",
    );
    for (const arrow of mark.arrows) {
      assert.ok(arrow.width >= 24 && arrow.height >= 24, "每个方向图形至少24 CSS px");
      assert.ok(arrow.path, "方向图形必须包含实际路径");
      assert.equal(
        arrow.rotation,
        { up: "-90deg", right: "none", down: "90deg", left: "180deg" }[
          arrow.direction as RealtimeDirection
        ],
      );
    }
    assert.notEqual(
      mark.background,
      "rgba(0, 0, 0, 0)",
      "方向须有独立底色，不与玩家或粉红屏混在一起",
    );
    const luminance = (color: string) => {
      const rgb = color
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map(Number);
      return rgb.reduce((sum, value, index) => {
        const channel = value / 255;
        const linear = channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        return sum + linear * [0.2126, 0.7152, 0.0722][index]!;
      }, 0);
    };
    const light = luminance(mark.background);
    const dark = luminance(mark.color);
    const contrast = (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05);
    assert.ok(contrast >= 7, `箭头与独立底色对比度须至少7:1，实测${contrast}`);
    assert.equal(mark.borderStyle, mark.phase === "warning" ? "dashed" : "solid");
  }
  return visible;
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
        const eligiblePhases = new Set(["waiting", "ready", "hit", "judged"]);
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
  await page.getByRole("button", { name: "继续探索", exact: true }).click();
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
  const preparationPauses = [];
  for (;;) {
    await page.waitForFunction(
      () =>
        (document.querySelector<HTMLProgressElement>("#firewall-song-progress")!.value > 0.06 &&
          document.querySelector("#firewall-rhythm")?.getAttribute("data-phase") === "waiting") ||
        (document.querySelector<HTMLDialogElement>("#game-dialog")?.open &&
          document.querySelector(".dialog-description")?.textContent?.includes("前台调度中断")),
    );
    const dialog = page.locator("#game-dialog");
    if (!(await dialog.evaluate((element) => (element as HTMLDialogElement).open))) break;
    const previousRecoveries = preparationRecoveryCounts.get(page) ?? 0;
    assert.equal(previousRecoveries, 0, "同一场景反复发生 clockGap，须单独诊断，不能自动掩盖");
    preparationRecoveryCounts.set(page, previousRecoveries + 1);
    const description = await page.locator(".dialog-description").innerText();
    assert.match(description, /前台调度中断/);
    const observedAt = new Date().toISOString();
    const reading = await readVisibleFeedback(page);
    const inspection = inspectAudio ? await inspect(page) : null;
    await page.getByRole("button", { name: "继续探索", exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector("#firewall-rhythm")?.getAttribute("data-phase") === "preparing",
    );
    await waitForGameReady(page);
    preparationPauses.push({
      observedAt,
      description,
      reading,
      inspection,
      method:
        "Visible preparation pause, normal Continue button and full resume countdown; no clock or state injection.",
    });
    console.log(`Chrome firewall preparation clockGap recovered: ${difficulty} / ${observedAt}`);
  }
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
  return { preparationPauses, pausedLight, before, paused, resumed, frozenTime };
}

async function playVisibleBeats(
  page: Page,
  count: number,
  reduced: boolean,
  route: FirewallRoute,
  fixedDirections?: readonly RealtimeDirection[],
) {
  const hitCounts: string[] = [];
  const comboSequence: number[] = [];
  const screenLightSamples = [];
  const waitingLightSamples = [];
  const inputResponses = [];
  for (let input = 0; input < count; input += 1) {
    // The displayed cue alone schedules physical keys. Fixed content is read only to plan
    // directions, never to replace the observed browser clock, score, or completion.
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
    const before = await readVisibleFeedback(page);
    if (input > 0)
      assert.equal(before.combo, comboSequence.at(-1), "合法闪避结束与驻留之间不能出现隐藏扣分");
    const beatIndex = Number(before.beat.split(" / ")[0]) - 1;
    const planned = chooseRouteInput(route, beatIndex);
    const direction = fixedDirections?.[input] ?? planned.direction;
    const from = route.playerTileId;
    const tile = route.definition.tiles.find((entry) => entry.id === from)!;
    const vector = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] }[direction]!;
    const destination = route.definition.tiles.find(
      (entry) => entry.x === tile.x + vector[0]! && entry.y === tile.y + vector[1]!,
    );
    assert.ok(destination, "普通方向键必须指向邻接格");
    const response = await pressAndMeasureVisibleHit(
      page,
      directionKeys[direction],
      before.combo + 1,
    );
    route.playerTileId = destination.id;
    const after = await readVisibleFeedback(page);
    assert.equal(after.combo, before.combo + 1);
    inputResponses.push({
      ...response,
      direction,
      from,
      destination: destination.id,
      plannedCrossing: planned.crossesAlarm,
      before,
      after,
    });
    hitCounts.push(after.beat);
    comboSequence.push(after.combo);
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

async function observeNaturalMiss(
  page: Page,
  outputDir: string,
  id: string,
  reduced: boolean,
  route: FirewallRoute,
) {
  const warmup = await playVisibleBeats(page, 5, reduced, route);
  await page.waitForFunction(
    () => document.querySelector("#firewall-beat-status")?.textContent === "等待拍点",
  );
  const before = await readVisibleFeedback(page);
  assert.equal(before.combo, 5);
  const lastMove = warmup.inputResponses.at(-1)!;
  const inverse: Record<RealtimeDirection, RealtimeDirection> = {
    up: "down",
    down: "up",
    left: "right",
    right: "left",
  };
  const direction = inverse[lastMove.direction];
  // The tutorial's early safe cells separate the ordinary miss from a collision penalty.
  assert.equal(before.marks.length, 0, "普通 MISS 证据不得混入警报碰撞");
  await page.keyboard.press(directionKeys[direction]);
  route.playerTileId = lastMove.from;
  await page.waitForFunction(
    () =>
      document.querySelector<HTMLElement>("#firewall-feedback")?.dataset.kind === "miss" &&
      Number(document.querySelector("#firewall-combo-value")?.textContent) === 4,
  );
  const after = await readVisibleFeedback(page);
  assert.equal(after.combo, before.combo - 1);
  assert.match(after.feedback, /错拍.*−1/);
  assert.equal(after.impactOpacity, 0, "普通错拍不能伪装为警报受击红屏");
  await page.screenshot({ path: join(outputDir, `${id}-miss.png`), fullPage: true });
  return { warmup, before, after, direction, comboBefore: 5, comboAfter: 4 };
}

async function closeExportToGame(page: Page) {
  await page.getByRole("button", { name: "返回存档菜单", exact: true }).click();
  await page.getByRole("button", { name: "继续探索", exact: true }).click();
  await waitForGameReady(page);
}

async function observeAlarmRecovery(
  page: Page,
  options: {
    outputDir: string;
    id: string;
    reduced: boolean;
    acceptance: boolean;
  },
) {
  await pressGameKey(page, "f");
  await startFirewall(page, "inner");
  const route = await createFirewallRoute("inner");
  const warmup = await playVisibleBeats(page, 6, options.reduced, route, [
    "up",
    "down",
    "up",
    "down",
    "up",
    "down",
  ]);
  assert.equal(route.playerTileId, route.definition.entry.tileId);
  const before = await readVisibleFeedback(page);
  assert.equal(before.combo, 6);
  // Stay on the normally reached cell. The moving wave, rather than another input, hits it.
  await page.waitForFunction(
    () =>
      document.querySelector<HTMLElement>("#firewall-feedback")?.dataset.kind === "hazardHit" &&
      Number(document.querySelector("#firewall-combo-value")?.textContent) === 1,
  );
  const hit = await readVisibleFeedback(page);
  const directionCues = await assertReadableAlarmDirections(page);
  assert.match(hit.feedback, /警报命中.*−5/);
  assert.equal(hit.combo, before.combo - 5);
  assert.ok(
    hit.marks.some((mark) => mark.phase === "active" && mark.tileId === route.playerTileId),
  );
  if (options.reduced) {
    assert.equal(hit.impactDisplay, "none", "减少闪烁时用文字报告受击，关闭红色晕屏");
    assert.equal(hit.impactVisible, false);
    assert.equal(await page.locator("#firewall-impact").isVisible(), false);
  } else assert.equal(hit.impactVisible, true, "普通画面须即时出现受击晕屏");
  const inspectedHit = options.acceptance ? await inspect(page) : null;
  if (inspectedHit) {
    assert.equal(inspectedHit.realtimeRoom?.state.lastHazardHit?.penalty, 5);
    assert.ok(inspectedHit.realtimeRoom!.state.lastHazardHit!.alarmIds.length > 0);
  }
  await page.screenshot({
    path: join(options.outputDir, `${options.id}-hazard-hit.png`),
    fullPage: true,
  });
  await page.waitForTimeout(120);
  const stationary = await readVisibleFeedback(page);
  assert.equal(stationary.combo, hit.combo, "同一警报持续接触不能逐帧续扣");
  const pause = await pauseAndResume(page, options.acceptance, "inner");
  const resumed = await readVisibleFeedback(page);
  assert.equal(resumed.combo, hit.combo, "暂停与恢复倒数不能重新扣除同一警报");
  await page.waitForTimeout(100);
  const afterResume = await readVisibleFeedback(page);
  assert.equal(afterResume.combo, hit.combo);
  if (inspectedHit)
    assert.deepEqual(
      (await inspect(page)).realtimeRoom?.state.lastHazardHit,
      inspectedHit.realtimeRoom?.state.lastHazardHit,
    );

  // The next left-coming wave is observed in its active cell. Wait for the following visible
  // ready window, then physically move left into it; no private clock schedules this input.
  const destination = route.definition.tiles.find((tile) => tile.x === 1 && tile.y === 2)!.id;
  await page.waitForFunction(
    (tileId) =>
      [...document.querySelectorAll<HTMLElement>(".firewall-tile-mark")].some(
        (element) =>
          element.dataset.tileId === tileId &&
          element.dataset.hazardPhase === "active" &&
          element.textContent === "←",
      ),
    destination,
  );
  await page.waitForFunction(
    () => document.querySelector("#firewall-rhythm")?.getAttribute("data-phase") === "waiting",
  );
  await page.waitForFunction(
    () => document.querySelector("#firewall-beat-status")?.textContent === "现在移动",
  );
  const beforeDodge = await readVisibleFeedback(page);
  assert.equal(beforeDodge.combo, hit.combo);
  const input = await pressAndMeasureVisibleHit(page, "ArrowLeft", beforeDodge.combo + 1);
  route.playerTileId = destination;
  await page.waitForFunction(
    () => document.querySelector<HTMLElement>("#firewall-feedback")?.dataset.kind === "dodged",
  );
  const dodge = await readVisibleFeedback(page);
  assert.equal(dodge.combo, beforeDodge.combo + 1);
  assert.match(dodge.feedback, /完美闪避/);
  assert.equal(dodge.impactOpacity, 0);
  const inspectedDodge = options.acceptance ? await inspect(page) : null;
  if (inspectedDodge) assert.ok(inspectedDodge.realtimeRoom?.state.lastDodgeAtMs !== null);
  await page.screenshot({
    path: join(options.outputDir, `${options.id}-toward-alarm-dodge.png`),
    fullPage: true,
  });
  await page.waitForTimeout(250);
  const afterDodge = await readVisibleFeedback(page);
  assert.equal(afterDodge.combo, dodge.combo, "有限闪避结束后安全落点不能延迟受击");

  const interrupted = await exportThroughUi(page);
  assert.equal(interrupted.payload.ruleVersion, 3);
  assert.deepEqual(interrupted.payload.resumeHint, {
    kind: "restartChallenge",
    challengeId: "a.firewall.inner",
  });
  assert.equal(interrupted.payload.room, null);
  await writeFile(
    join(options.outputDir, `${options.id}-interrupted-save.json`),
    `${JSON.stringify(interrupted, null, 2)}\n`,
  );
  await page.reload();
  await page.getByRole("button", { name: "继续游戏", exact: true }).click();
  await waitForGameReady(page);
  assert.equal(
    await page.locator("#firewall-overlay").isVisible(),
    false,
    "未结算实时局恢复到外层安全入口",
  );
  if (options.acceptance) assert.equal((await inspect(page)).realtimeRoom, null);
  const restored = await exportThroughUi(page);
  for (const key of [
    "bestResults",
    "claimedRewardIds",
    "completedObjectiveIds",
    "playerPosition",
  ] as const)
    assert.deepEqual(restored.payload[key], interrupted.payload[key], `重启保留 ${key}`);
  assert.equal(restored.payload.resumeHint, null, "外层新保存不保留过期实时尝试");
  await writeFile(
    join(options.outputDir, `${options.id}-restored-save.json`),
    `${JSON.stringify(restored, null, 2)}\n`,
  );
  await closeExportToGame(page);
  return {
    warmup,
    before,
    hit,
    directionCues,
    inspectedHit,
    stationary,
    pause,
    resumed,
    afterResume,
    beforeDodge,
    input,
    dodge,
    inspectedDodge,
    afterDodge,
    interruptedVersion: interrupted.payload.ruleVersion,
    safeAnchor: restored.payload.playerPosition,
    preservedBestResults: restored.payload.bestResults,
  };
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

async function observeAlarmDirectionLayout(page: Page, outputDir: string, id: string) {
  await pressGameKey(page, "f");
  await startFirewall(page, "core");
  await page.waitForFunction(() =>
    [...document.querySelectorAll<HTMLElement>(".firewall-tile-mark")].some(
      (element) => element.dataset.hazardPhase === "warning",
    ),
  );
  const warning = await assertReadableAlarmDirections(page);
  assert.ok(warning.some((mark) => mark.phase === "warning"));
  await page.waitForFunction(() =>
    [...document.querySelectorAll<HTMLElement>(".firewall-tile-mark")].some(
      (element) => element.querySelectorAll("svg").length > 1,
    ),
  );
  const intersection = await assertReadableAlarmDirections(page);
  assert.ok(
    intersection.some((mark) => mark.arrows.length > 1),
    "交汇警报不得丢失第二个方向",
  );
  await page.screenshot({ path: join(outputDir, `${id}-alarm-directions.png`), fullPage: true });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "放弃本次尝试，返回入口", exact: true }).click();
  await waitForGameReady(page);
  return {
    method:
      "正常进入核心挑战，仅观察自然出现的预告和交汇警报，再经暂停菜单退出；没有改写游戏状态。",
    warning,
    intersection,
  };
}

async function verifyCompletedFirewallPersistence(page: Page, outputDir: string, id: string) {
  const saved = await exportThroughUi(page);
  assert.equal(saved.payload.ruleVersion, 3);
  for (const [difficulty, target] of [
    ["inner", 40],
    ["deep", 55],
    ["core", 70],
  ] as const) {
    const result = saved.payload.bestResults.find(
      (entry) => entry.challengeId === `a.firewall.${difficulty}` && entry.ruleVersion === 3,
    );
    assert.ok(result && result.bestCombo! >= target, `${difficulty} 的真实 v3 成绩必须已保存`);
  }
  await writeFile(
    join(outputDir, `${id}-completed-save.json`),
    `${JSON.stringify(saved, null, 2)}\n`,
  );
  await page.reload();
  await page.getByRole("button", { name: "继续游戏", exact: true }).click();
  await waitForGameReady(page);
  const restored = await exportThroughUi(page);
  assert.deepEqual(restored.payload, saved.payload, "三档自然结算后的完整稳定进度须刷新恢复一致");
  await closeExportToGame(page);
  return { bestResults: restored.payload.bestResults, restoredIdentically: true };
}

export async function verifyFirewallMigrations(options: {
  browser: Browser;
  url: string;
  outputDir: string;
}) {
  const results = [];
  const expectedContent = assembleContent("M5");
  for (const [id, sourceUrl] of [
    [
      "v1-full-collection",
      new URL(
        "../../docs/verification/evidence/m5-chrome-final-production-complete-save.json",
        import.meta.url,
      ),
    ],
    [
      "v2-earned-result",
      new URL(
        "../../docs/verification/evidence/firewall-hazards/legacy-v2/legacy-v2-earned-save.json",
        import.meta.url,
      ),
    ],
  ] as const) {
    const source = await readFile(sourceUrl);
    const original = JSON.parse(source.toString()) as SaveEnvelope<SavePayload>;
    const context = await options.browser.newContext({ viewport: { width: 1512, height: 771 } });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await context.tracing.start({ screenshots: true, snapshots: true });
    try {
      await page.goto(options.url);
      assert.equal(await page.evaluate(() => Reflect.has(window, "__CAMELLIA_INSPECT__")), false);
      await startNewGame(page);
      await page.getByRole("button", { name: "打开暂停菜单", exact: true }).click();
      await page.getByRole("button", { name: "进度与存档", exact: true }).click();
      const chooser = page.waitForEvent("filechooser");
      await page.getByRole("button", { name: "导入存档", exact: true }).click();
      await (await chooser).setFiles(fileURLToPath(sourceUrl));
      await page.getByRole("heading", { name: "确认导入进度", exact: true }).waitFor();
      const preview = await page.locator(".dialog-description").innerText();
      await page.screenshot({
        path: join(options.outputDir, `${id}-migration-preview.png`),
        fullPage: true,
      });
      await page.getByRole("button", { name: "确认替换", exact: true }).click();
      await waitForGameReady(page);
      const imported = await exportThroughUi(page);
      assert.equal(imported.payload.ruleVersion, 3);
      assert.equal(imported.payload.contentVersion, expectedContent.contentVersion);
      for (const key of [
        "claimedRewardIds",
        "completedObjectiveIds",
        "completedRoomLayouts",
        "playerPosition",
        "bestResults",
        "capabilities",
        "activatedTeleportIds",
        "campaignCompletedAt",
      ] as const)
        assert.deepEqual(imported.payload[key], original.payload[key], `旧档迁移保留 ${key}`);
      if (id === "v1-full-collection") assert.equal(imported.payload.claimedRewardIds.length, 26);
      else
        assert.ok(
          imported.payload.bestResults.some(
            (entry) =>
              entry.challengeId === "a.firewall.tutorial" &&
              entry.ruleVersion === 2 &&
              entry.bestCombo === 14,
          ),
        );
      await writeFile(
        join(options.outputDir, `${id}-migration-save.json`),
        `${JSON.stringify(imported, null, 2)}\n`,
      );
      await page.reload();
      await page.getByRole("button", { name: "继续游戏", exact: true }).click();
      await waitForGameReady(page);
      const restored = await exportThroughUi(page);
      assert.deepEqual(restored.payload, imported.payload);
      let coexistence = null;
      if (id === "v2-earned-result") {
        await closeExportToGame(page);
        await pressGameKey(page, "f");
        await startFirewall(page, "tutorial");
        const route = await createFirewallRoute("tutorial");
        const hits = await playVisibleBeats(page, 18, false, route);
        await finishFirewall(page, { outputDir: options.outputDir, id: `${id}-v3`, combo: 18 });
        const combined = await exportThroughUi(page);
        for (const [ruleVersion, bestCombo] of [
          [2, 14],
          [3, 18],
        ] as const)
          assert.ok(
            combined.payload.bestResults.some(
              (entry) =>
                entry.challengeId === "a.firewall.tutorial" &&
                entry.ruleVersion === ruleVersion &&
                entry.bestCombo === bestCombo,
            ),
          );
        assert.deepEqual(combined.payload.claimedRewardIds, original.payload.claimedRewardIds);
        await writeFile(
          join(options.outputDir, `${id}-coexisting-save.json`),
          `${JSON.stringify(combined, null, 2)}\n`,
        );
        await page.reload();
        await page.getByRole("button", { name: "继续游戏", exact: true }).click();
        await waitForGameReady(page);
        assert.deepEqual((await exportThroughUi(page)).payload, combined.payload);
        coexistence = {
          hits,
          bestResults: combined.payload.bestResults,
          restoredIdentically: true,
        };
      }
      assert.deepEqual(errors, []);
      results.push({
        id,
        method:
          "Normal file chooser, reviewed import, export, reload/continue and export; v2 case earns v3 result through visible-ready direction keys and natural settlement.",
        source: fileURLToPath(sourceUrl),
        sourceSha256: createHash("sha256").update(source).digest("hex"),
        from: {
          contentVersion: original.payload.contentVersion,
          ruleVersion: original.payload.ruleVersion,
        },
        to: {
          contentVersion: imported.payload.contentVersion,
          ruleVersion: imported.payload.ruleVersion,
        },
        preview,
        preservedRewards: imported.payload.claimedRewardIds.length,
        preservedBestResults: imported.payload.bestResults,
        restoredIdentically: true,
        coexistence,
        errors,
      });
    } catch (error) {
      await page.screenshot({
        path: join(options.outputDir, `${id}-migration-failed.png`),
        fullPage: true,
      });
      throw error;
    } finally {
      await context.tracing.stop({ path: join(options.outputDir, `${id}-migration-trace.zip`) });
      await context.close();
    }
  }
  await writeFile(
    join(options.outputDir, "firewall-migrations-results.json"),
    `${JSON.stringify(results, null, 2)}\n`,
  );
  return results;
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
  scenarioIds?: readonly string[];
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
  const selectedScenarios = options.scenarioIds
    ? scenarios.filter((scenario) => options.scenarioIds!.includes(scenario.id))
    : scenarios;
  if (options.scenarioIds)
    assert.deepEqual(
      selectedScenarios.map((scenario) => scenario.id).sort(),
      [...options.scenarioIds].sort(),
      "定向调试只接受已提供 URL 的明确场景；默认仍运行全部场景",
    );
  for (const scenario of selectedScenarios) {
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
      const tutorialRoute = await createFirewallRoute("tutorial");
      const tutorialMiss = await observeNaturalMiss(
        page,
        options.outputDir,
        id,
        reduced,
        tutorialRoute,
      );
      const tutorial = await playVisibleBeats(page, 14, reduced, tutorialRoute);
      const layout = await readAndAssertLayout(page);
      assert.equal(await page.locator(".audio-prompt").isVisible(), false, "本地声音应加载成功");
      const stage = acceptance ? (await inspect(page)).render : null;
      if (stage) {
        assert.equal(stage.tileCount, 20, "中央电视格须为 5×4");
        assert.equal(stage.firewallScoreboards, 4, "两侧须有四块独立的 COMBO 电视");
      }
      await page.screenshot({ path: join(options.outputDir, `${id}.png`), fullPage: true });
      await finishFirewall(page, { outputDir: options.outputDir, id, combo: 18 });
      const hazards = await observeAlarmRecovery(page, {
        outputDir: options.outputDir,
        id,
        reduced,
        acceptance,
      });
      const alarmDirections = await observeAlarmDirectionLayout(page, options.outputDir, id);
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
          const route = await createFirewallRoute(difficulty);
          const performance = await playVisibleBeats(page, combo, false, route);
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
          await writeFile(
            join(options.outputDir, `${formalId}-frame-samples.json`),
            `${JSON.stringify({ ...sampledFrames, frameTiming }, null, 2)}\n`,
          );
          assert.ok(
            frameTiming.medianMs <= 16.7 + 1e-6,
            `${difficulty} 帧间隔中位数 ${frameTiming.medianMs}ms，要求不超过16.7ms`,
          );
          assert.ok(
            frameTiming.p95Ms <= 25 + 1e-6,
            `${difficulty} 帧间隔p95 ${frameTiming.p95Ms}ms，要求不超过25ms`,
          );
          const inputLatency = timingDistribution(
            performance.inputResponses.map((response) => response.latencyMs),
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
                "相邻rAF仅在waiting/ready/hit/judged、无菜单且页面可见并聚焦时纳入；暂停/倒数/菜单/焦点边界重置前帧。",
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
              includesWarmupHits: false,
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
            ...performance,
            playing,
            scenePerformance,
            exited,
            completed: true,
          });
          await writeFile(
            join(options.outputDir, `${formalId}-results.json`),
            `${JSON.stringify(formal.at(-1), null, 2)}\n`,
          );
          console.log(`Chrome firewall level passed: ${difficulty} / ${combo} Combo`);
        }
      }
      const persistence = acceptance
        ? await verifyCompletedFirewallPersistence(page, options.outputDir, id)
        : null;
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
        tutorialMiss,
        hazards,
        alarmDirections,
        pause,
        layout,
        stage,
        musicResponses,
        formal,
        persistence,
        completed: true,
        hiddenAfterExit: true,
        errors,
      });
      await writeFile(
        join(options.outputDir, "firewall-cue-results.json"),
        `${JSON.stringify(results, null, 2)}\n`,
      );
      console.log(`Chrome firewall restoration passed: ${id}`);
    } catch (error) {
      await page.screenshot({ path: join(options.outputDir, `${id}-failed.png`), fullPage: true });
      await writeFile(
        join(options.outputDir, `${id}-failure.json`),
        `${JSON.stringify({ error: error instanceof Error ? error.stack : String(error), observedAt: new Date().toISOString(), inspection: acceptance ? await inspect(page) : null, ui: await page.evaluate(() => ({ phase: document.querySelector("#firewall-rhythm")?.getAttribute("data-phase"), dialog: document.querySelector("#game-dialog")?.textContent })) }, null, 2)}\n`,
      );
      throw error;
    } finally {
      await context.close();
    }
  }
  await writeFile(
    join(options.outputDir, "firewall-cue-results.json"),
    JSON.stringify(results, null, 2) + "\n",
  );
  const migrations = await verifyFirewallMigrations(options);
  return { scenarios: results, migrations };
}
