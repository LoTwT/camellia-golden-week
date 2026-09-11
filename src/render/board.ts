import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { BoardProjection, ScreenTile } from "../core/projection.ts";
import type { GameSettings } from "../core/types.ts";
import {
  boardBoundsCss,
  cameraFocusAt,
  fitBoardLayout,
  MOVEMENT_TRANSITION_MS,
  TELEVISION,
} from "./layout.ts";
import type { BoardLayout, Point2, ViewportInsets } from "./layout.ts";

const MAX_TILES = 2048;
const ICON_VARIANTS = [
  ["player-idle", "player-move"],
  ["supply-ready", "supply-collected"],
  ["data-ready", "data-collected"],
  ["door-closed", "door-open"],
  ["portal-locked", "portal-ready"],
  ["enrichment-ready", "enrichment-used"],
  ["terminal-ready", "terminal-complete"],
  ["lamp-lit", "lamp-unlit"],
  ["signal-ball", "station"],
  ["data-object", "socket"],
] as const;

interface IconResource {
  mesh: THREE.InstancedMesh;
  texture: THREE.Texture | null;
  ready: Promise<void>;
  error: Error | null;
  released: boolean;
}

interface PlayerMovementMeasurement {
  boardId: string;
  startedAtMs: number;
  completedAtMs: number | null;
  durationMs: number | null;
  from: { tileId: string; x: number; y: number };
  to: { tileId: string; x: number; y: number };
  reducedMotion: boolean;
}

function requiredIcons(board: BoardProjection): Set<string> {
  const ids = new Set(
    board.tiles
      .flatMap((tile) => [tile.icon, tile.player ? "player-idle" : null])
      .filter((id): id is string => id !== null),
  );
  // Antivirus preparation has no spawned targets yet; warm only that board's fixed visual family.
  if (board.local && board.id.startsWith("b.antivirus."))
    for (const id of ["target-blue", "target-purple", "target-star"]) ids.add(id);
  for (const variants of ICON_VARIANTS)
    if (variants.some((id) => ids.has(id))) for (const id of variants) ids.add(id);
  return ids;
}

function makeGlassTextures(): { shading: THREE.CanvasTexture; reflection: THREE.CanvasTexture } {
  const shadingCanvas = document.createElement("canvas");
  shadingCanvas.width = shadingCanvas.height = 256;
  const context = shadingCanvas.getContext("2d");
  if (!context) throw new Error("无法建立电视玻璃纹理。");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, 256, 256);
  const vignette = context.createRadialGradient(128, 112, 40, 128, 128, 174);
  vignette.addColorStop(0, "#ffffff00");
  vignette.addColorStop(0.68, "#29223018");
  vignette.addColorStop(1, "#07040b88");
  context.fillStyle = vignette;
  context.fillRect(0, 0, 256, 256);
  context.fillStyle = "#25233510";
  for (let line = 0; line < 256; line += 3) context.fillRect(0, line, 256, 1);
  const reflectionCanvas = document.createElement("canvas");
  reflectionCanvas.width = reflectionCanvas.height = 256;
  const reflection = reflectionCanvas.getContext("2d");
  if (!reflection) throw new Error("无法建立电视反光纹理。");
  for (const [x, y, radius, opacity] of [
    [48, 36, 130, 0.14],
    [194, 94, 118, 0.1],
    [96, 190, 76, 0.04],
  ] as const) {
    const glow = reflection.createRadialGradient(x, y, 0, x, y, radius);
    glow.addColorStop(0, `rgba(192,185,219,${opacity})`);
    glow.addColorStop(1, "rgba(192,185,219,0)");
    reflection.fillStyle = glow;
    reflection.fillRect(0, 0, 256, 256);
  }
  const shadingTexture = new THREE.CanvasTexture(shadingCanvas);
  const reflectionTexture = new THREE.CanvasTexture(reflectionCanvas);
  shadingTexture.colorSpace = reflectionTexture.colorSpace = THREE.SRGBColorSpace;
  return { shading: shadingTexture, reflection: reflectionTexture };
}

