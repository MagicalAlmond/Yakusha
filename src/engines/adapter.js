/**
 * Compatibility facade for the engine adapter helpers.
 *
 * The adapter surface was split into a pure contract (engines/contract) and
 * the RPG Maker implementation (engines/rm/base). This module re-exports both
 * so deep imports from earlier releases keep working.
 *
 * @module engines/adapter
 */

export {
  CAPABILITY_KEYS,
  capabilities,
  detectFail,
  detectOk,
  notImplemented,
} from "./contract.js";

export {
  detectFor,
  extractIntoDictionary,
  installRuntime,
  notProjectMessage,
  scanProject,
  uninstallRuntime,
} from "./rm/base.js";
