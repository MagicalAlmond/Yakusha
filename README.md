# Yakusha

**非侵入式游戏运行时翻译工具，支持 RPG Maker MZ / MV 与 Ren'Py。**

把游戏文本抽出来交给任意 LLM 翻译，再让游戏**在运行时**显示中文。当前覆盖两档交付：

- **插件档（MZ / MV）**：游戏目录只多一个插件文件、`js/plugins.js` 里多一行注册，
  `uninstall` 会把这两处还原到安装前。
- **translation 档（Ren'Py）**：`install` 在 `game/` 下生成一个
  `yakusha_translation.rpy`，用引擎自己的 `translate <lang> strings:` 块替换源文；
  游戏脚本一个字节都不改，`uninstall` 只删这一个文件。

每一档对游戏文件的实际影响写在该档的文档里（[docs/limitations.md](docs/limitations.md)、
[docs/engines.md](docs/engines.md)），没有"整个产品都绝对可逆"的说法。

```
scan  →  extract  →  translate  →  install
看有多少   建字典      LLM 填译文    装进游戏
```

运行时效果不在仓库里放截图；支持范围、匿名实测数据与编号见 [docs/games.md](docs/games.md)。

## 安装

```bash
git clone https://github.com/MagicalAlmond/Yakusha
cd Yakusha
node --version   # 需要 22 或更高
npm test         # 全部测试，应该全绿
```

CLI 只用 Node 标准库，没有第三方运行时依赖（`package.json` 也没有 `dependencies`）；
将来 GUI 迭代会引入 Electron，那是外壳的成本，不影响 CLI。

## 五步上手

以游戏目录 `/games/MyGame` 为例。

### 1. scan：看有多少文本

```bash
node bin/yakusha.js scan "/games/MyGame"
```

RPG Maker 数 `data/` 里的数据文件，Ren'Py 数 `game/` 下的脚本，所以中段两行不一样：

```
game      : Example Game
root      : /games/MyGame
engine    : mz 1.7.0
data files: 51
strings   : 38044 unique / 80502 total
```

```
game      : Example Game
root      : /games/MyGame
engine    : renpy 1.0
scripts   : 2
strings   : 6 unique / 6 total
w/ codes  : 0
encodings : rpy 2, rpyc 0
```

两块都是摘录：MZ 那块只留到 `strings`，Ren'Py 那块省掉了末尾的逐文件计数。
`encodings` 只在解出多种格式时才打印（MZ/MV 只有 JSON，所以没有这行），它是解出的
`.rpy` 与 `.rpyc` 个数；同一个 stem 两种文件都在时只读 `.rpy`，所以 `rpyc` 会是 0。
解不开的脚本记进 `undecodable` 并继续跑，不会中断。

### 2. extract：建字典

```bash
node bin/yakusha.js extract "/games/MyGame"
```

在 `/games/MyGame/yakusha/dictionary.json` 生成一份**空译文**的字典，每个 key 都带它出现的
位置（MZ/MV 是 `Map029.json:401`、`System.json:terms.commands[]`……数组字段带 `[]` 后缀；
Ren'Py 是 `game/script.rpy:12` 这样的相对项目根路径加行号）。重复执行会合并，不覆盖已有译文。

### 3. translate：翻译

任意 OpenAI 兼容端点都能用（OpenAI、DeepSeek、OpenRouter、Ollama、LM Studio、vLLM…）。

```bash
export YAKUSHA_API_KEY=sk-...
export YAKUSHA_MODEL=deepseek-chat
export YAKUSHA_BASE_URL=https://api.deepseek.com/v1

node bin/yakusha.js translate "/games/MyGame" --provider openai --concurrency 4
```

没有默认模型：provider、model 和 key 都必须显式配置，缺任何一项会在发请求前报
`E_CONFIG`（0.10 起；`--dry-run` / `--provider mock` 不需要配置）。

真实端点下的耗时取决于模型、并发和限流，仓库不承诺固定吞吐数字：`translate` 一次请求的成本主要在排队，
3.8 万条这种量级请按「跑一整晚」估算。能调的是 `--batch-size`（默认 40 条/批）和
`--concurrency`（默认 2 条批并发），各款游戏的条数与 verify/doctor 耗时实测见
[docs/dev/DEVLOG.md](docs/dev/DEVLOG.md) §6。

