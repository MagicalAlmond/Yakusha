/**
 * Kirikiri XP3 archive reader (read-only).
 *
 * The XP3 container layout implemented here was derived from public
 * documentation of the format and verified against synthetic fixtures:
 *
 * - 40-byte header: 8-byte magic "XP3\r\n \n\x1a", a fixed u64 version mark
 *   at 8, two u32 flags at 16/20, a u64 at 24, and the u64 index offset at 32.
   size, then the compressed index stream.
 *   size, then the compressed index stream.
 * - The index body starts with the "File" magic followed by one entry per
 *   game file: u32 tag + u64 payload size, then `info`, `segm` and `adlr`
 *   sub-blocks.
 * - `info` carries a protection u32, original/compressed u64 sizes and a
 *   UTF-16LE name; `segm` is a list of N records (N = block size / 28) of
 *   {u32 mode, u64 start, u64 orig, u64 comp}; `adlr` carries the adler-32 of
 *   the reassembled file.
 *
 * Encrypted or otherwise non-standard indexes are reported as
 * E_UNSUPPORTED rather than guessed at; nothing in this module writes.
 *
 * @module engines/krkr/xp3
 */

import fsSync from "node:fs";
import { inflateSync } from "node:zlib";

/** 8-byte XP3 container magic. @type {Buffer} */
const MAGIC = Buffer.from("XP3\r\n \n\x1a", "latin1");

/** Default cap on entries per archive; real games stay far below this. */
const MAX_ENTRIES = 100000;

/**
 * Hand-rolled adler-32: Node exposes adler32 only through zlib streams.
 * @param {Buffer} data bytes to checksum
 * @returns {number} 32-bit unsigned adler-32
 */
