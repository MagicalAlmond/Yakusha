/**
 * Engine adapter contract (docs/engines.md §12).
 *
 * Both engines must behave the same through the adapter shape: detection never
 * throws for an expected failure, scan/extract/install are engine-neutral, and
 * the CLI learns the engine from the registry rather than from openProject.
 */

import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { getAdapters, getAdapter, detectProject } from "../src/engines/registry.js";
import { isInstalled } from "../src/core/install.js";
import { parsePluginsJs, serialisePluginsJs, pluginsJsLayout } from "../src/core/pluginsfile.js";
import { loadDictionary, dictionaryPath } from "../src/core/dict.js";
import { VERSION } from "../src/version.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const FIXTURES = path.join(HERE, "fixtures");
const MZ = path.join(FIXTURES, "mini-mz");
const MV = path.join(FIXTURES, "mini-mv");

const tempDirs = [];

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-engines-"));
  tempDirs.push(dir);
  return dir;
}

function copyGame(fixture) {
  const dir = path.join(tempDir(), "game");
  fs.cpSync(fixture, dir, { recursive: true });
  return dir;
}

function gameFor(engine) {
  return copyGame(engine === "mz" ? MZ : MV);
}

function snapshot(dir) {
  const out = {};
  function walk(current, rel) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const key = rel ? path.join(rel, entry.name) : entry.name;
      if (entry.isDirectory()) walk(full, key);
      else if (entry.isFile()) out[key] = fs.readFileSync(full, "utf8");
    }
  }
  walk(dir, "");
  return out;
}

// The RPG Maker engines. Ren'Py and RGSS share the adapter shape but not the
// fixture layout, the plugin registry or the install semantics, so the cases
// that are about RPG Maker stay written against these two and the other engines
// have their own contract files (test/renpy-adapter.test.js, test/rgss-adapter.test.js).
const ENGINES = [
  { id: "mz", version: "1.7.0" },
  { id: "mv", version: "1.6.2" },
];

/** Every adapter the registry ships, ids only. */
const ALL_ENGINES = ["mz", "mv", "renpy", "rgss", "krkr"];

/** The delivery tier each engine ships, keyed by id: null means "not yet". */
const RUNTIME_TIERS = { mz: "plugin", mv: "plugin", renpy: "translation", rgss: null, krkr: null };

after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

test("registry: adapters are ordered and capabilities are complete", () => {
  const adapters = getAdapters();
  assert.deepEqual(adapters.map((adapter) => adapter.id), ALL_ENGINES);
  for (const adapter of adapters) {
    assert.equal(typeof adapter.name, "string");
    for (const name of ["extract", "export", "runtime", "launch", "debuggable", "attach", "liveReload"]) {
      assert.ok(Object.hasOwn(adapter.capabilities, name), adapter.id + " capability " + name);
    }
    assert.equal(adapter.capabilities.extract, true);
    assert.equal(adapter.capabilities.export, true);
    // Delivery differs per engine: RPG Maker ships a plugin plus a dictionary
    // file, Ren'Py a generated translation script, and RGSS and Kirikiri have
    // no delivery layer yet, which they say by reporting null instead of a
    // guessed tier.
    assert.equal(adapter.capabilities.runtime, RUNTIME_TIERS[adapter.id], adapter.id + " runtime tier");
    assert.equal(adapter.capabilities.launch, true);
    assert.equal(adapter.capabilities.attach, false);
    assert.equal(adapter.capabilities.liveReload, false);
    assert.deepEqual(adapter.rules, { controlCodes: true, maxColumns: 0 });
    for (const method of ["detect", "scan", "extract", "installRuntime", "uninstallRuntime", "launch", "attach"]) {
      assert.equal(typeof adapter[method], "function", adapter.id + " " + method);
    }
  }
  assert.equal(getAdapter("mz").capabilities.debuggable, true);
  assert.equal(getAdapter("mv").capabilities.debuggable, false);
  assert.equal(getAdapter("nope"), null);
  const copy = getAdapters();
  copy.length = 0;
  assert.equal(getAdapters().length, ALL_ENGINES.length);
});

test("detect: an empty directory is E_NOT_PROJECT for every engine", () => {
  const empty = tempDir();
  const expected = {
    mz: /not an RPG Maker project/,
    mv: /not an RPG Maker project/,
    renpy: /not a Ren'Py project/,
    rgss: /not an RGSS project/,
    krkr: /not a Kirikiri project/,
  };
  for (const adapter of getAdapters()) {
    const result = adapter.detect(empty);
    assert.equal(result.ok, false);
    assert.equal(result.code, "E_NOT_PROJECT");
    assert.match(result.message, expected[adapter.id]);
  }
});

