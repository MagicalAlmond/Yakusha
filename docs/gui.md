# GUI 设计与用户流程（Electron 外壳，0.14 起；0.72 重做界面）

> 状态：0.14 已交付最小外壳（`gui/main.js` + `preload.js` + `renderer/`，含原生目录选择、export/import/speaker/terms/config/launch 按钮、「记住密钥」（safeStorage，见 §5）、最小字典编辑器（见 §3 字典编辑分区）），长任务接口（进度事件 + 取消）随 0.14 的 runner seam 落地；0.16 起按钮可用性按 §3 的规则由 `capabilities` 驱动（`scan` 载荷新增 `capabilities`，不支持交付层的引擎灰掉 install/uninstall 并写明原因；0.18 起 RGSS 的注入交付层落地（0.71 起普通 `install` 自动选择原生注入器，不再需要 `--native`），install/uninstall 不再灰）；本文其余部分仍是演进的设计稿（完整字典编辑界面未做——已交付的是 §3 描述的最小逐条编辑器）。0.20 起渲染层另有 `test/gui-renderer.test.js` 的 stub-DOM 契约测试（0.75 起 19 条），并在每次扫描开始时清空上一个引擎的能力位；0.57 起主进程另有 `test/gui-main.test.js` 的 stub-Electron 契约测试（0.72 起 20 条），该轮修复两条主进程接缝缺陷（取消信号从未传进 runner、「记住密钥」撞 `const` 崩溃，见 §6/§9）；0.58 起 preload 桥也有 `test/gui-preload.test.js`（11 条），钉死三方一致（桥 ↔ handlers 白名单 ↔ index.html 按钮）。0.65 起单实例锁拿不到不再静默退出：打 stderr、弹错误框并指明 profile 目录与 `--user-data-dir` 出路（见 §10 启动与排障）。0.72 重做界面（左侧导航 + 三阶段工作台），并把运行日志改成右下角 toast 摘要：详细请求、警告与结果写入 JSONL 日志文件，界面只显示一行结论和日志路径（见 §3/§5/§10）。0.73 起每条命令都跑在 `gui/worker.js` 的 worker 线程里，主进程只保留窗口、IPC、单飞与取消转发；信封、界面与按钮契约不变，另加 `test/gui-worker.test.js` 4 条跨线程契约测试。0.78 起交付卡按 `capabilities.runtime` 显示五档交付说明（L4-plugin / L4-resource / L4-inject / L4-patch / L3-only），并新增 `tools/gui-acceptance.mjs` 真机窗口走查（五引擎 install → uninstall → doctor）。

## 1. 定位与边界

GUI 是 core 之上的玩家向外壳：拖入游戏目录 → 识别引擎 → 扫描/提取 → 翻译 → 校验 → 安装 → 启动，
把 CLI 的完整链路包装成不需要记命令的流程。它不新增能力，不复制逻辑：
[architecture.md](architecture.md) §2 已定下分层——`gui/` 主进程直接 import `src/`，与 CLI 调同一份 core。

一句话边界：**GUI 是库的客户端；每个按钮都必须对应一条已写入文档的库调用或 CLI 命令。**
做不到这条映射的按钮不进界面。GUI 明确不做：

- 云账号、遥测、崩溃上报、任何形式的统计数据收集；
- 内置任何 provider 的密钥或代理服务；
- CLI/库做不到的引擎工作（GUI 出现新能力之前，必须先在库层落地）；
- 自动改写超出库层契约的文件（不绕过 install/uninstall 的备份与还原规则）。

## 2. 前置条件（为什么排在 0.14）

GUI 排在 0.14 不是资源问题，是依赖顺序（ENGINE-STRATEGY §6.3）：

| 版本 | 先决条件 | 对 GUI 的意义 |
| --- | --- | --- |
| 0.10.x | 引擎拆缝：profile + rmFilePlan，pipeline 从 `options.profile` 读引擎事实 | GUI 才能不写引擎特判地驱动多引擎 |
| 0.11 | Ren'Py（`.rpy` + `.rpyc`、translation-file 交付） | 第二个家族验证抽象是否通用，GUI 不能只包 MZ/MV |
| 0.12 | RGSS inject + 原生 helper、组件分发/签名/manifest | GUI 需要的"原生组件安装向导"才有真实对象 |
| 0.13 | 表格导出与回灌（TSV/CSV + `import`） | 字典编辑/导入导出界面才有可用的格式契约 |

