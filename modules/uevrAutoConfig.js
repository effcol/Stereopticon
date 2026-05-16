/**
 * modules/uevrAutoConfig.js
 * 
 * Handles writing UEVR auto-config files before game launch.
 * These files are picked up by the stereopticon_autoconfig.lua plugin 
 * running inside UEVR after injection.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Get APPDATA path (same as UEVR uses)
 */
function getAppDataPath() {
    return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
}

/**
 * Get the config directory for a specific game in UEVR
 */
function getUEVRGameConfigDir(gameName) {
    const appdata = getAppDataPath();
    return path.join(appdata, 'UnrealVRMod', gameName);
}

/**
 * Write UEVR auto-config for a game
 * 
 * @param {string} gameName - The game name (used for folder)
 * @param {object} config - Config object with settings
 * @returns {Promise<string>} - Path to written config file
 */
async function writeUEVRAutoConfig(gameName, config) {
    const configDir = getUEVRGameConfigDir(gameName);
    const configPath = path.join(configDir, 'stereopticon_config.json');
    
    try {
        // Create directory if it doesn't exist
        fs.mkdirSync(configDir, { recursive: true });
        
        // Write config file
        const configJson = JSON.stringify(config, null, 2);
        fs.writeFileSync(configPath, configJson, 'utf8');
        
        console.log(`[UEVR AutoConfig] Wrote config to: ${configPath}`);
        return configPath;
    } catch (e) {
        console.error(`[UEVR AutoConfig] Failed to write config: ${e.message}`);
        throw e;
    }
}

/**
 * Build UEVR auto-config from current game/profile settings
 * 
 * @param {object} selectedProfile - Current UEVR profile
 * @param {object} uevrSettings - UEVR settings from store
 * @returns {object} - Config object to write
 */
function buildUEVRConfig(selectedProfile, uevrSettings) {
    const config = {};
    
    // Add enabled features
    if (uevrSettings && uevrSettings.controller_injection) {
        config.enable_input_passthrough = true;
    }
    
    // Add rendering mode if set
    if (uevrSettings && uevrSettings.rendering_method) {
        const methodMap = {
            '0': 'native_stereo',
            '1': 'synced_sequential',
            '2': 'afr'
        };
        config.rendering_mode = methodMap[uevrSettings.rendering_method] || 'native_stereo';
    }
    
    // Add camera/world settings if available
    if (uevrSettings && uevrSettings.world_scale) {
        config.world_scale = parseFloat(uevrSettings.world_scale) || 1.0;
    }
    
    if (uevrSettings && uevrSettings.depth) {
        config.depth = parseFloat(uevrSettings.depth) || 0.1;
    }
    
    // Add any profile-specific UEVR settings
    if (selectedProfile && selectedProfile.uevr_auto_settings) {
        Object.assign(config, selectedProfile.uevr_auto_settings);
    }
    
    return config;
}

/**
 * Clean up auto-config file after launch
 * (Optional: removes the file so it doesn't re-apply on game restart)
 */
function cleanupAutoConfig(gameName) {
    try {
        const configDir = getUEVRGameConfigDir(gameName);
        const configPath = path.join(configDir, 'stereopticon_config.json');
        
        if (fs.existsSync(configPath)) {
            fs.unlinkSync(configPath);
            console.log(`[UEVR AutoConfig] Cleaned up: ${configPath}`);
        }
    } catch (e) {
        console.warn(`[UEVR AutoConfig] Failed to cleanup: ${e.message}`);
    }
}

module.exports = {
    writeUEVRAutoConfig,
    buildUEVRConfig,
    cleanupAutoConfig,
    getUEVRGameConfigDir,
};
