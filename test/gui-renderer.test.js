import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RENDERER = path.join(ROOT, "gui", "renderer", "renderer.js");
const DELIVERY = path.join(ROOT, "gui", "renderer", "delivery.js");
const RECENT = path.join(ROOT, "gui", "renderer", "recent.js");

const IDS = [
  "project-line", "project-input", "engine-badge", "pick", "launch-run", "launch-original",
  "launch-translated", "cancel", "progress", "bar-fill", "progress-bar", "progress-text",
  "dict-load", "dict-summary", "dict-key", "dict-text", "dict-save", "import-run",
  "config-summary", "key-input", "key-save", "key-clear", "key-use", "key-state",
  "source-lang", "toasts", "log-summary", "log-open", "delivery", "delivery-tier",
  "delivery-title", "delivery-copy", "delivery-caution", "recent", "recent-list",
  "project-title", "project-state", "sidebar-project-name", "stage-prepare",
  "stage-translate", "stage-deliver", "stage-prepare-status", "stage-translate-status",
  "stage-deliver-status", "task-title", "task-copy", "task-state", "primary-action",
  "task-secondary", "task-stats", "stat-translated", "stat-pending", "stat-total",
  "last-run", "last-run-title", "last-run-detail", "last-run-time", "health-engine",
  "health-strings", "health-translated", "health-delivery", "service-banner",
  "service-config", "config-load", "config-provider", "config-api-format", "config-model",
  "config-base-url", "config-save", "config-clear", "config-state", "config-query-models",
  "config-model-list", "config-model-status", "brand-home", "nav-overview", "nav-workflow",
  "nav-dictionary", "nav-settings", "page-overview", "page-workflow", "page-dictionary",
  "page-settings", "overview-heading", "workflow-heading", "dictionary-heading",
  "settings-heading", "project-card-title", "project-card-line", "project-card-engine",
  "workflow-launch", "tab-service", "tab-credentials", "tab-translation", "tab-glossary",
  "settings-service", "settings-credentials", "settings-translation", "settings-glossary",
  "rail-toggle", "rail-toggle-icon",
  "log-toggle", "log-dock", "log-refresh", "log-close", "log-lines", "log-count",
];
const COMMANDS = ["scan", "extract", "status", "translate", "verify", "install",
  "uninstall", "export", "speaker", "terms", "doctor", "config"];

class FakeElement {
  constructor(id = "") {
    this.id = id;
    this.dataset = {};
    this.textContent = "";
    this.value = "";
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.title = "";
    this.style = {};
    this.children = [];
    this.listeners = new Map();
    this.classList = {
      _set: new Set(),
      add(name) { this._set.add(name); },
      remove(name) { this._set.delete(name); },
      toggle(name, force) {
        const next = force === undefined ? !this._set.has(name) : Boolean(force);
        if (next) this._set.add(name); else this._set.delete(name);
        return next;
      },
      contains(name) { return this._set.has(name); },
      has(name) { return this._set.has(name); },
    };
    this._innerHTML = "";
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  async dispatch(type, event = {}) {
    const handlers = this.listeners.get(type) || [];
    await Promise.all(handlers.map((fn) => fn(event)));
  }
  click() { return this.dispatch("click"); }
  appendChild(child) { child.parent = this; this.children.push(child); }
  remove() {
    this.removed = true;
    this.hidden = true;
    if (this.parent) {
      const at = this.parent.children.indexOf(this);
      if (at >= 0) this.parent.children.splice(at, 1);
    }
  }
  set innerHTML(value) { this._innerHTML = value; if (value === "") this.children = []; }
  get innerHTML() { return this._innerHTML; }
}

function makeStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    clear() { values.clear(); },
  };
}

function makeDom(options = {}) {
  const storage = options.storage || makeStorage();
  const elements = new Map();
  for (const id of IDS) elements.set(id, new FakeElement(id));
  const actions = COMMANDS.map((cmd) => {
    const button = new FakeElement("");
    button.dataset.cmd = cmd;
    return button;
  });
  const document = {
    body: new FakeElement("body"),
    getElementById(id) { return elements.get(id) || null; },
    querySelectorAll(selector) {
      if (selector === "button[data-cmd]") return actions;
      throw new Error("unsupported selector: " + selector);
    },
    querySelector(selector) {
      const match = /^button\[data-cmd="([^"]+)"\]$/.exec(selector);
      if (match) return actions.find((button) => button.dataset.cmd === match[1]) || null;
      throw new Error("unsupported selector: " + selector);
    },
    createElement(tag) { return new FakeElement(tag); },
    addEventListener(type, fn) {
      if (!docListeners.has(type)) docListeners.set(type, []);
      docListeners.get(type).push(fn);
    },
  };
  const docListeners = new Map();
  const progressFns = [];
  const warningFns = [];
  const runCalls = [];
  const envelopes = [];
  const window = {
    prompt: () => null,
    localStorage: storage,
    addEventListener(type, fn) {
      if (!docListeners.has(type)) docListeners.set(type, []);
      docListeners.get(type).push(fn);
    },
    yakusha: {
      run: async (...args) => {
        runCalls.push(args);
        return envelopes.length > 0 ? envelopes.shift() : { ok: true, outcome: "ok" };
      },
      hasApiKey: async () => false,
      cancel: () => {},
      onProgress: (fn) => { progressFns.push(fn); },
      onWarning: (fn) => { warningFns.push(fn); },
      saveApiKey: async () => ({ saved: true }),
      clearApiKey: async () => ({}),
      loadDictionary: async () => ({ ok: true, entries: [], translated: 0, pendingCount: 0 }),
      saveEntry: async () => ({ ok: true, translated: 0, pendingCount: 0 }),
      pickDirectory: async () => null,
      pathForFile: () => "",
      resolveInput: async (value) => ({ input: value, path: value, kind: "directory" }),
      logPath: async () => "C:/logs/yakusha/gui.log",
      openLog: async () => ({ ok: true, path: "C:/logs/yakusha/gui.log" }),
      logTail: async () => ({ ok: true, path: "C:/logs/yakusha/gui.log", lines: [] }),
      listModels: async () => ({ ok: true, models: [] }),
      projectState: async () => ({ ok: true, dictionary: { translated: 0, pending: 0, total: 0 }, native: { installed: false, intact: true } }),
    },
  };
  const context = vm.createContext({
    window, document, console, JSON, Math, Object, Array, String, Promise, Date,
    Number, Boolean, Error, RegExp, URL, setTimeout, clearTimeout, localStorage: storage,
  });
  vm.runInContext(fs.readFileSync(DELIVERY, "utf8"), context, { filename: "delivery.js" });
  vm.runInContext(fs.readFileSync(RECENT, "utf8"), context, { filename: "recent.js" });
  vm.runInContext(fs.readFileSync(RENDERER, "utf8"), context, { filename: "renderer.js" });
  return { elements, actions, runCalls, envelopes, document, window, storage, docListeners, progressFns, warningFns };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

