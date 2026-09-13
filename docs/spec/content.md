# 内容与数据合同

[文档索引](../index.md) · [主规格](overview.md) · [玩法](gameplay.md) · [工程与存档](architecture.md) · [验收](acceptance.md) · [来源](../references/index.md)

> 当前修订：2026-09-12 非防火墙还原规格 R1。固定内容、规则与版本迁移实施集成中，待新一轮完整验收；来源与具名适配见 [S13](../references/restoration-audit-2026-09-12.md)、[地图冻结](../references/r1-map-mechanism-evidence.md)和[杀毒冻结](../references/r1-antivirus-rules.md)，版本实施见[迁移记录](../verification/r1-migration.md)，执行状态见[实施进度](../verification/implementation-progress.md)。历史基线 `7fe7d8e` 不代表当前工作区内容。

本文件规定可实现的逻辑拓扑、账本与数据字段，不提供未经测绘的原地图坐标。所有 ID、分配和数量为本版设计。正式关卡必须使用固定数据，不在运行时随机生成。

## 1. 场景与逻辑拓扑

场景 ID 为 `hub / a / b / c / d / warehouse`，其中仓库的统计归属为 `hub`。局部挑战有自己的 `boardId`，不能与外层坐标混用。下表是必须保持的依赖和空间组织，不声称地图朝向、格数或逐格路径与原作相同。

| 场景 | 必需骨架 | 支路与回环 | 出口要求 |
| --- | --- | --- | --- |
| 中心 | 出生 → 增幅仪领取点 → 教学富集节点 → A 入口；展示四区数据的仓库门位于可回访位置 | 已激活区域传送点汇总，后期仓库入口 | 教学前后均可打开菜单，不能要求离开空洞升级增幅仪 |
| A | 入口传送点 → 路线富集节点 → 迷宫 01 → A 主终端 | 首访分叉分别可达迷宫 02、迷宫 03、清理终端、防火墙终端；回访门连接独立末端数据支路 | 主终端开放 B；主路径与首访各支路可返回入口；回访门不截断主路 |
| B | 入口 → 一笔画 01 → 捷径按钮 → B 主终端 | 首访分叉可达一笔画 02、北 / 南数据终端、杀毒终端；回访支路在独立门后 | 按钮形成往返捷径；C 入口不在杀毒奖励门后 |
| C | 入口 → 第一组推车捕获 → C 主终端；沿用 `c.routing.01` 主路径事件 | 三个独立数据盗取终端依次解锁后三组捕获推车；侧路终端与既有物资支路保留 | 第一组预置推车，不依赖盗取；后三组捕获不阻挡 D / 开库；所有推物限制在可重置边界内 |
| D | 入口分出四条权限路线；01 含幽灵段 01，02 含幽灵段 02；03 含观察揭路，04 含富集节点 | 第五条隐藏数据支路由入口可达观察点揭示；幽灵段全清后可达额外物资点 | 四权限路线无相互门禁；全部能返回入口；集齐即开 A / B 回访 |
| 中央仓库 | 中心仓库门 → 固定安全通路 → 最终终端 | 返回中心的稳定路径；无动作战斗 / 强制退出 | 最终终端结算后可以返回四区 |

