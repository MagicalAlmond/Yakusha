/**
 * Tests for the speaker name repair.
 *
 * Every case comes from a real dictionary: the 用时间停止肆意妄为 MV game writes its
 * speaker into the line as "\N<ひなた>"…"", translates that name on some lines and
 * leaves it in Japanese on others, so the same character is read in two languages.
 * The repair replaces the leftover with the rendering the game already uses
 * hundreds of times elsewhere — it never invents a name.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSpeakerIndex,
  houseOf,
  repairSpeakerNames,
  rewriteSpeakerTags,
  speakerTags,
} from "../src/pipeline/speaker.js";

/** @param {Record<string, {text?: string}>} entries */
function dictionary(entries) {
  return { format: "yakusha/1", game: "test", updatedAt: new Date(0).toISOString(), entries };
}

/** A source line carrying one speaker tag. */
function line(name, body) {
  return "<" + name + ">\u201c" + body + "\u201d";
}

test("speaker: tags are read from the stored text and only when they are names", () => {
  assert.deepEqual(speakerTags(line("ひなた", "おはよう")), ["ひなた"]);
  // Code expressions used by other plugins must not be mistaken for a name.
  assert.deepEqual(speakerTags("<50*\\v[65]>やった"), []);
  assert.deepEqual(speakerTags("<$dataMap.events[6].name;>"), []);
  assert.deepEqual(speakerTags("<\\s[25] ? \" OFF \" : \" ON \" >"), []);
  assert.deepEqual(speakerTags("no tag at all"), []);
  assert.deepEqual(speakerTags(""), []);
  assert.deepEqual(speakerTags(undefined), []);
});

test("speaker: rewriting leaves code expressions and stray brackets alone", () => {
  const text = "<50*\\v[65]><ひなた>おはよう";
  const out = rewriteSpeakerTags(text, () => "日向");
  assert.equal(out, "<50*\\v[65]><日向>おはよう");
});

test("speaker: a rendering that already matches is not rewritten", () => {
  assert.equal(rewriteSpeakerTags("<日向>おはよう", (name) => name), "<日向>おはよう");
  assert.equal(rewriteSpeakerTags("<日向>おはよう", () => undefined), "<日向>おはよう");
});

test("speaker: the house rendering outranks a copied source name", () => {
  // 先生 is both "teacher" and a Japanese surname-like word, so counting raw
  // totals would let the untranslated form win and then report the real
  // translations as drift. A rendering that differs from the source outranks one
  // that merely copies it.
  const index = buildSpeakerIndex(
    dictionary({
      [line("先生", "a")]: { text: line("老师", "a") },
      [line("先生", "b")]: { text: line("先生", "b") },
      [line("先生", "c")]: { text: line("先生", "c") },
    })
  );
  const house = houseOf(index, "先生");
  assert.equal(house.translated, true);
  assert.equal(house.house, "老师");
});

test("speaker: a tie prefers the form without kana", () => {
  const index = buildSpeakerIndex(
    dictionary({
      [line("さやか", "a")]: { text: line("さやか", "a") },
      [line("さやか", "b")]: { text: line("沙耶香", "b") },
    })
  );
  assert.equal(houseOf(index, "さやか").house, "沙耶香");
});

test("speaker: a name this game never translated is left alone", () => {
  const data = dictionary({
    [line("ぬらり", "a")]: { text: line("ぬらり", "a") },
    [line("ぬらり", "b")]: { text: line("ぬらり", "b") },
  });
  const result = repairSpeakerNames(data);
  assert.equal(result.entries, 0);
  assert.equal(result.tags, 0);
});

test("speaker: a kana leftover is replaced with the rendering used elsewhere", () => {
  const data = dictionary({
    [line("ひなた", "a")]: { text: line("日向", "a") },
    [line("ひなた", "b")]: { text: line("日向", "b") },
    [line("ひなた", "c")]: { text: line("ひなた", "c") },
  });
  const result = repairSpeakerNames(data);
  assert.equal(result.tags, 1);
  assert.equal(result.entries, 1);
  assert.deepEqual(result.names, [{ source: "ひなた", from: "ひなた", to: "日向", count: 1 }]);
  assert.equal(data.entries[line("ひなた", "c")].text, line("日向", "c"));
});

