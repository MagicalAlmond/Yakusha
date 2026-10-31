/**
 * XP3 reader contract (src/engines/krkr/xp3.js).
 *
 * Archives are built in memory by test/krkr-fixture.js, which writes the
 * standard ("File"-index) container this reader supports. The negative cases
 * cover the two rejections the reader owes its callers: a file that is not an
 * archive at all, and an index in a format yakusha does not read (faked here
 * with a magic swap, not by implementing anyone's encryption).
 */

import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import zlib from "node:zlib";

import { openXp3, adler32 } from "../src/engines/krkr/xp3.js";
import { buildXp3 } from "./krkr-fixture.js";

/**
 * Build an XP3 container by hand: one info block, N segment records and one
 * adler over the recomposed whole. Only the fixture writer knows the standard
 * one-segment shape; this helper exists for the multi-segment case.
 *
 * @param {Array<{ name: string, segments: Array<{ mode: 0|1, stored: Buffer }>, whole: Buffer }>} files
 * @returns {Buffer}
 */
function manualXp3(files) {
  const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; };
  const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); return b; };
  const u64 = (v) => { const b = Buffer.alloc(8); const big = BigInt(v); b.writeUInt32LE(Number(big & 0xffffffffn), 0); b.writeUInt32LE(Number(big >> 32n), 4); return b; };
  const block = (magic, payload) => Buffer.concat([Buffer.from(magic, "latin1"), u64(payload.length), payload]);
  const dataChunks = [];
  let cursor = 40;
  const records = [];
  for (const file of files) {
    let storedTotal = 0;
    const segmentRecords = [];
    for (const segment of file.segments) {
      const start = cursor + storedTotal;
      dataChunks.push(segment.stored);
      storedTotal += segment.stored.length;
      segmentRecords.push(Buffer.concat([u32(segment.mode), u64(start), u64(0), u64(segment.declaredComp ?? segment.stored.length)]));
    }
    void cursor;
    const nameBuffer = Buffer.from(file.name, "utf16le");
    const info = Buffer.concat([u32(0), u64(file.whole.length), u64(storedTotal), u16(nameBuffer.length / 2), nameBuffer]);
    const segmPayload = Buffer.concat(segmentRecords);
    const adlr = u32(adler32(file.whole));
    const payload = Buffer.concat([block("info", info), block("segm", segmPayload), block("adlr", adlr)]);
    records.push(Buffer.concat([Buffer.from("File", "latin1"), u64(payload.length), payload]));
    cursor += storedTotal;
  }
  const index = Buffer.concat([Buffer.from("File", "latin1"), ...records]);
  const compressedIndex = zlib.deflateSync(index);
  const head = Buffer.alloc(40);
  Buffer.from("XP3\r\n \n\x1a", "latin1").copy(head, 0);
  u64(0x0117678b).copy(head, 8);
  u32(0x01000000).copy(head, 16);
  u32(0x80000000).copy(head, 20);
  u64(0).copy(head, 24);
  u64(cursor).copy(head, 32);
  const container = Buffer.concat([Buffer.from([1]), u64(compressedIndex.length), compressedIndex]);
  return Buffer.concat([head, ...dataChunks, container]);
}

const created = [];
function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-krkr-xp3-"));
  created.push(dir);
  return dir;
}

after(() => {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
});

const KS = Buffer.from("[test]\nhello\n", "utf8");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);

test("openXp3 lists entries with sizes and reads raw and zlib segments", () => {
  const file = path.join(tempDir(), "data.xp3");
  fs.writeFileSync(file, buildXp3([
    { name: "scenario/s1.ks", data: KS, mode: 1 },
    { name: "bg.png", data: PNG },
  ]));
  const archive = openXp3(file);
  assert.deepEqual(archive.entries.map((entry) => entry.name), ["scenario/s1.ks", "bg.png"]);
  const script = archive.entry("scenario/s1.ks");
  assert.equal(script.origSize, KS.length);
  assert.equal(script.origSize, KS.length, "origSize is the original file size");
  assert.equal(script.compSize, script.segments.reduce((sum, segment) => sum + segment.comp, 0), "compSize is the total stored size");
  assert.equal(script.read().toString("utf8"), "[test]\nhello\n");
  assert.equal(script.verify(), true, "adler32 of the recomposed file matches the stored hash");
  const image = archive.entry("bg.png");
  assert.equal(image.read().equals(PNG), true, "raw segments pass through untouched");
  assert.equal(image.verify(), true);
});

test("a multi-segment entry concatenates its segments in order", () => {
  const file = path.join(tempDir(), "data.xp3");
  // Shared-resource archives split one logical file across several stored
  // segments; the fixture writer only emits one, so hand-build the container.
  const first = Buffer.from("one-", "utf8");
  const second = Buffer.from("two", "utf8");
  const whole = Buffer.concat([first, second]);
  fs.writeFileSync(file, manualXp3([
    {
      name: "split.txt",
      segments: [
        { mode: 1, stored: zlib.deflateSync(first) },
        { mode: 1, stored: zlib.deflateSync(second) },
      ],
      whole,
    },
  ]));
  const archive = openXp3(file);
  assert.equal(archive.entries.length, 1);
  const entry = archive.entry("split.txt");
  assert.equal(entry.segments.length, 2);
  assert.equal(entry.read().equals(whole), true);
  assert.equal(entry.verify(), true);
});

