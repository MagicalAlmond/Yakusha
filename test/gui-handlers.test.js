/**
 * The GUI handler seam: runGuiCommand() resolves to the exact envelope the
 * CLI prints with --json, so the renderer can branch on outcome + error.code
 * and stay byte-compatible with the command line. Compared here against the
 * child-process CLI on identical state (same method as runner.test.js).
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { GUI_COMMANDS, launchInvocation, runGuiCommand } from "../gui/handlers.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, "..", "bin", "yakusha.js");
const FIXTURE = path.join(HERE, "fixtures", "mini-mz");
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-gui-config-"));
process.env.YAKUSHA_CONFIG_DIR = CONFIG_DIR;

/** @returns {string} a private copy of the fixture, safe to mutate */
function tempGame() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-gui-"));
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
 * A private copy of the fixture whose dictionary holds N pending entries,
 * so translate has a deterministic job without touching a provider.
 * @returns {string} the game root
 */
function tempDictGame(entries) {
  const game = tempGame();
  const dict = { format: "yakusha/1", source: "test", entries: {} };
  for (let i = 0; i < entries; i++) {
    dict.entries["key" + String(i).padStart(3, "0")] = { text: "", contexts: [] };
  }
  fs.mkdirSync(path.join(game, "yakusha"), { recursive: true });
  fs.writeFileSync(path.join(game, "yakusha", "dictionary.json"), JSON.stringify(dict, null, 2) + "\n");
  return game;
}

/**
 * Run the CLI as a child process and parse its single --json envelope.
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

/** Normalize the tmp root so the two runs can be compared. */
function normalizePath(value) {
  return typeof value === "string"
    ? value.split(path.sep).join("/").replace(/-cli\//g, "/")
    : value;
}

/** Compare the GUI envelope against the CLI --json envelope key for key. */
function assertMatchesCli(gui, cli, label) {
  const name = label || String(gui.command);
  assert.equal(gui.schema, cli.summary.schema, name + ": schema");
  assert.equal(gui.command, cli.summary.command, name + ": command");
  assert.equal(gui.ok, cli.summary.ok, name + ": ok");
  assert.equal(gui.outcome, cli.summary.outcome, name + ": outcome");
  assert.deepEqual(gui.error, cli.summary.error, name + ": error");
  for (const key of Object.keys(cli.summary)) {
    if (["schema", "command", "ok", "outcome", "error"].includes(key)) continue;
    if (key === "elapsedMs") {
      assert.equal(typeof gui[key], "number", name + ": elapsedMs type");
      continue;
    }
    assert.deepEqual(normalizePath(gui[key]), normalizePath(cli.summary[key]), name + ": " + key);
  }
}

test("gui handlers: the allowlist is exactly the 14 CLI commands", () => {
  assert.deepEqual([...GUI_COMMANDS].sort(), [
    "config", "doctor", "export", "extract", "import", "install", "launch",
    "scan", "speaker", "status", "terms", "translate", "uninstall", "verify",
  ]);
});

test("gui handlers: scan resolves to the CLI --json envelope", async () => {
  const game = tempGame();
  const gui = await runGuiCommand("scan", [game]);
  assertMatchesCli(gui, cliJson(["scan", game]), "scan");
});

test("gui handlers: E_NOT_PROJECT comes back as the documented error envelope", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-gui-empty-"));
  const gui = await runGuiCommand("scan", [dir]);
  assert.equal(gui.ok, false);
  assert.equal(gui.outcome, "error");
  assert.equal(gui.error.code, "E_NOT_PROJECT");
  const cli = cliJson(["scan", dir]);
  assert.equal(cli.code, 2);
  assert.deepEqual(gui.error, cli.summary.error);
});

test("gui handlers: unknown commands are refused with E_USAGE", async () => {
  const gui = await runGuiCommand("nosuch", ["x"]);
  assert.equal(gui.ok, false);
  assert.equal(gui.error.code, "E_USAGE");
  assert.match(gui.error.message, /unknown command/);
});

test("gui handlers: install and uninstall round-trip against the CLI", async () => {
  const game = tempGame();
  const cliGame = game + "-cli";
  fs.cpSync(game, cliGame, { recursive: true });
  const installed = await runGuiCommand("install", [game]);
  const cliInstalled = cliJson(["install", cliGame]);
  assertMatchesCli(installed, cliInstalled, "install");
  const removed = await runGuiCommand("uninstall", [game]);
  const cliRemoved = cliJson(["uninstall", cliGame]);
  assertMatchesCli(removed, cliRemoved, "uninstall");
});

test("gui handlers: translate dry-run matches the CLI and never builds a provider", async () => {
  const game = tempDictGame(6);
  const gui = await runGuiCommand("translate", [game], { flags: { "dry-run": true, provider: "mock" } });
  assertMatchesCli(gui, cliJson(["translate", game, "--dry-run", "--provider", "mock"]), "translate --dry-run");
});

test("gui handlers: progress and warning callbacks fire", async () => {
  const game = tempDictGame(6);
  const seen = [];
  const warnings = [];
  const gui = await runGuiCommand("translate", [game], {
    flags: { "dry-run": true, provider: "mock" },
    onProgress: (progress) => seen.push(progress),
    onWarning: (line) => warnings.push(line),
  });
  assert.equal(gui.ok, true);
  assert.ok(seen.length > 0, "progress fired");
  assert.equal(seen[0].done, 0);
  assert.deepEqual(warnings, [], "a dry run over a clean fixture warns nothing");
});

test("gui handlers: launchInvocation mirrors the CLI argv shape", () => {
  assert.deepEqual(launchInvocation("D:/games/x"), { args: ["D:/games/x"], flags: {} });
  assert.deepEqual(launchInvocation("D:/games/x", "D:/games/x/game.exe"), { args: ["D:/games/x"], flags: { exe: "D:/games/x/game.exe" } });
});

test("gui handlers: launch without an .exe resolves to the CLI E_EXE envelope", async () => {
  const game = tempGame();
  const gui = await runGuiCommand("launch", [game]);
  assert.equal(gui.ok, false);
  assert.equal(gui.error.code, "E_EXE");
  const cli = cliJson(["launch", game]);
  assert.equal(cli.code, 2);
  assert.deepEqual(gui.error, cli.summary.error);
  assert.deepEqual(gui.error.details.candidates, []);
});

test("gui handlers: launch refuses non-projects exactly like the CLI", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-gui-empty-"));
  const gui = await runGuiCommand("launch", [dir]);
  assert.equal(gui.ok, false);
  assert.equal(gui.error.code, "E_NOT_PROJECT");
  assert.deepEqual(gui.error, cliJson(["launch", dir]).summary.error);
});

test("gui handlers: --exe that does not exist resolves to the CLI E_EXE envelope", async () => {
  const game = tempGame();
  const gui = await runGuiCommand("launch", [game], { flags: { exe: "nope.exe" } });
  assert.equal(gui.ok, false);
  assert.equal(gui.error.code, "E_EXE");
  const cli = cliJson(["launch", game, "--exe", "nope.exe"]);
  assert.deepEqual(gui.error, cli.summary.error);
  assert.match(gui.error.message, /no nope\.exe in /);
});
