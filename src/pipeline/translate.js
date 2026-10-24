/**
 * The translation pipeline: turn a dictionary full of empty targets into a
 * dictionary full of translations.
 *
 * The pipeline never trusts the model. Every returned string is validated
 * against the source before it is written:
 *
 *   - escape codes must be byte identical (\\C[6], \\V[12], \\{ ...)
 *   - the number of line breaks must match, because MZ renders them literally
 *   - the length ratio must stay plausible, which catches truncation and
 *     "here is your translation:" small talk
 *
 * Anything that fails is retried once and then reported, never silently stored.
 *
 * @module pipeline/translate
 */

import { controlCodes, visibleText } from "../core/textkey.js";
import { wrapText } from "./wrap.js";

/**
 * @typedef {object} PendingItem
 * @property {string} key source text
 * @property {string[]} contexts
 */

/**
 * @typedef {object} Rejection
 * @property {string} key
 * @property {string} reason
 * @property {string} [target]
 */

/**
 * @typedef {object} TranslateOptions
 * @property {import("./provider.js").Provider} provider
 * @property {string} [targetLang]
 * @property {Record<string,string>} [glossary]
 * @property {number} [batchSize]
 * @property {number} [charBudget]
 * @property {number} [concurrency]
 * @property {number} [limit]
 * @property {string} [onlyContext]
 * @property {number} [maxLengthRatio]
 * @property {number} [minLengthRatio]
 * @property {number} [maxColumns] wrap lines wider than this many display columns
 * @property {boolean} [rewrapExisting] re-wrap entries that are already translated
 * @property {boolean} [overwriteExisting] let --glossary replace entries that are already translated
 * @property {boolean} [requireLines]
 * @property {boolean} [strictCodes]
 * @property {number} [attempts]
 * @property {(progress: {done: number, total: number, translated: number, rejected: number}) => void} [onProgress]
 * @property {(message: string) => void} [log]
 * @property {AbortSignal} [signal]
 */

/**
 * Collect the entries that still need a translation.
 *
 * Longest first: a batch then has a similar cost per item and prompts stay
 * balanced, which keeps the model from rushing the tail of a request.
 *
 * @param {import("../core/dict.js").Dictionary} dict
 * @param {{ limit?: number, onlyContext?: string, minLength?: number }} [options]
 * @returns {PendingItem[]}
 */
export function selectPending(dict, options = {}) {
  const out = [];
  const only = options.onlyContext || null;
  const minLength = options.minLength || 0;
  for (const key of Object.keys(dict.entries)) {
    const entry = dict.entries[key];
    if (entry.text) continue;
    if (key.length < minLength) continue;
    if (only && !entry.contexts.some((c) => c.includes(only))) continue;
    out.push({ key, contexts: entry.contexts });
  }
  out.sort((a, b) => b.key.length - a.key.length);
  const limit = options.limit === undefined || options.limit === null ? out.length : options.limit;
  return out.slice(0, limit);
}

/**
 * Split pending entries into request sized batches.
 *
 * @param {PendingItem[]} items
 * @param {{ batchSize?: number, charBudget?: number }} [options]
 * @returns {PendingItem[][]}
 */
