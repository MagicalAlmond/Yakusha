# Ren'Py compiled-screen fixture

`game/screens.rpyc` is a synthetic but format-accurate `.rpyc` container. It
is not produced by the Ren'Py SDK: the AST was built as plain Python objects
with the same class names and field shapes a compiled 8.5.3 screen uses, then
pickled and wrapped in the same `RENPY RPC2` slot table. The decoder therefore
sees the real container format and the real screen-tree shape without carrying
any game text into the repository.

`source/screens.rpy` is the hand-written source that the synthetic tree
describes. It is documentation only and is deliberately outside `game/`, so
the integration tests exercise the compiled path rather than the source path.

## What the fixture covers

| Feature | Expected result |
| --- | --- |
| Five quick-menu `textbutton` labels | `Back`, `Skip`, `Auto`, `Hide`, `Menu` |
| Text with Ren'Py markup | one `screen` unit with the markup intact |
| `text who` | skipped: a variable is not display text |
| `_("Say " + name)` | skipped: a concatenation is not one literal |
| A `button` containing a child `text` | `Nested` is found through `children` |
| `text "[message!tq]"` | skipped: only a runtime substitution remains |
| `text "▸"` | skipped: no letter or digit remains |
| `text "A\nB"` | decoded to a real newline |

The compiled tree has one `Init` containing one `Screen`, one `SLScreen`, one
`SLBlock`, and the displayables above; the walk reports 17 nodes and 8 units.
