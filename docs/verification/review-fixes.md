# 消融 Review 修复与回归

[文档索引](../index.md) · [当前交付包](release-candidate.md) · [验收映射](acceptance-results.md) · [实施进度](implementation-progress.md)

2026-09-11，用户在三份消融 Review 汇总后明确授权“按你分析修复”。起点为干净的 `e70fc7d5fc90c688ed82d39a89ec25c8d3e67174` / `codex/full-implementation`。本轮修复四个可复现运行时缺陷，补齐真实入口、内容装配、测试发现、分期和架构的回归检查；没有改变主路径、回访、开库、计分挑战与主线分离、奖励账本或验收范围。

## 1. 运行时缺陷与处理

| 问题                                    | 根因与修复                                                                                                                                                                                                | 回归位置 / 原验收 ID                                                                                                                 |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 极大修订号导入后正常操作无法保存 / 导出 | `stateRevision` 接受安全整数最大值，但下一稳定动作溢出。恢复外部载荷时，仅对 `>= 2 ** 52` 的值建立 0 起点，为后续事务保留至少半个安全整数空间；普通修订号、永久进度、导入原文和本地 `saveGeneration` 不变 | [存档反例](../../tests/save-review-regressions.test.ts)、[Chrome 导入与恢复](../../scripts/browser/review-regressions.ts)；P01 / P06 |
| 同代深层坏档使启动卡住                  | 同代检查对未通过载荷校验的原始 envelope 递归生成规范 JSON，耗尽调用栈。改为迭代比较 JSON 值，保留字段顺序无关、同代不同载荷冲突和双槽原始导出；不自动选旧档                                               | 同上；P04                                                                                                                            |
| 画质数组被接受，其他设置随后失效        | 校验使用字符串转换，`["low"]` 被当成 `"low"`。改为真实字符串枚举比较；非法导入保持原槽和原世界，合法画质仍可正常修改静音等设置                                                                            | 同上；P06 / V03                                                                                                                      |
| 较旧音频启用失败覆盖较新成功            | 多个异步请求共享可用状态，旧回调无顺序检查。音频适配器和主程序均只接受最后一次请求；禁用 / 销毁使未完成请求失效                                                                                           | [音频测试](../../tests/audio.test.ts)、[Chrome 故障顺序](../../scripts/browser/review-regressions.ts)；V04 / T08                     |

存档新反例在原代码实跑为 8 项中 6 项失败，修复后连同原双槽和载荷测试 55/55 通过。音频两项并发反例同样先失败、再通过。普通进度恢复保持原值；额外独立检查验证修订号阈值前 / 上 / 后和安全整数最大值均可显式恢复备份，再连续移动保存。新比较器亦通过 12,000 层对象的顺序 / 末端差异检查及 1,500 对 JSON 对照。

同代不同载荷仍显示“需要处理本地存档”，提供 A / B 原始导出和重新读取，不能自动进入世界。修复不把冲突降级成空档或静默恢复。极端修订号重置不属于 schema 迁移，也不改变 `saveGeneration` 的耗尽保护。

## 2. 校验与维护改动

| 范围       | 最终行为                                                                                                                                                 | 实现 / 回归                                                                                                                                                       |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 测试入口   | 递归发现全部 `.test.ts`；空目录、只有空文件、全部跳过或发现异常不能假通过；嵌套失败传播非零退出。保持 Node 原生运行器，不锁死测试数量                    | [运行入口](../../scripts/run-tests.ts)、[管线反例](../../tests/verification/pipeline.test.ts)                                                                     |
| 原始内容   | 回访合并 / profile 裁剪前检查归属、引用、重复 ID / 坐标、收录阶段与孤儿数据；保留并校验原始 `includedRoomIds`，不再以重建值掩盖错误                      | [源校验](../../src/content/source-validation.ts)、[真实装配反例](../../tests/content-source.test.ts)                                                              |
| 必需见证   | 每个已发布 profile 必须具有主路径与全收集见证，检查本版终点、完整奖励 / 数据和不依赖计分挑战的断言；允许增加合法路线                                     | [见证清单](../../src/content/witnesses/index.ts)、[清单及真实 CLI 消融](../../tests/world-witness-inventory.test.ts)                                              |
| 分期与产物 | `development` / `production` / `acceptance` 使用当前 M5，`m1`–`m5` 显式选择分期，未知模式报错；实际产物的 profile、资源集合 / 哈希和生产诊断隔离均受检查 | [模式解析](../../scripts/build-profile.ts)、[产物检查](../../scripts/verify-artifacts.ts)、[五期正常 Chrome 流程](../../scripts/browser/production-profile.ts)    |
| 核心边界   | 使用已锁定 TypeScript 7 编译器的真实依赖 / 符号，禁止核心层反向引用、外部模块及浏览器 / 平台 API；允许标准纯值操作和普通同名字段                         | [架构检查](../../scripts/check-architecture.ts)、[管线反例](../../tests/verification/pipeline.test.ts)                                                            |
| 输入与语义 | 输入模块五处同义间隔统一为一个 `140ms` 常量，验证阈值前 / 上、重复键和自动行走；补上物资图标、迷雾 / 观察态、奖励名称和增幅仪绕行断言                    | [输入](../../tests/input.test.ts)、[投影](../../tests/projection.test.ts)、[名称](../../tests/labels.test.ts)、[能力门槛](../../tests/progression-guards.test.ts) |
| 主程序接线 | 实际构建检查画面更新、自动保存 / 刷新、自动行走、失败后的持续输入清除及防火墙节拍；不通过重建一套模拟编排来代替 main                                     | [浏览器入口](../../scripts/verify-browser.ts)、[正常流程](../../scripts/browser/production-profile.ts)、[故障与接线](../../scripts/browser/review-regressions.ts) |

