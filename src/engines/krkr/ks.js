/**
 * KAG scenario (.ks) text extraction.
 *
 * A .ks file is line-oriented: comment lines start with `;`, labels with `*`,
 * everything else is either tags only (`[...]`) or a text line with optional
 * inline tags. The extractor keeps plain text lines (tags stripped), tracks
 * the most recent `[name_set name='...']` speaker, and records line numbers.
 *
 * @module engines/krkr/ks
 */

/**
 * Decode .ks bytes: try UTF-8 strict first, fall back to Shift_JIS. Encoding
 * sniffing stays here so callers share one rule.
 * @param {Buffer} buffer raw file bytes
 * @returns {{ text: string, encoding: "utf-8" | "shift_jis", undecodable: boolean, error?: string }}
 */
export function decodeKs(buffer) {
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
 * unclosed bracket stays text.
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
  if (first === "[") return "tags";
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
 * Read a `[name_set name='...']` (double or single quotes) speaker value.
 * @param {string} tagBody content between the brackets
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
 * Collect translatable strings from one decoded .ks source.
 *
 * A collected unit is one text line with inline tags stripped. Line numbers
 * are 1-based and refer to the decoded text (one line per `\n`).
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
  for (let i = 0; i < lines.length; i += 1) {
    const kind = classifyLine(lines[i]);
    if (kind === "comment" || kind === "blank" || kind === "label") continue;
    if (kind === "tags") {
      // Tag-only lines may still carry the speaker declaration.
      const inner = lines[i].trim().replace(/^\[/, "").replace(/\]\s*$/, "");
      const speakerValue = nameSetValue(lines[i].trim().slice(1, -1));
      if (speakerValue !== null) {
        speaker = speakerValue;
        names.push({ name: speakerValue, line: i + 1 });
      } else if (/^\s*name_set\b/.test(inner) === false) {
        // any other tag line does not reset the speaker
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