test("detect: a root missing data/ or plugins.js keeps the old message", () => {
  for (const engine of ENGINES) {
    const missingData = gameFor(engine.id);
    fs.rmSync(path.join(missingData, "data"), { recursive: true, force: true });
    const dataResult = getAdapter(engine.id).detect(missingData);
    assert.equal(dataResult.code, "E_NOT_PROJECT");
    assert.match(dataResult.message, /^missing data\/ directory in /);
    const viaRegistry = detectProject(missingData);
    assert.equal(viaRegistry.code, "E_NOT_PROJECT");
    assert.match(viaRegistry.message, /^missing data\/ directory in /);

    const missingPlugins = gameFor(engine.id);
    fs.rmSync(path.join(missingPlugins, "js", "plugins.js"), { force: true });
    const pluginsResult = getAdapter(engine.id).detect(missingPlugins);
    assert.equal(pluginsResult.code, "E_NOT_PROJECT");
    assert.match(pluginsResult.message, /^missing js\/plugins\.js in /);
    const viaRegistryPlugins = detectProject(missingPlugins);
    assert.equal(viaRegistryPlugins.code, "E_NOT_PROJECT");
    assert.match(viaRegistryPlugins.message, /^missing js\/plugins\.js in /);
  }
});

test("detect: each adapter finds its own fixture", () => {
  for (const engine of ENGINES) {
    const game = gameFor(engine.id);
    const result = getAdapter(engine.id).detect(game);
    assert.equal(result.ok, true);
    assert.equal(result.project.engine, engine.id);
    assert.equal(result.project.root, path.resolve(game));
    assert.equal(result.project.version, engine.version);
    assert.equal(typeof result.project.gameTitle, "string");
    assert.equal(fs.existsSync(result.project.pluginsFile), true);
  }
});

test("detect: finds the same root from the game, its parent and above", () => {
  for (const engine of ENGINES) {
    const parent = tempDir();
    const nested = path.join(parent, "nested");
    const game = path.join(nested, "game");
    fs.cpSync(engine.id === "mz" ? MZ : MV, game, { recursive: true });
    const adapter = getAdapter(engine.id);
    const fromGame = adapter.detect(game);
    const fromNested = adapter.detect(nested);
    const fromParent = adapter.detect(parent);
    assert.equal(fromGame.ok, true);
    assert.equal(fromNested.ok, true);
    assert.equal(fromParent.ok, true);
    assert.equal(fromNested.project.root, fromGame.project.root);
    assert.equal(fromParent.project.root, fromGame.project.root);
  }
});

test("detect: idempotent and read-only", () => {
  for (const engine of ENGINES) {
    const game = gameFor(engine.id);
    const before = snapshot(game);
    const adapter = getAdapter(engine.id);
    const first = adapter.detect(game);
    const second = adapter.detect(game);
    assert.deepEqual(second, first);
    assert.deepEqual(snapshot(game), before);
  }
});

test("detect: two sibling projects are E_MULTI_ROOT with sorted candidates", () => {
  const parent = tempDir();
  for (const name of ["alpha", "beta"]) {
    fs.cpSync(MZ, path.join(parent, name), { recursive: true });
  }
  const expected = [path.join(parent, "alpha"), path.join(parent, "beta")];
  // Only the RPG Maker adapters can see this layout; Ren'Py reports its own
  // "not a project" and is covered in test/renpy-adapter.test.js.
  for (const adapter of ENGINES.map((engine) => getAdapter(engine.id))) {
    const result = adapter.detect(parent);
    assert.equal(result.ok, false);
    assert.equal(result.code, "E_MULTI_ROOT");
    assert.match(result.message, /^found 2 RPG Maker projects under /);
    assert.deepEqual(result.candidates, expected);
  }
  const viaRegistry = detectProject(parent);
  assert.equal(viaRegistry.ok, false);
  assert.equal(viaRegistry.code, "E_MULTI_ROOT");
  assert.deepEqual(viaRegistry.candidates, expected);
  assert.equal(Object.hasOwn(viaRegistry, "adapter"), false);
});

test("detect: an adapter rejects the other engine fixture", () => {
  const mzOnly = gameFor("mv");
  const mvOnly = gameFor("mz");
  const mzResult = getAdapter("mz").detect(mzOnly);
  const mvResult = getAdapter("mv").detect(mvOnly);
  assert.equal(mzResult.code, "E_NOT_PROJECT");
  assert.equal(mvResult.code, "E_NOT_PROJECT");
  assert.match(mzResult.message, /not an RPG Maker project/);
  assert.match(mvResult.message, /not an RPG Maker project/);
});

test("detectProject: succeeds with the matching adapter", () => {
  for (const engine of ENGINES) {
    const game = gameFor(engine.id);
    const result = detectProject(game);
    assert.equal(result.ok, true);
    assert.equal(result.adapter.id, engine.id);
    assert.equal(result.project.engine, engine.id);
  }
});