function action(dom, command) {
  const button = dom.actions.find((item) => item.dataset.cmd === command);
  assert.ok(button, "missing action button: " + command);
  return button;
}

async function scan(dom, envelope) {
  dom.envelopes.push(envelope);
  await action(dom, "scan").click();
  await flush();
}

test("scan success shows the engine and enables the install path", async () => {
  const dom = makeDom();
  await scan(dom, {
    ok: true, outcome: "ok", engine: "rgss", engineVersion: "3",
    root: "C:/games/alpha", gameTitle: "Alpha",
    capabilities: { runtime: "inject", launch: true },
  });
  assert.equal(dom.elements.get("engine-badge").hidden, false);
  assert.equal(dom.elements.get("engine-badge").textContent, "rgss 3");
  assert.equal(dom.elements.get("project-line").textContent, "Project root: C:/games/alpha — Alpha");
  const install = action(dom, "install");
  assert.equal(install.disabled, false);
  assert.equal(install.title, "");
  await install.click();
  const call = dom.runCalls.at(-1);
  assert.equal(call[0], "install");
  assert.deepEqual({ ...call[2] }, {});
});

test("successful scans fill the recent row and a chip scans that folder again", async () => {
  const storage = makeStorage();
  const dom = makeDom({ storage });
  await scan(dom, {
    ok: true, outcome: "ok", engine: "mz", root: "C:/games/alpha", gameTitle: "Alpha",
    capabilities: { runtime: "plugin", launch: true },
  });
  const row = dom.elements.get("recent");
  const list = dom.elements.get("recent-list");
  assert.equal(row.hidden, false);
  assert.equal(list.children.length, 1);
  assert.equal(list.children[0].children[0].textContent, "Alpha");
  assert.equal(list.children[0].children[1].textContent, "mz");

  await scan(dom, {
    ok: true, outcome: "ok", engine: "mv", root: "C:/games/beta", gameTitle: "Beta",
    capabilities: { runtime: "plugin", launch: true },
  });
  assert.equal(list.children.length, 2);
  assert.equal(list.children[0].children[0].textContent, "Beta");

  dom.envelopes.push({
    ok: true, outcome: "ok", engine: "mz", root: "C:/games/alpha", gameTitle: "Alpha",
    capabilities: { runtime: "plugin", launch: true },
  });
  await list.children[1].click();
  await flush();
  assert.equal(dom.runCalls.at(-1)[0], "scan");
  assert.deepEqual([...dom.runCalls.at(-1)[1]], ["C:/games/alpha"]);
  assert.equal(dom.elements.get("project-line").textContent, "Project root: C:/games/alpha — Alpha");
});

test("a failed scan never enters the recent row", async () => {
  const storage = makeStorage();
  const dom = makeDom({ storage });
  await scan(dom, { ok: false, outcome: "error", error: { code: "E_NOT_PROJECT", message: "no game" } });
  assert.equal(dom.elements.get("recent").hidden, true);
  assert.equal(dom.elements.get("recent-list").children.length, 0);
});

test("scan success follows capability flags for install and launch", async () => {
  const dom = makeDom();
  await scan(dom, {
    ok: true, outcome: "ok", engine: "krkr", root: "C:/games/beta", gameTitle: "Beta",
    capabilities: { runtime: null, launch: false },
  });
  const install = action(dom, "install");
  const uninstall = action(dom, "uninstall");
  const launch = dom.elements.get("launch-run");
  assert.equal(install.disabled, true);
  assert.match(install.title, /no delivery layer yet/);
  assert.equal(uninstall.disabled, true);
  assert.match(uninstall.title, /no delivery layer yet/);
  assert.equal(launch.disabled, true);
  assert.equal(launch.title, "this engine cannot be launched from yakusha");
});