export function buildBatches(items, options = {}) {
  const batchSize = options.batchSize || 40;
  const charBudget = options.charBudget || 6000;
  const batches = [];
  let current = [];
  let chars = 0;
  for (const item of items) {
    const size = item.key.length + 40;
    if (current.length > 0 && (current.length >= batchSize || chars + size > charBudget)) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(item);
    chars += size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/** Rendered with a runtime backslash so this file has no escape surgery. */
const ESCAPE_EXAMPLES = [
  "\\C[6]",
  "\\V[12]",
  "\\N[1]",
  "\\G",
  "\\{",
  "\\}",
  "\\>",
  "\\<",
  "\\^",
  "\\!",
  "\\|",
  "\\.",
  "\\$",
].join(", ");

/**
 * The instruction block sent with every request.
 *
 * @param {{ targetLang?: string, glossary?: Record<string,string>, maxColumns?: number }} options
 * @returns {string}
 */
export function systemPrompt(options = {}) {
  const lang = options.targetLang || "Simplified Chinese";
  const maxColumns = Number(options.maxColumns);
  const lines = [
    "You are a professional game localiser.",
    "You translate RPG Maker MZ game text from Japanese into " + lang + ".",
    "",
    "Rules:",
    "1. Reply with JSON only, no prose, no markdown fences.",
    "2. Translate every item independently; never merge or split items.",
    "3. Keep every escape code exactly as written, in the same order.",
    "   Escape codes look like " + ESCAPE_EXAMPLES + ".",
    "   Never translate or reorder them, and never add new ones.",
    "4. Preserve the number of line breaks of each item.",
    "4b. Keep %1, %2 ... placeholders exactly as written; they are filled in by the game.",
    "5. Keep speaker names, item names and skill names consistent.",
    "6. Keep translations compact: the game draws them in fixed size windows.",
    Number.isFinite(maxColumns) && maxColumns > 0
      ? "6b. Aim for lines of at most " +
        maxColumns +
        " columns (a full width character counts as 2). Keep the existing line breaks."
      : null,
    "7. If an item is already readable in the target language, repeat it unchanged.",
    "8. Never add notes, explanations or quotation marks that are not in the source.",
  ].filter((line) => line !== null);
  const glossaryKeys = Object.keys(options.glossary || {});
  if (glossaryKeys.length > 0) {
    lines.push("");
    lines.push("Use exactly these translations for the glossary:");
    for (const key of glossaryKeys) {
      lines.push("  " + JSON.stringify(key) + " -> " + JSON.stringify(options.glossary[key]));
    }
  }
  lines.push("");
  lines.push('Output shape: {"translations":[{"i":<index>,"t":"<translation>"}]}');
  return lines.join("\n");
}


/**
 * Keep only the glossary rows a request can possibly need.
 *
 * Every request carries the instruction block, and a term base is copied into
 * it verbatim. On a real game that is 952 requests paying for the same few
 * hundred rows even though a batch of 40 lines only mentions three or four of
 * them. Filtering by literal mention cuts the glossary share of the prompt by
 * more than 90% without changing what the model is told about the lines it is
 * looking at.
 *
 * A row that is not mentioned by the batch cannot affect it: the glossary only
 * fixes how a source string is rendered when that source string shows up.
 * Entries that match a whole source line never reach the model at all, because
 * the glossary fills those directly.
 *
 * @param {Record<string,string>} glossary
 * @param {PendingItem[]} items
 * @returns {Record<string,string>}
 */
export function selectGlossary(glossary, items) {
  const keys = Object.keys(glossary || {});
  if (keys.length === 0) return {};
  const out = {};
  // Join once; an n*m scan of substrings is cheaper than m regexes per item.
  const haystack = items.map((item) => item.key).join("\u0000");
  for (const key of keys) {
    if (haystack.includes(key)) out[key] = glossary[key];
  }
  return out;
}

/**
 * @param {PendingItem[]} batch
 * @returns {string}
 */
export function userPrompt(batch) {
  return JSON.stringify({
    items: batch.map((item, index) => ({ i: index, text: item.key })),
  });
}

/** A markdown code fence, built at runtime to keep this file plain ASCII. */
const FENCE = String.fromCharCode(96, 96, 96);

/**
 * Parse a model reply into index -> translation.
 *
 * Models like to wrap JSON in a fence or add a sentence before it, so the
 * extraction is deliberately forgiving while the payload stays strict.
 *
 * @param {string} text
 * @returns {Record<number,string>}
 */
export function parseReply(text) {
  let body = String(text || "").trim();
  if (body.startsWith(FENCE)) {
    body = body.slice(FENCE.length);
    const close = body.lastIndexOf(FENCE);
    if (close >= 0) body = body.slice(0, close);
    body = body.trim();
  }
  // Accept both shapes: a bare array of items, or an object wrapping one.
  const arrayStart = body.indexOf("[");
  const objectStart = body.indexOf("{");
  const useArray = arrayStart >= 0 && (objectStart < 0 || arrayStart < objectStart);
  const start = useArray ? arrayStart : objectStart;
  const end = useArray ? body.lastIndexOf("]") : body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("reply is not a JSON object");
  const parsed = parseJsonLoose(body.slice(start, end + 1));
  const list = Array.isArray(parsed) ? parsed : parsed.translations || parsed.items || parsed.results;
  if (!Array.isArray(list)) throw new Error("reply has no translations array");
  const out = {};
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const index = Number(item.i !== undefined ? item.i : item.index !== undefined ? item.index : item.id);
    const value = pickTranslation(item);
    if (Number.isInteger(index) && typeof value === "string") out[index] = value;
  }
  return out;
}

/** Valid JSON string escapes, used to repair model output. */
const JSON_ESCAPES = new Set(['"', String.fromCharCode(92), "/", "b", "f", "n", "r", "t", "u"]);

/**
 * Parse JSON that a model wrote by hand.
 *
 * RPG Maker text is full of escapes like \{ and \C[2]. A model echoing them
 * produces \{ inside a JSON string, which JSON.parse rejects as an invalid
 * escape and which would otherwise throw away an entire batch.
 *
 * @param {string} text
 * @returns {unknown}
 */
function parseJsonLoose(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    if (!/escaped character|Bad control character/i.test(String(error && error.message))) throw error;
  }
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const backslash = String.fromCharCode(92);
    if (!inString) {
      if (ch === '"') inString = true;
      out += ch;
      continue;
    }
    if (ch === backslash) {
      const next = text[i + 1];
      if (next !== undefined && JSON_ESCAPES.has(next)) {
        out += ch + next;
        i += 1;
      } else {
        out += backslash + backslash;
      }
      continue;
    }
    if (ch === '"') {
      inString = false;
      out += ch;
    } else if (ch === "\n") out += String.fromCharCode(92) + "n";
    else if (ch === "\r") out += String.fromCharCode(92) + "r";
    else if (ch === "\t") out += String.fromCharCode(92) + "t";
    else out += ch;
    continue;
  }
  return JSON.parse(out);
}

