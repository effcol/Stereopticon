'use strict';
/**
 * scripts/make-icon.js
 *
 * Draws the app icon (assets/icon.png, 512×512) without any image library:
 * a dark rounded square with two overlapping lenses, red and cyan, the
 * colours of anaglyph glasses. Run it again after changing the design;
 * replace assets/icon.png with a hand-made icon whenever you like.
 */

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 512;
const SS   = 4;                       // supersamples per axis, for smooth edges

const BG     = [14, 18, 28];
const RED    = [235, 64, 72];
const CYAN   = [40, 205, 225];
const RADIUS = 0.22 * SIZE;           // corner radius of the square

function insideRoundedSquare(x, y) {
    const r = RADIUS, s = SIZE;
    const cx = Math.min(Math.max(x, r), s - r);
    const cy = Math.min(Math.max(y, r), s - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

// Two lens rings with a little overlap in the middle.
const LENS_R = 0.205 * SIZE, RING = 0.055 * SIZE, LENS_Y = 0.5 * SIZE;
const LEFT_X = 0.335 * SIZE, RIGHT_X = 0.665 * SIZE;
function ring(x, y, cx) {
    const d = Math.hypot(x - cx, y - LENS_Y);
    return d <= LENS_R && d >= LENS_R - RING;
}
function fill(x, y, cx) {
    return Math.hypot(x - cx, y - LENS_Y) < LENS_R - RING;
}

function shade(x, y) {
    if (!insideRoundedSquare(x, y)) return null;
    let c = BG.slice();
    // Tinted lens glass.
    if (fill(x, y, LEFT_X))  c = c.map((v, i) => v + (RED[i]  - v) * 0.18);
    if (fill(x, y, RIGHT_X)) c = c.map((v, i) => v + (CYAN[i] - v) * 0.18);
    // Rings; where they cross, the colours add up as light does.
    const l = ring(x, y, LEFT_X), r = ring(x, y, RIGHT_X);
    if (l && r) c = RED.map((v, i) => Math.min(255, v + CYAN[i]));
    else if (l) c = RED;
    else if (r) c = CYAN;
    return c;
}

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
    raw[y * (SIZE * 4 + 1)] = 0;                       // PNG filter type: none
    for (let x = 0; x < SIZE; x++) {
        let r = 0, g = 0, b = 0, a = 0;
        for (let sy = 0; sy < SS; sy++) {
            for (let sx = 0; sx < SS; sx++) {
                const c = shade(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS);
                if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
            }
        }
        const o = y * (SIZE * 4 + 1) + 1 + x * 4;
        if (a) { raw[o] = r / a; raw[o + 1] = g / a; raw[o + 2] = b / a; }
        raw[o + 3] = Math.round(a / (SS * SS) * 255);
    }
}

function crc32(buf) {
    let c, crc = 0xffffffff;
    for (let n = 0; n < buf.length; n++) {
        c = (crc ^ buf[n]) & 0xff;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crc = (crc >>> 8) ^ c;
    }
    return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td  = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; ihdr[9] = 6;                              // 8-bit RGBA
const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
]);

const out = path.join(__dirname, '..', 'assets', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log(`Wrote ${out} (${png.length} bytes)`);
