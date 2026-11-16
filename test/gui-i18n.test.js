import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const I18N = fs.readFileSync(path.join(ROOT, "gui", "renderer", "i18n.js"), "utf8");
const HTML = fs.readFileSync(path.join(ROOT, "gui", "renderer", "index.html"), "utf8");

function load(options = {}) {
  const context = vm.createContext({ navigator: options.navigator });
  vm.runInContext(I18N, context, { filename: "i18n.js" });
  return context.YAKUSHA_I18N;
}

function storage(values = {}) {
  return { getItem: (key) => (key in values ? values[key] : null) };
}

test("English and Chinese expose the same non-empty keys", () => {
  const i18n = load();
  const en = Object.keys(i18n.STRINGS.en).sort();
  const zh = Object.keys(i18n.STRINGS.zh).sort();
  assert.deepEqual(zh, en);
  for (const key of en) {
    assert.equal(typeof i18n.STRINGS.en[key], "string", key);
    assert.ok(i18n.STRINGS.en[key].length > 0, key);
    assert.equal(typeof i18n.STRINGS.zh[key], "string", key);
    assert.ok(i18n.STRINGS.zh[key].length > 0, key);
  }
});

test("every static data-i18n attribute has a translation", () => {
  const i18n = load();
  const keys = [...HTML.matchAll(/data-i18n(?:-title|-aria-label|-placeholder)?="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(keys.length > 100);
  for (const key of new Set(keys)) {
    assert.ok(Object.hasOwn(i18n.STRINGS.en, key), "missing English key: " + key);
    assert.ok(Object.hasOwn(i18n.STRINGS.zh, key), "missing Chinese key: " + key);
  }
});

test("t interpolates, falls back to English, then to the key", () => {
  const i18n = load();
  assert.equal(i18n.t("project.root", { root: "C:/games/alpha" }), "Project root: C:/games/alpha");
  i18n.setLanguage("zh");
  assert.equal(i18n.t("project.root", { root: "C:/games/alpha" }), "项目根目录：C:/games/alpha");
  assert.equal(i18n.t("missing.key"), "missing.key");
});

test("detect prefers the saved language and then the browser language", () => {
  assert.equal(load().detect(storage({ "yakusha.lang": "zh" })), "zh");
  assert.equal(load().detect(storage({ "yakusha.lang": "en" })), "en");
  assert.equal(load({ navigator: { language: "zh-CN" } }).detect(storage()), "zh");
  assert.equal(load({ navigator: { language: "ja-JP" } }).detect(storage()), "en");
  assert.equal(load().detect(storage()), "en");
});

test("apply translates text, titles, aria labels and placeholders", () => {
  const i18n = load();
  const nodes = [
    { dataset: { i18n: "nav.overview" }, textContent: "" },
    { dataset: { i18nTitle: "rail.collapse" }, title: "" },
    { dataset: { i18nAriaLabel: "progress.aria" }, setAttribute(name, value) { this[name] = value; } },
    { dataset: { i18nPlaceholder: "settings.language" }, placeholder: "" },
  ];
  const root = {
    querySelectorAll(selector) {
      if (selector === "[data-i18n]") return [nodes[0]];
      if (selector === "[data-i18n-title]") return [nodes[1]];
      if (selector === "[data-i18n-aria-label]") return [nodes[2]];
      if (selector === "[data-i18n-placeholder]") return [nodes[3]];
      return [];
    },
  };
  i18n.setLanguage("zh");
  i18n.apply(root);
  assert.equal(nodes[0].textContent, "总览");
  assert.equal(nodes[1].title, "收起侧栏");
  assert.equal(nodes[2]["aria-label"], "进度");
  assert.equal(nodes[3].placeholder, "界面语言");
});
