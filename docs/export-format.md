# 译文导出格式（0.10 设计稿）

> **状态：0.10 设计，尚未实现。** 0.9.0 只能直接编辑 `yakusha/dictionary.json`。
> 0.10 加 `export`，只做 JSON；TSV / CSV 推迟到 0.12。信封与退出码见
> [json-contract.md](json-contract.md)。

## 1. 命令

```
yakusha export <game-dir> --out <file> [--format json] [--flat] [--force] [--json]
```

- `--out` **必填**。没有默认文件名，也不写 stdout；`--out -` 被拒绝（`E_USAGE`）。
  导出是“落一份可交付的文件”，不是管道过滤器。
- `--format json` 是 0.10 唯一支持的格式；`tsv` / `csv` 现在返回 `E_USAGE`，
  避免用户以为已经有了。
- `--flat`：条目值从对象 `{text, contexts}` 改成字符串 `text`。
- `--force`：允许覆盖已存在的目标文件。没有它时目标存在 → `E_EXISTS`。
- 命令不修改游戏、字典或插件；只写 `--out` 指向的那一个文件。

## 2. 输出形状

### 2.1 默认（rich）

```json
{
  "format": "yakusha/1",
  "game": "格闘娘はお金が無い！",
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
  "game": "格闘娘はお金が無い！",
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
- 没有做“按 context 过滤”的选项：0.10 的导出是整份快照；需要子集时先用
  `--context` 跑翻译/校验，或等 0.12 的表格导出。
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
  "out": "D:\\Games\\example\\yakusha\\export.json",
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
    "message": "refusing to overwrite D:\\Games\\example\\yakusha\\export.json (pass --force)"
  }
}
```

## 7. 与字典、导入的关系

- 导出文件与字典同构（`format` + `game` + `updatedAt` + `entries`），所以未来
  `import` 可以直接读它；但 0.10 **没有** `import`，不要假设存在反向命令。
- 导出不是备份：它只含已翻译条目，丢了未翻条目的 `contexts` 与 `error`。
  要备份就复制 `yakusha/dictionary.json`。
- 导出文件可以被外部工具消费（字幕、校对表、CAT），但 0.10 不承诺任何
  外部工具写回后能无损导入；那是 0.12 round-trip 的验收项。
- 如果字典里的 `game` 为空（手工建的字典），导出照常，`game` 为空字符串；
  不根据项目路径反推标题。

## 8. 0.12 的 TSV / CSV（仅记录边界，不是契约）

推迟的原因：表格要处理引号、换行、逗号、BOM、Excel 公式注入、`contexts` 的
多值编码，还要定义“导入时如何合并”。这些都需要独立的 round-trip 测试，
不该在 0.10 顺手做半套。

0.12 再定：列名、是否带表头、`contexts` 的分隔符、空译文行是否保留、
导入时的冲突策略（覆盖 / 只填空 / 拒绝）。在那一版之前，`--format tsv` / `csv`
明确报 `E_USAGE`。

## 9. 验收清单

- [ ] rich / flat 两种输出都能被 `JSON.parse`，字段与本文一致。
- [ ] entries 键顺序与 locale 无关；同一字典在 Windows CI 上重复导出字节一致。
- [ ] 只导出非空 `text`；`error` 不出现在输出里。
- [ ] 无 `--force` 覆盖已存在文件 → `E_EXISTS`；源文件字节不变。
- [ ] `--out` 等于字典路径 → `E_EXISTS`，即使带 `--force`。
- [ ] 导出到不存在父目录 → 创建成功；写失败 → `E_IO`，无半份文件。
- [ ] 空字典 → `ok`、`entries: 0`、`{}`。
- [ ] 信封字段 `out/format/flat/entries/bytes` 有测试。
