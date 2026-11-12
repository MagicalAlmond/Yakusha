/**
 * Delivery tier copy for the GUI.
 *
 * This file is a classic script on purpose: the renderer is not a module
 * (gui/renderer/index.html keeps the same simple load order), so the map is
 * exposed as a global for renderer.js and for the DOM contract tests. Keep the
 * keys aligned with src/engines/contract.js CAPABILITY_KEYS.runtime; every
 * runtime value observed by scan has exactly one tier here.
 *
 * The wording follows docs/gui.md §6 and docs/dev/ENGINE-STRATEGY.md §5.5:
 * the GUI must state what install writes and how uninstall restores it, never
 * "fully reversible".
 */

var YAKUSHA_DELIVERY_TIERS = Object.freeze({
  plugin: Object.freeze({
    key: "L4-plugin",
    title: "Plugin layer",
    summary: "Install backs up js/plugins.js and writes the yakusha plugin entry; uninstall restores the backup byte for byte.",
    caution: "If js/plugins.js has drifted, uninstall removes only the yakusha entry and keeps the backup.",
  }),
  translation: Object.freeze({
    key: "L4-resource",
    title: "Translation resource",
    summary: "Install writes the engine's own translation resource; deleting that resource restores the original text.",
    caution: "",
  }),
  inject: Object.freeze({
    key: "L4-inject",
    title: "Native components",
    summary: "Install copies the packaged native components into yakusha/native/ after checking manifest.json; game files are not modified. Uninstall removes the folder and the game still runs.",
    caution: "The components are not code-signed, so antivirus software may flag them.",
  }),
  patch: Object.freeze({
    key: "L4-patch",
    title: "Overlay archive",
    summary: "Install writes an overlay archive the engine loads (an archive plus a manifest); deleting it restores the original. The original archive is never modified.",
    caution: "",
  }),
  none: Object.freeze({
    key: "L3-only",
    title: "No delivery layer",
    summary: "This engine supports extract, translate, and verify. The translated text has to be deployed manually.",
    caution: "",
  }),
});
