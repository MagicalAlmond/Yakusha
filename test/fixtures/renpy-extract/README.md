# Ren'Py extractor fixtures

Every project below is a directory holding a single `game/` directory, the layout
`extractRenpyProject` expects. All dialogue, menu caption, choice and character
text in these fixtures was written for the tests; no sample game shipped with the
Ren'Py SDK was copied here.

| Directory | Contents |
| --- | --- |
| `rpy/` | a source-only project: `game/script.rpy` plus `game/sub/chapter.rpy`, whose only shared line exercises the duplicate-text path |
| `rpyc/` | a compiled-only project: one `.rpyc` |
| `mixed/` | one `.rpy` and one `.rpyc` in the same `game/` directory |
| `broken/` | two undecodable `.rpyc` files next to one good `.rpy`, so the tests can prove a bad file does not cost the caller the rest of the project |
| `lineless/` | a `.rpyc` whose nodes carry no line number, so the context key has to fall back to the bare path |

## Provenance of the compiled fixtures

`rpyc/game/script.rpyc` and `mixed/game/compiled.rpyc` are byte copies of
`test/fixtures/renpy-rpyc/game/script.rpyc`. That file was produced by compiling a
hand-written `.rpy` (itself synthetic, see the README next to it) with the Ren'Py
8.5.3 SDK outside this repository and copying only the two resulting files in. The
compiler records paths relative to the game directory, so the binary carries no
build-machine path. The tests never invoke Ren'Py; they decode committed bytes.

`lineless/game/script.rpyc` is generated, not compiled: a minimal AST of one
dialogue node, one menu node and one translation-string node is pickled with the
CPython standard library (`pickle.dumps`, protocol 2) and wrapped in the
`RENPY RPC2` container (10-byte marker, one 12-byte `(slot, start, length)` record,
a zero record ending the table, one zlib stream, 16 trailing zero bytes). None of
those nodes sets `linenumber`, which is the whole point of the fixture.

`broken/game/broken.rpyc` is a `RENPY RPC2` marker followed by a truncated slot
table. `broken/game/stray.rpyc` is plain text saved under a `.rpyc` name: it has
neither the marker nor a zlib stream.

No test asserts the exact bytes of a compiled fixture, only the decoded structure.
