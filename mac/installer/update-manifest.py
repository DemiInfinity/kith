#!/usr/bin/env python3
"""Writes the update manifests (Tauri's latest.json) for a GitHub release of the Mac apps.

    mac/installer/update-manifest.py --repo OWNER/NAME --tag v0.3.0 [--notes "What's new"] [--dist mac/dist]

Reads the signed update archives build-all.sh copies to mac/dist when updates are on (Kith.app.tar.gz and
Kith-Parent.app.tar.gz, each with its .sig) and writes, next to them:

    latest-child.json   for Kith        (updateUrl's {app} is "child")
    latest-parent.json  for Kith Parent ({app} is "parent")

Upload the archives and both manifests to the release. Then an updateUrl of
    https://github.com/OWNER/NAME/releases/latest/download/latest-{app}.json
always finds the newest. The builds are universal, so one archive serves Apple silicon and Intel.
Nothing is signed here: the .sig files come from the build (TAURI_SIGNING_PRIVATE_KEY); this only copies them in.
"""

import argparse
import datetime
import json
import pathlib
import re
import sys

APPS = {"child": "Kith", "parent": "Kith-Parent"}
# Tauri's updater looks for "<os>-<arch>"; a universal app is the same archive for both.
PLATFORMS = ("darwin-aarch64", "darwin-x86_64")


def manifest(version, notes, url, signature, now):
    return {
        "version": version,
        "notes": notes,
        "pub_date": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "platforms": {p: {"signature": signature, "url": url} for p in PLATFORMS},
    }


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--repo", required=True, help="the GitHub repository, OWNER/NAME")
    ap.add_argument("--tag", required=True, help="the release's tag, e.g. v0.3.0")
    ap.add_argument("--version", help="the apps' version (default: the tag without its v)")
    ap.add_argument("--notes", default="", help="what's new, shown in the update prompt")
    ap.add_argument("--dist", default=str(pathlib.Path(__file__).resolve().parent.parent / "dist"))
    a = ap.parse_args(argv)

    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", a.repo):
        sys.exit("--repo should look like OWNER/NAME")
    version = a.version or a.tag.removeprefix("v")
    if not re.fullmatch(r"\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?", version):
        sys.exit(f"{version!r} isn't a version like 0.3.0 (give --version)")

    dist = pathlib.Path(a.dist)
    now = datetime.datetime.now(datetime.timezone.utc)
    for app, name in APPS.items():
        archive = dist / f"{name}.app.tar.gz"
        sig = dist / f"{name}.app.tar.gz.sig"
        if not archive.is_file() or not sig.is_file():
            sys.exit(f"missing {archive.name} or its .sig in {dist}: build with updates on (docs/macos.md › Updates)")
        url = f"https://github.com/{a.repo}/releases/download/{a.tag}/{archive.name}"
        out = dist / f"latest-{app}.json"
        out.write_text(json.dumps(manifest(version, a.notes, url, sig.read_text().strip(), now), indent=2) + "\n")
        print(out)


if __name__ == "__main__":
    main()
