# JSON 输出契约

> **状态：0.10 冻结并实现，0.11 至 0.13 原样沿用。** 信封、退出码、错误码清单一个都没动；
> 0.11 起只新增按引擎（RPG Maker MZ/MV、Ren'Py、RGSS、Kirikiri）的语义澄清，见 §7.1，
> 0.13 新增 `import` 命令（载荷见 §7），不新增保留键、不改字段类型。
> 本文冻结的形状自 0.10 起不再变化，实际输出以 [commands.md](commands.md) 为准。

## 1. 目标与适用范围

`--json` 是给脚本、CI 和未来的 Electron GUI 用的：机器只读 stdout，不应需要分辨
“这个命令的 ok 在哪一层”。0.10 起，**所有命令**（包括新增的 `config` / `export` /
`launch`）都遵守同一套信封、同一套退出码、同一套错误码。

契约只约束**机器可读的形状**，不约束文案措辞；脚本不得依赖 `message` 的原文。

## 2. 信封

成功：

```json
{
  "schema": 1,
  "command": "scan",
  "ok": true,
  "outcome": "ok",
  "error": null,
  "root": "/games/MyGame",
  "engine": "mz",
  "engineVersion": "1.7.0",
  "uniqueStrings": 38044
}
```

检查命令发现了问题（仍然完成，退出码 1）：

```json
{
  "schema": 1,
  "command": "verify",
  "ok": false,
  "outcome": "findings",
  "error": null,
  "file": "/games/MyGame/yakusha/dictionary.json",
  "errors": 1,
  "warnings": 2,
  "problems": [
    {
      "kind": "echo",
      "severity": "error",
      "key": "勇者",
      "target": "勇者",
      "detail": "target is identical to a Japanese source"
    }
  ]
}
```

命令没有完成（退出码 2）：

```json
{
  "schema": 1,
  "command": "verify",
  "ok": false,
  "outcome": "error",
  "error": {
    "code": "E_NO_DICTIONARY",
    "message": "no dictionary yet: /games/MyGame/yakusha/dictionary.json"
  }
}
```

### 2.1 保留键

顶层只有五个键归信封所有，载荷**平铺**在它们旁边（不套 `data`）：

| 键 | 类型 | 说明 |
| --- | --- | --- |
| `schema` | 整数 | 信封版本，0.10 起为 `1`，0.11 未变；只有保留键或退出码语义破坏时才加 |
| `command` | 字符串或 `null` | 实际执行的命令名；未知命令回显原始 token；`config` 的子命令放载荷的 `action`；无命令为 `null` |
| `ok` | 布尔 | **严格等于** `outcome === "ok"` |
| `outcome` | 字符串 | `"ok"` / `"findings"` / `"error"` |
| `error` | 对象或 `null` | 仅 `outcome === "error"` 时非空 |

载荷字段不得使用这五个名字（例如 `scan` 载荷里原来的 `ok` 删除）。新增载荷字段属于
兼容变更；删除、改名或改变类型属于破坏变更。

### 2.2 为什么平铺

现有调用方读的是 `result.entries`、`summary.uniqueStrings`、`problems`。平铺让 0.9.0 的
读取代码在 0.10 只需删掉对载荷 `ok` 的判断，不要为了“信封好看”让所有脚本改一层。
这也和常见 REST 统一响应体（公共字段与业务字段同层）一致。

### 2.3 `ok` 与 `outcome` 的分工

- `ok` 只回答“命令是否成功”，便于 `if (!result.ok)` 这种旧写法继续工作。
- `outcome` 区分“成功”“检查发现问题”“命令失败”三态；只看 `ok` 的脚本会把
  `findings` 和 `error` 混在一起，新脚本应看 `outcome`。
- `findings` 时 `error` 为 `null`：检查确实跑完了，问题在数据里，不在命令执行上。

## 3. 三种结局与退出码

| outcome | 含义 | 退出码 | 哪些命令会出现 |
| --- | --- | --- | --- |
| `ok` | 命令完成，没有需要阻断的问题 | 0 | 全部 |
| `findings` | 命令完成，但被检查的对象有缺陷 | 1 | 只有 `verify`（有 error 级问题）与 `doctor`（verdict 为 `broken`） |
| `error` | 命令没完成：用法、环境、输入或内部错误 | 2 | 全部 |

