// Renderer: no Node, no imports. Every capability goes through
// window.yakusha (gui/preload.js); buttons map 1:1 to documented commands
// (docs/gui.md §3), failures branch on envelope.outcome + error.code only —
// never on the message text.

const $ = (id) => document.getElementById(id);
let currentDir = null;
let currentTitle = "";
let selectedInput = null;
let selectedKind = "";
let scanRoot = null;
let runSeq = 0;
let dictState = null;

const ui = {
  scanned: false,
  extracted: false,
  translated: false,
  verified: false,
  installed: false,
  engine: "",
  engineVersion: "",
  capabilities: null,
  total: null,
  translatedCount: null,
  pending: null,
  delivery: null,
};

const PAGES = ["overview", "workflow", "dictionary", "settings"];
const SETTINGS_TABS = ["service", "credentials", "translation", "glossary"];
const COMMAND_LABELS = {
  scan: "Scan", extract: "Extract", status: "Status", translate: "Translate",
  verify: "Verify", speaker: "Speaker fix", terms: "Mine terms", install: "Install",
  uninstall: "Uninstall", export: "Export", import: "Import", launch: "Launch",
  doctor: "Doctor", config: "Settings",
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

function setText(id, text, title) {
  const node = $(id);
  if (!node) return;
  node.textContent = text === undefined || text === null ? "" : String(text);
  if (title !== undefined) node.title = title;
}

function setHidden(id, hidden) {
  const node = $(id);
  if (node) node.hidden = hidden;
}

function setValue(id, value) {
  const node = $(id);
  if (node) node.value = value === undefined || value === null ? "" : String(value);
}

function setStatusChip(id, text, kind) {
  const node = $(id);
  if (!node) return;
  node.textContent = text;
  if (!node.classList) return;
  node.classList.remove("is-active", "is-done");
  if (kind === "active") node.classList.add("is-active");
  if (kind === "done") node.classList.add("is-done");
}

function setStage(id, state) {
  const node = $(id);
  if (!node || !node.classList) return;
  node.classList.remove("is-current", "is-done");
  if (state === "current") node.classList.add("is-current");
  if (state === "done") node.classList.add("is-done");
}

function configEntry(entry) {
  if (!entry || entry.value === undefined || entry.value === null) return "";
  return String(entry.value);
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
      (e.rejected ? " · " + e.rejected + " rejected" : "") +
      (envelope.outcome === "findings" ? " · findings need review" : "");
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
  if (command === "export") return (e.entries !== undefined ? e.entries + " entries" : "exported") + (e.format ? " · " + e.format : "");
  if (command === "import") {
    return (e.read !== undefined ? e.read + " read" : "imported") +
      (e.applied !== undefined ? " · " + e.applied + " applied" : "") +
      (e.skipped !== undefined ? " · " + e.skipped + " skipped" : "");
  }
  if (command === "launch") return e.pid ? "game started · pid " + e.pid : "game started";
  if (command === "doctor") return e.verdict ? "verdict: " + e.verdict : "check complete";
  if (command === "speaker") return e.entries !== undefined ? (e.names || 0) + " names across " + e.entries + " entries" : "speaker names updated";
  if (command === "terms") return e.names !== undefined ? e.names + " names mined" : "terms mined";
  if (command === "config") {
    if (e.values) return "configuration loaded";
    if (e.action === "set") return e.key + " saved";
    if (e.action === "unset") return e.key + " cleared";
    return "configuration";
  }
  return "completed";
}

let toastNodes = [];

function dismissToast(node) {
  if (!node) return;
  if (node._toastTimer) { clearTimeout(node._toastTimer); node._toastTimer = null; }
  if (typeof node.remove === "function") node.remove(); else node.hidden = true;
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
  node.dataset.kind = kind;
  node.addEventListener("click", () => dismissToast(node));
  node.addEventListener("keydown", (event) => {
    if (event && (event.key === "Enter" || event.key === " ")) dismissToast(node);
  });
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
  node.dataset.kind = kind;
  scheduleToastDismiss(node, timeout);
  return handle;
}

function updateInputLine() {
  const line = $("project-input");
  if (!line) return;
  if (!selectedInput) { line.hidden = true; line.textContent = ""; line.title = ""; return; }
  const label = selectedKind === "file" ? "file" : selectedKind === "directory" ? "folder" : "path";
  line.hidden = false;
  line.textContent = "Selected " + label + ": " + selectedInput;
  line.title = selectedInput;
}

function setProjectLine(text) {
  setText("project-line", text, text);
}

function setProjectTitle(title) {
  const resolved = title || "No project selected";
  setText("project-title", resolved, resolved);
  setText("sidebar-project-name", resolved, resolved);
}

/** Show page navigation without rebuilding any panel (running jobs keep their state). */
function showPage(name) {
  const page = PAGES.includes(name) ? name : "overview";
  for (const id of PAGES) {
    setHidden("page-" + id, id !== page);
    const nav = $("nav-" + id);
    if (!nav || !nav.classList) continue;
    nav.classList.remove("is-active");
    if (id === page) nav.classList.add("is-active");
    if (typeof nav.setAttribute === "function") nav.setAttribute("aria-current", id === page ? "page" : "false");
  }
}

function showSettingsTab(name) {
  const tab = SETTINGS_TABS.includes(name) ? name : "service";
  for (const id of SETTINGS_TABS) {
    setHidden("settings-" + id, id !== tab);
    const button = $("tab-" + id);
    if (!button || !button.classList) continue;
    button.classList.remove("is-active");
    if (id === tab) button.classList.add("is-active");
    if (typeof button.setAttribute === "function") button.setAttribute("aria-selected", id === tab ? "true" : "false");
  }
}

/** Remember what the user chose and what the next scan should receive. */
function setProjectInput(input, kind, target) {
  selectedInput = input || null;
  selectedKind = kind || "";
  scanRoot = target || input || null;
  updateInputLine();
  if (!currentDir) {
    setProjectTitle(scanRoot ? "Selecting " + baseName(scanRoot) : "No project selected");
    setProjectLine(scanRoot ? "Scanning " + scanRoot + "…" : "Drop a game folder or game exe here, or pick a folder");
  }
}

/** Show the canonical root the scan resolved, which commands then operate on. */
function showProjectRoot(root, title) {
  currentDir = root || null;
  currentTitle = title || "";
  const label = currentTitle || (root ? baseName(root) : "");
  if (root) {
    setProjectTitle(currentTitle || baseName(root));
    setProjectLine("Project root: " + root + (currentTitle ? " — " + currentTitle : ""));
    setText("project-card-title", label);
    setText("project-card-line", root);
    setText("project-state", "Ready to work");
    if (!selectedInput) { selectedInput = root; selectedKind = "directory"; scanRoot = root; updateInputLine(); }
  } else {
    setProjectTitle("No project selected");
    setProjectLine("Drop a game folder or game exe here, or pick a folder");
    setText("project-card-title", "No game imported yet");
    setText("project-card-line", "Choose a folder above, or drop a game folder anywhere on this window.");
    setText("project-state", "Waiting for a project");
  }
}

/** Show what the next Install will actually write, in the exact terms of docs/gui.md §6. */
function showDelivery(caps) {
  const card = $("delivery");
  if (!card) return;
  const tiers = typeof YAKUSHA_DELIVERY_TIERS !== "undefined" ? YAKUSHA_DELIVERY_TIERS : null;
  const runtime = caps ? caps.runtime : null;
  const tier = tiers ? tiers[runtime === null || runtime === undefined ? "none" : runtime] : null;
  if (!tier) { card.hidden = true; ui.delivery = null; return; }
  card.hidden = false;
  ui.delivery = tier.key;
  setText("delivery-tier", tier.key);
  setText("delivery-title", tier.title);
  setText("delivery-copy", tier.summary);
  const caution = $("delivery-caution");
  if (caution) { caution.textContent = tier.caution || ""; caution.hidden = !tier.caution; }
  setText("health-delivery", tier.key);
}

function hideDelivery() {
  setHidden("delivery", true);
  ui.delivery = null;
}

/** localStorage can throw when the profile is read-only; recent projects are best effort. */
function recentStorage() {
  try { return window.localStorage || null; } catch { return null; }
}

/** Render successfully scanned games in the rail, below the workspace pages. */
function renderRecent() {
  const row = $("recent");
  const list = $("recent-list");
  if (!row || !list) return;
  const items = typeof YAKUSHA_RECENT !== "undefined" ? YAKUSHA_RECENT.read(recentStorage()) : [];
  list.innerHTML = "";
  if (items.length === 0) { row.hidden = true; return; }
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
      const input = entry.input || entry.root;
      const target = entry.scan || entry.root;
      currentDir = null;
      currentTitle = "";
      setProjectInput(input, input === target ? "directory" : "file", target);
      showPage("overview");
      run("scan", [target]);
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
      input: selectedInput || envelope.root,
      scan: scanRoot || envelope.root,
      engine: envelope.engine || "",
      title: envelope.gameTitle || "",
    });
  } catch { /* best effort */ }
  renderRecent();
}

