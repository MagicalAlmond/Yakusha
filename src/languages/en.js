/**
 * English-to-Chinese language judgements.
 *
 * The engine profile supplies grammar (which tokens are codes) and prompt
 * wording; this module supplies everything that depends on the language pair:
 * what counts as an untranslated echo, which leftovers the audit reports and
 * which placeholders must survive.
 *
 * @module languages/en
 */

import { TRADITIONAL } from "./traditional.js";

export const ID = "en";
export const NAME = "English";

/** Latin letters are the minimum signal that a line is English prose. */
const LATIN = /[A-Za-z]/;

/** CJK scripts mean the line is not English source text. */
const CJK = /[\u3040-\u30ff\u3400-\u9fff]/;

/**
 * A run of four Latin letters is a word, not an acronym such as "HP" or "EXP".
 * Short runs stay legal in a Chinese line; longer runs are reported.
 */
const LATIN_WORD = /[A-Za-z]{4,}/;

/**
 * Whether a line looks like English source text rather than Japanese or an
 * already-translated Chinese line. Markup and punctuation are ignored by the
 * simple presence test; an engine profile may pass its visible-text reader.
 *
 * @param {string} text
 * @param {(text: string) => string} [visible]
 * @returns {boolean}
 */
export function isEnglishSource(text, visible = (value) => String(value ?? "")) {
  const plain = visible(text);
  return LATIN.test(plain) && !CJK.test(plain);
}

/**
 * Whether a line still holds an English word outside the engine's markup.
 *
 * @param {string} text
 * @param {(text: string) => string} [visible] engine-specific visible-text reader
 * @returns {boolean}
 */
export function isUntranslated(text, visible = (value) => String(value ?? "")) {
  return LATIN_WORD.test(visible(text));
}

/**
 * Compose the validation and audit half of an engine profile for en → zh.
 *
 * @param {{ visibleText: (text: string) => string }} grammar
 * @param {RegExp} slots placeholder pattern this engine uses
 * @returns {{
 *   validate: { isUntranslated(text: string): boolean, slots: RegExp },
 *   verify: {
 *     residual: RegExp, residualKind: string, residualDetail: string,
 *     echoDetail: string, sourceName: string,
 *     han: RegExp, traditional: Set<string>, slots: RegExp,
 *   },
 * }}
 */
export function englishToChinese(grammar, slots) {
  return {
    validate: {
      isUntranslated: (text) => isUntranslated(text, grammar.visibleText),
      slots,
    },
    verify: {
      residual: LATIN_WORD,
      residualKind: "source",
      residualDetail: "English text left in the translation",
      echoDetail: "target is identical to an English source",
      sourceName: NAME,
      han: /[\u4e00-\u9fff]/,
      traditional: TRADITIONAL,
      slots,
    },
  };
}
