import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { collectScriptStrings } from "../src/engines/renpy/rpyscript.js";

/**
 * Read one fixture and run the extractor over it.
 *
 * @param {string} name fixture file name without the extension
 * @returns {{ strings: Array<{ text: string, kind: string, file: string, line: number }>, undecodable: number }}
 */
function fixture(name) {
  const url = new URL(`./fixtures/renpy-rpy/${name}.rpy`, import.meta.url);
  const source = readFileSync(fileURLToPath(url), "utf8");
  return collectScriptStrings(source, `game/${name}.rpy`);
}

/**
 * Reduce units to "kind|text" pairs so assertions stay readable.
 *
 * @param {Array<{ text: string, kind: string }>} strings
 * @returns {string[]}
 */
function pairs(strings) {
  return strings.map((unit) => `${unit.kind}|${unit.text}`);
}

test("collects say statements of every shape", () => {
  const { strings } = fixture("dialogue");
  const said = strings.filter((unit) => unit.kind === "say").map((unit) => unit.text);

  assert.deepEqual(said.slice(0, 11), [
    "A quiet room with a single lamp.",
    "Alpha line one.",
    "Beta line two.",
    "Gamma line three.",
    " Delta line four.",
    "Epsilon a\"quoted\" word.",
    "Zeta\\slash and a\\nnewline.",
    "Eta[[bracket] and {{brace} and 100%% done.",
    "Theta collapsed spacing.",
    "Iota speaks.",
    "Kappa speaks.",
  ]);
});

test("takes the dialogue and not the speaker name of a literal character line", () => {
  const { strings } = fixture("dialogue");
  const said = strings.filter((unit) => unit.kind === "say").map((unit) => unit.text);

  // `"Nora" "Sigma ..."` is one say statement whose character is a literal, so
  // only the second literal is readable text. The compiled form agrees: it
  // records the dialogue and drops the speaker name.
  assert.deepEqual(said.slice(-3), [
    "Sigma literal speaker line.",
    "Tau literal speaker with a clause.",
    "Upsilon literal speaker, nointeract.",
  ]);
  assert.ok(!said.includes("Nora"));
});

test("keeps a lone literal as narration rather than as a speaker name", () => {
  const result = collectScriptStrings('label start:\n    "Narration only."\n', "game/x.rpy");

  assert.deepEqual(result.strings.map((unit) => unit.text), ["Narration only."]);
  assert.equal(result.strings[0].kind, "say");
});

test("splits a literal character in a menu choice from its label", () => {
  const result = collectScriptStrings(
    ['label start:', '    menu:', '        "Nora" "Pick this one.":', '            jump a'].join("\n"),
    "game/x.rpy",
  );

  assert.deepEqual(result.strings.map((unit) => unit.text), ["Pick this one."]);
  assert.equal(result.strings[0].kind, "menu");
});

test("decodes escapes and collapses whitespace like the Ren'Py lexer", () => {
  const { strings } = fixture("dialogue");
  const byText = new Map(strings.map((unit) => [unit.text, unit]));

  // A backslash and the next character collapse to that character, except for
  // the three characters Ren'Py would otherwise read as markup.
  assert.ok(byText.has('Epsilon a"quoted" word.'));
  assert.ok(byText.has("Zeta\\slash and a\\nnewline."));
  assert.ok(byText.has("Eta[[bracket] and {{brace} and 100%% done."));

  // Unescaped runs of spaces and newlines become a single space.
  assert.ok(byText.has("Theta collapsed spacing."));
  assert.ok(!byText.has("Theta  collapsed   spacing."));
});

test("takes the caption and every choice label of a menu", () => {
  const { strings } = fixture("dialogue");
  const menu = strings.filter((unit) => unit.kind === "menu");

  assert.deepEqual(pairs(menu), [
    "menu|Lambda caption.",
    "menu|Mu choice one.",
    "menu|Nu choice two.",
    "menu|Xi choice three.",
  ]);
});

test("splits a monologue block at blank lines and reports each paragraph line", () => {
  const { strings } = fixture("dialogue");
  const paragraphs = strings.filter((unit) => unit.line >= 31 && unit.line <= 38);

  assert.deepEqual(
    paragraphs.map((unit) => [unit.line, unit.text]),
    [
      [32, "Omicron monologue paragraph one."],
      [34, "Pi monologue paragraph two wrapped over two source lines."],
      [37, "Rho monologue paragraph three."],
    ],
  );
});

test("reports the caller path verbatim and finds nothing undecodable", () => {
  const result = fixture("dialogue");

  assert.equal(result.undecodable, 0);
  assert.ok(result.strings.length > 0);
  for (const unit of result.strings) assert.equal(unit.file, "game/dialogue.rpy");
});

test("honours the _() translation marker in any position", () => {
  const { strings } = fixture("markers");
  const marked = strings.filter((unit) => unit.kind === "string").map((unit) => unit.text);

  assert.deepEqual(marked, [
    "Upsilon Marked Define",
    "Alpha marked dollar line",
    "Gamma marked dialogue",
    "Delta notified",
  ]);
});

test("keeps a plain dialogue line whose text merely contains marker punctuation", () => {
  const { strings } = fixture("markers");
  const said = strings.filter((unit) => unit.kind === "say").map((unit) => unit.text);

  // The parenthesis pair is not adjacent to the marker, so this is ordinary dialogue.
  assert.deepEqual(said, ["Beta dialogue with _ ( loose parens )"]);
});

