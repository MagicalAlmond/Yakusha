/**
 * English Kirikiri (.ks) fixture text for the source-language tests.
 *
 * The lines below are invented for this repository: short ASCII sentences that
 * are safe to encode as Shift_JIS and contain no text from any real game.
 */

import { buildXp3, writeKrkrProject } from "./krkr-fixture.js";

/** Speaker name announced with [name_set] before the first spoken line. */
export const EN_KS_SPEAKER = "Mira";

/** Script lines of the synthetic English scenario, in file order. */
export const EN_KS_LINES = [
  "[test]",
  "*scene_one",
  "[name_set name='Mira']",
  "The lighthouse is dark tonight.",
  "Let us walk down to the shore.",
  "[p2]",
  "The tide is coming in.",
  "[wait time=300]",
  "A gull calls once and then is silent.",
  "[iscript]",
  "// engine code must never be collected",
  "f.synthetic = 1;",
  "[endscript]",
  "; a comment line the extractor must skip",
];

/** Full .ks source: UTF-8 bytes, pure ASCII so Shift_JIS decoding also works. */
export const EN_KS_SCENARIO = EN_KS_LINES.join("\n");

/** Sentences the extractor is expected to collect from EN_KS_SCENARIO. */
export const EN_KS_SENTENCES = [
  "The lighthouse is dark tonight.",
  "Let us walk down to the shore.",
  "The tide is coming in.",
  "A gull calls once and then is silent.",
];

/** Lines the extractor must never collect (tags, labels, comments, script). */
export const EN_KS_FORBIDDEN = [
  "engine code must never be collected",
  "f.synthetic = 1;",
  "a comment line the extractor must skip",
  "scene_one",
];

/**
 * Write a Kirikiri project whose single archive holds the English scenario.
 *
 * @param {string} parent directory that will contain the "game" project root
 * @returns {{root: string, dataDir: string, archivePaths: string[]}}
 */
export function writeEnKrkrProject(parent) {
  return writeKrkrProject(parent, {
    name: "game",
    archives: [
      {
        archiveName: "data.xp3",
        files: [
          {
            name: "scenario/english.ks",
            data: Buffer.from(EN_KS_SCENARIO, "utf8"),
            mode: 1,
          },
        ],
      },
    ],
  });
}

/** Build just the archive buffer, for tests that do not need a project tree. */
export function buildEnKrkrArchive() {
  return buildXp3([
    {
      name: "scenario/english.ks",
      data: Buffer.from(EN_KS_SCENARIO, "utf8"),
      mode: 1,
    },
  ]);
}

export default {
  EN_KS_SPEAKER,
  EN_KS_LINES,
  EN_KS_SCENARIO,
  EN_KS_SENTENCES,
  EN_KS_FORBIDDEN,
  writeEnKrkrProject,
  buildEnKrkrArchive,
};
