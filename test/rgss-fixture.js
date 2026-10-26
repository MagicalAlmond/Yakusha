/**
 * Synthetic RGSS fixtures.
 *
 * Every byte a test reads is built here: the Ruby Marshal documents are produced
 * by src/engines/rgss/marshal.js and packed with src/engines/rgss/archive.js, so
 * the tests exercise the writers and the readers against each other.
 *
 * Provenance - nothing in this file comes from a shipped game:
 *
 *  - every line of dialogue, menu label, term and actor name is written for the
 *    tests (twice told apart from the real thing by being about test data);
 *  - the layout mirrors what RPG Maker writes (RPG::System with @terms, a
 *    database array whose slot 0 is nil, RPG::Map with an @events hash of
 *    pages of @code/@indent/@parameters commands), because that shape is what
 *    the extractor keys off;
 *  - no fixture is committed as a binary, so there is no blob whose origin a
 *    reader cannot check.
 *
 * @module test/rgss-fixture
 */

import fs from "node:fs";
import path from "node:path";

import { marshal } from "../src/engines/rgss/marshal.js";
import { writeArchive } from "../src/engines/rgss/archive.js";

/** A Ruby String with the UTF-8 flag, the way the editor writes every text. */
function str(value) {
  return { __type: "string", bytes: Buffer.from(value, "utf8"), ivars: { E: true } };
}

/** A Ruby object: a class name plus instance variables. */
function record(className, ivars) {
  return { __type: "object", className, ivars };
}

/** One event command, the shape every RGSS command list uses. */
function command(code, parameters) {
  return record("RPG::EventCommand", { "@code": code, "@indent": 0, "@parameters": parameters });
}

/** A page holding one command list. */
function page(commands) {
  return record("RPG::Event::Page", { "@condition": record("RPG::Event::Page::Condition", {}), "@list": commands });
}

/** RPG::System, including the four term lists the menus print. */
export function systemDocument() {
  return record("RPG::System", {
    "@game_title": str("Synthetic Quest"),
    "@currency_unit": str("G"),
    "@title1_name": str("Title1"),
    "@battleback1_name": str("Grassland"),
    "@terms": record("RPG::System::Terms", {
      "@basic": [str("Level"), str("Lv"), str(""), str("")],
      "@params": [str("Max HP"), str("Max MP")],
      "@etypes": [str("Weapon"), str("Shield")],
      "@commands": [str("Fight"), str("Escape"), str("")]
    })
  });
}
/** Actors: slot 0 is nil, the way the editor leaves an unused id. */
export function actorsDocument() {
  return [
    null,
    record("RPG::Actor", {
      "@id": 1,
      "@name": str("Yuki"),
      "@nickname": str("Yu"),
      // Description carries an escape code on purpose: the extractor must keep
      // it intact and the profile must report it as a control code.
      "@description": str("A test-only character.\\C[6]Nothing here is real.\\C[0]"),
      "@character_name": str("Actor1"),
      "@note": str("<test tag: keep me>"),
    }),
  ];
}

/** Items: one real entry and one with an empty name, which is not a key. */
export function itemsDocument() {
  return [
    null,
    record("RPG::Item", {
      "@id": 1,
      "@name": str("Test Potion"),
      "@description": str("Restores 50 HP."),
      "@note": str("test note"),
    }),
    record("RPG::Item", { "@id": 2, "@name": str(""), "@description": str("") }),
  ];
}

/** The map name table: a Ruby Hash of id -> RPG::MapInfo. */
export function mapInfosDocument() {
  return new Map([
    [1, record("RPG::MapInfo", { "@id": 1, "@name": str("Test Room"), "@parent_id": 0, "@order": 1 })],
    [2, record("RPG::MapInfo", { "@id": 2, "@name": str("Test Hall"), "@parent_id": 0, "@order": 2 })],
  ]);
}

/**
 * One map with every command code the extractor treats specially.
 *
 * 101 speaker, 401/405 dialogue, 102 choices, 320 rename, plus codes that must
 * be ignored (108 comment, 355 script line, 231 picture name) so a regression
 * that starts collecting them is caught.
 */
export function mapDocument() {
  const list = [
    command(101, [str("Narrator"), 0, 0, 2]),
    command(401, [str("This room exists only for the tests.")]),
    command(101, [str(""), 0, 0, 2]),
    command(401, [str("The lamp is a placeholder.")]),
    command(405, [str("It is still a placeholder.")]),
    command(102, [[str("Open the door"), str("Leave it alone")], 1]),
    command(402, [0, str("Open the door")]),
    command(401, [str("The door does not open.")]),
    command(402, [1, str("Leave it alone")]),
    command(401, [str("Nothing happens either way.")]),
    command(320, [1, str("Test Name")]),
    command(108, [str("editor comment: never translated")]),
    command(355, [str("$game_variables[1] = 1")]),
    command(231, [1, str("Picture1"), 0, 0, 0, 0, 100, 100, 255, 0]),
  ];
  return record("RPG::Map", {
    "@display_name": str("Test Room"),
    "@tileset_id": 1,
    "@width": 17,
    "@height": 13,
    "@events": new Map([
      [1, record("RPG::Event", { "@id": 1, "@name": str("Test Event"), "@x": 1, "@y": 1, "@pages": [page(list)] })],
    ]),
    "@data": { __type: "data", className: "Table", bytes: Buffer.alloc(16) },
  });
}

