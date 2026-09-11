import { MAX_SAVE_BYTES, SAVE_KEYS } from "./save-store.ts";
import type { SaveStorage } from "./save-store.ts";

export type AcceptanceStorageTarget = keyof typeof SAVE_KEYS;
export type AcceptanceStorageOperation = "get" | "set" | "readback";
export type AcceptanceFeedbackChannel = "audio" | "render";

export interface AcceptanceContextExtension {
  loseContext(): void;
  restoreContext(): void;
}

export interface AcceptanceWebGLContext {
  getExtension(name: "WEBGL_lose_context"): AcceptanceContextExtension | null;
  isContextLost(): boolean;
}

export interface AcceptanceFaultOptions {
  readonly buildMode: string;
  readonly storage: SaveStorage;
  readonly getContext: () => AcceptanceWebGLContext | null;
  readonly isForeground: () => boolean;
  readonly startupSearch?: string;
  readonly mayWriteTestSlots?: () => boolean;
}

export interface AcceptanceArmedStorageFault {
  readonly operation: AcceptanceStorageOperation;
  readonly target: AcceptanceStorageTarget;
  readonly awaitingReadback: boolean;
}

export interface AcceptanceFaultSnapshot {
  readonly active: boolean;
  readonly storage: AcceptanceArmedStorageFault | null;
  readonly feedback: AcceptanceFeedbackChannel | null;
  readonly rendererStartup: boolean;
  readonly audioEnable: boolean;
  readonly records: readonly { readonly sequence: number; readonly message: string }[];
}

export interface AcceptanceFaultAction {
  readonly ok: boolean;
  readonly message: string;
  readonly elapsedMs?: number;
}

export interface AcceptanceFaultController {
  readonly storage: SaveStorage;
  beforeRendererStart(): void;
  beforeAudioEnable(): void;
  armAudioRejection(): AcceptanceFaultAction;
  injectRawSlot(target: "a" | "b", raw: string): AcceptanceFaultAction;
  beforeFeedback(
    channel: AcceptanceFeedbackChannel,
    events: readonly { readonly kind: string }[],
  ): void;
  armStorage(
    operation: AcceptanceStorageOperation,
    target: AcceptanceStorageTarget,
  ): AcceptanceFaultAction;
  armFeedback(channel: AcceptanceFeedbackChannel): AcceptanceFaultAction;
  clearArmedFaults(): void;
  requestContextLoss(): AcceptanceFaultAction;
  requestContextRestore(): AcceptanceFaultAction;
  blockForeground(): AcceptanceFaultAction;
  snapshot(): AcceptanceFaultSnapshot;
  mountPanel(host: HTMLElement, modal?: HTMLDialogElement): () => void;
  dispose(): void;
}

const STORAGE_LABELS: Record<AcceptanceStorageTarget, string> = {
  a: "槽 A",
  b: "槽 B",
  preMigration: "迁移前原槽备份",
};

const DISABLED_ACTION = { ok: false, message: "验收故障控制器已停用。" } as const;

