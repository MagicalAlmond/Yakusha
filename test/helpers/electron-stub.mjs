// Shared-state stub of the electron API surface gui/main.js and
// gui/preload.js use.
// The contract tests import this module directly AND the module hook
// resolves the bare "electron" specifier to the same URL, so both see
// one mutable state object.
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
    this.focusCalls = 0;
    this.restoreCalls = 0;
    this.showCalls = 0;
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
  errorBoxes: [],
  userDataPath: "C:/Users/me/AppData/Roaming/yakusha",
};

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
  state.userDataPath = "C:/Users/me/AppData/Roaming/yakusha";
  state.bridges = [];
  state.rendererInvokes = [];
  state.rendererListeners = new Map();
  state.rendererReplies = new Map();
  state.invokeReply = null;
  state.pathForCalls = [];
  state.pathForReply = "D:/games/demo";
  Object.assign(state, overrides);
}

export function __state() {
  return state;
}
