import content, { migrationReleases } from "virtual:camellia-content";
import { publishedProfileMigrations } from "./platform/migrations.ts";
import { saveUpgradeSummary } from "./platform/upgrade-summary.ts";
import { createGame, dispatch } from "./core/engine.ts";
import { projectBoard } from "./core/projection.ts";
import { areaData, supplyProgress } from "./core/progress.ts";
import type { GameCommand, GameState } from "./core/types.ts";
import { BoardRenderer } from "./render/board.ts";
import { boardProjectionKey } from "./render/projection-key.ts";
import { GameShell } from "./ui/shell.ts";
import { AutoWalkScheduler, InputAdapter } from "./platform/input.ts";
import { GameAudio } from "./audio/audio.ts";
import { createSaveStore, MAX_IMPORT_BYTES } from "./platform/save-store.ts";
import type { SaveInspection, SaveWriteIntent } from "./platform/save-store.ts";
import { createSessionLock } from "./platform/session-lock.ts";
import { LoadedProgressAccess, originalSlotExportChoices } from "./platform/session-progress.ts";
import type { SessionDiagnostics } from "./platform/session-diagnostics.ts";
import {
  payloadSummary,
  restorePayload,
  stablePayload,
  validatePayload,
} from "./platform/save-payload.ts";
import type { SavePayload } from "./platform/save-payload.ts";
import type { AcceptanceFaultController } from "./platform/acceptance-faults.ts";
import "./ui/style.css";
import "./ui/firewall.css";
import "./ui/r1-challenges.css";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("应用入口不存在");
let state: GameState | null = null;
let renderer: BoardRenderer | null = null;
let input: InputAdapter | null = null;
let lastProjection = "";
const autoWalk = new AutoWalkScheduler();
let graphicsAvailable = true;
let graphicsError = "";
let temporary = false;
const loadedProgress = new LoadedProgressAccess();
let transitioning = false;
let transitionSequence = 0;
let transitionStartedAt = 0;
let transitionDurationMs = 0;
let firstStartupReadyMs: number | null = null;
let firstGamePreparationMs: number | null = null;
let inspection: SaveInspection<SavePayload>;
let sessionDiagnostics: SessionDiagnostics | null = null;
if (import.meta.env.MODE === "acceptance") {
  const { createSessionDiagnostics } = await import("./platform/session-diagnostics.ts");
  sessionDiagnostics = createSessionDiagnostics({
    buildMode: import.meta.env.MODE,
    manager: navigator.locks,
    storage: {
      getItem: (key) => sessionStorage.getItem(key),
      setItem: (key, raw) => sessionStorage.setItem(key, raw),
    },
    pageId: crypto.randomUUID(),
    path: location.pathname + location.search,
    timeOriginMs: performance.timeOrigin,
    navigationType:
      (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)
        ?.type ?? "unknown",
    now: () => performance.now(),
    visibility: () => document.visibilityState,
  });
}
const session = createSessionLock(sessionDiagnostics?.manager ?? navigator.locks);
let sessionRequest: AbortController | null = null;
let retrySessionWhenVisible = false;
const migrationRegistry = publishedProfileMigrations(migrationReleases);
const browserStorage = {
  getItem: (key: string) => localStorage.getItem(key),
  setItem: (key: string, value: string) => localStorage.setItem(key, value),
};
let faults: AcceptanceFaultController | null = null;
if (import.meta.env.MODE === "acceptance") {
  const { createAcceptanceFaults } = await import("./platform/acceptance-faults.ts");
  faults = createAcceptanceFaults({
    buildMode: import.meta.env.MODE,
    storage: browserStorage,
    getContext: () => renderer?.renderer.getContext() ?? null,
    isForeground: () => document.visibilityState === "visible" && document.hasFocus(),
    startupSearch: location.search,
    mayWriteTestSlots: () => session.isHeld() && !temporary,
  });
}
const store = createSaveStore<SavePayload>(
  faults?.storage ?? browserStorage,
  (payload) => validatePayload(payload, content, migrationRegistry),
  () => session.isHeld() && !temporary,
);
const audio = new GameAudio();
let audioEnableRequest = 0;
const frameSamples: number[] = [];
let previousFrame = 0;
let lastFrameSummaryAt = 0;
let frameSummary = { sampleCount: 0, medianMs: 0, p95Ms: 0, meanMs: 0 };
const inputLatencies: number[] = [];
let pendingInputs: number[] = [];
let awaitingPaintInputs: number[] = [];
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
  reload: requestReload,
  enableAudio,
});
shell.showDecision("正在读取进度", "正在获取当前浏览器的单写会话。", []);
faults?.mountPanel(document.body, shell.dialog);

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
      loadedProgress.exportGeneration(),
    );
    if (exported.ok) {
      const retained = !canPlayLoadedProgress();
      shell.showExport(
        exported.raw,
        () => download(exported.raw, retained ? "retained-memory" : "progress"),
        returnToStorageMenu,
      );
      if (retained) {
        const source = document.createElement("p");
        source.textContent = `本文件是本页离开前保留的内存副本，沿用其原代数 ${loadedProgress.exportGeneration()}；它不代表其他窗口最新保存的进度。重新获取会话并读取本地进度前，此副本只能导出。`;
        shell.dialog.querySelector("h2")?.after(source);
      }
    } else
      shell.showDecision("无法导出", exported.message, [
        { label: "返回", action: returnToStorageMenu },
      ]);
  } else if (inspection)
    download(JSON.stringify(store.exportRaw(inspection), null, 2), "raw-slots");
}
function exportSlot(id: "a" | "b") {
  const raw = inspection?.slots[id].raw;
  if (raw !== null && raw !== undefined)
    shell.showExport(raw, () => download(raw, `raw-${id}`), showStartup);
}
function canPlayLoadedProgress(): boolean {
  return loadedProgress.canPlay(session.isHeld(), temporary);
}
function openLoadedPanel(panel: "pause" | "map") {
  if (canPlayLoadedProgress()) shell.openPanel(panel);
  else showStartup();
}
function requireSessionPermission(): boolean {
  if (session.isHeld() || temporary) return true;
  showSessionDecision();
  return false;
}
function enableAudio() {
  const request = ++audioEnableRequest;
  try {
    faults?.beforeAudioEnable();
  } catch {
    failAudio();
    render();
    return;
  }
  void audio.enable().then((enabled) => {
    if (request !== audioEnableRequest) return;
    shell.setAudioAvailable(enabled);
    if (!enabled) failAudio();
  });
}
function failAudio() {
  audioEnableRequest += 1;
  audio.disable();
  shell.setAudioAvailable(false);
  if (state)
    state.lastResult = {
      code: "audioUnavailable",
      message: "声音暂时不可用，进度已保留；可点击启用声音重试",
    };
}
function persist(
  payload: SavePayload,
  intent: SaveWriteIntent,
  confirmedReplacement = false,
  migrationRequired = false,
): boolean {
  if ((intent === "auto" || intent === "retry") && !canPlayLoadedProgress()) {
    shell.saveLabel = "请重新获取会话并读取本地进度；离开前的内存副本仍可导出。";
    return false;
  }
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
  inspection = outcome.retryInspection;
  if (!outcome.ok) {
    shell.saveLabel = `未保存，可导出 · ${outcome.message}`;
    return false;
  }
  shell.saveLabel = `已保存 · ${new Date(outcome.envelope.savedAt).toLocaleTimeString("zh-CN", { hour12: false })}`;
  if (intent === "auto" || intent === "retry")
    loadedProgress.recordSavedGeneration(outcome.envelope.saveGeneration);
  return true;
}
function activate(payload: SavePayload) {
  if (!requireSessionPermission()) return;
  shell.dismissDecision();
  state = restorePayload(payload, content, performance.now());
  loadedProgress.activate(temporary ? 1 : Math.max(1, inspection.maxGeneration));
  input?.clear();
  lastProjection = "";
  enableAudio();
  if (graphicsAvailable) beginSceneTransition();
  else showGraphicsFailure();
  shell.canvas.focus({ preventScroll: true });
}
function beginSceneTransition() {
  if (!state || !renderer || !graphicsAvailable) return;
  const sequence = ++transitionSequence;
  const boardRenderer = renderer;
  const resumeAfterLoad = !state.clock.awaitingResume && state.clock.pauseReasons.length === 0;
  transitioning = true;
  transitionStartedAt = performance.now();
  frameSamples.length = 0;
  frameSummary = { sampleCount: 0, medianMs: 0, p95Ms: 0, meanMs: 0 };
  shell.setTransition(true);
  input?.clear();
  audio.cancelBeats();
  send({ kind: "Pause", reason: "transition", present: true });
  const projection = projectBoard(content, state);
  const settings = state.settings;
  void Promise.all([boardRenderer.prepare(projection, settings), document.fonts.ready])
    .then(
      () =>
        new Promise<void>((resolve, reject) => {
          requestAnimationFrame((now) => {
            if (sequence !== transitionSequence) return resolve();
            try {
              boardRenderer.frame(now);
              resolve();
            } catch (error) {
              reject(error);
            }
          });
        }),
    )
    .then(() => {
      if (sequence !== transitionSequence || !state || !graphicsAvailable) return;
      const now = performance.now();
      send({ kind: "Pause", reason: "transition", present: false }, now);
      if (resumeAfterLoad && state.clock.pauseReasons.length === 0)
        send(
          {
            kind: "Resume",
            pageVisible: document.visibilityState === "visible" && document.hasFocus(),
            canvasOperable: true,
            graphicsAvailable,
          },
          now,
        );
      transitionDurationMs = performance.now() - transitionStartedAt;
      firstGamePreparationMs ??= transitionDurationMs;
      transitioning = false;
      shell.setTransition(false);
      render();
    })
    .catch((error: unknown) => {
      if (sequence === transitionSequence) failGraphics(error);
    });
}
function startNewGame(confirmed = false) {
  if (!requireSessionPermission()) return;
  if ((state !== null || (!temporary && inspection.status !== "empty")) && !confirmed) {
    shell.showDecision(
      "替换当前进度？",
      "可先导出原进度。确认后建立新游戏，上一成功快照保留在另一槽。",
      [
        { label: "先导出", action: exportCurrent },
        { label: "确认新游戏", action: () => startNewGame(true), primary: true },
        { label: "取消", action: returnToStorageMenu },
      ],
      returnToStorageMenu,
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
  if (!requireSessionPermission()) return;
  const slot = backup ? inspection.backup : inspection.latest;
  if (!slot?.payload) return;
  if (backup || slot.migrationRequired) {
    if (
      !persist(slot.payload, backup ? "restoreBackup" : "migration", backup, slot.migrationRequired)
    ) {
      shell.showDecision(
        backup ? "备份恢复未保存" : "进度升级未保存",
        shell.saveLabel,
        [
          { label: "重试", action: () => continueSlot(backup), primary: true },
          { label: "重新读取本地进度…", action: requestReload },
          ...(["a", "b"] as const)
            .filter((id) => inspection.slots[id].raw !== null)
            .map((id) => ({
              label: `导出原始槽 ${id.toUpperCase()}`,
              action: () => exportSlot(id),
            })),
          { label: "返回", action: showStartup },
        ],
        showStartup,
      );
      return;
    }
  } else
    shell.saveLabel = `已保存 · ${slot.envelope ? new Date(slot.envelope.savedAt).toLocaleString("zh-CN") : "本地"}`;
  activate(slot.payload);
}
function showStartup() {
  if (!requireSessionPermission()) return;
  firstStartupReadyMs ??= performance.now();
  if (!graphicsAvailable) {
    showGraphicsFailure();
    return;
  }
  const startupExportChoices = [
    ...(["a", "b"] as const)
      .filter((id) => inspection.slots[id].raw !== null)
      .map((id) => ({ label: `导出原始槽 ${id.toUpperCase()}`, action: () => exportSlot(id) })),
    ...(state && !canPlayLoadedProgress()
      ? [{ label: "导出离开前的内存副本", action: exportCurrent }]
      : []),
  ];
  if (inspection.status === "ready" && inspection.latest?.payload) {
    const upgradeSummary = saveUpgradeSummary(
      inspection.latest.envelope?.payload,
      inspection.latest.payload,
      content,
      inspection.latest.migrationNotes,
    );
    shell.showDecision(
      "继续探索",
      `${payloadSummary(inspection.latest.payload, content)}。${inspection.latest.migrationRequired ? "进度需要升级，继续前将保护旧档并完成迁移。" : "关闭浏览器后的进度已就绪。"}${upgradeSummary}`,
      [
        { label: "继续游戏", action: () => continueSlot(), primary: true },
        { label: "新游戏…", action: () => startNewGame() },
        { label: "导入存档", action: () => shell.requestImport() },
        ...startupExportChoices,
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
        ...startupExportChoices,
      ],
    );
    return;
  }
  const choices: { label: string; action: () => void; primary?: boolean }[] = [
    ...startupExportChoices,
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
    inspection.message +
      (inspection.latest?.error ? ` ${inspection.latest.error}` : "") +
      (inspection.status === "recovery" && inspection.backup?.payload
        ? saveUpgradeSummary(
            inspection.backup.envelope?.payload,
            inspection.backup.payload,
            content,
            inspection.backup.migrationNotes,
          )
        : ""),
    choices,
  );
}
function returnToStorageMenu() {
  if (state && canPlayLoadedProgress()) {
    shell.dismissDecision();
    shell.openPanel("storage");
  } else showStartup();
}
function requestReload() {
  shell.showDecision(
    "重新读取本地进度？",
    "可先导出当前内存进度。确认后重新载入页面，未保存的变化不会自动写入本地存档。",
    [
      { label: "先导出当前进度", action: exportCurrent },
      { label: "确认重新读取", action: () => location.reload(), primary: true },
      { label: "取消", action: returnToStorageMenu },
    ],
    returnToStorageMenu,
  );
}
async function importFile(file: File) {
  if (!requireSessionPermission()) return;
  if (state) send({ kind: "Pause", reason: "manual", present: true });
  if (file.size > MAX_IMPORT_BYTES) {
    shell.showDecision(
      "导入失败",
      "文件超过 1 MiB，当前进度未替换。",
      [{ label: "返回", action: returnToStorageMenu }],
      returnToStorageMenu,
    );
    return;
  }
  let raw: string;
  try {
    raw = await file.text();
  } catch {
    shell.showDecision(
      "导入失败",
      "无法读取此文件，当前进度未替换。",
      [{ label: "返回", action: returnToStorageMenu }],
      returnToStorageMenu,
    );
    return;
  }
  const prepared = store.prepareImport(raw);
  if (!prepared.ok) {
    shell.showDecision(
      "导入失败",
      `${prepared.message} 当前进度未替换。`,
      [{ label: "返回", action: returnToStorageMenu }],
      returnToStorageMenu,
    );
    return;
  }
  const upgradeSummary = saveUpgradeSummary(
    prepared.envelope.payload,
    prepared.payload,
    content,
    prepared.migrationNotes,
  );
  shell.showDecision(
    "确认导入进度",
    `${payloadSummary(prepared.payload, content)}。${upgradeSummary}确认后替换当前世界；写入与回读成功后才生效。`,
    [
      { label: "先导出当前进度", action: exportCurrent },
      {
        label: "确认替换",
        primary: true,
        action: () => {
          if (!requireSessionPermission()) return;
          if (persist(prepared.payload, "import", true, prepared.migrationRequired))
            activate(prepared.payload);
          else
            shell.showDecision(
              "导入未生效",
              `${shell.saveLabel} 当前世界保持不变。`,
              [{ label: "返回", action: returnToStorageMenu }],
              returnToStorageMenu,
            );
        },
      },
      { label: "取消", action: returnToStorageMenu },
    ],
    returnToStorageMenu,
  );
}
async function acquireSession() {
  loadedProgress.suspend();
  temporary = false;
  input?.clear();
  if (import.meta.env.MODE === "acceptance")
    sessionDiagnostics?.record("acquire-start", {
      pending: !!sessionRequest,
      session: session.status(),
      hidden: document.hidden,
    });
  sessionRequest?.abort();
  sessionRequest = null;
  if (document.hidden) {
    retrySessionWhenVisible = true;
    if (import.meta.env.MODE === "acceptance") sessionDiagnostics?.record("acquire-deferred");
    return;
  }
  retrySessionWhenVisible = false;
  const request = new AbortController();
  sessionRequest = request;
  const outcome = await session.acquire(request.signal);
  if (import.meta.env.MODE === "acceptance")
    sessionDiagnostics?.record("acquire-result", {
      outcome,
      stale: sessionRequest !== request || request.signal.aborted,
    });
  if (sessionRequest !== request || request.signal.aborted) return;
  sessionRequest = null;
  if (outcome === "cancelled") return;
  if (import.meta.env.MODE === "acceptance" && (outcome === "acquired" || outcome === "busy"))
    sessionDiagnostics?.query(outcome);
  inspection = store.inspect();
  if (outcome === "acquired") {
    temporary = false;
    showStartup();
    return;
  }
  showSessionDecision();
}
function showSessionDecision() {
  if (session.isHeld() || temporary) {
    showStartup();
    return;
  }
  const rawChoices = inspection
    ? originalSlotExportChoices(
        inspection,
        ({ id, raw }, onReturn) =>
          shell.showExport(raw, () => download(raw, `raw-${id}`), onReturn),
        showSessionDecision,
      )
    : [];
  const memoryChoices = state ? [{ label: "导出离开前的内存副本", action: exportCurrent }] : [];
  if (session.status() === "idle" || session.status() === "acquiring") {
    shell.showDecision("正在获取进度会话", "读取本地进度前，离开前的内存副本保持只读。", [
      { label: "重试获取会话", action: () => void acquireSession(), primary: true },
      ...rawChoices,
      ...memoryChoices,
    ]);
    return;
  }
  if (session.status() === "busy") {
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
        ...rawChoices,
        ...memoryChoices,
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
      ...rawChoices,
      ...memoryChoices,
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
          ...(import.meta.env.MODE === "acceptance"
            ? { sessionDiagnostics: sessionDiagnostics?.snapshot() }
            : {}),
          schemaVersion: state.schemaVersion,
          contentVersion: content.contentVersion,
          ruleVersion: content.ruleVersion,
          position: state.playerPosition,
          mode: state.mode,
          phase: state.phase,
          activeTimeMs: state.clock.activeTimeMs,
          countdownRemainingMs: state.clock.countdownRemainingMs,
          pauseReasons: state.clock.pauseReasons,
          viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
          settings: state.settings,
          audio: audio.metrics(),
          completedObjectiveIds: state.completedObjectiveIds,
          completedRoomLayouts: state.completedRoomLayouts,
          staticRoom: state.activeStatic
            ? {
                roomId: state.activeStatic.roomId,
                layout: state.activeStatic.state.currentLayout,
                undoDepth: state.activeStatic.state.undoStack.length,
                practice: state.activeStatic.practice,
              }
            : null,
          completedRoom: state.activeCompletedRoom,
          realtimeRoom: state.activeRealtime,
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
          transition: { active: transitioning, lastDurationMs: transitionDurationMs },
          firstStartupReadyMs,
          firstGamePreparationMs,
          inputLatency: {
            method:
              "physical input handler (including pending direction) to animation frame after presentation",
            sampleCount: inputLatencies.length,
            p95Ms:
              [...inputLatencies].sort((a, b) => a - b)[Math.floor(inputLatencies.length * 0.95)] ??
              0,
            maxMs: inputLatencies.length ? Math.max(...inputLatencies) : 0,
          },
          faults: faults?.snapshot(),
          frameSummary,
        }
      : {
          profile: content.profile.id,
          loaded: false,
          ...(import.meta.env.MODE === "acceptance"
            ? { sessionDiagnostics: sessionDiagnostics?.snapshot() }
            : {}),
          session: session.status(),
          saveStatus: shell.saveLabel,
          saveInspection: inspection
            ? {
                status: inspection.status,
                maxGeneration: inspection.maxGeneration,
                latestId: inspection.latest?.id ?? null,
                backupId: inspection.backup?.id ?? null,
                slots: Object.fromEntries(
                  (["a", "b"] as const).map((id) => [
                    id,
                    {
                      status: inspection.slots[id].status,
                      generation: inspection.slots[id].generation,
                      savedAt: inspection.slots[id].envelope?.savedAt ?? null,
                    },
                  ]),
                ),
              }
            : null,
          faults: faults?.snapshot(),
        },
  );
}
let inspectOutput: HTMLScriptElement | null = null;
let accessibleInspection: HTMLDetailsElement | null = null;
let accessibleInspectionText: HTMLElement | null = null;
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
  if (import.meta.env.MODE === "acceptance") {
    accessibleInspection = document.createElement("details");
    const label = document.createElement("summary");
    label.textContent = "只读验收快照";
    accessibleInspectionText = document.createElement("div");
    accessibleInspectionText.style.cssText =
      "max-height:220px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:12px monospace";
    accessibleInspection.append(label, accessibleInspectionText);
    const faultPanel = document.querySelector("[data-acceptance-faults]");
    faultPanel?.append(accessibleInspection);
    accessibleInspection.addEventListener("toggle", updateInspectionText);
    faultPanel?.addEventListener("toggle", updateInspectionText);
  }
}
function render() {
  if (!state) return;
  shell.update(state);
  const key = boardProjectionKey(state);
  if (graphicsAvailable && key !== lastProjection) {
    try {
      renderer?.update(projectBoard(content, state), state.settings);
      lastProjection = key;
    } catch (error) {
      failGraphics(error);
    }
  }
  try {
    audio.configure(state.settings);
  } catch {
    failAudio();
  }
  updateInspectionText();
}
function updateInspectionText() {
  if (inspectOutput) {
    const inspectionJson = JSON.stringify(snapshot());
    inspectOutput.textContent = inspectionJson;
    if (
      accessibleInspection?.open &&
      accessibleInspectionText &&
      accessibleInspection.closest<HTMLDetailsElement>("[data-acceptance-faults]")?.open
    ) {
      const pieces = inspectionJson.match(/[\s\S]{1,360}/g) ?? [];
      accessibleInspectionText.replaceChildren(
        ...pieces.map((piece, index) => {
          const paragraph = document.createElement("p");
          paragraph.style.margin = "0";
          paragraph.textContent = `CAMELLIA_INSPECTION_CHUNK ${index + 1}/${pieces.length}: ${piece}`;
          return paragraph;
        }),
      );
    }
  }
}
function send(command: GameCommand, now = performance.now(), observedAt = now) {
  if (!state) return;
  if (!canPlayLoadedProgress()) return;
  if (transitioning && !["Tick", "Pause", "Resume", "Settings"].includes(command.kind)) return;
  if (command.kind === "Resume") command = { ...command, graphicsAvailable };
  const scopeWasComplete = state.completedObjectiveIds.includes(
    content.profile.scopeTerminalObjectiveId,
  );
  const previousBoardId = state.playerPosition.boardId;
  const update = dispatch(content, state, command, now, new Date().toISOString());
  state = update.state;
  autoWalk.observe(command, state, now);
  if (
    [
      "Move",
      "ClickTile",
      "Interact",
      "Amplify",
      "Undo",
      "ResetRoom",
      "ExitRoom",
      "Teleport",
      "StartChallenge",
    ].includes(command.kind)
  )
    pendingInputs.push(observedAt);
  if (update.clearInputs) {
    input?.clear();
    audio.cancelBeats();
  }
  if (update.stable) persist(stablePayload(state), "auto");
  try {
    faults?.beforeFeedback("render", update.events);
    if (update.events.some((event) => ["move", "success", "pickup", "score"].includes(event.kind)))
      renderer?.flash(now);
  } catch (error) {
    failGraphics(error);
  }
  try {
    faults?.beforeFeedback("audio", update.events);
    audio.feedback(update.events, now);
  } catch {
    failAudio();
  }
  if (graphicsAvailable && previousBoardId !== state.playerPosition.boardId) beginSceneTransition();
  if (command.kind !== "Tick" && command.kind !== "CancelAutoPath") shell.showActionFeedback();
  render();
  if (
    graphicsAvailable &&
    !scopeWasComplete &&
    state.completedObjectiveIds.includes(content.profile.scopeTerminalObjectiveId)
  ) {
    const supplies = supplyProgress(content, state);
    send({ kind: "Pause", reason: "manual", present: true }, now);
    const continueExploring = () => {
      shell.dismissDecision();
      send({
        kind: "Resume",
        pageVisible: document.visibilityState === "visible",
        canvasOperable: true,
        graphicsAvailable,
      });
      shell.canvas.focus();
    };
    shell.showDecision(
      content.profile.fullCampaign ? "中央仓库 · 主目标完成" : "本版本主路径完成",
      `${content.profile.id} · 已收集 ${supplies.collected} / ${supplies.total} 单位物资。${content.profile.fullCampaign ? "四区数据已汇齐，中央终端已经完成。" : "本版本终点已抵达，未来地区在后续内容包开放。"}可以继续探索、补齐物资和重玩挑战。`,
      [
        {
          label: "继续自由探索",
          primary: true,
          action: continueExploring,
        },
        { label: "导出完成进度", action: exportCurrent },
      ],
      continueExploring,
    );
  }
}
function showGraphicsFailure() {
  shell.showDecision(
    "图形暂时不可用",
    `需要支持 WebGL2 的桌面浏览器。进度已保留，可重试图形或导出。${graphicsError}`,
    [
      {
        label: "重试图形",
        primary: true,
        action: () => {
          initializeRenderer();
          if (!graphicsAvailable) return;
          shell.dismissDecision();
          if (state) {
            send({ kind: "Pause", reason: "graphicsLost", present: false });
            openLoadedPanel("pause");
          } else showStartup();
        },
      },
      { label: "导出进度", action: exportCurrent },
      { label: "导入存档", action: () => shell.requestImport() },
      ...(["a", "b"] as const)
        .filter(
          (id) => inspection?.slots[id].raw !== null && inspection?.slots[id].raw !== undefined,
        )
        .map((id) => ({ label: `导出原始槽 ${id.toUpperCase()}`, action: () => exportSlot(id) })),
    ],
  );
}
function failGraphics(error: unknown) {
  transitionSequence += 1;
  transitioning = false;
  shell.setTransition(false);
  graphicsAvailable = false;
  graphicsError = error instanceof Error ? error.message : "请重试。";
  input?.clear();
  if (state) {
    send({ kind: "Pause", reason: "graphicsLost", present: true });
    if (state.clock.pauseReasons.includes("transition"))
      send({ kind: "Pause", reason: "transition", present: false });
  }
  showGraphicsFailure();
}
function initializeRenderer() {
  try {
    renderer?.dispose();
    renderer = null;
    faults?.beforeRendererStart();
    renderer = new BoardRenderer(shell.canvas, shell.labels, (tileId) => {
      if (!shell.dialog.open && !transitioning) send({ kind: "ClickTile", tileId });
    });
    configureViewportInsets();
    graphicsAvailable = true;
    graphicsError = "";
    lastProjection = "";
    if (state) beginSceneTransition();
  } catch (error) {
    failGraphics(error);
  }
}
function configureViewportInsets() {
  const style = getComputedStyle(shell.canvas);
  renderer?.setViewportInsets({
    left: Number.parseFloat(style.getPropertyValue("--board-inset-left")) || 0,
    right: Number.parseFloat(style.getPropertyValue("--board-inset-right")) || 0,
    top: 8,
    bottom: 8,
  });
}
initializeRenderer();
const viewportObserver = new ResizeObserver(configureViewportInsets);
viewportObserver.observe(shell.canvas);
input = new InputAdapter(
  shell.canvas,
  send,
  () => ({
    firewall: state?.activeRealtime?.state.kind === "firewall",
    canPlay:
      !!state &&
      canPlayLoadedProgress() &&
      graphicsAvailable &&
      !transitioning &&
      !shell.dialog.open &&
      !state.clock.awaitingResume &&
      state.clock.pauseReasons.length === 0 &&
      state.clock.countdownRemainingMs === 0,
  }),
  () => openLoadedPanel("map"),
  () => openLoadedPanel("pause"),
  (now) => {
    if (state?.autoPath.length) send({ kind: "CancelAutoPath" }, now);
  },
);
document.addEventListener("visibilitychange", () => {
  if (import.meta.env.MODE === "acceptance")
    sessionDiagnostics?.record("visibilitychange", {
      hidden: document.hidden,
      pending: !!sessionRequest,
      session: session.status(),
    });
  if (document.hidden && sessionRequest) {
    retrySessionWhenVisible = true;
    sessionRequest.abort();
    sessionRequest = null;
  } else if (!document.hidden && retrySessionWhenVisible) {
    void acquireSession();
  }
  if (state) send({ kind: "Pause", reason: "hidden", present: document.hidden });
});
window.addEventListener("blur", () => {
  if (state) send({ kind: "Pause", reason: "blur", present: true });
});
window.addEventListener("focus", () => {
  if (state) send({ kind: "Pause", reason: "blur", present: false });
});
window.addEventListener("pagehide", (event) => {
  if (import.meta.env.MODE === "acceptance")
    sessionDiagnostics?.record("pagehide-start", {
      persisted: event.persisted,
      pending: !!sessionRequest,
      session: session.status(),
      loaded: state !== null,
    });
  if (state) send({ kind: "Pause", reason: "hidden", present: true });
  loadedProgress.suspend();
  if (import.meta.env.MODE === "acceptance") sessionDiagnostics?.record("pagehide-after-pause");
  sessionRequest?.abort();
  sessionRequest = null;
  retrySessionWhenVisible = false;
  if (import.meta.env.MODE === "acceptance")
    sessionDiagnostics?.record("release-start", { session: session.status() });
  session.release();
  if (import.meta.env.MODE === "acceptance")
    sessionDiagnostics?.record("release-end", { session: session.status() });
});
window.addEventListener("pageshow", (event) => {
  if (import.meta.env.MODE === "acceptance")
    sessionDiagnostics?.record("pageshow", {
      persisted: event.persisted,
      session: session.status(),
    });
  if (event.persisted) {
    input?.clear();
    void acquireSession();
  }
});
shell.canvas.addEventListener("webglcontextlost", (event) => {
  event.preventDefault();
  failGraphics(new Error("图形上下文丢失，时间和输入已暂停。"));
});
shell.canvas.addEventListener("webglcontextrestored", () => {
  initializeRenderer();
  if (graphicsAvailable) {
    shell.dismissDecision();
    if (state) {
      send({ kind: "Pause", reason: "graphicsLost", present: false });
      openLoadedPanel("pause");
    } else showStartup();
  }
});
function frame(now: number) {
  if (!state) updateInspectionText();
  for (const startedAt of awaitingPaintInputs) inputLatencies.push(Math.max(0, now - startedAt));
  if (inputLatencies.length > 300) inputLatencies.splice(0, inputLatencies.length - 300);
  awaitingPaintInputs = [];
  if (state && graphicsAvailable) {
    send({ kind: "Tick" }, now);
    input?.frame(now);
    const autoCommand = autoWalk.nextCommand(
      now,
      canPlayLoadedProgress() && !shell.dialog.open && !transitioning,
    );
    if (autoCommand) send(autoCommand, now);
    const definition = content.realtimeChallenges.find(
      (candidate) => candidate.id === state?.activeRealtime?.roomId,
    );
    try {
      audio.syncFirewall(state, definition?.kind === "firewall" ? definition : undefined, now);
    } catch {
      failAudio();
    }
    if (
      !shell.dialog.open &&
      !transitioning &&
      previousFrame &&
      document.visibilityState === "visible"
    ) {
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
  if (graphicsAvailable)
    try {
      renderer?.frame(now);
      if (!transitioning) {
        awaitingPaintInputs = pendingInputs;
        pendingInputs = [];
      }
    } catch (error) {
      failGraphics(error);
    }
  previousFrame = now;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
void acquireSession();