export function adler32(data) {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; i += 1) {
    a = (a + data[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}
function ioError(message) {
  const error = new Error(message);
  error.code = "E_IO";
  return error;
}

function unsupportedError(message) {
  const error = new Error(message);
  error.code = "E_UNSUPPORTED";
  return error;
}

function readU32(buffer, offset) {
  return buffer.readUInt32LE(offset);
}

function readU64(buffer, offset) {
  const low = buffer.readUInt32LE(offset);
  const high = buffer.readUInt32LE(offset + 4);
  return low + high * 4294967296;
}

/**
 * Parse the decompressed index body into entries.
 * @param {Buffer} body decompressed index stream
 * @param {string} archiveName for error messages
 * @returns {Array<{name: string, protect: number, origSize: number, compSize: number, segments: Array<{mode: number, start: number, orig: number, comp: number}>, hash: number}>}
 */
function parseIndex(body, archiveName) {
  if (body.length < 4 || body.toString("latin1", 0, 4) !== "File") {
    const seen = body.length >= 4 ? body.toString("latin1", 0, 4) : "";
    throw unsupportedError(
      archiveName + ": the XP3 index uses an unsupported format" +
      (seen ? " (" + JSON.stringify(seen) + ")" : "") +
      " - yakusha only reads standard XP3 indexes"
    );
  }
  let offset = 4;
  const entries = [];
  while (offset + 12 <= body.length && entries.length < MAX_ENTRIES) {
    const tag = body.toString("latin1", offset, offset + 4);
    if (tag !== "File") break;
    const payloadSize = readU64(body, offset + 4);
    const payloadEnd = offset + 12 + payloadSize;
    if (payloadEnd > body.length) throw ioError(archiveName + ": truncated XP3 index entry");
    entries.push(parseEntry(body, offset + 12, payloadEnd, archiveName));
    offset = payloadEnd;
  }
  return entries;
}
function parseEntry(body, start, end, archiveName) {
  let offset = start;
  const entry = { name: "", protect: 0, origSize: 0, compSize: 0, segments: [], hash: null };
  while (offset + 12 <= end) {
    const magic = body.toString("latin1", offset, offset + 4);
    const size = readU64(body, offset + 4);
    const payload = offset + 12;
    const payloadEnd = payload + size;
    if (payloadEnd > end) throw ioError(archiveName + ": truncated XP3 sub-block " + magic);
    if (magic === "info") {
      entry.protect = readU32(body, payload);
      entry.origSize = readU64(body, payload + 4);
      entry.compSize = readU64(body, payload + 12);
      const nameLen = body.readUInt16LE(payload + 20);
      entry.name = body.toString("utf16le", payload + 22, payload + 22 + nameLen * 2);
    } else if (magic === "segm") {
      const recordCount = Math.floor(size / 28);
      for (let i = 0; i < recordCount; i += 1) {
        const base = payload + i * 28;
        entry.segments.push({
          mode: readU32(body, base),
          start: readU64(body, base + 4),
          orig: readU64(body, base + 12),
          comp: readU64(body, base + 20),
        });
      }
    } else if (magic === "adlr") {
      entry.hash = readU32(body, payload);
    }
    // Unknown sub-blocks are skipped; the format allows extra blocks.
    offset = payloadEnd;
  }
  return entry;
}

function parseHeader(handle, archiveName) {
  const header = Buffer.alloc(40);
  const bytesRead = fsSync.readSync(handle, header, 0, 40, 0);
  if (bytesRead < 40 || !header.subarray(0, 8).equals(MAGIC)) {
    throw ioError(archiveName + ": not an XP3 archive (bad magic)");
  }
  return readU64(header, 32);
}

function readIndexContainer(handle, indexOffset, archiveName) {
  const head = Buffer.alloc(9);
  const bytesRead = fsSync.readSync(handle, head, 0, 9, indexOffset);
  if (bytesRead < 9) throw ioError(archiveName + ": truncated XP3 index container");
  const mode = head.readUInt8(0);
  const compSize = readU64(head, 1);
  const compressed = Buffer.alloc(Number(compSize));
  const read = fsSync.readSync(handle, compressed, 0, compressed.length, indexOffset + 9);
  if (read < compSize) throw ioError(archiveName + ": truncated XP3 index stream");
  if (mode === 0) return compressed;
  if (mode === 1) {
    try {
      return inflateSync(compressed);
    } catch (error) {
      throw ioError(archiveName + ": the XP3 index stream does not decompress (" + error.message + ")");
    }
  }
  throw unsupportedError(archiveName + ": unsupported XP3 index mode " + mode);
}
function readFileAt(handle, entry, archiveName) {
  const chunks = [];
  for (const segment of entry.segments) {
    const buffer = Buffer.alloc(Number(segment.comp));
    if (segment.comp > 0) {
      const bytesRead = fsSync.readSync(handle, buffer, 0, buffer.length, Number(segment.start));
      if (bytesRead < segment.comp) {
        throw ioError(archiveName + ": truncated data for " + JSON.stringify(entry.name));
      }
    }
    if (segment.mode === 1) {
      try {
        chunks.push(inflateSync(buffer));
      } catch (error) {
        throw ioError(archiveName + ": segment of " + JSON.stringify(entry.name) + " does not decompress (" + error.message + ")");
      }
    } else {
      chunks.push(buffer);
    }
  }
  return Buffer.concat(chunks);
}

function withArchive(filePath, archiveName, fn) {
  const handle = fsSync.openSync(filePath, "r");
  try {
    return fn(handle);
  } finally {
    fsSync.closeSync(handle);
  }
}
/**
 * One file inside an XP3 archive. `read()` re-reads from disk each call so
 * callers never hold the whole archive in memory.
 *
 * @typedef {object} Xp3Entry
 * @property {string} name decoded UTF-16LE name as stored
 * @property {number} protect protection flags (informational only)
 * @property {number} origSize original byte size
 * @property {number} compSize compressed byte size
 * @property {Array<{mode: number, start: number, orig: number, comp: number}>} segments storage segments
 * @property {number | null} hash adler-32 of the reassembled file
 * @property {() => Buffer} read reassembled bytes
 * @property {() => boolean} verify adler-32 check of the reassembled file
 */

/**
 * Open an XP3 archive and parse its index.
 *
 * @param {string} filePath absolute or cwd-relative archive path
 * @returns {{ path: string, entries: Xp3Entry[], entry(name: string): Xp3Entry | null }}
 */
export function openXp3(filePath) {
  const archiveName = filePath.split(/[\\/]/).pop() || filePath;
  const handle = fsSync.openSync(filePath, "r");
  try {
    const indexOffset = parseHeader(handle, archiveName);
    const body = readIndexContainer(handle, indexOffset, archiveName);
    const entries = parseIndex(body, archiveName).map((entry) => ({
      ...entry,
      read: () => withArchive(filePath, archiveName, (again) => readFileAt(again, entry, archiveName)),
      verify: () => {
        if (entry.hash === null) return true;
        return adler32(withArchive(filePath, archiveName, (again) => readFileAt(again, entry, archiveName))) === entry.hash;
      },
    }));
    const byName = new Map(entries.map((entry) => [entry.name, entry]));
    return {
      path: filePath,
      entries,
      entry(name) { return byName.get(name) || null; },
    };
  } finally {
    fsSync.closeSync(handle);
  }
}