**流水线不信任模型。** 每条译文都要过五道校验才会写进字典：转义码序列、`%1` 占位符、
换行数、长度比（0.12x–4x）、`U+FFFD`。不合格会重试一次，仍不合格就**记为未翻译并留下
error 原因**，绝不写假译文。每 200 条自动落盘，中断可续跑。

### 4. install：装进游戏

```bash
node bin/yakusha.js install "/games/MyGame"
```

**MZ / MV** 只做三件事：备份 `js/plugins.js`、在 `$plugins` 末尾加一条
`YAKUSHA_Translator`、写入 `js/plugins/YAKUSHA_Translator.js`。启动游戏，中文就出来了。

```bash
node bin/yakusha.js uninstall "/games/MyGame"   # 摘掉插件那一行并还原 plugins.js
```

装好之后如果 `plugins.js` 又被改过（游戏更新、另装插件、编辑器存过档），`uninstall`
**不会**拿旧备份盖掉这些改动，只摘掉自己那条、把备份留在原地给你核对。
细节见 [docs/design.md](docs/design.md)。

**Ren'Py** 只写一个文件：`game/yakusha_translation.rpy`。它内含 `translate schinese strings:`
块，每条把字典里的原文映射到译文；游戏自己的脚本、`options.rpy` 一个字节都不改。

```
translation: /games/MyGame/game/yakusha_translation.rpy
strings    : 6 (schinese)
uninstall  : yakusha uninstall "/games/MyGame"
```

`uninstall` 就是删掉这一个文件，游戏随即读回原版文本。字典里还没有任何译文时
`install` 会直接拒绝（`E_NO_DICTIONARY`，提示先跑 `translate`），不会写出空翻译文件。
命令行没有选语言的入口，这一版固定投 `schinese`；文件里还会加一段
`if config.default_language is None` 的守卫，不覆盖玩家自己在设置里选的语言。

### 5. verify / doctor：自检

```bash
node bin/yakusha.js verify "/games/MyGame"
```

字典会被逐条体检，只读不写。`error` 让命令失败退出（`echo`、转义码、占位符、说话人名），
`warn` 只提示（残留假名、超宽行、繁体字、被拒条目）。`--write-report report.md` 把全部
问题写成一份可贴进 issue 的 markdown。

游戏更新后中文没了，先跑 `doctor` 分清是安装产物丢了、备份对不上，还是字典与这版游戏
脱节（RPG Maker 看 `data/`，Ren'Py 看 `game/`）：

```bash
node bin/yakusha.js doctor "/games/MyGame"
```

```
  install     ok    js/plugins/YAKUSHA_Translator.js registered in js/plugins.js
  sync        ok    every dictionary key still appears in data/
  runtime     ok    yakusha/dictionary.json (found)
verdict   : usable with 2 warning(s)
```

（摘录，省掉了 engine / dictionary / progress / verify 几行。`doctor` 先打一行游戏与引擎
摘要，再按 engine → dictionary → progress →（有被拒条目时）rejected → sync → install →
（装好之后）backup → runtime → verify 逐项检查，最后一行是 verdict。）

Ren'Py 的首行与 `sync` 文案跟 RPG Maker 不同（没有 `plugins.js` 与备份两项检查）：

```
game      : Example Game (Ren'Py 1.0, 2 scripts)
  sync        ok    every dictionary key still appears in game/
  install     ok    game/yakusha_translation.rpy (written by install)
  runtime     ok    game/yakusha_translation.rpy (6 strings, language schinese)
verdict   : ready
```

### 可选：export 导出译文

译文要备份、做校对或交给别人时，导出一份 JSON 快照（不是字典备份）：

```bash
node bin/yakusha.js export "/games/MyGame" --out yakusha-export.json
```

### 可选：launch 启动游戏

```bash
node bin/yakusha.js launch "/games/MyGame"
```

