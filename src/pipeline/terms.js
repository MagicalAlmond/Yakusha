/**
 * Glossary mining: work out what the game actually calls things, by reading the
 * finished dictionary back.
 *
 * A dictionary translates each database name exactly once - Actors.json:name,
 * Items.json:name, Enemies.json:name and so on - but a name is mentioned far
 * more often inside ordinary dialogue. Those mentions are translated
 * independently, in different batches, by a model that never sees the name
 * entry. So the two surfaces drift apart:
 *
 *   フェイリン  as a name  -> 费琳   (what the name entry says)
 *   フェイリン  in dialogue -> 菲琳   (3,490 lines, 96% of all mentions)
 *
 * Nobody notices by reading the name entry, and the player sees one character
 * spelled two ways. verify() cannot catch this: both spellings are valid
 * Chinese, the escape codes match, the line breaks match.
 *
 * This module inverts the direction. Instead of trusting the name entry to
 * police the dialogue, it reads the dialogue to find the dominant rendering of
 * every name, then compares. The mined table is also directly usable as a
 * glossary for the next run, which is the part that stops the drift from
 * happening again.
 *
 * @module pipeline/terms
 */

import { visibleText } from "../core/textkey.js";

/**
 * Contexts that mark a dictionary key as a database name rather than a line of
 * dialogue. Weapons, armours and states are included because their names are
 * printed in menus next to item names and must agree with them.
 */
const NAME_CONTEXT = /^(Actors|Enemies|Classes|Items|Weapons|Armors|Skills|States)\.json:name$/;

/**
 * A run of characters that can carry a name: Han, katakana, hiragana, and the
 * prolonged sound mark. Latin text, digits and punctuation end a run, which is
 * what keeps "MAP001" and "ＨＰ" out of the candidate pool.
 */
const CJK_RUN = /[\u4e00-\u9fff\u30a1-\u30fa\u3041-\u3096\u30fc]+/g;

/** Used to decide whether a source name is prose rather than a name. */
const HIRAGANA = /[\u3041-\u3096]/;

/**
 * Characters that a Chinese noun practically never starts with: particles,
 * pronouns and adverbials. Mining substrings of running text happily produces
 * fragments like "的胸部" out of "丰满的胸部"; they are frequent inside a fixed
 * set of holder lines but are never a translation of a name.
 *
 * "向" is deliberately absent: it is a particle in some sentences but the first
 * character of ordinary names ("向阳处", "向日葵"), and dropping a real name to
 * avoid a cut is the worse mistake.
 */
const STOP_PREFIX = new Set([
  "的", "了", "着", "过", "是", "在", "和", "与", "及", "之", "把", "被", "给",
  "对", "从", "为", "以", "就", "都", "也", "还", "又", "很", "太", "不",
  "没", "要", "会", "能", "可", "但", "而", "却", "则", "并", "且", "或", "如",
  "让", "使", "将", "得", "地", "所", "其", "此", "那", "这", "我", "你",
  "他", "她", "它", "们", "谁", "哪", "什", "怎",
]);

/**
 * @typedef {object} Term
 * @property {string} name source name, as stored in the dictionary
 * @property {string} db translation of the name entry itself ("" when untranslated)
 * @property {string|null} dominant most common rendering found in dialogue
 * @property {string} suggested rendering to standardise on
 * @property {"ok"|"drift"|"missing"} status
 * @property {number} support share of mentions that use the dominant rendering
 * @property {number} dbSupport share of mentions that use the name entry translation
 * @property {number} holders number of translated lines mentioning the name
 * @property {string[]} contexts contexts of the name entry
 */

/**
 * @typedef {object} MineResult
 * @property {number} names name entries considered
 * @property {number} skipped names left out before mining, by reason
 * @property {Term[]} terms mined terms, most mentioned first
 * @property {Term[]} drift terms whose dialogue disagrees with the name entry
 * @property {Term[]} missing terms whose name entry has no translation but whose
 *   dialogue has a clear one
 * @property {number} holdersMin threshold that was applied
 * @property {number} supportMin threshold that was applied
 */

