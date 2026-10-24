/**
 * RPG Maker project discovery.
 *
 * A "project root" is the directory that contains both `js/` (engine scripts)
 * and `data/` (database JSON). Deployed games usually keep that layout at the
 * top level; some are wrapped in a `www/` folder.
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

/**
 * Locate the project root at or one level below `start`.
 *
 * @param {string} start
 * @returns {string|null}
 */
export function findProjectRoot(start) {
  const resolved = path.resolve(start);
  if (looksLikeProject(resolved)) return resolved;
  const nested = path.join(resolved, "www");
  if (looksLikeProject(nested)) return nested;
  return null;
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
 * @param {string} start directory to inspect (the game folder or its parent)
 * @returns {Project}
 * @throws {Error} when no RPG Maker project can be found
 */
export function openProject(start) {
  const root = findProjectRoot(start);
  if (!root) {
    throw new Error(
      "not an RPG Maker project (no js/rmmz_core.js or js/rpg_core.js found in " +
        path.resolve(start) +
        ")"
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
