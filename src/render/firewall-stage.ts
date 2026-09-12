import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { TELEVISION } from "./layout.ts";

import type { FirewallJudgment } from "../core/firewall-feedback.ts";

const SCREEN_WIDTH = 1024;
const SCREEN_HEIGHT = 768;
const SCORE_FONT = '700 530px "Camellia Numbers", sans-serif';
const BODY_WIDTH = 2.2 * TELEVISION.stepX;
const BODY_DEPTH = 2 * TELEVISION.stepZ - 0.016;

function createCanvas(): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = SCREEN_WIDTH;
  canvas.height = SCREEN_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to initialize firewall score texture.");
  return { canvas, context };
}

function createGlassBackground(): HTMLCanvasElement {
  const { canvas, context } = createCanvas();
  const base = context.createLinearGradient(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
  base.addColorStop(0, "#333246");
  base.addColorStop(0.5, "#292839");
  base.addColorStop(1, "#242334");
  context.fillStyle = base;
  context.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

  context.fillStyle = "#73718745";
  context.beginPath();
  context.moveTo(20, 518);
  context.bezierCurveTo(160, 400, 87, 271, 276, 245);
  context.bezierCurveTo(348, 232, 317, 109, 431, 36);
  context.lineTo(619, 12);
  context.bezierCurveTo(557, 145, 648, 275, 502, 355);
  context.bezierCurveTo(419, 392, 479, 506, 358, 553);
  context.bezierCurveTo(249, 585, 353, 696, 233, 756);
  context.lineTo(14, 756);
  context.closePath();
  context.fill();

  context.fillStyle = "#89829822";
  context.beginPath();
  context.moveTo(803, 25);
  context.bezierCurveTo(696, 204, 884, 270, 782, 425);
  context.bezierCurveTo(689, 538, 894, 586, 808, 747);
  context.lineTo(1005, 747);
  context.lineTo(1005, 25);
  context.closePath();
  context.fill();

  const reflection = context.createRadialGradient(267, 97, 12, 310, 130, 650);
  reflection.addColorStop(0, "#bab4d326");
  reflection.addColorStop(0.38, "#aca8bd10");
  reflection.addColorStop(1, "#b9b3d000");
  context.fillStyle = reflection;
  context.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
  context.fillStyle = "#c2bdd01b";
  for (let y = 8; y < SCREEN_HEIGHT; y += 7)
    for (let x = 6; x < SCREEN_WIDTH; x += 7) context.fillRect(x, y, 2, 3);

  const rim = context.createLinearGradient(0, 0, 0, SCREEN_HEIGHT);
  rim.addColorStop(0, "#cbc5e035");
  rim.addColorStop(0.065, "#b8b1d206");
  rim.addColorStop(0.9, "#00000000");
  rim.addColorStop(1, "#00000058");
  context.fillStyle = rim;
  context.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
  return canvas;
}

function paintChromaticText(
  context: CanvasRenderingContext2D,
  value: string,
  y: number,
  maximumWidth: number,
  color: string,
): void {
  context.save();
  context.translate(SCREEN_WIDTH / 2, 0);
  context.scale(1.28, 1);
  context.lineJoin = "round";
  context.lineWidth = 12;
  context.strokeStyle = "#17141ff0";
  context.strokeText(value, 0, y, maximumWidth / 1.28);
  context.fillStyle = "#e26b626e";
  context.fillText(value, 5, y + 2, maximumWidth / 1.28);
  context.fillStyle = "#55c9e58c";
  context.fillText(value, -5, y, maximumWidth / 1.28);
  context.fillStyle = color;
  context.fillText(value, 0, y, maximumWidth / 1.28);
  context.restore();
}

/** Reconstructed from AR-A-FIREWALL: one large score television beside each pair of rows. */
export class FirewallStage {
  readonly group = new THREE.Group();
  private readonly screen = createCanvas();
  private readonly glassBackground = createGlassBackground();
  private readonly texture = new THREE.CanvasTexture(this.screen.canvas);
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private combo = -1;
  private judgment: FirewallJudgment = null;
  private fontAvailable = false;
  private disposed = false;

  constructor() {
    this.group.name = "firewall-score-televisions";
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;

    const bodyGeometry = new RoundedBoxGeometry(BODY_WIDTH, 0.3, BODY_DEPTH, 3, 0.045);
    const bezelGeometry = new RoundedBoxGeometry(
      BODY_WIDTH - 0.13,
      0.035,
      BODY_DEPTH - 0.19,
      3,
      0.032,
    );
    const screenGeometry = new THREE.PlaneGeometry(BODY_WIDTH - 0.2, BODY_DEPTH - 0.29);
    const edgeGeometry = new THREE.BoxGeometry(BODY_WIDTH - 0.09, 0.009, 0.012);
    const buttonGeometry = new THREE.BoxGeometry(0.064, 0.018, 0.021);
    const buttonInsetGeometry = new THREE.BoxGeometry(0.31, 0.011, 0.033);
    const ledGeometry = new THREE.SphereGeometry(0.008, 6, 4);
    const sideSeamGeometry = new THREE.BoxGeometry(0.014, 0.008, BODY_DEPTH - 0.09);
    this.geometries.push(
      bodyGeometry,
      bezelGeometry,
      screenGeometry,
      edgeGeometry,
      buttonGeometry,
      buttonInsetGeometry,
      ledGeometry,
      sideSeamGeometry,
    );

    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: "#302d3b",
      roughness: 0.82,
      metalness: 0.15,
    });
    const bezelMaterial = new THREE.MeshBasicMaterial({ color: "#16151f" });
    const screenMaterial = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true });
    const edgeMaterial = new THREE.MeshBasicMaterial({ color: "#676172" });
    const buttonMaterial = new THREE.MeshStandardMaterial({ color: "#514b5d", roughness: 0.75 });
    const ledMaterial = new THREE.MeshBasicMaterial({ color: "#91cbaa" });
    const sideSeamMaterial = new THREE.MeshBasicMaterial({ color: "#211e2b" });
    this.materials.push(
      bodyMaterial,
      bezelMaterial,
      screenMaterial,
      edgeMaterial,
      buttonMaterial,
      ledMaterial,
      sideSeamMaterial,
    );

    for (const [side, x] of [
      ["left", -1.62 * TELEVISION.stepX],
      ["right", 5.62 * TELEVISION.stepX],
    ] as const) {
      for (const [row, z] of [
        ["top", 0.5 * TELEVISION.stepZ],
        ["bottom", 2.5 * TELEVISION.stepZ],
      ] as const) {
        const television = new THREE.Group();
        television.name = `firewall-score-${side}-${row}`;
        television.position.set(x, 0, z);
        television.add(new THREE.Mesh(bodyGeometry, bodyMaterial));

        const bezel = new THREE.Mesh(bezelGeometry, bezelMaterial);
        bezel.position.set(0, 0.162, -0.033);
        const screen = new THREE.Mesh(screenGeometry, screenMaterial);
        screen.name = "combo-screen";
        screen.rotation.x = -Math.PI / 2;
        screen.position.set(0, 0.184, -0.046);
        television.add(bezel, screen);

        const upperEdge = new THREE.Mesh(edgeGeometry, edgeMaterial);
        upperEdge.position.set(0, 0.148, -BODY_DEPTH / 2 + 0.034);
        const lowerEdge = new THREE.Mesh(edgeGeometry, sideSeamMaterial);
        lowerEdge.position.set(0, 0.15, BODY_DEPTH / 2 - 0.025);
        television.add(upperEdge, lowerEdge);

        for (const seamX of [-1, 1]) {
          const seam = new THREE.Mesh(sideSeamGeometry, sideSeamMaterial);
          seam.position.set(seamX * (BODY_WIDTH / 2 - 0.035), 0.15, 0);
          television.add(seam);
        }

        const buttonInset = new THREE.Mesh(buttonInsetGeometry, bezelMaterial);
        buttonInset.position.set(0, 0.151, BODY_DEPTH / 2 - 0.084);
        television.add(buttonInset);
        for (const buttonX of [-0.1, 0, 0.1]) {
          const button = new THREE.Mesh(buttonGeometry, buttonMaterial);
          button.position.set(buttonX, 0.156, BODY_DEPTH / 2 - 0.084);
          television.add(button);
        }
        const led = new THREE.Mesh(ledGeometry, ledMaterial);
        led.position.set(BODY_WIDTH / 2 - 0.13, 0.157, BODY_DEPTH / 2 - 0.078);
        television.add(led);
        this.group.add(television);
      }
    }
    this.update(0, null);
  }

  update(combo: number, judgment: FirewallJudgment): void {
    if (this.disposed) return;
    const value = Number.isFinite(combo) ? Math.max(0, Math.floor(combo)) : 0;
    const fontAvailable = document.fonts.check(SCORE_FONT);
    if (value === this.combo && judgment === this.judgment && fontAvailable === this.fontAvailable)
      return;
    this.combo = value;
    this.judgment = judgment;
    this.fontAvailable = fontAvailable;
    this.paintScreen();
  }

  private paintScreen(): void {
    const { context } = this.screen;
    context.clearRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    context.save();
    context.beginPath();
    context.roundRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT, 32);
    context.clip();
    context.drawImage(this.glassBackground, 0, 0);
    context.textAlign = "center";
    context.textBaseline = "alphabetic";
    context.font = SCORE_FONT;
    paintChromaticText(context, String(this.combo), 622, 774, "#f5f1e6");
    context.font = '700 86px "Camellia Numbers", sans-serif';
    paintChromaticText(context, "COMBO", 720, 630, "#f0eedf");

    if (this.judgment) {
      const labels = { perfect: "PERFECT", miss: "MISS", hazardHit: "−5 COMBO", dodged: "DODGE" };
      const colors = {
        perfect: "#e4de94",
        miss: "#ef999e",
        hazardHit: "#ff879a",
        dodged: "#baf4df",
      };
      context.font = 'italic 700 74px "Camellia Numbers", sans-serif';
      paintChromaticText(context, labels[this.judgment], 169, 700, colors[this.judgment]);
    }

    context.fillStyle = "#18152223";
    for (let y = 0; y < SCREEN_HEIGHT; y += 5) context.fillRect(0, y, SCREEN_WIDTH, 1);
    const vignette = context.createRadialGradient(512, 363, 170, 512, 380, 650);
    vignette.addColorStop(0, "#0f0b1600");
    vignette.addColorStop(0.65, "#0f0b1610");
    vignette.addColorStop(1, "#0f0b16bb");
    context.fillStyle = vignette;
    context.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    context.restore();
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.group.removeFromParent();
    this.group.clear();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.texture.dispose();
    this.screen.canvas.width = this.screen.canvas.height = 1;
    this.glassBackground.width = this.glassBackground.height = 1;
  }
}
