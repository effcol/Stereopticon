#!/usr/bin/env node
/**
 * scripts/gen-vireio-games-from-xml.js
 *
 * Parses the official Vireio Perception v3 profiles.xml at
 * engine/vireio/Perception_v3/Release/Perception/cfg/profiles.xml and writes
 * a data/games/<slug>.json entry for every distinct game_name with a
 * `type: "vireio"` fix entry.
 *
 * Skips entries that look like launcher stubs (game_type 0021220 with no
 * shaderModRules) — those are passthrough redirects, not real game profiles.
 * Skips data/games/<slug>.json files that already exist (won't clobber).
 *
 *   node scripts/gen-vireio-games-from-xml.js
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT  = path.join(__dirname, '..');
const XML   = path.join(ROOT, 'engine', 'vireio', 'Perception_v3', 'Release', 'Perception', 'cfg', 'profiles.xml');
const GAMES = path.join(ROOT, 'data', 'games');

const xml = fs.readFileSync(XML, 'utf8');

// Each <profile> entry is a self-closing XML tag. Extract attributes via regex
// — quicker than pulling in an XML parser dep.
const profiles = [];
const profileRe = /<profile\b([^>]*?)\/?>/g;
let match;
while ((match = profileRe.exec(xml)) !== null) {
    const attrs = {};
    const attrRe = /(\w[\w-]*)\s*=\s*"([^"]*)"/g;
    let a;
    while ((a = attrRe.exec(match[1])) !== null) attrs[a[1]] = a[2];
    profiles.push(attrs);
}

// Filter:
//   - drop launcher / installer / loader passthrough entries
//   - keep only entries with shaderModRules (means there's an actual stereo profile)
//   - dedup by game_name (first occurrence wins; their game_exe varies)
const seen = new Set();
const games = [];
const LAUNCHER_NAME_RX = /(launcher|loader|skse|nexus)/i;
for (const p of profiles) {
    const name = p.game_name?.trim();
    if (!name) continue;
    if (seen.has(name)) continue;
    if (!p.shaderModRules) continue;            // pure launcher redirect
    if (LAUNCHER_NAME_RX.test(name)) continue;  // explicit launcher label
    seen.add(name);
    games.push(p);
}

console.log(`Parsed ${profiles.length} profile entries → ${games.length} unique stereo-fix games`);

// Map per-game shaderModRules filename → renderer-friendly notes about
// which engine the profile uses (purely descriptive — Vireio internally
// switches behaviour by game_type, not by us).
function slugify(name) {
    return name.toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

function makeGame(p) {
    const slug   = slugify(p.game_name);
    const fixId  = slug.replace(/-/g, '_') + '_vireio';
    const ruleFile = (p.shaderModRules || '').replace(/^.*[/\\]/, '');   // strip path
    const fix = {
        id:    fixId,
        name:  'Vireio Perception',
        type:  'vireio',
        cost:  'free',
        authors:    ['Denis Reischl', 'Grant Bagwell', 'Simon Brown', 'Neil Schneider'],
        url:        'https://github.com/OpenSourceVR/Vireio-Perception',
        license:    'LGPL-3.0',
        recommended: true,
        rendering_method:    'Dual-View Rendering',
        headtracking:        '6dof',
        headtracking_method: 'opentrack',
        headtracking_port:   4242,
        vireio_workspace:    `Profiles/${slug.replace(/-([a-z])/g, (_,c)=>c.toUpperCase()).replace(/^[a-z]/, c=>c.toUpperCase())}.aqu`,
        vireio_v3_rules:     ruleFile || null,
        vireio_v3_game_type: p.game_type || null,
        cpu_architecture:    p.cpu_architecture || null,
        native_outputs:      ['sbs', 'sbs_half', 'tab', 'tab_half', 'anaglyph', 'interlaced', 'frame_sequential'],
        pipeline_overrides:  {},
        pros:    'Open-source stereo + 6DOF headtracking. Per-game shader profile bundled in the Vireio v3 catalogue.',
        cons:    'Older driver lineage — DX9 / DX11 only. Some shader effects may render at screen depth.',
        notes:   `Profile maps to Vireio v3 rule file '${ruleFile}'. ${p.cpu_architecture ? `Architecture: ${p.cpu_architecture}.` : ''}`.trim()
    };
    return {
        id:           slug.replace(/-/g, ''),
        title:        p.game_name,
        developer:    'Unknown (Vireio v3 catalogue)',
        graphics_api: p.cpu_architecture === '64bit' ? 'dx11' : 'dx9',
        default_path: `C:\\Program Files (x86)\\Steam\\steamapps\\common\\${p.game_name}\\${p.game_exe}`,
        exe_name:     p.game_exe,
        fixes:        [fix]
    };
}

let written = 0, skipped = 0;
for (const p of games) {
    const slug = slugify(p.game_name);
    const outPath = path.join(GAMES, `${slug}.json`);
    if (fs.existsSync(outPath)) { console.log(`SKIP  ${slug}.json (already exists)`); skipped++; continue; }
    fs.writeFileSync(outPath, JSON.stringify(makeGame(p), null, 2) + '\n', 'utf8');
    console.log(`WRITE ${slug}.json — ${p.game_name}`);
    written++;
}
console.log(`\nDone: ${written} written, ${skipped} skipped (already in catalogue).`);
console.log(`Run 'node scripts/verify-steam-ids.js --resolve' next to fill in steam_app_id values.`);
