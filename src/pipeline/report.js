/**
 * Markdown rendering of a verify result.
 *
 * verify prints to a terminal, which is fine while working and useless the
 * moment somebody else has to look at the findings. A report file can be
 * attached to an issue, diffed between releases, or read by a reviewer who does
 * not have the game.
 *
 * The report is deliberately self-contained: counts, one section per problem
 * kind, every finding with its source and translation, and a "names to fill in"
 * block for speaker names the dictionary cannot repair by itself. Nothing here
 * is recomputed - it is the same VerifyResult, only formatted.
 *
 * @module pipeline/report
 */

import { buildSpeakerIndex, houseOf } from "./speaker.js";

/** Kana, i.e. evidence that a name was still Japanese. */
const KANA = /[\u3041-\u3096\u30a1-\u30fa]/;

/**
 * One line per kind: what the finding means and what actually fixes it.
 *
 * The wording is the "why", not a restatement of the detail: a reviewer reading
 * the report should be able to decide whether a finding blocks a release.
 */
const KIND_HINTS = {
  echo: "the translation is the Japanese source unchanged; retranslating the same line will not help, translate it by hand",
  codes: "escape codes must match the source exactly, otherwise the game prints or colours the wrong thing",
  slots: "%1 %2 placeholders are filled in by the engine; a different sequence shows the wrong actor or item",
  kana: "kana the player will see; onomatopoeia often keeps one on purpose",
  lines: "line breaks differ from the source; --max-length rewrites breaks on purpose",
  width: "wider than --max-length; the message window clips without warning",
  "no-text": "the source had Han characters and the translation has none, so a word may have been dropped",
  trad: "traditional characters the source never used; the model slipped into traditional Chinese",
  speaker: "a speaker name is still Japanese, or the same name is written two ways",
  rejected: "the pipeline gave up on this line; the player sees the Japanese original",
};

/** Kinds whose findings block a release. */
const BLOCKING = new Set(["echo", "codes", "slots", "speaker"]);

/**
 * Wrap a string in a code span that survives backticks.
 *
 * Line breaks become a visible marker: a multi-line dialogue bubble would
 * otherwise be indistinguishable from two separate findings, and a markdown
 * code span silently swallows a newline anyway.
 *
 * @param {string} text
 * @returns {string}
 */
