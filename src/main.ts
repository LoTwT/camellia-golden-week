import content from "virtual:camellia-content";
import { createGame, dispatch } from "./core/engine.ts";
import { projectBoard } from "./core/projection.ts";
import { areaData, supplyProgress } from "./core/progress.ts";
import type { GameCommand, GameState } from "./core/types.ts";
import { BoardRenderer } from "./render/board.ts";
import { GameShell } from "./ui/shell.ts";
import { InputAdapter } from "./platform/input.ts";
import { GameAudio } from "./audio/audio.ts";
import { createSaveStore, MAX_IMPORT_BYTES } from "./platform/save-store.ts";
import type { SaveInspection, SaveWriteIntent } from "./platform/save-store.ts";
import { createSessionLock } from "./platform/session-lock.ts";
import {
  payloadSummary,
  restorePayload,
  stablePayload,
  validatePayload,
} from "./platform/save-payload.ts";
import type { SavePayload } from "./platform/save-payload.ts";
import "./ui/style.css";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("应用入口不存在");
let state: GameState | null = null;
let renderer: BoardRenderer | null = null;
let input: InputAdapter | null = null;
let lastProjection = "";
let lastAutoStep = 0;
let graphicsAvailable = true;
let temporary = false;
let inspection: SaveInspection<SavePayload>;
const session = createSessionLock(navigator.locks);
const store = createSaveStore<SavePayload>(
  {
    getItem: (key) => localStorage.getItem(key),
    setItem: (key, value) => localStorage.setItem(key, value),
  },
  (payload) => validatePayload(payload, content),
  () => session.isHeld() && !temporary,
);
const audio = new GameAudio();
const frameSamples: number[] = [];
let previousFrame = 0;
let lastFrameSummaryAt = 0;
let frameSummary = { sampleCount: 0, medianMs: 0, p95Ms: 0, meanMs: 0 };
const shell = new GameShell(root, content, {
  send: (command) => send(command),
  start: (confirmed) => startNewGame(confirmed),
  export: exportCurrent,
  import: (file) => {
    void importFile(file);
  },
  save: () => {
    if (state) persist(stablePayload(state), "retry");
    render();
  },
  enableAudio: () => {
    void audio.enable().then((enabled) => {
      if (!enabled && state)
        state.lastResult = {
          code: "audioUnavailable",
          message: "声音尚未启用，可在设置中重试；游戏保持可玩",
        };
    });
  },
});
shell.showDecision("正在读取进度", "正在获取当前浏览器的单写会话。", []);

