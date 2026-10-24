import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { emptyDictionary } from "../src/core/dict.js";
import { mockProvider } from "../src/pipeline/provider.js";
import {
  selectPending,
  buildBatches,
  selectGlossary,
  systemPrompt,
  userPrompt,
  parseReply,
  validateTranslation,
  translateDictionary,
  hasKanaOutsideMarkup,
} from "../src/pipeline/translate.js";

/** @returns {import("../src/core/dict.js").Dictionary} */
function dictOf(entries) {
  const d = emptyDictionary("test");
  for (const [key, value] of Object.entries(entries)) {
    d.entries[key] = typeof value === "string" ? { text: value, contexts: [] } : value;
  }
  return d;
}

test("translate: selectPending skips translated entries", () => {
  const d = dictOf({ a: "", b: "done", c: "" });
  const pending = selectPending(d);
  assert.deepEqual(pending.map((p) => p.key).sort(), ["a", "c"]);
});

test("translate: selectPending sorts longest first and honours limit", () => {
  const d = dictOf({ a: "", bbbbb: "", ccc: "" });
  assert.deepEqual(selectPending(d).map((p) => p.key), ["bbbbb", "ccc", "a"]);
  assert.deepEqual(selectPending(d, { limit: 2 }).map((p) => p.key), ["bbbbb", "ccc"]);
});

test("translate: selectPending filters by context substring", () => {
  const d = dictOf({ a: { text: "", contexts: ["Map001.json:401"] }, b: { text: "", contexts: ["Items.json:name"] } });
  assert.deepEqual(selectPending(d, { onlyContext: "Map" }).map((p) => p.key), ["a"]);
});

test("translate: selectPending accepts several contexts as one OR filter", () => {
  const d = dictOf({
    a: { text: "", contexts: ["Map001.json:401"] },
    b: { text: "", contexts: ["Items.json:name"] },
    c: { text: "", contexts: ["System.json:terms.basic"] },
  });
  assert.deepEqual(selectPending(d, { onlyContext: ["Map", "Items"] }).map((p) => p.key).sort(), ["a", "b"]);
  // One value still behaves exactly like the old string form.
  assert.deepEqual(selectPending(d, { onlyContext: ["Map"] }).map((p) => p.key), ["a"]);
  // An empty array or an array of empty strings filters nothing, same as absent.
  assert.equal(selectPending(d, { onlyContext: [] }).length, 3);
  assert.equal(selectPending(d, { onlyContext: [""] }).length, 3);
});

test("translate: buildBatches respects the item count", () => {
  const items = Array.from({ length: 7 }, (_, i) => ({ key: "x" + i, contexts: [] }));
  const batches = buildBatches(items, { batchSize: 3 });
  assert.deepEqual(batches.map((b) => b.length), [3, 3, 1]);
});

test("translate: buildBatches respects the character budget", () => {
  const items = Array.from({ length: 5 }, () => ({ key: "x".repeat(100), contexts: [] }));
  const batches = buildBatches(items, { batchSize: 100, charBudget: 300 });
  assert.ok(batches.length >= 3);
  for (const batch of batches) {
    const chars = batch.reduce((sum, item) => sum + item.key.length + 40, 0);
    assert.ok(chars <= 300 || batch.length === 1);
  }
});

test("translate: selectGlossary keeps only the rows a batch mentions", () => {
  const glossary = { "勇者": "勇士", "魔王": "魔王", "ポーション": "药水" };
  const items = [{ key: "勇者が来た", contexts: [] }, { key: "村人A", contexts: [] }];
  assert.deepEqual(selectGlossary(glossary, items), { "勇者": "勇士" });
});

test("translate: selectGlossary drops everything when nothing matches", () => {
  assert.deepEqual(selectGlossary({ "勇者": "勇士" }, [{ key: "a", contexts: [] }]), {});
  assert.deepEqual(selectGlossary({}, [{ key: "勇者", contexts: [] }]), {});
});

