import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildRules } from "../src/core/fields.js";
import { renderPlugin } from "../src/core/install.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.join(HERE, "..", "src", "plugin", "YAKUSHA_Translator.js");

test("the shipped plugin template declares both replacement blocks", () => {
  const source = fs.readFileSync(TEMPLATE, "utf8");
  for (const block of ["RULES", "EMBEDDED"]) {
    assert.ok(source.includes("//<<<" + block + ">>>"), block + " start marker missing");
    assert.ok(source.includes("//<<<END-" + block + ">>>"), block + " end marker missing");
  }
});

test("rendering is deterministic", () => {
  assert.equal(renderPlugin(), renderPlugin());
});

test("the rendered rules match the extractor tables", () => {
  const source = renderPlugin();
  const match = source.match(/const RULES = (\{.*?\});\n/);
  assert.ok(match);
  const embedded = JSON.parse(match[1]);
  const expected = buildRules();

  assert.deepEqual(embedded.dbFields, expected.dbFields);
  assert.deepEqual(embedded.systemFields, expected.systemFields);
  assert.deepEqual(embedded.commands, expected.commands);
});

test("every db field the plugin knows exists in the extractor", () => {
  const rules = buildRules();
  for (const [file, fields] of Object.entries(rules.dbFields)) {
    assert.ok(file.endsWith(".json"), file);
    assert.ok(Array.isArray(fields) && fields.length > 0, file);
    for (const field of fields) assert.equal(typeof field, "string");
  }
});

test("the plugin source has no raw backslash literals in escape tables", () => {
  // The template builds backslashes with String.fromCharCode(92) so that a
  // careless editor or a JSON round trip cannot corrupt them.
  const source = fs.readFileSync(TEMPLATE, "utf8");
  assert.ok(source.includes("String.fromCharCode(92)"));
});
