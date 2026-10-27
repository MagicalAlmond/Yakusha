/**
 * The CLI on a Kirikiri game, run the way a user runs it.
 *
 * The fixtures are synthetic (test/krkr-fixture.js), and every command is
 * spawned as a real child process so argument parsing, the JSON envelope and
 * the exit codes are exercised together with the engine.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { writeKrkrProject } from "./krkr-fixture.js";

import { VERSION } from "../src/version.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, "..", "bin", "yakusha.js");
// The config file is user level, so one empty directory per process keeps the
// suite hermetic without giving every spawn its own config.
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-krkr-cli-config-"));

const KS = (text) => Buffer.from(text, "utf8");

/** @returns {string} a private copy of the synthetic game, safe to mutate */
function tempGame() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-krkr-cli-"));
  const game = path.join(dir, "game");
  writeKrkrProject(dir, { name: "game", archives: [
    { archiveName: "data.xp3", files: [
      { name: "scenario/s1.ks", data: KS("[name_set name='Aoi']\nあおい「朝のせりふ」\n[p2]\n") , mode: 1 },
      { name: "scenario/s2.ks", data: KS("[name_set name='Ren']\nれん「夜のせりふ」\n[p2]\n") , mode: 1 },
      { name: "system/Init.tjs", data: KS("class Bootstrap {}") },
    ] },
  ] });
  return game;
}

function cleanEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^YAKUSHA_/i.test(key) || /^OPENAI_API_KEY$/i.test(key)) delete env[key];
  }
  env.YAKUSHA_CONFIG_DIR = CONFIG_DIR;
  return env;
}

function run(args) {
  const result = spawnSync("node", [BIN, ...args], { encoding: "utf8", env: cleanEnv(), timeout: 60000 });
  return { code: result.status === null ? 1 : result.status, stdout: result.stdout || "", stderr: result.stderr || "" };
}

/** @returns {any} */
function envelope(result) {
  assert.equal(result.stdout.endsWith("\n"), true, "stdout must end with a newline");
  const lines = result.stdout.trimEnd().split("\n");
  assert.equal(lines.length, 1, "expected one JSON object, got: " + result.stdout.slice(0, 400));
  return JSON.parse(lines[0]);
}

test("cli: scan reports a Kirikiri game and exits 0", () => {
  const result = run(["scan", tempGame(), "--json"]);
  assert.equal(result.code, 0, result.stderr);
  const summary = envelope(result);
  assert.equal(summary.ok, true);
  assert.equal(summary.outcome, "ok");
  assert.equal(summary.command, "scan");
  assert.equal(summary.engine, "krkr");
  assert.equal(summary.engineVersion, null);
  assert.equal(summary.gameTitle, null);
  assert.equal(summary.uniqueStrings, 2);
  assert.equal(summary.dataFiles, 1);
});

test("cli: scan in text mode labels the size line with data files", () => {
  const result = run(["scan", tempGame()]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^engine +: krkr$/m);
  assert.match(result.stdout, /^data files: 1$/m);
  assert.match(result.stdout, /^strings +: 2 unique \/ 2 total$/m);
  assert.match(result.stdout, /^encodings : xp3 1$/m);
});

test("cli: extract writes a dictionary with script-line contexts", () => {
  const game = tempGame();
  const result = run(["extract", game, "--json"]);
  assert.equal(result.code, 0, result.stderr);
  const payload = envelope(result);
  assert.equal(payload.added, 2);
  const file = path.join(game, "yakusha", "dictionary.json");
  assert.equal(fs.existsSync(file), true);
  const dictionary = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(dictionary.format, "yakusha/1");
  assert.equal(dictionary.entries["あおい「朝のせりふ」"].contexts[0], "scenario/s1.ks:2");
});

test("cli: install says the delivery layer is pending, and writes nothing", () => {
  const game = tempGame();
  assert.equal(run(["extract", game, "--json"]).code, 0);
  const before = fs.readdirSync(game);
  const result = run(["install", game, "--json"]);
  assert.equal(result.code, 2);
  const payload = envelope(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.outcome, "error");
  assert.equal(payload.error.code, "E_NOT_IMPLEMENTED");
  assert.match(payload.error.message, /^install is not implemented for Kirikiri yet/);
  // Nothing new appeared in the game directory.
  assert.deepEqual(fs.readdirSync(game), before);
});

