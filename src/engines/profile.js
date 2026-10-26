/**
 * Engine and language-pair rules the pipeline reads instead of hard-coding.
 *
 * Everything exported here describes one pairing: "RPG Maker text, Japanese to
 * Chinese", the only one 0.10 ships. The pipeline modules accept a profile
 * through their options and fall back to the values this file holds, so a
 * future engine plugs in by handing over a different profile object without
 * touching src/pipeline (docs/engines.md: engine specific rules ride on the
 * adapter, never on the pipeline).
 *
 * The defaults below deliberately restate what src/pipeline/verify.js and
 * src/pipeline/translate.js fall back to; both sides must stay in sync until
 * every caller passes a profile.
 *
 * @module engines/profile
 */

import { controlCodes, plainText, tokenize, visibleText } from "../core/textkey.js";
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
 * Decide that a source line was echoed back without being translated.
 *
 * Wider than VERIFY_KANA on purpose: in a *source* line the middle dot and the
 * prolonged mark are Japanese writing, so an unchanged echo is still
 * untranslated even when the verify regex would stay quiet.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function isUntranslated(text) {
  return /[\u3040-\u30ff]/.test(visibleText(text));
}

/**
 * @typedef {object} EngineProfile
 * @property {string} id stable identifier, e.g. "rpg-maker"
 * @property {{ task(lang: string): string, escapeExamples: string }} prompt
 *   prompt fragments a request needs from the engine
 * @property {{
 *   tokenize: (line: string) => Array<{ t: string, v: string }>,
 *   controlCodes: (text: string) => string[],
 *   plainText: (text: string) => string,
 *   visibleText: (text: string) => string,
 * }} grammar the engine's escape-code grammar
 * @property {{ isUntranslated(text: string): boolean, slots: RegExp }} validate
 *   judgements applied to model output before it is stored
 * @property {{ kana: RegExp, han: RegExp, traditional: Set<string>, slots: RegExp }} verify
 *   judgements applied by the dictionary audit
 */

/**
 * The RPG Maker profile: RM escape-code grammar, prompt wording and the
 * Japanese-to-Chinese judgements.
 *
 * @type {EngineProfile}
 */
export const rmProfile = {
  id: "rpg-maker",

  prompt: {
    task(lang) {
      return "You translate RPG Maker MZ game text from Japanese into " + lang + ".";
    },
    escapeExamples: ["\\C[6]", "\\V[12]", "\\N[1]", "\\G", "\\{", "\\}", "\\>", "\\<", "\\^", "\\!", "\\|", "\\.", "\\$"].join(", "),
  },

  grammar: { tokenize, controlCodes, plainText, visibleText },

  validate: {
    isUntranslated,
    slots: /%[0-9]+/g,
  },

  verify: {
    kana: VERIFY_KANA,
    han: /[\u4e00-\u9fff]/,
    traditional: TRADITIONAL,
    slots: /%[0-9]+/g,
  },
};

export default rmProfile;
