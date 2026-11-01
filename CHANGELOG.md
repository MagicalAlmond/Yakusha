# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). No release tag has been cut yet, so versions are recorded by the commit milestone that bumped `package.json`, newest first.

## [Unreleased]

## [0.59.0] - 2026-11-01

### Fixed

- `import` no longer lets duplicate rows silently overwrite each other. A table that repeats the same source with the same target now applies only the first row; the redundant repeats are counted in a new optional payload key `duplicates` (with a `duplicates: N` output line, both present only when N > 0). Repeating a source with a *different* target is rejected outright (`E_DICTIONARY`, exit 2, message names both rows: `table row 2: source "Hello." is defined twice with different targets: row 1 has "A", row 2 has "B"` for TSV/CSV and `table line ...` for JSONL) before anything is merged or written - through 0.58 every duplicate applied and the last row won, with `applied` counting repeats. Empty-target rows never conflict; rich JSON follows plain JSON semantics (duplicate keys collapse at parse time).

### Unchanged

- No breaking change: the envelope, exit codes, command table, the 13 error codes and the `yakusha/1` dictionary format are identical to 0.58.0; the payload grows an optional key and CLI input validation only.

## [0.58.0] - 2026-11-01

### Added

- `test/gui-preload.test.js`, a stub-Electron contract test for the preload bridge (11 cases): the exposed `window.yakusha` surface, agreement between the bridge's command list, the handlers allowlist and the buttons in `gui/renderer/index.html`, the exact IPC channel and request shape behind every method, and the cancellable progress subscriptions. The preload script was the last GUI glue layer without a contract test.

### Unchanged

- No breaking change: the envelope, exit codes, command table, the 13 error codes and the `yakusha/1` dictionary format are identical to 0.57.0; this release adds tests and two JSDoc lines only.

## [0.57.0] - 2026-11-01

### Fixed

- The GUI cancel button cancels for real. Since 0.14 the main process created an `AbortController` for every translate run and kept it for `gui:cancel` and window close, but the signal was never handed to the runner - both paths aborted a controller nobody listened to. `runInWindow` now forwards the signal, and the new main-process contract test pins "cancel reaches the runner".
- Remembering the API key no longer crashes the shell. The `useStoredKey` branch rebound a `const` (`Assignment to constant variable`), so the first run with the remembered key always failed with an internal error instead of injecting the stored key; the binding is now `let`.

### Added

- `test/gui-main.test.js`, a stub-Electron contract test for the main-process glue (16 cases): the single-instance lock, the eight-channel IPC allowlist, hardened window options, navigation denial, request normalization, cancel reaching the runner, progress/warning/result forwarding, the credentials, dictionary and directory-picker channels, and the window-close abort.

### Unchanged

- No breaking change: the envelope, exit codes, command table, the 13 error codes and the `yakusha/1` dictionary format are identical to 0.56.0; both fixes change GUI behavior only.

## [0.56.0] - 2026-10-27

### Added

- The renderer contract tests now cover the drag & drop path, the directory picker, cancel forwarding and the progress/warning wiring (seven new cases in `test/gui-renderer.test.js`, on the stub DOM, no Electron window). Dropping a folder scans it through `pathForFile`, a drop without files is ignored, a canceled picker scans nothing, and progress from a stale run id cannot overwrite the live bar.

### Unchanged

- No product code changed: the renderer, the preload bridge, the handler seam and every envelope stay identical.

## [0.55.0] - 2026-10-27

### Fixed

- Kirikiri extraction recovers the visible text on tag-led lines. Localization groups commonly quote dialogue through a custom macro spelled `[「]line」`; the old rule "a line starting with `[` is a tag line" dropped the whole line, and the real sample lost 4,710 distinct lines of visible dialogue across 4,839 lines. After stripping the tags, any remaining visible text is collected as usual (whatever the engine renders is what gets extracted). Inline tag scanning is now quote-aware, so a `]` inside a quoted attribute such as `left="&tf.X[0]"` no longer cuts the tag short.

### Unchanged

- No breaking change: the envelope, exit codes, command table, the 13 error codes and the `yakusha/1` dictionary format are identical to 0.54.0; this is an extraction-quality fix, the adapter contract is untouched.

## [0.54.0] - 2026-10-27

### Fixed

- Kirikiri extraction no longer collects TJS code and KAG tag lines as dialogue. A line starting with `@` (the one-line tag spelling, `@wait`, `@macro name=...`) is now classified as a tag line, and the TJS code between `[iscript]` and `[endscript]` (either bracket or `@` spelling; an unterminated block runs to the end of the file) is skipped entirely: those lines execute as code and never render as dialogue. On a real game whose dialogue is already localized the unique string count drops from 5,686 to 5,231 - all 455 removed keys are code or tag lines, nothing else changes - and `verify` over an echo dictionary goes from 115 kana warnings plus 115 echo errors to a clean pass.

