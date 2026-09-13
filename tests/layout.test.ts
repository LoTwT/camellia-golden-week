import assert from "node:assert/strict";
import test from "node:test";
import { OrthographicCamera, Vector3 } from "three";
import { assembleContent } from "../src/content/assemble.ts";
import {
  boardBoundsCss,
  cameraFocusAt,
  defaultViewportInsets,
  fitBoardLayout,
  projectedBoardBounds,
  TELEVISION,
} from "../src/render/layout.ts";
import type { BoardLayout, BoardLayoutRequest, Point2 } from "../src/render/layout.ts";

function grid(columns: number, rows: number): Point2[] {
  return Array.from({ length: columns * rows }, (_, index) => ({
    x: index % columns,
    y: Math.floor(index / columns),
  }));
}

function localLayout(tiles: readonly Point2[], width = 1366, height = 644, zoom = 1): BoardLayout {
  return fitBoardLayout({
    width,
    height,
    tiles,
    focus: tiles[0] ?? { x: 0, y: 0 },
    local: true,
    zoom,
  });
}

function threeCamera(layout: BoardLayout): OrthographicCamera {
  const camera = new OrthographicCamera(
    layout.camera.left,
    layout.camera.right,
    layout.camera.top,
    layout.camera.bottom,
    0.1,
    100,
  );
  const z = layout.focus.y / Math.sin(TELEVISION.cameraAngleRadians);
  camera.position.set(layout.focus.x, 20, z + 20 / Math.tan(TELEVISION.cameraAngleRadians));
  camera.lookAt(layout.focus.x, 0, z);
  camera.updateMatrixWorld();
  return camera;
}

function projectedBodyCorners(tile: Point2, layout: BoardLayout): Point2[] {
  const camera = threeCamera(layout);
  const points: Point2[] = [];
  for (const x of [-TELEVISION.bodyWidth / 2, TELEVISION.bodyWidth / 2])
    for (const y of [-TELEVISION.bodyHeight / 2, TELEVISION.bodyHeight / 2])
      for (const z of [-TELEVISION.bodyDepth / 2, TELEVISION.bodyDepth / 2]) {
        const clip = new Vector3(
          tile.x * TELEVISION.stepX + x,
          y,
          tile.y * TELEVISION.stepZ + z,
        ).project(camera);
        points.push({
          x: ((clip.x + 1) / 2) * layout.canvas.width,
          y: ((1 - clip.y) / 2) * layout.canvas.height,
        });
      }
  return points;
}

function assertFitsActualBodies(tiles: readonly Point2[], layout: BoardLayout): void {
  assert.equal(layout.fitsBoard, true);
  assert.equal(layout.requiresExpandedViewport, false);
  const envelope = boardBoundsCss(layout);
  assert.ok(envelope.minX >= layout.available.left - 1e-7);
  assert.ok(envelope.maxX <= layout.available.left + layout.available.width + 1e-7);
  assert.ok(envelope.minY >= layout.available.top - 1e-7);
  assert.ok(envelope.maxY <= layout.available.top + layout.available.height + 1e-7);
  for (const tile of tiles) {
    const corners = projectedBodyCorners(tile, layout);
    assert.ok(
      corners.every(
        (point) =>
          point.x >= envelope.minX - 1e-7 &&
          point.x <= envelope.maxX + 1e-7 &&
          point.y >= envelope.minY - 1e-7 &&
          point.y <= envelope.maxY + 1e-7,
      ),
    );
    const width =
      Math.max(...corners.map((point) => point.x)) - Math.min(...corners.map((point) => point.x));
    const height =
      Math.max(...corners.map((point) => point.y)) - Math.min(...corners.map((point) => point.y));
    assert.ok(width >= 44 - 1e-7);
    assert.ok(height >= 44 - 1e-7);
    assert.ok(Math.abs(width - layout.targetCss.width) < 1e-7);
    assert.ok(Math.abs(height - layout.targetCss.height) < 1e-7);
  }
}

