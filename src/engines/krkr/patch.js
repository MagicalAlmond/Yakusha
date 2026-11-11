/**
 * Kirikiri delivery: a patch archive with translated KAG scripts.
 *
 * A Kirikiri game ships its scenario files inside .xp3 archives. The engine
 * loads `data.xp3`, then `patch.xp3`, then `patch2.xp3` and so on, each later
 * archive overriding same-named files from the earlier ones. Yakusha uses that
 * existing mechanism: it never edits the game's own archives. Instead it writes
 * one new archive (next to the game's data) containing only the .ks files whose
 * visible lines have translations, and records what it wrote in
 * `yakusha/krkr-patch.json`. Uninstall deletes only that archive and manifest.
 *
 * The archive contains complete .ks files rather than a side-car dictionary:
 * KAG has no translation lookup table, so replacing the script text is the
 * delivery. Lines are matched by the locator captured at extraction time
 * (`archive.xp3:path/file.ks:line`) and the source text is verified before a
 * line is changed, so a stale dictionary cannot silently overwrite a different
 * line after a game update.
 *
 * @module engines/krkr/patch
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

import { writeBytesAtomic, writeFileAtomic } from "../../core/atomic.js";
import { dictionaryPath, loadDictionary } from "../../core/dict.js";
import { assertInsideRoot } from "../../core/paths.js";
import { collectKsStrings, decodeKs, stripInlineTags } from "./ks.js";
import { openXp3 } from "./xp3.js";
import { buildXp3 } from "./xp3writer.js";

/** Directory holding the manifest, under the game root. */
export const PATCH_DIR = "yakusha";

/** Manifest file name, next to the dictionary. */
export const PATCH_MANIFEST = "krkr-patch.json";

/** The only archive names Yakusha creates. */
const PATCH_NAME = /^patch(\d*)\.xp3$/i;

/**
 * Error carrying an envelope code.
 *
 * @param {"E_NO_DICTIONARY"|"E_IO"|"E_USAGE"} code
 * @param {string} message one line
 * @returns {Error}
 */
