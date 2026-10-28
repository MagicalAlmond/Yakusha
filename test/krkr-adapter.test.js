/**
 * Kirikiri adapter contract (src/engines/krkr/adapter.js).
 *
 * The adapter is the engine-facing surface the CLI and doctor read, so the
 * tests pin what the rest of the code may rely on: detection wording, the
 * eleven scan keys, dictionary extraction that never touches existing
 * translations, and a runtime tier that refuses instead of pretending.
 */

import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getAdapter, getAdapters, detectProject } from "../src/engines/registry.js";
import { dictionaryPath, loadDictionary } from "../src/core/dict.js";
import { writeKrkrProject, buildXp3 } from "./krkr-fixture.js";

const created = [];
function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-krkr-adapter-"));
  created.push(dir);
  return dir;
}

after(() => {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
});

const KS = (text) => Buffer.from(text, "utf8");
const adapter = getAdapter("krkr");

function projectFor() {
  const parent = tempDir();
  const { root } = writeKrkrProject(parent, { archives: [
    { archiveName: "data.xp3", files: [
      { name: "scenario/s1.ks", data: KS("[name_set name='Aoi']\nあおい「せりふ」\n") , mode: 1 },
      { name: "system/Init.tjs", data: KS("class C {}") },
    ] },
  ] });
  return { root, project: adapter.detect(root).project };
}

test("the registry ships Kirikiri fifth, with its own profile and no runtime tier", () => {
  assert.deepEqual(getAdapters().map((item) => item.id).indexOf("krkr"), 4);
  assert.equal(adapter.name, "Kirikiri");
  assert.equal(adapter.profile.id, "krkr");
  assert.notEqual(adapter.profile.id, "rm");
  assert.equal(adapter.rules.controlCodes, true);
  assert.equal(adapter.capabilities.runtime, null, "no delivery layer in 0.13");
  assert.equal(adapter.capabilities.extract, true);
  assert.equal(adapter.capabilities.export, true);
  assert.equal(adapter.capabilities.launch, true);
  assert.equal(adapter.capabilities.debuggable, false);
  assert.equal(adapter.capabilities.attach, false);
  assert.equal(adapter.capabilities.liveReload, false);
  assert.equal(adapter.dataUnit, "data files");
  assert.equal(typeof adapter.diagnostics, "function");
});

test("detect: finds a game from the root and from its data/ directory", () => {
  const { root } = projectFor();
  const fromRoot = adapter.detect(root);
  assert.equal(fromRoot.ok, true);
  assert.equal(fromRoot.project.engine, "krkr");
  assert.equal(fromRoot.project.root, path.resolve(root));
  // The data/ directory reads as a project itself (looksLikeKrkrProject),
  // so pointing there names that directory as the root - it still opens.
  const dataDir = path.join(path.resolve(root), "data");
  const fromData = adapter.detect(dataDir);
  assert.equal(fromData.ok, true);
  assert.equal(fromData.project.root, dataDir);
});

test("detect: an empty directory is E_NOT_PROJECT in Kirikiri wording", () => {
  const empty = tempDir();
  const result = adapter.detect(empty);
  assert.equal(result.ok, false);
  assert.equal(result.code, "E_NOT_PROJECT");
  assert.match(result.message, /^not a Kirikiri project \(no \.xp3 archive in /);
  assert.match(result.message, / or up to 3 levels below it\)$/);
});

test("detect: two sibling projects are E_MULTI_ROOT with sorted candidates", () => {
  const parent = tempDir();
  for (const name of ["alpha", "beta"]) {
    fs.mkdirSync(path.join(parent, name), { recursive: true });
    fs.writeFileSync(path.join(parent, name, "data.xp3"), buildXp3([{ name: "a.ks", data: KS("x") }]));
  }
  const result = adapter.detect(parent);
  assert.equal(result.ok, false);
  assert.equal(result.code, "E_MULTI_ROOT");
  assert.match(result.message, /^found 2 Kirikiri projects under /);
  assert.deepEqual(result.candidates, [path.join(parent, "alpha"), path.join(parent, "beta")].map((p) => path.resolve(p)));
});

