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
 *   doctor     <game-dir>                 is the install and the dictionary healthy?
 *
 * Every command prints one JSON envelope when --json is passed, and prints a
 * human summary otherwise. Usage errors are reported as E_USAGE with exit code
 * 2, findings (verify with errors, doctor with a broken verdict) with exit code
 * 1, everything else with 0. docs/json-contract.md is the contract.
 *
 * @module bin/yakusha
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import * as dict from "../src/core/dict.js";
import { stats as dictStats, translatedOnly } from "../src/core/dict.js";
import { diagnose } from "../src/core/doctor.js";
import { detectProject } from "../src/engines/registry.js";
import { createProvider } from "../src/pipeline/provider.js";
import { translateDictionary } from "../src/pipeline/translate.js";
import { verifyDictionary } from "../src/pipeline/verify.js";
import { buildReport, namesNeedingInput } from "../src/pipeline/report.js";
import { repairSpeakerNames } from "../src/pipeline/speaker.js";
import { mineTerms, toGlossary } from "../src/pipeline/terms.js";
import { assertOptions, parseArgs } from "../src/cli/args.js";
import { CliError, EXIT, emit, emitError, failureFor, sanitizeMessage } from "../src/cli/envelope.js";
import { VERSION } from "../src/version.js";

/** Parsed global state, filled in by {@link main}. */
let flags = {};
let json = false;
let command = null;

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

/**
 * Resolve the project and its adapter for a command, or fail with the
 * documented code.
 *
 * The registry's detectProject is the only way the CLI learns about a game:
 * expected failures come back as a result, so the CLI never parses an
 * exception from openProject (which stays throwing for library callers).
 *
 * @param {string|undefined} dir
 */
function requireProject(dir) {
  if (!dir) throw new CliError("E_USAGE", "no game directory given");
  const result = detectProject(dir);
  if (!result.ok) throw new CliError(result.code, result.message);
  return { project: result.project, adapter: result.adapter };
}

/**
 * Load the dictionary of a project, or fail with E_NO_DICTIONARY / E_DICTIONARY.
 *
 * @param {import("../src/core/mzproject.js").Project} project
 */
function requireDictionary(project) {
  const file = dict.dictionaryPath(project.root);
  if (!fs.existsSync(file)) throw new CliError("E_NO_DICTIONARY", "no dictionary yet: " + file);
  try {
    return { file, data: dict.loadDictionary(file) };
  } catch (error) {
    throw new CliError("E_DICTIONARY", error && error.message ? error.message : String(error));
  }
}

async function cmdScan(dir) {
  const { project, adapter } = requireProject(dir);
  const payload = await adapter.scan(project);
  const done = { payload };
  if (json) return done;
  console.log("game      : " + (project.gameTitle || "(untitled)"));
  console.log("root      : " + project.root);
  console.log("engine    : " + project.engine + (project.version ? " " + project.version : ""));
  console.log("data files: " + payload.dataFiles);
  console.log("strings   : " + payload.uniqueStrings + " unique / " + payload.totalStrings + " total");
  console.log("w/ codes  : " + payload.stringsWithControlCodes);
  const encodings = Object.entries(payload.encodings || {});
  if (encodings.length > 1 || (encodings.length === 1 && encodings[0][0] !== "json")) {
    console.log("encodings : " + encodings.map(([k, v]) => k + " " + v).join(", "));
  }
  if (payload.undecodable && payload.undecodable.length > 0) {
    console.log("UNDECODED : " + payload.undecodable.join(", "));
  }
  const top = Object.entries(payload.perFile)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  for (const [file, count] of top) console.log("  " + file.padEnd(24) + count);
  return done;
}

async function cmdExtract(dir) {
  const { project, adapter } = requireProject(dir);
  const payload = await adapter.extract(project);
  const done = { payload };
  if (json) return done;
  console.log("dictionary: " + payload.file);
  console.log("added     : " + payload.added);
  console.log(
    "progress  : " + payload.translated + "/" + payload.total + " translated, " + payload.pending + " pending"
  );
  return done;
}

