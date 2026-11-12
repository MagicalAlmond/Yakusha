#!/usr/bin/env node
/**
 * Real-window GUI acceptance walkthrough.
 *
 * This is the 0.78 complement to test/gui-e2e.test.js: that test drives the
 * GUI handler seam, while this tool drives the actual Electron window through
 * CDP — real clicks, real DOM, real worker, same commands and same envelopes.
 * It covers the five delivery chains the GUI promises: MZ, MV, Ren'Py, RGSS, Kirikiri.
 *
 * Usage:
 *   node tools/gui-acceptance.mjs                 # all five chains
 *   node tools/gui-acceptance.mjs --only mz,renpy
 *   node tools/gui-acceptance.mjs --timeout 60000
 *   node tools/gui-acceptance.mjs --exe dist/yakusha-0.79.0-win-x64/Yakusha.exe
 *
 * The tool is intentionally not part of `npm test`: it needs an Electron
 * window and is meant for the real-machine walkthrough recorded in
 * docs/gui.md §9 and docs/evidence.md. It writes screenshots, a JSON summary
 * and the GUI log under .dsh-scratch/ (gitignored) and never touches the user profile.
 */
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { writeRgssProject } from "../test/rgss-fixture.js";
import { writeKrkrProject } from "../test/krkr-fixture.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ELECTRON = path.join(ROOT, "node_modules", "electron", "dist", "electron.exe");
const NATIVE_ASSETS = path.join(ROOT, "native", "prebuilt");

export const CHAINS = Object.freeze([
  Object.freeze({ id: "mz", engine: "mz", runtime: "plugin", tier: "L4-plugin", fixture: "test/fixtures/mini-mz", sourceLang: "ja" }),
  Object.freeze({ id: "mv", engine: "mv", runtime: "plugin", tier: "L4-plugin", fixture: "test/fixtures/mini-mv", sourceLang: "ja" }),
  Object.freeze({ id: "renpy", engine: "renpy", runtime: "translation", tier: "L4-resource", fixture: "test/fixtures/renpy-extract/rpy", sourceLang: "en" }),
  Object.freeze({ id: "rgss", engine: "rgss", runtime: "inject", tier: "L4-inject", fixture: null, sourceLang: "ja" }),
  Object.freeze({ id: "krkr", engine: "krkr", runtime: "patch", tier: "L4-patch", fixture: null, sourceLang: "ja" }),
]);

export function selectChains(only) {
  if (!only) return CHAINS.slice();
  const wanted = new Set(String(only).split(",").map((value) => value.trim()).filter(Boolean));
  const picked = CHAINS.filter((chain) => wanted.has(chain.id));
  const missing = [...wanted].filter((id) => !CHAINS.some((chain) => chain.id === id));
  if (missing.length > 0) throw new Error("unknown chain(s): " + missing.join(", "));
  if (picked.length === 0) throw new Error("--only selected no chains");
  return picked;
}

function parseArgs(argv) {
  const options = { only: null, timeout: 45000, port: null, exe: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--only") options.only = argv[++index];
    else if (arg === "--timeout") options.timeout = Number(argv[++index]);
    else if (arg === "--port") options.port = Number(argv[++index]);
    else if (arg === "--exe") {
      options.exe = argv[++index];
      if (!options.exe) throw new Error("--exe requires a path");
    }
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error("unknown argument: " + arg);
  }
  if (!Number.isFinite(options.timeout) || options.timeout < 5000) throw new Error("--timeout must be >= 5000 ms");
  return options;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForTarget(port, timeout) {
  const deadline = Date.now() + timeout;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch("http://127.0.0.1:" + port + "/json/list");
      if (response.ok) {
        const targets = await response.json();
        const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
        if (page) return page;
      }
    } catch (error) {
      lastError = String(error && error.message ? error.message : error);
    }
    await sleep(250);
  }
  throw new Error("Electron CDP target did not appear: " + lastError);
}

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) return;
      const request = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) request.reject(new Error(JSON.stringify(message.error)));
      else request.resolve(message.result);
    };
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.onopen = resolve;
      socket.onerror = () => reject(new Error("WebSocket connection failed"));
    });
    return new Cdp(socket);
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error("Runtime.evaluate failed: " + JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }

  close() {
    try { this.socket.close(); } catch { /* already closed */ }
  }
}

async function waitFor(cdp, expression, timeout, label) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await cdp.evaluate(expression)) return;
    await sleep(100);
  }
  throw new Error("timed out waiting for " + (label || expression));
}

