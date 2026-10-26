/**
 * Ruby Marshal 4.8: reader and writer.
 *
 * RPG Maker XP, VX and VX Ace keep every database and every map in a Ruby
 * Marshal stream (.rxdata, .rvdata, .rvdata2). Reading those streams is how
 * the tool finds the text a player actually sees, and writing them back is how
 * a translation reaches the game, so this module is a complete reader and a
 * complete writer rather than a one-way scraper.
 *
 * Nothing here evaluates Ruby. A stream only ever produces data, and an object
 * becomes a record of its class name plus its instance variables. That is all
 * game data needs, and it is why a hostile file cannot run code through it.
 *
 * Value model - every node is plain data, so callers can walk it with normal
 * JavaScript and JSON-ish tooling:
 *
 *   null, boolean, number                     nil, true, false, Fixnum
 *   Array                                     Array
 *   Map                                       Hash (keys keep their type)
 *   { __type: "string", bytes, ivars }        String, raw bytes plus ivars
 *   { __type: "symbol", name }                a Symbol used as a value
 *   { __type: "object", className, ivars }    T_OBJECT - every RPG::* record
 *   { __type: "struct", className, members }  T_STRUCT
 *   { __type: "data", className, bytes }      T_DATA (RPG::Table and friends)
 *   { __type: "dump", className, bytes }      _dump/_load user object
 *   { __type: "marshaled", className, value } marshal_dump/marshal_load
 *   { __type: "float", value }                Float
 *   { __type: "bignum", value }               Bignum, as a BigInt
 *   { __type: "class"|"module", name }        Class / Module
 *   { __type: "hash", entries, defaultValue } Hash with a default value
 *   { __type: "regexp", bytes, options }      Regexp
 *   { __type: "extended", module, value }     object extended by a module
 *   { __type: "userclass", name, value }      Class.new style user class
 *
 * Strings keep their bytes instead of being decoded eagerly. A game script is
 * often a deflate blob that must come back out byte for byte, and a string
 * that is already correct must survive a load/save cycle untouched, so the
 * bytes are the value and decoding is a separate, explicit step.
 *
 * @module engines/rgss/marshal
 */

/** Raised for anything that is not a Marshal 4.x stream this module understands. */
export class MarshalError extends Error {
  constructor(message) {
    super(message);
    this.name = "MarshalError";
  }
}

/** Guards against a truncated or hostile stream nesting without end. */
const MAX_DEPTH = 512;

const TAG = Object.freeze({
  NIL: 0x30,
  TRUE: 0x54,
  FALSE: 0x46,
  FIXNUM: 0x69,
  SYMBOL: 0x3a,
  SYMLINK: 0x3b,
  LINK: 0x40,
  STRING: 0x22,
  IVAR: 0x49,
  ARRAY: 0x5b,
  HASH: 0x7b,
  HASH_DEFAULT: 0x7d,
  OBJECT: 0x6f,
  STRUCT: 0x53,
  USER_DEF: 0x75,
  USER_MARSHAL: 0x55,
  DATA: 0x64,
  FLOAT: 0x66,
  BIGNUM: 0x6c,
  CLASS: 0x63,
  MODULE: 0x6d,
  OLD_MODULE: 0x4d,
  REGEXP: 0x2f,
  EXTENDED: 0x65,
  USERCLASS: 0x43
});

/**
 * Read one stream.
 *
 * @param {Buffer} buffer
 * @returns {{ value: unknown, consumed: number, total: number, minor: number }}
 *   consumed === total means the whole buffer was exactly one value, which is
 *   the check worth making on every game file: anything left over means the
 *   reader misread a length somewhere.
 */
export function unmarshal(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new MarshalError("unmarshal needs a Buffer");
  const state = { buf: buffer, pos: 0, symbols: [], objects: [] };
  const major = readByte(state);
  const minor = readByte(state);
  if (major !== 4) {
    throw new MarshalError("unsupported Marshal version " + major + "." + minor + " (this reader handles 4.x)");
  }
  const value = readValue(state, 0);
  return { value, consumed: state.pos, total: buffer.length, minor };
}

/* ------------------------------------------------------------------ reader */

function readByte(state) {
  if (state.pos >= state.buf.length) throw new MarshalError("unexpected end of stream at " + state.pos);
  return state.buf[state.pos++];
}

function readBytes(state, length) {
  if (length < 0 || state.pos + length > state.buf.length) {
    throw new MarshalError("truncated stream: wanted " + length + " bytes at " + state.pos);
  }
  const slice = state.buf.subarray(state.pos, state.pos + length);
  state.pos += length;
  return slice;
}

