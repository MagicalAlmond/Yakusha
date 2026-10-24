/**
 * Line wrapping for translated text.
 *
 * RPG Maker never wraps a message line horizontally: Window_Base.flushTextState
 * draws the whole line with one drawText call and anything wider than the
 * contents rectangle is simply clipped. Only the vertical direction pages
 * (Window_Message.needsNewPage). A Chinese line is usually shorter than the
 * Japanese source, but not always, so long lines need a break we insert
 * ourselves.
 *
 * Widths are counted in display columns: a full width character (CJK, kana,
 * full width punctuation) is 2 columns, everything else is 1. A stock MZ
 * message window fits roughly 54 columns; the vertical paging takes care of
 * extra lines, so breaking is always safe.
 *
 * Escape codes (\C[6], \{ ...) are zero width and are never split.
 *
 * @module pipeline/wrap
 */

import { tokenize } from "../core/textkey.js";

/** Characters a line is allowed to end on, best break points first. */
const BREAK_AFTER = new Set([
  "\u3002", // 。
  "\uff01", // ！
  "\uff1f", // ？
  "\uff0e", // ．
  "\uff0c", // ，
  "\u3001", // 、
  "\uff1b", // ；
  "\uff1a", // ：
  "\u2026", // …
  "\u2014", // —
  "\u300d", // 」
  "\u300f", // 』
  "\uff09", // ）
  "\u3011", // 】
  "\u300b", // 》
  ".",
  "!",
  "?",
  ";",
  ":",
  ")",
]);

/**
 * Characters that must not begin a line (kinsoku shori).
 *
 * A break point sitting right before one of these is pushed past it instead of
 * being used, so punctuation never starts the following line.
 */
const NO_START = new Set([
  "\u3001", // 、
  "\u3002", // 。
  "\uff0c", // ，
  "\uff0e", // ．
  "\uff01", // ！
  "\uff1f", // ？
  "\uff1b", // ；
  "\uff1a", // ：
  "\u2026", // …
  "\u2014", // —
  "\u300d", // 」
  "\u300f", // 』
  "\uff09", // ）
  "\u3011", // 】
  "\u300b", // 》
  ",",
  ".",
  "!",
  "?",
  ";",
  ":",
  ")",
]);

/** East Asian Wide / Fullwidth ranges. */
function isWide(codePoint) {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2e80 && codePoint <= 0x303e) ||
    (codePoint >= 0x3041 && codePoint <= 0x33ff) ||
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
    (codePoint >= 0xa000 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  );
}

/**
 * Display columns of one character.
 * @param {string} ch
 * @returns {number}
 */
export function charColumns(ch) {
  const cp = String(ch).codePointAt(0);
  if (cp === undefined) return 0;
  return isWide(cp) ? 2 : 1;
}

/**
 * Display columns of a string, escape codes excluded.
 * @param {string} text
 * @returns {number}
 */
export function displayColumns(text) {
  let total = 0;
  for (const atom of atomsOf(String(text))) total += atom.width;
  return total;
}

/**
 * @param {string} line
 * @returns {{ text: string, width: number, code: boolean }[]}
 */
function atomsOf(line) {
  const atoms = [];
  for (const tok of tokenize(line)) {
    if (tok.t === "code") {
      atoms.push({ text: tok.v, width: 0, code: true });
      continue;
    }
    for (const ch of tok.v) atoms.push({ text: ch, width: charColumns(ch), code: false });
  }
  return atoms;
}

function widthOf(atoms, upto) {
  let total = 0;
  for (let i = 0; i < upto; i += 1) total += atoms[i].width;
  return total;
}

function joinTrimmed(atoms) {
  const text = atoms.map((atom) => atom.text).join("");
  return text.replace(/[ \u3000]+$/, "");
}


/**
 * Break one line so it fits in `limit` columns, preferring punctuation.
 *
 * @param {string} line
 * @param {number} limit
 * @returns {string}
 */