规则：

1. **只有“检查类”命令用 `findings`。** `verify` 的职责就是判断译文能不能发布；
   `doctor` 的职责就是判断安装是否健康。它们发现缺陷时退出 1，CI 能直接拦。
2. **“修复类 / 转换类”命令不用 `findings`。** `translate` 有 `rejected > 0`、
   `speaker` 跑完仍有 `errorsAfter > 0`、`status` 有 `withError > 0` 时仍是 `ok`：
   这些命令的职责是产出或修复，不是判决。用 `verify` 做发布闸门，不要逼用户
   在 `translate && verify` 之间猜哪个退出码算失败。
3. **error 优先于 findings。** 例如 `verify --write-report` 发现 1 条 error，但报告文件
   写不进去：outcome 是 `error`（`E_IO`），退出 2，不交付半份结果。
4. 退出码在文本模式下完全相同。

0.9.0 的现状对照：`verify` 有 error 时已退出 1；`doctor` broken 已退出 1；
`translate` / `speaker` / `status` 恒退出 0；未知命令退出 1、无命令退出 2。
0.10 把未知命令改成 2，其余对齐本表。

## 4. 错误对象

```json
{
  "code": "E_USAGE",
  "message": "unknown option: --jsno",
  "details": { "option": "--jsno" }
}
```

- `code` 是稳定标识，脚本按它分支。
- `message` 是给人看的一句话：单行、最多 500 字符、不含 stack trace、不含密钥。
- `details` 可选，只放该错误码声明过的字段；不接受任意对象透传。

### 4.1 错误码

| code | 何时 | 典型命令 |
| --- | --- | --- |
| `E_USAGE` | 未知命令 / 未知选项 / 缺参数 / 值非法 / 缺 `--out` / 拒绝 `config set apiKey` | 全部 |
| `E_NOT_PROJECT` | 在给定目录及其上下 3 层内找不到 MZ/MV、Ren'Py、RGSS 或 Kirikiri 项目；检测顺序是 MZ → MV → Ren'Py → RGSS → Kirikiri（`src/engines/registry.js:18`），空目录报的是 RPG Maker 措辞 | 除 `config` 外全部 |
| `E_MULTI_ROOT` | 同层有多个项目，必须让用户指定其中一个；文案按引擎不同（`found 2 RPG Maker projects under…` / `found 2 Ren'Py projects under…` / `found 2 RGSS projects under…` / `found 2 Kirikiri projects under…`），候选路径只拼进 `message`，CLI 不输出 `details` | 除 `config` 外全部 |
| `E_NO_DICTIONARY` | 命令需要字典，但 `yakusha/dictionary.json` 不存在（`doctor` 不报此码，它把缺字典记成 `dictionary: fail` / `verdict: broken` / 退出 1）；Ren'Py 的 `install` 另有「字典存在但一条都没译」的第二种情形 | status/translate/verify/speaker/terms/export；`install` 只在带 `--embed`（读译文编译进插件）或 Ren'Py（安装时就要写译文）时报，RPG Maker 的普通 `install` 不读字典、缺字典也能装成功；RGSS 与 Kirikiri 的 `install` / `uninstall` 与字典无关，缺不缺都报 `E_NOT_IMPLEMENTED` |
| `E_DICTIONARY` | 字典存在但无法解析（`message` 就是解析器原文），或 `format` 不是 `yakusha/1` | status/translate/verify/speaker/terms/export。`extract` 遇到坏字典会重建、`doctor` 记成 `dictionary: fail` 并走 findings/1；RPG Maker 的 `install` 不读字典；Ren'Py 的 `install` 要读，坏字典时退出 2，但 `code` 是 `E_INTERNAL`（解析器原文直接冒到捕获不到该码的地方），脚本不要指望这时拿到 `E_DICTIONARY` |
| `E_EXISTS` | `export` 目标已存在且没有 `--force`，或目标就是项目字典 | export |
| `E_EXE` | `launch` 在项目根找不到唯一的 `.exe`，或 `--exe` 不合法 | launch |
| `E_PROVIDER` | provider 名字不认识（`unknown provider: …`）。单条请求的失败（网络错误、非 2xx、响应无法解析）不进这个码：它们被 `translate` 记进载荷的 `rejected`，命令仍是 `ok` | translate |
| `E_CONFIG` | 配置文件损坏、目录不可写、`APPDATA` 缺失 | config、translate（读配置时） |
| `E_IO` | 读写文件失败、路径逃出项目根、权限不足 | 全部 |
| `E_NOT_IMPLEMENTED` | 能力已声明但没实现。0.10 引入时只有 `attach`（库调用，没有 CLI 入口）；0.12 起 RGSS、0.13 起 Kirikiri 的 `install` / `uninstall` 都会报此码，`message` 分别是 `install is not implemented for RGSS yet - see the pending decisions in docs/dev/DEVLOG.md` 与 `install is not implemented for Kirikiri yet - see the pending decisions in docs/dev/DEVLOG.md`（`uninstall` 同形），退出 2 且不写任何文件 | RGSS 与 Kirikiri 的 install / uninstall |
| `E_UNSUPPORTED_PLATFORM` | 该操作只支持 Windows，当前不是 Windows（目前只有 `launch`） | launch |
| `E_INTERNAL` | 未预期异常（bug） | 全部 |