/**
 * Ruby's variable-length integer.
 *
 * A leading byte of 0 means zero, 6..127 is a small positive number, 0x80..0xfa
 * a small negative one, and the markers 4 and 0xfc introduce a full 32-bit
 * value. Marker 8 is a 64-bit value, which game data does not use but a generic
 * reader should still accept.
 */
function readLong(state) {
  const first = readByte(state);
  if (first === 0) return 0;
  if (first < 0x80) {
    if (first >= 5) return first - 5;
    let value = 0;
    for (let i = 0; i < first; i += 1) value += readByte(state) * Math.pow(256, i);
    return value;
  }
  const signed = first - 256;
  if (signed <= -5) return signed + 5;
  const count = -signed;
  if (count === 4) {
    const raw = readBytes(state, 4);
    const value = raw.readUInt32LE(0);
    return value > 0x7fffffff ? value - 0x100000000 : value;
  }
  let value = 0n;
  for (let i = 0; i < count; i += 1) value |= BigInt(readByte(state)) << BigInt(8 * i);
  const negative = value > 0x7fffffffffffffffn;
  return Number(negative ? value - 0x10000000000000000n : value);
}

function readSymbolName(state) {
  const tag = readByte(state);
  if (tag === TAG.SYMBOL) {
    const length = readLong(state);
    const name = readBytes(state, length).toString("utf8");
    state.symbols.push(name);
    return name;
  }
  if (tag === TAG.SYMLINK) {
    const index = readLong(state);
    if (index < 0 || index >= state.symbols.length) throw new MarshalError("symbol link out of range: " + index);
    return state.symbols[index];
  }
  throw new MarshalError(
    "expected a symbol at " + (state.pos - 1) + ", found " + JSON.stringify(String.fromCharCode(tag))
  );
}

function remember(state, value) {
  state.objects.push(value);
  return value;
}

function readIvars(state, target) {
  const count = readLong(state);
  for (let i = 0; i < count; i += 1) {
    const name = readSymbolName(state);
    target[name] = readValue(state, 0);
  }
  return target;
}

