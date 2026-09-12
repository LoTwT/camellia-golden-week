# 危险格箭头与菜单键盘修复

[文档索引](../index.md) · [操作说明](../../README.md) · [工程与交互合同](../spec/architecture.md#21-构图与交互) · [原警报规则 S12](../references/firewall-hazards.md)

2026-09-12，用户反馈“危险格箭头 UI 不够明显。菜单选择时无法用键盘交互”。修复基线为 `10941be2dc2cf4b66ade8adee582def7dacb1c5f`，开工工作区干净。规则、地图、奖励、计分和存档版本保持不变；本次范围是可读性与菜单交互。

## 已确认的根因

方向原来由 16–30px 字体字符表现，没有独立底色，按字体单位偏移到玩家旁边。1024×640 的实际画面中，细箭头与粉红玻璃、玩家耳部相邻，轮廓难辨。[旧画面](evidence/controls-readability/arrow-baseline.png)与[浏览器失败](evidence/controls-readability/arrows-red.log)记录实际警报出现时只有文本、没有矢量图形。新增的方向投影断言同样先在基线上以 `undefined` 失败，见[原生失败日志](evidence/controls-readability/projection-red.log)。

菜单只处理 Escape，Tab / Enter 依赖原生控件；没有游戏式方向键或 W/S 选项导航。所有设置 / 收集等面板的 Escape 都直接继续游戏，重建面板又总是聚焦首项。[原始 Chrome 检查](evidence/controls-readability/menu-baseline.json)实测启动、暂停、挑战、存档四类菜单 ArrowDown / W / S 无效，设置直接关窗，以及存档确认返回后选择丢失。历史 Tab / Enter 验收仍保留当时方法，不冒充已经覆盖本次发现的方向导航。

## 方向表现

权威投影输出每格的具名警报来向，渲染直接使用类型化方向。相同来向去重，交汇警报保留每个方向。可读文本仍保留在格子说明及标记中，显示不再依赖箭头字体。

箭头由本项目内联 SVG 绘制，24×24 画板、实心路径，按来向旋转；没有下载或打包新的原作资源。独立标记按当前电视格的 CSS 尺寸取 30%，限制为 36–48px 高，锚定屏幕右上边缘。活动警报使用浅底深箭头和实线，预告使用深底浅箭头和虚线；两态均使用固定底色，不靠闪烁或颜色单独传递状态。这个可读性补制与 S12 的原画面存在外观差异，不称作原版像素还原。

投影回归覆盖预告 / 活动 / 消失、交汇和同向去重、普通及减少效果。浏览器回归通过正常进入挑战后观察自然警报，检查标记与每个 SVG 的实际尺寸、方向旋转、屏幕边界、颜色对比和预告 / 活动线型；不修改位置、分数或时钟。非防火墙的谜题字母、图案与普通标记沿用原路径。

## 菜单交互

共用对话框增加方向键与 W/S 循环导航，Enter / Space 保留按钮的原生确认，Tab / Shift+Tab 继续切换所有控件。输入框、滑块、复选框和下拉框不截获原生编辑键；修饰键和输入法组合不触发导航。Esc 和重复确认在对话框内消费，避免关闭后同一事件继续触发底层游戏。

子面板按打开来源返回，父菜单恢复原选项，最外层关闭后恢复原控制点；不可聚焦的原控件使用画布作为回退。选择记忆仅保存控件身份，最多16个菜单，不保留已拆除 DOM 或无界历史。区域图禁用项、隐藏文件输入不参与导航；取消原生文件选择时恢复导入按钮。共同实现适用于启动、暂停、挑战选择 / 结果、设置、收集、存档与导入 / 导出 / 确认界面。

菜单提供14px操作提示与可见焦点。开发期交叉检查纠正了焦点背景变深但主按钮仍用深色文字的问题，实际 Chrome 随后又抓到背景过渡期间的浅底浅字。当前主按钮保持亮底深字，只强化轮廓，普通按钮使用深底浅字；浏览器长期回归检查主按钮对比度至少4.5:1，避免用截图观感代替颜色核对。新提示所需的“切”字已按固定字体源显式补齐，记录由[美术实施](../references/art-implementation.md)维护，构建仍只检查、不生成资源。

## 验证与交付

Node 24.18.0 / pnpm 11.25.0，Chrome 153.0.8010.36 / macOS 本机 M1 Pro。最终 [pnpm run verify 日志](evidence/controls-readability/verify.log)退出0：40个原生文件、516项测试；lint、格式、类型、核心依赖边界、固定内容与必需见证、只读构建、分期资源和完整 Chrome 管线通过。[只读指纹](evidence/controls-readability/verification.json)覆盖606个实现 / 测试 / 历史证据输入，前后完全一致。[冻结安装](evidence/controls-readability/install.log)复用既有 node_modules，依赖和锁文件未改，不称为全新目录安装。

| 检查         | 实际结果与证据                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 原生回归     | [方向投影](../../tests/firewall-feedback.test.ts)保留各方向 / 多来向 / 同向去重及预告状态；[菜单规则](../../tests/menu-navigation.test.ts)覆盖原生编辑键、循环边界、长按 / 修饰键与有界焦点记忆。516项全部通过                                                                                                                                                                                                                                  |
| 菜单正常键盘 | [Chrome 原始记录](evidence/controls-readability/menu-keyboard-results.json)：1366×768，140次按键、415条只读事件、9张截图、零页面 / 请求错误；四档选择、自然失败结果、返回焦点、跳过禁用项、正常导出与真实文件选择入口的取消 / 确认 / 无效文件处理；菜单前后与取消后完整载荷相同                                                                                                                                                                 |
| 菜单可见焦点 | 主按钮文字对比度11.98:1、轮廓3px，提示14px；[启动](evidence/controls-readability/menu-startup-focus.png)、[挑战选择](evidence/controls-readability/menu-challenge-selection.png)、[返回存档选项](evidence/controls-readability/menu-storage-restored-focus.png)、[自然失败结果](evidence/controls-readability/menu-result-selection.png)                                                                                                        |
| DOM边界夹具  | 同一真实导航模块在独立空白页检查 disabled / hidden / CSS隐藏 / inert / aria-disabled / tabindex=-1 跳过、wasdrz文本输入、多行Enter，以及同一事件两次重建只聚焦最终控件；只作为UI边界证据，不作为游戏通关                                                                                                                                                                                                                                        |
| 警报可读性   | [三种视口与模式](evidence/controls-readability/firewall-cue-results.json)：1512×771普通、1024×640静音且减少效果、1920×1080正式场景。自然预告、活动警报及双方向交汇全部满足标记≥36px、SVG≥24px、对比≥7:1、方向旋转 / 线型正确且不裁切。实际最小SVG26px；见[小视口](evidence/controls-readability/firewall-cue-reduced-alarm-directions.png)与[正式场景](evidence/controls-readability/firewall-music-levels-alarm-directions.png)                |
| 既有行为回归 | [完整管线](evidence/controls-readability/browser-results.json)：五分期正常启动 / 移动 / 导出 / 刷新，M5正常中心→A迷宫01→首物资，七项存档 / 音频 / 接线故障回归，v1全收集档和从冻结v2包正常获得的成绩经文件选择迁移后再游玩；正式三档47 / 57 / 72 Combo、45秒自然结算与刷新保持                                                                                                                                                                  |
| 性能专项     | [三档摘要](evidence/controls-readability/performance-summary.json)：同源码acceptance、1920×1080 / DPR1 / 标准画质，各约42.23秒有效采样，帧间隔p95 16.7 / 16.7 / 16.7ms；输入反馈p95 26.5 / 27.1 / 27.3ms、全部≤33.3ms。没有重做60秒密集机关或30次区域往返，不替代其历史记录                                                                                                                                                                     |
| 字体         | [固定源显式生成](evidence/controls-readability/font-generation.log)与[实际FontTools解码](evidence/controls-readability/font-verification.json)通过；所有829个源码字符覆盖，字体清单、许可和源文件哈希一致                                                                                                                                                                                                                                       |
| 静态交付     | [当前ZIP](evidence/controls-readability/controls-readability-dist.zip)，5,003,888字节，SHA-256 `952a4ca47ceecec450a18ac37c5e625b686b3f10cf60aa684d16d090716f372b`；[逐文件清单](evidence/controls-readability/package.json) 87文件 / 6,379,044字节，CRC及每文件与dist、Chrome验证的production相同；[5174 HTTP](evidence/controls-readability/http-audit.json) 88次200且字节一致；[复算脚本](evidence/controls-readability/reproduce-package.py) |

浏览器以正常键鼠完成游戏行为，只读观察DOM / 诊断时钟与正常导出；没有设置位置、分数、目标或门。旧档来自明确记录的真实历史导出；独立DOM和无效JSON仅用于对应边界。大体积trace留在忽略的test-results目录，路径 / SHA见[证据清单](evidence/controls-readability/browser-evidence-files.json)，没有把未跟踪trace误称为随包文件。运行中的用户5174页面和存档未被测试操作；该preview已服务本轮dist。

## 保留的失败与验证边界

- 首轮投影和旧包警报检查先失败，再由上述当前实现通过；旧HTTP包指纹见[基线复核](evidence/controls-readability/baseline-package.json)，它在失败后读取同一未变包，不冒充与截图同时采样。
- 菜单[第一轮](evidence/controls-readability/menu-current-1/menu-keyboard-results.json)在颜色过渡期间抓到主按钮对比不足，已修复；[第二轮](evidence/controls-readability/menu-current-2/menu-keyboard-results.json)的原生select选值断言未通过。无游戏脚本的[空白原生HTML](evidence/controls-readability/native-controls.mjs)、[headless](evidence/controls-readability/native-controls.json)、[headed](evidence/controls-readability/native-controls-headed.json)、[CDP](evidence/controls-readability/native-controls-cdp.json)与[原生Chrome CUA](evidence/controls-readability/native-cua-select.json)均未观察到选值改变。**画质原生下拉框的键盘改值仍未验证**；当前通过的是Tab可达、箭头 / Enter未被菜单消费，不能据此宣称原生弹出选择已通过。滑块与复选框的实际值改变已验证。保留原生控件，不以自动化选值API替代人工按键通过证据。
- [第四轮菜单记录](evidence/controls-readability/menu-current-4/menu-keyboard-results.json)全部菜单与DOM边界已通过，末尾新增的newPage / bringToFront没有在headless环境触发真实blur，等自动暂停超时；删除这条不成立的测试触发假设，运行时代码未因此改动。该轮失败和截图保留，未把它作为失焦通过证据。
- [首轮完整verify](evidence/controls-readability/full-run-1/verification.json)在516项和构建通过后，新游戏操作触发前台调度中断暂停；[截图](evidence/controls-readability/full-run-1/m5-failure.png)、[调用轨迹](evidence/controls-readability/full-run-1/trace-summary.json)保留。原脚本只在后续截图阶段处理启动暂停，较早的waitForGameReady无法返回。当前复用同一启动恢复函数，覆盖新游戏之后：必须可见 / 聚焦、明确clockGap、仍为0物资 / 未领增幅仪，整个首个移动前最多正常点击继续一次；稳定取样重新开始，运行中仍不自动恢复，250ms保护阈值不变。最终各profile真实恢复次数由各startup-preparation.json记录。

本轮为T08 / V01–V03补充对应专项，并复用完整工程与Chrome故障管线；原63项历史验收没有改称本次全量重验，原生select缺口明确保留。既有原作重建、音源差异、浏览器 / 硬件和断网范围见[当前交付](release-candidate.md)；本次没有修改其规则、内容或标准。发布继续使用[PR #1](https://github.com/LoTwT/camellia-golden-week/pull/1)，main未合并。
