/**
 * Kirikiri project detection.
 *
 * A Kirikiri project root is a directory that contains at least one `.xp3`
 * archive directly or inside its `data/` directory. Like the other engines,
 * searching walks *down* from the start directory (up to
 * {@link MAX_SEARCH_DEPTH} levels) and multiple candidates at the shallowest
 * level stop the search with E_MULTI_ROOT.
 *
 * @module engines/krkr/project
 */

import fsSync from "node:fs";
import path from "node:path";

/** How many directory levels below the start directory to search. */
export const MAX_SEARCH_DEPTH = 3;

const XP3_SUFFIX = ".xp3";

function listDirectories(dir) {
  const out = [];
  let names;
  try {
    names = fsSync.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const item of names) {
    if (item.isDirectory()) out.push(path.join(dir, item.name));
  }
  return out;
}
function hasXp3(dir) {
  let names;
  try {
    names = fsSync.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  return names.some((item) => item.isFile() && item.name.toLowerCase().endsWith(XP3_SUFFIX));
}

/**
 * True when `dir` (or its `data/` subdirectory) holds at least one .xp3 archive.
 * @param {string} dir absolute or relative directory
 * @returns {boolean}
 */
export function looksLikeKrkrProject(dir) {
  return hasXp3(dir) || hasXp3(path.join(dir, "data"));
}

/**
 * Every candidate root at any depth (breadth-first). Used by tests and the
 * multi-root message; not part of the adapter contract.
 * @param {string} startDir directory to search below
 * @returns {string[]}
 */
export function findKrkrRoots(startDir) {
  const found = [];
  let level = [startDir];
  for (let depth = 0; depth <= MAX_SEARCH_DEPTH && level.length > 0; depth += 1) {
    const next = [];
    for (const dir of level) {
      if (looksLikeKrkrProject(dir)) found.push(dir);
      next.push(...listDirectories(dir));
    }
    level = next;
  }
  return found;
}
function shallowest(roots) {
  let best = null;
  let bestDepth = Infinity;
  for (const root of roots) {
    const depth = root.split(/[\\/]/).filter(Boolean).length;
    if (depth < bestDepth) {
      best = [root];
      bestDepth = depth;
    } else if (depth === bestDepth) {
      best.push(root);
    }
  }
  return best || [];
}

/**
 * Find the single project root at or below `startDir`, or null when there is
 * none. Multiple candidates at the shallowest level throw E_MULTI_ROOT with
 * the candidates listed in raw code-point order of their absolute paths.
 *
 * Detection never throws for an empty directory: the adapter turns null into
 * its own E_NOT_PROJECT wording, the same way every other engine reports
 * "nothing here" without the caller having to catch.
 *
 * @param {string} startDir directory to search
 * @returns {string|null} the project root (absolute path), or null
 */
export function findKrkrRoot(startDir) {
  const absStart = path.resolve(startDir);
  const roots = findKrkrRoots(absStart);
  if (roots.length === 0) return null;
  const finalists = shallowest(roots);
  if (finalists.length > 1) {
    const ordered = finalists.slice().sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const error = new Error(
      "found " + ordered.length + " Kirikiri projects under " + absStart +
      ", pass one of them instead: " + ordered.join(", ")
    );
    error.code = "E_MULTI_ROOT";
    throw error;
  }
  return finalists[0];
}
/**
 * Open a detected Kirikiri project: gather the archive list and derive the
 * data directory. Title and version stay unknown in 0.13 (they live inside
 * encrypted-or-optional config files we do not parse).
 *
 * @param {string} root absolute project root
 * @returns {{ root: string, engine: "krkr", version: null, gameTitle: null, dataDir: string, archives: string[] }}
 */
export function openKrkrProject(root) {
  const absRoot = path.resolve(root);
  const direct = hasXp3(absRoot);
  const dataDir = direct ? absRoot : path.join(absRoot, "data");
  let names = [];
  try {
    names = fsSync.readdirSync(dataDir, { withFileTypes: true });
  } catch {
    // hasXp3() guaranteed one of the two locations; this cannot happen.
  }
  const archives = names
    .filter((item) => item.isFile() && item.name.toLowerCase().endsWith(XP3_SUFFIX))
    .map((item) => path.join(dataDir, item.name))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    root: absRoot,
    engine: "krkr",
    version: null,
    gameTitle: null,
    dataDir,
    archives,
  };
}
