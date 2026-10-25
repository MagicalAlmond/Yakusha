# 多引擎路线与开发指导（0.10 之后）

> 内部战略稿，不是冻结契约。基于 2026-10-25 的主干代码、[architecture.md](../architecture.md)、
> [engines.md](../engines.md) 与对三个开源项目的调研。落地前仍需按 [json-contract.md](../json-contract.md)
> 的契约变更流程评审；本文只回答“10+ 引擎该怎么加，才不会把现在的代码拆掉重写”。

## 0. 结论摘要

1. **Yakusha 的差异化不是“引擎更多”，而是“可逆、可验证、可脚本化的运行时翻译层”。**
   引擎数量是必要条件，不是卖点本身；10+ 引擎必须建立在同一套内容模型和交付模型上。
2. **10+ 引擎不能靠“每个引擎复制一份 adapter”实现。** 当前 `src/engines/` 只是 RPG Maker core 的
   薄壳：加一个新引擎仍要改项目模型、提取器、文本语法、校验、提示词、运行时安装和检测顺序。
   这是当前最大的架构债，优先级高于继续加功能。
3. **先把“引擎”拆成五个可替换的层**：项目探测、内容模型、文本语义、运行时交付、引擎编排。
   引擎适配器只做编排，不再拥有全部逻辑；引擎之间的差异尽量下沉到数据（EngineProfile），
   代码只保留真正无法声明的部分。
4. **10+ 个引擎按“家族”组织，而不是按“作品”组织。** MZ/MV 是 Maker JS 家族；XP/VX/VX Ace
   是 RGSS 家族；KRKR 属 TJS 系，TyranoScript 属 JS 系；Ren'Py、NScripter、Wolf、SRPG Studio 各自成族。
   这样实际要维护的是 7 个左右的家族，而不是 10 份互不相干的代码。
5. **运行时能力必须分档并诚实标注**：插件、引擎自带翻译资源、调试协议、原生注入、文件补丁。不是每个引擎都能做到
   “纯插件 + 逐字节还原”；做不到的，要么明确降级，要么不做，不能假装支持。
6. **0.10 先按冻结契约收尾，不为了多引擎改契约。** 多引擎的第一步是一次“只拆缝、不改行为”的
   内部重构（0.10.x），然后每个版本只推进一个家族，用真实游戏验收，而不是先铺 10 个空壳。

## 1. 目标与“支持”的定义

### 1.1 为什么是 10+，不是 20+

用户已确认：Yakusha 未来会有 10+ 个引擎，但不会追 20+。这个数量级是合理的：

- 10 个左右可以覆盖“RPG Maker 全系 + 日系脚本引擎 + 少量现代引擎”，形成可感知的覆盖面；
- 超过 15 个后，每个引擎的版本碎片、运行时差异、反作弊/法律风险和测试成本会指数上升；
- 竞品已经证明“枚举很多”不等于“每个都能用”（见第 2 节），Yakusha 不应重复这条路。

### 1.2 “支持一个引擎”的验收标准

本文建议把“支持”定义成六级证据，而不是“能 detect”：

| 级别 | 名称 | 要求 |
| --- | --- | --- |
| L0 | 探测 | 能识别项目，错误目录不误判，返回候选与证据 |
| L1 | 夹具提取 | 仓库内有最小夹具，`scan`/`extract` 有 golden 输出 |
| L2 | 真实游戏提取 | 至少一款真实游戏，覆盖率、不可解码率、上下文可解释 |
| L3 | 翻译与校验 | 该引擎的文本语法、控制符、占位符、行宽、说话人规则可验证 |
| L4 | 运行时交付 | 至少一种可逆交付方式，真实游戏里能显示译文 |
| L5 | 生命周期 | `doctor` 能诊断、`uninstall` 能还原、版本升级后能解释失败 |

只有达到 L4、且 L5 的 `uninstall` 通过，才在 README / 能力矩阵里写“支持”；L1–L3 只能写“实验性”。
这条规则要写进每个引擎的 PR 模板和 `docs/games.md`。

## 2. 三个开源项目怎么适配不同引擎

> 以下只总结公开仓库的架构与文档，不复制代码。调研快照 2026-10-25；星数和文件数会变，
> 这里不把它们当稳定指标。许可证以各仓库为准，复用前必须单独确认。

### 2.1 ATT：把“引擎适配”变成内容协议 + 外部适配器

仓库：<https://github.com/yexi-by/att>（Rust，AGPL-3.0，Windows x64）

