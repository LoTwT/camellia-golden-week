import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { BoardProjection, ScreenTile } from "../core/projection.ts";
import type { GameSettings } from "../core/types.ts";

const MAX_TILES = 2048;
export class BoardRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-5, 5, 4, -4, 0.1, 100);
  private readonly bodyGeometry = new RoundedBoxGeometry(0.97, 0.22, 0.94, 2, 0.065);
  private readonly screenGeometry = new RoundedBoxGeometry(0.82, 0.06, 0.69, 3, 0.055);
  private readonly iconGeometry = new THREE.PlaneGeometry(0.78, 0.7);
  private readonly bodyMaterial = new THREE.MeshStandardMaterial({
    color: "#32313b",
    roughness: 0.9,
    metalness: 0.12,
  });
  private readonly screenMaterial = new THREE.MeshBasicMaterial({ color: "#ffffff" });
  private readonly body = new THREE.InstancedMesh(this.bodyGeometry, this.bodyMaterial, MAX_TILES);
  private readonly screens = new THREE.InstancedMesh(
    this.screenGeometry,
    this.screenMaterial,
    MAX_TILES,
  );
  private readonly trimGeometry = new THREE.BoxGeometry(0.68, 0.022, 0.05);
  private readonly trimMaterial = new THREE.MeshBasicMaterial({ color: "#17161c" });
  private readonly trims = new THREE.InstancedMesh(this.trimGeometry, this.trimMaterial, MAX_TILES);
  private readonly ledGeometry = new THREE.SphereGeometry(0.012, 6, 4);
  private readonly ledMaterial = new THREE.MeshBasicMaterial({ color: "#a0b8ac" });
  private readonly leds = new THREE.InstancedMesh(this.ledGeometry, this.ledMaterial, MAX_TILES);
  private readonly crtTexture: THREE.CanvasTexture;
  private readonly backdrop: THREE.Mesh;
  private readonly icons = new Map<string, THREE.InstancedMesh>();
  private readonly textures = new Map<string, THREE.Texture>();
  private readonly dummy = new THREE.Object3D();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private tiles: ScreenTile[] = [];
  private focus = new THREE.Vector2();
  private targetFocus = new THREE.Vector2();
  private settings: GameSettings | null = null;
  private local = false;
  private layoutStamp = "";
  private lastFrame = 0;
  private readonly selection: THREE.Mesh;
  private readonly resizeObserver: ResizeObserver;
  private readonly onHit: (tileId: string) => void;
  private readonly labelLayer: HTMLElement;
  private feedbackUntil = 0;

  constructor(canvas: HTMLCanvasElement, labels: HTMLElement, onHit: (tileId: string) => void) {
    this.onHit = onHit;
    this.labelLayer = labels;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.setClearColor("#635d77", 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.add(new THREE.HemisphereLight("#ffffff", "#24202a", 2.6));
    const light = new THREE.DirectionalLight("#ffffff", 3);
    light.position.set(-5, 10, -6);
    this.scene.add(light);
    this.body.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.screens.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.body.count = 0;
    this.screens.count = 0;
    this.trims.count = 0;
    this.leds.count = 0;
    this.scene.add(this.body, this.screens, this.trims, this.leds);
    const textureCanvas = document.createElement("canvas");
    textureCanvas.width = 256;
    textureCanvas.height = 256;
    const ctx = textureCanvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, 256, 256);
      const vignette = ctx.createRadialGradient(128, 112, 40, 128, 128, 174);
      vignette.addColorStop(0, "#ffffff00");
      vignette.addColorStop(0.68, "#29223020");
      vignette.addColorStop(1, "#07040bda");
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, 256, 256);
      ctx.fillStyle = "#c8c3e520";
      ctx.beginPath();
      ctx.moveTo(18, 18);
      ctx.lineTo(166, 18);
      ctx.lineTo(100, 65);
      ctx.lineTo(20, 80);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#2523351a";
      for (let line = 0; line < 256; line += 3) ctx.fillRect(0, line, 256, 1);
    }
    this.crtTexture = new THREE.CanvasTexture(textureCanvas);
    this.crtTexture.colorSpace = THREE.SRGBColorSpace;
    this.screenMaterial.map = this.crtTexture;
    const backdropGeometry = new THREE.PlaneGeometry(100, 100, 8, 8).toNonIndexed();
    const colors: number[] = [];
    const backdropPalette = ["#635f76", "#69647d", "#6d6781", "#605c73", "#756d88"];
    const count = backdropGeometry.getAttribute("position").count;
    for (let index = 0; index < count; index += 3) {
      const shade = new THREE.Color(
        backdropPalette[Math.floor(index / 3) % backdropPalette.length],
      );
      for (let vertex = 0; vertex < 3; vertex += 1) colors.push(shade.r, shade.g, shade.b);
    }
    backdropGeometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    this.backdrop = new THREE.Mesh(
      backdropGeometry,
      new THREE.MeshBasicMaterial({ vertexColors: true }),
    );
    this.backdrop.rotation.x = -Math.PI / 2;
    this.backdrop.position.y = -0.32;
    this.scene.add(this.backdrop);
    const ring = new THREE.Shape();
    ring.moveTo(-0.53, -0.52);
    ring.lineTo(0.53, -0.52);
    ring.lineTo(0.53, 0.52);
    ring.lineTo(-0.53, 0.52);
    ring.closePath();
    const hole = new THREE.Path();
    hole.moveTo(-0.48, -0.47);
    hole.lineTo(-0.48, 0.47);
    hole.lineTo(0.48, 0.47);
    hole.lineTo(0.48, -0.47);
    hole.closePath();
    ring.holes.push(hole);
    this.selection = new THREE.Mesh(
      new THREE.ShapeGeometry(ring),
      new THREE.MeshBasicMaterial({ color: "#f7ed9b", side: THREE.DoubleSide }),
    );
    this.selection.rotation.x = -Math.PI / 2;
    this.scene.add(this.selection);
    canvas.addEventListener("pointerdown", this.handlePointer);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  private handlePointer = (event: PointerEvent) => {
    if (event.button !== 0 || !event.isPrimary) return;
    const canvas = this.renderer.domElement;
    canvas.focus({ preventScroll: true });
    const rect = canvas.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObject(this.body, false)[0];
    const tile = hit?.instanceId === undefined ? undefined : this.tiles[hit.instanceId];
    if (tile?.known) this.onHit(tile.id);
  };

  private resize() {
    const canvas = this.renderer.domElement;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, this.settings?.quality === "low" ? 1 : 2),
    );
    this.renderer.setSize(width, height, false);
    const zoom = this.settings?.zoom ?? 1;
    const span = this.local
      ? Math.max(...this.tiles.map((tile) => tile.y), 4) -
        Math.min(...this.tiles.map((tile) => tile.y), 0) +
        2
      : 7.3;
    const vertical = Math.min(span / zoom, height / 48);
    const horizontal = (vertical * width) / height;
    this.camera.left = -horizontal / 2;
    this.camera.right = horizontal / 2;
    this.camera.top = vertical / 2;
    this.camera.bottom = -vertical / 2;
    this.camera.updateProjectionMatrix();
    this.positionCamera();
  }

  update(board: BoardProjection, settings: GameSettings) {
    const settingsChanged = JSON.stringify(this.settings) !== JSON.stringify(settings);
    const newBoard = this.layoutStamp.split("|")[0] !== board.id;
    this.settings = settings;
    this.local = board.local;
    const center = board.local
      ? {
          x:
            (Math.min(...board.tiles.map((tile) => tile.x)) +
              Math.max(...board.tiles.map((tile) => tile.x))) /
            2,
          y:
            (Math.min(...board.tiles.map((tile) => tile.y)) +
              Math.max(...board.tiles.map((tile) => tile.y))) /
            2,
        }
      : board.focus;
    this.targetFocus.set(center.x * 1.13, center.y * 1.13);
    if (newBoard || settings.reducedMotion) this.focus.copy(this.targetFocus);
    const stamp = `${board.id}|${JSON.stringify(board.tiles)}`;
    if (stamp !== this.layoutStamp) {
      this.layoutStamp = stamp;
      this.tiles = board.tiles;
      this.body.count = board.tiles.length;
      this.screens.count = board.tiles.length;
      this.trims.count = board.tiles.length;
      this.leds.count = board.tiles.length;
      const iconGroups = new Map<string, ScreenTile[]>();
      board.tiles.forEach((tile, index) => {
        this.dummy.position.set(tile.x * 1.13, 0, tile.y * 1.13);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.scale.setScalar(1);
        this.dummy.updateMatrix();
        this.body.setMatrixAt(index, this.dummy.matrix);
        this.body.setColorAt(index, new THREE.Color(tile.known ? "#98939f" : "#55505a"));
        this.dummy.position.y = 0.134;
        this.dummy.position.z -= 0.045;
        this.dummy.updateMatrix();
        this.screens.setMatrixAt(index, this.dummy.matrix);
        this.screens.setColorAt(index, new THREE.Color(tile.player ? "#e4dbb4" : tile.color));
        this.dummy.position.set(tile.x * 1.13, 0.132, tile.y * 1.13 + 0.365);
        this.dummy.updateMatrix();
        this.trims.setMatrixAt(index, this.dummy.matrix);
        this.dummy.position.x += 0.26;
        this.dummy.position.y = 0.148;
        this.dummy.updateMatrix();
        this.leds.setMatrixAt(index, this.dummy.matrix);
        const iconId = tile.player ? "player-idle" : tile.icon;
        if (iconId) {
          const group = iconGroups.get(iconId) ?? [];
          group.push(tile);
          iconGroups.set(iconId, group);
        }
        if (tile.player) this.selection.position.set(tile.x * 1.13, 0.175, tile.y * 1.13);
      });
      this.body.instanceMatrix.needsUpdate = true;
      this.screens.instanceMatrix.needsUpdate = true;
      this.trims.instanceMatrix.needsUpdate = true;
      this.leds.instanceMatrix.needsUpdate = true;
      if (this.body.instanceColor) this.body.instanceColor.needsUpdate = true;
      if (this.screens.instanceColor) this.screens.instanceColor.needsUpdate = true;
      this.body.computeBoundingSphere();
      this.screens.computeBoundingSphere();
      for (const mesh of this.icons.values()) mesh.count = 0;
      for (const [id, group] of iconGroups) {
        let mesh = this.icons.get(id);
        if (!mesh) {
          const texture = new THREE.TextureLoader().load(
            `/assets/icons/${id}.png`,
            undefined,
            undefined,
            () => {
              /* Missing optional icon remains a labeled screen. */
            },
          );
          texture.colorSpace = THREE.SRGBColorSpace;
          this.textures.set(id, texture);
          const material = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
          });
          mesh = new THREE.InstancedMesh(this.iconGeometry, material, MAX_TILES);
          mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          this.icons.set(id, mesh);
          this.scene.add(mesh);
        }
        mesh.count = group.length;
        group.forEach((tile, index) => {
          this.dummy.position.set(tile.x * 1.13, 0.178, tile.y * 1.13 - 0.045);
          this.dummy.rotation.set(-Math.PI / 2, 0, 0);
          this.dummy.scale.setScalar(tile.player ? 1.03 : 0.98);
          this.dummy.updateMatrix();
          mesh.setMatrixAt(index, this.dummy.matrix);
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
      }
      this.labelLayer.replaceChildren();
      for (const tile of board.tiles.filter((item) => item.mark)) {
        const label = document.createElement("span");
        label.className = "tile-mark";
        label.textContent = tile.mark;
        label.dataset.tileId = tile.id;
        this.labelLayer.append(label);
      }
    }
    if (settingsChanged || newBoard) this.resize();
  }

  flash(now: number) {
    this.feedbackUntil = now + 140;
  }

  private positionCamera() {
    this.camera.position.set(this.focus.x, 20, this.focus.y + 20 / Math.tan((75 * Math.PI) / 180));
    this.camera.lookAt(this.focus.x, 0, this.focus.y);
    this.camera.updateMatrixWorld();
  }

  frame(now: number) {
    const elapsed = Math.min(now - (this.lastFrame || now), 120);
    this.lastFrame = now;
    if (this.settings?.reducedMotion) this.focus.copy(this.targetFocus);
    else this.focus.lerp(this.targetFocus, Math.min(1, elapsed / 45));
    if (this.focus.distanceTo(this.targetFocus) < 0.005) this.focus.copy(this.targetFocus);
    this.positionCamera();
    const material = this.selection.material as THREE.MeshBasicMaterial;
    material.color.set(
      !this.settings?.reducedFlash && now < this.feedbackUntil ? "#ffffff" : "#f7ed9b",
    );
    this.renderer.render(this.scene, this.camera);
    for (const label of this.labelLayer.children) {
      if (!(label instanceof HTMLElement)) continue;
      const tile = this.tiles.find((candidate) => candidate.id === label.dataset.tileId);
      if (!tile) continue;
      const position = new THREE.Vector3(tile.x * 1.13 + 0.27, 0.2, tile.y * 1.13 + 0.24).project(
        this.camera,
      );
      label.style.transform = `translate(${((position.x + 1) / 2) * this.renderer.domElement.clientWidth}px, ${((1 - position.y) / 2) * this.renderer.domElement.clientHeight}px)`;
    }
  }

  metrics() {
    return {
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      calls: this.renderer.info.render.calls,
      tileCount: this.tiles.length,
    };
  }
  dispose() {
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener("pointerdown", this.handlePointer);
    for (const mesh of this.icons.values()) {
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    }
    for (const texture of this.textures.values()) texture.dispose();
    this.bodyGeometry.dispose();
    this.screenGeometry.dispose();
    this.iconGeometry.dispose();
    this.bodyMaterial.dispose();
    this.screenMaterial.dispose();
    this.crtTexture.dispose();
    this.trimGeometry.dispose();
    this.trimMaterial.dispose();
    this.ledGeometry.dispose();
    this.ledMaterial.dispose();
    this.trims.dispose();
    this.leds.dispose();
    this.backdrop.geometry.dispose();
    (this.backdrop.material as THREE.Material).dispose();
    this.body.dispose();
    this.screens.dispose();
    this.selection.geometry.dispose();
    (this.selection.material as THREE.Material).dispose();
    this.renderer.dispose();
  }
}
