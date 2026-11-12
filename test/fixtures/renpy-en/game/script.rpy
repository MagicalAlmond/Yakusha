# Synthetic English Ren'Py script for the source-language tests.
# Every line here is invented for this repository; no real game text is used.

define e = Character("Edie")
define sign = _("Faded lettering.")

label start:
    "The harbor bell rings twice."
    e "We should head back before dark."
    menu:
        "What should we do?"
        "Take the road.":
            e "The road it is."
        "Wait by the water.":
            e "Then we wait."
    $ flag = True
    call notice
    return

label notice:
    "A short sign."

screen harbor_notice():
    text "Harbor notice: no boats today."
    textbutton "Leave" action Return()
