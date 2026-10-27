/**
 * Synthetic Kirikiri fixtures for the contract tests.
 *
 * Everything in this file is generated: an in-memory XP3 writer (the same
 * container layout src/engines/krkr/xp3.js reads) and KAG script bodies
 * invented for the tests. No content is copied from any real game - the real
 * archives stay outside the repository and only ever feed manual runs.
 *
 * The writer deliberately supports only what the tests need: zlib or raw
 * segments, one segment per file, standard ("File") indexes. Encrypted index
 * variants are faked with a four-byte magic swap so the negative path can be
 * tested without implementing anyone's encryption.
 *
 * @module test/krkr-fixture
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

import { adler32 } from "../src/engines/krkr/xp3.js";

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
  const big = BigInt(value);
  buffer.writeUInt32LE(Number(big & 0xffffffffn), 0);
  buffer.writeUInt32LE(Number(big >> 32n), 4);
  return buffer;
}

function block(magic, payload) {
  return Buffer.concat([Buffer.from(magic, "latin1"), u64(payload.length), payload]);
}
const XP3_MAGIC = Buffer.from("XP3\r\n \n\x1a", "latin1");
const HEADER_VERSION = 0x0117678b;

/**
 * Build one XP3 archive in memory.
 *
 * @param {Array<{ name: string, data: Buffer, mode?: 0|1 }>} files archive
 *   members in write order; mode 0 stores raw, mode 1 stores a zlib stream
 * @param {{ indexMagic?: string }} [opts] swap the index magic to fake an
 *   unsupported index format
 * @returns {Buffer}
 */
export function buildXp3(files, opts = {}) {
  const dataChunks = [];
  let cursor = 40;
  const records = [];
  for (const file of files) {
    const mode = file.mode === 1 ? 1 : 0;
    const stored = mode === 1 ? zlib.deflateSync(file.data) : file.data;
    const start = cursor;
    dataChunks.push(stored);
    cursor += stored.length;
    const nameBuffer = Buffer.from(file.name, "utf16le");
    const info = Buffer.concat([
      u32(0),
      u64(file.data.length),
      u64(stored.length),
      u16(nameBuffer.length / 2),
      nameBuffer,
    ]);
    const segm = Buffer.concat([u32(mode), u64(start), u64(file.data.length), u64(stored.length)]);
    const adlr = u32(adler32(file.data));
    const payload = Buffer.concat([block("info", info), block("segm", segm), block("adlr", adlr)]);
    records.push(Buffer.concat([Buffer.from("File", "latin1"), u64(payload.length), payload]));
  }
  const indexMagic = opts.indexMagic || "File";
  const index = Buffer.concat([Buffer.from(indexMagic, "latin1"), ...records]);
  const compressedIndex = zlib.deflateSync(index);
  const head = Buffer.alloc(40);
  XP3_MAGIC.copy(head, 0);
  u64(HEADER_VERSION).copy(head, 8);
  u32(0x01000000).copy(head, 16);
  u32(0x80000000).copy(head, 20);
  u64(0).copy(head, 24);
  const indexOffset = 40 + dataChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  u64(indexOffset).copy(head, 32);
  const container = Buffer.concat([Buffer.from([1]), u64(compressedIndex.length), compressedIndex]);
  return Buffer.concat([head, ...dataChunks, container]);
}
// KAG script bodies invented for the tests. The [name_set]/[ptext] tags and
// the [r][p] line mechanics mirror how KAG works, but every string here is
// written for this file.
export const KS_SCENARIO = [
  "[name_set name='Aoi']",
  "あおい「今日はよく晴れているね」",
  "[p2]",
  "",
  "; a comment line the extractor must skip",
  "*scene_one",
  "[name_set name=\"Ren\"]",
  "れん「[r]改行つきのせりふ」",
  "[p2]",
].join("\n");

export const KS_SMALL = [
  "[test]",
  "hello",
].join("\n");

/**
 * A .ks body with a line whose encoding is invalid in UTF-8 and whose
 * Shift_JIS interpretation contains an unpaired byte (becomes U+FFFD).
 * 0x82 0x9F is ぁ in Shift_JIS; the trailing 0x80 has no Shift_JIS meaning.
 * @returns {Buffer}
 */
export function brokenSjisBuffer() {
  return Buffer.concat([
    Buffer.from([0x82, 0x9f]),
    Buffer.from("text", "latin1"),
    Buffer.from([0x80]),
  ]);
}

/**
 * A project tree on disk: one root holding a data/ directory with the
 * archives `buildXp3` produced, plus optional sibling roots for the
 * multi-root case.
 *
 * @param {string} parent existing directory to create the project in
 * @param {{ name?: string, archives?: Array<{ archiveName: string, files: Array<{ name: string, data: Buffer, mode?: 0|1 }> }> }} spec
 * @returns {{ root: string, dataDir: string, archivePaths: string[] }}
 */
export function writeKrkrProject(parent, spec = {}) {
  const name = spec.name || "game";
  const root = path.join(parent, name);
  const dataDir = path.join(root, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const archivePaths = [];
  for (const archive of spec.archives || []) {
    const target = path.join(dataDir, archive.archiveName);
    fs.writeFileSync(target, buildXp3(archive.files));
    archivePaths.push(target);
  }
  return { root, dataDir, archivePaths };
}