> 0.12 注记：0.12 实际只交付 RGSS 的 L1–L3（识别 / 盘点 / 提取 / 翻译 / 校验）。交付层在 0.18
> 以原生注入器 + hook DLL 落地（`install` 自动选择，组件随 npm 包分发、SHA-256 manifest、
> 不改游戏文件），[DEVLOG](dev/DEVLOG.md) §8.1 第 10 行记录的路线已执行；上表按 2026-10-25
> 的拍板路线保留。

在 0.13 之前动工，GUI 只能做成一个 MZ/MV 专用壳，0.11–0.13 的每一版都要回头改 UI；
在 0.12 之前动工，原生组件的分发/校验/缺组件提示没有契约可依。
GUI 版本只做壳与它需要的接口（能力矩阵、原生组件向导、进度/错误展示），不夹带新引擎。

## 3. 界面分区与主流程

八个分区。每区列出驱动的 CLI 命令、消费的 JSON 载荷、失败时用户看到什么
（退出码与错误码遵循 [json-contract.md](json-contract.md)，GUI 按 `outcome` + `error.code` 分支，
不解析 `message` 文案）。按钮可不可点由 adapter 的 `capabilities` 决定，未实现能力灰掉并写明原因（0.16 起能力位随 `scan` 载荷下发，当时 `runtime: null` 的引擎灰掉 install/uninstall、`launch: false` 灰掉启动；0.74 起五个引擎都有 runtime 档位，没有 `null` 引擎，KRKR 的 `runtime: "patch"` 也启用 install/uninstall；RGSS 从 0.18 起有注入档，0.71 起普通 `install` 自动选择）。

| 分区 | 驱动的命令 / 库调用 | 消费的载荷 | 失败时用户看到 |
| --- | --- | --- | --- |
| 项目选择 | `detect`（库）/ `scan --json` | `root, engine, engineVersion, gameTitle, dataFiles, uniqueStrings, totalStrings, undecodable` | `E_NOT_PROJECT` / `E_MULTI_ROOT`（退出 2）：列出候选与证据，不猜测 |
| 扫描与统计 | `scan` / `status` | scan 载荷 + `file, translated, pending, withError` | `E_NOT_PROJECT`（退出 2）；`undecodable` 非空时展示文件清单 |
| 字典编辑 | `extract` / `export --json --out <f>`（原设计；0.14 另有下面的最小逐条编辑器） | `file, added, total, translated, pending`；export 的 `out, entries, bytes` | `E_NO_DICTIONARY`（退出 2，提示先提取）；`E_EXISTS` / `E_IO` |
| 翻译执行 | `translate`（`--limit`/`--context`/`--glossary`/`--save-every`） | `provider, translated, rejected, failedBatches, progress{total,translated,pending}` | `E_CONFIG`（缺 provider/model/key，退出 2）；`E_PROVIDER`；`rejected > 0` 仍是 `ok`，按 pending 数字提示跑 verify |
| 校验 | `verify`（`--kind`/`--limit`/`--write-report`） | `errors, warnings, counts, problems[{kind,severity,key,target,detail}]` | findings（退出 1）不是命令失败：按 kind 分组展示，error 拦安装按钮 |
| 安装与卸载 | `install` / `uninstall` / `launch` | `pluginPath, state, backupPath`（RGSS 另带 `native{dir, files, dictionaryEntries, dryRun}`）；`removed, restored, drifted, keptBackup`（RGSS 另带 `native{dir, removed}`）；`root, exe, pid` | `E_EXE`（launch 多/无 .exe，列 details.candidates）；`E_UNSUPPORTED_PLATFORM`；`drifted: true` 时明确"只摘了自己那条，备份保留"；RGSS 没有字典时 `E_NO_DICTIONARY` |
| 设置 | `config list/get/set/unset` | `values{provider,model,baseUrl}, apiKey{set,source}` | `E_CONFIG`（文件损坏，不覆盖）；`E_USAGE`（非法值，退出 2） |
| 诊断 | `doctor`（`--max-length`） | `verdict, checks[{id,level,message}]` | broken → findings（退出 1）：逐项列出 fail/warn 与建议动作 |

