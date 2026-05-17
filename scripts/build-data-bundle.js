#!/usr/bin/env node
/**
 * scripts/build-data-bundle.js
 *
 * Bundles every data/games/*.json, data/pipelines/*.json, and
 * data/outputs/*.json into one combined file at data/_bundle.json.
 *
 * With 7,000+ game JSONs, doing fs.readdirSync + fs.readFileSync per file
 * at app startup is the dominant cost of first paint. One bundle file =
 * one fs.read + one JSON.parse — order of magnitude faster on cold start.
 *
 * Re-run whenever data/ changes. Cheap (~0.5s for the full catalogue).
 *
 *   node scripts/build-data-bundle.js
 */
'use strict';
const fs   = require('fs');
const path = require('path');

const DATA       = path.join(__dirname, '..', 'data');
const OUT        = path.join(DATA, '_bundle.json');
const OUT_SIDEBAR = path.join(DATA, '_sidebar.json');

// Canonical-rendering-method classifier. Mirrors renderer.js's
// `normaliseRenderingMethod` but lives here so the build step can
// precompute filter data and the renderer doesn't need to walk every
// game's fixes on startup.
const NATIVE_STEREO_TYPES = new Set(['wiz3d_hd3d', 'wiz3d_opengl', 'wiz3d_3dvision_dm', 'native_stereo', 'native_legacy', '3d-vision']);
// Deprecated stereo3D tech — fix types whose primary deployment path no
// longer works on modern Windows/Nvidia drivers without wiz3D help. Games
// whose ONLY fix types are in this set are hidden by default behind the
// "Hide deprecated stereo3D tech" toggle.
//   * 3d-vision  — Nvidia killed the original 3D Vision driver in 2019
//   * tridef     — defunct, paid, replaced by community alternatives
//   * helixvision— legacy HelixMod-based VR wrapper (mostly superseded by UEVR/vorpX)
const DEPRECATED_FIX_TYPES = new Set(['3d-vision', 'tridef', 'helixvision']);
function canonicalRenderingMethod(fix) {
    if (!fix) return '—';
    if (fix.type === 'loop_headtrack') return '—';
    // Native-stereo types fold into Dual-View — same render-path classification.
    if (NATIVE_STEREO_TYPES.has(fix.type)) return 'Dual-View Rendering';
    const raw = String(fix.rendering_method || '');
    // 'Native Stereo Output' is unified into 'Dual-View Rendering'.
    if (/native stereo output/i.test(raw)) return 'Dual-View Rendering';
    const candidates = ['Multi-View Rendering', 'Dual-View Rendering', 'Sequential-View Rendering', 'Depth Map Reprojection', 'AI Reprojection'];
    for (const m of candidates) {
        if (raw.toLowerCase().includes(m.toLowerCase())) return m;
    }
    const t = fix.type || '';
    if (/reproject|depth|2d to 3d|2d3d/i.test(raw)) return /ai|neural|ml/i.test(raw) ? 'AI Reprojection' : 'Depth Map Reprojection';
    if (/multi.?view|quilt|holograph|looking.?glass/i.test(raw)) return 'Multi-View Rendering';
    if (/sequential|shutter|frame.?sequential|page.?flip/i.test(raw)) return 'Sequential-View Rendering';
    if (/^reshade|^superdepth|^rendepth/i.test(t)) return 'Depth Map Reprojection';
    if (/^lkg|looking_glass/i.test(t)) return 'Multi-View Rendering';
    return 'Dual-View Rendering';
}

// Lookup of per-pipeline supported outputs. Built once at bundle time
// from data/pipelines/*.json. Used to figure out whether a game has any
// non-VR output route available before deciding to flag it VR-only.
let _pipelineOutputsByType = null;
function _buildPipelineOutputLookup(pipelines) {
    if (_pipelineOutputsByType) return _pipelineOutputsByType;
    _pipelineOutputsByType = new Map();
    for (const p of pipelines) {
        _pipelineOutputsByType.set(p.id, new Set(Object.keys(p.supported_outputs || {})));
    }
    return _pipelineOutputsByType;
}

