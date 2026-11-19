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
const UI_LANG_KEY = "yakusha.lang";
let uiLanguage = "en";

function t(key, params) {
  return typeof YAKUSHA_I18N !== "undefined" ? YAKUSHA_I18N.t(key, params) : key;
}

function commandLabel(command) {
  const key = "cmd." + command;
  const label = t(key);
  return label === key ? command : label;
}

let keyState = null;
let logSummaryState = null;
let modelStatusState = null;
let configValues = null;
let configEmpty = false;
let configStateKey = null;

function setKeyState(key, params) {
  keyState = { key, params };
  setText("key-state", t(key, params));
}

function setLogSummary(key, params) {
  logSummaryState = { key, params };
  setText("log-summary", t(key, params));
}

function setModelStatus(key, params) {
  modelStatusState = { key, params };
  setText("config-model-status", t(key, params));
}

function renderConfigSummary() {
  if (configEmpty) { setText("config-summary", t("config.summary.empty")); return; }
  if (!configValues) { setText("config-summary", t("config.summary.loading")); return; }
  const label = (entry) => entry && entry.value ? entry.value : t("config.notSet");
  setText("config-summary", t("config.summary", {
    provider: label(configValues.provider),
    apiFormat: label(configValues.apiFormat),
    model: label(configValues.model),
    baseUrl: label(configValues.baseUrl),
  }));
}

function setConfigState(key) {
  configStateKey = key;
  setText("config-state", key ? t(key) : "");
}

function refreshDictionarySummary() {
  if (!dictState) { setText("dict-summary", t("dictionary.summary")); return; }
  let text = t("dict.summary", { translated: dictState.translated, pending: dictState.pendingCount, keys: dictState.entries.length });
  const pending = dictState.entries.filter((entry) => entry.pending);
  if (pending.length > 0) text += t("dict.showing", { count: Math.min(pending.length, 200) });
  else if (dictState.pendingCount === 0) text += t("dict.nothing");
  setText("dict-summary", text);
}

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
    return error ? error.code + " · " + brief(error.message) : t("summary.failed");
  }
  const e = envelope;
  if (command === "scan") {
    const bits = [];
    if (e.engine) bits.push(e.engine + (e.engineVersion ? " " + e.engineVersion : ""));
    if (e.gameTitle) bits.push(brief(e.gameTitle, 60));
    if (e.dataFiles !== undefined) bits.push(t("summary.dataFiles", { count: e.dataFiles }));
    if (e.uniqueStrings !== undefined) bits.push(t("summary.strings", { count: e.uniqueStrings }));
    return bits.join(" · ") || t("summary.projectDetected");
  }
  if (command === "extract") {
    return (e.added !== undefined ? t("summary.added", { added: e.added }) : t("summary.dictionaryUpdated")) +
      (e.total !== undefined ? t("summary.total", { total: e.total }) : "");
  }
  if (command === "status" || command === "translate") {
    const head = e.translated !== undefined && e.total !== undefined
      ? t("summary.translatedRatio", { translated: e.translated, total: e.total })
      : t("summary.translationUpdated");
    const tail = e.pending !== undefined ? t("summary.pending", { pending: e.pending }) : "";
    return head + tail;
  }
  if (command === "verify") {
    return (e.translated !== undefined ? t("summary.translatedRatio", { translated: e.translated, total: e.total }) : t("summary.verificationComplete")) +
      (e.rejected ? t("summary.rejected", { rejected: e.rejected }) : "") +
      (envelope.outcome === "findings" ? t("summary.findings") : "");
  }
  if (command === "install") {
    if (e.native) {
      const files = e.native.files ? e.native.files.length : 0;
      return t("summary.nativeLayer", { files }) +
        (e.native.dictionaryEntries !== undefined ? t("summary.nativeStrings", { entries: e.native.dictionaryEntries }) : "");
    }
    if (e.patch) return t("summary.patchLayer", { entries: e.patch.entries || 0, files: e.patch.files || 0 });
    return t("summary.installed");
  }
  if (command === "uninstall") return e.restored ? t("summary.uninstalledRestored") : t("summary.uninstalled");
  if (command === "export") return (e.entries !== undefined ? t("summary.entries", { entries: e.entries }) : t("summary.exported")) + (e.format ? " · " + e.format : "");
  if (command === "import") {
    return (e.read !== undefined ? t("summary.read", { read: e.read }) : t("summary.imported")) +
      (e.applied !== undefined ? t("summary.applied", { applied: e.applied }) : "") +
      (e.skipped !== undefined ? t("summary.skipped", { skipped: e.skipped }) : "");
  }
  if (command === "launch") return e.pid ? t("summary.gameStartedPid", { pid: e.pid }) : t("summary.gameStarted");
  if (command === "doctor") return e.verdict ? t("summary.verdict", { verdict: e.verdict }) : t("summary.checkComplete");
  if (command === "speaker") return e.entries !== undefined ? t("summary.namesAcross", { names: e.names || 0, entries: e.entries }) : t("summary.speakerUpdated");
  if (command === "terms") return e.names !== undefined ? t("summary.namesMined", { names: e.names }) : t("summary.termsMined");
  if (command === "config") {
    if (e.values) return t("summary.configLoaded");
    if (e.action === "set") return t("summary.configSaved", { key: e.key });
    if (e.action === "unset") return t("summary.configCleared", { key: e.key });
    return t("summary.configuration");
  }
  return t("summary.completed");
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
  const distinct = selectedInput && selectedInput !== scanRoot;
  if (!selectedInput || (selectedKind !== "file" && !distinct)) {
    line.hidden = true; line.textContent = ""; line.title = ""; return;
  }
  const label = selectedKind === "file" ? t("input.file") : selectedKind === "directory" ? t("input.folder") : t("input.path");
  line.hidden = false;
  line.textContent = t("input.selected", { label, path: selectedInput });
  line.title = selectedInput;
}