/** Field names a model may use for the translated string. */
const VALUE_KEYS = ["t", "translation", "zh", "target", "dst", "out", "result", "text", "src", "source"];

/**
 * Pull the translated string out of one reply item.
 *
 * Models routinely echo the request shape back with the translation in the
 * source field, so a single unambiguous string wins over the field name.
 *
 * @param {Record<string, unknown>} item
 * @returns {string | undefined}
 */
function pickTranslation(item) {
  for (const key of VALUE_KEYS) {
    if (typeof item[key] === "string") return item[key];
  }
  const strings = Object.keys(item)
    .filter((key) => key !== "i" && key !== "index" && key !== "id" && typeof item[key] === "string");
  return strings.length === 1 ? item[strings[0]] : undefined;
}

/**
 * Kana that the player actually sees.
 *
 * Some MV games inline the speaker with custom markup ("\N<ひなた>“好开心♡”")
 * which is not an RPG Maker escape code. Those tags still contain kana after a
 * perfect translation, so they are removed before judging a string as Japanese.
 * Backslash escape codes are removed too: \N[1] carries no language.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function hasKanaOutsideMarkup(text) {
  return /[\u3040-\u30ff]/.test(visibleText(text));
}

/**
 * Decide whether a candidate translation may be stored.
 *
 * @param {string} source
 * @param {string} target
 * @param {{ strictCodes?: boolean, requireLines?: boolean, maxLengthRatio?: number, minLengthRatio?: number }} [options]
 * @returns {{ ok: boolean, reason?: string }}
 */
