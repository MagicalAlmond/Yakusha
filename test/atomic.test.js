import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { copyFileAtomic, writeBytesAtomic, writeFileAtomic } from "../src/core/atomic.js";

const created = [];

test.after(() => {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-atomic-"));
  created.push(dir);
  return dir;
}

test("atomic write creates the file and its parent directory", () => {
  const dir = tempDir();
  const file = path.join(dir, "nested", "value.txt");
  writeFileAtomic(file, "hello\n");
  assert.equal(fs.readFileSync(file, "utf8"), "hello\n");
});

test("atomic write replaces an existing file and leaves no temporary file behind", () => {
  const dir = tempDir();
  const file = path.join(dir, "value.txt");
  fs.writeFileSync(file, "old\n");
  writeFileAtomic(file, "new\n");
  assert.equal(fs.readFileSync(file, "utf8"), "new\n");
  assert.deepEqual(fs.readdirSync(dir), ["value.txt"]);
});

test("atomic write leaves the original intact when the target path is unusable", () => {
  const dir = tempDir();
  const blocker = path.join(dir, "blocked");
  fs.writeFileSync(blocker, "original\n");
  assert.throws(() => writeFileAtomic(path.join(blocker, "value.txt"), "new\n"));
  assert.equal(fs.readFileSync(blocker, "utf8"), "original\n");
  assert.deepEqual(fs.readdirSync(dir), ["blocked"]);
});

test("atomic byte write replaces a binary file exactly", () => {
  const dir = tempDir();
  const file = path.join(dir, "archive.bin");
  const before = Buffer.from([0, 1, 2, 255]);
  const after = Buffer.from([9, 8, 7, 0, 200]);
  fs.writeFileSync(file, before);
  writeBytesAtomic(file, after);
  assert.deepEqual(fs.readFileSync(file), after);
  assert.deepEqual(fs.readdirSync(dir), ["archive.bin"]);
});

test("atomic copy replaces one hard link without touching its twin", () => {
  const dir = tempDir();
  const source = path.join(dir, "source.txt");
  const twin = path.join(dir, "twin.txt");
  const target = path.join(dir, "target.txt");
  fs.writeFileSync(source, "new\n");
  fs.writeFileSync(twin, "old\n");
  fs.linkSync(twin, target);
  copyFileAtomic(source, target);
  assert.equal(fs.readFileSync(target, "utf8"), "new\n");
  assert.equal(fs.readFileSync(twin, "utf8"), "old\n");
});
