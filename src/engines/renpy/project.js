/**
 * Locate a Ren'Py game directory and read its identity.
 *
 * A Ren'Py distribution has one shape that matters here: the base directory
 * holds the launcher executable and a `game/` directory, and every script the
 * engine loads lives under `game/` as `.rpy` source or compiled `.rpyc`. The
 * project root we hand to the rest of the pipeline is that base directory,
 * because that is where the player starts the game and where an uninstall has
 * to leave the tree exactly as it was.
 *
 * Engine detection here is deliberately conservative: a directory is a Ren'Py
 * project only when it has a `game/` directory containing a script. A folder of
 * loose notes next to a `game/` subdirectory is not enough, and neither is the
 * SDK itself (its `launcher/`, `tutorial/` and `the_question/` folders each
 * look like a project, which is exactly the multi-root answer we want).
 *
 * @module engines/renpy/project
 */

import fs from "node:fs";
import path from "node:path";

import { readRpaEntry, readRpaIndex } from "./rpa.js";

/** Directory that holds the scripts, relative to the project root. */
export const GAME_DIR = "game";

/** How deep {@link findRenpyRoots} looks below the directory it starts from. */
export const MAX_SEARCH_DEPTH = 3;

/**
 * Directories that never contain another game: descending into them only costs
 * time and can produce a nested false positive for a save folder that copied a
 * script.
 */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".svn",
  "images",
  "audio",
  "fonts",
  "movies",
  "cache",
  "saves",
  "save",
  "gui",
  "tl",
  "lib",
  "renpy",
]);

/** @param {string} name @returns {boolean} */
function isScriptName(name) {
  const lower = name.toLowerCase();
  return lower.endsWith(".rpy") || lower.endsWith(".rpyc");
}

/**
 * List the scripts directly inside a game directory, sorted by name.
 *
 * Only the top level is scanned: Ren'Py compiles `game/script.rpy` to
 * `game/script.rpyc` and keeps both next to each other, while subdirectories
 * hold files that are included rather than compiled on their own. Callers that
 * need the full set walk the tree themselves.
 *
 * @param {string} gameDir absolute path of the `game` directory
 * @returns {string[]} absolute paths
 */
export function listScriptFiles(gameDir) {
  let names;
  try {
    names = fs.readdirSync(gameDir);
  } catch {
    return [];
  }
  return names
    .filter(isScriptName)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((name) => path.join(gameDir, name));
}

/**
 * List the RPA archives directly inside a game directory, sorted by name.
 *
 * Ren'Py keeps archives at the top level of `game/`; an archive in a
 * subdirectory is data for a script, not a packaged game.
 *
 * @param {string} gameDir absolute path of the `game` directory
 * @returns {string[]} absolute paths
 */
export function listRpaArchives(gameDir) {
  let names;
  try {
    names = fs.readdirSync(gameDir);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.toLowerCase().endsWith(".rpa"))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((name) => path.join(gameDir, name));
}

/**
 * True when the game ships scripts inside an RPA archive.
 *
 * An archive alone is not enough to call a directory a game: a folder of
 * extracted assets can contain one. A packaged Ren'Py distribution also has
 * the `renpy/` runtime directory or a launcher executable next to `game/`,
 * which is what this checks.
 *
 * @param {string} dir candidate project root
 * @returns {boolean}
 */
function hasPackagedScripts(dir) {
  if (listRpaArchives(path.join(dir, GAME_DIR)).length === 0) return false;
  if (fs.existsSync(path.join(dir, "renpy"))) return true;
  try {
    return fs.readdirSync(dir).some((name) => name.toLowerCase().endsWith(".exe"));
  } catch {
    return false;
  }
}

/**
 * True when `dir` is the base directory of a Ren'Py game.
 *
 * @param {string} dir
 * @returns {boolean}
 */
export function looksLikeRenpyProject(dir) {
  return listScriptFiles(path.join(dir, GAME_DIR)).length > 0 || hasPackagedScripts(dir);
}

/**
 * Every Ren'Py project at or below `start`, shallowest first.
 *
 * @param {string} start
 * @returns {string[]} absolute paths, deduplicated
 */
export function findRenpyRoots(start) {
  const origin = path.resolve(start);
  /** @type {{ root: string, depth: number }[]} */
  const found = [];
  const queue = [{ dir: origin, depth: 0 }];
  while (queue.length > 0) {
    const { dir, depth } = queue.shift();
    if (looksLikeRenpyProject(dir)) {
      found.push({ root: dir, depth });
      // A project never contains another project; do not descend into game/
      // or into the folders a distribution ships next to it.
      continue;
    }
    if (depth >= MAX_SEARCH_DEPTH) continue;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      if (name.startsWith(".")) continue;
      if (SKIP_DIRS.has(name.toLowerCase())) continue;
      queue.push({ dir: path.join(dir, name), depth: depth + 1 });
    }
  }
  found.sort((a, b) => a.depth - b.depth || (a.root < b.root ? -1 : a.root > b.root ? 1 : 0));
  return found.map((item) => item.root);
}

