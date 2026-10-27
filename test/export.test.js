/**
 * Dictionary export (docs/export-format.md), through the real binary.
 *
 * The output file is the subject here: key order, copied contexts, the
 * refusal rules around --force, and the guarantee that a failed write never
 * leaves a partial file. Dictionaries are written directly so the tests do not
 * depend on the translator to produce a particular shape.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, "..", "bin", "yakusha.js");
const FIXTURE = path.join(HERE, "fixtures", "mini-mz");
const created = [];

/** @returns {string} */
function tempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  created.push(dir);
  return dir;
}

test.after(() => {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
});

/** @returns {string} a private copy of the fixture, safe to mutate */
function tempGame() {
  const game = path.join(tempDir("yakusha-export-"), "game");
  fs.cpSync(FIXTURE, game, { recursive: true });
  return game;
}

/** @returns {{code: number, stdout: string, stderr: string}} */
function run(args) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^YAKUSHA_/i.test(key) || /^OPENAI_API_KEY$/i.test(key)) delete env[key];
  }
  const result = spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", env, timeout: 60000 });
  return { code: result.status === null ? 1 : result.status, stdout: result.stdout || "", stderr: result.stderr || "" };
}

/** @returns {any} */
function envelope(result) {
  assert.equal(result.stdout.endsWith("\n"), true, "stdout must end with a newline");
  const lines = result.stdout.trimEnd().split("\n");
  assert.equal(lines.length, 1, "expected one JSON object, got: " + result.stdout.slice(0, 400));
  return JSON.parse(lines[0]);
}

/**
 * Write a dictionary with the exact entries a test needs.
 *
 * @param {string} game
 * @param {Record<string, any>} entries
 * @param {Record<string, any>} [extra]
 * @returns {string} dictionary path
 */
function writeDictionary(game, entries, extra = {}) {
  const file = path.join(game, "yakusha", "dictionary.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const document = {
    format: "yakusha/1",
    game: "Test Game",
    updatedAt: "2024-01-02T03:04:05.000Z",
    entries,
    ...extra,
  };
  fs.writeFileSync(file, JSON.stringify(document, null, 2) + "\n", "utf8");
  return file;
}

test("export: rich json keeps text and contexts, drops empty text and error", () => {
  const game = tempGame();
  writeDictionary(game, {
    "アリア": {
      text: "阿丽亚",
      contexts: ["Map001.json:101", "Map001.json:101", "CommonEvents.json:1"],
      error: "rejected: echo",
    },
    "empty": { text: "", contexts: ["Map001.json:102"] },
    "ポーション": { text: "药水", contexts: [] },
  });
  const out = path.join(game, "yakusha", "export.json");
  const result = run(["export", game, "--out", out, "--json"]);
  assert.equal(result.code, 0, result.stderr);
  const body = envelope(result);
  assert.equal(body.command, "export");
  assert.equal(body.outcome, "ok");
  assert.equal(body.out, path.resolve(out));

  const document = JSON.parse(fs.readFileSync(out, "utf8"));
  assert.deepEqual(document, {
    format: "yakusha/1",
    game: "Test Game",
    updatedAt: "2024-01-02T03:04:05.000Z",
    entries: {
      "アリア": {
        text: "阿丽亚",
        contexts: ["Map001.json:101", "Map001.json:101", "CommonEvents.json:1"],
      },
      "ポーション": { text: "药水", contexts: [] },
    },
  });
  assert.equal(Object.hasOwn(document.entries["アリア"], "error"), false);
  assert.equal(Object.hasOwn(document.entries, "empty"), false);
});

test("export: --flat turns every entry into its text", () => {
  const game = tempGame();
  writeDictionary(game, {
    "アリア": { text: "阿丽亚", contexts: ["Map001.json:101"] },
    "ポーション": { text: "药水", contexts: [] },
  });
  const out = path.join(game, "yakusha", "flat.json");
  const result = run(["export", game, "--out", out, "--flat", "--json"]);
  assert.equal(result.code, 0, result.stderr);
  const body = envelope(result);
  assert.equal(body.flat, true);
  assert.equal(body.entries, 2);

  const document = JSON.parse(fs.readFileSync(out, "utf8"));
  assert.deepEqual(document.entries, { "アリア": "阿丽亚", "ポーション": "药水" });
});

