import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { extractProject, toSortedArray, listJsonFiles } from "../src/core/extract.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, "fixtures", "mini-mz");

test("extract finds the fixture strings", () => {
  const result = extractProject(FIXTURE);
  const texts = new Set(result.entries.keys());
  // database fields
  assert.ok(texts.has("アリア"));
  assert.ok(texts.has("ポーション"));
  assert.ok(texts.has("HPを50回復する。"));
  assert.ok(texts.has("火炎"));
  assert.ok(texts.has("炎で攻撃"));
  // System.json
  assert.ok(texts.has("テストゲーム"));
  assert.ok(texts.has("レベル"));
  assert.ok(texts.has("常時ダッシュ"));
  // common events and maps
  assert.ok(texts.has("おっさん"));
  assert.ok(texts.has("お金が足りない！"));
  assert.ok(texts.has("はい"));
  assert.ok(texts.has("酒場"));
  assert.ok(texts.has("スクロールテキスト"));
});

test("extract keeps escape codes byte identical", () => {
  const result = extractProject(FIXTURE);
  const texts = [...result.entries.keys()];
  assert.ok(texts.includes(String.raw`本当に\C[2]足りない\C[0]のか？`));
  assert.ok(texts.includes(String.raw`旅の途中で古い橋に差し掛かった…\N[1]`));
});

test("extract counts duplicates instead of collapsing them", () => {
  // 32 = 31 strings of text plus the CommonEvents entry name, which is a
  // database field and a command-bearing document at the same time.
  const result = extractProject(FIXTURE);
  assert.equal(result.entries.size, 32);
  assert.equal(result.totalStrings, 32);
  for (const entry of result.entries.values()) assert.equal(entry.count, 1);
});

test("CommonEvents yields both its name and its commands", () => {
  const result = extractProject(FIXTURE);
  assert.deepEqual([...result.entries.get("共通").contexts], ["CommonEvents.json:name"]);
  assert.deepEqual([...result.entries.get("お金が足りない！").contexts], ["CommonEvents.json:401"]);
});

test("extract records per file counts and command counts", () => {
  const result = extractProject(FIXTURE);
  assert.equal(result.perFile["Actors.json"], 3);
  assert.equal(result.perFile["System.json"], 14);
  assert.equal(result.perFile["CommonEvents.json"], 6);
  assert.equal(result.commandCounts["401"], 3);
  assert.equal(result.commandCounts["101"], 2);
  assert.equal(result.commandCounts["102"], 1);
});

test("extract attaches context labels", () => {
  const result = extractProject(FIXTURE);
  assert.deepEqual([...result.entries.get("お金が足りない！").contexts], ["CommonEvents.json:401"]);
  assert.deepEqual([...result.entries.get("酒場").contexts], ["Map001.json:displayName"]);
  assert.deepEqual([...result.entries.get("レベル").contexts], ["System.json:terms.basic[]"]);
});

test("toSortedArray is sorted by frequency then text", () => {
  const result = extractProject(FIXTURE);
  result.entries.get("はい").count = 5;
  const sorted = toSortedArray(result);
  assert.equal(sorted[0].text, "はい");
  assert.equal(sorted.length, result.entries.size);
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    assert.ok(prev.count > cur.count || (prev.count === cur.count && prev.text <= cur.text));
  }
});

test("listJsonFiles only returns json and is stable", () => {
  const files = listJsonFiles(path.join(FIXTURE, "data"));
  assert.ok(files.length > 0);
  assert.deepEqual(files, [...files].sort());
  for (const file of files) assert.ok(file.endsWith(".json"));
});

test("a missing data dir yields nothing", () => {
  const result = extractProject(path.join(FIXTURE, "does-not-exist"));
  assert.equal(result.entries.size, 0);
  assert.equal(result.totalStrings, 0);
});
