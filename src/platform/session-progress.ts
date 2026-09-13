import type { SaveInspection, SaveSlotId } from "./save-store.ts";

export class LoadedProgressAccess {
  private activatedInSession = false;
  private generation = 1;

  suspend() {
    this.activatedInSession = false;
  }

  activate(generation: number) {
    this.recordSavedGeneration(generation);
    this.activatedInSession = true;
  }

  recordSavedGeneration(generation: number) {
    if (!Number.isSafeInteger(generation) || generation < 1)
      throw new RangeError("内存进度代数必须是正安全整数");
    this.generation = generation;
  }

  exportGeneration(): number {
    return this.generation;
  }

  canPlay(sessionHeld: boolean, explicitTemporary: boolean): boolean {
    return this.activatedInSession && (sessionHeld || explicitTemporary);
  }
}

export interface OriginalSlotExport {
  readonly id: SaveSlotId;
  readonly raw: string;
}

export function originalSlotExportChoices<T>(
  inspection: SaveInspection<T>,
  showExport: (original: OriginalSlotExport, onReturn: () => void) => void,
  returnToDecision: () => void,
): { label: string; action: () => void }[] {
  return (["a", "b"] as const).flatMap((id) => {
    const raw = inspection.slots[id].raw;
    return raw === null
      ? []
      : [
          {
            label: `导出原始槽 ${id.toUpperCase()}`,
            action: () => showExport({ id, raw }, returnToDecision),
          },
        ];
  });
}