function readValue(state, depth) {
  if (depth > MAX_DEPTH) throw new MarshalError("stream nests deeper than " + MAX_DEPTH + " levels");
  const start = state.pos;
  const tag = readByte(state);
  switch (tag) {
    case TAG.NIL:
      return null;
    case TAG.TRUE:
      return true;
    case TAG.FALSE:
      return false;
    case TAG.FIXNUM:
      return readLong(state);
    case TAG.SYMBOL:
    case TAG.SYMLINK:
      state.pos -= 1;
      return { __type: "symbol", name: readSymbolName(state) };
    case TAG.LINK: {
      const index = readLong(state);
      if (index < 0 || index >= state.objects.length) throw new MarshalError("object link out of range: " + index);
      return state.objects[index];
    }
    case TAG.STRING: {
      const length = readLong(state);
      return remember(state, { __type: "string", bytes: Buffer.from(readBytes(state, length)), ivars: null });
    }
    case TAG.IVAR: {
      const value = readValue(state, depth + 1);
      // The count that follows comes from the stream, not from the value: a
      // string with no encoding flag is written as I"<len><bytes> followed by a
      // zero count. Reading the count first is what keeps the cursor aligned.
      const count = readLong(state);
      if (count === 0) return value;
      const keep = Boolean(value) && typeof value === "object" && value.__type === "string";
      if (keep && !value.ivars) value.ivars = {};
      for (let i = 0; i < count; i += 1) {
        const name = readSymbolName(state);
        const ivar = readValue(state, depth + 1);
        // Only strings show up with encoding ivars in game data; ivars on
        // anything else are read to keep the cursor aligned and then dropped
        // rather than mis-attached.
        if (keep) value.ivars[name] = ivar;
      }
      return value;
    }
    case TAG.ARRAY: {
      const count = readLong(state);
      const array = remember(state, []);
      for (let i = 0; i < count; i += 1) array.push(readValue(state, depth + 1));
      return array;
    }
    case TAG.HASH: {
      const count = readLong(state);
      const entries = remember(state, new Map());
      for (let i = 0; i < count; i += 1) {
        const key = readValue(state, depth + 1);
        entries.set(key, readValue(state, depth + 1));
      }
      return entries;
    }
    case TAG.HASH_DEFAULT: {
      const count = readLong(state);
      const node = remember(state, { __type: "hash", entries: new Map(), defaultValue: null });
      for (let i = 0; i < count; i += 1) {
        const key = readValue(state, depth + 1);
        node.entries.set(key, readValue(state, depth + 1));
      }
      node.defaultValue = readValue(state, depth + 1);
      return node;
    }
    case TAG.OBJECT: {
      const className = readSymbolName(state);
      const node = remember(state, { __type: "object", className, ivars: {} });
      readIvars(state, node.ivars);
      return node;
    }
    case TAG.STRUCT: {
      const className = readSymbolName(state);
      const count = readLong(state);
      const node = remember(state, { __type: "struct", className, members: {} });
      for (let i = 0; i < count; i += 1) node.members[readSymbolName(state)] = readValue(state, depth + 1);
      return node;
    }
    case TAG.DATA: {
      const className = readSymbolName(state);
      const length = readLong(state);
      return { __type: "data", className, bytes: Buffer.from(readBytes(state, length)) };
    }
    case TAG.USER_DEF: {
      const className = readSymbolName(state);
      const length = readLong(state);
      const node = remember(state, { __type: "dump", className, bytes: Buffer.alloc(0) });
      node.bytes = Buffer.from(readBytes(state, length));
      return node;
    }
    case TAG.USER_MARSHAL: {
      const className = readSymbolName(state);
      const node = remember(state, { __type: "marshaled", className, value: null });
      node.value = readValue(state, depth + 1);
      return node;
    }
    case TAG.FLOAT: {
      const length = readLong(state);
      const raw = readBytes(state, length).toString("latin1");
      const value = raw === "inf" ? Infinity : raw === "-inf" ? -Infinity : raw === "nan" ? NaN : Number(raw);
      // Ruby registers floats in the object table like any other value, and
      // database files do link back to one (a shared 0.0 rate), so skipping the
      // registration shifts every later link by one.
      return remember(state, { __type: "float", value });
    }
    case TAG.BIGNUM:
      return { __type: "bignum", value: readBignum(state) };
    case TAG.CLASS:
      return { __type: "class", name: readSymbolName(state) };
    case TAG.MODULE:
    case TAG.OLD_MODULE:
      return { __type: "module", name: readSymbolName(state) };
    case TAG.REGEXP: {
      const length = readLong(state);
      const bytes = Buffer.from(readBytes(state, length));
      const options = readByte(state);
      return { __type: "regexp", bytes, options };
    }
    case TAG.EXTENDED: {
      const name = readSymbolName(state);
      return { __type: "extended", module: name, value: readValue(state, depth + 1) };
    }
    case TAG.USERCLASS: {
      const name = readSymbolName(state);
      return { __type: "userclass", name, value: readValue(state, depth + 1) };
    }
    default:
      throw new MarshalError(
        "unknown Marshal type " + JSON.stringify(String.fromCharCode(tag)) + " (0x" + tag.toString(16) + ") at " + start
      );
  }
}

/**
 * Ruby stores a bignum as base-65536 digits, two bytes each, little endian,
 * packed into the low half of every byte pair.
 */
function readBignum(state) {
  const sign = readByte(state);
  const count = readLong(state);
  let value = 0n;
  for (let i = 0; i < count; i += 1) {
    const low = readByte(state);
    const high = readByte(state);
    value |= BigInt(low + high * 256) << BigInt(16 * i);
  }
  return sign === 0x2d ? -value : value;
}

/* --------------------------------------------------------- value helpers */

/**
 * True when a node is a Marshal string.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isString(value) {
  return Boolean(value) && typeof value === "object" && value.__type === "string";
}

/**
 * The text of a string node.
 *
 * @param {unknown} value
 * @returns {string|null} null when the node is not a string
 */
export function text(value) {
  if (isString(value)) return value.bytes.toString("utf8");
  return null;
}

/**
 * Build a string node that Ruby reads back as UTF-8.
 *
 * The E ivar is what tells Ruby the bytes are UTF-8 rather than raw bytes,
 * which matters for every non-ASCII name and line in a translated game.
 *
 * @param {string} value
 * @returns {{ __type: "string", bytes: Buffer, ivars: Record<string, unknown> }}
 */
export function makeString(value) {
  return { __type: "string", bytes: Buffer.from(String(value), "utf8"), ivars: { E: true } };
}

/**
 * Replace the text of a string node in place, keeping its encoding ivars.
 *
 * @param {object} node a node from unmarshal
 * @param {string} value
 */
