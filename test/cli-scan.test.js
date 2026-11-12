/**
 * scan on a project whose data files cannot be read.
 *
 * A game with an encrypted archive index used to scan as ok / exit 0 with zero
 * strings: the rejections were visible only in the --json undecodable array and
 * were joined into a single comma separated line in text mode. scan now prints
 * one UNDECODED line per rejected file, adds a WARNING summary, and reports the
 * run as findings (ok:false, exit 1) when nothing readable is left.
 *
 * Every fixture here is synthetic; each command runs as a real child process so
 * the exit code and the envelope are asserted together with the text output.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { buildXp3, writeKrkrProject } from "./krkr-fixture.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, "..", "bin", "yakusha.js");
// The config file is user level, so one empty directory per process keeps the
// suite hermetic without giving every spawn its own config.
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-cli-scan-config-"));

// An index magic the reader rejects: the archive is written, but cannot be read.
const REJECTED_INDEX = "Hxv4";

const KS = (text) => Buffer.from(text, "utf8");

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

/**
 * A Kirikiri project with an empty data directory to fill by hand.
 * writeKrkrProject does not forward writer options, so rejected archives are
 * written directly.
 *
 * @returns {{ root: string, dataDir: string }}
 */
function emptyGame() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-cli-scan-"));
  const root = path.join(dir, "game");
  const dataDir = path.join(root, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  return { root, dataDir };
}

/**
 * @param {string} dataDir
 * @param {string} name archive file name
 * @param {boolean} rejected write an index the reader rejects
 */
function archive(dataDir, name, rejected) {
  const files = [{ name: "scenario/s1.ks", data: KS("[p2]\n"), mode: 1 }];
  const opts = rejected ? { indexMagic: REJECTED_INDEX } : {};
  fs.writeFileSync(path.join(dataDir, name), buildXp3(files, opts));
}

/**
 * A game whose every archive is rejected.
 *
 * @param {string[]} [names]
 * @returns {string} project root
 */
function rejectedGame(names = ["data.xp3"]) {
  const { root, dataDir } = emptyGame();
  for (const name of names) archive(dataDir, name, true);
  return root;
}

/**
 * A game with one readable archive holding two lines of dialogue.
 *
 * @returns {string} project root
 */
function readableGame() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-cli-scan-"));
  writeKrkrProject(dir, {
    name: "game",
    archives: [
      {
        archiveName: "data.xp3",
        files: [
          { name: "scenario/s1.ks", data: KS("[name_set name='Aoi']\nあおい「朝のせりふ」\n[p2]\n"), mode: 1 },
          { name: "scenario/s2.ks", data: KS("[name_set name='Ren']\nれん「夜のせりふ」\n[p2]\n"), mode: 1 },
        ],
      },
    ],
  });
  return path.join(dir, "game");
}

/**
 * A game with one rejected and one readable archive.
 *
 * @returns {string} project root
 */
function partiallyReadableGame() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-cli-scan-"));
  const root = path.join(dir, "game");
  writeKrkrProject(dir, {
    name: "game",
    archives: [
      {
        archiveName: "scenario.xp3",
        files: [{ name: "scenario/s1.ks", data: KS("[name_set name='Aoi']\nあおい「朝のせりふ」\n[p2]\n"), mode: 1 }],
      },
    ],
  });
  fs.writeFileSync(path.join(root, "data", "data.xp3"), buildXp3([{ name: "scenario/s2.ks", data: KS("[p2]\n") }], { indexMagic: REJECTED_INDEX }));
  return root;
}

/**
 * A Kirikiri game that yields no strings but has nothing to reject.
 *
 * @returns {string} project root
 */
function silentGame() {
  const { root, dataDir } = emptyGame();
  fs.writeFileSync(path.join(dataDir, "data.xp3"), buildXp3([{ name: "system/Init.tjs", data: KS("class Bootstrap {}\n") }]));
  return root;
}

/**
 * A Ren'Py game whose only script is a corrupt .rpyc.
 *
 * @returns {string} project root
 */
function brokenRenpyGame() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-cli-scan-"));
  const root = path.join(dir, "game");
  fs.mkdirSync(path.join(root, "game"), { recursive: true });
  fs.writeFileSync(path.join(root, "game", "broken.rpyc"), Buffer.from("not an rpyc container"));
  fs.writeFileSync(path.join(root, "game", "script.rpy"), "label start:\n    return\n");
  return root;
}

