#!/usr/bin/env node
/**
 * yakusha command line interface.
 *
 * Commands
 *   scan       <game-dir>                 inspect a game, print what is translatable
 *   extract    <game-dir>                 write yakusha/dictionary.json with empty targets
 *   status     <game-dir>                 translation progress
 *   translate  <game-dir>                 fill the dictionary through an LLM
 *   verify     <game-dir>                 audit the dictionary for bad entries
 *   speaker    <game-dir>                 repair inline speaker names
 *   terms      <game-dir>                 mine name renderings, report drift
 *   install    <game-dir>                 copy the runtime plugin into the game
 *   uninstall  <game-dir>                 remove the plugin and restore plugins.js
 *
 * Every command prints machine readable JSON when --json is passed, and every
 * flag also accepts the --flag=value form.
 *
 * @module bin/yakusha
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { openProject, listDataFiles } from "../src/core/mzproject.js";
import { extractProject, toSortedArray } from "../src/core/extract.js";
import * as dict from "../src/core/dict.js";
import { stats as dictStats, translatedOnly } from "../src/core/dict.js";
import { installPlugin, uninstallPlugin, isInstalled } from "../src/core/install.js";
import { stripCodes } from "../src/core/textkey.js";
import { createProvider } from "../src/pipeline/provider.js";
import { translateDictionary } from "../src/pipeline/translate.js";
import { verifyDictionary } from "../src/pipeline/verify.js";
import { repairSpeakerNames } from "../src/pipeline/speaker.js";
import { mineTerms, toGlossary } from "../src/pipeline/terms.js";

/**
 * Split argv into flags and positionals. A flag consumes the next argument as
 * its value unless that argument looks like another flag.
 *
 * Flags listed in REPEATABLE collect every occurrence into an array instead of
 * overwriting, so "--context Map --context Items" means either one.
 *
 * @param {string[]} argv
 * @returns {{ flags: Record<string, string|boolean>, positional: string[] }}
 */
const REPEATABLE = new Set(["context"]);