/**
 * Every candidate substring of length 2..8 in a piece of text, deduplicated.
 *
 * @param {string} text
 * @param {number} minLength
 * @param {number} maxLength
 * @returns {Set<string>}
 */
function candidates(text, minLength, maxLength) {
  const out = new Set();
  const runs = text.match(CJK_RUN) || [];
  for (const run of runs) {
    const limit = Math.min(maxLength, run.length);
    for (let length = minLength; length <= limit; length += 1) {
      for (let i = 0; i + length <= run.length; i += 1) out.add(run.slice(i, i + length));
    }
  }
  return out;
}

/**
 * The rendering a set of lines agrees on.
 *
 * Two rules, both written after watching them fail on real games:
 *
 *   1. Take the longest candidate within 10% of the best document frequency.
 *      Raw frequency alone always picks the shortest fragment, because every
 *      substring of a frequent string is at least as frequent: "哥布林" appears
 *      in 100% of the goblin lines and so does "哥布" and "布林".
 *   2. Drop candidates that begin with a Chinese particle. Those are cuts
 *      across word boundaries, never a name.
 *
 * @param {string[]} lines
 * @param {{ minLength: number, maxLength: number }} limits
 * @returns {{ text: string, count: number, total: number } | null}
 */
export function dominantOf(lines, limits) {
  const df = new Map();
  for (const line of lines) {
    for (const candidate of candidates(line, limits.minLength, limits.maxLength)) {
      if (STOP_PREFIX.has(candidate[0])) continue;
      df.set(candidate, (df.get(candidate) || 0) + 1);
    }
  }
  if (df.size === 0) return null;

  let best = 0;
  for (const count of df.values()) if (count > best) best = count;
  const floor = best * 0.9;

  let pick = null;
  for (const [text, count] of df) {
    if (count < floor) continue;
    if (!pick || text.length > pick.text.length || (text.length === pick.text.length && count > pick.count)) {
      pick = { text, count };
    }
  }
  if (!pick) return null;
  return { text: pick.text, count: pick.count, total: lines.length };
}

/**
 * @param {import("../core/dict.js").Dictionary} dictionary
 * @param {object} [options]
 * @param {number} [options.minHolders] mentions needed before a name is mined (default 5)
 * @param {number} [options.minSupport] share of mentions the dominant rendering needs (default 0.5)
 * @param {number} [options.margin] how far a drift must beat the name entry (default 0.2)
 * @param {number} [options.minLength] shortest candidate rendering (default 2)
 * @param {number} [options.maxLength] longest candidate rendering (default 8)
 * @param {number} [options.maxHiraganaName] skip longer names written in kana (default 4)
 * @returns {MineResult}
 */
