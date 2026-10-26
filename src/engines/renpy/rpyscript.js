/**
 * Extraction of translatable strings from Ren'Py plaintext scripts (.rpy).
 *
 * Ren'Py keys its translation dictionary on the runtime value of a string, not
 * on the spelling used in the file, so this module re-implements the part of
 * the Ren'Py lexer that decides what a quoted literal evaluates to:
 *
 * - `"[name]"` keeps its interpolation and `"{b}"` keeps its text tag, because the
 *   doubled forms the lexer produces only undo them at render time.
 * - `"\n"` is a newline, `"\""` a double quote, `"\\"` a backslash, `"\ "` a
 *   single space, `"\u3042"` the character U+3042 and `"\q"` just `q`.
 * - `"\["`, `"\{"` and `"\%"` become `"[["`, `"{{"` and `"%%"`, the doubled
 *   forms Ren'Py displays as the plain character.
 * - Runs of spaces and newlines inside one literal collapse to a single space.
 *   Tabs are left alone; Ren'Py rejects tab characters in scripts anyway.
 *
 * Triple quoted strings follow monologue mode: the block is split at blank
 * lines and every paragraph becomes its own string.
 *
 * Kinds reported for a string:
 *
 * - `say`: dialogue, either bare (`"Narration."`) or with a speaker
 *   (`e "Line"`, `extend "Line"`), including say attributes and trailing
 *   `with` / `nointeract` / `id` clauses.
 * - `menu`: the caption and the choice labels of a menu block.
 * - `string`: a literal wrapped in the `_()` translation marker, anywhere.
 * - `screen`: the first literal of a screen language `text`, `textbutton`,
 *   `label`, `tooltip` or `notify` statement.
 *
 * Skipped on purpose: comments, strings in Python code (blocks, `$` lines) and on
 * `define` / `default` right hand sides unless they use `_()`, `old` / `new`
 * statements, whole `translate` blocks, which hold translations rather than
 * sources, image, music and font paths, style property values and ATL bodies.
 *
 * The extractor never throws on malformed input: an unterminated literal is
 * counted in undecodable and dropped. Constructs the extractor does not target,
 * such as a `_()` call whose argument is an expression, are skipped silently.
 *
 * @module engines/renpy/rpyscript
 */

/** Quote characters that can open a Ren'Py string literal. */
const QUOTES = new Set(['"', "'", "`"]);

/** One letter prefixes Ren'Py accepts in front of a literal, e.g. `r"..."`. */
const STRING_PREFIXES = new Set(["r", "R", "u", "U", "f", "F", "b", "B"]);

/** Ren'Py word characters, copied from the word_regexp in renpy/lexer.py. */
const WORD_START = /[A-Za-z_\u00a0-\ufffd]/;
const WORD_PART = /[0-9A-Za-z_\u00a0-\ufffd]/;

/** The two character operators worth keeping in one token. */
const TWO_CHAR_OPERATORS = new Set([
  "->", "**", "//", "==", "!=", "<=", ">=", "+=", "-=", "*=", "/=", "%=",
]);

/**
 * Statement keywords. A logical line that starts with one of these is never a
 * say statement, so no dialogue literal is expected on it. A name that is not
 * listed here is treated as a speaker expression.
 */
const STATEMENT_KEYWORDS = new Set([
  "animation", "at", "block", "call", "camera", "contains", "default", "define",
  "early", "elif", "else", "for", "function", "hide", "if", "image", "init",
  "jump", "label", "late", "layeredimage", "menu", "new", "nvl", "old",
  "parallel", "pass", "pause", "play", "python", "queue", "repeat", "return",
  "rpy", "scene", "screen", "show", "stop", "style", "testcase", "transform",
  "translate", "until", "voice", "while", "window", "with",
]);

/**
 * Block bodies that are not Ren'Py statement language: Python, ATL, style
 * properties or layered image declarations. Statement rules are not applied
 * inside them, but `_()` markers still are.
 */
const OPAQUE_BLOCK_KEYWORDS = new Set([
  "camera", "image", "layeredimage", "python", "scene", "show", "style",
  "testcase", "transform",
]);

/** Screen language statements whose first argument is player visible text. */
const SCREEN_LITERAL_KEYWORDS = new Set([
  "label", "notify", "text", "textbutton", "tooltip",
]);