async function cmdStatus(dir) {
  const { project } = requireProject(dir);
  const { file, data } = requireDictionary(project);
  const s = dictStats(data);
  const withError = Object.values(data.entries).filter((e) => e.error).length;
  const payload = { file, total: s.total, translated: s.translated, pending: s.pending, withError };
  const done = { payload };
  if (json) return done;
  console.log("progress  : " + s.translated + "/" + s.total + " translated, " + s.pending + " pending");
  if (withError > 0) console.log("rejected  : " + withError + " (see the error field of those entries)");
  return done;
}

async function cmdVerify(dir) {
  const { project } = requireProject(dir);
  const { file, data } = requireDictionary(project);
  const maxColumns = numberFlag("max-length", 0);
  const kinds = typeof flags.kind === "string" ? flags.kind.split(",").map((k) => k.trim()).filter(Boolean) : undefined;
  const result = verifyDictionary(data, { maxColumns, kinds });
  const shown = numberFlag("limit", 20);
  // An error makes the command fail, so a release script can gate on it
  // ("verify && install"). The report still goes to stdout: a caller needs the
  // findings of a failed run most of all.
  const reportFile = typeof flags["write-report"] === "string" ? path.resolve(flags["write-report"]) : null;
  if (reportFile) {
    fs.mkdirSync(path.dirname(reportFile), { recursive: true });
    fs.writeFileSync(
      reportFile,
      buildReport(result, {
        game: project.gameTitle,
        file,
        root: project.root,
        maxColumns,
        dictionary: data,
      })
    );
  }
  const payload = {
    file,
    maxColumns,
    // docs/json-contract.md: report is the path to a written file, so it only
    // exists when --write-report asked for one.
    ...(reportFile ? { report: reportFile } : {}),
    total: result.total,
    translated: result.translated,
    pending: result.pending,
    errors: result.errors,
    warnings: result.warnings,
    rejected: result.rejected,
    counts: result.counts,
    problems: result.problems,
  };
  const done = { outcome: result.errors > 0 ? "findings" : "ok", payload };
  if (json) return done;
  console.log("entries   : " + result.total + " (" + result.translated + " translated, " + result.pending + " pending)");
  if (result.rejected > 0) console.log("rejected  : " + result.rejected + " (see the error field of those entries)");
  if (reportFile) console.log("report    : " + reportFile);
  if (result.problems.length === 0) {
    console.log("problems  : none");
    return done;
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
  return done;
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
  const { project } = requireProject(dir);
  const { file, data } = requireDictionary(project);
  const includeDrift = flags["include-drift"] === true;
  const dryRun = flags["dry-run"] === true;
  const shown = numberFlag("limit", 20);
  let names;
  if (typeof flags.names === "string") {
    const namesFile = path.resolve(flags.names);
    if (!fs.existsSync(namesFile)) throw new CliError("E_IO", "names file not found: " + namesFile);
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(namesFile, "utf8"));
    } catch (error) {
      throw new CliError("E_USAGE", "names file is not valid JSON: " + namesFile + " (" + error.message + ")");
    }
    names = parsed && typeof parsed === "object" ? parsed.entries || parsed : null;
    if (!names || typeof names !== "object") {
      throw new CliError("E_USAGE", "names file must be a JSON map of source name -> Chinese name");
    }
  }
  const before = verifyDictionary(data, { kinds: ["speaker"] });
  const result = repairSpeakerNames(data, { includeDrift, names });
  const after = verifyDictionary(data, { kinds: ["speaker"] });
  // The names repair cannot invent a reading, and a name every line leaves in
  // Japanese has nothing to copy. A template is the cheapest way to ask: the
  // user fills in only the names they care about and reruns with --names.
  const missing = namesNeedingInput(after, data);
  const namesFile = typeof flags["write-names"] === "string" ? path.resolve(flags["write-names"]) : null;
  if (namesFile) {
    const template = { entries: {} };
    for (const entry of missing) template.entries[entry.name] = "";
    fs.mkdirSync(path.dirname(namesFile), { recursive: true });
    fs.writeFileSync(namesFile, JSON.stringify(template, null, 2) + "\n");
  }
  const saved = result.entries > 0 && !dryRun;
  if (saved) dict.saveDictionary(file, data);
  const payload = {
    file,
    includeDrift,
    dryRun,
    supplied: names ? Object.keys(names).length : 0,
    saved,
    entries: result.entries,
    tags: result.tags,
    names: result.names,
    namesFile,
    namesNeeded: missing.length,
    errorsBefore: before.errors,
    errorsAfter: after.errors,
    warningsBefore: before.warnings,
    warningsAfter: after.warnings,
  };
  const done = { payload };
  if (json) return done;
  if (namesFile) {
    console.log(
      "names file: " +
        namesFile +
        (missing.length === 0
          ? " (nothing to fill in)"
          : " (" + missing.length + " name(s) to fill in, then pass --names)")
    );
  }
  if (result.names.length === 0) {
    if (after.errors === 0) {
      console.log("names     : every speaker tag already matches the rest of this game");
      console.log("result    : no change");
      return done;
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
    return done;
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
  return done;
}

async function cmdTerms(dir) {
  const { project } = requireProject(dir);
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

  const payload = {
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
    terms,
  };
  const done = { payload };
  if (json) return done;
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
  return done;
}

async function cmdTranslate(dir) {
  const { project } = requireProject(dir);
  const { file, data } = requireDictionary(project);

  const glossaryOnly = flags["glossary-only"] === true;
  const dryRun = flags["dry-run"] === true;
  const requestedProvider = typeof flags.provider === "string" ? flags.provider : null;
  // --dry-run is documented as the mock provider: it must never spend money,
  // even if the user also passed a real --provider.
  if (dryRun && requestedProvider && requestedProvider.toLowerCase() !== "mock") {
    process.stderr.write("warning: --dry-run always uses the mock provider; --provider " + requestedProvider + " ignored\n");
  }
  // 0.10 has no default provider. A real run must say where it is going;
  // guessing meant a missing setup only failed after a request was attempted.
  const providerName = glossaryOnly ? null : dryRun ? "mock" : requestedProvider;
  if (!glossaryOnly && !dryRun && !providerName) {
    throw new CliError("E_CONFIG", "no provider configured: pass --provider openai or --provider compatible");
  }
  // A third-party endpoint has no sensible default, and sending the key to
  // api.openai.com because baseUrl was omitted would be both wrong and surprising.
  if (
    providerName !== null &&
    providerName.toLowerCase() === "compatible" &&
    typeof flags["base-url"] !== "string" &&
    !process.env.YAKUSHA_BASE_URL
  ) {
    throw new CliError("E_CONFIG", "no base URL configured for provider compatible: pass --base-url or set YAKUSHA_BASE_URL");
  }
  // Glossary only mode never talks to a model, so do not even build a provider.
  let provider;
  try {
    provider = glossaryOnly
      ? { name: "glossary", complete: () => Promise.reject(new Error("glossary only mode makes no requests")) }
      : createProvider(providerName, {
          baseUrl: typeof flags["base-url"] === "string" ? flags["base-url"] : undefined,
          model: typeof flags.model === "string" ? flags.model : undefined,
          apiKey: typeof flags["api-key"] === "string" ? flags["api-key"] : undefined,
          temperature: numberFlag("temperature", undefined),
          timeoutMs: numberFlag("timeout", undefined),
          maxTokens: numberFlag("max-tokens", undefined),
        });
  } catch (error) {
    // Missing configuration stays E_CONFIG so the user is told to configure the
    // tool; anything else from provider construction is the provider's fault.
    const code = error && typeof error.code === "string" && /^E_[A-Z][A-Z_]*$/.test(error.code) ? error.code : "E_PROVIDER";
    throw new CliError(code, error && error.message ? error.message : String(error));
  }

  /** @type {Record<string,string>} */
  let glossary = {};
  if (typeof flags.glossary === "string") {
    if (!fs.existsSync(flags.glossary)) throw new CliError("E_IO", "glossary file not found: " + flags.glossary);
    try {
      const parsed = JSON.parse(fs.readFileSync(flags.glossary, "utf8"));
      if (parsed && typeof parsed === "object") glossary = parsed.entries || parsed;
    } catch (error) {
      throw new CliError("E_USAGE", "cannot read glossary: " + error.message);
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
    rewrapExisting: maxLength > 0 && !flags["no-rewrap"] && !dryRun,
    onProgress: (progress) => {
      // Persist periodically so an interrupted run resumes instead of restarting.
      if (saveEvery > 0 && !dryRun) {
        const translatedNow = progress.translated;
        if (translatedNow - lastSaved >= saveEvery) {
          lastSaved = translatedNow;
          try {
            flush();
          } catch (error) {
            process.stderr.write("warning: cannot save progress: " + sanitizeMessage(error.message) + "\n");
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
  // The payload names the provider family (openai / mock), never the model and
  // never the key; the text output may still show the model.
  const providerLabel = String(provider.name).split(":")[0];

  if (dryRun) {
    const payload = {
      dryRun: true,
      provider: providerLabel,
      total: result.total,
      translated: result.translated,
      rejected: result.rejected.length,
    };
    const done = { payload };
    if (json) return done;
    console.log("dry run   : " + result.translated + " of " + result.total + " would be translated (not saved)");
    return done;
  }

  dict.saveDictionary(file, data);
  const s = dictStats(data);
  const payload = {
    file,
    provider: providerLabel,
    elapsedMs: Date.now() - started,
    total: result.total,
    translated: result.translated,
    overwritten,
    rejected: result.rejected.length,
    failedBatches: result.failed,
    rewrapped: result.rewrapped,
    progress: s,
  };
  const done = { payload };
  if (json) return done;
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
  return done;
}

/**
 * Run a plugin install/uninstall step, mapping a damaged plugins.js to E_IO.
 *
 * @template T
 * @param {() => T} step
 * @returns {Promise<T>}
 */
async function pluginStep(step) {
  try {
    return await step();
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    if (String(message).startsWith("plugins.js:")) {
      throw new CliError("E_IO", "cannot update js/plugins.js: " + message);
    }
    throw error;
  }
}

async function cmdInstall(dir) {
  const { project, adapter } = requireProject(dir);
  let embed = null;
  if (flags.embed) {
    const file = dict.dictionaryPath(project.root);
    if (!fs.existsSync(file)) {
      throw new CliError("E_NO_DICTIONARY", "--embed needs a dictionary, run: yakusha extract \"" + project.root + "\"");
    }
    embed = translatedOnly(dict.loadDictionary(file));
    if (Object.keys(embed).length === 0) throw new CliError("E_NO_DICTIONARY", "--embed found no translated entries");
  }
  const result = await pluginStep(() => adapter.installRuntime(project, { embed }));
  const payload = {
    pluginPath: result.pluginPath,
    registered: result.registered,
    backupPath: result.backupPath,
    createdBackup: result.createdBackup,
    staleBackup: result.staleBackup,
    state: result.state,
  };
  const done = { payload };
  if (result.staleBackup) {
    process.stderr.write(
      "warning: plugins.js changed after the backup was taken; uninstall will keep those edits and only remove the yakusha entry\n"
    );
  }
  if (json) return done;
  console.log("plugin    : " + result.pluginPath);
  console.log("registered: " + (result.registered ? "yes" : "already present"));
  console.log("backup    : " + result.backupPath);
  if (embed) console.log("embedded  : " + Object.keys(embed).length + " translations");
  else console.log("dictionary: yakusha/dictionary.json (loaded at runtime)");
  return done;
}

async function cmdUninstall(dir) {
  const { project, adapter } = requireProject(dir);
  const result = await pluginStep(() => adapter.uninstallRuntime(project));
  const payload = {
    removed: result.removed,
    restored: result.restored,
    backupPath: result.backupPath,
    drifted: result.drifted,
    keptBackup: result.keptBackup,
  };
  const done = { payload };
  if (json) return done;
  console.log(result.removed ? "plugin removed" : "plugin was not installed");
  if (result.restored) {
    console.log("plugins.js restored from backup");
  } else if (result.keptBackup) {
    console.log("plugins.js changed after install: removed only the yakusha entry");
    console.log("backup kept : " + result.keptBackup);
  }
  return done;
}

async function cmdDoctor(dir) {
  const { project } = requireProject(dir);
  const file = dict.dictionaryPath(project.root);
  let data = null;
  if (fs.existsSync(file)) {
    try {
      data = dict.loadDictionary(file);
    } catch {
      data = null;
    }
  }
  const result = diagnose(project, { dictionary: data, dictionaryFile: file, maxColumns: numberFlag("max-length", 0) });
  const payload = {
    verdict: result.verdict,
    checks: result.checks,
    failure: result.failure,
    game: result.game,
    dictionary: result.dictionary,
    sync: result.sync,
    install: result.install,
    runtime: result.runtime,
    verify: result.verify,
  };
  const done = { outcome: result.verdict === "broken" ? "findings" : "ok", payload };
  if (json) return done;
  const game = result.game;
  console.log(
    "game      : " +
      (game.title || "(untitled)") +
      " (RPG Maker " +
      game.engine.toUpperCase() +
      (game.engineVersion ? " " + game.engineVersion : "") +
      ", " +
      game.dataFiles +
      " data files)"
  );
  for (const check of result.checks) {
    console.log(("  " + check.id).padEnd(14) + check.level.padEnd(6) + check.message);
    for (const sample of check.samples || []) console.log("              - " + JSON.stringify(sample).slice(0, 70));
  }
  if (result.verdict === "broken") console.log("verdict   : broken - " + result.failure);
  else if (result.verdict === "not-installed") console.log("verdict   : not installed yet - run: yakusha install <game>");
  else if (result.verdict === "usable") {
    const warnings = result.checks.filter((check) => check.level === "warn").length;
    console.log("verdict   : usable with " + warnings + " warning(s)");
  } else console.log("verdict   : ready");
  return done;
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
  doctor: cmdDoctor,
};

const USAGE = [
  "yakusha <command> <game-dir> [options]",
  "",
  "  <game-dir> may be the game itself or any folder up to 3 levels above it;",
  "  the project root is discovered automatically.",
  "",
  "global options:",
  "  --json              machine readable output (every command)",
  "  --help, -h          show this help",
  "  --version           print the version and exit",
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
  "  doctor     check the install, the backup and the dictionary against this build",
  "",
  "translate options:",
  "  --provider <name>   openai, compatible or mock (required for a real run)",
  "  --model <name>      model id (required for a real run; $YAKUSHA_MODEL)",
  "  --base-url <url>    OpenAI compatible endpoint, defaults to $YAKUSHA_BASE_URL",
  "  --api-key <key>     API key, defaults to $YAKUSHA_API_KEY or $OPENAI_API_KEY",
  "  --glossary <file>   JSON map of source -> fixed translation",
  "  --limit <n>         translate at most n pending entries",
  "  --context <text>    only entries whose context contains text; repeat to",
  "                      accept any of several",
  "  --batch-size <n>    entries per request (default 40)",
  "  --char-budget <n>   characters per request (default 6000)",
  "  --concurrency <n>   parallel requests (default 2)",
  "  --save-every <n>    write the dictionary every n translations (default 200)",
  "  --max-length <cols> wrap translated lines wider than n display columns (0 = off)",
  "  --no-rewrap         leave existing translations alone (no re-wrap)",
  "  --dry-run           use the mock provider and do not save",
  "  --glossary-only     apply --glossary and never call a model",
  "  --overwrite         let --glossary replace entries that are already translated",
  "",
  "verify options:",
  "  --kind <list>       only report these kinds, comma separated",
  "                      (kana, echo, codes, slots, lines, width, no-text, trad, speaker, rejected)",
  "  --max-length <cols> also report lines wider than n display columns",
  "  --limit <n>         how many problems to print (default 20)",
  "  --write-report <f>  write every finding as a markdown report",
  "",
  "speaker options:",
  "  --include-drift     also replace a Chinese rendering that differs from the",
  "                      one used elsewhere (style call, off by default)",
  "  --names <file>      JSON map of source name -> Chinese, for names this game",
  "                      never translated (so no rendering can be copied)",
  "  --write-names <f>   write a JSON template of the names --names must supply",
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
].join("\n");

/**
 * Report one failure the way the current output mode requires.
 *
 * @param {unknown} error
 */
function reportFailure(error) {
  const failure = failureFor(error);
  // Parsing happens before the command is bound, so a usage error carries the
  // command it was reading on the error itself.
  if (!command && error && typeof error.command === "string") command = error.command;
  // A stack is for the person debugging yakusha, never for the payload: it
  // carries absolute paths and sometimes request context. Opt in on stderr.
  if (process.env.YAKUSHA_DEBUG === "1" && error && error.stack) process.stderr.write(error.stack + "\n");
  if (json) {
    const code = emitError(command, failure.code, failure.message, failure.details);
    process.exitCode = code;
    return;
  }
  process.stderr.write("error: " + sanitizeMessage(failure.message) + "\n");
  process.exitCode = EXIT.error;
}

/**
 * @returns {Promise<number>} the exit code implied by the run
 */
async function main() {
  const argv = process.argv.slice(2);
  // --version and --help win over everything else, including a command and a
  // bad option: they are how a caller finds out what this binary is.
  const wantsVersion = argv.includes("--version");
  const wantsHelp = argv.includes("--help") || argv.includes("-h");
  if (wantsVersion) {
    process.stdout.write("yakusha " + VERSION + "\n");
    return EXIT.ok;
  }
  // The error reporter needs the mode even when parsing fails, so detect --json
  // before the parse and only then take the parsed value.
  json = argv.includes("--json");
  if (wantsHelp) {
    process.stdout.write(USAGE + "\n");
    return EXIT.ok;
  }

  const parsed = parseArgs(argv);
  flags = parsed.flags;
  json = flags.json === true;
  command = parsed.positional[0] || null;

  if (!command) {
    if (json) return emitError(null, "E_USAGE", "no command");
    process.stderr.write(USAGE + "\n");
    return EXIT.error;
  }
  if (!Object.hasOwn(commands, command)) {
    if (json) return emitError(command, "E_USAGE", "unknown command: " + command);
    process.stderr.write("error: unknown command: " + command + "\nrun 'yakusha --help' for usage\n");
    return EXIT.error;
  }
  assertOptions(command, flags);

  const args = parsed.positional.slice(1);
  if (args.length === 0) throw new CliError("E_USAGE", "no game directory given");
  if (args.length > 1) throw new CliError("E_USAGE", "unexpected argument: " + args[1]);

  const result = await commands[command](args[0]);
  const outcome = result.outcome || "ok";
  if (json) return emit(command, outcome, result.payload);
  return EXIT[outcome];
}

main()
  .then((code) => {
    if (code !== EXIT.ok) process.exitCode = code;
  })
  .catch(reportFailure);
