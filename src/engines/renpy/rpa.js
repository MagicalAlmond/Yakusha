/**
 * Ren'Py RPA archive reader.
 *
 * A packaged Ren'Py game stores its scripts, images and audio in one or more
 * `.rpa` archives. The archive is a small header followed by the file data and,
 * at the offset named by the header, a zlib-compressed Python pickle index.
 * RPA-3.0 / 3.2 xor each entry offset with a key from the header; RPA-4.0 uses
 * the offset as written. Entry values are either `(offset, length)` or
 * `(offset, length, prefix)`, where `prefix` is a small byte string stored
 * directly in the index.
 *
 * This module only reads the index and individual entries. It never writes an
 * archive: Ren'Py delivery is a separate `.rpy` file, so an installed
 * translation can be removed without touching the game's original archive.
 *
 * @module engines/renpy/rpa
 */

import fs from "node:fs";
import zlib from "node:zlib";

import { loads } from "./pickle.js";

/** Bytes read while looking for the header line. */
const HEADER_PROBE = 128;

/** Header shape shared by the RPA versions Ren'Py has shipped. */
const HEADER = /^RPA-(\d+)\.(\d+)\s+([0-9a-fA-F]+)(?:\s+([0-9a-fA-F]+))?\s*$/;

/**
 * Reduce a thrown value to one line for an undecodable report.
 *
 * @param {unknown} error caught value
 * @returns {string} message of the first line
 */
function errorLine(error) {
  const text =
    error !== null && typeof error === "object" && typeof error.message === "string"
      ? error.message
      : String(error);
  return text.split("\n")[0];
}

/**
 * Xor a non-negative integer with a 32-bit key without truncating it to 32
 * bits. RPA-3.x offsets are file offsets and may exceed 4 GiB on a large game.
 *
 * @param {number} value offset as stored in the index
 * @param {number} key 32-bit header key
 * @returns {number} decoded offset
 */
function xorKey(value, key) {
  const high = Math.floor(value / 0x100000000);
  const low = value - high * 0x100000000;
  return high * 0x100000000 + ((low ^ key) >>> 0);
}

/**
 * Read the first line of a file.
 *
 * @param {string} filePath absolute path
 * @returns {string} the header line without its newline
 */