function updateStages() {
  const prepareState = ui.scanned ? "done" : "current";
  const translateState = ui.verified ? "done" : ui.scanned ? "current" : "next";
  const deliverState = ui.installed ? "done" : ui.verified ? "current" : "next";
  setStage("stage-prepare", prepareState);
  setStage("stage-translate", translateState);
  setStage("stage-deliver", deliverState);
  setText("stage-prepare-status", prepareState === "done" ? "Done" : prepareState === "current" ? "Now" : "Later");
  setText("stage-translate-status", translateState === "done" ? "Done" : translateState === "current" ? "Now" : "Later");
  setText("stage-deliver-status", deliverState === "done" ? "Done" : deliverState === "current" ? "Now" : "Later");
  setStatusChip("task-state", ui.installed ? "Installed" : ui.verified ? "Ready to install" : ui.scanned ? "In progress" : "Ready", ui.installed ? "done" : ui.scanned ? "active" : "");
}

function updateTask() {
  let title = "Choose a game folder";
  let copy = "Start by selecting a game folder or dropping a game exe here.";
  let button = "Choose game folder →";
  let action = "pick";
  if (ui.installed) {
    title = "Play the translated game";
    copy = "The delivery layer is installed. Launch the game to check the translation in context.";
    button = "Launch game →";
    action = "launch";
  } else if (ui.verified) {
    title = "Install the translation";
    copy = "Verification is complete. Install writes only the delivery layer described below.";
    button = "Install translation →";
    action = "install";
  } else if (ui.translated) {
    title = "Check quality before installing";
    copy = "Run Verify to catch control codes, empty translations and speaker-name problems.";
    button = "Run Verify →";
    action = "verify";
  } else if (ui.extracted) {
    title = "Translate the dictionary";
    copy = "Your text is extracted. Translate pending entries with the configured service; progress is saved along the way.";
    button = "Start Translate →";
    action = "translate";
  } else if (ui.scanned) {
    title = "Extract the text";
    copy = "Scan found the game. Extract strings into the local dictionary before translating.";
    button = "Extract text →";
    action = "extract";
  }
  setText("task-title", title);
  setText("task-copy", copy);
  const primary = $("primary-action");
  if (primary) { primary.textContent = button; primary.dataset.action = action; }
  setHidden("task-stats", !(ui.scanned || ui.extracted || ui.translated));
  if (ui.total !== null) setText("stat-total", ui.total);
  if (ui.translatedCount !== null) setText("stat-translated", ui.translatedCount);
  if (ui.pending !== null) setText("stat-pending", ui.pending);
  setHidden("task-secondary", !ui.extracted);
  updateStages();
  updateLaunchButtons();
}

