// Unit tests for the profile-folder choice (gui/profile.js).
//
// Electron fails the single-instance lock — and the GUI never appears — when
// its profile folder cannot be written. These tests pin the order the resolver
// tries folders in, the fallback next to the app, and the YAKUSHA_GUI_PROFILE
// override (docs/gui.md §10).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { FALLBACK_DIR_NAME, canWriteDir, resolveProfileDir } from "../gui/profile.js";

const no = () => false;
const only = (...allowed) => (dir) => allowed.includes(dir);

test("gui-profile: the --user-data-dir switch wins when it is writable", () => {
  const result = resolveProfileDir({
    requested: "D:/asked/profile",
    userData: "C:/Users/me/AppData/Roaming/Electron",
    appDir: "D:/project",
    probe: only("D:/asked/profile"),
  });
  assert.equal(result.dir, "D:/asked/profile");
  assert.equal(result.source, "switch");
  assert.equal(result.fellBack, false);
  assert.deepEqual(result.tried, [{ dir: "D:/asked/profile", writable: true }]);
});

test("gui-profile: Electron's own profile folder is next", () => {
  const result = resolveProfileDir({
    requested: "D:/asked/profile",
    userData: "C:/Users/me/AppData/Roaming/Electron",
    appDir: "D:/project",
    probe: only("C:/Users/me/AppData/Roaming/Electron"),
  });
  assert.equal(result.dir, "C:/Users/me/AppData/Roaming/Electron");
  assert.equal(result.source, "userData");
  assert.equal(result.fellBack, false);
  assert.deepEqual(
    result.tried.map((t) => t.writable),
    [false, true],
  );
});

test("gui-profile: falls back to a folder next to the app", () => {
  const result = resolveProfileDir({
    userData: "C:/Users/me/AppData/Roaming/Electron",
    appDir: "D:/project",
    probe: (dir) => dir === path.join("D:/project", FALLBACK_DIR_NAME),
  });
  assert.equal(result.dir, path.join("D:/project", FALLBACK_DIR_NAME));
  assert.equal(result.source, "fallback");
  assert.equal(result.fellBack, true);
});

test("gui-profile: YAKUSHA_GUI_PROFILE replaces the fallback location", () => {
  const result = resolveProfileDir({
    userData: "C:/Users/me/AppData/Roaming/Electron",
    appDir: "D:/project",
    env: { YAKUSHA_GUI_PROFILE: "E:/scratch/yakusha" },
    probe: only("E:/scratch/yakusha"),
  });
  assert.equal(result.dir, "E:/scratch/yakusha");
  assert.equal(result.fellBack, true);
});

test("gui-profile: nothing writable reports every folder tried", () => {
  const result = resolveProfileDir({
    requested: "D:/asked/profile",
    userData: "C:/Users/me/AppData/Roaming/Electron",
    appDir: "D:/project",
    probe: no,
  });
  assert.equal(result.dir, "C:/Users/me/AppData/Roaming/Electron");
  assert.equal(result.source, "none");
  assert.equal(result.fellBack, false);
  assert.equal(result.tried.length, 3);
  assert.equal(
    result.tried.every((t) => t.writable === false),
    true,
  );
});

test("gui-profile: canWriteDir really writes, and reports a blocked path", () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-profile-probe-"));
  try {
    const target = path.join(scratch, "nested", "profile");
    assert.equal(canWriteDir(target), true);
    assert.equal(fs.existsSync(target), true);
    // A path under a regular file can never be created.
    const blocker = path.join(scratch, "blocker");
    fs.writeFileSync(blocker, "");
    assert.equal(canWriteDir(path.join(blocker, "profile")), false);
    // No probe file is left behind in a folder that worked.
    assert.deepEqual(fs.readdirSync(target), []);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
