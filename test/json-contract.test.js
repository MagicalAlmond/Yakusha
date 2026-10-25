/**
 * The JSON contract (docs/json-contract.md), exercised through the real binary.
 *
 * These tests are deliberately about the envelope and the exit code, not about
 * what a command found: every command must print exactly one object, flatten
 * its payload into it, and fail with a documented code instead of a stack.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { sanitizeMessage } from "../src/cli/envelope.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, "..", "bin", "yakusha.js");
const FIXTURE = path.join(HERE, "fixtures", "mini-mz");

/** @returns {string} a private copy of the fixture, safe to mutate */
function tempGame() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-json-"));
  const game = path.join(dir, "game");
  fs.cpSync(FIXTURE, game, { recursive: true });
  return game;
}

/** @returns {Record<string, string|undefined>} */
function cleanEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^YAKUSHA_/i.test(key) || /^OPENAI_API_KEY$/i.test(key)) delete env[key];
  }
  return env;
}

/** @returns {{ code: number, stdout: string, stderr: string }} */
function run(args, options = {}) {
  const result = spawnSync(process.execPath, [BIN, ...args], {
    encoding: "utf8",
    env: cleanEnv(),
    timeout: options.timeout || 60000,
  });
  return { code: result.status, stdout: result.stdout || "", stderr: result.stderr || "" };
}

/**
 * Parse the single JSON object a --json run must print.
 *
 * @param {{ code: number, stdout: string }} result
 * @returns {Record<string, any>}
 */
function envelope(result) {
  assert.equal(result.stdout.endsWith("\n"), true, "stdout must end with a newline");
  const lines = result.stdout.trimEnd().split("\n");
  assert.equal(lines.length, 1, "stdout must hold exactly one line, got: " + result.stdout.slice(0, 400));
  return JSON.parse(lines[0]);
}

/** The six reserved keys, in contract order, at the front of the object. */
function assertShape(body, expected) {
  assert.deepEqual(Object.keys(body).slice(0, 5), ["schema", "command", "ok", "outcome", "error"], JSON.stringify(body));
  assert.equal(body.schema, 1);
  assert.equal(body.command, expected.command);
  assert.equal(typeof body.ok, "boolean");
  assert.equal(["ok", "findings", "error"].includes(body.outcome), true);
  assert.equal(body.ok, body.outcome === "ok", "ok must equal (outcome === 'ok')");
  if (expected.outcome) assert.equal(body.outcome, expected.outcome);
  if (body.outcome === "error") {
    assert.equal(typeof body.error, "object");
    assert.equal(typeof body.error.code, "string");
    assert.match(body.error.code, /^E_[A-Z_]+$/);
    assert.equal(typeof body.error.message, "string");
  } else {
    assert.equal(body.error, null);
  }
  assert.equal(Object.hasOwn(body, "data"), false, "the payload must stay flat (no data wrapper)");
}

/** A dictionary ready to translate: every extracted key, all empty. */
function withDictionary(game) {
  assert.equal(run(["extract", game]).code, 0);
  return path.join(game, "yakusha", "dictionary.json");
}

