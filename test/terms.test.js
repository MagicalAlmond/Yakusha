/**
 * Tests for name/term mining.
 *
 * Every case is a shape that actually appeared in one of the games used for
 * testing, because the mining heuristic only makes sense against real corpora:
 * fragments, drifting spellings and names that only ever appear in prose.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { dominantOf, mineTerms, toGlossary } from "../src/pipeline/terms.js";

/**
 * Build a dictionary from a list of [key, text] pairs.
 *
 * @param {Array<[string, string, string[]?]>} rows
 */
function dictionary(rows) {
  const entries = {};
  for (const [key, text, contexts] of rows) entries[key] = { text, contexts: contexts || ["Map001.json:401"] };
  return { format: "yakusha/1", game: "test", updatedAt: new Date(0).toISOString(), entries };
}

/** A name entry: the context string the extractor writes for database names. */
const NAME = ["Actors.json:name"];

/**
 * A holder line. The ASCII tail matters: real lines differ in the words around
 * a name, and without that variation every line shares one long run ("哥布林出场了")
 * which then wins on length and hides the name being mined.
 *
 * @param {string} spelling
 * @param {number} index
 */
function line(spelling, index) {
  return spelling + " line " + index;
}

/**
 * One name mentioned in `total` lines, `use` of which spell it `rendering`
 * and the rest spell it `other`.
 *
 * @param {string} name
 * @param {string} db translation stored in the name entry
 * @param {string} rendering spelling used in dialogue
 * @param {number} use lines that use `rendering`
 * @param {number} total total mentions
 * @param {string} [other] spelling used by the remaining lines
 */
function mentions(name, db, rendering, use, total, other = "something") {
  const rows = [[name, db, NAME]];
  for (let i = 0; i < total; i += 1) {
    rows.push([line(name, i), line(i < use ? rendering : other, i)]);
  }
  return rows;
}

test("terms: an empty dictionary mines nothing", () => {
  const result = mineTerms(dictionary([]));
  assert.equal(result.names, 0);
  assert.deepEqual(result.terms, []);
  assert.deepEqual(result.drift, []);
  assert.deepEqual(result.missing, []);
});

test("terms: dominantOf prefers the longest candidate within 10% of the best", () => {
  // Every substring of "哥布林" has the same document frequency, so picking the
  // most frequent one alone returns "哥布" - a fragment, not a name.
  const lines = ["哥布林来了", "又一只哥布林", "哥布林很弱"];
  assert.equal(dominantOf(lines, { minLength: 2, maxLength: 8 }).text, "哥布林");
});

test("terms: dominantOf drops candidates that start with a particle", () => {
  // "的胸部" is the most frequent run here and is never a name, which is
  // exactly how "丰满的胸部" turns into a bogus dominant rendering.
  const lines = ["丰满的胸部", "巨大的胸部", "柔软的胸部"];
  assert.equal(dominantOf(lines, { minLength: 2, maxLength: 8 }).text, "胸部");
});

test("terms: a name whose dialogue agrees with the entry is ok", () => {
  const result = mineTerms(dictionary(mentions("ゴブリン", "哥布林", "哥布林", 6, 6)));
  assert.equal(result.terms.length, 1);
  assert.equal(result.terms[0].status, "ok");
  assert.equal(result.terms[0].suggested, "哥布林");
  assert.equal(result.drift.length, 0);
});

test("terms: a name the dialogue spells differently is drift", () => {
  // This is the アリア case: the name entry says 艾莉亚, but 96% of the lines
  // that mention her say 阿莉亚. The dictionary is what is wrong.
  const result = mineTerms(dictionary(mentions("アリア", "艾莉亚", "阿莉亚", 9, 10, "艾莉亚")));
  assert.equal(result.terms.length, 1);
  assert.equal(result.terms[0].status, "drift");
  assert.equal(result.terms[0].dominant, "阿莉亚");
  assert.equal(result.terms[0].suggested, "阿莉亚");
  assert.equal(result.terms[0].dbSupport, 0.1);
});

test("terms: a name with no translation in the dictionary is missing", () => {
  // The official-Chinese games hit this: the dialogue is already translated, so
  // the entry can be filled in straight from the corpus.
  const result = mineTerms(dictionary(mentions("加奈", "", "加奈", 6, 6)));
  assert.equal(result.terms[0].status, "missing");
  assert.equal(result.terms[0].suggested, "加奈");
  assert.equal(result.missing.length, 1);
  assert.deepEqual(toGlossary(result.terms).entries, { 加奈: "加奈" });
});

test("terms: a stray rendering needs enough support before it counts as drift", () => {
  // 3 of 10 is a minority spelling, not the standard one; rewording a name
  // entry on that evidence would make a correct name wrong.
  const result = mineTerms(dictionary(mentions("ミスティ", "米丝蒂", "迷雾", 3, 10, "米丝蒂")));
  assert.equal(result.terms[0].status, "ok");
  assert.equal(result.terms[0].suggested, "米丝蒂");
});

test("terms: a shorter and a longer spelling of the same name do not drift", () => {
  // "哥布" and "哥布林" are the same choice of rendering, so the entry is only
  // incomplete, and the longer spelling is what should be written down.
  const result = mineTerms(dictionary(mentions("ゴブリン", "哥布", "哥布林", 6, 6)));
  assert.equal(result.terms[0].status, "ok");
  assert.equal(result.terms[0].suggested, "哥布林");
});

