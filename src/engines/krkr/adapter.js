/**
 * Kirikiri adapter.
 *
 * Kirikiri / KAG games keep their content in .xp3 archives (the game root or
 * its data/ directory hold the archives directly); scenario text lives in KAG
 * scripts (.ks) inside them. There is no plugin directory, no js/plugins.js
 * and no translation-resource folder the engine reads on its own. Delivery
 * therefore uses the engine's own override rule: a `patch.xp3` (then
 * `patch2.xp3`, ...) is loaded after `data.xp3`, and a same-named script in it
 * wins. Yakusha writes one such archive and never edits the game's archives;
 * see ./patch.js. This module wires the engine into the same shape the other
 * adapters expose, so `scan`, `extract`, `translate`, `verify`, `speaker`,
 * `terms`, `export`, `install`, `uninstall` and `doctor` all work without
 * knowing which engine they are talking to.
 *
 * @module engines/krkr/adapter
 */

import fs from "node:fs";
import path from "node:path";

import { capabilities, detectFail, detectOk, notImplemented } from "../contract.js";
import { dictionaryPath, emptyDictionary, loadDictionary, saveDictionary, stats, mergeExtracted } from "../../core/dict.js";
import { launchProject } from "../launch.js";
import { krkrProfile } from "./profile.js";
import { extractKrkrProject } from "./extract.js";
import { installPatch, patchStatus, uninstallPatch } from "./patch.js";
import { MAX_SEARCH_DEPTH, findKrkrRoot, findKrkrRoots, looksLikeKrkrProject, openKrkrProject } from "./project.js";

const MULTI_ROOT = /^found \d+ Kirikiri projects under /;

/**
 * The not-a-project message.
 *
 * Wording is ours, not shared with the other engines, so a user who points the
 * tool at the wrong folder is told what a Kirikiri game looks like on disk: a
 * directory (or its data/ subdirectory) holding .xp3 archives.
 *
 * @param {string} startDir
 * @returns {string}
 */
function notProjectMessage(startDir) {
  return (
    "not a Kirikiri project (no .xp3 archive in " +
    path.resolve(startDir) +
    " or up to " + MAX_SEARCH_DEPTH + " levels below it)"
  );
}
/**
 * The project a directory sits inside, if any.
 *
 * `findKrkrRoot` only looks at or below the directory it is given. A player
 * names a game in two other natural ways - the folder holding the game exe,
 * or a subfolder of the game - and both are answered by walking up, the same
 * way the RGSS and Ren'Py adapters do it. Nothing here guesses: a directory is
 * a root only when `looksLikeKrkrProject` says so, which is the test the
 * downward search uses.
 *
 * @param {string} startDir
 * @returns {string|null} absolute root, or null when the directory is not
 *   inside a project
 */