function download(raw: string, suffix = "progress") {
  const blob = new Blob([raw], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `camellia-golden-week-${suffix}-${new Date().toISOString().replaceAll(":", "-")}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportCurrent() {
  if (state) {
    const exported = store.exportMemory(
      stablePayload(state),
      new Date().toISOString(),
      Math.max(1, inspection?.maxGeneration ?? 1),
    );
    if (exported.ok)
      shell.showExport(
        exported.raw,
        () => download(exported.raw),
        () => {
          shell.dismissDecision();
          shell.openPanel("storage");
        },
      );
    else
      shell.showDecision("无法导出", exported.message, [
        { label: "返回", action: () => shell.dismissDecision() },
      ]);
  } else if (inspection)
    download(JSON.stringify(store.exportRaw(inspection), null, 2), "raw-slots");
}
function exportSlot(id: "a" | "b") {
  const raw = inspection?.slots[id].raw;
  if (raw !== null && raw !== undefined) download(raw, `raw-${id}`);
}
function persist(
  payload: SavePayload,
  intent: SaveWriteIntent,
  confirmedReplacement = false,
  migrationRequired = false,
): boolean {
  if (temporary) {
    shell.saveLabel = "临时进度 · 可导出";
    return true;
  }
  shell.saveLabel = "保存中";
  const outcome = store.write(payload, {
    expected: inspection,
    intent,
    savedAt: new Date().toISOString(),
    confirmedReplacement,
    migrationRequired,
  });
  inspection = outcome.inspection;
  if (!outcome.ok) {
    shell.saveLabel = `未保存，可导出 · ${outcome.message}`;
    return false;
  }
  shell.saveLabel = `已保存 · ${new Date(outcome.envelope.savedAt).toLocaleTimeString("zh-CN", { hour12: false })}`;
  return true;
}
function activate(payload: SavePayload) {
  shell.dismissDecision();
  state = restorePayload(payload, content, performance.now());
  input?.clear();
  lastProjection = "";
  void audio.enable();
  render();
  shell.canvas.focus({ preventScroll: true });
}
function startNewGame(confirmed = false) {
  if ((state !== null || (!temporary && inspection.status !== "empty")) && !confirmed) {
    shell.showDecision(
      "替换当前进度？",
      "可先导出原进度。确认后建立新游戏，上一成功快照保留在另一槽。",
      [
        { label: "先导出", action: exportCurrent },
        { label: "确认新游戏", action: () => startNewGame(true), primary: true },
        { label: "取消", action: showStartup },
      ],
    );
    return;
  }
  const next = createGame(content, performance.now());
  next.settings.reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  next.settings.reducedFlash = next.settings.reducedMotion;
  const payload = stablePayload(next);
  if (persist(payload, "newGame", confirmed || inspection.status === "empty")) activate(payload);
  else
    shell.showDecision("新游戏尚未保存", shell.saveLabel, [
      { label: "重试保存新游戏", action: () => startNewGame(true), primary: true },
      {
        label: "临时游玩此新游戏，可导出",
        action: () => {
          temporary = true;
          shell.saveLabel = "临时进度 · 可导出";
          activate(payload);
        },
      },
      { label: "导出原始存档", action: exportCurrent },
    ]);
}
function continueSlot(backup = false) {
  const slot = backup ? inspection.backup : inspection.latest;
  if (!slot?.payload) return;
  if (backup) {
    if (!persist(slot.payload, "restoreBackup", true, slot.migrationRequired)) {
      showStartup();
      return;
    }
  } else if (slot.migrationRequired) {
    if (!persist(slot.payload, "migration")) {
      showStartup();
      return;
    }
  } else
    shell.saveLabel = `已保存 · ${slot.envelope ? new Date(slot.envelope.savedAt).toLocaleString("zh-CN") : "本地"}`;
  activate(slot.payload);
}
function showStartup() {
  const rawChoices = (["a", "b"] as const)
    .filter((id) => inspection.slots[id].raw !== null)
    .map((id) => ({ label: `导出原始槽 ${id.toUpperCase()}`, action: () => exportSlot(id) }));
  if (inspection.status === "ready" && inspection.latest?.payload) {
    shell.showDecision(
      "继续探索",
      `${payloadSummary(inspection.latest.payload, content)}。${inspection.latest.migrationRequired ? "发现新增内容，继续前将保护旧档并迁移。" : "关闭浏览器后的进度已就绪。"}`,
      [
        { label: "继续游戏", action: () => continueSlot(), primary: true },
        { label: "新游戏…", action: () => startNewGame() },
        { label: "导入存档", action: () => shell.requestImport() },
        ...rawChoices,
      ],
    );
    return;
  }
  if (inspection.status === "empty") {
    shell.showDecision(
      "沙罗黄金周",
      `${content.profile.id} · 电视格子探索。WASD / 方向键移动，F 交互，R 使用增幅仪。存档保存在 ${location.origin}。`,
      [
        { label: "新游戏", action: () => startNewGame(), primary: true },
        { label: "导入存档", action: () => shell.requestImport() },
      ],
    );
    return;
  }
  const choices: { label: string; action: () => void; primary?: boolean }[] = [
    ...rawChoices,
    {
      label: "重新读取",
      action: () => {
        inspection = store.inspect();
        showStartup();
      },
    },
  ];
  if (inspection.status === "recovery" && inspection.backup?.payload)
    choices.unshift({
      label: `使用备份继续 · ${inspection.backup.envelope?.savedAt ?? "时间未知"}`,
      action: () => continueSlot(true),
      primary: true,
    });
  if (
    inspection.status !== "future" &&
    inspection.status !== "conflict" &&
    inspection.status !== "unavailable"
  )
    choices.push(
      { label: "导入有效文件", action: () => shell.requestImport() },
      { label: "明确开始新游戏…", action: () => startNewGame() },
    );
  if (inspection.status === "unavailable")
    choices.unshift({
      label: "临时游玩新游戏，可导出",
      action: () => {
        temporary = true;
        startNewGame(true);
      },
      primary: true,
    });
  shell.showDecision(
    inspection.status === "future"
      ? "较新进度已保护"
      : inspection.status === "recovery"
        ? "选择存档恢复方式"
        : "需要处理本地存档",
    inspection.message + (inspection.latest?.error ? ` ${inspection.latest.error}` : ""),
    choices,
  );
}
async function importFile(file: File) {
  if (state) send({ kind: "Pause", reason: "manual", present: true });
  if (file.size > MAX_IMPORT_BYTES) {
    shell.showDecision("导入失败", "文件超过 1 MiB，当前进度未替换。", [
      {
        label: "返回",
        action: () => {
          shell.dismissDecision();
          if (state) shell.openPanel("storage");
          else showStartup();
        },
      },
    ]);
    return;
  }
  let raw: string;
  try {
    raw = await file.text();
  } catch {
    shell.showDecision("导入失败", "无法读取此文件，当前进度未替换。", [
      { label: "返回", action: showStartup },
    ]);
    return;
  }
  const prepared = store.prepareImport(raw);
  if (!prepared.ok) {
    shell.showDecision("导入失败", `${prepared.message} 当前进度未替换。`, [
      {
        label: "返回",
        action: () => {
          shell.dismissDecision();
          if (state) shell.openPanel("storage");
          else showStartup();
        },
      },
    ]);
    return;
  }
  shell.showDecision(
    "确认导入进度",
    `${payloadSummary(prepared.payload, content)}。确认后替换当前世界；写入与回读成功后才生效。`,
    [
      { label: "先导出当前进度", action: exportCurrent },
      {
        label: "确认替换",
        primary: true,
        action: () => {
          if (persist(prepared.payload, "import", true, prepared.migrationRequired))
            activate(prepared.payload);
          else
            shell.showDecision("导入未生效", `${shell.saveLabel} 当前世界保持不变。`, [
              {
                label: "返回",
                action: () => {
                  shell.dismissDecision();
                  if (state) shell.openPanel("storage");
                  else showStartup();
                },
              },
            ]);
        },
      },
      {
        label: "取消",
        action: () => {
          shell.dismissDecision();
          if (state) shell.openPanel("storage");
          else showStartup();
        },
      },
    ],
  );
}
async function acquireSession() {
  const outcome = await session.acquire();
  inspection = store.inspect();
  if (outcome === "acquired") {
    temporary = false;
    showStartup();
    return;
  }
  if (outcome === "busy") {
    shell.showDecision(
      "进度正在另一窗口使用",
      "请在原窗口继续，或关闭原窗口后重试。本窗口不会抢锁或写入进度。",
      [
        {
          label: "重试获取会话",
          action: () => {
            void acquireSession();
          },
          primary: true,
        },
        { label: "只读导出原始存档", action: exportCurrent },
      ],
    );
    return;
  }
  shell.showDecision(
    "当前浏览器无法保存会话",
    "独占会话不可用。可以主动选择临时游玩，期间不会写入已有存档。",
    [
      {
        label: "临时游玩新游戏，可导出",
        primary: true,
        action: () => {
          temporary = true;
          startNewGame(true);
        },
      },
      { label: "导出原始存档", action: exportCurrent },
      {
        label: "重试",
        action: () => {
          void acquireSession();
        },
      },
    ],
  );
}
function snapshot() {
  return structuredClone(
    state
      ? {
          profile: content.profile.id,
          contentVersion: content.contentVersion,
          ruleVersion: content.ruleVersion,
          position: state.playerPosition,
          mode: state.mode,
          phase: state.phase,
          activeTimeMs: state.clock.activeTimeMs,
          countdownRemainingMs: state.clock.countdownRemainingMs,
          pauseReasons: state.clock.pauseReasons,
          completedObjectiveIds: state.completedObjectiveIds,
          data: Object.fromEntries(
            (["a", "b", "c", "d"] as const).map((area) => [area, areaData(content, state!, area)]),
          ),
          claimedRewardIds: state.claimedRewardIds,
          supply: supplyProgress(content, state),
          bestResults: state.bestResults,
          lastResult: state.lastResult,
          saveStatus: shell.saveLabel,
          saveGeneration: inspection?.maxGeneration ?? 0,
          session: session.status(),
          render: renderer?.metrics(),
          frameSummary,
        }
      : null,
  );
}
let inspectOutput: HTMLScriptElement | null = null;
if (import.meta.env.DEV || import.meta.env.MODE === "acceptance") {
  Object.defineProperty(window, "__CAMELLIA_INSPECT__", {
    value: Object.freeze({ snapshot }),
    writable: false,
    configurable: false,
  });
  inspectOutput = document.createElement("script");
  inspectOutput.type = "application/json";
  inspectOutput.id = "camellia-inspection";
  document.body.append(inspectOutput);
}
function render() {
  if (!state) return;
  shell.update(state);
  const key = `${state.stateRevision}:${state.playerPosition.tileId}:${state.mode}:${state.phase}:${state.activeRealtime?.state.eventSequence ?? 0}:${Math.floor(state.clock.activeTimeMs / 500)}:${JSON.stringify(state.settings)}`;
  if (key !== lastProjection) {
    renderer?.update(projectBoard(content, state), state.settings);
    lastProjection = key;
  }
  audio.configure(state.settings);
  if (inspectOutput) inspectOutput.textContent = JSON.stringify(snapshot());
}
function send(command: GameCommand, now = performance.now()) {
  if (!state) return;
  const scopeWasComplete = state.scopeCompletionHistory.includes(content.profile.id);
  const update = dispatch(content, state, command, now, new Date().toISOString());
  state = update.state;
  if (update.clearInputs) input?.clear();
  if (
    update.events.some(
      (event) => event.kind === "move" || event.kind === "success" || event.kind === "pickup",
    )
  )
    renderer?.flash(now);
  audio.feedback(update.events, now);
  if (update.stable) persist(stablePayload(state), "auto");
  render();
  if (!scopeWasComplete && state.scopeCompletionHistory.includes(content.profile.id)) {
    const supplies = supplyProgress(content, state);
    send({ kind: "Pause", reason: "manual", present: true }, now);
    shell.showDecision(
      content.profile.fullCampaign ? "中央仓库 · 主目标完成" : "本版本主路径完成",
      `${content.profile.id} · 已收集 ${supplies.collected} / ${supplies.total} 单位物资。${content.profile.fullCampaign ? "四区数据已汇齐，中央终端已经完成。" : "本版本终点已抵达，未来地区在后续内容包开放。"}可以继续探索、补齐物资和重玩挑战。`,
      [
        {
          label: "继续自由探索",
          primary: true,
          action: () => {
            shell.dismissDecision();
            send({
              kind: "Resume",
              pageVisible: document.visibilityState === "visible",
              canvasOperable: true,
              graphicsAvailable,
            });
            shell.canvas.focus();
          },
        },
        { label: "导出完成进度", action: exportCurrent },
      ],
    );
  }
}
function initializeRenderer() {
  try {
    renderer?.dispose();
    renderer = new BoardRenderer(shell.canvas, shell.labels, (tileId) => {
      if (!shell.dialog.open) send({ kind: "ClickTile", tileId });
    });
    graphicsAvailable = true;
    lastProjection = "";
    render();
  } catch (error) {
    graphicsAvailable = false;
    shell.showDecision(
      "图形启动失败",
      `需要支持 WebGL2 的桌面浏览器。${error instanceof Error ? error.message : "请重试"}`,
      [
        { label: "重试图形", action: initializeRenderer, primary: true },
        { label: "导出进度", action: exportCurrent },
        { label: "导入存档", action: () => shell.requestImport() },
      ],
    );
  }
}
initializeRenderer();
input = new InputAdapter(
  shell.canvas,
  send,
  () => ({
    firewall: state?.activeRealtime?.state.kind === "firewall",
    canPlay:
      !!state &&
      !shell.dialog.open &&
      !state.clock.awaitingResume &&
      state.clock.pauseReasons.length === 0 &&
      state.clock.countdownRemainingMs === 0,
  }),
  () => shell.openPanel("map"),
  () => shell.openPanel("pause"),
);
document.addEventListener("visibilitychange", () => {
  if (state) send({ kind: "Pause", reason: "hidden", present: document.hidden });
});
window.addEventListener("blur", () => {
  if (state) send({ kind: "Pause", reason: "blur", present: true });
});
window.addEventListener("focus", () => {
  if (state) send({ kind: "Pause", reason: "blur", present: false });
});
window.addEventListener("pagehide", () => {
  if (state) send({ kind: "Pause", reason: "hidden", present: true });
  session.release();
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    input?.clear();
    void acquireSession();
  }
});
shell.canvas.addEventListener("webglcontextlost", (event) => {
  event.preventDefault();
  graphicsAvailable = false;
  send({ kind: "Pause", reason: "graphicsLost", present: true });
});
shell.canvas.addEventListener("webglcontextrestored", () => {
  initializeRenderer();
  if (graphicsAvailable) send({ kind: "Pause", reason: "graphicsLost", present: false });
});
function frame(now: number) {
  if (state && graphicsAvailable) {
    send({ kind: "Tick" }, now);
    input?.frame(now);
    const destination = state.autoPath.at(-1);
    if (destination && !shell.dialog.open && now - lastAutoStep >= 140) {
      lastAutoStep = now;
      send({ kind: "ClickTile", tileId: destination }, now);
    }
    const definition = content.realtimeChallenges.find(
      (candidate) => candidate.id === state?.activeRealtime?.roomId,
    );
    audio.syncFirewall(state, definition?.kind === "firewall" ? definition : undefined, now);
    if (!shell.dialog.open && previousFrame && document.visibilityState === "visible") {
      frameSamples.push(now - previousFrame);
      if (frameSamples.length > 7200) frameSamples.shift();
    }
    if (now - lastFrameSummaryAt >= 1000 && frameSamples.length) {
      const sorted = [...frameSamples].sort((a, b) => a - b);
      frameSummary = {
        sampleCount: sorted.length,
        medianMs: sorted[Math.floor(sorted.length / 2)]!,
        p95Ms: sorted[Math.floor(sorted.length * 0.95)]!,
        meanMs: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
      };
      lastFrameSummaryAt = now;
    }
  }
  renderer?.frame(now);
  previousFrame = now;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
void acquireSession();