function readHeaderLine(filePath) {
  const fd = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(HEADER_PROBE);
    const read = fs.readSync(fd, buffer, 0, buffer.length, 0);
    const end = buffer.subarray(0, read).indexOf(0x0a);
    if (end < 0) throw new Error("RPA header line is truncated");
    return buffer.subarray(0, end).toString("ascii");
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * True when a buffer starts with an RPA header.
 *
 * @param {Buffer} buffer file contents
 * @returns {boolean}
 */
export function isRpa(buffer) {
  return Buffer.isBuffer(buffer) && buffer.subarray(0, 4).toString("ascii") === "RPA-";
}

/**
 * Read and validate the index of one RPA archive.
 *
 * The index is the only part of a multi-gigabyte archive that has to be read
 * for a scan: entry payloads stay on disk until a caller asks for one.
 *
 * @param {string} filePath absolute path of an `.rpa` file
 * @returns {{version: string, key: number, entries: Map<string, {offset: number, length: number, prefix: Buffer|null}>}}
 * @throws {Error} when the header, index stream or entry table is malformed
 */
export function readRpaIndex(filePath) {
  const header = readHeaderLine(filePath);
  const match = HEADER.exec(header);
  if (match === null) throw new Error("unrecognised RPA header: " + JSON.stringify(header));
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const version = major + "." + minor;
  if (major !== 3 && major !== 4) {
    throw new Error("unsupported RPA version: " + version);
  }
  if (major === 3 && match[4] === undefined) {
    throw new Error("RPA-3.x header has no xor key");
  }
  const indexOffset = Number.parseInt(match[3], 16);
  const key = match[4] === undefined ? 0 : Number.parseInt(match[4], 16);
  const size = fs.statSync(filePath).size;
  if (!Number.isSafeInteger(indexOffset) || indexOffset < 0 || indexOffset > size) {
    throw new Error("RPA index offset is outside the archive");
  }

  const fd = fs.openSync(filePath, "r");
  let inflated;
  try {
    const compressed = Buffer.alloc(size - indexOffset);
    let read = 0;
    while (read < compressed.length) {
      const n = fs.readSync(fd, compressed, read, compressed.length - read, indexOffset + read);
      if (n === 0) break;
      read += n;
    }
    if (read !== compressed.length) throw new Error("RPA index is truncated");
    inflated = zlib.inflateSync(compressed);
  } finally {
    fs.closeSync(fd);
  }

  let table;
  try {
    table = loads(inflated);
  } catch (error) {
    throw new Error("RPA index is not a readable pickle: " + errorLine(error));
  }
  if (table === null || typeof table !== "object" || Array.isArray(table)) {
    throw new Error("RPA index is not a name-to-entry table");
  }

  /** @type {Map<string, {length: number, segments: Array<{offset: number, length: number, prefix: Buffer|null}>}>} */
  const entries = new Map();
  for (const [rawName, rawSegments] of Object.entries(table)) {
    const name = String(rawName).replace(/\\/g, "/");
    if (!Array.isArray(rawSegments) || rawSegments.length === 0) {
      throw new Error("RPA index entry has no segments: " + name);
    }
    /** @type {Array<{offset: number, length: number, prefix: Buffer|null}>} */
    const segments = [];
    let total = 0;
    for (const rawSegment of rawSegments) {
      if (!Array.isArray(rawSegment) || rawSegment.length < 2) {
        throw new Error("RPA index segment is not an (offset, length) tuple: " + name);
      }
      const rawOffset = rawSegment[0];
      const rawLength = rawSegment[1];
      const prefixValue = rawSegment.length >= 3 ? rawSegment[2] : null;
      if (!Number.isSafeInteger(rawOffset) || rawOffset < 0) {
        throw new Error("RPA index offset is not a non-negative integer: " + name);
      }
      if (!Number.isSafeInteger(rawLength) || rawLength < 0) {
        throw new Error("RPA index length is not a non-negative integer: " + name);
      }
      const offset = major === 3 ? xorKey(rawOffset, key) : rawOffset;
      const length = major === 3 ? xorKey(rawLength, key) : rawLength;
      let prefix = null;
      if (prefixValue !== null && prefixValue !== undefined) {
        if (!Buffer.isBuffer(prefixValue)) {
          throw new Error("RPA index prefix is not a byte string: " + name);
        }
        prefix = prefixValue;
        if (prefix.length > length) {
          throw new Error("RPA index prefix is longer than the segment: " + name);
        }
      }
      const bodyLength = length - (prefix === null ? 0 : prefix.length);
      if (offset + bodyLength > size) {
        throw new Error("RPA entry extends past the archive: " + name);
      }
      segments.push({ offset, length, prefix });
      total += length;
    }
    entries.set(name, { length: total, segments });
  }
  return { version, key, entries };
}

/**
 * Read one entry's bytes from an archive.
 *
 * A logical entry can be split into several segments; the index stores one
 * `(offset, length, prefix)` tuple per segment. Segments are concatenated in
 * index order.
 *
 * @param {string} filePath absolute path of the archive
 * @param {{length: number, segments: Array<{offset: number, length: number, prefix: Buffer|null}>}} entry index entry
 * @returns {Buffer} the decoded bytes
 */
export function readRpaEntry(filePath, entry) {
  const output = Buffer.alloc(entry.length);
  const fd = fs.openSync(filePath, "r");
  try {
    let cursor = 0;
    for (const segment of entry.segments) {
      const prefix = segment.prefix === null ? Buffer.alloc(0) : segment.prefix;
      prefix.copy(output, cursor);
      cursor += prefix.length;
      const bodyLength = segment.length - prefix.length;
      let read = 0;
      while (read < bodyLength) {
        const n = fs.readSync(fd, output, cursor + read, bodyLength - read, segment.offset + read);
        if (n === 0) break;
        read += n;
      }
      if (read !== bodyLength) throw new Error("RPA entry is truncated");
      cursor += bodyLength;
    }
    if (cursor !== output.length) throw new Error("RPA entry is truncated");
    return output;
  } finally {
    fs.closeSync(fd);
  }
}

export default { isRpa, readRpaIndex, readRpaEntry };