源内容反例在原代码中 9 项失败；清空 M5 必需见证后原 CLI 仍退出 0，对应回归断言失败；修复后相关 29 项通过。M1–M5 装配结果与起点逐项深度相等，固定地图与账本未改。房间的最终棋盘、出生与见证元数据继续由挑战定义维护，未引入第二套数据事实来源。

已删除无调用的 `assertStaticDefinition` 和 `previousProfile`。区域物资查询参数与 `data` 类型分支仍表达有效合同能力，未因当前地图没有消费者而删除。被测试读取的历史验收 JSON、手动夹具生成器、PNG / SVG 配套资源及 M4/M5 共用内容均保留。

## 3. Chrome 验证方法与边界

使用本机 Google Chrome 153.0.8010.36、Node 24.18.0、pnpm 11.25.0 与锁定的 Playwright 1.63.0 开发依赖。浏览器由脚本独立启动，正常流程仅用键盘、鼠标和可见导出操作；每个用例使用全新 context，读取验收快照时只读，不写位置、目标、分数或门状态。生产包不存在验收快照入口。

- M5 正式包：新游戏领取增幅仪、完成中心教学、进入 A、正常通过迷宫 01、领取首物资，到 `a.t.6.0` / 6 单位；导出并刷新恢复完整相同载荷。
- M1–M4 正式包：各自新游戏领取增幅仪并导出、刷新恢复，验证实际 profile 与 26 / 51 / 81 / 130 分母。
- 七项修复回归：极大修订号导入后的连续移动 / 保存 / 导出 / 刷新；非法画质数组拒绝；12,000 层同代坏档可见冲突及原始导出；音频旧请求迟到失败；正常远点自动行走；迷宫失败后仍按住方向至观察结束；防火墙实际 WebAudio 排拍与暂停停止排拍。

修改修订号、画质、localStorage 和 WAV 响应只用于对应具名故障用例。WebAudio 包装仅记录声音源启动时刻，不改规则或挑战计时。正常新档流程没有使用这些注入。

棋盘截图只比较中央电视区域，先证明静止连续截图相同，再观察移动后的变化；排除 HUD 文案、提示与控件造成的假阳性。浏览器回归是新增自动防护，不能表述为本轮重新从新档完成全收集或重跑全部 63 项验收。原全通关 / 全收集、性能与浏览器范围证据继续保留原始时点含义。

## 4. 完整验证与交付

最终 `pnpm run verify` 退出 0。**458/458** 项原生测试（33 个文件）通过，失败 / 跳过 / 取消 / todo 均为 0；五个 profile 的正常 Chrome 流程与七项具名修复回归全部通过。验证前冻结的182个源码、配置、资产和测试文件在验证后SHA-256完全相同。

