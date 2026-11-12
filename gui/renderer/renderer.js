// Renderer: no Node, no imports. Every capability goes through
// window.yakusha (gui/preload.js); buttons map 1:1 to documented commands
// (docs/gui.md §3), failures branch on envelope.outcome + error.code only —
// never on the message text.

const $ = (id) => document.getElementById(id);
let currentDir = null;
let runSeq = 0;

const COMMAND_LABELS = {
  scan: "Scan",
  extract: "Extract",
  status: "Status",
  translate: "Translate",
  verify: "Verify",
  speaker: "Speaker fix",
  terms: "Mine terms",
  install: "Install",
  uninstall: "Uninstall",
  export: "Export",
  import: "Import",
  launch: "Launch",
  doctor: "Doctor",
  config: "Config",
};

/** Short, one-line summaries for the toast; full envelopes go to the log file. */
function brief(value, max = 120) {
  const text = String(value === undefined || value === null ? "" : value).replace(/\s+/g, " ").trim();
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

function baseName(value) {
  const text = String(value || "").replace(/[\\/]+$/, "");
  const parts = text.split(/[\\/]/);
  return parts[parts.length - 1] || text;
}

function summaryFor(command, envelope) {
  if (!envelope || (!envelope.ok && envelope.outcome === "error")) {
    const error = envelope && envelope.error;
    return error ? error.code + " · " + brief(error.message) : "failed";
  }
  const e = envelope;
  if (command === "scan") {
    const bits = [];
    if (e.engine) bits.push(e.engine + (e.engineVersion ? " " + e.engineVersion : ""));
    if (e.gameTitle) bits.push(brief(e.gameTitle, 60));
    if (e.dataFiles !== undefined) bits.push(e.dataFiles + " data files");
    if (e.uniqueStrings !== undefined) bits.push(e.uniqueStrings + " strings");
    return bits.join(" · ") || "project detected";
  }
  if (command === "extract") {
    return (e.added !== undefined ? e.added + " added" : "dictionary updated") +
      (e.total !== undefined ? " · " + e.total + " total" : "");
  }
  if (command === "status" || command === "translate") {
    const head = e.translated !== undefined && e.total !== undefined
      ? e.translated + "/" + e.total + " translated"
      : "translation updated";
    const tail = e.pending !== undefined ? " · " + e.pending + " pending" : "";
    return head + tail;
  }
  if (command === "verify") {
    return (e.translated !== undefined ? e.translated + "/" + e.total + " translated" : "verification complete") +
      (e.rejected ? " · " + e.rejected + " rejected" : "");
  }
  if (command === "install") {
    if (e.native) {
      const files = e.native.files ? e.native.files.length : 0;
      return "native layer · " + files + " files" +
        (e.native.dictionaryEntries !== undefined ? " · " + e.native.dictionaryEntries + " strings" : "");
    }
    if (e.patch) return "patch layer · " + (e.patch.entries || 0) + " strings in " + (e.patch.files || 0) + " files";
    return "delivery layer installed";
  }
  if (command === "uninstall") return e.restored ? "delivery layer removed and original restored" : "delivery layer removed";
  if (command === "export") return (e.entries !== undefined ? e.entries + " entries" : "exported") +
    (e.format ? " · " + e.format : "");
  if (command === "import") {
    return (e.read !== undefined ? e.read + " read" : "imported") +
      (e.applied !== undefined ? " · " + e.applied + " applied" : "") +
      (e.skipped !== undefined ? " · " + e.skipped + " skipped" : "");
  }
  if (command === "launch") return e.pid ? "game started · pid " + e.pid : "game started";
  if (command === "doctor") return e.verdict ? "verdict: " + e.verdict : "check complete";
  if (command === "speaker") return e.entries !== undefined ? (e.names || 0) + " names across " + e.entries + " entries" : "speaker names updated";
  if (command === "terms") return e.names !== undefined ? e.names + " names mined" : "terms mined";
  if (command === "config") return e.values ? "configuration loaded" : "configuration";
  return "completed";
}

let toastNodes = [];

function dismissToast(node) {
  if (!node) return;
  if (node._toastTimer) {
    clearTimeout(node._toastTimer);
    node._toastTimer = null;
  }
  if (typeof node.remove === "function") node.remove();
  else node.hidden = true;
  const index = toastNodes.indexOf(node);
  if (index >= 0) toastNodes.splice(index, 1);
}

function scheduleToastDismiss(node, timeout) {
  if (!timeout) return;
  if (node._toastTimer) clearTimeout(node._toastTimer);
  node._toastTimer = setTimeout(() => dismissToast(node), timeout);
  if (node._toastTimer && typeof node._toastTimer.unref === "function") node._toastTimer.unref();
}

function showToast({ title, detail, kind = "info", timeout = 4200 }) {
  const node = document.createElement("div");
  node.className = "toast toast-" + kind;
  node.textContent = detail ? title + " — " + detail : title;
  node.title = detail || title;
  node.addEventListener("click", () => dismissToast(node));
  const stack = $("toasts");
  if (stack) stack.appendChild(node);
  toastNodes.push(node);
  while (toastNodes.length > 4) dismissToast(toastNodes[0]);
  scheduleToastDismiss(node, timeout);
  return { node };
}

function updateToast(handle, { title, detail, kind = "success", timeout = 4200 }) {
  if (!handle || !handle.node) return showToast({ title, detail, kind, timeout });
  const node = handle.node;
  node.className = "toast toast-" + kind;
  node.textContent = detail ? title + " — " + detail : title;
  node.title = detail || title;
  scheduleToastDismiss(node, timeout);
  return handle;
}

function setProjectLine(text) {
  $("project-line").textContent = text;
  $("project-line").title = text;
}

/**
 * Show what the next Install will actually write, in the exact terms of
 * docs/gui.md §6. The tier comes from capabilities.runtime, the same value the
 * CLI prints; delivery.js owns the copy so the UI and the docs cannot drift.
 */
function showDelivery(caps) {
  const card = $("delivery");
  if (!card) return;
  const tiers = typeof YAKUSHA_DELIVERY_TIERS !== "undefined" ? YAKUSHA_DELIVERY_TIERS : null;
  const runtime = caps ? caps.runtime : null;
  const tier = tiers ? tiers[runtime === null || runtime === undefined ? "none" : runtime] : null;
  if (!tier) { card.hidden = true; return; }
  card.hidden = false;
  $("delivery-tier").textContent = tier.key;
  $("delivery-title").textContent = tier.title;
  $("delivery-copy").textContent = tier.summary;
  const caution = $("delivery-caution");
  caution.textContent = tier.caution;
  caution.hidden = !tier.caution;
}

function hideDelivery() {
  const card = $("delivery");
  if (card) card.hidden = true;
}

/** localStorage can throw when the profile is read-only; recent projects are best effort. */
function recentStorage() {
  try {
    return window.localStorage || null;
  } catch {
    return null;
  }
}

/** Render the last successfully scanned projects as one-click chips. */
function renderRecent() {
  const row = $("recent");
  const list = $("recent-list");
  if (!row || !list) return;
  const items = typeof YAKUSHA_RECENT !== "undefined"
    ? YAKUSHA_RECENT.read(recentStorage())
    : [];
  list.innerHTML = "";
  if (items.length === 0) {
    row.hidden = true;
    return;
  }
  for (const entry of items) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "recent-chip";
    chip.title = entry.root;
    const name = document.createElement("span");
    name.className = "recent-name";
    name.textContent = entry.title || baseName(entry.root) || entry.root;
    const engine = document.createElement("span");
    engine.className = "recent-engine";
    engine.textContent = entry.engine || "";
    chip.appendChild(name);
    chip.appendChild(engine);
    chip.addEventListener("click", () => {
      currentDir = entry.root;
      setProjectLine(entry.root);
      run("scan");
    });
    list.appendChild(chip);
  }
  row.hidden = false;
}

