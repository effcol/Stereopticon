'use strict';
/**
 * modules/vrto3dConfig.js
 *
 * Maps Stereopticon display/output/pipeline selections to VRto3D config settings.
 * Generates appropriate default_config.json or game-specific profile config.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// ── VRto3D Config Generator ────────────────────────────────────

/**
 * Build VRto3D config settings based on display profile and output format.
 * Returns object ready to merge into VRto3D config.json
 */
function getVRto3DConfigForDisplayOutput(display, outputFormat) {
    if (!display || !outputFormat) return {};
    
    const config = {
        display_index: display.display_index || 0,
        render_width: display.render_width || 1920,
        render_height: display.render_height || 1080,
        aspect_ratio: display.aspect_ratio || 1.77778,
        display_frequency: display.display_frequency || 60.0,
        display_latency: display.display_latency || 0.011,
    };
    
    // Output-specific settings
    switch (outputFormat) {
        case 'sbs':
            config.tab_enable = false;
            config.framepack_offset = 0;
            break;
        case 'tab':
        case 'tab_ou':
            config.tab_enable = true;
            config.framepack_offset = 0;
            break;
        case 'frame_packing':
        case 'framepacking_hdmi':
            config.tab_enable = true;
            config.framepack_offset = display.framepack_offset || 45;
            break;
        case 'sr_weave':
        case 'sr_displays':
            config.tab_enable = false;
            // SR displays often need specific pitch/yaw for head tracking
            config.pitch_enable = display.pitch_enable !== undefined ? display.pitch_enable : false;
            config.yaw_enable = display.yaw_enable !== undefined ? display.yaw_enable : false;
            config.use_open_track = display.use_open_track !== undefined ? display.use_open_track : false;
            break;
        case 'interlaced':
        case 'interlaced_row':
        case 'interlaced_col':
        case 'interlaced_checkerboard':
            // Interlaced typically uses TaB with ReShade shader
            config.tab_enable = true;
            config.framepack_offset = 0;
            break;
        case 'anaglyph':
        case 'anaglyph_red_cyan':
        case 'anaglyph_green_magenta':
        case 'anaglyph_amber_blue':
            // Anaglyph converted via ReShade, use base output mode
            config.tab_enable = false;
            break;
        case 'vr_native':
            // Native VR — let UEVR/VRto3D handle stereo directly
            config.tab_enable = false;
            break;
    }
    
    return config;
}

/**
 * Get default VRto3D config with optional display/output overrides.
 * Used when initializing or when user hasn't customized settings.
 */
function getDefaultVRto3DConfig(display, outputFormat) {
    // Start with base defaults
    const defaults = {
        display_index: 0,
        render_width: 1920,
        render_height: 1080,
        hmd_height: 1.0,
        hmd_x: 0.0,
        hmd_y: 0.0,
        hmd_yaw: 0.0,
        aspect_ratio: 1.77778,
        fov: 90.0,
        depth: 0.1,
        convergence: 1.0,
        async_enable: false,
        disable_hotkeys: false,
        tab_enable: false,
        framepack_offset: 0,
        reverse_enable: false,
        vd_fsbs_hack: false,
        dash_enable: false,
        auto_focus: true,
        display_latency: 0.011,
        display_frequency: 60.0,
        pitch_enable: false,
        yaw_enable: false,
        use_open_track: false,
        open_track_port: 4242,
        launch_script: "",
        pose_reset_key: "VK_NUMPAD7",
        ctrl_toggle_key: "VK_NUMPAD8",
        ctrl_toggle_type: "toggle",
        pitch_radius: 0.0,
        ctrl_deadzone: 0.05,
        ctrl_sensitivity: 1.0,
        user_settings: []
    };
    
    // If display provided, override with display settings
    if (display) {
        const displayOverrides = getVRto3DConfigForDisplayOutput(display, outputFormat);
        return { ...defaults, ...displayOverrides };
    }
    
    return defaults;
}

/**
 * Get VRto3D settings for AR Glasses (Xreal, Rokid, etc.)
 */
function getARGlassesConfig(display) {
    return {
        display_index: display.display_index || 1,  // Usually second display (glasses)
        render_width: display.render_width || 1920,
        render_height: display.render_height || 1080,
        aspect_ratio: 2.0,  // AR glasses often wider
        display_frequency: display.display_frequency || 90.0,
        tab_enable: false,
        auto_focus: true,
        pitch_enable: true,
        yaw_enable: true,
        use_open_track: !!display.head_tracking,
        open_track_port: 4242,
    };
}

/**
 * Get VRto3D settings for 3D TV/Projector
 */
function get3DTVConfig(display, outputFormat) {
    const config = {
        display_index: display.display_index || 0,
        render_width: display.render_width || 1920,
        render_height: display.render_height || 1080,
        display_frequency: display.display_frequency || 60.0,
    };
    
    if (outputFormat === 'framepacking_hdmi' || outputFormat === 'frame_packing') {
        config.tab_enable = true;
        config.framepack_offset = display.framepack_offset || 45;
    } else {
        config.tab_enable = outputFormat === 'tab' || outputFormat === 'tab_ou';
    }
    
    return config;
}

/**
 * Get VRto3D settings for SR Displays (Acer/Asus/Samsung spatial display)
 */
function getSRDisplayConfig(display) {
    return {
        display_index: display.display_index || 0,
        render_width: display.render_width || 1920,
        render_height: display.render_height || 1440,
        aspect_ratio: display.aspect_ratio || 1.33,
        display_frequency: display.display_frequency || 120.0,  // SR displays often 120Hz
        tab_enable: false,
        pitch_enable: !!display.head_tracking,
        yaw_enable: !!display.head_tracking,
        use_open_track: !!display.head_tracking,
        auto_focus: true,
    };
}

/**
 * Merge game-specific settings on top of display/output defaults
 * Used when a game has custom VRto3D profile hints
 */
function mergeGameSpecificSettings(baseConfig, gameProfile) {
    if (!gameProfile) return baseConfig;
    
    // Only override specific "+" fields that should be game-customizable
    const gameOverridable = [
        'fov', 'depth', 'convergence', 'pitch_enable', 'yaw_enable',
        'hmd_height', 'hmd_x', 'hmd_y', 'hmd_yaw', 'pitch_radius',
        'ctrl_sensitivity', 'ctrl_deadzone', 'user_settings'
    ];
    
    const merged = { ...baseConfig };
    for (const key of gameOverridable) {
        if (gameProfile[key] !== undefined) {
            merged[key] = gameProfile[key];
        }
    }
    
    return merged;
}

module.exports = {
    getVRto3DConfigForDisplayOutput,
    getDefaultVRto3DConfig,
    getARGlassesConfig,
    get3DTVConfig,
    getSRDisplayConfig,
    mergeGameSpecificSettings,
};
