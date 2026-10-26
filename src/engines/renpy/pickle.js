/**
 * Python pickle reader.
 *
 * Ren'Py compiles its scripts to `.rpyc`, whose second RPC slot holds
 * a zlib-compressed Python pickle of the game's abstract syntax tree. Reading
 * that tree is the only way to recover text after Ren'Py has normalised it
 * (escapes rewritten, dialogue split into `renpy.ast.Say` nodes), so this
 * module implements the pickle virtual machine the format needs.
 *
 * Scope, deliberately narrow:
 *
 * - pure JavaScript, no dependencies, synchronous, no `eval`;
 * - protocols 0 to 5, covering every opcode Ren'Py 7 and 8 emit;
 * - Python objects materialise as plain data carrying `__class`, never as
 *   live instances. No opcode here runs code: `GLOBAL` and `STACK_GLOBAL` only
 *   record the dotted name of what Python would have imported.
 *
 * Older Ren'Py releases (7.x) ship Python 2 pickles. Their ordinary string and
 * container opcodes decode here because 8-bit strings become latin-1 text, but
 * the Python-2-only construction opcodes are reported as undecodable instead of
 * guessed at: a wrong value inside the syntax tree would silently corrupt every
 * line of dialogue downstream, which is worse than a clear error.
 *
 * @module engines/renpy/pickle
 */

/** Pickle opcode bytes, named as in CPython's `pickle.py`. */
const OP = {
  MARK: 0x28,
  STOP: 0x2e,
  POP: 0x30,
  POP_MARK: 0x31,
  DUP: 0x32,
  FLOAT: 0x46,
  BINFLOAT: 0x47,
  INT: 0x49,
  BININT: 0x4a,
  BININT1: 0x4b,
  LONG: 0x4c,
  BININT2: 0x4d,
  NONE: 0x4e,
  PERSID: 0x50,
  BINPERSID: 0x51,
  REDUCE: 0x52,
  STRING: 0x53,
  BINSTRING: 0x54,
  SHORT_BINSTRING: 0x55,
  UNICODE: 0x56,
  BINUNICODE: 0x58,
  APPEND: 0x61,
  BUILD: 0x62,
  GLOBAL: 0x63,
  DICT: 0x64,
  APPENDS: 0x65,
  GET: 0x67,
  BINGET: 0x68,
  INST: 0x69,
  LONG_BINGET: 0x6a,
  LIST: 0x6c,
  OBJ: 0x6f,
  PUT: 0x70,
  BINPUT: 0x71,
  LONG_BINPUT: 0x72,
  SETITEM: 0x73,
  TUPLE: 0x74,
  SETITEMS: 0x75,
  EMPTY_LIST: 0x5d,
  EMPTY_TUPLE: 0x29,
  EMPTY_DICT: 0x7d,
  PROTO: 0x80,
  NEWOBJ: 0x81,
  TUPLE1: 0x85,
  TUPLE2: 0x86,
  TUPLE3: 0x87,
  NEWTRUE: 0x88,
  NEWFALSE: 0x89,
  LONG1: 0x8a,
  LONG4: 0x8b,
  SHORT_BINUNICODE: 0x8c,
  BINUNICODE8: 0x8d,
  BINBYTES8: 0x8e,
  EMPTY_SET: 0x8f,
  ADDITEMS: 0x90,
  FROZENSET: 0x91,
  NEWOBJ_EX: 0x92,
  STACK_GLOBAL: 0x93,
  MEMOIZE: 0x94,
  FRAME: 0x95,
  BYTEARRAY8: 0x96,
  NEXT_BUFFER: 0x97,
  READONLY_BUFFER: 0x98,
  BINBYTES: 0x42,
  SHORT_BINBYTES: 0x43,
};

/**
 * Opcode names for error messages.
 *
 * Several opcodes share a byte: pickle reuses one byte for "start collecting
 * into a container" and "make an empty container of that kind" (`d` is both
 * DICT and EMPTY_DICT). The reader tells those apart by whether a MARK is on the
 * stack, exactly as CPython's unpickler does.
 *
 * @type {Map<number, string>}
 */
