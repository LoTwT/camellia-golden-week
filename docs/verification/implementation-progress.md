# 全量实施进度

[文档索引](../index.md) · [验收合同](../spec/acceptance.md)

## 当前状态

2026-09-11：用户已批准文档基线并授权 M1–M5 连续实施、依赖安装、资源处理、验证、里程碑提交、最终推送和 PR。历史文档的“本轮仅文档”保留其历史含义，不限制本 Goal。

- Goal 已由 `/goal` 建立且 active；M1 / M2 / M3 可运行阶段验收完成，进入 M4 集成，不声称全量验收通过。
- 本地及远端 main 均为 `bfb924b075aa6a153ed33b95ce4492260e18a8d9`；开工工作区干净，无后续提交或其他 worktree。
- 已从该基线建立 `codex/full-implementation`，保留 `codex/docs-baseline`。
- 已读取全部七份规格 / 来源入口和历史核对记录，并查询 Nowledge 交叉核对基线决策。

## 当前任务 / 下一步

M4：接入 D、A/B 回访与仓库固定地图，验证四权限顺序、全部数据门禁、130 物资与自由回访。M3 生产构建和实际存档已保留。

02:27（Asia/Shanghai）更新：M1阶段检查见下方追加记录。源码已用备用Git index冻结为tree `7bb7a2622333ad0859f40b4e228ad4a780fdc3f2`，没有修改用户主index，也没有创建提交。B区44格/5房已接入；M2世界共3区105格12房160本版数据，引用闭合通过。主agent继续界面/渲染/浏览器，static_puzzles完成B公开命令见证，realtime完善显式版本迁移注册与故障测试；验收映射63项已落盘。

独立分工：主 agent 负责工程、世界规则、渲染 / UI、输入、存档及集成验证；static_puzzles 负责静态规则和固定局部棋盘；realtime 负责有效时钟及实时规则；art_reference 负责素材辨认、来源与本地补制资源。共享工作区，文件职责隔离，子 agent 不做 Git 提交。

## 已决定的维护边界

- Vite + TypeScript + Three.js；界面采用原生 DOM/CSS；没有第二份 UI 游戏状态，无需 Vue / Pinia / Router / Tailwind。
- Node `24.18.0`、npm `11.16.0` 为实际运行环境；安装前通过 npm 官方注册表与工具官方文档核对 engines，使用精确版本和锁文件。
- 本轮选择 Vite `8.3.0`、TypeScript `7.0.2`、Three.js `0.185.0`（与 `@types/three 0.185.4` 对齐）、Oxlint `1.82.0`、Oxfmt `0.67.0`。
- 规则层独立纯 TypeScript；JSON 为固定内容来源；本版 profile 与 full data 单独派生；不改主推进 / 奖励账本 / 验收标准。
- 视觉以深黑空间、厚壳电视、亮屏功能图标为中心；黄色标识当前操作；镜头跟随、显露、机关反馈为三类短动画，可减少动态 / 闪烁。
- 未证实的坐标 / 图案明确标重建；无法确认可发布使用条件的原资产不冒充“已授权采用”。
- 构建期虚拟内容模块按profile裁剪执行内容；未来入口仅保留“本版本未收录”展示，不保留可执行目的地。M1–M5阶段全量目录先保留稳定ID，尚未实现的世界profile不冒充校验通过。
- 双槽envelope附可选 `supersededCorruptSlot:{id,sha256}`：用户明确替换/恢复后，记录仍被保留的损坏原槽摘要，防止下次刷新把已经确认过的未知代数坏槽重新当新冲突。只匹配相同原文，不删除坏档，不修改玩法载荷；有Node原生SHA256对照测试。
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

## 未解决 / 未验证

- Agent-Model / Agent-Effort 精确运行字段不可得，已询问用户给出本 Goal 的提交溯源值；只阻挡 Git 提交，不阻挡实施。
- 当前尚未实现或执行 63 条 G / I / S / T / P / V 游戏验收；不将规格核对当作实际通过。
- Windows 与指定基准设备是否可用尚待核对；无实测列必须保持未验证。
- M4–M5 尚未完成阶段验收；不得因阶段完成或缺少设备把总 Goal 标 complete。

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

M3源码和production dist冻结于test-results/milestones/M3，提交仍等待精确溯源字段。D/回访/仓库预备文件不进入M3阶段树；其临时规则检查不视为M4正式验收。

## 恢复规则

上下文切换后先读取本记录、`git status` 与当前源码 / 测试，核对子 agent 结果；继续未完成工作，不重置已有状态。每阶段更新本页并链接实际证据、版本和提交。
