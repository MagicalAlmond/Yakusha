/**
 * Kirikiri patch delivery (src/engines/krkr/patch.js).
 *
 * The fixtures are generated archives with real XP3 headers, so the patch
 * writer is exercised against the same container shape a retail game uses.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { installPatch, manifestPath, patchStatus, uninstallPatch } from "../src/engines/krkr/patch.js";
import { extractKrkrProject } from "../src/engines/krkr/extract.js";
import { buildXp3 } from "../src/engines/krkr/xp3writer.js";
import { decodeKs } from "../src/engines/krkr/ks.js";
import { openXp3 } from "../src/engines/krkr/xp3.js";

const created = [];
function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-krkr-patch-"));
  created.push(dir);
  return dir;
}
test.after(() => {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
});

function writeProject(parent, archives) {
  const root = path.join(parent, "game");
  const dataDir = path.join(root, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  for (const archive of archives) {
    fs.writeFileSync(path.join(dataDir, archive.name), buildXp3(archive.files));
  }
  return { root, dataDir, archives: archives.map((archive) => path.join(dataDir, archive.name)) };
}

function source(text) {
  return Buffer.from(text, "utf8");
}

test("installPatch writes a patch archive that overrides one .ks file", () => {
  const { root, dataDir, archives } = writeProject(tempDir(), [
    {
      name: "data.xp3",
      files: [{ name: "scenario/s1.ks", data: source("[name_set name='Aoi']\nこんにちは\n[p]\n"), mode: 1 }],
    },
  ]);
  const project = { root, dataDir, archives };
  const dict = {
    entries: {
      "こんにちは": { text: "你好", contexts: ["scenario/s1.ks:2"], locator: ["data.xp3:scenario/s1.ks:2"] },
    },
  };
  const result = installPatch(project, dict);
  assert.equal(result.archive, "patch.xp3");
  assert.equal(result.entries, 1);
  assert.equal(result.files, 1);
  assert.ok(fs.existsSync(path.join(dataDir, "patch.xp3")));
  const archive = openXp3(result.path);
  const entry = archive.entry("scenario/s1.ks");
  assert.ok(entry, "the patch keeps the original relative path");
  const decoded = decodeKs(entry.read());
  assert.equal(decoded.undecodable, false);
  const lines = decoded.text.split(/\r?\n/);
  assert.equal(lines[0], "[name_set name='Aoi']");
  assert.equal(lines[1], "你好");
  assert.match(fs.readFileSync(manifestPath(project), "utf8"), /"archive": "patch\.xp3"/);
});

test("installPatch never overwrites a patch the game already ships", () => {
  const parent = tempDir();
  const { root, dataDir, archives } = writeProject(parent, [
    { name: "data.xp3", files: [{ name: "s.ks", data: source("こんにちは\n"), mode: 1 }] },
    { name: "patch.xp3", files: [{ name: "s.ks", data: source("既存のパッチ\n"), mode: 1 }] },
  ]);
  const project = { root, dataDir, archives };
  const before = fs.readFileSync(path.join(dataDir, "patch.xp3"));
  const result = installPatch(project, {
    entries: {
      "こんにちは": { text: "你好", contexts: ["s.ks:1"], locator: ["data.xp3:s.ks:1"] },
      "既存のパッチ": { text: "现有补丁", contexts: ["s.ks:1"], locator: ["patch.xp3:s.ks:1"] },
    },
  });
  assert.equal(result.archive, "patch2.xp3");
  assert.deepEqual(fs.readFileSync(path.join(dataDir, "patch.xp3")), before);
  assert.ok(fs.existsSync(path.join(dataDir, "patch2.xp3")));
});

test("installPatch keeps inline tags and clears later visible runs", () => {
  const { root, dataDir, archives } = writeProject(tempDir(), [
    { name: "data.xp3", files: [{ name: "s.ks", data: source("[b]こんにちは[/b] 世界\n"), mode: 1 }] },
  ]);
  const project = { root, dataDir, archives };
  const result = installPatch(project, {
    entries: { "こんにちは 世界": { text: "你好", contexts: ["s.ks:1"], locator: ["data.xp3:s.ks:1"] } },
  });
  assert.equal(result.entries, 1);
  const entry = openXp3(result.path).entry("s.ks");
  const decoded = decodeKs(entry.read());
  assert.equal(decoded.text.split(/\r?\n/)[0], "[b]你好[/b] ");
});

test("uninstallPatch removes only Yakusha's archive and manifest", () => {
  const parent = tempDir();
  const { root, dataDir, archives } = writeProject(parent, [
    { name: "data.xp3", files: [{ name: "s.ks", data: source("こんにちは\n"), mode: 1 }] },
  ]);
  const project = { root, dataDir, archives };
  const result = installPatch(project, {
    entries: { "こんにちは": { text: "你好", contexts: ["s.ks:1"], locator: ["data.xp3:s.ks:1"] } },
  });
  const first = uninstallPatch(project, {});
  assert.equal(first.removed, true);
  assert.equal(fs.existsSync(result.path), false);
  assert.equal(fs.existsSync(manifestPath(project)), false);
  const second = uninstallPatch(project, {});
  assert.equal(second.removed, false);
});


test("installPatch --dry-run reports the plan and writes nothing", () => {
  const { root, dataDir, archives } = writeProject(tempDir(), [
    { name: "data.xp3", files: [{ name: "s.ks", data: source("こんにちは\n"), mode: 1 }] },
  ]);
  const project = { root, dataDir, archives };
  const result = installPatch(project, {
    entries: { "こんにちは": { text: "你好", contexts: ["s.ks:1"], locator: ["data.xp3:s.ks:1"] } },
  }, { dryRun: true });
  assert.equal(result.dryRun, true);
  assert.equal(result.entries, 1);
  assert.equal(result.files, 1);
  assert.equal(fs.existsSync(path.join(dataDir, "patch.xp3")), false);
  assert.equal(fs.existsSync(manifestPath(project)), false);
});

test("patchStatus reports a manifest whose archive was deleted as damaged", () => {
  const { root, dataDir, archives } = writeProject(tempDir(), [
    { name: "data.xp3", files: [{ name: "s.ks", data: source("こんにちは\n"), mode: 1 }] },
  ]);
  const project = { root, dataDir, archives };
  const result = installPatch(project, {
    entries: { "こんにちは": { text: "你好", contexts: ["s.ks:1"], locator: ["data.xp3:s.ks:1"] } },
  });
  fs.rmSync(result.path);
  const status = patchStatus(project);
  assert.equal(status.exists, false);
  assert.equal(status.intact, false);
  assert.deepEqual(status.problems, ["the patch archive is missing"]);
});

test("extract skips the archive Yakusha installed", () => {
  const { root, dataDir, archives } = writeProject(tempDir(), [
    { name: "data.xp3", files: [{ name: "s.ks", data: source("こんにちは\n"), mode: 1 }] },
  ]);
  const project = { root, dataDir, archives };
  installPatch(project, {
    entries: { "こんにちは": { text: "你好", contexts: ["s.ks:1"], locator: ["data.xp3:s.ks:1"] } },
  });
  const extracted = extractKrkrProject(root);
  assert.equal(extracted.documents, 1);
  assert.deepEqual([...extracted.entries.keys()], ["こんにちは"]);
  assert.equal(extracted.entries.has("你好"), false);
});
test("patchStatus reports a missing patch and an installed one", () => {
  const { root, dataDir, archives } = writeProject(tempDir(), [
    { name: "data.xp3", files: [{ name: "s.ks", data: source("こんにちは\n"), mode: 1 }] },
  ]);
  const project = { root, dataDir, archives };
  assert.equal(patchStatus(project).exists, false);
  installPatch(project, {
    entries: { "こんにちは": { text: "你好", contexts: ["s.ks:1"], locator: ["data.xp3:s.ks:1"] } },
  });
  const status = patchStatus(project);
  assert.equal(status.exists, true);
  assert.equal(status.entries, 1);
  assert.equal(status.intact, true);
  assert.equal(status.dictionaryStale, false);
});
