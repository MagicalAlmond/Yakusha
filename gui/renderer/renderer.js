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
  button.addEventListener("click", () => run(button.dataset.cmd));
}

$("pick").addEventListener("click", async () => {
  // 0.14 keeps the shell minimal: type or paste the folder, drag it in, or
  // scan a path straight away. A native dialog arrives with the file work.
  const value = window.prompt("Game folder (absolute path)", currentDir || "");
  if (value) { currentDir = value.trim(); setProjectLine(currentDir); }
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