// Light projection for the sidebar — just enough to drive filtering and
// to paint the nav-item row. Full game data is fetched lazily via IPC
// when the user clicks a row.
function sidebarProjection(g) {
    const fixes = Array.isArray(g.fixes) ? g.fixes : [];
    const outputs   = new Set();
    const fixTypes  = new Set();   // every unique fix.type — drives the Mods filter
    let hasHT = false, hasNative = false;
    const methods = new Set();
    let recType = null;
    let allFixesVR = fixes.length > 0;
    for (const f of fixes) {
        if (Array.isArray(f.native_outputs)) f.native_outputs.forEach(o => outputs.add(o));
        if (f.type) fixTypes.add(f.type);
        if (f.headtracking && f.headtracking !== 'None' && f.headtracking !== 'none') hasHT = true;
        if (NATIVE_STEREO_TYPES.has(f.type) || /native stereo output/i.test(f.rendering_method || '')) hasNative = true;
        methods.add(canonicalRenderingMethod(f));
        if (f.recommended && !recType) recType = f.type;
        const mode = String(f.compat_mode || f.mode || '').trim().toUpperCase();
        if (mode !== 'VR') allFixesVR = false;
    }
    if (!recType && fixes[0]) recType = fixes[0].type;
    const outputsArr = [...outputs];
    const isVrOnly = allFixesVR;
    // A game is "deprecated-only" if EVERY one of its fix types is in
    // the deprecated bucket — meaning there's no modern path to play it
    // in stereo without wiz3D injection (which most don't have).
    const isDeprecatedOnly = fixes.length > 0 && [...fixTypes].every(t => DEPRECATED_FIX_TYPES.has(t));
    return {
        id:                  g.id,
        title:               g.title,
        steam_app_id:        g.steam_app_id || '',
        native_outputs:      outputsArr,
        has_headtracking:    hasHT,
        has_native_stereo:   hasNative,
        rendering_methods:   [...methods],
        recommended_fix_type:recType || '',
        fix_types:           [...fixTypes],
        fix_count:           fixes.length,
        is_vr_only:          isVrOnly,
        is_deprecated_only:  isDeprecatedOnly,
    };
}

function loadDir(name) {
    const dir = path.join(DATA, name);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(f => f.endsWith('.json'))
        .map(f => {
            try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); }
            catch (e) { console.warn(`Skipping ${name}/${f}: ${e.message}`); return null; }
        })
        .filter(Boolean);
}

const t0 = Date.now();
const games     = loadDir('games');
const pipelines = loadDir('pipelines');
const outputs   = loadDir('outputs');

// Build the pipeline output lookup once before the sidebar projection
// runs — otherwise `_pipelineOutputsByType` is null and the VR-only check
// has no data to work with.
_buildPipelineOutputLookup(pipelines);

const bundle = {
    schema_version: 1,
    built_at:       new Date().toISOString(),
    counts: { games: games.length, pipelines: pipelines.length, outputs: outputs.length },
    games, pipelines, outputs,
};

fs.writeFileSync(OUT, JSON.stringify(bundle));
const sizeKb = Math.round(fs.statSync(OUT).size / 1024);

// Sidebar projection — small, fast to send over IPC, holds every filter
// field but none of the per-fix detail.
const sidebar = {
    schema_version: 1,
    built_at:       new Date().toISOString(),
    games:          games.map(sidebarProjection),
    pipelines,
    outputs,
};
fs.writeFileSync(OUT_SIDEBAR, JSON.stringify(sidebar));
const sidebarKb = Math.round(fs.statSync(OUT_SIDEBAR).size / 1024);

const ms = Date.now() - t0;
console.log(`Bundle:  ${games.length} games, ${pipelines.length} pipelines, ${outputs.length} outputs → ${OUT}`);
console.log(`         ${sizeKb} KB`);
console.log(`Sidebar: ${OUT_SIDEBAR}`);
console.log(`         ${sidebarKb} KB (${Math.round(100*sidebarKb/sizeKb)}% of full bundle)`);
console.log(`Built in ${ms}ms`);
