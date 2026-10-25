/**
 * The JSON envelope every --json run prints, and the one place an error is
 * turned into something safe to show.
 *
 * The contract (docs/json-contract.md) fixes the first six keys and their
 * order: schema, command, ok, outcome, error, then the flat payload. Keeping
 * construction in one function is what lets the tests assert "exactly one
 * object on stdout" for every command instead of trusting twelve call sites.
 *
 * @module cli/envelope
 */

import process from "node:process";
import { homedir } from "node:os";

/**
 * Process exit codes, keyed by outcome. This mapping is the contract: an
 * error always wins over findings, and findings only exist for verify and a
 * broken doctor verdict.
 */
export const EXIT = Object.freeze({ ok: 0, findings: 1, error: 2 });

/** Keys the envelope owns; a payload may not shadow them. */
const RESERVED = new Set(["schema", "command", "ok", "outcome", "error"]);

/** Escape sequences and control bytes that would corrupt a one line message. */
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
/** Secrets that must never reach a log: API keys, bearer tokens, URL userinfo. */
const API_KEY = /sk-[A-Za-z0-9_-]{8,}/g;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const USERINFO = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi;
const MAX_MESSAGE = 500;

/**
 * An expected failure: the caller asked for something the tool cannot do, and
 * the answer is a documented code instead of a stack trace.
 */
export class CliError extends Error {
  /**
   * @param {string} code one of the documented E_* codes
   * @param {string} message human readable, single line
   * @param {Record<string, unknown>} [details] optional structured context
   */
  constructor(code, message, details) {
    super(message);
    this.name = "CliError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

/**
 * Fold one message into a single safe line.
 *
 * Everything a user sees goes through here: no ANSI, no control characters, no
 * multi line stack, no API key, no bearer token, no password embedded in a
 * URL, and no absolute home directory (a bug report can be pasted in public).
 *
 * @param {unknown} input
 * @returns {string}
 */
export function sanitizeMessage(input) {
  let text = String(input === undefined || input === null ? "" : input);
  text = text.replace(ANSI, " ");
  text = text.replace(CONTROL, " ");
  text = text.replace(API_KEY, "sk-***");
  text = text.replace(BEARER, "Bearer ***");
  text = text.replace(USERINFO, "$1***@");
  let home = "";
  try {
    home = homedir();
  } catch {
    home = "";
  }
  if (home) {
    for (const spelling of [home, home.replace(/\\/g, "/")]) {
      if (spelling) text = text.split(spelling).join("~");
    }
  }
  text = text.replace(/\s+/g, " ").trim();
  if (text.length > MAX_MESSAGE) text = text.slice(0, MAX_MESSAGE);
  return text;
}

/**
 * Sanitise the string values of a details object, leaving structure alone.
 *
 * @param {unknown} details
 * @returns {unknown}
 */
function sanitizeDetails(details) {
  if (!details || typeof details !== "object" || Array.isArray(details)) return details;
  const out = {};
  for (const [key, value] of Object.entries(details)) {
    if (typeof value === "string") out[key] = sanitizeMessage(value);
    else if (Array.isArray(value)) out[key] = value.map((item) => (typeof item === "string" ? sanitizeMessage(item) : item));
    else out[key] = value;
  }
  return out;
}

/**
 * Build the success/findings envelope.
 *
 * @param {string|null} command
 * @param {"ok"|"findings"|"error"} outcome
 * @param {Record<string, unknown>} [payload]
 * @returns {Record<string, unknown>}
 */
export function buildEnvelope(command, outcome, payload = {}) {
  if (!Object.hasOwn(EXIT, outcome)) throw new Error("unknown outcome: " + outcome);
  const body = {
    schema: 1,
    command: command === undefined ? null : command,
    ok: outcome === "ok",
    outcome,
    error: null,
  };
  for (const [key, value] of Object.entries(payload)) {
    if (RESERVED.has(key)) throw new Error("payload must not use the reserved key: " + key);
    body[key] = value;
  }
  return body;
}

/**
 * Build the error envelope.
 *
 * @param {string|null} command
 * @param {string} code
 * @param {unknown} message
 * @param {Record<string, unknown>} [details]
 * @returns {Record<string, unknown>}
 */
export function buildErrorEnvelope(command, code, message, details) {
  const error = { code: String(code), message: sanitizeMessage(message) };
  if (details !== undefined) error.details = sanitizeDetails(details);
  return {
    schema: 1,
    command: command === undefined ? null : command,
    ok: false,
    outcome: "error",
    error,
  };
}

/**
 * Print one envelope and return the process exit code it implies.
 *
 * @param {string|null} command
 * @param {"ok"|"findings"} outcome
 * @param {Record<string, unknown>} [payload]
 * @returns {number}
 */
export function emit(command, outcome, payload) {
  process.stdout.write(JSON.stringify(buildEnvelope(command, outcome, payload)) + "\n");
  return EXIT[outcome];
}

/**
 * Print one error envelope and return the error exit code.
 *
 * @param {string|null} command
 * @param {string} code
 * @param {unknown} message
 * @param {Record<string, unknown>} [details]
 * @returns {number}
 */
export function emitError(command, code, message, details) {
  process.stdout.write(JSON.stringify(buildErrorEnvelope(command, code, message, details)) + "\n");
  return EXIT.error;
}

/** Errors that mean "the file system refused", not "yakusha is broken". */
const IO_CODES = new Set([
  "ENOENT",
  "EACCES",
  "EPERM",
  "EISDIR",
  "ENOTDIR",
  "EEXIST",
  "ENOTEMPTY",
  "ENOSPC",
  "EROFS",
  "EBUSY",
  "EMFILE",
  "ENFILE",
  "ELOOP",
  "EIO",
]);

/**
 * Turn anything thrown into a documented failure.
 *
 * @param {unknown} error
 * @returns {CliError}
 */
export function failureFor(error) {
  if (error instanceof CliError) return error;
  const code = error && typeof error === "object" ? error.code : undefined;
  const message = error && typeof error === "object" && error.message ? error.message : String(error);
  if (typeof code === "string" && /^E_[A-Z][A-Z_]*$/.test(code)) return new CliError(code, message);
  if (typeof code === "string" && IO_CODES.has(code)) return new CliError("E_IO", message);
  return new CliError("E_INTERNAL", message);
}
