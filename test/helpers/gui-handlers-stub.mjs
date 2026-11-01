// Stub of gui/handlers.js used by the gui/main.js contract tests.
// GUI_COMMANDS is re-exported from the real module so the IPC allowlist
// test stays honest; runGuiCommand delegates to a test-provided impl so
// runs can be held pending and their opts (signal included) inspected.
import { GUI_COMMANDS as REAL_COMMANDS } from "../../gui/handlers.js";

export const GUI_COMMANDS = REAL_COMMANDS;

let impl = null;

export function runGuiCommand(command, args, opts = {}) {
  if (impl) return impl(command, args, opts);
  return Promise.resolve({ schema: 1, command, ok: true, outcome: "ok" });
}

export function __setImpl(fn) {
  impl = fn;
}