function makeBackdrop(): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
  const grid = new THREE.PlaneGeometry(100, 100, 32, 32);
  const positions = grid.getAttribute("position");
  const random = (index: number) =>
    ((Math.imul(index + 17, 1103515245) + 12345) >>> 0) / 4294967296;
  for (let index = 0; index < positions.count; index++) {
    const x = positions.getX(index),
      y = positions.getY(index);
    if (Math.abs(x) < 49 && Math.abs(y) < 49) {
      positions.setXY(
        index,
        x + (random(index * 2) - 0.5) * 1.4,
        y + (random(index * 2 + 1) - 0.5) * 1.4,
      );
    }
  }
  const geometry = grid.toNonIndexed();
  grid.dispose();
  const palette = [
    "#6f6887",
    "#827897",
    "#9187a6",
    "#a198b5",
    "#827897",
    "#9187a6",
    "#bbb2cc",
    "#605a78",
  ];
  const colors = new Float32Array(geometry.getAttribute("position").count * 3);
  const color = new THREE.Color();
  for (let triangle = 0; triangle < colors.length / 9; triangle++) {
    color.set(palette[Math.floor(random(triangle * 7) * palette.length)]!);
    for (let vertex = 0; vertex < 3; vertex++) color.toArray(colors, triangle * 9 + vertex * 3);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const backdrop = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true }));
  backdrop.rotation.x = -Math.PI / 2;
  backdrop.position.y = -0.32;
  return backdrop;
}

