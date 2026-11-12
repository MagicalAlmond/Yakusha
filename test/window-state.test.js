// Unit tests for gui/window-state.js: the desktop shell's small, forgiving
// preference file. The real profile folder is never touched.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  MIN_HEIGHT,
  MIN_WIDTH,
  normalizeWindowState,
  readWindowState,
  writeWindowState,
} from "../gui/window-state.js";

function scratch() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-window-state-"));
}

test("window-state: normalize keeps a complete state and drops junk", () => {
  assert.deepEqual(
    normalizeWindowState({ width: 1200, height: 800, x: -20, y: 40, maximized: true, extra: "x" }),
    { width: 1200, height: 800, x: -20, y: 40, maximized: true },
  );
  assert.deepEqual(
    normalizeWindowState({ width: MIN_WIDTH, height: MIN_HEIGHT }),
    { width: MIN_WIDTH, height: MIN_HEIGHT, maximized: false },
  );
  assert.equal(normalizeWindowState({ width: MIN_WIDTH - 1, height: 800 }), null);
  assert.equal(normalizeWindowState({ width: 1200, height: MIN_HEIGHT - 1 }), null);
  assert.equal(normalizeWindowState({ width: "1200", height: 800 }), null);
  assert.equal(normalizeWindowState({ width: 1e9, height: 800 }), null);
  assert.equal(normalizeWindowState(null), null);
  assert.equal(normalizeWindowState([]), null);
});

test("window-state: a missing or corrupt file reads as no saved state", () => {
  const dir = scratch();
  try {
    assert.equal(readWindowState(path.join(dir, "missing.json")), null);
    fs.writeFileSync(path.join(dir, "bad.json"), "{not json", "utf8");
    assert.equal(readWindowState(path.join(dir, "bad.json")), null);
    fs.mkdirSync(path.join(dir, "folder.json"));
    assert.equal(readWindowState(path.join(dir, "folder.json")), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("window-state: write then read round-trips and leaves no temp file", () => {
  const dir = scratch();
  const file = path.join(dir, "nested", "window-state.json");
  try {
    assert.equal(writeWindowState(file, { width: 1400, height: 900, x: 10, y: 20, maximized: false }), true);
    assert.deepEqual(readWindowState(file), { width: 1400, height: 900, x: 10, y: 20, maximized: false });
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ["window-state.json"]);
    assert.equal(writeWindowState(file, { width: 10, height: 10 }), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("window-state: a write failure is reported, not thrown", () => {
  const dir = scratch();
  try {
    const blocker = path.join(dir, "blocker");
    fs.writeFileSync(blocker, "");
    assert.equal(writeWindowState(path.join(blocker, "window-state.json"), { width: 1200, height: 800 }), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
