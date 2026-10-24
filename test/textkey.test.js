import { test } from "node:test";
import assert from "node:assert/strict";

import {
  tokenize,
  controlCodes,
  hasControlCodes,
  mask,
  unmask,
  normalize,
  stripCodes,
  sameControlCodes,
  splitLines,
  visibleLength,
} from "../src/core/textkey.js";

test("tokenize splits text and escape codes", () => {
  const tokens = tokenize(String.raw`a\C[6]b\V[12]c\G`);
  assert.deepEqual(tokens, [
    { t: "text", v: "a" },
    { t: "code", v: "\\C[6]" },
    { t: "text", v: "b" },
    { t: "code", v: "\\V[12]" },
    { t: "text", v: "c" },
    { t: "code", v: "\\G" },
  ]);
});

test("tokenize handles single character codes and escaped backslash", () => {
  assert.deepEqual(controlCodes(String.raw`\{\}\>\<\^\!\|\$\..`), [
    "\\{",
    "\\}",
    "\\>",
    "\\<",
    "\\^",
    "\\!",
    "\\|",
    "\\$",
    "\\.",
  ]);
  assert.deepEqual(controlCodes(String.raw`a\\b`), ["\\\\"]);
});

test("tokenize mirrors obtainEscapeCode for a bare letter code", () => {
  // rmmz_windows.js obtainEscapeCode matches /^[A-Z]+/i, so a backslash before
  // letters swallows them: \b is an (unknown, harmless) escape code, not text.
  assert.deepEqual(controlCodes(String.raw`a\b`), [String.raw`\b`]);
  assert.equal(stripCodes(String.raw`a\b`), "a");
  // A backslash before punctuation that is not a code keeps the character.
  assert.equal(stripCodes(String.raw`a\%b`), "a%b");
});

test("controlCodes collects codes in order", () => {
  assert.deepEqual(controlCodes("plain"), []);
  assert.deepEqual(controlCodes(String.raw`\c[2]x\c[0]`), ["\\c[2]", "\\c[0]"]);
  assert.equal(hasControlCodes(String.raw`\C[1]`), true);
  assert.equal(hasControlCodes("no codes"), false);
});

test("mask and unmask round trip", () => {
  const source = String.raw`本当に\C[2]無い\C[0]のか？`;
  const { masked, tokens } = mask(source);
  assert.ok(!masked.includes("\\"));
  assert.equal(masked.includes("⟦0⟧"), true);
  assert.equal(unmask(masked, tokens), source);
});

test("unmask leaves unknown placeholders alone", () => {
  assert.equal(unmask("a⟦9⟧b", ["x"]), "a⟦9⟧b");
});

test("normalize keeps codes, folds width and whitespace", () => {
  assert.equal(normalize("  ＡＢＣ   あ  "), "ABC あ");
  assert.equal(normalize("a\u3000b"), "a b");
  assert.equal(normalize(String.raw`x\C[6]y`), String.raw`x\C[6]y`);
});

test("stripCodes removes codes only", () => {
  assert.equal(stripCodes(String.raw`お金\C[2]が無い`), "お金が無い");
  assert.equal(visibleLength(String.raw`お金\C[2]が無い`), 5);
});

test("sameControlCodes compares the sequence", () => {
  assert.equal(sameControlCodes(String.raw`a\C[1]b`, "译文" + String.raw`\C[1]` + "文"), true);
  assert.equal(sameControlCodes(String.raw`a\C[1]`, String.raw`a\C[2]`), false);
  assert.equal(sameControlCodes(String.raw`a\C[1]`, "a"), false);
  assert.equal(sameControlCodes("plain", "译文"), true);
});

test("splitLines keeps empty lines", () => {
  assert.deepEqual(splitLines("a\nb\n"), ["a", "b", ""]);
});
