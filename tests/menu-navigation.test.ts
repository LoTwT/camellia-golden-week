import assert from "node:assert/strict";
import test from "node:test";
import { MenuFocusMemory, menuKeyAction, nextMenuIndex } from "../src/ui/menu-navigation.ts";

const plain = {
  repeat: false,
  isComposing: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  nativeControl: false,
};

test("菜单方向键与 W/S 共用选择动作，确认与 Tab 保留浏览器原生行为", () => {
  for (const key of ["ArrowUp", "ArrowLeft", "w", "W"])
    assert.equal(menuKeyAction({ ...plain, key }), "previous");
  for (const key of ["ArrowDown", "ArrowRight", "s", "S"])
    assert.equal(menuKeyAction({ ...plain, key }), "next");
  for (const key of ["Tab", "Enter", " ", "r", "z", "a", "d"])
    assert.equal(menuKeyAction({ ...plain, key }), null);
  assert.equal(menuKeyAction({ ...plain, key: "Escape" }), "cancel");
});

test("所有输入控件保留箭头、WASD、空格与 Enter，修饰键和输入法不触发菜单", () => {
  for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "w", "s", "Enter", " "])
    assert.equal(menuKeyAction({ ...plain, key, nativeControl: true }), null);
  for (const guard of ["ctrlKey", "metaKey", "altKey", "isComposing"])
    for (const key of ["ArrowUp", "s", "Escape"])
      assert.equal(menuKeyAction({ ...plain, key, [guard]: true }), null);
});

test("长按确认或 Esc 不穿越多层菜单，方向重复仍允许导航", () => {
  for (const key of ["Enter", " ", "Escape"])
    assert.equal(menuKeyAction({ ...plain, key, repeat: true }), "suppressRepeat");
  assert.equal(menuKeyAction({ ...plain, key: "ArrowDown", repeat: true }), "next");
  assert.equal(menuKeyAction({ ...plain, key: "Enter", repeat: true, nativeControl: true }), null);
});

test("菜单循环选择覆盖单项、空菜单与当前项消失的边界", () => {
  assert.equal(nextMenuIndex(0, 0, 1), -1);
  assert.equal(nextMenuIndex(1, 0, 1), 0);
  assert.equal(nextMenuIndex(1, 0, -1), 0);
  assert.equal(nextMenuIndex(5, 4, 1), 0);
  assert.equal(nextMenuIndex(5, 0, -1), 4);
  assert.equal(nextMenuIndex(5, -1, 1), 0);
  assert.equal(nextMenuIndex(5, -1, -1), 4);
  assert.equal(nextMenuIndex(2, 3, 1), 0);
});

test("父菜单选择记忆有界，更新同一菜单不驱逐仍有容量的其他菜单", () => {
  const memory = new MenuFocusMemory(2);
  memory.remember("pause", "storage");
  memory.remember("storage", "reload");
  memory.remember("pause", "settings");
  assert.equal(memory.recall("pause"), "settings");
  assert.equal(memory.recall("storage"), "reload");
  memory.remember("settings", "volume");
  assert.equal(memory.recall("storage"), undefined);
  assert.equal(memory.recall("pause"), "settings");
  for (const capacity of [0, -1, 1.5, NaN]) assert.throws(() => new MenuFocusMemory(capacity));
});
