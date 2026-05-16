'use strict';
/**
 * modules/adapters/wiz3d-opengl.js
 *
 * Adapter for wiz3D's OpenGL Quad-Buffer Stereo handler. Uses the same
 * wiz3D_Config.xml format + output catalogue as the wrappers.
 */

const path = require('path');
const fs   = require('fs');
const wiz3dConfig = require('../wiz3dConfig');

async function applyConfig(ctx) {
    const { fix, outputId, gameContext, userOverrides } = ctx;
    const result = { success: true, applied: [], errors: [], warnings: [] };

    if (!fix || fix.type !== 'wiz3d_opengl') return result;
    if (!gameContext?.gamePath) {
        result.warnings.push('wiz3d_opengl adapter skipped — no gamePath in context');
        return result;
    }

    const xmlPath = path.join(gameContext.gamePath, 'wiz3D_Config.xml');
    if (!fs.existsSync(xmlPath)) {
        result.warnings.push(`wiz3D_Config.xml not found at ${xmlPath} — fix may not be installed yet`);
        return result;
    }

    const outputDll = wiz3dConfig.OUTPUT_DLL_WRAPPER[outputId];
    if (outputId && !outputDll) {
        result.warnings.push(`wiz3D OpenGL doesn't support output "${outputId}" — leaving OutputMethodDll unchanged`);
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
    id:   'wiz3d_opengl',
    name: 'wiz3D OpenGL',
    applyConfig,
};
