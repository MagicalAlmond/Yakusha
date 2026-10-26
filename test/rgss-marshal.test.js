/**
 * Ruby Marshal reader and writer (src/engines/rgss/marshal.js).
 *
 * The writer is what puts a translation back into a game, so the tests are
 * round trips: every value the reader produces must survive marshal ->
 * unmarshal, and a stream that is not a well formed Marshal 4.x document must
 * fail with a readable message instead of returning half a value.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  MarshalError,
  isClass,
  isString,
  ivarText,
  makeString,
  marshal,
  setText,
  text,
  unmarshal,
} from "../src/engines/rgss/marshal.js";

/** Marshal a value and read it back, asserting the whole buffer was consumed. */
function roundTrip(value) {
  const bytes = marshal(value);
  const result = unmarshal(bytes);
  assert.equal(result.consumed, bytes.length, "the reader must consume the whole stream");
  return result.value;
}

/** Build a Marshal string node without the export dance in every test. */
function str(value) {
  return makeString(value);
}

/** Build a Ruby object node. */
function record(className, ivars) {
  return { __type: "object", className, ivars };
}
test("marshal: the header is version 4.8", () => {
  const bytes = marshal(null);
  assert.deepEqual([...bytes.subarray(0, 2)], [4, 8]);
  assert.equal(unmarshal(bytes).minor, 8);
});

test("marshal: scalars round trip", () => {
  assert.equal(roundTrip(null), null);
  assert.equal(roundTrip(true), true);
  assert.equal(roundTrip(false), false);
  for (const value of [0, 1, 122, 123, 300, -1, -122, -123, -300, 2147483647, -2147483648]) {
    assert.equal(roundTrip(value), value, String(value));
  }
  // Ruby floats are objects too, so they come back as nodes.
  assert.deepEqual(roundTrip(1.5), { __type: "float", value: 1.5 });
});

test("marshal: a BigInt stays a BigInt", () => {
  const back = roundTrip(2n ** 70n);
  // A Bignum comes back as a node so a caller can tell it from a Fixnum.
  assert.equal(back.__type, "bignum");
  assert.equal(back.value, 2n ** 70n);
});

test("marshal: strings keep their bytes and their encoding ivar", () => {
  const node = roundTrip(str("\u30c6\u30b9\u30c8"));
  assert.equal(isString(node), true);
  assert.equal(text(node), "\u30c6\u30b9\u30c8");
  assert.deepEqual(node.ivars, { E: true });
});

test("marshal: an empty string is a value, not a missing one", () => {
  const node = roundTrip(str(""));
  assert.equal(isString(node), true);
  assert.equal(text(node), "");
});
test("marshal: arrays, hashes and nested records round trip", () => {
  const value = [
    null,
    record("RPG::Actor", { "@id": 1, "@name": str("Test") }),
    new Map([
      [1, [str("a"), str("b")]],
      [2, record("RPG::MapInfo", { "@name": str("Room") })],
    ]),
  ];
  const back = roundTrip(value);
  assert.equal(back.length, 3);
  assert.equal(isClass(back[1], "RPG::Actor"), true);
  assert.equal(ivarText(back[1], "name"), "Test");
  assert.equal(back[2] instanceof Map, true);
  assert.deepEqual(back[2].get(1).map(text), ["a", "b"]);
  assert.equal(ivarText(back[2].get(2), "name"), "Room");
});

test("marshal: a hash with a default value keeps the default", () => {
  const value = { __type: "hash", entries: new Map([[str("k"), 1]]), defaultValue: 7 };
  const back = roundTrip(value);
  // Hash keys keep their Ruby type, so a string key comes back as a string node.
  const [[key, item]] = [...back.entries];
  assert.equal(text(key), "k");
  assert.equal(item, 1);
  assert.equal(back.defaultValue, 7);
});

test("marshal: an opaque T_DATA node round trips as bytes", () => {
  const value = { __type: "data", className: "Table", bytes: Buffer.from([1, 2, 3, 4]) };
  const back = roundTrip(value);
  assert.deepEqual([...back.bytes], [1, 2, 3, 4]);
  assert.equal(back.className, "Table");
});

test("marshal: a _dump node round trips as a class plus bytes", () => {
  const value = { __type: "dump", className: "MyDump", bytes: Buffer.from([9, 8]) };
  const back = roundTrip(value);
  assert.deepEqual([...back.bytes], [9, 8]);
});

test("marshal: a marshal_dump node keeps its single value", () => {
  const value = { __type: "marshaled", className: "MyMarshal", value: [1, str("x")] };
  const back = roundTrip(value);
  assert.equal(back.className, "MyMarshal");
  assert.equal(back.value[0], 1);
  assert.equal(text(back.value[1]), "x");
});

test("marshal: none of the node types render a live object", () => {
  // A stream is data: no node may come back callable, whatever its class says.
  const back = roundTrip([record("Kernel", { "@x": 1 }), { __type: "class", name: "Kernel" }]);
  for (const value of back) assert.notEqual(typeof value, "function");
});

test("marshal: setText replaces the bytes and keeps the encoding ivar", () => {
  const node = str("before");
  setText(node, "after");
  assert.equal(text(node), "after");
  assert.deepEqual(node.ivars, { E: true });
});

test("marshal: setText refuses a node that is not a string", () => {
  assert.throws(() => setText({ __type: "object" }, "x"), MarshalError);
});
test("marshal: a stream that is not Marshal 4.x is refused", () => {
  assert.throws(() => unmarshal(Buffer.from([5, 0, 0])), /unsupported Marshal version 5\.0/);
  assert.throws(() => unmarshal(Buffer.from([])), MarshalError);
  assert.throws(() => unmarshal("not a buffer"), /needs a Buffer/);
});

test("marshal: a truncated stream fails instead of returning half a value", () => {
  const bytes = marshal([str("abcdef"), 1]);
  for (let cut = 3; cut < bytes.length; cut += 1) {
    assert.throws(() => unmarshal(bytes.subarray(0, cut)), MarshalError, "cut at " + cut);
  }
});

test("marshal: a symbol link with no target is refused", () => {
  // 4.8, an object whose class name is a link to a symbol that was never defined.
  const bytes = Buffer.from([4, 8, 0x6f, 0x3b, 0x06, 0x00]);
  assert.throws(() => unmarshal(bytes), /symbol link out of range/);
});

test("marshal: an object link with no target is refused", () => {
  const bytes = Buffer.from([4, 8, 0x40, 0x06]);
  assert.throws(() => unmarshal(bytes), /object link out of range/);
});

test("marshal: a value that contains itself cannot be written", () => {
  const value = [];
  value.push(value);
  assert.throws(() => marshal(value), /contains itself/);
});

test("marshal: a node type the writer does not know is refused", () => {
  assert.throws(() => marshal({ __type: "nonsense" }), /cannot marshal a node of type/);
});
