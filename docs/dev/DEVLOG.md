# 开发交接文档（DEVLOG）

> 这份文档记录**阶段目标、已完成项、决策理由和下一步**，随开发进程更新。
> 最后更新：2026-10-27（0.19.0 `verify --kind` 严格校验：未知 kind 报 `E_USAGE`；0.18.0 RGSS 原生注入器交付层在 `feat/0.18-rgss-native`；0.17 字典溯源字段在 `feat/0.17-dictionary-provenance`；0.15 通用内容导入 v1 在 `feat/0.15-generic-import`；0.14.0 GUI 在 `feat/0.14-gui`；均未合入 `main`、未打 tag）。
> 0.9.0 项目改名 **Yakusha**，字典目录、插件文件、环境变量与备份后缀全部随之改名；
> 仓库已发布到 https://github.com/MagicalAlmond/Yakusha（`main` 分支）。
> 0.8.0 的 `doctor`、0.7.1 的 `uninstall` 漂移保护、0.7.0 的报告/模板见下）。
> 0.10 的五篇契约已冻结（`json-contract` / `config` / `engines` / `export-format` /
> `platforms`），实现按 WP1–WP6 推进：**六包全部完成**，0.10.0 在 `feat/0.10-docs` 分支上做完、待合入 `main`（未打 tag）。分支模型是
> **trunk-based**（只有 `main` 一条长期分支，规则见 §9）。
>
> **内部日志**：这份文档记录开发过程与决策，主要读者是维护者；面向使用者的命令说明
> 在 `../commands.md`。仓库只保留工具代码与自写夹具，**不收录任何游戏标题、截图或
> 原文/译文**；实测数据一律用匿名编号（MZ-A…MV-H），运行时确认只在本地做、验完即删。
> README 是一页 quickstart；判据、实测与限制在 `../design.md`、`../commands.md`、
> `../games.md`、`../limitations.md`。

> **仓库内容边界（2026-10-25 清理）**：删除了 `docs/screenshots/`、真实游戏样例与
> 含真实术语的词表夹具；`docs/games.md` 改为匿名编号；仓库内示例全部换成自写的通用
> 日文/中文。公开仓库不收录游戏标题、截图、原文或译文。

## 1. 项目目标

起点是一次明确的取舍：**放弃给某个多引擎汉化工具打强制更新补丁**，把精力全部转到
自研的通用化工具上，自主完成功能开发、测试与验收。据此定下两件事、放弃第三件：

1. **A 阶段** —— 通用化 MVP：任意 RPG Maker MZ / MV 游戏，能扫描、抽文本、装插件、运行时显示中文。
2. **B 阶段** —— LLM 翻译流水线：可配置端点、术语表、批量、并发、校验、断点续跑。
3. **给多引擎汉化工具打强制更新补丁** —— 明确放弃，不再投入。

项目定位来自更早的判断（m04886）：**单人 + AI 开发，规模不大，个人使用为主，
顶多按 GPL 公开**。所以一切设计都优先"能跑、能验证、改动可回退"，
而不是"支持十几个引擎族"。

## 2. 当前状态

| 项 | 状态 |
| --- | --- |
| 版本 | **0.19.0**（`package.json` 单一真源，`src/version.js` 读取它；插件模板的 `VERSION` 由安装器替换） |
| 契约 | 0.10 的五篇设计稿（json-contract / config / engines / export-format / platforms）已冻结并全部实现；0.11 只有 `engines.md` 真正扩了内容（三个引擎、新增 §13.2 Ren'Py），`json-contract.md` 与 `platforms.md` 补了「0.11 复查后不变」的复核标注。0.12 继续扩 `engines.md`（四个引擎、新增 §13.3 RGSS 与 §7.7 的 pending 交付），`json-contract.md` 补 RGSS 的语义澄清（`E_NOT_IMPLEMENTED` 有了 CLI 入口、`install`/`uninstall`/`doctor` 的按引擎差异）；信封与字段类型仍未动，`platforms.md` / `config.md` / `export-format.md` 未动。0.13 扩 `engines.md`（五个引擎、新增 §13.4 Kirikiri），`export-format.md` 补 TSV/CSV 表格与 `import` 命令；JSON 信封（flat one-line object、退出码 0/1/2、13 个错误码）未动。0.17 给字典条目加可选 `engine` / `locator` 溯源字段（`FORMAT` 仍是 `yakusha/1`），rich JSON 导出与导入带、表格不带，信封与错误码未动。0.18 给 RGSS 增加原生注入器交付层（`install --native` / `uninstall` / `doctor` 的 delivery 检查 / `scan` 的 `runtime: "inject"`），文档侧 `engines.md`、`commands.md` 按 0.18 补契约；信封、退出码与 13 个错误码未动；0.19 把 `verify --kind` 的未知值从静默过滤改为 `E_USAGE`（合法命令与信封不变） |
| 测试 | **678 个，全绿**（`npm test`，50 个测试文件，约 10s；0.19 新增 1 条 `verify --kind` 未知值用例；0.18 新增/改写 RGSS native 与 doctor 用例，净增 7 条——旧的 pending 交付测试被替换；0.14–0.17 的累计增量见历史） |
| 持续集成 | GitHub Actions：`npm test` 在 Node 22 / 24（**windows-latest**，WP1 已从 ubuntu 切换） |
| 平台 | Windows 10/11 x64 为唯一支持与验收环境（0.10 明确，见 [platforms.md](../platforms.md)） |
| 支持引擎 | RPG Maker **MZ 1.3.2–1.9.0**、**MV 1.6.1–1.6.2**；**Ren'Py 8.x 脚本**（`.rpy` 明文 + `.rpyc` 编译）；**RGSS（XP / VX / VX Ace）**从 0.18 起有 **inject 交付层**（`install --native`，原生注入器，不改游戏文件）；**Kirikiri（KAG / XP3）** 仍只到 L1–L3（识别 / 盘点 / 抽取 / 翻译 / 校验 / 导出），**没有交付层**（§6） |
| 实测游戏 | 22 款可识别（0.16 全量普查：mz 7 / mv 8 / rgss 1 / krkr 6），其中 **4 款**全量翻译 + 运行时验收；Ren'Py 侧用一套 8.5.3 SDK 的两个示例游戏做抽文本与覆盖率验收（§6）；RGSS 侧用一款 RGSS3 / VX Ace 商业游戏做抽取实测、并在它上面验收 0.18 的注入器（安装 / 启动 / 卸载，§6）；Kirikiri 侧用两款 XP3 商业归档（含一款语音归档）做抽取实测（§6，外部样本，不是仓库夹具） |
| 磁盘改动 | MZ/MV 走插件档：只加 1 个插件文件 + `plugins.js` 里 1 条注册，卸载还原到安装前；Ren'Py 走 translation 档：只在 `game/` 下新建 1 个 `yakusha_translation.rpy`，卸载删它；**RGSS 从 0.18 起走注入器档**：只在 `<game>/yakusha/native/` 下写 6 个文件（四组件 + 生成的 `dictionary.txt` + `manifest.json`），游戏文件一个字节不动，卸载递归删这个目录（没有 `manifest.json` 的目录拒删）；Kirikiri 仍不动任何文件——没有交付层，`install` / `uninstall` 报 `E_NOT_IMPLEMENTED`（四档交付见 [ENGINE-STRATEGY.md](ENGINE-STRATEGY.md) §5.5） |
| 运行时依赖 | 无第三方依赖（Node >= 22） |
| 产品形态 | CLI 为内核；Electron 最小外壳已随 **0.14** 交付（`gui/`，同一 runner 缝；`launch`、目录选择、记住密钥、最小字典编辑器已进外壳） |
| 许可 | GPL-3.0-or-later |
| 仓库 | https://github.com/MagicalAlmond/Yakusha（`main`） |

## 3. 阶段目标与完成情况

### A 阶段（已完成）

- [x] 项目发现：从任意上级目录向下有界搜索（3 层），支持 `www/`、改名子目录、
      `data/www/` 三种真实布局；同层两套游戏报错而不是随便挑。
- [x] 数据解码：明文 JSON / 单字节 XOR 穷举 256 键 / 0 字节空白占位（`empty` 不算 `undecodable`）。
- [x] 文本抽取：字段表 + 指令表（`src/core/fields.js` 是唯一真源）。
- [x] 字典格式 `yakusha/1`：key = 原文，value = `{text, contexts, error?}`。
- [x] 运行时插件：MZ 挂 `DataManager.onXhrLoad`；MV 挂 `loadDataFile` + `onLoad`
      并**按对象身份认领**（MV 的 XHR 是并发的，不能按到达顺序配对）。
- [x] 安装 / 卸载：备份 `plugins.js`，重写时保留原文件的**尾逗号**与**换行风格**（LF/CRLF）。
- [x] 真机验收：MZ-A、MV-G 均确认中文出现在对话/选项里（截图只在本地，未入库）。
- [x] 卸载的安全边界：装好之后 `plugins.js` 又被改过（游戏更新、另装插件、RPG Maker 编辑器里
      存过档）时不再用旧备份覆盖，只摘掉 `YAKUSHA_Translator` 那一条、把备份留在原地；
      `install` 也会先指出「备份已经对不上这份文件」。判断依据是整个 `$plugins` 除自己那条
      以外是否仍与备份一致（按 name/status/description/parameters 比对，键序与排版不算改动）。

### B 阶段（已完成）

- [x] OpenAI 兼容 provider（DeepSeek 实测）+ mock provider（`--dry-run` 离线）。
- [x] 批处理（`--batch-size` / `--char-budget`）+ 并发（`--concurrency`）+ 每 N 条落盘。
- [x] 术语表（`--glossary` / `--glossary-only`），命中不发请求。
- [x] 六道校验闸门（`validateTranslation`）：空串、原样回显、转义码、`%N` 占位符、
      换行数、长度比、`U+FFFD`。**不合格绝不写伪造译文**，只记 `entry.error`。
- [x] 折行（`--max-length`）：按显示列宽（全角 2 列），标点断行 + 禁则处理（`！？` 不落到行首），
      转义码宽度算 0 且不拆开；对已翻完的字典可重复执行回填（`--no-rewrap` 关闭）。
- [x] 发布前自检（`verify`）：把人工审计脚本产品化，只读不写，10 类问题分 error/warn 两档。
- [x] 0.5.2 补上两类「玩家能直接看到」的检查：`trad`（译文里混进原文没有的繁体字）
      与 `speaker`（MV 的 `\N<名字>` 标记没翻，或同一角色有多种写法）。
      实测三款跑完的游戏上 error 全为 0，见第 6 节。
- [x] 位置过滤（`--context`）可重复传多个值，任一命中即选（OR 语义）。
- [x] 说话人名修复（`speaker`）：把 `verify --kind speaker` 报出的问题按本作**自己已经在用**
      的写法机械修好（假名残留 → 已译写法；全汉字照抄名 → 中文写法），并能用 `--names`
      补一款游戏从头到尾没翻过的名字。全程不调用模型。实测 MV-H 411 → 0 error。
- [x] 一致性（`terms`）：从字典自身挖出名字/术语在正文里的**主流译法**，与名字条目比对报
      `drift`/`missing`，可导出成术语表回灌（配 `translate --glossary-only --overwrite`）。
      这一步解决的是`verify` 查不到的那类问题：`アリア` 的名字表现写「艾莉亚」，
      而正文 3,653 行里 96% 写「阿莉亚」。`verify` 看到这条只会说「没有结构性问题」。
- [x] 0.7.0 补上发布流程的两块拼图：`verify --write-report <file>` 把 10 类问题
      连同「为什么重要」写成一份自包含的 markdown（终端里看 192 条警告不现实，
      报告能直接贴 issue）；`speaker --write-names <file>` 把「本作一次都没翻过、
      机械修复帮不上」的名字直接列成待填的 JSON 模板。同一轮修掉 `verify` 报 error
      时退出码仍为 0 的契约 bug（README 与本文第 5 节都承诺过它会失败），
      现在 `verify && install` 可以当发布闸门用。
- [x] 0.8.0 新增 `doctor`：把「游戏更新后中文没了」拆成三条可判定的问题——字典是否还对得上
      这版 `data/`（逐 key 回查）、插件条目是否还在 `$plugins` 里、运行时能否在根目录或
      `www/` 找到字典。结果分 `broken` / `not installed` / `usable` / `ready` 四态，
      只在 `broken` 时退出 1。`plugins.js` 被手写坏时也照常出报告（初版会抛栈）。

### C 阶段（0.10.0，已完成）

- [x] WP1 基础设施：`--json` 信封（`schema/command/ok/outcome/error` 五个保留键 + 扁平 payload）、
      13 个错误码与 `sanitizeMessage`（ANSI / 换行 / `sk-` / `Bearer` / URL userinfo / 家目录 /
      500 字截断）、退出码 0/1/2 与 `outcome` 一一对应；`bin/yakusha.js` 改为薄壳
      （解析 → 命令 → emit），12 处直接 `JSON.stringify` 全部收敛到 `src/cli/envelope.js` 的 `emit()`。
- [x] WP1 严格参数解析（`src/cli/args.js`）：未知选项、缺值、给布尔选项 `--flag=value`、
      多余位置参数一律 `E_USAGE`/2，且发生在任何磁盘操作之前；解析失败时错误信封仍带上
      正在解析的命令名，测试直接断言了这个字段。
- [x] WP1 版本单一真源：新增 `src/version.js` 读 `package.json`，`--version` 输出
      `yakusha <version>` 且优先于任何命令/选项（不套信封）；`package.json` 补 `main`/`exports`。
- [x] WP1 契约测试：新增 `test/json-contract.test.js`（17 条）与 `test/version.test.js`（4 条）；
      CLI 测试统一清空 `YAKUSHA_*` / `OPENAI_API_KEY`，不再继承开发机环境。
- [x] WP1 配置前置（用户要求）：去掉内置模型 `gpt-4o-mini` 与隐式 `openai` provider。
      真实调用必须显式配置 provider、model、密钥（`--flag` / 环境变量 / 0.10 配置文件）；
      缺任何一项都在发请求前 `E_CONFIG`/2。`--dry-run` 固定 mock（忽略并警告其他
      `--provider`）、`--provider mock`、`--glossary-only` 不需要配置；
      `provider=compatible` 没有 `--base-url`/`YAKUSHA_BASE_URL` 也拒绝，避免把 key
      发到 `api.openai.com`。新增 `test/provider-config.test.js`。
- [x] WP2 引擎适配器 / registry / detect / facade：新增 `src/engines/{adapter,registry}.js`、
      `src/engines/{mz,mv}/adapter.js` 与库门面 `src/index.js`；detect 返回判别式、预期失败不抛，
      CLI 只经 `detectProject` 找项目，scan / extract / install / uninstall 全部走 adapter；
      `install` / `uninstall` 增加 realpath 越界守卫（项目外路径 `E_IO`），插件里的
      `VERSION` 改由 `installPlugin` 从 `src/version.js` 渲染；新增
      `test/engine-contract.test.js`（18 条）与 `test/fixtures/mini-mv`。
- [x] WP3 config：新增 `src/cli/config.js` 与 `config` 命令（用户级唯一一份，
      `%APPDATA%\yakusha\config.json`，`YAKUSHA_CONFIG_DIR` 可注入目录）。只存
      provider / model / baseUrl，密钥永不落盘、永不回显；写入用同目录临时文件 + rename，
      保留未知键，`schema` 固定首位。`translate` 改为从 flag → 环境变量 → 文件 → 默认
      逐级取值；坏文件对 `translate` 只 warn，对 `config` 子命令 `E_CONFIG`；`--dry-run`
      完全不读配置。`config` 不接游戏目录，只允许全局 `--json`。新增 `test/config.test.js`
      （15 条）并把 CLI/契约/配置前置测试的 `YAKUSHA_CONFIG_DIR` 隔离到临时目录。
- [x] WP4 export：新增 `src/cli/export.js` 与 `export` 命令（`--out` 必填、只做 JSON）。
      只导出非空 `text`，`error` 不出现；`game` / `updatedAt` 原样复制；`--flat` 去掉
      `contexts`。entries 键按 UTF-16 码元排序（默认 `sort`，不用 `localeCompare`），
      同一字典重复导出字节一致。写入用同目录临时文件 + rename；目标存在无 `--force`
      `E_EXISTS`，目标是字典本身即使 `--force` 也拒绝，目标是目录 `E_IO`，父目录自动创建。
      新增 `test/export.test.js`（14 条），并在契约测试的“每个命令 payload 扁平”清单里
      加入 export。
- [x] WP5 launch / attach 桩：新增 `src/engines/launch.js` 与 `launch` 命令。仅 Windows
      （其他平台 `E_UNSUPPORTED_PLATFORM`）；只认项目根直接子普通 `.exe`（0 个/多个
      `E_EXE` 且 `details.candidates` 最多 20 个）；`--exe` 只收裸文件名、大小写不敏感
      匹配磁盘真实名；spawn 无参数、`detached`、`stdio:"ignore"`、`shell:false`，子进程
      env 删除 `YAKUSHA_API_KEY` / `OPENAI_API_KEY` 及大小写变体；不等待、不 kill。
      `attach` 在两个适配器仍是 `E_NOT_IMPLEMENTED` 桩，`capabilities.attach:false`。
      新增 `test/launch.test.js`（15 条，注入假 spawn，从不真启动 exe）；`failureFor`
      保留 `error.details`，`E_EXE` 的 candidates 才能进信封。
- [x] WP6 文档与 0.10.0：`package.json` 升 0.10.0（`test/plugin-runtime.test.js` 里硬编码的
      `0.9.0` 改为断言 `src/version.js` 的 `VERSION`，否则升版即挂）；`docs/commands.md`
      按 13 条命令的最终行为整篇重写（新增「全局约定」与「config」两节，删掉"WP1–WP5 已实现、
      其余待重写"的横幅）；`docs/architecture.md` 把"默认路线可逆 / uninstall 逐字节还原 /
      必须可逆 / 可逆列 / 注入的不可逆风险"改为按四档交付描述实际影响，§9 分批计划表按
      [ENGINE-STRATEGY.md](ENGINE-STRATEGY.md) §6.3 重排（0.10.x 拆缝 → 0.11 Ren'Py →
      0.12 RGSS 注入 → 0.13 字典导出 → 0.14 GUI → 0.15 KRKR → 1.0），并注明"本文件冻结的是
      接口契约、不是排期"；`docs/limitations.md` 补 0.10 最终口径（`--json` 信封、退出码
      0/1/2、严格参数解析、GUI 排到 0.14、TSV/CSV 排到 0.13 而非"0.12 计划里"）；
      `README.md` 去掉"逐字节还原 / 无第三方运行时依赖 / 完全还原"这类全局卖点措辞，
      改为按档说明实际影响，并新增「给脚本用：--json 与退出码」一节与环境变量
      `YAKUSHA_CONFIG_DIR` / `YAKUSHA_DEBUG`。测试数不变（**346 个，全绿**）。

### D 阶段（0.11.0，已完成）

- [x] Ren'Py 接入：新增 `src/engines/renpy/` 8 个模块——`pickle.js`（Python pickle
      虚拟机，protocol 0–5，纯 JS 不 eval）、`rpyc.js`（`.rpyc` 容器解析 + AST 字符串
      收集）、`rpyscript.js`（`.rpy` 明文抽取）、`project.js`（`game/` 定位、脚本遍历、
      身份读取）、`extract.js`（两种源合成一份单元表）、`profile.js`（Ren'Py 的
      tokenize / validate / verify）、`runtime.js`（translation 档投递）、`adapter.js`
      （能力位与 CLI 入口）。`src/pipeline/` 与 `src/core/` 主循环一行未动。
- [x] 注册表与注入点：`src/engines/registry.js` 从「MZ→MV」改成三引擎，并把「不是本项目」
      的判定集中成 `NOT_PROJECT_PREFIXES`——两个引擎的 not-a-project 前缀都算「继续试
      下一个」，诊断型失败（如 `E_MULTI_ROOT`）仍然立即返回；`src/core/doctor.js` 改成
      注入式（`extract` / `dataFiles` / `sourceLabel` / `delivery` 四个注入口 +
      `diagnostics()`），MZ/MV 的默认值保持不变；`bin/yakusha.js` 按 `adapter.dataUnit`
      与 `capabilities.runtime` 分支打印。
- [x] 真实 SDK 样本驱动的四项抽取精度修复：同 stem 只读 `.rpy`、跳过 `game/tl/`、跳过
      自己生成的 translation 文件、字面量说话人只取台词。每项为什么错见 §6。
- [x] 测试：新增 `test/renpy-{adapter,extract,rpyc,rpyscript,runtime}.test.js` 共 104 条，
      `engine-contract` 与 `profile-seams` 改成按引擎断言，合计 **459 个，全绿**。

### E 阶段（0.12.0，已完成）

- [x] RGSS 接入：新增 `src/engines/rgss/` 6 个模块——`marshal.js`（Ruby Marshal 4.8
      读写，纯 JS、不 eval、不执行反序列化出的对象）、`archive.js`（`.rgssad` /
      `.rgss2a` / `.rgss3a` 三种归档的读与写）、`project.js`（`Game.ini` 与
      `Data/` 定位、版本判定、`Game.ini` 的多编码兜底）、`extract.js`（事件指令 +
      数据库字段 + System / MapInfos 的抽取）、`profile.js`（RGSS 的 tokenize /
      validate / verify，grammar 复用 `core/textkey.js`）、`adapter.js`（能力位、scan、
      diagnostics 与两条 pending 入口）。`src/pipeline/` 与 `src/core/` 的主循环同样
      一行未动，为 RGSS 新增的特判只有两处：`src/core/doctor.js` 的 pending-delivery
      分支与 `bin/yakusha.js` 的 `delivery` 取值。
- [x] 注册表：`ADAPTERS` 从三个变四个，`NOT_PROJECT_PREFIXES` 加第三条
      `"not an RGSS project"`；探测顺序 **MZ → MV → Ren'Py → RGSS** 写进
      `src/engines/registry.js` 的模块注释，作为公开契约（`test/engine-contract.test.js`
      对顺序与四个能力位逐个断言）。
- [x] 能力位与 doctor：RGSS 的 `capabilities.runtime` 是 `null`——XP / VX / VX Ace
      没有插件系统，文本烤在数据文档里，交付层（写回数据文档 vs 原生注入器）两条路线
      都还没拍板（§8.1）。`doctor` 因此新增 `delivery.pending` 分支：`install` 检查
      报 warn 并原样打印引擎给的解释，`runtime` 检查报 info，不报「未安装」也不判
      `broken`。
- [x] 测试：新增 `test/rgss-{marshal,archive,project,extract,adapter,cli}.test.js` 与
      `test/rgss-fixture.js`（夹具全部由 `marshal.js` 的 writer + `archive.js` 的 writer
      现场生成，仓库里没有一个二进制夹具），合计 **548 个，全绿**。
- [x] 明确不做：本版**没有交付层**。`install` / `uninstall` 抛 `E_NOT_IMPLEMENTED`
      （退出码 2）且一个字节都不写，留给 §8.1 的两条路线决定（§6）。

### F 阶段（0.13.0，已完成）

