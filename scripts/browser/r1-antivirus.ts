import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import { build, preview } from "vite";
import { assembleContent } from "../../src/content/assemble.ts";
import routes from "../../src/content/witnesses/r1-world.json" with { type: "json" };
import { createGame, dispatch } from "../../src/core/engine.ts";
import type { GameState, ProfileId } from "../../src/core/types.ts";
import type { R1AntivirusState } from "../../src/core/antivirus.ts";
import type { WorldWitness } from "../../src/content/validate.ts";
import { projectGridPoint } from "../../src/render/layout.ts";
import type { BoardLayout, Point2 } from "../../src/render/layout.ts";
import { pressGameKey, waitForGameReady } from "./support.ts";

type Observation = {
  position: GameState["playerPosition"];
  mode: string;
  phase: string;
  activeTimeMs: number;
  countdownRemainingMs: number;
  pauseReasons: string[];
  settings: GameState["settings"];
  completedObjectiveIds: string[];
  claimedRewardIds: string[];
  realtimeRoom: { roomId: string; state: R1AntivirusState } | null;
  render: { antivirusWaveforms: number; layout: BoardLayout & { displayedFocus: Point2 } };
};
async function observe(page: Page): Promise<Observation> {
  return page.evaluate(() =>
    (Reflect.get(window, "__CAMELLIA_INSPECT__") as { snapshot(): Observation }).snapshot(),
  );
}
const keys = { up: "ArrowUp", right: "ArrowRight", down: "ArrowDown", left: "ArrowLeft" };

async function reachAntivirus(page: Page, profile: ProfileId, output: string) {
  const content = assembleContent(profile);
  const route = routes.witnesses.find(
    (item) => item.profileId === profile && item.id.includes("main-path"),
  ) as WorldWitness;
  let state = createGame(content, 0);
  const commands: unknown[] = [];
  await page.getByRole("button", { name: "新游戏", exact: true }).click();
  await page.locator("#game-canvas[aria-busy='false']").waitFor({ state: "visible" });
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  const startup = await observe(page);
  const startupRecovered = startup.pauseReasons.length > 0;
  if (startup.pauseReasons.length) {
    assert.deepEqual(startup.pauseReasons, ["clockGap"]);
    assert.deepEqual(startup.position, state.playerPosition);
    assert.match(await page.locator(".dialog-description").innerText(), /检测到前台调度中断/);
    await writeFile(
      join(output, "startup-recovery.json"),
      JSON.stringify(
        {
          scope:
            "Only once before the first route command; normal Continue UI, no internal mutation",
          startup,
        },
        null,
        2,
      ),
    );
    await page.getByRole("button", { name: "继续探索", exact: true }).click();
  }
  await waitForGameReady(page);
  for (const step of route.steps) {
    const result = dispatch(content, state, step.command, step.atMs);
    assert.equal(result.code, step.expectedCode);
    state = result.state;
    if (step.command.kind === "Tick") continue;
    await page.locator("#game-canvas[aria-busy='false']").waitFor({ state: "visible" });
    await page.waitForFunction(
      () => !document.querySelector("#mode-banner")?.textContent?.includes("记住安全路线"),
    );
    const command = step.command;
    if (command.kind === "Move") await pressGameKey(page, keys[command.direction]);
    else if (command.kind === "Amplify" || command.kind === "Interact")
      await pressGameKey(page, command.kind === "Amplify" ? "r" : "f");
    else throw new Error(`Unexpected route command before B: ${command.kind}`);
    await page.waitForFunction(
      (tile) =>
        (Reflect.get(window, "__CAMELLIA_INSPECT__") as { snapshot(): Observation }).snapshot()
          .position.tileId === tile,
      state.playerPosition.tileId,
    );
    const actual = await observe(page);
    assert.deepEqual(actual.completedObjectiveIds, state.completedObjectiveIds);
    assert.deepEqual(actual.claimedRewardIds, state.claimedRewardIds);
    commands.push({ command, position: actual.position });
    if (state.playerPosition.areaId === "b") break;
  }
  assert.equal(state.playerPosition.tileId, "b.t.0.0");
  await waitForGameReady(page);
  for (const key of ["ArrowDown", "ArrowDown", "ArrowDown", "f"]) await pressGameKey(page, key);
  assert.equal((await observe(page)).mode, "challengeReady");
  assert.equal((await observe(page)).position.tileId, "b.t.0.3");
  return { commands, startupRecovered };
}

