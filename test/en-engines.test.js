/**
 * English source-language tests for every engine adapter.
 *
 * Each engine is exercised end to end with synthetic English fixtures:
 * detection, scan, extraction, translation through a mock provider and
 * verification. The Japanese default must keep working exactly as before.
 */

import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { detectProject, getAdapter } from "../src/engines/registry.js";
import { dictionaryPath, loadDictionary } from "../src/core/dict.js";
import { sourceProfile } from "../src/engines/language-pair.js";
import {
  DEFAULT_SOURCE_LANGUAGE,
  SOURCE_LANGUAGES,
  sourceLanguage,
} from "../src/languages/index.js";
import { mockProvider } from "../src/pipeline/provider.js";
import { translateDictionary } from "../src/pipeline/translate.js";
import { verifyDictionary } from "../src/pipeline/verify.js";
import rgssFixture from "./rgss-fixture.js";
import { EN_KS_SENTENCES, writeEnKrkrProject } from "./en-fixtures.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, "fixtures");

const KANA = /[\u3041-\u3096\u30a1-\u30fa]/;

const tempDirs = [];

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-en-engines-"));
  tempDirs.push(dir);
  return dir;
}

function copyGame(fixture) {
  const dir = path.join(tempDir(), "game");
  fs.cpSync(fixture, dir, { recursive: true });
  return dir;
}

function rgssGame() {
  const root = path.join(tempDir(), "game");
  fs.mkdirSync(root, { recursive: true });
  return rgssFixture.writeRgssProject(root, { version: 3 });
}

function krkrGame() {
  return writeEnKrkrProject(tempDir()).root;
}

/**
 * One synthetic English project per engine.
 *
 * "expected" strings must show up as dictionary keys after extraction;
 * "forbidden" strings must never be collected.
 */
const CASES = [
  {
    id: "mz",
    build: () => copyGame(path.join(FIXTURES, "mini-mz-en")),
    title: "Synthetic Quest",
    expected: [
      "Synthetic Quest",
      "On the road we came to an old bridge.",
      "You do not have enough money!",
      "Fight",
    ],
  },
  {
    id: "mv",
    build: () => copyGame(path.join(FIXTURES, "mini-mv-en")),
    title: "Synthetic Quest",
    expected: ["Synthetic Quest", "Harbor Town", "Welcome to the harbor town."],
  },
  {
    id: "renpy",
    build: () => copyGame(path.join(FIXTURES, "renpy-en")),
    title: "Synthetic Story",
    expected: [
      "Faded lettering.",
      "The harbor bell rings twice.",
      "What should we do?",
      "Take the road.",
      "A short sign.",
      "Harbor notice: no boats today.",
    ],
  },
  {
    id: "rgss",
    build: rgssGame,
    title: "Synthetic Quest",
    expected: [
      "This room exists only for the tests.",
      "Open the door",
      "Fight",
      "Test Potion",
    ],
  },
  {
    id: "krkr",
    build: krkrGame,
    expected: EN_KS_SENTENCES,
    forbidden: [
      "engine code must never be collected",
      "f.synthetic = 1;",
      "a comment line the extractor must skip",
      "scene_one",
    ],
  },
];

/**
 * Detect a case, extract it into its dictionary and return everything the
 * assertions need.
 *
 * @param {typeof CASES[number]} testCase
 */
function extractCase(testCase) {
  const root = testCase.build();
  const adapter = getAdapter(testCase.id);
  const detected = adapter.detect(root);
  assert.equal(detected.ok, true, testCase.id + " detect: " + JSON.stringify(detected));
  const project = detected.project;
  const payload = adapter.scan(project);
  const result = adapter.extract(project);
  const dictionary = loadDictionary(result.file);
  return { adapter, project, payload, result, dictionary, root };
}

after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

