'use strict';
/**
 * modules/adapters/opentrack.js
 *
 * OpenTrack hub orchestrator. Launches OpenTrack.exe with a Stereopticon-managed
 * profile that routes:
 *
 *   <input tracker module>  →  OpenTrack  →  FreeTrack 2.0 UDP (port 4242, default)
 *
 * The input tracker is selected per-fix-or-output via headtracking.input_mode:
 *
 *   'freetrack_passthrough'  receive existing FreeTrack UDP and re-emit (chaining).
 *                            Used when an SR-bridge / Vireio plugin / Loop mod is
 *                            already emitting FreeTrack and we just want OpenTrack's
 *                            filters + multi-output capability in the path.
 *   'tracker-xreal-one'      OpenTrack's built-in Xreal AR glasses module.
 *   'neuralnet'              Neural webcam tracking (no extra hardware).
 *   'pt'                     Point Tracker (IR LEDs / TrackHat).
 *   'aruco'                  ArUco fiducial marker tracking.
 *   'wii'                    Wii Remote.
 *   'hatire'                 Arduino / HAT-IR DIY trackers.
 *   'steamvr'                SteamVR headset.
 *   'headcam'                Loop's HeadCam iPhone tracking.
 *
 * Sibling adapter modules/adapters/sr-opentrack-bridge.js handles the SR-specific
 * input case (LeiaSR → UDP 4242 → this hub, configured as 'freetrack_passthrough').
 */

const path  = require('path');
const fs    = require('fs');
const os    = require('os');
const { spawn } = require('child_process');
const { writeOpenTrackProfile } = require('../opentrackProfile');

let activeHub = null;  // { pid, profilePath }

function findOpenTrackBinary() {
    const projectRoot = path.join(__dirname, '..', '..');
    const candidates = [
        // Stereopticon-managed install (downloaded at setup)
        path.join(projectRoot, 'resources', 'opentrack', 'opentrack.exe'),
        // Dev fallback — local lib copy
        path.join(projectRoot, 'lib', 'opentrack', 'opentrack.exe'),
        // System-wide installs (only used if Stereopticon download is missing)
        'C:\\Program Files\\opentrack\\opentrack.exe',
        'C:\\Program Files (x86)\\opentrack\\opentrack.exe',
    ];
    for (const p of candidates) if (fs.existsSync(p)) return p;
    return null;
}

function hubProcessAlive() {
    if (!activeHub?.pid) return false;
    try {
        process.kill(activeHub.pid, 0);
        return true;
    } catch {
        activeHub = null;
        return false;
    }
}

function profileDir() {
    // Stereopticon-managed profile directory. Lives under user's appdata so it
    // survives updates without colliding with user's existing OpenTrack profiles.
    return path.join(os.homedir(), 'AppData', 'Roaming', 'Stereopticon', 'opentrack-profiles');
}

async function applyConfig(ctx) {
    const { headtracking, display, userOverrides } = ctx;
    const result = { success: true, applied: [], errors: [], warnings: [] };

    if (!headtracking?.enabled) return result;

    // Already running? Reuse it — OpenTrack supports profile reload via its UI
    // but not via CLI, so for now we keep the existing instance.
    if (hubProcessAlive()) {
        result.applied.push(`OpenTrack hub already running (pid ${activeHub.pid})`);
        return result;
    }

    const exe = findOpenTrackBinary();
    if (!exe) {
        result.warnings.push(
            'OpenTrack not found. Run Stereopticon\'s first-run setup to download it, ' +
            'or install OpenTrack manually from https://github.com/opentrack/opentrack/releases.'
        );
        return result;  // not fatal — Vireio's own FreeTrackTracker plugin can still talk to games directly
    }

    // Generate the Stereopticon-managed profile from current selections.
    // Inputs:  headtracking.input_mode (defaults to 'freetrack_passthrough' for SR,
    //          'neuralnet' for normal 3D, or whatever the user picked).
    // Outputs: always FreeTrack 2.0 UDP for now (what every supported game/mod consumes).
    const isSR = display?.family === 'sr_display' || display?.family_id === 'sr_display';
    const inputMode = headtracking.input_mode || (isSR ? 'freetrack_passthrough' : 'neuralnet');

    // Port allocation for the chain:
    //   4243 — OpenTrack input (upstream FreeTrack emitters write here:
    //          SR-Bridge with --output-port 4243, Vireio FreeTrackTracker, Loop mods)
    //   4242 — OpenTrack output (FreeTrack 2.0 wire format — what games read)
    const profilePath = path.join(profileDir(), 'stereopticon.ini');
    try {
        writeOpenTrackProfile(profilePath, {
            inputMode,
            outputProtocol: 'freetrack',
            axes:           userOverrides?.opentrack?.axes || { x:1, y:1, z:1, yaw:1, pitch:1, roll:1 },
            srcUdpPort:     userOverrides?.opentrack?.src_udp_port || 4243,
            dstUdpPort:     userOverrides?.opentrack?.dst_udp_port || 4242,
        });
        result.applied.push(`OpenTrack profile written → ${profilePath}`);
    } catch (e) {
        result.warnings.push(`Could not write OpenTrack profile (${e.message}); launching with last-used profile.`);
    }

    const args = ['-p', profilePath];
    const silent = !(userOverrides?.opentrack?.show_window);

    try {
        const child = spawn(exe, args, {
            detached:    true,
            stdio:       'ignore',
            cwd:         path.dirname(exe),
            shell:       false,
            windowsHide: silent,
        });
        child.on('error', err => {
            console.error('[opentrack] hub spawn error:', err);
            activeHub = null;
        });
        child.on('exit', () => {
            if (activeHub?.pid === child.pid) activeHub = null;
        });
        child.unref();
        activeHub = { pid: child.pid, profilePath };
        result.applied.push(
            `OpenTrack hub launched ${silent ? '(silent)' : '(visible)'} ` +
            `pid=${child.pid} · input=${inputMode} · output=freetrack:4242`
        );
    } catch (e) {
        result.success = false;
        result.errors.push(`Failed to spawn OpenTrack: ${e.message}`);
        return result;
    }

    return result;
}

function stopHub() {
    if (!activeHub?.pid) return { success: true, message: 'no hub running' };
    try {
        process.kill(activeHub.pid);
        activeHub = null;
        return { success: true, message: 'hub stopped' };
    } catch (e) {
        return { success: false, message: e.message };
    }
}

module.exports = {
    id:   'opentrack',
    name: 'OpenTrack Hub',
    applyConfig,
    stopHub,
};
