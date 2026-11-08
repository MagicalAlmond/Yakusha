/**
 * The worker-thread seam under the GUI.
 *
 * `gui/main.js` no longer calls the runner directly: every command goes through
 * `gui/worker-host.js` to `gui/worker.js`. These tests exercise that real
 * protocol in plain Node (no Electron), including the envelope identity with
 * the in-process handler so a future refactor cannot silently change the shape
 * the renderer receives.
 */

import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runGuiCommand } from "../gui/handlers.js";
import { runGuiCommandInWorker } from "../gui/worker-host.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MZ_FIXTURE = path.join(HERE, "fixtures", "mini-mz");
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-gui-worker-config-"));
process.env.YAKUSHA_CONFIG_DIR = CONFIG_DIR;
const created = [CONFIG_DIR];

function tempProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-gui-worker-"));
  created.push(dir);
  const game = path.join(dir, "game");
  fs.cpSync(MZ_FIXTURE, game, { recursive: true });
  fs.rmSync(path.join(game, "yakusha"), { recursive: true, force: true });
  return dir;
}

after(() => {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
});

test("gui-worker: scan returns the same envelope as the in-process handler", async () => {
  const root = tempProject();
  const direct = await runGuiCommand("scan", [root], { flags: {} });
  const worker = await runGuiCommandInWorker("scan", [root], { flags: {} });
  assert.equal(worker.ok, true, JSON.stringify(worker));
  assert.equal(worker.command, "scan");
  assert.equal(worker.outcome, direct.outcome);
  assert.equal(worker.engine, direct.engine);
  assert.equal(worker.uniqueStrings, direct.uniqueStrings);
  assert.equal(worker.totalStrings, direct.totalStrings);
});

test("gui-worker: a translate run executes in the worker and reports its payload", async () => {
  const root = tempProject();
  const extracted = await runGuiCommandInWorker("extract", [root], { flags: {} });
  assert.equal(extracted.ok, true, JSON.stringify(extracted));
  assert.ok(extracted.added > 0);

  const progress = [];
  const translate = await runGuiCommandInWorker("translate", [root], {
    flags: { provider: "mock" },
    onProgress: (value) => progress.push(value),
  });
  assert.equal(translate.ok, true, JSON.stringify(translate));
  assert.equal(translate.cancelled, false);
  assert.ok(translate.translated > 0, "the mock provider should translate the fixture");
  assert.ok(progress.length > 0, "progress messages must cross the worker boundary");
  assert.ok(progress.every((value) => Number.isInteger(value.done) && Number.isInteger(value.total)));
});

test("gui-worker: a project error comes back as the documented envelope", async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-gui-worker-empty-"));
  created.push(empty);
  const envelope = await runGuiCommandInWorker("scan", [empty], { flags: {} });
  assert.equal(envelope.ok, false);
  assert.equal(envelope.outcome, "error");
  assert.equal(envelope.error.code, "E_NOT_PROJECT");
  assert.equal(envelope.schema, 1);
  assert.equal(typeof envelope.error.message, "string");
});

test("gui-worker: an unknown command is refused before it reaches the runner", async () => {
  const envelope = await runGuiCommandInWorker("format-c", [], { flags: {} });
  assert.equal(envelope.ok, false);
  assert.equal(envelope.error.code, "E_USAGE");
  assert.match(envelope.error.message, /unknown command: format-c/);
});
