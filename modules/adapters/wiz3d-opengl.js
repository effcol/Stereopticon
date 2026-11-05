'use strict';
/**
 * modules/adapters/wiz3d-opengl.js
 *
 * Adapter for wiz3D's OpenGL Quad-Buffer Stereo handler. Uses the same
 * wiz3D_Config.xml format + output catalogue as the wrappers.
 */

const wiz3dConfig = require('../wiz3dConfig');

async function applyConfig(ctx) {
    if (ctx?.fix?.type !== 'wiz3d_opengl') return { success: true, applied: [], errors: [], warnings: [] };
    return wiz3dConfig.applyLaunchConfig(ctx);
}

module.exports = {
    id:   'wiz3d_opengl',
    name: 'wiz3D OpenGL',
    applyConfig,
};