/**
 * @typedef {object} ScriptString
 * @property {string} text the runtime value, ready to be used as a dictionary
 *   key
 * @property {"say"|"menu"|"string"|"screen"} kind where the literal came from
 * @property {string} file the caller supplied relative path, verbatim
 * @property {number} line 1 based line of the opening quote
 */

/**
 * @typedef {object} ScanState
 * @property {string} text normalised source, LF line endings, no BOM
 * @property {number} index offset of the next character to read
 * @property {number} line 1 based line of that character
 */

/**
 * A significant token of one logical line.
 *
 * @typedef {object} Token
 * @property {"name"|"number"|"string"|"op"} type
 * @property {string} text source spelling, or the raw value for a string
 * @property {number} line 1 based line the token starts on
 * @property {number} start offset of the first character
 * @property {number} end offset just past the last character
 * @property {number} depth parenthesis depth before the token
 * @property {string} [quote] delimiter of a string token
 * @property {boolean} [triple] true for a triple quoted string token
 * @property {boolean} [raw] true when the literal carries an r prefix
 * @property {boolean} [unterminated] true when the closing quote is missing
 */

/**
 * Collect the translatable strings of one Ren'Py plaintext script.
 *
 * @param {string|Buffer} source file contents, LF or CRLF, optional UTF-8 BOM
 * @param {string} file caller supplied relative path such as "game/script.rpy",
 *   copied verbatim into every unit
 * @returns {{ strings: ScriptString[], undecodable: number }} every occurrence
 *   in source order, never de-duplicated, plus the number of unterminated
 *   string literals that were skipped
 */
export function collectScriptStrings(source, file) {
  const path = typeof file === "string" ? file : "";
  const scan = scanLogicalLines(normalizeSource(source));
  /** @type {{ file: string, strings: ScriptString[], undecodable: number, stack: Array<{ indent: number, kind: string }> }} */
  const context = { file: path, strings: [], undecodable: scan.undecodable, stack: [] };

  for (const line of scan.lines) extractLine(context, line);

  return { strings: context.strings, undecodable: context.undecodable };
}

/**
 * Drop a UTF-8 BOM and turn CRLF or lone CR line endings into LF.
 *
 * @param {string|Buffer} source
 * @returns {string}
 */
function normalizeSource(source) {
  const text = typeof source === "string" ? source : source == null ? "" : String(source);
  return text.replace(/^\ufeff/, "").replace(/\r\n?/g, "\n");
}

/**
 * Split a script into logical lines and tokenize each of them.
 *
 * This mirrors list_logical_lines from renpy/lexer.py: a logical line ends at a
 * newline that is not inside a string, not inside parentheses and not escaped
 * by a trailing backslash. Blank lines and comment only lines produce no line
 * at all.
 *
 * @param {string} text
 * @returns {{ lines: Array<{ number: number, indent: number, tokens: Token[] }>, undecodable: number }}
 */
function scanLogicalLines(text) {
  const lines = [];
  const /** @type {ScanState} */ state = { text, index: 0, line: 1 };
  const size = text.length;
  let unterminated = 0;
  /** @type {{ number: number, indent: number, tokens: Token[] }|null} */
  let current = null;
  let depth = 0;

  while (state.index < size) {
    if (current === null) {
      const head = readLineHead(state);
      if (!head) break;
      current = { number: state.line, indent: head.indent, tokens: [] };
      depth = 0;
      continue;
    }

    const char = text[state.index];

    if (char === "\n") {
      if (depth > 0) {
        state.index += 1;
        state.line += 1;
        continue;
      }
      if (current.tokens.length > 0) lines.push(current);
      current = null;
      state.index += 1;
      state.line += 1;
      continue;
    }

    if (char === "\\" && text[state.index + 1] === "\n") {
      state.index += 2;
      state.line += 1;
      continue;
    }

    if (char === "#") {
      const end = text.indexOf("\n", state.index);
      state.index = end < 0 ? size : end;
      continue;
    }

    if (char === " " || char === "\t") {
      state.index += 1;
      continue;
    }

    const start = state.index;
    const line = state.line;

    if (QUOTES.has(char)) {
      const token = readStringToken(state, "");
      if (token.unterminated) unterminated += 1;
      token.depth = depth;
      current.tokens.push(token);
      continue;
    }

    if (WORD_START.test(char)) {
      let end = start + 1;
      while (end < size && WORD_PART.test(text[end])) end += 1;
      const word = text.slice(start, end);
      state.index = end;
      if (word.length === 1 && STRING_PREFIXES.has(word) && QUOTES.has(text[end])) {
        const token = readStringToken(state, word);
        if (token.unterminated) unterminated += 1;
        token.depth = depth;
        current.tokens.push(token);
        continue;
      }
      current.tokens.push({ type: "name", text: word, line, start, end, depth });
      continue;
    }

    if (char >= "0" && char <= "9") {
      let end = start;
      while (end < size && text[end] >= "0" && text[end] <= "9") end += 1;
      state.index = end;
      current.tokens.push({ type: "number", text: text.slice(start, end), line, start, end, depth });
      continue;
    }

    const pair = text.slice(start, start + 2);
    const width = TWO_CHAR_OPERATORS.has(pair) ? 2 : 1;
    const operator = text.slice(start, start + width);
    state.index = start + width;
    if (operator === "(" || operator === "[" || operator === "{") depth += 1;
    if ((operator === ")" || operator === "]" || operator === "}") && depth > 0) depth -= 1;
    current.tokens.push({ type: "op", text: operator, line, start, end: state.index, depth });
  }

  if (current !== null && current.tokens.length > 0) lines.push(current);

  return { lines, undecodable: unterminated };
}

