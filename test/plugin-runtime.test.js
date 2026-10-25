import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

import { renderPlugin } from "../src/core/install.js";

/**
 * Run the generated plugin inside a sandbox that mimics just enough of the MZ
 * runtime: PluginManager.parameters, DataManager.onXhrLoad and window.
 *
 * This is the closest we can get to the real engine without launching a game,
 * and it exercises the exact source the installer writes to disk.
 */
function runPlugin(dictionary, options = {}) {
  const source = renderPlugin({ embed: dictionary });
  const calls = [];
  const context = {
    console: { warn: (m) => calls.push(m), log: () => {} },
    PluginManager: { parameters: () => options.params || {} },
    DataManager: {
      onXhrLoad(xhr, name, src, url) {
        this.last = { name, src, url };
      },
    },
    window: {},
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "YAKUSHA_Translator.js" });
  return { context, api: context.window.__YAKUSHA, calls };
}

/** Deliver a data file the way the engine would. */
function load(context, name, src, data) {
  context.window[name] = data;
  context.DataManager.onXhrLoad({ status: 200 }, name, src, "data/" + src);
}

test("the plugin installs its hook and exposes window.__YAKUSHA", () => {
  const { context, api } = runPlugin({});
  assert.ok(api, "window.__YAKUSHA missing");
  assert.equal(api.version, "0.9.0");
  assert.equal(typeof api.translate, "function");
  assert.equal(typeof api.translateDocument, "function");
  assert.ok(api.rules.dbFields["Actors.json"]);
  assert.equal(context.DataManager.onXhrLoad.toString().includes("translateDocument"), true);
});

test("database fields are translated in place", () => {
  const { context } = runPlugin({ "アリア": "阿莉亚", "ポーション": "药水", "HPを50回復する。": "回复50点HP。" });
  const actors = [null, { id: 1, name: "アリア", nickname: "フェイ", profile: "" }];
  const items = [null, { id: 1, name: "ポーション", description: "HPを50回復する。" }];
  load(context, "$dataActors", "Actors.json", actors);
  load(context, "$dataItems", "Items.json", items);
  assert.equal(actors[1].name, "阿莉亚");
  assert.equal(actors[1].nickname, "フェイ");
  assert.equal(items[1].name, "药水");
  assert.equal(items[1].description, "回复50点HP。");
});

test("System.json paths are translated including arrays and objects", () => {
  const system = {
    gameTitle: "テストゲーム",
    terms: { basic: ["レベル", "Lv"], messages: { alwaysDash: "常時ダッシュ" } },
    armorTypes: ["", "軽装"],
  };
  const { context } = runPlugin({
    "テストゲーム": "测试游戏",
    "レベル": "等级",
    "常時ダッシュ": "常时冲刺",
    "軽装": "轻装",
  });
  load(context, "$dataSystem", "System.json", system);
  assert.equal(system.gameTitle, "测试游戏");
  assert.equal(system.terms.basic[0], "等级");
  assert.equal(system.terms.basic[1], "Lv");
  assert.equal(system.terms.messages.alwaysDash, "常时冲刺");
  assert.equal(system.armorTypes[1], "轻装");
});

test("event commands are translated for maps, common events and troops", () => {
  const { context } = runPlugin({
    "おっさん": "大叔",
    "お金が足りない！": "没钱了！",
    "はい": "是",
    "いいえ": "否",
    "酒場": "酒馆",
  });
  const map = {
    displayName: "酒場",
    events: [null, { pages: [{ list: [
      { code: 101, indent: 0, parameters: ["", 0, 0, 2, "おっさん"] },
      { code: 401, indent: 0, parameters: ["お金が足りない！"] },
      { code: 102, indent: 0, parameters: [["はい", "いいえ"], 1, 0, 2, 0] },
      { code: 117, indent: 0, parameters: [{ name: "おっさん" }] },
      { code: 0, indent: 0, parameters: [] },
    ] }] }],
  };
  const common = [null, { id: 1, list: [
    { code: 401, indent: 0, parameters: ["お金が足りない！"] },
    { code: 0, indent: 0, parameters: [] },
  ] }];
  load(context, "$dataMap", "Map001.json", map);
  load(context, "$dataCommonEvents", "CommonEvents.json", common);

  assert.equal(map.displayName, "酒馆");
  const list = map.events[1].pages[0].list;
  assert.equal(list[0].parameters[4], "大叔");
  assert.equal(list[1].parameters[0], "没钱了！");
  assert.deepEqual(list[2].parameters[0], ["是", "否"]);
  // code 117 is not a text command: its payload must stay untouched
  assert.deepEqual(list[3].parameters, [{ name: "おっさん" }]);
  assert.equal(common[1].list[0].parameters[0], "没钱了！");
});

test("choices are translated as a whole array, not element by element", () => {
  const { context } = runPlugin({ "はい": "是" });
  const map = { events: [null, { pages: [{ list: [
    { code: 102, indent: 0, parameters: [["はい", "いいえ"], 1, 0, 2, 0] },
  ] }] }] };
  load(context, "$dataMap", "Map001.json", map);
  const params = map.events[1].pages[0].list[0].parameters;
  assert.deepEqual(params[0], ["是", "いいえ"]);
  assert.equal(params[1], 1, "non text slots must not be touched");
});

