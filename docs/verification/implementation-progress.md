# 全量实施进度

[文档索引](../index.md) · [验收合同](../spec/acceptance.md)

## 当前状态

2026-09-11：用户已批准文档基线并授权 M1–M5 连续实施、依赖安装、资源处理、验证、里程碑提交、最终推送和 PR。历史文档的“本轮仅文档”保留其历史含义，不限制本 Goal。

- Goal 已由 `/goal` 建立且 active；M1可运行阶段验收完成，M2实施中，不声称全量验收通过。
- 本地及远端 main 均为 `bfb924b075aa6a153ed33b95ce4492260e18a8d9`；开工工作区干净，无后续提交或其他 worktree。
- 已从该基线建立 `codex/full-implementation`，保留 `codex/docs-baseline`。
- 已读取全部七份规格 / 来源入口和历史核对记录，并查询 Nowledge 交叉核对基线决策。

## 当前任务 / 下一步

M1：工程、规则与内容接口；中心 / A 的可交互代表画面先校准；随后完成三个迷宫、四档防火墙、26 物资、存档和浏览器新档 / 恢复。

01:58（Asia/Shanghai）更新：工程、固定中心/A地图、纯TS世界与局部规则、Three.js代表渲染、DOM界面/输入、音频、双槽/单写会话已接入。浏览器通过正常键盘完成中心教学、进入A、完成迷宫01、领取物资和激活A主终端（A完整数据20/100，物资6/26，没有迷宫02/03或防火墙）；教学后及迷宫活动态中途刷新均从准确位置恢复。M1全收集与工程完整门禁尚未验完，不能标M1完成。

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
- M2–M5 尚未开始阶段验收；不得因阶段完成或缺少设备把总 Goal 标 complete。

## M1阶段验收（02:21）

中心/A正常新档全收集26/26，A首访80/80、完整80/100；刷新保持位置与奖励；静态preview的新档结算、导入真实文件后再刷新通过。Node原生测试152/152，lint、format:check、typecheck、validate:content、build、固定5174 preview通过。控制台error列表为空。

真实升级样本：[M1浏览器导出](evidence/m1-browser-save.json)。[全收集快照](evidence/m1-full-collection.json)、[刷新](evidence/m1-full-restored.json)、[成品结算](evidence/m1-preview-scope-complete.png)、[成品导入恢复](evidence/m1-preview-import-restored.png)。防火墙教学30，核心/深层/内层90；核心先领取时其余正式档未完成。

M1提交仍缺精确溯源字段，阶段源码与dist冻结于test-results/milestones/M1，继续M2的B地图、两个一笔画、杀毒、51物资及真实升级验证。JS约789KB（gzip185KB）有Vite体积提示，列M5优化；中文字体6.1MB本地加载。内嵌浏览器下载事件未确认，实际导出文本已保存，文件选择导入已通过；Chrome下载待实测。

## 恢复规则

上下文切换后先读取本记录、`git status` 与当前源码 / 测试，核对子 agent 结果；继续未完成工作，不重置已有状态。每阶段更新本页并链接实际证据、版本和提交。
