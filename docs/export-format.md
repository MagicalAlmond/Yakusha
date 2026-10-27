# 译文导出格式（0.13；0.15 增补 JSONL 导入）

> **状态：0.10 实现 JSON（WP4）；0.13 补上 TSV / CSV 表格与 `import` 命令。**
> 本文冻结的是**格式契约**，不是排期；排期权威版本见
> [dev/ENGINE-STRATEGY.md](dev/ENGINE-STRATEGY.md) §6.3。
> 实现与测试见 `src/cli/export.js`、`src/cli/table.js`、`test/export.test.js`、
> `test/krkr-cli.test.js`；信封与退出码见 [json-contract.md](json-contract.md)。
> 0.11（Ren'Py）、0.12（RGSS）与 0.13（Kirikiri）接入新引擎**都没有改动 JSON 导出**：
> `src/cli/export.js` 没有任何按引擎分支的代码，导出仍是 `yakusha/1`、只投影已翻译条目。
> 各引擎的字典 key 都是原文——MZ/MV 是 JSON 字段串，RGSS 是 Ruby Marshal 文档里的
> 原文字符串（`src/engines/rgss/marshal.js:344-357`），Kirikiri 是 `.ks` 的行文本
> （`src/engines/krkr/extract.js:117-119`）——所以导出的 key 就是原文，可以跨引擎合并。

## 1. 命令

```
yakusha export <game-dir> --out <file> [--format json|tsv|csv] [--flat] [--force] [--json]
```

- `--out` **必填**。没有默认文件名，也不写 stdout；`--out -` 被拒绝（`E_USAGE`）。
  导出是“落一份可交付的文件”，不是管道过滤器。
- `--format`：`json`（默认）、`tsv`、`csv`。其它值返回 `E_USAGE`
  （`export supports --format json, tsv or csv, not <name>`，`bin/yakusha.js:724-727`）。
  `tsv` / `csv` 的形状与读写规则在 §8。
- `--flat`：条目值从对象 `{text, contexts}` 改成字符串 `text`。只对 JSON 生效：
  `--format tsv|csv` 加它报 `E_USAGE`（`--flat applies to --format json only`，
  `bin/yakusha.js:728-730`），表格本身已经是两列的“扁平”形状。
- `--force`：允许覆盖已存在的目标文件。没有它时目标存在 → `E_EXISTS`。
- 命令不修改游戏、字典或插件；只写 `--out` 指向的那一个文件。

## 2. 输出形状

### 2.1 默认（rich）

```json
{
  "format": "yakusha/1",
  "game": "Example Game",
  "updatedAt": "2026-10-20T12:34:56.000Z",
  "entries": {
    "これはテストの台詞です。": {
      "text": "这是测试用的台词。",
      "contexts": ["Map001.json:401"]
    }
  }
}
```

### 2.2 `--flat`

```json
{
  "format": "yakusha/1",
  "game": "Example Game",
  "updatedAt": "2026-10-20T12:34:56.000Z",
  "entries": {
    "これはテストの台詞です。": "这是测试用的台词。"
  }
}
```

- `format` 仍是 `yakusha/1`：这是同一个字典格式的投影，值类型区分 rich / flat。
  不引入第二个 format 字符串，未来导入时才不用维护两套版本。
- `game` / `updatedAt` 原样复制字典里的值（不改成导出时间）；文件系统的 mtime
  才是导出时间。这样导出文件保留“这份译文对应哪个游戏、字典最后何时更新”的出处。
- `contexts` 原样复制（顺序、重复都保留）。它记录文本出现在哪些文件/字段，
  是人工校对与合并时的定位信息，导出不该丢。
- **不导出 `error`**：导出的是“已翻译”的条目；带 `error` 的条目通常没有译文，
  它们本来就不会进来。`error` 是本地审计信息，给消费者看只会泄进下游工具。
- `--flat` 会丢 `contexts`；需要定位信息时不要用。

## 3. 选哪些条目

