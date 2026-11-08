/**
 * Compatibility facade for the doctor.
 *
 * The implementation moved to `services/doctor` (engine-neutral) and
 * `engines/rm/diagnostics` (RPG Maker delivery facts). This module keeps the
 * historical import path working and, for direct callers that do not supply
 * engine diagnostics, keeps the RPG Maker default behaviour of earlier
 * releases.
 *
 * @module core/doctor
 */

import { diagnose as diagnoseGeneric, DEFAULT_DICT_PATH } from "../services/doctor.js";
import {
  detectEmbeddedTranslations,
  readEmbeddedTranslations,
  rmDiagnostics,
  runtimeLookup,
} from "../engines/rm/diagnostics.js";

export { DEFAULT_DICT_PATH, detectEmbeddedTranslations, readEmbeddedTranslations, runtimeLookup };

/**
 * @param {import("./mzproject.js").Project} project
 * @param {object} [options]
 */
export function diagnose(project, options = {}) {
  const hasOwnDelivery =
    Boolean(options.diagnostics) || Boolean(options.delivery) || Boolean(options.translation);
  return diagnoseGeneric(project, hasOwnDelivery ? options : { ...options, diagnostics: rmDiagnostics });
}
