# M5 静态交付包

2026-09-13 补充：[整个 PR 数据精简](pr-data-cleanup.md)已完成实现和完整验证。源数据改用无损表示，93 个正式构建文件与本页原发布 ZIP 逐字节一致，原 ZIP 继续有效；当前开发基线与新克隆数据见精简记录。

R1完整原始证据与静态ZIP改由[Release归档](r1-evidence-archive.md)分发；以下原发布提交与测量记录保留原时点含义，清理后的最新提交见PR提交列表；[清理完整复验](evidence/r1-cleanup-verification.json)确认游戏源码、资源与93文件正式产物字节不变。 [归档发布回读](evidence/r1-cleanup-publication.json)确认6附件重新下载一致，以及新克隆的冻结安装、682测试与构建通过。

2026-09-12 R1 连续实施已生成并验证当前交付包。当前结果见下节；更早的 M5 / 防火墙 / 菜单包与验证记录保留历史含义，不作为 R1 通过依据。

[文档索引](../index.md) · [操作与存档说明](../../README.md) · [验收结果](acceptance-results.md) · [实施进度](implementation-progress.md)

## R1 当前交付包

当前构建为 **0.5.0 / M5 / content6 / rule4 / schema3**，防火墙自身规则和成绩仍为v3。完整工程 `pnpm run verify` 退出0：682项原生测试、五profile生产产物与正常Chrome完整流程均通过。当前63项验收为62通过、V06不再要求，全部依据本轮证据。

