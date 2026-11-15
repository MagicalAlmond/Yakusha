/**
 * Ren'Py compiled script (`.rpyc`) reader.
 *
 * A `.rpyc` is not a pickle: it is a small container holding up to a few
 * zlib-compressed Python pickles. The interesting one is slot 1, a two-tuple of
 * `(header, statements)` where `header` carries the script format version and
 * `statements` is the pickled Ren'Py abstract syntax tree. Recovering text from
 * that tree is more reliable than parsing `.rpy`, because the tree holds the
 * strings the engine will actually display, already normalised by the lexer.
 *
 * Layout, as written by `renpy.script.Script.write_rpyc_header`:
 *
 * - 10 bytes: the ASCII header `RENPY RPC2`;
 * - then 12-byte records of little-endian uint32 `(slot, start, length)`,
 *   repeated until a record whose slot is 0;
 * - `start` and `length` are absolute file offsets of a zlib stream;
 * - older files without that header are a single zlib stream holding slot 1.
 *
 * The last 16 bytes of the file are an MD5 digest of everything before them. It
 * is not verified here: it only needs to convince the engine that its cache
 * matches the source, and a reader that rejects games over it would be useless.
 *
 * @module engines/renpy/rpyc
 */

import zlib from "node:zlib";

import { loads } from "./pickle.js";

/** ASCII marker at offset 0 of the current container format. */
const HEADER = "RENPY RPC2";

/** Length of the ASCII marker. */
const HEADER_LENGTH = HEADER.length;

/** Length of one `(slot, start, length)` record. */
const RECORD_LENGTH = 12;

/**
 * Decoded form of one AST node.
 *
 * @typedef {Record<string, unknown> & { __class?: string }} AstNode
 */

/**
 * One extracted string.
 *
 * @typedef {object} RenpyString
 * @property {string} text the text as the engine would display it, still
 *   carrying Ren'Py markup (`{i}`, `[slot]`) because translation works on the
 *   markup, not on the rendered result
 * @property {"say"|"menu"|"screen"|"string"} kind where the text came from: a
 *   `Say` node's `what`, a `Menu` caption or choice label, a visible screen
 *   label, or a translation payload
 * @property {string} file the file name passed to {@link collectStrings}
 * @property {number|null} line 1-based line number, or `null` when the node
 *   carries none
 */

/**
 * One container slot.
 *
 * @typedef {object} RpycSlot
 * @property {number} slot slot number; 1 is the script, 2 the rollback table
 * @property {number} start absolute offset of the zlib stream
 * @property {number} size compressed size in bytes
 */

/**
 * Decide whether a buffer starts with the `.rpyc` container marker.
 *
 * Legacy `.rpyc` files (Ren'Py 6 and early 7) begin immediately with a zlib
 * stream, so they do not look like this and return `false`; see
 * {@link readScript} for those.
 *
 * @param {Buffer|Uint8Array} buffer file contents
 * @returns {boolean} `true` when the modern container header is present
 */
export function isRpyc(buffer) {
  const bytes = toBuffer(buffer);
  if (bytes.length < HEADER_LENGTH) return false;
  return bytes.toString("latin1", 0, HEADER_LENGTH) === HEADER;
}

/**
 * Read the slot table of a `.rpyc` container.
 *
 * @param {Buffer|Uint8Array} buffer file contents
 * @returns {{header: string, slots: RpycSlot[], legacy: boolean}} the slot table
 *   in file order; `legacy` is `true` for the headerless single-stream format,
 *   where the only entry is slot 1
 * @throws {Error} when the slot table is truncated or a slot points outside the
 *   buffer
 */
