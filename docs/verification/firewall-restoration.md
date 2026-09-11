# 防火墙原版还原与 v2 迁移

[文档索引](../index.md) · [当前进度](implementation-progress.md) · [音乐原参考 S11](../references/firewall-audio.md) · [玩法合同](../spec/gameplay.md#62-突破防火墙)

2026-09-11，用户要求“尽可能完全还原原版”。本次针对防火墙挑战，基线为 `cdc7e64b971086e3838b8c17aa3f6796633b5e4c`。此前两轮可读性修复保留为历史，不能代表当前画面或时序。

## 1. 原参考与实现边界

原画面为 S05 / AR-A-FIREWALL：[1920×1080 原截图](https://img.game8.jp/10416126/90d0be6152e66b41e8d600a6033fe4ae.jpeg/original)，图内中央 5×4 电视格、左右四块 COMBO 电视；S10 为 [TheWayCafe 实机教学 21:12](https://www.youtube.com/watch?v=Ua1SdQqcePc&t=1272s)，实际查看了教学提示以及 21:22 左右的 PERFECT / COMBO 画面。录屏说明白光随音乐拍子闪动，成绩反馈来自移动踩拍。音乐曲名、试听实测与使用条件单独维护在 S11。

本版以原构图重建中央电视和四侧屏，保留真正可交互的键鼠棋盘。Three.js 舞台共用一张 COMBO 纹理，只有数字、判定或字体就绪状态改变才重绘；每次退出销毁侧屏几何、材质和纹理。中央玻璃增加迷彩图形、点阵、边缘反光；原替代玩家图标和 OFL 字体继续使用。全屏 HUD 留在角落，底部显示时间、目标、进度与可读拍点。固定 16:9 比例在较宽或较高窗口中居中取景。

| 对照项          | 当前处理                                                              | 剩余差异                                                                           |
| --------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 中央阵列 / 大屏 | 5×4，左右各两块 COMBO CRT；四屏同步真实 Combo、PERFECT / MISS         | TV 壳细节和玻璃曲率由几何与程序纹理重建，未达到逐像素一致                          |
| 格距 / 构图     | 以原 1920×1080 图定位；三验收尺寸保证全部显示和至少 44px 点击区域     | 原透视、镜头畸变与本版正交相机不同                                                 |
| 屏幕 / 玩家     | 紫灰 CRT、迷彩反光、危险粉红屏、提前“!”；玩家白底黑色邦布轮廓         | 玩家原图、原贴图未采用；反射和扫描纹理为补制                                       |
| HUD / 字体      | 角落提示、巨型数字与 COMBO、底部轻量状态                              | 原对话/角色入口按范围移除；中文/数字为 OFL 替代，底部文字是可访问性补充            |
| 音乐 / 白光     | 共用有效时钟，110 BPM，音乐首拍、循环与白光同步                       | 三首为原创替代循环，不是 Red! / Red!! / Red!!! 原录音                              |
| 判定 / 谱面     | 按原交互核对后保留每拍一次、最高 Combo 结算、错拍扣减；四拍行列危险组 | ±150ms、半拍起点、阈值与完整危险图案仍为本版重建参数，不能据试听反推原游戏精确判定 |

## 2. 根因与修复

原实现复用了通用 5×5 棋盘、侧栏计分框和固定间隔提示音。周边白光补修解决了提示缺失，却没有覆盖原来的电视墙构图和连续配乐。先加入真实内容 5×4 回归，旧定义以 `25 !== 20` 失败，再修改实现。

四档权威内容统一为 110 BPM，教学 27 拍、正式 82 拍，仍为 15/45 秒和 12/40/55/70 的最高 Combo 目标。危险组变化前 150ms 预告，末组保留至结算。规则只根据有效时间和正常输入结算，渲染与音频没有另写计分逻辑。

`GameAudio` 将有效时间映射到 `AudioContext.getOutputTimestamp()`，补偿输出延迟；启用迟到时定位到当前乐句，32 拍循环使用精确播放速率补偿 PCM 样本数取整。暂停、失焦与恢复倒数停止声音，倒数结束再定位续播。输出映射发生超过 40ms 的偏差时重新对齐，测量小抖动不会反复重启。对真实耳机/设备切换的物理实测不作保证；端口故障回归明确区分于 Chrome 正常播放。

复查另外补了两个实际红→绿回归：同一 16ms 桶内命中后暂停，投影缓存必须失效以清除 PERFECT；输出延迟从 80ms 变为 300ms 时，必须纠正超过判定窗的音乐偏差。Chrome 焦点轮廓移到左下操作提示，避免常亮的画布边框与拍点白光混淆。

## 3. 版本与旧档

schema 仍为 2；M1–M5 当前 contentVersion 为 2/3/4/5/5，ruleVersion 为 2。原实时定义逐字保存于 `src/content/history/realtime-v1.json`，原存档证据和旧世界见证保持原文；旧夹具明确用旧内容验证。

每个旧 profile 先走同阶段的 v2 迁移，再走后续阶段的兼容升级，覆盖 15 条旧→新路径。原最好成绩归档；合法目标、奖励、数据、静态首次布局和主线永久结果保留。未完成实时挑战恢复到安全准备态重新开始，本次分数不跨谱面续接。旧 v1 中正常操作达到的 90 Combo 可以正确迁移，不按 v2 上限误拒旧档。写入新档前先保护旧槽，备份失败时保留原文。

## 4. 验证与交付

最终验证于 2026-09-12 00:06–00:12（Asia/Shanghai）完成。Node 24.18.0 / pnpm 11.25.0，冻结锁文件安装通过；`pnpm run verify` 退出 0，**37 个测试文件 / 484 项通过**，零失败、取消、跳过和 todo。lint、format:check、typecheck、架构、内容、所有必需见证、只读 build、产物检查、五分期 Chrome 正常键鼠 / 导出 / 刷新及七项既有故障回归通过；198 个实现输入文件检查前后 SHA-256 完全相同。

[完整工程日志](evidence/firewall-restoration/verify.log) · [只读证明与源哈希](evidence/firewall-restoration/verification.json) · [冻结安装](evidence/firewall-restoration/install.log) · [五分期与完整浏览器结果](evidence/firewall-restoration/browser-results.json)。首轮完整管线遇到旧测试仍要求两次独立提示音，修正为观察连续循环声源与暂停停止后通过；[首次失败](evidence/firewall-restoration/verify-first-old-audio-assertion.log)原样保留，未用忽略失败替代修复。

| 验收范围                          | 实际验证与结果                                                                                                                                                                      | 证据                                                                                                                                                                                                                                                                                                                    |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T01 / T02 / T03 / T04 / T07 / T13 | v2 首末窗口、重复输入、危险格、27/82 上限、失败与自然结算、30/60/120fps 一致；全十条当前世界见证通过                                                                                | [发布回归](../../tests/firewall-release.test.ts)、[完整日志](evidence/firewall-restoration/verify.log)                                                                                                                                                                                                                  |
| T08 / V01 / V02 / V03             | production 1512×771 有声教学、1024×640 静音+减少闪烁/动态，各正常 14 Combo；底部提示、白光、暂停和退出清理通过                                                                      | [逐拍记录](evidence/firewall-restoration/firewall-cue-results.json)、[标准画面](evidence/firewall-restoration/firewall-cue-standard.png)、[减少效果画面](evidence/firewall-restoration/firewall-cue-reduced.png)                                                                                                        |
| T02 / T03 / T04 / V03             | 同一验收新档完成教学后依次内层 47、深层 57、核心 72；每档均为正常键鼠并等待 45 秒自然结算。内层先 5 Combo，观察等待拍点及“!”后正常错拍降到 0，再完成 47。无位置、分数、门或目标写入 | [MISS](evidence/firewall-restoration/firewall-music-levels-inner-miss.png)、[预告](evidence/firewall-restoration/firewall-music-levels-inner-warning.png)、[核心活动](evidence/firewall-restoration/firewall-music-levels-core.png)、[核心结算](evidence/firewall-restoration/firewall-music-levels-core-completed.png) |
| P07 / P08 / P09                   | 15 条旧→新分期路径、原 90 Combo 保留、活动尝试恢复、迁移备份失败保护；真实历史 M5 的 951 代导出由正常文件选择器导入，保持 130物资/26奖励及九项旧成绩，刷新再导出载荷完全相同        | [旧档升级预览](evidence/firewall-restoration/legacy-import-preview.png)、[实际结果](evidence/firewall-restoration/legacy-import-result.json)、[升级后导出](evidence/firewall-restoration/legacy-import-export.json)                                                                                                     |
| V04 / 时间接线                    | Chrome 各档实际配乐跨 32 拍循环不重启，暂停停止、恢复定位；末次音画映射绝对偏差为 0.137 / 0.158 / 0.106ms。80→300ms 输出延迟变化、同帧桶暂停另有先红后绿的端口 / 规则测试           | [音频红灯](evidence/firewall-restoration/audio-drift-red.log) / [绿灯](evidence/firewall-restoration/audio-drift-green.log)、[暂停红灯](evidence/firewall-restoration/pause-presentation-red.log) / [绿灯](evidence/firewall-restoration/pause-presentation-green.log)                                                  |

三档在本机 Chrome 153.0.8010.36 的 headless / 1920×1080 / DPR1 / 标准画质下，各正常采样约 42.23 秒（恢复倒数结束至自然结算），样本数 2534 / 2534 / 2535；帧间隔中位数均约 16.7ms，p95 为 16.7 / 16.8 / 16.7ms，达到原 ≤16.7 / ≤25ms 阈值。真实 keydown 至可见命中经过一次绘制机会的输入反馈 p95 为 30.9 / 30.6 / 31.1ms，所有样本 ≤32.4ms。活动态 58 draw calls / 18 几何 / 9 纹理，离开后四侧屏与音乐均释放。[性能摘要](evidence/firewall-restoration/performance-summary.json)及完整逐帧数组由逐拍记录承载。这是新增 45 秒挑战的专项回归，**不替代 V05 原 60 秒最密地图与 30 次往返证据**。

最后实际查看了标准、减少效果、核心粉红屏、MISS /“!”和结算截图。正式档图带验收面板，只有普通与减少效果教学图为纯 production 画面；没有隐藏面板后冒充不同构建。原截图与本版的剩余差异列于第 1 节。

[同一布局断言的旧内容失败 / 新内容通过](evidence/firewall-restoration/layout-red-green.json)绑定已发布基线及当前 JSON；[危险格上限红灯](evidence/firewall-restoration/mask-cap-red.log) / [绿灯](evidence/firewall-restoration/mask-cap-green.log)补齐新深层 8 / 核心 12 上限的内容拒绝条件。

## 5. 静态包与复现

当前 [ZIP](evidence/firewall-restoration/firewall-restoration-dist.zip) 为 **4,995,583 字节**，SHA-256 为 `88ca1a72a2381de703ef7c9bc98a0cc124df61b1b7da6d315e55c30a7341fbd1`。87 个文件 / 6,344,521 字节，48 条资源记录；三首新增 WAV 各 1,539,534 字节。CRC、解压字节、`dist/` 与 Chrome 实际验证的 production 目录一致，[清单](evidence/firewall-restoration/package.json)保留全部文件哈希。固定 5174 的根入口和 87 文件共 **88 次 HTTP** 均为 200，字节相同，见 [HTTP 记录](evidence/firewall-restoration/http-audit.json)。Vite 仍提示主 JS 超过 650kB；未隐藏该体积提示或提高阈值。

在仓库根目录运行 `pnpm install --frozen-lockfile`、`pnpm run verify`；完整管线会在独立端口构建五分期并运行正常键鼠流程，不操作用户现有页面。固定体验入口仍为 `http://localhost:5174`，启动命令为 `pnpm run preview --host localhost --port 5174 --strictPort`。真实旧档专项可通过 `node docs/verification/evidence/firewall-restoration/verify-legacy-import.mjs` 重放，结果写入 `test-results/firewall-restoration`；静态归档配方为[reproduce-package.py](evidence/firewall-restoration/reproduce-package.py)，须先完成 `pnpm run verify` 并启动固定 preview。

本次遵循用户已确认的本机 Chrome 范围，不恢复 Safari / 离线门槛，不将本次专项回归称作全部 63 项重验。未直接采用原曲录音和原字体；逐像素纹理、原完整危险谱面及精确判定窗口仍无充分证据。实现分支与 PR 的交付入口见[当前交付记录](release-candidate.md)。
