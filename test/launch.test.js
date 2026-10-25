/**
 * Game launch (docs/engines.md §8).
 *
 * Discovery is tested as a pure function: only direct, regular .exe files are
 * eligible, --exe must be a bare name, and E_EXE carries at most 20 candidates.
 * The spawn itself is never real here; an injected fake records the exact
 * arguments and checks that translation keys never reach the child environment.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  childEnvironment,
  isBareExecutableName,
  launchProject,
  listExecutables,
  selectExecutable,
} from "../src/engines/launch.js";
import { getAdapter } from "../src/engines/registry.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, "..", "bin", "yakusha.js");
const FIXTURES = {
  mz: path.join(HERE, "fixtures", "mini-mz"),
  mv: path.join(HERE, "fixtures", "mini-mv"),
};
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

/** @returns {string} a private copy of a fixture, safe to mutate */
function tempGame(engine = "mz") {
  const game = path.join(tempDir("yakusha-launch-"), "game");
  fs.cpSync(FIXTURES[engine], game, { recursive: true });
  return game;
}

/** @param {string} game @param {string} name */
function writeExe(game, name) {
  fs.writeFileSync(path.join(game, name), "");
}

/**
 * A fake ChildProcess: it records nothing itself, it just emits "spawn" on the
 * next microtask the way Node does after a successful CreateProcess.
 *
 * @param {number} pid
 * @param {() => void} [onUnref]
 */
function fakeChild(pid, onUnref) {
  const child = new EventEmitter();
  child.pid = pid;
  child.unref = () => {
    if (onUnref) onUnref();
  };
  queueMicrotask(() => child.emit("spawn"));
  return child;
}

/** @param {string} game @param {"mz"|"mv"} [engine] */
function projectFor(game, engine = "mz") {
  const adapter = getAdapter(engine);
  const result = adapter.detect(game);
  assert.equal(result.ok, true, JSON.stringify(result));
  return { adapter, project: result.project };
}

/** @returns {{code: number, stdout: string, stderr: string}} */
function run(args) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^YAKUSHA_/i.test(key) || /^OPENAI_API_KEY$/i.test(key)) delete env[key];
  }
  const result = spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", env, timeout: 60000 });
  return { code: result.status === null ? 1 : result.status, stdout: result.stdout || "", stderr: result.stderr || "" };
}

/** @returns {any} */
function envelope(result) {
  assert.equal(result.stdout.endsWith("\n"), true, "stdout must end with a newline");
  const lines = result.stdout.trimEnd().split("\n");
  assert.equal(lines.length, 1, "expected one JSON object, got: " + result.stdout.slice(0, 400));
  return JSON.parse(lines[0]);
}

test("launch: --exe accepts only a bare .exe file name", () => {
  const valid = ["Game.exe", "GAME.EXE", "my game.exe", "game.ExE"];
  const invalid = [
    "",
    "Game",
    "Game.txt",
    "sub/Game.exe",
    "sub\\Game.exe",
    "..\\Game.exe",
    "/Game.exe",
    "C:\\Games\\Game.exe",
    "C:Game.exe",
    "..",
  ];
  for (const name of valid) assert.equal(isBareExecutableName(name), true, JSON.stringify(name));
  for (const name of invalid) assert.equal(isBareExecutableName(name), false, JSON.stringify(name));
});

test("launch: only direct regular .exe files are candidates", () => {
  const game = tempGame();
  assert.deepEqual(listExecutables(game), []);
  writeExe(game, "Game.exe");
  writeExe(game, "Tool.EXE");
  fs.writeFileSync(path.join(game, "notes.txt"), "");
  fs.mkdirSync(path.join(game, "folder.exe"));
  fs.mkdirSync(path.join(game, "nested"));
  fs.writeFileSync(path.join(game, "nested", "Deep.exe"), "");
  assert.deepEqual(listExecutables(game), ["Game.exe", "Tool.EXE"]);
});