function setProjectLine(text) {
  setText("project-line", text, text);
}

function setProjectTitle(title) {
  const resolved = title || t("project.none");
  setText("project-title", resolved, resolved);
  setText("sidebar-project-name", resolved, resolved);
}

/** Show page navigation without rebuilding any panel (running jobs keep their state). */
function showPage(name) {
  const page = PAGES.includes(name) ? name : "overview";
  document.body.dataset.page = page;
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
    if (typeof button.setAttribute === "function") {
      button.setAttribute("aria-selected", id === tab ? "true" : "false");
      button.setAttribute("tabindex", id === tab ? "0" : "-1");
    }
  }
}

/** Remember what the user chose and what the next scan should receive. */
function setProjectInput(input, kind, target) {
  selectedInput = input || null;
  selectedKind = kind || "";
  scanRoot = target || input || null;
  updateInputLine();
  if (!currentDir) {
    setProjectTitle(scanRoot ? t("project.selecting", { name: baseName(scanRoot) }) : t("project.none"));
    setProjectLine(scanRoot ? t("project.state.scanning") : t("project.dropHint"));
  }
}

/** Show the canonical root the scan resolved, which commands then operate on. */
function showProjectRoot(root, title) {
  currentDir = root || null;
  currentTitle = title || "";
  const label = currentTitle || (root ? baseName(root) : "");
  if (root) {
    setProjectTitle(currentTitle || baseName(root));
    setProjectLine(t("project.state.ready"));
    setText("project-card-title", label);
    setText("project-card-line", root, root);
    setText("project-state", t("project.state.ready"));
    if (!selectedInput) { selectedInput = root; selectedKind = "directory"; scanRoot = root; updateInputLine(); }
  } else {
    setProjectTitle(t("project.none"));
    setProjectLine(t("project.dropHint"));
    setText("project-card-title", t("project.card.none"));
    setText("project-card-line", t("project.card.hint"));
    setText("project-state", t("project.state.waiting"));
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
  const title = tier.titleKey ? t(tier.titleKey) : tier.title;
  const summary = tier.summaryKey ? t(tier.summaryKey) : tier.summary;
  const cautionText = tier.cautionKey ? t(tier.cautionKey) : tier.caution || "";
  setText("delivery-tier", tier.key);
  setText("delivery-title", title);
  setText("delivery-copy", summary);
  const caution = $("delivery-caution");
  if (caution) { caution.textContent = cautionText; caution.hidden = !cautionText; }
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
  const prepareState = ui.scanned && ui.extracted ? "done" : "current";
  const translateState = ui.verified ? "done" : ui.extracted ? "current" : "next";
  const deliverState = ui.installed ? "done" : ui.verified ? "current" : "next";
  setStage("stage-prepare", prepareState);
  setStage("stage-translate", translateState);
  setStage("stage-deliver", deliverState);
  const statusLabel = (state) => state === "done" ? t("stage.status.done") : state === "current" ? t("stage.status.now") : t("stage.status.later");
  setText("stage-prepare-status", statusLabel(prepareState));
  setText("stage-translate-status", statusLabel(translateState));
  setText("stage-deliver-status", statusLabel(deliverState));
  const chip = ui.installed ? t("task.installed") : ui.verified ? t("task.readyInstall") : ui.scanned ? t("task.inProgress") : t("task.ready");
  setStatusChip("task-state", chip, ui.installed ? "done" : ui.scanned ? "active" : "");
}

function updateTask() {
  let key = "pick";
  let action = "pick";
  if (ui.installed) {
    key = "installed";
    action = "launch";
  } else if (ui.verified) {
    key = "verified";
    action = "install";
  } else if (ui.translated) {
    key = "translated";
    action = "verify";
  } else if (ui.extracted) {
    key = "extracted";
    action = "translate";
  } else if (ui.scanned) {
    key = "scanned";
    action = "extract";
  }
  setText("task-title", t("task." + key + ".title"));
  setText("task-copy", t("task." + key + ".copy"));
  const primary = $("primary-action");
  if (primary) { primary.textContent = t("task." + key + ".button"); primary.dataset.action = action; }
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
  setText("last-run-title", t("toast.running", { command: commandLabel(command) }));
  setText("last-run-detail", target ? t("toast.workingOn", { target }) : t("toast.working"));
  setText("last-run-time", t("toast.now"));
  const card = $("last-run");
  if (card && card.classList) { card.classList.remove("is-error", "is-success"); }
}

function setLastRunResult(command, envelope) {
  const summary = summaryFor(command, envelope);
  setText("last-run-title", t(envelope.ok ? "toast.complete" : "toast.failed", { command: commandLabel(command) }));
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
  if (single) { single.disabled = !launchable; single.title = launchable ? "" : t("launch.unavailable"); }
  const original = $("launch-original");
  if (original) { original.disabled = !launchable; original.title = launchable ? "" : t("launch.unavailable"); }
  const translated = $("launch-translated");
  if (translated) {
    const hasText = ui.translatedCount !== null ? Number(ui.translatedCount) > 0 : ui.translated;
    const ready = launchable && ui.installed && hasText;
    translated.disabled = !ready;
    translated.title = !hasText ? t("launch.notTranslated") : !ui.installed ? t("launch.installFirst") : launchable ? "" : t("launch.unavailable");
  }
  const workflow = $("workflow-launch");
  if (workflow) { workflow.disabled = !launchable; workflow.title = launchable ? "" : t("launch.scanFirst"); }
}

function setUiLanguage(lang, persist) {
  if (typeof YAKUSHA_I18N === "undefined") return;
  uiLanguage = YAKUSHA_I18N.setLanguage(lang);
  YAKUSHA_I18N.apply(document);
  if (document.documentElement) document.documentElement.lang = uiLanguage;
  setValue("ui-language", uiLanguage);
  if (persist) { try { localStorage.setItem(UI_LANG_KEY, uiLanguage); } catch { /* storage is optional */ } }
  refreshLanguageDependentUi();
}

function refreshLanguageDependentUi() {
  updateInputLine();
  if (currentDir) showProjectRoot(currentDir, currentTitle);
  else if (scanRoot) {
    setProjectTitle(t("project.selecting", { name: baseName(scanRoot) }));
    setProjectLine(t("project.scanning", { root: scanRoot }));
  } else {
    setProjectTitle(t("project.none"));
    setProjectLine(t("project.dropHint"));
  }
  updateTask();
  updateHealth();
  updateStages();
  updateLaunchButtons();
  renderRecent();
  renderConfigSummary();
  if (configStateKey) setText("config-state", t(configStateKey));
  if (keyState) setText("key-state", t(keyState.key, keyState.params));
  if (logSummaryState) setText("log-summary", t(logSummaryState.key, logSummaryState.params));
  if (modelStatusState) setText("config-model-status", t(modelStatusState.key, modelStatusState.params));
  refreshDictionarySummary();
  setRailCollapsed(document.body.classList.contains("rail-collapsed"));
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
  configValues = values;
  configEmpty = false;
  renderConfigSummary();
  setHidden("service-banner", Boolean(provider));
  if (provider) setConfigState("service.state.configured");
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
  if (!values.provider) { showToast({ title: t("toast.settings"), detail: t("service.chooseProvider"), kind: "warning", timeout: 6000 }); return; }
  if ((values.provider === "openai" || values.provider === "compatible") && !values.model) {
    showToast({ title: t("toast.settings"), detail: t("service.modelRequired"), kind: "warning", timeout: 6000 }); return;
  }
  if (values.provider === "compatible" && !values.baseUrl) {
    showToast({ title: t("toast.settings"), detail: t("service.baseUrlRequired"), kind: "warning", timeout: 6000 }); return;
  }
  const jobs = [["provider", values.provider], ["apiFormat", values.apiFormat || "chat-completions"]];
  if (values.baseUrl) jobs.push(["baseUrl", values.baseUrl]);
  if (values.model) jobs.push(["model", values.model]);
  try {
    for (const [key, value] of jobs) {
      const envelope = await window.yakusha.run("config", ["set", key, value], {}, 0, false);
      if (!envelope || envelope.ok === false) {
        showToast({ title: t("toast.settings"), detail: summaryFor("config", envelope), kind: "error", timeout: 8000 });
        return;
      }
    }
    const current = await window.yakusha.run("config", ["list"], {}, 0, false);
    if (current && current.ok) applyConfig(current);
    setConfigState("service.state.saved");
    showToast({ title: t("toast.settings"), detail: t("service.savedToast"), kind: "success", timeout: 6000 });
  } catch (error) {
    showToast({ title: t("toast.settings"), detail: brief(error && error.message ? error.message : error), kind: "error", timeout: 8000 });
  }
}

async function clearConfigForm() {
  try {
    for (const key of ["provider", "model", "baseUrl", "apiFormat"]) {
      const envelope = await window.yakusha.run("config", ["unset", key], {}, 0, false);
      if (!envelope || envelope.ok === false) {
        showToast({ title: t("toast.settings"), detail: summaryFor("config", envelope), kind: "error", timeout: 8000 });
        return;
      }
    }
    const select = $("config-provider"); if (select) select.value = "";
    setValue("config-api-format", "chat-completions");
    setValue("config-model", "");
    setValue("config-base-url", "");
    renderModelList([]);
    modelStatusState = null;
    setText("config-model-status", "");
    configValues = null;
    configEmpty = true;
    renderConfigSummary();
    setConfigState("service.state.cleared");
    setHidden("service-banner", false);
    showToast({ title: t("toast.settings"), detail: t("service.clearedToast"), kind: "success", timeout: 6000 });
  } catch (error) {
    showToast({ title: t("toast.settings"), detail: brief(error && error.message ? error.message : error), kind: "error", timeout: 8000 });
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
    button.title = t("service.useModel", { model });
    button.addEventListener("click", () => {
      setValue("config-model", model);
      for (const child of list.children) if (child.classList) child.classList.remove("is-selected");
      button.classList.add("is-selected");
      setText("config-model-status", t("service.modelSelected", { model }));
    });
    list.appendChild(button);
  }
  list.hidden = false;
}

async function queryModels() {
  const values = readConfigForm();
  if (!values.provider) { showToast({ title: t("toast.models"), detail: t("service.chooseProvider"), kind: "warning", timeout: 6000 }); return; }
  if (values.provider === "compatible" && !values.baseUrl) { showToast({ title: t("toast.models"), detail: t("service.setBaseUrl"), kind: "warning", timeout: 6000 }); return; }
  setModelStatus("service.fetching");
  if (typeof window.yakusha.listModels !== "function") { setModelStatus("service.fetchUnavailable"); return; }
  try {
    const result = await window.yakusha.listModels({ provider: values.provider, baseUrl: values.baseUrl });
    if (!result || result.ok === false) {
      const error = result && result.error;
      modelStatusState = null; setText("config-model-status", error ? error.code + " · " + brief(error.message) : t("service.fetchFailed"));
      return;
    }
    const models = Array.isArray(result.models) ? result.models : [];
    renderModelList(models);
    setModelStatus("service.modelsAvailable", { count: models.length, noun: models.length === 1 ? "model" : "models" });
  } catch (error) {
    setText("config-model-status", brief(error && error.message ? error.message : error));
  }
}

async function run(command, args, flags) {
  const runId = ++runSeq;
  const requestArgs = args || (currentDir ? [currentDir] : []);
  if (command === "scan") {
    setText("project-state", t("project.state.scanning"));
    if (!args && requestArgs[0]) {
      scanRoot = requestArgs[0];
      if (!selectedInput) { selectedInput = requestArgs[0]; selectedKind = "directory"; updateInputLine(); }
    }
  }
  const cancel = $("cancel"); if (cancel) cancel.disabled = false;
  const useStoredKey = command === "translate" && $("key-use") && $("key-use").checked;
  const target = requestArgs[0] ? baseName(requestArgs[0]) : "";
  setLastRunBusy(command, target);
  const pending = showToast({ title: commandLabel(command), detail: target ? t("toast.workingOn", { target }) : t("toast.working"), kind: "busy", timeout: 0 });
  let envelope;
  try {
    envelope = await window.yakusha.run(command, requestArgs, flags, runId, useStoredKey);
  } catch (error) {
    updateToast(pending, { title: commandLabel(command), detail: brief(error && error.message ? error.message : error), kind: "error", timeout: 8000 });
    setLastRunResult(command, { ok: false, outcome: "error", error: { code: "E_INTERNAL", message: error && error.message ? error.message : error } });
    throw error;
  }
  if (cancel) cancel.disabled = true;
  setHidden("progress", true);
  const toastKind = envelope.ok ? "success" : envelope.outcome === "findings" ? "warning" : "error";
  updateToast(pending, { title: commandLabel(command), detail: summaryFor(command, envelope), kind: toastKind, timeout: envelope.ok ? 4200 : 8000 });
  setLastRunResult(command, envelope);
  if (envelope.error && envelope.error.code === "E_CONFIG") setHidden("service-banner", false);
  if (command === "config" && envelope.ok && envelope.values) applyConfig(envelope);
  if (command === "scan" && envelope.ok) {
    const e = envelope;
    const badge = $("engine-badge");
    if (badge) { badge.hidden = false; badge.textContent = (e.engine || "?") + (e.engineVersion ? " " + e.engineVersion : ""); }
    const cardBadge = $("project-card-engine");
    if (cardBadge) { cardBadge.hidden = false; cardBadge.textContent = (e.engine || "?") + (e.engineVersion ? " " + e.engineVersion : ""); }
    showProjectRoot(e.root, e.gameTitle || t("project.untitled"));
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
      if (btn) { btn.disabled = noDelivery; btn.title = noDelivery ? t("install.noDelivery") : ""; }
    }
    updateHealth(); updateTask();
    await refreshProjectState(e.root, e.engine || "");
  }
  if (command === "scan" && !envelope.ok) {
    if (envelope.error && envelope.error.code === "E_MULTI_ROOT") setProjectLine(t("project.multiRoot"));
    else if (!currentDir) setProjectLine(t("project.notFound", { path: scanRoot || requestArgs[0] || t("project.chooseFolder") }));
    setText("project-state", currentDir ? t("project.state.scanFailed") : t("project.state.needsAttention"));
    if (!currentDir) setProjectTitle(t("project.none"));
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
    if (!ui.verified) showToast({ title: t("toast.verify"), detail: t("toast.verifyErrors", { errors: envelope.errors || 0 }), kind: "warning", timeout: 9000 });
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
  if (!currentDir) { setProjectLine(t("toast.pickFirst")); return; }
  let exe = "";
  if (typeof window.yakusha.pickExecutable === "function") {
    exe = await window.yakusha.pickExecutable(currentDir);
    if (exe === null) return;
  }
  const flags = exe && String(exe).trim() ? { exe: String(exe).trim() } : {};
  if (original) flags.original = true;
  const envelope = await run("launch", [currentDir], flags);
  if (!envelope.ok && envelope.error && envelope.error.code === "E_EXE" && envelope.error.details && Array.isArray(envelope.error.details.candidates)) setProjectLine(t("launch.pickOne", { candidates: envelope.error.details.candidates.join(", ") }));
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
    toggle.title = collapsed ? t("rail.expand") : t("rail.collapse");
    toggle.dataset.collapsed = collapsed ? "true" : "false";
    if (typeof toggle.setAttribute === "function") {
      toggle.setAttribute("aria-expanded", String(!collapsed));
      toggle.setAttribute("aria-label", collapsed ? t("rail.expand") : t("rail.collapse"));
    }
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
document.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  const active = document.activeElement;
  const index = SETTINGS_TABS.findIndex((id) => $("tab-" + id) === active);
  if (index < 0) return;
  event.preventDefault();
  const step = event.key === "ArrowRight" ? 1 : -1;
  const next = SETTINGS_TABS[(index + step + SETTINGS_TABS.length) % SETTINGS_TABS.length];
  showSettingsTab(next);
  const button = $("tab-" + next);
  if (button && typeof button.focus === "function") button.focus();
});

