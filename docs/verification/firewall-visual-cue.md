# 防火墙拍点可读性修复

[文档索引](../index.md) · [当前交付包](release-candidate.md) · [验收结果](acceptance-results.md)

当前补修见[原版核对后的画面周边节拍补修](#原版核对后的画面周边节拍补修)。下列首轮463项和旧包记录保留当时含义。

2026-09-11，用户实际体验反馈“终端挑战，防火墙，没看到拍点”。修复基线为 `3a5d84fde4a9765a6137908054e9487ab3d1c0e4`。原实现只切换左侧 COMBO 框的边框和背景颜色，没有独立拍点标记，也未解释应该看哪里；教学没有危险格，更难从棋盘观察节奏。独立 Chrome 新档正常进入教学后的35帧采样证实框色变化和倒计时正常，但没有拍点文字或节拍条，见[原画面](evidence/firewall-cue/before.png)与[采样](evidence/firewall-cue/before.json)。用户当时页面只读检查后保持原状，没有替用户移动、刷新或覆盖存档。

## 实现

- 左侧挑战面板增加独立拍点条、拍数和22px状态文字：等待拍点、现在移动、本拍命中。中线标出拍点，带状区域显示有效窗口，光标从左向右经过。
- 判定提示直接读取固定内容中的 BPM、首拍、容错窗和权威有效时钟；已经计分的拍显示命中，不诱导重复计分。暂停 / 失焦、准备倒数和结算分别显示对应状态；离开挑战隐藏组件。
- 静音保留完整视觉提示；减少动态隐藏连续移动光标，仍用文字和边框区分等待 / 命中。没有全屏闪烁、CSS独立计时器或第二份评分状态。面板位于已有左侧空白区，不遮挡棋盘。
- 入场说明明确先选择档位开始，并解释左侧拍点条和单次按键。四个防火墙档位共用该组件；其他静态 / 实时挑战保留原有说明和计量方式。

实现位置：[节拍投影](../../src/ui/firewall-cue.ts)、[界面](../../src/ui/shell.ts)、[样式](../../src/ui/style.css)。规则、地图、奖励和存档协议未修改。新文案的“束”按原字体配方补齐，实际解码覆盖811个源码字符；[字体记录](evidence/firewall-cue/font-verification.json)与[美术来源](../references/art-implementation.md#5-字体与声音)维护来源与校验值。

## 验证

[五项规则对照测试](../../tests/firewall-cue.test.ts)覆盖四档首末判定窗的前一毫秒、含边界和超界；以真实 `advanceRealtime` 评分作为对照，另验证不同内容参数、已计分拍、暂停 / 恢复倒数和结算。提示窗口与实际可得分时间一致，没有改动120BPM / ±150ms合同。

[Chrome验证](../../scripts/browser/firewall-cue.ts)从新游戏用正常键鼠到A防火墙，按可见的“等待→现在移动”变化逐次输入。分别在1512×771普通模式和1024×640静音＋减少闪烁＋减少动态模式完成14次有效移动，等待自然结算后教学成功；不读取内部时钟驱动按键，不注入位置、分数、目标或门。两例均检查暂停时拍数冻结、恢复3秒准备、文字尺寸、侧栏边界和退出后隐藏，已接入 `pnpm run test:browser` / `pnpm run verify`。

[普通模式](evidence/firewall-cue/firewall-cue-standard.png) · [减少动态与静音](evidence/firewall-cue/firewall-cue-reduced.png) · [正常完成教学](evidence/firewall-cue/firewall-cue-reduced-completed.png) · [机器结果](evidence/firewall-cue/firewall-cue-results.json)

最终 `pnpm run verify` 退出0：463项原生测试、五分期正常流程、原七项回归和新增两种拍点操作全部通过；185个实现输入在验证前后哈希相同。[完整日志](evidence/firewall-cue/verify.log)、[结果](evidence/firewall-cue/verification.json)、[Chrome全记录](evidence/firewall-cue/browser-results.json)已归档。84个静态文件与Chrome实测production字节一致，[新ZIP](evidence/firewall-cue/firewall-cue-dist.zip)为847,638字节，[归档校验](evidence/firewall-cue/package.json)和[85次固定5174 HTTP核对](evidence/firewall-cue/http-audit.json)通过。没有更改依赖，冻结安装沿用前一修复的相同锁文件验证记录。此前63项历史验收、全收集与性能结果保持当时含义；本轮新增的是T08 / V03的实际可读性和操作回归，不宣称再次完成全部游戏验收。

## 原版核对后的画面周边节拍补修

用户随后要求核对原规则并修复。基线 `aebd63f` 已有侧栏提示，但 `GameShell.update` 只更新侧栏节点；挑战画面本身没有周边灯光来显示节拍。因此首轮检查虽然证明文字可用于游玩，仍未覆盖原版已有的画面周边视觉提示。[原版S10教学的定位与实际核对边界](../references/index.md#12-原版防火墙视觉节拍补核2026-09-11)是本次表现参考；不将本版时序参数当成原版测量。

补修内容：

- 挑战画面四边增加5px白色光框和局部内发光，中心棋盘内容保持可见。亮度由同一 `firewallCue` 计算：有效窗内从35%向拍点峰值100%变化，再回落；窗口外熄灭。同拍命中后仍保持同一光线节奏，没有CSS独立时钟或计分状态。
- 暂停、失焦待恢复、准备倒数和结算关闭白光，离开防火墙隐藏节点。覆盖层 `pointer-events: none`，不接管棋盘输入。
- 减少闪烁关闭周边白光及原有面板的亮暗切换，用固定底色下的“等待拍点 / 现在移动 / 本拍命中”文字提示；减少动态继续隐藏滑动光标。静音不影响任何视觉提示或规则。
- 入场与README说明看画面周围白光或侧栏文字跟拍。新增“白”字按原固定OTF和工具配方补入本地字体；地图、得分、通过条件、声音文件和存档协议没有变化。

回归先在原5174旧包上实跑：新增“挑战画面必须有随拍点亮起的周边白光”断言以0个节点失败，见[红灯日志](evidence/firewall-perimeter/red.log)和[旧画面](evidence/firewall-perimeter/before.png)。同一仓库脚本随后在修复包通过；最终脚本又在隔离服务的旧ZIP上确认相同断言失败，精确测试哈希和旧包指纹见[红绿对照](evidence/firewall-perimeter/red-green.json)及[最终红灯日志](evidence/firewall-perimeter/red-final.log)。六项定向单测覆盖四档窗口、峰值、命中、暂停、倒数与终点。两种Chrome正常新档教学都已在静音下取得14次命中并自然成功，普通模式观察真实白光亮度后按键，减少闪烁模式依文字按键；暂停恢复及退出隐藏同样通过。最终完整管线和静态包归档已完成，结果如下。

同类接线检查覆盖 `firewallCue` 的唯一调用点、四档共享的界面分支和 `audio.syncFirewall`；白光与侧栏共用投影，音频仍读取原规则时钟。其他两类实时挑战没有节拍机制，无须新增该光效。

最终 `pnpm run verify` 退出0：464项原生测试、五分期Chrome正常流程、七项既有回归及两种静音防火墙流程全部通过，184个本次纳入检查的源码 / 脚本 / 测试 / 资产和工程入口哈希在运行前后相同。普通模式的14个亮灯样本均达到至少60%不透明度，两拍之间均为0；减少闪烁模式亮灯样本全部为0，同时完成相同14次有效输入。

[完整日志](evidence/firewall-perimeter/verify.log) · [机器结果](evidence/firewall-perimeter/verification.json) · [逐拍亮度与操作记录](evidence/firewall-perimeter/firewall-cue-results.json) · [普通模式](evidence/firewall-perimeter/firewall-cue-standard.png) · [减少闪烁模式](evidence/firewall-perimeter/firewall-cue-reduced.png) · [自然结算成功](evidence/firewall-perimeter/firewall-cue-reduced-completed.png)。

当前[ZIP](evidence/firewall-perimeter/firewall-perimeter-dist.zip)为848,037字节，84个文件与dist及Chrome实际production构建逐项一致，CRC与SHA-256通过；[归档记录](evidence/firewall-perimeter/package.json)和[固定5174的85次HTTP核对](evidence/firewall-perimeter/http-audit.json)通过。HTTP工具首次因本机代理未排除localhost而收到502，显式使用仅本进程的回环直连后全部200，没有修改系统代理。固定服务无需重启，已有浏览器页面和进度未操作。依赖与锁文件未变；冻结安装沿用原相同锁文件的验证。此次不重跑全部63项、全收集、原版时序测量或历史性能采样。
