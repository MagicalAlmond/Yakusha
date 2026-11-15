# Synthetic fixture for the .rpyc screen reader. It is never compiled by the
# test suite; screens.rpyc beside it is the committed compiled form.

screen quick_menu():
    vbox:
        textbutton _("Back")
        textbutton _("Skip")
        textbutton _("Auto")
        textbutton _("Hide")
        textbutton _("Menu")
        text "{size=16}{color=#FFF}Back{/color}{/size}"
        text who
        textbutton _("Say " + name)
        button:
            text _("Nested")
        text "[message!tq]"
        text "▸"
        text "A\nB"