function readEvents(logFile) {
  if (!fs.existsSync(logFile)) return [];
  const text = fs.readFileSync(logFile, "utf8");
  const events = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { events.push(JSON.parse(line)); } catch { /* a partially written line */ }
  }
  return events;
}

function countResults(logFile, command) {
  return readEvents(logFile).filter((event) => event.event === "run.result" && event.command === command).length;
}

async function waitForRunResult(logFile, command, before, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const results = readEvents(logFile).filter((event) => event.event === "run.result" && event.command === command);
    if (results.length > before) return results[before];
    await sleep(100);
  }
  throw new Error("timed out waiting for run.result of " + command);
}

async function clickSelector(cdp, selector) {
  const prepared = await cdp.evaluate(
    '(() => { const el = document.querySelector(' + JSON.stringify(selector) + '); if (!el) return false; el.scrollIntoView({block: "center"}); return !el.disabled; })()'
  );
  if (!prepared) throw new Error("cannot click " + selector + " (missing or disabled)");
  await sleep(120);
  const rect = JSON.parse(await cdp.evaluate(
    "JSON.stringify(document.querySelector(" + JSON.stringify(selector) + ").getBoundingClientRect())"
  ));
  const x = rect.x + rect.width / 2;
  const y = rect.y + rect.height / 2;
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}

async function clickCommand(cdp, logFile, selector, command, timeout) {
  const before = countResults(logFile, command);
  await clickSelector(cdp, selector);
  const event = await waitForRunResult(logFile, command, before, timeout);
  return event.envelope;
}

async function capture(cdp, file) {
  const result = await cdp.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(file, Buffer.from(result.data, "base64"));
  return file;
}

function prepareGame(chain, gamesDir) {
  const dir = path.join(gamesDir, chain.id);
  if (chain.id === "rgss") {
    fs.mkdirSync(dir, { recursive: true });
    writeRgssProject(dir);
    return dir;
  }
  if (chain.id === "krkr") {
    writeKrkrProject(gamesDir, {
      name: chain.id,
      archives: [{
        archiveName: "data.xp3",
        files: [{ name: "scenario/s1.ks", data: Buffer.from("[name_set name='Aoi']\nこんにちは\n[p]\n", "utf8"), mode: 1 }],
      }],
    });
    return dir;
  }
  fs.cpSync(path.join(ROOT, chain.fixture), dir, { recursive: true });
  const previous = path.join(dir, "yakusha");
  if (fs.existsSync(previous)) fs.rmSync(previous, { recursive: true, force: true });
  return dir;
}

function assertEnvelope(step, envelope, chain) {
  if (!envelope || envelope.ok !== true) {
    throw new Error(chain.id + " " + step + " failed: " + JSON.stringify(envelope && envelope.error ? envelope.error : envelope));
  }
}

function checkInstalled(chain, dir, envelope) {
  if (chain.runtime === "plugin") {
    const plugin = path.join(dir, "js", "plugins", "YAKUSHA_Translator.js");
    if (!fs.existsSync(plugin)) throw new Error(chain.id + " install did not write " + plugin);
    if (envelope.registered !== true) throw new Error(chain.id + " install did not register the plugin");
  } else if (chain.runtime === "translation") {
    const translation = path.join(dir, "game", "yakusha_translation.rpy");
    if (!fs.existsSync(translation)) throw new Error(chain.id + " install did not write " + translation);
    if (envelope.registered !== true) throw new Error(chain.id + " install did not register the translation file");
  } else if (chain.runtime === "inject") {
    const nativeDir = path.join(dir, "yakusha", "native");
    if (!fs.existsSync(path.join(nativeDir, "manifest.json"))) throw new Error(chain.id + " install did not write native/manifest.json");
    if (!envelope.native || envelope.native.removed === true) throw new Error(chain.id + " install did not report native components");
  } else if (chain.runtime === "patch") {
    if (!envelope.patch || !envelope.patch.archive) throw new Error(chain.id + " install did not report a patch archive");
    if (!(envelope.patch.entries > 0)) throw new Error(chain.id + " install wrote an empty patch");
    const archive = path.join(dir, "data", envelope.patch.archive);
    if (!fs.existsSync(archive)) throw new Error(chain.id + " install did not write " + archive);
    if (!fs.existsSync(path.join(dir, "yakusha", "krkr-patch.json"))) throw new Error(chain.id + " install did not write the patch manifest");
  }
}

