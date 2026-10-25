/**
 * Install / remove the runtime plugin inside a game folder.
 *
 * Installing is deliberately boring and reversible:
 *
 *   1. js/plugins.js is copied to js/plugins.js.yakusha-backup once.
 *   2. The plugin entry is appended (or re-enabled) in $plugins.
 *   3. YAKUSHA_Translator.js is written next to the game's own plugins.
 *
 * Uninstalling reverses exactly those three steps, so a game that never had
 * yakusha is byte identical afterwards.
 *
 * @module core/install
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildRules } from "./fields.js";
import {
  readPluginsFile,
  parsePluginsJs,
  serialisePluginsJs,
  pluginsJsLayout,
  upsertPlugin,
  removePlugin,
} from "./pluginsfile.js";

export const PLUGIN_NAME = "YAKUSHA_Translator";
export const PLUGIN_FILE = "YAKUSHA_Translator.js";
export const BACKUP_SUFFIX = ".yakusha-backup";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.join(HERE, "..", "plugin", PLUGIN_FILE);

/**
 * @typedef {{ pluginPath: string, registered: boolean, backupPath: string|null, createdBackup: boolean, staleBackup: boolean, state: "added"|"enabled"|"unchanged" }} InstallResult
 */

/**
 * Render the plugin source for a game.
 *
 * The rules blob is regenerated from {@link buildRules} on every install so the
 * shipped plugin can never disagree with the extractor.
 *
 * @param {{ embed?: Record<string,string>|null }} [options]
 * @returns {string}
 */
export function renderPlugin(options = {}) {
  const template = fs.readFileSync(TEMPLATE, "utf8");
  const rules = JSON.stringify(buildRules());
  const withRules = replaceBlock(template, "RULES", rules);
  if (!options.embed) return withRules;
  return replaceBlock(withRules, "EMBEDDED", JSON.stringify(options.embed));
}

/**
 * @param {string} source
 * @param {string} name
 * @param {string} body
 * @returns {string}
 */
function replaceBlock(source, name, body) {
  const begin = "//<<<" + name + ">>>";
  const end = "//<<<END-" + name + ">>>";
  const from = source.indexOf(begin);
  const to = source.indexOf(end);
  if (from < 0 || to < 0 || to < from) {
    throw new Error("plugin template is missing the " + name + " block");
  }
  const head = source.slice(0, from + begin.length);
  const tail = source.slice(to);
  return head + "\n    const " + name + " = " + body + ";\n    " + tail;
}

/**
 * @param {import("./mzproject.js").Project} project
 * @returns {{ installed: boolean, registered: boolean, pluginPath: string }}
 */
export function isInstalled(project) {
  const pluginPath = path.join(project.pluginDir, PLUGIN_FILE);
  if (!fs.existsSync(pluginPath)) return { installed: false, registered: false, pluginPath };
  let registered = false;
  try {
    registered = readPluginsFile(project.pluginsFile).some((entry) => entry && entry.name === PLUGIN_NAME);
  } catch {
    registered = false;
  }
  return { installed: true, registered, pluginPath };
}

/**
 * Fields that decide whether two plugin lists are "the same file after our
 * entry was added". Only the fields RPG Maker stores matter: a reformat or a
 * different key order is not an edit worth protecting.
 *
 * @param {Record<string, unknown>|null} plugin
 * @returns {Record<string, unknown>|null}
 */
function normalisePlugin(plugin) {
  if (!plugin) return null;
  const parameters = {};
  const keys = Object.keys(plugin.parameters || {}).sort();
  for (const key of keys) parameters[key] = plugin.parameters[key];
  return { name: plugin.name, status: plugin.status, description: plugin.description, parameters };
}

/**
 * @param {Array<Record<string, unknown>>} a
 * @param {Array<Record<string, unknown>>} b
 * @returns {boolean}
 */
function samePlugins(a, b) {
  return JSON.stringify(a.map(normalisePlugin)) === JSON.stringify(b.map(normalisePlugin));
}

/**
 * @param {import("./mzproject.js").Project} project
 * @param {{ embed?: Record<string,string>|null, parameters?: Record<string,string> }} [options]
 * @returns {InstallResult}
 */