/** Remember a successful scan; a failed scan never enters the recent list. */
function rememberProject(envelope) {
  if (!envelope || !envelope.root || typeof YAKUSHA_RECENT === "undefined") return;
  try {
    YAKUSHA_RECENT.add(recentStorage(), {
      root: envelope.root,
      engine: envelope.engine || "",
      title: envelope.gameTitle || "",
    });
  } catch {
    // Recent projects are a convenience; never fail the scan over storage.
  }
  renderRecent();
}

async function run(command, args, flags) {
  const runId = ++runSeq;
  if (command === "scan") {
    // A scan starts a new project view. Do not let the previous engine's
    // capabilities keep install/uninstall/launch enabled while this scan is
    // running or after it fails.
    const badge = $("engine-badge");
    if (badge) badge.hidden = true;
    hideDelivery();
    const installBtn = document.querySelector('button[data-cmd="install"]');
    const uninstallBtn = document.querySelector('button[data-cmd="uninstall"]');
    const launchBtn = $("launch-run");
    if (installBtn) { installBtn.disabled = true; installBtn.title = "scan a project first"; }
    if (uninstallBtn) { uninstallBtn.disabled = true; uninstallBtn.title = "scan a project first"; }
    if (launchBtn) { launchBtn.disabled = true; launchBtn.title = "scan a project first"; }
  }
  if (command === "translate") $("cancel").disabled = false;
  const useStoredKey = command === "translate" && $("key-use").checked;
  const target = args && args[0] ? baseName(args[0]) : currentDir ? baseName(currentDir) : "";
  const pending = showToast({
    title: COMMAND_LABELS[command] || command,
    detail: target ? "working on " + target : "working…",
    kind: "busy",
    timeout: 0,
  });
  let envelope;
  try {
    envelope = await window.yakusha.run(command, args || (currentDir ? [currentDir] : []), flags, runId, useStoredKey);
  } catch (error) {
    updateToast(pending, {
      title: COMMAND_LABELS[command] || command,
      detail: brief(error && error.message ? error.message : error),
      kind: "error",
      timeout: 8000,
    });
    throw error;
  }
  $("cancel").disabled = true;
  $("progress").hidden = true;
  updateToast(pending, {
    title: COMMAND_LABELS[command] || command,
    detail: summaryFor(command, envelope),
    kind: envelope.ok ? "success" : envelope.outcome === "findings" ? "warning" : "error",
    timeout: envelope.ok ? 4200 : 8000,
  });
  if (command === "config" && envelope.ok && envelope.values) {
    const text = (entry) => (entry && entry.value !== undefined && entry.value !== null ? entry.value : "(unset)");
    $("config-summary").textContent =
      "provider: " + text(envelope.values.provider) + ", model: " + text(envelope.values.model);
  }
  if (command === "scan" && envelope.ok) {
    const e = envelope;
    const badge = $("engine-badge");
    badge.hidden = false;
    badge.textContent = (e.engine || "?") + (e.engineVersion ? " " + e.engineVersion : "");
    setProjectLine(e.root + " — " + (e.gameTitle || "(untitled)"));
    rememberProject(e);
    // Buttons follow the engine's capabilities (docs/gui.md acceptance: a button
    // for an unsupported capability is disabled with the reason shown). The
    // capability facts come from the scan payload — the same object the CLI
    // prints in --json.
    const caps = e.capabilities || null;
    showDelivery(caps);
    const noDelivery = !caps || caps.runtime === null || caps.runtime === undefined;
    const installBtn = document.querySelector('button[data-cmd="install"]');
    const uninstallBtn = document.querySelector('button[data-cmd="uninstall"]');
    const launchBtn = $("launch-run");
    if (installBtn) {
      installBtn.disabled = noDelivery;
      installBtn.title = noDelivery
        ? "this engine has no delivery layer yet — install reports E_NOT_IMPLEMENTED"
        : "";
    }
    if (uninstallBtn) {
      uninstallBtn.disabled = noDelivery;
      uninstallBtn.title = noDelivery
        ? "this engine has no delivery layer yet — uninstall reports E_NOT_IMPLEMENTED"
        : "";
    }
    if (launchBtn) {
      const launchable = caps ? caps.launch === true : true;
      launchBtn.disabled = !launchable;
      launchBtn.title = launchable ? "" : "this engine cannot be launched from yakusha";
    }
  }
  if (command === "scan" && !envelope.ok && envelope.error && envelope.error.code === "E_MULTI_ROOT") {
    setProjectLine("multiple projects found — see details.candidates in the output");
  }
  return envelope;
}

