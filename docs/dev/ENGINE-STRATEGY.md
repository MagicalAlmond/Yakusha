# 多引擎路线与开发指导（0.10 之后）

> 内部战略稿，不是冻结契约。基于 2026-10-25 的主干代码、[architecture.md](../architecture.md)、
> [engines.md](../engines.md) 与对三个开源项目的调研。落地前仍需按 [json-contract.md](../json-contract.md)
> 的契约变更流程评审；本文只回答“10+ 引擎该怎么加，才不会把现在的代码拆掉重写”。
>
> 本轮已按用户拍板（2026-10-25）改写第 0、1.2、4、5、6、8、9 节：原生组件要做并按引擎下载、
> 外部适配器不做、GUI 后移到 0.14、Ren'Py 覆盖 `.rpyc`、先 RGSS 注入再字典导出再 GUI、
> “可逆/零依赖”不再作为差异化卖点。已拍板项见 9.1，仍待拍板项见 9.2，签名成本见 9.3，
> 不签名的真实后果见 9.4。

## 0. 结论摘要

1. **Yakusha 的差异化不是“引擎更多”，也不是“可逆、零依赖”。**（这两条已从卖点里删掉：
   一旦做 RGSS/Wolf/KRKR 注入，它们本来也不再成立。）真正的差异化是**“可验证、可脚本化的
   翻译流水线（CLI + 严格 JSON + 库门面），加上按引擎分档、诚实标注的运行时交付（含原生注入）”**。
   引擎数量是必要条件，不是卖点本身；10+ 引擎必须建立在同一套内容模型和交付模型上。
   产品形态是“一键”：用户在 GUI 里把游戏 exe 拖进来，识别引擎 → 启动游戏 → 按能力矩阵
   加载译文（MZ/MV 插件、Ren'Py 翻译资源、RGSS 注入），不要求用户理解插件/注入/补丁的区别。
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
| L4 | 运行时交付 | 按 5.5 的四档之一（plugin / resource / inject / patch）真实显示译文 |
| L5 | 生命周期 | `doctor` 能诊断、能卸载到原版可运行、版本升级后能解释失败 |

只有达到 L4、且 L5 的卸载验证通过，才在 README / 能力矩阵里写“支持”；L1–L3 只能写“实验性”。
交付方式不要求“可逆”——inject 档只要**不改游戏文件、卸载后游戏照常跑**就算达标；
patch 档只要**有备份、能还原、失败可回滚**就算达标。这条规则要写进每个引擎的 PR 模板和
`docs/games.md`。

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

**可借鉴（已按拍板裁剪）：**

- 把“内容协议”和“引擎实现”分开：通用 JSONL / 通用内容模型可以承接长尾，核心不必为每个格式加代码。
  → **采纳**，但只做文件型导入（见 4.6）。
- 外部适配器必须有验证报告和明确的职责边界。
  → **不采纳**：外部适配器进程整条砍掉，这条经验只保留为“导入内容必须标来源与可信度”。
- 独立输出目录 + 原游戏不动，是比“直接改游戏文件”更稳的发布模型。
  → **部分采纳**：inject 档不改游戏文件；patch 档必须备份 + 可还原。

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
    modes: ["translation-file"], // plugin | translation-file | debug | inject | patch | none
    default: "translation-file",
    native: null, // 需要原生组件时填 { id, arch: ["x86","x64"], versions, download }
  },
  deliveryTier: "L4-resource", // L4-plugin | L4-resource | L4-inject | L4-patch | L3-only

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
- `deliveryTier` 是给用户看的档位（见 5.5），`runtime.native` 是给安装器看的：
  有 native 的引擎必须先 `native install` 才能开 L4，缺组件时明确报错，不降级。
- 不再有全局 `reversible` 布尔；可逆性是每档交付的**属性**，不是引擎的属性。

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