function coded(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/** Hash bytes with SHA-256. @param {Buffer} bytes @returns {string} */
function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Manifest path for a project.
 * @param {{ root: string }} project
 * @returns {string}
 */
export function manifestPath(project) {
  return path.join(project.root, PATCH_DIR, PATCH_MANIFEST);
}

/**
 * Read the manifest, or null when there is none / it is not usable.
 *
 * Extraction calls this to skip the archive Yakusha itself installed; a
 * malformed manifest must not make scanning fail. Doctor uses
 * {@link patchStatus} when it needs to report the damage.
 *
 * @param {{ root: string }} project
 * @returns {{ schema: number, engine: string, archive: string, entries: number, files?: string[], dictionaryHash?: string, archiveHash?: string }|null}
 */
export function readPatchManifest(project) {
  let raw;
  try {
    raw = fs.readFileSync(manifestPath(project), "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || parsed.schema !== 1) return null;
    if (typeof parsed.archive !== "string" || !PATCH_NAME.test(parsed.archive)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * True when a string looks like a locator recorded by the Kirikiri extractor.
 * New dictionaries use `archive.xp3:file.ks:line`; older ones used
 * `file.ks:line`, which is still accepted.
 *
 * @param {string} locator
 * @returns {{ archive: string|null, name: string, line: number }|null}
 */
function parseLocator(locator) {
  if (typeof locator !== "string") return null;
  let match = /^([^:]+\.xp3):(.+\.ks):(\d+)$/i.exec(locator);
  if (match) return { archive: match[1], name: match[2], line: Number(match[3]) };
  match = /^(.+\.ks):(\d+)$/i.exec(locator);
  if (match) return { archive: null, name: match[1], line: Number(match[2]) };
  return null;
}

/**
 * The translation pairs that belong to Kirikiri.
 *
 * Entries written by 0.17+ say `engine: "krkr"`; older dictionaries only have
 * a locator/context ending in `.ks:<line>`, so that shape is accepted too. A
 * dictionary shared by several games can therefore be installed into the
 * right game without another engine's strings leaking into the patch.
 *
 * @param {object} dict loaded dictionary
 * @returns {Array<{ source: string, target: string, locators: string[] }>}
 */
function krkrPairs(dict) {
  const pairs = [];
  for (const [source, entry] of Object.entries(dict.entries || {})) {
    if (!entry || typeof entry.text !== "string" || entry.text.length === 0) continue;
    if (typeof entry.engine === "string" && entry.engine.length > 0 && entry.engine !== "krkr") continue;
    const locations = [
      ...(Array.isArray(entry.locator) ? entry.locator : []),
      ...(Array.isArray(entry.contexts) ? entry.contexts : []),
    ];
    const looksKirikiri = typeof entry.engine === "string"
      ? entry.engine === "krkr"
      : locations.some((item) => /\.ks:\d+$/i.test(item));
    if (!looksKirikiri) continue;
    pairs.push({ source, target: entry.text, locators: locations });
  }
  return pairs;
}

/**
 * Stable hash of the pairs install would deliver. Doctor compares this with
 * the hash recorded in the manifest to answer "has the dictionary changed
 * since install?" without re-reading every archive.
 *
 * @param {Array<{source: string, target: string}>} pairs
 * @returns {string}
 */
function dictionaryHash(pairs) {
  const ordered = pairs
    .map((pair) => ({ source: pair.source, target: pair.target }))
    .sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));
  return sha256(Buffer.from(JSON.stringify(ordered), "utf8"));
}

/** Priority of one archive name: patch2 overrides patch over data. */
function archiveRank(name) {
  const match = PATCH_NAME.exec(name);
  if (!match) return 0;
  if (match[1] === "") return 1;
  return Number(match[1]) + 1;
}

/**
 * All `.ks` entries in the project, keyed by their stored name. When two
 * archives carry the same name, the one the engine loads last wins.
 *
 * @param {{ archives: string[], root: string, dataDir: string }} project
 * @param {string|null} skipArchive our own installed archive, which must not
 *   be used as source (its lines are already translated)
 * @returns {{ files: Map<string, {archiveName: string, archivePath: string}>, undecodable: string[] }}
 */
function collectKsFiles(project, skipArchive) {
  const files = new Map();
  const undecodable = [];
  const ordered = [...project.archives].sort((a, b) => {
    const left = archiveRank(path.basename(a));
    const right = archiveRank(path.basename(b));
    if (left !== right) return left - right;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  for (const archivePath of ordered) {
    const archiveName = path.basename(archivePath);
    if (skipArchive && archiveName.toLowerCase() === String(skipArchive).toLowerCase()) continue;
    let archive;
    try {
      archive = openXp3(archivePath);
    } catch (error) {
      undecodable.push(archiveName + ": " + (error && error.message ? error.message : String(error)));
      continue;
    }
    for (const entry of archive.entries) {
      if (!entry.name.toLowerCase().endsWith(".ks")) continue;
      const previous = files.get(entry.name);
      if (!previous || archiveRank(archiveName) >= archiveRank(previous.archiveName)) {
        files.set(entry.name, { archiveName, archivePath });
      }
    }
  }
  return { files, undecodable };
}

/**
 * Split a line into the ranges that are visible text (outside [tags]).
 *
 * @param {string} line
 * @returns {Array<{start: number, end: number}>}
 */
function visibleSegments(line) {
  const segments = [];
  let start = 0;
  let i = 0;
  while (i < line.length) {
    if (line[i] !== "[") {
      i += 1;
      continue;
    }
    let end = -1;
    let quote = null;
    for (let j = i + 1; j < line.length; j += 1) {
      const ch = line[j];
      if (quote !== null) {
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        continue;
      }
      if (ch === "]") {
        end = j;
        break;
      }
    }
    if (end === -1) break;
    if (start < i) segments.push({ start, end: i });
    i = end + 1;
    start = i;
  }
  if (start < line.length) segments.push({ start, end: line.length });
  return segments;
}

/**
 * Replace the visible text of one KAG line while keeping its inline tags.
 *
 * A line may have text on both sides of a tag (for example
 * `[b]Hello[/b]`). The first visible run receives the translation and any
 * later visible run is cleared to whitespace; the tag sequence itself is kept,
 * which is what KAG's own macro-quoted lines need. A line with no visible text
 * returns null and is never counted as changed.
 *
 * @param {string} line raw .ks line
 * @param {string} target translated text
 * @returns {string|null}
 */
function replaceVisibleText(line, target) {
  const segments = visibleSegments(line);
  if (segments.length === 0) return null;
  let out = "";
  let cursor = 0;
  let replaced = false;
  for (const segment of segments) {
    out += line.slice(cursor, segment.start);
    const raw = line.slice(segment.start, segment.end);
    const text = raw.trim();
    if (text === "") {
      out += raw;
    } else {
      const lead = raw.slice(0, raw.indexOf(text));
      const trail = raw.slice(raw.indexOf(text) + text.length);
      if (!replaced) {
        out += lead + target + trail;
        replaced = true;
      } else {
        out += lead.replace(/\S/g, " ") + trail.replace(/\S/g, " ");
      }
    }
    cursor = segment.end;
  }
  out += line.slice(cursor);
  return replaced ? out : null;
}

/**
 * Encode rewritten text in a form KAG accepts. Existing UTF-16 files keep
 * their byte order; Shift_JIS/UTF-8 files are written as UTF-8 with a BOM,
 * which is the form used by the retail Kirikiri patches that carry Chinese.
 *
 * @param {string} text
 * @param {"utf-8"|"utf-16le"|"utf-16be"|"shift_jis"} encoding
 * @returns {Buffer}
 */
function encodeKs(text, encoding) {
  if (encoding === "utf-16le") {
    return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
  }
  if (encoding === "utf-16be") {
    const le = Buffer.from(text, "utf16le");
    const be = Buffer.alloc(le.length);
    for (let i = 0; i + 1 < le.length; i += 2) {
      be[i] = le[i + 1];
      be[i + 1] = le[i];
    }
    return Buffer.concat([Buffer.from([0xfe, 0xff]), be]);
  }
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, "utf8")]);
}

/**
 * Choose the archive Yakusha should own. An existing manifest means its
 * archive is ours; otherwise the first free patch name is used, so a patch
 * the game or another tool already ships is never overwritten.
 *
 * @param {{ dataDir: string }} project
 * @param {object|null} manifest
 * @returns {{ name: string, path: string, created: boolean }}
 */
function chooseArchive(project, manifest) {
  if (manifest && PATCH_NAME.test(manifest.archive)) {
    const target = path.join(project.dataDir, manifest.archive);
    if (path.resolve(path.dirname(target)) === path.resolve(project.dataDir)) {
      return { name: manifest.archive, path: target, created: !fs.existsSync(target) };
    }
  }
  for (let index = 1; index < 10000; index += 1) {
    const name = index === 1 ? "patch.xp3" : "patch" + index + ".xp3";
    const target = path.join(project.dataDir, name);
    if (!fs.existsSync(target)) return { name, path: target, created: true };
  }
  throw coded("E_IO", "cannot find a free patch archive name in " + project.dataDir);
}

/**
 * Build the patch entries from the dictionary.
 *
 * @param {{ archives: string[], root: string, dataDir: string }} project
 * @param {object} dict loaded dictionary
 * @param {string|null} skipArchive
 * @returns {{ files: Array<{name: string, data: Buffer}>, entries: number, skipped: number, undecodable: string[] }}
 */
function buildPatchFiles(project, dict, skipArchive) {
  const pairs = krkrPairs(dict);
  const { files: candidates, undecodable } = collectKsFiles(project, skipArchive);
  /** @type {Map<string, Map<number, { source: string, target: string }>>} */
  const wanted = new Map();
  const unanchored = [];
  let skipped = 0;

  const addTarget = (name, line, source, target) => {
    let byLine = wanted.get(name);
    if (!byLine) {
      byLine = new Map();
      wanted.set(name, byLine);
    }
    const previous = byLine.get(line);
    if (previous && previous.target !== target) skipped += 1;
    byLine.set(line, { source, target });
  };

  for (const pair of pairs) {
    let anchored = false;
    for (const locator of pair.locators) {
      const parsed = parseLocator(locator);
      if (!parsed) continue;
      anchored = true;
      addTarget(parsed.name, parsed.line, pair.source, pair.target);
    }
    if (!anchored) unanchored.push(pair);
  }

  // A manually seeded glossary entry has no locator. Find its source text by
  // scanning the scripts once, so UI terms work on Kirikiri too. The source
  // text is indexed once; a script may hold thousands of lines and the
  // glossary may hold hundreds of terms, so the scan must not be quadratic.
  if (unanchored.length > 0) {
    const bySource = new Map();
    for (const pair of unanchored) {
      if (!bySource.has(pair.source)) bySource.set(pair.source, []);
      bySource.get(pair.source).push(pair);
    }
    for (const [name, candidate] of candidates) {
      let archive;
      try {
        archive = openXp3(candidate.archivePath);
      } catch {
        continue;
      }
      const entry = archive.entry(name);
      if (!entry) continue;
      let decoded;
      try {
        decoded = decodeKs(entry.read());
      } catch {
        continue;
      }
      if (decoded.undecodable) continue;
      const lines = decoded.text.split(/\r\n|\r|\n/);
      for (let index = 0; index < lines.length; index += 1) {
        const visible = stripInlineTags(lines[index]).text.trim();
        if (visible === "") continue;
        const matches = bySource.get(visible);
        if (!matches) continue;
        for (const pair of matches) addTarget(name, index + 1, pair.source, pair.target);
      }
    }
  }

  const files = [];
  let entries = 0;
  for (const [name, byLine] of wanted) {
    const candidate = candidates.get(name);
    if (!candidate) {
      skipped += byLine.size;
      continue;
    }
    let archive;
    try {
      archive = openXp3(candidate.archivePath);
    } catch {
      skipped += byLine.size;
      continue;
    }
    const entry = archive.entry(name);
    if (!entry) {
      skipped += byLine.size;
      continue;
    }
    let decoded;
    try {
      decoded = decodeKs(entry.read());
    } catch {
      skipped += byLine.size;
      continue;
    }
    if (decoded.undecodable) {
      skipped += byLine.size;
      continue;
    }
    const known = new Map();
    for (const unit of collectKsStrings(decoded.text, name).strings) known.set(unit.line, unit.text);
    const lines = decoded.text.split(/\r\n|\r|\n/);
    const eol = decoded.text.includes("\r\n") ? "\r\n" : "\n";
    let changed = false;
    for (const [line, pair] of byLine) {
      if (line < 1 || line > lines.length) {
        skipped += 1;
        continue;
      }
      if (known.get(line) !== pair.source) {
        skipped += 1;
        continue;
      }
      const next = replaceVisibleText(lines[line - 1], pair.target);
      if (next === null) {
        skipped += 1;
        continue;
      }
      if (next !== lines[line - 1]) {
        lines[line - 1] = next;
        entries += 1;
        changed = true;
      }
    }
    if (changed) files.push({ name, data: encodeKs(lines.join(eol), decoded.encoding) });
  }

  return { files, entries, skipped, undecodable };
}

/**
 * Install (or refresh) the patch archive.
 *
 * @param {{ archives: string[], root: string, dataDir: string }} project
 * @param {object} dict loaded dictionary
 * @param {{ dryRun?: boolean }} [options]
 * @returns {{ path: string, archive: string, entries: number, files: number, created: boolean, changed: boolean, skipped: number, undecodable: string[], dictionaryHash: string, archiveHash: string, dryRun?: true }}
 */
export function installPatch(project, dict, options = {}) {
  const existingManifest = readPatchManifest(project);
  const target = chooseArchive(project, existingManifest);
  const built = buildPatchFiles(project, dict, existingManifest ? existingManifest.archive : null);
  if (built.files.length === 0) {
    throw coded(
      "E_NO_DICTIONARY",
      "the dictionary has no translated Kirikiri lines that match this game - run: yakusha extract \"<game>\" and translate it"
    );
  }
  const archive = buildXp3(built.files.map((file) => ({ name: file.name, data: file.data, mode: 1 })));
  const pairs = krkrPairs(dict);
  const nextManifest = {
    schema: 1,
    engine: "krkr",
    archive: target.name,
    entries: built.entries,
    files: built.files.map((file) => file.name),
    dictionaryHash: dictionaryHash(pairs),
    archiveHash: sha256(archive),
    updatedAt: new Date().toISOString(),
  };
  let changed = true;
  if (fs.existsSync(target.path)) {
    try {
      const before = fs.readFileSync(target.path);
      changed = !before.equals(archive) || !existingManifest || existingManifest.dictionaryHash !== nextManifest.dictionaryHash;
    } catch {
      changed = true;
    }
  }
  if (options.dryRun === true) {
    return {
      path: target.path,
      archive: target.name,
      entries: built.entries,
      files: built.files.length,
      created: target.created,
      changed,
      skipped: built.skipped,
      undecodable: built.undecodable,
      dictionaryHash: nextManifest.dictionaryHash,
      archiveHash: nextManifest.archiveHash,
      dryRun: true,
    };
  }
  assertInsideRoot(project, target.path);
  writeBytesAtomic(target.path, archive);
  writeFileAtomic(manifestPath(project), JSON.stringify(nextManifest, null, 2) + "\n");
  return {
    path: target.path,
    archive: target.name,
    entries: built.entries,
    files: built.files.length,
    created: target.created,
    changed,
    skipped: built.skipped,
    undecodable: built.undecodable,
    dictionaryHash: nextManifest.dictionaryHash,
    archiveHash: nextManifest.archiveHash,
  };
}

/**
 * Remove the archive and manifest Yakusha wrote. The game's own patch
 * archives are never touched.
 *
 * @param {{ root: string, dataDir: string }} project
 * @param {{ dryRun?: boolean }} [options]
 * @returns {{ path: string|null, archive: string|null, entries: number, removed: boolean, dryRun?: true }}
 */
export function uninstallPatch(project, options = {}) {
  const manifest = readPatchManifest(project);
  if (!manifest) return { path: null, archive: null, entries: 0, removed: false };
  const target = path.join(project.dataDir, manifest.archive);
  assertInsideRoot(project, target);
  const existed = fs.existsSync(target);
  if (options.dryRun === true) {
    return { path: target, archive: manifest.archive, entries: manifest.entries || 0, removed: existed, dryRun: true };
  }
  if (existed) {
    try {
      fs.rmSync(target);
    } catch (error) {
      throw coded("E_IO", "cannot remove " + target + " (" + ((error && error.code) || "remove failed") + ")");
    }
  }
  try {
    fs.rmSync(manifestPath(project));
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw coded("E_IO", "cannot remove " + manifestPath(project) + " (" + (error.code || "remove failed") + ")");
    }
  }
  return { path: target, archive: manifest.archive, entries: manifest.entries || 0, removed: existed };
}

/**
 * Read-only delivery status for doctor.
 *
 * @param {{ root: string, dataDir: string }} project
 * @returns {{ path: string|null, exists: boolean, entries: number, files: number, mode: "patch", intact: boolean, problems: string[], dictionaryStale: boolean, archive?: string }}
 */
export function patchStatus(project) {
  const manifestFile = manifestPath(project);
  if (!fs.existsSync(manifestFile)) {
    return { path: null, exists: false, entries: 0, files: 0, mode: "patch", intact: true, problems: [], dictionaryStale: false };
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  } catch {
    return { path: manifestFile, exists: true, entries: 0, files: 0, mode: "patch", intact: false, problems: ["the patch manifest is not readable"], dictionaryStale: false };
  }
  if (!manifest || typeof manifest !== "object" || typeof manifest.archive !== "string" || !PATCH_NAME.test(manifest.archive)) {
    return { path: manifestFile, exists: true, entries: 0, files: 0, mode: "patch", intact: false, problems: ["the patch manifest is not valid"], dictionaryStale: false };
  }
  const target = path.join(project.dataDir, manifest.archive);
  const exists = fs.existsSync(target);
  const problems = [];
  if (!exists) problems.push("the patch archive is missing");
  if (exists && typeof manifest.archiveHash === "string") {
    try {
      if (sha256(fs.readFileSync(target)) !== manifest.archiveHash) problems.push("the patch archive changed after install");
    } catch {
      problems.push("the patch archive cannot be read");
    }
  }
  let stale = false;
  if (exists && typeof manifest.dictionaryHash === "string") {
    const file = dictionaryPath(project.root);
    if (fs.existsSync(file)) {
      try {
        stale = dictionaryHash(krkrPairs(loadDictionary(file))) !== manifest.dictionaryHash;
      } catch {
        stale = false;
      }
    }
  }
  return {
    path: target,
    exists,
    entries: manifest.entries || 0,
    files: Array.isArray(manifest.files) ? manifest.files.length : 0,
    mode: "patch",
    intact: problems.length === 0,
    problems,
    dictionaryStale: stale,
    archive: manifest.archive,
  };
}

export default { installPatch, uninstallPatch, patchStatus, readPatchManifest, manifestPath };
