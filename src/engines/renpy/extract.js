import fs from "node:fs";
import path from "node:path";

import { walkScripts } from "./project.js";
import { TRANSLATION_FILE } from "./runtime.js";
import { collectScriptStrings } from "./rpyscript.js";
import { collectStrings, isRpyc } from "./rpyc.js";

/**
 * One translatable unit collected from a Ren'Py script.
 *
 * @typedef {object} RenpyUnit
 * @property {string} text display text taken verbatim from the script
 * @property {"say"|"menu"|"string"|"screen"} kind where the text came from
 * @property {string} file path relative to the project root, POSIX separators
 * @property {number|null} line 1-based line in the source, or null when the
 *   compiled file does not record one
 */

/**
 * Project-relative form of a script path.
 *
 * Ren'Py projects are read on every platform, but these paths end up in
 * reports and in contexts, so they always use forward slashes: a Windows run
 * must produce the same "game/script.rpy" a POSIX run does.
 *
 * @param {string} projectRoot absolute project root
 * @param {string} absolutePath absolute path of a script below it
 * @returns {string} POSIX-separated path relative to the project root
 */
function relativeScriptPath(projectRoot, absolutePath) {
  return path.relative(projectRoot, absolutePath).split(path.sep).join("/");
}

/**
 * Whether a path names a compiled Ren'Py script.
 *
 * @param {string} absolutePath path of a file returned by walkScripts
 * @returns {boolean} true for .rpyc
 */
function isCompiledName(absolutePath) {
  return absolutePath.toLowerCase().endsWith(".rpyc");
}

/**
 * Reduce a thrown value to a single line for the undecodable report.
 *
 * The report is rendered as a table, so a message spanning lines would break
 * the columns. The decoders throw one-liners already; this only guards the
 * rest.
 *
 * @param {unknown} error caught value
 * @returns {string} message of the first line
 */
function errorLine(error) {
  const text =
    error !== null && typeof error === "object" && typeof error.message === "string"
      ? error.message
      : String(error);
  return text.split("\n")[0];
}

/**
 * Collect the strings of a compiled .rpyc.
 *
 * Both compiled layouts reach collectStrings: the modern "RENPY RPC2"
 * container and the headerless single zlib stream written by Ren'Py 6 and
 * early 7. Only the first carries the marker, so isRpyc must not be a hard
 * gate; it only decides the wording when the file turns out to be
 * undecodable, where "no marker" reads better than a bare zlib complaint.
 *
 * @param {Buffer} buffer file contents
 * @param {string} file project-relative path recorded on every unit
 * @returns {RenpyUnit[]} collected units, in source order
 * @throws {Error} when the file cannot be decoded at all
 */
function readCompiledUnits(buffer, file) {
  try {
    return collectStrings(buffer, file).strings;
  } catch (error) {
    if (isRpyc(buffer)) throw error;
    throw new Error(errorLine(error) + " (no Ren'Py RPC2 container marker)");
  }
}

/**
 * Collect every translatable string of a Ren'Py project, keeping failures.
 *
 * This is the layer below extractRenpyProject: it decodes each script and
 * reports what it found, without deduplicating by text or counting
 * occurrences. Callers that need the aggregated view use the extractor;
 * callers that write translations back, where every position matters, can use
 * this directly.
 *
 * The translation file yakusha writes during install is skipped: it lives in
 * game/ but is generated output, not part of the game.
 *
 * A script that cannot be read or decoded lands in undecodable and the walk
 * continues: one broken .rpyc in a packaged game must not cost the user the
 * rest of the project.
 *
 * @param {string} projectRoot project root, the directory holding the game/
 *   directory
 * @returns {{units: RenpyUnit[], undecodable: Array<{file: string, error: string}>,
 *   scripts: {rpy: number, rpyc: number}}} collected units in walk order, the
 *   scripts that failed, and how many scripts were decoded per format
 */
