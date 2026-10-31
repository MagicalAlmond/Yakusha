/**
 * The native delivery layer for RGSS.
 *
 * RGSS games have no plugin directory and no loadable add-on: the Ruby VM is
 * inside the game's own `RGSSxxx.dll`, and the text lives inside Marshal data
 * documents. The decided route (DEVLOG §8.1 item 10, 2026-10-27) is a native
 * injector:
 *
 *   - `yakusha_rgss_hook.dll` is loaded into the suspended game process and
 *     patches `kernel32!GetProcAddress` in the game's import table, so it can
 *     wrap the `RGSSGameMain` and `RGSSEval` entry points the game resolves at
 *     startup;
 *   - `yakusha_injector.exe` starts the game suspended, loads the hook and
 *     resumes it;
 *   - `bootstrap.rb` is evaluated through the real `RGSSEval` and installs a
 *     `Kernel#load_data` wrapper that translates strings as the game loads its
 *     own databases and maps;
 *   - `dictionary.txt` is generated from the project dictionary, one
 *     `base64(source)\tbase64(target)` line per translated entry.
 *
 * Everything is installed under `<game>/yakusha/native/`, so uninstall is a
 * directory removal and the game's own files are never touched.
 *
 * The components are shipped prebuilt (see `native/build.mjs`) and described
 * by a SHA-256 manifest. install verifies the manifest before copying anything;
 * a mismatch stops the install instead of putting an unknown binary next to the
 * game.
 *
 * @module engines/rgss/native
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { dictionaryPath, loadDictionary } from "../../core/dict.js";
import { childEnvironment, isWindows, selectExecutable } from "../launch.js";

/** Where install puts the native components, relative to the game root. */
export const NATIVE_DIR = path.join("yakusha", "native");

/** The manifest that lists every component and its SHA-256. */
export const MANIFEST_FILE = "manifest.json";

/** Manifest schema this reader understands. */
export const MANIFEST_SCHEMA = 1;

export const HOOK_FILE = "yakusha_rgss_hook.dll";
export const UNWIND_FILE = "libunwind.dll";
export const INJECTOR_FILE = "yakusha_injector.exe";
export const BOOTSTRAP_FILE = "bootstrap.rb";
export const DICTIONARY_FILE = "dictionary.txt";

/**
 * The files a complete install owns. `dictionary.txt` is generated, the rest
 * are copied from the package's prebuilt directory.
 */
export const COMPONENT_FILES = [HOOK_FILE, UNWIND_FILE, INJECTOR_FILE, BOOTSTRAP_FILE];

/**
 * An error the CLI turns into an envelope code.
 *
 * @param {string} code E_* code
 * @param {string} message one line
 * @returns {Error}
 */
function coded(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/**
 * The absolute path of the native directory for one game.
 *
 * @param {{ root: string }} project
 * @returns {string}
 */
export function nativeDir(project) {
  return path.join(project.root, NATIVE_DIR);
}

/**
 * The package's own prebuilt directory.
 *
 * `src/engines/rgss/native.js` sits three levels below the repository root.
 *
 * @returns {string}
 */
export function packageAssetsDir() {
  // Tests and local builds point at their own directory; the shipped package
  // always uses native/prebuilt next to the sources.
  if (process.env.YAKUSHA_NATIVE_ASSETS) return path.resolve(process.env.YAKUSHA_NATIVE_ASSETS);
  return fileURLToPath(new URL("../../../native/prebuilt/", import.meta.url));
}

/**
 * @param {string} file
 * @returns {string}
 */
export function hashFile(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/**
 * Read and validate `manifest.json` from an assets directory.
 *
 * @param {string} dir
 * @returns {{ schema: number, files: Record<string, string> }}
 */
export function readManifest(dir) {
  const file = path.join(dir, MANIFEST_FILE);
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw coded("E_CONFIG", "native component manifest is missing or unreadable: " + file);
  }
  if (!raw || typeof raw !== "object" || raw.schema !== MANIFEST_SCHEMA || !raw.files || typeof raw.files !== "object") {
    throw coded("E_CONFIG", "native component manifest is invalid: " + file);
  }
  const files = {};
  for (const [name, digest] of Object.entries(raw.files)) {
    if (typeof digest !== "string" || !/^[0-9a-f]{64}$/.test(digest)) {
      throw coded("E_CONFIG", "native component manifest has a bad hash for " + name + ": " + file);
    }
    files[name] = digest;
  }
  for (const name of COMPONENT_FILES) {
    if (!(name in files)) throw coded("E_CONFIG", "native component manifest does not list " + name + ": " + file);
  }
  return { schema: raw.schema, files };
}

/**
 * Verify every component against the manifest before anything is copied.
 *
 * @param {string} dir
 * @returns {{ manifest: { schema: number, files: Record<string, string> }, ok: boolean, missing: string[], mismatched: string[] }}
 */
export function verifyAssets(dir) {
  const manifest = readManifest(dir);
  const missing = [];
  const mismatched = [];
  for (const [name, digest] of Object.entries(manifest.files)) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) {
      missing.push(name);
      continue;
    }
    if (hashFile(file) !== digest) mismatched.push(name);
  }
  return { manifest, ok: missing.length === 0 && mismatched.length === 0, missing, mismatched };
}

