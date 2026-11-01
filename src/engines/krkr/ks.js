/**
 * KAG scenario (.ks) text extraction.
 *
 * A .ks file is line-oriented: comment lines start with `;`, labels with `*`,
 * and everything else is either a tag line (leading `[` or the `@` one-line
 * form) or a text line with optional inline tags. The extractor keeps plain
 * text lines (tags stripped), tracks the most recent `[name_set name='...']`
 * speaker, records line numbers, and skips the TJS code between `[iscript]`
 * and `[endscript]` - code lines are executed by the engine, never shown as
 * dialogue.
 *
 * @module engines/krkr/ks
 */

/**
 * Decode .ks bytes: honor a UTF-16 BOM, then try UTF-8 strict, then fall
 * back to Shift_JIS. Encoding sniffing stays here so callers share one rule.
 * @param {Buffer} buffer raw file bytes
 * @returns {{ text: string, encoding: "utf-8" | "utf-16le" | "utf-16be" | "shift_jis", undecodable: boolean, error?: string }}
 */
export function decodeKs(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return { text: new TextDecoder("utf-16le").decode(buffer.subarray(2)), encoding: "utf-16le", undecodable: false };
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return { text: new TextDecoder("utf-16be").decode(buffer.subarray(2)), encoding: "utf-16be", undecodable: false };
  }
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(buffer), encoding: "utf-8", undecodable: false };
  } catch {
    // TextDecoder("shift_jis") never fails on input: unmappable bytes become
    // U+FFFD replacement characters, which is how we report corruption.
    const text = new TextDecoder("shift_jis").decode(buffer);
    const replacement = (text.match(/\uFFFD/g) || []).length;
    if (replacement > 0) {
      return {
        text,
        encoding: "shift_jis",
        undecodable: true,
        error: replacement + " undecodable byte" + (replacement === 1 ? "" : "s") + " under Shift_JIS"
      };
    }
    return { text, encoding: "shift_jis", undecodable: false };
  }
}
/**
 * Sort one raw KAG line into its kind.
 *
 * The kind decides whether the line can hold strings: only "text" lines are
 * collected, so the boundaries matter. A semicolon starts a comment only at
 * the start of the line - inside a line it is an ordinary character - and an
 * unclosed bracket stays text. The `@` prefix is the one-line spelling of a
 * tag, so `@wait ...` is a tag line just like `[wait ...]`.
 *
 * @param {string} rawLine the line as read
 * @returns {"blank"|"comment"|"label"|"tags"|"text"}
 */
export function classifyLine(rawLine) {
  const line = rawLine.trim();
  if (line === "") return "blank";
  if (line.startsWith(";")) return "comment";
  if (line.startsWith("*")) return "label";
  const first = line[0];
  if (first === "[" || first === "@") return "tags";
  return "text";
}

/**
 * Strip KAG inline tags from a text line: `[r]` becomes a space marker that
 * the caller re-derives, `[name_set ...]`-style tags vanish. Returns the
 * remaining literal text with tags removed.
 * @param {string} line text line with inline tags
 * @returns {{ text: string, tags: string[] }} visible text and tag names in order
 */
export function stripInlineTags(line) {
  const tags = [];
  let text = "";
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === "[") {
      const end = line.indexOf("]", i + 1);
      if (end === -1) {
        // Unterminated bracket: treat the rest as literal text.
        text += line.slice(i);
        break;
      }
      const body = line.slice(i + 1, end);
      const name = body.split(/[\s=]/, 1)[0].trim();
      if (name) tags.push(name);
      i = end + 1;
      continue;
    }
    text += ch;
    i += 1;
  }
  return { text, tags };
}
/**
 * Read a `[name_set name='...']` or `@name_set name='...'` (double or
 * single quotes) speaker value from the bare tag body.
 * @param {string} tagBody content between the brackets, without the leading
 *   bracket or `@` and without the trailing bracket
 * @returns {string | null}
 */
function nameSetValue(tagBody) {
  const match = tagBody.match(/^\s*name_set\b/i) ? tagBody : null;
  if (!match) return null;
  const value = tagBody.match(/\bname\s*=\s*(?:"([^"]*)"|'([^']*)')/);
  if (!value) return null;
  return value[1] !== undefined ? value[1] : value[2];
}

/**
 * Read the first tag name from a tag line, case-insensitively.
 *
 * `[iscript]`, `[endscript]` and their `@iscript` / `@endscript` one-line
 * spellings all reduce to the bare name so the block tracking in
 * collectKsStrings can compare them.
 *
 * @param {string} rawLine the line as read
 * @returns {string} the tag name in lower case, or "" when there is none
 */
function tagName(rawLine) {
  const body = rawLine.trim().replace(/^\[/, "").replace(/^@/, "");
  const match = body.match(/^[A-Za-z_][A-Za-z0-9_]*/);
  return match ? match[0].toLowerCase() : "";
}

/**
 * Collect translatable strings from one decoded .ks source.
 *
 * A collected unit is one text line with inline tags stripped. Line numbers
 * are 1-based and refer to the decoded text (one line per `\n`). The TJS
 * code between `[iscript]` and `[endscript]` (either bracket or `@`
 * spelling) is skipped: those lines run as code and never render as
 * dialogue, so collecting them would only put comments and statements into
 * the dictionary. The speaker keeps its value across a script block.
 *
 * @param {string} source decoded file text
 * @param {string} file relative path for messages (unused in units, kept for parity)
 * @returns {{ strings: Array<{text: string, line: number, speaker: string | null, tags: string[]}>, names: Array<{name: string, line: number}> }}
 */
export function collectKsStrings(source, file) {
  void file;
  const lines = source.split(/\r\n|\r|\n/);
  const strings = [];
  const names = [];
  let speaker = null;
  let inScript = false;
  for (let i = 0; i < lines.length; i += 1) {
    const kind = classifyLine(lines[i]);
    if (inScript) {
      // Inside [iscript] every line is TJS the engine executes. KAG reads
      // the closing [endscript] from its own line, and so do we: an
      // unterminated block runs to the end of the file.
      if (kind === "tags" && tagName(lines[i]) === "endscript") inScript = false;
      continue;
    }
    if (kind === "comment" || kind === "blank" || kind === "label") continue;
    if (kind === "tags") {
      if (tagName(lines[i]) === "iscript") {
        inScript = true;
        continue;
      }
      // Tag-only lines may still carry the speaker declaration, in both the
      // [name_set ...] and @name_set ... spellings. Any other tag line does
      // not reset the speaker.
      const body = lines[i].trim().replace(/^\[/, "").replace(/\]\s*$/, "").replace(/^@/, "");
      const speakerValue = nameSetValue(body);
      if (speakerValue !== null) {
        speaker = speakerValue;
        names.push({ name: speakerValue, line: i + 1 });
      }
      continue;
    }
    const { text, tags } = stripInlineTags(lines[i]);
    const visible = text.trim();
    if (visible === "") continue;
    strings.push({ text: visible, line: i + 1, speaker, tags });
  }
  return { strings, names };
}
