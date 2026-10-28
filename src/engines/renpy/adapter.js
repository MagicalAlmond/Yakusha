/**
 * Ren'Py adapter.
 *
 * Ren'Py is not an RPG Maker engine: there is no data/ JSON, no js/plugins.js
 * and no plugin directory. Text lives in `.rpy` sources and in the compiled
 * `.rpyc` files next to them, and delivery is a single translation script in
 * `game/` that the interpreter reads at startup. Everything below is the same
 * shape the RPG Maker adapters expose, so the CLI and the pipeline never need
 * to know which engine they are talking to.
 *
 * @module engines/renpy/adapter
 */

import fs from "node:fs";
import path from "node:path";

import { capabilities, detectFail, detectOk, notImplemented } from "../adapter.js";
import { dictionaryPath, emptyDictionary, loadDictionary, recordExtracted, saveDictionary, stats, translatedOnly } from "../../core/dict.js";
import { launchProject } from "../launch.js";
import { renpyProfile } from "./profile.js";
import { extractRenpyProject } from "./extract.js";
import { MAX_SEARCH_DEPTH, findRenpyRoot, findRenpyRoots, looksLikeRenpyProject, openRenpyProject } from "./project.js";
import { installTranslation, translationStatus, uninstallTranslation } from "./runtime.js";

const MULTI_ROOT = /^found \d+ Ren'Py projects under /;

/**
 * The not-a-project message. Wording is ours (not shared with RPG Maker) so a
 * user who points the tool at the wrong folder is told what Ren'Py actually
 * looks like on disk.
 *
 * @param {string} startDir
 * @returns {string}
 */
function notProjectMessage(startDir) {
  return (
    "not a Ren'Py project (no game/ directory with .rpy or .rpyc scripts found in " +
    path.resolve(startDir) +
    " or up to 3 levels below it)"
  );
}

/**
 * The project a directory sits inside, if any.
 *
 * findRenpyRoot only looks at or below the directory it is given, which is
 * right for "point me at a folder of games" but wrong for the two most natural
 * ways to name one game: the player passes the folder holding the launcher
 * (.exe) or the game/ directory itself. Walking up finds the root for the
 * second case; the first is already handled, because the launcher and game/
 * live side by side.
 *
 * Nothing here guesses: a directory is a root only when it holds game/ with a
 * script in it, the same test the downward search uses.
 *
 * @param {string} startDir
 * @returns {string|null} absolute root, or null when the directory is not
 *   inside a project
 */
