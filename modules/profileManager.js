'use strict';
/**
 * modules/profileManager.js
 *
 * Resolves the active pipeline for a game fix + selected display combination,
 * then writes the necessary tool configuration files to disk.
 *
 * Data flow:
 *   game fix profile  (data/games/*.json)       — what the fix natively outputs
 *   output spec       (data/outputs/*.json)      — what a format IS (sbs, sr_weave, etc.)
 *   display profile   (data/displays/*.json)     — what the user's hardware needs + tool config
 *   pipeline spec     (data/pipelines/*.json)    — how intermediary software works
 *
 *   profileManager resolves: fix output → display accepted_fix_outputs → pipeline steps
 *   then calls applyDisplayConfig() to write VRto3D / XRGameBridge / ReShade configs.
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const DATA_ROOT     = path.join(__dirname, '..', 'data');
const DISPLAYS_DIR  = path.join(DATA_ROOT, 'displays');
const OUTPUTS_DIR   = path.join(DATA_ROOT, 'outputs');
const PIPELINES_DIR = path.join(DATA_ROOT, 'pipelines');

// ── Loaders ───────────────────────────────────────────────────

function loadDisplay(displayId) {
    const p = path.join(DISPLAYS_DIR, `${displayId}.json`);
    if (!fs.existsSync(p)) throw new Error(`Display profile not found: ${displayId}`);
    return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function loadOutput(outputId) {
    const p = path.join(OUTPUTS_DIR, `${outputId}.json`);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function loadAllDisplays() {
    if (!fs.existsSync(DISPLAYS_DIR)) return [];
    return fs.readdirSync(DISPLAYS_DIR)
        .filter(f => f.endsWith('.json'))
        .map(f => JSON.parse(fs.readFileSync(path.join(DISPLAYS_DIR, f), 'utf8')));
}

// ── Pipeline resolution ───────────────────────────────────────

/**
 * Given a fix profile and a display profile, returns the resolved pipeline:
 * {
 *   fixOutput:    string,           — which output format the fix produces (e.g. "sbs")
 *   steps:        string[],         — ordered list of intermediary software needed
 *   vrDriver:     string|null,      — "vrto3d" | "xrgamebridge" | null
 *   vrDriverConfig: object,         — merged tool config for the VR driver
 *   warnings:     string[],         — non-fatal issues to surface in UI
 * }
 */
function resolvePipeline(fix, display, options = {}) {
    const { graphicsApi = null, preferVrDriver = null } = options;
    const warnings = [];

    // 1. Determine which output the fix produces for this display.
    //    Prefer the first native_output that the display accepts.
    //    Fall back to any native_output that has a conversion path.
    const accepted = display.accepted_fix_outputs || {};
    let fixOutput  = null;
    let outputPath = null;

    // Direct match first
    for (const out of (fix.native_outputs || [])) {
        if (accepted[out]) { fixOutput = out; outputPath = accepted[out]; break; }
    }

    // Vulkan special-case: if graphicsApi is vulkan and display has a _vulkan variant
    if (graphicsApi === 'vulkan' && fixOutput && accepted[`${fixOutput}_vulkan`]) {
        fixOutput  = `${fixOutput}_vulkan`;
        outputPath = accepted[fixOutput];
    }

    if (!fixOutput) {
        return {
            fixOutput:     null,
            steps:         [],
            vrDriver:      null,
            vrDriverConfig: {},
            warnings:      [`No compatible output path from fix "${fix.id}" to display "${display.id}".`],
            incompatible:  true,
        };
    }

    // 2. Check API constraints on this output path
    if (outputPath.constraints?.graphics_api && graphicsApi) {
        if (!outputPath.constraints.graphics_api.includes(graphicsApi)) {
            warnings.push(`${display.name}: ${graphicsApi} is not supported via the ${fixOutput} path. ${outputPath.constraints.notes || ''}`);
        }
    }

    // 3. Determine VR driver (only relevant for UEVR / VR mod fix types)
    let vrDriver       = null;
    let vrDriverConfig = {};
    const isVrFix      = ['uevr', 'reframework', 'realvr', 'noflat'].includes(fix.type);

    if (isVrFix && display.vr_drivers) {
        const drivers = display.vr_drivers;

        // Pick preferred driver if specified and supported
        if (preferVrDriver && drivers[preferVrDriver]?.supported) {
            vrDriver = preferVrDriver;
        } else if (drivers.xrgamebridge?.supported && fix.type === 'uevr') {
            // XRGameBridge preferred for UEVR on SR displays (lower latency, OpenXR native)
            vrDriver = 'xrgamebridge';
        } else if (drivers.vrto3d?.supported) {
            vrDriver = 'vrto3d';
        }

        if (vrDriver) {
            vrDriverConfig = { ...(drivers[vrDriver].config || {}) };
        }
    }

    return {
        fixOutput,
        steps:         outputPath.steps || [],
        vrDriver,
        vrDriverConfig,
        warnings,
        incompatible:  false,
        displayNotes:  outputPath.notes || null,
    };
}

