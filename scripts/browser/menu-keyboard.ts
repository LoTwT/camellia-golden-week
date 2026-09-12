import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { join } from "node:path";
import type { Browser, BrowserContext, Page } from "playwright";
import type { SaveEnvelope } from "../../src/platform/save-store.ts";
import type { SavePayload } from "../../src/platform/save-payload.ts";

async function verifyNavigationDomBoundaries(context: BrowserContext) {
  const fixture = await context.newPage();
  try {
    await fixture.setContent(
      `<button id="outside">外部入口</button><dialog id="fixture"><button id="first">第一项</button><button disabled>禁用项</button><button hidden>隐藏项</button><button style="display:none">不显示</button><button style="visibility:hidden">不可见</button><section inert><button>惰性项</button></section><button aria-disabled="true">辅助禁用</button><button tabindex="-1">不参与导航</button><button id="second">第二项</button><input aria-label="编辑文本"><textarea aria-label="多行文本"></textarea><button id="replace">替换菜单</button></dialog>`,
    );
    const source = stripTypeScriptTypes(
      await readFile(new URL("../../src/ui/menu-navigation.ts", import.meta.url), "utf8"),
    );
    await fixture.addScriptTag({
      type: "module",
      content: `${source}
const dialog = document.querySelector('#fixture');
const navigation = new DialogNavigation(dialog);
dialog.addEventListener('keydown', event => navigation.handleKey(event, () => {
  navigation.close(); dialog.close(); document.querySelector('#outside').focus();
}));
document.querySelector('#replace').addEventListener('click', () => {
  navigation.begin('discarded');
  dialog.replaceChildren(Object.assign(document.createElement('button'), {textContent:'过渡项'}));
  navigation.begin('final');
  dialog.replaceChildren(Object.assign(document.createElement('button'), {textContent:'最终项'}));
});
navigation.begin('fixture'); dialog.showModal();`,
    });
    await fixture.waitForFunction(() => document.activeElement?.id === "first");
    await fixture.keyboard.press("ArrowDown");
    assert.equal(await fixture.evaluate(() => document.activeElement?.id), "second");
    await fixture.keyboard.press("ArrowDown");
    await fixture.keyboard.type("wasdrz");
    assert.equal(await fixture.getByRole("textbox", { name: "编辑文本" }).inputValue(), "wasdrz");
    await fixture.keyboard.press("Tab");
    await fixture.keyboard.type("first");
    await fixture.keyboard.press("Enter");
    await fixture.keyboard.type("wasdrz");
    assert.equal(
      await fixture.getByRole("textbox", { name: "多行文本" }).inputValue(),
      "first\nwasdrz",
    );
    await fixture.keyboard.press("Tab");
    await fixture.keyboard.press("Enter");
    await fixture.waitForFunction(() => document.activeElement?.textContent === "最终项");
    await fixture.keyboard.press("Escape");
    assert.equal(await fixture.evaluate(() => document.activeElement?.id), "outside");
    return {
      skipped: [
        "disabled",
        "hidden",
        "display:none",
        "visibility:hidden",
        "inert ancestor",
        "aria-disabled",
        "tabindex=-1",
      ],
      nativeText: "wasdrz",
      nativeTextarea: "first\nwasdrz",
      staleFocus: "同一事件内重建两次，仅最终菜单取得焦点；关闭后回到外部入口",
      scope: "独立空白页中的真实菜单导航模块 DOM 边界夹具，不含游戏状态或游戏通关证据。",
    };
  } finally {
    await fixture.close();
  }
}

async function readMenu(page: Page) {
  return page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLDialogElement>("#game-dialog")!;
    const style = active ? getComputedStyle(active) : null;
    return {
      open: dialog.open,
      title: document.querySelector("#dialog-title")?.textContent ?? "",
      focused: {
        id: active?.id ?? "",
        tag: active?.tagName ?? "",
        label:
          active?.getAttribute("aria-label") ??
          active?.closest("label")?.textContent?.trim() ??
          active?.textContent?.trim() ??
          "",
        enabled: !!active && !active.matches(":disabled, [aria-disabled='true']"),
        visible: active?.checkVisibility({ checkVisibilityCSS: true }) ?? false,
        focusVisible: active?.matches(":focus-visible") ?? false,
        outlineWidth: style?.outlineWidth,
        color: style?.color,
        background: style?.backgroundColor,
        inViewport: active
          ? active.getBoundingClientRect().top >= 0 &&
            active.getBoundingClientRect().bottom <= innerHeight
          : false,
      },
    };
  });
}