const stagePreparationRecoveries = new WeakSet<Page>();
async function running(page: Page, preparationOutput?: string) {
  await page.locator("#game-canvas[aria-busy='false']").waitFor({ state: "visible" });
  if (preparationOutput) {
    await page.waitForFunction(() => {
      const state = (
        Reflect.get(window, "__CAMELLIA_INSPECT__") as { snapshot(): Observation }
      ).snapshot();
      return state.pauseReasons.length > 0 || state.activeTimeMs >= 100;
    });
    const observed = await observe(page);
    if (observed.pauseReasons.length) {
      assert.equal(
        stagePreparationRecoveries.has(page),
        false,
        "at most one first-stage preparation recovery",
      );
      assert.deepEqual(observed.pauseReasons, ["clockGap"]);
      assert.equal(observed.activeTimeMs, 0);
      assert.ok(observed.countdownRemainingMs > 0);
      assert.deepEqual(observed.realtimeRoom?.state.activeTargets, []);
      stagePreparationRecoveries.add(page);
      await writeFile(
        join(preparationOutput, "stage-preparation-recovery.json"),
        JSON.stringify(
          {
            scope: "First B stage only, active time zero and no target; normal Continue button",
            observed,
          },
          null,
          2,
        ),
      );
      await page.getByRole("button", { name: "继续探索", exact: true }).click();
    }
  }
  await page.waitForFunction(() => {
    const state = (
      Reflect.get(window, "__CAMELLIA_INSPECT__") as { snapshot(): Observation }
    ).snapshot();
    return (
      state.mode === "challengeRunning" &&
      state.countdownRemainingMs === 0 &&
      state.activeTimeMs >= 100
    );
  });
}
async function verifyPause(page: Page, output: string, tier: string, reduced: boolean) {
  await page.getByRole("button", { name: "打开暂停菜单", exact: true }).click();
  const paused = await observe(page);
  assert.ok(paused.pauseReasons.length > 0);
  if (reduced) {
    await page.getByRole("button", { name: "声音与显示", exact: true }).click();
    await page.getByRole("checkbox", { name: "静音", exact: true }).check();
    await page.getByRole("checkbox", { name: "减少闪烁", exact: true }).check();
    await page.getByRole("checkbox", { name: "减少动态效果", exact: true }).check();
  }
  await page.waitForTimeout(450);
  const after = await observe(page);
  assert.equal(after.activeTimeMs, paused.activeTimeMs);
  assert.deepEqual(after.realtimeRoom?.state, paused.realtimeRoom?.state);
  await page.screenshot({ path: join(output, `${tier}-paused.png`) });
  if (reduced) {
    const first = await page.locator("#game-canvas").screenshot();
    await page.waitForTimeout(350);
    assert.deepEqual(await page.locator("#game-canvas").screenshot(), first);
    for (const [name, checked] of [
      ["静音", paused.settings.muted],
      ["减少闪烁", paused.settings.reducedFlash],
      ["减少动态效果", paused.settings.reducedMotion],
    ] as const)
      await page.getByRole("checkbox", { name, exact: true }).setChecked(checked);
  }
  await page.getByRole("button", { name: "继续探索", exact: true }).click();
  await running(page);
  return { pausedAt: paused.activeTimeMs, frozenForMs: 450, settings: after.settings };
}