### Unchanged

- Envelope, exit codes, payload keys, the 13 error codes and the `yakusha/1` dictionary format are untouched.

## [0.53.0] - 2026-10-27

### Fixed

- `import` no longer silently drops provenance whose type is wrong. A JSONL line with an `engine` that is not a non-empty string, a `locator` that is neither a string (the single-context shorthand) nor an array of non-empty strings, or a `contexts` value outside those shapes is now rejected with `E_DICTIONARY` and the 1-based line number (`table line 1: engine must be a non-empty string`); the rich JSON path reports the entry name instead (`the export file entry "X": engine must be a non-empty string`). The dictionary on disk is untouched, and valid provenance plus the JSONL single-string `contexts` / `locator` shorthand behave exactly as before. 0.15-0.52 silently dropped these values or wrapped them.

### Unchanged

- Envelope, exit codes, payload keys, the 13 error codes and the `yakusha/1` dictionary format are untouched.

## [0.52.0] - 2026-10-27

### Added

- `extract --prune` drops dictionary keys the game no longer contains. Extraction used to be strictly additive: after a game update, entries whose source text disappeared stayed in the dictionary forever, `doctor` kept warning about `N dictionary keys no longer in the game`, `status` overcounted pending work and `verify --require-complete` could never pass. The new flag deletes those keys together with their translations; without it, `extract` behaves exactly as before but the payload grows two counters — `stale` (keys no longer present in the game) and `pruned` (keys actually dropped, always 0 without the flag). The text output prints `stale     : N key(s) no longer in the game (pass --prune to drop them)` when it finds stale keys, and `pruned    : N key(s) dropped` after a prune. `doctor`'s sync advice now points at `extract --prune` when only stale keys remain. All four engines share the new merge: existing entries keep their translations and only gain contexts, the `yakusha/1` format is unchanged.

### Unchanged

- No breaking change: the envelope, exit codes, command table, the 13 error codes and the `yakusha/1` dictionary format are identical to 0.51.0.

## [0.51.0] - 2026-10-27

### Fixed

- An option value that arrives as an empty string is now a usage error. `verify --write-report ""`, `speaker --write-names ""` and `terms --write ""` used to resolve the empty path to the current directory and fail with `E_IO` (`cannot write report file: <cwd> (EPERM)`), which reported a filesystem problem for what was really a missing argument; `export --out ""` and `import --from ""` already answered `E_USAGE`. All value options now raise `E_USAGE` (`option --<name> requires a value`, exit 2), matching the long-standing behaviour of the inline `--flag=` form. Leaving an option out entirely is unchanged.

### Unchanged

- No breaking change: the envelope, exit codes, command table, the 13 error codes and the `yakusha/1` dictionary format are identical to 0.50.0.

## [0.50.0] - 2026-10-27

### Fixed