function containingRoot(startDir) {
  let dir = path.resolve(startDir);
  for (let depth = 0; depth <= MAX_SEARCH_DEPTH; depth += 1) {
    if (looksLikeRenpyProject(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

/**
 * The shallowest roots under a directory, for E_MULTI_ROOT candidates.
 *
 * @param {string} startDir
 * @returns {string[]}
 */
function shallowestRoots(startDir) {
  const origin = path.resolve(startDir);
  const roots = findRenpyRoots(origin);
  if (roots.length === 0) return [];
  const depthOf = (root) => path.relative(origin, root).split(path.sep).filter(Boolean).length;
  const depth = Math.min(...roots.map(depthOf));
  return roots.filter((root) => depthOf(root) === depth);
}

/**
 * CLI scan payload (docs/json-contract.md §7), same eleven keys as RPG Maker.
 *
 * Two fields have engine-specific meaning and are documented as such:
 * `dataFiles` is the number of scripts that were read, and `encodings` counts
 * decoded scripts per format instead of data files per compression.
 *
 * @param {{ root: string, engine: string, version: string|null, gameTitle: string|null }} project
 * @returns {Record<string, unknown>}
 */
export function scanRenpy(project) {
  const result = extractRenpyProject(project.root);
  const entries = [...result.entries.values()];
  const withCodes = entries.filter((entry) => renpyProfile.grammar.controlCodes(entry.text).length > 0).length;
  return {
    root: project.root,
    engine: project.engine,
    engineVersion: project.version,
    gameTitle: project.gameTitle,
    dataFiles: result.scripts.rpy + result.scripts.rpyc,
    uniqueStrings: result.entries.size,
    totalStrings: result.totalStrings,
    stringsWithControlCodes: withCodes,
    encodings: result.encodings,
    // The generic extractor reports file names here; the shared shape asks for
    // strings, because the CLI joins them into one line.
    undecodable: result.undecodable.map((item) => item.file + ": " + item.error),
    perFile: result.perFile,
  };
}

/**
 * Write the dictionary with empty targets, adding only new keys.
 *
 * Same policy as the RPG Maker extractor: a dictionary that cannot be parsed is
 * rebuilt rather than blocking the run, and existing translations are never
 * touched.
 *
 * @param {{ root: string, gameTitle: string|null }} project
 * @returns {{ file: string, added: number, total: number, translated: number, pending: number }}
 */
export function extractIntoDictionary(project) {
  const result = extractRenpyProject(project.root);
  const file = dictionaryPath(project.root);
  let existing = null;
  if (fs.existsSync(file)) {
    try {
      existing = loadDictionary(file);
    } catch {
      existing = null;
    }
  }
  const target = existing || emptyDictionary(project.gameTitle);
  let added = 0;
  for (const entry of result.entries.values()) {
    if (recordExtracted(target.entries, entry, "renpy")) added += 1;
  }
  saveDictionary(file, target);
  const summary = stats(target);
  return {
    file,
    added,
    total: summary.total,
    translated: summary.translated,
    pending: summary.pending,
  };
}

export const adapter = {
  id: "renpy",
  name: "Ren'Py",

  capabilities: capabilities({
    extract: true,
    export: true,
    // Not "plugin": there is no plugin system. Ren'Py reads one generated
    // translation script, so the runtime tier is a written file.
    runtime: "translation",
    launch: true,
    debuggable: false,
  }),

  detect(startDir) {
    // The project that contains the directory the user pointed at wins over
    // anything found below it: they named one game, not a folder of games.
    const near = containingRoot(startDir);
    if (near !== null) return detectOk(openRenpyProject(near));
    let root = null;
    try {
      root = findRenpyRoot(startDir);
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      if (!MULTI_ROOT.test(message)) throw error;
      return detectFail("E_MULTI_ROOT", message, shallowestRoots(startDir));
    }
    if (root === null) return detectFail("E_NOT_PROJECT", notProjectMessage(startDir));
    return detectOk(openRenpyProject(root));
  },

  scan(project) {
    return scanRenpy(project);
  },

  extract(project) {
    return extractIntoDictionary(project);
  },

  /**
   * Write `game/yakusha_translation.rpy` from the translated dictionary.
   *
   * The pairs come from the dictionary rather than from `--embed`: for Ren'Py
   * the translation file *is* the delivery, so there is nothing else to fall
   * back to. A dictionary with no translated entry is an error, not an empty
   * file, because an empty file would silently do nothing at runtime.
   *
   * The six payload keys are the ones the CLI has always printed; `entries` and
   * `language` are additive and only Ren'Py fills them.
   *
   * @param {{ root: string, gameDir: string }} project
   * @param {{ language?: string }} [options]
   * @returns {{ pluginPath: string, registered: boolean, backupPath: null, createdBackup: boolean, staleBackup: boolean, state: "added"|"unchanged", entries: number, language: string }}
   */
  installRuntime(project, options = {}) {
    const file = dictionaryPath(project.root);
    if (!fs.existsSync(file)) {
      throw coded("E_NO_DICTIONARY", "no dictionary yet: " + file + " - run: yakusha extract <game>");
    }
    const translated = translatedOnly(loadDictionary(file));
    const pairs = Object.entries(translated);
    if (pairs.length === 0) {
      throw coded("E_NO_DICTIONARY", "the dictionary has no translated entries yet - run: yakusha translate <game>");
    }
    const result = installTranslation(project, pairs, options);
    return {
      pluginPath: result.path,
      registered: true,
      backupPath: null,
      createdBackup: false,
      staleBackup: false,
      state: result.created ? "added" : "unchanged",
      entries: result.entries,
      language: result.language,
    };
  },

  /**
   * Delete the translation file. Nothing else was ever written, so uninstall
   * is a single removal and a second run reports `removed: false`.
   *
   * @param {{ root: string, gameDir: string }} project
   */
  uninstallRuntime(project) {
    const result = uninstallTranslation(project);
    return {
      removed: result.removed,
      restored: false,
      backupPath: null,
      drifted: false,
      keptBackup: null,
    };
  },

  launch(project, options = {}) {
    return launchProject(project, options);
  },

  attach() {
    throw notImplemented("attach");
  },

  rules: { controlCodes: true, maxColumns: 0 },

  /**
   * Grammar, prompt wording and language-pair judgements the pipeline reads.
   */
  profile: renpyProfile,

  /** What `doctor` counts when it prints the project size. */
  dataUnit: "scripts",

  /**
   * Engine-specific inputs for `diagnose()`.
   *
   * Doctor is engine-neutral but its checks are not: it needs the engine's own
   * extractor, its own file count and, for Ren'Py, the state of the generated
   * translation script. Handing them over here keeps core/doctor free of engine
   * imports.
   *
   * The count is the number of scripts the scan reports, which is the number of
   * scripts that actually decoded: a .rpyc the decoder rejects is missing from
   * the scan, so it must be missing here too, or doctor would print a size the
   * user never saw.
   *
   * @param {{ root: string, gameDir: string }} project
   * @returns {{ extract: () => object, dataFiles: number, translation: object, sourceLabel: string }}
   */
  diagnostics(project) {
    // Doctor asks for the extraction and the file count separately; extract
    // once and hand both out, so the two numbers can never disagree.
    let extracted = null;
    const extract = () => {
      if (extracted === null) extracted = extractRenpyProject(project.root);
      return extracted;
    };
    return {
      extract,
      dataFiles: extract().scripts.rpy + extract().scripts.rpyc,
      translation: translationStatus(project),
      sourceLabel: "game/",
    };
  },
};

/**
 * An error the CLI turns into an envelope code.
 *
 * @param {string} code E_* code
 * @param {string} message one line
 * @returns {Error}
 */
function coded(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export default adapter;
