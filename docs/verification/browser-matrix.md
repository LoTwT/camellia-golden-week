# 浏览器与设备实测矩阵

[文档索引](../index.md) · [工程矩阵与预算](../spec/architecture.md#3-浏览器与运行预算) · [验收总表](acceptance-results.md) · [视口矩阵](viewport-matrix.md) · [离线资源审计](offline-build-audit.md)

核对日期：2026-09-11。**本次必需浏览器已按用户授权收窄为 Chrome，具体范围见[工程合同](../spec/architecture.md#3-浏览器与运行预算)。当前实机为 Apple M1 Pro / 32 GB / macOS 26.6.2；Chrome已有M4正常新档130全收集、M5承接、最终production续玩恢复，以及同源码观察包的本机运行预算证据。原合同 M1 / 8 GB 与 Windows 基线机仍未验证，真实断外网尚未执行。**

Safari / Edge 以下均作历史记录，不再作为本次必需验收。Safari已有新档教学、三迷宫、A/B首访340/21与部分恢复；两档64格中位帧间隔17ms的失败及未完成全流程均保留，不改记通过，也不作为本次继续等待Safari环境的条件。

本页初次环境身份核对仅使用系统只读查询、应用 `Info.plist`、仓库证据与官方发布网页；后续第7节及其关联性能证据来自正常浏览器操作，没有更新浏览器或注入游戏状态。63项合同的逐条结果仍由验收总表维护；本页补齐环境身份、发布核对和证据范围。

## 1. 当前本机身份

| 项目            | 实际读取值                                  | 读取来源 / 边界                                                            |
| --------------- | ------------------------------------------- | -------------------------------------------------------------------------- |
| 机型            | MacBook Pro，`MacBookPro18,3`               | `system_profiler SPHardwareDataType -json`                                 |
| 芯片 / 图形设备 | Apple M1 Pro / Apple M1 Pro                 | 分别读取硬件与显示设备字段；本次输出没有GPU核心数，不推定具体核数          |
| 内存            | 32 GB                                       | 硬件报告 `physical_memory`                                                 |
| 系统            | macOS 26.6.2，build `25G83`                 | `sw_vers`                                                                  |
| Safari          | `26.6.2`，完整bundle build `21624.5.1.11.3` | `/Applications/Safari.app/Contents/Info.plist`，`com.apple.Safari`         |
| Google Chrome   | `153.0.8010.36`，bundle build `8010.36`     | `/Applications/Google Chrome.app/Contents/Info.plist`，`com.google.Chrome` |
| Codex内嵌浏览器 | 完整浏览器/引擎版本未采集                   | 与独立Chrome分列；不能以同属Chromium推定同版本或同环境                     |

上述版本是本次读取的**安装版本**。既有截图/快照的浏览器归属来自主执行者的取证记录，许多旧快照没有同一时刻的完整UA或浏览器版本；本次读取不能倒推每张历史图都使用相同二进制版本，也没有触发更新或确认“已安装所有更新”。

实际复核命令仅输出任务需要的字段，不保留硬件序列号、UUID、显示器序列号或其他个人信息：

```sh
python3 - <<'PY'
from pathlib import Path
import json
import plistlib
import subprocess

print(subprocess.run(["sw_vers"], capture_output=True, text=True,
                     check=True).stdout)
for category, fields in [
    ("SPHardwareDataType",
     ["machine_name", "machine_model", "chip_type", "physical_memory"]),
    ("SPDisplaysDataType", ["sppci_model"]),
]:
    report = json.loads(subprocess.run(
        ["system_profiler", category, "-json"],
        capture_output=True, text=True, check=True,
    ).stdout)
    for item in report[category]:
        print({key: item[key] for key in fields if key in item})
for name, path in [
    ("Safari", "/Applications/Safari.app/Contents/Info.plist"),
    ("Chrome", "/Applications/Google Chrome.app/Contents/Info.plist"),
]:
    data = plistlib.loads(Path(path).read_bytes())
    print(name, {
        key: data.get(key) for key in
        ["CFBundleIdentifier", "CFBundleShortVersionString", "CFBundleVersion"]
    })
PY
```

## 2. 官方稳定发布核对

2026-09-11联网打开以下官方发布来源，并区分平台、正式stable、early stable、beta和extended stable。网页发布状态与本机安装状态分别记录；本节保留浏览器范围调整前的完整核对，Safari / Edge 来源不再对应本次必需项。下次发布按当前 Chrome 范围重新核对日期与完整版本。

| 浏览器 / 平台                    | 本次官方来源确认的发布状态                                                                                                                                                                                                                                                                                                                                    | 与本机或目标矩阵的关系                                                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chrome桌面，Windows / Mac        | 2026-09-08常规Stable公布 `153.0.8010.36/.37`，分批推出。[官方发布条目](https://chromereleases.googleblog.com/2026/09/stable-channel-update-for-desktop_0808145027.html)                                                                                                                                                                                       | 本机Mac `153.0.8010.36` 属于该条目列出的版本；不能把公布的两个尾号压成唯一“最新补丁号”                                                                    |
| Chrome Early Stable              | 2026-09-09公布Windows `154.0.8037.17/.18`，仅小比例用户；该条目说明Mac尚待推出。[官方Early Stable条目](https://chromereleases.googleblog.com/2026/09/early-stable-update-for-desktop_01157104879.html)                                                                                                                                                        | 与上行常规Mac Stable分开，不把更高主版本自动当作本次Mac基准                                                                                               |
| Safari，Sonoma / Sequoia独立更新 | 最新可核对的独立条目是 `26.6.1`，发布于2026-08-18，明确适用于这两个系统。[Apple发布条目](https://support.apple.com/en-us/148286)                                                                                                                                                                                                                              | 本机是Tahoe，不能用旧系统的独立更新号判定本机Safari版本错误或已最新                                                                                       |
| Safari，当前Tahoe随系统提供      | Apple公开列表注明当前macOS为 `26.6.2`；对应系统更新发布于2026-08-17并含WebKit修复。[Apple发布列表](https://support.apple.com/en-us/100100)、[Tahoe 26.6.2说明](https://support.apple.com/en-us/148281)                                                                                                                                                        | 系统版本与本机相符，但这两页没有给出Safari `26.6.2 / 21624.5.1.11.3` 的完整浏览器对应关系；**该精确Safari版本是否为最新稳定版仍未由公开发布来源独立证实** |
| Edge桌面Stable，历史来源核对     | 官方常规发布说明列最新小版本 `152.0.4191.66`，日期2026-09-04；安全发布页同样确认该版本，9月8日较新条目属于Android。[Stable说明](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-relnote-stable-channel#version-1520419166-september-4-2026-stable)、[安全发布说明](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-relnotes-security) | 仅确认当时可核对的官方桌面版本，没有Windows/Edge实测；本次不再要求Edge验收，不拿Android版本填桌面矩阵                                                     |

Safari还实际读取了[Apple Developer发布目录](https://developer.apple.com/documentation/safari-release-notes)的[官方结构化目录](https://developer.apple.com/tutorials/data/documentation/safari-release-notes.json)：目录列Safari 26.6与Safari 27 Beta，没有26.6.2独立说明。本次不使用第三方版本聚合站补造该对应关系；也不把目录中的Beta称为正式稳定版。

以上是当日发布来源核对，不是浏览器漏洞、安全性或更新策略审计。Chrome版本是否符合最终发布时的“当前稳定版”，需在最终验收时再次记录；Safari精确稳定版本的未证实边界仅作历史保留。

## 3. 合同环境与实际环境分列

当前工程合同仅要求Windows Chrome与macOS Chrome；性能基线仍为Apple M1 / 8 GB，以及i5-1135G7 / Iris Xe / 16 GB。基准设备范围没有已确认的调整，已使用的M1 Pro / 32 GB仍不替代Mac基线，也不能模拟Windows GPU/驱动和存储行为。

| 环境                                                   | 浏览器版本                                   | 已有证据                                                                                           | 当前结论                                                                                    |
| ------------------------------------------------------ | -------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **合同Mac基线：Apple M1 / 8 GB**                       | Chrome完整版本待该机采集                     | 无该机实际运行记录                                                                                 | **未验证**；M1 Pro结果不填入该列                                                            |
| 原矩阵Mac基线（历史）：Apple M1 / 8 GB                 | Safari完整版本未采集                         | 无该机实际运行记录                                                                                 | **未验证（历史）**；本次不再必需                                                            |
| **合同Windows基线：i5-1135G7 / Iris Xe / 16 GB**       | Chrome完整版本及Windows build待采集          | 无Windows正常键鼠或性能记录                                                                        | **未验证**                                                                                  |
| 原矩阵Windows基线（历史）：i5-1135G7 / Iris Xe / 16 GB | Edge完整版本及Windows build未采集            | 无Windows/Edge实际运行记录                                                                         | **未验证（历史）**；本次不再必需                                                            |
| 补充实机：M1 Pro / 32 GB / macOS 26.6.2                | 独立Chrome，当前安装153.0.8010.36            | M4正常新档到仓库、全收集130与刷新恢复；M5继续该档、视口/故障/练习及正式包回访仓库、刷新保持947/130 | **部分实测**，正常游戏链及本机两档帧率/静态输入已有证据；指定硬件、剩余预算及真实离线未验证 |
| 补充实机（历史）：同上                                 | 原生Safari，当前安装26.6.2（21624.5.1.11.3） | M5新档教学、三迷宫、A/B首访340/21及刷新后的数据读取；两档64格采样、一次正常缓存继续                | **部分实测，帧率预算失败（历史）**；未完成仓库/130，末次可玩恢复未证实；本次不再必需        |
| 补充环境：同上，Codex内嵌浏览器                        | 完整引擎版本未采集                           | M1–M4连续升级；M5部分存储、导入、启动故障及六步普通移动实测                                        | **补充证据**；本组六步动画≤140ms，不替换独立Chrome或任何基线机                              |

规定的1366×768、1920×1080、DPR1/2、缩放端点和点击结果见[视口矩阵](viewport-matrix.md)。Safari当前证据为1455×854 / DPR2，原生窗口截图含浏览器工具栏；不能按图片文件尺寸将它改记成规定视口。Chrome通过浏览器缩放/视口覆盖取得的DPR组合也不是第二台物理高DPI设备。

## 4. 已有浏览器流程证据

以下只读取已落盘证据，不在本次重新游戏；“正常成功”与“在成功后注入平台故障”分别说明。Safari各行保留历史结果，不再是本次待补矩阵。主执行者后续新增Chrome结果应追加时间和链接，不覆盖失败事实。

| 浏览器 / 子项                       | 证据与实际结果                                                                                                                                                                                                                                                                                                                               | 边界                                                                                                                           |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Chrome，M4新档主线到仓库            | [新档起点](evidence/m4-chrome-newgame-start.json)、[正常键鼠轨迹](evidence/m4-chrome-newgame-trace.json)、[未做评分挑战的最终结算](evidence/m4-chrome-newgame-final-no-scored.json)：仓库 `warehouse.t.7.0`，100单位/20领取，九个静态布局已保存                                                                                              | 起点有clockGap暂停，后续流程包含显式恢复；不能删除该历史。未评分终局不是130全收集                                              |
| Chrome，M4全收集和恢复              | [全收集](evidence/m4-chrome-newgame-full.json)、[刷新恢复](evidence/m4-chrome-newgame-full-restored.json)、[正常导出](evidence/m4-chrome-browser-full-save.json)：130/130、26领取、四区数据、generation516，恢复后保留                                                                                                                       | 这是M4 / content4 / rule1 / schema2流程，不能把旧图重标为M5新档全流程                                                          |
| Chrome，M5承接与故障子项            | [M4档继续M5](evidence/m5-chrome-m4-restored.json)、[实际clockGap](evidence/m5-chrome-clock-gap.json)、[WebGL丢失/恢复](evidence/m5-chrome-webgl-recovery.json)、[实时刷新](evidence/m5-chrome-realtime-refresh.json)，另见验收B38起                                                                                                          | 不等于所有故障组合、所有纯键盘控件和最终production矩阵通过                                                                     |
| Safari，中心新档教学                | [新游戏窗口](evidence/m5-safari-newgame.jpg)、[增幅前主图](evidence/m5-visual-center.jpg)、[R后图](evidence/m5-safari-center-after-amplify.jpg)、[同存档刷新后的暂停快照](evidence/m5-safari-center-after-amplify.json)：`hub.t.3.2`，1/130，教学/增幅已完成，generation5                                                                    | JSON取自刷新续玩暂停，晚于截图；不是同刻输入/性能采样                                                                          |
| Safari，迷宫01正常成功后渲染异常    | [成功后受控渲染异常](evidence/m5-safari-success-render-failure.json)、[刷新继续](evidence/m5-safari-cached-continue.json)：目标/首次布局已保存，返回 `a.t.5.0`，generation23，1单位                                                                                                                                                          | 异常触发后是graphicsLost暂停；已保存成功结果没有被反馈异常撤销，不据此声明全部WebGL恢复组合通过                                |
| Safari，迷宫02正常成功后音频异常    | [成功后音频异常](evidence/m5-safari-success-audio-failure.json)：第二个迷宫目标/布局已保存，`a.t.1.-4`，generation39，audio=false；[原重试快照](evidence/m5-safari-success-audio-recovered.json)恢复audio=true                                                                                                                               | 原重试后Left未移动是实际焦点缺陷，音频启用不等于方向恢复                                                                       |
| Safari，音频重试焦点修复            | [修复复验](evidence/m5-safari-audio-focus-fixed.json)：原生AX激活提示按钮后，不点击canvas，正常Left移动到 `a.t.0.-4`，generation40，audio=true                                                                                                                                                                                               | 只覆盖这条恢复路径；工具拒绝的ArrowLeft名称未发出游戏输入，不计作成功或游戏失败；单个19ms样本不是输入p95验收                   |
| Safari，迷宫03正常替代解后写入失败  | [成功前后](evidence/m5-safari-success-write-failure.json)：正常替代路线，出口前只配置一次槽B写入拒绝，再正常Up成功；返回 `a.t.1.4`，内存有三迷宫目标和布局，generation仍59且显示未保存                                                                                                                                                       | 失败仅注入存储写入，通关由正常方向输入完成；该帧内存成功不能当作已经落盘                                                       |
| Safari，写入重试与刷新恢复          | [重试保存](evidence/m5-safari-success-write-retry.json)、[刷新恢复](evidence/m5-safari-success-write-restored.json)：generation60、同位置、三迷宫布局、1单位均保留                                                                                                                                                                           | 重试帧含manual/hidden暂停，刷新帧audio=false；不把它们当作持续播放或前台性能通过                                               |
| Safari，未保存成功态导出与导入预览  | [内存导出内容](evidence/m5-safari-unsaved-success-export.json)、[原生下载栏节选](evidence/m5-safari-success-write-download.txt)、[导入确认页](evidence/m5-safari-unsaved-export-import-preview.txt)、[取消后快照](evidence/m5-safari-unsaved-export-cancelled.json)：导出含第三迷宫结果；实际进入确认页，取消后仍generation60、三布局、1单位 | 已证实导出/下载栏、文件选择后的预览和取消；没有在这组证据中点击“确认替换”，不写成Safari完整导入替换成功                        |
| Safari，正常前台缓存继续            | [本次正常继续](evidence/m5-safari-cached-continue-normal.json)：宿主操作上界1195ms、第一次游戏准备87ms；正常Right至 `a.t.2.4` 并领取5单位，6/130、generation61、audio=true                                                                                                                                                                   | 本次≤3秒子项有证据；`before` 是此前故障暂停旧快照，不是本次同刻起点；不消除28405ms旧异常，也不证明全部profile加载通过          |
| Safari，同源导航会话异常            | [导航诊断](evidence/m5-safari-session-navigation-recovery.json)：进入 `?session-check=1`，1914ms观测仍busy；再次地址栏导航 `/`，1479ms观测可继续                                                                                                                                                                                             | 没有点击重试；只观察后一导航恢复，内部锁释放原因未明，不称修复通过或完整会话矩阵通过                                           |
| Safari，C最密场景正式性能           | [标准](evidence/m5-safari-dense-standard-performance.json)、[低档](evidence/m5-safari-dense-low-performance.json)：正常进入 `c.theft.03` 练习，两档各60步、永久130不变                                                                                                                                                                       | 真实M4全收集档仅作兼容/性能设置来源；两档帧率失败，准确采样/累计输入范围见[性能报告](performance.md#51-safari两档64格正式采样) |
| Codex内嵌浏览器，普通移动完成       | [六步实测](evidence/m5-iab-normal-movement-render-completion.json)：A世界图正常Left/Right，generation153–158，实际渲染完成123.5–130.7ms                                                                                                                                                                                                      | 仅该组六步≤140ms通过；引擎版本未采集，不扩展为独立Chrome或Safari动画通过                                                       |
| IAB，100ms视觉目标后世界移动        | [新版本六步](evidence/m5-iab-movement-100ms.json)：正常Left/Right，generation159–164，104.8–109.5ms，26单位与永久进度不变                                                                                                                                                                                                                    | 本组六步≤140ms通过；与上行旧120ms目标记录分开，不替代独立Chrome                                                                |
| Safari，100ms视觉目标后最密场景移动 | [64格六步](evidence/m5-safari-dense-movement-100ms.json)：正常Up/Down，generation226–231、撤销1–6、101–116ms，含新场景首次热身，无暂停                                                                                                                                                                                                       | 真实M4全收集档仅作性能设置；本组六步≤140ms通过，不是Safari新档通关或帧率修复                                                   |
| Safari，性能试验后恢复自身进度      | [正常UI恢复](evidence/m5-safari-own-progress-restored-after-movement.json)：文件选择并确认恢复原6单位备份，generation232、`a.t.1.4`、标准设置、audio=true                                                                                                                                                                                    | 已恢复自身进度，未留临时130单位性能档；不扩大到未测导入/迁移组合                                                               |

Chrome最终production已沿原正常新档全收集链回访仓库、核对26奖励/130单位、重复F并刷新，generation947及完整载荷保持，见[正式包操作记录](evidence/m5-production-chrome-continue.json)与[刷新后导出](evidence/m5-production-chrome-restored-save.json)。这是已有全收集链的正式包续玩，不另称一次M5生产包新档全流程。

历史Safari production从自身6单位档正常完成A/B主线、两一笔画与首访数据，末态340/21、五首次布局，详见[正常续玩记录](safari-production-journey.md)。原生窗口控制不可用且持续失焦暂停；后续刷新已[导出相同340载荷](evidence/m5-production-safari-delayed-reload-validation.json)，数据恢复得到确认，可玩恢复仍未证实。正式防火墙/杀毒、C/D、A/B回访、仓库及130全收集没有完成；C盗取03性能练习和导入130档不替代这些流程。本次不再要求继续Safari补证。

## 5. 性能记录的当前边界

Chrome已有[64格两档60秒与30次区域往返实测](performance.md)：本机M1 Pro的帧间隔、该次输入反馈和已观测渲染资源计数达到预算。Chrome剩余预算统一见[性能待完成项](performance.md#55-仍未完成项)，本次只排除Safari / Edge的必需验证，不豁免原基准机或真实断网。

以下Safari性能作为历史保留：[两档正式64格采样](performance.md#51-safari两档64格正式采样)的汇总窗口标准125.201s、低档95.949s，两档各60个合法步骤，generation和撤销深度均各增加60、永久进度不变。**中位帧间隔均17ms，超过16.7ms，历史帧率预算失败**；p95分别23/22ms只是通过子项。这些失败不再构成本次Chrome验收的阻塞。

Safari标准输入累计10→70、末端p95为51ms；低档73→133、末端p95为39ms，包含此前标准档和其他动作，不能称独立低档输入p95。宿主计时、start/end有效时间与帧汇总边界不同，具体差值见性能报告。[首轮未聚焦输入诊断](evidence/m5-safari-dense-unfocused-input-diagnostic.json)的输入数、存档代数、撤销深度均未增长，不能当作60步输入验收；后续正式样本不删除它。

Safari[教学快照](evidence/m5-safari-center-after-amplify.json)的28405ms首次游戏准备、[十秒诊断](evidence/m5-safari-ten-second-diagnostic.json)、[旧缓存继续](evidence/m5-safari-cached-continue.json)及音频焦点快照的启动入口27059ms均保留诊断含义。[新正常缓存继续](evidence/m5-safari-cached-continue-normal.json)的操作上界1195ms与准备87ms支持本次≤3秒子项，但没有消除旧异常或长启动入口阶段的原因缺口。[同源导航](evidence/m5-safari-session-navigation-recovery.json)仍有busy后再次导航恢复现象，尚不称修复通过。

[普通移动记录](performance.md#54-普通移动动画的实际渲染完成时间)保留原120ms目标的IAB六步123.5–130.7ms及Safari159ms热身失败。为实际帧完成留余量，`MOVEMENT_TRANSITION_MS`改为100ms后，[新版本复验](performance.md#100ms视觉目标复验)的IAB世界六步104.8–109.5ms、Safari64格六步101–116ms均≤140ms；Safari新场景首次热身计入六步，原有6单位进度已在试验后正常恢复。输入140ms与合同镜头≤120ms/普通总≤140ms不变；这是已测场景移动时长通过，**不是FPS修复**，Safari两档median17ms失败继续保留。

指定基线机、Chrome剩余运行预算及最终production对应预算复核仍缺，V05未全量通过。Safari独立低档输入统计、未完成流程和异常只保留历史，不再安排补测。离线资源齐全的前置结果见[资源审计](offline-build-audit.md)，真实外网断开的V06仍未验证。

## 6. 性能场景选择：仅源码统计

本次以 `assembleContent("M5")` 统计实际固定定义，没有构造玩家初态、改位置或操作浏览器。世界地图包含M4回访扩展；局部房间统计包括墙格，因为[投影](../../src/core/projection.ts)也把墙交给[电视渲染](../../src/render/board.ts)。世界图仍受发现/隐藏和视口影响，因此定义总格数不是某个浏览器画面已呈现的格数，更不是FPS结论。

| 世界地图  | 定义格数 | 坐标包围盒列×行 | 说明                                       |
| --------- | -------: | --------------- | ------------------------------------------ |
| hub       |       16 | 7×5             | 中心                                       |
| a         |       53 | 14×11           | 包含回访8格，世界图最大                    |
| b         |       52 | 15×10           | 包含回访8格                                |
| c         |       41 | 15×7            | 含球车/盗取入口与侧路                      |
| d         |       39 | 12×11           | 其中19格有隐藏组；未揭示时不能作为全部在场 |
| warehouse |       13 | 8×4             | 仓库                                       |
| 合计      |      214 | 不适用          | 六张图不会同时呈现                         |

| 局部房间                                |     定义格数 | 包围盒 / 补充                                                |
| --------------------------------------- | -----------: | ------------------------------------------------------------ |
| `a.maze.01` / `a.maze.02` / `a.maze.03` | 25 / 35 / 49 | 5×5 / 7×5 / 7×7                                              |
| `b.line.01` / `b.line.02`               |      12 / 25 | 4×3 / 5×5                                                    |
| `c.routing.01`                          |           49 | 7×7；24墙，2球、1车、2站                                     |
| `c.theft.01` / `c.theft.02`             |      49 / 49 | 均7×7；各2物体/2槽                                           |
| **`c.theft.03`**                        |       **64** | **8×8；31墙，3物体/3槽；所有地图与房间中的最大单一格数**     |
| 防火墙tutorial / inner / deep / core    |         各25 | 均5×5；教学15秒，正式45秒                                    |
| 杀毒light / medium / heavy              |         各25 | 均5×5、45秒；固定生成事件64 / 89 / 128次，不是同时在屏目标数 |
| `d.ghost.01` / `d.ghost.02`             |       9 / 13 | 7×2 / 9×3包围盒，均有空缺                                    |

本次源码核对建议主执行者先在正常进入的 **`c.theft.03` 独立练习活动态** 做60秒最密静态场景采样：64格、3物体/3槽，未完成时可合法保持活动态，不需要扩张地图或延长合同计时。先从实际只读快照确认 `render.tileCount=64`、前台/无暂停、没有加载中的图标，再开始采样；后续Chrome与Safari实际执行结果见[性能记录](performance.md)，本节保留原场景选择依据。

另外用重度杀毒补充动态目标和鼠标反馈、核心防火墙补充节拍和保存压力。它们每次只有45秒，不能修改时长或把菜单/重试过场拼进“连续60秒”来凑指标。区域往返建议使用已完成的A/B之间正常传送并留存每次返回同一位置时的资源计数；A53/B52仅是源码数量依据，最终选择仍以实际画面、资源驻留和合法路径为准。

统计来源为[组装入口](../../src/content/assemble.ts)、[区域目录](../../src/content/areas)、[静态定义](../../src/content/challenges/static.json)和[实时定义](../../src/content/challenges/realtime.json)。只读命令：

```sh
node --input-type=module <<'JS'
import { assembleContent } from "./src/content/assemble.ts";
const content = assembleContent("M5");
const bounds = (tiles) => ({
  columns: Math.max(...tiles.map((tile) => tile.x))
    - Math.min(...tiles.map((tile) => tile.x)) + 1,
  rows: Math.max(...tiles.map((tile) => tile.y))
    - Math.min(...tiles.map((tile) => tile.y)) + 1,
});
for (const area of content.areas) {
  const tiles = content.tiles.filter((tile) => tile.boardId === area.id);
  console.log(area.id, tiles.length, bounds(tiles),
    { hidden: tiles.filter((tile) => tile.hiddenGroupId).length });
}
for (const room of [...content.staticChallenges, ...content.realtimeChallenges])
  console.log(room.id, room.tiles.length, bounds(room.tiles));
JS
```

本次静态定义SHA-256为 `890512a795e5556e5fdc9fc026c85f46b193bfc57ad3db996529718321efbdb7`，实时定义为 `3600214a533fffc2152184ba99d30d008d36584bb73778c85745638915249edf`。渲染容量常量不是实际内容格数；本页没有用合成2048格压力图替代正常最密场景。

## 7. 最终修复版Chrome的正常续玩与会话保护

2026-09-11实际操作 Chrome production `assets/index-BpL7y5kK.js`，1512×771 CSS px、DPR2；正常延续原Chrome全收集档，没有导入或构造通关状态。原标签属于主任务的浏览器控制会话，当前子任务不能接管它；实际采用新建第二标签验证只读状态，由主任务正常关闭其持锁页，再由第二标签接手的流程。工具会话边界与游戏的同源写锁分别记录。

| 正常操作                                                                | 实际结果                                                                                                                            | 证据                                                                                                                                                                                       |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 原标签持锁时打开第二标签，导出A/B                                       | A947、B946均9340字节；A通过按钮返回、B通过Escape返回，均仍为“进度正在另一窗口使用”，没有进入游玩菜单                                | [原槽与返回记录](evidence/m5-chrome-final-busy-exports.json)、[画面](evidence/m5-chrome-final-busy-return.jpg)                                                                             |
| 关闭原持锁页，第二页点击一次重试                                        | 正常显示130单位的继续界面；继续后Left、Right为948、949代，仓库7,0→6,0→7,0，刷新后949代payload完全保持                               | [重试记录](evidence/m5-chrome-final-handoff-retry.json)、[恢复记录](evidence/m5-chrome-final-refresh-restored.json)；加载计时见[性能记录](performance.md#7-最终修复版-chrome-正常继续计时) |
| 正常导航到查询URL再Back                                                 | 旧世界仍显示、出现“导出离开前的内存副本”，重新读取本地进度的菜单先于继续操作                                                        | [历史导航记录](evidence/m5-chrome-final-normal-history.json)                                                                                                                               |
| 从949代正常离开到about:blank；另一真实标签继续并Left保存950代；旧页Back | 旧页显示busy。实际原槽B导出950代仓库6,0，旧内存导出949代仓库7,0，来源说明清楚；两者返回均回会话决定，没有“继续游戏”或“继续探索”按钮 | [完整保护记录](evidence/m5-chrome-final-retained-memory-protection.json)、[副本来源画面](evidence/m5-chrome-final-retained-memory-source.jpg)                                              |
| 关闭受限旧页，持锁页正常Right返回终端                                   | 最终951代、仓库7,0、26奖励/130；原48目标、9完成布局、9最好成绩及默认设置保持                                                        | [实际最终导出](evidence/m5-chrome-final-production-complete-save.json)、[仓库画面](evidence/m5-chrome-final-production-warehouse.jpg)                                                      |

历史返回确实保留了旧内存并走到修复对应的受限分支；production没有暴露`pageshow.persisted`事件标志，因此本记录不声称读取了未提供的生命周期诊断，也没有注入`pageshow`或篡改位置/分数/目标/门。原槽与内存导出的`savedAt`来源不同：前者保留写盘时刻，后者记录导出时刻；相同代数和payload不要求这两种完整envelope逐字相同，实际原槽文件各自完整保留。

本组没有重做新档全通关，证明的是修复版production承接原正常全收集链、会话隔离与恢复。原指定基准硬件和实际断外网边界保持不变。

同一冻结源码随后以独立acceptance观察包`index-BswYUKV9.js`在固定5174实测仓库6次玩家/镜头跟随、64格房间6次移动，以及标准/低画质各连续前台60次正常移动；本机本次均满足原性能阈值。逐步和窗口口径见[性能记录第8节](performance.md#8-最终同源码观察包chrome移动与两档60秒采样)，没有借观察包改位置、分数、目标或门。

观察结束后正常恢复默认设置并走回仓库，主任务把5174恢复production。最终正常reload/继续、F重复访问已完成终端、UI导出后返回游戏，仍为**1109代、仓库7,0、26奖励/130**，48目标、9完成布局、9最好成绩保持；DOM确认无验收快照与故障面板、画布就绪且没有对话框。[最终恢复记录](evidence/m5-chrome-final-production-restored.json)、[完整UI导出](evidence/m5-chrome-final-production-restored-save.json)与[可玩画面](evidence/m5-chrome-final-playable-production.jpg)均已保存，保留可玩Chrome标签546939540。本段是正常续档收尾，不是另一遍新档通关。

## 8. 隔离尝试后的当前界面状态

B133尝试浏览器请求隔离未成功，未配置并验证localhost豁免，也没有取得外部阻断对照。原生所选页面与验收目标不一致后停止全局键鼠；通过owned tab.close仅关闭任务标签546939540及DevTools，当前不再保留该可玩标签。此前1109真实导出和生产服务仍保留；默认规则删除与过滤文字恢复待可安全操作的窗口。详细实际记录见[离线审计第9节](offline-build-audit.md#9-chrome-请求隔离尝试未建立任务标签已关闭)，不把原生AX可读或关闭标签当作V06通过。
