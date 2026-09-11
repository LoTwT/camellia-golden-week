# M5 静态交付包

[文档索引](../index.md) · [操作与存档说明](../../README.md) · [验收结果](acceptance-results.md) · [实施进度](implementation-progress.md)

2026-09-11：当前交付物为 **0.5.0 / M5 / content4 / rule1 / schema2** 的 production 构建，包含全部游戏内容。按[用户本轮范围调整](acceptance-scope-2026-09-11.md)，本机 Chrome 为验收环境，V05 达到原预算；63 个原始用例中 **62 项通过、V06 不再要求**。真实断外网、其他硬件与历史 Safari 结果不冒充已通过。实现分支 `codex/full-implementation` 从 `bfb924b075aa6a153ed33b95ce4492260e18a8d9` 建立；M1–M5 已按里程碑提交，M5 实现为 `811da5a1eb6ac175aa380418c2d84cf079469713`。游戏验收已按当前范围收口，实现分支已推送，[PR #1](https://github.com/LoTwT/camellia-golden-week/pull/1) 已创建，供用户审阅；main 尚未合并。

## 1. 当前静态交付物

- [完整静态 ZIP](evidence/m5-chrome-release-dist.zip)：解压后直接包含 `index.html` 和 `assets/`。
- [ZIP SHA-256](evidence/m5-chrome-release-dist.zip.sha256)、[逐文件清单与归档校验](evidence/m5-chrome-release-package.json)。
- [资源及本地 HTTP 审计](offline-build-audit.md)、[当前生产包机器记录](evidence/m5-chrome-release-build-audit.json)。

| 项目         | 实际结果                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------ |
| ZIP          | 845,629 字节；SHA-256 `62b119813a7d3269a95f30f4894e3f4efb5996ccabd054d5fe9acf7d1a888175`   |
| 解压内容     | 84 文件，1,674,897 字节；CRC 检查通过，每项解压字节均与当前 `dist/` 一致                   |
| 文件清单指纹 | `daa2962d0f1b0d7bb8a06af544485ada9e6395f8447c81544f0c3c0fdd079172`；算法与逐项值见机器记录 |
| 应用入口     | `assets/index-BpL7y5kK.js`，917,896 字节，gzip 约 216.96 kB                                |
| 本地资源     | 45 条记录，78 个内容哈希和 2 个许可哈希匹配；33 个图标、两字体和十段声音随包提供           |
| 生产排除项   | 未包含验收故障面板、只读快照、会话诊断入口、HMR 或 source map                              |

本包包含失锁恢复入口修复：离开前的内存副本保留原代数并明确标注来源；重新取得会话后须读取本地进度才能游玩。新提示所需的“副”“它”已显式加入本地字体，802 个源码字符覆盖检查通过。归档与审计均未改写构建。单 JS 超过 650 kB 的 Vite 提示保留，未调高阈值隐藏它。资源来源与重建差异见[美术实施记录](../references/art-implementation.md)和[六类视觉对照](../references/visual-comparison-m5.md)。

后续 pnpm 迁移已从干净依赖目录重建并逐项核对：84 个产物与本 ZIP 完全相同，归档无须替换。[迁移记录](pnpm-migration.md)提供当前锁文件、工程检查和 85 次 HTTP 核对；原 npm 日志及源指纹保留原提交含义。

## 2. 安装和启动

使用 Node **24.18.0**、pnpm **11.25.0**，在仓库根目录运行：

```sh
pnpm install --frozen-lockfile
pnpm run build
pnpm run preview --host localhost --port 5174 --strictPort
```

打开 [localhost:5174](http://localhost:5174)。不要同时启动另一个占用 5174 的 dev 或 preview。游戏使用本地 HTTP 服务，不直接双击 HTML；外网断开时仍需保持本地服务运行。首次安装依赖需要网络；V06 本次不再要求，离线可玩不作交付保证。

已有依赖时可预览归档包。先核对 ZIP 的 SHA-256，解压到新的目录，再将目录的绝对路径作为 `--outDir`：

```sh
pnpm run preview --host localhost --port 5174 --strictPort --outDir /absolute/path/to/unpacked-game
```

本机 Vite 8.3.0 的 `preview --help` 已确认支持该选项。实际 Chrome 生产回归运行默认 `dist/`，其字节已与 ZIP 逐项比较相同。键鼠、暂停、声音、导出、导入、旧档保护与跨浏览器迁移统一见 [README](../../README.md#操作与进度)。

## 3. 工程检查

以下 npm 日志保留 M5 原交付时的实际执行方式；项目现已使用 pnpm，迁移后的安装、锁文件与全部工程检查见[pnpm 迁移记录](pnpm-migration.md)。

| 命令 / 检查      | 实际结果与原始证据                                                                                                                                                                                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci`         | 退出 0，添加 33 / 审计 34 包，0 漏洞；[日志](evidence/m5-release-npm-ci.log)。npm 提示可选 fsevents 安装脚本未运行；后续源修复未改锁文件                                                                                                                              |
| `npm test`       | **411/411**，0 失败、取消、跳过、todo，2711.108416ms；[日志](evidence/m5-chrome-release-native-tests.log)                                                                                                                                                             |
| `npm run build`  | 退出 0，包含只读 lint、format:check、typecheck、validate:content 与 Vite 构建；[日志](evidence/m5-chrome-release-build.log)                                                                                                                                           |
| 字体失败与修复   | 首次 build 检查发现两个新缺字并拒绝构建；[失败日志](evidence/m5-chrome-release-build-font-missing.log)保留，显式补字后才重建                                                                                                                                          |
| 固定端口 preview | 当前生产包实际在 `localhost:5174` 接受全部资源请求及 Chrome 正常操作；[恢复production记录](evidence/m5-chrome-release-preview-restored.json)、[preview日志](evidence/m5-chrome-release-preview.log)；端口冲突的历史实测见[记录](evidence/m5-strict-port-conflict.log) |
| 静态资源 HTTP    | 84 文件及根 URL 共 85 次同源 200，Content-Type 和字节全部匹配；[机器记录](evidence/m5-chrome-release-build-audit.json)                                                                                                                                                |
| 实际 UI 导出载荷 | 十份新生产回归原文经当前 M5 语义校验，26 奖励 / 130 物资、四区数据各 100；[复核](evidence/m5-chrome-final-production-validation.json)                                                                                                                                 |
| 同源码观察包     | 独立目录构建，生产目录未覆盖；[构建日志](evidence/m5-chrome-observation-build.log)、[源码与构建身份](evidence/m5-chrome-build-source-identity.json)。用于可见诊断计量，不冒充生产性能采样                                                                             |

411 项包括新增的 6 项会话进度回归，使用真实旧导出、权威规则及存储适配器验证。此前 405、392、360 等日志保留对应时点结果，不能与本次数量相加。工程检查不替代浏览器正常游玩或指定设备实测。

## 4. 当前 Chrome 生产包回归

这组验证延续 M4 独立 Chrome 正常新档全收集链，没有注入游戏进度，也不另称一次新档全通关。

| 场景               | 正常操作与实际结果                                                                                                     | 证据                                                                                                                                      |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 占用会话的第二标签 | 真实导出 A / B 原始槽 947 / 946；返回或 Esc 后仍为会话占用提示，不能进入继续菜单                                       | [步骤与原文](evidence/m5-chrome-final-busy-exports.json)、[返回画面](evidence/m5-chrome-final-busy-return.jpg)                            |
| 关闭原页后接手     | 重试取得会话；继续后 320ms 棋盘就绪，390ms 内真实 Left 移动且已保存；947 / 仓库7,0 → 948 / 仓库6,0，永久结果不变       | [计量与位置证明](evidence/m5-chrome-final-continue-timing.json)、[接手](evidence/m5-chrome-final-handoff-retry.json)                      |
| 刷新恢复           | 正常 Right 保存 949，刷新继续就绪 315ms；真实导出确认完整载荷和代数相同                                                | [恢复记录](evidence/m5-chrome-final-refresh-restored.json)、[导出原文](evidence/m5-chrome-final-restored-save.json)                       |
| 历史返回的旧内存   | 正常离开到 about:blank；另页真实移动保存 950；Back 后旧页仅能分别导出新原槽 950 和标注来源的旧内存 949，均返回占用提示 | [全过程与边界](evidence/m5-chrome-final-retained-memory-protection.json)、[来源提示](evidence/m5-chrome-final-retained-memory-source.jpg) |
| 生产回归末态       | 新持锁页正常回到仓库7,0，保存 951；26 / 130、48 个目标、9 个首次布局和 9 个成绩保留                                    | [实际导出](evidence/m5-chrome-final-production-complete-save.json)、[实际画面](evidence/m5-chrome-final-production-warehouse.jpg)         |

性能采样收尾后已恢复新production，正常刷新、继续、重复F访问仓库并导出，保持1109代 / 仓库7,0 / 26奖励与130物资，默认设置与永久结果不变。见[最终实际记录](evidence/m5-chrome-final-production-restored.json)、[可玩画面](evidence/m5-chrome-final-playable-production.jpg)和[当前载荷校验](evidence/m5-chrome-final-production-restored-validation.json)。

就绪时长是一次宿主调用内正常点击与 DOM 读取的墙钟间隔，包含工具往返；390ms 样本另由真实移动和保存证明可操作。生产包没有暴露 persisted 事件，历史返回只记录实际观察到的旧内存存活，不伪称读取了 BFCache 事件标志。完整新档与分期升级、故障注入范围见[验收结果](acceptance-results.md)。

同源码观察包另完成世界与密集机关各六步，移动完成分别104.7–110.4ms、104.4–110.9ms；世界样本的镜头实际达到目标。64格场景两档各60次正常输入，末7200帧窗口分别为60220.8/60228.8ms，中位均8.3ms、p95均9.3ms，输入p95为15.8/16.6ms。详细原文、方法和测量开销见[性能记录](performance.md)，此前Chrome30次区域往返的稳定资源证据仍有效。

## 5. 历史候选包

先前 [m5-production ZIP](evidence/m5-production-dist.zip) 为 844,320 字节，SHA-256 `135d0a8c0fd00386989f46ff3361e95a920b37a18744b6d010b485e58b9e85b9`，入口 `index-BAHDLcEY.js`，84 文件 / 1,672,132 字节。其 [405 项测试](evidence/m5-production-native-tests.log)、[归档清单](evidence/m5-production-package.json)及全部实际浏览器证据保持原样；该包已被第 1 节修复后的候选替代。

旧 Chrome 正式包重复结算和刷新保持 947 / 130，内嵌浏览器真实升级链保持 170 / 26。Safari 自身新档正常续玩到 B 首访 340 / 21，后因原生窗口不可用中断；后续导出确认载荷未变。详细结果见[历史 Safari 记录](safari-production-journey.md)。用户取消其必需验收后，不继续补齐，也不把历史未验证项改为通过。

## 6. 验收范围、限制与交付状态

- **本机基准通过。** 当前 Apple M1 Pro / 32 GB / macOS / Chrome 的生产继续、刷新，同源码观察包两档持续帧率、输入和移动 / 镜头，以及 30 次区域往返达到原预算。用户接受这台机器作为本次基准，V05 通过。原 M1 / 8 GB 与 Windows 基线仍未实测，其他机器出现实际问题后再修复；[性能记录](performance.md)保留方法与设备边界。
- **离线不再作为发布门槛。** V06 仍未真实验证，记为“不再要求”。静态资源与本地 HTTP 审计通过，不能据此宣称断网全流程通过。原步骤作为可选的后续方法保留于[离线核查](offline-build-audit.md#5-真实断网验收步骤待执行)。
- **美术与地图为明确记录的重建。** 无法确认原资产的适用发布条件，实际采用 33 个补制图标、10 段补制声音和两份本地许可字体；没有把候选库发现当作原资产授权。六类原参考、本版截图及差异见[视觉对照](../references/visual-comparison-m5.md)，固定坐标与可解见证由[来源索引](../references/index.md)串联。
- **DevTools 清理有环境限制。** 请求隔离未建立，任务标签及附属 DevTools 均已关闭；依据 Chrome 官方行为，该目标运行中的拦截已停止。持久默认规则删除及 Network 过滤文字恢复因 ScreenCaptureKit `-3811` 未完成，人工恢复方法与实际边界见[清理记录](offline-build-audit.md#93-取消离线验收后的有界清理尝试)。这不作为游戏故障，也不写成全部浏览器设置已恢复。
- **Git 交付已发布。** 本 Goal 的提交使用用户指定的 `Agent-Model: gpt-6-astra`、`Agent-Effort: max`，作者与提交者均为 `eruoos <github@eruoo.me>`。M1–M5 的精确树、父提交、身份和消息见[里程碑回读](evidence/milestone-commits.json)，实际发布与 PR 见下节；未合并 main。

2026-09-11 的最终 Chrome 正常游玩导出为 1109 代，位置 `warehouse.t.7.0`，26 奖励 / 130 物资和默认设置保持。随后仅进行离线配置与清理尝试，没有发出游戏命令或覆盖进度；本任务的两个测试标签均已关闭，可玩截图对应关闭前时刻。正式 preview 继续在固定 5174 运行，重新打开本地入口即可选择继续。

## 7. 实际 Git 交付

[PR #1：feat: complete M1–M5 exploration and local progress recovery](https://github.com/LoTwT/camellia-golden-week/pull/1) 已由 `eruoos` 创建，状态为 open、非 draft，目标为 `LoTwT/camellia-golden-week:main`，来源为同仓库的 `codex/full-implementation`。读取与结果回查使用 `LoTwT`；没有切换持久登录、覆盖 main、推送标签或执行合并。

首次实现分支发布至 [005239b](https://github.com/LoTwT/camellia-golden-week/commit/005239b1621e1790f7e64d63a8945c4e13af37e4)，包含 M1–M5 五个实现提交与两次验收记录提交；创建 PR 后另将本节发布回读和链接补入同一分支，不改变游戏源码或静态包。精确首次发布、PR 作者 / 目标 / 来源和时间见[发布回读快照](evidence/git-publication.json)，最新提交以 [PR 当前 head](https://github.com/LoTwT/camellia-golden-week/pull/1/commits) 为准。

| 里程碑 | 实现提交                                                                                                 | 对应内容                                |
| ------ | -------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| M1     | [3c1c30c](https://github.com/LoTwT/camellia-golden-week/commit/3c1c30c62fd8d8700c5f11d6ed118273ea1c84a2) | 中心 / A、核心架构、26 物资与双槽存档   |
| M2     | [726317b](https://github.com/LoTwT/camellia-golden-week/commit/726317b009efdce20aaca61625c21701f468e3a6) | B、一笔画 / 杀毒、51 物资与 M1 升级     |
| M3     | [4068fb9](https://github.com/LoTwT/camellia-golden-week/commit/4068fb981fc6632867ad90319a81fcfba9e766b8) | C、球车 / 盗取、81 物资与恢复           |
| M4     | [dcc6307](https://github.com/LoTwT/camellia-golden-week/commit/dcc6307326d8aef80e8204ea348769fa8afe07f6) | D、回访、仓库、26 奖励 / 130 物资       |
| M5     | [811da5a](https://github.com/LoTwT/camellia-golden-week/commit/811da5a1eb6ac175aa380418c2d84cf079469713) | 视觉 / 交互精修、性能、浏览器与故障恢复 |

本次交付按[用户调整后的范围](acceptance-scope-2026-09-11.md)完成。第 6 节列出的未测设备、离线保证、美术重建与 DevTools 工具残留继续保留，不推定已消除。