/**
 * Source language for translate/verify. The CLI defaults to ja, but the GUI
 * sends the selected value explicitly so the payload and the run log always
 * state which language the project is in (docs/gui.md §9).
 */
function sourceLang() {
  const select = $("source-lang");
  const value = select ? select.value : "";
  return value === "en" ? "en" : "ja";
}

for (const button of document.querySelectorAll("button[data-cmd]")) {
  if (button.dataset.cmd === "export") {
    button.addEventListener("click", doExport);
  } else if (button.dataset.cmd === "config") {
    button.addEventListener("click", () => run("config", ["list"]));
  } else if (button.dataset.cmd === "install" || button.dataset.cmd === "uninstall") {
    // Every engine has exactly one delivery layer and the command picks it;
    // both buttons send the plain command, like the CLI.
    button.addEventListener("click", () => run(button.dataset.cmd));
  } else if (button.dataset.cmd === "translate" || button.dataset.cmd === "verify") {
    // Both commands take --source-lang; send it explicitly even for the
    // default so the run log records what the GUI assumed.
    button.addEventListener("click", () => run(button.dataset.cmd, undefined, { "source-lang": sourceLang() }));
  } else {
    button.addEventListener("click", () => run(button.dataset.cmd));
  }
}

// Credentials: the key is typed once, sent to the main process for DPAPI
// storage (or clearing), and the input is emptied immediately — the renderer
// never keeps a copy.
$("key-save").addEventListener("click", async () => {
  const key = $("key-input").value;
  if (!key) return;
  const result = await window.yakusha.saveApiKey(key);
  $("key-input").value = "";
  $("key-state").textContent = result.saved ? "key stored (encrypted)" : "not stored: " + (result.reason || "?");
});
$("key-clear").addEventListener("click", async () => {
  await window.yakusha.clearApiKey();
  $("key-state").textContent = "stored key removed";
  $("key-use").checked = false;
});
window.yakusha.hasApiKey().then((has) => {
  if (!has) $("key-use").disabled = true;
  $("key-state").textContent = has ? "a stored key is available" : "no stored key";
});
$("key-use").addEventListener("change", () => {
  if (!$("key-use").checked) return;
  window.yakusha.hasApiKey().then((has) => {
    if (!has) { $("key-use").checked = false; $("key-state").textContent = "no stored key — enter and remember one first"; }
  });
});