function updateHealth() {
  setText("health-engine", ui.engine ? ui.engine + (ui.engineVersion ? " " + ui.engineVersion : "") : "—");
  setText("health-strings", ui.total === null ? "—" : String(ui.total));
  setText("health-translated", ui.translatedCount === null ? "—" : String(ui.translatedCount));
  setText("health-delivery", ui.delivery || "—");
}

function setLastRunBusy(command, target) {
  setText("last-run-title", (COMMAND_LABELS[command] || command) + " running…");
  setText("last-run-detail", target ? "Working on " + target : "Working…");
  setText("last-run-time", "now");
  const card = $("last-run");
  if (card && card.classList) { card.classList.remove("is-error", "is-success"); }
}

function setLastRunResult(command, envelope) {
  const summary = summaryFor(command, envelope);
  setText("last-run-title", (COMMAND_LABELS[command] || command) + (envelope.ok ? " complete" : " failed"));
  setText("last-run-detail", summary);
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  setText("last-run-time", time);
  const card = $("last-run");
  if (card && card.classList) {
    card.classList.remove("is-error", "is-success");
    card.classList.add(envelope.ok ? "is-success" : "is-error");
  }
}

function updateLaunchButtons() {
  const rgss = ui.engine === "rgss";
  const launchable = ui.capabilities ? ui.capabilities.launch === true : false;
  setHidden("launch-run", rgss);
  setHidden("launch-original", !rgss);
  setHidden("launch-translated", !rgss);
  const single = $("launch-run");
  if (single) { single.disabled = !launchable; single.title = launchable ? "" : "this engine cannot be launched from yakusha"; }
  const original = $("launch-original");
  if (original) { original.disabled = !launchable; original.title = launchable ? "" : "this engine cannot be launched from yakusha"; }
  const translated = $("launch-translated");
  if (translated) {
    const hasText = ui.translatedCount !== null ? Number(ui.translatedCount) > 0 : ui.translated;
    const ready = launchable && ui.installed && hasText;
    translated.disabled = !ready;
    translated.title = !hasText ? "游戏未进行翻译" : !ui.installed ? "Install the translation first" : launchable ? "" : "this engine cannot be launched from yakusha";
  }
  const workflow = $("workflow-launch");
  if (workflow) { workflow.disabled = !launchable; workflow.title = launchable ? "" : "scan a project first"; }
}

async function refreshProjectState(root, engine) {
  if (!root || typeof window.yakusha.projectState !== "function") return;
  try {
    const state = await window.yakusha.projectState(root, engine);
    if (!state || state.ok === false) return;
    const dictionary = state.dictionary || {};
    if (dictionary.translated !== undefined) ui.translatedCount = dictionary.translated;
    if (dictionary.total !== undefined) ui.total = dictionary.total;
    if (dictionary.pending !== undefined) ui.pending = dictionary.pending;
    ui.translated = Number(dictionary.translated || 0) > 0;
    if (state.native && state.native.installed) ui.installed = true;
    updateTask();
    updateHealth();
  } catch { /* project state is convenience, not a gate */ }
}

