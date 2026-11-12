#!/usr/bin/env node
/**
 * Batch regression over a corpus of real games.
 *
 * The manifest is external (never committed): it lists one entry per game with
 * an absolute root and the outcome we expect from a scan. The tool walks the
 * list, runs the same command layer the CLI uses, and writes a machine readable
 * report plus a markdown table. Two rules make it safe to point at a real
 * library:
 *
 * - scan runs against the real directory and only reads it;
 * - every step that writes (extract, translate, verify need a dictionary)
 *   runs against a thin mirror: real directories plus hard links to the files.
 *   No junction, no copy, and never a write outside the mirror. A mirror that
 *   cannot be linked (another volume) is a hard error: pass --work on the same
 *   volume as the games.
 *
 *   node tools/corpus.mjs --manifest corpus.json [--out DIR] [--only a,b]
 *   node tools/corpus.mjs --manifest corpus.json --work DIR --deep \
 *        --steps scan,extract,translate,verify
 *
 * Exit codes: 0 every game matched its expectation, 1 at least one did not,
 * 2 usage or manifest error.
 */
import fs from "node:fs";
import path from "node:path";
import { runCommand } from "../src/cli/runner.js";

const ENGINES = new Set(["mv", "mz", "krkr", "rgss", "renpy"]);
const STEPS = ["scan", "extract", "translate", "verify"];
const EXPECTS = new Set(["ok", "unreadable"]);
/** Media never carries text we translate; skipping it keeps mirrors small. */
const SKIP_EXT = new Set([
  ".ogg", ".mp3", ".wav", ".flac", ".png", ".jpg", ".jpeg", ".webp", ".mp4", ".webm",
  ".avi", ".ttf", ".otf", ".woff", ".woff2", ".m4a",
]);
const SKIP_DIRS = new Set([
  "audio", "img", "images", "movies", "movie", "voice", "se", "bgm", "save", "saves",
  "yakusha", "node_modules", ".git",
]);

const USAGE = `usage: node tools/corpus.mjs --manifest <file.json> [options]

  --manifest <file>   corpus manifest (required, external to the repo)
  --out <dir>         report directory (default: <work>/out)
  --work <dir>        scratch directory for thin mirrors; must be on the same
                      volume as the games
  --deep              build a thin mirror per game and run the steps below on
                      it; required for anything beyond scan
  --steps <list>      comma separated subset of scan,extract,translate,verify
                      (default: scan)
  --only <id,id>      run just these game ids
  --json              print the report as JSON instead of human lines
  --help              show this text

exit codes: 0 all matched, 1 a mismatch, 2 usage or manifest error`;

class UsageError extends Error {}

function parseArgs(argv) {
  const opts = { manifest: null, out: null, work: null, deep: false, steps: "scan", only: null, json: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    const inline = eq === -1 ? null : arg.slice(eq + 1);
    const take = () => {
      if (inline !== null) return inline;
      i += 1;
      if (i >= argv.length) throw new UsageError("missing value for " + name);
      return argv[i];
    };
    if (name === "--help" || name === "-h") opts.help = true;
    else if (name === "--manifest") opts.manifest = take();
    else if (name === "--out") opts.out = take();
    else if (name === "--work") opts.work = take();
    else if (name === "--steps") opts.steps = take();
    else if (name === "--only") opts.only = take();
    else if (name === "--deep") opts.deep = true;
    else if (name === "--json") opts.json = true;
    else throw new UsageError("unknown option: " + arg);
  }
  return opts;
}

