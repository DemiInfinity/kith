#!/bin/sh
# Makes the styled drag-to-Applications installers, mac/dist/Kith.dmg and "mac/dist/Kith Parent.dmg",
# from the .app files build-all.sh puts in mac/dist. Needs dmgbuild (pip install dmgbuild); set
# DMGBUILD to its path if it isn't on PATH. The layout is written directly, so it doesn't depend on
# the Finder settings of the Mac that builds it.
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
dist="$here/../dist"
apps="${KITH_APPS_DIR:-$dist}"   # where the .app files are (default mac/dist)
DMGBUILD="${DMGBUILD:-dmgbuild}"
if ! command -v "$DMGBUILD" >/dev/null 2>&1; then
  echo "dmgbuild not found: keeping Tauri's plain .dmg files. (pip install dmgbuild, or set DMGBUILD)" >&2
  exit 0
fi
make() { # $1 app name, $2 background
  rm -f "$dist/$1.dmg"
  "$DMGBUILD" -s "$here/dmg_settings.py" -D app="$apps/$1.app" -D bg="$here/$2" "$1" "$dist/$1.dmg"
}
make "Kith" bg-kith.tiff
make "Kith Parent" bg-parent.tiff
rm -f "$dist"/Kith_*.dmg "$dist"/Kith\ Parent_*.dmg
ls -1 "$dist"
