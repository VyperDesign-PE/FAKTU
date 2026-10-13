/**
 * Genera los iconos instalables (PNG) con el mismo isotipo que <BrandMark />.
 * Sin dependencias: dibuja con supersampling y codifica PNG con zlib.
 * Uso: npm --workspace @app/mobile run icons
 */
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { light } from "../src/brand/palette";
import { MARK_BARS, MARK_DOT, MARK_RADIUS } from "../src/brand/mark";

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const BG = hex(light.primary), WHITE = [255, 255, 255], MINT = hex(light.mint);

function crc32(buf: Buffer) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size: number, rgba: Uint8Array) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** `scale` reduce el dibujo hacia el centro (zona segura de iconos "maskable"); `full` rellena todo el cuadro. */
function render(size: number, { full = false, scale = 1 }: { full?: boolean; scale?: number } = {}) {
  const SS = 4, out = new Uint8Array(size * size * 4);
  const tx = (v: number) => 0.5 + (v - 0.5) / scale;
  const inTile = (u: number, v: number) => {
    if (full) return true;
    const r = MARK_RADIUS, x = Math.min(u, 1 - u), y = Math.min(v, 1 - v);
    if (x >= r || y >= r) return true;
    return (r - x) ** 2 + (r - y) ** 2 <= r * r;
  };
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const u = (px + (sx + 0.5) / SS) / size, v = (py + (sy + 0.5) / SS) / size;
      if (!inTile(u, v)) continue;
      const mu = tx(u), mv = tx(v);
      let color = BG;
      if (MARK_BARS.some((bar) => mu >= bar.x && mu <= bar.x + bar.w && mv >= bar.y && mv <= bar.y + bar.h)) color = WHITE;
      if ((mu - MARK_DOT.cx) ** 2 + (mv - MARK_DOT.cy) ** 2 <= MARK_DOT.r ** 2) color = MINT;
      r += color[0]; g += color[1]; b += color[2]; a += 255;
    }
    const n = SS * SS, i = (py * size + px) * 4;
    const cover = a / 255;
    out[i] = cover ? r / cover : 0; out[i + 1] = cover ? g / cover : 0; out[i + 2] = cover ? b / cover : 0; out[i + 3] = (a / n);
  }
  return png(size, out);
}

const root = join(import.meta.dirname, "..");
const targets: Array<[string, number, { full?: boolean; scale?: number }?]> = [
  ["assets/icon.png", 1024], ["public/icon-512.png", 512], ["public/icon-192.png", 192], ["public/favicon.png", 48],
  ["public/icon-maskable-512.png", 512, { full: true, scale: 0.8 }]
];
for (const [file, size, options] of targets) { writeFileSync(join(root, file), render(size, options)); console.log(`${file} (${size}x${size})`); }
