import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { collectRenpyUnits, extractRenpyProject } from "../src/engines/renpy/extract.js";

/**
 * Path of one fixture project.
 *
 * Each fixture is a directory holding a single `game/` directory, which is the
 * layout of an unpacked Ren'Py game. All of the text inside was written for
 * these tests; see `fixtures/renpy-extract/README.md` for provenance.
 *
 * @param {string} name fixture directory name
 * @returns {string} absolute path of that project root
 */
function fixtureProject(name) {
  return fileURLToPath(new URL("./fixtures/renpy-extract/" + name, import.meta.url));
}

/**
 * Contexts recorded for one text, sorted for a stable comparison.
 *
 * @param {object} result value returned by extractRenpyProject
 * @param {string} text the text to look up
 * @returns {string[]} sorted context keys
 */
function contextsOf(result, text) {
  const entry = result.entries.get(text);
  assert.ok(entry, "no entry for " + JSON.stringify(text));
  return [...entry.contexts].sort();
}

/**
 * Sorted keys of a plain record.
 *
 * @param {object} record any object
 * @returns {string[]} its own keys, sorted
 */
function sortedKeys(record) {
  return Object.keys(record).sort();
}

test("a source-only project is read from its .rpy files", () => {
  const result = extractRenpyProject(fixtureProject("rpy"));

  assert.deepEqual([...result.entries.keys()], [
    "Alpha line one.",
    "Beta line two.",
    "Gamma menu caption.",
    "Delta choice one.",
    "Epsilon choice two.",
    "Shared echo line.",
    "Zeta subdirectory line.",
  ]);
  assert.deepEqual(contextsOf(result, "Alpha line one."), ["game/script.rpy:5"]);
  assert.deepEqual(contextsOf(result, "Gamma menu caption."), ["game/script.rpy:9"]);
  assert.deepEqual(result.undecodable, []);
  assert.deepEqual(result.scripts, { rpy: 2, rpyc: 0 });
});

test("a compiled-only project is read from its .rpyc file", () => {
  const result = extractRenpyProject(fixtureProject("rpyc"));

  assert.equal(result.totalStrings, 10);
  assert.deepEqual(result.scripts, { rpy: 0, rpyc: 1 });
  assert.deepEqual(result.perFile, { "game/script.rpyc": 10 });
  assert.deepEqual(contextsOf(result, "Settings"), ["game/script.rpyc:26"]);
  assert.deepEqual(contextsOf(result, "Are you sure?"), ["game/script.rpyc:14"]);
  assert.deepEqual(result.undecodable, []);
});

test("a project holding both formats reads both", () => {
  const result = extractRenpyProject(fixtureProject("mixed"));

  assert.deepEqual(result.scripts, { rpy: 1, rpyc: 1 });
  assert.deepEqual(sortedKeys(result.perFile), ["game/compiled.rpyc", "game/script.rpy"]);
  assert.deepEqual(contextsOf(result, "Mu mixed project line."), ["game/script.rpy:4"]);
  assert.deepEqual(contextsOf(result, "Settings"), ["game/compiled.rpyc:26"]);
  assert.deepEqual(result.undecodable, []);
});

test("a text seen in two files is one entry with two contexts", () => {
  const result = extractRenpyProject(fixtureProject("rpy"));

  const entry = result.entries.get("Shared echo line.");
  assert.ok(entry);
  assert.equal(entry.text, "Shared echo line.");
  assert.equal(entry.count, 2);
  assert.deepEqual([...entry.contexts].sort(), ["game/script.rpy:18", "game/sub/chapter.rpy:3"]);
  // Two positions, one entry: the deduplicated map still holds every position.
  assert.equal(result.entries.size, 7);
  assert.equal(result.totalStrings, 8);
});

test("a text repeated inside one file counts twice and keeps both lines", () => {
  const result = extractRenpyProject(fixtureProject("rpyc"));

  const entry = result.entries.get("Alpha line one.");
  assert.ok(entry);
  assert.equal(entry.count, 2);
  assert.deepEqual(contextsOf(result, "Alpha line one."), [
    "game/script.rpyc:30",
    "game/script.rpyc:8",
  ]);
  // Occurences, not distinct texts: ten strings share nine entries here.
  assert.equal(result.entries.size, 9);
  assert.equal(result.totalStrings, 10);
});

test("scripts in subdirectories are collected", () => {
  const result = extractRenpyProject(fixtureProject("rpy"));

  assert.deepEqual(contextsOf(result, "Zeta subdirectory line."), ["game/sub/chapter.rpy:4"]);
  assert.deepEqual(result.perFile, {
    "game/script.rpy": 6,
    "game/sub/chapter.rpy": 2,
  });
});

