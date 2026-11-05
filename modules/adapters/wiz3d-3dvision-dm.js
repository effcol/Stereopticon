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

const wiz3dConfig = require('../wiz3dConfig');

async function applyConfig(ctx) {
    if (ctx?.fix?.type !== 'wiz3d_3dvision_dm') return { success: true, applied: [], errors: [], warnings: [] };
    return wiz3dConfig.applyLaunchConfig(ctx);
}

module.exports = {
    id:   'wiz3d_3dvision_dm',
    name: 'wiz3D 3D Vision Direct Mode',
    applyConfig,
};
