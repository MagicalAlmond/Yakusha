/**
 * Shared command runner.
 *
 * The CLI and the GUI are two front ends over the same command
 * implementations: bin/yakusha.js parses argv and prints the envelope,
 * this module holds everything between — payload building, the engine
 * adapters, the dictionary — so the two front ends cannot drift.
 *
 * A command body here is the single source of both the payload (returned
 * to every caller) and the human summary (written through the sink).
 * The sink is optional: the CLI passes one that writes to stdout/stderr
 * when --json is absent; the GUI passes none and renders the payload.
 *
 * @module src/cli/runner
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import * as dict from "../core/dict.js";
import { stats as dictStats, translatedOnly } from "../core/dict.js";
import { diagnose } from "../core/doctor.js";
import { detectProject } from "../engines/registry.js";
import { createProvider } from "../pipeline/provider.js";
import { translateDictionary } from "../pipeline/translate.js";
import { verifyDictionary } from "../pipeline/verify.js";
import { buildReport, namesNeedingInput } from "../pipeline/report.js";
import { repairSpeakerNames } from "../pipeline/speaker.js";
import { mineTerms, toGlossary } from "../pipeline/terms.js";
import {
  DEFAULT_BASE_URL,
  loadConfig,
  requireUsableConfig,
  resolveEffective,
  setConfigValue,
  unsetConfigValue,
} from "./config.js";
import { CliError, sanitizeMessage } from "./envelope.js";
import {
  assertNotDictionaryTarget,
  buildExport,
  exportLocationWarning,
  parseExportEntries,
  serialiseExport,
  writeExportFile,
} from "./export.js";
import {
  parseTable,
  parseJsonl,
  serialiseTable,
  buildTableRows,
} from "./table.js";

/** A sink that drops every line: the GUI calls commands silently. */
export const nullSink = Object.freeze({
  out: () => {},
  warn: () => {},
});

/** A sink that prints human summaries to stdout and warnings to stderr. */
export const consoleSink = Object.freeze({
  out: (line) => console.log(line),
  warn: (text) => process.stderr.write(text),
});

/**
 * Read a numeric flag, falling back when it is absent or not a number.
 *
 * @param {Record<string, unknown>} flags
 * @param {string} name
 * @param {number} fallback
 */