function setFlag(flags, name, value) {
  if (!REPEATABLE.has(name)) {
    flags[name] = value;
    return;
  }
  const previous = flags[name];
  if (previous === undefined) flags[name] = [value];
  else if (Array.isArray(previous)) previous.push(value);
  else flags[name] = [previous, value];
}

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq >= 0) {
        setFlag(flags, arg.slice(2, eq), arg.slice(eq + 1));
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          setFlag(flags, arg.slice(2), next);
          i += 1;
        } else {
          setFlag(flags, arg.slice(2), true);
        }
      }
    } else if (arg === "-h") {
      flags.help = true;
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

const { flags, positional } = parseArgs(process.argv.slice(2));
const json = flags.json === true || flags.json === "true";

/** @param {string} message */
function fail(message, code = 1) {
  if (json) process.stdout.write(JSON.stringify({ ok: false, error: message }) + "\n");
  else process.stderr.write("error: " + message + "\n");
  process.exit(code);
}

/** Read a numeric flag, falling back when it is absent or not a number. */
function numberFlag(name, fallback) {
  const raw = flags[name];
  if (raw === undefined || raw === true) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Turn a (possibly repeated) --context value into the shape selectPending
 * expects: undefined when absent, a string for the single value case.
 */
function normalizeContexts(raw) {
  if (raw === undefined || raw === true) return undefined;
  const list = (Array.isArray(raw) ? raw : [raw]).filter((v) => typeof v === "string" && v.length > 0);
  if (list.length === 0) return undefined;
  return list.length === 1 ? list[0] : list;
}

/** @param {string} message */
function say(message) {
  if (!json) process.stdout.write(message + "\n");
}

/**
 * @param {string} dir
 */
function requireProject(dir) {
  if (!dir) fail("no game directory given\nusage: yakusha <command> <game-dir>");
  try {
    return openProject(dir);
  } catch (error) {
    fail(error.message);
    throw error;
  }
}

function requireDictionary(project) {
  const file = dict.dictionaryPath(project.root);
  if (!fs.existsSync(file)) fail("no dictionary yet, run: yakusha extract \"" + project.root + "\"");
  return { file, data: dict.loadDictionary(file) };
}

async function cmdScan(dir) {
  const project = requireProject(dir);
  const result = extractProject(project.root);
  const entries = toSortedArray(result);
  const withCodes = entries.filter((e) => stripCodes(e.text) !== e.text).length;
  const summary = {
    ok: true,
    root: project.root,
    engine: project.engine,
    version: project.version,
    gameTitle: project.gameTitle,
    dataFiles: listDataFiles(project).length,
    uniqueStrings: result.entries.size,
    totalStrings: result.totalStrings,
    stringsWithControlCodes: withCodes,
    encodings: result.encodings,
    undecodable: result.undecodable,
    perFile: result.perFile,
  };
  if (json) {
    process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
    return;
  }
  console.log("game      : " + (project.gameTitle || "(untitled)"));
  console.log("root      : " + project.root);
  console.log("engine    : " + project.engine + (project.version ? " " + project.version : ""));
  console.log("data files: " + summary.dataFiles);
  console.log("strings   : " + summary.uniqueStrings + " unique / " + summary.totalStrings + " total");
  console.log("w/ codes  : " + summary.stringsWithControlCodes);
  const encodings = Object.entries(summary.encodings || {});
  if (encodings.length > 1 || (encodings.length === 1 && encodings[0][0] !== "json")) {
    console.log("encodings : " + encodings.map(([k, v]) => k + " " + v).join(", "));
  }
  if (summary.undecodable && summary.undecodable.length > 0) {
    console.log("UNDECODED : " + summary.undecodable.join(", "));
  }
  const top = Object.entries(result.perFile)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  for (const [file, count] of top) console.log("  " + file.padEnd(24) + count);
}

async function cmdExtract(dir) {
  const project = requireProject(dir);
  const result = extractProject(project.root);
  const file = dict.dictionaryPath(project.root);
  let existing = null;
  if (fs.existsSync(file)) {
    try {
      existing = dict.loadDictionary(file);
    } catch {
      existing = null;
    }
  }
  const target = existing || dict.emptyDictionary(project.gameTitle);
  let added = 0;
  for (const entry of result.entries.values()) {
    const before = target.entries[entry.text];
    if (!before) {
      target.entries[entry.text] = { text: "", contexts: [...entry.contexts].sort() };
      added += 1;
    } else {
      for (const context of entry.contexts) {
        if (!before.contexts.includes(context)) before.contexts.push(context);
      }
    }
  }
  dict.saveDictionary(file, target);
  const s = dictStats(target);
  const summary = { ok: true, file, added, total: s.total, translated: s.translated, pending: s.pending };
  if (json) {
    process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
    return;
  }
  console.log("dictionary: " + file);
  console.log("added     : " + added);
  console.log("progress  : " + s.translated + "/" + s.total + " translated, " + s.pending + " pending");
}

async function cmdStatus(dir) {
  const project = requireProject(dir);
  const { file, data } = requireDictionary(project);
  const s = dictStats(data);
  const withError = Object.values(data.entries).filter((e) => e.error).length;
  const summary = { ok: true, file, ...s, withError };
  if (json) {
    process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
    return;
  }
  console.log("progress  : " + s.translated + "/" + s.total + " translated, " + s.pending + " pending");
  if (withError > 0) console.log("rejected  : " + withError + " (see the error field of those entries)");
}

async function cmdVerify(dir) {
  const project = requireProject(dir);
  const { file, data } = requireDictionary(project);
  const maxColumns = numberFlag("max-length", 0);
  const kinds = typeof flags.kind === "string" ? flags.kind.split(",").map((k) => k.trim()).filter(Boolean) : undefined;
  const result = verifyDictionary(data, { maxColumns, kinds });
  const shown = numberFlag("limit", 20);
  const summary = { ok: result.errors === 0, file, maxColumns, ...result, problems: undefined };
  if (json) {
    process.stdout.write(JSON.stringify({ ...summary, problems: result.problems }, null, 2) + "\n");
    return;
  }
  console.log("entries   : " + result.total + " (" + result.translated + " translated, " + result.pending + " pending)");
  if (result.rejected > 0) console.log("rejected  : " + result.rejected + " (see the error field of those entries)");
  if (result.problems.length === 0) {
    console.log("problems  : none");
    return;
  }
  const kindsSeen = Object.keys(result.counts).sort();
  console.log(
    "problems  : " +
      result.problems.length +
      " (" +
      kindsSeen.map((k) => k + " " + result.counts[k]).join(", ") +
      ")"
  );
  for (const problem of result.problems.slice(0, shown)) {
    console.log("  [" + problem.severity + "] " + problem.kind + " " + JSON.stringify(problem.key).slice(0, 58));
    console.log("        " + problem.detail);
  }
  if (result.problems.length > shown) {
    console.log("  ... " + (result.problems.length - shown) + " more, raise --limit or pass --json");
  }
  console.log(result.errors > 0 ? "result    : FAILED, " + result.errors + " error(s)" : "result    : OK with " + result.warnings + " warning(s)");
}

/**
 * Repair inline speaker names.
 *
 * verify can only report these: a name is wrong in relation to how the rest of
 * the same dictionary renders it, so the fix is "use the rendering this game
 * already uses", not a new translation. That is mechanical, and doing it by hand
 * on 400 entries is not realistic.
 */
async function cmdSpeaker(dir) {
  const project = requireProject(dir);
  const { file, data } = requireDictionary(project);
  const includeDrift = flags["include-drift"] === true;
  const dryRun = flags["dry-run"] === true;
  const shown = numberFlag("limit", 20);
  let names;
  if (typeof flags.names === "string") {
    const namesFile = path.resolve(flags.names);
    if (!fs.existsSync(namesFile)) fail("names file not found: " + namesFile);
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(namesFile, "utf8"));
    } catch (error) {
      fail("names file is not valid JSON: " + namesFile + " (" + error.message + ")");
    }
    names = parsed && typeof parsed === "object" ? parsed.entries || parsed : null;
    if (!names || typeof names !== "object") fail("names file must be a JSON map of source name -> Chinese name");
  }
  const before = verifyDictionary(data, { kinds: ["speaker"] });
  const result = repairSpeakerNames(data, { includeDrift, names });
  const after = verifyDictionary(data, { kinds: ["speaker"] });
  const saved = result.entries > 0 && !dryRun;
  if (saved) dict.saveDictionary(file, data);
  const summary = {
    ok: true,
    file,
    includeDrift,
    dryRun,
    supplied: names ? Object.keys(names).length : 0,
    saved,
    entries: result.entries,
    tags: result.tags,
    names: result.names,
    errorsBefore: before.errors,
    errorsAfter: after.errors,
    warningsBefore: before.warnings,
    warningsAfter: after.warnings,
  };
  if (json) {
    process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
    return;
  }
  if (result.names.length === 0) {
    if (after.errors === 0) {
      console.log("names     : every speaker tag already matches the rest of this game");
      console.log("result    : no change");
      return;
    }
    // Everything left is a name this game never translated, so there is no
    // rendering to copy. Say so, and say what would fix it.
    const remaining = verifyDictionary(data, { kinds: ["speaker"] }).problems.filter((p) => p.severity === "error");
    console.log("names     : nothing left that this dictionary can fix");
    console.log("untranslated: " + remaining.length + " line(s) use a name this game never translated");
    for (const problem of remaining.slice(0, shown)) {
      console.log("  " + JSON.stringify(problem.key).slice(0, 58));
    }
    console.log("result    : no change, pass --names <file> to supply the missing renderings");
    return;
  }
  console.log("renamed   : " + result.names.length + " name(s) across " + result.entries + " entries");
  const sorted = result.names.slice().sort((a, b) => b.count - a.count);
  for (const name of sorted.slice(0, shown)) {
    console.log("  " + JSON.stringify(name.source) + " -> " + JSON.stringify(name.to) + "  x" + name.count);
    if (name.from !== name.source) console.log("      was " + JSON.stringify(name.from));
  }
  if (sorted.length > shown) console.log("  ... " + (sorted.length - shown) + " more, raise --limit or pass --json");
  console.log("speaker   : " + before.errors + " -> " + after.errors + " error(s), " + before.warnings + " -> " + after.warnings + " warning(s)");
  if (dryRun) console.log("result    : dry run, dictionary not written");
  else console.log("result    : saved " + file);
}

