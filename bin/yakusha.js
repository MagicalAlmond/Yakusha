#!/usr/bin/env node
/**
 * yakusha command line interface.
 *
 * The command implementations live in src/cli/runner.js: this file parses
 * argv, asserts the options each command accepts, calls
 * {@link runCommand} and prints the JSON envelope or the human summary.
 * docs/json-contract.md is the contract.
 *
 * @module bin/yakusha
 */

import process from "node:process";

import { assertOptions, parseArgs } from "../src/cli/args.js";
import { CliError, EXIT, emit, emitError, failureFor, sanitizeMessage } from "../src/cli/envelope.js";
import { VERSION } from "../src/version.js";
import { commands as runnerCommands, runCommand } from "../src/cli/runner.js";

/** Parsed global state, filled in by {@link main}. */
let flags = {};
let json = false;
let command = null;

const USAGE = [
  "yakusha <command> <game-dir> [options]",
  "",
  "  <game-dir> may be the game itself or any folder up to 3 levels above it;",
  "  the project root is discovered automatically.",
  "",
  "global options:",
  "  --json              machine readable output (every command)",
  "  --help, -h          show this help",
  "  --version           print the version and exit",
  "",
  "  scan       report what is translatable",
  "  extract    build/refresh yakusha/dictionary.json",
  "  status     show translation progress",
  "  translate  fill the dictionary through an LLM",
  "  verify     audit the dictionary for bad entries",
  "  speaker    repair inline speaker names from the game's own rendering",
  "  terms      mine name renderings and report drift",
  "  install    install the runtime plugin into the game",
  "  uninstall  remove the runtime plugin",
  "  doctor     check the install, the backup and the dictionary against this build",
  "  export     write the translated entries as JSON, TSV or CSV",
  "  import     fill the dictionary from a previously exported file",
  "  launch     start the game executable (Windows only)",
  "  config     read or write the user level config (takes no game directory)",
  "",
  "translate options:",
  "  --provider <name>   openai, compatible or mock (required for a real run)",
  "  --model <name>      model id (required for a real run; $YAKUSHA_MODEL)",
  "  --base-url <url>    OpenAI compatible endpoint, defaults to $YAKUSHA_BASE_URL",
  "  --api-key <key>     API key, defaults to $YAKUSHA_API_KEY or $OPENAI_API_KEY",
  "  --glossary <file>   JSON map of source -> fixed translation",
  "  --limit <n>         translate at most n pending entries",
  "  --context <text>    only entries whose context contains text; repeat to",
  "                      accept any of several",
  "  --batch-size <n>    entries per request (default 40)",
  "  --char-budget <n>   characters per request (default 6000)",
  "  --concurrency <n>   parallel requests (default 2)",
  "  --save-every <n>    write the dictionary every n translations (default 200)",
  "  --max-length <cols> wrap translated lines wider than n display columns (0 = off)",
  "  --no-rewrap         leave existing translations alone (no re-wrap)",
  "  --dry-run           use the mock provider and do not save",
  "  --glossary-only     apply --glossary and never call a model",
  "  --overwrite         let --glossary replace entries that are already translated",
  "",
  "verify options:",
  "  --kind <list>       only report these kinds, comma separated",
  "                      (kana, echo, codes, slots, lines, width, no-text, trad, speaker, rejected)",
  "  --max-length <cols> also report lines wider than n display columns",
  "  --limit <n>         how many problems to print (default 20)",
  "  --write-report <f>  write every finding as a markdown report",
  "",
  "speaker options:",
  "  --include-drift     also replace a Chinese rendering that differs from the",
  "                      one used elsewhere (style call, off by default)",
  "  --names <file>      JSON map of source name -> Chinese, for names this game",
  "                      never translated (so no rendering can be copied)",
  "  --write-names <f>   write a JSON template of the names --names must supply",
  "  --dry-run           report what would change without writing",
  "  --limit <n>         how many names to print (default 20)",
  "",
  "terms options:",
  "  --status <list>     only list these statuses (ok, drift, missing)",
  "  --min-holders <n>   mentions a name needs before it is mined (default 5)",
  "  --min-support <n>   share of mentions the dominant spelling needs (default 0.5)",
  "  --drift-only        write only the entries that disagree",
  "  --max-terms <n>     cap the glossary (0 = every mined term)",
  "  --limit <n>         how many terms to print (default 20)",
  "  --write <file>      save the glossary for translate --glossary",
  "  --dry-run           report what --write would save, without saving",
  "",
  "export options:",
  "  --out <file>        target file (required; never stdout)",
  "  --format <name>     json (default), tsv or csv",
  "  --flat              write source -> text instead of {text, contexts} (json only)",
  "  --force             overwrite an existing target",
  "",
  "import options:",
  "  --from <file>       source file (required; never stdin)",
  "  --format <name>     tsv, csv, json or jsonl; guessed from the extension by default",
  "  --strategy <name>   only-empty (default; never overwrites) or overwrite",
  "  --create            start a dictionary when the project has none yet",
  "  --dry-run           report what would change without writing",
  "",
  "launch options:",
  "  --exe <name>        pick one executable when the project root has several",
  "",
  "install options:",
  "  --embed             embed the translations into the plugin file",
  "",
  "config commands (no game directory):",
  "  yakusha config list",
  "  yakusha config get <provider|model|baseUrl>",
  "  yakusha config set <provider|model|baseUrl> <value>",
  "  yakusha config unset <provider|model|baseUrl>",
  "",
  "  The file lives at %APPDATA%\\yakusha\\config.json; YAKUSHA_CONFIG_DIR",
  "  points at another directory. The API key is never stored there.",
].join("\n");

