/**
 * The RGSS profile: escape-code grammar, prompt wording and the judgements the
 * pipeline applies to RPG Maker XP, VX and VX Ace text.
 *
 * RGSS text carries the same family of escape codes as MZ ("\C[6]" colours the
 * rest of the line, "\V[12]" substitutes a variable, "\{" pauses), so the
 * grammar is the one core/textkey.js already implements: a backslash followed by
 * a letter run and an optional "[digits]" is one opaque token, and a backslash
 * followed by a single punctuation character is another. Nothing else needs to
 * be understood, because the engine substitutes the codes itself and a
 * translation that keeps them byte-identical renders like the original.
 *
 * Measured over the strings extracted from a real RGSS3 game, the codes in use
 * are \i[n] \c[n] \v[n] \A[n] \W[n] \n[n] \V[n] \T[n] \t[n] \C[n] \a[n] \N[n]
 * \s[n] \w[n] \S[n] \I[n] \F[n] \! \> \{ \} \. \^ - every one of them fits the
 * rule above, which is why this profile reuses the shared tokenizer instead of
 * writing its own.
 *
 * @module engines/rgss/profile
 */

import { controlCodes, plainText, tokenize, visibleText } from "../../core/textkey.js";
import { TRADITIONAL, VERIFY_KANA, isUntranslated } from "../profile.js";

/**
 * @typedef {object} EngineProfile
 * @property {string} id
 * @property {{ task(lang: string): string, escapeExamples: string }} prompt
 * @property {{ tokenize: Function, controlCodes: Function, plainText: Function, visibleText: Function }} grammar
 * @property {{ isUntranslated(text: string): boolean, slots: RegExp }} validate
 * @property {{ kana: RegExp, han: RegExp, traditional: Set<string>, slots: RegExp }} verify
 */

/**
 * The escape codes a translator must copy unchanged, for the prompt.
 *
 * Listed in the order the RGSS manual introduces them. Only the bracket forms a
 * player actually meets in dialogue appear here: a prompt full of rare codes
 * costs tokens and teaches nothing.
 */
const ESCAPE_EXAMPLES = [
  "\\C[6]",
  "\\N[1]",
  "\\V[12]",
  "\\I[64]",
  "\\G",
  "\\{",
  "\\}",
  "\\>",
  "\\<",
  "\\^",
  "\\!",
  "\\|",
  "\\.",
].join(", ");

/**
 * The RGSS profile.
 *
 * XP, VX and VX Ace share one escape-code grammar and one rendering model, so a
 * single profile covers all three. The language judgements are the ones the
 * pipeline already applies to RPG Maker text: a line still holding kana is
 * untranslated, and the audit reports kana, Han characters, traditional-only
 * characters and "%1"-style slots per entry.
 *
 * @type {EngineProfile}
 */
export const rgssProfile = {
  id: "rgss",

  prompt: {
    task(lang) {
      return (
        "You translate RPG Maker XP, VX and VX Ace game text from Japanese into " +
        lang +
        ". These games render text with RGSS escape codes."
      );
    },
    escapeExamples: ESCAPE_EXAMPLES,
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

export default rgssProfile;
