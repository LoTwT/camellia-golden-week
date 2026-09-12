# 防火墙警报修复与 v3 迁移

[文档索引](../index.md) · [原规则证据 S12](../references/firewall-hazards.md) · [玩法合同](../spec/gameplay.md#62-突破防火墙) · [操作与存档](../../README.md)

2026-09-12，用户要求继续查询原版危险格规则，确认后直接修改。修复基线为 `210a53e852dfbb0531cc54a592f995383d0583f3`。原版两段录像分别显示普通错拍 50→49 和警报受击 52→47，手册第三页说明按拍迎向警报来向可以闪避；定位、截图校验值和不确定项由 S12 维护。

## 根因与改动

v2 的危险检查只在错拍分支执行：普通错拍扣 5、错拍红格清零，任何踩拍移动都直接加分。警报替换格子时没有独立接触判定，驻留玩家也不受影响。这是本版旧实现，与本次确认的原规则不符。

当前规则 v3 把警报建模为有稳定 ID、来向、逐帧占格和生灭时间的对象。普通错拍扣 1；没有有效闪避的警报接触扣 5，最低为零；最高 Combo、已完成目标与已领取物资保留。时间推进与输入都经过同一接触判定，碰撞不再依赖是否刚好提交错拍命令。迎向来向的有效踩拍提供有限保护，同拍不能反复计分或延长保护。精确窗口、同刻优先级及连续接触去重属于明确记录的重建选择，具体参数由玩法合同维护。

警报格增加方向标记，四块 COMBO 电视显示真实连击与独立受击 / 闪避状态；受击复用本地 `failure.wav`，闪避复用 `reveal.wav`，不会与同次计分提示叠播。短暂红晕在减少闪烁时关闭，扣分文字保留。提示按最新事件更新，避免旧受击文字遮住下一次踩拍反馈。暂停、失焦、恢复倒数和结算收起活动反馈。

教学前 12 拍无警报，随后出现一条来自右侧的列波。固定正式关卡保留 15 / 45 秒、27 / 82 拍及 12 / 40 / 55 / 70 门槛；当前成功见证包含教学 1 次、正式三档 10 / 13 / 20 次实际方向闪避。地图与逐拍命令见[固定实时内容](../references/maps/realtime.md)。

收尾核对还发现当前实时 JSON 的顶层规则标记仍写 v2，而内部定义和见证已是 v3。已纠正该标记，并在装配前核对源元数据、定义、见证与目标发布版本；三项失败 / 通过回归防止装配时忽略不一致。顶层 contentVersion=2 表示 M1 起始内容版本，M5 导出载荷的 contentVersion=5 仍从 profile 装配结果取得。

## 存档兼容

schema 仍为 2，M1–M5 的 contentVersion 仍为 2 / 3 / 4 / 5 / 5，ruleVersion 提升至 3。v1 与 v2 定义、世界见证分别冻结，旧成绩依据原版本校验，不套用当前上限或新碰撞规则。

迁移路径是旧 v1 同 profile → v2 同 profile → v3 同 profile → 后续 v3 profile。旧最好成绩按原 ruleVersion 归档，奖励、数据、主线目标、首次静态完成布局及安全位置保留。实时尝试恢复到安全准备态重新开始；新警报接触集合与短暂闪避状态不写入存档。新写入前继续使用双槽旧档保护与失败恢复。

为证明实际 v2 成绩兼容，另从已冻结的 v2 ZIP 启动独立 Chrome，新游戏经正常键盘到教学，取得 14 Combo 并自然结算，再通过 UI 导出。原始[存档](evidence/firewall-hazards/legacy-v2/legacy-v2-earned-save.json)、[14 次输入与结果](evidence/firewall-hazards/legacy-v2/legacy-v2-earned-results.json)、[旧包校验](evidence/firewall-hazards/legacy-v2/archive-verification.json)和[结算截图](evidence/firewall-hazards/legacy-v2/legacy-v2-tutorial-completed.png)一并保留。没有修改存档版本或成绩制造旧档；完整 trace 保留在 ignored `test-results`，其位置与校验值见[追踪记录](evidence/firewall-hazards/legacy-v2/trace-record.json)。

## 验证与交付

最终完整检查于 2026-09-12 13:47–13:53（Asia/Shanghai）完成。Node 24.18.0 / pnpm 11.25.0，`pnpm run verify` 退出 0：**39 个原生测试文件 / 510 项通过**，零失败、取消、跳过和 todo。lint、格式、类型、核心架构、内容、必需见证、只读构建和产物检查均通过；五个 profile 的 Chrome 正常操作、七项既有故障回归、防火墙三场景与两类旧档迁移全部通过。

[完整日志](evidence/firewall-hazards/verify.log) · [源哈希与只读证明](evidence/firewall-hazards/verification.json) · [完整 Chrome 结果](evidence/firewall-hazards/browser-results.json)。检查纳入 547 个实现、测试、脚本、构建配置、资源及被测试消费的历史证据输入，前后 SHA-256 完全相同。[冻结安装](evidence/firewall-hazards/install.log)使用既有 node_modules，锁文件未修改；不称作重新干净安装。

| 覆盖                      | 实际结果                                                                                                                                                | 实现与证据                                                                                                                                                                                                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T01–T04 / T07 / T13       | 精确端点、警报驻留 / 移动 / 对穿、方向和保护过期、同刻优先级、连续接触及重入去重；30/60/120fps、分段与批处理终态一致；四档成功和失败                    | [v3 规则测试](../../tests/firewall-v3.test.ts)、[完整日志](evidence/firewall-hazards/verify.log)                                                                                                                                                                                                                 |
| G / 账本                  | 当前十条世界见证全部重放，M1/M2/M3/M4/M5全收集26/51/81/130/130；无计分主线见证正常开仓库                                                                | [当前世界见证](../../src/content/witnesses/current.ts)、[完整日志](evidence/firewall-hazards/verify.log)；是规则重放，不冒充本次新档浏览器全收集                                                                                                                                                                 |
| T02 / T03 / T08 / V01–V04 | production 1512×771普通声音和1024×640静音 / 减少效果均正常操作：错拍5→4、驻留6→1、持续接触和暂停不续扣、迎向DODGE 1→2；教学成功、暂停恢复、退出隐藏     | [逐拍与碰撞原始结果](evidence/firewall-hazards/firewall-cue-results.json)、[受击](evidence/firewall-hazards/firewall-cue-standard-hazard-hit.png)、[闪避](evidence/firewall-hazards/firewall-cue-standard-toward-alarm-dodge.png)、[减少效果受击](evidence/firewall-hazards/firewall-cue-reduced-hazard-hit.png) |
| T04 / V04                 | 同一验收新档正常方向键完成正式47/57/72 Combo，均到45秒自然结算；配乐循环、停止 / 恢复、导出刷新一致。只读观察没有写入位置、分数、目标或门               | [原始结果](evidence/firewall-hazards/firewall-cue-results.json)、[核心画面](evidence/firewall-hazards/firewall-music-levels-core.png)、[核心结算](evidence/firewall-hazards/firewall-music-levels-core-completed.png)                                                                                            |
| P07–P09                   | v1完整旧档 content4/rule1→content5/rule3，26奖励/130物资和9条旧成绩保留；真实v2教程14迁移后，再以正常键盘取得v3教程18，两版本成绩并存，导出刷新完全一致 | [迁移结果](evidence/firewall-hazards/firewall-migrations-results.json)、[旧档预览](evidence/firewall-hazards/v1-full-collection-migration-preview.png)、[两版本实际导出](evidence/firewall-hazards/v2-earned-result-coexisting-save.json)                                                                        |

本机 Chrome 153.0.8010.36 / headless / 1920×1080 / DPR1 / 标准画质，正式三档各约42.23秒采样。帧间隔中位均约16.7ms，p95为 **16.7 / 16.7 / 16.7ms**；输入反馈p95为 **26.6 / 27.9 / 28.0ms**，所有按键反馈样本≤33.8ms，达到原预算。四块侧屏退出后释放；完整帧数组、资源计数、条件与范围见[性能摘要](evidence/firewall-hazards/performance-summary.json)。正式档使用带可见只读诊断的 acceptance 包，普通与减少效果教学为 production；本专项不替代 V05 原60秒最密地图及30次往返实测。

### 失败保留与测试修正

普通错拍−1断言曾在实际冻结v2规则上失败，在v3上通过：[同一断言与复现方法](evidence/firewall-hazards/penalty-red-green.json)。另保留[旧受击覆盖新反馈](evidence/firewall-hazards/feedback-order-red.log)、[受击后误提示本拍可输入](evidence/firewall-hazards/consumed-beat-cue-red.log)和[源版本不一致](evidence/firewall-hazards/source-version-red.log)的失败；对应回归已进入510项套件。

浏览器脚本修正了导出页面返回层级、`display:none`实际不可见但opacity仍非零，以及把M1源contentVersion误当M5载荷版本的三处断言假设；[首次导航失败](evidence/firewall-hazards/script-debug-export-navigation/retained-files.json)、[隐藏效果失败](evidence/firewall-hazards/script-debug-hidden-impact/retained-files.json)、[迁移版本失败](evidence/firewall-hazards/script-debug-migration-profile-version/retained-files.json)保留原文，没有据此修改游戏数据或降低预算。

首次完整Chrome运行在第一个移动前，截图耗时479.242ms，触发250ms调度中断保护；旧脚本随后误将暂停画面视为稳定棋盘。[失败、时间线与定向结果](evidence/firewall-hazards/script-debug-profile-start/targeted-verification.json)保留证据。当前仅允许在首个移动前的准备阶段对可见clockGap正常继续一次，丢弃旧样本并重新取样；其它原因、反复中断与运行中的暂停直接失败。最终五profile共记录0次该恢复，正式三档准备期共0次；没有把未触发的分支称作实测。调度中断规则保持超过250ms暂停。

### 静态包与复现

当前[静态ZIP](evidence/firewall-hazards/firewall-hazards-dist.zip)为 **5,002,112字节**，SHA-256 `482f4bba7b8ac33fdcf9dd4dc57cadb88beece79d18256f01afba1308d2531e6`。87个文件 / 6,374,035字节，48条资源记录；CRC、每个文件哈希、当前dist与Chrome验证production构建一致，[逐项清单](evidence/firewall-hazards/package.json)可复核。固定5174根入口及全部文件共88次HTTP均200且字节相同，见[HTTP审计](evidence/firewall-hazards/http-audit.json)。Vite主JS超过650kB提示仍如实保留。

字体沿用固定源和配方显式补齐：186432字节 / 1444字形 / 1135 cmap，57个源码输入的828字符全部实际解码覆盖，见[字体复核](evidence/firewall-hazards/font-verification.json)。没有把生成器接入只读构建。

复现命令为 `pnpm install --frozen-lockfile`、`pnpm run verify`、`pnpm run preview --host localhost --port 5174 --strictPort`。完整浏览器管线在独立端口与context中运行；旧v2真实成绩制备入口为[scripts/browser/legacy-firewall-save.ts](../../scripts/browser/legacy-firewall-save.ts)。在完成verify并启动固定preview后，运行[归档配方](evidence/firewall-hazards/reproduce-package.py)核对ZIP和HTTP。体验入口为 [localhost:5174](http://localhost:5174)，实现与审阅入口由[交付记录](release-candidate.md)维护。

## 保留的差异

原版精确判定窗、保护时长、连续接触重复间隔、多警报合并和碰撞 / 错拍叠加规则尚未测得。原视频没有输入叠层，不能仅凭玩家动画位置断言零输入碰撞发生时刻。本版时间驱动接触是对手册移动警报语义的实现解释。

原版核心录像显示约 70 秒与 60 Combo 目标；本次保留既有时长和门槛，未调整主路径或奖励账本。警报排表、替代音乐、图标、字体与像素外观仍有记录在案的差异；本修复不宣称已达到原版逐帧一致。Chrome 之外的设备、Safari 与断网全流程依用户已批准范围处理，历史证据不改写。
