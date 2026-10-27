/**
 * Export a dictionary as a standalone JSON snapshot (docs/export-format.md).
 *
 * This is deliberately not a second dictionary writer: the output is a
 * projection of the translated entries only, with no error field and no
 * dependency on the project path. The dictionary remains the source of truth.
 *
 * @module cli/export
 */

import fs from "node:fs";
import path from "node:path";

import { FORMAT } from "../core/dict.js";
import { CliError } from "./envelope.js";

/**
 * Build the object that will be serialised. Entry keys are sorted with the
 * default comparator (UTF-16 code units), never localeCompare, so the same
 * dictionary produces the same bytes on every machine.
 *
 * @param {import("../core/dict.js").Dictionary} dictionary
 * @param {{ flat?: boolean }} [options]
 * @returns {{ format: string, game: string, updatedAt: string, entries: Record<string, unknown> }}
 */
export function buildExport(dictionary, options = {}) {
  const flat = options.flat === true;
  const entries = Object.create(null);
  for (const key of Object.keys(dictionary.entries).sort()) {
    const entry = dictionary.entries[key];
    if (!entry || typeof entry.text !== "string" || entry.text.length === 0) continue;
    if (flat) {
      entries[key] = entry.text;
    } else {
      entries[key] = {
        text: entry.text,
        // Copy the array so a caller cannot mutate the dictionary through the
        // export object; order and duplicates are part of the contract.
        contexts: Array.isArray(entry.contexts) ? entry.contexts.slice() : [],
      };
    }
  }
  return {
    format: FORMAT,
    // A hand-written dictionary may have no game title. Do not infer one from
    // the project directory: an empty string is the documented output.
    game: typeof dictionary.game === "string" ? dictionary.game : "",
    updatedAt: typeof dictionary.updatedAt === "string" ? dictionary.updatedAt : "",
    entries,
  };
}

/**
 * Serialise the export with the same shape as JSON.stringify(obj, null, 2).
 *
 * The entries object is written by hand because JavaScript reorders integer
 * like keys ("2" before "10") regardless of insertion order. The contract
 * requires UTF-16 order for every key, so sorting a plain object and calling
 * JSON.stringify would silently violate it. Values still go through
 * JSON.stringify, so escaping and indentation stay identical.
 *
 * @param {{ format: string, game: string, updatedAt: string, entries: Record<string, unknown> }} data
 * @returns {string}
 */
export function serialiseExport(data) {
  const keys = Object.keys(data.entries).sort();
  const lines = [
    "{",
    '  "format": ' + JSON.stringify(data.format) + ",",
    '  "game": ' + JSON.stringify(data.game) + ",",
    '  "updatedAt": ' + JSON.stringify(data.updatedAt) + ",",
    '  "entries": ' + serialiseEntries(data.entries, keys),
    "}",
  ];
  return lines.join("\n") + "\n";
}

/**
 * @param {Record<string, unknown>} entries
 * @param {string[]} keys already sorted
 * @returns {string}
 */
function serialiseEntries(entries, keys) {
  if (keys.length === 0) return "{}";
  const lines = keys.map((key, index) => {
    const suffix = index === keys.length - 1 ? "" : ",";
    return "    " + JSON.stringify(key) + ": " + indentValue(JSON.stringify(entries[key], null, 2)) + suffix;
  });
  return "{\n" + lines.join("\n") + "\n  }";
}

/**
 * JSON.stringify already indents a nested value relative to column zero. Add
 * four spaces to every line after the first so it sits under an entry key.
 *
 * @param {string} text
 * @returns {string}
 */
function indentValue(text) {
  const lines = text.split("\n");
  return lines.map((line, index) => (index === 0 ? line : "    " + line)).join("\n");
}

/**
 * Write a fully serialised export through a same-directory temporary file.
 * The original file is never opened for truncation; a failed write leaves it
 * exactly as it was, and the temporary file is removed.
 *
 * @param {string} file absolute target path
 * @param {string} text complete file contents
 * @param {{ force?: boolean }} [options]
 * @returns {{ bytes: number }}
 */
