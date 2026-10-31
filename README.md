# Yakusha

**非侵入式游戏运行时翻译工具，支持 RPG Maker MZ / MV、Ren'Py、RPG Maker XP / VX / VX Ace（RGSS，原生注入）与 Kirikiri（只到提取与翻译）。**

把游戏文本抽出来交给任意 LLM 翻译，再让游戏**在运行时**显示中文。当前覆盖三档交付，
外加一个只做到提取与翻译的引擎：

- **插件档（MZ / MV）**：游戏目录只多一个插件文件、`js/plugins.js` 里多一行注册，
  `uninstall` 会把这两处还原到安装前。
- **translation 档（Ren'Py）**：`install` 在 `game/` 下生成一个
  `yakusha_translation.rpy`，用引擎自己的 `translate <lang> strings:` 块替换源文；
  游戏脚本一个字节都不改，`uninstall` 只删这一个文件。
- **inject 档（RGSS，0.18 起）**：`install --native` 把注入器与 hook DLL 装进
  `yakusha/native/`，`launch` 通过 `yakusha_injector.exe` 启动游戏；游戏文件一个字节都不改，
  `uninstall` 只删这个目录。只构建了 32 位 Windows 组件。
- **Kirikiri 本版没有交付层**：`scan`、`extract`、`translate`、`verify`、`terms`、`speaker`、
  `export`、`doctor` 都能跑，但 `install` 与 `uninstall` 会明确报 `E_NOT_IMPLEMENTED`
  （退出码 2）并且不写任何文件，游戏仍然显示原文。Kirikiri 的文本在 XP3 归档内的 KAG 脚本里。
  原因与路线状态见下面 install 一节和 [docs/limitations.md](docs/limitations.md)。

每一档对游戏文件的实际影响写在该档的文档里（[docs/limitations.md](docs/limitations.md)、
[docs/engines.md](docs/engines.md)），没有"整个产品都绝对可逆"的说法。

```
scan  →  extract  →  translate  →  install
看有多少   建字典      LLM 填译文    装进游戏
```

本版最后一步对 MZ / MV / Ren'Py 有效，RGSS 需要 `install --native`；Kirikiri 的流程停在
`translate`，`install` 会拒绝而不是假装装好。

运行时效果不在仓库里放截图；支持范围、匿名实测数据与编号见 [docs/games.md](docs/games.md)。

## 安装

```bash
git clone https://github.com/MagicalAlmond/Yakusha
cd Yakusha
node --version   # 需要 22 或更高
npm test         # 全部测试，应该全绿
```

CLI 只用 Node 标准库，没有第三方运行时依赖（`package.json` 也没有 `dependencies`）；
GUI 是单独的 Electron 外壳（只进 devDependencies），那是外壳的成本，不影响 CLI。

## 五步上手

以游戏目录 `/games/MyGame` 为例。

### 1. scan：看有多少文本

```bash
node bin/yakusha.js scan "/games/MyGame"
```

RPG Maker（MZ / MV / RGSS）数 `data/` 里的数据文件，Ren'Py 数 `game/` 下的脚本，
Kirikiri 数 XP3 归档里的脚本条目，所以中段几行不一样：

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
`encodings` 在解出的格式只有 JSON 时不打印（MZ/MV），其余引擎都会打这一行，报的是解出的
各格式文档个数（Ren'Py 是 `.rpy` 与 `.rpyc` 个数）；同一个 stem 两种文件都在时只读
`.rpy`，所以 `rpyc` 会是 0。
解不开的脚本记进 `undecodable` 并继续跑，不会中断。

RGSS 与 MZ / MV 打同一个 `data files:` 标签，但数的是解出来的 `.rxdata` / `.rvdata` /
`.rvdata2` 文档数：打包发行的游戏直接从 `.rgssad` / `.rgss2a` / `.rgss3a` 归档里读
（`encodings` 记为 `marshal`），散装目录读 `Data/`（记为对应扩展名）。一款 RGSS3 / VX Ace
商业游戏实测 394 个数据文档、31,730 条唯一串，样本说明见 [docs/games.md](docs/games.md)。

Kirikiri 的 `data files:` 计的是打开成功的 `.xp3` 归档个数（打包发行的游戏没有散装文件可数，
归档数是唯一诚实的数字），`encodings` 记为 `xp3`；项目标题在这版不解析，
`game` 一行显示 `(untitled)`。

### 2. extract：建字典

```bash
node bin/yakusha.js extract "/games/MyGame"
```