ATT 只原生支持 RPG Maker MV / MZ，但它的扩展方式不是“继续加引擎枚举”，而是三层覆盖：

1. **Builtin**：固定的文本矩阵。数据库标准字段、`System.json` 的标题/货币/术语、
   Map/CommonEvents/Troops 的事件指令参数（101/401 对话、102/402/404 选项、105/405 滚动、
   320/324/325 等）。MZ 的 `101.parameters[4]` 被当作 Speaker，MV 则通过 dialogue rules 投影。
2. **Rules**：用 TOML 描述字段/路径/插件参数/事件参数，带 capture、literal、自然序号。
   这层解决“同一引擎、不同游戏/插件”的差异，不需要改 Rust 代码。
3. **Generic**：外部工具把任意格式映射成 JSONL。每个 `.jsonl` 是一个 Semantic Scope，
   每行一个 Group `{id, kind, units:[{id, text}]}`；严格拒绝未知字段、重复 ID、CR/NUL、符号链接。
   外部操作者负责“源格式 ↔ JSONL”和“把译文放回消费者”。

配套的是**独立的 write_back 目录**：从冻结来源按 recipe 物化到
`<att-dir>/projects/<mv|mz>/<name>/write_back/`，原游戏保持不动；发布前验证来源、owner、
Mutation Claim、JSON、事件、控制符。它不生成运行时插件，用户自行部署。

ATT 还定义了 **AdapterVerification**：报告 units/checks/measurements，check 分
consumer/changed_text_roundtrip、native_static/runtime。也就是说，外部适配器不是“能跑就行”，
而是要提交可复核的证据。

**可借鉴：**

- 把“内容协议”和“引擎实现”分开：通用 JSONL / 通用内容模型可以承接长尾，核心不必为每个格式加代码。
- 外部适配器必须有验证报告和明确的职责边界（谁负责写回、谁负责校验）。
- 独立输出目录 + 原游戏不动，是比“直接改游戏文件”更稳的发布模型。

**代价：**

- 需要外部工具或 Agent 先把格式映射成 JSONL；不是开箱即用。
- 没有运行时交付，翻译结果需要用户自己部署；这恰好是 Yakusha 的强项，不应照搬。
- SQLite 项目库、lease、日志、原子发布对单人维护的工具偏重；Yakusha 可以借思想，不必全套实现。

### 2.2 GameStringer：用“大量独立模块”换广度

仓库：<https://github.com/rouges78/GameStringer>（Tauri/Rust，源码可见但非 OSI 开源）

它的适配方法是“多套枚举 + 固定优先级探测 + 每个引擎一个 patcher”：

- `engine_detector.rs` 里有 40+ 个引擎枚举；`detect_engine(path)` 按固定优先级顺序判断：
  Unity 先，Spike Chunsoft 必须排在 Unreal 前（避免 `.pak` 误判），然后 Unreal/Godot/
  RPG Maker/Ren'Py/...，最后 `scan_exe_for_engine`：PE import 表 + 前 8MB 字符串匹配。
  再往下还有 `detect_engine_smart`：先路径，后游戏名查表。
- 每个引擎一个 `*_patcher.rs`（RPG Maker、Ren'Py、Wolf、Godot、Unreal、Unity、GameMaker、
  Tyrano、Visionaire、Bethesda、CRI 等约 12 个文件型 patcher）；`universal_injector.rs`
  把检测结果映射成 `can_inject` / `injection_method` / `tools_required` / `translatable_files`，
  文件型做 setup，其余给外部工具步骤。
- 插件系统（`plugin.json` + detect/extract/patch，QuickJS/Deno 沙箱）在文档里是设计/路线图，
  核心仍是每引擎一个 Rust 模块；`/api/` 路由多为 501，核心是 Tauri invoke，没有外部 CLI/库。

它自己的 `docs/ENGINE-COVERAGE.md` 承认：20+ 引擎里只有约 12 个文件型 patcher；
“Tested”只代表有 Rust fixture 单测，不保证真实游戏端到端；WinAPI 注入/OCR/内存注入多为 0 测试；
KiriKiri、Naninovel、NScripter、LiveMaker、SRPG Studio 等仍是缺口。

**可借鉴：**

- 能力矩阵、覆盖矩阵、证据分级：让用户知道“能检测”不等于“能翻译”。
- 用统一的注入器/交付层收口，而不是让每个 patcher 自己决定怎么改游戏。
- 检测要可解释：路径、文件、PE import、字符串都可以作为证据。

**要避免：**

