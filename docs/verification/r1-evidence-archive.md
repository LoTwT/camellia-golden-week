# R1 验收证据归档

[文档索引](../index.md) · [63项结果](r1-acceptance-results.md) · [逐文件索引](r1-evidence-files.md) · [权威清单](evidence/r1-archive-manifest.json)

R1 的完整原始验收输出通过 [v0.5.0-r1 Release](https://github.com/LoTwT/camellia-golden-week/releases/tag/v0.5.0-r1) 分发，不再随普通 Git 克隆下载。归档包含成功和失败尝试，保存原文件字节、原路径、原时间与原提交号；本次改变存放方式，不改变历史结论。Release 标签绑定清理后的提交，旧提交仅作为证据来源标识。

| 归档                                                                                                           | 内容                                              | 文件数 | ZIP字节   | SHA-256                                                            |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------ | --------- | ------------------------------------------------------------------ |
| [pipeline](https://github.com/LoTwT/camellia-golden-week/releases/download/v0.5.0-r1/r1-evidence-pipeline.zip) | 最终完整verify的原始输出、截图与追踪              | 667    | 407246485 | `dc25f01bef36677e1708241e8818a69ca708202e129f32fc828afed50adec016` |
| [browser](https://github.com/LoTwT/camellia-golden-week/releases/download/v0.5.0-r1/r1-evidence-browser.zip)   | 主线、真实旧档、视觉/性能/输入/平台专项及失败过程 | 504    | 307823510 | `c2989b34f2d7ca03cd33b4d5b3d294a50c30932e397993cc41ea15b458ddb3f9` |
| [support](https://github.com/LoTwT/camellia-golden-week/releases/download/v0.5.0-r1/r1-evidence-support.zip)   | 原图来源、规则/工程日志、原静态包和发布回读       | 95     | 10631062  | `1bd4f83b2b652b344e4691ebc3b57f6d375e547ed8ee0bf02ec48677de887341` |

原始证据共1266文件，原文件总计803127964字节。各文件的路径、大小、SHA-256、所在ZIP与包内路径由权威清单维护；逐文件索引是它的可读导航。验收表中的归档链接直接定位到相应条目。历史JSON中的相对路径按当时目录解释，不批量改成新路径；查阅时用清单定位，需复现原目录时在仓库外解压。不得将全部归档解压回源码目录再提交。

三份测试必需的小型输入保存在 [tests/fixtures/r1](../../tests/fixtures/r1/README.md)，正常构建、测试和游戏不下载上述归档。七类场景及正式包代表截图保存在 `evidence/r1-representative/`，通过[视觉对照](../references/r1-visual-comparison.md)查阅；详细视口矩阵及状态序列仍在归档。原验证摘要和包体清单的保留副本同样不改原字节，其中旧路径由归档清单解释。

后续浏览器原始输出统一写入被Git忽略的 `test-results/`。小型状态图只有显式作者命令 `--write` 更新，`--check`、测试和构建均只读。每轮交付只挑选精简结论、必要输入、少量代表画面与归档校验清单入库；不复制整份结果、追踪或构建目录。`.gitattributes`只折叠两份明确生成的内容JSON和生成索引，不隐藏手写玩法或迁移实现。

本次历史整理从 `7fe7d8e9179e0c9dcef505f454232a9a38321234` 重建R1提交，原 `a20d93a`、`083a9be` 的完整Git备份及证据另存仓库外。没有改写main；新克隆的传输体积是清理效果依据，不宣称GitHub缓存、PR内部引用或旧本地对象立即消失。

## 归档清理复验

清理后的完整 `pnpm run verify` 退出0，682项原生测试及Chrome完整流程通过。177个游戏源码与资源文件和93文件／6,542,361字节正式产物均与原 `083a9be` 逐字节一致；268个当前工程输入在本轮执行前后无变化。13份保留输入／截图／摘要与归档原件字节相同。详见[清理验证摘要](evidence/r1-cleanup-verification.json)。

首轮清理复验在防火墙脚本出现两次读取跨拍：等待waiting成立后，独立灯光读取已进入ready。定向探针通过正常浏览器时钟复现；修正为同次条件判断和灯光采样，原亮度、计分与响应预算保持不变。标准显示、减少效果、三档47／57／72 Combo及旧档迁移均在后续完整verify通过。第二轮在M2首个教学按键之前触发100毫秒投递窗口断言，M5和M1完整路线已通过；游戏帧间隔正常、无暂停。具体延迟环节未复现，独立时间线探针在270.6毫秒正常命中首拍；脚本仅补充不增加浏览器读取的主机等待/读取耗时记录。第三轮完整verify通过，未降低窗口或成功断言。两轮失败、冷启动调度中断、已排除假设、一个明确无效的中间探针及修正后的有效探针与本轮原始结果另存独立验证ZIP，原始三份R1归档未改写。

本轮[验证ZIP](https://github.com/LoTwT/camellia-golden-week/releases/download/v0.5.0-r1/r1-cleanup-verification.zip)：12906783字节，SHA-256 `ffd8d3ede9856b858be9e2043e40a5518697f18ff13ed2991cf3290c2fe360a2`。包含本轮完整结果、原始日志、冻结输入、字节核对、失败与探针；未复制重复构建目录、整套冗余图片和追踪ZIP；完整本轮原件仍保留在验证工作目录的ignored `test-results/r1/pipeline/`，原R1的完整追踪则随上方三份原始归档提供。
