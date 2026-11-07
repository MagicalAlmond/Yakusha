import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RENDERER = path.join(ROOT, "gui", "renderer", "renderer.js");

const IDS = [
  "project-line", "engine-badge", "pick", "launch-run", "cancel", "progress",
  "bar-fill", "progress-text", "dict-load", "dict-summary", "dict-key",
  "dict-text", "dict-save", "import-run", "config-summary", "key-input",
  "key-save", "key-clear", "key-use", "key-state", "payload",
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
  appendChild(child) { this.children.push(child); }
  set innerHTML(value) { this._innerHTML = value; if (value === "") this.children = []; }
  get innerHTML() { return this._innerHTML; }
}

function makeDom() {
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
    },
  };
  const context = vm.createContext({
    window, document, console, JSON, Math, Object, Array, String, Promise, Date,
    Number, Boolean, Error, RegExp, setTimeout, clearTimeout,
  });
  vm.runInContext(fs.readFileSync(RENDERER, "utf8"), context, { filename: "renderer.js" });
  return { elements, actions, runCalls, envelopes, document, window, docListeners, progressFns, warningFns };
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
  assert.equal(dom.elements.get("project-line").textContent, "C:/games/alpha — Alpha");
  const install = action(dom, "install");
  assert.equal(install.disabled, false);
  assert.equal(install.title, "");
  await install.click();
  const call = dom.runCalls.at(-1);
  assert.equal(call[0], "install");
  assert.deepEqual({ ...call[2] }, {});
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

test("a new scan resets the previous engine before the result arrives", async () => {
  const dom = makeDom();
  await scan(dom, {
    ok: true, outcome: "ok", engine: "rgss", root: "C:/games/alpha", gameTitle: "Alpha",
    capabilities: { runtime: "inject", launch: true },
  });
  assert.equal(action(dom, "install").disabled, false);

  // The next scan fails. The renderer must not keep the previous project's
  // capability bits; install and uninstall must be disabled again.
  await scan(dom, { ok: false, outcome: "error", error: { code: "E_NOT_PROJECT", message: "no game" } });
  assert.equal(action(dom, "install").disabled, true);
  assert.equal(action(dom, "uninstall").disabled, true);
  assert.equal(dom.elements.get("engine-badge").hidden, true);
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

test("every id the renderer looks up exists in the page", () => {
  const html = fs.readFileSync(path.join(ROOT, "gui", "renderer", "index.html"), "utf8");
  const source = fs.readFileSync(RENDERER, "utf8");
  const ids = new Set([...source.matchAll(/\$\("([^"]+)"\)/g)].map((match) => match[1]));
  assert.ok(ids.size > 0);
  for (const id of ids) {
    assert.match(html, new RegExp('id="' + id + '"'), "index.html is missing #" + id);
  }
});

test("a folder dropped on the window scans it through pathForFile", async () => {
  const dom = makeDom();
  const dropped = { name: "game" };
  const seen = [];
  dom.window.yakusha.pathForFile = (file) => { seen.push(file); return "D:/games/dropped"; };
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
  assert.equal(dom.elements.get("project-line").textContent, "D:/games/dropped — Dropped");
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
  for (const fn of dom.docListeners.get("dragleave") || []) await fn({});
  assert.equal(dom.document.body.classList.has("dragging"), false);
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
  assert.equal(dom.elements.get("project-line").textContent, "C:/games/picked — Picked");
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

test("warning lines are prepended to the output pane", async () => {
  const dom = makeDom();
  await scan(dom, {
    ok: true, outcome: "ok", engine: "mz", root: "C:/games/alpha", gameTitle: "Alpha",
    capabilities: { runtime: "plugin", launch: true },
  });
  assert.equal(dom.warningFns.length, 1);
  const payload = dom.elements.get("payload");
  const before = payload.textContent;
  await dom.warningFns[0]({ line: "warn: glossary miss" });
  assert.equal(payload.textContent, "warn: glossary miss\n" + before);
});
