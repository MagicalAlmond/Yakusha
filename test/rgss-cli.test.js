/**
 * The CLI on an RGSS game, run the way a user runs it.
 *
 * The fixtures are synthetic (test/rgss-fixture.js), and every command is
 * spawned as a real child process so argument parsing, the JSON envelope and
 * the exit codes are exercised together with the engine.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { writePackedProject, writeRgssProject } from "./rgss-fixture.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, "..", "bin", "yakusha.js");
// The config file is user level, so one empty directory per process keeps the
// suite hermetic without giving every spawn its own config.
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-rgss-cli-config-"));

/** @returns {string} a private copy of the synthetic game, safe to mutate */
function tempGame(kind = "plain") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-rgss-cli-"));
  const game = path.join(dir, "game");
  if (kind === "packed") writePackedProject(game);
  else writeRgssProject(game);
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
  try {
    const stdout = execFileSync(process.execPath, [BIN, ...args], { encoding: "utf8", env: cleanEnv() });
    return { code: 0, stdout, stderr: "" };
  } catch (error) {
    return { code: error.status === undefined ? 1 : error.status, stdout: error.stdout || "", stderr: error.stderr || "" };
  }
}
test("cli: scan reports an RGSS game and exits 0", () => {
  const result = run(["scan", tempGame(), "--json"]);
  assert.equal(result.code, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.ok, true);
  assert.equal(summary.outcome, "ok");
  assert.equal(summary.command, "scan");
  assert.equal(summary.engine, "rgss");
  assert.equal(summary.engineVersion, "3");
  assert.equal(summary.gameTitle, "Synthetic Quest");
  assert.equal(summary.uniqueStrings, 29);
  assert.equal(summary.dataFiles, 7);
});

test("cli: scan prints a packed game without reading a Data folder", () => {
  const game = tempGame("packed");
  assert.equal(fs.existsSync(path.join(game, "Data")), false);
  const summary = JSON.parse(run(["scan", game, "--json"]).stdout);
  assert.equal(summary.uniqueStrings, 29);
  assert.deepEqual(summary.encodings, { marshal: 7 });
});

test("cli: scan in text mode labels the size line with data files", () => {
  const result = run(["scan", tempGame()]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^engine +: rgss 3$/m);
  assert.match(result.stdout, /^data files: 7$/m);
  assert.match(result.stdout, /^strings +: 29 unique \/ 29 total$/m);
});

test("cli: extract writes a dictionary for the RGSS strings", () => {
  const game = tempGame();
  const result = run(["extract", game, "--json"]);
  assert.equal(result.code, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.added, 29);
  const file = path.join(game, "yakusha", "dictionary.json");
  assert.equal(fs.existsSync(file), true);
  const dictionary = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(dictionary.format, "yakusha/1");
  assert.equal(dictionary.entries["Narrator"].contexts[0], "Map001.rvdata2:101");
});

test("cli: install says the delivery layer is pending, and writes nothing", () => {
  const game = tempGame();
  assert.equal(run(["extract", game, "--json"]).code, 0);
  const result = run(["install", game, "--json"]);
  assert.equal(result.code, 2);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.outcome, "error");
  assert.equal(payload.error.code, "E_NOT_IMPLEMENTED");
  assert.match(payload.error.message, /^install is not implemented for RGSS yet/);
  // The dictionary was written by extract; nothing else changed.
  assert.equal(fs.existsSync(path.join(game, "Game.rgss3a")), false);
});

test("cli: install on a game with no dictionary reports the same pending layer", () => {
  // The delivery layer is missing before the dictionary is even looked at, so
  // the user gets one clear reason rather than a "no dictionary" hint that
  // would not help: extracting first would still not install anything.
  const result = run(["install", tempGame(), "--json"]);
  assert.equal(result.code, 2);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.error.code, "E_NOT_IMPLEMENTED");
  assert.match(payload.error.message, /docs\/dev\/DEVLOG\.md$/);
});
test("cli: uninstall reports the same pending layer", () => {
  const result = run(["uninstall", tempGame(), "--json"]);
  assert.equal(result.code, 2);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.error.code, "E_NOT_IMPLEMENTED");
  assert.match(payload.error.message, /^uninstall is not implemented for RGSS yet/);
});