// Credentials: the key is typed once, sent to the main process for DPAPI
// storage (or clearing), and the input is emptied immediately.
const keySave = $("key-save");
if (keySave) keySave.addEventListener("click", async () => {
  const key = $("key-input").value;
  if (!key) return;
  const result = await window.yakusha.saveApiKey(key);
  $("key-input").value = "";
  if (result.saved) setKeyState("credentials.keyStored"); else setKeyState("credentials.notStored", { reason: result.reason || "?" });
});
const keyClear = $("key-clear");
if (keyClear) keyClear.addEventListener("click", async () => {
  await window.yakusha.clearApiKey();
  setKeyState("credentials.removed");
  $("key-use").checked = false;
});
if (window.yakusha.hasApiKey) window.yakusha.hasApiKey().then((has) => {
  if (!has) $("key-use").disabled = true;
  setKeyState(has ? "credentials.stored" : "credentials.none");
});
const keyUse = $("key-use");
if (keyUse) keyUse.addEventListener("change", () => {
  if (!keyUse.checked) return;
  window.yakusha.hasApiKey().then((has) => {
    if (!has) { keyUse.checked = false; setKeyState("credentials.enterFirst"); }
  });
});

// Export asks for a destination file (native dialog in main; prompt fallback for older preloads).
async function doExport() {
  if (!currentDir) { setProjectLine(t("toast.pickFirst")); return; }
  const suggested = currentDir.replace(/[\\/]+$/, "") + "-export.json";
  let out = null;
  if (typeof window.yakusha.pickSaveFile === "function") out = await window.yakusha.pickSaveFile(suggested, "JSON file", ["json"]);
  else out = window.prompt(t("export.prompt"), suggested);
  if (!out) return;
  await run("export", [currentDir], { out: String(out).trim(), format: "json", force: true });
}

