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
 * Read the last lines of the JSONL log without loading a huge file.
 *
 * A read that starts mid-file drops the incomplete first line; the returned
 * strings are the original JSONL lines, oldest first. Missing files and read
 * errors both return an empty list so the dock never breaks a page.
 *
 * @param {string|null} file
 * @param {{limit?: number, maxBytes?: number}} [options]
 * @returns {string[]}
 */
export function readLogTail(file, options = {}) {
  if (!file) return [];
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : 200;
  const maxBytes = Number.isInteger(options.maxBytes) && options.maxBytes > 0 ? options.maxBytes : 256 * 1024;
  let fd;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size === 0) return [];
    const start = Math.max(0, stat.size - maxBytes);
    fd = fs.openSync(file, "r");
    const buffer = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    let text = buffer.toString("utf8");
    if (start > 0) {
      const newline = text.indexOf("\n");
      text = newline === -1 ? "" : text.slice(newline + 1);
    }
    return text.split(/\r?\n/).filter((line) => line.length > 0).slice(-limit);
  } catch {
    return [];
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // Best effort: the lines already read are still useful.
      }
    }
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
