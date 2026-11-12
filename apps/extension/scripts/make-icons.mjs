// Generates the extension icons as valid PNG files without any native dependency.
// Design: deep-teal rounded square, paper-coloured "D" monogram, amber accent dot.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "icons");
mkdirSync(outDir, { recursive: true });

const TEAL = [0x0f, 0x6e, 0x63];
const PAPER = [0xfb, 0xf8, 0xf3];
const AMBER = [0xe0, 0xa4, 0x58];

const crcTable = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Supersampled coverage for soft edges.
function coverage(size, x, y, inside) {
  const s = 4;
  let hit = 0;
  for (let i = 0; i < s; i++) for (let j = 0; j < s; j++) if (inside((x + (i + 0.5) / s) / size, (y + (j + 0.5) / s) / size)) hit++;
  return hit / (s * s);
}
const roundedSquare = (u, v, r) => {
  const cx = Math.min(Math.max(u, r), 1 - r);
  const cy = Math.min(Math.max(v, r), 1 - r);
  return (u - cx) ** 2 + (v - cy) ** 2 <= r * r;
};
// "D" monogram: stem + half disc, hollowed.
const dGlyph = (u, v) => {
  const x0 = 0.28, x1 = 0.44, top = 0.24, bot = 0.76, cx = 0.44, cy = 0.5, R = 0.26, r = 0.12;
  const stem = u >= x0 && u <= x1 && v >= top && v <= bot;
  const outer = u >= cx && (u - cx) ** 2 + (v - cy) ** 2 <= R * R;
  const inner = u >= cx && (u - cx) ** 2 + (v - cy) ** 2 <= r * r;
  const innerStem = u >= x1 - 0.02 && u <= cx && v >= cy - r && v <= cy + r;
  return (stem || outer) && !(inner || innerStem);
};
const dot = (u, v) => (u - 0.78) ** 2 + (v - 0.26) ** 2 <= 0.07 ** 2;

for (const size of [16, 32, 48, 128]) {
  const buf = png(size, (x, y) => {
    const bg = coverage(size, x, y, (u, v) => roundedSquare(u, v, 0.22));
    if (bg === 0) return [0, 0, 0, 0];
    const g = size >= 32 ? coverage(size, x, y, dGlyph) : coverage(size, x, y, (u, v) => dGlyph(u, v));
    const d = size >= 32 ? coverage(size, x, y, dot) : 0;
    const mix = (a, b, t) => Math.round(a + (b - a) * t);
    let c = TEAL;
    c = [mix(c[0], PAPER[0], g), mix(c[1], PAPER[1], g), mix(c[2], PAPER[2], g)];
    c = [mix(c[0], AMBER[0], d), mix(c[1], AMBER[1], d), mix(c[2], AMBER[2], d)];
    return [c[0], c[1], c[2], Math.round(255 * bg)];
  });
  writeFileSync(join(outDir, `icon-${size}.png`), buf);
}
console.log("icons written to", outDir);