- 固定顺序的检测规则会变成长期维护债：引擎一多，顺序就是隐式契约，新增一个引擎可能误判旧引擎。
- “枚举多”会制造虚假覆盖面；没有真实游戏验收的引擎应该标灰，而不是列在支持列表里。
- 每引擎一个 patcher 的复制粘贴模式，在 10+ 时会变成 10 份安全/回滚/版本逻辑。
- 源码可见许可限制商用/竞品，不能作为可复用依赖；只能借鉴架构思想。

### 2.3 fkiliver：把适配完全外包给外部工具

仓库：<https://github.com/fkiliver/RPGMaker_LLM_Translator>（Python，仓库未声明 LICENSE）

它的做法是：外部商业提取/注入器负责“从游戏里拿文本、把译文放回去”，本项目只做 LLM 代理：

- 自定义控制符正则，把控制符替换成占位符再发给模型；
- Python FastAPI 后端，清空 system template，body 只放源文本，批量请求；
- 本地 Sakura / GalTransl 模型，JP→ZH；
- 翻译后由外部工具注入。

代码里的几个细节很能说明“外挂式适配”的代价：

- 控制符替换后最多重试 10 次，仍不一致只 warning，仍返回可能损坏的译文；
- `contains_japanese` 只查 U+3040–U+30FF，纯汉字文本会被当成“无需翻译”跳过；
- `max_tokens=512` 会截断长文本；全局 history 只有 3 条，无翻译记忆/术语一致性；
- `ThreadPoolExecutor(len(data))` 无界并发，全局 history 被并发共享；
- 没有测试、没有 CI、没有 LICENSE。

**可借鉴：**

- 本地模型/离线翻译是真实需求；Yakusha 的 provider 层未来可以加“本地 OpenAI 兼容端点”，
  但不应把模型和提取/注入耦合。
- 控制符处理必须是“结构化 token”，而不是“字符串替换 + 重试碰运气”。

**要避免：**

- 把提取/注入外包给不稳定的第三方，等于把产品契约交给别人；
- 翻译损坏时只 warning、仍返回结果，会污染字典；
- 只查假名判断“是否日文”会漏掉纯汉字文本；Yakusha 的 `hasKanaOutsideMarkup` 也需要在引擎层
  扩展成“该引擎的源语言判定”，不能假设所有文本都含假名。

### 2.4 对比表

| 维度 | ATT | GameStringer | fkiliver | Yakusha 应该选 |
| --- | --- | --- | --- | --- |
| 扩展单位 | 内容协议 + 外部适配器 | 每引擎一个 patcher | 外部工具 | 引擎家族 + 数据驱动 profile |
| 文本来源 | Builtin/Rules/JSONL | 各引擎原生解析 | 商业工具输出 | 统一文档模型 + locator |
| 运行时 | 无（写回独立目录） | 注入/文件补丁 | 注入 | 插件/调试/注入/补丁分档 |
| 验证 | 强（AdapterVerification） | 弱（fixture 为主） | 无 | 强（逐引擎验收 + 契约测试） |
| 对外接口 | CLI | GUI | 脚本 | CLI + 库门面 + JSON |
| 许可 | AGPL-3.0 | Source-available | 无 | GPL-3.0-or-later，不复制他人代码 |
| 对 Yakusha 的启示 | 内容协议可扩展 | 广度会反噬质量 | 外包会失去控制 | 先深后广，家族化，证据化 |

## 3. Yakusha 现状：adapter 不是真正的“缝”

当前代码（0.10 实施中）已经有 `src/engines/adapter.js`、`registry.js`、`mz/adapter.js`、
`mv/adapter.js`，文档也写了 EngineAdapter 契约。但审计后可以确认：**它只是 RPG Maker core 的薄壳**。

### 3.1 耦合点清单

