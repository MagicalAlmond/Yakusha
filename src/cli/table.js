/**
 * Table exports: TSV and CSV projections of the translated dictionary.
 *
 * Both formats share one shape: a three column header row
 * ("source", "target", "contexts") followed by one row per translated
 * entry, in the same UTF-16 key order as the JSON export. contexts is a
 * list joined with ", ". Only translated entries are exported, exactly
 * like buildExport, and the same round trip guarantee applies: importing
 * a table exported from a dictionary reproduces that dictionary.
 *
 * Encoding is UTF-8 with a BOM so Excel opens either format correctly,
 * and rows end with CRLF (RFC 4180). The reader accepts LF and no BOM
 * too, so files edited by hand or by other tools round trip as well.
 *
 * @module cli/table
 */

import { CliError } from "./envelope.js";

export const TABLE_HEADER = ["source", "target", "contexts"];
/** Column separator for --format tsv. */
export const TSV_SEPARATOR = "\t";
/** Column separator for --format csv. */
export const CSV_SEPARATOR = ",";
/** The UTF-8 BOM written before the first byte of a table export. */
export const UTF8_BOM = "\uFEFF";

/**
 * @typedef {{ source: string, target: string, contexts: string[] }} TableRow
 */

/**
 * Collect the translated entries as rows, in UTF-16 key order.
 *
 * @param {import("../core/dict.js").Dictionary} dictionary
 * @returns {TableRow[]}
 */
export function buildTableRows(dictionary) {
  const rows = [];
  for (const key of Object.keys(dictionary.entries).sort()) {
    const entry = dictionary.entries[key];
    if (!entry || typeof entry.text !== "string" || entry.text.length === 0) continue;
    rows.push({
      source: key,
      target: entry.text,
      contexts: Array.isArray(entry.contexts) ? entry.contexts.slice() : [],
    });
  }
  return rows;
}

/**
 * Quote one cell for a table file. The rule is RFC 4180 with the cell
 * separator generalised: a cell needs quotes when it contains a separator,
 * a quote, CR, LF, or a leading or trailing space. Embedded quotes are
 * doubled. This is deliberately conservative: an unquoted cell never
 * changes meaning, a misparsed quoted cell does.
 *
 * @param {string} cell
 * @param {string} separator
 * @returns {string}
 */
export function quoteCell(cell, separator) {
  if (cell.length === 0) return "";
  let needsQuotes = false;
  if (cell.includes(separator) || cell.includes("\"")) needsQuotes = true;
  if (!needsQuotes && (cell.includes("\r") || cell.includes("\n"))) needsQuotes = true;
  if (!needsQuotes && (cell.charCodeAt(0) === 32 || cell.charCodeAt(cell.length - 1) === 32)) needsQuotes = true;
  if (!needsQuotes) return cell;
  return '"' + cell.replaceAll("\"", "\"\"") + '"';
}

/**
 * The contexts cell. Joined with ", " by default; when that join would be
 * ambiguous (a context itself contains ", ", or the joined cell would look
 * like a JSON array) the cell is written as a JSON array instead. The
 * reader mirrors this: a cell that starts with "[" is first tried as JSON,
 * and only a plain join otherwise.
 *
 * @param {string[]} contexts
 * @returns {string}
 */
export function contextsCell(contexts) {
  const joined = contexts.join(", ");
  if (contexts.some((context) => context.includes(", ")) || joined.startsWith("[")) {
    return JSON.stringify(contexts);
  }
  return joined;
}

/**
 * Serialise rows as a complete table file.
 *
 * @param {TableRow[]} rows
 * @param {{"tsv"|"csv"}} format
 * @returns {string}
 */
export function serialiseTable(rows, format) {
  const separator = format === "csv" ? CSV_SEPARATOR : TSV_SEPARATOR;
  const lines = [TABLE_HEADER.join(separator)];
  for (const row of rows) {
    lines.push([
      quoteCell(row.source, separator),
      quoteCell(row.target, separator),
      quoteCell(contextsCell(row.contexts), separator),
    ].join(separator));
  }
  return UTF8_BOM + lines.join("\r\n") + "\r\n";
}

/**
 * Parse a table file back into rows. Accepts the exact format
 * serialiseTable writes (BOM + CRLF) and the friendlier variants a text
 * editor produces (no BOM, LF endings, a missing trailing newline).
 *
 * The header row is required and must match TABLE_HEADER exactly; a file
 * without it is rejected instead of parsed with shifted columns.
 *
 * @param {string} text complete file contents
 * @param {{"tsv"|"csv"}} format
 * @returns {TableRow[]}
 */
