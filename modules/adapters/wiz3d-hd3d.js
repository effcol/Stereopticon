'use strict';
/**
 * modules/adapters/wiz3d-hd3d.js
 *
 * Adapter for wiz3D's AMD HD3D output handler. Same architectural pattern
 * as 3D Vision Direct Mode — game renders its own stereo and submits to
 * HD3D, wiz3D intercepts. Separate config file (HD3D_Config.xml) shares
 * the FullSideBySide / HalfTopAndBottom / etc. output naming with DM.
 */

const path = require('path');
const fs   = require('fs');
const wiz3dConfig = require('../wiz3dConfig');

async function applyConfig(ctx) {
    const { fix, outputId, gameContext, userOverrides } = ctx;
    const result = { success: true, applied: [], errors: [], warnings: [] };

    if (!fix || fix.type !== 'wiz3d_hd3d') return result;
    if (!gameContext?.gamePath) {
        result.warnings.push('wiz3d_hd3d adapter skipped — no gamePath in context');
        return result;
    }

    const xmlPath = path.join(gameContext.gamePath, 'HD3D_Config.xml');
    if (!fs.existsSync(xmlPath)) {
        result.warnings.push(`HD3D_Config.xml not found at ${xmlPath} — fix may not be installed yet`);
        return result;
    }

    const outputDll = wiz3dConfig.OUTPUT_DLL_DM[outputId];
    if (outputId && !outputDll) {
        result.warnings.push(`wiz3D HD3D doesn't support output "${outputId}" — leaving OutputMethodDll unchanged`);
    }

    const patches = wiz3dConfig.buildPatches({
        outputDll,
        userOverrides: userOverrides?.wiz3d || {},
    });
    const r = wiz3dConfig.applyPatches(xmlPath, patches);
    if (r.success === false) result.success = false;
    result.applied .push(...r.applied);
    result.errors  .push(...r.errors);
    result.warnings.push(...r.warnings);
    return result;
}

module.exports = {
    id:   'wiz3d_hd3d',
    name: 'wiz3D HD3D',
    applyConfig,
};