test("export: entries sort by UTF-16 code units and repeat runs are byte identical", () => {
  const game = tempGame();
  // Insertion order is deliberately not the expected order. Numeric looking
  // keys are the interesting case: a plain object would put "2" before "10"
  // no matter which order the keys were assigned in.
  writeDictionary(game, {
    "𠮷": { text: "y", contexts: [] },
    "あ": { text: "a", contexts: [] },
    "a": { text: "A", contexts: [] },
    "Z": { text: "z", contexts: [] },
    "2": { text: "two", contexts: [] },
    "10": { text: "ten", contexts: [] },
  });
  const out = path.join(game, "yakusha", "sorted.json");
  const first = run(["export", game, "--out", out, "--json"]);
  assert.equal(first.code, 0, first.stderr);
  const bytes = fs.readFileSync(out);
  const text = bytes.toString("utf8");

  const expected = ["10", "2", "Z", "a", "あ", "𠮷"];
  const positions = expected.map((key) => text.indexOf(JSON.stringify(key) + ":"));
  assert.equal(positions.every((position) => position >= 0), true, text);
  assert.deepEqual([...positions].sort((left, right) => left - right), positions, text);

  const second = run(["export", game, "--out", out, "--force", "--json"]);
  assert.equal(second.code, 0, second.stderr);
  assert.deepEqual(fs.readFileSync(out), bytes);
});

test("export: an empty dictionary is a successful empty export", () => {
  const game = tempGame();
  writeDictionary(game, {});
  const out = path.join(game, "yakusha", "empty.json");
  const result = run(["export", game, "--out", out, "--json"]);
  assert.equal(result.code, 0, result.stderr);
  const body = envelope(result);
  assert.equal(body.entries, 0);
  assert.equal(body.bytes, Buffer.byteLength(fs.readFileSync(out)));
  const document = JSON.parse(fs.readFileSync(out, "utf8"));
  assert.deepEqual(document, {
    format: "yakusha/1",
    game: "Test Game",
    updatedAt: "2024-01-02T03:04:05.000Z",
    entries: {},
  });
  assert.match(fs.readFileSync(out, "utf8"), /"entries": \{\}/);
});

test("export: an existing target needs --force and stays untouched without it", () => {
  const game = tempGame();
  writeDictionary(game, { "アリア": { text: "阿丽亚", contexts: [] } });
  const out = path.join(game, "yakusha", "existing.json");
  fs.writeFileSync(out, "keep me\n", "utf8");

  const refused = run(["export", game, "--out", out, "--json"]);
  assert.equal(refused.code, 2);
  const body = envelope(refused);
  assert.equal(body.outcome, "error");
  assert.equal(body.error.code, "E_EXISTS");
  assert.match(body.error.message, /refusing to overwrite/);
  assert.equal(fs.readFileSync(out, "utf8"), "keep me\n");

  const forced = run(["export", game, "--out", out, "--force", "--json"]);
  assert.equal(forced.code, 0, forced.stderr);
  assert.equal(JSON.parse(fs.readFileSync(out, "utf8")).entries["アリア"].text, "阿丽亚");
});

test("export: never replaces the project dictionary, even with --force", () => {
  const game = tempGame();
  const dictionary = writeDictionary(game, { "アリア": { text: "阿丽亚", contexts: [] } });
  const before = fs.readFileSync(dictionary);
  const result = run(["export", game, "--out", dictionary, "--force", "--json"]);
  assert.equal(result.code, 2);
  const body = envelope(result);
  assert.equal(body.error.code, "E_EXISTS");
  assert.match(body.error.message, /project dictionary/);
  assert.deepEqual(fs.readFileSync(dictionary), before);
});

test("export: a directory target is E_IO", () => {
  const game = tempGame();
  writeDictionary(game, { "アリア": { text: "阿丽亚", contexts: [] } });
  const out = path.join(game, "yakusha", "target-dir");
  fs.mkdirSync(out, { recursive: true });
  const result = run(["export", game, "--out", out, "--json"]);
  assert.equal(result.code, 2);
  const body = envelope(result);
  assert.equal(body.error.code, "E_IO");
  assert.match(body.error.message, /is a directory/);
});

