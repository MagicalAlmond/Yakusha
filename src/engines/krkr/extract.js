/**
 * Offline extraction for Kirikiri games.
 *
 * A Kirikiri project keeps its content in .xp3 archives (the game root or its
 * data/ directory). Extraction opens every archive read-only, pulls the KAG
 * scenario files (.ks) out of the index, decodes them and collects one unit
 * per text line, exactly like the other engines: the pipeline downstream of
 * this module is engine-agnostic.
 *
 * Deliberate 0.13 boundaries, recorded in docs/engines.md:
 *
 * - only standard (unencrypted) XP3 indexes are read; anything else lands in
 *   undecodable and the walk continues;
 * - .tjs files are counted but not parsed: TJS is a programming language, so
 *   translating its strings without understanding the code is unsafe;
 * - every other file type is counted silently through the encodings tally.
 *
 * @module engines/krkr/extract
 */

import path from "node:path";

import { openKrkrProject } from "./project.js";
import { openXp3 } from "./xp3.js";
import { collectKsStrings, decodeKs } from "./ks.js";
import { readPatchManifest } from "./patch.js";

/** File extension of a stored name, lowercased without the dot. */
function extensionOf(name) {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "unknown" : name.slice(dot + 1).toLowerCase();
}

/** First line of any caught error, for the undecodable report. */
function errorLine(error) {
  const message =
    error !== null && typeof error === "object" && typeof error.message === "string" ? error.message : String(error);
  return message.split("\n")[0];
}
/**
 * Collect every string of a Kirikiri project into the shared extraction shape.
 *
 * The result mirrors src/core/extract.js field for field, so the translation
 * pipeline treats a Kirikiri project like any other engine's. `documents`
 * counts the archives read (the CLI prints a data file count and a packed
 * game has no loose files to count), `scripts` counts .ks and .tjs separately.
 *
 * One damaged archive or one undecodable index must not cost the user the
 * rest of the game, so failures land in `undecodable` and the walk continues.
 *
 * The archive Yakusha itself installed is skipped: it holds the translated
 * lines, and scanning it would feed Chinese back into the dictionary as new
 * source strings after the first install.
 *
 * @param {string} projectRoot project root, the directory holding the archives
 * @returns {{entries: Map<string, {text: string, contexts: Set<string>, locators: Set<string>, count: number}>,
 *   perFile: Record<string, number>, totalStrings: number,
 *   documents: number, scripts: {ks: number, tjs: number},
 *   undecodable: Array<{file: string, error: string}>,
 *   encodings: Record<string, number>}}
 */
export function extractKrkrProject(projectRoot) {
  const project = openKrkrProject(projectRoot);
  /** @type {Map<string, {text: string, contexts: Set<string>, locators: Set<string>, count: number}>} */
  const entries = new Map();
  /** @type {Record<string, number>} */
  const perFile = {};
  /** @type {Array<{file: string, error: string}>} */
  const undecodable = [];
  /** @type {Record<string, number>} */
  const encodings = {};
  const scripts = { ks: 0, tjs: 0 };
  let totalStrings = 0;
  let documents = 0;

  const add = (value, context, locator) => {
    if (typeof value !== "string" || value.length === 0) return;
    totalStrings += 1;
    perFile[context.split(":")[0]] = (perFile[context.split(":")[0]] || 0) + 1;
    const known = entries.get(value);
    if (known !== undefined) {
      known.count += 1;
      known.contexts.add(context);
      known.locators.add(locator);
      return;
    }
    // A KAG scenario line is addressed by archive, file and line: the archive
    // name matters because a later patch archive can override an earlier one.
    entries.set(value, { text: value, contexts: new Set([context]), locators: new Set([locator]), count: 1 });
  };

  const manifest = readPatchManifest({ root: project.root });
  const ownArchive = manifest ? manifest.archive.toLowerCase() : null;
  for (const archivePath of project.archives) {
    const archiveName = path.basename(archivePath);
    if (ownArchive !== null && archiveName.toLowerCase() === ownArchive) continue;
    let archive;
    try {
      archive = openXp3(archivePath);
    } catch (error) {
      undecodable.push({ file: archiveName, error: errorLine(error) });
      continue;
    }
    documents += 1;
    encodings.xp3 = (encodings.xp3 || 0) + 1;
    const names = archive.entries.map((entry) => entry.name).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    for (const name of names) {
      const ext = extensionOf(name);
      if (ext === "tjs") {
        scripts.tjs += 1;
        continue;
      }
      if (ext !== "ks") continue;
      scripts.ks += 1;
      const entry = archive.entry(name);
      let bytes;
      try {
        bytes = entry.read();
      } catch (error) {
        undecodable.push({ file: archiveName + ":" + name, error: errorLine(error) });
        continue;
      }
      const decoded = decodeKs(bytes);
      if (decoded.undecodable) {
        undecodable.push({ file: archiveName + ":" + name, error: decoded.error });
      }
      const { strings } = collectKsStrings(decoded.text, name);
      for (const unit of strings) {
        add(unit.text, name + ":" + unit.line, archiveName + ":" + name + ":" + unit.line);
      }
    }
  }

  return { entries, perFile, totalStrings, documents, scripts, undecodable, encodings };
}

export default { extractKrkrProject };
