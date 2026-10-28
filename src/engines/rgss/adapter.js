/**
 * RGSS adapter.
 *
 * RGSS is the runtime shipped with RPG Maker XP, VX and VX Ace. It is not the
 * JSON engine of MZ/MV: game text lives inside Ruby Marshal documents
 * (`Data/*.rxdata`, `*.rvdata`, `*.rvdata2`), a packed release hides those
 * documents in an `RGSSAD`/`RGSS2A`/`RGSS3A` archive, and there is no plugin
 * directory, no `js/plugins.js` and no data directory the tool can rewrite
 * without touching the game's own files.
 *
 * This module wires the engine into the same shape the other adapters expose, so
 * `scan`, `extract`, `translate`, `verify`, `speaker`, `terms`, `export` and
 * `doctor` all work for XP, VX and VX Ace without knowing which engine they are
 * talking to. The runtime tier is deliberately absent: see `capabilities` below.
 *
 * @module engines/rgss/adapter
 */

import fs from "node:fs";
import path from "node:path";

import { capabilities, detectFail, detectOk, notImplemented } from "../adapter.js";
import { dictionaryPath, emptyDictionary, loadDictionary, recordExtracted, saveDictionary, stats } from "../../core/dict.js";
import { launchProject } from "../launch.js";
import { rgssProfile } from "./profile.js";
import { extractRgssProject } from "./extract.js";
import { MAX_SEARCH_DEPTH, findRgssRoot, findRgssRoots, looksLikeRgssProject, openRgssProject } from "./project.js";

const MULTI_ROOT = /^found \d+ RGSS projects under /;

/**
 * The not-a-project message.
 *
 * Wording is ours, not shared with the other engines, so a user who points the
 * tool at the wrong folder is told what an RGSS game looks like on disk: a
 * `Game.ini`, an `RGSSAD`-family archive, or a `Data/` directory holding
 * `.rxdata`/`.rvdata`/`.rvdata2` documents.
 *
 * @param {string} startDir
 * @returns {string}
 */
function notProjectMessage(startDir) {
  return (
    "not an RGSS project (no Game.ini, no .rgssad/.rgss2a/.rgss3a archive and no Data/ directory with .rxdata, .rvdata or .rvdata2 files in " +
    path.resolve(startDir) +
    " or up to " + MAX_SEARCH_DEPTH + " levels below it)"
  );
}

/**
 * The project a directory sits inside, if any.
 *
 * `findRgssRoot` only looks at or below the directory it is given. A player
 * names a game in two other natural ways - the folder holding `Game.exe`, or a
 * subfolder of the game - and both are answered by walking up, the same way the
 * Ren'Py adapter does it. Nothing here guesses: a directory is a root only when
 * `looksLikeRgssProject` says so, which is the test the downward search uses.
 *
 * @param {string} startDir
 * @returns {string|null} absolute root, or null when the directory is not
 *   inside a project
 */
