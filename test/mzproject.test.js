/**
 * Project discovery tests.
 *
 * Deployed RPG Maker games are not always at the top of the folder the user
 * points at, so `openProject` walks down a bounded number of levels. These
 * tests pin that behaviour, including the "several games under one folder"
 * case, which must fail loudly instead of silently picking one.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openProject, findProjectRoots, MAX_SEARCH_DEPTH } from "../src/core/mzproject.js";

/** Create an empty directory tree and return its root. */
function sandbox() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-proj-"));
}

/** Lay down the minimum a project root needs to be recognised. */
function makeRoot(dir, { engine = "mz", title = "probe" } = {}) {
  fs.mkdirSync(path.join(dir, "data"), { recursive: true });
  fs.mkdirSync(path.join(dir, "js"), { recursive: true });
  const core = engine === "mz" ? "rmmz_core.js" : "rpg_core.js";
  fs.writeFileSync(path.join(dir, "js", core), "// " + engine + " core v1.2.3\n", "utf8");
  fs.writeFileSync(path.join(dir, "js", "plugins.js"), "var $plugins =\n[\n];\n", "utf8");
  fs.writeFileSync(
    path.join(dir, "data", "System.json"),
    JSON.stringify({ gameTitle: title }),
    "utf8"
  );
  fs.writeFileSync(path.join(dir, "index.html"), "<html></html>", "utf8");
  return dir;
}

test("a root at the given directory is found at depth 0", () => {
  const base = sandbox();
  makeRoot(base);
  const roots = findProjectRoots(base);
  assert.equal(roots.length, 1);
  assert.equal(roots[0].depth, 0);
  assert.equal(openProject(base).root, path.resolve(base));
});

test("a www/ wrapper is found one level down", () => {
  const base = sandbox();
  makeRoot(path.join(base, "www"), { engine: "mv" });
  const roots = findProjectRoots(base);
  assert.equal(roots.length, 1);
  assert.equal(roots[0].depth, 1);
  assert.equal(openProject(base).engine, "mv");
});

test("a game inside a renamed subfolder is found", () => {
  const base = sandbox();
  const inner = path.join(base, "\u30c4\u30f3\u30c7\u30ec\u59b9\u3068\u79c1\u306e\u7652\u3057\u306e\u65e5\u5e38");
  makeRoot(inner, { engine: "mz" });
  assert.equal(openProject(base).root, path.resolve(inner));
});

test("a browser build under data/www/ is found", () => {
  const base = sandbox();
  const inner = path.join(base, "data", "www");
  makeRoot(inner, { engine: "mv" });
  assert.equal(openProject(base).root, path.resolve(inner));
});

test("the walk stops at MAX_SEARCH_DEPTH", () => {
  const base = sandbox();
  const deep = path.join(base, "a", "b", "c", "d");
  makeRoot(deep);
  assert.deepEqual(findProjectRoots(base), []);
  assert.throws(() => openProject(base), /not an RPG Maker project/);
  assert.equal(MAX_SEARCH_DEPTH, 3);
});

test("asset folders are not searched", () => {
  const base = sandbox();
  makeRoot(path.join(base, "node_modules", "pkg"));
  makeRoot(path.join(base, "img", "x"));
  assert.deepEqual(findProjectRoots(base), []);
});

test("two games in the same folder are an error, not a coin flip", () => {
  const base = sandbox();
  makeRoot(path.join(base, "one"));
  makeRoot(path.join(base, "two"));
  assert.equal(findProjectRoots(base).length, 2);
  assert.throws(() => openProject(base), /found 2 RPG Maker projects/);
});

test("a shallow root wins over a nested one", () => {
  const base = sandbox();
  makeRoot(base);
  makeRoot(path.join(base, "www"), { engine: "mv" });
  assert.equal(findProjectRoots(base).length, 1);
  assert.equal(openProject(base).engine, "mz");
});
