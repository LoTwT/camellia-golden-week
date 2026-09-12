# M5 性能与区域往返实测

[文档索引](../index.md) · [工程预算](../spec/architecture.md#3-浏览器与运行预算) · [验收总表](acceptance-results.md) · [浏览器与设备](browser-matrix.md) · [视口矩阵](viewport-matrix.md)

2026-09-12 当前[防火墙v3专项](firewall-hazards.md#验证与交付)：本机 Chrome 153.0.8010.36 / headless / 标准画质 / 1920×1080 / DPR1，正式47/57/72 Combo各约42.23秒有效采样，帧间隔中位均约16.7ms、p95为16.7 / 16.7 / 16.7ms；按键至可见反馈p95为26.6 / 27.9 / 28.0ms，所有样本≤33.8ms。具体资源计数、退出释放及原始逐帧记录见[性能摘要](evidence/firewall-hazards/performance-summary.json)。测量使用同源码acceptance包；不替代原M5的60秒与30次往返实测。

2026-09-12 前次[防火墙 v2 专项](firewall-restoration.md#4-验证与交付)：本机 Chrome 153 / headless / 标准画质 / 1920×1080 / DPR1，三档正常游玩各约 42.23 秒有效采样。帧间隔中位数均约16.7ms、p95最高16.8ms；按键至可见命中反馈p95最高31.1ms、所有样本≤32.4ms。活动态58 draw calls /18几何/9纹理，退出侧屏释放。原始帧数组、方法与条件见[性能摘要](evidence/firewall-restoration/performance-summary.json)及关联浏览器记录；不替代下面原M5的60秒/30次往返实测。

核对日期：2026-09-11。**用户已接受本机 Apple M1 Pro / 32 GB / macOS / 独立 Chrome 作为本次性能基准，V05 通过。** 最终 production 正常继续、刷新，以及同源码观察包的两档 64 格帧间隔、输入反馈和玩家 / 镜头计量达到原预算；30 次区域往返的已观测资源计数稳定。原 M1 / 8 GB 和 Windows 设备未实测，按[范围调整](acceptance-scope-2026-09-11.md)保留为非必需的后续覆盖，不将本机数值冒充这些设备的实测。

Safari 两档中位 17ms 超过 16.7ms 的失败，以及 100ms 视觉目标下 IAB / Safari 各六步 ≤140ms 的通过子项，均按原结果保留。Safari / Edge 本次不再必需，停止补测不表示 Safari 帧率已修复。性能数值阈值保持不变；用户取消真实断外网发布门槛，V06 不计为通过。

本页读取已落盘的正常浏览器证据、核对采样实现并运行只读计算，没有操作浏览器、合成玩家初态、修改位置或重新构建。全部63项的综合结论由验收总表维护。

## 1. Chrome实测对象与条件

| 项目         | 本次实际条件                                                                                                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 硬件 / 系统  | MacBook Pro `MacBookPro18,3`，Apple M1 Pro，32 GB，macOS 26.6.2（25G83）；身份来源见[设备记录](browser-matrix.md#1-当前本机身份)                                                                        |
| 浏览器       | 独立 Google Chrome；当日读取的安装版本为 `153.0.8010.36`。性能JSON没有同刻完整UA；安装版本与当日官方常规Stable的关系见[发布核对](browser-matrix.md#2-官方稳定发布核对)                                  |
| 包与运行方式 | 本地5174的 **acceptance 静态 preview**，`profile=M5 / schema=2 / content=4 / rule=1`。验收诊断启用，故障面板折叠；`faults.active=true` 表示控制器存在，故障配置为空/false且记录为空，不表示本轮注入故障 |
| 进入方式     | 承接真实130全收集存档，经正常游戏进入 `c.theft.03`，选择独立练习；刷新并正常继续后开始采样。没有通过修改位置或目标进入房间                                                                              |
| 最密场景     | `render.tileCount=64`，8×8，3物体/3槽；包括墙格。它是现有固定地图/房间的最大单场景格数，见[源码统计](browser-matrix.md#6-性能场景选择仅源码统计)                                                        |
| 运行状态     | `staticPuzzle / active / practice=true`，起点与终点均为 `c.theft.03.t.1.6`；所有导出段落无暂停原因、倒数为0、过场未活动、待加载图标为0                                                                  |
| 视口与画布   | 视口1512×771 CSS px，浏览器DPR2；canvas1512×647 CSS px，可用棋盘区域1062×631 CSS px。它是本机补充性能视口，不替代1366×768与1920×1080的规定矩阵                                                          |
| 设置         | 标准/低画质分别实测；渲染DPR分别2/1，缩放1，音量0.6、未静音、未减少闪烁/动态；音频启用。低画质通过设置UI选择并保存，重新加载后独立采样                                                                  |
| 正常输入     | 每档30组 Up/Down，共60次方向输入；组内间隔175ms，每组随后等待1700ms。执行耗时还包含工具和观察开销，不把计划等待总和当作实际观测时长                                                                     |
| 进度保护     | 前后及中间段落均为130/130、26领取、四区100/100；完成目标、首次完成布局、已领取ID、最好成绩逐字段一致                                                                                                    |

独立练习中的60次合法移动各形成稳定存档，因此本轮输入反馈包含普通静态移动和实际保存开销。它没有测量实时挑战的拍点写入压力，也没有新增本次防火墙或杀毒成绩。

## 2. 采样口径

[主装配与观察实现](../../src/main.ts)在可见页面、无打开菜单、无过场时收集 `requestAnimationFrame` 间隔；帧环形缓冲上限7200，约每1000ms更新一次中位数、p95和均值。进入场景会清空帧采样；Chrome本轮每档还刷新页面，输入统计从0开始。Safari没有每档刷新，输入统计包含此前动作，另见第5节。

导出的 `after.frameSummary`（Chrome）或 `end.frameSummary`（Safari）是最近一次汇总，未导出帧间隔原始数组。本文按 `meanMs × sampleCount` 独立复算其累计窗口；中位数/p95来自该实际汇总，已核对源码的排序和索引方法，不能宣称从原始数组重新计算。由于汇总按约1秒更新，其末端不必与有效时钟快照完全同刻。

采集器本身没有逐项排除所有 `pauseReasons`，也没有单独检查 `document.hasFocus()`。Chrome本轮连续前台条件由执行方法记录、各段活动态快照，以及有效时间增量与宿主观测时长近似一致共同支持。Safari正式记录由主执行者保持原生窗口前台并确认画布焦点；它的宿主计时与状态快照边界不同，不能声称两者近似相等，也不能把这些条件自动套到其他暂停诊断。

输入统计记录“物理输入处理器（含等待方向）到呈现后下一动画帧”的时间，是浏览器内部可观察反馈代理，不是屏幕光学延迟测量。统计缓存跨普通场景切换保留，页面刷新才清空；Chrome本轮每档的60个样本属于该次刷新后整个场景，**并非恰好只属于最后7200帧的时间窗口**。Safari末端70/133个样本是累计统计，不能当作各档独立60步的百分位。两浏览器均另以撤销深度和存档代数各增加60核对输入确实被合法接受。

## 3. Chrome 两档结果

原证据：[标准画质](evidence/m5-chrome-dense-standard-performance.json)、[低画质](evidence/m5-chrome-dense-low-performance.json)。

| 指标                                |           标准画质 |             低画质 | 本次判断                                                        |
| ----------------------------------- | -----------------: | -----------------: | --------------------------------------------------------------- |
| 浏览器DPR / 渲染DPR                 |              2 / 2 |              2 / 1 | 实际档位上限正确                                                |
| `after.frameSummary.sampleCount`    |               7200 |               7200 | 两者均达到环形缓冲上限                                          |
| 均值                                |         8.575625ms |      8.488972222ms | 用于复算采样窗口，不以均值替换合同中位数/p95                    |
| **7200个间隔累计窗口**              |       **61.7445s** |       **61.1206s** | **均≥60s**                                                      |
| `hostWallDurationMs`                | 88738ms（88.738s） | 95468ms（95.468s） | 整体宿主观测时长，不是7200帧窗口                                |
| 有效时间起点                        |       238.000000ms |       214.800000ms | 按JSON保留至便于阅读的精度                                      |
| 有效时间终点                        |     88973.700000ms |     95683.400000ms | 与前一行相减                                                    |
| **有效时间增量**                    |       **88.7357s** |       **95.4686s** | 与宿主时长分别相差−2.3ms / +0.6ms；两个观测时钟的边界不完全相同 |
| 帧间隔中位数                        |          **8.4ms** |          **8.4ms** | 通过本机≤16.7ms预算                                             |
| 帧间隔p95                           |         **10.9ms** |         **12.6ms** | 通过本机≤25ms预算                                               |
| 输入样本数                          |                 60 |                 60 | 每次reload后的整个场景                                          |
| 输入反馈p95                         |         **18.3ms** |         **18.6ms** | 通过本机该方法下≤100ms预算                                      |
| 输入反馈最大值                      |             22.2ms |             21.2ms | 不是普通移动动画总时长                                          |
| 撤销深度                            |               0→60 |               0→60 | 60个合法静态步骤                                                |
| 已保存代数                          |            717→777 |            778→838 | 各增加60，末态已保存                                            |
| 几何 / 纹理 / 常驻图标 / 待加载图标 |     10 / 7 / 4 / 0 |     10 / 7 / 4 / 0 | 各段一致                                                        |
| 绘制调用 / 电视格数                 |            15 / 64 |            13 / 64 | 低档减少两次绘制；两档地图相同                                  |

两档中间快照支持输入、时间和存档连续推进；它们不是三个独立60秒试验：

| 画质 / 快照           | 有效时间（ms） | 输入数 / 撤销深度 | 已保存代数 | 当次帧样本数 |
| --------------------- | -------------: | ----------------- | ---------: | -----------: |
| 标准 before           |          238.0 | 0 / 0             |        717 |            1 |
| 标准 segment1         |        21564.6 | 20 / 20           |        737 |         2460 |
| 标准 segment2         |        50462.2 | 40 / 40           |        757 |         5852 |
| 标准 segment3 = after |        88973.7 | 60 / 60           |        777 |         7200 |
| 低档 before           |          214.8 | 0 / 0             |        778 |            1 |
| 低档 segment1         |        21314.4 | 20 / 20           |        798 |         2505 |
| 低档 segment2         |        53197.6 | 40 / 40           |        818 |         6186 |
| 低档 segment3 = after |        95683.4 | 60 / 60           |        838 |         7200 |

两次 `firstGamePreparationMs` 分别为51.4ms与105.6ms，记录的是继续后第一次场景准备阶段；`firstStartupReadyMs` 分别719.1ms与547.3ms，属于启动入口准备的另一阶段。这两组数值是本机缓存继续的补充观察，不能相加成精确的按钮输入到可操作延迟，也不足以宣称全部profile/设备加载矩阵≤3秒。

## 4. 30次正常区域往返

[原始60条落点和资源记录](evidence/m5-chrome-30-region-roundtrips.json)通过正常键盘 M 打开区域图，再点击可见的已激活传送按钮。按 A、B、C、D、仓库循环六轮，每次到达目的区域后返回中心，共30次往返、60条正式落点。

JSON的 `before` 在 `d.t.0.-2`、generation642，是调用前快照。主执行者确认在正式循环前另有正常“返回中心”的预备动作；该预备动作没有单独保存落点快照，也没有计入60条 `trace`。首条正式落点是 A / generation644，最后一条是中心 / generation703；不能把 `before` 写成中心，也不能声称60条trace包含额外预备传送。

本次逐条独立核对了30组目的区域/中心顺序、准确落点、存档代数644–703连续，以及全部永久字段与 `before` 一致。所有正式落点过场已结束，`lastDurationMs` 范围4.2–24.9ms；这是过场准备时长，不是端到端鼠标响应或60秒帧率样本。

| 落点区域 | 记录数 | 每次实际落点      | 电视格 | 几何 | 纹理 | 常驻图标 | 待加载图标 | 绘制调用 |
| -------- | -----: | ----------------- | -----: | ---: | ---: | -------: | ---------: | -------: |
| 中心     |     30 | `hub.t.0.2`       |     16 |   10 |    9 |        6 |          0 |       17 |
| A        |      6 | `a.t.0.0`         |     53 |   10 |   17 |       14 |          0 |       25 |
| B        |      6 | `b.t.0.0`         |     52 |   10 |   16 |       13 |          0 |       23 |
| C        |      6 | `c.t.0.0`         |     41 |   10 |   13 |       10 |          0 |       19 |
| D        |      6 | `d.t.0.0`         |     39 |   10 |   15 |       12 |          0 |       21 |
| 仓库     |      6 | `warehouse.t.0.0` |     13 |   10 |    9 |        6 |          0 |       15 |

表内每个区域的每项计数只有一个实际值，首次与最后一次访问一致，没有随往返次数增长。区域之间的纹理数不同属于当前区域所需资源不同；不能把不同场景混排成泄漏趋势。以上支持本轮几何、纹理和图标驻留计数稳定；本次没有单独的材质计数、JS堆快照或GPU字节测量，不声称已排除所有内存泄漏。

## 5. Safari新增实测、旧诊断与普通移动

本节Safari测试和排查发生于浏览器范围调整前，以下成功、失败和未验证事实按原结果保留；本次不再要求补齐Safari性能、通关或可玩恢复。IAB作为独立补充环境记录，不能直接填入Chrome实测列。

### 5.1 Safari两档64格正式采样

原证据：[标准画质](evidence/m5-safari-dense-standard-performance.json)、[低画质](evidence/m5-safari-dense-low-performance.json)。本机原生Safari当日安装版本为26.6.2（21624.5.1.11.3），仍属M1 Pro / 32 GB补充环境。版本身份与完整发布核对边界见[浏览器矩阵](browser-matrix.md)。

两档均为 `M5 / schema2 / content4 / rule1` 的acceptance静态preview，真实M4全收集存档仅作为兼容与性能设置来源，再经正常UI进入 `c.theft.03` 独立练习；**导入130档不代表Safari完成新档全收集**。实际视口1455×854 CSS px、浏览器DPR2，canvas1455×730，可用棋盘区域1005×714；标准/低档渲染DPR分别2/1，缩放1，音量0.6、未静音、未减少闪烁/动态，音频启用。诊断面板在采样时折叠，故障配置为空/false，记录为空。

标准先验证两步热身，再保持画布焦点，以30组Up/Down执行60步；每个方向后175ms、每组后1700ms等待。低档正常退出并以F/F重新进入练习，清空本场景帧统计，再执行同样60步。帧统计包括同场景前台热身/空闲；输入缓存未清空。文件未保存60条逐输入轨迹（`pairs=[]`），合法步数由方法记录、相同起终点、撤销深度及存档代数各增加60共同支持，不声称已有逐帧或逐命令原始数组。

| 指标                                |       标准画质 |         低画质 | 本次判断                                                    |
| ----------------------------------- | -------------: | -------------: | ----------------------------------------------------------- |
| 帧样本数                            |           7200 |           5573 | 标准达到环形上限；低档保留本场景全部已汇总间隔              |
| 平均帧间隔                          | 17.389027778ms | 17.216759376ms | 仅用于累计窗口复算                                          |
| **`meanMs × sampleCount`**          |   **125.201s** |    **95.949s** | 两档均超过60秒                                              |
| `hostElapsedMs`                     |       121.067s |        92.453s | 宿主操作计时，不是上行窗口                                  |
| 有效时间起点→终点                   | 4.238→140.558s |  0.690→96.020s | 读取start/end                                               |
| 有效时间增量                        |       136.320s |        95.330s | 分别比宿主计时多15.253s / 2.877s                            |
| **帧间隔中位数**                    |       **17ms** |       **17ms** | **两档均超过≤16.7ms，失败**                                 |
| 帧间隔p95                           |           23ms |           22ms | ≤25ms子项通过，不抵消中位数失败                             |
| 输入累计样本数                      |          10→70 |         73→133 | 各新增60；均非仅本档的独立统计                              |
| 输入累计p95 / 最大值                |      51 / 67ms |      39 / 67ms | 累计值在100ms内；低档含此前标准档，不能称“独立低档p95=39ms” |
| 撤销深度                            |           2→62 |           0→60 | 各60个合法静态步骤                                          |
| 已保存代数                          |         82→142 |        146→206 | 各增加60                                                    |
| 几何 / 纹理 / 常驻图标 / 待加载图标 | 10 / 9 / 6 / 0 | 10 / 9 / 6 / 0 | 各档起终一致                                                |
| 绘制调用 / 电视格数                 |        15 / 64 |        13 / 64 | 档位差异正确，未扩大地图                                    |

两档起终均为 `c.theft.03.t.1.6`、活动练习、无暂停原因、倒数0且无活动过场；130单位、26领取、四区100、目标、最好成绩和首次完成布局逐字段不变。宿主计时、状态快照与按秒汇总的帧环形窗口具有不同边界；本记录分列其差异，不将任何一个窗口改写为另一个，也没有把超出宿主计时的全部差额推定为热身。17ms按实际记录判定失败，不因Safari时间精度可能不同就四舍五入成16.7ms或推定为达标。

### 5.2 未聚焦输入与旧性能诊断

| 证据                                                                               | 实际结果                                                                                   | 不作通过的原因                                                                                 |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| [中心教学快照](evidence/m5-safari-center-after-amplify.json)                       | `firstGamePreparationMs=28405`                                                             | 首次准备异常原因尚未由本组证据解释；后续较快继续不能删除它                                     |
| [十秒诊断](evidence/m5-safari-ten-second-diagnostic.json)                          | 宿主11375ms，599间隔，中位17ms/p9518ms，输入0；末态manual暂停                              | 中心场景、窗口不足60秒，且为暂停诊断                                                           |
| [后次缓存继续](evidence/m5-safari-cached-continue.json)                            | 宿主5356ms，187间隔，中位17ms/p9525ms，输入0；第一次场景准备60ms                           | 约3秒短时采样，末态manual暂停，不是最密场景持续60秒                                            |
| [音频焦点修复快照](evidence/m5-safari-audio-focus-fixed.json)                      | 单个输入19ms；启动入口27059ms、第一次场景准备48ms                                          | 故障恢复功能证据，单输入和暂停末态不能填成性能通过                                             |
| [最密场景首轮未聚焦诊断](evidence/m5-safari-dense-unfocused-input-diagnostic.json) | 帧汇总6490间隔、113.163s，中位17ms/p9523ms；宿主99.167s；输入5→5、generation77→77、撤销0→0 | 计划的60方向没有成为游戏步骤，不能当作已接受输入或普通移动性能；后续正式两档不覆盖这一失败事实 |

### 5.3 Safari正常缓存继续与会话诊断

[正常缓存继续](evidence/m5-safari-cached-continue-normal.json)记录原生任务窗口前置、普通URL、实际“继续”后正常Right：宿主操作上界1195ms，覆盖原生AX、键盘和只读回读开销；第一次游戏准备87ms。正常结果位于 `a.t.2.4`，Right实际领取5单位，6/130、generation61，audio=true、无暂停。这支持**该次缓存继续到可操作的≤3秒子项**，不替代所有profile、设备或冷加载。

该文件的 `before` 保留的是此前音频拒绝且manual暂停的旧快照（generation60、1单位、准备46ms）；不能把它与新会话的 `moved` 相减成精确加载时长。`moved.firstStartupReadyMs=182938.00000000003` 属于另一启动入口阶段，该证据没有给出这段长耗时的内部原因；1195ms不是从页面导航开始计时。此前28405ms首次游戏准备和27059ms启动入口异常均保留，不被此次较快继续抹去。

[同源会话导航诊断](evidence/m5-safari-session-navigation-recovery.json)中，原生地址栏进入 `?session-check=1` 后，1914ms宿主观测仍显示busy、没有继续按钮；再次导航到 `/` 后，1479ms观测显示继续且不busy。记录未点击“重试获取会话”；内部锁释放时序未被观测，只有后一条导航恢复事实，**不能据此宣称会话缺陷已修复或全部导航路径通过**。

### 5.4 普通移动动画的实际渲染完成时间

以下先保留**原120ms视觉目标**的实测。[Codex内嵌浏览器六步记录](evidence/m5-iab-normal-movement-render-completion.json)以正常键盘Left/Right单步，每步等待220ms后只读取得 `render.lastPlayerMovement`。环境为本机M1 Pro、M5/content4、1366×768/DPR1、标准画质、缩放1、未减少动态；浏览器完整引擎版本未采集，不并入独立Chrome列。起终均无暂停，六步在 `a.t.1.-2` 与 `a.t.0.-2` 往返，generation152→158，26单位与永久进度不变。

| 步骤 | 方向 / 到达        | 已保存代数 | 实测渲染完成耗时 |
| ---- | ------------------ | ---------: | ---------------: |
| 1    | Left / `a.t.0.-2`  |        153 |          130.7ms |
| 2    | Right / `a.t.1.-2` |        154 |          128.1ms |
| 3    | Left / `a.t.0.-2`  |        155 |          127.2ms |
| 4    | Right / `a.t.1.-2` |        156 |          124.3ms |
| 5    | Left / `a.t.0.-2`  |        157 |          129.6ms |
| 6    | Right / `a.t.1.-2` |        158 |          123.5ms |

[渲染诊断](../../src/render/board.ts)在update检测同棋盘四邻接玩家变化时读取 `performance.now()`，与原动画起点共用；在实际渲染调用与标签定位完成、静止玩家图标可见、移动图标结束且相机到目标的帧尾再次取时。只保留最近一次，表中为两次实测时钟之差，包含一帧量化与帧CPU工作，不是120ms常量、工具等待时间或物理屏幕扫描延迟。**六步123.5–130.7ms均通过本机本组普通移动≤140ms子项**；它没有独立测出镜头首次到位时刻，不将合并终点改称镜头≤120ms证据。

[此前DOM轮询](evidence/m5-iab-normal-motion-readback.json)的宿主上界145–154ms含输入工具、DOM回读及一帧滞后，不据此判实际动画失败；[误用旧目标布局的诊断](evidence/m5-iab-motion-stale-layout-diagnostic.json)没有等到新目标，不能作通过证据。Safari两档末次移动分别135/129ms只是各一条观察，标准热身仍实测159ms超过140ms；保留该超限，不能用两个末次值声明Safari普通移动全量通过。

#### 100ms视觉目标复验

原120ms目标下Safari热身159ms促使相机与玩家视觉过渡共用的 [`MOVEMENT_TRANSITION_MS`](../../src/render/layout.ts)缩至100ms，以给实际帧完成留余量；[玩家渲染](../../src/render/board.ts)读取同一常量。[输入间隔](../../src/platform/input.ts)仍为140ms，镜头≤120ms与普通移动总时长≤140ms的合同不变，规则时钟也未调整。

本次新增两组正常键鼠记录，均使用实际渲染完成计量，每条 `durationMs` 都等于 `completedAtMs - startedAtMs`；源记录保留浮点精度，下面按0.1ms或整数显示。两组起终与逐步 `pauses` 均为空，永久目标、已领取ID、物资/数据、最好成绩及首次完成布局不变。

| 环境 / 设置                                                                                                                                    | 正常操作与代数                                                                                | 六步实际耗时（ms，按操作顺序）                | 范围与结论                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------- |
| [IAB世界图](evidence/m5-iab-movement-100ms.json)，1366×768、DPR1、标准、缩放1、未减少动态；M5/content4，26单位                                 | A的 `1,-2 ↔ 0,-2`，Left/Right三组；generation158→164，逐步159–164；190ms观察等待              | 107.8 / 107.6 / 108.8 / 109.5 / 104.8 / 108.6 | **104.8–109.5ms；本组六步≤140ms通过**                 |
| [Safari64格](evidence/m5-safari-dense-movement-100ms.json)，1455×854、浏览器/渲染DPR2、标准、缩放1、未减少动态；M5/content4，130单位性能设置档 | `c.theft.03.t.1.6 ↔ 1.5`，Up/Down三组；generation225→231，逐步226–231，撤销0→6；210ms观察等待 | 113 / 116 / 110 / 114 / 101 / 105             | **101–116ms；本组六步≤140ms通过，含新建场景首次热身** |

IAB正常世界移动的合并完成条件包含相机已到新目标，故本组≤109.5ms也给出了镜头到位不晚于120ms的浏览器内计量上界；它不是物理屏幕扫描测量。Safari房间采用固定镜头，该组六步验证64格场景的玩家移动完成，不伪称测到一次局部镜头平移。Safari六步前没有丢弃另一次热身；新场景的首次Up计入113ms。观察等待不是上述耗时，等待中的原生工具与回读时间也没有填进 `durationMs`。

Safari通过正常文件选择和确认导入真实M4全收集档，仅作性能设置来源，再以区域图M选择C、Up×2、Left×6、F/F正常进入独立练习；没有修改位置或完成状态，也没有把导入130档当作Safari通关。结束后通过正常UI导入恢复原有6单位备份，[恢复记录](evidence/m5-safari-own-progress-restored-after-movement.json)为generation232、`a.t.1.4`、6/130、2领取，标准设置、未减少动态、音频启用、无暂停；没有把临时全收集性能档留作该浏览器进度。

这两组支持**100ms视觉目标版本在已测环境/场景的普通移动复验通过**。旧120ms目标的159ms失败仍是促成本次修改的历史证据，不删除、不混入新版本样本。缩短过渡时长没有新增60秒FPS采样；Safari两档median17ms的历史帧率失败与指定硬件缺口继续保留。

### 5.5 当时未完成项（历史快照）

以下表格保留当时的缺口与较早采样数值；Chrome 最终同源码预算已在第 7–8 节补齐，设备范围随后由用户调整，不再是当前待办。原设备仍未实测，本机结果不填入它们的通过列。

| Chrome预算                                  | 已有实际证据                                                                                                      | 当前缺口                                                                                           |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 最密场景连续60秒：中位≤16.7ms、p95≤25ms     | 本机acceptance两档均7200间隔、61.7445s / 61.1206s，中位8.4ms、p95 10.9 / 12.6ms，已通过                           | 原基准机未测；现有定量采样不是最终production包，对应版本与必要复核尚待记录                         |
| 已接收输入至首次可见反馈p95≤100ms           | 本机两档各60次正常静态移动并保存，p95 18.3 / 18.6ms，已通过                                                       | 原基准机及最终包对应复核未齐；不把静态移动样本扩写为实时挑战保存边界的计量                         |
| 普通移动≤140ms、镜头跟随≤120ms              | 100ms视觉目标的实际渲染端点已在IAB / Safari记录                                                                   | 尚缺独立Chrome同版本的实际完成计量；设置常量和工具等待不能代替                                     |
| 已缓存资源、正常profile，从继续到可操作≤3秒 | Chrome第一次场景准备51.4 / 105.6ms；[正式包正常继续与刷新](evidence/m5-production-chrome-continue.json)有功能记录 | 场景准备是部分阶段，正式包操作记录没有这一端到端计时；不能相加旧阶段或采用Safari1195ms代填         |
| 区域往返30次资源稳定，保存不显著阻塞节拍    | Chrome已有60条正常落点、同区域资源计数稳定；静态60步包含真实保存开销                                              | 原基准机未测；实时挑战的保存边界仍需与对应正常挑战/事务证据核对，不能从静态输入p95推定全部时序预算 |

规定视口组合的功能结果查[视口矩阵](viewport-matrix.md)；本次1512×771只是实际性能视口，不改记为1366×768或1920×1080。最终production已具备[正常续玩、导出与刷新证据](release-candidate.md)，但本页已有帧率和输入采样来自acceptance，不把功能成功当作新增性能计量。后续只针对未闭合预算补证，不增加共用控件或所有状态排列的重复验收。

Safari两档17ms、旧159ms热身与会话异常保留历史；不再要求独立低档输入统计或环境恢复复测。该时点真实外网断开仍属必需 V06；后续用户已取消本次门槛。见[离线资源审计](offline-build-audit.md)，不从本地资源齐全或 Chrome 性能结果推定通过。

## 6. 原证据指纹与只读复核

| 文件                                                  | 字节数 | SHA-256                                                            |
| ----------------------------------------------------- | -----: | ------------------------------------------------------------------ |
| `m5-chrome-dense-standard-performance.json`           |  55328 | `f4c7e74e8dfcc31f53576b6e78d73b2c2e63b63fe2bfc5fae3477d47adfd8c8b` |
| `m5-chrome-dense-low-performance.json`                |  55350 | `24064e5240d882fffebbb3178d2d76d920ff2eca76ef4fb99d6966f41adb3ee5` |
| `m5-chrome-30-region-roundtrips.json`                 | 570612 | `0eeddc86fa3c2d68c354d8cfd039b43dd7cf8abfb7747d6c1993041d8a8b13ed` |
| `m5-safari-dense-standard-performance.json`           |  22123 | `3bb49ce91b7d014a791886ba220590e2701a77f7646bcadc307ea422ff9a0f9e` |
| `m5-safari-dense-low-performance.json`                |  21668 | `1c2e2387bd21d8b1048e2adb9c9e6366e466fe244aea0b6f3d35afc7662f358d` |
| `m5-safari-dense-unfocused-input-diagnostic.json`     |  21563 | `9bb630127e195ce663abef8bd9334c8cb6242c167c4c494609f3f8413ef45996` |
| `m5-safari-cached-continue-normal.json`               |  10783 | `33767ff96d4918cfe9ec31b2b1c2f5a9f791162cc0f2cdb1fc60763f4397bc6b` |
| `m5-safari-session-navigation-recovery.json`          |   7719 | `09eed065ebc7255bd16735a2521b6d56602c9e1ad6523f5aa073d9b071714a2f` |
| `m5-iab-normal-movement-render-completion.json`       |  16004 | `b8d6ed1c26590006f736c99a86d9afb2b69e575d508846cc02322c51ec94f31e` |
| `m5-iab-normal-motion-readback.json`                  | 478504 | `cd1e10d7eb20aef28e90058bacd50a2aa0c4c32424e72906068450f9b6943879` |
| `m5-iab-motion-stale-layout-diagnostic.json`          |  84137 | `8e952735ef31c6e797f7b9fb174ecef2b2da91438b8482808e9bd5bd6ce10b42` |
| `m5-iab-movement-100ms.json`                          |  22195 | `7d7223d5e225fcb045c86ba0f2ccf528e96c61cfee19a947ac51371a211f2639` |
| `m5-safari-dense-movement-100ms.json`                 |  87122 | `cb1ed2ea36ebd42965523d979d7abdc9ae2025fd88672f73ad2606e178505e14` |
| `m5-safari-own-progress-restored-after-movement.json` |  35836 | `320bcdd693045bb5c4393c86b02924454882a369c978aa751bf7bfa12f220882` |

以下从仓库根执行的检查已实际通过。它读取已存在证据并核对统计和不变量，不运行游戏，也不替代正常键鼠过程：

```sh
python3 - <<'PY'
import json
from pathlib import Path

root = Path("docs/verification/evidence")
permanent = (
    "supply", "data", "completedObjectiveIds", "claimedRewardIds",
    "completedRoomLayouts", "bestResults",
)
for quality in ("standard", "low"):
    record = json.loads(
        (root / f"m5-chrome-dense-{quality}-performance.json").read_text()
    )
    before, after = record["before"], record["after"]
    frames = after["frameSummary"]
    snapshots = [before, *record["segments"], after]
    assert all(
        item["mode"] == "staticPuzzle" and item["phase"] == "active"
        and not item["pauseReasons"] and not item["transition"]["active"]
        and item["countdownRemainingMs"] == 0
        and item["render"]["tileCount"] == 64
        and item["render"]["pendingIconCount"] == 0
        and item["staticRoom"]["practice"]
        for item in snapshots
    )
    assert all(
        item[key] == before[key] for item in snapshots for key in permanent
    )
    assert before["inputLatency"]["sampleCount"] == 0
    assert after["inputLatency"]["sampleCount"] == 60
    assert after["saveGeneration"] - before["saveGeneration"] == 60
    assert (
        after["staticRoom"]["undoDepth"] - before["staticRoom"]["undoDepth"]
    ) == 60
    window = frames["meanMs"] * frames["sampleCount"]
    assert frames["sampleCount"] == 7200 and window >= 60000
    assert frames["medianMs"] <= 16.7 and frames["p95Ms"] <= 25
    assert after["inputLatency"]["p95Ms"] <= 100
    print(
        quality, "PASS", "ringMs", round(window, 4),
        "hostMs", record["hostWallDurationMs"],
        "activeMs", round(after["activeTimeMs"] - before["activeTimeMs"], 4),
    )

record = json.loads(
    (root / "m5-chrome-30-region-roundtrips.json").read_text()
)
trace = record["trace"]
assert record["completedRoundTrips"] == 30 and len(trace) == 60
for index in range(30):
    outward, returned = trace[2 * index:2 * index + 2]
    destination = ["a", "b", "c", "d", "warehouse"][index % 5]
    assert outward["round"] == returned["round"] == index + 1
    assert outward["destination"] == destination
    assert returned["destination"] == "hub"
for index, item in enumerate(trace):
    destination = item["destination"]
    tile = "hub.t.0.2" if destination == "hub" else f"{destination}.t.0.0"
    assert item["position"] == {
        "space": "world", "areaId": destination,
        "boardId": destination, "tileId": tile,
    }
    assert all(item[key] == record["before"][key] for key in permanent)
    assert item["saveGeneration"] == 644 + index
    assert not item["transition"]["active"]
for destination in ("hub", "a", "b", "c", "d", "warehouse"):
    visits = [item for item in trace if item["destination"] == destination]
    for metric in (
        "geometries", "textures", "calls", "tileCount",
        "residentIconCount", "pendingIconCount",
    ):
        assert len({item["render"][metric] for item in visits}) == 1
print("roundtrips PASS: 30 pairs, 60 landings, unchanged permanent progress,"
      " stable per-area renderer counts")
PY
```

本次实际输出：

```text
standard PASS ringMs 61744.5 hostMs 88738 activeMs 88735.7
low PASS ringMs 61120.6 hostMs 95468 activeMs 95468.6
roundtrips PASS: 30 pairs, 60 landings, unchanged permanent progress, stable per-area renderer counts
```

新增Safari与IAB证据另以Python `json` 只读解析并核对：Safari两档start/end的活动状态、64格、同一起终点、永久六类字段、设置档位、渲染计数，代数/撤销/输入各增加60；未聚焦诊断三项增量均为0；IAB六步方向、逐步代数、起终格和 `completedAtMs - startedAtMs == durationMs`；正常继续与会话导航则核对上述具体字段。未运行游戏或注入状态。实际输出如下，其中 `integrity PASS` 仅指证据一致性，帧率结论明确为 `FAIL`：

```text
Safari standard integrity PASS; frame budget FAIL; sampleMs 125201.0 hostMs 121067 activeDeltaMs 136320 cumulativeInput 70 cumulativeInputP95Ms 51
Safari low integrity PASS; frame budget FAIL; sampleMs 95949.0 hostMs 92453 activeDeltaMs 95330 cumulativeInput 133 cumulativeInputP95Ms 39
Safari unfocused diagnostic: 0 accepted steps; excluded from input pass
IAB movement PASS for this group: 6 steps; 123.5 to 130.7 ms
Safari cached continue and navigation facts verified; no fix claim
```

## 后续只读诊断：验收开销与时间精度假设

正式production包已通过[资源与代码审计](offline-build-audit.md)确认剔除故障、快照及会话诊断入口。此前Safari两档性能记录来自acceptance包，测量包含了相应观察开销；旧失败不因正式包排除诊断就自动转为通过。

实际[主循环](../../src/main.ts)的frame→send(Tick)→render→updateInspectionText链表明：只要验收输出存在，每次rAF至少生成一次完整snapshot、structuredClone、JSON.stringify并写script.textContent，普通输入还会额外触发。双层details折叠只避免AX分段DOM重建，没有避免上述序列化。末端统计窗口的7200/5573帧因此至少对应同数快照调用，但原证据没有实际调用计数。两份原证据的method记录面板折叠，快照字段本身未保存details.open，不能独立从机器字段验证该状态。

对已存start/end快照重新序列化，标准档为7018→7023 UTF-8字节，低档6827→7018字节；两个末态各含61个对象、27个数组，九个完成布局共1768字节，活动撤销只记录undoDepth。该核算是原快照体积，不是CPU耗时、堆分配或后来新增会话诊断字段的体积。没有证据把这项额外工作直接归因为17ms。

帧统计直接求rAF时间戳差、排序取中位数，代码没有把结果舍入至整数。WebKit公开的[精度变更记录](https://results.webkit.org/commit?id=313153%40main&repository_id=webkit)和[帧率机制说明](https://webkit.github.io/explainers/animation-frame-rate/)使时间分辨率/60Hz调度成为待验证假设；这些记录不能证明本机Safari26.6.2的实际实现。原始逐帧序列没有保存，均值17.389/17.217ms和p95 23/22ms也不能全部归结为整数化。合同仍为中位≤16.7ms、p95≤25ms。

范围调整前提出、尚未执行的Safari复测方案为：用固定场景、显示器和供电条件做配对采样，仅让acceptance在显式刷新或展开时生成快照，保留现有计数和判定，同时记录原始rAF间隔、快照调用次数及CPU/布局分析。若去掉序列化仍为17ms，即不能把它视为主要原因，再以相同上下文的空载rAF对照调度/时间精度。逐帧HUD派生、标签投影/样式赋值、每秒最多7200项排序和500ms投影刷新目前都只是可测候选，没有各段耗时或强制布局证据；本次未据此改引擎、降低标准或重建正式包。用户收窄浏览器范围后，这份Safari方案仅作历史保留，不再作为当前待执行验收。

## 7. 最终修复版 Chrome 正常继续计时

2026-09-11，在本机相同 Chrome、1512×771 CSS px、DPR2、标准画质、缩放1、未减少动态的环境下，实际页面加载 production 分块 `assets/index-BpL7y5kK.js`。本组承接原正常全收集链947代，先由真实第二标签只读导出两槽；原持锁页关闭后点击一次重试，读取最新130单位进度，再正常继续。没有导入、改位置或合成页面事件。

| 场景                        | 实际计时                                                                                             | 位置与进度证据                                                                                                                                                     | 本组结论                   |
| --------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| 点击“继续游戏”到画布可操作  | canvas可见且`aria-busy=false`、过场隐藏、对话框关闭：宿主320ms；随后真实ArrowLeft与已保存状态：390ms | [计时与实际导出核对](evidence/m5-chrome-final-continue-timing.json)：947代仓库7,0→948代6,0；26奖励、目标和9完成布局保持                                            | 本机本次≤3秒通过           |
| 正常Right回终端、刷新后继续 | 再次点击继续到画布就绪：宿主315ms                                                                    | [刷新恢复](evidence/m5-chrome-final-refresh-restored.json)：949代仓库7,0；[实际UI导出](evidence/m5-chrome-final-restored-save.json)的payload与刷新前逐字段完全相同 | 本机本次≤3秒且刷新恢复通过 |

计时均使用同一次CUA宿主调用中的`Date.now()`，包含浏览器工具往返；没有向页面注入计时器或更改游戏时钟。390ms对应正常输入已返回且HUD显示本次已保存；实际落点由随后仅经暂停、存档、导出操作取得的完整文本确认。本项证明加载到可操作，移动动画和帧间隔另行测量。

刷新后的两次textarea定位读取超时均发生在导出界面已显示、加载计时已结束之后；新鲜DOM快照仍提供完整的可见文本。记录保留这两次工具读取失败及采用受支持DOM快照的恢复方式，没有重复游戏移动，也没有把它们计入或隐去为加载时长。

本次production还通过了真实旧内存历史恢复的会话保护，详见[浏览器矩阵](browser-matrix.md#7-最终修复版chrome的正常续玩与会话保护)。这些结果不证明原其他基准设备或真正断外网通过；后续用户范围调整仅改变其是否必需。

## 8. 最终同源码观察包：Chrome移动与两档60秒采样

本组在同一台M1 Pro / 32 GB、同一Chrome、1512×771 CSS px、浏览器DPR2下执行。主任务把固定5174临时切到独立目录`test-results/m5-chrome-observation-dist`，实际页面分块为`index-BswYUKV9.js`；它与第7节production使用相同冻结源码，启用了已有只读验收快照。标准/低画质的渲染DPR分别为2/1，缩放1、音量0.6、音频启用，未静音、未减少动态或闪烁。此处记录观察包的实际性能，不把它写成production中直接读取的帧统计。

### 8.1 六步普通移动与世界镜头

先在仓库正常Left/Right三组，再通过区域图C、Up两步、Left六步、F进入完成房、F进入独立练习，正常Up/Down三组；[进入记录](evidence/m5-chrome-final-dense-normal-entry.json)保留逐步落点。没有导入性能初态、重设位置或改动地图。

| 场景                                                              | 六次实际完成时间（ms，表内保留1位小数）       | 检查结果                                                                  |
| ----------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------- |
| [仓库世界](evidence/m5-chrome-final-world-movement.json)：7,0↔6,0 | 108.3 / 107.5 / 108.7 / 104.7 / 110.2 / 110.4 | 6步≤140ms；每步相机实际focus为对应6,0或7,0，玩家与镜头都已到位，951→957代 |
| [64格房间](evidence/m5-chrome-final-dense-movement.json)：1,6↔1,5 | 105.7 / 104.4 / 107.5 / 110.9 / 105.4 / 106.3 | 6步≤140ms；局部整盘镜头保持固定，968→974代、撤销深度0→6                   |

每次按键后等待210ms再读取既有`render.lastPlayerMovement`。其`completedAtMs`由renderer在玩家已显示idle且相机focus到达目标后记录，表内时间取该记录的`durationMs`，没有把210ms观察等待当作动画时长。12步均无暂停，目标、领取、完成布局、成绩、区域数据和物资与各自初态一致。

### 8.2 两档连续前台与60次正常保存

每档开始前正常刷新、继续已有活动练习，输入计数为0，撤销栈为0。按30组Up/Down执行，每键后185ms观察等待，每组再1650ms空闲；分成三个宿主调用，调用间游戏继续前台运行。每档保存完整60步代数/落点/撤销/时钟/输入/渲染记录及三段完整快照。菜单、过场和故障面板没有进入末端采样窗口；面板折叠、故障配置均为空，快照生成开销仍计入实际运行。

| 指标                     | [标准画质](evidence/m5-chrome-final-dense-standard-performance.json) | [低画质](evidence/m5-chrome-final-dense-low-performance.json) |
| ------------------------ | -------------------------------------------------------------------: | ------------------------------------------------------------: |
| 宿主实际持续时间         |                                                              94875ms |                                                       96042ms |
| 有效时钟增量             |                                                            94858.6ms |                                                     96032.7ms |
| 末端帧环形窗口           |                                                   7200帧 / 60220.8ms |                                            7200帧 / 60228.8ms |
| 帧间隔中位 / p95         |                                                          8.3 / 9.3ms |                                                   8.3 / 9.3ms |
| 帧间隔均值               |                                                              8.364ms |                                                    8.365111ms |
| 正常输入计数             |                                                                   60 |                                                            60 |
| 输入到首次反馈p95 / 最大 |                                                        15.8 / 16.6ms |                                                 16.6 / 20.8ms |
| 本60步中最长实际移动完成 |                                                                112ms |                                                       110.7ms |
| 代数 / 撤销深度增量      |                                                                各+60 |                                                         各+60 |

本机本次两档均满足中位≤16.7ms、p95≤25ms、输入反馈p95≤100ms，以及已观测普通移动≤140ms。末端窗口由实际`sampleCount × meanMs`计算，均超过60秒并短于本次连续前台时段；没有把宿主94–96秒全称为帧环形窗口。两档input计数均恰好为本次60步，未混入进入房间的路线输入。

每步落点在1,5与1,6交替，代数和撤销深度逐步各+1；起终均为`c.theft.03.t.1.6`、活动独立练习，64格、无暂停、倒数0、无过场、待加载图标0。全部永久字段保持一致。[机器复核](evidence/m5-chrome-final-observation-validation.json)检查了这些关系及原阈值；[低画质实景](evidence/m5-chrome-final-dense-low-scene.jpg)在采样结束后拍摄，并已实际查看。

### 8.3 收尾与适用范围

通过正常设置恢复标准画质、退出练习，经区域图返回仓库并逐格走到终端，得到1109代、130/26、默认设置；[正常收尾路线](evidence/m5-chrome-final-observation-cleanup.json)完整保留。服务随后恢复`index-BpL7y5kK.js` production，正常刷新/继续、F触发“已完成，永久结果保留”，再次UI导出仍为1109代，最后返回可游玩画面，见[最终production恢复](evidence/m5-chrome-final-production-restored.json)。

没有重跑已通过的30次区域往返，没有修改游戏或测量阈值。原 M1 / 8 GB 与 Windows 指定硬件仍未实测，真实断外网仍未执行；用户随后接受本机 V05 并取消 V06 门槛，当前范围见本页开头。本组不把未测环境记为通过，也不将停止 Safari 验收写成旧失败已修复。
