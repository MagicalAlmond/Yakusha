/**
 * GUI log file.
 *
 * The window only shows short toast summaries; the full command envelopes,
 * warnings and timings go here. The file lives next to the configuration
 * (docs/config.md §8): `%APPDATA%\\yakusha\\logs\\gui.log`, or under
 * `YAKUSHA_CONFIG_DIR` when that override is set.
 *
 * This module is electron-free so the path and redaction rules stay testable
 * with plain node. It never logs command flags whose names look like secrets.
 *
 * @module gui/log
 */

import fs from "node:fs";
import path from "node:path";

/**
 * Resolve the GUI log path without creating anything.
 *
 * @param {Record<string, string|undefined>} [env]
 * @returns {string|null} absolute path, or null when no config directory exists
 */
export function guiLogPath(env = process.env) {
  const injected = env.YAKUSHA_CONFIG_DIR;
  let dir;
  if (injected !== undefined && injected !== "") {
    if (!path.isAbsolute(injected)) return null;
    dir = injected;
  } else if (env.APPDATA) {
    dir = path.join(env.APPDATA, "yakusha");
  } else {
    return null;
  }
  return path.join(dir, "logs", "gui.log");
}

/**
 * Copy flags for the log with secret-looking values redacted.
 *
 * @param {Record<string, unknown>} [flags]
 * @returns {Record<string, unknown>}
 */
export function sanitizeFlags(flags = {}) {
  const out = {};
  for (const [key, value] of Object.entries(flags || {})) {
    if (/api[-_]?key|token|secret|authorization/i.test(key)) out[key] = "[redacted]";
    else out[key] = value;
  }
  return out;
}

/**
 * Append one JSON line. Logging is best effort: a missing profile folder or a
 * full disk must never turn a command result into a GUI failure.
 *
 * @param {string|null} file
 * @param {Record<string, unknown>} entry
 * @returns {boolean} true when the line was written
 */
export function appendGuiLog(file, entry) {
  if (!file) return false;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const line = JSON.stringify({ time: new Date().toISOString(), ...entry }) + "\n";
    fs.appendFileSync(file, line, "utf8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Create an empty log file when the user asks to open it.
 *
 * @param {string|null} file
 * @returns {boolean}
 */
export function ensureGuiLog(file) {
  if (!file) return false;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.closeSync(fs.openSync(file, "a"));
    return true;
  } catch {
    return false;
  }
}
