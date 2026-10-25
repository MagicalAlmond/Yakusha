/**
 * User level configuration (docs/config.md), through the real binary.
 *
 * The file belongs to the user, so every test gets its own YAKUSHA_CONFIG_DIR:
 * a suite that inherited %APPDATA% would read and sometimes overwrite real
 * settings. Secret fixtures are concatenated so a repository scan never sees a
 * complete token.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { resolveEffective } from "../src/cli/config.js";

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

/**
 * @param {string[]} args
 * @param {{env?: Record<string, string>, remove?: string[]}} [options]
 * @returns {{code: number, stdout: string, stderr: string}}
 */
function run(args, options = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^YAKUSHA_/i.test(key) || /^OPENAI_API_KEY$/i.test(key)) delete env[key];
  }
  for (const key of options.remove || []) delete env[key];
  Object.assign(env, options.env || {});
  const result = spawnSync(process.execPath, [BIN, ...args], {
    encoding: "utf8",
    env,
    timeout: 60000,
  });
  return {
    code: result.status === null ? 1 : result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

/** @returns {any} */
function json(result) {
  const lines = result.stdout.trimEnd().split("\n");
  assert.equal(lines.length, 1, "expected one JSON object, got: " + result.stdout.slice(0, 400));
  return JSON.parse(lines[0]);
}

/** @returns {{dir: string, file: string}} */
function configDir() {
  const dir = tempDir("yakusha-config-");
  return { dir, file: path.join(dir, "config.json") };
}

/** @returns {string} a game copy with a dictionary */
function gameWithDictionary(configDirPath) {
  const game = path.join(tempDir("yakusha-config-game-"), "game");
  fs.cpSync(FIXTURE, game, { recursive: true });
  const result = run(["extract", game, "--json"], { env: { YAKUSHA_CONFIG_DIR: configDirPath } });
  assert.equal(result.code, 0, result.stderr);
  return game;
}

/** @param {string} file @param {unknown} value */
function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
}

test("config: list on a missing file reports defaults without creating it", () => {
  const { dir, file } = configDir();
  const result = run(["config", "list", "--json"], { env: { YAKUSHA_CONFIG_DIR: dir } });
  assert.equal(result.code, 0, result.stderr);
  const body = json(result);
  assert.equal(body.command, "config");
  assert.equal(body.action, "list");
  assert.equal(body.file, file);
  assert.equal(body.exists, false);
  assert.deepEqual(body.values.provider, { value: null, source: "none" });
  assert.deepEqual(body.values.model, { value: null, source: "none" });
  assert.deepEqual(body.values.baseUrl, { value: "https://api.openai.com/v1", source: "default" });
  assert.deepEqual(body.apiKey, { set: false, source: null });
  assert.equal(fs.existsSync(file), false);
});

test("config: set writes a schema first LF file with no key", () => {
  const { dir, file } = configDir();
  const result = run(["config", "set", "provider", "openai", "--json"], {
    env: { YAKUSHA_CONFIG_DIR: dir },
  });
  assert.equal(result.code, 0, result.stderr);
  const body = json(result);
  assert.equal(body.action, "set");
  assert.equal(body.key, "provider");
  assert.equal(body.value, "openai");
  assert.equal(body.file, file);
  assert.equal(body.changed, true);
  const text = fs.readFileSync(file, "utf8");
  assert.equal(text.includes("\r"), false);
  assert.equal(text.endsWith("\n"), true);
  assert.equal(text.split("\n")[1], '  "schema": 1,');
  assert.equal(text.includes("apiKey"), false);
  assert.equal(JSON.parse(text).provider, "openai");
});

test("config: get reports file, env and default sources", () => {
  const { dir } = configDir();
  const env = { YAKUSHA_CONFIG_DIR: dir };
  let result = run(["config", "get", "baseUrl", "--json"], { env });
  assert.equal(json(result).value, "https://api.openai.com/v1");
  assert.equal(json(result).source, "default");
  result = run(["config", "get", "provider", "--json"], { env });
  assert.equal(json(result).value, null);
  assert.equal(json(result).source, "none");
  run(["config", "set", "model", "file-model", "--json"], { env });
  result = run(["config", "get", "model", "--json"], { env });
  assert.equal(json(result).value, "file-model");
  assert.equal(json(result).source, "file");
  result = run(["config", "get", "model", "--json"], { env: { ...env, YAKUSHA_MODEL: "env-model" } });
  assert.equal(json(result).value, "env-model");
  assert.equal(json(result).source, "env");
});

