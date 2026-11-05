'use strict';
/**
 * modules/adapters/wiz3d-hd3d.js
 *
 * Adapter for wiz3D's AMD HD3D output handler. Same architectural pattern
 * as 3D Vision Direct Mode — game renders its own stereo and submits to
 * HD3D, wiz3D intercepts. Separate config file (HD3D_Config.xml) shares
 * the FullSideBySide / HalfTopAndBottom / etc. output naming with DM.
 */

const wiz3dConfig = require('../wiz3dConfig');

async function applyConfig(ctx) {
    if (ctx?.fix?.type !== 'wiz3d_hd3d') return { success: true, applied: [], errors: [], warnings: [] };
    return wiz3dConfig.applyLaunchConfig(ctx);
}

module.exports = {
    id:   'wiz3d_hd3d',
    name: 'wiz3D HD3D',
    applyConfig,
};
