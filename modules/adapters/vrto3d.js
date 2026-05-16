'use strict';
/**
 * modules/adapters/vrto3d.js
 *
 * VRto3D tool adapter. Writes Steam/config/vrto3d/default_config.json and the
 * per-game *_config.json based on the resolved (display + output + headtracking)
 * selection. Wraps profileManager's applyVRto3DConfig / applyVRto3DGameProfile /
 * enableVRto3DOpenTrack / setVRto3DLaunchScript helpers.
 *
 * Acts as both:
 *   - The primary tool for fix.type === 'vrto3d' (paid VR-to-flat-3D path)
 *   - The pipeline VR-driver for UEVR / REFramework fixes that target an SR or
 *     flat 3D display (display.vr_drivers.vrto3d.supported === true)
 */

const pm = require('../profileManager');

// Maps our high-level output IDs → VRto3D's `tab_enable` boolean and other knobs.
const VRTO3D_OUTPUT_MAP = {
    'sbs':                      { tab_enable: false },
    'sbs_half':                 { tab_enable: false },
    'tab':                      { tab_enable: true  },
    'tab_half':                 { tab_enable: true  },
    'interleaved':              { tab_enable: true  },
    'interleaved_row':          { tab_enable: true  },
    'interleaved_col':          { tab_enable: false },
    'interleaved_checkerboard': { tab_enable: false },
    'frame_packing':            { tab_enable: false, framepack_enable: true },
    'frame_sequential':         { tab_enable: false },
    'sr_weave':                 { tab_enable: false },
};

async function applyConfig(ctx) {
    const { fix, display, pipeline, outputId, gameContext, headtracking, userOverrides } = ctx;
    const result = { success: true, applied: [], errors: [], warnings: [] };

    // Decide whether this adapter is in scope:
    //   - Primary tool for a VRto3D-typed fix
    //   - VR driver chosen by the resolver for a UEVR/REFramework-style fix
    const isPrimary       = fix?.type === 'vrto3d';
    const isResolvedDriver = pipeline?.vrDriver === 'vrto3d';
    if (!isPrimary && !isResolvedDriver) {
        return result;
    }

    // 1. Display-level base config (from display.vr_drivers.vrto3d.config or pipeline.vrDriverConfig)
    const displayConfig = { ...(pipeline?.vrDriverConfig || {}) };

    // 2. Apply output-mode toggle on top
    if (outputId) {
        const outMap = VRTO3D_OUTPUT_MAP[outputId];
        if (outMap) Object.assign(displayConfig, outMap);
        else        result.warnings.push(`Output "${outputId}" has no VRto3D mapping`);
    }

    // 3. User overrides from the renderer's VRto3D modal (if any)
    const userVRto3D     = userOverrides?.vrto3d      || {};
    const userVRto3DGame = userOverrides?.vrto3d_game || {};

    try {
        const r = pm.applyVRto3DConfig(displayConfig, userVRto3D);
        if (r.success) result.applied.push(`default_config.json → ${r.path}`);
        else           { result.success = false; result.errors.push(r.error || 'applyVRto3DConfig failed'); }
    } catch (e) {
        result.success = false;
        result.errors.push(`applyVRto3DConfig threw: ${e.message}`);
    }

    // 4. Per-game profile (only if we have an exe to key off)
    const exeName = gameContext?.exeName || fix?.exe_name;
    const hasGameProfile = fix?.vrto3d_profile || Object.keys(userVRto3DGame).length > 0;
    if (exeName && hasGameProfile) {
        try {
            const r = pm.applyVRto3DGameProfile(exeName, {
                ...(fix?.vrto3d_profile || {}),
                ...userVRto3DGame,
            });
            if (r.success) result.applied.push(`${exeName.replace(/\.exe$/i, '')}_config.json → ${r.path}`);
            else           { result.success = false; result.errors.push(r.error || 'applyVRto3DGameProfile failed'); }
        } catch (e) {
            result.success = false;
            result.errors.push(`applyVRto3DGameProfile threw: ${e.message}`);
        }
    }

    // 5. Headtracking pass-through via OpenTrack (when display + user agree)
    const displayWantsOT = display?.headtracking?.methods?.includes('opentrack');
    const userWantsHT    = headtracking?.enabled && (headtracking?.method === 'opentrack' || !headtracking?.method);
    if (displayWantsOT && userWantsHT) {
        const port = headtracking?.port || display?.headtracking?.open_track_port || 4242;
        try {
            const r = pm.enableVRto3DOpenTrack(port);
            if (r.success) result.applied.push(`OpenTrack enabled in default_config.json (port ${port})`);
            else           result.warnings.push(`OpenTrack enable failed: ${r.error || 'unknown'}`);
        } catch (e) {
            result.warnings.push(`OpenTrack enable threw: ${e.message}`);
        }
    }

    // 6. Optional launch_script (e.g. VertoXR for AR glasses) — passed via userOverrides
    if (userOverrides?.vrto3d_launch_script) {
        try {
            pm.setVRto3DLaunchScript(userOverrides.vrto3d_launch_script);
            result.applied.push(`launch_script: ${userOverrides.vrto3d_launch_script}`);
        } catch (e) {
            result.warnings.push(`launch_script set failed: ${e.message}`);
        }
    }

    return result;
}

module.exports = {
    id:   'vrto3d',
    name: 'VRto3D',
    applyConfig,
};