/**
 * Advance to the first character of the next code line.
 *
 * Blank lines, whitespace only lines and comment only lines are stepped over
 * the same way renpy/lexer.py ignores them, so they never open or close a
 * block.
 *
 * @param {ScanState} state
 * @returns {{ indent: number }|null} null at end of input
 */
function readLineHead(state) {
  const text = state.text;
  const size = text.length;

  while (state.index < size) {
    let index = state.index;
    let indent = 0;
    while (index < size && text[index] === " ") {
      index += 1;
      indent += 1;
    }

    if (index >= size) {
      state.index = size;
      return null;
    }

    if (text[index] === "\n") {
      state.index = index + 1;
      state.line += 1;
      continue;
    }

    if (text[index] === "#") {
      const end = text.indexOf("\n", index);
      if (end < 0) {
        state.index = size;
        return null;
      }
      state.index = end + 1;
      state.line += 1;
      continue;
    }

    state.index = index;
    return { indent };
  }

  return null;
}

/**
 * Read one string literal, single or triple quoted.
 *
 * The scanner stops just past the closing delimiter. Newlines inside the
 * literal still advance the line counter, which is what lets a multi paragraph
 * monologue report the line each paragraph starts on.
 *
 * @param {ScanState} state positioned on the opening quote
 * @param {string} prefix the one letter prefix already consumed, if any
 * @returns {Token}
 */
function readStringToken(state, prefix) {
  const text = state.text;
  const size = text.length;
  const start = state.index;
  const line = state.line;
  const quote = text[start];
  const raw = prefix === "r" || prefix === "R";
  let index = start;
  let triple = false;

  if (text[index + 1] === quote) {
    if (text[index + 2] === quote) {
      triple = true;
      index += 3;
    } else {
      state.index = index + 2;
      return makeStringToken(["", line], { start, quote, triple: false, raw, line });
    }
  } else {
    index += 1;
  }

  const contentStart = index;

  while (index < size) {
    const char = text[index];
    if (char === "\\") {
      if (text[index + 1] === "\n") state.line += 1;
      index += 2;
      continue;
    }
    if (char === "\n") {
      state.line += 1;
      index += 1;
      continue;
    }
    if (triple) {
      if (char === quote && text[index + 1] === quote && text[index + 2] === quote) {
        const value = text.slice(contentStart, index);
        state.index = index + 3;
        return makeStringToken([value, line], { start, quote, triple: true, raw, line });
      }
      index += 1;
      continue;
    }
    if (char === quote) {
      const value = text.slice(contentStart, index);
      state.index = index + 1;
      return makeStringToken([value, line], { start, quote, triple: false, raw, line });
    }
    index += 1;
  }

  state.index = size;
  const value = text.slice(contentStart, size);
  return makeStringToken([value, line], { start, quote, triple, raw, line, unterminated: true });
}

/**
 * @param {[string, number]} body raw content and its starting line
 * @param {{ start: number, quote: string, triple: boolean, raw: boolean, line: number, unterminated?: boolean }} shape
 * @returns {Token}
 */
