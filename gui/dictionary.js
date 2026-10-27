/**
 * Dictionary access for the GUI shell.
 *
 * Electron-free and testable: the main process needs to read the dictionary
 * for the editor and write one entry back, but the on-disk format and the
 * validation stay with {@link module:core/dict} — the exact module the CLI
 * trusts. This module adds no new format, no new error code and no batch
 * rewrite: it loads, mutates one entry in memory and saves the same object
 * back, so a damaged dictionary fails with the same E_DICTIONARY wording the
 * commands produce.
 *
 * @module gui/dictionary
 */

import fs from "node:fs";

import * as dict from "../src/core/dict.js";

/**
 * Read a project's dictionary for the editor.
 *
 * @param {string} projectRoot game root directory
 * @returns {{ file: string, entries: { key: string, text: string, contexts: string[], error?: string, pending: boolean }[],
 *   translated: number, pendingCount: number }} sorted by key (UTF-16 order, the
 *   order the CLI's JSON output uses)
 * @throws {Error & { code: string }} E_NO_DICTIONARY / E_DICTIONARY like the runner
 */
export function readDictionary(projectRoot) {
  const file = dict.dictionaryPath(projectRoot);
  if (!fs.existsSync(file)) {
    return fail("E_NO_DICTIONARY", "no dictionary yet: " + file);
  }
  let data;
  try {
    data = dict.loadDictionary(file);
  } catch (error) {
    return fail("E_DICTIONARY", error && error.message ? error.message : String(error));
  }
  const entries = Object.keys(data.entries).sort().map((key) => {
    const entry = data.entries[key];
    return {
      key,
      text: entry.text,
      contexts: entry.contexts,
      error: entry.error,
      pending: entry.text === "",
    };
  });
  const translated = entries.length - entries.filter((entry) => entry.pending).length;
  return { file, entries, translated, pendingCount: entries.length - translated };
}

/**
 * Write one entry's translation and save the dictionary.
 *
 * @param {string} projectRoot game root directory
 * @param {string} key source string (the dictionary key)
 * @param {string} text new target text ("" resets to pending)
 * @returns {{ file: string, key: string, translated: number, pendingCount: number }}
 * @throws {Error & { code: string }} E_NO_DICTIONARY / E_DICTIONARY / E_USAGE
 *   (unknown key)
 */
export function writeEntry(projectRoot, key, text) {
  if (typeof key !== "string" || key.length === 0) {
    return fail("E_USAGE", "a dictionary entry key is required");
  }
  if (typeof text !== "string") {
    return fail("E_USAGE", "the entry text must be a string");
  }
  const file = dict.dictionaryPath(projectRoot);
  if (!fs.existsSync(file)) {
    return fail("E_NO_DICTIONARY", "no dictionary yet: " + file);
  }
  let data;
  try {
    data = dict.loadDictionary(file);
  } catch (error) {
    return fail("E_DICTIONARY", error && error.message ? error.message : String(error));
  }
  if (!Object.hasOwn(data.entries, key)) {
    return fail("E_USAGE", "no such dictionary entry: " + key);
  }
  data.entries[key].text = text;
  try {
    dict.saveDictionary(file, data);
  } catch (error) {
    return fail("E_IO", "cannot write " + file + ": " + ((error && error.code) || "write failed"));
  }
  const translated = Object.values(data.entries).filter((entry) => entry.text !== "").length;
  return {
    file,
    key,
    translated,
    pendingCount: Object.keys(data.entries).length - translated,
  };
}

/**
 * @param {string} code
 * @param {string} message
 * @returns {never}
 */
function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}
