# GUI 设计与用户流程（Electron 外壳，0.14）

> 状态：0.14 已交付最小外壳（`gui/main.js` + `preload.js` + `renderer/`，含原生目录选择、export/import/speaker/terms/config 按钮），长任务接口（进度事件 + 取消）随 0.14 的 runner seam 落地；本文其余部分仍是演进的设计稿（字典编辑界面、safeStorage、launch 未交付）。

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
| 0.13 | 字典导出 v2（TSV/CSV） | 字典编辑/导入导出界面才有可用的格式契约 |

> 0.12 注记：0.12 实际只交付 RGSS 的 L1–L3（识别 / 盘点 / 提取 / 翻译 / 校验），
> 交付层两条路线（纯 JS 写回 vs 原生注入）未拍板（[DEVLOG](dev/DEVLOG.md) §8.1 第 10 行），
> 上表按 2026-10-25 的拍板路线保留。

在 0.13 之前动工，GUI 只能做成一个 MZ/MV 专用壳，0.11–0.13 的每一版都要回头改 UI；
在 0.12 之前动工，原生组件的下载/校验/缺组件提示没有契约可依。
GUI 版本只做壳与它需要的接口（能力矩阵、原生组件向导、进度/错误展示），不夹带新引擎。

## 3. 界面分区与主流程

八个分区。每区列出驱动的 CLI 命令、消费的 JSON 载荷、失败时用户看到什么
（退出码与错误码遵循 [json-contract.md](json-contract.md)，GUI 按 `outcome` + `error.code` 分支，
不解析 `message` 文案）。按钮可不可点由 adapter 的 `capabilities` 决定，未实现能力灰掉并写明原因。

| 分区 | 驱动的命令 / 库调用 | 消费的载荷 | 失败时用户看到 |
| --- | --- | --- | --- |
| 项目选择 | `detect`（库）/ `scan --json` | `root, engine, engineVersion, gameTitle, dataFiles, uniqueStrings, totalStrings, undecodable` | `E_NOT_PROJECT` / `E_MULTI_ROOT`（退出 2）：列出候选与证据，不猜测 |
| 扫描与统计 | `scan` / `status` | scan 载荷 + `file, translated, pending, withError` | `E_NOT_PROJECT`（退出 2）；`undecodable` 非空时展示文件清单 |
| 字典编辑 | `extract` / `export --json --out <f>` | `file, added, total, translated, pending`；export 的 `out, entries, bytes` | `E_NO_DICTIONARY`（退出 2，提示先提取）；`E_EXISTS` / `E_IO` |
| 翻译执行 | `translate`（`--limit`/`--context`/`--glossary`/`--save-every`） | `provider, translated, rejected, failedBatches, progress{total,translated,pending}` | `E_CONFIG`（缺 provider/model/key，退出 2）；`E_PROVIDER`；`rejected > 0` 仍是 `ok`，按 pending 数字提示跑 verify |
| 校验 | `verify`（`--kind`/`--limit`/`--write-report`） | `errors, warnings, counts, problems[{kind,severity,key,target,detail}]` | findings（退出 1）不是命令失败：按 kind 分组展示，error 拦安装按钮 |
| 安装与卸载 | `install` / `uninstall` / `launch` | `pluginPath, state, backupPath`；`removed, restored, drifted, keptBackup`；`root, exe, pid` | `E_EXE`（launch 多/无 .exe，列 details.candidates）；`E_UNSUPPORTED_PLATFORM`；`drifted: true` 时明确"只摘了自己那条，备份保留" |
| 设置 | `config list/get/set/unset` | `values{provider,model,baseUrl}, apiKey{set,source}` | `E_CONFIG`（文件损坏，不覆盖）；`E_USAGE`（非法值，退出 2） |
| 诊断 | `doctor`（`--max-length`） | `verdict, checks[{id,level,message}]` | broken → findings（退出 1）：逐项列出 fail/warn 与建议动作 |

术语/说话人整理（`terms`、`speaker`）挂在字典编辑与校验之间，作为可选步骤展示：
两者都只动字典、不调模型，`--dry-run` 结果先展示再应用。

## 4. 长任务与进度

`translate` 是唯一的长任务：数万条、批请求、可能跑整晚。GUI 需要的是**事件流**：
进度（第几批 / 每秒条数）、暂停/取消、可恢复的中间态。

**0.14 已补上接口**：runner seam 提供 `onProgress`（每批完成一次回调，
`{done,total,translated,rejected}`）与协作式取消（`AbortSignal`，翻译中的请求
自然结束、已翻条目保留，载荷里 `cancelled: true` 标记）。GUI 的进度条与
取消按钮都建立在这两个接口上，不再有黑盒模式；恢复机制仍是
`--save-every` 周期落盘（默认 200），中断后重跑同一命令即可续跑。

**当前 core 没有事件流。** CLI 靠 `--save-every <n>`（默认 200）把字典周期性落盘，
中断后重跑同一命令即可续跑——这是今天唯一存在的"恢复机制"，没有进度事件、没有取消信号、
没有跨进程的状态查询。GUI 不能伪造进度：0.14 之前 core 必须补上长任务接口
（进度事件 + 取消 + 状态查询），这是 GUI 前置的接口工作，不是壳内能绕过的缺口。

