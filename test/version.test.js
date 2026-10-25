/**
 * Version is single-sourced from package.json (docs/engines.md §11).
 *
 * The plugin template is rendered by installPlugin and is checked by the engine
 * contract test; here we pin the package file and the CLI surface to each other.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { VERSION } from "../src/version.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const BIN = path.join(ROOT, "bin", "yakusha.js");
const PACKAGE_FILE = path.join(ROOT, "package.json");

/** @returns {string} */
function packageVersion() {
  return JSON.parse(fs.readFileSync(PACKAGE_FILE, "utf8")).version;
}

/** @returns {{ code: number, stdout: string, stderr: string }} */
function run(args) {
  const result = spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8" });
  return { code: result.status, stdout: result.stdout || "", stderr: result.stderr || "" };
}

test("version: package.json is the single source", () => {
  assert.match(packageVersion(), /^\d+\.\d+\.\d+$/);
  assert.equal(VERSION, packageVersion());
});

test("version: --version prints the package version and exits 0", () => {
  const expected = "yakusha " + packageVersion() + "\n";
  for (const args of [["--version"], ["--version", "--json"], ["--json", "--version"]]) {
    const result = run(args);
    assert.equal(result.code, 0, args.join(" "));
    // Never enveloped, even in JSON mode.
    assert.equal(result.stdout, expected, args.join(" "));
    assert.equal(result.stderr, "");
  }
});

test("version: --version wins over a command", () => {
  const expected = "yakusha " + packageVersion() + "\n";
  for (const args of [
    ["scan", "--version"],
    ["scan", "somewhere", "--version"],
    ["translate", "--provider", "mock", "--version"],
  ]) {
    const result = run(args);
    assert.equal(result.code, 0, args.join(" "));
    assert.equal(result.stdout, expected, args.join(" "));
  }
});

test("version: --version wins over a bad option", () => {
  const expected = "yakusha " + packageVersion() + "\n";
  for (const args of [
    ["scan", "--bogus", "--version"],
    ["--version", "--bogus"],
    ["scan", "--limit", "--version"],
  ]) {
    const result = run(args);
    assert.equal(result.code, 0, args.join(" "));
    assert.equal(result.stdout, expected, args.join(" "));
  }
});