test("launch: no executable is E_EXE with an empty candidate list", () => {
  const game = tempGame();
  assert.throws(
    () => selectExecutable(game),
    (error) => {
      assert.equal(error.code, "E_EXE");
      assert.match(error.message, /no \.exe found/);
      assert.match(error.message, /--exe/);
      assert.deepEqual(error.details, { candidates: [] });
      return true;
    }
  );
});

test("launch: multiple executables are E_EXE with sorted candidates", () => {
  const game = tempGame();
  writeExe(game, "Tool.exe");
  writeExe(game, "Game.exe");
  assert.throws(
    () => selectExecutable(game),
    (error) => {
      assert.equal(error.code, "E_EXE");
      assert.match(error.message, /found 2 \.exe files/);
      assert.match(error.message, /--exe/);
      assert.deepEqual(error.details.candidates, ["Game.exe", "Tool.exe"]);
      return true;
    }
  );
});

test("launch: E_EXE candidates are capped at 20", () => {
  const game = tempGame();
  for (let index = 0; index < 25; index += 1) {
    writeExe(game, "game" + String(index).padStart(2, "0") + ".exe");
  }
  assert.throws(
    () => selectExecutable(game),
    (error) => {
      assert.equal(error.code, "E_EXE");
      assert.match(error.message, /found 25 \.exe files/);
      assert.equal(error.details.candidates.length, 20);
      assert.equal(error.details.candidates[0], "game00.exe");
      assert.equal(error.details.candidates[19], "game19.exe");
      return true;
    }
  );
});

test("launch: --exe matches case-insensitively and returns the disk name", () => {
  const game = tempGame();
  writeExe(game, "Game.EXE");
  assert.equal(selectExecutable(game, "game.exe"), path.join(game, "Game.EXE"));
  assert.equal(selectExecutable(game), path.join(game, "Game.EXE"));
});

test("launch: --exe must exist and must be a bare name", () => {
  const game = tempGame();
  writeExe(game, "Game.exe");
  for (const requested of ["missing.exe", "sub/Game.exe", "..\\Game.exe", "C:\\Game.exe"]) {
    assert.throws(
      () => selectExecutable(game, requested),
      (error) => {
        assert.equal(error.code, "E_EXE", requested);
        assert.deepEqual(error.details.candidates, ["Game.exe"]);
        return true;
      }
    );
  }
});

test("launch: the child environment never carries translation keys", () => {
  const env = childEnvironment({
    PATH: "C:\\Windows",
    KEEP: "1",
    YAKUSHA_API_KEY: "a",
    yakusha_api_key: "b",
    OPENAI_API_KEY: "c",
    OpenAI_Api_Key: "d",
  });
  assert.deepEqual(env, { PATH: "C:\\Windows", KEEP: "1" });
});

test("launch: spawn arguments are exact and the key never reaches the game", async () => {
  const game = tempGame();
  writeExe(game, "Game.exe");
  const { project } = projectFor(game);
  const calls = [];
  let unrefed = false;

  const result = await launchProject(project, {
    platform: "win32",
    env: { PATH: "C:\\bin", KEEP: "1", YAKUSHA_API_KEY: "secret", OPENAI_API_KEY: "secret2" },
    spawn(exe, args, options) {
      calls.push({ exe, args, options });
      return fakeChild(4321, () => {
        unrefed = true;
      });
    },
  });

  assert.deepEqual(result, { pid: 4321, exe: path.join(game, "Game.exe"), root: project.root });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].exe, path.join(game, "Game.exe"));
  assert.deepEqual(calls[0].args, []);
  assert.deepEqual(calls[0].options, {
    cwd: project.root,
    detached: true,
    stdio: "ignore",
    shell: false,
    windowsHide: false,
    env: { PATH: "C:\\bin", KEEP: "1" },
  });
  assert.equal(unrefed, true);
});