function makeStringToken([value, line], shape) {
  const token = {
    type: "string",
    text: value,
    line,
    start: shape.start,
    end: shape.start + value.length,
    depth: 0,
    quote: shape.quote,
    triple: shape.triple,
    raw: shape.raw,
  };
  if (shape.unterminated) token.unterminated = true;
  return token;
}

/**
 * Apply the statement rules to one logical line and remember its block.
 *
 * @param {{ file: string, strings: ScriptString[], undecodable: number }} context
 * @param {{ number: number, indent: number, tokens: Token[] }} line
 */
function extractLine(context, line) {
  const stack = context.stack;
  const tokens = line.tokens;

  while (stack.length > 0 && stack[stack.length - 1].indent >= line.indent) stack.pop();

  const inTranslate = stack.some((entry) => entry.kind === "translate");
  if (!inTranslate) collectMarkers(context, tokens);

  const inScreen = stack.some((entry) => entry.kind === "screen");
  const inOpaque = stack.some((entry) => entry.kind === "opaque");
  const inMenu = stack.length > 0 && stack[stack.length - 1].kind === "menu";

  if (!inTranslate && !inOpaque) extractStatement(context, tokens, inScreen, inMenu);

  if (opensBlock(tokens)) stack.push({ indent: line.indent, kind: blockKind(tokens) });
}

/**
 * Pick the one rule that matches a statement line.
 *
 * @param {{ file: string, strings: ScriptString[], undecodable: number }} context
 * @param {Token[]} tokens
 * @param {boolean} inScreen
 * @param {boolean} inMenu
 */
function extractStatement(context, tokens, inScreen, inMenu) {
  const first = tokens[0];

  if (inScreen) {
    collectScreenLiteral(context, tokens);
    return;
  }

  if (first.type === "string" && first.depth === 0) {
    // `"Lucy" "Better watch out."` is one say statement whose character is
    // given as a literal: the first string is the speaker's name, the second is
    // the dialogue the player reads. Only the dialogue is translatable, which
    // is also what the compiled form records, so both source forms agree.
    pushUnits(context, spokenString(tokens) || first, inMenu ? "menu" : "say");
    return;
  }

  if (first.type !== "name" || STATEMENT_KEYWORDS.has(first.text)) return;
  const what = sayString(tokens);
  if (what) pushUnits(context, what, "say");
}

/**
 * The dialogue literal of a say statement whose character is a literal.
 *
 * @param {Token[]} tokens
 * @returns {Token|null} the second literal on the line, when there is one
 */
function spokenString(tokens) {
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type === "string") return token.depth === 0 ? token : null;
  }
  return null;
}

/**
 * Collect the literal of a screen language text statement.
 *
 * Only the statement names in SCREEN_LITERAL_KEYWORDS are considered, so
 * screen properties and image paths stay out of the dictionary.
 *
 * @param {{ file: string, strings: ScriptString[], undecodable: number }} context
 * @param {Token[]} tokens
 */
function collectScreenLiteral(context, tokens) {
  const first = tokens[0];
  if (first.type !== "name" || !SCREEN_LITERAL_KEYWORDS.has(first.text)) return;

  const argument = tokens[1];
  if (!argument || argument.type !== "string" || argument.depth !== 0) return;

  pushUnits(context, argument, "screen");
}

/**
 * Find the dialogue literal of a say statement.
 *
 * The tokens before the literal must spell a speaker expression: a name,
 * possibly with say attributes or temporary @attributes. Anything else, such as
 * an assignment or a python call, makes the line something the extractor does
 * not handle.
 *
 * @param {Token[]} tokens tokens of a logical line whose first token is a name
 * @returns {Token|null}
 */
function sayString(tokens) {
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type === "string") return token.depth === 0 ? token : null;
    if (token.type === "name") continue;
    if (token.type === "op" && (token.text === "." || token.text === "-" || token.text === "@")) continue;
    return null;
  }
  return null;
}

/**
 * Collect every `_("literal")` marker on a line.
 *
 * Both the translatable marker (_) and a plain literal are required, so the
 * explicit non translatable marker (__) and calls built from expressions are
 * left alone.
 *
 * @param {{ file: string, strings: ScriptString[], undecodable: number }} context
 * @param {Token[]} tokens
 */
function collectMarkers(context, tokens) {
  for (let index = 0; index + 3 < tokens.length; index += 1) {
    const name = tokens[index];
    if (name.type !== "name" || name.text !== "_") continue;
    const open = tokens[index + 1];
    if (open.type !== "op" || open.text !== "(") continue;
    const argument = tokens[index + 2];
    if (argument.type !== "string") continue;
    const close = tokens[index + 3];
    if (close.type !== "op" || close.text !== ")") continue;
    pushUnits(context, argument, "string");
    index += 3;
  }
}