async function cmdTerms(dir) {
  const project = requireProject(dir);
  const { file, data } = requireDictionary(project);
  const minHolders = numberFlag("min-holders", 5);
  const minSupport = numberFlag("min-support", 0.5);
  const maxLength = numberFlag("max-terms", 0);
  const result = mineTerms(data, { minHolders, minSupport });

  const statuses = typeof flags.status === "string" ? flags.status.split(",").map((s) => s.trim()).filter(Boolean) : null;
  const terms = statuses ? result.terms.filter((term) => statuses.includes(term.status)) : result.terms;
  const written = typeof flags.write === "string" ? path.resolve(flags.write) : null;
  const glossary = toGlossary(terms, { game: data.game, limit: maxLength, driftOnly: flags["drift-only"] === true });

  // --dry-run here means "show what would be written", because writing a
  // glossary into the dictionary is not what this command touches.
  const save = written !== null && flags["dry-run"] !== true;
  if (save) {
    fs.mkdirSync(path.dirname(written), { recursive: true });
    fs.writeFileSync(written, JSON.stringify(glossary, null, 2) + "\n");
  }

  const summary = {
    ok: true,
    file,
    names: result.names,
    nameEntries: result.nameEntries,
    skipped: result.skipped,
    holdersMin: result.holdersMin,
    supportMin: result.supportMin,
    mined: result.terms.length,
    listed: terms.length,
    drift: result.drift.length,
    missing: result.missing.length,
    glossary: Object.keys(glossary.entries).length,
    written: save ? written : null,
  };
  if (json) {
    process.stdout.write(JSON.stringify({ ...summary, terms }, null, 2) + "\n");
    return;
  }
  console.log("names     : " + result.names + " mined from " + result.nameEntries + " name entries");
  console.log(
    "skipped   : " +
      result.skipped.untranslated +
      " untranslated, " +
      result.skipped.short +
      " too short, " +
      result.skipped.prose +
      " prose-like"
  );
  if (terms.length === 0 && result.terms.length === 0) {
    console.log("terms     : none (needs at least " + result.holdersMin + " translated lines mentioning a name)");
  } else if (terms.length === 0) {
    console.log("terms     : none match --status (" + result.terms.length + " mined)");
  } else {
    // When --status filters the list, say how many survived out of the full mine.
    const minedNote = terms.length === result.terms.length ? " mined" : " of " + result.terms.length + " mined";
    console.log(
      "terms     : " +
        terms.length +
        minedNote +
        " (" +
        result.drift.length +
        " drift, " +
        result.missing.length +
        " missing)"
    );
  }
  const shown = numberFlag("limit", 20);
  for (const term of terms.slice(0, shown)) {
    const support = Math.round(term.support * 100) + "%";
    if (term.status === "ok") {
      console.log("  ok       " + term.name + " = " + term.suggested + " (" + support + " of " + term.holders + ")");
    } else {
      console.log(
        "  " + term.status.padEnd(8) + " " + term.name + ": " + (term.db || "(none)") + " -> " + term.dominant
      );
      console.log(
        "           " +
          Math.round(term.dbSupport * 100) +
          "% of " +
          term.holders +
          " mentions use the name entry, " +
          support +
          " use the dominant rendering"
      );
    }
  }
  if (terms.length > shown) console.log("  ... " + (terms.length - shown) + " more, raise --limit or pass --json");
  if (save) console.log("glossary  : " + Object.keys(glossary.entries).length + " entries written to " + written);
  else if (written) console.log("glossary  : " + Object.keys(glossary.entries).length + " entries (--dry-run, not written)");
  else console.log("glossary  : " + Object.keys(glossary.entries).length + " entries, pass --write <file> to save them");
  if (save && result.drift.length > 0) {
    // The file this command writes is meant to be fed back in with --overwrite,
    // because drift lives on entries that already have a translation.
    console.log(
      "apply     : yakusha translate \"" + project.root + "\" --glossary \"" + written + "\" --glossary-only --overwrite"
    );
  }
}

