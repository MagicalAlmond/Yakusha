/**
 * Public library facade.
 *
 * The CLI is one consumer of this module; another is a future GUI. Everything
 * here is also reachable through the deep src/ paths, so adding an export is
 * not a breaking change for callers that already import a core module.
 *
 * @module yakusha
 */

export { openProject, findProjectRoot, findProjectRoots } from "./core/mzproject.js";
export { detectProject, getAdapter, getAdapters } from "./engines/registry.js";
export { extractProject } from "./core/extract.js";
export { openRenpyProject, findRenpyRoot, findRenpyRoots } from "./engines/renpy/project.js";
export { extractRenpyProject, collectRenpyUnits } from "./engines/renpy/extract.js";
export { installTranslation, uninstallTranslation, translationStatus } from "./engines/renpy/runtime.js";
export { openRgssProject, findRgssRoot, findRgssRoots } from "./engines/rgss/project.js";
export { extractRgssProject } from "./engines/rgss/extract.js";
export { loadDictionary, saveDictionary, dictionaryPath } from "./core/dict.js";
export { translateDictionary } from "./pipeline/translate.js";
export { verifyDictionary } from "./pipeline/verify.js";
export { installPlugin, uninstallPlugin, isInstalled } from "./core/install.js";
export { diagnose } from "./core/doctor.js";
export { buildRules } from "./core/fields.js";
export { VERSION } from "./version.js";