test("cli: doctor reports the game as usable and names the pending layer", () => {
  const game = tempGame();
  assert.equal(run(["extract", game, "--json"]).code, 0);
  const result = run(["doctor", game, "--json"]);
  assert.equal(result.code, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.verdict, "usable");
  assert.equal(payload.game.engine, "rgss");
  assert.equal(payload.game.dataFiles, 7);
  const levels = Object.fromEntries(payload.checks.map((check) => [check.id, check.level]));
  assert.equal(levels.install, "warn");
  const install = payload.checks.find((check) => check.id === "install");
  assert.match(install.message, /no delivery layer yet/);
});

test("cli: doctor on a game with no dictionary is broken, and says what to run", () => {
  const result = run(["doctor", tempGame(), "--json"]);
  // A missing dictionary is the one failure doctor treats as broken: without it
  // the tool cannot do anything, so the exit code is "findings", not "ok".
  assert.equal(result.code, 1, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.outcome, "findings");
  assert.equal(payload.verdict, "broken");
  const dictionary = payload.checks.find((check) => check.id === "dictionary");
  assert.equal(dictionary.level, "fail");
  assert.match(dictionary.message, /- run: yakusha extract <game>$/);
  // Even then the pending delivery layer is reported, not hidden.
  assert.equal(payload.checks.find((check) => check.id === "install").level, "warn");
});

test("cli: verify reads the dictionary the extractor wrote", () => {
  const game = tempGame();
  assert.equal(run(["extract", game, "--json"]).code, 0);
  const result = run(["verify", game, "--json"]);
  assert.equal(result.code, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  // Nothing is translated yet, so the dictionary is 29 pending entries.
  assert.equal(payload.total, 29);
  assert.equal(payload.pending, 29);
  assert.equal(payload.errors, 0);
});

test("cli: speaker and terms work on an RGSS game through the shared pipeline", () => {
  const game = tempGame();
  assert.equal(run(["extract", game, "--json"]).code, 0);
  const speaker = run(["speaker", game, "--json"]);
  assert.equal(speaker.code, 0, speaker.stderr);
  assert.equal(JSON.parse(speaker.stdout).ok, true);
  const terms = run(["terms", game, "--json"]);
  assert.equal(terms.code, 0, terms.stderr);
  assert.equal(JSON.parse(terms.stdout).ok, true);
});

test("cli: export writes the translated entries of an RGSS dictionary", () => {
  const game = tempGame();
  assert.equal(run(["extract", game, "--json"]).code, 0);
  // An export is a projection of the translations, so fill two of them in.
  const dictionaryFile = path.join(game, "yakusha", "dictionary.json");
  const dictionary = JSON.parse(fs.readFileSync(dictionaryFile, "utf8"));
  dictionary.entries["Yuki"].text = "T:Yuki";
  dictionary.entries["Narrator"].text = "T:Narrator";
  fs.writeFileSync(dictionaryFile, JSON.stringify(dictionary, null, 2) + "\n");

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-rgss-cli-export-"));
  const file = path.join(directory, "export.json");
  const result = run(["export", game, "--format", "json", "--out", file, "--json"]);
  assert.equal(result.code, 0, result.stderr);
  const exported = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(exported.format, "yakusha/1");
  assert.deepEqual(Object.keys(exported.entries).sort(), ["Narrator", "Yuki"]);
  assert.equal(exported.entries["Yuki"].text, "T:Yuki");
});

test("cli: a directory that is not a game is a documented not-a-project error", () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-rgss-cli-empty-"));
  const result = run(["scan", empty, "--json"]);
  assert.equal(result.code, 2);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.error.code, "E_NOT_PROJECT");
  assert.match(payload.error.message, /^not an RPG Maker project/);
});
