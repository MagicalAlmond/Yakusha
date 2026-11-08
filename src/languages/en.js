/**
 * English source detection.
 *
 * 0.10–0.72 only ship Japanese-to-Chinese. This module is the deliberate seam
 * for a future en → zh pair: a profile can ask whether a source line is prose
 * in English instead of guessing from the absence of kana.
 *
 * @module languages/en
 */

/** Latin letters are the minimum signal that a line is English prose. */
const LATIN = /[A-Za-z]/;

/** CJK scripts mean the line is not English source text. */
const CJK = /[\u3040-\u30ff\u3400-\u9fff]/;

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
