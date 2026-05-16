'use strict';
/**
 * modules/adapters/wiz3d-wrapper.js
 *
 * Adapter for wiz3D's DX7/8/9/10-11/12/Vulkan wrappers. After installWiz3D
 * (in modules/installer.js) has copied the variant-specific files into the
 * game folder, this adapter patches the resulting wiz3D_Config.xml with the
 * user's output selection + Preset[0] tuning.
 */

const path = require('path');
const fs   = require('fs');
const wiz3dConfig = require('../wiz3dConfig');

async function applyConfig(ctx) {
    const { fix, outputId, gameContext, userOverrides } = ctx;
    const result = { success: true, applied: [], errors: [], warnings: [] };

    if (!fix || fix.type !== 'wiz3d_wrapper') return result;
    if (!gameContext?.gamePath) {
        result.warnings.push('wiz3d_wrapper adapter skipped — no gamePath in context');
        return result;
    }

    const xmlPath = path.join(gameContext.gamePath, 'wiz3D_Config.xml');
    if (!fs.existsSync(xmlPath)) {
        result.warnings.push(`wiz3D_Config.xml not found at ${xmlPath} — fix may not be installed yet`);
        return result;
    }

    const outputDll = wiz3dConfig.OUTPUT_DLL_WRAPPER[outputId];
    if (outputId && !outputDll) {
        result.warnings.push(`wiz3D wrapper doesn't support output "${outputId}" — leaving OutputMethodDll unchanged`);
    }

    const patches = wiz3dConfig.buildPatches({
        outputDll,
        userOverrides: userOverrides?.wiz3d || {},
    });
    const r = wiz3dConfig.applyPatches(xmlPath, patches);
    return mergeResult(result, r);
}

function mergeResult(into, from) {
    if (from.success === false) into.success = false;
    into.applied .push(...from.applied);
    into.errors  .push(...from.errors);
    into.warnings.push(...from.warnings);
    return into;
}

module.exports = {
    id:   'wiz3d_wrapper',
    name: 'wiz3D Wrapper',
    applyConfig,
};
