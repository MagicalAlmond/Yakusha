/**
 * KAG script reader contract (src/engines/krkr/ks.js).
 *
 * The fixtures are invented lines that exercise the rules the reader commits
 * to: text lines are collected, comment/label/tag lines are not, inline tags
 * are stripped, the most recent [name_set] names the speaker, and a script
 * that is not valid UTF-8 is decoded as Shift_JIS with undecodable counting.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { decodeKs, classifyLine, stripInlineTags, collectKsStrings } from "../src/engines/krkr/ks.js";
import { KS_SCENARIO, KS_SMALL, brokenSjisBuffer } from "./krkr-fixture.js";

test("classifyLine sorts KAG lines into the five kinds", () => {
  assert.equal(classifyLine(""), "blank");
  assert.equal(classifyLine("   "), "blank");
  assert.equal(classifyLine("; comment"), "comment");
  assert.equal(classifyLine("*label"), "label");
  assert.equal(classifyLine("[tags]"), "tags");
  assert.equal(classifyLine("text"), "text");
  // A semicolon inside a line is not a comment start.
  assert.equal(classifyLine("text ; still text"), "text");
});

test("stripInlineTags removes tags and keeps [[ as a literal bracket", () => {
  assert.deepEqual(stripInlineTags("a[r]b"), { text: "ab", tags: ["r"] });
  assert.deepEqual(stripInlineTags("[emb exp=x]mid"), { text: "mid", tags: ["emb"] });
  // An unclosed bracket is text, not a tag: the reader never swallows lines.
  assert.deepEqual(stripInlineTags("broken [tag"), { text: "broken [tag", tags: [] });
});

test("collectKsStrings collects text lines with line numbers and speakers", () => {
  const result = collectKsStrings(KS_SCENARIO, "scenario/s1.ks");
  assert.deepEqual(result.strings.map((item) => item.text), [
    "あおい「今日はよく晴れているね」",
    "れん「改行つきのせりふ」",
  ]);
  assert.deepEqual(result.strings.map((item) => item.line), [2, 8]);
  assert.deepEqual(result.strings.map((item) => item.speaker), ["Aoi", "Ren"]);
  assert.deepEqual(result.names.map((item) => item.name), ["Aoi", "Ren"]);
  // The [r] tag is recorded by its name, not lost.
  assert.deepEqual(result.strings[1].tags, ["r"]);
});

test("collectKsStrings keeps every string the KAG engine would show", () => {
  const result = collectKsStrings(KS_SMALL, "a.ks");
  assert.deepEqual(result.strings.map((item) => item.text), ["hello"]);
});

test("decodeKs reads UTF-8 first and Shift_JIS only on failure", () => {
  const utf8 = decodeKs(Buffer.from(KS_SCENARIO, "utf8"));
  assert.equal(utf8.encoding, "utf-8");
  assert.equal(utf8.undecodable, false);
  const sjis = decodeKs(Buffer.from([0x82, 0x9f]));
  assert.equal(sjis.encoding, "shift_jis");
  assert.equal(sjis.text, "ぁ");
  assert.equal(sjis.undecodable, false);
});

test("decodeKs counts replacement characters as undecodable", () => {
  const result = decodeKs(brokenSjisBuffer());
  assert.equal(result.encoding, "shift_jis");
  assert.equal(result.undecodable, true);
  assert.match(result.error, /1 undecodable byte/);
});