/**
 * Check an installed native directory against the manifest that install wrote.
 *
 * This is the read-only twin of `installNative`: install verifies the packaged
 * assets before copying them, while this checks what is actually next to the
 * game. A damaged install must not be mistaken for a working one: the game
 * would start without translation, or crash while loading the hook.
 *
 * @param {{ root: string }} project
 * @returns {{ dir: string, installed: boolean, intact: boolean, files: string[], missing: string[], mismatched: string[], manifestError: string | null, dictionaryEntries: number, dictionaryStale: boolean }}
 */
export function nativeStatus(project) {
  const dir = nativeDir(project);
  const manifestFile = path.join(dir, MANIFEST_FILE);
  const installed = fs.existsSync(manifestFile);
  const missing = [];
  const mismatched = [];
  let manifestError = null;
  if (installed) {
    try {
      const manifest = readManifest(dir);
      for (const [name, digest] of Object.entries(manifest.files)) {
        const file = path.join(dir, name);
        if (!fs.existsSync(file)) missing.push(name);
        else if (hashFile(file) !== digest) mismatched.push(name);
      }
    } catch (error) {
      manifestError = error && error.message ? error.message : "native component manifest is unreadable";
    }
  }
  const dictionary = path.join(dir, DICTIONARY_FILE);
  if (installed && !fs.existsSync(dictionary)) missing.push(DICTIONARY_FILE);
  let dictionaryStale = false;
  if (installed) {
    const current = currentDictionaryText(project);
    if (current !== null) {
      const installedText = fs.existsSync(dictionary) ? fs.readFileSync(dictionary, "utf8") : "";
      dictionaryStale = installedText !== current;
    }
  }
  const files = COMPONENT_FILES.filter((name) => fs.existsSync(path.join(dir, name)));
  const intact = installed && manifestError === null && missing.length === 0 && mismatched.length === 0;
  return {
    dir,
    installed,
    intact,
    files,
    missing,
    mismatched,
    manifestError,
    dictionaryEntries: countDictionaryLines(dictionary),
    dictionaryStale,
  };
}

/**
 * The dictionary.txt body the current project dictionary would produce, or
 * null when there is no readable dictionary at all. A missing dictionary is
 * already reported by doctor's dictionary check; this helper only answers the
 * "is the installed native copy current?" question.
 *
 * @param {{ root: string }} project
 * @returns {string | null}
 */
function currentDictionaryText(project) {
  try {
    const file = dictionaryPath(project.root);
    if (!fs.existsSync(file)) return null;
    return buildDictionaryText(loadDictionary(file)).text;
  } catch {
    return null;
  }
}

/**
 * Turn the project dictionary into the line format bootstrap.rb reads.
 *
 * Only entries with a non-empty translation are written. The order is the
 * sorted source order, so two installs of the same dictionary produce the same
 * file byte for byte.
 *
 * @param {{ entries: Record<string, { text?: string }> }} dictionary
 * @returns {{ text: string, entries: number }}
 */
export function buildDictionaryText(dictionary) {
  const keys = Object.keys(dictionary.entries || {}).filter((key) => {
    const entry = dictionary.entries[key];
    return entry && typeof entry.text === "string" && entry.text.length > 0;
  });
  keys.sort();
  const lines = keys.map((key) => {
    const source = Buffer.from(key, "utf8").toString("base64");
    const target = Buffer.from(dictionary.entries[key].text, "utf8").toString("base64");
    return source + "\t" + target;
  });
  return { text: lines.length === 0 ? "" : lines.join("\n") + "\n", entries: lines.length };
}

/**
 * Count the lines of an installed dictionary without decoding them.
 *
 * @param {string} file
 * @returns {number}
 */
function countDictionaryLines(file) {
  if (!fs.existsSync(file)) return 0;
  const text = fs.readFileSync(file, "utf8");
  let count = 0;
  for (const line of text.split("\n")) {
    if (line.length > 0 && line.includes("\t")) count += 1;
  }
  return count;
}

/**
 * Install the native components next to the game.
 *
 * The manifest is verified first and nothing is written when it does not pass:
 * a half-installed injector is worse than no install at all.
 *
 * @param {{ root: string }} project
 * @param {{ dryRun?: boolean, assetsDir?: string }} [options]
 * @returns {{ dir: string, files: string[], dictionaryEntries: number, dryRun: boolean, created: boolean }}
 */