test("export: missing parent directories are created", () => {
  const game = tempGame();
  writeDictionary(game, { "アリア": { text: "阿丽亚", contexts: [] } });
  const out = path.join(game, "yakusha", "nested", "deeper", "export.json");
  const result = run(["export", game, "--out", out, "--json"]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(fs.existsSync(out), true);
});

test("export: a failed write is E_IO and leaves no partial file", () => {
  const game = tempGame();
  writeDictionary(game, { "アリア": { text: "阿丽亚", contexts: [] } });
  const blocked = path.join(game, "blocked");
  fs.writeFileSync(blocked, "not a directory\n", "utf8");
  const out = path.join(blocked, "export.json");
  const result = run(["export", game, "--out", out, "--json"]);
  assert.equal(result.code, 2);
  const body = envelope(result);
  assert.equal(body.error.code, "E_IO");
  assert.equal(fs.existsSync(out), false);
});

test("export: bad arguments are E_USAGE", () => {
  const game = tempGame();
  const out = path.join(game, "yakusha", "usage.json");
  const cases = [
    ["export", game, "--json"],
    ["export", game, "--out", "-", "--json"],
    ["export", game, "--out", out, "--format", "tsv", "--flat", "--json"],
    ["export", game, "--out", out, "--format", "csv", "--flat", "--json"],
    ["export", game, "--out", out, "--format", "xml", "--json"],
    ["export", game, "--out", out, "extra", "--json"],
    ["export", game, "--out", out, "--bogus", "--json"],
    ["export", game, "--out", out, "--provider", "mock", "--json"],
    ["export", game, "--out", out, "--flat=true", "--json"],
    ["export", game, "--out", "--json"],
  ];
  for (const args of cases) {
    const result = run(args);
    assert.equal(result.code, 2, args.join(" "));
    const body = envelope(result);
    assert.equal(body.outcome, "error", args.join(" "));
    assert.equal(body.error.code, "E_USAGE", args.join(" ") + ": " + JSON.stringify(body.error));
  }
});

test("export: the payload reports the written file", () => {
  const game = tempGame();
  writeDictionary(game, {
    "アリア": { text: "阿丽亚", contexts: [] },
    "ポーション": { text: "药水", contexts: [] },
  });
  const out = path.join(game, "yakusha", "payload.json");
  const result = run(["export", game, "--out", out, "--json"]);
  assert.equal(result.code, 0, result.stderr);
  const body = envelope(result);
  const text = fs.readFileSync(out, "utf8");
  assert.equal(body.out, path.resolve(out));
  assert.equal(body.format, "json");
  assert.equal(body.flat, false);
  assert.equal(body.entries, 2);
  assert.equal(body.bytes, Buffer.byteLength(text, "utf8"));
});

test("export: text mode prints one summary line", () => {
  const game = tempGame();
  writeDictionary(game, { "アリア": { text: "阿丽亚", contexts: [] } });
  const out = path.join(game, "yakusha", "summary.json");
  const result = run(["export", game, "--out", out]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^exported 1 entry to .+ \(\d+ B\)\n$/);
  assert.equal(result.stderr, "");

  writeDictionary(game, {
    "アリア": { text: "阿丽亚", contexts: [] },
    "ポーション": { text: "药水", contexts: [] },
  });
  const many = run(["export", game, "--out", path.join(game, "yakusha", "summary2.json")]);
  assert.equal(many.code, 0, many.stderr);
  assert.match(many.stdout, /^exported 2 entries to /);
});

test("export: warns when the target is inside the game but outside yakusha/", () => {
  const game = tempGame();
  writeDictionary(game, { "アリア": { text: "阿丽亚", contexts: [] } });
  const outside = path.join(game, "export.json");
  const warned = run(["export", game, "--out", outside, "--json"]);
  assert.equal(warned.code, 0, warned.stderr);
  assert.match(warned.stderr, /warning: export target is inside the game directory but outside yakusha\//);
  envelope(warned);

  const inside = path.join(game, "yakusha", "export.json");
  const quiet = run(["export", game, "--out", inside, "--json"]);
  assert.equal(quiet.code, 0, quiet.stderr);
  assert.equal(quiet.stderr, "");
});

test("export: a dictionary without a game title exports an empty game", () => {
  const game = tempGame();
  writeDictionary(game, { "アリア": { text: "阿丽亚", contexts: [] } }, { game: null });
  const out = path.join(game, "yakusha", "untitled.json");
  const result = run(["export", game, "--out", out, "--json"]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(fs.readFileSync(out, "utf8")).game, "");
});

// ---------------------------------------------------------------------------
// TSV / CSV table formats (0.13)
//
// The table file is the exchange format a human can open in a spreadsheet:
// a BOM, a three column header, CRLF rows and RFC 4180 quoting. export and
// import must round-trip the dictionary byte for byte.
// ---------------------------------------------------------------------------

test("export: tsv and csv write a BOM, a header and quoted cells", () => {
  const game = tempGame();
  writeDictionary(game, {
    "He said \"hi\"": { text: "他说\"你好\"", contexts: ["Map001.json:3", "Map001.json:4"] },
    "plain": { text: "普通", contexts: [] },
    "comma,key": { text: "含逗号", contexts: ["Map001.json:9"] },
    "empty": { text: "", contexts: ["Map001.json:8"] },
  });
  const tsvOut = path.join(game, "yakusha", "table.tsv");
  const resultTsv = run(["export", game, "--out", tsvOut, "--format", "tsv", "--json"]);
  assert.equal(resultTsv.code, 0, resultTsv.stderr);
  const tsv = fs.readFileSync(tsvOut, "utf8");
  assert.equal(tsv.charCodeAt(0), 0xfeff, "the table must start with a BOM");
  assert.ok(tsv.includes("\r\n"), "rows end with CRLF");
  assert.ok(tsv.startsWith("\ufeffsource\ttarget\tcontexts\r\n"), "the header row is source/target/contexts");
  const body = envelope(resultTsv);
  assert.equal(body.format, "tsv");
  assert.equal(body.flat, false);
  assert.equal(body.entries, 3);
  assert.equal(body.bytes, Buffer.byteLength(tsv, "utf8"));

  const csvOut = path.join(game, "yakusha", "table.csv");
  const resultCsv = run(["export", game, "--out", csvOut, "--format", "csv", "--json"]);
  assert.equal(resultCsv.code, 0, resultCsv.stderr);
  const csv = fs.readFileSync(csvOut, "utf8");
  assert.ok(csv.startsWith("\ufeffsource,target,contexts\r\n"), "the csv header row is source/target/contexts");
  assert.ok(csv.includes("\"\""), "a quote inside a cell is doubled");

  // empty translations are not exported, in either format
  assert.ok(!tsv.split("\r\n").some((line) => line.endsWith("\t\t") || line.includes(",,,")), "no empty rows");
});

test("export: tsv cells with tabs, quotes and newlines survive round-trip", () => {
  const game = tempGame();
  writeDictionary(game, {
    "Tab\tkey": { text: "带\t制表", contexts: [] },
    "New\nline": { text: "换\n行", contexts: ["Map001.json:2"] },
    "He said \"hi\"": { text: "说\"你好\"", contexts: [] },
    "spaced ": { text: " 尾随空格 ", contexts: [] },
  });
  const out = path.join(game, "yakusha", "tricky.tsv");
  const result = run(["export", game, "--out", out, "--format", "tsv", "--json"]);
  assert.equal(result.code, 0, result.stderr);
  const dictFile = path.join(game, "yakusha", "dictionary.json");
  const before = JSON.parse(fs.readFileSync(dictFile, "utf8")).entries;

  const importResult = run(["import", game, "--from", out, "--strategy", "overwrite", "--json"]);
  assert.equal(importResult.code, 0, importResult.stderr);
  const importBody = envelope(importResult);
  assert.equal(importBody.read, 4);
  assert.equal(importBody.applied, 0, "same values are skipped");
  assert.equal(importBody.skipped, 4);
  assert.equal(importBody.format, "tsv");
  assert.equal(importBody.strategy, "overwrite");

  const after = JSON.parse(fs.readFileSync(dictFile, "utf8")).entries;
  assert.deepEqual(after, before, "import must restore the dictionary exactly");
});

test("import: only-empty never touches an existing translation", () => {
  const game = tempGame();
  writeDictionary(game, {
    "アリア": { text: "旧译文", contexts: ["Map001.json:1"] },
    "empty": { text: "", contexts: ["Map001.json:2"] },
  });
  const source = path.join(game, "yakusha", "in.tsv");
  fs.writeFileSync(source, "source\ttarget\tcontexts\r\nアリア\t新译文\tMap001.json:1\r\nempty\t填空\tMap001.json:2\r\n", "utf8");
  const dry = run(["import", game, "--from", source, "--dry-run", "--json"]);
  assert.equal(dry.code, 0, dry.stderr);
  const dryBody = envelope(dry);
  assert.equal(dryBody.dryRun, true);
  assert.equal(dryBody.applied, 1);
  const dictFile = path.join(game, "yakusha", "dictionary.json");
  assert.equal(JSON.parse(fs.readFileSync(dictFile, "utf8")).entries["アリア"].text, "旧译文", "dry run must not write");

  const result = run(["import", game, "--from", source, "--json"]);
  assert.equal(result.code, 0, result.stderr);
  const body = envelope(result);
  assert.equal(body.applied, 1);
  assert.equal(body.skipped, 1);
  const entries = JSON.parse(fs.readFileSync(dictFile, "utf8")).entries;
  assert.equal(entries["アリア"].text, "旧译文", "only-empty must keep the old translation");
  assert.equal(entries["empty"].text, "填空");
  assert.deepEqual(entries["empty"].contexts, ["Map001.json:2"]);
});

test("import: overwrite replaces and keeps row contexts when the dictionary has none", () => {
  const game = tempGame();
  writeDictionary(game, {
    "アリア": { text: "旧译文", contexts: ["Map001.json:1"] },
    "empty": { text: "", contexts: [] },
  });
  const source = path.join(game, "yakusha", "in.csv");
  fs.writeFileSync(source, "source,target,contexts\r\nアリア,新译文,Map001.json:7\r\nempty,填空,Map001.json:8\r\n", "utf8");
  const result = run(["import", game, "--from", source, "--strategy", "overwrite", "--json"]);
  assert.equal(result.code, 0, result.stderr);
  const body = envelope(result);
  assert.equal(body.applied, 2);
  const entries = JSON.parse(fs.readFileSync(path.join(game, "yakusha", "dictionary.json"), "utf8")).entries;
  assert.equal(entries["アリア"].text, "新译文");
  // dictionary contexts win when present; the row context only fills a gap
  assert.deepEqual(entries["アリア"].contexts, ["Map001.json:1"]);
  assert.deepEqual(entries["empty"].contexts, ["Map001.json:8"]);
});

test("import: json accepts rich and flat shapes", () => {
  const game = tempGame();
  writeDictionary(game, { "アリア": { text: "", contexts: [] }, "ボタン": { text: "", contexts: [] } });
  const source = path.join(game, "yakusha", "in.json");
  fs.writeFileSync(source, JSON.stringify({
    format: "yakusha/1",
    game: "Test Game",
    updatedAt: "2024-01-02T03:04:05.000Z",
    entries: {
      "アリア": { text: "阿丽亚", contexts: ["Map001.json:1"] },
      "ボタン": "按钮",
    },
  }), "utf8");
  const result = run(["import", game, "--from", source, "--json"]);
  assert.equal(result.code, 0, result.stderr);
  const body = envelope(result);
  assert.equal(body.format, "json");
  assert.equal(body.applied, 2);
  const entries = JSON.parse(fs.readFileSync(path.join(game, "yakusha", "dictionary.json"), "utf8")).entries;
  assert.equal(entries["アリア"].text, "阿丽亚");
  assert.deepEqual(entries["アリア"].contexts, ["Map001.json:1"]);
  assert.equal(entries["ボタン"].text, "按钮");
});

test("import: the format is guessed from the file extension", () => {
  const game = tempGame();
  writeDictionary(game, { "アリア": { text: "", contexts: [] } });
  const tsvSource = path.join(game, "yakusha", "in.tsv");
  fs.writeFileSync(tsvSource, "source\ttarget\tcontexts\r\nアリア\t阿丽亚\t\r\n", "utf8");
  const result = run(["import", game, "--from", tsvSource, "--json"]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(envelope(result).format, "tsv");
  const csvSource = path.join(game, "yakusha", "in.csv");
  fs.writeFileSync(csvSource, "source,target,contexts\r\nアリア,阿丽亚,\r\n", "utf8");
  assert.equal(envelope(run(["import", game, "--from", csvSource, "--json"])).format, "csv");
});

test("import: bad arguments and files are E_USAGE or E_DICTIONARY", () => {
  const game = tempGame();
  writeDictionary(game, { "アリア": { text: "", contexts: [] } });
  const cases = [
    ["import", game, "--json"],
    ["import", game, "--from", "-", "--json"],
    ["import", game, "--from", path.join(game, "yakusha", "x.txt"), "--json"],
    ["import", game, "--from", path.join(game, "yakusha", "in.tsv"), "--format", "xml", "--json"],
    ["import", game, "--from", path.join(game, "yakusha", "in.tsv"), "--strategy", "merge", "--json"],
    ["import", game, "--from", path.join(game, "yakusha", "in.tsv"), "extra", "--json"],
    ["import", game, "--from", path.join(game, "yakusha", "in.tsv"), "--bogus", "--json"],
  ];
  fs.writeFileSync(path.join(game, "yakusha", "in.tsv"), "source\ttarget\tcontexts\r\n", "utf8");
  for (const args of cases) {
    const result = run(args);
    assert.equal(result.code, 2, args.join(" "));
    const body = envelope(result);
    assert.equal(body.outcome, "error", args.join(" "));
    assert.ok(["E_USAGE", "E_DICTIONARY"].includes(body.error.code), args.join(" ") + ": " + JSON.stringify(body.error));
  }
});

test("import: a corrupt table is E_DICTIONARY, not a crash", () => {
  const game = tempGame();
  writeDictionary(game, { "アリア": { text: "", contexts: [] } });
  const bad = path.join(game, "yakusha", "bad.tsv");
  fs.writeFileSync(bad, "a\tb\r\n1\t2\r\n", "utf8");
  const header = run(["import", game, "--from", bad, "--json"]);
  assert.equal(header.code, 2);
  assert.equal(envelope(header).error.code, "E_DICTIONARY");

  const bad2 = path.join(game, "yakusha", "bad2.tsv");
  fs.writeFileSync(bad2, "source\ttarget\tcontexts\r\nonly\ttwo\r\n", "utf8");
  const row = run(["import", game, "--from", bad2, "--json"]);
  assert.equal(row.code, 2);
  assert.equal(envelope(row).error.code, "E_DICTIONARY");

  // a file that cannot be read at all is E_IO, matching export's write rules
  const missing = run(["import", game, "--from", path.join(game, "yakusha", "nope.tsv"), "--json"]);
  assert.equal(missing.code, 2);
  assert.equal(envelope(missing).error.code, "E_IO");
  // a directory without an extension has no guessable format, which is E_USAGE
  const directory = run(["import", game, "--from", game, "--json"]);
  assert.equal(directory.code, 2);
  assert.equal(envelope(directory).error.code, "E_USAGE");
});

test("round-trip: export tsv, clear translations, import back byte-identical", () => {
  const game = tempGame();
  writeDictionary(game, {
    "アリア": { text: "阿丽亚", contexts: ["Map001.json:1"] },
    "Tab\tkey": { text: "带\t制表", contexts: [] },
    "He said \"hi\"": { text: "说\"你好\"", contexts: ["Map001.json:3"] },
    "comma,key": { text: "含逗号", contexts: [] },
    "New\nline": { text: "换\n行", contexts: [] },
  });
  const dictFile = path.join(game, "yakusha", "dictionary.json");
  const original = JSON.parse(fs.readFileSync(dictFile, "utf8"));
  const out = path.join(game, "yakusha", "rt.tsv");
  assert.equal(run(["export", game, "--out", out, "--format", "tsv", "--json"]).code, 0);

  // clear every translation, then import the file back
  writeDictionary(game, {
    "アリア": { text: "", contexts: ["Map001.json:1"] },
    "Tab\tkey": { text: "", contexts: [] },
    "He said \"hi\"": { text: "", contexts: ["Map001.json:3"] },
    "comma,key": { text: "", contexts: [] },
    "New\nline": { text: "", contexts: [] },
  });
  const result = run(["import", game, "--from", out, "--json"]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(envelope(result).applied, 5);
  const restored = JSON.parse(fs.readFileSync(dictFile, "utf8"));
  assert.deepEqual(restored.entries, original.entries);
});