export function readContainer(buffer) {
  const bytes = toBuffer(buffer);
  if (!isRpyc(bytes)) return readLegacyContainer(bytes);

  const slots = [];
  let offset = HEADER_LENGTH;

  for (;;) {
    if (offset + RECORD_LENGTH > bytes.length) {
      throw new Error(`rpyc slot table is truncated at byte ${offset}`);
    }

    const slot = bytes.readUInt32LE(offset);
    const start = bytes.readUInt32LE(offset + 4);
    const size = bytes.readUInt32LE(offset + 8);
    offset += RECORD_LENGTH;

    if (slot === 0) break;

    if (start + size > bytes.length) {
      throw new Error(`rpyc slot ${slot} runs past the end of the file`);
    }

    // Slots are recorded, not inflated: a corrupt rollback slot must not stop
    // the script slot from being read.
    slots.push({ slot, start, size });
  }

  if (slots.length === 0) throw new Error("rpyc file has no slots");
  return { header: HEADER, slots, legacy: false };
}

/**
 * Describe a legacy `.rpyc`, which is one zlib stream and nothing else.
 *
 * @param {Buffer} bytes file contents
 * @returns {{header: string, slots: RpycSlot[], legacy: true}} a one-entry table
 */
function readLegacyContainer(bytes) {
  // Inflating once here doubles as the validity check for the whole file, so a
  // file that is neither a container nor a zlib stream fails loudly instead of
  // being reported as an empty script.
  inflate(bytes, 0, bytes.length, true);
  return {
    header: "",
    slots: [{ slot: 1, start: 0, size: bytes.length }],
    legacy: true,
  };
}

/**
 * Decode the script payload of a `.rpyc`.
 *
 * @param {Buffer|Uint8Array} buffer file contents
 * @returns {{version: number|null, statements: AstNode[], legacy: boolean}} the
 *   script format version from the header dict (Ren'Py writes values such as
 *   `5003000` for 8.5.3), the top-level statement list, and whether the file
 *   used the headerless format
 * @throws {Error} when the container has no slot 1, or its payload is not the
 *   expected `(header, statements)` tuple
 */
export function readScript(buffer) {
  const bytes = toBuffer(buffer);
  const container = readContainer(bytes);
  const entry = container.slots.find((candidate) => candidate.slot === 1);
  if (!entry) throw new Error("rpyc file has no script slot (slot 1)");

  const payload = loads(inflate(bytes, entry.start, entry.size, container.legacy));
  if (!Array.isArray(payload) || payload.length < 2) {
    throw new Error("rpyc slot 1 does not hold a (header, statements) tuple");
  }

  const header = payload[0];
  const statements = payload[1];
  if (!Array.isArray(statements)) {
    throw new Error("rpyc slot 1 has no statement list");
  }

  const version = header !== null && typeof header === "object" ? header.version : null;
  return {
    version: typeof version === "number" ? version : null,
    statements,
    legacy: container.legacy,
  };
}

/**
 * Collect every translatable string from a `.rpyc` file.
 *
 * Walk order is depth first in source order, so the result matches reading the
 * `.rpy` from top to bottom. Occurrences are not deduplicated: the same line
 * of dialogue said twice is two units, because a caller that writes
 * translations back needs both positions.
 *
 * Recognised nodes:
 *
 * - `renpy.ast.Say` and its subclass `renpy.ast.TranslateSay`: `what`;
 * - `renpy.ast.Menu`: the caption (when `has_caption`) and every choice
 *   label, which are the first element of each `items` entry;
 * - `renpy.ast.TranslateString`: `old` is the source string and `new` the
 *   translation, both emitted as `kind: "string"`.
 *
 * Everything else is skipped; `who` is a character expression rather than
 * display text, so speaker names are not collected.
 *
 * @param {Buffer|Uint8Array} buffer file contents
 * @param {string} [file] path recorded on every unit; callers pass the `.rpy`
 *   path relative to the game root, exactly as written into the file
 * @returns {{version: number|null, strings: RenpyString[], nodeCount: number,
 *   sayCount: number, menuCount: number, screenCount: number}} collected units
 *   and counters; `nodeCount` is the number of AST objects visited
 * @throws {Error} when the file cannot be decoded at all
 */