术语/说话人整理（`terms`、`speaker`）挂在字典编辑与校验之间，作为可选步骤展示：
两者都只动字典、不调模型，`--dry-run` 结果先展示再应用。

**操作反馈（0.72）**：每个命令点击后立即在右下角出现 toast（busy → success / warning / error），正文只有一行摘要（例如 `scan` 报引擎与字符串数、`install` 报组件与字典条目数），失败带错误码与消息。完整请求、警告和结果信封按 JSONL 追加到日志文件，界面不再在页面底部堆一份 Activity 文本；日志面板只显示文件路径和 `Open log file…` 按钮。toast 最多同时 4 个，成功 4.2 秒、失败 8 秒自动消失，也可点击关闭。

**0.14 已交付最小编辑器**：`Edit dictionary…` 按钮经 `gui:dict-load` 读字典
（`gui/dictionary.js` 复用 `src/core/dict.js` 的加载与校验，坏文件报与 CLI 相同的
`E_DICTIONARY` 文案），显示 translated/pending 计数，并列出前 200 条 pending 供
逐条编辑；保存经 `gui:dict-save` 每次写一条（`writeEntry` 校验 key 与文本类型，
未知 key 报 `E_USAGE`，写盘失败报 `E_IO`）。这两个通道不是 CLI 命令，不在
`GUI_COMMANDS` 里，与 run/cancel 一样是显式白名单。大批量编辑仍推荐
export/import（§3 字典编辑分区的驱动命令不变）。

## 4. 长任务与进度

`translate` 是唯一的长任务：数万条、批请求、可能跑整晚。GUI 需要的是**事件流**：
进度（第几批 / 每秒条数）、暂停/取消、可恢复的中间态。

**0.14 已补上接口**：runner seam 提供 `onProgress`（每批完成一次回调，
`{done,total,translated,rejected}`）与协作式取消（`AbortSignal`，翻译中的请求
自然结束、已翻条目保留，载荷里 `cancelled: true` 标记）。GUI 的进度条与
取消按钮都建立在这两个接口上，不再有黑盒模式；恢复机制仍是
`--save-every` 周期落盘（默认 200），中断后重跑同一命令即可续跑。（0.57 修复：0.14–0.56 的外壳里，取消按钮 abort 的控制器从未传进 runner，`gui:cancel` 与窗口关闭一直空转；`test/gui-main.test.js` 已把「取消必须到达 runner」钉住。）

**当前 core 没有事件流。** CLI 靠 `--save-every <n>`（默认 200）把字典周期性落盘，
中断后重跑同一命令即可续跑——这是今天唯一存在的"恢复机制"，没有进度事件、没有取消信号、
没有跨进程的状态查询。GUI 不能伪造进度：0.14 之前 core 必须补上长任务接口
（进度事件 + 取消 + 状态查询），这是 GUI 前置的接口工作，不是壳内能绕过的缺口。

进度条只画 runner 真实回报的 `done/total`，不插值、不轮询；没有回调就不画条。
（架构上长任务跑在 `worker_threads` 里，经 `gui/worker-host.js` 转 IPC 再推给渲染进程，见 architecture.md §6；
渲染进程不碰文件系统与密钥。）

## 5. 凭据与隐私

- CLI 的规则不变：`config` 文件永远没有 `apiKey`，密钥只来自 `--api-key` 或环境变量
  （[config.md](config.md) §1/§4）。GUI 不改变这条规则。
- GUI 的"记住密钥"用系统凭据存储：Electron `safeStorage`（Windows 上是 DPAPI），
  只在用户显式勾选时写入；读不出来时提示重输，不回退明文（[config.md](config.md) §8）。
  CLI 永远不读 GUI 存的凭据，两套来源不打架。**0.14 已交付**：
  `gui/credentials.js`（信封 `{schema:1, cipher:"safeStorage", data:<base64>}`，
  写在配置文件同目录的 `credentials`），勾选"use stored key"时主进程把密钥
  作为 `--api-key` 注入 translate，渲染进程不落盘、不回显。
