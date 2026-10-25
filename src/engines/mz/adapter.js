/**
 * RPG Maker MZ adapter.
 *
 * Thin wrapper around the shared engine plumbing: MZ differs from MV only in
 * its core script name and in being debuggable through CDP.
 *
 * @module engines/mz/adapter
 */

import {
  capabilities,
  detectFor,
  extractIntoDictionary,
  installRuntime as installRuntimeCore,
  notImplemented,
  scanProject,
  uninstallRuntime as uninstallRuntimeCore,
} from "../adapter.js";

export const adapter = {
  id: "mz",
  name: "RPG Maker MZ",

  capabilities: capabilities({
    extract: true,
    export: true,
    runtime: "plugin",
    launch: true,
    debuggable: true,
  }),

  detect(startDir) {
    return detectFor("mz", startDir);
  },

  scan(project) {
    return scanProject(project);
  },

  extract(project) {
    return extractIntoDictionary(project);
  },

  installRuntime(project, options = {}) {
    return installRuntimeCore(project, options);
  },

  uninstallRuntime(project) {
    return uninstallRuntimeCore(project);
  },

  launch() {
    throw notImplemented("launch");
  },

  attach() {
    throw notImplemented("attach");
  },

  rules: { controlCodes: true, maxColumns: 0 },
};

export default adapter;
