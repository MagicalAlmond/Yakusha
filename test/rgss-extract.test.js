/**
 * Reading the text out of an RGSS game (src/engines/rgss/extract.js).
 *
 * The fixtures are built by test/rgss-fixture.js: a game whose data documents
 * are written by the Marshal writer and, in the packed case, put inside an
 * archive by the archive writer. Both layouts must produce the same strings,
 * because a player sees the same game either way.
 */

import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { EXPECTED, writePackedProject, writeRgssProject } from "./rgss-fixture.js";
import {
  COMMAND_TEXT,
  RGSS_DB_FIELDS,
  extractRgssProject,
  baseName,
  isMapName,
  pickParams,
  walkCommands,
} from "../src/engines/rgss/extract.js";
import { marshal, makeString } from "../src/engines/rgss/marshal.js";

const created = [];

after(() => {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
});

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-rgss-extract-"));
  created.push(dir);
  return dir;
}

function plain() {
  return writeRgssProject(sandbox());
}

function packed() {
  return writePackedProject(sandbox());
}

/** The extracted texts, in the order the result lists them. */
function texts(result) {
  return [...result.entries.values()].map((entry) => entry.text);
}
test("extract: an unpacked game yields dialogue, choices, names and terms", () => {
  const result = extractRgssProject(plain());
  const found = texts(result);
  for (const line of EXPECTED.dialogue) assert.equal(found.includes(line), true, line);
  for (const line of EXPECTED.choices) assert.equal(found.includes(line), true, line);
  for (const line of EXPECTED.speakers) assert.equal(found.includes(line), true, line);
  for (const line of EXPECTED.renamed) assert.equal(found.includes(line), true, line);
  for (const line of EXPECTED.names) assert.equal(found.includes(line), true, line);
  for (const line of EXPECTED.terms) assert.equal(found.includes(line), true, line);
});

test("extract: editor comments, script lines and asset names are not text", () => {
  const found = texts(extractRgssProject(plain()));
  for (const line of EXPECTED.forbidden) assert.equal(found.includes(line), false, line);
});

test("extract: a packed game yields exactly the same strings", () => {
  const unpacked = extractRgssProject(plain());
  const packedResult = extractRgssProject(packed());
  assert.deepEqual(texts(packedResult), texts(unpacked));
  assert.deepEqual(packedResult.commandCounts, unpacked.commandCounts);
  assert.deepEqual(packedResult.perFile, unpacked.perFile);
});

test("extract: the shape is the one every other engine produces", () => {
  const result = extractRgssProject(plain());
  assert.equal(result.entries instanceof Map, true);
  assert.equal(result.documents, 7);
  assert.equal(result.entries.size, result.totalStrings, "no duplicate text in this fixture");
  assert.deepEqual(result.encodings, { rvdata2: 7 });
  assert.deepEqual(result.undecodable, []);
  for (const entry of result.entries.values()) assert.equal(entry.contexts instanceof Set, true);
  // Documents are counted, not files on disk: a packed game has none.
  assert.equal(extractRgssProject(packed()).documents, 7);
});

test("extract: a packed game records the documents as Marshal data", () => {
  assert.deepEqual(extractRgssProject(packed()).encodings, { marshal: 7 });
});

test("extract: every context names the file and where the text came from", () => {
  const result = extractRgssProject(plain());
  const actor = [...result.entries.values()].find((entry) => entry.text === "Yuki");
  assert.deepEqual([...actor.contexts], ["Actors.rvdata2:name"]);
  const line = [...result.entries.values()].find((entry) => entry.text === "This room exists only for the tests.");
  assert.deepEqual([...line.contexts], ["Map001.rvdata2:401"]);
  const term = [...result.entries.values()].find((entry) => entry.text === "Max HP");
  assert.deepEqual([...term.contexts], ["System.rvdata2:terms.params"]);
});

test("extract: text that appears twice is counted, not duplicated", () => {
  const result = extractRgssProject(plain());
  for (const entry of result.entries.values()) assert.equal(typeof entry.count, "number");
  const total = [...result.entries.values()].reduce((sum, entry) => sum + entry.count, 0);
  assert.equal(total, result.totalStrings);
});
test("extract: pickParams reads one slot or every string in a list", () => {
  const a = makeString("a");
  const b = makeString("b");
  assert.deepEqual(pickParams([a, 0], "0"), [a]);
  assert.deepEqual(pickParams([[a, b], 1], "0[]"), [a, b]);
  assert.deepEqual(pickParams([0, a], "0"), [], "a number is not text");
  assert.deepEqual(pickParams([null], "0"), []);
  assert.deepEqual(pickParams("not an array", "0"), []);
  assert.deepEqual(pickParams([[1, a]], "0[]"), [a], "non-string list items are skipped");
});

test("extract: walkCommands finds commands through every container shape", () => {
  const command = (code, parameters) => ({ __type: "object", className: "RPG::EventCommand", ivars: { "@code": code, "@parameters": parameters } });
  const seen = [];
  walkCommands(
    {
      __type: "object",
      className: "RPG::Map",
      ivars: {
        "@events": new Map([
          [1, { __type: "object", className: "RPG::Event", ivars: { "@pages": [{ __type: "object", className: "RPG::Event::Page", ivars: { "@list": [command(401, ["inside"])] } }] } }],
        ]),
        "@note": "not a command list",
      },
    },
    (parameters, code) => seen.push([code, parameters[0]])
  );
  assert.deepEqual(seen, [[401, "inside"]]);
});

test("extract: baseName and isMapName read the names the source reports", () => {
  assert.equal(baseName("Map001.rvdata2"), "Map001");
  assert.equal(baseName("Data/Map001.rvdata2"), "Map001");
  assert.equal(baseName("CommonEvents"), "CommonEvents");
  assert.equal(isMapName("Map001"), true);
  assert.equal(isMapName("MapInfo"), false);
  assert.equal(isMapName("MapInfos"), false);
});

test("extract: the command table lists exactly the codes that carry text", () => {
  assert.deepEqual(COMMAND_TEXT.map((rule) => rule.code), [101, 102, 320, 401, 405]);
  // 402 repeats the choice labels that 102 already carries, and 108 is an
  // editor comment, so neither is translated.
  assert.equal(COMMAND_TEXT.some((rule) => rule.code === 402), false);
  assert.equal(COMMAND_TEXT.some((rule) => rule.code === 108), false);
  assert.deepEqual(Object.keys(RGSS_DB_FIELDS).includes("System"), false);
});
