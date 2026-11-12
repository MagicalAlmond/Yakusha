/**
 * Bind an engine profile to a source language.
 *
 * Engine profiles describe grammar (which tokens are codes, how text is
 * tokenized); language modules describe the pair (what an untranslated echo
 * looks like, which leftovers the audit reports). This module joins the two
 * without letting either axis know about the other.
 *
 * @module engines/language-pair
 */

import { DEFAULT_SOURCE_LANGUAGE, pairFor, sourceLanguage } from "../languages/index.js";

/**
 * Return the profile as seen from one source language.
 *
 * The default language returns the base profile unchanged so ja → zh output
 * stays byte-identical to earlier releases.
 *
 * @param {import("./profile.js").EngineProfile} profile
 * @param {string} [sourceLang]
 * @returns {import("./profile.js").EngineProfile}
 */
export function sourceProfile(profile, sourceLang = DEFAULT_SOURCE_LANGUAGE) {
  const language = sourceLanguage(sourceLang);
  if (language.ID === DEFAULT_SOURCE_LANGUAGE) return profile;
  return {
    ...profile,
    sourceLanguage: language.ID,
    prompt: {
      ...profile.prompt,
      task: (targetLang) => profile.prompt.task(targetLang, language.NAME),
    },
    ...pairFor(language.ID)(profile.grammar, profile.slots),
  };
}
