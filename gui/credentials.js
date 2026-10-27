// Credential storage for the GUI: Electron safeStorage (DPAPI on Windows),
// opt-in only. The renderer never persists the key; the main process
// encrypts it into a small JSON envelope and decrypts it only to hand it to
// the runner as a flag. The CLI never reads this file (docs/config.md §8).

import { join } from "node:path";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

/** The credentials envelope lives next to the config file's default home. */
export function credentialsFile(configDir) {
  return join(configDir, "credentials");
}

/**
 * @param {{ isEncryptionAvailable?: () => boolean, encryptString: (s: string) => Buffer, decryptString: (b: Buffer) => string }} safeStorage
 */
export function saveApiKey(file, key, safeStorage) {
  if (!safeStorage.isEncryptionAvailable || safeStorage.isEncryptionAvailable()) {
    const blob = safeStorage.encryptString(key);
    mkdirSync(file.slice(0, Math.max(file.lastIndexOf("/"), file.lastIndexOf("\\"))), { recursive: true });
    const envelope = { schema: 1, cipher: "safeStorage", data: blob.toString("base64") };
    writeFileSync(file, JSON.stringify(envelope, null, 2) + "\n");
    return { saved: true };
  }
  // No OS-level encryption: refuse instead of writing plaintext.
  return { saved: false, reason: "secure storage is not available on this system" };
}

/** Returns {key} or {error}; never falls back to plaintext or throws on read. */
export function readApiKey(file, safeStorage) {
  let envelope;
  try {
    envelope = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { error: "the stored credentials cannot be read; enter the key again" };
  }
  if (!envelope || envelope.schema !== 1 || envelope.cipher !== "safeStorage" || typeof envelope.data !== "string") {
    return { error: "the stored credentials are not in a recognised format; enter the key again" };
  }
  try {
    return { key: safeStorage.decryptString(Buffer.from(envelope.data, "base64")) };
  } catch {
    return { error: "the stored credentials cannot be decrypted; enter the key again" };
  }
}

export function clearApiKey(file) {
  rmSync(file, { force: true });
  return { cleared: true };
}

export function hasApiKey(file) {
  try { readFileSync(file, "utf8"); return true; } catch { return false; }
}