export function installPlugin(project, options = {}) {
  const backupPath = project.pluginsFile + BACKUP_SUFFIX;
  const original = fs.readFileSync(project.pluginsFile, "utf8");
  const plugins = parsePluginsJs(original).plugins;

  let createdBackup = false;
  let staleBackup = false;
  if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(project.pluginsFile, backupPath);
    createdBackup = true;
  } else {
    // The backup only describes the file it was taken from. If the game
    // updated or another mod rewrote plugins.js since then, restoring it on
    // uninstall would silently throw those edits away (see uninstallPlugin).
    const backup = parsePluginsJs(fs.readFileSync(backupPath, "utf8")).plugins;
    staleBackup = !samePlugins(plugins.filter((plugin) => !plugin || plugin.name !== PLUGIN_NAME), backup);
  }

  const layout = pluginsJsLayout(original);
  const state = upsertPlugin(plugins, {
    name: PLUGIN_NAME,
    description: "Runtime translation driven by a yakusha dictionary.",
    parameters: {
      dictionaryPath: "yakusha/dictionary.json",
      strictCodes: "true",
      debug: "false",
      ...(options.parameters || {}),
    },
  });
  fs.writeFileSync(project.pluginsFile, serialisePluginsJs(plugins, layout), "utf8");

  fs.mkdirSync(project.pluginDir, { recursive: true });
  const pluginPath = path.join(project.pluginDir, PLUGIN_FILE);
  fs.writeFileSync(pluginPath, renderPlugin({ embed: options.embed || null }), "utf8");

  return { pluginPath, registered: true, backupPath: createdBackup ? backupPath : null, createdBackup, staleBackup, state };
}

/**
 * Remove the plugin and, when it is still safe, restore plugins.js byte for
 * byte.
 *
 * "Safe" means everything except our own entry still matches the backup. If
 * the file was changed after install (a game update, another mod, a hand
 * edit in the editor), restoring the backup would delete those changes, so
 * this removes only our entry and leaves the backup on disk for review.
 *
 * @param {import("./mzproject.js").Project} project
 * @returns {{ removed: boolean, restored: boolean, backupPath: string|null, drifted: boolean, keptBackup: string|null }}
 */
export function uninstallPlugin(project) {
  const backupPath = project.pluginsFile + BACKUP_SUFFIX;
  const pluginPath = path.join(project.pluginDir, PLUGIN_FILE);
  let removed = false;

  if (fs.existsSync(pluginPath)) {
    fs.rmSync(pluginPath);
    removed = true;
  }

  const current = fs.readFileSync(project.pluginsFile, "utf8");
  const layout = pluginsJsLayout(current);
  const plugins = parsePluginsJs(current).plugins;
  if (removePlugin(plugins, PLUGIN_NAME)) {
    fs.writeFileSync(project.pluginsFile, serialisePluginsJs(plugins, layout), "utf8");
    removed = true;
  }

  let restored = false;
  let drifted = false;
  let keptBackup = null;
  if (fs.existsSync(backupPath)) {
    const backup = parsePluginsJs(fs.readFileSync(backupPath, "utf8")).plugins;
    drifted = !samePlugins(plugins, backup);
    if (drifted) {
      keptBackup = backupPath;
    } else {
      fs.copyFileSync(backupPath, project.pluginsFile);
      fs.rmSync(backupPath);
      restored = true;
    }
  }

  return { removed, restored, backupPath: restored ? backupPath : null, drifted, keptBackup };
}

/**
 * Read our own entry out of js/plugins.js, if it is still there.
 *
 * @param {import("./mzproject.js").Project} project
 * @returns {Record<string, unknown>|null}
 */
export function installedEntry(project) {
  try {
    const plugins = readPluginsFile(project.pluginsFile);
    return plugins.find((plugin) => plugin && plugin.name === PLUGIN_NAME) || null;
  } catch {
    return null;
  }
}

/**
 * Describe the backup without touching it: exists, and whether it still
 * matches the file it was taken from (see uninstallPlugin for why that
 * decides whether an uninstall can restore byte for byte).
 *
 * @param {import("./mzproject.js").Project} project
 * @returns {{ path: string, exists: boolean, stale: boolean }}
 */
export function backupStatus(project) {
  const backupPath = project.pluginsFile + BACKUP_SUFFIX;
  if (!fs.existsSync(backupPath)) return { path: backupPath, exists: false, stale: false, readable: true };
  // A backup that already holds our entry is not a pre-install snapshot; it
  // can never be restored safely (that would add the entry back).
  try {
    const plugins = parsePluginsJs(fs.readFileSync(project.pluginsFile, "utf8")).plugins;
    const backup = parsePluginsJs(fs.readFileSync(backupPath, "utf8")).plugins;
    const stale = !samePlugins(
      plugins.filter((plugin) => !plugin || plugin.name !== PLUGIN_NAME),
      backup
    );
    return { path: backupPath, exists: true, stale, readable: true };
  } catch {
    // A hand-edited or half-written plugins.js is exactly when somebody runs
    // the diagnosis; it must report the damage, not crash on it.
    return { path: backupPath, exists: true, stale: true, readable: false };
  }
}