- [R1静态ZIP](https://github.com/LoTwT/camellia-golden-week/releases/download/v0.5.0-r1/camellia-golden-week-r1-dist.zip)：5,059,941字节，SHA-256 `55c517e3a1c69d92f58e101baea38be2cbf1d17ec2f43d10ea0851267e945046`。
- [逐文件与归档核对](evidence/r1-original-package.json)：93文件／6,542,361字节，51项资源记录。CRC、每个解压文件与当前dist、Chrome实际验证production目录逐字节一致。
- [固定5174 HTTP核对](r1-evidence-files.md#e-65c0532c935873ea)：根入口与93文件共94次200，MIME及每文件字节一致。首次Python HTTP读取继承环境代理得到502，[记录](r1-evidence-files.md#e-4fb97401a7834302)保留；改为进程内直连loopback后通过，没有改preview或系统代理。
- [启动日志](r1-evidence-files.md#e-07ac215a8484758e)记录实际 `pnpm run preview --host localhost --port 5174 --strictPort`；[占用复验](r1-evidence-files.md#e-127ab6afac76c225)确认第二次启动明确失败，不切到其他端口。当前服务保留运行。

运行入口为 [localhost:5174](http://localhost:5174)。安装、操作与旧档保护见[README](../../README.md)，各项新版本证据见[R1验收表](r1-acceptance-results.md)。[最终工程日志](r1-evidence-files.md#e-f7e86a485d3b122e)和[浏览器结果](r1-evidence-files.md#e-57e15a6dc986bceb)已归档；[1696输入只读核对](r1-evidence-files.md#e-798c2f3a3261e1b1)为零变更。最终[包与HTTP复核](r1-evidence-files.md#e-9c2e93f399e72062)再次确认93文件、94请求及ZIP与最终dist/production逐字节一致。

[固定5174实际生产游玩](r1-evidence-files.md#e-7144e9eb775eb467)使用正常文件选择导入本轮M5真实全收集档，正常Right/Left移动后导出、刷新继续；26奖励/130物资、三盗取/四捕获与布局保持，继续140.24ms，errors0。测试使用独立Chrome context，未修改日常来源进度，生产包无验收接口。[可玩画面](evidence/r1-representative/production-5174.png)对应这一实际结果。

当前包有36图标、13音频和2字体。原图已证实形态、本版具名适配、补制资源与未测部分分别见[R1视觉对照](../references/r1-visual-comparison.md)。原生画质select键盘改值仍未验证，Tab/事件边界已验证；Safari、Edge、其他硬件和断网未列为当前通过。构建的650kB主JS提示保留，本机性能达到原预算。

R1 实现与验收已提交为 [a20d93a](r1-evidence-files.md#e-8f7e8ef9f435242e)，作者与提交者均为 `eruoos <github@eruoo.me>`，用户指定的本任务溯源为 `gpt-6-astra` / `max`。`eruoos` 已将该提交快进推送到同仓库 `codex/full-implementation`；`LoTwT` 回查远端精确OID一致，并更新 [PR #1：feat: restore R1 puzzles, maps and versioned progress](https://github.com/LoTwT/camellia-golden-week/pull/1) 的标题与正文。PR仍open、非draft，base main仍为 `bfb924b075aa6a153ed33b95ce4492260e18a8d9`，未合并。

[发布回读快照](r1-evidence-files.md#e-5ee388965c24cf6e)连同原始提交对象、推送结果和PR正文回读记录本次实现发布；随后仅提交本节及进度记录，不改变已验证游戏源码或ZIP。该快照不自称包含自己的后续文档提交，最新分支提交见[PR提交列表](https://github.com/LoTwT/camellia-golden-week/pull/1/commits)。

## R1 前交付记录（历史）

以下版本、“当前”措辞、包和通过数均保留其原执行时点含义。

2026-09-12：当前交付物为 **0.5.0 / M5 / content5 / rule3 / schema2** 的 production 构建，包含全部游戏内容。按[用户本轮范围调整](acceptance-scope-2026-09-11.md)，本机 Chrome 为验收环境，V05 达到原预算；63 个原始用例中 **62 项通过、V06 不再要求**。真实断外网、其他硬件与历史 Safari 结果不冒充已通过。实现分支 `codex/full-implementation` 从 `bfb924b075aa6a153ed33b95ce4492260e18a8d9` 建立；M1–M5 已按里程碑提交，M5 实现为 `811da5a1eb6ac175aa380418c2d84cf079469713`。游戏验收已按当前范围收口，实现分支已推送，[PR #1](https://github.com/LoTwT/camellia-golden-week/pull/1) 已创建，供用户审阅；main 尚未合并。

## 1. 当前静态交付物

当前包增加[危险格箭头与菜单键盘修复](controls-readability.md)：36–48px实心SVG、预告与活动线型；四方向 / W/S、Enter / 空格、Esc分层返回与焦点恢复。规则仍为v3，26奖励 / 130物资与旧档协议未变。当前专项的原生画质下拉框键盘改值未验证；其余菜单按正常键盘验证，历史62项通过统计不冒充全部新版交互重新通过。

- [完整静态ZIP](historical-evidence-files.md#file-f0cebbcff2ddab87)：5,003,888字节；SHA-256 `952a4ca47ceecec450a18ac37c5e625b686b3f10cf60aa684d16d090716f372b`。
- [产物与逐文件清单](historical-evidence-files.md#file-e0c3ebe0616f313f)：87文件 / 6,379,044字节；48条资源记录，CRC、dist与Chrome验证production字节一致。
- [固定5174 HTTP复核](historical-evidence-files.md#file-21c5282f1a7c4705)：共88次200、字节一致。
- [最终工程检查](historical-evidence-files.md#file-fcd1bf1d15bcd2ea)：40文件 / 516项、五分期、七项故障回归、防火墙三档47 / 57 / 72、v1/v2旧档迁移和140键菜单流程通过；606个所选实现及测试输入哈希不变。原生select、失败过程及覆盖边界见[专项记录](controls-readability.md#保留的失败与验证边界)。

### 前一轮警报、闪避与v3迁移包（历史）

当前包已完成[警报扣分、方向闪避与v3迁移](firewall-hazards.md)：普通错拍−1、警报接触−5，具名移动警报、有限迎向闪避、受击与减少效果反馈；v1/v2历史成绩和永久进度保留。

- [完整静态ZIP](historical-evidence-files.md#file-8355b84dae9664de)：5,002,112字节；SHA-256 `482f4bba7b8ac33fdcf9dd4dc57cadb88beece79d18256f01afba1308d2531e6`。
- [产物与逐文件清单](historical-evidence-files.md#file-2b68ac4a5b8271fb)：87文件 / 6,374,035字节；48条资源记录，CRC、dist与Chrome验证的production字节一致。
- [固定5174 HTTP复核](historical-evidence-files.md#file-147bee5386cc1620)：根入口及全部文件共88次200、字节一致。
- [最终工程检查](historical-evidence-files.md#file-de79be9b94fac68b)：510项、五分期、七项故障回归、防火墙三档47/57/72与v1/v2真实旧档迁移通过；547个所选实现及测试输入哈希不变。详细测量、失败修正与覆盖范围见[修复记录](firewall-hazards.md#验证与交付)。

原版−1/−5及迎向闪避依据见[S12](../references/firewall-hazards.md)；精确时间参数、完整警报排表和原版约70秒/60目标仍有明确差异。下面旧包与“当前”字样保留各自时点含义。

### 前一轮电视墙、配乐与v2迁移包（历史）

当前包已完成[防火墙原版还原与 v2 迁移](firewall-restoration.md)：中央 5×4 与四块 COMBO 电视、110 BPM 本地原创替代配乐及同步白光、PERFECT / MISS、危险预告；旧成绩归档，物资和主线进度保留。

- [完整静态 ZIP](historical-evidence-files.md#file-7a8273df3ab28de3)：4,995,583 字节；SHA-256 `88ca1a72a2381de703ef7c9bc98a0cc124df61b1b7da6d315e55c30a7341fbd1`。
- [产物与文件清单](historical-evidence-files.md#file-0c80f3eed969171f)：87 文件 / 6,344,521 字节，48 条资源记录，CRC / 当前 dist / Chrome production 构建字节一致。
- [固定 5174 HTTP 复核](historical-evidence-files.md#file-04c4e8fb3aba2f26)：根入口及全部文件共 88 次 200、字节一致。
- [最终工程检查](historical-evidence-files.md#file-aef1f5fe7dd05a2a)：484 项、五分期与七项故障回归全通过；三档正常键鼠 47 / 57 / 72 Combo、真实 130 物资旧档升级与性能专项均有证据。198 个实现输入哈希未变。

原版曲名与实测见 [S11](../references/firewall-audio.md)，补制配乐不是原录音；视觉与计分尚未证实部分仍明确标为重建。下面的旧包保留原时点含义。

### 前一轮周边节拍包（历史）

此前包包含[画面周边节拍补修](firewall-visual-cue.md#原版核对后的画面周边节拍补修)、首轮可读拍点与[消融Review修复](review-fixes.md)。防火墙画面周围白光随同一有效时钟亮起，在拍点达到峰值；减少闪烁关闭白光与面板亮暗变化，保留文字提示。版本仍为0.5.0 / M5，地图、奖励、内容 / 规则 / 存档版本和验收范围不变。

- [完整静态ZIP](historical-evidence-files.md#file-bbeebbb7f7dfb434)：解压后直接包含 `index.html` 和 `assets/`。
- [ZIP SHA-256](historical-evidence-files.md#file-fb188211e300195d)、[逐文件与归档校验](historical-evidence-files.md#file-3b930129f73b9126)。
- [最终验证日志](historical-evidence-files.md#file-82e5f2db2746dd7b)、[五分期及Chrome回归](historical-evidence-files.md#file-dcb1dbec219bf41b)、[本地HTTP审计](historical-evidence-files.md#file-090888aaec8b3388)。

| 项目         | 实际结果                                                                                        |
| ------------ | ----------------------------------------------------------------------------------------------- |
| ZIP          | 848,037字节；SHA-256 `8f3e4c324074d694d596d5d7da5db4447a3c1cd1eb89cb646b4464f87c3475df`         |
| 解压内容     | 84文件，1,681,345字节；CRC、当前dist与Chrome验证的production目录逐项字节一致                    |
| 文件清单指纹 | `42bbbbb164b92332b4816b3f0e846e5ac5096318e49dc7b76d26d0861ebfd9d7`；算法与逐项值见机器记录      |
| 应用入口     | `assets/index-BZ9TsFGT.js`，920,931字节                                                         |
| 本地资源     | 45条记录，78项内容及2项许可哈希匹配；33图标、两字体、十段声音随包提供                           |
| 生产排除项   | 无验收故障面板、只读快照或会话诊断入口；正式包隔离经过实际消融验证                              |
| 完整验证     | `pnpm run verify`退出0，464项原生测试、五分期Chrome流程、七项修复回归及两种静音拍点正常操作通过 |

字体按原配方补齐“白”，812个源码字符实际解码覆盖；构建检查保持只读，184个所选实现输入验证前后哈希相同。依赖和锁文件未改，干净冻结安装沿用相同锁文件的前次验证。已有固定5174 preview继续服务新包，85次回环直连HTTP字节与Content-Type核对通过。原650kB单JS警告保留。该短流程回归没有重新完成全收集或性能采样；下文原M5全流程与性能记录保留当时含义。

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

当前516项、菜单与箭头实测见[交互修复记录](controls-readability.md#验证与交付)。前次510项及v3实际浏览器结果见[警报修复记录](firewall-hazards.md#验证与交付)。前次484项及v2结果见[防火墙还原记录](firewall-restoration.md)。前次464项测试、五分期和画面周边拍点操作见[拍点补修](firewall-visual-cue.md#原版核对后的画面周边节拍补修)。前次458项和消融结果见[Review修复记录](review-fixes.md#4-完整验证与交付)。以下 npm 日志保留 M5 原交付时的实际执行方式；后续[pnpm 迁移记录](pnpm-migration.md)也保留迁移时点的锁文件和构建等价结论。

| 命令 / 检查      | 实际结果与原始证据                                                                                                                                                                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci`         | 退出 0，添加 33 / 审计 34 包，0 漏洞；[日志](historical-evidence-files.md#file-e24b453d59bea47a)。npm 提示可选 fsevents 安装脚本未运行；后续源修复未改锁文件                                                                                                                                      |
| `npm test`       | **411/411**，0 失败、取消、跳过、todo，2711.108416ms；[日志](historical-evidence-files.md#file-bbb7b5f9e82eaa01)                                                                                                                                                                                  |
| `npm run build`  | 退出 0，包含只读 lint、format:check、typecheck、validate:content 与 Vite 构建；[日志](historical-evidence-files.md#file-78fc8624171299c0)                                                                                                                                                         |
| 字体失败与修复   | 首次 build 检查发现两个新缺字并拒绝构建；[失败日志](historical-evidence-files.md#file-1d8f2f565ebee6af)保留，显式补字后才重建                                                                                                                                                                     |
| 固定端口 preview | 当前生产包实际在 `localhost:5174` 接受全部资源请求及 Chrome 正常操作；[恢复production记录](historical-evidence-files.md#file-68c79c688b894c5e)、[preview日志](historical-evidence-files.md#file-22ba3b1fe4a762dd)；端口冲突的历史实测见[记录](historical-evidence-files.md#file-dfd89572db47b2f9) |
| 静态资源 HTTP    | 84 文件及根 URL 共 85 次同源 200，Content-Type 和字节全部匹配；[机器记录](historical-evidence-files.md#file-76d5ac682129fa80)                                                                                                                                                                     |
| 实际 UI 导出载荷 | 十份新生产回归原文经当前 M5 语义校验，26 奖励 / 130 物资、四区数据各 100；[复核](historical-evidence-files.md#file-fd544b86c15a588f)                                                                                                                                                              |
| 同源码观察包     | 独立目录构建，生产目录未覆盖；[构建日志](historical-evidence-files.md#file-872343643180473b)、[源码与构建身份](historical-evidence-files.md#file-383902e8c92ea61c)。用于可见诊断计量，不冒充生产性能采样                                                                                          |

411 项包括新增的 6 项会话进度回归，使用真实旧导出、权威规则及存储适配器验证。此前 405、392、360 等日志保留对应时点结果，不能与本次数量相加。工程检查不替代浏览器正常游玩或指定设备实测。

## 4. 原M5 Chrome生产包回归（历史证据）

这组验证延续 M4 独立 Chrome 正常新档全收集链，没有注入游戏进度，也不另称一次新档全通关。

| 场景               | 正常操作与实际结果                                                                                                     | 证据                                                                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 占用会话的第二标签 | 真实导出 A / B 原始槽 947 / 946；返回或 Esc 后仍为会话占用提示，不能进入继续菜单                                       | [步骤与原文](historical-evidence-files.md#file-78ac2399e689602a)、[返回画面](historical-evidence-files.md#file-ccd89515fbfea9ca)   |
| 关闭原页后接手     | 重试取得会话；继续后 320ms 棋盘就绪，390ms 内真实 Left 移动且已保存；947 / 仓库7,0 → 948 / 仓库6,0，永久结果不变       | [计量与位置证明](historical-evidence-files.md#file-1c1bd827a4b29eae)、[接手](historical-evidence-files.md#file-4bc586ca30aea3ca)   |
| 刷新恢复           | 正常 Right 保存 949，刷新继续就绪 315ms；真实导出确认完整载荷和代数相同                                                | [恢复记录](historical-evidence-files.md#file-dc71f2d0f8736fc1)、[导出原文](historical-evidence-files.md#file-9c086cb21cf87352)     |
| 历史返回的旧内存   | 正常离开到 about:blank；另页真实移动保存 950；Back 后旧页仅能分别导出新原槽 950 和标注来源的旧内存 949，均返回占用提示 | [全过程与边界](historical-evidence-files.md#file-3e942a3ad5a72b16)、[来源提示](historical-evidence-files.md#file-db1f7fd055c09b40) |
| 生产回归末态       | 新持锁页正常回到仓库7,0，保存 951；26 / 130、48 个目标、9 个首次布局和 9 个成绩保留                                    | [实际导出](historical-evidence-files.md#file-b6539bba8ad3c6af)、[实际画面](historical-evidence-files.md#file-b4188e99a1a55944)     |

性能采样收尾后已恢复新production，正常刷新、继续、重复F访问仓库并导出，保持1109代 / 仓库7,0 / 26奖励与130物资，默认设置与永久结果不变。见[最终实际记录](historical-evidence-files.md#file-6d13f624d1c68fbf)、[可玩画面](historical-evidence-files.md#file-554c7f844988819c)和[当前载荷校验](historical-evidence-files.md#file-55de2bd03afac811)。

就绪时长是一次宿主调用内正常点击与 DOM 读取的墙钟间隔，包含工具往返；390ms 样本另由真实移动和保存证明可操作。生产包没有暴露 persisted 事件，历史返回只记录实际观察到的旧内存存活，不伪称读取了 BFCache 事件标志。完整新档与分期升级、故障注入范围见[验收结果](acceptance-results.md)。

同源码观察包另完成世界与密集机关各六步，移动完成分别104.7–110.4ms、104.4–110.9ms；世界样本的镜头实际达到目标。64格场景两档各60次正常输入，末7200帧窗口分别为60220.8/60228.8ms，中位均8.3ms、p95均9.3ms，输入p95为15.8/16.6ms。详细原文、方法和测量开销见[性能记录](performance.md)，此前Chrome30次区域往返的稳定资源证据仍有效。

## 5. 历史候选包

首轮[侧栏拍点修复ZIP](historical-evidence-files.md#file-496061eb4d74b00b)为847,638字节，SHA-256 `cf14a5a6da9121484abf9e782b9d92243a11a98fe334cc3f15db9538150716f2`，84文件 / 1,680,243字节。其463项测试和两种拍点操作保留[原记录](firewall-visual-cue.md#验证)含义；当前包进一步补齐原版已有的周边视觉节拍。

前次[Review修复ZIP](historical-evidence-files.md#file-32358b0cc72ce73b)为847,180字节，SHA-256 `e93b1f3b8e769d7e049c4e5264140b061caab82e2d747dffc6aebc0fa7d9c4b4`，其458项测试、五期和七项回归保留[原修复记录](review-fixes.md)含义；本次仅因新增可读拍点与字体补字而更新当前包。

原M5 Chrome交付包 [m5-chrome-release-dist.zip](historical-evidence-files.md#file-a68b083b831dbd7a) 为845,629字节，SHA-256 `62b119813a7d3269a95f30f4894e3f4efb5996ccabd054d5fe9acf7d1a888175`，84文件 / 1,674,897字节，入口 `index-BpL7y5kK.js` 917,896字节。其[逐文件记录](historical-evidence-files.md#file-b65a9409eb1d2533)及[构建审计](historical-evidence-files.md#file-76d5ac682129fa80)保持原样。该包加入失锁恢复入口和“副”“它”字体补字；pnpm迁移时重建的84个文件曾与它完全相同。本轮运行时修复后由第1节新包替代，不能把原包等价结论套用到当前源码。

先前 [m5-production ZIP](historical-evidence-files.md#file-3a1ee3f55b20ab48) 为 844,320 字节，SHA-256 `135d0a8c0fd00386989f46ff3361e95a920b37a18744b6d010b485e58b9e85b9`，入口 `index-BAHDLcEY.js`，84 文件 / 1,672,132 字节。其 [405 项测试](historical-evidence-files.md#file-7853d250c0ac415e)、[归档清单](historical-evidence-files.md#file-0b38f92fbf4292d0)及全部实际浏览器证据保持原样；该包已被第 1 节修复后的候选替代。

旧 Chrome 正式包重复结算和刷新保持 947 / 130，内嵌浏览器真实升级链保持 170 / 26。Safari 自身新档正常续玩到 B 首访 340 / 21，后因原生窗口不可用中断；后续导出确认载荷未变。详细结果见[历史 Safari 记录](safari-production-journey.md)。用户取消其必需验收后，不继续补齐，也不把历史未验证项改为通过。

## 6. 验收范围、限制与交付状态

- **本机基准通过。** 原M5交付时 Apple M1 Pro / 32 GB / macOS / Chrome 的生产继续、刷新，同源码观察包两档持续帧率、输入和移动 / 镜头，以及 30 次区域往返达到原预算。用户接受这台机器作为本次基准，V05 通过。原 M1 / 8 GB 与 Windows 基线仍未实测，其他机器出现实际问题后再修复；[性能记录](performance.md)保留方法与设备边界。
- **离线不再作为发布门槛。** V06 仍未真实验证，记为“不再要求”。静态资源与本地 HTTP 审计通过，不能据此宣称断网全流程通过。原步骤作为可选的后续方法保留于[离线核查](offline-build-audit.md#5-真实断网验收步骤待执行)。
- **美术与地图为明确记录的重建。** 无法确认原资产的适用发布条件，实际采用 33 个补制图标、10 段补制声音和两份本地许可字体；没有把候选库发现当作原资产授权。六类原参考、本版截图及差异见[视觉对照](../references/visual-comparison-m5.md)，固定坐标与可解见证由[来源索引](../references/index.md)串联。
- **DevTools 清理有环境限制。** 请求隔离未建立，任务标签及附属 DevTools 均已关闭；依据 Chrome 官方行为，该目标运行中的拦截已停止。持久默认规则删除及 Network 过滤文字恢复因 ScreenCaptureKit `-3811` 未完成，人工恢复方法与实际边界见[清理记录](offline-build-audit.md#93-取消离线验收后的有界清理尝试)。这不作为游戏故障，也不写成全部浏览器设置已恢复。
- **Git 交付已发布。** 本 Goal 的提交使用用户指定的 `Agent-Model: gpt-6-astra`、`Agent-Effort: max`，作者与提交者均为 `eruoos <github@eruoo.me>`。M1–M5 的精确树、父提交、身份和消息见[里程碑回读](historical-evidence-files.md#file-901b94c488fde2d0)，实际发布与 PR 见下节；未合并 main。

2026-09-11 的最终 Chrome 正常游玩导出为 1109 代，位置 `warehouse.t.7.0`，26 奖励 / 130 物资和默认设置保持。随后仅进行离线配置与清理尝试，没有发出游戏命令或覆盖进度；本任务的两个测试标签均已关闭，可玩截图对应关闭前时刻。正式 preview 继续在固定 5174 运行，重新打开本地入口即可选择继续。

## 7. 实际 Git 交付

[PR #1：feat: complete M1–M5 exploration and local progress recovery](https://github.com/LoTwT/camellia-golden-week/pull/1) 已由 `eruoos` 创建，状态为 open、非 draft，目标为 `LoTwT/camellia-golden-week:main`，来源为同仓库的 `codex/full-implementation`。读取与结果回查使用 `LoTwT`；没有切换持久登录、覆盖 main、推送标签或执行合并。

首次实现分支发布至 [005239b](https://github.com/LoTwT/camellia-golden-week/commit/005239b1621e1790f7e64d63a8945c4e13af37e4)，包含 M1–M5 五个实现提交与两次验收记录提交；创建 PR 后另将本节发布回读和链接补入同一分支，不改变游戏源码或静态包。精确首次发布、PR 作者 / 目标 / 来源和时间见[发布回读快照](historical-evidence-files.md#file-6bdc52d65fd59023)，最新提交以 [PR 当前 head](https://github.com/LoTwT/camellia-golden-week/pull/1/commits) 为准。

| 里程碑 | 实现提交                                                                                                 | 对应内容                                |
| ------ | -------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| M1     | [3c1c30c](https://github.com/LoTwT/camellia-golden-week/commit/3c1c30c62fd8d8700c5f11d6ed118273ea1c84a2) | 中心 / A、核心架构、26 物资与双槽存档   |
| M2     | [726317b](https://github.com/LoTwT/camellia-golden-week/commit/726317b009efdce20aaca61625c21701f468e3a6) | B、一笔画 / 杀毒、51 物资与 M1 升级     |
| M3     | [4068fb9](https://github.com/LoTwT/camellia-golden-week/commit/4068fb981fc6632867ad90319a81fcfba9e766b8) | C、球车 / 盗取、81 物资与恢复           |
| M4     | [dcc6307](https://github.com/LoTwT/camellia-golden-week/commit/dcc6307326d8aef80e8204ea348769fa8afe07f6) | D、回访、仓库、26 奖励 / 130 物资       |
| M5     | [811da5a](https://github.com/LoTwT/camellia-golden-week/commit/811da5a1eb6ac175aa380418c2d84cf079469713) | 视觉 / 交互精修、性能、浏览器与故障恢复 |

本次交付按[用户调整后的范围](acceptance-scope-2026-09-11.md)完成。第 6 节列出的未测设备、离线保证、美术重建与 DevTools 工具残留继续保留，不推定已消除。
