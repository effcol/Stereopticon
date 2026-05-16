'use strict';
/**
 * modules/adapters/reshade.js
 *
 * ReShade pipeline-step adapter. When a fix's pipeline includes a ReShade
 * shader conversion (anaglyph-to-sbs, 3dtoelse, etc.), ensures ReShade is
 * installed in the game folder and writes a preset that loads the right
 * shaders for the selected output.
 *
 * Wraps modules/reshade.js's installReshade + writeReshadePreset.
 */

const path = require('path');
const fs   = require('fs');
const rs   = require('../reshade');

async function applyConfig(ctx) {
    const { fix, outputId, gameContext } = ctx;
    const result = { success: true, applied: [], errors: [], warnings: [] };

    if (!gameContext?.gamePath || !fs.existsSync(gameContext.gamePath)) {
        result.warnings.push('ReShade adapter skipped — no gamePath');
        return result;
    }

    // Detect or install ReShade in the game folder
    const status = rs.getReshadeStatus(gameContext.gamePath);
    if (!status.installed) {
        try {
            const api = rs.detectGraphicsApi(fix?.graphics_api, gameContext.gamePath);
            const r = await rs.installReshade(gameContext.gamePath, api);
            if (r?.success) result.applied.push(`ReShade installed (${api})`);
            else            result.warnings.push(`ReShade install: ${r?.message || 'unknown'}`);
        } catch (e) {
            result.warnings.push(`ReShade install threw: ${e.message}`);
        }
    } else {
        result.applied.push(`ReShade already present (${status.api || 'detected'})`);
    }

    // Build the shader list for the chosen pipeline (uses PIPELINE_SHADERS map)
    // Pipeline id is inferred from the fix's pipeline_overrides for this output, or from the resolver step name.
    const pipelineHint = (fix?.pipeline_overrides && fix.pipeline_overrides[outputId])
        || (ctx.pipeline?.steps?.find(s => s.toLowerCase().includes('reshade'))?.toLowerCase());
    if (pipelineHint) {
        try {
            const shaders = rs.getShadersForPipeline(pipelineHint);
            if (shaders && shaders.length) {
                rs.writeReshadePreset(gameContext.gamePath, shaders);
                result.applied.push(`ReShade preset: ${shaders.join(', ')}`);
            }
        } catch (e) {
            result.warnings.push(`ReShade preset write threw: ${e.message}`);
        }
    }

    return result;
}

module.exports = {
    id:   'reshade',
    name: 'ReShade',
    applyConfig,
};
