/**
 * RPG Maker project discovery.
 *
 * A "project root" is the directory that contains `js/` with the engine core
 * script. Deployed games usually keep that layout at the top level; some are
 * wrapped in a `www/` folder, some sit in a renamed subfolder, and at least one
 * ships a browser build under `data/www/`. `findProjectRoots` walks down from
 * whatever the user pointed at, up to `MAX_SEARCH_DEPTH` levels.
 *
 * @module core/mzproject
 */

import fs from "node:fs";
import path from "node:path";
import { readDataFile } from "./datafile.js";

/** @typedef {{ root: string, engine: "mz"|"mv"|"unknown", pluginDir: string, dataDir: string, pluginsFile: string, indexPath: string, gameTitle: string|null, version: string|null }} Project */

const MZ_CORE = path.join("js", "rmmz_core.js");
const MV_CORE = path.join("js", "rpg_core.js");

/**
 * @param {string} dir
 * @returns {boolean}
 */
export function looksLikeProject(dir) {
  try {
    return (
      fs.existsSync(path.join(dir, MZ_CORE)) ||
      fs.existsSync(path.join(dir, MV_CORE))
    );
  } catch {
    return false;
  }
}

/** Directories never worth descending into when hunting for a game root. */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".svn",
  "img",
  "audio",
  "fonts",
  "movies",
  "effects",
  "locales",
  "icon",
  "save",
  "saves",
]);

/** How deep below `start` a game root may hide (0 = `start` itself). */
export const MAX_SEARCH_DEPTH = 3;

/**
 * True when `fullPath` is a directory once links are followed.
 *
 * A Windows directory junction shows up in `readdir` as a symbolic link, so a
 * plain `dirent.isDirectory()` test would skip a game that is only reachable
 * through one. `statSync` follows the link; a broken link throws and is
 * skipped, exactly like an unreadable directory.
 *
 * @param {string} fullPath
 * @returns {boolean}
 */