// ── Tool config writers ───────────────────────────────────────

/**
 * Finds the SteamVR config directory.
 * VRto3D v4+ stores profiles in Steam/config/vrto3d/
 */
function getSteamVRConfigDir() {
    const candidates = [
        path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Steam', 'config'),
        path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Steam', 'config'),
        path.join(os.homedir(), 'AppData', 'Local', 'Steam', 'config'),
    ];
    return candidates.find(d => fs.existsSync(d)) || null;
}

/**
 * Writes VRto3D default_config.json with merged display + game-specific overrides.
 * VRto3D v4+: config lives in Steam/config/vrto3d/default_config.json
 */
function applyVRto3DConfig(displayConfig = {}, gameOverrides = {}) {
    const steamConfig = getSteamVRConfigDir();
    if (!steamConfig) {
        return { success: false, error: 'SteamVR config directory not found. Is SteamVR installed?' };
    }

    const vrto3dDir    = path.join(steamConfig, 'vrto3d');
    const configPath   = path.join(vrto3dDir, 'default_config.json');

    // Start from existing config if present, so we don't stomp user customisations
    let existing = {};
    if (fs.existsSync(configPath)) {
        try { existing = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}
    }

    // VRto3D v4 defaults (from docs)
    const defaults = {
        display_index:     0,
        render_width:      1920,
        render_height:     1080,
        hmd_height:        1.0,
        aspect_ratio:      1.77778,
        fov:               90.0,
        depth:             0.1,
        convergence:       4.0,
        async_enable:      false,
        tab_enable:        false,
        framepack_offset:  0,
        reverse_enable:    false,
        vd_fsbs_hack:      false,
        dash_enable:       false,
        auto_focus:        true,
        display_latency:   0.011,
        display_frequency: 60.0,
        pitch_enable:      false,
        yaw_enable:        false,
        use_open_track:    false,
        open_track_port:   4242,
        launch_script:     '',
    };

    const merged = { ...defaults, ...existing, ...displayConfig, ...gameOverrides };

    try {
        fs.mkdirSync(vrto3dDir, { recursive: true });
        fs.writeFileSync(configPath, JSON.stringify(merged, null, 2));
        return { success: true, path: configPath };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/**
 * Writes a VRto3D per-game profile to Steam/config/vrto3d/GameExe_config.json.
 * This is separate from default_config — VRto3D auto-loads it when the game starts.
 */
function applyVRto3DGameProfile(exeName, profileData = {}) {
    const steamConfig = getSteamVRConfigDir();
    if (!steamConfig) return { success: false, error: 'SteamVR config not found.' };

    const vrto3dDir  = path.join(steamConfig, 'vrto3d');
    const profileKey = exeName.replace(/\.exe$/i, '');
    const profilePath = path.join(vrto3dDir, `${profileKey}_config.json`);

    // Per-game profiles only store the "+" settings (depth, convergence, fov, pitch/yaw etc)
    const gameProfile = {
        depth:         profileData.depth       ?? 0.1,
        convergence:   profileData.convergence ?? 4.0,
        fov:           profileData.fov         ?? 90.0,
        pitch_enable:  profileData.pitch_enable ?? false,
        yaw_enable:    profileData.yaw_enable   ?? false,
        async_enable:  profileData.async_enable ?? false,
    };

    // Merge in any extra overrides from the fix profile
    const merged = { ...gameProfile, ...(profileData.vrto3d_overrides || {}) };

    try {
        fs.mkdirSync(vrto3dDir, { recursive: true });
        fs.writeFileSync(profilePath, JSON.stringify(merged, null, 2));
        return { success: true, path: profilePath };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/**
 * Installs a UEVR profile JSON to %AppData%\UnrealVRMod\[GameName]\config.txt
 * UEVR loads this automatically when injected into a matching game.
 */
function applyUEVRProfile(gameName, profileJson) {
    const uevrDir     = path.join(os.homedir(), 'AppData', 'Roaming', 'UnrealVRMod', gameName);
    const profilePath = path.join(uevrDir, 'config.txt');

    try {
        fs.mkdirSync(uevrDir, { recursive: true });
        const content = typeof profileJson === 'string'
            ? profileJson
            : JSON.stringify(profileJson, null, 2);
        fs.writeFileSync(profilePath, content);
        return { success: true, path: profilePath };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

// ── Headtracking helpers ──────────────────────────────────────

/**
 * Enables OpenTrack support in VRto3D default_config.json.
 * Called when user selects an OpenTrack-based headtracking method.
 */
function enableVRto3DOpenTrack(port = 4242) {
    return applyVRto3DConfig({ use_open_track: true, open_track_port: port });
}

/**
 * Configures VRto3D to auto-launch a head tracking service on SteamVR start.
 * e.g. VertoXR for AR glasses: launch_script = "start vertoxr://steamvr"
 */
function setVRto3DLaunchScript(script) {
    return applyVRto3DConfig({ launch_script: script });
}

// ── Main API ──────────────────────────────────────────────────

/**
 * Full pipeline application for a game session.
 * Called when the user clicks "Apply" or "Launch" for a fix + display combination.
 *
 * @param {object} fix      - fix profile from game JSON
 * @param {string} displayId - selected display id (e.g. "acer_spatiallabs")
 * @param {object} options  - { graphicsApi, preferVrDriver, gameOverrides }
 * @returns {object} result with { success, pipeline, applied, warnings, errors }
 */
function applyProfile(fix, displayId, options = {}) {
    const { gameOverrides = {} } = options;
    const results = { success: true, pipeline: null, applied: [], warnings: [], errors: [] };

    // Load display profile
    let display;
    try { display = loadDisplay(displayId); }
    catch (e) { return { ...results, success: false, errors: [e.message] }; }

    // Resolve pipeline
    const pipeline = resolvePipeline(fix, display, {
        graphicsApi:    options.graphicsApi || fix.graphics_api || null,
        preferVrDriver: options.preferVrDriver || null,
    });
    results.pipeline = pipeline;
    results.warnings.push(...pipeline.warnings);

    if (pipeline.incompatible) {
        return { ...results, success: false };
    }

    // Apply VR driver config if needed
    if (pipeline.vrDriver === 'vrto3d') {
        const r = applyVRto3DConfig(pipeline.vrDriverConfig, gameOverrides.vrto3d || {});
        if (r.success) results.applied.push(`VRto3D config → ${r.path}`);
        else results.errors.push(`VRto3D config: ${r.error}`);

        // Also write per-game profile if fix has vrto3d settings
        if (fix.exe_name && (fix.vrto3d_profile || gameOverrides.vrto3d_game)) {
            const gp = applyVRto3DGameProfile(
                fix.exe_name,
                { ...(fix.vrto3d_profile || {}), ...(gameOverrides.vrto3d_game || {}) }
            );
            if (gp.success) results.applied.push(`VRto3D game profile → ${gp.path}`);
            else results.errors.push(`VRto3D game profile: ${gp.error}`);
        }

        // Configure OpenTrack if display headtracking needs it
        if (display.headtracking?.methods?.includes('opentrack') && options.enableHeadtracking) {
            const ht = enableVRto3DOpenTrack(display.headtracking.open_track_port || 4242);
            if (ht.success) results.applied.push('OpenTrack enabled in VRto3D config');
        }

        // Auto-launch script (e.g. VertoXR for AR glasses)
        if (options.headtrackingLaunchScript) {
            setVRto3DLaunchScript(options.headtrackingLaunchScript);
        }
    }

    // Apply UEVR profile if fix type is uevr and profile data is present
    if (['uevr', 'reframework'].includes(fix.type) && fix.uevr_profile && fix.uevr_game_name) {
        const ur = applyUEVRProfile(fix.uevr_game_name, fix.uevr_profile);
        if (ur.success) results.applied.push(`UEVR profile → ${ur.path}`);
        else results.errors.push(`UEVR profile: ${ur.error}`);
    }

    if (results.errors.length > 0) results.success = false;
    return results;
}

/**
 * Returns pipeline info without writing any files.
 * Used by the UI to show what will happen before the user confirms.
 */
function previewPipeline(fix, displayId, options = {}) {
    let display;
    try { display = loadDisplay(displayId); }
    catch (e) { return { incompatible: true, error: e.message }; }

    return resolvePipeline(fix, display, {
        graphicsApi:    options.graphicsApi || fix.graphics_api || null,
        preferVrDriver: options.preferVrDriver || null,
    });
}

// ── Resolver-driven adapter execution ────────────────────────
// Replaces the legacy applyProfile() one-call-does-everything path. Resolves
// the pipeline, then dispatches to per-tool adapters (modules/adapters/*.js).
// Adds missing adapters as warnings, not errors — keeps the launcher additive.

const adapters = require('./adapters');

/**
 * Resolve pipeline + execute all adapters for a fix selection.
 *
 * @param {object} input - {
 *   fix,                  // fix object from data/games/<game>.json
 *   displayId,            // selected display profile id (e.g. "acer_spatiallabs")
 *   outputId,             // selected output (e.g. "sbs_half")
 *   gameContext: { id, exeName, gamePath },
 *   headtracking,         // optional { enabled, method, port }
 *   userOverrides,        // optional per-adapter modal overrides
 *   options,              // optional { graphicsApi, preferVrDriver }
 * }
 * @returns {Promise<{ success, pipeline, applied, errors, warnings }>}
 */
async function executePipeline(input) {
    const {
        fix, displayId, outputId, gameContext = {},
        headtracking = {}, userOverrides = {}, options = {},
    } = input || {};

    if (!fix)       return { success: false, errors: ['executePipeline: no fix'], applied: [], warnings: [] };
    if (!displayId) return { success: false, errors: ['executePipeline: no displayId'], applied: [], warnings: [] };

    // Resolve the pipeline from the registry
    let display;
    try { display = loadDisplay(displayId); }
    catch (e) { return { success: false, errors: [e.message], applied: [], warnings: [] }; }

    const pipeline = resolvePipeline(fix, display, {
        graphicsApi:    options.graphicsApi || fix.graphics_api || null,
        preferVrDriver: options.preferVrDriver || null,
    });

    if (pipeline.incompatible) {
        return {
            success: false,
            pipeline,
            applied:  [],
            errors:   pipeline.warnings,
            warnings: [],
        };
    }

    // Build the adapter context
    const ctx = {
        fix, display, pipeline,
        outputId,
        gameContext,
        headtracking,
        userOverrides,
    };

    const result = await adapters.executePipeline(ctx);
    result.pipeline = pipeline;
    // Surface resolver warnings alongside adapter warnings
    if (pipeline.warnings?.length) {
        result.warnings = [...(pipeline.warnings || []), ...(result.warnings || [])];
    }
    return result;
}

module.exports = {
    loadDisplay,
    loadOutput,
    loadAllDisplays,
    resolvePipeline,
    applyProfile,
    previewPipeline,
    executePipeline,
    applyVRto3DConfig,
    applyVRto3DGameProfile,
    applyUEVRProfile,
    enableVRto3DOpenTrack,
    setVRto3DLaunchScript,
    getSteamVRConfigDir,
};