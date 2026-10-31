/**
 * Deliver a translation to a Ren'Py game as one engine-native resource file.
 *
 * Ren'Py loads every .rpy directly below game/, and its own string translation
 * mechanism is a `translate <language> strings:` block whose old / new pairs are
 * what renpy.translation.translate_string() consults at render time. Dialogue,
 * menu captions, choice labels and the UI strings the engine passes through the
 * same function all resolve against that one table.
 *
 * So the whole delivery is a single file, which is the L4-resource tier for this
 * engine:
 *
 *   1. game/<TRANSLATION_FILE> is written atomically (temp file + rename).
 *   2. `init python:` activates the language, but only while
 *      config.default_language is still None, so a language the player picked in
 *      the settings screen keeps winning. That is Ren'Py's own rule, respected.
 *   3. Uninstalling deletes that one file. No game script is edited, which is
 *      why removing it leaves the game byte identical.
 *
 * Two engine rules shape what gets written:
 *
 *   - A duplicated `old` inside one language is a hard error at startup, not a
 *     warning: Ren'Py raises "A translation for ... already exists at
 *     <file>:<line>." Every pair is therefore deduplicated by source text before
 *     rendering, in a stable order so the same input always yields the same
 *     bytes. (A game that already ships its own translation for the chosen
 *     language can still collide; picking a language the game does not ship is
 *     the caller's decision.)
 *   - String literals are escaped exactly like renpy.translation.quote_unicode,
 *     so a value stays data even when it holds quotes, backslashes or control
 *     characters, and no raw newline ever reaches the file.
 *
 * @module engines/renpy/runtime
 */

import fs from "node:fs";
import path from "node:path";

/** The one file yakusha writes, directly inside the game directory. */
export const TRANSLATION_FILE = "yakusha_translation.rpy";

/** The language activated when the caller does not name one. */
export const DEFAULT_LANGUAGE = "schinese";

/** A Ren'Py language name has to be usable as a Python identifier. */
const LANGUAGE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Names that match the identifier shape but are Python constants, so a
 * `translate None strings:` block would not parse.
 */
const RESERVED_LANGUAGE_NAMES = new Set(["None", "True", "False"]);

/**
 * Control characters escaped by renpy.translation.quote_unicode, in its own
 * order, after the backslash and quote passes have already run.
 *
 * @type {Array<[RegExp, string]>}
 */
const CONTROL_ESCAPES = [
  [/\u0007/g, "\\a"],
  [/\u0008/g, "\\b"],
  [/\u000c/g, "\\f"],
  [/\n/g, "\\n"],
  [/\r/g, "\\r"],
  [/\t/g, "\\t"],
  [/\u000b/g, "\\v"],
];

/** Counter that keeps two temp files apart inside one process. */
let tempCounter = 0;

/**
 * Build an error carrying one of the codes the CLI envelope understands.
 *
 * @param {"E_USAGE"|"E_IO"} code
 * @param {string} message
 * @returns {Error}
 */