| 模式 | 机制 | 适用 | 卸载后 | 风险 |
| --- | --- | --- | --- | --- |
| `plugin` | 往游戏里加脚本/插件，运行时查字典 | MZ/MV、部分 JS 引擎 | 删文件即逐字节还原 | 低 |
| `translation-file` | 使用引擎自带的翻译/本地化资源机制，生成或替换资源 | Ren'Py 等 | 删资源即恢复 | 低 |
| `debug` | 启动调试端口，CDP/协议注入钩子 | NW.js/Electron/Chromium 系 | 退出即恢复 | 中 |
| `inject` | 原生 DLL/注入器 + 引擎 hook | RGSS、KRKR、Wolf、SRPG（视 spike） | 退出/卸载即恢复，游戏文件不改 | 高 |
| `patch` | 直接改数据/脚本/归档，备份后写回 | 没有运行时钩子的引擎 | 备份可还原，但文件已被改 | 中高 |
| `none` | 只提取/导出，不交付 | 长尾/仅做翻译资产 | 不适用 | 低 |

要求：

- adapter 必须声明 `runtime.modes` 和 `reversible`；CLI/GUI 只展示声明过的能力，不能“点了才报错”。
- 默认模式尽量选 `plugin`；`patch` 必须显式 `--patch`，并且先备份、后校验、可卸载。
- `inject` 单独分发原生组件（见 4.8），**不随主包默认捆绑**；不支持在线/反作弊游戏；
  崩溃恢复、detach、失败回退要写进设计。
- 不允许“插件失败就静默改成 patch”；降级必须用户确认，日志/JSON 要写清楚用了哪种模式。
- **原生组件只对“确实需要”的家族做**（RGSS、KRKR、Wolf、SRPG Studio 视 spike 结果），
  MZ/MV、Ren'Py、NScripter 优先走 plugin / translation-file / patch，不为统一而统一。

### 4.6 通用内容协议：只做内容导入，不做外部适配器进程

这是 10+ 引擎能否可持续的关键。用户已拍板（2026-10-25）：

1. **通用内容导入/导出（做）**：外部工具把任意引擎的文本导出成 Yakusha 的 JSON/JSONL
   （key、text、locator、context），Yakusha 负责翻译/校验/导出；不执行外部代码。
   也可以反向导出，让别人接自己的运行时。这相当于 ATT 的 Generic JSONL，但增加 locator。
   注意：**这不等于“支持某引擎”**。导入的文本没有 fixture、没有真实游戏验收，只能标
   `imported`/`experimental`，不能进官方支持列表。
2. **外部适配器进程（不做）**：原方案里“版本化 stdin/stdout JSON 协议、第三方程序实现
   detect/extract/apply”整条砍掉。理由：要执行第三方 exe、要审核 conformance、要处理路径/网络/
   权限，风险与维护成本都不对等；同样的需求用文件型导入就能覆盖九成。
   将来如果真要放开，必须是新的冻结决策，不能由某个引擎的实现顺手带进来。

结论：引擎支持只有一条路——**进仓库、带 fixture、带真实游戏验收**；长尾需求走文件型导入。

### 4.7 字典与导出格式

0.10 的字典/导出格式已冻结，**现在不改**。多引擎需要提前想清楚 v2，但不要现在动：

- 字典继续以“原文”为 key，`entries` 不变；运行时插件只认这个形状。
- v2 可加可选的 `engine`、`locators`、`sourceLang` 等字段；旧运行时忽略未知字段，保证向后兼容。
- 导出文件同理：v1 的 `format/game/updatedAt/entries` 不变；v2 再加 `engine` 和 `locations`。
- 跨引擎 key 冲突不是主要问题（一个项目只属于一个引擎）；真正的问题是**同一原文在不同上下文
  需要不同译法**，这要靠 glossary/context，而不是改 key。
- 解析字典时继续防 `__proto__`/`constructor`；运行时查表用 `Object.create(null)` 或 `Map`。

### 4.8 原生组件：按引擎下载与分发

用户已拍板：**原生注入组件要做，且按引擎下载**，不把一堆 DLL 塞进主包。落地方式：

- **目录与清单**：仓库内只放 manifest（引擎、位数、版本区间、组件 id、sha256、下载地址、
  许可证、是否需要管理员），不放二进制。仓库里放二进制会撑爆 git 历史、触发杀软误报、
  也让 GPL 源码包与二进制版本脱节。