const importRun = $("import-run");
if (importRun) importRun.addEventListener("click", async () => {
  if (!currentDir) { setProjectLine(t("toast.pickFirst")); return; }
  let from = null;
  if (typeof window.yakusha.pickOpenFile === "function") from = await window.yakusha.pickOpenFile("Import table", ["tsv", "csv", "json", "jsonl"]);
  else from = window.prompt(t("import.prompt"));
  if (!from) return;
  const strategy = window.prompt(t("import.strategy"), "only-empty") || "only-empty";
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
  if (!currentDir) { setProjectLine(t("toast.pickFirst")); return; }
  const result = await window.yakusha.loadDictionary(currentDir);
  if (!result || result.ok === false) { $("dict-summary").textContent = (result && result.error ? result.error.code + ": " : "") + (result && result.error ? result.error.message : t("dict.cannotRead")); return; }
  dictState = result;
  refreshDictionarySummary();
  const pendingEntries = result.entries.filter((entry) => entry.pending).slice(0, 200);
  const select = $("dict-key"); select.innerHTML = "";
  for (const entry of pendingEntries) { const option = document.createElement("option"); option.value = entry.key; option.textContent = entry.key.length > 80 ? entry.key.slice(0, 77) + "…" : entry.key; select.appendChild(option); }
  select.hidden = pendingEntries.length === 0; $("dict-text").hidden = pendingEntries.length === 0; $("dict-save").hidden = pendingEntries.length === 0;
  if (pendingEntries.length > 0) $("dict-text").value = "";
});
const dictSave = $("dict-save");
if (dictSave) dictSave.addEventListener("click", async () => {
  if (!dictState) return;
  const key = $("dict-key").value;
  const result = await window.yakusha.saveEntry(currentDir, key, $("dict-text").value);
  if (!result || result.ok === false) { $("dict-summary").textContent = (result && result.error ? result.error.code + ": " : "") + (result && result.error ? result.error.message : t("dict.cannotSave")); return; }
  $("dict-summary").textContent = t("dict.summary", { translated: result.translated, pending: result.pendingCount, keys: result.entries ? result.entries.length : (dictState ? dictState.entries.length : 0) });
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
  $("progress-text").textContent = t("progress.text", { done: progress.done, total: progress.total, translated: progress.translated });
});