/** Read and validate the manifest; every message names the offending field. */
function loadManifest(file) {
  let raw;
  try {
    raw = fs.readFileSync(path.resolve(file), "utf8");
  } catch (err) {
    throw new UsageError("cannot read manifest " + file + ": " + err.message);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new UsageError("manifest is not valid JSON: " + err.message);
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new UsageError("manifest must be a JSON object");
  }
  if (data.schema !== 1) throw new UsageError("manifest.schema must be 1, got " + JSON.stringify(data.schema));
  if (!Array.isArray(data.games)) throw new UsageError("manifest.games must be an array");
  if (data.games.length === 0) throw new UsageError("manifest.games is empty");
  const seen = new Set();
  const games = data.games.map((entry, index) => {
    const at = "games[" + index + "]";
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new UsageError(at + " must be an object");
    }
    if (typeof entry.id !== "string" || entry.id.trim() === "") throw new UsageError(at + ".id must be a non-empty string");
    if (seen.has(entry.id)) throw new UsageError(at + ".id is duplicated: " + entry.id);
    seen.add(entry.id);
    if (!ENGINES.has(entry.engine)) {
      throw new UsageError(at + ".engine must be one of " + [...ENGINES].join(", ") + ", got " + JSON.stringify(entry.engine));
    }
    if (typeof entry.root !== "string" || entry.root.trim() === "") throw new UsageError(at + ".root must be a non-empty string");
    if (!path.isAbsolute(entry.root)) throw new UsageError(at + ".root must be an absolute path: " + entry.root);
    let stat = null;
    try {
      stat = fs.statSync(entry.root);
    } catch {
      stat = null;
    }
    if (!stat || !stat.isDirectory()) throw new UsageError(at + ".root is not a directory: " + entry.root);
    const expect = entry.expect === undefined ? "ok" : entry.expect;
    if (!EXPECTS.has(expect)) {
      throw new UsageError(at + ".expect must be ok or unreadable, got " + JSON.stringify(entry.expect));
    }
    return { id: entry.id, engine: entry.engine, root: path.resolve(entry.root), expect };
  });
  return games;
}

function sameVolume(a, b) {
  const left = path.parse(a).root.toLowerCase();
  const right = path.parse(b).root.toLowerCase();
  return left === right;
}

function inside(parent, child) {
  const rel = path.relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** Plan a mirror: directories plus hard links, media and saves left behind. */
function buildMirror(sourceRoot, mirrorRoot) {
  let files = 0;
  let dirs = 0;
  const walk = (sourceDir, mirrorDir, rel) => {
    fs.mkdirSync(mirrorDir);
    dirs += 1;
    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
      const source = path.join(sourceDir, entry.name);
      const target = path.join(mirrorDir, entry.name);
      const where = rel === "" ? entry.name : rel + "/" + entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name.toLowerCase())) continue;
        walk(source, target, where);
        continue;
      }
      if (!entry.isFile()) continue;
      if (SKIP_EXT.has(path.extname(entry.name).toLowerCase())) continue;
      try {
        fs.linkSync(source, target);
      } catch (err) {
        if (err.code === "EXDEV") {
          throw new UsageError(
            "cannot hard link " + where + " into the mirror: --work must be on the same volume as the game (" +
              path.parse(source).root + " vs " + path.parse(mirrorRoot).root + ")"
          );
        }
        throw err;
      }
      files += 1;
    }
  };
  walk(sourceRoot, mirrorRoot, "");
  return { files, dirs };
}

/** Remove a mirror we created: unlink files, then rmdir bottom up. */
function removeTree(root) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) removeTree(target);
    else fs.unlinkSync(target);
  }
  fs.rmdirSync(root);
}

function expectOutcome(expect) {
  return expect === "unreadable" ? "findings" : "ok";
}

async function runGame(game, opts) {
  const started = Date.now();
  const record = {
    id: game.id,
    engine: game.engine,
    expect: game.expect,
    outcome: "ok",
    exitCode: 0,
    uniqueStrings: null,
    dataFiles: null,
    undecodableCount: null,
    steps: [],
    durationMs: 0,
    error: null,
    match: false,
  };
  let target = game.root;
  let mirror = null;
  try {
    if (opts.deep) {
      mirror = path.join(opts.work, game.id);
      if (!inside(opts.work, mirror)) throw new UsageError("mirror path escapes --work: " + mirror);
      if (fs.existsSync(mirror)) removeTree(mirror);
      buildMirror(game.root, mirror);
      target = mirror;
    }
    for (const step of opts.steps) {
      const flags = step === "translate" ? { "dry-run": true } : {};
      const result = await runCommand(step, [target], { flags });
      record.steps.push(step);
      record.outcome = result.outcome;
      record.exitCode = result.outcome === "ok" ? 0 : 1;
      if (step === "scan") {
        record.uniqueStrings = result.payload.uniqueStrings;
        record.dataFiles = result.payload.dataFiles;
        record.undecodableCount = Array.isArray(result.payload.undecodable) ? result.payload.undecodable.length : 0;
        // Nothing readable means there is no dictionary to build: stop here.
        if (result.outcome !== "ok") break;
      }
    }
  } catch (err) {
    record.outcome = "error";
    record.exitCode = 2;
    record.error = (err.code ? err.code + ": " : "") + err.message;
  } finally {
    if (mirror && fs.existsSync(mirror)) removeTree(mirror);
  }
  record.durationMs = Date.now() - started;
  record.match = record.outcome === expectOutcome(game.expect);
  return record;
}