function containingRoot(startDir) {
  let dir = path.resolve(startDir);
  for (let depth = 0; depth <= MAX_SEARCH_DEPTH; depth += 1) {
    if (looksLikeRgssProject(dir)) return dir;
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
  const roots = findRgssRoots(origin);
  if (roots.length === 0) return [];
  const depthOf = (root) => path.relative(origin, root).split(path.sep).filter(Boolean).length;
  const depth = Math.min(...roots.map(depthOf));
  return roots.filter((root) => depthOf(root) === depth);
}

/**
 * CLI scan payload (docs/json-contract.md §7), the same eleven keys as every
 * other engine.
 *
 * Two fields carry engine-specific meaning, and the contract documents them:
 * `dataFiles` counts the documents that decoded (a packed game has no files on
 * disk to count, so the archive's own inventory is the only honest number), and
 * `encodings` counts documents per source format - `marshal` for a packed game,
 * the file extension for an unpacked one.
 *
 * @param {{ root: string, engine: string, version: string|null, gameTitle: string|null }} project
 * @returns {Record<string, unknown>}
 */
export function scanRgss(project) {
  const result = extractRgssProject(project.root);
  const entries = [...result.entries.values()];
  const withCodes = entries.filter((entry) => rgssProfile.grammar.controlCodes(entry.text).length > 0).length;
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
  const result = extractRgssProject(project.root);
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
    if (recordExtracted(target.entries, entry, "rgss")) added += 1;
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
 * were never planned for this release; RGSS delivery *is* planned and only
 * pending, so it gets a message that points at the decision instead of claiming
 * the feature does not exist.
 *
 * @param {string} what
 * @returns {Error}
 */
function pending(what) {
  return coded(
    "E_NOT_IMPLEMENTED",
    what + " is not implemented for RGSS yet - see the pending decisions in docs/dev/DEVLOG.md"
  );
}

export const adapter = {
  id: "rgss",
  name: "RGSS",

  capabilities: capabilities({
    extract: true,
    export: true,
    // XP, VX and VX Ace ship no plugin system and no loadable add-on: text is
    // baked into the data documents, so delivering a translation means writing
    // those documents back. That layer is 0.12 work and still open (see the
    // module comment), which is why the tier is null rather than a guess.
    runtime: null,
    launch: true,
    debuggable: false,
  }),

  detect(startDir) {
    // The project that contains the directory the user pointed at wins over
    // anything found below it: they named one game, not a folder of games.
    const near = containingRoot(startDir);
    if (near !== null) return detectOk(openRgssProject(near));
    let root = null;
    try {
      root = findRgssRoot(startDir);
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      if (!MULTI_ROOT.test(message)) throw error;
      return detectFail("E_MULTI_ROOT", message, shallowestRoots(startDir));
    }
    if (root === null) return detectFail("E_NOT_PROJECT", notProjectMessage(startDir));
    return detectOk(openRgssProject(root));
  },

  scan(project) {
    return scanRgss(project);
  },

  extract(project) {
    return extractIntoDictionary(project);
  },

  /**
   * Delivery: writing a translation back into the game's own data.
   *
   * Two routes exist and neither is decided: rewriting the archive (or the
   * `Data/*.rvdata2` documents of an unpacked game) with the translated strings
   * kept inside the Ruby Marshal stream, or injecting a native helper into the
   * running game. The first is pure JavaScript and the readers and writers it
   * needs are already in this directory; the second needs a compiler this
   * project does not have on hand. Choosing between them changes what uninstall
   * has to restore, so it is recorded as a pending decision rather than guessed.
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
  profile: rgssProfile,

  /** What `doctor` counts when it prints the project size. */
  dataUnit: "data files",

  /**
   * Engine-specific inputs for `diagnose()`.
   *
   * Doctor is engine-neutral but its checks are not: it needs the engine's own
   * extractor, its own document count, the label of its data source and - for an
   * engine whose delivery layer does not exist yet - a delivery state that says
   * so instead of one that claims nothing was installed.
   *
   * The count is the number of documents the scan reports, which is the number
   * that actually decoded: a document the Marshal reader rejects is missing from
   * the scan, so it must be missing here too, or doctor would print a size the
   * user never saw.
   *
   * @param {{ root: string }} project
   * @returns {{ extract: () => object, dataFiles: number, delivery: { pending: true, message: string }, sourceLabel: string }}
   */
  diagnostics(project) {
    let extracted = null;
    const extract = () => {
      if (extracted === null) extracted = extractRgssProject(project.root);
      return extracted;
    };
    return {
      extract,
      dataFiles: extract().documents,
      // Doctor's delivery question - "is what install wrote still there?" - has
      // no answer for an engine that cannot write yet. Returning null would fall
      // through to the RPG Maker branch, which reads pluginsFile (null here) and
      // throws; "pending" is the branch that tells the truth instead.
      delivery: {
        pending: true,
        message: "RGSS has no delivery layer yet, so nothing is written back into the game",
      },
      sourceLabel: "Data/",
    };
  },
};

export default adapter;