window.yakusha.onWarning(({ line }) => showToast({ title: t("toast.warning"), detail: brief(line, 180), kind: "warning", timeout: 6000 }));

async function initLogSummary() {
  if (typeof window.yakusha.logPath !== "function") return;
  try { const file = await window.yakusha.logPath(); if (file) setLogSummary("log.detailed", { path: file }); } catch { /* convenience */ }
}
initLogSummary();
setUiLanguage(typeof YAKUSHA_I18N !== "undefined" ? YAKUSHA_I18N.detect(recentStorage()) : "en", false);
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
  if (typeof window.yakusha.logTail !== "function") { setLogSummary("log.unavailable"); return; }
  try {
    const result = await window.yakusha.logTail({ limit: 200 });
    if (!result || result.ok === false) { setLogSummary("log.readError"); return; }
    const lines = Array.isArray(result.lines) ? result.lines : [];
    if (result.path) setLogSummary("log.detailed", { path: result.path });
    renderLogLines(lines);
  } catch (error) { setText("log-summary", brief(error && error.message ? error.message : error)); }
}
let lastLogFocus = null;
function logFocusables() {
  return ["log-close", "log-refresh", "log-open", "log-lines"].map((id) => $(id)).filter((node) => node && !node.disabled);
}
function setLogVisible(visible) {
  const dock = $("log-dock");
  const backdrop = $("log-backdrop");
  const toggle = $("log-toggle");
  if (visible) lastLogFocus = document.activeElement || toggle;
  if (dock) dock.hidden = !visible;
  if (backdrop) backdrop.hidden = !visible;
  if (document.body && document.body.classList) document.body.classList.toggle("log-open", visible);
  if (toggle && typeof toggle.setAttribute === "function") toggle.setAttribute("aria-expanded", visible ? "true" : "false");
  if (visible) {
    refreshLog();
    const close = $("log-close");
    if (close && typeof close.focus === "function") close.focus();
  } else if (lastLogFocus && typeof lastLogFocus.focus === "function") {
    lastLogFocus.focus();
  }
}
const logToggle = $("log-toggle");
if (logToggle) logToggle.addEventListener("click", () => setLogVisible(Boolean($("log-dock") && $("log-dock").hidden)));
const logClose = $("log-close");
if (logClose) logClose.addEventListener("click", () => setLogVisible(false));
const logBackdrop = $("log-backdrop");
if (logBackdrop) logBackdrop.addEventListener("click", () => setLogVisible(false));
document.addEventListener("keydown", (event) => {
  const dock = $("log-dock");
  if (!dock || dock.hidden) return;
  if (event.key === "Escape") { event.preventDefault(); setLogVisible(false); return; }
  if (event.key !== "Tab") return;
  const items = logFocusables();
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});
const logRefresh = $("log-refresh");
if (logRefresh) logRefresh.addEventListener("click", () => refreshLog());
setLogVisible(false);
const logOpen = $("log-open");
if (logOpen) logOpen.addEventListener("click", async () => {
  if (typeof window.yakusha.openLog !== "function") return;
  const result = await window.yakusha.openLog();
  if (!result || result.ok === false) showToast({ title: t("toast.log"), detail: result && result.error ? result.error : t("log.openError"), kind: "error", timeout: 8000 });
});