这里将 D 组织为两个幽灵段是本版内容基线；原活动不只两个幽灵区域；本版已选择的两图与周期适配见[地图冻结 §7](../references/r1-map-mechanism-evidence.md#7-d-幽灵灯与四权限)，未获证据的全局拼接仍须单列适配。主路径线条可以包含更多装饰和普通地板，但不可增添表外的开库前置。

R1 要求按原证据替换已确认不同的局部布局：A 三迷宫各自转录的8×5核心及外接入口，B 两一笔画各15地板 / 六目标、杀毒核心5×4，C 盗取独立面板与四组捕获空间，D 带砖墙的幽灵迷宫。三间迷宫、两条一笔画、C / D 各组及世界连接分别记录坐标来源；已有局部截图不能证明完整世界。未知连接可以具名重建，但不得继续沿用与已确认原图冲突的尺寸、物体职责或安全捷径来通过还原验收。

每个新增分支同时定义进入与返回方式。房间是当前区域的子空间；终端小游戏结束返回外层原终端格。地图尺寸由转录决定，发布预算为单场景最多 2,048 个实际格、单静态房间最多 256 格；终端局部棋盘额外限制在 9 列 × 9 行内，以完整展示且保持点击尺寸。超出预算时先提交可读性 / 性能证据并修订预算，不能截掉地图悄然通过校验。

## 2. 目标、数据与门的稳定 ID

存档保存已完成的**事件目标**；数据节点通过 `completionObjectiveId` 引用事件目标，数据节点本身不保存第二份完成布尔值。主路径完成、区域数据、门开放均从同一集合派生。

| 数据节点 ID | 完成事件目标 / 触发来源 | 权重 | 最早收录 |
| --- | --- | --- | --- |
| `a.data.main` | `a.main`：A 主终端 | 20 | M1 |
| `a.data.maze02` | `a.maze.02`：迷宫 02 成功 | 20 | M1 |
| `a.data.maze03` | `a.maze.03`：迷宫 03 成功 | 20 | M1 |
| `a.data.side` | `a.side.terminal`：侧路清理终端 | 20 | M1 |
| `a.data.revisit` | `a.revisit.terminal`：回访终端 | 20 | M4 |
| `b.data.main` | `b.main`：B 主终端 | 20 | M2 |
| `b.data.line02` | `b.line.02`：一笔画 02 成功 | 20 | M2 |
| `b.data.north` | `b.north.terminal`：北侧终端 | 20 | M2 |
| `b.data.south` | `b.south.terminal`：南侧终端 | 20 | M2 |
| `b.data.revisit` | `b.revisit.terminal`：回访终端 | 20 | M4 |
| `c.data.main` | `c.main`：C 主终端 | 20 | M3 |
| `c.data.theft01` | `c.theft.01`：盗取 01 成功 | 20 | M3 |
| `c.data.theft02` | `c.theft.02`：盗取 02 成功 | 20 | M3 |
| `c.data.theft03` | `c.theft.03`：盗取 03 成功 | 20 | M3 |
| `c.data.side` | `c.side.terminal`：侧路终端 | 20 | M3 |
| `d.data.permission01` | `d.permission.01`：权限 01 终端 | 20 | M4 |
| `d.data.permission02` | `d.permission.02`：权限 02 终端 | 20 | M4 |
| `d.data.permission03` | `d.permission.03`：权限 03 终端 | 20 | M4 |
| `d.data.permission04` | `d.permission.04`：权限 04 终端 | 20 | M4 |
| `d.data.hidden` | `d.hidden.terminal`：隐藏数据终端 | 20 | M4 |

所有事件目标有唯一产生者或显式聚合条件。`a.main / b.main / c.main` 的前置以 [主规格](overview.md) 为准；`d.main` 为四个权限目标全真时的派生事件，`d.ghosts.cleared` 为 `d.ghost.01 / 02` 均成功时派生。`hub.tutorial`、`warehouse.complete`、各挑战成功也是稳定目标，不凭 UI 文案或地图坐标识别。

计分挑战的稳定 ID 为 `a.firewall.tutorial / inner / deep / core` 和 `b.antivirus.light / medium / heavy`（斜线后的名称沿用同一前缀）。每项首次成功产生同名 ObjectiveId；访问终端分别为 `a.firewall.access`、`b.antivirus.access`。其他既有挑战沿用 `a.maze.* / b.line.* / c.theft.* / d.ghost.*` 的固定编号，不因界面中文名改变。

R1 新增 `c.capture.01 / 02 / 03 / 04` 的 RoomId、ChallengeId 及各自捕获完成 ObjectiveId。第一组在同一成功事务额外产生兼容事件 `c.routing.01`，其唯一新生产者为第一组捕获，不再由旧球入站条件产生；后续三组分别要求 `c.theft.01 / 02 / 03` 解锁推车。捕获目标不列入五项区域数据，不创建 RewardId，也不加入仓库条件。旧 `c.routing.01` 房间 / 挑战定义只用于旧内容视图和迁移；旧已完成事件保留，不自动补写新捕获完成记录。具体玩法及原流程适配见[玩法 §8](gameplay.md#8-c-区推车捕获与数据盗取)。

主路径、回访、仓库门的 gate 类型只允许 `always / objective / capability / all / areaDataComplete`，字段分别是目标 ID、能力 ID 或子条件列表；无任意脚本、字符串表达式、`eval`、系统日期、网络状态、物资消费或否定永久目标。空的 `all` 不合法，需要无条件时写 `always`。

`areaDataComplete` 只能用于中央仓库门；其他门引用具体前置目标。能力只包括中心取得的增幅仪及教学后无限使用状态，不能在未来区域另造必需能力。全图门、开图组和数据引用都必须能追溯到有限的初始状态或事件目标。

## 3. 物资账本

本版固定 **26 条奖励记录，130 单位物资**。奖励记录不是原作宝箱坐标数；一条可以表现为一个含 5 单位的箱子。全部量值为正整数。无需丁尼、商店或第二种经济货币；前期草案的可选丁尼计数不进入 v0.1，以减少无用途界面和存档字段。

`pickup` 指在已开放物资格踩踏领取，`grant` 指成功事务内直接登记。表中的成功只解锁 pickup，仍需走到它所在格才增加物资；数据可在机关成功时先取得。

| 奖励 ID | 统计区 | 数量 | 领取方式 / 前置 | 收录 |
| --- | --- | --- | --- | --- |
| `hub.supply.tutorial` | 中心 | 1 | grant，`hub.tutorial` | M1 |
| `a.supply.maze01` | A | 5 | pickup，迷宫 01 出口安全侧 | M1 |
| `a.supply.maze03` | A | 5 | pickup，迷宫 03 出口安全侧 | M1 |
| `a.supply.firewall.inner` | A | 5 | pickup，内层成功开启的门后 | M1 |
| `a.supply.firewall.deep` | A | 5 | pickup，深层成功开启的门后 | M1 |
| `a.supply.firewall.core` | A | 5 | pickup，核心成功开启的门后 | M1 |
| `a.supply.revisit` | A | 5 | pickup，A 回访终端交互后 | M4 |
| `b.supply.line01` | B | 5 | pickup，一笔画 01 出口 | M2 |
| `b.supply.line02` | B | 5 | pickup，一笔画 02 出口 | M2 |
| `b.supply.antivirus.light` | B | 5 | pickup，轻度成功开启的门后 | M2 |
| `b.supply.antivirus.medium` | B | 5 | pickup，中度成功开启的门后 | M2 |
| `b.supply.antivirus.heavy` | B | 5 | pickup，重度成功开启的门后 | M2 |
| `b.supply.revisit` | B | 5 | pickup，B 回访终端交互后 | M4 |
| `c.supply.route.entry` | C | 5 | pickup，主图机关入口侧的可达收集支路 | M3 |
| `c.supply.route.exit` | C | 5 | pickup，`c.routing.01` 完成后的安全出口侧；R1 由第一组捕获承接 | M3 |
| `c.supply.theft01` | C | 5 | pickup，盗取 01 成功开启的门后 | M3 |
| `c.supply.theft02` | C | 5 | pickup，盗取 02 成功开启的门后 | M3 |
| `c.supply.theft03` | C | 5 | pickup，盗取 03 成功开启的门后 | M3 |
| `c.supply.side` | C | 5 | pickup，C 侧路终端交互后 | M3 |
| `d.supply.permission01` | D | 5 | pickup，权限 01 终端安全侧 | M4 |
| `d.supply.permission02` | D | 5 | pickup，权限 02 终端安全侧 | M4 |
| `d.supply.permission03` | D | 5 | pickup，权限 03 终端安全侧 | M4 |
| `d.supply.permission04` | D | 5 | pickup，权限 04 终端安全侧 | M4 |
| `d.supply.hidden` | D | 5 | pickup，D 隐藏数据终端交互后 | M4 |
| `d.supply.ghosts` | D | 5 | pickup，两幽灵段均完成后的安全侧路 | M4 |
| `hub.supply.final` | 中心 | 9 | grant，`warehouse.complete` | M4 |

校验恒等式：中心 1 + 9 = 10；A / B / C / D 各 6 × 5 = 30；合计 130。按收录版本过滤后 M1 / M2 / M3 分别为 26 / 51 / 81。A / B 的每个回访包各新增 5，D 新增 30，仓库新增 9，因此 M3 到 M4 增加 49。

奖励单位与计分相互独立。不给“高于原最佳分”的额外物资，不按重试次数扣物资。已领取集合是唯一事实来源，UI 数字及导出摘要是派生值。

四组捕获的演出与局部完成反馈不得额外发放物资。后三组即使尚未捕获，其已完成盗取解锁的既有物资格仍应可达；不把捕获暗加到本表前置。若以后要恢复原版捕获奖励分配，须单独说明与本表的冲突并由用户确认，本次 R1 不改变账本。

## 4. 静态内容模型

实现使用 TypeScript 可辨识联合定义运行时类型，JSON 作为可转录的内容载体。类型检查不代替 JSON 运行时校验。所有对象拒绝未知 `kind`、非法 ID、非有限数值和缺失字段；字段中不嵌脚本。以下为数据接口合同，非本轮代码。

| 数据类型 | 必需字段 | 约束 |
| --- | --- | --- |
| `WorldDefinition` | `gameId, contentVersion, ruleVersion, areaIds, entry, objectives, dataNodes, rewards, gates, releaseProfiles` | `gameId` 固定项目名；版本与内容清单对应 |
| `ReleaseProfile` | `id, includedAreaIds, includedRoomIds, includedObjectiveIds, includedRewardIds, scopeTerminalObjectiveId, fullCampaign` | M1–M3 为 false，M4 起为 true；派生分母，不手写第二套奖励数 |
| `AreaDefinition` | `id, statsAreaId, tileIds, roomIds, entryTileId, teleportId, entityIds, revealGroups, sourceRecordIds` | 场景 / 统计区分开；入口为永久安全可通行格 |
| `TileDefinition` | `id, boardId, x, y, terrain, initialDiscovery, etherGroupId, overlayIds` | 坐标整数且同 board 唯一；世界为 floor / wall；盗取局部新增 buffer，玩家可走、组件不可进入；无以太组时显式为空 |
| `EntityDefinition` | `id, kind, tileId, gateId, params, effectBundleId, sourceRecordIds` | gate 无条件也写明；按 kind 验证参数，不允许不同类型自由混用 |
| `RoomDefinition` | `id, areaId, boardId, mode, entryTileId, returnTileId, successExitTileId, resetState, goal, effectBundleId, witnessIds` | 局部状态域明确，失败出口安全，不能写房间外的可逆对象 |
| `ObjectiveDefinition` | `id, kind, producer, prerequisites, includedFrom` | kind 为 route / puzzle / terminal / challenge / aggregate / ending；只有 aggregate 可由其他目标派生 |
| `DataNodeDefinition` | `id, areaId, weight, completionObjectiveId, includedFrom` | 完整四区各 5 项、weight=20；每项只引用一个完成目标 |
| `RewardDefinition` | `id, statsAreaId, units, claimMode, producerId, prerequisites, includedFrom` | producer 为物资格对象或事务目标；每个 ID 只能有一个权威领取入口 |
| `EffectBundle` | `id, completeObjectiveIds, grantRewardIds, revealGroupIds, clearEtherTileIds` | 开门由目标派生；物资格奖励不放入 grant 列表；全部引用闭合 |
| `ChallengeDefinition` | `id, kind, boardId, entry, rules, goal, effectBundleId, ruleVersion, witnessIds` | 新目标 kind 为 memory / firewall / oneStroke / capture / theft / ghosts / antivirus；routing 仅旧内容视图保留；规则参数按类型区分 |
| `SourceRecord` | `id, urlOrPath, locator, checkedAt, evidenceLevel, supportedClaim, limitation, adaptedElementIds` | locator 用章节或视频时间段；只有实际测量才记录帧 / 坐标证据 |
| `Witness` | `id, profileId, contentVersion, ruleVersion, initialStateId, commands, expectedObjectives, expectedRewards, expectedFinalState` | 命令含顺序及实时有效毫秒；不能直接写进度，终态比较排除渲染数据 |

ID 只用小写 ASCII、数字、点、短横线，在各类型目录内唯一，引用字段明确指向哪一目录。相同逻辑名可分别用作 RoomId、ChallengeId 和其完成事件 ObjectiveId，通过 producer 显式绑定；它们不是可互换的类型，也不从同名关系自动推断完成。改显示名或移动对象不改 ID。任何 ID 删除 / 重命名都属于存档兼容变更，须提供显式映射，不能重新分配旧 ID 表示别的奖励。

### 4.1 机关参数

| kind | 专属必需参数 |
| --- | --- |
| nexus | `clearsTileIds, revealsGroupIds, capabilityRequired, completionObjectiveId`；只影响指定集合 |
| terminal / switch / observer | `interactionMode, prerequisites, effectBundleId`；分别为当前格 F / 显式观察 |
| door | `gateId, closedBlocksMovement, lockedReasonKey`；条件开门锁存 |
| teleport | `destinationAreaId, destinationTileId, activationObjectiveId`；不按坐标推断双向配对 |
| memory | `safeTileIds, hazardTileIds, startTileId, exitTileId, previewMs`；安全与危险不重叠 |
| oneStroke | `requiredTileIds, startTileId, endTileId`；六目标含终点、不要求含起点；所有地板可走，实际不重复路径须从起点经全部目标到终点 |
| capture | `cartIds, bangbooIds, initialCartTileById, initialBangbooTileById, escapeRules, captureConditions, cartUnlockObjectiveId`；第一组无盗取前置，后三组按 §2 对应；逃路、触发与顺序须显式且可重放 |
| theft | `ballIds, baseStationIds, amplifierIds, powerPortIds, initialBallTileById, initialStationTileById, portTileById, componentCompatibility, portCompatibility, bufferTileIds, interactionRules`；组合体 ID 预先稳定分配、初始未组装；匹配关系与身份分开，不能把旧 object / socket 当成新模型 |
| firewall | v3：`durationMs, bpm, firstBeatMs, windowMs, comboTarget, offbeatPenalty, beatCount, hazardPenalty, dodgeWindowMs, alarms`；警报含 `id, startsAtMs, endsAtMs, approachFrom, frames[{atMs,tileIds}]`；方向与时间均固定、至少一条正常方向键达标见证；v1/v2 历史定义保留 `beatMasks`，不能用警报数量充当拍数 |
| antivirus | `durationMs, completionRules, maxActiveCorruption, countedTargetKinds, overflowResolution, targetRules, spawnPlan, occupiedSpawnPolicy, eventOrder`；逐档冻结并附来源或具名适配；实例仍有唯一 ID，仅生命周期已按主规格 §2.1 冻结的类型才定义 expiresAtMs；不得把全部目标设短 TTL 规避超限 |
| ghosts | `ghosts, lamps, playerStepMinMs, exitTileId`；ghost 含路径 / 步间隔 / 初始索引，lamp 含明确 `ghostIds`；规则4另有顶层 `walls`，无墙时显式空数组，不与可走 `tiles` 的ID / 坐标重叠 |

门和富集节点不通过“相邻几个格子”推导目标；逐项引用防止误开同区另一组门。静态目标条件按布局计算，不能只存一个标准答案字符串。

上述字段规定语义接口，具体有限类型和内容校验由实现维护。捕获 / 盗取交互和杀毒的占格、超限 / 事件排序已分别由[地图与机关决定](../references/r1-map-mechanism-evidence.md)及[杀毒决定](../references/r1-antivirus-rules.md)按[主规格 §2.1](overview.md#21-待核准事项的关闭规则)冻结；其余新边界仍须先完成证据或具名适配，再加入结构化定义。禁止自由字符串脚本或隐含引擎分支；未关闭字段不能以 `null` 或默认旧值进入验收包，适配字段须绑定具名决定，不能标为原版一致。旧 routing、同色 theft 与 TTL antivirus 的完整定义须随旧内容视图冻结，以支持原版本校验。

### 4.2 部分发布的引用闭合

全量设计目录可列出未来 ID 和所属版本；运行包按 profile 生成实际内容清单。未收录门只保留“未收录”展示元数据，没有可执行目的地或未加载对象引用。所有已包含实体的前置、效果、房间、贴图都必须能在当前包解析。

A / B 回访区块在 M4 加入；M1–M3 不加载其坐标、奖励实体或运行时条件，也不把它们计入本版数据集合。仓库完整条件可以作为标题说明存在，不能在 `fullCampaign=false` 的包中作为当前目标或可执行门。禁止以补齐缺失引用为由将未来目标直接标为已完成。

四组捕获和修订后的三组盗取均从 M3 收录，其引用只指向已收录 C 内容；M1 / M2 不携带可执行捕获入口或 C 完成条件。新增捕获体验不改变任何 profile 的物资 / 数据分母。

## 5. 权威运行状态与存档载荷

| 状态 | 字段 | 是否进入稳定存档 |
| --- | --- | --- |
| 标识 | `gameId, schemaVersion, contentVersion, ruleVersion, releaseProfileId` | 是 |
| 进度 | `completedObjectiveIds, claimedRewardIds, activatedTeleportIds, capabilities` | 是；后两者须与生产目标一致，可重算核对 |
| 探索 | `playerPosition, discoveredTileIds, visitedTileIds, clearedEtherNodeIds` | 是；playerPosition 含 space / areaId / boardId / tileId，space 为 world 或 room；只能在有效已发现格 |
| 房间 | `roomId, status, returnAnchor, currentLayout, attemptBaseline, pendingEffects` | 静态活动房间是；status 为 preview / active；returnAnchor 含外层 areaId / boardId / tileId；布局按房间 kind 区分；永久完成权益由目标派生，完成回访还要求当前兼容布局 |
| 完成布局 | `completedRoomLayouts` | schema 2 已保存首次成功布局；R1 schema 3 按 roomId 保存当前兼容记录，含 contentVersion / ruleVersion / layout；原样取得或显式语义映射的来源均可追溯，见 §5.1 |
| 历史完成布局 | `archivedCompletedRoomLayouts` | R1 schema 3 新增；以 roomId / 来源 contentVersion / 来源 ruleVersion 唯一标识原布局，按旧内容视图验证；不供当前棋盘回访直接使用 |
| 挑战成绩 | `challengeId, ruleVersion, bestScore, bestCombo, bestStarClear` | 仅已结算结果；不适用的成绩字段缺省 |
| 完成记录 | `scopeCompletionHistory, campaignCompletedAt` | 时间只作显示；是否完成由目标集合核对 |
| 设置 | `masterVolume, muted, reducedFlash, reducedMotion, quality, zoom` | 是；装载时限制在合法范围 |
| 恢复提示 | `resumeHint` | 可选，仅为 restartChallenge + challengeId；实时入场前写入安全快照，退出 / 结算时清除 |
| 会话 | `mode, phase, activeTimeMs, inputQueue, undoStack, pendingEvents, pauseReasons` | 否；由稳定房间 status 与恢复提示重建，不持久化运行计时 |
| 渲染 | 网格对象、材质、相机插值、音频节点、DOM 引用 | 否 |

`playerPosition` 是当前玩家位置的唯一权威字段，进入局部终端时改为 room 空间，外层位置仅保存在 returnAnchor；currentLayout 只存物体 / 路径 / 局部机关，不再存第二份当前玩家位置。attemptBaseline 包含重置所需的玩家位置与布局；撤销快照同样包含两者。完成 / 放弃时恢复对应的 world 出口 / returnAnchor。

静态房间的 returnAnchor 必须与房间定义的固定安全返回点一致，并已发现、可通行；从侧路进入时该点可以尚未实际访问。进入或恢复房间不因此补写访问记录，玩家真正返回该格时才登记访问。当前世界玩家位置仍须属于已访问格。

R1 盗取布局必须保存未组合球 / 基站的位置、已组合体的位置和 `assemblyByAmplifierId`（每个组合体对应的球、基站）；已组合组件不得再以独立占格出现。接口满足状态从这些字段派生，不存第二套成功布尔值。捕获布局保存推车位置、未捕获邦布位置、已捕获 ID 及逃跑所需的有限局部状态，推车可用性从永久解锁事件派生。入场基线、撤销快照和首次成功布局均保留完整类型信息；组合守恒、唯一占格和缓冲地形约束在读取时同样校验。

静态房间的 `pendingEffects` 是局部尝试的结果集合，不可提前加入永久领取 / 完成集合；存档恢复后仍待成功整体提交。`attemptBaseline` 与 `currentLayout` 都必须通过房间合法性校验；重置不能依赖未保存的页面内闭包。preview 状态加载时整房重新观察，active 状态加载时从 playerPosition 继续。

历史语义（2026-09-11，schema 2）：完成房间回访使用 `room.status=completedVisit`，仅携带 `roomId / returnAnchor`，布局引用已提交记录，当前玩家只存在 `playerPosition`。旧一笔画完成记录按集合校验全部必经格，活动尝试才要求相邻有序路径；旧记录仍按该来源版本语义校验和归档，不改写成新路径。R1 按 §5.1 增加当前兼容布局缺席的处理，不再仅凭永久目标进入该访问态。

实时模式开始前保存安全返回点；刷新恢复到该点并显示“上次挑战未结算，可重新开始”，分数和灯态清零。挑战成功后立即保存已提交的全局结果；如果结果已提交但画面尚未播完，重新载入仍视为已完成。

不要持久化区域百分比、物资合计、门开启缓存或剩余可收集数；加载时由当前内容和永久 ID 集合重算，避免分母升级后出现双份真相。兼容 / 写入协议见 [工程合同](architecture.md)。

### 5.1 版本化完成布局与回访

完成权益、当前兼容布局和旧布局归档分别处理，不新增另一份完成布尔值。

R1 一笔画的当前完成记录保留实际成功时的有序全部行走路径（`visitedTileIds`），包含起点、终点及途中非目标空地板；校验从起点出发、每步四向相邻、均为当前地板、无重复、六目标均已经过且终点为最后一格。不能只保存目标子集、排序后集合或标准解来代替真实路径。完成回访可自由走动，但不修改该首次成功路径。旧 schema 的完成集合继续使用旧规则归档；缺少原路径顺序时不能靠排序或重放标准答案补成 R1 当前记录。

当前兼容记录必须通过当前房间规则校验；旧记录只有经已登记的一一语义映射才可形成该记录，同时保留来源版本和映射标识。无此映射的记录进入 `archivedCompletedRoomLayouts`，不能用标准解补成新布局。归档按旧版本校验目标与布局关系，允许引用已从当前地图移除、但在迁移登记中保留的旧房间；相同归档键不能存在不同内容。

| 永久完成目标与布局 | 普通访问 / 恢复 | 正常操作成功后 |
| --- | --- | --- |
| 目标未完成，无完成记录 | 从当前固定初态进入普通尝试，活动存档按原规则续玩 | 提交目标及既有结果，保存当前首份成功布局 |
| 目标已完成，存在当前兼容布局 | 以 `completedVisit` 访问该布局；独立练习从固定初态开始 | 练习不重复提交目标 / 奖励，不替换已有首份布局 |
| 目标已完成，仅有已验证的旧归档 | 停在已映射的安全外层入口，提示机关已更新、原进度保留；主动选择重新体验才从当前初态进入练习，不能把归档或未解初态当作 `completedVisit` | 第一次实际成功时补存当前版本首份布局并保存；后续回访使用它，旧归档不变，不重复提交目标 / 奖励 |
| 目标已完成，但既无当前布局也无合法旧归档 | 拒绝载入缺少证明的状态，不能静默补解或套用上一行 | 不适用 |

仅有旧归档时，进入练习、中途刷新、放弃或失败都不会生成新版完成布局。成功保存后刷新必须恢复该首份布局；后续练习的其它解法不得覆盖它。由明确语义映射得到的布局只证明旧成果兼容，不作为新规则实际游玩的见证。

原已完成机关承担的世界通路继续按既有通行目标开放，不以补玩为前置。若普通通行原本必须穿过房间，在对应世界入口提供经固定内容登记的安全入口至成功出口通行；终端的入口 / 成功出口相同时只需保留返回与重新体验。该通行仅移动玩家，不写目标或完成布局；旧 `c.routing.01` 的通行不补写新捕获目标。入口、出口及目标无法安全映射时停止持久迁移，不能任意传送或封回旧门。迁移时恰处旧 `completedVisit` 的恢复规则见[工程合同](architecture.md#5-版本与失败恢复)。

## 6. 内容制作交付

每个区域进入对应里程碑前须有以下材料，缺少时不能标为“区域完成”：

1. 可运行的固定地图与本 profile 全部可达奖励；地图单元坐标来源为实测或明确重建，不是空白占位。
2. 来源记录：链接、章节 / 视频时间段、截图定位、核对范围、可信度；只保存可用于本项目的必要素材，不整页搬运攻略。
3. 原节点 → 本版节点的改造表，列出剧情 / 战斗移除后保留的通行、数据、开门和物资事件。
4. 每个静态房间的一条解法、失败 / 死角与恢复记录；允许多解房间另有一条不同合法解，运行时按规则接受。
5. 每个实时挑战的固定时间表、达标见证、边界失败见证；D 幽灵记录等待、移动和亮灯顺序。
6. 新档到区域终点、返回中心、再次进入以及全收集的完整记录；不直接修改完成集合。

R1 额外交付一份逐房原节点 → 新节点 → 旧存档节点映射。对已确认原图逐格比较核心轮廓、危险 / 墙 / 对象 / 接口和入口关系；截图以外的连接明确标重建。C 四组捕获全部有正常操作记录，三组盗取都包含实际组合与入接口过程；B 三档包含未清理数量增长及超限失败。旧见证只能证明旧规则，不能用已保存完成标记代替新机关通关。

## 7. 内容校验硬条件

`validate:content` 对每个发布 profile 单独运行，不能只检查完整版。失败输出文件、ID、具体原因和引用链，退出非零。

| 检查组 | 必须拒绝的内容 |
| --- | --- |
| 基本结构 | 重复 ID / 坐标，越界，未知 kind，非整数物资 / 坐标，缺入口或引用 |
| 拓扑 | 传送落入墙或无限回跳；不可达主终端；房间无安全返回；可移动对象越过重置边界 |
| 目标依赖 | 主路径读取全数据，A / B 回访读取仓库条件，D 权限读取回访，永久目标依赖环，已收录引用未收录目标 |
| 数据账本 | 四区任一非 5 × 20；相同数据节点重复计权；错误统计区；把高分 / 物资作为开库前置 |
| 奖励账本 | 完整总量非 130，阶段非 26 / 51 / 81，重复领取生产者，pickup 同时自动 grant，奖励永远不可达 |
| 静态可解 | 起点危险、路径不连通、组件或接口匹配不闭合、组合前后组件丢失 / 复制、组件落缓冲区、捕获越界或引用未解锁推车、见证不成功、重置不能复原 |
| 实时内容 | 节拍窗越界 / 重叠、门槛不可达、杀毒没有数量压力或未定义超限结果、生成占格冲突无处理规则、幽灵路线不相邻 / 无有效通关见证 |
| 来源标识 | 原图“已测绘”却无具体定位；与已确认盘面冲突却标还原通过；待核准参数被当作原版事实；使用未提供的远程运行资源 |

几何可达检查只做必要条件；有推物或模式切换的路线还必须重放权威规则见证。测试探索的是玩法状态和门条件，不通过强制把所有门设为开来掩盖死锁。
