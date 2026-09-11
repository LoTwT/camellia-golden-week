# 全量实施进度

[文档索引](../index.md) · [验收合同](../spec/acceptance.md)

## 当前状态

2026-09-11：用户已批准文档基线并授权 M1–M5 连续实施、依赖安装、资源处理、验证、里程碑提交、最终推送和 PR。历史文档的“本轮仅文档”保留其历史含义，不限制本 Goal。

- 用户已恢复本 Goal：提交溯源明确为 `gpt-6-astra` / `max`，本次必需浏览器改为 Chrome；随后接受本机基准通过即算该项通过，并取消断网游玩的发布门槛。[范围调整](acceptance-scope-2026-09-11.md)保留原话和适用边界。M1–M5 实现及当前必需验收已齐，分支与 PR 已发布；先前 blocked 记录保留历史含义。
- 本地及远端 main 均为 `bfb924b075aa6a153ed33b95ce4492260e18a8d9`；开工工作区干净，无后续提交或其他 worktree。
- 已从该基线建立 `codex/full-implementation`，保留 `codex/docs-baseline`。
- 已读取全部七份规格 / 来源入口和历史核对记录，并查询 Nowledge 交叉核对基线决策。

## 当前交付 / 下一步

M1–M5 已实现并提交；M5 实现提交为 `811da5a1eb6ac175aa380418c2d84cf079469713`。按本轮用户范围确认，63 个原始验收 ID 中 **62 项通过、V06 不再要求**。本机 Chrome 正常全收集链、恢复、会话隔离、两档帧率、输入、加载和移动 / 镜头预算全部达到原阈值，V05 已通过；原 M1 / 8 GB 与 Windows 基准机仍未实测，但不再作为本次发布条件。

