/**
 * Diagnose a translated game.
 *
 * The three questions a person actually has when the Chinese stops showing up
 * are: is the dictionary still about *this* build of the game, is the delivery
 * installed the way the last install said it was, and will the game find it at
 * runtime. Each one is answered by a check with a level, so the command can be
 * used both by a human and from a script.
 *
 * Delivery is engine-specific: RPG Maker reads a plugin plus a dictionary file,
 * Ren'Py reads one generated translation script. Everything else here is
 * shared, and an adapter hands over its own pieces through `adapter.diagnostics`
 * (see `diagnose` options) instead of core importing an engine module.
 *
 * @module core/doctor
 */

import fs from "node:fs";
import path from "node:path";

import { extractProject } from "./extract.js";
import { backupStatus, installedEntry, isInstalled } from "./install.js";
import { parsePluginsJs } from "./pluginsfile.js";
import { stats as dictStats } from "./dict.js";
import { listDataFiles } from "./mzproject.js";
import { verifyDictionary } from "../pipeline/verify.js";

export const DEFAULT_DICT_PATH = "yakusha/dictionary.json";

/**
 * @typedef {{ id: string, level: "ok"|"info"|"warn"|"fail", message: string, samples?: string[] }} Check
 */

/**
 * Count the translations compiled into the plugin by `install --embed`.
 *
 * The embedded blob is a JSON object literal emitted by renderPlugin, so it is
 * parsed rather than pattern-matched: a truncated file must read as "not
 * embedded" instead of a wrong count.
 *
 * @param {string} source installed plugin file contents
 * @returns {{ embedded: boolean, entries: number }}
 */
