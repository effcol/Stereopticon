'use strict';
/**
 * modules/peInfo.js
 *
 * Reads a Windows executable's header to find out what wiz3D needs to know:
 *   - architecture: 'x86' or 'x64' (which 32-bit / 64-bit build to install)
 *   - imported DLLs, normal and delay-loaded (which graphics API it uses)
 *
 * Only the headers and the import tables are read, never the whole file.
 * Games that load their renderer with LoadLibrary at runtime show no graphics
 * DLL in their imports; callers fall back to catalogue data for those.
 */

const fs = require('fs');

const MACHINE = { 0x014c: 'x86', 0x8664: 'x64', 0xaa64: 'arm64' };

function readAt(fd, offset, length) {
    const buf = Buffer.alloc(length);
    const n = fs.readSync(fd, buf, 0, length, offset);
    return n === length ? buf : buf.subarray(0, n);
}

function readCString(fd, offset, max = 256) {
    const buf = readAt(fd, offset, max);
    const end = buf.indexOf(0);
    return buf.subarray(0, end === -1 ? buf.length : end).toString('latin1');
}

/**
 * Returns { arch, imports: [lower-case dll names] }, or null when the file
 * cannot be read or is not a PE executable.
 */
function readPe(exePath) {
    let fd;
    try {
        fd = fs.openSync(exePath, 'r');
        const dos = readAt(fd, 0, 64);
        if (dos.length < 64 || dos.toString('latin1', 0, 2) !== 'MZ') return null;
        const peOffset = dos.readUInt32LE(0x3c);

        const head = readAt(fd, peOffset, 24);
        if (head.length < 24 || head.readUInt32LE(0) !== 0x00004550) return null;   // "PE\0\0"
        const machine      = head.readUInt16LE(4);
        const sectionCount = head.readUInt16LE(6);
        const optSize      = head.readUInt16LE(20);

        const opt   = readAt(fd, peOffset + 24, optSize);
        const magic = opt.readUInt16LE(0);
        const dataDirStart = magic === 0x20b ? 112 : 96;                            // PE32+ : PE32
        const dirEntry = i => {
            const off = dataDirStart + i * 8;
            return off + 8 <= opt.length ? { rva: opt.readUInt32LE(off), size: opt.readUInt32LE(off + 4) } : { rva: 0, size: 0 };
        };

        const sections = [];
        const sec = readAt(fd, peOffset + 24 + optSize, sectionCount * 40);
        for (let i = 0; i < sectionCount; i++) {
            const b = i * 40;
            sections.push({
                va:      sec.readUInt32LE(b + 12),
                vsize:   sec.readUInt32LE(b + 8),
                rawSize: sec.readUInt32LE(b + 16),
                rawPtr:  sec.readUInt32LE(b + 20),
            });
        }
        const toOffset = rva => {
            const s = sections.find(x => rva >= x.va && rva < x.va + Math.max(x.vsize, x.rawSize));
            return s ? rva - s.va + s.rawPtr : null;
        };

        const imports = new Set();
        // Import directory (1): 20-byte descriptors, Name RVA at +12.
        // Delay-load directory (13): 32-byte descriptors, Name RVA at +4.
        for (const [index, stride, nameAt] of [[1, 20, 12], [13, 32, 4]]) {
            const dir = dirEntry(index);
            const start = dir.rva ? toOffset(dir.rva) : null;
            if (start === null) continue;
            for (let i = 0; i < 512; i++) {
                const d = readAt(fd, start + i * stride, stride);
                if (d.length < stride || d.every(x => x === 0)) break;
                const nameOff = toOffset(d.readUInt32LE(nameAt));
                if (nameOff !== null) imports.add(readCString(fd, nameOff).toLowerCase());
            }
        }

        return { arch: MACHINE[machine] || 'unknown', imports: [...imports] };
    } catch {
        return null;
    } finally {
        if (fd !== undefined) try { fs.closeSync(fd); } catch { /* already closed */ }
    }
}

/**
 * Best guess at the game's graphics API from its imports, in wiz3D's terms:
 * 'dx7' | 'dx8' | 'dx9' | 'dx10-11' | 'dx12' | 'opengl' | null.
 * A game importing both d3d9 and d3d11 is ambiguous and returns null.
 */
function graphicsApiFromImports(imports = []) {
    const has = name => imports.includes(name);
    const dx1011 = ['d3d11.dll', 'd3d10.dll', 'd3d10_1.dll', 'dxgi.dll'].some(has);
    // D3DX helper libraries imply their API even when the core DLL is loaded at runtime.
    const dx9    = has('d3d9.dll') || imports.some(n => n.startsWith('d3dx9_'));
    if (dx9 && dx1011) return null;
    if (dx1011)        return has('d3d12.dll') ? null : 'dx10-11';
    if (has('d3d12.dll')) return 'dx12';
    if (dx9)           return 'dx9';
    if (has('d3d8.dll'))   return 'dx8';
    if (has('ddraw.dll'))  return 'dx7';
    if (has('opengl32.dll')) return 'opengl';
    return null;
}

module.exports = { readPe, graphicsApiFromImports };
