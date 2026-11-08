/**
 * RPG Maker MZ/MV delivery diagnostics.
 *
 * The plugin registry, its backup and the embedded-translation lookup are all
 * specific to the RPG Maker delivery tier. Keeping them here lets the generic
 * doctor service ask each adapter for its own delivery facts instead of
 * importing an engine module.
 *
 * @module engines/rm/diagnostics
 */

import fs from "node:fs";
import path from "node:path";

import { extractProject } from "../../core/extract.js";
import { backupStatus, installedEntry, isInstalled } from "../../core/install.js";
import { translatedOnly } from "../../core/dict.js";
import { listDataFiles } from "../../core/mzproject.js";

export const DEFAULT_DICT_PATH = "yakusha/dictionary.json";

/**
 * Read the translations compiled into the plugin by `install --embed`.
 *
 * The embedded blob is a JSON object literal emitted by renderPlugin, so it is
 * parsed rather than pattern-matched: a truncated file must read as "not
 * embedded" instead of a wrong map.
 *
 * @param {string} source installed plugin file contents
 * @returns {Record<string, string>|null}
 */
export function readEmbeddedTranslations(source) {
  const match = /const EMBEDDED = (null|\{[^\n]*\});/.exec(source);
  if (!match || match[1] === "null") return null;
  try {
    const parsed = JSON.parse(match[1]);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Count the translations compiled into the plugin by `install --embed`.
 *
 * @param {string} source installed plugin file contents
 * @returns {{ embedded: boolean, entries: number }}
 */
export function detectEmbeddedTranslations(source) {
  const parsed = readEmbeddedTranslations(source);
  return parsed === null ? { embedded: false, entries: 0 } : { embedded: true, entries: Object.keys(parsed).length };
}

/**
 * Whether two source-to-target maps hold exactly the same pairs.
 *
 * @param {Record<string, string>} left
 * @param {Record<string, string>} right
 * @returns {boolean}
 */
function sameTranslations(left, right) {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => Object.hasOwn(right, key) && left[key] === right[key]);
}

/**
 * Where the runtime plugin would look for the dictionary. The plugin itself
 * tries the directory of index.html, the process cwd and "."; a deployed MV
 * build is the interesting divergence (the game root holds www/).
 *
 * @param {string} root project root
 * @param {string} dictionaryPath value of the plugin parameter
 * @returns {{ candidates: string[], found: string|null }}
 */
export function runtimeLookup(root, dictionaryPath) {
  const parts = String(dictionaryPath || DEFAULT_DICT_PATH).split("/");
  const candidates = [path.join(root, ...parts), path.join(root, "www", ...parts)];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return { candidates, found: candidate };
  }
  return { candidates, found: null };
}

/**
 * Describe the RPG Maker plugin delivery the way the generic doctor expects.
 *
 * @param {import("../../core/mzproject.js").Project} project
 * @param {{ dictionary?: object|null, pluginsOk?: boolean }} [options]
 * @returns {{
 *   extract: () => object,
 *   dataFiles: number,
 *   install: { level: "ok"|"info"|"warn"|"fail", message: string },
 *   checks: Array<{ id: string, level: string, message: string }>,
 *   runtime: { level: string, message: string, value: object },
 *   installPayload: object,
 * }}
 */
export function rmDiagnostics(project, options = {}) {
  const dictionary = options.dictionary || null;
  const pluginsOk = options.pluginsOk !== false;
  const installed = isInstalled(project);
  const entry = pluginsOk ? installedEntry(project) : null;
  const pluginSource = installed.installed ? fs.readFileSync(installed.pluginPath, "utf8") : "";
  const embed = detectEmbeddedTranslations(pluginSource);
  const embedded = installed.installed ? readEmbeddedTranslations(pluginSource) : null;
  const translated = dictionary ? translatedOnly(dictionary) : null;
  const embedOutdated = embedded !== null && translated !== null && !sameTranslations(embedded, translated);
  const checks = [];
  let install;

  if (!pluginsOk) {
    install = { level: "info", message: "skipped: js/plugins.js is damaged" };
  } else if (!installed.installed && !entry) {
    install = { level: "info", message: "not installed - run: yakusha install <game>" };
  } else if (installed.installed && entry && embedOutdated) {
    install = {
      level: "warn",
      message:
        "js/plugins/" +
        path.basename(installed.pluginPath) +
        " is out of date: the project dictionary has changed since install - run: yakusha install --embed \"<game>\"",
    };
  } else if (installed.installed && entry) {
    install = { level: "ok", message: "js/plugins/" + path.basename(installed.pluginPath) + " registered in js/plugins.js" };
  } else if (installed.installed) {
    install = { level: "fail", message: "the plugin file is there but its $plugins entry is gone (game update?) - run install again" };
  } else {
    install = { level: "fail", message: "$plugins still lists YAKUSHA_Translator but the plugin file is missing - run install again" };
  }

  const backup = backupStatus(project);
  if (pluginsOk && (installed.installed || entry)) {
    if (!backup.exists) {
      checks.push({ id: "backup", level: "info", message: "no backup - uninstall will only remove the $plugins entry" });
    } else if (!backup.readable) {
      checks.push({ id: "backup", level: "warn", message: "could not compare plugins.js with the backup - check both files by hand" });
    } else if (backup.stale) {
      checks.push({ id: "backup", level: "warn", message: "backup no longer matches js/plugins.js - uninstall keeps it and removes only the entry" });
    } else {
      checks.push({ id: "backup", level: "ok", message: "uninstall can restore js/plugins.js byte for byte" });
    }
  }

  const dictPath = String((entry && entry.parameters && entry.parameters.dictionaryPath) || DEFAULT_DICT_PATH);
  let runtime;
  if (embed.embedded) {
    runtime = {
      value: { embedded: true, entries: embed.entries, path: dictPath, found: null },
      level: embedOutdated ? "warn" : "ok",
      message: embedOutdated
        ? "the plugin keeps using the translations compiled at install time until it is reinstalled"
        : "translations compiled into the plugin (" + embed.entries + " entries)",
    };
  } else if (!installed.installed) {
    runtime = {
      value: { embedded: false, entries: 0, path: dictPath, found: null },
      level: "info",
      message: "the game reads " + dictPath + " at load time once installed",
    };
  } else {
    const lookup = runtimeLookup(project.root, dictPath);
    runtime = {
      value: { embedded: false, entries: 0, path: dictPath, found: lookup.found },
      level: lookup.found ? "ok" : "fail",
      message: lookup.found
        ? dictPath + " (found)"
        : "runtime dictionary not found: tried " + lookup.candidates.join(" and ") + " - the game will run untranslated",
    };
  }

  return {
    extract: () => extractProject(project.root),
    dataFiles: listDataFiles(project).length,
    install,
    checks,
    runtime,
    installPayload: {
      pluginFile: installed.pluginPath,
      pluginFilePresent: installed.installed,
      entryPresent: Boolean(entry),
      entryParameters: entry && entry.parameters ? entry.parameters : null,
      backup: backup.exists ? { path: backup.path, stale: backup.stale } : null,
    },
  };
}
