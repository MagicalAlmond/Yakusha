import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getAdapter, getAdapters, detectProject } from "../src/engines/registry.js";
import { diagnose } from "../src/core/doctor.js";
import { dictionaryPath, loadDictionary, saveDictionary } from "../src/core/dict.js";
import { TRANSLATION_FILE, translationPath } from "../src/engines/renpy/runtime.js";
import { renpyProfile } from "../src/engines/renpy/profile.js";
import { rmProfile } from "../src/engines/profile.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, "fixtures", "renpy-extract");

/**
 * Directories created by the tests, removed once the file has finished.
 *
 * @type {string[]}
 */
const created = [];

/**
 * Copy one fixture project into a throwaway directory.
 *
 * The adapter writes into the project (dictionary, translation file), so every
 * test that mutates works on a copy and the committed fixtures stay untouched.
 *
 * @param {string} name fixture directory under fixtures/renpy-extract
 * @returns {string} absolute root of the copy
 */
function sandbox(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-renpy-adapter-"));
  created.push(dir);
  const root = path.join(dir, name);
  fs.cpSync(path.join(FIXTURES, name), root, { recursive: true });
  return root;
}

/**
 * Detect a sandboxed fixture and return both halves the CLI works with.
 *
 * @param {string} name fixture directory name
 * @returns {{ root: string, project: object, adapter: object }}
 */
function projectFor(name) {
  const root = sandbox(name);
  const result = detectProject(root);
  assert.equal(result.ok, true, "fixture " + name + " should be detected");
  return { root, project: result.project, adapter: result.adapter };
}

/**
 * Extract, then fill every entry with a target so install has something to
 * deliver. The target text is deliberately synthetic: no fixture text is ever
 * translated in this repository.
 *
 * @param {{ root: string }} project
 * @param {object} adapter
 * @returns {Record<string, string>} the source→target map that was written
 */
function translateAll(project, adapter) {
  adapter.extract(project);
  const file = dictionaryPath(project.root);
  const dictionary = loadDictionary(file);
  const pairs = {};
  for (const key of Object.keys(dictionary.entries)) {
    dictionary.entries[key].text = "T:" + key;
    pairs[key] = dictionary.entries[key].text;
  }
  saveDictionary(file, dictionary);
  return pairs;
}

after(() => {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
});

test("the registry ships Ren'Py last, with its own profile and runtime tier", () => {
  assert.deepEqual(
    getAdapters().map((adapter) => adapter.id),
    ["mz", "mv", "renpy"]
  );
  const adapter = getAdapter("renpy");
  assert.equal(adapter.name, "Ren'Py");
  assert.equal(adapter.profile, renpyProfile);
  assert.notEqual(adapter.profile, rmProfile);
  assert.equal(adapter.rules.controlCodes, true);
  // There is no plugin system: delivery is one generated translation script.
  assert.equal(adapter.capabilities.runtime, "translation");
  assert.equal(adapter.capabilities.extract, true);
  assert.equal(adapter.capabilities.export, true);
  assert.equal(adapter.capabilities.launch, true);
  // Ren'Py scripts are not obfuscated and nothing is injected, so there is no
  // debug mode to switch on.
  assert.equal(adapter.capabilities.debuggable, false);
  assert.equal(adapter.capabilities.attach, false);
  assert.equal(adapter.capabilities.liveReload, false);
  // The CLI labels the size line from this, not from a hardcoded "data files".
  assert.equal(adapter.dataUnit, "scripts");
  assert.equal(typeof adapter.diagnostics, "function");
});

test("detect: a Ren'Py project is found from the root, game/ and above", () => {
  const root = sandbox("rpy");
  const adapter = getAdapter("renpy");
  const fromRoot = adapter.detect(root);
  assert.equal(fromRoot.ok, true);
  assert.equal(fromRoot.project.engine, "renpy");
  assert.equal(fromRoot.project.root, path.resolve(root));
  assert.equal(fromRoot.project.gameDir, path.join(root, "game"));
  assert.equal(fromRoot.project.dataDir, "game");
  // Ren'Py has neither a plugin directory nor a plugin registry.
  assert.equal(fromRoot.project.pluginDir, null);
  assert.equal(fromRoot.project.pluginsFile, null);
  assert.equal(fromRoot.project.indexPath, null);

  const fromGame = adapter.detect(path.join(root, "game"));
  assert.equal(fromGame.project.root, fromRoot.project.root);
  const parent = path.dirname(root);
  const fromParent = adapter.detect(parent);
  assert.equal(fromParent.project.root, fromRoot.project.root);
});

test("detect: a directory without game/ scripts is E_NOT_PROJECT in Ren'Py wording", () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-renpy-adapter-empty-"));
  created.push(empty);
  const result = getAdapter("renpy").detect(empty);
  assert.equal(result.ok, false);
  assert.equal(result.code, "E_NOT_PROJECT");
  assert.match(result.message, /^not a Ren'Py project \(no game\/ directory with \.rpy or \.rpyc scripts found in /);
  // The registry must keep trying after this, so the prefix has to be the
  // generic one it recognises.
  const viaRegistry = detectProject(empty);
  assert.equal(viaRegistry.code, "E_NOT_PROJECT");
  assert.match(viaRegistry.message, /not an RPG Maker project/);
});