export function validateTranslation(source, target, options = {}) {
  const strictCodes = options.strictCodes !== false;
  const requireLines = options.requireLines !== false;
  const maxRatio = options.maxLengthRatio || 4;
  const minRatio = options.minLengthRatio || 0.12;

  if (typeof target !== "string" || target.trim().length === 0) return { ok: false, reason: "empty" };

  // A Japanese source that comes back unchanged was not translated. Rejecting
  // it keeps the entry pending instead of shipping kana to the player.
  //
  // The test runs on the text with inline markup removed, because several MV
  // games write the speaker name inside the line ("\N<ひなた>“好开心♡”") and an
  // already localised line then still contains kana in the speaker tag. Only
  // kana that the player actually sees means "this was not translated".
  if (target === source && hasKanaOutsideMarkup(source)) {
    return { ok: false, reason: "identical to source (untranslated echo)" };
  }

  if (strictCodes) {
    const a = controlCodes(source);
    const b = controlCodes(target);
    if (a.length !== b.length || a.some((code, i) => code !== b[i])) {
      return { ok: false, reason: "escape codes differ: " + JSON.stringify(a) + " vs " + JSON.stringify(b) };
    }
  }

  // MZ expands %1 %2 in skill and state messages with the actor name, so a
  // translation that drops or renumbers them prints the wrong text.
  const sourceSlots = source.match(/%[0-9]+/g) || [];
  const targetSlots = target.match(/%[0-9]+/g) || [];
  if (sourceSlots.join(",") !== targetSlots.join(",")) {
    return { ok: false, reason: "placeholders differ: " + JSON.stringify(sourceSlots) + " vs " + JSON.stringify(targetSlots) };
  }

  if (requireLines) {
    const a = (source.match(/\n/g) || []).length;
    const b = (target.match(/\n/g) || []).length;
    if (a !== b) return { ok: false, reason: "line breaks differ: " + a + " vs " + b };
  }

  if (source.length > 0) {
    const ratio = target.length / source.length;
    if (ratio > maxRatio) return { ok: false, reason: "too long (" + ratio.toFixed(2) + "x)" };
    if (ratio < minRatio) return { ok: false, reason: "too short (" + ratio.toFixed(2) + "x)" };
  }
  if (target.includes("\ufffd")) return { ok: false, reason: "replacement character in translation" };

  return { ok: true };
}

/**
 * Run one batch through the provider and keep only validated results.
 *
 * Items the model skipped or mangled are sent once more; whatever still fails
 * is reported instead of guessed.
 *
 * @param {PendingItem[]} batch
 * @param {TranslateOptions} options
 * @returns {Promise<{ accepted: Map<string,string>, rejected: Rejection[] }>}
 */
async function runBatch(batch, options) {
  const provider = options.provider;
  const accepted = new Map();
  /** @type {Map<string,Rejection>} only the last verdict per key is kept */
  const rejections = new Map();
  const maxAttempts = options.attempts || 2;

  /** @type {PendingItem[]} */
  let pending = batch;

  for (let attempt = 0; attempt < maxAttempts && pending.length > 0; attempt += 1) {
    const reply = await provider.complete({
      systemPrompt: systemPrompt({
        targetLang: options.targetLang,
        glossary: selectGlossary(options.glossary, pending),
        maxColumns: options.maxColumns,
      }),
      userPrompt: userPrompt(pending),
      signal: options.signal,
    });
    const parsed = parseReply(reply);
    const stillPending = [];
    for (let index = 0; index < pending.length; index += 1) {
      const item = pending[index];
      const candidate = parsed[index];
      if (candidate === undefined) {
        rejections.set(item.key, { key: item.key, reason: "missing from reply" });
        stillPending.push(item);
        continue;
      }
      const verdict = validateTranslation(item.key, candidate, options);
      if (verdict.ok) {
        // Wrapping happens only once the text is known to be faithful, so the
        // validator keeps comparing model output against the source verbatim.
        accepted.set(item.key, wrapText(candidate, options.maxColumns));
        rejections.delete(item.key);
      } else {
        rejections.set(item.key, { key: item.key, target: candidate, reason: verdict.reason });
        stillPending.push(item);
      }
    }
    pending = stillPending;
  }

  return { accepted, rejected: [...rejections.values()] };
}

/**
 * Translate every pending entry of a dictionary, in place.
 *
 * @param {import("../core/dict.js").Dictionary} dict
 * @param {TranslateOptions} options
 * @returns {Promise<{ total: number, translated: number, rejected: Rejection[], failed: number, rewrapped: number }>}
 */
