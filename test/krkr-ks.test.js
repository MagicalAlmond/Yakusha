/**
 * KAG script reader contract (src/engines/krkr/ks.js).
 *
 * The fixtures are invented lines that exercise the rules the reader commits
 * to: text lines are collected, comment/label lines and @ tag lines are not,
 * a bracket-led tag line contributes the visible text its tags leave behind,
 * inline tags are stripped (also out of quoted attribute values), the most
 * recent [name_set] names the speaker, the TJS code between [iscript] and
 * [endscript] is skipped, and a script that is not valid UTF-8 is decoded as
 * Shift_JIS with undecodable counting.
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
  // The @ form is the one-line spelling of a tag, not display text.
  assert.equal(classifyLine("@wait mode=until time=5500"), "tags");
  assert.equal(classifyLine("  @macro name=box"), "tags");
  assert.equal(classifyLine("text"), "text");
  // A semicolon inside a line is not a comment start.
  assert.equal(classifyLine("text ; still text"), "text");
});

test("stripInlineTags removes tags and keeps [[ as a literal bracket", () => {
  assert.deepEqual(stripInlineTags("a[r]b"), { text: "ab", tags: ["r"] });
  assert.deepEqual(stripInlineTags("[emb exp=x]mid"), { text: "mid", tags: ["emb"] });
  // An unclosed bracket is text, not a tag: the reader never swallows lines.
  assert.deepEqual(stripInlineTags("broken [tag"), { text: "broken [tag", tags: [] });
  // A ] inside a quoted attribute value does not close the tag.
  assert.deepEqual(stripInlineTags('a[tag x="f.x[0]"]b'), { text: "ab", tags: ["tag"] });
  assert.deepEqual(stripInlineTags("[tag y='a]b']c"), { text: "c", tags: ["tag"] });
});

test("collectKsStrings collects the visible text on bracket-led tag lines", () => {
  const source = [
    "[「]マクロ引用のせりふ」",
    "@macro name=box",
    "[name_set name='Aoi'][「]名前の後のせりふ」",
    "[背景 file=庭 trans=false]]",
  ].join("\n");
  const result = collectKsStrings(source, "s.ks");
  assert.deepEqual(result.strings.map((item) => item.text), [
    "マクロ引用のせりふ」",
    "名前の後のせりふ」",
    "]",
  ]);
  // The leading tags are recorded by name and the same-line name_set speaks.
  assert.deepEqual(result.strings[0].tags, ["「"]);
  assert.deepEqual(result.strings[1].speaker, "Aoi");
  // A stray ] after a tag is what the engine displays, so it is kept as-is.
  assert.deepEqual(result.strings[2].tags, ["背景"]);
  // @ lines are one whole tag: nothing on them is ever display text.
  const atOnly = collectKsStrings("@wait mode=until time=5500\n", "s.ks");
  assert.deepEqual(atOnly.strings, []);
  // Code on the [iscript] line itself is code, not dialogue.
  const withInlineCode = collectKsStrings("[iscript] var x = 1;\n[endscript]\n後のせりふ\n", "s.ks");
  assert.deepEqual(withInlineCode.strings.map((item) => item.text), ["後のせりふ"]);
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

test("collectKsStrings skips iscript code blocks and @ tag lines", () => {
  const source = [
    "@macro name=box",
    "[iscript]",
    "var mouseDown; // code comment",
    "tf.label = 'hidden';",
    "[endscript]",
    "[name_set name='Aoi']",
    "あおい「コードの後のせりふ」",
    "@iscript",
    "function f() { return 1; }",
    "@endscript",
    "れん「二つ目のブロックの後」",
  ].join("\n");
  const result = collectKsStrings(source, "s.ks");
  assert.deepEqual(result.strings.map((item) => item.text), [
    "あおい「コードの後のせりふ」",
    "れん「二つ目のブロックの後」",
  ]);
  // The speaker survives a script block; @ lines never speak.
  assert.deepEqual(result.strings.map((item) => item.speaker), ["Aoi", "Aoi"]);
  assert.deepEqual(result.names.map((item) => item.name), ["Aoi"]);
});

test("collectKsStrings accepts an @name_set speaker and skips an unterminated iscript", () => {
  const atSpeaker = collectKsStrings("@name_set name='Yuki'\nゆき「せりふ」\n", "s.ks");
  assert.deepEqual(atSpeaker.strings.map((item) => item.speaker), ["Yuki"]);
  assert.deepEqual(atSpeaker.names.map((item) => item.name), ["Yuki"]);
  const unterminated = collectKsStrings("text before\n[iscript]\ncode\nmore code", "s.ks");
  assert.deepEqual(unterminated.strings.map((item) => item.text), ["text before"]);
});