for (const testCase of CASES) {
  test(testCase.id + ": detects and scans the English fixture", () => {
    const { adapter, project, payload, root } = extractCase(testCase);
    assert.equal(project.engine, testCase.id);
    assert.equal(payload.engine, testCase.id);
    assert.ok(payload.totalStrings > 0, "totalStrings");
    assert.ok(payload.uniqueStrings > 0, "uniqueStrings");
    assert.ok(payload.totalStrings >= payload.uniqueStrings);
    assert.ok(payload.dataFiles > 0, "dataFiles");
    assert.deepEqual(payload.undecodable, []);
    if (testCase.title) assert.equal(payload.gameTitle, testCase.title);

    const viaRegistry = detectProject(root);
    assert.equal(viaRegistry.ok, true);
    assert.equal(viaRegistry.adapter.id, testCase.id);
    assert.equal(viaRegistry.project.root, project.root);
    assert.equal(adapter.profile.id.length > 0, true);
  });

  test(testCase.id + ": extracts the English text into the dictionary", () => {
    const { project, result, dictionary } = extractCase(testCase);
    assert.equal(result.file, dictionaryPath(project.root));
    assert.ok(result.added > 0, "added");
    assert.ok(result.total > 0, "total");
    const keys = Object.keys(dictionary.entries);
    for (const expected of testCase.expected) {
      assert.ok(keys.includes(expected), testCase.id + " extracts: " + expected);
    }
    for (const forbidden of testCase.forbidden || []) {
      assert.equal(keys.includes(forbidden), false, testCase.id + " must not collect: " + forbidden);
    }
    for (const key of keys) {
      assert.doesNotMatch(key, KANA, testCase.id + " fixture must be kana free: " + key);
    }
    // Running extraction twice must not duplicate entries.
    const second = getAdapter(testCase.id).extract(project);
    assert.equal(second.added, 0);
    assert.equal(Object.keys(loadDictionary(result.file).entries).length, keys.length);
  });

  test(testCase.id + ": translates English with no kana in the target", async () => {
    const { adapter, project, result } = extractCase(testCase);
    const dictionary = loadDictionary(result.file);
    const translated = await translateDictionary(dictionary, {
      provider: mockProvider(),
      profile: adapter.profile,
      sourceLanguage: "en",
    });
    assert.ok(translated.total > 0, "total");
    assert.ok(translated.translated > 0, "translated");
    let checked = 0;
    for (const entry of Object.values(dictionary.entries)) {
      if (!entry.text) continue;
      assert.doesNotMatch(entry.text, KANA, testCase.id + " target: " + entry.text);
      checked += 1;
    }
    assert.ok(checked > 0, "checked entries");
  });

  test(testCase.id + ": en verification reports untranslated English as source", () => {
    const { adapter, project, result } = extractCase(testCase);
    const dictionary = loadDictionary(result.file);
    for (const [key, entry] of Object.entries(dictionary.entries)) entry.text = key;

    const english = verifyDictionary(dictionary, {
      profile: adapter.profile,
      sourceLanguage: "en",
    });
    assert.ok(english.counts.source > 0, "counts.source: " + JSON.stringify(english.counts));
    assert.equal(english.counts.kana || 0, 0, "en must not use the kana rule");
    const problem = english.problems.find((item) => item.kind === "source");
    assert.ok(problem, "source problem");
    assert.equal(problem.detail, "English text left in the translation");

    // Japanese stays the default and keeps its kana rule.
    for (const [key, entry] of Object.entries(dictionary.entries)) entry.text = "テスト";
    const japanese = verifyDictionary(dictionary, { profile: adapter.profile });
    assert.ok(japanese.counts.kana > 0, "counts.kana: " + JSON.stringify(japanese.counts));
    assert.equal(japanese.counts.source || 0, 0, "ja must not use the source rule");
  });
}

test("language registry: en is registered and ja stays the default", () => {
  assert.deepEqual(SOURCE_LANGUAGES, ["ja", "en"]);
  assert.equal(DEFAULT_SOURCE_LANGUAGE, "ja");
  assert.equal(sourceLanguage("en").ID, "en");
  assert.equal(sourceLanguage("en").NAME, "English");

  const adapter = getAdapter("mz");
  assert.equal(sourceProfile(adapter.profile), adapter.profile);
  assert.equal(sourceProfile(adapter.profile, "ja"), adapter.profile);
  const english = sourceProfile(adapter.profile, "en");
  assert.equal(english.sourceLanguage, "en");
  assert.match(english.prompt.task("Simplified Chinese"), /from English/);
  assert.equal(adapter.profile.prompt.task("Simplified Chinese").includes("from Japanese"), true);
});
