import type { Direction, GameCommand } from "../core/types.ts";

const DIRECTIONS: Record<string, Direction> = {
  ArrowUp: "up",
  KeyW: "up",
  ArrowRight: "right",
  KeyD: "right",
  ArrowDown: "down",
  KeyS: "down",
  ArrowLeft: "left",
  KeyA: "left",
};
export class InputAdapter {
  private held: string[] = [];
  private suppressed = new Set<string>();
  private pending: Direction | null = null;
  private lastAcceptedAt = -Infinity;
  private nextRepeatAt = Infinity;
  private readonly target: HTMLCanvasElement;
  private readonly send: (command: GameCommand, time: number) => void;
  private readonly mode: () => { firewall: boolean; canPlay: boolean };
  private readonly openMap: () => void;
  private readonly pause: () => void;

  constructor(
    target: HTMLCanvasElement,
    send: (command: GameCommand, time: number) => void,
    mode: () => { firewall: boolean; canPlay: boolean },
    openMap: () => void,
    pause: () => void,
  ) {
    this.target = target;
    this.send = send;
    this.mode = mode;
    this.openMap = openMap;
    this.pause = pause;
    document.addEventListener("keydown", this.keydown);
    document.addEventListener("keyup", this.keyup);
  }
  private keydown = (event: KeyboardEvent) => {
    if (document.activeElement !== this.target || event.isComposing) return;
    const direction = DIRECTIONS[event.code];
    if (direction || ["KeyF", "KeyR", "KeyZ", "KeyM", "Escape"].includes(event.code))
      event.preventDefault();
    if (event.repeat || this.suppressed.has(event.code)) return;
    if (event.code === "Escape") {
      this.pause();
      return;
    }
    if (event.code === "KeyM") {
      this.openMap();
      return;
    }
    if (!this.mode().canPlay) return;
    const now = performance.now();
    if (direction) {
      this.held = this.held.filter((key) => key !== event.code);
      this.held.push(event.code);
      this.nextRepeatAt = now + 250;
      if (this.mode().firewall) {
        this.send({ kind: "Move", direction }, now);
        return;
      }
      this.move(direction, now);
    } else {
      const kind = ({ KeyF: "Interact", KeyR: "Amplify", KeyZ: "Undo" } as const)[
        event.code as "KeyF" | "KeyR" | "KeyZ"
      ];
      if (kind) this.send({ kind }, now);
    }
  };
  private keyup = (event: KeyboardEvent) => {
    this.held = this.held.filter((key) => key !== event.code);
    this.suppressed.delete(event.code);
    if (this.held.length === 0) this.nextRepeatAt = Infinity;
  };
  private move(direction: Direction, now: number) {
    if (now - this.lastAcceptedAt < 140) {
      this.pending = direction;
      return;
    }
    this.pending = null;
    this.lastAcceptedAt = now;
    this.send({ kind: "Move", direction }, now);
  }
  frame(now: number) {
    if (document.activeElement !== this.target || !this.mode().canPlay || this.mode().firewall)
      return;
    if (this.pending && now - this.lastAcceptedAt >= 140) {
      this.move(this.pending, now);
      return;
    }
    const held = this.held.at(-1);
    const direction = held ? DIRECTIONS[held] : undefined;
    if (direction && now >= this.nextRepeatAt) {
      this.nextRepeatAt = now + 140;
      this.move(direction, now);
    }
  }
  clear() {
    for (const key of this.held) this.suppressed.add(key);
    this.held = [];
    this.pending = null;
    this.nextRepeatAt = Infinity;
  }
  dispose() {
    document.removeEventListener("keydown", this.keydown);
    document.removeEventListener("keyup", this.keyup);
  }
}