export function installNative(project, options = {}) {
  const dryRun = options.dryRun === true;
  const assetsDir = options.assetsDir || packageAssetsDir();
  const assets = verifyAssets(assetsDir);
  if (!assets.ok) {
    if (assets.missing.length > 0) {
      throw coded("E_IO", "native component is missing: " + assets.missing.join(", ") + " (" + assetsDir + ")");
    }
    throw coded("E_IO", "native component failed its integrity check: " + assets.mismatched.join(", ") + " (" + assetsDir + ")");
  }

  const file = dictionaryPath(project.root);
  if (!fs.existsSync(file)) {
    throw coded("E_NO_DICTIONARY", "install --native needs a dictionary, run: yakusha extract \"" + project.root + "\"");
  }
  let dictionary;
  try {
    dictionary = loadDictionary(file);
  } catch {
    throw coded("E_DICTIONARY", "the dictionary is not valid JSON: " + file);
  }
  const built = buildDictionaryText(dictionary);
  const dir = nativeDir(project);
  const files = COMPONENT_FILES.slice();
  const existed = fs.existsSync(dir);

  if (dryRun) {
    return { dir, files, dictionaryEntries: built.entries, dryRun: true, created: false };
  }

  fs.mkdirSync(dir, { recursive: true });
  for (const name of COMPONENT_FILES) {
    fs.copyFileSync(path.join(assetsDir, name), path.join(dir, name));
  }
  fs.writeFileSync(path.join(dir, DICTIONARY_FILE), built.text, "utf8");
  fs.writeFileSync(path.join(dir, MANIFEST_FILE), JSON.stringify(assets.manifest, null, 2) + "\n", "utf8");
  return { dir, files, dictionaryEntries: built.entries, dryRun: false, created: !existed };
}

/**
 * Remove the native components.
 *
 * The manifest is the proof that this directory belongs to us: without it the
 * removal refuses, so a hand-made `yakusha/native` directory is never deleted
 * by accident.
 *
 * @param {{ root: string }} project
 * @returns {{ dir: string, removed: boolean }}
 */
export function uninstallNative(project) {
  const dir = nativeDir(project);
  if (!fs.existsSync(dir)) return { dir, removed: false };
  readManifest(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  return { dir, removed: true };
}

/**
 * Start the game through the injector.
 *
 * The injector starts the game suspended, loads the hook, resumes it and exits
 * after printing the game's pid. The game itself keeps running detached, like
 * `launchProject` does for the other engines.
 *
 * @param {{ root: string }} project
 * @param {{ exe?: string, spawn?: Function, env?: NodeJS.ProcessEnv }} [options]
 * @returns {Promise<{ pid: number, exe: string, root: string, injector: string }>}
 */
export async function launchNative(project, options = {}) {
  if (!isWindows(options.platform || process.platform)) {
    throw coded("E_UNSUPPORTED_PLATFORM", "launch is only supported on Windows");
  }
  const status = nativeStatus(project);
  if (!status.installed) {
    throw coded("E_EXE", "the native components are not installed - run: yakusha install --native \"" + project.root + "\"");
  }
  if (!status.intact) {
    const problems = status.manifestError
      ? [status.manifestError]
      : status.missing.concat(status.mismatched);
    throw coded(
      "E_IO",
      "the native components are damaged: " + (problems.join(", ") || "unknown damage") + " - run: yakusha install --native \"" + project.root + "\""
    );
  }
  const exePath = selectExecutable(project.root, options.exe);
  const injector = path.join(status.dir, INJECTOR_FILE);
  const hook = path.join(status.dir, HOOK_FILE);
  const spawnFn = options.spawn || spawn;
  const env = childEnvironment(options.env || process.env);

  return await new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnFn(injector, ["--game", exePath, "--dll", hook], {
        cwd: project.root,
        windowsHide: true,
        env,
      });
    } catch (error) {
      reject(coded("E_EXE", "cannot start " + injector + " (" + (error && error.code ? error.code : "spawn failed") + ")"));
      return;
    }
    let output = "";
    if (child.stdout) child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    if (child.stderr) child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.once("error", (error) => {
      reject(coded("E_EXE", "cannot start " + injector + " (" + (error && error.code ? error.code : "spawn failed") + ")"));
    });
    child.once("close", (code) => {
      const match = /pid=(\d+)/.exec(output);
      if (code === 0 && match) {
        resolve({ pid: Number(match[1]), exe: exePath, root: project.root, injector });
      } else {
        const reason = output.trim() || "exit code " + code;
        reject(coded("E_EXE", "the native injector failed: " + reason));
      }
    });
  });
}
