import test from "node:test";
import assert from "node:assert/strict";

import { charColumns, displayColumns, wrapText } from "../src/pipeline/wrap.js";
import { translateDictionary, systemPrompt, validateTranslation } from "../src/pipeline/translate.js";
import { emptyDictionary } from "../src/core/dict.js";

/** Rendered with a runtime backslash so this file has no escape surgery. */
const BS = String.fromCharCode(92);

test("wrap: full width characters count as two columns", () => {
  assert.equal(charColumns("あ"), 2);
  assert.equal(charColumns("a"), 1);
  assert.equal(charColumns("，"), 2);
  assert.equal(displayColumns("abあい"), 6);
});

test("wrap: escape codes are zero width and never split", () => {
  const text = BS + "C[6]这是红色的文字";
  assert.equal(displayColumns(text), 14);
  const wrapped = wrapText(text, 8);
  assert.ok(wrapped.startsWith(BS + "C[6]"), wrapped);
  for (const line of wrapped.split("\n")) assert.ok(displayColumns(line) <= 8);
});

test("wrap: a line that already fits is returned untouched", () => {
  const text = "很短的一句";
  assert.equal(wrapText(text, 54), text);
});

test("wrap: a limit of zero disables wrapping", () => {
  const text = "这是一段很长的中文文本，用来确认长度为 0 的时候完全不改动原文。";
  assert.equal(wrapText(text, 0), text);
  assert.equal(wrapText(text, -1), text);
  assert.equal(wrapText(text, Number.NaN), text);
});

test("wrap: existing line breaks are preserved and each line wraps on its own", () => {
  const text = "第一行很长很长很长很长\n第二行";
  const wrapped = wrapText(text, 10);
  const lines = wrapped.split("\n");
  assert.ok(lines.length >= 2);
  assert.ok(wrapped.includes("第二行"));
  for (const line of lines) assert.ok(displayColumns(line) <= 10);
});

test("wrap: breaks prefer punctuation over cutting a sentence in half", () => {
  const text = "第一句话说完了。第二句话也结束了。";
  const wrapped = wrapText(text, 18);
  const first = wrapped.split("\n")[0];
  assert.ok(first.endsWith("。"), first);
});

test("wrap: a single character wider than the limit is still emitted", () => {
  assert.equal(wrapText("あ", 1), "あ");
});

test("wrap: a short last line is rebalanced at a punctuation mark", () => {
  // Without rebalancing this ends on "\u51fa\u7684\u611f\u89c9" style widow lines.
  const text = "在意识即将中断之际，感受到体内血肉仿佛都要融化流出的感觉";
  const lines = wrapText(text, 54).split("\n");
  assert.equal(lines.length, 2);
  assert.ok(lines[0].endsWith("\uff0c"), lines[0]);
  assert.ok(displayColumns(lines[1]) >= 54 * 0.35, String(displayColumns(lines[1])));
});

test("wrap: rebalancing never splits a word when there is no punctuation", () => {
  const text = "中".repeat(60);
  const lines = wrapText(text, 30).split("\n");
  for (const line of lines) assert.ok(displayColumns(line) <= 30);
  assert.equal(lines.join(""), text);
});

test("wrap: punctuation does not start a line", () => {
  const text = "这是一句非常长的中文台词需要测试标点是否会被推到下一行开头的情况发生，然后继续还有更多文字";
  for (const line of wrapText(text, 30).split("\n")) {
    if (line.length > 0) assert.ok(!/^[\u3001\u3002\uff0c\uff01\uff1f\u2026]/.test(line), line);
  }
});

test("wrap: a kinsoku run of marks is pulled onto the previous line", () => {
  // A hard cut right behind "\u2026" used to leave "\uff01\uff1f" alone on line two.
  const text = "（咿……！？不会吧……不会不会不会！？这、家伙，难道就这样……";
  const lines = wrapText(text, 54).split("\n");
  assert.equal(lines.length, 2);
  assert.ok(!/^[\u3001\u3002\uff0c\uff01\uff1f\u2026]/.test(lines[1]), lines[1]);
  assert.equal(lines.join(""), text);
});

test("translate: maxColumns is added to the prompt", () => {
  const plain = systemPrompt({});
  assert.ok(!plain.includes("columns"), plain);
  const sized = systemPrompt({ maxColumns: 54 });
  assert.ok(sized.includes("54"), sized);
  assert.ok(sized.includes("columns"), sized);
});

test("translate: the wrapped translation is stored under the original key", async () => {
  // The gate still compares the model output verbatim, so a long target that
  // only passes after wrapping must not be rejected for "line breaks differ".
  const source = "あ".repeat(60);
  const target = "中".repeat(60);
  const d = emptyDictionary("test");
  d.entries[source] = { text: "", contexts: [] };
  const provider = {
    name: "fixed",
    async complete() {
      return JSON.stringify({ translations: [{ i: 0, t: target }] });
    },
  };
  const result = await translateDictionary(d, { provider, maxColumns: 20 });
  assert.equal(result.translated, 1);
  const stored = d.entries[source].text;
  assert.equal(stored.replace(/\n/g, ""), target);
  for (const line of stored.split("\n")) assert.ok(displayColumns(line) <= 20);
});

test("translate: without maxColumns the text is stored verbatim", async () => {
  const source = "あ".repeat(60);
  const target = "中".repeat(60);
  const d = emptyDictionary("test");
  d.entries[source] = { text: "", contexts: [] };
  const provider = {
    name: "fixed",
    async complete() {
      return JSON.stringify({ translations: [{ i: 0, t: target }] });
    },
  };
  await translateDictionary(d, { provider });
  assert.equal(d.entries[source].text, target);
});

test("translate: a glossary hit is wrapped too", async () => {
  const source = "あ".repeat(40);
  const fixed = "中".repeat(40);
  const d = emptyDictionary("test");
  d.entries[source] = { text: "", contexts: [] };
  const result = await translateDictionary(d, {
    provider: { name: "never", complete: async () => assert.fail("should not be called") },
    glossary: { [source]: fixed },
    maxColumns: 10,
  });
  assert.equal(result.translated, 1);
  for (const line of d.entries[source].text.split("\n")) assert.ok(displayColumns(line) <= 10);
});

test("translate: validateTranslation still requires the same breaks", () => {
  // Wrapping is our own addition and happens after this gate, so a model that
  // drops a line break is still rejected.
  const verdict = validateTranslation("一\n二", "一二");
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /line breaks differ/);
});
