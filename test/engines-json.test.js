import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getAdapters } from "../src/engines/registry.js";
import { CAPABILITY_KEYS } from "../src/engines/contract.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const ENGINE_DOC = path.join(ROOT, "docs", "engines.json");
const GAMES_DOC = path.join(ROOT, "docs", "games.md");
const LIMITATIONS_DOC = path.join(ROOT, "docs", "limitations.md");

const COLUMNS = ["detect", "scanExtract", "translate", "verify", "install", "launch", "doctor"];
const COMMENT = "本文件是引擎能力与文档矩阵的唯一事实源；改动必须同时改代码与文档，test/engines-json.test.js 会拦住不一致";

function readDoc() {
  return JSON.parse(fs.readFileSync(ENGINE_DOC, "utf8"));
}

function splitRow(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function matrixRows() {
  const lines = fs.readFileSync(GAMES_DOC, "utf8").split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().startsWith("## 兼容性矩阵"));
  assert.notEqual(start, -1, "docs/games.md 里找不到兼容性矩阵标题");
  const end = lines.findIndex((line, index) => index > start && /^##\s/.test(line));
  const section = lines.slice(start + 1, end === -1 ? undefined : end);
  return section.filter((line) => line.trim().startsWith("|")).map(splitRow);
}

function statusOf(cell, where) {
  const text = cell.trim();
  if (text.startsWith("✅")) return "ok";
  if (text.startsWith("⚠")) return "limited";
  if (text.startsWith("❌")) return "none";
  assert.fail(`${where} 的状态格不是 ✅ / ⚠️ / ❌：${cell}`);
}

function engineForLabel(doc, label) {
  const matches = doc.engines.filter((engine) => label === engine.name || label.startsWith(`${engine.name}（`));
  assert.equal(matches.length, 1, `矩阵行「${label}」没有唯一对应到 docs/engines.json 的引擎`);
  return matches[0];
}

test("docs/engines.json 可解析，schema 与引擎顺序和 registry 一致", () => {
  const raw = fs.readFileSync(ENGINE_DOC, "utf8");
  assert.ok(raw.endsWith("\n"), "docs/engines.json 必须以换行结尾");
  assert.ok(!raw.includes("\r"), "docs/engines.json 必须是 LF 换行");
  for (const [index, line] of raw.split("\n").entries()) {
    assert.ok(!/[ \t]+$/.test(line), `docs/engines.json 第 ${index + 1} 行有行尾空白`);
  }
  assert.equal(raw, `${JSON.stringify(JSON.parse(raw), null, 2)}\n`, "docs/engines.json 必须是 2 空格缩进");

  const doc = readDoc();
  assert.equal(doc.schema, 1);
  assert.equal(doc["$comment"], COMMENT);

  const adapters = getAdapters();
  assert.equal(doc.engines.length, adapters.length);
  assert.deepEqual(doc.engines.map((engine) => engine.id), adapters.map((adapter) => adapter.id));
  assert.deepEqual(doc.engines.map((engine) => engine.name), adapters.map((adapter) => adapter.name));

  for (const engine of doc.engines) {
    assert.deepEqual(Object.keys(engine.matrix), COLUMNS, `${engine.id} 的 matrix 列不完整或顺序不对`);
    for (const column of COLUMNS) {
      const cell = engine.matrix[column];
      assert.ok(["ok", "limited", "none"].includes(cell.status), `${engine.id}/${column} 状态非法`);
      assert.equal(typeof cell.note, "string", `${engine.id}/${column} 缺少 note`);
      assert.ok(cell.note.length > 0, `${engine.id}/${column} note 为空`);
    }
  }
});

test("每个引擎的 capabilities 与适配器实现一致", () => {
  const doc = readDoc();
  const adapters = getAdapters();
  for (const adapter of adapters) {
    const engine = doc.engines.find((item) => item.id === adapter.id);
    assert.ok(engine, `docs/engines.json 缺少引擎 ${adapter.id}`);
    assert.deepEqual(engine.capabilities, adapter.capabilities, `${adapter.id} 的 capabilities 与代码不一致`);
    assert.deepEqual(Object.keys(engine.capabilities).sort(), [...CAPABILITY_KEYS].sort(), `${adapter.id} 的能力键集不完整`);
  }
});

test("每个引擎的 versions 与适配器实现一致", () => {
  const doc = readDoc();
  const adapters = getAdapters();
  for (const adapter of adapters) {
    const engine = doc.engines.find((item) => item.id === adapter.id);
    assert.ok(engine, `docs/engines.json 缺少引擎 ${adapter.id}`);
    assert.deepEqual(engine.versions, adapter.versions, `${adapter.id} 的 versions 与代码不一致`);
  }
});

test("docs/games.md 的兼容性矩阵与 JSON 逐格一致", () => {
  const doc = readDoc();
  const rows = matrixRows();
  assert.ok(rows.length >= 2, "docs/games.md 的兼容性矩阵没有表头或分隔行");

  assert.deepEqual(rows[0], ["引擎", "识别", "scan / extract", "translate", "verify", "install 交付", "launch", "doctor"]);
  assert.equal(rows[0].length, 8, "兼容性矩阵必须有 1 个引擎列 + 7 个状态列");

  const body = rows.slice(2);
  assert.equal(body.length, 5, "兼容性矩阵必须恰好有 5 个引擎行");
  const seen = new Set();
  for (const row of body) {
    assert.equal(row.length, 8, `矩阵行「${row[0]}」的列数不是 8`);
    const engine = engineForLabel(doc, row[0]);
    seen.add(engine.id);
    for (const [index, column] of COLUMNS.entries()) {
      assert.equal(statusOf(row[index + 1], `${row[0]} / ${column}`), engine.matrix[column].status, `${row[0]} / ${column} 的状态与 docs/engines.json 不一致`);
    }
  }
  assert.equal(seen.size, doc.engines.length, "兼容性矩阵没有覆盖全部引擎");
});

test("每个 limited 单元格的 note 都是 docs/limitations.md 的逐字子串", () => {
  const doc = readDoc();
  const limitations = fs.readFileSync(LIMITATIONS_DOC, "utf8");
  for (const engine of doc.engines) {
    for (const column of COLUMNS) {
      const cell = engine.matrix[column];
      if (cell.status !== "limited") continue;
      assert.ok(!cell.note.includes("\n"), `${engine.id}/${column} 的 note 必须是单行`);
      assert.ok(limitations.includes(cell.note), `${engine.id}/${column} 的 note 不是 limitations.md 的逐字子串：${cell.note}`);
    }
  }
});