| 位置 | 现状 | 加新引擎时必须动什么 |
| --- | --- | --- |
| `src/engines/registry.js:11` | 固定 import mz/mv，数组写死 | 每加一个引擎都要改 registry |
| `src/core/mzproject.js:17` | `Project` 固定 `root/engine/pluginDir/dataDir/pluginsFile/indexPath/gameTitle/version` | 新引擎的项目形状不同，要么塞进同一结构，要么改所有调用方 |
| `src/core/extract.js:31` | `extractProject` 硬编码 `data/*.json`、RM 字段/指令 | 新引擎的文档/归档/二进制格式无法复用 |
| `src/core/textkey.js` | MZ 转义码 tokenizer | Ren'Py/KRKR/Wolf 的文本语法完全不同 |
| `src/pipeline/translate.js:142` | system prompt 明写 “RPG Maker MZ ... Japanese” | 新引擎的提示词/控制符说明要改 pipeline |
| `src/pipeline/verify.js` | 假名、RM 控制符、`%1`、说话人规则 | 新引擎需要自己的校验规则，不能全塞进 verify |
| `src/core/doctor.js:85` | 输出 “RPG Maker ...” | 新引擎的诊断项不同 |
| `src/plugin/YAKUSHA_Translator.js:526` | 运行时只包 `DataManager` | 新引擎需要新的运行时载体 |
| `src/engines/mz/adapter.js:61` | 声明 `rules:{controlCodes,maxColumns}` | 该字段目前没有被 core/pipeline/CLI 读取，声明了也不生效 |
| `bin/yakusha.js` | 只有 scan/extract/install/uninstall/launch 走 adapter；status/verify/speaker/terms/translate/doctor/export 直接调 core | 新引擎即使有 adapter，这些命令也绕过它 |

最后一条尤其关键：`cmdStatus`（`bin/yakusha.js:166`）、`cmdVerify`（179）、
`cmdSpeaker`（254）、`cmdTerms`（348）、`cmdTranslate`（448）、`cmdDoctor`（728）、
`cmdExport`（700）都没有经过 adapter。也就是说，现在的 adapter 只覆盖“项目 + 扫描 + 提取 +
安装 + 启动”，覆盖不了“翻译质量”和“运行时诊断”。

### 3.2 后果

- 新增一个引擎，实际工作是“复制一套 core + 改 pipeline + 改 doctor + 改 plugin”，
  而不是“新增一个 adapter”；10+ 引擎会变成 10 份分叉。
- `rules` 是死字段：文档承诺“引擎专属校验挂在 adapter 上”，代码没有兑现。
- 检测顺序写死：今天是 `mz → mv`，明天加 8 个引擎后，顺序就是隐式契约；GameStringer 的
  40+ 枚举已经演示了这条路的维护成本。
- 只有 RM 夹具（`test/fixtures/mini-mz`、`mini-mv`），没有第二个家族的证据；
  10+ 引擎的质量无法靠现在的契约测试保证。

## 4. 目标架构：五层拆分

建议把“引擎”拆成下面五层。原则是：**能声明的进数据，不能声明的进代码；pipeline 只依赖接口，
不依赖具体引擎。**

```
CLI / GUI / library
        │
  ProjectSession（引擎无关）
        │
  EngineAdapter（编排 + 能力 + 版本）
   ├── EngineProfile        数据：探测标记、文本面、能力、版本、启动
   ├── ContentProvider      代码：文档枚举、读取、提取、locator
   ├── TextGrammar          代码：tokenize / validate / wrap / speaker / prompt hints
   └── Delivery             代码：plugin / translation-file / debug / inject / patch
```

### 4.1 EngineProfile：把差异变成数据

每个引擎（或家族）一份 profile，至少包含：

```js
{
  id: "renpy",
  family: "renpy",
  name: "Ren'Py",
  versions: { tested: ["8.2.x"], min: "8.0", max: null },
  detect: {
    markers: [
      { path: "renpy", kind: "dir", weight: 40 },
      { path: "game/script.rpy", kind: "file", weight: 30 },
    ],
    negative: [{ path: "js/rmmz_core.js", weight: -100 }],
    minScore: 50,
    priority: 20, // 只用于同分排序，不用于唯一判定
  },
  content: {
    documents: ["game/**/*.rpy", "game/**/*.rpyc"],
    grammar: "renpy",
    defaultEncoding: "utf-8",
  },
  runtime: {
    modes: ["translation-file"], // plugin | debug | inject | patch | translation-file
    default: "translation-file",
    reversible: true,
  },
  capabilities: {
    extract: true, export: true, launch: true,
    attach: false, liveReload: false,
  },
  launch: { exe: "*.exe", args: [] },
}
```

注意：

- profile 不是“把代码写成 JSON”。它只放**声明性差异**；真正的解析/写回逻辑仍在
  `ContentProvider` 和 `Delivery` 里。
- `priority` 只做同分排序；是否匹配由 markers/negative/minScore 决定，不能再靠“先判断 A 再判断 B”。
- `versions` 是支持矩阵的一部分，不是装饰；`doctor` 要能报“这个版本没验证过”。

### 4.2 探测：从“顺序判断”改成“证据打分”

建议 `detect(dir)` 返回：

