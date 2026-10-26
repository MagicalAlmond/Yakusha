/**
 * Reading an RGSS game directory (src/engines/rgss/project.js).
 *
 * Everything here comes from `Game.ini`, the archive name and the data file
 * extensions, so the tests build those three shapes by hand and check the
 * answers a caller acts on: which root, which engine version, which title.
 */

import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  EDITION_NAMES,
  DATA_DIR,
  INI_FILE,
  decodeIni,
  detectVersion,
  findRgssRoot,
  findRgssRoots,
  looksLikeRgssProject,
  openDataSource,
  openRgssProject,
  parseIni,
  readIni,
  versionOfDataFile,
  versionOfLibrary,
} from "../src/engines/rgss/project.js";
import { writeArchive } from "../src/engines/rgss/archive.js";

const created = [];

after(() => {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
});

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-rgss-project-"));
  created.push(dir);
  return dir;
}

const INI = [
  "[Game]",
  "RTP=",
  "Library=System\\RGSS300.dll",
  "Scripts=Data\\Scripts.rvdata2",
  "Title=Synthetic Quest",
  "Version=1.0",
  "",
].join("\r\n");

/** Write a game directory with a Game.ini and a Data folder. */
function gameDir(options = {}) {
  const dir = sandbox();
  fs.writeFileSync(path.join(dir, INI_FILE), options.ini ?? INI, "latin1");
  if (options.data !== false) {
    fs.mkdirSync(path.join(dir, DATA_DIR), { recursive: true });
    for (const name of options.files ?? ["Actors.rvdata2"]) {
      fs.writeFileSync(path.join(dir, DATA_DIR, name), Buffer.from([4, 8, 0x30]));
    }
  }
  return dir;
}
test("project: ini decoding keeps a legacy encoding readable", () => {
  assert.equal(parseIni("[Game]\r\nTitle=Synthetic Quest\r\n").title, "Synthetic Quest");
  // A byte order mark, blank lines and comments are not keys.
  const values = parseIni("\uFEFF[Game]\r\n\r\n; note\r\nTitle=X\r\nTitle=Y\r\n");
  assert.equal(values.title, "X", "the first spelling wins, as in the engine");
  assert.equal(Object.prototype.hasOwnProperty.call(values, "; note"), false);
  // GBK bytes for the two characters of a title decode to text, not to boxes.
  const gbk = Buffer.concat([Buffer.from("Title=", "latin1"), Buffer.from([0xd6, 0xd0, 0xce, 0xc4])]);
  assert.equal(parseIni(gbk).title, "\u4e2d\u6587");
});

test("project: readIni returns an empty object when there is no ini", () => {
  assert.deepEqual(readIni(sandbox()), {});
});

test("project: a library name implies the engine version", () => {
  assert.equal(versionOfLibrary("System\\RGSS300.dll"), 3);
  assert.equal(versionOfLibrary("System\\RGSS301.dll"), 3);
  assert.equal(versionOfLibrary("System\\RGSS202E.dll"), 2);
  assert.equal(versionOfLibrary("System\\RGSS104E.dll"), 1);
  assert.equal(versionOfLibrary("System\\RGSS102E.dll"), 1);
  assert.equal(versionOfLibrary("something else"), null);
  assert.equal(versionOfLibrary(null), null);
});

test("project: a data file extension implies the engine version", () => {
  assert.equal(versionOfDataFile("Actors.rvdata2"), 3);
  assert.equal(versionOfDataFile("Actors.rvdata"), 2);
  assert.equal(versionOfDataFile("Actors.rxdata"), 1);
  assert.equal(versionOfDataFile("Actors.json"), null);
});

test("project: a directory with a Game.ini looks like an RGSS project", () => {
  const dir = gameDir();
  assert.equal(looksLikeRgssProject(dir), true);
  assert.equal(looksLikeRgssProject(sandbox()), false);
});

test("project: a game whose data is entirely packed is still a project", () => {
  const dir = sandbox();
  fs.writeFileSync(path.join(dir, INI_FILE), INI, "latin1");
  writeArchive(path.join(dir, "Game.rgss3a"), { version: 3, entries: [{ name: "Data/System.rvdata2", data: Buffer.from([4, 8]) }] });
  assert.equal(looksLikeRgssProject(dir), true);
  const project = openRgssProject(dir);
  assert.equal(path.basename(project.archive), "Game.rgss3a");
});

test("project: the version comes from the archive, the library or the files", () => {
  const dir = gameDir();
  assert.equal(detectVersion(dir, readIni(dir)), 3, "RGSS300.dll is VX Ace");
  assert.equal(detectVersion(dir, {}), 3, "rvdata2 files are VX Ace");

  const vx = gameDir({ ini: "Library=System\\RGSS202E.dll\r\n", files: ["Actors.rvdata"] });
  assert.equal(detectVersion(vx, readIni(vx)), 2);

  const xp = gameDir({ ini: "Library=System\\RGSS104E.dll\r\n", files: ["Actors.rxdata"] });
  assert.equal(detectVersion(xp, readIni(xp)), 1);

  assert.equal(detectVersion(sandbox(), {}), null);
});
test("project: the ini decoder prefers UTF-8 and falls back to a legacy charset", () => {
  assert.equal(decodeIni(Buffer.from("Title=Synthetic Quest", "utf8")), "Title=Synthetic Quest");
  const gbk = Buffer.concat([Buffer.from("Title=", "latin1"), Buffer.from([0xd6, 0xd0, 0xce, 0xc4])]);
  assert.equal(decodeIni(gbk), "Title=\u4e2d\u6587");
  // Shift_JIS kana are decisive: the same bytes could not be Chinese text.
  const sjis = Buffer.concat([Buffer.from("Title=", "latin1"), Buffer.from([0x83, 0x65, 0x83, 0x58, 0x83, 0x67])]);
  assert.equal(decodeIni(sjis), "Title=\u30c6\u30b9\u30c8");
});

