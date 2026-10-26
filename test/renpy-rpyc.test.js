import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

import { loads } from "../src/engines/renpy/pickle.js";
import { collectStrings, isRpyc, readContainer, readScript } from "../src/engines/renpy/rpyc.js";

/**
 * Path of the committed fixture, produced by compiling a hand-written .rpy with
 * the Ren'Py 8.5.3 SDK outside this repository. The tests never invoke Ren'Py:
 * the .rpyc is decoded as bytes, exactly as it would be inside a game.
 */
const FIXTURE = fileURLToPath(new URL("./fixtures/renpy-rpyc/game/script.rpyc", import.meta.url));

/**
 * Read the committed fixture.
 *
 * @returns {Buffer} raw .rpyc bytes
 */
function fixture() {
  return readFileSync(FIXTURE);
}

/**
 * Decode one hex string into a buffer.
 *
 * @param {string} hex lowercase hex digits
 * @returns {Buffer}
 */
function hex(text) {
  return Buffer.from(text, "hex");
}

/**
 * Rebuild decoded dictionaries as ordinary objects.
 *
 * `loads` returns null-prototype dictionaries on purpose, so that a payload
 * carrying a "__proto__" key can never reach Object.prototype. deepEqual treats
 * a null prototype as part of the value, so comparisons against object literals
 * go through this helper; the null prototype itself is asserted separately.
 *
 * @param {unknown} value decoded value
 * @returns {unknown} the same value with ordinary objects
 */