function applyConfig(envelope) {
  const values = envelope && envelope.values ? envelope.values : null;
  if (!values) return;
  const provider = configEntry(values.provider);
  const model = configEntry(values.model);
  const baseUrl = configEntry(values.baseUrl);
  const apiFormat = configEntry(values.apiFormat) || "chat-completions";
  const select = $("config-provider");
  if (select) select.value = provider;
  setValue("config-api-format", apiFormat);
  setValue("config-model", model);
  setValue("config-base-url", baseUrl);
  const label = (entry) => entry && entry.value ? entry.value + (entry.source ? " (" + entry.source + ")" : "") : "(not set)";
  setText("config-summary", "provider: " + label(values.provider) + " · apiFormat: " + label(values.apiFormat) + " · model: " + label(values.model) + " · baseUrl: " + label(values.baseUrl));
  setHidden("service-banner", Boolean(provider));
  if (provider) setText("config-state", "Service configured");
}

function readConfigForm() {
  const provider = $("config-provider") ? $("config-provider").value.trim() : "";
  const apiFormat = $("config-api-format") ? $("config-api-format").value.trim() : "chat-completions";
  const model = $("config-model") ? $("config-model").value.trim() : "";
  const baseUrl = $("config-base-url") ? $("config-base-url").value.trim() : "";
  return { provider, apiFormat, model, baseUrl };
}

async function saveConfigForm() {
  const values = readConfigForm();
  if (!values.provider) { showToast({ title: "Settings", detail: "choose a provider first", kind: "warning", timeout: 6000 }); return; }
  if ((values.provider === "openai" || values.provider === "compatible") && !values.model) {
    showToast({ title: "Settings", detail: "model is required for this provider", kind: "warning", timeout: 6000 }); return;
  }
  if (values.provider === "compatible" && !values.baseUrl) {
    showToast({ title: "Settings", detail: "base URL is required for a compatible endpoint", kind: "warning", timeout: 6000 }); return;
  }
  const jobs = [["provider", values.provider], ["apiFormat", values.apiFormat || "chat-completions"]];
  if (values.baseUrl) jobs.push(["baseUrl", values.baseUrl]);
  if (values.model) jobs.push(["model", values.model]);
  try {
    for (const [key, value] of jobs) {
      const envelope = await window.yakusha.run("config", ["set", key, value], {}, 0, false);
      if (!envelope || envelope.ok === false) {
        showToast({ title: "Settings", detail: summaryFor("config", envelope), kind: "error", timeout: 8000 });
        return;
      }
    }
    const current = await window.yakusha.run("config", ["list"], {}, 0, false);
    if (current && current.ok) applyConfig(current);
    setText("config-state", "Service saved");
    showToast({ title: "Settings", detail: "translation service saved", kind: "success", timeout: 6000 });
  } catch (error) {
    showToast({ title: "Settings", detail: brief(error && error.message ? error.message : error), kind: "error", timeout: 8000 });
  }
}

async function clearConfigForm() {
  try {
    for (const key of ["provider", "model", "baseUrl", "apiFormat"]) {
      const envelope = await window.yakusha.run("config", ["unset", key], {}, 0, false);
      if (!envelope || envelope.ok === false) {
        showToast({ title: "Settings", detail: summaryFor("config", envelope), kind: "error", timeout: 8000 });
        return;
      }
    }
    const select = $("config-provider"); if (select) select.value = "";
    setValue("config-api-format", "chat-completions");
    setValue("config-model", "");
    setValue("config-base-url", "");
    renderModelList([]);
    setText("config-model-status", "");
    setText("config-summary", "No service configured — set provider, API format and model.");
    setText("config-state", "Service cleared");
    setHidden("service-banner", false);
    showToast({ title: "Settings", detail: "translation service cleared", kind: "success", timeout: 6000 });
  } catch (error) {
    showToast({ title: "Settings", detail: brief(error && error.message ? error.message : error), kind: "error", timeout: 8000 });
  }
}

function renderModelList(models) {
  const list = $("config-model-list");
  if (!list) return;
  list.innerHTML = "";
  if (!models || models.length === 0) { list.hidden = true; return; }
  for (const model of models) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "model-option";
    button.dataset.model = model;
    button.textContent = model;
    button.title = "Use " + model;
    button.addEventListener("click", () => {
      setValue("config-model", model);
      for (const child of list.children) if (child.classList) child.classList.remove("is-selected");
      button.classList.add("is-selected");
      setText("config-model-status", "Selected " + model);
    });
    list.appendChild(button);
  }
  list.hidden = false;
}