- 日志与展示沿用现有脱敏（[json-contract.md](json-contract.md) §4.2）：`sk-***`、`Bearer ***`、
  userinfo 打码、home 目录折叠成 `~`、provider 响应体不进日志。0.72 起 GUI 另有一份
  运行日志：每次命令把 `run.start`（命令、参数、脱敏后的 flags，`api-key`/`token`/
  `secret`/`authorization` 写成 `[redacted]`）、`run.warning` 与 `run.result`（耗时 +
  完整信封）以 JSONL 追加到 `%APPDATA%\yakusha\logs\gui.log`（配置目录被
  `YAKUSHA_CONFIG_DIR` 覆盖时跟着走）。渲染层只显示短 toast，不展示原始载荷。
- `YAKUSHA_DEBUG=1` 仍是排查开关，堆栈只进 stderr；GUI 的运行日志文件与它不冲突，
  诊断结论仍以 doctor / verify 的载荷为准，日志不外传、不做统计。
- `launch` 启动游戏前删掉子进程环境里的 `YAKUSHA_API_KEY` / `OPENAI_API_KEY`；GUI 启动游戏必须走同一条路，不得旁路。
  **0.14 已交付**：外壳的 launch 按钮经 `runGuiCommand("launch", …)` 走与 CLI 相同的
  `runCommand` → `launchProject`（同一处环境清洗、同一个 `--exe` 契约），
  主进程不做任何自己的进程管理。

## 6. 失败与回滚

GUI 的安装/卸载界面必须如实呈现四档交付（ENGINE-STRATEGY §5.5）与 L3-only 状态，
**禁止出现"完全可逆""一键还原"类承诺**：

| 档 | 界面如实写 | 卸载后的真实状态 |
| --- | --- | --- |
| L4-plugin（MZ/MV） | 安装即备份 `js/plugins.js`，卸载时逐字节还原 | `uninstall` 的 `restored: true`；检测到漂移（`drifted: true`）时只摘自己那条、保留备份 |
| L4-resource（Ren'Py） | 生成/替换引擎自带翻译资源，删资源即恢复 | 游戏文件按引擎机制恢复 |
| L4-inject（RGSS，0.18 起） | 原生组件随 npm 包分发（SHA-256 `manifest.json` 校验），装进 `yakusha/native/`；不改游戏文件，卸载后游戏照常运行 | 删 `yakusha/native/` 即恢复；`inject` 失败必须能回退原版启动；未签名组件可能被杀软误报 |
| L4-patch（Kirikiri，0.74 起） | 写一个引擎会加载的覆盖归档（`data/patch.xp3` + `yakusha/krkr-patch.json` 清单），删归档即恢复；原归档不改 | 删覆盖归档与清单即恢复；原 `data.xp3` / `patch.xp3` 字节不变 |
| L3-only | 界面明说"只能提取/翻译/校验，交付需要你自行部署" | 不适用 |

降级必须显式确认：插件失败不能静默改 patch（ENGINE-STRATEGY §8）。
install 的 `staleBackup: true` 与 uninstall 的 `drifted: true` 都要停下来让用户看清楚，
不提供"忽略并继续"的一键跳过。

## 7. 打包与分发

- Electron 只进 devDependencies，core 保持零第三方依赖（architecture.md §1）；
  便携包解包后约 308 MB（Electron 37 运行时占大头；压缩后的分发体积取决于打包方式），首次运行可能被 Defender 拦一次——这是壳的成本，写进文档，不掩盖。构建、校验与发布说明见 [release.md](release.md)。
- Windows 代码签名：0.10/0.11 不做（纯 JS）；0.18 起已有原生组件（RGSS 注入器与 hook DLL），
  2026-11-07 拍板暂不签名，1.0 按未签名发布，完整性靠 SHA-256 manifest；证书路线、成本与
  SmartScreen 四道拦截见 ENGINE-STRATEGY §9.3/§9.4。GUI 与 [release.md](release.md) 都
  如实说明未签名与首次运行可能被拦。
- **首个 GUI 版本不做自动更新**：更新渠道、增量与校验未设计；用户从发布页手动更新。
  这不是省事，是避免在签名问题解决前引入一个未被审计的下载通道。

## 8. 非目标清单

GUI 永远不做以下事情（与 [limitations.md](limitations.md) 的工具边界一致）：

- 游戏内悬浮窗 / 运行中改字典热生效（`liveReload` 契约位存在、始终为 false，无排期）；
- OCR / 图片文字翻译（`img/pictures` 不在文本面内）；
- 字体替换或字体补丁；
- 补丁广场 / 汉化分享社区 / 云端字典同步；
- 多用户、多角色权限、远程协作；
- 遥测、崩溃上报、匿名统计；
- 绕过 CLI/库直接操作游戏文件（GUI 没有自己的写文件通道）。

