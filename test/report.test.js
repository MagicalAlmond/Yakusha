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

import { buildReport, buildSarif, codeSpan, namesNeedingInput } from "../src/pipeline/report.js";
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

test("report: the markdown verdict follows the --fail-on gate", () => {
  const result = verifyResult([
    { kind: "width", severity: "warn", key: "a", target: "b", detail: "32 columns, wider than 30" },
  ]);
  const markdown = buildReport(result, { maxColumns: 30, failOn: "warning" });
  assert.match(markdown, /\| fail-on \| warning \|/);
  assert.match(markdown, /\*\*FAILED: 1 warning\(s\) under --fail-on warning\*\*/);
  // The same result under the default gate is still reported as OK.
  assert.match(buildReport(result, { maxColumns: 30 }), /\*\*OK with 1 warning\(s\)\*\*/);
});

test("report: --require-complete fails a clean but unfinished run", () => {
  const result = verifyResult([], { pending: 2, translated: 1, total: 3 });
  const markdown = buildReport(result, { requireComplete: true });
  assert.match(markdown, /\| require-complete \| yes \|/);
  assert.match(markdown, /\*\*FAILED: 2 pending entries under --require-complete\*\*/);
  // Without the flag the same dictionary is still a clean report.
  assert.match(buildReport(result, {}), /\*\*OK\*\* - no findings at all\./);
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

test("report: SARIF names the tool, the rules and every finding", () => {
  const result = verifyResult([
    { kind: "echo", severity: "error", key: "こんにちは", target: "こんにちは", detail: "target is identical to a Japanese source" },
    { kind: "kana", severity: "warn", key: "はい", target: "是ッ", detail: "Japanese kana left in the translation" },
  ]);
  const text = buildSarif(result, {
    game: "test game",
    file: "D:/games/x/yakusha/dictionary.json",
    maxColumns: 30,
    generatedAt: "2026-01-02T03:04:05.000Z",
  });
  const document = JSON.parse(text);
  assert.equal(document.version, "2.1.0");
  assert.equal(document.runs.length, 1);
  const run = document.runs[0];
  assert.equal(run.tool.driver.name, "yakusha");
  assert.equal(run.tool.driver.rules.length, 2);
  // The blocking kind comes first, same order as the markdown report.
  assert.equal(run.tool.driver.rules[0].id, "yakusha/verify/echo");
  assert.equal(run.tool.driver.rules[0].defaultConfiguration.level, "error");
  assert.equal(run.tool.driver.rules[1].id, "yakusha/verify/kana");
  assert.equal(run.tool.driver.rules[1].defaultConfiguration.level, "warning");
  assert.equal(run.results.length, 2);
  assert.equal(run.results[0].ruleId, "yakusha/verify/echo");
  assert.equal(run.results[0].level, "error");
  assert.match(run.results[0].message.text, /identical to a Japanese source/);
  assert.equal(run.results[0].locations[0].physicalLocation.artifactLocation.uri, "file:///D:/games/x/yakusha/dictionary.json");
  assert.equal(run.results[0].locations[0].logicalLocations[0].fullyQualifiedName, "こんにちは");
  assert.equal(run.results[0].partialFingerprints["yakusha/v1"].length, 32);
  assert.equal(run.results[1].level, "warning");
  assert.equal(run.invocations[0].executionSuccessful, false);
  assert.equal(run.invocations[0].properties.errors, 1);
});

test("report: SARIF records a warning-only run as failed under --fail-on warning", () => {
  const result = verifyResult([
    { kind: "kana", severity: "warn", key: "はい", target: "是ッ", detail: "Japanese kana left in the translation" },
  ]);
  const relaxed = JSON.parse(buildSarif(result, { game: "test game" }));
  assert.equal(relaxed.runs[0].invocations[0].executionSuccessful, true);
  assert.equal(relaxed.runs[0].invocations[0].properties.failOn, "error");

  const strict = JSON.parse(buildSarif(result, { game: "test game", failOn: "warning" }));
  assert.equal(strict.runs[0].invocations[0].executionSuccessful, false);
  assert.equal(strict.runs[0].invocations[0].properties.failOn, "warning");
  assert.equal(strict.runs[0].results[0].level, "warning");
});

test("report: SARIF records an incomplete run under --require-complete", () => {
  const result = verifyResult([], { pending: 2, translated: 1, total: 3 });
  const document = JSON.parse(buildSarif(result, { game: "test game", requireComplete: true }));
  const invocation = document.runs[0].invocations[0];
  assert.equal(invocation.executionSuccessful, false);
  assert.equal(invocation.properties.requireComplete, true);
  assert.equal(invocation.properties.pending, 2);
  assert.deepEqual(document.runs[0].results, []);
});

test("report: SARIF is still valid with no findings", () => {
  const document = JSON.parse(buildSarif(verifyResult([]), { game: "clean" }));
  assert.equal(document.version, "2.1.0");
  assert.deepEqual(document.runs[0].results, []);
  assert.deepEqual(document.runs[0].tool.driver.rules, []);
  assert.equal(document.runs[0].invocations[0].executionSuccessful, true);
});
