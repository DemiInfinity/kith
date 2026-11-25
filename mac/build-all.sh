#!/bin/sh
# Builds both Mac apps, Kith (the child's) and Kith Parent (the grown-up's), and copies each .app
# and .dmg into mac/dist/, then makes the styled installers (installer/make-dmgs.sh). Tauri empties its dmg folder on every build, hence the copies.
# CI=true skips the Finder window the .dmg layout step would otherwise open.
#
# One app for both kinds of Mac (Apple silicon and Intel) when Rust can build for both:
#   rustup target add aarch64-apple-darwin x86_64-apple-darwin
# Otherwise it builds for this Mac only and says so. KITH_UNIVERSAL=0 always builds for this Mac;
# KITH_UNIVERSAL=1 insists on the universal build (and fails without the targets).
set -eu
cd "$(dirname "$0")/src-tauri"
out=../dist
rm -rf "$out" && mkdir -p "$out"

installed="$(rustup target list --installed 2>/dev/null || true)"
has() { printf '%s\n' "$installed" | grep -qx "$1"; }
case "${KITH_UNIVERSAL:-auto}" in
  0) universal=no ;;
  1) universal=yes ;;
  *) if has aarch64-apple-darwin && has x86_64-apple-darwin; then universal=yes; else universal=no; fi ;;
esac
if [ "$universal" = yes ]; then
  set -- --target universal-apple-darwin
  B=target/universal-apple-darwin/release/bundle
  echo "Building universal apps (Apple silicon and Intel)."
else
  set --
  B=target/release/bundle
  echo "Building for this Mac only ($(uname -m)). For Intel Macs too: rustup target add aarch64-apple-darwin x86_64-apple-darwin" >&2
fi

CI=true cargo tauri build "$@"
cp -R "$B/macos/Kith.app" "$out/"
cp "$B"/dmg/Kith_*.dmg "$out/"
CI=true cargo tauri build "$@" --config tauri.parent.conf.json
cp -R "$B/macos/Kith Parent.app" "$out/"
cp "$B"/dmg/Kith\ Parent_*.dmg "$out/"
# Styled drag-to-Applications installers (needs dmgbuild; otherwise Tauri's plain .dmg files stay).
../installer/make-dmgs.sh