test("cli: install on a game with no dictionary reports the same pending layer", () => {
  const result = run(["install", tempGame(), "--json"]);
  assert.equal(result.code, 2);
  const payload = envelope(result);
  assert.equal(payload.error.code, "E_NOT_IMPLEMENTED");
  assert.match(payload.error.message, /docs\/dev\/DEVLOG\.md$/);
});

test("cli: uninstall reports the same pending layer", () => {
  const result = run(["uninstall", tempGame(), "--json"]);
  assert.equal(result.code, 2);
  const payload = envelope(result);
  assert.equal(payload.error.code, "E_NOT_IMPLEMENTED");
  assert.match(payload.error.message, /^uninstall is not implemented for Kirikiri yet/);
});

test("cli: doctor reports the game as usable and names the pending layer", () => {
  const game = tempGame();
  assert.equal(run(["extract", game, "--json"]).code, 0);
  const result = run(["doctor", game, "--json"]);
  assert.equal(result.code, 0, result.stderr);
  const payload = envelope(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.verdict, "usable");
  assert.equal(payload.game.engine, "krkr");
  assert.equal(payload.game.dataFiles, 1);
  const levels = Object.fromEntries(payload.checks.map((check) => [check.id, check.level]));
  assert.equal(levels.install, "warn");
  const install = payload.checks.find((check) => check.id === "install");
  assert.match(install.message, /no delivery layer yet/);
});

test("cli: doctor on a game with no dictionary is broken, and says what to run", () => {
  const result = run(["doctor", tempGame(), "--json"]);
  assert.equal(result.code, 1, result.stderr);
  const payload = envelope(result);
  assert.equal(payload.outcome, "findings");
  assert.equal(payload.verdict, "broken");
  const dictionary = payload.checks.find((check) => check.id === "dictionary");
  assert.equal(dictionary.level, "fail");
  // Even then the pending delivery layer is reported, not hidden.
  assert.equal(payload.checks.find((check) => check.id === "install").level, "warn");
});

test("cli: verify reads the dictionary the extractor wrote", () => {
  const game = tempGame();
  assert.equal(run(["extract", game, "--json"]).code, 0);
  const result = run(["verify", game, "--json"]);
  assert.equal(result.code, 0, result.stderr);
  const payload = envelope(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.total, 2);
  assert.equal(payload.pending, 2);
  assert.equal(payload.errors, 0);
});

test("cli: speaker and terms work on a Kirikiri game through the shared pipeline", () => {
  const game = tempGame();
  assert.equal(run(["extract", game, "--json"]).code, 0);
  const speaker = run(["speaker", game, "--json"]);
  assert.equal(speaker.code, 0, speaker.stderr);
  assert.equal(envelope(speaker).ok, true);
  const terms = run(["terms", game, "--json"]);
  assert.equal(terms.code, 0, terms.stderr);
  assert.equal(envelope(terms).ok, true);
});

test("cli: export writes the translated entries of a Kirikiri dictionary", () => {
  const game = tempGame();
  assert.equal(run(["extract", game, "--json"]).code, 0);
  const dictionaryFile = path.join(game, "yakusha", "dictionary.json");
  const dictionary = JSON.parse(fs.readFileSync(dictionaryFile, "utf8"));
  dictionary.entries["あおい「朝のせりふ」"].text = "T:morning";
  fs.writeFileSync(dictionaryFile, JSON.stringify(dictionary, null, 2) + "\n");

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-krkr-cli-export-"));
  const file = path.join(directory, "export.tsv");
  const result = run(["export", game, "--format", "tsv", "--out", file, "--json"]);
  assert.equal(result.code, 0, result.stderr);
  const exported = fs.readFileSync(file, "utf8");
  assert.ok(exported.startsWith("\uFEFFsource\ttarget\tcontexts\r\n"), "TSV export carries the BOM and header");
  assert.match(exported, /T:morning/);
});

test("cli: a directory that is not a game is a documented not-a-project error", () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-krkr-cli-empty-"));
  const result = run(["scan", empty, "--json"]);
  assert.equal(result.code, 2);
  const payload = envelope(result);
  assert.equal(payload.error.code, "E_NOT_PROJECT");
  // detectProject keeps the first engine's generic wording (MZ here); the
  // Kirikiri-specific wording is covered by the adapter tests.
  assert.match(payload.error.message, /^not an RPG Maker project/);
});

test("cli: --version is unaffected by the Kirikiri engine", () => {
  const result = run(["--version"]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, "yakusha " + VERSION + "\n");
});
