/**
 * Offline extraction for RGSS games: RPG Maker XP, VX and VX Ace.
 *
 * RGSS games keep their data in Ruby Marshal files (Data/*.rxdata, *.rvdata,
 * *.rvdata2) either on disk or inside one RGSSAD/RGSS2A/RGSS3A archive. Both
 * layouts are read through the same handle (project.js openDataSource), so this
 * module never branches on where the bytes live.
 *
 * Two behaviours differ from the RPG Maker MZ extractor on purpose:
 *
 * - the database files hold Ruby objects with at-sign instance variables, so a
 *   field is addressed as "@name" rather than "name";
 * - event commands use @code / @parameters instead of code / parameters.
 *
 * Only the positions a player can actually read are collected. Measured against
 * a real RGSS3 game: 401 and 405 carry dialogue, 102 carries the choice labels,
 * 101 carries the speaker name (almost always empty) and 320 renames an actor.
 * Comments (108/408), script lines (355/655), file names (231/322) and script
 * operands (111/118/119/122/123/283/284) are deliberately skipped: translating
 * them either does nothing or breaks the game.
 *
 * @module engines/rgss/extract
 */

import { findArchive } from "./archive.js";
import { openDataSource } from "./project.js";
import { ivarsOf, isObject, isString, text, unmarshal } from "./marshal.js";

/**
 * Text fields of each database document, keyed by file base name.
 *
 * The extension varies by engine version (Actors.rxdata on XP, Actors.rvdata2 on
 * VX Ace), so documents are matched by base name only.
 *
 * Note what is missing: @note is a script metadata channel (custom icon tags and
 * the like) and every @*_name field holds a graphics or audio file name. Neither
 * may be translated.
 *
 * @type {Record<string, string[]>}
 */
export const RGSS_DB_FIELDS = {
  Actors: ["name", "description", "nickname"],
  Classes: ["name", "description"],
  Skills: ["name", "description", "message1", "message2"],
  Items: ["name", "description"],
  Weapons: ["name", "description"],
  Armors: ["name", "description"],
  Enemies: ["name", "description"],
  States: ["name", "message1", "message2", "message3", "message4"],
  Tilesets: ["name"],
  CommonEvents: ["name"],
};

/** Documents that hold nothing but records with event command lists. */
export const RGSS_COMMAND_ONLY = new Set(["Troops"]);

/** System fields a player can read (the other string fields are asset names). */
export const SYSTEM_TEXT_FIELDS = ["@game_title", "@currency_unit"];

/** The four term lists of RPG::System::Terms, in display order. */
export const TERM_FIELDS = ["@basic", "@params", "@etypes", "@commands"];

/**
 * Event command codes that carry player visible text and the @parameters slot it
 * lives in. "0" means parameters[0]; "0[]" means every element of parameters[0].
 *
 * 101 Show Text         header, parameters[0] is the speaker name
 * 102 Show Choices      parameters[0] is the array of choice labels
 * 320 Change Actor Name parameters[1]
 * 401 Show Text         one line of dialogue, parameters[0]
 * 405 Scroll Text       one continuation line, parameters[0]
 *
 * 402 (the per-choice branch marker) is skipped: its text is the same string the
 * matching 102 already contributed, so collecting it would add a context without
 * adding a translation.
 *
 * @type {ReadonlyArray<{ code: number, path: string }>}
 */
export const COMMAND_TEXT = [
  { code: 101, path: "0" },
  { code: 102, path: "0[]" },
  { code: 320, path: "1" },
  { code: 401, path: "0" },
  { code: 405, path: "0" },
];

/** "101": "0", ... for fast lookup while walking a command list. */
export const COMMAND_PATHS = Object.fromEntries(COMMAND_TEXT.map((rule) => [String(rule.code), rule.path]));

/** Set of codes that carry text, for fast rejection. */
export const TEXT_CODES = new Set(COMMAND_TEXT.map((rule) => rule.code));

/**
 * Read the translatable strings one command carries.
 *
 * @param {any[]} parameters the @parameters array of a command
 * @param {string} spec "0" or "0[]"
 * @returns {any[]} Marshal string nodes, in parameter order
 */
export function pickParams(parameters, spec) {
  if (!Array.isArray(parameters)) return [];
  if (spec.endsWith("[]")) {
    const value = parameters[Number(spec.slice(0, -2))];
    if (!Array.isArray(value)) return [];
    return value.filter((item) => isString(item));
  }
  const value = parameters[Number(spec)];
  return isString(value) ? [value] : [];
}

/**
 * Walk every event command of a document.
 *
 * A command is an object whose @code is a number; its parameters hang off
 * @parameters. The walk descends through arrays, Ruby hashes and object instance
 * variables, so it finds the command lists of maps (events -> pages -> list),
 * common events and troops without hard coding those shapes.
 *
 * @param {unknown} node any value of a Marshal document
 * @param {(parameters: any[], code: number) => void} visit
 */