- **按需获取**：`yakusha native install <engine>`（名字待定，属新命令，需走契约评审）
  按 manifest 下载到 `%LOCALAPPDATA%\yakusha\native\<engine>\<arch>\`，
  校验 sha256，写入后可 `native verify`/`native remove`。离线用户走同版本的离线包
  （一个 zip，含同样 manifest 与二进制），两条路径产物必须一致。
- **按引擎粒度**：MZ/MV、Ren'Py、NScripter 不需要；RGSS、KRKR、Wolf、SRPG Studio 需要。
  GUI 的“一键”只在组件已就位时可用；缺组件时提示下载，**不静默降级成 patch**。
- **签名与信誉**：原生组件与主程序都要 Authenticode 签名（详见第 9 节签名条目）；
  未签名 exe 会触发 SmartScreen“未知发布者”，注入器还会被 AV 启发式命中。
  发布流程里要有“签名 → 校验签名 → 上传 → 更新 manifest”的顺序，manifest 的 sha256
  在签名之后计算，否则校验必失败。
- **失败路径**：下载失败/校验失败/被杀软隔离/引擎版本不匹配，都必须给出可操作的错误码
  （沿用 0.10 的 `E_*` 体系，新增码需评审），并且游戏保持未修改状态。

## 5. 10+ 引擎清单与优先级

用户已确认第一批方向：**RPG Maker 全系 + Wolf + KRKR + Ren'Py + NScripter + SRPG Studio**。
这正好是 10 个，但应按家族归并，且运行时能力不同。

### 5.1 家族归并

| 家族 | 引擎 | 文本面 | 首选交付 | 真实难度 |
| --- | --- | --- | --- | --- |
| Maker JS | MZ、MV | `data/*.json` + JS 插件 | `plugin` | 已做到 L4，维护版本矩阵 |
| Maker RGSS | XP、VX、VX Ace | `Data/*.rxdata`（Ruby Marshal）+ 脚本 | `inject`（原生 helper，已拍板） | 高：Ruby Marshal 解析 + RGSS hook + 原生组件分发/签名 |
| Ren'Py | Ren'Py | `.rpy` 明文 + `.rpyc` 编译（**两者都要**） | `translation-file` | 中：编译文件解析、翻译资源合并、UI 文本 |
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
   交付方式已拍板为 **inject + 原生 helper**（见 4.8 与 5.4），因此它同时也是“原生组件
   分发/签名/崩溃恢复”这套基础设施的第一个真实用户。
4. **KRKR / NScripter 第四**：TJS/KAG 脚本和归档是日系游戏的大头；KRKR 走 inject（原生组件
   第二个用户），NScripter 先做文件型 patch，不引进原生代码。
5. **Wolf / SRPG Studio 第五**：Wolf 最难，放到后面；SRPG Studio 先做 spike，
   确认文本面和插件机制后再排期。
6. **Godot 作为备选**：Tyrano 可在 TJS 之后按 JS 系评估；两者都只在前面家族稳定后才考虑，不要为了凑数先上。

### 5.3 原先的三个能力问题（已拍板）

- **RGSS（XP/VX/VX Ace）**：接受 inject，不做“只提取/导出”。所以这 3 个引擎的 L4 依赖原生组件。
- **Wolf/KRKR**：接受分发原生注入组件；相应承担杀软误报、签名、崩溃恢复、反作弊/法律风险，
  并通过“按引擎下载 + 签名 + 明确风险说明”控制。
- **“可逆”的边界**：不再把“可逆”当卖点。分档说明：plugin = 逐字节可还原；
  translation-file = 删资源即恢复；inject = 退出/卸载后进程恢复，不改游戏文件；
  patch = 有备份但文件已被改。用户只需要知道“删掉 Yakusha 的痕迹后游戏能不能照常跑”，
  不需要被“可逆”这个词绑架。

### 5.4 什么是“RGSS inject + 原生 helper”

用大白话说，RGSS 引擎（XP/VX/VX Ace）的文本不像 MZ 那样躺在 JSON 里，它是被 Ruby 脚本
在运行时算出来再画到屏幕上的。所以有两个办法让屏幕显示中文：

1. **inject（注入）**：Yakusha 启动游戏时，先把自己的一个 DLL 塞进 Game.exe 进程，等游戏
   加载完、准备画字的时候，把“这句话”换成译文再交回去。游戏文件一个字节都不改，
   Yakusha 关掉后游戏就是原版。
2. **原生 helper**：那个 DLL 和负责塞进去的加载器，是 C/C++/Rust 写的原生程序，
   不是 Node 代码，也不能用 Node 写（Node 进不了别人的进程）。它单独下载、单独签名、
   按引擎和位数分发，通过一个版本化的管道/共享内存跟 Yakusha 主进程通信。

为什么值得做：它一次覆盖 XP/VX/VX Ace（同一套 Ruby 运行时和绘图入口），而且是唯一能同时
满足“不改游戏文件”“能覆盖脚本算出来的文本”的交付方式。

代价（必须在文档和 GUI 里写清楚，不能藏）：

- **位数与版本矩阵**：32 位游戏要 32 位 helper，64 位要 64 位；不同 RGSS 版本/加密壳
  （RGSSAD/RGSS2A/RGSS3A）行为不同，要逐版本测。
- **杀软与 SmartScreen**：注入行为本身就会被启发式盯上；必须签名、必须能解释“我们在做什么”。
- **崩溃隔离**：helper 崩了要能让游戏活着退出，而不是黑屏；要有超时、心跳、失败即 detach。
- **法律与边界**：只做单机、离线、不绕过 DRM、不进在线/反作弊进程；EULA 风险要写在
  limitations 里，不能只写在内部文档。

### 5.5 交付分档（对外就按这个说）

| 档 | 含义 | 例子 |
| --- | --- | --- |
| L4-plugin | 加插件即可，删文件即还原 | MZ、MV |
| L4-resource | 生成/替换引擎自带的翻译资源 | Ren'Py |
| L4-inject | 需要下载原生组件，启动时注入 | RGSS、KRKR |
| L3-only | 只能提取/翻译/校验，交付靠用户自己 | 未做运行时的家族 |

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
7. 定义原生组件的 manifest 数据结构与校验逻辑（只有数据和校验，不下载、不注入），
   让 0.12 直接接上，不用临时设计。
8. 验收：现有测试全绿、CLI JSON/退出码不变、MZ/MV 真实游戏回归通过。

这一步没有用户可见的新功能，但它是 10+ 的地基；不做这一步，后面的引擎都是分叉。

### 6.3 0.11–1.0：一个版本一个主家族（已按拍板重排）

用户拍板的顺序：**先把 RGSS inject + 原生 helper 做出来，再做字典导出，最后做 GUI**；
验收通过后才进 1.0。Ren'Py 提到最前面，因为它是“不需要原生的第二家族”验证。

| 版本 | 主目标 | 附带 | 验收 |
| --- | --- | --- | --- |
| 0.10.0 | 收尾（WP6） | — | 文档/版本号/测试全绿 |
| 0.10.x | 拆缝 `refactor/engine-seams` | Ren'Py detect/extract fixture | 现有测试全绿、CLI 契约不变 |
| 0.11 | Ren'Py L2–L4：`.rpy` + `.rpyc`、translation-file 交付 | 通用内容导入 v1（文件型） | 真实 Ren'Py 游戏 extract/translate/verify/运行时；`.rpyc` 覆盖率有数字 |
| 0.12 | RGSS inject + 原生 helper（XP/VX/VX Ace） | 原生组件分发/签名/manifest 基础设施 | 真实游戏注入成功、卸载后原版可跑、崩溃隔离验证、版本矩阵 |
| 0.13 | 字典导出（TSV/CSV + 字典 v2） | KRKR 提取（L1–L3） | round-trip；v2 向后兼容；旧运行时不受影响 |
| 0.14 | GUI（Electron）：拖 exe → 识别 → 启动 → 按能力矩阵加载译文 | NScripter 提取/补丁 | GUI 验收通过；MZ/MV + Ren'Py + RGSS 三条链路都能一键跑通 |
| 0.15 | KRKR inject（第二个原生组件）+ Wolf/SRPG spike | 能力矩阵/兼容性数据 | 原生组件复用同一套分发与签名流程 |
| 1.0 | 10 个引擎目标 + 能力矩阵 + 便携 exe | — | 每个引擎有 L4 证据；不达标的明确标 experimental |

说明：

- **0.11 必须先做 Ren'Py**，否则 0.12 的 RGSS 会变成“在 RM 假设上再焊一层”，第二家族
  的抽象永远没被验证过。若 0.10.x 拆缝没做完，0.11 先补完再开工。
- **0.12 是风险最高的一版**：原生组件、注入、签名、杀软、崩溃隔离全在这一版第一次落地。
  它的验收标准不是“能跑”，而是“失败时游戏不坏、用户看得懂、能卸载干净”。
- **0.13 的字典导出按用户要求放在 RGSS 之后**：先证明运行时交付能覆盖三种模式，
  再决定字典/导出 v2 的字段（可能要多存 `engine`、`locator`），避免刚定完就返工。
- **0.14 的 GUI 才谈“一键”**：拖 exe 进窗口 → 识别引擎 → 启动游戏 → 按能力矩阵加载译文。
  在 0.14 之前，CLI 已经能完成同样的链路，只是要敲命令；GUI 不是能力，是包装。
- **GUI 是独立迭代**：0.14 只做 GUI 与它需要的接口（能力矩阵、原生组件安装向导、进度/错误展示），
  不夹带新引擎。0.14 验收通过后就算“GUI 完成”，不再在 GUI 上叠加多引擎适配。
  1.0 之前只剩 0.15 把第 10 个引擎（KRKR）补齐并复用同一套签名/分发流程；
  如果决定把 KRKR 推到 1.0 之后，则 0.14 验收完可以直接进 1.0。
- 每个版本以一个家族为主；其他家族最多做提取（L1–L3），不承诺运行时。

## 7. 质量门禁

每个新家族至少要有：

1. **Fixture**：最小项目 + golden 提取结果；不包含真实游戏内容/版权文本。
2. **契约测试**：detect 幂等、错误目录不抛、install/uninstall 能回到原版可运行状态、
   launch 不接管进程、不支持的能力明确返回 not-implemented。
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
- **不加运行时依赖、不抬高 Node 下限**：原生组件/外部工具单独分发，核心 JS 仍只用标准库。
  （注意：这不等于“整个产品零依赖”——GUI 阶段会引入 Electron 等，属于主程序之外的取舍。）
- **不做外部适配器进程**：已拍板砍掉；长尾引擎走文件型内容导入，不做 stdin/stdout 协议。
- **不把原生组件塞进主包**：按引擎下载 + manifest + sha256 + 签名；主包保持轻。
- **不把“检测到”当“支持”**：L0 不等于 L4；文档和 CLI 都要诚实。
- **不把“可逆/零依赖”当卖点**：这两条已从定位里删除。对外只说“四种交付档 + 每档的实际影响”。

## 9. 已拍板与仍需拍板

### 9.1 已拍板（2026-10-25）

| # | 事项 | 决定 |
| --- | --- | --- |
| 1 | RGSS 运行时 | 接受 **inject + 原生 helper** |
| 2 | Wolf/KRKR 原生组件 | 分发注入器；**按引擎下载**，签名、崩溃恢复、风险说明都要做 |
| 3 | GUI 优先级 | **后移到 0.14**；0.11 先 Ren'Py，0.12 RGSS，0.13 字典导出 |
| 4 | 外部适配器 | **不做**；长尾走文件型内容导入 |
| 5 | Ren'Py 范围 | **.rpy 与 .rpyc 都要** |
| 6 | 字典导出 | 保留 JSON export；TSV/CSV 与字典 v2 **后移到 0.13** |
| 7 | 多语言 | 先 ja→zh；en→ja 暂不考虑；少量 en→zh 实验 |
| 8 | “一键”定义 | GUI 拖 exe → 识别 → 启动 → 按能力矩阵加载译文 |
| 9 | 卖点 | **删除“可逆、零依赖”**，不再作为差异化 |

### 9.2 仍需拍板

1. **原生组件的托管与分发渠道**：GitHub Release 直链 + manifest，还是要对象存储/CDN？
   前者简单但下载慢、易被墙；后者要账号、要成本、要防滥用。
2. **Windows 代码签名路线**（详见 9.3）：走商业 CA OV/EV，还是先做组织实体再上 Azure
   Artifact Signing（原 Trusted Signing）？这决定首发是否有 SmartScreen 警告。
3. **RGSS 三个版本的验收基线**：XP（RGSS1）/VX（RGSS2）/VX Ace（RGSS3）各要几款真实游戏
   才敢标 supported？这决定 0.12 的工作量。
4. **0.13 字典 v2 的字段**：是否引入 `engine`/`locator`；一旦发布就要永久向后兼容。
5. **实验语言（en→zh）什么时候进**：0.13 附带，还是 1.0 之后再动。
6. **0.10 WP 收尾时间点**：WP5 合并、WP6 文档与 0.10.0 版本号何时执行。

### 9.3 Windows 代码签名的实际工作与成本

事实（官方口径）：

- **Azure Artifact Signing（原名 Trusted Signing）**：Basic **US$9.99/月**，含 5,000 次签名；
  Premium **US$99.99/月**，含 100,000 次；超额 **US$0.005/次**——对个人/小团队来说钱不是门槛。
  真正的门槛是**资格**：Public Trust 的组织必须注册在 美国/加拿大/欧盟/英国/澳大利亚/新西兰/
  日本/韩国/新加坡/瑞士/挪威/以色列；**个人开发者只限美国或加拿大**。
  也就是说，如果以中国大陆个人身份申请，**拿不到 Public Trust 证书**（Private Trust 无地域限制，
  但不能用于公开分发）。
- **商业 CA 的 OV/EV 代码签名证书**：约 **US$200–700/年**（各家报价与渠道差异大，需询价），
  通常还要硬件 token/HSM，且需要企业或个人身份验证。中国主体可以走这条，但流程更长。
- **签名本身的技术工作**：Windows SDK 的 `signtool`，必须 `/fd SHA256` + `/td SHA256` 并
  打时间戳；CI 里要安全保存证书/密钥（PFX + 密码走 secret，或用云签名服务的 OIDC）。
- **SmartScreen**：签名解决“未知发布者”和“信誉能不能继承”，但**新证书仍需累积信誉**，早期仍可能弹警告。
  注意：微软官方已明确 **EV 证书不再豁免 SmartScreen**（原文 “EV certificates no longer bypass
  SmartScreen… paying a premium for EV solely to avoid SmartScreen warnings is no longer justified”），
  所以为“少弹窗”而买 EV 是不划算的，买 OV 即可满足签名与信誉继承的需要。未签名 = 默认被拦，
  且注入器更容易被 AV 误杀。

工作量与时间（经验估算，不是官方承诺）：

| 事项 | 一次投入 | 说明 |
| --- | --- | --- |
| 商业 CA 采购 + 身份验证 + 收 token | 1–3 周 | 依赖 CA 审核与物流；有加急选项 |
| 或：Azure 账号/Entra 租户/身份验证/证书 profile | 1–2 周 | 需合格注册地；身份验证只能在 Azure 门户做 |
| CI 接入签名（含时间戳、secret 管理） | 2–4 天 | 首个流水线；之后复用 |
| 每新增一个原生组件接同一流水线 | 1–2 天 | 改 manifest + 校验脚本 |
| SmartScreen 信誉爬坡 | 数周–数月 | 不受控，只能靠下载量/时间 |
| 年度续期/密钥轮换 | 约 1 天/年 | 别忘了 manifest 里的 sha256 要重算 |

结论建议：**签名这件事不贵但要早启动**——它的关键路径是身份/资格审核（周级），不是技术。
0.12 要做 RGSS 注入，签名必须在 0.12 之前就绪；如果首发不做签名，就要在 README 和 GUI 里
明说“未签名，可能出现 SmartScreen/杀软提示”，不能装作没有这回事。

### 9.4 不做代码签名会怎样（四道拦截，不是“跳一次警告”）

常见误解是“未签名顶多弹一次警告，用户点一下就过”。实际是按环境分四道，越往后越硬。
依据：[SmartScreen 信誉官方说明](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)、
[Smart App Control 官方说明](https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/overview)。

| 层 | 触发条件 | 用户看到什么 | 能不能绕过 |
| --- | --- | --- | --- |
| 1. SmartScreen | 从网络下载的 exe/msi，哈希无信誉 | “Windows 已保护你的电脑”，需点“仍要运行” | 能，但**每次发新版本都要重来** |
| 2. 浏览器下载拦截 | Chrome/Edge 判定“不常下载的文件” | “此文件可能有危险”，需手动保留 | 能，多两步点击 |
| 3. 企业/学校策略 | 组策略把 SmartScreen 设为“阻止” | 直接被挡住，没有“仍要运行”按钮 | 不能，要 IT 放行 |
| 4. Smart App Control（Win11） | 系统处于 enforcement 模式 | 应用**无法运行**，**没有“仍要运行”**按钮 | 不能，只能关 SAC |

第 1 层为什么“每次都要重来”是官方原话：`Reputation cannot transfer from previous versions
unless both were signed using the same publisher identity`、`Unsigned files must build reputation
anew with every update`。也就是说：**未签名的文件，每发一版信誉归零**；签了名且用同一张证书，
新旧版本的发布者信誉可以继承。所以未签名不是“一次性摩擦”，而是**每个版本、每个用户都摩擦一次**。
官方给的爬坡量级是 “several weeks and hundreds of clean installs from a wide audience”，
且没有公开阈值、没有人工加白入口。

第 4 层最致命，因为它**没有“仍要运行”按钮**：Smart App Control 的 enforcement 模式只允许
“有把握是安全的”或“用受信任 CA 证书签名的”程序，默认拦截 malware、PUA 和
**unknown, unsigned code**；而且它检查所有可执行文件，不限于“从网上下载的”。更麻烦的是
SAC 在“干净安装”的 Win11 上默认是评估/开启状态，**用户关掉之后通常要重装系统才能再开**，
所以“让用户关掉 SAC”不能当常规解法（近期有 KB 在改这条限制，但不能指望用户去折腾）。

对 Yakusha 的具体含义，按阶段分：

- **0.10–0.11（纯 JS）几乎不受影响**：用户跑的是官方签名过的 `node.exe`，
  `bin/yakusha.js` / `src/**` 是脚本而不是可执行文件，SmartScreen 与 SAC 都不针对它们；
  这一阶段不签名也不会挡住用户。
- **0.12 起（原生 helper + injector.exe）风险陡增**：注入器本身就是典型的
  “unknown unsigned code”，是第 1/3/4 层拦截的典型对象；hook DLL 做的“往别的进程写代码”
  与恶意软件技术重合，Defender/第三方杀软的启发式误报率显著高于普通 CLI。
- **1.0（便携 exe）必须有签名**：单文件 exe 是最容易被拦的形态，没有签名等于把安装失败
  写在脸上。

因此结论不变但更明确：**不是“要不要签名”，而是“什么时候必须签”**。可行策略是
0.10/0.11 先不签（把预算和身份审核留到需要时），0.12 之前 1–2 个月启动证书申请——
关键路径是身份/资格审核，不是技术接入。若 0.12 赶不上，就必须在 README 与 GUI 里显式
标注“未签名”，并在 GUI 里给一条“被拦了怎么办”的说明，而不是假装没有这回事。

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
- Windows 签名（第 9.3 节的事实来源）：
  <https://learn.microsoft.com/azure/trusted-signing/how-to-change-sku>（SKU 与价格）、
  <https://learn.microsoft.com/azure/trusted-signing/quickstart>（Public Trust 资格与身份验证）、
  <https://learn.microsoft.com/windows/win32/seccrypto/signtool>（`/fd`/`/td` 与时间戳）

> 再次提醒：本文是内部战略稿。真正改代码前，先按 0.10 的五篇冻结文档确认哪些是契约、
> 哪些只是实现细节；不要把“建议”直接当成“已批准的契约变更”。
