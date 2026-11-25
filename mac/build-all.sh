#!/bin/sh
# Builds both Mac apps, Kith (the child's) and Kith Parent (the grown-up's), and copies each .app
# and .dmg into mac/dist/, then makes the styled installers (installer/make-dmgs.sh). Tauri empties its dmg folder on every build, hence the copies.
# CI=true skips the Finder window the .dmg layout step would otherwise open.
set -eu
cd "$(dirname "$0")/src-tauri"
out=../dist
rm -rf "$out" && mkdir -p "$out"
B=target/release/bundle
CI=true cargo tauri build
cp -R "$B/macos/Kith.app" "$out/"
cp "$B"/dmg/Kith_*.dmg "$out/"
CI=true cargo tauri build --config tauri.parent.conf.json
cp -R "$B/macos/Kith Parent.app" "$out/"
cp "$B"/dmg/Kith\ Parent_*.dmg "$out/"
# Styled drag-to-Applications installers (needs dmgbuild; otherwise Tauri's plain .dmg files stay).
../installer/make-dmgs.sh
