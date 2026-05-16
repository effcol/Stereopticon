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
    const { fix, gameContext } = ctx;
    const result = { success: true, applied: [], errors: [], warnings: [] };

    if (!fix || fix.type !== 'vireio') {
        return result;
    }

    const binaries = findVireioBinaries();
    if (!binaries) {
        result.success = false;
        result.errors.push(
            'Vireio engine binaries not found. Build engine/vireio/VS2019/VireioPerception.sln ' +
            '(Release|x64) before selecting a Vireio fix. See engine/vireio/README.md.'
        );
        return result;
    }

    // Resolve workspace .aqu path (relative paths are joined to the engine dir).
    let workspacePath = fix.vireio_workspace || null;
    if (workspacePath && !path.isAbsolute(workspacePath)) {
        workspacePath = path.join(binaries.dir, workspacePath);
    }
    if (workspacePath && !fs.existsSync(workspacePath)) {
        result.warnings.push(`Vireio workspace not found at ${workspacePath} — falling back to interactive launch.`);
        workspacePath = null;
    }

    const args = [];
    if (workspacePath)         args.push('--workspace', workspacePath);
    if (gameContext?.exeName)  args.push('--target',    gameContext.exeName);
    if (workspacePath)         args.push('--autorun');  // only safe to autorun when we have a workspace

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
        result.applied.push(
            workspacePath
                ? `Inicio.exe autorun (${binaries.build}) — workspace="${path.basename(workspacePath)}", target="${gameContext?.exeName || '?'}"`
                : `Inicio.exe launched (${binaries.build}) — interactive mode`
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
};