const OP_NAMES = new Map([
  [OP.MARK, "MARK"],
  [OP.STOP, "STOP"],
  [OP.POP, "POP"],
  [OP.POP_MARK, "POP_MARK"],
  [OP.DUP, "DUP"],
  [OP.FLOAT, "FLOAT"],
  [OP.BINFLOAT, "BINFLOAT"],
  [OP.INT, "INT"],
  [OP.BININT, "BININT"],
  [OP.BININT1, "BININT1"],
  [OP.BININT2, "BININT2"],
  [OP.LONG, "LONG"],
  [OP.LONG1, "LONG1"],
  [OP.LONG4, "LONG4"],
  [OP.NONE, "NONE"],
  [OP.REDUCE, "REDUCE"],
  [OP.STRING, "STRING"],
  [OP.BINSTRING, "BINSTRING"],
  [OP.SHORT_BINSTRING, "SHORT_BINSTRING"],
  [OP.UNICODE, "UNICODE"],
  [OP.BINUNICODE, "BINUNICODE"],
  [OP.BINUNICODE8, "BINUNICODE8"],
  [OP.BINBYTES, "BINBYTES"],
  [OP.SHORT_BINBYTES, "SHORT_BINBYTES"],
  [OP.BINBYTES8, "BINBYTES8"],
  [OP.BYTEARRAY8, "BYTEARRAY8"],
  [OP.APPEND, "APPEND"],
  [OP.APPENDS, "APPENDS"],
  [OP.BUILD, "BUILD"],
  [OP.GLOBAL, "GLOBAL"],
  [OP.DICT, "DICT"],
  [OP.EMPTY_DICT, "EMPTY_DICT"],
  [OP.GET, "GET"],
  [OP.BINGET, "BINGET"],
  [OP.LONG_BINGET, "LONG_BINGET"],
  [OP.LIST, "LIST"],
  [OP.EMPTY_LIST, "EMPTY_LIST"],
  [OP.PUT, "PUT"],
  [OP.BINPUT, "BINPUT"],
  [OP.LONG_BINPUT, "LONG_BINPUT"],
  [OP.SETITEM, "SETITEM"],
  [OP.SETITEMS, "SETITEMS"],
  [OP.TUPLE, "TUPLE"],
  [OP.EMPTY_TUPLE, "EMPTY_TUPLE"],
  [OP.PROTO, "PROTO"],
  [OP.FRAME, "FRAME"],
  [OP.MEMOIZE, "MEMOIZE"],
  [OP.NEWOBJ, "NEWOBJ"],
  [OP.NEWOBJ_EX, "NEWOBJ_EX"],
  [OP.NEWTRUE, "NEWTRUE"],
  [OP.NEWFALSE, "NEWFALSE"],
  [OP.TUPLE1, "TUPLE1"],
  [OP.TUPLE2, "TUPLE2"],
  [OP.TUPLE3, "TUPLE3"],
  [OP.EMPTY_SET, "EMPTY_SET"],
  [OP.ADDITEMS, "ADDITEMS"],
  [OP.FROZENSET, "FROZENSET"],
  [OP.STACK_GLOBAL, "STACK_GLOBAL"],
  [OP.NEXT_BUFFER, "NEXT_BUFFER"],
  [OP.READONLY_BUFFER, "READONLY_BUFFER"],
]);

/** Pickle's marker for "everything above me belongs to one container". */
const MARKER = Symbol("pickle.mark");

/**
 * Construction opcodes removed in Python 3, reported as undecodable.
 *
 * @type {Map<number, string>}
 */
const PYTHON2_ONLY = new Map([
  [OP.INST, "INST (protocol 0 class instantiation)"],
  [OP.OBJ, "OBJ (protocol 1 class instantiation)"],
]);

/** Out-of-band buffer opcodes, which Ren'Py never emits. */
const BUFFER_ONLY = new Map([
  [OP.NEXT_BUFFER, "NEXT_BUFFER"],
  [OP.READONLY_BUFFER, "READONLY_BUFFER"],
]);

