/**
 * Diagnose a translated game.
 *
 * The three questions a person actually has when the Chinese stops showing up
 * are: is the dictionary still about *this* build of the game, is the delivery
 * installed the way the last install said it was, and will the game find it at
 * runtime. Each one is answered by a check with a level, so the command can be
 * used both by a human and from a script.
 *
 * This service is engine-neutral. Everything a delivery tier knows about its
 * own files arrives through `options.diagnostics`: a function the adapter
 * exports, or a plain object for callers that already computed it.
 *
 * @module services/doctor
 */

import fs from "node:fs";
import path from "node:path";

import { stats as dictStats } from "../core/dict.js";
import { parsePluginsJs } from "../core/pluginsfile.js";
import { checkVersion } from "../core/versions.js";
import { verifyDictionary } from "../pipeline/verify.js";

export const DEFAULT_DICT_PATH = "yakusha/dictionary.json";

/**
 * @typedef {{ id: string, level: "ok"|"info"|"warn"|"fail", message: string, samples?: string[] }} Check
 */

/**
 * Normalise the diagnostics an adapter can hand over.
 *
 * @param {import("../core/mzproject.js").Project} project
 * @param {object} options
 * @param {object|null} dictionary
 * @param {boolean} pluginsOk
 * @returns {object}
 */
function deliveryFacts(project, options, dictionary, pluginsOk) {
  if (typeof options.diagnostics === "function") {
    return options.diagnostics(project, { dictionary, dictionaryFile: options.dictionaryFile, pluginsOk }) || {};
  }
  if (options.diagnostics && typeof options.diagnostics === "object") return options.diagnostics;
  return {};
}

/**
 * @param {import("../core/mzproject.js").Project} project
 * @param {{
 *   dictionary?: object|null,
 *   dictionaryFile?: string,
 *   maxColumns?: number,
 *   engineLabel?: string,
 *   profile?: import("../engines/profile.js").EngineProfile,
 *   extract?: () => object,
 *   dataFiles?: number,
 *   sourceLabel?: string,
 *   versions?: {kind?: string, min?: string, max?: string, values?: string[], tested?: string[], reason?: string}|null,
 *   delivery?: { path?: string|null, exists?: boolean, language?: string|null, entries?: number,
 *     mode?: string, pending?: boolean, message?: string }|null,
 *   diagnostics?: Function|object|null,
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
  const versionCheck = options.versions ? checkVersion(project.version, options.versions) : null;
  if (versionCheck) add("version", versionCheck.level, versionCheck.message);

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

  const own = deliveryFacts(project, options, dictionary, pluginsOk);

  let sync = null;
  if (dictionary) {
    const sourceLabel = options.sourceLabel || "data/";
    try {
      const extract = options.extract || own.extract;
      if (typeof extract !== "function") throw new Error("no extractor was supplied for this engine");
      const extracted = extract(project.root);
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
          parts.join(", ") +
          " - " +
          (fresh.length
            ? stale.length
              ? "run extract; extract --prune drops the stale keys"
              : "run extract"
            : "the game probably updated - run: yakusha extract --prune <game>"),
          samples
        );
      }
    } catch (error) {
      add("sync", "warn", "could not re-read " + sourceLabel + ": " + (error && error.message ? error.message : String(error)));
    }
  }

  // Delivery models, one payload. An adapter can either hand over the generic
  // delivery descriptor (a file that exists or not) or its own install facts
  // for tiers that need more than one file (the RPG Maker plugin registry).
  const delivery = own.delivery || own.translation || options.delivery || null;
  let runtime = null;
  let installPayload = null;
  let installCheck;

  if (own.install) {
    installCheck = add("install", own.install.level, own.install.message);
    for (const check of own.checks || []) add(check.id, check.level, check.message);
    runtime = own.runtime ? own.runtime.value : null;
    if (own.runtime) add("runtime", own.runtime.level, own.runtime.message);
    installPayload = own.installPayload || null;
  } else if (delivery && delivery.pending) {
    // An engine without a delivery layer yet. Extraction, translation and
    // verification all work, but nothing writes the result back into the game,
    // and saying "not installed" would send the user to a command that refuses
    // to run. The adapter supplies the reason; this is a warning, not a failure,
    // because nothing here is broken - it is just not finished.
    installCheck = add("install", "warn", delivery.message || "this engine has no delivery layer yet");
    runtime = { embedded: false, entries: 0, path: null, found: null };
    add("runtime", "info", "nothing is loaded at run time, so the game keeps showing the original text");
    installPayload = {
      pluginFile: null,
      pluginFilePresent: false,
      entryPresent: false,
      entryParameters: null,
      backup: null,
    };
  } else if (delivery) {
    const deliveryPath = delivery.path || null;
    const present = Boolean(delivery.exists);
    const relPath = deliveryPath && project.root ? path.relative(project.root, deliveryPath).split(path.sep).join("/") : deliveryPath;
    const damaged = present && delivery.intact === false;
    const stale = present && !damaged && delivery.dictionaryStale === true;
    const reinstall = "yakusha install <game>";
    installCheck = damaged
      ? add(
          "install",
          "fail",
          relPath + " is damaged" + (delivery.problems && delivery.problems.length ? ": " + delivery.problems.join(", ") : "") + " - run: yakusha install \"<game>\""
        )
      : stale
      ? add("install", "warn", relPath + " is out of date: the project dictionary has changed since install - run: " + reinstall)
      : present
      ? add("install", "ok", relPath + " (written by install)")
      : add("install", "info", "not installed - run: yakusha install <game>");
    if (present && !damaged && stale) {
      runtime = { embedded: false, entries: delivery.entries || 0, path: relPath, found: deliveryPath };
      add(
        "runtime",
        "warn",
        delivery.mode === "inject"
          ? "the injector keeps using the dictionary from install time until it is reinstalled"
          : "the game keeps using the translation file written at install time until it is reinstalled"
      );
    } else if (present && !damaged) {
      const language = delivery.language || null;
      runtime = { embedded: false, entries: delivery.entries || 0, path: relPath, found: deliveryPath };
      add(
        "runtime",
        "ok",
        relPath + " (" + (delivery.entries || 0) + " string" + ((delivery.entries || 0) === 1 ? "" : "s") + (language ? ", language " + language : "") + ")"
      );
    } else if (damaged) {
      runtime = { embedded: false, entries: delivery.entries || 0, path: relPath, found: deliveryPath };
      add("runtime", "fail", "the injector cannot start until the native components are repaired");
    } else {
      runtime = { embedded: false, entries: 0, path: relPath, found: null };
      add("runtime", "info", delivery.mode === "inject"
        ? "the injector loads " + relPath + " when the game starts"
        : "the game reads " + relPath + " at startup once installed");
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
    installCheck = add("install", "info", "no delivery tier reported for this engine");
    runtime = { embedded: false, entries: 0, path: null, found: null };
    add("runtime", "info", "nothing is loaded at run time");
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
        typeof own.dataFiles === "number"
          ? own.dataFiles
          : typeof options.dataFiles === "number"
            ? options.dataFiles
            : 0,
    },
    dictionary: dictionarySummary,
    sync,
    install: installPayload,
    runtime,
    verify,
  };
}
