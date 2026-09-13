import assert from "node:assert/strict";
import { mkdir, writeFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import { build, preview } from "vite";
import { assembleContent } from "../../src/content/assemble.ts";
import { dispatch } from "../../src/core/engine.ts";
import { projectBoard } from "../../src/core/projection.ts";
import { antivirusActiveTargets } from "../../src/core/realtime.ts";
import type { GhostsDefinition } from "../../src/core/realtime.ts";
import { projectGridPoint } from "../../src/render/layout.ts";
import { R1NormalDriver, R1_EARNED_SAVE, observeR1 } from "./r1-visual-performance.ts";
import type { R1Observation } from "./r1-visual-performance.ts";
import { pressGameKey } from "./support.ts";

const content = assembleContent("M5");
const keys = { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" };
type Observation = R1Observation & {
  inputLatency: { sampleCount: number };
  saveGeneration: number;
};
const observe = (page: Page) => observeR1(page) as Promise<Observation>;

async function genuineFocusBrowser() {
  const directory = await mkdtemp(join(tmpdir(), "camellia-r1-real-focus-"));
  const process = spawn(
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    [
      "--remote-debugging-port=0",
      `--user-data-dir=${directory}`,
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  let launchError: Error | undefined;
  process.once("error", (error) => {
    launchError = error;
  });
  const cleanup = async () => {
    process.kill("SIGTERM");
    for (let i = 0; i < 30 && process.exitCode === null && process.signalCode === null; i++)
      await new Promise((done) => setTimeout(done, 100));
    if (process.exitCode === null && process.signalCode === null) process.kill("SIGKILL");
    await rm(directory, { recursive: true, force: true });
  };
  try {
    let port: number | undefined;
    for (let i = 0; i < 100; i++) {
      if (launchError) throw launchError;
      const raw = await readFile(join(directory, "DevToolsActivePort"), "utf8").catch(() => "");
      if (raw) {
        port = Number(raw.split("\n")[0]);
        break;
      }
      await new Promise((done) => setTimeout(done, 100));
    }
    assert.ok(port);
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { noDefaults: true });
    return { browser, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

function permanent(state: Observation) {
  return {
    objectives: state.completedObjectiveIds,
    rewards: state.claimedRewardIds,
    layouts: state.completedRoomLayouts,
    results: state.bestResults,
  };
}

async function pointerPoint(page: Page, tile: { x: number; y: number }, state: Observation) {
  const canvas = await page.locator("#game-canvas").boundingBox();
  assert.ok(canvas);
  const { layout } = state.render,
    projected = projectGridPoint(tile);
  return {
    x:
      canvas.x +
      layout.available.left +
      layout.available.width / 2 +
      (projected.x - layout.displayedFocus.x) * layout.pixelsPerWorldUnit,
    y:
      canvas.y +
      layout.available.top +
      layout.available.height / 2 +
      (projected.y - layout.displayedFocus.y) * layout.pixelsPerWorldUnit,
  };
}

/** Read-only event/position observation. All inputs are Playwright keyboard/mouse operations. */
async function watchInputs(page: Page) {
  return page.evaluateHandle(() => {
    const events: {
      type: string;
      key?: string;
      repeat?: boolean;
      target: string;
      time: number;
      position?: Observation["position"];
    }[] = [];
    const positions: { tileId: string; time: number }[] = [];
    let raf = 0,
      stopped = false;
    const listener = (event: Event) => {
      const key = event instanceof KeyboardEvent ? { key: event.code, repeat: event.repeat } : {};
      events.push({
        type: event.type,
        ...key,
        target: (event.target as HTMLElement)?.id ?? "",
        time: performance.now(),
        // Capture the actual release boundary, before another animation frame can run.
        ...(event.type === "keyup"
          ? {
              position: (
                Reflect.get(window, "__CAMELLIA_INSPECT__") as { snapshot(): Observation }
              ).snapshot().position,
            }
          : {}),
      });
    };
    const frame = () => {
      if (stopped) return;
      const state = (
        Reflect.get(window, "__CAMELLIA_INSPECT__") as { snapshot(): Observation }
      ).snapshot();
      if (positions.at(-1)?.tileId !== state.position.tileId)
        positions.push({ tileId: state.position.tileId, time: performance.now() });
      raf = requestAnimationFrame(frame);
    };
    for (const type of ["keydown", "keyup", "pointerdown", "click"])
      document.addEventListener(type, listener, true);
    raf = requestAnimationFrame(frame);
    return {
      stop() {
        stopped = true;
        cancelAnimationFrame(raf);
        for (const type of ["keydown", "keyup", "pointerdown", "click"])
          document.removeEventListener(type, listener, true);
        return { events, positions };
      },
    };
  });
}

async function startFromChoice(page: Page, roomId: string, index: number) {
  await page.locator(".challenge-choice").nth(index).click();
  await page.waitForFunction(
    (id) =>
      (Reflect.get(window, "__CAMELLIA_INSPECT__") as { snapshot(): Observation }).snapshot()
        .realtimeRoom?.roomId === id,
    roomId,
  );
  await page.locator("#game-canvas[aria-busy='false']").waitFor({ state: "visible" });
  const prepared = await observe(page);
  assert.deepEqual(prepared.pauseReasons, []);
  return prepared;
}

async function running(page: Page) {
  await page.waitForFunction(() => {
    const state = (
      Reflect.get(window, "__CAMELLIA_INSPECT__") as { snapshot(): Observation }
    ).snapshot();
    return (
      state.realtimeRoom !== null &&
      state.countdownRemainingMs === 0 &&
      state.pauseReasons.length === 0
    );
  });
  await page.locator("#game-canvas").focus();
  return observe(page);
}

async function enterRealtime(driver: R1NormalDriver, roomId: string) {
  const definition = content.realtimeChallenges.find((item) => item.id === roomId)!;
  const area = content.rooms.find((item) => item.id === roomId)!.areaId;
  await driver.teleport(area);
  const access = content.entities.find((item) =>
    item.kind === "challengeAccess"
      ? item.params.challengeIds.includes(roomId)
      : item.kind === "roomEntrance" && item.params.roomId === roomId,
  )!;
  await driver.walkTo(access.tileId);
  await driver.send({ kind: "Interact" });
  const index = access.kind === "challengeAccess" ? access.params.challengeIds.indexOf(roomId) : 0;
  const prediction = dispatch(
    content,
    driver.model,
    { kind: "StartChallenge", challengeId: roomId },
    driver.model.clock.lastMonotonicTimeMs + 250,
  );
  assert.equal(prediction.code, "accepted");
  const prepared = await startFromChoice(driver.page, roomId, index);
  driver.model = prediction.state;
  return { definition, index, prepared, active: await running(driver.page) };
}

function assertGhostInitial(definition: GhostsDefinition, state: Observation) {
  const realtime = state.realtimeRoom?.state;
  assert.equal(realtime?.kind, "ghosts");
  if (realtime?.kind !== "ghosts") throw new Error("expected ghosts");
  assert.equal(realtime.playerTileId, definition.entry.tileId);
  assert.deepEqual(realtime.litLampIds, []);
  assert.deepEqual(realtime.removedGhostIds, []);
  assert.deepEqual(
    realtime.ghostPathIndices,
    Object.fromEntries(definition.rules.ghosts.map((ghost) => [ghost.id, ghost.initialIndex])),
  );
  assert.deepEqual(
    realtime.nextGhostStepAtMs,
    Object.fromEntries(definition.rules.ghosts.map((ghost) => [ghost.id, ghost.stepMs])),
  );
  assert.equal(realtime.lastPlayerMoveAtMs, null);
}

export async function verifyR1InputRealtimeBoundaries(options: {
  browser: Browser;
  url: string;
  outputDir: string;
  sourcePath?: string;
}) {
  const output = join(options.outputDir, "input-realtime-boundaries");
  await mkdir(output, { recursive: true });
  const results: { id: string; file: string; reused?: boolean }[] = [];
  const caseNames = process.argv
    .find((arg) => arg.startsWith("--cases="))
    ?.slice(8)
    .split(",");
  async function scenario(
    id: string,
    run: (page: Page, driver: R1NormalDriver) => Promise<unknown>,
    newGame = false,
  ) {
    if (caseNames && !caseNames.includes(id)) {
      const previous = JSON.parse(await readFile(join(output, `${id}.json`), "utf8"));
      assert.equal(previous.id, id);
      assert.equal(previous.before.ruleVersion, 4);
      assert.equal(previous.before.contentVersion, 6);
      results.push({ id, file: `${id}.json`, reused: true });
      return;
    }
    const headed = id === "d.ghost.02-held-blur";
    const dedicated = headed ? await genuineFocusBrowser() : null;
    const browser = dedicated?.browser ?? options.browser;
    const context = headed
      ? browser.contexts()[0]!
      : await browser.newContext({
          viewport: { width: 1366, height: 768 },
          deviceScaleFactor: 1,
        });
    const page = await context.newPage();
    if (headed) await page.setViewportSize({ width: 1366, height: 768 });
    page.setDefaultTimeout(15000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      const driver = newGame
        ? await R1NormalDriver.newGame(page, options.url)
        : await R1NormalDriver.importEarned(
            page,
            options.url,
            options.sourcePath ?? R1_EARNED_SAVE,
          );
      const before = await observe(page);
      const result = await run(page, driver);
      const after = await observe(page);
      assert.deepEqual(errors, []);
      const file = `${id}.json`;
      await writeFile(
        join(output, file),
        JSON.stringify(
          {
            id,
            browser: browser.version(),
            headless: !headed,
            focusEmulation: headed ? false : "Playwright default",
            before,
            after,
            result,
            commands: driver.commands,
            errors,
          },
          null,
          2,
        ),
      );
      results.push({ id, file });
      console.log(`R1 input/realtime ${id} passed`);
    } catch (error) {
      await writeFile(
        join(output, `${id}-failure.json`),
        JSON.stringify(
          { id, error: String(error), actual: await observe(page).catch(() => null), errors },
          null,
          2,
        ),
      );
      await page
        .screenshot({
          path: join(output, `${id}-failure.jpg`),
          type: "jpeg",
          quality: 80,
          scale: "css",
        })
        .catch(() => {});
      throw error;
    } finally {
      if (dedicated) {
        try {
          await browser.close();
        } finally {
          await dedicated.cleanup();
        }
      } else await context.close();
    }
  }

  await scenario("two-held-keys", async (page, driver) => {
    await driver.teleport("warehouse");
    await driver.ready();
    const before = await observe(page),
      watcher = await watchInputs(page);
    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(40);
    await page.keyboard.down("ArrowLeft");
    await page.waitForTimeout(190);
    const latest = await observe(page);
    assert.equal(latest.position.tileId, "warehouse.t.0.0");
    await page.waitForTimeout(300);
    const bothHeld = await observe(page);
    assert.equal(bothHeld.position.tileId, "warehouse.t.0.0");
    await page.keyboard.up("ArrowLeft");
    await page.waitForTimeout(180);
    const earlierStillHeld = await observe(page);
    assert.notEqual(earlierStillHeld.position.tileId, "warehouse.t.0.0");
    await page.keyboard.up("ArrowRight");
    await page.waitForTimeout(200);
    const stopped = await observe(page);
    const inputs = await watcher.evaluate((value) => value.stop());
    await watcher.dispose();
    const released = inputs.events.find(
      (event) => event.type === "keyup" && event.key === "ArrowRight",
    );
    assert.ok(released?.position, "必须记录真实 ArrowRight keyup 时的位置");
    assert.deepEqual(stopped.position, released.position);
    assert.deepEqual(permanent(stopped), permanent(before));
    return {
      before,
      latest,
      bothHeld,
      earlierStillHeld,
      released,
      stopped,
      inputs,
      method:
        "both arrows physically held; latest Left wins, release Left restores still-held Right; release all stops",
    };
  });

  await scenario("repeated-keydown", async (page, driver) => {
    await driver.teleport("warehouse");
    await driver.ready();
    await page.waitForTimeout(200);
    const before = await observe(page),
      watcher = await watchInputs(page);
    await page.keyboard.down("ArrowRight");
    await page.keyboard.down("ArrowRight");
    await page.keyboard.down("ArrowRight");
    await page.keyboard.up("ArrowRight");
    await page.waitForTimeout(350);
    const after = await observe(page),
      inputs = await watcher.evaluate((value) => value.stop());
    await watcher.dispose();
    await writeFile(
      join(output, "repeated-keydown-observed.json"),
      JSON.stringify({ before, after, inputs }, null, 2),
    );
    assert.equal(after.position.tileId, "warehouse.t.1.0");
    assert.equal(
      inputs.events.filter((event) => event.type === "keydown" && event.repeat).length,
      2,
    );
    assert.equal(after.inputLatency.sampleCount - before.inputLatency.sampleCount, 1);
    assert.equal(after.saveGeneration - before.saveGeneration, 1);
    assert.deepEqual(permanent(after), permanent(before));
    return { before, after, inputs };
  });

  await scenario("pending-direction-overwrite", async (page, driver) => {
    await driver.teleport("warehouse");
    await driver.walkTo("warehouse.t.1.0");
    await driver.ready();
    await page.waitForTimeout(200);
    const before = await observe(page),
      watcher = await watchInputs(page);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(400);
    const settled = await observe(page);
    await page.waitForTimeout(400);
    const later = await observe(page),
      inputs = await watcher.evaluate((value) => value.stop());
    await watcher.dispose();
    assert.equal(settled.position.tileId, "warehouse.t.1.0");
    assert.deepEqual(later.position, settled.position);
    assert.equal(later.inputLatency.sampleCount - before.inputLatency.sampleCount, 2);
    assert.equal(later.saveGeneration - before.saveGeneration, 2);
    assert.ok(!inputs.positions.some((item) => item.tileId === "warehouse.t.2.-1"));
    assert.deepEqual(permanent(later), permanent(before));
    return {
      before,
      settled,
      later,
      inputs,
      method:
        "physical Right/Up/Left; Up is legal from first destination but overwritten by newest Left; 800ms no burst",
    };
  });

  await scenario(
    "single-pointer-transaction",
    async (page, driver) => {
      await page.waitForTimeout(200);
      const before = await observe(page),
        watcher = await watchInputs(page);
      const tile = projectBoard(content, driver.model).tiles.find(
        (item) => item.id === "hub.t.1.2",
      )!;
      const point = await pointerPoint(page, tile, before);
      await page.mouse.click(point.x, point.y);
      await page.waitForTimeout(350);
      const after = await observe(page),
        inputs = await watcher.evaluate((value) => value.stop());
      await watcher.dispose();
      assert.equal(after.position.tileId, tile.id);
      assert.equal(after.completedObjectiveIds.filter((id) => id === "hub.amplifier").length, 1);
      assert.equal(after.inputLatency.sampleCount - before.inputLatency.sampleCount, 1);
      assert.equal(after.saveGeneration - before.saveGeneration, 1);
      assert.equal(
        inputs.events.filter(
          (event) => event.type === "pointerdown" && event.target === "game-canvas",
        ).length,
        1,
      );
      assert.equal(
        inputs.events.filter((event) => event.type === "click" && event.target === "game-canvas")
          .length,
        1,
      );
      return {
        before,
        after,
        point,
        inputs,
        method:
          "one actual mouse gesture emits pointerdown+click, one movement feedback sample and one amplifier permanent transaction",
      };
    },
    true,
  );

  for (const roomId of ["d.ghost.01", "d.ghost.02"])
    await scenario(`${roomId}-collision-retry`, async (page, driver) => {
      const entered = await enterRealtime(driver, roomId);
      assert.equal(entered.definition.kind, "ghosts");
      const definition = entered.definition as GhostsDefinition;
      const permanentBefore = permanent(entered.active);
      const path =
        roomId === "d.ghost.01"
          ? (["down", "left", "left", "down"] as const)
          : (["down", "left", "down"] as const);
      for (const direction of path) {
        if ((await observe(page)).mode === "challengeResult") break;
        await pressGameKey(page, keys[direction]);
      }
      await page.waitForFunction(
        () =>
          (Reflect.get(window, "__CAMELLIA_INSPECT__") as { snapshot(): Observation }).snapshot()
            .mode === "challengeResult",
        undefined,
        { timeout: 5000 },
      );
      const failure = await observe(page);
      assert.equal(failure.phase, "failure");
      assert.deepEqual(permanent(failure), permanentBefore);
      await page.getByRole("button", { name: "再挑战一次", exact: true }).click();
      const retry = await startFromChoice(page, roomId, entered.index);
      assertGhostInitial(definition, retry);
      const restarted = await running(page);
      assert.equal(restarted.position.tileId, definition.entry.tileId);
      assert.deepEqual(permanent(restarted), permanentBefore);
      return {
        entered,
        path,
        failure,
        retry,
        restarted,
        method:
          "normal arrows enter patrol path and wait for actual collision; normal Retry and challenge selection restore initial player/ghost/lamp state",
      };
    });

  await scenario("d.ghost.02-held-blur", async (page, driver) => {
    const other = await page.context().newPage();
    await other.goto("about:blank");
    await page.bringToFront();
    if (await page.getByRole("button", { name: "继续探索", exact: true }).isVisible())
      await page.getByRole("button", { name: "继续探索", exact: true }).click();
    await driver.ready(true);
    const entered = await enterRealtime(driver, "d.ghost.02");
    const watcher = await watchInputs(page);
    await page.keyboard.down("ArrowDown");
    await page.waitForFunction(
      () =>
        (Reflect.get(window, "__CAMELLIA_INSPECT__") as { snapshot(): Observation }).snapshot()
          .position.tileId === "d.ghost.02.tile.2.0",
    );
    await other.bringToFront();
    await other.waitForTimeout(150);
    await writeFile(
      join(output, "d.ghost.02-focus-switch-observed.json"),
      JSON.stringify(
        {
          page: await page.evaluate(() => ({
            hidden: document.hidden,
            focused: document.hasFocus(),
          })),
          other: await other.evaluate(() => ({
            hidden: document.hidden,
            focused: document.hasFocus(),
          })),
          actual: await observe(page),
        },
        null,
        2,
      ),
    );
    await page.waitForFunction(() => document.hidden || !document.hasFocus(), undefined, {
      timeout: 3000,
      polling: 50,
    });
    const background = await observe(page);
    assert.ok(
      background.pauseReasons.includes("blur") || background.pauseReasons.includes("hidden"),
    );
    const realBackground = await page.evaluate(() => ({
      hidden: document.hidden,
      focused: document.hasFocus(),
    }));
    assert.ok(realBackground.hidden || !realBackground.focused);
    await other.waitForTimeout(30000);
    const after30s = await observe(page);
    assert.deepEqual(after30s.realtimeRoom, background.realtimeRoom);
    assert.equal(after30s.activeTimeMs, background.activeTimeMs);
    await page.bringToFront();
    const beforeResume = await observe(page);
    await page.getByRole("button", { name: "继续探索", exact: true }).click();
    const returned = await observe(page);
    assert.deepEqual(returned.pauseReasons, []);
    assert.ok(returned.countdownRemainingMs > 0 && returned.countdownRemainingMs <= 3000);
    await page.waitForTimeout(900);
    const countdown = await observe(page);
    assert.equal(countdown.activeTimeMs, background.activeTimeMs);
    await running(page);
    await page.waitForTimeout(800);
    const clearedHeld = await observe(page);
    assert.equal(clearedHeld.position.tileId, "d.ghost.02.tile.2.0");
    await page.keyboard.up("ArrowDown");
    await pressGameKey(page, "ArrowDown");
    const freshPress = await observe(page);
    assert.equal(freshPress.position.tileId, "d.ghost.02.tile.2.1");
    assert.deepEqual(permanent(freshPress), permanent(entered.active));
    const inputs = await watcher.evaluate((value) => value.stop());
    await watcher.dispose();
    await other.close();
    return {
      entered,
      background,
      realBackground,
      after30s,
      beforeResume,
      returned,
      countdown,
      clearedHeld,
      freshPress,
      inputs,
    };
  });

  await scenario("antivirus-keyboard-mouse", async (page, driver) => {
    const entered = await enterRealtime(driver, "b.antivirus.light");
    const definition = entered.definition;
    assert.equal(definition.kind, "antivirus");
    if (definition.kind !== "antivirus") throw new Error("expected antivirus");
    const watcher = await watchInputs(page);
    await pressGameKey(page, "ArrowLeft");
    await pressGameKey(page, "ArrowLeft");
    await page.waitForFunction(() => {
      const state = (
        Reflect.get(window, "__CAMELLIA_INSPECT__") as { snapshot(): Observation }
      ).snapshot();
      return state.activeTimeMs >= 1250;
    });
    await pressGameKey(page, "f");
    const keyboard = await observe(page);
    assert.equal(keyboard.realtimeRoom?.state.kind, "antivirus");
    if (keyboard.realtimeRoom?.state.kind !== "antivirus") throw new Error("expected antivirus");
    assert.equal(keyboard.realtimeRoom.state.score, 1);
    await page.waitForFunction(
      () =>
        (Reflect.get(window, "__CAMELLIA_INSPECT__") as { snapshot(): Observation }).snapshot()
          .activeTimeMs >= 2250,
    );
    const beforeMouse = await observe(page);
    if (beforeMouse.realtimeRoom?.state.kind !== "antivirus") throw new Error("expected antivirus");
    const target = antivirusActiveTargets(definition, beforeMouse.realtimeRoom.state).find(
      (item) => item.tileId !== beforeMouse.position.tileId,
    )!;
    assert.ok(target);
    const tile = definition.tiles.find((item) => item.id === target.tileId)!;
    const point = await pointerPoint(page, tile, beforeMouse);
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(180);
    const mouse = await observe(page),
      focus = await page
        .locator("#game-canvas")
        .evaluate((canvas) => document.activeElement === canvas);
    assert.equal(mouse.realtimeRoom?.state.kind, "antivirus");
    if (mouse.realtimeRoom?.state.kind !== "antivirus") throw new Error("expected antivirus");
    assert.ok(mouse.realtimeRoom.state.score > keyboard.realtimeRoom.state.score);
    assert.equal(focus, true);
    assert.equal(definition.ruleVersion, 4);
    assert.deepEqual(mouse.pauseReasons, []);
    const inputs = await watcher.evaluate((value) => value.stop());
    await watcher.dispose();
    return { entered, keyboard, beforeMouse, point, mouse, focus, inputs };
  });

  await writeFile(
    join(output, "result.json"),
    JSON.stringify(
      {
        browser: options.browser.version(),
        sourcePath: options.sourcePath ?? R1_EARNED_SAVE,
        selectedCases: caseNames ?? "all",
        results,
      },
      null,
      2,
    ),
  );
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const directory = resolve("test-results/r1-input-realtime-build");
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
    await verifyR1InputRealtimeBoundaries({
      browser,
      url: `http://127.0.0.1:${address.port}`,
      outputDir: resolve("test-results/r1-browser"),
    });
  } finally {
    await browser.close();
    await new Promise<void>((done) => server.httpServer.close(() => done()));
  }
}