function coded(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/**
 * Describe a value for an error message without ever printing "undefined".
 *
 * @param {unknown} value
 * @returns {string}
 */
function describe(value) {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

/**
 * The path of the translation file for a project.
 *
 * It sits at the top of game/, not under game/tl/<language>/: the engine loads
 * both, and the top level is the one place where a single file is unambiguously
 * ours and deleting it cannot disturb a translation the game already ships.
 *
 * @param {{ root: string, gameDir: string }} project
 * @returns {string} absolute path
 */
export function translationPath(project) {
  if (!project || typeof project.gameDir !== "string" || project.gameDir.length === 0) {
    throw coded("E_USAGE", "project.gameDir is required");
  }
  return path.join(project.gameDir, TRANSLATION_FILE);
}

/**
 * True when `name` can be used as a `translate` language name.
 *
 * Ren'Py stores the language in config.language and passes it to
 * renpy.translation.translate_string(), and the header line of a translation
 * block is parsed as a name, so the language has to be a Python identifier and
 * must not be one of the built-in constants.
 *
 * @param {unknown} name
 * @returns {boolean}
 */
export function isLanguageName(name) {
  return typeof name === "string" && LANGUAGE_NAME.test(name) && !RESERVED_LANGUAGE_NAMES.has(name);
}

/**
 * Escape a runtime string so it can be pasted between the quotes of an `old` or
 * `new` line.
 *
 * The rules are the ones in renpy.translation.quote_unicode: a backslash becomes two,
 * a double quote is backslash-escaped, and the seven control characters Python
 * spells with a letter get that spelling. Everything else, including CJK text,
 * text tags such as {b} and interpolations such as [name], passes through
 * verbatim, because Ren'Py reads them back out of the literal unchanged.
 *
 * @param {string} text
 * @returns {string} the body of a double quoted Ren'Py literal
 */
export function quoteRenpy(text) {
  if (typeof text !== "string" || text.length === 0) return "";
  let out = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  for (const [pattern, replacement] of CONTROL_ESCAPES) out = out.replace(pattern, replacement);
  return out;
}

/**
 * Resolve and validate the language an install should target.
 *
 * @param {{ language?: unknown }} options
 * @returns {string}
 * @throws {Error} E_USAGE when the name is not a usable language name
 */
function resolveLanguage(options) {
  const requested = options ? options.language : undefined;
  const language = requested === undefined ? DEFAULT_LANGUAGE : requested;
  if (!isLanguageName(language)) {
    throw coded(
      "E_USAGE",
      "invalid Ren'Py language name: " + describe(language) + " (expected a Python identifier such as " + describe(DEFAULT_LANGUAGE) + ")",
    );
  }
  return language;
}

/**
 * Turn the caller's pairs into the deduplicated, sorted list that gets written.
 *
 * Malformed and empty pairs are dropped rather than rejected: an empty source
 * string can never be a useful key, and an empty translation means the caller
 * has nothing to say about that line yet, so the game keeps its original text.
 * Sorting by source text makes the output independent of the caller's order;
 * the sort is stable, so the first value supplied for a duplicated source is
 * the one that survives.
 *
 * @param {Array<[string, string]|{ source: string, target: string }>} pairs
 * @returns {Array<{ source: string, target: string }>}
 */
function normalisePairs(pairs) {
  if (!Array.isArray(pairs)) {
    throw coded("E_USAGE", "pairs must be an array of [source, target] pairs or { source, target } objects");
  }
  /** @type {Array<{ source: string, target: string }>} */
  const valid = [];
  for (const pair of pairs) {
    let source;
    let target;
    if (Array.isArray(pair)) {
      source = pair[0];
      target = pair[1];
    } else if (pair !== null && typeof pair === "object") {
      source = pair.source;
      target = pair.target;
    } else {
      continue;
    }
    if (typeof source !== "string" || typeof target !== "string") continue;
    if (source.trim().length === 0 || target.trim().length === 0) continue;
    valid.push({ source, target });
  }
  valid.sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {Array<{ source: string, target: string }>} */
  const unique = [];
  for (const pair of valid) {
    if (seen.has(pair.source)) continue;
    seen.add(pair.source);
    unique.push(pair);
  }
  return unique;
}

/**
 * Render the file content and report what went into it.
 *
 * @param {Array<[string, string]|{ source: string, target: string }>} pairs
 * @param {{ language?: string, pluginVersion?: string }} [options]
 * @returns {{ content: string, language: string, entries: number }}
 */
function build(pairs, options = {}) {
  const language = resolveLanguage(options);
  const entries = normalisePairs(pairs);
  const version =
    typeof options.pluginVersion === "string" && options.pluginVersion.length > 0 ? options.pluginVersion : null;

  /** @type {string[]} */
  const lines = [];
  lines.push(version === null ? "# Generated by yakusha. Do not edit by hand." : "# Generated by yakusha " + version + ". Do not edit by hand.");
  lines.push("#");
  lines.push("# yakusha installed the runtime translation into this single file: every");
  lines.push("# translate ... strings entry below replaces the matching original string,");
  lines.push("# and no game script was edited to make that happen.");
  lines.push("#");
  lines.push("# To uninstall, delete this file. The game then reads its original text");
  lines.push("# again, exactly as it did before yakusha touched it.");

  if (entries.length === 0) {
    lines.push("#");
    lines.push("# No entries were supplied, so this file carries no code at all.");
    return { content: lines.join("\n") + "\n", language, entries: 0 };
  }

  lines.push("");
  // init python: without a priority runs at init 0, which is exactly the window
  // that matters here: renpy/common/00defaults.rpy declares
  // config.default_language = None in init -1500 and copies it into
  // _preferences.language at init 1500, on the first launch only. Landing in
  // between is what makes the assignment take effect at all.
  lines.push("init python:");
  // Guarded on purpose: config.default_language is shared with the player's own
  // choice from the settings screen, and an explicit choice must keep winning.
  lines.push("    if config.default_language is None:");
  lines.push("        config.default_language = " + JSON.stringify(language));
  lines.push("");
  lines.push("translate " + language + " strings:");
  lines.push("");
  /** @type {string[]} */
  const blocks = [];
  for (const pair of entries) {
    blocks.push('    old "' + quoteRenpy(pair.source) + '"\n    new "' + quoteRenpy(pair.target) + '"');
  }
  lines.push(blocks.join("\n\n"));

  return { content: lines.join("\n") + "\n", language, entries: entries.length };
}

/**
 * Render the full contents of the translation file.
 *
 * @param {Array<[string, string]|{ source: string, target: string }>} pairs
 * @param {{ language?: string, pluginVersion?: string }} [options] language
 *   defaults to {@link DEFAULT_LANGUAGE}; pluginVersion only decorates the header
 * @returns {string} file content, LF only, exactly one trailing newline
 * @throws {Error} E_USAGE on a bad language name or a non-array pair list
 */
export function renderTranslationFile(pairs, options = {}) {
  return build(pairs, options).content;
}

/**
 * Refuse to write or delete outside the project root.
 *
 * The same contract core/install.js enforces for the RPG Maker plugin: the
 * target may not exist yet, so resolve the nearest existing ancestor through
 * realpath (which catches a symlink pointing out of the tree) and append the
 * missing segments. Every path that ends up outside the root, including the
 * root's parent, is rejected before anything touches the disk.
 *
 * @param {{ root: string }} project
 * @param {string} target
 * @returns {void}
 * @throws {Error} E_IO when the resolved target escapes the root
 */
function assertInsideRoot(project, target) {
  let root;
  try {
    root = fs.realpathSync(project.root);
  } catch (error) {
    throw coded("E_IO", "cannot resolve the project root " + project.root + " (" + ((error && error.code) || "realpath failed") + ")");
  }
  const absolute = path.resolve(target);
  /** @type {string[]} */
  const missing = [];
  let probe = absolute;
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) break;
    missing.unshift(path.basename(probe));
    probe = parent;
  }
  const base = fs.realpathSync(probe);
  const resolved = path.join(base, ...missing);
  const relative = path.relative(root, resolved);
  const escapes = relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative);
  if (escapes) {
    throw coded("E_IO", "refusing to write outside the project root: " + target);
  }
}

