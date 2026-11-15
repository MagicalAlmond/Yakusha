import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

import { extractRenpyProject } from "../src/engines/renpy/extract.js";
import { looksLikeRenpyProject, openRenpyProject } from "../src/engines/renpy/project.js";
import { readRpaEntry, readRpaIndex } from "../src/engines/renpy/rpa.js";

/** One synthetic archive entry. */
const KEY = 0xdeadbeef;

/**
 * A positive integer as a Python pickle LONG1 payload.
 *
 * @param {number} value non-negative safe integer
 * @returns {Buffer} opcode, length and little-endian two's-complement bytes
 */
function long1(value) {
  const bytes = [];
  let rest = value;
  do {
    bytes.push(rest % 256);
    rest = Math.floor(rest / 256);
  } while (rest > 0);
  if ((bytes[bytes.length - 1] & 0x80) !== 0) bytes.push(0);
  return Buffer.from([0x8a, bytes.length, ...bytes]);
}

/**
 * A Python pickle BINUNICODE string.
 *
 * @param {string} text
 * @returns {Buffer}
 */
function pickleText(text) {
  const body = Buffer.from(text, "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32LE(body.length, 0);
  return Buffer.concat([Buffer.from([0x58]), length, body]);
}

/**
 * A pickle tuple for one RPA segment.
 *
 * @param {number} offset decoded offset
 * @param {number} length decoded length
 * @param {Buffer|null} prefix bytes stored in the index
 * @param {number} key XOR key; 0 for RPA-4.x
 * @returns {Buffer}
 */
function pickleSegment(offset, length, prefix, key = KEY) {
  const encodedOffset = key === 0 ? offset : (offset ^ key) >>> 0;
  const encodedLength = key === 0 ? length : (length ^ key) >>> 0;
  const parts = [long1(encodedOffset), long1(encodedLength)];
  if (prefix === null) {
    parts.push(Buffer.from([0x86]));
  } else {
    parts.push(Buffer.from([0x43, prefix.length]), prefix, Buffer.from([0x87]));
  }
  return Buffer.concat(parts);
}

/**
 * A pickle list holding one or more segment tuples.
 *
 * @param {Array<{offset: number, length: number, prefix: Buffer|null}>} segments
 * @param {number} key XOR key; 0 for RPA-4.x
 * @returns {Buffer}
 */
function pickleSegments(segments, key = KEY) {
  const parts = [Buffer.from([0x5d])];
  for (const segment of segments) {
    parts.push(pickleSegment(segment.offset, segment.length, segment.prefix, key), Buffer.from([0x61]));
  }
  return Buffer.concat(parts);
}

/**
 * A Python pickle dictionary mapping an entry name to a segment list.
 *
 * @param {Array<{name: string, segments: Array<{offset: number, length: number, prefix: Buffer|null}>}>} entries
 * @param {number} key XOR key; 0 for RPA-4.x
 * @returns {Buffer}
 */
function pickleIndex(entries, key = KEY) {
  const parts = [Buffer.from([0x80, 0x02, 0x7d])];
  for (const entry of entries) {
    parts.push(pickleText(entry.name), pickleSegments(entry.segments, key), Buffer.from([0x73]));
  }
  parts.push(Buffer.from([0x2e]));
  return Buffer.concat(parts);
}

/**
 * Build one RPA archive with a single segment per entry.
 *
 * @param {Array<{name: string, data: Buffer, prefix?: Buffer}>} entries
 * @param {"3.0"|"4.0"} version archive format
 * @returns {Buffer}
 */
function buildArchive(entries, version = "3.0") {
  const major = version.startsWith("4.") ? 4 : 3;
  const key = major === 4 ? 0 : KEY;
  const headerSize = major === 4 ? 25 : 34;
  let cursor = headerSize;
  const bodies = [];
  const indexEntries = [];
  for (const entry of entries) {
    const prefix = entry.prefix ?? Buffer.alloc(0);
    assert.ok(entry.data.subarray(0, prefix.length).equals(prefix), "prefix must lead the data");
    const body = entry.data.subarray(prefix.length);
    const offset = cursor;
    cursor += body.length;
    bodies.push(body);
    indexEntries.push({
      name: entry.name,
      segments: [{ offset, length: entry.data.length, prefix: prefix.length === 0 ? null : prefix }],
    });
  }
  const indexOffset = cursor;
  const headerText =
    major === 4
      ? "RPA-" + version + " " + indexOffset.toString(16).padStart(16, "0") + "\n"
      : "RPA-" + version + " " + indexOffset.toString(16).padStart(16, "0") + " " + KEY.toString(16).padStart(8, "0") + "\n";
  const header = Buffer.from(headerText, "ascii");
  assert.equal(header.length, headerSize);
  return Buffer.concat([header, ...bodies, zlib.deflateSync(pickleIndex(indexEntries, key))]);
}

/**
 * Create a throwaway directory.
 *
 * @returns {string} absolute path
 */
function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-renpy-rpa-"));
}