test("scan explains the delivery layer for every runtime value", async () => {
  const cases = [
    { runtime: "plugin", tier: "L4-plugin", title: "Plugin layer", caution: true },
    { runtime: "translation", tier: "L4-resource", title: "Translation resource", caution: false },
    { runtime: "inject", tier: "L4-inject", title: "Native components", caution: true },
    { runtime: "patch", tier: "L4-patch", title: "Overlay archive", caution: false },
    { runtime: null, tier: "L3-only", title: "No delivery layer", caution: false },
  ];
  for (const item of cases) {
    const dom = makeDom();
    await scan(dom, {
      ok: true, outcome: "ok", engine: "probe", root: "C:/games/delivery", gameTitle: "Delivery",
      capabilities: { runtime: item.runtime, launch: true },
    });
    const card = dom.elements.get("delivery");
    assert.equal(card.hidden, false, item.tier + " card should be visible");
    assert.equal(dom.elements.get("delivery-tier").textContent, item.tier);
    assert.equal(dom.elements.get("delivery-title").textContent, item.title);
    assert.ok(dom.elements.get("delivery-copy").textContent.length > 0);
    assert.equal(dom.elements.get("delivery-caution").hidden, !item.caution, item.tier + " caution visibility");
  }
});

test("scan without capabilities falls back to L3-only and a failed scan keeps the last project", async () => {
  const dom = makeDom();
  await scan(dom, { ok: true, outcome: "ok", engine: "unknown", root: "C:/games/unknown", gameTitle: "Unknown" });
  assert.equal(dom.elements.get("delivery").hidden, false);
  assert.equal(dom.elements.get("delivery-tier").textContent, "L3-only");
  await scan(dom, { ok: false, outcome: "error", error: { code: "E_NOT_PROJECT", message: "no game" } });
  assert.equal(dom.elements.get("delivery").hidden, false, "a failed scan must not erase the visible project");
  assert.equal(dom.elements.get("project-line").textContent, "Project root: C:/games/unknown — Unknown");
  assert.equal(dom.elements.get("project-state").textContent, "Scan failed — previous project kept");
});

test("scan E_MULTI_ROOT explains where to pick the project", async () => {
  const dom = makeDom();
  await scan(dom, {
    ok: false, outcome: "error",
    error: { code: "E_MULTI_ROOT", message: "found 2 projects", details: { candidates: ["a", "b"] } },
  });
  assert.equal(
    dom.elements.get("project-line").textContent,
    "multiple projects found — see details.candidates in the output",
  );
});

test("a failed scan keeps the previous project and its capability bits", async () => {
  const dom = makeDom();
  await scan(dom, {
    ok: true, outcome: "ok", engine: "rgss", root: "C:/games/alpha", gameTitle: "Alpha",
    capabilities: { runtime: "inject", launch: true },
  });
  assert.equal(action(dom, "install").disabled, false);

  // A failed scan is an event, not a project replacement: the user keeps the
  // working project and can still install or launch it.
  await scan(dom, { ok: false, outcome: "error", error: { code: "E_NOT_PROJECT", message: "no game" } });
  assert.equal(action(dom, "install").disabled, false);
  assert.equal(dom.elements.get("engine-badge").hidden, false);
  assert.equal(dom.elements.get("engine-badge").textContent, "rgss");
  await action(dom, "install").click();
  const call = dom.runCalls.at(-1);
  assert.deepEqual({ ...call[2] }, {});
});

test("the dictionary editor lists pending keys and opens the editor", async () => {
  const dom = makeDom();
  dom.window.yakusha.pickDirectory = async () => "C:/games/alpha";
  dom.envelopes.push({
    ok: true, outcome: "ok", engine: "mz", root: "C:/games/alpha", gameTitle: "Alpha",
    capabilities: { runtime: "plugin", launch: true },
  });
  await dom.elements.get("pick").click();
  await flush();
  dom.window.yakusha.loadDictionary = async () => ({
    ok: true, translated: 1, pendingCount: 2,
    entries: [
      { key: "Second line", pending: true },
      { key: "Third line", pending: true },
      { key: "Done", pending: false },
    ],
  });
  await dom.elements.get("dict-load").click();
  await flush();
  assert.equal(
    dom.elements.get("dict-summary").textContent,
    "1 translated, 2 pending (3 keys) — showing the first 2 pending",
  );
  const select = dom.elements.get("dict-key");
  assert.equal(select.children.length, 2);
  assert.equal(select.children[0].value, "Second line");
  assert.equal(select.hidden, false);
  assert.equal(dom.elements.get("dict-text").hidden, false);
  assert.equal(dom.elements.get("dict-save").hidden, false);
});

test("remembering a key sends it once and clears the input", async () => {
  const dom = makeDom();
  let saved = null;
  dom.window.yakusha.saveApiKey = async (key) => { saved = key; return { saved: true }; };
  dom.elements.get("key-input").value = "sk-example";
  await dom.elements.get("key-save").click();
  assert.equal(saved, "sk-example");
  assert.equal(dom.elements.get("key-input").value, "");
  assert.equal(dom.elements.get("key-state").textContent, "key stored (encrypted)");
});