实现分支已由 eruoos 推送，[PR #1](https://github.com/LoTwT/camellia-golden-week/pull/1) 已创建，面向 main、open 且非 draft；LoTwT 回查确认来源提交、仓库、作者与正文符合预备结果，main 仍是原基线。当前进入用户审阅；没有剩余必需游戏验收，也不继续其他设备或断网测试。发布回读与最新提交入口见[交付记录](release-candidate.md#7-实际-git-交付)。

V06 的 B133 请求隔离未建立，后续不再执行断网验收。原任务与一次清理尝试的临时 Chrome 标签及附属 DevTools 均已关闭，运行中的请求拦截已停用；持久默认 `*://*` / Block 规则删除、Network 过滤文字恢复因 ScreenCaptureKit `-3811` 未完成。没有操作用户其他页面、删除存档或发出游戏命令；恢复说明见[清理记录](offline-build-audit.md#93-取消离线验收后的有界清理尝试)。这是已披露的工具环境残留，不计为游戏失败或继续验收的门槛。

M5 原交付检查 E30 / E31：原生 **411/411**，零失败 / 取消 / 跳过 / todo，含只读 lint / format / type / content 的 production build 通过。当前包 84 文件 / 1,674,897 字节，45 资源记录、78 内容与 2 许可哈希匹配，85 次同源 HTTP 全部 200 且逐字节相同。845,629 字节静态 ZIP、指纹和启动说明见[交付记录](release-candidate.md)。较早 E29 / B122–B126 的 405 项、旧包及 Safari 结果保留历史含义。随后按用户要求完成 pnpm 迁移，干净冻结安装、全部工程检查、411 项测试及重建通过，产物与原 ZIP 逐字节相同；当前维护入口与最新证据见[pnpm 迁移记录](pnpm-migration.md)。

固定 5174 在原交付 16:44 恢复 production，入口与 JS 逐字节核对通过；后续 pnpm 迁移重新构建相同字节并重启 preview。最终正常续玩导出保持 1109 代 / 仓库 7,0 / 26 奖励与 130 物资、默认设置和永久结果。之后测试标签已关闭，迁移未操作浏览器存档；preview 服务继续运行，用户可重新打开本地入口选择继续。

### 早期实施调度记录（保留历史）

02:27（Asia/Shanghai）更新：M1阶段检查见下方追加记录。源码已用备用Git index冻结为tree `7bb7a2622333ad0859f40b4e228ad4a780fdc3f2`，没有修改用户主index，也没有创建提交。B区44格/5房已接入；M2世界共3区105格12房160本版数据，引用闭合通过。主agent继续界面/渲染/浏览器，static_puzzles完成B公开命令见证，realtime完善显式版本迁移注册与故障测试；验收映射63项已落盘。

独立分工：主 agent 负责工程、世界规则、渲染 / UI、输入、存档及集成验证；static_puzzles 负责静态规则和固定局部棋盘；realtime 负责有效时钟及实时规则；art_reference 负责素材辨认、来源与本地补制资源。共享工作区，文件职责隔离，子 agent 不做 Git 提交。

## 已决定的维护边界

- Vite + TypeScript + Three.js；界面采用原生 DOM/CSS；没有第二份 UI 游戏状态，无需 Vue / Pinia / Router / Tailwind。
- 当前使用 Node `24.18.0`、pnpm `11.25.0`；依赖从原 npm 锁文件导入，112 个包的版本与完整性校验值保持。安装设置迁到 pnpm-workspace.yaml，冻结安装使用 pnpm-lock.yaml；早期 npm `11.16.0` 日志保留历史含义。
- 本轮选择 Vite `8.3.0`、TypeScript `7.0.2`、Three.js `0.185.0`（与 `@types/three 0.185.4` 对齐）、Oxlint `1.82.0`、Oxfmt `0.67.0`。
- 规则层独立纯 TypeScript；JSON 为固定内容来源；本版 profile 与 full data 单独派生；不改主推进 / 奖励账本 / 性能阈值；验收设备与离线范围仅按本轮用户确认调整。
- 视觉以深黑空间、厚壳电视、亮屏功能图标为中心；黄色标识当前操作；镜头跟随、显露、机关反馈为三类短动画，可减少动态 / 闪烁。
- 未证实的坐标 / 图案明确标重建；无法确认可发布使用条件的原资产不冒充“已授权采用”。
- 构建期虚拟内容模块按profile裁剪执行内容；未来入口仅保留“本版本未收录”展示，不保留可执行目的地。M1–M5阶段全量目录先保留稳定ID，尚未实现的世界profile不冒充校验通过。
- 双槽envelope附可选 `supersededCorruptSlot:{id,sha256}`：用户明确替换/恢复后，记录仍被保留的损坏原槽摘要，防止下次刷新把已经确认过的未知代数坏槽重新当新冲突。只匹配相同原文，不删除坏档，不修改玩法载荷；有Node原生SHA256对照测试。
- 保存失败的 `retryInspection` 保留最后可信基线；只有确认本次写入原文及另一保留槽均未变化才接纳新基线，外部冲突结果不能成为下一次自动覆盖的授权。需要丢弃未保存内存重新读取时，先提供导出与确认；迁移失败单独显示错误、重试和原槽导出。
- 自动续步使用独立AdvanceAutoPath，只消费并重新校验已存路径的下一格，不借相邻ClickTile绕过安全条件或重新绕路。首个物理点击与每个实际自动步均重锚140ms；迟帧不补跑。新方向即使等待输入节奏也立即CancelAutoPath，取消只丢临时路径，不推进时钟、不增加稳定revision或保存。
- 已看中心代表图后才开始批量状态资源；实际检查A01 84个候选文件，城市Map Icons用途不符，原资产使用条件未被确认适用，采用项按合同补制。参考定位与逐项hash见[美术实施记录](../references/art-implementation.md)。

## 实际验证

| 日期       | 检查                                          | 结果 / 证据                                                                                                                                           |
| ---------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-11 | 本地 / 远端 main、dirty state、worktree、分支 | main OID 一致，开工干净，已建立任务分支；LoTwT API 身份已验证                                                                                         |
| 2026-09-11 | Node / npm、包注册表版本与 engines            | 实际版本如上；安装与命令结果待后续记录                                                                                                                |
| 2026-09-11 | `npm install` → `npm ci`                      | 先产生package-lock.json，再实际ci；退出0，审计0漏洞；npm提示fsevents可选install脚本未授权，Vite已正常运行                                             |
| 2026-09-11 | Node规则与适配层                              | 当次 `npm test` 97/97：静态46、时钟/实时30、save-store/session21；全仓typecheck通过，仍在增加世界与真实载荷测试                                       |
| 2026-09-11 | 中心/A可交互代表                              | [中心画面](evidence/m1-representative-hub.png)；1280×720，非V01规定视口，不能替代其尺寸矩阵                                                           |
| 2026-09-11 | 教学幂等、保存恢复                            | [只读快照](evidence/m1-tutorial-snapshot.json)，重复R物资仍1、saveGeneration仍5；刷新后有继续入口并保留能力/位置                                      |
| 2026-09-11 | 迷宫活动态刷新                                | [恢复快照](evidence/m1-maze-active-restored.json) / [画面](evidence/m1-maze-active-restored.png)，恢复a.maze.01.t.0.2，active，危险隐藏，撤销历史清空 |
| 2026-09-11 | M1仅主路径                                    | [快照](evidence/m1-main-only.json) / [画面](evidence/m1-main-only.png)，a.main已完成、数据20/100、6/26，未玩防火墙；B本包未收录，G02实际进入B待M2     |

## 范围调整前未解决记录（历史）

以下保留当时的 61 项通过与未完成状态；用户后续范围调整和当前交付进展见本页[当前状态](#当前状态)，不再据此等待其他设备或离线验收。

- 本 Goal 提交溯源由用户指定为 `Agent-Model: gpt-6-astra`、`Agent-Effort: max`，仅适用于本任务。M1–M4 已提交，完整元数据见[提交回读](evidence/milestone-commits.json)。
- 63条验收当前61项通过；剩余为V05的Chrome性能/设备、V06真实断外网。正式包、UI故障、键盘、视觉和资源前置已留证，具体范围以验收记录为准。
- Windows 与指定基准设备是否可用尚待核对；无实测列必须保持未验证。
- M5 尚未完成阶段验收；不得因阶段完成或缺少设备把总 Goal 标 complete。

## M1阶段验收（02:21）

中心/A正常新档全收集26/26，A首访80/80、完整80/100；刷新保持位置与奖励；静态preview的新档结算、导入真实文件后再刷新通过。Node原生测试152/152，lint、format:check、typecheck、validate:content、build、固定5174 preview通过。控制台error列表为空。

真实升级样本：[M1浏览器导出](evidence/m1-browser-save.json)。[全收集快照](evidence/m1-full-collection.json)、[刷新](evidence/m1-full-restored.json)、[成品结算](evidence/m1-preview-scope-complete.png)、[成品导入恢复](evidence/m1-preview-import-restored.png)。防火墙教学30，核心/深层/内层90；核心先领取时其余正式档未完成。

M1提交仍缺精确溯源字段，阶段源码与dist冻结于test-results/milestones/M1，继续M2的B地图、两个一笔画、杀毒、51物资及真实升级验证。JS约789KB（gzip185KB）有Vite体积提示，列M5优化；中文字体6.1MB本地加载。内嵌浏览器下载事件未确认，实际导出文本已保存，文件选择导入已通过；Chrome下载待实测。

## M2阶段验收（02:59）

M1真实26单位进度升级M2，再正常键鼠完成B两个一笔画、北/南数据和三杀毒。B主终端时仅20数据且未玩杀毒；随后A/B各80首访数据、11奖励ID、51/51物资。三杀毒重140、中99、轻71；重度先领取不依赖轻中，最小实际响应均超过200ms，失败后可重试。刷新与UI导出通过。

首次成功布局持久化后写入schema2，已完成房可行走但物体冻结；F独立练习不改首次布局。真实旧M2 schema1升级后正常重访一笔画、重复走格、拒绝撤销永久结果、内部刷新、独立练习和再领空箱，仍51；[schema2真实导出](evidence/m2-browser-save.json)包含三迷宫和两一笔画的完成布局、11奖励和七成绩。schema1原文另存[evidence/m2-browser-save-schema1.json](evidence/m2-browser-save-schema1.json)。

205/205 Node测试通过；只读lint/format/type/content/build通过。两个C预备JSON曾导致format:check失败，单独格式化后重跑通过，不进入M2包。M2世界3区105格12房，主线/全收集公开见证78/2480命令；M1当前runtime40/1309。production preview验证schema2恢复/练习，控制台error为空。原参考/本版差异、视觉尺寸和浏览器矩阵仍列M5；图形故障UI修复尚待注入验收。JS约1,008KB/gzip207KB，保留M5优化项。

M2源码和production dist已冻结于test-results/milestones/M2，tree 为 `27e74cd2aedc19c067fd68a942bc541ee5a99622`，仍等待用户提供精确提交溯源字段；C/D预备内容按文件排除，不进入M2里程碑。

## M3 阶段验收（03:12）

版本 0.3.0 / M3 / content3 / rule1 / schema2。真实 M2 浏览器存档升级后仍为51物资；正常进入 C、推动球与车，在车移动后刷新，局部位置和物体完整恢复、撤销历史清空。只完成组合机关与主终端时 C20/100、三盗取未完成；[真实主线导出](evidence/m3-browser-main-save.json)保留用于 M4 开区验证。

随后正常完成三个盗取、侧路和六项拾取，达到17奖励/81物资、C100，A/B仍各80。组合机关及盗取01/03实际制造边界死角并撤销/重置；盗取02实际交换同色对象的最终槽位，合法成功。已完成盗取02中推物被拒，首次布局和81物资不变。刷新与[完整UI导出](evidence/m3-browser-save.json)保留9个静态完成布局与七项成绩。浏览器步骤见验收 B14–B19。

236/236 Node 测试、lint/format:check/typecheck/validate:content/build通过。M3世界4区146格16房；新档主线/全收集见证131/2788命令，M2载荷续玩主线/全收集54/309命令。production preview恢复后[收集记录仍81/81](evidence/m3-production-collection.png)，控制台记录无error。球和目标站补充对应编号；将局部说明移到左侧后，不再遮挡本次C代表画面的玩家。旧遮挡截图保留用于精修对照。JS约1,245KB/gzip227KB，M5继续处理包体、画面尺寸与完整浏览器验收。

M3源码和production dist冻结于test-results/milestones/M3，tree 为 `ad33e9b2ede97f708b8b881c58d9d3a36ab004a2`，提交仍等待精确溯源字段。D/回访/仓库预备文件不进入M3阶段树；其临时规则检查不视为M4正式验收。

## M4 阶段验证（04:02）

版本 0.4.0 / M4 / content4 / rule1 / schema2。六区域214个世界格、18个房间，完整400数据、26奖励/130物资。真实M3浏览器81单位升级后，按02→04→03→01顺序完成权限、先B后A回访，故意最后补D隐藏数据；D80时仓库拒绝开放，补齐后最终终端一次发放9单位，重复F不再发放。两幽灵各有实际碰撞失败、亮灯与成功记录。补入 `d.t.5.1` 使双幽灵额外奖励可独立于权限01领取，不改既有坐标或奖励条件。

Chrome 独立新游戏通过正常键鼠推进：A/B/C主路径各20数据即可开放下一区；四权限依次03→04→01→02，先A后B回访，补齐四区后在完全未完成正式防火墙/杀毒的情况下进入仓库并结算100单位。随后防火墙教学30、内层88、深层84、核心89；杀毒轻71、中99、重140，逐项领取后达到130单位/26ID。核心首轮51失败与一次测试脚本未发按键的失败均保留，成功重试未改变规则。三档杀毒的最短实际反应均超过200ms。

[新档全收集](evidence/m4-chrome-newgame-full.json)、[真实UI导出](evidence/m4-chrome-browser-full-save.json)、[刷新恢复](evidence/m4-chrome-newgame-full-restored.json)保留四区100、26ID、首次完成布局和实际最好成绩，控制台error为空。升级链的[真实M4导出](evidence/m4-browser-save.json)独立保留。完整截图、动作与时序记录见验收B20之后的追加项。

正式公开命令见证：新档不评分主线688命令/105960ms、全收集3135命令/523880ms；M3主线续玩558命令/86000ms、全收集续玩348命令/53080ms。覆盖24种权限顺序、两种回访顺序、20种缺一项数据、最终奖励重复交互与30次自由往返。M4最终原生测试325/325通过，lint、format:check、typecheck、validate:content和production build均通过。新增两份Chrome真实导出到M5的规则迁移用例保留100/20与130/26、9首次布局和源字节。生产preview的[26项收集界面](evidence/m4-production-collection.png)及[控制台](evidence/m4-production-console.json)再次确认恢复成功。JS约1,527KB/gzip253KB，中文字体6.1MB，列入M5优化。M4源码和成品将冻结到test-results/milestones/M4，提交仍待精确溯源字段。M5未宣称通过。

## M5 集成与故障验收（进行中）

M4源码与成品已冻结到test-results/milestones/M4，tree为 `4114202ae8d6dc2a37aa63d054f6422926e1f9da`（310个路径），未创建提交。

当前代码为0.5.0 / M5，content4 / rule1 / schema2保持不变。电视比例、紧密格距、圆眼双耳玩家、箱形推车、暗幽灵及亮/灭灯精修已集成；局部棋盘按实际包围框拟合，世界棋盘绘制与拾取共用HUD之外的可用区域。局部缩放在完整可见与44px目标约束下限幅，界面已说明。场景切换以transition暂停权威时钟，预载本地纹理和字体、编译渲染并绘制后才恢复。

字体缩至182,388字节、覆盖797源字符；45项资源清单和文件哈希检查接入validate:content及build且保持只读。历史profile内容采用构建期结构共享，生产JS从M4约1,527KB降至约910KB/gzip214KB，M1–M5公开规则见证均通过。首轮全套原生测试355/355，随后升级结算相关98项回归通过；最新完整360项及其后小改的边界见下方追加记录，旧日志保留。

真实M4 Chrome130进度继续M5保持26奖励和四区数据；迷宫独立练习、杀毒重度完整重玩仍130。浏览器实际300ms前台阻塞触发clockGap冻结；实际WebGL丢失/恢复保持892.1ms有效时间、同格与成绩，恢复须3秒倒数；WebGL2缺失启动显示失败且实际导出原槽；音频拒绝仍能走格、重试恢复。验收发现并修复：M4→M5首次稳定操作重复结算；确认框Esc无效；存档页状态不随重试更新；自动暂停恢复与音频按钮隐藏后的焦点丢失。代码修复与浏览器复验逐项记入验收记录，未完成项不推定通过。

早期1366×768画面的实际渲染DPR为1，误名已更正且原字节保留。当前[视口矩阵](viewport-matrix.md)包含1366×768 / 1920×1080、DPR1/2、游戏缩放两端，C八组真实点击2,5并Z回1,5、D八组仅显示核对；D尚未逐端点点击或验证非零幽灵状态跨窗口保留，不能宣布完整V01通过。六类最终对照、完整Safari流程、60秒性能与外网断开仍在推进；30次浏览器往返已在后续B77补齐。Windows和指定基准硬件缺少可操作环境，已询问安排；提交溯源字段仍待用户提供。

## M5 存储恢复与 Safari 补证（继续中）

验收页已追加B54–B68，均按实际快照限定结论。Chrome的[一次存储故障记录](evidence/m5-chrome-storage-one-shot-faults.json)保留读取失败的真实缺陷：可信代数637误退到636，下一重试误报外部冲突；同文件set/readback故障各有正常重试恢复。修复 `retryInspection` 后，[IAB读取重试](evidence/m5-iab-read-retry-fixed.json)的失败仍保持650，单击一次重试即651已保存，位置、48目标、26领取、九布局、九成绩与130物资不变。新增四条原生回归覆盖可信基线和外部变化拒绝；`node --test tests/save-store.test.ts tests/acceptance-faults.test.ts` 本轮实际38/38通过，先前限定存档复核25/25也通过，均不是全仓重复执行。

IAB启动原槽A/B导出后Esc曾使dialog默认关闭，修复前记录保留；keydown先阻止默认关闭后四次返回都保持“继续探索”与“继续游戏”焦点。迁移前备份写入或回读失败现在停在“进度升级未保存”，保留重试及原槽导出；[写失败后的字节比较](evidence/m5-iab-migration-backup-readback.json)确认A9359 / B9292字节均不变。解除后真实M4原槽649恢复为M5的650 / 130，但[取证后帧](evidence/m5-iab-real-m4-upgrade-restored.json)虽名afterRepeatedFinal，实际为blur暂停，当时不能确认重复F；后续B76另以原M4重新导入及真实F/移动补齐，旧暂停帧保留。

[六类非法文件导入](evidence/m5-iab-invalid-imports.json)均实际选择并被校验拒绝，世界和650不变、脚本未执行；合法文件预览取消不替换。已有进度确认新游戏为651→652，刷新仍0物资；再次明确导入真实进度才652→653 / 130，刷新保持。六组槽夹具补齐单坏 / 双坏 / 较新schema / 较新content / 高代数在A或B的启动分类；较新原文实际导出匹配。读取不可用时显式临时游玩，刷新仍保留future517和valid516。故障测试后清理已知注入槽并通过UI导入原进度恢复130，只是故障恢复，不能当作新的正常通关或把测试槽generation518与此前653串成代数回退。

文件选择input原先脱离DOM导致工具后端节点消失，现隐藏挂到body并在change/cancel后移除，六文件已完成真实选择。原生AX本轮每项text在512字符处截断；验收只读JSON改为360字符分段后，Safari完整数据成功拼回。后续又避免未展开快照时重建这些DOM节点；这些修改仅提高验收读取可靠性，不修改游戏规则或作为性能通过证据。

Safari正常新游戏完成中心R教学，1物资、generation5、无限增幅及A主路径提示可见；[实际快照](evidence/m5-safari-center-after-amplify.json)为1455×854 / DPR2，firstGamePreparationMs=28405。继续A迷宫01以U4/R4成功后，受控render反馈异常触发失败UI，但目标与首次布局已经保存、位置为a.t.5.0、generation23 / 1物资；重试图形及[刷新继续](evidence/m5-safari-cached-continue.json)仍保留成功。明确Raise前台后该次缓存继续准备60ms，不能据此撤销28,405ms异常。10秒诊断599帧median17/p9518、后次约3秒187帧median17/p9525，均为短时诊断且末帧处于暂停；未达到60秒最密场景采样，输入样本为0，Safari完整版本和性能仍待验证。

主任务最新一次 `npm test` 为360/360、0失败 / 取消 / 跳过、2032.363ms；[当次原始日志](evidence/m5-native-tests-360.log)已原样复制，37301字节，SHA-256为 `bee8ff53e5718ef43dc9d99097d0892fbf8278c3372308480ea61bdd1dc977fe`。此后有验收快照启动元数据、输出分段与隐藏时避免DOM重建的小改；最终构建仍须检查生产包移除全部故障 / 快照入口，不能用该日志宣称后续修改或生产检查已通过。

## M5 Safari 成功后音频与焦点续记

B69–B71已加入验收映射。Safari正常完成迷宫02后，一次成功音频反馈异常被实际消耗；audio=false但目标、第二份首次布局和a.t.1.-4已保存于generation39，物资仍1。音频重试后的[原快照](evidence/m5-safari-success-audio-recovered.json)虽然enabled=true，随后Left没有移动，原生AX激活按钮后的焦点缺陷保留为失败，不能用声音启用替代方向恢复证据。

修复为音频提示原先可见且dialog已关闭时重新聚焦棋盘，[最新复验](evidence/m5-safari-audio-focus-fixed.json)不点击canvas，实际Left从a.t.1.-4到a.t.0.-4、generation40 / audio=true，然后Esc暂停。原先ArrowLeft名称被工具拒绝、没有发送，不计游戏操作或游戏失败。该次19ms仅1个输入样本，不能填作输入p95通过。成功后的render与audio异常现各有Safari记录；当时成功帧setItem失败/内存导出尚待补证，随后B72–B75补齐；全控件键盘、其余恢复及性能继续验证，本轮没有重复全套测试。

## M5 成功帧保存、升级终端与区域往返续记

B72–B75记录Safari正常迷宫03成功前最后一步的B槽setItem一次故障。合法替代路线URUURURRDRRUUU完成后，已从6.1到世界a.t.1.4，新增第三份完成布局与a.maze.03，但generation仍59、明确显示未保存，物资仍1。[实际下载的内存导出](evidence/m5-safari-unsaved-success-export.json)为1821字节，包含刚完成的目标/布局，不能称为磁盘槽原文。OS拒绝shell读取Downloads后没有绕过，证据通过当前明确下载文件的原生文件选择器预览取得；真实M5载荷校验器接受该原文。

一次重试后generation60已保存，[刷新恢复](evidence/m5-safari-success-write-restored.json)仍在同格、三迷宫完成、1物资；正常选择该下载文件进入导入预览，Esc取消仍60且永久字段相同。成功帧render、audio、setItem三个通道现各有Safari正常机关成功后的实际异常及恢复证据，I08/P03据此与规则幂等测试对应通过；这些是故障恢复验收，不是另一次正常全收集。

[原M4升级结算复验](evidence/m5-iab-m4-repeat-settlement-fixed.json)通过UI重新导入只含M1–M4历史的原槽，M5仓库终端generation519 / 130。正常F返回alreadyCompleted且不暂停，首次稳定操作回填M5历史为520；再F仍520，Left/Right为521/522，再F仍522，dialog始终关闭、焦点为棋盘。B45重复结算的浏览器修复已确认，B58暂停帧不足的历史记录保留；直接M1→M4 UI迁移仍未验证。

[Chrome30次区域往返](evidence/m5-chrome-30-region-roundtrips.json)由正常M键及已激活传送按钮完成，中心↔A/B/C/D/仓库各6回、共60次传送。逐帧复算全部落点正确、无反向循环，物资/数据/目标/领取/首次布局/成绩与原Chrome真实130基线相同；同区域完整render计数各只有一组，geometries均10、pending均0，textures依A/中心/B/C/D/仓库为17/9/16/13/15/9。I09及V05资源增长子项通过；结合已记录的同档迷宫/实时练习与加载，G09重复链已齐。60秒最密场景与输入预算、指定硬件和真正离线仍未通过，本轮未重新运行全套测试。

## M5 本机性能与备份 / 临时模式恢复续记

B78/B79在Chrome正常抵达的64格C盗取03练习，分别以标准和低画质、1512×771 CSS / 浏览器DPR2连续前台采样；标准渲染DPR2，低画质DPR1。每档刷新继续后重置统计，30组正常Up/Down加停留共60次输入，实际保存与acceptance取证开销计入。标准host88738ms / active增加88735.7ms，末7200帧覆盖61.7445秒、median8.4 / p9510.9ms，输入p9518.3 / max22.2ms；低画质host95468ms / active增加95468.6ms，末7200帧覆盖61.1206秒、median8.4 / p9512.6ms，输入p9518.6 / max21.2ms。实际五帧记录均active、无暂停或过场，永久字段不变，见[标准](evidence/m5-chrome-dense-standard-performance.json)与[低画质](evidence/m5-chrome-dense-low-performance.json)。

两档软件计量均达到本机M1 Pro的帧间隔与输入预算，结合B77资源计数稳定，已有真实60秒前台结果；不能据此关闭Apple M1/8GB与Windows i5/Iris Xe/16GB的未验证列。普通移动动画时长、Safari首次准备异常及完整设备矩阵仍待完成，早期暂停/短时诊断没有改写成性能通过。

B80实际点击“使用备份继续”，从受控A有效516/B坏JSON恢复517 / 130，刷新仍同格与原完成布局、成绩；[完整备份恢复记录](evidence/m5-iab-explicit-backup-restored.json)补齐此前只展示入口的缺口。B81/B82在future517/valid516夹具下读取失败，主动进入临时新游戏，通过正常Right×3/R教学取得1物资并[实际UI导出](evidence/m5-iab-temporary-earned-save.json)；刷新后仍是future保护，原A/B经UI导出对夹具逐字一致。B83清理仅已知future注入后，真实选择该临时文件并确认导入518，刷新保留hub.t.3.2 / 1物资；[导入恢复记录](evidence/m5-iab-temporary-save-import-restored.json)与真实M5语义校验均通过。

P04/P09/P11据此补齐浏览器恢复。最后再次UI导入原M4全收集回到519 / 130，只是故障测试清理；这条夹具局部代数链不能与B76的522或Chrome真实历史串联，也不作为正常新档全收集证据。两个文档继续保留未验证设备和剩余操作边界，未修改规则或原始证据。

## M5 D刷新、键盘菜单与分层复核

B85 Chrome在D正常动作后刷新仍为d.t.0.-1、generation841 / 130，完成布局、成绩、数据及领取不变。B86正常双幽灵02练习Right到1.2 / running，有效364.8ms，再Esc暂停后刷新继续回d.t.0.-2安全入口、generation843与永久字段不变，见[D世界刷新](evidence/m5-chrome-d-world-refresh.json)和[幽灵尝试刷新](evidence/m5-chrome-ghost-active-refresh.json)。后者并非成功事务帧刷新，杀毒活动与成功帧精确边界仍待浏览器记录。

[纯键盘菜单记录](evidence/m5-chrome-keyboard-menus.json)覆盖暂停、设置、区域图、收集，区域图WASD/R/Z/四向不改变位置或843；三页退出均回game-canvas。设置11次焦点观测含9个正式控件、验收summary及回到首滑块，不称11个产品控件；一次:focus工具节点失效未改变实际焦点，以当前可见标签继续，未视为应用失败。存档/挑战页与其余输入/可见焦点验证继续推进。

按验收合同第1节复核已有证据，G05/S02/T11改为规定层的通过：24种权限走图与两种真实浏览器排列、迷宫实际刷新/重置配合规则无重复奖励、两个幽灵世界接口的499ms暂停/30秒后台/3秒倒数后仍余1ms。E18原始通过日志与源码均已核对，不新增24次浏览器排列或1ms物理注入为阻塞；浏览器未执行的对应诊断继续明示。合同通过值、正常全流程和V类指定硬件要求没有改变。

## M5 存档 / 挑战键盘、D活动点击与完整分层校准

B88纯键盘进入存档、导出、新游戏取消及重新读取取消；导出只读文本框内WASD/R/Z/四向不改d.t.0.-2、generation843或永久结果，三个Esc返回存档首控件。Chrome文件选择setFiles被扩展权限以Not allowed拒绝，主执行者按工具文档告知需Allow access to file URLs，未将该段算作Chrome导入通过。IAB/Safari的实际文件导入仍独立有效；脚本误label和此前:focus定位重试不作为应用缺陷，见[存档键盘记录](evidence/m5-chrome-keyboard-storage.json)。

B89通过F/Tab/Enter返回幽灵准备页、开始后Esc/Tab/Enter放弃，回d.t.0.-2且永久结果不变，焦点回canvas。B90实际键盘选择杀毒重度、有效410.6ms/running后Esc刷新，继续回b.t.0.3安全入口、generation850与130保留，见[挑战键盘](evidence/m5-chrome-keyboard-challenge.json)和[杀毒刷新](evidence/m5-chrome-antivirus-active-refresh.json)。结合防火墙/幽灵及即时事务载荷测试，P02的规定层证据已齐，不把暂停后刷新称为浏览器精确动画前刷新。

B91在已亮灯01、已清幽灵01、非零时间的幽灵02尝试中，完成1366/1920、DPR1、缩放两端四组真实点击2.2↔3.2；调整窗口/缩放期间位置、时间、完整局部灯态与永久结果逐项一致，目标最小59.88–138.07 CSS px、整盘拟合。DPR2四组活动点击被原生窗口切换保护阻止，仍待完成，[四组记录](evidence/m5-v01-d-active-click-matrix.json)不冒充八组通过。浏览器安装版本、性能方法与离线资源前置统一引用[设备矩阵](browser-matrix.md)、[性能实测](performance.md)、[离线审计](offline-build-audit.md)。

完整读取63条合同后，已充分覆盖的G10、I01/I04/I06/I07/I10、S08、T04、P01/P02/P07/P10按规定的世界/输入/载荷/会话层及已有浏览器代表操作明确通过，不另加每房每排列UI穷举。I03停止边界、T08设置同分和表现、跨来源以及V类实际显示/设备/离线仍保留具体缺口；未修改合同通过数值或全流程要求。

G11复核发现原UI仅通用升级说明、没有新增A/B回访提示。经根任务授权，仅新增纯函数src/platform/upgrade-summary.ts及main的继续/导入摘要接线：从原envelope与目标profile差集识别新增回访，复用门的gateReason和areaData，显示D四权限后开放、首访数据及物资保留；主路径仍指向后续主线。M1→M4/M5为A80/100、A25物资，M2/M3保留A/B80/100，M4→M5不误报新增。typecheck、两源文件Oxlint/Oxfmt、45资源/字体检查及六组真实导出的inspect/prepareImport只读断言通过；未build/dist，交回root用真实M1文件做当前M4/M5 UI复验。两摘要路径无migrationNotes可直接透传，复用原envelope且未改store或规则接口。

## M5 直接升级、跨来源与图形恢复完成补证

验收页新增B92–B96。G11以当前0.5.0源码 `--mode m4` production构建直接继续真实M1原文，并实际选择原文件查看导入确认；**此包不是冻结M4树**。两处UI都明确新增A/B回访、D四权限后开放、首访数据保留，主任务继续指向B。实际UI导出由原129/schema1升级为130/schema2，三迷宫完成布局确定性回填，原目标/领取/成绩/位置保持；A25物资、数据80/100，总26/130，campaignCompletedAt=null且只有M1历史，见[升级载荷复核](evidence/m5-code-m1-to-m4-validation.json)。M4刷新保持，再[继续M5](evidence/m5-code-m1-via-m4-restored.json)为generation132、a.t.-3.-4、14目标/六领取/三布局，已有回访不再误报新增；没有完成任何新增主线或仓库。

P12已实际显式启动临时5175，与正常5174隔离。[跨来源记录](evidence/m5-cross-origin-import.json)中5175首次新档1/0物资、启动/存档页标明来源；通过正常文件选择导入真实M4全收集后为本来源2/130，刷新仍2、仓库7.0、四区100及九布局/26领取不变。原5174仍132/26物资，永久字段与此前升级档相同；两个来源的代数不互相比大小。临时服务与页已关闭。已有5174占用时再次严格preview实际exit1，报Port 5174 is already in use；[624字节原始日志](evidence/m5-strict-port-conflict.log)从test-results逐字复制，未将临时测试端口改为产品默认端口。

V04新增[完整上下文恢复](evidence/m5-context-restored-active.json)：正常幽灵02在非零86317ms手动暂停，请求真实loss后增加graphicsLost，重建回manual，完整局部灯/幽灵、位置、有效时间和永久状态逐项相同。显式继续先冻结倒数，再实际进入countdown0/pause空的98130.1ms活动态；正常Left由3.2到2.2、98321.1ms，仍859/130。9369字节[实际UI导出](evidence/m5-context-loss-ui-export.json)合法，按合同保存外层d.t.0.-2和restartChallenge提示，不能说导出恢复活动计时。B41旧记录只到倒数的边界保留；结合启动WebGL2失败可导出及拒音频仍可玩，V04合同三种场景通过，不新增全部故障的组合穷举。

V01的DPR2四组已补，D九列现在两尺寸×两DPR×两端共八组，正常点击2.2↔3.2都正确。窗口/缩放前后完整realtimeRoom与非零时间相同、目标最小59.88px，主执行者实际查看八张图，见[完整视口矩阵](viewport-matrix.md)。DPR2由原生Chrome200%及两倍viewport覆盖取得，actual viewport明确相应CSS尺寸/DPR2；参数误用后的正式重测、较早窗口保护及上下文故障历史都保留。采集后浏览器恢复100%且取消覆盖；与C八组点击/Z共同关闭V01，不推定完整浏览器或硬件矩阵通过。

## M5 自动行走修复、正常键鼠与定向规则检查

I03核查确认两处实际接线缺陷：首次物理远点未更新lastAutoStep，隔离执行原main分支时下一RAF仅1ms就再走一步；自动续步将尾目标重新作为ClickTile，最后只剩相邻格时绕过isSafeAutoTile。已改为独立自动/取消命令和输入调度器，逐格复核且从实际动作重锚140ms；新方向即使进入等待队列也立即取消。新增8项回归覆盖中途/末步11类边界、已有替代路线也停止、合法开门通行、普通手动拾取、取消不存档/不占时及暂停/断档不补走。

B97实际IAB远点发现但未访问A2,-2被拒，A0,0与133保持；改点已访问A1,-2，一次点击依次0,-1/134→0,-2/135→1,-2/136，见[未访问拒绝](evidence/m5-iab-auto-walk-unvisited-rejected.json)和[逐格记录](evidence/m5-iab-auto-walk-fixed.json)。B98远点后立即Right打断回1,-2/138，等500ms仍同格；指向1,-4又被1,-3的roomEntrance挡在前格，[正常键鼠打断与入口边界](evidence/m5-iab-auto-walk-keyboard-interrupt.json)未修改地图或世界状态。B99相邻鼠标与Right返回也通过。浏览器轮询不能精确测140ms，节奏由可注入时间的原生测试证明，边界故障仅在规则测试初态中注入。I03按规定层通过。

shell曾以lastResult对象引用识别新提示，重绘时提示期限反复延长，造成恢复后的“准备继续”残留。改为比较实际code/message；[相邻操作与提示到期实测](evidence/m5-iab-adjacent-click-and-feedback-expiry.json)记录无效提示立即可见、2500ms后为空，位置、generation140和26物资不变。修复前截图保留，不把旧文案当成实际倒数。

E21为子任务实际 `node --test tests/settings-equivalence.test.ts` 14/14：七个防火墙/杀毒挑战各成功/失败，七种设置共98组公开命令等价，时钟/分数/反馈/永久字段一致；T08仍待实际画面拍点/目标可辨。E22为主任务实际 `node --test tests/upgrade-summary.test.ts` 10/10，覆盖继续/导入、真实M1/M2/M3升级摘要及保存后不重复提示。E23为本子任务实际 `node --test tests/auto-walk.test.ts tests/input.test.ts tests/world.test.ts tests/world-ghost.test.ts` 48/48、287.606875ms，typecheck/限定Oxlint/Oxfmt/diff通过；首次新测试格式检查失败后已修正复验。未重复全套或把限定通过数相加，最终工程检查继续由主任务执行。

当前G11/I03/P12/V01/V04具体缺口已由新证据关闭；V02只补独立的结果/重试、静态/完成房控件和代表焦点，不另列每个共用难度按钮或全部存储故障排列。指定硬件、完整浏览器流程、视觉状态、剩余性能及真实断外网仍按原合同保留，Goal继续active。

## M5 键盘结果/静态控件与减少效果语义补证

验收页追加B100–B105，T08/V02/V03按原合同通过。Chrome全程键盘Continue→区域图A→三次Up/F/Enter教学，正常零评分输入到15000ms失败，焦点在“再挑战一次”；Enter回准备页教学首控件。再次零输入失败后Tab/Enter“返回地图”，回a.t.0.-3/game-canvas且dialog关闭、generation885/130。两次失败、重试和返回的永久目标/领取/首次布局/最好成绩/数据逐项一致，见[结果页纯键盘记录](evidence/m5-chrome-keyboard-result.json)。结果成功/失败共用两个控件，难度选择也共用已测试循环，不额外安排同结构重复矩阵。

[静态与完成房键盘记录](evidence/m5-chrome-keyboard-static-controls.json)从正常M/Tab到C、U2/L6/F进入盗取03完成布局。Tab“F独立练习”/Enter，Right由1.6到2.6，再Tab到Z/Enter回1.6、undoDepth1→0；Tab重置/Enter保持初始布局，Tab返回入口/Enter回c.t.-6.-2。再次F进入完成房，Tab返回外层入口/Enter回同格，最后904/130，首次完成布局和其他永久字段不变。主执行者实际查看教学准备、结果重试/返回、完成房练习/返回及静态撤销六张焦点图；按钮金色轮廓可见，操作结束回canvas，V02剩余独立控件已齐。

在进行中的教学尝试暂停后，以实际键盘设置音量0.2、静音/减少闪烁/减少动态=true，quality仍standard、zoom1；End并未改变画质，不能写为low。[拍点两次采集](evidence/m5-reduced-firewall-beats.json)的capture-1实际无金边、capture-2实际有金边，Combo、目标和剩余时间可读。两次截图前后跨333.0/331.9ms，JSON expected/classes只属于截图前DOM，原on/off相位误判已在note澄清；不以截图反推100/400ms评分边界。正常内层[713.3→1034.3ms采集](evidence/m5-reduced-firewall-hazards.json)的红色危险屏加黑三角感叹号可辨，返回后130及永久结果不变。结合E21的14项/98组公开Settings规则等价，T08通过。

同一实际标准画质与减少效果组合中，[盗取03对象/接收槽画面](evidence/m5-reduced-theft-sockets.jpg)以实心对象/空心槽及A/B/C字母对应颜色，匹配0/3提示明确。正常穿过已完成迷宫到a.t.5.0，[世界与收集记录](evidence/m5-reduced-data-and-supply.json)保留917/130；箱子、终端、完成标记有不同形状，HUD与[收集顶部](evidence/m5-reduced-collection-data-top.jpg)分别显示数据100/100、物资130/130及四区/26奖励独立账本。V03五类语义代表画面与规则一致性已齐；此前B53低画质幽灵组合继续单独作为低画质代表，不把本批标准画质伪称低档。

本轮文档维护实际查看拍点两帧、危险、接收槽、世界HUD、收集顶部及两张代表焦点共八图，重新比较上述JSON的状态、设置和永久字段；未操作浏览器、改写证据或重复全套。当前63条未齐映射为V05/V06，指定设备/浏览器、完整工程与最终交付仍不得省略，M5与Goal继续未完成。

## M5 Safari 性能、会话与移动修复补证

验收页追加 B106 至 B120、E25 至 E28。本轮只维护两份总文档，读取现有证据、实际查看 800×500 警告与导出两图，并以只读断言比较性能/移动前后的永久字段、60 步代数与撤销深度、六步实际渲染端点；没有操作浏览器、改写证据、重复全套或重新构造通关。

Safari [普通缓存继续](evidence/m5-safari-cached-continue-normal.json)的宿主上界为 1195ms，第一次游戏准备 87ms；正常 Right 后 a.t.2.4、generation61、6 单位、无暂停，支持本次继续到可操作不超过 3 秒。1195ms 不从导航开始计时，before 属于旧会话，另一阶段 182938ms 及先前 28405ms / 27059ms 异常保留，不能拼接或删去。

[标准](evidence/m5-safari-dense-standard-performance.json)与[低档](evidence/m5-safari-dense-low-performance.json)均在真实导入准备后的 64 格盗取 03 练习中正常执行 60 步。generation 分别 82→142、146→206，撤销深度各加 60，位置、130 单位及全部永久字段不变。帧间隔中位均为 **17ms，超过 16.7ms，失败**，p95 分别 23/22ms；输入统计累计到 70/133 个，不冒充各档独立 60 步的百分位。首次未聚焦采样没有接受输入，保留为诊断并排除为通过证据。正常文件导入恢复 Safari 自己的 generation62 备份后，[本地最高代数 206→207](evidence/m5-safari-own-progress-restored-after-performance.json)，回 a.t.1.4、6 单位；这不是新通关或自动丢失全收集进度。计时窗口与输入限制见[性能记录](performance.md)。

早先内嵌浏览器六步 123.5 至 130.7ms、Safari 六步 122 至 137ms 均为实际渲染端点，仍保留 Safari 标准热身 159ms 的超限。主任务将相机和玩家视觉目标由 120ms 改为 100ms 后，[内嵌浏览器复验](evidence/m5-iab-movement-100ms.json)为 104.8 至 109.5ms、generation159 至 164；[Safari 64 格复验](evidence/m5-safari-dense-movement-100ms.json)为 101 至 116ms、generation226 至 231、撤销 1 至 6。两组均真实键盘、无暂停、永久字段不变，未改 140ms 输入规则，也未重新测出帧率改善。Safari 再经真实文件选择器[恢复自己的 6 单位进度](evidence/m5-safari-own-progress-restored-after-movement.json)，generation232、a.t.1.4、标准画质。

[800×500 小窗口](evidence/m5-small-viewport.json)中，暂停、存档、导出文本及下载/返回控件可用，generation917、130 单位与 a.t.5.0 不变；[实际导出](evidence/m5-small-viewport-ui-export.json)保留该进度。两图可见仅验收面板遮住部分底部与文本框，不称为全画面无遮挡；正式包剔除仍待最终构建核验。

会话适配器只在首次 busy 后等待 100ms，再作一次 exclusive / ifAvailable 获取。release、获取期隐藏或取消会终止等待，后续请求隔离迟到回调；已持锁会话的普通失焦/隐藏不释放锁，实际另一页持有时仍 busy 并保留只读导出。新增 7 项会话测试与 25 项存储回归共 32/32；仅验收诊断另有 6 项，组合 38/38。诊断独立 sessionStorage 限 80 条 / 48KiB，记录生命周期、请求完成与原生 held/pending/clientId，不接触双槽或游戏状态，生产禁用由规则测试覆盖，最终包剔除仍需构建检查。

[旧导航失败](evidence/m5-safari-session-navigation-recovery.json)保留：一次同源查询 URL 导航持续 busy，返回根页可继续，内部持锁者未观测，释放竞态仅是推断。新五份 Safari 轨迹在[验收页 B115/B116](acceptance-results.md)逐项链接：两次首 busy 后，唯一短重试分别于 255ms / 284ms 取得锁；Back 目标是新文档，Forward 才回到相同 pageId 的 BFCache 文档，pageshow.persisted=true 从 idle 明确获取到 held。58 条连续事件未截断，原生查询仅一 held、无 pending；均为 loaded=false 菜单且槽检查 A207/B206 不变，不冒充活动游戏或全部导航覆盖。该证据无需继续盲增等待，旧失败与手动重试途径仍保留。

新逻辑的[真实第二标签](evidence/m5-session-second-writer-busy.json)在原标签 held / generation164 / 26 单位时两次返回 null，没有抢锁。关闭原标签后的[第一次立即显式重试](evidence/m5-session-second-writer-immediate-retry-diagnostic.json)仍两次 null，末端 query 才显示没有 held/pending；[再次显式重试](evidence/m5-session-second-writer-acquired.json)取得 held，正常继续仍 164/26，Left/Right 保存为 165/166 并回 a.t.1.-2，永久字段不变。保留两次手动重试顺序，不把关闭时刻当成浏览器锁已释放的证据；新标签为默认 1280×720 / DPR2，旧标签及视口覆盖已清理。

较早完整 npm test 为 392/392、3577.293417ms，后来的 32/38 项定向组合不与它相加。主任务随后实际完成 lint / typecheck / validate:content / npm test，最新 **405/405**、0 失败/取消/跳过/todo、3871.044791ms，覆盖当前 100ms 调整、会话与诊断。[392 项历史日志](evidence/m5-native-tests-392.log)与[405 项最新日志](evidence/m5-release-native-tests.log)已逐字归档，E28 同时链接工程日志并记录完整测试哈希。内容校验通过 45 资源、800 源字体字符、五期账本、27 静态 / 18 实时及所有公开世界见证；字体当前 182064 字节、1418 glyph / 1109 cmap，资产权威记录仍由美术文档维护。全仓格式、构建、正式成品与剩余浏览器/离线验收尚未齐，M5 和 Goal 均未完成。

## M5 重复提示修复与干净安装

收尾正常键盘核查发现相同无效操作的提示到期后不会重新显示。B121保留[修复前](evidence/m5-repeat-identical-feedback-before.json)的第二次空提示；主程序现在仅对实际非Tick / CancelAutoPath命令重新开始2400ms提示期限，Shell仍按结果变化处理其他更新。[实际复验](evidence/m5-repeat-identical-feedback-fixed.json)两次F均显示“当前格没有可交互对象”，两次2500ms等待后均为空，A1,-2、generation168和26物资不变。限定类型、lint与格式通过；这是界面接线修复，未改规则、时钟或存档。

以Node24.18.0/npm11.16.0再次执行[干净安装](evidence/m5-release-npm-ci.log)，exit0，安装33/审计34包，0漏洞；npm另提示fsevents的可选安装脚本未执行。全仓首次格式检查仅因验收表归档链接调整而失败，正重新排版；后续正式构建另记实际结果。

## 恢复规则

上下文切换后先读取本记录、`git status` 与当前源码 / 测试，核对子 agent 结果；继续未完成工作，不重置已有状态。每阶段更新本页并链接实际证据、版本和提交。

## M5 正式生产包与交付归档续记

已完成B122–B125/E29。最新源码最后一次修改为相同无效操作的提示重显，随后重新npm ci、405/405测试和完整production build通过。正式目录84文件/1672132B，树指纹 `6a6a7d99799723f5c2527b4056b9fecc72039487938f492fde5aef6b24d565e7`；844320B的[静态ZIP](evidence/m5-production-dist.zip)逐文件解压校验通过，归档期间dist未变。最终[资源审计](offline-build-audit.md)在开始/结束均确认该指纹，85次本地请求全部200且字节一致；这不是断外网证明。

Chromeproduction由原正常M4全收集链继续，正常完成房出入、区域图及逐格回访仓库、两次重复F、导出和刷新，947/130、四区100及完整载荷相同；内嵌升级链170/26、Safari自身234/6均正常续玩。800×500扩窗提示、菜单及导出截图已实际查看，原acceptance面板的遮挡限制不再存在。所有真实导出经当前M5语义校验通过；没有新导入或合成状态冒充本组通关。

当前production服务为本任务session82009、固定http://localhost:5174；子任务realtime独占CUA继续Safari自身原档的剩余路线，主任务维护文档与归档。无源码修改需求前不再重建dist。Agent-Model/Agent-Effort仍缺明确值，里程碑树和工作区均保留，未执行提交、推送或PR。性能失败、指定硬件及真实断外网必须按原合同补证后才能关闭Goal。

## Safari 后续正常路线与当前环境阻塞

B126记录Safari从自身234/6继续正常完成A主终端、B主终端、两一笔画、北南数据，最后实际导出为340、b.t.1.4、A/B各80、5奖励/21、5首次布局、成绩为空。三张实际结果图已由主任务查看，四份原文经M5语义校验通过；详细动作、中断及后续合法路线见[Safari生产续玩记录](safari-production-journey.md)。最后340尚未刷新验证，C/D/回访/仓库/计分仍未完成，不能用此前234刷新替代。

原生窗口工具先报ScreenCaptureKit -3811，后报noWindowsAvailable，12:48:45新鲜AX仍可读但游戏保持blur暂停。主任务交接期间没有UI操作；不能据此确定锁屏、窗口关闭或游戏缺陷。已询问是否有可用解锁前台环境，停止盲点和状态绕过。Agent-Model/Agent-Effort、指定设备、真实断外网条件也尚未获得；所有独立的正式包、资源审计、归档和文档工作继续收尾。

性能只读诊断确认acceptance折叠面板时仍逐帧序列化约7KB快照，production已剔除该路径；未测各段CPU耗时，也没有原始rAF间隔序列，不能归因为17ms或擅自平滑/调整阈值。候选排查方法已记入[性能记录](performance.md)，未对成品作未经复验的优化。Nowledge Mem已保存稳定工程选择与恢复路由，最新验收状态仍以本文件和总表为准。

主任务单次重新读取AX、Raise、点击继续和Up后仍失焦；再次通过真实菜单导出，确认340/21、B1,4和完整载荷与子任务末态相同，见[最后状态校验](evidence/m5-production-safari-final-state-validation.json)。Safari保留暂停菜单，Chrome正式包全收集947/130和内嵌170/26未再修改。当前只能在环境恢复后继续依赖UI的验证，不能用AX可读推定窗口能接受游戏输入。

## 本地恢复检查点与最后检查

M1–M4已验证的阶段树和13:03冻结的M5候选树通过本地 `refs/codex/full-implementation/checkpoints/` 引用保留，具体OID与备用index位置记录在仅本地的 `test-results/milestones/checkpoints.json`。M5候选检查点不是M5验收完成，也不是Git提交；真实index和任务分支HEAD保持原样，后续明确溯源字段后按各阶段选定树继续已授权的正常提交流程。静态ZIP、工程日志及实际证据已经存入项目交付目录；检查点元数据不包含账号凭据。

## 自动续回合：阻塞条件复核

上一Goal回合属于实际进展：完成生产包、归档、检查点和Safari正常A/B续玩。本次先以备用index核对M5候选树，所有已选文件与工作区相同，ZIP的SHA-256也一致；没有重跑源码未变的405项或重新build。

Safari新鲜AX仍显示blur暂停，Raise/继续/Up后未恢复游戏。通过已观察到的原生ReloadButton实际刷新，400ms和再过1000ms两次AX均为“正在读取进度／正在获取当前浏览器的单写会话”，见[本次原始记录](evidence/m5-production-safari-blocked-refresh.json)。没有进入继续或完成导出，本次340恢复仍未验证；末个可信导出仍是B1,4／340／21。当前页面处于上述启动状态，后续恢复应先取得可用前台窗口、核对实际启动结果，再继续，不沿用之前的暂停菜单索引。

Agent-Model/Agent-Effort、指定设备和真实断外网条件仍无新输入。本次未取得新的验收通过；同一阻塞条件自上一回合结束后持续，本次为第二次Goal回合复核，尚不满足三回合blocked阈值，Goal保持active。具体审计元数据位于仅本地的test-results/goal-blocked-audit.json。

## 第三回合复核：Goal 已标记 blocked

上一回合未取得新的验收通过；本回合复核备用index，仅有上回合追加的两份文档变化，生产源码和基线HEAD仍保持，提交所需Agent-Model/Agent-Effort及指定环境无新输入。Safari单写会话在本回合的新鲜AX中终于就绪，实际点击继续后读取到B区21单位；正常经菜单导出，generation340和完整载荷与此前保存逐项一致，见[延迟恢复记录](evidence/m5-production-safari-delayed-reload.json)及[载荷复核](evidence/m5-production-safari-delayed-reload-validation.json)。这补证了刷新后的数据读取；场景连接与可玩恢复没有完成，后续Raise/继续/Up仍回到blur暂停，不能填写Safari全流程或加载预算通过。

本任务原preview会话82009已直接轮询确认仍运行；当前production JS通过同源HTTP实际返回200、916070字节并与磁盘相同。没有因短时观测就重启浏览器/服务，也没有夺锁或写入合成状态。最后可信导出仍为340、b.t.1.4、21单位；当前界面是失焦暂停，恢复时先读取新鲜UI。

同一组实质条件连续三个Goal回合存在，且现有环境已无可完成剩余验收的独立动作，已实际调用update_goal将状态设为blocked。等待可操作的Safari前台、合同指定硬件/浏览器与真实断外网条件，以及本次提交的精确Agent-Model/Agent-Effort。M5与63项验收保持未全量通过，分支未提交/推送/建PR；可运行候选包、原始证据和本地检查点全部保留。用户恢复后以实际代码和本记录继续，重新开始阻塞复核，不继承本次计数。

## 用户恢复：Chrome 范围与正式里程碑提交

用户明确“gpt-6-astra max，不验证 safari 了，验证 chrome 即可”。仅取消非 Chrome 浏览器的必需验收，保留历史结果；设备范围另行确认，真实断外网要求尚未取消。提交字段来自本次用户覆盖，不作为未来任务默认值。

M1 `3c1c30c`、M2 `726317b`、M3 `4068fb9`、M4 `dcc6307` 已按先前冻结阶段树顺序创建普通提交。每次核对分支、父提交、tree、完整消息、作者/提交者与唯一溯源 trailers；作者和提交者均为 `eruoos <github@eruoo.me>`，仅进程覆盖。备用 index 提交后将主 index 对齐该提交，没有覆盖当前 M5 文件。原字体许可证与原构建日志的行尾空格保留原字节；源码差异检查通过。完整 OID 和消息见[提交回读](evidence/milestone-commits.json)。

Chrome 新任务标签已正常继续至仓库 130/130。发布只读复核发现：BFCache 返回而另一标签持锁时，旧内存仍存在，busy 的导出入口可能把旧载荷标以新磁盘代数并进入有继续按钮的存档菜单。写盘仍由 isWriter 拒绝；正在修复导出与无会话操作入口，并补对应回归。这是新发现的具体问题，后续完整测试/构建必须晚于修复。

### 本轮代码、字体和构建验证

LoadedProgressAccess 明确区分旧内存副本与已在当前会话激活的进度：acquire/pagehide 后冻结副本，重新持锁仍须继续最新槽；无锁且未明确临时游玩时，输入、命令、自动走和手动保存都不能推进副本。实际A/B原文与旧内存分别导出，旧内存沿用原代数并标明来源。

完整[411项原生测试](evidence/m5-chrome-release-native-tests.log)通过，0失败/取消/跳过/todo，2711.108416ms。首轮[只读构建](evidence/m5-chrome-release-build-font-missing.log)发现“副”“它”缺字退出1；显式按固定Noto源和既有配方补字后，45个运行源文件的802字符全部覆盖，中文WOFF2为182592B。[重建](evidence/m5-chrome-release-build.log)退出0，生产主JS `index-BpL7y5kK.js` 917896B，固定5174实际200且字节匹配。旧ZIP/指纹保留历史，正在重新审计并归档新包。独立[acceptance观察构建](evidence/m5-chrome-observation-build.log)仅输出test-results目录，与生产使用同一冻结源码。

## Chrome 修复后生产回归与新包

真实 Chrome 第二标签导出原始 A947 / B946 后均返回 busy。关闭原持锁页后重试，继续就绪 320ms，390ms 内真实 Left 到仓库6,0并保存948；Right回949，刷新继续315ms，完整导出相同。正常 about:blank 离开、另页移动保存950、Back 后的旧页仍只读；新原槽950与旧内存949分别导出且标明来源，两次返回均无继续入口。未注入事件或游戏状态，未读取生产不存在的 persisted 标志。生产回归末态为仓库7,0 / generation951，26奖励 / 130物资、48目标 / 9布局 / 9成绩保留；九份实际原文均经当前M5语义校验。

新生产包逐文件审计和归档由独立子任务完成，84文件 / 1674897B，ZIP845629B、SHA-256 `62b119813a7d3269a95f30f4894e3f4efb5996ccabd054d5fe9acf7d1a888175`；85/85同源HTTP的Content-Type与字节匹配。45资源的78内容与2许可哈希匹配；14类生产诊断/故障/HMR标记均不在包中。原资源与旧证据未改写；这仍不是实际断外网证据。

## Chrome 本机最终性能补证

B130世界六步104.7–110.4ms、密集六步104.4–110.9ms；逐步代数增加、玩家结束且displayedFocus已到目标后记录。B131两档64格独立练习各60次真实输入，末7200帧窗口60220.8/60228.8ms，中位8.3ms、p959.3ms，输入p9515.8/16.6ms；全组永久目标、奖励、成绩、首次布局和数据不变。由主任务直接解析原始JSON核对窗口、每步、代数、undo、预算和字段相等，不重复游戏操作。

采样是含只读观察开销的同源码acceptance包，生产继续320ms/真实移动390ms、刷新315ms来自production。正常退出练习、恢复默认标准设置、经区域图与逐格回仓库1109/130后，已恢复固定5174 production（当前任务进程session2083）。原Chrome30往返稳定记录仍适用；设备未确认调整、真实外网未断开，两项继续标未验证。

## M5 本地实现候选提交准备

B132正式包最终正常刷新 / 继续、重复F访问仓库、导出后回游戏，1109代、仓库7,0、26/130、默认设置保持；当前真实载荷校验通过。63项仍为61通过，M5阶段验收未完成。原生Chrome AX的一次新检查已成功，随后继续尝试浏览器内外部请求隔离；此前未执行断网的记录不改写，结果另行追加。

本次准备将M4之后的全部已验证M5实现、美术、测试、文档和候选静态包作本地提交。使用本Goal用户指定gpt-6-astra/max，author/committer均eruoos <github@eruoo.me>；保留原始许可与证据，不包含ignored测试临时目录。原指定设备与真实断外网继续明确未验证，最终推送/PR仍按用户完成后交付的要求处理。

## M5 实现候选已本地提交

已完成本地提交 `811da5a1eb6ac175aa380418c2d84cf079469713`，标题 `feat(m5): refine presentation and recover browser sessions`。父提交为M4的 `dcc6307326d8aef80e8204ea348769fa8afe07f6`，树 `417b5066cbd4d12dad443691da10c6a6f175b77f`；394个本Goal变化包含325份证据。普通git commit成功，逐项回读树、父提交、完整消息、author/committer及唯一gpt-6-astra/max trailer均匹配。未禁用hooks/signing，未改持久Git身份。源码/文档diff通过，5处原始构建/命令日志空白保留原样。

本次提交对应411/411、生产build、102文件格式检查、63合同ID及B01–B132/E01–E32连续性、1218处本地引用核对；47个源码/锁文件/清单哈希与已测生产构建一致。正在进行的m5-chrome-offline-*另作后续验收证据，不纳入此候选。原生窗口恢复后已继续尝试浏览器请求隔离，尚未建立有效断网结论；原指定设备范围仍待用户答复。M5阶段验收与Goal均未完成，没有推送或创建PR。

## Chrome 请求隔离未建立与恢复待办

B133保留一次有界尝试：DevTools初始无规则且阻断关闭；example.com对照200，example.org页面可见但无其响应状态。两次Add后未立即显示表单，稍后出现默认 `*://*` / Block、0 affected，未配置localhost例外，未证明外部请求阻断。原因只作推断；所选原生页面后来与目标不一致，不将其直接归因为用户行为或游戏问题。

停止原生操作后，以owned tab.close关闭任务540页及DevTools，库存确认该ID不存在；未操作其他页面、没有游戏命令、没有改存档。Keep log已回0；device/cache未改；默认规则删除与Network过滤恢复未验证。完整全窗原文只存ignored test-results，交付5份任务范围摘录与[实际方法](offline-build-audit.md#9-chrome-请求隔离尝试未建立任务标签已关闭)。下一次可安全取得窗口后先清理这条本轮出现的规则、恢复原过滤文字，再执行真正的离线验证。

目前所有独立工作已完成并保留，本轮继续条件需要用户提供设备范围决定和可稳定操作的Chrome窗口；没有推送、创建PR或把M5/Goal标完成。当前代码/资源与已验证production构建保持一致，不为等待环境重跑411项或重建。

## 本机基准与发布范围收口（2026-09-11）

用户接受本机 Chrome 预算通过即可算 V05 通过，其他机器出现实际问题后再修复；本轮按联网运行可交付，V06 取消发布门槛。同步新增[范围调整记录](acceptance-scope-2026-09-11.md)，修改主规格、工程与验收合同的当前范围，并同步 README、索引、验收、性能、浏览器、离线与交付说明。保留全部 63 ID、原性能数值、原始测试与截图、隔离失败及未测环境；结果为 62 通过 / 1 不再要求，不是 63 项均已实测通过。

本轮有界 DevTools 清理尝试受原生截屏错误阻止，未打开 DevTools 或修改新设置。只关闭本任务自己的临时页，保留 1109 代进度；留下具体人工清理步骤，工具限制不改游戏验收结果。此前等待设备与离线的 blocked 状态已不再是本轮条件，继续已授权的发布和 PR。

发布前只读核对已通过：全仓格式检查 103 文件；63 个合同 ID / 顺序、62 通过与 V06 不再要求；历史 B/E 表行内容保持；链接、跨文件锚点、ZIP CRC / 字节 / 哈希、47 个冻结输入和当前 5174 根页 / 主 JS 一致。首次链接检查的一个旧锚点已修正，详情见[收口证据](evidence/m5-final-scope-verification.json)。没有重跑游戏测试或重建。

## 最终分支与 PR 交付（2026-09-11）

验收范围收口提交 `005239b1621e1790f7e64d63a8945c4e13af37e4` 经树、父提交、完整消息、作者 / 提交者与溯源字段回读一致后，以 eruoos 的进程级凭据推送到原本不存在的 `refs/heads/codex/full-implementation`，使用明确的“远端仍不存在”条件。LoTwT 读取远端确认该 OID，main 保持 `bfb924b075aa6a153ed33b95ce4492260e18a8d9`。没有发布额外分支或标签、没有修改持久身份。

随后由 eruoos 创建 [PR #1](https://github.com/LoTwT/camellia-golden-week/pull/1)，LoTwT 回查作者、同仓来源、main 目标、head、open / 非 draft 和完整正文匹配。首次发布与创建快照见[Git 交付证据](evidence/git-publication.json)；本段及文档链接作为同一 PR 的文档补交，游戏源码和已验证静态包保持不变。M1–M5 当前约定范围的实现、63 项映射（62 通过 / V06 不再要求）、测试、美术、来源、运行说明、静态归档与审阅入口均已交付；下一步由用户审阅 PR，不执行合并。

## 用户追加：npm 迁移至 pnpm（2026-09-11）

用户要求将项目中的 npm 改为 pnpm。采用本机现有且兼容 Node 24.18.0 的 pnpm 11.25.0；通过 pnpm import 导入 112 个已锁依赖，版本与 integrity 逐项相同，未升级游戏依赖。packageManager / engines、构建中的嵌套命令、安装设置和当前文档入口一起迁移；历史 npm 证据保留。干净冻结安装、lint / 格式 / 类型 / 内容、411 项测试与 production build 均通过；161 个构建输入未被改写，84 个产物与原 ZIP 字节相同。pnpm dev / preview 启动、85 次生产 HTTP 与端口占用报错已核对，固定 5174 恢复 production。结果与日志由[pnpm 迁移记录](pnpm-migration.md)维护；此追加变更沿用同一实现分支和 PR，游戏验收范围不变。

## 消融 Review 后的授权修复（2026-09-11，执行过程）

用户已明确“按你分析修复”，从干净的 `e70fc7d` / `codex/full-implementation` 开始修复汇总中的四项运行时缺陷，并补齐内容、测试发现、构建 profile、架构和真实 Chrome 回归。推进条件、26 个奖励 / 130 单位账本、M4/M5 共用内容、Chrome 本机验收范围与 V06 不再要求保持不变；现有存档证据 JSON 与手动夹具生成器保留。

存档新增八项反例先在原实现实跑，六项失败（含三种极大修订号、非法画质数组、两种深层坏档比较），修复后连同原存档用例 55/55 通过。修复采用迭代 JSON 值比较，保留同代不同载荷冲突和原始导出；画质必须是真实字符串枚举。恢复时仅将 `stateRevision >= 2 ** 52` 的外部计数重置为 0，为后续事务保留至少半个安全整数空间，普通修订号、实际进度与本地单调 `saveGeneration` 不变。音频启用和主界面回调均由最后一次请求控制，禁用 / 销毁使旧请求失效，两个原始竞态反例已红转绿。

当前正在集成 Chrome 的真实导入、恢复、音频故障顺序，以及自动行走、迷宫失败后持续输入清除、防火墙节拍的回归脚本。内容校验与测试管线由独立子任务并行处理；阶段日志暂存 ignored `test-results/review-fixes/`，最终检查、消融复验、文档与静态包将在本轮结束前统一归档。原固定 5174 服务和用户浏览器进度尚未操作，测试使用独立浏览器 context 和服务。此段记录进行中的状态，不把历史验收证据当成本轮修复后复验。

## 消融 Review 修复完成与复验（2026-09-11）

四项运行时缺陷已修复，两个无调用导出已删除；递归测试发现、原始内容与必需见证、分期产物、核心边界、投影 / 输入语义及main实际接线均有回归。原先八处可逃过测试的删除现已分别通过独立消融确认被检出，另验证空入口和六项语义变异。M1–M5装配结果与起点深度相同，地图 / 奖励和推进合同未改。

新增源码字符触发字体只读检查失败，随后沿用固定源OTF及配方显式补齐六字，全部808字符经实际解码覆盖。最终干净冻结安装与 `pnpm run verify` 通过：458项原生测试、五个分期的正常Chrome键鼠 / 保存恢复、七项存档 / 音频 / 接线回归；182个输入文件验证前后哈希一致。新ZIP的84个文件与实际dist及Chrome验证production字节相同；原5174服务未重启，85次HTTP核对通过，未操作用户浏览器存档。

实现选择、失败到通过的日志、消融矩阵、截图、逐文件归档和验证边界统一维护于[修复记录](review-fixes.md)。原63项验收与性能数据保留历史含义，没有把本轮短流程当成重新全收集、Safari或断网验证。沿用原实现分支及[PR #1](https://github.com/LoTwT/camellia-golden-week/pull/1)交付，下一步由用户审阅，不执行合并。

## 玩家体验反馈：防火墙拍点可读性（2026-09-11）

用户反馈“终端挑战，防火墙，没看到拍点”。在 `3a5d84f` 上实际新档正常进入教学，35帧采样确认只有COMBO框边色变化，没有独立拍点或方向说明。新增左侧节拍条与“等待拍点 / 现在移动 / 本拍命中”，派生自固定内容和有效时钟；暂停、准备倒数、结算、减少动态和离开挑战都有对应处理，核心规则与存档不变。

五项新增测试以真实评分校对四档边界。Chrome正常模式1512×771与静音 / 减少闪烁 / 减少动态1024×640均只看视觉提示完成14次有效输入并自然通过教学；暂停恢复和退出隐藏通过。统一verify为463项测试、五个profile、原七项回归和两种拍点体验全部通过，185个输入哈希不变。当前5174已服务新包，85次HTTP、ZIP字节 / CRC与Chrome构建一致；用户现有页面和进度未刷新或操作。完整证据与维护位置见[拍点修复](firewall-visual-cue.md)，沿用当前实现分支和PR，下一步为用户刷新后体验。