test("a file that is not an archive is E_IO, not a crash", () => {
  const file = path.join(tempDir(), "junk.xp3");
  fs.writeFileSync(file, Buffer.from("this is not an archive at all, just text padding", "utf8"));
  assert.throws(
    () => openXp3(file),
    (error) => {
      assert.equal(error.code, "E_IO");
      assert.match(error.message, /not an XP3 archive/);
      return true;
    }
  );
});

test("an unsupported index format is E_UNSUPPORTED and names the format", () => {
  const file = path.join(tempDir(), "magic.xp3");
  fs.writeFileSync(file, buildXp3([{ name: "a.ks", data: KS }], { indexMagic: "Hxv4" }));
  assert.throws(
    () => openXp3(file),
    (error) => {
      assert.equal(error.code, "E_UNSUPPORTED");
      assert.match(error.message, /unsupported format \("Hxv4"\)/);
      return true;
    }
  );
});

test("a transformed header is E_UNSUPPORTED, not a crash", () => {
  // Some protection schemes rewrite the header: the fixed version mark and
  // the index offset turn into garbage. The reader must reject the archive
  // cleanly instead of failing on an out-of-range file position.
  const file = path.join(tempDir(), "marked.xp3");
  const buffer = Buffer.from(buildXp3([{ name: "a.ks", data: KS }]));
  buffer.writeBigUInt64LE(0x0d89162301678bn, 8);
  buffer.writeBigUInt64LE(0x274471a7b0f16ffcn, 32);
  fs.writeFileSync(file, buffer);
  assert.throws(
    () => openXp3(file),
    (error) => {
      assert.equal(error.code, "E_UNSUPPORTED");
      assert.match(error.message, /index offset points outside the archive/);
      return true;
    }
  );
});

test("an index offset outside the file is E_UNSUPPORTED, not a crash", () => {
  const file = path.join(tempDir(), "offset.xp3");
  const buffer = Buffer.from(buildXp3([{ name: "a.ks", data: KS }]));
  buffer.writeBigUInt64LE(0x7fn * (1n << 24n), 32);
  fs.writeFileSync(file, buffer);
  assert.throws(
    () => openXp3(file),
    (error) => {
      assert.equal(error.code, "E_UNSUPPORTED");
      assert.match(error.message, /index offset points outside the archive/);
      return true;
    }
  );
});

test("an index stream that claims more bytes than the archive is E_IO, not a crash", () => {
  const file = path.join(tempDir(), "oversize-index.xp3");
  const buffer = Buffer.from(buildXp3([{ name: "a.ks", data: KS }]));
  const indexOffset = Number(buffer.readBigUInt64LE(32));
  buffer.writeBigUInt64LE(BigInt(buffer.length) * 2n, indexOffset + 1);
  fs.writeFileSync(file, buffer);
  assert.throws(
    () => openXp3(file),
    (error) => {
      assert.equal(error.code, "E_IO");
      assert.match(error.message, /index stream is larger than the archive/);
      return true;
    }
  );
});

test("an index stream that inflates past the cap is E_IO, not an allocation", () => {
  // A tiny zlib stream can expand to gigabytes. The reader caps the index at
  // 64 MiB and reports a corrupt archive instead of allocating the output.
  const file = path.join(tempDir(), "index-bomb.xp3");
  const compressed = zlib.deflateSync(Buffer.alloc((64 << 20) + 1));
  const head = Buffer.alloc(40);
  Buffer.from("XP3\r\n \n\x1a", "latin1").copy(head, 0);
  head.writeBigUInt64LE(0x0117678bn, 8);
  head.writeUInt32LE(0x01000000, 16);
  head.writeUInt32LE(0x80000000, 20);
  head.writeBigUInt64LE(40n, 32);
  const size = Buffer.alloc(8);
  size.writeBigUInt64LE(BigInt(compressed.length), 0);
  const container = Buffer.concat([Buffer.from([1]), size, compressed]);
  fs.writeFileSync(file, Buffer.concat([head, container]));
  assert.throws(
    () => openXp3(file),
    (error) => {
      assert.equal(error.code, "E_IO");
      assert.match(error.message, /index stream does not decompress/);
      return true;
    }
  );
});

test("a segment that points outside the archive is E_IO when read", () => {
  const file = path.join(tempDir(), "bad-segment.xp3");
  const stored = Buffer.from("short", "utf8");
  fs.writeFileSync(file, manualXp3([
    {
      name: "bad.ks",
      segments: [{ mode: 0, stored, declaredComp: 4096 }],
      whole: stored,
    },
  ]));
  const entry = openXp3(file).entry("bad.ks");
  assert.throws(
    () => entry.read(),
    (error) => {
      assert.equal(error.code, "E_IO");
      assert.match(error.message, /points outside the archive/);
      return true;
    }
  );
});

test("adler32 matches the reference values", () => {
  assert.equal(adler32(Buffer.from("Wikipedia"), "latin1" === "never" ? 0 : undefined), 0x11e60398);
  assert.equal(adler32(Buffer.alloc(0)), 1);
});
