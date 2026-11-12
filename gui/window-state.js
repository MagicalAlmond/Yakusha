/**
 * Remember the main window's size, position and maximized state.
 *
 * The GUI is a desktop shell: reopening it at the same spot is part of the
 * shell's job, not something the renderer should know about. This module is
 * deliberately pure Node (no Electron import) so it can be unit tested with a
 * temporary folder, and every read/write is allowed to fail silently — a
 * corrupt or unwritable profile file must never stop the window from opening.
 *
 * @module gui/window-state
 */

import fs from "node:fs";
import path from "node:path";

/** File name inside the Electron profile folder. */
export const WINDOW_STATE_FILE = "window-state.json";

/** Defaults match the window created by gui/main.js. */
export const MIN_WIDTH = 980;
export const MIN_HEIGHT = 700;

/** A position far outside any real desktop is treated as corrupt. */
const MAX_COORDINATE = 100000;

function isIntegerIn(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

/**
 * Keep only the fields this module owns and drop anything malformed.
 * Returns null when no usable size survived — a position alone is not enough
 * to reopen a window.
 *
 * @param {unknown} value
 * @returns {{width: number, height: number, x?: number, y?: number, maximized: boolean} | null}
 */
export function normalizeWindowState(value) {
  if (!value || typeof value !== "object") return null;
  const state = /** @type {Record<string, unknown>} */ (value);
  if (!isIntegerIn(state.width, MIN_WIDTH, MAX_COORDINATE)) return null;
  if (!isIntegerIn(state.height, MIN_HEIGHT, MAX_COORDINATE)) return null;
  const result = {
    width: /** @type {number} */ (state.width),
    height: /** @type {number} */ (state.height),
    maximized: state.maximized === true,
  };
  if (isIntegerIn(state.x, -MAX_COORDINATE, MAX_COORDINATE)) result.x = /** @type {number} */ (state.x);
  if (isIntegerIn(state.y, -MAX_COORDINATE, MAX_COORDINATE)) result.y = /** @type {number} */ (state.y);
  return result;
}

/**
 * Read a saved window state. Any failure (missing file, bad JSON, a folder
 * instead of a file) means "no saved state"; the caller opens the default
 * window.
 *
 * @param {string} file
 * @returns {{width: number, height: number, x?: number, y?: number, maximized: boolean} | null}
 */
export function readWindowState(file) {
  try {
    const payload = fs.readFileSync(file, "utf8");
    return normalizeWindowState(JSON.parse(payload));
  } catch {
    return null;
  }
}

/**
 * Write a window state atomically enough for a desktop preference file: a
 * complete JSON document replaces the previous one, never a half-written file.
 * Returns false instead of throwing so a read-only profile cannot break quit.
 *
 * @param {string} file
 * @param {{width?: unknown, height?: unknown, x?: unknown, y?: unknown, maximized?: unknown}} state
 * @returns {boolean}
 */
export function writeWindowState(file, state) {
  const normalized = normalizeWindowState(state);
  if (!normalized) return false;
  const temp = path.join(path.dirname(file), `.window-state-${process.pid}-${Date.now()}.tmp`);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temp, JSON.stringify(normalized) + "\n", "utf8");
    fs.renameSync(temp, file);
    return true;
  } catch {
    try {
      fs.rmSync(temp, { force: true });
    } catch {
      // The original failure is the one worth reporting; cleanup is best effort.
    }
    return false;
  }
}
