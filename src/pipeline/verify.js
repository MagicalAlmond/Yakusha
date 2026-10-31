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

import { controlCodes, plainText, tokenize, visibleText } from "../core/textkey.js";
import { TRADITIONAL_JOINED } from "../data/traditional.js";
import { buildSpeakerIndex, houseOf, speakerTags } from "./speaker.js";
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
 * Traditional-only characters, built once from the flat pair table.
 *
 * A Chinese translation that switches into traditional forms is not a hard
 * failure — the text is still readable — but it is a visible regression, so the
 * check reports it as a warning. See data/traditional.js for why characters with
 * several accepted simplifications are left out.
 */
const TRADITIONAL = (() => {
  const set = new Set();
  for (let i = 0; i + 1 < TRADITIONAL_JOINED.length; i += 2) set.add(TRADITIONAL_JOINED[i]);
  return set;
})();

/**
 * Every problem kind verify can report, in the order they are defined below.
 *
 * The CLI uses this list to reject a misspelt `--kind` instead of silently
 * filtering it to an empty report. Keep this array as the single source of
 * truth for both validation and the help text.
 *
 * @type {readonly string[]}
 */
export const VERIFY_KINDS = Object.freeze([
  "kana",
  "echo",
  "codes",
  "slots",
  "lines",
  "width",
  "no-text",
  "trad",
  "speaker",
  "rejected",
]);

/**
 * @typedef {object} Problem
 * @property {"kana"|"echo"|"codes"|"slots"|"lines"|"width"|"no-text"|"trad"|"speaker"|"rejected"} kind
 * @property {"error"|"warn"} severity
 * @property {string} key source text as stored in the dictionary
 * @property {string} [target] stored translation
 * @property {string} detail human readable explanation
 * @property {string} [name] speaker tag the finding is about (kind "speaker")
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
 * Traditional characters in the translation that the source never used.
 *
 * Japanese writes 愛, 動, 書 and 員 the same way traditional Chinese does, so a
 * character shared with the source proves nothing. Only a character the model
 * introduced — 說, 還, 們, 這 where the source had kana — is evidence that the
 * translation slipped into traditional Chinese.
 *
 * @param {string} target stored translation, escape codes removed
 * @param {string} source source line, escape codes removed
 * @returns {string[]} the offending characters, de-duplicated, in reading order
 */
function traditionalOnly(target, source, traditionalSet) {
  const seenInSource = new Set(source);
  /** @type {string[]} */
  const found = [];
  for (const char of target) {
    if (!traditionalSet.has(char)) continue;
    if (seenInSource.has(char)) continue;
    if (found.includes(char)) continue;
    found.push(char);
  }
  return found;
}

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
  // The language-pair tests below (kana left behind, Han coverage, traditional
  // variants) belong to the engine profile, not to this loop: an engine whose
  // source language has no kana injects its own criteria and the RPG Maker
  // defaults stay exactly as they were for every existing caller.
  const checks = (options.profile && options.profile.verify) || null;
  const kanaRe = checks && checks.kana instanceof RegExp ? checks.kana : KANA;
  const hanRe = checks && checks.han instanceof RegExp ? checks.han : HAN;
  const tradSet = checks && checks.traditional instanceof Set ? checks.traditional : TRADITIONAL;
  const grammar = (options.profile && options.profile.grammar) || null;
  const codesOf = grammar && grammar.controlCodes ? grammar.controlCodes : controlCodes;
  const plainOf = grammar && grammar.plainText ? grammar.plainText : plainText;
  const visibleOf = grammar && grammar.visibleText ? grammar.visibleText : visibleText;
  const tokenizeOf = grammar && grammar.tokenize ? grammar.tokenize : tokenize;
  const slotsRe = checks && checks.slots instanceof RegExp ? checks.slots : /%[0-9]+/g;

  /** @type {Problem[]} */
  const problems = [];
  const counts = {};
  let translated = 0;
  let pending = 0;
  let rejected = 0;

  const report = (kind, severity, key, target, detail, extra) => {
    if (only && !only.has(kind)) return;
    counts[kind] = (counts[kind] || 0) + 1;
    const problem = { kind, severity, key, target, detail };
    if (extra && extra.name) problem.name = extra.name;
    problems.push(problem);
  };

  const entries = (dictionary && dictionary.entries) || {};
  const keys = Object.keys(entries);

  // Speaker names are only meaningful in aggregate: whether "ひなた" should have
  // been translated depends on how the rest of this game renders it. The index is
  // shared with the repair path so the audit and the fix can never disagree about
  // what the house rendering is.
  const speakerIndex = buildSpeakerIndex(dictionary);
  const speakerHouse = (source) => houseOf(speakerIndex, source);

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

    const seen = visibleOf(target);
    if (kanaRe.test(seen)) {
      report("kana", "warn", key, target, "Japanese kana left in the translation");
    }
    if (target === key && kanaRe.test(visibleOf(key))) {
      report("echo", "error", key, target, "target is identical to a Japanese source");
    }

    const a = codesOf(key);
    const b = codesOf(target);
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
        const width = displayColumns(line, tokenizeOf);
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
    const seenSource = visibleOf(key);
    if (hanRe.test(seenSource) && !hanRe.test(seen) && !kanaRe.test(seen)) {
      report("no-text", "warn", key, target, "no Han characters in the translation");
    }

    // A translation that drifts into traditional Chinese is still readable, so
    // this stays a warning; only characters the source never used are evidence.
    // Speaker markup is kept here on purpose: the name is printed to the player.
    const novel = traditionalOnly(plainOf(target), plainOf(key), tradSet);
    if (novel.length > 0) {
      report("trad", "warn", key, target, "traditional characters: " + novel.join(""));
    }

    // Speaker names written inside the line. If this game translates a name
    // somewhere, leaving it in Japanese elsewhere shows the player raw kana, so
    // that is an error; two different Chinese renderings of one name is a
    // consistency issue and stays a warning.
    const sourceTags = speakerTags(key);
    const targetTags = speakerTags(target);
    if (sourceTags.length > 0 && sourceTags.length === targetTags.length) {
      for (let i = 0; i < sourceTags.length; i += 1) {
        const source = sourceTags[i];
        const rendering = targetTags[i];
        const house = speakerHouse(source);
        if (kanaRe.test(rendering)) {
          if (house.translated) {
            report("speaker", "error", key, target, "speaker name left in Japanese: " + source, { name: source });
          }
          continue;
        }
        // A name written entirely in Han slips past the kana test, but if it is
        // the source name unchanged and contains a character simplified Chinese
        // would have replaced (水泳部員, 主婦, 運転手), it is still Japanese on
        // screen. Names that are genuinely the same in both languages (少女,
        // 入浴女性) contain no such character and stay silent.
        if (rendering === source && [...rendering].some((char) => tradSet.has(char))) {
          report("speaker", "error", key, target, "speaker name left untranslated: " + source, { name: source });
          continue;
        }
        if (house.house && rendering !== house.house) {
          report(
            "speaker",
            "warn",
            key,
            target,
            "speaker name rendered as " + JSON.stringify(rendering) + ", elsewhere " + JSON.stringify(house.house),
            { name: source }
          );
        }
      }
    }

    // MZ substitutes %1 %2 with actor or item names when the line is drawn, so a
    // translation that drops or renumbers them prints the wrong subject.
    const sourceSlots = key.match(slotsRe) || [];
    const targetSlots = target.match(slotsRe) || [];
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
