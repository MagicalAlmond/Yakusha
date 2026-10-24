/**
 * Which strings inside a RPG Maker MZ project are shown to the player.
 *
 * The offline extractor, the installer and the runtime plugin all read these
 * tables, so a key produced offline is always the exact key looked up at
 * runtime. The tables are *data only* (no functions) because they are serialised
 * into the generated plugin.
 *
 * @module core/fields
 */

/**
 * Field paths inside each `data/*.json` database file.
 * Paths are dotted; `[]` means "every element".
 * @type {Record<string, string[]>}
 */
export const DB_FIELDS = {
  "Actors.json": ["name", "nickname", "profile"],
  "Classes.json": ["name"],
  "Skills.json": ["name", "description", "message1", "message2"],
  "Items.json": ["name", "description"],
  "Weapons.json": ["name", "description"],
  "Armors.json": ["name", "description"],
  "Enemies.json": ["name"],
  "States.json": ["name", "message1", "message2", "message3", "message4"],
  "Tilesets.json": ["name"],
  "CommonEvents.json": ["name"],
  "MapInfos.json": ["name"],
};

/**
 * Fields of `System.json` that a player can read.
 * @type {string[]}
 */
export const SYSTEM_FIELDS = [
  "gameTitle",
  "currencyUnit",
  "terms.basic[]",
  "terms.commands[]",
  "terms.params[]",
  "terms.messages",
  "armorTypes[]",
  "elements[]",
  "skillTypes[]",
  "weaponTypes[]",
  "equipTypes[]",
];

/**
 * Event command codes that carry player visible text and the `params` slot it
 * lives in. `"4"` means `params[4]`; `"0[]"` means every element of
 * `params[0]`.
 *
 * 101 Show Text      header, params[4] is the speaker name
 * 102 Show Choices   params[0] is the array of choice labels
 * 105 Scroll Text    header, the payload follows in 405
 * 320 Change Actor Name      params[1]
 * 324 Change Nickname        params[1]
 * 325 Change Profile         params[1]
 *
 * @type {ReadonlyArray<{ code: number, path: string|null }>}
 */
export const COMMAND_TEXT = [
  { code: 101, path: "4" },
  { code: 102, path: "0[]" },
  { code: 105, path: null },
  { code: 320, path: "1" },
  { code: 324, path: "1" },
  { code: 325, path: "1" },
  { code: 401, path: "0" },
  { code: 405, path: "0" },
];

/**
 * `{ "101": "4", ... }` ready to be embedded in the plugin rules blob.
 * @type {Record<string, string>}
 */
export const COMMAND_PATHS = Object.fromEntries(
  COMMAND_TEXT.filter((rule) => rule.path !== null).map((rule) => [String(rule.code), rule.path])
);

/** Set of codes we care about, for fast rejection. */
export const TEXT_CODES = new Set(COMMAND_TEXT.map((rule) => rule.code));

/**
 * Read the translatable strings a command carries, using a path spec.
 *
 * @param {any[]} params
 * @param {string} spec e.g. `"4"` or `"0[]"`
 * @returns {string[]}
 */
export function pickParams(params, spec) {
  if (!Array.isArray(params)) return [];
  if (spec.endsWith("[]")) {
    const value = params[Number(spec.slice(0, -2))];
    if (!Array.isArray(value)) return [];
    return value.filter((item) => typeof item === "string" && item.length > 0);
  }
  const value = params[Number(spec)];
  return typeof value === "string" && value.length > 0 ? [value] : [];
}

/**
 * Resolve a dotted path against an object, following `[]`.
 *
 * @param {any} obj
 * @param {string} dotted
 * @returns {string[]} every string found
 */
export function collectAt(obj, dotted) {
  const out = [];
  const walk = (node, parts) => {
    if (node === null || node === undefined) return;
    if (parts.length === 0) {
      if (Array.isArray(node)) {
        for (const value of node) if (typeof value === "string") out.push(value);
      } else if (typeof node === "string") {
        out.push(node);
      } else if (typeof node === "object") {
        for (const value of Object.values(node)) {
          if (typeof value === "string") out.push(value);
        }
      }
      return;
    }
    const head = parts[0];
    const rest = parts.slice(1);
    if (head.endsWith("[]")) {
      const value = node[head.slice(0, -2)];
      if (!Array.isArray(value)) return;
      for (const item of value) walk(item, rest);
      return;
    }
    if (typeof node !== "object") return;
    walk(node[head], rest);
  };
  walk(obj, dotted.split("."));
  return out;
}

/**
 * Yield `{ code, params }` pairs from any nested event command list.
 *
 * @param {any} node
 * @param {(cmd: { code: number, params: any[] }) => void} visit
 */
export function walkCommands(node, visit) {
  if (Array.isArray(node)) {
    for (const item of node) walkCommands(item, visit);
    return;
  }
  if (node === null || typeof node !== "object") return;
  if (typeof node.code === "number") {
    // RPG Maker stores the slots in `parameters`; `params` is tolerated so
    // hand written fixtures stay terse.
    const parameters = Array.isArray(node.parameters)
      ? node.parameters
      : Array.isArray(node.params)
        ? node.params
        : null;
    if (parameters && TEXT_CODES.has(node.code)) {
      visit({ code: node.code, params: parameters });
    }
    return;
  }
  for (const key of Object.keys(node)) walkCommands(node[key], visit);
}

/**
 * The complete rule blob embedded into the runtime plugin.
 *
 * @returns {{ dbFields: Record<string, string[]>, systemFields: string[], commands: Record<string, string> }}
 */
export function buildRules() {
  return {
    dbFields: { ...DB_FIELDS },
    systemFields: [...SYSTEM_FIELDS],
    commands: { ...COMMAND_PATHS },
  };
}