/**
 * End to end CLI tests.
 *
 * These run the real binary the way a user would, on a throwaway copy of the
 * fixture, so argument parsing, JSON output, exit codes and the install /
 * uninstall round trip are all exercised together.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, "..", "bin", "yakusha.js");
const FIXTURE = path.join(HERE, "fixtures", "mini-mz");

/** @returns {string} a private copy of the fixture, safe to mutate */
export function tempGame() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-cli-"));
  const game = path.join(dir, "game");
  fs.cpSync(FIXTURE, game, { recursive: true });
  return game;
}

/** @returns {{ code: number, stdout: string, stderr: string }} */
function run(args) {
  try {
    const stdout = execFileSync(process.execPath, [BIN, ...args], { encoding: "utf8" });
    return { code: 0, stdout, stderr: "" };
  } catch (error) {
    return {
      code: error.status === undefined ? 1 : error.status,
      stdout: error.stdout || "",
      stderr: error.stderr || "",
    };
  }
}

test("cli: scan reports the fixture and exits 0", () => {
  const game = tempGame();
  const result = run(["scan", game, "--json"]);
  assert.equal(result.code, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.ok, true);
  assert.equal(summary.engine, "mz");
  assert.equal(summary.uniqueStrings, 32);
  assert.equal(summary.totalStrings, 32);
  assert.equal(summary.perFile["CommonEvents.json"] > 0, true);
});

test("cli: extract writes a dictionary with empty targets", () => {
  const game = tempGame();
  assert.equal(run(["extract", game, "--json"]).code, 0);
  const file = path.join(game, "yakusha", "dictionary.json");
  assert.equal(fs.existsSync(file), true);
  const dict = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(dict.format, "yakusha/1");
  assert.equal(Object.keys(dict.entries).length, 32);
  assert.equal(Object.values(dict.entries).every((e) => e.text === ""), true);
});

test("cli: extract keeps existing translations and only adds new keys", () => {
  const game = tempGame();
  assert.equal(run(["extract", game]).code, 0);
  const file = path.join(game, "yakusha", "dictionary.json");
  const dict = JSON.parse(fs.readFileSync(file, "utf8"));
  dict.entries["ポーション"].text = "药水";
  fs.writeFileSync(file, JSON.stringify(dict, null, 2) + "\n", "utf8");

  const again = run(["extract", game, "--json"]);
  assert.equal(again.code, 0);
  assert.equal(JSON.parse(again.stdout).added, 0);
  const kept = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(kept.entries["ポーション"].text, "药水");
});

test("cli: status counts translated entries", () => {
  const game = tempGame();
  assert.equal(run(["extract", game]).code, 0);
  const before = JSON.parse(run(["status", game, "--json"]).stdout);
  assert.deepEqual([before.translated, before.total, before.pending], [0, 32, 32]);

  const file = path.join(game, "yakusha", "dictionary.json");
  const dict = JSON.parse(fs.readFileSync(file, "utf8"));
  dict.entries["ポーション"].text = "药水";
  fs.writeFileSync(file, JSON.stringify(dict, null, 2) + "\n", "utf8");

  const after = JSON.parse(run(["status", game, "--json"]).stdout);
  assert.deepEqual([after.translated, after.total, after.pending], [1, 32, 31]);
});

test("cli: --dry-run uses the mock provider and writes nothing", () => {
  const game = tempGame();
  assert.equal(run(["extract", game]).code, 0);
  const file = path.join(game, "yakusha", "dictionary.json");
  const before = fs.readFileSync(file, "utf8");

  const result = run(["translate", game, "--dry-run", "--json"]);
  assert.equal(result.code, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.dryRun, true);
  assert.equal(summary.translated, 32);
  assert.equal(fs.readFileSync(file, "utf8"), before);
});

test("cli: --glossary-only applies a term base without a provider", () => {
  const game = tempGame();
  assert.equal(run(["extract", game]).code, 0);
  const glossary = path.join(game, "terms.json");
  fs.writeFileSync(glossary, JSON.stringify({ entries: { "ポーション": "药水", "はい": "是" } }), "utf8");

  const result = run(["translate", game, "--glossary-only", "--glossary", glossary, "--json"]);
  assert.equal(result.code, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.translated, 2);
  assert.equal(summary.provider, "glossary");

  const dict = JSON.parse(fs.readFileSync(path.join(game, "yakusha", "dictionary.json"), "utf8"));
  assert.equal(dict.entries["ポーション"].text, "药水");
});

test("cli: repeating --context widens the filter instead of overwriting it", () => {
  const game = tempGame();
  assert.equal(run(["extract", game]).code, 0);

  // Items.json:name and Skills.json:name are disjoint contexts, so a single
  // value can never select both. The repeated form must union them.
  const items = JSON.parse(run(["translate", game, "--dry-run", "--context", "Items.json", "--json"]).stdout);
  const skills = JSON.parse(run(["translate", game, "--dry-run", "--context", "Skills.json", "--json"]).stdout);
  const both = JSON.parse(run(["translate", game, "--dry-run", "--context", "Items.json", "--context", "Skills.json", "--json"]).stdout);
  assert.ok(items.translated > 0, "Items.json should match something");
  assert.ok(skills.translated > 0, "Skills.json should match something");
  assert.equal(both.translated, items.translated + skills.translated);
});

