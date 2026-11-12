/**
 * Source-language registry.
 *
 * A language module owns everything that depends on the pair: detection of an
 * untranslated echo, audit patterns and the wording of the system prompt. The
 * engine profile owns grammar only, so the two axes stay independent.
 *
 * @module languages/index
 */

import * as ja from "./ja.js";
import * as en from "./en.js";

/** Source languages this build can read, in registry order. */
export const SOURCE_LANGUAGES = Object.freeze(["ja", "en"]);

/** Japanese stays the default so existing commands behave unchanged. */
export const DEFAULT_SOURCE_LANGUAGE = "ja";

const MODULES = Object.freeze({ ja, en });
const PAIRS = Object.freeze({ ja: ja.japaneseToChinese, en: en.englishToChinese });

/**
 * @param {unknown} id
 * @returns {boolean}
 */
export function isSourceLanguage(id) {
  return typeof id === "string" && Object.prototype.hasOwnProperty.call(MODULES, id);
}

/**
 * Resolve one source-language module.
 *
 * @param {string} [id]
 * @returns {{ ID: string, NAME: string }}
 */
export function sourceLanguage(id = DEFAULT_SOURCE_LANGUAGE) {
  if (!isSourceLanguage(id)) {
    throw new RangeError(
      "unknown source language: " + String(id) + " (expected one of: " + SOURCE_LANGUAGES.join(", ") + ")"
    );
  }
  return MODULES[id];
}

/**
 * The engine-profile half for one source language.
 *
 * @param {string} [id]
 * @returns {(grammar: { visibleText: (text: string) => string }, slots: RegExp) => object}
 */
export function pairFor(id = DEFAULT_SOURCE_LANGUAGE) {
  sourceLanguage(id);
  return PAIRS[id];
}