/** Own fresh context; only normal UI keys and pointer clicks, with read-only acceptance observation. */
export async function verifyR1Antivirus(options: {
  browser: Browser;
  url: string;
  profile?: ProfileId;
  outputDir: string;
}) {
  const startedAt = new Date().toISOString();
  const profile = options.profile ?? "M5";
  const output = join(options.outputDir, "antivirus");
  await mkdir(output, { recursive: true });
  const context = await options.browser.newContext({ viewport: { width: 1512, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const errors: string[] = [],
    attempts: unknown[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const content = assembleContent(profile);
  try {
    await page.goto(options.url);
    await page.bringToFront();
    const route = await reachAntivirus(page, profile, output);
    for (const [index, tier] of ["light", "medium", "heavy"].entries()) {
      const definition = content.realtimeChallenges.find(
        (item) => item.id === `b.antivirus.${tier}`,
      );
      assert.ok(definition?.kind === "antivirus" && definition.ruleVersion === 4);
      await page.locator(".challenge-choice").nth(index).click();
      await running(page, index === 0 ? output : undefined);
      const pause = await verifyPause(page, output, tier!, index === 1);
      await page.waitForFunction(
        () =>
          (Reflect.get(window, "__CAMELLIA_INSPECT__") as { snapshot(): Observation }).snapshot()
            .mode === "challengeResult",
        undefined,
        { timeout: 20_000 },
      );
      const failure = await observe(page);
      assert.equal(failure.phase, "failure");
      assert.equal(failure.realtimeRoom?.state.failureReason, "overflow");
      assert.equal(
        failure.realtimeRoom.state.activeTargets.filter((target) => target.kind !== "star").length,
        10,
      );
      await page.screenshot({ path: join(output, `${tier}-overflow.png`) });
      await page.getByRole("button", { name: "再挑战一次", exact: true }).click();
      await page.locator(".challenge-choice").nth(index).click();
      await running(page);
      const inputs: unknown[] = [];
      let clearedFirstStar = false;
      while (true) {
        const before = await observe(page);
        assert.deepEqual(
          before.pauseReasons,
          [],
          "unexpected browser scheduling pause must not be silently resumed",
        );
        if (before.mode === "challengeResult") break;
        const state = before.realtimeRoom!.state;
        const mature = state.activeTargets.filter(
          (target) => before.activeTimeMs - target.spawnAtMs >= 250,
        );
        const target = clearedFirstStar
          ? mature[0]
          : mature.find((target) => target.kind === "star");
        if (!target) {
          await page.waitForTimeout(40);
          continue;
        }
        if (!clearedFirstStar) {
          const marks = await page.locator("#tile-labels .tile-mark").allTextContents();
          assert.ok(
            marks.includes("1") && marks.includes("2") && marks.includes("★"),
            "actual projection keeps numeric and shape assistance alongside target colors",
          );
          assert.match(await page.locator("#antivirus-count").innerText(), /7\s*\/\s*9/);
        }
        const tile = definition.tiles.find((tile) => tile.id === target.tileId)!;
        const point = projectGridPoint(tile),
          layout = before.render.layout;
        const canvas = await page.locator("#game-canvas").boundingBox();
        assert.ok(canvas);
        await page.mouse.click(
          canvas.x +
            layout.available.left +
            layout.available.width / 2 +
            (point.x - layout.displayedFocus.x) * layout.pixelsPerWorldUnit,
          canvas.y +
            layout.available.top +
            layout.available.height / 2 +
            (point.y - layout.displayedFocus.y) * layout.pixelsPerWorldUnit,
        );
        await page.waitForTimeout(30);
        const after = await observe(page);
        assert.ok(
          !after.realtimeRoom!.state.activeTargets.some((item) => item.id === target.id),
          "physical pointer must clear selected presented target",
        );
        if (!clearedFirstStar) {
          assert.equal(after.realtimeRoom!.state.lastStarClearCount, 7);
          clearedFirstStar = true;
        }
        inputs.push({
          target,
          observedAtMs: before.activeTimeMs,
          scoreAfter: after.realtimeRoom!.state.score,
        });
      }
      const success = await observe(page);
      assert.equal(success.phase, "success");
      assert.equal(
        success.settings.reducedMotion,
        false,
        "all three successful attempts use standard motion",
      );
      assert.equal(
        success.settings.reducedFlash,
        false,
        "all three successful attempts use standard flash settings",
      );
      assert.ok(clearedFirstStar);
      assert.ok(success.realtimeRoom!.state.score >= definition.rules.completionRules.targetScore);
      assert.equal(success.render.antivirusWaveforms, 4);
      assert.match(await page.locator(".result-score").innerText(), /本次清除.*本规则最佳/);
      await page.screenshot({ path: join(output, `${tier}-success.png`) });
      attempts.push({ tier, pause, failure, inputs, success });
      await writeFile(
        join(output, `${tier}-result.json`),
        JSON.stringify(attempts.at(-1), null, 2),
      );
      await page.getByRole("button", { name: "返回地图", exact: true }).click();
      await waitForGameReady(page);
      await pressGameKey(page, "f");
    }
    assert.deepEqual(errors, []);
    const result = {
      browser: options.browser.version(),
      startedAt,
      finishedAt: new Date().toISOString(),
      stagePreparationRecovered: stagePreparationRecoveries.has(page),
      freshGame: true,
      profile,
      route,
      attempts,
      errors,
    };
    await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    await page.screenshot({ path: join(output, "failure.png") }).catch(() => {});
    await writeFile(
      join(output, "failure.json"),
      JSON.stringify(
        { error: String(error), attempts, actual: await observe(page).catch(() => null), errors },
        null,
        2,
      ),
    );
    throw error;
  } finally {
    await context.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const directory = resolve("test-results/r1-antivirus-build");
  await build({ mode: "acceptance", build: { outDir: directory } });
  const server = await preview({
    mode: "acceptance",
    build: { outDir: directory },
    preview: { host: "127.0.0.1", port: 0, strictPort: true },
  });
  const address = server.httpServer.address();
  assert.ok(address && typeof address !== "string");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    await verifyR1Antivirus({
      browser,
      url: `http://127.0.0.1:${address.port}`,
      outputDir: resolve("test-results/r1-browser"),
    });
  } finally {
    await browser.close();
    await new Promise<void>((done) => server.httpServer.close(() => done()));
  }
}
