// Contract tests for the preload bridge (gui/preload.js).
//
// The preload script is the last GUI glue layer without a test before 0.58:
// it is the single bridge the sandboxed renderer may use, so the contract is
// three-sided. These tests pin the exposed world and key set, that the
// bridge's command list, the handlers allowlist and the buttons in
// index.html agree, that every method hits exactly the channel gui/main.js
// registers, and that the progress subscriptions are cancellable.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";

const HERE = new URL("./", import.meta.url);
await register(new URL("./helpers/electron-hook.mjs", HERE));

const stub = await import("./helpers/electron-stub.mjs");
const { GUI_COMMANDS } = await import("../gui/handlers.js");
await import("../gui/preload.js");

const state = stub.__state();
assert.equal(state.bridges.length, 1, "preload exposes exactly one bridge");
const WORLD = state.bridges[0].world;
const api = state.bridges[0].api;

const flush = () => new Promise((resolve) => setTimeout(resolve, 5));

test("gui-preload: the bridge is exposed as window.yakusha with the documented surface", () => {
  assert.equal(WORLD, "yakusha");
  assert.deepEqual(Object.keys(api).sort(), [
    "cancel", "clearApiKey", "commands", "hasApiKey", "loadDictionary",
    "logPath", "onProgress", "onResult", "onWarning", "openLog", "pathForFile",
    "pickDirectory", "run", "saveApiKey", "saveEntry",
  ]);
});

test("gui-preload: the command list matches the handlers allowlist", () => {
  assert.equal(new Set(api.commands).size, api.commands.length, "no duplicates");
  assert.deepEqual([...api.commands].sort(), [...GUI_COMMANDS].sort());
});

test("gui-preload: every button in index.html drives a command the bridge exposes", () => {
  const html = fs.readFileSync(new URL("../gui/renderer/index.html", import.meta.url), "utf8");
  const buttons = [...html.matchAll(/data-cmd="([a-z-]+)"/g)].map((m) => m[1]);
  assert.equal(buttons.length, 12);
  for (const command of buttons) {
    assert.ok(api.commands.includes(command), "button drives an exposed command: " + command);
  }
});

test("gui-preload: run forwards the whole request to gui:run", async () => {
  stub.__reset();
  await api.run("scan", ["D:/games/x"], { json: true }, 7);
  await flush();
  assert.deepEqual(state.rendererInvokes, [
    ["gui:run", { command: "scan", args: ["D:/games/x"], flags: { json: true }, runId: 7, useStoredKey: false }],
  ]);
});

test("gui-preload: run defaults the optional fields and only a strict true remembers the key", async () => {
  stub.__reset();
  await api.run("status");
  await flush();
  assert.deepEqual(state.rendererInvokes[0], ["gui:run", { command: "status", args: undefined, flags: {}, runId: 0, useStoredKey: false }]);
  stub.__reset();
  await api.run("translate", [], {}, 1, "yes");
  await flush();
  assert.equal(state.rendererInvokes[0][1].useStoredKey, false);
  stub.__reset();
  await api.run("translate", [], {}, 1, true);
  await flush();
  assert.equal(state.rendererInvokes[0][1].useStoredKey, true);
});

test("gui-preload: the no-argument methods hit their channels bare", async () => {
  stub.__reset();
  await api.cancel();
  await api.pickDirectory();
  await api.hasApiKey();
  await api.clearApiKey();
  await api.logPath();
  await api.openLog();
  await flush();
  assert.deepEqual(state.rendererInvokes.map((entry) => entry[0]), [
    "gui:cancel", "gui:pick-directory", "gui:has-key", "gui:clear-key", "gui:log-path", "gui:open-log",
  ]);
  for (const entry of state.rendererInvokes) {
    assert.equal(entry.length, 1, entry[0] + " carries no payload");
  }
});

test("gui-preload: credentials and dictionary channels pass arguments through", async () => {
  stub.__reset();
  await api.saveApiKey("sk-test");
  await api.loadDictionary("D:/games/x");
  await api.saveEntry("D:/games/x", "k1", "v1");
  await flush();
  assert.deepEqual(state.rendererInvokes, [
    ["gui:save-key", "sk-test"],
    ["gui:dict-load", "D:/games/x"],
    ["gui:dict-save", "D:/games/x", "k1", "v1"],
  ]);
});
test("gui-preload: progress, warning and result subscriptions target the right channels", () => {
  stub.__reset();
  const seen = [];
  api.onProgress((body) => seen.push(["gui:progress", body]));
  api.onWarning((body) => seen.push(["gui:warning", body]));
  api.onResult((body) => seen.push(["gui:result", body]));
  assert.deepEqual([...state.rendererListeners.keys()].sort(), ["gui:progress", "gui:result", "gui:warning"]);
  for (const [channel, listeners] of state.rendererListeners) {
    assert.equal(listeners.length, 1, channel + " has one subscription");
    listeners[0]({ fake: "event" }, { runId: 9, line: "x" });
  }
  assert.deepEqual(seen, [
    ["gui:progress", { runId: 9, line: "x" }],
    ["gui:warning", { runId: 9, line: "x" }],
    ["gui:result", { runId: 9, line: "x" }],
  ]);
});

test("gui-preload: the unsubscribe function removes the exact listener", () => {
  stub.__reset();
  const calls = [];
  const off = api.onProgress((body) => calls.push("a:" + body));
  api.onProgress((body) => calls.push("b:" + body));
  const listeners = state.rendererListeners.get("gui:progress");
  assert.equal(listeners.length, 2);
  off();
  assert.equal(state.rendererListeners.get("gui:progress").length, 1);
  listeners[0]({}, "live");
  assert.deepEqual(calls, ["b:live"]);
});

test("gui-preload: the unsubscribe function fully removes a lone listener", () => {
  stub.__reset();
  const off = api.onResult(() => {});
  assert.equal(state.rendererListeners.get("gui:result").length, 1);
  off();
  assert.equal(state.rendererListeners.get("gui:result").length, 0);
});

test("gui-preload: pathForFile delegates to webUtils", () => {
  stub.__reset({ pathForReply: "D:/games/y" });
  const file = { name: "demo" };
  assert.equal(api.pathForFile(file), "D:/games/y");
  assert.deepEqual(state.pathForCalls, [file]);
});