| 验证            | 实际结果 / 证据                                                                                                                                                                                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 干净冻结安装    | 独立空依赖目录执行 `pnpm install --frozen-lockfile` 退出0，锁文件未变，Playwright可加载；[记录](historical-evidence-files.md#file-e74c62b01d8da2bb)、[日志](historical-evidence-files.md#file-9fda822fa4d57da0)                                                                                 |
| 统一交付入口    | 原生测试、lint、格式、类型、核心架构、原始内容 / 10条世界见证、只读资产检查、production build、实际产物、Chrome均通过；[完整日志](historical-evidence-files.md#file-776a46fd00c98fd8)、[结果及输入不变性](historical-evidence-files.md#file-bed18d5ace1fd9cd)                                   |
| Chrome          | 153.0.8010.36，五个分期及七项回归；[机器结果](historical-evidence-files.md#file-5e4ad7578e003dc4)、[M5导出恢复画面](historical-evidence-files.md#file-513d08216ba8089e)、[失败后新按键可用](historical-evidence-files.md#file-7fa58140c53ed615)                                                 |
| 字体缺字拦截    | 首次完整检查拒绝六个新字符；显式按原配方补制183,808字节WOFF2，实际解码覆盖全部808个源码字符。保留[失败日志](historical-evidence-files.md#file-64271e22b2091753)、[生成日志](historical-evidence-files.md#file-43d9b553ff3790ca)、[解码核对](historical-evidence-files.md#file-5daac6a5ef6cfe3c) |
| 地图 / 分期未改 | M1–M5内容装配结果与 `e70fc7d` 深度相等；[核对](historical-evidence-files.md#file-32e21956e85d70d7)                                                                                                                                                                                              |
| 最终归档        | 84文件 / 1,677,281字节，ZIP 847,180字节；CRC、解压字节及Chrome实际验证的production目录全部匹配；[ZIP](historical-evidence-files.md#file-32358b0cc72ce73b)、[SHA-256](historical-evidence-files.md#file-64bf9813619ac6f2)、[逐文件记录](historical-evidence-files.md#file-9527e55623d0e2b7)      |
| 固定5174        | 原preview进程未重启，85次本地HTTP全部200且字节 / Content-Type匹配，80项资产和许可哈希匹配；[审计](historical-evidence-files.md#file-dc73b4c2be19d6d2)。首次使用系统代理的读取得到502，改为探针直接连接localhost后通过，未改浏览器或代理配置                                                     |

`pnpm run verify` 是交付入口：依次执行原生测试、完整只读检查与构建、实际 `dist/` 校验、独立五期和 acceptance 静态包的 Chrome 检查。普通 `vite build` 仍是构建器入口，本身不承担整个发布验收。检查不自动格式化、不生成夹具、不改写权威资产。Vite原有单JS超过650kB的提示保留，没有提高阈值；当前入口918,522字节，gzip大小因工具选项不同以各自日志为准。

本次仅以用户已接受的本机 Chrome 为环境，不补做 Safari 或真实断外网。没有改变性能阈值，也没有以本轮短浏览器用例冒充60秒性能预算或完整130单位全收集复验。原63项验收记录仍为62通过 / V06不再要求，其历史结果不重新计数。

## 5. 对原测试缺口的消融复验

在独立临时副本真实移除一处逻辑，再用正式检查入口验证。下表八处原先可逃过测试的删除，现在全部触发预期失败；没有通过修改主工作区或游戏进度制造结果。主程序三项接线消融在独立副本的production与acceptance构建成功后才进入浏览器断言，正常基线先通过。

| 被移除 / 改错的逻辑    | 新检查捕获的实际结果                                    | 证据                                                                                                                             |
| ---------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 自动保存调用           | 刷新丢失刚领取的增幅仪及稳定位置，完整载荷不相等        | [产物 / Chrome消融](historical-evidence-files.md#file-78c117fd0bba6dd8)                                                          |
| 棋盘更新调用           | 中央电视像素不随正常移动变化                            | 同上                                                                                                                             |
| 失败时 `input.clear()` | 观察结束后旧长按继续移动到0,1，预期仍在0,4              | [主程序消融](historical-evidence-files.md#file-e5262c0cc38bbec4)、[失败画面](historical-evidence-files.md#file-6ab16cf7e68ad89a) |
| `autoWalk.observe`     | 远点移动只发生1步，预期4步到达已访问目标                | 同上；[诊断](historical-evidence-files.md#file-47bcb76c3ba05775)                                                                 |
| `audio.syncFirewall`   | 挑战已运行、音频已启用且有13个普通声音源，但未来节拍为0 | 同上；[诊断](historical-evidence-files.md#file-1eb05a27bd994eeb)                                                                 |
| 正式包诊断门控         | 正式JS检出 `__CAMELLIA_INSPECT__`                       | [产物 / Chrome消融](historical-evidence-files.md#file-78c117fd0bba6dd8)                                                          |
| 分期选择固定为M5       | 请求M1却产出M5，manifest检查失败                        | 同上                                                                                                                             |
| 导入1MiB上限           | 合法JSON加尾随空白至1MiB+1不再拒绝，边界断言失败        | [导入消融](historical-evidence-files.md#file-a87b4f09834a73a1)、[日志](historical-evidence-files.md#file-06ff76623390311d)       |

另有空 `main.ts` 的真实Chrome启动失败；投影图标反转、隐藏边缘泄露、观察态门控删除、奖励名称缺失、增幅能力门槛删除及140ms输入间隔漂移共六项语义变异全部被检出，见[结果](historical-evidence-files.md#file-5fb98c43d5ca9f54)。原始内容错误和必需见证清空经真实装配 / CLI验证，见[记录](historical-evidence-files.md#file-5e947a03f74d7fe6)。不同报告的实验分母不相加为“覆盖率”。

最初整块画布截图包含HUD，渲染删除曾被文字变化掩盖；最终改为中央区域并验证静止连续截图一致，随后再消融确认失败。归档仅保留最终有效断言的结果和失败画面，未把早期通过时留下的截图混入最终渲染证据。原始日志、快照与对应源码为复核依据；运行时完整trace保留在ignored `test-results/`，Git归档包含关键截图与机器结果。证据路径及校验值见[归档索引](historical-evidence-files.md#file-8405dbdf09eca432)。

修复沿用 `codex/full-implementation` 并更新[现有PR #1](https://github.com/LoTwT/camellia-golden-week/pull/1)，不合并main；具体已发布提交以[PR提交列表](https://github.com/LoTwT/camellia-golden-week/pull/1/commits)为准。
