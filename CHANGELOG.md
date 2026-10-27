# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). No release tag has been cut yet, so versions are recorded by the commit milestone that bumped `package.json`, newest first.

## [Unreleased]

## [0.16.0] - 2026-10-27

### Added

- The `scan` payload carries the engine's capability flags (`capabilities`: `extract` / `export` / `runtime` / `launch` / `debuggable` / `attach` / `liveReload`). The GUI uses them to disable buttons for operations the engine cannot perform (no delivery layer → install/uninstall disabled with the reason shown). Additive: scripts that ignore unknown keys keep working.
- GUI buttons now follow the capability rules from docs/gui.md §3: unsupported capabilities are grayed out with the reason, instead of failing after a click.

### Unchanged

- No breaking changes: the envelope, exit codes, command set, and error codes are untouched; adapter-level scan payloads keep their eleven documented keys (the capability object is added by the shared runner).

## [0.15.0] - 2026-10-27

### Added

- Added JSONL input for `import` (generic content import v1): one JSON object per line with `source|key`, `target|text` and `contexts|locator`; external tools can now feed arbitrary text into a Yakusha dictionary without a Yakusha extract. The merge rules, skip rules and payload keys are the same as the other import formats.
- Added `--create` for `import`: when the project has no dictionary yet, the command starts one (`emptyDictionary(gameTitle)`), prints a stderr note and merges into it. A damaged table never leaves a half-made dictionary behind because parsing happens first.
- Added `test/export.test.js` cases for JSONL field aliases, bad lines (E_DICTIONARY with the line number), `--create`, and the preserved E_NO_DICTIONARY without the flag (650 passing in total).

### Changed

- `import --format` now accepts `jsonl` and guesses it from the `.jsonl` extension; the usage text documents the new flag.
- No breaking changes: the envelope, exit codes, the command table and all 13 error codes are unchanged, and the dictionary format stays `yakusha/1` with no new fields (dictionary v2 fields remain a pending decision).


## [0.14.0] - 2026-10-27

### Added

- Added a shared command runner (`src/cli/runner.js`): every command implementation moved out of `bin/yakusha.js` into one seam that builds the payload and the human summary separately. The CLI is now a thin shell over it, and the GUI's main process calls the same `runCommand` in-process, so the two front ends cannot drift. The `--json` envelope, exit codes and every text output are unchanged (byte-for-byte compared against the old CLI on 48 cases).
- Added the first Electron shell (`gui/`): `main.js` owns the window and the IPC allowlist, `handlers.js` wraps `runCommand` and resolves every call to the exact `--json` envelope the CLI prints, `preload.js` exposes only an allowlisted bridge (`run`/`cancel`/`pickDirectory`/`onProgress`/`onWarning`/`onResult`/`pathForFile`), and a minimal renderer maps buttons 1:1 to documented commands (scan/extract/status/translate/verify/install/uninstall/doctor plus export, speaker, terms, `config list` and `launch`, with a native directory picker). `launch` goes through the same runner seam, so the child keeps the secret-free environment and the same `--exe` contract; ambiguous choices surface the CLI's `E_EXE` candidates. No remote content is loaded and the renderer has no Node access.
- Added opt-in credential memory to the shell: the API key is encrypted with Electron `safeStorage` (DPAPI on Windows) into a `credentials` envelope next to the config file, injected as `--api-key` only when "use stored key" is checked, never written as plaintext, and never read by the CLI.
- Added cooperative cancellation for long translates: `translate` accepts an `AbortSignal`, stops claiming new batches once aborted, keeps whatever was already translated, and reports `cancelled: true` in the payload. The CLI never cancels on its own, so the new payload key is always `false` on the command line; the GUI's cancel button drives the same signal.
- Added real progress for the GUI: the runner's `onProgress` hook (one callback per finished batch with `done`, `total`, `translated`, `rejected`) is forwarded over IPC, so the window draws only genuinely reported progress — no interpolation, no fake percent bars.
- Added a minimal dictionary editor to the shell: `gui/dictionary.js` reuses the core dictionary reader and writer, the shell lists pending entries and writes one entry per save, and the two IPC channels stay outside the command allowlist because they are not CLI commands.
- Added `test/runner.test.js` (15 cases), `test/cancel.test.js` (5 cases), `test/gui-handlers.test.js` (11 cases) and `test/gui-dictionary.test.js` (6 cases); the GUI tests compare every envelope key-for-key against the CLI run on the same state. `runGuiCommand` envelopes against the child-process CLI on identical state.