async function cmdTranslate(dir) {
  const project = requireProject(dir);
  const { file, data } = requireDictionary(project);

  const glossaryOnly = flags["glossary-only"] === true;
  const providerName = typeof flags.provider === "string" ? flags.provider : flags["dry-run"] ? "mock" : "openai";
  // Glossary only mode never talks to a model, so do not even build a provider.
  const provider = glossaryOnly
    ? { name: "glossary", complete: () => Promise.reject(new Error("glossary only mode makes no requests")) }
    : createProvider(providerName, {
        baseUrl: typeof flags["base-url"] === "string" ? flags["base-url"] : undefined,
        model: typeof flags.model === "string" ? flags.model : undefined,
        apiKey: typeof flags["api-key"] === "string" ? flags["api-key"] : undefined,
        temperature: numberFlag("temperature", undefined),
        timeoutMs: numberFlag("timeout", undefined),
        maxTokens: numberFlag("max-tokens", undefined),
      });

  /** @type {Record<string,string>} */
  let glossary = {};
  if (typeof flags.glossary === "string") {
    if (!fs.existsSync(flags.glossary)) fail("glossary file not found: " + flags.glossary);
    try {
      const parsed = JSON.parse(fs.readFileSync(flags.glossary, "utf8"));
      if (parsed && typeof parsed === "object") glossary = parsed.entries || parsed;
    } catch (error) {
      fail("cannot read glossary: " + error.message);
    }
  }

  const started = Date.now();
  let lastPercent = -1;
  const maxLength = numberFlag("max-length", 0);
  // A full run over a large game is tens of thousands of entries, so a crash or
  // a Ctrl-C must never throw away an hour of paid requests. The dictionary is
  // written back every --save-every translated entries (0 disables it).
  const saveEvery = numberFlag("save-every", 200);
  // progress.translated counts translations made *during this run*, so the
  // mark has to start at 0 — not at the entries the dictionary already had.
  let lastSaved = 0;
  const flush = () => dict.saveDictionary(file, data);
  const result = await translateDictionary(data, {
    provider,
    targetLang: typeof flags["target-lang"] === "string" ? flags["target-lang"] : undefined,
    glossary,
    batchSize: numberFlag("batch-size", undefined),
    charBudget: numberFlag("char-budget", undefined),
    concurrency: numberFlag("concurrency", undefined),
    limit: numberFlag("limit", undefined),
    onlyContext: normalizeContexts(flags.context),
    glossaryOnly,
    overwriteExisting: flags["overwrite"] === true,
    strictCodes: flags["allow-code-drift"] ? false : undefined,
    // Message windows are a fixed size and MZ never wraps horizontally, so a
    // translation that is wider than the window is silently clipped. --max-length
    // breaks long lines ourselves; 0 (the default) leaves text untouched.
    maxColumns: maxLength,
    // Existing translations are re-fitted too, so adding the flag later repairs
    // a dictionary instead of only affecting new entries.
    rewrapExisting: maxLength > 0 && !flags["no-rewrap"] && !flags["dry-run"],
    onProgress: (progress) => {
      // Persist periodically so an interrupted run resumes instead of restarting.
      if (saveEvery > 0 && !flags["dry-run"]) {
        const translatedNow = progress.translated;
        if (translatedNow - lastSaved >= saveEvery) {
          lastSaved = translatedNow;
          try {
            flush();
          } catch (error) {
            process.stderr.write("warning: cannot save progress: " + error.message + "\n");
          }
        }
      }
      if (json) return;
      const percent = progress.total === 0 ? 100 : Math.floor((progress.done / progress.total) * 100);
      if (percent === lastPercent) return;
      lastPercent = percent;
      process.stderr.write("\r  " + percent + "%  " + progress.done + "/" + progress.total + "   ");
    },
  });

  if (!json) process.stderr.write("\r");
  const overwritten = result.overwritten || 0;

  if (flags["dry-run"]) {
    const summary = {
      ok: true,
      dryRun: true,
      provider: provider.name,
      total: result.total,
      translated: result.translated,
      rejected: result.rejected.length,
    };
    if (json) process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
    else console.log("dry run   : " + result.translated + " of " + result.total + " would be translated (not saved)");
    return;
  }

  dict.saveDictionary(file, data);
  const s = dictStats(data);
  const summary = {
    ok: result.rejected.length === 0,
    file,
    provider: provider.name,
    elapsedMs: Date.now() - started,
    total: result.total,
    translated: result.translated,
    overwritten,
    rejected: result.rejected.length,
    failedBatches: result.failed,
    rewrapped: result.rewrapped,
    progress: s,
  };
  if (json) {
    process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
    return;
  }
  console.log("provider  : " + provider.name);
  console.log("translated: " + result.translated + "/" + result.total + " this run");
  if (overwritten > 0) console.log("overwritten: " + overwritten + " existing translations replaced by --glossary");
  if (result.rewrapped > 0) console.log("rewrapped : " + result.rewrapped + " existing entries fitted to " + maxLength + " columns");
  console.log("progress  : " + s.translated + "/" + s.total + " translated, " + s.pending + " pending");
  if (result.rejected.length > 0) {
    console.log("rejected  : " + result.rejected.length + " (kept untranslated, first 5 below)");
    for (const item of result.rejected.slice(0, 5)) {
      console.log("  - " + JSON.stringify(item.key).slice(0, 60) + " : " + item.reason);
    }
  }
  console.log("elapsed   : " + ((Date.now() - started) / 1000).toFixed(1) + "s");
}

