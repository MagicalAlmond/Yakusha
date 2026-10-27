/**
 * Kirikiri project detection contract (src/engines/krkr/project.js).
 *
 * Detection answers three questions: is this a Kirikiri game, which root is
 * it, and is the answer unambiguous. The layout a real game ships is the root
 * (or its data/ directory) holding the .xp3 archives, so that is the only
 * signal the detector reads.
 */

import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { looksLikeKrkrProject, findKrkrRoot, findKrkrRoots, openKrkrProject } from "../src/engines/krkr/project.js";
import { writeKrkrProject, buildXp3 } from "./krkr-fixture.js";

const created = [];
function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-krkr-project-"));
  created.push(dir);
  return dir;
}

function tinyArchiveBuffer() {
  return buildXp3([{ name: "a.ks", data: Buffer.from("text", "utf8") }]);
}

after(() => {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
});

test("looksLikeKrkrProject accepts the root or its data/ directory", () => {
  const parent = tempDir();
  const { root, dataDir } = writeKrkrProject(parent, { name: "game-a", archives: [{ archiveName: "data.xp3", files: [{ name: "a.ks", data: Buffer.from("t", "utf8") }] }] });
  assert.equal(looksLikeKrkrProject(root), true);
  assert.equal(looksLikeKrkrProject(dataDir), true, "the archive-holding data/ directory also reads as a project");
  assert.equal(looksLikeKrkrProject(parent), false);
  const empty = tempDir();
  assert.equal(looksLikeKrkrProject(empty), false);
});

test("findKrkrRoot returns null for an empty directory, one root for a game", () => {
  const empty = tempDir();
  assert.equal(findKrkrRoot(empty), null);
  assert.deepEqual(findKrkrRoots(empty), []);

  const parent = tempDir();
  const { root } = writeKrkrProject(parent, { name: "game-b", archives: [{ archiveName: "data.xp3", files: [{ name: "a.ks", data: Buffer.from("t", "utf8") }] }] });
  assert.equal(findKrkrRoot(root), path.resolve(root));
  // The search only looks at or below its start: from the data/ directory the
  // answer is that directory itself (the adapter resolves the project above
  // it when the user points inside a game).
});

test("findKrkrRoot searches up to three levels below the start directory", () => {
  const parent = tempDir();
  const nested = path.join(parent, "one", "two");
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(nested, "data.xp3"), tinyArchiveBuffer());
  assert.equal(findKrkrRoot(parent), path.resolve(nested));

  const deep = path.join(parent, "one", "two", "three", "four");
  fs.mkdirSync(deep, { recursive: true });
  fs.writeFileSync(path.join(deep, "data.xp3"), tinyArchiveBuffer());
  assert.equal(findKrkrRoot(parent), path.resolve(nested), "the search stops at the configured depth");
  assert.equal(findKrkrRoot(deep), path.resolve(deep), "but a directory inside depth still finds its own root");
});

test("findKrkrRoot throws E_MULTI_ROOT for two sibling projects", () => {
  const parent = tempDir();
  for (const name of ["alpha", "beta"]) {
    fs.mkdirSync(path.join(parent, name), { recursive: true });
    fs.writeFileSync(path.join(parent, name, "data.xp3"), tinyArchiveBuffer());
  }
  assert.throws(
    () => findKrkrRoot(parent),
    (error) => {
      assert.equal(error.code, "E_MULTI_ROOT");
      assert.match(error.message, /^found 2 Kirikiri projects under /);
      assert.match(error.message, /pass one of them instead: /);
      return true;
    }
  );
});

test("openKrkrProject lists archives from the root or data/, sorted", () => {
  const parent = tempDir();
  const spec = { name: "game-c", archives: [
    { archiveName: "patch.xp3", files: [{ name: "a.ks", data: Buffer.from("t", "utf8") }] },
    { archiveName: "data.xp3", files: [{ name: "a.ks", data: Buffer.from("t", "utf8") }] },
  ] };
  const { root } = writeKrkrProject(parent, spec);
  const project = openKrkrProject(root);
  assert.equal(project.engine, "krkr");
  assert.equal(project.root, path.resolve(root));
  assert.equal(project.version, null, "0.13 reads no version signal");
  assert.equal(project.gameTitle, null);
  assert.equal(project.dataDir, path.join(path.resolve(root), "data"));
  assert.deepEqual(project.archives, [
    path.join(path.resolve(root), "data", "data.xp3"),
    path.join(path.resolve(root), "data", "patch.xp3"),
  ]);
});

test("openKrkrProject reads archives placed directly in the root", () => {
  const root = tempDir();
  fs.writeFileSync(path.join(root, "data.xp3"), tinyArchiveBuffer());
  const project = openKrkrProject(root);
  assert.equal(project.dataDir, path.resolve(root), "no data/ directory means the root is the data directory");
  assert.deepEqual(project.archives, [path.join(path.resolve(root), "data.xp3")]);
});
