/**
 * Build and verify the portable Windows GUI bundle.
 *
 * The portable bundle is a plain Electron runtime directory: the stock
 * electron.exe is renamed to Yakusha.exe, the app lives in resources/app, and
 * the directory can be moved or copied as one piece. It is intentionally
 * unsigned (see docs/release.md); the checksums are an integrity check, not a
 * code-signing identity.
 *
 * This module is implemented with Node built-ins only and is safe to import
 * from tests. tools/portable.mjs is the command-line wrapper.
 *
 * @module tools/portable-lib
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PORTABLE_SCHEMA = 1;
export const PORTABLE_TOOL = "yakusha-portable";
export const BUILD_INFO_FILE = "build-info.json";
export const SUMS_FILE = "SHA256SUMS";
export const APP_PACKAGE_FILE = "resources/app/package.json";

export class PortableError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PortableError";
    this.code = code;
    this.exitCode = code === "E_USAGE" ? 2 : 1;
  }
}

export function sha256File(file) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}

/** Sorted POSIX-relative file names below dir (directories are not returned). */
export function walkFiles(dir, base = dir) {
  const found = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) found.push(path.relative(base, absolute).split(path.sep).join("/"));
    }
  };
  walk(dir);
  return found.sort((a, b) => a.localeCompare(b, "en"));
}

export function readJson(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    throw new PortableError("E_IO", "cannot read " + file + ": " + error.message);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new PortableError("E_IO", "invalid JSON in " + file + ": " + error.message);
  }
}

export function appManifest(pkg) {
  return {
    name: "yakusha",
    productName: "Yakusha",
    version: pkg.version,
    description: pkg.description || "",
    license: pkg.license || "GPL-3.0-or-later",
    type: "module",
    main: "gui/main.js",
    private: true,
  };
}

function requireFile(file, label) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw new PortableError("E_IO", label + " is missing: " + file);
  }
}

function requireDir(dir, label) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new PortableError("E_IO", label + " is missing: " + dir);
  }
}

