/**
 * Traditional-only characters shared by every language pair.
 *
 * The table is flat: each two-character slice holds a simplified character
 * followed by its traditional counterpart, and only the traditional half is
 * reported by the audit.
 *
 * @module languages/traditional
 */

import { TRADITIONAL_JOINED } from "../data/traditional.js";

/** Traditional-only characters, built once from the flat pair table. */
export const TRADITIONAL = (() => {
  const set = new Set();
  for (let i = 0; i + 1 < TRADITIONAL_JOINED.length; i += 2) set.add(TRADITIONAL_JOINED[i]);
  return set;
})();
