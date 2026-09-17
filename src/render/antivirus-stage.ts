import * as THREE from "three";
import { FirewallStage } from "./firewall-stage.ts";
import type { BoardProjection } from "../core/projection.ts";

/** AR-B-ANTIVIRUS: reuse only the television casing, replacing the score display with waves. */
export class AntivirusStage {
  private readonly casing = new FirewallStage();
  readonly group = this.casing.group;
  private readonly canvas = document.createElement("canvas");
  private readonly context: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private readonly material: THREE.MeshBasicMaterial;
  private value: NonNullable<BoardProjection["antivirus"]> | null = null;
  private reducedMotion = false;
  private stamp = "";

  constructor() {
    this.canvas.width = 768;
    this.canvas.height = 640;
    const context = this.canvas.getContext("2d");
    if (!context) throw new Error("无法建立杀毒波形屏。");
    this.context = context;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.material = new THREE.MeshBasicMaterial({ map: this.texture });
    this.group.name = "antivirus-waveform-televisions";
    this.group.traverse((object) => {
      if (object instanceof THREE.Mesh && object.name === "combo-screen") {
        object.material = this.material;
        object.name = "antivirus-waveform-screen";
      }
    });
  }

  update(value: NonNullable<BoardProjection["antivirus"]>, reducedMotion: boolean): void {
    this.value = value;
    this.reducedMotion = reducedMotion;
  }

  frame(now: number): void {
    if (!this.value) return;
    const phase = this.reducedMotion ? 0 : Math.floor(now / 160) % 64;
    const { score, targetScore, activeCount, maxActiveCorruption } = this.value;
    const stamp = `${score}:${targetScore}:${activeCount}:${maxActiveCorruption}:${phase}`;
    if (stamp === this.stamp) return;
    this.stamp = stamp;
    const ctx = this.context,
      width = this.canvas.width,
      height = this.canvas.height;
    ctx.fillStyle = "#101c38";
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "#465f8438";
    ctx.lineWidth = 1;
    for (let x = 0; x <= width; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y <= height; y += 32) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    const fill = Math.min(1, score / targetScore);
    const gradient = ctx.createLinearGradient(0, height, 0, 0);
    gradient.addColorStop(0, "#a4dbecaa");
    gradient.addColorStop(0.6, "#468ac566");
    gradient.addColorStop(1, "#21407522");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, height * (1 - fill), width, height * fill);
    const center = 300;
    for (let x = 12; x < width - 10; x += 5) {
      const envelope =
        90 + Math.abs(Math.sin(x / 49 + phase / 14)) * 102 + Math.abs(Math.sin(x / 19)) * 42;
      ctx.strokeStyle = x % 3 ? "#88c6e37d" : "#e2f0f8a8";
      ctx.beginPath();
      ctx.moveTo(x, center - envelope);
      ctx.lineTo(x, center + envelope);
      ctx.stroke();
    }
    ctx.fillStyle = "#091325dc";
    ctx.fillRect(0, 542, width, 98);
    ctx.textAlign = "center";
    ctx.font = '700 35px "Camellia Numbers", sans-serif';
    ctx.fillStyle = "#d2eafb";
    ctx.fillText(`${score} / ${targetScore}`, width / 2, 604);
    ctx.fillStyle = "#a3dced";
    ctx.fillRect(20, 530, (width - 40) * fill, 5);
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.casing.dispose();
    this.material.dispose();
    this.texture.dispose();
    this.canvas.width = this.canvas.height = 1;
  }
}
