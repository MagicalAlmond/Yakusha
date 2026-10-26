import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { rmProfile } from "../src/engines/profile.js";
import { rmFilePlan, extractProject } from "../src/core/extract.js";
import { systemPrompt, validateTranslation } from "../src/pipeline/translate.js";
import { verifyDictionary } from "../src/pipeline/verify.js";
import { wrapText, displayColumns } from "../src/pipeline/wrap.js";
import { getAdapter } from "../src/engines/registry.js";
import { renpyProfile } from "../src/engines/renpy/profile.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, "fixtures", "mini-mz");

// The 0.10.x seam refactor must not change behaviour: every default path has to
// produce the same bytes as the pre-profile code. These tests pin the fallback
// against the profile itself, so a future edit to one side cannot silently
// diverge from the other.

test("the RPG Maker adapters expose the RPG Maker profile without touching rules", () => {
  for (const id of ["mz", "mv"]) {
    const adapter = getAdapter(id);
    assert.equal(adapter.profile, rmProfile);
    assert.deepEqual(adapter.rules, { controlCodes: true, maxColumns: 0 });
  }
});

// Ren'Py keeps the same rules (control codes are significant, no column limit)
// but must never inherit the RPG Maker grammar: {…} tags and […] substitutions
// are its control codes and backslash is not.
test("the Ren'Py adapter exposes its own profile", () => {
  const adapter = getAdapter("renpy");
  assert.equal(adapter.profile, renpyProfile);
  assert.notEqual(adapter.profile, rmProfile);
  assert.deepEqual(adapter.rules, { controlCodes: true, maxColumns: 0 });
  assert.deepEqual(adapter.profile.grammar.controlCodes("Hello {i}world{/i} [name]!"), ["{i}", "{/i}", "[name]"]);
  assert.deepEqual(rmProfile.grammar.controlCodes("Hello {i}world{/i} [name]!"), []);
});

test("rmProfile reproduces the hardcoded prompt wording", () => {
  const withProfile = systemPrompt({ profile: rmProfile });
  const without = systemPrompt({});
  assert.equal(withProfile, without);
  assert.match(withProfile, /RPG Maker MZ game text from Japanese into Simplified Chinese/);
  // The escape example list is profile data too.
  assert.ok(withProfile.includes("\\C[6], \\V[12], \\N[1], \\G"));
});

test("rmProfile reproduces validateTranslation judgements", () => {
  const cases = [
    ["%1は%2を唱えた！", "%1施放了%2！"],
    ["こんにちは", "こんにちは"],
    ["\C[2]お金", "\C[3]お金"],
    ["ten chars src", "way too long for this ratio to pass, far beyond four times the source length"],
  ];
  for (const [source, target] of cases) {
    const a = validateTranslation(source, target, {});
    const b = validateTranslation(source, target, { profile: rmProfile });
    assert.deepEqual({ ...a }, { ...b }, source);
  }
});

test("rmProfile reproduces verifyDictionary findings", () => {
  const dictionary = {
    format: "yakusha/1",
    game: "test",
    updatedAt: "2026-01-01T00:00:00.000Z",
    entries: {
      "こんにちは": { text: "こんにちは", contexts: [] },
      "【装飾品】睡眠・沈黙を防ぐ。": { text: "【装饰品】防止睡眠・沉默。", contexts: [] },
      "身体の動きが止まることはない。": { text: "身體的動作卻停不下來。", contexts: [] },
    },
  };
  const a = verifyDictionary(dictionary, {});
  const b = verifyDictionary(dictionary, { profile: rmProfile });
  assert.deepEqual(a.problems, b.problems);
  assert.deepEqual(a.counts, b.counts);
});

test("rmProfile reproduces wrap and column behaviour", () => {
  const text = "这是一段很长的中文测试文本用来验证禁则处理！真的非常长的一段话。";
  assert.equal(wrapText(text, 10), wrapText(text, 10, { tokenize: rmProfile.grammar.tokenize }));
  assert.equal(displayColumns("中文\\C[2]あ"), displayColumns("中文\\C[2]あ", rmProfile.grammar.tokenize));
});

test("extractProject with the explicit plan matches the default", () => {
  const a = extractProject(FIXTURE);
  const b = extractProject(FIXTURE, rmFilePlan);
  assert.equal(a.entries.size, b.entries.size);
  assert.equal(a.totalStrings, b.totalStrings);
  assert.deepEqual(a.perFile, b.perFile);
  for (const [key, value] of a.entries) {
    const other = b.entries.get(key);
    assert.ok(other, key);
    assert.equal(value.count, other.count);
    assert.deepEqual([...value.contexts].sort(), [...other.contexts].sort());
  }
});

test("a custom profile changes the prompt and silences the kana audit", () => {
  // A pretend engine: English source, no escape codes, its own wording.
  const custom = {
    id: "custom",
    prompt: { task: (lang) => "Translate custom engine text into " + lang + ".", escapeExamples: "" },
    grammar: {
      tokenize: (line) => [...line].map((v) => ({ t: "text", v })),
      controlCodes: () => [],
      plainText: (text) => text,
      visibleText: (text) => text,
    },
    validate: { isUntranslated: () => false, slots: /%[0-9]+/g },
    verify: { kana: /\u3041-\u3096\u30a1-\u30fa/, han: /[\u4e00-\u9fff]/, traditional: new Set(), slots: /%[0-9]+/g },
  };
  const prompt = systemPrompt({ profile: custom });
  assert.ok(prompt.startsWith("You are a professional game localiser.\nTranslate custom engine text into Simplified Chinese."));
  assert.ok(!prompt.includes("RPG Maker MZ"));

  // A translated line that would trip the RPG Maker kana warning stays clean,
  // because the profile owns the judgement, not the audit loop.
  const dictionary = {
    format: "yakusha/1",
    game: "test",
    updatedAt: "2026-01-01T00:00:00.000Z",
    entries: {
      "剣を構える": { text: "举剑きりかかる", contexts: [] },
    },
  };
  const withDefault = verifyDictionary(dictionary, {});
  const withCustom = verifyDictionary(dictionary, { profile: custom });
  assert.equal(withDefault.counts.kana, 1);
  assert.deepEqual(withCustom.problems, []);
  assert.deepEqual(withCustom.counts, {});
});

test("a custom extract plan collects its own fields", () => {
  const plan = {
    dataDir: "data",
    files: [
      {
        matches: (name) => name === "System.json",
        collect: (data, name, add) => {
          if (data && typeof data.gameTitle === "string") add(data.gameTitle, name + ":gameTitle");
        },
      },
    ],
    fallback: { matches: () => false, collect: () => {} },
  };
  const result = extractProject(FIXTURE, plan);
  assert.deepEqual(Object.keys(result.perFile), ["System.json"]);
  assert.ok(result.entries.has("テストゲーム"));
  assert.ok(!result.entries.has("アリア"));
});
