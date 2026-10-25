# JSON 输出契约（0.10 设计稿）

> **状态：0.10 设计，尚未实现。** 0.9.0 的 `--json` 是各命令各自拼的 `{ok, ...}`：
> `error` 是字符串，`ok` 有时在信封、有时在载荷里，`scan` 的 `version` 是引擎版本。
> 本文冻结 0.10 起的形状。实现落地前，实际输出以 [commands.md](commands.md) 为准。

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
  "root": "D:\\Games\\example",
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
  "file": "D:\\Games\\example\\yakusha\\dictionary.json",
  "errors": 1,
  "warnings": 2,
  "problems": [
    {
      "kind": "echo",
      "severity": "error",
      "key": "勇者",
      "target": "勇者",
      "detail": "translation equals the source"
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
    "message": "no dictionary yet: D:\\Games\\example\\yakusha\\dictionary.json"
  }
}
```

### 2.1 保留键

顶层只有五个键归信封所有，载荷**平铺**在它们旁边（不套 `data`）：

| 键 | 类型 | 说明 |
| --- | --- | --- |
| `schema` | 整数 | 信封版本，0.10 为 `1`；只有保留键或退出码语义破坏时才加 |
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
| `E_NOT_PROJECT` | 在给定目录及向下 3 层内找不到 MZ/MV 项目 | 除 `config` 外全部 |
| `E_MULTI_ROOT` | 同层有多个项目，必须让用户指定其中一个 | 除 `config` 外全部 |
| `E_NO_DICTIONARY` | 命令需要字典，但 `yakusha/dictionary.json` 不存在 | status/translate/verify/speaker/terms/install --embed/export/doctor |
| `E_DICTIONARY` | 字典存在但无法解析，或 `format` 不是 `yakusha/1` | 同上 |
| `E_EXISTS` | `export` 目标已存在且没有 `--force`，或目标就是项目字典 | export |
| `E_EXE` | `launch` 在项目根找不到唯一的 `.exe`，或 `--exe` 不合法 | launch |
| `E_PROVIDER` | provider 网络错误、非 2xx、响应无法解析 | translate |
| `E_CONFIG` | 配置文件损坏、目录不可写、`APPDATA` 缺失 | config、translate（读配置时） |
| `E_IO` | 读写文件失败、路径逃出项目根、权限不足 | 全部 |
| `E_NOT_IMPLEMENTED` | 能力尚未实现（0.10 只有 `attach`） | 库调用；0.10 无 CLI 入口 |
| `E_UNSUPPORTED_PLATFORM` | 该操作只支持 Windows，当前不是 Windows（0.10 只有 `launch`） | launch |
| `E_INTERNAL` | 未预期异常（bug） | 全部 |

错误码不区分“用户输入错”与“环境错”的退出码：都属于 `error`，一律退出 2。
这样 CI 只需要判 `0 = 通过`、`1 = 内容有问题`、`>=2 = 命令没跑成`。

### 4.2 错误与脱敏

统一在 `src/cli/envelope.js` 的 `sanitizeMessage()` 里处理，所有出口必须经过它：

- 去掉 ANSI/C0 控制字符（保留可读空格），换行折成空格，截断到 500 字符。
- 去掉 stack trace：`Error.stack` 永远不进 JSON；`YAKUSHA_DEBUG=1` 时只打印到 stderr。
- 密钥脱敏：`sk-[A-Za-z0-9_-]{8,}` → `sk-***`；`Bearer <token>` → `Bearer ***`。
- URL 里的 userinfo（`https://user:pass@host`）→ `https://***@host`。
- 把当前用户 home 目录替换成 `~`，避免报告被转发时带出用户名。
- provider 的响应体不进 `message`：只保留状态码，例如
  `provider returned HTTP 401`；响应体前 300 字符只在 `YAKUSHA_DEBUG=1` 时进 stderr。
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
7. 位置参数个数按命令校验：`config` 不接游戏目录；其余命令恰好一个游戏目录
   （`launch` / `export` 也一样）。

解析必须在**任何副作用之前**完成：参数错误时不能已经创建目录或写文件。

## 7. 命令与载荷

所有命令都有 `schema` / `command` / `ok` / `outcome` / `error`，下表只列载荷字段。
“稳定”指 0.10 起冻结；新增字段仍可能出现，脚本应忽略不认识的键。

