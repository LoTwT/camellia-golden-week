import assert from "node:assert/strict";
import type { Page } from "playwright";
import type { SaveEnvelope } from "../../src/platform/save-store.ts";
import type { SavePayload } from "../../src/platform/save-payload.ts";

export async function waitForGameReady(page: Page): Promise<void> {
  await page.locator("#game-canvas[aria-busy='false']").waitFor({ state: "visible" });
  await page.waitForFunction(
    () => !document.querySelector<HTMLDialogElement>("#game-dialog")?.open,
  );
  await page.locator("#game-canvas").focus();
}

export async function startNewGame(page: Page): Promise<void> {
  await page.getByRole("button", { name: "新游戏", exact: true }).click();
  await waitForGameReady(page);
}

export async function pressGameKey(page: Page, key: string): Promise<void> {
  await page.locator("#game-canvas").focus();
  await page.keyboard.press(key);
  // Intentional human-paced inputs: independent of the configured 140 ms throttle.
  await page.waitForTimeout(180);
}

export async function exportThroughUi(page: Page): Promise<SaveEnvelope<SavePayload>> {
  const dialog = page.locator("#game-dialog");
  if (!(await dialog.evaluate((element) => (element as HTMLDialogElement).open)))
    await page.getByRole("button", { name: "打开暂停菜单", exact: true }).click();
  const storage = page.getByRole("button", { name: "进度与存档", exact: true });
  if (await storage.isVisible()) await storage.click();
  await page.getByRole("button", { name: "导出当前进度", exact: true }).click();
  const raw = await page.getByRole("textbox", { name: "完整存档文本", exact: true }).inputValue();
  assert.ok(raw.length > 0, "正常导出必须生成可读存档");
  return JSON.parse(raw) as SaveEnvelope<SavePayload>;
}