test("launch: a synchronous spawn failure is E_IO", async () => {
  const game = tempGame();
  writeExe(game, "Game.exe");
  const { project } = projectFor(game);
  await assert.rejects(
    launchProject(project, {
      platform: "win32",
      spawn() {
        const error = new Error("cannot create process");
        error.code = "ENOENT";
        throw error;
      },
    }),
    (error) => {
      assert.equal(error.code, "E_IO");
      assert.match(error.message, /cannot start/);
      assert.match(error.message, /ENOENT/);
      assert.match(error.message, /Game\.exe/);
      return true;
    }
  );
});

test("launch: an asynchronous spawn error event is E_IO", async () => {
  const game = tempGame();
  writeExe(game, "Game.exe");
  const { project } = projectFor(game);
  await assert.rejects(
    launchProject(project, {
      platform: "win32",
      spawn() {
        const child = new EventEmitter();
        child.pid = 1;
        child.unref = () => {};
        queueMicrotask(() => {
          const error = new Error("access denied");
          error.code = "EACCES";
          child.emit("error", error);
        });
        return child;
      },
    }),
    (error) => {
      assert.equal(error.code, "E_IO");
      assert.match(error.message, /EACCES/);
      return true;
    }
  );
});

test("launch: both adapters reject non-Windows before touching spawn", async () => {
  for (const engine of ["mz", "mv"]) {
    const game = tempGame(engine);
    const { adapter, project } = projectFor(game, engine);
    await assert.rejects(
      adapter.launch(project, {
        platform: "linux",
        spawn() {
          assert.fail("spawn must not run on an unsupported platform");
        },
      }),
      (error) => {
        assert.equal(error.code, "E_UNSUPPORTED_PLATFORM");
        assert.match(error.message, /Windows/);
        return true;
      }
    );
  }
});

test("launch: both adapters hand the fake spawn the project executable", async () => {
  for (const engine of ["mz", "mv"]) {
    const game = tempGame(engine);
    writeExe(game, "Game.exe");
    const { adapter, project } = projectFor(game, engine);
    const result = await adapter.launch(project, {
      platform: "win32",
      spawn() {
        return fakeChild(777);
      },
    });
    assert.deepEqual(result, { pid: 777, exe: path.join(game, "Game.exe"), root: project.root });
  }
});

test("launch: the CLI reports E_EXE and candidates in the envelope", () => {
  const game = tempGame();
  let result = run(["launch", game, "--json"]);
  assert.equal(result.code, 2);
  let body = envelope(result);
  assert.equal(body.command, "launch");
  assert.equal(body.outcome, "error");
  assert.equal(body.error.code, "E_EXE");
  assert.deepEqual(body.error.details, { candidates: [] });

  writeExe(game, "Game.exe");
  writeExe(game, "Tool.exe");
  result = run(["launch", game, "--json"]);
  assert.equal(result.code, 2);
  body = envelope(result);
  assert.equal(body.error.code, "E_EXE");
  assert.deepEqual(body.error.details.candidates, ["Game.exe", "Tool.exe"]);

  result = run(["launch", game, "--exe", "missing.exe", "--json"]);
  assert.equal(result.code, 2);
  body = envelope(result);
  assert.equal(body.error.code, "E_EXE");
  assert.deepEqual(body.error.details.candidates, ["Game.exe", "Tool.exe"]);
});

test("launch: invalid --exe values are E_EXE and bad options are E_USAGE", () => {
  const game = tempGame();
  writeExe(game, "Game.exe");
  const cases = [
    { args: ["launch", game, "--exe", "../Game.exe", "--json"], code: "E_EXE" },
    { args: ["launch", game, "--exe", "C:\\Game.exe", "--json"], code: "E_EXE" },
    { args: ["launch", game, "--exe", "--json"], code: "E_USAGE" },
    { args: ["launch", game, "--bogus", "--json"], code: "E_USAGE" },
    { args: ["launch", "--json"], code: "E_USAGE" },
  ];
  for (const item of cases) {
    const result = run(item.args);
    assert.equal(result.code, 2, item.args.join(" "));
    const body = envelope(result);
    assert.equal(
      body.error.code,
      item.code,
      item.args.join(" ") + ": " + JSON.stringify(body.error)
    );
  }
});
