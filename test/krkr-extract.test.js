/**
 * Kirikiri extraction contract (src/engines/krkr/extract.js).
 *
 * Extraction walks the project archives, decodes every .ks script and merges
 * the strings into the same entry map the other engines produce. What it does
 * not do matters as much: .tjs files are counted, never read, and anything it
 * cannot decode is reported and skipped instead of failing the run.
 */

import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { extractKrkrProject } from "../src/engines/krkr/extract.js";
import { writeKrkrProject, KS_SCENARIO } from "./krkr-fixture.js";
import { buildXp3 } from "./krkr-fixture.js";

const created = [];
function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-krkr-extract-"));
  created.push(dir);
  return dir;
}

after(() => {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
});

const KS = (text) => Buffer.from(text, "utf8");

test("extract merges strings across archives with per-line contexts", () => {
  const parent = tempDir();
  const { root } = writeKrkrProject(parent, { name: "game", archives: [
    { archiveName: "data.xp3", files: [
      { name: "scenario/s1.ks", data: KS(KS_SCENARIO), mode: 1 },
    ] },
    { archiveName: "patch.xp3", files: [
      { name: "patch/new.ks", data: KS("[name_set name='Yuki']\nゆき「もうひとつのせりふ」\n"), mode: 1 },
    ] },
  ] });
  const result = extractKrkrProject(root);
  assert.equal(result.documents, 2);
  assert.deepEqual(result.scripts, { ks: 2, tjs: 0 });
  assert.deepEqual(result.encodings, { xp3: 2 });
  assert.equal(result.entries.size, 3);
  assert.equal(result.totalStrings, 3);
  const entry = result.entries.get("あおい「今日はよく晴れているね」");
  assert.ok(entry, "scenario text is collected");
  assert.deepEqual([...entry.contexts], ["scenario/s1.ks:2"]);
  assert.equal(entry.count, 1);
});

test("the same text twice in one file merges into one entry and counts both", () => {
  const parent = tempDir();
  const line = "のこ「同じせりふを二回言う」\n";
  const { root } = writeKrkrProject(parent, { archives: [
    { archiveName: "data.xp3", files: [{ name: "s.ks", data: KS(line + line) }] },
  ] });
  const result = extractKrkrProject(root);
  assert.equal(result.entries.size, 1);
  assert.equal(result.totalStrings, 2);
  const entry = [...result.entries.values()][0];
  assert.equal(entry.count, 2);
  assert.deepEqual([...entry.contexts], ["s.ks:1", "s.ks:2"]);
});

test(".tjs files are counted, never read", () => {
  const parent = tempDir();
  const { root } = writeKrkrProject(parent, { archives: [
    { archiveName: "data.xp3", files: [
      { name: "system/Init.tjs", data: KS('System.inform("side effect");') },
      { name: "s.ks", data: KS("[test]\nhello\n") },
    ] },
  ] });
  const result = extractKrkrProject(root);
  assert.deepEqual(result.scripts, { ks: 1, tjs: 1 });
  assert.equal(result.entries.size, 1, "tjs content never reaches the dictionary");
  assert.ok(![...result.entries.keys()].some((key) => key.includes("side effect")));
});

test("an undecodable script is reported and the rest of the run continues", () => {
  const parent = tempDir();
  const bad = Buffer.concat([Buffer.from([0x82, 0x9f]), Buffer.from([0x80]), Buffer.from("\ntext\n", "utf8")]);
  const { root } = writeKrkrProject(parent, { archives: [
    { archiveName: "data.xp3", files: [
      { name: "bad.ks", data: bad },
      { name: "good.ks", data: KS("[test]\nhello\n") },
    ] },
  ] });
  const result = extractKrkrProject(root);
  assert.equal(result.undecodable.length, 1);
  assert.match(result.undecodable[0].file, /bad\.ks$/);
  assert.match(result.undecodable[0].error, /undecodable byte/);
  assert.ok(result.entries.get("hello"), "good.ks still contributes its strings");
  assert.equal(result.entries.size, 3, "the undecodable script's decodable lines are still collected (partial recovery)");
});

test("a corrupt archive is reported; the other archives still extract", () => {
  const parent = tempDir();
  const { root, dataDir } = writeKrkrProject(parent, { archives: [
    { archiveName: "good.xp3", files: [{ name: "s.ks", data: KS("[test]\nhello\n") }] },
  ] });
  fs.writeFileSync(path.join(dataDir, "broken.xp3"), Buffer.from("definitely not an xp3 container, padding", "utf8"));
  const result = extractKrkrProject(root);
  assert.equal(result.documents, 1, "only the archive that opened is counted");
  assert.equal(result.undecodable.length, 1);
  assert.match(result.undecodable[0].file, /broken\.xp3$/);
  assert.equal(result.entries.size, 1);
});
