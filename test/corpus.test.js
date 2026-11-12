/**
 * Contract tests for tools/corpus.mjs, the batch regression harness.
 *
 * The corpus itself never enters the repository: every fixture here is
 * synthetic, built inside a fresh temporary directory and removed afterwards.
 * The tool is a plain CLI script (it exports nothing), so each test drives it
 * as a child process exactly the way a user would.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { buildXp3, KS_SCENARIO, writeKrkrProject } from "./krkr-fixture.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORPUS = path.join(HERE, "..", "tools", "corpus.mjs");
const MZ_FIXTURE = path.join(HERE, "fixtures", "mini-mz");
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-corpus-config-"));

after(() => {
  fs.rmSync(CONFIG_DIR, { recursive: true, force: true });
});

function cleanEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^YAKUSHA_/i.test(key) || /^OPENAI_API_KEY$/i.test(key)) delete env[key];
  }
  env.YAKUSHA_CONFIG_DIR = CONFIG_DIR;
  return env;
}

function makeRoot(t, prefix = "yakusha-corpus-") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
  return file;
}

function writeManifest(root, games, name = "manifest.json") {
  return writeJson(path.join(root, name), { schema: 1, games });
}

function runCorpus(args) {
  return spawnSync(process.execPath, [CORPUS, ...args], {
    encoding: "utf8",
    env: cleanEnv(),
    timeout: 120000,
  });
}

function copyMzGame(target) {
  fs.cpSync(MZ_FIXTURE, target, { recursive: true });
  fs.rmSync(path.join(target, "yakusha"), { recursive: true, force: true });
  return target;
}

/** A synthetic Kirikiri project whose XP3 index magic is unsupported. */
function writeUnreadableKrkrProject(parent) {
  const project = writeKrkrProject(parent, { name: "krkr-game" });
  fs.writeFileSync(
    path.join(project.dataDir, "data.xp3"),
    buildXp3([{ name: "scenario.ks", data: Buffer.from(KS_SCENARIO) }], { indexMagic: "Hxv4" })
  );
  return project.root;
}

/** Sorted file inventory used to prove a run did not touch the source tree. */
function snapshotTree(root) {
  const rows = [];
  const walk = (dir, rel) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const target = path.join(dir, entry.name);
      const childRel = rel === "" ? entry.name : rel + "/" + entry.name;
      if (entry.isDirectory()) {
        walk(target, childRel);
      } else {
        const stat = fs.statSync(target);
        rows.push({ path: childRel, size: stat.size, mtimeMs: stat.mtimeMs });
      }
    }
  };
  walk(root, "");
  return rows;
}

test("corpus: --help prints usage and exits 0", () => {
  const result = runCorpus(["--help"]);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.startsWith("usage: node tools/corpus.mjs"), result.stdout);
  assert.ok(result.stdout.includes("--manifest <file>"), result.stdout);
});

test("corpus: missing --manifest is a usage error", () => {
  const result = runCorpus([]);
  assert.equal(result.status, 2);
  assert.ok(result.stderr.includes("--manifest is required"), result.stderr);
});

test("corpus: manifest validation names the offending field", (t) => {
  const root = makeRoot(t, "yakusha-corpus-invalid-");
  const game = path.join(root, "game");
  fs.mkdirSync(game, { recursive: true });
  const file = path.join(root, "not-a-directory.txt");
  fs.writeFileSync(file, "plain file\n");
  const entry = (overrides = {}) => ({ id: "one", engine: "mz", root: game, ...overrides });
  const cases = [
    { name: "schema", value: { schema: 2, games: [entry()] }, message: "manifest.schema must be 1, got 2" },
    { name: "games-not-array", value: { schema: 1, games: {} }, message: "manifest.games must be an array" },
    { name: "games-empty", value: { schema: 1, games: [] }, message: "manifest.games is empty" },
    { name: "duplicate-id", value: { schema: 1, games: [entry(), entry()] }, message: "games[1].id is duplicated: one" },
    {
      name: "unknown-engine",
      value: { schema: 1, games: [entry(), entry({ id: "two", engine: "unity" })] },
      message: "games[1].engine must be one of mv, mz, krkr, rgss, renpy, got \"unity\"",
    },
    { name: "relative-root", value: { schema: 1, games: [entry({ root: "relative/game" })] }, message: "games[0].root must be an absolute path: relative/game" },
    { name: "root-not-directory", value: { schema: 1, games: [entry({ root: file })] }, message: "games[0].root is not a directory: " + file },
    { name: "bad-expect", value: { schema: 1, games: [entry({ expect: "maybe" })] }, message: "games[0].expect must be ok or unreadable, got \"maybe\"" },
    { name: "empty-id", value: { schema: 1, games: [entry({ id: "  " })] }, message: "games[0].id must be a non-empty string" },
  ];
  for (const item of cases) {
    const manifest = writeJson(path.join(root, "manifest-" + item.name + ".json"), item.value);
    const result = runCorpus(["--manifest", manifest, "--out", path.join(root, "out-" + item.name)]);
    assert.equal(result.status, 2, item.name + ": " + result.stderr);
    assert.ok(result.stderr.includes(item.message), item.name + ": " + result.stderr);
  }
});

