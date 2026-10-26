/**
 * Locate an RGSS game and read its identity.
 *
 * The RGSS family (XP, VX, VX Ace) ships one shape: a Windows executable next
 * to a `Game.ini` that names the runtime library and the script table, and the
 * game's data in either a `Data/` directory or a single encrypted archive
 * (`Game.rgssad`, `.rgss2a`, `.rgss3a`). The project root is the directory that holds
 * those, because it is what the player launches and what an uninstall has to
 * leave exactly as it was.
 *
 * Two facts drive the code below:
 *
 *  - `Game.ini` is written by the editor in the system locale, so its strings are
 *    Shift_JIS for a Japanese game and GBK for a Chinese one. Node decodes both
 *    when the ICU build carries the tables; the decoder falls back to Shift_JIS
 *    only when the bytes actually look Japanese, because both charsets accept
 *    the same byte ranges and a wrong guess turns a title into mojibake.
 *  - the version of the engine is visible in three independent places (the
 *    runtime library named in `Game.ini`, the data file extension, the archive
 *    extension). They always agree on a healthy install, so any of them can be
 *    the fallback when one is missing.
 *
 * @module engines/rgss/project
 */

import fs from "node:fs";
import path from "node:path";

import { findArchive, openArchive } from "./archive.js";

/** The ini every RGSS distribution carries. */
export const INI_FILE = "Game.ini";

/** Directory that holds the data files when the game is not packed. */
export const DATA_DIR = "Data";

/** How deep {@link findRgssRoots} looks below the directory it starts from. */
export const MAX_SEARCH_DEPTH = 3;

/** Data file extensions, one per engine version. */
const DATA_EXTENSIONS = [".rvdata2", ".rvdata", ".rxdata"];

/** Directories that never contain another game. */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".svn",
  "data",
  "system",
  "graphics",
  "audio",
  "fonts",
  "movies",
  "save",
  "saves",
  "cache",
]);

/**
 * Runtime library name to engine version.
 *
 * `RGSS300` and `RGSS301` are the two VX Ace runtimes, `RGSS202` is VX, and the
 * `RGSS10x` series is XP. The list is deliberately ordered: a game may leave a
 * stale library next to the one it really loads.
 *
 * @type {ReadonlyArray<{ pattern: RegExp, version: number }>}
 */
const LIBRARY_VERSIONS = [
  { pattern: /rgss30[01]/i, version: 3 },
  { pattern: /rgss20[0-2]/i, version: 2 },
  { pattern: /rgss10[0-4]/i, version: 1 },
];

/** Data file extension to engine version. */
const EXTENSION_VERSIONS = { ".rvdata2": 3, ".rvdata": 2, ".rxdata": 1 };

/** Human readable name of each engine version. */
export const EDITION_NAMES = { 1: "XP", 2: "VX", 3: "VX Ace" };

/**
 * Decode a `Game.ini` buffer.
 *
 * UTF-8 wins when the bytes are valid UTF-8, because that is unambiguous. The
 * legacy charsets share their byte ranges, so the second opinion comes from the
 * text itself: a Shift_JIS decoding that contains kana is Japanese, anything
 * else is decoded as GBK.
 *
 * @param {Buffer} buffer
 * @returns {string}
 */
export function decodeIni(buffer) {
  const utf8 = tryDecode(buffer, "utf-8");
  if (utf8 !== null) return utf8;
  const japanese = tryDecode(buffer, "shift_jis");
  if (japanese !== null && /[\u3040-\u30ff]/.test(japanese)) return japanese;
  const chinese = tryDecode(buffer, "gbk");
  if (chinese !== null) return chinese;
  if (japanese !== null) return japanese;
  return buffer.toString("latin1");
}

/**
 * Decode a buffer strictly, or return null.
 *
 * @param {Buffer} buffer
 * @param {string} encoding
 * @returns {string|null}
 */
function tryDecode(buffer, encoding) {
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(buffer);
  } catch {
    return null;
  }
}

/**
 * Parse the `Key=Value` lines of a `Game.ini`.
 *
 * Keys are lower cased; the first spelling of a duplicate key wins, which is
 * what the engine does as well. A byte order mark and blank lines are ignored.
 *
 * @param {Buffer|string} source
 * @returns {Record<string, string>}
 */