function contrastRatio(foreground: string, background: string): number {
  const luminance = (color: string) => {
    const channels = color
      .match(/\d+(?:\.\d+)?/g)
      ?.slice(0, 3)
      .map(Number);
    assert.equal(channels?.length, 3);
    const linear = channels!.map((value) => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
  };
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export async function verifyMenuKeyboard(options: {
  browser: Browser;
  url: string;
  outputDir: string;
}): Promise<unknown> {
  const { browser, url, outputDir } = options;
  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  await context.tracing.start({ screenshots: true, snapshots: true });
  const report: Record<string, unknown> = {
    startedAt: new Date().toISOString(),
    browser: browser.version(),
    headless: process.env.CAMELLIA_HEADED !== "1",
    method:
      "独立生产构建、新 context；游戏菜单仅真实键盘，文件由原生 filechooser 入口选择。只读 DOM、正常 UI 导出与事件观察；不修改游戏状态，不自动恢复运行期暂停。",
    screenshots: [],
  };
  const steps: unknown[] = [];
  let eventLog: Awaited<ReturnType<typeof page.evaluateHandle>> | undefined;
  const key = async (pressed: string) => {
    await page.keyboard.press(pressed);
    await page.waitForTimeout(25);
    steps.push({ key: pressed, ...(await readMenu(page)) });
  };
  const assertFocus = async (label: string) => {
    const state = await readMenu(page);
    assert.equal(state.focused.label, label);
    assert.ok(state.focused.enabled && state.focused.visible, "焦点只落在可见、可用控件");
    assert.ok(state.focused.inViewport, "键盘聚焦会将菜单控件滚动到当前视口");
  };
  const assertTitle = async (title: string) => {
    await page.getByRole("heading", { name: title, exact: true }).waitFor();
    assert.equal((await readMenu(page)).open, true);
  };
  const choose = async (label: string) => {
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const state = await readMenu(page);
      if (state.focused.label === label) return;
      assert.equal(state.open, true, `选择 ${label} 时菜单必须保持打开`);
      await key(["INPUT", "SELECT", "TEXTAREA"].includes(state.focused.tag) ? "Tab" : "ArrowDown");
    }
    assert.fail(`24 次以内未能通过键盘选择 ${label}`);
  };
  const activate = async (label: string, confirm = "Enter") => {
    await choose(label);
    await key(confirm);
  };
  const ready = async () => {
    await page.waitForFunction(
      () =>
        !document.querySelector<HTMLDialogElement>("#game-dialog")?.open &&
        document.querySelector("#game-canvas")?.getAttribute("aria-busy") === "false",
    );
    assert.equal((await readMenu(page)).focused.id, "game-canvas", "返回可玩态必须恢复画布焦点");
  };
  const gameKey = async (pressed: string) => {
    assert.equal((await readMenu(page)).focused.id, "game-canvas");
    await key(pressed);
    await page.waitForTimeout(155);
  };
  const screenshot = async (name: string) => {
    const path = `menu-${name}.png`;
    await page.screenshot({ path: join(outputDir, path), fullPage: true });
    (report.screenshots as string[]).push(path);
  };
  const exportFromStorage = async () => {
    await activate("导出当前进度");
    await assertTitle("导出当前进度");
    const raw = await page.getByRole("textbox", { name: "完整存档文本", exact: true }).inputValue();
    assert.ok(raw.length);
    return { raw, envelope: JSON.parse(raw) as SaveEnvelope<SavePayload> };
  };
  const selectImport = async (raw: string, name: string) => {
    await choose("导入存档");
    const chooser = page.waitForEvent("filechooser");
    await key("Enter");
    await (
      await chooser
    ).setFiles({ name, mimeType: "application/json", buffer: Buffer.from(raw) });
  };
  try {
    report.domBoundaries = await verifyNavigationDomBoundaries(context);
    await page.goto(url);
    await page.bringToFront();
    await page.getByRole("button", { name: "新游戏", exact: true }).waitFor();
    assert.equal(await page.evaluate(() => Reflect.has(window, "__CAMELLIA_INSPECT__")), false);
    eventLog = await page.evaluateHandle(() => {
      const events: unknown[] = [];
      for (const type of ["keydown", "keyup", "focusin"]) {
        document.addEventListener(
          type,
          (event) => {
            const target = event.target as HTMLElement;
            queueMicrotask(() => {
              if (events.length >= 3000) return;
              events.push({
                type,
                key: event instanceof KeyboardEvent ? event.key : null,
                repeat: event instanceof KeyboardEvent ? event.repeat : false,
                prevented: event.defaultPrevented,
                target: target.tagName,
                targetLabel: target.getAttribute("aria-label") ?? target.textContent,
                title: document.querySelector("#dialog-title")?.textContent,
                time: performance.now(),
              });
            });
          },
          true,
        );
      }
      return events;
    });
    await assertFocus("新游戏");
    for (const [pressed, label] of [
      ["ArrowDown", "导入存档"],
      ["ArrowUp", "新游戏"],
      ["ArrowLeft", "导入存档"],
      ["ArrowRight", "新游戏"],
      ["s", "导入存档"],
      ["w", "新游戏"],
      ["Tab", "导入存档"],
      ["Shift+Tab", "新游戏"],
    ] as const) {
      await key(pressed);
      await assertFocus(label);
    }
    await key("Escape");
    await assertTitle("沙罗黄金周");
    const primary = (await readMenu(page)).focused;
    assert.ok(primary.focusVisible && Number.parseFloat(primary.outlineWidth!) >= 3);
    const primaryContrast = contrastRatio(primary.color!, primary.background!);
    assert.ok(primaryContrast >= 4.5, "聚焦主按钮文字对比度至少 4.5:1");
    const hintSize = await page
      .locator(".menu-keyboard-hint")
      .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
    assert.ok(hintSize >= 14);
    report.focusAppearance = { primary, primaryContrast, hintSize };
    await screenshot("startup-focus");
    await key("Enter");
    await ready();
    await key("Escape");
    await assertTitle("探索已暂停");
    await assertFocus("继续探索");
    await key("ArrowUp");
    await assertFocus("进度与存档");
    await key("ArrowDown");
    await assertFocus("继续探索");
    await key("s");
    await assertFocus("区域图与传送 · M");
    await key("s");
    await assertFocus("声音与显示");
    await key(" ");
    await assertTitle("声音与显示");
    await assertFocus("主音量");
    for (const label of ["主音量", "棋盘缩放"]) {
      await assertFocus(label);
      const control = page.getByRole("slider", { name: label, exact: true });
      const value = Number(await control.inputValue());
      await key("ArrowRight");
      assert.ok(Math.abs(Number(await control.inputValue()) - value - 0.05) < 1e-6);
      await key("ArrowLeft");
      assert.equal(Number(await control.inputValue()), value);
      await key("w");
      await key("s");
      await assertFocus(label);
      assert.equal(Number(await control.inputValue()), value);
      await key("Tab");
    }
    await assertFocus("静音");
    const muted = await page.getByRole("checkbox", { name: "静音", exact: true }).isChecked();
    await key(" ");
    assert.equal(
      await page.getByRole("checkbox", { name: "静音", exact: true }).isChecked(),
      !muted,
    );
    await key(" ");
    for (const label of ["减少闪烁", "减少动态效果"]) {
      await key("Tab");
      await assertFocus(label);
      if (!(await page.getByRole("checkbox", { name: label, exact: true }).isChecked()))
        await key(" ");
    }
    await key("Tab");
    await assertFocus("画质");
    const quality = page.getByRole("combobox", { name: "画质", exact: true });
    await key("ArrowDown");
    await key("Enter");
    await assertFocus("画质");
    const afterDown = await quality.inputValue();
    await key("ArrowUp");
    await key("Enter");
    await assertFocus("画质");
    report.nativeSelect = {
      afterDown,
      afterUp: await quality.inputValue(),
      verified: "Tab 可进入/离开，方向键与 Enter 未被菜单接管；保持原生 SELECT 焦点。",
      limitation:
        "macOS Chrome 153 的 Playwright 原生弹出选单未通过键盘改变选值；在空白原生 HTML、有头/无头与直接 CDP 中同样复现。本项不宣称原生弹出选单选值验证通过。",
    };
    await key("Tab");
    await assertFocus("启用声音");
    await key("Control+ArrowDown");
    await assertFocus("启用声音");
    await screenshot("settings-native-controls");
    await page.keyboard.down("Escape");
    await assertTitle("探索已暂停");
    await assertFocus("声音与显示");
    await page.keyboard.down("Escape");
    await assertTitle("探索已暂停");
    await page.keyboard.up("Escape");
    await key("Escape");
    await ready();

    await gameKey("m");
    await assertTitle("区域图与传送");
    await assertFocus("中心区 · 已激活");
    assert.equal(await page.locator(".region-map button:disabled").count(), 5);
    await key("ArrowDown");
    await assertFocus("返回暂停菜单");
    await key("ArrowUp");
    await assertFocus("中心区 · 已激活");
    await screenshot("map-disabled-skipped");
    await key("Escape");
    await ready();
    await key("Tab");
    await assertFocus("收集记录 ↗");
    await key("Enter");
    await assertTitle("收集记录");
    await key("Escape");
    assert.equal((await readMenu(page)).open, false);
    await assertFocus("收集记录 ↗");
    await key("Shift+Tab");
    await ready();
    await gameKey("ArrowRight");
    assert.match(await page.locator("#amplifier").innerText(), /阳炎增幅仪/);
    await key("Escape");
    await activate("区域图与传送 · M");
    await assertTitle("区域图与传送");
    await key("Escape");
    await assertTitle("探索已暂停");
    await assertFocus("区域图与传送 · M");
    await activate("收集记录");
    await assertTitle("收集记录");
    await key("ArrowDown");
    await assertFocus("继续探索");
    await key("Escape");
    await assertTitle("探索已暂停");
    await assertFocus("收集记录");
    await activate("进度与存档");
    await assertTitle("进度与存档");
    const before = await exportFromStorage();
    assert.equal(before.envelope.payload.playerPosition.tileId, "hub.t.1.2");
    await key("Tab");
    await key("Tab");
    await assertFocus("完整存档文本");
    for (const pressed of ["ArrowRight", "ArrowDown", "w", "a", "s", "d", "r", "z"])
      await key(pressed);
    assert.equal(
      await page.getByRole("textbox", { name: "完整存档文本" }).inputValue(),
      before.raw,
    );
    await assertFocus("完整存档文本");
    await screenshot("export-text-focus");
    await key("Escape");
    await assertTitle("进度与存档");
    await assertFocus("导出当前进度");
    await activate("重新读取本地进度…");
    await assertTitle("重新读取本地进度？");
    await key("ArrowDown");
    await assertFocus("确认重新读取");
    await key("Escape");
    await assertTitle("进度与存档");
    await assertFocus("重新读取本地进度…");
    await activate("开始新游戏…");
    await assertTitle("替换当前进度？");
    await key("Escape");
    await assertTitle("进度与存档");
    await assertFocus("开始新游戏…");
    await screenshot("storage-restored-focus");
    await selectImport("{", "malformed.json");
    await assertTitle("导入失败");
    await assertFocus("返回");
    await key("ArrowDown");
    await assertFocus("返回");
    await screenshot("import-failure-keyboard");
    await key("Escape");
    await assertTitle("进度与存档");
    await assertFocus("导入存档");
    await selectImport(before.raw, "menu-progress.json");
    await assertTitle("确认导入进度");
    await key("ArrowDown");
    await assertFocus("确认替换");
    await key("Escape");
    await assertTitle("进度与存档");
    await assertFocus("导入存档");
    const unchanged = await exportFromStorage();
    assert.deepEqual(
      unchanged.envelope.payload,
      before.envelope.payload,
      "菜单键、编辑键和取消/无效导入均不推进世界或替换存档",
    );
    await key("Escape");
    await selectImport(before.raw, "menu-progress.json");
    await assertTitle("确认导入进度");
    await choose("确认替换");
    await screenshot("import-confirm-focus");
    await key(" ");
    await ready();

    for (const pressed of [
      "ArrowRight",
      "ArrowRight",
      "r",
      "ArrowRight",
      "ArrowRight",
      "ArrowRight",
      "f",
    ])
      await gameKey(pressed);
    await ready();
    for (const pressed of ["ArrowUp", "ArrowUp", "ArrowUp", "f"]) await gameKey(pressed);
    await assertTitle("终端挑战");
    await assertFocus("教学 · 15 秒 / Combo 12");
    for (const [pressed, label] of [
      ["ArrowDown", "内层 · 45 秒 / Combo 40"],
      ["ArrowRight", "深层 · 45 秒 / Combo 55"],
      ["s", "核心 · 45 秒 / Combo 70"],
      ["ArrowLeft", "深层 · 45 秒 / Combo 55"],
      ["w", "内层 · 45 秒 / Combo 40"],
      ["ArrowUp", "教学 · 15 秒 / Combo 12"],
    ] as const) {
      await key(pressed);
      await assertFocus(label);
    }
    await screenshot("challenge-selection");
    await key("Escape");
    await ready();
    await gameKey("f");
    await assertTitle("终端挑战");
    await activate("教学 · 15 秒 / Combo 12", " ");
    await ready();
    await page.getByRole("heading", { name: "重新尝试", exact: true }).waitFor({ timeout: 22_000 });
    await assertFocus("再挑战一次");
    await key("ArrowDown");
    await assertFocus("返回地图");
    await key("ArrowUp");
    await assertFocus("再挑战一次");
    await screenshot("result-selection");
    await key("Escape");
    await ready();
    await key("Escape");
    await activate("进度与存档");
    const final = await exportFromStorage();
    assert.equal(final.envelope.payload.playerPosition.tileId, "a.t.0.-3");
    await key("Escape");
    await key("Escape");
    await assertTitle("探索已暂停");
    await key("Escape");
    await ready();
    const nativeEvents = (await eventLog.jsonValue()) as {
      type: string;
      target: string;
      key: string | null;
      prevented: boolean;
    }[];
    const editingEvents = nativeEvents.filter(
      (event) =>
        event.type === "keydown" &&
        ["INPUT", "SELECT", "TEXTAREA"].includes(event.target) &&
        event.key !== "Escape",
    );
    assert.ok(
      editingEvents.some((event) => event.target === "SELECT" && event.key === "ArrowDown"),
    );
    assert.ok(editingEvents.some((event) => event.target === "TEXTAREA" && event.key === "w"));
    assert.ok(
      editingEvents.every((event) => !event.prevented),
      "原生编辑控件的按键不能被菜单消费",
    );
    report.nativeEditingEvents = editingEvents;
    assert.deepEqual(errors, []);
    report.success = true;
    report.coverage = [
      "启动",
      "暂停",
      "直接区域图",
      "暂停子面板区域图",
      "设置原生 range/checkbox 值改变与 select 事件边界",
      "收集记录",
      "存档",
      "导出 textarea",
      "重新读取取消",
      "新游戏取消",
      "无效导入",
      "有效导入取消/确认",
      "挑战四档选择",
      "自然失败结果",
      "Esc 分层返回",
      "有界焦点恢复",
      "禁用项跳过",
      "菜单键不穿透世界",
      "独立 DOM 隐藏与惰性项跳过",
      "原生单行/多行文本编辑",
      "同事件重建焦点时序",
    ];
    report.beforeMenuPayload = before.envelope.payload;
    report.afterCancelledImportPayload = unchanged.envelope.payload;
    report.finalPosition = final.envelope.payload.playerPosition;
    return report;
  } catch (error) {
    report.success = false;
    report.error = error instanceof Error ? error.stack : String(error);
    await page
      .screenshot({ path: join(outputDir, "menu-failure.png"), fullPage: true })
      .catch(() => {});
    throw error;
  } finally {
    report.steps = steps;
    report.events = eventLog ? await eventLog.jsonValue().catch(() => []) : [];
    report.errors = errors;
    report.finishedAt = new Date().toISOString();
    await writeFile(
      join(outputDir, "menu-keyboard-results.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
    await context.tracing.stop({ path: join(outputDir, "menu-keyboard-trace.zip") });
    await context.close();
  }
}