在 `/games/MyGame/yakusha/dictionary.json` 生成一份**空译文**的字典，每个 key 都带它出现的
位置（MZ/MV 是 `Map029.json:401`、`System.json:terms.commands[]`……数组字段带 `[]` 后缀；
Ren'Py 是 `game/script.rpy:12` 这样的相对项目根路径加行号；RGSS 是 `Map001.rvdata2:401`、
`Actors.rvdata2:name`、`System.rvdata2:terms.params` 这样的「文档名加事件指令码或字段」；
Kirikiri 是 `scenario/s1.ks:12` 这样的归档内条目路径加行号）。
重复执行会合并，不覆盖已有译文。

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

**RGSS（XP / VX / VX Ace）** 走注入档，安装命令要加 `--native`：

```bash
node bin/yakusha.js install "/games/MyGame" --native
```

```
native    : /games/MyGame/yakusha/native
components: 4 files
dictionary: 3812 strings
uninstall : yakusha uninstall "/games/MyGame"
```

它把四个组件（`yakusha_injector.exe`、`yakusha_rgss_hook.dll`、`libunwind.dll`、
`bootstrap.rb`）、按当前字典生成的 `dictionary.txt` 和一份 SHA-256 `manifest.json`
写进 `yakusha/native/`，游戏自己的文件一个都不改。装好之后 `launch` 用注入器启动游戏：
注入器以挂起方式创建 `Game.exe`，把 hook DLL 载入游戏进程；hook 在 `RGSSGameMain` 之前
用引擎自己的 `RGSSEval` 跑 `bootstrap.rb`，由后者把 `dictionary.txt` 读成 Ruby 哈希、
包一层 `load_data`，把数据文档返回的对象里的字符串替换成译文。`uninstall` 只递归删掉
`yakusha/native/`。

`--dry-run` 只校验组件与字典并打印计划（`dry run   : nothing written`），不写盘；组件缺失或
SHA-256 对不上会报 `E_IO` 并拒绝安装；`--native` 与 `--embed` 不能同时给。不带 `--native`
时 RGSS 直接报 `E_USAGE`（退出码 2），不会去猜用户想用哪种投递方式：

```
error: RGSS has no plugin delivery layer - pass --native to install the injector: yakusha install --native "/games/MyGame"
```

**Kirikiri 本版装不进去**：没有交付层，`install` 与 `uninstall` 都以 `E_NOT_IMPLEMENTED`
失败、退出码 2、一个文件都不写：

```
error: install is not implemented for Kirikiri yet - see the pending decisions in docs/dev/DEVLOG.md
```

原因很直接：Kirikiri 没有可填的翻译资源目录，文本在 XP3 归档内的 KAG 脚本里，
"写回"意味着重写归档，路线仍未拍板（待定清单见 `docs/dev/DEVLOG.md`），所以它停在字典：
`translate` 之后游戏仍然显示原文，`doctor` 会把 `install` 报成 warning、`runtime` 报成 info。
`export` 仍然是拿到译文的出口。

### 5. verify / doctor：自检

```bash
node bin/yakusha.js verify "/games/MyGame"
```

字典会被逐条体检，只读不写。`error` 让命令失败退出（`echo`、转义码、占位符、说话人名），
`warn` 只提示（残留假名、超宽行、繁体字、被拒条目）。`--write-report report.md` 把全部
问题写成一份可贴进 issue 的 markdown。

游戏更新后中文没了，先跑 `doctor` 分清是安装产物丢了、备份对不上，还是字典与这版游戏
脱节（RPG Maker 与 RGSS 看 `data/`，Ren'Py 看 `game/`，Kirikiri 看归档内的条目）：

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

0.23 起，`doctor` 还会检查“安装时写入的译文”是否已经跟字典脱节：MZ/MV 的 `--embed`
插件、Ren'Py 的 `game/yakusha_translation.rpy`、RGSS 的 `yakusha/native/dictionary.txt`
都是安装时快照，之后 `translate` / `import` / 手改字典不会自动更新；这时 `install` 与
`runtime` 都会报 `warn` 并提示重跑对应的 `install`，`verdict` 仍是 `usable`、退出 0。

Ren'Py 的首行与 `sync` 文案跟 RPG Maker 不同（没有 `plugins.js` 与备份两项检查）：

```
game      : Example Game (Ren'Py 1.0, 2 scripts)
  sync        ok    every dictionary key still appears in game/
  install     ok    game/yakusha_translation.rpy (written by install)
  runtime     ok    game/yakusha_translation.rpy (6 strings, language schinese)
verdict   : ready
```

RGSS 装之前 `install` 是提示、verdict 是 `not-installed`；装完 `install` 与 `runtime` 都变 `ok`，
verdict 到 `ready`：

```
game      : Example Game (RGSS 3, 7 data files)
  sync        ok    every dictionary key still appears in Data/
  install     info  not installed - run: yakusha install --native "<game>"
  runtime     info  the injector loads yakusha/native when the game starts
verdict   : not-installed
```

