// Recent projects: the last few folders scanned successfully.
//
// This file is a classic script, like delivery.js: the renderer loads it with
// a plain <script> tag, and the renderer tests load it in a vm context. It
// only touches the storage object passed in, so a broken or disabled
// localStorage never prevents the GUI from starting.

var YAKUSHA_RECENT = (function () {
  var KEY = "yakusha.recent.v1";
  var LIMIT = 5;

  function cleanEntry(entry) {
    if (!entry || typeof entry.root !== "string") return null;
    var root = entry.root.trim();
    if (!root) return null;
    return {
      root: root,
      engine: typeof entry.engine === "string" ? entry.engine : "",
      title: typeof entry.title === "string" ? entry.title : "",
    };
  }

  function read(storage) {
    if (!storage || typeof storage.getItem !== "function") return [];
    var raw = null;
    try { raw = storage.getItem(KEY); } catch (error) { return []; }
    if (!raw) return [];
    var parsed = null;
    try { parsed = JSON.parse(raw); } catch (error) { return []; }
    if (!Array.isArray(parsed)) return [];
    var seen = Object.create(null);
    var list = [];
    for (var i = 0; i < parsed.length; i += 1) {
      var entry = cleanEntry(parsed[i]);
      if (!entry) continue;
      var key = entry.root.toLowerCase();
      if (seen[key]) continue;
      seen[key] = true;
      list.push(entry);
      if (list.length >= LIMIT) break;
    }
    return list;
  }

  function add(storage, entry) {
    var next = cleanEntry(entry);
    if (!next || !storage || typeof storage.setItem !== "function") return read(storage);
    var key = next.root.toLowerCase();
    var rest = read(storage).filter(function (item) {
      return item.root.toLowerCase() !== key;
    });
    var list = [next].concat(rest).slice(0, LIMIT);
    try { storage.setItem(KEY, JSON.stringify(list)); } catch (error) { /* best effort */ }
    return list;
  }

  return Object.freeze({ KEY: KEY, LIMIT: LIMIT, read: read, add: add });
})();