test("scan: payload matches the CLI contract for both engines", () => {
  for (const engine of ENGINES) {
    const game = gameFor(engine.id);
    const project = getAdapter(engine.id).detect(game).project;
    const payload = getAdapter(engine.id).scan(project);
    assert.equal(payload.root, path.resolve(game));
    assert.equal(payload.engine, engine.id);
    assert.equal(payload.engineVersion, engine.version);
    assert.equal(Object.hasOwn(payload, "version"), false);
    assert.ok(payload.uniqueStrings > 0);
    assert.ok(payload.totalStrings >= payload.uniqueStrings);
    assert.equal(typeof payload.gameTitle, "string");
    assert.equal(typeof payload.dataFiles, "number");
    assert.ok(payload.dataFiles >= 1);
    assert.equal(typeof payload.stringsWithControlCodes, "number");
    assert.equal(typeof payload.encodings, "object");
    assert.ok(Array.isArray(payload.undecodable));
    assert.equal(typeof payload.perFile, "object");
  }
});

test("capabilities: every adapter declares the frozen capability set", () => {
  const expected = {
    mz: { extract: true, export: true, runtime: "plugin", launch: true, debuggable: true, attach: false, liveReload: false },
    mv: { extract: true, export: true, runtime: "plugin", launch: true, debuggable: false, attach: false, liveReload: false },
    renpy: { extract: true, export: true, runtime: "translation", launch: true, debuggable: false, attach: false, liveReload: false },
    rgss: { extract: true, export: true, runtime: null, launch: true, debuggable: false, attach: false, liveReload: false },
    krkr: { extract: true, export: true, runtime: null, launch: true, debuggable: false, attach: false, liveReload: false },
  };
  for (const id of ALL_ENGINES) {
    assert.deepEqual(getAdapter(id).capabilities, expected[id], id + " capabilities");
  }
});

test("extract: creates the dictionary and only adds on a rerun", () => {
  for (const engine of ENGINES) {
    const game = gameFor(engine.id);
    const adapter = getAdapter(engine.id);
    const project = adapter.detect(game).project;
    const file = dictionaryPath(game);
    assert.equal(fs.existsSync(file), false);

    const first = adapter.extract(project);
    assert.ok(first.added > 0);
    assert.equal(first.total, first.added);
    assert.equal(first.translated, 0);
    assert.equal(first.pending, first.total);
    assert.equal(first.file, file);
    assert.equal(fs.existsSync(file), true);
    const dictionary = loadDictionary(file);
    assert.equal(Object.keys(dictionary.entries).length, first.total);

    const second = adapter.extract(project);
    assert.equal(second.added, 0);
    assert.equal(second.total, first.total);
    assert.equal(second.pending, first.pending);
  }
});

test("installRuntime/uninstallRuntime: reversible on both engines", () => {
  for (const engine of ENGINES) {
    const game = gameFor(engine.id);
    const adapter = getAdapter(engine.id);
    const project = adapter.detect(game).project;
    const pluginsFile = project.pluginsFile;
    const original = fs.readFileSync(pluginsFile, "utf8");
    const backup = pluginsFile + ".yakusha-backup";
    const pluginPath = path.join(project.pluginDir, "YAKUSHA_Translator.js");

    const first = adapter.installRuntime(project);
    assert.equal(first.registered, true);
    assert.equal(first.createdBackup, true);
    assert.equal(first.staleBackup, false);
    assert.equal(first.pluginPath, pluginPath);
    assert.equal(fs.existsSync(pluginPath), true);
    assert.equal(fs.existsSync(backup), true);
    const installed = isInstalled(project);
    assert.deepEqual(installed, { installed: true, registered: true, pluginPath });
    assert.equal(
      parsePluginsJs(fs.readFileSync(pluginsFile, "utf8")).plugins.filter((entry) => entry.name === "YAKUSHA_Translator").length,
      1
    );

    const second = adapter.installRuntime(project);
    assert.equal(second.createdBackup, false);
    assert.equal(second.state, "unchanged");
    assert.equal(
      parsePluginsJs(fs.readFileSync(pluginsFile, "utf8")).plugins.filter((entry) => entry.name === "YAKUSHA_Translator").length,
      1
    );

    const result = adapter.uninstallRuntime(project);
    assert.equal(result.removed, true);
    assert.equal(result.restored, true);
    assert.equal(result.drifted, false);
    assert.equal(fs.readFileSync(pluginsFile, "utf8"), original);
    assert.equal(fs.existsSync(pluginPath), false);
    assert.equal(fs.existsSync(backup), false);
  }
});