进度条只画 runner 真实回报的 `done/total`，不插值、不轮询；没有回调就不画条。
（架构上长任务跑在主进程、经 IPC 推给渲染进程，见 architecture.md §6；
渲染进程不碰文件系统与密钥。）

## 5. 凭据与隐私

- CLI 的规则不变：`config` 文件永远没有 `apiKey`，密钥只来自 `--api-key` 或环境变量
  （[config.md](config.md) §1/§4）。GUI 不改变这条规则。
- GUI 的"记住密钥"用系统凭据存储：Electron `safeStorage`（Windows 上是 DPAPI），
  只在用户显式勾选时写入；读不出来时提示重输，不回退明文（[config.md](config.md) §8）。
  CLI 永远不读 GUI 存的凭据，两套来源不打架。
- 日志与展示沿用现有脱敏（[json-contract.md](json-contract.md) §4.2）：`sk-***`、`Bearer ***`、
  userinfo 打码、home 目录折叠成 `~`、provider 响应体不进日志。
- `YAKUSHA_DEBUG=1` 是排查开关，堆栈只进 stderr；GUI 不新增"详细日志"开关，
  诊断信息走 doctor / verify 的载荷，不引入第二套日志体系。
- `launch` 启动游戏前删掉子进程环境里的 `YAKUSHA_API_KEY` / `OPENAI_API_KEY`；GUI 启动游戏必须走同一条路，不得旁路。

## 6. 失败与回滚

GUI 的安装/卸载界面必须如实呈现四档交付（ENGINE-STRATEGY §5.5），
**禁止出现"完全可逆""一键还原"类承诺**：

| 档 | 界面如实写 | 卸载后的真实状态 |
| --- | --- | --- |
| L4-plugin（MZ/MV） | 安装即备份 `js/plugins.js`，卸载时逐字节还原 | `uninstall` 的 `restored: true`；检测到漂移（`drifted: true`）时只摘自己那条、保留备份 |
| L4-resource（Ren'Py） | 生成/替换引擎自带翻译资源，删资源即恢复 | 游戏文件按引擎机制恢复 |
| L4-inject（RGSS 等） | 需要先下载原生组件；不改游戏文件，卸载后游戏照常运行 | 进程退出/卸载后恢复，`inject` 失败必须能回退原版启动 |
| L3-only | 界面明说"只能提取/翻译/校验，交付需要你自行部署" | 不适用 |

降级必须显式确认：插件失败不能静默改 patch（ENGINE-STRATEGY §8）。
install 的 `staleBackup: true` 与 uninstall 的 `drifted: true` 都要停下来让用户看清楚，
不提供"忽略并继续"的一键跳过。

## 7. 打包与分发

- Electron 只进 devDependencies，core 保持零第三方依赖（architecture.md §1）；
  便携包体积约 120–180 MB，首次运行可能被 Defender 拦一次——这是壳的成本，写进文档，不掩盖。
- Windows 代码签名：0.10/0.11 不做（纯 JS）；0.12 起有原生组件时必须重新评估，
  未拍板项见 DEVLOG §8.1（证书路线、成本与 SmartScreen 四道拦截见 ENGINE-STRATEGY §9.3/§9.4）。
  GUI 首发若未签名，安装包和首启动提示里如实说明。
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

- [ ] 每个界面分区都对应本文第 3 节的表格：有命名的库调用或 CLI 命令，没有私有 API。
- [ ] 每个按钮点击产生的行为都能在 CLI 里找到等价命令，输出一致（同一 core）。
- [ ] 按钮可用性由 `capabilities` 驱动：不支持的能力显示灰色 + 原因，点击后报错视为设计缺陷。
- [ ] 长任务有真实的进度事件与取消，结束后载荷与 CLI 的 `--json` 一致；没有假进度条。
- [ ] 翻译中断后能从落盘的字典继续（`--save-every` 语义或其后续接口），不需要用户重头跑。
- [ ] 安装/卸载界面对四档交付的描述与 ENGINE-STRATEGY §5.5 逐字对齐，无"完全可逆"承诺。
- [ ] 在四档测试矩阵上，从 GUI 卸载后游戏回到可运行状态（plugin 档逐字节还原）。
- [ ] 密钥只存在于系统凭据存储或内存；`config` 文件、游戏目录、日志与导出文件里都没有。
- [ ] 拖入非项目目录、多项目目录、损坏字典时，错误提示与 CLI 的错误码一一对应。
- [ ] MZ/MV + Ren'Py + RGSS 三条链路都能从 GUI 一键跑通（ENGINE-STRATEGY §6.3 的 0.14 验收）。

## 相关文档

- [architecture.md](architecture.md)：分层、EngineAdapter 契约、GUI 与 core 的边界
- [commands.md](commands.md)：13 个命令的选项、载荷与实测输出
- [json-contract.md](json-contract.md)：信封、退出码、错误码——GUI 分支处理的唯一依据
- [config.md](config.md)：配置、密钥不落盘、GUI 凭据存储的既定边界
- [engines.md](engines.md)：能力矩阵、launch 契约、attach 桩
- [limitations.md](limitations.md)：工具边界（GUI 非目标的来源）
- [export-format.md](export-format.md)：导出格式（字典编辑分区的输入/输出）
- [dev/ENGINE-STRATEGY.md](dev/ENGINE-STRATEGY.md)：§5.5 四档交付、§6.3 版本排期、§9 签名决策
- [../README.md](../README.md)：安装与快速上手
