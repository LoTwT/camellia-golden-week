# R1 冻结测试输入

三份JSON按原字节保留，不由测试或构建改写。两份完整状态图支持死角/恢复规则验证；M5主线档来自正常Chrome键鼠到仓库，不能作为新档通关的替代证据。原提交、原路径和SHA-256见[证据清单](../../../docs/verification/evidence/r1-archive-manifest.json)的 `retainedAt` 字段。

状态图只有显式 `scripts/author-r1-{capture,theft}-analysis.ts --write` 才能更新；`--check` 和普通测试只读。新增正常浏览器输出进入被Git忽略的 `test-results/`，不覆盖这些固定输入。