export function collectStrings(buffer, file = "") {
  const script = readScript(buffer);
  const strings = [];
  const state = { file, strings, nodeCount: 0, sayCount: 0, menuCount: 0, screenCount: 0 };
  walkStatements(script.statements, state, new Set());
  return {
    version: script.version,
    strings,
    nodeCount: state.nodeCount,
    sayCount: state.sayCount,
    menuCount: state.menuCount,
    screenCount: state.screenCount,
  };
}

/**
 * Walk a statement list.
 *
 * `seen` guards against the reference cycles the pickled tree really contains:
 * `Menu.statement_start` points back at an earlier node, and translated blocks
 * are cross-linked, so a naive walk never terminates.
 *
 * @param {unknown} statements candidate statement list
 * @param {object} state collector state
 * @param {Set<object>} seen objects already visited
 * @returns {void}
 */
function walkStatements(statements, state, seen) {
  if (!Array.isArray(statements)) return;
  for (const node of statements) walkNode(node, state, seen);
}

/**
 * Walk one AST node and everything reachable through it.
 *
 * @param {unknown} node candidate node
 * @param {object} state collector state
 * @param {Set<object>} seen objects already visited
 * @returns {void}
 */
function walkNode(node, state, seen) {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walkNode(child, state, seen);
    return;
  }
  if (seen.has(node)) return;
  seen.add(node);
  state.nodeCount += 1;

  const className = node.__class;
  if (typeof className === "string") {
    if (isSay(className)) {
      addUnit(state, node.what, "say", node);
      state.sayCount += 1;
    } else if (className === "renpy.ast.Menu") {
      // The strings themselves are emitted by the generic descent below, so a
      // menu is only counted here.
      state.menuCount += 1;
    } else if (className === "renpy.ast.Screen") {
      // The screen itself is walked through its `screen` field; this count only
      // tells a caller that a compiled UI was actually present.
      state.screenCount += 1;
    } else if (className === "renpy.sl2.slast.SLDisplayable") {
      collectScreenDisplayable(node, state);
    } else if (className === "renpy.ast.TranslateString") {
      addUnit(state, node.old, "string", node);
      addUnit(state, node.new, "string", node);
    }
    // `renpy.ast.Translate` and `TranslateBlock` need no case of their own:
    // their payload is `block`, which the generic descent below already walks.
    // Their `identifier` is an internal label name, not display text.
  }

  // Generic descent. Only the structural fields the AST actually nests are
  // followed, so a stray object reference elsewhere cannot drag the walk into
  // unrelated parts of the pickle.
  walkStatements(node.block, state, seen);
  collectMenu(node, state);
  if (node.items !== undefined) walkNode(node.items, state, seen);
  walkStatements(node.after, state, seen);
  // Compiled screens hang off the Screen node's `screen` field; their layout
  // tree uses `children` (SLScreen / SLBlock / SLDisplayable), while
  // conditionals use `entries`. `node` is kept for AST nodes that carry their
  // body there instead of in `block`.
  if (node.node !== undefined) walkNode(node.node, state, seen);
  if (node.screen !== undefined) walkNode(node.screen, state, seen);
  if (node.children !== undefined) walkNode(node.children, state, seen);
  if (node.entries !== undefined) walkNode(node.entries, state, seen);
}

/**
 * Whether a class name is a dialogue statement.
 *
 * @param {string} className dotted class name from the pickle
 * @returns {boolean} `true` for `Say` and its `TranslateSay` subclass
 */
function isSay(className) {
  return className === "renpy.ast.Say" || className === "renpy.ast.TranslateSay";
}

/**
 * Emit the caption and choice labels of a menu node.
 *
 * Menu items are `(label, condition, block)` tuples. The label is the string the
 * player sees; the condition is Python source and is skipped.
 *
 * @param {object} node candidate node
 * @param {object} state collector state
 * @returns {void}
 */