/**
 * Decode one literal and append every resulting runtime string.
 *
 * @param {{ file: string, strings: ScriptString[], undecodable: number }} context
 * @param {Token} token
 * @param {"say"|"menu"|"string"|"screen"} kind
 */
function pushUnits(context, token, kind) {
  if (token.unterminated) return;
  for (const part of decodeToken(token)) {
    if (part.text.length === 0) continue;
    context.strings.push({ text: part.text, kind, file: context.file, line: part.line });
  }
}

/**
 * Turn a string token into the string or strings Ren'Py would hold at runtime.
 *
 * @param {Token} token
 * @returns {Array<{ text: string, line: number }>}
 */
function decodeToken(token) {
  if (token.raw) return [{ text: token.text, line: token.line }];
  if (token.triple) return decodeTripleLiteral(token.text, token.line);
  return [{ text: decodeSingleLiteral(token.text), line: token.line }];
}

/**
 * Decode a one line literal the way Lexer.string does.
 *
 * @param {string} raw content between the delimiters
 * @returns {string}
 */
function decodeSingleLiteral(raw) {
  return decodeEscapes(raw.replace(/[ \n]+/g, " "));
}

/**
 * Decode a triple quoted literal the way Lexer.triple_string does, one paragraph
 * per blank line separated block.
 *
 * @param {string} raw content between the delimiters
 * @param {number} firstLine line the opening delimiter sits on
 * @returns {Array<{ text: string, line: number }>}
 */
function decodeTripleLiteral(raw, firstLine) {
  const separator = /\n[ \t]*\n/g;
  const decoded = [];
  let start = 0;
  let match = separator.exec(raw);

  for (;;) {
    const part = raw.slice(start, match === null ? raw.length : match.index);
    const trimmed = part.trim();
    if (trimmed.length > 0) {
      const leading = part.length - part.trimStart().length;
      decoded.push({
        text: decodeEscapes(trimmed.replace(/[ \n]+/g, " ")),
        line: firstLine + countNewlines(raw, start + leading),
      });
    }
    if (match === null) break;
    start = separator.lastIndex;
    match = separator.exec(raw);
  }

  return decoded;
}

/**
 * Count the newlines in a prefix of a string.
 *
 * @param {string} text
 * @param {number} end exclusive end offset
 * @returns {number}
 */
function countNewlines(text, end) {
  let count = 0;
  for (let index = 0; index < end && index < text.length; index += 1) {
    if (text[index] === "\n") count += 1;
  }
  return count;
}

/**
 * Apply the escape rules of Lexer.string: a backslash and the next character
 * collapse to the character, with special cases for the few that would
 * otherwise be read as markup.
 *
 * @param {string} text literal content, already whitespace collapsed
 * @returns {string}
 */
function decodeEscapes(text) {
  return text.replace(/\\(u([0-9a-fA-F]{1,4})|[\s\S])/g, (match, escaped, hex) => {
    if (escaped === "{") return "{{";
    if (escaped === "[") return "[[";
    if (escaped === "%") return "%%";
    if (escaped === "n") return "\n";
    if (hex) return String.fromCharCode(parseInt(hex, 16));
    return escaped;
  });
}

/**
 * Decide whether a logical line opens an indented block.
 *
 * @param {Token[]} tokens
 * @returns {boolean}
 */
function opensBlock(tokens) {
  const last = tokens[tokens.length - 1];
  return last.type === "op" && last.text === ":" && last.depth === 0;
}

/**
 * Classify the body of a block that just opened.
 *
 * @param {Token[]} tokens
 * @returns {"block"|"menu"|"screen"|"translate"|"opaque"}
 */
function blockKind(tokens) {
  const first = tokens[0];
  if (first.type !== "name") return "block";
  if (first.text === "menu") return "menu";
  if (first.text === "screen") return "screen";
  if (first.text === "translate") return "translate";
  if (first.text === "init") {
    const hasPython = tokens.some((token) => token.type === "name" && token.text === "python");
    return hasPython ? "opaque" : "block";
  }
  if (OPAQUE_BLOCK_KEYWORDS.has(first.text)) return "opaque";
  return "block";
}