test("电视几何经实际 Three 相机投影呈横向1.14比例，壳缝密且点击量度为CSS尺寸", () => {
  const layout = localLayout(grid(2, 2));
  assertFitsActualBodies(grid(2, 2), layout);
  const ratio = layout.targetCss.width / layout.targetCss.height;
  assert.ok(ratio > 1.13 && ratio < 1.15);
  const horizontalGap = TELEVISION.stepX - TELEVISION.bodyWidth;
  const verticalGap =
    TELEVISION.stepZ * Math.sin(TELEVISION.cameraAngleRadians) -
    layout.targetCss.height / layout.pixelsPerWorldUnit;
  assert.ok(horizontalGap > 0 && horizontalGap / TELEVISION.bodyWidth < 0.04);
  assert.ok(verticalGap > 0 && verticalGap < 0.03);
});

test("18个电视局部棋盘在1366/1920视口及缩放两端均完整拟合；3个盗取终端由独立DOM布局验证", () => {
  const content = assembleContent("M4");
  const theft = content.staticChallenges.filter((definition) => definition.kind === "theft");
  assert.deepEqual(
    theft.map((definition) => definition.tiles.length),
    [36, 64, 64],
  );
  // Actual flat-panel CSS targets are measured in scripts/browser/r1-stage-check.ts at all three viewports.
  const definitions = [
    ...content.staticChallenges.filter((definition) => definition.kind !== "theft"),
    ...content.realtimeChallenges,
  ];
  assert.equal(definitions.length, 18);
  for (const definition of definitions) {
    for (const [width, height] of [
      [1366, 644],
      [1920, 956],
    ] as const) {
      for (const zoom of [0.75, 1, 1.5]) {
        const layout = localLayout(definition.tiles, width, height, zoom);
        assertFitsActualBodies(definition.tiles, layout);
        assert.deepEqual(layout.insets, { left: 248, right: 202, top: 0, bottom: 0 });
      }
    }
  }
});

test("9列长通道与9×9上限按双轴拟合，局部放大到边界会明确记录effective zoom", () => {
  for (const tiles of [grid(9, 2), grid(2, 9), grid(9, 9)]) {
    for (const zoom of [0.75, 1, 1.5])
      assertFitsActualBodies(tiles, localLayout(tiles, 1366, 644, zoom));
    const enlarged = localLayout(tiles, 1366, 644, 1.5);
    assert.equal(enlarged.requestedZoom, 1.5);
    assert.equal(enlarged.zoomLimited, true);
    assert.ok(enlarged.effectiveZoom < 1.5);
  }
  const wide = localLayout(grid(9, 2));
  const tall = localLayout(grid(2, 9));
  assert.ok(wide.pixelsPerWorldUnit > tall.pixelsPerWorldUnit);
});

test("世界默认约9×7可见范围，0.75–1.5按倍数缩放，不强行全世界挤进视口", () => {
  for (const [width, height] of [
    [1366, 644],
    [1920, 956],
  ] as const) {
    const request = {
      width,
      height,
      tiles: grid(20, 20),
      focus: { x: 12, y: 9 },
      local: false,
      zoom: 1,
    };
    const normal = fitBoardLayout(request);
    assert.ok(normal.visibleColumns >= 9 && normal.visibleColumns < 10);
    assert.ok(normal.visibleRows >= 7 - 1e-9 && normal.visibleRows < 8);
    assert.equal(normal.fitsBoard, false);
    assert.equal(normal.requiresExpandedViewport, false);
    for (const zoom of [0.75, 1.5]) {
      const changed = fitBoardLayout({ ...request, zoom });
      assert.ok(Math.abs(changed.pixelsPerWorldUnit / normal.pixelsPerWorldUnit - zoom) < 1e-9);
      assert.equal(changed.zoomLimited, false);
      assert.ok(changed.targetCss.minimum >= 44);
    }
  }
});

