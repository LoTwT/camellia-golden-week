import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import type { Browser, BrowserContext, Page } from "playwright";
import { build, preview } from "vite";
import { assembleContent } from "../../src/content/assemble.ts";
import worldWitnesses from "../../src/content/witnesses/r1-world.ts";
import { createGame, dispatch } from "../../src/core/engine.ts";
import type { GameCommand, GameState } from "../../src/core/types.ts";
import { SAVE_KEYS } from "../../src/platform/save-store.ts";
import type { SaveEnvelope } from "../../src/platform/save-store.ts";
import type { SavePayload } from "../../src/platform/save-payload.ts";
import type { AcceptanceFaultSnapshot } from "../../src/platform/acceptance-faults.ts";
import { exportThroughUi, pressGameKey, waitForGameReady } from "./support.ts";
import { R1NormalDriver } from "./r1-visual-performance.ts";

interface Observation {
  position: GameState["playerPosition"];
  mode: string;
  phase: string;
  activeTimeMs: number;
  countdownRemainingMs: number;
  realtimeRoom: GameState["activeRealtime"];
  pauseReasons: string[];
  completedObjectiveIds: string[];
  claimedRewardIds: string[];
  completedRoomLayouts: GameState["completedRoomLayouts"];
  saveGeneration: number;
  saveStatus: string;
  session: string;
  audio: { enabled: boolean };
  faults: AcceptanceFaultSnapshot;
}
const keys = { up: "ArrowUp", right: "ArrowRight", down: "ArrowDown", left: "ArrowLeft" };
const currentSource = resolve("tests/fixtures/r1/m5-main-earned-save.json");
const oldSource = resolve(
  "tests/fixtures/historical/controls-readability/v1-full-collection-migration-save.json",
);
const observe = (page: Page): Promise<Observation> =>
  page.evaluate(() =>
    (Reflect.get(window, "__CAMELLIA_INSPECT__") as { snapshot(): Observation }).snapshot(),
  );
const slots = (page: Page) =>
  page.evaluate(
    (names) => ({
      a: localStorage.getItem(names.a),
      b: localStorage.getItem(names.b),
      preMigration: localStorage.getItem(names.preMigration),
    }),
    SAVE_KEYS,
  );