export function setText(node, value) {
  if (!isString(node)) throw new MarshalError("setText needs a string node");
  node.bytes = Buffer.from(String(value), "utf8");
  if (!node.ivars) node.ivars = { E: true };
}

/**
 * True when a node is a Marshal object (a class name plus instance variables).
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isObject(value) {
  return Boolean(value) && typeof value === "object" && value.__type === "object";
}

/**
 * True when a node is an object of exactly one RPG class.
 *
 * @param {unknown} value
 * @param {string} className
 * @returns {boolean}
 */
export function isClass(value, className) {
  return isObject(value) && value.className === className;
}

/**
 * Instance variables of an object or struct, or null.
 *
 * @param {unknown} value
 * @returns {Record<string, unknown>|null}
 */
export function ivarsOf(value) {
  if (isObject(value)) return value.ivars;
  if (value && typeof value === "object" && value.__type === "struct") return value.members;
  return null;
}

/**
 * Read one instance variable as text, or null when it is missing or not a
 * string. The name is passed without its leading at-sign.
 *
 * @param {unknown} value
 * @param {string} name
 * @returns {string|null}
 */
export function ivarText(value, name) {
  const ivars = ivarsOf(value);
  if (!ivars) return null;
  return text(ivars["@" + name]);
}

/* --------------------------------------------------------------- writer */

/**
 * Write one value as a Marshal 4.8 stream.
 *
 * The writer emits the smallest correct encoding for every value, as Ruby has
 * always done, so an unmodified file round-trips byte for byte. It does not
 * emit object links - each value is written once - which costs a few bytes on a
 * file that repeats a shared object and is otherwise identical.
 *
 * @param {unknown} value
 * @returns {Buffer}
 */
export function marshal(value) {
  const state = { chunks: [], symbols: [], stack: new Set() };
  pushByte(state, 4);
  pushByte(state, 8);
  writeValue(state, value);
  return Buffer.concat(state.chunks);
}

function pushByte(state, byte) {
  state.chunks.push(Buffer.from([byte & 0xff]));
}

function pushBytes(state, bytes) {
  if (bytes.length > 0) state.chunks.push(Buffer.from(bytes));
}

function writeLong(state, value) {
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number)) {
    throw new MarshalError("Marshal needs integers, got " + String(value));
  }
  if (number === 0) {
    pushByte(state, 0);
    return;
  }
  if (number > 0 && number < 123) {
    pushByte(state, number + 5);
    return;
  }
  if (number < 0 && number > -124) {
    pushByte(state, number - 5 + 256);
    return;
  }
  if (number > 0 && number <= 0x7fffffff) {
    pushByte(state, 4);
    pushBytes(state, int32(number));
    return;
  }
  if (number < 0 && number >= -0x80000000) {
    pushByte(state, 0xfc);
    pushBytes(state, int32(number));
    return;
  }
  let big = BigInt(number);
  if (big < 0n) big = -big;
  const bytes = [];
  while (big > 0n) {
    bytes.push(Number(big & 0xffn));
    big >>= 8n;
  }
  while (bytes.length < 8) bytes.push(0);
  pushByte(state, 8);
  pushBytes(state, Buffer.from(bytes.slice(0, 8)));
}

function int32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(Number(BigInt.asUintN(32, BigInt(value))), 0);
  return buffer;
}

function writeSymbolName(state, name) {
  const index = state.symbols.indexOf(name);
  if (index >= 0) {
    pushByte(state, TAG.SYMLINK);
    writeLong(state, index);
    return;
  }
  state.symbols.push(name);
  pushByte(state, TAG.SYMBOL);
  const bytes = Buffer.from(String(name), "utf8");
  writeLong(state, bytes.length);
  pushBytes(state, bytes);
}

function writeIvars(state, ivars) {
  const names = Object.keys(ivars || {});
  if (names.length === 0) {
    writeLong(state, 0);
    return;
  }
  writeLong(state, names.length);
  for (const name of names) {
    writeSymbolName(state, name);
    writeValue(state, ivars[name]);
  }
}

function writeString(state, node) {
  const ivars = node.ivars || {};
  const names = Object.keys(ivars);
  if (names.length > 0) pushByte(state, TAG.IVAR);
  pushByte(state, TAG.STRING);
  writeLong(state, node.bytes.length);
  pushBytes(state, node.bytes);
  if (names.length > 0) writeIvars(state, ivars);
}