test("escape codes are preserved and mismatches are rejected", () => {
  const { context, api } = runPlugin({
    "本当に\\C[2]足りない\\C[0]のか？": "真的\\C[2]没有\\C[0]吗？",
    "色だけ\\C[6]": "只有颜色", // translation dropped the code on purpose
  });
  const map = { events: [null, { pages: [{ list: [
    { code: 401, indent: 0, parameters: ["本当に\\C[2]足りない\\C[0]のか？"] },
    { code: 401, indent: 0, parameters: ["色だけ\\C[6]"] },
  ] }] }] };
  load(context, "$dataMap", "Map001.json", map);
  const list = map.events[1].pages[0].list;
  assert.equal(list[0].parameters[0], "真的\\C[2]没有\\C[0]吗？");
  assert.equal(list[1].parameters[0], "色だけ\\C[6]", "strict mode must keep the source");
  assert.equal(api.stats().rejected, 1);
});

test("strict mode can be switched off", () => {
  const source = renderPlugin({ embed: { "色だけ\\C[6]": "只有颜色" } });
  const context = {
    console: { warn() {}, log() {} },
    PluginManager: { parameters: () => ({ strictCodes: "false" }) },
    DataManager: { onXhrLoad() {} },
    window: {},
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  const map = { events: [{ pages: [{ list: [{ code: 401, indent: 0, parameters: ["色だけ\\C[6]"] }] }] }] };
  context.window.$dataMap = map;
  context.DataManager.onXhrLoad({}, "$dataMap", "Map001.json");
  assert.equal(map.events[0].pages[0].list[0].parameters[0], "只有颜色");
});

test("unknown strings are left alone", () => {
  const { context, api } = runPlugin({ "ポーション": "药水" });
  const items = [null, { id: 1, name: "ポーション" }, { id: 2, name: "エリクサー" }];
  load(context, "$dataItems", "Items.json", items);
  assert.equal(items[1].name, "药水");
  assert.equal(items[2].name, "エリクサー");
  assert.ok(api.stats().misses >= 1);
});

test("normalised keys catch width and spacing differences", () => {
  const { context } = runPlugin({ "ＡＢＣ　テスト": "ABC 测试" });
  const items = [null, { id: 1, name: "ABC テスト" }];
  load(context, "$dataItems", "Items.json", items);
  assert.equal(items[1].name, "ABC 测试");
});

test("Test_ files reuse the base file rules", () => {
  const { context } = runPlugin({ "お金が足りない！": "没钱了！" });
  const data = [null, { id: 1, list: [{ code: 401, indent: 0, parameters: ["お金が足りない！"] }] }];
  load(context, "$dataCommonEvents", "Test_CommonEvents.json", data);
  assert.equal(data[1].list[0].parameters[0], "没钱了！");
});

test("a malformed document does not throw", () => {
  const { context } = runPlugin({ a: "b" });
  assert.doesNotThrow(() => load(context, "$dataMap", "Map001.json", { events: "nonsense" }));
  assert.doesNotThrow(() => load(context, "$dataMap", "Map002.json", null));
});
/**
 * MV has no DataManager.onXhrLoad: loadDataFile parses and assigns inside its
 * own XHR callback, then calls onLoad. The plugin must hook that pair instead,
 * otherwise every MV game silently stays in Japanese.
 */
function runMvPlugin(dictionary) {
  const source = renderPlugin({ embed: dictionary });
  const context = {
    console: { warn() {}, log() {} },
    PluginManager: { parameters: () => ({}) },
    DataManager: {
      loadDataFile(name, src) {
        // Stand-in for the XHR callback that MV runs later.
        this._pending = { name, src };
      },
      onLoad() {},
    },
    window: {},
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context);
  /** Deliver a file the way MV's XHR callback would. */
  context.MVload = (name, src, data) => {
    context.DataManager.loadDataFile(name, src);
    context.window[name] = data;
    context.DataManager.onLoad(data);
  };
  return context;
}

test("MV games are hooked through loadDataFile plus onLoad", () => {
  const context = runMvPlugin({ "ポーション": "药水", "お金が足りない！": "没钱了！" });
  const items = [null, { id: 1, name: "ポーション" }];
  context.MVload("$dataItems", "Items.json", items);
  assert.equal(items[1].name, "药水");
  assert.equal(context.window.__YAKUSHA.stats().hookInstalled, true);

  // Map files come through the same route and must be translated too.
  const map = { displayName: "", events: [null, { pages: [{ list: [
    { code: 401, indent: 0, parameters: ["お金が足りない！"] },
  ] }] }] };
  context.MVload("$dataMap", "Map001.json", map);
  assert.equal(map.events[1].pages[0].list[0].parameters[0], "没钱了！");
});

test("the MV hook matches by object identity, not by arrival order", () => {
  const context = runMvPlugin({ "ポーション": "药水", "エリクサー": "圣水" });
  const items = [null, { id: 1, name: "ポーション" }];
  const skills = [null, { id: 1, name: "エリクサー", description: "" }];
  // Declare both requests first, then deliver them out of order.
  context.DataManager.loadDataFile("$dataItems", "Items.json");
  context.DataManager.loadDataFile("$dataSkills", "Skills.json");
  context.window.$dataSkills = skills;
  context.DataManager.onLoad(skills);
  context.window.$dataItems = items;
  context.DataManager.onLoad(items);
  assert.equal(skills[1].name, "圣水");
  assert.equal(items[1].name, "药水");
});

