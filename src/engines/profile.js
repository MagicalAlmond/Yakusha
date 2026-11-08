/**
 * Engine and language-pair rules the pipeline reads instead of hard-coding.
 *
 * An engine profile is now a composition: this module names the grammar and the
 * prompt for RPG Maker, while `languages/ja` supplies the judgements that
 * depend on the source and target languages. A future engine plugs in by
 * handing over a different profile object; a future language pair changes the
 * language module, not the pipeline.
 *
 * @module engines/profile
 */

import { controlCodes, plainText, tokenize, visibleText } from "../core/textkey.js";
import { TRADITIONAL, VERIFY_KANA, isUntranslated, japaneseToChinese } from "../languages/ja.js";

export { TRADITIONAL, VERIFY_KANA, isUntranslated };

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

  ...japaneseToChinese({ tokenize, controlCodes, plainText, visibleText }, /%[0-9]+/g),
};

export default rmProfile;