test("speaker: an all-Han name copied through is repaired too", () => {
  // 主婦 is written the same way in Japanese; it slips past the kana test but is
  // still Japanese on screen, and the game translates it elsewhere.
  const data = dictionary({
    [line("主婦", "a")]: { text: line("主妇", "a") },
    [line("主婦", "b")]: { text: line("主婦", "b") },
  });
  const result = repairSpeakerNames(data);
  assert.equal(result.tags, 1);
  assert.equal(data.entries[line("主婦", "b")].text, line("主妇", "b"));
});

test("speaker: a name identical in both languages is not repaired", () => {
  const data = dictionary({
    [line("少女", "a")]: { text: line("少女", "a") },
    [line("少女", "b")]: { text: line("少女", "b") },
  });
  const result = repairSpeakerNames(data);
  assert.equal(result.tags, 0);
});

test("speaker: two Chinese renderings need --include-drift", () => {
  const entries = {
    [line("さやか", "a")]: { text: line("沙耶香", "a") },
    [line("さやか", "b")]: { text: line("沙耶香", "b") },
    [line("さやか", "c")]: { text: line("沙耶加", "c") },
  };
  const quiet = dictionary({ ...entries });
  assert.equal(repairSpeakerNames(quiet).tags, 0);
  assert.equal(quiet.entries[line("さやか", "c")].text, line("沙耶加", "c"));

  const loud = dictionary({ ...entries });
  const result = repairSpeakerNames(loud, { includeDrift: true });
  assert.equal(result.tags, 1);
  assert.deepEqual(result.names, [{ source: "さやか", from: "沙耶加", to: "沙耶香", count: 1 }]);
  assert.equal(loud.entries[line("さやか", "c")].text, line("沙耶香", "c"));
});

test("speaker: running the repair twice changes nothing the second time", () => {
  const data = dictionary({
    [line("ひなた", "a")]: { text: line("日向", "a") },
    [line("ひなた", "b")]: { text: line("ひなた", "b") },
  });
  const first = repairSpeakerNames(data);
  assert.equal(first.entries, 1);
  const second = repairSpeakerNames(data);
  assert.equal(second.entries, 0);
  assert.equal(second.tags, 0);
});

test("speaker: a line whose tag count changed cannot be paired and is skipped", () => {
  const data = dictionary({
    [line("ひなた", "a")]: { text: line("日向", "a") },
    "<ひなた><さやか>ふたりとも": { text: "两个人都" },
  });
  const result = repairSpeakerNames(data);
  assert.equal(result.tags, 0);
  assert.equal(data.entries["<ひなた><さやか>ふたりとも"].text, "两个人都");
});

test("speaker: escape codes around a tag survive the repair", () => {
  const source = "\\N<ひなた>\\C[2]\u201cおはよう\u201d";
  const data = dictionary({
    "\\N<ひなた>\u201cおはよう\u201d": { text: "\\N<日向>\u201c早上好\u201d" },
    [source]: { text: "\\N<ひなた>\\C[2]\u201c早上好\u201d" },
  });
  const result = repairSpeakerNames(data);
  assert.equal(result.tags, 1);
  assert.equal(data.entries[source].text, "\\N<日向>\\C[2]\u201c早上好\u201d");
});

test("speaker: an explicit name map fixes a name the game never translated", () => {
  // 水泳部員 appears only in Japanese, so there is no rendering to copy; the
  // mechanical repair has to give up. --names is the way out, one name at a time.
  const data = dictionary({
    [line("水泳部員", "a")]: { text: line("水泳部員", "a") },
    [line("水泳部員", "b")]: { text: line("水泳部員", "b") },
  });
  assert.equal(repairSpeakerNames(data).tags, 0);
  const result = repairSpeakerNames(data, { names: { 水泳部員: "游泳社员" } });
  assert.equal(result.tags, 2);
  assert.deepEqual(result.names, [{ source: "水泳部員", from: "水泳部員", to: "游泳社员", count: 2 }]);
  assert.equal(data.entries[line("水泳部員", "a")].text, line("游泳社员", "a"));
});

test("speaker: a malformed dictionary does not throw", () => {
  assert.deepEqual(repairSpeakerNames({}), { entries: 0, tags: 0, names: [] });
  assert.equal(repairSpeakerNames({ entries: { a: null } }).tags, 0);
  assert.equal(houseOf(buildSpeakerIndex({}), "unknown").translated, false);
});
