/**
 * The Kirikiri (KAG) profile: text-tag grammar, prompt wording and the
 * judgements the pipeline applies to KAG scenario text.
 *
 * KAG text lines carry inline tags in square brackets: [r] breaks the line,
 * [font ...] tweaks rendering, [er] clears it. Tags must survive translation
 * untouched, so a tag is treated as a zero-width code here: the model is told
 * to keep them (prompt), the validator rejects a candidate that drops or
 * reorders them (validate), and the audit reports the same problem later
 * (verify). A doubled opening bracket, [[, displays one literal `[` and is a
 * visible character.
 *
 * @module engines/krkr/profile
 */

import { TRADITIONAL_JOINED } from "../../data/traditional.js";

/** Traditional-only characters, built once from the flat pair table. */
const TRADITIONAL = (() => {
  const set = new Set();
  for (let i = 0; i + 1 < TRADITIONAL_JOINED.length; i += 2) set.add(TRADITIONAL_JOINED[i]);
  return set;
})();

/** Kana that marks an untranslated audit finding. */
const VERIFY_KANA = /[\u3041-\u3096\u30a1-\u30fa]/;

/** Doubling escape: source pair, and the single character it displays. */
const DOUBLED = new Map([["[[", "["]]);

/**
 * Split a line into visible text and zero-width codes.
 *
 * A code is a bracketed KAG tag: [r], [er], [voice=file.ogg]. An unbalanced
 * `[` is returned as ordinary text: a half tag is what the player sees, and
 * treating it as a code would hide a broken line.
 *
 * @param {string} line
 * @returns {Array<{ t: "text"|"code", v: string }>} tokens in source order
 */
export function tokenize(line) {
  if (typeof line !== "string" || line.length === 0) return [];
  /** @type {Array<{ t: string, v: string }>} */
  const out = [];
  let buf = "";
  const flush = () => {
    if (buf.length > 0) {
      out.push({ t: "text", v: buf });
      buf = "";
    }
  };
  let i = 0;
  while (i < line.length) {
    if (line.startsWith("[[", i)) {
      buf += "[";
      i += 2;
      continue;
    }
    if (line[i] === "[") {
      const end = line.indexOf("]", i + 1);
      const lineEnd = line.indexOf("\n", i + 1);
      if (end > i && (lineEnd === -1 || end < lineEnd)) {
        flush();
        out.push({ t: "code", v: line.slice(i, end + 1) });
        i = end + 1;
        continue;
      }
    }
    buf += line[i];
    i += 1;
  }
  flush();
  return out;
}
/**
 * The codes of a line, in source order.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function controlCodes(text) {
  if (typeof text !== "string" || text.indexOf("[") === -1) return [];
  return tokenize(text)
    .filter((token) => token.t === "code")
    .map((token) => token.v);
}

/**
 * The text the player reads, with every tag removed.
 *
 * @param {string} text
 * @returns {string}
 */
export function plainText(text) {
  if (typeof text !== "string") return "";
  return tokenize(text)
    .filter((token) => token.t === "text")
    .map((token) => token.v)
    .join("");
}

/**
 * Decide that a source line was echoed back without being translated.
 *
 * Same rule as the other profiles, applied to the visible text so that a tag
 * full of kana cannot mark a correct translation as an echo.
 *
 * @param {string} text
 * @returns {boolean}
 */
function isUntranslated(text) {
  return /[\u3040-\u30ff]/.test(plainText(text));
}

/**
 * Placeholder pattern for a KAG line.
 *
 * KAG embeds values with [emb] tags rather than inline placeholders, and
 * scenario writers occasionally reference %1-style slots copied from other
 * engines. Reporting bracketed tags here again would duplicate the code
 * comparison, so only the %-form is reported.
 */
const SLOTS = /%[0-9]+/g;

/**
 * The Kirikiri profile.
 *
 * @type {import("../profile.js").EngineProfile}
 */
export const krkrProfile = {
  id: "krkr",

  prompt: {
    task(lang) {
      return "You translate Kirikiri KAG game text from Japanese into " + lang + ".";
    },
    escapeExamples: ["[r]", "[er]", "[emb exp=...]", "[["].join(", "),
  },

  grammar: { tokenize, controlCodes, plainText, visibleText: plainText },

  validate: {
    isUntranslated,
    slots: SLOTS,
  },

  verify: {
    kana: VERIFY_KANA,
    han: /[\u4e00-\u9fff]/,
    traditional: TRADITIONAL,
    slots: SLOTS,
  },
};

export default krkrProfile;
