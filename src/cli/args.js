/**
 * Strict command line parsing.
 *
 * The 0.9 parser was forgiving: an unknown flag was ignored, a flag without a
 * value became "true", and a typo silently changed nothing. That is exactly the
 * kind of failure a translation run cannot afford (an hour of paid requests
 * with the wrong --limit), so 0.10 rejects anything it does not understand
 * before a command touches the disk.
 *
 * Rules (docs/json-contract.md §6):
 *   --flag value / --flag=value     value options
 *   --flag                          boolean options, never --flag=value
 *   --                              terminator, the rest is positional
 *   repeated value options          last one wins, except --context
 *
 * @module cli/args
 */

import { CliError } from "./envelope.js";

/** Options every command accepts. */
const GLOBAL = ["json", "help", "version"];

/** Options that take no value. Everything else in OPTION_KIND takes one. */
const BOOLEAN = new Set([
  "json",
  "help",
  "version",
  "dry-run",
  "no-rewrap",
  "glossary-only",
  "overwrite",
  "allow-code-drift",
  "include-drift",
  "drift-only",
  "embed",
]);

/**
 * Every option any command understands, with its kind. The union is used to
 * parse the syntax; {@link assertOptions} then rejects options the chosen
 * command does not accept.
 */
const VALUE = [
  "provider",
  "model",
  "base-url",
  "api-key",
  "glossary",
  "limit",
  "context",
  "batch-size",
  "char-budget",
  "concurrency",
  "save-every",
  "max-length",
  "temperature",
  "timeout",
  "max-tokens",
  "target-lang",
  "kind",
  "write-report",
  "names",
  "write-names",
  "status",
  "min-holders",
  "min-support",
  "max-terms",
  "write",
];

/** Per command option names; GLOBAL is always allowed. */
const COMMAND_OPTIONS = {
  scan: [],
  extract: [],
  status: [],
  uninstall: [],
  install: ["embed"],
  doctor: ["max-length"],
  translate: [
    "provider",
    "model",
    "base-url",
    "api-key",
    "glossary",
    "limit",
    "context",
    "batch-size",
    "char-budget",
    "concurrency",
    "save-every",
    "max-length",
    "temperature",
    "timeout",
    "max-tokens",
    "target-lang",
    "no-rewrap",
    "dry-run",
    "glossary-only",
    "overwrite",
    "allow-code-drift",
  ],
  verify: ["kind", "max-length", "limit", "write-report"],
  speaker: ["include-drift", "names", "write-names", "dry-run", "limit"],
  terms: ["status", "min-holders", "min-support", "drift-only", "max-terms", "limit", "write", "dry-run"],
};

const KIND = new Map();
for (const name of BOOLEAN) KIND.set(name, "boolean");
for (const name of VALUE) KIND.set(name, "value");

/** Only --context may be given more than once; everything else is last-wins. */
const REPEATABLE = new Set(["context"]);

/**
 * @param {Record<string, unknown>} flags
 * @param {string} name
 * @param {unknown} value
 */
function setFlag(flags, name, value) {
  if (!REPEATABLE.has(name)) {
    flags[name] = value;
    return;
  }
  const previous = flags[name];
  if (previous === undefined) flags[name] = [value];
  else if (Array.isArray(previous)) previous.push(value);
  else flags[name] = [previous, value];
}

/**
 * Split argv into flags and positionals, rejecting anything ambiguous.
 *
 * @param {string[]} argv arguments after "node bin/yakusha.js"
 * @returns {{ flags: Record<string, string|boolean|string[]>, positional: string[] }}
 */
export function parseArgs(argv) {
  /** @type {Record<string, string|boolean|string[]>} */
  const flags = {};
  /** @type {string[]} */
  const positional = [];
  let terminated = false;

  /**
   * An E_USAGE that still names the command being parsed, so an error envelope
   * can say "scan" instead of null when the option after it was wrong.
   *
   * @param {string} message
   * @returns {CliError}
   */
  function usageError(message) {
    const error = new CliError("E_USAGE", message);
    error.command = positional[0] || null;
    return error;
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (terminated) {
      positional.push(arg);
      continue;
    }
    if (arg === "--") {
      terminated = true;
      continue;
    }
    if (arg === "-h") {
      flags.help = true;
      continue;
    }
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      const name = eq >= 0 ? arg.slice(2, eq) : arg.slice(2);
      const inline = eq >= 0 ? arg.slice(eq + 1) : undefined;
      const kind = KIND.get(name);
      if (!kind) throw usageError("unknown option: --" + name);
      if (kind === "boolean") {
        if (inline !== undefined) throw usageError("option --" + name + " does not take a value");
        setFlag(flags, name, true);
        continue;
      }
      if (inline !== undefined) {
        if (inline === "") throw usageError("option --" + name + " requires a value");
        setFlag(flags, name, inline);
        continue;
      }
      const next = argv[i + 1];
      // A value may not be omitted or be another option. This is what turns
      // "yakusha translate game --limit" from a silent no-op into a usage error.
      if (next === undefined || next === "--" || next.startsWith("--")) {
        throw usageError("option --" + name + " requires a value");
      }
      setFlag(flags, name, next);
      i += 1;
      continue;
    }
    if (arg.length > 1 && arg.startsWith("-")) {
      throw usageError("unknown option: " + arg);
    }
    positional.push(arg);
  }

  return { flags, positional };
}

/**
 * Reject options that belong to a different command.
 *
 * "scan --provider mock" is a typo, not a request, so it fails instead of
 * quietly scanning without any provider.
 *
 * @param {string} command
 * @param {Record<string, unknown>} flags
 */
export function assertOptions(command, flags) {
  const allowed = new Set(GLOBAL.concat(COMMAND_OPTIONS[command] || []));
  for (const name of Object.keys(flags)) {
    if (!allowed.has(name)) throw new CliError("E_USAGE", "unknown option for " + command + ": --" + name);
  }
}

/**
 * The commands that exist in this build. Kept here so "unknown command" and
 * "unknown option for that command" agree on the same list.
 *
 * @returns {string[]}
 */
export function commandNames() {
  return Object.keys(COMMAND_OPTIONS);
}
