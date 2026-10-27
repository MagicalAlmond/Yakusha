/**
 * Electron main process for the Yakusha GUI.
 *
 * Architecture contract (docs/architecture.md §6): the GUI is a second
 * front end over the same core the CLI drives — this process imports
 * {@link module:gui/handlers} (which wraps {@link module:cli/runner}), it
 * never spawns the CLI and never touches game files outside the runner.
 *
 * Hard rules enforced here:
 * - the renderer gets no Node: `contextIsolation: true`, no nodeIntegration,
 *   a preload with an explicit allowlist, and no remote content is loaded;
 * - every IPC channel is in one allowlist, keyed to the documented commands;
 * - translate runs here (long task), progress is pushed with
 *   `webContents.send`, cancellation is an AbortController owned by the main
 *   process — the renderer can only request a cancel;
 * - drag-and-drop resolves real paths in the renderer through
 *   `webUtils.getPathForFile` (exposed by preload), never from untrusted
 *   event data.
 *
 * @module gui/main
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, dialog, ipcMain, safeStorage } from "electron";

import { GUI_COMMANDS, runGuiCommand } from "./handlers.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Long translate runs: one at a time, cancelled through this controller. */
let activeRun = null;
/** Remembered directory so the dialog reopens where the user last was. */
let currentDir = null;

/** The credentials file lives next to the config file (docs/config.md §8). */
function credentialsPath() {
  try {
    return credentialsFile(path.dirname(configFilePath(process.env)));
  } catch {
    // No APPDATA and no YAKUSHA_CONFIG_DIR: nowhere to store; the save/read
    // handlers report this instead of writing somewhere random.
    return null;
  }
}

/**
 * @param {Electron.BrowserWindow} win
 * @param {string} command
 * @param {string[]} args
 * @param {Record<string, unknown>} flags
 * @param {number} runId identifier the renderer uses to match progress events
 */
async function runInWindow(win, command, args, flags, runId) {
  const send = (channel, body) => {
    if (!win.isDestroyed()) win.webContents.send(channel, body);
  };
  try {
    const envelope = await runGuiCommand(command, args, {
      flags,
      onProgress: (progress) => send("gui:progress", { runId, command, progress }),
      onWarning: (line) => send("gui:warning", { runId, command, line }),
    });
    send("gui:result", { runId, command, envelope });
    return envelope;
  } catch (error) {
    // handlers turn everything into an envelope; this is a last-resort guard
    // so the renderer still gets exactly one result per run.
    const envelope = {
      schema: 1,
      command,
      ok: false,
      outcome: "error",
      error: { code: "E_INTERNAL", message: String(error && error.message ? error.message : error) },
    };
    send("gui:result", { runId, command, envelope });
    return envelope;
  }
}

/**
 * Register the IPC allowlist. Called once per app start; every channel is a
 * closed set — a renderer asking for anything else gets an error envelope.
 */
function registerIpc() {
  ipcMain.handle("gui:run", (_event, request) => {
    const command = request && typeof request.command === "string" ? request.command : "";
    const args = Array.isArray(request && request.args) ? request.args.map(String) : [];
    const flags = request && typeof request.flags === "object" && request.flags ? request.flags : {};
    const runId = request && Number.isInteger(request.runId) ? request.runId : 0;
    if (!GUI_COMMANDS.includes(command)) {
      return Promise.resolve({
        schema: 1,
        command,
        ok: false,
        outcome: "error",
        error: { code: "E_USAGE", message: "unknown command: " + command },
      });
    }
    // One long task at a time: translate owns the single AbortController, and
    // a second translate while one runs is refused instead of racing.
    if (activeRun && activeRun.command === "translate" && command === "translate") {
      return Promise.resolve({
        schema: 1,
        command,
        ok: false,
        outcome: "error",
        error: { code: "E_USAGE", message: "a translate run is already in progress" },
      });
    }
    if (command === "translate") {
      // Opt-in secret reuse: the renderer asks for the stored key with a
      // checkbox; the key itself crosses IPC once (input) and never returns.
      if (request.useStoredKey === true && flags["api-key"] === undefined) {
        const file = credentialsPath();
        if (!file) {
          return Promise.resolve({
            schema: 1,
            command,
            ok: false,
            outcome: "error",
            error: { code: "E_CONFIG", message: "no configuration directory is available; cannot read the stored key" },
          });
        }
        const stored = readApiKey(file, safeStorage);
        if (stored.error) {
          return Promise.resolve({
            schema: 1,
            command,
            ok: false,
            outcome: "error",
            error: { code: "E_CONFIG", message: stored.error },
          });
        }
        flags = { ...flags, "api-key": stored.key };
      }
      const controller = new AbortController();
      activeRun = { command, controller };
      return runInWindow(winOf(), command, args, flags, runId).finally(() => {
        activeRun = null;
      });
    }
    return runInWindow(winOf(), command, args, flags, runId);
  });
  ipcMain.handle("gui:cancel", () => {
    if (activeRun && activeRun.controller) activeRun.controller.abort();
    return true;
  });
  // The one file-system affordance the renderer gets: a native open dialog.
  // It returns a path string; every other check stays in the runner (the path
  // is untrusted input like any other).
  // Credentials (docs/config.md §8): DPAPI-encrypted envelope next to the
  // config file, opt-in only, never plaintext, the CLI never reads it.
  ipcMain.handle("gui:save-key", (_event, key) => {
    const file = credentialsPath();
    if (typeof key !== "string" || key.length === 0 || !file) {
      return { saved: false, reason: "no key or no configuration directory" };
    }
    return saveApiKey(file, key, safeStorage);
  });
  ipcMain.handle("gui:has-key", () => {
    const file = credentialsPath();
    return file ? hasApiKey(file) : false;
  });
  ipcMain.handle("gui:clear-key", () => {
    const file = credentialsPath();
    return file ? clearApiKey(file) : { cleared: false };
  });
  ipcMain.handle("gui:pick-directory", async () => {
    const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
    const result = await dialog.showOpenDialog(win, {
      properties: ["openDirectory"],
      title: "Open a game folder",
      defaultPath: currentDir || undefined,
    });
    const picked = result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
    if (picked) currentDir = picked;
    return picked;
  });
}

/** The window progress is pushed to; main.js keeps a module-level handle. */
let mainWindow = null;
/** @returns {Electron.BrowserWindow} the main window or a dead stub guard */
function winOf() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  // No window (tests, headless): handlers still run, events go nowhere —
  // send() already guards isDestroyed.
  return /** @type {Electron.BrowserWindow} */ (/** @type {unknown} */ ({}));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 728,
    show: false,
    webPreferences: {
      preload: path.join(HERE, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload needs webUtils for drag paths
      spellcheck: false,
    },
  });
  // No remote content, ever: the renderer is a local file and the window
  // refuses navigation away from it.
  mainWindow.on("will-navigate", (event) => event.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.loadFile(path.join(HERE, "renderer", "index.html"));
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(() => {
    registerIpc();
    createWindow();
  });
  app.on("window-all-closed", () => {
    // A translate run in flight has already saved its dictionary through
    // --save-every semantics inside the runner; closing is a cancel.
    if (activeRun && activeRun.controller) activeRun.controller.abort();
    app.quit();
  });
}
