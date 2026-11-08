/**
 * The publish-time guard on the prebuilt native directory.
 *
 * The directory is gitignored, so these tests build it from scratch: four
 * synthetic files, a manifest with their real hashes, then one deliberate
 * defect per case. The real `native/prebuilt` is never required here — a clean
 * checkout has no binaries until CI builds them.
 */

import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { MANIFEST_SCHEMA, REQUIRED_FILES, formatProblems, verifyPrebuilt } from "../native/verify.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const verifier = path.join(root, "native/verify.mjs");
const created = [];

after(() => {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
});

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-native-pack-"));
  created.push(dir);
  return dir;
}

function digest(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Stage a native directory. `mutate` may edit the manifest or files before the
 * manifest is written, which is how each failure case is built.
 */
function stage(mutate = () => {}) {
  const dir = sandbox();
  const buffers = {};
  for (const name of REQUIRED_FILES) {
    buffers[name] = Buffer.from("synthetic " + name + " payload");
    fs.writeFileSync(path.join(dir, name), buffers[name]);
  }
  const manifest = {
    schema: MANIFEST_SCHEMA,
    files: Object.fromEntries(REQUIRED_FILES.map((name) => [name, digest(buffers[name])])),
  };
  const state = { dir, manifest, buffers };
  mutate(state);
  if (state.manifest !== null) fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(state.manifest, null, 2) + "\n", "utf8");
  return state;
}

test("a complete, correctly hashed directory passes", () => {
  const state = stage();
  const result = verifyPrebuilt(state.dir);
  assert.equal(result.ok, true, formatProblems(result));
  assert.equal(result.problems.length, 0);
  assert.deepEqual(Object.keys(result.files), [...REQUIRED_FILES]);
  assert.equal(result.files["bootstrap.rb"].sha256, state.manifest.files["bootstrap.rb"]);
});

test("a missing manifest fails", () => {
  const state = stage((value) => { value.manifest = null; });
  const result = verifyPrebuilt(state.dir);
  assert.equal(result.ok, false);
  assert.match(formatProblems(result), /manifest\.json is missing/);
});

test("malformed JSON fails instead of being repaired", () => {
  const state = stage((value) => { value.manifest = null; });
  fs.writeFileSync(path.join(state.dir, "manifest.json"), "{ not json", "utf8");
  const result = verifyPrebuilt(state.dir);
  assert.equal(result.ok, false);
  assert.match(formatProblems(result), /not valid JSON/);
});

test("a different schema is rejected", () => {
  const state = stage((value) => { value.manifest.schema = 2; });
  const result = verifyPrebuilt(state.dir);
  assert.equal(result.ok, false);
  assert.match(formatProblems(result), /schema must be 1/);
});

test("an unknown manifest key is rejected", () => {
  const state = stage((value) => { value.manifest.extra = true; });
  const result = verifyPrebuilt(state.dir);
  assert.equal(result.ok, false);
  assert.match(formatProblems(result), /unknown key: extra/);
});

test("a missing file entry is reported by name", () => {
  const state = stage((value) => { delete value.manifest.files["bootstrap.rb"]; });
  const result = verifyPrebuilt(state.dir);
  assert.equal(result.ok, false);
  assert.match(formatProblems(result), /missing the entry: bootstrap\.rb/);
});

test("an unexpected file entry is reported by name", () => {
  const state = stage((value) => { value.manifest.files["old.dll"] = "0".repeat(64); });
  const result = verifyPrebuilt(state.dir);
  assert.equal(result.ok, false);
  assert.match(formatProblems(result), /unexpected file: old\.dll/);
});

test("a path traversal key never reaches the filesystem", () => {
  const state = stage((value) => { value.manifest.files["../escape.dll"] = "0".repeat(64); });
  const outside = path.join(path.dirname(state.dir), "escape.dll");
  fs.writeFileSync(outside, "outside", "utf8");
  try {
    const result = verifyPrebuilt(state.dir);
    assert.equal(result.ok, false);
    assert.match(formatProblems(result), /unsafe file name: "\.\.\/escape\.dll"/);
    assert.equal(result.files["../escape.dll"], undefined);
  } finally {
    fs.rmSync(outside, { force: true });
  }
});

test("a changed byte fails the SHA-256 check", () => {
  const state = stage();
  fs.writeFileSync(path.join(state.dir, "yakusha_rgss_hook.dll"), "tampered", "utf8");
  const result = verifyPrebuilt(state.dir);
  assert.equal(result.ok, false);
  assert.match(formatProblems(result), /SHA-256 mismatch for yakusha_rgss_hook\.dll/);
});

test("a file left behind by an old build fails the directory check", () => {
  const state = stage();
  fs.writeFileSync(path.join(state.dir, "stale.dll"), "old", "utf8");
  const result = verifyPrebuilt(state.dir);
  assert.equal(result.ok, false);
  assert.match(formatProblems(result), /unexpected entry: stale\.dll/);
});

test("a missing directory fails without throwing", () => {
  const result = verifyPrebuilt(path.join(sandbox(), "absent"));
  assert.equal(result.ok, false);
  assert.match(formatProblems(result), /does not exist/);
});

test("the command exit code follows the verdict", () => {
  const good = stage();
  const ok = spawnSync(process.execPath, [verifier, "--dir", good.dir], { encoding: "utf8" });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stderr, /native package: ok \(4 files/);

  const bad = stage((value) => { value.manifest.schema = 3; });
  const failed = spawnSync(process.execPath, [verifier, "--dir", bad.dir], { encoding: "utf8" });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /schema must be 1/);
});

test("package.json ships the GUI and the staged native directory before publish", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.ok(pkg.files.includes("gui"), "the GUI is part of the package");
  assert.ok(pkg.files.includes("native/prebuilt"), "the prebuilt native components are part of the package");
  assert.equal(pkg.scripts.prepack, "node native/verify.mjs");
});