function checkUninstalled(chain, dir, envelope, originalPlugins, originalArchive) {
  if (envelope.removed !== true) throw new Error(chain.id + " uninstall did not report removed:true");
  if (chain.runtime === "plugin") {
    const plugin = path.join(dir, "js", "plugins", "YAKUSHA_Translator.js");
    const pluginsFile = path.join(dir, "js", "plugins.js");
    if (fs.existsSync(plugin)) throw new Error(chain.id + " uninstall left the plugin file behind");
    if (envelope.restored !== true) throw new Error(chain.id + " uninstall did not restore js/plugins.js");
    if (originalPlugins && !fs.readFileSync(pluginsFile).equals(originalPlugins)) {
      throw new Error(chain.id + " uninstall did not restore js/plugins.js byte for byte");
    }
  } else if (chain.runtime === "translation") {
    const translation = path.join(dir, "game", "yakusha_translation.rpy");
    if (fs.existsSync(translation)) throw new Error(chain.id + " uninstall left the translation file behind");
  } else if (chain.runtime === "inject") {
    const nativeDir = path.join(dir, "yakusha", "native");
    if (fs.existsSync(nativeDir)) throw new Error(chain.id + " uninstall left yakusha/native behind");
  } else if (chain.runtime === "patch") {
    if (!envelope.patch || !envelope.patch.archive) throw new Error(chain.id + " uninstall did not report the patch archive");
    if (fs.existsSync(path.join(dir, "data", envelope.patch.archive))) throw new Error(chain.id + " uninstall left the patch archive behind");
    if (fs.existsSync(path.join(dir, "yakusha", "krkr-patch.json"))) throw new Error(chain.id + " uninstall left the patch manifest behind");
    if (originalArchive && !fs.readFileSync(path.join(dir, "data", "data.xp3")).equals(originalArchive)) {
      throw new Error(chain.id + " uninstall changed the original data.xp3 bytes");
    }
  }
}

