# 世界路线的存储格式

`m1.json` 至 `m4.json` 保留历史路线，`r1-world.json` 保留显式编写并验证的 R1 路线。消费者导入同名 `.ts` 模块，获得原有的逐步 `steps`、元数据、终点期望和续玩记录。加载、测试和构建只展开数据，不重新求解或写回路线。

历史 JSON 使用 `world-witness-runs-v1`。`commands` 按具名键保存公开命令；每条路线用 `runs` 表达连续重复，数组位置固定为：

```text
[首步绝对 atMs, 命令键, expectedCode]
[首步绝对 atMs, 命令键, expectedCode, 次数, 间隔毫秒]
[绝对 atMs, 命令键, expectedCode, 1, 0, checkpoint]
```

例如 `[100, "Tick", "accepted", 3, 100]` 展开成在 `100`、`200`、`300` 毫秒分别调度的三个 Tick。不能改成一次 300 毫秒的 Tick。命令或期望变化会开启新 run；检查点独占一步；每条 run 保留绝对起点，因此续玩路线原有时间也不会归零。

`compact.ts` 负责这种单层表示的编解码，拒绝未知命令引用、倒退或溢出的时间、非法次数、超出既有每条路线 20,000 步上限以及重复检查点。游戏命令和期望的业务语义仍由现有内容验证及重放验证负责。没有递归片段、分支或运行时求解器。

R1 使用 `world-witness-prefixes-v1`，在同一种 run 表示上增加可选的 `prefix: { witnessId, runCount }`。它引用本文件中前面已声明路线展开后的前 `runCount` 条 run，再拼接自身 `runs`；引用的是 run 数而非游戏步骤数。时间保持绝对值，引用不改变 profile、期望或其他元数据。整条路线也可引用，此时自身 `runs` 为空。`prefixes.ts` 顺序展开，拒绝重复 ID、未知、自身或向后引用及越界长度，再由原解码器核对总步数和跨前缀边界的时间顺序。此格式只用于 `witnesses`，不接受 `continuations`；历史续玩继续使用原格式。

五份文件另有 `expectationLists`，格式为 `world-witness-expectation-lists-v1`。`completedObjectiveIds`、`absentObjectiveIds`、`claimedRewardIds` 各有独立的有序数组池；路线终点、续玩终点和 run 检查点中的对应字段可以写为该字段池的整数索引，也可保留原字符串数组。只有同文件、同字段重复出现且至少含两个 ID 的列表才共享，不排序、不跨字段混用，也不从游戏状态计算期望。所有引用展开为独立数组；其他元数据即使含同名字段也保持原值。

消费者先经 `expectation-lists.ts` 恢复列表，再展开可选的 R1 前缀，最后恢复逐步命令。列表层拒绝未知格式、缺失或损坏的池、负数 / 小数 / 越界索引和非字符串列表。这里仅改变存储表示，所有检查点和终点的完整断言仍会执行。

R1 作者入口仍为 `node scripts/author-r1-witnesses.ts --write`，先编码 runs，再选择前面路线中完全相同的最长前缀，最后共享期望列表。少于八条 run 不提取前缀；等长候选取先出现的一条。不执行递归片段、时间偏移或路线求解。作者操作后运行定向格式化和既有验证。

`tests/fixtures/world-witness-digests.json` 保存首次转换前五份原文件 SHA-256，以及对象键排序、数组顺序不变后完整展开数据的 SHA-256。测试使用该独立基准覆盖所有 38,891 个步骤和元数据；不能因为编码器或引用格式改变就自动刷新基准。若有意更改路线，须独立审查行为变化，再更新对应基准。
