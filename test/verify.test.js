/**
 * Tests for the post-translation audit.
 *
 * Each case is a defect the maintainers actually found in a real dictionary, so a
 * regression here means a released translation would look broken to a player.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { verifyDictionary } from "../src/pipeline/verify.js";
import { visibleText } from "../src/core/textkey.js";

/** @param {Record<string, {text?: string, error?: string}>} entries */
function dictionary(entries) {
  return {
    format: "yakusha/1",
    game: "test",
    updatedAt: new Date(0).toISOString(),
    entries,
  };
}

/** @param {ReturnType<typeof verifyDictionary>} result @param {string} kind */
function ofKind(result, kind) {
  return result.problems.filter((problem) => problem.kind === kind);
}

test("verify: a clean dictionary reports nothing", () => {
  const result = verifyDictionary(
    dictionary({
      "こんにちは": { text: "你好" },
      "ありがとう": { text: "谢谢" },
    })
  );
  assert.equal(result.total, 2);
  assert.equal(result.translated, 2);
  assert.equal(result.problems.length, 0);
  assert.equal(result.errors, 0);
});

test("verify: empty targets count as pending, not as problems", () => {
  const result = verifyDictionary(dictionary({ "こんにちは": { text: "" }, "ありがとう": { text: "谢谢" } }));
  assert.equal(result.pending, 1);
  assert.equal(result.translated, 1);
  assert.equal(result.problems.length, 0);
});

test("verify: kana left in a translation is a warning", () => {
  const result = verifyDictionary(dictionary({ "ラスボス敗北時(通常)(テ)": { text: "最终BOSS败北时(通常)(テ)" } }));
  const kana = ofKind(result, "kana");
  assert.equal(kana.length, 1);
  assert.equal(kana[0].severity, "warn");
  assert.equal(result.errors, 0);
});

test("verify: the katakana middle dot is punctuation, not leftover kana", () => {
  // "睡眠・沈黙" is a normal Chinese separator; counting U+30FB made this the
  // single largest source of false positives.
  const result = verifyDictionary(
    dictionary({ "【装飾品】睡眠・沈黙・混乱を防ぐ。": { text: "【装饰品】防止睡眠・沉默・混乱。" } })
  );
  assert.equal(ofKind(result, "kana").length, 0);
  assert.equal(result.problems.length, 0);
});

test("verify: an echoed Japanese source is an error", () => {
  const result = verifyDictionary(dictionary({ "こんにちは": { text: "こんにちは" } }));
  const echo = ofKind(result, "echo");
  assert.equal(echo.length, 1);
  assert.equal(echo[0].severity, "error");
  assert.equal(result.errors, 1);
});

test("verify: an unchanged line without kana is not reported as an echo", () => {
  // "魔族", "射精" and "ＭＣ" are written identically in Chinese, an echo check
  // that fires on them would flag thousands of correct entries.
  const result = verifyDictionary(dictionary({ "魔族": { text: "魔族" }, "ＭＣ": { text: "ＭＣ" } }));
  assert.equal(ofKind(result, "echo").length, 0);
  assert.equal(result.errors, 0);
});

test("verify: escape codes must match exactly", () => {
  const result = verifyDictionary(dictionary({ "\\C[2]テキスト\\C[0]": { text: "\\C[3]文本\\C[0]" } }));
  const codes = ofKind(result, "codes");
  assert.equal(codes.length, 1);
  assert.equal(codes[0].severity, "error");
  assert.match(codes[0].detail, /escape codes differ/);
});

test("verify: a dropped %1 placeholder is an error", () => {
  const result = verifyDictionary(dictionary({ "\\N[1]は%1を使った！": { text: "\\N[1]使用了！" } }));
  const slots = ofKind(result, "slots");
  assert.equal(slots.length, 1);
  assert.equal(slots[0].severity, "error");
  assert.equal(result.errors, 1);
});

test("verify: renumbered placeholders are an error", () => {
  const result = verifyDictionary(dictionary({ "%1は%2に勝った": { text: "%2战胜了%1" } }));
  assert.equal(ofKind(result, "slots").length, 1);
});

test("verify: identical placeholders pass", () => {
  const result = verifyDictionary(dictionary({ "%1は%2に勝った": { text: "%1战胜了%2" } }));
  assert.equal(ofKind(result, "slots").length, 0);
});

