/**
 * The RGSS adapter and the engine-neutral code around it.
 *
 * These tests use the synthetic fixtures from test/rgss-fixture.js, so a project
 * can be unpacked (a Data/ directory) or packed (one RGSS3A archive). Both must
 * behave the same, because only the storage differs.
 */

import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getAdapter, getAdapters, detectProject } from "../src/engines/registry.js";
import { diagnose } from "../src/core/doctor.js";
import { dictionaryPath, loadDictionary, saveDictionary } from "../src/core/dict.js";
import { rmProfile } from "../src/engines/profile.js";
import { rgssProfile } from "../src/engines/rgss/profile.js";
import { writePackedProject, writeRgssProject } from "./rgss-fixture.js";
import { nativeAssets } from "./rgss-native-fixture.js";

/**
 * Directories created by the tests, removed once the file has finished.
 *
 * @type {string[]}
 */
const created = [];

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-rgss-adapter-"));
  created.push(dir);
  return dir;
}

/**
 * Build a fixture inside a fresh sandbox and detect it.
 *
 * The game sits one level down so that a test can point the adapter at the
 * *parent* - the folder a player actually opens - without handing it the system
 * temp directory, which holds thousands of unrelated entries.
 *
 * @param {"plain"|"packed"} kind
 * @returns {{ root: string, project: object, adapter: object }}
 */
function projectFor(kind = "plain") {
  const root = path.join(sandbox(), "Game");
  if (kind === "packed") writePackedProject(root);
  else writeRgssProject(root);
  const result = detectProject(root);
  assert.equal(result.ok, true, "the fixture should be detected");
  return { root, project: result.project, adapter: result.adapter };
}

/** Extract, then fill every entry with a synthetic target. */
function translateAll(project, adapter) {
  adapter.extract(project);
  const file = dictionaryPath(project.root);
  const dictionary = loadDictionary(file);
  for (const key of Object.keys(dictionary.entries)) dictionary.entries[key].text = "T:" + key;
  saveDictionary(file, dictionary);
}

/** Run doctor with the engine inputs the adapter owns. */
function diagnoseOwn(project, adapter) {
  const own = adapter.diagnostics(project);
  return diagnose(project, {
    dictionary: loadDictionary(dictionaryPath(project.root)),
    dictionaryFile: dictionaryPath(project.root),
    maxColumns: 0,
    engineLabel: adapter.name,
    profile: adapter.profile,
    extract: own.extract,
    dataFiles: own.dataFiles,
    sourceLabel: own.sourceLabel,
    delivery: own.delivery,
  });
}

after(() => {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
});
test("the registry ships RGSS fourth, with its own profile and the inject runtime tier", () => {
  assert.deepEqual(
    getAdapters().map((adapter) => adapter.id),
    ["mz", "mv", "renpy", "rgss", "krkr"]
  );
  const adapter = getAdapter("rgss");
  assert.equal(adapter.name, "RGSS");
  assert.equal(adapter.profile, rgssProfile);
  assert.notEqual(adapter.profile, rmProfile);
  assert.equal(adapter.rules.controlCodes, true);
  // XP, VX and VX Ace have no plugin system: the translation is delivered by
  // the native injector, which is the "inject" runtime tier.
  assert.equal(adapter.capabilities.runtime, "inject");
  assert.equal(adapter.capabilities.extract, true);
  assert.equal(adapter.capabilities.export, true);
  assert.equal(adapter.capabilities.launch, true);
  assert.equal(adapter.capabilities.debuggable, false);
  assert.equal(adapter.capabilities.attach, false);
  assert.equal(adapter.capabilities.liveReload, false);
  // The CLI prints the project size from this label.
  assert.equal(adapter.dataUnit, "data files");
  assert.equal(typeof adapter.diagnostics, "function");
});

