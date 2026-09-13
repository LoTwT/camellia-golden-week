import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import { build, preview } from "vite";
import {
  assembleContent,
  migrationContentReleases,
  realtimeContent,
  staticContent,
} from "../../src/content/assemble.ts";
import routes from "../../src/content/witnesses/r1-world.ts";
import { createGame, dispatch } from "../../src/core/engine.ts";
import { publishedProfileMigrations } from "../../src/platform/migrations.ts";
import { restorePayload, validatePayload } from "../../src/platform/save-payload.ts";
import type { GameState, ProfileId, GameCommand } from "../../src/core/types.ts";
import type { WorldWitness } from "../../src/content/validate.ts";
import type { BoardLayout, Point2 } from "../../src/render/layout.ts";
import { projectGridPoint } from "../../src/render/layout.ts";
import { exportThroughUi, pressGameKey, waitForGameReady } from "./support.ts";

interface Observation {
  position: GameState["playerPosition"];
  mode: GameState["mode"];
  phase: string;
  activeTimeMs: number;
  pauseReasons: string[];
  countdownRemainingMs: number;
  completedObjectiveIds: string[];
  claimedRewardIds: string[];
  realtimeRoom: GameState["activeRealtime"];
  staticRoom: { roomId: string; layout: unknown } | null;
  render: { layout: BoardLayout & { displayedFocus: Point2 } };
}
async function observe(page: Page): Promise<Observation> {
  return page.evaluate(() => {
    const observer = Reflect.get(window, "__CAMELLIA_INSPECT__") as { snapshot(): Observation };
    return observer.snapshot();
  });
}
const keys = { up: "ArrowUp", right: "ArrowRight", down: "ArrowDown", left: "ArrowLeft" };

async function verifyStaticRecovery(page: Page, roomId: string, output: string) {
  const witness = staticContent.witnesses.find(
    (item) =>
      item.definitionId === roomId &&
      (item.kind === "deadEndRecovery" || item.kind === "failureRecovery"),
  )!;
  const initial = await observe(page);
  const actions = witness.actions.slice(0, witness.actions.indexOf("reset") + 1);
  assert.ok(actions.length > 1);
  const observations: unknown[] = [];
  for (const action of actions) {
    if (action === "undo") {
      const deadEnd = await observe(page);
      await page.screenshot({ path: join(output, `${roomId}-recovery-before-undo.png`) });
      observations.push({ kind: "before-undo", state: deadEnd });
      await pressGameKey(page, "z");
    } else if (action === "reset") {
      await page.getByRole("button", { name: "重置房间", exact: true }).click();
      await waitForGameReady(page);
    } else {
      assert.notEqual(action, "activate");
      await pressGameKey(page, keys[action as keyof typeof keys]);
    }
  }
  const reset = await observe(page);
  assert.deepEqual(reset.position, initial.position);
  assert.deepEqual(reset.staticRoom?.layout, initial.staticRoom?.layout);
  assert.deepEqual(reset.completedObjectiveIds, initial.completedObjectiveIds);
  assert.deepEqual(reset.claimedRewardIds, initial.claimedRewardIds);
  await writeFile(
    join(output, `${roomId}-recovery.json`),
    JSON.stringify(
      { witnessId: witness.id, kind: witness.kind, actions, observations, reset },
      null,
      2,
    ),
  );
}