const permanent = (s: Observation) => ({
  position: s.position,
  completed: s.completedObjectiveIds,
  claimed: s.claimedRewardIds,
  layouts: s.completedRoomLayouts,
});
async function fresh(page: Page) {
  await page.getByRole("button", { name: "新游戏", exact: true }).click();
  await page.locator("#game-canvas[aria-busy='false']").waitFor();
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => done())));
  const snapshot = await observe(page);
  if (snapshot.pauseReasons.length) {
    assert.deepEqual(
      snapshot.pauseReasons,
      ["clockGap"],
      "only one pre-input startup gap may resume",
    );
    assert.equal(await page.evaluate(() => document.hasFocus() && !document.hidden), true);
    await page.getByRole("button", { name: "继续探索", exact: true }).click();
  }
  await waitForGameReady(page);
  return snapshot.pauseReasons.length ? snapshot : null;
}
async function storageMenu(page: Page) {
  const back = page.getByRole("button", { name: "返回存档菜单", exact: true });
  if (await back.isVisible()) await back.click();
  if (!(await page.locator("#game-dialog").evaluate((e) => (e as HTMLDialogElement).open)))
    await page.getByRole("button", { name: "打开暂停菜单", exact: true }).click();
  const storage = page.getByRole("button", { name: "进度与存档", exact: true });
  if (await storage.isVisible()) await storage.click();
}
async function resume(page: Page) {
  const back = page.getByRole("button", { name: "返回存档菜单", exact: true });
  if (await back.isVisible()) await back.click();
  await page.getByRole("button", { name: "继续探索", exact: true }).click();
  await waitForGameReady(page);
}
async function panel(page: Page, open: boolean) {
  const element = page.locator("[data-acceptance-faults]");
  if ((await element.evaluate((e) => (e as HTMLDetailsElement).open)) !== open)
    await element.locator(":scope > summary").click();
}
async function arm(
  page: Page,
  target: "a" | "b" | "preMigration",
  operation: "get" | "set" | "readback",
) {
  await panel(page, true);
  await page.getByLabel("故障存储目标键", { exact: true }).selectOption(target);
  await page
    .getByRole("button", {
      name: {
        get: "下次读取抛错",
        set: "下次写入抛错",
        readback: "下次成功写入后回读不匹配",
      }[operation],
      exact: true,
    })
    .click();
  await panel(page, false);
}
async function action(page: Page, label: string, close = true) {
  await panel(page, true);
  await page.getByRole("button", { name: label, exact: true }).click();
  if (close) await panel(page, false);
}
async function nextSlot(page: Page): Promise<"a" | "b"> {
  const current = await slots(page);
  const generation = (raw: string | null) =>
    raw ? (JSON.parse(raw) as SaveEnvelope<unknown>).saveGeneration : 0;
  return generation(current.a) >= generation(current.b) ? "b" : "a";
}
async function importRaw(page: Page, raw: string) {
  await storageMenu(page);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "导入存档", exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: "r1-platform-boundary.json",
    mimeType: "application/json",
    buffer: Buffer.from(raw),
  });
}
async function inject(page: Page, target: "a" | "b", raw: string) {
  await panel(page, true);
  await page.getByLabel("故障存储目标键", { exact: true }).selectOption(target);
  await page.getByLabel("测试槽原文", { exact: true }).fill(raw);
  await page.getByRole("button", { name: "写入指定测试槽", exact: true }).click();
  assert.match(
    await page.getByLabel("验收故障状态与触发记录", { exact: true }).innerText(),
    /已写入指定故障槽/,
  );
  await panel(page, false);
}
async function exportedSlot(page: Page, id: "a" | "b") {
  await page.getByRole("button", { name: `导出原始槽 ${id.toUpperCase()}`, exact: true }).click();
  const raw = await page.getByRole("textbox", { name: "完整存档文本", exact: true }).inputValue();
  await page.getByRole("button", { name: "返回存档菜单", exact: true }).click();
  return raw;
}
async function firstMazeBeforeSuccess(page: Page) {
  const content = assembleContent("M5");
  const witness = worldWitnesses.witnesses.find((w) => w.profileId === "M5")!;
  let expected = createGame(content, 0);
  for (const step of witness.steps) {
    const command = step.command as GameCommand;
    const result = dispatch(content, expected, command, step.atMs);
    if (
      !expected.completedObjectiveIds.includes("a.maze.01") &&
      result.state.completedObjectiveIds.includes("a.maze.01")
    )
      return { command, expected: result.state };
    expected = result.state;
    if (command.kind === "Tick") continue;
    if ((await observe(page)).phase === "preview")
      await page.waitForFunction(
        () =>
          (Reflect.get(window, "__CAMELLIA_INSPECT__") as { snapshot(): Observation }).snapshot()
            .phase === "active",
      );
    assert.ok(["Move", "Amplify", "Interact"].includes(command.kind));
    await pressGameKey(
      page,
      command.kind === "Move" ? keys[command.direction] : command.kind === "Amplify" ? "r" : "f",
    );
    await waitForGameReady(page);
    assert.deepEqual((await observe(page)).position, expected.playerPosition);
  }
  throw new Error("Main witness must contain a first maze success");
}