export function detectEmbeddedTranslations(source) {
  const match = /const EMBEDDED = (null|\{[^\n]*\});/.exec(source);
  if (!match || match[1] === "null") return { embedded: false, entries: 0 };
  try {
    const parsed = JSON.parse(match[1]);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { embedded: false, entries: 0 };
    return { embedded: true, entries: Object.keys(parsed).length };
  } catch {
    return { embedded: false, entries: 0 };
  }
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
 * @param {import("./mzproject.js").Project} project
 * @param {{
 *   dictionary?: object|null,
 *   dictionaryFile?: string,
 *   maxColumns?: number,
 *   engineLabel?: string,
 *   profile?: import("../engines/profile.js").EngineProfile,
 *   extract?: () => object,
 *   dataFiles?: number,
 *   sourceLabel?: string,
 *   delivery?: { path: string|null, exists: boolean, language: string|null, entries: number }|null,
 * }} [options]
 */
export function diagnose(project, options = {}) {
  const dictionary = options.dictionary || null;
  const dictionaryFile = options.dictionaryFile || path.join(project.root, ...DEFAULT_DICT_PATH.split("/"));
  /** @type {Check[]} */
  const checks = [];
  const add = (id, level, message, samples) => {
    const check = { id, level, message };
    if (samples && samples.length) check.samples = samples;
    checks.push(check);
    return check;
  };

  // The adapter names its own engine ("RPG Maker MZ"); the fallback keeps the
  // pre-profile wording for direct library callers.
  const engineLabel = options.engineLabel || "RPG Maker " + project.engine.toUpperCase();
  add("engine", "ok", engineLabel + (project.version ? " " + project.version : ""));

  // Engines without a plugin registry (Ren'Py) leave pluginsFile null: there is
  // nothing to parse and no check to report, not a failure.
  let pluginsOk = true;
  if (project.pluginsFile) {
    try {
      parsePluginsJs(fs.readFileSync(project.pluginsFile, "utf8"));
    } catch (error) {
      pluginsOk = false;
      const message = error && error.message ? error.message : String(error);
      add(
        "plugins.js",
        "fail",
        "js/plugins.js is not readable (" + message.split("\n")[0].slice(0, 120) + ") - restore it from the backup or reinstall the game"
      );
    }
  }

  let dictionarySummary = null;
  if (!dictionary) {
    add("dictionary", "fail", "no dictionary at " + dictionaryFile + " - run: yakusha extract <game>");
  } else {
    const s = dictStats(dictionary);
    const rejected = Object.values(dictionary.entries || {}).filter((entry) => entry && entry.error).length;
    dictionarySummary = { file: dictionaryFile, ...s, rejected };
    add(
      "dictionary",
      "ok",
      s.total + " entries (" + s.translated + " translated, " + s.pending + " pending" + (rejected ? ", " + rejected + " rejected" : "") + ")"
    );
    if (s.pending > 0) {
      add("progress", "warn", s.pending + " entr" + (s.pending === 1 ? "y is" : "ies are") + " still empty - run: yakusha translate <game>");
    }
    if (rejected > 0) {
      add("rejected", "warn", rejected + " entr" + (rejected === 1 ? "y" : "ies") + " failed validation - run: yakusha verify");
    }
  }

  let sync = null;
  if (dictionary) {
    const sourceLabel = options.sourceLabel || "data/";
    try {
      const extracted = (options.extract || ((root) => extractProject(root)))(project.root);
      const current = new Set(extracted.entries.keys());
      const known = new Set(Object.keys(dictionary.entries || {}));
      const stale = [...known].filter((key) => !current.has(key));
      const fresh = [...current].filter((key) => !known.has(key));
      sync = { stale: stale.length, new: fresh.length };
      if (stale.length === 0 && fresh.length === 0) {
        add("sync", "ok", "every dictionary key still appears in " + sourceLabel);
      } else {
        const parts = [];
        if (fresh.length) parts.push(fresh.length + " text" + (fresh.length === 1 ? "" : "s") + " not in the dictionary");
        if (stale.length) parts.push(stale.length + " dictionary key" + (stale.length === 1 ? "" : "s") + " no longer in the game");
        const samples = [...fresh.slice(0, 2), ...stale.slice(0, 2)];
        add(
          "sync",
          "warn",
          parts.join(", ") + " - " + (fresh.length ? "run extract" : "the game probably updated"),
          samples
        );
      }
    } catch (error) {
      add("sync", "warn", "could not re-read " + sourceLabel + ": " + (error && error.message ? error.message : String(error)));
    }
  }

  // Two delivery models, one payload. RPG Maker: a plugin file plus its
  // $plugins entry plus a dictionary the plugin reads at load time. Ren'Py: a
  // single generated translation script, so the file *is* the registration and
  // there is no backup to compare. The adapter hands its own state over as
  // `delivery`; when that is absent the RPG Maker path runs unchanged.
  const delivery = options.delivery || null;
  let runtime = null;
  let installPayload;
  let installCheck;
  let backup = null;

  if (delivery) {
    const deliveryPath = delivery.path || null;
    const present = Boolean(delivery.exists);
    const relPath = deliveryPath && project.root ? path.relative(project.root, deliveryPath).split(path.sep).join("/") : deliveryPath;
    installCheck = present
      ? add("install", "ok", relPath + " (written by install)")
      : add("install", "info", "not installed - run: yakusha install <game>");
    if (present) {
      const language = delivery.language || null;
      runtime = { embedded: false, entries: delivery.entries || 0, path: relPath, found: deliveryPath };
      add(
        "runtime",
        "ok",
        relPath + " (" + (delivery.entries || 0) + " string" + ((delivery.entries || 0) === 1 ? "" : "s") + (language ? ", language " + language : "") + ")"
      );
    } else {
      runtime = { embedded: false, entries: 0, path: relPath, found: null };
      add("runtime", "info", "the game reads " + relPath + " at startup once installed");
    }
    installPayload = {
      pluginFile: deliveryPath,
      pluginFilePresent: present,
      // There is no separate registry: the file is the registration.
      entryPresent: present,
      entryParameters: delivery.language ? { language: delivery.language } : null,
      backup: null,
    };
  } else {
    const installed = isInstalled(project);
    const entry = pluginsOk ? installedEntry(project) : null;
    const embed = installed.installed ? detectEmbeddedTranslations(fs.readFileSync(installed.pluginPath, "utf8")) : { embedded: false, entries: 0 };
    if (!pluginsOk) {
      installCheck = add("install", "info", "skipped: js/plugins.js is damaged");
    } else if (!installed.installed && !entry) {
      installCheck = add("install", "info", "not installed - run: yakusha install <game>");
    } else if (installed.installed && entry) {
      installCheck = add("install", "ok", "js/plugins/" + path.basename(installed.pluginPath) + " registered in js/plugins.js");
    } else if (installed.installed) {
      installCheck = add("install", "fail", "the plugin file is there but its $plugins entry is gone (game update?) - run install again");
    } else {
      installCheck = add("install", "fail", "$plugins still lists YAKUSHA_Translator but the plugin file is missing - run install again");
    }

    backup = backupStatus(project);
    if (pluginsOk && (installed.installed || entry)) {
      if (!backup.exists) {
        add("backup", "info", "no backup - uninstall will only remove the $plugins entry");
      } else if (!backup.readable) {
        add("backup", "warn", "could not compare plugins.js with the backup - check both files by hand");
      } else if (backup.stale) {
        add("backup", "warn", "backup no longer matches js/plugins.js - uninstall keeps it and removes only the entry");
      } else {
        add("backup", "ok", "uninstall can restore js/plugins.js byte for byte");
      }
    }

    const dictPath = String((entry && entry.parameters && entry.parameters.dictionaryPath) || DEFAULT_DICT_PATH);
    if (embed.embedded) {
      runtime = { embedded: true, entries: embed.entries, path: dictPath, found: null };
      add("runtime", "ok", "translations compiled into the plugin (" + embed.entries + " entries)");
    } else if (!installed.installed) {
      runtime = { embedded: false, entries: 0, path: dictPath, found: null };
      add("runtime", "info", "the game reads " + dictPath + " at load time once installed");
    } else {
      const lookup = runtimeLookup(project.root, dictPath);
      runtime = { embedded: false, entries: 0, path: dictPath, found: lookup.found };
      if (lookup.found) {
        add("runtime", "ok", dictPath + " (found)");
      } else {
        add("runtime", "fail", "runtime dictionary not found: tried " + lookup.candidates.join(" and ") + " - the game will run untranslated");
      }
    }

    installPayload = {
      pluginFile: installed.pluginPath,
      pluginFilePresent: installed.installed,
      entryPresent: Boolean(entry),
      entryParameters: entry && entry.parameters ? entry.parameters : null,
      backup: backup.exists ? { path: backup.path, stale: backup.stale } : null,
    };
  }

  let verify = null;
  if (dictionary) {
    const result = verifyDictionary(dictionary, { maxColumns: options.maxColumns || 0, profile: options.profile });
    verify = { errors: result.errors, warnings: result.warnings };
    if (result.errors > 0) {
      add(
        "verify",
        "warn",
        result.errors + " error" + (result.errors === 1 ? "" : "s") + ", " + result.warnings + " warning(s) - some lines will stay Japanese, see: yakusha verify"
      );
    } else {
      add("verify", "ok", "0 error, " + result.warnings + " warning(s)");
    }
  }

  const failed = checks.find((check) => check.level === "fail") || null;
  const warnCount = checks.filter((check) => check.level === "warn").length;
  let verdict;
  if (failed) verdict = "broken";
  else if (installCheck.level === "info") verdict = "not-installed";
  else if (warnCount > 0) verdict = "usable";
  else verdict = "ready";

  return {
    ok: !failed,
    verdict,
    checks,
    failure: failed ? failed.message : null,
    game: {
      title: project.gameTitle,
      engine: project.engine,
      // engineVersion, not "version": the envelope already has a schema
      // version, and the json contract names the game's one explicitly.
      engineVersion: project.version,
      root: project.root,
      dataFiles:
        typeof options.dataFiles === "number" ? options.dataFiles : listDataFiles(project).length,
    },
    dictionary: dictionarySummary,
    sync,
    install: installPayload,
    runtime,
    verify,
  };
}