- `install --embed` is now a usage error on engines whose delivery is not the RPG Maker plugin. On Ren'Py it used to be silently ignored: the flag changed neither the output nor the generated `game/yakusha_translation.rpy`, because that script always contains its translations inline. It now reports `E_USAGE` (`install --embed applies to RPG Maker games only: the Ren'Py translation script already contains the translations`), exits 2 and writes nothing; a plain `install` keeps working. On Kirikiri the dictionary precheck that `--embed` performed before the engine check is gone as well, so `install --embed` reports `E_NOT_IMPLEMENTED` whether or not a dictionary exists, instead of hiding the missing delivery layer behind `E_NO_DICTIONARY`. On RGSS, `install --embed` without `--native` now answers with the existing delivery hint straight away, again without reading a dictionary. The flag only reads the dictionary where it is used: the RPG Maker plugin tier.

### Unchanged

- No breaking change: the envelope, exit codes, command table, the 13 error codes and the `yakusha/1` dictionary format are identical to 0.49.0.

## [0.49.0] - 2026-10-27

### Fixed

- `verify --kind width` without `--max-length` is now a usage error (`E_USAGE`, exit 2, message `verify --kind width needs --max-length <columns>: the width check has no limit to compare against`). Without a limit the width check never runs, so the command could only ever answer `problems: none` — the same silent-empty-report trap 0.19 removed for unknown `--kind` values. Mixed kind lists such as `--kind kana,width` are covered too, and an explicit `--max-length 0` counts as off. Plain `verify` without `--kind` keeps the width check disabled and behaves exactly as before.

### Unchanged

- No breaking change: the envelope, exit codes, command table and the 13 error codes are identical to 0.48.0.

## [0.48.0] - 2026-10-27

### Fixed

- `launch` starts nw.js games that ship the runtime in `data/` with the assets in `data/www/`. The project root stays `data/www`, but the launcher and the working directory become the nw.js host directory in `data/` (detected by its `package.json` plus an nw.js runtime file, such as `nw.dll`); a browser build under `data/www/` without such a manifest still reports `E_EXE` from the asset root, as in 0.44. Payload keys are unchanged.

### Unchanged

- No breaking change: the envelope, exit codes, command table and the 13 error codes are identical to 0.47.0.

## [0.47.0] - 2026-10-27

### Fixed

- `scan` on Kirikiri games no longer repeats the archive name in archive-level `undecodable` entries. A broken or transformed index used to read `data.xp3: data.xp3: the XP3 index ...`; it now reads `data.xp3: the XP3 index ...`. File-level entries keep the `<archive>:<file>: <reason>` form, and the payload keys are unchanged.

### Unchanged

- No contract change: the scan payload keys, the envelope, exit codes, the command table, the 13 error codes and the `yakusha/1` dictionary format stay the same.

## [0.46.0] - 2026-10-27

### Fixed

- `install --native --dry-run` now predicts the same `state` as a real install. With no `yakusha/native/` directory it reports `state: "added"` (it used to say `unchanged` while writing nothing), and after an install it still reports `unchanged`. The `native.dryRun` flag and the rest of the payload are unchanged.

### Unchanged

- No contract change: the install payload keys, the envelope, exit codes, the command table, the 13 error codes and the `yakusha/1` dictionary format stay the same.

## [0.45.0] - 2026-10-27

### Fixed

- `scan` text output now keeps a space between a long per-file name and its string count. Names of 24 characters or more used to run into the number (`game/very_long_script.rpy1`); short names are unchanged.

### Unchanged

- No contract change: the scan payload keys, the envelope, exit codes, the command table, the 13 error codes and the `yakusha/1` dictionary format stay the same.

## [0.44.0] - 2026-10-27

### Fixed

- `launch` now starts RPG Maker MV games exported with a `www/` wrapper. The project root stays the asset folder (`.../www`), so plugin installs and dictionary lookups are unchanged, but the launcher and the working directory are taken from the parent folder that holds `Game.exe`. A browser build under `data/www/` keeps the old behaviour and reports `E_EXE` from the asset root.

### Unchanged

- No contract change: the launch payload keys, the envelope, exit codes, the command table, the 13 error codes and the `yakusha/1` dictionary format stay the same.

## [0.43.0] - 2026-10-27

### Added

- `uninstall --dry-run` previews the removal on every delivery tier: RPG Maker MZ/MV report the plugin and the `js/plugins.js` restore that would happen, Ren'Py reports the translation file, and RGSS `--native` reports the native directory. Nothing is deleted, written or restored, and the output ends with `dry run   : nothing written`.

### Unchanged

- No contract change: every uninstall payload key, the envelope, exit codes, the command table, the 13 error codes and the `yakusha/1` dictionary format stay the same.

## [0.42.0] - 2026-10-27

### Fixed

- `install --dry-run` now leaves every game untouched on all three delivery tiers. RPG Maker MZ/MV used to write the plugin, rewrite `js/plugins.js` and create the backup even with `--dry-run`; Ren'Py used to write `game/yakusha_translation.rpy`. Both now report the plan (`dry run   : nothing written`) without creating files, while RGSS `--native --dry-run` keeps its existing behaviour.

### Unchanged

- No contract change: every payload key, the envelope, exit codes, the command table, the 13 error codes and the `yakusha/1` dictionary format stay the same.

## [0.41.0] - 2026-10-27

### Added

- `terms` now recognises RGSS database name tables: the name-field detector accepts `Actors.rvdata2:name` (and the XP/VX `.rxdata` / `.rvdata` variants) in addition to the MZ/MV `Actors.json:name`. A 2,085-entry VX Ace dictionary reports 35 database name entries instead of 0, so drift and missing terms can be mined from RGSS games too.

### Unchanged

- No contract change: every payload key, the envelope, exit codes, the command table, the 13 error codes and the `yakusha/1` dictionary format stay the same. Ren'Py and Kirikiri contexts still never match the database-name pattern.

## [0.40.0] - 2026-10-27

### Fixed

- The three report-like outputs now refuse to overwrite the project dictionary: `verify --write-report`, `speaker --write-names` and `terms --write` reject a target that resolves to `yakusha/dictionary.json` with `E_EXISTS` and exit code `2`, before anything is written. `export` already had this guard; the error message now names the reason (`a verify report is not a dictionary`, and so on) for all four commands.

### Unchanged

- No contract change: the guard is a CLI behaviour fix, and every payload key, the envelope, exit codes, the command table, the 13 error codes and the `yakusha/1` dictionary format stay the same.

## [0.39.0] - 2026-10-27

### Fixed

- `import --dry-run --create` no longer writes a dictionary: when the project has no dictionary the dry run builds the empty dictionary in memory and reports `dry run: would create an empty dictionary: <file>` on stderr, leaving no `yakusha/dictionary.json` behind. The `applied` count and the rest of the payload are unchanged.

### Unchanged

- No contract change: every payload key, the envelope, exit codes, the command table, the 13 error codes and the `yakusha/1` dictionary format stay the same.

## [0.38.0] - 2026-10-27

### Added

- Verify findings carry the dictionary entry's optional provenance positions: every problem gets a `locator` array when the entry has one (dictionary v2, 0.17), the Markdown report prints each position as `at <locator>` under the finding, and the SARIF result adds the same array under `properties.locator`. Entries without provenance produce exactly the old output.

### Unchanged

- No contract change: `locator` is an optional addition to the existing `problems[]` objects, and the envelope, exit codes, command table, 13 error codes and the `yakusha/1` dictionary format stay the same.

## [0.37.0] - 2026-10-27

### Fixed

- Markdown verify reports escape a pipe in a field value as `\|` and a newline as `<br>`, so a game title or dictionary path containing either no longer splits the summary table into extra columns.

### Unchanged

- No contract change: the report is still Markdown at the same path with the same sections; SARIF, every payload key, the envelope, exit codes, the command table, the 13 error codes and the `yakusha/1` dictionary format stay the same.

## [0.36.0] - 2026-10-27

### Added

- `verify --require-complete` treats untranslated dictionary entries as blocking: when `pending > 0` the run reports `findings` and exits `1`, even if `problems` is empty. The option combines with `--fail-on warning`, adds no payload key, and `doctor` ignores it.
- Markdown reports recompute their verdict from the same gates: `--fail-on warning` now shows a failed verdict when only warnings remain, and `--require-complete` shows the pending-entry failure. The report table records the non-default flags (`| fail-on | warning |`, `| require-complete | yes |`).

### Fixed

- The Markdown verdict used to claim a release could pass under `--fail-on warning` while the command itself had already failed. The verdict and the SARIF `executionSuccessful` now follow the same thresholds as the exit code.

### Unchanged

- No breaking contract change: `--require-complete` is a new option, every payload key, the envelope, exit codes, the command table, the 13 error codes and the `yakusha/1` dictionary format stay the same.

## [0.35.0] - 2026-10-27

### Added

- `verify --fail-on error|warning` makes the release gate explicit: the default `error` keeps the old behaviour (only blocking findings exit 1), while `warning` also fails a run whose only findings are warnings. Unknown levels are a usage error (`E_USAGE`, exit 2).
- SARIF reports follow the same threshold: `invocations[0].executionSuccessful` is false under `--fail-on warning` when warnings remain, and `invocations[0].properties.failOn` records the level.

### Unchanged

- No breaking contract change: the option only moves the `findings` threshold, so every payload key, the envelope, exit codes, the command table, the 13 error codes and the `yakusha/1` dictionary format stay the same. `doctor` ignores the option.

## [0.34.0] - 2026-10-27

### Added

- `export --format jsonl` writes the translations as JSON Lines: one JSON object per line (`source`, `target`, `contexts`, and the optional `engine` / `locator` provenance), UTF-8 without a BOM, LF endings, in UTF-16 key order. It is the counterpart of the 0.15 JSONL import.
- JSONL import now accepts the 0.17 provenance fields: `engine` (string) and `locator` (array of strings) are written to a dictionary entry that has none. A single-string `locator` keeps its 0.15 meaning (one context).

### Unchanged

- No breaking contract change: `format` gains one value, every payload key, the envelope, exit codes, the command table, the 13 error codes and the `yakusha/1` dictionary format stay the same. TSV / CSV exports remain three columns without provenance.

## [0.33.0] - 2026-10-27

### Added

- `verify --write-report <file> --report-format sarif` writes a SARIF 2.1.0 document for CI code scanning. Each finding becomes a result with a stable `yakusha/verify/<kind>` rule id, the dictionary file as its artifact, the source text as a logical location, and a `yakusha/v1` fingerprint so repeated runs can be matched as the same finding. Markdown remains the default report format.

### Unchanged

- No breaking contract change: `--report-format` is a new option, `reportFormat` appears only next to `report` when `--write-report` is used, and the envelope, exit codes, command table, the 13 error codes and the `yakusha/1` dictionary format stay the same.

## [0.32.0] - 2026-10-27

### Changed

- Every remaining file the tool writes while running a command now uses the same atomic write: the plugin install state (`js/plugins.js` and its backup), `verify --write-report`, `speaker --write-names` and `terms --write` write a same-directory temporary file and rename it into place, and the RGSS archive writer uses the new binary variant. A crash or a failed write leaves the previous file intact, and an unusable output path now fails with `E_IO` such as `cannot write report file: <file>` instead of an internal error.

### Unchanged

- No contract change: the envelope, exit codes, command table, the 13 error codes, every payload key and the `yakusha/1` dictionary format stay the same.

## [0.31.0] - 2026-10-27

### Fixed

- `install --native` and `uninstall` now keep every native path inside the game root. If `<game>/yakusha/native` or any component target is a symbolic link or junction that resolves elsewhere, the command fails with `E_IO` (`refusing to write outside the project root: <target>`) and writes or deletes nothing. Components are copied through a same-directory temporary file and renamed into place, and `dictionary.txt` / `manifest.json` use the same atomic write, so a pre-existing hard link or symbolic link at the destination cannot be used to overwrite another file.

### Changed

- The path containment check is now one shared helper, `src/core/paths.js`, used by plugin install, Ren'Py translation-file install and the RGSS native layer instead of three separate copies.

### Unchanged

- No contract change: the envelope, exit codes, command table, the 13 error codes, every payload key and the `yakusha/1` dictionary format stay the same.

## [0.30.0] - 2026-10-27

### Changed

- `yakusha/dictionary.json` and the GUI credential envelope are now written to a same-directory temporary file and renamed into place, so an interrupted save leaves the previous file intact instead of a half-written one. This is the same guarantee the config and export writers already had.

### Unchanged

- No contract change: the envelope, exit codes, command table, the 13 error codes, every payload key and the `yakusha/1` dictionary format stay the same.

## [0.29.0] - 2026-10-27

### Changed

- A corrupt or hostile `data/*.json` file no longer makes `scan` / `extract` try all 256 single-byte XOR keys: candidate keys are now filtered by the first decoded byte, so only the handful of keys that can actually produce a JSON document are tried. A 20 MB unreadable data file drops from about 15.7 s to about 0.65 s; valid plain and XOR-encoded files decode exactly as before, and the `undecodable` report is unchanged.

### Unchanged

- No contract change: the envelope, exit codes, command table, the 13 error codes and every payload key stay the same; the dictionary format (`yakusha/1`) is unchanged.

## [0.28.0] - 2026-10-27

### Added

- `doctor` now compares the engine version it detected with the matrix each adapter declares under `versions`: a version outside the supported range is a `warn`, an unreadable version is an `info`, and a supported but untested RGSS family is an `info`. A version inside the matrix adds no line, so ordinary runs keep their existing output. The matrix lives on the adapter and is documented in `docs/engines.md` section 5.1.

### Unchanged

- No contract change: `checks` keeps its `{id, level, message, samples?}` shape and the new `version` id is additive; the envelope, exit codes, command table, the 13 error codes and every payload key stay the same.

## [0.27.0] - 2026-10-27

### Fixed

- A corrupt or hostile XP3 archive can no longer ask the Kirikiri reader for an unbounded allocation: an index stream that claims more bytes than the archive holds, an index or entry that would decompress past 64 MiB, and a segment that points outside the file are now reported as `E_IO` / `E_UNSUPPORTED` and land in `undecodable`, instead of throwing a `RangeError` or exhausting memory.

### Added

- Three regression tests for those malformed-archive paths (`test/krkr-xp3.test.js`), built from synthetic bytes only.

### Unchanged

- No contract change: the envelope, exit codes, command table, the 13 error codes and every payload key stay the same; a normal archive reads exactly as before.

## [0.26.0] - 2026-10-27

### Fixed

- A dictionary key that names an object prototype method (`__proto__`, `constructor` and the like) is stored as an ordinary entry again: loading, writing and importing a dictionary no longer treats such a key as a prototype setter, so it survives a round trip and no longer changes every object in the process.
- Importing a table or JSON file whose source text is one of those names no longer drops the row.

### Unchanged

- No breaking changes: the envelope, exit codes, command table, the 13 error codes and the `yakusha/1` dictionary format are unchanged; a dictionary written before this fix loads exactly as before.

## [0.25.0] - 2026-10-27

### Fixed

- Ren'Py snapshot checks now notice a dictionary whose targets were all cleared after install: the regenerated translation file carries no entries, so `doctor` reports the installed `game/yakusha_translation.rpy` as out of date and asks for a reinstall instead of silently keeping the old translations.

### Unchanged

- No breaking changes: the envelope, exit codes, command table, all 13 error codes, the dictionary format (`yakusha/1`) and every JSON payload key are unchanged.

## [0.24.0] - 2026-10-27

### Changed

- Faster glossary filtering: the translate pipeline now builds an Aho-Corasick index once per run and reuses it for every request instead of scanning every glossary key against every batch. A 10,000-term glossary with a 40-line batch drops from about 7.0 ms to 0.10 ms per request after a one-time build of about 2.1 ms; the selected rows and their order are unchanged. The new `src/pipeline/glossary.js` module is internal and adds no command, option or payload key.

### Unchanged

- No breaking changes: the envelope, exit codes, command table, all 13 error codes, the dictionary format (`yakusha/1`) and every JSON payload key are unchanged.

## [0.23.0] - 2026-10-27

### Added

- Added stale-snapshot detection to the other delivery modes: `doctor` now compares the Ren'Py `game/yakusha_translation.rpy` file and the MZ/MV plugin `EMBEDDED` block against the current project dictionary. A dictionary edited after install is reported as `install: warn` and `runtime: warn` with `verdict: usable` (exit 0), the message points at `install` / `install --embed`, and reinstalling refreshes the snapshot. The new `dictionaryStale` flag stays inside the adapter `delivery` object and is not a JSON payload key.

### Unchanged

- No breaking changes: the envelope, exit codes, command table, all 13 error codes and the dictionary format (`yakusha/1`) are unchanged. Only `doctor` gains warnings for already-installed snapshots.

## [0.22.0] - 2026-10-27

### Added

- Added stale-dictionary detection for an installed RGSS native layer: `nativeStatus()` now rebuilds `dictionary.txt` from the current project dictionary and compares it with the copy written by `install --native`. `doctor` reports a dictionary edited after install as `install: warn` and `runtime: warn` with `verdict: usable` (exit 0), explains that the injector keeps using the install-time snapshot, and running `install --native` again refreshes it.

### Unchanged

- No breaking changes: the envelope, exit codes, command table, all 13 error codes and the dictionary format (`yakusha/1`) are unchanged. `dictionaryStale` is an internal `delivery` field for `doctor`, not a JSON payload key.

## [0.21.0] - 2026-10-27

### Added

- Added an integrity check for an installed RGSS native layer: `nativeStatus()` now re-reads `manifest.json` and verifies the four component files plus the generated `dictionary.txt`. `doctor` reports a deleted or modified component as `install: fail` and `runtime: fail` with `verdict: broken` (exit 1), and `launch` refuses to start a damaged install with `E_IO` instead of falling back to an untranslated game. Running `install --native` again repairs the directory.

### Unchanged

- No breaking changes: the envelope, exit codes, command table, all 13 error codes and the dictionary format (`yakusha/1`) are unchanged. The check only changes what `doctor` and `launch` conclude about an already-damaged native directory.

## [0.20.0] - 2026-10-27

### Added

- Added a dependency-free contract test for the GUI renderer (`test/gui-renderer.test.js`): it loads `gui/renderer/renderer.js` into a stub DOM and covers the successful scan view, capability-driven button state, the multi-root hint, the stale-state reset, the dictionary editor and the key input clearing.

### Fixed

- The GUI now resets the previous engine's capability state when a new scan starts. Before this fix, a successful RGSS scan followed by a failed scan left install/uninstall/launch enabled with the old engine's flags, and a later install could pass `--native` to an engine that does not support it. The renderer resets `lastEngine`, hides the engine badge and disables those three buttons at scan start; the runner and CLI were unaffected.

### Unchanged

- No breaking changes: the envelope, exit codes, command table, all 13 error codes and the dictionary format (`yakusha/1`) are unchanged. The fix is renderer-only.

## [0.19.0] - 2026-10-27

### Fixed

- `verify --kind` now rejects a misspelt problem kind with `E_USAGE` and exit code 2 instead of silently filtering the report to `counts: {}` / `outcome: ok`. The accepted names are `kana`, `echo`, `codes`, `slots`, `lines`, `width`, `no-text`, `trad`, `speaker` and `rejected`; the message names the unknown values and lists the accepted set. Valid `--kind` lists and an empty `--kind` behave as before.

### Unchanged

- No breaking changes to valid invocations: the envelope, exit codes, command table, all 13 error codes and the dictionary format (`yakusha/1`) are unchanged. Only an invalid `--kind` value changes behaviour.

## [0.18.0] - 2026-10-27

### Added

- Added native injector delivery for RGSS: `yakusha install <game> --native` writes `<game>/yakusha/native/` with `yakusha_rgss_hook.dll`, `libunwind.dll`, `yakusha_injector.exe`, `bootstrap.rb`, a generated `dictionary.txt` and a `manifest.json`. The injector starts the game suspended, loads the hook into the 32-bit process and lets `bootstrap.rb` translate every string reachable through `Kernel#load_data`; no existing game file is modified. `--native` is required on RGSS, refused on every other engine with `E_USAGE` and cannot be combined with `--embed`, all before anything is touched.
- Added `install --native --dry-run`: it validates the components and the dictionary, reports the native directory, the four components and the dictionary entry count, and writes nothing.
- Added SHA-256 integrity checks for the native components: `manifest.json` records `{ "schema": 1, "files": { <name>: <sha256> } }` for the four component files, and install refuses a missing file or a hash mismatch with `E_IO` (a missing, unreadable or invalid manifest is `E_CONFIG`) before copying anything.
- Added `uninstall` for the native layer: it removes `<game>/yakusha/native/` recursively, but only when the directory carries a valid Yakusha `manifest.json`; any other directory is refused with `E_CONFIG` instead of deleted.
- Added `launch` support for RGSS: when the native layer is installed the game starts through `yakusha_injector.exe`, with the same `launched` / `pid` output and `{root, exe, pid}` payload as before; without it the previous executable launch is unchanged.
- Added a real `doctor` delivery check for RGSS: before install it reports `not-installed`; after install it reports the installed directory and the number of dictionary strings, and a clean install reaches `ready` (it used to report that the engine had no delivery layer).
- Added GUI wiring for the native delivery: the install and uninstall buttons pass `--native` when the last scan identified an RGSS project.

### Changed

- The npm package now ships the GUI: `gui/` was added to the `files` allowlist in `package.json` (README and LICENSE were already included). `docs/` stays out of the tarball.
- The `scan` capabilities now report `runtime: "inject"` for RGSS (previously null), so capability-aware clients enable the install and uninstall actions for that engine.
- The npm package now publishes the prebuilt native components: `native/prebuilt/` was added to the `files` allowlist in `package.json`. The binaries are built on CI for the 32-bit `i686-pc-windows-gnullvm` target, ship inside the npm package (nothing is downloaded at install time), and `native/prebuilt/` stays out of git.

### Unchanged

- No breaking changes: the envelope, exit codes, command table, all 13 error codes and the dictionary format (`yakusha/1`) are unchanged. The `native` payload key is additive and only appears for RGSS installs.

## [0.17.0] - 2026-10-27

### Added

- Dictionary entries can now carry two optional provenance fields. `engine` records which engine the entry came from (`mz`, `mv`, `renpy`, `rgss`, `krkr`), and `locator` holds the exact position of the source text in the game data: `<file>#<JSON Pointer>` for table-shaped data and `file:line` for line-based engines. Extraction writes both; `export` and `import --format json` copy them through. Old dictionaries without the fields keep working, the format string stays `yakusha/1`, and the TSV / CSV tables remain three columns without provenance.

## [0.16.0] - 2026-10-27

### Added

- The `scan` payload carries the engine's capability flags (`capabilities`: `extract` / `export` / `runtime` / `launch` / `debuggable` / `attach` / `liveReload`). The GUI uses them to disable buttons for operations the engine cannot perform (no delivery layer → install/uninstall disabled with the reason shown). Additive: scripts that ignore unknown keys keep working.
- GUI buttons now follow the capability rules from docs/gui.md §3: unsupported capabilities are grayed out with the reason, instead of failing after a click.

### Fixed

- The Kirikiri XP3 reader now reads real commercial archives: the index container header has two layouts (a 9-byte fixture form and a 17-byte real-world form with an extra uncompressed-size field), and the reader auto-detects them by the zlib header signature; the index entry origin handles both the shared-magic and duplicated-magic shapes. A transformed container header now reports `E_UNSUPPORTED` instead of crashing with a raw `RangeError`.
- `.ks` scenario files with a UTF-16 BOM (common in localized releases) decode via UTF-16LE/BE instead of being reported as `undecodable`.

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

[Unreleased]: https://github.com/MagicalAlmond/Yakusha/compare/v0.59.0...HEAD
[0.59.0]: https://github.com/MagicalAlmond/Yakusha/compare/v0.58.0...v0.59.0
[0.58.0]: https://github.com/MagicalAlmond/Yakusha/compare/v0.57.0...v0.58.0
[0.57.0]: https://github.com/MagicalAlmond/Yakusha/compare/v0.56.0...v0.57.0
[0.56.0]: https://github.com/MagicalAlmond/Yakusha/compare/v0.55.0...v0.56.0
[0.55.0]: https://github.com/MagicalAlmond/Yakusha/compare/v0.54.0...v0.55.0
[0.54.0]: https://github.com/MagicalAlmond/Yakusha/compare/v0.53.0...v0.54.0
[0.53.0]: https://github.com/MagicalAlmond/Yakusha/compare/v0.52.0...v0.53.0
[0.52.0]: https://github.com/MagicalAlmond/Yakusha/compare/v0.51.0...v0.52.0
[0.51.0]: https://github.com/MagicalAlmond/Yakusha/compare/v0.50.0...v0.51.0
[0.50.0]: https://github.com/MagicalAlmond/Yakusha/compare/v0.49.0...v0.50.0
[0.49.0]: https://github.com/MagicalAlmond/Yakusha/compare/v0.48.0...v0.49.0
[0.48.0]: https://github.com/MagicalAlmond/Yakusha/compare/v0.47.0...v0.48.0
[0.47.0]: https://github.com/MagicalAlmond/Yakusha/compare/v0.46.0...v0.47.0
[0.46.0]: https://github.com/MagicalAlmond/Yakusha/compare/v0.45.0...v0.46.0
[0.45.0]: https://github.com/MagicalAlmond/Yakusha/compare/v0.44.0...v0.45.0
[0.44.0]: https://github.com/MagicalAlmond/Yakusha/compare/v0.43.0...v0.44.0
[0.43.0]: https://github.com/MagicalAlmond/Yakusha/compare/v0.42.0...v0.43.0
[0.42.0]: https://github.com/MagicalAlmond/Yakusha/compare/v0.41.0...v0.42.0
[0.41.0]: https://github.com/MagicalAlmond/Yakusha/compare/v0.40.0...v0.41.0
[0.40.0]: https://github.com/MagicalAlmond/Yakusha/compare/v0.39.0...v0.40.0
[0.39.0]: https://github.com/MagicalAlmond/Yakusha/compare/v0.38.0...v0.39.0
[0.38.0]: https://github.com/MagicalAlmond/Yakusha/compare/v0.37.0...v0.38.0
[0.37.0]: https://github.com/MagicalAlmond/Yakusha/compare/v0.36.0...v0.37.0
[0.36.0]: https://github.com/MagicalAlmond/Yakusha/compare/v0.35.0...v0.36.0
[0.35.0]: https://github.com/MagicalAlmond/Yakusha/compare/v0.34.0...v0.35.0
[0.34.0]: https://github.com/MagicalAlmond/Yakusha/compare/v0.33.0...v0.34.0
[0.33.0]: https://github.com/MagicalAlmond/Yakusha/compare/v0.32.0...v0.33.0
[0.32.0]: https://github.com/MagicalAlmond/Yakusha/compare/v0.31.0...v0.32.0
[0.31.0]: https://github.com/MagicalAlmond/Yakusha/compare/v0.30.0...v0.31.0
[0.30.0]: https://github.com/MagicalAlmond/Yakusha/compare/v0.29.0...v0.30.0
[0.29.0]: https://github.com/MagicalAlmond/Yakusha/compare/v0.28.0...v0.29.0
[0.28.0]: https://github.com/MagicalAlmond/Yakusha/compare/v0.27.0...v0.28.0
[0.27.0]: https://github.com/MagicalAlmond/Yakusha/compare/v0.26.0...v0.27.0
[0.26.0]: https://github.com/MagicalAlmond/Yakusha/compare/v0.25.0...v0.26.0
[0.25.0]: https://github.com/MagicalAlmond/Yakusha/compare/v0.24.0...v0.25.0
[0.24.0]: https://github.com/MagicalAlmond/Yakusha/compare/v0.23.0...v0.24.0
[0.23.0]: https://github.com/MagicalAlmond/Yakusha/compare/v0.22.0...v0.23.0
[0.22.0]: https://github.com/MagicalAlmond/Yakusha/compare/v0.21.0...v0.22.0
[0.21.0]: https://github.com/MagicalAlmond/Yakusha/compare/v0.20.0...v0.21.0
[0.20.0]: https://github.com/MagicalAlmond/Yakusha/compare/v0.19.0...v0.20.0
[0.19.0]: https://github.com/MagicalAlmond/Yakusha/compare/v0.18.0...v0.19.0
[0.18.0]: https://github.com/MagicalAlmond/Yakusha/compare/v0.17.0...v0.18.0
[0.17.0]: https://github.com/MagicalAlmond/Yakusha/compare/v0.16.0...v0.17.0
[0.16.0]: https://github.com/MagicalAlmond/Yakusha/compare/v0.15.0...v0.16.0
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
