/**
 * Speaker names carried inside a dialogue line.
 *
 * Some MV games write the speaker into the line itself as "\N<ひなた>“...”" and a
 * plugin (某姓名窗插件) moves it into a separate name box. The tag
 * text is drawn verbatim, so it is translated content like any other — but it is
 * invisible to every other part of the pipeline: it is not a database field,
 * it is not an escape code, and validateTranslation deliberately strips markup
 * before checking a translation, precisely so that "正文已中文、只有名字是日文"
 * is not treated as an untranslated line.
 *
 * That leaves one hole. Nothing stops the model from translating a name on one
 * line and leaving it in Japanese on the next, and the player then reads the same
 * character in two languages. This module is the measurement and the mechanical
 * repair for exactly that case.
 *
 * @module pipeline/speaker
 */

/**
 * What an inline speaker tag may contain: kana, Han and blanks, nothing else.
 *
 * Other plugins use angle brackets for code ("<50*\v[65]>",
 * "<$dataMap.events[6].name;>"), so a plain /<[^>]*>/ would treat expressions as
 * character names. A whitelist is stable here where a blacklist is not: the code
 * expressions found in real games contain quotes, spaces and operators in every
 * combination.
 */
const TAG_TEXT = /^[\u3005\u3006\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uff66-\uff9f\s]+$/;

/** Kana, i.e. evidence that a name was left in Japanese. */
const KANA = /[\u3041-\u3096\u30a1-\u30fa]/;

/**
 * Speaker names embedded in one line.
 *
 * Matched on the stored text rather than on a stripped copy: the repair path has
 * to rewrite the tag in the very string the dictionary holds, so positions must
 * refer to that string. Escape codes are ASCII and can never satisfy TAG_TEXT,
 * so they cannot be mistaken for a name.
 *
 * @param {string} text source-form or stored translation
 * @returns {string[]}
 */
export function speakerTags(text) {
  /** @type {string[]} */
  const names = [];
  if (typeof text !== "string" || !text.includes("<")) return names;
  for (const match of text.matchAll(/<([^<>]*)>/g)) {
    const inner = match[1].trim();
    if (inner.length === 0 || inner.length > 40) continue;
    if (!TAG_TEXT.test(inner)) continue;
    names.push(inner);
  }
  return names;
}

/**
 * Rewrite the speaker tags of one line through a callback.
 *
 * Only tags that count as names are touched; code expressions and stray angle
 * brackets are copied through unchanged, so a game that uses both keeps working.
 *
 * @param {string} text stored translation
 * @param {(name: string, index: number) => string|undefined} replace
 *   return the new name, or undefined to keep the tag as it is
 * @returns {string}
 */
export function rewriteSpeakerTags(text, replace) {
  if (typeof text !== "string" || !text.includes("<")) return text;
  let index = -1;
  return text.replace(/<([^<>]*)>/g, (whole, inner) => {
    const name = inner.trim();
    if (name.length === 0 || name.length > 40) return whole;
    if (!TAG_TEXT.test(name)) return whole;
    index += 1;
    const next = replace(name, index);
    return next === undefined || next === name ? whole : "<" + next + ">";
  });
}

/**
 * Every rendering this dictionary uses for every speaker name.
 *
 * Names only make sense in aggregate: whether "ひなた" should have been
 * translated depends on how the rest of this game renders it, and which of
 * several renderings is the house style depends on the count. The index is
 * therefore built once and shared by the audit and the repair.
 *
 * Lines that lost or gained a tag cannot be paired name by name and are skipped;
 * pairing by position is only safe while the counts agree, and in every real
 * dictionary measured they did.
 *
 * @param {{entries: Record<string, any>}} dictionary
 * @returns {Map<string, Map<string, number>>} source name -> rendering -> lines
 */
export function buildSpeakerIndex(dictionary) {
  /** @type {Map<string, Map<string, number>>} */
  const index = new Map();
  const entries = (dictionary && dictionary.entries) || {};
  for (const key of Object.keys(entries)) {
    const entry = entries[key];
    if (!entry || typeof entry !== "object") continue;
    const target = typeof entry.text === "string" ? entry.text : "";
    if (target.trim().length === 0) continue;
    const sources = speakerTags(key);
    if (sources.length === 0) continue;
    const renderings = speakerTags(target);
    if (sources.length !== renderings.length) continue;
    for (let i = 0; i < sources.length; i += 1) {
      const source = sources[i];
      if (!index.has(source)) index.set(source, new Map());
      const bucket = index.get(source);
      bucket.set(renderings[i], (bucket.get(renderings[i]) || 0) + 1);
    }
  }
  return index;
}

