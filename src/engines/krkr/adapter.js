/**
 * Kirikiri adapter.
 *
 * Kirikiri / KAG games keep their content in .xp3 archives (the game root or
 * its data/ directory hold the archives directly); scenario text lives in KAG
 * scripts (.ks) inside them. There is no plugin directory, no js/plugins.js
 * and no data document the tool can rewrite without touching the game's own
 * files - and unlike Ren'Py, the engine has no translation-resource folder the
 * tool could fill. This module wires the engine into the same shape the other
 * adapters expose, so `scan`, `extract`, `translate`, `verify`, `speaker`,
 * `terms`, `export` and `doctor` all work without knowing which engine they
 * are talking to. The runtime tier is deliberately absent: see `capabilities`.
 *
 * @module engines/krkr/adapter
 */

import fs from "node:fs";
import path from "node:path";

import { capabilities, detectFail, detectOk, notImplemented } from "../adapter.js";
import { dictionaryPath, emptyDictionary, loadDictionary, saveDictionary, stats } from "../../core/dict.js";
import { launchProject } from "../launch.js";
import { krkrProfile } from "./profile.js";
import { extractKrkrProject } from "./extract.js";
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
    // strings, because the CLI joins them into one line.
    undecodable: result.undecodable.map((item) => item.file + ": " + item.error),
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
export function extractIntoDictionary(project) {
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
  let added = 0;
  for (const entry of result.entries.values()) {
    const before = target.entries[entry.text];
    if (!before) {
      target.entries[entry.text] = { text: "", contexts: [...entry.contexts].sort() };
      added += 1;
    } else {
      for (const context of entry.contexts) {
        if (!before.contexts.includes(context)) before.contexts.push(context);
      }
    }
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

/**
 * The runtime tier is not implemented, and says so in its own words.
 *
 * `notImplemented()` from ../adapter.js is the shared wording for features that
 * were never planned for this release; Kirikiri delivery *is* planned and only
 * pending, so it gets a message that points at the decision instead of claiming
 * the feature does not exist.
 *
 * @param {string} what
 * @returns {Error}
 */
function pending(what) {
  return coded(
    "E_NOT_IMPLEMENTED",
    what + " is not implemented for Kirikiri yet - see the pending decisions in docs/dev/DEVLOG.md"
  );
}

export const adapter = {
  id: "krkr",
  name: "Kirikiri",

  capabilities: capabilities({
    extract: true,
    export: true,
    // Kirikiri text is packed inside the game's own archives and the engine
    // offers no translation-resource slot: delivering a translation would mean
    // writing archives back. That layer is not built in 0.13 (see the module
    // comment), which is why the tier is null rather than a guess.
    runtime: null,
    launch: true,
    debuggable: false,
  }),

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

  extract(project) {
    return extractIntoDictionary(project);
  },

  /**
   * Delivery: writing a translation back into the game.
   *
   * Kirikiri offers no translation-resource directory the engine reads on its
   * own, so delivery would mean rewriting the game's .xp3 archives with
   * modified .ks files. That is a write path through an archive format whose
   * encrypted variants (krkr2 per-file keys, krkrz cxdec) this project
   * deliberately does not touch, and it is recorded as a pending decision
   * rather than guessed.
   *
   * @returns {never}
   */
  installRuntime() {
    throw pending("install");
  },

  /**
   * @returns {never}
   */
  uninstallRuntime() {
    throw pending("uninstall");
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
   * @param {{ root: string }} project
   * @returns {{ extract: () => object, dataFiles: number, delivery: { pending: true, message: string }, sourceLabel: string }}
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
      // has no answer for an engine that cannot write yet. Returning null
      // would fall through to the RPG Maker branch, which reads pluginsFile
      // (null here) and throws; "pending" is the branch that tells the truth.
      delivery: {
        pending: true,
        message: "Kirikiri has no delivery layer yet, so nothing is written back into the game",
      },
      sourceLabel: "xp3 archives",
    };
  },
};

export default adapter;
