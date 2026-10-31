import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { assertInsideRoot } from "../src/core/paths.js";

const created = [];

test.after(() => {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-paths-"));
  created.push(dir);
  return dir;
}

test("a target inside the project root is accepted even before it exists", () => {
  const root = path.join(tempDir(), "game");
  fs.mkdirSync(root);
  assert.doesNotThrow(() => assertInsideRoot({ root }, path.join(root, "yakusha", "native", "manifest.json")));
});

test("a target outside the project root is rejected", () => {
  const parent = tempDir();
  const root = path.join(parent, "game");
  fs.mkdirSync(root);
  assert.throws(
    () => assertInsideRoot({ root }, path.join(parent, "outside.txt")),
    (error) => {
      assert.equal(error.code, "E_IO");
      assert.match(error.message, /^refusing to write outside the project root: /);
      return true;
    }
  );
});

test("a junction that points outside the project root is rejected", (t) => {
  const parent = tempDir();
  const root = path.join(parent, "game");
  const outside = path.join(parent, "outside");
  fs.mkdirSync(root);
  fs.mkdirSync(outside);
  try {
    fs.symlinkSync(outside, path.join(root, "link"), "junction");
  } catch (error) {
    t.skip("directory junctions are not available here: " + (error && error.code));
    return;
  }
  assert.throws(
    () => assertInsideRoot({ root }, path.join(root, "link", "file.txt")),
    (error) => {
      assert.equal(error.code, "E_IO");
      assert.match(error.message, /^refusing to write outside the project root: /);
      return true;
    }
  );
});