/**
 * The house rendering of one speaker name.
 *
 * `translated` means some line rendered the name without kana, i.e. this game
 * does translate it — only then is a Japanese leftover worth reporting.
 *
 * `house` is the rendering to standardise on. Count decides, but a rendering
 * that is merely the source name copied through never wins while a real
 * translation exists: 先生 is both "teacher" and a plausible Japanese surname, so
 * counting raw totals can make the untranslated form look like the house style
 * and then report the translations as drift. Ties prefer the non-kana form so
 * the outcome does not depend on which line the dictionary stored first.
 *
 * @param {Map<string, Map<string, number>>} index
 * @param {string} source
 * @returns {{translated: boolean, house: string}}
 */
export function houseOf(index, source) {
  const bucket = index.get(source);
  if (!bucket) return { translated: false, house: "" };
  let house = "";
  let best = -1;
  let bestTranslated = false;
  let translated = false;
  for (const [rendering, count] of bucket) {
    const isKana = KANA.test(rendering);
    if (!isKana) translated = true;
    const isTranslation = !isKana && rendering !== source;
    // A real translation outranks a copied source name; within the same tier the
    // bigger count wins, and an exact tie goes to the non-kana form.
    const better =
      (isTranslation && !bestTranslated) ||
      (isTranslation === bestTranslated &&
        (count > best || (count === best && KANA.test(house) && !isKana)));
    if (better) {
      best = count;
      bestTranslated = isTranslation;
      house = rendering;
    }
  }
  return { translated, house };
}

/**
 * Rewrite speaker tags that disagree with this game's own house rendering.
 *
 * This is the one mechanical fix the audit can suggest safely: the target text
 * already exists elsewhere in the same dictionary, used hundreds of times. No
 * model is involved and nothing is invented.
 *
 * Only kana leftovers are repaired by default — "the player is reading a Japanese
 * name" has one right answer. Two different Chinese renderings are a style call
 * (沙耶香 vs 沙耶加, 疲惫的女性 vs 看起来疲惫的女性), so that needs
 * `includeDrift` and a human decision.
 *
 * A name this game never translated cannot be repaired from the dictionary alone:
 * there is no house rendering to copy. Those cost one line of human input each, so
 * `names` maps a source name to the Chinese that should be used.
 *
 * @param {{entries: Record<string, any>}} dictionary mutated in place
 * @param {{includeDrift?: boolean, index?: Map<string, Map<string, number>>, names?: Record<string, string>}} [options]
 * @returns {{entries: number, tags: number, names: {source: string, from: string, to: string, count: number}[]}}
 */
export function repairSpeakerNames(dictionary, options = {}) {
  const index = options.index || buildSpeakerIndex(dictionary);
  const includeDrift = options.includeDrift === true;
  /** @type {Record<string, string>} */
  const supplied = options.names && typeof options.names === "object" ? options.names : {};
  const entries = (dictionary && dictionary.entries) || {};
  /** @type {Map<string, {source: string, from: string, to: string, count: number}>} */
  const touched = new Map();
  let changedEntries = 0;
  let changedTags = 0;

  for (const key of Object.keys(entries)) {
    const entry = entries[key];
    if (!entry || typeof entry !== "object") continue;
    const target = typeof entry.text === "string" ? entry.text : "";
    if (target.trim().length === 0) continue;
    const sources = speakerTags(key);
    if (sources.length === 0) continue;
    const renderings = speakerTags(target);
    if (sources.length !== renderings.length) continue;

    let changedHere = false;
    const next = rewriteSpeakerTags(target, (name, i) => {
      const source = sources[i];
      if (source === undefined) return undefined;
      const rendering = renderings[i];
      if (rendering === undefined) return undefined;
      // An explicit name map is authoritative: it is the only source of a
      // rendering for a name this game never translated anywhere.
      const explicit = typeof supplied[source] === "string" && supplied[source].length > 0 ? supplied[source] : "";
      const house = explicit ? { translated: true, house: explicit } : houseOf(index, source);
      if (!house.translated || house.house === "" || KANA.test(house.house)) return undefined;
      if (rendering === house.house) return undefined;
      // Two kinds of line are repairable without a judgement call: the name is
      // still kana, or it is the source name copied through unchanged (主婦,
      // 水泳部員). Both mean "this game does translate the name, this line just
      // did not" and the replacement already exists elsewhere in the dictionary.
      // Two different Chinese renderings are a style call, hence includeDrift.
      const untranslated = KANA.test(rendering) || rendering === source;
      if (!includeDrift && !untranslated) return undefined;
      changedHere = true;
      changedTags += 1;
      const id = source + "\u0000" + rendering + "\u0000" + house.house;
      const seen = touched.get(id);
      if (seen) seen.count += 1;
      else touched.set(id, { source, from: rendering, to: house.house, count: 1 });
      return house.house;
    });
    if (changedHere) {
      entry.text = next;
      changedEntries += 1;
    }
  }

  return { entries: changedEntries, tags: changedTags, names: [...touched.values()] };
}
