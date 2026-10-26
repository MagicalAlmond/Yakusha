# Synthetic fixture, written for tests. No real game content.
label start:
    scene bg room with dissolve
    show alice neutral

    "A quiet room with a single lamp."
    alice "Alpha line one."
    alice happy "Beta line two."
    "Gamma line three." with dissolve
    extend " Delta line four."
    alice "Epsilon a\"quoted\" word."
    alice "Zeta\\slash and a\\nnewline."
    alice "Eta\[bracket\] and \{brace\} and 100\% done."
    alice "Theta  collapsed   spacing."
    alice "Iota speaks." nointeract
    alice "Kappa speaks." id kappa_line

    menu:
        "Lambda caption."

        "Mu choice one.":
            jump one
        "Nu choice two." if flag_one:
            jump two
        "Xi choice three.":
            jump three

    return

label one:
    """
    Omicron monologue paragraph one.

    Pi monologue paragraph two
    wrapped over two source lines.

    Rho monologue paragraph three.
    """
    return

label two:
    "Nora" "Sigma literal speaker line."
    "Nora" "Tau literal speaker with a clause." with dissolve
    "Nora" "Upsilon literal speaker, nointeract." nointeract
    return