## 9. 验收标准

0.14 的 GUI 算做完，当且仅当以下全部成立：

- [x] 每个界面分区都对应本文第 3 节的表格：有命名的库调用或 CLI 命令，没有私有 API。（0.14–0.16：14 命令白名单 + 两条字典专用通道，test/gui-handlers.test.js 盯着）
- [x] 每个按钮点击产生的行为都能在 CLI 里找到等价命令，输出一致（同一 core）。（信封逐键对拍）
- [x] 按钮可用性由 `capabilities` 驱动：不支持的能力显示灰色 + 原因，点击后报错视为设计缺陷。（0.16 交付）
- [x] 长任务有真实的进度事件与取消，结束后载荷与 CLI 的 `--json` 一致；没有假进度条。（0.14 runner seam + AbortSignal；0.57 修复主进程漏传 signal 的接缝缺陷）
- [x] 翻译中断后能从落盘的字典继续（`--save-every` 语义或其后续接口），不需要用户重头跑。（已翻译条目不重翻，取消后已翻的保留）
- [x] 安装/卸载界面对四档交付的描述与 ENGINE-STRATEGY §5.5 逐字对齐，无"完全可逆"承诺。（0.78：`gui/renderer/delivery.js` 的五档文案与 §5.5 对齐，`#delivery` 卡由 `capabilities.runtime` 驱动；`tools/gui-acceptance.mjs` 在 Electron 真窗逐档核对）
- [x] 在四档测试矩阵上，从 GUI 卸载后游戏回到可运行状态（plugin 档逐字节还原）。（0.78：`tools/gui-acceptance.mjs` 在真窗跑通 MZ/MV（plugin）、Ren'Py（translation）、RGSS（inject）、Kirikiri（patch）的 install → uninstall → doctor；plugin 档 `js/plugins.js` 与 patch 档原 `data.xp3` 均逐字节校验）
- [x] 密钥只存在于系统凭据存储或内存；`config` 文件、游戏目录、日志与导出文件里都没有。（test/gui-credentials.test.js：文件里只有密文信封）
- [x] 拖入非项目目录、多项目目录、损坏字典时，错误提示与 CLI 的错误码一一对应。（gui-handlers 对拍）
- [x] MZ/MV + Ren'Py + RGSS 三条链路都能从 GUI 一键跑通（ENGINE-STRATEGY §6.3 的 0.14 验收）。（`test/gui-e2e.test.js` 已按 GUI 的调用缝 `runGuiCommand` 把三条链路的完整命令序列各走通一遍（RGSS 走普通 `install` 自动选择）；剩下的未验部分只有 Electron 窗口本身的点击与渲染。0.16 复查：`gui/main.js` 能被 Electron 37.2.3 加载、`BrowserWindow` 能创建（隐藏窗口冒烟 exit 0）。0.65 更正：单实例锁创建失败不是进程令牌的宿命，而是浏览器进程写不了默认 profile 目录（未设应用名时为 `%APPDATA%\Electron`，错误框里打印的就是实际目录）（`process_singleton_win.cc:454 Lock file can not be created! Error code: 5`）；把 `--user-data-dir` 指到可写目录后应用能正常起窗（实测窗口句柄非 0），指到不可写目录仍报同一个 error 5。0.65 起锁失败会打 stderr 并弹错误框，指明目录与 `--user-data-dir`，不再静默退出（§10）。0.67 补充：起不来的最后一段也修好了——profile 目录在拿锁前先探测，默认目录写不进去就自动回退到应用目录旁的 `.yakusha-gui-profile`（或 `YAKUSHA_GUI_PROFILE`），仓库内的 Electron 因此能靠回退目录开窗（实测窗口句柄非 0）；剩下未验的仍是真机点击。0.78 用 `tools/gui-acceptance.mjs` 在 Electron 真窗逐链点击跑通五引擎（MZ/MV/Ren'Py/RGSS/Kirikiri）并校验 install/uninstall 产物；0.79 起该工具支持 `--exe dist/yakusha-<version>-win-x64/Yakusha.exe`，同一套五链可直接在便携包上复跑。）
- [x] 每次命令点击后都有即时 toast 反馈：busy 起始、结束按 `ok`/`outcome` 变 success/warning/error，正文是一行摘要；详细请求与结果只进日志文件，界面提供 `Open log file…`。（0.72：`test/gui-renderer.test.js` 的 toast 三条 + `test/gui-main.test.js` 的日志脱敏与打开通道）
- [x] 渲染层的扫描状态、能力灰显、字典编辑与密钥输入有 stub-DOM 契约测试（0.20 起 `test/gui-renderer.test.js`；0.56 起补齐拖放（`pathForFile`）、目录选择、取消转发与进度/警告接线；0.72 起 toast 摘要、失败提示与日志面板，0.75 起源语言选择器随 translate/verify 下发的 flags，0.78 起交付卡五档文案与回退，0.80 起最近项目与窗口图标，共 23 条；真机窗口交互见上一行）。
- [x] 主进程（`gui/main.js`）有 stub-Electron 契约测试（0.57 起 `test/gui-main.test.js`，0.72 起 20 条、0.80 起 21 条：单实例锁、IPC 白名单、窗口安全参数、取消真达 runner、凭据/字典/目录选择通道、运行日志脱敏与 `gui:log-path`/`gui:open-log`、窗口状态持久化）——随测试修复取消断链与「记住密钥」撞 `const` 崩溃两条接缝缺陷。0.73 起 `test/gui-worker.test.js` 另有 4 条跨线程用例（scan 信封对拍、translate 的进度跨线程、项目错误、未知命令），并验证所有命令共享单飞闸门。
- [x] preload 桥有 stub-Electron 契约测试（0.58 起 `test/gui-preload.test.js`，11 条：暴露面、命令表与 handlers 白名单及 index.html 按钮三方一致、逐方法的 IPC 通道与请求形状、可取消的进度订阅）。
- [x] Settings 的「源语言」选择器（Japanese / English，默认 Japanese）只在 Translate 与 Verify 时生效：两者都显式下发 `--source-lang`（默认值也下发，便于对拍），scan/extract/status/install 等其余命令不带该 flag。（0.75 交付，`test/gui-renderer.test.js` 断言默认值与切换后的 flags）
- [x] 最近项目与窗口身份（0.80）：成功 scan 的目录写入 `localStorage`（最多 5 个，按路径去重），项目卡下方显示一键重扫的 chip；失败 scan 不写入；窗口与任务栏使用 `gui/assets/app-icon.ico`；窗口大小、位置与最大化状态存进 profile 的 `window-state.json`，下次启动原样恢复。`test/gui-renderer.test.js` 的最近项目两条、`test/window-state.test.js` 的四条、`test/gui-main.test.js` 的窗口 icon 与窗口状态断言、`tools/gui-acceptance.mjs` 的 recent 检查共同覆盖。

