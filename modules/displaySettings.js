'use strict';
/**
 * modules/displaySettings.js
 *
 * Reads and writes display-hardware-specific settings.
 * Currently supports:
 *   - Acer SpatialLabs (Focus Detection, Fullscreen Detection, Monitor Detection)
 *
 * Designed to be extended: add new DISPLAY_PROFILES entries for other hardware.
 *
 * Registry writes to HKLM require admin privileges. If the write fails with
 * ACCESS DENIED, we return { success: false, needsAdmin: true } so the renderer
 * can prompt the user to relaunch as administrator.
 */

const { execSync } = require('child_process');

// ── Registry helpers ─────────────────────────────────────────────

const HKLM = 'HKEY_LOCAL_MACHINE';

function regQuery(keyPath, valueName) {
    try {
        const out = execSync(
            `reg query "${keyPath}" /v "${valueName}"`,
            { encoding: 'utf8', timeout: 3000, stdio: ['pipe','pipe','pipe'] }
        );
        // Output looks like:
        //   HKEY_LOCAL_MACHINE\SOFTWARE\...
        //       ValueName    REG_DWORD    0x00000001
        const match = out.match(/REG_DWORD\s+(0x[\da-fA-F]+)/i)
                   || out.match(/REG_SZ\s+(.+)/i);
        if (!match) return null;
        const raw = match[1].trim();
        // Return numeric value for DWORD, string otherwise
        if (raw.startsWith('0x') || raw.startsWith('0X')) return parseInt(raw, 16);
        const n = Number(raw);
        return isNaN(n) ? raw : n;
    } catch {
        return null; // key or value not found
    }
}

function regWrite(keyPath, valueName, type, data) {
    try {
        const val = type === 'REG_DWORD' ? String(data) : data;
        execSync(
            `reg add "${keyPath}" /v "${valueName}" /t ${type} /d ${val} /f`,
            { encoding: 'utf8', timeout: 5000, stdio: ['pipe','pipe','pipe'] }
        );
        return { success: true };
    } catch (e) {
        const msg = (e.stderr || e.message || '').toString();
        if (msg.includes('Access is denied') || msg.includes('access denied')) {
            return { success: false, needsAdmin: true, message: 'Registry write requires administrator privileges. Relaunch Stereopticon as Administrator.' };
        }
        return { success: false, message: msg.slice(0, 200) };
    }
}

function regExists(keyPath) {
    try {
        execSync(`reg query "${keyPath}"`, { encoding: 'utf8', timeout: 2000, stdio: ['pipe','pipe','pipe'] });
        return true;
    } catch {
        return false;
    }
}

// ── Display profiles ─────────────────────────────────────────────
//
// Each profile describes:
//   id          — unique key used in IPC
//   label       — display name in UI
//   brand       — brand name for grouping
//   type        — display category ('glasses_free' | 'passive' | 'vr' | 'ar')
//   detect()    — returns true if this hardware is present
//   read()      — returns { [settingId]: currentValue }
//   settings    — array of setting descriptors for the UI to render
//   write(id,v) — writes a single setting, returns { success, needsAdmin?, message? }
//

const SPATIALABS_KEY = `${HKLM}\\SOFTWARE\\Acer\\SpatialLabs`;

const DISPLAY_PROFILES = {

    'acer_spatiallabs': {
        id:    'acer_spatiallabs',
        label: 'Acer SpatialLabs',
        brand: 'Acer',
        type:  'glasses_free',
        icon:  '🖥️',

        detect() {
            return regExists(SPATIALABS_KEY);
        },

        read() {
            return {
                focus_detection:      regQuery(SPATIALABS_KEY, 'Focus_Detection'),
                fullscreen_detection: regQuery(SPATIALABS_KEY, 'Fullscreen_Detection'),
                monitor_detection:    regQuery(SPATIALABS_KEY, 'Monitor_Detection'),
            };
        },

        settings: [
            {
                id:      'focus_detection',
                label:   'Focus Detection',
                tip:     'SpatialLabs eye-tracking focus mode. Disable if it causes stuttering or unwanted switching between 2D/3D.',
                type:    'toggle',
                regKey:  'Focus_Detection',
                onValue: 1,
                offValue: 0,
                regType: 'REG_DWORD',
            },
            {
                id:      'fullscreen_detection',
                label:   'Fullscreen Detection',
                tip:     'Auto-detects fullscreen apps and enables 3D mode. Disable if SpatialLabs keeps switching modes unexpectedly.',
                type:    'toggle',
                regKey:  'Fullscreen_Detection',
                onValue: 1,
                offValue: 0,
                regType: 'REG_DWORD',
            },
            {
                id:      'monitor_detection',
                label:   'Monitor Detection',
                tip:     'SpatialLabs monitor auto-detection. Usually safe to leave on.',
                type:    'toggle',
                regKey:  'Monitor_Detection',
                onValue: 1,
                offValue: 0,
                regType: 'REG_DWORD',
            },
        ],

        write(settingId, value) {
            const s = this.settings.find(x => x.id === settingId);
            if (!s) return { success: false, message: `Unknown setting: ${settingId}` };
            const regVal = value ? s.onValue : s.offValue;
            return regWrite(SPATIALABS_KEY, s.regKey, s.regType, regVal);
        },
    },

    // ── Future profiles go here ────────────────────────────────
    // 'samsung_odyssey3d': { ... },
    // 'lg_cinema3d':       { ... },
};

// ── Public API ──────────────────────────────────────────────────

/**
 * Returns the full list of display profiles with their current values
 * and a `detected` flag indicating whether the hardware is present.
 */
function getDisplaySettings() {
    const result = [];
    for (const [, profile] of Object.entries(DISPLAY_PROFILES)) {
        const detected = profile.detect();
        const values   = detected ? profile.read() : {};
        result.push({
            id:       profile.id,
            label:    profile.label,
            brand:    profile.brand,
            type:     profile.type,
            icon:     profile.icon,
            detected,
            values,
            settings: profile.settings,
        });
    }
    return result;
}

/**
 * Write a single setting for a given display profile.
 * Returns { success, needsAdmin?, message? }
 */
function writeDisplaySetting(profileId, settingId, value) {
    const profile = DISPLAY_PROFILES[profileId];
    if (!profile) return { success: false, message: `Unknown display profile: ${profileId}` };
    return profile.write(settingId, value);
}

module.exports = { getDisplaySettings, writeDisplaySetting };