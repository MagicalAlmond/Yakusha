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
    ["export", game, "--out", out, "--format", "tsv", "--json"],
    ["export", game, "--out", out, "--format", "csv", "--json"],
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
