import type { Direction, GameCommand, GameState } from "../core/types.ts";

const MOVEMENT_INTERVAL_MS = 140;

export class AutoWalkScheduler {
  private nextStepAt = Infinity;

  observe(command: GameCommand, state: Pick<GameState, "mode" | "autoPath">, now: number) {
    if (state.mode !== "explore" || state.autoPath.length === 0) this.nextStepAt = Infinity;
    else if (command.kind === "ClickTile" || command.kind === "AdvanceAutoPath")
      this.nextStepAt = now + MOVEMENT_INTERVAL_MS;
  }

  nextCommand(now: number, canPlay: boolean): GameCommand | null {
    if (!canPlay || now < this.nextStepAt) return null;
    this.nextStepAt = now + MOVEMENT_INTERVAL_MS;
    return { kind: "AdvanceAutoPath" };
  }
}

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
  private pendingObservedAt = 0;
  private lastAcceptedAt = -Infinity;
  private nextRepeatAt = Infinity;
  private readonly target: HTMLCanvasElement;
  private readonly send: (command: GameCommand, time: number, observedAt?: number) => void;
  private readonly mode: () => { firewall: boolean; canPlay: boolean };
  private readonly openMap: () => void;
  private readonly pause: () => void;
  private readonly cancelAutoPath: (time: number) => void;

  constructor(
    target: HTMLCanvasElement,
    send: (command: GameCommand, time: number, observedAt?: number) => void,
    mode: () => { firewall: boolean; canPlay: boolean },
    openMap: () => void,
    pause: () => void,
    cancelAutoPath: (time: number) => void = () => {},
  ) {
    this.target = target;
    this.send = send;
    this.mode = mode;
    this.openMap = openMap;
    this.pause = pause;
    this.cancelAutoPath = cancelAutoPath;
    document.addEventListener("keydown", this.keydown);
    document.addEventListener("keyup", this.keyup);
    target.addEventListener("blur", this.blur);
  }
  private blur = () => this.clear();
  private keydown = (event: KeyboardEvent) => {
    if (
      document.activeElement !== this.target ||
      event.isComposing ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    )
      return;
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
      this.cancelAutoPath(now);
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
  private move(direction: Direction, now: number, observedAt = now) {
    if (now - this.lastAcceptedAt < MOVEMENT_INTERVAL_MS) {
      this.pending = direction;
      this.pendingObservedAt = observedAt;
      return;
    }
    this.pending = null;
    this.lastAcceptedAt = now;
    this.send({ kind: "Move", direction }, now, observedAt);
  }
  frame(now: number) {
    if (document.activeElement !== this.target || !this.mode().canPlay || this.mode().firewall)
      return;
    if (this.pending && now - this.lastAcceptedAt >= MOVEMENT_INTERVAL_MS) {
      this.move(this.pending, now, this.pendingObservedAt);
      return;
    }
    const held = this.held.at(-1);
    const direction = held ? DIRECTIONS[held] : undefined;
    if (direction && now >= this.nextRepeatAt) {
      this.nextRepeatAt = now + MOVEMENT_INTERVAL_MS;
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
    this.target.removeEventListener("blur", this.blur);
  }
}
