/**
 * GUI command handlers.
 *
 * Electron-free by design: the GUI main process calls the same
 * {@link module:cli/runner} the CLI does, and this module is the thin layer
 * between IPC and that seam. Every handler resolves to the exact envelope
 * the CLI prints with --json (docs/json-contract.md): schema, command, ok,
 * outcome, error, then the flat payload. Keeping this file free of electron
 * imports is what makes the envelope behaviour testable with plain node.
 *
 * @module gui/handlers
 */

import { runCommand } from "../src/cli/runner.js";
import { buildErrorEnvelope, buildEnvelope, failureFor } from "../src/cli/envelope.js";

/**
 * Commands the renderer may invoke. The list doubles as the IPC allowlist:
 * gui/main.js refuses every channel not in it, so adding a command here is
 * the single place a new GUI capability opens up.
 */
export const GUI_COMMANDS = [
  "scan",
  "extract",
  "status",
  "verify",
  "speaker",
  "terms",
  "translate",
  "install",
  "uninstall",
  "export",
  "import",
  "doctor",
  "config",
];

/**
 * Run one command and resolve to the same envelope the CLI prints.
 *
 * Human-readable summaries are dropped (the renderer shows the payload);
 * warnings stay collectable through {@link onWarning} so the window can
 * surface them the way stderr does on the command line.
 *
 * @param {string} command one of {@link GUI_COMMANDS}
 * @param {string[]} args positionals (one game directory, or config words)
 * @param {{flags?: Record<string, unknown>, onProgress?: ((p: {done: number, total: number, translated: number, rejected: number}) => void)|null, onWarning?: ((line: string) => void)|null, signal?: AbortSignal|null}} [opts]
 * @returns {Promise<Record<string, unknown>>} a CLI-identical JSON envelope
 */
export async function runGuiCommand(command, args, opts = {}) {
  const warnings = [];
  try {
    if (!GUI_COMMANDS.includes(command)) {
      return buildErrorEnvelope(command, "E_USAGE", "unknown command: " + command);
    }
    const result = await runCommand(command, args, {
      flags: opts.flags || {},
      sink: {
        out: () => {},
        warn: (text) => {
          warnings.push(String(text));
          if (opts.onWarning) opts.onWarning(String(text));
        },
      },
      onProgress: opts.onProgress || null,
      signal: opts.signal || null,
    });
    const envelope = buildEnvelope(result.command, result.outcome, result.payload);
    if (warnings.length > 0) envelope.warnings = warnings;
    return envelope;
  } catch (error) {
    const failure = failureFor(error);
    return buildErrorEnvelope(
      command,
      failure.code,
      failure.message,
      failure.details,
    );
  }
}

/**
 * Launch reads argv-shaped words (the --exe flag and the directory), so the
 * GUI assembles them the way the CLI would. Exposed for tests.
 *
 * @param {string} game game root directory
 * @param {string} [exe] optional executable override
 * @returns {{args: string[], flags: Record<string, unknown>}}
 */
export function launchInvocation(game, exe) {
  const flags = {};
  if (exe) flags.exe = exe;
  return { args: [game], flags };
}