test("detect: two sibling Ren'Py projects are E_MULTI_ROOT with sorted candidates", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-renpy-adapter-multi-"));
  created.push(parent);
  for (const name of ["alpha", "beta"]) fs.cpSync(path.join(FIXTURES, "rpy"), path.join(parent, name), { recursive: true });
  const expected = [path.join(parent, "alpha"), path.join(parent, "beta")];

  const result = getAdapter("renpy").detect(parent);
  assert.equal(result.ok, false);
  assert.equal(result.code, "E_MULTI_ROOT");
  assert.match(result.message, /^found 2 Ren'Py projects under /);
  assert.deepEqual(result.candidates, expected);

  // The registry reports it without picking an adapter, exactly like RPG Maker.
  const viaRegistry = detectProject(parent);
  assert.equal(viaRegistry.code, "E_MULTI_ROOT");
  assert.deepEqual(viaRegistry.candidates, expected);
  assert.equal(Object.hasOwn(viaRegistry, "adapter"), false);
});

test("scan: the payload keeps the eleven contract keys", () => {
  const { project, adapter } = projectFor("rpy");
  const payload = adapter.scan(project);
  assert.deepEqual(Object.keys(payload).sort(), [
    "dataFiles",
    "encodings",
    "engine",
    "engineVersion",
    "gameTitle",
    "perFile",
    "root",
    "stringsWithControlCodes",
    "totalStrings",
    "undecodable",
    "uniqueStrings",
  ]);
  assert.equal(payload.engine, "renpy");
  assert.equal(payload.root, project.root);
  assert.equal(payload.uniqueStrings, 7);
  assert.equal(payload.totalStrings, 8);
  // dataFiles counts the scripts that were read, and encodings counts them per
  // format rather than per compression.
  assert.equal(payload.dataFiles, 2);
  assert.deepEqual(payload.encodings, { rpy: 2, rpyc: 0 });
  assert.deepEqual(payload.undecodable, []);
  assert.deepEqual(payload.perFile, { "game/script.rpy": 6, "game/sub/chapter.rpy": 2 });
});

test("scan: unreadable scripts are reported as one line per file", () => {
  const { project, adapter } = projectFor("broken");
  const payload = adapter.scan(project);
  assert.equal(payload.undecodable.length, 2);
  for (const line of payload.undecodable) assert.equal(typeof line, "string");
  assert.match(payload.undecodable[0], /^game\/broken\.rpyc: /);
  assert.match(payload.undecodable[1], /^game\/stray\.rpyc: /);
  // A broken file costs the project nothing else.
  assert.equal(payload.uniqueStrings, 2);
});

test("extract: the dictionary is created once and kept on the second run", () => {
  const { root, project, adapter } = projectFor("mixed");
  const first = adapter.extract(project);
  assert.equal(first.file, dictionaryPath(root));
  assert.equal(first.added, 10);
  assert.equal(first.total, 10);
  assert.equal(first.translated, 0);
  assert.equal(first.pending, 10);

  const second = adapter.extract(project);
  assert.equal(second.added, 0);
  assert.equal(second.total, 10);
});

test("install: the dictionary is delivered as one translation script", () => {
  const { root, project, adapter } = projectFor("rpy");
  const pairs = translateAll(project, adapter);

  const result = adapter.installRuntime(project);
  assert.equal(result.pluginPath, translationPath(project));
  assert.equal(result.pluginPath, path.join(root, "game", TRANSLATION_FILE));
  assert.equal(result.registered, true);
  assert.equal(result.backupPath, null);
  assert.equal(result.createdBackup, false);
  assert.equal(result.staleBackup, false);
  assert.equal(result.state, "added");
  assert.equal(result.entries, 7);
  assert.equal(result.language, "schinese");

  const content = fs.readFileSync(result.pluginPath, "utf8");
  assert.match(content, /^init python:\n    if config\.default_language is None:\n        config\.default_language = "schinese"\n/m);
  assert.match(content, /^translate schinese strings:\n/m);
  for (const [source, target] of Object.entries(pairs)) {
    assert.ok(content.includes('    old "' + source + '"'), "missing old line for " + source);
    assert.ok(content.includes('    new "' + target + '"'), "missing new line for " + source);
  }

  // Re-installing with the same dictionary rewrites nothing.
  const again = adapter.installRuntime(project);
  assert.equal(again.state, "unchanged");
  assert.equal(again.entries, 7);
});

