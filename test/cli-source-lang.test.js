/**
 * --source-lang 的端到端测试。
 *
 * 夹具是纯合成的 RGSS 工程（全部由 test/rgss-fixture.js 生成，源文为英文），
 * 每个场景都用真实子进程跑 bin/yakusha.js，检查 JSON envelope、判据与退出码。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { writeRgssProject } from "./rgss-fixture.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, "..", "bin", "yakusha.js");
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-source-lang-config-"));

function tempGame() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-source-lang-"));
  const game = path.join(root, "game");
  writeRgssProject(game);
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

function json(args) {
  const result = run(args);
  return { ...result, payload: JSON.parse(result.stdout) };
}

function extractedGame() {
  const game = tempGame();
  const result = json(["extract", game, "--json"]);
  assert.equal(result.code, 0);
  return { game, file: result.payload.file };
}

function readDictionary(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeDictionary(file, dictionary) {
  fs.writeFileSync(file, JSON.stringify(dictionary, null, 2) + "\n");
}

function fill(dictionary, valueOf) {
  for (const key of Object.keys(dictionary.entries)) dictionary.entries[key].text = valueOf(key);
  return dictionary;
}

test("translate --dry-run 接受 --source-lang en", () => {
  const { game } = extractedGame();
  const result = json(["translate", game, "--dry-run", "--source-lang", "en", "--json"]);

  assert.equal(result.code, 0);
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.outcome, "ok");
  assert.equal(result.payload.dryRun, true);
  assert.equal(result.payload.provider, "mock");
  assert.equal(result.payload.translated, 29);
});

test("verify --source-lang en 把未译英文报成 source，重复原文报成 echo", () => {
  const { game, file } = extractedGame();
  writeDictionary(file, fill(readDictionary(file), (key) => key));

  const result = json(["verify", game, "--source-lang", "en", "--json"]);

  assert.equal(result.code, 1);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.outcome, "findings");
  assert.equal(result.payload.errors > 0, true);
  assert.equal(result.payload.warnings > 0, true);
  assert.equal(result.payload.counts.source, 24);
  assert.equal(result.payload.counts.echo, 24);

  const source = result.payload.problems.find((problem) => problem.kind === "source");
  assert.equal(source.severity, "warn");
  assert.equal(source.detail, "English text left in the translation");
  const echo = result.payload.problems.find((problem) => problem.kind === "echo");
  assert.equal(echo.severity, "error");
  assert.equal(echo.detail, "target is identical to an English source");
});

test("verify 默认源语言仍是 ja：同一份英文重复字典不报 source", () => {
  const { game, file } = extractedGame();
  writeDictionary(file, fill(readDictionary(file), (key) => key));

  const implicit = json(["verify", game, "--json"]);
  const explicit = json(["verify", game, "--source-lang", "ja", "--json"]);

  assert.equal(implicit.code, 0);
  assert.equal(implicit.payload.ok, true);
  assert.equal(implicit.payload.outcome, "ok");
  assert.deepEqual(implicit.payload.counts, {});
  assert.deepEqual(implicit.payload.problems, []);
  assert.deepEqual(explicit.payload, implicit.payload);
});

test("--source-lang en 的残留是 warning：默认阈值放行，--fail-on warning 拦下", () => {
  const { game, file } = extractedGame();
  writeDictionary(file, fill(readDictionary(file), (key) => "T " + key));

  const relaxed = json(["verify", game, "--source-lang", "en", "--json"]);
  assert.equal(relaxed.code, 0);
  assert.equal(relaxed.payload.outcome, "ok");
  assert.equal(relaxed.payload.errors, 0);
  assert.equal(relaxed.payload.warnings, 24);
  assert.equal(relaxed.payload.counts.source, 24);
  assert.equal(relaxed.payload.problems.every((problem) => problem.kind === "source" && problem.severity === "warn"), true);

  const strict = json(["verify", game, "--source-lang", "en", "--fail-on", "warning", "--json"]);
  assert.equal(strict.code, 1);
  assert.equal(strict.payload.outcome, "findings");
  assert.equal(strict.payload.errors, 0);
});

test("非法 --source-lang 是用法错误：E_USAGE 且退出 2", () => {
  const { game } = extractedGame();
  const result = json(["verify", game, "--source-lang", "fr", "--json"]);

  assert.equal(result.code, 2);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.outcome, "error");
  assert.equal(result.payload.error.code, "E_USAGE");
  assert.equal(result.payload.error.message, "--source-lang must be one of: ja, en, not fr");
});

test("speaker 也接受 --source-lang", () => {
  const { game } = extractedGame();
  const result = json(["speaker", game, "--source-lang", "en", "--json"]);

  assert.equal(result.code, 0);
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.outcome, "ok");
});
