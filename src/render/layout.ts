export const TELEVISION = Object.freeze({
  stepX: 1,
  stepZ: 0.9,
  bodyWidth: 0.97,
  bodyHeight: 0.22,
  bodyDepth: 0.82,
  screenWidth: 0.82,
  screenHeight: 0.05,
  screenDepth: 0.62,
  screenY: 0.134,
  screenOffsetZ: -0.045,
  outlineWidth: 0.99,
  outlineDepth: 0.84,
  outlineY: 0.175,
  cameraAngleRadians: (75 * Math.PI) / 180,
});

export const MINIMUM_TILE_TARGET_CSS = 44;
export const MOVEMENT_TRANSITION_MS = 100;
export const COMPACT_BOARD_WIDTH_CSS = 1251;
const FIT_PADDING = 0.75;
const SIN_ANGLE = Math.sin(TELEVISION.cameraAngleRadians);
const COS_ANGLE = Math.cos(TELEVISION.cameraAngleRadians);

export interface Point2 {
  readonly x: number;
  readonly y: number;
}

export interface ViewportInsets {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

export interface Bounds2 {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly width: number;
  readonly height: number;
}

export interface BoardLayoutRequest {
  readonly width: number;
  readonly height: number;
  readonly tiles: readonly Point2[];
  readonly focus: Point2;
  readonly local: boolean;
  readonly zoom: number;
  readonly insets?: ViewportInsets;
  readonly fitPadding?: number;
}

export interface BoardLayout {
  readonly canvas: { readonly width: number; readonly height: number };
  readonly insets: ViewportInsets;
  readonly available: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  };
  readonly boardBounds: Bounds2;
  readonly focus: Point2;
  readonly pixelsPerWorldUnit: number;
  readonly camera: {
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
  };
  readonly requestedZoom: number;
  readonly effectiveZoom: number;
  readonly zoomLimited: boolean;
  readonly targetCss: { readonly width: number; readonly height: number; readonly minimum: number };
  readonly visibleColumns: number;
  readonly visibleRows: number;
  readonly fitsBoard: boolean;
  readonly requiresExpandedViewport: boolean;
  readonly compactViewport: boolean;
}

function bounds(minX: number, maxX: number, minY: number, maxY: number): Bounds2 {
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

export function defaultViewportInsets(width: number): ViewportInsets {
  if (width < 1024) return { left: 174, right: 16, top: 0, bottom: 0 };
  return width < COMPACT_BOARD_WIDTH_CSS
    ? { left: 206, right: 16, top: 0, bottom: 0 }
    : { left: 248, right: 202, top: 0, bottom: 0 };
}

/** Reference framing is 16:9; preserve the television proportions in wider/taller windows. */
export function firewallViewportInsets(width: number, height: number): ViewportInsets {
  const frameWidth = Math.min(width, (height * 16) / 9);
  const frameHeight = (frameWidth * 9) / 16;
  const horizontalMargin = (width - frameWidth) / 2;
  const verticalMargin = (height - frameHeight) / 2;
  return {
    left: horizontalMargin + frameWidth * 0.236,
    right: horizontalMargin + frameWidth * 0.236,
    top: verticalMargin + frameHeight * 0.185,
    bottom: verticalMargin + frameHeight * 0.157,
  };
}

export function projectGridPoint(point: Point2): Point2 {
  return { x: point.x * TELEVISION.stepX, y: point.y * TELEVISION.stepZ * SIN_ANGLE };
}

export function projectedBoardBounds(tiles: readonly Point2[]): Bounds2 {
  const centers = tiles.length ? tiles.map(projectGridPoint) : [{ x: 0, y: 0 }];
  if (centers.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y)))
    throw new RangeError("棋盘布局坐标必须有限。");
  const halfWidth = Math.max(TELEVISION.bodyWidth, TELEVISION.outlineWidth) / 2;
  const bodyHalfHeight = (TELEVISION.bodyDepth * SIN_ANGLE + TELEVISION.bodyHeight * COS_ANGLE) / 2;
  const top = Math.min(
    -bodyHalfHeight,
    (-TELEVISION.outlineDepth / 2) * SIN_ANGLE - TELEVISION.outlineY * COS_ANGLE,
    (TELEVISION.screenOffsetZ - TELEVISION.screenDepth / 2) * SIN_ANGLE -
      (TELEVISION.screenY + TELEVISION.screenHeight / 2) * COS_ANGLE,
  );
  return bounds(
    Math.min(...centers.map((point) => point.x)) - halfWidth,
    Math.max(...centers.map((point) => point.x)) + halfWidth,
    Math.min(...centers.map((point) => point.y)) + top,
    Math.max(...centers.map((point) => point.y)) + bodyHalfHeight,
  );
}

export function boardBoundsCss(layout: BoardLayout, focus = layout.focus): Bounds2 {
  const centerX = layout.available.left + layout.available.width / 2;
  const centerY = layout.available.top + layout.available.height / 2;
  const scale = layout.pixelsPerWorldUnit;
  return bounds(
    centerX + (layout.boardBounds.minX - focus.x) * scale,
    centerX + (layout.boardBounds.maxX - focus.x) * scale,
    centerY + (layout.boardBounds.minY - focus.y) * scale,
    centerY + (layout.boardBounds.maxY - focus.y) * scale,
  );
}