错误码不区分“用户输入错”与“环境错”的退出码：都属于 `error`，一律退出 2。
这样 CI 只需要判 `0 = 通过`、`1 = 内容有问题`、`>=2 = 命令没跑成`。

### 4.2 错误与脱敏

统一在 `src/cli/envelope.js` 的 `sanitizeMessage()` 里处理，所有出口必须经过它：

- 去掉 ANSI/C0 控制字符（保留可读空格），换行折成空格，截断到 500 字符。
- 去掉 stack trace：`Error.stack` 永远不进 JSON；`YAKUSHA_DEBUG=1` 时只打印到 stderr。
- 密钥脱敏：`sk-[A-Za-z0-9_-]{8,}` → `sk-***`；`Bearer <token>` → `Bearer ***`。
- URL 里的 userinfo（`https://<user>:<password>@host` 这种形状）→ `https://***@host`。
- 把当前用户 home 目录替换成 `~`，避免报告被转发时带出用户名。
- provider 的响应体既不进 `message` 也不进 stderr：只保留状态码，例如
  `provider returned HTTP 401`。响应体可能回显 `Authorization`，从 0.10 起一律不打印，0.11 未变。
- 本地绝对路径可以保留（排查需要），但只能来自命令自己解析出的路径，不能回显任意输入。

## 5. stdout / stderr 分工

- **JSON 模式：stdout 只有一个 JSON 对象加一个换行。** 进度、警告、调试信息全部走 stderr；
  stderr 的警告以 `warning: ` 开头，不要求 JSON。
- **文本模式：** 结果摘要走 stdout，错误与警告走 stderr。
- **`--help` / `-h`：** 永远向 stdout 打印文本帮助并退出 0，**即使同时传了 `--json`**。
  帮助不是命令结果，不套信封。
- **`--version`：** 永远向 stdout 打印 `yakusha <version>` 并退出 0，**优先于任何命令和其它选项**；
  不套信封。
- **无命令：** 文本模式下向 stderr 打印用法并退出 2；`--json` 模式下输出
  `{schema:1, command:null, ok:false, outcome:"error", error:{code:"E_USAGE", message:"no command"}}`，
  退出 2。
- **未知命令：** 文本模式 stderr 打 `error: unknown command: nope` 与
  `run 'yakusha --help' for usage`，退出 2；不再把整段 USAGE 塞进错误信息。

## 6. 参数解析

0.10 换成严格解析（`src/cli/args.js`），不再“看不懂就忽略”：

