// Renderer: no Node, no imports. Every capability goes through
// window.yakusha (gui/preload.js); buttons map 1:1 to documented commands
// (docs/gui.md §3), failures branch on envelope.outcome + error.code only —
// never on the message text.

const $ = (id) => document.getElementById(id);
let currentDir = null;
let runSeq = 0;

function showEnvelope(envelope) {
  $("payload").textContent = JSON.stringify(envelope, null, 2);
}

function setProjectLine(text) {
  $("project-line").textContent = text;
}

async function run(command, args, flags) {
  const runId = ++runSeq;
  if (command === "translate") $("cancel").disabled = false;
  const envelope = await window.yakusha.run(command, args || (currentDir ? [currentDir] : []), flags, runId);
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
    setProjectLine(e.root + " — " + (e.gameTitle || "(untitled)"));
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
  } else {
    button.addEventListener("click", () => run(button.dataset.cmd));
  }
}

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
  const from = window.prompt("Table file to import (absolute path, .tsv/.csv/.json)");
  if (!from) return;
  const strategy = window.prompt("Strategy: only-empty or overwrite", "only-empty") || "only-empty";
  await run("import", [currentDir], { from: from.trim(), strategy: strategy.trim() });
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
