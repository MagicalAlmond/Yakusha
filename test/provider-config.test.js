/**
 * Provider configuration requirements.
 *
 * 0.10 removed the built-in model and the implicit OpenAI endpoint choice. A
 * real run must be pointed at a provider, a model and a key explicitly; a
 * missing setup has to fail locally, before any request is sent. The offline
 * modes (mock, --dry-run, --glossary-only) keep working with an empty
 * environment so the pipeline can still be exercised offline.
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
// A missing provider/model must be a property of the fixture, not of the
// developer's real %APPDATA%\yakusha\config.json.
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-provider-config-"));

/** @returns {string} a private copy of the fixture, safe to mutate */
function tempGame() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-provider-"));
  const game = path.join(dir, "game");
  fs.cpSync(FIXTURE, game, { recursive: true });
  return game;
}

/**
 * A child environment with every yakusha / provider variable removed, so a
 * developer machine with a real key cannot change what these tests see.
 *
 * @param {Record<string, string>} [extra]
 * @returns {Record<string, string|undefined>}
 */
function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^YAKUSHA_/i.test(key) || /^OPENAI_API_KEY$/i.test(key)) delete env[key];
  }
  return { ...env, YAKUSHA_CONFIG_DIR: CONFIG_DIR, ...extra };
}

/** @returns {{ code: number, stdout: string, stderr: string }} */
function run(args, extraEnv = {}) {
  const result = spawnSync(process.execPath, [BIN, ...args], {
    encoding: "utf8",
    env: cleanEnv(extraEnv),
    timeout: 20000,
  });
  return { code: result.status === null ? 1 : result.status, stdout: result.stdout || "", stderr: result.stderr || "" };
}

/** @returns {any} the single JSON envelope on stdout */
function envelope(result) {
  return JSON.parse(result.stdout);
}

/** @returns {string} a game directory that already has a dictionary */
function gameWithDictionary() {
  const game = tempGame();
  const result = run(["extract", game, "--json"]);
  assert.equal(result.code, 0, result.stderr);
  return game;
}

test("translate: no provider is E_CONFIG before any request", () => {
  const game = gameWithDictionary();
  const result = run(["translate", game, "--json"]);
  assert.equal(result.code, 2, result.stderr);
  const body = envelope(result);
  assert.equal(body.command, "translate");
  assert.equal(body.ok, false);
  assert.equal(body.outcome, "error");
  assert.equal(body.error.code, "E_CONFIG");
  assert.match(body.error.message, /provider/);
});

test("translate: a real provider needs an explicit model", () => {
  const game = gameWithDictionary();
  const result = run(["translate", game, "--provider", "openai", "--json"]);
  assert.equal(result.code, 2, result.stderr);
  assert.equal(envelope(result).error.code, "E_CONFIG");
  assert.match(envelope(result).error.message, /model/);
});

test("translate: a real provider needs an API key", () => {
  const game = gameWithDictionary();
  const result = run(["translate", game, "--provider", "openai", "--model", "some-model", "--json"]);
  assert.equal(result.code, 2, result.stderr);
  assert.equal(envelope(result).error.code, "E_CONFIG");
  assert.match(envelope(result).error.message, /API key/);
});

test("translate: provider compatible needs a base URL", () => {
  const game = gameWithDictionary();
  const result = run([
    "translate", game,
    "--provider", "compatible",
    "--model", "some-model",
    "--api-key", "test-key",
    "--json",
  ]);
  assert.equal(result.code, 2, result.stderr);
  const body = envelope(result);
  assert.equal(body.error.code, "E_CONFIG");
  assert.match(body.error.message, /base URL/);
});

test("translate: --provider mock needs no configuration", () => {
  const game = gameWithDictionary();
  const result = run(["translate", game, "--provider", "mock", "--json"]);
  assert.equal(result.code, 0, result.stderr);
  const body = envelope(result);
  assert.equal(body.outcome, "ok");
  assert.equal(body.provider, "mock");
});

test("translate: --dry-run needs no configuration and saves nothing", () => {
  const game = gameWithDictionary();
  const before = fs.readFileSync(path.join(game, "yakusha", "dictionary.json"), "utf8");
  const result = run(["translate", game, "--dry-run", "--json"]);
  assert.equal(result.code, 0, result.stderr);
  const body = envelope(result);
  assert.equal(body.dryRun, true);
  assert.equal(body.provider, "mock");
  assert.equal(fs.readFileSync(path.join(game, "yakusha", "dictionary.json"), "utf8"), before);
});

test("translate: --dry-run always uses mock and warns when --provider is ignored", () => {
  const game = gameWithDictionary();
  const result = run(["translate", game, "--dry-run", "--provider", "openai", "--json"]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(envelope(result).provider, "mock");
  assert.match(result.stderr, /dry-run always uses the mock provider/);
});

test("translate: environment variables alone do not pick a provider", () => {
  const game = gameWithDictionary();
  const result = run(["translate", game, "--json"], {
    YAKUSHA_MODEL: "some-model",
    YAKUSHA_API_KEY: "test-key",
  });
  assert.equal(result.code, 2, result.stderr);
  assert.equal(envelope(result).error.code, "E_CONFIG");
  assert.match(envelope(result).error.message, /provider/);
});

test("translate: an unknown provider is E_PROVIDER, not E_CONFIG", () => {
  const game = gameWithDictionary();
  const result = run([
    "translate", game,
    "--provider", "nope",
    "--model", "some-model",
    "--api-key", "test-key",
    "--json",
  ]);
  assert.equal(result.code, 2, result.stderr);
  assert.equal(envelope(result).error.code, "E_PROVIDER");
});
