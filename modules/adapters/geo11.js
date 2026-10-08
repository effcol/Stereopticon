'use strict';
/**
 * modules/adapters/geo11.js
 *
 * Geo-11 tool adapter. Patches d3dxdm.ini's `direct_mode` value (and any
 * pending modal overrides from the renderer) right before the game launches.
 *
 * Previously this lived in renderer.js:applyGeo11SettingsBeforeLaunch(). The
 * resolver-driven adapter pattern (modules/adapters/index.js) calls this
 * uniformly with other tool adapters during executePipeline().
 */

const path = require('path');
const fs   = require('fs');
const { applyAndSave } = require('../iniEditor');

// Maps our high-level output IDs → Geo-11's d3dxdm.ini `direct_mode` value.
// Anaglyph is special-cased downstream (Geo-11 outputs SBS, then a ReShade
// 3DtoElse shader converts to anaglyph; nothing to set in d3dxdm.ini).
const DIRECT_MODE_MAP = {
    'sbs':                     'sbs',
    'sbs_half':                'sbs',         // Geo-11 doesn't distinguish full vs half here
    'tab':                     'tab',
    'tab_half':                'tab',
    'interleaved':             'interlaced',
    'interleaved_row':         'interlaced',
    'interleaved_col':         'interlaced',
    'interleaved_column':      'interlaced',
    'interleaved_checkerboard': 'checkerboard',
    'katanga_vr':              'katanga_vr',  // direct VR output to HelixVision
};

// sr_weave is only supported by Geo-11 v0.6.60.23-beta and later. Detection
// is loose: if the fix's pinned version string contains '0.6.60.23' we allow it.
function srWeaveSupported(fixVersion) {
    if (!fixVersion) return false;
    if (typeof fixVersion !== 'string') return false;
    return fixVersion.includes('0.6.60.23') || /v0\.6\.\d{3,}/.test(fixVersion);
}

function resolveIniPath(fix, gamePath) {
    const iniFile = fix.ini_file || 'd3dxdm.ini';
    return path.join(gamePath, iniFile);
}

async function applyConfig(ctx) {
    const { fix, outputId, gameContext, userOverrides } = ctx;
    const result = { success: true, applied: [], errors: [], warnings: [] };

    if (!fix || fix.type !== 'geo11') {
        return result; // not for us
    }
    if (!gameContext?.gamePath) {
        result.warnings.push('Geo-11 adapter skipped — no gamePath in context');
        return result;
    }

    const iniPath = resolveIniPath(fix, gameContext.gamePath);
    if (!fs.existsSync(iniPath)) {
        result.warnings.push(`Geo-11 INI not found at ${iniPath} — fix may not be installed yet`);
        return result;
    }

    // Build the settings to apply:
    //   1. direct_mode derived from the output selection
    //   2. any user overrides from the renderer's Geo-11 modal (geoPending)
    const settings = {};

    if (outputId) {
        if (outputId.startsWith('anaglyph')) {
            // Anaglyph: Geo-11 stays on SBS, 3DtoElse converts at present
            settings.direct_mode = 'sbs';
        } else if (outputId === 'sr_weave') {
            if (srWeaveSupported(fix.geo11_version)) {
                settings.direct_mode = 'simulated_reality';
            } else {
                result.warnings.push(`sr_weave selected but Geo-11 ${fix.geo11_version || '(unpinned)'} does not support it — falling back to sbs`);
                settings.direct_mode = 'sbs';
            }
        } else {
            const dm = DIRECT_MODE_MAP[outputId];
            if (dm) {
                settings.direct_mode = dm;
            } else {
                result.warnings.push(`Output "${outputId}" has no Geo-11 direct_mode mapping`);
            }
        }
    }

    // Merge user overrides from the renderer-side Geo-11 modal
    const overrides = userOverrides?.geo11 || {};
    Object.assign(settings, overrides);

    if (Object.keys(settings).length === 0) {
        return result; // nothing to apply
    }

    try {
        applyAndSave(fix.id, iniPath, settings);
        result.applied.push(`d3dxdm.ini patched: ${Object.entries(settings).map(([k, v]) => `${k}=${v}`).join(', ')}`);
    } catch (e) {
        result.success = false;
        result.errors.push(`d3dxdm.ini patch failed: ${e.message}`);
    }

    return result;
}

module.exports = {
    id:   'geo11',
    name: 'Geo-11',
    applyConfig,
};
