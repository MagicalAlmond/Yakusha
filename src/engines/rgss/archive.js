/**
 * RGSS archives: the data containers shipped by RPG Maker XP, VX and VX Ace.
 *
 * A shipped game packs everything into one archive next to the executable
 * (Game.rgssad, Game.rgss2a or Game.rgss3a). The directory inside is encrypted
 * with a small rolling-key cipher and each file carries its own key. Nothing is
 * compressed, so reading a game means reading these bytes.
 *
 * The three versions are not variations of one format:
 *
 *   version 1  RGSSAD  RPG Maker XP      seed 0xDEADCAFE, key rolls per field
 *   version 2  RGSS2A  RPG Maker VX      same cipher as version 1
 *   version 3  RGSS3A  RPG Maker VX Ace  seed derived constant key, rolls per block
 *
 * Versions 1 and 2 share one cipher and differ only in the version byte.
 * Version 3 is a rewrite. Both statements were checked against independent
 * open-source readers before this file existed, because a wrong guess here
 * decrypts to plausible-looking garbage and costs hours.
 *
 * @module engines/rgss/archive
 */

import fs from "node:fs";
import path from "node:path";

/** Raised for bytes that are not an RGSS archive this module can read. */
export class ArchiveError extends Error {
  constructor(message) {
    super(message);
    this.name = "ArchiveError";
  }
}

/** The seven bytes each archive starts with, followed by one version byte. */
const MAGIC = "RGSSAD\u0000";

/** Seed used by versions 1 and 2. */
const OLD_SEED = 0xdeadcafe;

/** Bytes to load before the directory length is known. */
const FIRST_CHUNK = 1 << 20;

/** A directory larger than this is not a real archive. */
const MAX_DIRECTORY = 64 << 20;

/** Longest name an archive may hold; game paths are far shorter. */
const MAX_NAME = 4096;

/** Version byte to the name of the format. */
const VERSION_NAMES = Object.freeze({ 1: "rgssad", 2: "rgss2a", 3: "rgss3a" });

/** Signals that the parser ran past the loaded bytes, not past the file. */
class NeedMore extends Error {}

/**
 * A window over the head of a file that grows on demand.
 *
 * A 600 MB archive usually has a directory under a megabyte, so loading the
 * whole file to find it would be wasteful; on the other hand a fixed chunk can
 * cut an entry in half. Growing the window and re-parsing from offset zero
 * avoids both problems for the cost of a few extra scans.
 */
class HeadWindow {
  constructor(fd, fileSize) {
    this.fd = fd;
    this.fileSize = fileSize;
    this.buffer = Buffer.alloc(0);
  }

  /**
   * Grow until at least "end" bytes are loaded, or the file ends.
   *
   * @param {number} end
   * @returns {boolean} whether the request could be satisfied
   */
  fill(end) {
    if (end <= this.buffer.length) return true;
    if (this.buffer.length >= this.fileSize) return false;
    const want = Math.min(this.fileSize, Math.max(end, Math.min(this.fileSize, FIRST_CHUNK)));
    const next = Buffer.alloc(want);
    this.buffer.copy(next, 0);
    let read = 0;
    while (this.buffer.length + read < want) {
      const got = fs.readSync(this.fd, next, this.buffer.length + read, want - this.buffer.length - read, this.buffer.length + read);
      if (got <= 0) break;
      read += got;
    }
    this.buffer = next.subarray(0, this.buffer.length + read);
    return end <= this.buffer.length;
  }
}

/**
 * Load up to "end" bytes or report that more are needed.
 *
 * @param {{ window: HeadWindow }} state
 * @param {number} end
 */
function need(state, end) {
  if (end <= state.window.buffer.length) return;
  state.window.fill(end);
  if (end > state.window.buffer.length) throw new NeedMore();
}

/**
 * Read a little-endian u32 from the loaded window.
 *
 * @param {{ window: HeadWindow }} state
 * @param {number} position
 * @returns {number}
 */
function u32At(state, position) {
  need(state, position + 4);
  return state.window.buffer.readUInt32LE(position);
}

