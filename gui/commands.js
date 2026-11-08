/**
 * Commands the GUI renderer may invoke.
 *
 * Kept free of runner imports so the Electron main process can enforce the
 * allowlist without loading the command implementations; the worker thread
 * imports those. `gui/handlers.js` re-exports this list for compatibility.
 *
 * @module gui/commands
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
  "launch",
  "doctor",
  "config",
];
