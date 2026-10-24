import test from "node:test";
import assert from "node:assert/strict";

import { emptyDictionary } from "../src/core/dict.js";
import { translateDictionary } from "../src/pipeline/translate.js";
import { displayColumns } from "../src/pipeline/wrap.js";

function dictOf(entries) {
  const d = emptyDictionary("test");
  for (const [key, text] of Object.entries(entries)) d.entries[key] = { text, contexts: [] };
  return d;
}

const neverProvider = {
  name: "never",
  complete: async () => {
    assert.fail("no request expected");
  },
};

test("translate: rewrapExisting re-fits already translated entries", async () => {
  const wide = "中".repeat(40);
  const d = dictOf({ "あ": wide, "い": "短" });
  const result = await translateDictionary(d, {
    provider: neverProvider,
    maxColumns: 10,
    rewrapExisting: true,
  });
  assert.equal(result.rewrapped, 1);
  for (const line of d.entries["あ"].text.split("\n")) assert.ok(displayColumns(line) <= 10);
  assert.equal(d.entries["い"].text, "短");
});

test("translate: rewrapExisting is off unless asked for", async () => {
  const wide = "中".repeat(40);
  const d = dictOf({ "あ": wide });
  const result = await translateDictionary(d, { provider: neverProvider, maxColumns: 10 });
  assert.equal(result.rewrapped, 0);
  assert.equal(d.entries["あ"].text, wide);
});

test("translate: rewrapExisting does nothing without a width", async () => {
  const wide = "中".repeat(40);
  const d = dictOf({ "あ": wide });
  const result = await translateDictionary(d, { provider: neverProvider, rewrapExisting: true });
  assert.equal(result.rewrapped, 0);
  assert.equal(d.entries["あ"].text, wide);
});

test("translate: re-wrapping twice changes nothing the second time", async () => {
  const d = dictOf({ "あ": "中".repeat(40) });
  const options = { provider: neverProvider, maxColumns: 10, rewrapExisting: true };
  await translateDictionary(d, options);
  const once = d.entries["あ"].text;
  const second = await translateDictionary(d, options);
  assert.equal(second.rewrapped, 0);
  assert.equal(d.entries["あ"].text, once);
});
