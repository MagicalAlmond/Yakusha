/**
 * Contract tests for tools/portable-lib.mjs and tools/portable.mjs.
 *
 * The portable bundle is built from a fake Electron distribution so the test
 * does not need the 200 MB dev dependency. The app files still come from this
 * checkout, which proves the real bin/src/gui tree is copied into resources/app.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { buildPortable, verifyPortable, PortableError } from "../tools/portable-lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const CLI = path.join(ROOT, "tools", "portable.mjs");
const ROOT_PKG = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const TEMP_DIRS = [];

after(() => {
  for (const dir of TEMP_DIRS) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  TEMP_DIRS.push(dir);
  return dir;
}

function write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
}

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function makeElectron() {
  const dir = tempDir("yakusha-portable-electron-");
  write(path.join(dir, "electron.exe"), "synthetic electron bytes\n");
  write(path.join(dir, "version"), "37.2.3\n");
  write(path.join(dir, "LICENSE"), "Electron license\n");
  write(path.join(dir, "resources", "default_app.asar"), "default app that must not ship\n");
  write(path.join(dir, "resources", "resources.pak"), "resources\n");
  write(path.join(dir, "locales", "en-US.pak"), "locale\n");
  return dir;
}

function makeNative() {
  const dir = tempDir("yakusha-portable-native-");
  const files = {
    "bootstrap.rb": "# synthetic bootstrap\n",
    "libunwind.dll": "synthetic libunwind\n",
  };
  const manifest = { schema: 1, files: {} };
  for (const [name, text] of Object.entries(files)) {
    write(path.join(dir, name), text);
    manifest.files[name] = sha256(Buffer.from(text));
  }
  write(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return dir;
}

function runCli(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    timeout: 120000,
  });
}

test("portable: build lays out the runtime, app, native components and checksums", () => {
  const electronDir = makeElectron();
  const nativeDir = makeNative();
  const outDir = path.join(tempDir("yakusha-portable-out-"), "bundle");
  const result = buildPortable({ root: ROOT, electronDir, nativeDir, outDir, now: new Date("2026-11-12T10:00:00Z") });

  assert.equal(result.outDir, outDir);
  assert.equal(result.buildInfo.schema, 1);
  assert.equal(result.buildInfo.tool, "yakusha-portable");
  assert.equal(result.buildInfo.version, ROOT_PKG.version);
  assert.equal(result.buildInfo.electron, "37.2.3");
  assert.equal(result.buildInfo.signed, false);
  assert.ok(fs.existsSync(path.join(outDir, "Yakusha.exe")));
  assert.equal(fs.existsSync(path.join(outDir, "electron.exe")), false);
  assert.equal(fs.existsSync(path.join(outDir, "resources", "default_app.asar")), false);
  assert.ok(fs.existsSync(path.join(outDir, "resources", "app", "gui", "main.js")));
  assert.ok(fs.existsSync(path.join(outDir, "resources", "app", "src", "index.js")));
  assert.ok(fs.existsSync(path.join(outDir, "resources", "app", "native", "prebuilt", "libunwind.dll")));
  assert.ok(fs.existsSync(path.join(outDir, "README.md")));
  assert.ok(fs.existsSync(path.join(outDir, "LICENSE")));
  const appPkg = JSON.parse(fs.readFileSync(path.join(outDir, "resources", "app", "package.json"), "utf8"));
  assert.equal(appPkg.main, "gui/main.js");
  assert.equal(appPkg.type, "module");
  assert.equal(appPkg.version, ROOT_PKG.version);
  const sums = fs.readFileSync(path.join(outDir, "SHA256SUMS"), "utf8");
  assert.ok(sums.includes("  Yakusha.exe\n"), sums);
  assert.ok(!sums.includes("SHA256SUMS"), sums);
  assert.deepEqual(verifyPortable(outDir), { ok: true, fileCount: result.fileCount, buildInfo: result.buildInfo });
});

test("portable: verify rejects a modified file and an unlisted file", () => {
  const electronDir = makeElectron();
  const nativeDir = makeNative();
  const outDir = path.join(tempDir("yakusha-portable-tamper-"), "bundle");
  buildPortable({ root: ROOT, electronDir, nativeDir, outDir });
  fs.appendFileSync(path.join(outDir, "resources", "app", "gui", "main.js"), "\n// tampered\n");
  assert.throws(() => verifyPortable(outDir), (error) => error instanceof PortableError && error.code === "E_VERIFY" && /checksum mismatch/.test(error.message));
});

test("portable: verify rejects an extra file not listed in SHA256SUMS", () => {
  const electronDir = makeElectron();
  const nativeDir = makeNative();
  const outDir = path.join(tempDir("yakusha-portable-extra-"), "bundle");
  buildPortable({ root: ROOT, electronDir, nativeDir, outDir });
  write(path.join(outDir, "extra.txt"), "extra\n");
  assert.throws(() => verifyPortable(outDir), (error) => error instanceof PortableError && error.code === "E_VERIFY" && /not listed/.test(error.message));
});

test("portable: a non-empty output is refused unless --force owns the directory", () => {
  const electronDir = makeElectron();
  const nativeDir = makeNative();
  const parent = tempDir("yakusha-portable-refuse-");
  const outDir = path.join(parent, "bundle");
  write(path.join(outDir, "user-file.txt"), "do not delete\n");
  assert.throws(() => buildPortable({ root: ROOT, electronDir, nativeDir, outDir }), (error) => error instanceof PortableError && error.code === "E_EXISTS" && /--force/.test(error.message));
  assert.throws(() => buildPortable({ root: ROOT, electronDir, nativeDir, outDir, force: true }), (error) => error instanceof PortableError && error.code === "E_EXISTS" && /not created by this tool/.test(error.message));
  assert.equal(fs.readFileSync(path.join(outDir, "user-file.txt"), "utf8"), "do not delete\n");
});

test("portable: --force replaces a previous portable build", () => {
  const electronDir = makeElectron();
  const nativeDir = makeNative();
  const outDir = path.join(tempDir("yakusha-portable-force-"), "bundle");
  buildPortable({ root: ROOT, electronDir, nativeDir, outDir, now: new Date("2026-11-12T10:00:00Z") });
  const second = buildPortable({ root: ROOT, electronDir, nativeDir, outDir, force: true, now: new Date("2026-11-12T10:01:00Z") });
  assert.equal(second.buildInfo.builtAt, "2026-11-12T10:01:00.000Z");
  assert.equal(verifyPortable(outDir).ok, true);
});

test("portable: CLI --help and --verify --json work", () => {
  const help = runCli(["--help"]);
  assert.equal(help.status, 0, help.stderr);
  assert.ok(help.stdout.startsWith("usage: node tools/portable.mjs"), help.stdout);
  assert.ok(help.stdout.includes("--verify <dir>"), help.stdout);

  const electronDir = makeElectron();
  const nativeDir = makeNative();
  const outDir = path.join(tempDir("yakusha-portable-cli-"), "bundle");
  const built = runCli(["--out", outDir, "--electron-dir", electronDir, "--native-dir", nativeDir, "--json"]);
  assert.equal(built.status, 0, built.stderr);
  const envelope = JSON.parse(built.stdout);
  assert.equal(envelope.ok, true);
  assert.equal(envelope.outDir, outDir);
  const verified = runCli(["--verify", outDir, "--json"]);
  assert.equal(verified.status, 0, verified.stderr);
  assert.equal(JSON.parse(verified.stdout).verify.ok, true);
});

test("portable: CLI usage errors exit 2 and a missing Electron distribution exits 1", () => {
  const unknown = runCli(["--bogus"]);
  assert.equal(unknown.status, 2, unknown.stderr);
  assert.ok(unknown.stderr.includes("E_USAGE"), unknown.stderr);

  const missing = path.join(tempDir("yakusha-portable-missing-"), "no-electron");
  const nativeDir = makeNative();
  const outDir = path.join(tempDir("yakusha-portable-missing-out-"), "bundle");
  const result = runCli(["--out", outDir, "--electron-dir", missing, "--native-dir", nativeDir]);
  assert.equal(result.status, 1, result.stderr);
  assert.ok(result.stderr.includes("E_IO"), result.stderr);
  assert.ok(result.stderr.includes("Electron distribution is missing"), result.stderr);
});
