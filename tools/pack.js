/**
 * tools/pack.js — Package the extension for distribution
 *
 * Produces data-analyst-ai.zip in the project root, containing only the
 * files Chrome needs to load the extension (or submit to the Web Store).
 * Excludes development artifacts: node_modules, tools/, scripts/, .git, etc.
 *
 * Usage:
 *   node tools/pack.js [--out path/to/output.zip]
 *
 * No third-party dependencies — uses only Node.js built-ins.
 */

"use strict";

const fs   = require("fs");
const path = require("path");
const zlib = require("zlib");

// ── Config ────────────────────────────────────────────────────────────────────

const args   = process.argv.slice(2);
const getArg = (flag, def) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

const ROOT    = path.resolve(__dirname, "..");
const OUT     = path.resolve(ROOT, getArg("--out", "data-analyst-ai.zip"));

// Directories / files to exclude (matched against the path relative to ROOT)
const EXCLUDE_DIRS = new Set([
  "node_modules",
  ".git",
  ".github",
  "tools",
  "scripts",
  "training",
  "coverage",
  ".vscode",
  ".idea",
  "tests",   // dev-only regression tests
  "proxy",   // local proxy server — not part of the extension itself
]);

const EXCLUDE_FILES = new Set([
  ".gitignore",
  ".eslintrc",
  ".eslintrc.json",
  ".eslintrc.js",
  ".prettierrc",
  "package.json",       // root dev config — not part of the extension
  "package-lock.json",
  "yarn.lock",
  "data-analyst-ai.zip",
]);

const EXCLUDE_EXT = new Set([".map"]);

// ── File collector ────────────────────────────────────────────────────────────

function collect(dir, base) {
  const entries = [];
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    const rel = base ? `${base}/${name}` : name;
    const stat = fs.statSync(abs);

    if (stat.isDirectory()) {
      if (EXCLUDE_DIRS.has(name)) continue;
      entries.push(...collect(abs, rel));
    } else {
      if (EXCLUDE_FILES.has(name)) continue;
      if (EXCLUDE_EXT.has(path.extname(name))) continue;
      entries.push({ abs, rel, size: stat.size });
    }
  }
  return entries;
}

// ── Minimal ZIP writer (DEFLATE or STORE) ─────────────────────────────────────
// Implements just enough of the ZIP spec (PKWARE Application Note 4.3.x) to
// produce a file that Chrome and the Web Store will accept.

function writeUint16LE(buf, offset, value) { buf.writeUInt16LE(value, offset); }
function writeUint32LE(buf, offset, value) { buf.writeUInt32LE(value, offset); }

function crc32(buf) {
  if (!crc32._table) {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c;
    }
    crc32._table = t;
  }
  const t = crc32._table;
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime() {
  const d = new Date();
  const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  return { dosDate, dosTime };
}

function packZip(files) {
  const parts = [];
  const centralDir = [];
  let offset = 0;

  for (const { abs, rel } of files) {
    const nameBytes  = Buffer.from(rel, "utf8");
    const rawData    = fs.readFileSync(abs);
    const crc        = crc32(rawData);
    const compressed = zlib.deflateRawSync(rawData, { level: 6 });

    // Use DEFLATE only if it's smaller
    const useDeflate = compressed.length < rawData.length;
    const fileData   = useDeflate ? compressed : rawData;
    const method     = useDeflate ? 8 : 0;
    const { dosDate, dosTime } = dosDateTime();

    // Local file header (30 bytes fixed + name)
    const lhBuf = Buffer.alloc(30 + nameBytes.length);
    lhBuf.writeUInt32LE(0x04034b50, 0);   // signature
    writeUint16LE(lhBuf,  4, 20);          // version needed: 2.0
    writeUint16LE(lhBuf,  6, 0x0800);     // flags: UTF-8 filename
    writeUint16LE(lhBuf,  8, method);
    writeUint16LE(lhBuf, 10, dosTime);
    writeUint16LE(lhBuf, 12, dosDate);
    writeUint32LE(lhBuf, 14, crc);
    writeUint32LE(lhBuf, 18, fileData.length);
    writeUint32LE(lhBuf, 22, rawData.length);
    writeUint16LE(lhBuf, 26, nameBytes.length);
    writeUint16LE(lhBuf, 28, 0);          // extra field length
    nameBytes.copy(lhBuf, 30);

    parts.push(lhBuf, fileData);

    // Central directory entry (46 bytes fixed + name)
    const cdBuf = Buffer.alloc(46 + nameBytes.length);
    cdBuf.writeUInt32LE(0x02014b50, 0);   // signature
    writeUint16LE(cdBuf,  4, 20);          // version made by
    writeUint16LE(cdBuf,  6, 20);          // version needed
    writeUint16LE(cdBuf,  8, 0x0800);     // flags
    writeUint16LE(cdBuf, 10, method);
    writeUint16LE(cdBuf, 12, dosTime);
    writeUint16LE(cdBuf, 14, dosDate);
    writeUint32LE(cdBuf, 18, crc);
    writeUint32LE(cdBuf, 22, fileData.length);
    writeUint32LE(cdBuf, 26, rawData.length);
    writeUint16LE(cdBuf, 28, nameBytes.length);
    writeUint16LE(cdBuf, 30, 0);           // extra field length
    writeUint16LE(cdBuf, 32, 0);           // comment length
    writeUint16LE(cdBuf, 34, 0);           // disk number start
    writeUint16LE(cdBuf, 36, 0);           // internal attributes
    writeUint32LE(cdBuf, 38, 0);           // external attributes
    writeUint32LE(cdBuf, 42, offset);      // relative offset of local header
    nameBytes.copy(cdBuf, 46);

    centralDir.push(cdBuf);
    offset += lhBuf.length + fileData.length;
  }

  const cdBuffer = Buffer.concat(centralDir);
  const eocdr    = Buffer.alloc(22);
  eocdr.writeUInt32LE(0x06054b50, 0);     // end-of-central-directory signature
  writeUint16LE(eocdr,  4, 0);            // disk number
  writeUint16LE(eocdr,  6, 0);            // disk with start of central dir
  writeUint16LE(eocdr,  8, centralDir.length);
  writeUint16LE(eocdr, 10, centralDir.length);
  writeUint32LE(eocdr, 12, cdBuffer.length);
  writeUint32LE(eocdr, 16, offset);
  writeUint16LE(eocdr, 20, 0);            // comment length

  return Buffer.concat([...parts, cdBuffer, eocdr]);
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log(`\nData Analyst AI — Extension Packager`);
console.log(`Root: ${ROOT}`);
console.log(`Output: ${OUT}`);
console.log("─".repeat(50));

const files = collect(ROOT, "");
console.log(`\nIncluding ${files.length} files:`);

let totalRaw = 0;
for (const f of files) {
  console.log(`  ${f.rel}  (${f.size.toLocaleString()} B)`);
  totalRaw += f.size;
}

console.log(`\nTotal uncompressed: ${(totalRaw / 1024).toFixed(1)} KB`);
console.log("Compressing…");

const zip = packZip(files);
fs.writeFileSync(OUT, zip);

const outSize = fs.statSync(OUT).size;
console.log(`\n\x1b[32m✓ Written:\x1b[0m ${OUT}`);
console.log(`  ${files.length} files, ${(outSize / 1024).toFixed(1)} KB compressed`);
console.log(`  Ratio: ${((1 - outSize / totalRaw) * 100).toFixed(1)}% reduction\n`);