## 10. 启动与排障

```bash
pnpm install            # 开发依赖含 electron；运行时仍是零依赖
npm start               # 等价于 npx electron gui/main.js
```

便携包不经过 npm：双击 `dist/yakusha-<version>-win-x64/Yakusha.exe` 即可；构建、`--verify` 与 `--exe` 验收见 [release.md](release.md)。

窗口不出现时按这个顺序看：

1. **没有任何反应、退出码 0**：Electron 的单实例锁没拿到（注意与第 6 条区分：那条是连进程都没活到应用代码）。0.65 起会打一行 `[yakusha] ...` 并弹错误框；错误框里的目录就是写不进去的 profile 目录（本构建默认 `%APPDATA%\Electron`——`gui/main.js` 没有设置应用名，Electron 用兜底名 `Electron`；注意这不是 Yakusha 的配置目录 `%APPDATA%\yakusha`）。0.67 起在拿锁**之前**先探测这个目录：写不进去就自动回退到应用目录旁的 `.yakusha-gui-profile`（或用 `YAKUSHA_GUI_PROFILE` 指定的目录），并在 stderr 打一行 `the default profile folder is not writable; using <dir>`；只有三个候选目录都写不进去才会走到这个错误框。
2. **`Lock file can not be created! Error code: 5`**：浏览器进程对该目录没有写权限（只读 profile，或被沙箱/安全软件限制的目录）。换一个可写目录即可：

   ```bash
   npx electron gui/main.js --user-data-dir=D:\path\to\writable\folder
   ```

   0.65 实测：`--user-data-dir` 指到可写目录后窗口正常创建；指到不可写目录仍报同一个 error 5。0.67 起这条错误前面通常还有一行自动回退提示——有那行说明回退已经生效、窗口应该已经起来了；错误框仍然出现则说明回退目录也写不进去。
