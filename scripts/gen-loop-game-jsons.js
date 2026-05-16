#!/usr/bin/env node
/**
 * scripts/gen-loop-game-jsons.js
 *
 * One-shot generator: reads data/loop-mods/manifest.json and writes a
 * data/games/<game>.json for each Loop-supported game that doesn't already
 * have one. Skips games where a JSON already exists (won't clobber existing).
 *
 * Run: node scripts/gen-loop-game-jsons.js
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT     = path.join(__dirname, '..');
const MANIFEST = path.join(ROOT, 'data', 'loop-mods', 'manifest.json');
const GAMES    = path.join(ROOT, 'data', 'games');

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));

// Per-game metadata not in the manifest (title, developer, steam id, default
// install path, graphics API). Manifest stays Loop-focused; this map is
// Stereopticon-side bookkeeping. Steam IDs verified against store URLs.
const META = {
    'bioshock-remastered': {
        id: 'bioshockremastered',
        title: 'BioShock Remastered',
        developer: '2K Boston / Blind Squirrel',
        graphics_api: 'dx11',
        steam_app_id: '409710',
        rendering_method: 'XInput shim (engine hook)',
    },
    'dying-light-2': {
        id: 'dyinglight2',
        title: 'Dying Light 2 Stay Human',
        developer: 'Techland',
        graphics_api: 'dx12',
        steam_app_id: '534380',
        rendering_method: 'D3D12 view-matrix hook',
    },
    'eternal-afternoon': {
        id: 'eternalafternoon',
        title: 'Eternal Afternoon',
        developer: 'Tetsumetal',
        graphics_api: 'dx11',
        steam_app_id: '2580040',
        rendering_method: 'Mono.Cecil patcher + camera view-matrix injection',
    },
    'gone-home': {
        id: 'gonehome',
        title: 'Gone Home',
        developer: 'Fullbright',
        graphics_api: 'dx11',
        steam_app_id: '232430',
        rendering_method: 'Mono.Cecil patcher + camera view-matrix injection',
    },
    'green-hell': {
        id: 'greenhell',
        title: 'Green Hell',
        developer: 'Creepy Jar',
        graphics_api: 'dx11',
        steam_app_id: '815370',
        rendering_method: 'MelonLoader + Harmony camera prefix/postfix',
    },
    'obra-dinn': {
        id: 'obradinn',
        title: 'Return of the Obra Dinn',
        developer: 'Lucas Pope / 3909',
        graphics_api: 'dx11',
        steam_app_id: '653530',
        rendering_method: 'BepInEx 5 x86 + Harmony camera hook',
    },
    'outer-wilds': {
        id: 'outerwilds',
        title: 'Outer Wilds',
        developer: 'Mobius Digital',
        graphics_api: 'dx11',
        steam_app_id: '753640',
        rendering_method: 'OWML mod + transform save/restore on camera',
    },
    'peak': {
        id: 'peak',
        title: 'PEAK',
        developer: 'Aggro Crab / Landfall',
        graphics_api: 'dx11',
        steam_app_id: '3527290',
        rendering_method: 'BepInExPack (Thunderstore) + camera view-matrix',
    },
    'resident-evil-requiem': {
        id: 'residentevilrequiem',
        title: 'Resident Evil Requiem',
        developer: 'Capcom',
        graphics_api: 'dx12',
        steam_app_id: '2933130',
        rendering_method: 'REFramework plugin + RE Engine camera hook',
    },
    'subnautica': {
        id: 'subnautica',
        title: 'Subnautica',
        developer: 'Unknown Worlds',
        graphics_api: 'dx11',
        steam_app_id: '264710',
        rendering_method: 'BepInEx 5 + camera onPreCull view-matrix',
    },
    'valheim': {
        id: 'valheim',
        title: 'Valheim',
        developer: 'Iron Gate',
        graphics_api: 'dx11',
        steam_app_id: '892970',
        rendering_method: 'BepInEx 5 (subfolder install) + camera view-matrix',
    },
};

function makeFix(slug, mod, meta) {
    const fix = {
        id: `${meta.id}_loop_headtrack`,
        name: 'Loop Head Tracking',
        type: 'loop_headtrack',
        cost: 'free',
        authors: ['itsloopyo'],
        url: `https://github.com/${mod.loop_repo}`,
        loop_repo: mod.loop_repo,
        loader_type: mod.loader_type,
        license: 'MIT',
        recommended: true,
        rendering_method: meta.rendering_method,
        headtracking: '6dof',
        headtracking_method: 'freetrack_udp',
        headtracking_port: 4242,
        native_outputs: [],
        addon: true,
        addon_note: 'Headtracking-only — pair with a stereo fix (Geo-11, wiz3D, Vireio) to get 3D + headtracking together. Mono-only use is not supported in Stereopticon; use Loop\'s own Lopari launcher for that case.',
        pipeline_overrides: {},
        pros: 'Decoupled look and aim — head tracking moves the camera, mouse still controls aim. Built-in smoothing for network jitter.',
        cons: 'Headtracking only — does not produce 3D output on its own.',
        notes: `Reads OpenTrack-protocol UDP head pose on port 4242. Stereopticon's OpenTrack hub adapter handles emission. Pair with any Stereopticon stereo fix for the 3D side.`,
    };
    if (mod.loader_version_pin) fix.loader_version_pin = mod.loader_version_pin;
    if (mod.loader_pin_reason)  fix.loader_pin_reason  = mod.loader_pin_reason;
    if (mod.loader_arch)        fix.loader_arch        = mod.loader_arch;
    if (mod.loader_notes)       fix.loader_notes       = mod.loader_notes;
    if (mod.owml_unique_name)   fix.owml_unique_name   = mod.owml_unique_name;
    return fix;
}

const mods = manifest.mods;
let written = 0, skipped = 0;

for (const [slug, mod] of Object.entries(mods)) {
    const meta = META[slug];
    if (!meta) {
        console.warn(`No META entry for ${slug} — skipping`);
        continue;
    }

    const outPath = path.join(GAMES, `${slug}.json`);
    if (fs.existsSync(outPath)) {
        console.log(`SKIP ${slug}.json (already exists)`);
        skipped++;
        continue;
    }

    const exe = mod.exe_name;
    const game = {
        id:           meta.id,
        title:        meta.title,
        developer:    meta.developer,
        graphics_api: meta.graphics_api,
        default_path: `C:\\Program Files (x86)\\Steam\\steamapps\\common\\${meta.title}\\${exe}`,
        exe_name:     exe,
        steam_app_id: meta.steam_app_id,
        fixes: [ makeFix(slug, mod, meta) ],
    };

    fs.writeFileSync(outPath, JSON.stringify(game, null, 2) + '\n', 'utf8');
    console.log(`WRITE ${slug}.json`);
    written++;
}

console.log(`\nDone: ${written} written, ${skipped} skipped.`);