async function queryModels() {
  const values = readConfigForm();
  if (!values.provider) { showToast({ title: "Models", detail: "choose a provider first", kind: "warning", timeout: 6000 }); return; }
  if (values.provider === "compatible" && !values.baseUrl) { showToast({ title: "Models", detail: "set the base URL first", kind: "warning", timeout: 6000 }); return; }
  setText("config-model-status", "Fetching models…");
  if (typeof window.yakusha.listModels !== "function") { setText("config-model-status", "model listing is unavailable in this build"); return; }
  try {
    const result = await window.yakusha.listModels({ provider: values.provider, baseUrl: values.baseUrl });
    if (!result || result.ok === false) {
      const error = result && result.error;
      setText("config-model-status", error ? error.code + " · " + brief(error.message) : "could not fetch models");
      return;
    }
    const models = Array.isArray(result.models) ? result.models : [];
    renderModelList(models);
    setText("config-model-status", models.length + " model" + (models.length === 1 ? "" : "s") + " available — click one to select it");
  } catch (error) {
    setText("config-model-status", brief(error && error.message ? error.message : error));
  }
}

async function run(command, args, flags) {
  const runId = ++runSeq;
  const requestArgs = args || (currentDir ? [currentDir] : []);
  if (command === "scan") {
    setText("project-state", "Scanning…");
    if (!args && requestArgs[0]) {
      scanRoot = requestArgs[0];
      if (!selectedInput) { selectedInput = requestArgs[0]; selectedKind = "directory"; updateInputLine(); }
    }
  }
  const cancel = $("cancel"); if (cancel) cancel.disabled = false;
  const useStoredKey = command === "translate" && $("key-use") && $("key-use").checked;
  const target = requestArgs[0] ? baseName(requestArgs[0]) : "";
  setLastRunBusy(command, target);
  const pending = showToast({ title: COMMAND_LABELS[command] || command, detail: target ? "working on " + target : "working…", kind: "busy", timeout: 0 });
  let envelope;
  try {
    envelope = await window.yakusha.run(command, requestArgs, flags, runId, useStoredKey);
  } catch (error) {
    updateToast(pending, { title: COMMAND_LABELS[command] || command, detail: brief(error && error.message ? error.message : error), kind: "error", timeout: 8000 });
    setLastRunResult(command, { ok: false, outcome: "error", error: { code: "E_INTERNAL", message: error && error.message ? error.message : error } });
    throw error;
  }
  if (cancel) cancel.disabled = true;
  setHidden("progress", true);
  const toastKind = envelope.ok ? "success" : envelope.outcome === "findings" ? "warning" : "error";
  updateToast(pending, { title: COMMAND_LABELS[command] || command, detail: summaryFor(command, envelope), kind: toastKind, timeout: envelope.ok ? 4200 : 8000 });
  setLastRunResult(command, envelope);
  if (envelope.error && envelope.error.code === "E_CONFIG") setHidden("service-banner", false);
  if (command === "config" && envelope.ok && envelope.values) applyConfig(envelope);
  if (command === "scan" && envelope.ok) {
    const e = envelope;
    const badge = $("engine-badge");
    if (badge) { badge.hidden = false; badge.textContent = (e.engine || "?") + (e.engineVersion ? " " + e.engineVersion : ""); }
    const cardBadge = $("project-card-engine");
    if (cardBadge) { cardBadge.hidden = false; cardBadge.textContent = (e.engine || "?") + (e.engineVersion ? " " + e.engineVersion : ""); }
    showProjectRoot(e.root, e.gameTitle || "(untitled)");
    rememberProject(e);
    const caps = e.capabilities || null;
    showDelivery(caps);
    ui.scanned = true; ui.extracted = false; ui.translated = false; ui.verified = false; ui.installed = false;
    ui.engine = e.engine || ""; ui.engineVersion = e.engineVersion || ""; ui.capabilities = caps;
    ui.total = e.uniqueStrings !== undefined ? e.uniqueStrings : (e.totalStrings !== undefined ? e.totalStrings : null);
    ui.translatedCount = 0; ui.pending = null;
    const noDelivery = !caps || caps.runtime === null || caps.runtime === undefined;
    for (const id of ["install", "uninstall"]) {
      const btn = document.querySelector('button[data-cmd="' + id + '"]');
      if (btn) { btn.disabled = noDelivery; btn.title = noDelivery ? "this engine has no delivery layer yet — install reports E_NOT_IMPLEMENTED" : ""; }
    }
    updateHealth(); updateTask();
    await refreshProjectState(e.root, e.engine || "");
  }
  if (command === "scan" && !envelope.ok) {
    if (envelope.error && envelope.error.code === "E_MULTI_ROOT") setProjectLine("multiple projects found — see details.candidates in the output");
    else if (!currentDir) setProjectLine("No project found — " + (scanRoot || requestArgs[0] || "choose a game folder"));
    setText("project-state", currentDir ? "Scan failed — previous project kept" : "Needs attention");
    if (!currentDir) setProjectTitle("No project selected");
    updateTask();
  }
  if (command === "extract" && envelope.ok) { ui.extracted = true; if (envelope.total !== undefined) ui.total = envelope.total; updateTask(); updateHealth(); }
  if ((command === "status" || command === "translate") && envelope.ok) {
    if (command === "translate") ui.translated = true;
    if (envelope.translated !== undefined) ui.translatedCount = envelope.translated;
    if (envelope.total !== undefined) ui.total = envelope.total;
    if (envelope.pending !== undefined) ui.pending = envelope.pending;
    updateTask(); updateHealth();
  }
  if (command === "verify" && envelope.ok) {
    ui.verified = envelope.outcome !== "findings";
    if (envelope.translated !== undefined) ui.translatedCount = envelope.translated;
    if (envelope.pending !== undefined) ui.pending = envelope.pending;
    updateTask(); updateHealth();
    if (!ui.verified) showToast({ title: "Verify", detail: (envelope.errors || 0) + " error(s) block install — open the log for details", kind: "warning", timeout: 9000 });
  }
  if (command === "install" && envelope.ok) { ui.installed = true; ui.verified = true; updateTask(); }
  if (command === "uninstall" && envelope.ok) { ui.installed = false; ui.verified = false; updateTask(); }
  return envelope;
}

