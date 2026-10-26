/**
 * Offline extraction: walk every `data/*.json` file and collect the strings a
 * player can read, keyed by their exact source text.
 *
 * The key is the raw string as it appears in JSON, so the runtime plugin can
 * look translations up with a plain object index - no fuzzy matching, no
 * re-tokenising, no normalisation drift.
 *
 * @module core/extract
 */

import path from "node:path";
import { DB_FIELDS, SYSTEM_FIELDS, COMMAND_PATHS, collectAt, pickParams, walkCommands } from "./fields.js";
import { readDataDir } from "./datafile.js";

/** Files that hold nothing but records with event command lists. */
const COMMAND_ONLY_FILES = new Set(["CommonEvents.json", "Troops.json"]);

/**
 * @typedef {object} ExtractedEntry
 * @property {string} text source string
 * @property {Set<string>} contexts where it was found, e.g. "Map003.json:401"
 * @property {number} count number of occurrences
 */

/**
 * @typedef {object} ExtractionResult
 * @property {Map<string, ExtractedEntry>} entries
 * @property {Record<string, number>} perFile number of strings per file
 * @property {number} totalStrings strings seen, duplicates included
 * @property {Record<string, number>} commandCounts occurrences per command code
 * @property {string[]} undecodable files that could not be read as JSON
 * @property {Record<string, number>} encodings count of files per encoding
 */

/**
 * @typedef {object} FileMatcher
 * @property {(name: string) => boolean} matches decide whether this rule owns a file
 * @property {(data: any, name: string, add: (text: string, context: string) => void, counts: Record<string, number>) => void} collect
 *   pull every player visible string out of the parsed document
 */

/**
 * @typedef {object} ExtractPlan
 * @property {string} dataDir directory below the project root holding the data files
 * @property {FileMatcher[]} files ordered rules; the first matches() hit owns the file
 * @property {FileMatcher} [fallback] rule for files no listed rule claimed
 */

/**
 * The RPG Maker file plan: which data files exist and which fields of each hold
 * player visible text. Kept beside the other engine facts so a new engine ships
 * its own plan instead of editing this loop (docs/engines.md).
 *
 * @type {ExtractPlan}
 */
export const rmFilePlan = {
  dataDir: "data",
  files: [
    {
      matches: (name) => name === "System.json",
      collect: (data, name, add) => {
        for (const field of SYSTEM_FIELDS) {
          for (const value of collectAt(data, field)) add(value, name + ":" + field);
        }
      },
    },
    {
      matches: (name) => name === "MapInfos.json",
      collect: (data, name, add) => {
        if (Array.isArray(data)) {
          for (const info of data) {
            if (info && typeof info.name === "string") add(info.name, name + ":name");
          }
        }
      },
    },
    {
      matches: (name) => /^Map\d+\.json$/i.test(name),
      collect: (data, name, add, counts) => {
        if (data && typeof data.displayName === "string") add(data.displayName, name + ":displayName");
        extractCommands(data, name, add, counts);
      },
    },
    {
      matches: (name) => COMMAND_ONLY_FILES.has(name),
      // CommonEvents entries also carry a name; both surfaces are translated by
      // the runtime plugin, so both are extracted here.
      collect: (data, name, add, counts) => {
        const fields = DB_FIELDS[name];
        if (fields && Array.isArray(data)) {
          for (const record of data) {
            if (!record || typeof record !== "object") continue;
            for (const field of fields) {
              if (typeof record[field] === "string") add(record[field], name + ":" + field);
            }
          }
        }
        extractCommands(data, name, add, counts);
      },
    },
  ],
  fallback: {
    matches: () => true,
    collect: (data, name, add) => {
      const fields = DB_FIELDS[name];
      if (fields && Array.isArray(data)) {
        for (const record of data) {
          if (!record || typeof record !== "object") continue;
          for (const field of fields) {
            const value = record[field];
            if (typeof value === "string") add(value, name + ":" + field);
          }
        }
      }
    },
  },
};
/**
 * Collect every player visible string of a project.
 *
 * @param {string} projectRoot directory containing data/
 * @param {ExtractPlan} [plan] engine file plan; defaults to the RPG Maker plan
 * @returns {ExtractionResult}
 */
export function extractProject(projectRoot, plan) {
  const enginePlan = plan || rmFilePlan;
  /** @type {ExtractionResult} */
  const result = { entries: new Map(), perFile: {}, totalStrings: 0, commandCounts: {}, undecodable: [], encodings: {} };
  const dataDir = path.join(projectRoot, enginePlan.dataDir);

  const add = (text, context) => {
    if (typeof text !== "string" || text.length === 0) return;
    result.totalStrings += 1;
    const existing = result.entries.get(text);
    if (existing) {
      existing.count += 1;
      existing.contexts.add(context);
      return;
    }
    result.entries.set(text, { text, contexts: new Set([context]), count: 1 });
  };

  for (const file of readDataDir(dataDir)) {
    result.encodings[file.encoding] = (result.encodings[file.encoding] || 0) + 1;
    if (file.data === null) {
      // A zero byte placeholder holds no text at all; only a file that really
      // has content we cannot read is worth reporting to the user.
      if (file.encoding !== "empty") result.undecodable.push(file.name);
      continue;
    }
    const name = file.name;
    const data = file.data;
    const before = result.totalStrings;

    // The first matching rule owns the file; the plan's fallback catches the
    // ordinary database files. A different engine swaps the plan, not this loop.
    const rule = enginePlan.files.find((candidate) => candidate.matches(name)) || enginePlan.fallback;
    if (rule) rule.collect(data, name, add, result.commandCounts);

    const strings = result.totalStrings - before;
    if (strings > 0) result.perFile[name] = strings;
  }

  return result;
}

/**
 * @param {string} dataDir
 * @returns {string[]}
 */
export function listJsonFiles(dataDir) {
  let entries;
  try {
    entries = readDataDir(dataDir);
  } catch {
    return [];
  }
  return entries.map((entry) => entry.name);
}

/**
 * Collect the player visible text of every event command in a file.
 *
 * Maps keep commands under `events[].pages[].list`, common events under
 * `[].list` and troops under `[].pages[].list`; walking the whole document
 * covers all three without hard coding each shape.
 *
 * @param {any} data parsed JSON document
 * @param {string} name file name, used to build contexts
 * @param {(text: string, context: string) => void} add
 * @param {Record<string, number>} counts
 */
function extractCommands(data, name, add, counts) {
  walkCommands(data, ({ code, params }) => {
    counts[code] = (counts[code] || 0) + 1;
    const spec = COMMAND_PATHS[String(code)];
    if (!spec) return;
    for (const value of pickParams(params, spec)) add(value, name + ":" + code);
  });
}

/**
 * Convert an {@link ExtractionResult} into a plain sorted array, for stable
 * dictionary output and reproducible diffs.
 *
 * @param {ExtractionResult} result
 * @returns {Array<{ text: string, contexts: string[], count: number }>}
 */
export function toSortedArray(result) {
  return [...result.entries.values()]
    .map((entry) => ({ text: entry.text, contexts: [...entry.contexts].sort(), count: entry.count }))
    .sort((a, b) => b.count - a.count || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0));
}