/** Persistent-id opcodes; they reference an external store this reader lacks. */
const PERSISTENT = new Map([
  [OP.PERSID, "PERSID"],
  [OP.BINPERSID, "BINPERSID"],
]);

/** Deepest `REDUCE` chain the reader follows before giving up. */
const MAX_DEPTH = 400;

/**
 * The dotted name recorded for an object built from a pickle global.
 *
 * Python resolves globals by module and attribute, e.g. `renpy.ast.Say`. The
 * decoded tree only needs the name, so it is kept verbatim with any leading
 * `__main__.` dropped: Ren'Py pickles some classes defined in `__main__`.
 *
 * @param {string} module dotted module name
 * @param {string} name attribute name
 * @returns {string} dotted class name
 */
function dottedName(module, name) {
  const full = module ? module + "." + name : name;
  return full.startsWith("__main__.") ? full.slice(9) : full;
}

/**
 * Plain object standing in for a pickled dictionary.
 *
 * A null prototype keeps game-authored keys such as `constructor` or
 * `__proto__` from colliding with `Object.prototype`; the keys come from a file on
 * disk, so they are treated as untrusted data.
 *
 * @returns {Record<string, unknown>}
 */
function dictionary() {
  return Object.create(null);
}

/**
 * Plain object standing in for a pickled Python instance.
 *
 * @param {string} name dotted class name recorded in `__class`
 * @returns {Record<string, unknown>}
 */
function instance(name) {
  const obj = Object.create(null);
  obj.__class = name;
  return obj;
}

/**
 * Assign one key into a decoded container.
 *
 * @param {unknown} target
 * @param {unknown} key
 * @param {unknown} value
 */
function setItem(target, key, value) {
  if (Array.isArray(target)) {
    if (typeof key === "number" && Number.isInteger(key) && key >= 0) {
      target[key] = value;
      return;
    }
    // A non-numeric key cannot be an array index. Keeping the value is better
    // than dropping it silently, which would lose dialogue text.
    target.push(value);
    return;
  }
  if (target === null || typeof target !== "object") {
    throw new Error("pickle SETITEM needs a mutable container, found " + typeof target);
  }
  target[String(key)] = value;
}

/**
 * Read a signed little-endian two's complement integer.
 *
 * @param {Buffer} buffer
 * @param {number} offset
 * @param {number} size 1, 2, 4 or 8 bytes
 * @returns {number}
 */
function readIntLE(buffer, offset, size) {
  if (size === 1) return buffer.readInt8(offset);
  if (size === 2) return buffer.readInt16LE(offset);
  if (size === 4) return buffer.readInt32LE(offset);
  return Number(buffer.readBigInt64LE(offset));
}

/**
 * Decode `LONG1`/`LONG4` bytes into a JavaScript number.
 *
 * Python longs can exceed 2^53, which a JSON-shaped syntax tree cannot carry.
 * Values in range come back as numbers; wider ones come back as `BigInt` so
 * the caller sees the precision limit instead of a silently rounded value.
 *
 * @param {Buffer} buffer
 * @param {number} offset
 * @param {number} length
 * @returns {number|bigint}
 */
function decodeLong(buffer, offset, length) {
  if (length === 0) return 0;
  let value = 0n;
  for (let i = length - 1; i >= 0; i--) value = (value << 8n) | BigInt(buffer[offset + i]);
  if (buffer[offset + length - 1] & 0x80) value -= 1n << BigInt(length * 8);
  if (value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number(value);
  }
  return value;
}

/**
 * Decode the printable escapes a protocol 0 string opcode may contain.
 *
 * `STRING` and `UNICODE` store their payload on one line with non-printable
 * bytes written as escapes, so the escapes are resolved here. Unknown escapes
 * are kept literally, which is what Python does.
 *
 * @param {string} text raw characters between the quotes
 * @returns {string} decoded text
 */
