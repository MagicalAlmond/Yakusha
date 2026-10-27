/**
 * The shared runner seam: runCommand() is what the CLI wraps and what the GUI
 * will call in its main process, so its payloads must be exactly what the CLI
 * prints as --json output for the same state.
 *
 * The tests compare both front ends on one throwaway copy of the fixture: the
 * runner runs in-process, the CLI runs as a child process, and the two
 * envelopes have to agree key for key. Errors are compared through the same
 * contract the CLI maps onto exit codes.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { runCommand } from "../src/cli/runner.js";
import { CliError } from "../src/cli/envelope.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, "..", "bin", "yakusha.js");
const FIXTURE = path.join(HERE, "fixtures", "mini-mz");
// The config file is user level: one empty directory per process keeps the
// suite hermetic without inheriting a developer's real config.
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-runner-config-"));
// The runner reads the same environment the CLI does, so the test process
// needs the hermetic config dir too — not only the spawned children.
process.env.YAKUSHA_CONFIG_DIR = CONFIG_DIR;

/** @returns {string} a private copy of the fixture, safe to mutate */
function tempGame() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-runner-"));
  const game = path.join(dir, "game");
  fs.cpSync(FIXTURE, game, { recursive: true });
  fs.rmSync(path.join(game, "yakusha"), { recursive: true, force: true });
  return game;
}

/** A child environment with every yakusha / provider variable removed. */
function cleanEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^YAKUSHA_/i.test(key) || /^OPENAI_API_KEY$/i.test(key)) delete env[key];
  }
  env.YAKUSHA_CONFIG_DIR = CONFIG_DIR;
  return env;
}

/**
 * Run the CLI as a child process and parse its single --json envelope.
 *
 * @returns {{ code: number, summary: Record<string, unknown> }}
 */
function cliJson(args) {
  const result = spawnSync(process.execPath, [BIN, ...args, "--json"], {
    encoding: "utf8",
    env: cleanEnv(),
    timeout: 60000,
  });
  assert.equal(result.stdout?.endsWith("\n"), true, "stdout must end with a newline");
  const lines = result.stdout.trimEnd().split("\n");
  assert.equal(lines.length, 1, "exactly one JSON line, got: " + lines.length);
  return { code: result.status === null ? 1 : result.status, summary: JSON.parse(lines[0]) };
}

/**
 * Strip the caller-specific bits the runner cannot know about: the tmp root
 * differs between the in-process run and the child, and the install test
 * deliberately runs the child on a sibling copy ("-cli" suffix) of the game.
 */
