/**
 * Tests for the markdown report.
 *
 * The report is the only part of verify whose output leaves the terminal, so
 * the tests pin what a reader depends on: the verdict, the counts, one section
 * per kind with errors first, and the "fill in these names" block that turns an
 * unfixable finding into something the user can act on.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { buildReport, codeSpan, namesNeedingInput } from "../src/pipeline/report.js";
import { verifyDictionary } from "../src/pipeline/verify.js";

/** @param {Record<string, {text?: string}>} entries */
function dictionary(entries) {
  return { format: "yakusha/1", game: "test", updatedAt: new Date(0).toISOString(), entries };
}

/** A source line carrying one speaker tag, the shape real MZ games use. */
function line(name, body) {
  return "<" + name + ">“" + body + "”";
}

/** Build the subset of VerifyResult that buildReport reads. */
function verifyResult(problems, overrides = {}) {
  const counts = {};
  for (const problem of problems) counts[problem.kind] = (counts[problem.kind] || 0) + 1;
  return {
    total: 3,
    translated: 2,
    pending: 1,
    rejected: 0,
    problems,
    counts,
    errors: problems.filter((problem) => problem.severity === "error").length,
    warnings: problems.filter((problem) => problem.severity === "warn").length,
    ...overrides,
  };
}

test("report: code spans stay one line and survive backticks", () => {
  assert.equal(codeSpan("こんにちは"), "`こんにちは`");
  assert.equal(codeSpan(""), "");
  // A newline would split the finding in two; the marker keeps it visible.
  assert.equal(codeSpan("first\nsecond"), "`first⏎second`");
  // One backtick needs a two-backtick fence, two would need three.
  assert.equal(codeSpan("a`b"), "``a`b``");
  assert.equal(codeSpan("`a"), "`` `a ``");
});

test("report: a failed run leads with the verdict and one section per kind", () => {
  const result = verifyResult([
    { kind: "echo", severity: "error", key: "こんにちは", target: "こんにちは", detail: "translation is identical to the source" },
    { kind: "kana", severity: "warn", key: "はい", target: "是ッ", detail: "kana left in the translation" },
  ]);
  const markdown = buildReport(result, { game: "test game", maxColumns: 30, generatedAt: "2026-01-02T03:04:05.000Z" });
  assert.match(markdown, /# yakusha verify report/);
  assert.match(markdown, /\| game \| test game \|/);
  assert.match(markdown, /\| max-length \| 30 columns \|/);
  assert.match(markdown, /\| entries \| 3 \(2 translated, 1 pending, 0 rejected\) \|/);
  assert.match(markdown, /\*\*FAILED: 1 error\(s\)\*\*/);
  // echo blocks a release, kana does not, so echo comes first even though the
  // two kinds have the same number of findings.
  assert.ok(markdown.indexOf("## echo") >= 0);
  assert.ok(markdown.indexOf("## echo") < markdown.indexOf("## kana"));
  assert.match(markdown, /1\. \*\*error\*\*: `こんにちは` -> `こんにちは`/);
  assert.match(markdown, /1\. warning: `はい` -> `是ッ`/);
  assert.match(markdown, /translation is identical to the source/);
});

test("report: a clean run still produces a report", () => {
  const markdown = buildReport(verifyResult([]), { game: "test game" });
  assert.match(markdown, /\*\*OK\*\* - no findings at all\./);
  assert.match(markdown, /\| problems \| 0 \(0 errors, 0 warnings\) \|/);
  assert.doesNotMatch(markdown, /## speaker names/);
});

test("report: warnings alone say nothing blocks a release", () => {
  const result = verifyResult([
    { kind: "width", severity: "warn", key: "a", target: "b", detail: "32 columns, wider than 30" },
  ]);
  const markdown = buildReport(result, { maxColumns: 30 });
  assert.match(markdown, /\*\*OK with 1 warning\(s\)\*\* - nothing blocks a release\./);
});

test("report: the names section asks only for names no line translated", () => {
  const data = dictionary({
    [line("水泳部員", "a")]: { text: line("水泳部員", "a") },
    [line("水泳部員", "b")]: { text: line("水泳部員", "b") },
  });
  const result = verifyDictionary(data);
  assert.equal(result.counts.speaker, 2);
  assert.deepEqual(namesNeedingInput(result, data), [{ name: "水泳部員", count: 2 }]);
  const markdown = buildReport(result, { game: "test game", root: "D:/games/x", dictionary: data });
  assert.match(markdown, /## speaker names with no rendering anywhere \(1\)/);
  assert.match(markdown, /- `水泳部員` \(2\)/);
  assert.match(markdown, /"水泳部員": ""/);
  assert.match(markdown, /yakusha speaker "D:\/games\/x" --names names\.json/);
});

test("report: a name the dictionary renders elsewhere is not asked for", () => {
  const data = dictionary({
    [line("ひなた", "a")]: { text: line("日向", "a") },
    [line("ひなた", "b")]: { text: line("ひなた", "b") },
  });
  const result = verifyDictionary(data);
  assert.equal(result.counts.speaker, 1);
  // speaker can copy 日向 here, so no human input is needed.
  assert.deepEqual(namesNeedingInput(result, data), []);
  assert.doesNotMatch(buildReport(result, { dictionary: data }), /## speaker names/);
});