export function parseIni(source) {
  const text = typeof source === "string" ? source : decodeIni(source);
  /** @type {Record<string, string>} */
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.replace(/^\uFEFF/, "").trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith(";") || trimmed.startsWith("#")) continue;
    const at = trimmed.indexOf("=");
    if (at <= 0) continue;
    const key = trimmed.slice(0, at).trim().toLowerCase();
    const value = trimmed.slice(at + 1).trim();
    if (key.length > 0 && !Object.hasOwn(values, key)) values[key] = value;
  }
  return values;
}

/**
 * Read `Game.ini` from a directory.
 *
 * @param {string} root
 * @returns {Record<string, string>} empty when there is no ini
 */
export function readIni(root) {
  const file = path.join(root, INI_FILE);
  try {
    return parseIni(fs.readFileSync(file));
  } catch {
    return {};
  }
}

/**
 * The engine version a runtime library name implies.
 *
 * @param {string|null} library
 * @returns {number|null}
 */
export function versionOfLibrary(library) {
  if (typeof library !== "string") return null;
  for (const rule of LIBRARY_VERSIONS) {
    if (rule.pattern.test(library)) return rule.version;
  }
  return null;
}

/**
 * The engine version a file name implies.
 *
 * @param {string} name
 * @returns {number|null}
 */
export function versionOfDataFile(name) {
  const lower = name.toLowerCase();
  for (const extension of DATA_EXTENSIONS) {
    if (lower.endsWith(extension)) return EXTENSION_VERSIONS[extension];
  }
  return null;
}

/**
 * The data files that sit in a `Data/` directory, sorted.
 *
 * @param {string} root project root
 * @returns {string[]} file names, empty when there is no data directory
 */
