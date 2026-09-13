import type { BoardProjection, ScreenTile } from "../core/projection.ts";

const GLYPHS: Record<string, string> = {
  "portal-ready":
    '<path d="M14 7H43V57H14Z" fill="#172733" stroke="#b9dcd4" stroke-width="3"/><path d="M25 30H54M44 21L55 30L44 39" fill="none" stroke="#b9dcd4" stroke-width="5"/>',
  "theft-ball":
    '<circle cx="32" cy="32" r="23" fill="currentColor" stroke="#dbe9fa" stroke-width="3"/><path d="M29 10C13 19 12 45 29 54M38 13C51 23 51 42 38 52" fill="none" stroke="#1a244f" stroke-width="6"/><ellipse cx="22" cy="27" rx="6" ry="10" fill="#eaf6ff"/>',
  "theft-base":
    '<path d="M15 7H49L58 16V48L49 57H15L6 48V16Z" fill="#838891" stroke="#eceddc" stroke-width="3"/><path d="M20 14H44L51 21V43L44 50H20L13 43V21Z" fill="#303647" stroke="#d8dccc" stroke-width="3"/><circle cx="32" cy="32" r="15" fill="currentColor"/><path d="M20 27H44M20 33H44M22 39H42" stroke="#dce9f985" stroke-width="2"/>',
  "theft-combined":
    '<path d="M12 17H52V55H12Z" fill="#596674" stroke="#dce7e9" stroke-width="3"/><path d="M9 46H55M19 54V59M45 54V59" stroke="#d8dfdd" stroke-width="4"/><circle cx="32" cy="26" r="18" fill="currentColor" stroke="#e7f3fa" stroke-width="3"/><path d="M35 12L24 28H32L28 42L42 23H34Z" fill="#f7f4d6"/>',
  "theft-socket":
    '<path d="M9 9H55V55H9Z" fill="#0e1620" stroke="currentColor" stroke-width="5"/><path d="M18 18H46V46H18Z" fill="#293540" stroke="#7b8991" stroke-width="3"/><path d="M25 25V35M39 25V35M25 32H39M32 35V43" fill="none" stroke="currentColor" stroke-width="4"/>',
  player:
    '<path d="M19 28C8 8 10 3 15 4C22 4 29 19 30 25M37 25C39 12 47 3 51 5C57 8 49 23 45 29" fill="#dadfdf" stroke="#1b2027" stroke-width="2"/><path d="M8 39C8 17 56 17 56 39V55H8Z" fill="#e6e9e4" stroke="#f8f7f0" stroke-width="3"/><path d="M12 39C12 25 52 25 52 39V49H12Z" fill="#242b32"/><path d="M20 39H27M37 39H44" stroke="#e9f0ef" stroke-width="3"/>',
};

export function theftGlyph(kind: string): string {
  const shape = GLYPHS[kind];
  return shape
    ? `<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">${shape}</svg>`
    : "";
}

/** A flat, square-cell terminal surface; no television geometry or world movement shortcuts. */
export class TheftPanel {
  readonly element = document.createElement("section");
  private readonly grid: HTMLElement;
  private readonly phase: HTMLElement;
  private readonly progress: HTMLElement;
  private stamp = "";
  private readonly canvas: HTMLCanvasElement;
  private readonly onHit: (tileId: string) => void;

