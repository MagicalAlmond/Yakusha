/**
 * Kirikiri XP3 archive writer.
 *
 * The reader in ./xp3.js only ever consumed archives; delivery needs the other
 * direction. This writer emits the standard 40-byte header and the real index
 * shape observed in retail archives: the first entry's "File" tag doubles as
 * the index magic, followed by the info/segm/adlr sub-blocks. The earlier
 * synthetic fixture put a second "File" magic in front of that list; real
 * engines reject such an archive even though our own reader tolerates it.
 *
 * Only the unencrypted, single-segment form is written. That is the same
 * boundary the reader draws: an encrypted archive is reported as unsupported
 * rather than guessed at, and a translated .ks file is small enough that a
 * single raw segment is the honest choice.
 *
 * @module engines/krkr/xp3writer
 */

import { deflateSync } from "node:zlib";

import { adler32 } from "./xp3.js";

/** 8-byte XP3 container magic. @type {Buffer} */
const MAGIC = Buffer.from("XP3\r\n \n\x1a", "latin1");

/** Fixed header version observed in standard archives. */
const HEADER_VERSION = 0x1701678bn;

/** Cap one entry at the same 64 MiB the reader enforces. */
const MAX_ENTRY_BYTES = 64 << 20;

function u16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0);
  return buffer;
}

function u64(value) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
}

function block(magic, payload) {
  return Buffer.concat([Buffer.from(magic, "latin1"), u64(payload.length), payload]);
}

function toBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data);
  if (typeof data === "string") return Buffer.from(data, "utf8");
  throw new TypeError("XP3 entry data must be a Buffer, Uint8Array or string");
}

/**
 * Build one standard XP3 archive in memory.
 *
 * @param {Array<{name: string, data: Buffer|Uint8Array|string, mode?: 0|1}>} files
 *   entries in archive order; mode 1 stores a zlib stream, mode 0 stores raw bytes
 * @param {{ indexMode?: 0|1 }} [options] index container mode; default 1
 * @returns {Buffer}
 */
export function buildXp3(files, options = {}) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new TypeError("an XP3 archive needs at least one entry");
  }
  const indexMode = options.indexMode === undefined ? 1 : options.indexMode;
  if (indexMode !== 0 && indexMode !== 1) throw new TypeError("XP3 index mode must be 0 or 1");

  const dataChunks = [];
  const records = [];
  const seen = new Set();
  let cursor = 40;

  for (const file of files) {
    if (!file || typeof file.name !== "string" || file.name.length === 0) {
      throw new TypeError("every XP3 entry needs a name");
    }
    if (seen.has(file.name)) throw new TypeError("duplicate XP3 entry name: " + file.name);
    seen.add(file.name);
    const data = toBuffer(file.data);
    if (data.length > MAX_ENTRY_BYTES) {
      throw new RangeError("XP3 entry " + JSON.stringify(file.name) + " is larger than " + MAX_ENTRY_BYTES + " bytes");
    }
    const mode = file.mode === undefined ? 0 : file.mode;
    if (mode !== 0 && mode !== 1) throw new TypeError("XP3 entry mode must be 0 or 1");
    const stored = mode === 1 ? deflateSync(data) : data;
    const start = cursor;
    dataChunks.push(stored);
    cursor += stored.length;

    const nameBuffer = Buffer.from(file.name, "utf16le");
    if (nameBuffer.length / 2 > 0xffff) throw new RangeError("XP3 entry name is too long");
    const info = Buffer.concat([
      u32(0),
      u64(data.length),
      u64(stored.length),
      u16(nameBuffer.length / 2),
      nameBuffer,
    ]);
    const segm = Buffer.concat([u32(mode), u64(start), u64(data.length), u64(stored.length)]);
    const adlr = u32(adler32(data));
    const payload = Buffer.concat([block("info", info), block("segm", segm), block("adlr", adlr)]);
    records.push(Buffer.concat([Buffer.from("File", "latin1"), u64(payload.length), payload]));
  }

  const index = Buffer.concat(records);
  const compressedIndex = deflateSync(index);
  const header = Buffer.alloc(40);
  MAGIC.copy(header, 0);
  u64(HEADER_VERSION).copy(header, 8);
  u32(0x01000000).copy(header, 16);
  u32(0x80000000).copy(header, 20);
  u64(0).copy(header, 24);
  u64(cursor).copy(header, 32);

  const container = indexMode === 1
    ? Buffer.concat([Buffer.from([1]), u64(compressedIndex.length), u64(index.length), compressedIndex])
    : Buffer.concat([Buffer.from([0]), u64(index.length), index]);

  return Buffer.concat([header, ...dataChunks, container]);
}

export default { buildXp3 };