function wrapLine(line, limit) {
  const atoms = atomsOf(line);
  // Never touch a line that already fits: trimming or rejoining it would make
  // the stored text differ from the validated model output for no reason.
  if (widthOf(atoms, atoms.length) <= limit) return line;
  const out = [];
  /** @type {{ text: string, width: number, code: boolean }[]} */
  let current = [];
  let width = 0;
  // Index into `current` right after the last natural break point, or -1.
  let breakAfter = -1;

  const carry = (cut) => {
    out.push(joinTrimmed(current.slice(0, cut)));
    current = current.slice(cut);
    // A carried line must not start with a space either.
    while (current.length > 0 && !current[0].code && current[0].text === " ") current.shift();
    width = widthOf(current, current.length);
    breakAfter = -1;
  };

  for (const atom of atoms) {
    if (!atom.code && atom.width > 0 && width + atom.width > limit && current.length > 0) {
      // Only use a punctuation break when it does not waste most of the line.
      const natural = breakAfter > 0 && widthOf(current, breakAfter) >= limit * 0.45;
      carry(natural ? breakAfter : current.length);
    }
    current.push(atom);
    if (atom.code) continue;
    width += atom.width;
    if (BREAK_AFTER.has(atom.text)) breakAfter = current.length;
  }

  if (current.length > 0) out.push(joinTrimmed(current));
  if (out.length > 1 && displayColumns(out[out.length - 1]) < limit * 0.35) {
    const balanced = rebalance(out[out.length - 2], out[out.length - 1], limit);
    if (balanced) {
      out[out.length - 2] = balanced[0];
      out[out.length - 1] = balanced[1];
    }
  }
  // Runs last: rebalancing moves a break and could reintroduce a leading mark.
  kinsoku(out, limit);
  return out.join("\n");
}

/**
 * Push the tail of a line down until the next line no longer starts with
 * punctuation, the Japanese kinsoku rule adjusted for a fixed width window.
 *
 * A hard cut at exactly the limit can leave ```！？``` split across the break. Moving
 * one character down at a time fixes that without ever overflowing the limit.
 *
 * @param {string[]} lines
 * @param {number} limit
 */
function kinsoku(lines, limit) {
  for (let i = 1; i < lines.length; i += 1) {
    let guard = 0;
    while (guard < 4 && lines[i].length > 0 && NO_START.has(lines[i][0])) {
      const prev = [...atomsOf(lines[i - 1])];
      if (prev.length < 2) break;
      const last = prev[prev.length - 1];
      const head = [...atomsOf(lines[i])];
      const nextWidth = widthOf(head, head.length) + last.width;
      if (nextWidth > limit) break;
      lines[i - 1] = joinTrimmed(prev.slice(0, prev.length - 1));
      lines[i] = [last.text, lines[i]].join("");
      guard += 1;
    }
  }
}

/**
 * Even out the last two lines so the text does not end on a one character widow.
 *
 * Both results stay within the limit; when no such split exists the original
 * pair is kept.
 *
 * @param {string} first
 * @param {string} second
 * @param {number} limit
 * @returns {[string,string]|null}
 */
function rebalance(first, second, limit) {
  const atoms = [...atomsOf(first), ...atomsOf(second)];
  if (widthOf(atoms, atoms.length) > limit * 2) return null;
  // Only move the break to a punctuation mark. Splitting mid word would read
  // worse than a short last line, and the caller already produced a valid pair.
  const target = widthOf(atoms, atoms.length) / 2;
  let best = -1;
  let bestPenalty = Infinity;
  for (let cut = 1; cut < atoms.length; cut += 1) {
    const last = atoms[cut - 1];
    if (last.code || !BREAK_AFTER.has(last.text)) continue;
    // Never hand punctuation to the start of the second line.
    if (atoms[cut] && !atoms[cut].code && NO_START.has(atoms[cut].text)) continue;
    const left = widthOf(atoms, cut);
    const right = widthOf(atoms, atoms.length) - left;
    if (left > limit || right > limit) continue;
    if (left < limit * 0.35) continue;
    const penalty = Math.abs(left - target);
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      best = cut;
    }
  }
  if (best < 0) return null;
  return [joinTrimmed(atoms.slice(0, best)), joinTrimmed(atoms.slice(best))];
}

/**
 * Wrap every line of `text` so that none is wider than `maxColumns`.
 *
 * A limit of 0, a negative number or a non number disables wrapping and returns
 * the text untouched, which is what the pipeline does by default.
 *
 * @param {string} text
 * @param {number} maxColumns
 * @returns {string}
 */
export function wrapText(text, maxColumns) {
  const limit = Number(maxColumns);
  if (!Number.isFinite(limit) || limit <= 0) return text;
  return String(text)
    .split("\n")
    .map((line) => wrapLine(line, limit))
    .join("\n");
}