```js
{
  ok: true,
  candidates: [
    { engine: "renpy", score: 80, evidence: ["renpy/ 目录", "game/script.rpy"] },
  ],
  project: { ... }, // 仅在唯一命中且通过校验时给出
}
```

规则：

- 每个 marker 有权重，negative marker 可以一票否决（例如 RPG Maker 项目里出现 Unity 的
  `UnityPlayer.dll` 不一定是 Unity，但出现 `js/rmmz_core.js` 基本可以排除 Unity）。
- 同分/多候选时返回 `E_MULTI_ROOT`（沿用现有错误码，不新增顶层码），并在 `details.candidates`
  里给出证据；CLI 增加 `--engine <id>` 覆盖，避免用户被误判卡死。
- 探测不读大文件、不执行游戏、不联网；版本读取失败就是 `null`，不猜。
- 新增引擎必须先加 fixture 和“误判用例”（拿其他引擎的目录跑一遍，必须返回 not-project）。

### 4.3 内容模型：文档 + locator，而不是 data/*.json

统一成：

```js
ContentProvider = {
  listDocuments(project) -> [{ id, path, format, size, encoding }]
  readDocument(project, doc) -> unknown
  extract(project) -> [{ key, text, locator, context }]
  apply(project, entries) -> patchPlan   // 仅 patch 模式；默认不写
}
```

- `locator` 是结构化定位（文件、路径、事件码、行号、字段），`context` 仍是人看的字符串。
  字典 v1 继续用 `contexts` 字符串；v2 再考虑加 `locators`，不要为了多引擎立刻改冻结格式。
- 提取只读；写回只发生在显式的 patch 模式，并且必须先备份、后校验、可卸载。
- 新引擎不允许把特判写进 `src/pipeline`；pipeline 只消费 `ContentProvider` 的输出。

### 4.4 文本语义：TextGrammar 独立

每个引擎家族一份 grammar：

```js
TextGrammar = {
  tokenize(text) -> tokens          // 控制符、占位符、标记
  validate(source, translated) -> { errors, warnings }
  wrap(text, maxColumns) -> string
  speaker(text) -> string | null
  promptHints() -> string           // 提示词里“这个引擎的转义码是什么”
}
```

- `src/core/textkey.js` 是 MZ/RM 的实现，应迁到 `src/engines/rm/text.js`（或 mz/mv 共享模块），
  不要继续放在“引擎无关”的 core 里。
- `translate.js` 的 system prompt 改成由 grammar 生成；通用部分（不要翻译代码、保留占位符、
  输出 JSON）留在 pipeline。
- `verify.js` 拆成“通用检查”+“grammar 检查”；通用检查包括回显、空译文、`U+FFFD`、行数、
  长度比；grammar 检查包括控制符、占位符、行宽、说话人。
- 目标语言/源语言判定不能写死“日文→中文”；至少把它们变成项目级配置，后续再扩展。

### 4.5 运行时交付：模式与能力矩阵

| 模式 | 机制 | 适用 | 可逆性 | 风险 |
| --- | --- | --- | --- | --- |
| `plugin` | 往游戏里加脚本/插件，运行时查字典 | MZ/MV、部分 JS 引擎 | 逐字节还原 | 低 |
| `translation-file` | 使用引擎自带的翻译/本地化资源机制，生成或替换资源 | Ren'Py 等 | 资源可撤销 | 低 |
| `debug` | 启动调试端口，CDP/协议注入钩子 | NW.js/Electron/Chromium 系 | 退出即恢复 | 中 |
| `inject` | 原生 DLL/注入器 + 引擎 hook | Wolf/KRKR/Unity/Unreal/RGSS | 需 detach/恢复，崩溃风险 | 高 |
| `patch` | 直接改数据/脚本/归档，备份后写回 | 没有运行时钩子的引擎 | 备份可还原，但已改文件 | 中高 |
| `none` | 只提取/导出，不交付 | 长尾/仅做翻译资产 | 不适用 | 低 |

要求：

- adapter 必须声明 `runtime.modes` 和 `reversible`；CLI/GUI 只展示声明过的能力，不能“点了才报错”。
- 默认模式尽量选 `plugin`；`patch` 必须显式 `--patch`，并且先备份、后校验、可卸载。
- `inject` 单独分发原生组件，默认不随主包；不支持在线/反作弊游戏；崩溃恢复和 detach 要写进设计。
- 不允许“插件失败就静默改成 patch”；降级必须用户确认，日志/JSON 要写清楚用了哪种模式。

