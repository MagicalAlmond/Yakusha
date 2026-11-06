// Contract tests for the Electron main-process shell (gui/main.js).
//
// main.js is the only GUI layer without a real electron runtime in CI, so
// these tests load it through a module hook that redirects the bare
// "electron" specifier (and its handlers import) to controllable stubs and
// pin down the rules docs/architecture.md §6 and docs/gui.md promise: the
// closed IPC allowlist, the window security settings, the single-instance
// quit, credentials/dictionary/directory channels, and -- since 0.57 --
// that cancel actually reaches the running command.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";

const HERE = new URL("./", import.meta.url);
await register(new URL("./helpers/electron-hook.mjs", HERE));

const stub = await import("./helpers/electron-stub.mjs");
const handlersStub = await import("./helpers/gui-handlers-stub.mjs");

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
const okEnvelope = (command) => ({ schema: 1, command, ok: true, outcome: "ok" });

const IPC_CHANNELS = [
  "gui:cancel",
  "gui:clear-key",
  "gui:dict-load",
  "gui:dict-save",
  "gui:has-key",
  "gui:pick-directory",
  "gui:run",
  "gui:save-key",
].sort();

test("gui-main: a denied single-instance lock explains itself and quits", async () => {
  stub.__reset({ lock: false });
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(" "));
  try {
    await import("../gui/main.js?singleton=off");
  } finally {
    console.error = original;
  }
  const state = stub.__state();
  assert.equal(state.quitCalls, 1);
  assert.equal(state.ipc.size, 0);
  assert.equal(state.windows.length, 0);
  // 0.65: a denied lock used to be a silent exit, which is indistinguishable
  // from "the GUI does not start". Both the dialog and stderr must name the
  // profile folder and the way out.
  assert.equal(state.errorBoxes.length, 1);
  assert.equal(state.errorBoxes[0].title, "Yakusha");
  assert.match(state.errorBoxes[0].content, /--user-data-dir/);
  assert.match(state.errorBoxes[0].content, /AppData\/Roaming\/yakusha/);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^\[yakusha\] .*--user-data-dir/);
});

test("gui-main: app start registers exactly the documented IPC allowlist", async () => {
  stub.__reset({ lock: true });
  await import("../gui/main.js?core");
  stub.app.__resolveReady();
  await settle();
  const state = stub.__state();
  assert.deepEqual([...state.ipc.keys()].sort(), IPC_CHANNELS);
});

test("gui-main: the window is created with the hardened security settings", () => {
  const state = stub.__state();
  assert.equal(state.windows.length, 1);
  const win = state.windows[0];
  const prefs = win.opts.webPreferences;
  assert.equal(prefs.contextIsolation, true);
  assert.equal(prefs.nodeIntegration, false);
  assert.match(prefs.preload, /gui[\\/]preload\.js$/);
  assert.match(win.loadedFile, /gui[\\/]renderer[\\/]index\.html$/);
});

test("gui-main: the window refuses navigation and window.open", () => {
  const win = stub.__state().windows[0];
  const event = { prevented: false, preventDefault() { this.prevented = true; } };
  win.emit("will-navigate", event);
  assert.equal(event.prevented, true);
  assert.equal(win.webContents.openHandler({ url: "https://example.invalid" }).action, "deny");
});

test("gui-main: gui:run rejects a command outside the allowlist", async () => {
  const envelope = await stub.ipcMain.__invoke("gui:run", null, { command: "format-c" });
  assert.equal(envelope.ok, false);
  assert.equal(envelope.outcome, "error");
  assert.equal(envelope.error.code, "E_USAGE");
  assert.match(envelope.error.message, /unknown command/);
});

test("gui-main: gui:run normalises malformed requests", async () => {
  const captured = [];
  handlersStub.__setImpl((command, args, opts) => {
    captured.push({ command, args, opts });
    return Promise.resolve(okEnvelope(command));
  });
  const envelope = await stub.ipcMain.__invoke("gui:run", null, {
    command: "scan",
    args: "not-an-array",
    flags: null,
    runId: "zero",
  });
  assert.equal(envelope.ok, true);
  assert.equal(captured[0].args.length, 0);
  const result = stub.__state().windows[0].webContents.sent.find(([channel]) => channel === "gui:result");
  assert.equal(result[1].runId, 0);
  handlersStub.__setImpl(null);
});

