#!/usr/bin/env node
/**
 * Apply a hand written example file to a game dictionary.
 *
 * Example files look like { "entries": { "<source>": "<translation>" } } and
 * live in examples/. Every pair is validated exactly like a model reply, so a
 * hand edited entry can never be worse than a generated one.
 *
 *   node tools/apply-examples.mjs <game-dir> examples/demo-glossary-zh.json [...]
 */
import fs from "node:fs";
import path from "node:path";
import { loadDictionary, saveDictionary, dictionaryPath, stats } from "../src/core/dict.js";
import { validateTranslation } from "../src/pipeline/translate.js";

const [dir, ...files] = process.argv.slice(2);
if (!dir || files.length === 0) {
  console.error("usage: node tools/apply-examples.mjs <game-dir> <example.json> [...]");
  process.exit(2);
}

const dictFile = dictionaryPath(dir);
if (!fs.existsSync(dictFile)) {
  console.error("no dictionary at " + dictFile + ", run: yakusha extract \"" + dir + "\"");
  process.exit(1);
}
const dictionary = loadDictionary(dictFile);

let applied = 0;
const missing = [];
const rejected = [];
for (const file of files) {
  const example = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
  const entries = example.entries || example;
  for (const [source, target] of Object.entries(entries)) {
    if (typeof target !== "string" || target.length === 0) continue;
    const entry = dictionary.entries[source];
    if (!entry) {
      missing.push(source);
      continue;
    }
    const verdict = validateTranslation(source, target, { strictCodes: true });
    if (!verdict.ok) {
      rejected.push({ source, reason: verdict.reason });
      continue;
    }
    entry.text = target;
    delete entry.error;
    applied += 1;
  }
}

if (applied > 0) saveDictionary(dictFile, dictionary);
console.log(JSON.stringify({ applied, missing, rejected, stats: stats(dictionary) }, null, 2));