1. 支持 `--flag value` 与 `--flag=value`；布尔 flag 不接受 `=value`。
2. `--` 之后全部是位置参数；以 `-` 开头的路径必须用 `--` 隔开。
3. 全局选项：`--json`、`--help` / `-h`、`--version`；其余按命令白名单校验。
4. 未知选项、缺少值、值不以 `--` 开头却被当成下一个选项、多余的位置参数 → `E_USAGE`。
5. 可重复选项只有 `--context`（OR 语义）；标量选项重复时**最后一个生效**，布尔重复幂等。
6. 只有 `-h` 一个短选项；`-j` 之类一律未知（避免 `-j` 被当成目录）。
7. 位置参数个数按命令校验：`config` 与 `import` 不接游戏目录（`import` 的对象是 `--from` 指定的文件）；其余命令恰好一个游戏目录
   （`launch` / `export` 也一样）。

解析必须在**任何副作用之前**完成：参数错误时不能已经创建目录或写文件。

## 7. 命令与载荷

所有命令都有 `schema` / `command` / `ok` / `outcome` / `error`，下表只列载荷字段。
“稳定”指 0.10 起冻结；新增字段仍可能出现，脚本应忽略不认识的键。

| 命令 | 默认 outcome | 载荷（稳定字段） | 备注 |
| --- | --- | --- | --- |
| `scan` | ok | `root, engine, engineVersion, gameTitle, dataFiles, uniqueStrings, totalStrings, stringsWithControlCodes, encodings, undecodable, perFile` | 原 `version` 改名 `engineVersion`，避免与工具版本混淆；Ren'Py 与 RGSS 下的取值差异见 §7.1 |
| `extract` | ok | `file, added, total, translated, pending` | 只增不删已有条目 |
| `status` | ok | `file, total, translated, pending, withError` | `withError > 0` 仍是 ok |
| `translate` | ok | `file, provider, elapsedMs, total, translated, overwritten, rejected, failedBatches, rewrapped, cancelled, progress` | `rejected > 0` 仍是 ok；`cancelled` 是协作式取消标记（CLI 恒 `false`，GUI 的取消按钮走同一接口，翻译中的请求自然结束、已翻条目保留）；`--dry-run` 时载荷为 `dryRun, provider, total, translated, rejected`，不写文件 |
| `verify` | ok / findings | `file, maxColumns, report, total, translated, pending, errors, warnings, counts, problems` | `errors > 0` → findings / 1；只有 warning → ok / 0；`report` 仅在 `--write-report` 时出现 |
| `speaker` | ok | `file, includeDrift, dryRun, supplied, saved, entries, tags, names, namesFile, namesNeeded, errorsBefore, errorsAfter, warningsBefore, warningsAfter` | 修复类命令，残留 error 仍是 ok |
| `terms` | ok | `file, names, nameEntries, skipped, holdersMin, supportMin, mined, listed, drift, missing, glossary, written, terms` | `--write` 只是建议 |
| `install` | ok | `pluginPath, registered, backupPath, createdBackup, staleBackup, state` | 幂等；`--embed` 额外写插件内嵌字典；Ren'Py 下仍是这 6 键，含义见 §7.1；RGSS 与 Kirikiri 上命令直接失败（`E_NOT_IMPLEMENTED` / 2），没有任何载荷 |
| `uninstall` | ok | `removed, restored, backupPath, drifted, keptBackup` | 漂移时不还原；Ren'Py 下 `restored` 恒 `false`、`backupPath` 与 `keptBackup` 恒 `null`；RGSS 与 Kirikiri 上同样是 `E_NOT_IMPLEMENTED` / 2，没有载荷 |
| `doctor` | ok / findings | `verdict, checks, failure, game{title, engine, engineVersion, root, dataFiles}, dictionary, sync, install, runtime, verify` | `broken` → findings / 1；`game.version` 改名 `game.engineVersion`；Ren'Py 与 RGSS 下 `checks` 少 `plugins.js` 与 `backup` 两项，`install` / `runtime` 子对象见 §7.1 |
| `config` | ok | `action, ...` | 子命令字段见 [config.md](config.md) |
| `export` | ok | `out, format, flat, entries, bytes` | 0.13 起 `format` 可为 `json` / `tsv` / `csv`（载荷里是实际格式名）；字段见 [export-format.md](export-format.md) |
| `import` | ok | `file, format, strategy, dryRun, read, applied, skipped, entries` | 0.13 新增；`entries` 是本次实际写入的对象；语义见 [commands.md](commands.md) 的 import 一节 |
| `launch` | ok | `root, exe, pid` | 只 spawn，不接管 |