  constructor(canvas: HTMLCanvasElement, onHit: (tileId: string) => void) {
    this.canvas = canvas;
    this.onHit = onHit;
    this.element.className = "theft-panel";
    this.element.hidden = true;
    this.element.setAttribute("aria-label", "数据盗取终端");
    this.element.innerHTML = `<aside class="theft-console theft-console-left"><div class="theft-console-title">DATA EXTRACTION<span>信号组装</span></div><div class="theft-console-display"><strong class="theft-phase"></strong><p>球持续滑行，遇同色基站组装。</p><div class="theft-key">${theftGlyph("theft-ball")}<span>信号球<strong>连续滑行</strong></span></div><div class="theft-key">${theftGlyph("theft-base")}<span>基站<strong>不能单独推动</strong></span></div><div class="theft-key">${theftGlyph("theft-combined")}<span>组合体<strong>逐格推动</strong></span></div></div><div class="theft-console-footer">WASD / 方向键</div></aside><div class="theft-grid-frame"><div class="theft-grid" role="grid" aria-label="盗取棋盘"></div></div><aside class="theft-console theft-console-right"><div class="theft-console-title">POWER LINK<span>电源接入</span></div><div class="theft-console-display"><strong class="theft-progress"></strong><p>全部组装后，将组合体推入匹配接口。</p><div class="theft-key">${theftGlyph("theft-socket")}<span>电源接口<strong>匹配颜色与字母</strong></span></div><div class="theft-key"><i class="theft-buffer-key"></i><span>斜纹缓冲区<strong>仅玩家可走</strong></span></div><p class="theft-recovery">陷入死角时，可撤销或重置。</p></div><div class="theft-console-footer">Z 撤销 · 随时重置</div></aside>`;
    this.grid = this.element.querySelector(".theft-grid")!;
    this.phase = this.element.querySelector(".theft-phase")!;
    this.progress = this.element.querySelector(".theft-progress")!;
    canvas.parentElement!.append(this.element);
    this.grid.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || !event.isPrimary) return;
      const tile = (event.target as Element).closest<HTMLElement>("[data-tile-id]");
      if (!tile?.dataset.tileId) return;
      event.preventDefault();
      this.canvas.focus({ preventScroll: true });
      this.onHit(tile.dataset.tileId);
    });
  }

  update(board: BoardProjection): void {
    this.element.hidden = !board.theft;
    if (!board.theft) return;
    this.element.dataset.phase = board.theft.phase;
    const columns = Math.max(...board.tiles.map((tile) => tile.x)) + 1;
    const rows = Math.max(...board.tiles.map((tile) => tile.y)) + 1;
    this.grid.style.setProperty("--columns", String(columns));
    this.grid.style.setProperty("--rows", String(rows));
    this.grid.setAttribute("aria-rowcount", String(rows));
    this.grid.setAttribute("aria-colcount", String(columns));
    this.phase.textContent = {
      assembly: "01 / 组装信号",
      power: "02 / 接入电源",
      completed: "数据盗取完成",
    }[board.theft.phase];
    this.progress.textContent = `${board.theft.satisfiedPorts} / ${board.theft.totalPorts} 已接入`;
    const stamp = JSON.stringify(board.tiles);
    if (stamp === this.stamp) return;
    this.stamp = stamp;
    this.grid.replaceChildren(...board.tiles.map((tile) => this.cell(tile)));
  }

  private cell(tile: ScreenTile): HTMLElement {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.tabIndex = -1;
    cell.className = "theft-cell";
    cell.dataset.tileId = tile.id;
    cell.dataset.kind = tile.icon ?? "floor";
    cell.dataset.player = String(tile.player);
    cell.style.gridColumn = String(tile.x + 1);
    cell.style.gridRow = String(tile.y + 1);
    cell.style.setProperty("--component-color", tile.color);
    cell.setAttribute("role", "gridcell");
    cell.setAttribute(
      "aria-label",
      `${tile.x + 1}列 ${tile.y + 1}行：${tile.player ? "玩家；" : ""}${tile.label}`,
    );
    cell.title = tile.label;
    const glyph = document.createElement("span");
    glyph.className = "theft-glyph";
    glyph.innerHTML = theftGlyph(tile.icon ?? "");
    cell.append(glyph);
    if (tile.mark && tile.icon !== "theft-buffer") {
      const mark = document.createElement("span");
      mark.className = "theft-component-mark";
      mark.textContent = tile.mark;
      cell.append(mark);
    }
    if (tile.player) {
      const player = document.createElement("span");
      player.className = "theft-player";
      player.innerHTML = theftGlyph("player");
      cell.append(player);
    }
    return cell;
  }

  pick(x: number, y: number): string | null {
    if (this.element.hidden) return null;
    const element = document.elementFromPoint(x, y)?.closest<HTMLElement>(".theft-cell");
    return element && this.grid.contains(element) ? (element.dataset.tileId ?? null) : null;
  }

  metrics() {
    if (this.element.hidden) return null;
    return {
      surface: "flat-terminal",
      tileTargets: [...this.grid.querySelectorAll<HTMLElement>(".theft-cell")].map((cell) => {
        const rect = cell.getBoundingClientRect();
        return {
          tileId: cell.dataset.tileId,
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
          width: rect.width,
          height: rect.height,
        };
      }),
    };
  }

  dispose(): void {
    this.element.remove();
  }
}
