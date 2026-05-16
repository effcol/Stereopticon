'use strict';
/**
 * modules/adapters/uevr.js
 *
 * UEVR tool adapter. When a fix.type === 'uevr' is selected, writes both the
 * per-game UEVR profile (config.txt + auto-config) so UEVR picks it up on
 * injection.
 *
 * Wraps profileManager.applyUEVRProfile (the static profile JSON / config.txt
 * write) and uevrAutoConfig (the Stereopticon-side auto-tuned config the Lua
 * plugin reads after injection).
 */

const pm  = require('../profileManager');
const uac = require('../uevrAutoConfig');

async function applyConfig(ctx) {
    const { fix, gameContext, userOverrides } = ctx;
    const result = { success: true, applied: [], errors: [], warnings: [] };

    if (!fix || !['uevr', 'ue3d', 'reframework'].includes(fix.type)) {
        return result;
    }

    // 1. Static UEVR profile (config.txt) if the fix declares it
    if (fix.uevr_profile && fix.uevr_game_name) {
        try {
            const r = pm.applyUEVRProfile(fix.uevr_game_name, fix.uevr_profile);
            if (r.success) result.applied.push(`UEVR profile → ${r.path}`);
            else           { result.success = false; result.errors.push(r.error || 'applyUEVRProfile failed'); }
        } catch (e) {
            result.success = false;
            result.errors.push(`applyUEVRProfile threw: ${e.message}`);
        }
    }

    // 2. Stereopticon auto-config (read by the Lua plugin post-injection)
    const gameName = fix.uevr_game_name || gameContext?.id;
    const autoCfg  = userOverrides?.uevr_auto || fix.uevr_auto_config;
    if (gameName && autoCfg) {
        try {
            const p = await uac.writeUEVRAutoConfig(gameName, autoCfg);
            result.applied.push(`UEVR auto-config → ${p}`);
        } catch (e) {
            result.warnings.push(`UEVR auto-config write failed: ${e.message}`);
        }
    }

    return result;
}

module.exports = {
    id:   'uevr',
    name: 'UEVR',
    applyConfig,
};
