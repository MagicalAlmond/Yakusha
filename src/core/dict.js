/**
 * Translation memory: a flat map from MZ source text to translated text, plus
 * per key provenance so a translator can tell where a string came from.
 *
 * On disk (`yakusha/dictionary.json`):
 * {
 *   "format": "yakusha/1",
 *   "game": "Example Game",
 *   "updatedAt": "2026-...",
 *   "entries": { "<source>": { "text": "<translation>", "contexts": ["Map003:401"] } }
 * }
 *
 * @module core/dict
 */

import fs from "node:fs";
import path from "node:path";

export const FORMAT = "yakusha/1";
export const DICT_DIR = "yakusha";
export const DICT_FILE = "dictionary.json";

/**
 * @typedef {{ text: string, contexts: string[], error?: string }} Entry
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
    if (typeof value === "string") entries[key] = { text: value, contexts: [] };
    else if (value && typeof value.text === "string") {
      const entry = { text: value.text, contexts: Array.isArray(value.contexts) ? value.contexts : [] };
      // A previous run may have recorded why a translation was rejected; keep
      // it so `status` can report it without guessing.
      if (typeof value.error === "string" && value.error.length > 0) entry.error = value.error;
      entries[key] = entry;
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
  const existing = dict.entries[source];
  if (existing) {
    if (context && !existing.contexts.includes(context)) existing.contexts.push(context);
    return;
  }
  dict.entries[source] = { text: "", contexts: context ? [context] : [] };
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
    if (value && typeof value.text === "string" && value.text.length > 0) out[key] = value.text;
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