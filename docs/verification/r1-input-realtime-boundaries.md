# R1 输入与实时恢复浏览器补测

2026-09-12，Chrome 153.0.8010.36，M5/content6/rule4/schema3，1366×768。运行器 [r1-input-realtime-boundaries.ts](../../scripts/browser/r1-input-realtime-boundaries.ts) 导出 `verifyR1InputRealtimeBoundaries`。除鼠标首事务采用正常新游戏外，均经文件选择器正常导入 [本轮主线实际 earned-save](../../tests/fixtures/r1/m5-main-earned-save.json)，正常菜单传送、方向键走到终端、F交互进入。未注入位置、分数、完成状态或存档；离线模型只规划正常世界路径。

[汇总](r1-evidence-files.md#e-7433871a32987954) 包含8项实际通过文件。它汇总不同调试轮次的已通过记录，`reused`表示本次定向执行复用的前次实际结果，不声称8项在同一轮连续完成。精确139/140ms、同刻碰撞顺序仍由原生规则测试证明，本浏览器用人类量级时间窗口观察真实输入行为。

| 场景         | 实际方法与结果                                                                                                                                                                             | 证据                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| 两键按住     | 同时保持Right/Left，最新Left使玩家回到仓库0,0并保持；释放Left后仍按住的Right恢复移动；全释放后停止。永久状态不变。                                                                         | [two-held-keys](r1-evidence-files.md#e-3f45f33c91f547e3)               |
| 重复keydown  | 真实浏览器收到Right的false/true/true三次keydown，随后keyup；只移到1,0，保存代数2→3，只有一次实际输入反馈。                                                                                 | [repeated-keydown](r1-evidence-files.md#e-b299fe53c3ccf3d4)            |
| 等待方向覆盖 | 快速Right/Up/Left，Up在第一步目标处合法，却被最新Left覆盖；轨迹2,0→1,0，没有进入2,-1，800ms不爆发；保存代数3→5。                                                                           | [pending-direction-overwrite](r1-evidence-files.md#e-739f6d013ebc6886) |
| 单鼠标事务   | 新游戏一次真实鼠标手势同时产生pointerdown+click，只到增幅仪格一次；hub.amplifier只完成一次、保存代数1→2，只有一次输入反馈。                                                                | [single-pointer-transaction](r1-evidence-files.md#e-97d2d1df08e2570b)  |
| D01碰撞重试  | 正常方向键走进巡逻环，等待实际幽灵碰撞失败；正常“再挑战一次”及挑战选择，玩家入口、幽灵初始索引/下一步时间、未亮灯/未移除集合恢复。永久状态不变。                                           | [D01](r1-evidence-files.md#e-84b619b4caba6e8b)                         |
| D02碰撞重试  | 同上，以D02真实新地图执行。这里失败前没有点灯，不能冒称证明了“亮灯后再碰撞”的不可达状态；精确灯优先规则另由原生测试覆盖。                                                                  | [D02](r1-evidence-files.md#e-d97ccdda653f037b)                         |
| D02按住失焦  | Down到2,0仍按住，真实切到另一标签30秒；有效时间20.700ms及全部实时状态冻结。返回正常点击继续，读到2996ms准备倒数，900ms后2087ms且有效时间未增。恢复后800ms仍在2,0；keyup后重新Down才到2,1。 | [真实失焦](r1-evidence-files.md#e-c8da85e0e2f905fe)                    |
| B键鼠互换    | 正常轻度场景用两次Left和F清除首目标，分数1；随后鼠标清第二目标到分数2，画布焦点保留，规则4、无暂停。只补实际键盘→鼠标，不重复声称三档全键盘通关。                                          | [B键鼠](r1-evidence-files.md#e-3e9ebbaf94054622)                       |

保存代数与实际轨迹是单事务判断的主要证据，`inputLatency.sampleCount`仅作呈现反馈辅助。两个输入、鼠标事务的代数增强断言已在第三轮实际复验通过。

## 真实焦点环境

其他7项采用传入的独立headless Chrome。失焦项单独启动可见Chrome和 `mkdtemp` 用户目录，经公开 `connectOverCDP({noDefaults:true})` 连接默认context，使用真实标签页切换。此前上下文已经关闭，结束在finally关闭此独立进程并只清理自建目录，不操作用户日常Chrome或存档。

原因由本地 Playwright1.63源码证实：`node_modules/.pnpm/playwright-core@1.63.0/node_modules/playwright-core/lib/coreBundle.js:37638` 默认调用 `Emulation.setFocusEmulationEnabled({enabled:true})`；在默认自动化context，即使headed切tab，两页也报告 `hidden=false/hasFocus=true`。`noDefaults:true`默认context跳过该仿真。最终实际读取游戏页 `hidden=true/hasFocus=false`、另一页 `hidden=false/hasFocus=true`；JSON含 `headless:false/focusEmulation:false` 与真实visibilitychange事件。[默认仿真双页诊断](r1-evidence-files.md#e-a30304fb08e75e6a)、[最终真实双页诊断](r1-evidence-files.md#e-42a84d2363960396)。未合成blur或visibility事件。

## 保留的失败与修复边界

- 首轮repeat实际一步，但反馈计数混入上一Teleport尚未呈现的样本。增加200ms采样准备期隔离前序反馈后，真实事件、轨迹与保存代数均证明只一次动作；保留 `repeated-keydown-first-sample-boundary-failure.json`。
- 默认headless/ headed焦点仿真、额外CDP session关闭仿真及其detach尝试均未得到真实失焦，严格断言失败。各自 `*-failure.json` 保留；采用公开noDefaults默认context后，才记录真实后台通过。
- 首次真实焦点环境在创建辅助tab的准备阶段已触发正常暂停，脚本漏点“继续探索”导致超时；补正常UI恢复后通过。保留 `d.ghost.02-real-focus-setup-resume-failure.json`。
- B键盘首目标已清除，首次鼠标点击因新辅助投影Y符号写反命中镜像行；修正为现布局的正方向后，单项正常重跑清除第二目标。保留 `antivirus-keyboard-mouse-failure.json`。本补测没有修改产品输入、时钟或规则代码。

实际日志归档在 [input-realtime-boundaries/logs（browser归档内原目录）](r1-evidence-archive.md)。第二轮完成两键/重复/覆盖/鼠标/两D共6项，第三轮在新增保存代数断言后重验repeat/pending/pointer，最终第八轮真实失焦通过，第九轮B通过。后续统一 `verify` 会按当前冻结helper全8项重新执行。定向lint、全仓typecheck及此脚本格式化在交付前实际通过。