### 4.6 通用适配器/内容协议

这是 10+ 引擎能否可持续的关键。建议分两种，按风险从低到高：

1. **通用内容导入/导出（先做）**：外部工具把任意引擎的文本导出成 Yakusha 的 JSON/JSONL
   （key、text、locator、context），Yakusha 负责翻译/校验/导出；不执行外部代码。
   也可以反向导出，让别人接自己的运行时。这相当于 ATT 的 Generic JSONL，但增加 locator。
2. **外部适配器进程（后做，可选）**：定义版本化的 stdin/stdout JSON 协议，外部程序实现
   detect/extract/apply；Yakusha 只编排、不信任。必须显式开启、限制路径、不联网、不默认执行；
   对外部适配器要求提交 conformance 报告，不能自动算“官方支持”。

这样长尾引擎可以由社区/用户自己接，不必进核心；但“官方支持列表”仍只认仓库内有 fixture、
有真实游戏验收的引擎。

### 4.7 字典与导出格式

0.10 的字典/导出格式已冻结，**现在不改**。多引擎需要提前想清楚 v2，但不要现在动：

- 字典继续以“原文”为 key，`entries` 不变；运行时插件只认这个形状。
- v2 可加可选的 `engine`、`locators`、`sourceLang` 等字段；旧运行时忽略未知字段，保证向后兼容。
- 导出文件同理：v1 的 `format/game/updatedAt/entries` 不变；v2 再加 `engine` 和 `locations`。
- 跨引擎 key 冲突不是主要问题（一个项目只属于一个引擎）；真正的问题是**同一原文在不同上下文
  需要不同译法**，这要靠 glossary/context，而不是改 key。
- 解析字典时继续防 `__proto__`/`constructor`；运行时查表用 `Object.create(null)` 或 `Map`。

## 5. 10+ 引擎清单与优先级

用户已确认第一批方向：**RPG Maker 全系 + Wolf + KRKR + Ren'Py + NScripter + SRPG Studio**。
这正好是 10 个，但应按家族归并，且运行时能力不同。

### 5.1 家族归并

| 家族 | 引擎 | 文本面 | 首选交付 | 真实难度 |
| --- | --- | --- | --- | --- |
| Maker JS | MZ、MV | `data/*.json` + JS 插件 | `plugin` | 已做到 L4，维护版本矩阵 |
| Maker RGSS | XP、VX、VX Ace | `Data/*.rxdata`（Ruby Marshal）+ 脚本 | `patch` 或 `inject` | 高：Ruby Marshal 解析 + RGSS hook/脚本注入 |
| Ren'Py | Ren'Py | `.rpy` 明文 / `.rpyc` 编译 | `translation-file` 或 `plugin` | 中：编译文件、翻译文件选择、UI 文本 |
| TJS 系 | KiriKiri | `.xp3` 归档 + `.ks`/`.tjs` | `patch` 或 `inject` | 高：归档格式/加密、脚本 hook |
| JS 视觉小说 | TyranoScript（可选） | `.ks` / `.js` | `plugin` 或 `patch` | 中：脚本结构相对简单，归档/编码要处理 |
| NScripter | NScripter | `.nscript` / `.nsa` | `patch` | 中：文本简单，归档和编码要处理 |
| Wolf RPG | Wolf RPG | `.wolf` 二进制 | `inject` 或 `patch` | 很高：无公开稳定格式，版本差异大 |
| SRPG Studio | SRPG Studio | 数据/脚本（需 spike） | `plugin` 或 `patch` | 中高：先做技术验证，别先承诺 |
| 可选现代 | Godot | `.pck` | `plugin`/`patch` | 中：作为第 11 个备选 |

### 5.2 建议顺序

1. **MZ/MV 保持第一**：已有真实游戏和插件运行时，先把版本矩阵、doctor、回滚做扎实。
2. **Ren'Py 第二**：文本是明文/编译脚本，运行时可用翻译文件或脚本注入；不需要原生 DLL，
   最容易验证“第二家族”的架构是否真的通用。
3. **RGSS 家族第三**：XP/VX/VX Ace 共享 Ruby Marshal 和 RGSS 运行时，一次覆盖 3 个；
   但运行时大概率是 patch 或 inject，必须先决定产品是否接受“改游戏文件/注入”。
4. **KRKR / NScripter 第四**：TJS/KAG 脚本和归档是日系游戏的大头；先做提取/补丁，
   运行时能力按实际 hook 结果标注。
