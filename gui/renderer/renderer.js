// Renderer: no Node, no imports. Every capability goes through
// window.yakusha (gui/preload.js); buttons map 1:1 to documented commands
// (docs/gui.md §3), failures branch on envelope.outcome + error.code only —
// never on the message text.

const $ = (id) => document.getElementById(id);
let currentDir = null;
let runSeq = 0;
// Remember the engine from the last successful scan: the RGSS install path
// needs --native, and the renderer must not guess it from a stale state.
let lastEngine = null;

function showEnvelope(envelope) {
  $("payload").textContent = JSON.stringify(envelope, null, 2);
}

function setProjectLine(text) {
  $("project-line").textContent = text;
}

async function run(command, args, flags) {
  const runId = ++runSeq;
  if (command === "scan") {
    // A scan starts a new project view. Do not let the previous engine's
    // capabilities keep install/uninstall/launch enabled while this scan is
    // running or after it fails.
    lastEngine = null;
    const badge = $("engine-badge");
    if (badge) badge.hidden = true;
    const installBtn = document.querySelector('button[data-cmd="install"]');
    const uninstallBtn = document.querySelector('button[data-cmd="uninstall"]');
    const launchBtn = $("launch-run");
    if (installBtn) { installBtn.disabled = true; installBtn.title = "scan a project first"; }
    if (uninstallBtn) { uninstallBtn.disabled = true; uninstallBtn.title = "scan a project first"; }
    if (launchBtn) { launchBtn.disabled = true; launchBtn.title = "scan a project first"; }
  }
  if (command === "translate") $("cancel").disabled = false;
  const useStoredKey = command === "translate" && $("key-use").checked;
  const envelope = await window.yakusha.run(command, args || (currentDir ? [currentDir] : []), flags, runId, useStoredKey);
  $("cancel").disabled = true;
  $("progress").hidden = true;
  showEnvelope(envelope);
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
    lastEngine = e.engine || null;
    setProjectLine(e.root + " — " + (e.gameTitle || "(untitled)"));
    // Buttons follow the engine's capabilities (docs/gui.md acceptance: a button
    // for an unsupported capability is disabled with the reason shown). The
    // capability facts come from the scan payload — the same object the CLI
    // prints in --json.
    const caps = e.capabilities || null;
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

for (const button of document.querySelectorAll("button[data-cmd]")) {
  if (button.dataset.cmd === "export") {
    button.addEventListener("click", doExport);
  } else if (button.dataset.cmd === "config") {
    button.addEventListener("click", () => run("config", ["list"]));
  } else if (button.dataset.cmd === "install" || button.dataset.cmd === "uninstall") {
    // RGSS has no plugin layer: its delivery is the native injector, so the
    // button passes --native. Every other engine keeps the plain command.
    button.addEventListener("click", () => {
      run(button.dataset.cmd, undefined, lastEngine === "rgss" ? { native: true } : {});
    });
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
  const pre = $("payload");
  pre.textContent = line + "\n" + pre.textContent;
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
