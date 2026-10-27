/**
 * Cooperative cancellation for long translate runs.
 *
 * The GUI stops a run through an AbortSignal handed to runCommand(); the
 * pipeline stops claiming new batches, in-flight requests finish, and the
 * result reports cancelled: true with whatever was already translated kept.
 * The CLI never cancels, so its cancelled flag is always false.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { emptyDictionary, saveDictionary } from "../src/core/dict.js";
import { translateDictionary } from "../src/pipeline/translate.js";
import { runCommand } from "../src/cli/runner.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-cancel-config-"));
// The runner reads the same environment the CLI does.
process.env.YAKUSHA_CONFIG_DIR = CONFIG_DIR;

/** @returns {import("../src/core/dict.js").Dictionary} */
function dictOf(count) {
  const d = emptyDictionary("test");
  for (let i = 0; i < count; i++) {
    d.entries["key" + String(i).padStart(3, "0")] = { text: "", contexts: [] };
  }
  return d;
}

test("pipeline: aborting the signal stops new batches and reports cancelled", async () => {
  const dict = dictOf(6);
  let completed = 0;
  const provider = {
    name: "counting",
    async complete() {
      completed += 1;
      // Abort after the first batch finished: the worker loop checks the
      // signal before claiming the next batch.
      if (completed === 1) controller.abort();
      return JSON.stringify({
        translations: [{ i: 0, t: "out" }],
      });
    },
  };
  const controller = new AbortController();
  const result = await translateDictionary(dict, { provider, batchSize: 1, concurrency: 1, signal: controller.signal });
  assert.equal(result.cancelled, true);
  assert.equal(completed, 1, "in-flight batch finishes, no further batch starts");
  assert.equal(result.translated, 1, "the batch that finished stays translated");
  assert.equal(result.total, 6);
});

test("pipeline: no signal means cancelled stays false", async () => {
  const dict = dictOf(2);
  const provider = { name: "echo", async complete(context) {
    const payload = JSON.parse(context.userPrompt);
    return JSON.stringify({ translations: payload.items.map((item) => ({ i: item.i, t: "out" })) });
  } };
  const result = await translateDictionary(dict, { provider, batchSize: 1 });
  assert.equal(result.cancelled, false);
  assert.equal(result.translated, 2);
});

test("pipeline: a signal that never fires behaves exactly like no signal", async () => {
  const dict = dictOf(4);
  const provider = { name: "echo", async complete(context) {
    const payload = JSON.parse(context.userPrompt);
    return JSON.stringify({ translations: payload.items.map((item) => ({ i: item.i, t: "out" })) });
  } };
  const result = await translateDictionary(dict, { provider, batchSize: 1, signal: new AbortController().signal });
  assert.equal(result.cancelled, false);
  assert.equal(result.translated, 4);
});

// ---- runner seam: the GUI stop button path ----

const FIXTURE = path.join(HERE, "fixtures", "mini-mz");

/**
 * A throwaway copy of the mini MZ fixture with its dictionary replaced by one
 * holding N pending entries, so a mocked provider has a deterministic job.
 * @returns {string} the game root
 */
function tempProject(entries) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-cancel-run-"));
  const game = path.join(dir, "game");
  fs.cpSync(FIXTURE, game, { recursive: true });
  fs.rmSync(path.join(game, "yakusha"), { recursive: true, force: true });
  const dict = emptyDictionary("test");
  for (let i = 0; i < entries; i++) {
    dict.entries["key" + String(i).padStart(3, "0")] = { text: "", contexts: [] };
  }
  saveDictionary(path.join(game, "yakusha", "dictionary.json"), dict);
  return game;
}

test("runner: runCommand forwards the signal and reports cancelled in the payload", async () => {
  const game = tempProject(6);
  const controller = new AbortController();
  const done = await runCommand("translate", [game], {
    flags: { provider: "mock" },
    signal: controller.signal,
  });
  assert.equal(done.outcome, "ok");
  assert.equal(done.payload.cancelled, false, "a non-aborted run is a normal run");
  assert.equal(done.payload.translated, 6);
});


test("runner: an aborted signal stops the run mid-flight and keeps progress", async () => {
  const game = tempProject(6);
  const controller = new AbortController();
  // The mock provider translates everything it is handed, so the only way
  // to stop early is the signal. The progress hook fires once per finished
  // batch; aborting on the first finished batch makes the worker loop stop
  // claiming the next one.
  const done = await runCommand("translate", [game], {
    flags: { provider: "mock", "batch-size": 2, concurrency: 1 },
    signal: controller.signal,
    onProgress: (progress) => {
      if (progress.done > 0) controller.abort();
    },
  });
  assert.equal(done.outcome, "ok");
  assert.equal(done.payload.cancelled, true);
  assert.ok(done.payload.translated < done.payload.total, "stopped before finishing: " + done.payload.translated + "/" + done.payload.total);
  assert.ok(done.payload.translated > 0, "finished batches are kept");
  // Whatever was translated is already on disk (saveEvery / final save).
  const saved = JSON.parse(fs.readFileSync(path.join(game, "yakusha", "dictionary.json"), "utf8"));
  const translatedCount = Object.values(saved.entries).filter((e) => e.text !== "").length;
  assert.equal(translatedCount, done.payload.translated);
});