test("cli: scan --json reports findings when every archive is rejected", () => {
  const result = run(["scan", rejectedGame(["data.xp3", "extra.xp3"]), "--json"]);
  assert.equal(result.code, 1, result.stderr);
  const payload = envelope(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.outcome, "findings");
  assert.equal(payload.command, "scan");
  assert.equal(payload.error, null);
  assert.equal(payload.engine, "krkr");
  assert.equal(payload.uniqueStrings, 0);
  assert.equal(payload.dataFiles, 0);
  assert.equal(payload.undecodable.length, 2);
  assert.match(payload.undecodable[0], /^data\.xp3: /);
  assert.match(payload.undecodable[1], /^extra\.xp3: /);
});

test("cli: scan prints one UNDECODED line per rejected archive", () => {
  const result = run(["scan", rejectedGame(["data.xp3", "extra.xp3"])]);
  assert.equal(result.code, 1, result.stderr);
  const lines = result.stdout.trimEnd().split("\n");
  const labelled = lines.filter((line) => line.startsWith("UNDECODED"));
  assert.equal(labelled.length, 1, "only the first entry carries the label: " + result.stdout);
  assert.match(labelled[0], /^UNDECODED : data\.xp3: /);
  const continuation = lines.filter((line) => /^ {12}\S/.test(line));
  assert.equal(continuation.length, 1, "the second entry continues on its own line: " + result.stdout);
  assert.match(continuation[0], /^ {12}extra\.xp3: /);
  assert.equal("UNDECODED : ".length, 12, "continuation lines align with the value column");
  assert.equal(
    lines.some((line) => /^UNDECODED : .*\.xp3: .*, /.test(line)),
    false,
    "entries must not be joined into one line: " + result.stdout,
  );
  assert.match(result.stdout, /^WARNING   : nothing readable - 2 data files rejected$/m);
});

test("cli: scan keeps the JSON payload shape for unreadable projects", () => {
  const rejected = envelope(run(["scan", rejectedGame(["data.xp3"]), "--json"]));
  const readable = envelope(run(["scan", readableGame(), "--json"]));
  assert.deepEqual(Object.keys(rejected).sort(), Object.keys(readable).sort());
  assert.equal(readable.ok, true);
  assert.equal(readable.outcome, "ok");
  assert.equal(readable.uniqueStrings, 2);
});

test("cli: scan stays ok when a game has no strings but nothing was rejected", () => {
  const root = silentGame();
  const result = run(["scan", root, "--json"]);
  assert.equal(result.code, 0, result.stderr);
  const payload = envelope(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.outcome, "ok");
  assert.equal(payload.uniqueStrings, 0);
  assert.deepEqual(payload.undecodable, []);
  assert.equal(payload.dataFiles, 1);
  const text = run(["scan", root]);
  assert.equal(text.code, 0, text.stderr);
  assert.doesNotMatch(text.stdout, /^UNDECODED/m);
  assert.doesNotMatch(text.stdout, /^WARNING/m);
  assert.match(text.stdout, /^strings +: 0 unique \/ 0 total$/m);
});

test("cli: scan stays ok when at least one archive is readable", () => {
  const root = partiallyReadableGame();
  const result = run(["scan", root, "--json"]);
  assert.equal(result.code, 0, result.stderr);
  const payload = envelope(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.outcome, "ok");
  assert.equal(payload.uniqueStrings, 1);
  assert.equal(payload.undecodable.length, 1);
  assert.match(payload.undecodable[0], /^data\.xp3: /);
  const text = run(["scan", root]);
  assert.equal(text.code, 0, text.stderr);
  assert.match(text.stdout, /^UNDECODED : data\.xp3: /m);
  assert.doesNotMatch(text.stdout, /^WARNING/m);
});

test("cli: scan names rejected scripts on a Ren'Py game", () => {
  const root = brokenRenpyGame();
  const result = run(["scan", root]);
  assert.equal(result.code, 1, result.stderr);
  assert.match(result.stdout, /^engine +: renpy$/m);
  assert.match(result.stdout, /^UNDECODED : game\/broken\.rpyc: /m);
  assert.match(result.stdout, /^WARNING   : nothing readable - 1 scripts rejected$/m);
  const payload = envelope(run(["scan", root, "--json"]));
  assert.equal(payload.ok, false);
  assert.equal(payload.outcome, "findings");
  assert.equal(payload.engine, "renpy");
  assert.equal(payload.uniqueStrings, 0);
  assert.equal(payload.undecodable.length, 1);
});