function collectMenu(node, state) {
  if (!Array.isArray(node.items)) return;
  for (const item of node.items) {
    if (!Array.isArray(item) || item.length === 0) continue;
    addUnit(state, item[0], "menu", node);
  }
}

/**
 * Displayable names whose first positional argument is visible label text.
 *
 * button and imagebutton are deliberately absent: their visible text is a
 * child text displayable, which the generic descent reaches on its own.
 */
const SCREEN_TEXT_DISPLAYABLES = new Set(["text", "textbutton", "label"]);

/**
 * Emit the label of one screen displayable.
 *
 * Only a complete string literal, optionally wrapped in _() or __(), is
 * accepted. A variable, a concatenation, a conditional expression or a format
 * call is Python source, not display text, and guessing at it would put the
 * wrong key into the dictionary.
 *
 * @param {object} node SLDisplayable node
 * @param {object} state collector state
 * @returns {void}
 */
function collectScreenDisplayable(node, state) {
  const positional = Array.isArray(node.positional) ? node.positional : [];
  const expression = positional[0];
  // A plugin's own displayable has no known argument shape, but an explicit
  // _("...") marker is the game author telling Ren'Py the string is
  // translatable, so that is safe to collect whatever the displayable is.
  const text = SCREEN_TEXT_DISPLAYABLES.has(node.name)
    ? screenLiteral(expression)
    : screenMarkedLiteral(expression);
  if (text === null || text.length === 0) return;
  if (!hasVisibleText(text)) return;
  const line =
    expression !== null && typeof expression === "object" && typeof expression.linenumber === "number"
      ? expression.linenumber
      : node.linenumber;
  addUnitAt(state, text, "screen", line);
}

/**
 * Whether a screen literal still contains text after markup and slots are removed.
 *
 * A value such as "[message!tq]" or a lone "▸" is a placeholder or a glyph, not
 * a translatable label. Adding it to the dictionary would either do nothing or
 * put a translated prefix in front of a value the engine fills in at runtime.
 *
 * @param {string} text decoded screen text
 * @returns {boolean} true when at least one letter or digit remains
 */
function hasVisibleText(text) {
  const stripped = text.replace(/\{[^{}]*\}/g, "").replace(/\[[^\]]*\]/g, "");
  return /[\p{L}\p{N}]/u.test(stripped);
}
/**
 * Turn one positional screen argument into display text.
 *
 * @param {unknown} value a PyExpr or a plain string
 * @returns {string|null} decoded text, or null when this is not a literal
 */
function screenLiteral(value) {
  if (typeof value === "string") return screenExpression(value);
  if (value === null || typeof value !== "object") return null;
  if (value.__class !== "renpy.ast.PyExpr") return null;
  if (typeof value.value !== "string") return null;
  return screenExpression(value.value);
}

/**
 * Turn one positional argument into display text only when it is _() marked.
 *
 * @param {unknown} value a PyExpr or a plain string
 * @returns {string|null} decoded text, or null when there is no marker
 */