// Settings form.
const uiLanguageSelect = $("ui-language");
if (uiLanguageSelect) uiLanguageSelect.addEventListener("change", () => setUiLanguage(uiLanguageSelect.value, true));
const configSave = $("config-save");
if (configSave) configSave.addEventListener("click", saveConfigForm);
const configClear = $("config-clear");
if (configClear) configClear.addEventListener("click", clearConfigForm);
const queryModelsButton = $("config-query-models");
if (queryModelsButton) queryModelsButton.addEventListener("click", queryModels);

// Drag & drop: the File object must go through webUtils in preload.
// A drag enters and leaves every child element on the way to the drop target,
// so a single dragleave must not hide the overlay. Count the nested enters and
// only clear the state once the pointer has actually left the window.
let dragDepth = 0;
function showDropTarget() { dragDepth += 1; document.body.classList.add("dragging"); }
function hideDropTarget() { dragDepth = Math.max(0, dragDepth - 1); if (dragDepth === 0) document.body.classList.remove("dragging"); }
function clearDropTarget() { dragDepth = 0; document.body.classList.remove("dragging"); }

// The overlay is visual only. It must never become the element under the
// pointer, otherwise showing it steals the drag target and the browser can
// stop delivering dragover/drop to the page.
function droppedUriPath(dataTransfer) {
  if (!dataTransfer || typeof dataTransfer.getData !== "function") return "";
  const list = dataTransfer.getData("text/uri-list") || dataTransfer.getData("text/plain") || "";
  for (const line of list.split(/\r?\n/)) {
    const value = line.trim();
    if (!value || value.startsWith("#") || !value.startsWith("file://")) continue;
    try {
      const url = new URL(value);
      let pathname = decodeURIComponent(url.pathname);
      if (/^\/[A-Za-z]:/.test(pathname)) pathname = pathname.slice(1);
      if (url.hostname) pathname = "//" + url.hostname + pathname;
      return pathname.replace(/\//g, "\\");
    } catch { /* try the next URI */ }
  }
  return "";
}

window.addEventListener("dragenter", (e) => { e.preventDefault(); showDropTarget(); }, true);
window.addEventListener("dragover", (e) => {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  document.body.classList.add("dragging");
}, true);
window.addEventListener("dragleave", (e) => { e.preventDefault(); hideDropTarget(); }, true);
window.addEventListener("drop", async (e) => {
  e.preventDefault();
  clearDropTarget();
  const transfer = e.dataTransfer;
  const file = transfer && transfer.files && transfer.files[0];
  let dropped = "";
  if (file) {
    try { dropped = window.yakusha.pathForFile(file) || ""; }
    catch (error) { dropped = ""; }
  }
  if (!dropped) dropped = droppedUriPath(transfer);
  if (!dropped) {
    showToast({ title: t("toast.drop"), detail: t("toast.dropNoPath"), kind: "error", timeout: 8000 });
    return;
  }
  let resolved = { input: dropped, path: dropped, kind: "directory" };
  if (typeof window.yakusha.resolveInput === "function") { const answer = await window.yakusha.resolveInput(dropped); if (answer && answer.path) resolved = answer; }
  currentDir = null; currentTitle = ""; setProjectInput(resolved.input || dropped, resolved.kind, resolved.path || dropped); showPage("overview"); run("scan", [resolved.path || dropped]);
}, true);
