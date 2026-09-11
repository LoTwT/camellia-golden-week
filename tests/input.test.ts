import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import type { Direction, GameCommand } from "../src/core/types.ts";
import { InputAdapter } from "../src/platform/input.ts";

class TestDocument extends EventTarget {
  activeElement: EventTarget | null = null;
}

class TestKeyboardEvent extends Event {
  readonly code: string;
  readonly repeat: boolean;
  readonly isComposing: boolean;

  constructor(
    type: "keydown" | "keyup",
    code: string,
    options: { repeat?: boolean; isComposing?: boolean } = {},
  ) {
    super(type, { cancelable: true });
    this.code = code;
    this.repeat = options.repeat ?? false;
    this.isComposing = options.isComposing ?? false;
  }
}

interface SentCommand {
  command: GameCommand;
  time: number;
}

function move(direction: Direction, time: number): SentCommand {
  return { command: { kind: "Move", direction }, time };
}

function harness(context: TestContext) {
  const fakeDocument = new TestDocument();
  const canvas = new EventTarget();
  const otherControl = new EventTarget();
  fakeDocument.activeElement = canvas;
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: fakeDocument });
  let now = 0;
  let canPlay = true;
  let firewall = false;
  let mapOpened = 0;
  let pauseOpened = 0;
  const sent: SentCommand[] = [];
  context.mock.method(performance, "now", () => now);
  const adapter = new InputAdapter(
    canvas as unknown as HTMLCanvasElement,
    (command, time) => sent.push({ command, time }),
    () => ({ canPlay, firewall }),
    () => {
      mapOpened += 1;
    },
    () => {
      pauseOpened += 1;
    },
  );
  context.after(() => {
    adapter.dispose();
    if (documentDescriptor) Object.defineProperty(globalThis, "document", documentDescriptor);
    else Reflect.deleteProperty(globalThis, "document");
  });
  return {
    adapter,
    sent,
    setPlayable(value: boolean) {
      canPlay = value;
    },
    setFirewall(value: boolean) {
      firewall = value;
    },
    focusCanvas() {
      fakeDocument.activeElement = canvas;
    },
    focusControl() {
      fakeDocument.activeElement = otherControl;
    },
    menuCounts() {
      return { mapOpened, pauseOpened };
    },
    key(
      type: "keydown" | "keyup",
      code: string,
      at: number,
      options: { repeat?: boolean; isComposing?: boolean } = {},
    ) {
      assert.ok(at >= now, "测试时间必须单调");
      now = at;
      const event = new TestKeyboardEvent(type, code, options);
      fakeDocument.dispatchEvent(event);
      return event;
    },
    frame(at: number) {
      assert.ok(at >= now, "测试时间必须单调");
      now = at;
      adapter.frame(at);
    },
  };
}

test("I01 八个方向键只派发对应四向一步，画布消费游戏按键而不消费其他输入", (context) => {
  const input = harness(context);
  const bindings: [string, Direction][] = [
    ["ArrowUp", "up"],
    ["KeyW", "up"],
    ["ArrowRight", "right"],
    ["KeyD", "right"],
    ["ArrowDown", "down"],
    ["KeyS", "down"],
    ["ArrowLeft", "left"],
    ["KeyA", "left"],
  ];
  bindings.forEach(([code], index) => {
    assert.equal(input.key("keydown", code, index * 140).defaultPrevented, true);
    input.key("keyup", code, index * 140);
  });
  assert.deepEqual(
    input.sent,
    bindings.map(([, direction], index) => move(direction, index * 140)),
  );
  assert.equal(input.key("keydown", "KeyQ", 1200).defaultPrevented, false);
  assert.equal(input.key("keydown", "Tab", 1200).defaultPrevented, false);
  assert.equal(input.key("keydown", "KeyW", 1200, { isComposing: true }).defaultPrevented, false);
  assert.equal(input.sent.length, 8);
});

test("I01 长按由适配器在 250ms 首次重复，再以 140ms 节奏派发；浏览器 repeat 不改时序", (context) => {
  const input = harness(context);
  input.key("keydown", "ArrowRight", 0);
  input.key("keydown", "ArrowRight", 20, { repeat: true });
  input.frame(249);
  assert.deepEqual(input.sent, [move("right", 0)]);
  input.frame(250);
  input.key("keydown", "ArrowRight", 300, { repeat: true });
  input.frame(389);
  assert.deepEqual(input.sent, [move("right", 0), move("right", 250)]);
  input.frame(390);
  input.frame(529);
  input.frame(530);
  input.key("keyup", "ArrowRight", 531);
  input.frame(1000);
  assert.deepEqual(input.sent, [
    move("right", 0),
    move("right", 250),
    move("right", 390),
    move("right", 530),
  ]);
});

test("I01 两方向按住时重复最新方向，释放它后回到前一个仍按住方向", (context) => {
  const input = harness(context);
  input.key("keydown", "ArrowUp", 0);
  input.key("keydown", "KeyD", 150);
  input.frame(399);
  input.frame(400);
  input.key("keyup", "KeyD", 401);
  input.frame(539);
  input.frame(540);
  assert.deepEqual(input.sent, [
    move("up", 0),
    move("right", 150),
    move("right", 400),
    move("up", 540),
  ]);
});

