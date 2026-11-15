# Synthetic fixture for a plugin-owned displayable. It is never compiled by the
# test suite; custom.rpyc beside it is the committed compiled form.

screen plugin_overlay():
    my_label _("Marked")
    text _("Plain")