/**
 * The one Ren'Py project at or below `start`.
 *
 * Two projects at the same shallowest depth is ambiguous, so it throws with the
 * same wording the RPG Maker path uses: the caller (the adapter) turns this into
 * E_MULTI_ROOT and lists the candidates.
 *
 * @param {string} start
 * @returns {string|null}
 */
export function findRenpyRoot(start) {
  const roots = findRenpyRoots(start);
  if (roots.length === 0) return null;
  const origin = path.resolve(start);
  const depthOf = (root) => path.relative(origin, root).split(path.sep).filter(Boolean).length;
  const depths = roots.map(depthOf);
  const shallowest = Math.min(...depths);
  const top = roots.filter((root, index) => depths[index] === shallowest);
  if (top.length > 1) {
    throw new Error(
      "found " + top.length + " Ren'Py projects under " + origin + ", pass one of them instead: " + top.join(", ")
    );
  }
  return top[0];
}

/**
 * Read `config.name` and `config.version` from options.rpy.
 *
 * The values are read textually on purpose: options.rpy is ordinary script with
 * arbitrary Python in it, and the two literals we want are always written the
 * same way. A game that computes its title in code simply gets no title, which
 * is a cosmetic loss, not a reason to fail.
 *
 * A packaged game keeps options.rpy inside its archive; when no loose file
 * exists, the same two spellings are read from the first archive that has one.
 * A malformed archive is ignored here: identity is cosmetic and the extractor
 * reports the real decode failure.
 *
 * @param {string} gameDir
 * @returns {{ title: string|null, version: string|null }}
 */
export function readRenpyIdentity(gameDir) {
  let source = "";
  for (const name of ["options.rpy", "options.rpym"]) {
    const file = path.join(gameDir, name);
    try {
      source = fs.readFileSync(file, "utf8");
      break;
    } catch {
      // try the next spelling
    }
  }
  if (source.length === 0) {
    for (const archive of listRpaArchives(gameDir)) {
      try {
        const index = readRpaIndex(archive);
        for (const name of ["options.rpy", "options.rpym", "game/options.rpy", "game/options.rpym"]) {
          const entry = index.entries.get(name);
          if (entry === undefined) continue;
          source = readRpaEntry(archive, entry).toString("utf8");
          break;
        }
      } catch {
        // one unreadable archive must not hide identity in another
      }
      if (source.length > 0) break;
    }
  }
  /** @param {string} key */
  const literal = (key) => {
    const match = new RegExp("^\\s*define\\s+config\\." + key + "\\s*=\\s*(.+?)\\s*$", "m").exec(source);
    if (!match) return null;
    const raw = match[1];
    const quoted = /^_?\(?\s*"((?:[^"\\]|\\.)*)"\s*\)?$/.exec(raw) || /^_?\(?\s*'((?:[^'\\]|\\.)*)'\s*\)?$/.exec(raw);
    if (!quoted) return null;
    const value = quoted[1].replace(/\\"/g, '"').replace(/\\'/g, "'").trim();
    return value.length > 0 ? value : null;
  };
  return { title: literal("name"), version: literal("version") };
}

/**
 * Open a Ren'Py project.
 *
 * @param {string} start any directory at or above the project
 * @returns {{ root: string, engine: "renpy", gameDir: string, dataDir: string, gameTitle: string|null, version: string|null, pluginDir: null, pluginsFile: null, indexPath: null }}
 */
export function openRenpyProject(start) {
  const root = findRenpyRoot(start);
  if (root === null) {
    throw new Error("not a Ren'Py project (no game/ directory with .rpy, .rpyc or .rpa scripts found in " + path.resolve(start) + ")");
  }
  const gameDir = path.join(root, GAME_DIR);
  const identity = readRenpyIdentity(gameDir);
  return {
    root,
    engine: "renpy",
    gameDir,
    // The rest of the pipeline keys off dataDir; for Ren'Py that is the
    // directory holding the scripts. There is no plugin directory and no
    // plugins.js, and those two stay null rather than pointing at a path that
    // does not exist.
    dataDir: GAME_DIR,
    pluginDir: null,
    pluginsFile: null,
    indexPath: null,
    gameTitle: identity.title || path.basename(root),
    version: identity.version,
  };
}

/**
 * The translation directory, relative to the game directory.
 *
 * Ren'Py keeps delivered translations under `game/tl/<language>/`, and its own
 * UI translations for every language ship the same way. Those files are
 * translation output, not source text: a game with a Chinese community patch
 * already sitting in `tl/schinese/` would otherwise hand us Chinese sentences to
 * translate into Chinese. The directory is skipped wherever it appears.
 */
const TRANSLATION_DIR = "tl";

/**
 * Every source script below `game/`, depth first, sorted.
 *
 * Links are skipped: a packaged game occasionally ships one, and following it
 * can leave the project root or loop. The `tl/` tree is skipped too, for the
 * reason above.
 *
 * @param {string} gameDir
 * @returns {string[]} absolute paths
 */
export function walkScripts(gameDir) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} dir */
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.toLowerCase() === TRANSLATION_DIR) continue;
        walk(full);
      } else if (entry.isFile() && isScriptName(entry.name)) {
        out.push(full);
      }
    }
  };
  walk(gameDir);
  return out;
}