5. **Wolf / SRPG Studio 第五**：Wolf 最难，放到后面；SRPG Studio 先做 spike，
   确认文本面和插件机制后再排期。
6. **Godot 作为备选**：Tyrano 可在 TJS 之后按 JS 系评估；两者都只在前面家族稳定后才考虑，不要为了凑数先上。

### 5.3 必须提前拍板的三个能力问题

- **RGSS（XP/VX/VX Ace）**：如果只能 patch/inject，是否接受？如果不接受，这三个就只能做
  “提取/导出/校验”，不能算运行时支持。
- **Wolf/KRKR**：是否接受分发原生注入组件？这会带来杀软误报、签名、崩溃恢复、反作弊/法律风险。
- **“可逆”承诺的边界**：patch 模式改的是游戏文件，即使有备份，也不再是“磁盘上只多一个插件”。
  是坚持“纯插件可逆”，还是把 patch 明确定义为“可卸载但有风险”的第二档？

## 6. 路线图建议

### 6.1 0.10.0：先收尾，不改契约

- 按 WP6 完成文档、版本号、grep 自检、`npm test`；
- 不为了多引擎改 0.10 的 JSON 信封、退出码、字典格式、export 格式；
- 把本文作为 0.10 之后的输入，不在 0.10 里动架构。

### 6.2 0.10.x：只拆缝，不改行为（建议命名为 `refactor/engine-seams`）

目标：让“新增引擎”从“改 10 个文件”变成“加一个家族目录 + profile + fixture”。

1. 把 RM 专属代码从 `src/core` / `src/pipeline` 迁到 `src/engines/rm/`：
   `mzproject`、`extract`、`fields`、`textkey`、`install`、plugin 模板。
2. 引入 `EngineProfile`，mz/mv 先迁移；adapter 只做编排。
3. 让 `rules` 真正生效：pipeline 从 profile 取 grammar/verify/prompt，不再硬编码。
4. registry 改成“候选打分 + `--engine` 覆盖”，保留现有错误码与文案兼容。
5. 所有命令统一走 adapter（或统一走 `ProjectSession`），消除“只覆盖一半命令”的裂缝。
6. 加第二个家族的最小夹具（建议 Ren'Py 的 detect/extract fixture，不急着做运行时）；
   加“误判用例”（其他引擎目录必须 not-project）。
7. 验收：现有 253+ 测试全绿、CLI JSON/退出码不变、MZ/MV 真实游戏回归通过。

这一步没有用户可见的新功能，但它是 10+ 的地基；不做这一步，后面的引擎都是分叉。

### 6.3 0.11–1.0：一个版本一个主家族

| 版本 | 建议内容 | 验收 |
| --- | --- | --- |
| 0.11 | Ren'Py L2/L3（提取/翻译/校验），运行时先做 L4 翻译文件；若 0.10.x 未完成拆缝，先补完 | 真实 Ren'Py 游戏 extract/verify；不承诺 attach |
| 0.12 | Ren'Py L4 + 通用内容导入/导出 v1；RGSS 提取（XP/VX/VX Ace） | 真实游戏运行时；导出/导入 round-trip |
| 0.13 | RGSS 交付（patch 或 inject）+ KRKR 提取（只到 L1–L3） | RGSS 可逆性/备份测试；版本矩阵 |
| 0.14 | NScripter（主）+ SRPG Studio（spike/提取，按结果决定是否运行时） | 至少 L4 或明确 L3 |
| 0.15 | Wolf（如果技术验证通过） | 真实游戏；注入/补丁安全评审 |
| 1.0 | 10 个引擎目标 + 能力矩阵 + 文档 + 便携 exe（Wolf 未通过则用备选补位） | 每个引擎有 L4 证据；不达标的标 experimental |

关于 0.11 的 GUI：现有计划把 GUI 放在 0.11。**如果 10+ 是硬目标，建议 GUI 后置，或只做
MZ/MV 的只读壳**，不要把 GUI 和多引擎同时塞进一个版本。GUI 的按钮应该由能力矩阵驱动，
这样它不会把 RM 假设固化；但它不能替代“第二家族”的架构验证。

每个版本以一个家族为主；其他家族最多做提取（L1–L3），不承诺运行时。

## 7. 质量门禁

每个新家族至少要有：

1. **Fixture**：最小项目 + golden 提取结果；不包含真实游戏内容/版权文本。
2. **契约测试**：detect 幂等、错误目录不抛、install/uninstall 可逆、launch 不接管进程、
   不支持的能力明确返回 not-implemented。
