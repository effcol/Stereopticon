'use strict';
/**
 * modules/adapters/sr-opentrack-bridge.js
 *
 * SR-OpenTrack-Bridge spawner. Sources head pose from the LeiaSR runtime
 * and feeds it into the running OpenTrack hub via UDP 127.0.0.1:4242
 * (FreeTrack 2.0 wire format). Runs only for displays in the SR family
 * (Acer SpatialLabs / Samsung Odyssey 3D / Asus Spatial Vision / Dimenco).
 *
 * Pairs with modules/adapters/opentrack.js — that adapter orchestrates the
 * OpenTrack hub itself, this one is the SR-specific *input* feeding it.
 *
 * Silent-mode by default: spawned with windowsHide so no console popup. The
 * user can toggle visibility in headtracking settings if they want hotkey
 * access (Ctrl+X calibrate, Ctrl+L lock).
 */

const path  = require('path');
const fs    = require('fs');
const { spawn } = require('child_process');

let activeBridge = null;  // { pid, exe }

function findBridgeBinary() {
    const projectRoot = path.join(__dirname, '..', '..');
    const candidates = [
        path.join(projectRoot, 'engine', 'sr-opentrack-bridge', 'build', 'Release', 'Simulated_Reality_OpenTrack_Bridge.exe'),
        path.join(projectRoot, 'engine', 'sr-opentrack-bridge', 'build', 'Debug',   'Simulated_Reality_OpenTrack_Bridge.exe'),
    ];
    for (const p of candidates) if (fs.existsSync(p)) return p;
    return null;
}

function leiaSRPlatformLooksInstalled() {
    const candidates = [
        'C:\\Program Files\\LeiaSR\\Platform\\bin',
        'C:\\Program Files\\Leia\\Platform\\bin',
        'C:\\Program Files (x86)\\LeiaSR\\Platform\\bin',
    ];
    return candidates.some(p => { try { return fs.existsSync(p); } catch { return false; } });
}

function bridgeProcessAlive() {
    if (!activeBridge?.pid) return false;
    try {
        process.kill(activeBridge.pid, 0);
        return true;
    } catch {
        activeBridge = null;
        return false;
    }
}

async function applyConfig(ctx) {
    const { display, headtracking, userOverrides } = ctx;
    const result = { success: true, applied: [], errors: [], warnings: [] };

    if (!headtracking?.enabled) return result;

    // Only acts when the resolved display is SR-family. Non-SR displays rely on
    // OpenTrack's own tracker modules (webcam, xreal, etc.) and skip this entirely.
    const isSR = display?.family === 'sr_display' || display?.family_id === 'sr_display';
    if (!isSR) return result;

    if (bridgeProcessAlive()) {
        result.applied.push(`SR-OpenTrack-Bridge already running (pid ${activeBridge.pid})`);
        return result;
    }

    const bridge = findBridgeBinary();
    if (!bridge) {
        result.warnings.push(
            'SR-OpenTrack-Bridge not built. Build engine/sr-opentrack-bridge/ first.'
        );
        return result;
    }

    if (!leiaSRPlatformLooksInstalled()) {
        result.warnings.push(
            'LeiaSR Platform not detected at typical install paths. Bridge will start ' +
            'but cannot stream pose until LeiaSR Platform is installed.'
        );
    }

    // Silent by default — userOverrides.sr_bridge.show_window opts back into
    // visible mode for users who want the hotkey calibration UI.
    const showWindow = !!(userOverrides?.sr_bridge?.show_window);

    // Port: when headtracking method is 'opentrack', we chain through the hub
    // (bridge → 4243 → OpenTrack → 4242 → game). Otherwise emit directly to 4242
    // for standalone use where OpenTrack isn't in the chain.
    const chainThroughHub = ctx.headtracking?.method === 'opentrack';
    const outputPort = userOverrides?.sr_bridge?.output_port
                    || (chainThroughHub ? 4243 : 4242);
    const args = ['--output-port', String(outputPort)];

    try {
        const child = spawn(bridge, args, {
            detached:    true,
            stdio:       'ignore',
            cwd:         path.dirname(bridge),
            shell:       false,
            windowsHide: !showWindow,
        });
        child.on('error', err => {
            console.error('[sr-opentrack-bridge] spawn error:', err);
            activeBridge = null;
        });
        child.on('exit', () => {
            if (activeBridge?.pid === child.pid) activeBridge = null;
        });
        child.unref();
        activeBridge = { pid: child.pid, exe: bridge };
        result.applied.push(
            `SR-OpenTrack-Bridge launched ${showWindow ? '(visible)' : '(silent)'} ` +
            `pid=${child.pid} → UDP 127.0.0.1:${outputPort}` +
            (chainThroughHub ? ' (chained via OpenTrack hub)' : '')
        );
    } catch (e) {
        result.success = false;
        result.errors.push(`Failed to spawn SR-OpenTrack-Bridge: ${e.message}`);
        return result;
    }

    return result;
}

function stopBridge() {
    if (!activeBridge?.pid) return { success: true, message: 'no bridge running' };
    try {
        process.kill(activeBridge.pid);
        activeBridge = null;
        return { success: true, message: 'bridge stopped' };
    } catch (e) {
        return { success: false, message: e.message };
    }
}

module.exports = {
    id:   'sr_opentrack_bridge',
    name: 'SR → OpenTrack Bridge',
    applyConfig,
    stopBridge,
    aliases:   ['leia_track', 'sr_bridge'],
    alwaysRun: true,  // self-skips when display isn't SR; lets the registry invoke
                      // it after the OpenTrack hub adapter (which is dispatched in
                      // step 4 — headtracking — when method='opentrack')
};