仅 Windows，三个引擎共用同一套规则：项目根恰好一个 `.exe` 时直接启动；多个时用
`--exe <name>` 指定（只收裸文件名）。启动后工具立即退出，游戏继续运行；子进程环境会删掉
`YAKUSHA_API_KEY` / `OPENAI_API_KEY`。`attach` 调试注入到 0.11 仍是桩，
能力表里 `attach: false`，没有 CLI 入口。

## 命令一览

| 命令 | 作用 |
| --- | --- |
| `scan` | 报告可翻译的量 |
| `extract` | 建/刷新 `yakusha/dictionary.json` |
| `status` | 查看翻译进度 |
| `translate` | 调 LLM 填字典 |
| `verify` | 体检字典（发布前自检） |
| `speaker` | 按本作自己的写法修复说话人名 |
| `terms` | 挖人名/术语的主流译法，报出漂移 |
| `install` | 装进游戏：MZ/MV 装插件，Ren'Py 写 `game/yakusha_translation.rpy` |
| `uninstall` | 卸载并还原：删插件与注册行，或删那个翻译文件 |
| `doctor` | 查安装产物、备份（Ren'Py 无）、字典是否还与这版游戏对得上 |
| `export` | 把已翻译条目导出成 JSON 快照 |
| `config` | 读写用户级配置（`provider` / `model` / `baseUrl`，不存密钥） |
| `launch` | 启动项目根的游戏 exe（仅 Windows） |

`launch` 已实现（Windows only），启动规则见 [docs/engines.md](docs/engines.md) §8。
`config`、`export` 与 `launch` 的完整规则分别见 [docs/config.md](docs/config.md)、
[docs/export-format.md](docs/export-format.md) 与 [docs/engines.md](docs/engines.md)。

完整选项、判据、实测见 [docs/commands.md](docs/commands.md)。

## 给脚本用：`--json` 与退出码

13 条命令都支持 `--json`，标准输出**恰好一个 JSON 对象加一个换行**，没有进度条、
没有装饰文本；payload 是扁平对象，前五个键固定为

```json
{ "schema": 1, "command": "scan", "ok": true, "outcome": "ok", "error": null }
```

`outcome` 取 `ok` / `findings` / `error`，`ok` 恒等于 `outcome === "ok"`，
`error` 只在 `outcome: "error"` 时非空。退出码统一三档：**0** 成功、**1** 有发现
（只有 `verify` 的 error 级问题与 `doctor` 的 broken 判定）、**2** 错误（含用法错误与
未知命令）。错误对象形如 `{"code": "E_USAGE", "message": "..."}`，共 13 个错误码，
message 保证是单行、不含堆栈与密钥。`YAKUSHA_DEBUG=1` 时堆栈只进 stderr。

`--help` / `--version` 永远是纯文本 stdout 加退出 0（即使同时传了 `--json`）；
参数解析严格，未声明的选项、缺值、多余位置参数都是 `E_USAGE` 退出 2。
完整约定见 [docs/json-contract.md](docs/json-contract.md)。

## 环境变量

| 变量 | 用途 |
| --- | --- |
| `YAKUSHA_API_KEY` | API key（真实调用必须配置；回退到 `OPENAI_API_KEY`） |
| `YAKUSHA_MODEL` | 模型 id（无默认，真实调用必须配置） |
| `YAKUSHA_BASE_URL` | 端点（OpenAI 官方为默认；`compatible` 必须显式配置） |
| `YAKUSHA_CONFIG_DIR` | 把用户级配置目录指到别处（必须是绝对路径，不做 `~` 展开） |
| `YAKUSHA_DEBUG` | 设为 `1` 时把异常堆栈打到 stderr（仅排查用，不进 JSON） |

## 目录结构

```
bin/yakusha.js            CLI 薄壳，当前十三个命令
src/cli/                  JSON 信封、严格参数解析、用户级配置、JSON 导出
src/engines/              适配器与 registry（MZ/MV 插件档、Ren'Py translation 档）
  src/engines/renpy/      .rpy / .rpyc 解析、身份读取、translation 文件生成与状态
src/index.js              库门面（与 CLI 共用同一套实现）
src/core/                 项目发现、数据解码、文本抽取、字典、安装、doctor（引擎无关）
src/pipeline/             provider、批处理、校验、折行、verify、terms、speaker、报告
src/plugin/               运行时插件模板
test/                     单元与 CLI 端到端测试
docs/                     设计说明、命令参考、契约、实测记录、已知限制
  docs/dev/               内部开发日志（DEVLOG）
```

