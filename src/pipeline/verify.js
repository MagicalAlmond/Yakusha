/**
 * Post-translation audit: read a finished dictionary and report every entry that
 * would look wrong to a player.
 *
 * translate() validates each string before storing it, but a dictionary can go
 * bad anyway:
 *
 *   - it was produced by an older version with fewer checks
 *   - it was edited by hand or merged from another tool
 *   - the model answered with the source echoed back, which the length ratio
 *     happily accepts
 *   - the translation is correct but too wide for the message window
 *   - a %1 placeholder was dropped, so the game prints the wrong subject
 *
 * verify never writes. It is the same measurement the maintainers run by hand on
 * real games, turned into a command, so a release can be checked the same way on
 * every game instead of trusting a single playthrough.
 *
 * @module pipeline/verify
 */

import { controlCodes, visibleText } from "../core/textkey.js";
import { displayColumns } from "./wrap.js";

/**
 * Hiragana and katakana as they appear in running Japanese text.
 *
 * U+30FB (・, middle dot) and U+30FC (ー, prolonged sound mark) are deliberately
 * excluded: both are ordinary punctuation in Chinese, so a perfectly translated
 * "睡眠・沈黙" line would otherwise be reported as untranslated. Counting them
 * was the single largest source of false positives when this check was first
 * written as a throwaway script.
 */
const KANA = /[\u3041-\u3096\u30a1-\u30fa]/;

/** Han characters, present in both the source and a Chinese translation. */
const HAN = /[\u4e00-\u9fff]/;

/**
 * @typedef {object} Problem
 * @property {"kana"|"echo"|"codes"|"slots"|"lines"|"width"|"no-text"|"rejected"} kind
 * @property {"error"|"warn"} severity
 * @property {string} key source text as stored in the dictionary
 * @property {string} [target] stored translation
 * @property {string} detail human readable explanation
 */

/**
 * @typedef {object} VerifyResult
 * @property {number} total entries in the dictionary
 * @property {number} translated entries with a non-empty target
 * @property {number} pending entries without a target
 * @property {number} rejected entries carrying an error field
 * @property {Problem[]} problems one record per finding
 * @property {Record<string, number>} counts findings per kind
 * @property {number} errors findings with error severity
 * @property {number} warnings findings with warn severity
 */

/**
 * Audit every translated entry of a dictionary.
 *
 * @param {import("../core/dict.js").Dictionary} dictionary
 * @param {{ maxColumns?: number, kinds?: string[] }} [options]
 *   maxColumns  report lines wider than this many display columns (0 = skip)
 *   kinds       restrict the report to these problem kinds
 * @returns {VerifyResult}
 */
export function verifyDictionary(dictionary, options = {}) {
  const maxColumns = options.maxColumns || 0;
  const only = Array.isArray(options.kinds) && options.kinds.length > 0 ? new Set(options.kinds) : null;

  /** @type {Problem[]} */
  const problems = [];
  const counts = {};
  let translated = 0;
  let pending = 0;
  let rejected = 0;

  const report = (kind, severity, key, target, detail) => {
    if (only && !only.has(kind)) return;
    counts[kind] = (counts[kind] || 0) + 1;
    problems.push({ kind, severity, key, target, detail });
  };

  const entries = (dictionary && dictionary.entries) || {};
  const keys = Object.keys(entries);

  for (const key of keys) {
    const entry = entries[key];
    if (!entry || typeof entry !== "object") continue;
    const target = typeof entry.text === "string" ? entry.text : "";
    if (entry.error) {
      rejected += 1;
      // Not an error: a rejected entry is shown as the original line at runtime,
      // which is exactly what a player sees today. It is reported so a release
      // can be checked for strings the pipeline gave up on, but it must not turn
      // the whole dictionary red — every run has a few strings that are legitimately
      // untranslatable (a lone full width space, a line of pure punctuation).
      report("rejected", "warn", key, target, String(entry.error));
    }
    if (target.trim().length === 0) {
      pending += 1;
      // An empty target is a pending entry, not a defect: the runtime plugin
      // simply shows the original line. Only entries the pipeline gave up on
      // are reported, under "rejected".
      continue;
    }
    translated += 1;

    const seen = visibleText(target);
    if (KANA.test(seen)) {
      report("kana", "warn", key, target, "Japanese kana left in the translation");
    }
    if (target === key && KANA.test(visibleText(key))) {
      report("echo", "error", key, target, "target is identical to a Japanese source");
    }

    const a = controlCodes(key);
    const b = controlCodes(target);
    if (a.length !== b.length || a.some((code, i) => code !== b[i])) {
      report(
        "codes",
        "error",
        key,
        target,
        "escape codes differ: " + JSON.stringify(a) + " vs " + JSON.stringify(b)
      );
    }

    // MZ wraps long lines on its own, so an extra break only changes where the
    // author's own pause used to be — visible, but not corruption. It is still
    // worth reporting, because --max-length deliberately rewrites breaks and a
    // re-run of the pipeline would reject a stored entry that no longer matches
    // its source.
    const sourceLines = (key.match(/\n/g) || []).length;
    const targetLines = (target.match(/\n/g) || []).length;
    if (sourceLines !== targetLines) {
      report("lines", "warn", key, target, "line breaks differ: " + sourceLines + " vs " + targetLines);
    }

    if (maxColumns > 0) {
      for (const line of target.split("\n")) {
        const width = displayColumns(line);
        if (width > maxColumns) {
          report("width", "warn", key, target, "line is " + width + " columns, limit is " + maxColumns);
          break;
        }
      }
    }

    // Words that vanished: the source had Han characters and the translation has
    // none. Requiring Han in the source matters, otherwise every line of Japanese
    // onomatopoeia ("ッ…♡♡♡", "――――ッ⁉") is flagged even though a Chinese
    // "……♡♡♡" is the correct translation, and labels that must stay verbatim
    // ("MAP001", "ＨＰ") are flagged too.
    const seenSource = visibleText(key);
    if (HAN.test(seenSource) && !HAN.test(seen) && !KANA.test(seen)) {
      report("no-text", "warn", key, target, "no Han characters in the translation");
    }

    // MZ substitutes %1 %2 with actor or item names when the line is drawn, so a
    // translation that drops or renumbers them prints the wrong subject.
    const sourceSlots = key.match(/%[0-9]+/g) || [];
    const targetSlots = target.match(/%[0-9]+/g) || [];
    if (sourceSlots.join(",") !== targetSlots.join(",")) {
      report(
        "slots",
        "error",
        key,
        target,
        "placeholders differ: " + JSON.stringify(sourceSlots) + " vs " + JSON.stringify(targetSlots)
      );
    }
  }

  let errors = 0;
  let warnings = 0;
  for (const problem of problems) {
    if (problem.severity === "error") errors += 1;
    else warnings += 1;
  }

  return {
    total: keys.length,
    translated,
    pending,
    rejected,
    problems,
    counts,
    errors,
    warnings,
  };
}