test("verify: changed line breaks are reported as a warning", () => {
  // --max-length rewrites line breaks on purpose, so this can never be fatal.
  const result = verifyDictionary(dictionary({ "長い文章です\n二行目": { text: "很长的文章\n第二行\n多出来一行" } }));
  const lines = ofKind(result, "lines");
  assert.equal(lines.length, 1);
  assert.equal(lines[0].severity, "warn");
  assert.equal(result.errors, 0);
});

test("verify: width is only checked when --max-length is given", () => {
  const wide = dictionary({ "テキスト": { text: "这是一段很长的译文，长到超出了一行的显示宽度限制。" } });
  assert.equal(ofKind(verifyDictionary(wide), "width").length, 0);
  const result = verifyDictionary(wide, { maxColumns: 20 });
  const width = ofKind(result, "width");
  assert.equal(width.length, 1);
  assert.equal(width[0].severity, "warn");
  assert.match(width[0].detail, /limit is 20/);
});

test("verify: a line at exactly the width limit is accepted", () => {
  // 20 columns: ten full width characters.
  const result = verifyDictionary(dictionary({ "テキスト": { text: "一二三四五六七八九十" } }), { maxColumns: 20 });
  assert.equal(ofKind(result, "width").length, 0);
});

test("verify: a line one column over the limit is reported", () => {
  const result = verifyDictionary(dictionary({ "テキスト": { text: "一二三四五六七八九十一" } }), { maxColumns: 20 });
  assert.equal(ofKind(result, "width").length, 1);
});

test("verify: words that vanished from a Japanese source are reported", () => {
  const result = verifyDictionary(dictionary({ "魔王を倒した": { text: "……♡♡♡" } }));
  const missing = ofKind(result, "no-text");
  assert.equal(missing.length, 1);
  assert.equal(missing[0].severity, "warn");
});

test("verify: onomatopoeia without Han is not a missing word", () => {
  // "ッ…♡♡♡" -> "……♡♡♡" is the correct translation of a moan, and "MAP001"
  // must stay verbatim; neither source contains Han so neither is reported.
  const result = verifyDictionary(dictionary({ "ッ…♡♡♡": { text: "……♡♡♡" }, MAP001: { text: "MAP001" } }));
  assert.equal(ofKind(result, "no-text").length, 0);
  assert.equal(result.problems.length, 0);
});

test("verify: rejected entries are reported as warnings with their reason", () => {
  const result = verifyDictionary(dictionary({ "　": { text: "", error: "translation is empty" } }));
  const rejected = ofKind(result, "rejected");
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].severity, "warn");
  assert.equal(rejected[0].detail, "translation is empty");
  assert.equal(result.rejected, 1);
  assert.equal(result.pending, 1);
  assert.equal(result.errors, 0);
});

test("verify: --kind restricts the report", () => {
  const bad = dictionary({
    "こんにちは": { text: "こんにちは" },
    "ラスボス(テ)": { text: "最终BOSS(テ)" },
  });
  // The first entry is both echoed and full of kana, the second is only kana.
  const all = verifyDictionary(bad);
  assert.deepEqual(all.counts, { kana: 2, echo: 1 });
  const onlyKana = verifyDictionary(bad, { kinds: ["kana"] });
  assert.equal(onlyKana.problems.length, 2);
  assert.deepEqual(
    onlyKana.problems.map((problem) => problem.kind),
    ["kana", "kana"]
  );
  // counts follows the filter, so the printed summary cannot claim findings it
  // withheld.
  assert.deepEqual(onlyKana.counts, { kana: 2 });
});

test("verify: counts and severities add up to the problem list", () => {
  const result = verifyDictionary(
    dictionary({
      "こんにちは": { text: "こんにちは" },
      "ラスボス(テ)": { text: "最终BOSS(テ)" },
      "\\C[1]x": { text: "x" },
    })
  );
  const total = Object.values(result.counts).reduce((sum, n) => sum + n, 0);
  assert.equal(total, result.problems.length);
  assert.equal(result.errors + result.warnings, result.problems.length);
});

test("verify: a malformed dictionary does not throw", () => {
  assert.equal(verifyDictionary({}).total, 0);
  assert.equal(verifyDictionary({ entries: { a: {} } }).pending, 1);
});

test("visibleText: drops escape codes and inline speaker markup", () => {
  assert.equal(visibleText(String.raw`\N<ひなた>“呼ー♡”`), "“呼ー♡”");
  assert.equal(visibleText(String.raw`\C[2]abc\C[0]`), "abc");
  assert.equal(visibleText("plain"), "plain");
  assert.equal(visibleText(undefined), "");
});