export async function translateDictionary(dict, options) {
  const provider = options.provider;
  if (!provider || typeof provider.complete !== "function") throw new Error("no provider given");

  const glossary = options.glossary || {};

  // A dictionary translated before --max-length existed still holds over-wide
  // lines. Re-wrapping them is deterministic and needs no model call, so it runs
  // first and turns "add the flag" into something that fixes the files on disk.
  let rewrapped = 0;
  if (options.rewrapExisting && Number(options.maxColumns) > 0) {
    for (const key of Object.keys(dict.entries)) {
      const entry = dict.entries[key];
      if (!entry.text) continue;
      const fitted = wrapText(entry.text, options.maxColumns);
      if (fitted !== entry.text) {
        entry.text = fitted;
        rewrapped += 1;
      }
    }
  }

  const items = selectPending(dict, {
    limit: options.limit,
    onlyContext: options.onlyContext,
    minLength: options.minLength,
  });

  // Glossary only mode: a human curated override file is applied and nothing is
  // sent to a model. This is how a translator can work offline, or how a small
  // hand written spot check gets installed on a real game.
  if (options.glossaryOnly) {
    let applied = 0;
    let overwritten = 0;
    const missed = [];
    for (const key of Object.keys(dict.entries)) {
      const entry = dict.entries[key];
      // A glossary built by "terms --drift-only" targets exactly the entries
      // that are already translated, so skipping those made a drift report
      // impossible to act on. Overwriting is opt-in: a plain glossary is still
      // a fill-the-gaps pass, never a silent rewrite of finished work.
      if (entry.text && !options.overwriteExisting) continue;
      const fixed = glossary[key];
      if (typeof fixed !== "string" || fixed.length === 0) continue;
      const verdict = validateTranslation(key, fixed, options);
      if (!verdict.ok) {
        missed.push({ key, reason: verdict.reason });
        continue;
      }
      if (entry.text && entry.text !== fixed) overwritten += 1;
      entry.text = wrapText(fixed, options.maxColumns);
      delete entry.error;
      applied += 1;
    }
    return {
      total: Object.keys(glossary).length,
      translated: applied,
      overwritten,
      rejected: missed,
      failed: 0,
      rewrapped,
    };
  }

  // Glossary hits need no model call at all.
  const remaining = [];
  let translated = 0;
  for (const item of items) {
    const fixed = glossary[item.key];
    if (typeof fixed === "string" && fixed.length > 0) {
      if (validateTranslation(item.key, fixed, options).ok) {
        dict.entries[item.key].text = wrapText(fixed, options.maxColumns);
        translated += 1;
        continue;
      }
    }
    remaining.push(item);
  }

  const batches = buildBatches(remaining, { batchSize: options.batchSize, charBudget: options.charBudget });
  const rejected = [];
  let failed = 0;
  let done = 0;
  const concurrency = Math.max(1, Math.min(options.concurrency || 2, batches.length || 1));
  let cursor = 0;

  const report = () => {
    if (typeof options.onProgress === "function") {
      options.onProgress({ done, total: items.length, translated, rejected: rejected.length });
    }
  };
  report();

  const worker = async () => {
    while (cursor < batches.length) {
      const index = cursor;
      cursor += 1;
      const batch = batches[index];
      try {
        const result = await runBatch(batch, options);
        for (const [key, value] of result.accepted) {
          const entry = dict.entries[key];
          if (entry) {
            entry.text = value;
            delete entry.error;
            translated += 1;
          }
        }
        for (const rejection of result.rejected) {
          rejected.push(rejection);
          const entry = dict.entries[rejection.key];
          if (entry) entry.error = rejection.reason;
        }
      } catch (error) {
        failed += batch.length;
        const message = error && error.message ? error.message : String(error);
        for (const item of batch) rejected.push({ key: item.key, reason: "request failed: " + message });
        if (typeof options.log === "function") options.log("batch failed: " + message);
      }
      done += batch.length;
      report();
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return { total: items.length, translated, rejected, failed, rewrapped };
}