# Synthetic fixture, written for tests.
screen sample_screen(title):
    tag menu
    frame:
        vbox:
            text "Alpha Screen Title" style "title_style"
            textbutton "Beta Start" action Start()
            textbutton _("Gamma Continue") action Continue()
            label "Delta Section"
            tooltip "Epsilon Hint"
            notify "Zeta Toast"
            text "Eta [player_name] interpolated {b}bold{/b}"
            imagebutton idle "images/theta-button.png" action NullAction()
            text "Iota Second Text"
    if persistent.flag:
        textbutton "Kappa Hidden"

screen another_screen():
    vbox:
        text "Lambda Other Screen"