/**
 * Replace the contents of `target` in one step.
 *
 * The temporary file lives next to the target so the rename stays on one
 * volume, and it is removed again if anything fails, so a crashed install never
 * leaves a half written script for the engine to load.
 *
 * @param {string} target
 * @param {string} content
 * @returns {void}
 * @throws {Error} E_IO when the write or the rename fails
 */
function writeAtomic(target, content) {
  const dir = path.dirname(target);
  tempCounter += 1;
  const temp = path.join(dir, "." + path.basename(target) + "." + process.pid + "-" + tempCounter + ".tmp");
  try {
    fs.writeFileSync(temp, content, "utf8");
    fs.renameSync(temp, target);
  } catch (error) {
    try {
      fs.rmSync(temp, { force: true });
    } catch {
      // The temp file is best effort; the error below is the one that matters.
    }
    throw coded("E_IO", "cannot write " + target + " (" + ((error && error.code) || "write failed") + ")");
  }
}

/**
 * Write (or refresh) the translation file.
 *
 * The content is rendered before anything else happens, so a bad language name
 * or empty pair list fails without touching the game. A file that already holds
 * exactly the bytes we were about to write is left alone: the result says
 * created:false, changed:false, and the file keeps its timestamp.
 *
 * @param {{ root: string, gameDir: string }} project
 * @param {Array<[string, string]|{ source: string, target: string }>} pairs
 * @param {{ language?: string, pluginVersion?: string }} [options]
 * @returns {{ path: string, language: string, entries: number, created: boolean, changed: boolean }}
 */