function readJsonFile(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJsonFile(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
}

test("json: scan prints one flat envelope and exits 0", () => {
  const game = tempGame();
  const result = run(["scan", game, "--json"]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, "");
  const body = envelope(result);
  assertShape(body, { command: "scan", outcome: "ok" });
  assert.equal(typeof body.root, "string");
  assert.equal(body.engine, "mz");
  // The field was renamed from "version" so no payload key collides with the
  // envelope's schema version; both spellings must not appear together.
  assert.equal(body.engineVersion, "1.7.0");
  assert.equal(Object.hasOwn(body, "version"), false);
  assert.equal(body.uniqueStrings, 32);
});

test("json: every command keeps its payload flat", () => {
  const game = tempGame();
  withDictionary(game);
  assert.equal(run(["install", game]).code, 0);
  const cases = [
    ["scan"],
    ["extract"],
    ["status"],
    ["translate", "--dry-run"],
    ["verify"],
    ["speaker"],
    ["terms"],
    ["install"],
    ["uninstall"],
    ["doctor"],
  ];
  const EXPECTED_CODE = { ok: 0, findings: 1, error: 2 };
  for (const [name, ...extra] of cases) {
    const result = run([name, game, ...extra, "--json"]);
    const body = envelope(result);
    assertShape(body, { command: name });
    assert.equal(Object.keys(body).length > 6, true, name + " should have a payload");
    assert.equal(result.code, EXPECTED_CODE[body.outcome], name + " exit code disagrees with its outcome");
    if (body.outcome === "error") assert.fail(name + " failed: " + JSON.stringify(body.error));
    // report is a path to a file that only exists when --write-report was given.
    if (name === "verify") assert.equal(Object.hasOwn(body, "report"), false);
    if (name === "translate") {
      assert.equal(body.provider, "mock");
      assert.equal(body.dryRun, true);
    }
  }
});

test("json: verify --write-report adds the report path to the payload", () => {
  const game = tempGame();
  withDictionary(game);
  const report = path.join(game, "report.md");
  const result = run(["verify", game, "--write-report", report, "--json"]);
  assert.equal(result.code, 0);
  const body = envelope(result);
  assertShape(body, { command: "verify", outcome: "ok" });
  assert.equal(body.report, path.resolve(report));
  assert.equal(fs.existsSync(report), true);
});

test("json: verify with an error is findings and exit code 1", () => {
  const game = tempGame();
  const file = withDictionary(game);
  const dict = readJsonFile(file);
  dict.entries["ポーション"].text = "药水";
  const echoed = Object.keys(dict.entries).find((key) => key !== "ポーション" && /[\u3041-\u3096\u30a1-\u30fa]/.test(key));
  dict.entries[echoed].text = echoed;
  writeJsonFile(file, dict);

  const result = run(["verify", game, "--json"]);
  assert.equal(result.code, 1);
  const body = envelope(result);
  assertShape(body, { command: "verify", outcome: "findings" });
  assert.equal(body.errors, 1);
  assert.equal(body.counts.echo, 1);
});

test("json: verify with only warnings is ok and exits 0", () => {
  const game = tempGame();
  const file = withDictionary(game);
  const dict = readJsonFile(file);
  dict.entries["ポーション"].text = "药水";
  dict.entries["はい"].text = "是ッ";
  writeJsonFile(file, dict);

  const result = run(["verify", game, "--json"]);
  assert.equal(result.code, 0);
  const body = envelope(result);
  assertShape(body, { command: "verify", outcome: "ok" });
  assert.equal(body.errors, 0);
  assert.equal(body.warnings >= 1, true);
});

test("json: doctor with a broken game is findings and exit code 1", () => {
  const game = tempGame();
  const result = run(["doctor", game, "--json"]);
  assert.equal(result.code, 1);
  const body = envelope(result);
  assertShape(body, { command: "doctor", outcome: "findings" });
  assert.equal(body.verdict, "broken");
  assert.equal(body.game.engine, "mz");
  assert.equal(body.game.engineVersion, "1.7.0");
  assert.equal(Object.hasOwn(body.game, "version"), false);
});

test("json: a missing dictionary is E_NO_DICTIONARY, exit 2", () => {
  const game = tempGame();
  const result = run(["status", game, "--json"]);
  assert.equal(result.code, 2);
  const body = envelope(result);
  assertShape(body, { command: "status", outcome: "error" });
  assert.equal(body.error.code, "E_NO_DICTIONARY");
  assert.match(body.error.message, /no dictionary yet/);
});

test("json: a directory that is not a game is E_NOT_PROJECT", () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-json-empty-"));
  const result = run(["scan", empty, "--json"]);
  assert.equal(result.code, 2);
  const body = envelope(result);
  assert.equal(body.error.code, "E_NOT_PROJECT");
  assert.match(body.error.message, /not an RPG Maker project/);
});

test("json: two projects under one folder is E_MULTI_ROOT", () => {
  const outer = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-json-many-"));
  fs.cpSync(FIXTURE, path.join(outer, "a"), { recursive: true });
  fs.cpSync(FIXTURE, path.join(outer, "b"), { recursive: true });
  const result = run(["scan", outer, "--json"]);
  assert.equal(result.code, 2);
  const body = envelope(result);
  assert.equal(body.error.code, "E_MULTI_ROOT");
  assert.match(body.error.message, /found 2 RPG Maker projects/);
});

