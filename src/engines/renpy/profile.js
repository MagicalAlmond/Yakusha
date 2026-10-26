/**
 * The Ren'Py engine profile: text-tag grammar, prompt wording and the
 * Japanese-to-Chinese judgements the pipeline needs.
 *
 * Ren'Py text is not RPG Maker text. Where an RPG Maker line carries escape
 * codes such as \C[6], a Ren'Py line carries text tags such as {b} or
 * {color=#fff} and variable interpolations such as [player_name]. Both must
 * survive translation untouched, so both are treated as zero-width codes here:
 * the model is told to keep them (prompt), the validator rejects a candidate
 * that drops or reorders them (validate), and the audit reports the same
 * problem later (verify).
 *
 * Three doubling escapes matter: {{ displays a literal {, [[ a literal [, and
 * %% a literal %. They are visible characters, so tokenize() emits them as a
 * single text character instead of a code.
 *
 * @module engines/renpy/profile
 */

import { TRADITIONAL_JOINED } from "../../data/traditional.js";

/** Traditional-only characters, built once from the flat pair table. */
const TRADITIONAL = (() => {
  const set = new Set();
  for (let i = 0; i + 1 < TRADITIONAL_JOINED.length; i += 2) set.add(TRADITIONAL_JOINED[i]);
  return set;
})();

/**
 * Kana that marks an untranslated audit finding.
 *
 * U+30FB (・) and U+30FC (ー) are excluded for the same reason as in the RPG
 * Maker profile: both are ordinary Chinese punctuation, so a correct
 * translation would otherwise be reported as untranslated.
 */
const VERIFY_KANA = /[\u3041-\u3096\u30a1-\u30fa]/;

/** Doubling escapes: source pair, and the single character it displays. */
const DOUBLED = new Map([
  ["{{", "{"],
  ["[[", "["],
  ["%%", "%"],
]);

/**
 * Split a line into visible text and zero-width codes.
 *
 * A code is one of:
 *   - a text tag, {b} {/b} {color=#fff} {size=+4} {w} {nw} {#no-translate}
 *   - a variable interpolation, [player_name] [var!q] [var:.2f] [obj.attr]
 *
 * An unbalanced { or [ is returned as ordinary text: a half tag is what the
 * player sees, and treating it as a code would hide a broken line.
 *
 * @param {string} line
 * @returns {Array<{ t: "text"|"code", v: string }>}
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
    const pair = line.slice(i, i + 2);
    const replaced = DOUBLED.get(pair);
    if (replaced) {
      buf += replaced;
      i += 2;
      continue;
    }
    const ch = line[i];
    if (ch === "{") {
      const end = line.indexOf("}", i + 1);
      // A tag never spans a newline; a stray { before one is a typo, not a tag.
      const lineEnd = line.indexOf("\n", i + 1);
      if (end > i && (lineEnd === -1 || end < lineEnd)) {
        flush();
        out.push({ t: "code", v: line.slice(i, end + 1) });
        i = end + 1;
        continue;
      }
    }
    if (ch === "[") {
      let depth = 0;
      let j = i;
      for (; j < line.length; j += 1) {
        if (line[j] === "[") depth += 1;
        else if (line[j] === "]") {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      if (j < line.length) {
        flush();
        out.push({ t: "code", v: line.slice(i, j + 1) });
        i = j + 1;
        continue;
      }
    }
    buf += ch;
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
  if (typeof text !== "string" || (text.indexOf("{") === -1 && text.indexOf("[") === -1)) return [];
  return tokenize(text)
    .filter((token) => token.t === "code")
    .map((token) => token.v);
}

/**
 * The text the player reads, with every tag and interpolation removed.
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
 * Same rule as the RPG Maker profile, applied to the visible text so that a
 * variable name full of kana cannot mark a correct translation as an echo.
 *
 * @param {string} text
 * @returns {boolean}
 */
function isUntranslated(text) {
  return /[\u3040-\u30ff]/.test(plainText(text));
}

/**
 * Placeholder pattern for a Ren'Py line.
 *
 * Ren'Py interpolates [name]; the RPG Maker validator looks for %1. Reporting
 * the interpolation here too keeps the two checks consistent even though the
 * code comparison above already covers order.
 */
const SLOTS = /\[[^[\]]*\]/g;

/**
 * The Ren'Py profile.
 *
 * @type {import("../profile.js").EngineProfile}
 */
export const renpyProfile = {
  id: "renpy",

  prompt: {
    task(lang) {
      return "You translate Ren'Py game text from Japanese into " + lang + ".";
    },
    escapeExamples: [
      "{b}",
      "{/b}",
      "{i}",
      "{color=#ff0000}",
      "{size=+4}",
      "{w}",
      "{nw}",
      "{#no-translate}",
      "[player_name]",
      "[var!q]",
      "[var:.2f]",
      "[[",
      "{{",
    ].join(", "),
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

export default renpyProfile;
