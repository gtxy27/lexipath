import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// Minimal PNG encoder (RGBA8 + zlib + CRC32)
// Generates simple flat icons so browsers (esp. Chrome) can display extension icons everywhere.

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & (-(c & 1)));
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  const crc = crc32(Buffer.concat([typeBuf, data]));
  crcBuf.writeUInt32BE(crc, 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function writePngRgba({ width, height, rgba }) {
  if (rgba.length !== width * height * 4) {
    throw new Error(`Invalid RGBA length: got ${rgba.length}, expected ${width * height * 4}`);
  }

  // Add filter byte (0) per row.
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const idatData = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idatData),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function fillRoundedRect(rgba, size, r, color) {
  const [cr, cg, cb, ca] = color;

  function insideRoundedRect(px, py) {
    // Pixel center coordinates.
    const x = px + 0.5;
    const y = py + 0.5;

    const w = size;
    const h = size;

    // Fast path: inside central box.
    if (x >= r && x <= w - r && y >= 0 && y <= h) return true;
    if (y >= r && y <= h - r && x >= 0 && x <= w) return true;

    // Corner checks.
    const corners = [
      [r, r],
      [w - r, r],
      [r, h - r],
      [w - r, h - r],
    ];
    for (const [cx, cy] of corners) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r * r) return true;
    }

    return false;
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!insideRoundedRect(x, y)) continue;
      const i = (y * size + x) * 4;
      rgba[i + 0] = cr;
      rgba[i + 1] = cg;
      rgba[i + 2] = cb;
      rgba[i + 3] = ca;
    }
  }
}

function fillRect(rgba, size, x0, y0, w, h, color) {
  const [cr, cg, cb, ca] = color;
  const x1 = Math.min(size, Math.max(0, Math.round(x0 + w)));
  const y1 = Math.min(size, Math.max(0, Math.round(y0 + h)));
  const sx = Math.min(size, Math.max(0, Math.round(x0)));
  const sy = Math.min(size, Math.max(0, Math.round(y0)));

  for (let y = sy; y < y1; y++) {
    for (let x = sx; x < x1; x++) {
      const i = (y * size + x) * 4;
      rgba[i + 0] = cr;
      rgba[i + 1] = cg;
      rgba[i + 2] = cb;
      rgba[i + 3] = ca;
    }
  }
}

function renderIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);

  // Match the SVG proportions: viewBox 128 with rx=24.
  const r = Math.max(2, Math.round((24 / 128) * size));

  // Background.
  fillRoundedRect(rgba, size, r, [0x0e, 0xa5, 0xe9, 0xff]);

  // White shapes from the SVG paths.
  const s = size / 128;
  const white = [0xff, 0xff, 0xff, 0xff];

  // Rects: (x=32..56,y=40..88), (72..96,40..88), (48..80,56..72)
  fillRect(rgba, size, 32 * s, 40 * s, 24 * s, 48 * s, white);
  fillRect(rgba, size, 72 * s, 40 * s, 24 * s, 48 * s, white);
  fillRect(rgba, size, 48 * s, 56 * s, 32 * s, 16 * s, white);

  return rgba;
}

import { fileURLToPath } from 'node:url';

function main() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const packageRoot = path.resolve(__dirname, '..');

  const outDir = path.join(packageRoot, 'public', 'icons');
  fs.mkdirSync(outDir, { recursive: true });

  const sizes = [16, 32, 48, 128];
  for (const size of sizes) {
    const rgba = renderIcon(size);
    const png = writePngRgba({ width: size, height: size, rgba });
    const outPath = path.join(outDir, `icon${size}.png`);
    fs.writeFileSync(outPath, png);
  }

  process.stdout.write(`Generated PNG icons in ${outDir}\n`);
}

main();