/** Source language for translate/verify. */
function sourceLang() {
  const select = $("source-lang");
  const value = select ? select.value : "";
  return value === "en" ? "en" : "ja";
}

async function launchCurrent(original) {
  if (!currentDir) { setProjectLine("pick a project first"); return; }
  let exe = "";
  if (typeof window.yakusha.pickExecutable === "function") {
    exe = await window.yakusha.pickExecutable(currentDir);
    if (exe === null) return;
  }
  const flags = exe && String(exe).trim() ? { exe: String(exe).trim() } : {};
  if (original) flags.original = true;
  const envelope = await run("launch", [currentDir], flags);
  if (!envelope.ok && envelope.error && envelope.error.code === "E_EXE" && envelope.error.details && Array.isArray(envelope.error.details.candidates)) setProjectLine("pick one: " + envelope.error.details.candidates.join(", "));
}

for (const button of document.querySelectorAll("button[data-cmd]")) {
  if (button.dataset.cmd === "export") button.addEventListener("click", doExport);
  else if (button.dataset.cmd === "config") button.addEventListener("click", () => run("config", ["list"]));
  else if (button.dataset.cmd === "install" || button.dataset.cmd === "uninstall") button.addEventListener("click", () => run(button.dataset.cmd));
  else if (button.dataset.cmd === "translate" || button.dataset.cmd === "verify") button.addEventListener("click", () => run(button.dataset.cmd, undefined, { "source-lang": sourceLang() }));
  else button.addEventListener("click", () => run(button.dataset.cmd));
}

const primary = $("primary-action");
if (primary) {
  primary.addEventListener("click", () => {
    const action = primary.dataset.action || "pick";
    if (action === "pick") $("pick").click();
    else if (action === "launch") launchCurrent(false);
    else if (action === "translate" || action === "verify") run(action, undefined, { "source-lang": sourceLang() });
    else run(action);
  });
}
const secondary = $("task-secondary");
if (secondary) secondary.addEventListener("click", () => { showPage("dictionary"); const load = $("dict-load"); if (load) load.click(); });
const serviceConfig = $("service-config");
if (serviceConfig) serviceConfig.addEventListener("click", () => { showPage("settings"); showSettingsTab("service"); if ($("config-provider")) $("config-provider").focus(); });

for (const id of PAGES) {
  const nav = $("nav-" + id);
  if (nav) nav.addEventListener("click", () => showPage(id));
}
const RAIL_KEY = "yakusha.rail.collapsed";
function setRailCollapsed(collapsed) {
  document.body.classList.toggle("rail-collapsed", collapsed);
  setText("rail-toggle-icon", collapsed ? "»" : "«");
  const toggle = $("rail-toggle");
  if (toggle) {
    toggle.title = collapsed ? "Expand sidebar" : "Collapse sidebar";
    toggle.dataset.collapsed = collapsed ? "true" : "false";
    if (typeof toggle.setAttribute === "function") toggle.setAttribute("aria-expanded", String(!collapsed));
  }
}
const railToggle = $("rail-toggle");
if (railToggle) railToggle.addEventListener("click", () => {
  const collapsed = !document.body.classList.contains("rail-collapsed");
  setRailCollapsed(collapsed);
  try { localStorage.setItem(RAIL_KEY, collapsed ? "1" : "0"); } catch { /* storage is optional */ }
});
try { setRailCollapsed(localStorage.getItem(RAIL_KEY) === "1"); } catch { setRailCollapsed(false); }

const brandHome = $("brand-home");
if (brandHome) brandHome.addEventListener("click", (event) => { if (event && event.preventDefault) event.preventDefault(); showPage("overview"); });
for (const id of SETTINGS_TABS) {
  const tab = $("tab-" + id);
  if (tab) tab.addEventListener("click", () => showSettingsTab(id));
}