function decodeEscapes(text) {
  if (text.indexOf("\\") === -1) return text;
  const out = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== "\\" || i + 1 >= text.length) {
      out.push(ch);
      continue;
    }
    const next = text[++i];
    switch (next) {
      case "n":
        out.push("\n");
        break;
      case "t":
        out.push("\t");
        break;
      case "r":
        out.push("\r");
        break;
      case "\\":
        out.push("\\");
        break;
      case "'":
        out.push("'");
        break;
      case '"':
        out.push('"');
        break;
      case "u": {
        const hex = text.slice(i + 1, i + 5);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out.push(String.fromCharCode(Number.parseInt(hex, 16)));
          i += 4;
        } else {
          out.push("\\u");
        }
        break;
      }
      default:
        // Python keeps an unknown escape as the backslash plus the character.
        out.push("\\", next);
    }
  }
  return out.join("");
}

/**
 * Pickle reader state, kept in a class so `loads` stays the only export.
 */
class PickleReader {
  /**
   * @param {Buffer} buffer
   */
  constructor(buffer) {
    this.buffer = buffer;
    this.offset = 0;
    /** @type {unknown[]} value stack, {@link MARKER} included */
    this.stack = [];
    /** @type {unknown[]} */
    this.memo = [];
    /** Current `REDUCE` nesting depth. */
    this.depth = 0;
  }

  /**
   * Read one byte.
   *
   * @returns {number}
   */
  byte() {
    if (this.offset >= this.buffer.length) {
      throw new Error("pickle stream is truncated at byte " + this.offset);
    }
    return this.buffer[this.offset++];
  }

  /**
   * Read `size` bytes without copying.
   *
   * @param {number} size
   * @returns {Buffer}
   */
  bytes(size) {
    if (size < 0) throw new Error("pickle stream is truncated: negative length");
    if (this.offset + size > this.buffer.length) {
      throw new Error("pickle stream is truncated at byte " + this.offset);
    }
    const slice = this.buffer.subarray(this.offset, this.offset + size);
    this.offset += size;
    return slice;
  }

  /**
   * Read a newline-terminated ASCII line, used by the protocol 0 opcodes.
   *
   * @returns {string}
   */
  line() {
    const start = this.offset;
    for (let i = start; i < this.buffer.length; i++) {
      if (this.buffer[i] === 0x0a) {
        this.offset = i + 1;
        return this.buffer.toString("latin1", start, i);
      }
    }
    throw new Error("pickle stream is truncated at byte " + start);
  }

  /**
   * Read a length-prefixed latin-1 string, as the Python 2 string opcodes store.
   *
   * @param {number} size
   * @returns {string}
   */
  latin1(size) {
    return this.bytes(size).toString("latin1");
  }

  /**
   * Read a length-prefixed UTF-8 string, as the Python 3 string opcodes store.
   *
   * Python strings may contain lone surrogates, which `Buffer.toString` turns
   * into U+FFFD. Dialogue never contains one, so the substitution is not
   * repaired.
   *
   * @param {number} size
   * @returns {string}
   */
  utf8(size) {
    return this.bytes(size).toString("utf8");
  }

  /**
   * Pop the top value.
   *
   * @returns {unknown}
   */
  pop() {
    if (this.stack.length === 0) throw new Error("pickle stack is empty at byte " + this.offset);
    return this.stack.pop();
  }

  /**
   * Pop everything above the nearest {@link MARKER}.
   *
   * @returns {unknown[]}
   */
  popMark() {
    const index = this.stack.lastIndexOf(MARKER);
    if (index === -1) throw new Error("pickle MARK is missing at byte " + this.offset);
    const items = this.stack.slice(index + 1);
    this.stack.length = index;
    return items;
  }

  /**
   * Whether a MARK is currently on the stack.
   *
   * @returns {boolean}
   */
  hasMark() {
    return this.stack.lastIndexOf(MARKER) !== -1;
  }

  /**
   * Read the top value without removing it.
   *
   * @returns {unknown}
   */
  peek() {
    if (this.stack.length === 0) throw new Error("pickle stack is empty at byte " + this.offset);
    return this.stack[this.stack.length - 1];
  }

  /**
   * Store a value in the pickle memo.
   *
   * @param {number} index
   * @param {unknown} value
   */
  memoize(index, value) {
    if (!Number.isInteger(index) || index < 0) {
      throw new Error("pickle memo index is invalid at byte " + this.offset);
    }
    this.memo[index] = value;
  }

