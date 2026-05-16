'use strict';
/**
 * modules/adapters/loop.js
 *
 * Adapter for Loop / itsloopyo per-game head-tracking mods. Each mod is a
 * separate GitHub repo (`itsloopyo/<game>-headtracking`) with a launcher-
 * driven `install.cmd <game-path> /y` contract — except Outer Wilds, which
 * ships through OWML's mod manager and uses a different install path.
 *
 * Stereopticon scope rule (user decision 2026-05): Loop mods are only used
 * here for **headtracking in 3D**. Mono+headtrack is Lopari's territory —
 * this adapter refuses to install when the resolved output isn't stereoscopic.
 *
 * Pipeline integration: the mod listens on UDP 4242 inside the game. We
 * just need OpenTrack running and emitting FreeTrack 2.0 to 4242 — handled
 * by modules/adapters/opentrack.js when headtracking.method='opentrack'.
 *
 * Loop writes `.headtracking-state.json` at the game root as the canonical
 * install marker — we read it to skip redundant downloads.
 */

const path = require('path');
const fs   = require('fs');
const os   = require('os');
const { installLoopMod, installLoopModOWML } = require('../loopInstaller');

function isAlreadyInstalled(gamePath, fixId) {
    const marker = path.join(gamePath, '.headtracking-state.json');
    if (!fs.existsSync(marker)) return false;
    try {
        const state = JSON.parse(fs.readFileSync(marker, 'utf8'));
        return !!state?.mod?.id;
    } catch {
        return false;
    }
}

// Output IDs that are stereoscopic — anything else is a mono 2D output where
// Loop's own Lopari launcher is a better recommendation.
const STEREO_OUTPUTS = new Set([
    'sbs', 'sbs_half', 'tab', 'tab_half',
    'anaglyph', 'anaglyph_red_cyan', 'anaglyph_green_magenta', 'anaglyph_amber_blue',
    'interleaved', 'interleaved_row', 'interleaved_col', 'interleaved_checkerboard',
    'frame_sequential', 'frame_packing',
    'sr_weave', 'vr_native', 'lkg_quilt',
]);

async function applyConfig(ctx) {
    const { fix, gameContext, outputId, headtracking } = ctx;
    const result = { success: true, applied: [], errors: [], warnings: [] };

    if (!fix || fix.type !== 'loop_headtrack') return result;
    if (!gameContext?.gamePath) {
        result.warnings.push('loop adapter skipped — no gamePath in context');
        return result;
    }

    if (!STEREO_OUTPUTS.has(outputId)) {
        result.success = false;
        result.errors.push(
            'Loop mods in Stereopticon are for headtracking *in 3D* only. ' +
            'For mono headtracking, use Loop\'s own Lopari launcher: ' +
            'https://github.com/itsloopyo/lopari-releases'
        );
        return result;
    }

    if (!headtracking?.enabled) {
        result.warnings.push(
            'Loop mod installed but headtracking is disabled in Stereopticon — the mod ' +
            'is loaded but will receive no pose data until headtracking is turned on.'
        );
    }

    const loaderType = fix.loader_type || 'install_cmd';
    const useOWML    = loaderType === 'OWML';

    // OWML deploys to %APPDATA%/OuterWildsModManager — the install marker
    // lives there rather than at the game root, so the game-root marker
    // check doesn't apply.
    const alreadyInstalled = useOWML
        ? isAlreadyInstalledOWML(fix.owml_unique_name)
        : isAlreadyInstalled(gameContext.gamePath, fix.id);

    if (!alreadyInstalled) {
        const installResult = useOWML
            ? await installLoopModOWML(fix)
            : await installLoopMod(fix, gameContext.gamePath);
        if (!installResult.success) result.success = false;
        result.applied.push(...installResult.applied);
        result.errors.push(...installResult.errors);
        result.warnings.push(...installResult.warnings);
    } else {
        result.applied.push(
            useOWML
                ? `Loop mod already present in OWML mods folder (${fix.owml_unique_name})`
                : `Loop mod already installed at ${gameContext.gamePath}`
        );
    }

    return result;
}

function isAlreadyInstalledOWML(uniqueName) {
    if (!uniqueName) return false;
    const dir = path.join(os.homedir(), 'AppData', 'Roaming', 'OuterWildsModManager', 'OWML', 'Mods', uniqueName);
    return fs.existsSync(path.join(dir, 'manifest.json'));
}

module.exports = {
    id:   'loop_headtrack',
    name: 'Loop Head-Tracking Mod',
    applyConfig,
};
