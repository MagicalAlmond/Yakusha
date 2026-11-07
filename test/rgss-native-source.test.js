/**
 * Guards on the two native sources that only ever run inside a game.
 *
 * Nothing here executes the file: `bootstrap.rb` is handed to RGSSEval, which
 * returns 0 and swallows syntax and encoding errors, and the injector runs in
 * another process where a failed LoadLibraryW surfaces only as "the hook DLL
 * could not be loaded". Both failures below cost a session each, so the rules
 * they broke are asserted here instead of being left to a comment.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const bootstrapPath = path.join(root, "native/rgss-hook/bootstrap.rb");
const injectorPath = path.join(root, "native/injector/src/main.rs");
const bootstrap = fs.readFileSync(bootstrapPath, "utf8");
const injector = fs.readFileSync(injectorPath, "utf8");

/** Lines of Ruby that are code, not comments, with their indentation. */
function codeLines(source) {
  return source.split("\n").map((text, index) => ({
    index,
    text,
    indent: text.match(/^\s*/)[0].length,
    trimmed: text.trim(),
  })).filter((line) => line.trimmed.length > 0 && !line.trimmed.startsWith("#"));
}

test("bootstrap re-tags the injected path as UTF-8 before any File call", () => {
  const lines = codeLines(bootstrap);
  const retag = lines.findIndex((line) => line.trimmed.includes("YAKUSHA_ROOT.dup"));
  assert.notEqual(retag, -1, "bootstrap should copy YAKUSHA_ROOT before re-tagging it");
  assert.match(lines[retag + 1].trimmed, /force_encoding\("UTF-8"\)/);

  const firstFile = lines.findIndex((line) => /\bFile\./.test(line.trimmed));
  assert.notEqual(firstFile, -1, "bootstrap is expected to read the dictionary with File");
  assert.ok(
    retag < firstFile,
    "the path is handed over as ASCII-8BIT, so it must be re-tagged before File.exist?/File.open " +
      "or every path with a non-ASCII character raises Encoding::UndefinedConversionError",
  );
});

test("bootstrap stays inside the Ruby 1.8/1.9 syntax the engines embed", () => {
  // Method-level rescue is Ruby 2.5+, safe navigation is 2.3+, and
  // define_singleton_method does not exist in 1.8. Comments may name them.
  const code = codeLines(bootstrap).map((line) => line.text).join("\n");
  assert.doesNotMatch(code, /define_singleton_method/);
  assert.doesNotMatch(code, /&\./);

  const lines = codeLines(bootstrap);
  let defIndent = null;
  let insideBegin = false;
  const offenders = [];
  for (const line of lines) {
    if (/^def\s/.test(line.trimmed)) {
      defIndent = line.indent;
      insideBegin = false;
      continue;
    }
    if (defIndent === null) continue;
    if (line.indent <= defIndent) {
      defIndent = null;
      insideBegin = false;
      continue;
    }
    if (line.trimmed === "begin") insideBegin = true;
    if (/^rescue\b/.test(line.trimmed) && !insideBegin) offenders.push(line.index + 1);
    if (line.trimmed === "end" && line.indent === defIndent + 2) insideBegin = false;
  }
  assert.deepEqual(
    offenders,
    [],
    "a rescue that belongs to the method body is Ruby 2.5+ syntax and makes the whole file a " +
      "silent syntax error; wrap it in begin/end",
  );
});

test("bootstrap reports that it started, as the last statement", () => {
  const lines = codeLines(bootstrap);
  assert.equal(lines.at(-1).trimmed, 'Yakusha.log("bootstrap ready")');
});

test("bootstrap installs the draw hook before it reports ready", () => {
  const lines = codeLines(bootstrap);
  const installed = lines.findIndex((line) => line.trimmed === "Yakusha.install_draw_hook");
  const ready = lines.findIndex((line) => line.trimmed === 'Yakusha.log("bootstrap ready")');
  assert.notEqual(installed, -1, "text a script draws never reaches load_data, so the draw hook must run");
  assert.ok(installed < ready, "the hook has to be in place before the game starts drawing");

  const code = lines.map((line) => line.text).join("\n");
  assert.match(code, /alias_method :yakusha_original_draw_text, :draw_text/);
  assert.match(code, /def self\.translate_drawn/);
  // A file label is built at draw time ("ファイル 11"), so one row for the
  // label has to cover every number appended to it.
  assert.match(code, /\[0-9\]\+\)\\z/);
});

test("the injector points the game at the hook folder before loading the DLL", () => {
  const directed = injector.indexOf("remote_call(&process, set_dll_directory");
  const loaded = injector.indexOf("remote_call(&process, load_library");
  assert.notEqual(directed, -1, "the injector should call SetDllDirectoryW in the game process");
  assert.notEqual(loaded, -1, "the injector should call LoadLibraryW in the game process");
  assert.ok(
    directed < loaded,
    "Windows resolves a DLL's own imports through the application directory, so libunwind.dll " +
      "next to the hook is only found if SetDllDirectoryW runs first",
  );
});

test("the injector kills a game it fails to inject into", () => {
  assert.match(injector, /fn fail_process/);
  assert.match(injector, /TerminateProcess/);
});