async function playRealtime(page: Page, roomId: string, output: string, attemptId: string) {
  const definition = realtimeContent.definitions.find((item) => item.id === roomId)!;
  const witness = realtimeContent.witnesses.find(
    (item) => item.challengeId === roomId && item.expectedResult === "success",
  )!;
  const inputs: unknown[] = [];
  await page.locator("#game-canvas[aria-busy='false']").waitFor({ state: "visible" });
  await page.locator("#game-canvas").focus();
  await page.waitForFunction(() => {
    const snapshot = (
      Reflect.get(window, "__CAMELLIA_INSPECT__") as { snapshot(): Observation }
    ).snapshot();
    return (
      (snapshot.countdownRemainingMs === 0 && snapshot.activeTimeMs > 0) ||
      snapshot.pauseReasons.length > 0
    );
  });
  const prepared = await observe(page);
  if (prepared.pauseReasons.length) {
    assert.deepEqual(prepared.pauseReasons, ["clockGap"]);
    assert.equal(prepared.activeTimeMs, 0);
    assert.ok(prepared.countdownRemainingMs > 0);
    await writeFile(
      join(output, `${attemptId}-preparation-gap.json`),
      JSON.stringify(prepared, null, 2),
    );
    await page.getByRole("button", { name: "继续探索", exact: true }).click();
    await page.waitForFunction(() => {
      const snapshot = (
        Reflect.get(window, "__CAMELLIA_INSPECT__") as { snapshot(): Observation }
      ).snapshot();
      return snapshot.countdownRemainingMs === 0 && snapshot.activeTimeMs > 0;
    });
  }
  for (const action of witness.commands) {
    const waitStartedAt = performance.now();
    await page.waitForFunction(
      (target) => {
        const snapshot = (
          Reflect.get(window, "__CAMELLIA_INSPECT__") as { snapshot(): Observation }
        ).snapshot();
        return (
          snapshot.activeTimeMs >= target ||
          snapshot.mode === "challengeResult" ||
          snapshot.pauseReasons.length > 0
        );
      },
      Math.max(0, action.activeTimeMs - 10),
    );
    const waitFinishedAt = performance.now();
    const before = await observe(page);
    const observedAt = performance.now();
    const timing = {
      waitDurationMs: waitFinishedAt - waitStartedAt,
      observationDurationMs: observedAt - waitFinishedAt,
      targetActiveTimeMs: action.activeTimeMs,
      observedActiveTimeMs: before.activeTimeMs,
    };
    if (
      before.pauseReasons.length ||
      (before.mode !== "challengeResult" && before.activeTimeMs - action.activeTimeMs >= 100)
    )
      await writeFile(
        join(output, `${attemptId}-input-timing-failure.json`),
        JSON.stringify(
          { roomId, action, timing, prepared, before, previousInputs: inputs },
          null,
          2,
        ),
      );
    assert.deepEqual(before.pauseReasons, [], `${roomId}: real scheduling interruption`);
    if (before.mode === "challengeResult") break;
    assert.ok(
      before.activeTimeMs - action.activeTimeMs < 100,
      `${roomId}: missed physical input window`,
    );
    if (action.kind === "move") await page.keyboard.press(keys[action.direction]);
    else if (action.kind === "interact") await page.keyboard.press("f");
    else {
      const tile = definition.tiles.find((item) => item.id === action.tileId)!;
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
    }
    inputs.push({ action, observedAtMs: before.activeTimeMs, timing });
  }
  await page.waitForFunction(
    () =>
      (Reflect.get(window, "__CAMELLIA_INSPECT__") as { snapshot(): Observation }).snapshot()
        .mode === "challengeResult",
    undefined,
    { timeout: 60_000 },
  );
  const result = await observe(page);
  await writeFile(
    join(output, `${attemptId}.json`),
    JSON.stringify({ roomId, inputs, result }, null, 2),
  );
  await page.screenshot({ path: join(output, `${attemptId}.png`) });
  assert.equal(result.phase, "success", `${roomId}: normal inputs must actually succeed`);
  await page.getByRole("button", { name: "返回地图", exact: true }).click();
  await waitForGameReady(page);
}