/**
 * Read a byte range from the loaded window.
 *
 * @param {{ window: HeadWindow }} state
 * @param {number} position
 * @param {number} length
 * @returns {Buffer}
 */
function bytesAt(state, position, length) {
  need(state, position + length);
  return state.window.buffer.subarray(position, position + length);
}

/**
 * Hand out the current key, then step it: k = 7k + 3 modulo 2^32.
 *
 * @param {{ key: number }} state
 * @returns {number} the key before stepping
 */
function roll(state) {
  const current = state.key >>> 0;
  state.key = (Math.imul(current, 7) + 3) >>> 0;
  return current;
}
/**
 * Undo one roll, so an over-eager read does not leave the key wedged for the
 * caller that continues with the same state.
 *
 * @param {number} key
 * @returns {number}
 */
function unroll(key) {
  // The inverse of k -> 7k + 3 mod 2^32 exists because 7 is odd.
  return Math.imul((key - 3) >>> 0, 0x6db6db6d) >>> 0;
}

/**
 * A name is plausible when it is printable and looks like a path. Versions 1
 * and 2 have no end-of-directory marker, so the first implausible name is what
 * says the directory stopped.
 *
 * @param {string} name
 * @returns {boolean}
 */
function isPlausibleName(name) {
  if (name.length === 0 || name.length > MAX_NAME) return false;
  if (name.includes("\u0000")) return false;
  return /^[\x20-\x7e\u00a0-\uffff]+$/.test(name);
}

/**
 * Game archives write backslashes; the rest of this codebase uses forward
 * slashes. Normalising here means callers compare one form only.
 *
 * @param {string} name
 * @returns {string}
 */
function normalizeName(name) {
  return name.replace(/\\/g, "/");
}

/**
 * Parse a version 1 or 2 directory.
 *
 * An entry is a name length, the name, and a size, each encrypted with the next
 * key. There is no stored offset: payloads follow the directory in the same
 * order, so the reader walks forward through the file recording positions.
 *
 * @param {{ window: HeadWindow, key: number }} state
 * @returns {Array<{name: string, offset: number, size: number, key: number}>}
 */
function parseOldDirectory(state) {
  const entries = [];
  let position = 8;
  for (;;) {
    if (position + 4 > state.window.fileSize) break;
    let rawLength;
    try {
      rawLength = u32At(state, position);
    } catch (error) {
      if (error instanceof NeedMore) throw error;
      break;
    }
    position += 4;
    const nameLength = (rawLength ^ roll(state)) >>> 0;
    if (nameLength === 0 || nameLength > MAX_NAME) break;
    if (position + nameLength + 4 > state.window.fileSize) break;
    let name;
    try {
      const encrypted = bytesAt(state, position, nameLength);
      const decoded = Buffer.alloc(nameLength);
      for (let i = 0; i < nameLength; i += 1) decoded[i] = encrypted[i] ^ (roll(state) & 0xff);
      position += nameLength;
      name = decoded.toString("utf8");
    } catch (error) {
      if (error instanceof NeedMore) throw error;
      break;
    }
    if (!isPlausibleName(name)) {
      state.key = unroll(state.key);
      break;
    }
    let size;
    try {
      size = (u32At(state, position) ^ roll(state)) >>> 0;
      position += 4;
    } catch (error) {
      if (error instanceof NeedMore) throw error;
      break;
    }
    if (position + size > state.window.fileSize) {
      // A size past the end of the file means the directory already stopped and
      // these bytes belong to the payload the reader just walked into.
      state.key = unroll(state.key);
      break;
    }
    entries.push({ name: normalizeName(name), offset: position, size, key: state.key >>> 0 });
    position += size;
  }
  return entries;
}

/**
 * Parse a version 3 directory.
 *
 * The key comes from the seed in the header and never changes while the
 * directory is read; every entry stores its own key for its payload. An offset
 * of zero marks the end.
 *
 * @param {{ window: HeadWindow, key: number }} state
 * @returns {Array<{name: string, offset: number, size: number, key: number}>}
 */