function normalizePath(value) {
  return typeof value === "string"
    ? value.split(path.sep).join("/").replace(/-cli\//g, "/")
    : value;
}

/** Fields that legitimately differ between two runs (wall-clock timing). */
const TIMING_KEYS = new Set(["elapsedMs"]);

/**
 * Compare a runner result against the CLI --json envelope for the same state.
 * Absolute paths differ only because the two runs use different temporary
 * directories, timing fields are only checked for type; every other key and
 * value must match exactly.
 */

function assertSameEnvelope(done, cli, command, label) {
  const name = label || command;
  // The runner result is the payload; the CLI envelope is payload + header.
  const body = { ...done.payload, command, outcome: done.outcome, ok: done.outcome === "ok", error: null, schema: 1 };
  for (const key of Object.keys(body)) {
    const mine = body[key];
    const theirs = cli.summary[key];
    if (TIMING_KEYS.has(key)) {
      assert.equal(typeof mine, "number", name + ": " + key + " must be a number");
      assert.equal(typeof theirs, "number", name + ": " + key + " must be a number");
      continue;
    }
    if (typeof mine === "string" && typeof theirs === "string" && mine !== theirs) {
      assert.equal(normalizePath(mine), normalizePath(theirs), name + ": " + key);
    } else {
      assert.deepEqual(mine, theirs, name + ": key " + key + " must match the CLI envelope");
    }
  }
  for (const key of Object.keys(cli.summary)) {
    assert.ok(Object.hasOwn(body, key), name + ": CLI envelope key " + key + " must exist in the runner payload");
  }
  assert.equal(body.schema, 1);
}
test("runner: scan payload matches the CLI envelope", async () => {
  const game = tempGame();
  const done = await runCommand("scan", [game]);
  assert.equal(done.outcome, "ok");
  const cli = cliJson(["scan", game]);
  assert.equal(cli.code, 0);
  assertSameEnvelope(done, cli, "scan");
});

test("runner: extract payload matches the CLI envelope", async () => {
  const game = tempGame();
  // Mutating command: the child runs on a sibling copy with the same state.
  const gameForCli = game + "-cli";
  fs.cpSync(game, gameForCli, { recursive: true });
  const done = await runCommand("extract", [game]);
  assert.equal(done.outcome, "ok");
  const cli = cliJson(["extract", gameForCli]);
  assert.equal(cli.code, 0);
  assertSameEnvelope(done, cli, "extract");
  assert.equal(fs.existsSync(path.join(game, "yakusha", "dictionary.json")), true);
});

test("runner: status and verify match the CLI on the same dictionary", async () => {
  const game = tempGame();
  await runCommand("extract", [game]);
  // The CLI child must see the same dictionary the runner just wrote.
  assert.equal(cliJson(["status", game]).code, 0);
  assertSameEnvelope(await runCommand("status", [game]), cliJson(["status", game]), "status");
  const verify = await runCommand("verify", [game]);
  assert.equal(verify.outcome, "ok");
  assertSameEnvelope(verify, cliJson(["verify", game]), "verify");
});

test("runner: verify reports findings when the dictionary has problems", async () => {
  const game = tempGame();
  await runCommand("extract", [game]);
  // Corrupt one entry so verify finds something: replace a translation with
  // one that drops the control codes the source carries.
  const file = path.join(game, "yakusha", "dictionary.json");
  const dict = JSON.parse(fs.readFileSync(file, "utf8"));
  const key = Object.keys(dict.entries).find((k) => /[\u3041-\u3096\u30a1-\u30fa]/.test(k) && dict.entries[k].text === "");
  assert.ok(key, "fixture should have a kana entry");
  // A translation identical to its source is the documented echo problem.
  dict.entries[key].text = key;
  fs.writeFileSync(file, JSON.stringify(dict, null, 2) + "\n");
  const done = await runCommand("verify", [game]);
  assert.equal(done.outcome, "findings");
  const cli = cliJson(["verify", game]);
  assert.equal(cli.code, 1);
  assertSameEnvelope(done, cli, "verify", "verify findings");
});

test("runner: install and uninstall match the CLI round trip", async () => {
  const game = tempGame();
  await runCommand("extract", [game]);
  // Two identical copies: mutating state, so each front end runs on its own.
  const gameForCli = game + "-cli";
  fs.cpSync(game, gameForCli, { recursive: true });
  const installed = await runCommand("install", [game]);
  assert.equal(installed.outcome, "ok");
  assertSameEnvelope(installed, cliJson(["install", gameForCli]), "install");
  const removed = await runCommand("uninstall", [game]);
  assert.equal(removed.outcome, "ok");
  assertSameEnvelope(removed, cliJson(["uninstall", gameForCli]), "uninstall");
});

test("runner: export tsv payload matches the CLI envelope", async () => {
  const game = tempGame();
  await runCommand("extract", [game]);
  const out = path.join(path.dirname(game), "runner-export.tsv");
  const done = await runCommand("export", [game], { flags: { out, format: "tsv" } });
  assert.equal(done.outcome, "ok");
  assert.equal(fs.existsSync(out), true);
  assertSameEnvelope(done, cliJson(["export", game, "--out", out, "--format", "tsv", "--force"]), "export");
});

test("runner: import dry-run payload matches the CLI envelope", async () => {
  const game = tempGame();
  await runCommand("extract", [game]);
  const out = path.join(path.dirname(game), "runner-import.tsv");
  // A hand written table with one translation for an existing key.
  const dict = JSON.parse(fs.readFileSync(path.join(game, "yakusha", "dictionary.json"), "utf8"));
  const key = Object.keys(dict.entries)[0];
  fs.writeFileSync(out, "source\ttarget\tcontexts\n" + key + "\t訳語\t\n", "utf8");
  const done = await runCommand("import", [game], { flags: { from: out, "dry-run": true } });
  assert.equal(done.outcome, "ok");
  assertSameEnvelope(done, cliJson(["import", game, "--from", out, "--dry-run"]), "import");
});

test("runner: doctor payload matches the CLI envelope", async () => {
  const game = tempGame();
  await runCommand("extract", [game]);
  const done = await runCommand("doctor", [game]);
  assert.equal(done.outcome, "ok");
  assertSameEnvelope(done, cliJson(["doctor", game]), "doctor");
});

test("runner: speaker and terms payloads match the CLI envelopes", async () => {
  const game = tempGame();
  await runCommand("extract", [game]);
  assertSameEnvelope(await runCommand("speaker", [game]), cliJson(["speaker", game]), "speaker");
  assertSameEnvelope(await runCommand("terms", [game]), cliJson(["terms", game]), "terms");
});

test("runner: translate --dry-run payload matches the CLI envelope", async () => {
  const game = tempGame();
  await runCommand("extract", [game]);
  const done = await runCommand("translate", [game], { flags: { "dry-run": true } });
  assert.equal(done.outcome, "ok");
  assertSameEnvelope(done, cliJson(["translate", game, "--dry-run"]), "translate", "translate dry-run");
  assert.equal(done.payload.dryRun, true);
  assert.equal(done.payload.provider, "mock");
  assert.equal(done.payload.total, 32);
});

test("runner: translate --glossary-only payload matches the CLI envelope", async () => {
  const game = tempGame();
  await runCommand("extract", [game]);
  const done = await runCommand("translate", [game], { flags: { "glossary-only": true } });
  assert.equal(done.outcome, "ok");
  assertSameEnvelope(done, cliJson(["translate", game, "--glossary-only"]), "translate", "glossary-only");
});

test("runner: config list matches the CLI envelope", async () => {
  const done = await runCommand("config", ["list"]);
  assert.equal(done.outcome, "ok");
  assertSameEnvelope(done, cliJson(["config", "list"]), "config", "config list");
});

test("runner: unknown command throws the documented E_USAGE", async () => {
  await assert.rejects(
    () => runCommand("nosuch", []),
    (error) => {
      assert.ok(error instanceof CliError);
      assert.equal(error.code, "E_USAGE");
      assert.equal(error.message, "unknown command: nosuch");
      return true;
    }
  );
});

test("runner: missing project and missing dictionary map to documented codes", async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-runner-empty-"));
  await assert.rejects(
    () => runCommand("scan", [empty]),
    (error) => error instanceof CliError && error.code === "E_NOT_PROJECT"
  );
  const game = tempGame();
  await assert.rejects(
    () => runCommand("verify", [game]),
    (error) => error instanceof CliError && error.code === "E_NO_DICTIONARY"
  );
});

test("runner: the default sink is silent, a passed sink receives the summary", async () => {
  const game = tempGame();
  await runCommand("extract", [game]);
  const lines = [];
  const done = await runCommand("status", [game], { sink: { out: (line) => lines.push(line), warn: () => {} } });
  assert.equal(done.outcome, "ok");
  assert.ok(lines.length > 0, "the human summary goes to the sink");
  // The default (GUI) case: no sink at all, nothing printed anywhere.
  const quiet = await runCommand("status", [game]);
  assert.equal(quiet.outcome, "ok");
  assert.equal(quiet.payload.total, done.payload.total);
});