export function parseTable(text, format) {
  const separator = format === "csv" ? CSV_SEPARATOR : TSV_SEPARATOR;
  let body = text;
  if (body.charCodeAt(0) === 0xfeff) body = body.slice(1);
  const records = splitRecords(body);
  // Editors like to leave one extra blank line; a trailing empty record is
  // formatting, not a row. One in the middle stays an error.
  while (records.length > 0 && records[records.length - 1] === "") records.pop();
  const rows = records.map((record) => splitRecord(record, separator));
  if (rows.length === 0 || rows[0].length !== TABLE_HEADER.length ||
      TABLE_HEADER.some((name, index) => rows[0][index] !== name)) {
    throw new CliError("E_DICTIONARY", "table file must start with the header row source" + separator + "target" + separator + "contexts");
  }
  const parsed = [];
  for (let index = 1; index < rows.length; index += 1) {
    const cells = rows[index];
    if (cells.length !== 3) {
      throw new CliError("E_DICTIONARY",
        "table row " + index + " has " + cells.length + " cells, expected 3");
    }
    parsed.push({ source: cells[0], target: cells[1], contexts: splitContexts(cells[2]) });
  }
  return parsed;
}

/**
 * Split the file into logical records. RFC 4180 quotes may hide both CRLF
 * and LF, so records are counted by scanning cell by cell instead of by
 * splitting on a line ending.
 *
 * @param {string} body BOM already stripped
 * @returns {string[]}
 */
function splitRecords(body) {
  if (body.length === 0) return [];
  const records = [];
  let current = "";
  let index = 0;
  while (index < body.length) {
    const char = body[index];
    if (char === "\"") {
      const end = skipQuoted(body, index);
      current += body.slice(index, end);
      index = end;
      continue;
    }
    if (char === "\r" && body[index + 1] === "\n") {
      records.push(current);
      current = "";
      index += 2;
      continue;
    }
    if (char === "\n") {
      records.push(current);
      current = "";
      index += 1;
      continue;
    }
    current += char;
    index += 1;
  }
  // A trailing CRLF ends the last record; an unfinished last line is still a
  // record, so both forms parse the same.
  if (current.length > 0) records.push(current);
  return records;
}

/**
 * @param {string} body
 * @param {number} start index of the opening quote
 * @returns {number} index just past the closing quote
 */
function skipQuoted(body, start) {
  let index = start + 1;
  while (index < body.length) {
    if (body[index] === "\"") {
      if (body[index + 1] === "\"") {
        index += 2;
        continue;
      }
      return index + 1;
    }
    index += 1;
  }
  return index;
}

/**
 * Split one record into cells. A quoted cell is taken verbatim with its
 * doubled quotes folded; an unquoted cell is plain text up to the next
 * separator or record end.
 *
 * @param {string} record one line without its line ending
 * @param {string} separator
 * @returns {string[]}
 */
function splitRecord(record, separator) {
  const cells = [];
  let index = 0;
  // One iteration parses exactly one cell and stops on the separator that
  // ends it. The <= bound turns a record that ends with a separator into a
  // trailing empty cell, which is how an empty contexts column round trips.
  while (index <= record.length) {
    let cell;
    if (record[index] === "\"") {
      const end = Math.min(skipQuoted(record, index), record.length);
      cell = record.slice(index + 1, end - 1).replaceAll("\"\"", "\"");
      index = end;
      // Tolerate stray text after a closing quote by keeping it in the same
      // cell rather than inventing a column.
      const next = record.indexOf(separator, index);
      if (next < 0) {
        cell += record.slice(index);
        index = record.length;
      } else {
        cell += record.slice(index, next);
        index = next;
      }
    } else {
      const next = record.indexOf(separator, index);
      if (next < 0) {
        cell = record.slice(index);
        index = record.length;
      } else {
        cell = record.slice(index, next);
        index = next;
      }
    }
    cells.push(cell);
    if (index < record.length && record[index] === separator) index += 1;
    else break;
  }
  return cells;
}

/**
 * Split a contexts cell back into its list. Serialisation joins with ", ",
 * and an empty cell means no contexts.
 *
 * @param {string} cell
 * @returns {string[]}
 */
function splitContexts(cell) {
  if (cell.length === 0) return [];
  if (cell.startsWith("[")) {
    try {
      const parsed = JSON.parse(cell);
      if (Array.isArray(parsed) && parsed.every((value) => typeof value === "string")) return parsed;
    } catch {
      // Not JSON after all: fall through to the plain join.
    }
  }
  return cell.split(", ");
}