export function codeSpan(text) {
  const value = String(text === undefined || text === null ? "" : text)
    .replace(/\r\n?/g, "\n")
    .replace(/\n/g, "\u23ce");
  if (value.length === 0) return "";
  const runs = value.match(/`+/g) || [];
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
  const fence = "`".repeat(longest + 1);
  const pad = value.startsWith("`") || value.endsWith("`") ? " " : "";
  return fence + pad + value + pad + fence;
}

/**
 * Distinct speaker names that no line of this dictionary translates.
 *
 * The mechanical repair copies the rendering another line already uses, so a
 * name every line leaves in Japanese has nothing to copy. Those are the only
 * findings that need a human: one line of JSON each.
 *
 * @param {import("./verify.js").VerifyResult} result
 * @param {{entries: Record<string, any>}} dictionary
 * @returns {Array<{name: string, count: number}>}
 */
export function namesNeedingInput(result, dictionary) {
  const index = buildSpeakerIndex(dictionary);
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const problem of result.problems) {
    if (problem.kind !== "speaker" || problem.severity !== "error" || !problem.name) continue;
    const house = houseOf(index, problem.name);
    // Any usable rendering means "speaker" can fix it without asking anybody.
    const repairable = house.translated && house.house && house.house !== problem.name && !KANA.test(house.house);
    if (repairable) continue;
    counts.set(problem.name, (counts.get(problem.name) || 0) + 1);
  }
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

/**
 * @typedef {object} ReportOptions
 * @property {string} [game] game title for the header
 * @property {string} [file] dictionary path for the header
 * @property {string} [root] game directory, so the next-step command can be copied
 * @property {number} [maxColumns]
 * @property {string} [generatedAt] ISO timestamp (injectable for tests)
 * @property {{entries: Record<string, any>}} [dictionary] needed for the names block
 */

/**
 * Render one verify result as markdown.
 *
 * @param {import("./verify.js").VerifyResult} result
 * @param {ReportOptions} [options]
 * @returns {string}
 */
export function buildReport(result, options = {}) {
  const at = options.generatedAt || new Date().toISOString();
  const maxColumns = options.maxColumns || 0;
  const lines = [];

  lines.push("# yakusha verify report");
  lines.push("");
  lines.push("| field | value |");
  lines.push("| --- | --- |");
  lines.push("| game | " + (options.game || "(untitled)") + " |");
  if (options.file) lines.push("| dictionary | " + codeSpan(options.file) + " |");
  lines.push("| generated | " + at + " |");
  lines.push("| max-length | " + (maxColumns > 0 ? maxColumns + " columns" : "0 (width check off)") + " |");
  lines.push(
    "| entries | " +
      result.total +
      " (" +
      result.translated +
      " translated, " +
      result.pending +
      " pending, " +
      result.rejected +
      " rejected) |"
  );
  lines.push("| problems | " + result.problems.length + " (" + result.errors + " errors, " + result.warnings + " warnings) |");
  lines.push("");
  const verdict =
    result.errors > 0
      ? "**FAILED: " + result.errors + " error(s)** - these are visible defects, fix them before shipping."
      : result.warnings > 0
        ? "**OK with " + result.warnings + " warning(s)** - nothing blocks a release."
        : "**OK** - no findings at all.";
  lines.push(verdict);
  lines.push("");

  const kinds = Object.keys(result.counts).sort((a, b) => {
    const sev = Number(BLOCKING.has(b)) - Number(BLOCKING.has(a));
    if (sev !== 0) return sev;
    return result.counts[b] - result.counts[a] || (a < b ? -1 : 1);
  });

  for (const kind of kinds) {
    const findings = result.problems.filter((problem) => problem.kind === kind);
    const errors = findings.filter((problem) => problem.severity === "error").length;
    const title = kind + " (" + findings.length + (errors > 0 ? ", " + errors + " error" + (errors === 1 ? "" : "s") : "") + ")";
    lines.push("## " + title);
    lines.push("");
    if (KIND_HINTS[kind]) {
      lines.push("_" + KIND_HINTS[kind] + "_");
      lines.push("");
    }
    let index = 0;
    for (const problem of findings) {
      index += 1;
      const severity = problem.severity === "error" ? "**error**" : "warning";
      const arrow = problem.target ? " -> " + codeSpan(problem.target) : "";
      lines.push(index + ". " + severity + ": " + codeSpan(problem.key) + arrow);
      // The detail carries the specifics (which name, which code, how wide), so
      // it stays even when the section already explains the kind.
      if (problem.detail) lines.push("   " + problem.detail);
    }
    lines.push("");
  }

  if (options.dictionary) {
    const names = namesNeedingInput(result, options.dictionary);
    if (names.length > 0) {
      const template = { entries: {} };
      for (const entry of names) template.entries[entry.name] = "";
      lines.push("## speaker names with no rendering anywhere (" + names.length + ")");
      lines.push("");
      lines.push(
        "Every line keeps these names in Japanese, so there is nothing to copy. Fill in the ones you want and run:"
      );
      lines.push("");
      const target = options.root ? '"' + options.root + '"' : "<game-dir>";
      lines.push("    yakusha speaker " + target + " --names names.json");
      lines.push("");
      lines.push("Lines using each name:");
      lines.push("");
      for (const entry of names) lines.push("- " + codeSpan(entry.name) + " (" + entry.count + ")");
      lines.push("");
      lines.push('    ' + JSON.stringify(template, null, 2).replace(/\n/g, "\n    "));
      lines.push("");
    }
  }

  return lines.join("\n").replace(/\n+$/, "\n");
}
