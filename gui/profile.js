/**
 * Where Electron keeps its Chromium profile.
 *
 * Electron stores the profile (cache, Local Storage, and the single-instance
 * lock file) under %APPDATA%\\<name>. When that folder cannot be written
 * Electron reports the failure exactly like "another window is already open"
 * and the GUI never appears (docs/gui.md §10). Two situations produce it: a
 * profile folder that is read-only, and an environment that confines a program
 * to the folder its image lives in — there a folder next to the app is the only
 * writable choice.
 *
 * This module decides which folder to use before the lock is taken. It imports
 * nothing from Electron, so the decision is unit-testable.
 *
 * @module gui/profile
 */

import fs from "node:fs";
import path from "node:path";

/** Folder next to the app used when the default profile cannot be written. */
export const FALLBACK_DIR_NAME = ".yakusha-gui-profile";

/**
 * Can this folder be created and written to?
 *
 * @param {string} dir absolute path
 * @returns {boolean}
 */
export function canWriteDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.write-probe-${process.pid}`);
    fs.writeFileSync(probe, "");
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

/**
 * Pick the first writable profile folder.
 *
 * Order: the --user-data-dir switch (the user asked for it), Electron's
 * default, then a folder next to the app — or YAKUSHA_GUI_PROFILE when it is
 * set, so a locked-down machine can point somewhere specific.
 *
 * @param {object} options
 * @param {string} [options.requested] --user-data-dir value, if any
 * @param {string} [options.userData] Electron's default profile folder
 * @param {string} [options.appDir] folder holding the app (the repo root in a checkout)
 * @param {Record<string, string|undefined>} [options.env]
 * @param {(dir: string) => boolean} [options.probe]
 * @returns {{dir: string|null, source: "switch"|"userData"|"fallback"|"none",
 *   fellBack: boolean, tried: {dir: string, writable: boolean}[]}}
 */
export function resolveProfileDir({
  requested,
  userData,
  appDir,
  env = {},
  probe = canWriteDir,
} = {}) {
  const candidates = [];
  if (requested) candidates.push({ dir: requested, source: "switch" });
  if (userData) candidates.push({ dir: userData, source: "userData" });
  if (appDir) {
    candidates.push({
      dir: env.YAKUSHA_GUI_PROFILE || path.join(appDir, FALLBACK_DIR_NAME),
      source: "fallback",
    });
  }

  const tried = [];
  for (const candidate of candidates) {
    const writable = Boolean(probe(candidate.dir));
    tried.push({ dir: candidate.dir, writable });
    if (writable) {
      return {
        dir: candidate.dir,
        source: candidate.source,
        fellBack: candidate.source === "fallback",
        tried,
      };
    }
  }
  // Nothing is writable: keep Electron's own choice so the caller reports the
  // folder the user would expect to fix.
  return { dir: userData || requested || null, source: "none", fellBack: false, tried };
}