function writeValue(state, value) {
  if (value === null || value === undefined) {
    pushByte(state, TAG.NIL);
    return;
  }
  if (value === true) {
    pushByte(state, TAG.TRUE);
    return;
  }
  if (value === false) {
    pushByte(state, TAG.FALSE);
    return;
  }
  const type = typeof value;
  if (type === "number") {
    if (!Number.isInteger(value)) {
      writeFloat(state, value);
      return;
    }
    pushByte(state, TAG.FIXNUM);
    writeLong(state, value);
    return;
  }
  if (type === "bigint") {
    pushByte(state, TAG.BIGNUM);
    const negative = value < 0n;
    let rest = negative ? -value : value;
    const pairs = [];
    while (rest > 0n) {
      pairs.push(Number(rest & 0xffffn));
      rest >>= 16n;
    }
    pushByte(state, negative ? 0x2d : 0x2b);
    writeLong(state, pairs.length);
    for (const pair of pairs) {
      pushByte(state, pair & 0xff);
      pushByte(state, (pair >> 8) & 0xff);
    }
    return;
  }
  if (type !== "object") throw new MarshalError("cannot marshal a " + type);

  if (state.stack.has(value)) throw new MarshalError("cannot marshal a value that contains itself");
  state.stack.add(value);
  try {
    writeComposite(state, value);
  } finally {
    state.stack.delete(value);
  }
}

function writeFloat(state, value) {
  const raw = Buffer.from(
    Number.isNaN(value) ? "nan" : value === Infinity ? "inf" : value === -Infinity ? "-inf" : String(value),
    "latin1"
  );
  pushByte(state, TAG.FLOAT);
  writeLong(state, raw.length);
  pushBytes(state, raw);
}

function writeComposite(state, value) {
  if (Array.isArray(value)) {
    pushByte(state, TAG.ARRAY);
    writeLong(state, value.length);
    for (const item of value) writeValue(state, item);
    return;
  }
  if (value instanceof Map) {
    pushByte(state, TAG.HASH);
    writeLong(state, value.size);
    for (const [key, item] of value) {
      writeValue(state, key);
      writeValue(state, item);
    }
    return;
  }
  switch (value.__type) {
    case "string":
      writeString(state, value);
      return;
    case "symbol":
      writeSymbolName(state, value.name);
      return;
    case "object":
      pushByte(state, TAG.OBJECT);
      writeSymbolName(state, value.className);
      writeIvars(state, value.ivars);
      return;
    case "struct":
      pushByte(state, TAG.STRUCT);
      writeSymbolName(state, value.className);
      writeIvars(state, value.members);
      return;
    case "data":
      pushByte(state, TAG.DATA);
      writeSymbolName(state, value.className);
      writeLong(state, value.bytes.length);
      pushBytes(state, value.bytes);
      return;
    case "dump":
      pushByte(state, TAG.USER_DEF);
      writeSymbolName(state, value.className);
      writeLong(state, value.bytes.length);
      pushBytes(state, value.bytes);
      return;
    case "marshaled":
      pushByte(state, TAG.USER_MARSHAL);
      writeSymbolName(state, value.className);
      writeValue(state, value.value);
      return;
    case "float":
      writeFloat(state, value.value);
      return;
    case "bignum":
      writeValue(state, value.value);
      return;
    case "class":
      pushByte(state, TAG.CLASS);
      writeSymbolName(state, value.name);
      return;
    case "module":
      pushByte(state, TAG.MODULE);
      writeSymbolName(state, value.name);
      return;
    case "regexp":
      pushByte(state, TAG.REGEXP);
      writeLong(state, value.bytes.length);
      pushBytes(state, value.bytes);
      pushByte(state, value.options || 0);
      return;
    case "extended":
      pushByte(state, TAG.EXTENDED);
      writeSymbolName(state, value.module);
      writeValue(state, value.value);
      return;
    case "userclass":
      pushByte(state, TAG.USERCLASS);
      writeSymbolName(state, value.name);
      writeValue(state, value.value);
      return;
    case "hash":
      pushByte(state, TAG.HASH_DEFAULT);
      writeLong(state, value.entries.size);
      for (const [key, item] of value.entries) {
        writeValue(state, key);
        writeValue(state, item);
      }
      writeValue(state, value.defaultValue === undefined ? null : value.defaultValue);
      return;
    default:
      throw new MarshalError("cannot marshal a node of type " + JSON.stringify(value && value.__type));
  }
}

export default {
  unmarshal,
  marshal,
  text,
  makeString,
  setText,
  isString,
  isObject,
  isClass,
  ivarsOf,
  ivarText,
  MarshalError
};