- [x] Kirikiri 接入：新增 `src/engines/krkr/` 6 个模块——`xp3.js`（XP3 归档只读解析，
      索引 zlib 解压、`info` / `segm` / `adlr` 子块、adler-32 手写实现）、`ks.js`
      （KAG 脚本解码与字符串收集，UTF-8 strict 先、Shift_JIS 兜底）、`project.js`
      （根或 `data/` 有 `.xp3` 即项目，向下 BFS 3 层，多根 `E_MULTI_ROOT`）、
      `extract.js`（读每个归档收 KS 字符串，`.tjs` 只计数不读）、`profile.js`
      （KAG 的 prompt / grammar / validate / verify，`[r]` 等行内标签按零宽码处理）、
      `adapter.js`（能力位、scan、diagnostics 与两条 pending 入口）。`src/pipeline/`
      与 `src/core/` 的主循环仍然一行未动。
- [x] 表格导出/导入：`export` 新增 `--format tsv` / `csv`（RFC4180 风格 quoting、
      UTF-8 BOM、CRLF，见 `src/cli/table.js`），新增 `import` 命令（`--from` /
      `--format` / `--strategy only-empty|overwrite` / `--dry-run`，载荷仍是 flat
      信封）。`src/cli/args.js` 加 `from` / `strategy` 两个取值选项与 `import` 命令行。
- [x] 注册表：`ADAPTERS` 从四个变五个，`NOT_PROJECT_PREFIXES` 加第四条
      `not a Kirikiri project`；探测顺序 **MZ → MV → Ren'Py → RGSS → Kirikiri**
      写进 `src/engines/registry.js` 的模块注释（`test/engine-contract.test.js` 对
      顺序与能力位逐个断言，`RUNTIME_TIERS` 表加 `krkr: null`）。
- [x] doctor：Kirikiri 走 0.12 引入的 `delivery.pending` 分支——`install` 检查报
      warn（`no delivery layer yet`），`runtime` 检查报 info，有字典 `verdict`
      仍是 `usable`、无字典 `broken`。`bin/yakusha.js` 的 `delivery` 取值不用再改
      （0.12 已写成 `own.delivery || own.translation || null`）。
- [x] 测试：新增 `test/krkr-{xp3,ks,project,extract,adapter,cli}.test.js` 与
      `test/krkr-fixture.js`（合成 XP3 writer + 合成 KS，仓库里没有真实归档），
      `export.test.js` 的 TSV/CSV 用例重写（14 → 23 条），合计 **603 个，全绿**。
- [x] 明确不做：与 RGSS 一样**没有交付层**，`install` / `uninstall` 抛
      `E_NOT_IMPLEMENTED`（退出码 2）且不写文件；Hxv4 改版索引明确报
      `E_UNSUPPORTED` 不解析；字典 v2 字段（`engine` / `locator`）当时仍留在 §8.1 #5（0.17 已补上）。

### G 阶段（0.14.0，已完成）

- [x] **runner 抽缝**：`bin/yakusha.js` 的 14 个命令实现整体搬到 `src/cli/runner.js`
      （payload 构建与人类打印分离，sink 注入；CLI 在 `--json` 下用 nullSink，
      文本模式下字节级对拍 48 例确认输出不变）。`bin/yakusha.js` 从 ~1,245 行瘦到 ~310 行。
- [x] **translate 取消**：`AbortSignal` 全链（runner → pipeline；worker 循环每批检查，
      in-flight 请求自然结束），payload 新增 `cancelled` 键（CLI 恒 false）。
- [x] **GUI 最小外壳**：`gui/handlers.js`（runCommand 包装 + CLI 一致信封 + 命令白名单）、
      `gui/main.js`（窗口、IPC 白名单、长任务在主进程、`webContents.send` 推进度、
      AbortController 归主进程所有、原生目录选择 `gui:pick-directory`）、`gui/preload.js`
      （contextBridge 白名单 + `webUtils.getPathForFile` + `pickDirectory`）、
      `gui/renderer/`（按钮 1:1 映射命令、真实进度条、export/speaker/terms/config list、
      「记住密钥」勾选）。不加载远程内容、渲染进程无 Node、CSP `default-src 'none'`。
- [x] **electron devDependency**（37.2.3，npmmirror 镜像安装；`pnpm-lock.yaml` +
      `pnpm-workspace.yaml` 入库），运行时依赖仍为零。
- [x] **测试**：runner 15 例（双前端信封逐键对拍）、cancel 5 例（pipeline 中止 + runner 透传）、
      GUI handlers 8 例（`runGuiCommand` 对拍子进程 CLI）；全量 **639 pass**。
- [x] **外壳补齐（0.14 后续轮次）**：export/speaker/terms/config 按钮与原生目录选择、
      safeStorage「记住密钥」（`gui/credentials.js` + 四个 IPC 通道 + 5 例测试）、
      `launch` 进外壳（白名单 14 命令、E_EXE 候选展示，+3 例对拍测试）、
      最小字典编辑器（`gui/dictionary.js` 复用 core/dict 读写、`gui:dict-load`/`gui:dict-save`
      两条专用通道、+6 例测试）；全量 **645 pass**。
- [ ] 暂缓：无（0.14 的 gui.md 范围全部落地；批量编辑仍走 export/import）。

### H 阶段（0.15.0）：通用内容导入 v1

- **动机**：ENGINE-STRATEGY §6.2 用户拍板"通用内容导入/导出（做）"（2026-10-25），
  0.11 时顺延；0.13 的 `import` 只吃自己导出的三种文件且要求字典已存在，
  外部内容没有入口。
- **范围**：`import` 增加 JSONL 输入（每行 `{source|key, target|text, contexts|locator}`，
  空行跳过、BOM/CRLF 容忍、坏行报带行号的 `E_DICTIONARY`）与 `--create`
  （缺字典时先 `emptyDictionary(gameTitle)` 建一个再合并；解析先于建字典，
  坏表不留半成品）。**不在范围**：字典 v2 的 provenance 字段（§8.1 #5 未拍板，
  导入条目与本地抽取条目在格式上不可区分）、en→zh（§8.1 #6）。
- **实现**：`parseJsonl` 在 `src/cli/table.js`（与表格解析同模块、复用 TableRow）；
  `commandImport` 先读后建；`args.js` 的 BOOLEAN 加 `create`、import 白名单加
  `create`；USAGE 补两行。
- **测试**：`test/export.test.js` 23→28（JSONL 别名、坏行行号、--create、
  无 --create 保持 E_NO_DICTIONARY、坏表不留字典）；全量 **650 pass / 0 fail**。

### I 阶段（0.16.0，已完成）

- [x] GUI 能力灰显：`scan` 载荷新增 `capabilities`（shared runner 在 `src/cli/runner.js` 的
      `commandScan` 里并入 `adapter.capabilities`，adapter 层的 11 键载荷不变——
      `test/renpy-adapter.test.js` / `rgss` / `krkr` 的 eleven-key 断言原样通过）。
      合成信号：RGSS / Kirikiri 的 `runtime` 是 `null`，GUI 据此把 install/uninstall
      置灰并写明「this engine has no delivery layer yet」（点击报 `E_NOT_IMPLEMENTED`
      属设计缺陷，见 `docs/gui.md` §3 与验收第 3 条）。
- [x] 渲染层：`gui/renderer/renderer.js` 在 scan 成功后按能力位禁用
      install / uninstall（`runtime: null`）与 launch（`launch: false`），原因写在
      `title` 上；能力事实与 CLI `--json` 完全同源。
- [x] 测试：`test/engine-contract.test.js` 加五引擎能力位冻结断言（MZ 是唯一
      `debuggable: true`）；`test/gui-handlers.test.js` 加 scan 信封携带能力位用例。
      合计 **652 个，全绿**。
- [x] 0.16 补记：`test/gui-e2e.test.js`（3 用例）按 GUI 的调用缝 `runGuiCommand`
      把三条交付档的完整命令序列各走一遍——MZ plugin 档 install/uninstall 往返、
      Ren'Py translation 档真译后 install 落盘 `game/yakusha_translation.rpy`、
      RGSS runtime null 的 install 报 `E_NOT_IMPLEMENTED`（与灰显规则互证）。
      Ren'Py 的 install 只装已翻条目，所以该走查用真跑的 mock translate，不是
      --dry-run。全量 **655 个，全绿**；`docs/gui.md` §9 第 3 条的未验范围
      随之收窄到 Electron 窗口交互本身。
- [x] 版内修正：Kirikiri XP3 读取器适配真机归档（索引容器头 9/17 字节双布局自动判位、
      条目起点两种形状、变换头报 `E_UNSUPPORTED` 而非裸 RangeError）、`decodeKs` 补
      UTF-16 BOM——两款真实商业归档全条目 adler-32 校验通过、六款游戏 scan 实测，
      全量 657 绿（详见 §6 的 0.16 段）。
- [x] 文档：`docs/json-contract.md` §7 scan 行、`docs/commands.md` scan 节、
      `docs/gui.md` 状态行与 §3 注记、`CHANGELOG.md` 0.16.0 段（含上述修正的 Fixed 两条），
      以及 0.16 复核后的全仓一致性巡检（games/limitations/README/commands/engines/
- [x] 0.16 文档巡检补一篇 file:line 全扫与 CI 事实核对：docs/ 全部 `path.js:N` 引用逐条核对（修复 export-format.md 的 import --from 锚点 810→853，0.14 runner 拆分遗留）；`.github/workflows/test.yml` 没有 install 步骤是有意为之——零运行时依赖、测试不 import electron 包，`npm test` 直接可跑；devDependencies 的 electron 只服务本地 GUI 开发。
      json-contract/platforms/architecture/ENGINE-STRATEGY 的陈旧声明逐一改真）。
- [x] 明确不做：能力位矩阵不新增字段（`attach` / `liveReload` 仍是两处 `false`），
      GUI 不因能力位新增任何私有 API。
- [x] 2026-10-27 用户拍板三项（0.17 前置）：①授权安装 C/C++/Rust 工具链以评估原生注入器路线（§8.1 #10 路线选择仍待评估后拍板）；
  ②字典 v2 `engine`/`locator` 两字段用途已答复（溯源元数据，可选、不破坏现有读写），是否加仍待拍板；
  ③npm 打包范围定为**包含 GUI**——`package.json` 的 `files` 加 `gui`，`pnpm pack` 实测见 §6 0.17 段。
- [x] 窗口走查边界实测（0.16 复查）：在自动化会话里把 Electron 37.2.3 真跑——
      `gui/main.js` 可加载、隐藏 `BrowserWindow` 冒烟 exit 0；但 Chromium 单实例锁
      在本会话派生的进程令牌下创建失败（`process_singleton_win.cc:454` error 5，
      换 user-data-dir 无效），应用按「锁失败即退出」的设计退出。结论：剩余三条
      验收要走查，需要在正常桌面会话双击启动，不是代码缺口；`docs/gui.md` §9
      第 3 条已按实测改写。
- [x] 原生注入器路线探针闭环（0.17 前置，仓库外）：Rust cdylib DLL（P/Invoke 调用通过）、
      零依赖 Rust 注入器（裸 kernel32 FFI，CreateRemoteThread(LoadLibraryW) 返回模块句柄）、
      32 位半边（rustup i686-pc-windows-gnullvm + llvm-mingw，PE32 三件套注入成功；RGSS 是 32 位
      进程，这一步是路线硬前提）。工具链全局就位：Rust 1.99.1 stable-gnu + llvm-mingw
      （clang 23.1.4，便携、注册用户 PATH）。教训：PS 探针（Start-Process 一族）会在 cwd 留下
      `%SystemDrive%/ProgramData` 缓存库并被 `git add -A` 收进提交（9af59ed，179e114 已删）——
      探针后除 `git status` 外还要 `git ls-files` 核对。

### J 阶段（0.17.0，已完成）

- [x] 字典条目加可选溯源字段：`engine`（`mz` / `mv` / `renpy` / `rgss` / `krkr`）与 `locator`（字符串数组，`<文件>#<JSON Pointer>`；行式引擎为 `file:line`）。`FORMAT` 仍是 `yakusha/1`，旧字典照读；`loadDictionary` 丢弃非法的引擎/定位值而不是让整份字典失败。
- [x] 抽取器写 provenance：`src/core/fields.js` 的 `collectAtPaths` / `walkCommands(pointer)` / `pickParamsWithSlots` 给出精确路径；四个 adapter 统一走 `src/core/dict.js` 的 `recordExtracted()`（MZ/MV、RGSS、Ren'Py、Kirikiri 各传自己的 engine id）。重新 `extract` 会用新 locator 整体替换陈旧值，但不动已有译文。
- [x] 导出/导入：rich JSON 原样带上 `engine` / `locator`，`--flat` 不带；`import --format json` 回填缺失的 provenance。TSV / CSV 仍是三列，不带。
- [x] 测试：新增 `test/dict.test.js`（7 条，含 malformed provenance 丢弃与 `recordExtracted` 合并语义），`extract` / `rgss-extract` / `export` / `krkr-adapter` / `renpy-extract` 各补 locator 断言。合计 **670 个，全绿**。
- [x] 2026-10-27 用户拍板 RGSS 交付层路线后，把用户文档（README / engines / commands / design / architecture / limitations / gui / ENGINE-STRATEGY）从「两条路线未拍板」同步为「已拍板：原生注入器 + hook DLL，工具链就绪，实现待后续工作包」（0.18 已交付，见 K 阶段）；Kirikiri 仍按未拍板写。

### K 阶段（0.18.0，已完成）

- [x] 交付层：新增 `src/engines/rgss/native.js`（338 行）——原生组件校验（SHA-256 manifest）、`install --native` / `uninstall` / `launch` 的注入器路径、`dictionary.txt` 生成；RGSS 的 `capabilities.runtime` 从 `null` 改为 `inject`（全仓唯一 inject 档）。
- [x] CLI：`install` 的选项白名单加 `native` 与 `dry-run`；非 RGSS 传 `--native` 报 `E_USAGE`（`install --native applies to RGSS games only`）；RGSS 不带 `--native` 报 `E_USAGE` 并给出完整命令；文本输出五行、payload 六键 + `native`。`uninstall` 删 `<game>/yakusha/native` 并回 `native{dir,removed}`。
- [x] `doctor`：`delivery` 不再是 pending 桩，改成统一的 `{path, exists, language:null, entries}`；装前 `install info` / verdict `not-installed`，装后 `install ok` / `runtime ok`，无 warning 时 verdict `ready`（有 warning 时 `usable`）。
- [x] 原生组件：`native/rgss-hook`（cdylib）+ `native/injector`（bin）两个零依赖 Rust crate；`native/build.mjs` 用 `i686-pc-windows-gnullvm` 构建并写 `native/prebuilt/manifest.json`；`native/prebuilt/` gitignore、随 npm 包发布。
- [x] GUI：渲染层记住 scan 的 `lastEngine`，RGSS 的 install / uninstall 按钮自动带 `--native`。
- [x] 版内修复：`gui/renderer/renderer.js` 的 capabilities 代码块从 0.16 起误放在 scan 成功分支的闭括号之外（引用块内 `const e`，扫描成功会 `ReferenceError`）；已移回分支内，按钮灰显逻辑不变，未加渲染器单测（只有 `node --check` 与 stub DOM 冒烟）。
- [x] 测试：`rgss-adapter` 17→21、`rgss-cli` 13→16、`gui-e2e` 的 RGSS 走查重写、`engine-contract` 冻结 `runtime: "inject"`；合计 **677 个，全绿**（50 个文件，约 12s）。
- [x] 明确不做：XP/VX（RGSS1/RGSS2）未测；注入器与 DLL 不签名；脚本字面量不翻；不改游戏文件、不写注册表、不装服务。

### L 阶段（0.19.0，已完成）

- [x] 修掉一个静默错误：`verify --kind` 之前把未知 kind 当作过滤条件，拼错一个名字会得到 `counts: {}` / `problems: []` / `outcome: ok`（`docs/commands.md` 曾如实写明这一行为）。现在 `commandVerify` 在调用 `verifyDictionary` 前用 `VERIFY_KINDS` 白名单校验，未知值报 `E_USAGE`、退出 2，消息列出未知值与全部合法值。
- [x] 单一真源：合法 kind 列表从 `src/pipeline/verify.js` 的 `VERIFY_KINDS` 导出（`kana` / `echo` / `codes` / `slots` / `lines` / `width` / `no-text` / `trad` / `speaker` / `rejected`），`commandVerify` 只引用这一份；`--help` 与 `docs/commands.md` 同步注明未知名字会被拒绝。
- [x] 测试：`test/cli.test.js` 新增一条（`verify --kind bogus` 的 JSON 信封 `E_USAGE` / 退出 2 / 消息断言）；合法 `--kind kana`、`--kind=echo` 与空 `--kind` 的既有行为不变。合计 **678 个，全绿**（50 个文件，约 10s）。
- [x] 明确不做：不改变 `verifyDictionary` 库 API 的过滤语义（库调用者传未知 kind 仍只是过滤），本次只把 CLI 输入校验放在命令层。

## 4. 文件地图

```
bin/yakusha.js             CLI 薄壳（解析参数 → runCommand → emit；0.14 起不再实现命令）
src/cli/runner.js          0.14 共享命令缝：14 个命令实现，payload 构建与人类打印分离，
                           sink / onProgress / signal 注入（CLI 与 GUI 的共同调用点）；
                           0.16 起 scan 载荷并入 adapter.capabilities
src/cli/envelope.js        0.10 信封、错误对象、sanitizeMessage、EXIT 码
src/cli/args.js            0.10 严格参数解析（未知选项 / 缺值 / 多余参数即 E_USAGE）
src/cli/config.js          用户级配置读写（provider / model / baseUrl，密钥不落盘）
src/cli/export.js          字典 → JSON 快照（UTF-16 键序、原子写、覆盖保护）
src/cli/table.js           TSV / CSV 表格序列化与解析（RFC4180 quoting、BOM、CRLF）；0.15 起
                           另含 parseJsonl（通用内容导入的 JSONL 读取）
src/version.js             版本单一真源（读 package.json）
gui/handlers.js            0.14 主进程命令层：runCommand 包装、CLI 一致信封、命令白名单
gui/main.js                0.14 Electron 主进程：窗口、IPC 白名单、长任务与 AbortController
gui/preload.js             0.14 contextBridge 白名单（run/cancel/事件/pathForFile）
gui/renderer/              0.14 渲染层（index.html + style.css + renderer.js，无 Node）
src/engines/adapter.js     MZ/MV 共享适配器逻辑（detect / scan / extract / 安装）
src/engines/registry.js    MZ→MV→Ren'Py→RGSS→Kirikiri 注册表与 detectProject（判别式，不抛）
src/engines/mz/adapter.js  MZ 能力位与薄包装
src/engines/mv/adapter.js  MV 能力位与薄包装
src/engines/renpy/adapter.js Ren'Py 能力位、scan/install 入口与 diagnostics
src/engines/renpy/pickle.js Python pickle 虚拟机（protocol 0–5，纯 JS 不 eval）
src/engines/renpy/rpyc.js  .rpyc 容器解析与 AST 字符串收集
src/engines/renpy/rpyscript.js .rpy 明文抽取（字面量求值、转义、说话人）
src/engines/renpy/project.js game/ 定位、脚本遍历（跳过 tl/）与身份读取
src/engines/renpy/extract.js 两种源合成单元表，逐条标不可解码
src/engines/renpy/profile.js Ren'Py 的 prompt / grammar / validate / verify
src/engines/renpy/runtime.js translation 档投递（生成 / 删除 yakusha_translation.rpy）
src/engines/rgss/adapter.js RGSS 能力位、scan/detect 入口、diagnostics 与 install/uninstall/launch 的注入器入口
src/engines/rgss/project.js Game.ini 多编码解码、Data/ 与归档定位、XP/VX/VX Ace 版本判定
src/engines/rgss/archive.js .rgssad / .rgss2a / .rgss3a 三种归档的读与写（目录只读头部窗口）
src/engines/rgss/marshal.js Ruby Marshal 4.8 读与写（纯 JS，不 eval，class/module 只记名字）
src/engines/rgss/extract.js 事件指令 + 数据库字段 + System/MapInfos 的文本抽取
src/engines/rgss/profile.js RGSS 的 prompt / grammar / validate / verify（复用 textkey 分词）
src/engines/rgss/native.js 原生交付层：组件 manifest 校验、安装/卸载、dictionary.txt 生成、注入器启动
src/engines/krkr/adapter.js Kirikiri 能力位、scan/detect 入口、diagnostics 与两条 pending 入口
src/engines/krkr/xp3.js    XP3 归档只读解析（索引 zlib、info/segm/adlr、手写 adler-32）
src/engines/krkr/ks.js     KAG 脚本解码与字符串收集（UTF-8 strict 先、Shift_JIS 兜底）
src/engines/krkr/project.js 根或 data/ 有 .xp3 即项目（向下 3 层）、归档列表
src/engines/krkr/extract.js 逐归档收 KS 字符串（.tjs 只计数），标不可解码
src/engines/krkr/profile.js Kirikiri 的 prompt / grammar / validate / verify
src/engines/launch.js      Windows exe 发现、子进程环境清理与 spawn
src/index.js               库门面（openProject / detectProject / … / VERSION）
src/core/fields.js        字段表与指令表（纯数据，会嵌进插件）
src/core/mzproject.js     项目发现（向下 3 层）、System.json 读取
src/core/datafile.js      数据文件解码（明文 / 单字节 XOR / 空白占位）
src/core/extract.js       遍历 data/ 抽出所有可译文本
src/core/textkey.js       转义码分词 / 归一化 / 校验
src/core/dict.js          字典读写
src/core/pluginsfile.js   js/plugins.js 解析与重写（保留尾逗号与换行风格）
src/core/install.js       安装 / 卸载（含 installedEntry / backupStatus 两个只读探针）
src/core/doctor.js        装完之后的体检（安装 / 备份 / 字典同步 / 运行时查找）
src/pipeline/provider.js  OpenAI 兼容 + mock provider
src/pipeline/translate.js 批处理、校验、重试、术语表
src/pipeline/wrap.js      按显示宽度折行（MZ/MV 不会横向自动换行）
src/pipeline/verify.js    译文体检（残留假名 / 原样回显 / 转义码 / 占位符 / 超宽行 / 繁体 / 说话人）
src/data/traditional.js   繁体专用字表（OpenCC TSCharacters，只留一繁对一简）
src/pipeline/terms.js     名字/术语的主流译法挖掘与漂移检测
src/pipeline/speaker.js   说话人标记的识别、房规统计与按房规修复
src/pipeline/report.js    verify 结果的 markdown 报告（只格式化，不重算）
src/plugin/YAKUSHA_Translator.js  运行时插件模板（install 时注入规则表）
native/build.mjs          原生组件构建（i686-pc-windows-gnullvm → native/prebuilt/manifest.json）
native/rgss-hook/         Rust cdylib：IAT 补 GetProcAddress、包装 RGSSGameMain、执行 bootstrap.rb
native/injector/          Rust bin：CreateProcessW(CREATE_SUSPENDED) → CreateRemoteThread(LoadLibraryW)
native/prebuilt/          预编译四件套（gitignore，CI/本地构建；随 npm 包发布）
test/                     678 个测试（含 CLI 端到端、0.10 信封契约、配置/前置、引擎/启动契约、
                          五个引擎的适配器契约、Ren'Py 的 .rpy/.rpyc 抽取、RGSS 的
                          Marshal / 归档 / 数据文档抽取与 native 交付层、Kirikiri 的 XP3 / KS 抽取）
docs/design.md            为什么走运行时钩子、文本面覆盖、转义码、设计约束、作为库用
docs/commands.md          所有命令的完整选项与 verify / terms / speaker 判据
docs/games.md             15 款实测游戏、全量翻译记录、官中游戏的处理
docs/limitations.md       已知限制全表
docs/architecture.md      分层、引擎适配器契约、plugin/translation/debug/inject 四种运行时模式、
                          GUI 与 core 边界
docs/json-contract.md     0.10 契约（已实现）：--json 信封、错误码、退出码、严格参数解析
docs/engines.md           引擎契约（0.12，0.13 扩五个引擎 + §13.4 Kirikiri）：adapter、能力矩阵、
                          安装/卸载、launch、attach 桩，§13.2 是 Ren'Py、§13.3 是 RGSS、
                          §13.4 是 Kirikiri 的抽取契约，§7.7 记 pending 交付
docs/config.md            0.10 实现：用户级配置、密钥优先级、威胁模型（密钥不落盘）
docs/export-format.md     0.10 实现：JSON 导出格式、排序、原子写与覆盖规则；0.13 扩 §8 TSV/CSV 表格与 import
docs/platforms.md         平台支持矩阵与决策记录（Windows-only 的原因与重评条件）
```