test("corpus: scan reports a synthetic MZ game as ok", (t) => {
  const root = makeRoot(t);
  const game = copyMzGame(path.join(root, "game"));
  const manifest = writeManifest(root, [{ id: "mz-one", engine: "mz", root: game, expect: "ok" }]);
  const out = path.join(root, "out");
  const result = runCorpus(["--manifest", manifest, "--out", out]);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(fs.readFileSync(path.join(out, "corpus.json"), "utf8"));
  assert.equal(report.schema, 1);
  assert.equal(report.games.length, 1);
  assert.equal(report.games[0].id, "mz-one");
  assert.equal(report.games[0].outcome, "ok");
  assert.equal(report.games[0].match, true);
  assert.deepEqual(report.games[0].steps, ["scan"]);
  assert.equal(typeof report.games[0].uniqueStrings, "number");
  assert.equal(report.summary.ok, 1);
  assert.equal(report.summary.mismatch, 0);
  assert.ok(result.stdout.includes("ok 1 / findings 0 / error 0"), result.stdout);
});

test("corpus: an unreadable KRKR index matches expect unreadable", (t) => {
  const root = makeRoot(t);
  const game = writeUnreadableKrkrProject(root);
  const manifest = writeManifest(root, [{ id: "krkr-broken", engine: "krkr", root: game, expect: "unreadable" }]);
  const out = path.join(root, "out");
  const result = runCorpus(["--manifest", manifest, "--out", out]);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(fs.readFileSync(path.join(out, "corpus.json"), "utf8"));
  assert.equal(report.games[0].outcome, "findings");
  assert.equal(report.games[0].match, true);
  assert.equal(report.games[0].undecodableCount, 1);
  assert.equal(report.summary.findings, 1);
});

test("corpus: an unreadable KRKR index mismatches expect ok", (t) => {
  const root = makeRoot(t);
  const game = writeUnreadableKrkrProject(root);
  const manifest = writeManifest(root, [{ id: "krkr-broken", engine: "krkr", root: game, expect: "ok" }]);
  const out = path.join(root, "out");
  const result = runCorpus(["--manifest", manifest, "--out", out]);
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(fs.readFileSync(path.join(out, "corpus.json"), "utf8"));
  assert.equal(report.games[0].outcome, "findings");
  assert.equal(report.games[0].match, false);
  assert.equal(report.summary.mismatch, 1);
});

test("corpus: steps beyond scan require --deep", (t) => {
  const root = makeRoot(t);
  const game = copyMzGame(path.join(root, "game"));
  const manifest = writeManifest(root, [{ id: "mz-one", engine: "mz", root: game }]);
  const result = runCorpus(["--manifest", manifest, "--steps", "extract"]);
  assert.equal(result.status, 2, result.stderr);
  assert.ok(result.stderr.includes("steps beyond scan write a dictionary"), result.stderr);
});

test("corpus: --deep mirrors the game without touching the source tree", (t) => {
  const root = makeRoot(t);
  const game = path.join(root, "game");
  const www = path.join(game, "www");
  copyMzGame(www);
  fs.mkdirSync(path.join(game, "audio"), { recursive: true });
  fs.writeFileSync(path.join(game, "audio", "theme.ogg"), "OggS synthetic\n");
  fs.mkdirSync(path.join(game, "img"), { recursive: true });
  fs.writeFileSync(path.join(game, "img", "title.png"), "PNG synthetic\n");
  fs.mkdirSync(path.join(game, "save"), { recursive: true });
  fs.writeFileSync(path.join(game, "save", "slot1.rpgsave"), "save synthetic\n");
  const before = snapshotTree(game);
  const manifest = writeManifest(root, [{ id: "mz-deep", engine: "mz", root: game }]);
  const work = path.join(root, "work");
  const result = runCorpus(["--manifest", manifest, "--steps", "scan", "--deep", "--work", work]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(work, "mz-deep")), false, "the mirror must be cleaned up");
  assert.deepEqual(snapshotTree(game), before, "the source tree must keep the same files, sizes and mtimes");
  const report = JSON.parse(fs.readFileSync(path.join(work, "out", "corpus.json"), "utf8"));
  assert.equal(report.deep, true);
  assert.equal(report.games[0].outcome, "ok");
  assert.equal(report.games[0].match, true);
});

test("corpus: --json prints the report as one JSON document", (t) => {
  const root = makeRoot(t);
  const game = copyMzGame(path.join(root, "game"));
  const manifest = writeManifest(root, [{ id: "mz-one", engine: "mz", root: game }]);
  const result = runCorpus(["--manifest", manifest, "--out", path.join(root, "out"), "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.schema, 1);
  assert.ok(Array.isArray(report.games));
  assert.equal(report.games[0].id, "mz-one");
  assert.equal(report.summary.ok, 1);
});

test("corpus: corpus.md is a counts-only table without absolute paths", (t) => {
  const root = makeRoot(t);
  const game = copyMzGame(path.join(root, "game"));
  const manifest = writeManifest(root, [{ id: "mz-one", engine: "mz", root: game }]);
  const out = path.join(root, "out");
  const result = runCorpus(["--manifest", manifest, "--out", out]);
  assert.equal(result.status, 0, result.stderr);
  const markdown = fs.readFileSync(path.join(out, "corpus.md"), "utf8");
  assert.ok(markdown.startsWith("# Corpus report"), markdown.slice(0, 40));
  assert.ok(markdown.includes("| id | engine | expect | outcome | match |"), markdown);
  assert.equal(markdown.includes(root), false, "corpus.md must not contain the fixture root path");
  assert.ok(markdown.endsWith("ok 1 / findings 0 / error 0\n"), markdown);
});
