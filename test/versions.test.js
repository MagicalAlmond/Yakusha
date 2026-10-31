import { test } from "node:test";
import assert from "node:assert/strict";

import { getAdapters } from "../src/engines/registry.js";
import { checkVersion, compareVersions, describeVersionSpec, parseVersion } from "../src/core/versions.js";

const MZ = { kind: "range", min: "1.3.2", max: "1.9.0", tested: ["1.3.2", "1.9.0"] };
const RGSS = { kind: "values", values: ["1", "2", "3"], tested: ["3"] };

test("parseVersion accepts dotted numbers and rejects decorated strings", () => {
  assert.deepEqual(parseVersion("1.7.0"), [1, 7, 0]);
  assert.deepEqual(parseVersion(" 1.7 "), [1, 7]);
  assert.equal(parseVersion("v1.7.0"), null);
  assert.equal(parseVersion("1.7-beta"), null);
  assert.equal(parseVersion(null), null);
});

test("compareVersions compares numerically and pads missing components", () => {
  assert.equal(compareVersions("1.7.0", "1.10.0"), -1);
  assert.equal(compareVersions("1.7", "1.7.0"), 0);
  assert.equal(compareVersions("2.0", "1.9.9"), 1);
  assert.equal(compareVersions("nope", "1.0"), null);
});

test("checkVersion stays quiet for a covered range and reports both edges", () => {
  assert.equal(checkVersion("1.7.0", MZ), null);
  assert.equal(checkVersion("1.3.2", MZ), null);
  assert.equal(checkVersion("1.9.0", MZ), null);
  const old = checkVersion("1.2.0", MZ);
  assert.equal(old.level, "warn");
  assert.match(old.message, /outside the supported range/);
  const future = checkVersion("1.10.0", MZ);
  assert.equal(future.level, "warn");
});

test("checkVersion reports an unknown or unreadable engine version as info", () => {
  const missing = checkVersion(null, MZ);
  assert.equal(missing.level, "info");
  assert.match(missing.message, /could not be determined/);
  const garbage = checkVersion("unknown", MZ);
  assert.equal(garbage.level, "info");
  assert.match(garbage.message, /not a recognised version number/);
});

test("checkVersion handles value matrices and supported-but-untested builds", () => {
  assert.equal(checkVersion("3", RGSS), null);
  const untested = checkVersion("2", RGSS);
  assert.equal(untested.level, "info");
  assert.match(untested.message, /supported but has not been tested/);
  const unsupported = checkVersion("4", RGSS);
  assert.equal(unsupported.level, "warn");
  assert.match(unsupported.message, /not supported/);
});

test("checkVersion skips engines that do not record a runtime version", () => {
  assert.equal(checkVersion("1.0.0", { kind: "none", reason: "not recorded" }), null);
  assert.equal(checkVersion("1.0.0", null), null);
});

test("describeVersionSpec explains ranges and value sets", () => {
  assert.equal(describeVersionSpec(MZ), "1.3.2 - 1.9.0 (tested 1.3.2, 1.9.0)");
  assert.equal(describeVersionSpec(RGSS), "one of 1, 2, 3 (tested 3)");
  assert.equal(describeVersionSpec({ kind: "none", reason: "not recorded" }), "not recorded");
});

test("every adapter declares its version matrix", () => {
  const kinds = Object.fromEntries(getAdapters().map((adapter) => [adapter.id, adapter.versions && adapter.versions.kind]));
  assert.deepEqual(kinds, { mz: "range", mv: "range", renpy: "none", rgss: "values", krkr: "none" });
});