/** Read-only observation plus physical Playwright keys/clicks; never writes game state/storage. */
export async function verifyR1Journey(options: {
  browser: Browser;
  url: string;
  profile: ProfileId;
  route: "main" | "full";
  outputDir: string;
  sourceSavePath?: string;
}) {
  const { browser, url, profile, route, outputDir } = options;
  const output = join(
    outputDir,
    `${profile.toLowerCase()}-${route}${options.sourceSavePath ? "-upgrade" : ""}`,
  );
  await mkdir(output, { recursive: true });
  const content = assembleContent(profile);
  const witness = routes.witnesses.find(
    (item) =>
      item.profileId === profile &&
      item.id.includes(route === "full" ? "full-collection" : "main-path"),
  ) as WorldWitness;
  const context = await browser.newContext({
    viewport: { width: 1512, height: 900 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const errors: string[] = [],
    commands: unknown[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  let state = createGame(content, 0),
    index = 0,
    challengeNumber = 0,
    timeOffset = 0;
  const recoveredRooms = new Set<string>();
  const startedAt = new Date().toISOString();
  try {
    await page.goto(url);
    await page.bringToFront();
    await page.getByRole("button", { name: "新游戏", exact: true }).click();
    await page.locator("#game-canvas[aria-busy='false']").waitFor({ state: "visible" });
    await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => done())));
    const startup = await observe(page);
    if (startup.pauseReasons.length) {
      assert.deepEqual(
        startup.pauseReasons,
        ["clockGap"],
        "only a visible startup scheduling interruption can be resumed before the first input",
      );
      assert.equal(
        await page.evaluate(() => document.hasFocus() && document.visibilityState === "visible"),
        true,
      );
      await writeFile(
        join(output, `startup-pause-${Date.now()}.json`),
        JSON.stringify(startup, null, 2),
      );
      await page.getByRole("button", { name: "继续探索", exact: true }).click();
    }
    await waitForGameReady(page);
    if (options.sourceSavePath) {
      const original = JSON.parse(await readFile(options.sourceSavePath, "utf8"));
      const validation = validatePayload(
        original.payload,
        content,
        publishedProfileMigrations(migrationContentReleases(profile)),
      );
      assert.ok(validation.ok, validation.ok ? "" : validation.error);
      const migrated = validation.value;
      const restoredSource = restorePayload(migrated, content, 0);
      const checkpointMatches = (candidate: GameState) =>
        JSON.stringify(candidate.playerPosition) === JSON.stringify(migrated.playerPosition) &&
        JSON.stringify(candidate.completedObjectiveIds) ===
          JSON.stringify(migrated.completedObjectiveIds) &&
        JSON.stringify(candidate.claimedRewardIds) === JSON.stringify(migrated.claimedRewardIds) &&
        candidate.mode === restoredSource.mode;
      let checkpoint = createGame(content, 0),
        found = false;
      for (const [cursor, step] of witness.steps.entries()) {
        checkpoint = dispatch(content, checkpoint, step.command, step.atMs).state;
        if (checkpointMatches(checkpoint)) {
          index = cursor + 1;
          timeOffset = step.atMs;
          found = true;
          break;
        }
      }
      assert.ok(
        found,
        "Actual source save must meet a normal target route checkpoint; never move a save to make it match",
      );
      state = restoredSource;
      await page.getByRole("button", { name: "打开暂停菜单", exact: true }).click();
      await page.getByRole("button", { name: "进度与存档", exact: true }).click();
      const chooser = page.waitForEvent("filechooser");
      await page.getByRole("button", { name: "导入存档", exact: true }).click();
      await (await chooser).setFiles(options.sourceSavePath);
      await page.screenshot({ path: join(output, "upgrade-preview.png") });
      await page.getByRole("button", { name: "确认替换", exact: true }).click();
      await waitForGameReady(page);
      const imported = await observe(page);
      assert.deepEqual(imported.position, state.playerPosition);
      assert.deepEqual(imported.completedObjectiveIds, state.completedObjectiveIds);
      assert.deepEqual(imported.claimedRewardIds, state.claimedRewardIds);
      await writeFile(
        join(output, "upgrade-source.json"),
        JSON.stringify(
          {
            sourceSavePath: options.sourceSavePath,
            profile: original.payload.releaseProfileId,
            nextStepIndex: index,
            original,
            imported,
          },
          null,
          2,
        ),
      );
    }
    for (; index < witness.steps.length; index++) {
      const step = witness.steps[index]!;
      const previous = state;
      const expected = dispatch(content, state, step.command, step.atMs - timeOffset);
      assert.equal(expected.code, step.expectedCode, `${witness.id}:${index} fixed source`);
      state = expected.state;
      if (step.command.kind === "Tick") continue;
      if (
        previous.activeStatic &&
        content.staticChallenges.find((item) => item.id === previous.activeStatic!.roomId)?.kind ===
          "memory"
      )
        await page.waitForFunction(
          () => document.querySelector("#mode-banner")?.textContent === "",
        );
      const command: GameCommand = step.command;
      if (command.kind === "StartChallenge") {
        const definition = content.realtimeChallenges.find(
          (item) => item.id === command.challengeId,
        )!;
        const ids = content.entities.find(
          (item) =>
            item.tileId === previous.playerPosition.tileId && item.kind === "challengeAccess",
        );
        const choiceIndex =
          ids?.kind === "challengeAccess"
            ? ids.params.challengeIds.indexOf(command.challengeId)
            : 0;
        await page.locator(".challenge-choice").nth(choiceIndex).click();
        await playRealtime(
          page,
          definition.id,
          output,
          `challenge-${++challengeNumber}-${definition.id}`,
        );
        // The browser's own clock supplied all ticks. Offline replay only locates the next world command.
        while (++index < witness.steps.length) {
          const sceneStep = witness.steps[index]!;
          const result = dispatch(content, state, sceneStep.command, sceneStep.atMs - timeOffset);
          assert.equal(result.code, sceneStep.expectedCode);
          state = result.state;
          if (sceneStep.command.kind === "ExitRoom") break;
        }
      } else if (command.kind === "Move") await pressGameKey(page, keys[command.direction]);
      else if (command.kind === "Amplify" || command.kind === "Interact" || command.kind === "Undo")
        await pressGameKey(page, { Amplify: "r", Interact: "f", Undo: "z" }[command.kind]);
      else if (command.kind === "ExitRoom") {
        const dialog = page.locator("#game-dialog");
        if (!(await dialog.evaluate((element) => (element as HTMLDialogElement).open)))
          await page.getByRole("button", { name: "打开暂停菜单", exact: true }).click();
        await dialog
          .getByRole("button", { name: /^(放弃本次尝试，返回入口|返回外层入口|返回地图)$/ })
          .click();
        await waitForGameReady(page);
      } else if (command.kind === "Teleport") {
        await pressGameKey(page, "m");
        const destination = content.areas.find((area) => area.teleportId === command.teleportId)!;
        await page
          .getByRole("button", { name: `${destination.label} · 已激活`, exact: true })
          .click();
        await waitForGameReady(page);
      } else throw new Error(`Unsupported normal route command ${command.kind}`);
      await page.waitForFunction(
        (tile) =>
          (Reflect.get(window, "__CAMELLIA_INSPECT__") as { snapshot(): Observation }).snapshot()
            .position.tileId === tile,
        state.playerPosition.tileId,
      );
      const actual = await observe(page);
      assert.deepEqual(
        actual.completedObjectiveIds,
        state.completedObjectiveIds,
        `objectives at ${index}`,
      );
      assert.deepEqual(actual.claimedRewardIds, state.claimedRewardIds, `rewards at ${index}`);
      commands.push({ index, command, position: actual.position, mode: actual.mode });
      if (
        route === "full" &&
        state.activeStatic?.roomId.startsWith("c.") &&
        !recoveredRooms.has(state.activeStatic.roomId)
      ) {
        recoveredRooms.add(state.activeStatic.roomId);
        await verifyStaticRecovery(page, state.activeStatic.roomId, output);
      }
      if (
        !previous.completedObjectiveIds.includes(content.profile.scopeTerminalObjectiveId) &&
        state.completedObjectiveIds.includes(content.profile.scopeTerminalObjectiveId)
      ) {
        await page.screenshot({ path: join(output, "scope-completed.png") });
        await page.getByRole("button", { name: "继续自由探索", exact: true }).click();
        await waitForGameReady(page);
      }
      if (previous.playerPosition.boardId !== state.playerPosition.boardId) {
        console.log(`${profile}/${route} ${index}: ${state.playerPosition.boardId}`);
        await page.screenshot({
          path: join(output, `board-${index}-${state.playerPosition.boardId}.png`),
        });
      }
    }
    const final = await observe(page);
    const save = await exportThroughUi(page);
    await writeFile(join(output, "earned-save.json"), JSON.stringify(save, null, 2));
    await page.reload();
    const continueStarted = performance.now();
    await page.getByRole("button", { name: "继续游戏", exact: true }).click();
    await waitForGameReady(page);
    const cachedContinueMs = performance.now() - continueStarted;
    assert.ok(
      cachedContinueMs <= 3000,
      "cached continue to operable canvas must stay within 3 seconds",
    );
    const restored = await exportThroughUi(page);
    assert.deepEqual(restored.payload, save.payload, "actual earned save survives reload");
    assert.deepEqual(errors, []);
    const result = {
      success: true,
      profile,
      route,
      cachedContinueMs,
      browser: browser.version(),
      startedAt,
      finishedAt: new Date().toISOString(),
      commands,
      final,
      errors,
    };
    await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    const failureId = `failure-${Date.now()}`;
    await page.screenshot({ path: join(output, `${failureId}.png`) }).catch(() => {});
    await writeFile(
      join(output, `${failureId}.json`),
      JSON.stringify(
        {
          startedAt,
          index,
          expected: state.playerPosition,
          actual: await observe(page).catch(() => null),
          commands,
          errors,
          error: String(error),
        },
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
  const route = process.argv.includes("--full") ? "full" : "main";
  const outputDir = resolve("test-results/r1-browser");
  const directory = resolve("test-results/r1-browser-build");
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
    await verifyR1Journey({
      browser,
      url: `http://127.0.0.1:${address.port}`,
      profile: "M5",
      route,
      outputDir,
    });
  } finally {
    await browser.close();
    await new Promise<void>((done) => server.httpServer.close(() => done()));
  }
}
