#!/usr/bin/env node
/**
 * Build (or verify) the portable Windows bundle.
 *
 * Usage:
 *   node tools/portable.mjs
 *   node tools/portable.mjs --out dist/my-build
 *   node tools/portable.mjs --force
 *   node tools/portable.mjs --verify dist/yakusha-0.79.0-win-x64
 *
 * The default Electron distribution is node_modules/electron/dist (a dev
 * dependency); the default native components are native/prebuilt. Both are
 * read-only inputs. The output directory is the deliverable: copy it to a
 * release page or double-click Yakusha.exe inside it.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  BUILD_INFO_FILE,
  DEFAULT_ROOT,
  PortableError,
  buildPortable,
  readJson,
  verifyPortable,
} from "./portable-lib.mjs";

function usage() {
  return [
    "usage: node tools/portable.mjs [options]",
    "",
    "Build a portable Windows x64 bundle.",
    "",
    "Options:",
    "  --out <dir>          output directory (default: dist/yakusha-<version>-win-x64)",
    "  --electron-dir <dir> unpacked Electron distribution (default: node_modules/electron/dist)",
    "  --native-dir <dir>   native components with manifest.json (default: native/prebuilt)",
    "  --force              replace a previous portable build in --out",
    "  --verify <dir>       verify an existing bundle and exit",
    "  --json               print one JSON document",
    "  --help, -h           show this help",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    out: null,
    electronDir: null,
    nativeDir: null,
    force: false,
    verify: null,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out") {
      options.out = argv[++index];
      if (!options.out) throw new PortableError("E_USAGE", "--out requires a directory");
    } else if (arg === "--electron-dir") {
      options.electronDir = argv[++index];
      if (!options.electronDir) throw new PortableError("E_USAGE", "--electron-dir requires a directory");
    } else if (arg === "--native-dir") {
      options.nativeDir = argv[++index];
      if (!options.nativeDir) throw new PortableError("E_USAGE", "--native-dir requires a directory");
    } else if (arg === "--verify") {
      options.verify = argv[++index];
      if (!options.verify) throw new PortableError("E_USAGE", "--verify requires a directory");
    } else if (arg === "--force") {
      options.force = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new PortableError("E_USAGE", "unknown argument: " + arg);
    }
  }
  return options;
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KiB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MiB";
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const root = DEFAULT_ROOT;
  if (options.verify) {
    const result = verifyPortable(path.resolve(options.verify));
    if (options.json) {
      console.log(JSON.stringify({ schema: 1, command: "portable", ok: true, verify: result }, null, 2));
    } else {
      console.log("verified " + path.resolve(options.verify) + " (" + result.fileCount + " files, Yakusha " + result.buildInfo.version + ", Electron " + result.buildInfo.electron + ")");
    }
    return;
  }

  const pkg = readJson(path.join(root, "package.json"));
  const outDir = path.resolve(options.out || path.join(root, "dist", "yakusha-" + pkg.version + "-win-x64"));
  const electronDir = path.resolve(options.electronDir || path.join(root, "node_modules", "electron", "dist"));
  const nativeDir = path.resolve(options.nativeDir || path.join(root, "native", "prebuilt"));
  if (!fs.existsSync(electronDir)) {
    throw new PortableError("E_IO", "Electron distribution is missing: " + electronDir + " (run pnpm install first)");
  }

  const result = buildPortable({
    root,
    electronDir,
    nativeDir,
    outDir,
    force: options.force,
  });
  if (options.json) {
    console.log(JSON.stringify({
      schema: 1,
      command: "portable",
      ok: true,
      outDir: result.outDir,
      fileCount: result.fileCount,
      totalBytes: result.totalBytes,
      buildInfo: result.buildInfo,
    }, null, 2));
    return;
  }
  console.log("built " + result.outDir);
  console.log("  Yakusha " + result.buildInfo.version + " / Electron " + result.buildInfo.electron + " / win32 x64");
  console.log("  " + result.fileCount + " files, " + formatBytes(result.totalBytes) + ", unsigned");
  console.log("  " + BUILD_INFO_FILE + " + SHA256SUMS written; run with --verify to re-check");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const code = error instanceof PortableError ? error.code : "E_INTERNAL";
    console.error(code + ": " + String(error && error.message ? error.message : error));
    process.exitCode = error instanceof PortableError ? error.exitCode : 1;
  });
}
