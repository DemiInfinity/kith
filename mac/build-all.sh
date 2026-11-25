#!/bin/sh
# Builds both Mac apps, Kith (the child's) and Kith Parent (the grown-up's), and copies each .app
# and .dmg into mac/dist/. Tauri empties its dmg folder on every build, hence the copies.
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
ls -1 "$out"