test("json: an unknown command echoes the token and exits 2", () => {
  const result = run(["nope", tempGame(), "--json"]);
  assert.equal(result.code, 2);
  const body = envelope(result);
  assertShape(body, { command: "nope", outcome: "error" });
  assert.equal(body.error.code, "E_USAGE");
  assert.match(body.error.message, /unknown command: nope/);
  // The usage dump belongs to --help, not to the error object.
  assert.equal(body.error.message.includes("global options"), false);
});

test("json: unknown, misplaced and incomplete options are E_USAGE", () => {
  const game = tempGame();
  for (const args of [
    ["scan", game, "--bogus", "--json"],
    ["scan", game, "--provider", "mock", "--json"],
    ["scan", game, "--limit", "--json"],
    ["scan", game, "extra", "--json"],
  ]) {
    const result = run(args);
    assert.equal(result.code, 2, args.join(" "));
    const body = envelope(result);
    assertShape(body, { command: "scan", outcome: "error" });
    assert.equal(body.error.code, "E_USAGE", args.join(" ") + ": " + JSON.stringify(body.error));
  }
});

test("json: a boolean flag rejects --flag=value", () => {
  const result = run(["scan", tempGame(), "--json=true"]);
  assert.equal(result.code, 2);
  // --json was not parsed as a mode, so this is the text error path.
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /does not take a value/);
});

test("json: no command is a usage error in both modes", () => {
  const json = run(["--json"]);
  assert.equal(json.code, 2);
  const body = envelope(json);
  assertShape(body, { command: null, outcome: "error" });
  assert.equal(body.error.code, "E_USAGE");
  assert.equal(body.error.message, "no command");

  const text = run([]);
  assert.equal(text.code, 2);
  assert.equal(text.stdout, "");
  assert.match(text.stderr, /yakusha <command> <game-dir>/);
});

test("json: --help is text on stdout even with --json", () => {
  const result = run(["--help", "--json"]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /^yakusha <command> <game-dir>/);
  assert.throws(() => JSON.parse(result.stdout));

  const short = run(["-h"]);
  assert.equal(short.code, 0);
  assert.match(short.stdout, /^yakusha <command> <game-dir>/);
});

test("json: error messages stay one safe line and never carry a stack", () => {
  const game = tempGame();
  const file = withDictionary(game);
  fs.writeFileSync(file, "{ this is not json", "utf8");

  const result = run(["status", game, "--json"]);
  assert.equal(result.code, 2);
  const body = envelope(result);
  assert.equal(body.error.code, "E_DICTIONARY");
  assert.equal(body.error.message.includes("\n"), false);
  assert.equal(body.error.message.includes("\r"), false);
  assert.equal(body.error.message.length <= 500, true);
  assert.equal(/\n\s+at /.test(body.error.message), false, "a stack must not leak into the payload");
});

test("json: a report that cannot be written is E_IO, not findings", () => {
  const game = tempGame();
  withDictionary(game);
  const blocker = path.join(game, "blocker");
  fs.writeFileSync(blocker, "not a directory", "utf8");
  const result = run(["verify", game, "--write-report", path.join(blocker, "report.md"), "--json"]);
  assert.equal(result.code, 2);
  const body = envelope(result);
  assertShape(body, { command: "verify", outcome: "error" });
  assert.equal(body.error.code, "E_IO");
});

test("json: sanitizeMessage folds, masks and truncates", () => {
  const home = os.homedir();
  const password = "not-a-real-token";
  const raw =
    "\u001b[31mbad\u001b[0m\nsecond line\t" +
    " key sk-abcdefgh12345678" +
    " Authorization: Bearer abc.def.ghi" +
    " on https://user:" + password + "@example.test/v1" +
    " under " +
    home;
  const text = sanitizeMessage(raw);
  assert.equal(/[\u0000-\u001f]/.test(text), false);
  assert.equal(text.includes("\n"), false);
  assert.equal(text.includes("sk-abcdefgh12345678"), false);
  assert.match(text, /sk-\*\*\*/);
  assert.equal(text.includes("abc.def.ghi"), false);
  assert.match(text, /Bearer \*\*\*/);
  assert.equal(text.includes(password), false);
  assert.match(text, /https:\/\/\*\*\*@example\.test/);
  assert.equal(text.includes(home), false);
  assert.equal(text.length <= 500, true);
  assert.equal(sanitizeMessage("x".repeat(900)).length, 500);
});
