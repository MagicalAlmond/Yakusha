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
 * @typedef {{ pluginPath: string, registered: boolean, backupPath: string|null, createdBackup: boolean, state: "added"|"enabled"|"unchanged" }} InstallResult
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
 * @param {import("./mzproject.js").Project} project
 * @param {{ embed?: Record<string,string>|null, parameters?: Record<string,string> }} [options]
 * @returns {InstallResult}
 */
export function installPlugin(project, options = {}) {
  const backupPath = project.pluginsFile + BACKUP_SUFFIX;
  let createdBackup = false;
  if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(project.pluginsFile, backupPath);
    createdBackup = true;
  }

  const original = fs.readFileSync(project.pluginsFile, "utf8");
  const layout = pluginsJsLayout(original);
  const plugins = parsePluginsJs(original).plugins;
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

  return { pluginPath, registered: true, backupPath: createdBackup ? backupPath : null, createdBackup, state };
}

/**
 * @param {import("./mzproject.js").Project} project
 * @returns {{ removed: boolean, restored: boolean, backupPath: string|null }}
 */
export function uninstallPlugin(project) {
  const backupPath = project.pluginsFile + BACKUP_SUFFIX;
  const pluginPath = path.join(project.pluginDir, PLUGIN_FILE);
  let removed = false;

  if (fs.existsSync(pluginPath)) {
    fs.rmSync(pluginPath);
    removed = true;
  }

  const original = fs.readFileSync(project.pluginsFile, "utf8");
  const layout = pluginsJsLayout(original);
  const plugins = parsePluginsJs(original).plugins;
  if (removePlugin(plugins, PLUGIN_NAME)) {
    fs.writeFileSync(project.pluginsFile, serialisePluginsJs(plugins, layout), "utf8");
    removed = true;
  }

  let restored = false;
  if (fs.existsSync(backupPath)) {
    fs.copyFileSync(backupPath, project.pluginsFile);
    fs.rmSync(backupPath);
    restored = true;
  }

  return { removed, restored, backupPath: restored ? backupPath : null };
}
