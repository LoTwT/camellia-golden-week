# M5 离线构建资源依赖审计

[文档索引](../index.md) · [工程合同](../spec/architecture.md#3-浏览器与运行预算) · [V06验收合同](../spec/acceptance.md#7-表现与浏览器) · [验收总表](acceptance-results.md) · [美术资源记录](../references/art-implementation.md)

核对日期：2026-09-11。**真实断外网仍未验证；按[用户本轮范围调整](acceptance-scope-2026-09-11.md)，V06 不再要求，不计为测试通过。** 当前 production 构建为 84 个文件、1,674,897 字节；连同根页面的 85 次本地 GET 均为 200 且逐字节匹配。45 项资源清单、78 个内容哈希、2 个许可哈希及 ZIP 的 CRC / 解压字节核对通过。[机器证据](historical-evidence-files.md#file-76d5ac682129fa80)、[静态 ZIP](historical-evidence-files.md#file-a68b083b831dbd7a)及[归档清单](historical-evidence-files.md#file-b65a9409eb1d2533)见第 8 节。早期 acceptance、旧 production 和隔离尝试保留当时事实；第 5 节只作为可选的后续步骤，不再是发布待办。第 9.3 节明确记录 DevTools 清理未完成的工具限制，未声称环境完全恢复。

## 1. 早期acceptance被审计对象与证据边界

以下历史对象是当时 `dist/` 中的 **M5 acceptance构建**，不是dev热更新页面，也不是最终production构建的替代验收。它包含验收故障面板分块与只读观察入口。资源清单为 `profile=M5`、`assetVersion=camellia-assets-v2`，共45项：33项图标、10项音效、2项字体。当前production已另于第8节审计；下述86文件和旧字体数字不表示当前包。

2026-09-11 09:36:21–09:39:02（Asia/Shanghai，UTC+8）完成资源枚举、源码入口检查、哈希和本地响应核对。HTTP批量读取完成于09:37:57；读取前后 `dist` 文件集合与字节指纹一致。随后只读进程检查确认监听者是本仓库的：

```text
node node_modules/.bin/vite preview --host localhost --port 5174 --strictPort
TCP [::1]:5174 (LISTEN)
```

没有执行 `npm run build`，也不以这次源码阅读证明当前未提交源码与已存在构建逐字对应。后续源码修改、重新构建或正式发布后，须对新的构建重新核对，并保留本次记录的历史含义。

| 文件类别 |   数量 |      字节数 | 本次结果                                             |
| -------- | -----: | ----------: | ---------------------------------------------------- |
| HTML     |      1 |         557 | 入口及根URL均可读取                                  |
| JS       |      3 |      926559 | 主分块、共享存档分块、acceptance故障分块均本地提供   |
| CSS      |      1 |        7940 | 无外部 `@import`，两处字体URL均本地                  |
| PNG      |     33 |      180330 | 实际棋盘图标加载格式；全部存在且哈希匹配             |
| SVG      |     33 |       15193 | 随包保留的补制源图；本版棋盘不直接加载SVG            |
| WAV      |     10 |      209034 | 音频入口枚举的十种短音效全部存在                     |
| WOFF2    |      2 |      221772 | 中文子集182388字节，数字字体39384字节                |
| JSON     |      1 |      112726 | 来源与资源清单，不是运行时地图请求                   |
| TXT      |      2 |        8678 | 两份字体OFL许可                                      |
| **合计** | **86** | **1682789** | **86文件与根页面共87次GET均200；响应内容与磁盘一致** |

45条资源记录中，45个主资源加33个PNG缓存共78项声明内容哈希全部匹配；两份许可哈希也匹配，共80个唯一资源/许可路径，且与 `public/assets` 中对应文件字节一致。构建没有原始TTF/OTF字体、DDS、参考截图或source map；不需要在运行时下载原字体或原参考图。

构建指纹是按相对路径升序，对每个文件生成 `SHA256 + 两空格 + 路径 + LF` 后，再对完整UTF-8文本求SHA-256：

| 定位                            | SHA-256                                                            |
| ------------------------------- | ------------------------------------------------------------------ |
| 全部86文件清单指纹              | `02e0c6ee2bc9018208fbff5484e1876a7f8ca38808773ba14a4cdaac46d19d25` |
| `dist/index.html`               | `d1ecd4abf89b23dd0db3394302c2d52ba994ac7085d5b4feab762a7995e2d1cf` |
| `dist/assets/index-Dezbs-6S.js` | `1affee2f733c6d4f17c02dd395872dffb6a36196dbc983cf39908f5aa2e41fe4` |
| `dist/assets/manifest.json`     | `a2ffd3ed8c741625d0ac11069e41056b26c6336a560945cdee0f5e7c6639663d` |

## 2. 早期acceptance运行加载入口

| 入口与实现位置                                                                                                            | 实际路径或方式                                                                                                                                                       | 依赖判断                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| [HTML入口](../../index.html)、[主程序](../../src/main.ts)                                                                 | 源码为 `/src/main.ts`；本次构建为 `/assets/index-Dezbs-6S.js`、`/assets/index-XdWH7aHE.css`，并预加载 `/assets/save-store-B3h23j4E.js`                               | 都由同一HTTP来源提供；构建HTML没有远程脚本、样式、预连接或导入映射                                    |
| [构建配置](../../vite.config.ts)、[内容模块生成](../../scripts/content-module.ts)                                         | 固定地图、机关和历史迁移视图经 `virtual:camellia-content` 编入JS；Three.js及RoundedBoxGeometry来自已安装依赖并打包                                                   | 无运行时地图JSON、npm包、CDN或远程解码器下载；安装阶段的npm注册表访问不属于游戏运行                   |
| [棋盘渲染](../../src/render/board.ts)、[状态投影](../../src/core/projection.ts)                                           | `TextureLoader.loadAsync("/assets/icons/<id>.png")`；ID来自固定投影与状态变体。准备阶段按当前棋盘加载，并补齐该类变体；杀毒额外预备蓝/紫/星                          | 33个PNG均随包；资源按需加载不等于启动时已加载全部资源，因此断网验收仍需进区和重试                     |
| [CRT纹理与背景](../../src/render/board.ts)                                                                                | `makeGlassTextures` 在本机Canvas绘制暗角、扫描线和反光，转为两个 `CanvasTexture`；背景和电视几何在本机生成                                                           | 无外部纹理、模型、着色器文件、视频或环境贴图；图标之外的视觉不需要网络下载                            |
| [音频入口](../../src/audio/audio.ts)                                                                                      | `fetch("/assets/audio/<id>.wav")` → `arrayBuffer` → `AudioContext.decodeAudioData`。ID为move、invalid、pickup、reveal、amplify、door、success、failure、portal、beat | 十个同源WAV；内存缓冲复用。没有流式音源、外部合成服务或音频API                                        |
| [字体样式](../../src/ui/style.css)、[场景准备](../../src/main.ts)                                                         | 两个 `@font-face` 分别读取 `/assets/fonts/camellia-ui.woff2` 与 `/assets/fonts/camellia-numerals.woff2`；准备过程等待 `document.fonts.ready`                         | 无Google Fonts CSS、动态字体CDN或远程字体回退；额外导入文件名字形回退到本机 `sans-serif`              |
| [存档入口](../../src/main.ts)、[双槽存储](../../src/platform/save-store.ts)、[会话锁](../../src/platform/session-lock.ts) | `localStorage.getItem/setItem`、`navigator.locks`；文件导入用 `File.text()`；导出用本机 `Blob` / `URL.createObjectURL`                                               | 保存、恢复、导入和导出不调用后端；`blob:`下载不是外部请求。断网后持久化是否正常仍须浏览器实际操作验证 |
| [acceptance入口](../../src/platform/acceptance-faults.ts)                                                                 | 仅该模式动态导入 `./acceptance-faults-DH5AhTCN.js`；该分块和主分块均静态导入同目录 `save-store-B3h23j4E.js`；重启链接由当前 `document.URL` 改查询参数生成            | 诊断代码也在本地包内；未见额外服务器/API。正式production构建应另核对诊断分块排除情况                  |
| Vite模块预加载兼容代码                                                                                                    | 构建JS中另一处 `fetch` 读取HTML `modulepreload` 的 `href`；此HTML唯一对应链接为本地存档分块                                                                          | 不是数据API；本次HTML与分块引用链已经逐项核对                                                         |

源码全文扫描未发现 `XMLHttpRequest`、`WebSocket`、`EventSource`、`sendBeacon`、Worker、Service Worker注册、远程URL加载或动态CDN入口。构建HTML/JS未包含 `/@vite/client`；没有运行时HMR连接。这里的“未发现”基于当前源码入口阅读和实际构建文本审计，不是浏览器网络全流程抓包结果，也不能保证未来新增代码仍符合。

对构建中看似外部URL的内容已核对用途：

- 主JS中的 `http://www.w3.org/1999/xhtml` 是 `document.createElementNS` 的命名空间；SVG中的 `http://www.w3.org/2000/svg` 也是命名空间，二者不触发网络读取。
- 主JS中的 `https://jcgt.org/published/0007/04/01/` 位于Three.js内嵌GLSL的GGX采样文献注释，不是请求入口。
- `assets/manifest.json` 和字体许可中的来源、参考、版权URL是追溯文本。当前主程序不读取该清单，也没有跟随这些URL加载游戏资源。
- 33个SVG经XML检查，没有外部 `href/src`，也没有 `script/image/foreignObject/style` 元素。棋盘实际读取PNG，因此无需运行时SVG栅格化工具。

## 3. 早期acceptance实际检查命令与结果

以下命令均从仓库根执行。本次没有安装依赖或启动第二个服务，使用已经运行的preview。`node --version` 实际为 `v24.18.0`。

入口搜索与读取范围：

```sh
rg -n 'fetch\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|Worker\(|SharedWorker|serviceWorker|import\(|https?:|wss?:|url\(|@import|new URL|\.src\b|\.href\b|\.load\(|\.loadAsync\(|TextureLoader|ImageLoader|FontFace|AudioContext|createImageBitmap|decodeAudioData|createObjectURL' src index.html vite.config.ts scripts/content-module.ts
rg -n 'document\.fonts|file\.text|localStorage|navigator\.locks|location|import.meta.env' src
node scripts/generate-assets.ts --check
```

前两条的匹配项已按第2节阅读上下文；不把 `this.actions.import(file)` 方法名误计为动态ES模块导入。资源检查实际退出码0，输出：

```text
Asset check passed: 45 records (prepared-all-profiles); exact profile membership, local checksums and recorded font coverage.
```

枚举、清单哈希、本地GET及完整构建指纹的复核脚本如下。此脚本与本次执行的检查步骤等价，只读本地文件和回环HTTP；关闭环境代理，核对每个最终响应仍为同一来源，且不把404的HTML回退当成资源成功。再次执行时，若构建已变，必须记录新的指纹和计数。

```sh
python3 - <<'PY'
from collections import Counter
from pathlib import Path
from urllib.parse import quote, urlparse
from urllib.request import build_opener, ProxyHandler, Request
import hashlib
import json

root = Path("dist")
digest = lambda data: hashlib.sha256(data).hexdigest()
files = sorted(path for path in root.rglob("*") if path.is_file())
before = {
    path.relative_to(root).as_posix(): digest(path.read_bytes())
    for path in files
}
manifest = json.loads((root / "assets/manifest.json").read_text())
resource_paths = set()
content_checks = 0
license_checks = 0
for asset in manifest["assets"]:
    assert manifest["profile"] in asset["profiles"], asset["id"]
    for item in (asset, asset.get("raster")):
        if item is None:
            continue
        path = item["localPath"]
        assert path.startswith("/assets/"), path
        raw = (root / path.lstrip("/")).read_bytes()
        assert digest(raw) == item["sha256"], path
        assert raw == (Path("public") / path.lstrip("/")).read_bytes(), path
        resource_paths.add(path)
        content_checks += 1
    if "licenseLocalPath" in asset:
        path = asset["licenseLocalPath"]
        raw = (root / path.lstrip("/")).read_bytes()
        assert digest(raw) == asset["licenseSha256"], path
        assert raw == (Path("public") / path.lstrip("/")).read_bytes(), path
        resource_paths.add(path)
        license_checks += 1

opener = build_opener(ProxyHandler({}))
statuses = Counter()
types = Counter()
total_bytes = 0
for path in files:
    relative = path.relative_to(root).as_posix()
    request = Request(
        "http://localhost:5174/" + quote(relative),
        headers={"Cache-Control": "no-cache", "Accept-Encoding": "identity"},
    )
    with opener.open(request, timeout=10) as response:
        assert urlparse(response.url).netloc == "localhost:5174", response.url
        assert response.status == 200, relative
        raw = response.read()
        assert digest(raw) == before[relative], relative
        statuses[response.status] += 1
        types[response.headers.get_content_type()] += 1
        total_bytes += len(raw)
with opener.open("http://localhost:5174/", timeout=10) as response:
    assert response.status == 200
    assert urlparse(response.url).netloc == "localhost:5174"
    assert digest(response.read()) == before["index.html"]
after = {
    path.relative_to(root).as_posix(): digest(path.read_bytes())
    for path in root.rglob("*") if path.is_file()
}
assert before == after, "dist changed during audit"
listing = "".join(
    f"{value}  {path}\n" for path, value in sorted(before.items())
)
print("records", len(manifest["assets"]),
      "content hashes", content_checks, "license hashes", license_checks,
      "resource paths", len(resource_paths))
print("files", len(files), "bytes", total_bytes,
      "HTTP", dict(statuses), "root also matched")
print("content types", dict(types))
print("dist listing sha256", digest(listing.encode()))
PY
```

本次实际结果为45条记录、78个内容哈希、2个许可哈希、80个唯一资源/许可路径；86个文件全部200，合计1682789字节，根页另一次200。Content-Type计数：

```text
text/html 1; text/javascript 3; text/css 1; application/json 1;
image/png 33; image/svg+xml 33; audio/wav 10; font/woff2 2; text/plain 2
```

额外只读核对覆盖三个JS分块的导入关系、CSS两处URL、33个SVG的XML属性与元素、0个source map和0个HMR客户端引用。该资源GET脚本没有调用游戏输入或访问存档，不证明浏览器成功解码、播放音频、渲染或恢复进度；这些结果须引用各自浏览器验收。

## 4. 固定来源与服务方式

[Vite配置](../../vite.config.ts)对dev和preview同时固定 `host: "localhost"`、`port: 5174`、`strictPort: true`；本次监听进程与此一致。正确成品入口是 `http://localhost:5174/`，运行方式见[README](../../README.md)。`strictPort` 的源码配置已核对，本次没有另起冲突服务实测报错。

| 常见错误方式                                                   | 与本包的具体冲突                                                                                                | 正确处理                                                                                  |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 双击 `dist/index.html` 使用 `file:`                            | 根路径 `/assets/...` 不会指向该构建目录；模块、资源和存储来源也不满足HTTP合同                                   | 用preview或以dist为根的本地HTTP服务                                                       |
| 把仓库根目录作为普通静态根，再访问 `/dist/`                    | 构建引用的是根路径 `/assets/...`，不会自动加 `/dist`；可能404或返回错误HTML                                     | 使用 `pnpm run preview --host localhost --port 5174 --strictPort`，或正确以dist作为静态根 |
| 改用 `127.0.0.1`、其他端口或HTTPS                              | 存档按浏览器来源隔离；`localhost` 与 `127.0.0.1` 不是同一来源。本次服务只观察到IPv6回环监听，未验证IPv4别名可达 | 保持固定 `http://localhost:5174`；必须换来源时通过正常导出/导入迁移                       |
| dev和preview同时占用5174，或浏览器仍显示dev                    | 服务冲突；dev页面会请求源码/HMR，不是合同V06的成品检验                                                          | 结束本任务旧dev后启动preview，核对HTML引用构建分块且没有 `/@vite/client`                  |
| 断开本地服务后仍要求刷新                                       | 当前没有Service Worker或离线应用缓存层；“离线”指外网断开、本地HTTP仍运行                                        | 保持本地Node服务和回环网络可用                                                            |
| 断网后首次执行 `pnpm install --frozen-lockfile` / 下载构建工具 | 安装与构建工具属于开发依赖，所需包不保证已在本机缓存                                                            | 在线准备依赖和静态构建，再断外网测试运行；本报告不声称安装阶段可离线                      |

## 5. 真实断网验收步骤（待执行）

**历史步骤保留，本次不再要求执行。** 用户已取消 V06 发布门槛；以下为最初拟定的验证方法与当时环境限制，不是当前阻塞清单。

当前可用CUA没有提供外网断开控制能力。本页三次资源审计均没有操作网络设置，也没有外网不可达证明。因此验收总表中的 **V06继续保留未验证**；不能把早期acceptance的87次GET、两份production各自的85次GET、资源本地打包或其他在线浏览器通关结果替代它。

后续执行者可按下面顺序验收并留证，所有游戏操作经正常键鼠完成：

1. **准备最终静态包和安全的验收环境。** 在线完成已授权的安装/构建；记录该包指纹、profile、浏览器完整版本、系统与设备。当前production资源审计见第8节；若包再次变化须重审。使用专门的验收浏览器配置，先正常导出需要保留的存档，不清除用户其他浏览器数据。关闭占用5174的旧dev，启动 `pnpm run preview --host localhost --port 5174 --strictPort` 并保持运行。
2. **留存断网前基线。** 确认 `http://localhost:5174/` 和两个无关的外部HTTPS目标都实际可达，记录时间与URL。两个外部目标必须先成功；原本就失败的目标不能用来证明后来断网。通过浏览器自身工具禁用该验收页HTTP缓存或使用专用新配置，保留localStorage，以便刷新重新请求文件又能验证续档。
3. **由执行者断开外网并证明回环仍可用。** 使用可恢复方式断开该机所有实际外网通道，记录断网方式及时间；本地服务保持运行。以相同目标再次检查外部HTTPS连接失败，并同时证明localhost仍200。不能仅使用会一起封锁localhost的浏览器“全部离线”模式，也不能把单一域名不可达当作整机断网证据。本页列出的全资源GET脚本可在此时重跑并保存输出。
4. **断网刷新并进入各区域。** 在固定来源强制刷新，正常新游戏或继续已真实游玩的存档，记录使用的初态。完成中心教学的移动/增幅，正常进出A、B、C、D和仓库，触发六类代表场景，使字体、玩家状态、危险、目标、球车、幽灵/灯等按需资源实际加载。若为覆盖已解锁区域而导入既有正常游玩导出档，保留原文件及导入记录，明确它是续档验证，不能称作新档离线全通关。
5. **重试并核对声音与反馈。** 在断网状态经正常操作产生可恢复失败，使用界面重试/独立练习，至少覆盖静态谜题和实时挑战；确认重试后的图标、计数、声音及减少效果设置可用。记录本次结果、是否使用静音、失败和重试画面，不以此前最高分充当本次成绩。
6. **保存并恢复可见进度。** 正常产生一项合法进度变化，等待保存成功；记录物资、数据、位置和保存状态，正常导出。保持断网刷新并继续，比较相同字段；再重启该验收页面或浏览器，确认仍能从同一来源恢复。必要的静态布局恢复、实时安全点恢复和重复领取幂等依照已有用例验证，不直接改坐标、目标、分数、门或存档JSON制造结果。
7. **汇总实际结果并恢复环境。** 保存断网证明、本地请求记录、刷新/进区/重试/保存恢复截图或录屏、控制台与网络错误。逐项区分通过、失败与未覆盖，再恢复外网。只有要求动作全部有可核对证据后，才更新[验收总表](acceptance-results.md)的V06；资源GET成功本身仍只属于前置检查。

断网证明可使用以下命令格式；外部目标由执行者选择并在断网前确认可达。本次没有执行外部目标请求，也没有把下面的预期输出写成实际结果：

```sh
curl --noproxy '*' --connect-timeout 5 --max-time 10 -I 'https://<断网前已确认可达的目标一>/'
curl --noproxy '*' --connect-timeout 5 --max-time 10 -I 'https://<断网前已确认可达的目标二>/'
curl --noproxy '*' --connect-timeout 5 --max-time 10 -I http://localhost:5174/
```

## 6. 当前结论

| 子项                                       | 结论                                                                               |
| ------------------------------------------ | ---------------------------------------------------------------------------------- |
| 源码运行资源入口与构建引用链               | 已读审计；未发现外部API、CDN、字体或媒体运行依赖                                   |
| 早期acceptance构建资源完整性               | 历史45记录、78资源哈希、2许可哈希、86文件与87次GET通过；旧指纹保留                 |
| 当前production构建资源完整性               | 45记录、78内容哈希、2许可哈希与80资源/许可路径通过；全部记录与public清单一致       |
| 当前production本地HTTP提供静态文件         | 84文件及根URL共85次GET通过；正确类型、同源、字节一致，读取期间构建未变             |
| 当前production诊断入口排除                 | 单JS无动态/静态模块导入；记录的故障、只读快照、sessionDiagnostics与HMR标记均不存在 |
| 当前Chrome候选ZIP                          | 84项CRC与解压字节匹配；845629字节，归档及SHA-256文件见第8节                        |
| 本机真实外网断开及缓存冷启动               | 未执行、未验证                                                                     |
| 断网状态正常键鼠刷新、进区、重试、保存恢复 | 未执行、未验证                                                                     |
| 最终production构建V06                      | 资源和本地 HTTP 前置审计通过；真实断网未验证，V06 本次不再要求，不计为通过         |

## 7. 历史production构建追加审计

**本节保留UTC 04:06这次审计及 `m5-production-*` 证据的原始结果。该旧包已被第8节的新Chrome候选包替代，未覆盖或删除；本节的“当前”均指该次核对时刻。旧主JS、800字符字体和旧指纹不能用于判定本次发布版本。下方旧指纹复核命令只适用于还原该旧包，不应对新版dist套用。**

本次对主任务已生成的production `dist/` 做独立只读审计，未执行build、原生测试或浏览器动作。UTC时间为 **2026-09-11 04:06:17.741–04:06:18.160**，即本地12:06:17.741–12:06:18.160（UTC+8）；使用已经运行的固定5174 preview。监听检查为Node在 `[::1]:5174`，随后逐文件响应与被审计目录字节一致；没有启动第二个服务。

[`m5-production-build-audit.json`](historical-evidence-files.md#file-76cc9b0cdec55326)是可交付的机器证据，包含84个文件各自的相对路径、类别、大小、SHA-256与HTTP结果；80条声明内容/许可的清单哈希、磁盘哈希和public对照；起终文件集合与指纹；源码入口哈希、依赖分类、被排除的生产诊断标记和未验证边界。每项HTTP记录包含实际URL、最终URL、状态、Content-Type、响应大小、响应哈希及耗时，不把404返回的HTML当作资源成功。

| 类别     | 文件数 |      字节数 | 实际内容                                                   |
| -------- | -----: | ----------: | ---------------------------------------------------------- |
| HTML     |      1 |         476 | 入口只引用下述本地JS和CSS                                  |
| JS       |      1 |      916070 | `assets/index-BAHDLcEY.js`，固定内容和依赖随包             |
| CSS      |      1 |        7940 | `assets/index-XdWH7aHE.css`，两处本地字体URL，无 `@import` |
| PNG      |     33 |      180330 | 稳定ID棋盘图标，实际纹理加载格式                           |
| SVG      |     33 |       15193 | 补制源图，XML检查无外链或活动内容                          |
| WAV      |     10 |      209034 | 全部本地短反馈声音                                         |
| WOFF2    |      2 |      221448 | 中文182064字节、数字39384字节；与该次字体记录一致          |
| JSON     |      1 |      112963 | M5过滤后的45项资源清单                                     |
| TXT      |      2 |        8678 | 两份字体OFL许可                                            |
| **合计** | **84** | **1672132** | **84文件和根URL共85次GET全部200，同源且字节匹配**          |

45条稳定ID唯一，每条包含M5且与当前public清单的对应完整条目一致。45个主资源加33个PNG缓存的78个声明哈希，以及2个字体许可哈希，均与dist和public文件匹配，共80个唯一内容/许可路径。未生成新的资源；没有source map、原始TTF/OTF、DDS或参考截图。

指纹沿用第1节的排序与SHA-256算法。**本次开始与结束指纹相同只表示本次读取期间稳定，不表示与早期acceptance构建相同。** 文件集合、字节和修改时间均未变；13个被读源码入口及public资源清单在同期间也未变。

| 定位                              | SHA-256                                                            |
| --------------------------------- | ------------------------------------------------------------------ |
| production全部84文件开始/结束指纹 | `6a6a7d99799723f5c2527b4056b9fecc72039487938f492fde5aef6b24d565e7` |
| `dist/index.html`                 | `95fffbe843d860967c36f0fd209b28322c821b58af4833e706555956575fa847` |
| `dist/assets/index-BAHDLcEY.js`   | `72784d6612c78244f9929ae8e0fe98905290bd310d55256c984c53aae8fbb228` |
| `dist/assets/manifest.json`       | `6d420167ac9ff8d09aecbc7951662672daeca4bf79c860a5e9df7c343125238a` |

### 7.1 production运行请求入口

重新读取HTML、CSS、主JS及对应源码，确认当前实际入口链：

| 加载入口        | production实际情况                                                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| HTML与模块      | 只引用 `/assets/index-BAHDLcEY.js` 和 `/assets/index-XdWH7aHE.css`；没有远程脚本/样式、preconnect、import map或modulepreload链接    |
| JS导入链        | 只有一个JS，0个动态ES导入、0个静态模块导入；文本中的 `this.actions.import(...)` 是本地文件选择动作，不是ES模块导入                  |
| 图标            | 唯一 `.loadAsync(...)` 调用读取 `/assets/icons/<稳定ID>.png`，33个实际文件全在包内；Three.js内部图片 `src` 接收这条加载链的本地路径 |
| 音频            | 应用 `fetch` 调用读取 `/assets/audio/<稳定ID>.wav`；另一处fetch是Vite模块预加载兼容helper，当前HTML无对应预加载链接                 |
| 字体            | CSS只包含 `/assets/fonts/camellia-ui.woff2` 和 `/assets/fonts/camellia-numerals.woff2`；文件名额外字形回退本机字体                  |
| CRT、模型与内容 | 玻璃/反光/背景/电视几何本机生成；固定地图、迁移内容与已安装Three.js依赖编入JS，无CDN、远程解码器或地图API                           |
| 存档与会话      | localStorage、File.text、Blob URL与navigator.locks；没有外部存档或会话服务                                                          |

主JS仍只有两个外部URL文本：XHTML命名空间 `http://www.w3.org/1999/xhtml`、内嵌GLSL注释里的GGX文献链接 `https://jcgt.org/published/0007/04/01/`。资源清单/许可中的来源URL仍是追溯文本，不是游戏加载地址。当前构建文本扫描没有发现XMLHttpRequest、WebSocket、EventSource、sendBeacon、Worker构造或Service Worker入口；33个SVG的XML也未含外部引用、script、image、foreignObject或style。

当前HTML/JS/CSS中，`acceptance-faults`、`data-acceptance-faults`、验收故障控制、`__CAMELLIA_INSPECT__`、`camellia-inspection`、只读验收快照、`sessionDiagnostics`、`createSessionDiagnostics`、`session-diagnostics`及其存储键、`/@vite/client`、`/@vite/env`、`__vite_ping`、`vite-hmr`均未出现；逐项记录在机器证据。当前文件集合也没有验收或存档共享分块。此结论是最终构建文本和入口链审计，不是浏览器网络全流程抓包。

### 7.2 实际检查和复核方式

本轮实际执行 `node --check dist/assets/index-BAHDLcEY.js`，退出0；只做JavaScript语法解析，没有运行主JS。源码与最终引用检查、SVG XML解析、清单/public/dist哈希核对、85次GET及起终指纹核对均由只读脚本完成，结果如下：

```text
files 84; bytes 1672132
manifest 45; content hashes 78; license hashes 2; unique declared paths 80
HTTP GET 85; all status 200; all same-origin; all bytes match disk
dist file set / bytes / mtime unchanged; inspected source files and public manifest unchanged
production diagnostics and HMR markers absent
resource and local-HTTP audit PASS; actual external-disconnect V06 UNVERIFIED
```

GET禁用环境代理、禁止重定向，并发送 `Cache-Control: no-cache` 与 `Accept-Encoding: identity`；所有响应无内容编码、最终来源仍为 `http://localhost:5174`。84个文件的Content-Type分别为HTML1、JavaScript1、CSS1、JSON1、PNG33、SVG33、WAV10、WOFF2两份及纯文本两份，根页面另核对一次。第3节通用资源GET脚本也可针对当前包复跑；其输出计数须取当前机器证据，不能套用旧86文件常量。

下面的简短命令可重新核对本机dist是否仍与交付证据的84文件及起终指纹一致，不发送网络请求、不重写证据：

```sh
python3 - <<'PY'
import hashlib
import json
from pathlib import Path

record = json.loads(Path(
    "docs/verification/evidence/m5-production-build-audit.json"
).read_text())
files = {
    path.relative_to("dist").as_posix(): path.read_bytes()
    for path in Path("dist").rglob("*") if path.is_file()
}
assert set(files) == {item["path"] for item in record["files"]}
for item in record["files"]:
    raw = files[item["path"]]
    assert len(raw) == item["byteLength"]
    assert hashlib.sha256(raw).hexdigest() == item["sha256"]
listing = "".join(
    f"{hashlib.sha256(raw).hexdigest()}  {path}\n"
    for path, raw in sorted(files.items())
)
fingerprint = hashlib.sha256(listing.encode()).hexdigest()
assert fingerprint == record["snapshot"]["before"]["sha256"]
assert fingerprint == record["snapshot"]["after"]["sha256"]
print(len(files), "files match", fingerprint)
PY
```

本次仅证明当前production资源可由已运行的本地服务完整提供，并核对了源码加载链。浏览器解码、音频播放、实际游戏操作和保存恢复仍由各自验收证据承担；**外网保持可用时的本地200响应不能代替第5节真正断网操作，V06不因此通过。**

## 8. 当前Chrome候选production包审计与归档

本次实际核对时间为 **2026-09-11 08:27:42.640–08:27:43.205 UTC**（本地16:27:42.640–16:27:43.205，UTC+8）。读取主任务已构建的 `dist/`，使用当时固定5174的production preview；监听检查为Node在 `[::1]:5174`。没有重新构建、执行测试、操控浏览器或修改源码 / public / dist。HTTP读取完成后已交回5174服务使用权，后续浏览器验收可以切换服务；本节只描述上述时间窗口。

实际工具版本为Node `v24.18.0`、npm `11.16.0`、Python `3.13.7`、Python标准库 `zipfile`、zlib编译 / 运行版本均为 `1.2.12`；本地已安装Vite `8.3.0`、Three.js `0.185.0`、Oxfmt `0.67.0`。系统版本读取为macOS `26.6.2` / `25G83`，该记录不替代指定硬件矩阵验收。

| 类别     | 文件数 |      字节数 | 本次核对内容                                                   |
| -------- | -----: | ----------: | -------------------------------------------------------------- |
| HTML     |      1 |         476 | 只引用本地JS和CSS                                              |
| JS       |      1 |      917896 | `assets/index-BpL7y5kK.js`，0个动态 / 静态ES模块导入           |
| CSS      |      1 |        7940 | `assets/index-XdWH7aHE.css`，两个本地字体URL，无外部 `@import` |
| PNG      |     33 |      180330 | 棋盘实际使用的透明纹理                                         |
| SVG      |     33 |       15193 | 补制源图；XML无外部引用、活动元素或事件属性                    |
| WAV      |     10 |      209034 | 十种本地短反馈声音                                             |
| WOFF2    |      2 |      221976 | 中文182592字节 / 802必需字符；数字39384字节                    |
| JSON     |      1 |      113374 | 45项M5资源清单，含该次字体输入和来源记录                       |
| TXT      |      2 |        8678 | 两份OFL许可                                                    |
| **合计** | **84** | **1674897** | **84文件及根页面共85次GET全部200，同源、正确类型、字节一致**   |

[`m5-chrome-release-build-audit.json`](historical-evidence-files.md#file-76d5ac682129fa80)逐项记录文件路径、大小、SHA-256、修改时间、HTTP状态 / 类型 / 字节 / 耗时及声明清单对照。45个唯一ID均包含M5且与public清单对应条目相同；45个主资源与33个PNG缓存共78个内容哈希、2个OFL许可哈希，形成80个唯一声明路径。加上HTML、JS、CSS和清单，恰好覆盖全部84文件，没有额外打入字体源OTF / TTF、DDS、参考画面、source map或临时目录。

中文字体是本次缺字修复后的802字符子集，SHA-256为 `c78799c16975421b3513435fa8a71f031434d8d39840682051f804473c89f217`，清单记录1,420个glyph / 1,111个cmap；与public实际字节一致。其源版本、转换和实际解码证据见[美术资源记录](../references/art-implementation.md#51-可复现中文子集)。本次包审计没有另行裁切或生成字体。

### 8.1 实际加载链和稳定指纹

重新搜索当前 `src/`、HTML、Vite配置及内容模块生成入口，读取14个相关文件，核对主包中的两个 `fetch` 调用：一个读取 `/assets/audio/<稳定ID>.wav`，另一个是Vite模块预加载兼容helper；当前HTML没有modulepreload链接。唯一 `.loadAsync(...)` 调用读取 `/assets/icons/<稳定ID>.png`，两个字体URL均为 `/assets/fonts/` 下本地WOFF2。CRT、电视几何和背景由浏览器内存生成，固定地图 / 迁移视图 / Three.js依赖均编入JS。新增[会话进度访问模块](../../src/platform/session-progress.ts)只保留本页内存代数、访问许可和原始槽导出回调，没有资源加载或远程服务调用；存档仍经localStorage、File.text和本机Blob URL处理。

主JS的两个外部URL文本仍分别是XHTML命名空间和Three.js内嵌GLSL中的GGX文献注释；来源清单 / OFL中的URL是追溯文字。最终HTML / JS / CSS没有发现XMLHttpRequest、WebSocket、EventSource、sendBeacon、Worker构造或Service Worker入口。14项故障面板、只读快照、sessionDiagnostics及HMR标记均不存在；33张SVG逐一经XML解析确认无外部加载与活动内容。`node --check dist/assets/index-BpL7y5kK.js` 实际退出0，仅做语法解析，不运行游戏。

GET禁用环境代理、禁止重定向，发送 `Cache-Control: no-cache` 与 `Accept-Encoding: identity`。85个响应均无内容编码，最终来源仍为 `http://localhost:5174`；逐字节及SHA-256对照，避免将HTML回退误判为资源成功。开始、HTTP完成、ZIP复读后三份dist指纹相同；文件集合、全部字节和修改时间均未变。44个 `src/` 文件、14个已读入口、82个public资产文件和52份旧 `m5-production-*` 证据在此次操作前后也未变。

| 定位                               | SHA-256                                                            |
| ---------------------------------- | ------------------------------------------------------------------ |
| 当前84文件开始 / HTTP后 / 结束指纹 | `daa2962d0f1b0d7bb8a06af544485ada9e6395f8447c81544f0c3c0fdd079172` |
| `dist/index.html`                  | `e3b6f8816f0d1f69aad496fa12e4d85e0d560d58db0de18e647c5ab68662079c` |
| `dist/assets/index-BpL7y5kK.js`    | `f4ccd401cec5d6512dfd4fd4a015858486fd3166be5a4d60dfadc4297d5b0753` |
| `dist/assets/manifest.json`        | `dfd663d053d0b0ee85662ae3fbbe55158c1761756acac013d1e8a523529fac6c` |

相较第7节旧production，主JS文件名与字节、HTML引用、中文字体和资源清单发生变化；其余80个同名文件字节一致。旧包的84文件 / 1,672,132字节及原指纹仍只证明旧快照，不自动覆盖本次版本。

### 8.2 独立ZIP与复核命令

本次按授权新建 [`m5-chrome-release-dist.zip`](historical-evidence-files.md#file-a68b083b831dbd7a)，**845,629字节**，SHA-256为 `62b119813a7d3269a95f30f4894e3f4efb5996ccabd054d5fe9acf7d1a888175`；附[SHA-256文件](historical-evidence-files.md#file-90c56e63c8a12b79)和[机器归档清单](historical-evidence-files.md#file-b65a9409eb1d2533)。归档时段为08:27:43.127–08:27:43.187 UTC。只归档dist内84个文件，没有包装父目录，也没有额外文件。

实际使用Python `zipfile` 的DEFLATE level 9，按相对路径排序；每项固定ZIP元数据时间为1980-01-01 00:00:00，权限为普通文件0644，不带本机用户名、绝对路径或文件时间。这个固定时间用于稳定归档元数据，不是源码创建时间。创建后重新打开ZIP，`testzip()` 返回 `None`；全部84项CRC核对通过，逐项解压字节和SHA-256均等于被审计dist，文件集合一致，没有加密项、绝对路径、上级目录跳转或附加项。打包期间dist未变；没有覆盖旧ZIP。

以下命令只读当前包与机器证据，可复核ZIP、声明的审计哈希和dist一致性；若后续重新构建导致指纹变化，应新建审计记录，不能改写本次历史结果：

```sh
python3 - <<'PY'
from pathlib import Path
import hashlib
import json
import zipfile

evidence = Path("docs/verification/evidence")
package = json.loads((evidence / "m5-chrome-release-package.json").read_text())
audit_path = evidence / package["auditFile"]
assert hashlib.sha256(audit_path.read_bytes()).hexdigest() == package["auditSha256"]
audit = json.loads(audit_path.read_text())
archive_path = evidence / package["archive"]
assert hashlib.sha256(archive_path.read_bytes()).hexdigest() == package["archiveSha256"]
files = {
    p.relative_to("dist").as_posix(): p.read_bytes()
    for p in Path("dist").rglob("*") if p.is_file()
}
assert set(files) == {item["path"] for item in audit["files"]}
with zipfile.ZipFile(archive_path) as archive:
    assert archive.testzip() is None
    assert set(archive.namelist()) == set(files)
    for item in audit["files"]:
        raw = files[item["path"]]
        assert archive.read(item["path"]) == raw
        assert len(raw) == item["byteLength"]
        assert hashlib.sha256(raw).hexdigest() == item["sha256"]
listing = "".join(
    f"{hashlib.sha256(raw).hexdigest()}  {name}\n"
    for name, raw in sorted(files.items())
)
fingerprint = hashlib.sha256(listing.encode()).hexdigest()
assert fingerprint == package["distListingSha256"]
assert fingerprint == audit["snapshot"]["before"]["sha256"]
assert fingerprint == audit["snapshot"]["after"]["sha256"]
print(len(files), "files and ZIP match", fingerprint)
PY
```

本次资源审计、同源HTTP和ZIP完整性通过；它们不测浏览器实际解码、音频反馈、键鼠流程或保存恢复，也不证明真实外网断开后的运行。**V06实际断网仍未验证，不能将本包审计结果写成全量验收通过。**

## 9. Chrome 请求隔离尝试：未建立，任务标签已关闭

2026-09-11，在第8节同一production包、固定5174服务和自身真实1109代存档基础上，尝试使用Chrome原生DevTools的Request conditions隔离外部请求。仅使用CUA公开原生界面和正常导航；没有CDP、终端浏览器控制、网络脚本、存储写入或游戏状态注入。**本次未建立并证明“外部阻断、localhost放行”，没有进行隔离下的游戏验收，V06仍为未验证。** [实际尝试记录](historical-evidence-files.md#file-c60814c5d13803c6)区分了观察结果、推断及剩余清理事项。

[Chrome官方说明](https://developer.chrome.com/docs/devtools/request-conditions)确认规则按首个匹配项生效，关闭DevTools会停用请求阻断，但规则仍会保存。因此原计划是在本任务标签中先配置localhost豁免，再添加其他请求阻断；没有使用会同时封锁本地服务的“全部离线”模式。本节也不将浏览器级请求条件等同于整机所有外网通道已断开。

### 9.1 实际操作与观察

| 步骤           | 实际结果与证据                                                                                                                                                                                                                                                                                            |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 保存原设置     | [初始设置摘录](historical-evidence-files.md#file-2f8117da8291fd40)：Request conditions没有规则且未启用；设备仿真开启、1920×1080、Fit to window；Disable cache开启；Keep log关闭；Network过滤文字为`Request conditions`。没有覆盖既有规则。                                                                |
| 第一个外部对照 | 同一任务标签正常访问并刷新`https://example.com/?camellia-offline-control=20260911`；[页面与Network摘录](historical-evidence-files.md#file-57be54a2906a214b)包含对应请求的200 OK。                                                                                                                         |
| 第二个外部对照 | 正常访问`https://example.org/?camellia-offline-control=20260911`，Example Domain页面可见；[实际摘录](historical-evidence-files.md#file-9d97d6b9393cb6c4)中的Network仍只显示此前example.com行，因此未取得example.org响应状态，不把旧行当作新请求200。                                                      |
| 配置尝试       | 两次依据新鲜AX点击Add condition后，紧接的AX均未显示编辑表单；DevTools内的Reload page曾返回工具错误`elementHasNoFrame`。后一次设置记录出现启用的`*://*` / Block规则、0 affected。未输入过该pattern，可能是Add的默认值，此处只是推断；localhost豁免始终未配置完成，也没有取得`(blocked:devtools)`对照证据。 |
| 停止原生操作   | 后续新鲜AX显示当前所选标签与验收目标不一致、变成非任务页面，原因未确认；立即停止全局原生键鼠，未操作该页面。这是界面控制与取证未完成，不能归因于游戏缺陷。                                                                                                                                                |

原生全窗AX包含用户其他标签或扩展内容，完整记录仅留在忽略的`test-results/m5-chrome-offline-raw/`。随仓库交付的文字证据只摘取本任务的DevTools设置、两个对照URL及相应状态，省略其他标签、书签、扩展请求和非任务页面正文。

### 9.2 保护进度与恢复边界

停止前的实际AX确认Keep log已恢复关闭；设备仿真、画质和Disable cache从未修改。网络过滤文字尚为空，原值为`Request conditions`。新出现的默认阻断规则是否已被删除尚未验证，不能写成所有DevTools设置均已恢复。

随后按主任务授权，通过本任务标签自身的公开`close()`接口关闭仅由本agent拥有的Chrome标签546939540及其附属DevTools；[关闭记录](historical-evidence-files.md#file-d24a22c555afb915)和紧接的只读浏览器清单确认该ID已不存在，未关闭其他标签、未新建页面。依据官方行为，该目标的请求阻断随DevTools关闭停用；**持久规则的删除及过滤文字恢复仍待可安全操作的窗口，不将目标关闭等同于规则清除。**

本次没有执行游戏命令，没有修改或清除存档。[此前正常UI导出的1109代真实存档](historical-evidence-files.md#file-ff76a37c4bc25ef5)继续保留：中央仓库`warehouse.t.7.0`、26个奖励、130单位物资、默认设置。这里是对已有导出文件的保护记录，不是隔离后的保存恢复证据。外部请求失败、localhost隔离刷新、进区、静态/实时重试和隔离下保存恢复均未验证。

### 9.3 取消离线验收后的有界清理尝试

用户随后表达不要求断网游玩，本次后续操作仅清理第9.2节残留，不再执行离线验收。[清理尝试记录](historical-evidence-files.md#file-15944ec90c84c9cc)保存了脱敏目标、工具错误和关闭确认。

新建专用localhost标签546939601后，正常启动页显示中央仓库、130单位物资及继续按钮。发送DevTools快捷键前，同次调用先核对原生窗口的精确URL；当前前台为非任务标签，保护检查阻止了快捷键。随后依据新鲜AX仅选择唯一的“🧹 DevTools 清理”任务标签时，原生工具在27.025秒返回ScreenCaptureKit `-3811`：音视频捕获失败。没有取得可用截图，没有打开DevTools或接近删除控件，也没有修改规则、过滤文本或其他设置。

遵循一次有界尝试的限制，没有重试；通过该临时标签自己的`close()`关闭它，紧接的只读浏览器清单确认546939601已不存在。没有操作或关闭其他标签，没有执行游戏命令、清除存储或覆盖1109代导出。**清理未完成：原默认`*://*`规则的删除及过滤文字恢复仍未验证；原任务与本次临时标签均已关闭。** 此工具故障不作为游戏缺陷，也不将未完成清理写成环境完全恢复。

人工清理仅针对本任务新增项：在自己选定的页面打开 DevTools，使用命令菜单显示 Request conditions；若仍有本次新增的唯一 `*://*` / Block 规则，删除它并关闭请求阻断。将 Network 过滤文字恢复为 `Request conditions`。原设备仿真开启、1920×1080、Disable cache 开启、Keep log 关闭，无需因本任务更改这些值。若看到其他既有规则，保留它们，不按本记录清空全部设置。以上为尚未执行的恢复说明，关闭 DevTools 已停止此前任务目标的运行中拦截。