function markdown(report) {
  const lines = [
    "# Corpus report",
    "",
    "Generated by tools/corpus.mjs. Ids only: no absolute paths.",
    "",
    "| id | engine | expect | outcome | match | unique | data files | undecodable | steps | ms |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const game of report.games) {
    lines.push(
      "| " + game.id + " | " + game.engine + " | " + game.expect + " | " + game.outcome + " | " +
        (game.match ? "yes" : "no") + " | " + game.uniqueStrings + " | " + game.dataFiles + " | " +
        game.undecodableCount + " | " + game.steps.join("+") + " | " + game.durationMs + " |"
    );
  }
  lines.push(
    "",
    "ok " + report.summary.ok + " / findings " + report.summary.findings + " / error " + report.summary.error
  );
  return lines.join("\n") + "\n";
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
    if (opts.help) {
      console.log(USAGE);
      return 0;
    }
    if (!opts.manifest) throw new UsageError("--manifest is required");
    const steps = opts.steps.split(",").map((s) => s.trim()).filter(Boolean);
    if (steps.length === 0) throw new UsageError("--steps is empty");
    for (const step of steps) {
      if (!STEPS.includes(step)) throw new UsageError("--steps must be a subset of " + STEPS.join(", ") + ", got " + step);
    }
    opts.steps = [...new Set(steps)];
    const writes = opts.steps.some((step) => step !== "scan");
    if (writes && !opts.deep) {
      throw new UsageError("steps beyond scan write a dictionary: pass --deep --work <dir> on the same volume as the games");
    }
    if (opts.deep && !opts.work) throw new UsageError("--deep requires --work <dir>");
    if (opts.deep) {
      opts.work = path.resolve(opts.work);
      fs.mkdirSync(opts.work, { recursive: true });
    }
    if (!opts.out && opts.work) opts.out = path.join(opts.work, "out");
    if (!opts.out) throw new UsageError("pass --out <dir> (or --work <dir>, which defaults --out to <work>/out)");
    opts.out = path.resolve(opts.out);
    const only = opts.only ? new Set(opts.only.split(",").map((s) => s.trim()).filter(Boolean)) : null;
    let games = loadManifest(opts.manifest);
    if (only) {
      const known = new Set(games.map((game) => game.id));
      for (const id of only) if (!known.has(id)) throw new UsageError("--only names an unknown id: " + id);
      games = games.filter((game) => only.has(game.id));
    }
    if (opts.deep) {
      for (const game of games) {
        if (!sameVolume(game.root, opts.work)) {
          throw new UsageError(
            "--work is on " + path.parse(opts.work).root + " but " + game.id + " is on " +
              path.parse(game.root).root + ": hard links cannot cross volumes, pass --work on the game volume"
          );
        }
      }
    }
    const records = [];
    for (const game of games) {
      const record = await runGame(game, opts);
      records.push(record);
      if (!opts.json) {
        console.log(
          (record.match ? "ok    " : "MISS  ") + record.id + " (" + record.engine + ") " + record.outcome +
            " unique=" + record.uniqueStrings + " undecodable=" + record.undecodableCount +
            " " + record.durationMs + "ms" + (record.error ? " " + record.error : "")
        );
      }
    }
    const summary = { ok: 0, findings: 0, error: 0, mismatch: 0 };
    for (const record of records) {
      if (record.outcome === "ok") summary.ok += 1;
      else if (record.outcome === "findings") summary.findings += 1;
      else summary.error += 1;
      if (!record.match) summary.mismatch += 1;
    }
    const report = {
      schema: 1,
      generatedAt: new Date().toISOString(),
      manifest: path.basename(opts.manifest),
      deep: opts.deep,
      steps: opts.steps,
      games: records,
      summary,
    };
    fs.mkdirSync(opts.out, { recursive: true });
    fs.writeFileSync(path.join(opts.out, "corpus.json"), JSON.stringify(report, null, 2) + "\n");
    fs.writeFileSync(path.join(opts.out, "corpus.md"), markdown(report));
    if (opts.json) console.log(JSON.stringify(report, null, 2));
    else console.log("ok " + summary.ok + " / findings " + summary.findings + " / error " + summary.error);
    return summary.mismatch === 0 ? 0 : 1;
  } catch (err) {
    if (err instanceof UsageError) {
      console.error("corpus: " + err.message);
      console.error(USAGE);
      return 2;
    }
    console.error("corpus: " + (err && err.stack ? err.stack : String(err)));
    return 2;
  }
}

main().then((code) => {
  process.exitCode = code;
});
