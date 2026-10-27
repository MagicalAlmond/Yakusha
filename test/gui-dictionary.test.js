/**
 * The GUI dictionary editor seam: readDictionary()/writeEntry() reuse
 * src/core/dict.js exactly as the CLI does, so a damaged file fails with the
 * same wording, and one entry write round-trips through the real format.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readDictionary, writeEntry } from "../gui/dictionary.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, "fixtures", "mini-mz");

/** A private copy of the fixture with a small synthetic dictionary. */
function tempDictGame() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-dict-"));
  const game = path.join(dir, "game");
  fs.cpSync(FIXTURE, game, { recursive: true });
  fs.rmSync(path.join(game, "yakusha"), { recursive: true, force: true });
  const dict = {
    format: "yakusha/1",
    source: "test",
    entries: {
      "Hello world": { text: "", contexts: ["game/script.rpy:1"] },
      "Second entry": { text: "第二", contexts: [] },
      "Legacy string form": "旧式字符串",
    },
  };
  fs.mkdirSync(path.join(game, "yakusha"));
  fs.writeFileSync(path.join(game, "yakusha", "dictionary.json"), JSON.stringify(dict, null, 2) + "\n");
  return game;
}

test("readDictionary lists entries sorted with pending flags", () => {
  const game = tempDictGame();
  const result = readDictionary(game);
  assert.equal(result.ok, undefined);
  assert.equal(result.entries.length, 3);
  assert.deepEqual(result.entries.map((entry) => entry.key),
    ["Hello world", "Legacy string form", "Second entry"].sort());
  assert.equal(result.pendingCount, 1);
  assert.equal(result.translated, 2);
  const legacy = result.entries.find((entry) => entry.key === "Legacy string form");
  assert.equal(legacy.text, "旧式字符串");
  assert.deepEqual(legacy.contexts, []);
});

test("readDictionary on a project without a dictionary throws E_NO_DICTIONARY", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-dict-none-"));
  assert.throws(() => readDictionary(dir), (error) => error.code === "E_NO_DICTIONARY");
});

test("readDictionary reports a damaged file as E_DICTIONARY", () => {
  const game = tempDictGame();
  fs.writeFileSync(path.join(game, "yakusha", "dictionary.json"), "{not json");
  assert.throws(() => readDictionary(game), (error) => error.code === "E_DICTIONARY");
});

test("writeEntry updates one entry and keeps the rest byte-faithful", () => {
  const game = tempDictGame();
  const result = writeEntry(game, "Hello world", "你好");
  assert.equal(result.key, "Hello world");
  assert.equal(result.translated, 3);
  assert.equal(result.pendingCount, 0);
  const onDisk = JSON.parse(fs.readFileSync(path.join(game, "yakusha", "dictionary.json"), "utf8"));
  assert.equal(onDisk.entries["Hello world"].text, "你好");
  assert.deepEqual(onDisk.entries["Hello world"].contexts, ["game/script.rpy:1"]);
  assert.equal(onDisk.entries["Second entry"].text, "第二");
});

test("writeEntry rejects unknown keys and non-string text with E_USAGE", () => {
  const game = tempDictGame();
  assert.throws(() => writeEntry(game, "missing", "x"), (error) => error.code === "E_USAGE");
  assert.throws(() => writeEntry(game, "Hello world", 42), (error) => error.code === "E_USAGE");
});

test("writeEntry without a dictionary throws E_NO_DICTIONARY", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-dict-none2-"));
  assert.throws(() => writeEntry(dir, "k", "v"), (error) => error.code === "E_NO_DICTIONARY");
});