/** Common events: the name is readable, the list holds one line. */
export function commonEventsDocument() {
  return [
    null,
    record("RPG::CommonEvent", {
      "@id": 1,
      "@name": str("Test Common Event"),
      "@trigger": 0,
      "@switch_id": 1,
      "@list": [command(101, [str(""), 0, 0, 2]), command(401, [str("A common event line.")])],
    }),
  ];
}

/** Troops carry only a command list, no record fields. */
export function troopsDocument() {
  return [
    null,
    record("RPG::Troop", {
      "@id": 1,
      "@name": str("Test Troop"),
      "@members": [],
      "@pages": [record("RPG::Troop::Page", { "@list": [command(401, [str("A battle line.")])] })],
    }),
  ];
}
/**
 * Write an unpacked RGSS project: `Game.ini` plus a `Data/` directory.
 *
 * @param {string} root directory to create the project in
 * @param {{ version?: 1|2|3, title?: string, extraDocuments?: Record<string, unknown> }} [options]
 * @returns {string} root
 */
export function writeRgssProject(root, options = {}) {
  const version = options.version || 3;
  const extension = version === 3 ? "rvdata2" : version === 2 ? "rvdata" : "rxdata";
  const library = version === 3 ? "System\\RGSS300.dll" : version === 2 ? "System\\RGSS202E.dll" : "System\\RGSS104E.dll";
  const data = path.join(root, "Data");
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(path.join(root, "Game.ini"), iniText({
    library,
    scripts: "Data\\Scripts." + extension,
    title: options.title === undefined ? "Synthetic Quest" : options.title,
  }));
  const documents = {
    Actors: actorsDocument(),
    Items: itemsDocument(),
    MapInfos: mapInfosDocument(),
    Map001: mapDocument(),
    CommonEvents: commonEventsDocument(),
    Troops: troopsDocument(),
    System: systemDocument(),
    ...(options.extraDocuments || {}),
  };
  for (const [base, value] of Object.entries(documents)) {
    fs.writeFileSync(path.join(data, base + "." + extension), marshal(value));
  }
  return root;
}

/** Build the text of a `Game.ini` the way the editor writes it. */
function iniText(values) {
  return [
    "[Game]",
    "RTP=",
    "Library=" + values.library,
    "Scripts=" + values.scripts,
    "Title=" + values.title,
    "Version=1.0",
    "",
  ].join("\r\n");
}

/**
 * Write a packed RGSS project: `Game.ini` plus one archive holding `Data/`.
 *
 * @param {string} root directory to create the project in
 * @param {{ version?: 1|2|3, title?: string, extraDocuments?: Record<string, unknown> }} [options]
 * @returns {string} root
 */
export function writePackedProject(root, options = {}) {
  const version = options.version || 3;
  const suffix = version === 3 ? "rgss3a" : version === 2 ? "rgss2a" : "rgssad";
  const extension = version === 3 ? "rvdata2" : version === 2 ? "rvdata" : "rxdata";
  const library = version === 3 ? "System\\RGSS300.dll" : version === 2 ? "System\\RGSS202E.dll" : "System\\RGSS104E.dll";
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "Game.ini"), iniText({
    library,
    scripts: "Data\\Scripts." + extension,
    title: options.title === undefined ? "Synthetic Quest" : options.title,
  }));
  const documents = {
    Actors: actorsDocument(),
    Items: itemsDocument(),
    MapInfos: mapInfosDocument(),
    Map001: mapDocument(),
    CommonEvents: commonEventsDocument(),
    Troops: troopsDocument(),
    System: systemDocument(),
    ...(options.extraDocuments || {}),
  };
  const entries = Object.entries(documents).map(([base, value]) => ({
    name: "Data/" + base + "." + extension,
    data: marshal(value),
  }));
  // A binary asset in the archive proves the reader does not assume every entry
  // is a text document.
  entries.push({ name: "Graphics/Pictures/placeholder.png", data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) });
  writeArchive(path.join(root, "Game." + suffix), { version, entries });
  return root;
}

/** The source strings this fixture is expected to produce, for assertions. */
export const EXPECTED = Object.freeze({
  dialogue: [
    "This room exists only for the tests.",
    "The lamp is a placeholder.",
    "It is still a placeholder.",
    "The door does not open.",
    "Nothing happens either way.",
    "A common event line.",
    "A battle line.",
  ],
  choices: ["Open the door", "Leave it alone"],
  speakers: ["Narrator"],
  renamed: ["Test Name"],
  terms: ["Level", "Lv", "Max HP", "Max MP", "Weapon", "Shield", "Fight", "Escape"],
  names: ["Yuki", "Yu", "Test Potion", "Test Room", "Test Hall", "Test Common Event"],
  forbidden: ["editor comment: never translated", "$game_variables[1] = 1", "Picture1", "Actor1"],
});

export default { writeRgssProject, writePackedProject, EXPECTED };