注意：

- `translate` 的 `provider` 是实际使用的 provider 名（`openai` / `mock`），不回显密钥。
- `doctor` 的 `checks` 每项仍是 `{id, level, message, samples?}`；`level` 为
  `ok | info | warn | fail`。顶层不再有第二个 `ok`。
- `verify` 的 `problems` 结构不变；`report` 只给路径，报告内容在文件里。
- `install` / `uninstall` 的路径字段必须是命令自己解析出的绝对路径。

### 7.1 按引擎的语义（0.11 / 0.12 / 0.13）

0.11 支持 Ren'Py、0.12 支持 RGSS、0.13 支持 Kirikiri 之后，同一批键名在四个引擎上含义略有不同。**没有新增或改名任何键**，
消费者按下面的表理解取值即可；需要区分引擎时读 `scan` 的 `engine`（`"mz"` / `"mv"` / `"renpy"` / `"rgss"` / `"krkr"`）
或 `doctor` 的 `game.engine`。RGSS 与 Kirikiri 两列只覆盖能跑通的命令——`install` / `uninstall`
在这两个引擎上直接报 `E_NOT_IMPLEMENTED`、退出 2，没有载荷可读。

| 字段 | RPG Maker（MZ/MV） | Ren'Py | RGSS（XP/VX/VX Ace） | Kirikiri（KAG） |
| --- | --- | --- | --- | --- |
| `scan.dataFiles` | `data/` 下的 `.json` 数据文件数 | `game/` 下的脚本数（`.rpy` 或 `.rpyc`；同 stem 的 `.rpy` 优先） | 读过的 Marshal 文档数（`result.documents`）；打包版一块 `.rgss3a` 里读出多个文档，所以不等于磁盘文件数 | 打开的 `.xp3` 归档数（`result.documents`），不是磁盘文件数 |
| `scan.engineVersion` | MZ/MV 的引擎版本 | `game/options.rpy` 里 `define config.version` 的值，没有就是 `null` | 字符串 `"1"` / `"2"` / `"3"` 或 `null`，判定顺序见 [commands.md](commands.md) 的 scan 一节（`src/engines/rgss/project.js:309` 的 `detectVersion`） | 恒 `null`（不解析加密或可选的配置文件） |
| `scan.encodings` | `{"json": N}` | `{"rpy": N, "rpyc": N}`，脚本格式计数 | 磁盘版按扩展名 `{"rvdata2": N}`（`.rxdata` / `.rvdata` 各自计数）；打包版 `{"marshal": N}` | `{"xp3": N}`，0.13 只有这一个键 |
| `scan.undecodable` | 字符串数组，元素是文件名 | 字符串数组，元素是 `"<相对路径>: <解码错误>"` | 字符串数组，元素是 `"<文件名>: <解码错误>"`（`src/engines/rgss/adapter.js:118`） | 字符串数组，元素是 `"<归档名>:<文件名>: <错误>"`（`src/engines/krkr/adapter.js:113`） |
| `scan.perFile` / 字典 `contexts` | `Items.json:description` | `game/script.rpy:12`（`.rpyc` 无行号时只有路径） | `Map001.rvdata2:401`（事件指令号）、`Actors.rvdata2:name`、`System.rvdata2:terms.params` | `scene1.ks:2`（归档内路径加 1 起始行号） |
| `install.pluginPath` | `js/plugins/YAKUSHA_Translator.js` 绝对路径 | `game/yakusha_translation.rpy` 绝对路径 | 无载荷：命令失败 `E_NOT_IMPLEMENTED` / 2 | 无载荷：同 RGSS |
| `install.registered` | 插件是否已写进 `js/plugins.js` | 恒 `true`（文件写成就等于注册） | 同上，无载荷 | 同 RGSS，无载荷 |
| `install.backupPath` / `createdBackup` / `staleBackup` | 备份 `js/plugins.js`，可能为 `null` | 恒 `null` / `false` / `false`（没有要备份的原文件） | 同上，无载荷 | 同 RGSS，无载荷 |
| `install.state` | `added` / `enabled` / `unchanged` | `added` / `unchanged` | 同上，无载荷 | 同 RGSS，无载荷 |
| `uninstall.restored` / `backupPath` / `keptBackup` | 真值视备份情况而定 | 恒 `false` / `null` / `null` | 无载荷：命令失败 `E_NOT_IMPLEMENTED` / 2 | 同 RGSS，无载荷 |
| `doctor.game.dataFiles` | 数据文件数 | 脚本数 | Marshal 文档数 | 打开的 `.xp3` 归档数 |
| `doctor.install.pluginFile` | 插件绝对路径 | 翻译脚本绝对路径 | 恒 `null`（没有交付层） | 恒 `null`（没有交付层） |
| `doctor.install.pluginFilePresent` | 插件文件是否存在 | 翻译脚本是否存在 | 恒 `false` | 恒 `false` |
| `doctor.install.entryPresent` | `js/plugins.js` 里是否有自己的条目 | 与 `pluginFilePresent` 同值 | 恒 `false` | 恒 `false` |
| `doctor.install.entryParameters` | `{dictionaryPath, strictCodes, debug}` | `{"language": "<lang>"}`，语言从生成的翻译脚本里读回 | 恒 `null` | 恒 `null` |
| `doctor.install.backup` | `{path, stale}` 或 `null` | 恒 `null` | 恒 `null` | 恒 `null` |
| `doctor.runtime` | `{embedded, entries, path, found}`，`path` 是 `yakusha/dictionary.json` | 同四键，`path` 是 `game/yakusha_translation.rpy`，`found` 是它的绝对路径 | 同四键但恒 `{embedded:false, entries:0, path:null, found:null}` | 同 RGSS：恒 `{embedded:false, entries:0, path:null, found:null}` |

