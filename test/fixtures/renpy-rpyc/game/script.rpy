# Synthetic script written for yakusha's Ren'Py decoder tests.
# Every line of text below is placeholder text invented for this fixture;
# it is not taken from any game or from the Ren'Py SDK's sample projects.

define a = Character("Alpha")

label start:
    a "Alpha line one."
    a "Alpha line two with a quote: \"quoted\".
Second half after a line break."
    "Narration line in kana: テスト用のダミー行です。"
    a "Line with a tag: {i}italic{/i} and a slot: [player_name]."

    menu:
        "Are you sure?"
        "Yes, continue.":
            jump chosen
        "No, go back.":
            jump chosen

label chosen:
    $ greeting = _("Settings")
    return

translate japanese strings:
    old "Settings"
    new "セッテイ・ダミー"

translate japanese say_alpha_one:
    a "Alpha line one."