test("config: set is idempotent and unknown keys survive set and unset", () => {
  const { dir, file } = configDir();
  writeJson(file, { schema: 1, provider: "openai", custom: { keep: true } });
  const env = { YAKUSHA_CONFIG_DIR: dir };
  run(["config", "set", "model", "same-model", "--json"], { env });
  let result = run(["config", "set", "model", "same-model", "--json"], { env });
  assert.equal(json(result).changed, false);
  run(["config", "unset", "model", "--json"], { env });
  result = run(["config", "unset", "model", "--json"], { env });
  assert.equal(json(result).changed, false);
  const body = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.deepEqual(body.custom, { keep: true });
  assert.equal(body.provider, "openai");
  assert.equal(body.schema, 1);
  assert.equal(Object.hasOwn(body, "model"), false);
});

test("config: apiKey is refused and never written", () => {
  const { dir } = configDir();
  const secret = "sk-" + "file" + "secret123";
  const result = run(["config", "set", "apiKey", secret, "--json"], {
    env: { YAKUSHA_CONFIG_DIR: dir },
  });
  assert.equal(result.code, 2);
  assert.equal(json(result).error.code, "E_USAGE");
  assert.match(json(result).error.message, /not stored/);
  assert.equal(fs.existsSync(path.join(dir, "config.json")), false);
  assert.equal(fs.readdirSync(dir).length, 0);
  assert.equal(result.stdout.includes(secret), false);
  assert.equal(result.stderr.includes(secret), false);
});

test("config: invalid values are E_USAGE and never written", () => {
  const { dir, file } = configDir();
  const env = { YAKUSHA_CONFIG_DIR: dir };
  run(["config", "set", "provider", "openai", "--json"], { env });
  const before = fs.readFileSync(file, "utf8");
  const cases = [
    ["provider", "bogus"],
    ["model", ""],
    ["model", "x".repeat(201)],
    ["baseUrl", "relative/path"],
    ["baseUrl", "ftp://example.test/v1"],
    ["baseUrl", "https://example.test/v1?x=1"],
    ["baseUrl", "https://example.test/v1#x"],
    ["baseUrl", "https://user:" + "pass" + "@example.test/v1"],
  ];
  for (const [key, value] of cases) {
    const result = run(["config", "set", key, value, "--json"], { env });
    assert.equal(result.code, 2, key + "=" + value);
    assert.equal(json(result).error.code, "E_USAGE");
  }
  assert.equal(fs.readFileSync(file, "utf8"), before);
});

test("config: a broken file is E_CONFIG and is not overwritten", () => {
  const { dir, file } = configDir();
  const broken = "{ this is not json";
  fs.writeFileSync(file, broken, "utf8");
  const env = { YAKUSHA_CONFIG_DIR: dir };
  let result = run(["config", "list", "--json"], { env });
  assert.equal(result.code, 2);
  assert.equal(json(result).error.code, "E_CONFIG");
  result = run(["config", "set", "provider", "openai", "--json"], { env });
  assert.equal(result.code, 2);
  assert.equal(json(result).error.code, "E_CONFIG");
  assert.equal(fs.readFileSync(file, "utf8"), broken);
});

test("config: an unsupported schema is E_CONFIG", () => {
  const { dir, file } = configDir();
  fs.writeFileSync(file, JSON.stringify({ schema: 2, provider: "openai" }) + "\n", "utf8");
  const result = run(["config", "list", "--json"], { env: { YAKUSHA_CONFIG_DIR: dir } });
  assert.equal(result.code, 2);
  assert.equal(json(result).error.code, "E_CONFIG");
  assert.match(json(result).error.message, /schema/);
});

test("config: translate warns on a broken file while --dry-run does not read it", () => {
  const { dir, file } = configDir();
  fs.writeFileSync(file, "{ broken", "utf8");
  const game = gameWithDictionary(dir);
  let result = run(["translate", game, "--provider", "mock", "--json"], {
    env: { YAKUSHA_CONFIG_DIR: dir },
  });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(json(result).provider, "mock");
  assert.match(result.stderr, /warning: .*not valid JSON/);
  result = run(["translate", game, "--dry-run", "--json"], { env: { YAKUSHA_CONFIG_DIR: dir } });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr.includes("not valid JSON"), false);
});

test("config: a non default baseUrl warns on stderr without dirtying stdout", () => {
  const { dir } = configDir();
  const env = { YAKUSHA_CONFIG_DIR: dir };
  run(["config", "set", "baseUrl", "https://api.example.test/v1", "--json"], { env });
  let result = run(["config", "list", "--json"], { env });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stderr, /warning: requests will be sent to https:\/\/api\.example\.test\/v1/);
  assert.equal(result.stdout.includes("warning"), false);
  json(result);
  result = run(["config", "list"], { env });
  assert.match(result.stdout, /https:\/\/api\.example\.test\/v1/);
  assert.match(result.stderr, /warning: requests will be sent/);
});

