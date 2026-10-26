/**
 * RPG Maker MV adapter.
 *
 * Thin wrapper around the shared engine plumbing: MV shares the plumbing with
 * MZ but has no usable CDP debug path in the tested 1.6.x runtime.
 *
 * @module engines/mv/adapter
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
import { rmProfile } from "../profile.js";
import { launchProject } from "../launch.js";

export const adapter = {
  id: "mv",
  name: "RPG Maker MV",

  capabilities: capabilities({
    extract: true,
    export: true,
    runtime: "plugin",
    launch: true,
    debuggable: false,
  }),

  detect(startDir) {
    return detectFor("mv", startDir);
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

  launch(project, options = {}) {
    return launchProject(project, options);
  },

  attach() {
    throw notImplemented("attach");
  },

  rules: { controlCodes: true, maxColumns: 0 },

  /**
   * Grammar, prompt wording and language-pair judgements the pipeline reads.
   * The frozen contract on `rules` is untouched; this field is additive.
   */
  profile: rmProfile,
};

export default adapter;
