/**
 * Read-only project facts the GUI needs outside the command runner.
 *
 * The dictionary count drives the Translated/Pending stats and the launch
 * buttons; RGSS additionally needs the native injector state to tell the
 * original game apart from the translated one. This module is electron-free so
 * the logic can be tested with plain node.
 *
 * @module gui/project-state
 */

import { nativeStatus } from "../src/engines/rgss/native.js";
import { readDictionary } from "./dictionary.js";

/**
 * @param {string} root project root
 * @param {string} [engine] engine id reported by scan
 * @returns {{ ok: true, dictionary: { exists: boolean, translated: number, pending: number, total: number }, native: { installed: boolean, intact: boolean } } | { ok: false, error: { code: string, message: string } }}
 */
export function projectState(root, engine) {
  const result = {
    ok: true,
    dictionary: { exists: false, translated: 0, pending: 0, total: 0 },
    native: { installed: false, intact: false },
  };
  if (!root) return result;

  try {
    const dictionary = readDictionary(root);
    result.dictionary = {
      exists: true,
      translated: dictionary.translated,
      pending: dictionary.pendingCount,
      total: dictionary.entries.length,
    };
  } catch (error) {
    if (!error || error.code !== "E_NO_DICTIONARY") {
      return {
        ok: false,
        error: {
          code: error && error.code ? error.code : "E_INTERNAL",
          message: String(error && error.message ? error.message : error),
        },
      };
    }
  }

  if (engine === "rgss") {
    try {
      const status = nativeStatus({ root });
      result.native = { installed: status.installed === true, intact: status.intact === true };
    } catch {
      // A damaged native layer must not break the page: report "not installed".
    }
  }
  return result;
}
