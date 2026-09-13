import { areaData, AREA_LABELS, currentObjective, supplyProgress } from "../core/progress.ts";
import { entitiesAt } from "../core/engine.ts";
import type { GameCommand, GameContent, GameSettings, GameState } from "../core/types.ts";
import { REWARD_LABELS } from "./labels.ts";
import { firewallCue } from "./firewall-cue.ts";
import { firewallFeedback } from "../core/firewall-feedback.ts";
import { canReceiveMenuFocus, DialogNavigation } from "./menu-navigation.ts";
import { antivirusActiveTargets, antivirusRequiredScore } from "../core/realtime.ts";
import { theftPortSatisfied } from "../core/data-theft.ts";

export interface ShellActions {
  send: (command: GameCommand) => void;
  start: (confirmed?: boolean) => void;
  export: () => void;
  import: (file: File) => void;
  save: () => void;
  reload: () => void;
  enableAudio: () => void;
}
function button(label: string, action: () => void, className = ""): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  element.className = className;
  element.addEventListener("click", action);
  return element;
}
function text(tag: string, value: string, className = ""): HTMLElement {
  const node = document.createElement(tag);
  node.textContent = value;
  node.className = className;
  return node;
}

export class GameShell {
  readonly canvas: HTMLCanvasElement;
  readonly labels: HTMLElement;
  readonly dialog: HTMLDialogElement;
  private readonly content: GameContent;
  private readonly actions: ShellActions;
  private readonly element: HTMLElement;
  private state: GameState | null = null;
  private dialogKey = "";
  private panel: "none" | "pause" | "map" | "settings" | "collection" | "storage" = "none";
  private panelParent: "none" | "pause" = "none";
  private readonly navigation: DialogNavigation;
  private previousFocus: HTMLElement | null = null;
  private readonly fields: Record<string, HTMLElement> = {};
  private restoreFocus = true;
  private externalModal = false;
  private externalCancel: (() => void) | null = null;
  private transitioning = false;
  private settingsKey = "";
  private lastFeedback: GameState["lastResult"] | null = null;
  private feedbackVisibleUntil = 0;
  saveLabel = "正在读取进度";