test("the stage band follows the same state as the current task", async () => {
  const dom = makeDom();
  assert.equal(dom.elements.get("stage-prepare-status").textContent, "Now");
  assert.equal(dom.elements.get("stage-translate-status").textContent, "Later");
  assert.equal(dom.elements.get("stage-deliver-status").textContent, "Later");
  await scan(dom, {
    ok: true, outcome: "ok", engine: "mz", root: "C:/games/alpha", gameTitle: "Alpha",
    capabilities: { runtime: "plugin", launch: true },
  });
  assert.equal(dom.elements.get("stage-prepare-status").textContent, "Done");
  assert.equal(dom.elements.get("stage-translate-status").textContent, "Now");
  assert.equal(dom.elements.get("stage-deliver-status").textContent, "Later");
});

test("config load fills the provider form and hides the setup banner", async () => {
  const dom = makeDom();
  dom.envelopes.push({
    ok: true, outcome: "ok", action: "list", file: "C:/cfg/config.json", exists: true,
    values: {
      provider: { value: "openai", source: "file" },
      model: { value: "gpt-4.1-mini", source: "file" },
      baseUrl: { value: "https://api.example.test/v1", source: "file" },
    },
    apiKey: { set: false, source: null },
  });
  await action(dom, "config").click();
  await flush();
  assert.equal(dom.elements.get("config-provider").value, "openai");
  assert.equal(dom.elements.get("config-model").value, "gpt-4.1-mini");
  assert.equal(dom.elements.get("config-base-url").value, "https://api.example.test/v1");
  assert.equal(dom.elements.get("service-banner").hidden, true);
  assert.match(dom.elements.get("config-summary").textContent, /provider: openai \(file\)/);
});

test("saving the service writes provider, model and base URL, then reloads", async () => {
  const dom = makeDom();
  dom.elements.get("config-provider").value = "compatible";
  dom.elements.get("config-model").value = "local-model";
  dom.elements.get("config-base-url").value = "http://127.0.0.1:8080/v1";
  dom.envelopes.push(
    { ok: true, outcome: "ok", action: "set", key: "provider", value: "compatible" },
    { ok: true, outcome: "ok", action: "set", key: "apiFormat", value: "chat-completions" },
    { ok: true, outcome: "ok", action: "set", key: "baseUrl", value: "http://127.0.0.1:8080/v1" },
    { ok: true, outcome: "ok", action: "set", key: "model", value: "local-model" },
    { ok: true, outcome: "ok", action: "list", values: {
      provider: { value: "compatible", source: "file" },
      apiFormat: { value: "chat-completions", source: "default" },
      model: { value: "local-model", source: "file" },
      baseUrl: { value: "http://127.0.0.1:8080/v1", source: "file" },
    }, apiKey: { set: true, source: "file" } },
  );
  await dom.elements.get("config-save").click();
  await flush();
  const calls = dom.runCalls.filter((call) => call[0] === "config");
  assert.deepEqual(calls.map((call) => [...call[1]]), [
    ["set", "provider", "compatible"],
    ["set", "apiFormat", "chat-completions"],
    ["set", "baseUrl", "http://127.0.0.1:8080/v1"],
    ["set", "model", "local-model"],
    ["list"],
  ]);
  assert.equal(dom.elements.get("config-state").textContent, "Service saved");
  assert.equal(dom.elements.get("service-banner").hidden, true);
});

test("clearing the service unsets every service field and restores the banner", async () => {
  const dom = makeDom();
  dom.elements.get("config-provider").value = "openai";
  dom.elements.get("config-model").value = "gpt-4.1-mini";
  dom.elements.get("config-base-url").value = "https://api.example.test/v1";
  dom.envelopes.push(
    { ok: true, outcome: "ok", action: "unset", key: "provider" },
    { ok: true, outcome: "ok", action: "unset", key: "model" },
    { ok: true, outcome: "ok", action: "unset", key: "baseUrl" },
    { ok: true, outcome: "ok", action: "unset", key: "apiFormat" },
  );
  await dom.elements.get("config-clear").click();
  await flush();
  const calls = dom.runCalls.filter((call) => call[0] === "config");
  assert.deepEqual(calls.map((call) => [...call[1]]), [
    ["unset", "provider"],
    ["unset", "model"],
    ["unset", "baseUrl"],
    ["unset", "apiFormat"],
  ]);
  assert.equal(dom.elements.get("config-provider").value, "");
  assert.equal(dom.elements.get("config-model").value, "");
  assert.equal(dom.elements.get("config-base-url").value, "");
  assert.equal(dom.elements.get("config-state").textContent, "Service cleared");
  assert.equal(dom.elements.get("service-banner").hidden, false);
  assert.match(dom.elements.get("config-summary").textContent, /^No service configured/);
});

test("a missing configuration opens the setup banner instead of failing silently", async () => {
  const dom = makeDom();
  dom.envelopes.push({
    ok: false, outcome: "error", error: { code: "E_CONFIG", message: "provider is not configured" },
  });
  await action(dom, "translate").click();
  await flush();
  assert.equal(dom.elements.get("service-banner").hidden, false);
  const toast = dom.elements.get("toasts").children.at(-1);
  assert.match(toast.textContent, /E_CONFIG/);
});