// Import this module only inside Vite's compile-time MODE === "acceptance" branch.
// It accepts platform ports and feedback descriptions, never game state or commands.
export function createAcceptanceFaults(
  options: AcceptanceFaultOptions,
): AcceptanceFaultController | null {
  if (options.buildMode !== "acceptance") return null;

  let active = true;
  let storageFault: AcceptanceArmedStorageFault | null = null;
  let feedbackFault: AcceptanceFeedbackChannel | null = null;
  let rendererStartup = new URLSearchParams(options.startupSearch ?? "")
    .getAll("acceptanceFault")
    .includes("webgl2-unavailable");
  let audioEnable = new URLSearchParams(options.startupSearch ?? "")
    .getAll("acceptanceFault")
    .includes("audio-denied");
  let sequence = 0;
  const records: { sequence: number; message: string }[] = [];
  const panels = new Map<() => void, () => void>();
  let recovery: {
    context: AcceptanceWebGLContext;
    extension: AcceptanceContextExtension;
    restoreRequested: boolean;
  } | null = null;

  function record(message: string): AcceptanceFaultAction {
    records.push({ sequence: ++sequence, message });
    if (records.length > 12) records.shift();
    for (const refresh of panels.keys()) refresh();
    return { ok: true, message };
  }

  function unavailable(message: string): AcceptanceFaultAction {
    record(message);
    return { ok: false, message };
  }

  function snapshot(): AcceptanceFaultSnapshot {
    return {
      active,
      storage: storageFault ? { ...storageFault } : null,
      feedback: feedbackFault,
      rendererStartup,
      audioEnable,
      records: records.map((item) => ({ ...item })),
    };
  }

  if (rendererStartup) record("已配置本次启动模拟 WebGL2 不可用；首次初始化消耗一次。");

  const storage: SaveStorage = {
    getItem(key) {
      if (active && storageFault && key === SAVE_KEYS[storageFault.target]) {
        if (storageFault.operation === "get") {
          storageFault = null;
          record(`已触发一次读取拒绝：${key}`);
          throw new DOMException(`[验收故障] 读取被拒绝：${key}`, "SecurityError");
        }
        if (storageFault.operation === "readback" && storageFault.awaitingReadback) {
          storageFault = null;
          record(`已触发一次回读不匹配：${key}；实际槽字节保留。`);
          return "{acceptance-readback-mismatch";
        }
      }
      return options.storage.getItem(key);
    },
    setItem(key, value) {
      if (active && storageFault?.operation === "set" && key === SAVE_KEYS[storageFault.target]) {
        storageFault = null;
        record(`已触发一次写入拒绝：${key}`);
        throw new DOMException(`[验收故障] 写入额度不足：${key}`, "QuotaExceededError");
      }
      options.storage.setItem(key, value);
      if (
        active &&
        storageFault?.operation === "readback" &&
        key === SAVE_KEYS[storageFault.target]
      ) {
        storageFault = { ...storageFault, awaitingReadback: true };
        record(`目标写入成功，等待其下一次回读：${key}`);
      }
    },
  };

  const controller: AcceptanceFaultController = {
    storage,
    snapshot,
    injectRawSlot(target, raw) {
      if (!active) return DISABLED_ACTION;
      if (!options.mayWriteTestSlots?.()) return unavailable("未持有单写会话，拒绝故障槽写入。");
      if (target !== "a" && target !== "b") return unavailable("故障原文只允许写入槽 A 或 B。");
      if (new TextEncoder().encode(raw).byteLength > MAX_SAVE_BYTES)
        return unavailable("故障原文超过单槽大小限制。");
      try {
        options.storage.setItem(SAVE_KEYS[target], raw);
        return record(
          `已写入指定故障槽 ${target.toUpperCase()}；仅用于存储边界验收，正常通关证据不得使用此入口。`,
        );
      } catch {
        return unavailable("故障原文写入被存储端口拒绝。");
      }
    },
    beforeAudioEnable() {
      if (!active || !audioEnable) return;
      audioEnable = false;
      record("已拒绝一次音频启用，未改变进度或时间。");
      throw new DOMException("[验收故障] 音频启用被拒绝。", "NotAllowedError");
    },
    armAudioRejection() {
      if (!active) return DISABLED_ACTION;
      audioEnable = true;
      return record("已配置下次音频启用被拒绝。");
    },
    beforeRendererStart() {
      if (!active || !rendererStartup) return;
      rendererStartup = false;
      record("已触发一次启动 WebGL2 不可用；可用正常图形重试按钮恢复。");
      throw new Error("[验收故障] 模拟本次启动无法取得 WebGL2 上下文。");
    },
    beforeFeedback(channel, events) {
      if (!active || feedbackFault !== channel || !events.some((event) => event.kind === "success"))
        return;
      feedbackFault = null;
      record(`已触发一次成功后的 ${channel === "audio" ? "音频" : "渲染"}反馈异常。`);
      throw new Error(`[验收故障] 成功后的 ${channel} 反馈异常。`);
    },
    armStorage(operation, target) {
      if (!active) return DISABLED_ACTION;
      if (!["get", "set", "readback"].includes(operation) || !Object.hasOwn(SAVE_KEYS, target))
        return unavailable("拒绝未知存储故障或非存档目标键。");
      storageFault = { operation, target, awaitingReadback: false };
      return record(
        `已配置 ${STORAGE_LABELS[target]} 的一次 ${operation} 故障：${SAVE_KEYS[target]}`,
      );
    },
    armFeedback(channel) {
      if (!active) return DISABLED_ACTION;
      if (channel !== "audio" && channel !== "render") return unavailable("拒绝未知反馈故障。");
      feedbackFault = channel;
      return record(`已配置下一次成功后的 ${channel === "audio" ? "音频" : "渲染"}反馈异常。`);
    },
    clearArmedFaults() {
      if (!active) return;
      storageFault = null;
      feedbackFault = null;
      rendererStartup = false;
      audioEnable = false;
      record("已解除所有未触发故障；真实上下文若已丢失，仍需请求恢复。");
    },
    requestContextLoss() {
      if (!active) return DISABLED_ACTION;
      try {
        const context = options.getContext();
        if (!context) return unavailable("没有可请求丢失的实际图形上下文。");
        if (context.isContextLost()) return unavailable("实际图形上下文已经丢失。");
        const extension = context.getExtension("WEBGL_lose_context");
        if (!extension) return unavailable("当前浏览器未提供 WEBGL_lose_context 扩展。");
        extension.loseContext();
        recovery = { context, extension, restoreRequested: false };
        return record("已请求浏览器丢失真实上下文；实际事件与暂停结果由游戏界面确认。");
      } catch {
        return unavailable("浏览器拒绝上下文丢失请求；未派发模拟事件。");
      }
    },
    requestContextRestore() {
      if (!active) return DISABLED_ACTION;
      try {
        const context = recovery?.context ?? options.getContext();
        if (!context?.isContextLost()) return unavailable("没有已丢失的实际上下文可恢复。");
        if (recovery?.restoreRequested) return unavailable("已请求恢复，正在等待浏览器事件。");
        const extension = recovery?.extension ?? context.getExtension("WEBGL_lose_context");
        if (!extension) return unavailable("无法取得该上下文的恢复扩展。");
        extension.restoreContext();
        recovery = { context, extension, restoreRequested: true };
        return record("已请求浏览器恢复真实上下文；等待图形重建与显式继续。");
      } catch {
        return unavailable("浏览器拒绝上下文恢复请求；未派发模拟事件。");
      }
    },
    blockForeground() {
      if (!active) return DISABLED_ACTION;
      if (!options.isForeground()) return unavailable("页面不在前台，未执行阻塞。");
      const started = performance.now();
      let ended = started;
      while (ended - started < 300) ended = performance.now();
      const elapsedMs = ended - started;
      const result = record(`已实际阻塞前台 ${elapsedMs.toFixed(1)}ms；未推进或改写游戏时钟。`);
      return { ...result, elapsedMs };
    },
    mountPanel(host, modal) {
      if (!active) return () => {};
      const document = host.ownerDocument;
      const panel = document.createElement("details");
      panel.className = "camellia-acceptance-faults";
      panel.dataset.acceptanceFaults = "true";
      const style = document.createElement("style");
      style.textContent = `
        .camellia-acceptance-faults { position:fixed; z-index:10000; bottom:8px; right:8px;
          box-sizing:border-box; width:min(420px,calc(100vw - 16px)); max-height:70vh;
          overflow:auto; padding:8px; border:2px solid #ffd664; border-radius:8px;
          color:#f4f4f4; background:#181922; font:14px/1.4 system-ui,sans-serif; }
        .camellia-acceptance-faults summary { min-height:44px; cursor:pointer; font-weight:700; }
        .camellia-acceptance-faults fieldset { margin:8px 0; padding:8px; border:1px solid #aaa; }
        .camellia-acceptance-faults button,.camellia-acceptance-faults select,
        .camellia-acceptance-faults a { box-sizing:border-box; display:block; width:100%;
          min-height:44px; margin:4px 0; padding:8px; border:1px solid #aaa;
          color:#fff; background:#30323e; border-radius:4px; text-align:left; font:inherit; }
        .camellia-acceptance-faults :focus-visible { outline:3px solid #ffd664; outline-offset:2px; }
        .camellia-acceptance-faults output { display:block; white-space:pre-wrap; overflow-wrap:anywhere; }
      `;
      const summary = document.createElement("summary");
      summary.textContent = "验收故障控制 · 仅平台";
      const description = document.createElement("p");
      description.textContent = "边界故障证据与正常通关证据分开记录。每个已配置故障只触发一次。";
      panel.append(style, summary, description);
      const group = (label: string) => {
        const fieldset = document.createElement("fieldset");
        const legend = document.createElement("legend");
        legend.textContent = label;
        fieldset.append(legend);
        panel.append(fieldset);
        return fieldset;
      };
      const button = (parent: HTMLElement, label: string, action: () => unknown) => {
        const control = document.createElement("button");
        control.type = "button";
        control.textContent = label;
        control.addEventListener("click", () => action());
        parent.append(control);
      };
      const storageGroup = group("精确存储目标");
      const target = document.createElement("select");
      target.setAttribute("aria-label", "故障存储目标键");
      for (const id of ["a", "b", "preMigration"] as const) {
        const option = document.createElement("option");
        option.value = id;
        option.textContent = `${STORAGE_LABELS[id]} · ${SAVE_KEYS[id]}`;
        target.append(option);
      }
      storageGroup.append(target);
      for (const [operation, label] of [
        ["get", "下次读取抛错"],
        ["set", "下次写入抛错"],
        ["readback", "下次成功写入后回读不匹配"],
      ] as const)
        button(storageGroup, label, () =>
          controller.armStorage(operation, target.value as AcceptanceStorageTarget),
        );
      const fixtureGroup = group("存储损坏与版本保护夹具");
      const warning = document.createElement("p");
      warning.textContent =
        "先用游戏导出保存备份。此入口只修改上方选中的 A/B 测试槽原文，不能用于制造通关结果。写入后重新读取或刷新验证。";
      const fixture = document.createElement("textarea");
      fixture.setAttribute("aria-label", "测试槽原文");
      fixture.rows = 3;
      fixture.style.width = "100%";
      fixtureGroup.append(warning, fixture);
      button(fixtureGroup, "写入指定测试槽", () => {
        if (target.value === "a" || target.value === "b")
          controller.injectRawSlot(target.value, fixture.value);
        else unavailable("故障原文只允许写入槽 A 或 B。");
      });
      const feedbackGroup = group("下一次成功反馈");
      button(feedbackGroup, "下次启用声音被拒绝", () => controller.armAudioRejection());
      button(feedbackGroup, "成功后音频抛错", () => controller.armFeedback("audio"));
      button(feedbackGroup, "成功后渲染抛错", () => controller.armFeedback("render"));
      const graphicsGroup = group("图形与调度");
      const restart = document.createElement("a");
      const startup = new URL(document.URL);
      startup.searchParams.set("acceptanceFault", "webgl2-unavailable");
      restart.href = startup.href;
      restart.textContent = "重新载入并模拟启动 WebGL2 不可用";
      graphicsGroup.append(restart);
      button(graphicsGroup, "请求真实上下文丢失", () => controller.requestContextLoss());
      button(graphicsGroup, "请求真实上下文恢复", () => controller.requestContextRestore());
      button(graphicsGroup, "实际阻塞前台 300ms", () => controller.blockForeground());
      button(panel, "解除未触发故障", () => controller.clearArmedFaults());
      const status = document.createElement("output");
      status.setAttribute("aria-label", "验收故障状态与触发记录");
      status.setAttribute("aria-live", "polite");
      panel.append(status);
      const refresh = () => {
        const value = snapshot();
        const storageLabel = value.storage
          ? `${STORAGE_LABELS[value.storage.target]} / ${value.storage.operation}${value.storage.awaitingReadback ? " / 等待回读" : ""}`
          : "无";
        status.textContent = [
          `待触发：存储 ${storageLabel}；成功反馈 ${value.feedback ?? "无"}；启动图形 ${value.rendererStartup ? "一次" : "无"}；音频启用 ${value.audioEnable ? "拒绝一次" : "正常"}`,
          ...value.records.map((item) => `${item.sequence}. ${item.message}`),
        ].join("\n");
      };
      const placePanel = () => {
        const destination = modal?.open ? modal : host;
        if (panel.parentNode !== destination) destination.append(panel);
      };
      const observer = modal ? new MutationObserver(placePanel) : null;
      observer?.observe(modal!, { childList: true, attributes: true, attributeFilter: ["open"] });
      const unmount = () => {
        observer?.disconnect();
        panels.delete(refresh);
        panel.remove();
      };
      panels.set(refresh, unmount);
      refresh();
      placePanel();
      return unmount;
    },
    dispose() {
      if (!active) return;
      active = false;
      storageFault = null;
      feedbackFault = null;
      rendererStartup = false;
      audioEnable = false;
      for (const unmount of panels.values()) unmount();
    },
  };
  return controller;
}