test("terms: names mentioned in fewer lines than minHolders are not mined", () => {
  const result = mineTerms(dictionary(mentions("ゾーイ", "佐伊", "佐伊", 3, 3)), { minHolders: 5 });
  assert.equal(result.names, 1);
  assert.equal(result.terms.length, 0);
});

test("terms: a long name written in kana is prose, not a name", () => {
  // "激しくピストン" is filed under a name field by the game, but mining a
  // dominant rendering for a phrase produces meaningless drift.
  const rows = mentions("激しくピストン", "猛烈抽插", "猛烈抽插", 6, 6);
  const result = mineTerms(dictionary(rows));
  assert.equal(result.skipped.prose, 1);
  assert.equal(result.terms.length, 0);
});

test("terms: a short kana name is still a name", () => {
  const result = mineTerms(dictionary(mentions("リンカ", "琳卡", "琳卡", 6, 6)));
  assert.equal(result.skipped.prose, 0);
  assert.equal(result.terms.length, 1);
});

test("terms: untranslated names are counted but not mined without mentions", () => {
  const result = mineTerms(dictionary([["ミスティ", "", NAME]]));
  assert.equal(result.skipped.untranslated, 1);
  assert.equal(result.terms.length, 0);
});

test("terms: entries with no translation are not part of the corpus", () => {
  // An untranslated line cannot vote on a rendering, otherwise every pending
  // line would push the count towards the source text.
  const rows = mentions("ゴブリン", "哥布林", "哥布林", 6, 6);
  for (let i = 0; i < 10; i += 1) rows.push([line("ゴブリン", 100 + i), ""]);
  const result = mineTerms(dictionary(rows));
  assert.equal(result.terms[0].holders, 6);
});

test("terms: results are sorted by how often the name is mentioned", () => {
  const rows = [...mentions("ゴブリン", "哥布林", "哥布林", 9, 9), ...mentions("オーク", "兽人", "兽人", 5, 5)];
  const result = mineTerms(dictionary(rows));
  assert.deepEqual(result.terms.map((term) => term.name), ["ゴブリン", "オーク"]);
});

test("terms: a one-character rendering cannot be mined", () => {
  // Candidates start at two characters, which is what stops every substring of
  // a long run from being a candidate. A single-character rendering ("多") is
  // therefore invisible, and the term is reported as not mined rather than as
  // drift against an empty dominant spelling.
  const result = mineTerms(dictionary(mentions("多い", "多", "多", 9, 9)));
  assert.equal(result.names, 1);
  assert.equal(result.terms.length, 0);
});

test("terms: nameEntries counts every name field, mined or not", () => {
  // The report says "510 of 611", so the denominator has to count the entries
  // that were skipped as prose rather than the ones that survived mining.
  const rows = [...mentions("ゴブリン", "哥布林", "哥布林", 6, 6), ["激しくピストン", "猛烈抽插", NAME], ["ミ", "米", NAME]];
  const result = mineTerms(dictionary(rows));
  assert.equal(result.nameEntries, 3);
  assert.equal(result.names, 1);
});

test("terms: glossary only carries entries that have a rendering", () => {
  const result = mineTerms(dictionary(mentions("ゴブリン", "哥布林", "哥布林", 6, 6)));
  const glossary = toGlossary(result.terms, { game: "test" });
  assert.equal(glossary.format, "yakusha/glossary/1");
  assert.equal(glossary.game, "test");
  assert.deepEqual(glossary.entries, { ゴブリン: "哥布林" });
});

test("terms: glossary honours the limit and driftOnly", () => {
  const rows = [
    ...mentions("ゴブリン", "哥布林", "哥布林", 9, 9),
    ...mentions("アリア", "艾莉亚", "阿莉亚", 8, 8),
    ...mentions("ミスティ", "迷雾", "米丝蒂", 7, 7),
  ];
  const terms = mineTerms(dictionary(rows)).terms;
  assert.equal(Object.keys(toGlossary(terms, { limit: 2 }).entries).length, 2);
  // A term that already agrees is not worth pinning down; only the two that
  // disagree need to reach the prompt.
  assert.deepEqual(Object.keys(toGlossary(terms, { driftOnly: true }).entries).sort(), ["アリア", "ミスティ"]);
  assert.equal(toGlossary(terms, { driftOnly: true }).entries["アリア"], "阿莉亚");
});

test("terms: the glossary format is what translate --glossary reads", () => {
  // The command's whole point is that the file can be handed back to translate
  // without a conversion step, so the entries map must be the direct payload.
  const result = mineTerms(dictionary(mentions("ゴブリン", "哥布林", "哥布林", 6, 6)));
  const parsed = JSON.parse(JSON.stringify(toGlossary(result.terms, { game: "test" })));
  const entries = parsed.entries || parsed;
  assert.equal(entries["ゴブリン"], "哥布林");
});

test("terms: a malformed dictionary does not throw", () => {
  assert.doesNotThrow(() => mineTerms({ entries: { "ゴブリン": null, "": {} } }));
  assert.doesNotThrow(() => mineTerms(null));
});