3. **`Cannot read properties of undefined (reading 'exports')`**：`ELECTRON_RUN_AS_NODE=1` 被继承进了终端，Electron 变成纯 Node 跑。清掉再启动：`Remove-Item Env:ELECTRON_RUN_AS_NODE`。
4. **`EXCEPTION_BREAKPOINT` / 0x80000003 崩溃**：Chromium 沙箱初始化失败，加 `--no-sandbox` 再试（只改本机渲染进程隔离，不改代码）。
5. **两件事同时发生**：先 `-2147483645` 静默退出、加 `--no-sandbox` 后才看到锁错误框——说明沙箱崩溃与 profile 不可写是两层独立故障，两个参数都要给：

   ```bash
   npm start -- --no-sandbox --user-data-dir=D:\yakusha-gui-profile
   ```
6. **什么都没打印、终端立刻回到提示符**（`npm start` 只留两行 banner）：进程在 `gui/main.js` 执行之前就死了，最常见的是上一条的沙箱初始化崩溃——崩溃发生在 Chromium 内部，应用代码没有机会打任何字。用退出码确认：`npm start; $LASTEXITCODE` 得到 `-2147483645`（0x80000003）即是。此时先试 `npm start -- --no-sandbox`（npm 会把 `--` 之后的参数透传给 `electron`），窗口能起来就说明是沙箱问题。
7. **`--user-data-dir` 指到任何可写目录都仍报 error 5，而且那个目录事后根本没被创建**：说明限制不在目录，而在**可执行文件的位置**——某些环境（应用沙箱、把数据目录里的程序关起来的终端防护）只允许映像在项目内的进程写项目内的路径，`--user-data-dir` 挪不动这条限制。此时把 Electron 放到项目外运行（全局安装，或把 `node_modules/electron/dist` 复制到别处再用那里的 `electron.exe`），项目外的同一份程序不受此限。0.67 实测：仓库内的 `electron.exe` 带 `--no-sandbox` 也能靠回退目录开窗，但写入范围仍只在项目内；仓库外的副本连 `--no-sandbox` 都不需要。

`--user-data-dir` 只挪 Electron 的 profile（缓存、Local Storage、单实例锁），**不挪** Yakusha 自己的配置与凭据——那些在 `%APPDATA%\yakusha`（或 `YAKUSHA_CONFIG_DIR` 指定的目录），见 [config.md](config.md) §8。两个目录同名不同物：`%APPDATA%\yakusha` 是 Yakusha 的配置文件，`%APPDATA%\Electron` 是 Electron 的 profile。

运行日志是第三样东西：`%APPDATA%\yakusha\logs\gui.log`（`YAKUSHA_CONFIG_DIR` 覆盖时是 `<配置目录>\logs\gui.log`）。它是 JSONL，一行一个事件（`run.start` / `run.warning` / `run.result`），只在本机追加，不轮转、不上传；界面右下角 toast 只是它的摘要。要看完整输出时点日志面板里的 `Open log file…`，或用编辑器直接打开。

## 相关文档

- [architecture.md](architecture.md)：分层、EngineAdapter 契约、GUI 与 core 的边界
- [commands.md](commands.md)：14 个命令的选项、载荷与实测输出
- [json-contract.md](json-contract.md)：信封、退出码、错误码——GUI 分支处理的唯一依据
- [config.md](config.md)：配置、密钥不落盘、GUI 凭据存储的既定边界
- [engines.md](engines.md)：能力矩阵、launch 契约、attach 桩
- [limitations.md](limitations.md)：工具边界（GUI 非目标的来源）
- [export-format.md](export-format.md)：导出格式（字典编辑分区的输入/输出）
- [dev/ENGINE-STRATEGY.md](dev/ENGINE-STRATEGY.md)：§5.5 四档交付与 L3-only 状态、§6.3 版本排期、§9 签名决策
- [../README.md](../README.md)：安装与快速上手
