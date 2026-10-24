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