test("detect: a game is found from its root, its Data folder and above it", () => {
  const { root } = projectFor();
  const adapter = getAdapter("rgss");
  const fromRoot = adapter.detect(root);
  assert.equal(fromRoot.ok, true);
  assert.equal(fromRoot.project.engine, "rgss");
  assert.equal(fromRoot.project.root, path.resolve(root));
  assert.equal(fromRoot.project.version, "3");
  assert.equal(fromRoot.project.edition, "VX Ace");
  assert.equal(fromRoot.project.dataDir, "Data");
  // RGSS has no plugin directory, no plugin registry and no index file.
  assert.equal(fromRoot.project.pluginDir, null);
  assert.equal(fromRoot.project.pluginsFile, null);
  assert.equal(fromRoot.project.indexPath, null);

  const fromData = adapter.detect(path.join(root, "Data"));
  assert.equal(fromData.project.root, fromRoot.project.root);
  const fromParent = adapter.detect(path.dirname(root));
  assert.equal(fromParent.project.root, fromRoot.project.root);
});

test("detect: a packed game is found without a Data folder", () => {
  const { root } = projectFor("packed");
  const result = getAdapter("rgss").detect(root);
  assert.equal(result.ok, true);
  assert.equal(result.project.archive, path.join(root, "Game.rgss3a"));
  assert.equal(fs.existsSync(path.join(root, "Data")), false);
});