// Export asks for a destination file (default: next to the dictionary, out of
// the game tree is the user's call — the CLI's overwrite protection stays on).
async function doExport() {
  if (!currentDir) { setProjectLine("pick a project first"); return; }
  const suggested = currentDir.replace(/[\\/]+$/, "") + "-export.json";
  const out = window.prompt("Export file (absolute path)", suggested);
  if (!out) return;
  await run("export", [currentDir], { out: out.trim(), format: "json", force: true });
}

// Import asks for the source table; strategy stays the documented default
// (only-empty) unless the user types overwrite.
$("import-run").addEventListener("click", async () => {
  if (!currentDir) { setProjectLine("pick a project first"); return; }
  const from = window.prompt("File to import (absolute path, .tsv/.csv/.json/.jsonl)");
  if (!from) return;
  const strategy = window.prompt("Strategy: only-empty or overwrite", "only-empty") || "only-empty";
  await run("import", [currentDir], { from: from.trim(), strategy: strategy.trim() });
});

// Launch goes through the same runner seam (runner spawns detached with the
// secret-free environment). --exe is optional; the CLI's E_EXE error lists
// candidates when the choice is ambiguous.
$("launch-run").addEventListener("click", async () => {
  if (!currentDir) { setProjectLine("pick a project first"); return; }
  const exe = window.prompt("Executable file name (empty = let yakusha pick)", "");
  if (exe === null) return;
  const flags = exe.trim() ? { exe: exe.trim() } : {};
  const envelope = await run("launch", [currentDir], flags);
  if (!envelope.ok && envelope.error && envelope.error.code === "E_EXE" &&
      envelope.error.details && Array.isArray(envelope.error.details.candidates)) {
    setProjectLine("pick one: " + envelope.error.details.candidates.join(", "));
  }
});