```
  install     ok    yakusha/native (written by install)
  runtime     ok    yakusha/native (3812 strings)
verdict   : ready
```

Kirikiri 的 doctor 输出同一形态：`install` 一行换成
`Kirikiri has no delivery layer yet, so nothing is written back into the game`，
`sync` 一行是 `every dictionary key still appears in xp3 archives`；项目标题不解析，
game 摘要行显示 `(untitled)`，verdict 同样停在上限 `usable`。

### 可选：export 导出译文

译文要备份、做校对或交给别人时，导出一份 JSON 快照（不是字典备份），或者导出成
TSV / CSV 表格交给电子表格与外部工具：

```bash
node bin/yakusha.js export "/games/MyGame" --out yakusha-export.json
node bin/yakusha.js export "/games/MyGame" --format tsv --out yakusha-export.tsv
```

`--format` 取 `json`（默认）/ `tsv` / `csv`；表格以 UTF-8 BOM 开头、CRLF 换行，
表头固定为 `source` / `target` / `contexts` 三列，引号规则遵循 RFC 4180。`--flat`
只对 JSON 快照有效。

### 可选：import 回灌表格

在电子表格或别的工具里改完译文后，导出的表能原样灌回字典：

```bash
node bin/yakusha.js import "/games/MyGame" --from yakusha-export.tsv
```

`--from` 指向 `export` 产出的 TSV / CSV 表格或 JSON 快照，格式默认按扩展名识别。
空译文的行跳过；默认 `--strategy only-empty` 只填还没有译文的条目，`overwrite` 才会覆盖；
`--dry-run` 全程只算不写。export 成表、import 回来、再 export 一次，得到的文件字节相同。

外部工具也可以把任意来源的文本写成 JSONL（每行 `{source|key, target|text, locator}`）
直接灌进字典；项目还没有字典时加 `--create` 就地建一个：

```bash
node bin/yakusha.js import "/games/MyGame" --from external.jsonl --create
```

文件形状见 [docs/export-format.md](docs/export-format.md) §9。
完整规则见 [docs/export-format.md](docs/export-format.md)。

### 可选：launch 启动游戏

```bash
node bin/yakusha.js launch "/games/MyGame"
```

仅 Windows。MZ / MV / Ren'Py / Kirikiri 共用同一套规则：项目根恰好一个 `.exe` 时直接启动；
多个时用 `--exe <name>` 指定（只收裸文件名）。启动后工具立即退出，游戏继续运行；子进程环境
会删掉 `YAKUSHA_API_KEY` / `OPENAI_API_KEY`。RGSS 多一步：装过 `install --native` 时走
`yakusha_injector.exe`，输出仍是 `launched:` / `pid:` 两行；没装时照常启动项目根的 exe。
`attach` 调试注入仍是桩，能力表里 `attach: false`，没有 CLI 入口。

## 图形界面（0.14 起步）

仓库自带一个最小的 Electron 外壳，代码在 `gui/`。它与 CLI 调用同一份命令实现
（`src/cli/runner.js`），每个按钮对应一条文档化的命令，`--json` 载荷逐键一致：

```bash
pnpm install          # 开发依赖含 electron；运行时仍是零依赖
npx electron gui/main.js
```

0.14 的外壳覆盖主链路：目录选择器或拖入游戏目录 → scan → extract → translate（带
真实进度与取消）→ verify → install/uninstall → doctor，外加 export（JSON）、
speaker、terms 与 `config list`。API key 可以显式勾选"记住"（Windows DPAPI 加密
存盘，CLI 不读它），也可以照旧用环境变量或 `--api-key`；`launch` 也在外壳里（与 CLI 同一条
启动路径，`--exe` 歧义时展示候选）；最小字典编辑器也在外壳里（逐条改 pending
译文，批量仍走 export/import）。0.16 起按钮可用性由引擎能力位驱动：没有交付层的引擎（本版是 Kirikiri）把 install/uninstall 置灰并写明原因，不再让用户点了才知道报错；RGSS 从 0.18 起按引擎自动带 `--native`，按钮正常可用。设计与验收清单见 [docs/gui.md](docs/gui.md)。

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
| `install` | 装进游戏：MZ/MV 装插件，Ren'Py 写 `game/yakusha_translation.rpy`，RGSS 用 `--native` 装注入器；Kirikiri 报 `E_NOT_IMPLEMENTED` |
| `uninstall` | 卸载并还原：删插件与注册行、删那个翻译文件，或删 `yakusha/native/`；Kirikiri 未实现 |
| `doctor` | 查安装产物、备份（Ren'Py 无）、字典是否还与这版游戏对得上；Kirikiri 只报「没有交付层」 |
| `export` | 把已翻译条目导出成 JSON 快照，或 TSV / CSV 表格 |
| `import` | 把导出的表格或快照回灌进字典；JSONL + `--create` 接外部内容 |
| `config` | 读写用户级配置（`provider` / `model` / `baseUrl`，不存密钥） |
| `launch` | 启动项目根的游戏 exe（仅 Windows） |

