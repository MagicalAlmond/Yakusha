/**
 * End-to-end pipeline walk through the GUI handler seam, one per runnable
 * engine tier. The GUI main process calls exactly runGuiCommand(), so a walk
 * that passes here exercises every command the shell buttons fire, in order,
 * on synthetic projects. What this cannot cover is the Electron window
 * itself (clicks, focus, rendering) — that stays with the real-machine
 * walkthrough noted in docs/gui.md §9.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runGuiCommand } from "../gui/handlers.js";
import { writeRgssProject } from "./rgss-fixture.js";
import { nativeAssets } from "./rgss-native-fixture.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MZ_FIXTURE = path.join(HERE, "fixtures", "mini-mz");
const RENPY_FIXTURE = path.join(HERE, "fixtures", "renpy-extract", "rpy");
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-gui-e2e-config-"));
process.env.YAKUSHA_CONFIG_DIR = CONFIG_DIR;
/** Copy a fixture tree into a fresh temp dir and hand back the project root. */
function copyProject(source, layout) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-gui-e2e-"));
  if (layout === "rgss") {
    // RGSS: generate a synthetic project in the temp dir.
    writeRgssProject(dir);
    return dir;
  }
  if (layout === "wrapped") {
    // mini-mz: the fixture root IS the game directory (js/ + data/ inside), so the
    // copy goes under <root>/game/ and the project root stays the wrapper.
    const game = path.join(dir, "game");
    fs.cpSync(source, game, { recursive: true });
    fs.rmSync(path.join(game, "yakusha"), { recursive: true, force: true });
    return dir;
  }
  // Flat copy: the fixture root already IS the project (Ren'Py keeps its own game/).
  fs.cpSync(source, dir, { recursive: true });
  fs.rmSync(path.join(dir, "yakusha"), { recursive: true, force: true });
  return dir;
}

/** The walk the GUI buttons perform, in the order a user would click them. */
async function walkPipeline(root, extra) {
  const steps = [];
  const step = async (name, command, args, flags) => {
    const envelope = await runGuiCommand(command, args || [root], { flags: flags || {} });
    steps.push({ name, ok: envelope.ok, outcome: envelope.outcome, code: envelope.error ? envelope.error.code : null });
    return envelope;
  };
  const scan = await step("scan", "scan");
  assert.equal(scan.ok, true);
  const extract = await step("extract", "extract");
  assert.equal(extract.ok, true);
  assert.ok(extract.added > 0, "extract must find strings");
  if (extra && extra.translate) {
    const translate = await step("translate", "translate", [root], { "dry-run": true });
    assert.equal(translate.ok, true);
    assert.equal(translate.dryRun, true);
    assert.ok(translate.total > 0, "dry run must see pending entries");
    assert.equal(translate.translated, translate.total);
  }
  const doctor = await step("doctor", "doctor");
  return { steps, scan, extract, doctor };
}

test("MZ pipeline: scan → extract → translate (dry run) → install → uninstall → doctor", async () => {
  const root = copyProject(MZ_FIXTURE, "wrapped");
  const { steps, scan, extract, doctor } = await walkPipeline(root, { translate: true });
  // install/uninstall after translate so --embed-style state exists; plain install
  // registers the plugin and uninstall removes it (plugin tier).
  const install = await runGuiCommand("install", [root], { flags: {} });
  assert.equal(install.ok, true, "install should succeed on MZ");
  assert.equal(install.state, "added");
  const uninstall = await runGuiCommand("uninstall", [root], { flags: {} });
  assert.equal(uninstall.ok, true);
  assert.equal(uninstall.removed, true);
  const doctor2 = await runGuiCommand("doctor", [root], { flags: {} });
  assert.equal(doctor2.ok, true);
  assert.match(scan.engine, /^mz$/);
  assert.ok(extract.added > 0);
  assert.ok(steps.every((s) => s.ok), "every step must pass: " + JSON.stringify(steps));
});

test("Ren'Py pipeline: scan → extract → translate (dry run) → install → uninstall", async () => {
  const root = copyProject(RENPY_FIXTURE, "flat");
  const scan = await runGuiCommand("scan", [root], { flags: {} });
  assert.equal(scan.ok, true);
  assert.equal(scan.engine, "renpy");
  // capabilities: runtime === "translation" — install must NOT be grayed out,
  // so the walk exercises the real translation-file delivery.
  assert.equal(scan.capabilities.runtime, "translation");
  const extract = await runGuiCommand("extract", [root], { flags: {} });
  assert.equal(extract.ok, true);
  assert.ok(extract.added > 0, "renpy extract must find the fixture strings");
  // A real (mock-provider) translate: install requires translated entries, and the
  // translation tier writes the ones the dictionary actually holds.
  const translate = await runGuiCommand("translate", [root], { flags: { provider: "mock" } });
  assert.equal(translate.ok, true);
  assert.equal(translate.translated, translate.total);
  assert.equal(translate.cancelled, false);
  const install = await runGuiCommand("install", [root], { flags: {} });
  assert.equal(install.ok, true, "renpy install (translation tier) should succeed");
  assert.ok(fs.existsSync(path.join(root, "game", "yakusha_translation.rpy")),
    "translation file must exist after install");
  const uninstall = await runGuiCommand("uninstall", [root], { flags: {} });
  assert.equal(uninstall.ok, true);
  assert.equal(fs.existsSync(path.join(root, "game", "yakusha_translation.rpy")), false,
    "translation file must be gone after uninstall");
});

test("RGSS pipeline: scan → extract → install --native → doctor", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-gui-e2e-"));
  writeRgssProject(dir);
  process.env.YAKUSHA_NATIVE_ASSETS = nativeAssets().dir;
  const scan = await runGuiCommand("scan", [dir], { flags: {} });
  assert.equal(scan.ok, true);
  assert.equal(scan.engine, "rgss");
  // capabilities: runtime === "inject" — the GUI keeps install enabled, and the
  // native flag is what the handler receives when that button is used.
  assert.equal(scan.capabilities.runtime, "inject");
  const extract = await runGuiCommand("extract", [dir], { flags: {} });
  assert.equal(extract.ok, true);
  assert.ok(extract.added > 0);
  const plain = await runGuiCommand("install", [dir], { flags: {} });
  assert.equal(plain.ok, false);
  assert.equal(plain.error.code, "E_USAGE");
  const install = await runGuiCommand("install", [dir], { flags: { native: true } });
  assert.equal(install.ok, true);
  assert.equal(install.state, "added");
  const doctor = await runGuiCommand("doctor", [dir], { flags: {} });
  assert.equal(doctor.ok, true);
  assert.equal(doctor.verdict, "usable");
});