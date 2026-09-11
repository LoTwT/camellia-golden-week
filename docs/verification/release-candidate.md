# M5 正式构建候选包

[文档索引](../index.md) · [操作与存档说明](../../README.md) · [验收结果](acceptance-results.md) · [实施进度](implementation-progress.md)

2026-09-11：当前交付物为 **0.5.0 / M5 / content4 / rule1 / schema2** 的 production 构建，包含全部游戏内容。63 项合同当前有 61 项按规定层通过；V05 的原指定基准设备、V06 的真实断外网尚待完成，不能将候选包称为全量验收通过。用户已将本次必需浏览器限制为 Chrome。实现分支 `codex/full-implementation` 从 `bfb924b075aa6a153ed33b95ce4492260e18a8d9` 建立，M1–M4 已提交，M5 实现候选已提交为 `811da5a1eb6ac175aa380418c2d84cf079469713`；M5 验收及最终推送 / PR 尚待收尾。

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

## 2. 安装和启动

使用 Node **24.18.0**、npm **11.16.0**，在仓库根目录运行：

```sh
npm ci
npm run build
npm run preview -- --host localhost --port 5174 --strictPort
```

打开 [localhost:5174](http://localhost:5174)。不要同时启动另一个占用 5174 的 dev 或 preview。游戏使用本地 HTTP 服务，不直接双击 HTML；外网断开时仍需保持本地服务运行。首次安装依赖需要网络，真实断外网运行尚待 V06 实测。

已有依赖时可预览归档包。先核对 ZIP 的 SHA-256，解压到新的目录，再将目录的绝对路径作为 `--outDir`：

```sh
npm run preview -- --host localhost --port 5174 --strictPort --outDir /absolute/path/to/unpacked-game
```

本机 Vite 8.3.0 的 `preview --help` 已确认支持该选项。实际 Chrome 生产回归运行默认 `dist/`，其字节已与 ZIP 逐项比较相同。键鼠、暂停、声音、导出、导入、旧档保护与跨浏览器迁移统一见 [README](../../README.md#操作与进度)。

## 3. 工程检查

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

## 6. 剩余交付条件

1. **V05：设备与性能。** Chrome 当前设备上的生产继续与刷新预算已通过；同源码观察包两档各60秒帧率、60输入，以及普通移动 / 跟随镜头预算也已通过。原 Apple M1 / 8 GB、Windows i5-1135G7 / Iris Xe / 16 GB 仍缺设备证据，已询问用户是否以本机 M1 Pro / 32 GB 为本次基准，尚未收到答复。见[性能记录](performance.md)和[浏览器矩阵](browser-matrix.md)。
2. **V06：真实断外网。** 当前静态包与本地 HTTP 前置审计通过；断网后的正常刷新、进区、重试、保存恢复仍待实测。本次浏览器请求隔离未建立，已关闭任务标签及其DevTools；新默认规则清除、网络过滤文字恢复仍待稳定窗口，见[尝试与恢复边界](offline-build-audit.md#9-chrome-请求隔离尝试未建立任务标签已关闭)。见[离线验收步骤](offline-build-audit.md#5-真实断网验收步骤待执行)。
3. **Git 交付。** 本 Goal 使用用户指定的 `Agent-Model: gpt-6-astra`、`Agent-Effort: max`。M1–M5 实现提交的精确树、父提交、身份和消息见[回读证据](evidence/milestone-commits.json)。M5 实现候选已本地提交；用户已授权的最终推送 / PR 尚待收尾，未将缺少环境的必需项标为通过。

2026-09-11 17:06 后的实际界面状态：为停止请求隔离尝试，已关闭本任务Chrome标签及附属DevTools；此前可玩截图对应关闭前时刻。正式preview仍在固定5174运行，真实1109代存档与导出未改写。没有把目标关闭当作已删除浏览器保存的临时规则。
