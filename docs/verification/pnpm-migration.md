# pnpm 迁移与验证

[文档索引](../index.md) · [安装与运行](../../README.md#安装与运行) · [工程合同](../spec/architecture.md) · [交付包](release-candidate.md)

2026-09-11，用户要求将项目的包管理从 npm 改为 pnpm。本次保留 Node 24.18.0、全部游戏依赖版本、规则、资源、profile 和存档协议，仅迁移工程工具入口与当前文档。原 M1–M5 npm 日志和源指纹保留为历史证据，不改写为 pnpm 执行结果。

## 版本与配置

采用本机已有的 pnpm **11.25.0**，该版本注册表元数据要求 Node `>=22.13`，与项目 Node `24.18.0` 相容；本次未升级机器全局 pnpm 或 Node。[精确版本元数据](https://registry.npmjs.org/pnpm/11.25.0)、[官方 Node 兼容表](https://pnpm.io/installation#compatibility)。

`package.json` 固定 `packageManager: pnpm@11.25.0`，engines 同时约束 Node 与 pnpm；build 串联的只读检查改为 `pnpm run`。安装统一执行 `pnpm install --frozen-lockfile`，运行脚本后的参数直接传递，如 `pnpm run preview --host localhost --port 5174 --strictPort`。

原 `.npmrc` 只有 engine-strict / save-exact 两项，已分别迁到 `pnpm-workspace.yaml` 的 engineStrict / saveExact。pnpm 设置采用 camelCase，pmOnFail 为 error，版本不符须先安装指定版本。fsevents 的可选安装脚本继续明确禁用，与原已验证安装一致。导入工具为已锁定的 Vite 8.3.0 自动加入单版本 minimumReleaseAgeExclude；这是保留已使用版本的具名例外，不解除其他包的默认策略。[pnpm 配置](https://pnpm.io/settings)。

## 锁文件与依赖等价

使用 `pnpm import` 从原 `package-lock.json` 生成 `pnpm-lock.yaml`，随后移除根目录旧锁文件，保留 Git 中的历史版本。导入后比较全部 **112 个包的名称、版本和 integrity**，与原锁文件完全一致；直接 dependencies / devDependencies 也未变。导入方式见[pnpm 官方说明](https://pnpm.io/cli/import)。

原 npm 依赖目录移到忽略的迁移备份目录后，执行干净的冻结安装，避免旧 node_modules 掩盖 pnpm 的依赖解析问题。锁文件、安装设置和版本约束随项目提交；历史锁文件链接固定到原提交。

## 本轮实际验证

本机 Node 24.18.0 / pnpm 11.25.0，2026-09-11 实际执行如下。日志保留工具原始输出；[机器汇总与证据哈希](historical-evidence-files.md#file-55cc3f381469e342)提供文件校验值。

| 命令 / 检查                                                  | 实际结果                                                                                                      | 证据                                                                                                                             |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm import`                                                | 退出 0；112 个包的名称、版本、integrity 与原 npm 锁文件相同，7 个直接依赖版本不变                             | [导入日志](historical-evidence-files.md#file-504eb6cc4b803a00)、[锁文件对照](historical-evidence-files.md#file-791f6e1ff75486a7) |
| `pnpm install --frozen-lockfile`                             | 干净 node_modules 安装，退出 0，添加本平台 33 个包，用时 3.8s；锁文件字节未变                                 | [安装日志](historical-evidence-files.md#file-5ccedb2d057ca4db)                                                                   |
| `pnpm run lint`                                              | 退出 0，零警告 / 错误                                                                                         | [日志](historical-evidence-files.md#file-4729d04ca70bf568)                                                                       |
| `pnpm run format:check`                                      | 退出 0；最后文档收尾后再次只读检查通过                                                                        | [首次日志](historical-evidence-files.md#file-809f29cc8789ed1d)、[最终日志](historical-evidence-files.md#file-4584a62631bf0ca6)   |
| `pnpm run typecheck`                                         | 退出 0                                                                                                        | [日志](historical-evidence-files.md#file-81a707b0685f1b41)                                                                       |
| `pnpm run validate:content`                                  | 退出 0；资源、五期 profile、静态 / 实时见证和完整世界见证通过，M5 全收集仍为 26 奖励 / 130 物资               | [日志](historical-evidence-files.md#file-5949660c301b12d1)                                                                       |
| `pnpm test`                                                  | Node 原生测试 **411/411**，0 失败 / 取消 / 跳过 / todo，3021.299833ms                                         | [完整日志](historical-evidence-files.md#file-6287b63c9662af7e)                                                                   |
| `pnpm run build`                                             | 退出 0；含四项只读检查，构建前后的 161 个源码 / 资源 / 配置输入哈希相同                                       | [构建日志](historical-evidence-files.md#file-84ca091918d73c4b)、[字节对照](historical-evidence-files.md#file-41318f25c123f4d7)   |
| `pnpm run dev --host localhost --port 5174 --strictPort`     | 启动成功，根页面与转换后的主模块均为 200；随后关闭本任务 dev                                                  | [启动日志](historical-evidence-files.md#file-a2182748af9438ce)、[HTTP 核对](historical-evidence-files.md#file-eeb7579b9f93393c)  |
| `pnpm run preview --host localhost --port 5174 --strictPort` | 启动成功；84 个文件与根 URL 共 85 次 200，响应字节与 dist 相同                                                | [启动日志](historical-evidence-files.md#file-27e9fef80a19c71a)、[HTTP 核对](historical-evidence-files.md#file-94a52fbbca00c31c)  |
| preview 端口占用                                             | 首次 preview 尝试时 dev 尚占用 5174，实际退出 1 并明确报错，没有改用其他端口；关闭已核实归属的 dev 后重试成功 | [报错日志](historical-evidence-files.md#file-2867b89d3fdbfff5)、[上下文](historical-evidence-files.md#file-c1d57c28459afb37)     |

重建的 **84 文件 / 1,674,897 字节** 与已交付 ZIP 的全部解压字节相同，继续使用原[静态包与校验值](release-candidate.md#1-当前静态交付物)。单 JS 超过 650 kB 的既有 Vite 提示原样保留。pnpm 导入 / 安装的更新提示不代表本次升级到提示版本。

此次未修改游戏源码、运行素材、内容或存档协议，没有再次进行浏览器全流程、性能或断网测试。已有 Chrome 证据继续对应相同的静态字节；旧包含 package.json / package-lock.json 的源指纹仅证明原提交，不能用于声明 pnpm 工程配置未变。当前预览入口仍为 `http://localhost:5174`，本次 HTTP 核对不读写浏览器存档。后续维护统一使用 pnpm，旧 npm 日志与历史来源记录保留。
