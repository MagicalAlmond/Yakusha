/**
 * RGSSAD / RGSS2A / RGSS3A archives (src/engines/rgss/archive.js).
 *
 * The archive is the whole game: the data documents, the graphics and the
 * audio all live inside it, so a reader that gets one byte of key rotation
 * wrong produces garbage with no error. These tests write archives with the
 * same module and read them back, which pins both directions of the cipher.
 */

import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  ArchiveError,
  decryptPayload,
  encryptPayload,
  findArchive,
  openArchive,
  writeArchive,
} from "../src/engines/rgss/archive.js";

const created = [];

after(() => {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
});

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-rgss-archive-"));
  created.push(dir);
  return dir;
}

const FILES = [
  { name: "Data/System.rvdata2", data: Buffer.from([4, 8, 0x30]) },
  { name: "Data/Map001.rvdata2", data: Buffer.from("0123456789abcdef", "utf8") },
  { name: "Graphics/Tilesets/\u6d77\u306e\u7826.png", data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]) },
  { name: "Audio/BGM/theme.ogg", data: Buffer.from([0x4f, 0x67, 0x67, 0x53, 0, 0]) },
];

const EXTENSIONS = { 1: "Game.rgssad", 2: "Game.rgss2a", 3: "Game.rgss3a" };
const KINDS = { 1: "rgssad", 2: "rgss2a", 3: "rgss3a" };
for (const version of [1, 2, 3]) {
  test("archive: version " + version + " writes and reads back every entry", () => {
    const file = path.join(sandbox(), EXTENSIONS[version]);
    const written = writeArchive(file, { version, entries: FILES });
    assert.equal(written.version, version);
    assert.equal(written.entries, FILES.length);

    const archive = openArchive(file);
    try {
      assert.equal(archive.version, version);
      assert.equal(archive.kind, KINDS[version]);
      assert.deepEqual(archive.names().sort(), FILES.map((entry) => entry.name).sort());
      for (const entry of FILES) {
        assert.equal(archive.has(entry.name), true, entry.name);
        assert.deepEqual(archive.read(entry.name), entry.data, entry.name);
      }
      assert.equal(archive.has("Data/Missing.rvdata2"), false);
    } finally {
      archive.close();
    }
  });
}

test("archive: the same input twice produces the same bytes", () => {
  const dir = sandbox();
  for (const version of [1, 2, 3]) {
    const first = path.join(dir, "a-" + version + ".bin");
    const second = path.join(dir, "b-" + version + ".bin");
    writeArchive(first, { version, entries: FILES });
    writeArchive(second, { version, entries: FILES });
    assert.deepEqual(fs.readFileSync(first), fs.readFileSync(second), "version " + version);
  }
});

test("archive: an empty archive is still a readable archive", () => {
  const file = path.join(sandbox(), "Game.rgss3a");
  writeArchive(file, { version: 3, entries: [] });
  const archive = openArchive(file);
  try {
    assert.deepEqual(archive.names(), []);
  } finally {
    archive.close();
  }
});

test("archive: backslashes in the archive become forward slashes", () => {
  const file = path.join(sandbox(), "Game.rgssad");
  writeArchive(file, { version: 1, entries: [{ name: "Data\\System.rvdata2", data: Buffer.from([1]) }] });
  const archive = openArchive(file);
  try {
    assert.deepEqual(archive.names(), ["Data/System.rvdata2"]);
  } finally {
    archive.close();
  }
});
test("archive: a file that is not an archive is refused", () => {
  const dir = sandbox();
  const empty = path.join(dir, "empty.bin");
  fs.writeFileSync(empty, Buffer.alloc(0));
  assert.throws(() => openArchive(empty), /not an RGSS archive/);

  const wrong = path.join(dir, "wrong.bin");
  fs.writeFileSync(wrong, Buffer.concat([Buffer.from("NOTRGSS\0", "latin1"), Buffer.from([3])]));
  assert.throws(() => openArchive(wrong), /not an RGSS archive/);

  const badVersion = path.join(dir, "v9.bin");
  fs.writeFileSync(badVersion, Buffer.concat([Buffer.from("RGSSAD\0", "latin1"), Buffer.from([9])]));
  assert.throws(() => openArchive(badVersion), /unsupported RGSS archive version 9/);
});

test("archive: writing an unknown version is refused", () => {
  assert.throws(() => writeArchive(path.join(sandbox(), "x.bin"), { version: 4, entries: [] }), ArchiveError);
});

test("archive: a truncated archive is refused, not read short", () => {
  const file = path.join(sandbox(), "Game.rgss3a");
  writeArchive(file, { version: 3, entries: FILES });
  const bytes = fs.readFileSync(file);
  fs.writeFileSync(file, bytes.subarray(0, bytes.length - 4));
  // The last entry now points past the end of the file. Noticing that while
  // reading the directory is better than handing back a short buffer later.
  assert.throws(() => openArchive(file), /points past the end of the file/);
});

test("archive: closing twice is safe", () => {
  const file = path.join(sandbox(), "Game.rgss2a");
  writeArchive(file, { version: 2, entries: FILES });
  const archive = openArchive(file);
  archive.close();
  archive.close();
});

test("archive: findArchive prefers the hint, then the usual names, then any archive", () => {
  const dir = sandbox();
  assert.equal(findArchive(dir), null);

  writeArchive(path.join(dir, "Game.rgssad"), { version: 1, entries: FILES });
  assert.equal(path.basename(findArchive(dir)), "Game.rgssad");

  writeArchive(path.join(dir, "Game.rgss3a"), { version: 3, entries: FILES });
  assert.equal(path.basename(findArchive(dir)), "Game.rgss3a", "the newest version wins");

  writeArchive(path.join(dir, "Game.rgss2a"), { version: 2, entries: FILES });
  assert.equal(path.basename(findArchive(dir, ["Game.rgss2a"])), "Game.rgss2a", "an explicit hint wins");
  assert.equal(path.basename(findArchive(dir, "Game.rgss2a")), "Game.rgss2a", "a single hint name works too");
});

test("archive: findArchive ignores a name that is not a plain file in the root", () => {
  const dir = sandbox();
  assert.equal(findArchive(dir, "nested/Game.rgss3a"), null);
});

test("archive: the payload cipher is its own inverse", () => {
  const plain = Buffer.from("0123456789abcdefghij", "utf8");
  for (const version of [1, 2, 3]) {
    const key = 12345;
    const encrypted = encryptPayload(plain, key, version);
    assert.notDeepEqual(encrypted, plain, "version " + version);
    assert.deepEqual(decryptPayload(encrypted, key, version), plain, "version " + version);
  }
});
