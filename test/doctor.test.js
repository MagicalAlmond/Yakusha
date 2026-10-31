import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { openProject } from "../src/core/mzproject.js";
import { extractProject } from "../src/core/extract.js";
import { emptyDictionary, saveDictionary } from "../src/core/dict.js";
import { installPlugin, renderPlugin, PLUGIN_NAME } from "../src/core/install.js";
import { parsePluginsJs, serialisePluginsJs, pluginsJsLayout } from "../src/core/pluginsfile.js";
import { detectEmbeddedTranslations, runtimeLookup, diagnose } from "../src/core/doctor.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, "fixtures", "mini-mz");

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-doctor-"));
  fs.cpSync(FIXTURE, path.join(dir, "game"), { recursive: true });
  return path.join(dir, "game");
}

/** A dictionary holding exactly the keys the game currently has. */
function dictionaryFor(project) {
  const extracted = extractProject(project.root);
  const dictionary = emptyDictionary(project.gameTitle);
  for (const [key, entry] of extracted.entries) {
    dictionary.entries[key] = { text: "", contexts: [...entry.contexts].sort() };
  }
  return dictionary;
}

function dropOurEntry(project) {
  const text = fs.readFileSync(project.pluginsFile, "utf8");
  const plugins = parsePluginsJs(text).plugins.filter((plugin) => !plugin || plugin.name !== PLUGIN_NAME);
  fs.writeFileSync(project.pluginsFile, serialisePluginsJs(plugins, pluginsJsLayout(text)), "utf8");
}

function levels(result) {
  return Object.fromEntries(result.checks.map((check) => [check.id, check.level]));
}

test("detectEmbeddedTranslations reads the rendered blob", () => {
  assert.deepEqual(detectEmbeddedTranslations(renderPlugin()), { embedded: false, entries: 0 });
  assert.deepEqual(detectEmbeddedTranslations(renderPlugin({ embed: { a: "b", c: "d" } })), { embedded: true, entries: 2 });
});

test("detectEmbeddedTranslations treats a truncated blob as absent", () => {
  const source = renderPlugin({ embed: { a: "b" } }).replace('"b"}', '"b"');
  assert.equal(detectEmbeddedTranslations(source).embedded, false);
});

test("runtimeLookup finds the dictionary at the root or in a deployed www/", () => {
  const root = sandbox();
  assert.equal(runtimeLookup(root, "yakusha/dictionary.json").found, null);
  fs.mkdirSync(path.join(root, "yakusha"), { recursive: true });
  fs.writeFileSync(path.join(root, "yakusha", "dictionary.json"), "{}");
  assert.equal(runtimeLookup(root, "yakusha/dictionary.json").found, path.join(root, "yakusha", "dictionary.json"));

  fs.rmSync(path.join(root, "yakusha"), { recursive: true });
  fs.mkdirSync(path.join(root, "www", "yakusha"), { recursive: true });
  fs.writeFileSync(path.join(root, "www", "yakusha", "dictionary.json"), "{}");
  const deployed = runtimeLookup(root, "yakusha/dictionary.json");
  assert.equal(deployed.found, path.join(root, "www", "yakusha", "dictionary.json"));
  assert.equal(deployed.candidates.length, 2);
});

test("diagnose fails when the dictionary is missing", () => {
  const project = openProject(sandbox());
  const result = diagnose(project, {});
  assert.equal(result.ok, false);
  assert.equal(result.verdict, "broken");
  assert.equal(levels(result).dictionary, "fail");
  assert.equal(levels(result).install, "info");
  assert.equal(result.verdict === "broken", true);
  assert.match(result.failure, /no dictionary/);
  assert.deepEqual(result.checks.map((c) => c.id).slice(0, 5), ["engine", "dictionary", "install", "runtime"]);
});

test("diagnose passes every structural check on a healthy install", () => {
  const project = openProject(sandbox());
  const dictionary = dictionaryFor(project);
  saveDictionary(path.join(project.root, "yakusha", "dictionary.json"), dictionary);
  installPlugin(project);

  const result = diagnose(project, { dictionary, dictionaryFile: path.join(project.root, "yakusha", "dictionary.json") });
  const byId = levels(result);
  assert.equal(byId.install, "ok");
  assert.equal(byId.backup, "ok");
  assert.equal(byId.runtime, "ok");
  assert.equal(byId.sync, "ok");
  assert.equal(byId.dictionary, "ok");
  // every entry is still pending, so the verdict may not claim "ready"
  assert.equal(byId.progress, "warn");
  assert.equal(result.verdict, "usable");
  assert.equal(result.ok, true);
});

test("diagnose reports embedded translations that went stale", () => {
  const project = openProject(sandbox());
  const dictionary = dictionaryFor(project);
  for (const [key, entry] of Object.entries(dictionary.entries)) entry.text = "T:" + key;
  const embed = Object.fromEntries(Object.entries(dictionary.entries).map(([key, entry]) => [key, entry.text]));
  const dictionaryFile = path.join(project.root, "yakusha", "dictionary.json");
  saveDictionary(dictionaryFile, dictionary);
  installPlugin(project, { embed });

  const installed = diagnose(project, { dictionary, dictionaryFile });
  assert.equal(levels(installed).install, "ok");
  assert.equal(levels(installed).runtime, "ok");

  const changed = JSON.parse(fs.readFileSync(dictionaryFile, "utf8"));
  const first = Object.keys(changed.entries)[0];
  changed.entries[first].text = "T:changed";
  fs.writeFileSync(dictionaryFile, JSON.stringify(changed, null, 2) + "\n", "utf8");
  const edited = JSON.parse(fs.readFileSync(dictionaryFile, "utf8"));

  const stale = diagnose(project, { dictionary: edited, dictionaryFile });
  assert.equal(stale.ok, true);
  assert.equal(stale.verdict, "usable");
  assert.equal(levels(stale).install, "warn");
  assert.equal(levels(stale).runtime, "warn");
  const installCheck = stale.checks.find((check) => check.id === "install");
  assert.match(installCheck.message, /is out of date: the project dictionary has changed since install/);
  assert.match(installCheck.message, /install --embed/);
  const runtimeCheck = stale.checks.find((check) => check.id === "runtime");
  assert.match(runtimeCheck.message, /keeps using the translations compiled at install time/);

  const repairedEmbed = Object.fromEntries(Object.entries(edited.entries).map(([key, entry]) => [key, entry.text]));
  installPlugin(project, { embed: repairedEmbed });
  const repaired = diagnose(project, { dictionary: edited, dictionaryFile });
  assert.equal(levels(repaired).install, "ok");
  assert.equal(levels(repaired).runtime, "ok");
});

test("diagnose reports a game update that dropped the plugins.js entry", () => {
  const project = openProject(sandbox());
  const dictionary = dictionaryFor(project);
  installPlugin(project);
  dropOurEntry(project);

  const result = diagnose(project, { dictionary });
  assert.equal(result.ok, false);
  assert.equal(result.verdict, "broken");
  assert.equal(levels(result).install, "fail");
  assert.match(result.failure, /entry is gone/);
});

test("diagnose reports a damaged plugins.js instead of throwing", () => {
  const project = openProject(sandbox());
  fs.writeFileSync(project.pluginsFile, 'var $plugins = [{"name":', "utf8");
  const result = diagnose(project, {});
  assert.equal(result.verdict, "broken");
  assert.equal(levels(result)["plugins.js"], "fail");
  assert.equal(result.install.entryPresent, false);
  assert.equal(Object.hasOwn(levels(result), "backup"), false);
});
