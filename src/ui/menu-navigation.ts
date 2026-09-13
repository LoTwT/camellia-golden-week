export type MenuKeyAction = "previous" | "next" | "cancel" | "suppressRepeat" | null;

export function menuKeyAction(event: {
  key: string;
  repeat: boolean;
  isComposing: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  nativeControl: boolean;
}): MenuKeyAction {
  if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return null;
  if (event.key === "Escape") return event.repeat ? "suppressRepeat" : "cancel";
  if (event.nativeControl) return null;
  if (event.repeat && (event.key === "Enter" || event.key === " ")) return "suppressRepeat";
  if (["ArrowUp", "ArrowLeft", "w", "W"].includes(event.key)) return "previous";
  if (["ArrowDown", "ArrowRight", "s", "S"].includes(event.key)) return "next";
  return null;
}

export function nextMenuIndex(length: number, current: number, offset: -1 | 1): number {
  if (length <= 0) return -1;
  if (current < 0 || current >= length) return offset === 1 ? 0 : length - 1;
  return (current + offset + length) % length;
}

/** Store control identities, never detached DOM nodes or unbounded dialog history. */
export class MenuFocusMemory {
  private readonly selections = new Map<string, string>();
  private readonly capacity: number;
  constructor(capacity = 16) {
    if (!Number.isInteger(capacity) || capacity < 1)
      throw new Error("菜单焦点记忆容量必须为正整数");
    this.capacity = capacity;
  }
  remember(menu: string, control: string) {
    this.selections.delete(menu);
    this.selections.set(menu, control);
    if (this.selections.size > this.capacity)
      this.selections.delete(this.selections.keys().next().value!);
  }
  recall(menu: string): string | undefined {
    return this.selections.get(menu);
  }
}

export function canReceiveMenuFocus(element: HTMLElement): boolean {
  return (
    element.isConnected &&
    element.tabIndex >= 0 &&
    !element.matches(":disabled, [aria-disabled='true']") &&
    !element.closest("[hidden], [inert], [aria-hidden='true']") &&
    element.checkVisibility({ checkVisibilityCSS: true })
  );
}

function controlIdentity(element: HTMLElement): string {
  const label =
    element.id ||
    element.getAttribute("aria-label") ||
    element.closest("label")?.textContent ||
    element.textContent ||
    element.getAttribute("name") ||
    "";
  return `${element.tagName}:${element.getAttribute("type") ?? ""}:${label.trim()}`;
}

export class DialogNavigation {
  private readonly memory = new MenuFocusMemory();
  private menu = "";
  private generation = 0;
  private readonly dialog: HTMLDialogElement;
  constructor(dialog: HTMLDialogElement) {
    this.dialog = dialog;
  }

  private controls(): HTMLElement[] {
    return Array.from(
      this.dialog.querySelectorAll<HTMLElement>("button, input, select, textarea, [tabindex]"),
    ).filter(canReceiveMenuFocus);
  }

  remember() {
    const active = document.activeElement;
    if (this.menu && active instanceof HTMLElement && this.dialog.contains(active))
      this.memory.remember(this.menu, controlIdentity(active));
  }

  begin(menu: string) {
    this.remember();
    this.menu = menu;
    const generation = ++this.generation;
    queueMicrotask(() => {
      if (generation !== this.generation || !this.dialog.open) return;
      const controls = this.controls();
      const remembered = this.memory.recall(menu);
      (controls.find((control) => controlIdentity(control) === remembered) ?? controls[0])?.focus();
    });
  }

  close() {
    this.remember();
    this.menu = "";
    this.generation += 1;
  }

  handleKey(event: KeyboardEvent, cancel: () => void) {
    const active = document.activeElement;
    const nativeControl =
      active instanceof HTMLElement &&
      (active.matches("input, textarea, select") || active.isContentEditable);
    const action = menuKeyAction({
      key: event.key,
      repeat: event.repeat,
      isComposing: event.isComposing,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      altKey: event.altKey,
      nativeControl,
    });
    if (!action) return;
    // Consume before a callback can close the dialog and return focus to the canvas.
    event.preventDefault();
    event.stopPropagation();
    if (action === "cancel") cancel();
    else if (action === "previous" || action === "next") {
      const controls = this.controls();
      const current = controls.findIndex((control) => control === active);
      controls[nextMenuIndex(controls.length, current, action === "previous" ? -1 : 1)]?.focus();
    }
  }
}