test("project: openRgssProject reports the identity a caller prints", () => {
  const dir = gameDir({ files: ["System.rvdata2", "Actors.rvdata2"] });
  const project = openRgssProject(dir);
  assert.equal(project.root, path.resolve(dir));
  assert.equal(project.engine, "rgss");
  assert.equal(project.version, "3");
  assert.equal(project.edition, "VX Ace");
  assert.equal(project.gameTitle, "Synthetic Quest");
  assert.equal(project.dataDir, DATA_DIR);
  // RGSS has no plugin system, so every plugin slot stays empty.
  assert.equal(project.pluginDir, null);
  assert.equal(project.pluginsFile, null);
  assert.equal(project.indexPath, null);
  assert.equal(project.archive, null);
  assert.equal(project.ini.library, "System\\RGSS300.dll");
});

test("project: a title-less game falls back to its directory name", () => {
  // A Game.ini and nothing else: no library, no archive, no data extension, so
  // the engine version stays unknown and the title falls back to the folder.
  const dir = gameDir({ ini: "[Game]\r\nVersion=1.0\r\n", data: false });
  const project = openRgssProject(dir);
  assert.equal(project.gameTitle, path.basename(dir));
  assert.equal(project.version, null);
  assert.equal(project.edition, null);
});

test("project: a game found one level down is opened from the parent", () => {
  const parent = sandbox();
  const root = path.join(parent, "Game");
  fs.mkdirSync(path.join(root, DATA_DIR), { recursive: true });
  fs.writeFileSync(path.join(root, INI_FILE), INI, "latin1");
  fs.writeFileSync(path.join(root, DATA_DIR, "Actors.rvdata2"), Buffer.from([4, 8, 0x30]));
  assert.equal(findRgssRoot(parent), root);
  assert.equal(openRgssProject(parent).root, root);
});

test("project: two games side by side are refused, with both paths listed", () => {
  const parent = sandbox();
  for (const name of ["First", "Second"]) {
    const root = path.join(parent, name);
    fs.mkdirSync(path.join(root, DATA_DIR), { recursive: true });
    fs.writeFileSync(path.join(root, INI_FILE), INI, "latin1");
    fs.writeFileSync(path.join(root, DATA_DIR, "Actors.rvdata2"), Buffer.from([4, 8, 0x30]));
  }
  assert.equal(findRgssRoots(parent).length, 2);
  assert.throws(() => findRgssRoot(parent), /^Error: found 2 RGSS projects under /);
  assert.throws(() => findRgssRoot(parent), /pass one of them instead/);
});

test("project: a directory with nothing in it is not a project", () => {
  const dir = sandbox();
  assert.equal(findRgssRoot(dir), null);
  assert.throws(() => openRgssProject(dir), /not an RGSS project/);
});
test("project: an unpacked game reads its Data folder", () => {
  const dir = gameDir({ files: ["System.rvdata2", "Actors.rvdata2"] });
  const source = openDataSource(openRgssProject(dir));
  try {
    assert.equal(source.kind, "directory");
    assert.deepEqual(source.names().sort(), ["Actors.rvdata2", "System.rvdata2"]);
    assert.equal(source.has("Actors.rvdata2"), true);
    assert.deepEqual(source.read("Actors.rvdata2"), Buffer.from([4, 8, 0x30]));
    assert.equal(source.has("Missing.rvdata2"), false);
    assert.equal(source.read("Missing.rvdata2"), null);
  } finally {
    source.close();
  }
});

test("project: a packed game reads the same names out of the archive", () => {
  const dir = sandbox();
  fs.writeFileSync(path.join(dir, INI_FILE), INI, "latin1");
  writeArchive(path.join(dir, "Game.rgss3a"), {
    version: 3,
    entries: [
      { name: "Data/System.rvdata2", data: Buffer.from([4, 8, 0x30]) },
      { name: "Data/Map001.rvdata2", data: Buffer.from([4, 8, 0x5b]) },
      { name: "Graphics/Pictures/title.png", data: Buffer.from([0x89, 0x50]) },
    ],
  });
  const source = openDataSource(openRgssProject(dir));
  try {
    assert.equal(source.kind, "archive");
    assert.equal(source.version, 3);
    // Only Data/ is exposed: a caller walking data documents never sees art.
    assert.deepEqual(source.names().sort(), ["Map001.rvdata2", "System.rvdata2"]);
    assert.deepEqual(source.read("System.rvdata2"), Buffer.from([4, 8, 0x30]));
    assert.equal(source.has("Map001.rvdata2"), true);
  } finally {
    source.close();
  }
});

test("project: every edition name is spelled the way the engine names it", () => {
  assert.deepEqual(EDITION_NAMES, { 1: "XP", 2: "VX", 3: "VX Ace" });
});