export function walkCommands(node, visit) {
  if (Array.isArray(node)) {
    for (const item of node) walkCommands(item, visit);
    return;
  }
  if (node instanceof Map) {
    for (const item of node.values()) walkCommands(item, visit);
    return;
  }
  if (!isObject(node)) return;
  const ivars = ivarsOf(node);
  if (!ivars) return;
  const code = ivars["@code"];
  if (typeof code === "number") {
    const parameters = ivars["@parameters"];
    if (Array.isArray(parameters)) visit(parameters, code);
    // A command's parameters never hold another command list, so the walk stops.
    return;
  }
  for (const key of Object.keys(ivars)) walkCommands(ivars[key], visit);
}

/**
 * Base name of a data file, without its extension.
 *
 * @param {string} name file name as the data source reports it, e.g. "Map003.rvdata2"
 * @returns {string}
 */
export function baseName(name) {
  const slash = name.lastIndexOf("/");
  const base = slash === -1 ? name : name.slice(slash + 1);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? base : base.slice(0, dot);
}

/**
 * Whether a data file is one of the map documents.
 *
 * @param {string} base base name of the file
 * @returns {boolean}
 */
export function isMapName(base) {
  return /^Map\d+$/i.test(base);
}

/**
 * Build one context key the way the rest of the pipeline does.
 *
 * @param {string} file data file name
 * @param {string} where command code or field name
 * @returns {string} "<file>:<where>"
 */
function contextOf(file, where) {
  return file + ":" + where;
}

/**
 * Collect a database document: one string field per record.
 *
 * @param {unknown} document parsed Marshal document
 * @param {string} file data file name, used for contexts
 * @param {string[]} fields instance variable names without the at-sign
 * @param {(value: string, context: string) => void} add
 */
function collectFields(document, file, fields, add) {
  if (!Array.isArray(document)) return;
  for (const record of document) {
    const ivars = ivarsOf(record);
    if (!ivars) continue;
    for (const field of fields) {
      const value = ivars["@" + field];
      if (!isString(value)) continue;
      add(text(value), contextOf(file, field));
    }
  }
}

/**
 * Collect every player visible string of one command list document.
 *
 * @param {unknown} document parsed Marshal document
 * @param {string} file data file name
 * @param {(value: string, context: string) => void} add
 * @param {Record<string, number>} counts occurrences per command code
 */
function collectCommands(document, file, add, counts) {
  walkCommands(document, (parameters, code) => {
    counts[code] = (counts[code] || 0) + 1;
    const spec = COMMAND_PATHS[String(code)];
    if (spec === undefined) return;
    for (const node of pickParams(parameters, spec)) add(text(node), contextOf(file, String(code)));
  });
}

/**
 * Collect the readable strings of RPG::System.
 *
 * The title and the currency unit are plain text; the four term lists are what
 * the menus print ("Level", "Attack", "New Game"). @title1_name and friends are
 * picture names and stay untouched.
 *
 * @param {unknown} document parsed RPG::System
 * @param {string} file data file name
 * @param {(value: string, context: string) => void} add
 */
function collectSystem(document, file, add) {
  const ivars = ivarsOf(document);
  if (!ivars) return;
  for (const field of SYSTEM_TEXT_FIELDS) {
    const value = ivars[field];
    if (!isString(value)) continue;
    add(text(value), contextOf(file, field.slice(1)));
  }
  const termIvars = ivarsOf(ivars["@terms"]);
  if (!termIvars) return;
  for (const field of TERM_FIELDS) {
    const list = termIvars[field];
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      if (!isString(entry)) continue;
      // Term lists pad themselves with empty strings (an unused slot prints
      // nothing), so an empty entry is a slot, not a text worth a dictionary key.
      add(text(entry), contextOf(file, "terms." + field.slice(1)));
    }
  }
}

/**
 * Collect the map name table.
 *
 * @param {unknown} document parsed MapInfos document, a Ruby Hash of id -> info
 * @param {string} file data file name
 * @param {(value: string, context: string) => void} add
 */
function collectMapInfos(document, file, add) {
  const records = [];
  if (document instanceof Map) {
    for (const value of document.values()) records.push(value);
  } else if (Array.isArray(document)) {
    records.push(...document);
  }
  for (const record of records) {
    const ivars = ivarsOf(record);
    if (!ivars) continue;
    const value = ivars["@name"];
    if (!isString(value)) continue;
    add(text(value), contextOf(file, "name"));
  }
}

/**
 * Reduce a thrown value to a single line.
 *
 * The undecodable report is rendered as a table row, so a message spanning lines
 * would break the columns.
 *
 * @param {unknown} error caught value
 * @returns {string}
 */