export function collectRenpyUnits(projectRoot) {
  const root = path.resolve(projectRoot);
  /** @type {RenpyUnit[]} */
  const units = [];
  /** @type {Array<{file: string, error: string}>} */
  const undecodable = [];
  const scripts = { rpy: 0, rpyc: 0 };

  // A development copy ships script.rpy and script.rpyc side by side: the
  // interpreter loads the compiled one, but the two describe the same script,
  // so reading both would report every line twice and halve the value of the
  // occurrence count. The source wins: it is the text a translator edits and
  // the only one that carries line numbers on every Ren'Py version.
  const scriptFiles = walkScripts(path.join(root, "game"));
  const sourceStems = new Set(
    scriptFiles.filter((file) => !isCompiledName(file)).map((file) => path.join(path.dirname(file), path.basename(file, path.extname(file))))
  );

  for (const absolutePath of scriptFiles) {
    // yakusha's own delivered translation is a .rpy file inside game/, so the
    // walk sees it. It holds nothing to translate and counting it would move
    // the reported script count every time install or uninstall runs.
    if (path.basename(absolutePath) === TRANSLATION_FILE) continue;
    if (isCompiledName(absolutePath)) {
      const stem = path.join(path.dirname(absolutePath), path.basename(absolutePath, path.extname(absolutePath)));
      if (sourceStems.has(stem)) continue;
    }
    const file = relativeScriptPath(root, absolutePath);
    const compiled = isCompiledName(absolutePath);
    try {
      const found = compiled
        ? readCompiledUnits(fs.readFileSync(absolutePath), file)
        : collectScriptStrings(fs.readFileSync(absolutePath, "utf8"), file).strings;
      units.push(...found);
      // Counted only after the decode: a file that failed adds no script.
      if (compiled) scripts.rpyc += 1;
      else scripts.rpy += 1;
    } catch (error) {
      undecodable.push({ file, error: errorLine(error) });
    }
  }

  return { units, undecodable, scripts };
}

/**
 * Build the context key of one unit.
 *
 * The format is "<path>:<line>", matching the rest of the pipeline, except
 * that a unit whose compiled node recorded no line number keeps just the path
 * rather than a dangling colon.
 *
 * @param {RenpyUnit} unit collected unit
 * @returns {string} context key
 */
function contextOf(unit) {
  if (unit.line === null || unit.line === undefined) return unit.file;
  return unit.file + ":" + unit.line;
}

/**
 * Aggregate a Ren'Py project into the shape extractProject produces.
 *
 * The result mirrors src/core/extract.js field for field, so the translation
 * pipeline can treat a Ren'Py project like any other engine's, plus the
 * scripts diagnostic that separates a source project from a packaged one.
 *
 * Two rules differ from the generic extractor on purpose:
 *
 * - nothing is filtered here. A text is recorded exactly as a decoder produced
 *   it, because the decoders already dropped what cannot be translated, and
 *   dropping again would silently lose a position the caller could not see;
 * - a context is "<path>:<line>" as described by contextOf, rather than the
 *   line-less form the generic extractor uses.
 *
 * @param {string} projectRoot project root, the directory holding the game/
 *   directory
 * @returns {{entries: Map<string, {text: string, contexts: Set<string>, count: number}>,
 *   perFile: Record<string, number>, totalStrings: number, commandCounts: {},
 *   undecodable: Array<{file: string, error: string}>,
 *   encodings: {rpy: number, rpyc: number}, scripts: {rpy: number, rpyc: number}}}
 *   deduplicated entries keyed by text, occurrences per file, the number of
 *   occurrences overall, the always-empty commandCounts slot the shared shape
 *   requires, the scripts that failed, and the script counters
 */
export function extractRenpyProject(projectRoot) {
  const { units, undecodable, scripts } = collectRenpyUnits(projectRoot);
  /** @type {Map<string, {text: string, contexts: Set<string>, count: number}>} */
  const entries = new Map();
  /** @type {Record<string, number>} */
  const perFile = {};
  let totalStrings = 0;

  for (const unit of units) {
    const context = contextOf(unit);
    const known = entries.get(unit.text);
    if (known) {
      known.count += 1;
      known.contexts.add(context);
    } else {
      entries.set(unit.text, { text: unit.text, contexts: new Set([context]), count: 1 });
    }
    totalStrings += 1;
    // Occurrences, not distinct texts: a line said twice is two positions to
    // fill, so the file carries two units of work.
    perFile[unit.file] = (perFile[unit.file] ?? 0) + 1;
  }

  return {
    entries,
    perFile,
    totalStrings,
    commandCounts: {},
    undecodable,
    // Two objects with equal numbers rather than one shared reference, so a
    // caller mutating one field cannot corrupt the other.
    encodings: { rpy: scripts.rpy, rpyc: scripts.rpyc },
    scripts: { rpy: scripts.rpy, rpyc: scripts.rpyc },
  };
}

export default { collectRenpyUnits, extractRenpyProject };