function plain(value) {
  if (Array.isArray(value)) return value.map(plain);
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      // defineProperty, not assignment: a decoded dict may legitimately hold a
      // "__proto__" key, and plain assignment would rewrite the prototype.
      Object.defineProperty(out, key, {
        value: plain(item),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return out;
  }
  return value;
}

/**
 * Wrap pickled payloads in a synthetic .rpyc container, choosing slot numbers.
 *
 * The layout is the one Ren'Py writes: the 10-byte marker, one 12-byte
 * (slot, start, length) record per slot, a zero record, then the zlib streams
 * and a trailing md5 this decoder ignores.
 *
 * @param {Array<[number, Buffer]>} entries slot number and pickled payload pairs
 * @returns {Buffer} container bytes
 */
function containerWithSlots(entries) {
  const head = Buffer.alloc(10);
  head.write("RENPY RPC2", 0, "latin1");
  const streams = entries.map(([, payload]) => zlib.deflateSync(payload, { level: 3 }));
  const records = Buffer.alloc(12 * (streams.length + 1));
  let offset = 10 + records.length;
  for (let i = 0; i < streams.length; i++) {
    records.writeUInt32LE(entries[i][0], i * 12);
    records.writeUInt32LE(offset, i * 12 + 4);
    records.writeUInt32LE(streams[i].length, i * 12 + 8);
    offset += streams[i].length;
  }
  return Buffer.concat([head, records, ...streams, Buffer.alloc(16)]);
}

/**
 * Wrap pickled payloads in a container that numbers the slots 1..n.
 *
 * @param {Buffer[]} payloads pickled slot payloads, in slot order
 * @returns {Buffer} container bytes
 */
function container(payloads) {
  return containerWithSlots(payloads.map((payload, index) => [index + 1, payload]));
}

/**
 * Reference pickles produced by CPython 3.10, one per value shape the syntax
 * tree uses. Keeping the bytes instead of the values means these cases prove
 * the reader agrees with CPython rather than with itself.
 */
const PYTHON3 = {
  none: "80054e2e",
  true: "8005882e",
  false: "8005892e",
  int7: "80054b072e",
  int256: "80059504000000000000004d00012e",
  int70000: "80059506000000000000004a701101002e",
  intNeg: "80059506000000000000004afbffffff2e",
  intBig: "8005950c000000000000008a090300000000000000402e",
  float: "8005950a00000000000000473ff80000000000002e",
  floatNeg: "8005950a0000000000000047bfd00000000000002e",
  text: "80059509000000000000008c0568656c6c6f942e",
  kana: "8005950d000000000000008c09e38386e382b9e38388942e",
  list: "8005950f000000000000005d94284b018c0374776f944e88652e",
  tuple: "80059507000000000000004b014b0286942e",
  tuple1: "80059505000000000000004b0985942e",
  dict: "80059513000000000000007d94288c0161944b018c0162948c017894752e",
  dictEmpty: "80057d942e",
  nested: "8005951f000000000000007d948c016b945d94284b014b024b0386947d948c046465657094887365732e",
  sharedTwice: "8005950e000000000000005d94285d948c017394616801652e",
  instance:
    "80059535000000000000008c085f5f6d61696e5f5f948c055468696e67949394298194" +
    "7d94288c05616c706861944b018c0462657461948c0374776f9475622e",
};

test("isRpyc recognises only the modern container marker", () => {
  assert.equal(isRpyc(fixture()), true);
  assert.equal(isRpyc(Buffer.alloc(0)), false);
  assert.equal(isRpyc(Buffer.from("RENPY RP")), false);
  assert.equal(isRpyc(Buffer.from("RENPY RPC3")), false);
  // A legacy file is one zlib stream, so it cannot carry the marker.
  assert.equal(isRpyc(hex("785e658c310e82301885")), false);
});

test("readContainer reports the slot table in file order", () => {
  const containerInfo = readContainer(fixture());
  assert.equal(containerInfo.header, "RENPY RPC2");
  assert.equal(containerInfo.legacy, false);
  assert.deepEqual(containerInfo.slots, [
    { slot: 1, start: 46, size: 1045 },
    { slot: 2, start: 1091, size: 1069 },
  ]);
});

test("readScript decodes the compiled fixture", () => {
  const script = readScript(fixture());
  assert.equal(script.version, 5003000);
  assert.equal(script.legacy, false);
  assert.equal(script.statements.length, 7);
  assert.deepEqual(
    script.statements.map((node) => node.__class),
    [
      "renpy.ast.Init",
      "renpy.ast.Label",
      "renpy.ast.Label",
      "renpy.ast.Init",
      "renpy.ast.Translate",
      "renpy.ast.EndTranslate",
      "renpy.ast.Return",
    ],
  );
  // The filename recorded by the compiler is relative to the game root, never a
  // build-machine path.
  assert.equal(script.statements[0].filename, "game/script.rpy");
  assert.equal(script.statements[0].linenumber, 5);
});

test("collectStrings walks say, menu and translate strings in source order", () => {
  const result = collectStrings(fixture(), "game/script.rpy");
  assert.equal(result.version, 5003000);
  assert.equal(result.nodeCount, 19);
  assert.equal(result.sayCount, 5);
  assert.equal(result.menuCount, 1);
  assert.deepEqual(result.strings, [
    {
      text: "Alpha line one.",
      kind: "say",
      file: "game/script.rpy",
      line: 8,
    },
    {
      text: 'Alpha line two with a quote: "quoted". Second half after a line break.',
      kind: "say",
      file: "game/script.rpy",
      line: 9,
    },
    {
      text: "Narration line in kana: テスト用のダミー行です。",
      kind: "say",
      file: "game/script.rpy",
      line: 11,
    },
    {
      text: "Line with a tag: {i}italic{/i} and a slot: [player_name].",
      kind: "say",
      file: "game/script.rpy",
      line: 12,
    },
    {
      text: "Are you sure?",
      kind: "menu",
      file: "game/script.rpy",
      line: 14,
    },
    {
      text: "Yes, continue.",
      kind: "menu",
      file: "game/script.rpy",
      line: 14,
    },
    {
      text: "No, go back.",
      kind: "menu",
      file: "game/script.rpy",
      line: 14,
    },
    {
      text: "Settings",
      kind: "string",
      file: "game/script.rpy",
      line: 26,
    },
    {
      text: "セッテイ・ダミー",
      kind: "string",
      file: "game/script.rpy",
      line: 26,
    },
    {
      text: "Alpha line one.",
      kind: "say",
      file: "game/script.rpy",
      line: 30,
    },
  ]);
});

test("collectStrings keeps the caller supplied file name verbatim", () => {
  const result = collectStrings(fixture(), "custom/location.rpy");
  assert.equal(result.strings.length, 10);
  for (const unit of result.strings) assert.equal(unit.file, "custom/location.rpy");
  // Omitting the name yields an empty string rather than a guessed path.
  assert.equal(collectStrings(fixture()).strings[0].file, "");
});

test("pickle decodes CPython protocol 5 scalars", () => {
  assert.equal(loads(hex(PYTHON3.none)), null);
  assert.equal(loads(hex(PYTHON3.true)), true);
  assert.equal(loads(hex(PYTHON3.false)), false);
  assert.equal(loads(hex(PYTHON3.int7)), 7);
  assert.equal(loads(hex(PYTHON3.int256)), 256);
  assert.equal(loads(hex(PYTHON3.int70000)), 70000);
  assert.equal(loads(hex(PYTHON3.intNeg)), -5);
  assert.equal(loads(hex(PYTHON3.intBig)), 2n ** 70n + 3n);
  assert.equal(loads(hex(PYTHON3.float)), 1.5);
  assert.equal(loads(hex(PYTHON3.floatNeg)), -0.25);
  assert.equal(loads(hex(PYTHON3.text)), "hello");
  assert.equal(loads(hex(PYTHON3.kana)), "テスト");
});

test("pickle decodes CPython protocol 5 containers", () => {
  assert.deepEqual(loads(hex(PYTHON3.list)), [1, "two", null, true]);
  assert.deepEqual(loads(hex(PYTHON3.tuple)), [1, 2]);
  assert.deepEqual(loads(hex(PYTHON3.tuple1)), [9]);
  // Dictionaries come back without a prototype, so a pickled "__proto__" key is
  // inert data rather than a way into Object.prototype.
  assert.equal(Object.getPrototypeOf(loads(hex(PYTHON3.dict))), null);
  assert.deepEqual(plain(loads(hex(PYTHON3.dict))), { a: 1, b: "x" });
  assert.deepEqual(plain(loads(hex(PYTHON3.dictEmpty))), {});
  assert.deepEqual(plain(loads(hex(PYTHON3.nested))), { k: [1, [2, 3], { deep: true }] });

  // A pickled "__proto__" key is ordinary data: it lands as an own property and
  // Object.prototype is left untouched.
  const polluted = loads(hex("80059519000000000000007d94288c095f5f70726f746f5f5f944b018c016b944b02752e"));
  assert.equal(Object.getPrototypeOf(polluted), null);
  assert.deepEqual(Object.keys(polluted), ["__proto__", "k"]);
  assert.equal(Object.getOwnPropertyDescriptor(polluted, "__proto__").value, 1);
  assert.equal(polluted.k, 2);
  assert.equal(Object.prototype.k, undefined);
});

test("pickle keeps memoised identity instead of copying", () => {
  const shared = loads(hex(PYTHON3.sharedTwice));
  assert.equal(shared.length, 2);
  assert.equal(shared[0] === shared[1], true);
  assert.deepEqual(shared[0], ["s"]);
});

test("pickle builds objects with a dotted __class and merged state", () => {
  const instance = loads(hex(PYTHON3.instance));
  assert.equal(instance.__class, "Thing");
  assert.equal(instance.alpha, 1);
  assert.equal(instance.beta, "two");
});

test("pickle decodes protocol 0, 1 and 2 payloads", () => {
  assert.equal(loads(hex("5668656c6c6f20776f726c640a70300a2e")), "hello world");
  assert.deepEqual(plain(loads(hex("286470300a56610a70310a49310a7356620a70320a5674776f0a70330a732e"))), {
    a: 1,
    b: "two",
  });
  assert.equal(loads(hex("4c31323334353637383930313233344c0a2e")), 12345678901234);
  assert.equal(loads(hex("580b00000068656c6c6f20776f726c6471002e")), "hello world");
  assert.equal(loads(hex("80025809000000e38386e382b9e3838871002e")), "テスト");
  assert.deepEqual(loads(hex("286c70300a49310a6149320a6149330a612e")), [1, 2, 3]);
});

test("pickle decodes protocol 0 unicode escapes and bare quotes", () => {
  // UNICODE writes raw-unicode-escape text with no surrounding quotes, so a
  // quote inside the value is data and escapes must still be expanded.
  assert.deepEqual(plain(loads(hex("286470300a566b0a70310a5668656c6c6f20776f726c640a70320a732e"))), {
    k: "hello world",
  });
  assert.deepEqual(
    plain(loads(hex("286470300a566b0a70310a566c696e655c75303030617769746809746162205c753030356320656e640a70320a732e"))),
    { k: "line\nwith\ttab \\ end" },
  );
  assert.deepEqual(plain(loads(hex("286470300a566b0a70310a5661276222630a70320a732e"))), { k: "a'b\"c" });
});

test("pickle reports a truncated stream instead of guessing", () => {
  assert.throws(() => loads(hex("8005950500000000000000")), /pickle stream is truncated at byte \d+/);
  assert.throws(() => loads(hex("80028c0568656c")), /pickle stream is truncated at byte \d+/);
});

test("pickle rejects Python 2 and unsupported opcodes with a one-line error", () => {
  // INST is how Python 2.7 pickles an instance; Ren'Py 7.x games contain these.
  assert.throws(() => loads(hex("28695f5f6d61696e5f5f0a5468696e670a2e")), {
    message:
      "pickle opcode INST (protocol 0 class instantiation) is not supported: " +
      "this .rpyc uses Python 2 constructs (Ren'Py 7.x)",
  });
  assert.throws(() => loads(hex("8002512e")), /pickle opcode BINPERSID \(persistent id\) needs an external store/);
  assert.throws(() => loads(hex("8005002e")), /unsupported pickle opcode 0x00 at byte \d+/);
  assert.throws(() => loads(hex("800268052e")), /pickle memo index 5 is out of range at byte \d+/);
  // Errors never carry a stack trace of the reader itself.
  try {
    loads(hex("28695f5f6d61696e5f5f0a5468696e670a2e"));
  } catch (error) {
    assert.equal(error.message.includes("\n"), false);
  }
});

test("pickle rejects empty and non-buffer input", () => {
  assert.throws(() => loads(Buffer.alloc(0)), { message: "pickle input is empty" });
  assert.throws(() => loads("80054e2e"), { message: "pickle input must be a Buffer or Uint8Array" });
  // A Uint8Array view over the same bytes decodes identically.
  assert.equal(loads(new Uint8Array(hex(PYTHON3.int7))), 7);
});

test("rpyc tolerates a corrupt rollback slot", () => {
  // Slot 2 holds the rollback table, which the decoder never needs. Damaging it
  // must not stop the script from being read.
  const bytes = Buffer.from(fixture());
  const rollback = readContainer(bytes).slots.find((slot) => slot.slot === 2);
  bytes.fill(0x00, rollback.start, rollback.start + 16);
  assert.deepEqual(readContainer(bytes).slots.length, 2);
  assert.equal(collectStrings(bytes, "game/script.rpy").strings.length, 10);
});

test("collectStrings terminates on a self-referential syntax tree", () => {
  // Real .rpyc trees are cyclic: Menu.statement_start points back at an earlier
  // node, and Say nodes are cross-linked. A walk without a guard would not end.
  const cyclic =
    "800595c1000000000000007d948c0776657273696f6e944af8564c00735d948c0972656e70792e617374" +
    "948c044d656e759493942981947d94288c0a6c696e656e756d626572944b058c0b6861735f63617074696f" +
    "6e94888c056974656d73945d948c0a43686f696365206f6e65948c0454727565945d9468038c03536179" +
    "9493942981947d94288c0477686174948c1248656c6c6f206d656e752063617074696f6e9468084b078c" +
    "0f73746174656d656e745f73746172749468067562618794616815680675626186942e";
  const result = collectStrings(container([hex(cyclic)]), "game/cycle.rpy");
  assert.equal(result.nodeCount, 2);
  assert.equal(result.menuCount, 1);
  assert.equal(result.sayCount, 1);
  assert.deepEqual(result.strings, [
    {
      text: "Choice one",
      kind: "menu",
      file: "game/cycle.rpy",
      line: 5,
    },
    {
      text: "Hello menu caption",
      kind: "say",
      file: "game/cycle.rpy",
      line: 7,
    },
  ]);
});

test("readScript accepts a legacy single-stream file", () => {
  // Ren'Py 6 and early 7 wrote the pickle as one zlib stream with no container.
  const legacy = hex(
    "785e658c31128230144423a06044c72350c62637f002626793c622e01fc280891f884c0a66b4f1ac1ec" +
      "350dbbd7db3bbaf6042c2444c087942d7d746e3e2f44d8f44845e35e030108927ab5b533670c3d05e3" +
      "1626507fae1b8ec077a918ee2f2f0c6d5843113912f8f4a0e9888bdc73354b274595b6bc88c068e6b4" +
      "1bd9eb3b6f7023aa479680b351f6c264c99fadf0da3e1b855348f6c011fdcf11fc70032e1",
  );
  assert.equal(isRpyc(legacy), false);
  const containerInfo = readContainer(legacy);
  assert.equal(containerInfo.legacy, true);
  assert.deepEqual(containerInfo.slots, [{ slot: 1, start: 0, size: legacy.length }]);
  const script = readScript(legacy);
  assert.equal(script.legacy, true);
  assert.equal(script.version, 4001000);
  assert.equal(script.statements.length, 2);
  assert.deepEqual(
    collectStrings(legacy, "game/old.rpy").strings.map((unit) => unit.text),
    ["Legacy line one.", "Legacy line two."],
  );
});

test("rpyc rejects malformed containers without leaking a stack trace", () => {
  const header = Buffer.from("RENPY RPC2", "latin1");
  assert.throws(() => readContainer(Buffer.concat([header, Buffer.from("xx")])), {
    message: "rpyc slot table is truncated at byte 10",
  });
  const pastEnd = Buffer.alloc(22);
  pastEnd.write("RENPY RPC2", 0, "latin1");
  pastEnd.writeUInt32LE(1, 10);
  pastEnd.writeUInt32LE(200, 14);
  pastEnd.writeUInt32LE(50, 18);
  assert.throws(() => readContainer(pastEnd), { message: "rpyc slot 1 runs past the end of the file" });
  assert.throws(() => readContainer(Buffer.from("RENPY RPC2", "latin1")), {
    message: "rpyc slot table is truncated at byte 10",
  });
  // A file whose slot table terminates immediately has nothing to read.
  assert.throws(() => readScript(container([])), { message: "rpyc file has no slots" });
  // A file that is neither a container nor a zlib stream is reported as such.
  assert.throws(() => readScript(Buffer.from("not a script at all, really", "latin1")), {
    message: "rpyc payload is not a zlib stream",
  });
  assert.throws(() => readContainer("nope"), { message: "rpyc input must be a Buffer or Uint8Array" });
});

test("rpyc reports a missing script slot and a bad payload", () => {
  // Only slot 2 present: there is no script to read.
  assert.throws(() => readScript(containerWithSlots([[2, hex(PYTHON3.int7)]])), {
    message: "rpyc file has no script slot (slot 1)",
  });
  // Slot 1 holds a scalar instead of a (header, statements) pair.
  assert.throws(() => readScript(container([hex(PYTHON3.int7)])), {
    message: "rpyc slot 1 does not hold a (header, statements) tuple",
  });
  // Slot 1 holds a bare dict instead of a (header, statements) pair.
  assert.throws(() => readScript(container([hex(PYTHON3.dict)])), {
    message: "rpyc slot 1 does not hold a (header, statements) tuple",
  });
  // A well-formed pair whose second element is not a statement list.
  const noList = container([hex("80027d7100580700000076657273696f6e71014af8564c007358020000006e6f71028671032e")]);
  assert.throws(() => readScript(noList), { message: "rpyc slot 1 has no statement list" });
});