export function listDataDir(root) {
  let names;
  try {
    names = fs.readdirSync(path.join(root, DATA_DIR));
  } catch {
    return [];
  }
  return names
    .filter((name) => versionOfDataFile(name) !== null)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

/**
 * True when `dir` is the root of an RGSS game.
 *
 * A `Game.ini` or an archive is conclusive on its own. A bare `Data/` directory is
 * only a signal when it holds an RGSS data file: plenty of unrelated folders
 * own a directory with that name.
 *
 * @param {string} dir
 * @returns {boolean}
 */
export function looksLikeRgssProject(dir) {
  /** @type {fs.Dirent[]} */
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  let hasIni = false;
  let hasArchive = false;
  let hasData = false;
  for (const entry of entries) {
    const lower = entry.name.toLowerCase();
    if (entry.isFile()) {
      if (lower === "game.ini") hasIni = true;
      else if (/\.rgss(ad|2a|3a)$/.test(lower)) hasArchive = true;
    } else if (entry.isDirectory() && lower === "data") {
      hasData = true;
    }
  }
  if (hasIni || hasArchive) return true;
  return hasData && listDataDir(dir).length > 0;
}

/**
 * Every RGSS project at or below `start`, shallowest first.
 *
 * @param {string} start
 * @returns {string[]} absolute paths
 */
export function findRgssRoots(start) {
  const origin = path.resolve(start);
  /** @type {{ root: string, depth: number }[]} */
  const found = [];
  const queue = [{ dir: origin, depth: 0 }];
  while (queue.length > 0) {
    const item = queue.shift();
    if (looksLikeRgssProject(item.dir)) {
      found.push({ root: item.dir, depth: item.depth });
      // A game never contains another game, and descending into Data/ or
      // Graphics/ would only find the same tree from the inside.
      continue;
    }
    if (item.depth >= MAX_SEARCH_DEPTH) continue;
    let entries;
    try {
      entries = fs.readdirSync(item.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      if (name.startsWith(".")) continue;
      if (SKIP_DIRS.has(name.toLowerCase())) continue;
      queue.push({ dir: path.join(item.dir, name), depth: item.depth + 1 });
    }
  }
  found.sort((left, right) => left.depth - right.depth || (left.root < right.root ? -1 : left.root > right.root ? 1 : 0));
  return found.map((item) => item.root);
}

/**
 * The one RGSS project at or below `start`.
 *
 * @param {string} start
 * @returns {string|null}
 */
export function findRgssRoot(start) {
  const roots = findRgssRoots(start);
  if (roots.length === 0) return null;
  const origin = path.resolve(start);
  const depthOf = (root) => path.relative(origin, root).split(path.sep).filter(Boolean).length;
  const depths = roots.map(depthOf);
  const shallowest = Math.min(...depths);
  const top = roots.filter((root, index) => depths[index] === shallowest);
  if (top.length > 1) {
    throw new Error(
      "found " + top.length + " RGSS projects under " + origin + ", pass one of them instead: " + top.join(", ")
    );
  }
  return top[0];
}

/**
 * The engine version of a root, from every signal it ships.
 *
 * The archive extension is the most reliable one because a packed game has no
 * data files to look at; the ini and the data extensions fill in for an
 * unpacked game.
 *
 * @param {string} root
 * @param {Record<string, string>} ini
 * @returns {number|null}
 */
export function detectVersion(root, ini) {
  const archive = findArchive(root);
  if (archive !== null) {
    if (/\.rgss3a$/i.test(archive)) return 3;
    if (/\.rgss2a$/i.test(archive)) return 2;
    if (/\.rgssad$/i.test(archive)) return 1;
  }
  const fromLibrary = versionOfLibrary(ini.library || null);
  if (fromLibrary !== null) return fromLibrary;
  const fromScripts = versionOfDataFile(ini.scripts || "");
  if (fromScripts !== null) return fromScripts;
  const names = listDataDir(root);
  for (const name of names) {
    const fromFile = versionOfDataFile(name);
    if (fromFile !== null) return fromFile;
  }
  return null;
}

/**
 * Open an RGSS project.
 *
 * @param {string} start any directory at or above the game
 * @returns {{
 *   root: string,
 *   engine: "rgss",
 *   version: string|null,
 *   edition: string|null,
 *   gameTitle: string|null,
 *   dataDir: string,
 *   pluginDir: null,
 *   pluginsFile: null,
 *   indexPath: null,
 *   archive: string|null,
 *   ini: Record<string, string>,
 * }}
 */
export function openRgssProject(start) {
  const root = findRgssRoot(start);
  if (root === null) {
    throw new Error(
      "not an RGSS project (no Game.ini and no .rgssad/.rgss2a/.rgss3a archive in " +
        path.resolve(start) +
        " or up to " + MAX_SEARCH_DEPTH + " levels below it)"
    );
  }
  const ini = readIni(root);
  const version = detectVersion(root, ini);
  const title = typeof ini.title === "string" && ini.title.length > 0 ? ini.title : null;
  return {
    root,
    engine: "rgss",
    version: version === null ? null : String(version),
    edition: version === null ? null : EDITION_NAMES[version] || null,
    gameTitle: title || path.basename(root),
    // The rest of the pipeline keys off dataDir. For RGSS the data may not be
    // a directory at all, so this names the conventional location and the
    // data source below decides how it is actually read.
    dataDir: DATA_DIR,
    pluginDir: null,
    pluginsFile: null,
    indexPath: null,
    archive: findArchive(root),
    ini,
  };
}

/**
 * An open handle on however this game stores its data.
 *
 * A packed game reads through the archive, an unpacked one through `Data/`. The
 * interface is the same either way so the extractor never branches on it.
 *
 * @param {{ root: string, archive: string|null }} project
 * @returns {{
 *   kind: "archive"|"directory",
 *   version: number|null,
 *   names: () => string[],
 *   has: (name: string) => boolean,
 *   read: (name: string) => Buffer|null,
 *   close: () => void,
 * }}
 */
export function openDataSource(project) {
  if (project.archive) {
    const archive = openArchive(project.archive);
    const prefix = DATA_DIR + "/";
    const dataNames = archive
      .names()
      .filter((name) => name.startsWith(prefix))
      .map((name) => name.slice(prefix.length));
    return {
      kind: "archive",
      version: archive.version,
      names: () => dataNames.slice(),
      has: (name) => archive.has(prefix + name),
      read: (name) => {
        const data = archive.read(prefix + name);
        return data === null ? null : data;
      },
      close: () => archive.close(),
    };
  }
  const dir = path.join(project.root, DATA_DIR);
  const names = listDataDir(project.root);
  const version = names.length === 0 ? null : versionOfDataFile(names[0]);
  return {
    kind: "directory",
    version,
    names: () => names.slice(),
    has: (name) => names.includes(name),
    read: (name) => {
      try {
        return fs.readFileSync(path.join(dir, name));
      } catch {
        return null;
      }
    },
    close: () => {},
  };
}