/**
 * Create the minimal packaged-game layout: game/ plus the Ren'Py runtime.
 *
 * @param {string} root project root
 */
function packagedLayout(root) {
  fs.mkdirSync(path.join(root, "game"), { recursive: true });
  fs.mkdirSync(path.join(root, "renpy"), { recursive: true });
}

test("readRpaIndex reads a RPA-3.0 archive and readRpaEntry returns its bytes", () => {
  const root = tempDir();
  try {
    const prefix = Buffer.from("pre", "utf8");
    const body = Buffer.from("fix-body", "utf8");
    const data = Buffer.concat([prefix, body]);
    const archive = path.join(root, "archive.rpa");
    fs.writeFileSync(archive, buildArchive([{ name: "a.txt", data, prefix }]));

    const index = readRpaIndex(archive);
    assert.equal(index.version, "3.0");
    assert.equal(index.key, KEY);
    assert.equal(index.entries.size, 1);
    const entry = index.entries.get("a.txt");
    assert.ok(entry);
    assert.deepEqual(readRpaEntry(archive, entry), data);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("readRpaIndex reads an RPA-4.0 archive without an xor key", () => {
  const root = tempDir();
  try {
    const archive = path.join(root, "archive.rpa");
    fs.writeFileSync(archive, buildArchive([{ name: "a.txt", data: Buffer.from("plain-body", "utf8") }], "4.0"));

    const index = readRpaIndex(archive);
    assert.equal(index.version, "4.0");
    assert.equal(index.key, 0);
    const entry = index.entries.get("a.txt");
    assert.ok(entry);
    assert.equal(readRpaEntry(archive, entry).toString("utf8"), "plain-body");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a packaged game is detected and its archived scripts are extracted", () => {
  const root = tempDir();
  try {
    packagedLayout(root);
    const compiled = fs.readFileSync(fileURLToPath(new URL("./fixtures/renpy-rpyc/game/script.rpyc", import.meta.url)));
    const source = Buffer.from('label start:\n    "Archive line."\n', "utf8");
    const ignored = Buffer.from('translate schinese strings:\n    old "Ignored line."\n    new "译:Ignored line."\n', "utf8");
    fs.writeFileSync(
      path.join(root, "game", "archive.rpa"),
      buildArchive([
        { name: "script/a.rpyc", data: compiled },
        { name: "script/b.rpy", data: source },
        { name: "tl/None/common.rpym", data: ignored },
      ])
    );

    assert.equal(looksLikeRenpyProject(root), true);
    assert.equal(openRenpyProject(root).root, root);

    const result = extractRenpyProject(root);
    assert.deepEqual(result.scripts, { rpy: 1, rpyc: 1 });
    assert.deepEqual(Object.keys(result.perFile).sort(), [
      "game/archive.rpa!script/a.rpyc",
      "game/archive.rpa!script/b.rpy",
    ]);
    assert.deepEqual([...result.entries.get("Settings").contexts], ["game/archive.rpa!script/a.rpyc:26"]);
    assert.deepEqual([...result.entries.get("Archive line.").contexts], ["game/archive.rpa!script/b.rpy:2"]);
    assert.equal(result.entries.has("Ignored line."), false);
    assert.deepEqual(result.undecodable, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a loose script wins over an archived script with the same stem", () => {
  const root = tempDir();
  try {
    packagedLayout(root);
    fs.writeFileSync(path.join(root, "game", "script.rpy"), 'label start:\n    "Loose line."\n');
    fs.writeFileSync(
      path.join(root, "game", "archive.rpa"),
      buildArchive([{ name: "script.rpy", data: Buffer.from('label start:\n    "Archived line."\n') }])
    );

    const result = extractRenpyProject(root);
    assert.deepEqual(result.scripts, { rpy: 1, rpyc: 0 });
    assert.deepEqual([...result.entries.keys()], ["Loose line."]);
    assert.deepEqual(result.perFile, { "game/script.rpy": 1 });
    assert.deepEqual(result.undecodable, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a malformed archive is reported without losing the good archive", () => {
  const root = tempDir();
  try {
    packagedLayout(root);
    fs.writeFileSync(path.join(root, "game", "bad.rpa"), Buffer.from("RPA-3.0 0000000000000000 deadbeef\nnot a zlib stream"));
    fs.writeFileSync(
      path.join(root, "game", "good.rpa"),
      buildArchive([{ name: "script/good.rpy", data: Buffer.from('label start:\n    "Good line."\n') }])
    );

    const result = extractRenpyProject(root);
    assert.deepEqual([...result.entries.keys()], ["Good line."]);
    assert.deepEqual(result.perFile, { "game/good.rpa!script/good.rpy": 1 });
    assert.equal(result.undecodable.length, 1);
    assert.equal(result.undecodable[0].file, "game/bad.rpa");
    assert.match(result.undecodable[0].error, /incorrect header check|RPA index/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