export class BoardRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  private readonly backgroundScene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-5, 5, 4, -4, 0.1, 100);
  private readonly bodyGeometry = new RoundedBoxGeometry(
    TELEVISION.bodyWidth,
    TELEVISION.bodyHeight,
    TELEVISION.bodyDepth,
    2,
    0.055,
  );
  private readonly screenGeometry = new RoundedBoxGeometry(
    TELEVISION.screenWidth,
    TELEVISION.screenHeight,
    TELEVISION.screenDepth,
    3,
    0.045,
  );
  private readonly iconGeometry = new THREE.PlaneGeometry(1, 1);
  private readonly reflectionGeometry = new THREE.PlaneGeometry(0.81, 0.6);
  private readonly bodyMaterial = new THREE.MeshStandardMaterial({
    color: "#494455",
    roughness: 0.9,
    metalness: 0.12,
  });
  private readonly screenMaterial = new THREE.MeshBasicMaterial({ color: "#ffffff" });
  private readonly reflectionMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    depthWrite: false,
  });
  private readonly body = new THREE.InstancedMesh(this.bodyGeometry, this.bodyMaterial, MAX_TILES);
  private readonly screens = new THREE.InstancedMesh(
    this.screenGeometry,
    this.screenMaterial,
    MAX_TILES,
  );
  private readonly reflections = new THREE.InstancedMesh(
    this.reflectionGeometry,
    this.reflectionMaterial,
    MAX_TILES,
  );
  private readonly trimGeometry = new THREE.BoxGeometry(0.68, 0.022, 0.043);
  private readonly trimMaterial = new THREE.MeshBasicMaterial({ color: "#393443" });
  private readonly trims = new THREE.InstancedMesh(this.trimGeometry, this.trimMaterial, MAX_TILES);
  private readonly ledGeometry = new THREE.SphereGeometry(0.012, 6, 4);
  private readonly ledMaterial = new THREE.MeshBasicMaterial({ color: "#b5c6b8" });
  private readonly leds = new THREE.InstancedMesh(this.ledGeometry, this.ledMaterial, MAX_TILES);
  private readonly edgeGeometry = new THREE.BoxGeometry(0.8, 0.012, 0.012);
  private readonly edgeMaterial = new THREE.MeshBasicMaterial({ color: "#84788f" });
  private readonly edges = new THREE.InstancedMesh(this.edgeGeometry, this.edgeMaterial, MAX_TILES);
  private readonly controlGeometry = new THREE.BoxGeometry(0.05, 0.01, 0.014);
  private readonly controlMaterial = new THREE.MeshBasicMaterial({ color: "#aaa0b6" });
  private readonly controls = new THREE.InstancedMesh(
    this.controlGeometry,
    this.controlMaterial,
    MAX_TILES * 2,
  );
  private readonly glassTextures: ReturnType<typeof makeGlassTextures>;
  private readonly backdrop = makeBackdrop();
  private readonly icons = new Map<string, IconResource>();
  private readonly textureLoader = new THREE.TextureLoader();
  private readonly dummy = new THREE.Object3D();
  private readonly color = new THREE.Color();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly labelPosition = new THREE.Vector3();
  private readonly displayedCamera = new THREE.OrthographicCamera();
  private readonly displayedBody = new THREE.InstancedMesh(
    this.bodyGeometry,
    this.bodyMaterial,
    MAX_TILES,
  );
  private displayedTiles: ScreenTile[] = [];
  private displayedLayout: BoardLayout | null = null;
  private displayedFocus: Point2 = { x: 0, y: 0 };
  private hasPresented = false;
  private bodyDirty = true;
  private board: BoardProjection = { id: "", tiles: [], focus: { x: 0, y: 0 }, local: false };
  private layout: BoardLayout | null = null;
  private canvasSize = { width: 0, height: 0, pixelRatio: 0 };
  private viewportInsets: ViewportInsets | undefined;
  private focus: Point2 = { x: 0, y: 0 };
  private focusFrom: Point2 = { x: 0, y: 0 };
  private targetFocus: Point2 = { x: 0, y: 0 };
  private focusStartedAt = 0;
  private settings: GameSettings | null = null;
  private layoutStamp = "";
  private readonly selection: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  private readonly resizeObserver: ResizeObserver;
  private readonly onHit: (tileId: string) => void;
  private readonly labelLayer: HTMLElement;
  private labels: { element: HTMLElement; tile: ScreenTile }[] = [];
  private feedbackUntil = 0;
  private playerMotionUntil = 0;
  private lastPlayerMovement: PlayerMovementMeasurement | null = null;
  private preparationSequence = 0;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, labels: HTMLElement, onHit: (tileId: string) => void) {
    this.onHit = onHit;
    this.labelLayer = labels;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.setClearColor("#827897", 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.autoClear = false;
    this.renderer.info.autoReset = false;
    this.scene.add(new THREE.HemisphereLight("#ffffff", "#24202a", 2.6));
    const light = new THREE.DirectionalLight("#ffffff", 3);
    light.position.set(-5, 10, -6);
    this.scene.add(light);
    for (const mesh of [
      this.body,
      this.screens,
      this.reflections,
      this.trims,
      this.leds,
      this.edges,
      this.controls,
    ]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      this.scene.add(mesh);
    }
    this.reflections.renderOrder = 1;
    this.displayedBody.count = 0;
    this.glassTextures = makeGlassTextures();
    this.screenMaterial.map = this.glassTextures.shading;
    this.reflectionMaterial.map = this.glassTextures.reflection;
    this.backgroundScene.add(this.backdrop);
    const ring = new THREE.Shape();
    const outerX = TELEVISION.outlineWidth / 2,
      outerZ = TELEVISION.outlineDepth / 2;
    ring.moveTo(-outerX, -outerZ);
    ring.lineTo(outerX, -outerZ);
    ring.lineTo(outerX, outerZ);
    ring.lineTo(-outerX, outerZ);
    ring.closePath();
    const hole = new THREE.Path();
    hole.moveTo(-outerX + 0.017, -outerZ + 0.017);
    hole.lineTo(-outerX + 0.017, outerZ - 0.017);
    hole.lineTo(outerX - 0.017, outerZ - 0.017);
    hole.lineTo(outerX - 0.017, -outerZ + 0.017);
    hole.closePath();
    ring.holes.push(hole);
    this.selection = new THREE.Mesh(
      new THREE.ShapeGeometry(ring),
      new THREE.MeshBasicMaterial({ color: "#f7ed9b", side: THREE.DoubleSide }),
    );
    this.selection.rotation.x = -Math.PI / 2;
    this.selection.visible = false;
    this.scene.add(this.selection);
    canvas.addEventListener("pointerdown", this.handlePointer);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  setViewportInsets(
    insets: Pick<ViewportInsets, "left" | "right"> &
      Partial<Pick<ViewportInsets, "top" | "bottom">>,
  ): void {
    const normalized = {
      left: insets.left,
      right: insets.right,
      top: insets.top ?? 0,
      bottom: insets.bottom ?? 0,
    };
    if (Object.values(normalized).some((value) => !Number.isFinite(value) || value < 0))
      throw new RangeError("画布内边距必须有限且非负。");
    if (JSON.stringify(normalized) === JSON.stringify(this.viewportInsets)) return;
    this.viewportInsets = normalized;
    this.resize();
  }

  async prepare(
    board: BoardProjection,
    settings: GameSettings,
    options: { compile?: boolean } = {},
  ): Promise<void> {
    const sequence = ++this.preparationSequence;
    const ids = requiredIcons(board);
    this.releaseUnusedIcons(ids);
    await Promise.all([...ids].map((id) => this.ensureIcon(id).ready));
    this.assertPreparation(sequence);
    this.update(board, settings);
    for (const id of ids) {
      const texture = this.icons.get(id)?.texture;
      if (texture) this.renderer.initTexture(texture);
    }
    if (options.compile !== false) {
      await this.renderer.compileAsync(this.backgroundScene, this.camera);
      await this.renderer.compileAsync(this.scene, this.camera);
    }
    this.assertPreparation(sequence);
    this.frame(performance.now());
  }

  private assertPreparation(sequence: number): void {
    if (this.disposed || sequence !== this.preparationSequence)
      throw new DOMException("较早的棋盘准备已被取代。", "AbortError");
  }

  private ensureIcon(id: string): IconResource {
    const existing = this.icons.get(id);
    if (existing) return existing;
    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.InstancedMesh(this.iconGeometry, material, MAX_TILES);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.visible = false;
    mesh.renderOrder = 2;
    const resource: IconResource = {
      mesh,
      texture: null,
      ready: Promise.resolve(),
      error: null,
      released: false,
    };
    this.icons.set(id, resource);
    this.scene.add(mesh);
    resource.ready = this.textureLoader
      .loadAsync(`/assets/icons/${id}.png`)
      .then((texture) => {
        if (resource.released || this.disposed) {
          texture.dispose();
          return;
        }
        texture.colorSpace = THREE.SRGBColorSpace;
        resource.texture = texture;
        material.map = texture;
        material.needsUpdate = true;
        mesh.visible = true;
      })
      .catch((cause: unknown) => {
        const error = new Error(`本地棋盘图标加载失败：${id}`, { cause });
        resource.error = error;
        throw error;
      });
    // Synchronous updates can start loads; prepare/frame surface their failures to main.
    void resource.ready.catch(() => {});
    return resource;
  }

  private releaseUnusedIcons(required: ReadonlySet<string>): void {
    for (const [id, resource] of this.icons) {
      if (required.has(id)) continue;
      resource.released = true;
      this.scene.remove(resource.mesh);
      (resource.mesh.material as THREE.Material).dispose();
      resource.mesh.dispose();
      resource.texture?.dispose();
      this.icons.delete(id);
    }
  }

  private handlePointer = (event: PointerEvent) => {
    if (event.button !== 0 || !event.isPrimary) return;
    this.renderer.domElement.focus({ preventScroll: true });
    const tileId = this.pick(event.clientX, event.clientY);
    if (tileId) this.onHit(tileId);
  };

  pick(clientX: number, clientY: number): string | null {
    if (!this.hasPresented || !this.displayedLayout || this.disposed) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const x = ((clientX - rect.left) / rect.width) * this.displayedLayout.canvas.width;
    const y = ((clientY - rect.top) / rect.height) * this.displayedLayout.canvas.height;
    const available = this.displayedLayout.available;
    if (
      x < available.left ||
      x > available.left + available.width ||
      y < available.top ||
      y > available.top + available.height
    )
      return null;
    this.pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.displayedCamera);
    const hit = this.raycaster.intersectObject(this.displayedBody, false)[0];
    const tile = hit?.instanceId === undefined ? undefined : this.displayedTiles[hit.instanceId];
    return tile?.known ? tile.id : null;
  }

  private resize(snapFocus = false): void {
    if (this.disposed) return;
    const canvas = this.renderer.domElement;
    const width = canvas.clientWidth,
      height = canvas.clientHeight;
    if (!width || !height) return;
    const pixelRatio = Math.min(window.devicePixelRatio, this.settings?.quality === "low" ? 1 : 2);
    if (
      width !== this.canvasSize.width ||
      height !== this.canvasSize.height ||
      pixelRatio !== this.canvasSize.pixelRatio
    ) {
      if (pixelRatio !== this.canvasSize.pixelRatio) this.renderer.setPixelRatio(pixelRatio);
      this.renderer.setSize(width, height, false);
      this.canvasSize = { width, height, pixelRatio };
      this.hasPresented = false;
    }
    this.layout = fitBoardLayout({
      width,
      height,
      tiles: this.board.tiles,
      focus: this.board.focus,
      local: this.board.local,
      zoom: this.settings?.zoom ?? 1,
      ...(this.viewportInsets ? { insets: this.viewportInsets } : {}),
    });
    if (snapFocus || this.settings?.reducedMotion) {
      this.focus = this.layout.focus;
      this.focusFrom = this.focus;
      this.targetFocus = this.focus;
    } else if (
      this.targetFocus.x !== this.layout.focus.x ||
      this.targetFocus.y !== this.layout.focus.y
    ) {
      this.focusFrom = this.focus;
      this.targetFocus = this.layout.focus;
      this.focusStartedAt = performance.now();
    }
    Object.assign(this.camera, this.layout.camera);
    this.camera.updateProjectionMatrix();
    this.positionCamera();
  }

  update(board: BoardProjection, settings: GameSettings): void {
    if (this.disposed) return;
    if (board.tiles.length > MAX_TILES) throw new RangeError("棋盘超过实例容量。");
    const newBoard = this.board.id !== board.id;
    const previousPlayer = this.board.tiles.find((tile) => tile.player);
    const player = board.tiles.find((tile) => tile.player);
    if (!newBoard && player?.id !== previousPlayer?.id) {
      const startedAtMs = performance.now();
      this.playerMotionUntil = startedAtMs + MOVEMENT_TRANSITION_MS;
      this.lastPlayerMovement =
        player &&
        previousPlayer &&
        Math.abs(player.x - previousPlayer.x) + Math.abs(player.y - previousPlayer.y) === 1
          ? {
              boardId: board.id,
              startedAtMs,
              completedAtMs: null,
              durationMs: null,
              from: { tileId: previousPlayer.id, x: previousPlayer.x, y: previousPlayer.y },
              to: { tileId: player.id, x: player.x, y: player.y },
              reducedMotion: settings.reducedMotion,
            }
          : null;
    }
    if (newBoard) this.lastPlayerMovement = null;
    if (newBoard || settings.reducedMotion) this.playerMotionUntil = 0;
    this.settings = settings;
    this.board = board;
    if (newBoard) this.releaseUnusedIcons(requiredIcons(board));
    this.edges.visible = this.controls.visible = settings.quality !== "low";
    const stamp = `${board.id}|${JSON.stringify(board.tiles)}`;
    if (stamp !== this.layoutStamp) {
      this.layoutStamp = stamp;
      this.bodyDirty = true;
      for (const mesh of [
        this.body,
        this.screens,
        this.reflections,
        this.trims,
        this.leds,
        this.edges,
      ])
        mesh.count = board.tiles.length;
      this.controls.count = board.tiles.length * 2;
      this.selection.visible = player !== undefined;
      const iconGroups = new Map<string, ScreenTile[]>();
      board.tiles.forEach((tile, index) => {
        const x = tile.x * TELEVISION.stepX,
          z = tile.y * TELEVISION.stepZ;
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.scale.setScalar(1);
        this.dummy.position.set(x, 0, z);
        this.dummy.updateMatrix();
        this.body.setMatrixAt(index, this.dummy.matrix);
        this.body.setColorAt(index, this.color.set(tile.known ? "#98939f" : "#55505a"));
        this.dummy.position.set(x, TELEVISION.screenY, z + TELEVISION.screenOffsetZ);
        this.dummy.updateMatrix();
        this.screens.setMatrixAt(index, this.dummy.matrix);
        this.screens.setColorAt(index, this.color.set(tile.player ? "#e2e1dc" : tile.color));
        this.dummy.position.y = 0.164;
        this.dummy.rotation.x = -Math.PI / 2;
        this.dummy.updateMatrix();
        this.reflections.setMatrixAt(index, this.dummy.matrix);
        this.reflections.setColorAt(
          index,
          this.color.set(
            !tile.known || tile.icon === "ghost" || tile.icon === "lamp-unlit"
              ? "#403a50"
              : "#ffffff",
          ),
        );
        this.dummy.rotation.x = 0;
        this.dummy.position.set(x, 0.132, z + 0.31);
        this.dummy.updateMatrix();
        this.trims.setMatrixAt(index, this.dummy.matrix);
        this.dummy.position.set(x + 0.26, 0.148, z + 0.31);
        this.dummy.updateMatrix();
        this.leds.setMatrixAt(index, this.dummy.matrix);
        this.dummy.position.set(x, 0.115, z - 0.368);
        this.dummy.updateMatrix();
        this.edges.setMatrixAt(index, this.dummy.matrix);
        for (let control = 0; control < 2; control++) {
          this.dummy.position.set(x - 0.26 + control * 0.085, 0.148, z + 0.31);
          this.dummy.updateMatrix();
          this.controls.setMatrixAt(index * 2 + control, this.dummy.matrix);
        }
        const ids = tile.player ? ["player-idle", "player-move"] : tile.icon ? [tile.icon] : [];
        for (const id of ids) {
          const group = iconGroups.get(id) ?? [];
          group.push(tile);
          iconGroups.set(id, group);
        }
        if (tile.player) this.selection.position.set(x, TELEVISION.outlineY, z);
      });
      for (const mesh of [
        this.body,
        this.screens,
        this.reflections,
        this.trims,
        this.leds,
        this.edges,
        this.controls,
      ]) {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingSphere();
      }
      for (const resource of this.icons.values()) resource.mesh.count = 0;
      for (const [id, group] of iconGroups) {
        const resource = this.ensureIcon(id),
          mesh = resource.mesh;
        mesh.count = group.length;
        group.forEach((tile, index) => {
          this.dummy.position.set(
            tile.x * TELEVISION.stepX,
            0.178,
            tile.y * TELEVISION.stepZ + TELEVISION.screenOffsetZ,
          );
          this.dummy.rotation.set(-Math.PI / 2, 0, 0);
          this.dummy.scale.setScalar(tile.player ? 0.68 : 0.64);
          this.dummy.updateMatrix();
          mesh.setMatrixAt(index, this.dummy.matrix);
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
      }
      this.labelLayer.replaceChildren();
      this.labels = board.tiles
        .filter((tile) => tile.mark)
        .map((tile) => {
          const element = document.createElement("span");
          element.className = "tile-mark";
          element.textContent = tile.mark;
          element.dataset.tileId = tile.id;
          this.labelLayer.append(element);
          return { element, tile };
        });
    }
    this.resize(newBoard);
  }

  flash(now: number): void {
    this.feedbackUntil = now + 140;
  }

  private positionCamera(): void {
    const z = this.focus.y / Math.sin(TELEVISION.cameraAngleRadians);
    this.camera.position.set(this.focus.x, 20, z + 20 / Math.tan(TELEVISION.cameraAngleRadians));
    this.camera.lookAt(this.focus.x, 0, z);
    this.camera.updateMatrixWorld();
  }

  frame(now: number): void {
    if (this.disposed || !this.layout) return;
    this.focus = cameraFocusAt(
      this.focusFrom,
      this.targetFocus,
      this.focusStartedAt,
      now,
      this.settings?.reducedMotion,
    );
    this.positionCamera();
    this.selection.material.color.set(
      !this.settings?.reducedFlash && now < this.feedbackUntil ? "#ffffff" : "#f7ed9b",
    );
    for (const [id, resource] of this.icons) {
      if (resource.error && resource.mesh.count) throw resource.error;
      const moving = !this.settings?.reducedMotion && now < this.playerMotionUntil;
      resource.mesh.visible =
        resource.texture !== null &&
        (id === "player-idle" ? !moving : id === "player-move" ? moving : true);
    }
    this.renderer.info.reset();
    this.renderer.setScissorTest(false);
    this.renderer.clear();
    this.renderer.render(this.backgroundScene, this.camera);
    this.renderer.clearDepth();
    const available = this.layout.available;
    this.renderer.setScissor(
      available.left,
      this.layout.canvas.height - available.top - available.height,
      available.width,
      available.height,
    );
    this.renderer.setScissorTest(true);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setScissorTest(false);
    this.displayedCamera.copy(this.camera);
    if (this.bodyDirty) {
      this.displayedBody.count = this.body.count;
      this.displayedBody.instanceMatrix.array.set(this.body.instanceMatrix.array);
      this.displayedBody.matrixWorld.copy(this.body.matrixWorld);
      this.displayedBody.computeBoundingSphere();
      this.displayedTiles = [...this.board.tiles];
      this.bodyDirty = false;
    }
    this.displayedLayout = this.layout;
    this.displayedFocus = this.focus;
    this.hasPresented = true;
    for (const { element, tile } of this.labels) {
      this.labelPosition
        .set(tile.x * TELEVISION.stepX + 0.27, 0.2, tile.y * TELEVISION.stepZ + 0.2)
        .project(this.camera);
      const x = ((this.labelPosition.x + 1) / 2) * this.layout.canvas.width;
      const y = ((1 - this.labelPosition.y) / 2) * this.layout.canvas.height;
      const area = this.layout.available;
      element.style.visibility =
        x < area.left || x > area.left + area.width || y < area.top || y > area.top + area.height
          ? "hidden"
          : "visible";
      element.style.transform = `translate(${x}px, ${y}px)`;
    }
    const movement = this.lastPlayerMovement;
    if (movement && movement.completedAtMs === null) {
      const idlePlayer = this.icons.get("player-idle")?.mesh;
      const movingPlayer = this.icons.get("player-move")?.mesh;
      const focusTolerance =
        Number.EPSILON * Math.max(1, Math.abs(this.targetFocus.x), Math.abs(this.targetFocus.y));
      if (
        idlePlayer?.visible &&
        idlePlayer.count > 0 &&
        !movingPlayer?.visible &&
        (this.settings?.reducedMotion || now >= this.playerMotionUntil) &&
        Math.abs(this.focus.x - this.targetFocus.x) <= focusTolerance &&
        Math.abs(this.focus.y - this.targetFocus.y) <= focusTolerance
      ) {
        const completedAtMs = performance.now();
        movement.completedAtMs = completedAtMs;
        movement.durationMs = completedAtMs - movement.startedAtMs;
      }
    }
  }

  metrics() {
    return {
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      calls: this.renderer.info.render.calls,
      tileCount: this.board.tiles.length,
      residentIconCount: this.icons.size,
      pendingIconCount: [...this.icons.values()].filter(
        (resource) => !resource.texture && !resource.error,
      ).length,
      lastPlayerMovement: this.lastPlayerMovement
        ? {
            ...this.lastPlayerMovement,
            from: { ...this.lastPlayerMovement.from },
            to: { ...this.lastPlayerMovement.to },
          }
        : null,
      layout: this.displayedLayout
        ? {
            ...this.displayedLayout,
            boardBoundsCss: boardBoundsCss(this.displayedLayout, this.displayedFocus),
            displayedFocus: { ...this.displayedFocus },
            devicePixelRatio: this.renderer.getPixelRatio(),
          }
        : null,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.preparationSequence += 1;
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener("pointerdown", this.handlePointer);
    this.releaseUnusedIcons(new Set());
    for (const geometry of [
      this.bodyGeometry,
      this.screenGeometry,
      this.iconGeometry,
      this.reflectionGeometry,
      this.trimGeometry,
      this.ledGeometry,
      this.edgeGeometry,
      this.controlGeometry,
      this.backdrop.geometry,
      this.selection.geometry,
    ])
      geometry.dispose();
    for (const material of [
      this.bodyMaterial,
      this.screenMaterial,
      this.reflectionMaterial,
      this.trimMaterial,
      this.ledMaterial,
      this.edgeMaterial,
      this.controlMaterial,
      this.backdrop.material,
      this.selection.material,
    ])
      material.dispose();
    this.glassTextures.shading.dispose();
    this.glassTextures.reflection.dispose();
    for (const mesh of [
      this.body,
      this.screens,
      this.reflections,
      this.trims,
      this.leds,
      this.edges,
      this.controls,
      this.displayedBody,
    ])
      mesh.dispose();
    this.labelLayer.replaceChildren();
    this.labels = [];
    this.renderer.dispose();
  }
}
