'use strict';
/**
 * modules/adapters/3dgamebridge.js
 *
 * 3DGameBridge pipeline-step adapter. 3DGameBridge is a ReShade addon that
 * converts SBS/TAB output into SR Weave for Simulated Reality displays.
 *
 * Runs ALWAYS (alwaysRun: true) — looks at the resolved pipeline.steps:
 *   - If 3DGameBridge is chained, ENABLES the addon in the game's ReShade.ini.
 *     Also ensures ReShade is applied to SteamVR's vrserver.exe so SR-side
 *     compositor effects work.
 *   - Otherwise, DISABLES the addon so non-SR outputs don't accidentally weave.
 *
 * Mirrors the renderer.js inline launch-flow block + the IPC handlers
 * (reshade:toggle3DGameBridge, reshade:ensureVRServer) — those still exist
 * for direct invocation, but the launch flow now goes through here.
 */

const fs    = require('fs');
const path  = require('path');
const { spawn } = require('child_process');

const ADDON_FILE_64 = 'srReshade_v2.1.0.addon64';
const ADDON_FILE_32 = 'srReshade_v2.1.0.addon32';

function normalizeStepId(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function setAddonState(iniPath, enabled) {
    if (!fs.existsSync(iniPath)) {
        return { success: false, error: `ReShade.ini not found at ${iniPath}`, action: 'none' };
    }
    let content = fs.readFileSync(iniPath, 'utf8');
    const before = content;

    if (enabled) {
        // Un-comment + set = true for any version of srReshade_v*.addon64/32
        content = content.replace(
            /^[\s;]*srReshade_v[\d.]+\.addon64\s*=\s*(true|false|)\s*$/mi,
            `${ADDON_FILE_64} = true`
        );
        content = content.replace(
            /^[\s;]*srReshade_v[\d.]+\.addon32\s*=\s*(true|false|)\s*$/mi,
            `${ADDON_FILE_32} = true`
        );
        // If no line at all yet, add under [ADDON]
        if (!/srReshade_v[\d.]+\.addon64/i.test(content)) {
            if (/\[ADDON\]/i.test(content)) {
                content = content.replace(/\[ADDON\]/i, `[ADDON]\r\n${ADDON_FILE_64} = true`);
            } else {
                content += `\r\n[ADDON]\r\n${ADDON_FILE_64} = true\r\n`;
            }
        }
    } else {
        // Comment out + set = false on any existing line
        content = content.replace(
            /^[\s;]*(srReshade_v[\d.]+\.addon(?:64|32))\s*=\s*true\s*$/gmi,
            '; $1 = false'
        );
    }

    if (content === before) {
        return { success: true, action: 'no-change' };
    }
    fs.writeFileSync(iniPath, content);
    return { success: true, action: enabled ? 'enabled' : 'disabled' };
}

// Best-effort: copy ReShade64.dll → SteamVR/bin/win64/dxgi.dll so
// 3DGameBridge sees vrserver's output. Only invoked when 3DGameBridge is
// being enabled and SteamVR is on disk.
function ensureReShadeOnVRServer() {
    try {
        const { findSteamVRDriversDir } = require('../installer');
        const driversDir = findSteamVRDriversDir();
        if (!driversDir) return { success: false, reason: 'SteamVR not found' };

        const vrServerDir = path.join(path.dirname(driversDir), 'bin', 'win64');
        if (!fs.existsSync(path.join(vrServerDir, 'vrserver.exe'))) {
            return { success: false, reason: 'vrserver.exe not found' };
        }
        const target     = path.join(vrServerDir, 'dxgi.dll');
        if (fs.existsSync(target))    return { success: true, action: 'already-present' };

        const bundleRoot = path.join(__dirname, '..', '..', 'resources', 'reshade');
        const source     = path.join(bundleRoot, 'ReShade64.dll');
        if (!fs.existsSync(source))   return { success: false, reason: 'bundled ReShade64.dll not found' };

        fs.copyFileSync(source, target);
        return { success: true, action: 'installed' };
    } catch (e) {
        return { success: false, reason: e.message };
    }
}

async function applyConfig(ctx) {
    const { gameContext, pipeline } = ctx;
    const result = { success: true, applied: [], errors: [], warnings: [] };

    if (!gameContext?.gamePath) {
        return result; // can't act without a game folder
    }

    const isChained = (pipeline?.steps || []).some(s => normalizeStepId(s) === '3dgamebridge');
    const iniPath = path.join(gameContext.gamePath, 'ReShade.ini');
    if (!fs.existsSync(iniPath)) {
        // No ReShade installed — nothing to do (a higher-level pipeline step
        // would install ReShade if needed before us).
        return result;
    }

    try {
        const r = setAddonState(iniPath, isChained);
        if (r.success && r.action !== 'no-change') {
            result.applied.push(`srReshade addon ${r.action} in ${iniPath}`);
        } else if (!r.success) {
            result.warnings.push(`srReshade addon toggle: ${r.error}`);
        }
    } catch (e) {
        result.warnings.push(`srReshade addon toggle threw: ${e.message}`);
    }

    // Only ensure ReShade for VRServer when actively chaining 3DGameBridge
    if (isChained) {
        try {
            const v = ensureReShadeOnVRServer();
            if (v.success && v.action === 'installed') {
                result.applied.push('ReShade installed on SteamVR vrserver.exe (for SR side-channel)');
            }
        } catch (e) {
            result.warnings.push(`vrserver ReShade install threw: ${e.message}`);
        }
    }

    return result;
}

module.exports = {
    id:        '3dgamebridge',
    name:      '3DGameBridge',
    alwaysRun: true,
    applyConfig,
};
