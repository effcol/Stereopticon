'use strict';
/**
 * modules/adapters/wiz3d-3dvision-dm.js
 *
 * Adapter for wiz3D's 3D Vision Direct Mode handler. Different binaries
 * from the wrappers — the games render their own stereo and submit to
 * 3D Vision DM; wiz3D intercepts and re-routes. Config lives in a separate
 * file (3DVision_Config.xml) with a different output naming convention
 * (FullSideBySide, HalfTopAndBottom, etc.).
 */

const path = require('path');
const fs   = require('fs');
const wiz3dConfig = require('../wiz3dConfig');

async function applyConfig(ctx) {
    const { fix, outputId, gameContext, userOverrides } = ctx;
    const result = { success: true, applied: [], errors: [], warnings: [] };

    if (!fix || fix.type !== 'wiz3d_3dvision_dm') return result;
    if (!gameContext?.gamePath) {
        result.warnings.push('wiz3d_3dvision_dm adapter skipped — no gamePath in context');
        return result;
    }

    const xmlPath = path.join(gameContext.gamePath, '3DVision_Config.xml');
    if (!fs.existsSync(xmlPath)) {
        result.warnings.push(`3DVision_Config.xml not found at ${xmlPath} — fix may not be installed yet`);
        return result;
    }

    const outputDll = wiz3dConfig.OUTPUT_DLL_DM[outputId];
    if (outputId && !outputDll) {
        result.warnings.push(`wiz3D 3D Vision DM doesn't support output "${outputId}" — leaving OutputMethodDll unchanged`);
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
    id:   'wiz3d_3dvision_dm',
    name: 'wiz3D 3D Vision Direct Mode',
    applyConfig,
};