3. **真实游戏验收**：至少一款，记录引擎版本、文本覆盖率、不可解码率、运行时截图/日志
   （截图不入库，按现有规则放仓库外）。
4. **版本矩阵**：支持的引擎版本区间 + 测试过的版本；`doctor` 报未知版本。
5. **回滚测试**：安装后改游戏文件/插件顺序/更新游戏，`uninstall` 仍能还原或明确保留备份。
6. **安全测试**：路径穿越、符号链接、恶意归档、超大文件、编码炸弹、`__proto__`。
7. **性能预算**：scan/extract 在 5 万条文本上可接受；运行时查表单次 O(1)，启动解析不卡顿。
8. **文档**：能力矩阵、限制、已知不兼容版本；README 不把 experimental 写成 supported。

建议把能力矩阵做成一份仓库内的数据文件（如 `docs/engines.json` 或 profile 导出），
文档和 GUI 都从它生成，避免“文档说支持、代码没做”。

## 8. 不做什么 / 风险

- **不追 20+ 引擎**：10–12 个足够；每多一个都是版本矩阵、测试、法律和注入风险。
- **不在第一波做 Unity/Unreal**：它们需要 IL2CPP/资源包/注入/反作弊，和 Maker/Ren'Py 不是同一类问题；
  等 10 个稳定后再评估。
- **不支持在线/反作弊游戏**：不绕过保护、不注入在线进程；这是产品边界，不是技术限制。
- **不把 patch 做成默认**：Yakusha 的身份是“运行时翻译”，不是“通用文件替换器”；
  patch 只是没有运行时钩子时的降级。
- **不把引擎特判写进 pipeline**：新引擎只实现 profile/provider/grammar/delivery；
  pipeline 出现 `if (engine === ...)` 就是设计错误。
- **不静默降级**：插件失败不能自动改 patch；必须显式确认并写进日志/JSON。
- **不复制他人代码**：AGPL/源码可见/无许可证的项目只借鉴架构；GPL 兼容性单独评审。
- **不加运行时依赖、不抬高 Node 下限**：外部适配器/原生组件单独分发，核心保持零依赖。
- **不让外部适配器默认执行**：内容导入优先；进程协议必须显式开启、沙箱化、可审计。
- **不把“检测到”当“支持”**：L0 不等于 L4；文档和 CLI 都要诚实。

## 9. 需要拍板的事项

1. **RGSS 的运行时**：接受 patch/inject，还是只做提取/导出？（影响 XP/VX/VX Ace 是否算“支持”）
2. **Wolf/KRKR 的原生组件**：是否愿意分发注入器？如何做签名、崩溃恢复、杀软误报说明？
3. **GUI 与引擎的优先级**：0.11 先 GUI，还是先 Ren'Py + 拆缝？两者只能选一个作为主目标。
4. **外部适配器政策**：只做内容导入，还是也允许本地进程协议？如果允许，谁来审核 conformance？
5. **字典/导出 v2 的时间**：0.12 还是 1.0？v2 必须向后兼容，旧运行时不能坏。
6. **目标语言**：仍以日→中为主，还是 1.0 前支持任意源/目标？这会影响 grammar 和验证规则。

## 10. 参考与证据

- Yakusha 现有架构：[architecture.md](../architecture.md)、[engines.md](../engines.md)、
  [limitations.md](../limitations.md)、[json-contract.md](../json-contract.md)
- 当前实现：[src/engines/adapter.js](../../src/engines/adapter.js)、
  [src/engines/registry.js](../../src/engines/registry.js)、
  [bin/yakusha.js](../../bin/yakusha.js)
- ATT：<https://github.com/yexi-by/att>（AGPL-3.0；重点看 `docs/rpg-maker/`、`docs/generic/jsonl.md`、
  `docs/generic/adapter-verification.md`）
- GameStringer：<https://github.com/rouges78/GameStringer>（源码可见许可；重点看
  `src-tauri/src/engine_detector.rs`、`src-tauri/src/commands/universal_injector.rs`、
  `docs/ENGINE-COVERAGE.md`、`docs/PLUGIN_SYSTEM.md`）
- fkiliver：<https://github.com/fkiliver/RPGMaker_LLM_Translator>（未声明 LICENSE；重点看
  `README.md`、`api.py`、`llm.py`）

> 再次提醒：本文是内部战略稿。真正改代码前，先按 0.10 的五篇冻结文档确认哪些是契约、
> 哪些只是实现细节；不要把“建议”直接当成“已批准的契约变更”。
