#!/usr/bin/env node
/**
 * scripts/import-compat-database.js
 *
 * Imports the Airtable 3D/VR Compatibility Database (lib/3D_VRCompatibilityDatabase.csv)
 * into data/games/*.json AS PROPER `fixes[]` ENTRIES — not as a separate
 * informational sidecar. Each CSV row that names a Stereopticon-recognised
 * software (UEVR / Geo-11 / vorpX / wiz3D / HelixMod / SuperDepth3D / 3D
 * Vision / 3DMigoto / etc.) becomes a `fixes[]` element with the proper
 * `type` field, so it shows up in the mod dropdown, is installable via the
 * existing adapter, and participates in the rendering-method filter.
 *
 * Behaviour:
 *   * Emulator titles (Dolphin, Cemu, PCSX2, RPCS3, etc.) are filtered out.
 *   * Game-with-emulator-suffix titles ("Super Mario 3D World, Cemu") are
 *     canonicalised to the game name only.
 *   * Existing games are augmented: any new fix `type` not already present
 *     gets appended. Existing fixes are NOT overwritten.
 *   * The user has explicit permission to use this data.
 *
 *   node scripts/import-compat-database.js
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT  = path.join(__dirname, '..');
const CSV   = path.join(ROOT, 'lib', '3D_VRCompatibilityDatabase.csv');
const GAMES = path.join(ROOT, 'data', 'games');

// ─── CSV parsing ──────────────────────────────────────────────
function parseCsv(text) {
    const rows  = [];
    let row     = [];
    let cell    = '';
    let inQuote = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuote) {
            if (c === '"') { if (text[i+1] === '"') { cell += '"'; i++; } else { inQuote = false; } }
            else { cell += c; }
        } else {
            if      (c === '"')  { inQuote = true; }
            else if (c === ',')  { row.push(cell); cell = ''; }
            else if (c === '\r') { /* skip */ }
            else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
            else                  { cell += c; }
        }
    }
    if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }
    return rows;
}

// ─── Title hygiene ────────────────────────────────────────────
// Emulators that appear as titles in the Airtable export — the entry IS the
// emulator, not a game running on it. Drop these.
const EMULATOR_TITLES = new Set([
    'cemu', 'dolphin', 'dolphin ishiiruka', 'pcsx2', 'rpcs3', 'duckstation',
    'ppsspp', 'yuzu', 'ryujinx', 'citra', 'mgba', 'bizhawk', 'epsxe',
    'snes9x', 'snes9x v1.53', 'snes9x sidebyside', 'nestopia v1.46',
    'project64', 'zsnes', 'openemu', 'mednafen',
]);
// Common emulator-suffix patterns ("Super Mario 3D World, Cemu") — strip
// the trailing emulator name so we keep the game and just normalise its title.
const EMULATOR_SUFFIX_REGEX = /,\s*(cemu|dolphin|pcsx2|rpcs3|duckstation|ppsspp|yuzu|ryujinx|citra)\s*$/i;

function canonicalTitle(raw) {
    let t = String(raw || '').trim();
    if (t.includes('|')) t = t.split('|')[0].trim();
    t = t.replace(/�/g, '–').replace(/–/g, '-').replace(/—/g, '-');
    t = t.replace(EMULATOR_SUFFIX_REGEX, '').trim();
    return t;
}

function isEmulatorTitle(title) {
    return EMULATOR_TITLES.has(String(title).toLowerCase().trim());
}