function screenMarkedLiteral(value) {
  let source = null;
  if (typeof value === "string") source = value;
  else if (value !== null && typeof value === "object" && value.__class === "renpy.ast.PyExpr"
    && typeof value.value === "string") source = value.value;
  if (source === null || !/^_\s*\(/.test(source.trim())) return null;
  return screenLiteral(value);
}

/**
 * Unwrap the _() translation marker, then require one Python string literal.
 *
 * @param {string} source Python expression source
 * @returns {string|null} decoded text, or null when the expression is not one literal
 */
function screenExpression(source) {
  let text = source.trim();
  const wrapped = /^(?:_|__)\s*\(([\s\S]*)\)$/.exec(text);
  if (wrapped !== null) text = wrapped[1].trim();
  return screenStringLiteral(text);
}

/**
 * Decode one quoted Python string literal, rejecting every other expression.
 *
 * @param {string} text candidate source
 * @returns {string|null} decoded text, or null when the candidate is not one literal
 */
function screenStringLiteral(text) {
  const match = /^[uU]?("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')$/s.exec(text);
  if (match === null) return null;
  return decodeScreenEscapes(match[1].slice(1, -1));
}

/**
 * Decode the escape sequences Python allows in a one-line string literal.
 *
 * Unknown escapes return null instead of being copied through: a dictionary key
 * must be the text the engine displays, not an approximation of its source.
 *
 * @param {string} raw body between the quotes
 * @returns {string|null} decoded text, or null on an unsupported escape
 */
function decodeScreenEscapes(raw) {
  let out = "";
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    i += 1;
    if (i >= raw.length) return null;
    const escape = raw[i];
    if (escape === "\\" || escape === "\"" || escape === "'") {
      out += escape;
    } else if (escape === "n") {
      out += "\n";
    } else if (escape === "r") {
      out += "\r";
    } else if (escape === "t") {
      out += "\t";
    } else if (escape === "a") {
      out += "\u0007";
    } else if (escape === "b") {
      out += "\b";
    } else if (escape === "f") {
      out += "\f";
    } else if (escape === "v") {
      out += "\u000b";
    } else if (escape === "\n") {
      // A backslash at the end of a line joins the next line.
    } else if (escape === "x" || escape === "u" || escape === "U") {
      const length = escape === "x" ? 2 : escape === "u" ? 4 : 8;
      const hex = raw.slice(i + 1, i + 1 + length);
      const pattern = new RegExp("^[0-9A-Fa-f]{" + length + "}$");
      if (!pattern.test(hex)) return null;
      const code = Number.parseInt(hex, 16);
      if (escape === "U" && (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff))) return null;
      out += String.fromCodePoint(code);
      i += length;
    } else {
      return null;
    }
  }
  return out;
}

/**
 * Append one unit at an explicit line number.
 *
 * @param {object} state collector state
 * @param {string} text display text
 * @param {"say"|"menu"|"screen"|"string"} kind source kind
 * @param {unknown} line line number or anything else
 * @returns {void}
 */
function addUnitAt(state, text, kind, line) {
  if (typeof text !== "string" || text.length === 0) return;
  state.strings.push({
    text,
    kind,
    file: state.file,
    line: typeof line === "number" ? line : null,
  });
}

/**
 * Append one unit when a value is actually a string.
 *
 * @param {object} state collector state
 * @param {unknown} text candidate text
 * @param {"say"|"menu"|"string"} kind source kind
 * @param {object} node node the text belongs to
 * @returns {void}
 */
function addUnit(state, text, kind, node) {
  if (typeof text !== "string" || text.length === 0) return;
  const line = node.linenumber;
  state.strings.push({
    text,
    kind,
    file: state.file,
    line: typeof line === "number" ? line : null,
  });
}

/**
 * Inflate one slot payload.
 *
 * @param {Buffer} bytes file contents
 * @param {number} start absolute offset of the zlib stream
 * @param {number} size compressed length
 * @param {boolean} [raw] inflate without a zlib header, for legacy files
 * @returns {Buffer} decompressed bytes
 */
function inflate(bytes, start, size, raw = false) {
  const slice = bytes.subarray(start, start + size);
  try {
    return toBuffer(zlib.inflateSync(slice));
  } catch (cause) {
    if (raw) throw new Error("rpyc payload is not a zlib stream", { cause });
    throw new Error(`rpyc slot at byte ${start} is not a zlib stream`, { cause });
  }
}

/**
 * Normalise file contents to a `Buffer`.
 *
 * @param {Buffer|Uint8Array} input file contents
 * @returns {Buffer} the same bytes as a `Buffer`
 * @throws {Error} when the input is neither
 */
function toBuffer(input) {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) {
    return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  }
  throw new Error("rpyc input must be a Buffer or Uint8Array");
}

export default { isRpyc, readContainer, readScript, collectStrings };