test("translate: selectGlossary does not join the end of one line to the next", () => {
  // Items are separated so a term can never be "found" by gluing two lines.
  // Otherwise "ポー" + "ション" would pull in a term that
  // neither line actually contains.
  const items = [{ key: "ポー", contexts: [] }, { key: "ションを買う", contexts: [] }];
  assert.deepEqual(selectGlossary({ "ポーション": "药水" }, items), {});
});

test("translate: a request only pays for the glossary rows it needs", async () => {
  // What the provider sees, paired per request: the system prompt must carry
  // only the terms mentioned by that request's own items.
  const seen = [];
  const provider = {
    name: "spy",
    async complete({ systemPrompt: sys, userPrompt: user }) {
      seen.push({ sys, user });
      return JSON.stringify({ translations: [] });
    },
  };
  const d = dictOf({ "勇者が来た": "", "魔王が来た": "" });
  await translateDictionary(d, {
    provider,
    glossary: { "勇者": "勇士", "魔王": "大魔王", "ポーション": "药水" },
    batchSize: 1,
    concurrency: 1,
    attempts: 1,
  });
  assert.equal(seen.length, 2);
  // Nothing outside the two source lines may leak into any request.
  assert.equal(seen.every((s) => s.sys.includes("药水") === false), true);
  for (const { sys, user } of seen) {
    if (user.includes("勇者")) {
      assert.match(sys, /勇士/);
      assert.doesNotMatch(sys, /大魔王/);
    } else {
      assert.match(sys, /大魔王/);
      assert.doesNotMatch(sys, /勇士/);
    }
  }
});

test("translate: systemPrompt carries the language and glossary", () => {
  const prompt = systemPrompt({ targetLang: "Japanese", glossary: { "勇者": "勇士" } });
  assert.match(prompt, /Japanese/);
  assert.ok(prompt.includes("勇士"));
  assert.match(prompt, /escape code/i);
});

test("translate: userPrompt is a JSON payload with indices", () => {
  const parsed = JSON.parse(userPrompt([{ key: "あ", contexts: [] }, { key: "い", contexts: [] }]));
  assert.deepEqual(parsed.items, [{ i: 0, text: "あ" }, { i: 1, text: "い" }]);
});

test("translate: parseReply accepts a plain object", () => {
  const out = parseReply('{"translations":[{"i":0,"t":"甲"},{"i":1,"t":"乙"}]}');
  assert.deepEqual(out, { 0: "甲", 1: "乙" });
});

test("translate: parseReply tolerates a markdown fence and stray prose", () => {
  const fence = String.fromCharCode(96, 96, 96);
  const reply = "Sure!\n" + fence + "json\n" + '{"translations":[{"i":0,"t":"甲"}]}' + "\n" + fence;
  assert.deepEqual(parseReply(reply), { 0: "甲" });
});

test("translate: parseReply accepts alternate key names", () => {
  assert.deepEqual(parseReply('{"items":[{"index":2,"text":"丙"}]}'), { 2: "丙" });
  assert.deepEqual(parseReply('[{"i":0,"translation":"丁"}]'), { 0: "丁" });
});

test("translate: parseReply rejects junk", () => {
  assert.throws(() => parseReply("no json here"), /not a JSON object/);
  assert.throws(() => parseReply('{"foo":1}'), /no translations array/);
});

test("translate: validateTranslation accepts a faithful translation", () => {
  assert.equal(validateTranslation("お金が無い！", "没有钱！").ok, true);
});

test("translate: validateTranslation keeps escape codes identical", () => {
  assert.equal(validateTranslation("\\C[2]お金\\C[0]が無い", "\\C[2]没有\\C[0]钱").ok, true);
  const dropped = validateTranslation("\\C[2]お金\\C[0]", "没有钱");
  assert.equal(dropped.ok, false);
  assert.match(dropped.reason, /escape codes differ/);
  const reordered = validateTranslation("\\C[2]あ\\V[1]", "\\V[1]乙\\C[2]");
  assert.equal(reordered.ok, false);
});

