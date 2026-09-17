import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import os from "node:os";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import { build, preview } from "vite";
import { assembleContent } from "../../src/content/assemble.ts";
import { createGame, dispatch } from "../../src/core/engine.ts";
import { projectBoard } from "../../src/core/projection.ts";
import { advanceRealtime } from "../../src/core/realtime.ts";
import type { GameState, GameCommand, GameSettings, AreaId } from "../../src/core/types.ts";
import { restorePayload, stablePayload } from "../../src/platform/save-payload.ts";
import type { SavePayload } from "../../src/platform/save-payload.ts";
import type { SaveEnvelope } from "../../src/platform/save-store.ts";
import { projectGridPoint } from "../../src/render/layout.ts";
import type { BoardLayout, Point2 } from "../../src/render/layout.ts";
import { pressGameKey, waitForGameReady, exportThroughUi } from "./support.ts";

const content = assembleContent("M5");
const keys = { up: "ArrowUp", right: "ArrowRight", down: "ArrowDown", left: "ArrowLeft" };
type Direction = keyof typeof keys;
const directions = Object.keys(keys) as Direction[];
const opposite = { up: "down", down: "up", left: "right", right: "left" } as const;
export const R1_EARNED_SAVE = resolve("tests/fixtures/r1/m5-main-earned-save.json");
export interface R1Observation {
  position: GameState["playerPosition"];
  mode: GameState["mode"];
  phase: string;
  contentVersion: number;
  ruleVersion: number;
  activeTimeMs: number;
  countdownRemainingMs: number;
  pauseReasons: string[];
  settings: GameSettings;
  completedObjectiveIds: string[];
  claimedRewardIds: string[];
  completedRoomLayouts: GameState["completedRoomLayouts"];
  bestResults: GameState["bestResults"];
  staticRoom: { roomId: string; layout: unknown; undoDepth: number; practice: boolean } | null;
  completedRoom: GameState["activeCompletedRoom"];
  realtimeRoom: GameState["activeRealtime"];
  lastResult: GameState["lastResult"];
  transition: { active: boolean };
  render: {
    tileCount: number;
    geometries: number;
    textures: number;
    residentIconCount: number;
    pendingIconCount: number;
    calls: number;
    antivirusWaveforms: number;
    firewallScoreboards: number;
    lastPlayerMovement: {
      boardId: string;
      startedAtMs: number;
      completedAtMs: number | null;
      durationMs: number | null;
      from: { tileId: string; x: number; y: number };
      to: { tileId: string; x: number; y: number };
      reducedMotion: boolean;
    } | null;
    layout: BoardLayout & { displayedFocus: Point2; devicePixelRatio: number };
    theftPanel: {
      surface: string;
      tileTargets: { tileId: string; x: number; y: number; width: number; height: number }[];
    } | null;
  };
}
export async function observeR1(page: Page): Promise<R1Observation> {
  return page.evaluate(() =>
    (Reflect.get(window, "__CAMELLIA_INSPECT__") as { snapshot(): R1Observation }).snapshot(),
  );
}
const sourceHash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Offline public-rule planning guides physical UI commands. No browser state/storage writes. */
export class R1NormalDriver {
  model: GameState;
  readonly page: Page;
  readonly source: SavePayload;
  readonly commands: unknown[] = [];
  private now = 1000;
  private preparationRecovered = false;
  constructor(page: Page, source: SavePayload) {
    this.page = page;
    this.source = source;
    this.model = restorePayload(source, content, this.now);
  }
  async ready(allowInitialRecovery = false) {
    await this.page.locator("#game-canvas[aria-busy='false']").waitFor({ state: "visible" });
    await this.page.evaluate(
      () => new Promise<void>((done) => requestAnimationFrame(() => done())),
    );
    const state = await observeR1(this.page);
    if (allowInitialRecovery && state.pauseReasons.length) {
      assert.equal(this.preparationRecovered, false);
      assert.deepEqual(state.pauseReasons, ["clockGap"]);
      this.preparationRecovered = true;
      this.commands.push({ kind: "initial-import-preparation-recovery", observed: state });
      await this.page.getByRole("button", { name: "继续探索", exact: true }).click();
    }
    await waitForGameReady(this.page);
    assert.deepEqual((await observeR1(this.page)).pauseReasons, []);
  }
  static async importEarned(page: Page, url: string, path = R1_EARNED_SAVE) {
    const bytes = await readFile(path);
    const envelope = JSON.parse(bytes.toString("utf8")) as SaveEnvelope<SavePayload>;
    assert.equal(envelope.payload.schemaVersion, 3);
    assert.equal(envelope.payload.ruleVersion, 4);
    assert.equal(envelope.payload.room, null);
    const driver = new R1NormalDriver(page, envelope.payload);
    await page.goto(url);
    await page.bringToFront();
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "导入存档", exact: true }).click();
    await (await chooser).setFiles(path);
    await page.getByRole("button", { name: "确认替换", exact: true }).click();
    await driver.ready(true);
    assert.deepEqual((await observeR1(page)).position, envelope.payload.playerPosition);
    driver.commands.push({ kind: "normal-ui-import", sourcePath: path, sha256: sourceHash(bytes) });
    return driver;
  }
  predict(command: GameCommand) {
    return dispatch(content, this.model, command, this.model.clock.lastMonotonicTimeMs + 250);
  }
  static async newGame(page: Page, url: string) {
    const driver = new R1NormalDriver(page, stablePayload(createGame(content, 1000)));
    await page.goto(url);
    await page.bringToFront();
    await page.getByRole("button", { name: "新游戏", exact: true }).click();
    await driver.ready(true);
    assert.deepEqual((await observeR1(page)).position, driver.model.playerPosition);
    driver.commands.push({ kind: "normal-new-game" });
    return driver;
  }
  async finishObservation() {
    await this.page.waitForFunction(
      () => !document.querySelector("#mode-banner")?.textContent?.includes("记住安全路线"),
    );
    while (this.model.activeStatic?.state.phase === "preview") {
      this.now = this.model.clock.lastMonotonicTimeMs + 100;
      this.model = dispatch(content, this.model, { kind: "Tick" }, this.now).state;
    }
  }
  async send(command: GameCommand, expectedTile?: string) {
    if (command.kind !== "ExitRoom") await this.ready();
    if (this.model.activeStatic && command.kind === "Move") {
      await this.finishObservation();
    }
    this.now = this.model.clock.lastMonotonicTimeMs + 250;
    const result = dispatch(content, this.model, command, this.now);
    assert.equal(result.code, "accepted", `offline normal command ${command.kind}`);
    if (command.kind === "Move") await pressGameKey(this.page, keys[command.direction]);
    else if (command.kind === "Interact" || command.kind === "Amplify" || command.kind === "Undo")
      await pressGameKey(this.page, { Interact: "f", Amplify: "r", Undo: "z" }[command.kind]);
    else if (command.kind === "ExitRoom") {
      const dialogOpen = await this.page
        .locator("#game-dialog")
        .evaluate((element) => (element as HTMLDialogElement).open);
      if (dialogOpen) {
        await this.page
          .locator("#game-dialog")
          .getByRole("button", { name: /^(返回外层入口|返回地图)$/ })
          .click();
      } else {
        await this.page.getByRole("button", { name: "打开暂停菜单", exact: true }).click();
        await this.page
          .getByRole("button", { name: /^(放弃本次尝试，返回入口|返回外层入口)$/ })
          .click();
      }
    } else if (command.kind === "Teleport") {
      await pressGameKey(this.page, "m");
      const area = content.areas.find((item) => item.teleportId === command.teleportId)!;
      await this.page.getByRole("button", { name: `${area.label} · 已激活`, exact: true }).click();
    } else throw new Error(`Unsupported normal UI command ${command.kind}`);
    this.model = result.state;
    await this.page.waitForFunction(
      (tileId) =>
        (Reflect.get(window, "__CAMELLIA_INSPECT__") as { snapshot(): R1Observation }).snapshot()
          .position.tileId === tileId,
      expectedTile ?? this.model.playerPosition.tileId,
    );
    const observed = await observeR1(this.page);
    this.commands.push({ command, position: observed.position, result: observed.lastResult });
    return observed;
  }
  async teleport(areaId: AreaId) {
    if (this.model.activeStatic || this.model.activeRealtime || this.model.activeCompletedRoom)
      await this.send({ kind: "ExitRoom" });
    if (this.model.mode === "challengeReady") await this.send({ kind: "ExitRoom" });
    const area = content.areas.find((item) => item.id === areaId)!;
    await this.send({ kind: "Teleport", teleportId: area.teleportId });
  }
  async walkTo(tileId: string, desiredBoard?: string) {
    const area = this.model.playerPosition.areaId;
    const goal = (state: GameState) =>
      state.playerPosition.tileId === tileId ||
      (!!desiredBoard && state.playerPosition.boardId === desiredBoard);
    const queue = [
      {
        state: this.model,
        path: [] as GameCommand[],
        now: this.model.clock.lastMonotonicTimeMs,
      },
    ];
    const visited = new Set<string>();
    let route: GameCommand[] | undefined;
    for (let i = 0; i < queue.length && i < 3000; i++) {
      const node = queue[i]!;
      if (goal(node.state)) {
        route = node.path;
        break;
      }
      const key = `${node.state.playerPosition.boardId}:${node.state.playerPosition.tileId}:${node.state.clearedEtherNodeIds.join(",")}`;
      if (visited.has(key)) continue;
      visited.add(key);
      for (const command of [
        ...directions.map((direction): GameCommand => ({ kind: "Move", direction })),
        { kind: "Amplify" } as GameCommand,
      ]) {
        const next = dispatch(content, node.state, command, node.now + 250);
        if (next.code !== "accepted" || next.state.playerPosition.areaId !== area) continue;
        if (next.state.playerPosition.space === "room" && !goal(next.state)) continue;
        queue.push({ state: next.state, path: [...node.path, command], now: node.now + 250 });
      }
    }
    assert.ok(route, `normal public-rule route to ${tileId}`);
    for (const command of route) await this.send(command);
  }
  async enterRoom(roomId: string) {
    const room = content.rooms.find((item) => item.id === roomId)!;
    await this.teleport(room.areaId);
    const entrance = content.entities.find(
      (item) => item.kind === "roomEntrance" && item.params.roomId === roomId,
    )!;
    await this.walkTo(entrance.tileId, room.boardId);
    if (this.model.playerPosition.space === "world") await this.send({ kind: "Interact" });
    if (this.model.activeCompletedRoom) await this.send({ kind: "Interact" });
    assert.equal((await observeR1(this.page)).staticRoom?.roomId, roomId);
  }
  async settings(patch: Partial<GameSettings>) {
    const before = await observeR1(this.page);
    await this.page.getByRole("button", { name: "打开暂停菜单", exact: true }).click();
    await this.page.getByRole("button", { name: "声音与显示", exact: true }).click();
    for (const [key, label] of [
      ["muted", "静音"],
      ["reducedFlash", "减少闪烁"],
      ["reducedMotion", "减少动态效果"],
    ] as const)
      if (patch[key] !== undefined)
        await this.page.getByRole("checkbox", { name: label, exact: true }).setChecked(patch[key]!);
    if (patch.quality)
      await this.page
        .getByRole("combobox", { name: "画质", exact: true })
        .selectOption(patch.quality);
    if (patch.zoom !== undefined) {
      const slider = this.page.getByRole("slider", { name: "棋盘缩放", exact: true });
      if (await slider.count()) {
        await slider.focus();
        await this.page.keyboard.press(
          patch.zoom === 0.75 ? "Home" : patch.zoom === 1.5 ? "End" : "Home",
        );
        if (patch.zoom === 1)
          for (let i = 0; i < 5; i++) await this.page.keyboard.press("ArrowRight");
      }
    }
    await this.page.getByRole("button", { name: "继续探索", exact: true }).click();
    await this.ready();
    const after = await observeR1(this.page);
    assert.deepEqual(after.position, before.position);
    this.model = dispatch(
      content,
      this.model,
      { kind: "Settings", settings: after.settings },
      this.model.clock.lastMonotonicTimeMs,
    ).state;
    return after;
  }
}