test("detect: an empty directory is E_NOT_PROJECT in RGSS wording", () => {
  const empty = sandbox();
  const result = getAdapter("rgss").detect(empty);
  assert.equal(result.ok, false);
  assert.equal(result.code, "E_NOT_PROJECT");
  assert.match(result.message, /^not an RGSS project \(no Game\.ini, no \.rgssad\/\.rgss2a\/\.rgss3a archive/);
  // The registry must keep trying, so the adapter uses the prefix it knows.
  const viaRegistry = detectProject(empty);
  assert.equal(viaRegistry.code, "E_NOT_PROJECT");
  assert.match(viaRegistry.message, /not an RPG Maker project/);
});

test("detect: two sibling games are E_MULTI_ROOT with sorted candidates", () => {
  const parent = sandbox();
  for (const name of ["alpha", "beta"]) writeRgssProject(path.join(parent, name));
  const expected = [path.join(parent, "alpha"), path.join(parent, "beta")];

  const result = getAdapter("rgss").detect(parent);
  assert.equal(result.ok, false);
  assert.equal(result.code, "E_MULTI_ROOT");
  assert.match(result.message, /^found 2 RGSS projects under /);
  assert.deepEqual(result.candidates, expected);

  const viaRegistry = detectProject(parent);
  assert.equal(viaRegistry.code, "E_MULTI_ROOT");
  assert.deepEqual(viaRegistry.candidates, expected);
  assert.equal(Object.hasOwn(viaRegistry, "adapter"), false);
});
test("scan: the payload keeps the eleven contract keys", () => {
  const { project, adapter } = projectFor();
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
  assert.equal(payload.engine, "rgss");
  assert.equal(payload.root, project.root);
  assert.equal(payload.gameTitle, "Synthetic Quest");
  assert.equal(payload.uniqueStrings, 29);
  assert.equal(payload.totalStrings, 29);
  // A packed game has no files on disk, so the documents that decoded are the
  // only honest count of "how big is this project".
  assert.equal(payload.dataFiles, 7);
  assert.deepEqual(payload.encodings, { rvdata2: 7 });
  assert.deepEqual(payload.undecodable, []);
  assert.equal(payload.perFile["Map001.rvdata2"], 9);
  assert.equal(payload.stringsWithControlCodes, 1, "the actor description holds \\C[6]");
});

test("scan: a packed game reports the same numbers, only the format differs", () => {
  const plain = projectFor("plain");
  const packed = projectFor("packed");
  const a = plain.adapter.scan(plain.project);
  const b = packed.adapter.scan(packed.project);
  assert.equal(b.uniqueStrings, a.uniqueStrings);
  assert.equal(b.totalStrings, a.totalStrings);
  assert.equal(b.dataFiles, a.dataFiles);
  assert.equal(b.stringsWithControlCodes, a.stringsWithControlCodes);
  assert.deepEqual(b.perFile, a.perFile);
  assert.deepEqual(b.encodings, { marshal: 7 });
});

test("scan: a document the reader rejects is one line, and the rest still scans", () => {
  const { root, project } = projectFor();
  fs.writeFileSync(path.join(root, "Data", "Map002.rvdata2"), Buffer.from([4, 8, 0x6f, 0x3a]));
  const payload = getAdapter("rgss").scan(project);
  assert.equal(payload.undecodable.length, 1);
  assert.match(payload.undecodable[0], /^Map002\.rvdata2: /);
  assert.equal(payload.uniqueStrings, 29, "one broken document costs nothing else");
  assert.equal(payload.dataFiles, 7);
});

test("extract: the dictionary is created once and kept on the second run", () => {
  const { root, project, adapter } = projectFor();
  const first = adapter.extract(project);
  assert.equal(first.file, dictionaryPath(root));
  assert.equal(first.added, 29);
  assert.equal(first.total, 29);
  assert.equal(first.translated, 0);
  assert.equal(first.pending, 29);

  const second = adapter.extract(project);
  assert.equal(second.added, 0);
  assert.equal(second.total, 29);
});

test("extract: a translated entry is never overwritten by a second run", () => {
  const { root, project, adapter } = projectFor();
  adapter.extract(project);
  const file = dictionaryPath(root);
  const dictionary = loadDictionary(file);
  dictionary.entries["Yuki"].text = "T:Yuki";
  saveDictionary(file, dictionary);

  const again = adapter.extract(project);
  assert.equal(again.added, 0);
  assert.equal(again.translated, 1);
  assert.equal(loadDictionary(file).entries["Yuki"].text, "T:Yuki");
});

test("extract: a dictionary that cannot be parsed is rebuilt, not fatal", () => {
  const { root, project, adapter } = projectFor();
  fs.mkdirSync(path.dirname(dictionaryPath(root)), { recursive: true });
  fs.writeFileSync(dictionaryPath(root), "{ this is not json");
  const result = adapter.extract(project);
  assert.equal(result.added, 29);
  assert.equal(loadDictionary(dictionaryPath(root)).entries["Yuki"].text, "");
});
test("install: without --native the adapter refuses with usage, not a fake install", () => {
  const { project, adapter } = projectFor();
  translateAll(project, adapter);
  assert.throws(
    () => adapter.installRuntime(project),
    (error) => {
      assert.equal(error.code, "E_USAGE");
      assert.match(error.message, /^RGSS has no plugin delivery layer - pass --native to install the injector/);
      return true;
    }
  );
  // Uninstall stays harmless: there is nothing to remove and no error.
  assert.deepEqual(adapter.uninstallRuntime(project), {
    removed: false,
    restored: false,
    backupPath: null,
    drifted: false,
    keptBackup: null,
    native: { dir: path.join(project.root, "yakusha", "native"), removed: false },
  });
});

test("install: --native copies the components and builds the runtime dictionary", () => {
  const { root, project, adapter } = projectFor();
  translateAll(project, adapter);
  const assets = nativeAssets();
  const result = adapter.installRuntime(project, { native: true, assetsDir: assets.dir });
  assert.equal(result.registered, true);
  assert.equal(result.state, "added");
  assert.equal(result.backupPath, null);
  assert.equal(result.native.dictionaryEntries, 29);
  const dir = path.join(root, "yakusha", "native");
  for (const name of ["yakusha_rgss_hook.dll", "libunwind.dll", "yakusha_injector.exe", "bootstrap.rb", "dictionary.txt", "manifest.json"]) {
    assert.equal(fs.existsSync(path.join(dir, name)), true, name);
  }
  const lines = fs.readFileSync(path.join(dir, "dictionary.txt"), "utf8").trim().split("\n");
  assert.equal(lines.length, 29);
  const [source, target] = lines[0].split("\t");
  assert.equal(Buffer.from(source, "base64").toString("utf8"), "A battle line.");
  assert.equal(Buffer.from(target, "base64").toString("utf8"), "T:A battle line.");
  // A second install is idempotent.
  const again = adapter.installRuntime(project, { native: true, assetsDir: assets.dir });
  assert.equal(again.state, "unchanged");
  assert.equal(adapter.diagnostics(project).delivery.exists, true);
  assert.equal(adapter.diagnostics(project).delivery.entries, 29);
});

test("install: --native --dry-run reports the plan and writes nothing", () => {
  const { root, project, adapter } = projectFor();
  translateAll(project, adapter);
  const assets = nativeAssets();
  const result = adapter.installRuntime(project, { native: true, dryRun: true, assetsDir: assets.dir });
  assert.equal(result.native.dryRun, true);
  assert.equal(result.native.dictionaryEntries, 29);
  assert.equal(fs.existsSync(path.join(root, "yakusha", "native")), false);
});

test("install: a tampered component stops the install before anything is written", () => {
  const { root, project, adapter } = projectFor();
  translateAll(project, adapter);
  const assets = nativeAssets();
  fs.writeFileSync(path.join(assets.dir, "yakusha_rgss_hook.dll"), "tampered");
  assert.throws(
    () => adapter.installRuntime(project, { native: true, assetsDir: assets.dir }),
    (error) => {
      assert.equal(error.code, "E_IO");
      assert.match(error.message, /^native component failed its integrity check: yakusha_rgss_hook\.dll/);
      return true;
    }
  );
  assert.equal(fs.existsSync(path.join(root, "yakusha", "native")), false);
});

test("uninstall: removes the native directory only when the manifest is ours", () => {
  const { root, project, adapter } = projectFor();
  translateAll(project, adapter);
  const assets = nativeAssets();
  adapter.installRuntime(project, { native: true, assetsDir: assets.dir });
  assert.equal(fs.existsSync(path.join(root, "yakusha", "native")), true);
  const result = adapter.uninstallRuntime(project);
  assert.equal(result.removed, true);
  assert.equal(result.restored, false);
  assert.equal(fs.existsSync(path.join(root, "yakusha", "native")), false);
  // The dictionary survives, because uninstall only owns the native directory.
  assert.equal(fs.existsSync(path.join(root, "yakusha", "dictionary.json")), true);

  fs.mkdirSync(path.join(root, "yakusha", "native"), { recursive: true });
  fs.writeFileSync(path.join(root, "yakusha", "native", "stray.txt"), "not ours");
  assert.throws(() => adapter.uninstallRuntime(project), /native component manifest is missing or unreadable/);
  assert.equal(fs.existsSync(path.join(root, "yakusha", "native", "stray.txt")), true);
});

test("attach: RGSS has no debug injection, and says so in the shared wording", () => {
  assert.throws(
    () => getAdapter("rgss").attach(),
    (error) => {
      assert.equal(error.code, "E_NOT_IMPLEMENTED");
      assert.equal(error.message, "attach is not implemented in 0.10");
      return true;
    }
  );
});

test("doctor: before install the native layer reads as not installed", () => {
  const { project, adapter } = projectFor();
  translateAll(project, adapter);
  const own = adapter.diagnostics(project);
  const result = diagnose(project, {
    dictionary: loadDictionary(dictionaryPath(project.root)),
    dictionaryFile: dictionaryPath(project.root),
    maxColumns: 0,
    engineLabel: adapter.name,
    profile: adapter.profile,
    extract: own.extract,
    dataFiles: own.dataFiles,
    sourceLabel: own.sourceLabel,
    delivery: own.delivery,
  });
  assert.equal(result.game.engine, "rgss");
  assert.equal(result.game.dataFiles, 7);
  assert.equal(result.verdict, "not-installed");
  assert.equal(result.ok, true);
  const levels = Object.fromEntries(result.checks.map((check) => [check.id, check.level]));
  assert.equal(levels.install, "info");
  assert.equal(levels.runtime, "info");
  assert.equal(levels.dictionary, "ok");
  assert.equal(levels.sync, "ok");
  assert.match(result.checks.find((check) => check.id === "install").message, /- run: yakusha install --native \"<game>\"$/);
  assert.equal(result.runtime.entries, 0);
  assert.equal(result.runtime.found, null);
});

test("doctor: after install the native layer is the delivery the game uses", () => {
  const { project, adapter } = projectFor();
  translateAll(project, adapter);
  const assets = nativeAssets();
  adapter.installRuntime(project, { native: true, assetsDir: assets.dir });
  const own = adapter.diagnostics(project);
  const result = diagnose(project, {
    dictionary: loadDictionary(dictionaryPath(project.root)),
    dictionaryFile: dictionaryPath(project.root),
    maxColumns: 0,
    engineLabel: adapter.name,
    profile: adapter.profile,
    extract: own.extract,
    dataFiles: own.dataFiles,
    sourceLabel: own.sourceLabel,
    delivery: own.delivery,
  });
  assert.equal(result.verdict, "ready");
  const levels = Object.fromEntries(result.checks.map((check) => [check.id, check.level]));
  assert.equal(levels.install, "ok");
  assert.equal(levels.runtime, "ok");
  assert.equal(result.runtime.entries, 29);
  assert.match(result.checks.find((check) => check.id === "runtime").message, /29 strings/);
});

test("native status: a deleted component is visible before the game is launched", () => {
  const { root, project, adapter } = projectFor();
  translateAll(project, adapter);
  const assets = nativeAssets();
  adapter.installRuntime(project, { native: true, assetsDir: assets.dir });
  fs.rmSync(path.join(root, "yakusha", "native", "libunwind.dll"));
  const delivery = adapter.diagnostics(project).delivery;
  assert.equal(delivery.exists, true, "the manifest still marks the layer as installed");
  assert.equal(delivery.intact, false);
  assert.ok(delivery.problems.some((problem) => /libunwind\.dll is missing/.test(problem)), delivery.problems.join(", "));
});

test("doctor: a tampered native component is broken, and install repairs it", () => {
  const { root, project, adapter } = projectFor();
  translateAll(project, adapter);
  const assets = nativeAssets();
  adapter.installRuntime(project, { native: true, assetsDir: assets.dir });
  fs.appendFileSync(path.join(root, "yakusha", "native", "yakusha_rgss_hook.dll"), "tampered");
  const result = diagnoseOwn(project, adapter);
  assert.equal(result.ok, false);
  assert.equal(result.verdict, "broken");
  const installCheck = result.checks.find((check) => check.id === "install");
  assert.equal(installCheck.level, "fail");
  assert.match(installCheck.message, /is damaged: yakusha_rgss_hook\.dll has changed/);
  assert.match(installCheck.message, /- run: yakusha install --native "<game>"$/);
  assert.equal(result.checks.find((check) => check.id === "runtime").level, "fail");
  // Reinstalling from intact assets is the repair path the message names.
  adapter.installRuntime(project, { native: true, assetsDir: assets.dir });
  assert.equal(adapter.diagnostics(project).delivery.intact, true);
});

test("launch: a damaged native layer refuses to start instead of running untranslated", async () => {
  const { root, project, adapter } = projectFor();
  translateAll(project, adapter);
  const assets = nativeAssets();
  adapter.installRuntime(project, { native: true, assetsDir: assets.dir });
  fs.rmSync(path.join(root, "yakusha", "native", "libunwind.dll"));
  await assert.rejects(
    () => adapter.launch(project),
    (error) => {
      assert.equal(error.code, "E_IO");
      assert.match(error.message, /the native components are damaged: libunwind\.dll/);
      assert.match(error.message, /- run: yakusha install --native/);
      return true;
    }
  );
});
test("doctor: diagnostics counts the documents the scan counts", () => {
  const { root, project, adapter } = projectFor();
  const before = adapter.scan(project).dataFiles;
  assert.equal(adapter.diagnostics(project).dataFiles, before);
  assert.equal(adapter.diagnostics(project).sourceLabel, "Data/");

  // One unreadable document is missing from both numbers at once.
  fs.writeFileSync(path.join(root, "Data", "Map003.rvdata2"), Buffer.from([4, 8, 0x6f, 0x3a]));
  assert.equal(adapter.scan(project).dataFiles, before);
  assert.equal(adapter.diagnostics(project).dataFiles, before);
});

test("profile: RGSS keeps the escape codes the generator renders", () => {
  const codes = rgssProfile.grammar.controlCodes;
  assert.deepEqual(codes("\\C[6]red\\C[0]"), ["\\C[6]", "\\C[0]"]);
  assert.deepEqual(codes("a\\V[12]b"), ["\\V[12]"]);
  assert.deepEqual(codes("\\{wait\\}"), ["\\{", "\\}"]);
  assert.deepEqual(codes("plain text"), []);
  // The visible text a translator reads has the codes taken out.
  assert.equal(rgssProfile.grammar.visibleText("\\C[6]red\\C[0]"), "red");
  assert.equal(rgssProfile.grammar.plainText("a\\V[12]b"), "ab");
  assert.equal(rgssProfile.id, "rgss");
  assert.match(rgssProfile.prompt.task("Simplified Chinese"), /XP, VX and VX Ace/);
  assert.match(rgssProfile.prompt.escapeExamples, /\\C\[6\]/);
});