export function mineTerms(dictionary, options = {}) {
  const minHolders = options.minHolders === undefined ? 5 : options.minHolders;
  const minSupport = options.minSupport === undefined ? 0.5 : options.minSupport;
  const margin = options.margin === undefined ? 0.2 : options.margin;
  const limits = {
    minLength: options.minLength === undefined ? 2 : options.minLength,
    maxLength: options.maxLength === undefined ? 8 : options.maxLength,
  };
  const maxHiraganaName = options.maxHiraganaName === undefined ? 4 : options.maxHiraganaName;

  const entries = (dictionary && dictionary.entries) || {};
  const keys = Object.keys(entries);

  /** Translated lines, the corpus the mining runs over. */
  const corpus = [];
  /** Name entries, the things being checked. */
  const names = [];
  const skipped = { untranslated: 0, short: 0, prose: 0 };

  for (const key of keys) {
    const entry = entries[key];
    if (!entry || typeof entry !== "object") continue;
    const text = typeof entry.text === "string" ? entry.text : "";
    const contexts = Array.isArray(entry.contexts) ? entry.contexts : [];
    const isName = contexts.some((context) => NAME_CONTEXT.test(context));
    if (isName) {
      // A name written in kana and longer than a personal name is prose that got
      // filed under a name field ("激しくピストン", "おっぱいオナホ"). Mining those
      // produces a "dominant rendering" for a phrase, which is meaningless.
      if (HIRAGANA.test(key) && key.length > maxHiraganaName) skipped.prose += 1;
      else if (key.length < 2) skipped.short += 1;
      else names.push({ name: key, db: text, contexts });
    }
    if (text.length === 0) continue;
    corpus.push({ key, text: visibleText(text) });
  }

  /** @type {Term[]} */
  const terms = [];
  for (const item of names) {
    if (item.db.length === 0) skipped.untranslated += 1;
    const holders = [];
    for (const line of corpus) {
      if (line.key === item.name) continue;
      if (line.key.includes(item.name)) holders.push(line.text);
    }
    if (holders.length < minHolders) continue;

    const dominant = dominantOf(holders, limits);
    if (!dominant) continue;

    const support = dominant.count / holders.length;
    const dbCount = item.db.length > 0 ? holders.filter((line) => line.includes(item.db)).length : 0;
    const dbSupport = dbCount / holders.length;

    // Compatible means one rendering is part of the other, so the two surfaces
    // are not in conflict - "哥布" and "哥布林" describe the same choice, and the
    // longer one is simply the one that should be written down.
    const compatible = item.db.length > 0 && (dominant.text.includes(item.db) || item.db.includes(dominant.text));
    const longer = dominant.text.length >= item.db.length ? dominant.text : item.db;

    let status = "ok";
    if (item.db.length === 0) status = "missing";
    else if (!compatible && support >= minSupport && support >= dbSupport + margin) status = "drift";

    // A drift and a missing entry both take their answer from the corpus: a
    // drift because the name entry is the minority spelling, a missing one
    // because there is no name entry to begin with. Leaving `missing` out here
    // gave it an empty suggestion, which silently dropped it from every glossary.
    const suggested = status === "drift" || status === "missing" ? dominant.text : compatible ? longer : item.db;

    terms.push({
      name: item.name,
      db: item.db,
      dominant: dominant.text,
      suggested,
      status,
      support: Math.round(support * 1000) / 1000,
      dbSupport: Math.round(dbSupport * 1000) / 1000,
      holders: holders.length,
      contexts: item.contexts,
    });
  }

  terms.sort((a, b) => b.holders - a.holders || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  return {
    names: names.length,
    nameEntries: keys.reduce((count, key) => {
      const entry = entries[key];
      if (!entry || typeof entry !== "object") return count;
      const contexts = Array.isArray(entry.contexts) ? entry.contexts : [];
      return count + (contexts.some((context) => NAME_CONTEXT.test(context)) ? 1 : 0);
    }, 0),
    skipped,
    terms,
    drift: terms.filter((term) => term.status === "drift"),
    missing: terms.filter((term) => term.status === "missing"),
    holdersMin: minHolders,
    supportMin: minSupport,
  };
}

/**
 * A glossary document, ready to be handed to `translate --glossary`.
 *
 * The format is the one `translate` already accepts ({ entries: source -> target }),
 * so writing this file and passing it back needs no conversion step.
 *
 * @param {Term[]} terms
 * @param {{ game?: string|null, limit?: number, driftOnly?: boolean }} [options]
 * @returns {{ format: string, game: string|null, generatedAt: string, entries: Record<string,string> }}
 */
export function toGlossary(terms, options = {}) {
  const limit = options.limit === undefined ? 0 : options.limit;
  const chosen = options.driftOnly ? terms.filter((term) => term.status === "drift" || term.status === "missing") : terms;
  const out = {};
  let count = 0;
  for (const term of chosen) {
    if (term.suggested.length === 0) continue;
    if (limit > 0 && count >= limit) break;
    out[term.name] = term.suggested;
    count += 1;
  }
  return {
    format: "yakusha/glossary/1",
    game: options.game === undefined ? null : options.game,
    generatedAt: new Date().toISOString(),
    entries: out,
  };
}
