'use strict';
/**
 * modules/adapters/wiz3d-wrapper.js
 *
 * Adapter for wiz3D's DX7/8/9/10-11/12/Vulkan wrappers. After installWiz3D
 * (in modules/installer.js) has copied the variant-specific files into the
 * game folder, this adapter patches the resulting wiz3D_Config.xml with the
 * user's output selection + Preset[0] tuning.
 */

const wiz3dConfig = require('../wiz3dConfig');

async function applyConfig(ctx) {
    if (ctx?.fix?.type !== 'wiz3d_wrapper') return { success: true, applied: [], errors: [], warnings: [] };
    return wiz3dConfig.applyLaunchConfig(ctx);
}

module.exports = {
    id:   'wiz3d_wrapper',
    name: 'wiz3D Wrapper',
    applyConfig,
};
