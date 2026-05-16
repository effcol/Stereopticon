#!/usr/bin/env node
/**
 * scripts/gen-wiz3d-games.js
 *
 * Parses lib/wiz3D build/README.md and generates data/games/<slug>.json
 * entries for every game in the wiz3D test-results tables, including
 * untested + non-working ones (per user request — visibility matters).
 *
 * Each game gets a fix entry typed appropriately:
 *   - DX7 / DX8 / DX9 / DX10 / DX11 / "3D Vision Automatic"  → wiz3d_wrapper
 *   - "OpenGL Quad-Buffer Stereo"                            → wiz3d_opengl
 *   - "AMD HD3D Native"                                       → wiz3d_hd3d
 *   - "Nvidia 3D Vision Direct Mode"                          → wiz3d_3dvision_dm
 *
 * Existing data/games/<slug>.json files are NOT touched — if a game is
 * already in the catalogue with a different fix (e.g. Geo-11), the wiz3D
 * fix has to be added manually.
 *
 *   node scripts/gen-wiz3d-games.js
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT   = path.join(__dirname, '..');
const README = path.join(ROOT, 'lib', 'wiz3D build', 'README.md');
const GAMES  = path.join(ROOT, 'data', 'games');

const md = fs.readFileSync(README, 'utf8');

// Each section header → fix type for its table rows. The README uses level-3
// headers (###) for the major sub-tables and level-2 (##) for the big
// chapters. We track the most-recent matching header for each game row.
const SECTION_TO_FIX = [
    { re: /3D Vision\s*"?Direct Mode"?\s*Games?/i,      type: 'wiz3d_3dvision_dm' },
    { re: /AMD HD3D Native Games?/i,                    type: 'wiz3d_hd3d' },
    { re: /OpenGL Quad-Buffer Stereo Games?/i,          type: 'wiz3d_opengl' },
    { re: /3D Vision\s*"?Automatic Mode"?\s*Games?/i,   type: 'wiz3d_wrapper' },
    { re: /DirectX 7\/8 Games?/i,                       type: 'wiz3d_wrapper' },
    { re: /DirectX 9.*Games?/i,                         type: 'wiz3d_wrapper' },
    { re: /DirectX 10\/11 Games?/i,                     type: 'wiz3d_wrapper' },
];

// Map README status emoji/word into a normalised testing label that gets
// surfaced in the renderer (pros/cons/notes).
function parseStatus(cell) {
    const c = (cell || '').toLowerCase();
    if (c.includes('✅') && c.includes('working') && !c.includes('not working')) return 'working';
    if (c.includes('mostly working') || c.includes('partial')) return 'partial';
    if (c.includes('❌') || c.includes('not working')) return 'broken';
    if (c.includes('untested')) return 'untested';
    return 'untested';
}

// Map API column to a coarse graphics_api the renderer pipeline groks.
// wiz3D wrapper variants can target many APIs — pick the highest one listed
// since wiz3D autodetects per-DLL anyway.
function pickApi(apiCell) {
    const a = (apiCell || '').toLowerCase();
    if (/dx12|d3d12/.test(a)) return 'dx12';
    if (/dx11|d3d11/.test(a)) return 'dx11';
    if (/dx10|d3d10/.test(a)) return 'dx10';
    if (/dx9|d3d9/.test(a))  return 'dx9';
    if (/dx8|d3d8/.test(a))  return 'dx8';
    if (/dx7|d3d7/.test(a))  return 'dx7';
    if (/opengl/.test(a))    return 'opengl';
    return 'dx9';
}

// Title → URL-safe slug used as the JSON filename and game id.
function slugify(s) {
    return String(s).toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

function exeFromTitle(title) {
    // Best-effort exe guess from the title. wiz3D's per-game install scripts
    // are tied to the actual exe name — better than blank, easy to override.
    return slugify(title).replace(/-/g, '') + '.exe';
}

// Walk the file line-by-line, tracking which section we're in and parsing
// every markdown table row (lines starting with `|` that have at least 3
// pipe-separated cells and aren't the header / separator).
let currentSection = null;
const games = [];

for (const rawLine of md.split('\n')) {
    const line = rawLine.trim();

    // Section header? (## or ###) — record + lookup matching fix type.
    const heading = line.match(/^#{2,4}\s+(.*?)\s*$/);
    if (heading) {
        const txt = heading[1];
        const match = SECTION_TO_FIX.find(s => s.re.test(txt));
        currentSection = match ? { title: txt, type: match.type } : null;
        continue;
    }

    if (!currentSection)       continue;
    if (!line.startsWith('|')) continue;
    if (line.startsWith('|---') || /^\|\s*-/.test(line)) continue;
    if (/Game\s*\|/.test(line) && /Testing/i.test(line)) continue;  // header row

    const cells = line.split('|').map(s => s.trim()).filter((_, i, arr) => i > 0 && i < arr.length - 1);
    if (cells.length < 3) continue;

    // Columns vary slightly between tables; the first cell is always title,
    // second is API, and the *last* before notes is testing. Use the
    // notes-or-testing detection to identify the testing column.
    const title = cells[0];
    if (!title || /^[-*]+$/.test(title)) continue;
    if (title.toLowerCase().startsWith('excluded')) continue;

    // Strip markdown link syntax around the title: [Foo](http://...) → Foo
    const cleanTitle = title.replace(/\[([^\]]+)\]\([^)]*\)/, '$1').trim();

    // Find the testing cell — it's the one with ✅/⚠️/❌/Untested.
    let testIdx = -1;
    for (let i = 1; i < cells.length; ++i) {
        if (/✅|⚠️|❌|untested/i.test(cells[i])) { testIdx = i; break; }
    }
    if (testIdx < 0) continue;

    const apiCell    = cells[1] || '';
    const bitsCell   = cells[2] || '';
    const testCell   = cells[testIdx] || '';
    const notesCell  = cells[testIdx + 1] || '';
    const profileCell = (testIdx >= 4) ? (cells[3] || '') : '';

    games.push({
        title:      cleanTitle,
        api:        pickApi(apiCell),
        apiRaw:     apiCell,
        bits:       bitsCell,
        hasProfile: /✓/.test(profileCell),
        status:     parseStatus(testCell),
        notes:      notesCell.replace(/<br>/g, ' ').replace(/\s+/g, ' ').trim(),
        fixType:    currentSection.type,
        sectionTitle: currentSection.title,
    });
}

console.log(`Parsed ${games.length} wiz3D game rows`);

const PROS_BY_STATUS = {
    working:  'Tested working with wiz3D — stereo 3D output confirmed.',
    partial:  'Tested with wiz3D — playable but with known caveats.',
    broken:   'Listed for tracking — currently not loading with wiz3D.',
    untested: 'In the wiz3D catalogue but not yet tested by the maintainers.',
};

const CONS_BY_STATUS = {
    working:  'Some shader effects may still benefit from a per-game shader fix.',
    partial:  'See notes for the specific issues.',
    broken:   'Crashes or fails to enter stereo. Listed for future testing.',
    untested: 'Has an iZ3D profile but no maintainer test report yet — your mileage may vary.',
};

const SECTION_TO_RENDER_METHOD = {
    wiz3d_wrapper:      'Dual-View Rendering',
    wiz3d_hd3d:         'Dual-View Rendering',
    wiz3d_3dvision_dm:  'Dual-View Rendering',
    wiz3d_opengl:       'Dual-View Rendering',
};

function makeFix(g) {
    const fixId = slugify(g.title).replace(/-/g, '_') + '_wiz3d';
    return {
        id:           fixId,
        name:         'wiz3D',
        type:         g.fixType,
        cost:         'free',
        authors:      ['effcol', 'iZ3D (original)', 'bo3b (open-source release)'],
        url:          'https://github.com/effcol/wiz3D',
        license:      'LGPL-2.1',
        recommended:  g.status === 'working' || g.status === 'partial',
        rendering_method:    SECTION_TO_RENDER_METHOD[g.fixType] || 'Dual-View Rendering',
        headtracking:        'None',
        native_outputs:      ['sbs', 'sbs_half', 'tab', 'tab_half', 'anaglyph', 'interlaced', 'frame_sequential', 'sr_weave'],
        pipeline_overrides:  {},
        wiz3d_status:        g.status,
        wiz3d_section:       g.sectionTitle,
        wiz3d_api_raw:       g.apiRaw,
        wiz3d_bits:          g.bits,
        wiz3d_iz3d_profile:  g.hasProfile,
        pros:                PROS_BY_STATUS[g.status],
        cons:                CONS_BY_STATUS[g.status],
        notes:               g.notes,
    };
}

let written = 0, skipped = 0;
for (const g of games) {
    const slug = slugify(g.title);
    if (!slug) { skipped++; continue; }
    const outPath = path.join(GAMES, `${slug}.json`);
    if (fs.existsSync(outPath)) { skipped++; continue; }
    const game = {
        id:           slug.replace(/-/g, ''),
        title:        g.title,
        developer:    'Unknown',
        graphics_api: g.api,
        default_path: `C:\\Program Files (x86)\\Steam\\steamapps\\common\\${g.title}\\${exeFromTitle(g.title)}`,
        exe_name:     exeFromTitle(g.title),
        fixes:        [ makeFix(g) ],
    };
    fs.writeFileSync(outPath, JSON.stringify(game, null, 2) + '\n', 'utf8');
    written++;
}

console.log(`Done: ${written} written, ${skipped} skipped (already in catalogue or empty title).`);
console.log(`Next: run 'node scripts/fill-steam-ids.js' to auto-resolve Steam app IDs.`);