test("cli: install then uninstall restores plugins.js byte for byte", () => {
  const game = tempGame();
  const before = fs.readFileSync(path.join(game, "js", "plugins.js"));

  const installed = run(["install", game, "--json"]);
  assert.equal(installed.code, 0, installed.stderr);
  const info = JSON.parse(installed.stdout);
  assert.equal(info.registered, true);
  assert.equal(info.state, "added");
  assert.equal(fs.existsSync(info.pluginPath), true);
  assert.equal(fs.existsSync(path.join(game, "js", "plugins.js.yakusha-backup")), true);
  // RPG Maker writes one compact object per line, and so must we.
  assert.match(fs.readFileSync(path.join(game, "js", "plugins.js"), "utf8"), /\{"name":"YAKUSHA_Translator"/);

  const removed = run(["uninstall", game, "--json"]);
  assert.equal(removed.code, 0, removed.stderr);
  assert.equal(JSON.parse(removed.stdout).restored, true);
  assert.deepEqual(fs.readFileSync(path.join(game, "js", "plugins.js")), before);
  assert.equal(fs.existsSync(info.pluginPath), false);
});

test("cli: install --embed writes the translations into the plugin file", () => {
  const game = tempGame();
  assert.equal(run(["extract", game]).code, 0);
  const file = path.join(game, "yakusha", "dictionary.json");
  const dict = JSON.parse(fs.readFileSync(file, "utf8"));
  dict.entries["ポーション"].text = "药水";
  fs.writeFileSync(file, JSON.stringify(dict, null, 2) + "\n", "utf8");

  const result = run(["install", game, "--embed", "--json"]);
  assert.equal(result.code, 0, result.stderr);
  const source = fs.readFileSync(JSON.parse(result.stdout).pluginPath, "utf8");
  assert.match(source, /const EMBEDDED = \{/);
  assert.match(source, /药水/);
});

test("cli: an unknown command fails with a usage message", () => {
  const result = run(["nope", tempGame()]);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /unknown command: nope/);
});

test("cli: a directory that is not a game fails politely", () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-empty-"));
  const result = run(["scan", empty]);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /not an RPG Maker project/);
});

test("cli: a game nested in a subfolder is found from the parent", () => {
  const outer = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-outer-"));
  const inner = path.join(outer, "the game");
  fs.cpSync(FIXTURE, inner, { recursive: true });
  const result = run(["scan", outer, "--json"]);
  assert.equal(result.code, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.ok, true);
  assert.equal(path.resolve(summary.root), path.resolve(inner));
  assert.equal(summary.uniqueStrings, 32);
});

test("cli: two games in one folder ask for a specific one", () => {
  const outer = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-many-"));
  fs.cpSync(FIXTURE, path.join(outer, "a"), { recursive: true });
  fs.cpSync(FIXTURE, path.join(outer, "b"), { recursive: true });
  const result = run(["scan", outer]);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /found 2 RPG Maker projects/);
});

test("cli: verify reports problems and sets ok from the error count", () => {
  const game = tempGame();
  assert.equal(run(["extract", game]).code, 0);
  const file = path.join(game, "yakusha", "dictionary.json");
  const dict = JSON.parse(fs.readFileSync(file, "utf8"));
  dict.entries["ポーション"].text = "药水";
  // An echo of a Japanese source is the defect that must fail a release.
  const echoed = Object.keys(dict.entries).find((key) => key !== "ポーション" && /[\u3041-\u3096\u30a1-\u30fa]/.test(key));
  assert.equal(typeof echoed, "string");
  dict.entries[echoed].text = echoed;
  fs.writeFileSync(file, JSON.stringify(dict, null, 2) + "\n", "utf8");

  const result = run(["verify", game, "--json"]);
  assert.equal(result.code, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.ok, false);
  assert.equal(summary.translated, 2);
  assert.equal(summary.errors, 1);
  assert.equal(summary.counts.echo, 1);
  assert.equal(path.resolve(summary.file), path.resolve(file));
});

test("cli: verify on a dictionary with no translations is clean", () => {
  const game = tempGame();
  assert.equal(run(["extract", game]).code, 0);
  const result = run(["verify", game, "--json"]);
  assert.equal(result.code, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.ok, true);
  assert.deepEqual(summary.problems, []);
  assert.equal(summary.translated, 0);
});

test("cli: verify --kind limits the report to one kind", () => {
  const game = tempGame();
  assert.equal(run(["extract", game]).code, 0);
  const file = path.join(game, "yakusha", "dictionary.json");
  const dict = JSON.parse(fs.readFileSync(file, "utf8"));
  const key = Object.keys(dict.entries).find((k) => /[\u3041-\u3096\u30a1-\u30fa]/.test(k));
  dict.entries[key].text = key;
  fs.writeFileSync(file, JSON.stringify(dict, null, 2) + "\n", "utf8");

  const kana = JSON.parse(run(["verify", game, "--kind", "kana", "--json"]).stdout);
  assert.equal(kana.counts.echo, undefined);
  assert.equal(kana.counts.kana >= 1, true);
  const echo = JSON.parse(run(["verify", game, "--kind=echo", "--json"]).stdout);
  assert.deepEqual(echo.counts, { echo: 1 });
});

