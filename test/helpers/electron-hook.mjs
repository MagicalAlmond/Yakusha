// node:module.register hook for the gui/main.js contract tests.
//
// The hook itself runs in its own thread; the stub modules it points at run
// in the test process, so the test and the module under test share one stub
// instance (same module URL).
//
// Redirects:
// - the bare "electron" specifier -> test/helpers/electron-stub.mjs
// - "./handlers.js" imported FROM gui/main.js -> test/helpers/gui-handlers-stub.mjs
//   (the real handlers module stays reachable through its own absolute
//   relative specifier from other importers)
const STUB_DIR = new URL("./", import.meta.url);

export async function initialize() {}

export function resolve(specifier, context, next) {
  if (specifier === "electron") {
    return { url: new URL("electron-stub.mjs", STUB_DIR).href, shortCircuit: true };
  }
  const parent = String(context.parentURL || "").split("?")[0];
  if (specifier === "./handlers.js" && parent.endsWith("/gui/main.js")) {
    return { url: new URL("gui-handlers-stub.mjs", STUB_DIR).href, shortCircuit: true };
  }
  return next(specifier, context);
}