| 命令 | 默认 outcome | 载荷（稳定字段） | 备注 |
| --- | --- | --- | --- |
| `scan` | ok | `root, engine, engineVersion, gameTitle, dataFiles, uniqueStrings, totalStrings, stringsWithControlCodes, encodings, undecodable, perFile` | 原 `version` 改名 `engineVersion`，避免与工具版本混淆 |
| `extract` | ok | `file, added, total, translated, pending` | 只增不删已有条目 |
| `status` | ok | `file, total, translated, pending, withError` | `withError > 0` 仍是 ok |
| `translate` | ok | `file, provider, elapsedMs, total, translated, overwritten, rejected, failedBatches, rewrapped, progress` | `rejected > 0` 仍是 ok；`--dry-run` 时载荷为 `dryRun, provider, total, translated, rejected`，不写文件 |
| `verify` | ok / findings | `file, maxColumns, report, total, translated, pending, errors, warnings, counts, problems` | `errors > 0` → findings / 1；只有 warning → ok / 0；`report` 仅在 `--write-report` 时出现 |
| `speaker` | ok | `file, includeDrift, dryRun, supplied, saved, entries, tags, names, namesFile, namesNeeded, errorsBefore, errorsAfter, warningsBefore, warningsAfter` | 修复类命令，残留 error 仍是 ok |
| `terms` | ok | `file, names, nameEntries, skipped, holdersMin, supportMin, mined, listed, drift, missing, glossary, written, terms` | `--write` 只是建议 |
| `install` | ok | `pluginPath, registered, backupPath, createdBackup, staleBackup, state` | 幂等；`--embed` 额外写插件内嵌字典 |
| `uninstall` | ok | `removed, restored, backupPath, drifted, keptBackup` | 漂移时不还原 |
| `doctor` | ok / findings | `verdict, checks, failure, game{title, engine, engineVersion, root, dataFiles}, dictionary, sync, install, runtime, verify` | `broken` → findings / 1；`game.version` 改名 `game.engineVersion` |
| `config` | ok | `action, ...` | 子命令字段见 [config.md](config.md) |
| `export` | ok | `out, format, flat, entries, bytes` | 字段见 [export-format.md](export-format.md) |
| `launch` | ok | `root, exe, pid` | 只 spawn，不接管 |

注意：

- `translate` 的 `provider` 是实际使用的 provider 名（`openai` / `mock`），不回显密钥。
- `doctor` 的 `checks` 每项仍是 `{id, level, message, samples?}`；`level` 为
  `ok | info | warn | fail`。顶层不再有第二个 `ok`。
- `verify` 的 `problems` 结构不变；`report` 只给路径，报告内容在文件里。
- `install` / `uninstall` 的路径字段必须是命令自己解析出的绝对路径。

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

## 9. 实现落点

- 新增 `src/cli/envelope.js`：`emit(payload)`、`emitError(code, message, details)`、
  `sanitizeMessage()`、`EXIT` 常量。
- 新增 `src/cli/args.js`：全局/命令选项表、严格解析、`E_USAGE` 构造。
- `bin/yakusha.js` 只做：解析 → 选 adapter → 调 core → `emit()`。
- 现有 12 个 `JSON.stringify` 出口（`bin/yakusha.js` 的 96, 164, 215, 230, 270, 359, 437,
  594, 615, 643, 661, 687 行）全部收敛到 `envelope.js`；测试可以 grep 保证 bin 里
  不再直接写 JSON。
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

- [ ] 13 个命令 × 3 种结局都有测试；没有任何命令在 JSON 模式往 stdout 写第二个对象。
- [ ] `ok === (outcome === "ok")` 与 `error` 的非空条件在测试里逐条断言。
- [ ] 退出码只有 0/1/2；`verify` / `doctor` 的 findings 退出 1。
- [ ] 所有错误出口经过 `sanitizeMessage()`；错误里没有 stack、密钥、provider 响应体。
- [ ] `--help` 与 `--version` 的行为与本文一致，且有测试。
- [ ] `scan.version` / `doctor.game.version` 不再出现；`engineVersion` 有测试。
- [ ] 0.9.0 的既有断言按上表迁移，`npm test` 全绿。
