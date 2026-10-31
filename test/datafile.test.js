import test from "node:test";
import assert from "node:assert/strict";
import { decodeBuffer, xorKeyCandidates } from "../src/core/datafile.js";

const enc = (text, key) => {
  const buf = Buffer.from(text, "utf8");
  const out = Buffer.alloc(buf.length);
  for (let i = 0; i < buf.length; i += 1) out[i] = buf[i] ^ key;
  return out;
};

test("plain JSON decodes as json", () => {
  const r = decodeBuffer(Buffer.from('[{"id":1,"name":"x"}]', "utf8"));
  assert.equal(r.encoding, "json");
  assert.equal(r.data[0].name, "x");
});

test("a UTF-8 BOM does not break plain JSON", () => {
  const r = decodeBuffer(Buffer.from("\uFEFF" + '["a"]', "utf8"));
  assert.equal(r.encoding, "json");
  assert.deepEqual(r.data, ["a"]);
});

test("a single byte XOR obfuscation is detected and recovered", () => {
  const r = decodeBuffer(enc('["a","b"]', 0x5a));
  assert.equal(r.encoding, "xor");
  assert.equal(r.key, 0x5a);
  assert.deepEqual(r.data, ["a", "b"]);
});

test("an object document encrypted with XOR is recovered too", () => {
  const r = decodeBuffer(enc('{"displayName":"x"}', 0x2b));
  assert.equal(r.encoding, "xor");
  assert.equal(r.data.displayName, "x");
});

test("a realistic per-file XOR key still decodes", () => {
  const key = 0xab;
  const r = decodeBuffer(enc(JSON.stringify({ a: [1, 2, 3] }), key));
  assert.equal(r.encoding, "xor");
  assert.deepEqual(r.data.a, [1, 2, 3]);
});

test("garbage is reported instead of returning a bogus document", () => {
  const r = decodeBuffer(Buffer.from(Array.from({ length: 64 }, (_, i) => (i * 7 + 3) & 0xff)));
  assert.equal(r.data, null);
  assert.ok(r.error);
});

test("an empty file is empty, not undecodable", () => {
  const r = decodeBuffer(Buffer.alloc(0));
  assert.equal(r.data, null);
  assert.equal(r.encoding, "empty");
  assert.equal(r.error, undefined);
});

test("a whitespace only file counts as empty too", () => {
  const r = decodeBuffer(Buffer.from("\r\n  \t\r\n", "utf8"));
  assert.equal(r.encoding, "empty");
  assert.equal(r.error, undefined);
});

test("the XOR probe only tries keys that can start a document", () => {
  const allowed = new Set([0x5b, 0x7b, 0x20, 0x09, 0x0a, 0x0d, 0xef]);
  for (let first = 0; first < 256; first += 1) {
    const keys = xorKeyCandidates(first);
    assert.ok(keys.length <= 8, "first byte " + first + " produced " + keys.length + " candidates");
    for (const key of keys) assert.ok(allowed.has(first ^ key), "candidate " + key + " cannot start a document");
  }
});

test("XOR recovery still works when the encoded file starts with whitespace", () => {
  const r = decodeBuffer(enc(' \n["a","b"]', 0x37));
  assert.equal(r.encoding, "xor");
  assert.deepEqual(r.data, ["a", "b"]);
});

test("XOR recovery still works when the encoded file starts with a BOM", () => {
  const r = decodeBuffer(enc("\uFEFF[\"a\"]", 0x37));
  assert.equal(r.encoding, "xor");
  assert.deepEqual(r.data, ["a"]);
});
