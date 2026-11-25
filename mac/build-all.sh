#!/bin/sh
# Builds both Mac apps, Kith (the child's) and Kith Parent (the grown-up's), and copies each .app
# and .dmg into mac/dist/, then makes the styled installers (installer/make-dmgs.sh). Tauri empties its dmg folder on every build, hence the copies.
# CI=true skips the Finder window the .dmg layout step would otherwise open.
#
# Release builds are universal: one app for Apple silicon and Intel Macs (--target universal-apple-darwin).
# That needs both Rust targets, once:
#   rustup target add aarch64-apple-darwin x86_64-apple-darwin
# and the script stops if one is missing. KITH_UNIVERSAL=0 builds for this Mac only (quicker, for trying things out;
# don't hand those builds to anyone).
#
# Both apps are signed ad hoc ("signingIdentity": "-" in tauri.conf.json), so the whole bundle is sealed and a
# downloaded copy isn't called "damaged". Set APPLE_SIGNING_IDENTITY for a Developer ID build (docs/macos.md).
#
# Updates (docs/macos.md › Updates): when mac/kith.config.json has both updateUrl and updatePublicKey, the build also
# makes the signed update archives (bundle.createUpdaterArtifacts), and needs TAURI_SIGNING_PRIVATE_KEY for that.
# They're copied to mac/dist as Kith.app.tar.gz and Kith-Parent.app.tar.gz, each with its .sig; then
# installer/update-manifest.py writes the latest.json files for a GitHub release.
set -eu
cd "$(dirname "$0")/src-tauri"
out=../dist
rm -rf "$out" && mkdir -p "$out"

if [ "${KITH_UNIVERSAL:-1}" = 0 ]; then
  set --
  B=target/release/bundle
  echo "Building for this Mac only ($(uname -m)), because KITH_UNIVERSAL=0. Not for handing out." >&2
else
  installed="$(rustup target list --installed 2>/dev/null || true)"
  missing=""
  for t in aarch64-apple-darwin x86_64-apple-darwin; do
    printf '%s\n' "$installed" | grep -qx "$t" || missing="$missing $t"
  done
  if [ -n "$missing" ]; then
    echo "error: the universal build (Apple silicon and Intel) needs the Rust target(s):$missing" >&2
    echo "  rustup target add$missing" >&2
    echo "(or KITH_UNIVERSAL=0 to build for this Mac only)" >&2
    exit 1
  fi
  set -- --target universal-apple-darwin
  B=target/universal-apple-darwin/release/bundle
  echo "Building universal apps (Apple silicon and Intel)."
fi

# The update switch: the same two settings that turn the updater on in the app (updater.rs).
setting() { plutil -extract "$1" raw -o - ../kith.config.json 2>/dev/null || true; }
updates=no
if [ -n "$(setting updateUrl)" ] && [ -n "$(setting updatePublicKey)" ]; then
  if [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
    echo "error: mac/kith.config.json turns updates on, so the update archives must be signed:" >&2
    echo "  set TAURI_SIGNING_PRIVATE_KEY (the key or its path) and TAURI_SIGNING_PRIVATE_KEY_PASSWORD (docs/macos.md › Updates)" >&2
    exit 1
  fi
  updates=yes
  set -- "$@" --config '{"bundle":{"createUpdaterArtifacts":true}}'
  echo "Updates are on: making the signed update archives too."
fi

# $1: the app's name, $2: its name in the update files (no spaces: GitHub renames them).
copy_out() {
  cp -R "$B/macos/$1.app" "$out/"
  if [ "$updates" = yes ]; then
    cp "$B/macos/$1.app.tar.gz" "$out/$2.app.tar.gz"
    cp "$B/macos/$1.app.tar.gz.sig" "$out/$2.app.tar.gz.sig"
  fi
}

CI=true cargo tauri build "$@"
copy_out "Kith" "Kith"
cp "$B"/dmg/Kith_*.dmg "$out/"
CI=true cargo tauri build "$@" --config tauri.parent.conf.json
copy_out "Kith Parent" "Kith-Parent"
cp "$B"/dmg/Kith\ Parent_*.dmg "$out/"
# Styled drag-to-Applications installers (needs dmgbuild; otherwise Tauri's plain .dmg files stay).
../installer/make-dmgs.sh
