"""Kith Parent's icon: the Buddy icon with a small parent badge (an ember circle with a heart).

Run from mac/:  python3 icons-parent/make.py   (needs Pillow; writes icons-parent/*.png and icon.icns)
"""
import os, subprocess, tempfile
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "..", "design", "icon", "icons", "desktop", "icon-1024.png")
S = 4  # draw big, then scale down for smooth edges

base = Image.open(SRC).convert("RGBA").resize((1024 * S, 1024 * S), Image.LANCZOS)
d = ImageDraw.Draw(base)
cx, cy, r = 760 * S, 760 * S, 170 * S
ring = 22 * S
d.ellipse((cx - r - ring, cy - r - ring, cx + r + ring, cy + r + ring), fill=(28, 18, 25, 255))   # plum ring
d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(245, 150, 70, 255))                             # ember
# A heart: two circles and a triangle.
h = 0.55 * r
lobe = h * 0.52
top = cy - h * 0.35
plum = (42, 23, 12, 255)
d.ellipse((cx - 2 * lobe + lobe * 0.08, top - lobe, cx + lobe * 0.08, top + lobe), fill=plum)
d.ellipse((cx - lobe * 0.08, top - lobe, cx + 2 * lobe - lobe * 0.08, top + lobe), fill=plum)
d.polygon([(cx - 2 * lobe + lobe * 0.16, top + lobe * 0.35), (cx + 2 * lobe - lobe * 0.16, top + lobe * 0.35), (cx, cy + h * 0.95)], fill=plum)
icon = base.resize((1024, 1024), Image.LANCZOS)

for n in (32, 128, 256, 512, 1024):
    icon.resize((n, n), Image.LANCZOS).save(os.path.join(HERE, f"icon-{n}.png"))

with tempfile.TemporaryDirectory() as t:
    iconset = os.path.join(t, "icon.iconset")
    os.mkdir(iconset)
    for n in (16, 32, 128, 256, 512):
        icon.resize((n, n), Image.LANCZOS).save(os.path.join(iconset, f"icon_{n}x{n}.png"))
        icon.resize((n * 2, n * 2), Image.LANCZOS).save(os.path.join(iconset, f"icon_{n}x{n}@2x.png"))
    subprocess.run(["iconutil", "-c", "icns", iconset, "-o", os.path.join(HERE, "icon.icns")], check=True)
print("ok")
