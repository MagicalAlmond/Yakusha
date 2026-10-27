# 命令参考

本文是 yakusha 0.13.0 的命令行参考手册：14 个命令各自的选项、判据、输出形状与实测数据，加上所有命令共用的约定（JSON 信封、退出码、错误码、脱敏、参数解析）和用户级配置。0.11 开始支持 Ren'Py，0.12 起支持 RGSS（RPG Maker XP / VX / VX Ace），0.13 起支持 Kirikiri（KAG）：同一个命令在 RPG Maker（MZ/MV）、Ren'Py、RGSS 与 Kirikiri 上共用一套选项、信封、退出码和载荷键名，只有少数输出文本与安装产物按引擎不同，各节用「Ren'Py」「RGSS」「Kirikiri」标出。

**RGSS 在 0.12 只做到「盘点、建库、翻译、审校」，没有交付层。** `scan` / `extract` / `status` / `translate` / `verify` / `speaker` / `terms` / `export` 都能用，但 `install` / `uninstall` 在 RGSS 项目上直接报 `E_NOT_IMPLEMENTED`、退出 2、不写任何文件——游戏里不会出现译文。原因与两条未拍板的路线见下文 [install 与 uninstall](#install-与-uninstall)。

**Kirikiri 在 0.13 同样只做到「盘点、建库、翻译、审校」，没有交付层。** `scan` / `extract` / `status` / `translate` / `verify` / `speaker` / `terms` / `export` / `import` 都能用，但 `install` / `uninstall` 在 Kirikiri 项目上直接报 `E_NOT_IMPLEMENTED`、退出 2、不写任何文件——文本烧在 `.xp3` 归档里，写回归档的路（含 krkr2 / krkrz 的加密变体）被刻意搁置。原因见下文 [install 与 uninstall](#install-与-uninstall)。

文中每一条输出都是在仓库夹具上真跑出来的：`test/fixtures/mini-mz`（7 个数据文件、32 条唯一串的玩具项目）、`test/fixtures/mini-mv`（2 个数据文件、3 条串），以及 Ren'Py 的 `test/fixtures/renpy-extract/*`（`rpy` / `rpyc` / `lineless` / `mixed` / `broken`，各 1–2 个脚本、2–10 条串）与 `test/fixtures/renpy-rpyc`（同一脚本的 `.rpy` 与 `.rpyc` 并存）。RGSS 没有落盘的二进制夹具：`test/rgss-fixture.js` 在测试里现生成 7 个 `.rvdata2` 文档、29 条唯一串的玩具项目（`Synthetic Quest`），磁盘版与打包成 `.rgss3a` 的版本各一份。Kirikiri 同样没有落盘的二进制夹具：`test/krkr-fixture.js` 在测试里现生成一个含 `data/scenario.xp3` 归档的玩具项目（KS 场景：两个说话人、注释行、标签行与 `[r]` 行内标签，再加一个单行脚本），文本全部是合成的。凡涉及配置的示例都把 `YAKUSHA_CONFIG_DIR` 指向临时目录，不碰真实 `%APPDATA%`。

字段清单与破坏性变更见 [json-contract.md](json-contract.md)，配置文件格式与威胁模型见 [config.md](config.md)。

## 命令一览

| 命令 | 用途 |
| --- | --- |
| `scan` | 报告什么可以翻译：数据文件数、字符串数、带控制码的字符串数 |
| `extract` | 建立或刷新 `yakusha/dictionary.json`（`contexts` 记录每条串出现在哪） |
| `status` | 看翻译进度 |
| `translate` | 调用模型把字典填满 |
| `verify` | 按十条判据审计字典里的坏条目 |
| `speaker` | 用游戏自己的渲染方式修复行内说话人名字 |
| `terms` | 挖掘名字写法并报告漂移 |
| `install` | 装运行时：MZ/MV 写插件，Ren'Py 生成翻译脚本，RGSS 与 Kirikiri 尚未实现（报 `E_NOT_IMPLEMENTED`） |
| `uninstall` | 卸掉上一条装的东西 |
| `doctor` | 对着当前版本体检安装、备份与字典 |
| `export` | 把已翻译条目导出成 JSON / TSV / CSV 快照 |
| `import` | 用此前导出的文件回填字典（TSV / CSV / JSON） |
| `launch` | 启动游戏可执行文件（仅 Windows） |
| `config` | 读写用户级配置（不接游戏目录） |

除 `config` 与 `import`（后者的对象是 `--from` 指定的文件）外，每个命令接且只接一个 `<game-dir>`：可以是游戏根目录本身，也可以是它上面最多 3 层内的任意目录，项目根会自动发现。`scan`、`extract`、`status`、`uninstall` 没有命令专属选项（`doctor` 只有一个 `--max-length`，`--help` 里没有 doctor 段，该选项只写在本文的 doctor 一节）。以下是 `--help` 原文里列出的选项块，逐字照抄。

命令、选项、信封和退出码在四类引擎上完全通用，只有输出文本与安装产物按引擎不同：

| 位置 | RPG Maker（MZ/MV） | Ren'Py | RGSS（XP/VX/VX Ace） | Kirikiri |
| --- | --- | --- | --- | --- |
| `scan` 第 4 行 | `data files: 7` | `scripts   : 2` | `data files: 394` | `data files: 1` |
| `scan` 的 `encodings` | `{"json": 7}` | `{"rpy": 2, "rpyc": 0}` | `{"rvdata2": 7}`（磁盘版）/ `{"marshal": 7}`（打包版） | `{"xp3": 1}` |
| `scan` 的 `perFile` / `extract` 的 `contexts` | `Items.json:description` | `game/script.rpy:12` | `Map001.rvdata2:401`、`Actors.rvdata2:name` | `scene1.ks:2` |
| `install` 文本 | `plugin` / `registered` / `backup` / `dictionary` | `translation` / `strings` / `uninstall` | 不实现，只有错误行 | 不实现，只有错误行 |
| `uninstall` 文本 | `plugin removed` | `translation removed` | 不实现，只有错误行 | 不实现，只有错误行 |
| `doctor` 首行 | `(RPG Maker MZ 1.7.0, 51 data files)` | `(Ren'Py, 2 scripts)` | `(RGSS 3, 7 data files)` | `(Kirikiri, 1 data files)` |
| `doctor` 的 `sync` | `every dictionary key still appears in data/` | `every dictionary key still appears in game/` | `every dictionary key still appears in Data/` | `every dictionary key still appears in xp3 archives` |

载荷的键名四边一致（见 [json-contract.md](json-contract.md) §7.1），脚本不需要按引擎分支——要小心的只有两处：`scan` 的 `dataFiles`，MZ/MV 数 JSON 数据文件、RGSS 数读过的 Marshal 文档、Ren'Py 数脚本、Kirikiri 数打开的 `.xp3` 归档；以及各引擎的 `install` 含义并不相同（Ren'Py 见下文小节；RGSS 与 Kirikiri 根本装不上、只有错误信封，没有任何载荷）。

### translate

```text
--provider <name>   openai, compatible or mock (required for a real run)
--model <name>      model id (required for a real run; $YAKUSHA_MODEL)
--base-url <url>    OpenAI compatible endpoint, defaults to $YAKUSHA_BASE_URL
--api-key <key>     API key, defaults to $YAKUSHA_API_KEY or $OPENAI_API_KEY
--glossary <file>   JSON map of source -> fixed translation
--limit <n>         translate at most n pending entries
--context <text>    only entries whose context contains text; repeat to
                    accept any of several
--batch-size <n>    entries per request (default 40)
--char-budget <n>   characters per request (default 6000)
--concurrency <n>   parallel requests (default 2)
--save-every <n>    write the dictionary every n translations (default 200)
--max-length <cols> wrap translated lines wider than n display columns (0 = off)
--no-rewrap         leave existing translations alone (no re-wrap)
--dry-run           use the mock provider and do not save
--glossary-only     apply --glossary and never call a model
--overwrite         let --glossary replace entries that are already translated
```

白名单里还有 5 个 `--help` 没列出来的选项：`--temperature`（默认 0.3）、`--timeout`、`--max-tokens`、`--target-lang`、`--allow-code-drift`。它们能用，但没有写进帮助，属于内部接线，不要当成稳定接口。

### verify

```text
--kind <list>       only report these kinds, comma separated
                    (kana, echo, codes, slots, lines, width, no-text, trad, speaker, rejected)
--max-length <cols> also report lines wider than n display columns
--limit <n>         how many problems to print (default 20)
--write-report <f>  write every finding as a markdown report
```

### speaker

```text
--include-drift     also replace a Chinese rendering that differs from the
                    one used elsewhere (style call, off by default)
--names <file>      JSON map of source name -> Chinese, for names this game
                    never translated (so no rendering can be copied)
--write-names <f>   write a JSON template of the names --names must supply
--dry-run           report what would change without writing
--limit <n>         how many names to print (default 20)
```

### terms

```text
--status <list>     only list these statuses (ok, drift, missing)
--min-holders <n>   mentions a name needs before it is mined (default 5)
--min-support <n>   share of mentions the dominant spelling needs (default 0.5)
--drift-only        write only the entries that disagree
--max-terms <n>     cap the glossary (0 = every mined term)
--limit <n>         how many terms to print (default 20)
--write <file>      save the glossary for translate --glossary
--dry-run           report what --write would save, without saving
```

### export

```text
--out <file>        target file (required; never stdout)
--format <name>     json (default), tsv or csv
--flat              write source -> text instead of {text, contexts} (json only)
--force             overwrite an existing target
```

### import

```text
--from <file>       source file (required; never stdin)
--format <name>     tsv, csv or json; guessed from the extension by default
--strategy <name>   only-empty (default; never overwrites) or overwrite
--dry-run           report what would change without writing
```

### launch

```text
--exe <name>        pick one executable when the project root has several
```

### install

```text
--embed             embed the translations into the plugin file
```

## 全局约定

### --json：一个对象加一个换行

带 `--json` 时 stdout 上只有一个 JSON 对象和它后面的一个换行，没有别的内容。信封五个键的顺序固定，命令载荷平铺在这五个键旁边（不套一层 `data`）：

```json
{"schema":1,"command":"scan","ok":true,"outcome":"ok","error":null,"root":"/games/MyGame","engine":"mz","engineVersion":"1.7.0","gameTitle":"テストゲーム","dataFiles":7,"uniqueStrings":32,"totalStrings":32,"stringsWithControlCodes":2,"encodings":{"json":7},"undecodable":[],"perFile":{"Actors.json":3,"CommonEvents.json":6,"Items.json":2,"Map001.json":3,"MapInfos.json":1,"Skills.json":3,"System.json":14}}
```

| 键 | 值 |
| --- | --- |
| `schema` | 信封版本，0.10 起恒为 `1`，0.11 至 0.13 未变 |
| `command` | 命令名；无命令时是 `null` |
| `ok` | 严格等于 `outcome === "ok"`，不单独计算 |
| `outcome` | `ok` / `findings` / `error` 三选一 |
| `error` | 成功时 `null`，失败时是错误对象 |

载荷里不能再用这五个名字，库在拼信封时直接抛错。进度条、警告、调试信息一律走 stderr，不会混进 stdout 的 JSON。

### 退出码

| `outcome` | 退出码 | 谁能产生 |
| --- | --- | --- |
| `ok` | 0 | 全部命令 |
| `findings` | 1 | 只有检查类命令：`verify` 报了 error 级问题，或 `doctor` 的 verdict 是 `broken` |
| `error` | 2 | 全部命令 |

规则和细节：

- 只有检查类命令用 `findings`。`translate` 有 `rejected > 0`、`speaker` 改完仍留 `errorsAfter > 0`、`status` 的 `withError > 0`，都还是 `ok`；这些是「发生了，但不算失败」。
- 同一命令既 error 又 findings 时 error 优先，例如 `verify --write-report` 报告写不进去，报 `E_IO` 并退出 2，不再谈 findings。
- 文本模式的退出码和 JSON 模式完全一致，脚本只看退出码即可。

### 错误对象与 13 个错误码

失败时 `error` 是 `{code, message, details?}`：`code` 是 `E_` 开头的字符串，`message` 是给人看的一行，`details` 只放该码声明过的结构化字段（实测最常见的是 `launch` 的 `details.candidates`）。

| 错误码 | 含义与实测触发 |
| --- | --- |
| `E_USAGE` | 命令行用错：未知命令、未知选项、缺值、多余位置参数、取值校验失败。出现频率最高 |
| `E_NOT_PROJECT` | 目录里（或上/下 3 层内）找不到 MZ/MV、Ren'Py、RGSS 或 Kirikiri 项目。实测空目录报的是 RPG Maker 措辞：`not an RPG Maker project (no js/rmmz_core.js or js/rpg_core.js found in <dir> or up to 3 levels below it)`——检测顺序是 MZ → MV → Ren'Py → RGSS → Kirikiri（`src/engines/registry.js:18`），第一条「这里什么都没有」的消息胜出，所以其他 adapter 自己那句 `not a Ren'Py project (...)` / `not an RGSS project (...)` / `not a Kirikiri project (...)` 在 CLI 上都看不到 |
| `E_MULTI_ROOT` | 目录下同时有多个项目，必须直接指定其中一个。MZ/MV：`found 2 RPG Maker projects under <dir>, pass one of them instead: <a>, <b>`；Ren'Py：`found 2 Ren'Py projects under <dir>, pass one of them instead: <a>, <b>`；RGSS：`found 2 RGSS projects under <dir>, pass one of them instead: <a>, <b>`；Kirikiri：`found 2 Kirikiri projects under <dir>, pass one of them instead: <a>, <b>`（实测两个 RGSS 或两个 Kirikiri 项目同级时报这个，没有 `details`） |
| `E_NO_DICTIONARY` | 还没有 `yakusha/dictionary.json`，先跑 `extract`。RPG Maker 的普通 `install` 不读字典，缺字典也照样成功；带 `--embed` 或 Ren'Py 的 `install` 才报（见下文缺字典表）。RGSS 与 Kirikiri 的 `install` / `uninstall` 与字典无关，缺不缺都报 `E_NOT_IMPLEMENTED` |
| `E_DICTIONARY` | 字典 JSON 解析失败或结构不对，message 是解析器原文，例如 `Expected property name or '}' in JSON at position 2 (line 1 column 3)` |
| `E_EXISTS` | 目标已存在且没给覆盖开关；`export` 拒绝覆盖项目字典本身，即使加了 `--force` |
| `E_EXE` | `launch` 找不到 .exe，或候选不唯一 |
| `E_PROVIDER` | provider 名字不认识：`unknown provider: nope (expected openai or mock)`。注意单条请求失败（HTTP 非 2xx、连不上端点）不会到这里——整批失败只是把条目记进 `rejected`，命令仍 `ok`；HTTP 状态码只出现在 rejected 的 reason 里（`request failed: provider returned HTTP 401`） |
| `E_CONFIG` | 配置缺失或非法：没有 provider、没有 key、compatible 缺 baseUrl、配置文件损坏 |
| `E_IO` | 读写文件失败；文件系统错误码（ENOENT / EACCES / EISDIR / ENOSPC 等）统一映射到这里 |
| `E_NOT_IMPLEMENTED` | 能力已声明但没实现。0.10 引入时只有 `attach`（无 CLI 入口，`yakusha attach` 是未知命令）；0.12 起 RGSS、0.13 起 Kirikiri 的 `install` / `uninstall` 都会报这个码，消息分别是 `install is not implemented for RGSS yet - see the pending decisions in docs/dev/DEVLOG.md` 与 `install is not implemented for Kirikiri yet - see the pending decisions in docs/dev/DEVLOG.md`（`uninstall` 同形），退出 2、不写任何文件 |
| `E_UNSUPPORTED_PLATFORM` | 当前平台不支持该命令。目前只有 `launch`（仅 Windows）会报 |
| `E_INTERNAL` | 未预期异常，兜底。不该出现，出现就是 bug |

错误码不区分「用户输入错」和「环境错」，一律退出 2，脚本不需要按码分流。

### 消息脱敏

- `message` 单行、最长 500 字符；换行折成空格，ANSI 转义和 C0 控制字符被删掉。
- stack 永不进 JSON。`YAKUSHA_DEBUG=1` 时才把 `CliError: <message>` 加 8 行 stack 打到 stderr（实测里面会带 `file:///…` 形式的绝对路径），stdout 的 JSON 一个字节都不变。
- 凭据一律打码：`sk-` 开头且长度 ≥ 8 的 key 变成 `sk-***`，`Bearer <token>` 变成 `Bearer ***`，URL 里的 userinfo（`https://<user>:<password>@host` 这种形状）变成 `https://***@host`。
- home 目录显示成 `~`（实测 home 下的 `x` 变成 `~\x`）；命令自己解析出的其他绝对路径保留，否则报错没法定位文件。
- provider 返回的响应体既不进 `message` 也不进 stderr，只留 `provider returned HTTP <status>`；响应体可能回显 `Authorization`，一律不落盘、不打印，只在 `YAKUSHA_DEBUG=1` 时仍靠 stack 定位调用点。
- 单条请求失败不算命令失败：失败批里的条目进 `rejected`，reason 记成 `request failed: <message>`，命令照样 `ok`；只有配置/鉴权层面的失败才让整个命令报 `E_PROVIDER` / `E_CONFIG` 退出 2。

### stdout 与 stderr

- JSON 模式：stdout 只有一个 JSON 对象；进度、警告、调试全部 stderr，警告带 `warning: ` 前缀。
- 文本模式：结果走 stdout，错误与警告走 stderr。两者不混排，重定向 stdout 拿到的永远是结果。

### --help 与 --version

- `--help` / `-h`：永远 stdout 纯文本、退出 0，即使同时给了 `--json`；`scan -h` 也一样打整段帮助。连未知命令都投降：`nope --help` 打帮助、退出 0。
- `--version`：永远 stdout 一行 `yakusha <version>`、退出 0，并且优先于一切——`--help --version` 只打 `yakusha 0.13.0`，`--json --version` 也不产出 JSON。
- 无命令：文本模式把整段 USAGE 打到 stderr、退出 2；`--json` 时输出 `command: null` 的信封，`message` 是 `no command`。
- 未知命令：stderr 两行 `error: unknown command: nope` 和 `run 'yakusha --help' for usage`，退出 2，不再打印整段 USAGE。

### 参数解析

- `--flag value` 与 `--flag=value` 等价。
- 布尔选项不吃值：`--json=1` 报 `option --json does not take a value`。
- 值的下一个 token 不能以 `--` 开头：`--out --force` 报 `option --out requires a value`，`--out=` 同样。
- `--` 之后全部按位置参数处理，不再当选项；多出来的位置参数报 `unexpected argument: <arg>`。
- 全局选项 `--json` / `--help` / `-h` / `--version` 可出现在任意位置；其余选项按命令白名单校验：`scan --limit 3` 报 `unknown option for scan: --limit`，不认识的长选项报 `unknown option: --bogus`。
- 只有 `-h` 一个短选项，`-j` 之类报 `unknown option: -j`。
- 标量选项重复时最后一个生效（`--out a.json --out b.json` 只写 b.json）；布尔重复幂等；只有 `--context` 可以重复，语义是「任一命中」。
- 位置参数个数按命令校验：`config` 与 `import` 不接游戏目录（`import` 的对象是 `--from` 指定的文件），其余命令恰好一个，缺了报 `no game directory given`。
- 解析在任何副作用之前完成：`translate --bogus /nope` 报的是未知选项，不是「目录不是项目」。

## config：用户级配置

`config` 读写一份用户级配置，不接游戏目录。0.10 起就不做项目级配置，0.11 至 0.13 都没变：游戏目录里没有任何东西能改 provider 或 baseUrl。

```text
yakusha config list
yakusha config get <provider|model|baseUrl>
yakusha config set <provider|model|baseUrl> <value>
yakusha config unset <provider|model|baseUrl>
```

文件在 `%APPDATA%\yakusha\config.json`，即 `<用户目录>\AppData\Roaming\yakusha\config.json`。`YAKUSHA_CONFIG_DIR` 可以换目录——是目录不是文件，必须是绝对路径，文件名固定仍是 `config.json`；不展开 `~`，也不看 `XDG_CONFIG_HOME`。两个都没设时读配置直接 `E_CONFIG`。

### 三个键与优先级

| 键 | 取值与校验 | 优先级（高 → 低） |
| --- | --- | --- |
| `provider` | `openai` / `compatible` / `mock`，无默认 | `--provider` → 文件 → 无（`E_CONFIG`） |
| `model` | 非空、≤ 200 字符、无控制字符，无默认 | `--model` → `YAKUSHA_MODEL` → 文件 → 无（`E_CONFIG`） |
| `baseUrl` | 绝对 http(s)、无 userinfo/query/fragment、≤ 2000 字符 | `--base-url` → `YAKUSHA_BASE_URL` → 文件 → 只有 openai 有默认 `https://api.openai.com/v1` |
| `apiKey` | 只在内存里，从不落盘 | `--api-key` → `YAKUSHA_API_KEY` → `OPENAI_API_KEY` → 无（`E_CONFIG`） |

- 默认 baseUrl 只对 `provider=openai` 生效；`compatible` 必须自己给，否则 `E_CONFIG`：`no base URL configured for provider compatible: pass --base-url, set YAKUSHA_BASE_URL, or run: yakusha config set baseUrl <url>`。
- 没有内置模型。什么都不配时 `translate` 报 `E_CONFIG`：`no provider configured: pass --provider openai or --provider compatible, or run: yakusha config set provider openai`。
- `--provider mock`、`--dry-run`、`--glossary-only` 三者都不需要配置，`--dry-run` 甚至不读配置文件（配置文件坏了也照跑）。

### apiKey 永远不落盘

- 文件里没有 apiKey 键。`config set apiKey ...` 和 `config get apiKey` 都报同一条 `E_USAGE`：`the API key is not stored in the config file; use --api-key or YAKUSHA_API_KEY`。
- 手写进文件的 `apiKey`（以及 `key` / `token` / `authorization`）会被忽略并在 stderr 警告：`warning: ignoring sensitive key "apiKey" in <path>; keys are not stored in the config file`。未知键（实测 `"wat": 1`）原样保留，`set` / `unset` 只改目标键。
- 不靠文件权限挡密钥（Windows 上 chmod 0600 无效），所以干脆不存。GUI 的「记住密钥」留到后续版本用系统凭据存储。

### 写盘与损坏的文件

落盘格式实测（2 空格缩进、LF、末尾一个换行）：

```json
{
  "schema": 1,
  "provider": "openai",
  "model": "gpt-x"
}
```

顶层 `schema` 是文件格式版本，当前只认 `1`：文件里没有这个键时按 `1` 处理，写盘时总是先写 `"schema": 1`。写成别的值等于文件不可用——`config` 系列报 `E_CONFIG`（`unsupported config schema 2 in <path> (fix or delete it)`，且不覆盖原文件），`translate` 则按坏文件处理：stderr 一行 `warning: unsupported config schema 2 in <path>; using defaults`，然后照常跑。

- 写入是先写同目录临时文件再 rename；失败报 `E_IO`，原文件不动。目录不存在会连父目录一起创建。
- 文件是坏 JSON 时：`translate` 只在 stderr 打一行 `warning: config file is not valid JSON: <path>; using defaults`，然后照常跑（实测真的翻译成功了）；`config list/get/set/unset` 必须失败 `E_CONFIG`，message 是 `config file is not valid JSON in <path> (fix or delete it)`，并且绝不覆盖原文件（实测文件字节不变）。
- 取值校验在写盘之前：`provider must be openai, compatible or mock`、`baseUrl must use http or https`、`model must not be empty`，都是 `E_USAGE` 且一个字都不写。
- 子命令缺省也算用错：光给 `config` 报 `config needs a subcommand: list, get, set or unset`，`config nope` 报 `unknown config action: nope`，`config get` 报 `config get needs a key`。

### 载荷的 action 字段

`config` 的 `command` 恒为 `"config"`，载荷靠 `action` 区分，取值只可能是 `list` / `get` / `set` / `unset`：

| action | 载荷 |
| --- | --- |
| `list` | `{action, file, exists, values{provider, model, baseUrl}, apiKey{set, source}}`，每个键是 `{value, source}` |
| `get` | `{action, key, value, source}` |
| `set` | `{action, key, value, file, changed}` |
| `unset` | `{action, key, file, changed}`，没有 `value` |

`source` 是 `none` / `default` / `file` / `env` 四选一（`env` 只可能出现在 model 与 baseUrl）；`apiKey` 只报 `set` 与来源名（实测可以是 `OPENAI_API_KEY`），永远不回显值。同值 `set`、不存在的键 `unset` 都是 `changed: false`，仍算 `ok`、退出 0。

`config list` 实测文本输出（空配置）：

```text
file    : <abs>\config.json
exists  : false
provider: (not set)
model   : (not set)
baseUrl : https://api.openai.com/v1 (default)
apiKey  : (not set)
```

有文件值时后缀变 ` (file)`，来自环境变量时变 ` (env)`。baseUrl 被设成非默认地址后，list 会额外在 stderr 打一条 `warning: requests will be sent to <url>`（JSON 模式也走 stderr）。

为什么不做项目级配置、`--api-key` 的暴露面、`launch` 如何清掉子进程里的密钥环境变量，完整威胁模型见 [config.md](config.md)。

## scan、extract、status：盘点与建库

`scan` 只读，不写任何文件。实测输出（夹具 mini-mz）：

```text
game      : テストゲーム
root      : <abs>
engine    : mz 1.7.0
data files: 7
strings   : 32 unique / 32 total
w/ codes  : 2
  System.json             14
  CommonEvents.json       6
  ...
```

末段按条数降序列出每个数据文件的字符串数。载荷键：`root` / `engine` / `engineVersion` / `gameTitle` / `dataFiles` / `uniqueStrings` / `totalStrings` / `stringsWithControlCodes` / `encodings` / `undecodable` / `perFile` / `capabilities`（0.16 起随每个引擎返回能力位对象，GUI 用它禁用该引擎不支持的操作；字段含义见 docs/json-contract.md §7）。MV 项目实测 `engine: "mv"`、`engineVersion: "1.6.2"`（mini-mv 夹具：2 个数据文件、3 条串、0 条带控制码）。

**Ren'Py 的差异**（夹具 `test/fixtures/renpy-extract/rpy`）：

```text
game      : rpy
root      : /games/MyGame
engine    : renpy
scripts   : 2
strings   : 7 unique / 8 total
w/ codes  : 0
encodings : rpy 2, rpyc 0
  game/script.rpy         6
  game/sub/chapter.rpy    2
```

- 第 4 行标签是 `scripts` 而不是 `data files`（代码里看 `adapter.dataUnit`），数值仍是 `dataFiles` 键。
- `engineVersion` 只在 `game/options.rpy` 写了 `define config.version` 时才有值（实测写 `"9.9.9"` 后文本模式打 `engine    : renpy 9.9.9`），否则是 `null`——Ren'Py 项目本身没有必填的版本字段。`gameTitle` 取自同一文件的 `define config.name`，没有该文件时退化成项目根目录名。
- `encodings` 是脚本格式计数 `{"rpy": N, "rpyc": N}`，MZ/MV 是 `{"json": N}`；`encodings` 与 `dataFiles` 是两个独立对象。
- `perFile` 的键是相对项目根的 POSIX 路径（`game/script.rpy`），不是数据文件名。
- `undecodable` 在这个引擎上是**字符串**数组，形如 `"game/broken.rpyc: rpyc slot table is truncated at byte 10"`（`file + ": " + error`）；MZ/MV 侧放的是文件名。解码失败的文件在文本模式多打一行 `UNDECODED : ...`，退出码仍是 0。
- 同一脚本同时有 `.rpy` 和 `.rpyc` 时只读 `.rpy`（源码优先，避免同一行算两次），`encodings` 里 `rpyc` 计 0。
- 从 `<root>/game` 子目录调用同样能定位项目根。

`options.rpy` 只做静态文本解析（`define config.name` / `define config.version` 两个赋值），不执行脚本；夹具 `renpy-extract/*` 没有这个文件，所以上面那份实测输出里 `engineVersion` 是缺失的 `null`。

**RGSS 的差异**（`test/rgss-fixture.js` 现生成的 RGSS3 项目，7 个 `.rvdata2`、29 条串）：

```text
game      : Synthetic Quest
root      : <abs>
engine    : rgss 3
data files: 7
strings   : 29 unique / 29 total
w/ codes  : 1
encodings : rvdata2 7
  System.rvdata2          10
  Map001.rvdata2          9
  ...
```

- 第 4 行仍叫 `data files`（`adapter.dataUnit`，`src/engines/rgss/adapter.js:280`），数的是**读过的 Marshal 文档数**（`result.documents`），不是磁盘上的文件数——打包版一块 `.rgss3a` 里能读出 394 个文档。
- `engineVersion` 是 `"1"` / `"2"` / `"3"` 或 `null`（字符串，不是 `"1.7.0"` 那种点分版本）；文本模式拼在引擎名后面，写成 `engine    : rgss 3`。判定按这个顺序（`src/engines/rgss/project.js:309` 的 `detectVersion`）：归档扩展名（`.rgss3a` → 3 / `.rgss2a` → 2 / `.rgssad` → 1）→ `Game.ini` 的 `Library=`（`RGSS300` / `RGSS301` → 3，`RGSS20x` → 2，`RGSS10x` → 1）→ `Scripts=` 的扩展名 → `Data/` 里的文件扩展名 → `null`。归档排第一，因为打包游戏没有数据文件可看。
- `gameTitle` 取自 `Game.ini` 的 `Title=`；`Game.ini` 按 UTF-8 → Shift_JIS → GBK → latin1 的顺序解码（编辑器按系统区域写这个文件）。
- `encodings` 分两种：磁盘版按扩展名计数（`{"rvdata2": 7}`，`.rxdata` / `.rvdata` / `.rvdata2` 各自计数），打包版是 `{"marshal": N}`——归档里的文档没有磁盘扩展名可比，只能按容器格式计。
- `perFile` 的键是数据文件名（`System.rvdata2`），不是路径；`undecodable` 是字符串数组，元素形如 `"<文件名>: <解码错误>"`（`src/engines/rgss/adapter.js:118`）。
- 从 `<root>/Data` 子目录调用同样能定位项目根；项目根向上找最多 3 层、向下找最多 3 层。

RGSS 项目认三种文件之一：根目录的 `Game.ini`（大小写不敏感）、`*.rgssad` / `*.rgss2a` / `*.rgss3a` 归档，或 `Data/` 目录下的 `.rxdata` / `.rvdata` / `.rvdata2`。抽取范围（收哪些事件指令、哪些数据库字段）见 [engines.md](engines.md) §13 文本抽取契约。

**Kirikiri 的差异**（`test/krkr-fixture.js` 现生成的合成项目，`data/scenario.xp3` 里 2 个 `.ks`、3 条串）：

```text
game      : (untitled)
root      : <abs>
engine    : krkr
data files: 1
strings   : 3 unique / 3 total
w/ codes  : 0
encodings : xp3 1
  scene1.ks               2
  small.ks                1
```

- `.xp3` 归档在游戏根目录或 `data/` 下都能识别；`engineVersion` 与 `gameTitle` 恒为 `null`（0.13 不解析任何加密或可选的配置文件），文本模式第 1 行是占位符 `(untitled)`、第 4 行 `engine    : krkr` 不带版本后缀。
- 第 4 行仍叫 `data files`（`adapter.dataUnit`，`src/engines/krkr/adapter.js:273`），数值是 `dataFiles` 键，数的是**打开的 `.xp3` 归档数**（`result.documents`）——打包游戏没有松散文件可数，归档清单是唯一诚实的数字。
- `encodings` 是归档格式计数 `{"xp3": N}`，0.13 只有这一个键。
- 文本从 `.ks` 脚本按行抽：注释行（行首 `;`）、标签行（行首 `*`）与纯标签行跳过，行内 KAG 标签（`[r]` 这类）剥掉后存纯文本；`.tjs` 是编程语言，只计数不读内容。编码先按 UTF-8 严格解码、失败回退 Shift_JIS，仍解不开的记进 `undecodable`。
- `perFile` 的键是归档内路径（`scene1.ks`），context 是 `<归档内文件名>:<行号>`（`scene1.ks:2`）；`undecodable` 是字符串数组，元素形如 `"scenario.xp3:scene1.ks: U+FFFD …"`（`<归档名>:<文件名>: <错误>`，`src/engines/krkr/adapter.js:113`）。
- XP3 索引只读标准格式（索引体以 `File` 开头）；修改版索引（实测发行版里见过 `Hxv4`）明确不支持，报 `E_UNSUPPORTED` 而不是猜（`src/engines/krkr/xp3.js:77`）。同名补丁 `.xp3` 不遮蔽基础归档，两个都读。损坏的归档或索引记进 `undecodable` 后继续走完整个游戏，不因一个文件丢掉其余文本。
- 从 `<root>/data` 子目录调用同样能定位项目根；向上、向下各找最多 3 层。

`extract` 建 `yakusha/dictionary.json`，只加新串、不改已有译文，可以反复跑：

```text
dictionary: <abs>\yakusha\dictionary.json
added     : 32
progress  : 0/32 translated, 32 pending
```

第二次跑 `added` 变 0。载荷：`file` / `added` / `total` / `translated` / `pending`。

缺字典（没跑过 `extract`）时各命令的反应不一样，实测：

| 命令 | 行为 |
| --- | --- |
| `status` / `translate` / `verify` / `speaker` / `terms` / `export` | 报 `E_NO_DICTIONARY`（`no dictionary yet: <path>`），退出 2 |
| `doctor` | 不报错，`dictionary` 检查记 `fail`、`verdict` 变 `broken`，退出 1 |
| `install`（RPG Maker） | 照样成功（插件在运行时才读字典），只是装完游戏里没得可读 |
| `install`（Ren'Py） | 报 `E_NO_DICTIONARY`，退出 2——翻译脚本必须在安装时就把译文写进去 |
| `install` / `uninstall`（RGSS） | 报 `E_NOT_IMPLEMENTED`，退出 2——这个引擎没有交付层，缺不缺字典都一样报 |
| `install` / `uninstall`（Kirikiri） | 同 RGSS：报 `E_NOT_IMPLEMENTED`，退出 2，与字典无关 |

**contexts 的形状按引擎不同。** 它记录「这条串在哪里出现」，格式是 `<文件>:<字段>` 或 `<文件>:<行号>`：

| 引擎 | 例子 |
| --- | --- |
| MZ/MV | `Items.json:description`、`Actors.json:name`、`CommonEvents.json:401`（事件指令行） |
| Ren'Py（有行号） | `game/script.rpy:12`、`game/sub/chapter.rpy:3` |
| Ren'Py（`.rpyc` 无行号） | `game/script.rpyc`（只有路径，不写悬空的冒号） |
| RGSS（事件指令） | `Map001.rvdata2:401`（指令号）、`CommonEvents.rvdata2:102`（选项标签） |
| RGSS（数据库字段） | `Actors.rvdata2:name`、`Actors.rvdata2:description`、`System.rvdata2:terms.params`、`MapInfos.rvdata2:name` |
| Kirikiri（`.ks` 行） | `scene1.ks:2`（归档内路径加 1 起始行号） |

新建条目的 `contexts` 会排序后落盘；同一条串在多处出现就有多个 context。实测 `test/fixtures/renpy-extract/lineless` 的 5 条串全部只有路径 `["game/script.rpyc"]`。

`status` 只读一行进度：`progress  : 32/32 translated, 0 pending`。载荷多一个 `withError`（模型拒答或被校验挡下的条目数），`withError > 0` 仍算 `ok`。`status` 与引擎无关，Ren'Py 字典同样只输出这一行。

## translate：调用模型填字典

`translate` 是唯一会写字典正文并花钱的命令。实测（mock provider）：

```text
provider  : mock
translated: 32/32 this run
progress  : 32/32 translated, 0 pending
elapsed   : 0.0s
```

进度条走 stderr。载荷：`file` / `provider` / `elapsedMs` / `total` / `translated` / `overwritten` / `rejected` / `failedBatches` / `rewrapped` / `cancelled` / `progress{total,translated,pending}`。`cancelled` 是协作式取消标记：CLI 恒 `false`（0.14 引入，GUI 的取消按钮走同一接口），取消后翻译中的请求自然结束、已翻条目保留。

- `--dry-run` 只算不写：`dry run   : 32 of 32 would be translated (not saved)`，载荷换成 `{dryRun, provider, total, translated, rejected}`；同时给了 `--provider` 会警告 `warning: --dry-run always uses the mock provider; --provider openai ignored`。
- `--glossary <file>` 收两种形状：`{"entries": {...}}` 或裸映射 `{"アリア": "艾莉亚"}`。文件不存在报 `E_IO`：`glossary file not found: <path>`。
- `--glossary-only` 只套词表、绝不调模型，此时 `provider` 是 `glossary`；不带 `--glossary` 也成功，只是 0 条。
- `--limit` / `--context` / `--batch-size` / `--char-budget` / `--concurrency` / `--save-every` / `--max-length` / `--no-rewrap` 控制批量、并发、落盘节奏与重排宽度；数字选项给了非有限值（如 `--limit abc`）会静默回到默认值，不报错。
- 有 `rejected > 0` 时仍 `ok`、退出 0——坏条目留给 `verify` 报。

RGSS 与 Ren'Py 都走这同一段代码，没有引擎特判：实测 RGSS 的 29 条串 `--provider mock` 一次翻完，输出四行与上面逐字相同（只是数字是 29）。控制码的识别共用 `src/core/textkey.js` 的 `tokenize()`：它把反斜杠开头的转义码当不透明 token，`\C[n]` 这种带方括号参数的、`\!` `\>` 这种单字符的都是同一套规则，所以 RGSS 的转义码不必另写一份。

## verify：十条判据

`verify` 读字典，不调模型、不写字典（除非 `--write-report`）。判据实现是固定的十条：

| kind | 级别 | 判据（实现里的 detail 原文） |
| --- | --- | --- |
| `kana` | warn | `Japanese kana left in the translation` |
| `echo` | error | `target is identical to a Japanese source` |
| `codes` | error | 译文里的控制码集合与原文不一致 |
| `slots` | error | 译文里的占位符与原文不一致 |
| `lines` | warn | `line breaks differ: N vs M` |
| `width` | warn | `line is N columns, limit is M`，只在给了 `--max-length` 时启用 |
| `no-text` | warn | `no Han characters in the translation` |
| `trad` | warn | `traditional characters: <chars>` |
| `speaker` | error / warn | `speaker name left in Japanese: <name>`、`speaker name left untranslated: <name>`、`speaker name rendered as ... , elsewhere ...` |
| `rejected` | warn | 模型拒答或被校验挡下的条目 |

`echo`、`codes`、`slots`、`speaker` 是阻断级（error），其余只算警告。`--kind` 用逗号分隔可限流，给一个不认识的名字不是错误——实测 `--kind bogus` 得到 `counts: {}`、`problems: []`、`outcome: ok`，静默过滤。

实测（mock 翻译后的夹具）：32 条已译文本上有 20 条 kana 警告；把一条译文改成与原文相同后变成 21 条、`counts: {"kana": 20, "echo": 1}`，`outcome` 变 `findings`、退出 1：

```text
entries   : 32 (32 translated, 0 pending)
problems  : 21 (echo 1, kana 20)
  [warn] kana "アリア"
        Japanese kana left in the translation
  [error] echo "アリア"
        target is identical to a Japanese source
  ... 19 more, raise --limit or pass --json
result    : FAILED, 1 error(s)
```

列表按字典键顺序输出、kind 交错（同一键能同时中 kana 和 echo，两条会挨着；不是按 kind 分组，只有 `--write-report` 生成的 markdown 才按 kind 分组），每条下一行缩进 8 空格写 detail，`--limit`（默认 20）截断后补一行提示。全绿时末行是 `result    : OK with 20 warning(s)`、退出 0；0 条已译时只有两行 `entries` 和 `problems  : none`。载荷：`file` / `maxColumns` / `total` / `translated` / `pending` / `errors` / `warnings` / `rejected` / `counts` / `problems[]`，每个 problem 是 `{kind, severity, key, target, detail}`。

### 判据的边界

- 中点 `・`（U+30FB）和长音符 `ー`（U+30FC）不算假名，不会被 `kana` 报。
- 形如 `MAP001`、`ＨＰ` 的纯 ASCII／全角字母数字不报 `no-text`；整行拟声词也不强制要求汉字。
- `trad` 只报原文里没有的繁体字，字表来自 OpenCC 的 TSCharacters（Apache-2.0），只收「一繁对一简且不同」的字，排除 乾 / 藉 / 於 / 瞭 / 徵 这类两边都合法的。
- `speaker` 按三档判级：名字还是日文（error）、名字没翻（error）、同一名字在本作里出现多种写法（warn，只有 `speaker --include-drift` 会去改）；尖括号里的代码表达式（如 `<50*\v[65]>`）不会被误认成名字。
- Ren'Py 的 `codes` / `slots` 走同一套判据，只是「控制码」换成了文本标签与变量插值：标签漏掉报 `escape codes differ: ["{i}","{/i}","[player_name]"] vs []`，插值漏掉报 `placeholders differ: ["[player_name]"] vs []`（实测把两者的译文标记删干净后，`counts` 是 `{"codes": 1, "kana": 1, "slots": 1}`，两个 error、退出 1）。`kana` 与 `trad` 在两种引擎上完全一样。
- RGSS 的 `codes` 判的是反斜杠转义码。实测把一条带 `\C[6]` / `\C[0]` 的译文改成纯中文后，`codes` 报 1 个 error、退出 1，detail 是 `escape codes differ: ["\C[6]","\C[0]"] vs []`（`src/pipeline/verify.js:184-192` 的 `codes` 分支对所有引擎共用，没有 RGSS 专有的判据）。`kana` / `trad` / `echo` 等在 RGSS 上与 MZ 完全一致。
- Kirikiri 的「控制码」是行内 KAG 标签（`[r]`、`[er]` 这类），`codes` 同样报 `escape codes differ: [...] vs []`；`slots` 只认 `%1`、`%2` 这种 `%<数字>` 占位符（`src/engines/krkr/profile.js:123`，KAG 的 `[emb exp=...]` 标签不进这个判据）；假名判据 `VERIFY_KANA` 在 `src/engines/krkr/profile.js:26`，其余 kind 与 MZ 一致。

### --write-report

`--write-report <file>` 把全部发现写成一份 markdown，载荷多一个 `report` 字段，文本模式多一行 `report    : <abs>`。报告真实结构：

```text
# yakusha verify report

| field | value |
| --- | --- |
| game | テストゲーム |
| dictionary | `<abs>` |
| generated | 2026-10-26T10:59:37.979Z |
| max-length | 0 (width check off) |
| entries | 32 (32 translated, 0 pending, 0 rejected) |
| problems | 20 (0 errors, 20 warnings) |

**OK with 20 warning(s)** - nothing blocks a release.

## kana (20)

_kana the player will see; onomatopoeia often keeps one on purpose_

1. warning: `アリア` -> `译:アリア`
   Japanese kana left in the translation
```

0 条发现时正文是 `**OK** - no findings at all.`。报告里换行显示成 `⏎`（U+23CE），这样一条多行台词在一行里看得完。

## speaker：行内说话人名字

RPG Maker 的台词常把说话人写在正文里（`\N<名字>` 这类尖括号标记），`speaker` 从游戏自己的渲染里统计每个名字的主流写法，再把不一致的改过来——不调模型，只改字典。

它只认尖括号标记，而 Ren'Py 的角色名写在 `define` / `Character(...)` 里、进文本时是变量插值，所以 Ren'Py 项目上这个命令是空转：实测 `entries: 0`、`tags: 0`、`names: []`，文本输出仍是下面这两行。

RGSS 上也一样空转，但原因不同：说话人名在事件指令 101 的 `parameters[0]` 里，抽取时是**独立的一条串**，不是台词行里的尖括号标记，`speaker` 的 `TAG_TEXT` 白名单（`src/pipeline/speaker.js:29`）自然一条也匹配不到。实测 RGSS 项目的输出是 `names     : every speaker tag already matches the rest of this game` 与 `result    : no change`，载荷里 `entries: 0`、`tags: 0`、`names: []`。也就是说 RGSS 的说话人名目前只能靠 `translate` / `--glossary` 保证一致，`speaker` 帮不上。

Kirikiri 上同样空转：KAG 的说话人写在独立的 `[name_set name='...']` 标签行里（抽取时记成后续文本行的说话人，不混进台词正文），台词行里没有尖括号标记，`TAG_TEXT` 白名单一条也匹配不到，输出同样是 `result    : no change`、`entries: 0`、`tags: 0`。

```text
names     : every speaker tag already matches the rest of this game
result    : no change
```

- `--include-drift` 才处理「同一名字多种写法」的风格问题（默认不动，因为那是编辑判断）。
- `--write-names <file>` 生成一份供 `--names` 填的模板（实测落盘 `{"entries": {}}`），文本模式首行 `names file: <abs> (nothing to fill in)`；`--names <file>` 补上「游戏里从没翻译过、因此无从抄写法」的名字，文件不存在报 `E_IO`。
- 载荷：`file` / `includeDrift` / `dryRun` / `supplied` / `saved` / `entries` / `tags` / `names[]` / `namesFile` / `namesNeeded` / `errorsBefore` / `errorsAfter` / `warningsBefore` / `warningsAfter`。

实测（一款 MV 长篇，词典规模见上一节）：`verify` 报 411 个 speaker error，`speaker` 一次改掉 414 条、涉及 23 个名字，剩 3 条是全文没译过的名字，用 `--names` 补上后 error 归零；再用 `--include-drift` 把 8 个存在多种写法的名字统一到主流写法，`warn` 从 51 归零。两轮都只动字典，没有调用模型。

## terms：名字写法挖掘与漂移

`terms` 从已译条目里反推每个名字的主流写法，报告三种状态：`ok`（一致）、`drift`（同一名字有少数派写法）、`missing`（游戏里出现过但没有任何可抄的译法）。

```text
names     : 3 mined from 3 name entries
skipped   : 0 untranslated, 0 too short, 0 prose-like
terms     : none (needs at least 5 translated lines mentioning a name)
glossary  : 0 entries, pass --write <file> to save them
```

阈值由 `--min-holders`（默认 5：一个名字至少被 5 条已译文本提到才挖）和 `--min-support`（默认 0.5：主流写法至少要占一半）控制；夹具只有 32 条串，所以一条也挖不出来——这是正常结果，不是失败。

「名字条目」的判定写死在 RPG Maker 的上下文格式上（`^(Actors|Enemies|Classes|Items|Weapons|Armors|Skills|States)\.json:name$`，`src/pipeline/terms.js:34`）。Ren'Py 的 contexts 是 `game/script.rpy:12` 这种路径，永远匹配不上，因此 Ren'Py 项目上 `nameEntries` 恒为 0、`mined` 恒为 0：实测输出 `names     : 0 mined from 0 name entries`。

RGSS 撞的是同一堵墙、换了个方向：数据库名字条目的 context 是 `Actors.rvdata2:name` 这种形状，扩展名是 `.rvdata2` 而不是 `.json`，正则同样匹配不上，所以 RGSS 项目上 `nameEntries` / `mined` / `drift` / `missing` 恒为 0，实测输出也是 `names     : 0 mined from 0 name entries`。Kirikiri 撞的还是这堵墙：`.ks` 的 context 是 `scene1.ks:2` 这种形状，既不是 `.json:name` 也不是数据库字段，正则匹配不上，所以 Kirikiri 项目上 `nameEntries` / `mined` / `drift` / `missing` 恒为 0。这套名字一致性机制目前只对 MZ/MV 有效。载荷：`file` / `names` / `nameEntries` / `skipped{untranslated, short, prose}` / `holdersMin` / `supportMin` / `mined` / `listed` / `drift` / `missing` / `glossary` / `written` / `terms[]`。

`--write <file>` 把词表写成 `translate --glossary` 吃的格式（`{"format": "yakusha/glossary/1", "game": ..., "generatedAt": ..., "entries": {...}}`），文本末行变 `glossary  : N entries written to <abs>`；`--dry-run` 只报不写（`--dry-run, not written`）；没写文件时 JSON 的 `written` 是 `null`。

### 为什么值得看 drift

实测一款 38,044 条唯一串的 MZ 长篇：名字表里写的是 アリア → 艾莉亚，但正文提到她的 3,653 行里 96% 写的是 阿莉亚，只有 4% 用名字表写法。玩家会在同一段剧情里看到两个名字，而这在 `verify` 里一条都不报——它只查假名、回显、控制码这类机械问题，名字一致性是 `terms` 的活。

四款作品的实测分布（`terms` 全量跑一遍）：

| 作品 | 名字条目 | 挖出的名字 | drift | missing |
| --- | --- | --- | --- | --- |
| MZ-A | 510 / 612 | 52 | 5 | 0 |
| MV-G | 156 / 215 | 20 | 2 | 0 |
| MV-H | 145 / 148 | 6 | 0 | 0 |
| MZ-G | 45 / 45 | 3 | 0 | 3 |

## 术语表（glossary）

`translate --glossary <file>` 是一张「原文 → 固定译文」的表：命中就跳过模型，保证人名、地名、招式名全篇一致。`--overwrite` 才允许它覆盖已译条目（默认只填空条目）；`--glossary-only` 只套表、绝不调模型。

词表值得花时间做，但别指望它替掉全量翻译。实测在一款 38,044 条唯一串的作品上，127 条人工词表覆盖了 18.4% 的文本出现次数；要做到 42% 覆盖得靠前 5,000 条。词表是「统一术语」的工具，剧情的机器翻译必须跑全量。

## install 与 uninstall

`install` 的产物按引擎不同：RPG Maker 写插件并注册到 `js/plugins.js`，Ren'Py 生成一个翻译脚本，RGSS 与 Kirikiri 没有交付层、直接报 `E_NOT_IMPLEMENTED`。载荷键名前两个引擎相同（6 个），只是部分键在 Ren'Py 下恒为 `null` / `false`；RGSS 与 Kirikiri 因为装不上，一条载荷都没有。

**RPG Maker（MZ/MV）**——第一次会备份原文件：

```text
plugin    : <abs>\js\plugins\YAKUSHA_Translator.js
registered: yes
backup    : <abs>\js\plugins.js.yakusha-backup
dictionary: yakusha/dictionary.json (loaded at runtime)
```

- 重复安装是幂等的：`state` 停在 `unchanged`，`backupPath` 为 `null`、`createdBackup: false`。`state` 取值 `added` / `enabled` / `unchanged`。此时文本模式第 3 行打的是 `backup    : (none)`（0.11 的改动；JSON 一直就是 `null`）。
- `--embed` 把译文编译进插件文件，适合不想让玩家看到 `yakusha/dictionary.json` 的场合。此时文本只剩三行（`plugin` / `registered` / `backup`，**没有** `dictionary` 行）再加一行 `embedded  : 32 translations`。两种前置失败都是 `E_NO_DICTIONARY`、退出 2：没有字典报 `--embed needs a dictionary, run: yakusha extract "<root>"`，有字典但一条都没译报 `--embed found no translated entries`。装完后 `doctor` 的 runtime 行变 `translations compiled into the plugin (32 entries)`。
- `uninstall` 删掉插件条目并从备份恢复 `js/plugins.js`：文本输出 `plugin removed` 与 `plugins.js restored from backup`。载荷：`removed` / `restored` / `backupPath` / `drifted` / `keptBackup`。从未装过时全部 `false` / `null`，仍 `ok`、退出 0。`drifted` 表示备份之后 `plugins.js` 又被别的插件动过，此时保留备份、只删自己的条目。

**Ren'Py**——没有插件系统，`install` 生成 `game/yakusha_translation.rpy`，一个 `translate schinese strings:` 块；不改任何游戏脚本，也不用备份：

```text
translation: <abs>/game/yakusha_translation.rpy
strings    : 7 (schinese)
uninstall  : yakusha uninstall "<abs>"
```

- 文本只有这三行，和 RPG Maker 的四行不是同一套标签。`--embed` 对这个引擎不加任何输出、也不改变产物（实测带不带 `--embed` 都是同样三行、同样文件）。
- 载荷仍是 6 键：`pluginPath`（生成的 `.rpy` 绝对路径）、`registered`（恒 `true`，文件存在即注册）、`state`（`added` / `unchanged`），以及恒为 `null` / `false` 的 `backupPath`、`createdBackup`、`staleBackup`。**0.11 的 Ren'Py 载荷不多带任何键**——文本里那个 `7 (schinese)` 只存在于 adapter 的返回值，没有进 JSON。
- 两道前置检查都是 `E_NO_DICTIONARY`（退出 2）：没有字典 → `no dictionary yet: <file> - run: yakusha extract <game>`；有字典但一条都没译 → `the dictionary has no translated entries yet - run: yakusha translate <game>`。`--embed` 在无已译条目时的文案是 `--embed found no translated entries`。
- 语言固定写进 `config.default_language = "schinese"`（只在它还是 `None` 时设），条目按原文排序、重复原文去重。文件头注释写明「删掉这个文件即卸载」。
- `uninstall` 只删这一个文件：第一次输出 `translation removed`，之后是 `translation file was not installed`（退出码都是 0）。载荷 5 键不变，`restored` 恒 `false`、`backupPath` 与 `keptBackup` 恒 `null`。

**RGSS（XP / VX / VX Ace）——本版没有交付层，`install` / `uninstall` 直接报错。** XP、VX、VX Ace 没有插件系统，译文要真正生效只能写回游戏自己的数据（`Data/*.rvdata2` 或 `.rgss3a` 归档），这一层 0.12 没做，能力声明里 `runtime` 是 `null`（`src/engines/rgss/adapter.js:210`）而不是某种产物。所以：

```text
$ yakusha install <rgss-game>
error: install is not implemented for RGSS yet - see the pending decisions in docs/dev/DEVLOG.md
```

- 错误码 `E_NOT_IMPLEMENTED`、退出 2、stdout 为空；`--json` 的信封是 `{"schema":1,"command":"install","ok":false,"outcome":"error","error":{"code":"E_NOT_IMPLEMENTED","message":"install is not implemented for RGSS yet - see the pending decisions in docs/dev/DEVLOG.md"}}`。`uninstall` 同形，只是消息里 `install` 换成 `uninstall`。
- **一条文件都不写。** 实测跑完 `install` / `uninstall` 后项目目录里仍然只有原来的 `Game.ini` / `Game.rgss3a` 和 `yakusha/dictionary.json`，新增文件为零。
- 报错与有没有字典无关：普通 `install` 在无字典时也报 `E_NOT_IMPLEMENTED`。但 `--embed` 的两道前置检查排在引擎检查**之前**（`src/cli/runner.js:731-736`），所以 `install --embed` 在缺字典时报 `E_NO_DICTIONARY`（`--embed needs a dictionary, run: yakusha extract "<root>"`）、有字典但一条都没译时报 `--embed found no translated entries`，只有真的有已译条目时才落到 `E_NOT_IMPLEMENTED`。
- 两条候选路线都没拍板，因此写成待定而不是猜：纯 JS 把译文写回 `.rvdata2` / `.rgss3a`（读写器已在 `src/engines/rgss/` 里），或原生注入器加 hook DLL（本机没有 C/C++/Rust 工具链，也编译不了）。选哪条会改变 `uninstall` 要还原什么，已记入 `docs/dev/DEVLOG.md` §8.1。
- `doctor` 的对应文案是 `install warn RGSS has no delivery layer yet, so nothing is written back into the game` 与 `runtime info nothing is loaded at run time, so the game keeps showing the original text`（见下一节）。

**Kirikiri——同样没有交付层，`install` / `uninstall` 直接报错。** 文本烧在 `.xp3` 归档里的 `.ks` 脚本中，而 Kirikiri 没有插件目录、没有 `js/plugins.js`，也没有 Ren'Py 那种自带翻译资源的目录；要写回就得重写整个归档，而发行版常用的加密变体（krkr2 的逐文件密钥、krkrz 的 cxdec）需要游戏自己的密钥数据，本项目刻意不碰，所以写回路线在支持它们之前不成立。能力声明里 `runtime` 同样是 `null`（`src/engines/krkr/adapter.js:204`）：

```text
$ yakusha install <krkr-game>
error: install is not implemented for Kirikiri yet - see the pending decisions in docs/dev/DEVLOG.md
```

- 错误码 `E_NOT_IMPLEMENTED`、退出 2、stdout 为空；`--json` 的信封与 RGSS 那个逐字同形，只是 `message` 里的引擎名换成 `Kirikiri`。`uninstall` 同形。
- **一条文件都不写**：实测跑完 `install` / `uninstall` 后项目目录里只有原来的 `.exe` 与 `.xp3` 归档（可能还有 `yakusha/dictionary.json`），新增文件为零。
- 与 RGSS 相同，`--embed` 的两道前置检查排在引擎检查之前：缺字典报 `E_NO_DICTIONARY`，有字典且有已译条目时才落到 `E_NOT_IMPLEMENTED`（实测带字典带 `--embed` 时就是这条错误）。
- 候选路线已记入 [dev/DEVLOG.md](dev/DEVLOG.md) 的待拍板清单；与 RGSS 的两条路线一样，选哪条会改变 `uninstall` 要还原什么。

## doctor：体检

`doctor` 是唯一会同时看引擎、字典、安装产物、备份（仅 RPG Maker）和 `verify` 的命令，只读。它给四种结论（`verdict`）：`ready` / `usable` / `not-installed` / `broken`。

```text
game      : テストゲーム (RPG Maker MZ 1.7.0, 7 data files)
  engine      ok    RPG Maker MZ 1.7.0
  dictionary  ok    32 entries (32 translated, 0 pending)
  sync        ok    every dictionary key still appears in data/
  install     info  not installed - run: yakusha install <game>
  runtime     info  the game reads yakusha/dictionary.json at load time once installed
  verify      ok    0 error, 20 warning(s)
verdict   : not installed yet - run: yakusha install <game>
```

每行是 `id` / `level` / 消息三列，`level` 取 `ok` / `info` / `warn` / `fail`。判定很直接：任何 `fail` → `broken`（`outcome` 转 `findings`、退出 1）；install 检查还是 `info` → `not-installed`（退出 0）；有 `warn` → `usable`；否则 `ready`。载荷：`verdict` / `checks[]` / `failure` / `game` / `dictionary` / `sync` / `install` / `runtime` / `verify`。

注意 `doctor` 的 `verify` 检查把 `verify` 的 error 记成 `warn` 而不是 `fail`（`<N> error, <M> warning(s) - some lines will stay Japanese, see: yakusha verify`），所以译文有阻断级问题也只会让 verdict 变 `usable`、退出 0。要拿发布闸门看 `verify` 自己的退出码。

Ren'Py 下首行括号里是 `(Ren'Py, N scripts)`（1 个脚本时写 `1 script`），检查项少两条（没有 `plugins.js` 也没有 `backup`），`sync` 文案是 `every dictionary key still appears in game/`。同一份夹具全绿时：

```text
game      : rpy (Ren'Py, 2 scripts)
  engine      ok    Ren'Py
  dictionary  ok    7 entries (7 translated, 0 pending)
  sync        ok    every dictionary key still appears in game/
  install     ok    game/yakusha_translation.rpy (written by install)
  runtime     ok    game/yakusha_translation.rpy (7 strings, language schinese)
  verify      ok    0 error, 0 warning(s)
verdict   : ready
```

未安装时 install/runtime 两行都指向 `game/yakusha_translation.rpy`：`not installed - run: yakusha install <game>` 与 `the game reads game/yakusha_translation.rpy at startup once installed`，`verdict` 是 `not installed yet`。JSON 里 `install` 对象带 `pluginFile` / `pluginFilePresent` / `entryPresent` / `entryParameters` / `backup`，Ren'Py 下 `entryPresent` 与 `pluginFilePresent` 同值（文件存在就是注册），`entryParameters` 是 `{"language": "schinese"}`（语言从生成的翻译脚本里的 `translate <lang> strings:` 读回，不是假设的），`backup` 恒 `null`；`runtime` 对象的 `path` 是相对路径、`found` 是绝对路径。

**RGSS（XP / VX / VX Ace）**——检查项少两条（没有 `plugins.js` 也没有 `backup`），`sync` 文案是 `every dictionary key still appears in Data/`，`install` 与 `runtime` 两行固定是 warn 与 info：

```text
game      : Synthetic Quest (RGSS 3, 7 data files)
  engine      ok    RGSS 3
  dictionary  ok    29 entries (0 translated, 29 pending)
  progress    warn  29 entries are still empty - run: yakusha translate <game>
  sync        ok    every dictionary key still appears in Data/
  install     warn  RGSS has no delivery layer yet, so nothing is written back into the game
  runtime     info  nothing is loaded at run time, so the game keeps showing the original text
  verify      ok    0 error, 0 warning(s)
verdict   : usable with 2 warning(s)
```

- 首行括号里是 `(RGSS 3, 7 data files)`——引擎名后跟 `engineVersion` 的字符串（`"1"` / `"2"` / `"3"`），数字是读过的 Marshal 文档数。
- `install` 恒 `warn`（因为 `runtime: null`，判定走 `src/core/doctor.js:183` 的 `delivery.pending` 分支），`runtime` 恒 `info`。这两行不会变成 `ok`，也不会因为没装而变成 `not-installed`：RGSS 的 `verdict` 只可能是 `usable`（有字典）或 `broken`（无字典或字典坏）。

**Kirikiri** 下 doctor 的形状与 RGSS 同支：检查项同样少两条（没有 `plugins.js` 也没有 `backup`），`install` 恒 `warn`、`runtime` 恒 `info`，`verdict` 同样只可能是 `usable` 或 `broken`。实测（合成夹具，1 个归档、3 条串、翻了 1 条）：
- 上方那份输出是「有字典、一条都没译」的实测：`progress` 是 `warn`，所以是 `usable with 2 warning(s)`。翻完 29 条后 `progress` 行消失、`dictionary` 变 `ok 29 entries (29 translated, 0 pending)`，`verdict` 是 `usable with 1 warning(s)`，退出 0。
- 没有字典时（`src/core/doctor.js:125`）：`dictionary fail no dictionary at <abs>\yakusha\dictionary.json - run: yakusha extract <game>`，`install` / `runtime` 两行照旧，`verdict` 是 `broken - <同一条 fail 消息>`，`outcome` 转 `findings`、退出 1。`sync` / `verify` 两项这时不出现（载荷里是 `null`）。
- `install` 载荷 5 个子键全 `false` / `null`：`pluginFile: null`、`pluginFilePresent: false`、`entryPresent: false`、`entryParameters: null`、`backup: null`；`runtime` 是 `{embedded: false, entries: 0, path: null, found: null}`。没有交付层，就没有东西可查。

```text
game      : (untitled) (Kirikiri, 1 data files)
  engine      ok    Kirikiri
  dictionary  ok    3 entries (1 translated, 2 pending)
  progress    warn  2 entries are still empty - run: yakusha translate <game>
  sync        ok    every dictionary key still appears in xp3 archives
  install     warn  Kirikiri has no delivery layer yet, so nothing is written back into the game
  runtime     info  nothing is loaded at run time, so the game keeps showing the original text
  verify      ok    0 error, 0 warning(s)
verdict   : usable with 2 warning(s)
```

- 首行括号里是 `(Kirikiri, 1 data files)`——引擎名不带版本（`engineVersion` 恒 `null`），数字是打开的归档数；首行的标题是 `(untitled)`，因为 0.13 不从归档里解析游戏标题。
- `sync` 的文案是 `every dictionary key still appears in xp3 archives`。`install` / `runtime` 的判定走同一个 `delivery.pending` 分支（`src/core/doctor.js:183`），两行的消息在 `src/engines/krkr/adapter.js:300` 与 RGSS 一样声明在 `diagnostics` 里。
- 翻完全部条目后 `progress` 行消失，`verdict` 是 `usable with 1 warning(s)`、退出 0——没有交付层，`install` 那条 warn 永远在，`ready` 在这个引擎上不可达。
- 没有字典时与 RGSS 一致：`dictionary fail no dictionary at <abs> - run: yakusha extract <game>`，`verdict` 是 `broken`、退出 1。
- `install` 载荷子键与 RGSS 一样全 `null` / `false`，`runtime` 恒为 `{embedded: false, entries: 0, path: null, found: null}`。

`doctor` 唯一的命令专属选项是 `--max-length <n>`：它只影响 `verify` 那一行（把宽度判据打开，`n=0` 关闭，默认 0），其余检查不受影响。`--help` 里没有 doctor 段，所以这个选项只能在本节看到。

实测过的几种状态：

| 症状 | doctor 说什么 | 怎么办 |
| --- | --- | --- |
| 中文全没了，插件还在 | `install fail`（`$plugins` 条目丢了） | 重跑 `yakusha install <game>` |
| 一启动就报错 | `plugins.js fail` `js/plugins.js is not readable (...)` | 从 `js/plugins.js.yakusha-backup` 恢复，再 install |
| 一部分台词变回日文 | `sync warn` `N text not in the dictionary, M dictionary key no longer in the game` | 重跑 `extract` 再 `translate` |
| 部署版 MV，字典只放在 `www/yakusha/` 下 | `runtime ok`（`<root>/yakusha/` 与 `<root>/www/yakusha/` 两处路径都试），但 `dictionary fail`、`verdict` 是 `broken`、退出 1 | 把字典留在 `<root>/yakusha/` 下；`dictionary` 检查只认这一处 |
| 有 32 条空条目 | `progress warn` `32 entries are still empty - run: yakusha translate <game>` | 翻完即可，`verdict` 是 `usable` |

大型项目的完整体检实测（一款 51 个数据文件、38,044 条串的 MZ 作品）：

```text
game      : Example Game (RPG Maker MZ 1.7.0, 51 data files)
  dictionary  ok    38044 entries (38042 translated, 2 pending, 2 rejected)
  progress    warn  2 entries are still empty
  rejected    warn  2 entries failed validation
  sync        ok    every dictionary key still appears in data/
  install     ok    js/plugins/YAKUSHA_Translator.js registered in js/plugins.js
  backup      ok    uninstall can restore js/plugins.js byte for byte
  runtime     ok    yakusha/dictionary.json (found)
  verify      ok    0 error, 192 warning(s)
verdict   : usable with 2 warning(s)
```

## export：JSON / TSV / CSV 快照

`export` 把已译条目投影成一个文件，给外部工具或审校用；它只写 `--out` 指定的那一个文件，永远不写 stdout。`--format json`（默认）与 `--format tsv` / `--format csv` 都在 0.13 实现了。0.10–0.12 只有 JSON，当时文档写的「TSV / CSV 不在范围内」已由本版兑现。

```text
exported 32 entries to <abs> (4159 B)
```

落盘形状（rich 格式，`--flat` 时 `text` 直接变成字符串）：

```json
{
  "format": "yakusha/1",
  "game": "テストゲーム",
  "updatedAt": "2026-10-26T10:59:37.104Z",
  "entries": {
    "HPを50回復する。": {
      "text": "译:HPを50回復する。",
      "contexts": ["Items.json:description"]
    }
  }
}
```

- `--out` 必填、没有默认文件名；`--out -` 被拒：`error: export --out must be a file path, not -`。
- `--format` 接 `json`（默认）、`tsv`、`csv`；给了别的值报 `E_USAGE`：`export supports --format json, tsv or csv, not xls`。TSV / CSV 的表格形状、编码与引用规则见 [export-format.md](export-format.md) §8（UTF-8 带 BOM、表头 `source` / `target` / `contexts`、CRLF 行尾、RFC 4180 引用）。
- `--force` 才允许覆盖已有文件；没有它报 `E_EXISTS`：`refusing to overwrite <path> (pass --force)`。目标是项目字典本身时，即使 `--force` 也拒绝：`refusing to overwrite the project dictionary at <path> (export is a projection, not a backup)`。
- 目标是游戏目录内但不在 `yakusha/` 下时 stderr 警告：`warning: export target is inside the game directory but outside yakusha/: <path>`。
- 空字典也能导出：`exported 0 entries to <abs> (120 B)`，载荷 `entries: 0`。载荷：`out` / `format`（实际格式名）/ `flat` / `entries`（条数，不是对象）/ `bytes`（实际写入的 UTF-8 字节数）。TSV / CSV 时 `--flat` 无意义，给了报 `E_USAGE`：`--flat applies to --format json only`。
- 序列化细节（键排序、不导出 `error`、`updatedAt` 原样复制）见 [export-format.md](export-format.md)。

## import：从导出文件回填字典

`import` 是 `export` 的逆操作的一半：读一个此前导出的 TSV / CSV / JSON 文件，把 `target` 写回字典。0.13 新增；0.15 增加了 JSONL 输入与 `--create`（通用内容导入 v1）。逐行规则：

- `--from` 必填，缺了报 `E_USAGE`：`import needs --from <file>`；`-` 被拒：`import --from must be a file path, not -`（与 `export --out` 一样，永远不走 stdin/stdout 管道）。
- `--format` 缺省按 `--from` 的扩展名猜（`.tsv` / `.csv` / `.json` / `.jsonl`，大小写不敏感）；猜不出报 `E_USAGE`：`import --format must be tsv, csv, json or jsonl (or a .tsv/.csv/.json/.jsonl file), not xyz`（没有扩展名时显示 `(missing)`）。
- `--strategy` 只有两种：`only-empty`（默认，绝不覆盖已有非空译文）与 `overwrite`；给了别的值报 `E_USAGE`：`--strategy must be only-empty or overwrite, not nope`。注意两种策略下**同值都会跳过**（`current === target` 的行不计入 `applied`），`overwrite` 只是不管已有译文是否非空都写入。
- 文件不存在报 `E_IO`：`cannot read <abs>: the file does not exist`（home 缩写成 `~`）。
- 表格文件必须有表头行 `source<分隔符>target<分隔符>contexts`，不符报 `E_DICTIONARY`：`table file must start with the header row source target contexts`（消息里显示实际的分隔符：TSV 用 tab、CSV 用逗号）；某行格数不是 3 报 `E_DICTIONARY`：`table row 1 has 2 cells, expected 3`（行号含表头、从 1 起）。JSON 文件则要求有 `entries` 对象，每个条目是字符串或 `{text, contexts}`。
- 跳过规则按行处理：`target` 为空 → 跳过；`only-empty` 下字典已有非空译文 → 跳过；字典当前值与 `target` 相同 → 跳过（两种策略都算）。`contexts` 的合并顺序：字典里已有非空 contexts 优先，否则用表格行的 `contexts`，否则为空数组。
- `--create`（0.15）：项目还没有字典时，先用 `emptyDictionary(gameTitle)` 建一个再合并（stderr 提示 `created an empty dictionary: <abs>`）；没有 `--create` 时行为与 0.13 相同（`E_NO_DICTIONARY`，消息末尾追加 `(pass --create to start one from this import)`）。解析先于建字典：表坏了不会留下半成品空字典。
- `--dry-run` 完整执行匹配与校验但不写盘；`applied` 为 0 时也不写（不碰 `updatedAt`）。
- 载荷 8 键平铺：`file` / `format`（实际格式名）/ `strategy` / `dryRun` / `read`（读到的行数，含表头与跳过行）/ `applied` / `skipped` / `entries`（本次实际写入的对象）。

```text
from      : <abs table.tsv>
format    : tsv (strategy only-empty)
read      : 3 row(s)
applied   : 1
skipped   : 2
dictionary: <abs>\yakusha\dictionary.json
```

`--dry-run` 时没有 `dictionary:` 行，末行换成 `dry run: nothing written`。往返保证：`export --format tsv` → `import` → `export --format tsv` 输出字节相同（实测 `cmp` 为空）；CSV 同理。

## launch：启动游戏（仅 Windows）

`launch` 在项目根里找唯一的 `.exe` 并脱离父进程启动。0.13 仍然只支持 Windows，其他平台报 `E_UNSUPPORTED_PLATFORM`。Ren'Py、RGSS 与 Kirikiri 项目都走同一条契约（`src/engines/launch.js`，只看项目根里的 `.exe`），本文没有在 Ren'Py 上实测成功启动的案例；RGSS 项目若一个 `.exe` 都没有，报的就是上面那条 `E_EXE`（实测退出 2，`details.candidates` 为 `[]`）——Kirikiri 项目上同样（实测合成项目无 `.exe` 时就是这条错误）。

- 只扫项目根的直接子项（不递归），大小写不敏感地匹配 `.exe` 结尾的普通文件；符号链接和目录不算。
- 恰好一个才启动；0 个报 `E_EXE`：`no .exe found in <dir> (start the game once, or pass --exe <name>)`；多个也报 `E_EXE`：`found 2 .exe files in <dir>, pass --exe <name>`，`details.candidates` 列出候选文件名（最多 20 个，`MAX_CANDIDATES`；`message` 里的总数不受这个上限影响）。
- `--exe` 必须是裸文件名：`Game` 报 `--exe must be a bare .exe file name: Game`，`../x.exe` 同样被拒；文件不存在报 `no NOPE.exe in <dir>`。不做任何「帮用户修正输入」的事。
- spawn 时 `shell: false`、无参数、`cwd` 设为项目根，CLI 退出后游戏继续跑，不接管 stdout/stderr、不等待、不 kill。启动前会把 `YAKUSHA_API_KEY` 和 `OPENAI_API_KEY`（含大小写变体）从子进程环境里删掉。
- 成功载荷：`root` / `exe` / `pid`，`pid` 只用于展示。

## 环境变量

| 变量 | 作用 |
| --- | --- |
| `YAKUSHA_API_KEY` | 模型 API key，优先于 `OPENAI_API_KEY`；`--api-key` 最优先 |
| `OPENAI_API_KEY` | 模型 API key 的兜底；`launch` 会把两者都从游戏进程环境里删掉 |
| `YAKUSHA_MODEL` | 模型 id，优先于配置文件，低于 `--model` |
| `YAKUSHA_BASE_URL` | OpenAI 兼容端点，优先于配置文件，低于 `--base-url` |
| `YAKUSHA_CONFIG_DIR` | 换掉配置文件所在目录（绝对路径，文件名固定 `config.json`）；不设时用 `%APPDATA%\yakusha` |
| `YAKUSHA_DEBUG` | 设为 `1` 时把异常 stack 打到 stderr（含绝对路径，只用于排查）；stdout 的 JSON 一个字节不变 |

## 相关文档

- [json-contract.md](json-contract.md)：信封、退出码、错误码、每个命令的稳定载荷字段、0.10 以来未变的契约与按引擎（MZ/MV、Ren'Py、RGSS、Kirikiri）的语义澄清
- [config.md](config.md)：配置文件格式、键的校验与优先级、密钥的处理与威胁模型
- [export-format.md](export-format.md)：导出文件的序列化规则与字段语义
- [engines.md](engines.md)：引擎识别与检测顺序、`launch` 的启动契约、`attach` 桩的边界、§13 文本抽取契约（MZ/MV、Ren'Py、RGSS 与 Kirikiri）、§7.7 RGSS 与 Kirikiri 的 pending 交付
- [architecture.md](architecture.md)、[design.md](design.md)：流水线与模块划分
- [limitations.md](limitations.md)、[platforms.md](platforms.md)：已知限制与平台差异
- [README.md](../README.md)：安装、快速上手、与 GUI 的关系