const SCENES = [
  {
    id: "hub",
    area: "hub",
    source: "S03 第2图 zbYtPAbsfCnFwns / art-implementation原参考表",
    room: null,
  },
  {
    id: "memory",
    area: "a",
    source: "S05-36 / 10416118 / r1-map-mechanism-evidence §5",
    room: "a.maze.01",
  },
  {
    id: "firewall",
    area: "a",
    source: "S05-12 / 10416126 / art-implementation原参考表",
    room: "a.firewall.tutorial",
  },
  { id: "antivirus", area: "b", source: "S05-39 / r1-antivirus-rules", room: "b.antivirus.light" },
  {
    id: "capture",
    area: "c",
    source: "S09 捕获原图 / r1-map-mechanism-evidence",
    room: "c.capture.01",
  },
  {
    id: "theft",
    area: "c",
    source: "S05 theft03 / r1-source/theft-03-start.png",
    room: "c.theft.03",
  },
  { id: "ghosts", area: "d", source: "S05-50 / r1-map-mechanism-evidence", room: "d.ghost.01" },
] as const;

async function enterScene(driver: R1NormalDriver, scene: (typeof SCENES)[number]) {
  if (!scene.room) {
    assert.equal(driver.model.playerPosition.boardId, "hub");
    return;
  }
  const realtime = content.realtimeChallenges.find((item) => item.id === scene.room);
  if (!realtime) {
    await driver.enterRoom(scene.room);
    return;
  }
  await driver.teleport(scene.area);
  const access = content.entities.find((item) =>
    item.kind === "challengeAccess"
      ? item.params.challengeIds.includes(scene.room)
      : item.kind === "roomEntrance" && item.params.roomId === scene.room,
  )!;
  await driver.walkTo(access.tileId);
  await driver.send({ kind: "Interact" });
  const index =
    access.kind === "challengeAccess" ? access.params.challengeIds.indexOf(scene.room) : 0;
  await driver.page.locator(".challenge-choice").nth(index).click();
  const start = dispatch(
    content,
    driver.model,
    { kind: "StartChallenge", challengeId: scene.room },
    driver.model.clock.lastMonotonicTimeMs + 250,
  );
  assert.equal(start.code, "accepted");
  driver.model = start.state;
  await driver.page.locator("#game-canvas[aria-busy='false']").waitFor({ state: "visible" });
  await driver.page.waitForFunction(
    (minimumTime) => {
      const s = (
        Reflect.get(window, "__CAMELLIA_INSPECT__") as { snapshot(): R1Observation }
      ).snapshot();
      return (
        s.realtimeRoom !== null && s.countdownRemainingMs === 0 && s.activeTimeMs >= minimumTime
      );
    },
    scene.id === "antivirus" ? 4500 : 100,
  );
}