- 只导出 `text` 为非空字符串的条目（与 `translatedOnly()` 一致）。
- `text` 为空的条目（未翻 / 被拒）不导出；导出文件不是“待办清单”。
- 没有做“按 context 过滤”的选项：导出是整份快照（0.13 的 TSV/CSV 表格同样如此）；
  需要子集时先用 `--context` 跑翻译/校验。
- 字典为空（0 条已翻译）时仍然成功：`entries: {}`、`entries` 计数 0，
  outcome `ok`。这不是错误，首次建库后马上导出是合法动作。

## 4. 序列化规则

1. 顶层键顺序固定：`format`、`game`、`updatedAt`、`entries`。载荷是对象，键顺序不影响
   解析，但固定顺序让 diff 稳定。
2. `entries` 的键按 **UTF-16 码元升序**（JavaScript 默认 `Array.prototype.sort`），
   与运行环境的 locale 无关；不要用 `localeCompare`，否则同一份字典在不同机器上
   会产生不同顺序。
3. `JSON.stringify(obj, null, 2) + "\n"`，与字典文件一致：2 空格缩进、UTF-8、无 BOM、LF。
4. 不做 `\u2028` / `\u2029` 的额外转义；`JSON.stringify` 的输出就是契约。
5. 浮点/时间：`updatedAt` 是字符串，原样复制，不重新格式化。
6. 写入前先算出完整字符串，再写文件；不要边序列化边写，否则失败会留下半份文件。

## 5. 写入与覆盖

- 目标已存在且没有 `--force` → `E_EXISTS`，不碰原文件。
- 目标已存在且有 `--force` → 允许覆盖。
- 目标就是当前项目的 `yakusha/dictionary.json`（按 `realpath` 比较）→ **即使有
  `--force` 也拒绝**，`E_EXISTS`。导出不该把源文件换成一份可能已经丢字段的投影。
- 目标是目录 → `E_IO`（不是 `E_EXISTS`；这不是可覆盖的文件）。
- 父目录不存在时创建（与 `saveDictionary` 一致）；创建失败 → `E_IO`。
- 写入用“同目录临时文件 + rename”；失败时清理临时文件，原文件保持不变。
  不承诺跨文件系统原子性（临时文件与目标同目录，已经避免跨卷）。
- 若目标是符号链接：rename 会替换链接本身，不写穿到链接目标；这是本地 CLI 的
  正常语义，不把 `--out` 当安全边界。
- `--out` 在游戏目录内时允许，但如果不在 `<game>/yakusha/` 下，文本模式打一行
  warning（可能被游戏更新或卸载流程碰到）；JSON 模式该 warning 走 stderr。

## 6. 信封载荷

```json
{
  "schema": 1,
  "command": "export",
  "ok": true,
  "outcome": "ok",
  "error": null,
  "out": "C:\\Games\\example\\yakusha\\export.json",
  "format": "json",
  "flat": false,
  "entries": 1,
  "bytes": 412
}
```

- `entries` 是导出条数（整数），不是对象。
- `bytes` 是实际写入的 UTF-8 字节数，供脚本核对。
- `out` 是命令解析后的绝对路径。
- 文本模式输出一行：`exported 1 entry to <path> (412 B)`。

错误示例：

```json
{
  "schema": 1,
  "command": "export",
  "ok": false,
  "outcome": "error",
  "error": {
    "code": "E_EXISTS",
    "message": "refusing to overwrite C:\\Games\\example\\yakusha\\export.json (pass --force)"
  }
}
```

## 7. 与字典、导入的关系

- 导出文件与字典同构（`format` + `game` + `updatedAt` + `entries`），所以 `import` 可以
  直接读它：`yakusha import <game-dir> --from <file>` 接受本文 §2 的 JSON（rich / flat
  都收）与 §8 的表格。这是 0.13 新增的命令；0.10–0.12 没有 `import`，不要在旧版本上
  假设它存在。
- 导出不是备份：它只含已翻译条目，丢了未翻条目的 `contexts` 与 `error`。
  要备份就复制 `yakusha/dictionary.json`。
- 导出文件可以被外部工具消费（字幕、校对表、CAT）。外部工具改过的文件**不承诺**无损
  导入；本项目只对自己导出的表格保证 round-trip：`export --format tsv` → `import --from`
  → 再 `export`，字节一致（见 §8 与 `test/export.test.js`）。
