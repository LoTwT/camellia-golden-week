# 防火墙拍点可读性修复

[文档索引](../index.md) · [当前交付包](release-candidate.md) · [验收结果](acceptance-results.md)

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