test("an undecodable script is reported without losing the others", () => {
  const result = extractRenpyProject(fixtureProject("broken"));

  // Both failures stay, and neither aborts the walk.
  assert.deepEqual(result.undecodable, [
    { file: "game/broken.rpyc", error: "rpyc slot table is truncated at byte 10" },
    {
      file: "game/stray.rpyc",
      error: "rpyc payload is not a zlib stream (no Ren'Py RPC2 container marker)",
    },
  ]);
  assert.deepEqual([...result.entries.keys()], ["Nu surviving line.", "Xi surviving line."]);
  assert.deepEqual(result.perFile, { "game/script.rpy": 2 });
  assert.equal(result.totalStrings, 2);
  // A file that failed contributes no script.
  assert.deepEqual(result.scripts, { rpy: 1, rpyc: 0 });
});

test("perFile counts occurrences rather than distinct texts", () => {
  const mixed = extractRenpyProject(fixtureProject("rpyc"));
  const distinct = mixed.entries.size;

  assert.equal(mixed.perFile["game/script.rpyc"], mixed.totalStrings);
  assert.equal(mixed.perFile["game/script.rpyc"], distinct + 1);

  const both = extractRenpyProject(fixtureProject("mixed"));
  const sum = Object.values(both.perFile).reduce((total, count) => total + count, 0);
  assert.equal(sum, both.totalStrings);
  assert.equal(both.totalStrings, 12);
});

test("relative paths always use posix separators", () => {
  const result = extractRenpyProject(fixtureProject("rpy"));

  for (const file of Object.keys(result.perFile)) {
    assert.ok(!file.includes("\\"), "backslash in " + file);
    assert.ok(file.startsWith("game/"), "unexpected prefix in " + file);
  }
  for (const entry of result.entries.values()) {
    for (const context of entry.contexts) {
      assert.ok(!context.includes("\\"), "backslash in context " + context);
      assert.match(context, /^game\/(?:[^:]+)(?::\d+)?$/);
    }
  }
});

test("a unit without a line number gets a path-only context", () => {
  const result = extractRenpyProject(fixtureProject("lineless"));

  assert.deepEqual(contextsOf(result, "Line without a line number."), ["game/script.rpyc"]);
  assert.deepEqual(contextsOf(result, "Old string without a line."), ["game/script.rpyc"]);
  assert.equal(result.totalStrings, 5);
  assert.deepEqual(result.scripts, { rpy: 0, rpyc: 1 });
  assert.deepEqual(result.undecodable, []);
});

test("encodings and scripts report the same counters", () => {
  for (const name of ["rpy", "rpyc", "mixed", "lineless"]) {
    const result = extractRenpyProject(fixtureProject(name));
    assert.deepEqual(result.encodings, result.scripts, name);
    // Separate objects, so a caller cannot corrupt one through the other.
    assert.notEqual(result.encodings, result.scripts, name);
  }
});

test("the result keeps the shape extractProject produces", () => {
  const result = extractRenpyProject(fixtureProject("rpy"));

  assert.deepEqual(sortedKeys(result), [
    "commandCounts",
    "encodings",
    "entries",
    "perFile",
    "scripts",
    "totalStrings",
    "undecodable",
  ]);
  assert.deepEqual(result.commandCounts, {});
  assert.ok(result.entries instanceof Map);
  for (const entry of result.entries.values()) {
    assert.deepEqual(sortedKeys(entry), ["contexts", "count", "locators", "text"]);
    assert.ok(entry.contexts instanceof Set);
    assert.ok(entry.locators instanceof Set);
    assert.equal(typeof entry.count, "number");
    assert.equal(typeof entry.text, "string");
  }
});

test("a root without a game directory yields an empty result", () => {
  const result = extractRenpyProject(fixtureProject("no-such-project"));

  assert.equal(result.entries.size, 0);
  assert.deepEqual(result.perFile, {});
  assert.equal(result.totalStrings, 0);
  assert.deepEqual(result.undecodable, []);
  assert.deepEqual(result.scripts, { rpy: 0, rpyc: 0 });
});

test("collectRenpyUnits exposes the units behind the extractor", () => {
  const collected = collectRenpyUnits(fixtureProject("rpy"));

  assert.deepEqual(sortedKeys(collected), ["scripts", "undecodable", "units"]);
  assert.equal(collected.units.length, 8);
  assert.deepEqual(collected.scripts, { rpy: 2, rpyc: 0 });
  assert.deepEqual(collected.undecodable, []);
  assert.deepEqual(collected.units[0], {
    text: "Alpha line one.",
    kind: "say",
    file: "game/script.rpy",
    line: 5,
  });
  // Undeduplicated: the shared line is present once per file it appears in.
  const shared = collected.units.filter((unit) => unit.text === "Shared echo line.");
  assert.equal(shared.length, 2);
  assert.deepEqual(
    shared.map((unit) => [unit.file, unit.line, unit.kind]),
    [
      ["game/script.rpy", 18, "say"],
      ["game/sub/chapter.rpy", 3, "say"],
    ],
  );
  // Menu strings keep their own kind; the extractor does not flatten it away.
  assert.deepEqual(
    collected.units.filter((unit) => unit.kind === "menu").map((unit) => unit.text),
    ["Gamma menu caption.", "Delta choice one.", "Epsilon choice two."],
  );
});