- 如果字典里的 `game` 为空（手工建的字典），导出照常，`game` 为空字符串；
  不根据项目路径反推标题。

## 8. 表格导出与导入：TSV / CSV（0.13）

0.13 把表格从“给人看的投影”升级为可往返的契约格式：`yakusha export --format tsv|csv`
写出表格，`yakusha import --from <file>` 把它读回字典。实现见 `src/cli/table.js`（解析、
转义、序列化）与 `bin/yakusha.js:720-840`（两条命令），测试在 `test/export.test.js` 与
`test/krkr-cli.test.js`。

### 8.1 命令

```
yakusha import <game-dir> --from <file> [--format tsv|csv|json] [--strategy only-empty|overwrite] [--dry-run] [--json]
```

- `--from` 必填，且必须是文件路径：传 `-` 报 `E_USAGE`
  （`import --from must be a file path, not -`，`bin/yakusha.js:763`）。不提供 stdin 入口。
- `--format` 省略时按扩展名推断（`.tsv` / `.csv` / `.json`），推断不出报 `E_USAGE`
  （`import --format must be tsv, csv or json (or a .tsv/.csv/.json file), not <name>`，
  `bin/yakusha.js:773-781`）。
- `--strategy` 只有 `only-empty`（默认）与 `overwrite` 两档；其它值报 `E_USAGE`
  （`--strategy must be only-empty or overwrite, not <name>`，`bin/yakusha.js:766-771`）。
- `--dry-run`：走完全流程但不写字典。

### 8.2 表格形状

- 表头固定一行三列：`source`、`target`、`contexts`（TSV 用制表符分隔，CSV 用逗号，
  `src/cli/table.js:20-24`）。
- 每个已翻译条目一行；行顺序与 §3 相同（字典 key 的 UTF-16 码点序，
  `src/cli/table.js:38-50`）。
- **UTF-8 BOM**：写出时永远带（`src/cli/table.js:26,98-109`），让 Excel 直接识别 UTF-8；
  读取时容忍无 BOM（读取端宽容，写出端严格）。
- **行结束符 CRLF**：写出每行以 `\r\n` 结束；读取端同样容忍纯 `\n`。
- **引用规则**（RFC 4180 风格，`src/cli/table.js:63-71`）：单元格含分隔符、双引号、
  CR、LF，或以空格开头/结尾时整体加双引号；单元格内的 `"` 翻倍成 `""`。CSV 的逗号、
  TSV 的制表符都按各自的分隔符判断。
- **contexts 列**：多个 context 用 `, ` 连接；只要任一 context 含 `, `、或连接结果以
  `[` 开头，整格改写成 JSON 数组字符串（`src/cli/table.js:83-89`）。导入端先尝试按
  JSON 数组解析，失败再按 `, ` 拆分（`src/cli/table.js:265-276`）。

### 8.3 读取端的容错

解析（`src/cli/table.js:123-146`）按行宽容处理：允许无 BOM、允许 `\n` 行尾、允许缺失
末尾换行；末尾连续空记录被忽略。两类错误不宽容：

- 首行不是表头：`E_DICTIONARY`，
  `table file must start with the header row source<sep>target<sep>contexts`；
- 某行不是 3 个单元格：`E_DICTIONARY`，`table row N has K cells, expected 3`（N 从 1
  数起，表头是第 0 行）。

文件不存在报 `E_IO`：`cannot read <abs>: the file does not exist`（`bin/yakusha.js:788`）。

### 8.4 导入语义

导入只改字典，不碰游戏（`bin/yakusha.js:797-820`）：

- `target` 为空的行跳过——表格允许“只导出原文留空译文”的校对流程；
- 字典里已有非空译文且 `--strategy only-empty`（默认）：跳过，**永不覆盖**；
  `--strategy overwrite` 才会覆盖；
- 目标译文与字典现有译文相同：跳过（不计入 applied）；
- contexts：字典自己的非空 contexts 优先，行里的 contexts 只在该条目还没有 contexts 时
  采用；
