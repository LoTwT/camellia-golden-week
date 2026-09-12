# R1 平台边界浏览器验证

[验收主记录](r1-acceptance-results.md) · [迁移规则](r1-migration.md) · [验收合同](../spec/acceptance.md)

当前状态：2026-09-12 本机独立 Chrome `153.0.8010.36` 已完成全部28个场景，均通过且无未处理页面错误；三条实时刷新又以挑战自身有效时间为条件单独通过。结果见 [完整28场景](r1-evidence-files.md#e-2e09cc03e0b2030e)与[实时计时复验](r1-evidence-files.md#e-8d87400ba0a2a05b)。这是指定平台边界的实际记录，不代表63项R1整体验收全部完成。

执行入口为 `node scripts/browser/r1-platform-boundaries.ts`，导出 `verifyR1PlatformBoundaries({ browser, url, alternateUrl, outputDir, scenarioIds? })` 供总流水线调用。`url`必须是现有acceptance构建；`alternateUrl`须为另一个实际端口的构建，用于P12来源隔离与正常文件导入。CLI启动两个临时preview和独立Chrome，不接触用户常用来源 / 存档。每场景独立context；双标签场景在同一context实际打开两页。

## 方法与边界

- I08/P03成功帧故障先从新游戏通过实际按键，走到当前第一迷宫成功前一步，再由既有验收面板配置一次render / audio / get / set / readback故障并走完。比较永久集合、首份完成布局、物资、实际双槽和UI导出；不把失败存储解释为内存事务回滚。
- 导入失败以正常新档作为当前世界，正常文件选择器读取已由M5 main实际游玩取得的导出档。只有对应平台故障被注入；确认导入后验证候选没有进入当前世界。旧档迁移使用已冻结的真实历史导出，另验证迁移前备份失败与新槽写后回读失败，后者允许目标槽变化，须保留另一有效槽及已验证原备份。
- 坏JSON、未来版本、代数冲突等仅通过现有acceptance面板的A/B测试槽输入，明确为存储边界夹具。非法文件只通过正常导入界面；字符串不执行，当前世界 / 原槽不变。这些不是关卡通关证据。
- P10实际同源双页请求Web Locks：第二页不抢写，第一页产生更新后关闭，第二页重新获取并重读最新进度。P12通过Playwright只调整页面Date进行测试，不改操作系统日期；不同端口实际为空并可正常导入，原来源保持。
- V04启动WebGL不可用与音频拒播沿用现有acceptance启动故障；上下文丢失 / 恢复调用浏览器实际 `WEBGL_lose_context`，不手工派发事件。T12由现有面板真实阻塞前台300ms，不改游戏时间或进度。

## 场景映射

| 场景                                                         | 对应ID        | 核对重点                                                                                                    |
| ------------------------------------------------------------ | ------------- | ----------------------------------------------------------------------------------------------------------- |
| success-render / audio / get / set / readback                | I08、P03、V04 | 正常首迷宫成功，反馈失败或写入失败不回滚、不重奖，可导出；写前 / 写后保证分开                               |
| import-get / set / readback                                  | P03、P06、P09 | 确认候选后失败，内存世界保持，UI未保存 / 导入未生效；另一有效槽保护                                         |
| migration-backup-set / readback                              | P09           | 原槽未动，停止持久迁移，备份失败有提示                                                                      |
| migration-newslot-readback                                   | P03、P09      | 新槽可变、另一原槽及迁移前备份保留；正常重试不覆盖首次原备份                                                |
| invalid-imports                                              | P06           | 坏JSON、超限、错误项目、未知目标 / 奖励 / 位置、伪完成布局、真实盗取完成组件重叠、脚本字符串                |
| slots-bad-json / both-bad / same-generation                  | P04、P11      | 区分损坏、冲突、显式恢复，原文可导出；双坏槽明确新游戏保留损坏来源确认                                      |
| slots-future-schema / future-content                         | P05           | 高版本原槽保护，不静默继续低版本，不提供普通覆盖入口                                                        |
| slots-generation-order                                       | P04、P12      | 日期与槽名不决定最新，按有效代数选取                                                                        |
| newgame-import-generation-date                               | P11、P12      | 正常新游戏 / 导入递增代数，日期倒退后保存与加载保持最新                                                     |
| different-port                                               | P12           | 不同真实端口存储隔离、正常导入衔接、原来源不变                                                              |
| two-tabs                                                     | P10           | 同源两页单写、重试不抢锁、持锁页关闭后重读新进度                                                            |
| realtime-refresh-b.antivirus.light / d.ghost.01 / d.ghost.02 | P02           | 实际所得档正常导入、传送 / 行走 / F进入三新实时挑战，运行中刷新回安全世界入口，临时状态不入档、永久集合不变 |
| audio-denied / webgl-startup / context-loss                  | V04           | 无声继续 / 重试，图形失败可导出，真实上下文恢复同一权威状态                                                 |
| clock-gap                                                    | T12、I07      | 真实300ms中断后冻结 / 提示，继续后只响应新的物理输入                                                        |

现有故障面板提供的是回读不匹配，不提供任意“写后下一次读取抛错 / 校验失败”新能力；其余写后分支由当前服务层测试验证，本浏览器记录不混称已逐一注入。精确幽灵499ms暂停另由当前规则4测试及对应玩法浏览器记录维护，不用静态中心clockGap替代。

## 实际结果与证据

完整运行时间为 `2026-09-12T11:14:15.742Z` 至 `11:16:01.062Z`；实时计时复验为 `11:16:23.781Z` 至 `11:16:42.727Z`。视口1512×900、DPR1，场景context初始减少动态。Chrome与两个临时preview均在结束时关闭，未使用用户日常来源。命令与构建输出见[完整运行日志](r1-evidence-files.md#e-00670443abdf2c35)、[三条复验日志](r1-evidence-files.md#e-9b700833a05394b0)。构建只有既有chunk体积提示；没有降低浏览器阈值或改变生产行为。

- [成功渲染故障](r1-evidence-files.md#e-03deabf03b6c9647)、[音频故障](r1-evidence-files.md#e-a077eb8882593b34)、[读取拒绝](r1-evidence-files.md#e-31616bc507e08c43)、[写入拒绝](r1-evidence-files.md#e-fac9b4747e688b03)、[回读不匹配](r1-evidence-files.md#e-24b6f7b724d9eef3)：都实际从新游戏走到第一迷宫成功。成功前代数32；写拒绝保留32且两槽不变，写后回读失败实际代数33并保留另一槽。失败UI明确未保存，导出仍含实际完成；反馈抛错也保留完成。显式重试后奖励ID不重复。
- [导入失败三阶段](r1-evidence-files.md#e-1d5552f243c585f4)、[备份写入失败](r1-evidence-files.md#e-1f93cd594617993a)、[备份回读失败](r1-evidence-files.md#e-cab00dd7f51f90ff)、[迁移新槽回读失败与重试](r1-evidence-files.md#e-b31d381363881c03)：候选均未切入当前世界；写新槽前失败保持原A/B，写后失败保留另一有效槽和实际原备份，正常再次导入未覆盖首次备份。
- [8类非法导入](r1-evidence-files.md#e-f4f39a77e9997093)全部在正常文件选择器中被拒，当前世界和原槽不变，脚本字符串未执行。完成组件重叠使用真实新M5主线档的盗取02布局，仅改两个组件占格作为具名坏档边界。
- [坏一槽恢复](r1-evidence-files.md#e-7cf9a16869921b9b)、[双坏槽显式新游戏](r1-evidence-files.md#e-402f837f6e2fc750)、[同代冲突](r1-evidence-files.md#e-e83ef0860a1b1cba)、[未来schema](r1-evidence-files.md#e-3ce6dfb1ae593c94)、[未来content](r1-evidence-files.md#e-1a6d971c3b011a64)、[代数逆序](r1-evidence-files.md#e-4e29b7b6dc2c6eb3)均按预期显示。原始槽逐一可导出，未来版本不静默继续旧档；双坏槽明确确认后的真实槽保留损坏原文hash，刷新可继续新档。
- [新游戏、导入与日期倒退](r1-evidence-files.md#e-37c5d6a7cf4d21d3)证明实际代数递增、上一有效快照保留、Date退到2001年后仍选择新代数；[不同实际端口](r1-evidence-files.md#e-e73fdbc69b7b74f4)先为空，通过正常文件导入衔接且原来源不变。这项没有改变操作系统日期，也没有将其扩展为实时挑战日期边界证明。
- [真实同源双标签](r1-evidence-files.md#e-d4f24c318fe0a59b)中第二页重试不抢锁，第一页从代数2实际走到3后关闭，第二页获取锁并导出代数3，完整payload一致。页面恢复 / bfcache仍由对应会话专项记录，这里只证明实际关闭持锁页的路径。
- [B运行中刷新](r1-evidence-files.md#e-cb539ecda3a08804)、[D01刷新](r1-evidence-files.md#e-977841511e6df99c)、[D02刷新](r1-evidence-files.md#e-5677d2c5d995a76f)的挑战自身有效时间分别2013.0ms、114.6ms、113.9ms。正常导入实际档、传送 / 行走 / F进入后，刷新分别回 `b.t.0.3`、`d.t.2.0`、`d.t.0.-2`，实时房间为null、永久集合和首份完成布局不变。成功事务后动画前刷新的原子性仍由engine/save-payload及完整流程对应证据维护。
- [音频拒播](r1-evidence-files.md#e-2d5635c2a525b081)可无声移动并重试；[启动WebGL不可用](r1-evidence-files.md#e-4f82215c1aaa8eda)显示明确失败与导出入口，正常重试后能移动 / 导出；[实际上下文丢失恢复](r1-evidence-files.md#e-c8214116fd51001e)冻结于`graphicsLost`，350ms后有效时钟不变，重建后位置 / 永久集合一致；[真实300ms阻塞](r1-evidence-files.md#e-e83cc9783037e034)只产生`clockGap`，继续后只响应新输入。

每个同名JSON旁都有同名PNG。完整结果内保留原输入来源SHA-256：实际新M5 main为 `2223b06a0004788ffc97335996f4fa5bb51b026737cbe6cd591c8d37947b94a8`；真实旧档为 `875124f82484520f3bc84c90e25dca69c3f5883b1184e923f66144333cdfcefb`。

## 已修正的验证脚本问题

两次失败均保留原始证据，不记为产品通过：

1. [首轮日志](r1-evidence-files.md#e-d876011e9fbd7e5d)、[失败JSON](r1-evidence-files.md#e-0d6ceb14424a57bd)：故障面板内部另有只读快照summary，宽定位匹配两个元素。改为只点击直接子summary后正常运行；没有改产品面板。
2. [第二轮日志](r1-evidence-files.md#e-5449b78615489c1d)、[失败JSON](r1-evidence-files.md#e-b1cff2b5353817e7)：脚本错误地要求内存导出携带仅属于真实存储槽的损坏确认标记。改为验证实际原始槽与原文hash，再刷新验证新档，没有放宽存档校验。

第三轮完整28场景通过后，又把实时刷新等待明确限定到挑战自身有效时间，单独复验三项通过。其余场景没有因此重复执行；最终统一流水线会调用当前helper。
