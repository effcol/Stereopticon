'use strict';
/**
 * modules/adapters/vireio.js
 *
 * Vireio Perception engine adapter. Stereopticon ships Vireio v4.1 bundled at
 * engine/vireio/Release/Perception/bin/x64/ (LGPL-v3 source files redistributed
 * here under GPL-v3 per the LGPL→GPL upgrade clause).
 *
 * Inicio.exe now accepts CLI flags (added in S4.1):
 *   --workspace <path-to-.aqu>   pre-loads the workspace file
 *   --target    <exe-name>       pre-sets the target process
 *   --autorun                    runs the Load+Inject flow on startup, no clicks
 *
 * This adapter passes the workspace + exe + autorun flag when the fix profile
 * provides `vireio_workspace`; otherwise it falls back to launching Inicio
 * interactively so the user can pick selections manually.
 */

const path  = require('path');
const fs    = require('fs');
const { spawn } = require('child_process');

// Resolve the path to the bundled Vireio binaries. Walks up from this file's
// location to project root, then into engine/vireio/Release/...
function findVireioBinaries() {
    const projectRoot = path.join(__dirname, '..', '..');
    const candidates = [
        // Release build (preferred)
        path.join(projectRoot, 'engine', 'vireio', 'Release', 'Perception', 'bin', 'x64'),
        // Debug build (fallback if user only built Debug)
        path.join(projectRoot, 'engine', 'vireio', 'Debug',   'Perception', 'bin', 'x64'),
    ];
    for (const dir of candidates) {
        const inicio = path.join(dir, 'Inicio.exe');
        if (fs.existsSync(inicio)) {
            return { dir, inicio, build: dir.includes('Debug') ? 'debug' : 'release' };
        }
    }
    return null;
}

async function applyConfig(ctx) {
    const { fix, gameContext, headtracking } = ctx;
    const result = { success: true, applied: [], errors: [], warnings: [] };

    // Two trigger conditions:
    //   1) The stereo fix is a Vireio fix → full stereo + HT pipeline
    //   2) The HT Fix is 'vireio' but the stereo fix is something else
    //      (Geo-11 / wiz3D / etc.) → HT-only mode, just the FreeTrackTracker
    //      plugin emitting OpenTrack UDP, no stereo injection from Vireio.
    const isStereoFix = fix?.type === 'vireio';
    const isHtOnly    = headtracking?.method === 'vireio' && !isStereoFix;
    if (!isStereoFix && !isHtOnly) return result;

    const binaries = findVireioBinaries();
    if (!binaries) {
        result.success = false;
        result.errors.push(
            'Vireio engine binaries not found. Build engine/vireio/VS2019/VireioPerception.sln ' +
            '(Release|x64) before selecting a Vireio fix. See engine/vireio/README.md.'
        );
        return result;
    }

    // Resolve workspace .aqu path. For the stereo-fix path we use the
    // game-specific workspace declared in the fix; for HT-only we use a
    // dedicated headtrack-only workspace shipped with the engine.
    let workspacePath = null;
    if (isStereoFix) {
        workspacePath = fix.vireio_workspace || null;
    } else if (isHtOnly) {
        // Engine ships a FreeTrackTracker-only workspace at Profiles/HeadTrackingOnly.aqu.
        // Engine-side TODO: build/maintain that workspace (currently absent in v4 builds).
        workspacePath = 'Profiles/HeadTrackingOnly.aqu';
    }
    if (workspacePath && !path.isAbsolute(workspacePath)) {
        workspacePath = path.join(binaries.dir, workspacePath);
    }
    if (workspacePath && !fs.existsSync(workspacePath)) {
        if (isHtOnly) {
            result.warnings.push(
                'Vireio HT-only workspace not yet bundled — Inicio launched interactively. ' +
                'Pick "FreeTrackTracker → OpenTrack UDP" plugins in the New Project window.'
            );
        } else {
            result.warnings.push(`Vireio workspace not found at ${workspacePath} — falling back to interactive launch.`);
        }
        workspacePath = null;
    }

    const args = [];
    if (workspacePath)         args.push('--workspace', workspacePath);
    if (gameContext?.exeName)  args.push('--target',    gameContext.exeName);
    if (workspacePath)         args.push('--autorun');

    try {
        const child = spawn(binaries.inicio, args, {
            detached: true,
            stdio:    'ignore',
            cwd:      binaries.dir,
            shell:    false,
        });
        child.on('error', err => {
            console.error('[vireio adapter] Inicio spawn error:', err);
        });
        child.unref();
        const modeLabel = isHtOnly ? 'HT-only' : 'stereo';
        result.applied.push(
            workspacePath
                ? `Inicio.exe autorun (${binaries.build}, ${modeLabel}) — workspace="${path.basename(workspacePath)}", target="${gameContext?.exeName || '?'}"`
                : `Inicio.exe launched (${binaries.build}, ${modeLabel}) — interactive mode`
        );
    } catch (e) {
        result.success = false;
        result.errors.push(`Failed to spawn Inicio.exe: ${e.message}`);
        return result;
    }

    if (!workspacePath) {
        result.warnings.push(
            'Vireio fix has no vireio_workspace field — Inicio launched interactively. ' +
            'Add `"vireio_workspace": "Profiles/YourGame.aqu"` to the fix JSON to enable autorun.'
        );
    }

    return result;
}

module.exports = {
    id:   'vireio',
    name: 'Vireio Perception',
    applyConfig,
    // Self-skips when neither stereo-vireio nor ht-only-vireio triggers fire,
    // so it's safe to invoke every launch. Lets HT-only mode run alongside a
    // Geo-11 / wiz3D / etc. stereo fix without needing to be in pipeline.steps.
    alwaysRun: true,
};
