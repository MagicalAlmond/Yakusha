/**
 * User level configuration (docs/config.md).
 *
 * 0.10 has exactly one config file, in the user's profile; a game directory
 * cannot change where requests go. The file never holds a key, so it is safe to
 * share a game folder (and its dictionary) without leaking one.
 *
 * This module owns the file format, validation, the broken-file policy and the
 * atomic write. The CLI owns only the payload and the text summary.
 *
 * @module cli/config
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { CliError } from "./envelope.js";

/** The endpoint used when provider is openai and no base URL is configured. */
export const DEFAULT_BASE_URL = "https://api.openai.com/v1";

/** Keys a user may read or write with the config command. */
export const CONFIG_KEYS = ["provider", "model", "baseUrl"];

/** Names that would turn the config file into a secret store. Never used or shown. */
const SENSITIVE = new Set(["apikey", "key", "token", "authorization"]);

const PROVIDERS = new Set(["openai", "compatible", "mock"]);
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * Resolve the config file path.
 *
 * YAKUSHA_CONFIG_DIR names a directory (not a file) and exists so tests and
 * advanced users can isolate the file. Everything else follows APPDATA; there
 * is deliberately no XDG or macOS fallback.
 *
 * @param {Record<string, string|undefined>} [env]
 * @returns {string}
 */
export function configFilePath(env = process.env) {
  const injected = env.YAKUSHA_CONFIG_DIR;
  let dir;
  if (injected !== undefined && injected !== "") {
    if (!path.isAbsolute(injected)) {
      throw new CliError("E_CONFIG", "YAKUSHA_CONFIG_DIR must be an absolute directory: " + injected);
    }
    dir = injected;
  } else {
    if (!env.APPDATA) {
      throw new CliError(
        "E_CONFIG",
        "APPDATA is not set and YAKUSHA_CONFIG_DIR is not set; cannot locate the config file"
      );
    }
    dir = path.join(env.APPDATA, "yakusha");
  }
  return path.join(dir, "config.json");
}

/**
 * @typedef {object} Validation
 * @property {boolean} ok
 * @property {string} [value] canonical value when ok
 * @property {string} [message] why it is invalid
 */

/**
 * Validate and canonicalise one config value.
 *
 * @param {string} key
 * @param {unknown} value
 * @returns {Validation}
 */
export function validateConfigValue(key, value) {
  if (key === "provider") {
    if (typeof value !== "string") return { ok: false, message: "provider must be a string" };
    const normalised = value.trim().toLowerCase();
    if (!PROVIDERS.has(normalised)) {
      return { ok: false, message: "provider must be openai, compatible or mock" };
    }
    return { ok: true, value: normalised };
  }
  if (key === "model") {
    if (typeof value !== "string") return { ok: false, message: "model must be a string" };
    const normalised = value.trim();
    if (normalised.length === 0) return { ok: false, message: "model must not be empty" };
    if (normalised.length > 200) return { ok: false, message: "model must be at most 200 characters" };
    if (CONTROL.test(normalised)) return { ok: false, message: "model must not contain control characters" };
    return { ok: true, value: normalised };
  }
  if (key === "baseUrl") {
    if (typeof value !== "string") return { ok: false, message: "baseUrl must be a string" };
    const normalised = value.trim().replace(/\/+$/, "");
    if (normalised.length === 0) return { ok: false, message: "baseUrl must not be empty" };
    if (normalised.length > 2000) return { ok: false, message: "baseUrl must be at most 2000 characters" };
    if (CONTROL.test(normalised)) return { ok: false, message: "baseUrl must not contain control characters" };
    let parsed;
    try {
      parsed = new URL(normalised);
    } catch {
      return { ok: false, message: "baseUrl must be an absolute http(s) URL" };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { ok: false, message: "baseUrl must use http or https" };
    }
    if (!parsed.hostname) return { ok: false, message: "baseUrl must name a host" };
    if (parsed.username || parsed.password) {
      return { ok: false, message: "baseUrl must not contain a username or password" };
    }
    if (parsed.search || parsed.hash) {
      return { ok: false, message: "baseUrl must not contain a query string or fragment" };
    }
    return { ok: true, value: normalised };
  }
  return { ok: false, message: "unknown config key: " + key };
}

/**
 * One warning per sensitive key; the value is never read into the message.
 *
 * @param {Record<string, unknown>} raw
 * @param {string} file
 * @returns {string[]}
 */
function sensitiveWarnings(raw, file) {
  const warnings = [];
  for (const key of Object.keys(raw)) {
    if (!SENSITIVE.has(key.toLowerCase())) continue;
    warnings.push('ignoring sensitive key "' + key + '" in ' + file + "; keys are not stored in the config file");
  }
  return warnings;
}

/**
 * @typedef {object} LoadedConfig
 * @property {string} file
 * @property {boolean} exists
 * @property {Record<string, string>} config validated known values
 * @property {Record<string, unknown>|null} raw parsed object, null when unreadable
 * @property {string[]} warnings caller prints as "warning: ..."
 * @property {boolean} broken true when the file must not be used
 * @property {string|null} problem phrase for E_CONFIG
 */