test("installRuntime: keeps CRLF plugins.js CRLF", () => {
  for (const engine of ENGINES) {
    const game = gameFor(engine.id);
    const adapter = getAdapter(engine.id);
    const project = adapter.detect(game).project;
    const crlf = fs.readFileSync(project.pluginsFile, "utf8").replace(/\r?\n/g, "\r\n");
    fs.writeFileSync(project.pluginsFile, crlf, "utf8");

    adapter.installRuntime(project);
    const written = fs.readFileSync(project.pluginsFile, "utf8");
    assert.equal(written.includes("\r\n"), true);
    assert.equal(written.replace(/\r\n/g, "").includes("\n"), false);

    adapter.uninstallRuntime(project);
    assert.equal(fs.readFileSync(project.pluginsFile, "utf8"), crlf);
  }
});

test("uninstallRuntime: drift keeps the backup and other edits", () => {
  const game = copyGame(MZ);
  const adapter = getAdapter("mz");
  const project = adapter.detect(game).project;
  adapter.installRuntime(project);

  const current = fs.readFileSync(project.pluginsFile, "utf8");
  const layout = pluginsJsLayout(current);
  const plugins = parsePluginsJs(current).plugins;
  plugins.push({ name: "OtherMod", status: true, description: "d", parameters: {} });
  fs.writeFileSync(project.pluginsFile, serialisePluginsJs(plugins, layout), "utf8");

  const result = adapter.uninstallRuntime(project);
  assert.equal(result.restored, false);
  assert.equal(result.drifted, true);
  assert.ok(result.keptBackup);
  assert.equal(fs.existsSync(result.keptBackup), true);
  const after = parsePluginsJs(fs.readFileSync(project.pluginsFile, "utf8")).plugins;
  assert.equal(after.some((entry) => entry.name === "YAKUSHA_Translator"), false);
  assert.equal(after.some((entry) => entry.name === "OtherMod"), true);
});

test("installRuntime: refuses a plugin path outside the project root", () => {
  const game = copyGame(MZ);
  const adapter = getAdapter("mz");
  const project = adapter.detect(game).project;
  const outside = tempDir();
  const original = fs.readFileSync(project.pluginsFile, "utf8");

  assert.throws(
    () => adapter.installRuntime({ ...project, pluginDir: outside }),
    (error) => {
      assert.equal(error.code, "E_IO");
      assert.match(error.message, /refusing to write outside the project root/);
      return true;
    }
  );
  assert.equal(fs.readFileSync(project.pluginsFile, "utf8"), original);
  assert.equal(fs.existsSync(path.join(outside, "YAKUSHA_Translator.js")), false);
});

test("uninstallRuntime: refuses a plugin path outside the project root", () => {
  const game = copyGame(MZ);
  const adapter = getAdapter("mz");
  const project = adapter.detect(game).project;
  const installed = adapter.installRuntime(project);
  const before = fs.readFileSync(project.pluginsFile, "utf8");
  const outside = tempDir();

  assert.throws(
    () => adapter.uninstallRuntime({ ...project, pluginDir: outside }),
    (error) => {
      assert.equal(error.code, "E_IO");
      assert.match(error.message, /refusing to write outside the project root/);
      return true;
    }
  );
  assert.equal(fs.readFileSync(project.pluginsFile, "utf8"), before);
  assert.equal(fs.existsSync(installed.pluginPath), true);
});

test("attach: both adapters report E_NOT_IMPLEMENTED", () => {
  for (const engine of ENGINES) {
    const game = gameFor(engine.id);
    const adapter = getAdapter(engine.id);
    const project = adapter.detect(game).project;
    assert.equal(adapter.capabilities.attach, false);
    assert.throws(
      () => adapter.attach(project),
      (error) => {
        assert.equal(error.message, "attach is not implemented in 0.10");
        assert.equal(error.code, "E_NOT_IMPLEMENTED");
        return true;
      }
    );
  }
});

test("facade: package self-reference and deep imports resolve", () => {
  const selfCode =
    'const m = await import("yakusha"); console.log(JSON.stringify({ version: m.VERSION, detect: typeof m.detectProject, adapter: typeof m.getAdapter }));';
  const self = spawnSync(process.execPath, ["--input-type=module", "-e", selfCode], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(self.status, 0, self.stderr);
  const parsed = JSON.parse(self.stdout);
  assert.equal(parsed.version, VERSION);
  assert.equal(parsed.detect, "function");
  assert.equal(parsed.adapter, "function");

  const deepCode = 'const m = await import("yakusha/src/core/dict.js"); console.log(typeof m.loadDictionary, m.DICT_FILE);';
  const deep = spawnSync(process.execPath, ["--input-type=module", "-e", deepCode], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(deep.status, 0, deep.stderr);
  assert.equal(deep.stdout.trim(), "function dictionary.json");
});