export function writeExportFile(file, text, options = {}) {
  const force = options.force === true;
  let stats = null;
  try {
    stats = fs.statSync(file);
  } catch (error) {
    if (!error || error.code !== "ENOENT") {
      throw ioError("cannot inspect export target: " + file, error);
    }
  }
  if (stats) {
    if (stats.isDirectory()) throw new CliError("E_IO", "export target is a directory: " + file);
    if (!force) throw new CliError("E_EXISTS", "refusing to overwrite " + file + " (pass --force)");
  }

  const dir = path.dirname(file);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (error) {
    throw ioError("cannot create export directory: " + dir, error);
  }
  const temp = path.join(dir, ".export." + process.pid + "." + Math.random().toString(16).slice(2) + ".tmp");
  try {
    fs.writeFileSync(temp, text, { encoding: "utf8", flag: "wx" });
    fs.renameSync(temp, file);
  } catch (error) {
    try {
      fs.unlinkSync(temp);
    } catch {
      // The temporary file may not exist; the target must stay untouched.
    }
    throw ioError("cannot write export file: " + file, error);
  }
  return { bytes: Buffer.byteLength(text, "utf8") };
}

/**
 * Refuse to replace the live dictionary, even with --force. realpath is used
 * so a symlink and a case-only difference still resolve to the same file.
 *
 * @param {string} target absolute export target
 * @param {string} dictionaryFile absolute live dictionary path
 */
export function assertNotDictionaryTarget(target, dictionaryFile) {
  const resolvedTarget = canonicalPath(target);
  let resolvedDictionary;
  try {
    resolvedDictionary = fs.realpathSync(dictionaryFile);
  } catch (error) {
    throw ioError("cannot resolve dictionary path: " + dictionaryFile, error);
  }
  if (samePath(resolvedTarget, resolvedDictionary)) {
    throw new CliError(
      "E_EXISTS",
      "refusing to overwrite the project dictionary at " + dictionaryFile + " (export is a projection, not a backup)"
    );
  }
}

/**
 * The warning docs/export-format.md asks for: a target inside the game is
 * allowed, but outside yakusha/ it can be hit by a game update or uninstall.
 *
 * @param {string} projectRoot
 * @param {string} target absolute export target
 * @returns {string|null}
 */
export function exportLocationWarning(projectRoot, target) {
  let root;
  try {
    root = fs.realpathSync(projectRoot);
  } catch {
    return null;
  }
  const resolved = path.resolve(target);
  if (!isInside(root, resolved)) return null;
  if (isInside(path.join(root, "yakusha"), resolved)) return null;
  return "export target is inside the game directory but outside yakusha/: " + resolved;
}

/** @param {string} parent @param {string} child */
function isInside(parent, child) {
  const relative = path.relative(parent, child);
  if (relative === "") return true;
  return relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative);
}

/** @param {string} file */
function canonicalPath(file) {
  try {
    return fs.realpathSync(file);
  } catch {
    try {
      return path.join(fs.realpathSync(path.dirname(file)), path.basename(file));
    } catch {
      return path.resolve(file);
    }
  }
}

/** @param {string} a @param {string} b */
function samePath(a, b) {
  const left = path.resolve(a);
  const right = path.resolve(b);
  if (process.platform === "win32") return left.toLowerCase() === right.toLowerCase();
  return left === right;
}

/** @param {string} message @param {unknown} error */
function ioError(message, error) {
  const code = error && error.code ? error.code : "unknown error";
  return new CliError("E_IO", message + " (" + code + ")");
}

/**
 * Read an export document back into rows for import. Accepts both the rich
 * shape ({text, contexts}) and the flat one (a bare string per key), which is
 * what buildExport writes depending on --flat.
 *
 * @param {string} text
 * @returns {{source: string, target: string, contexts: string[]}[]}
 */
export function parseExportEntries(text) {
  let document;
  try {
    document = JSON.parse(text);
  } catch {
    throw new CliError("E_DICTIONARY", "the export file is not valid JSON");
  }
  const entries = document && typeof document === "object"
    && document.entries && typeof document.entries === "object"
    ? document.entries
    : null;
  if (!entries) throw new CliError("E_DICTIONARY", "the export file has no entries object");
  const rows = [];
  for (const [source, value] of Object.entries(entries)) {
    if (typeof value === "string") {
      rows.push({ source, target: value, contexts: [] });
      continue;
    }
    if (value && typeof value === "object" && typeof value.text === "string") {
      const contexts = Array.isArray(value.contexts)
        ? value.contexts.filter((context) => typeof context === "string")
        : [];
      rows.push({ source, target: value.text, contexts });
      continue;
    }
    const label = JSON.stringify(source.length > 80 ? source.slice(0, 80) : source);
    throw new CliError("E_DICTIONARY", "the export file entry " + label + " is neither a string nor an object with a text field");
  }
  return rows;
}
