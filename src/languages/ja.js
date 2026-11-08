/**
 * Japanese-to-Chinese language judgements.
 *
 * The engine profile supplies grammar (which tokens are codes) and prompt
 * wording; this module supplies everything that depends on the language pair:
 * what counts as an untranslated echo, which characters the audit reports and
 * which placeholders must survive.
 *
 * @module languages/ja
 */

import { visibleText as defaultVisibleText } from "../core/textkey.js";
import { TRADITIONAL_JOINED } from "../data/traditional.js";

/** Traditional-only characters, built once from the flat pair table. */
export const TRADITIONAL = (() => {
  const set = new Set();
  for (let i = 0; i + 1 < TRADITIONAL_JOINED.length; i += 2) set.add(TRADITIONAL_JOINED[i]);
  return set;
})();

/**
 * Kana that marks an untranslated audit finding.
 *
 * U+30FB (・, middle dot) and U+30FC (ー, prolonged sound mark) are excluded:
 * both are ordinary punctuation in Chinese, so a perfectly translated
 * "睡眠・沈黙" line would otherwise be reported as untranslated.
 */
export const VERIFY_KANA = /[\u3041-\u3096\u30a1-\u30fa]/;

/**
 * Whether a line still contains kana outside the engine's markup.
 *
 * Wider than VERIFY_KANA on purpose: in a *source* line the middle dot and the
 * prolonged mark are Japanese writing, so an unchanged echo is still
 * untranslated even when the verify regex would stay quiet.
 *
 * @param {string} text
 * @param {(text: string) => string} [visible] engine-specific visible-text reader
 * @returns {boolean}
 */
export function isUntranslated(text, visible = defaultVisibleText) {
  return /[\u3040-\u30ff]/.test(visible(text));
}

/**
 * Compose the validation and audit half of an engine profile for ja → zh.
 *
 * @param {{ visibleText: (text: string) => string }} grammar
 * @param {RegExp} slots placeholder pattern this engine uses
 * @returns {{
 *   validate: { isUntranslated(text: string): boolean, slots: RegExp },
 *   verify: { kana: RegExp, han: RegExp, traditional: Set<string>, slots: RegExp },
 * }}
 */
export function japaneseToChinese(grammar, slots) {
  return {
    validate: {
      isUntranslated: (text) => isUntranslated(text, grammar.visibleText),
      slots,
    },
    verify: {
      kana: VERIFY_KANA,
      han: /[\u4e00-\u9fff]/,
      traditional: TRADITIONAL,
      slots,
    },
  };
}