// Credentials: the key is typed once, sent to the main process for DPAPI
// storage (or clearing), and the input is emptied immediately.
const keySave = $("key-save");
if (keySave) keySave.addEventListener("click", async () => {
  const key = $("key-input").value;
  if (!key) return;
  const result = await window.yakusha.saveApiKey(key);
  $("key-input").value = "";
  $("key-state").textContent = result.saved ? "key stored (encrypted)" : "not stored: " + (result.reason || "?");
});
const keyClear = $("key-clear");
if (keyClear) keyClear.addEventListener("click", async () => {
  await window.yakusha.clearApiKey();
  $("key-state").textContent = "stored key removed";
  $("key-use").checked = false;
});
if (window.yakusha.hasApiKey) window.yakusha.hasApiKey().then((has) => {
  if (!has) $("key-use").disabled = true;
  $("key-state").textContent = has ? "a stored key is available" : "no stored key";
});
const keyUse = $("key-use");
if (keyUse) keyUse.addEventListener("change", () => {
  if (!keyUse.checked) return;
  window.yakusha.hasApiKey().then((has) => {
    if (!has) { keyUse.checked = false; $("key-state").textContent = "no stored key — enter and remember one first"; }
  });
});

// Export asks for a destination file (native dialog in main; prompt fallback for older preloads).
async function doExport() {
  if (!currentDir) { setProjectLine("pick a project first"); return; }
  const suggested = currentDir.replace(/[\\/]+$/, "") + "-export.json";
  let out = null;
  if (typeof window.yakusha.pickSaveFile === "function") out = await window.yakusha.pickSaveFile(suggested, "JSON file", ["json"]);
  else out = window.prompt("Export file (absolute path)", suggested);
  if (!out) return;
  await run("export", [currentDir], { out: String(out).trim(), format: "json", force: true });
}

const importRun = $("import-run");
if (importRun) importRun.addEventListener("click", async () => {
  if (!currentDir) { setProjectLine("pick a project first"); return; }
  let from = null;
  if (typeof window.yakusha.pickOpenFile === "function") from = await window.yakusha.pickOpenFile("Import table", ["tsv", "csv", "json", "jsonl"]);
  else from = window.prompt("File to import (absolute path, .tsv/.csv/.json/.jsonl)");
  if (!from) return;
  const strategy = window.prompt("Strategy: only-empty or overwrite", "only-empty") || "only-empty";
  await run("import", [currentDir], { from: String(from).trim(), strategy: strategy.trim() });
});

const launchRun = $("launch-run");
if (launchRun) launchRun.addEventListener("click", () => launchCurrent(false));
const launchOriginal = $("launch-original");
if (launchOriginal) launchOriginal.addEventListener("click", () => launchCurrent(true));
const launchTranslated = $("launch-translated");
if (launchTranslated) launchTranslated.addEventListener("click", () => launchCurrent(false));
const workflowLaunch = $("workflow-launch");
if (workflowLaunch) workflowLaunch.addEventListener("click", () => launchCurrent(false));

// Dictionary editor: one pending entry at a time.
const dictLoad = $("dict-load");
if (dictLoad) dictLoad.addEventListener("click", async () => {
  if (!currentDir) { setProjectLine("pick a project first"); return; }
  const result = await window.yakusha.loadDictionary(currentDir);
  if (!result || result.ok === false) { $("dict-summary").textContent = (result && result.error ? result.error.code + ": " : "") + (result && result.error ? result.error.message : "cannot read the dictionary"); return; }
  dictState = result;
  $("dict-summary").textContent = result.translated + " translated, " + result.pendingCount + " pending (" + result.entries.length + " keys)";
  const pendingEntries = result.entries.filter((entry) => entry.pending).slice(0, 200);
  const select = $("dict-key"); select.innerHTML = "";
  for (const entry of pendingEntries) { const option = document.createElement("option"); option.value = entry.key; option.textContent = entry.key.length > 80 ? entry.key.slice(0, 77) + "…" : entry.key; select.appendChild(option); }
  select.hidden = pendingEntries.length === 0; $("dict-text").hidden = pendingEntries.length === 0; $("dict-save").hidden = pendingEntries.length === 0;
  if (pendingEntries.length > 0) { $("dict-text").value = ""; $("dict-summary").textContent += " — showing the first " + pendingEntries.length + " pending"; }
  else if (result.pendingCount === 0) $("dict-summary").textContent += " — nothing pending";
});
const dictSave = $("dict-save");
if (dictSave) dictSave.addEventListener("click", async () => {
  if (!dictState) return;
  const key = $("dict-key").value;
  const result = await window.yakusha.saveEntry(currentDir, key, $("dict-text").value);
  if (!result || result.ok === false) { $("dict-summary").textContent = (result && result.error ? result.error.code + ": " : "") + (result && result.error ? result.error.message : "cannot save the entry"); return; }
  $("dict-summary").textContent = result.translated + " translated, " + result.pendingCount + " pending";
  $("dict-load").click();
});

const pick = $("pick");
if (pick) pick.addEventListener("click", async () => {
  const picked = await window.yakusha.pickDirectory();
  if (picked) { currentDir = null; currentTitle = ""; setProjectInput(picked, "directory", picked); showPage("overview"); run("scan", [picked]); }
});