`launch` 已实现（Windows only），启动规则见 [docs/engines.md](docs/engines.md) §8。
`config`、`export` 与 `launch` 的完整规则分别见 [docs/config.md](docs/config.md)、
[docs/export-format.md](docs/export-format.md) 与 [docs/engines.md](docs/engines.md)。

完整选项、判据、实测见 [docs/commands.md](docs/commands.md)。

## 给脚本用：`--json` 与退出码

14 条命令都支持 `--json`，标准输出**恰好一个 JSON 对象加一个换行**，没有进度条、
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
bin/yakusha.js            CLI 薄壳，当前十四个命令
src/cli/                  JSON 信封、严格参数解析、用户级配置、导出与表格读写
src/engines/              适配器与 registry（MZ/MV 插件档、Ren'Py translation 档、RGSS inject 档、Kirikiri 仅 L1–L3）
  src/engines/renpy/      .rpy / .rpyc 解析、身份读取、translation 文件生成与状态
  src/engines/rgss/       .rxdata / .rvdata / .rvdata2 的 Ruby Marshal 读写、三版本归档解密、抽取、注入器组件安装与启动
  src/engines/krkr/       XP3 归档解包、KAG 脚本（.ks）行解析、抽取
native/                   注入器与 hook 的 Rust 源码、构建脚本；native/prebuilt 随 npm 包分发
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
  `.rpy` / `.rpyc` 里的对话、选项、`_()` 字符串与 screen 文本，RGSS 是数据文档里
  事件指令与数据库字段的文本，Kirikiri 是 XP3 归档内 `.ks` 脚本里的对话文本。
  插件 `js/plugins/*.js` 里硬编码的 UI 文案、图片里的文字不处理。
- 支持 RPG Maker **MZ / MV**、**Ren'Py**、**RPG Maker XP / VX / VX Ace（RGSS）** 与
  **Kirikiri**。RGSS 0.18 起有运行时交付（原生注入器），但只在 32 位 Windows 上、
  只在一款 VX Ace 商业游戏上做过真机验收：XP / VX（RGSS1 / RGSS2）未测，RGSS301 只有
  同族兼容性推断；未签名的注入器与 DLL 可能被杀软误报；加壳样本不在范围内。
  **Kirikiri** 这一版只有「识别 / 盘点 / 提取 / 翻译 / 校验 / 导出」，**没有运行时交付**：
  `install` 与 `uninstall` 报 `E_NOT_IMPLEMENTED`，游戏里看不到中文。
  Unity、Godot、Wolf 仍然不支持；多引擎路线与每一档的验收标准见
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
| [docs/json-contract.md](docs/json-contract.md) | `--json` 信封、错误码、退出码、严格参数解析、破坏性变更（0.10 冻结；后续版本只加字段与命令，信封不变） |
| [docs/engines.md](docs/engines.md) | adapter 契约、能力矩阵、各引擎的安装/卸载、launch；attach 桩 |
| [docs/config.md](docs/config.md) | 0.10 实现：用户级配置、密钥优先级与威胁模型（不落盘） |
| [docs/export-format.md](docs/export-format.md) | 0.10 实现：JSON 导出格式、排序、原子写与覆盖规则；0.13 起另有 TSV / CSV 表格与 import 回灌；0.15 起另有 JSONL 通用内容导入 |
| [docs/platforms.md](docs/platforms.md) | 平台支持矩阵与决策记录（Windows-only 的原因与重评条件） |
| [docs/design.md](docs/design.md) | 为什么走运行时钩子、文本面覆盖、转义码、设计约束、作为库用 |
| [docs/games.md](docs/games.md) | 匿名记录的实测游戏（RPG Maker 15 款、Ren'Py SDK 自带项目、一款 RGSS3 商业游戏）、全量翻译数据、官中游戏的处理方式 |
| [docs/limitations.md](docs/limitations.md) | 已知限制全表 |
| [docs/dev/DEVLOG.md](docs/dev/DEVLOG.md) | 内部开发日志（阶段、决策、实测、教训） |

## 许可

GPL-3.0-or-later，见 [LICENSE](LICENSE)。

本项目**不含任何游戏内容**，也不分发译文；字典与译文由使用者自行生成，版权归原游戏权利方所有。
请只对自己合法拥有的游戏使用。