function parseNewDirectory(state) {
  const entries = [];
  let position = 12;
  for (;;) {
    const offset = (u32At(state, position) ^ state.key) >>> 0;
    if (offset === 0) break;
    const size = (u32At(state, position + 4) ^ state.key) >>> 0;
    const fileKey = (u32At(state, position + 8) ^ state.key) >>> 0;
    const nameLength = (u32At(state, position + 12) ^ state.key) >>> 0;
    position += 16;
    if (nameLength === 0 || nameLength > MAX_NAME) {
      throw new ArchiveError("corrupt RGSS3A directory: name length " + nameLength + " in entry " + entries.length);
    }
    if (offset > state.window.fileSize || offset + size > state.window.fileSize) {
      throw new ArchiveError("corrupt RGSS3A directory: entry " + entries.length + " points past the end of the file");
    }
    const encrypted = bytesAt(state, position, nameLength);
    const decoded = Buffer.alloc(nameLength);
    for (let i = 0; i < nameLength; i += 1) decoded[i] = encrypted[i] ^ ((state.key >>> (8 * (i % 4))) & 0xff);
    position += nameLength;
    entries.push({ name: normalizeName(decoded.toString("utf8")), offset, size, key: fileKey });
  }
  return entries;
}
/**
 * Decrypt one payload.
 *
 * Version 3 steps the key once per four-byte block; versions 1 and 2 step it
 * once per field read, and for a payload every four-byte word plus the tail
 * uses the low bytes of the key it is on. The tail therefore needs the same
 * key state, which is why the two arms below differ only in when they step.
 *
 * XOR is its own inverse, so this function also encrypts.
 *
 * @param {Buffer} encrypted
 * @param {number} startKey
 * @param {number} version
 * @returns {Buffer}
 */
export function decryptPayload(encrypted, startKey, version) {
  const out = Buffer.from(encrypted);
  let key = startKey >>> 0;
  let position = 0;
  const next = () => {
    const current = key;
    key = (Math.imul(key, 7) + 3) >>> 0;
    return current;
  };
  while (position + 4 <= out.length) {
    out.writeUInt32LE((out.readUInt32LE(position) ^ next()) >>> 0, position);
    position += 4;
  }
  if (position < out.length) {
    let tail = next();
    for (let i = position; i < out.length; i += 1) {
      out[i] = out[i] ^ (tail & 0xff);
      tail = tail >>> 8;
    }
  }
  return out;
}

/**
 * Encrypt one payload. Kept beside the reader so the two cannot drift apart: a
 * writer that disagrees by a single key step still opens and shows nothing.
 *
 * @param {Buffer} plain
 * @param {number} startKey
 * @param {number} version
 * @returns {Buffer}
 */
export function encryptPayload(plain, startKey, version) {
  return decryptPayload(plain, startKey, version);
}

/**
 * Open an archive and expose its entries.
 *
 * The returned reader owns a file descriptor until close() is called; reading a
 * closed archive throws instead of returning whatever the descriptor was
 * reassigned to.
 *
 * @param {string} file absolute path to a .rgssad, .rgss2a or .rgss3a file
 * @returns {{
 *   path: string,
 *   version: number,
 *   kind: string,
 *   entries: Array<{ name: string, offset: number, size: number, key: number }>,
 *   names: () => string[],
 *   has: (name: string) => boolean,
 *   read: (name: string) => Buffer|null,
 *   close: () => void,
 * }}
 */