RGSS 与 Kirikiri 的 `doctor` 走的都是 `src/core/doctor.js:183` 的 `delivery.pending` 分支（两者的 `capabilities.runtime` 都是 `null`）：
`install` 检查固定是 `warn`、`runtime` 检查固定是 `info`，所以 `verdict` 只可能是 `usable`
或 `broken`，不会是 `not-installed`，也不会是 `ready`。

**Ren'Py 的 `install` 不多带任何键。** 文本模式会打印 `strings    : 7 (schinese)`，那两段信息
来自 adapter 的返回值，CLI 只把上表那 6 个键放进信封——`--json` 实测没有 `entries`，
也没有 `language`。要拿语言名读 `doctor.install.entryParameters.language`。

**RGSS 的 `install` 连信封都只有错误。** 它没有交付层，命令在写任何文件之前就抛错，所以
`--json` 输出的是只有五个信封键加 `error` 的对象：

```json
{"schema":1,"command":"install","ok":false,"outcome":"error","error":{"code":"E_NOT_IMPLEMENTED","message":"install is not implemented for RGSS yet - see the pending decisions in docs/dev/DEVLOG.md"}}
```

没有 `pluginPath` 之类的载荷键可读；`uninstall` 同形（`message` 里 `install` 换成 `uninstall`）。
实测跑完这两个命令后项目目录里一个新增文件都没有。要看 RGSS 目前能做到哪一步，看 `doctor` 的
`install` 与 `runtime` 两行（固定 `warn` / `info`），或 [commands.md](commands.md) 的 install 一节。
Kirikiri 的 `install` / `uninstall` 信封逐字同形，只是 `message` 里的引擎名换成 `Kirikiri`。

## 8. 兼容性与 0.10 的破坏变更

`schema: 1` 内的兼容变更：新增命令、新增载荷字段、新增错误码、调整 `message` 文案。
以下为 0.10 的破坏变更，必须在 CHANGELOG 与版本号（0.10.0）里写清：