function errorLine(error) {
  const message =
    error !== null && typeof error === "object" && typeof error.message === "string" ? error.message : String(error);
  return message.split("\n")[0];
}

/**
 * Read and decode one data file.
 *
 * @param {{ read: (name: string) => Buffer|null }} source open data source
 * @param {string} name data file name
 * @returns {{ok: true, value: unknown}|{ok: false, error: string}} the decoded
 *   document, or a one line reason
 */
function readDocument(source, name) {
  let buffer = null;
  try {
    buffer = source.read(name);
  } catch (error) {
    return { ok: false, error: errorLine(error) };
  }
  if (buffer === null) return { ok: false, error: "the data source does not hold this file" };
  try {
    return { ok: true, value: unmarshal(buffer).value };
  } catch (error) {
    return { ok: false, error: errorLine(error) };
  }
}

/**
 * Extension of a data file, without the dot.
 *
 * @param {string} name data file name
 * @returns {string}
 */
function sourceExtension(name) {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "unknown" : name.slice(dot + 1).toLowerCase();
}

/**
 * Collect every string of an RGSS project into the shared extraction shape.
 *
 * The result mirrors src/core/extract.js field for field, so the translation
 * pipeline treats an RGSS project like any other engine's. On top of that it
 * reports \`documents\` - how many data files were read - because the CLI prints a
 * data file count and a packed game has no files on disk to count.
 *
 * A data file that cannot be decoded lands in \`undecodable\` and the walk
 * continues: one damaged map must not cost the user the rest of the game.
 *
 * @param {string} projectRoot project root, the directory holding Game.ini
 * @returns {{entries: Map<string, {text: string, contexts: Set<string>, count: number}>,
 *   perFile: Record<string, number>, totalStrings: number,
 *   commandCounts: Record<string, number>,
 *   undecodable: Array<{file: string, error: string}>,
 *   encodings: Record<string, number>, documents: number}}
 */
export function extractRgssProject(projectRoot) {
  const source = openDataSource({ root: projectRoot, archive: findProjectArchive(projectRoot) });
  /** @type {Map<string, {text: string, contexts: Set<string>, count: number}>} */
  const entries = new Map();
  /** @type {Record<string, number>} */
  const perFile = {};
  /** @type {Record<string, number>} */
  const commandCounts = {};
  /** @type {Array<{file: string, error: string}>} */
  const undecodable = [];
  /** @type {Record<string, number>} */
  const encodings = {};
  let totalStrings = 0;
  let documents = 0;
  let currentFile = "";

  const add = (value, context) => {
    if (typeof value !== "string" || value.length === 0) return;
    totalStrings += 1;
    perFile[currentFile] = (perFile[currentFile] || 0) + 1;
    const known = entries.get(value);
    if (known !== undefined) {
      known.count += 1;
      known.contexts.add(context);
      return;
    }
    entries.set(value, { text: value, contexts: new Set([context]), count: 1 });
  };

  try {
    // Sorted so an unpacked game and the same game packed into an archive
    // produce the same order: a directory listing and an archive directory are
    // both unordered, and the dictionary keeps its insertion order.
    for (const name of source.names().slice().sort()) {
      const base = baseName(name);
      const fields = RGSS_DB_FIELDS[base] || null;
      const commands = isMapName(base) || RGSS_COMMAND_ONLY.has(base) || base === "CommonEvents";
      const special = base === "System" || base === "MapInfos";
      if (fields === null && !commands && !special) continue;

      currentFile = name;
      const read = readDocument(source, name);
      if (!read.ok) {
        undecodable.push({ file: name, error: read.error });
        continue;
      }
      documents += 1;
      const encoding = source.kind === "archive" ? "marshal" : sourceExtension(name);
      encodings[encoding] = (encodings[encoding] || 0) + 1;

      if (base === "System") collectSystem(read.value, name, add);
      else if (base === "MapInfos") collectMapInfos(read.value, name, add);
      else {
        if (fields !== null) collectFields(read.value, name, fields, add);
        if (commands) collectCommands(read.value, name, add, commandCounts);
      }
    }
  } finally {
    source.close();
  }

  return { entries, perFile, totalStrings, commandCounts, undecodable, encodings, documents };
}

/**
 * The archive of a project, if it has one.
 *
 * A packed game has no Data directory, so the archive is the only data source.
 * A broken archive must not abort extraction before the caller can report it -
 * openDataSource raises a readable error when it gets the path.
 *
 * @param {string} projectRoot
 * @returns {string|null}
 */
function findProjectArchive(projectRoot) {
  try {
    return findArchive(projectRoot);
  } catch {
    return null;
  }
}

export default { extractRgssProject, walkCommands, pickParams, baseName, isMapName, RGSS_DB_FIELDS };
