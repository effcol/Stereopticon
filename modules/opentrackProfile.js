'use strict';
/**
 * modules/opentrackProfile.js
 *
 * Writes Stereopticon-managed OpenTrack profile .ini files.
 *
 * OpenTrack profile format is QSettings-style INI sections. A full profile
 * holds tracker / protocol / filter / mapping module IDs plus their per-module
 * sub-settings. We only set the load-order keys (which modules to instantiate)
 * and a minimal axis mapping table — modules themselves load their own
 * sub-config from sibling files (opentrack stores those in %APPDATA%/opentrack/).
 *
 * The CLI flag `opentrack.exe -p <profile.ini>` makes the hub load this profile
 * at startup. Per-module config lives in OpenTrack's own appdata location and
 * persists across runs — Stereopticon only owns the *selection* of modules and
 * the axis-mapping table; we don't try to micro-manage tracker internals.
 *
 * Module ID reference (OpenTrack 2.4+):
 *   trackers:   neuralnet, pt, aruco, wii, hatire, freetrack-source, udp,
 *               steamvr, tobii-eyex, headcam, tracker-xreal-one
 *   protocols:  freetrack, freetrack-2.0, fsuipc, simconnect, mouse, vjoystick,
 *               wine, ets2, fsx-simconnect, osc, libevdev
 */

const fs   = require('fs');
const path = require('path');

// Input mode → OpenTrack tracker module ID.
// 'freetrack_passthrough' is logical — it maps to OpenTrack's `udp` tracker
// listening on an INTERMEDIATE port (default 4243), so upstream emitters like
// SR-Bridge / Vireio's FreeTrackTracker plugin / Loop mods can chain through
// OpenTrack without colliding with OpenTrack's own output on UDP 4242.
// (OpenTrack's `freetrack-source` module reads FreeTrack 1.x shared memory,
// not UDP, so it's only usable when the upstream emitter writes shared mem.)
const INPUT_MODE_TO_MODULE = {
    freetrack_passthrough: 'udp',
    freetrack_shmem:       'freetrack-source',
    udp:                   'udp',
    neuralnet:             'neuralnet',
    pt:                    'pt',
    aruco:                 'aruco',
    wii:                   'wii',
    hatire:                'hatire',
    steamvr:               'steamvr',
    headcam:               'headcam',
    'tracker-xreal-one':   'tracker-xreal-one',
};

const OUTPUT_PROTOCOL_TO_MODULE = {
    freetrack:    'freetrack-2.0',
    freetrack_20: 'freetrack-2.0',
    mouse:        'mouse',
    vjoystick:    'vjoystick',
    udp:          'udp',
    osc:          'osc',
};

/**
 * @param {string} outPath  absolute path of the .ini to write
 * @param {object} cfg
 * @param {string} cfg.inputMode         e.g. 'neuralnet'
 * @param {string} cfg.outputProtocol    e.g. 'freetrack'
 * @param {object} [cfg.axes]            { x, y, z, yaw, pitch, roll } each 0|1, 1=enabled
 * @param {number} [cfg.srcUdpPort]      port the freetrack-source tracker listens on
 * @param {number} [cfg.dstUdpPort]      port the freetrack-2.0 protocol sends to
 */
function writeOpenTrackProfile(outPath, cfg) {
    const dir = path.dirname(outPath);
    fs.mkdirSync(dir, { recursive: true });

    const trackerMod  = INPUT_MODE_TO_MODULE[cfg.inputMode]      || cfg.inputMode;
    const protocolMod = OUTPUT_PROTOCOL_TO_MODULE[cfg.outputProtocol] || cfg.outputProtocol;
    const axes        = cfg.axes || { x:1, y:1, z:1, yaw:1, pitch:1, roll:1 };
    const srcPort     = cfg.srcUdpPort || 4242;
    const dstPort     = cfg.dstUdpPort || 4242;

    // OpenTrack's main load-order section. The `dylib-*` keys name which module
    // libraries to load; OpenTrack maps these to .dll names under modules/.
    const lines = [
        '[modules]',
        `dylib-Tracker=opentrack-tracker-${trackerMod}`,
        `dylib-Protocol=opentrack-proto-${protocolMod}`,
        'dylib-Filter=opentrack-filter-accela',  // sensible default — modest smoothing
        '',
        '[mapping]',
        `tx=${axes.x ?? 1}`,
        `ty=${axes.y ?? 1}`,
        `tz=${axes.z ?? 1}`,
        `rx=${axes.pitch ?? 1}`,
        `ry=${axes.yaw   ?? 1}`,
        `rz=${axes.roll  ?? 1}`,
        '',
    ];

    // Per-module config for the UDP tracker (used when chaining a FreeTrack
    // emitter through OpenTrack). Listens on the intermediate src port.
    if (trackerMod === 'udp') {
        lines.push('[udp]');
        lines.push(`port=${srcPort}`);
        lines.push('');
    }

    // Per-module config for the freetrack-2.0 protocol — what games consume.
    if (protocolMod === 'freetrack-2.0') {
        lines.push('[freetrack-2.0]');
        lines.push(`port=${dstPort}`);
        lines.push('');
    }

    fs.writeFileSync(outPath, lines.join('\r\n'), 'utf8');
}

module.exports = {
    writeOpenTrackProfile,
    INPUT_MODE_TO_MODULE,
    OUTPUT_PROTOCOL_TO_MODULE,
};
