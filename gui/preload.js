/**
 * Preload: the only bridge between the renderer and the main process.
 *
 * The renderer has no Node access (contextIsolation: true). Everything it may
 * do is one of the functions below — the allowlist mirrors
 * {@link module:gui/handlers} GUI_COMMANDS plus the run/cancel/progress
 * plumbing. No channel is dynamic; adding a capability means editing both
 * allowlists in one commit.
 *
 * @module gui/preload
 */

import { contextBridge, ipcRenderer, webUtils } from "electron";

const WORLD = "yakusha";

contextBridge.exposeInMainWorld(WORLD, {
  /**
   * Run one documented command. Resolves with the CLI-identical envelope.
   * @param {string} command one of window.yakusha.commands
   * @param {string[]} args positionals (the game directory, or config words)
   * @param {Record<string, unknown>} [flags] command options as parsed by the CLI
   * @param {number} [runId] caller-chosen id used to match progress events
   * @returns {Promise<object>} envelope (schema/command/ok/outcome/error + payload)
   */
  run: (command, args, flags, runId, useStoredKey) =>
    ipcRenderer.invoke("gui:run", { command, args, flags: flags || {}, runId: runId || 0, useStoredKey: useStoredKey === true }),

  /** Request cancellation of the running translate; cooperative, in-flight
   *  requests finish, already-translated entries are kept. */
  cancel: () => ipcRenderer.invoke("gui:cancel"),

  /** Open the native directory picker; resolves to a path or null. */
  pickDirectory: () => ipcRenderer.invoke("gui:pick-directory"),

  /** Credentials (docs/config.md §8): the key crosses IPC once on save and
   *  is only read back inside the main process; the renderer never stores it. */
  saveApiKey: (key) => ipcRenderer.invoke("gui:save-key", key),
  hasApiKey: () => ipcRenderer.invoke("gui:has-key"),
  clearApiKey: () => ipcRenderer.invoke("gui:clear-key"),

  /** @param {(e: {runId: number, command: string, progress: object}) => void} cb */
  onProgress: (cb) => {
    const listener = (_event, body) => cb(body);
    ipcRenderer.on("gui:progress", listener);
    return () => ipcRenderer.removeListener("gui:progress", listener);
  },

  /** @param {(e: {runId: number, command: string, line: string}) => void} cb */
  onWarning: (cb) => {
    const listener = (_event, body) => cb(body);
    ipcRenderer.on("gui:warning", listener);
    return () => ipcRenderer.removeListener("gui:warning", listener);
  },

  /** @param {(e: {runId: number, command: string, envelope: object}) => void} cb */
  onResult: (cb) => {
    const listener = (_event, body) => cb(body);
    ipcRenderer.on("gui:result", listener);
    return () => ipcRenderer.removeListener("gui:result", listener);
  },

  /**
   * Drag and drop: the browser event only gives a File object; the absolute
   * path needs Electron's webUtils (architecture.md §6).
   * @param {File} file a File from a drop event
   * @returns {string} absolute path
   */
  pathForFile: (file) => webUtils.getPathForFile(file),

  /** The commands this shell may drive; the UI greys out what it does not map to. */
  commands: [
    "scan", "extract", "status", "verify", "speaker", "terms", "translate",
    "install", "uninstall", "export", "import", "doctor", "config",
  ],
});