test("非原点与稀疏地图保持同样构图；外壳厚度与高亮边框均落在测量bounds内", () => {
  const tiles = [
    { x: -9, y: 4 },
    { x: -1, y: 4 },
    { x: -4, y: 7 },
  ];
  const translated = tiles.map((tile) => ({ x: tile.x + 21, y: tile.y - 17 }));
  const original = localLayout(tiles),
    shifted = localLayout(translated);
  assertFitsActualBodies(tiles, original);
  assertFitsActualBodies(translated, shifted);
  assert.ok(Math.abs(original.pixelsPerWorldUnit - shifted.pixelsPerWorldUnit) < 1e-8);
  const originalCss = boardBoundsCss(original),
    shiftedCss = boardBoundsCss(shifted);
  for (const field of ["minX", "maxX", "minY", "maxY"] as const)
    assert.ok(Math.abs(originalCss[field] - shiftedCss[field]) < 1e-7);
  assert.ok(projectedBoardBounds([{ x: 0, y: 0 }]).width >= TELEVISION.outlineWidth);
});

test("窄窗口先采用收起侧栏的内边距；无法同时全盘可见时保留44px并报告扩大窗口", () => {
  assert.deepEqual(defaultViewportInsets(1250), { left: 206, right: 16, top: 0, bottom: 0 });
  assert.deepEqual(defaultViewportInsets(1023), { left: 174, right: 16, top: 0, bottom: 0 });
  assertFitsActualBodies(grid(9, 9), localLayout(grid(9, 9), 1024, 516, 0.75));
  const tiny = localLayout(grid(9, 9), 480, 220, 0.75);
  assert.equal(tiny.fitsBoard, false);
  assert.equal(tiny.requiresExpandedViewport, true);
  assert.ok(tiny.targetCss.minimum >= 44 - 1e-9);
  const custom = fitBoardLayout({
    width: 1366,
    height: 644,
    tiles: grid(7, 7),
    focus: { x: 0, y: 0 },
    local: true,
    zoom: 1,
    insets: { left: 300, right: 220, top: 24, bottom: 40 },
  });
  assertFitsActualBodies(grid(7, 7), custom);
});

test("镜头在90ms抵达并给输入和呈现留余量，30/60/120帧轨迹一致，低动态即时且可连续改目标", () => {
  const from = { x: -2, y: 8 },
    target = { x: 4, y: -3 };
  for (const fps of [30, 60, 120]) {
    for (let elapsed = 0; elapsed < 90; elapsed += 1000 / fps) {
      const point = cameraFocusAt(from, target, 1000, 1000 + elapsed);
      assert.ok(point.x >= from.x && point.x <= target.x);
      assert.ok(point.y <= from.y && point.y >= target.y);
    }
    assert.notDeepEqual(cameraFocusAt(from, target, 1000, 1089), target);
    assert.deepEqual(cameraFocusAt(from, target, 1000, 1090), target);
    assert.deepEqual(cameraFocusAt(from, target, 1000, 2000), target);
  }
  assert.deepEqual(cameraFocusAt(from, target, 1000, 999), from);
  assert.deepEqual(cameraFocusAt(from, target, 1000, 1000, true), target);
  const displayed = cameraFocusAt(from, target, 1000, 1060);
  assert.deepEqual(cameraFocusAt(displayed, from, 1060, 1060), displayed);
  assert.deepEqual(cameraFocusAt(displayed, from, 1060, 1160), from);
});

test("布局计算不改输入，拒绝非有限画布/坐标/边距而不产生坏相机矩阵", () => {
  const request: BoardLayoutRequest = {
    width: 1366,
    height: 644,
    tiles: grid(5, 5),
    focus: { x: 0, y: 0 },
    local: true,
    zoom: 1,
  };
  const original = structuredClone(request);
  fitBoardLayout(request);
  assert.deepEqual(request, original);
  for (const change of [
    { width: 0 },
    { height: NaN },
    { zoom: Infinity },
    { tiles: [{ x: Infinity, y: 0 }] },
    { insets: { left: -1, right: 0, top: 0, bottom: 0 } },
  ])
    assert.throws(() => fitBoardLayout({ ...request, ...change }), RangeError);
});