test("skips define, default, image and python values that are not marked", () => {
  const { strings } = fixture("markers");
  const texts = strings.map((unit) => unit.text);

  for (const skipped of ["Tau Speaker", "Phi Default Name", "Psi forced local", "Omega python value"]) {
    assert.ok(!texts.includes(skipped), `expected ${skipped} to be skipped`);
  }
  // The only marked define is collected, the unmarked one is not.
  assert.ok(texts.includes("Upsilon Marked Define"));
});

test("collects screen text arguments and ignores paths and style values", () => {
  const { strings } = fixture("screens");
  const screen = strings.filter((unit) => unit.kind === "screen").map((unit) => unit.text);

  assert.deepEqual(screen, [
    "Alpha Screen Title",
    "Beta Start",
    "Delta Section",
    "Epsilon Hint",
    "Zeta Toast",
    "Eta [player_name] interpolated {b}bold{/b}",
    "Iota Second Text",
    "Kappa Hidden",
    "Lambda Other Screen",
  ]);

  const texts = strings.map((unit) => unit.text);
  assert.ok(!texts.includes("images/theta-button.png"));
  assert.ok(!texts.includes("title_style"));
});

test("treats a marked screen button like any other marker", () => {
  const { strings } = fixture("screens");
  const marked = strings.filter((unit) => unit.kind === "string").map((unit) => unit.text);

  assert.deepEqual(marked, ["Gamma Continue"]);
});

test("skips translate blocks, old and new statements, and style bodies", () => {
  const result = fixture("skipped");

  assert.deepEqual(result.strings, []);
  assert.equal(result.undecodable, 0);
});

test("survives an unterminated literal without throwing", () => {
  const result = fixture("unclosed");

  assert.equal(result.undecodable, 1);
  assert.deepEqual(result.strings.map((unit) => unit.text), ["Alpha closed line", "Beta closed line"]);
});

test("skips python blocks and dollar lines but keeps the dialogue around them", () => {
  const { strings } = fixture("pythonblocks");

  assert.deepEqual(strings.map((unit) => unit.text), ["Epsilon visible line", "Eta visible after block"]);
});

test("normalises CRLF line endings and a UTF-8 BOM", () => {
  const lf = collectScriptStrings('label start:\n    a "Alpha line."\n    "Beta line."\n', "game/x.rpy");
  const crlf = collectScriptStrings(
    '\ufefflabel start:\r\n    a "Alpha line."\r\n    "Beta line."\r\n',
    "game/x.rpy",
  );

  assert.deepEqual(pairs(crlf.strings), pairs(lf.strings));
  assert.deepEqual(
    crlf.strings.map((unit) => unit.line),
    [2, 3],
  );
});

test("accepts a Buffer as well as a string", () => {
  const source = Buffer.from('label start:\n    "Alpha line."\n', "utf8");
  const result = collectScriptStrings(source, "game/buffer.rpy");

  assert.deepEqual(result.strings, [
    { text: "Alpha line.", kind: "say", file: "game/buffer.rpy", line: 2 },
  ]);
});

test("returns every occurrence without de-duplicating", () => {
  const result = collectScriptStrings(
    'label start:\n    "Alpha repeat."\n    a "Alpha repeat."\n    "Alpha repeat."\n',
    "game/repeat.rpy",
  );

  assert.deepEqual(
    result.strings.map((unit) => unit.line),
    [2, 3, 4],
  );
  assert.equal(result.strings.length, 3);
});

test("ignores comments and blank lines", () => {
  const result = collectScriptStrings(
    [
      "# A comment with a \"quoted\" word inside.",
      "label start:",
      "",
      "    # An indented comment with a \"quoted\" word.",
      "    \"Alpha real line.\"",
      "",
      "    return",
      "",
    ].join("\n"),
    "game/comments.rpy",
  );

  assert.deepEqual(result.strings.map((unit) => unit.text), ["Alpha real line."]);
  assert.equal(result.undecodable, 0);
});

test("reads single quoted, backtick quoted and raw literals", () => {
  const result = collectScriptStrings(
    [
      "label start:",
      "    a 'Alpha single quoted.'",
      "    b \`Beta backtick quoted.\`",
      '    c r"Gamma raw \\n kept."',
      "    d \"Delta double quoted.\"",
    ].join("\n"),
    "game/quotes.rpy",
  );

  assert.deepEqual(result.strings.map((unit) => unit.text), [
    "Alpha single quoted.",
    "Beta backtick quoted.",
    "Gamma raw \\n kept.",
    "Delta double quoted.",
  ]);
});

test("keeps markup and interpolation untouched", () => {
  const result = collectScriptStrings(
    'label start:\n    a "Alpha {b}bold{/b} and [player_name] here."\n',
    "game/markup.rpy",
  );

  assert.deepEqual(result.strings.map((unit) => unit.text), ["Alpha {b}bold{/b} and [player_name] here."]);
});

test("drops empty literals", () => {
  const result = collectScriptStrings('label start:\n    a ""\n    "Alpha line."\n', "game/empty.rpy");

  assert.deepEqual(result.strings.map((unit) => unit.text), ["Alpha line."]);
  assert.equal(result.undecodable, 0);
});

test("does not treat an indented python assignment as dialogue", () => {
  const result = collectScriptStrings(
    ["label start:", "    python:", '        alpha = "Beta python value"', '    "Gamma visible line."'].join("\n"),
    "game/assign.rpy",
  );

  assert.deepEqual(result.strings.map((unit) => unit.text), ["Gamma visible line."]);
});
