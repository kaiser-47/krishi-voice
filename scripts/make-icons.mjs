/*
 * Generates the PWA icons with a tiny built-in PNG encoder (no dependencies).
 * Run: npm run icons
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function png(size, painter) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = painter(x / size, y / size);
      const o = y * stride + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* A green field with a white microphone and a small red chilli dot. */
function painter(u, v, scale = 1) {
  const x = 0.5 + (u - 0.5) / scale;
  const y = 0.5 + (v - 0.5) / scale;

  const r = 27;
  const g = 107;
  const b = 47;

  const capX = Math.abs(x - 0.5) < 0.075;
  const capY = y > 0.25 && y < 0.55;
  const capRound = Math.hypot(x - 0.5, y - 0.25) < 0.075 || Math.hypot(x - 0.5, y - 0.55) < 0.075;
  if ((capX && capY) || capRound) return [255, 255, 255, 255];

  const dist = Math.hypot(x - 0.5, y - 0.31);
  if (y > 0.33 && y < 0.63 && dist > 0.175 && dist < 0.205) return [255, 255, 255, 235];

  if (Math.abs(x - 0.5) < 0.017 && y > 0.62 && y < 0.72) return [235, 245, 230, 255];
  if (Math.abs(x - 0.5) < 0.095 && Math.abs(y - 0.735) < 0.016) return [235, 245, 230, 255];

  const rdx = (x - 0.735) / 0.085;
  const rdy = (y - 0.75) / 0.085;
  if (rdx * rdx + rdy * rdy < 1) {
    const stem = Math.abs(x - 0.735) < 0.014 && y < 0.66 && y > 0.62;
    if (stem) return [122, 190, 96, 255];
    return [214, 58, 43, 255];
  }

  return [r, g, b, 255];
}

const outDir = join(process.cwd(), 'public', 'icons');
mkdirSync(outDir, { recursive: true });

for (const [name, size, scale] of [
  ['icon-192.png', 192, 1],
  ['icon-512.png', 512, 1],
  ['icon-maskable-512.png', 512, 0.78]
]) {
  const file = join(outDir, name);
  writeFileSync(file, png(size, (u, v) => painter(u, v, scale)));
  console.log('wrote', file);
}