async function runChain(cdp, chain, dir, logFile, artifacts, timeout) {
  await cdp.evaluate("currentDir = " + JSON.stringify(dir) + "; String(currentDir)");
  await cdp.evaluate('document.getElementById("source-lang").value = ' + JSON.stringify(chain.sourceLang) + '; document.getElementById("source-lang").value');
  const originalPlugins = chain.runtime === "plugin"
    ? fs.readFileSync(path.join(dir, "js", "plugins.js"))
    : null;
  const originalArchive = chain.runtime === "patch"
    ? fs.readFileSync(path.join(dir, "data", "data.xp3"))
    : null;
  const steps = [];
  const scan = await clickCommand(cdp, logFile, "[data-cmd=scan]", "scan", timeout);
  assertEnvelope("scan", scan, chain);
  if (scan.engine !== chain.engine) throw new Error(chain.id + " scan reported engine " + scan.engine);
  const tier = await cdp.evaluate('document.getElementById("delivery-tier").textContent');
  if (tier !== chain.tier) throw new Error(chain.id + " delivery card shows " + JSON.stringify(tier) + ", expected " + chain.tier);
  const cardHidden = await cdp.evaluate('document.getElementById("delivery").hidden');
  if (cardHidden) throw new Error(chain.id + " delivery card is hidden after scan");
  const recentVisible = await cdp.evaluate(
    'document.getElementById("recent").hidden === false && document.getElementById("recent-list").children.length > 0',
  );
  if (!recentVisible) throw new Error(chain.id + " recent row did not record the scanned project");
  const screenshot = await capture(cdp, path.join(artifacts, chain.id + "-scan.png"));
  steps.push({ command: "scan", ok: scan.ok, engine: scan.engine, uniqueStrings: scan.uniqueStrings, deliveryTier: tier });

  const extract = await clickCommand(cdp, logFile, "[data-cmd=extract]", "extract", timeout);
  assertEnvelope("extract", extract, chain);
  if (!(extract.added > 0)) throw new Error(chain.id + " extract found no strings");
  steps.push({ command: "extract", ok: extract.ok, added: extract.added, total: extract.total });

  const translate = await clickCommand(cdp, logFile, "[data-cmd=translate]", "translate", timeout);
  assertEnvelope("translate", translate, chain);
  const pending = translate.progress ? translate.progress.pending : undefined;
  if (!(translate.translated > 0) || pending !== 0) throw new Error(chain.id + " translate did not finish: " + JSON.stringify({ translated: translate.translated, pending }));
  steps.push({ command: "translate", ok: translate.ok, translated: translate.translated, total: translate.total, provider: translate.provider });

  const verify = await clickCommand(cdp, logFile, "[data-cmd=verify]", "verify", timeout);
  assertEnvelope("verify", verify, chain);
  steps.push({ command: "verify", ok: verify.ok, errors: verify.errors, warnings: verify.warnings });

  const install = await clickCommand(cdp, logFile, "[data-cmd=install]", "install", timeout);
  assertEnvelope("install", install, chain);
  checkInstalled(chain, dir, install);
  steps.push({ command: "install", ok: install.ok, pluginPath: install.pluginPath });

  const uninstall = await clickCommand(cdp, logFile, "[data-cmd=uninstall]", "uninstall", timeout);
  assertEnvelope("uninstall", uninstall, chain);
  checkUninstalled(chain, dir, uninstall, originalPlugins, originalArchive);
  steps.push({ command: "uninstall", ok: uninstall.ok, removed: uninstall.removed, restored: uninstall.restored });

  const doctor = await clickCommand(cdp, logFile, "[data-cmd=doctor]", "doctor", timeout);
  assertEnvelope("doctor", doctor, chain);
  steps.push({ command: "doctor", ok: doctor.ok, verdict: doctor.verdict });

  return { engine: chain.engine, runtime: chain.runtime, deliveryTier: tier, steps, screenshot };
}

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32" && child.pid) {
    try {
      execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      return;
    } catch { /* fall through */ }
  }
  try { child.kill("SIGKILL"); } catch { /* already gone */ }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log("Usage: node tools/gui-acceptance.mjs [--only mz,mv,renpy,rgss,krkr] [--timeout ms] [--port n] [--exe path/to/Yakusha.exe]");
    return;
  }
  const executable = options.exe ? path.resolve(options.exe) : ELECTRON;
  if (!fs.existsSync(executable)) {
    throw new Error(options.exe ? "portable executable is missing: " + executable : "Electron is not installed; run pnpm install first");
  }
  if (!options.exe && !fs.existsSync(path.join(NATIVE_ASSETS, "manifest.json"))) throw new Error("native/prebuilt/manifest.json is missing");
  const chains = selectChains(options.only);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const artifactDir = path.join(ROOT, ".dsh-scratch", "gui-acceptance-" + stamp + "-" + process.pid);
  const profile = path.join(artifactDir, "profile");
  const config = path.join(artifactDir, "config");
  const games = path.join(artifactDir, "games");
  const shots = path.join(artifactDir, "screenshots");
  for (const dir of [profile, config, games, shots]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(config, "config.json"), JSON.stringify({ schema: 1, provider: "mock" }, null, 2));
  const prepared = chains.map((chain) => ({ chain, dir: prepareGame(chain, games) }));
  const port = options.port || await freePort();
  const env = { ...process.env, YAKUSHA_GUI_PROFILE: profile, YAKUSHA_CONFIG_DIR: config };
  if (!options.exe) env.YAKUSHA_NATIVE_ASSETS = NATIVE_ASSETS;
  delete env.ELECTRON_RUN_AS_NODE;
  const launchArgs = options.exe
    ? ["--remote-debugging-port=" + port, "--user-data-dir=" + profile, "--disable-gpu", "--no-sandbox"]
    : ["gui/main.js", "--remote-debugging-port=" + port, "--user-data-dir=" + profile, "--disable-gpu", "--no-sandbox"];
  const child = spawn(executable, launchArgs, {
    cwd: options.exe ? path.dirname(executable) : ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  let cdp = null;
  const summary = { schema: 1, command: "gui-acceptance", ok: false, startedAt: new Date().toISOString(), artifactDir, port, executable, mode: options.exe ? "portable" : "dev", chains: [] };
  try {
    const target = await waitForTarget(port, options.timeout);
    cdp = await Cdp.connect(target.webSocketDebuggerUrl);
    await cdp.send("Page.bringToFront");
    await waitFor(cdp, "document.readyState === \"complete\" && typeof currentDir !== \"undefined\" && !!document.querySelector(\"[data-cmd=scan]\")", options.timeout, "renderer ready");
    const logFile = path.join(config, "logs", "gui.log");
    for (const item of prepared) {
      summary.chains.push(await runChain(cdp, item.chain, item.dir, logFile, shots, options.timeout));
    }
    summary.ok = true;
  } catch (error) {
    summary.error = String(error && error.stack ? error.stack : error);
    summary.guiStderr = stderr.slice(-4000);
    process.exitCode = 1;
  } finally {
    if (cdp) cdp.close();
    killTree(child);
    summary.finishedAt = new Date().toISOString();
    summary.summaryPath = path.join(artifactDir, "summary.json");
    fs.writeFileSync(summary.summaryPath, JSON.stringify(summary, null, 2) + "\n");
    console.log(JSON.stringify(summary, null, 2));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(String(error && error.stack ? error.stack : error));
    process.exitCode = 1;
  });
}