export function installTranslation(project, pairs, options = {}) {
  const { content, language, entries } = build(pairs, options);
  const target = translationPath(project);
  assertInsideRoot(project, target);

  let existing = null;
  if (fs.existsSync(target)) {
    try {
      existing = fs.readFileSync(target, "utf8");
    } catch (error) {
      throw coded("E_IO", "cannot read " + target + " (" + ((error && error.code) || "read failed") + ")");
    }
  }

  if (existing === content) {
    return { path: target, language, entries, created: false, changed: false };
  }

  writeAtomic(target, content);
  return { path: target, language, entries, created: existing === null, changed: true };
}

/**
 * Delete the translation file.
 *
 * Nothing else is undone because nothing else was done: the file is the entire
 * install, so a second call and a call on a game that never had one both report
 * removed:false.
 *
 * @param {{ root: string, gameDir: string }} project
 * @returns {{ path: string, removed: boolean }}
 */
export function uninstallTranslation(project) {
  const target = translationPath(project);
  assertInsideRoot(project, target);
  if (!fs.existsSync(target)) return { path: target, removed: false };
  try {
    fs.rmSync(target);
  } catch (error) {
    throw coded("E_IO", "cannot remove " + target + " (" + ((error && error.code) || "remove failed") + ")");
  }
  return { path: target, removed: true };
}

/**
 * Report what is installed, without writing anything.
 *
 * The language is read back out of the file rather than assumed: a caller can
 * pass a different language to installTranslation, and a hand-edited file may
 * have been retargeted, so reporting our default would be a lie. A file that
 * exists but cannot be read (a directory in its place, a locked file) reports
 * zero entries instead of throwing: this is the read-only path a diagnosis
 * command calls, so it must describe damage rather than crash on it.
 *
 * @param {{ root: string, gameDir: string }} project
 * @param {{ language?: string, pairs?: Array<[string, string]|{ source: string, target: string }> }} [options]
 *   language is reported when the file says nothing; when pairs are supplied the
 *   status also rebuilds the file install would write now and reports
 *   dictionaryStale when the bytes on disk differ
 * @returns {{ path: string, exists: boolean, language: string, entries: number, dictionaryStale?: boolean }}
 */
export function translationStatus(project, options = {}) {
  const target = translationPath(project);
  const fallback = isLanguageName(options.language) ? options.language : DEFAULT_LANGUAGE;

  let source = null;
  if (fs.existsSync(target)) {
    try {
      source = fs.readFileSync(target, "utf8");
    } catch {
      return { path: target, exists: true, language: fallback, entries: 0 };
    }
  }
  if (source === null) return { path: target, exists: false, language: fallback, entries: 0 };

  const block = /^translate[ \t]+([A-Za-z_][A-Za-z0-9_]*)[ \t]+strings:/m.exec(source);
  const activated = /config\.default_language[ \t]*=[ \t]*"([^"]*)"/.exec(source);
  let language = fallback;
  if (block !== null) {
    language = block[1];
  } else if (activated !== null && isLanguageName(activated[1])) {
    language = activated[1];
  }
  const entries = (source.match(/^[ \t]*old "/gm) || []).length;
  const status = { path: target, exists: true, language, entries };
  if (Array.isArray(options.pairs)) {
    try {
      status.dictionaryStale = source !== build(options.pairs, { language }).content;
    } catch {
      // A hand-edited language name that the generator refuses means the
      // status cannot be compared; damage is reported elsewhere rather than
      // being mislabelled as a stale dictionary.
    }
  }
  return status;
}
