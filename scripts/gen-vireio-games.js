#!/usr/bin/env node
/**
 * scripts/gen-vireio-games.js
 *
 * Reads data/vireio/manifest.json and writes data/games/<slug>.json for each
 * entry that doesn't already exist. Skips clobbering — re-running is safe.
 *
 *   node scripts/gen-vireio-games.js
 *
 * If a game already exists in data/games (e.g. Mass Effect Legendary
 * Edition), this script does NOT touch it — add the vireio fix entry
 * manually if you want to layer it on.
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT     = path.join(__dirname, '..');
const MANIFEST = path.join(ROOT, 'data', 'vireio', 'manifest.json');
const GAMES    = path.join(ROOT, 'data', 'games');

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));

function makeFix(slug, m) {
    return {
        id:           `${slug.replace(/-/g, '_')}_vireio`,
        name:         'Vireio Perception',
        type:         'vireio',
        cost:         'free',
        authors:      ['Denis Reischl', 'Grant Bagwell', 'Simon Brown', 'Neil Schneider'],
        url:          'https://github.com/OpenSourceVR/Vireio-Perception',
        license:      'LGPL-3.0',
        recommended:  true,
        rendering_method: m.rendering_method || 'Dual-View Rendering',
        headtracking: '6dof',
        headtracking_method: 'opentrack',
        headtracking_port:   4242,
        vireio_workspace:    m.vireio_workspace,
        native_outputs:      ['sbs', 'sbs_half', 'tab', 'tab_half', 'anaglyph', 'interleaved', 'frame_sequential'],
        pipeline_overrides:  {},
        pros:                'Open-source stereo + 6DOF headtracking driver. Works across many older DX9/DX11 engines without per-game shader fixes.',
        cons:                'Older driver lineage — modern (DX12) games are out of scope. Some shader effects (specular highlights, bumpmaps) can render at screen depth.',
        issues:              m.issues || [],
        notes:               m.notes || ''
    };
}

let written = 0, skipped = 0, exists = 0;
for (const [slug, m] of Object.entries(manifest.games)) {
    const outPath = path.join(GAMES, `${slug}.json`);
    if (fs.existsSync(outPath)) {
        console.log(`SKIP  ${slug}.json (already exists — add the vireio fix manually if needed)`);
        exists++;
        continue;
    }
    const game = {
        id:           slug.replace(/-/g, ''),
        title:        m.title,
        developer:    m.developer,
        graphics_api: m.graphics_api,
        default_path: `C:\\Program Files (x86)\\Steam\\steamapps\\common\\${m.title}\\${m.exe_name}`,
        exe_name:     m.exe_name,
        steam_app_id: m.steam_app_id,
        fixes:        [ makeFix(slug, m) ],
    };
    fs.writeFileSync(outPath, JSON.stringify(game, null, 2) + '\n', 'utf8');
    console.log(`WRITE ${slug}.json`);
    written++;
}
console.log(`\nDone: ${written} written, ${exists} already existed, ${skipped} skipped.`);