  constructor(root: HTMLElement, content: GameContent, actions: ShellActions) {
    this.content = content;
    this.actions = actions;
    root.innerHTML = `<main class="game-shell"><header class="hud-top"><div class="brand"><span class="brand-mark">CGW</span><span>沙罗黄金周<small>CAMELLIA GOLDEN WEEK</small></span></div><div class="mission"><span class="eyebrow">当前目标</span><strong id="mission-text"></strong></div><div class="save-area"><span class="status-dot"></span><span id="save-status" role="status"></span></div><button id="menu-button" aria-label="打开暂停菜单">菜单 <kbd>Esc</kbd></button></header><section class="playfield"><canvas id="game-canvas" tabindex="0" aria-label="电视探索棋盘，方向键移动，F交互，R增幅，M区域图，Esc暂停"></canvas><div id="tile-labels" aria-hidden="true"></div><div class="vignette" aria-hidden="true"></div><div id="firewall-screen-light" class="firewall-screen-light" aria-hidden="true" hidden></div><div class="area-title"><span class="eyebrow" id="area-subtitle"></span><h1 id="area-name"></h1><span class="area-coordinates" id="area-coordinates"></span></div><aside class="progress-rail"><span class="rail-label">区域数据</span><strong id="area-data"></strong><span id="full-data"></span><div class="rail-divider"></div><span class="rail-label">沙罗物资</span><strong id="supplies"></strong><span id="amplifier"></span><button id="collection-button">收集记录 ↗</button></aside><div class="scene-transition" role="status" hidden>正在连接电视…</div><button class="audio-prompt" hidden>启用声音</button><div class="mode-banner" id="mode-banner" role="status"></div><div class="context-tip" id="context-tip"></div><div class="challenge-meter" id="challenge-meter" hidden><div id="challenge-summary"></div><section id="firewall-rhythm" class="firewall-rhythm" aria-label="防火墙拍点" hidden><div class="firewall-count"><span>拍点</span><span id="firewall-beat-count"></span></div><strong id="firewall-beat-status" class="firewall-beat-status"></strong><div class="firewall-track" aria-hidden="true"><span class="firewall-window"></span><span class="firewall-center"></span><span class="firewall-cursor"></span></div><span class="firewall-instruction">看到“现在移动”，每拍一次</span></section></div></section><footer class="hud-bottom"><div class="controls" id="controls"></div></footer><dialog id="game-dialog" aria-labelledby="dialog-title"></dialog><p class="small-window">建议将窗口扩大至 1024 × 640 以上；菜单与存档功能仍可使用。</p></main>`;
    const canvas = root.querySelector<HTMLCanvasElement>("#game-canvas");
    const labels = root.querySelector<HTMLElement>("#tile-labels");
    const dialog = root.querySelector<HTMLDialogElement>("#game-dialog");
    if (!canvas || !labels || !dialog) throw new Error("游戏界面初始化失败");
    this.canvas = canvas;
    this.labels = labels;
    this.dialog = dialog;
    this.navigation = new DialogNavigation(dialog);
    this.element = root.querySelector<HTMLElement>(".game-shell")!;
    const firewallOverlay = document.createElement("section");
    firewallOverlay.id = "firewall-overlay";
    firewallOverlay.className = "firewall-overlay";
    firewallOverlay.hidden = true;
    firewallOverlay.innerHTML = `<div id="firewall-impact" class="firewall-impact" aria-hidden="true"></div><aside class="firewall-help"><span class="firewall-help-icon" aria-hidden="true">♪</span>跟随音乐与<em>白光</em>踩拍。<br>朝箭头方向迎向警报，可完美闪避。<br><span class="firewall-penalties">错拍 −1 · 警报命中 −5</span></aside><output id="firewall-feedback" class="firewall-feedback" aria-live="polite" aria-atomic="true"></output><div class="firewall-run-status"><span id="firewall-difficulty"></span><span id="firewall-goal"></span><span id="firewall-time"></span></div><progress id="firewall-song-progress" class="firewall-song-progress" max="1" value="0" aria-label="挑战时间进度"></progress><output id="firewall-combo-value" class="visually-hidden" aria-label="当前连击"></output>`;
    root.querySelector(".playfield")!.append(firewallOverlay);
    const antivirusOverlay = document.createElement("section");
    antivirusOverlay.id = "antivirus-overlay";
    antivirusOverlay.className = "antivirus-overlay";
    antivirusOverlay.hidden = true;
    antivirusOverlay.innerHTML = `<strong id="antivirus-heading" class="antivirus-heading"></strong><aside id="antivirus-status" class="antivirus-status"><div class="antivirus-count"><span>侵蚀数据</span><strong id="antivirus-count"></strong></div><p>保持 9 个以内，第 10 个出现即失败。</p><output id="antivirus-last-clear" class="antivirus-last-clear" aria-live="polite"></output></aside><div class="antivirus-run"><span id="antivirus-score"></span><span id="antivirus-time"></span></div><div class="antivirus-legend">蓝色 +1 · 紫色 +2 · 金星清除全部蓝紫数据</div>`;
    root.querySelector(".playfield")!.append(antivirusOverlay);
    for (const id of [
      "mission-text",
      "area-subtitle",
      "area-name",
      "area-coordinates",
      "area-data",
      "full-data",
      "supplies",
      "amplifier",
      "mode-banner",
      "context-tip",
      "challenge-meter",
      "challenge-summary",
      "firewall-rhythm",
      "firewall-beat-count",
      "firewall-beat-status",
      "firewall-screen-light",
      "firewall-overlay",
      "firewall-difficulty",
      "firewall-goal",
      "firewall-time",
      "firewall-song-progress",
      "firewall-combo-value",
      "firewall-feedback",
      "firewall-impact",
      "antivirus-overlay",
      "antivirus-heading",
      "antivirus-status",
      "antivirus-count",
      "antivirus-score",
      "antivirus-time",
      "antivirus-last-clear",
      "controls",
      "save-status",
    ]) {
      const element = root.querySelector<HTMLElement>(`#${id}`);
      if (element) this.fields[id] = element;
    }
    root.querySelector("#menu-button")?.addEventListener("click", () => this.openPanel("pause"));
    root
      .querySelector("#collection-button")
      ?.addEventListener("click", () => this.openPanel("collection"));
    const cancelDialog = () => {
      if (this.externalModal) {
        this.externalCancel?.();
        return;
      }
      if (this.panel !== "none" || this.dialogKey.startsWith("panel:")) {
        if (this.panelParent === "pause") this.openPanel("pause");
        else this.resume();
      } else if (this.state?.mode === "challengeReady" || this.state?.mode === "challengeResult")
        this.actions.send({ kind: "ExitRoom" });
    };
    dialog.addEventListener("keydown", (event) => {
      this.navigation.handleKey(event, cancelDialog);
    });
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      cancelDialog();
    });
    root.querySelector(".audio-prompt")?.addEventListener("click", this.actions.enableAudio);
    this.showStart();
  }
  private set(id: string, value: string) {
    const element = this.fields[id];
    if (element && element.textContent !== value) element.textContent = value;
  }
  private modal(title: string, description: string, key: string) {
    if (this.dialogKey === key) return false;
    this.navigation.begin(key.startsWith("panel:") ? `panel:${key.split(":")[1]}` : key);
    this.dialogKey = key;
    if (!this.dialog.open) {
      this.restoreFocus = true;
      this.previousFocus =
        document.activeElement instanceof HTMLElement ? document.activeElement : this.canvas;
    }
    this.dialog.replaceChildren();
    this.dialog.append(
      text("span", "CAMELLIA / TERMINAL", "eyebrow"),
      text("h2", title),
      text("p", description, "dialog-description"),
      text(
        "p",
        "↑ ↓ / W S 选择 · Enter / 空格确认 · Esc 返回 · Tab 切换控件",
        "menu-keyboard-hint",
      ),
    );
    const heading = this.dialog.querySelector("h2");
    if (heading) heading.id = "dialog-title";
    if (!this.dialog.open) this.dialog.showModal();
    return true;
  }
  private close() {
    this.navigation.close();
    if (this.dialog.open) this.dialog.close();
    this.dialogKey = "";
    if (this.restoreFocus) {
      (this.previousFocus && canReceiveMenuFocus(this.previousFocus)
        ? this.previousFocus
        : this.canvas
      )?.focus({
        preventScroll: true,
      });
      this.restoreFocus = false;
    }
  }
  showStart() {
    this.modal("沙罗黄金周", "进入电视空洞，沿机关和数据线索探索四区。", "start");
    this.dialog.append(
      text("p", `${this.content.profile.id} · 单人本地探索 · WASD / 方向键移动`, "muted"),
      button(
        "新游戏",
        () => {
          this.close();
          this.actions.start();
          this.canvas.focus();
        },
        "primary",
      ),
      button("导入存档", () => this.pickImport()),
    );
  }
  private pickImport() {
    const opener = document.activeElement;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.hidden = true;
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      input.remove();
      if (file) this.actions.import(file);
    });
    input.addEventListener(
      "cancel",
      () => {
        input.remove();
        if (opener instanceof HTMLElement && canReceiveMenuFocus(opener)) opener.focus();
      },
      { once: true },
    );
    document.body.append(input);
    input.click();
  }
  openPanel(panel: typeof this.panel = "pause") {
    if (!this.state) return;
    this.panelParent =
      panel === "settings" ||
      panel === "storage" ||
      (panel !== "pause" && (this.panel === "pause" || this.dialogKey.startsWith("panel:pause:")))
        ? "pause"
        : "none";
    this.panel = panel;
    this.dialogKey = "";
    this.restoreFocus = true;
    this.actions.send({ kind: "Pause", reason: "manual", present: true });
    this.renderPanel();
  }
  private resume() {
    this.panel = "none";
    this.panelParent = "none";
    this.close();
    this.actions.send({
      kind: "Resume",
      pageVisible: document.visibilityState === "visible",
      canvasOperable: true,
      graphicsAvailable: true,
    });
  }
  private renderPanel() {
    const state = this.state;
    if (!state) return;
    const panel = this.panel === "none" ? "pause" : this.panel;
    const titles = {
      pause: "探索已暂停",
      map: "区域图与传送",
      settings: "声音与显示",
      collection: "收集记录",
      storage: "进度与存档",
    };
    const pauseReason = state.clock.pauseReasons.includes("clockGap")
      ? "检测到前台调度中断，时间已冻结且未补跑。"
      : state.clock.pauseReasons.includes("graphicsLost")
        ? "图形上下文暂时不可用，等待重建后继续。"
        : state.clock.pauseReasons.some((reason) => reason === "hidden" || reason === "blur")
          ? "窗口失去焦点，时间与输入已冻结。"
          : "时间已冻结。";
    if (
      !this.modal(
        titles[panel],
        panel === "map"
          ? "只显示已发现的位置；仅可传送至已激活的入口。"
          : `${pauseReason}返回地图后，实时挑战有 3 秒准备倒数。`,
        `panel:${panel}:${state.clock.pauseReasons.join(",")}`,
      )
    )
      return;
    if (panel === "pause") {
      this.dialog.append(
        button("继续探索", () => this.resume(), "primary"),
        button("区域图与传送 · M", () => this.openPanel("map")),
        button("声音与显示", () => this.openPanel("settings")),
        button("收集记录", () => this.openPanel("collection")),
        button("进度与存档", () => this.openPanel("storage")),
      );
      if (
        state.activeStatic ||
        state.activeRealtime ||
        state.activeCompletedRoom ||
        state.mode === "challengeReady"
      )
        this.dialog.append(
          button(state.activeCompletedRoom ? "返回外层入口" : "放弃本次尝试，返回入口", () => {
            this.resume();
            this.actions.send({ kind: "ExitRoom" });
          }),
        );
    }
    if (panel === "map") {
      const map = document.createElement("div");
      map.className = "region-map";
      for (const area of ["hub", "a", "b", "c", "d", "warehouse"] as const) {
        const included = this.content.profile.includedAreaIds.includes(area);
        const destination = this.content.areas.find((item) => item.id === area);
        const activated =
          destination && state.activatedTeleportIds.includes(destination.teleportId);
        const item = button(
          `${AREA_LABELS[area]} · ${!included ? "本版本未收录" : activated ? "已激活" : "尚未到达"}`,
          () => {
            if (destination) {
              this.resume();
              this.actions.send({ kind: "Teleport", teleportId: destination.teleportId });
              this.canvas.focus();
            }
          },
        );
        item.disabled = !activated || state.mode !== "explore";
        map.append(item);
      }
      this.dialog.append(map);
      if (state.playerPosition.space === "world") {
        const discovered = this.content.tiles.filter(
          (tile) =>
            tile.boardId === state.playerPosition.boardId &&
            state.discoveredTileIds.includes(tile.id),
        );
        const mini = document.createElement("div");
        mini.className = "discovered-map";
        const minX = Math.min(...discovered.map((tile) => tile.x)),
          minY = Math.min(...discovered.map((tile) => tile.y));
        for (const tile of discovered) {
          const cell = text(
            "span",
            tile.id === state.playerPosition.tileId ? "◎" : "▪",
            tile.id === state.playerPosition.tileId ? "current" : "",
          );
          cell.style.gridColumn = String(tile.x - minX + 1);
          cell.style.gridRow = String(tile.y - minY + 1);
          mini.append(cell);
        }
        this.dialog.append(mini);
      }
    }
    if (panel === "settings") {
      const settings = state.settings;
      const update = (patch: Partial<GameSettings>) => {
        this.actions.send({ kind: "Settings", settings: { ...this.state!.settings, ...patch } });
      };
      const range = (
        name: string,
        value: number,
        min: string,
        max: string,
        step: string,
        callback: (value: number) => void,
      ) => {
        const label = document.createElement("label");
        label.className = "setting-row";
        label.append(text("span", name));
        const input = document.createElement("input");
        input.type = "range";
        input.min = min;
        input.max = max;
        input.step = step;
        input.value = String(value);
        input.addEventListener("input", () => callback(Number(input.value)));
        label.append(input);
        this.dialog.append(label);
      };
      range("主音量", settings.masterVolume, "0", "1", "0.05", (masterVolume) =>
        update({ masterVolume }),
      );
      if (state.activeRealtime?.state.kind === "firewall") {
        this.dialog.append(text("p", "防火墙固定显示完整电视墙。", "muted"));
      } else {
        range("棋盘缩放", settings.zoom, "0.75", "1.5", "0.05", (zoom) => update({ zoom }));
        this.dialog.append(text("p", "机关棋盘会限制放大倍数，以保持全盘可见和可点击。", "muted"));
      }
      for (const [key, labelText] of [
        ["muted", "静音"],
        ["reducedFlash", "减少闪烁"],
        ["reducedMotion", "减少动态效果"],
      ] as const) {
        const label = document.createElement("label");
        label.className = "setting-row";
        label.append(text("span", labelText));
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = settings[key];
        input.addEventListener("change", () => update({ [key]: input.checked }));
        label.append(input);
        this.dialog.append(label);
      }
      const quality = document.createElement("select");
      quality.setAttribute("aria-label", "画质");
      for (const [value, label] of [
        ["standard", "标准画质 · DPR 最高 2"],
        ["low", "低画质 · DPR 最高 1"],
      ]) {
        const option = document.createElement("option");
        option.value = value!;
        option.textContent = label!;
        quality.append(option);
      }
      quality.value = settings.quality;
      quality.addEventListener("change", () =>
        update({ quality: quality.value as GameSettings["quality"] }),
      );
      this.dialog.append(quality, button("启用声音", this.actions.enableAudio));
    }
    if (panel === "collection") {
      this.dialog.append(
        text(
          "p",
          `本版本物资 ${supplyProgress(this.content, state).collected} / ${supplyProgress(this.content, state).total} · 永久奖励不会重复领取。`,
        ),
      );
      const dataOverview = text("p", "", "data-overview");
      dataOverview.textContent = (["a", "b", "c", "d"] as const)
        .filter((area) => this.content.profile.includedAreaIds.includes(area))
        .map((area) => {
          const data = areaData(this.content, state, area);
          return `${area.toUpperCase()} 区数据 ${data.collected} / ${data.total}`;
        })
        .join(" · ");
      this.dialog.append(dataOverview);
      const list = document.createElement("ul");
      list.className = "collection-list";
      for (const reward of this.content.rewards)
        list.append(
          text(
            "li",
            `${state.claimedRewardIds.includes(reward.id) ? "✓ 已领取" : "○ 未领取"} ${REWARD_LABELS[reward.id] ?? reward.id} · ${reward.units}`,
          ),
        );
      this.dialog.append(list);
    }
    if (panel === "storage") {
      this.fields["storage-save-status"] = text("p", this.saveLabel);
      this.fields["storage-save-status"].setAttribute("role", "status");
      this.dialog.append(
        this.fields["storage-save-status"],
        text(
          "p",
          `存档属于当前浏览器来源 ${location.origin}。更换协议、主机或端口会使用另一份存储，可通过导入迁移。`,
          "muted",
        ),
        button("导出当前进度", this.actions.export),
        button("导入存档", () => this.pickImport()),
        button("重试保存", this.actions.save),
        button("重新读取本地进度…", this.actions.reload),
        button("开始新游戏…", () => this.actions.start()),
      );
    }
    if (panel !== "pause")
      this.dialog.append(
        button("返回暂停菜单", () => this.openPanel("pause")),
        button("继续探索", () => this.resume(), "primary"),
      );
  }
  showActionFeedback() {
    this.feedbackVisibleUntil = performance.now() + 2400;
  }
  update(state: GameState) {
    this.state = state;
    const isFirewall = state.activeRealtime?.state.kind === "firewall";
    const isAntivirus = state.activeRealtime?.state.kind === "antivirus";
    const localDefinition =
      state.playerPosition.space === "room"
        ? this.content.staticChallenges.find(
            (definition) => definition.boardId === state.playerPosition.boardId,
          )
        : undefined;
    const isTheft = localDefinition?.kind === "theft";
    this.element.dataset.challenge = isFirewall
      ? "firewall"
      : isAntivirus
        ? "antivirus"
        : isTheft
          ? "theft"
          : "";
    this.fields["firewall-overlay"]!.hidden = !isFirewall;
    this.fields["antivirus-overlay"]!.hidden = !isAntivirus;
    this.canvas.setAttribute(
      "aria-label",
      isTheft
        ? "数据盗取平面棋盘，方向键移动与推动，Z撤销，Esc暂停"
        : isAntivirus
          ? "杀毒电视棋盘，方向键移动清除，F清除脚下目标，也可点击目标直达，Esc暂停"
          : "电视探索棋盘，方向键移动，F交互，R增幅，M区域图，Esc暂停",
    );
    const settingsKey = `${state.settings.reducedMotion}:${state.settings.reducedFlash}:${state.settings.quality}`;
    if (settingsKey !== this.settingsKey) {
      document.documentElement.dataset.reducedMotion = String(state.settings.reducedMotion);
      document.documentElement.dataset.reducedFlash = String(state.settings.reducedFlash);
      document.documentElement.dataset.quality = state.settings.quality;
      this.settingsKey = settingsKey;
    }
    this.set("mission-text", currentObjective(this.content, state));
    this.set("area-name", AREA_LABELS[state.playerPosition.areaId]);
    this.set(
      "area-subtitle",
      this.content.areas.find((area) => area.id === state.playerPosition.areaId)?.subtitle ??
        "HOLLOW / EXPLORATION",
    );
    this.set(
      "area-coordinates",
      `${this.content.profile.id}  /  ${state.playerPosition.space === "room" ? "机关内" : "探索中"}`,
    );
    const data = areaData(this.content, state, state.playerPosition.areaId);
    this.set(
      "area-data",
      data.includedTotal ? `${data.includedCollected} / ${data.includedTotal}` : "—",
    );
    this.set(
      "full-data",
      data.total ? `完整数据 ${data.collected} / ${data.total}` : "四区数据全部取得后开启仓库",
    );
    const supplies = supplyProgress(this.content, state);
    this.set("supplies", `${supplies.collected} / ${supplies.total}`);
    this.set(
      "amplifier",
      state.capabilities.includes("unlimitedAmplifier")
        ? "阳炎增幅仪  ∞"
        : state.capabilities.includes("amplifier")
          ? "阳炎增幅仪  1"
          : "增幅仪待领取",
    );
    this.set("save-status", this.saveLabel);
    this.set("storage-save-status", this.saveLabel);
    if (
      state.lastResult.code !== this.lastFeedback?.code ||
      state.lastResult.message !== this.lastFeedback?.message
    ) {
      this.lastFeedback = state.lastResult;
      this.showActionFeedback();
    }
    this.set(
      "context-tip",
      performance.now() < this.feedbackVisibleUntil ? state.lastResult.message : "",
    );
    let banner = "",
      meter = "",
      resultScore = "";
    if (state.activeStatic?.state.phase === "preview")
      banner = `记住安全路线\n${Math.max(0, (4000 - state.clock.activeTimeMs) / 1000).toFixed(1)} 秒`;
    if (state.activeStatic) {
      const definition = this.content.staticChallenges.find(
        (room) => room.id === state.activeStatic?.roomId,
      );
      const layout = state.activeStatic.state.currentLayout;
      if (definition?.kind === "oneStroke")
        meter = `已走 ${layout.visitedTileIds.length} / ${definition.requiredTileIds.length} 格 · 覆盖全部格子后，最后进入出口`;
      if (definition?.kind === "routing")
        meter = `入站 ${definition.ballIds.filter((id) => layout.objectTileById[id] === definition.stationTileById[definition.targetStationByBallId[id]!]).length} / ${definition.ballIds.length} · 球滑行，车移动一格；Z 可撤销`;
      if (definition?.kind === "theft" && layout.theft)
        meter = `已接入 ${definition.powerPortIds.filter((port) => theftPortSatisfied(definition, layout.theft!, port)).length} / ${definition.powerPortIds.length} · 球滑行，基站固定，组合体逐格推动`;
    }
    if (state.activeCompletedRoom) meter = "完成布局 · 可自由行走，物体保持原位；F 开始独立练习";
    if (state.clock.countdownRemainingMs > 0)
      banner = `准备 · ${Math.ceil(state.clock.countdownRemainingMs / 1000)}`;
    if (state.activeRealtime) {
      if (state.activeRealtime.practice && state.clock.countdownRemainingMs === 0)
        banner = "独立练习";
      const active = state.activeRealtime.state;
      const definition = this.content.realtimeChallenges.find(
        (item) => item.id === state.activeRealtime?.roomId,
      );
      const best = definition
        ? state.bestResults.find(
            (result) =>
              result.challengeId === definition.id && result.ruleVersion === definition.ruleVersion,
          )
        : undefined;
      if (active.kind === "firewall" && definition?.kind === "firewall") {
        const difficultyNames: Record<string, string> = {
          tutorial: "防火墙 · 教学",
          inner: "防火墙 · 内层",
          deep: "防火墙 · 深层",
          core: "防火墙 · 核心",
        };
        this.set(
          "firewall-difficulty",
          difficultyNames[definition.id.split(".").at(-1)!] ?? "防火墙",
        );
        this.set(
          "firewall-goal",
          `最高 ${active.bestCombo} / 目标 ${definition.rules.comboTarget}`,
        );
        this.set(
          "firewall-time",
          `${Math.max(0, (definition.rules.durationMs - state.clock.activeTimeMs) / 1000).toFixed(1)} s`,
        );
        this.set("firewall-combo-value", String(active.combo));
        (this.fields["firewall-song-progress"] as HTMLProgressElement).value = Math.min(
          1,
          state.clock.activeTimeMs / definition.rules.durationMs,
        );
        meter = `COMBO ${active.combo}   /   最高 ${active.bestCombo} · 目标 ${definition.rules.comboTarget}   /   ${Math.max(0, (definition.rules.durationMs - state.clock.activeTimeMs) / 1000).toFixed(1)} s`;
        resultScore = `${meter} · 本规则最佳 ${best?.bestCombo ?? active.bestCombo}`;
        const cue = firewallCue(definition, active, state.clock);
        const feedback = firewallFeedback(active, state.clock);
        this.set("firewall-feedback", feedback.message);
        this.fields["firewall-feedback"]!.dataset.kind = feedback.judgment ?? "none";
        this.fields["firewall-impact"]!.style.opacity = String(feedback.impactOpacity);
        const screenLight = this.fields["firewall-screen-light"];
        if (screenLight) {
          screenLight.dataset.phase = cue.phase;
          screenLight.style.opacity = String(cue.screenLightOpacity);
        }
        this.set("firewall-beat-status", cue.label);
        this.set("firewall-beat-count", `${cue.beatNumber} / ${cue.totalBeats}`);
        const rhythm = this.fields["firewall-rhythm"];
        if (rhythm) {
          rhythm.dataset.phase = cue.phase;
          rhythm.style.setProperty("--beat-cursor", `${cue.cursorPercent.toFixed(1)}%`);
          rhythm.style.setProperty("--beat-window-start", `${cue.windowStartPercent}%`);
          rhythm.style.setProperty("--beat-window-width", `${cue.windowWidthPercent}%`);
        }
        this.fields["challenge-meter"]?.classList.toggle(
          "beat-window",
          cue.phase === "ready" || cue.phase === "hit" || cue.phase === "judged",
        );
      }
      if (active.kind === "antivirus" && definition?.kind === "antivirus") {
        resultScore = `本次清除 ${active.score} / 目标 ${antivirusRequiredScore(definition)} · 本规则最佳 ${best?.bestScore ?? active.score} · 最大星清 ${best?.bestStarClear ?? active.bestStarClearCount}`;
        const count = antivirusActiveTargets(definition, active).filter(
          (target) => target.kind !== "star",
        ).length;
        const tier = definition.id.split(".").at(-1)!;
        this.set(
          "antivirus-heading",
          `杀毒程序 · ${{ light: "轻度", medium: "中度", heavy: "重度" }[tier] ?? "挑战"}`,
        );
        this.set("antivirus-count", `${count} / 9`);
        this.set("antivirus-score", `清除 ${active.score} / ${antivirusRequiredScore(definition)}`);
        this.set(
          "antivirus-time",
          `剩余 ${Math.max(0, (definition.rules.durationMs - state.clock.activeTimeMs) / 1000).toFixed(1)} 秒`,
        );
        this.fields["antivirus-status"]!.dataset.pressure = count >= 7 ? "high" : "normal";
        this.set(
          "antivirus-last-clear",
          active.lastStarClearCount > 0 ? `最近星清：${active.lastStarClearCount} 个侵蚀数据` : "",
        );
      }
      if (active.kind === "ghosts")
        meter = `已点亮 ${active.litLampIds.length} 盏灯 · 触碰幽灵会重试`;
    }
    this.set("mode-banner", banner);
    if (state.activeRealtime?.state.kind !== "firewall")
      this.fields["challenge-meter"]?.classList.remove("beat-window");
    this.set("challenge-summary", meter);
    const challengeMeter = this.fields["challenge-meter"];
    if (challengeMeter) {
      challengeMeter.hidden = !meter;
      challengeMeter.classList.toggle(
        "firewall-meter",
        state.activeRealtime?.state.kind === "firewall",
      );
    }
    const rhythm = this.fields["firewall-rhythm"];
    if (rhythm) rhythm.hidden = state.activeRealtime?.state.kind !== "firewall";
    const screenLight = this.fields["firewall-screen-light"];
    if (screenLight) screenLight.hidden = state.activeRealtime?.state.kind !== "firewall";
    const controlKey = `${state.mode}:${state.activeStatic?.state.phase ?? ""}:${isFirewall}:${isAntivirus}`;
    const controls = this.fields.controls;
    if (controls && controls.dataset.mode !== controlKey) {
      controls.dataset.mode = controlKey;
      controls.replaceChildren();
      controls.append(text("span", "WASD / ↑↓←→  移动", "key-hint"));
      const action = (label: string, command: GameCommand) =>
        button(label, () => {
          this.actions.send(command);
          this.canvas.focus();
        });
      if (state.mode === "explore")
        controls.append(
          action("F 交互", { kind: "Interact" }),
          action("R 增幅", { kind: "Amplify" }),
          button("M 区域图", () => this.openPanel("map")),
        );
      if (state.mode === "staticPuzzle") {
        const undo = action("Z 撤销", { kind: "Undo" });
        undo.dataset.action = "undo";
        controls.append(
          undo,
          action("重置房间", { kind: "ResetRoom" }),
          action("返回入口", { kind: "ExitRoom" }),
        );
      }
      if (state.mode === "completedRoom")
        controls.append(
          action("F 独立练习", { kind: "Interact" }),
          action("返回外层入口", { kind: "ExitRoom" }),
        );
      if (state.mode === "challengeRunning")
        controls.append(
          ...(isAntivirus ? [action("F 清除脚下", { kind: "Interact" })] : []),
          text("span", "实时挑战不支持撤销", "muted"),
          button("暂停", () => this.openPanel("pause")),
        );
    }
    const undoButton = controls?.querySelector<HTMLButtonElement>('[data-action="undo"]');
    if (undoButton) {
      undoButton.disabled =
        !state.activeStatic ||
        state.activeStatic.state.phase !== "active" ||
        state.activeStatic.state.undoStack.length === 0;
      undoButton.title = undoButton.disabled
        ? "没有可撤销的行动，仍可重置房间"
        : "撤销最近一次行动";
    }
    if (this.externalModal) return;
    if (this.transitioning && state.clock.pauseReasons.every((reason) => reason === "transition"))
      return;
    if (state.clock.awaitingResume || state.clock.pauseReasons.length) {
      this.renderPanel();
      return;
    }
    if (state.mode === "challengeReady") {
      const entity = entitiesAt(this.content, state.playerPosition.tileId).find(
        (candidate) => candidate.kind === "challengeAccess" || candidate.kind === "roomEntrance",
      );
      const ids =
        entity?.kind === "challengeAccess"
          ? entity.params.challengeIds
          : entity?.kind === "roomEntrance"
            ? [entity.params.roomId]
            : [];
      const kind = this.content.realtimeChallenges.find(
        (challenge) => challenge.id === ids[0],
      )?.kind;
      const description =
        kind === "antivirus"
          ? "中央 5×4 棋盘：方向移动或鼠标直点目标均可清除，F 清除脚下目标。蓝色 +1，紫色 +2；金星清除当前全部蓝紫。普通数据会持续堆积，最多 9 个，第 10 个出现立即失败；达到分数即成功。四侧屏显示清除进度。点击空格只移动。"
          : kind === "ghosts"
            ? "幽灵：用方向键逐格避开幽灵，点亮灯以清除指定幽灵组。与幽灵碰撞或交换位置会重试；长距离自动寻路已停用。"
            : "跟随音乐与画面周围白光，在拍点移动。普通错拍减 1 连击，触碰警报减 5；朝箭头方向踩拍，迎向警报可完美闪避。警报会移动，停在红格也会受击。两侧电视显示连击，底部文字提示拍点，减少闪烁时可依文字操作。鼠标可点不同格；方向键每次按下移动一次，每拍最多加 1。";
      if (this.modal("终端挑战", description, `ready:${state.playerPosition.tileId}`)) {
        const names: Record<string, string> = {
          tutorial: "教学 · 15 秒 / Combo 12",
          inner: "内层 · 45 秒 / Combo 40",
          deep: "深层 · 45 秒 / Combo 55",
          core: "核心 · 45 秒 / Combo 70",
          light: "轻度",
          medium: "中度",
          heavy: "重度",
        };
        for (const id of ids) {
          const definition = this.content.realtimeChallenges.find((item) => item.id === id);
          const label = names[id.split(".").at(-1)!] ?? "开始幽灵挑战";
          this.dialog.append(
            button(
              definition?.kind === "antivirus"
                ? `${label} · ${definition.rules.durationMs / 1000} 秒 / ${antivirusRequiredScore(definition)} 分`
                : label,
              () => {
                this.close();
                this.actions.send({ kind: "StartChallenge", challengeId: id });
                this.canvas.focus();
              },
              "challenge-choice",
            ),
          );
        }
        this.dialog.append(
          button("返回地图", () => {
            this.close();
            this.actions.send({ kind: "ExitRoom" });
            this.canvas.focus();
          }),
        );
      }
      return;
    }
    if (state.mode === "challengeResult") {
      if (
        this.modal(
          state.phase === "success" ? "挑战完成" : "重新尝试",
          state.phase === "success"
            ? state.activeRealtime?.state.kind === "ghosts"
              ? state.activeRealtime.practice
                ? "已通过幽灵通道。独立练习不会改变永久进度。"
                : "已到达安全出口。对应通道已开放，可返回地图继续探索。"
              : state.activeRealtime?.practice
                ? "已记录本次最好成绩。独立练习不会重复发放奖励。"
                : "已记录本次最好成绩。首次成功会开放对应物资格，前往地图领取。"
            : "本次未达标。永久进度不受影响，可以重新挑战。",
          `result:${state.activeRealtime?.roomId}:${state.phase}`,
        )
      ) {
        this.dialog.append(
          text("p", resultScore || meter, "result-score"),
          button(
            "再挑战一次",
            () => {
              this.close();
              this.actions.send({ kind: "RetryChallenge" });
              this.canvas.focus();
            },
            "primary",
          ),
          button("返回地图", () => {
            this.close();
            this.actions.send({ kind: "ExitRoom" });
            this.canvas.focus();
          }),
        );
      }
      return;
    }
    if (this.panel === "none" && this.dialog.open && this.dialogKey !== "start") {
      this.close();
      this.canvas.focus();
    }
  }
  showError(title: string, message: string, retry: () => void) {
    this.modal(title, message, `error:${title}`);
    this.dialog.append(
      button("重试", retry, "primary"),
      button("导出进度", this.actions.export),
      button("导入存档", () => this.pickImport()),
    );
  }
  showDecision(
    title: string,
    description: string,
    choices: { label: string; action: () => void; primary?: boolean }[],
    onCancel?: () => void,
  ) {
    this.externalModal = true;
    this.externalCancel = onCancel ?? null;
    this.dialogKey = "";
    this.modal(title, description, `decision:${title}`);
    for (const choice of choices)
      this.dialog.append(button(choice.label, choice.action, choice.primary ? "primary" : ""));
  }
  dismissDecision() {
    this.externalModal = false;
    this.externalCancel = null;
    this.panel = "none";
    this.close();
  }
  requestImport() {
    this.pickImport();
  }
  setTransition(active: boolean) {
    this.transitioning = active;
    this.canvas.setAttribute("aria-busy", String(active));
    const mask = this.canvas.parentElement?.querySelector<HTMLElement>(".scene-transition");
    if (mask) mask.hidden = !active;
  }
  setAudioAvailable(available: boolean) {
    const prompt = this.canvas.parentElement?.querySelector<HTMLElement>(".audio-prompt");
    if (prompt) {
      const returnToCanvas = available && !prompt.hidden && !this.dialog.open;
      prompt.hidden = available;
      if (returnToCanvas) this.canvas.focus({ preventScroll: true });
    }
  }
  showExport(raw: string, download: () => void, close: () => void) {
    this.showDecision(
      "导出当前进度",
      "下载 JSON 文件后妥善保存。若浏览器没有下载文件，也可全选下面的完整文本，保存为 .json 文件后导入。",
      [
        { label: "下载存档文件", action: download, primary: true },
        { label: "返回存档菜单", action: close },
      ],
    );
    const label = document.createElement("label");
    this.externalCancel = close;
    label.className = "export-text";
    label.append(text("span", "完整存档文本"));
    const textarea = document.createElement("textarea");
    textarea.readOnly = true;
    textarea.value = raw;
    textarea.rows = 7;
    textarea.spellcheck = false;
    textarea.addEventListener("focus", () => textarea.select());
    label.append(textarea);
    this.dialog.append(label);
  }
}