function numberFlag(flags, name, fallback) {
  const raw = flags[name];
  if (raw === undefined || raw === true) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Turn a (possibly repeated) --context value into the shape selectPending
 * expects: undefined when absent, a string for the single value case.
 *
 * @param {unknown} raw
 */
function normalizeContexts(raw) {
  if (raw === undefined || raw === true) return undefined;
  const list = (Array.isArray(raw) ? raw : [raw]).filter((v) => typeof v === "string" && v.length > 0);
  if (list.length === 0) return undefined;
  return list.length === 1 ? list[0] : list;
}

/**
 * Print config warnings on the sink's warning channel in either front end.
 *
 * @param {string[]} warnings
 * @param {{ warn(text: string): void }} sink
 */
function writeConfigWarnings(warnings, sink) {
  for (const warning of warnings || []) {
    sink.warn("warning: " + sanitizeMessage(warning) + "\n");
  }
}

/**
 * Resolve the project and its adapter for a command, or fail with the
 * documented code.
 *
 * The registry's detectProject is the only way a front end learns about a
 * game: expected failures come back as a result, so commands never parse an
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
 * @param {import("../core/mzproject.js").Project} project
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

/**
 * A non-default endpoint is the one config value whose effect is not obvious
 * from the value alone. Warn in both modes, on the warning channel, so the
 * payload channel stays clean.
 *
 * @param {string|null} baseUrl
 * @param {{ warn(text: string): void }} sink
 */
function warnNonDefaultBaseUrl(baseUrl, sink) {
  if (!baseUrl || baseUrl === DEFAULT_BASE_URL) return;
  sink.warn("warning: requests will be sent to " + sanitizeMessage(baseUrl) + "\n");
}

/**
 * Scan a game and report what is translatable.
 *
 * @param {string|undefined} dir
 * @param {{ out(line: string): void }} sink
 */
async function commandScan(dir, sink) {
  const { project, adapter } = requireProject(dir);
  const payload = await adapter.scan(project);
  sink.out("game      : " + (project.gameTitle || "(untitled)"));
  sink.out("root      : " + project.root);
  sink.out("engine    : " + project.engine + (project.version ? " " + project.version : ""));
  sink.out((adapter.dataUnit === "scripts" ? "scripts   : " : "data files: ") + payload.dataFiles);
  sink.out("strings   : " + payload.uniqueStrings + " unique / " + payload.totalStrings + " total");
  sink.out("w/ codes  : " + payload.stringsWithControlCodes);
  const encodings = Object.entries(payload.encodings || {});
  if (encodings.length > 1 || (encodings.length === 1 && encodings[0][0] !== "json")) {
    sink.out("encodings : " + encodings.map(([k, v]) => k + " " + v).join(", "));
  }
  if (payload.undecodable && payload.undecodable.length > 0) {
    sink.out("UNDECODED : " + payload.undecodable.join(", "));
  }
  const top = Object.entries(payload.perFile)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  for (const [file, count] of top) sink.out("  " + file.padEnd(24) + count);
  return { payload };
}

/**
 * Build or refresh the dictionary of a game.
 *
 * @param {string|undefined} dir
 * @param {{ out(line: string): void }} sink
 */
async function commandExtract(dir, sink) {
  const { project, adapter } = requireProject(dir);
  const payload = await adapter.extract(project);
  sink.out("dictionary: " + payload.file);
  sink.out("added     : " + payload.added);
  sink.out(
    "progress  : " + payload.translated + "/" + payload.total + " translated, " + payload.pending + " pending"
  );
  return { payload };
}

/**
 * Report translation progress of an existing dictionary.
 *
 * @param {string|undefined} dir
 * @param {{ out(line: string): void }} sink
 */
async function commandStatus(dir, sink) {
  const { project } = requireProject(dir);
  const { file, data } = requireDictionary(project);
  const s = dictStats(data);
  const withError = Object.values(data.entries).filter((e) => e.error).length;
  sink.out("progress  : " + s.translated + "/" + s.total + " translated, " + s.pending + " pending");
  if (withError > 0) sink.out("rejected  : " + withError + " (see the error field of those entries)");
  return { payload: { file, total: s.total, translated: s.translated, pending: s.pending, withError } };
}

/**
 * Audit the dictionary for bad entries.
 *
 * @param {string|undefined} dir
 * @param {Record<string, unknown>} flags
 * @param {{ out(line: string): void }} sink
 */
async function commandVerify(dir, flags, sink) {
  const { project, adapter } = requireProject(dir);
  const { file, data } = requireDictionary(project);
  const maxColumns = numberFlag(flags, "max-length", 0);
  const kinds = typeof flags.kind === "string" ? flags.kind.split(",").map((k) => k.trim()).filter(Boolean) : undefined;
  const result = verifyDictionary(data, { maxColumns, kinds, profile: adapter.profile });
  const shown = numberFlag(flags, "limit", 20);
  // An error makes the command fail, so a release script can gate on it
  // ("verify && install"). The report still goes to the out channel: a caller
  // needs the findings of a failed run most of all.
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
  sink.out("entries   : " + result.total + " (" + result.translated + " translated, " + result.pending + " pending)");
  if (result.rejected > 0) sink.out("rejected  : " + result.rejected + " (see the error field of those entries)");
  if (reportFile) sink.out("report    : " + reportFile);
  if (result.problems.length === 0) {
    sink.out("problems  : none");
    return {
      outcome: "ok",
      payload: {
        file,
        maxColumns,
        ...(reportFile ? { report: reportFile } : {}),
        total: result.total,
        translated: result.translated,
        pending: result.pending,
        errors: result.errors,
        warnings: result.warnings,
        rejected: result.rejected,
        counts: result.counts,
        problems: result.problems,
      },
    };
  } else {
    const kindsSeen = Object.keys(result.counts).sort();
    sink.out(
      "problems  : " +
        result.problems.length +
        " (" +
        kindsSeen.map((k) => k + " " + result.counts[k]).join(", ") +
        ")"
    );
    for (const problem of result.problems.slice(0, shown)) {
      sink.out("  [" + problem.severity + "] " + problem.kind + " " + JSON.stringify(problem.key).slice(0, 58));
      sink.out("        " + problem.detail);
    }
    if (result.problems.length > shown) {
      sink.out("  ... " + (result.problems.length - shown) + " more, raise --limit or pass --json");
    }
  }
  sink.out(result.errors > 0 ? "result    : FAILED, " + result.errors + " error(s)" : "result    : OK with " + result.warnings + " warning(s)");
  return {
    outcome: result.errors > 0 ? "findings" : "ok",
    payload: {
      file,
      maxColumns,
      // docs/json-contract.md: report is the path to a written file, so it
      // only exists when --write-report asked for one.
      ...(reportFile ? { report: reportFile } : {}),
      total: result.total,
      translated: result.translated,
      pending: result.pending,
      errors: result.errors,
      warnings: result.warnings,
      rejected: result.rejected,
      counts: result.counts,
      problems: result.problems,
    },
  };
}

/**
 * Repair inline speaker names.
 *
 * verify can only report these: a name is wrong in relation to how the rest of
 * the same dictionary renders it, so the fix is "use the rendering this game
 * already uses", not a new translation. That is mechanical, and doing it by
 * hand on 400 entries is not realistic.
 *
 * @param {string|undefined} dir
 * @param {Record<string, unknown>} flags
 * @param {{ out(line: string): void }} sink
 */
async function commandSpeaker(dir, flags, sink) {
  const { project, adapter } = requireProject(dir);
  const { file, data } = requireDictionary(project);
  const includeDrift = flags["include-drift"] === true;
  const dryRun = flags["dry-run"] === true;
  const shown = numberFlag(flags, "limit", 20);
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
  const before = verifyDictionary(data, { kinds: ["speaker"], profile: adapter.profile });
  const result = repairSpeakerNames(data, { includeDrift, names });
  const after = verifyDictionary(data, { kinds: ["speaker"], profile: adapter.profile });
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
  if (namesFile) {
    sink.out(
      "names file: " +
        namesFile +
        (missing.length === 0
          ? " (nothing to fill in)"
          : " (" + missing.length + " name(s) to fill in, then pass --names)")
    );
  }
  if (result.names.length === 0) {
    if (after.errors === 0) {
      sink.out("names     : every speaker tag already matches the rest of this game");
      sink.out("result    : no change");
    } else {
      // Everything left is a name this game never translated, so there is no
      // rendering to copy. Say so, and say what would fix it.
      const remaining = verifyDictionary(data, { kinds: ["speaker"], profile: adapter.profile }).problems.filter((p) => p.severity === "error");
      sink.out("names     : nothing left that this dictionary can fix");
      sink.out("untranslated: " + remaining.length + " line(s) use a name this game never translated");
      for (const problem of remaining.slice(0, shown)) {
        sink.out("  " + JSON.stringify(problem.key).slice(0, 58));
      }
      sink.out("result    : no change, pass --names <file> to supply the missing renderings");
    }
  } else {
    sink.out("renamed   : " + result.names.length + " name(s) across " + result.entries + " entries");
    const sorted = result.names.slice().sort((a, b) => b.count - a.count);
    for (const name of sorted.slice(0, shown)) {
      sink.out("  " + JSON.stringify(name.source) + " -> " + JSON.stringify(name.to) + "  x" + name.count);
      if (name.from !== name.source) sink.out("      was " + JSON.stringify(name.from));
    }
    if (sorted.length > shown) sink.out("  ... " + (sorted.length - shown) + " more, raise --limit or pass --json");
    sink.out("speaker   : " + before.errors + " -> " + after.errors + " error(s), " + before.warnings + " -> " + after.warnings + " warning(s)");
    if (dryRun) sink.out("result    : dry run, dictionary not written");
    else sink.out("result    : saved " + file);
  }
  return {
    payload: {
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
    },
  };
}

/**
 * Mine name renderings from the dictionary and report drift.
 *
 * @param {string|undefined} dir
 * @param {Record<string, unknown>} flags
 * @param {{ out(line: string): void }} sink
 */
async function commandTerms(dir, flags, sink) {
  const { project } = requireProject(dir);
  const { file, data } = requireDictionary(project);
  const minHolders = numberFlag(flags, "min-holders", 5);
  const minSupport = numberFlag(flags, "min-support", 0.5);
  const maxLength = numberFlag(flags, "max-terms", 0);
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

  sink.out("names     : " + result.names + " mined from " + result.nameEntries + " name entries");
  sink.out(
    "skipped   : " +
      result.skipped.untranslated +
      " untranslated, " +
      result.skipped.short +
      " too short, " +
      result.skipped.prose +
      " prose-like"
  );
  if (terms.length === 0 && result.terms.length === 0) {
    sink.out("terms     : none (needs at least " + result.holdersMin + " translated lines mentioning a name)");
  } else if (terms.length === 0) {
    sink.out("terms     : none match --status (" + result.terms.length + " mined)");
  } else {
    // When --status filters the list, say how many survived out of the full mine.
    const minedNote = terms.length === result.terms.length ? " mined" : " of " + result.terms.length + " mined";
    sink.out(
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
  const shown = numberFlag(flags, "limit", 20);
  for (const term of terms.slice(0, shown)) {
    const support = Math.round(term.support * 100) + "%";
    if (term.status === "ok") {
      sink.out("  ok       " + term.name + " = " + term.suggested + " (" + support + " of " + term.holders + ")");
    } else {
      sink.out(
        "  " + term.status.padEnd(8) + " " + term.name + ": " + (term.db || "(none)") + " -> " + term.dominant
      );
      sink.out(
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
  if (terms.length > shown) sink.out("  ... " + (terms.length - shown) + " more, raise --limit or pass --json");
  if (save) sink.out("glossary  : " + Object.keys(glossary.entries).length + " entries written to " + written);
  else if (written) sink.out("glossary  : " + Object.keys(glossary.entries).length + " entries (--dry-run, not written)");
  else sink.out("glossary  : " + Object.keys(glossary.entries).length + " entries, pass --write <file> to save them");
  if (save && result.drift.length > 0) {
    // The file this command writes is meant to be fed back in with --overwrite,
    // because drift lives on entries that already have a translation.
    sink.out(
      "apply     : yakusha translate \"" + project.root + "\" --glossary \"" + written + "\" --glossary-only --overwrite"
    );
  }
  return {
    payload: {
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
    },
  };
}

/**
 * Fill the dictionary through an LLM. The one long-running command.
 *
 * @param {string|undefined} dir
 * @param {Record<string, unknown>} flags
 * @param {{ out(line: string): void, warn(text: string): void }} sink
 * @param {((progress: {done: number, total: number, translated: number, rejected: number}) => void)|null} onProgress
 *        caller progress hook (the GUI renders it); the CLI wires its stderr
 *        percentage display through this, exactly as before.
 * @param {{signal?: AbortSignal}} [opts] extra controls for front ends: the GUI
 *        cancels a long translate run through signal; the CLI passes nothing.
 */
async function commandTranslate(dir, flags, sink, onProgress, opts = {}) {
  const { project, adapter } = requireProject(dir);
  const { file, data } = requireDictionary(project);

  const glossaryOnly = flags["glossary-only"] === true;
  const dryRun = flags["dry-run"] === true;
  const requestedProvider = typeof flags.provider === "string" ? flags.provider : null;
  // --dry-run is documented as the mock provider: it must never spend money,
  // even if the user also passed a real --provider.
  if (dryRun && requestedProvider && requestedProvider.toLowerCase() !== "mock") {
    sink.warn("warning: --dry-run always uses the mock provider; --provider " + requestedProvider + " ignored\n");
  }
  // --dry-run must not read the config file at all, so a broken file (or a
  // missing APPDATA) cannot stop an offline preview. Every other mode reads it:
  // a broken file is a warning here, because an offline run should still work.
  const loaded = dryRun ? null : loadConfig({ env: process.env });
  if (loaded) writeConfigWarnings(loaded.warnings, sink);
  const effective = loaded
    ? resolveEffective(loaded, { flags, env: process.env })
    : {
        provider: { value: null, source: "none" },
        model: { value: null, source: "none" },
        baseUrl: { value: null, source: "none" },
        apiKey: { set: false, source: null },
      };
  // 0.10 has no default provider: the flag, the config file or nothing.
  const providerName = glossaryOnly ? null : dryRun ? "mock" : effective.provider.value;
  if (!glossaryOnly && !dryRun && !providerName) {
    throw new CliError(
      "E_CONFIG",
      "no provider configured: pass --provider openai or --provider compatible, or run: yakusha config set provider openai"
    );
  }
  const providerKey = providerName === null ? null : String(providerName).toLowerCase();
  // A third-party endpoint has no sensible default, and sending the key to
  // api.openai.com because baseUrl was omitted would be both wrong and surprising.
  if (providerKey === "compatible" && !effective.baseUrl.value) {
    throw new CliError(
      "E_CONFIG",
      "no base URL configured for provider compatible: pass --base-url, set YAKUSHA_BASE_URL, or run: yakusha config set baseUrl <url>"
    );
  }
  // Glossary only mode never talks to a model, so do not even build a provider.
  let provider;
  try {
    provider = glossaryOnly
      ? { name: "glossary", complete: () => Promise.reject(new Error("glossary only mode makes no requests")) }
      : createProvider(providerName, {
          baseUrl: effective.baseUrl.value || undefined,
          model: effective.model.value || undefined,
          apiKey: typeof flags["api-key"] === "string" ? flags["api-key"] : undefined,
          temperature: numberFlag(flags, "temperature", undefined),
          timeoutMs: numberFlag(flags, "timeout", undefined),
          maxTokens: numberFlag(flags, "max-tokens", undefined),
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
  const maxLength = numberFlag(flags, "max-length", 0);
  // A full run over a large game is tens of thousands of entries, so a crash or
  // a Ctrl-C must never throw away an hour of paid requests. The dictionary is
  // written back every --save-every translated entries (0 disables it).
  const saveEvery = numberFlag(flags, "save-every", 200);
  // progress.translated counts translations made *during this run*, so the
  // mark has to start at 0 — not at the entries the dictionary already had.
  let lastSaved = 0;
  const flush = () => dict.saveDictionary(file, data);
  const result = await translateDictionary(data, {
    provider,
    profile: adapter.profile,
    signal: opts.signal,
    targetLang: typeof flags["target-lang"] === "string" ? flags["target-lang"] : undefined,
    glossary,
    batchSize: numberFlag(flags, "batch-size", undefined),
    charBudget: numberFlag(flags, "char-budget", undefined),
    concurrency: numberFlag(flags, "concurrency", undefined),
    limit: numberFlag(flags, "limit", undefined),
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
            sink.warn("warning: cannot save progress: " + sanitizeMessage(error.message) + "\n");
          }
        }
      }
      if (onProgress) onProgress(progress);
    },
  });

  const overwritten = result.overwritten || 0;
  // The payload names the provider family (openai / mock), never the model and
  // never the key; the text output may still show the model.
  const providerLabel = String(provider.name).split(":")[0];

  if (dryRun) {
    sink.out("dry run   : " + result.translated + " of " + result.total + " would be translated (not saved)");
    return {
      payload: {
        dryRun: true,
        provider: providerLabel,
        total: result.total,
        translated: result.translated,
        rejected: result.rejected.length,
      },
    };
  }

  dict.saveDictionary(file, data);
  const s = dictStats(data);
  sink.out("provider  : " + provider.name);
  sink.out("translated: " + result.translated + "/" + result.total + " this run");
  if (overwritten > 0) sink.out("overwritten: " + overwritten + " existing translations replaced by --glossary");
  if (result.rewrapped > 0) sink.out("rewrapped : " + result.rewrapped + " existing entries fitted to " + maxLength + " columns");
  sink.out("progress  : " + s.translated + "/" + s.total + " translated, " + s.pending + " pending");
  if (result.rejected.length > 0) {
    sink.out("rejected  : " + result.rejected.length + " (kept untranslated, first 5 below)");
    for (const item of result.rejected.slice(0, 5)) {
      sink.out("  - " + JSON.stringify(item.key).slice(0, 60) + " : " + item.reason);
    }
  }
  sink.out("elapsed   : " + ((Date.now() - started) / 1000).toFixed(1) + "s");
  return {
    payload: {
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
      // True when the run stopped early through the cancellation signal (the
      // GUI's stop button). The CLI never cancels, so this is false there.
      cancelled: result.cancelled === true,
    },
  };
}

/**
 * Copy the runtime plugin into the game (or the engine's translation file).
 *
 * @param {string|undefined} dir
 * @param {Record<string, unknown>} flags
 * @param {{ out(line: string): void, warn(text: string): void }} sink
 */
async function commandInstall(dir, flags, sink) {
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
  if (result.staleBackup) {
    sink.warn(
      "warning: plugins.js changed after the backup was taken; uninstall will keep those edits and only remove the yakusha entry\n"
    );
  }
  if (adapter.capabilities && adapter.capabilities.runtime === "translation") {
    // Ren'Py: the delivered file is the translation script, there is no
    // registry entry and no backup to take.
    sink.out("translation: " + result.pluginPath);
    sink.out("strings    : " + (result.entries || 0) + " (" + (result.language || "unknown") + ")");
    sink.out("uninstall  : yakusha uninstall \"" + project.root + "\"");
  } else {
    sink.out("plugin    : " + result.pluginPath);
    sink.out("registered: " + (result.registered ? "yes" : "already present"));
    sink.out("backup    : " + (result.backupPath === null ? "(none)" : result.backupPath));
    if (embed) sink.out("embedded  : " + Object.keys(embed).length + " translations");
    else sink.out("dictionary: yakusha/dictionary.json (loaded at runtime)");
  }
  return {
    payload: {
      pluginPath: result.pluginPath,
      registered: result.registered,
      backupPath: result.backupPath,
      createdBackup: result.createdBackup,
      staleBackup: result.staleBackup,
      state: result.state,
    },
  };
}

/**
 * Remove the runtime plugin (or the engine's translation file).
 *
 * @param {string|undefined} dir
 * @param {{ out(line: string): void }} sink
 */
async function commandUninstall(dir, sink) {
  const { project, adapter } = requireProject(dir);
  const result = await pluginStep(() => adapter.uninstallRuntime(project));
  if (adapter.capabilities && adapter.capabilities.runtime === "translation") {
    sink.out(result.removed ? "translation removed" : "translation file was not installed");
  } else {
    sink.out(result.removed ? "plugin removed" : "plugin was not installed");
    if (result.restored) {
      sink.out("plugins.js restored from backup");
    } else if (result.keptBackup) {
      sink.out("plugins.js changed after install: removed only the yakusha entry");
      sink.out("backup kept : " + result.keptBackup);
    }
  }
  return {
    payload: {
      removed: result.removed,
      restored: result.restored,
      backupPath: result.backupPath,
      drifted: result.drifted,
      keptBackup: result.keptBackup,
    },
  };
}

/**
 * Write a JSON snapshot (or a TSV/CSV table) of the translations.
 *
 * @param {string|undefined} dir
 * @param {Record<string, unknown>} flags
 * @param {{ out(line: string): void, warn(text: string): void }} sink
 */
async function commandExport(dir, flags, sink) {
  const rawOut = typeof flags.out === "string" ? flags.out : null;
  if (!rawOut) throw new CliError("E_USAGE", "export needs --out <file>");
  if (rawOut === "-") throw new CliError("E_USAGE", "export --out must be a file path, not -");
  const formatName = typeof flags.format === "string" ? flags.format.toLowerCase() : "json";
  if (formatName !== "json" && formatName !== "tsv" && formatName !== "csv") {
    throw new CliError("E_USAGE", "export supports --format json, tsv or csv, not " + formatName);
  }
  if (formatName !== "json" && flags.flat === true) {
    throw new CliError("E_USAGE", "--flat applies to --format json only");
  }
  const out = path.resolve(rawOut);
  const { project } = requireProject(dir);
  const { file, data } = requireDictionary(project);
  assertNotDictionaryTarget(out, file);
  const flat = flags.flat === true;
  let text;
  let entries;
  if (formatName === "json") {
    const document = buildExport(data, { flat });
    text = serialiseExport(document);
    entries = Object.keys(document.entries).length;
  } else {
    const rows = buildTableRows(data);
    text = serialiseTable(rows, formatName);
    entries = rows.length;
  }
  const { bytes } = writeExportFile(out, text, { force: flags.force === true });
  const warning = exportLocationWarning(project.root, out);
  if (warning) sink.warn("warning: " + sanitizeMessage(warning) + "\n");
  sink.out(
    "exported " + entries + " " + (entries === 1 ? "entry" : "entries") + " to " + out + " (" + bytes + " B)"
  );
  return { payload: { out, format: formatName, flat, entries, bytes } };
}

/**
 * Fill the dictionary from a previously exported file.
 *
 * @param {string|undefined} dir
 * @param {Record<string, unknown>} flags
 * @param {{ out(line: string): void }} sink
 */
async function commandImport(dir, flags, sink) {
  const rawFrom = typeof flags.from === "string" ? flags.from : null;
  if (!rawFrom) throw new CliError("E_USAGE", "import needs --from <file>");
  if (rawFrom === "-") throw new CliError("E_USAGE", "import --from must be a file path, not -");
  const from = path.resolve(rawFrom);
  let formatName = typeof flags.format === "string" ? flags.format.toLowerCase() : null;
  const strategy = typeof flags.strategy === "string"
    ? flags.strategy.toLowerCase()
    : "only-empty";
  if (strategy !== "only-empty" && strategy !== "overwrite") {
    throw new CliError("E_USAGE", "--strategy must be only-empty or overwrite, not " + strategy);
  }
  const dryRun = flags["dry-run"] === true;
  if (!formatName) {
    const ext = path.extname(from).toLowerCase();
    if (ext === ".tsv" || ext === ".csv" || ext === ".json" || ext === ".jsonl") {
      formatName = ext.slice(1);
    }
  }
  if (formatName !== "tsv" && formatName !== "csv" && formatName !== "json" && formatName !== "jsonl") {
    throw new CliError("E_USAGE", "import --format must be tsv, csv, json or jsonl (or a .tsv/.csv/.json/.jsonl file), not " + (formatName === null ? "(missing)" : formatName));
  }
  const { project } = requireProject(dir);
  const file = dict.dictionaryPath(project.root);
  let text;
  try {
    text = fs.readFileSync(from, "utf8");
  } catch (error) {
    throw new CliError("E_IO", "cannot read " + from + ": " + (error && error.code === "ENOENT" ? "the file does not exist" : String(error && error.code ? error.code : error)));
  }
  let rows;
  if (formatName === "jsonl") rows = parseJsonl(text);
  else if (formatName === "json") rows = parseExportEntries(text);
  else rows = parseTable(text, formatName);
  if (!fs.existsSync(file)) {
    if (flags.create !== true) {
      throw new CliError("E_NO_DICTIONARY", "no dictionary yet: " + file +
        " (pass --create to start one from this import)");
    }
    dict.saveDictionary(file, dict.emptyDictionary(project.gameTitle));
    sink.warn("created an empty dictionary: " + file);
  }
  const dictionary = dict.loadDictionary(file);
  let applied = 0;
  let skipped = 0;
  const entries = {};
  for (const row of rows) {
    if (typeof row.target !== "string" || row.target.length === 0) {
      skipped += 1;
      continue;
    }
    const existing = dictionary.entries[row.source];
    const current = existing && typeof existing.text === "string" ? existing.text : "";
    if (current.length > 0 && strategy === "only-empty") {
      skipped += 1;
      continue;
    }
    if (current === row.target) {
      skipped += 1;
      continue;
    }
    const base = existing && typeof existing === "object" ? existing : { contexts: [] };
    const contexts = Array.isArray(base.contexts) && base.contexts.length > 0
      ? base.contexts
      : Array.isArray(row.contexts) && row.contexts.length > 0
        ? row.contexts
        : [];
    entries[row.source] = { text: row.target, contexts };
    applied += 1;
  }
  if (!dryRun && applied > 0) {
    for (const [source, entry] of Object.entries(entries)) {
      dictionary.entries[source] = entry;
    }
    // reload through loadDictionary's shape so the write keeps every field
    // the loader would produce, then let saveDictionary stamp updatedAt.
    dict.saveDictionary(file, dictionary);
  }
  sink.out("from      : " + from);
  sink.out("format    : " + formatName + " (strategy " + strategy + (dryRun ? ", dry run" : "") + ")");
  sink.out("read      : " + rows.length + (rows.length === 1 ? " row" : " rows"));
  sink.out("applied   : " + applied);
  sink.out("skipped   : " + skipped);
  if (!dryRun && applied > 0) sink.out("dictionary: " + file);
  if (dryRun) sink.out("dry run: nothing written");
  return { payload: { file: from, format: formatName, strategy, dryRun, read: rows.length, applied, skipped, entries } };
}

/**
 * Start the game executable (Windows only).
 *
 * @param {string|undefined} dir
 * @param {Record<string, unknown>} flags
 * @param {{ out(line: string): void }} sink
 */
async function commandLaunch(dir, flags, sink) {
  const { project, adapter } = requireProject(dir);
  const result = await adapter.launch(project, { exe: flags.exe });
  sink.out("launched  : " + result.exe);
  sink.out("pid       : " + result.pid);
  return { payload: { root: result.root, exe: result.exe, pid: result.pid } };
}

/**
 * Check the install, the backup and the dictionary against this build.
 *
 * @param {string|undefined} dir
 * @param {Record<string, unknown>} flags
 * @param {{ out(line: string): void }} sink
 */
async function commandDoctor(dir, flags, sink) {
  const { project, adapter } = requireProject(dir);
  const file = dict.dictionaryPath(project.root);
  let data = null;
  if (fs.existsSync(file)) {
    try {
      data = dict.loadDictionary(file);
    } catch {
      data = null;
    }
  }
  // The adapter owns the engine-specific bits doctor needs: its extractor, its
  // file count and, for engines without a plugin registry, the state of the
  // delivered translation file.
  const own = typeof adapter.diagnostics === "function" ? adapter.diagnostics(project) : {};
  const result = diagnose(project, {
    dictionary: data,
    dictionaryFile: file,
    maxColumns: numberFlag(flags, "max-length", 0),
    engineLabel: adapter.name,
    profile: adapter.profile,
    extract: own.extract,
    dataFiles: own.dataFiles,
    sourceLabel: own.sourceLabel,
    // `translation` is the Ren'Py file state; `delivery` is the generic slot an
    // adapter uses when it wants to describe delivery itself (including "there
    // is no delivery layer yet"). Adapters that only set `translation` keep
    // working unchanged.
    delivery: own.delivery || own.translation || null,
  });
  const game = result.game;
  sink.out(
    "game      : " +
      (game.title || "(untitled)") +
      " (" +
      adapter.name +
      (game.engineVersion ? " " + game.engineVersion : "") +
      ", " +
      game.dataFiles +
      " " +
      (adapter.dataUnit === "scripts" ? (game.dataFiles === 1 ? "script" : "scripts") : "data files") +
      ")"
  );
  for (const check of result.checks) {
    sink.out(("  " + check.id).padEnd(14) + check.level.padEnd(6) + check.message);
    for (const sample of check.samples || []) sink.out("              - " + JSON.stringify(sample).slice(0, 70));
  }
  if (result.verdict === "broken") sink.out("verdict   : broken - " + result.failure);
  else if (result.verdict === "not-installed") sink.out("verdict   : not installed yet - run: yakusha install <game>");
  else if (result.verdict === "usable") {
    const warnings = result.checks.filter((check) => check.level === "warn").length;
    sink.out("verdict   : usable with " + warnings + " warning(s)");
  } else sink.out("verdict   : ready");
  return {
    outcome: result.verdict === "broken" ? "findings" : "ok",
    payload: {
      verdict: result.verdict,
      checks: result.checks,
      failure: result.failure,
      game: result.game,
      dictionary: result.dictionary,
      sync: result.sync,
      install: result.install,
      runtime: result.runtime,
      verify: result.verify,
    },
  };
}

const CONFIG_ACTION_NAMES = new Set(["list", "get", "set", "unset"]);
const CONFIG_KEY_NAMES = new Set(["provider", "model", "baseUrl"]);

/**
 * Reject a key the config command does not manage. apiKey is a special case
 * because the contract says it is never stored, and a generic "unknown key"
 * would hide that decision.
 *
 * @param {string} key
 */
function requireConfigKey(key) {
  if (String(key).toLowerCase() === "apikey") {
    throw new CliError(
      "E_USAGE",
      "the API key is not stored in the config file; use --api-key or YAKUSHA_API_KEY"
    );
  }
  if (!CONFIG_KEY_NAMES.has(key)) {
    throw new CliError("E_USAGE", "unknown config key: " + key + " (expected provider, model or baseUrl)");
  }
}

/** @param {{value: string|null, source: string}} entry */
function configEntryText(entry) {
  if (entry.value === null) return "(not set)";
  return entry.value + " (" + entry.source + ")";
}

/**
 * config list|get|set|unset. Unlike every other command this one takes no game
 * directory: the file belongs to the user, not to a project.
 *
 * @param {string[]} args positionals after "config"
 * @param {{ out(line: string): void, warn(text: string): void }} sink
 */
async function commandConfig(args, sink) {
  const action = args[0];
  if (!action) throw new CliError("E_USAGE", "config needs a subcommand: list, get, set or unset");
  if (!CONFIG_ACTION_NAMES.has(action)) throw new CliError("E_USAGE", "unknown config action: " + action);

  if (action === "list") {
    if (args.length > 1) throw new CliError("E_USAGE", "unexpected argument: " + args[1]);
    const loaded = loadConfig({ env: process.env });
    writeConfigWarnings(loaded.warnings, sink);
    requireUsableConfig(loaded);
    const resolved = resolveEffective(loaded, { env: process.env });
    sink.out("file    : " + loaded.file);
    sink.out("exists  : " + loaded.exists);
    sink.out("provider: " + configEntryText(resolved.provider));
    sink.out("model   : " + configEntryText(resolved.model));
    sink.out("baseUrl : " + configEntryText(resolved.baseUrl));
    sink.out("apiKey  : " + (resolved.apiKey.set ? "set (" + resolved.apiKey.source + ")" : "(not set)"));
    warnNonDefaultBaseUrl(resolved.baseUrl.value, sink);
    return {
      payload: {
        action: "list",
        file: loaded.file,
        exists: loaded.exists,
        values: {
          provider: resolved.provider,
          model: resolved.model,
          baseUrl: resolved.baseUrl,
        },
        apiKey: resolved.apiKey,
      },
    };
  }

  if (action === "get") {
    if (args.length < 2) throw new CliError("E_USAGE", "config get needs a key");
    if (args.length > 2) throw new CliError("E_USAGE", "unexpected argument: " + args[2]);
    const key = args[1];
    requireConfigKey(key);
    const loaded = loadConfig({ env: process.env });
    writeConfigWarnings(loaded.warnings, sink);
    requireUsableConfig(loaded);
    const resolved = resolveEffective(loaded, { env: process.env });
    const entry = resolved[key];
    sink.out(key.padEnd(9) + ": " + configEntryText(entry));
    return { payload: { action: "get", key, value: entry.value, source: entry.source } };
  }

  if (action === "set") {
    if (args.length < 3) throw new CliError("E_USAGE", "config set needs a key and a value");
    if (args.length > 3) throw new CliError("E_USAGE", "unexpected argument: " + args[3]);
    const key = args[1];
    requireConfigKey(key);
    const result = setConfigValue(key, args[2], { env: process.env });
    writeConfigWarnings(result.warnings, sink);
    if (result.changed) sink.out(key + " = " + result.value);
    else sink.out(key + " is already " + result.value + " (no change)");
    sink.out("file    : " + result.file);
    return { payload: { action: "set", key, value: result.value, file: result.file, changed: result.changed } };
  }

  if (args.length < 2) throw new CliError("E_USAGE", "config unset needs a key");
  if (args.length > 2) throw new CliError("E_USAGE", "unexpected argument: " + args[2]);
  const key = args[1];
  requireConfigKey(key);
  const result = unsetConfigValue(key, { env: process.env });
  writeConfigWarnings(result.warnings, sink);
  sink.out(result.changed ? key + " unset" : key + " was not set (no change)");
  sink.out("file    : " + result.file);
  return { payload: { action: "unset", key, file: result.file, changed: result.changed } };
}

/** The command table: name → handler. The CLI and the GUI dispatch through it. */
const commands = {
  scan: (dir, flags, sink) => commandScan(dir, sink),
  extract: (dir, flags, sink) => commandExtract(dir, sink),
  status: (dir, flags, sink) => commandStatus(dir, sink),
  verify: (dir, flags, sink) => commandVerify(dir, flags, sink),
  speaker: (dir, flags, sink) => commandSpeaker(dir, flags, sink),
  terms: (dir, flags, sink) => commandTerms(dir, flags, sink),
  translate: (dir, flags, sink, onProgress, opts) => commandTranslate(dir, flags, sink, onProgress, opts),
  install: (dir, flags, sink) => commandInstall(dir, flags, sink),
  uninstall: (dir, flags, sink) => commandUninstall(dir, sink),
  export: (dir, flags, sink) => commandExport(dir, flags, sink),
  import: (dir, flags, sink) => commandImport(dir, flags, sink),
  launch: (dir, flags, sink) => commandLaunch(dir, flags, sink),
  doctor: (dir, flags, sink) => commandDoctor(dir, flags, sink),
  config: (args, flags, sink) => commandConfig(args, sink),
};

/**
 * Run one command end to end: detect the project, do the work, build the
 * payload. This is the seam both front ends sit on:
 *
 * - the CLI parses argv, asserts options, calls this, prints the envelope and
 *   maps the failure to the documented exit code;
 * - the GUI calls this from the main process and renders the payload.
 *
 * @param {string} command one of the names in {@link commands}
 * @param {string[]} args positionals after the command name. Every command but
 *        config takes exactly one (the game directory); config takes the
 *        subcommand and its arguments.
 * @param {{flags?: Record<string, unknown>, sink?: {out(line: string): void, warn(text: string): void}, onProgress?: ((progress: {done: number, total: number, translated: number, rejected: number}) => void)|null, signal?: AbortSignal|null}} [opts]
 *        flags: the parsed option map. sink: where human summaries go; pass
 *        null (or omit it) to run silently. onProgress: long-run progress hook
 *        (translate only today). signal: cooperative cancellation for long runs;
 *        today only translate observes it.
 * @returns {Promise<{command: string, outcome: "ok"|"findings", payload: object}>}
 * @throws {import("./envelope.js").CliError} every failure, with the documented
 *         error code; the front end decides how to report it.
 */
export async function runCommand(command, args, opts = {}) {
  if (!Object.hasOwn(commands, command)) {
    throw new CliError("E_USAGE", "unknown command: " + command);
  }
  const flags = opts.flags || {};
  const sink = opts.sink || nullSink;
  const onProgress = opts.onProgress || null;
  const signal = opts.signal || null;
  if (command === "config") {
    const result = await commands.config(args, flags, sink);
    return finalize(command, result);
  }
  const result = await commands[command](args[0], flags, sink, onProgress, { signal });
  return finalize(command, result);
}

/** Normalize a handler result into the documented shape. */
function finalize(command, result) {
  return { command, outcome: result.outcome || "ok", payload: result.payload };
}

export { commands };
