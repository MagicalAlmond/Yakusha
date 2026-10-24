/**
 * Tests for the post-translation audit.
 *
 * Each case is a defect the maintainers actually found in a real dictionary, so a
 * regression here means a released translation would look broken to a player.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { verifyDictionary } from "../src/pipeline/verify.js";
import { plainText, visibleText } from "../src/core/textkey.js";

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

test("verify: a translation that drifts into traditional Chinese is reported", () => {
  // Real line: 動 appears in the source, so only 卻 and 來 count as borrowed.
  const result = verifyDictionary(
    dictionary({ "身体の動きが止まることはない。": { text: "身体的動作卻停不下來。" } })
  );
  const trad = ofKind(result, "trad");
  assert.equal(trad.length, 1);
  assert.equal(trad[0].severity, "warn");
  assert.equal(trad[0].detail, "traditional characters: 卻來");
});

test("verify: traditional characters the source already used are not a leak", () => {
  // Japanese writes 愛 and 動 exactly like traditional Chinese does, so a
  // character the source uses is no evidence of a drifting translation.
  const result = verifyDictionary(
    dictionary({ "愛液で体が動かない": { text: "愛液让身体動不了" }, "すでに交尾準備": { text: "早已因交尾准备" } })
  );
  assert.equal(ofKind(result, "trad").length, 0);
});

test("verify: several leaked characters are listed once each", () => {
  const result = verifyDictionary(dictionary({ "いう": { text: "說說還們" } }));
  const trad = ofKind(result, "trad");
  assert.equal(trad.length, 1);
  assert.equal(trad[0].detail, "traditional characters: 說還們");
});

test("verify: a speaker name left in Japanese is an error when the game translates it", () => {
  // The MV plugin paints the tag into a name box, so the player reads it raw.
  const result = verifyDictionary(
    dictionary({
      [String.raw`\N<ひなた>“おはよう”`]: { text: String.raw`\N<日向>“早上好”` },
      [String.raw`\N<ひなた>“呼ー♡”`]: { text: String.raw`\N<ひなた>“呼ー♡”` },
    })
  );
  const speaker = ofKind(result, "speaker");
  assert.equal(speaker.length, 1);
  assert.equal(speaker[0].severity, "error");
  assert.match(speaker[0].detail, /left in Japanese: ひなた/);
});

test("verify: two renderings of one speaker name are a warning", () => {
  const rows = {};
  for (let i = 0; i < 3; i += 1) {
    rows[String.raw`\N<さやか>“セリフ` + i + "”"] = { text: String.raw`\N<沙耶香>“台词` + i + "”" };
  }
  rows[String.raw`\N<さやか>“もう一つ”`] = { text: String.raw`\N<沙耶加>“还有一个”` };
  const speaker = ofKind(verifyDictionary(dictionary(rows)), "speaker");
  assert.equal(speaker.length, 1);
  assert.equal(speaker[0].severity, "warn");
  assert.match(speaker[0].detail, /沙耶加/);
  assert.match(speaker[0].detail, /沙耶香/);
});

test("verify: a name this game always leaves in Japanese is not reported", () => {
  // Keeping an honourific-only name or a deliberate proper noun is a choice, so
  // nothing is reported until at least one line proves the name gets translated.
  const rows = {
    [String.raw`\N<ぬらり>“ひとつ”`]: { text: String.raw`\N<ぬらり>“第一个”` },
    [String.raw`\N<ぬらり>“ふたつ”`]: { text: String.raw`\N<ぬらり>“第二个”` },
  };
  const result = verifyDictionary(dictionary(rows));
  assert.equal(ofKind(result, "speaker").length, 0);
});

test("verify: a Han-only speaker name that is still the Japanese source is an error", () => {
  // 水泳部員 contains 員, which simplified Chinese always writes as 员, so seeing
  // it in the name box means the tag was never translated.
  const result = verifyDictionary(
    dictionary({
      [String.raw`\N<水泳部員>“はじめまして”`]: { text: String.raw`\N<水泳部員>“初次见面”` },
    })
  );
  const speaker = ofKind(result, "speaker");
  assert.equal(speaker.length, 1);
  assert.equal(speaker[0].severity, "error");
  assert.match(speaker[0].detail, /left untranslated: 水泳部員/);
});

test("verify: a Han-only name that is spelled the same in Chinese is not reported", () => {
  // 少女 and 入浴女性 read identically in both languages, so keeping them is a
  // legitimate choice and there is nothing to report.
  const result = verifyDictionary(
    dictionary({
      [String.raw`\N<少女>“こんにちは”`]: { text: String.raw`\N<少女>“你好”` },
      [String.raw`\N<入浴女性>“こんにちは”`]: { text: String.raw`\N<入浴女性>“你好”` },
    })
  );
  assert.equal(ofKind(result, "speaker").length, 0);
});

test("verify: a tie between two renderings picks the Chinese one", () => {
  // Small dictionaries can hold one line per rendering; the majority must not
  // depend on which key happened to be stored first.
  const rows = {};
  rows[String.raw`\N<さやか>“あ”`] = { text: String.raw`\N<さやか>“啊”` };
  rows[String.raw`\N<さやか>“い”`] = { text: String.raw`\N<沙耶香>“一”` };
  const speaker = ofKind(verifyDictionary(dictionary(rows)), "speaker");
  assert.equal(speaker.length, 1);
  assert.equal(speaker[0].severity, "error");
});

test("verify: angle brackets holding code are not speaker names", () => {
  // Games using Chimaki_Lang write expressions such as <50*\v[65]> in the line.
  const result = verifyDictionary(
    dictionary({
      [String.raw`<50*\v[65]>テスト`]: { text: "<50*\\v[65]>测试" },
      [String.raw`<\s[25] ? " OFF ":" ON " >テスト`]: { text: String.raw`<\s[25] ? " OFF ":" ON " >测试` },
    })
  );
  assert.equal(ofKind(result, "speaker").length, 0);
});

test("verify: lines that lose or gain a speaker tag are skipped", () => {
  // Pairing by position is only meaningful while both sides agree on the count.
  const result = verifyDictionary(
    dictionary({
      [String.raw`\N<ひなた>\N<さやか>“ふたり”`]: { text: String.raw`\N<日向>“两个人”` },
      [String.raw`\N<ひなた>“ひとり”`]: { text: String.raw`\N<日向>\N<沙耶香>“一个人”` },
    })
  );
  assert.equal(ofKind(result, "speaker").length, 0);
});

test("verify: speaker and trad are filterable like every other kind", () => {
  const bad = dictionary({
    [String.raw`\N<ひなた>“おはよう”`]: { text: String.raw`\N<日向>“早上好”` },
    [String.raw`\N<ひなた>“呼ー♡”`]: { text: String.raw`\N<ひなた>“呼ー♡”` },
    "いう": { text: "說" },
  });
  assert.deepEqual(verifyDictionary(bad, { kinds: ["speaker"] }).counts, { speaker: 1 });
  const both = verifyDictionary(bad, { kinds: ["trad", "speaker"] });
  assert.deepEqual(both.counts, { trad: 1, speaker: 1 });
  assert.equal(verifyDictionary(bad, { kinds: ["kana"] }).problems.length, 0);
});

test("visibleText: drops escape codes and inline speaker markup", () => {
  assert.equal(visibleText(String.raw`\N<ひなた>“呼ー♡”`), "“呼ー♡”");
  assert.equal(visibleText(String.raw`\C[2]abc\C[0]`), "abc");
  assert.equal(visibleText("plain"), "plain");
  assert.equal(visibleText(undefined), "");
});

test("plainText: keeps inline markup, drops escape codes", () => {
  assert.equal(plainText(String.raw`\N<ひなた>“呼ー♡”`), "<ひなた>“呼ー♡”");
  assert.equal(plainText(String.raw`\C[2]abc\C[0]`), "abc");
  assert.equal(plainText(undefined), "");
});