async function cmdInstall(dir) {
  const project = requireProject(dir);
  let embed = null;
  if (flags.embed) {
    const file = dict.dictionaryPath(project.root);
    if (!fs.existsSync(file)) fail("--embed needs a dictionary, run: yakusha extract \"" + project.root + "\"");
    embed = translatedOnly(dict.loadDictionary(file));
    if (Object.keys(embed).length === 0) fail("--embed found no translated entries");
  }
  const result = installPlugin(project, { embed });
  if (json) {
    process.stdout.write(JSON.stringify({ ok: true, ...result }, null, 2) + "\n");
    return;
  }
  console.log("plugin    : " + result.pluginPath);
  console.log("registered: " + (result.registered ? "yes" : "already present"));
  console.log("backup    : " + result.backupPath);
  if (embed) console.log("embedded  : " + Object.keys(embed).length + " translations");
  else console.log("dictionary: yakusha/dictionary.json (loaded at runtime)");
}

async function cmdUninstall(dir) {
  const project = requireProject(dir);
  const result = uninstallPlugin(project);
  if (json) {
    process.stdout.write(JSON.stringify({ ok: true, ...result }, null, 2) + "\n");
    return;
  }
  console.log(result.removed ? "plugin removed" : "plugin was not installed");
  if (result.restored) console.log("plugins.js restored from backup");
}