## 5. 关键决策与理由（改代码前请先读这一节）

| 决策 | 理由 |
| --- | --- |
| **运行时钩子，不改 `data/*.json`** | 改磁盘会破坏原游戏、更新即失效、无法回退；钩子只在内存里替换。 |
| **GUI 是 Electron 薄壳，core 保持零依赖** | 玩家要拖拽启动，浏览器拿不到被拖入文件夹的绝对路径，所以选 Electron；但汉化者仍需要 CLI 与脚本。两者都只是 core 的调用方，逻辑不复制。 |
| **改名为 Yakusha（訳者），字典目录与产品同名** | 旧缩写既像「机器翻译」，又和那个多引擎汉化工具撞脸，当窗口标题、exe 名、CLI 命令都不合适。`yakusha` 是「译者」，与游戏文化同源，短、好念、好打；目录跟着产品走，`<游戏>/yakusha/` 一眼知道是谁放的。 |
| **改名不保留旧路径兼容分支** | 兼容别名会把旧名写回代码与文档，等于规则白立；旧目录只用一次性迁移脚本处理（脚本在仓库外），代码里只有 `yakusha` 一个名字。 |
| **`--json` 用固定信封，三件事分开** | `schema` / `command` / `ok` / `outcome` / `error` 是保留键，其余载荷平铺；`ok` 只表示“命令成功”，`outcome` 才区分 ok / findings / error；退出码 0 / 1 / 2。修复类命令（translate/speaker/status）有问题仍是 ok，发布闸门交给 `verify`。理由：机器消费者要能区分“发现缺陷”和“命令失败”，而现有 `ok` 一字段两义（[json-contract.md](../json-contract.md)）。 |
| **0.10 不做项目级配置，密钥不落盘** | 项目里的一份 `config.json` 能把用户环境变量里的 key 重定向到任意 `baseUrl`；Windows 上 `chmod 0600` 实测仍是 0666（`mode & 0o777 === 0o666`）。所以 0.10 只做用户级非敏感配置，key 只走 `--api-key` / 环境变量；持久化留到 GUI 版本的 `safeStorage`（现排期 0.14，[config.md](../config.md)）。 |
| **没有默认 provider / model / 密钥，真实调用前必须配置** | 内置 `gpt-4o-mini` 会让一次没配置好的运行看起来是“能跑”，实际只会在端点上报错；如果同时换了 `baseUrl` 却没配 key，还可能把请求发到错误的地址。缺 provider / model / key，或 `compatible` 缺 `baseUrl`，一律在任何请求前 `E_CONFIG`（退出码 2）；`mock` / `--dry-run` / `--glossary-only` 不读这些配置。理由：错误应在本地、在花钱之前暴露，而不是让用户猜为什么 401。 |
| **launch 只认项目根的直接子 `.exe`** | exe 不得来自配置、字典或游戏内任意路径；`--exe` 只接受裸文件名；spawn 用 `shell:false` + `detached` + `stdio:ignore`，并从子进程 env 删除 `YAKUSHA_API_KEY` / `OPENAI_API_KEY`。理由：分享的游戏目录本身就是不可信输入（[engines.md](../engines.md) §8）。 |
| **trunk-based：一条 `main` + 短分支 + self-PR squash** | 单人开发没有并行评审需求，`develop`/`release` 这类长期分支只会制造同步债；短分支让 CI 在合并前跑一遍，squash 保持 `main` 线性、可读、可回滚。发布用 `vX.Y.Z` tag；只有旧版本确实有人在用时，才从 tag 切维护分支（规则见 §9）。 |
| **Windows-only，Linux/macOS 不做也不测** | 单人开发，需求证据与验收机器都没有；macOS 还要签名/公证，且在 macOS 上注入类引擎一个都跑不了。写成决策记录，避免以后“顺手加一个平台”把测试面乘二（[platforms.md](../platforms.md)）。 |
| **detect 返回判别式，openProject 继续抛** | 库调用方已经依赖 `openProject` 抛错；CLI 不应靠解析异常文本决定错误码。`adapter.detect` 把预期失败变成 `{ok:false,code,message,candidates?}`；registry 按 MZ→MV 顺序（0.11 起加上 Ren'Py 排第三），`E_MULTI_ROOT` 立即返回，缺 `data/`、缺 `plugins.js` 的具体文案优先于另一个引擎的通用失败。适配器只薄包装 core，不搬文件。 |
| **引擎适配器 + 四种运行时模式，注入不是前提** | 长期要像成熟的多引擎汉化工具一样支持多引擎，但 MZ/MV 用插件就够；CDP（`--remote-debugging-port`）还能覆盖一整类 Chromium 壳。把 `inject` 留在契约里，pipeline 与 GUI 不因新引擎返工。0.11 加进第四种 `translation`（Ren'Py，见 §6）：它证明不写原生代码也不改游戏脚本就能覆盖一整个家族；`debug` / `inject` 长期只有契约位，`debug` 的机制已在 MZ 上实机验证、`attach` 命令未实现，`inject` 到 0.18 才在 RGSS 上落地（`install --native`，见 §6 的 0.18 段）。 |
| **运行时载荷形状先定死（`format` + `rules` + `entries`）** | 插件、调试注入、原生 hook 吃同一份数据；以后加投递通道不用改游戏侧钩子。 |
| **字典 key = 原文** | 不用 hash/自增 id：译文要能人工校对，key 必须是玩家能看懂的原文。 |
| **校验在写之前** | 宁可留日文，也不留一条会显示成乱码或吞掉转义码的译文。 |
| **`fields.js` 单一真源** | 插件的 `RULES` 由 `install` 生成，`test/rules-sync.test.js` 守着漂移。 |
| **不做自动语言检测（不做 `--skip-lang`）** | 实测判不出来：日文原版那款有 437 条"无假名"条目，多数是纯汉字日文（武闘家/騎士/鎧系）；用日文特有汉字集合加严后仍会**误跳过 64%** 的日文条目。误跳过 = 玩家直接看到日文（不可接受），误翻译 = 多花 token（可接受）。正确做法是全量跑，模型对已是中文的句子原样回显，被"原样回显"闸门拒收。 |
| **折行放在校验之后** | 模型输出仍逐字比对；折行是本地排版，不该被拉进校验闸门。 |
| **`--max-length` 默认 0，不按窗口自动推断** | 先量后定：真机测得全角字宽 = `fontSize`、半角 = 其一半，四款跑完全量翻译的游戏**最长行都没超预算**（MZ-C 84 < 104、MZ-A 54 < 82、两款 MV 52 < 82）。自动推断只会在 MZ 上把本来放得下的行折掉（MZ-C会折 1,700 行），在 MV 上因 `System.json` 没有 `advanced` 字段直接算出 `NaN`。折行是排版动作，该由人决定要不要。 |
| **换行数闸门不放宽** | 曾为兼容折行试过 `b < a`，最后回退成严格相等——闸门一旦被扭曲，后面所有校验都不可信。 |
| **重写 `plugins.js` 保留原形状** | 有的游戏带尾逗号、有的不带，有的 CRLF。整文件重排会让一次安装变成全文件 diff。 |
| **`verify` 区分 error / warn，只有 error 让命令失败** | 发布前需要一条能过的判定线。原样回显、转义码损坏、占位符丢失会让玩家看到错内容，必须拦；残留 `ッ`、多一个换行、超宽行是风格问题，拦下来只会让人关掉检查。 |
| **`terms` 从正文反推名字表，而不是拿名字表去校验正文** | 实测反向走不通：名字表里 `アリア→艾莉亚` 与另一个名字的条目本身就是错的（后者正文 0% 支撑），拿它去校验正文等于用错的标准判对的文章。反过来从 3,653 行正文里统计，`阿莉亚` 占 96%；另一个名字的主流写法占 76%，这才是玩家实际读到的名字。 |
| **`terms` 在 90% 内取最长，而不是取最高频** | 纯频次会切碎片：`哥布林` 的每个子串出现次数都一样多，最高频会选中 `哥布`；实测 `ゴブリン` 因此变成「哥布」、`ベヒモス` 变成「希摩」。加「取最长」后一起变对。 |
| **`terms` 的候选首字排除虚词，但保留 `向`** | `丰满的胸部` 会切出 `的胸部` 这种假漂移，所以首字是「的/了/在/把」的候选直接丢。`向` 虽是助词，但也是真名字首字（向阳处），漏掉真名字比留下一个切口更糟——实测把它加进黑名单后，`向阳处` 被切成 `阳处`。 |
| **`--glossary-only` 默认只补空缺，覆盖要显式 `--overwrite`** | `terms` 报的漂移恰恰在「已翻译」的条目上，而词表应用原本跳过已翻译条目 → 挖出来的修复永远应用不上（第一版 CLI 测试就是这么挂的：`艾莉亚` 没被改成 `阿莉亚`）。但覆盖是危险动作，所以做成 opt-in：普通词表仍是「补空缺」，不静默重写别人的译文。 |
| **术语表按请求过滤，不整张塞进 system prompt** | 实测 MZ-A 952 个请求，每个请求的 40 行平均只提到 **3.3** 个术语（最多 14 个），却要为整张表的 693 字付费；过滤后每请求 47 字，省 93%。过滤是纯字面包含（跨条目用 `\u0000` 拼接，避免把上一行的结尾和下一行的开头拼出一个不存在的词）。代价是`名称一致`只对本次请求里真的出现的名字起作用，这是可接受的：词表本来就是「这个词固定这么翻」，不是「这一段要用这些词」。 |
| **不做跨游戏翻译记忆库（TM）** | 量过：15 款游戏并集 256,272 条、各游戏之和 259,165 → 跨游戏共享仅 **1.1%**；用其余 14 款已翻游戏去覆盖最大的那款（58,256 条）只命中 **0.87%**。省不到 1% 的 token，不值得引入一套 TM 存储与匹配。同游戏内的重复（名字一致性）才是真问题面，占 4%–39%。 |
| **`--context` 可重复，语义是「任一命中」（OR）而非「全部命中」（AND）** | 用这个过滤的真实目的几乎总是「只翻对话和道具说明，别碰系统术语」，那是并集。AND 在这类语料上恒为空集（一条文本不可能同时出自 `Map001.json` 和 `Items.json`）。实现上 `setFlag` 只给 `REPEATABLE` 里的名字做数组累积，其他开关重复传仍是「后者覆盖」的旧行为。 |
| **`verify` 的假名判据排除 `・` 和 `ー`** | U+30FB / U+30FC 在中译文里是正常标点，早期审计脚本把 `睡眠・沈黙` 判成未翻译，一款误报 22 条、最大的那款误报 135 条（真值 106）。这类阈值一旦定错，整个命令就没人信了。 |
| **`trad` 只报「原文里没有的」繁体字，不报译文里所有繁体字** | 日文原文本来就大量使用繁体形汉字（`愛`、`動`、`書`、`員`、`婦`），naive 判据在四款游戏上分别是 34/67/1/12 行；比对源文本后只剩 30/64/1/**0**，MV-H 那款直接从 12 归零——它的 12 行全是「日文说话人名原样保留」，而名字里的繁体字原文本来就有。曾试过按 CJK 段切、段内有假名就跳过的守卫，但那样会把同一行里别的真泄漏一起放过。 |
| **繁体字表只收「一繁对一简且不同」的行，多目标字必须丢** | OpenCC 的 TSCharacters 里 `乾→干,乾`、`藉→藉,借`、`於→于,於`、`瞭→瞭,了` 在简体里也是合法写法，收进来就是纯假阳性。第一版手写 286 字表因为没排这些，只报了 44 条（漏报）；用 2,898 对正式表 + 源文本守卫后是 118 条。 |
| **`speaker` 的「名字留日文」是 error，不是 warn** | 标记内容会被插件原样渲染进姓名窗，玩家看到的是同一个角色身上混着中文名和日文名。这和残留 `ッ` 那种风格问题不是一个性质。但只报「本游戏别处翻过这个名字」的（实测 411 条），全程刻意保留日文名的作品不报——否则会给每个日式名字刷警告。 |
| **房规（house rendering）优先「真正的译文」而非「原样照抄的源名」** | 初版纯按票数取房规，结果 `先生→老师 x1 / 先生 x2`、`主婦→主妇 x1 / 主婦 x3`、`鉄棒少女→单杠少女 x1 / 鉄棒少女 x1` 这类「既是日语称谓、又是真名字」的词会让「留日文」以票数取胜，然后反过来把**正确的中文译文**报成漂移、并建议改回日文。规则改成：非假名且与源名不同的写法优先，同层再比次数，平票取非假名。 |
| **`speaker` 默认只修「没翻的」，两种中文写法要显式 `--include-drift`** | 「这一行还是日文、别处翻过」有唯一正确答案（抄别处那个），可以机械执行；「沙耶香 vs 沙耶加」「疲惫的女性 vs 看起来疲惫的女性」是风格取舍，两个都是合理中文，自动统一等于替人做美学决定。所以后者做成 opt-in，跑之前先看 `--dry-run`。 |
| **`speaker` 是纯本地改写，不调模型** | 正确的译法就在同一个字典里（用了 490 次的某个写法），再问模型一次既贵又可能发明第三种写法。`repairSpeakerNames` 只做「按位置换掉标记内容」，转义码与正文一个字节都不动，跑两次幂等。 |
| **`speaker` 的标记识别用白名单正则，不用 `<[^>]*>`** | MZ-C 的 84 行 `<...>` 全是代码表达式（`<50*\v[65]>`、`<\s[25] ? " OFF ":" ON " >`），天真匹配会把它们当人名。只接受「纯中文/假名/空白、长度 ≤ 40」的内容后，那款游戏 0 命中，真正有 `\N<名字>` 插件的那款 1,151 行正常命中。 |
| **`verify` 有 error 时用 `process.exitCode = 1` 失败，不用 `process.exit(1)`** | 契约上要让 `verify && install` 能拦住有问题的字典；实现上必须让 `--json` 的 stdout 冲刷完再退。`process.exit` 会截断管道里的 JSON，脚本解析直接炸。这个 bug 实测存在过（打印 FAILED 但退出码 0），修复时把退出码本身写进了测试。 |
| **报告只格式化，不重算** | `buildReport` 吃的是 `verifyDictionary` 已经算好的 `result`，不重新跑一遍检查。重算会让报告和终端输出的数字有机会不一致（比如中途有人改了字典），而报告的价值就在「它和刚才那次运行是同一份事实」。失败时也照写——最需要贴出去的正是失败的那次。 |
| **`uninstall` 只在「除自己那条以外没变」时用备份整体还原** | 备份只是文件在某个时刻的一张照片，不是「撤销」的凭据。装好之后游戏更新、你另装了一个插件、或者在 RPG Maker 编辑器里存过档，`plugins.js` 就已经不是那张照片了；无条件还原会把别人的改动一起删掉，而且是静默的。所以先比 `$plugins`（name/status/description/parameters，键序与排版不算改动）：一致才逐字节还原，不一致就只摘掉自己那一条、备份留原地并明确打印出来。`install` 也会在发现备份对不上时先说明，避免用户以为「反正能一键还原」。 |
| **`doctor` 只在 `broken` 时退出 1，`warn` 不算失败** | 诊断命令的职责是报告，不是闸门：还有 2 条没翻、192 条风格警告都是正常状态，让它们退出 1 只会让脚本里到处加 `|| true`，闸门形同虚设。真正的发布闸门是 `verify`（error 才失败），`doctor` 回答的是「这台机器上现在是什么形状」。 |
| **README 只留能照着做的步骤，判据与实测拆到 `docs/`** | README 一度 650 行，安装步骤、十类判据、15 款游戏普查、19 条限制全堆在一起，想照着做的人要翻过一半文档才找得到命令。现在 README 只回答「怎么装、怎么跑、出问题看哪」；为什么这样实现（design）、完整选项与判据（commands）、跑过哪些游戏（games）、边界（limitations）各归一处。`docs/dev/DEVLOG.md` 仍是内部开发日志，不面向使用者。 |
| **损坏的 `plugins.js` 要报出来，不能让 doctor 崩栈** | 手改坏或写了一半的文件，正是最需要诊断的时候。初版 `backupStatus` 直接 `parsePluginsJs` 抛异常，doctor 打出一段 stack trace 而不是「哪里坏了」；现在解析失败记成 `plugins.js fail`，并跳过依赖它的 `install` / `backup` 两项检查，其余照常输出。 |
| **pickle 只解码数据，不执行** | `.rpyc` 是游戏分发的字节，里面的 `GLOBAL` / `STACK_GLOBAL` / `REDUCE` 本来就够拼出任意调用。实现成「记录点分类名 + 合并参数」的纯数据栈机，不 import、不 eval、不构造真对象：读者拿得到需要的 AST 字段，而恶意构造的 `.rpyc` 最坏只是解出一个形状古怪的对象。 |
| **`.rpyc` 尾部的 MD5 不校验** | 那 16 字节是编译期一致性戳，只有 Ren'Py 自己读它。校验它不会让任何一句译文变好，却会让「玩家本来能跑、只是 md5 对不上」的游戏被工具拒收——工具的价值在游戏能跑时的文本，不在替引擎做完整性检查。 |
| **Ren'Py 走 translation 档，只新增一个文件** | 有 `translate <lang> strings:` 这条官方扩展点，就没有理由去改别人的 `.rpy` 或 `options.rpy`：多改一个文件就多一份「游戏更新后对不上」的风险，卸载也不再是一句话（删一个文件即可）。代价是只能投 `schinese` 一种语言，且依赖游戏自身的翻译机制（§7）。 |
| **py2 的 `.rpyc` 明确报 undecodable，不做兼容猜测** | Ren'Py 7.x 的游戏用 Python 2.7 编译，pickle 里的构造与 8.x 不同。猜着解会得到「看起来成功、字段却是错的」的树，而这种错会一路静默流进译文；宁可让这个文件计进 `undecodable` 并在 `scan` 里显示出来，也不要给出一个不可信的文本表。 |
| **Ruby Marshal 只解码，不执行，也不构造真对象** | `.rvdata2` / `.rxdata` 是游戏分发的二进制，Marshal 流里能出现任意类名。实现成「类名 + 实例变量」的纯数据记录（`{ __type: "object", className, ivars }`），`T_DATA` 只留原始字节，字符串留字节不解码，整数超 `Number.MAX_SAFE_INTEGER` 转 `BigInt`——`marshal.js` 里没有 `eval`，也没有 Ruby 解释器。读得回来、写得回去，就够了。 |
| **归档目录只读头部窗口，上限 64 MiB，不把整包读进内存** | 实测那份 `.rgss3a` 是 644,284,359 字节，而目录（全部条目名 + 偏移 + 长度）在文件最前面，几 KB 就够。`archive.js` 用一个可增长的头部窗口按需重读（`MAX_DIRECTORY = 64 << 20`，超了明确报错），单个文件的数据按需读、不缓存整包。理由：玩家机器上内存是稀缺资源，而工具只需要目录 + 当前要读的那一个文件。 |
| **抽取只收 101 / 102 / 320 / 401 / 405，402 故意跳过** | 这五个码是玩家真的会读到的文本（说话人名、选项、改角色名、台词、滚动续行）。`402`（每个选项分支的标记）里的文本与配对的 `102` 是同一串，收它只会多一个 context、不多一条可译文本；`108`/`408` 是注释、`355`/`655` 是 Ruby 脚本行、`231`/`322` 是图片文件名，都不是文本面。判据写在 `src/engines/rgss/extract.js` 文件头。 |
| **`@note` 与所有 `@*_name` 资源名一律不抽** | `@note` 是作者写给脚本的元数据通道（插件配置常塞在里），翻它等于改配置；`@*_name`（`@face_name`、`@battleback_name`、`@tileset_name` 等）是资源文件名，翻了游戏就找不到素材。只收玩家读得到的字段——这条与 Ren'Py 跳过 `tl/` 是同一个原则：**能翻不等于该翻**。 |
| **仓库夹具只用合成 XP3 / KS，不放真实归档** | 真实 `.xp3` 带着游戏版权与玩家数据；合成 writer（`test/krkr-fixture.js`）能构造出与真实格式逐字节同构的索引，足以覆盖全部代码路径，还让测试不依赖任何外部文件。RGSS / Ren'Py 的夹具同此规矩。 |
| **Hxv4 改版索引报 `E_UNSUPPORTED`，绝不猜** | 某些本地化发行版的 XP3 用 `Hxv4` 索引替代标准索引；猜解析等于对未定义格式下赌注，错了会把玩家文件读坏。明确报「只读标准 XP3 索引」让上游工具先转换。 |
| **TSV / CSV 走 RFC4180 风格 quoting** | 分隔符 / 引号 / CR / LF / 首尾空格五类字符一律加引号、引号翻倍，是表格往返（export → import 字节相同）的唯一可靠判据；「看起来不含分隔符就不用引号」会在某一天遇到带制表符的台词时静默坏表。 |
| **import 的 contexts：字典自身优先于行** | 同一 textkey 的行 contexts 只是导出时刻的快照，而字典 contexts 是后续人工维护的最新意图；合并时字典赢、行只补空，避免旧快照覆盖人工修正。 |
| **RGSS 交付只走 `--native`，不给默认档** | RGSS 没有插件目录，「装上了但没生效」是最坏的结果：用户以为翻译已启用，启动后还是日文。做成显式开关，不带就 `E_USAGE` 并给出完整命令，把「要改启动链」这件事摆到台面上；`--dry-run` 再把验证和写入分开一次。 |
| **原生组件用 SHA-256 manifest 校验，先校验后写入** | 「我装的四个文件是不是我构建的那四个」不需要签名也能逐字节回答；签名解决的是分发信誉（§8.1 #1，仍未定）。校验在任何写入之前，缺文件报 `native component is missing`、被改过报 `failed its integrity check`，两条分开说，失败一个字节都不写。 |
| **`dictionary.txt` 用 `base64(source)\tbase64(target)` 纯文本** | bootstrap.rb 跑在游戏进程内的 Ruby VM 里，不能依赖 Node 或 JSON；base64 让任何 Unicode、制表符、换行都能安全过行协议，按 source 排序又保证同一份字典两次安装字节相同（可复现、可 diff）。 |
| **卸载只认自己写的 `manifest.json`** | `<game>/yakusha/native` 可能是用户手建的目录；没有 manifest 就拒绝递归删除（`E_CONFIG`），宁可留下垃圾也不误删别人的文件。「自己的目录」由自己写的凭证证明，不由路径猜测。 |
| **只翻 `load_data` 返回对象可达的字符串 + Vocab 兜底** | 脚本里的字面量在 Ruby 对象树里不可达，注入器无法可靠区分「UI 文案」与「代码」；宁可漏翻也不猜。代价写进 §7：脚本硬编码的字面量不翻。 |

## 6. 实测数据（可复现的基准）

### 15 款游戏普查（本机全量，`undecodable` 全程 0）

| 引擎/版本 | data 文件 | unique | total | 游戏 |
| --- | --- | --- | --- | --- |
| mv 1.6.1 | 119 | 10,356 | 20,771 | MV-A |
| mv 1.6.1 | 64 | 14,945 | 25,605 | MV-B |
| mv 1.6.2 | 31 | 19,890 | 28,400 | MV-D |
| mz 1.7.0 | 51 | 38,044 | 80,502 | MZ-A |
| mz 1.9.0 | 82 | 4,018 | 7,110 | MZ-E |
| mz 1.5.0 | 28 | 2,295 | 4,638 | MZ-F（XOR 混淆） |
| mz 1.8.0 | 27 | 6,797 | 10,366 | MZ-G（改名子目录） |
| mz 1.3.2 | 276 | 58,256 | 113,050 | MZ-B |
| mv 1.6.2 | 268 | 36,203 | 41,136 | MV-E（data/www） |
| mv 1.6.2 | 41 | 4,388 | 7,161 | MV-G |
| mv 1.6.1 | 63 | 159 | 184 | MV-C |
| mz 1.7.0 | 265 | 24,757 | 31,575 | MZ-C |
| mz 1.9.0 | 30 | 8,752 | 14,634 | MZ-D |
| mv 1.6.2 | 46 | 4,065 | 8,852 | MV-H |
| mv 1.6.2 | 453 | 26,240 | 81,017 | MV-F |

合计 **259,165 unique / 475,001 total**。

### 全量翻译完成度

| 游戏 | total | translated | pending | 残留原因 |
| --- | --- | --- | --- | --- |
| MZ-A | 38,044 | 38,042 | 2 | 一条是纯全角空格（`empty`）；一条转义码 7 vs 6（`\\.` 序列不可译） |
| MZ-C | 24,757 | 24,735 | 22 | 校验拒收：纯拟声词、专有名词未译 |
| MV-G | 4,388 | 4,387 | 1 | `\N<ひなた>` 标记剥掉后仍有假名 |
| MV-H | 4,065 | 4,064 | 1 | 同上 |

残留全部是**校验闸门正确拒收**，不是 bug。

MZ-C那 22 条只有 0.09%（24,757 条里），且都是"译了反而更容易出错"的短拟声词，
运行时插件回退原文，玩家看到的是日文感叹词而不是错位文本。

### 两款新游戏的验收（0.5.0/0.5.1，都是此前没跑过的游戏）

| 游戏 | 引擎 | 关键事实 |
| --- | --- | --- |
| MZ-C | MZ 1.7.0 | 265 个 data 文件 / 24,757 条；**133 个插件共存无冲突**（含消息、换行、战斗 UI、画廊等类别）；1280×720；`__YAKUSHA.stats()` 实测 `lookups 2,789 / translated 2,020 / rejected 0` |
| MZ-F | MZ 1.5.0 | **28 个 data 文件全部单字节 XOR**，`extract` 解出 2,295 条、`undecodable` 0；装插件后 `__YAKUSHA.stats()` `lookups 3,046 / translated 0`（官方中文，字典为空 → 全部 miss，属预期）；`install`→`uninstall` md5 逐字节还原 |

两款都做过运行时确认（本地临时注入、验完即删，不随仓库分发）；XOR 那款证明
**插件在 XOR 数据上照样能挂上**（钩子在 JSON 解析之后，与数据是否加密无关）。

### 单行宽度实测（决定 `--max-length` 要不要设默认值，结论：不设）

真机测（MZ-C CDP）：`Window_Message.contents.measureTextWidth()`
`あ`=20px、`中文字`=60px、`A`=10px → **全角字宽 = fontSize 实际渲染值，半角 = 其一半**，
与 `displayColumns` 的"全角 2 列 / 半角 1 列"在 10px 一列基准下完全一致。
`contentsWidth()` = 1248 = `boxWidth 1272 - 2×padding 12`。

用 `列预算 = 2 × floor((screenWidth - 32) / fontSize)` 算真实容量：

| 游戏 | screenWidth | fontSize | 列预算 | 实测最长行 | 超限 |
| --- | --- | --- | --- | --- | --- |
| MZ-C (MZ) | 1280 | 24 | 104 | 84 | **0** |
| MZ-A (MZ) | 1110 | 26 | 82 | 54 | **0** |
| MV-G (MV) | — | 28 | — | 52 | **0** |
| MV-H (MV) | — | 28 | — | 52 | **0** |

四款跑完全量翻译的游戏**没有一行超宽**。原因：中文比日文短约 28%（p50 长度比 0.71），
system prompt 里还有"保持紧凑"的约束。所以 `--max-length` 保持默认 0，
只在需要硬保证时手动加。

若将来真要设默认，按行长分布（每行显示列宽）：
MZ-C `over40 2,557 / over44 1,700 / over48 1,076 / over56 364`（maxLine 84）、
MZ-A `over40 3,226 / over44 1,300 / over48 388 / over56 0`（maxLine 54）、
MV-G `over40 79 / over44 19 / over48 3`（maxLine 52）。

**MV 上算不出这个预算**：MV 的 `System.json` 没有 `advanced` 字段（`advanced.screenWidth`
是 MZ 才有的），任何"从 System.json 自动推列宽"的实现在 MV 上会得到 `NaN`，
这也是不做自动推断的理由之一。

### verify 在三款已翻译游戏上的实测（0.4.0）

| 游戏 | translated | error | warn | warn 构成 |
| --- | --- | --- | --- | --- |
| MZ-A (MZ) | 38,042 | **0** | 169 | kana 106（拟声词里的 `ッ`）、lines 61（中文比日文短，模型主动断行）、rejected 2 |
| MV-G (MV) | 4,387 | **0** | 1 | rejected 1 |
| MV-H (MV) | 4,064 | **0** | 1 | rejected 1 |

加 `--max-length 48` 后再跑：MZ-A 多出 width 388（这些条目当初没带 `--max-length` 翻译，
重跑一次 `translate --max-length 48` 就能回填折行），另两款分别只多 3 / 5 条。

MZ-A 那 61 条 lines 全部是 `0 -> 1`（原文一行，模型为了可读性断成两行），不是文字损坏；
`--max-length` 的折行本来就会改写换行，所以这条判定只能是 warn。

### `trad` / `speaker` 在五款已翻译游戏上的实测（0.5.2）

| 游戏 | error | warn | trad | speaker | 说明 |
| --- | --- | --- | --- | --- | --- |
| MZ-A (MZ) | 0 | 192 | 23 | 0 | 没有 `\N<名字>` 插件 |
| MZ-C (MZ) | 0 | 195 | 56 | 0 | 84 行尖括号全是代码表达式，被白名单排除 |
| MV-G (MV) | 0 | 1 | 0 | 0 | 干净 |
| MV-H (MV) | **411** | 59 | 0 | 469 | 某姓名窗插件的名字窗 |
| MZ-G (MZ) | 0 | 1 | 0 | 0 | 官方中文，正文本来就是中文 |

`trad` 的命中最多的两款分别 23 / 56 条（0.06% / 0.23%），全部是模型偶发切到繁体的
长句（多为对话密集的段落）。

MV-H 是 `speaker` 唯一的 error 来源：1,151 行带名字标记，32 个不同名字里
**25 个有多种写法**。最典型的是一个名字：主流写法用了 490 次，另一种写法 38 次，但仍有
**301 行原样留着日文名**；另一个名字主流写法 103 次、留日文 54 次。
这类残留和「拟声词里的 `ッ`」不同——玩家会看到同一个角色的名字两种语言混排，
所以判 error。

另一个真发现：5 个纯汉字的职业/身份名
共 12 行完全没翻。纯汉字所以逃过了假名检测，但它们含繁体专用字（員/婦/員/運/師），
在简体中文里一定写作 员/妇/员/运/师——加这条规则后 error 从 399 升到 411。

### `speaker` 修复在 MV-H 上的实测（0.6.0）

```bash
node bin/yakusha.js speaker "<game>"                      # 第一轮：只修没翻的
node bin/yakusha.js speaker "<game>" --names names.json   # 补本作从没翻过的名字
node bin/yakusha.js speaker "<game>" --include-drift      # 第三轮：统一中文写法
```

| 轮次 | 改动 | error | 说明 |
| --- | --- | --- | --- |
| 修复前 | — | 411 | 一个名字留日文 301、另一个 54、纯汉字名 12 |
| 第一轮 `speaker` | 23 个名字 / 414 条 | 411 → 3 | 只改「这一行还是日文、别处翻过」的两类 |
| `--names` | 1 个名字 / 3 条 | 3 → 0 | 只剩 1 个全作没翻过的名字（没有可抄的写法） |
| `--include-drift` | 8 个名字 / 51 条 | 0 → 0（warn 51 → 0） | 写法 A→B x38、写法 C x4、写法 D→E x3 等 |

三轮结束后 `verify` 只剩 1 条 warn（一行名字标记被「原样回显」闸门正确拒收），
`status` 仍是 4,064/4,065。**全程没有调用模型**，跑两次 `speaker` 幂等（第二次 `entries: 0`）。

### terms 在四款已翻译游戏上的实测（0.5.0）

| 游戏 | 名字条目 | 挖出术语 | drift | missing | 耗时 |
| --- | --- | --- | --- | --- | --- |
| MZ-A (MZ) | 510 / 612 | 52 | **5** | 0 | 714ms |
| MV-G (MV) | 156 / 215 | 20 | **2** | 0 | 39ms |
| MV-H (MV) | 145 / 148 | 6 | 0 | 0 | 29ms |
| MZ-G (MZ) | 45 / 45 | 3 | 0 | **3** | 12ms |

分母是全部命中 `NAME_CONTEXT` 的条目数（含因太短 / 像散文而被跳过的）。
真实挖出的漂移：
`アリア 艾莉亚(4%)→阿莉亚(96%) n=3653`、另一个名字 0%→76%、
以及 5 条语义变化（同一原文在不同上下文被译成两种都讲得通的近义词，主流占比 55%–100%）。

判对没误报的：`リンカ 琳卡`、`ルビー 露比`、`ホーク 霍克(99%)`、`ゾーイ 佐伊(100%)`、
`ゴブリン 哥布林(100%)`、`ベヒモス 贝希摩斯(92%)`、`オーク 兽人(97%)`。

MZ-G 那 3 条 missing（均为角色名）是**真结论**：官方中文游戏，名字字段的
target 是空的，但正文里译名早就统一了 → 正好用 `terms --write` 反过来补名字表。

### 术语表按请求过滤的效果（0.5.0）

| 游戏 | 请求数 | 每请求条目数 | 术语表条数 | 每请求相关术语 | 整表字数 | 过滤后字数 | 省 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| MZ-A | 952 | 40 | 52 | 3.3（最多 14） | 693 | 47 | **93%** |
| MV-G | 110 | 40 | 20 | 3.0（最多 11） | 272 | 46 | **83%** |

把 `minHolders` 从 5 降到 1，术语表从 52 涨到 117 条（1,791 字），
但每请求过滤后仍只有 49 字 —— 词表变大几乎不影响开销，这才是敢把阈值调低的原因。

### 名字在正文里的覆盖比例（决定要不要做一致性检查）

| 游戏 | 名字数 | 含名字的 key | 占比 |
| --- | --- | --- | --- |
| MZ-A | 1,474 | 6,931 | **18.2%** |
| MV-E | 1,022 | 14,216 | **39.3%** |
| MZ-C | 1,473 | 3,465 | 14.0% |
| MV-G | 291 | 767 | 17.5% |
| MZ-B | 1,152 | 3,766 | 6.5% |
| MV-H | 186 | 182 | 4.5% |

### 其它基准

- 术语表 127 条只占唯一数 0.3%，但覆盖 **18.4%** 的出现次数；要覆盖 42% 得进前 5000 条 → 长尾极重，机器翻译必须跑全量。
- 译文长度比：p50 **0.71×**（中文普遍比日文短），只有 0.9% 比原文长；`--max-length 54` 对 3.8 万条只改动 61 条，且**控制码 0 丢失、可见字符 0 丢失**。
- 7 款游戏做过 `install` → `uninstall` 往返，`plugins.js` 全部逐字节还原（md5 一致）；
  XOR 那款是 `7c5df17309bb01551d0ba6de2d79ca31` → 装后 `6b55d468fd539ad7cff2782f9a4712f3` → 卸载后回到原 md5。
- 运行时命中：MZ 那款 `lookups 60,781 / translated 60,779 / misses 2 / rejected 0`。

### 0.7.0 报告与退出码实测

- MZ-A（38,044 条）：0 error / **192 warning**（kana 106、lines 61、trad 23、rejected 2），
  `verify --write-report` 生成 **38,502 B** 报告，耗时 0.34s，退出码 0。
- MZ-C（24,757 条）：0 error / **195 warning**（kana 117、trad 56、rejected 22），
  报告 35,425 B，退出码 0。
- 报告不是一坨文本：按 kind 分节、error 类排在最前、每节带一句「为什么重要/怎么修」，
  单条是「severity: 原文 -> 译文」（原文和译文各自用反引号包住）再加一行缩进 detail；
  多行原文显示成 `⏎`，文本里含反引号时自动换更长的 fence。
  这两份报告就是「终端里看不过来」的实证。
- 退出码契约：构造一条原样回显 → 打印 `result : FAILED, 1 error(s)` 且退出码 **1**；
  只有 warning 时退出码 0。两条都有 CLI 测试守着（0.7.0 之前前者是 0，测试也只断言了 stdout）。

### 0.7.1 卸载漂移实测（MZ-A，plugins.js 6.6 MB / 46 条）

用这款游戏**装之前的那份** `plugins.js` 做基线（6,649,576 B；装完后是 6,649,775 B，多出来的
199 B 就是我们那一条）：

- 干净安装 → 卸载：`createdBackup:true`，卸载 `restored:true / drifted:false`，
  `plugins.js` 的 md5 与装前**逐字节一致**，`.yakusha-backup` 被删除。
- 装后往 `$plugins` 里插一条 `OtherMod` 再卸载：`drifted:true / restored:false`，
  `keptBackup` 指向备份；`OtherMod` 还在、`YAKUSHA_Translator` 已摘掉、插件文件已删、
  备份留原地。人读输出是 `plugins.js changed after install: removed only the yakusha entry` +
  `backup kept : <path>`。
- 被改过之后再 `install`：`staleBackup:true`，打印两行 warning（
  `plugins.js changed after the backup was taken;` / `uninstall will keep those edits and only remove the yakusha entry`）。
- 边界（有测试）：如果备份本身是在「已经装过、但当时没留备份」的状态下拍的，备份里就有自己那条；
  卸载判为 drifted、保留备份、**不还原**——否则刚摘掉的条目会被备份又写回去。

### 0.8.0 `doctor` 实测（MZ-A / MZ-C / 四种故障）

健康状态（MZ-A，已装，字典 38,044 条）10 项检查全 ok，只有 `progress` / `rejected` 两条
warn（还有 2 条没翻、2 条被校验拒收），结尾 `verdict : usable with 2 warning(s)`、EXIT=0，
耗时约 4.0s（大头是 `verify` 遍历 38k 条；MZ-C 24,757 条同样 verdict，约 0.8s）。

故障复现（每条都先用 `install` 造出健康状态，再只破坏一处）：

| 破坏方式 | doctor 的结论 | 退出码 |
| --- | --- | --- |
| 从 `$plugins` 删掉我们那条（模拟游戏更新覆盖） | `install fail the plugin file is there but its $plugins entry is gone (game update?) - run install again`，verdict broken | 1 |
| 把 `plugins.js` 写成半截 `var $plugins = [{"name":` | `plugins.js fail js/plugins.js is not readable (plugins.js: unterminated array literal) - restore it from the backup or reinstall the game`，其余检查照常输出 | 1 |
| `install --embed`（离线分发形态） | `runtime ok translations compiled into the plugin (38042 entries)` | 0 |
| 删掉 `yakusha/dictionary.json` | `dictionary fail` + `runtime fail` | 1 |

「把文件写坏」这一行是实测踩出来的：初版 `backupStatus` 直接 `parsePluginsJs`，doctor 会在
最需要它的场景下打出一段 stack trace，而不是一句「哪里坏了」。

### 0.10.0 WP1 契约与耗时

`npm test`：253 → **283 个**，耗时 5.9s → 约 6–7s（新增 17 条信封契约 + 4 条版本 + 9 条配置前置）。
契约测试直接跑 `bin/yakusha.js`（`spawnSync` + 清空环境变量），逐条验证：每个命令的
stdout 恰好一行、五个保留键在最前、`ok === (outcome === "ok")`、payload 没有 `data` 包装、
`outcome` 与退出码一致；`verify` 有 error / `doctor` broken 为 `findings`/1，
只有警告是 `ok`/0，写报告失败是 `E_IO`/2（error 压过 findings）；未知命令/选项退出 2 且
错误消息不带 usage 全文；`--version` 在 `scan --bogus --version` 下仍只打印版本行。

用户随后要求“没有配置好 API 和 provider 就不许访问 LLM”：`openaiProvider` 不再回退
`gpt-4o-mini`，`translate` 缺少显式 provider / model / key 时在构造 provider 时直接
`E_CONFIG`（还没有发请求）；`--dry-run` 固定 mock（若同时给了别的 `--provider` 打一行
warning），`--provider mock` 与 `--glossary-only` 不读配置。新增 9 条测试覆盖缺 provider /
缺 model / 缺 key / `compatible` 缺 baseUrl / mock 与 dry-run 可跑 / 环境变量不能代替
provider / 未知 provider 仍是 `E_PROVIDER`。

### 0.10.0 WP2 适配器与门面

`npm test`：283 → **302 个**，耗时约 7.5s（新增 18 条引擎契约 + 1 条插件版本渲染）。
契约测试覆盖：registry 的 MZ→MV 顺序与完整能力位（MZ `debuggable:true` / MV `false`）、
空目录 `E_NOT_PROJECT`、两个同层项目 `E_MULTI_ROOT` + candidates、跨引擎拒绝、
detect 幂等且零写入（文件快照）、scan 字段（没有旧 `version` 键）、extract 二次
`added:0`、安装/卸载逐字节还原、CRLF 保持、漂移保留备份、项目外路径 `E_IO`、
attach 桩，以及包自引用 `import("yakusha")` 与深路径导入。

实测踩到：`renderPlugin` 原来用 `versioned === template` 判断模板缺 `VERSION`，
而当前 package version 恰好等于模板占位 0.9.0——替换后字符串不变，被误判成「缺常量」，
所有插件渲染测试一起挂；改成先 `test()` 再 `replace()`。另一处：`assertInsideRoot`
必须同时守住 install 与 uninstall，且要在删除插件文件之前执行，否则越界路径会先删后报。

### 0.10.0 WP3 用户级配置

`npm test`：302 → **317 个**，耗时约 7.9s（新增 15 条配置命令测试）。测试覆盖：空目录
`list` 返回默认值且不创建文件；`set` 后 `schema` 首位、2 空格、LF、末尾换行、磁盘无
`apiKey`；`get` 的 `file` / `env` / `default` / `none` 来源；未知键与敏感键在 `set`/`unset`
后保留；非法 provider / model / baseUrl（相对路径、ftp、query、fragment、userinfo）
`E_USAGE` 且文件不变；损坏 JSON 与 `schema:2` 对 `config` 子命令 `E_CONFIG` 且不覆盖、
对 `translate --provider mock` 只 warn；`--dry-run` 连坏配置都不读；非默认 `baseUrl`
在 JSON 模式只进 stderr；相对 `YAKUSHA_CONFIG_DIR`、缺 `APPDATA` 均 `E_CONFIG`；
`config` 缺子命令 / 未知 action / 多余位置参数 `E_USAGE`。

测试隔离是这一包最容易漏的事：三份既有 CLI 测试清掉 `YAKUSHA_*` 后，`config` 会去读
开发机真实的 `%APPDATA%\yakusha\config.json`，`provider-config` 的「缺 provider」断言
会随本机配置时绿时红。现在每个 spawn 都注入一个 `mkdtemp` 出来的空
`YAKUSHA_CONFIG_DIR`，测试不再依赖开发机状态。

### 0.10.0 WP4 JSON 导出

`npm test`：317 → **331 个**，耗时约 8–9s（新增 14 条导出测试；契约测试的“每个命令
payload 扁平”清单也加入了 `export`）。测试覆盖：rich / flat 两种输出可解析且字段一致；
contexts 顺序与重复保留、空 `text` 与 `error` 不导出；entries 键按 UTF-16 排序
（含 `"10"` / `"2"` 与代理对 `𠮷`），同一字典重复导出字节一致；空字典 `entries:0`
且为 `{}`；无 `--force` 时 `E_EXISTS` 且目标字节不变，`--force` 可覆盖；目标是字典
本身即使带 `--force` 也 `E_EXISTS`；目录目标 `E_IO`；父目录自动创建；父路径是普通文件
时 `E_IO` 且无半份文件；缺 `--out`、`--out -`、`--format tsv/csv`、多余位置参数、
未知选项、布尔选项带值全部 `E_USAGE`/2；payload 的 `out/format/flat/entries/bytes` 与
文本模式的单复数行；目标在游戏内但不在 `yakusha/` 下时 warning 只进 stderr；无 `game`
的字典导出空字符串。

序列化是手写的，不是 `JSON.stringify(obj, null, 2)`：JavaScript 会把整数样式的键
（`"2"`）排到 `"10"` 前面，即使插入顺序相反；契约要求所有键按 UTF-16 码元排序，
先排序普通对象再交给 `JSON.stringify` 会在数字键上静默违规。手写只负责顶层与 entries
的键序和缩进，值仍走 `JSON.stringify(value, null, 2)`，转义与缩进保持一致。

### 0.10.0 WP5 启动与 attach 桩

`npm test`：331 → **346 个**，耗时约 7.4s（新增 15 条启动测试）。测试覆盖：裸 exe
名校验；只收项目根直接子普通 `.exe`（目录叫 `folder.exe`、`nested/Deep.exe` 都不算）；
0 个与多个 `E_EXE`、候选排序且最多 20 个；`--exe` 大小写不敏感并返回磁盘真实名；
同步 throw 与异步 `error` 事件都映射 `E_IO`；假 spawn 断言 args 为空、完整 options
与 env 已删密钥；MZ/MV 适配器在非 Windows 报 `E_UNSUPPORTED_PLATFORM`；CLI 的
`E_EXE` / `E_USAGE` 与 `details.candidates` 信封。

发现与启动是纯函数（`listExecutables` / `selectExecutable` / `childEnvironment` /
`launchProject`），测试注入假 `spawn` 和假 platform，**从不真正启动游戏 exe**。
`launch` 只负责把进程拉起来：不等待、不读输出、不 kill；`pid` 只放进 payload。

### 0.10.0 WP6 文档与版本收尾

`npm test`：**346 个，全绿**，耗时约 7.4–8.3s（本包不动逻辑，只改版本号与文档）。
唯一一处代码改动是 `test/plugin-runtime.test.js` 里硬编码的 `"0.9.0"`：
改成从 `src/version.js` 导入 `VERSION` 后断言，否则升到 0.10.0 当天这条就挂。
插件模板 `src/plugin/YAKUSHA_Translator.js` 的 `const VERSION = "0.9.0"` 是占位符，
由 `renderPlugin()` 的正则替换，**不要手改**（`test/version.test.js` 守着三者一致）。

文档这一包的实际改动量：`docs/commands.md` 整篇重写（按 13 条命令的最终行为，
新增「全局约定」与「config」两节）；`docs/architecture.md` 改 5 处旧措辞
（"默认路线可逆 / uninstall 逐字节还原 / 必须可逆 / 可逆列 / 注入的不可逆风险"）
+ §9 排期表按 [ENGINE-STRATEGY.md](ENGINE-STRATEGY.md) §6.3 重排；
`docs/limitations.md` 补 0.10 口径并把"TSV/CSV 在 0.12 计划里"改成"排在 0.13、不在 0.10"；
`README.md` 去掉全局卖点措辞、新增 `--json` 与退出码一节、环境变量补
`YAKUSHA_CONFIG_DIR` / `YAKUSHA_DEBUG`；`docs/config.md` / `docs/export-format.md` /
`docs/design.md` / `docs/platforms.md` 里的旧排期版本号（GUI=0.11、TSV/CSV=0.12）
统一改成"以战略稿 §6.3 为准"的写法，避免同一件事在三篇文档里挂三个版本号。
本包还把 `docs/engine-strategy` 分支合了进来（`docs/dev/ENGINE-STRATEGY.md` 711 行），
否则上面这些 `§5.5` / `§6.3` / `§9.4` 引用在 `main` 上全是死链。

重写完做了一轮**只读对照审计**：拿三份主文档逐条重放命令、比对源码，找出 10 处「文档说的」与「代码做的」不一致，全部按代码改文档（不改行为）。最值得记的一条是
**provider 响应体从来不打印**：`docs/commands.md`、`README.md`、`docs/json-contract.md` 三处都写着
「`YAKUSHA_DEBUG=1` 时把响应体前 300 字符打到 stderr」，而 `grep` 证明 `YAKUSHA_DEBUG` 全仓库只有
`bin/yakusha.js` 的 `reportFailure` 一个使用点（只打 stack），`src/pipeline/provider.js` 连一句
`process.stderr.write` 都没有。处理方式是**删掉承诺而不是补实现**：响应体可能回显
`Authorization`（`provider.js:121-123` 的注释就写着这点），把它打到 stderr 是凭空开一个泄密面；
而且补实现要让 pipeline 反向 import `src/cli/envelope.js` 的 `sanitizeMessage()`，破坏目前
`src/pipeline/` 与 `src/engines/` 对 `src/cli/` 零依赖的方向。顺手把 `provider.js:123` 那句
"shows the body on stderr elsewhere" 的假注释改成如实描述。

其余 9 处都是小口径：`doctor` 其实有 `--max-length`、`verify` 的列表是**按字典键顺序**而非按 kind 分组、
`launch` 的 `details.candidates` 封顶 20、`terms` 也要字典、配置文件顶层 `schema` 认 1 不认其它、
`trad` 命中率是 0.06%–0.23% 而不是 0.02%–0.28%、README 的「400 条 / 19 秒」在仓库里找不到出处
（改成不承诺吞吐，指向本节实测）、禁则处理「上一行排满时提不动」、`contexts` 的数组字段带 `[]`。
两份验收清单（`json-contract.md` §10 七条、`config.md` §9 九条）从 `[ ]` 改 `[x]`，每条都注明
守它的测试文件——清单存在的意义是能被重放，不是走个仪式。

写这一包时确认的两条判断：一是**文档里不要写"整个产品可逆"**——四档交付里只有
plugin 档是"删文件即还原"，inject 档是"文件不改、退出即恢复"，L3-only 什么也不保证；
把三种说成一句就是在承诺做不到的事。二是**路线排期不该写在冻结的接口文档里**——
`architecture.md` 冻结的是信封、错误码、adapter 形状，排期改到战略稿并留一行指针，
否则每次调整路线都要动"契约文档"
### 0.10.x 引擎拆缝（refactor/engine-seams）

目标来自 §8 backlog 第 5 项：把 MZ 假设从 core/pipeline 挪到 adapter 后面，**行为不变、既有测试不改断言仍绿**。全部改动如下：

- 新增 `src/engines/profile.js`：`rmProfile`（id `rpg-maker`）承载四类引擎事实——`prompt.task(lang)` 与 13 个转义码示例、`grammar`（tokenize/controlCodes/plainText/visibleText，转发 `src/core/textkey.js`）、`validate.isUntranslated` 与 `slots` 正则、`verify.kana/han/traditional/slots`。pipeline 一律从 `options.profile` 读，缺省回退到与原实现逐字节相同的常量。
- `src/core/extract.js`：新增 `rmFilePlan`（`dataDir: "data"` + 4 条规则 + DB_FIELDS 兜底），原五路 if/else 分支逐行搬进 `collect` 闭包；`extractProject(projectRoot, plan?)` 改为规则表分派。单参调用签名不变。
- `src/pipeline/wrap.js`：`displayColumns/atomsOf/wrapLine/kinsoku/rebalance/wrapText` 全链增加 `tokenize` 注入参数，缺省仍是模块导入的 RM 分词器。
- `src/pipeline/translate.js`：`systemPrompt` 的引擎句与转义示例、`validateTranslation` 的回显判据/转义码函数/占位符正则、`runBatch` 的 prompt 构造与 4 处 `wrapText` 调用全部读 `options.profile`。
- `src/pipeline/verify.js`：kana/Han/繁体/占位符判据与 textkey 三函数改为 profile 派生（`options.profile?.verify` / `?.grammar`），`problems` 顺序与 kind 名未动。
- `src/core/doctor.js`：`diagnose` 新增 `engineLabel`（engine 检查行）与 `profile`（透传给 verifyDictionary）。
- `src/engines/adapter.js`：`scanProject/extractIntoDictionary` 显式传 `rmFilePlan`；mz/mv 两个 adapter 增加 `profile: rmProfile` 字段——契约测试锁死的 `rules: {controlCodes, maxColumns}` 三键原样保留。
- `bin/yakusha.js`：`cmdVerify/cmdSpeaker/cmdTranslate/cmdDoctor` 从 `requireProject` 拿 adapter 并传 `profile`；doctor 文本首行改用 `adapter.name`（"RPG Maker MZ/MV" 输出不变）。
- 新增 `test/profile-seams.test.js`（8 条）：双 adapter 的 `profile === rmProfile` 且 rules 三键不变；带/不带 profile 的 systemPrompt 字节相等、validateTranslation/verifyDictionary/wrapText/extractProject 结果相等；自定义 profile 冒烟（改 prompt 措辞、关闭 kana 审计、自定义 extract plan）。

结果：**354 pass / 0 fail**（原 346 + 新 8），`node bin/yakusha.js --version` 仍为 `yakusha 0.10.0`，禁用词 0 命中。判断：拆缝的实质是把「引擎专属」从「写在哪个文件」变成「谁有权改这份数据」——现在 pipeline 只认识 profile 接口，0.11 Ren'Py 只需新增一个 profile + plan，不必再动 verify/translate 的主循环。

### 0.11 Ren'Py（feat/0.11-renpy）

当初的目标写在 [ENGINE-STRATEGY.md](ENGINE-STRATEGY.md) §6.3，口径是「0.11 必须先做 Ren'Py」，否则 0.12 的 RGSS 会变成「在 RM 假设上再焊一层」，第二家族的抽象永远没被验证过（那句现在已改成回顾）。所以这一版的验收不是"多支持一个引擎"，而是**上一版拆出来的缝在非 RPG Maker 的引擎上够不够用**。结论是够用：`src/pipeline/` 与 `src/core/` 的主循环一行未改（`doctor.js` 只是长出了注入口，见下），新增代码全在 `src/engines/renpy/` 里。

- 新增 `src/engines/renpy/pickle.js`（1,077 行）：Python pickle 虚拟机，protocol 0–5，纯 JS、同步、无 `eval`。Python 对象一律降级成**带 `__class` 的纯数据**（点分名来自 `GLOBAL` / `STACK_GLOBAL`，只记录不执行），dict 用 `Object.create(null)` 建（否则 `__proto__` 会撞上 `Object.prototype`），超出 `Number.MAX_SAFE_INTEGER` 的整数保留 `BigInt`。Python 2 专有构造不猜，直接报 undecodable——理由写在文件头：树里一个猜错的字段会静默污染下游每一句台词，不如整条拒收。
- 新增 `src/engines/renpy/rpyc.js`（365 行）：`.rpyc` 容器解析 + AST 字符串收集。容器是 10 字节 `RENPY RPC2` + 每 12 字节一组 `uint32 LE (slot, start, length)` 到 `slot === 0` 为止，数据区是 zlib；无头的 v1 格式（整文件一个 zlib 流）也认。**尾部 16 字节 MD5 不校验**：它只是编译期一致性戳，校验它只会让工具拒收玩家本来能跑的游戏。`walkNode` 只跟随 `block` / `items` / `after` 三个结构字段，并用 `Set` 做环守卫。
- 新增 `src/engines/renpy/rpyscript.js`（667 行）：`.rpy` 明文抽取，重新实现 Ren'Py 对字面量的求值（转义、三重引号 monologue、`{b}` 与 `[name]` 原样保留、`\[` → `[[`）。产出四类 kind：`say` / `menu` / `string` / `screen`。
- 新增 `src/engines/renpy/project.js`（266 行）、`extract.js`（229 行）、`profile.js`（207 行）、`runtime.js`（446 行）、`adapter.js`（320 行）：分别是项目定位（`game/`、向下 3 层、`SKIP_DIRS` 含 `tl`）、两种源合成一份单元表、Ren'Py 的 prompt / grammar / validate / verify、translation 档投递、能力位与 CLI 入口。
- `src/engines/registry.js`：`ADAPTERS` 变三个，并把「不是本项目」的判定抽成 `NOT_PROJECT_PREFIXES`（`"not an RPG Maker project"` / `"not a Ren'Py project"`）。两种前缀都算「继续试下一个引擎」；`E_MULTI_ROOT` 与其它诊断型失败立即返回，不会被后面的引擎吞掉。
- `src/core/doctor.js`：`diagnose(project, options)` 新增四个注入口 `extract` / `dataFiles` / `sourceLabel` / `delivery`，外加从 adapter 取的 `diagnostics()`。MZ/MV 不传时走默认值，行为与 0.10 一致；Ren'Py 传进来的是 `sourceLabel: "game/"` 与一份 `delivery`（单文件投递，只有 1 个文件可查，没有备份可比对）。`pluginsFile` 为 null 的引擎跳过 plugins.js 检查而不是判失败。
- `bin/yakusha.js`：`scan` 与 `doctor` 的表头按 `adapter.dataUnit` 在 `data files` 与 `scripts` 之间选词，`install` / `uninstall` 在 `capabilities.runtime === "translation"` 时多打一行 `translation: …`。
- 新增 5 个测试文件：`test/renpy-adapter.test.js`（14）、`renpy-extract`（14）、`renpy-rpyc`（19）、`renpy-rpyscript`（24）、`renpy-runtime`（33）；`engine-contract` 改成对三个引擎统一断言 + 按引擎分表断言文案，`profile-seams` 加一条「Ren'Py 用自己的 profile」（8 → 9）。

**四项抽取精度修复**：都是拿 SDK 8.5.3 自带的两个示例游戏（`the_question`、`tutorial`，都带完整 `.rpy` 源码）跑真数据时暴露的，改动前每项都先复现出错现象：

1. **同 stem 只读 `.rpy`**：`the_question` 只读 `.rpy` 是 229 条出现 / 202 条唯一，只读 `.rpyc` 是 74 条；两边都读就变成 303 条出现，而唯一串仍是 202——**出现次数虚增 32%，唯一串不变**。更糟的是 kind 分布变了：`.rpy` 侧 `{string:130, screen:24, say:70, menu:5}`，`.rpyc` 侧只剩 `{say:69, menu:5}`，屏幕语言与 `_` 包装的字符串在编译形态的 AST 上取不到。所以规则是「有 `.rpy` 就跳过同名 `.rpyc`」，编译文件只当开发版缺失时的退路。
2. **跳过 `game/tl/`**：那是游戏**已有的**译文目录（`the_question` 47 个 `.rpy` 脚本，分在 12 个语言目录；`tutorial` 212 个，分在 10 个——两边另有一个非语言的 `tl/None/`，只放 `common.rpym`）。不跳过的后果不是计数错，而是**把别人翻好的中文当源文本再翻一遍**——语义错误，比数字错更难发现。实测这些脚本经 `collectScriptStrings` 取到 **0 条**字符串（47 + 212 个文件全为 0）——它们整个文件都在 `translate <lang> strings:` / `translate <lang> <label>:` 块里，抽取器在 `translate` 栈内不收集任何文本，所以跳过它们也不损失任何源文本。
3. **跳过自己写的 `game/yakusha_translation.rpy`**：`walkScripts` 会列出它（装完后 11 个条目里就有它）。去掉这条跳过规则，`scripts` 会从 `{rpy:5, rpyc:0}` 变成 `{rpy:6, rpyc:0}`——**install 前后计数漂移**，同一个游戏装一次就"多一个脚本"。文本数不受影响（生成的文件是 `translate … strings:` 形态，抽到 0 条），但计数漂移会让 `scan` / `doctor` 的输出失去可比性。往返实测：install → `{path, language:"schinese", entries:3}`、uninstall → `{removed:true}`，前后 `totalStrings` 229 → 229 → 229、`scripts` 不变。
4. **字面量说话人只取台词**：Ren'Py 允许把角色名写成字符串字面量放在台词前面（一个语句里两个串，第一个是说话人、第二个才是玩家读到的台词）。按字符串字面量顺序收会把角色名也收成一条可译文本，译出来角色名就跟着变了。规则改成只取第二个串，与编译形态（`Say.who` 是 `PyExpr`、`Say.what` 是台词的字符串常量）保持一致。

**.rpyc 覆盖率实测**（一套 Ren'Py 8.5.3 SDK 里的全部 585 个 `.rpyc`）：585 个全部解码成功、**0 失败**，共 **81,041 条字符串**（`string` 71,407 / `say` 9,588 / `menu` 46）、**70,728 个 AST 节点**；读出的脚本格式版本**一律 5003000**（585/585）。对照 `.rpy` 源码：SDK 里 `.rpy` 587 个、`.rpyc` 585 个，**581 个 stem 两种形态并存**（4 个 `.rpyc` 没有同名 `.rpy`），其中 **517 个**的 `.rpyc` 覆盖该 `.rpy` 的全部字符串，**64 个有缺失共 1,562 条**（按出现次数；去重后是 1,387 条唯一串）。缺失不是解码失败——原句在 slot 1 的 zlib 解压结果里明确存在——而是**走不到**：一类是屏幕语言（`screen` 语句编译成 `renpy.sl2.slast` 树 + `renpy.astsupport.PyExpr`，解码后只剩 `{__class, value, args}`，表达式文本 `_("History")` 作为字节留着但没有 AST 路径能取），另一类是 `example:` 演示块里的台词，挂在 `renpy.ast.UserStatement.code_block` 下，而 `walkNode` 只跟 `block` / `items` / `after`。这两类都记在 [limitations.md](../limitations.md) 里；它们不影响"有 `.rpy` 源码时以源码为准"的路径，只影响**只有编译文件**的游戏。

结果：**459 pass / 0 fail**（原 354 + 新 105：五个 renpy 测试文件 14+14+19+24+33 = 104，`profile-seams` 8 → 9 一条；`engine-contract` 是原地改写、条数不变），`node bin/yakusha.js --version` 为 `yakusha 0.11.0`，`npm test` 约 9–10s，禁用词 0 命中。判断：拆缝这一版押的注押对了——`profile` 接口原样能吃下第二家族，唯一需要新长出来的东西是 `doctor` 的注入口与 `bin` 的两处措辞分支；真正花时间的是引擎侧的**数据格式**（pickle 栈机 + 容器格式），不是架构。

**0.11 明确没做的事**（都是有意的取舍）：

- **语言只能投 `schinese`**：Ren'Py 的语言名必须是 Python 标识符，CLI 没有 `--language`，`installRuntime` 不传就恒取 `DEFAULT_LANGUAGE`。库调用方可以传别的（要过 `/^[A-Za-z_][A-Za-z0-9_]*$/` 且不是 `None` / `True` / `False`），CLI 不给这个口子。
- **不改原脚本，也不改 `options.rpy`**：投递只有一个新文件 `game/yakusha_translation.rpy`，里面是 `init python:`（仅在 `config.default_language is None` 时设语言，玩家在设置里选的必须赢）+ 一个 `translate <lang> strings:` 块。卸载只删这一个文件。同一个语言里出现重复的 `old` 是引擎启动期的硬报错（不是警告），所以写文件前按源文本去重并稳定排序——这条是踩出来的，不是预防性设计。
- **通用内容导入 v1 顺延**：战略稿 §6.3 把它排在 0.11 的"附带"列，这一版没有交付——源码里没有导入入口，命令表也没变。0.11 只做了 Ren'Py 本身。
- **`attach` 仍是桩**，而且 `notImplemented()` 里那句 `"is not implemented in 0.10"` **故意没改**：字符串写在 `src/engines/adapter.js:157`，被 `test/engine-contract.test.js:409` 与 `test/renpy-adapter.test.js:326` 各断言一次，`docs/engines.md` §9 还专门写了一段"这是历史措辞，不要改"。三个引擎共用同一个桩，所以要改就三处一起改，留到真正实现 attach 的那次，不单独为改一句文案开一次 PR。

### 0.12 RGSS（feat/0.12-rgss）

0.11 验证了「非 RPG Maker 的第二家族」能不能塞进同一套 seam，0.12 换了个更难的问题：**非 JSON、二进制、还带归档的第三家族**。RGSS（XP / VX / VX Ace）的文本不在任何 JSON 里，而在 Ruby Marshal 流中；正式发行的游戏还把这些流打进一个 `.rgss3a` 归档。所以这一版要证明的是：adapter / profile 这两个缝在「数据格式完全陌生 + 数据源有两种形态」时依然够用，而不是要看它能不能再包一个引擎。

- 新增 `src/engines/rgss/marshal.js`（709 行）：Ruby Marshal 4.8 的**读写器**，纯 JS、同步、无 `eval`。值模型是一套平铺的纯数据记录（见文件头注释），类只记名字、`T_DATA` 只留字节、字符串留原始字节不解码（`Scripts.rvdata2` 里的脚本正文是 deflate 流，必须逐字节回写）、超大整数用 `BigInt`。写回能力是**为了将来的交付层准备**，本版没有用它投递任何译文（§6 末尾）。
- 新增 `src/engines/rgss/archive.js`（565 行）：`.rgssad` / `.rgss2a` / `.rgss3a` 三种格式共用一个 `openArchive()`。v1/v2 用固定种子 `0xDEADCAFE`、每读一个字段前 `key = key * 7 + 3`；v3 的种子在文件头第 8 字节，目录键只算一次、每个文件有独立 `fileKey`、每 4 字节滚动。名字里的 `\\` 统一成 `/`。目录只读头部窗口（上限 64 MiB，见 §5），单个文件按需解，不整包读入。
- 新增 `src/engines/rgss/project.js`（429 行）：项目判定看三件事——根有 `Game.ini`（大小写不敏感）、或有三种归档之一、或 `Data/` 下有三种数据后缀之一；向上 3 层、向下 3 层 BFS，多根取最浅那层、多个报 `E_MULTI_ROOT`。版本判定有确定的优先级（归档扩展名 → `Game.ini` 的 `Library=` → `Scripts=` 扩展名 → `Data/` 文件扩展名 → `null`）。`Game.ini` 按 UTF-8（fatal）→ Shift_JIS（含假名才采信）→ GBK → Latin-1 的顺序试解码。
- 新增 `src/engines/rgss/extract.js`（421 行）：事件指令按码表取槽位（`COMMAND_TEXT`，见 §5），数据库文档按 base name 匹配字段表（`RGSS_DB_FIELDS`：Actors 的 name/description/nickname、Skills 的 message1/message2 等），`System.rvdata2` 只取 `@game_title` / `@currency_unit` 与 `@terms` 四张表，`MapInfos` 只取 `@name`，`Troops` 与 `Map*` 只走指令。文档按名字排序后再抽，所以磁盘版与打包版逐条一致。返回形状与 MZ/MV 的 `extractProject` 相同，另多一个 `documents`（真正读过的数据文档数，给 `scan` / `doctor` 的 `dataFiles` 用）。
- 新增 `src/engines/rgss/profile.js`（97 行）：RGSS 的 prompt / grammar / validate / verify。grammar 直接复用 `src/core/textkey.js` 的通用分词器（RGSS 的转义码是 `\i[n]` 这种反斜杠写法，与 MZ/MV 的 `\\` 家族同构，见下），`validate` / `verify` 复用 `rmProfile` 的 `isUntranslated` / `VERIFY_KANA` / `TRADITIONAL`——这三样在 0.12 只是从 `src/engines/profile.js` 改成具名导出，行为一个字节没动。
- 新增 `src/engines/rgss/adapter.js`（321 行）：能力位 `{extract:true, export:true, runtime:null, launch:true, debuggable:false, attach:false, liveReload:false}`、11 键的 `scanRgss`、`diagnostics()`，以及两条 pending 入口 `install` / `uninstall`。`rules: {controlCodes:true, maxColumns:0}`——RGSS 的窗口会自己折行，不需要 MZ/MV 那套按宽度插图。
- `src/engines/registry.js`：`ADAPTERS` 变四个，`NOT_PROJECT_PREFIXES` 加 `"not an RGSS project"`。三条前缀都算「继续试下一个引擎」，诊断型失败仍立即返回。
- `src/core/doctor.js`：新增 `delivery.pending` 分支。为什么必须有这一支——RGSS 的 `pluginsFile` 是 `null`，走原来的 RM 分支会 `TypeError`；而报「未安装」又是在说谎，会让用户去跑一个注定拒绝执行的命令。所以 `install` 检查报 **warn** 并原样打印引擎给的解释，`runtime` 检查报 **info**，`install` 载荷五个子键全部 `false` / `null`，`verdict` 仍是 `usable`。
- `bin/yakusha.js`：`cmdDoctor` 的 `delivery` 改成 `own.delivery || own.translation || null`——RGSS 走的是 `delivery`，Ren'Py 走 `translation`，MZ/MV 两个都是 `undefined` 落回 `null`。
- 新增 7 个测试文件：`test/rgss-marshal.test.js`（19）、`rgss-archive`（13）、`rgss-project`（16）、`rgss-extract`（11）、`rgss-adapter`（17）、`rgss-cli`（13），外加 `test/rgss-fixture.js`（269 行夹具工厂）。夹具里的每一个字节都是 `marshal.js` 的 writer + `archive.js` 的 writer 现场生成的，仓库里**没有一个二进制夹具**，也没有任何一行来自发行游戏。`engine-contract` 的 `ALL_ENGINES` 变四个元素并加 `RUNTIME_TIERS` 表，`renpy-adapter` 的顺序断言从三元素改四元素。

**四项「为什么只能这么写」的取舍**（实现时都先在真实样本上复现过错的那一版）：

1. **必须读整份数据文档才能取全文本，不能只扫指令**：数据库里真有人读的文本（角色名、道具说明、技能描述）与事件指令里的台词在同一个 Marshal 流里，只扫 `COMMAND_TEXT` 会漏掉整个数据库面；只扫数据库字段又会漏掉 98% 的对话。所以 `extract.js` 两条路都走，且都由同一份 `RGSS_DB_FIELDS` / `COMMAND_TEXT` 表驱动，加字段不用改代码。
2. **文档按名字排序后再抽**：归档里的条目顺序是打包时的顺序，磁盘版的 `readdir` 顺序取决于文件系统。不排序的话「同一款游戏，打包版和拆包版」的 `perFile` 行顺序与 `undecodable` 行顺序会不一致，doctor 的输出就没法在两次运行之间比较。排序后实测两种形态逐条一致。
3. **失败不中断**：单个文档解不出来（版本不对、流被截断、字段结构意外）时记一条 `undecodable` 继续下一个，而不是整包失败。理由与 MZ/MV 一致：玩家装的是游戏，不是一份完全干净的输入。`undecodable` 在 `scan` 里是字符串数组（`"<file>: <error>"`），因为要进表格列，所以 `errorLine()` 只留错误信息的第一行。
4. **`Game.ini` 的编码要试四种**：XP 时代的日文游戏几乎都是 Shift_JIS，中文民间汉化常改存成 GBK，而新版工具会写 UTF-8。只认 UTF-8 会让一票老游戏的 `gameTitle` 变成乱码。顺序是 UTF-8（fatal）→ Shift_JIS（解出的串里含假名才采信，否则多半是误解）→ GBK → Latin-1 兜底。

**真实样本实测**（一款 RGSS3 / VX Ace 商业游戏的正式发行版，外部样本，不是仓库夹具）：归档 `Game.rgss3a` **644,284,359 字节**，5,138 个条目（`Data/` 399 条 = 398 个 `.rvdata2` + 1 个非数据 zip；`Graphics/` 4,739 条）。398 个 `.rvdata2` **全部解析成功、`consumed === total`**，且 398/398 个文档 `unmarshal` → `marshal` → `unmarshal` 值深相等。抽取结果：**394 个文档、31,730 条唯一串、49,732 次出现、0 undecodable、282 个文件有文本、约 380 ms**。地图侧 381 张、其中 364 张有事件、共 5,300 个事件。转义码共 **2,063 条、23 种**（`\i[n]` 2,252、`\c[n]` 557、`\v[n]` 517、`\!` 313、`\>` 272、`\A[n]` 204、`\W[n]` 179、`\n[n]` 89、`\V[n]` 76、`\T[n]` 73、`\t[n]` 72、`\C[n]` 51、`\a[n]` 46、`\N[n]` 43、`\s[n]` 33、`\w[n]` 30、`\S[n]` 10、`\{` 7、`\I[n]` 6、`\}` 5、`\.` 4、`\F[n]` 2、`\^` 1），**全部 23 种都被 `src/core/textkey.js` 的通用分词器覆盖**，`profile.js` 没有为 RGSS 新写一套 tokenizer。

结果：**548 pass / 0 fail**（原 459 + 新 89：六个 rgss 测试文件 19+13+16+11+17+13 = 89；`engine-contract` 与 `renpy-adapter` 是原地改写、条数不变），`node bin/yakusha.js --version` 为 `yakusha 0.12.0`，`npm test` 约 11s，禁用词 0 命中。一句话总结：0.12 是**把一个非 JSON、二进制、还带归档的引擎接进同一套抽象**的一版。判断：**0.11 拆出的 adapter / profile 缝在第三家族上依然够用**——`src/pipeline/` 与 `src/core/` 的主循环没为 RGSS 加过一行特判，全部必要改动是：`doctor` 的 pending-delivery 分支（`runtime: null` 是第一次出现）、`src/engines/profile.js` 的三处具名导出（`TRADITIONAL` / `VERIFY_KANA` / `isUntranslated`，行为不变）、`bin` 的 `delivery` 取值；真正花时间的还是数据格式（Marshal 读写 + 三种归档），和 0.11 的 pickle 是同一类活。

**0.12 明确没做的事**（都是有意的取舍）：

- **没有交付层，一个字都不写回游戏**：`capabilities.runtime` 是 `null`，`install` / `uninstall` 抛 `E_NOT_IMPLEMENTED`（退出码 2），测试用目录快照对比证明「前后一个字节都没变」。`marshal.js` 与 `archive.js` 的 writer 是给将来那两条路线用的（§8.1），本版只读不写。所以**不要把这个版本说成「RGSS 已支持运行时翻译」——它只到 L1–L3**（detect / scan / extract + 既有 pipeline 的 translate / verify / export）。
- **没有原生 helper，本机也没有能编它的工具链**：两条候选路线里，原生注入器需要 C/C++/Rust 编译器与 `ruby`，这台机器上都没有（实测 `cl` / `gcc` / `rustc` / `ruby` 一个都不在 `PATH` 里）。这不是排期问题，是 0.12 的交付层验收在当前机器上**没法做**，已记进 §8.1。
- **官方 RGSS 的归档优先顺序未验证**：同一款游戏同时有 `.rgss3a` 和 `Data/` 时，官方引擎先读哪一个没有实测过。`openDataSource()`（`src/engines/rgss/project.js:392-429`）当前的选择是**归档优先**，这是实现的选择、不是对官方行为的断言。mkxp 这类兼容层是归档优先，但 mkxp 不是官方 RGSS。
- **没有真机验证「写回后游戏能跑」**：writer 只做了 round-trip 相等（398/398），从没把改过的数据文档塞回游戏启动过。这条与「没有交付层」是同一件事的两面，等 §8.1 定下路线才能验。

### 0.13 Kirikiri + 表格导出/导入（feat/0.13-table-export）

0.13 做两件事：**把 Kirikiri（KAG / XP3）接成第五个引擎**，以及**给字典加表格载体**（TSV / CSV 导出 + `import` 命令）。动机与 0.12 相同——验证 0.10.x 拆出的缝能不能容纳第四个运行时家族；这次连 `src/pipeline/` 与 `src/core/` 都没加一行特判，新代码全部在 `src/engines/krkr/`（6 个模块，共 1,128 行：`xp3` 236 / `ks` 139 / `project` 145 / `extract` 126 / `profile` 155 / `adapter` 307）与 `src/cli/table.js`（277 行）里。

**Kirikiri 数据格式**：XP3 归档头 40 字节（magic `XP3\r\n \n\x1a`、版本标记 `0x0117678b`、两个标志位、索引容器偏移），索引容器头有两种布局：合成夹具写 9 字节（1 字节压缩模式 + 8 字节压缩后大小），真实商业归档实测是 17 字节（中间多一个 8 字节未压缩大小字段），读取器按 zlib 头特征自动判位（0.16 修正，见 §6 的 0.16 段）；解压后索引以 4 字节 magic 开头——`File` 是标准索引，`Hxv4` 是某些本地化发行版用的改版索引，**明确报 `E_UNSUPPORTED` 不猜**。条目是 `File` 块套 `info`（文件名 UTF-16LE、原始/压缩大小、protect 位）、`segm`（无前导计数的 N 段描述，`mode` 0=raw 1=zlib，start 是绝对偏移）、`adlr`（adler-32，重组时校验）三类子块的列表。adler-32 是手写的（Node 只在 zlib 流内部暴露它）；开发期用两款真实商业归档（含一款语音归档，数百个条目）把**每个条目的 adler-32 与大小全部验证通过**，但仓库与文档不引游戏名、不放数字。

**KAG 脚本层**：文本行 = 非注释（`;` / `/*`）非标签行；`[r]` 是行内换行标签、从存储串剥离；`[name_set name='...']` 跟踪当前说话人，成为该行单元的 speaker；行尾 `[p2]` 标记消息结束。编码 UTF-8 strict 先行、失败落 Shift_JIS 兜底，兜底还解不了的计 `undecodable`；同一文件里解不开的字节不吞掉已解码的行——**undecodable 是按文件记的补充信息，不是丢弃整个文件**。补丁目录的同名 `.xp3` 不遮蔽基础归档：两个都读（`openKrkrProject` 列出全部归档，`extract` 逐个都抽），与 Ren'Py 跳过 `tl/` 相反——那边的优先级是「原文优先」，这边的现实是「补丁条目与基础条目并存、都要看」。

**表格导出/导入**：`export --format tsv|csv` 与 `export --format json` 走同一条 `--out` 文件通道（不写 stdout）；TSV / CSV 以 UTF-8 BOM 开头、CRLF 行尾、表头 `source` / `target` / `contexts`，quoting 判据见 §5。`import --from <file>` 读回：`--strategy only-empty`（默认，只填空译文）或 `overwrite`；空 target 行跳过、同值跳过不算 applied、字典自身 contexts 赢于行 contexts、`--dry-run` 全算不写；载荷是 8 键的 flat 信封（`file` / `format` / `strategy` / `dryRun` / `read` / `applied` / `skipped` / `entries`）。**export → import → 再 export 字节相同**有测试钉住（含含制表符、引号、换行的单元格）。

**探测与接线**：`registry.js` 的 `ADAPTERS` 变五元素，`NOT_PROJECT_PREFIXES` 加第四条；判据是根目录或 `data/` 下有 `.xp3`（向下 BFS 3 层，多根 `E_MULTI_ROOT` 列出候选）。doctor 走 0.12 引入的 `delivery.pending` 分支：`install` 检查 warn（"no delivery layer yet"）、`runtime` 检查 info、有字典 `usable` / 无字典 `broken`。scan 载荷仍是 11 键契约，`dataFiles` 计打开的归档数、`encodings` 只有一个 `xp3` 键。

测试：新增 `krkr-{xp3,ks,project,extract,adapter,cli}` 5+6+6+5+11+13 = 46 条，`export.test.js` 的 TSV/CSV 用例重写（14 → 23 条，旧 E_USAGE 断言替换为新的表格断言），全套 **603 pass / 0 fail**（对账：548 − 14 + 23 + 46 = 603）。结果行：`node bin/yakusha.js --version` 为 `yakusha 0.13.0`，`npm test` 约 10–12s，禁用词 0 命中。一句话总结：**0.10.x 的缝在第四个家族上第三次得到验证**——这次连 pipeline 都没碰，真正花时间的仍是数据格式（XP3 索引 + KAG 行语义），外加一个与引擎无关的通用能力（表格载体）。

**0.13 明确没做的事**（都是有意的取舍）：

- **Kirikiri 没有交付层**：与 RGSS 同一条欠账（§8.1 #10），`install` / `uninstall` 抛 `E_NOT_IMPLEMENTED`（退出码 2）且不写文件；`capabilities.runtime` 为 `null`，doctor 如实报 warn。**不要把这个版本说成「Kirikiri 已支持运行时翻译」——它只到 L1–L3**。
- **Hxv4 只报错不解析**：改版索引明确 `E_UNSUPPORTED`（"the XP3 index uses an unsupported format - yakusha only reads standard XP3 indexes"）；等遇到真需求再决定是加解析还是提示转换。
- **字典 v2 字段没加**：`engine` / `locator` 两个待定字段留在 §8.1 #5；0.13 的表格载体不改字典结构，export / import 的键与 0.10 JSON 完全同构。
- **没有 en→zh，也没有捆绑词典**：§8.1 #6 的决策不变。

### 0.16 Kirikiri 真机修正（feat/0.16-gui-capabilities 分支内）

0.16 做能力灰显时顺手复核了 Kirikiri 的真机行为，发现 0.13 交付的 XP3 读取器
**读不了任何真实商业归档**——本机 30 个 XP3 全部报 "the XP3 index stream does not
decompress (incorrect header check)"，只有合成夹具能过。两个根因：

- **索引容器头**：0.13 的笔记把索引容器头定成 9 字节（模式 + 压缩大小），代码照写；
  真实归档实测是 17 字节——压缩大小后面还有一个 8 字节未压缩大小字段，zlib 流从
  偏移 17 开始。9 字节读法把流头 2 字节吃掉，inflate 必然失败。
- **索引条目起点**：解析器在 4 字节 "File" 索引 magic 之后从偏移 4 找条目，而真实
  归档的第一个条目的 "File" 标签就落在 magic 的位置上（magic 与首条目标签共用 4
  字节），条目大小在偏移 4；合成夹具则真的写了两个连续 magic。读取器现在按
  偏移 4 处是不是 "File" 自动判别两种形状。

修正后的真机矩阵（scan --json，全部本机游戏）：

- Summer Days（data + patch 两档案）：**352 + 3803 个条目 adler-32 全过**，提取
  5,686 unique / 6,409 total，0 undecodable。
- 和芽衣（data + voice）：**1033 + 1345 个条目 adler-32 全过**，提取 19,913 /
  42,284，0 undecodable。
- 0.13 曾记录这两个游戏 adler 100% 通过——当时的验证脚本用的是 17 字节头，与
  交付的读取器不一致。教训：**验证脚本和交付代码必须共用同一条解析路径**。
- 其余四款（Sickly Days、无法忍耐、痴情哥哥、妖夢員）的归档是改版索引或改写过
  的容器头（Hxv4 / 版本标记与索引偏移被整体变换），维持既定行为：逐档案报干净的
  `E_UNSUPPORTED` 语义错误，不硬啃。

顺手修的第三件事：本地化组的 `.ks` 场景文件有相当一部分带 UTF-16LE BOM，
`decodeKs` 原来只认 UTF-8 / Shift_JIS，把这些文件全记成 undecodable；现在按 BOM
识别 utf-16le / utf-16be。新增 2 个负面测试（变换头 → `E_UNSUPPORTED` 而不是裸
RangeError），全量 657 绿。

### 0.17 字典溯源字段实测（feat/0.17-dictionary-provenance）

- mini-mz 夹具 `extract` 后：`レベル` 的条目是 `{"text":"","contexts":["System.json:terms.basic[]"],"engine":"mz","locator":["System.json#/terms/basic/0"]}`；`お金が足りない！` 的 locator 是 `CommonEvents.json#/1/list/1/parameters/0`。
- 参数列表（`"0[]"` 形状）曾经少一层路径（只到 `parameters` 就停），已修成 `parameters/<i>/<slot>`；选项标签的 locator 现在是 `.../parameters/0/0`。
- `pnpm pack --dry-run`：0.17 tarball 64 个文件（`bin/` 1 个 + `src/` 52 个 + `gui/` 8 个 + 根三件）。

### 0.18 RGSS 原生注入器交付（0.18.0，工作树）

- 0.18 交付 RGSS 的 L4 交付层，也是目前唯一 `capabilities.runtime: "inject"` 的引擎：`install --native` 把四个预编译组件复制到 `<game>/yakusha/native/`，`launch` 改为拉起 `yakusha_injector.exe`，`uninstall` 递归删这个目录；MZ/MV 仍是 `plugin`、Ren'Py 仍是 `translation`、Kirikiri 仍是 `null`（`test/engine-contract.test.js` 的 runtime tier 矩阵冻结为 `plugin, plugin, translation, inject, null`）。
- 安装布局（`install --native` 成功后目录恰好 6 个文件）：`yakusha_rgss_hook.dll`、`libunwind.dll`、`yakusha_injector.exe`、`bootstrap.rb`、`dictionary.txt`、`manifest.json`。`manifest.json` 是 `{"schema":1,"files":{"<name>":"<sha256 hex>"}}`，只列四个组件——`dictionary.txt` 是每游戏生成、不进 manifest；`dictionary.txt` 每行 `base64(source)\tbase64(target)`，按 source 排序、空译文跳过。没有字典时 `install --native` 报 `E_NO_DICTIONARY`，先跑一次 `extract`。
- 机制（installer → hook → bootstrap 三段，全程不改游戏文件）：`yakusha_injector.exe` 用 `CreateProcessW` + `CREATE_SUSPENDED` 启动游戏，把 hook DLL 路径写进目标进程，`CreateRemoteThread(LoadLibraryW)` 加载后 resume；`yakusha_rgss_hook.dll` 只补 IAT 的 `kernel32!GetProcAddress` 槽，借游戏自己解析 `RGSSEval` / `RGSSGameMain` 的时机拿到两个入口，给 `RGSSGameMain` 返回 wrapper；wrapper 先用真 `RGSSEval` 跑 `bootstrap.rb`（这时 Ruby VM 已初始化），再调真 `RGSSGameMain`。`bootstrap.rb` 把字典读成 Ruby Hash，包 `Kernel#load_data`：对返回对象递归（String / Array / Hash / 实例变量，深度 64）替换完全匹配的字符串——Map events、CommonEvents、数据库 terms 等可达字符串都能翻；另有 `Vocab` 零参方法兜底。日志写 `<game>/yakusha/native/rgss-hook.log`，记 patched slot、resolved exports、字典大小和每次 `load_data` 的名字与替换数。
- CLI 行为：`install --native --dry-run` 只做验证与打印（`native    : <abs>` / `components: 4 files` / `dictionary: <n> strings` / `dry run   : nothing written` / `uninstall : yakusha uninstall "<abs>"`），一个字节不写；`install --native --json` 的 `pluginPath` 指向 `<game>/yakusha/native`，`backupPath` / `createdBackup` / `staleBackup` 恒为 `null` / `false` / `false`，`state` 首次 `added`、重装 `unchanged`，并多一个 `native: {dir, files, dictionaryEntries, dryRun}`。`uninstall` 输出 `native components removed` / `the native components are not installed`，payload 是五键 + `native: {dir, removed}`。
- `doctor`：`delivery` 从 pending 桩改为 `{path, exists, mode:"inject", language:null, entries}`；装前 `install info  not installed - run: yakusha install --native "<game>"`、verdict `not installed yet`，装后 `install ok` / `runtime ok  yakusha/native (<n> strings)`、无 warning 时 verdict `ready`。`scan --json` 的 RGSS `capabilities.runtime` 为 `"inject"`（其余能力位不变）。
- 实测验收（本机一款 RGSS3 / VX Ace 商业游戏，RGSS300.dll，32 位进程）：`install --native` 后目录是上述 6 个文件，`launch` 走注入器拉起游戏，`uninstall` 后目录整体消失；游戏自己的文件没有任何改写。XP / VX（RGSS1 / RGSS2）未测，RGSS301 只是同族已知。
- 仓库测试：`rgss-native-fixture.js` 用真 SHA-256 伪造四组件；`rgss-adapter` 17→21 条、`rgss-cli` 13→16 条、`gui-e2e` 的 RGSS 走查从 `E_NOT_IMPLEMENTED` 改为 `runtime: "inject"` → plain install 报 `E_USAGE` → `install --native` 成功 → doctor 可用的完整链路。全套 **677 pass / 0 fail / 0 skipped**（50 个测试文件，约 12s）；`node bin/yakusha.js --version` 为 `yakusha 0.18.0`。

## 7. 已知限制

1. 只处理 `data/` 里的文本；插件 `js/plugins/*.js` 里硬编码的 UI 文案不动。
2. 图片里的文字不处理。
3. MV 的 `.rpgmvp` 加密图不影响文本，但 MV 若用了别的数据混淆方案可能解不出（会报 `undecodable`）。
4. **MZ/MV 不会横向自动换行**：`Window_Base.flushTextState` 把整行一次性 `drawText`，
   超宽即裁，只有纵向 `needsNewPage` 分页。默认靠 prompt 约束，硬保证加 `--max-length`。
5. 老 MV（2019/2020 的 nw.js）不吃 `--remote-debugging-port`，MV 的运行时取证不能靠 CDP。
6. 有些 MV 游戏把说话人写成 `\N<名字>`（插件自定义标记，非 RPG Maker 转义码），译文必须原样保留。
7. 不支持 Unity / Godot 等其它引擎。**XP / VX / VX Ace（RGSS）从 0.12 起支持，0.18 起有
   inject 交付层**：`install --native` 只写 `<game>/yakusha/native/`，不改游戏文件；不带
   `--native` 报 `E_USAGE` 并给出完整命令。**Kirikiri（KAG / XP3）从 0.13 起支持，但仍只到
   L1–L3**（识别 / 盘点 / 提取 / 翻译 / 校验 / 导出）：`capabilities.runtime` 是 `null`，
   `install` / `uninstall` 报 `E_NOT_IMPLEMENTED`（退出码 2）且一个字节都不写，装完游戏
   仍然显示原文（§6 末尾、§8.1）。Ren'Py 从 0.11 起支持，但只到 `game/` 里的脚本文本
   （`.rpy` / `.rpyc`）：屏幕语言的 UI 文案、`example:` 演示块里的台词，以及只有编译文件时
   屏幕语言那一部分取不到（§6），`.rpyc` 里结构上不可达的字符串不计入。
8. `verify` 只看字典里的结构性问题（回显 / 转义码 / 占位符 / 换行 / 宽度 / 假名残留 /
   繁体字混入 / 说话人名漏译），看不出风格、语义是否贴切；那部分仍需人工抽读。
9. `verify` 的 width 档只在显式传 `--max-length` 时才有意义——不传就不知道窗口宽度该是多少。
   实测 4 款跑完全量翻译的游戏**没有一行超宽**（第 6 节），所以这条**故意不自动推断**：
   MV 的 `System.json` 没有 `advanced` 字段，自动推断会得到 `NaN`；而 MZ 上按
   `screenWidth` 推出的预算会把本来放得下的行也折掉（MZ-C会折 1,700 行）。
10. `terms` 只挖「名字字段里有的东西」。纯 UI 词（攻击/防御/回合）、技能描述里的
    术语、正文里的地名，只要没进过数据库 name 字段就不会被挖出来。这是有意的：
    没有名字字段当锚点，任意中文串的统计没有可判定的正确答案。
11. `terms` 的判定是「正文主流译法」，不是「正确译法」。实测报出的 7 条里，有几条属于
    **语义变化**而不是算法碎片（同一原文在不同上下文被译成两种都讲得通的近义词，
    主流占比 55%–100%）。这类条目要不要采纳得人看，
    所以 `terms --write` 只是**建议**，真正落盘需要人再跑一次 `--glossary-only --overwrite`。
12. `translate` 按**请求内字面出现**过滤术语表（实测每请求只剩 3–4 条、693 字降到 47 字），
    所以词表变大几乎不增加单请求开销。代价是**上下文相关的术语**（只在某个场景出现的词）
    不会出现在别的场景的请求里——词表表达的是"这个词固定这么翻"，这通常是想表达的语义。
    词表上万条时过滤本身会变慢，届时再考虑加 cap。
13. `terms` 的 `--drift-only` + `--overwrite` 会**重写已有译文**。这是唯一一处
    工具会主动改动已经翻好的内容，务必先看一眼 `--dry-run` 的输出。
14. `verify` 的 `trad` 只做**单字符**层面的判断，不判断词组用法（`干`/`乾` 这类两语
    都合法的多目标字已在字表里排除）。它抓的是"模型偶发切到繁体"的那几十行，
    不是繁简风格的统一性；如果哪天要保证全篇都是简体，得另做一套字频/词表判定。
15. `verify` 的 `speaker` 只认 `\N<名字>` 这一种形态（MV 某姓名窗插件的写法），且要求该游戏**至少把这个名字翻过一次**才会报「留日文」。
    全程刻意保留日文名的作品不会被报——这是有意的取舍，否则每个日式名字都会刷警告。
    名字放在别处（独立窗口参数、JSON 配置、插件参数里的 UI 词典）的插件，整套工具都看不到。
16. `speaker` 的房规**来自这份字典自己的统计**，它只会把写法统一到本作已经在用的那一种，
    不判断哪个译名更好。所以「全作只用了一种错误译名」的情况它改不出来——那需要人改一条
    字典条目（或 `--names` 给一份映射），再跑一次就能把其余统一过去。
17. `speaker --include-drift` 会**重写已有的中文译文**（实测把 38 条「写法 A」改成「写法 B」）。
    这是除 `terms --drift-only --overwrite` 之外第二处会主动改动已翻内容的入口，
    跑之前先看 `--dry-run` 的输出。
18. `verify --write-report` 写的是**生成那一刻的快照**，之后改字典不会自动更新，
    要重新跑一次；`speaker --write-names` 只列 `verify` 报 error 的那些名字
    （本作别处翻过、能机械修的不在里面），所以模板是空的**不代表名字全都对**，
    只代表没有会被拦下的问题。
19. 装后被改过时，卸载会**保留** `js/plugins.js.yakusha-backup`（它仍是装之前的那份原文）。
    工具不会自动删它：确认改动都没问题后，你可以手动删掉，或者留着当对照。
    如果这份文件以后又被改回「除自己那条以外与备份一致」，下次卸载会照常逐字节还原。
    另外，如果备份是在「已经装过、当时却没有备份」的状态下拍的（备份里含自己那一条），
    卸载同样只摘条目、不还原，避免把条目写回去；这种备份得手动删。
20. `doctor` 只诊断不修：不改字典、不重装插件、不碰游戏文件。`sync` 能发现「字典里的 key 在
    新 `data/` 里不存在」，但发现不了「游戏新增了台词」——后者要看 `extract` 报的 new 计数，
    而 `doctor` 本身不抽文本。
21. **RGSS 注入器只在 32 位 Windows 上工作**：RGSS 运行时没有 64 位版本，注入器与两个 DLL 都按 `i686-pc-windows-gnullvm` 构建；`libunwind.dll` 是 gnullvm 动态链接的附带依赖，必须和 hook DLL 放在同一目录。
22. **注入器与 DLL 未签名**：Windows 可能弹 SmartScreen / 杀软误报，尤其是 `CreateRemoteThread` 这一段行为。0.18 的完整性机制是 SHA-256 manifest（安装前逐文件校验），不解决代码签名与分发信誉（§8.1 #1）。
23. **RGSS 注入只在单款 VX Ace 游戏（RGSS300.dll）上验收过**：XP / VX（RGSS1 / RGSS2）未测，RGSS301 只是同族已知；遇到老版本先 `scan` 确认再 `install --native`。
24. **只翻 `load_data` 返回对象可达的字符串**：脚本里硬编码的字面量（直接写在 `.rb` 里的字符串）不翻；`Vocab` 兜底也只是常见 UI 词。
25. **已被可执行保护壳/加壳的游戏不在支持范围**：本机 Enigma 样本未尝试注入；这类游戏可能让 `CreateProcessW(CREATE_SUSPENDED)` 或 `LoadLibraryW` 失败并报 `E_EXE`。

## 8. 下一步（backlog，按优先级）

1. ~~push 到 GitHub~~ —— **0.9.0 已完成**：仓库已发布，CI 在 Node 22 / 24 上全绿。
2. ~~0.10.0 契约设计~~ —— **已完成（只有文档）**：五篇设计稿已冻结并互相链接
   （[json-contract](../json-contract.md) / [engines](../engines.md) / [config](../config.md) /
   [export-format](../export-format.md) / [platforms](../platforms.md)）。
   关键取舍：扁平信封 + `outcome` + 退出码 0/1/2；`detect` 改判别式；
   不做项目级配置、密钥不落盘；launch 只认根目录唯一 `.exe`；Windows-only；
   契约测试平铺（`npm test` 不收子目录）。
3. ~~**0.10.0 实现**~~ —— **已完成**：WP1（信封、严格参数、版本单一真源、CI）、
   WP2（适配器、registry、detect、门面）、WP3（用户级 config）、WP4（JSON export）、
   WP5（launch、attach 桩）与 WP6（文档与 0.10.0）全部落地，`npm test` 346 条全绿。
4. ~~**0.10.0 平台与 CI**~~ —— **已完成**：workflow 改 `windows-latest`（Node 22/24，删 ubuntu）；
   加 `.gitattributes`（`* text=auto eol=lf`）；版本号升 0.10.0 时同步了插件模板与测试。
5. ~~**0.10.x 引擎拆缝（refactor/engine-seams）**~~ —— **已完成**：新增 `src/engines/profile.js`
   （`rmProfile`：prompt / grammar / validate / verify 四组引擎事实）与 `src/core/extract.js` 的
   `rmFilePlan`；translate / verify / wrap / doctor 全部改为从 `options.profile` 读引擎判据，
   缺省回退与原实现逐字节一致；mz/mv adapter 挂 `profile` 字段，`rules` 三键契约未动。
   实测见 §6；这是 0.11 Ren'Py 的前置——接新引擎只需新 profile + plan，不再动 pipeline 主循环。
   0.11 的实践印证了这一条：`src/pipeline/` 与 `src/core/` 的主循环一行未改。0.12 在第三个
   家族（二进制 + 归档）上再次印证：主循环仍一行未改，唯一新长出来的是 `doctor` 的
   pending-delivery 分支（因为 `runtime: null` 是第一次出现）。
6. ~~**0.11.0 Ren'Py 前**：`docs/gui.md` 用户指南、`CHANGELOG.md`~~ —— **已完成**：0.11.0
   交付 Ren'Py（translation 档），`CHANGELOG.md` 与 `docs/gui.md` 已补，`docs/limitations.md`
   补了 `.rpyc` 反编译边界与 translation-file 投递的卸载语义，`docs/engines.md` 扩成三引擎
   契约（新增 §13.2 Ren'Py）。实测见 §6。
7. 可选：给 `translate` 的 glossary 加条数上限（按请求过滤后已经省了 90%+，
   但词表上万条时仍会让每请求的过滤变慢，届时值得加）。
8. ~~可选（0.10.x）：`verify --kind` 不校验取值~~ —— **0.19.0 已完成**：未知 kind 报 `E_USAGE` / 退出 2，
   白名单单一真源是 `src/pipeline/verify.js` 的 `VERIFY_KINDS`；合法列表与空 `--kind` 行为不变。
9. ~~给 `verify` 加 `--write-report <file>`，并把 `speaker` 的 `--names` 模板一起生成~~
   —— **0.7.0 已完成**（`--write-report` / `--write-names`，见第 3 节与第 6 节）。
10. 可选：把运行时取证脚本（CDP 解冻 / readPixels 回读 / 冻结后原子渲染）整理成
   `tools/` 下的取证工具，便于以后验收新游戏时复用。**注意：这类脚本会碰游戏进程，
   不建议随工具分发，只作开发期验证用。**
11. 可选：MV 老 nw 的运行时取证目前靠临时注入脚本，如果能找到不注入的办法（例如日志钩子）更好。
12. 可选：`terms` 目前只认数据库 name 字段；若以后要挖地名/技能术语，需要另找锚点
    （例如 `System.json` 的 `terms` 分组），且必须先解决「没有正确答案」的判定问题。
13. **RGSS / Kirikiri 交付层**（0.12 的欠账，0.13 把 Kirikiri 并了进来）：**RGSS 已于 0.18 交付**
    （原生注入器 + hook DLL，`install --native`，见 §3 K 阶段与 §6 的 0.18 段），不再停在 L1–L3。
    **Kirikiri 侧仍未定**：XP3 写回等路线定了再排——XP3 索引可重建但条目重组要重算
    adler-32。代价与「卸载要还原什么」见 §8.1 与 [engines.md](../engines.md) §7.7。

### 8.1 待用户拍板清单（先记下，不阻塞开发）

用户 2026-10-25 明确"先搁置、之后再讨论"的事项，遇到时不要自行决定：

| # | 事项 | 现在的默认做法（未拍板就一直这样） |
| --- | --- | --- |
| 1 | Windows 代码签名 | **0.10/0.11/0.12 都不做**（纯 JS，用户跑自己签名的 `node.exe`）。0.12 实际**也没有**交付原生组件（RGSS 交付层没做，§6 末尾）；**0.18 已交付未签名的注入器与两个 DLL**（完整性靠 SHA-256 manifest，见 §6 的 0.18 段），面向公开分发前仍需解决签名。不签名的四道拦截见 [ENGINE-STRATEGY.md](ENGINE-STRATEGY.md) §9.4。 |
| 2 | 原生组件托管渠道 | 暂按 GitHub Release + 仓库内 manifest（二进制不进仓库）。CDN 方案未定。**0.18 把预编译组件直接放进 npm 包**（`native/prebuilt/`，见 `package.json` 的 `files`）；GitHub Release / CDN 渠道仍未定，仓库内仍不放二进制（该目录已 gitignore，由 CI/本地构建）。 |
| 3 | 原生组件安装命令名 | 暂记 `yakusha native install <engine>`，**属于新命令、要过契约评审**，不是既定事实。**0.18 实际用的是 `install --native`**（挂在现有 `install` 上，不新增命令）；这条算按「不新增命令」落地，但正式命名仍未拍板。 |
| 4 | RGSS 三版本验收基线 | 需要几款真实游戏才能算 L4 通过，未定。0.12 连交付层都还没有（`runtime: null`）；第 10 行的交付层路线已在 2026-10-27 拍板为原生注入器，**0.18 只在单款 VX Ace（RGSS300.dll）上验过**，XP / VX（RGSS1 / RGSS2）未测；验收基线仍未定。 |
| 5 | 字典 v2 字段（`engine` / `locator`） | **已拍板并交付（0.17.0）**。2026-10-27 用户拍板「可以，现在就能加这两个字段」：`engine` 记条目来自哪个引擎（多游戏共用一份字典 / 导出后溯源时用），`locator` 记条目在游戏数据里的精确位置（事件 ID / 脚本行 / 归档条目，写回交付层按它定位）；两字段都是可选溯源元数据，`FORMAT` 仍是 `yakusha/1`，旧字典照读，不影响现有键值读写。实现见 §3 J 阶段。 |
| 6 | 非 ja→zh 语言 | en→zh 何时进未定；en→ja 用户已明确"先不考虑"。 |
| 7 | 目标用户与商业目标 | 未定。影响 GUI 功能取舍与文档语气。 |
| 8 | README / architecture 旧卖点措辞 | 已在 WP6 按"四档交付说明实际影响"改掉；若用户希望保留更强的表述，回退点是本包 commit。 |
| 9 | `CHANGELOG.md` | **已补**（0.11.0 起有面向使用者的变更记录）。 |
| 10 | RGSS / Kirikiri 交付层：纯 JS 写回 vs 原生注入器 | **2026-10-27 用户授权安装 C/C++/Rust 工具链以解锁原生注入器路线的可行性评估**（此前 `cl`/`gcc`/`clang`/`rustc`/`cargo`/`ruby` 实测全不在 PATH，该路线连编译都做不了）。**2026-10-27 工具链已装**：Rust 1.99.1 stable-gnu 全局安装（`%USERPROFILE%\.cargo\bin`，已入用户 PATH；cargo build --release 实跑通过；GNU 自含 MinGW 只服务 Rust 自举，不能编任意 C；C/C++ 已由 llvm-mingw（msvcrt 变体 20261020，clang 23.1.4，便携 zip 免管理员，装在仓库外工具目录并已注册用户 PATH）补齐。**64 位与 32 位（RGSS 硬前提）的编译/注入探针均已实证，见下方探针段**）。路线最终选择 2026-10-27 拍板为原生注入器；**0.18 已交付 RGSS 交付层**（`install --native`），Kirikiri 仍停在 L1–L3、`install` / `uninstall` 报 `E_NOT_IMPLEMENTED`。**2026-10-27 用户就第 10 行表态：确认该交付层面向 RGSS；RGSS 可以采用原生注入器路线**——RGSS 交付层据此按原生注入器推进（纯 JS 写回不再作为主路线，保留为历史备选记录）；Kirikiri 侧仍单列，未跟进。**0.18 已交付 RGSS 注入器（`install --native`），Kirikiri 未跟进。** |
| 11 | npm 打包范围（`package.json` 的 `files` 字段） | **2026-10-27 拍板：打包要包含 GUI**。`files` 已加 `gui`（README/LICENSE/package.json 本来就在）；`docs/` 用户未提及，按惯例不进 tarball（README 已把文档仓库链接作为入口）。变更见下一条目。原 0.16 实测：tarball 52 个文件、全部在 `bin/`+`src/`+根三件（package.json/README.md/LICENSE），**不含 `gui/` 也不含 `docs/`**；装出来的包能跑 CLI，但 `npx electron gui/main.js`（README:283）在 tarball 内容里不存在——维持现状则 npm 包是纯 CLI 包，带 GUI 需把 `gui/` 加进 `files`（决策仍归用户）。 |

**第 10 行的两条路线**（2026-10-27 已拍板走原生注入器；0.18 已按此落地，实现见 `src/engines/rgss/native.js` 与 `native/`；以下保留为决策时的代价对比）：

- **纯 JS 写回数据文档**：把译文塞回 Ruby Marshal 流，重写 `Data/*.rvdata2` 或整个 `.rgss3a`。读写器已经在仓库里（`marshal.js` 的 `marshal()`、`archive.js` 的 `writeArchive()`），**不需要任何原生组件**，也就绕开了代码签名、托管渠道、安装命令名这三条待定项。代价是**改盘**：安装要先备份被改的文档、卸载要逐字节还原（与 MZ/MV 的插件档同一类风险，但文件大得多，一份归档 644 MB）；而且改过的归档与「游戏未来更新」必然冲突。
- **原生注入器 + hook DLL**：运行时把译文喂给游戏进程，不改盘、卸载只需删注入器。代价是这条路线同时踩上 §8.1 的第 1/2/3 行（签名、托管、命令名），还要做崩溃隔离与版本矩阵；**Rust 工具链已于 2026-10-27 全局安装（1.99.1 stable-gnu，`%USERPROFILE%\.cargo\bin`，cargo build 实跑通过）**，这条路在当前机器上已具备编译条件；`cl` / `gcc` / `ruby` 仍不在 `PATH`；C/C++ 已由 llvm-mingw（clang 23.1.4）补齐，且探针证明注入器连第三方 crate 都不需要（裸 `extern "system"` FFI 即可）——Rust 与 C/C++ 写 hook DLL/注入器两条子路都可用。

  **注入器路线可行性探针（2026-10-27，仓库外完成，产物不进仓库）**：Rust `cdylib`
  （`crate-type = ["cdylib"]`、`#[no_mangle] pub extern "system"` 导出函数）
  在本机 cargo build --release 一次通过，产出 1.2 MB 的 `.dll`，导出符号存在，
  并被 PowerShell `Add-Type` + `DllImport` 成功调用（返回探针字符串）。即
  「Rust 产出可被宿主进程加载的 hook DLL」与「外部注入器进程」两半的编译前提都已实测成立；
  剩下的是工程量（windows-rs 的 OpenProcess/WriteProcessMemory/CreateRemoteThread、
  崩溃隔离、签名分发，见第 1/2/3 行）而不是能力缺口。
  **注入器半边探针（同日，仓库外完成）**：零依赖 Rust 注入器（裸 `extern "system"` 声明
  kernel32，不用任何 crates.io 依赖）对本会话自建的测试进程完整走通
  OpenProcess → VirtualAllocEx → WriteProcessMemory（DLL 路径）→ CreateRemoteThread(LoadLibraryW)
  → 远端线程返回模块句柄（DLL 确已加载）。至此原生注入器路线的**两半编译与运行前提都实测成立**：
  Rust 产 hook DLL（上一条）+ Rust 产注入器（本条）。该探针只针对自建测试进程与自家 DLL，
  产物不进仓库；真实游戏注入要处理的注入时机/反作弊/多版本矩阵属工程量，且第 1/2/3 行
  （签名、托管、命令名）在路线拍板前保持未定。
  **32 位半边探针（同日，仓库外完成）**：RGSS 游戏是 32 位进程，注入器路线必须能产出 32 位
  DLL 与 32 位注入器。`rustup target add i686-pc-windows-gnullvm` + llvm-mingw（msvcrt 变体
  20261020，clang 23.1.4，便携 zip 解压即用、免管理员，装在仓库外工具目录并已注册用户 PATH）
  一次链接通过；普通 `i686-pc-windows-gnu` 目标不可用——rustup 自带 self-contained 只有
  crt2.o/dllcrt2.o，缺整套 MinGW 导入库，`i686-w64-mingw32-gcc` 找不到。32 位三件套
  （cdylib DLL + sleeper + 注入器）全部 PE32（machine=0x14c），注入全链
  CreateRemoteThread(LoadLibraryW) 返回模块句柄 → **32 位半边实证成立**。打包注意：gnullvm
  产物动态依赖 `libunwind.dll`（llvm-mingw 自带，需随工具分发）；`-C link-arg=-static` 实测
  去不掉该依赖（Rust 自身 `-lunwind` 的解析顺序），彻底静态要换 GCC 系 i686 工具链，留待真开工再调。
  C/C++ 半边：clang 对 hello.c 的 32/64 位编译运行都通过（第 1 项授权的 C/C++ 工具链落地；
  cl/gcc/ruby 仍缺，不影响本路线）。

  **本机 RGSS 样本的事实（2026-10-27 实测，供注入器设计参考）**：唯一 RGSS 样本是 VX Ace——`Game.ini` 的
  `Library=System\RGSS300.dll`（另带 `RGSS301.dll`），两个 DLL 都是 32 位 PE（machine=0x14c），各导出 27 个
  `RGSS*` C API，其中含 `RGSSEval`（可在游戏自己的 Ruby VM 里求值）与 `RGSSGameMain` / `RGSSInitialize`；
  没有导出任何 `rb_*` Ruby 符号。含义：注入后不必逆 Ruby 符号表，**用 `RGSSEval` 在 VM 就绪后装入
  Ruby 侧的文本钩子**是一条可行子路线（时机=等 VM 起来后调，具体入口待设计）。样本归档 `Game.rgss3a` 644 MB，
  `Game.exe` 402 MB 且旁边有 `.enigma1` 保护文件——疑似加壳，**外部注入在这个样本上可能受限**，
  注入验收要准备干净样本或先验证壳的影响。

Kirikiri 的 XP3 写回两条路线都适用（改盘：重建索引重算 adler-32；注入：KAG 变量层），
但读写器只有读的一半（`xp3.js` 是只读的），等路线定了再排。0.13 没有为写回做任何铺垫。

**Unity 勘察补记（2026-10-27，只记事实，不开工）**：本机 61 款游戏里
27 款是 Unity（18 Mono / 9 IL2CPP；另有 1 款嵌套在子目录下，含嵌套口径 28），
0 款 NScripter。Mono ADV 普遍把整张对话表以
TextAsset 形式嵌在 `resources.assets` / `sharedassetsN.assets` 里，UTF-8 明文，但**每款
游戏的 schema 都不同**（说话人列的 CSV、`key=value` 的 UI 表、命令行混合表）；部分游戏
（`data.unity3d`）还要先过 UnityFS 包（LZ4/LZMA 解压）才能到 serialized-file 层。提取
（L1–L3）对 Mono + TextAsset 子集可行、纯 JS；**交付（L4）要写回 serialized 文件，与
本表第 10 行同属交付层路线问题（RGSS 已拍板走原生注入器，Unity 仍未定）**，且 Unity 的
每游戏 schema 差异远大于前四个引擎。
在路线拍板前不开 Unity 引擎工作包；字形表（font glyph atlas）在逐字节扫描时是高频误报，
真做时必须按对象表定位 TextAsset，不能裸扫字节。

**剩余 34 目录的引擎普查（同日补记，只记事实）**：除 RGSS 1、Kirikiri 6 外，其余
27 个目录没有已支持引擎的形状——nw.js 系 16（根级 `Game.exe`+`nw.dll` 6、项目体在
`www/` 下 9、整体嵌在 `data/` 子目录 1），RPG Developer Bakin 2（`GamePackages`+
`GameConfig.sbcf` / `data.rbpack`+`bakinengine.dll`），Tyrano 1（`*_tyrano_*.sav`），
自研封包 2（`.vfs`、`.fpk`），Unity 嵌套 1（`Game/` 子目录里 `HolyKnightRicca_Data`，
IL2CPP——顶层 `_Data` 扫描漏掉的一档，故 Unity 总数按含嵌套口径是 28），无引擎形状
的杂项 6（一个移植工作区、一个 Steam 壳、一个 `.pac` 封包根目录、其余 3 个无法从根
目录判型）。nw.js 系游戏里多款带 `ManualTransFile.json` / `Dictionaries` 等机翻残留，
说明「文本在根目录一个 JSON」的形状在本机相当常见；但它们内核是 nw.js（Chromium）
而非 RPG Maker，能否走 MZ/MV 的 `data/` 通道要真开工作包再验证。这只是普查记录，
不构成任何新引擎的开工承诺。

## 9. 继续工作的方法

```bash
# 全部测试
npm test

# 看一款游戏有多少可译文本
node bin/yakusha.js scan "D:/H/Games/<game>"

# 建字典
node bin/yakusha.js extract "D:/H/Games/<game>"

# 翻译（需要 key，可用环境变量 YAKUSHA_API_KEY / YAKUSHA_MODEL / YAKUSHA_BASE_URL）
node bin/yakusha.js translate "D:/H/Games/<game>" --concurrency 4 --batch-size 40 --char-budget 6000

# 离线全套验证（不联网）
node bin/yakusha.js translate "D:/H/Games/<game>" --dry-run --limit 50
node bin/yakusha.js translate "D:/H/Games/<game>" --glossary-only

# 说话人名（先看再改）
node bin/yakusha.js verify  "D:/H/Games/<game>" --kind speaker
node bin/yakusha.js speaker "D:/H/Games/<game>" --dry-run
node bin/yakusha.js speaker "D:/H/Games/<game>"                    # 按本作自己的写法修
node bin/yakusha.js speaker "D:/H/Games/<game>" --names yakusha/names.json
node bin/yakusha.js speaker "D:/H/Games/<game>" --include-drift     # 连中文写法也统一

# 名字/术语一致性（先看再改）
node bin/yakusha.js terms "D:/H/Games/<game>" --status drift
node bin/yakusha.js terms "D:/H/Games/<game>" --drift-only --write yakusha/terms.json --dry-run
node bin/yakusha.js translate "D:/H/Games/<game>" --glossary yakusha/terms.json --glossary-only --overwrite

# 发布前自检（只读）
node bin/yakusha.js verify "D:/H/Games/<game>" --max-length 48
node bin/yakusha.js verify "D:/H/Games/<game>" --kind echo,codes,slots --json
node bin/yakusha.js verify "D:/H/Games/<game>" --kind trad,speaker   # 繁简混入 / 说话人名漏译
node bin/yakusha.js verify "D:/H/Games/<game>" --write-report yakusha/verify.md   # 全部问题落成 markdown

# 说话人名字模板（只列 verify 报 error、机械修复帮不上的）
node bin/yakusha.js speaker "D:/H/Games/<game>" --write-names yakusha/names.json
# 填好 value 后：
node bin/yakusha.js speaker "D:/H/Games/<game>" --names yakusha/names.json

# 装 / 卸
node bin/yakusha.js install   "D:/H/Games/<game>"
node bin/yakusha.js uninstall "D:/H/Games/<game>"

# 装完之后：游戏更新了、中文没了，先看它
node bin/yakusha.js doctor "D:/H/Games/<game>"
node bin/yakusha.js doctor "D:/H/Games/<game>" --json
```

### 分支与发布（trunk-based）

只有 `main` 一条长期分支，不建 `develop`，也不预先建 `release`。规则：

1. **`main` 常绿**：合并前 `npm test` 必须全绿；红了先修，不在红树上继续叠改动。
2. **工作分支当天合回**，命名 `feat/` / `fix/` / `docs/` / `chore/` + 主题
   （如 `feat/0.10-envelope`）。文档、注释这类零风险改动可以直接推 `main`。
3. **每个工作包开 self-PR**：CI 在 `push main` 与 `pull_request` 上都会跑；
   分支保护只要求 **status check 通过**，不要求人工 approve（单人无法 approve 自己的 PR）。
   合并方式固定 **squash**，保持 `main` 一条线。
4. **发布打 annotated tag**：`vX.Y.Z` 指向 `main` 上的提交；`CHANGELOG.md` 从 0.11.0 起要先写好再打 tag。
5. **紧急修复从 tag 切**：`fix/0.10.1` 修完合回 `main` 并打新 tag；只有 `main` 已经跑远、
   旧版本仍有人在用时，才建长期的 `0.10.x` 维护分支。
6. **并行 agent 用 `git worktree`**：同一个工作目录不能同时切两个分支，否则两边互相踩。

```bash
git switch -c feat/0.10-envelope
npm test
git push -u origin HEAD          # 开 PR，CI 绿后 squash merge
git switch main && git pull --ff-only
git tag -a v0.10.0 -m "0.10.0"
git push origin v0.10.0
```

仓库侧的手动设置（GitHub，不在代码里）：Settings → Branches → 保护 `main`，
勾选 *Require status checks to pass before merging*；不勾 *Require approvals*（单人）；
*Require linear history* 可选（squash 合并已经保证线性）。

0.12 的验证方式（RGSS 没有交付层，验收都是只读的）：

```bash
# 引擎识别与盘点（打包版走归档，磁盘版走 Data/；两者都用同一套代码）
node bin/yakusha.js scan "<game>" --json
node bin/yakusha.js scan "<game>"            # 文本输出：engine rgss 3、data files、strings

# 全量抽取 + 离线管道（extract / status / translate / verify / terms / speaker / export）
node bin/yakusha.js extract "<game>"

# 交付层未做，这两条必须失败且不写文件（E_NOT_IMPLEMENTED，退出码 2）
node bin/yakusha.js install "<game>"
node bin/yakusha.js uninstall "<game>"

# doctor 要说真话：install 检查是 warn（RGSS has no delivery layer yet…），verdict 仍是 usable
node bin/yakusha.js doctor "<game>"
```

所有命令照常接受 `--json`；`scan` 的载荷仍是 0.10 的 11 键契约，RGSS 只是让
`engine` 多了一个取值、`encodings` 按 `{"marshal":N}`（打包版）或 `{"rvdata2":N}`（磁盘版）
计数。

0.13 的验证方式（Kirikiri 没有交付层，验收都是只读的；表格走 export / import 往返）：

```bash
# 引擎识别与盘点（.xp3 都从根或 data/ 找，补丁归档与基础归档都读）
node bin/yakusha.js scan "<game>" --json

# 全量抽取（KS 字符串逐条带 context，.tjs 只计数）+ 既有离线管道
node bin/yakusha.js extract "<game>"

# 交付层未做，这两条必须失败且不写文件（E_NOT_IMPLEMENTED，退出码 2）
node bin/yakusha.js install "<game>"
node bin/yakusha.js uninstall "<game>"

# doctor：install 检查是 warn（Kirikiri has no delivery layer yet…），verdict 仍是 usable
node bin/yakusha.js doctor "<game>"

# 表格往返：导出 → 清空字典 → 导回 → 再导出，字节必须相同
node bin/yakusha.js export "<game>" --format tsv --out dict.tsv --json
node bin/yakusha.js import "<game>" --from dict.tsv --json
```

所有命令照常接受 `--json`；`scan` 的载荷仍是 0.10 的 11 键契约，Kirikiri 只是让
`engine` 多了一个取值、`encodings` 按 `{"xp3":N}` 计数；`import` 的载荷是
8 键 flat 信封（`file` / `format` / `strategy` / `dryRun` / `read` / `applied` / `skipped` /
`entries`），坏表（表头不匹配、列数不是 3）报 `E_DICTIONARY`，缺文件报 `E_IO`。

0.18 的验证方式（RGSS 有交付层了；合成分发目录与真实游戏都能照着走）：

```bash
# 不带 --native：必须报 E_USAGE，并给出完整命令（不会静默降级）
node bin/yakusha.js install "<game>"

# 干跑：先验证四组件与字典，再打印计划，一个字节不写
node bin/yakusha.js install "<game>" --native --dry-run

# 真装：写 <game>/yakusha/native/ 的 6 个文件（四组件 + dictionary.txt + manifest.json）
node bin/yakusha.js install "<game>" --native
node bin/yakusha.js install "<game>" --native --json    # native: {dir, files, dictionaryEntries, dryRun}

# 装后检查：scan 的 capabilities.runtime 是 "inject"；doctor 的 install / runtime 都是 ok
node bin/yakusha.js scan   "<game>" --json
node bin/yakusha.js doctor "<game>"

# 启动走注入器（没装 native 时回落到普通 Game.exe）
node bin/yakusha.js launch "<game>"

# 卸载：递归删 <game>/yakusha/native；再卸一次要说 the native components are not installed
node bin/yakusha.js uninstall "<game>"
node bin/yakusha.js uninstall "<game>" --json          # native: {dir, removed}

# 非 RGSS 误传 --native：E_USAGE "install --native applies to RGSS games only"（退出码 2）
node bin/yakusha.js install "<mz-game>" --native
```

`install --json` 的 `native.files` 是四个组件名（`dictionary.txt` 与 `manifest.json` 不在里面）；`doctor --json` 的 `install` / `runtime` 两段沿用既有形状（`pluginFile` / `pluginFilePresent` / `entryPresent` / `entryParameters` / `backup`，以及 `embedded` / `entries` / `path` / `found`），0.18 只是让 RGSS 第一次有值。`manifest.json` 只有 `{"schema":1,"files":{...}}` 一层，四个组件各一条 SHA-256；`dictionary.txt` 是 `base64(source)\tbase64(target)` 一行一条、按 source 排序。

## 10. 工程教训（踩过的坑，别再踩）

- **命令行输出里的 `return` 会吞掉后半段**：`terms` 在 terms 为空时 `return`，把后面的 glossary 行
  （以及 --status 过滤时的提示）一起跳过了。凡是「先判断再打印剩余段落」的 CLI，都要么改成
  if/else、要么最后统一收尾。已加回归测试守着。
- **CLI 的过滤参数要同时说明「列出多少」和「挖出多少」**：只打 `4 drift` 会让人以为总共就 4 条，
  实际是 52 条里筛出 4 条。现在打 `4 of 52 mined (4 drift, 0 missing)`。
- **给"建议型"命令加 `--dry-run` 时，语义要写清楚**：`terms --dry-run` 不是"不干活"，
  而是"只报会写什么"——它本来就不碰字典。别照抄 `translate --dry-run`（那个是真不调模型）。
- **新增检查项之前先量假阳性率，别凭直觉定档位**：`trad` 第一版直接扫译文里的繁体字，
  四款游戏命中 34/67/1/12；改成"只报原文没有的字"后变成 30/64/1/**0**——最后这款的
  12 条全是日文说话人名，属于合理保留。差一步就会给用户刷 12 条无用警告。
- **一个检查的判据要能在真实数据上被推翻至少一次**：`speaker` 的"平票"处理是被
  「疲れてそうな女性」这种 1:1 的名字逼出来的——第一版按插入顺序决胜，warn 落在了
  中文那行上，方向完全反了。修复后补了专门的平票测试。
- **「只报不修」的检查要配一个能修的入口**：`verify` 的 speaker 报了 411 条，用户下一步
  要么手改 411 行、要么放弃。这类"正确答案就在同一份数据里"的问题（用 490 次的那个写法），
  应该直接给出机械修复，并让 `--dry-run` 能先看。真正的判断类问题（两种中文哪个更好）
  才留给人和显式开关。
- **白名单正则比黑名单稳**：判断"尖括号里是不是人名"时，先试了排除含 `\` `$` `[` 的内容，
  漏了 `<s[25] ? " OFF ":" ON " >` 这类带空格的；改成"内容必须是纯 CJK/假名/空白且
  长度 ≤ 40"后一次通过。
- **文档里写下的承诺，必须有测试守着**：README 和第 5 节都写着「`verify` 的 error 会让命令
  失败」，实际退出码一直是 0，因为测试只断言了 stdout 里的 `result : FAILED`。
  凡是文档里写出「会失败 / 会写盘 / 会退出」的句子，都该有一条断言；`verify --write-report` 的
  「失败时也写」同理，是专门为它加的一条 CLI 测试。
- **静默过滤的参数会把拼写错误变成空报告**：`verify --kind bogus` 曾经返回 `counts: {}` / `outcome: ok`，发布脚本会把它当成「没有质量问题」；0.19 改成白名单校验（`E_USAGE` / 退出 2）。凡是「过滤」型选项，先问一句：值域写错时应该报错还是静默？涉及门禁的命令，默认应该是报错。
- **备份 ≠ 撤销**：回滚一个文件前，先验证「除了我改的那部分，它还是当时的样子」。`uninstall` 的
  第一版无条件用备份覆盖，等于把「装好之后所有别的改动」当作不存在——这类 bug 在测试里
  看不出来，因为测试只走「装完立刻卸」这一条最干净的路。补的测试专门在中间插一次
  「别人也改了文件」，这才是真实世界里会发生的事。
- **诊断工具遇到损坏的输入要报出来，而不是抛栈**：`doctor` 是「坏了才跑」的命令，初版
  `backupStatus` 直接解析 `plugins.js`，遇到写了一半的文件就打出一段 stack trace——
  在最需要答案的时刻给出了最没用的输出。现在解析失败变成一条 `plugins.js fail`，依赖它的
  `install` / `backup` 两项跳过，其余照常输出。凡是「输入可能已经坏掉」的入口，先想清楚
  坏了时该打印什么。

- **Windows 上 ESM 不能直接 import 绝对路径**（`ERR_UNSUPPORTED_ESM_URL_SCHEME: d:`），
  必须 `pathToFileURL(p).href`；验证脚本一律写成 `.cjs` 再 `node` 跑，别塞进仓库。
- **`node --test test/` 在 Windows/Node 24 上会报 Cannot find module**，
  `scripts.test` 必须写 glob 形式 `node --test "test/*.test.js"`。
- `plugins.js` 有尾逗号（合法 JS、非法 JSON）→ 必须先 `stripTrailingCommas` 再 `JSON.parse`。
- `--save-every` 的 `lastSaved` 必须从 0 起（`progress.translated` 是本次运行增量，混基准会永不落盘）。
- `parseReply` 要能吃两种回显：模型把 `src` 字段回显、以及模型写出非法转义 `\{`
  （`parseJsonLoose` 逐字符修复）。
- DeepSeek 用 `response_format:{type:"json_object"}` 时，prompt 里必须出现 "json" 字样，否则 400。
- 长跑不要加 `--json`（否则没有进度输出，看起来像卡死）。
- 包装 LLM 调用的脚本要放在**仓库外**（临时目录里的一个 `.mjs` 即可），
  放仓库里会在清理临时文件时被误删，后台长任务整个白跑。
- **严格解析要在任何副作用之前，并且解析失败也要知道「正在解析哪个命令」**：0.9 的
  `parseArgs` 会静默忽略未知选项，等于带着一个打错字的 `--limit` 跑一小时付费请求。
  0.10 的 `E_USAGE` 在抛错时带上 `positional[0]`，`scan --limit` 的信封才不会
  `command: null`。
- **provider 的非 2xx 只报状态码**：旧消息把响应体前 300 字拼进 message，而有些兼容网关
  会把请求头（含 `Authorization`）回显在错误体里，等于把 key 写进日志和 `--json`。
  现在 message 永远是 `provider returned HTTP 401`，body 只在 `YAKUSHA_DEBUG=1` 时进 stderr。
- **测试里不要写字面量密码 / URL userinfo**：本机工具链会把 `user:pass@host` 脱敏成占位符，
  fixture 与断言会悄悄对不上；改成拼接构造（`"https://user:" + password + "@host"`），
  断言脱敏后的 `https://***@host`。
- **默认值会把「没配置」变成延迟失败**：内置 `gpt-4o-mini` 让一次没配置 provider/key 的运行
  看起来能跑，实际在端点上才失败；换了第三方 `baseUrl` 后甚至可能把请求发到默认 OpenAI
  地址。把必填项前移成发请求前的 `E_CONFIG`，错误才出现在用户能修、也免费的地方。
- **用「替换后是否相等」判断占位符命中会误报**：插件模板里的 `VERSION` 占位恰好等于当前
  package version 时，`replace` 结果与原文相同，旧实现据此认为「模板缺常量」并把所有插件
  测试打挂。判断占位符是否存在要用 `regex.test(source)`，不是比较替换前后的字符串。
- **越界守卫要覆盖所有写/删动作，并且在动手之前跑**：路径 containment 只加在 install、
  或加在删文件之后，都等于没有；`assertInsideRoot` 对 plugins.js、备份、插件文件逐个检查，
  install 与 uninstall 共用。
- **不是每个命令都接一个游戏目录**：`main` 原来把所有命令都按「恰好一个 game-dir」校验，
  加 `config` 时如果不特判，`config list` 会被当成「缺游戏目录」。位置参数形状属于命令契约，
  要跟 payload 一样在分派处显式写明，不能假设所有命令同构。
- **`--dry-run` 不能偷偷读取外部状态**：`translate --dry-run` 连配置文件都不读，否则一个
  损坏的 `%APPDATA%\yakusha\config.json` 会把离线预览也挡住；同理，坏配置对 `translate`
  只 warn、对 `config` 子命令才是 `E_CONFIG`——「读配置是为了用」和「读配置是为了改」
  失败策略不同。
- **用户级配置必须给测试一个可注入的目录**：清空 `YAKUSHA_*` 只能保证不继承环境变量，
  不能阻止代码去读开发机真实的 `%APPDATA%`；CLI 测试要显式设 `YAKUSHA_CONFIG_DIR`
  指向 `mkdtemp` 的空目录，否则断言的绿红取决于本机有没有配置文件。
- **整数样式的键会无视插入顺序**：导出契约要求 entries 按 UTF-16 排序，但普通对象交给
  `JSON.stringify` 会把 `"2"` 排在 `"10"` 前面（JS 对象自身的枚举规则），先 `sort`
  再 stringify 也会被重新排列。顶层与 entries 的键序只能手写，值仍用 `JSON.stringify`
  保持转义一致；测试用 `"10"` / `"2"` / 代理对 `𠮷` 直接断言字节位置和重复导出。
- **拒绝写一个文件，要同时看路径和文件身份**：export 的 `--out` 可能通过相对路径、大小写、
  符号链接或目录联接指向字典本身；只比较字符串不够。用 realpath 比较目标（不存在时解析父
  目录），并且 `--force` 不能绕过这条保护——否则一次“导出”就能把唯一一份译文覆盖掉。
- **临时文件必须与目标同目录**：跨盘 / 跨卷 rename 会 `EXDEV`；同目录临时文件 + `wx`
  + rename 才能保证失败时原文件一个字节不动，并在 catch 里清理临时文件。
- **测试不能真的启动游戏 exe**：`launch` 的发现逻辑是纯函数，`spawn` 由参数注入；
  测试用假 `ChildProcess` + `queueMicrotask` 发 `spawn` / `error` 事件，断言 args、
  `cwd`、`detached`、`stdio` 和 env，既不弹游戏窗口也不依赖本机装没装游戏。非法
  `--exe` 是 `E_EXE`（exe 选择失败），不是参数语法错误 `E_USAGE`——两者都退出 2，
  但错误码是契约。
- **信封要保留错误的结构化 `details`**：`E_EXE` 的候选列表原本在 `failureFor` 里被
  丢掉，只剩一句 “found N .exe files”；CLI 错误转换必须复制 `error.details`，否则
  调用方拿不到 `candidates`，JSON 契约里写的字段就只是摆设。
- **pickle 的空容器是独立 opcode，不是 MARK 的重载**：写栈机时想当然地按「有 MARK 就
  收集、没有就返回空」处理 `DICT` / `LIST` / `TUPLE`，结果 `EMPTY_DICT`（0x7d）、
  `EMPTY_LIST`（0x5d）、`EMPTY_TUPLE`（0x29）是各自的 opcode，与 `DICT`（0x64）、
  `LIST`（0x6c）、`TUPLE`（0x74）不是同一个值。凭记忆写 opcode 表一定会错，
  表要从 `pickle.py` / `pickletools` 的常量逐条抄，并用真实样本的第一段字节验一遍。
- **覆盖率要分清「解码失败」和「解码成功但取不到」**：`.rpyc` 全集跑出 0 失败很容易
  让人得出「全覆盖」，但把 `.rpy` 与 `.rpyc` 的字符串集合逐个 stem 对齐后才发现，
  屏幕语言与 `example:` 块里的文本在 AST 上根本没有路径可达（字节在、句柄不在）。
  两个指标回答两个问题：解码率说明「格式支持做完了没有」，覆盖对照说明「文本面做完
  了没有」。只看前者会把能力边界写成 100%。
- **两种数据源并存时，优先级要写进代码而不是留在注释里**：同一 stem 的 `.rpy` 与
  `.rpyc` 都读，出现次数虚增 32% 而唯一串不变——这种错不会被唯一串的断言抓到。
  规则必须是显式的一条（有 `.rpy` 就跳过同名 `.rpyc`），并且要有测试直接钉住
  `scripts` 的计数，否则下次谁加一个循环就会把它破坏掉。
- **「只解码」要连对象构造一起拒绝，不只是不 eval**：Marshal 流里能出现任意类名，
  如果按类名去构造"真对象"，一个恶意类名就能砸进原型链。所以 `marshal.js` 的对象是
  `{ __type: "object", className, ivars }` 这样的纯数据记录，`T_DATA` 只留字节，
  字符串留原始字节不解码——`Scripts.rvdata2` 里的 deflate 脚本正文必须逐字节回写，
  这条约束反过来帮了 round-trip（398/398 深相等）。
- **大文件只读需要的部分，架构先行**：644 MB 的 `.rgss3a` 从来没有被整包读进内存过——
  目录是一个可增长的头部窗口（上限 `MAX_DIRECTORY = 64 << 20`，超限明确报错而不是
  OOM），单个文件按需解。这个决定要做成结构（`HeadWindow` 类），不能靠调用方自觉。
- **同源的文本不要抽两遍**：`402`（选项分支标记）里的字符串与配对的 `102` 是同一串，
  收它只会多一个 context、不多一条译文——引入它的冲动来自「多收总比漏收好」，但
  重复条目会进字典、进导出、进 verify 的计数。类似地，`@note` 与 `@*_name` 是配置
  和资源名，翻了就破坏游戏。**能翻不等于该翻**，判据要写成表（`COMMAND_TEXT` /
  `SYSTEM_TEXT_FIELDS`）并让「为什么排除」留在注释里。
- **writer 有了不等于交付了**：`marshal()` 与 `writeArchive()` 在 0.12 就能写回三格式，
  但「能写」与「敢写进玩家的游戏」之间隔着备份策略、更新冲突与真机验证。把 writer
  合入只读版本没有坏处（round-trip 测试反而更硬），但交付层必须单独立项，
  不能因为"写回能力已经有了"就顺手打开 `install`。
- **格式魔数不一致就报 unsupported，不要猜**：XP3 的索引有标准（`File`）与改版
  （`Hxv4`）两种 magic，后者是某些本地化发行版私改的。对私改格式的每一个字节
  下假设，错了就是读坏玩家的文件；明确报 `E_UNSUPPORTED` 把决定权交回上游
  （先转换或换工具），是唯一站得住的选择。判据要写在错误信息里——「只读标准 XP3 索引」。
- **表格 quoting 的判据是「能不能无损往返」，不是「看起来需不需要」**：TSV / CSV 单元格
  只要含分隔符 / 引号 / CR / LF / 首尾空格之一就必须加引号——台词里出现制表符或换行的
  概率不为零，而静默坏表要到 import 那一步才炸。写完判据就配一个「含全部危险字符的
  单元格往返」测试（`export.test.js` 有）。
- **同一引擎的多归档目录，补丁与基础都要读**：Kirikiri 的补丁目录与基础目录是两个
  `.xp3` 并存，同名条目在两边都有——按「后读的遮蔽先读的」处理会丢一边的文本。
  与 Ren'Py 跳过 `tl/` 相反（那边是「原文优先」，译文目录整个排除），这边的正确做法
  是**两个都读、逐条都收**。「数据源并存的优先级」没有普适答案，每个引擎要单独想清楚
  并写进代码。
- **「能解码」和「能交付」之间隔着进程边界**：0.18 真正的新东西不是 Rust，而是必须在别人的进程里跑代码。安装/卸载的边界（只碰自己的目录）、失败即不写、manifest 就是所有权凭证，这三条比任何解析都重要。
- **IAT 上的一个槽比逆整个 Ruby 符号表便宜**：RGSS DLL 不导出任何 `rb_*`，但游戏自己要解析 `RGSSEval` / `RGSSGameMain`；补 `GetProcAddress` 一个槽就同时拿到「VM 就绪后执行 Ruby」和「接管主循环」两个入口。先找宿主已有的调用点，再考虑逆符号。
- **帮助文本会落后于行为**：`--native` 在参数解析和实现里先能用了，`install --help` 却还只列 `--embed`（0.18 收尾时已补上）；`doctor` 的 `not installed` 提示仍写着不带 `--native` 的 `yakusha install <game>`——RGSS 上照抄会直接 `E_USAGE`。参数白名单、USAGE 文案、doctor 建议语是三处，改一处要同时检查另外两处，最好让测试读 help / doctor 文本。
- **完整性校验要在任何写入之前，失败也要说清是缺文件还是文件被动过**：`E_IO` 的两条消息分开（`native component is missing` / `native component failed its integrity check`），用户才知道是「没构建」还是「被改动」。先验证后复制，失败时目标目录一个字节都不写。
