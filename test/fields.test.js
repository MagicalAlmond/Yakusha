import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DB_FIELDS,
  SYSTEM_FIELDS,
  COMMAND_TEXT,
  COMMAND_PATHS,
  TEXT_CODES,
  pickParams,
  collectAt,
  walkCommands,
  buildRules,
} from "../src/core/fields.js";

test("command paths are pure data", () => {
  assert.equal(COMMAND_PATHS["101"], "4");
  assert.equal(COMMAND_PATHS["102"], "0[]");
  assert.equal(COMMAND_PATHS["401"], "0");
  assert.equal(COMMAND_PATHS["405"], "0");
  assert.equal(COMMAND_PATHS["105"], undefined);
  assert.equal(TEXT_CODES.has(105), true);
  assert.equal(TEXT_CODES.has(999), false);
});

test("pickParams reads single and array slots", () => {
  assert.deepEqual(pickParams(["", 0, 0, 2, "おっさん"], "4"), ["おっさん"]);
  assert.deepEqual(pickParams(["", 0, 0, 2, ""], "4"), []);
  assert.deepEqual(pickParams([["はい", "いいえ"], 1], "0[]"), ["はい", "いいえ"]);
  assert.deepEqual(pickParams([["はい", "", 3]], "0[]"), ["はい"]);
  assert.deepEqual(pickParams(null, "0"), []);
});

test("collectAt walks dotted paths and arrays", () => {
  const system = {
    gameTitle: "T",
    terms: { basic: ["レベル", "Lv"], messages: { alwaysDash: "常時" } },
    armorTypes: ["", "軽装"],
  };
  assert.deepEqual(collectAt(system, "gameTitle"), ["T"]);
  assert.deepEqual(collectAt(system, "terms.basic[]"), ["レベル", "Lv"]);
  assert.deepEqual(collectAt(system, "terms.messages"), ["常時"]);
  assert.deepEqual(collectAt(system, "armorTypes[]"), ["", "軽装"]);
  assert.deepEqual(collectAt(system, "missing.path"), []);
});

test("walkCommands finds commands in maps, common events and troops", () => {
  const cmd = (code, parameters) => ({ code, indent: 0, parameters });
  const map = { events: [null, { pages: [{ list: [cmd(401, ["a"])] }] }] };
  const common = [null, { list: [cmd(101, ["", 0, 0, 2, "n"])] }];
  const troop = [null, { pages: [{ list: [cmd(102, [["x"]])] }] }];

  const seen = [];
  for (const doc of [map, common, troop]) walkCommands(doc, (c) => seen.push(c.code));
  assert.deepEqual(seen, [401, 101, 102]);
});

test("walkCommands ignores non text codes but still descends", () => {
  const seen = [];
  walkCommands({ list: [{ code: 117, indent: 0, parameters: [] }, { code: 401, indent: 0, parameters: ["hit"] }] }, (c) =>
    seen.push(c.code)
  );
  assert.deepEqual(seen, [401]);
});

test("walkCommands tolerates the short params spelling", () => {
  const seen = [];
  walkCommands({ list: [{ code: 401, params: ["short"] }] }, (c) => seen.push(c.params[0]));
  assert.deepEqual(seen, ["short"]);
});

test("buildRules mirrors the tables", () => {
  const rules = buildRules();
  assert.deepEqual(rules.dbFields, DB_FIELDS);
  assert.deepEqual(rules.systemFields, SYSTEM_FIELDS);
  assert.deepEqual(rules.commands, COMMAND_PATHS);
  assert.equal(COMMAND_TEXT.length, 8);
  // the blob must survive JSON serialisation unchanged
  assert.deepEqual(JSON.parse(JSON.stringify(rules)), rules);
});