export function openArchive(file) {
  const fd = fs.openSync(file, "r");
  let closed = false;
  const closeQuietly = () => {
    if (closed) return;
    closed = true;
    try {
      fs.closeSync(fd);
    } catch {
      /* the descriptor was already reclaimed */
    }
  };
  try {
    const fileSize = fs.fstatSync(fd).size;
    if (fileSize < 8) {
      throw new ArchiveError("not an RGSS archive (only " + fileSize + " bytes): " + file);
    }
    const header = Buffer.alloc(8);
    fs.readSync(fd, header, 0, 8, 0);
    if (header.subarray(0, 7).toString("latin1") !== MAGIC) {
      throw new ArchiveError("not an RGSS archive (missing the RGSSAD header): " + file);
    }
    const version = header[7];
    if (!VERSION_NAMES[version]) {
      throw new ArchiveError(
        "unsupported RGSS archive version " + version + " in " + file + " (this reader handles 1, 2 and 3)"
      );
    }
    const seedKey = () => (version === 3 ? (Math.imul(u32At(state, 8), 9) + 3) >>> 0 : OLD_SEED >>> 0);
    const state = { window: new HeadWindow(fd, fileSize), key: 0 };
    let entries = null;
    for (let attempt = 0; attempt < 32 && entries === null; attempt += 1) {
      state.window = new HeadWindow(fd, fileSize);
      state.key = seedKey();
      try {
        entries = version === 3 ? parseNewDirectory(state) : parseOldDirectory(state);
      } catch (error) {
        if (!(error instanceof NeedMore)) throw error;
        if (state.window.buffer.length >= Math.min(fileSize, MAX_DIRECTORY)) {
          throw new ArchiveError("RGSS archive directory is larger than " + MAX_DIRECTORY + " bytes: " + file);
        }
      }
    }
    if (entries === null) {
      throw new ArchiveError("could not read the RGSS archive directory: " + file);
    }
    const byName = new Map(entries.map((entry) => [entry.name, entry]));
    return {
      path: file,
      version,
      kind: VERSION_NAMES[version],
      entries,
      names: () => entries.map((entry) => entry.name),
      has: (name) => byName.has(normalizeName(name)),
      read(name) {
        const entry = byName.get(normalizeName(name));
        if (!entry) return null;
        if (closed) throw new ArchiveError("archive is closed: " + file);
        const encrypted = Buffer.alloc(entry.size);
        let read = 0;
        while (read < entry.size) {
          const got = fs.readSync(fd, encrypted, read, entry.size - read, entry.offset + read);
          if (got <= 0) break;
          read += got;
        }
        if (read !== entry.size) {
          throw new ArchiveError(
            "truncated entry " + name + " (" + read + " of " + entry.size + " bytes) in " + file
          );
        }
        return decryptPayload(encrypted, entry.key, version);
      },
      close: closeQuietly
    };
  } catch (error) {
    closeQuietly();
    throw error;
  }
}
/**
 * The archive a game root holds, if any.
 *
 * A project can ship more than one (a stale RGSS2A left behind by an engine
 * upgrade), so the newest version wins: that is the one the executable loads.
 *
 * @param {string} root
 * @param {string|string[]} [preferred] file names to try before the usual ones
 * @returns {string|null} absolute path of the archive, or null
 */
export function findArchive(root, preferred) {
  const candidates = [];
  // A single name is as valid as a list, and neither may contain a path: an
  // archive is always a file in the game root.
  const hints = typeof preferred === "string" ? [preferred] : preferred || [];
  for (const name of hints) {
    if (typeof name === "string" && name.length > 0) candidates.push(name);
  }
  candidates.push("Game.rgss3a", "Game.rgss2a", "Game.rgssad");
  let listed = [];
  try {
    listed = fs.readdirSync(root);
  } catch {
    listed = [];
  }
  const loose = listed
    .filter((name) => /\.rgss(ad|2a|3a)$/i.test(name))
    .sort((left, right) => versionOf(right) - versionOf(left));
  candidates.push(...loose);
  const seen = new Set();
  for (const candidate of candidates) {
    if (/[\\/]/.test(candidate)) continue;
    if (seen.has(candidate.toLowerCase())) continue;
    seen.add(candidate.toLowerCase());
    const full = path.join(root, candidate);
    try {
      if (fs.statSync(full).isFile()) return full;
    } catch {
      /* the candidate is simply not there */
    }
  }
  return null;
}

/**
 * Rank an archive file name by the version it holds, so sorting picks the
 * highest first.
 *
 * @param {string} name
 * @returns {number}
 */
function versionOf(name) {
  if (/\.rgss3a$/i.test(name)) return 3;
  if (/\.rgss2a$/i.test(name)) return 2;
  if (/\.rgssad$/i.test(name)) return 1;
  return 0;
}

