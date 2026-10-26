# Synthetic fixture, written for tests.
define config.name = "Sigma Config Name"
define e = Character("Tau Speaker", color="#ffffff")
define greeting = _("Upsilon Marked Define")
default player_name = "Phi Default Name"

image bg room = "images/chi-room.png"
image bg placeholder = Solid("#000000")

label start:
    $ greeting = "Psi forced local"
    python:
        hidden_one = "Omega python value"
    $ marked = _("Alpha marked dollar line")
    e "Beta dialogue with _ ( loose parens )"
    e _("Gamma marked dialogue")
    $ renpy.notify(_("Delta notified"))
    return