test("config: YAKUSHA_CONFIG_DIR must be absolute and APPDATA is required otherwise", () => {
  let result = run(["config", "list", "--json"], { env: { YAKUSHA_CONFIG_DIR: "relative-config" } });
  assert.equal(result.code, 2);
  assert.equal(json(result).error.code, "E_CONFIG");
  assert.match(json(result).error.message, /absolute/);
  result = run(["config", "list", "--json"], { remove: ["APPDATA", "YAKUSHA_CONFIG_DIR"] });
  assert.equal(result.code, 2);
  assert.equal(json(result).error.code, "E_CONFIG");
  assert.match(json(result).error.message, /APPDATA/);
});

test("config: takes no game directory and rejects extra positionals", () => {
  const { dir } = configDir();
  const env = { YAKUSHA_CONFIG_DIR: dir };
  let result = run(["config", "--json"], { env });
  assert.equal(result.code, 2);
  assert.equal(json(result).error.code, "E_USAGE");
  assert.match(json(result).error.message, /subcommand/);
  result = run(["config", "nope", "--json"], { env });
  assert.equal(result.code, 2);
  assert.match(json(result).error.message, /unknown config action/);
  result = run(["config", "list", "game-dir", "--json"], { env });
  assert.equal(result.code, 2);
  assert.equal(json(result).error.code, "E_USAGE");
  assert.match(json(result).error.message, /unexpected argument/);
});

test("config: list never echoes a key from env or a sensitive file key", () => {
  const { dir } = configDir();
  const secret = "sk-" + "env" + "secret123";
  let result = run(["config", "list", "--json"], {
    env: { YAKUSHA_CONFIG_DIR: dir, YAKUSHA_API_KEY: secret },
  });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(json(result).apiKey, { set: true, source: "YAKUSHA_API_KEY" });
  assert.equal(result.stdout.includes(secret), false);
  assert.equal(result.stderr.includes(secret), false);

  const file = path.join(dir, "config.json");
  writeJson(file, {
    schema: 1,
    provider: "openai",
    apiKey: secret,
    token: "token-value",
    key: "key-value",
    authorization: "Bearer value",
  });
  result = run(["config", "list", "--json"], { env: { YAKUSHA_CONFIG_DIR: dir } });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(json(result).values.provider.value, "openai");
  assert.equal(result.stdout.includes(secret), false);
  assert.equal(result.stderr.includes(secret), false);
  assert.match(result.stderr, /sensitive key/);
});

test("config: provider compatible has no default base URL", () => {
  const { dir } = configDir();
  const env = { YAKUSHA_CONFIG_DIR: dir };
  run(["config", "set", "provider", "compatible", "--json"], { env });
  const body = json(run(["config", "list", "--json"], { env }));
  assert.deepEqual(body.values.baseUrl, { value: null, source: "none" });
});

test("config: precedence is flag over env over file over default", () => {
  const loaded = {
    config: {
      provider: "file-provider",
      model: "file-model",
      baseUrl: "https://file.example.test/v1",
    },
  };
  const env = {
    YAKUSHA_MODEL: "env-model",
    YAKUSHA_BASE_URL: "https://env.example.test/v1",
    YAKUSHA_API_KEY: "sk-" + "env" + "secret123",
  };
  const flags = {
    provider: "flag-provider",
    model: "flag-model",
    "base-url": "https://flag.example.test/v1",
    "api-key": "sk-" + "flag" + "secret123",
  };
  let effective = resolveEffective(loaded, { flags, env });
  assert.deepEqual(effective.provider, { value: "flag-provider", source: "flag" });
  assert.deepEqual(effective.model, { value: "flag-model", source: "flag" });
  assert.deepEqual(effective.baseUrl, { value: "https://flag.example.test/v1", source: "flag" });
  assert.deepEqual(effective.apiKey, { set: true, source: "--api-key" });

  effective = resolveEffective(loaded, { flags: {}, env });
  assert.deepEqual(effective.provider, { value: "file-provider", source: "file" });
  assert.deepEqual(effective.model, { value: "env-model", source: "env" });
  assert.deepEqual(effective.baseUrl, { value: "https://env.example.test/v1", source: "env" });
  assert.deepEqual(effective.apiKey, { set: true, source: "YAKUSHA_API_KEY" });

  effective = resolveEffective({ config: {} }, { flags: {}, env: {} });
  assert.deepEqual(effective.provider, { value: null, source: "none" });
  assert.deepEqual(effective.model, { value: null, source: "none" });
  assert.deepEqual(effective.baseUrl, { value: "https://api.openai.com/v1", source: "default" });
  assert.deepEqual(effective.apiKey, { set: false, source: null });
});
