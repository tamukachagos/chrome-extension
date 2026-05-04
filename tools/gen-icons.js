/**
 * tools/gen-icons.js — Generate icons/icon48.png and icons/icon128.png
 *
 * Pure Node.js, zero dependencies. Produces valid PNG files using
 * the built-in zlib module and a hand-rolled CRC32 implementation.
 *
 * Design: dark rounded square (#0f1117 bg) with yellow (#f2c811)
 * rounded panel and a dark "D" glyph matching the side-panel logo.
 *
 * Usage:
 *   node tools/gen-icons.js
 */

"use strict";

const zlib = require("zlib");
const fs   = require("fs");
const path = require("path");

// ── CRC32 ─────────────────────────────────────────────────────────────────────

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  CRC_TABLE[i] = c;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ── PNG chunk builder ─────────────────────────────────────────────────────────

function makeChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const lenBuf    = Buffer.allocUnsafe(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.allocUnsafe(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([lenBuf, typeBytes, data, crcBuf]);
}

// ── PNG encoder (24-bit RGB, no interlace) ────────────────────────────────────

function makePng(width, height, pixelFn) {
  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width,  0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB

  // Raw scanlines: 1 filter byte + 3 bytes/pixel per row
  const rowStride = 1 + width * 3;
  const raw = Buffer.alloc(height * rowStride);
  for (let y = 0; y < height; y++) {
    raw[y * rowStride] = 0; // filter = None
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixelFn(x, y, width, height);
      const o = y * rowStride + 1 + x * 3;
      raw[o]     = r & 0xff;
      raw[o + 1] = g & 0xff;
      raw[o + 2] = b & 0xff;
    }
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
    makeChunk("IHDR", ihdr),
    makeChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    makeChunk("IEND", Buffer.alloc(0))
  ]);
}

// ── Geometry helpers ──────────────────────────────────────────────────────────

function inRoundedRect(px, py, x0, y0, x1, y1, r) {
  if (px < x0 || px > x1 || py < y0 || py > y1) return false;
  if (px < x0 + r && py < y0 + r) return (px - x0 - r) ** 2 + (py - y0 - r) ** 2 <= r * r;
  if (px > x1 - r && py < y0 + r) return (px - x1 + r) ** 2 + (py - y0 - r) ** 2 <= r * r;
  if (px < x0 + r && py > y1 - r) return (px - x0 - r) ** 2 + (py - y1 + r) ** 2 <= r * r;
  if (px > x1 - r && py > y1 - r) return (px - x1 + r) ** 2 + (py - y1 + r) ** 2 <= r * r;
  return true;
}

// ── "D" letter bitmap (7 cols × 9 rows) ──────────────────────────────────────
//   1 = filled dark, 0 = transparent (accent behind it)

const D_BITMAP = [
  [1, 1, 1, 1, 0, 0, 0],
  [1, 0, 0, 0, 1, 1, 0],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 1, 1, 0],
  [1, 1, 1, 1, 0, 0, 0],
];
const D_ROWS = D_BITMAP.length;
const D_COLS = D_BITMAP[0].length;

// ── Icon pixel function ───────────────────────────────────────────────────────

const BG     = [15,  17,  23];  // #0f1117  — dark background
const ACCENT = [242, 200, 17];  // #f2c811  — yellow panel
const DARK   = [20,  20,  25];  // #141419  — letter fill

function iconPixel(x, y, w, h) {
  const pad = Math.round(w * 0.045);
  const rad = Math.round(w * 0.20);

  // Outer rounded rectangle (yellow panel)
  if (!inRoundedRect(x, y, pad, pad, w - 1 - pad, h - 1 - pad, rad)) {
    return BG;
  }

  // "D" glyph — placed with generous padding inside the panel
  const gx0 = Math.round(w * 0.22);
  const gy0 = Math.round(h * 0.17);
  const gx1 = Math.round(w * 0.82);
  const gy1 = Math.round(h * 0.83);
  const gw  = gx1 - gx0;
  const gh  = gy1 - gy0;

  if (x >= gx0 && x < gx1 && y >= gy0 && y < gy1) {
    const col = Math.min(D_COLS - 1, Math.floor((x - gx0) * D_COLS / gw));
    const row = Math.min(D_ROWS - 1, Math.floor((y - gy0) * D_ROWS / gh));
    if (D_BITMAP[row][col] === 1) return DARK;
  }

  return ACCENT;
}

// ── Generate ──────────────────────────────────────────────────────────────────

const outDir = path.resolve(__dirname, "../icons");
fs.mkdirSync(outDir, { recursive: true });

const sizes = [16, 48, 128];
for (const size of sizes) {
  const outPath = path.join(outDir, `icon${size}.png`);
  fs.writeFileSync(outPath, makePng(size, size, iconPixel));
  console.log(`✓ ${outPath}  (${fs.statSync(outPath).size} bytes)`);
}

console.log("\nDone — icons/ folder created.");
