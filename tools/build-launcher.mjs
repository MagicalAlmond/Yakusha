#!/usr/bin/env node
/**
 * Build the native portable launcher.
 *
 * The portable bundle uses a small C launcher instead of renaming
 * electron.exe directly: on some Windows builds Chromium's sandbox child
 * processes exit with STATUS_BREAKPOINT before the GUI appears.  The launcher
 * tries the normal sandbox first and only retries with --no-sandbox for the
 * known crash statuses.  See tools/launcher/launcher.c.
 *
 * Usage:
 *   node tools/build-launcher.mjs
 *   node tools/build-launcher.mjs --llvm-mingw <path-to-llvm-mingw>
 *   YAKUSHA_LLVM_MINGW=... node tools/build-launcher.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readPeSubsystem, PE_SUBSYSTEM_WINDOWS_GUI } from "./portable-lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const SOURCE = path.join(HERE, "launcher", "launcher.c");
const DEFAULT_OUT = path.join(HERE, "launcher", "prebuilt", "yakusha-launcher.exe");

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : null;
}

function findLlvmMingw() {
  const requested = arg("--llvm-mingw") || process.env.YAKUSHA_LLVM_MINGW || null;
  if (requested) {
    const bin = path.join(requested, "bin");
    if (fs.existsSync(path.join(bin, "x86_64-w64-mingw32-clang.exe"))) return path.resolve(requested);
    throw new Error("llvm-mingw not found at " + requested + " (missing bin/x86_64-w64-mingw32-clang.exe)");
  }
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    if (dir && fs.existsSync(path.join(dir, "x86_64-w64-mingw32-clang.exe"))) {
      return path.resolve(dir, "..");
    }
  }
  throw new Error("llvm-mingw not found; pass --llvm-mingw <dir> or set YAKUSHA_LLVM_MINGW");
}

const llvm = findLlvmMingw();
const compiler = path.join(llvm, "bin", "x86_64-w64-mingw32-clang.exe");
const out = path.resolve(arg("--out") || DEFAULT_OUT);
fs.mkdirSync(path.dirname(out), { recursive: true });
const result = spawnSync(compiler, ["-O2", "-mwindows", SOURCE, "-o", out], { stdio: "inherit" });
if (result.status !== 0) {
  console.error("launcher build failed: " + compiler + " exited " + result.status);
  process.exit(1);
}
if (!fs.existsSync(out)) {
  console.error("launcher build produced no file: " + out);
  process.exit(1);
}
const subsystem = readPeSubsystem(out);
if (subsystem !== PE_SUBSYSTEM_WINDOWS_GUI) {
  console.error("launcher is not a Windows GUI program (PE subsystem " + subsystem + ")");
  process.exit(1);
}
const digest = createHash("sha256").update(fs.readFileSync(out)).digest("hex");
console.log("built " + out);
console.log("  " + fs.statSync(out).size + " bytes, PE subsystem " + subsystem + ", sha256 " + digest);
