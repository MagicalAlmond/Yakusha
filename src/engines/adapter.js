/**
 * Engine-neutral plumbing shared by the MZ and MV adapters.
 *
 * This module holds the contract constants, the detect result shapes and the
 * operations that are identical for both engines today. Engine modules stay a
 * thin wrapper: their only real differences are the core script they look for
 * and the capability bits they advertise.
 *
 * @module engines/adapter
 */

import fs from "node:fs";
import path from "node:path";

import {
  MAX_SEARCH_DEPTH,
  findProjectRoot,
  findProjectRoots,
  openProject,
  listDataFiles,
} from "../core/mzproject.js";
import { extractProject, toSortedArray } from "../core/extract.js";
import {
  dictionaryPath,
  emptyDictionary,
  loadDictionary,
  saveDictionary,
  stats,
} from "../core/dict.js";
import { installPlugin, uninstallPlugin } from "../core/install.js";
import { stripCodes } from "../core/textkey.js";

/** Capability names every adapter must expose (docs/engines.md §3). */
export const CAPABILITY_KEYS = Object.freeze([
  "extract",
  "export",
  "runtime",
  "launch",
  "debuggable",
  "attach",
  "liveReload",
]);

/**
 * Build a complete capability object, overriding only what an engine supports.
 *
 * Unknown capabilities stay false so a new adapter cannot accidentally claim
 * something just by omitting it.
 *
 * @param {Record<string, unknown>} [overrides]
 * @returns {Record<string, unknown>}
 */
export function capabilities(overrides = {}) {
  return {
    extract: false,
    export: false,
    runtime: null,
    launch: false,
    debuggable: false,
    attach: false,
    liveReload: false,
    ...overrides,
  };
}

/**
 * @param {import("../core/mzproject.js").Project} project
 * @returns {{ ok: true, project: import("../core/mzproject.js").Project }}
 */
export function detectOk(project) {
  return { ok: true, project };
}

/**
 * @param {"E_NOT_PROJECT"|"E_MULTI_ROOT"} code
 * @param {string} message
 * @param {string[]} [candidates]
 * @returns {{ ok: false, code: string, message: string, candidates?: string[] }}
 */
export function detectFail(code, message, candidates) {
  const result = { ok: false, code, message };
  if (Array.isArray(candidates) && candidates.length > 0) {
    result.candidates = [...candidates];
  }
  return result;
}

/** The historical not-a-project message, kept verbatim for CLI compatibility. */
export function notProjectMessage(startDir) {
  return (
    "not an RPG Maker project (no js/rmmz_core.js or js/rpg_core.js found in " +
    path.resolve(startDir) +
    " or up to " +
    MAX_SEARCH_DEPTH +
    " levels below it)"
  );
}

/**
 * The shallowest roots under a directory, in the same order findProjectRoots
 * reports them. Used for E_MULTI_ROOT candidates.
 *
 * @param {string} startDir
 * @returns {string[]}
 */
function shallowestRoots(startDir) {
  const roots = findProjectRoots(startDir);
  if (roots.length === 0) return [];
  const depth = roots[0].depth;
  return roots.filter((item) => item.depth === depth).map((item) => item.root);
}

/**
 * Detect one engine without throwing for an expected failure.
 *
 * The root search is shared with openProject. Checking the engine's own core
 * script before opening the project keeps the MZ adapter from reporting a
 * missing data/ directory for what is really an MV game.
 *
 * @param {"mz"|"mv"} engineId
 * @param {string} startDir
 * @returns {{ ok: true, project: import("../core/mzproject.js").Project } | { ok: false, code: string, message: string, candidates?: string[] }}
 */
export function detectFor(engineId, startDir) {
  let root = null;
  try {
    root = findProjectRoot(startDir);
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    if (!/^found \d+ RPG Maker projects/.test(message)) throw error;
    return detectFail("E_MULTI_ROOT", message, shallowestRoots(startDir));
  }
  if (!root) return detectFail("E_NOT_PROJECT", notProjectMessage(startDir));

  const coreFile = path.join(root, "js", engineId === "mz" ? "rmmz_core.js" : "rpg_core.js");
  if (!fs.existsSync(coreFile)) return detectFail("E_NOT_PROJECT", notProjectMessage(startDir));

  let project;
  try {
    project = openProject(root);
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    if (/^missing (data\/ directory|js\/plugins\.js) in /.test(message)) {
      return detectFail("E_NOT_PROJECT", message);
    }
    if (/^not an RPG Maker project/.test(message)) {
      return detectFail("E_NOT_PROJECT", notProjectMessage(startDir));
    }
    throw error;
  }
  if (project.engine !== engineId) return detectFail("E_NOT_PROJECT", notProjectMessage(startDir));
  return detectOk(project);
}

/** A launch/attach placeholder that names the missing feature. */
export function notImplemented(what) {
  const error = new Error(what + " is not implemented in 0.10");
  error.code = "E_NOT_IMPLEMENTED";
  return error;
}

/**
 * CLI scan payload (docs/json-contract.md §7), identical for both engines.
 *
 * @param {import("../core/mzproject.js").Project} project
 * @returns {Record<string, unknown>}
 */
export function scanProject(project) {
  const result = extractProject(project.root);
  const entries = toSortedArray(result);
  const withCodes = entries.filter((entry) => stripCodes(entry.text) !== entry.text).length;
  return {
    root: project.root,
    engine: project.engine,
    engineVersion: project.version,
    gameTitle: project.gameTitle,
    dataFiles: listDataFiles(project).length,
    uniqueStrings: result.entries.size,
    totalStrings: result.totalStrings,
    stringsWithControlCodes: withCodes,
    encodings: result.encodings,
    undecodable: result.undecodable,
    perFile: result.perFile,
  };
}

/**
 * Write the dictionary with empty targets, adding only new keys.
 *
 * A dictionary that cannot be parsed is rebuilt rather than blocking extract;
 * that matches the 0.9 behaviour and keeps a damaged file recoverable.
 *
 * @param {import("../core/mzproject.js").Project} project
 * @returns {{ file: string, added: number, total: number, translated: number, pending: number }}
 */
export function extractIntoDictionary(project) {
  const result = extractProject(project.root);
  const file = dictionaryPath(project.root);
  let existing = null;
  if (fs.existsSync(file)) {
    try {
      existing = loadDictionary(file);
    } catch {
      existing = null;
    }
  }
  const target = existing || emptyDictionary(project.gameTitle);
  let added = 0;
  for (const entry of result.entries.values()) {
    const before = target.entries[entry.text];
    if (!before) {
      target.entries[entry.text] = { text: "", contexts: [...entry.contexts].sort() };
      added += 1;
    } else {
      for (const context of entry.contexts) {
        if (!before.contexts.includes(context)) before.contexts.push(context);
      }
    }
  }
  saveDictionary(file, target);
  const summary = stats(target);
  return {
    file,
    added,
    total: summary.total,
    translated: summary.translated,
    pending: summary.pending,
  };
}

/**
 * Install the runtime plugin. Kept here so both adapters cannot drift apart.
 *
 * @param {import("../core/mzproject.js").Project} project
 * @param {{ embed?: Record<string,string>|null, parameters?: Record<string,string> }} [options]
 */
export function installRuntime(project, options = {}) {
  return installPlugin(project, options);
}

/**
 * Remove the runtime plugin and, when safe, restore plugins.js.
 *
 * @param {import("../core/mzproject.js").Project} project
 */
export function uninstallRuntime(project) {
  return uninstallPlugin(project);
}
