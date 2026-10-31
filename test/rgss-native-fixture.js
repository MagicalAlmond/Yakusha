/**
 * A fake native-assets directory for tests.
 *
 * The real components are prebuilt binaries and are not committed; tests only
 * need the manifest protocol and the copying behaviour, so four tiny files with
 * the right names and matching SHA-256 hashes are enough. Nothing here is ever
 * executed.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

export const COMPONENT_NAMES = ["yakusha_rgss_hook.dll", "libunwind.dll", "yakusha_injector.exe", "bootstrap.rb"];

function hash(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Create one fake assets directory.
 *
 * @param {Record<string, string>} [overrides] names to replace with other content
 * @returns {{ dir: string, files: Record<string, string> }}
 */
export function nativeAssets(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-native-assets-"));
  const files = {};
  for (const name of COMPONENT_NAMES) {
    const content = overrides[name] !== undefined ? overrides[name] : "fake " + name;
    fs.writeFileSync(path.join(dir, name), content);
    files[name] = hash(Buffer.from(content));
  }
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ schema: 1, files }, null, 2) + "\n");
  return { dir, files };
}
