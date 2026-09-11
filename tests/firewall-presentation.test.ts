import assert from "node:assert/strict";
import test from "node:test";
import content from "../src/content/challenges/realtime.json" with { type: "json" };
import { assembleContent } from "../src/content/assemble.ts";
import { worldWitnesses } from "../src/content/witnesses/index.ts";
import { createGame, dispatch } from "../src/core/engine.ts";
import { projectBoard } from "../src/core/projection.ts";
import { boardProjectionKey } from "../src/render/projection-key.ts";
import { firewallViewportInsets, fitBoardLayout, boardBoundsCss } from "../src/render/layout.ts";

test("原参考的防火墙为完整 5 列 4 行，四档均不能沿用通用 5×5 棋盘", () => {
  const definitions = content.definitions.filter((definition) => definition.kind === "firewall");
  assert.equal(definitions.length, 4);
  for (const definition of definitions) {
    assert.equal(definition.tiles.length, 20, definition.id);
    assert.deepEqual(
      definition.tiles.map((tile) => `${tile.x},${tile.y}`).sort(),
      Array.from({ length: 20 }, (_, index) => `${index % 5},${Math.floor(index / 5)}`).sort(),
    );
  }
});

test("正常命中后同一16ms画面桶内暂停，必须刷新投影以清除四屏PERFECT", () => {
  const gameContent = assembleContent("M1");
  let state = createGame(gameContent, 0);
  const witness = worldWitnesses.find((item) => item.id === "m1.world.full-collection-and-return")!;
  for (const step of witness.steps) {
    const result = dispatch(gameContent, state, step.command, step.atMs);
    assert.equal(result.code, step.expectedCode);
    state = result.state;
    if (
      state.activeRealtime?.state.kind === "firewall" &&
      state.activeRealtime.state.lastJudgment?.kind === "perfect"
    )
      break;
  }
  assert.equal(projectBoard(gameContent, state).firewall?.judgment, "perfect");
  const paused = dispatch(
    gameContent,
    state,
    { kind: "Pause", reason: "manual", present: true },
    state.clock.lastMonotonicTimeMs + 1,
  ).state;
  assert.equal(
    Math.floor(state.clock.activeTimeMs / 16),
    Math.floor(paused.clock.activeTimeMs / 16),
  );
  assert.equal(projectBoard(gameContent, paused).firewall?.judgment, null);
  assert.notEqual(boardProjectionKey(state), boardProjectionKey(paused));
});

test("完整电视墙在三种 Chrome 验收视口保留四侧屏空间，中央二十格均可点击", () => {
  const tiles = content.definitions.find((definition) => definition.kind === "firewall")!.tiles;
  for (const [width, height] of [
    [1024, 640],
    [1512, 771],
    [1920, 1080],
  ]) {
    const layout = fitBoardLayout({
      width: width!,
      height: height!,
      tiles,
      focus: { x: 0, y: 0 },
      local: true,
      zoom: 1,
      insets: firewallViewportInsets(width!, height!),
      fitPadding: 0.03,
    });
    const bounds = boardBoundsCss(layout);
    assert.ok(layout.fitsBoard);
    assert.ok(layout.targetCss.minimum >= 44);
    assert.ok(bounds.minY > height! * 0.16);
    assert.ok(bounds.maxY < height! * 0.9);
    const centerX = layout.available.left + layout.available.width / 2;
    const leftSideEdge = centerX + (-2.72 - layout.focus.x) * layout.pixelsPerWorldUnit;
    const rightSideEdge = centerX + (6.72 - layout.focus.x) * layout.pixelsPerWorldUnit;
    assert.ok(leftSideEdge >= -1, `${width}×${height}: 左侧电视被裁切 ${leftSideEdge}`);
    assert.ok(rightSideEdge <= width! + 1, `${width}×${height}: 右侧电视被裁切 ${rightSideEdge}`);
  }
});
