# Synthetic fixture, written for tests.
init python:
    hidden_boot = "Alpha boot value"
    config.window_title = "Beta title value"

python early:
    hidden_early = "Gamma early value"

label start:
    $ hidden_local = "Delta local value"
    "Epsilon visible line"
    python:
        hidden_inline = "Zeta inline value"
    "Eta visible after block"
    return