/**
 * Read the config file without throwing on a broken file.
 *
 * A broken file is a warning for translate (the offline modes must keep
 * working) but an error for the config command (the user asked to inspect the
 * file, so "it is broken" is the answer). Read failures and a missing APPDATA
 * are environment errors and do throw.
 *
 * @param {{env?: Record<string, string|undefined>, file?: string}} [options]
 * @returns {LoadedConfig}
 */
export function loadConfig(options = {}) {
  const env = options.env || process.env;
  const file = options.file || configFilePath(env);
  const warnings = [];
  /** @type {(problem: string, warning: string, raw?: Record<string, unknown>|null) => LoadedConfig} */
  const broken = (problem, warning, raw = null) => ({
    file,
    exists: true,
    config: {},
    raw,
    warnings: warnings.concat(warning),
    broken: true,
    problem,
  });

  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { file, exists: false, config: {}, raw: null, warnings, broken: false, problem: null };
    }
    const code = error && error.code ? error.code : "read failed";
    throw new CliError("E_IO", "cannot read config file: " + file + " (" + code + ")");
  }

  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return broken("config file is not valid JSON", "config file is not valid JSON: " + file + "; using defaults");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return broken(
      "config file must contain a JSON object",
      "config file must contain a JSON object: " + file + "; using defaults"
    );
  }

  const schema = raw.schema === undefined ? 1 : raw.schema;
  if (schema !== 1) {
    return broken(
      "unsupported config schema " + JSON.stringify(raw.schema),
      "unsupported config schema " + JSON.stringify(raw.schema) + " in " + file + "; using defaults"
    );
  }

  /** @type {Record<string, string>} */
  const config = {};
  const sensitive = sensitiveWarnings(raw, file);
  warnings.push(...sensitive);
  for (const [key, value] of Object.entries(raw)) {
    if (SENSITIVE.has(key.toLowerCase())) continue;
    if (!CONFIG_KEYS.includes(key)) continue;
    const checked = validateConfigValue(key, value);
    if (!checked.ok) {
      warnings.push("ignoring invalid " + key + " in " + file + ": " + checked.message);
      continue;
    }
    config[key] = checked.value;
  }
  return { file, exists: true, config, raw, warnings, broken: false, problem: null };
}

/**
 * Throw E_CONFIG when a command that inspects or edits the file finds it
 * broken. translate never calls this; it warns and continues.
 *
 * @param {LoadedConfig} loaded
 * @returns {LoadedConfig}
 */
export function requireUsableConfig(loaded) {
  if (!loaded.broken) return loaded;
  throw new CliError("E_CONFIG", loaded.problem + " in " + loaded.file + " (fix or delete it)");
}

/**
 * Resolve each value to its winning source.
 *
 * Sources are file / env / default / none for the config command. translate
 * also passes flags, which win over env and file and are reported as "flag".
 *
 * @param {LoadedConfig} loaded
 * @param {{flags?: Record<string, unknown>, env?: Record<string, string|undefined>}} [options]
 * @returns {{
 *   provider: {value: string|null, source: string},
 *   model: {value: string|null, source: string},
 *   baseUrl: {value: string|null, source: string},
 *   apiKey: {set: boolean, source: string|null}
 * }}
 */
export function resolveEffective(loaded, options = {}) {
  const env = options.env || process.env;
  const flags = options.flags || {};
  const config = loaded.config || {};

  const text = (value) => (typeof value === "string" ? value.trim() : "");

  let provider;
  const providerFlag = text(flags.provider);
  if (providerFlag) provider = { value: providerFlag, source: "flag" };
  else if (config.provider !== undefined) provider = { value: config.provider, source: "file" };
  else provider = { value: null, source: "none" };

  let model;
  const modelFlag = text(flags.model);
  const modelEnv = text(env.YAKUSHA_MODEL);
  if (modelFlag) model = { value: modelFlag, source: "flag" };
  else if (modelEnv) model = { value: modelEnv, source: "env" };
  else if (config.model !== undefined) model = { value: config.model, source: "file" };
  else model = { value: null, source: "none" };

  let baseUrl;
  const baseFlag = text(flags["base-url"]).replace(/\/+$/, "");
  const baseEnv = text(env.YAKUSHA_BASE_URL).replace(/\/+$/, "");
  if (baseFlag) baseUrl = { value: baseFlag, source: "flag" };
  else if (baseEnv) baseUrl = { value: baseEnv, source: "env" };
  else if (config.baseUrl !== undefined) baseUrl = { value: config.baseUrl, source: "file" };
  else if (provider.value === "compatible") baseUrl = { value: null, source: "none" };
  else baseUrl = { value: DEFAULT_BASE_URL, source: "default" };

  let apiKey;
  const keyFlag = text(flags["api-key"]);
  if (keyFlag) apiKey = { set: true, source: "--api-key" };
  else if (env.YAKUSHA_API_KEY) apiKey = { set: true, source: "YAKUSHA_API_KEY" };
  else if (env.OPENAI_API_KEY) apiKey = { set: true, source: "OPENAI_API_KEY" };
  else apiKey = { set: false, source: null };

  return { provider, model, baseUrl, apiKey };
}