test("translate: validateTranslation keeps %n placeholders", () => {
  assert.equal(validateTranslation("%1は%2を唱えた！", "%1施放了%2！").ok, true);
  const dropped = validateTranslation("%1は%2を唱えた！", "施放了技能！");
  assert.equal(dropped.ok, false);
  assert.match(dropped.reason, /placeholders differ/);
  const renumbered = validateTranslation("%1は%2を放った！", "%2施放了%1！");
  assert.equal(renumbered.ok, false);
});

test("translate: validateTranslation requires the same number of lines", () => {
  assert.equal(validateTranslation("あ\nい", "甲\n乙").ok, true);
  const merged = validateTranslation("あ\nい", "甲乙");
  assert.equal(merged.ok, false);
  assert.match(merged.reason, /line breaks differ/);
});

test("translate: validateTranslation rejects empty, truncated and padded output", () => {
  assert.equal(validateTranslation("これは長い台詞です", "   ").ok, false);
  assert.equal(validateTranslation("これは長い台詞です", "短").ok, false);
  assert.equal(validateTranslation("あ", "x".repeat(50)).ok, false);
  assert.equal(validateTranslation("あ", "x\ufffd").ok, false);
});

test("translate: translateDictionary fills every entry through the mock provider", async () => {
  const d = dictOf({ "お金が無い！": "", "勇者よ": "", "済み": "已完成" });
  const result = await translateDictionary(d, { provider: mockProvider({ prefix: "译:" }) });
  assert.equal(result.total, 2);
  assert.equal(result.translated, 2);
  assert.equal(result.rejected.length, 0);
  assert.equal(d.entries["お金が無い！"].text, "译:お金が無い！");
  assert.equal(d.entries["済み"].text, "已完成");
});

test("translate: glossary hits skip the provider entirely", async () => {
  const d = dictOf({ "勇者": "" });
  let calls = 0;
  const provider = {
    name: "counting",
    async complete() {
      calls += 1;
      return '{"translations":[]}';
    },
  };
  const result = await translateDictionary(d, { provider, glossary: { "勇者": "勇士" } });
  assert.equal(calls, 0);
  assert.equal(result.translated, 1);
  assert.equal(d.entries["勇者"].text, "勇士");
});

test("translate: glossary only fills the gaps and leaves finished work alone", async () => {
  const d = dictOf({ "フェイリン": "费琳", "勇者": "" });
  const result = await translateDictionary(d, {
    provider: mockProvider(),
    glossary: { "フェイリン": "菲琳", "勇者": "勇士" },
    glossaryOnly: true,
  });
  assert.equal(d.entries["フェイリン"].text, "费琳", "an existing translation is not rewritten by default");
  assert.equal(d.entries["勇者"].text, "勇士");
  assert.equal(result.translated, 1);
  assert.equal(result.overwritten, 0);
});

test("translate: overwriteExisting lets a drift glossary replace a finished entry", async () => {
  // "terms --drift-only" writes a glossary naming the entries that already have
  // a translation, so without this the report could never be acted on.
  const d = dictOf({ "フェイリン": "费琳" });
  const result = await translateDictionary(d, {
    provider: mockProvider(),
    glossary: { "フェイリン": "菲琳" },
    glossaryOnly: true,
    overwriteExisting: true,
  });
  assert.equal(d.entries["フェイリン"].text, "菲琳");
  assert.equal(result.translated, 1);
  assert.equal(result.overwritten, 1);
});

test("translate: overwriteExisting still runs the validators", async () => {
  const d = dictOf({ "\\C[2]お金": "已经翻译" });
  const result = await translateDictionary(d, {
    provider: mockProvider(),
    glossary: { "\\C[2]お金": "没有颜色码" },
    glossaryOnly: true,
    overwriteExisting: true,
  });
  assert.equal(d.entries["\\C[2]お金"].text, "已经翻译", "a translation that breaks the escape codes is refused");
  assert.equal(result.rejected.length, 1);
  assert.equal(result.overwritten, 0);
});

