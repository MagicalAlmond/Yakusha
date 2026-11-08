/**
 * Engine-neutral adapter contract.
 *
 * Every engine module exposes the same small vocabulary: a complete capability
 * object, the detect result shapes and the shared not-implemented error. None
 * of this knows about a particular engine's project format.
 *
 * @module engines/contract
 */

/** Capability names every adapter must expose (docs/engines.md §3). */
export const CAPABILITY_KEYS = Object.freeze([
  "extract",
  "export",
  "runtime",
  "launch",
  "debuggable",
  "attach",
  "liveReload",
]);

/**
 * Build a complete capability object, overriding only what an engine supports.
 *
 * Unknown capabilities stay false so a new adapter cannot accidentally claim
 * something just by omitting it.
 *
 * @param {Record<string, unknown>} [overrides]
 * @returns {Record<string, unknown>}
 */
export function capabilities(overrides = {}) {
  return {
    extract: false,
    export: false,
    runtime: null,
    launch: false,
    debuggable: false,
    attach: false,
    liveReload: false,
    ...overrides,
  };
}

/**
 * @param {import("../core/mzproject.js").Project} project
 * @returns {{ ok: true, project: import("../core/mzproject.js").Project }}
 */
export function detectOk(project) {
  return { ok: true, project };
}

/** Typed reasons for a failed detect, so the registry never classifies by message text. */
export const DETECT_REASONS = Object.freeze({
  /** This engine does not recognise the directory; keep trying the next adapter. */
  NOT_PROJECT: "not-project",
  /** The engine recognised its own project but it is incomplete; stop searching. */
  INCOMPLETE_PROJECT: "incomplete-project",
});

/**
 * @param {"E_NOT_PROJECT"|"E_MULTI_ROOT"} code
 * @param {string} message
 * @param {string[]} [candidates]
 * @param {"not-project"|"incomplete-project"} [reason]
 * @returns {{ ok: false, code: string, message: string, candidates?: string[], reason?: string }}
 */
export function detectFail(code, message, candidates, reason = code === "E_NOT_PROJECT" ? DETECT_REASONS.NOT_PROJECT : null) {
  const result = { ok: false, code, message };
  if (Array.isArray(candidates) && candidates.length > 0) {
    result.candidates = [...candidates];
  }
  if (reason) result.reason = reason;
  return result;
}

/** A launch/attach placeholder that names the missing feature. */
export function notImplemented(what) {
  const error = new Error(what + " is not implemented in 0.10");
  error.code = "E_NOT_IMPLEMENTED";
  return error;
}
