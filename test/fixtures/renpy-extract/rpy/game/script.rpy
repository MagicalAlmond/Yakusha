# Synthetic fixture, written for tests. No real game content.
define narrator = Character("Narrator Placeholder")

label start:
    "Alpha line one."
    narrator "Beta line two."

    menu:
        "Gamma menu caption."
        "Delta choice one.":
            jump chapter_one
        "Epsilon choice two.":
            jump chapter_one

    return

label chapter_one:
    "Shared echo line."
    return