test("translate: a bad translation is retried and then recorded as an error", async () => {
  const d = dictOf({ "\\C[2]お金": "" });
  let calls = 0;
  const provider = {
    name: "bad",
    async complete() {
      calls += 1;
      return JSON.stringify({ translations: [{ i: 0, t: "没有" }] });
    },
  };
  const result = await translateDictionary(d, { provider });
  assert.equal(calls, 2, "the pipeline retries once");
  assert.equal(result.translated, 0);
  assert.equal(result.rejected.length, 1);
  assert.equal(d.entries["\\C[2]お金"].text, "");
  assert.match(d.entries["\\C[2]お金"].error, /escape codes differ/);
});

test("translate: a second attempt can still succeed", async () => {
  const d = dictOf({ "\\C[2]お金": "" });
  let calls = 0;
  const provider = {
    name: "flaky",
    async complete() {
      calls += 1;
      const text = calls === 1 ? "没有" : "\\C[2]没有";
      return JSON.stringify({ translations: [{ i: 0, t: text }] });
    },
  };
  const result = await translateDictionary(d, { provider });
  assert.equal(calls, 2);
  assert.equal(result.translated, 1);
  assert.equal(d.entries["\\C[2]お金"].text, "\\C[2]没有");
});

test("translate: a provider that skips items leaves them pending", async () => {
  const d = dictOf({ "あ": "", "い": "" });
  const provider = {
    name: "lazy",
    async complete() {
      return '{"translations":[]}';
    },
  };
  const result = await translateDictionary(d, { provider });
  assert.equal(result.translated, 0);
  assert.deepEqual(result.rejected.map((r) => r.reason), ["missing from reply", "missing from reply"]);
  assert.equal(d.entries["あ"].text, "");
  assert.equal(d.entries["い"].text, "");
});

test("translate: parseReply accepts an echoed request item (src field)", () => {
  // DeepSeek echoes the request shape back and puts the translation in "src".
  const out = parseReply('{"translations":[{"i":0,"src":"且不说尺寸"},{"i":1,"text":"第二句"}]}');
  assert.deepEqual(out, { 0: "且不说尺寸", 1: "第二句" });
});

test("translate: parseReply repairs unescaped backslashes from the model", () => {
  // Models echo RPG Maker control codes as backslash + brace, which is not
  // valid JSON and would otherwise throw away a whole batch.
  const bs = String.fromCharCode(92);
  const item = (i, t) => '{"i":' + i + ',"t":"' + t + '"}';
  const reply =
    '{"translations":[' +
    item(0, "啊啊" + bs + "{我的罐子" + bs + "}") + ',' +
    item(1, "红色" + bs + "C[2]文字" + bs + "C[0]") +
    ']}';
  const out = parseReply(reply);
  assert.equal(out[0], "啊啊" + bs + "{我的罐子" + bs + "}");
  assert.equal(out[1], "红色" + bs + "C[2]文字" + bs + "C[0]");
});

;
test("translate: an identical line is accepted once the visible text has no kana", () => {
  // Some MV games inline the speaker with a custom tag: \N<ひなた>"好开心♡".
  // The tag keeps kana after a perfect translation, so the echo check must only
  // look at what the player sees, otherwise every such line is rejected forever.
  const bs = String.fromCharCode(92);
  const line = bs + "N<ひなた>“好开心♡”";
  const verdict = validateTranslation(line, line);
  assert.equal(verdict.ok, true, verdict.reason);
});

test("translate: an identical line that still shows kana is rejected", () => {
  const line = "お金が無い！";
  const verdict = validateTranslation(line, line);
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /identical to source/);
});

test("translate: hasKanaOutsideMarkup ignores tags and escape codes", () => {
  const bs = String.fromCharCode(92);
  assert.equal(hasKanaOutsideMarkup(bs + "N<ひなた>“你好”"), false);
  assert.equal(hasKanaOutsideMarkup("お金が無い！"), true);
  assert.equal(hasKanaOutsideMarkup(bs + "C[2]ＨＰ" + bs + "C[0]"), false);
});

