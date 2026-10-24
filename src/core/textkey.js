/**
 * MZ text utilities: escape-code aware tokenising, normalisation and packing.
 *
 * RPG Maker MZ stores message text in *source form*: a backslash introduces an
 * escape code (\C[6], \V[12], \N[1], \G, \{ ...). At render time
 * Window_Base.prototype.convertEscapeCharacters (rmmz_windows.js:290) rewrites
 * every backslash into U+001B and then processControlCharacter /
 * obtainEscapeCode / obtainEscapeParam consume it.
 *
 * Because the substitution is purely textual we can treat escape codes as
 * opaque tokens: keep them byte-identical in the translation and the result
 * renders exactly like the original.
 *
 * @module core/textkey
 */

/** Single-character escape codes accepted by obtainEscapeCode(). */
const SINGLE_CODES = new Set(["$", ".", "|", "^", "!", ">", "<", "{", "}", "\\"]);

/**
 * Split a source-form string into text chunks and escape-code tokens.
 *
 * @param {string} text source-form text
 * @returns {Array<{t: "text"|"code", v: string}>}
 */
export function tokenize(text) {
  const out = [];
  let buf = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch !== "\\") {
      buf += ch;
      i += 1;
      continue;
    }
    const next = text[i + 1];
    if (next === undefined) {
      buf += ch;
      i += 1;
      continue;
    }
    let token = null;
    if (next === "\\") {
      token = "\\\\";
    } else if (SINGLE_CODES.has(next)) {
      token = "\\" + next;
    } else if (/[A-Za-z]/.test(next)) {
      let j = i + 1;
      while (j < text.length && /[A-Za-z]/.test(text[j])) j += 1;
      if (text[j] === "[") {
        let k = j + 1;
        while (k < text.length && /[0-9]/.test(text[k])) k += 1;
        if (text[k] === "]" && k > j + 1) {
          token = text.slice(i, k + 1);
        }
      }
      if (token === null) token = text.slice(i, j);
    }
    if (token === null) {
      buf += next;
      i += 2;
      continue;
    }
    if (buf) {
      out.push({ t: "text", v: buf });
      buf = "";
    }
    out.push({ t: "code", v: token });
    i += token.length;
  }
  if (buf) out.push({ t: "text", v: buf });
  return out;
}

/**
 * All escape-code tokens of a string, in order.
 * @param {string} text
 * @returns {string[]}
 */
export function controlCodes(text) {
  if (typeof text !== "string" || !text.includes("\\")) return [];
  return tokenize(text)
    .filter((tok) => tok.t === "code")
    .map((tok) => tok.v);
}

/**
 * @param {string} text
 * @returns {boolean}
 */
export function hasControlCodes(text) {
  return controlCodes(text).length > 0;
}

/**
 * Replace escape codes with printable placeholders so a machine translator
 * cannot mangle them. Placeholder shape is unlikely in natural text.
 *
 * @param {string} text
 * @returns {{ masked: string, tokens: string[] }}
 */
export function mask(text) {
  const tokens = [];
  let masked = "";
  for (const tok of tokenize(text)) {
    if (tok.t === "code") {
      masked += "\u27e6" + tokens.length + "\u27e7";
      tokens.push(tok.v);
    } else {
      masked += tok.v;
    }
  }
  return { masked, tokens };
}

/**
 * Inverse of {@link mask}. Tolerates translators that reorder or drop
 * placeholders by falling back to the original string.
 *
 * @param {string} masked
 * @param {string[]} tokens
 * @returns {string}
 */
export function unmask(masked, tokens) {
  return masked.replace(/\u27e6(\d+)\u27e7/g, (whole, idx) => {
    const token = tokens[Number(idx)];
    return token === undefined ? whole : token;
  });
}

/**
 * Human/grep friendly form used as dictionary key: escape codes preserved,
 * width-normalised, whitespace collapsed.
 *
 * @param {string} text
 * @returns {string}
 */
export function normalize(text) {
  if (typeof text !== "string") return "";
  let out = "";
  for (const tok of tokenize(text)) {
    out += tok.t === "code" ? tok.v : tok.v.normalize("NFKC");
  }
  return out.replace(/[ \t\u3000]+/g, " ").replace(/\s+/g, (m) => (/\n/.test(m) ? "\n" : " ")).trim();
}

/**
 * Text with every escape code removed: what a human would read.
 * @param {string} text
 * @returns {string}
 */
export function stripCodes(text) {
  if (typeof text !== "string") return "";
  return tokenize(text)
    .filter((tok) => tok.t === "text")
    .map((tok) => tok.v)
    .join("");
}

/**
 * True when both strings carry the identical sequence of escape codes.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function sameControlCodes(a, b) {
  const x = controlCodes(a);
  const y = controlCodes(b);
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i += 1) if (x[i] !== y[i]) return false;
  return true;
}

/**
 * Split a source-form string on real newlines.
 * @param {string} text
 * @returns {string[]}
 */
export function splitLines(text) {
  return String(text).split("\n");
}

/**
 * Count of visible characters, escape codes excluded.
 * @param {string} text
 * @returns {number}
 */
export function visibleLength(text) {
  return stripCodes(text).length;
}

/**
 * The characters a player actually reads: escape codes and inline markup removed.
 *
 * Several MV games write the speaker inside the line ("\N<ひなた>“好开心♡”").
 * That tag is not an RPG Maker escape code, so tokenize() hands it back as text;
 * dropping the angle-bracketed part here keeps a speaker name from being mistaken
 * for story text by the language checks in pipeline/verify.js.
 *
 * @param {string} text
 * @returns {string}
 */
export function visibleText(text) {
  if (typeof text !== "string") return "";
  return tokenize(text)
    .filter((tok) => tok.t === "text")
    .map((tok) => tok.v)
    .join("")
    .replace(/<[^>]*>/g, "");
}
