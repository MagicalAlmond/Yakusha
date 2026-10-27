/**
 * Engine registry.
 *
 * Detection order is part of the public contract: MZ first, MV second, Ren'Py
 * third, RGSS fourth, Kirikiri fifth, and a multi-root directory stops the
 * search immediately.
 * Adding an engine means adding one adapter here, not teaching the CLI about it.
 *
 * @module engines/registry
 */

import { adapter as mzAdapter } from "./mz/adapter.js";
import { adapter as mvAdapter } from "./mv/adapter.js";
import { adapter as renpyAdapter } from "./renpy/adapter.js";
import { adapter as rgssAdapter } from "./rgss/adapter.js";
import { adapter as krkrAdapter } from "./krkr/adapter.js";

const ADAPTERS = [mzAdapter, mvAdapter, renpyAdapter, rgssAdapter, krkrAdapter];

/**
 * Prefixes of the "nothing here" message every adapter writes.
 *
 * Kept as a list so a new engine only adds its own wording: an unrecognised
 * E_NOT_PROJECT means the search should keep going instead of stopping.
 */
const NOT_PROJECT_PREFIXES = [
  "not an RPG Maker project",
  "not a Ren'Py project",
  "not an RGSS project",
  "not a Kirikiri project",
];

/** True for the generic "nothing here" failure, false for a diagnosed root. */
function isGenericNotProject(result) {
  return (
    result.code === "E_NOT_PROJECT" &&
    NOT_PROJECT_PREFIXES.some((prefix) => result.message.startsWith(prefix))
  );
}

/**
 * Every registered adapter, in detection order.
 *
 * @returns {Array<typeof mzAdapter>}
 */
export function getAdapters() {
  return ADAPTERS.slice();
}

/**
 * Look up one adapter by engine id. Unknown ids return null, never throw.
 *
 * @param {string} engine
 * @returns {typeof mzAdapter | null}
 */
export function getAdapter(engine) {
  return ADAPTERS.find((adapter) => adapter.id === engine) || null;
}

/**
 * Detect the engine of a project directory.
 *
 * The result is the adapter detect shape plus the adapter that matched. When
 * both adapters fail, a diagnosed failure (missing data/ or plugins.js) wins
 * over the generic "not a project" message, so callers keep the message users
 * already know.
 *
 * @param {string} startDir
 * @returns {{ ok: true, project: import("../core/mzproject.js").Project, adapter: typeof mzAdapter } | { ok: false, code: string, message: string, candidates?: string[] }}
 */
export function detectProject(startDir) {
  let generic = null;
  for (const adapter of ADAPTERS) {
    const result = adapter.detect(startDir);
    if (result.ok) return { ok: true, project: result.project, adapter };
    if (result.code === "E_MULTI_ROOT") return result;
    if (!isGenericNotProject(result)) return result;
    if (!generic) generic = result;
  }
  return generic;
}