function copyFile(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function copyTree(source, target) {
  fs.cpSync(source, target, { recursive: true, dereference: true });
}

function isOwnedOutput(dir) {
  try {
    const info = readJson(path.join(dir, BUILD_INFO_FILE));
    return info.schema === PORTABLE_SCHEMA && info.tool === PORTABLE_TOOL;
  } catch {
    return false;
  }
}

function checkNativeAssets(nativeDir) {
  requireDir(nativeDir, "native prebuilt directory");
  const manifestFile = path.join(nativeDir, "manifest.json");
  const manifest = readJson(manifestFile);
  if (!manifest || manifest.schema !== 1 || !manifest.files || typeof manifest.files !== "object") {
    throw new PortableError("E_IO", "native manifest is invalid: " + manifestFile);
  }
  for (const name of Object.keys(manifest.files).sort()) {
    const expected = manifest.files[name];
    const file = path.join(nativeDir, name);
    requireFile(file, "native component");
    const actual = sha256File(file);
    if (actual !== expected) {
      throw new PortableError("E_IO", "native component failed its integrity check: " + name + " (" + nativeDir + ")");
    }
  }
  return manifest;
}

function writeSums(root) {
  const lines = [];
  for (const rel of walkFiles(root)) {
    if (rel === SUMS_FILE) continue;
    lines.push(sha256File(path.join(root, rel)) + "  " + rel);
  }
  fs.writeFileSync(path.join(root, SUMS_FILE), lines.join("\n") + "\n", "utf8");
  return lines.length;
}

function totalBytes(root, files) {
  return files.reduce((sum, rel) => sum + fs.statSync(path.join(root, rel)).size, 0);
}

/**
 * Build a portable bundle into outDir.
 *
 * @param {object} options
 * @param {string} options.root repository root
 * @param {string} options.electronDir unpacked Electron distribution
 * @param {string} options.nativeDir directory holding manifest.json + components
 * @param {string} options.outDir output directory (must be absent, empty, or owned by this tool)
 * @param {boolean} [options.force] replace a previous portable build
 * @param {Date} [options.now] build timestamp (tests pin this)
 * @returns {{outDir: string, buildInfo: object, fileCount: number, totalBytes: number}}
 */
export function buildPortable({ root, electronDir, nativeDir, outDir, force = false, now = new Date() }) {
  const pkgFile = path.join(root, "package.json");
  const pkg = readJson(pkgFile);
  if (typeof pkg.version !== "string" || !/^\d+\.\d+\.\d+$/.test(pkg.version)) {
    throw new PortableError("E_IO", "package.json has no valid version: " + pkgFile);
  }
  requireDir(electronDir, "Electron distribution");
  requireFile(path.join(electronDir, "electron.exe"), "Electron executable");
  requireFile(path.join(electronDir, "version"), "Electron version file");
  const nativeManifest = checkNativeAssets(nativeDir);

  const electronVersion = fs.readFileSync(path.join(electronDir, "version"), "utf8").trim();
  if (!electronVersion) throw new PortableError("E_IO", "Electron version file is empty: " + path.join(electronDir, "version"));

  const destination = path.resolve(outDir);
  if (fs.existsSync(destination)) {
    const entries = fs.readdirSync(destination);
    if (entries.length > 0) {
      if (!force) {
        throw new PortableError("E_EXISTS", "output directory already exists; use --force to replace a previous portable build: " + destination);
      }
      if (!isOwnedOutput(destination)) {
        throw new PortableError("E_EXISTS", "refusing to replace a directory not created by this tool: " + destination);
      }
      fs.rmSync(destination, { recursive: true, force: true });
    }
  }

  const temporary = destination + ".tmp-" + process.pid + "-" + Date.now();
  fs.rmSync(temporary, { recursive: true, force: true });
  try {
    fs.mkdirSync(temporary, { recursive: true });
    fs.cpSync(electronDir, temporary, { recursive: true, dereference: true });
    fs.rmSync(path.join(temporary, "resources", "default_app.asar"), { force: true });
    fs.rmSync(path.join(temporary, "resources", "app"), { recursive: true, force: true });

    const executable = path.join(temporary, "electron.exe");
    requireFile(executable, "Electron executable");
    fs.renameSync(executable, path.join(temporary, "Yakusha.exe"));

    const appDir = path.join(temporary, "resources", "app");
    fs.mkdirSync(appDir, { recursive: true });
    for (const rel of ["bin", "src", "gui"]) {
      const source = path.join(root, rel);
      requireDir(source, "application directory");
      copyTree(source, path.join(appDir, rel));
    }
    copyTree(nativeDir, path.join(appDir, "native", "prebuilt"));
    fs.writeFileSync(path.join(appDir, "package.json"), JSON.stringify(appManifest(pkg), null, 2) + "\n", "utf8");
    copyFile(path.join(root, "README.md"), path.join(temporary, "README.md"));
    copyFile(path.join(root, "LICENSE"), path.join(temporary, "LICENSE"));

    const payloadFiles = walkFiles(temporary).filter((rel) => rel !== BUILD_INFO_FILE && rel !== SUMS_FILE);
    const buildInfo = {
      schema: PORTABLE_SCHEMA,
      tool: PORTABLE_TOOL,
      name: pkg.name,
      productName: "Yakusha",
      version: pkg.version,
      platform: "win32",
      arch: "x64",
      electron: electronVersion,
      builtAt: now.toISOString(),
      executable: "Yakusha.exe",
      signed: false,
      payloadFileCount: payloadFiles.length,
      payloadBytes: totalBytes(temporary, payloadFiles),
      native: {
        schema: nativeManifest.schema,
        files: nativeManifest.files,
      },
    };
    fs.writeFileSync(path.join(temporary, BUILD_INFO_FILE), JSON.stringify(buildInfo, null, 2) + "\n", "utf8");
    const fileCount = writeSums(temporary);

    if (fs.existsSync(destination) && fs.readdirSync(destination).length === 0) fs.rmdirSync(destination);
    if (fs.existsSync(destination)) {
      throw new PortableError("E_EXISTS", "output directory appeared while building; refusing to overwrite: " + destination);
    }
    fs.renameSync(temporary, destination);
    return { outDir: destination, buildInfo, fileCount, totalBytes: totalBytes(destination, walkFiles(destination).filter((rel) => rel !== SUMS_FILE)) };
  } catch (error) {
    fs.rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Verify a built bundle against SHA256SUMS and its manifest.
 *
 * @param {string} dir portable bundle directory
 * @returns {{ok: true, fileCount: number, buildInfo: object}}
 */
export function verifyPortable(dir) {
  requireDir(dir, "portable bundle");
  const info = readJson(path.join(dir, BUILD_INFO_FILE));
  if (info.schema !== PORTABLE_SCHEMA || info.tool !== PORTABLE_TOOL) {
    throw new PortableError("E_VERIFY", "not a portable bundle: " + dir);
  }
  requireFile(path.join(dir, info.executable || "Yakusha.exe"), "portable executable");
  const appPkg = readJson(path.join(dir, APP_PACKAGE_FILE));
  if (appPkg.main !== "gui/main.js" || appPkg.type !== "module") {
    throw new PortableError("E_VERIFY", "resources/app/package.json is not the Yakusha GUI entry");
  }
  if (appPkg.version !== info.version) {
    throw new PortableError("E_VERIFY", "resources/app/package.json version does not match build-info.json");
  }

  const sumsFile = path.join(dir, SUMS_FILE);
  requireFile(sumsFile, "checksum file");
  const expected = new Map();
  for (const line of fs.readFileSync(sumsFile, "utf8").split(/\r?\n/)) {
    if (!line) continue;
    const match = /^([0-9a-f]{64})  (.+)$/.exec(line);
    if (!match) throw new PortableError("E_VERIFY", "malformed checksum line: " + line);
    const rel = match[2];
    if (rel.startsWith("/") || rel.includes("\\") || rel.split("/").includes("..")) {
      throw new PortableError("E_VERIFY", "unsafe checksum path: " + rel);
    }
    if (expected.has(rel)) throw new PortableError("E_VERIFY", "duplicate checksum path: " + rel);
    expected.set(rel, match[1]);
  }

  const actualFiles = walkFiles(dir).filter((rel) => rel !== SUMS_FILE);
  for (const rel of actualFiles) {
    if (!expected.has(rel)) throw new PortableError("E_VERIFY", "file is not listed in SHA256SUMS: " + rel);
  }
  for (const [rel, digest] of expected) {
    const file = path.join(dir, rel);
    if (!fs.existsSync(file)) throw new PortableError("E_VERIFY", "file is missing: " + rel);
    const actual = sha256File(file);
    if (actual !== digest) throw new PortableError("E_VERIFY", "checksum mismatch: " + rel);
  }
  return { ok: true, fileCount: actualFiles.length, buildInfo: info };
}

export const DEFAULT_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
