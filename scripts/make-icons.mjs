// Draws Kith's app icons (the three overlapping circles) as PNGs without any dependencies.
import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";

const OUT = path.resolve(process.argv[2] ?? "client/public");
const BG = [0x1c, 0x12, 0x19];
const shapes = (s, pad) => {
  const k = (s * (1 - 2 * pad)) / 48, o = s * pad;
  return [
    { cx: o + 19 * k, cy: o + 25 * k, r: 13 * k, c: [0xd9, 0xa3, 0xe0], a: 1 },
    { cx: o + 30 * k, cy: o + 22 * k, r: 13 * k, c: [0xf5, 0x96, 0x46], a: 0.85 },
    { cx: o + 24.5 * k, cy: o + 23.5 * k, r: 5.5 * k, c: [0xff, 0xf4, 0xfb], a: 1 },
  ];
};

function png(size, pad, rounded) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const sh = shapes(size, pad);
  const rad = rounded ? size * 0.22 : 0;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let col = [...BG];
      for (const s of sh) {
        // 4x supersampling for smooth edges
        let cov = 0;
        for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
          const dx = x + (sx + 0.5) / 4 - s.cx, dy = y + (sy + 0.5) / 4 - s.cy;
          if (dx * dx + dy * dy <= s.r * s.r) cov++;
        }
        const a = (cov / 16) * s.a;
        col = col.map((v, i) => v * (1 - a) + s.c[i] * a);
      }
      let alpha = 255;
      if (rad) {
        const cx = Math.min(Math.max(x + 0.5, rad), size - rad), cy = Math.min(Math.max(y + 0.5, rad), size - rad);
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        alpha = Math.round(255 * Math.min(1, Math.max(0, rad - d + 0.5)));
      }
      const i = y * (size * 4 + 1) + 1 + x * 4;
      raw[i] = col[0]; raw[i + 1] = col[1]; raw[i + 2] = col[2]; raw[i + 3] = alpha;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

fs.writeFileSync(path.join(OUT, "icon-180.png"), png(180, 0.06, false));
fs.writeFileSync(path.join(OUT, "icon-192.png"), png(192, 0.06, true));
fs.writeFileSync(path.join(OUT, "icon-512.png"), png(512, 0.06, true));
fs.writeFileSync(path.join(OUT, "icon-512-maskable.png"), png(512, 0.16, false));
console.log("icons written to", OUT);