test("install: a missing or untranslated dictionary is E_NO_DICTIONARY", () => {
  const { project, adapter } = projectFor("rpy");
  assert.throws(
    () => adapter.installRuntime(project),
    (error) => {
      assert.equal(error.code, "E_NO_DICTIONARY");
      assert.match(error.message, /no dictionary yet: /);
      return true;
    }
  );

  adapter.extract(project);
  assert.throws(
    () => adapter.installRuntime(project),
    (error) => {
      assert.equal(error.code, "E_NO_DICTIONARY");
      assert.match(error.message, /^the dictionary has no translated entries yet - run: yakusha translate <game>$/);
      return true;
    }
  );
});

test("install: the generated script is not counted as a source script", () => {
  const { project, adapter } = projectFor("rpy");
  const before = adapter.scan(project);
  translateAll(project, adapter);
  adapter.installRuntime(project);

  const after = adapter.scan(project);
  assert.equal(after.dataFiles, before.dataFiles);
  assert.equal(after.uniqueStrings, before.uniqueStrings);
  assert.equal(after.totalStrings, before.totalStrings);
  // doctor reads the same numbers through diagnostics, so they must agree.
  assert.equal(adapter.diagnostics(project).dataFiles, before.dataFiles);
});

test("uninstall: the translation script is the only thing removed", () => {
  const { root, project, adapter } = projectFor("rpy");
  translateAll(project, adapter);
  const installed = adapter.installRuntime(project);

  const result = adapter.uninstallRuntime(project);
  assert.deepEqual(result, {
    removed: true,
    restored: false,
    backupPath: null,
    drifted: false,
    keptBackup: null,
  });
  assert.equal(fs.existsSync(installed.pluginPath), false);
  // The dictionary is the user's work and survives uninstall.
  assert.equal(fs.existsSync(dictionaryPath(root)), true);

  const second = adapter.uninstallRuntime(project);
  assert.equal(second.removed, false);
});

test("uninstall: the game scripts are untouched by install and uninstall", () => {
  const { root, project, adapter } = projectFor("rpy");
  const snapshot = () => {
    const out = {};
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else out[path.relative(root, full)] = fs.readFileSync(full, "utf8");
      }
    };
    walk(path.join(root, "game"));
    return out;
  };

  const before = snapshot();
  translateAll(project, adapter);
  adapter.installRuntime(project);
  adapter.uninstallRuntime(project);
  assert.deepEqual(snapshot(), before);
});

test("attach: Ren'Py has no debug injection, and says so in the shared wording", () => {
  assert.throws(
    () => getAdapter("renpy").attach(),
    (error) => {
      assert.equal(error.code, "E_NOT_IMPLEMENTED");
      assert.equal(error.message, "attach is not implemented in 0.10");
      return true;
    }
  );
});

test("doctor: the delivered file is checked as install and runtime", () => {
  const { project, adapter } = projectFor("rpy");
  translateAll(project, adapter);
  const own = adapter.diagnostics(project);

  const before = diagnose(project, {
    dictionary: loadDictionary(dictionaryPath(project.root)),
    dictionaryFile: dictionaryPath(project.root),
    maxColumns: 0,
    engineLabel: adapter.name,
    profile: adapter.profile,
    extract: own.extract,
    dataFiles: own.dataFiles,
    sourceLabel: own.sourceLabel,
    delivery: own.translation,
  });
  assert.deepEqual(Object.keys(before).sort(), [
    "checks",
    "dictionary",
    "failure",
    "game",
    "install",
    "ok",
    "runtime",
    "sync",
    "verdict",
    "verify",
  ].sort());
  assert.equal(before.verdict, "not-installed");
  assert.equal(before.game.engine, "renpy");
  assert.equal(before.game.dataFiles, 2);
  const levels = Object.fromEntries(before.checks.map((check) => [check.id, check.level]));
  assert.equal(levels.install, "info");
  assert.equal(levels.runtime, "info");
  assert.equal(levels.dictionary, "ok");
  assert.equal(levels.sync, "ok");
  const syncCheck = before.checks.find((check) => check.id === "sync");
  assert.match(syncCheck.message, /every dictionary key still appears in game\//);

  adapter.installRuntime(project);
  const own2 = adapter.diagnostics(project);
  const installed = diagnose(project, {
    dictionary: loadDictionary(dictionaryPath(project.root)),
    dictionaryFile: dictionaryPath(project.root),
    maxColumns: 0,
    engineLabel: adapter.name,
    profile: adapter.profile,
    extract: own2.extract,
    dataFiles: own2.dataFiles,
    sourceLabel: own2.sourceLabel,
    delivery: own2.translation,
  });
  assert.equal(installed.verdict, "ready");
  assert.equal(installed.ok, true);
  assert.deepEqual(installed.install.entryParameters, { language: "schinese" });
  assert.equal(installed.install.pluginFilePresent, true);
  assert.equal(installed.runtime.found, translationPath(project));
  const installedChecks = Object.fromEntries(installed.checks.map((check) => [check.id, check.level]));
  assert.equal(installedChecks.install, "ok");
  assert.equal(installedChecks.runtime, "ok");
  assert.match(installed.runtime.path, /^game\/yakusha_translation\.rpy$/);
});
