/**
 * The dictionary reader/writer and the provenance fields added in 0.17
 * (engine/locator). Everything here is in-process: no CLI, no project.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { emptyDictionary, loadDictionary, recordExtracted, saveDictionary } from "../src/core/dict.js";

const created = [];

test.after(() => {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
});

function tempFile(entries, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-dict-"));
  created.push(dir);
  const file = path.join(dir, "dictionary.json");
  const document = { format: "yakusha/1", game: "Test", updatedAt: "2024-01-01T00:00:00.000Z", entries, ...extra };
  fs.writeFileSync(file, JSON.stringify(document, null, 2) + "\n", "utf8");
  return file;
}

test("load: engine and locator survive a load", () => {
  const file = tempFile({
    "Map001.json:401": {
      text: "译",
      contexts: ["Map001.json:401"],
      engine: "mz",
      locator: ["Map001.json#/events/1/pages/0/list/0/parameters/0"],
    },
  });
  const dict = loadDictionary(file);
  assert.deepEqual(dict.entries["Map001.json:401"], {
    text: "译",
    contexts: ["Map001.json:401"],
    engine: "mz",
    locator: ["Map001.json#/events/1/pages/0/list/0/parameters/0"],
  });
});

test("load: malformed provenance is dropped, never fatal", () => {
  const file = tempFile({
    a: { text: "一", contexts: [], engine: "", locator: [] },
    b: { text: "二", contexts: [], engine: 7, locator: "not-an-array" },
    c: { text: "三", contexts: [], locator: ["ok", "", 3] },
  });
  const dict = loadDictionary(file);
  assert.deepEqual(dict.entries.a, { text: "一", contexts: [] });
  assert.deepEqual(dict.entries.b, { text: "二", contexts: [] });
  assert.deepEqual(dict.entries.c, { text: "三", contexts: [], locator: ["ok"] });
});

test("save: a round-trip keeps every provenance field", () => {
  const file = tempFile({});
  const dict = emptyDictionary("Game");
  dict.entries["x"] = { text: "y", contexts: ["f:1"], engine: "krkr", locator: ["f:1"] };
  saveDictionary(file, dict);
  const reloaded = loadDictionary(file);
  assert.deepEqual(reloaded.entries.x, { text: "y", contexts: ["f:1"], engine: "krkr", locator: ["f:1"] });
  assert.equal(reloaded.format, "yakusha/1");
});

test("recordExtracted: a new key starts empty with engine and sorted locators", () => {
  const entries = {};
  const added = recordExtracted(
    entries,
    { text: "line", contexts: new Set(["f:2", "f:1"]), locators: new Set(["f#/b", "f#/a"]) },
    "renpy"
  );
  assert.equal(added, true);
  assert.deepEqual(entries.line, { text: "", contexts: ["f:1", "f:2"], engine: "renpy", locator: ["f#/a", "f#/b"] });
});

test("recordExtracted: an existing key keeps its translation and gains contexts", () => {
  const entries = { line: { text: "译文", contexts: ["old:1"], engine: "renpy" } };
  const added = recordExtracted(entries, { text: "line", contexts: new Set(["new:1"]), locators: new Set() }, "krkr");
  assert.equal(added, false);
  assert.deepEqual(entries.line, { text: "译文", contexts: ["old:1", "new:1"], engine: "renpy" });
});

test("recordExtracted: a re-extraction replaces locators instead of appending", () => {
  const entries = { line: { text: "译", contexts: ["f:1"], engine: "mz", locator: ["f#/old"] } };
  recordExtracted(entries, { text: "line", contexts: new Set(["f:1"]), locators: new Set(["f#/new"]) }, "mz");
  assert.deepEqual(entries.line.locator, ["f#/new"]);
});

test("emptyDictionary: starts at yakusha/1 with no entries", () => {
  const dict = emptyDictionary();
  assert.equal(dict.format, "yakusha/1");
  assert.equal(dict.game, null);
  assert.deepEqual(dict.entries, {});
});
