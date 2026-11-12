/**
 * Tests for the language-pair layer.
 *
 * Engine profiles own grammar; these modules own everything that depends on the
 * pair (what an untranslated echo looks like, what the audit reports, how the
 * prompt names the source language). The pair must stay swappable without
 * touching an engine, and the Japanese half must stay byte-identical to the
 * behaviour shipped before 0.75.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_SOURCE_LANGUAGE,
  SOURCE_LANGUAGES,
  isSourceLanguage,
  pairFor,
  sourceLanguage,
} from "../src/languages/index.js";
import * as en from "../src/languages/en.js";
import * as ja from "../src/languages/ja.js";
import { rmProfile } from "../src/engines/profile.js";
import { sourceProfile } from "../src/engines/language-pair.js";
import { visibleText } from "../src/core/textkey.js";

test("languages: the registry lists ja first and keeps it as the default", () => {
  assert.deepEqual(SOURCE_LANGUAGES, ["ja", "en"]);
  assert.equal(DEFAULT_SOURCE_LANGUAGE, "ja");
  assert.equal(isSourceLanguage("ja"), true);
  assert.equal(isSourceLanguage("en"), true);
  assert.equal(isSourceLanguage("fr"), false);
  assert.equal(isSourceLanguage(undefined), false);
  assert.equal(sourceLanguage().ID, "ja");
  assert.equal(sourceLanguage("en").NAME, "English");
});

test("languages: an unknown source language is rejected by name", () => {
  assert.throws(
    () => sourceLanguage("fr"),
    (error) => error instanceof RangeError && error.message === "unknown source language: fr (expected one of: ja, en)"
  );
  assert.throws(() => pairFor("fr"), RangeError);
});

test("languages: the English reader tells prose from Japanese and Chinese", () => {
  assert.equal(en.isEnglishSource("Hello, traveller."), true);
  assert.equal(en.isEnglishSource("こんにちは"), false);
  assert.equal(en.isEnglishSource("你好，旅行者。"), false);
  assert.equal(en.isEnglishSource("HP 50"), true);
});

test("languages: the English reader ignores engine markup", () => {
  // \\C[6] is an escape code, not prose; the grammar's visible reader removes it.
  assert.equal(en.isEnglishSource("\\C[6]", visibleText), false);
  assert.equal(en.isEnglishSource("\\C[6]Hello", visibleText), true);
});

test("languages: short acronyms stay legal, four-letter words do not", () => {
  assert.equal(en.isUntranslated("HP"), false);
  assert.equal(en.isUntranslated("EXP 12"), false);
  assert.equal(en.isUntranslated("Lv"), false);
  assert.equal(en.isUntranslated("Level"), true);
  assert.equal(en.isUntranslated("攻击力 Attack"), true);
  assert.equal(en.isUntranslated("攻击力"), false);
  assert.equal(en.isUntranslated("\\C[6]Hello", visibleText), true);
  assert.equal(en.isUntranslated("\\C[6]HP", visibleText), false);
});

test("languages: Japanese source detection is wider than the audit pattern", () => {
  // The middle dot and the prolonged mark are punctuation in Chinese, so the
  // audit stays quiet about them, but in a source line they are still Japanese.
  assert.equal(ja.isUntranslated("睡眠・沈黙"), true);
  assert.equal(ja.isUntranslated("スキルー"), true);
  assert.equal(ja.isUntranslated("你好"), false);
});

test("languages: englishToChinese binds the grammar's visible reader and slots", () => {
  const slots = /\{[^}]+\}/g;
  const grammar = { visibleText: (text) => String(text).replace(/\[[^\]]*\]/g, "") };
  const pair = en.englishToChinese(grammar, slots);
  assert.equal(pair.validate.isUntranslated("[b]Hello[/b]"), true);
  assert.equal(pair.validate.isUntranslated("[b]HP[/b]"), false);
  assert.equal(pair.validate.slots, slots);
  assert.equal(pair.verify.residual, en.englishToChinese(grammar, slots).verify.residual);
  assert.equal(pair.verify.residualKind, "source");
  assert.equal(pair.verify.residualDetail, "English text left in the translation");
  assert.equal(pair.verify.echoDetail, "target is identical to an English source");
  assert.equal(pair.verify.sourceName, "English");
  assert.equal(pair.verify.slots, slots);
  assert.equal(pair.verify.traditional, ja.TRADITIONAL);
});

test("languages: japaneseToChinese keeps the historical kana wording", () => {
  const pair = ja.japaneseToChinese(rmProfile.grammar, /%[0-9]+/g);
  assert.equal(pair.verify.residual, ja.VERIFY_KANA);
  assert.equal(pair.verify.residualKind, "kana");
  assert.equal(pair.verify.residualDetail, "Japanese kana left in the translation");
  assert.equal(pair.verify.echoDetail, "target is identical to a Japanese source");
  assert.equal(pair.verify.sourceName, "Japanese");
  assert.equal(pair.verify.kana, ja.VERIFY_KANA);
});

test("engines: the default source language returns the base profile untouched", () => {
  assert.equal(sourceProfile(rmProfile), rmProfile);
  assert.equal(sourceProfile(rmProfile, "ja"), rmProfile);
  assert.equal(sourceProfile(rmProfile).prompt.task("Simplified Chinese"), rmProfile.prompt.task("Simplified Chinese"));
});

test("engines: an English source profile keeps the grammar and renames the source", () => {
  const profile = sourceProfile(rmProfile, "en");
  assert.notEqual(profile, rmProfile);
  assert.equal(profile.sourceLanguage, "en");
  assert.equal(profile.grammar, rmProfile.grammar);
  assert.equal(profile.slots, rmProfile.slots);
  assert.equal(
    profile.prompt.task("Simplified Chinese"),
    "You translate RPG Maker MZ game text from English into Simplified Chinese."
  );
  // The base profile is not mutated by building a derived one.
  assert.equal(rmProfile.sourceLanguage, undefined);
  assert.equal(
    rmProfile.prompt.task("Simplified Chinese"),
    "You translate RPG Maker MZ game text from Japanese into Simplified Chinese."
  );
  assert.equal(profile.validate.isUntranslated("Hello"), true);
  assert.equal(profile.verify.residualKind, "source");
  assert.equal(profile.verify.sourceName, "English");
});

test("engines: an unknown source language is rejected before the profile is built", () => {
  assert.throws(() => sourceProfile(rmProfile, "fr"), RangeError);
});