function protectedState(state: R1Observation) {
  return {
    position: state.position,
    staticRoom: state.staticRoom,
    completedRoom: state.completedRoom,
    realtimeRoom: state.realtimeRoom,
    completedObjectiveIds: state.completedObjectiveIds,
    claimedRewardIds: state.claimedRewardIds,
    completedRoomLayouts: state.completedRoomLayouts,
    bestResults: state.bestResults,
  };
}
async function clickPoint(
  page: Page,
  tile: { id: string; x: number; y: number },
  state: R1Observation,
) {
  const dom = state.render.theftPanel?.tileTargets.find((item) => item.tileId === tile.id);
  const canvas = await page.locator("#game-canvas").boundingBox();
  assert.ok(canvas);
  const point = projectGridPoint(tile),
    layout = state.render.layout;
  return dom
    ? { x: dom.x, y: dom.y }
    : {
        x:
          canvas.x +
          layout.available.left +
          layout.available.width / 2 +
          (point.x - layout.displayedFocus.x) * layout.pixelsPerWorldUnit,
        y:
          canvas.y +
          layout.available.top +
          layout.available.height / 2 +
          (point.y - layout.displayedFocus.y) * layout.pixelsPerWorldUnit,
      };
}

export async function verifyR1VisualMatrix(options: {
  browser: Browser;
  url: string;
  outputDir: string;
  sourcePath?: string;
  resumeAtScene?: string | undefined;
}) {
  const output = join(options.outputDir, "visual-matrix");
  await mkdir(output, { recursive: true });
  const records: unknown[] = [];
  const resumeIndex = options.resumeAtScene
    ? SCENES.findIndex((scene) => scene.id === options.resumeAtScene)
    : 0;
  assert.ok(resumeIndex >= 0);
  for (const scene of SCENES)
    for (const [width, height] of [
      [1366, 768],
      [1920, 1080],
    ] as const)
      for (const dpr of [1, 2])
        for (const zoom of [0.75, 1.5]) {
          const id = `${scene.id}-${width}x${height}-dpr${dpr}-zoom${zoom}`;
          if (SCENES.indexOf(scene) < resumeIndex) {
            const previous = JSON.parse(await readFile(join(output, `${id}.json`), "utf8"));
            assert.equal(previous.id, id);
            assert.equal(previous.before.ruleVersion, 4);
            records.push(previous);
            continue;
          }
          const context = await options.browser.newContext({
            viewport: { width, height },
            deviceScaleFactor: dpr,
          });
          const page = await context.newPage();
          page.setDefaultTimeout(15000);
          try {
            const driver =
              scene.id === "hub"
                ? await R1NormalDriver.newGame(page, options.url)
                : await R1NormalDriver.importEarned(page, options.url, options.sourcePath);
            await driver.settings({
              zoom,
              reducedFlash: false,
              reducedMotion: false,
              quality: "standard",
            });
            await enterScene(driver, scene);
            if (scene.id === "memory")
              await page.waitForFunction(
                () =>
                  !document.querySelector("#mode-banner")?.textContent?.includes("记住安全路线"),
              );
            let before = await observeR1(page);
            const actualViewport = await page.evaluate(() => ({
              width: innerWidth,
              height: innerHeight,
              devicePixelRatio,
              visualViewportScale: visualViewport?.scale ?? null,
            }));
            assert.deepEqual(
              [actualViewport.width, actualViewport.height, actualViewport.devicePixelRatio],
              [width, height, dpr],
            );
            assert.deepEqual(before.pauseReasons, []);
            assert.equal(before.render.layout.devicePixelRatio, dpr);
            const minimum = before.render.theftPanel
              ? Math.min(
                  ...before.render.theftPanel.tileTargets.map((tile) =>
                    Math.min(tile.width, tile.height),
                  ),
                )
              : before.render.layout.targetCss.minimum;
            assert.ok(minimum >= 44 - 1e-7);
            if (scene.id === "antivirus") {
              assert.equal(before.render.antivirusWaveforms, 4);
              assert.equal(before.render.tileCount, 20);
            }
            if (scene.id === "theft")
              assert.equal(before.render.theftPanel?.surface, "flat-terminal");
            const snapshot = `${id}.jpg`;
            await page.screenshot({
              path: join(output, snapshot),
              type: "jpeg",
              quality: 80,
              scale: "css",
            });
            before = await observeR1(page);
            const definition = content.realtimeChallenges.find((item) => item.id === scene.room);
            let target: { id: string; x: number; y: number } | undefined;
            if (definition && before.realtimeRoom) {
              const origin = definition.tiles.find((tile) => tile.id === before.position.tileId)!;
              target = definition.tiles.find((tile) => {
                if (Math.abs(tile.x - origin.x) + Math.abs(tile.y - origin.y) !== 1) return false;
                const input = {
                  kind: "click" as const,
                  tileId: tile.id,
                  activeTimeMs: before.activeTimeMs + 50,
                  sequence: before.realtimeRoom!.state.lastInputSequence + 1,
                };
                const result = advanceRealtime(
                  definition,
                  before.realtimeRoom!.state,
                  input.activeTimeMs,
                  [input],
                );
                return result.state.status === "running" && result.state.playerTileId === tile.id;
              });
            } else {
              if (driver.model.activeStatic?.state.phase === "preview")
                await driver.finishObservation();
              for (const direction of directions) {
                const result = driver.predict({ kind: "Move", direction });
                if (
                  result.code === "accepted" &&
                  result.state.playerPosition.boardId === before.position.boardId &&
                  result.state.playerPosition.tileId !== before.position.tileId
                ) {
                  target = projectBoard(content, result.state).tiles.find(
                    (tile) => tile.id === result.state.playerPosition.tileId,
                  );
                  break;
                }
              }
            }
            assert.ok(target, `${id}: visible legal neighboring target`);
            const point = await clickPoint(page, target, before);
            const hitSurface = await page.evaluate(({ x, y }) => {
              const hit = document.elementFromPoint(x, y);
              return hit?.id === "game-canvas" || !!hit?.closest(".theft-cell");
            }, point);
            assert.equal(hitSurface, true, `${id}: HUD must not occlude target center`);
            await page.mouse.click(point.x, point.y);
            await page.waitForFunction(
              (tileId) =>
                (
                  Reflect.get(window, "__CAMELLIA_INSPECT__") as { snapshot(): R1Observation }
                ).snapshot().position.tileId === tileId,
              target.id,
            );
            const picked = await observeR1(page);
            await page.locator("#game-canvas").focus();
            await page.keyboard.press("Escape");
            const paused = await observeR1(page);
            await page.setViewportSize(
              width === 1366 ? { width: 1920, height: 1080 } : { width: 1366, height: 768 },
            );
            await page.waitForTimeout(160);
            const resized = await observeR1(page);
            assert.deepEqual(protectedState(resized), protectedState(paused));
            assert.equal(resized.activeTimeMs, paused.activeTimeMs);
            records.push({
              id,
              scene,
              viewport: { width, height },
              browserDpr: dpr,
              requestedGameZoom: zoom,
              actualGameZoom: scene.id === "theft" ? null : before.render.layout.effectiveZoom,
              renderedScaleMode:
                scene.id === "theft"
                  ? "fixed-flat-terminal"
                  : scene.id === "antivirus" || scene.id === "firewall"
                    ? "fixed-tv-stage"
                    : "camera-zoom",
              actualViewport,
              method:
                "Playwright viewport/deviceScaleFactor; game slider via Home/End; not browser page zoom",
              minimumTargetCss: minimum,
              snapshot,
              before,
              point,
              picked,
              paused,
              resized,
              commands: driver.commands,
            });
            await writeFile(join(output, `${id}.json`), JSON.stringify(records.at(-1), null, 2));
          } catch (error) {
            await page.screenshot({ path: join(output, `${id}-failure.png`) }).catch(() => {});
            await writeFile(
              join(output, `${id}-failure.json`),
              JSON.stringify(
                { error: String(error), actual: await observeR1(page).catch(() => null) },
                null,
                2,
              ),
            );
            throw error;
          } finally {
            await context.close();
          }
        }
  await writeFile(
    join(output, "result.json"),
    JSON.stringify({ browser: options.browser.version(), records }, null, 2),
  );
  return records;
}