test("gui-main: a non-translate run passes no cancellation signal", async () => {
  const captured = [];
  handlersStub.__setImpl((command, args, opts) => {
    captured.push(opts);
    return Promise.resolve(okEnvelope(command));
  });
  await stub.ipcMain.__invoke("gui:run", null, { command: "scan", args: ["G"], flags: {}, runId: 5 });
  assert.equal(captured[0].signal, null);
  handlersStub.__setImpl(null);
});

test("gui-main: cancel aborts the signal the translate run received", async () => {
  const captured = [];
  let release;
  handlersStub.__setImpl((command, args, opts) => {
    captured.push(opts);
    return new Promise((resolve) => { release = () => resolve(okEnvelope(command)); });
  });
  const run = stub.ipcMain.__invoke("gui:run", null, { command: "translate", args: ["G"], flags: {}, runId: 1 });
  await settle();
  assert.ok(captured[0].signal instanceof AbortSignal);
  assert.equal(captured[0].signal.aborted, false);
  const second = await stub.ipcMain.__invoke("gui:run", null, { command: "translate", args: ["G"], flags: {}, runId: 2 });
  assert.equal(second.error.code, "E_USAGE");
  assert.match(second.error.message, /a translate run is already in progress/);
  assert.equal(await stub.ipcMain.__invoke("gui:cancel"), true);
  assert.equal(captured[0].signal.aborted, true);
  release();
  const envelope = await run;
  assert.equal(envelope.ok, true);
  // the single-flight slot is free again after the run settles
  handlersStub.__setImpl((command) => Promise.resolve(okEnvelope(command)));
  const again = await stub.ipcMain.__invoke("gui:run", null, { command: "translate", args: ["G"], flags: {}, runId: 3 });
  assert.equal(again.ok, true);
  handlersStub.__setImpl(null);
});

test("gui-main: progress, warnings and the result reach the window", async () => {
  handlersStub.__setImpl((command, args, opts) => {
    opts.onProgress({ done: 1, total: 4, translated: 1, rejected: 0 });
    opts.onWarning("slow provider");
    return Promise.resolve(okEnvelope(command));
  });
  const envelope = await stub.ipcMain.__invoke("gui:run", null, { command: "translate", args: ["G"], flags: {}, runId: 9 });
  assert.equal(envelope.ok, true);
  const sent = stub.__state().windows[0].webContents.sent;
  const progress = sent.find(([channel]) => channel === "gui:progress");
  assert.deepEqual(progress[1], { runId: 9, command: "translate", progress: { done: 1, total: 4, translated: 1, rejected: 0 } });
  const warning = sent.find(([channel]) => channel === "gui:warning");
  assert.deepEqual(warning[1], { runId: 9, command: "translate", line: "slow provider" });
  const result = sent.filter(([channel]) => channel === "gui:result").pop();
  assert.equal(result[1].runId, 9);
  assert.equal(result[1].envelope.ok, true);
  handlersStub.__setImpl(null);
});

test("gui-main: a thrown handler error still answers with one E_INTERNAL envelope", async () => {
  handlersStub.__setImpl(() => Promise.reject(new Error("boom")));
  const envelope = await stub.ipcMain.__invoke("gui:run", null, { command: "scan", args: ["G"], flags: {}, runId: 6 });
  assert.equal(envelope.ok, false);
  assert.equal(envelope.outcome, "error");
  assert.equal(envelope.error.code, "E_INTERNAL");
  assert.match(envelope.error.message, /boom/);
  const result = stub.__state().windows[0].webContents.sent.filter(([channel]) => channel === "gui:result").pop();
  assert.equal(result[1].envelope.error.code, "E_INTERNAL");
  handlersStub.__setImpl(null);
});

