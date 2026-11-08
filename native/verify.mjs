/**
 * Verify the staged RGSS native components before they are published.
 *
 * `native/build.mjs` writes four files plus a SHA-256 manifest into
 * `native/prebuilt/`. That directory is gitignored, so the only guard between a
 * broken CI build and an npm tarball is this check. It deliberately trusts
 * nothing in the manifest: the schema and the exact file list are fixed here,
 * every digest is recomputed from the bytes on disk, and paths that could
 * escape the directory are rejected before any read.
 *
 * Usage:
 *   node native/verify.mjs
 *   node native/verify.mjs --dir <path-to-prebuilt>
 *
 * Exit code 0 means every file is present and matches; 1 means the package is
 * not publishable and the problems are printed one per line.
 *
 * @module native/verify
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** The only files a native package may contain, in build order. */
export const REQUIRED_FILES = Object.freeze([
  "yakusha_rgss_hook.dll",
  "libunwind.dll",
  "yakusha_injector.exe",
  "bootstrap.rb",
]);

/** Manifest schema this verifier understands. */
export const MANIFEST_SCHEMA = 1;

/** Least number of bytes worth reading from a path before calling it a file. */
const MAX_MANIFEST_BYTES = 64 * 1024;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sha256(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/**
 * Check one staged native directory.
 *
 * @param {string} [dir] directory holding manifest.json and the four files
 * @returns {{
 *   ok: boolean,
 *   dir: string,
 *   manifest: object | null,
 *   files: Record<string, { sha256: string, size: number }>,
 *   problems: string[],
 * }}
 */
export function verifyPrebuilt(dir = path.join(here, "prebuilt")) {
  const problems = [];
  const files = {};
  let manifest = null;
  const fail = (message) => problems.push(message);

  if (typeof dir !== "string" || dir.length === 0) {
    return { ok: false, dir: String(dir), manifest, files, problems: ["the prebuilt directory is not a path"] };
  }

  let stat;
  try {
    stat = fs.statSync(dir);
  } catch {
    return { ok: false, dir, manifest, files, problems: ["the prebuilt directory does not exist: " + dir] };
  }
  if (!stat.isDirectory()) {
    return { ok: false, dir, manifest, files, problems: ["the prebuilt path is not a directory: " + dir] };
  }

  const manifestPath = path.join(dir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    fail("manifest.json is missing");
  } else {
    let source;
    try {
      const manifestStat = fs.lstatSync(manifestPath);
      if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) {
        fail("manifest.json is not a regular file");
      } else if (manifestStat.size > MAX_MANIFEST_BYTES) {
        fail("manifest.json is larger than " + MAX_MANIFEST_BYTES + " bytes");
      } else {
        source = fs.readFileSync(manifestPath, "utf8");
      }
    } catch (error) {
      fail("manifest.json cannot be read: " + error.message);
    }
    if (source !== undefined) {
      try {
        manifest = JSON.parse(source);
      } catch {
        fail("manifest.json is not valid JSON");
      }
    }
  }

  if (manifest !== null) {
    if (!isPlainObject(manifest)) {
      fail("manifest.json must be a JSON object");
    } else {
      const keys = Object.keys(manifest);
      for (const key of keys) {
        if (key !== "schema" && key !== "files") fail("manifest.json has an unknown key: " + key);
      }
      if (manifest.schema !== MANIFEST_SCHEMA) {
        fail("manifest.json schema must be " + MANIFEST_SCHEMA + ", found " + JSON.stringify(manifest.schema));
      }
      if (!isPlainObject(manifest.files)) {
        fail("manifest.json files must be an object");
      } else {
        const listed = Object.keys(manifest.files);
        for (const name of listed) {
          if (name.length === 0 || name === "." || name === ".." || path.basename(name) !== name || /[\\/\0]/.test(name)) {
            fail("manifest.json contains an unsafe file name: " + JSON.stringify(name));
          }
        }
        for (const name of REQUIRED_FILES) {
          if (!Object.prototype.hasOwnProperty.call(manifest.files, name)) fail("manifest.json is missing the entry: " + name);
        }
        for (const name of listed) {
          if (!REQUIRED_FILES.includes(name)) fail("manifest.json lists an unexpected file: " + name);
        }
        for (const name of REQUIRED_FILES) {
          if (!Object.prototype.hasOwnProperty.call(manifest.files, name)) continue;
          const digest = manifest.files[name];
          const file = path.join(dir, name);
          if (typeof digest !== "string" || !/^[0-9a-f]{64}$/.test(digest)) {
            fail("manifest.json entry for " + name + " is not a lowercase SHA-256 digest");
            continue;
          }
          let fileStat;
          try {
            fileStat = fs.lstatSync(file);
          } catch {
            fail("the listed file is missing: " + name);
            continue;
          }
          if (fileStat.isSymbolicLink()) {
            fail("the listed file is a symbolic link: " + name);
            continue;
          }
          if (!fileStat.isFile()) {
            fail("the listed path is not a regular file: " + name);
            continue;
          }
          const actual = sha256(file);
          if (actual !== digest) {
            fail("SHA-256 mismatch for " + name + ": manifest " + digest + ", file " + actual);
            continue;
          }
          files[name] = { sha256: actual, size: fileStat.size };
        }
      }
    }
  }

  // Extra files are just as dangerous as missing ones: an old DLL left behind
  // by a failed build would be shipped next to the right manifest. Ignore only
  // the manifest itself.
  let entries = [];
  try {
    entries = fs.readdirSync(dir);
  } catch (error) {
    fail("the prebuilt directory cannot be listed: " + error.message);
  }
  for (const name of entries) {
    if (name === "manifest.json") continue;
    if (!REQUIRED_FILES.includes(name)) fail("the prebuilt directory contains an unexpected entry: " + name);
  }

  return { ok: problems.length === 0, dir, manifest, files, problems };
}

/** Human-readable one-line-per-problem report. */
export function formatProblems(result) {
  return result.problems.map((problem) => "native package: " + problem).join("\n");
}

function main(argv) {
  const index = argv.indexOf("--dir");
  const dir = index >= 0 && index + 1 < argv.length ? argv[index + 1] : path.join(here, "prebuilt");
  const result = verifyPrebuilt(dir);
  if (result.ok) {
    // stderr keeps `npm pack --json` stdout parseable; exit code carries the verdict.
    console.error("native package: ok (" + REQUIRED_FILES.length + " files, " + dir + ")");
    return;
  }
  console.error(formatProblems(result));
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