/**
 * Write an archive.
 *
 * Publishing a translated game back into the shape the engine reads. Entries
 * arrive complete and in order, because in both layouts a payload's offset
 * depends on the size of the directory in front of it:
 *
 *  - version 3 writes every directory record, then a zero offset as the end
 *    marker, then the payloads in the same order;
 *  - versions 1 and 2 interleave name, size and payload, rolling one key across
 *    the whole file.
 *
 * The key is derived from a fixed seed so that writing the same entries twice
 * produces the same bytes; a caller comparing builds relies on that.
 *
 * @param {string} file destination path
 * @param {{ version: 1|2|3, entries: Array<{ name: string, data: Buffer }> }} archive
 * @returns {{ path: string, version: number, entries: number, bytes: number }}
 */
export function writeArchive(file, archive) {
  const version = archive.version;
  if (!VERSION_NAMES[version]) {
    throw new ArchiveError("unsupported RGSS archive version " + version + " (this writer handles 1, 2 and 3)");
  }
  const entries = archive.entries || [];
  const header = Buffer.alloc(8);
  header.write(MAGIC, 0, "latin1");
  header[7] = version;
  const parts = [header];
  if (version === 3) {
    const seed = 1;
    const key = (Math.imul(seed, 9) + 3) >>> 0;
    const seedBuffer = Buffer.alloc(4);
    seedBuffer.writeUInt32LE(seed, 0);
    parts.push(seedBuffer);
    const names = entries.map((entry) => Buffer.from(normalizeName(entry.name).replace(/\//g, "\\"), "utf8"));
    let payloadOffset = 12;
    for (const name of names) payloadOffset += 16 + name.length;
    payloadOffset += 4;
    const offsets = [];
    for (const entry of entries) {
      offsets.push(payloadOffset);
      payloadOffset += entry.data.length;
    }
    for (let index = 0; index < entries.length; index += 1) {
      const name = names[index];
      const record = Buffer.alloc(16);
      record.writeUInt32LE((offsets[index] ^ key) >>> 0, 0);
      record.writeUInt32LE((entries[index].data.length ^ key) >>> 0, 4);
      // A fixed per-entry key keeps the output deterministic and is what the
      // reference writers do.
      record.writeUInt32LE((42 ^ key) >>> 0, 8);
      record.writeUInt32LE((name.length ^ key) >>> 0, 12);
      parts.push(record);
      const encryptedName = Buffer.alloc(name.length);
      for (let i = 0; i < name.length; i += 1) encryptedName[i] = name[i] ^ ((key >>> (8 * (i % 4))) & 0xff);
      parts.push(encryptedName);
    }
    const end = Buffer.alloc(4);
    // The reader stops when the decoded offset is zero, so the marker has to
    // carry the key itself.
    end.writeUInt32LE(key, 0);
    parts.push(end);
    for (const entry of entries) parts.push(encryptPayload(entry.data, 42, 3));
  } else {
    const state = { key: OLD_SEED >>> 0 };
    for (const entry of entries) {
      const name = Buffer.from(normalizeName(entry.name).replace(/\//g, "\\"), "utf8");
      const lengthBuffer = Buffer.alloc(4);
      lengthBuffer.writeUInt32LE((name.length ^ roll(state)) >>> 0, 0);
      parts.push(lengthBuffer);
      const encryptedName = Buffer.alloc(name.length);
      for (let i = 0; i < name.length; i += 1) encryptedName[i] = name[i] ^ (roll(state) & 0xff);
      parts.push(encryptedName);
      const sizeBuffer = Buffer.alloc(4);
      sizeBuffer.writeUInt32LE((entry.data.length ^ roll(state)) >>> 0, 0);
      parts.push(sizeBuffer);
      parts.push(encryptPayload(entry.data, state.key >>> 0, version));
    }
  }
  const buffer = Buffer.concat(parts);
  fs.writeFileSync(file, buffer);
  return { path: file, version, entries: entries.length, bytes: buffer.length };
}

export default { openArchive, writeArchive, findArchive, decryptPayload, encryptPayload, ArchiveError };
