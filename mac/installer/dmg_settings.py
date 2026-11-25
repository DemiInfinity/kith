# dmgbuild settings for Kith's drag-to-Applications installers.
# Used by make-dmgs.sh:  dmgbuild -s dmg_settings.py -D app=<path to .app> -D bg=<background.tiff> "<Volume name>" out.dmg
import os

application = defines["app"]  # noqa: F821  (dmgbuild provides `defines`)
appname = os.path.basename(application)

format = "UDZO"
filesystem = "HFS+"
files = [application]
symlinks = {"Applications": "/Applications"}
badge_icon = None
icon = os.path.join(application, "Contents", "Resources", "icon.icns")  # the volume icon

background = defines["bg"]  # noqa: F821  (660x420 with a 2x layer)
window_rect = ((200, 120), (660, 420))
default_view = "icon-view"
show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False
arrange_by = None
icon_size = 112
text_size = 13
icon_locations = {appname: (165, 215), "Applications": (495, 215)}
# No hide_extensions: it sets a Finder flag (com.apple.FinderInfo) on the app, which breaks its signature
# check (codesign --strict). Finder hides ".app" anyway.