| 变更 | 0.9.0 | 0.10.0 | 迁移 |
| --- | --- | --- | --- |
| `error` 类型 | 字符串 | 对象 `{code, message, details?}` | 读 `error.code` / `error.message` |
| 载荷里的 `ok` | `scan/verify/translate/speaker/terms/install/uninstall/doctor` 各自带 | 删除，只保留信封的 `ok` | 读顶层 `ok` |
| `scan.version` | 引擎版本 | `engineVersion` | 改名 |
| `doctor.game.version` | 引擎版本 | `doctor.game.engineVersion` | 改名 |
| `translate` 的 `ok` | `rejected.length === 0`（但退出码是 0） | `rejected > 0` 也是 `outcome:"ok"` | 看 `rejected` 与 `verify` |
| 未知命令退出码 | 1 | 2 | 判 `>=2` 为命令失败 |
| 未知选项 | 静默忽略 | `E_USAGE` / 2 | 修脚本；这会把潜在 bug 暴露出来 |
| 错误里的 stack | 可能整段出现 | 永不出现 | 需要 stack 时设 `YAKUSHA_DEBUG=1` 看 stderr |
| 无命令 | USAGE 到 stdout，退出 2 | 文本：stderr；JSON：信封 | 按模式读 |

`schema` 只在破坏信封/退出码语义时递增；单个命令的载荷改名不单独升 `schema`，
但必须写进 CHANGELOG（0.10 的两次改名已列在上表）。

**0.11 没有破坏性变更。** `schema` 仍是 `1`；信封、退出码、13 个命令、13 个错误码都没有增删改；
§7 的载荷键名一个没动，Ren'Py 只补语义（§7.1），没有新增保留键。

**0.12 同样没有破坏性变更。** `schema` 仍是 `1`；13 个命令、13 个错误码一个没增没删；
§7 的载荷键名一个没动，RGSS 只是往 §7.1 的表里加一列。既有 MZ/MV 与 Ren'Py 项目的输出形状
没有变化。真正新增的只有两件事：`engine` 多了第四个取值 `"rgss"`，以及 RGSS 项目上
`install` / `uninstall` 会返回 `E_NOT_IMPLEMENTED` / 2——那是新引擎的能力边界，
不是既有引擎的行为变化。

MZ/MV 侧唯一可见的变化在文本模式：重复执行 `install`（备份已存在、这次没有新建备份）时，
第三行从打印旧的备份路径改成输出 `backup    : (none)`，与 JSON 里一直以来的
`backupPath: null` 对齐。JSON 输出不变，解析 JSON 的脚本不受影响。

Ren'Py 是新增的引擎支持，不属于 MZ/MV 的兼容性变更；它产生的新文案（例如
`found 2 Ren'Py projects under…`、`translation removed`）都在 `message` 与文本输出层面，
脚本不应依赖 `message` 原文。

RGSS 同理：`found 2 RGSS projects under…`、`install is not implemented for RGSS yet - see the
pending decisions in docs/dev/DEVLOG.md` 都是新引擎带来的新文案，不影响既有引擎的输出。

**0.13 同样没有破坏性变更。** `schema` 仍是 `1`；13 个错误码一个没增没删；§7 的既有载荷键名一个没动。
真正新增的只有三件事：命令清单多了 `import`（13 → 14 个）、`export` 的 `--format` 接受 `tsv` / `csv`
（载荷 `format` 字段随之可以是这两个值）、`engine` 多了第五个取值 `"krkr"`。Kirikiri 项目上
`install` / `uninstall` 返回 `E_NOT_IMPLEMENTED` / 2，与 RGSS 同属新引擎的能力边界；
`found 2 Kirikiri projects under…` 与 `install is not implemented for Kirikiri yet - see the
pending decisions in docs/dev/DEVLOG.md` 都是新文案，脚本不应依赖 `message` 原文。

## 9. 实现落点

- 新增 `src/cli/envelope.js`：`emit(payload)`、`emitError(code, message, details)`、
  `sanitizeMessage()`、`EXIT` 常量。