test("I02 动画期新方向覆盖唯一等待方向，到 140ms 仅提交最新一步", (context) => {
  const input = harness(context);
  input.key("keydown", "ArrowUp", 0);
  input.key("keydown", "ArrowRight", 10);
  input.key("keydown", "ArrowDown", 20);
  input.key("keydown", "ArrowLeft", 30);
  input.frame(139);
  assert.deepEqual(input.sent, [move("up", 0)]);
  input.frame(140);
  input.frame(140);
  input.frame(279);
  assert.deepEqual(input.sent, [move("up", 0), move("left", 140)]);
  input.frame(280);
  assert.deepEqual(input.sent, [move("up", 0), move("left", 140), move("left", 280)]);
});

test("I02 帧调用迟到时至多派发一次，不积攒或追补长按步数", (context) => {
  const input = harness(context);
  input.key("keydown", "KeyS", 0);
  input.frame(5000);
  input.frame(5000);
  input.frame(5139);
  assert.deepEqual(input.sent, [move("down", 0), move("down", 5000)]);
  input.frame(5140);
  assert.deepEqual(input.sent, [move("down", 0), move("down", 5000), move("down", 5140)]);
});

test("I07 clear 丢弃等待方向并抑制仍按住的键，恢复后必须 keyup 再次按下", (context) => {
  const input = harness(context);
  input.key("keydown", "ArrowUp", 0);
  input.key("keydown", "ArrowRight", 10);
  input.adapter.clear();
  input.setPlayable(false);
  input.focusControl();
  input.frame(500);
  input.key("keyup", "ArrowUp", 500);
  input.focusCanvas();
  input.setPlayable(true);
  input.frame(1000);
  input.key("keydown", "ArrowRight", 1000, { repeat: true });
  input.key("keydown", "ArrowRight", 1001);
  input.frame(1300);
  assert.deepEqual(input.sent, [move("up", 0)]);
  input.key("keyup", "ArrowRight", 1301);
  input.key("keydown", "ArrowRight", 1302);
  assert.deepEqual(input.sent, [move("up", 0), move("right", 1302)]);
});

test("I07 连续暂停或模式切换重复 clear 不解除按住抑制，释放后新方向正常操作", (context) => {
  const input = harness(context);
  input.key("keydown", "KeyW", 0);
  input.adapter.clear();
  input.adapter.clear();
  input.frame(500);
  input.key("keydown", "KeyW", 500);
  input.key("keydown", "KeyD", 501);
  input.key("keyup", "KeyD", 502);
  input.key("keyup", "KeyW", 503);
  input.key("keydown", "KeyW", 641);
  assert.deepEqual(input.sent, [move("up", 0), move("right", 501), move("up", 641)]);
});

test("I10 菜单、输入框或导入控件拥有焦点时，不消费快捷键、方向或菜单键", (context) => {
  const input = harness(context);
  input.focusControl();
  for (const code of [
    "KeyW",
    "KeyA",
    "KeyS",
    "KeyD",
    "ArrowUp",
    "ArrowRight",
    "ArrowDown",
    "ArrowLeft",
    "KeyF",
    "KeyR",
    "KeyZ",
    "KeyM",
    "Escape",
  ]) {
    assert.equal(input.key("keydown", code, 0).defaultPrevented, false);
    input.key("keyup", code, 0);
  }
  input.frame(1000);
  assert.deepEqual(input.sent, []);
  assert.deepEqual(input.menuCounts(), { mapOpened: 0, pauseOpened: 0 });
});

test("I07 / I10 画布失去焦点或 canPlay 关闭期间，按住重复与等待命令均不穿透", (context) => {
  const input = harness(context);
  input.key("keydown", "KeyW", 0);
  input.key("keydown", "KeyD", 10);
  input.focusControl();
  input.frame(250);
  input.frame(500);
  input.focusCanvas();
  input.setPlayable(false);
  input.frame(750);
  for (const code of ["KeyA", "KeyF", "KeyR", "KeyZ"]) input.key("keydown", code, 750);
  input.adapter.clear();
  input.setPlayable(true);
  input.frame(1000);
  assert.deepEqual(input.sent, [move("up", 0)]);
});

test("I10 画布快捷键派发语义命令，重复事件无效，地图和暂停只调用对应 UI 接口", (context) => {
  const input = harness(context);
  for (const code of ["KeyF", "KeyR", "KeyZ", "KeyM", "Escape"]) {
    assert.equal(input.key("keydown", code, 0).defaultPrevented, true);
    input.key("keydown", code, 0, { repeat: true });
    input.key("keyup", code, 0);
  }
  assert.deepEqual(input.sent, [
    { command: { kind: "Interact" }, time: 0 },
    { command: { kind: "Amplify" }, time: 0 },
    { command: { kind: "Undo" }, time: 0 },
  ]);
  assert.deepEqual(input.menuCounts(), { mapOpened: 1, pauseOpened: 1 });
});

test("I01 / T02 防火墙每次物理按下只派发一次，不生成适配器长按或等待移动", (context) => {
  const input = harness(context);
  input.setFirewall(true);
  input.key("keydown", "ArrowRight", 0);
  input.key("keydown", "ArrowRight", 30, { repeat: true });
  input.frame(250);
  input.frame(1000);
  assert.deepEqual(input.sent, [move("right", 0)]);
  input.key("keyup", "ArrowRight", 1001);
  input.key("keydown", "ArrowRight", 1002);
  input.key("keydown", "ArrowDown", 1010);
  input.frame(1300);
  assert.deepEqual(input.sent, [move("right", 0), move("right", 1002), move("down", 1010)]);
});

test("dispose 移除监听，后续键盘不会派发或消费按键", (context) => {
  const input = harness(context);
  input.adapter.dispose();
  assert.equal(input.key("keydown", "ArrowRight", 0).defaultPrevented, false);
  input.key("keyup", "ArrowRight", 0);
  assert.deepEqual(input.sent, []);
});