  /**
   * Fetch a value from the pickle memo.
   *
   * @param {number} index
   * @returns {unknown}
   */
  unmemo(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.memo.length) {
      throw new Error("pickle memo index " + index + " is out of range at byte " + this.offset);
    }
    return this.memo[index];
  }

  /**
   * Read a 4-byte unsigned length and return the offset it starts at.
   *
   * @returns {number}
   */
  take32() {
    const start = this.offset;
    this.bytes(4);
    return start;
  }

  /**
   * Read a 4-byte unsigned length.
   *
   * @returns {number}
   */
  u32() {
    return this.buffer.readUInt32LE(this.take32());
  }

  /**
   * Read an 8-byte unsigned length.
   *
   * @returns {number}
   */
  u64() {
    const start = this.offset;
    this.bytes(8);
    const value = this.buffer.readBigUInt64LE(start);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("pickle length exceeds the safe integer range at byte " + start);
    }
    return Number(value);
  }

  /**
   * Run the virtual machine until `STOP`.
   *
   * @returns {unknown} the unpickled root value
   */
  run() {
    for (;;) {
      const opcode = this.byte();
      if (opcode === OP.STOP) return this.stack.length === 0 ? undefined : this.stack[this.stack.length - 1];
      this.step(opcode);
    }
  }

  /**
   * Execute one opcode other than `STOP`.
   *
   * @param {number} opcode
   */
  step(opcode) {
    switch (opcode) {
      case OP.PROTO:
        this.bytes(1);
        return;

      case OP.FRAME:
        // FRAME is a buffering hint: it announces that the next N bytes form one
        // buffered run. The length is read and discarded so the opcodes that
        // follow stay in sync.
        this.u64();
        return;

      case OP.MARK:
        this.stack.push(MARKER);
        return;

      case OP.POP:
        this.pop();
        return;

      case OP.POP_MARK:
        this.popMark();
        return;

      case OP.DUP:
        this.stack.push(this.peek());
        return;

      case OP.NONE:
        this.stack.push(null);
        return;

      case OP.NEWTRUE:
        this.stack.push(true);
        return;

      case OP.NEWFALSE:
        this.stack.push(false);
        return;

      case OP.INT:
        this.stack.push(Number.parseInt(this.line(), 10));
        return;

      case OP.LONG: {
        const text = this.line();
        const big = BigInt(text.endsWith("L") ? text.slice(0, -1) : text);
        this.stack.push(
          big >= BigInt(Number.MIN_SAFE_INTEGER) && big <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(big) : big,
        );
        return;
      }

      case OP.FLOAT:
        this.stack.push(Number.parseFloat(this.line()));
        return;

      case OP.BINFLOAT: {
        const start = this.offset;
        this.bytes(8);
        this.stack.push(this.buffer.readDoubleBE(start));
        return;
      }

      case OP.BININT: {
        const start = this.take32();
        this.stack.push(readIntLE(this.buffer, start, 4));
        return;
      }

      case OP.BININT1:
        this.stack.push(this.byte());
        return;

      case OP.BININT2: {
        const start = this.offset;
        this.bytes(2);
        this.stack.push(this.buffer.readUInt16LE(start));
        return;
      }

      case OP.LONG1: {
        const length = this.byte();
        const start = this.offset;
        this.bytes(length);
        this.stack.push(decodeLong(this.buffer, start, length));
        return;
      }

      case OP.LONG4: {
        const start = this.take32();
        const length = this.buffer.readInt32LE(start);
        if (length < 0) throw new Error("pickle LONG4 length is negative at byte " + start);
        const dataStart = this.offset;
        this.bytes(length);
        this.stack.push(decodeLong(this.buffer, dataStart, length));
        return;
      }

      case OP.STRING: {
        const line = this.line();
        const quoted = line.length >= 2 && (line[0] === "'" || line[0] === '"');
        // A STRING opcode carries a latin-1 payload with printable escapes.
        this.stack.push(decodeEscapes(quoted ? line.slice(1, line.length - 1) : line));
        return;
      }

      case OP.UNICODE:
        // Protocol 0 writes the text unquoted on the line after the opcode, in
        // raw-unicode-escape form: \uXXXX and \n\t\r\\ are escaped, but a quote
        // needs none, so nothing is stripped here.
        this.stack.push(decodeEscapes(this.line()));
        return;

      case OP.BINUNICODE:
        this.stack.push(this.utf8(this.u32()));
        return;

      case OP.SHORT_BINUNICODE:
        this.stack.push(this.utf8(this.byte()));
        return;

      case OP.BINUNICODE8:
        this.stack.push(this.utf8(this.u64()));
        return;

      case OP.BINSTRING:
        this.stack.push(this.latin1(this.u32()));
        return;

      case OP.SHORT_BINSTRING:
        this.stack.push(this.latin1(this.byte()));
        return;

      case OP.BINBYTES:
        this.stack.push(Buffer.from(this.bytes(this.u32())));
        return;

      case OP.SHORT_BINBYTES:
        this.stack.push(Buffer.from(this.bytes(this.byte())));
        return;

      case OP.BINBYTES8:
      case OP.BYTEARRAY8:
        this.stack.push(Buffer.from(this.bytes(this.u64())));
        return;

      case OP.PUT:
        this.memoize(Number.parseInt(this.line(), 10), this.peek());
        return;

      case OP.BINPUT:
        this.memoize(this.byte(), this.peek());
        return;

      case OP.LONG_BINPUT: {
        const start = this.take32();
        this.memoize(this.buffer.readUInt32LE(start), this.peek());
        return;
      }

      case OP.GET:
        this.stack.push(this.unmemo(Number.parseInt(this.line(), 10)));
        return;

      case OP.BINGET:
        this.stack.push(this.unmemo(this.byte()));
        return;

      case OP.LONG_BINGET: {
        const start = this.take32();
        this.stack.push(this.unmemo(this.buffer.readUInt32LE(start)));
        return;
      }

      case OP.MEMOIZE:
        // Protocol 4+: the new entry always takes the next free index.
        this.memoize(this.memo.length, this.peek());
        return;

      // -- containers -------------------------------------------------------
      //
      // The "empty" forms are separate opcodes in protocols 1 and 2
      // (EMPTY_DICT 0x7d, EMPTY_LIST 0x5d, EMPTY_TUPLE 0x29), so they need no
      // MARK. The collecting forms require one.
      case OP.EMPTY_DICT:
        this.stack.push(dictionary());
        return;

      case OP.EMPTY_LIST:
        this.stack.push([]);
        return;

      case OP.EMPTY_TUPLE:
        this.stack.push([]);
        return;

      case OP.DICT:
        this.stack.push(dictOf(this.popMark()));
        return;

      case OP.LIST:
        this.stack.push(this.popMark());
        return;

      case OP.TUPLE:
        // Tuples decode as arrays; nothing in the syntax tree needs the
        // distinction, and JSON cannot carry one.
        this.stack.push(this.popMark());
        return;

      case OP.EMPTY_SET:
        this.stack.push([]);
        return;

      case OP.FROZENSET:
        this.stack.push(this.popMark());
        return;

      case OP.SETITEM: {
        const value = this.pop();
        const key = this.pop();
        const target = this.pop();
        setItem(target, key, value);
        this.stack.push(target);
        return;
      }

      case OP.SETITEMS: {
        const items = this.popMark();
        const target = this.pop();
        for (let i = 0; i + 1 < items.length; i += 2) setItem(target, items[i], items[i + 1]);
        this.stack.push(target);
        return;
      }

      case OP.ADDITEMS: {
        const items = this.popMark();
        const target = this.pop();
        if (Array.isArray(target)) target.push(...items);
        this.stack.push(target);
        return;
      }

      case OP.APPEND: {
        const value = this.pop();
        const target = this.pop();
        if (Array.isArray(target)) target.push(value);
        this.stack.push(target);
        return;
      }

      case OP.APPENDS: {
        const items = this.popMark();
        const target = this.pop();
        if (Array.isArray(target)) target.push(...items);
        this.stack.push(target);
        return;
      }

      case OP.TUPLE1:
        this.stack.push([this.pop()]);
        return;

      case OP.TUPLE2: {
        const second = this.pop();
        const first = this.pop();
        this.stack.push([first, second]);
        return;
      }

      case OP.TUPLE3: {
        const third = this.pop();
        const second = this.pop();
        const first = this.pop();
        this.stack.push([first, second, third]);
        return;
      }

      // -- object construction ----------------------------------------------
      case OP.GLOBAL: {
        const module = this.line();
        const name = this.line();
        this.stack.push(dottedName(module, name));
        return;
      }

      case OP.STACK_GLOBAL: {
        const name = this.pop();
        const module = this.pop();
        this.stack.push(dottedName(String(module), String(name)));
        return;
      }

      case OP.REDUCE: {
        const args = this.pop();
        const callable = this.pop();
        this.depth++;
        if (this.depth > MAX_DEPTH) throw new Error("pickle object nesting exceeds " + MAX_DEPTH + " levels");
        try {
          this.stack.push(PickleReader.applyReduce(callable, Array.isArray(args) ? args : []));
        } finally {
          this.depth--;
        }
        return;
      }

      case OP.NEWOBJ: {
        // Stack holds [class, args]; the arguments tuple carries constructor
        // arguments, which no Ren'Py AST node uses.
        this.pop();
        const cls = this.pop();
        this.stack.push(instance(PickleReader.callableName(cls)));
        return;
      }

      case OP.NEWOBJ_EX: {
        this.pop(); // keyword arguments
        this.pop(); // positional arguments
        const cls = this.pop();
        this.stack.push(instance(PickleReader.callableName(cls)));
        return;
      }

      case OP.BUILD: {
        const state = this.pop();
        const target = this.pop();
        this.stack.push(PickleReader.applyState(target, state));
        return;
      }

      default: {
        const python2 = PYTHON2_ONLY.get(opcode);
        if (python2) {
          throw new Error(
            "pickle opcode " + python2 + " is not supported: this .rpyc uses Python 2 constructs (Ren'Py 7.x)",
          );
        }
        const bufferOp = BUFFER_ONLY.get(opcode);
        if (bufferOp) {
          throw new Error("pickle opcode " + bufferOp + " (out-of-band buffer) is not supported");
        }
        const persistent = PERSISTENT.get(opcode);
        if (persistent) {
          throw new Error(
            "pickle opcode " + persistent + " (persistent id) needs an external store and is not supported",
          );
        }
        const name = OP_NAMES.get(opcode);
        const hex = "0x" + opcode.toString(16).padStart(2, "0");
        throw new Error(
          "unsupported pickle opcode " + hex + (name ? " (" + name + ")" : "") + " at byte " + (this.offset - 1),
        );
      }
    }
  }

  /**
   * Apply `BUILD`: merge an object's state onto it, in place.
   *
   * Ren'Py depends on object identity surviving `BUILD` (a node is memoised
   * before its attributes are attached), so the state is merged into
   * `target` and `target` is what stays on the stack.
   *
   * Python 3 stores instance state as `(state_dict, slot_dict)`; both halves are
   * merged flat because the decoded tree only ever reads attributes by name.
   *
   * @param {unknown} target value the state belongs to
   * @param {unknown} state dict, or a two-element sequence of dicts
   * @returns {unknown} the same target, for stack convenience
   */
  static applyState(target, state) {
    if (target === null || typeof target !== "object") return target;
    if (Array.isArray(state) && state.length === 2) {
      PickleReader.applyState(target, state[0]);
      PickleReader.applyState(target, state[1]);
      return target;
    }
    if (state === null || typeof state !== "object") return target;
    for (const key of Object.keys(state)) {
      // __setstate__ payloads describe method state, not attributes of the node.
      if (key === "__class") continue;
      if (Array.isArray(target)) {
        if (/^[0-9]+$/.test(key)) target[Number(key)] = state[key];
      } else {
        target[key] = state[key];
      }
    }
    return target;
  }

  /**
   * Apply `REDUCE`: "call `callable` with `args`", without calling anything.
   *
   * Only the shapes a Ren'Py pickle uses are recognised, and none of them run
   * code:
   *
   * - `set`/`frozenset` become arrays;
   * - `collections.defaultdict` becomes a mapping carrying `default_factory`;
   * - `copyreg._reconstructor` rebuilds a plain object from its state;
   * - anything else becomes an instance carrying `__class`, with object arguments
   *   merged in and a bare string argument kept as `value`.
   *
   * Python 2 byte-string wrappers (`_codecs.encode` and friends) are reported as
   * undecodable rather than approximated, because their payload would be
   * unreadable text.
   *
   * @param {unknown} callable dotted name or nested callable
   * @param {unknown[]} args
   * @returns {unknown}
   */
  static applyReduce(callable, args) {
    const name = PickleReader.callableName(callable);

    if (name === "set" || name === "frozenset" || name === "builtins.set" || name === "builtins.frozenset") {
      return args.length > 0 && Array.isArray(args[0]) ? args[0].slice() : [];
    }

    if (name === "collections.defaultdict") {
      const out = dictionary();
      out.__class = name;
      PickleReader.applyState(out, args[0]);
      if (args.length > 1) out.default_factory = args[1];
      return out;
    }

    if (name === "builtins.dict" || name === "collections.OrderedDict") {
      const out = dictionary();
      PickleReader.applyState(out, args[0]);
      return out;
    }

    if (name === "_codecs.encode" || name === "codecs.encode" || name === "builtins.bytes") {
      throw new Error(
        "pickle REDUCE " + name + " wraps a Python 2 byte string, which is not supported (Ren'Py 7.x .rpyc)",
      );
    }

    const target = instance(name);
    // copyreg._reconstructor(cls, base, state) carries a whole object state.
    if (name.endsWith("_reconstructor") && args.length >= 3) {
      PickleReader.applyState(target, args[2]);
      return target;
    }
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (typeof arg === "string" || Buffer.isBuffer(arg)) {
        // Some AST nodes reduce to their payload, e.g. a string wrapper.
        target.value = arg;
      } else if (arg !== null && typeof arg === "object") {
        PickleReader.applyState(target, arg);
      } else if (arg !== null && arg !== undefined) {
        target.args = target.args || [];
        target.args.push(arg);
      }
    }
    return target;
  }

  /**
   * Name the callable a `REDUCE` refers to.
   *
   * @param {unknown} callable
   * @returns {string} dotted name, or "" when unknown
   */
  static callableName(callable) {
    if (typeof callable === "string") return callable;
    if (callable !== null && typeof callable === "object" && typeof callable.__class === "string") {
      return callable.__class;
    }
    return "";
  }
}

/**
 * Build a plain object from an alternating key/value sequence.
 *
 * @param {unknown[]} items
 * @returns {Record<string, unknown>}
 */
function dictOf(items) {
  const out = dictionary();
  for (let i = 0; i + 1 < items.length; i += 2) setItem(out, items[i], items[i + 1]);
  return out;
}

/**
 * Decode one Python pickle buffer.
 *
 * The result is plain data: `null`, booleans, numbers, strings, `BigInt` for
 * integers wider than 2^53, arrays for lists and tuples, and null-prototype
 * objects for dictionaries and instances. Instances also carry `__class`, the
 * dotted name of the Python class the pickle referenced.
 *
 * @param {Buffer|Uint8Array} input pickle bytes
 * @returns {unknown} the decoded root value
 * @throws {Error} on an unsupported opcode, a Python 2 construct that cannot be
 *   honoured, or a truncated stream; the message is one line and carries the
 *   byte offset
 */
export function loads(input) {
  if (!Buffer.isBuffer(input)) {
    if (input instanceof Uint8Array) {
      input = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
    } else {
      throw new Error("pickle input must be a Buffer or Uint8Array");
    }
  }
  if (input.length === 0) throw new Error("pickle input is empty");
  return new PickleReader(input).run();
}

export default loads;