- 只有 `applied > 0` 且非 `--dry-run` 才写回字典文件（写回会盖 `updatedAt`）。

### 8.5 信封载荷

`--json` 时 `import` 返回 8 个键（`bin/yakusha.js:829`）：

```json
{
  "file": "table.tsv",
  "format": "tsv",
  "strategy": "only-empty",
  "dryRun": false,
  "read": 12,
  "applied": 5,
  "skipped": 7,
  "entries": 317
}
```

`read` 是读到的数据行数（不含表头），`applied` 是实际写入字典的行数，`skipped` 是
因上述规则跳过的行数，`entries` 是导入后字典的条目总数。

### 8.6 往返保证

`export --format tsv` → `import --from` → 再 `export --format tsv`，两个文件**字节一致**
（`test/export.test.js`）。这只对“本项目导出、未被外部工具改写”的表格成立；§8.2 的
引用规则保证含逗号、引号、换行的 context 也能无损往返。

## 9. 通用内容导入：JSONL（0.15）

外部工具把任意引擎/任意来源的文本写成 JSONL（ENGINE-STRATEGY §6.2 拍板的文件型
对接形状），`yakusha import --from content.jsonl [--create]` 把它并进字典。这不等于
"支持某引擎"——导入的内容没有 fixture、没有真实游戏验收；其来源标记（provenance）
要等字典 v2 字段（DEVLOG §8.1 #5）拍板后才有可能，现在导入的条目与本地抽取的条目
在格式上不可区分。

### 9.1 文件形状

每行一个 JSON 对象，空行跳过，编码 UTF-8；读取端容忍行首 BOM（按空白剥掉）与
CRLF 行尾：

```json
{"key": "Hello", "text": "你好", "locator": "script.rpy:12"}
{"source": "World", "text": "世界", "contexts": ["Map001.json:1", "Map001.json:7"]}
```

- `source|key`：字典键，先出现的字段生效；缺失、非字符串或空串报 `E_DICTIONARY`：
  `table line 1 needs a non-empty source/key and target/text`。
- `target|text`：译文，规则同上。
- `contexts`（字符串数组）或 `locator`（单个字符串）：写进该条目的 contexts；
  都缺就是空数组。多余字段被忽略。
- 坏 JSON 报 `E_DICTIONARY`：`table line 2 is not valid JSON`（行号从 1 起）。

### 9.2 `--create`

项目还没有字典时，`--create` 先建一个空字典（`emptyDictionary(gameTitle)`）再合并，
stderr 打一行 `created an empty dictionary: <abs>`；表坏了不会留下半成品（解析先于
建字典）。没有 `--create`，缺字典仍是 `E_NO_DICTIONARY`，消息末尾是
`(pass --create to start one from this import)`。合并语义（strategy、跳过规则、
contexts 优先级）与 §8.4 完全相同。

## 10. 验收清单

- [x] rich / flat 两种输出都能被 `JSON.parse`，字段与本文一致。
- [x] entries 键顺序与 locale 无关；同一字典在 Windows CI 上重复导出字节一致。
- [x] 只导出非空 `text`；`error` 不出现在输出里。
- [x] 无 `--force` 覆盖已存在文件 → `E_EXISTS`；源文件字节不变。
- [x] `--out` 等于字典路径 → `E_EXISTS`，即使带 `--force`。
- [x] 导出到不存在父目录 → 创建成功；写失败 → `E_IO`，无半份文件。
- [x] 空字典 → `ok`、`entries: 0`、`{}`。
- [x] 信封字段 `out/format/flat/entries/bytes` 有测试。
- [x] TSV / CSV 表格带 UTF-8 BOM 与 CRLF 行尾；含逗号/引号/换行/context 的单元格按
  §8.2 转义，导出 → 导入 → 导出字节一致。
- [x] `import` 默认 `only-empty` 不覆盖已有译文；`overwrite` 覆盖；空 target 行与相同
  译文行跳过；`--dry-run` 不写文件；信封 8 键齐全。
- [x] 表头错误与列数错误分别报 `E_DICTIONARY` 原文；`--from -` 与未知 `--format`
  / `--strategy` 报 `E_USAGE`。