test("cli: verify needs a dictionary first", () => {
  const game = tempGame();
  const result = run(["verify", game]);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /no dictionary yet/);
});

/**
 * Build a dictionary that has something to mine: a name entry plus dialogue
 * lines that mention it. The CLI fixture is too small to mine anything on its
 * own (one name, mentioned nowhere), so the corpus is written here.
 *
 * @param {string} game
 * @param {Array<[string, string, string[]?]>} rows
 */
function writeDictionary(game, rows) {
  const entries = {};
  for (const [key, text, contexts] of rows) entries[key] = { text, contexts: contexts || ["Map001.json:401"] };
  const dict = { format: "yakusha/1", game: "fixture", updatedAt: new Date(0).toISOString(), entries };
  fs.mkdirSync(path.join(game, "yakusha"), { recursive: true });
  const file = path.join(game, "yakusha", "dictionary.json");
  fs.writeFileSync(file, JSON.stringify(dict, null, 2) + "\n", "utf8");
  return file;
}

/** Name entry plus six mentions, five of which use `spelling`. */
function miningRows(name, db, spelling, total = 6, mine = 5) {
  const rows = [[name, db, ["Actors.json:name"]]];
  for (let i = 0; i < total; i += 1) {
    rows.push([name + " line " + i, (i < mine ? spelling : "other") + " line " + i]);
  }
  return rows;
}

test("cli: terms reports drift and a glossary count", () => {
  const game = tempGame();
  writeDictionary(game, miningRows("ゴブリン", "哥布", "哥布林"));
  const result = run(["terms", game, "--json"]);
  assert.equal(result.code, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.ok, true);
  assert.equal(summary.names, 1);
  assert.equal(summary.mined, 1);
  assert.equal(summary.glossary, 1);
  assert.equal(summary.written, null);
  assert.equal(summary.terms[0].suggested, "哥布林");
});

test("cli: terms --status filters what is listed but not what is mined", () => {
  const game = tempGame();
  writeDictionary(game, [
    ...miningRows("ゴブリン", "哥布林", "哥布林"),
    ...miningRows("フェイリン", "费琳", "菲琳"),
  ]);
  const all = JSON.parse(run(["terms", game, "--json"]).stdout);
  assert.equal(all.listed, 2);
  const drift = JSON.parse(run(["terms", game, "--status", "drift", "--json"]).stdout);
  assert.equal(drift.mined, 2);
  assert.equal(drift.listed, 1);
  assert.equal(drift.terms[0].name, "フェイリン");
});

test("cli: terms human output stays complete when --status matches nothing", () => {
  const game = tempGame();
  writeDictionary(game, miningRows("ゴブリン", "哥布林", "哥布林"));
  // Regression: an early return used to hide the trailing glossary line, so the
  // report looked truncated exactly when the user was filtering.
  const filtered = run(["terms", game, "--status", "drift"]);
  assert.equal(filtered.code, 0, filtered.stderr);
  assert.match(filtered.stdout, /none match --status \(1 mined\)/);
  assert.match(filtered.stdout, /glossary  : 0 entries/);

  const empty = run(["terms", game, "--min-holders", "99"]);
  assert.match(empty.stdout, /terms     : none \(needs at least 99/);
  assert.match(empty.stdout, /glossary  : 0 entries/);
});

test("cli: terms --write saves a glossary translate can read", () => {
  const game = tempGame();
  writeDictionary(game, miningRows("フェイリン", "费琳", "菲琳"));
  const file = path.join(game, "yakusha", "glossary.json");
  const result = run(["terms", game, "--drift-only", "--write", file, "--json"]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).written, path.resolve(file));
  const glossary = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(glossary.entries["フェイリン"], "菲琳");

  // The file has to be accepted by translate without any conversion step.
  const applied = run(["translate", game, "--glossary", file, "--glossary-only", "--overwrite", "--json"]);
  assert.equal(applied.code, 0, applied.stderr);
  const dict = JSON.parse(fs.readFileSync(path.join(game, "yakusha", "dictionary.json"), "utf8"));
  assert.equal(dict.entries["フェイリン"].text, "菲琳");
  assert.equal(dict.entries["フェイリン line 0"].text, "菲琳 line 0");
});

test("cli: terms --dry-run reports without writing", () => {
  const game = tempGame();
  writeDictionary(game, miningRows("ゴブリン", "哥布林", "哥布林"));
  const file = path.join(game, "yakusha", "glossary.json");
  const result = run(["terms", game, "--write", file, "--dry-run", "--json"]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).written, null);
  assert.equal(fs.existsSync(file), false);
});

test("cli: terms needs a dictionary first", () => {
  const game = tempGame();
  const result = run(["terms", game]);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /no dictionary yet/);
});