const commands = {
  scan: cmdScan,
  extract: cmdExtract,
  status: cmdStatus,
  translate: cmdTranslate,
  verify: cmdVerify,
  speaker: cmdSpeaker,
  terms: cmdTerms,
  install: cmdInstall,
  uninstall: cmdUninstall,
};

const USAGE = [
  "yakusha <command> <game-dir> [options]",
  "",
  "  <game-dir> may be the game itself or any folder up to 3 levels above it;",
  "  the project root is discovered automatically.",
  "",
  "  scan       report what is translatable",
  "  extract    build/refresh yakusha/dictionary.json",
  "  status     show translation progress",
  "  translate  fill the dictionary through an LLM",
  "  verify     audit the dictionary for bad entries",
  "  speaker    repair inline speaker names from the game's own rendering",
  "  terms      mine name renderings and report drift",
  "  install    install the runtime plugin into the game",
  "  uninstall  remove the runtime plugin",
  "",
  "translate options:",
  "  --provider <name>   openai (default) or mock",
  "  --model <name>      model id, defaults to $YAKUSHA_MODEL or gpt-4o-mini",
  "  --base-url <url>    OpenAI compatible endpoint, defaults to $YAKUSHA_BASE_URL",
  "  --api-key <key>     API key, defaults to $YAKUSHA_API_KEY or $OPENAI_API_KEY",
  "  --glossary <file>   JSON map of source -> fixed translation",
  "  --limit <n>         translate at most n pending entries",
  "  --context <text>    only entries whose context contains text; repeat to",
  "                      accept any of several",
  "  --batch-size <n>    entries per request (default 40)",
  "  --concurrency <n>   parallel requests (default 2)",
  "  --save-every <n>    write the dictionary every n translations (default 200)",
  "  --max-length <cols> wrap translated lines wider than n display columns (0 = off)",
  "  --dry-run           use the mock provider and do not save",
  "  --glossary-only     apply --glossary and never call a model",
  "  --overwrite         let --glossary replace entries that are already translated",
  "",
  "verify options:",
  "  --kind <list>       only report these kinds, comma separated",
  "                      (kana, echo, codes, slots, lines, width, no-text, trad, speaker, rejected)",
  "  --max-length <cols> also report lines wider than n display columns",
  "  --limit <n>         how many problems to print (default 20)",
  "",
  "speaker options:",
  "  --include-drift     also replace a Chinese rendering that differs from the",
  "                      one used elsewhere (style call, off by default)",
  "  --names <file>      JSON map of source name -> Chinese, for names this game",
  "                      never translated (so no rendering can be copied)",
  "  --dry-run           report what would change without writing",
  "  --limit <n>         how many names to print (default 20)",
  "",
  "terms options:",
  "  --status <list>     only list these statuses (ok, drift, missing)",
  "  --min-holders <n>   mentions a name needs before it is mined (default 5)",
  "  --min-support <n>   share of mentions the dominant spelling needs (default 0.5)",
  "  --drift-only        write only the entries that disagree",
  "  --max-terms <n>     cap the glossary (0 = every mined term)",
  "  --limit <n>         how many terms to print (default 20)",
  "  --write <file>      save the glossary for translate --glossary",
  "  --dry-run           report what --write would save, without saving",
  "",
  "install options:",
  "  --embed             embed the translations into the plugin file",
  "",
  "  --json              machine readable output",
].join("\n");

async function main() {
  const command = positional[0];
  const target = positional[1];
  if (!command || flags.help || command === "--help" || command === "-h") {
    console.log(USAGE);
    process.exit(command ? 0 : 2);
  }
  const handler = commands[command];
  if (!handler) fail("unknown command: " + command + "\n\n" + USAGE);
  await handler(target);
}

main().catch((error) => {
  fail(error && error.stack ? error.stack : String(error));
});