- 新增 `src/cli/args.js`：全局/命令选项表、严格解析、`E_USAGE` 构造。
- `bin/yakusha.js` 只做：解析 → 选 adapter → 调 core → `emit()`。
- 0.10 起所有 JSON 出口都收敛到 `envelope.js`，`bin/yakusha.js` 不再自己拼信封。
  bin 里剩下的 `JSON.stringify`（`problem.key`、`name.source`、rejected 的 key、
  `check.samples`）只用于给文本模式加引号，以及写 `--write-names` / `terms --write`
  的落盘文件，都不产生信封。
- 新增 `test/json-contract.test.js`（平铺，不放 `test/contract/`）：
  - 每个命令成功时信封五键齐全、`ok === (outcome === "ok")`、
    `error === null`；
  - `verify` 有 error → findings/1，只有 warning → ok/0，缺字典 → E_NO_DICTIONARY/2；
  - `doctor` broken → findings/1；
  - 未知命令/未知选项/缺值 → E_USAGE/2，且 stdout 只有一个对象；
  - stack 与 `sk-` 不出现在 JSON 里；
  - `--help` / `--version` 不套信封。
- 测试辅助 `run()` 要显式清空 `YAKUSHA_*` 与 `OPENAI_API_KEY`，避免开发机环境影响断言
  （现有 `test/cli.test.js` 的 `run()` 继承 `process.env`，是已知的测试稳定性问题）。

## 10. 验收清单

0.10.0 交付时逐条核过，全部有测试兜底（落点见表后的括注）；0.11 与 0.12 只追加了引擎语义，清单本身没有增删：

- [x] 13 个命令都在 JSON 模式下有测试；没有任何命令往 stdout 写第二个对象（`test/json-contract.test.js` 的 `envelope()` 断言 stdout 恰好一行并以换行结尾；`config` 在 `test/config.test.js`，`launch` 在 `test/launch.test.js`）。0.13 起是 14 个：`import` 的载荷与错误断言在 `test/export.test.js`。
- [x] `ok === (outcome === "ok")` 与 `error` 的非空条件在测试里逐条断言（`assertShape()`，每个用例都过一遍）。
- [x] 退出码只有 0/1/2；`verify` / `doctor` 的 findings 退出 1（`EXPECTED_CODE` 映射 + 两条 findings 用例 + doctor broken 用例）。
- [x] 所有错误出口经过 `sanitizeMessage()`；错误里没有 stack、密钥、provider 响应体（`sk-`、`Bearer`、userinfo、home→`~`、500 字符截断都有用例；响应体从不打印，见 §4.2）。
- [x] `--help` 与 `--version` 的行为与本文一致，且有测试（`test/json-contract.test.js` 的 help 用例 + `test/version.test.js` 的 5 条）。
- [x] `scan.version` / `doctor.game.version` 不再出现；`engineVersion` 有测试（三条断言分别覆盖 `scan`、`doctor` 和 `scan` 的 `version` 缺席）。
- [x] 0.9.0 的既有断言按 §7 的改名表迁移，`npm test` 全绿（346 个用例）。
- [x] 0.12 的 RGSS 走同一套信封，没有另开一套：`test/rgss-*.test.js` 六个文件共 89 个用例（marshal 19、archive 11、project 16、extract 11、adapter 17、cli 13；archive 的第 11 条在版本循环里生成）。其中 `test/rgss-cli.test.js` 直接对 `--json` 输出断言 `scan` 的 `ok/outcome/command/engine/engineVersion`、`install` 与 `uninstall` 的 `ok:false` / `outcome:"error"` / `E_NOT_IMPLEMENTED` / 退出 2、`doctor` 有字典时 `verdict:"usable"` 与无字典时 `outcome:"findings"` / 退出 1。
- [x] 0.13 的 Kirikiri 同样走同一套信封：`test/krkr-*.test.js` 六个文件共 46 个用例（xp3 5、ks 6、project 6、extract 5、adapter 11、cli 13），`krkr-cli` 覆盖 `--json` 信封、`install` / `uninstall` 的 `E_NOT_IMPLEMENTED` / 2 与 `doctor` 的 `usable` / `broken`；TSV / CSV 导出与 `import` 在 `test/export.test.js`（23 个用例），含 BOM / CRLF / RFC 4180 引用、TSV 往返字节等价、坏表头与行格数的 `E_DICTIONARY`。
