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

const BRIDGE_PROJECT_DIR = 'Vireio-Perception-OpenTrack-Bridge';

// Resolve where the OpenTrack-Bridge binaries live. Prefer the curated
// releases/ folder (LGPL-v3 distribution location), then fall back to local
// CMake build outputs for developer workflows.
function findProxyBinary(projectRoot, slot) {
    // `slot` is the system DLL we're masquerading as: 'd3d9' or 'dinput8'.
    // The Bridge ships in two ways:
    //   * Phase 3+ canonical: the v3-carve-out at engine/vireio/Perception_v3/
    //     built with VIREIO_HT_ONLY → outputs d3d9.dll only (no dinput8 yet).
    //   * Legacy from-scratch: engine/Vireio-Perception-OpenTrack-Bridge/ has
    //     the original scaffolding with both d3d9 + dinput8 slot variants.
    //     Kept as a fallback until the v3-carve-out gains the dinput8 slot.
    const filename = `${slot}.dll`;
    const candidates = [
        // v3 carve-out (Phase 3) — canonical going forward.
        path.join(projectRoot, 'engine', 'vireio', 'Perception_v3', 'Release-Bridge', 'Perception', 'bin', filename),
        path.join(projectRoot, 'engine', 'vireio', 'Perception_v3', 'Release-Bridge', filename),
        // From-scratch scaffolding (LEGACY — retires once the v3 carve-out
        // covers all slots). Currently the only source of the dinput8 variant.
        path.join(projectRoot, 'engine', BRIDGE_PROJECT_DIR, 'releases', slot, filename),
        path.join(projectRoot, 'engine', BRIDGE_PROJECT_DIR, 'build', 'Release', filename),
        path.join(projectRoot, 'engine', BRIDGE_PROJECT_DIR, 'build', 'Debug',   filename),
        path.join(projectRoot, 'engine', BRIDGE_PROJECT_DIR, 'build', filename),
    ];
    return candidates.find(fs.existsSync) || null;
}

// Decide which proxy slot is free in the game folder. d3d9 is preferred; we
// fall back to dinput8 when another stereo mod (wiz3D / Geo-11 / ReShade)
// has already claimed d3d9.dll. Returns { slot, collision: bool }.
function sameFile(a, b) {
    try {
        if (fs.statSync(a).size !== fs.statSync(b).size) return false;
        return fs.readFileSync(a).equals(fs.readFileSync(b));
    } catch { return false; }
}

function pickProxySlot(gamePath, projectRoot) {
    // A slot holding our own DLL from an earlier launch is ours to reuse.
    const free = slot => {
        const existing = path.join(gamePath, `${slot}.dll`);
        if (!fs.existsSync(existing)) return true;
        const ours = findProxyBinary(projectRoot, slot);
        return !!ours && sameFile(ours, existing);
    };
    if (free('d3d9'))    return { slot: 'd3d9',    collision: false };
    if (free('dinput8')) return { slot: 'dinput8', collision: true  };
    // Both slots occupied — caller must surface a warning.
    return { slot: null, collision: true };
}

// Resolve + install the Vireio-Perception-OpenTrack-Bridge DLL into the
// game folder. Auto-picks d3d9 or dinput8 slot based on what's already in
// the folder. For the dinput8 slot, also stages a copy of the real system
// dinput8.dll as `dinput8_orig.dll` so the forwarders resolve.
async function installVireioOpenTrackBridge(gameContext) {
    const r = { success: true, applied: [], errors: [], warnings: [] };
    if (!gameContext?.gamePath) {
        r.success = false;
        r.errors.push('vireio HT-only: no gamePath in context');
        return r;
    }
    const projectRoot = path.join(__dirname, '..', '..');
    const { slot, collision } = pickProxySlot(gameContext.gamePath, projectRoot);
    if (!slot) {
        r.success = false;
        r.errors.push(
            'Both d3d9.dll and dinput8.dll slots are occupied in the game folder. ' +
            'Manually choose a free proxy slot (winmm.dll / version.dll) and build that variant.'
        );
        return r;
    }
    if (collision) {
        r.warnings.push(`d3d9.dll already present (likely a stereo fix) — installing OpenTrack-Bridge via dinput8.dll slot instead.`);
    }

    const dll = findProxyBinary(projectRoot, slot);
    if (!dll) {
        r.warnings.push(
            `Vireio OpenTrack Bridge (${slot} variant) not built. Run ` +
            `\`cmake -S engine/${BRIDGE_PROJECT_DIR} -B engine/${BRIDGE_PROJECT_DIR}/build -A Win32 && ` +
            `cmake --build engine/${BRIDGE_PROJECT_DIR}/build --config Release\` first, ` +
            `or drop the prebuilt binary into engine/${BRIDGE_PROJECT_DIR}/releases/${slot}/. Skipping HT-only deploy.`
        );
        return r;
    }
    const targetDll = path.join(gameContext.gamePath, `${slot}.dll`);
    const targetIni = path.join(gameContext.gamePath, 'vireio-ht.ini');
    try {
        fs.copyFileSync(dll, targetDll);
        r.applied.push(`Vireio OpenTrack Bridge (${slot}) → ${targetDll}`);

        // dinput8 variant forwards its exports to dinput8_orig.dll — stage a
        // copy of the real system DLL into the game folder under that name.
        if (slot === 'dinput8') {
            const sysDll  = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'dinput8.dll');
            const origDll = path.join(gameContext.gamePath, 'dinput8_orig.dll');
            if (fs.existsSync(sysDll) && !fs.existsSync(origDll)) {
                fs.copyFileSync(sysDll, origDll);
                r.applied.push(`Staged real system dinput8.dll → ${origDll}`);
            } else if (!fs.existsSync(sysDll)) {
                r.warnings.push(`Could not find ${sysDll} to stage as dinput8_orig.dll — input forwarding may fail.`);
            }
        }

        const iniSrc = path.join(projectRoot, 'engine', BRIDGE_PROJECT_DIR, 'vireio-ht.ini.sample');
        if (fs.existsSync(iniSrc) && !fs.existsSync(targetIni)) {
            fs.copyFileSync(iniSrc, targetIni);
            r.applied.push(`Vireio HT default ini → ${targetIni}`);
        }
    } catch (e) {
        r.success = false;
        r.errors.push(`Failed to copy Vireio OpenTrack Bridge: ${e.message}`);
    }
    return r;
}

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

    // HT-only path doesn't need the main Vireio engine — it ships as a
    // standalone d3d9.dll proxy. Handle it first so we don't error on a
    // missing engine build for users who just want headtracking.
    if (isHtOnly) {
        const proxyRes = await installVireioOpenTrackBridge(gameContext);
        result.applied .push(...proxyRes.applied);
        result.warnings.push(...proxyRes.warnings);
        result.errors  .push(...proxyRes.errors);
        if (!proxyRes.success) result.success = false;
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

    // Resolve workspace .aqu path. For the stereo-fix path we use the
    // game-specific workspace declared in the fix; for HT-only we use a
    // dedicated headtrack-only workspace shipped with the engine.
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
    // Self-skips when neither stereo-vireio nor ht-only-vireio triggers fire,
    // so it's safe to invoke every launch. Lets HT-only mode run alongside a
    // Geo-11 / wiz3D / etc. stereo fix without needing to be in pipeline.steps.
    alwaysRun: true,
};