/**
 * Read the file again immediately before a write, so unknown keys survive and
 * a file that became broken after the first read is never overwritten.
 *
 * @param {string} file
 * @returns {{raw: Record<string, unknown>, warnings: string[]}}
 */
function readRawConfig(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") return { raw: {}, warnings: [] };
    const code = error && error.code ? error.code : "read failed";
    throw new CliError("E_IO", "cannot read config file: " + file + " (" + code + ")");
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new CliError("E_CONFIG", "config file is not valid JSON: " + file + " (fix or delete it)");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new CliError("E_CONFIG", "config file must contain a JSON object: " + file + " (fix or delete it)");
  }
  const schema = raw.schema === undefined ? 1 : raw.schema;
  if (schema !== 1) {
    throw new CliError(
      "E_CONFIG",
      "unsupported config schema " + JSON.stringify(raw.schema) + " in " + file + " (fix or delete it)"
    );
  }
  return { raw, warnings: sensitiveWarnings(raw, file) };
}

/**
 * Build the next file contents: schema first, unknown keys in their original
 * order, then the one key being changed. Deleting a key keeps everything else.
 *
 * @param {Record<string, unknown>} raw
 * @param {string} key
 * @param {string} [value] omitted for unset
 * @returns {Record<string, unknown>}
 */
function nextConfigObject(raw, key, value) {
  const out = { schema: 1 };
  for (const [name, existing] of Object.entries(raw)) {
    if (name === "schema" || name === key) continue;
    out[name] = existing;
  }
  if (value !== undefined) out[key] = value;
  return out;
}

/**
 * Write JSON with the documented format and the same-directory temporary file
 * + rename dance. There is no chmod here: on Windows it would be a lie.
 *
 * @param {string} file
 * @param {Record<string, unknown>} data
 */
function writeConfigFile(file, data) {
  const dir = path.dirname(file);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (error) {
    const code = error && error.code ? error.code : "mkdir failed";
    throw new CliError("E_IO", "cannot create config directory: " + dir + " (" + code + ")");
  }
  const temp = path.join(dir, ".config." + process.pid + "." + Math.random().toString(16).slice(2) + ".tmp");
  try {
    fs.writeFileSync(temp, JSON.stringify(data, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
    fs.renameSync(temp, file);
  } catch (error) {
    try {
      fs.unlinkSync(temp);
    } catch {
      // The temporary file may not exist; the original must stay untouched.
    }
    const code = error && error.code ? error.code : "write failed";
    throw new CliError("E_IO", "cannot write config file: " + file + " (" + code + ")");
  }
}

/**
 * @param {string} key
 */
function requireWritableKey(key) {
  if (key.toLowerCase() === "apikey") {
    throw new CliError(
      "E_USAGE",
      "the API key is not stored in the config file; use --api-key or YAKUSHA_API_KEY"
    );
  }
  if (!CONFIG_KEYS.includes(key)) {
    throw new CliError("E_USAGE", "unknown config key: " + key + " (expected provider, model or baseUrl)");
  }
}

/**
 * Set one value. The file is re-read here, so a change made after the command
 * started is not silently replaced by a stale copy.
 *
 * @param {string} key
 * @param {string} value
 * @param {{env?: Record<string, string|undefined>, file?: string}} [options]
 * @returns {{file: string, value: string, changed: boolean, warnings: string[]}}
 */
export function setConfigValue(key, value, options = {}) {
  requireWritableKey(key);
  const checked = validateConfigValue(key, value);
  if (!checked.ok) throw new CliError("E_USAGE", checked.message);
  const env = options.env || process.env;
  const file = options.file || configFilePath(env);
  const { raw, warnings } = readRawConfig(file);
  if (Object.hasOwn(raw, key) && raw[key] === checked.value) {
    return { file, value: checked.value, changed: false, warnings };
  }
  writeConfigFile(file, nextConfigObject(raw, key, checked.value));
  return { file, value: checked.value, changed: true, warnings };
}

/**
 * Remove one value. Missing key and missing file are both a no-op success.
 *
 * @param {string} key
 * @param {{env?: Record<string, string|undefined>, file?: string}} [options]
 * @returns {{file: string, changed: boolean, warnings: string[]}}
 */
export function unsetConfigValue(key, options = {}) {
  requireWritableKey(key);
  const env = options.env || process.env;
  const file = options.file || configFilePath(env);
  const { raw, warnings } = readRawConfig(file);
  if (!Object.hasOwn(raw, key)) return { file, changed: false, warnings };
  writeConfigFile(file, nextConfigObject(raw, key));
  return { file, changed: true, warnings };
}
