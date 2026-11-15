# Ren'Py plugin-displayable fixture

game/custom.rpyc is a synthetic but format-accurate .rpyc container for a screen
whose first displayable is owned by a plugin. It is not produced by the Ren'Py
SDK: the AST was built as plain Python objects with the same class names and
field shapes a compiled 8.5.3 screen uses, then pickled and wrapped in the same
RENPY RPC2 slot table.

source/custom.rpy is the hand-written source the synthetic tree describes.

| Feature | Expected result |
| --- | --- |
| A plugin displayable my_label _("Marked") | Marked found by its explicit marker |
| text _("Plain") | Plain found as an ordinary Ren'Py text |
