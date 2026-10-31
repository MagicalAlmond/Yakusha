/**
 * Translation memory: a flat map from MZ source text to translated text, plus
 * per key provenance so a translator can tell where a string came from.
 *
 * On disk (`yakusha/dictionary.json`):
 * {
 *   "format": "yakusha/1",
 *   "game": "Example Game",
 *   "updatedAt": "2026-...",
 *   "entries": {
 *     "<source>": {
 *       "text": "<translation>",
 *       "contexts": ["Map003.json:401"],
 *       "engine": "mz",
 *       "locator": ["Map003.json#/events/0/pages/0/list/4/parameters/0"]
 *     }
 *   }
 * }
 *
 * `engine` and `locator` are optional provenance added in 0.17. A dictionary
 * written by an older version has neither and still loads; both are dropped
 * from an entry only when they are malformed.
 *
 * @module core/dict
 */

import fs from "node:fs";
import path from "node:path";

export const FORMAT = "yakusha/1";

/**
 * Define an entry without treating a key such as "__proto__" as the prototype
 * setter. Object.defineProperty creates an ordinary own property even for
 * names that exist on Object.prototype.
 *
 * @param {Record<string, unknown>} map
 * @param {string} key
 * @param {unknown} value
 */
function defineEntry(map, key, value) {
  Object.defineProperty(map, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

export const DICT_DIR = "yakusha";
export const DICT_FILE = "dictionary.json";

/**
 * @typedef {{ text: string, contexts: string[], engine?: string, locator?: string[], error?: string }} Entry
 * @typedef {{ format: string, game: string|null, updatedAt: string, entries: Record<string, Entry> }} Dictionary
 */

/** @returns {Dictionary} */
export function emptyDictionary(game = null) {
  return { format: FORMAT, game, updatedAt: new Date().toISOString(), entries: {} };
}

/**
 * @param {string} projectRoot
 * @returns {string}
 */
export function dictionaryPath(projectRoot) {
  return path.join(projectRoot, DICT_DIR, DICT_FILE);
}

/**
 * @param {string} file
 * @returns {Dictionary}
 */
export function loadDictionary(file) {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!raw || typeof raw !== "object" || typeof raw.entries !== "object") {
    throw new Error("not a yakusha dictionary: " + file);
  }
  const entries = {};
  for (const [key, value] of Object.entries(raw.entries)) {
    if (typeof value === "string") defineEntry(entries, key, { text: value, contexts: [] });
    else if (value && typeof value.text === "string") {
      const entry = { text: value.text, contexts: Array.isArray(value.contexts) ? value.contexts : [] };
      // Optional provenance (0.17). Malformed values are dropped rather than
      // failing the whole dictionary: they never change what is translated.
      if (typeof value.engine === "string" && value.engine.length > 0) entry.engine = value.engine;
      if (Array.isArray(value.locator)) {
        const locator = value.locator.filter((item) => typeof item === "string" && item.length > 0);
        if (locator.length > 0) entry.locator = locator;
      }
      // A previous run may have recorded why a translation was rejected; keep
      // it so `status` can report it without guessing.
      if (typeof value.error === "string" && value.error.length > 0) entry.error = value.error;
      defineEntry(entries, key, entry);
    }
  }
  return {
    format: typeof raw.format === "string" ? raw.format : FORMAT,
    game: typeof raw.game === "string" ? raw.game : null,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
    entries,
  };
}

/**
 * @param {string} file
 * @param {Dictionary} dict
 */
export function saveDictionary(file, dict) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  dict.updatedAt = new Date().toISOString();
  fs.writeFileSync(file, JSON.stringify(dict, null, 2) + "\n", "utf8");
}

/**
 * Record an untranslated source string.
 *
 * @param {Dictionary} dict
 * @param {string} source
 * @param {string} context e.g. "Map003.json:401"
 */
export function note(dict, source, context) {
  if (typeof source !== "string" || source.length === 0) return;
  const existing = Object.hasOwn(dict.entries, source) ? dict.entries[source] : undefined;
  if (existing) {
    if (context && !existing.contexts.includes(context)) existing.contexts.push(context);
    return;
  }
  defineEntry(dict.entries, source, { text: "", contexts: context ? [context] : [] });
}

/**
 * Record one freshly extracted entry in the dictionary.
 *
 * A new key starts empty; an existing key keeps its translation and only gains
 * the contexts, engine and locators the new extraction found. Locators are
 * positions in the current game files, so a re-extraction replaces them
 * wholesale instead of accumulating stale ones.
 *
 * @param {Record<string, Entry>} entries dictionary entries
 * @param {{ text: string, contexts: Set<string>, locators?: Set<string> }} source extracted entry
 * @param {string} engine engine id, e.g. "mz" or "rgss"
 * @returns {boolean} true when a new key was added
 */
export function recordExtracted(entries, source, engine) {
  const locator = [...(source.locators || [])].sort();
  const before = Object.hasOwn(entries, source.text) ? entries[source.text] : undefined;
  if (!before) {
    const entry = { text: "", contexts: [...source.contexts].sort(), engine };
    if (locator.length > 0) entry.locator = locator;
    defineEntry(entries, source.text, entry);
    return true;
  }
  for (const context of source.contexts) {
    if (!before.contexts.includes(context)) before.contexts.push(context);
  }
  if (typeof before.engine !== "string" || before.engine.length === 0) before.engine = engine;
  if (locator.length > 0) before.locator = locator;
  return false;
}

/**
 * Only translated entries, as a plain source→target map.
 *
 * @param {Dictionary} dict
 * @returns {Record<string, string>}
 */
export function translatedOnly(dict) {
  const out = {};
  for (const [key, value] of Object.entries(dict.entries)) {
    if (value && typeof value.text === "string" && value.text.length > 0) defineEntry(out, key, value.text);
  }
  return out;
}

/**
 * @param {Dictionary} dict
 * @returns {{ total: number, translated: number, pending: number }}
 */
export function stats(dict) {
  const keys = Object.keys(dict.entries);
  const translated = keys.filter((k) => dict.entries[k].text).length;
  return { total: keys.length, translated, pending: keys.length - translated };
}