function containingRoot(startDir) {
  let dir = path.resolve(startDir);
  for (let depth = 0; depth <= MAX_SEARCH_DEPTH; depth += 1) {
    if (looksLikeKrkrProject(dir)) return dir;
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
  const roots = findKrkrRoots(origin);
  if (roots.length === 0) return [];
  const depthOf = (root) => path.relative(origin, root).split(path.sep).filter(Boolean).length;
  const depth = Math.min(...roots.map(depthOf));
  return roots.filter((root) => depthOf(root) === depth);
}

/**
 * CLI scan payload (docs/json-contract.md §7), the same eleven keys as every
 * other engine.
 *
 * `dataFiles` counts the archives that opened (a packed game has no loose
 * files on disk to count, so the archive list is the only honest number), and
 * `encodings` counts archives - one key, xp3, in 0.13.
 *
 * @param {{ root: string, engine: string, version: string|null, gameTitle: string|null }} project
 * @returns {Record<string, unknown>}
 */
export function scanKrkr(project) {
  const result = extractKrkrProject(project.root);
  const entriesList = [...result.entries.values()];
  const withCodes = entriesList.filter((entry) => krkrProfile.grammar.controlCodes(entry.text).length > 0).length;
  return {
    root: project.root,
    engine: project.engine,
    engineVersion: project.version,
    gameTitle: project.gameTitle,
    dataFiles: result.documents,
    uniqueStrings: result.entries.size,
    totalStrings: result.totalStrings,
    stringsWithControlCodes: withCodes,
    encodings: result.encodings,
    // The extractor reports {file, error} pairs; the shared shape asks for
    // strings, because the CLI joins them into one line. Archive-level errors
    // already start with the archive name, so prefix only when they do not.
    undecodable: result.undecodable.map((item) =>
      item.error.startsWith(item.file + ": ") ? item.error : item.file + ": " + item.error
    ),
    perFile: result.perFile,
  };
}
/**
 * Write the dictionary with empty targets, adding only new keys.
 *
 * Same policy as every other extractor: a dictionary that cannot be parsed is
 * rebuilt rather than blocking the run, and existing translations are never
 * touched.
 *
 * @param {{ root: string, gameTitle: string|null }} project
 * @returns {{ file: string, added: number, total: number, translated: number, pending: number }}
 */
export function extractIntoDictionary(project, options = {}) {
  const result = extractKrkrProject(project.root);
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
  const { added, stale, pruned } = mergeExtracted(target.entries, result.entries.values(), "krkr", options);
  saveDictionary(file, target);
  const summary = stats(target);
  return {
    file,
    added,
    total: summary.total,
    translated: summary.translated,
    pending: summary.pending,
    stale,
    pruned,
  };
}

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

export const adapter = {
  id: "krkr",
  name: "Kirikiri",

  capabilities: capabilities({
    extract: true,
    export: true,
    // A patch archive is the engine's own override mechanism, so this tier
    // writes a new file and leaves every archive the game shipped untouched.
    runtime: "patch",
    launch: true,
    debuggable: false,
  }),

  // XP3 archives carry no engine version field, so there is nothing to compare.
  versions: { kind: "none", reason: "Kirikiri archives do not record an engine version" },

  detect(startDir) {
    // The project that contains the directory the user pointed at wins over
    // anything found below it: they named one game, not a folder of games.
    const near = containingRoot(startDir);
    if (near !== null) return detectOk(openKrkrProject(near));
    let root = null;
    try {
      root = findKrkrRoot(startDir);
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      if (!MULTI_ROOT.test(message)) throw error;
      return detectFail("E_MULTI_ROOT", message, shallowestRoots(startDir));
    }
    if (root === null) return detectFail("E_NOT_PROJECT", notProjectMessage(startDir));
    return detectOk(openKrkrProject(root));
  },

  scan(project) {
    return scanKrkr(project);
  },

  extract(project, options = {}) {
    return extractIntoDictionary(project, options);
  },

  /**
   * Write the patch archive from the translated dictionary.
   *
   * The six payload keys are the ones every runtime tier returns; `state` and
   * `patch` are additive and only Kirikiri fills them. `state` is "updated"
   * when an archive already existed but its bytes or the dictionary hash
   * changed, which is what a second install after a translation edit reports.
   *
   * @param {{ root: string, dataDir: string, archives: string[] }} project
   * @param {{ dryRun?: boolean }} [options]
   * @returns {{ pluginPath: string, registered: boolean, backupPath: null, createdBackup: boolean, staleBackup: boolean, state: "added"|"updated"|"unchanged", patch: object }}
   */
  installRuntime(project, options = {}) {
    const file = dictionaryPath(project.root);
    if (!fs.existsSync(file)) {
      throw coded("E_NO_DICTIONARY", "no dictionary yet: " + file + " - run: yakusha extract <game>");
    }
    const result = installPatch(project, loadDictionary(file), options);
    return {
      pluginPath: result.path,
      registered: true,
      backupPath: null,
      createdBackup: false,
      staleBackup: false,
      state: result.created ? "added" : result.changed ? "updated" : "unchanged",
      patch: {
        path: result.path,
        archive: result.archive,
        entries: result.entries,
        files: result.files,
        created: result.created,
        changed: result.changed,
        skipped: result.skipped,
        ...(result.dryRun === true ? { dryRun: true } : {}),
      },
    };
  },

  /**
   * Delete the archive and manifest Yakusha wrote. A game archive is never
   * touched, and a second run reports removed:false.
   *
   * @param {{ root: string, dataDir: string }} project
   * @param {{ dryRun?: boolean }} [options]
   */
  uninstallRuntime(project, options = {}) {
    const result = uninstallPatch(project, options);
    return {
      removed: result.removed,
      restored: false,
      backupPath: null,
      drifted: false,
      keptBackup: null,
      patch: {
        path: result.path,
        archive: result.archive,
        entries: result.entries,
        ...(result.dryRun === true ? { dryRun: true } : {}),
      },
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
  profile: krkrProfile,

  /** What `doctor` counts when it prints the project size. */
  dataUnit: "data files",

  /**
   * Engine-specific inputs for `diagnose()`.
   *
   * The count is the number of archives the scan reports as opened: an archive
   * the XP3 reader rejects lands in undecodable, so it must be missing here
   * too, or doctor would print a size the user never saw.
   *
   * @param {{ root: string, dataDir: string }} project
   * @returns {{ extract: () => object, dataFiles: number, delivery: object, sourceLabel: string }}
   */
  diagnostics(project) {
    let extracted = null;
    const extract = () => {
      if (extracted === null) extracted = extractKrkrProject(project.root);
      return extracted;
    };
    return {
      extract,
      dataFiles: extract().documents,
      // Doctor's delivery question - "is what install wrote still there?" -
      // is answered by the manifest and archive, not by re-reading the game.
      delivery: patchStatus(project),
      sourceLabel: "xp3 archives",
    };
  },
};

export default adapter;