// Dictionary editor: one pending entry at a time. The list is capped so a
// 30k-entry dictionary cannot freeze the renderer; the dropdown only holds
// pending keys and the text box edits exactly the selected key.
let dictState = null;
$("dict-load").addEventListener("click", async () => {
  if (!currentDir) { setProjectLine("pick a project first"); return; }
  const result = await window.yakusha.loadDictionary(currentDir);
  if (!result || result.ok === false) {
    $("dict-summary").textContent = (result && result.error ? result.error.code + ": " : "") +
      (result && result.error ? result.error.message : "cannot read the dictionary");
    return;
  }
  dictState = result;
  $("dict-summary").textContent =
    result.translated + " translated, " + result.pendingCount + " pending (" + result.entries.length + " keys)";
  const pending = result.entries.filter((entry) => entry.pending).slice(0, 200);
  const select = $("dict-key");
  select.innerHTML = "";
  for (const entry of pending) {
    const option = document.createElement("option");
    option.value = entry.key;
    option.textContent = entry.key.length > 80 ? entry.key.slice(0, 77) + "…" : entry.key;
    select.appendChild(option);
  }
  select.hidden = pending.length === 0;
  $("dict-text").hidden = pending.length === 0;
  $("dict-save").hidden = pending.length === 0;
  if (pending.length > 0) {
    $("dict-text").value = "";
    $("dict-summary").textContent += " — showing the first " + pending.length + " pending";
  } else if (result.pendingCount === 0) {
    $("dict-summary").textContent += " — nothing pending";
  }
});
$("dict-save").addEventListener("click", async () => {
  if (!dictState) return;
  const key = $("dict-key").value;
  const result = await window.yakusha.saveEntry(currentDir, key, $("dict-text").value);
  if (!result || result.ok === false) {
    $("dict-summary").textContent = (result && result.error ? result.error.code + ": " : "") +
      (result && result.error ? result.error.message : "cannot save the entry");
    return;
  }
  $("dict-summary").textContent = result.translated + " translated, " + result.pendingCount + " pending";
  // Reload: the dropdown rebuilds without the saved key, so the editor simply
  // advances to the next pending entry.
  $("dict-load").click();
});

$("pick").addEventListener("click", async () => {
  const picked = await window.yakusha.pickDirectory();
  if (picked) { currentDir = picked; setProjectLine(currentDir); run("scan"); }
});

$("cancel").addEventListener("click", () => window.yakusha.cancel());

window.yakusha.onProgress(({ runId, progress }) => {
  if (runId !== runSeq) return;
  $("progress").hidden = false;
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  $("bar-fill").style.width = pct + "%";
  $("progress-text").textContent =
    progress.done + "/" + progress.total + " entries, " + progress.translated + " translated";
});

window.yakusha.onWarning(({ line }) => {
  showToast({ title: "Warning", detail: brief(line, 180), kind: "warning", timeout: 6000 });
});

// The detailed command output (including full envelopes) lives in the log
// file; the window only links to it. Keep this defensive so an older preload
// still loads the rest of the renderer.
async function initLogSummary() {
  if (typeof window.yakusha.logPath !== "function") return;
  try {
    const file = await window.yakusha.logPath();
    if (file) $("log-summary").textContent = "Detailed output: " + file;
  } catch {
    // The summary line is a convenience; the controls still work without it.
  }
}
initLogSummary();
renderRecent();

$("log-open").addEventListener("click", async () => {
  if (typeof window.yakusha.openLog !== "function") return;
  const result = await window.yakusha.openLog();
  if (!result || result.ok === false) {
    showToast({
      title: "Log",
      detail: result && result.error ? result.error : "could not open the log file",
      kind: "error",
      timeout: 8000,
    });
  }
});

// Drag & drop: the File object must go through webUtils in preload; the
// renderer never trusts event data for paths.
document.addEventListener("dragover", (e) => { e.preventDefault(); document.body.classList.add("dragging"); });
document.addEventListener("dragleave", () => document.body.classList.remove("dragging"));
document.addEventListener("drop", (e) => {
  e.preventDefault();
  document.body.classList.remove("dragging");
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (!file) return;
  currentDir = window.yakusha.pathForFile(file);
  setProjectLine(currentDir);
  run("scan");
});