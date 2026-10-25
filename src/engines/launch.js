/**
 * Launch one game executable.
 *
 * The rules are deliberately narrow (docs/engines.md §8): only Windows, only a
 * regular .exe directly inside the project root, no arguments, no waiting, no
 * killing. The CLI must never let a game path, dictionary or config choose an
 * executable, so discovery is a pure, testable step and spawn is injectable.
 *
 * @module engines/launch
 */

import { spawn as nodeSpawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** How many candidate file names an E_EXE error carries. */
export const MAX_CANDIDATES = 20;

/** Environment variables that must not reach the game process. */
const PRIVATE_ENV = new Set(["yakusha_api_key", "openai_api_key"]);

/**
 * @param {string} code
 * @param {string} message
 * @param {Record<string, unknown>} [details]
 * @returns {Error & { code: string, details?: Record<string, unknown> }}
 */
function launchError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

/** @param {string} [platform] */
export function isWindows(platform = process.platform) {
  return platform === "win32";
}

/**
 * True for a plain executable file name: no directory part, no traversal, not
 * absolute, and .exe in any case. The caller resolves it inside the project.
 *
 * @param {unknown} name
 * @returns {boolean}
 */
export function isBareExecutableName(name) {
  if (typeof name !== "string" || name.length === 0) return false;
  if (name.includes("/") || name.includes("\\") || name.includes("..")) return false;
  // Drive-relative names such as C:Game.exe are path syntax even though
  // path.win32.isAbsolute() returns false for them.
  if (/^[A-Za-z]:/.test(name)) return false;
  if (path.isAbsolute(name) || path.win32.isAbsolute(name)) return false;
  return /\.exe$/i.test(name);
}

/**
 * Regular .exe files directly inside the project root, sorted by name.
 *
 * lstat (not stat) is intentional: a symbolic link is not a regular file, so a
 * link pointing outside the project can never be selected.
 *
 * @param {string} root
 * @returns {string[]}
 */
export function listExecutables(root) {
  let entries;
  try {
    entries = fs.readdirSync(root);
  } catch (error) {
    throw launchError("E_IO", "cannot read " + root + ": " + ((error && error.code) || "read failed"));
  }
  const names = [];
  for (const name of entries) {
    if (!/\.exe$/i.test(name)) continue;
    const full = path.join(root, name);
    let stat;
    try {
      stat = fs.lstatSync(full);
    } catch (error) {
      if (error && error.code === "ENOENT") continue;
      throw launchError("E_IO", "cannot inspect " + full + ": " + ((error && error.code) || "lstat failed"));
    }
    if (stat.isFile()) names.push(name);
  }
  return names.sort();
}

/**
 * Pick the executable for a launch.
 *
 * @param {string} root project root
 * @param {string} [requested] bare file name from --exe
 * @returns {string} absolute path of the chosen executable
 */
export function selectExecutable(root, requested) {
  const candidates = listExecutables(root);
  const details = { candidates: candidates.slice(0, MAX_CANDIDATES) };
  if (requested !== undefined && requested !== null) {
    if (!isBareExecutableName(requested)) {
      throw launchError("E_EXE", "--exe must be a bare .exe file name: " + requested, details);
    }
    const wanted = requested.toLowerCase();
    const match = candidates.find((name) => name.toLowerCase() === wanted);
    if (!match) throw launchError("E_EXE", "no " + requested + " in " + root, details);
    return path.join(root, match);
  }
  if (candidates.length === 1) return path.join(root, candidates[0]);
  if (candidates.length === 0) {
    throw launchError(
      "E_EXE",
      "no .exe found in " + root + " (start the game once, or pass --exe <name>)",
      details
    );
  }
  throw launchError("E_EXE", "found " + candidates.length + " .exe files in " + root + ", pass --exe <name>", details);
}

/**
 * Copy the environment without translation credentials. Matching is case
 * insensitive because Windows environment variable names are.
 *
 * @param {NodeJS.ProcessEnv} [base]
 * @returns {Record<string, string|undefined>}
 */
export function childEnvironment(base = process.env) {
  const env = {};
  for (const [name, value] of Object.entries(base || {})) {
    if (PRIVATE_ENV.has(name.toLowerCase())) continue;
    env[name] = value;
  }
  return env;
}

/**
 * @param {string} exe
 * @param {unknown} error
 * @returns {Error & { code: string }}
 */
function spawnFailure(exe, error) {
  const code = error && typeof error === "object" && error.code ? error.code : "spawn failed";
  return launchError("E_IO", "cannot start " + exe + " (" + code + ")");
}

/**
 * Spawn the game and return as soon as the process exists.
 *
 * The child is detached, its stdio is ignored and it is unref'd, so the CLI can
 * exit while the game keeps running. We only wait for Node's "spawn" event to
 * turn a failed CreateProcess into E_IO instead of an unhandled error event.
 *
 * @param {import("../core/mzproject.js").Project} project
 * @param {{ exe?: string, platform?: string, spawn?: Function, env?: NodeJS.ProcessEnv }} [options]
 * @returns {Promise<{ pid: number, exe: string, root: string }>}
 */
export async function launchProject(project, options = {}) {
  const platform = options.platform || process.platform;
  if (!isWindows(platform)) {
    throw launchError("E_UNSUPPORTED_PLATFORM", "launch is only supported on Windows (current platform: " + platform + ")");
  }
  const exePath = selectExecutable(project.root, options.exe);
  const spawnFn = options.spawn || nodeSpawn;
  const env = childEnvironment(options.env || process.env);

  let child;
  try {
    child = spawnFn(exePath, [], {
      cwd: project.root,
      detached: true,
      stdio: "ignore",
      shell: false,
      windowsHide: false,
      env,
    });
  } catch (error) {
    throw spawnFailure(exePath, error);
  }
  if (child && typeof child.unref === "function") child.unref();

  return await new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      child.removeListener("error", onError);
      child.removeListener("spawn", onSpawn);
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const onError = (error) => finish(reject, spawnFailure(exePath, error));
    const onSpawn = () => {
      // The launch succeeded; later errors belong to a process the CLI does not
      // manage. Keep the listener so a detached child cannot crash the parent
      // while it is still shutting down.
      child.on("error", () => {});
      finish(resolve, { pid: child.pid, exe: exePath, root: project.root });
    };
    child.once("error", onError);
    child.once("spawn", onSpawn);
  });
}