export async function verifyR1PlatformBoundaries(options: {
  browser: Browser;
  url: string;
  alternateUrl: string;
  outputDir: string;
  scenarioIds?: readonly string[];
}) {
  const output = join(options.outputDir, "platform-boundaries");
  await mkdir(output, { recursive: true });
  const results: unknown[] = [];
  const startedAt = new Date().toISOString();
  const currentRaw = await readFile(currentSource, "utf8");
  const oldRaw = await readFile(oldSource, "utf8");
  async function scenario(
    id: string,
    run: (page: Page, context: BrowserContext) => Promise<unknown>,
    search = "",
  ) {
    if (options.scenarioIds && !options.scenarioIds.includes(id)) return;
    const context = await options.browser.newContext({
      viewport: { width: 1512, height: 900 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    context.on("page", (opened) => opened.on("pageerror", (error) => errors.push(error.message)));
    try {
      await page.goto(options.url + search);
      await page.bringToFront();
      const detail = await run(page, context);
      assert.deepEqual(errors, []);
      const reportingPage = page.isClosed() ? context.pages().at(-1)! : page;
      const result = { id, success: true, detail, errors, final: await observe(reportingPage) };
      await reportingPage.screenshot({ path: join(output, `${id}.png`) });
      await writeFile(join(output, `${id}.json`), JSON.stringify(result, null, 2));
      results.push(result);
      console.log(`PASS platform ${id}`);
    } catch (error) {
      const reportingPage = page.isClosed() ? context.pages().at(-1)! : page;
      const result = {
        id,
        success: false,
        error: String(error),
        errors,
        actual: await observe(reportingPage).catch(() => null),
      };
      await reportingPage.screenshot({ path: join(output, `${id}-failure.png`) }).catch(() => {});
      await writeFile(join(output, `${id}-failure.json`), JSON.stringify(result, null, 2));
      throw error;
    } finally {
      await context.close();
    }
  }
  for (const fault of ["render", "audio", "get", "set", "readback"] as const)
    await scenario(`success-${fault}`, async (page) => {
      const startupRecovery = await fresh(page);
      const last = await firstMazeBeforeSuccess(page);
      assert.equal(last.command.kind, "Move");
      const before = await observe(page),
        rawBefore = await slots(page),
        target = await nextSlot(page);
      if (fault === "audio" || fault === "render")
        await action(page, fault === "audio" ? "成功后音频抛错" : "成功后渲染抛错");
      else await arm(page, target, fault);
      await pressGameKey(
        page,
        keys[(last.command as Extract<GameCommand, { kind: "Move" }>).direction],
      );
      const after = await observe(page);
      assert.ok(after.completedObjectiveIds.includes("a.maze.01"));
      assert.deepEqual(after.claimedRewardIds, last.expected.claimedRewardIds);
      assert.equal(after.faults.feedback, null);
      if (fault === "get" || fault === "set" || fault === "readback")
        assert.match(after.saveStatus, /未保存/);
      const rawAfter = await slots(page);
      if (fault === "get" || fault === "set") assert.deepEqual(rawAfter, rawBefore);
      if (fault === "readback") {
        assert.equal(rawAfter[target === "a" ? "b" : "a"], rawBefore[target === "a" ? "b" : "a"]);
        assert.notEqual(rawAfter[target], rawBefore[target]);
      }
      if (fault === "render") {
        await page.getByRole("heading", { name: "图形暂时不可用", exact: true }).waitFor();
        await page.getByRole("button", { name: "导出进度", exact: true }).click();
      }
      const exported =
        fault === "render"
          ? (JSON.parse(
              await page.getByRole("textbox", { name: "完整存档文本", exact: true }).inputValue(),
            ) as SaveEnvelope<SavePayload>)
          : await exportThroughUi(page);
      assert.deepEqual(exported.payload.completedObjectiveIds, after.completedObjectiveIds);
      assert.deepEqual(exported.payload.claimedRewardIds, after.claimedRewardIds);
      if (fault === "render") {
        await page.getByRole("button", { name: "返回存档菜单", exact: true }).click();
        // Rendering failure still permits an exported in-memory successful transaction.
      } else {
        await storageMenu(page);
        await page.getByRole("button", { name: "重试保存", exact: true }).click();
        assert.match((await observe(page)).saveStatus, /^已保存/);
        assert.deepEqual(
          (await exportThroughUi(page)).payload.claimedRewardIds,
          after.claimedRewardIds,
        );
      }
      return { startupRecovery, before, after, rawBefore, rawAfter, exported };
    });
  for (const operation of ["get", "set", "readback"] as const)
    await scenario(`import-${operation}`, async (page) => {
      await fresh(page);
      const before = await observe(page),
        rawBefore = await slots(page),
        target = await nextSlot(page);
      await importRaw(page, currentRaw);
      await page.getByRole("heading", { name: "确认导入进度", exact: true }).waitFor();
      await arm(page, target, operation);
      await page.getByRole("button", { name: "确认替换", exact: true }).click();
      await page.getByRole("heading", { name: "导入未生效", exact: true }).waitFor();
      const after = await observe(page),
        rawAfter = await slots(page);
      assert.deepEqual(permanent(after), permanent(before));
      assert.match(after.saveStatus, /未保存/);
      if (operation !== "readback") assert.deepEqual(rawAfter, rawBefore);
      else
        assert.equal(rawAfter[target === "a" ? "b" : "a"], rawBefore[target === "a" ? "b" : "a"]);
      await page.getByRole("button", { name: "返回", exact: true }).click();
      const exported = await exportThroughUi(page);
      assert.deepEqual(exported.payload.completedObjectiveIds, before.completedObjectiveIds);
      return { before, after, rawBefore, rawAfter, exported };
    });
  for (const operation of ["set", "readback"] as const)
    await scenario(`migration-backup-${operation}`, async (page) => {
      await fresh(page);
      const before = await observe(page),
        rawBefore = await slots(page);
      await importRaw(page, oldRaw);
      await page.getByRole("heading", { name: "确认导入进度", exact: true }).waitFor();
      await arm(page, "preMigration", operation);
      await page.getByRole("button", { name: "确认替换", exact: true }).click();
      await page.getByRole("heading", { name: "导入未生效", exact: true }).waitFor();
      const after = await observe(page),
        rawAfter = await slots(page);
      assert.deepEqual(permanent(after), permanent(before));
      assert.equal(rawAfter.a, rawBefore.a);
      assert.equal(rawAfter.b, rawBefore.b);
      assert.match(after.saveStatus, /迁移前原槽备份/);
      return { before, after, rawBefore, rawAfter };
    });
  await scenario("migration-newslot-readback", async (page) => {
    await fresh(page);
    const before = await observe(page),
      rawBefore = await slots(page),
      target = await nextSlot(page);
    await importRaw(page, oldRaw);
    await page.getByRole("heading", { name: "确认导入进度", exact: true }).waitFor();
    await arm(page, target, "readback");
    await page.getByRole("button", { name: "确认替换", exact: true }).click();
    await page.getByRole("heading", { name: "导入未生效", exact: true }).waitFor();
    const after = await observe(page),
      rawAfter = await slots(page);
    assert.deepEqual(permanent(after), permanent(before));
    assert.equal(rawAfter[target === "a" ? "b" : "a"], rawBefore[target === "a" ? "b" : "a"]);
    assert.ok(rawAfter.preMigration);
    assert.deepEqual(JSON.parse(rawAfter.preMigration).saves, { a: rawBefore.a, b: rawBefore.b });
    assert.notEqual(rawAfter[target], rawBefore[target]);
    await page.getByRole("button", { name: "返回", exact: true }).click();
    await importRaw(page, oldRaw);
    await page.getByRole("button", { name: "确认替换", exact: true }).click();
    await waitForGameReady(page);
    assert.equal((await slots(page)).preMigration, rawAfter.preMigration);
    return { before, after, rawBefore, rawAfter, retried: await exportThroughUi(page) };
  });
  await scenario("invalid-imports", async (page) => {
    await fresh(page);
    const baseline = await exportThroughUi(page),
      before = await observe(page),
      rawBefore = await slots(page);
    const cases: [string, string][] = [
      ["bad-json", "{bad"],
      ["oversize", " ".repeat(1024 * 1024 + 1)],
    ];
    for (const [id, field, value] of [
      ["wrong-project", "gameId", "other"],
      ["unknown-objective", "completedObjectiveIds", ["<script>window.bad=true</script>"]],
      [
        "unknown-position",
        "playerPosition",
        { ...baseline.payload.playerPosition, tileId: "invalid.tile" },
      ],
      ["unknown-reward", "claimedRewardIds", ["evil.reward"]],
      ["fake-completed-layout", "completedRoomLayouts", { "c.theft.01": {} }],
    ] as const) {
      const candidate = JSON.parse(JSON.stringify(baseline)) as {
        payload: Record<string, unknown>;
      };
      candidate.payload[field] = value;
      cases.push([id, JSON.stringify(candidate)]);
    }
    const complete = JSON.parse(currentRaw) as { payload: Record<string, unknown> };
    const completedLayouts = complete.payload.completedRoomLayouts as Record<
      string,
      { layout: { theft?: { amplifierTileById: Record<string, string> } } }
    >;
    const occupied = completedLayouts["c.theft.02"]!.layout.theft!.amplifierTileById;
    const objects = Object.keys(occupied);
    occupied[objects[1]!] = occupied[objects[0]!]!;
    cases.push(["overlapping-completed-amplifiers", JSON.stringify(complete)]);
    const rejected: unknown[] = [];
    for (const [id, raw] of cases) {
      await importRaw(page, raw);
      await page.getByRole("heading", { name: "导入失败", exact: true }).waitFor();
      rejected.push({ id, message: await page.locator(".dialog-description").innerText() });
      assert.deepEqual(permanent(await observe(page)), permanent(before));
      assert.deepEqual(await slots(page), rawBefore);
      await page.getByRole("button", { name: "返回", exact: true }).click();
    }
    assert.equal(await page.evaluate(() => Reflect.has(window, "bad")), false);
    return { rejected, unchanged: (await exportThroughUi(page)).payload };
  });
  for (const kind of [
    "bad-json",
    "both-bad",
    "same-generation",
    "future-schema",
    "future-content",
    "generation-order",
  ] as const)
    await scenario(`slots-${kind}`, async (page) => {
      await fresh(page);
      const initial = await exportThroughUi(page);
      const old = { ...initial, saveGeneration: 20, savedAt: "2099-01-01T00:00:00.000Z" };
      const newest = {
        ...initial,
        saveGeneration: 21,
        savedAt: "2000-01-01T00:00:00.000Z",
        payload: { ...initial.payload, settings: { ...initial.payload.settings, muted: true } },
      };
      if (kind === "same-generation") newest.saveGeneration = 20;
      if (kind === "future-schema")
        newest.payload = { ...newest.payload, schemaVersion: 999 } as SavePayload;
      if (kind === "future-content") newest.payload = { ...newest.payload, contentVersion: 999 };
      await inject(page, "a", kind === "both-bad" ? "bad-a" : JSON.stringify(old));
      await inject(
        page,
        "b",
        kind === "bad-json" || kind === "both-bad" ? "bad-b" : JSON.stringify(newest),
      );
      const injected = await slots(page);
      await page.reload();
      const heading = kind.startsWith("future")
        ? "较新进度已保护"
        : kind === "bad-json"
          ? "选择存档恢复方式"
          : kind === "generation-order"
            ? "继续探索"
            : "需要处理本地存档";
      await page.getByRole("heading", { name: heading, exact: true }).waitFor();
      assert.deepEqual(await slots(page), injected);
      assert.equal(await exportedSlot(page, "a"), injected.a);
      assert.equal(await exportedSlot(page, "b"), injected.b);
      if (kind.startsWith("future") || kind === "same-generation")
        assert.equal(await page.getByRole("button", { name: "继续游戏", exact: true }).count(), 0);
      if (kind === "generation-order") {
        await page.getByRole("button", { name: "继续游戏", exact: true }).click();
        await waitForGameReady(page);
        assert.equal((await exportThroughUi(page)).payload.settings.muted, true);
      }
      if (kind === "bad-json") {
        await page.getByRole("button", { name: /^使用备份继续/ }).click();
        await waitForGameReady(page);
        const recovered = await exportThroughUi(page);
        assert.deepEqual(recovered.payload, old.payload);
        assert.ok(recovered.saveGeneration > old.saveGeneration);
      }
      if (kind === "both-bad") {
        await page.getByRole("button", { name: "明确开始新游戏…", exact: true }).click();
        await page.getByRole("button", { name: "确认新游戏", exact: true }).click();
        await waitForGameReady(page);
        const replacement = await exportThroughUi(page);
        const replacedSlots = await slots(page);
        const stored = [replacedSlots.a, replacedSlots.b]
          .filter((raw): raw is string => !!raw?.startsWith("{"))
          .map((raw) => JSON.parse(raw) as SaveEnvelope<SavePayload>);
        assert.equal(stored.length, 1);
        const acknowledgement = stored[0]!.supersededCorruptSlot;
        assert.ok(acknowledgement);
        assert.equal(
          acknowledgement.sha256,
          createHash("sha256").update(injected[acknowledgement.id]!).digest("hex"),
        );
        await page.reload();
        await page.getByRole("button", { name: "继续游戏", exact: true }).click();
        await waitForGameReady(page);
        assert.deepEqual((await exportThroughUi(page)).payload, replacement.payload);
      }
      return { fixtureOnly: true, injected, heading, after: await slots(page) };
    });
  await scenario("newgame-import-generation-date", async (page) => {
    await fresh(page);
    await pressGameKey(page, "ArrowRight");
    const before = await exportThroughUi(page);
    await storageMenu(page);
    await page.getByRole("button", { name: "开始新游戏…", exact: true }).click();
    await page.getByRole("button", { name: "确认新游戏", exact: true }).click();
    await waitForGameReady(page);
    const reset = await exportThroughUi(page);
    assert.ok(reset.saveGeneration > before.saveGeneration);
    const afterResetSlots = await slots(page);
    assert.ok(
      [afterResetSlots.a, afterResetSlots.b].some(
        (raw) => raw && JSON.parse(raw).saveGeneration === before.saveGeneration,
      ),
      "new game preserves the preceding valid snapshot as an explicit recovery source",
    );
    await importRaw(page, JSON.stringify(before));
    await page.getByRole("button", { name: "确认替换", exact: true }).click();
    await waitForGameReady(page);
    const imported = await exportThroughUi(page);
    assert.ok(imported.saveGeneration > reset.saveGeneration);
    assert.deepEqual(imported.payload, before.payload);
    const afterImportSlots = await slots(page);
    assert.ok(
      [afterImportSlots.a, afterImportSlots.b].some(
        (raw) => raw && JSON.parse(raw).saveGeneration === reset.saveGeneration,
      ),
      "import preserves the preceding valid new-game snapshot",
    );
    await resume(page);
    await page.clock.setSystemTime(new Date("2001-01-01T00:00:00Z"));
    await pressGameKey(page, "ArrowRight");
    const dated = await exportThroughUi(page);
    assert.ok(dated.saveGeneration > imported.saveGeneration);
    assert.match(dated.savedAt, /^2001/);
    await page.reload();
    await page.getByRole("button", { name: "继续游戏", exact: true }).click();
    await waitForGameReady(page);
    assert.deepEqual((await exportThroughUi(page)).payload, dated.payload);
    await storageMenu(page);
    const originMessage = await page.locator("#game-dialog").innerText();
    assert.ok(originMessage.includes(new URL(options.url).origin));
    assert.match(originMessage, /端口.*另一份存储/);
    return {
      before,
      reset,
      imported,
      afterResetSlots,
      afterImportSlots,
      dated,
      originMessage,
      clockMethod: "Playwright Date-only setSystemTime; OS date unchanged",
    };
  });
  await scenario("different-port", async (page, context) => {
    assert.notEqual(new URL(options.url).port, new URL(options.alternateUrl).port);
    await fresh(page);
    await pressGameKey(page, "ArrowRight");
    const earned = await exportThroughUi(page),
      original = await slots(page);
    const separate = await context.newPage();
    await separate.goto(options.alternateUrl);
    await separate.bringToFront();
    await separate.getByRole("button", { name: "新游戏", exact: true }).waitFor();
    assert.deepEqual(await slots(separate), { a: null, b: null, preMigration: null });
    const chooser = separate.waitForEvent("filechooser");
    await separate.getByRole("button", { name: "导入存档", exact: true }).click();
    await (
      await chooser
    ).setFiles({
      name: "actual-source-port.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(earned)),
    });
    await separate.getByRole("button", { name: "确认替换", exact: true }).click();
    await waitForGameReady(separate);
    assert.deepEqual((await exportThroughUi(separate)).payload, earned.payload);
    await separate.close();
    await page.bringToFront();
    assert.deepEqual(await slots(page), original);
    return {
      source: options.url,
      destination: options.alternateUrl,
      earned,
      originalUnchanged: true,
    };
  });
  await scenario("two-tabs", async (page, context) => {
    await fresh(page);
    await pressGameKey(page, "ArrowRight");
    const first = await exportThroughUi(page);
    const second = await context.newPage();
    await second.goto(options.url);
    await second.bringToFront();
    await second.getByRole("heading", { name: "进度正在另一窗口使用", exact: true }).waitFor();
    const blocked = await observe(second),
      rawBefore = await slots(second);
    assert.equal(blocked.session, "busy");
    await second.getByRole("button", { name: "重试获取会话", exact: true }).click();
    assert.deepEqual(await slots(second), rawBefore);
    await page.bringToFront();
    await resume(page);
    await pressGameKey(page, "ArrowRight");
    const latest = await exportThroughUi(page);
    assert.ok(latest.saveGeneration > first.saveGeneration);
    await page.close();
    await second.bringToFront();
    await second.getByRole("button", { name: "重试获取会话", exact: true }).click();
    await second.getByRole("button", { name: "继续游戏", exact: true }).click();
    await waitForGameReady(second);
    const reopened = await exportThroughUi(second);
    assert.deepEqual(reopened.payload, latest.payload);
    await second.screenshot({ path: join(output, "two-tabs-second.png") });
    // Final evidence is taken from the surviving page after the actual writer closes.
    return { first, blocked, latest, reopened, finalPageClosed: true };
  });
  for (const challengeId of ["b.antivirus.light", "d.ghost.01", "d.ghost.02"] as const)
    await scenario(`realtime-refresh-${challengeId}`, async (page) => {
      const driver = await R1NormalDriver.importEarned(page, options.url, currentSource);
      const content = assembleContent("M5");
      await driver.teleport(challengeId.startsWith("b.") ? "b" : "d");
      const access = content.entities.find((item) =>
        item.kind === "challengeAccess"
          ? item.params.challengeIds.includes(challengeId)
          : item.kind === "roomEntrance" && item.params.roomId === challengeId,
      )!;
      await driver.walkTo(access.tileId);
      await driver.send({ kind: "Interact" });
      const before = await observe(page);
      const choice =
        access.kind === "challengeAccess" ? access.params.challengeIds.indexOf(challengeId) : 0;
      await page.locator(".challenge-choice").nth(choice).click();
      await page.locator("#game-canvas[aria-busy='false']").waitFor();
      await page.waitForFunction(
        (minimum) => {
          const state = (
            Reflect.get(window, "__CAMELLIA_INSPECT__") as { snapshot(): Observation }
          ).snapshot();
          return (
            state.countdownRemainingMs === 0 &&
            (state.realtimeRoom?.state.activeTimeMs ?? 0) >= minimum
          );
        },
        challengeId.startsWith("b.") ? 2000 : 100,
      );
      const running = await observe(page);
      assert.equal(running.mode, "challengeRunning");
      assert.deepEqual(running.pauseReasons, []);
      assert.ok(running.realtimeRoom);
      await page.reload();
      await page.getByRole("button", { name: "继续游戏", exact: true }).click();
      await waitForGameReady(page);
      const restored = await observe(page);
      assert.equal(restored.realtimeRoom, null);
      assert.deepEqual(restored.position, before.position);
      assert.deepEqual(restored.completedObjectiveIds, before.completedObjectiveIds);
      assert.deepEqual(restored.claimedRewardIds, before.claimedRewardIds);
      assert.deepEqual(restored.completedRoomLayouts, before.completedRoomLayouts);
      const exported = await exportThroughUi(page);
      assert.equal(exported.payload.room, null);
      return {
        source: currentSource,
        commands: driver.commands,
        before,
        running,
        restored,
        exported,
      };
    });
  await scenario(
    "audio-denied",
    async (page) => {
      await fresh(page);
      assert.equal((await observe(page)).audio.enabled, false);
      assert.equal(await page.locator(".audio-prompt").isVisible(), true);
      await pressGameKey(page, "ArrowRight");
      const moved = await observe(page);
      assert.equal(moved.position.tileId, "hub.t.1.2");
      await page.locator(".audio-prompt").click();
      await page.waitForFunction(
        () =>
          (Reflect.get(window, "__CAMELLIA_INSPECT__") as { snapshot(): Observation }).snapshot()
            .audio.enabled,
      );
      return { moved, retried: await observe(page) };
    },
    "?acceptanceFault=audio-denied",
  );
  await scenario(
    "webgl-startup",
    async (page) => {
      await page.getByRole("heading", { name: "图形暂时不可用", exact: true }).waitFor();
      assert.equal(
        await page.getByRole("button", { name: "导出进度", exact: true }).isVisible(),
        true,
      );
      const failed = await observe(page);
      await page.getByRole("button", { name: "重试图形", exact: true }).click();
      await fresh(page);
      await pressGameKey(page, "ArrowRight");
      const earned = await exportThroughUi(page);
      assert.equal(earned.payload.playerPosition.tileId, "hub.t.1.2");
      return { failed, earned };
    },
    "?acceptanceFault=webgl2-unavailable",
  );
  await scenario("context-loss", async (page) => {
    await fresh(page);
    await pressGameKey(page, "ArrowRight");
    const before = await observe(page);
    await action(page, "请求真实上下文丢失", false);
    await page.getByRole("heading", { name: "图形暂时不可用", exact: true }).waitFor();
    const lost = await observe(page);
    assert.ok(lost.pauseReasons.includes("graphicsLost"));
    assert.deepEqual(permanent(lost), permanent(before));
    await page.waitForTimeout(350);
    assert.equal((await observe(page)).activeTimeMs, lost.activeTimeMs);
    await page.getByRole("button", { name: "请求真实上下文恢复", exact: true }).click();
    await page.getByRole("button", { name: "继续探索", exact: true }).waitFor();
    await page.locator("#game-canvas[aria-busy='false']").waitFor();
    await panel(page, false);
    await resume(page);
    assert.deepEqual(permanent(await observe(page)), permanent(before));
    return { before, lost, restored: await observe(page) };
  });
  await scenario("clock-gap", async (page) => {
    await fresh(page);
    await pressGameKey(page, "ArrowRight");
    const before = await observe(page);
    await action(page, "实际阻塞前台 300ms", false);
    await page.getByRole("heading", { name: "探索已暂停", exact: true }).waitFor();
    const paused = await observe(page);
    assert.deepEqual(paused.pauseReasons, ["clockGap"]);
    assert.deepEqual(permanent(paused), permanent(before));
    await page.waitForTimeout(350);
    assert.equal((await observe(page)).activeTimeMs, paused.activeTimeMs);
    await panel(page, false);
    await resume(page);
    await pressGameKey(page, "ArrowRight");
    assert.equal((await observe(page)).position.tileId, "hub.t.2.2");
    return { before, paused, resumed: await observe(page) };
  });
  assert.equal(
    results.length,
    options.scenarioIds?.length ?? 28,
    "Every requested platform scenario must run",
  );
  const result = {
    success: true,
    browser: options.browser.version(),
    startedAt,
    finishedAt: new Date().toISOString(),
    scope: options.scenarioIds ?? "all-platform-boundaries",
    sourceHashes: {
      current: createHash("sha256").update(currentRaw).digest("hex"),
      historical: createHash("sha256").update(oldRaw).digest("hex"),
    },
    fixtureScope:
      "Raw slots and malformed files only for named platform boundaries; success faults earned by normal first-maze inputs",
    results,
  };
  await writeFile(
    join(output, options.scenarioIds ? "selected-result.json" : "result.json"),
    JSON.stringify(result, null, 2),
  );
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const directory = resolve("test-results/r1-platform-build");
  await build({ mode: "acceptance", build: { outDir: directory } });
  const server = await preview({
    mode: "acceptance",
    build: { outDir: directory },
    preview: { host: "127.0.0.1", port: 0, strictPort: true },
  });
  const alternate = await preview({
    mode: "acceptance",
    build: { outDir: directory },
    preview: { host: "127.0.0.1", port: 0, strictPort: true },
  });
  const alternateAddress = alternate.httpServer.address();
  assert.ok(alternateAddress && typeof alternateAddress !== "string");
  const address = server.httpServer.address();
  assert.ok(address && typeof address !== "string");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    await verifyR1PlatformBoundaries({
      browser,
      url: `http://127.0.0.1:${address.port}`,
      alternateUrl: `http://127.0.0.1:${alternateAddress.port}`,
      outputDir: resolve("test-results/r1-browser"),
      ...(process.env.CAMELLIA_PLATFORM_CASES
        ? { scenarioIds: process.env.CAMELLIA_PLATFORM_CASES.split(",") }
        : {}),
    });
  } finally {
    await browser.close();
    await new Promise<void>((done) => server.httpServer.close(() => done()));
    await new Promise<void>((done) => alternate.httpServer.close(() => done()));
  }
}
