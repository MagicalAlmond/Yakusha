/**
 * Build the RGSS native components.
 *
 * The repository keeps the Rust sources and this script; the binaries are
 * produced here and shipped inside the npm package from `native/prebuilt/`
 * (and built on CI). Two crates are built for the 32-bit GNU/LLVM Windows
 * target, because every RGSS runtime is a 32-bit process:
 *
 *   native/rgss-hook    -> yakusha_rgss_hook.dll
 *   native/injector     -> yakusha_injector.exe
 *
 * `libunwind.dll` comes from the llvm-mingw toolchain and is copied next to
 * both binaries: the gnullvm target links against it dynamically. The file is
 * part of the distribution and keeps its own license (LLVM's Apache-2.0 with
 * LLVM exceptions / the MinGW-w64 runtime license).
 *
 * Usage:
 *   node native/build.mjs
 *   node native/build.mjs --llvm-mingw <path-to-llvm-mingw>
 *   YAKUSHA_LLVM_MINGW=... node native/build.mjs
 *
 * The environment must contain cargo (rustup stable) with the
 * i686-pc-windows-gnullvm target installed:
 *   rustup target add i686-pc-windows-gnullvm
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const target = "i686-pc-windows-gnullvm";

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : null;
}

function findLlvmMingw() {
  const requested = arg("--llvm-mingw") || process.env.YAKUSHA_LLVM_MINGW || null;
  if (requested) {
    const bin = path.join(requested, "bin");
    if (!fs.existsSync(path.join(bin, "i686-w64-mingw32-clang.exe"))) {
      throw new Error("llvm-mingw not found at " + requested + " (missing bin/i686-w64-mingw32-clang.exe)");
    }
    return path.resolve(requested);
  }
  // Fall back to PATH: `i686-w64-mingw32-clang.exe` is the linker cargo needs.
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    if (dir && fs.existsSync(path.join(dir, "i686-w64-mingw32-clang.exe"))) {
      return path.resolve(dir, "..");
    }
  }
  throw new Error("llvm-mingw not found; pass --llvm-mingw <dir> or set YAKUSHA_LLVM_MINGW");
}

function run(command, args, options) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.status !== 0) throw new Error(command + " " + args.join(" ") + " failed with exit code " + result.status);
}

function hash(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

const llvm = findLlvmMingw();
const bin = path.join(llvm, "bin");
const env = {
  ...process.env,
  PATH: bin + ";" + (process.env.PATH || ""),
  CARGO_TARGET_I686_PC_WINDOWS_GNULLVM_LINKER: path.join(bin, "i686-w64-mingw32-clang.exe"),
};

const crates = [
  { dir: path.join(here, "rgss-hook"), artifact: "yakusha_rgss_hook.dll" },
  { dir: path.join(here, "injector"), artifact: "yakusha_injector.exe" },
];

const out = path.join(here, "prebuilt");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

for (const crate of crates) {
  console.log("building " + path.basename(crate.dir) + " for " + target + "...");
  run("cargo", ["build", "--release", "--target", target], { cwd: crate.dir, env });
  const built = path.join(crate.dir, "target", target, "release", crate.artifact);
  if (!fs.existsSync(built)) throw new Error("cargo did not produce " + built);
  fs.copyFileSync(built, path.join(out, crate.artifact));
}

const unwind = path.join(bin, "..", "i686-w64-mingw32", "bin", "libunwind.dll");
if (!fs.existsSync(unwind)) throw new Error("libunwind.dll not found at " + unwind);
fs.copyFileSync(unwind, path.join(out, "libunwind.dll"));
fs.copyFileSync(path.join(here, "rgss-hook", "bootstrap.rb"), path.join(out, "bootstrap.rb"));

const names = ["yakusha_rgss_hook.dll", "libunwind.dll", "yakusha_injector.exe", "bootstrap.rb"];
const files = {};
for (const name of names) files[name] = hash(path.join(out, name));
fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify({ schema: 1, files }, null, 2) + "\n", "utf8");

console.log("wrote " + out);
for (const name of names) console.log("  " + name + "  " + files[name]);