const cancel = $("cancel");
if (cancel) cancel.addEventListener("click", () => window.yakusha.cancel());

window.yakusha.onProgress(({ runId, progress }) => {
  if (runId !== runSeq) return;
  setHidden("progress", false);
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  $("bar-fill").style.width = pct + "%";
  const bar = $("progress-bar"); if (bar && bar.setAttribute) bar.setAttribute("aria-valuenow", String(pct));
  $("progress-text").textContent = progress.done + "/" + progress.total + " entries, " + progress.translated + " translated";
});

window.yakusha.onWarning(({ line }) => showToast({ title: "Warning", detail: brief(line, 180), kind: "warning", timeout: 6000 }));

async function initLogSummary() {
  if (typeof window.yakusha.logPath !== "function") return;
  try { const file = await window.yakusha.logPath(); if (file) $("log-summary").textContent = "Detailed output: " + file; } catch { /* convenience */ }
}
initLogSummary();
renderRecent();
updateTask();
updateHealth();
updateLaunchButtons();
showPage("overview");
showSettingsTab("service");

// Bottom log dock: one small toggle, fetched on demand from the JSONL log.
function parseLogEntry(entry) {
  if (typeof entry !== "string") return entry;
  try { return JSON.parse(entry); } catch { return entry; }
}
function logLineText(entry) {
  const value = parseLogEntry(entry);
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return String(value);
  const time = value.time ? String(value.time).slice(11, 19) : "";
  const bits = [time, value.event, value.command, value.outcome, value.code, value.message].filter(Boolean);
  return bits.join(" · ");
}
function renderLogLines(lines) {
  const box = $("log-lines");
  if (!box) return;
  box.innerHTML = "";
  for (const entry of lines) {
    const parsed = parseLogEntry(entry);
    const line = document.createElement("div");
    line.className = "log-line";
    if (parsed && typeof parsed === "object" && parsed.event) line.dataset.event = String(parsed.event);
    line.textContent = logLineText(entry);
    box.appendChild(line);
  }
  setText("log-count", lines.length ? String(lines.length) : "");
}
async function refreshLog() {
  if (typeof window.yakusha.logTail !== "function") { setText("log-summary", "Log tail is unavailable in this build."); return; }
  try {
    const result = await window.yakusha.logTail({ limit: 200 });
    if (!result || result.ok === false) { setText("log-summary", "Could not read the log file."); return; }
    const lines = Array.isArray(result.lines) ? result.lines : [];
    if (result.path) setText("log-summary", "Detailed output: " + result.path);
    renderLogLines(lines);
  } catch (error) { setText("log-summary", brief(error && error.message ? error.message : error)); }
}
function setLogVisible(visible) {
  const dock = $("log-dock");
  const toggle = $("log-toggle");
  if (dock) dock.hidden = !visible;
  if (toggle && typeof toggle.setAttribute === "function") toggle.setAttribute("aria-expanded", visible ? "true" : "false");
  if (visible) refreshLog();
}
const logToggle = $("log-toggle");
if (logToggle) logToggle.addEventListener("click", () => setLogVisible(Boolean($("log-dock") && $("log-dock").hidden)));
const logClose = $("log-close");
if (logClose) logClose.addEventListener("click", () => setLogVisible(false));
const logRefresh = $("log-refresh");
if (logRefresh) logRefresh.addEventListener("click", () => refreshLog());
setLogVisible(false);
const logOpen = $("log-open");
if (logOpen) logOpen.addEventListener("click", async () => {
  if (typeof window.yakusha.openLog !== "function") return;
  const result = await window.yakusha.openLog();
  if (!result || result.ok === false) showToast({ title: "Log", detail: result && result.error ? result.error : "could not open the log file", kind: "error", timeout: 8000 });
});

// Settings form.
const configSave = $("config-save");
if (configSave) configSave.addEventListener("click", saveConfigForm);
const configClear = $("config-clear");
if (configClear) configClear.addEventListener("click", clearConfigForm);
const queryModelsButton = $("config-query-models");
if (queryModelsButton) queryModelsButton.addEventListener("click", queryModels);

// Drag & drop: the File object must go through webUtils in preload.
document.addEventListener("dragover", (e) => { e.preventDefault(); document.body.classList.add("dragging"); });
document.addEventListener("dragleave", () => document.body.classList.remove("dragging"));
document.addEventListener("drop", async (e) => {
  e.preventDefault(); document.body.classList.remove("dragging");
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (!file) return;
  const dropped = window.yakusha.pathForFile(file);
  if (!dropped) return;
  let resolved = { input: dropped, path: dropped, kind: "directory" };
  if (typeof window.yakusha.resolveInput === "function") { const answer = await window.yakusha.resolveInput(dropped); if (answer && answer.path) resolved = answer; }
  currentDir = null; currentTitle = ""; setProjectInput(resolved.input || dropped, resolved.kind, resolved.path || dropped); showPage("overview"); run("scan", [resolved.path || dropped]);
});
