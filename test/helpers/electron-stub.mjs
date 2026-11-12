// Shared-state stub of the electron API surface gui/main.js and
// gui/preload.js use.
// The contract tests import this module directly AND the module hook
// resolves the bare "electron" specifier to the same URL, so both see
// one mutable state object.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// gui/main.js probes its profile folder for writability before taking the
// single-instance lock, so the default must be a real folder: a fake Windows
// path would make every test take the fallback branch. One scratch folder is
// reused for the whole file; tests that care about the fallback override it.
let scratchRoot = null;
function scratchProfile() {
  if (!scratchRoot) {
    scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), "yakusha-gui-stub-"));
  }
  const dir = path.join(scratchRoot, "profile");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

class FakeWebContents {
  constructor() {
    this.sent = [];
    this.openHandler = null;
  }
  send(channel, body) {
    this.sent.push([channel, body]);
  }
  setWindowOpenHandler(fn) {
    this.openHandler = fn;
  }
}

class FakeBrowserWindow {
  constructor(opts) {
    this.opts = opts;
    this.webContents = new FakeWebContents();
    this.events = new Map();
    this.destroyed = false;
    this.minimized = false;
    this.maximized = false;
    this.fullScreen = false;
    this.bounds = { x: 40, y: 40, width: opts.width || 1180, height: opts.height || 820 };
    this.focusCalls = 0;
    this.restoreCalls = 0;
    this.showCalls = 0;
    this.maximizeCalls = 0;
    this.loadedFile = null;
    state.windows.push(this);
  }
  on(name, fn) {
    if (!this.events.has(name)) this.events.set(name, []);
    this.events.get(name).push(fn);
  }
  once(name, fn) {
    this.on(name, fn);
  }
  loadFile(p) {
    this.loadedFile = p;
  }
  show() {
    this.showCalls += 1;
  }
  isDestroyed() {
    return this.destroyed;
  }
  isMinimized() {
    return this.minimized;
  }
  restore() {
    this.restoreCalls += 1;
  }
  getBounds() {
    return { ...this.bounds };
  }
  getNormalBounds() {
    return { ...this.bounds };
  }
  isMaximized() {
    return this.maximized;
  }
  isFullScreen() {
    return this.fullScreen;
  }
  maximize() {
    this.maximized = true;
    this.maximizeCalls += 1;
  }
  focus() {
    this.focusCalls += 1;
  }
  emit(name, arg) {
    for (const fn of this.events.get(name) || []) fn(arg);
  }
}

const state = {
  lock: true,
  quitCalls: 0,
  readyPromise: null,
  whenReadyResolve: null,
  handlers: new Map(),
  ipc: new Map(),
  windows: [],
  dialogResult: { canceled: false, filePaths: [] },
  dialogCalls: [],
  bridges: [],
  rendererInvokes: [],
  rendererListeners: new Map(),
  rendererReplies: new Map(),
  invokeReply: null,
  pathForCalls: [],
  pathForReply: "D:/games/demo",
  openPathCalls: [],
  openPathReply: "",
  errorBoxes: [],
  userDataPath: null,
  switches: {},
  paths: {},
  setPathCalls: [],
};
state.userDataPath = scratchProfile();

export const app = {
  on(name, fn) {
    if (!state.handlers.has(name)) state.handlers.set(name, []);
    state.handlers.get(name).push(fn);
  },
  whenReady() {
    if (!state.readyPromise) {
      state.readyPromise = new Promise((resolve) => {
        state.whenReadyResolve = resolve;
      });
    }
    return state.readyPromise;
  },
  requestSingleInstanceLock() {
    return state.lock;
  },
  getPath(name) {
    return name === "userData" ? state.userDataPath : "";
  },
  setPath(name, value) {
    state.setPathCalls.push([name, value]);
    state.paths[name] = value;
    if (name === "userData") state.userDataPath = value;
  },
  commandLine: {
    getSwitchValue(name) {
      return state.switches[name] || "";
    },
  },
  quit() {
    state.quitCalls += 1;
  },
  __emit(name, arg) {
    for (const fn of state.handlers.get(name) || []) fn(arg);
  },
  __resolveReady() {
    state.whenReadyResolve();
  },
};

export const BrowserWindow = FakeBrowserWindow;

export const ipcMain = {
  handle(channel, fn) {
    state.ipc.set(channel, fn);
  },
  __invoke(channel, ...args) {
    const handler = state.ipc.get(channel);
    if (!handler) throw new Error("no handler registered for " + channel);
    return handler(...args);
  },
};

export const contextBridge = {
  exposeInMainWorld(world, api) {
    state.bridges.push({ world, api });
  },
};

export const ipcRenderer = {
  invoke(channel, ...args) {
    state.rendererInvokes.push([channel, ...args]);
    const reply = state.rendererReplies.has(channel)
      ? state.rendererReplies.get(channel)
      : state.invokeReply;
    return Promise.resolve(reply);
  },
  on(channel, listener) {
    if (!state.rendererListeners.has(channel)) state.rendererListeners.set(channel, []);
    state.rendererListeners.get(channel).push(listener);
  },
  removeListener(channel, listener) {
    const list = state.rendererListeners.get(channel) || [];
    const at = list.indexOf(listener);
    if (at >= 0) list.splice(at, 1);
  },
};

export const webUtils = {
  getPathForFile(file) {
    state.pathForCalls.push(file);
    return state.pathForReply;
  },
};

export const dialog = {
  async showOpenDialog(win, opts) {
    state.dialogCalls.push(opts);
    return state.dialogResult;
  },
  showErrorBox(title, content) {
    state.errorBoxes.push({ title, content });
  },
};

export const shell = {
  async openPath(file) {
    state.openPathCalls.push(file);
    return state.openPathReply;
  },
};

export const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (text) => Buffer.from("enc:" + text, "utf8"),
  // real safeStorage.decryptString returns a plaintext string, not a Buffer
  decryptString: (buffer) => buffer.toString("utf8").replace(/^enc:/, ""),
};

export function __reset(overrides = {}) {
  state.lock = true;
  state.quitCalls = 0;
  state.readyPromise = null;
  state.whenReadyResolve = null;
  state.handlers = new Map();
  state.ipc = new Map();
  state.windows = [];
  state.dialogResult = { canceled: false, filePaths: [] };
  state.dialogCalls = [];
  state.errorBoxes = [];
  state.userDataPath = scratchProfile();
  state.switches = {};
  state.paths = {};
  state.setPathCalls = [];
  state.bridges = [];
  state.rendererInvokes = [];
  state.rendererListeners = new Map();
  state.rendererReplies = new Map();
  state.invokeReply = null;
  state.pathForCalls = [];
  state.pathForReply = "D:/games/demo";
  state.openPathCalls = [];
  state.openPathReply = "";
  Object.assign(state, overrides);
}

export function __state() {
  return state;
}