/**
 * Reading `data/*.json` files from arbitrary RPG Maker projects.
 *
 * Vanilla MZ writes plain JSON. A large share of shipped games wrap the data
 * files in a single-byte XOR obfuscation (sometimes with a per-file key derived
 * from the file name). The extraction layer must see the plain JSON either way,
 * otherwise a whole engine generation silently yields zero strings.
 *
 * The decoder never guesses blindly: a candidate is only accepted when the
 * result actually parses as JSON and looks like a database document. Anything we
 * cannot decode is reported, never silently skipped.
 *
 * @module core/datafile
 */

import fs from "node:fs";
import path from "node:path";

/**
 * @typedef {object} DecodedData
 * @property {any} data parsed document, or null when decoding failed
 * @property {string} encoding "json" | "xor" | "empty"
 * @property {number} [key] single byte XOR key, when encoding is "xor"
 * @property {string} [error] reason the file could not be decoded
 */

const BOM = "\uFEFF";

/**
 * Read and decode one database file.
 *
 * @param {string} file absolute path to the .json file
 * @returns {DecodedData}
 */
export function readDataFile(file) {
  let buffer;
  try {
    buffer = fs.readFileSync(file);
  } catch (error) {
    return { data: null, encoding: "json", error: "unreadable: " + error.message };
  }
  return decodeBuffer(buffer);
}

/**
 * Decode raw bytes into a parsed document.
 *
 * @param {Buffer | Uint8Array} buffer
 * @returns {DecodedData}
 */
export function decodeBuffer(buffer) {
  // Some shipped games ship a 0 byte placeholder (a dev leftover such as
  // "结果.json"). It holds no text, so it is empty rather than
  // undecodable - reporting it as a decode failure only creates noise.
  if (isBlank(buffer)) return { data: null, encoding: "empty" };
  const plan = attemptPlain(buffer);
  if (plan.data !== null) return plan;
  const xor = attemptXor(buffer);
  if (xor.data !== null) return xor;
  return { data: null, encoding: plan.encoding, error: "not plain JSON and no single byte XOR key parses" };
}

/** @param {Buffer | Uint8Array} buffer */
function isBlank(buffer) {
  for (let i = 0; i < buffer.length; i += 1) {
    const byte = buffer[i];
    if (byte !== 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d && byte !== 0x00) return false;
  }
  return true;
}

function attemptPlain(buffer) {
  let text = buffer.toString("utf8");
  if (text.startsWith(BOM)) text = text.slice(1);
  const trimmed = text.trimStart();
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) {
    return { data: null, encoding: "json" };
  }
  try {
    return { data: JSON.parse(text), encoding: "json" };
  } catch {
    return { data: null, encoding: "json" };
  }
}

function attemptXor(buffer) {
  // A single byte key that leaves a leading `[` or `{` is the only kind of
  // obfuscation we can recover without game specific code, so try those first.
  const first = buffer[0];
  const candidates = [];
  for (const wanted of [0x5b, 0x7b]) {
    const key = first ^ wanted;
    if (!candidates.includes(key)) candidates.push(key);
  }
  // Then the rest, in case the file starts with whitespace.
  for (let key = 0; key < 256; key += 1) {
    if (!candidates.includes(key)) candidates.push(key);
  }

  for (const key of candidates) {
    const decoded = new Uint8Array(buffer.length);
    for (let i = 0; i < buffer.length; i += 1) decoded[i] = buffer[i] ^ key;
    const parsed = attemptPlain(Buffer.from(decoded));
    if (parsed.data !== null) return { data: parsed.data, encoding: "xor", key };
  }
  return { data: null, encoding: "xor" };
}

/**
 * Read every database file of a project, decoding as needed.
 *
 * @param {string} dataDir directory holding the .json files
 * @returns {{ name: string, data: any, encoding: string, error?: string }[]}
 */
export function readDataDir(dataDir) {
  const out = [];
  let names;
  try {
    names = fs
      .readdirSync(dataDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return out;
  }
  for (const name of names) {
    const decoded = readDataFile(path.join(dataDir, name));
    out.push({ name, data: decoded.data, encoding: decoded.encoding, error: decoded.error });
  }
  return out;
}
