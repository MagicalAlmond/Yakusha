# Ren'Py `.rpyc` fixture

`game/script.rpy` is compiled by Ren'Py into `game/script.rpyc`. The test suite
reads the compiled bytes only; Ren'Py is never installed or invoked by the
tests, so this fixture is what lets the decoder be tested on a real container.

## Provenance

- `game/script.rpy` is written by hand for these tests. Every line of text in
  it is invented placeholder text (English placeholders plus kana) and is not
  copied from any game, including the sample projects shipped with the SDK.
- `game/script.rpyc` was produced by compiling that file with the Ren'Py
  8.5.3 SDK, outside this repository, and only these two files were copied in.
  Nothing else from the build (caches, saves, engine sources) is included.
- The compiler records source locations as paths relative to the game root
  (`game/script.rpy`), so the binary carries no build-machine path.

## What the script covers

| Feature | Where |
| --- | --- |
| Plain say line | `script.rpy:8` |
| Say line with escaped quotes and a line break | `script.rpy:9` |
| Narration (no speaker) with kana | `script.rpy:11` |
| Text tag `{i}` and substitution slot `[player_name]` | `script.rpy:12` |
| Menu with a caption and two choices | `script.rpy:14` |
| String translation via `_` plus `translate ... strings` | `script.rpy:22`, `script.rpy:25` |
| Say translation block | `script.rpy:29` |

The compiled tree has 7 top-level statements and the walk finds 19 nodes,
5 say units, 1 menu and 10 string units in total.

## Rebuilding

Compiling requires the SDK and is not part of the test run. With the SDK
available, run `renpy.exe <dir> compile` against a directory holding
`game/script.rpy`, then copy `game/script.rpy` and `game/script.rpyc` here.
The exact bytes of the `.rpyc` are not asserted; the tests assert the decoded
structure, so a rebuild with a different 8.x version keeps them meaningful.