/**
 * Report one failure the way the current output mode requires.
 *
 * @param {unknown} error
 */
function reportFailure(error) {
  const failure = failureFor(error);
  // Parsing happens before the command is bound, so a usage error carries the
  // command it was reading on the error itself.
  if (!command && error && typeof error.command === "string") command = error.command;
  // A stack is for the person debugging yakusha, never for the payload: it
  // carries absolute paths and sometimes request context. Opt in on stderr.
  if (process.env.YAKUSHA_DEBUG === "1" && error && error.stack) process.stderr.write(error.stack + "\n");
  if (json) {
    const code = emitError(command, failure.code, failure.message, failure.details);
    process.exitCode = code;
    return;
  }
  process.stderr.write("error: " + sanitizeMessage(failure.message) + "\n");
  process.exitCode = EXIT.error;
}

/**
 * Run the CLI: parse argv, dispatch through the shared runner, print the
 * envelope. The human summary is printed by the runner's sink, not here.
 *
 * @returns {Promise<number>} the exit code implied by the run
 */
async function main() {
  const argv = process.argv.slice(2);
  // --version and --help win over everything else, including a command and a
  // bad option: they are how a caller finds out what this binary is.
  const wantsVersion = argv.includes("--version");
  const wantsHelp = argv.includes("--help") || argv.includes("-h");
  if (wantsVersion) {
    process.stdout.write("yakusha " + VERSION + "\n");
    return EXIT.ok;
  }
  // The error reporter needs the mode even when parsing fails, so detect --json
  // before the parse and only then take the parsed value.
  json = argv.includes("--json");
  if (wantsHelp) {
    process.stdout.write(USAGE + "\n");
    return EXIT.ok;
  }

  const parsed = parseArgs(argv);
  flags = parsed.flags;
  json = flags.json === true;
  command = parsed.positional[0] || null;

  if (!command) {
    if (json) return emitError(null, "E_USAGE", "no command");
    process.stderr.write(USAGE + "\n");
    return EXIT.error;
  }
  if (!Object.hasOwn(runnerCommands, command)) {
    if (json) return emitError(command, "E_USAGE", "unknown command: " + command);
    process.stderr.write("error: unknown command: " + command + "\nrun 'yakusha --help' for usage\n");
    return EXIT.error;
  }
  // Option validation stays in the CLI layer: the runner accepts whatever the
  // front end passes, and a future GUI never builds a malformed flag map.
  assertOptions(command, flags);

  const args = parsed.positional.slice(1);
  // config is the one command that does not take a game directory: its
  // positionals are the subcommand and its arguments.
  if (command !== "config") {
    if (args.length === 0) throw new CliError("E_USAGE", "no game directory given");
    if (args.length > 1) throw new CliError("E_USAGE", "unexpected argument: " + args[1]);
  }

  // The sink carries the human summary. Text mode prints it to stdout; --json
  // mode drops the summary but keeps every warning on stderr, exactly as the
  // pre-0.14 CLI did. Warnings are not part of the payload contract, so they
  // flow on stderr in both modes.
  const sink = json
    ? { out: () => {}, warn: (text) => process.stderr.write(text) }
    : { out: (line) => process.stdout.write(line + "\n"), warn: (text) => process.stderr.write(text) };

  // translate draws its percentage display on stderr while it works; the
  // runner only knows the neutral progress hook. The trailing carriage return
  // clears the line once the run is over.
  // The hook is also the save-every trigger inside the runner, so translate
  // always gets one; only the percentage display is a text-mode extra.
  let lastPercent = -1;
  const onProgress =
    command === "translate"
      ? (progress) => {
          if (!json) {
            const percent = progress.total === 0 ? 100 : Math.floor((progress.done / progress.total) * 100);
            if (percent === lastPercent) return;
            lastPercent = percent;
            process.stderr.write("\r  " + percent + "%  " + progress.done + "/" + progress.total + "   ");
          }
        }
      : null;

  const result = await runCommand(command, args, { flags, sink, onProgress });
  if (!json && command === "translate") process.stderr.write("\r");
  const outcome = result.outcome;
  if (json) return emit(command, outcome, result.payload);
  return EXIT[outcome];
}

main()
  .then((code) => {
    if (code !== EXIT.ok) process.exitCode = code;
  })
  .catch(reportFailure);