test("scan: the payload keeps the eleven contract keys", () => {
  const { project } = projectFor();
  const scan = adapter.scan(project);
  assert.deepEqual(Object.keys(scan).sort(), [
    "dataFiles", "encodings", "engine", "engineVersion", "gameTitle",
    "perFile", "root", "stringsWithControlCodes", "totalStrings",
    "undecodable", "uniqueStrings",
  ]);
  assert.equal(scan.engine, "krkr");
  assert.equal(scan.engineVersion, null);
  assert.equal(scan.gameTitle, null);
  assert.equal(scan.dataFiles, 1);
  assert.equal(scan.uniqueStrings, 1);
  assert.equal(scan.totalStrings, 1);
  assert.deepEqual(scan.undecodable, []);
  assert.deepEqual(scan.encodings, { xp3: 1 });
});

test("scan: undecodable items are strings the CLI can join", () => {
  const parent = tempDir();
  fs.writeFileSync(path.join(parent, "broken.xp3"), Buffer.from("not an archive, padding padding", "utf8"));
  fs.writeFileSync(path.join(parent, "good.xp3"), buildXp3([{ name: "s.ks", data: KS("[t]\nhi\n") }]));
  const { project } = { project: adapter.detect(parent).project };
  const scan = adapter.scan(project);
  assert.equal(scan.undecodable.length, 1);
  assert.equal(typeof scan.undecodable[0], "string");
  assert.match(scan.undecodable[0], /broken\.xp3: /);
});

test("extract: writes a dictionary with empty targets and merged contexts", () => {
  const { root, project } = projectFor();
  const result = adapter.extract(project);
  assert.equal(result.added, 1);
  assert.equal(result.total, 1);
  assert.equal(result.pending, 1);
  const dict = loadDictionary(dictionaryPath(root));
  assert.deepEqual(dict.entries["あおい「せりふ」"], {
    text: "",
    contexts: ["scenario/s1.ks:2"],
    engine: "krkr",
    locator: ["scenario/s1.ks:2"],
  });
});

test("extract: never overwrites existing translations", () => {
  const { root, project } = projectFor();
  adapter.extract(project);
  const file = dictionaryPath(root);
  const dict = loadDictionary(file);
  dict.entries["あおい「せりふ」"].text = "既存の訳";
  fs.writeFileSync(file, JSON.stringify(dict, null, 2) + "\n");
  const second = adapter.extract(project);
  assert.equal(second.added, 0);
  const after = loadDictionary(file);
  assert.equal(after.entries["あおい「せりふ」"].text, "既存の訳", "the translation survives re-extraction");
});

test("install/uninstall: E_NOT_IMPLEMENTED pointing at the pending decisions", () => {
  const { project } = projectFor();
  assert.equal(adapter.capabilities.runtime, null);
  assert.throws(
    () => adapter.installRuntime(project, {}),
    (error) => {
      assert.equal(error.code, "E_NOT_IMPLEMENTED");
      assert.equal(error.message, "install is not implemented for Kirikiri yet - see the pending decisions in docs/dev/DEVLOG.md");
      return true;
    }
  );
  assert.throws(
    () => adapter.uninstallRuntime(project),
    (error) => {
      assert.equal(error.code, "E_NOT_IMPLEMENTED");
      assert.equal(error.message, "uninstall is not implemented for Kirikiri yet - see the pending decisions in docs/dev/DEVLOG.md");
      return true;
    }
  );
});

test("attach: the shared not-implemented error", () => {
  const { project } = projectFor();
  assert.throws(
    () => adapter.attach(project),
    (error) => {
      assert.equal(error.code, "E_NOT_IMPLEMENTED");
      assert.equal(error.message, "attach is not implemented in 0.10");
      return true;
    }
  );
});

test("diagnostics: doctor input reports the pending delivery and the archive count", () => {
  const { root, project } = projectFor();
  const diagnostics = adapter.diagnostics(project);
  assert.equal(diagnostics.dataFiles, 1);
  assert.equal(diagnostics.sourceLabel, "xp3 archives");
  assert.deepEqual(diagnostics.delivery, {
    pending: true,
    message: "Kirikiri has no delivery layer yet, so nothing is written back into the game",
  });
  const extracted = diagnostics.extract();
  assert.equal(extracted.documents, 1);
  assert.ok(fs.existsSync(dictionaryPath(root)) === false, "diagnostics does not write a dictionary");
});