function slugify(s) {
    return String(s).toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

// ─── Softwares parser ─────────────────────────────────────────
const API_REGEX = /^(Direct3D|OpenGL|Vulkan)/i;
function parseSoftwares(raw) {
    const s = String(raw || '').trim();
    const result = { software: '', graphics_api: '', output: '', raw: s };
    if (!s) return result;
    const idx = s.indexOf('>');
    if (idx < 0) { result.software = s; }
    else {
        const left  = s.slice(0, idx).trim();
        const right = s.slice(idx + 1).trim();
        if (API_REGEX.test(left)) { result.graphics_api = left; result.software = right; }
        else                       { result.software = left; result.output = right; }
    }
    if (/^iZ3D$/i.test(result.software)) result.software = 'wiz3D';
    return result;
}

// ─── Software → fix type mapping ──────────────────────────────
// Maps the CSV's software name onto our existing fix-type vocabulary
// (data/pipelines/*.json). Anything not in this table is skipped — we
// don't want to invent fix types that have no install adapter.
const SOFTWARE_MAP = {
    'UEVR':                       { type: 'uevr',          name: 'UEVR',                  cost: 'free',  rendering_method: 'Dual-View Rendering',     headtracking_default: '6dof' },
    'Geo-11':                     { type: 'geo11',         name: 'Geo-11',                cost: 'free',  rendering_method: 'Dual-View Rendering' },
    '3DMigoto':                   { type: '3dmigoto',      name: '3DMigoto',              cost: 'free',  rendering_method: 'Dual-View Rendering' },
    'vorpX':                      { type: 'vorpx',         name: 'vorpX',                 cost: 'paid',  rendering_method: 'Dual-View Rendering',     headtracking_default: '6dof' },
    'wiz3D':                      { type: 'wiz3d_wrapper', name: 'wiz3D',                 cost: 'free',  rendering_method: 'Dual-View Rendering' },
    'HelixMod':                   { type: 'helixmod',      name: 'HelixMod',              cost: 'free',  rendering_method: 'Dual-View Rendering' },
    'Tridef 3D Ignition':         { type: 'tridef',        name: 'TriDef 3D Ignition',    cost: 'paid',  rendering_method: 'Dual-View Rendering',     deprecated: true },
    'SuperDepth3D':               { type: 'superdepth3d',  name: 'SuperDepth3D',          cost: 'free',  rendering_method: 'Depth Map Reprojection' },
    'ReShade SuperDepth3D':       { type: 'superdepth3d',  name: 'SuperDepth3D (ReShade)', cost: 'free', rendering_method: 'Depth Map Reprojection' },
    'HelixVision':                { type: 'helixvision',   name: 'HelixVision',           cost: 'free',  rendering_method: 'Dual-View Rendering' },
    '3DGame Bridge':              { type: '3dgamebridge',  name: '3DGame Bridge',         cost: 'free',  rendering_method: 'Dual-View Rendering' },
    '3D Vision (Native)':         { type: '3d-vision',     name: 'Native 3D Vision',      cost: 'free',  rendering_method: 'Dual-View Rendering' },
    '3D Vision (Modded)':         { type: 'helixmod',      name: '3D Vision (HelixMod)',  cost: 'free',  rendering_method: 'Dual-View Rendering' },
    'iZ3D':                       { type: 'wiz3d_wrapper', name: 'wiz3D',                 cost: 'free',  rendering_method: 'Dual-View Rendering' },
};

function buildFixFromEntry(title, entry) {
    const m = SOFTWARE_MAP[entry.software];
    if (!m) return null;
    const slug   = slugify(title).replace(/-/g, '_');
    const fix = {
        id:                `${slug}_${m.type}`,
        name:              m.name,
        type:              m.type,
        cost:              m.cost,
        recommended:       (entry.rating || 0) >= 4,
        rendering_method:  m.rendering_method,
        headtracking:      entry.mode === 'VR' ? (m.headtracking_default || 'native') : 'None',
        native_outputs:    [],
        pipeline_overrides:{},
        notes:             `Imported from 3D/VR Compatibility Database (Airtable). ${
            entry.graphics_api ? `API: ${entry.graphics_api}. ` : ''
        }${entry.output ? `Output: ${entry.output}. ` : ''}${
            entry.rating ? `Community rating: ${entry.rating}/5.` : 'Untested by maintainers.'
        }`.trim(),
        source:            '3D/VR Compatibility Database (Airtable)',
        compat_rating:     entry.rating || null,
        compat_mode:       entry.mode || '',
    };
    if (m.deprecated) fix.deprecated = true;
    return fix;
}

// ─── Main ─────────────────────────────────────────────────────
const csvText = fs.readFileSync(CSV, 'utf8').replace(/^﻿/, '');
const rows    = parseCsv(csvText);
const header  = rows.shift();
const cTitle  = header.indexOf('Title');
const cSoft   = header.indexOf('Softwares');
const cRating = header.indexOf('Rating');
const cStereo = header.indexOf('Stereoscopy');
const cMode   = header.indexOf('Mode');

const byTitle = new Map();
let droppedEmu = 0;
for (const row of rows) {
    if (!row || row.length < cMode + 1) continue;
    const title = canonicalTitle(row[cTitle]);
    if (!title) continue;
    if (isEmulatorTitle(title)) { droppedEmu++; continue; }
    if (!byTitle.has(title)) byTitle.set(title, { title, entries: [] });
    const sw     = parseSoftwares(row[cSoft]);
    const rating = parseInt(row[cRating], 10);
    const mode   = String(row[cMode]   || '').trim();
    const stereo = String(row[cStereo] || '').trim();
    if (!sw.software) continue;
    byTitle.get(title).entries.push({
        software: sw.software, graphics_api: sw.graphics_api, output: sw.output,
        rating: isFinite(rating) ? rating : null, mode, stereoscopy: stereo,
    });
}

console.log(`CSV: ${rows.length} rows → ${byTitle.size} unique titles (dropped ${droppedEmu} emulator rows)`);

// Build existing-file lookup so we can match the CSV's wording to slightly-
// different existing slugs.
const existingFiles = fs.readdirSync(GAMES).filter(f => f.endsWith('.json'));
const titleToFile   = new Map();
const slugToFile    = new Map();
for (const f of existingFiles) {
    try {
        const g = JSON.parse(fs.readFileSync(path.join(GAMES, f), 'utf8'));
        if (g.title) titleToFile.set(String(g.title).toLowerCase(), f);
        slugToFile.set(f.replace(/\.json$/, ''), f);
    } catch {}
}

let augmented = 0, created = 0, skipped = 0, fixesAdded = 0, fixesSkippedDup = 0;

for (const [title, data] of byTitle) {
    const slug = slugify(title);
    if (!slug) { skipped++; continue; }

    let outFile = titleToFile.get(title.toLowerCase()) || slugToFile.get(slug);
    let outPath, game, isNew = false;

    if (outFile) {
        outPath = path.join(GAMES, outFile);
        game    = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    } else {
        isNew   = true;
        outFile = `${slug}.json`;
        outPath = path.join(GAMES, outFile);
        game = {
            id:           slug.replace(/-/g, ''),
            title:        title,
            developer:    'Unknown',
            graphics_api: '',
            default_path: '',
            exe_name:     '',
            fixes:        [],
            steam_app_id: '',
        };
    }

    // Augment fixes from CSV entries — dedupe by fix.type so we don't
    // overwrite hand-authored entries. Pick the highest-rated CSV entry for
    // each software type.
    if (!Array.isArray(game.fixes)) game.fixes = [];
    const existingTypes = new Set(game.fixes.map(f => f.type));
    const bestPerType   = new Map();   // type → best (highest-rated) fix object
    for (const entry of data.entries) {
        const fix = buildFixFromEntry(title, entry);
        if (!fix) continue;
        if (existingTypes.has(fix.type)) { fixesSkippedDup++; continue; }
        const prev = bestPerType.get(fix.type);
        if (!prev || (fix.compat_rating || 0) > (prev.compat_rating || 0)) {
            bestPerType.set(fix.type, fix);
        }
    }
    for (const fix of bestPerType.values()) { game.fixes.push(fix); fixesAdded++; }

    // Recommended-flag tidy-up: if no fix is marked recommended but at least
    // one CSV-imported fix has a 4–5 rating, set that one recommended.
    if (!game.fixes.some(f => f.recommended) && game.fixes.length) {
        const best = game.fixes.slice().sort((a, b) => (b.compat_rating || 0) - (a.compat_rating || 0))[0];
        if ((best.compat_rating || 0) >= 4) best.recommended = true;
        else                                  game.fixes[0].recommended = true;
    }

    // Remove the old `compat_database` sidecar — the data is now in fixes[].
    delete game.compat_database;

    if (isNew) created++;
    else       augmented++;
    fs.writeFileSync(outPath, JSON.stringify(game, null, 2) + '\n', 'utf8');
}

// Cleanup pass: scan for emulator titles that already exist in data/games
// (from earlier CSV runs) and delete them.
let emuDeleted = 0;
for (const f of fs.readdirSync(GAMES)) {
    if (!f.endsWith('.json')) continue;
    try {
        const g = JSON.parse(fs.readFileSync(path.join(GAMES, f), 'utf8'));
        if (isEmulatorTitle(g.title || '')) {
            fs.unlinkSync(path.join(GAMES, f));
            emuDeleted++;
        }
    } catch {}
}

console.log(`Done: ${augmented} augmented, ${created} new, ${skipped} skipped, ${emuDeleted} emulator JSONs deleted.`);
console.log(`Fixes: ${fixesAdded} added, ${fixesSkippedDup} skipped (already present in game).`);

// ── HD3D ↔ 3D Vision Direct Mode cross-mapping ────────────────
// User note: every HD3D-native game from the wiz3D catalogue is also
// playable in 3D Vision Direct Mode (via wiz3D's DM path), EXCEPT the
// Sniper Elite and Zombie Army franchises — those are HD3D-only. Walk
// the catalogue and for every game that has a `wiz3d_hd3d` fix but no
// `wiz3d_3dvision_dm` fix, add the missing DM fix (skipping the SE/ZA
// exceptions).
const HD3D_DM_EXEMPT = /sniper elite|zombie army/i;
let crossMapped = 0, crossSkipped = 0;
for (const f of fs.readdirSync(GAMES)) {
    if (!f.endsWith('.json')) continue;
    const p = path.join(GAMES, f);
    let g;
    try { g = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { continue; }
    if (!Array.isArray(g.fixes) || !g.fixes.length) continue;
    const hd3d = g.fixes.find(x => x.type === 'wiz3d_hd3d');
    if (!hd3d) continue;
    if (g.fixes.some(x => x.type === 'wiz3d_3dvision_dm')) continue;
    if (HD3D_DM_EXEMPT.test(g.title || '')) { crossSkipped++; continue; }
    // Clone the HD3D entry's metadata into a 3D Vision DM fix.
    const dm = {
        ...hd3d,
        id:   (hd3d.id || g.id || slugify(g.title).replace(/-/g, '_')).replace(/_wiz3d_hd3d$|_hd3d$/, '_wiz3d_3dvision_dm') + (hd3d.id?.includes('3dvision_dm') ? '' : ''),
        name: hd3d.name?.replace(/HD3D.*$/i, '3D Vision Direct Mode (wiz3D)') || '3D Vision Direct Mode (wiz3D)',
        type: 'wiz3d_3dvision_dm',
        recommended: false,   // HD3D stays the recommended path; DM is an alternative
        notes: 'Cross-mapped from HD3D native — wiz3D can also drive the original Nvidia 3D Vision Direct Mode for this game (Sniper Elite + Zombie Army franchises excepted).',
    };
    if (!dm.id || dm.id === hd3d.id) dm.id = `${(g.id || 'game')}_wiz3d_3dvision_dm`;
    g.fixes.push(dm);
    fs.writeFileSync(p, JSON.stringify(g, null, 2) + '\n', 'utf8');
    crossMapped++;
}
console.log(`HD3D → 3D Vision DM cross-map: added ${crossMapped} DM fixes, skipped ${crossSkipped} Sniper Elite / Zombie Army titles.`);

console.log(`Total catalogue size now: ${fs.readdirSync(GAMES).filter(f => f.endsWith('.json')).length}`);