### Changed

- `bin/yakusha.js` shrank from ~1,245 to ~310 lines: it now parses argv, prints the envelope and maps exit codes, nothing more. Command behaviour is unchanged.
- `electron` (37.2.3) entered `devDependencies` with a committed `pnpm-lock.yaml` and `pnpm-workspace.yaml`; runtime dependencies remain zero and the CLI still runs on a bare Node 22+.
- The GUI design draft (`docs/gui.md`) moved from "unimplemented" to "minimal shell delivered": the long-task interface the draft required before any GUI work (progress events + cancellation) shipped in this release, and the draft's black-box progress rules were replaced by the real event contract.

### Unchanged

- No breaking changes: the envelope, exit codes, command table and all 13 error codes are the same as 0.13.0. The only payload addition is `cancelled` on `translate` (always `false` in CLI output). `launch` remains CLI-only in this release: the window does not yet drive it.

## [0.13.0] - 2026-10-27

### Added

- Added Kirikiri (KAG scenario scripts) as a fifth engine: the adapter opens the `.xp3` archives found in the game root or its `data/` directory, reads the standard index format, and pulls the text lines out of `.ks` scenario scripts, with UTF-8 tried first and Shift_JIS as the fallback encoding.
- Added a pure-JavaScript XP3 reader (`src/engines/krkr/xp3.js`): the 40-byte header, the zlib-compressed index, the `info`, `segm` and `adlr` sub-blocks, multi-segment files, and an adler-32 check of every reassembled file. Modified index variants are reported as unsupported instead of guessed at, and nothing is written back.
- Added KS line extraction (`src/engines/krkr/ks.js`): comment (`; `), label (`*`) and tag lines are skipped, `[r]` is treated as an inline tag, `[name_set name='...']` tracks the current speaker, and a trailing `[p2]` closes a message; inline tags are stripped from the stored text. `.tjs` files are counted but not read, because translating program strings without understanding the code is unsafe.
- Added the `import` command: it fills a dictionary from a previously exported file with `--from <file>`, takes the format from `--format` or the file extension (`.tsv`, `.csv`, `.json`), and offers the `only-empty` (default) and `overwrite` strategies. Empty targets are skipped, identical values are not counted as applied, and the dictionary's own contexts win over row contexts for entries that already have them; `--dry-run` computes the result and writes nothing. The payload reports `file`, `format`, `strategy`, `dryRun`, `read`, `applied`, `skipped` and `entries`.
- Added table export: `export --format` now accepts `json` (default), `tsv` and `csv`. The table formats write a `source`, `target`, `contexts` header row, a UTF-8 BOM and CRLF line endings, quote a cell that contains the separator, a quote, a line break or leading or trailing spaces, double quotes inside quoted cells, and join multiple contexts into one cell. A failing table write still never leaves a partial file behind, and the existing refusals around `--out`, `--force` and targets inside the game carry over.
- Added Kirikiri to `getAdapters()` as the fifth adapter, so the detection order (MZ, MV, Ren'Py, RGSS, Kirikiri) is part of the public contract and the "nothing here" message gained a fourth prefix.
- Added the Kirikiri entry points to the library facade (`src/index.js`): `openKrkrProject`, `findKrkrRoot`, `findKrkrRoots` and `extractKrkrProject`.
- Added Kirikiri at the detect, scan and extract tiers, so `status`, `translate`, `verify`, `speaker`, `terms` and `export` all work on a Kirikiri game through the shared pipeline without a single engine special case, and `launch` reuses the existing Windows launcher.

### Changed

- The `export` command accepts more than JSON: `--format json` keeps the snapshot format, while `tsv` and `csv` write the new table formats. Asking for another format now answers `E_USAGE` with the accepted list, and `--flat` still applies to `--format json` only.
- Kirikiri ships without runtime delivery in this release: `install` and `uninstall` fail with `E_NOT_IMPLEMENTED` and exit code `2` and write no file, because the engine has no directory it reads translations from on its own - delivery would mean rewriting the game's `.xp3` archives, which is recorded as a pending decision. `doctor` therefore reports the `install` check as a warning that says there is no delivery layer yet and the `runtime` check as info, with the verdict `usable` once a dictionary exists and `broken` (exit code `1`) when none does.
- No breaking changes: the JSON envelope, the exit codes and the 13 error codes stay as they were in 0.12.0, and `import` only extends the command list.

## [0.12.0] - 2026-10-27

### Added

- Added RGSS as a fourth engine, covering RPG Maker XP, VX and VX Ace: a project is found through `Game.ini`, an `.rgssad`, `.rgss2a` or `.rgss3a` archive, or a `Data/` directory holding `.rxdata`, `.rvdata` or `.rvdata2` documents, and the engine version is taken from the archive extension, the `Library=` entry, the `Scripts=` extension or the data documents, in that order.
- Added a pure-JavaScript Ruby Marshal 4.8 reader and writer (`src/engines/rgss/marshal.js`): it accepts major version 4 only, never evaluates Ruby, keeps a class or module as its name and a `T_DATA` payload as raw bytes, and can write the same stream back.
- Added decryption for the three RGSS archive generations (`src/engines/rgss/archive.js`): `.rgssad` and `.rgss2a` share one rolling key seeded with `0xDEADCAFE` that steps before every field, while `.rgss3a` derives one constant key from the header seed for the directory, carries a separate key per file and steps it once per four-byte block; names are normalised to forward slashes, and the directory is parsed from a bounded header window instead of reading the whole archive into memory.
- Added multi-encoding decoding of `Game.ini`: valid UTF-8 first, then Shift_JIS when the decoding carries kana, then GBK, and Latin-1 as the last resort.
- Added extraction of the text a player actually reads: the event commands `101` (speaker name), `102` (choice labels), `320` (actor rename), `401` (dialogue) and `405` (scrolling-text continuation), the field table for `Actors`, `Classes`, `Skills`, `Items`, `Weapons`, `Armors`, `Enemies`, `States`, `Tilesets` and `CommonEvents`, and the name fields of `MapInfos`; choice branch markers (`402`, whose text is the `102` labels again) and editor comments (`108`, `408`), Ruby script lines (`355`, `655`), resource file names and every `@note` are deliberately left out.
- Added the `System` terms: `@game_title`, `@currency_unit` and the four tables under `@terms` (`@basic`, `@params`, `@etypes`, `@commands`).
- Added RGSS to `getAdapters()` as the fourth adapter, so the detection order (MZ, MV, Ren'Py, RGSS) is part of the public contract and the "nothing here" message gained a third prefix.
- Added the RGSS entry points to the library facade (`src/index.js`): `openRgssProject`, `findRgssRoot`, `findRgssRoots` and `extractRgssProject`.
- Added a pending-delivery branch to `doctor`: an adapter can now mark its delivery descriptor as pending and hand over its own reason, and `doctor` answers that instead of running the plugin checks, which would have looked for a plugin directory and a `js/plugins.js` registry this engine does not have.
- Added RGSS at the detect, scan and extract tiers, so `status`, `translate`, `verify`, `speaker`, `terms` and `export` all work on an RGSS game through the shared pipeline without a single engine special case, and `launch` reuses the existing Windows launcher.

### Changed

- `doctor` now tells the truth about an engine that has no delivery layer: the `install` check is a warning carrying the engine's own explanation, and the `runtime` check is an info line saying nothing is loaded at run time, so the game keeps showing the original text. It no longer reports such an engine as not installed, which would have pointed the user at a command that refuses to run.
- `capabilities.runtime` may now be `null` for an engine that reads and translates text but cannot write it back, so the contract pins three states next to each other: a plugin, a translation file, and no delivery layer at all.
- RGSS ships without runtime delivery in this release: `install` and `uninstall` fail with `E_NOT_IMPLEMENTED` and exit code `2` and write no file, so a translation run stops at the dictionary and the game keeps showing its original text. Rewriting the archive in pure JavaScript and injecting a native helper into the running game are both still open decisions, and this release deliberately ships neither.
- No breaking changes: the JSON envelope, the exit codes, the command list and the 13 error codes stay as they were in 0.11.0.

## [0.11.0] - 2026-10-27

### Added

- Added Ren'Py as a third engine: the adapter reads `.rpy` sources and `.rpyc` compiled scripts, so a developer copy and a build that ships only compiled scripts are both readable.
- Added a pure-JavaScript Python pickle reader (`src/engines/renpy/pickle.js`) for the syntax tree inside a `.rpyc`: pickle protocols 0 to 5, no `eval`, and the Python-2-only construction opcodes are reported as undecodable instead of guessed at.
- Added translation-file delivery: `install` writes `game/yakusha_translation.rpy` with one `translate <language> strings:` block (default language `schinese`) and an `init python:` guard that only sets `config.default_language` while it is still `None`; no game script is edited, and `uninstall` deletes that one file.
- Added Ren'Py to `getAdapters()` as the third adapter, so the detection order (MZ first, MV second, Ren'Py third) is now part of the public contract.
- Added the Ren'Py entry points to the library facade (`src/index.js`): `openRenpyProject`, `findRenpyRoot`, `findRenpyRoots`, `extractRenpyProject`, `collectRenpyUnits`, `installTranslation`, `uninstallTranslation` and `translationStatus`, plus the modules behind them through the `./src/*` subpath export.
- Made `doctor` engine-neutral: an adapter hands over its own extractor, script count, source label and delivery state through `adapter.diagnostics()`, and for Ren'Py the `install` and `runtime` checks describe the generated translation file instead of a plugin entry and a backup.

### Changed

- `install` in text mode prints `backup    : (none)` instead of `backup    : null` when the run did not create a backup.
- On Ren'Py, `install` and `uninstall` print the translation file they wrote or removed (path, entry count, language) instead of the plugin, registry and backup lines.
- The file count now carries the engine's own word: `scan` prints `scripts` for Ren'Py where RPG Maker prints `data files`, and the `doctor` header uses the same word.
- Moved the engine-specific rules behind an adapter profile (`src/engines/profile.js`) so a new engine can be added without touching the shared pipeline (internal refactor, no behaviour change).
- No breaking changes: the JSON envelope, the exit codes, the command list and the 13 error codes stay as they were in 0.10.0.

### Fixed

- Extraction counts a script once when a game ships both `script.rpy` and `script.rpyc`: the source wins, so no line is reported twice.
- Extraction skips `game/tl/`, which holds delivered translations rather than game text.
- Extraction skips the `game/yakusha_translation.rpy` file yakusha itself writes, so the script count does not move after every `install` or `uninstall`.
- When a say statement writes the speaker as a quoted literal, only the dialogue after it is collected, never the name.

## [0.10.0] - 2026-10-26

### Added

- Added a `--json` envelope to every command: the reserved keys `schema`, `command`, `ok`, `outcome` and `error` in a fixed order, with the payload flattened next to them; progress, warnings and debug output stay on stderr.
- Added exit codes `0` for `ok`, `1` for `findings` and `2` for `error`, matching the `outcome` field and identical in text and JSON mode.
- Added strict argument parsing: an unknown option, a missing value, a value on a boolean flag or an extra positional argument is `E_USAGE` reported before any disk access.
- Added 13 stable error codes (`E_USAGE`, `E_NOT_PROJECT`, `E_MULTI_ROOT`, `E_NO_DICTIONARY`, `E_DICTIONARY`, `E_EXISTS`, `E_EXE`, `E_PROVIDER`, `E_CONFIG`, `E_IO`, `E_NOT_IMPLEMENTED`, `E_UNSUPPORTED_PLATFORM`, `E_INTERNAL`) with single-line, sanitized messages.
- Added `config`, a user-level command that lists, reads, sets and unsets the provider, the model and the base URL; the API key is never stored or echoed.
- Added `export`, which writes a dictionary to a JSON snapshot with stable key order, atomic writes and overwrite protection.
- Added `launch`, which starts the game executable on Windows and strips the model key variables from the child environment.
- Added per-engine adapters for MZ and MV plus a library facade at `src/index.js`, so the CLI and external callers share one interface.
- Added a single source of truth for the version: `src/version.js` reads `package.json`, and the runtime plugin version is rendered at install time.

### Changed

- Breaking: `translate` now needs an explicit provider, model and API key from a flag, an environment variable or the config file, and fails with `E_CONFIG` before any request is sent.
- Breaking: an unknown command or an unknown option now exits with `2` instead of `1`.
- Breaking: the engine version in the `scan` payload is now `engineVersion` instead of `version`.
- Breaking: the engine version in the `doctor` payload is now `game.engineVersion` instead of `game.version`.
- `--help` and `--version` always print plain text on stdout with exit code `0`, even when `--json` is passed.
- `install` and `uninstall` refuse paths that resolve outside the project root.
- Continuous integration runs the test suite on Windows only, on Node 22 and Node 24.

### Removed

- Removed the built-in default model and the implicit default provider; there is no fallback model any more.

## [0.9.0] - 2026-10-25

### Changed

- Renamed the project to `yakusha`: the package, the CLI binary, the runtime plugin file, the environment variables and the backup suffix all carry the new name, and the runtime plugin version now follows the package version.
- Turned the README into a one-page quickstart; the command reference, design notes, support matrix and known limitations moved into `docs/`.

### Removed

- Removed game-derived material from the repository (captured game images and example dictionaries of real games); documentation and test fixtures now use anonymized, self-written samples.

## [0.8.0] - 2026-10-25

### Added

- Added `doctor`, a read-only post-install health check that separates the three reasons the translations can go missing after a game update (a lost plugin entry, a deleted plugin file, a dictionary that no longer matches `data/`), plus the runtime lookup and the last `verify` result.
- `doctor` ends with one of four verdicts (`broken`, `not-installed`, `usable`, `ready`); only `broken` exits with `1`.

### Fixed

- `doctor` reports a hand-broken `plugins.js` as a failed check instead of throwing a stack trace.

## [0.7.1] - 2026-10-25

### Fixed

- `uninstall` no longer restores a stale `plugins.js` backup over edits made after installation; when the file has changed it removes only its own entry, keeps the backup and says so.
- `install` reports the same mismatch up front instead of writing an entry next to a drifted file.

## [0.7.0] - 2026-10-25

### Added

- Added `verify --write-report <file>`, a self-contained Markdown report of every finding, grouped by kind with the error-level problems first.
- Added `speaker --write-names <file>`, a JSON template listing the speaker names a game never had translated.

### Fixed

- `verify` now exits with `1` when it finds error-level problems, so `verify && install` works as a release gate; before, it always exited with `0`.

## [0.6.0] - 2026-10-25

### Added

- Added `speaker`, which repairs untranslated speaker names from the renderings the game itself already uses, without calling a model.
- `--names` supplies the names a game never had translated anywhere, `--include-drift` also unifies alternative spellings of the same name, and a real translation wins over a copied source name.

## [0.5.2] - 2026-10-25

### Added

- Added two `verify` checks: `trad` flags Traditional Chinese characters the source did not contain, and `speaker` flags speaker names left in Japanese, left untranslated, or written in more than one way.

## [0.5.1] - 2026-10-25

### Changed

- `--context` can be repeated, and an entry is selected when it matches any of the given values.

## [0.5.0] - 2026-10-25

### Added

- Added `terms`, which mines the dominant rendering of each name from the dictionary itself and reports `ok`, `drift` or `missing` per name; `--write` emits a glossary that `translate --glossary` accepts.
- Added `translate --glossary-only --overwrite` so a glossary drift fix can rewrite an entry that already has a translation.

### Changed

- `translate` now sends only the glossary rows a request actually mentions instead of the whole glossary with every request.

## [0.4.0] - 2026-10-25

### Added

- Added `verify <game>`, a read-only audit of a finished dictionary that reports eight kinds of problem split into errors which fail the run and warnings which only inform.
- Errors are an echoed source text, broken escape codes and lost `%N` placeholders; warnings are leftover kana, an extra or missing line break, an over-wide line, a translation with no Han characters and an entry the translator already rejected.

## [0.3.0] - 2026-10-25

### Added

- Added `--max-length <n>` to wrap long translations by display width, breaking at punctuation and never splitting an escape code; `--no-rewrap` leaves already translated entries alone.
- Running a command on a parent folder now finds a game up to three levels below it, and refuses to guess when two games sit at the same depth.

### Changed

- `plugins.js` is rewritten with the layout of the original file: the trailing comma and the line ending style (LF or CRLF) are preserved.

### Fixed

- Zero-byte data files are reported as `empty` instead of `undecodable`.

## [0.2.0] - 2026-10-25

### Added

- First release: `scan`, `extract`, `status`, `translate`, `install` and `uninstall` for RPG Maker MZ and MV games.
- Runtime translation through a plugin that hooks the data load path: `DataManager.onXhrLoad` on MZ, and `loadDataFile` plus `onLoad` on MV, where the loaded object is matched by identity because MV requests run concurrently.
- A data file decoder for plain JSON and for single-byte XOR obfuscation, reporting the files it cannot decode instead of skipping them silently.
- A dictionary keyed by source text, storing the translation, the places it occurs and the rejection reason per entry.
- Validation before writing: escape codes, `%N` placeholders, line-break count, length ratio and `U+FFFD` are checked against the source; a failing translation is retried once and then left untranslated with its reason, never written as a fake translation.
- An OpenAI-compatible provider (the default at the time) and a mock provider, with `--dry-run` and `--glossary-only` working without any network access.
- Batch, concurrency and save controls (`--batch-size`, `--char-budget`, `--concurrency`, `--save-every`) so a long run can be stopped and resumed.
- Machine-readable output through `--json`, and `install --embed` to write the translations into the plugin file for offline distribution.

[0.16.0]: https://github.com/MagicalAlmond/Yakusha/compare/v0.15.0...v0.16.0
[Unreleased]: https://github.com/MagicalAlmond/Yakusha/compare/v0.16.0...HEAD
[0.15.0]: https://github.com/MagicalAlmond/Yakusha/compare/v0.14.0...v0.15.0
[0.14.0]: https://github.com/MagicalAlmond/Yakusha/compare/v0.13.0...v0.14.0
[0.13.0]: https://github.com/MagicalAlmond/Yakusha/compare/v0.12.0...v0.13.0
[0.12.0]: https://github.com/MagicalAlmond/Yakusha/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/MagicalAlmond/Yakusha/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/MagicalAlmond/Yakusha/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/MagicalAlmond/Yakusha/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/MagicalAlmond/Yakusha/compare/v0.7.1...v0.8.0
[0.7.1]: https://github.com/MagicalAlmond/Yakusha/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/MagicalAlmond/Yakusha/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/MagicalAlmond/Yakusha/compare/v0.5.2...v0.6.0
[0.5.2]: https://github.com/MagicalAlmond/Yakusha/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/MagicalAlmond/Yakusha/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/MagicalAlmond/Yakusha/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/MagicalAlmond/Yakusha/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/MagicalAlmond/Yakusha/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/MagicalAlmond/Yakusha/releases/tag/v0.2.0