test("every id the renderer looks up exists in the page", () => {
  const html = fs.readFileSync(path.join(ROOT, "gui", "renderer", "index.html"), "utf8");
  const source = fs.readFileSync(RENDERER, "utf8");
  const ids = new Set([...source.matchAll(/\$\("([^"]+)"\)/g)].map((match) => match[1]));
  assert.ok(ids.size > 0);
  for (const id of ids) {
    assert.match(html, new RegExp('id="' + id + '"'), "index.html is missing #" + id);
  }
});

test("the page has four workspace pages, settings tabs and no SmartScreen note", () => {
  const html = fs.readFileSync(path.join(ROOT, "gui", "renderer", "index.html"), "utf8");
  assert.match(html, /id="nav-overview"/);
  assert.match(html, /id="page-workflow"/);
  assert.match(html, /id="tab-glossary"/);
  assert.match(html, /id="log-toggle"/);
  assert.doesNotMatch(html, /SmartScreen|SHA256SUMS/);
});

test("the imported project card owns both launch actions", () => {
  const html = fs.readFileSync(path.join(ROOT, "gui", "renderer", "index.html"), "utf8");
  const start = html.indexOf('id="project"');
  const end = html.indexOf('id="actions"');
  assert.ok(start > 0 && end > start);
  const card = html.slice(start, end);
  assert.match(card, /id="launch-original"/);
  assert.match(card, /id="launch-translated"/);
});

test("the workspace rail collapses, swaps its glyph and remembers the choice", async () => {
  const storage = makeStorage();
  const dom = makeDom({ storage });
  const toggle = dom.elements.get("rail-toggle");
  assert.equal(dom.document.body.classList.contains("rail-collapsed"), false);
  assert.equal(dom.elements.get("rail-toggle-icon").textContent, "«");
  await toggle.click();
  assert.equal(dom.document.body.classList.contains("rail-collapsed"), true);
  assert.equal(dom.elements.get("rail-toggle-icon").textContent, "»");
  assert.equal(storage.getItem("yakusha.rail.collapsed"), "1");

  const restored = makeDom({ storage });
  assert.equal(restored.document.body.classList.contains("rail-collapsed"), true);
  assert.equal(restored.elements.get("rail-toggle-icon").textContent, "»");
  await restored.elements.get("rail-toggle").click();
  assert.equal(restored.document.body.classList.contains("rail-collapsed"), false);
  assert.equal(storage.getItem("yakusha.rail.collapsed"), "0");
});

test("a folder dropped on the window scans it through pathForFile", async () => {
  const dom = makeDom();
  const dropped = { name: "game" };
  const seen = [];
  dom.window.yakusha.pathForFile = (file) => { seen.push(file); return "D:/games/dropped"; };
  dom.window.yakusha.resolveInput = async (value) => ({ input: value, path: value, kind: "directory" });
  dom.envelopes.push({
    ok: true, outcome: "ok", engine: "mv", root: "D:/games/dropped", gameTitle: "Dropped",
    capabilities: { runtime: "plugin", launch: true },
  });
  for (const fn of dom.docListeners.get("drop") || []) {
    await fn({ preventDefault() {}, dataTransfer: { files: [dropped] } });
  }
  await flush();
  assert.deepEqual(seen, [dropped]);
  const call = dom.runCalls.at(-1);
  assert.equal(call[0], "scan");
  assert.deepEqual([...call[1]], ["D:/games/dropped"]);
  assert.equal(dom.elements.get("project-input").textContent, "Selected folder: D:/games/dropped");
  assert.equal(dom.elements.get("project-line").textContent, "Project root: D:/games/dropped — Dropped");
});

test("a game exe dropped on the window scans its containing folder", async () => {
  const dom = makeDom();
  const dropped = { name: "Game.exe" };
  const seen = [];
  dom.window.yakusha.pathForFile = (file) => { seen.push(file); return "D:/games/picked/Game.exe"; };
  dom.window.yakusha.resolveInput = async (value) => ({
    input: value, path: "D:/games/picked", kind: "file",
  });
  dom.envelopes.push({
    ok: true, outcome: "ok", engine: "mv", root: "D:/games/picked/www", gameTitle: "Picked",
    capabilities: { runtime: "plugin", launch: true },
  });
  for (const fn of dom.docListeners.get("drop") || []) {
    await fn({ preventDefault() {}, dataTransfer: { files: [dropped] } });
  }
  await flush();
  assert.deepEqual(seen, [dropped]);
  const call = dom.runCalls.at(-1);
  assert.equal(call[0], "scan");
  assert.deepEqual([...call[1]], ["D:/games/picked"]);
  assert.equal(dom.elements.get("project-input").textContent, "Selected file: D:/games/picked/Game.exe");
  assert.equal(dom.elements.get("project-line").textContent, "Project root: D:/games/picked/www — Picked");

  // The recent chip must remember both paths: the file the user chose and the
  // folder the scan actually reads.
  dom.envelopes.push({
    ok: true, outcome: "ok", engine: "mv", root: "D:/games/picked/www", gameTitle: "Picked",
    capabilities: { runtime: "plugin", launch: true },
  });
  await dom.elements.get("recent-list").children[0].click();
  await flush();
  assert.deepEqual([...dom.runCalls.at(-1)[1]], ["D:/games/picked"]);
  assert.equal(dom.elements.get("project-input").textContent, "Selected file: D:/games/picked/Game.exe");

  // A bare Scan button rescans the project root but must not replace the
  // file the user originally dropped in the Selected line.
  dom.envelopes.push({
    ok: true, outcome: "ok", engine: "mv", root: "D:/games/picked/www", gameTitle: "Picked",
    capabilities: { runtime: "plugin", launch: true },
  });
  await action(dom, "scan").click();
  await flush();
  assert.deepEqual([...dom.runCalls.at(-1)[1]], ["D:/games/picked/www"]);
  assert.equal(dom.elements.get("project-input").textContent, "Selected file: D:/games/picked/Game.exe");
});

test("a drop without files is ignored", async () => {
  const dom = makeDom();
  for (const fn of dom.docListeners.get("drop") || []) {
    await fn({ preventDefault() {}, dataTransfer: { files: [] } });
    await fn({ preventDefault() {} });
  }
  await flush();
  assert.equal(dom.runCalls.length, 0);
  assert.equal(dom.document.body.classList.has("dragging"), false);
});

test("dragover and dragleave toggle the dragging hint", async () => {
  const dom = makeDom();
  for (const fn of dom.docListeners.get("dragover") || []) await fn({ preventDefault() {} });
  assert.equal(dom.document.body.classList.has("dragging"), true);
  for (const fn of dom.docListeners.get("dragleave") || []) await fn({ preventDefault() {} });
  assert.equal(dom.document.body.classList.has("dragging"), false);
});

test("nested dragenter events keep the drop hint until the pointer leaves", async () => {
  const dom = makeDom();
  const fire = async (type) => {
    for (const fn of dom.docListeners.get(type) || []) await fn({ preventDefault() {} });
  };
  await fire("dragenter");
  await fire("dragenter");
  await fire("dragleave");
  assert.equal(dom.document.body.classList.has("dragging"), true);
  await fire("dragleave");
  assert.equal(dom.document.body.classList.has("dragging"), false);
});

test("a drop without a File falls back to its file URI", async () => {
  const dom = makeDom();
  const seen = [];
  dom.window.yakusha.pathForFile = () => "";
  dom.window.yakusha.resolveInput = async (value) => {
    seen.push(value);
    return { input: value, path: value, kind: "file" };
  };
  dom.envelopes.push({
    ok: true, outcome: "ok", engine: "mv", root: "C:/games/Alpha Game", gameTitle: "Alpha",
    capabilities: { runtime: "plugin", launch: true },
  });
  const transfer = {
    files: [],
    getData(type) {
      return type === "text/uri-list" ? "file:///C:/games/Alpha%20Game/Game.exe" : "";
    },
  };
  for (const fn of dom.docListeners.get("drop") || []) await fn({ preventDefault() {}, dataTransfer: transfer });
  await flush();
  assert.deepEqual(seen, ["C:\\games\\Alpha Game\\Game.exe"]);
  assert.deepEqual([...dom.runCalls.at(-1)[1]], ["C:\\games\\Alpha Game\\Game.exe"]);
});

test("the picker scans the chosen directory and a canceled picker does nothing", async () => {
  const dom = makeDom();
  dom.window.yakusha.pickDirectory = async () => "C:/games/picked";
  dom.envelopes.push({
    ok: true, outcome: "ok", engine: "mz", root: "C:/games/picked", gameTitle: "Picked",
    capabilities: { runtime: "plugin", launch: true },
  });
  await dom.elements.get("pick").click();
  await flush();
  assert.deepEqual([...dom.runCalls.at(-1)[1]], ["C:/games/picked"]);
  assert.equal(dom.elements.get("project-input").textContent, "Selected folder: C:/games/picked");
  assert.equal(dom.elements.get("project-line").textContent, "Project root: C:/games/picked — Picked");
  dom.window.yakusha.pickDirectory = async () => null;
  await dom.elements.get("pick").click();
  await flush();
  assert.equal(dom.runCalls.length, 1);
});

test("the cancel button forwards to the host", async () => {
  const dom = makeDom();
  let canceled = 0;
  dom.window.yakusha.cancel = () => { canceled += 1; };
  await dom.elements.get("cancel").click();
  assert.equal(canceled, 1);
});

test("progress updates the bar and stale run ids are ignored", async () => {
  const dom = makeDom();
  await scan(dom, {
    ok: true, outcome: "ok", engine: "mz", root: "C:/games/alpha", gameTitle: "Alpha",
    capabilities: { runtime: "plugin", launch: true },
  });
  assert.equal(dom.progressFns.length, 1);
  const progress = dom.elements.get("progress");
  const fire = (event) => dom.progressFns[0](event);
  await fire({ runId: 1, progress: { done: 5, total: 10, translated: 4 } });
  assert.equal(progress.hidden, false);
  assert.equal(dom.elements.get("bar-fill").style.width, "50%");
  assert.equal(dom.elements.get("progress-text").textContent, "5/10 entries, 4 translated");
  await fire({ runId: 99, progress: { done: 9, total: 10, translated: 9 } });
  assert.equal(dom.elements.get("bar-fill").style.width, "50%");
  // A new run invalidates the old id; the new id is accepted again.
  await scan(dom, {
    ok: true, outcome: "ok", engine: "mv", root: "C:/games/beta", gameTitle: "Beta",
    capabilities: { runtime: "plugin", launch: true },
  });
  assert.equal(progress.hidden, true);
  await fire({ runId: 1, progress: { done: 9, total: 10, translated: 9 } });
  assert.equal(progress.hidden, true);
  await fire({ runId: 2, progress: { done: 3, total: 6, translated: 2 } });
  assert.equal(dom.elements.get("bar-fill").style.width, "50%");
  assert.equal(dom.elements.get("progress-text").textContent, "3/6 entries, 2 translated");
});

test("warning lines become warning toasts", async () => {
  const dom = makeDom();
  await scan(dom, {
    ok: true, outcome: "ok", engine: "mz", root: "C:/games/alpha", gameTitle: "Alpha",
    capabilities: { runtime: "plugin", launch: true },
  });
  assert.equal(dom.warningFns.length, 1);
  const stack = dom.elements.get("toasts");
  const before = stack.children.length;
  dom.warningFns[0]({ line: "warn: glossary miss" });
  assert.equal(stack.children.length, before + 1);
  const toast = stack.children.at(-1);
  assert.match(toast.className, /toast-warning/);
  assert.match(toast.textContent, /^Warning — warn: glossary miss/);
});

test("a command shows its result as one short toast instead of the raw envelope", async () => {
  const dom = makeDom();
  dom.envelopes.push({
    ok: true, outcome: "ok", translated: 10, total: 20, pending: 10,
  });
  await action(dom, "translate").click();
  await flush();
  const stack = dom.elements.get("toasts");
  assert.equal(stack.children.length, 1);
  const toast = stack.children[0];
  assert.match(toast.className, /toast-success/);
  assert.equal(toast.textContent, "Translate — 10/20 translated · 10 pending");
  assert.equal(dom.elements.has("payload"), false);
});

test("a failed command turns the toast into the error code and message", async () => {
  const dom = makeDom();
  dom.envelopes.push({
    ok: false, outcome: "error",
    error: { code: "E_EXTRACT", message: "the data folder is missing" },
  });
  await action(dom, "extract").click();
  await flush();
  const toast = dom.elements.get("toasts").children.at(-1);
  assert.match(toast.className, /toast-error/);
  assert.equal(toast.textContent, "Extract — E_EXTRACT · the data folder is missing");
});

test("the log panel shows the host log path and opens it", async () => {
  const dom = makeDom();
  await flush();
  assert.equal(dom.elements.get("log-summary").textContent, "Detailed output: C:/logs/yakusha/gui.log");
  let opened = 0;
  dom.window.yakusha.openLog = async () => { opened += 1; return { ok: true, path: "C:/logs/yakusha/gui.log" }; };
  await dom.elements.get("log-open").click();
  assert.equal(opened, 1);
});

test("translate and verify send the source language explicitly, ja by default", async () => {
  const dom = makeDom();
  assert.equal(dom.elements.get("source-lang").value, "");
  dom.envelopes.push({ ok: true, outcome: "ok", translated: 2, total: 4, pending: 2 });
  await action(dom, "translate").click();
  await flush();
  let call = dom.runCalls.at(-1);
  assert.equal(call[0], "translate");
  assert.deepEqual({ ...call[2] }, { "source-lang": "ja" });
  dom.envelopes.push({ ok: true, outcome: "ok" });
  await action(dom, "verify").click();
  await flush();
  call = dom.runCalls.at(-1);
  assert.equal(call[0], "verify");
  assert.deepEqual({ ...call[2] }, { "source-lang": "ja" });
});

test("switching the source language to English reaches translate and verify only", async () => {
  const dom = makeDom();
  dom.elements.get("source-lang").value = "en";
  dom.envelopes.push({ ok: true, outcome: "ok", translated: 0, total: 0, pending: 0 });
  await action(dom, "translate").click();
  await flush();
  assert.deepEqual({ ...dom.runCalls.at(-1)[2] }, { "source-lang": "en" });
  dom.envelopes.push({ ok: true, outcome: "ok" });
  await action(dom, "verify").click();
  await flush();
  assert.deepEqual({ ...dom.runCalls.at(-1)[2] }, { "source-lang": "en" });
  // Commands without a source language keep an empty flag set.
  await scan(dom, {
    ok: true, outcome: "ok", engine: "mz", root: "C:/games/alpha", gameTitle: "Alpha",
    capabilities: { runtime: "plugin", launch: true },
  });
  assert.deepEqual({ ...dom.runCalls.at(-1)[2] }, {});
});

test("the rail switches between independent pages and settings tabs", async () => {
  const dom = makeDom();
  assert.equal(dom.elements.get("page-overview").hidden, false);
  assert.equal(dom.elements.get("page-settings").hidden, true);
  await dom.elements.get("nav-workflow").click();
  assert.equal(dom.elements.get("page-workflow").hidden, false);
  assert.equal(dom.elements.get("page-overview").hidden, true);
  assert.equal(dom.elements.get("nav-workflow").classList.has("is-active"), true);
  await dom.elements.get("nav-settings").click();
  assert.equal(dom.elements.get("page-settings").hidden, false);
  assert.equal(dom.elements.get("settings-service").hidden, false);
  assert.equal(dom.elements.get("settings-glossary").hidden, true);
  await dom.elements.get("tab-glossary").click();
  assert.equal(dom.elements.get("settings-glossary").hidden, false);
  assert.equal(dom.elements.get("settings-service").hidden, true);
  assert.equal(dom.elements.get("tab-glossary").classList.has("is-active"), true);
});

test("fetch models lists clickable models and fills the model field", async () => {
  const dom = makeDom();
  dom.elements.get("config-provider").value = "compatible";
  dom.elements.get("config-base-url").value = "http://127.0.0.1:8080/v1";
  dom.window.yakusha.listModels = async (request) => {
    dom.modelRequest = request;
    return { ok: true, models: ["model-a", "model-b"] };
  };
  await dom.elements.get("config-query-models").click();
  await flush();
  assert.deepEqual({ ...dom.modelRequest }, { provider: "compatible", baseUrl: "http://127.0.0.1:8080/v1" });
  const list = dom.elements.get("config-model-list");
  assert.equal(list.hidden, false);
  assert.equal(list.children.length, 2);
  assert.equal(list.children[0].textContent, "model-a");
  assert.match(dom.elements.get("config-model-status").textContent, /2 models available/);
  await list.children[1].click();
  assert.equal(dom.elements.get("config-model").value, "model-b");
  assert.equal(list.children[1].classList.has("is-selected"), true);
  assert.equal(dom.elements.get("config-model-status").textContent, "Selected model-b");
});

test("mock model listing works without a base URL", async () => {
  const dom = makeDom();
  dom.elements.get("config-provider").value = "mock";
  dom.window.yakusha.listModels = async () => ({ ok: true, models: ["mock"] });
  await dom.elements.get("config-query-models").click();
  await flush();
  assert.equal(dom.elements.get("config-model-list").children.length, 1);
  assert.equal(dom.elements.get("config-model-list").children[0].textContent, "mock");
});

test("RGSS shows original and translated launch buttons and gates the translated one", async () => {
  const dom = makeDom();
  dom.window.yakusha.projectState = async () => ({
    ok: true, dictionary: { translated: 0, pending: 3, total: 3 }, native: { installed: false, intact: true },
  });
  await scan(dom, {
    ok: true, outcome: "ok", engine: "rgss", engineVersion: "3",
    root: "C:/games/alpha", gameTitle: "Alpha",
    capabilities: { runtime: "inject", launch: true },
  });
  assert.equal(dom.elements.get("launch-run").hidden, true);
  assert.equal(dom.elements.get("launch-original").hidden, false);
  assert.equal(dom.elements.get("launch-translated").hidden, false);
  assert.equal(dom.elements.get("launch-original").disabled, false);
  assert.equal(dom.elements.get("launch-translated").disabled, true);
  assert.equal(dom.elements.get("launch-translated").title, "游戏未进行翻译");

  dom.window.yakusha.projectState = async () => ({
    ok: true, dictionary: { translated: 2, pending: 1, total: 3 }, native: { installed: true, intact: true },
  });
  await scan(dom, {
    ok: true, outcome: "ok", engine: "rgss", engineVersion: "3",
    root: "C:/games/alpha", gameTitle: "Alpha",
    capabilities: { runtime: "inject", launch: true },
  });
  assert.equal(dom.elements.get("launch-translated").disabled, false);
  assert.equal(dom.elements.get("launch-translated").title, "");
  await dom.elements.get("launch-original").click();
  await flush();
  assert.deepEqual({ ...dom.runCalls.at(-1)[2] }, { original: true });
  await dom.elements.get("launch-translated").click();
  await flush();
  assert.deepEqual({ ...dom.runCalls.at(-1)[2] }, {});
});

test("a non-RGSS engine keeps a single launch button", async () => {
  const dom = makeDom();
  await scan(dom, {
    ok: true, outcome: "ok", engine: "mz", root: "C:/games/alpha", gameTitle: "Alpha",
    capabilities: { runtime: "plugin", launch: true },
  });
  assert.equal(dom.elements.get("launch-run").hidden, false);
  assert.equal(dom.elements.get("launch-original").hidden, true);
  assert.equal(dom.elements.get("launch-translated").hidden, true);
  assert.equal(dom.elements.get("launch-run").disabled, false);
});

test("verify findings do not mark the project ready to install", async () => {
  const dom = makeDom();
  await scan(dom, {
    ok: true, outcome: "ok", engine: "mz", root: "C:/games/alpha", gameTitle: "Alpha",
    capabilities: { runtime: "plugin", launch: true },
  });
  dom.envelopes.push({
    ok: true, outcome: "findings", translated: 2, total: 4, pending: 2, errors: 2, warnings: 0,
    counts: { codes: 2 }, problems: [],
  });
  await action(dom, "verify").click();
  await flush();
  assert.equal(dom.elements.get("primary-action").dataset.action, "extract");
  assert.match(dom.elements.get("task-state").textContent, /In progress/);
});

test("the bottom log toggle fetches and renders log lines", async () => {
  const dom = makeDom();
  dom.window.yakusha.logTail = async (request) => {
    assert.deepEqual({ ...request }, { limit: 200 });
    return { ok: true, path: "C:/logs/yakusha/gui.log", lines: ["one", { time: "2026-11-16T10:00:00.000Z", event: "run.start", command: "scan" }, JSON.stringify({ time: "2026-11-16T10:00:01.000Z", event: "run.result", command: "scan", outcome: "ok" })] };
  };
  await dom.elements.get("log-toggle").click();
  await flush();
  assert.equal(dom.elements.get("log-dock").hidden, false);
  assert.equal(dom.elements.get("log-lines").children.length, 3);
  assert.equal(dom.elements.get("log-lines").children[0].textContent, "one");
  assert.match(dom.elements.get("log-lines").children[1].textContent, /10:00:00 · run.start · scan/);
  assert.match(dom.elements.get("log-lines").children[2].textContent, /10:00:01 · run.result · scan · ok/);
  assert.equal(dom.elements.get("log-lines").children[2].dataset.event, "run.result");
  assert.equal(dom.elements.get("log-count").textContent, "3");
  await dom.elements.get("log-close").click();
  assert.equal(dom.elements.get("log-dock").hidden, true);
});