export function fitBoardLayout(request: BoardLayoutRequest): BoardLayout {
  if (
    !Number.isFinite(request.width) ||
    request.width <= 0 ||
    !Number.isFinite(request.height) ||
    request.height <= 0 ||
    !Number.isFinite(request.zoom) ||
    !Number.isFinite(request.focus.x) ||
    !Number.isFinite(request.focus.y)
  )
    throw new RangeError("画布尺寸、缩放和焦点必须有限且尺寸为正。");
  const insets = { ...(request.insets ?? defaultViewportInsets(request.width)) };
  const fitPadding = request.fitPadding ?? FIT_PADDING;
  if (!Number.isFinite(fitPadding) || fitPadding < 0)
    throw new RangeError("棋盘取景留白必须为有限非负数。");
  if (Object.values(insets).some((value) => !Number.isFinite(value) || value < 0))
    throw new RangeError("画布内边距必须为有限非负数。");
  const available = {
    left: insets.left,
    top: insets.top,
    width: Math.max(1, request.width - insets.left - insets.right),
    height: Math.max(1, request.height - insets.top - insets.bottom),
  };
  const boardBounds = projectedBoardBounds(request.tiles);
  const focus = request.local
    ? { x: (boardBounds.minX + boardBounds.maxX) / 2, y: (boardBounds.minY + boardBounds.maxY) / 2 }
    : projectGridPoint(request.focus);
  const requestedZoom = Math.max(0.75, Math.min(1.5, request.zoom));
  const bodyProjectedHeight = TELEVISION.bodyDepth * SIN_ANGLE + TELEVISION.bodyHeight * COS_ANGLE;
  const minimumScale = Math.max(
    MINIMUM_TILE_TARGET_CSS / TELEVISION.bodyWidth,
    MINIMUM_TILE_TARGET_CSS / bodyProjectedHeight,
  );
  const defaultScale = request.local
    ? Math.min(
        available.width / (boardBounds.width + fitPadding),
        available.height / (boardBounds.height + fitPadding),
      )
    : Math.min(
        available.width / (9 * TELEVISION.stepX),
        available.height / (7 * TELEVISION.stepZ * SIN_ANGLE),
      );
  const fullBoardScale = Math.max(
    0,
    Math.min(
      (available.width - 8) / boardBounds.width,
      (available.height - 8) / boardBounds.height,
    ),
  );
  const pixelsPerWorldUnit = Math.max(
    minimumScale,
    request.local
      ? Math.min(defaultScale * requestedZoom, fullBoardScale)
      : defaultScale * requestedZoom,
  );
  const centerX = available.left + available.width / 2;
  const centerY = available.top + available.height / 2;
  const targetCss = {
    width: TELEVISION.bodyWidth * pixelsPerWorldUnit,
    height: bodyProjectedHeight * pixelsPerWorldUnit,
    minimum: Math.min(TELEVISION.bodyWidth, bodyProjectedHeight) * pixelsPerWorldUnit,
  };
  const fitsBoard =
    boardBounds.width * pixelsPerWorldUnit <= available.width + 1e-8 &&
    boardBounds.height * pixelsPerWorldUnit <= available.height + 1e-8;
  const effectiveZoom = pixelsPerWorldUnit / defaultScale;
  return {
    canvas: { width: request.width, height: request.height },
    insets,
    available,
    boardBounds,
    focus,
    pixelsPerWorldUnit,
    camera: {
      left: -centerX / pixelsPerWorldUnit,
      right: (request.width - centerX) / pixelsPerWorldUnit,
      top: centerY / pixelsPerWorldUnit,
      bottom: -(request.height - centerY) / pixelsPerWorldUnit,
    },
    requestedZoom,
    effectiveZoom,
    zoomLimited: Math.abs(effectiveZoom - requestedZoom) > 1e-8,
    targetCss,
    visibleColumns: available.width / (pixelsPerWorldUnit * TELEVISION.stepX),
    visibleRows: available.height / (pixelsPerWorldUnit * TELEVISION.stepZ * SIN_ANGLE),
    fitsBoard,
    requiresExpandedViewport:
      (request.local && !fitsBoard) || available.width < 44 || available.height < 44,
    compactViewport: request.width < COMPACT_BOARD_WIDTH_CSS,
  };
}

export function cameraFocusAt(
  from: Point2,
  to: Point2,
  startedAt: number,
  now: number,
  reducedMotion = false,
): Point2 {
  const progress = reducedMotion
    ? 1
    : Math.max(0, Math.min(1, (now - startedAt) / MOVEMENT_TRANSITION_MS));
  const eased = 1 - (1 - progress) ** 3;
  return { x: from.x + (to.x - from.x) * eased, y: from.y + (to.y - from.y) * eased };
}