function isDirectoryThroughLink(fullPath) {
  try {
    return fs.statSync(fullPath).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Record the canonical path of `dir` and report whether it is new.
 *
 * Without this, a junction loop reaches the same real directory again under a
 * longer path and reports duplicate roots at increasing depths. `realpathSync`
 * collapses those paths. A path that cannot be resolved is left to the walk,
 * which already tolerates directories it cannot read.
 *
 * @param {Set<string>} seen canonical paths already walked
 * @param {string} dir
 * @returns {boolean} true when `dir` should be walked
 */
function claimRealDirectory(seen, dir) {
  let real;
  try {
    real = fs.realpathSync(dir);
  } catch {
    return true;
  }
  if (seen.has(real)) return false;
  seen.add(real);
  return true;
}

/**
 * Every game root at or below `start`, shallowest first.
 *
 * Deployed games are not always at the top of the folder a user points at:
 * some add a `www/` wrapper (MV), some ship the real game inside a differently
 * named subfolder, and a few keep `data/www/` for the browser build. A bounded
 * breadth-first walk finds all of them in one pass and lets the caller decide
 * what to do when there is more than one.
 *
 * Links are followed: a game is often reached through a Windows directory
 * junction (the launcher folder links to the real one), and `readdir` reports
 * such a junction as a link rather than a directory. Each real directory is
 * walked once, so a junction loop cannot make the walk repeat itself.
 *
 * @param {string} start
 * @returns {Array<{ root: string, depth: number }>}
 */
export function findProjectRoots(start) {
  const resolved = path.resolve(start);
  const found = [];
  const seen = new Set();
  let frontier = [{ dir: resolved, depth: 0 }];
  let depth = 0;
  while (frontier.length > 0 && depth <= MAX_SEARCH_DEPTH) {
    const next = [];
    for (const item of frontier) {
      if (!claimRealDirectory(seen, item.dir)) continue;
      if (looksLikeProject(item.dir)) {
        found.push({ root: item.dir, depth: item.depth });
        continue; // a real root is the shallowest match; no need to descend
      }
      if (item.depth === MAX_SEARCH_DEPTH) continue;
      let entries;
      try {
        entries = fs.readdirSync(item.dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const full = path.join(item.dir, entry.name);
        if (!entry.isDirectory()) {
          // Only links pay for the stat: junctions are links, plain files are not.
          if (!entry.isSymbolicLink() || !isDirectoryThroughLink(full)) continue;
        }
        if (SKIP_DIRS.has(entry.name.toLowerCase())) continue;
        if (entry.name.startsWith(".")) continue;
        next.push({ dir: full, depth: item.depth + 1 });
      }
    }
    frontier = next;
    depth += 1;
  }
  found.sort((a, b) => a.depth - b.depth || a.root.localeCompare(b.root));
  return found;
}

/**
 * Locate the project root at or below `start` (see `MAX_SEARCH_DEPTH`).
 *
 * @param {string} start
 * @returns {string|null}
 * @throws {Error} when several unrelated games live under `start`
 */
export function findProjectRoot(start) {
  const roots = findProjectRoots(start);
  if (roots.length === 0) return null;
  const shallowest = roots.filter((c) => c.depth === roots[0].depth);
  if (shallowest.length > 1) {
    throw new Error(
      "found " +
        shallowest.length +
        " RPG Maker projects under " +
        path.resolve(start) +
        ", pass one of them instead: " +
        shallowest.map((c) => c.root).join(", ")
    );
  }
  return shallowest[0].root;
}

/**
 * Read `data/System.json`, transparently decoding obfuscated data files.
 *
 * @param {string} dataDir
 * @returns {any|null}
 */
function readSystem(dataDir) {
  const decoded = readDataFile(path.join(dataDir, "System.json"));
  return decoded.data;
}

/**
 * Inspect a directory and describe the game it holds.
 *
 * @param {string} start directory to inspect (the game folder, its parent, or
 *   any folder up to `MAX_SEARCH_DEPTH` levels above the real root)
 * @returns {Project}
 * @throws {Error} when no RPG Maker project can be found, or when several can
 */
export function openProject(start) {
  const root = findProjectRoot(start);
  if (!root) {
    throw new Error(
      "not an RPG Maker project (no js/rmmz_core.js or js/rpg_core.js found in " +
        path.resolve(start) +
        " or up to " +
        MAX_SEARCH_DEPTH +
        " levels below it)"
    );
  }
  const engine = fs.existsSync(path.join(root, MZ_CORE)) ? "mz" : "mv";
  const dataDir = path.join(root, "data");
  const pluginDir = path.join(root, "js", "plugins");
  const pluginsFile = path.join(root, "js", "plugins.js");
  const indexPath = path.join(root, "index.html");

  if (!fs.existsSync(dataDir)) {
    throw new Error("missing data/ directory in " + root);
  }
  if (!fs.existsSync(pluginsFile)) {
    throw new Error("missing js/plugins.js in " + root);
  }

  const system = readSystem(dataDir);
  let version = null;
  try {
    const core = fs.readFileSync(path.join(root, "js", engine === "mz" ? "rmmz_core.js" : "rpg_core.js"), "utf8");
    const m = core.match(/v(\d+\.\d+\.\d+)/);
    if (m) version = m[1];
  } catch {
    /* version is cosmetic */
  }

  return {
    root,
    engine,
    pluginDir,
    dataDir,
    pluginsFile,
    indexPath,
    gameTitle: system && typeof system.gameTitle === "string" ? system.gameTitle : null,
    version,
  };
}

/**
 * List every `data/*.json` file, sorted, as `{name, file}` pairs where
 * `name` is the bare filename and `file` the absolute path.
 *
 * @param {Project} project
 * @returns {Array<{ name: string, file: string }>}
 */
export function listDataFiles(project) {
  const out = [];
  for (const entry of fs.readdirSync(project.dataDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".json")) continue;
    out.push({ name: entry.name, file: path.join(project.dataDir, entry.name) });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/**
 * Map file names to the global that DataManager assigns them to, so the patch
 * layer can translate the same object the engine sees.
 *
 * @param {string} fileName
 * @returns {string|null}
 */
export function databaseGlobalFor(fileName) {
  const table = {
    "Actors.json": "$dataActors",
    "Classes.json": "$dataClasses",
    "Skills.json": "$dataSkills",
    "Items.json": "$dataItems",
    "Weapons.json": "$dataWeapons",
    "Armors.json": "$dataArmors",
    "Enemies.json": "$dataEnemies",
    "Troops.json": "$dataTroops",
    "States.json": "$dataStates",
    "Animations.json": "$dataAnimations",
    "Tilesets.json": "$dataTilesets",
    "CommonEvents.json": "$dataCommonEvents",
    "System.json": "$dataSystem",
    "MapInfos.json": "$dataMapInfos",
  };
  if (table[fileName]) return table[fileName];
  if (/^Map\d+\.json$/.test(fileName)) return "$dataMap";
  if (/^Test_.*\.json$/.test(fileName)) return null;
  return null;
}