test("gui-main: credentials channels round-trip a stored key", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-gui-main-"));
  const previous = process.env.YAKUSHA_CONFIG_DIR;
  process.env.YAKUSHA_CONFIG_DIR = tmp;
  try {
    assert.deepEqual(await stub.ipcMain.__invoke("gui:save-key", null, ""), {
      saved: false,
      reason: "no key or no configuration directory",
    });
    assert.deepEqual(await stub.ipcMain.__invoke("gui:save-key", null, "sk-test"), { saved: true });
    assert.equal(await stub.ipcMain.__invoke("gui:has-key"), true);

    // useStoredKey injects the stored key into the translate flags
    const captured = [];
    let release;
    handlersStub.__setImpl((command, args, opts) => {
      captured.push(opts);
      return new Promise((resolve) => { release = () => resolve(okEnvelope(command)); });
    });
    const run = stub.ipcMain.__invoke("gui:run", null, {
      command: "translate", args: ["G"], flags: {}, runId: 11, useStoredKey: true,
    });
    await settle();
    assert.equal(captured[0].flags["api-key"], "sk-test");
    release();
    await run;
    handlersStub.__setImpl(null);

    assert.deepEqual(await stub.ipcMain.__invoke("gui:clear-key"), { cleared: true });
    assert.equal(await stub.ipcMain.__invoke("gui:has-key"), false);
    const missing = await stub.ipcMain.__invoke("gui:run", null, {
      command: "translate", args: ["G"], flags: {}, runId: 12, useStoredKey: true,
    });
    assert.equal(missing.error.code, "E_CONFIG");
    assert.match(missing.error.message, /cannot be read/);
  } finally {
    if (previous === undefined) delete process.env.YAKUSHA_CONFIG_DIR;
    else process.env.YAKUSHA_CONFIG_DIR = previous;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("gui-main: useStoredKey without a configuration directory is E_CONFIG", async () => {
  const previousDir = process.env.YAKUSHA_CONFIG_DIR;
  const previousAppData = process.env.APPDATA;
  delete process.env.YAKUSHA_CONFIG_DIR;
  delete process.env.APPDATA;
  try {
    const envelope = await stub.ipcMain.__invoke("gui:run", null, {
      command: "translate", args: ["G"], flags: {}, runId: 13, useStoredKey: true,
    });
    assert.equal(envelope.error.code, "E_CONFIG");
    assert.match(envelope.error.message, /no configuration directory is available/);
  } finally {
    if (previousDir !== undefined) process.env.YAKUSHA_CONFIG_DIR = previousDir;
    if (previousAppData !== undefined) process.env.APPDATA = previousAppData;
  }
});

test("gui-main: dictionary channels read and write one entry", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-gui-main-"));
  try {
    const missing = await stub.ipcMain.__invoke("gui:dict-load", null, tmp);
    assert.equal(missing.ok, false);
    assert.equal(missing.error.code, "E_NO_DICTIONARY");

    fs.mkdirSync(path.join(tmp, "yakusha"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, "yakusha", "dictionary.json"),
      JSON.stringify({ format: "yakusha/1", entries: { k1: { text: "v1", contexts: ["c1"] } } }, null, 2) + "\n",
    );
    const loaded = await stub.ipcMain.__invoke("gui:dict-load", null, tmp);
    assert.equal(loaded.entries.length, 1);
    assert.equal(loaded.entries[0].key, "k1");
    assert.equal(loaded.entries[0].text, "v1");

    const saved = await stub.ipcMain.__invoke("gui:dict-save", null, tmp, "k1", "v2");
    assert.equal(saved.key, "k1");
    assert.equal(saved.translated, 1);
    const reloaded = await stub.ipcMain.__invoke("gui:dict-load", null, tmp);
    assert.equal(reloaded.entries[0].text, "v2");
    assert.equal(reloaded.entries[0].pending, false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("gui-main: the directory picker remembers the last folder", async () => {
  const state = stub.__state();
  state.dialogResult = { canceled: false, filePaths: ["D:/games/demo"] };
  assert.equal(await stub.ipcMain.__invoke("gui:pick-directory"), "D:/games/demo");
  state.dialogResult = { canceled: false, filePaths: ["D:/games/other"] };
  await stub.ipcMain.__invoke("gui:pick-directory");
  assert.equal(state.dialogCalls[1].defaultPath, "D:/games/demo");
  state.dialogResult = { canceled: true, filePaths: [] };
  assert.equal(await stub.ipcMain.__invoke("gui:pick-directory"), null);
});

test("gui-main: a second instance focuses the existing window", () => {
  const win = stub.__state().windows[0];
  stub.app.__emit("second-instance");
  assert.equal(win.focusCalls, 1);
  win.minimized = true;
  stub.app.__emit("second-instance");
  assert.equal(win.restoreCalls, 1);
  assert.ok(win.focusCalls >= 2);
});

test("gui-main: closing the window cancels a translate run in flight", async () => {
  const captured = [];
  let release;
  handlersStub.__setImpl((command, args, opts) => {
    captured.push(opts);
    return new Promise((resolve) => { release = () => resolve(okEnvelope(command)); });
  });
  const run = stub.ipcMain.__invoke("gui:run", null, { command: "translate", args: ["G"], flags: {}, runId: 21 });
  await settle();
  const quitsBefore = stub.__state().quitCalls;
  stub.app.__emit("window-all-closed");
  assert.equal(captured[0].signal.aborted, true);
  assert.ok(stub.__state().quitCalls > quitsBefore);
  release();
  await run;
  handlersStub.__setImpl(null);
});
