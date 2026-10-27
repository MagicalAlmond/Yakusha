// gui/credentials.js: safeStorage envelope round-trip and failure modes.
// The mock encryptor stands in for Electron's safeStorage (DPAPI on Windows);
// the contract under test is the file format and the refusal to store or
// recover plaintext when anything is off (docs/config.md §8).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { clearApiKey, credentialsFile, hasApiKey, readApiKey, saveApiKey } from "../gui/credentials.js";

const HOME = mkdtempSync(join(tmpdir(), "yakusha-cred-"));
const FILE = credentialsFile(HOME);

function mockStorage(available = true) {
  const store = new Map();
  let seq = 0;
  return {
    isEncryptionAvailable: () => available,
    encryptString: (s) => { const b = Buffer.from("blob:" + ++seq + ":" + s, "utf8"); store.set(b.toString("base64"), s); return b; },
    decryptString: (b) => { const s = store.get(b.toString("base64")); if (s === undefined) throw new Error("nope"); return s; },
  };
}

test("save then read round-trips the key", () => {
  const storage = mockStorage();
  const result = saveApiKey(FILE, "sk-test-123", storage);
  assert.deepEqual(result, { saved: true });
  assert.equal(readApiKey(FILE, storage).key, "sk-test-123");
  assert.equal(hasApiKey(FILE), true);
  // The file never contains the plaintext key.
  assert.equal(readFileSync(FILE, "utf8").includes("sk-test-123"), false);
  const envelope = JSON.parse(readFileSync(FILE, "utf8"));
});

test("unavailable encryption refuses instead of writing plaintext", () => {
  const target = credentialsFile(HOME) + ".unavail";
  const result = saveApiKey(target, "sk-x", mockStorage(false));
  assert.equal(result.saved, false);
  assert.equal(hasApiKey(target), false);
});

test("a corrupted or missing file reports an error, never throws", () => {
  assert.ok(readApiKey(FILE + ".missing", mockStorage()).error);
  writeFileSync(FILE + ".junk", "not json");
  assert.ok(readApiKey(FILE + ".junk", mockStorage()).error);
  writeFileSync(FILE + ".bad", JSON.stringify({ schema: 2, cipher: "safeStorage", data: "AAAA" }));
  assert.ok(readApiKey(FILE + ".bad", mockStorage()).error);
  writeFileSync(FILE + ".bad2", JSON.stringify({ schema: 1, cipher: "plaintext", data: "sk-leak" }));
  assert.ok(readApiKey(FILE + ".bad2", mockStorage()).error);
});

test("undecryptable data reports an error instead of throwing", () => {
  writeFileSync(FILE + ".undec", JSON.stringify({ schema: 1, cipher: "safeStorage", data: "AAAA" }));
  assert.ok(readApiKey(FILE + ".undec", mockStorage()).error);
});

test("clear removes the file and hasApiKey agrees", () => {
  assert.deepEqual(clearApiKey(FILE), { cleared: true });
  assert.equal(hasApiKey(FILE), false);
  rmSync(HOME, { recursive: true, force: true });
});