function distribution(values: number[]) {
  assert.ok(values.length > 0);
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: values.length,
    median:
      sorted.length % 2
        ? sorted[Math.floor(sorted.length / 2)]!
        : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2,
    p95: sorted[Math.floor(sorted.length * 0.95)]!,
    max: sorted.at(-1)!,
    sum: values.reduce((a, b) => a + b, 0),
  };
}
async function frameWindow(page: Page) {
  return page.evaluateHandle(() => {
    const intervals: number[] = [];
    let start = 0,
      previous = 0,
      end = 0;
    const result = new Promise<{
      intervals: number[];
      start: number;
      end: number;
      error: string | null;
    }>((resolve) => {
      const frame = (time: number) => {
        const eligible =
          document.visibilityState === "visible" &&
          document.hasFocus() &&
          !document.querySelector<HTMLDialogElement>("#game-dialog")?.open &&
          document.querySelector("#game-canvas")?.getAttribute("aria-busy") === "false" &&
          document.querySelector(".game-shell")?.getAttribute("data-challenge") === "theft";
        if (!eligible) {
          resolve({ intervals, start, end, error: "continuous active scene interrupted" });
          return;
        }
        if (!start) start = time;
        if (previous) intervals.push(time - previous);
        previous = end = time;
        if (end - start >= 60000) resolve({ intervals, start, end, error: null });
        else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    return { result };
  });
}
async function measureNormalMove(driver: R1NormalDriver, direction: Direction) {
  const expected = driver.predict({ kind: "Move", direction });
  assert.equal(expected.code, "accepted");
  const tileId = expected.state.playerPosition.tileId;
  const watcher = await driver.page.evaluateHandle(
    ({ key, tileId }) => {
      let keydownAt: number | null = null,
        resolveResult: (result: { matched: boolean; latency: number; endpointMs: number }) => void;
      const result = new Promise<{ matched: boolean; latency: number; endpointMs: number }>(
        (done) => {
          resolveResult = done;
        },
      );
      const finish = (matched: boolean) => {
        document.removeEventListener("keydown", onKey, true);
        clearTimeout(timeout);
        resolveResult({
          matched,
          latency: keydownAt === null ? Infinity : performance.now() - keydownAt,
          endpointMs: keydownAt === null ? Infinity : performance.now() - keydownAt,
        });
      };
      const check = () => {
        const player = document.querySelector<HTMLElement>(
          `.theft-cell[data-tile-id="${tileId}"][data-player="true"] .theft-player`,
        );
        if (player && player.getBoundingClientRect().width > 0)
          requestAnimationFrame(() => finish(true));
        else requestAnimationFrame(check);
      };
      const onKey = (event: KeyboardEvent) => {
        if (event.key !== key || event.repeat || keydownAt !== null) return;
        keydownAt = performance.now();
        requestAnimationFrame(check);
      };
      document.addEventListener("keydown", onKey, true);
      const timeout = setTimeout(() => finish(false), 2000);
      return { result };
    },
    { key: keys[direction], tileId },
  );
  await driver.send({ kind: "Move", direction });
  const result = await watcher.evaluate((value) => value.result);
  await watcher.dispose();
  assert.equal(result.matched, true);
  return { direction, tileId, ...result };
}

export async function verifyR1TheftReadability(options: {
  browser: Browser;
  url: string;
  outputDir: string;
  sourcePath?: string;
}) {
  const output = join(options.outputDir, "visual-matrix");
  await mkdir(output, { recursive: true });
  const context = await options.browser.newContext({
    viewport: { width: 1366, height: 768 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  try {
    const driver = await R1NormalDriver.importEarned(page, options.url, options.sourcePath);
    await driver.enterRoom("c.theft.03");
    const records = [];
    for (const reduced of [false, true]) {
      await driver.settings({ reducedMotion: reduced, reducedFlash: reduced, muted: reduced });
      const before = await observeR1(page);
      await driver.send({ kind: "Move", direction: "up" });
      await driver.send({ kind: "Move", direction: "down" });
      const after = await observeR1(page);
      assert.deepEqual(after.position, before.position);
      assert.deepEqual(after.staticRoom?.layout, before.staticRoom?.layout);
      const visible = await page.evaluate(() => ({
        focusId: document.activeElement?.id,
        keyboardFocus: document.querySelector("#game-canvas")?.matches(":focus-visible"),
        cells: [...document.querySelectorAll<HTMLElement>(".theft-cell")].map((cell) => ({
          tileId: cell.dataset.tileId,
          kind: cell.dataset.kind,
          label: cell.getAttribute("aria-label"),
          mark: cell.querySelector(".theft-component-mark")?.textContent ?? null,
          glyph: cell.querySelector(".theft-glyph")?.innerHTML,
          transitionDuration: getComputedStyle(cell).transitionDuration,
          backgroundImage: getComputedStyle(cell).backgroundImage,
        })),
      }));
      assert.equal(visible.focusId, "game-canvas");
      assert.equal(visible.keyboardFocus, true);
      assert.ok(
        visible.cells.some(
          (cell) => cell.kind === "theft-buffer" && cell.backgroundImage !== "none",
        ),
      );
      const componentMarks = [
        ...new Set(
          visible.cells.filter((cell) => cell.kind === "theft-ball").map((cell) => cell.mark),
        ),
      ];
      assert.deepEqual(componentMarks.toSorted(), ["A", "C"]);
      for (const mark of componentMarks) {
        assert.ok(mark);
        const ball = visible.cells.find((cell) => cell.kind === "theft-ball" && cell.mark === mark);
        const base = visible.cells.find((cell) => cell.kind === "theft-base" && cell.mark === mark);
        assert.ok(ball && base);
        assert.notEqual(ball.glyph, base.glyph);
        assert.ok(ball.label?.includes(mark) && base.label?.includes(mark));
      }
      if (reduced) assert.ok(visible.cells.every((cell) => cell.transitionDuration === "0s"));
      const screenshot = `theft-keyboard-${reduced ? "reduced" : "standard"}.jpg`;
      await page.screenshot({
        path: join(output, screenshot),
        type: "jpeg",
        quality: 80,
        scale: "css",
      });
      assert.deepEqual((await observeR1(page)).pauseReasons, []);
      records.push({ reduced, before, after, visible, screenshot });
    }
    await writeFile(
      join(output, "theft-readability.json"),
      JSON.stringify({ records, commands: driver.commands }, null, 2),
    );
    return records;
  } finally {
    await context.close();
  }
}

export async function verifyR1WorldMovement(options: {
  browser: Browser;
  url: string;
  outputDir: string;
  sourcePath?: string;
}) {
  const output = join(options.outputDir, "performance");
  await mkdir(output, { recursive: true });
  const context = await options.browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  try {
    const driver = await R1NormalDriver.importEarned(page, options.url, options.sourcePath);
    await driver.teleport("warehouse");
    await driver.settings({
      quality: "standard",
      zoom: 1,
      reducedMotion: false,
      reducedFlash: false,
      muted: false,
    });
    const original = driver.model.playerPosition.tileId;
    const direction = directions.find((candidate) => {
      const first = driver.predict({ kind: "Move", direction: candidate });
      if (
        first.code !== "accepted" ||
        first.state.playerPosition.tileId === original ||
        first.state.playerPosition.space !== "world"
      )
        return false;
      const second = dispatch(
        content,
        first.state,
        { kind: "Move", direction: opposite[candidate] },
        first.state.clock.lastMonotonicTimeMs + 250,
      );
      return second.code === "accepted" && second.state.playerPosition.tileId === original;
    });
    assert.ok(direction);
    const before = await observeR1(page),
      moves = [];
    for (let i = 0; i < 10; i++) {
      const command = { kind: "Move", direction: i % 2 ? opposite[direction] : direction } as const;
      const expected = driver.predict(command).state.playerPosition.tileId;
      const watcher = await page.evaluateHandle(
        ({ key, expected }) => {
          let keydownAt: number | null = null;
          let focusAt: number | null = null;
          let frameId = 0;
          let settled = false;
          let resolveResult: (value: {
            keydownAt: number | null;
            focusAt: number | null;
            observed: R1Observation | null;
          }) => void;
          const result = new Promise<{
            keydownAt: number | null;
            focusAt: number | null;
            observed: R1Observation | null;
          }>((done) => {
            resolveResult = done;
          });
          const finish = (observed: R1Observation | null) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            cancelAnimationFrame(frameId);
            document.removeEventListener("keydown", onKey, true);
            resolveResult({ keydownAt, focusAt, observed });
          };
          const check = () => {
            const state = (
              Reflect.get(window, "__CAMELLIA_INSPECT__") as { snapshot(): R1Observation }
            ).snapshot();
            const movement = state.render.lastPlayerMovement,
              layout = state.render.layout;
            if (
              focusAt === null &&
              movement?.to.tileId === expected &&
              layout.focus.x === layout.displayedFocus.x &&
              layout.focus.y === layout.displayedFocus.y
            )
              focusAt = performance.now();
            if (
              movement?.to.tileId === expected &&
              movement.completedAtMs !== null &&
              focusAt !== null
            )
              finish(state);
            else frameId = requestAnimationFrame(check);
          };
          const onKey = (event: KeyboardEvent) => {
            if (event.key !== key || event.repeat || keydownAt !== null) return;
            keydownAt = performance.now();
            frameId = requestAnimationFrame(check);
          };
          document.addEventListener("keydown", onKey, true);
          const timeout = setTimeout(() => finish(null), 2000);
          return { result };
        },
        { key: keys[command.direction], expected },
      );
      await driver.send(command);
      const measured = await watcher.evaluate((value) => value.result);
      await watcher.dispose();
      assert.ok(measured.observed && measured.keydownAt !== null && measured.focusAt !== null);
      const movement = measured.observed.render.lastPlayerMovement!;
      assert.ok(movement.completedAtMs !== null && movement.durationMs !== null);
      const physicalKeyToRenderedEndpointMs = movement.completedAtMs - measured.keydownAt;
      const physicalKeyToFocusObservedMs = measured.focusAt - measured.keydownAt;
      moves.push({
        command,
        ...measured,
        physicalKeyToRenderedEndpointMs,
        physicalKeyToFocusObservedMs,
      });
    }
    const after = await observeR1(page);
    assert.deepEqual(after.pauseReasons, []);
    assert.deepEqual(after.position, before.position);
    const result = {
      browser: options.browser.version(),
      before,
      after,
      moves,
      commands: driver.commands,
      method:
        "physical keydown capture to renderer frame-end player-idle and focus-equal completion; read-only diagnostics; 10 normal world movements including first movement",
    };
    await writeFile(join(output, "world-movement.json"), JSON.stringify(result, null, 2));
    assert.ok(
      moves.every((move) => move.physicalKeyToFocusObservedMs <= 120),
      "actual first focus observation <=120ms for every move",
    );
    assert.ok(
      moves.every((move) => move.physicalKeyToRenderedEndpointMs <= 140),
      "physical key to player frame-end <=140ms for every move",
    );
    return result;
  } catch (error) {
    await writeFile(
      join(output, "world-movement-failure.json"),
      JSON.stringify(
        { error: String(error), actual: await observeR1(page).catch(() => null) },
        null,
        2,
      ),
    );
    throw error;
  } finally {
    await context.close();
  }
}

export async function verifyR1Performance(options: {
  browser: Browser;
  url: string;
  outputDir: string;
  sourcePath?: string;
}) {
  const output = join(options.outputDir, "performance");
  await mkdir(output, { recursive: true });
  const results: unknown[] = [];
  for (const quality of ["standard", "low"] as const) {
    const context = await options.browser.newContext({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    try {
      const driver = await R1NormalDriver.importEarned(page, options.url, options.sourcePath);
      await driver.enterRoom("c.theft.03");
      await driver.settings({
        quality,
        zoom: 1,
        reducedMotion: false,
        reducedFlash: false,
        muted: false,
      });
      assert.equal((await observeR1(page)).render.tileCount, 64);
      await writeFile(
        join(output, `${quality}-planning.json`),
        JSON.stringify(
          {
            model: driver.model,
            candidates: directions.map((direction) => driver.predict({ kind: "Move", direction })),
          },
          null,
          2,
        ),
      );
      const original = driver.model.playerPosition.tileId;
      const direction = directions.find((candidate) => {
        const first = driver.predict({ kind: "Move", direction: candidate });
        if (first.code !== "accepted" || first.state.playerPosition.tileId === original)
          return false;
        const second = dispatch(
          content,
          first.state,
          { kind: "Move", direction: opposite[candidate] },
          first.state.clock.lastMonotonicTimeMs + 250,
        );
        return (
          second.code === "accepted" &&
          second.state.playerPosition.tileId === original &&
          JSON.stringify(second.state.activeStatic?.state.currentLayout) ===
            JSON.stringify(driver.model.activeStatic?.state.currentLayout)
        );
      });
      assert.ok(direction, "two legal floor moves preserve all theft objects");
      await page.locator("#game-canvas").focus();
      const before = await observeR1(page),
        frames = await frameWindow(page),
        inputs = [];
      for (let i = 0; i < 60; i++) {
        inputs.push(await measureNormalMove(driver, i % 2 ? opposite[direction] : direction));
        await page.waitForTimeout(850);
      }
      const sample = await frames.evaluate((value) => value.result);
      await frames.dispose();
      const after = await observeR1(page);
      const frame = distribution(sample.intervals),
        input = distribution(inputs.map((item) => item.latency));
      assert.equal(sample.error, null);
      assert.ok(sample.end - sample.start >= 60000);
      assert.ok(after.activeTimeMs - before.activeTimeMs >= 60000);
      assert.ok(frame.median <= 16.7 + 1e-7);
      assert.ok(frame.p95 <= 25);
      assert.ok(input.p95 <= 100);
      assert.ok(inputs.every((item) => item.endpointMs <= 140));
      assert.equal(after.staticRoom!.undoDepth - before.staticRoom!.undoDepth, 60);
      assert.equal(after.render.layout.devicePixelRatio, quality === "standard" ? 2 : 1);
      for (const field of [
        "completedObjectiveIds",
        "claimedRewardIds",
        "completedRoomLayouts",
        "bestResults",
      ] as const)
        assert.deepEqual(after[field], before[field]);
      const exported = await exportThroughUi(page);
      results.push({
        quality,
        browser: options.browser.version(),
        hardware: {
          cpus: os.cpus()[0]?.model,
          memoryBytes: os.totalmem(),
          system: os.type(),
          release: os.release(),
          arch: os.arch(),
        },
        before,
        after,
        sample,
        frame,
        inputs,
        input,
        exported,
        commands: driver.commands,
      });
      await writeFile(join(output, `${quality}.json`), JSON.stringify(results.at(-1), null, 2));
    } catch (error) {
      await page.screenshot({ path: join(output, `${quality}-failure.png`) }).catch(() => {});
      await writeFile(
        join(output, `${quality}-failure.json`),
        JSON.stringify(
          { error: String(error), actual: await observeR1(page).catch(() => null) },
          null,
          2,
        ),
      );
      throw error;
    } finally {
      await context.close();
    }
  }
  const context = await options.browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  try {
    const driver = await R1NormalDriver.importEarned(page, options.url, options.sourcePath);
    await driver.settings({ quality: "standard", reducedMotion: false, reducedFlash: false });
    await driver.teleport("hub");
    const before = await observeR1(page);
    const records: {
      trip: number;
      area: AreaId;
      position: R1Observation["position"];
      render: R1Observation["render"];
    }[] = [];
    for (let trip = 0; trip < 30; trip++)
      for (const area of [
        (["a", "b", "c", "d", "warehouse"] as const)[trip % 5]!,
        "hub",
      ] as const) {
        await driver.teleport(area);
        await driver.ready();
        const state = await observeR1(page);
        assert.equal(state.render.pendingIconCount, 0);
        records.push({ trip, area, position: state.position, render: state.render });
        for (const field of [
          "completedObjectiveIds",
          "claimedRewardIds",
          "completedRoomLayouts",
          "bestResults",
        ] as const)
          assert.deepEqual(state[field], before[field]);
      }
    for (const area of ["hub", "a", "b", "c", "d", "warehouse"]) {
      const visits = records.filter((item) => item.area === area);
      for (const field of ["geometries", "textures", "residentIconCount"] as const)
        assert.equal(
          new Set(visits.map((item) => item.render[field])).size,
          1,
          `${area}/${field} stable across visits`,
        );
    }
    await writeFile(
      join(output, "roundtrips.json"),
      JSON.stringify({ before, records, commands: driver.commands }, null, 2),
    );
  } finally {
    await context.close();
  }
  await writeFile(
    join(output, "result.json"),
    JSON.stringify({ results, roundtrips: "roundtrips.json" }, null, 2),
  );
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const directory = resolve("test-results/r1-visual-performance-build");
  await build({ mode: "acceptance", build: { outDir: directory } });
  const server = await preview({
    mode: "acceptance",
    build: { outDir: directory },
    preview: { host: "127.0.0.1", port: 0, strictPort: true },
  });
  const address = server.httpServer.address();
  assert.ok(address && typeof address !== "string");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const options = {
    browser,
    url: `http://127.0.0.1:${address.port}`,
    outputDir: resolve("test-results/r1-browser"),
    resumeAtScene: process.argv.find((arg) => arg.startsWith("--visual-from="))?.split("=")[1],
  };
  try {
    if (process.argv.includes("--world-movement-only")) await verifyR1WorldMovement(options);
    else if (process.argv.includes("--readability-only")) await verifyR1TheftReadability(options);
    else {
      if (!process.argv.includes("--performance-only")) await verifyR1VisualMatrix(options);
      if (!process.argv.includes("--visual-only")) await verifyR1Performance(options);
    }
  } finally {
    await browser.close();
    await new Promise<void>((done) => server.httpServer.close(() => done()));
  }
}