## 已知限制

- 只处理游戏自己的文本资源：MZ/MV 是 `data/` 里的 JSON，Ren'Py 是 `game/` 下
  `.rpy` / `.rpyc` 里的对话、选项、`_()` 字符串与 screen 文本。插件 `js/plugins/*.js`
  里硬编码的 UI 文案、图片里的文字不处理。
- 支持 RPG Maker **MZ / MV** 与 **Ren'Py**。Unity、Godot、Wolf、Kirikiri 与 RPG Maker
  XP / VX / VX Ace（`.rxdata` 二进制）不支持；多引擎路线与每一档的验收标准见
  [docs/dev/ENGINE-STRATEGY.md](docs/dev/ENGINE-STRATEGY.md)。
- Ren'Py 只投 `schinese` 一种语言（命令行没有选语言的入口）；`game/tl/` 下已有的
  译文不读也不合并。
- 图片文字、插件自定义的说话人容器（`\N<名字>` 之外）看不到。
- `verify` 只查结构性缺陷，译文风格与剧情上下文它判断不了。

完整清单见 [docs/limitations.md](docs/limitations.md)。

## 平台

当前**只支持并验收 Windows 10/11 x64**。Linux 与 macOS 不在范围内（原因、成本与重评条件见
[docs/platforms.md](docs/platforms.md)）；WSL、Wine、Proton 也不作为受支持环境。

## 参与开发

分支模型是 **trunk-based**：只有 `main` 一条长期分支，工作分支当天合回；合并前 `npm test`
必须全绿，每个工作包走一个 self-PR（以 CI status check 为准）并 squash 合并；发布用
`vX.Y.Z` annotated tag 标记。完整规则与命令见 [docs/dev/DEVLOG.md](docs/dev/DEVLOG.md) §9。

## 文档

| 文件 | 内容 |
| --- | --- |
| [docs/commands.md](docs/commands.md) | 所有命令的完整选项、`verify` 十类判据、`terms`/`speaker` 算法说明 |
| [docs/architecture.md](docs/architecture.md) | 三层结构（CLI 内核 / Electron 壳 / 引擎适配器）、引擎能力分档、载荷契约、分批计划 |
| [docs/dev/ENGINE-STRATEGY.md](docs/dev/ENGINE-STRATEGY.md) | 多引擎战略稿（内部）：竞品适配方法、目标架构、四档交付、版本顺序、质量门禁、代码签名成本 |
| [docs/json-contract.md](docs/json-contract.md) | `--json` 信封、错误码、退出码、严格参数解析、破坏性变更（0.10 冻结，0.11 沿用） |
| [docs/engines.md](docs/engines.md) | adapter 契约、能力矩阵、各引擎的安装/卸载、launch；attach 桩 |
| [docs/config.md](docs/config.md) | 0.10 实现：用户级配置、密钥优先级与威胁模型（不落盘） |
| [docs/export-format.md](docs/export-format.md) | 0.10 实现：JSON 导出格式、排序、原子写与覆盖规则 |
| [docs/platforms.md](docs/platforms.md) | 平台支持矩阵与决策记录（Windows-only 的原因与重评条件） |
| [docs/design.md](docs/design.md) | 为什么走运行时钩子、文本面覆盖、转义码、设计约束、作为库用 |
| [docs/games.md](docs/games.md) | 匿名记录的实测游戏（RPG Maker 15 款、Ren'Py SDK 自带项目）、全量翻译数据、官中游戏的处理方式 |
| [docs/limitations.md](docs/limitations.md) | 已知限制全表 |
| [docs/dev/DEVLOG.md](docs/dev/DEVLOG.md) | 内部开发日志（阶段、决策、实测、教训） |

## 许可

GPL-3.0-or-later，见 [LICENSE](LICENSE)。

本项目**不含任何游戏内容**，也不分发译文；字典与译文由使用者自行生成，版权归原游戏权利方所有。
请只对自己合法拥有的游戏使用。
