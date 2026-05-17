const { findUnrealShippingExe, isUnrealGame, waitForProcessAndInject } = require('../modules/gameEngineUtils');
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs   = require('fs');
const os   = require('os');
const { scanGame, scanAllGames } = require('../modules/gameRegistry');
const { execSync } = require('child_process');
const DATA_DIR     = path.join(__dirname, '..', 'data');
const BUNDLE_PATH  = path.join(DATA_DIR, '_bundle.json');
const SIDEBAR_PATH = path.join(DATA_DIR, '_sidebar.json');

// In-memory cache. The full bundle (5 MB+, 7,500 games) is parsed once per
// app launch and held forever. Per-game lookup is a Map for O(1) detail
// fetches; the sidebar projection is sent over IPC at startup so the
// renderer can paint the 7,500-row list with ~70% less data than the
// full bundle. Rebuild via: node scripts/build-data-bundle.js
let _bundleCache  = null;
let _sidebarCache = null;
let _gameById     = null;

function _readJsonFile(file) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { return null; }
}

function _readBundle() {
    if (_bundleCache) return _bundleCache;
    const fromFile = fs.existsSync(BUNDLE_PATH) && _readJsonFile(BUNDLE_PATH);
    if (fromFile && Array.isArray(fromFile.games)) { _bundleCache = fromFile; }
    else {
        // Cold fallback: build in-memory by walking data/.
        console.warn('[data] Bundle missing or invalid — walking data/ directly. Run scripts/build-data-bundle.js to speed up.');
        const readDir = (name) => {
            const dir = path.join(DATA_DIR, name);
            if (!fs.existsSync(dir)) return [];
            return fs.readdirSync(dir).filter(f => f.endsWith('.json'))
                .map(f => _readJsonFile(path.join(dir, f))).filter(Boolean);
        };
        _bundleCache = { games: readDir('games'), pipelines: readDir('pipelines'), outputs: readDir('outputs') };
    }
    _gameById = new Map();
    for (const g of _bundleCache.games || []) _gameById.set(g.id, g);
    return _bundleCache;
}

function _readSidebar() {
    if (_sidebarCache) return _sidebarCache;
    const fromFile = fs.existsSync(SIDEBAR_PATH) && _readJsonFile(SIDEBAR_PATH);
    if (fromFile && Array.isArray(fromFile.games)) { _sidebarCache = fromFile; return _sidebarCache; }
    // Cold fallback: derive sidebar projection from the full bundle.
    const b = _readBundle();
    _sidebarCache = {
        games:     (b.games || []).map(g => ({
            id: g.id, title: g.title, steam_app_id: g.steam_app_id || '',
            native_outputs: [], has_headtracking: false, has_native_stereo: false,
            rendering_methods: [], recommended_fix_type: '', fix_count: (g.fixes || []).length,
        })),
        pipelines: b.pipelines || [],
        outputs:   b.outputs   || [],
    };
    return _sidebarCache;
}

function loadAllGames()     { return _readBundle().games     || []; }
function loadAllPipelines() { return _readBundle().pipelines || []; }
function loadAllOutputs()   { return _readBundle().outputs   || []; }
function loadSidebar()      { return _readSidebar(); }
function loadOneGame(id)    { _readBundle(); return _gameById?.get(id) || null; }
const { installFix, installUEVRProfile, installUE3D, readUEVRConfig, writeUEVRConfig, readVRto3DConfig, writeVRto3DConfig, installVRto3D, isVRto3DInstalled, getVRto3DConfigDir, writeVRto3DGameProfile } = require('../modules/installer');
const { getFullState, applyAndSave, resetToDefaults, snapshotDefaults } = require('../modules/iniEditor');
const { markInstalled, markUninstalled, isInstalled, getInstallRecord,
        getInstalledGameIds, getAllInstalled, setInstallExtra } = require('../modules/installState');
const { writeUEVRAutoConfig, buildUEVRConfig, cleanupAutoConfig } = require('../modules/uevrAutoConfig');
const { installReshade, detectReShadeInstall, detectGraphicsApi, getReshadeStatus, getShadersForPipeline } = require('../modules/reshade');
const { spawn } = require('child_process');
const { getDisplaySettings, writeDisplaySetting } = require('../modules/displaySettings');
const profileManager = require('../modules/profileManager');
const DISPLAYS_DIR   = path.join(__dirname, '..', 'data', 'displays');

function createWindow() {
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        frame: false,
        backgroundColor: '#020810',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });
    win.loadFile(path.join(__dirname, '../renderer/index.html'));
}

// ── Display / monitor settings ────────────────────────────────
// Returns all known display profiles with detected status + current values.
ipcMain.handle('display:getSettings', () => {
    try {
        return { success: true, profiles: getDisplaySettings() };
    } catch (e) {
        return { success: false, message: e.message };
    }
});

// Write a single setting for a display profile.
// profileId: e.g. 'acer_spatiallabs'
// settingId: e.g. 'focus_detection'
// value:     boolean (true = on, false = off)
ipcMain.handle('display:writeSetting', (_, { profileId, settingId, value }) => {
    try {
        return writeDisplaySetting(profileId, settingId, value);
    } catch (e) {
        return { success: false, message: e.message };
    }
});

// ── Data loaders ──────────────────────────────────────────────
ipcMain.handle('games:loadAll',     () => loadAllGames());
ipcMain.handle('pipelines:loadAll', () => loadAllPipelines());
ipcMain.handle('outputs:loadAll',   () => loadAllOutputs());
// Lazy-load API: light sidebar projection for fast startup, full detail
// fetched on demand when the user picks a game.
ipcMain.handle('games:loadSidebar', () => loadSidebar());
ipcMain.handle('games:loadOne',     (_, { id }) => loadOneGame(id));

// Load a specific display profile by ID (for VRto3D display output configs)
ipcMain.handle('displays:loadOne', (_, { displayId }) => {
    try {
        const displayPath = path.join(DISPLAYS_DIR, `${displayId}.json`);
        if (!fs.existsSync(displayPath)) {
            return { success: false, message: `Display profile not found: ${displayId}` };
        }
        const data = JSON.parse(fs.readFileSync(displayPath, 'utf8'));
        return { success: true, data };
    } catch (e) {
        return { success: false, message: e.message };
    }
});

// ── Install fix ───────────────────────────────────────────────
ipcMain.handle('install:fix', async (event, { profile, gameId, gamePath, exeName }) => {
    try {
        const result = await installFix(profile, gamePath, (progress) => {
            event.sender.send('install:progress', progress);
        }, exeName || null);
        if (result.success) {
            const isPending = ['uevr','ue3d'].includes(profile.type);
            markInstalled(profile.id, gameId, gamePath, profile.download_url,
                isPending ? { pendingGuide: true } : {});
        }
        return { success: true, ...result };
    } catch (e) {
        return { success: false, message: e.message };
    }
});

// ── Uninstall fix ─────────────────────────────────────────────
ipcMain.handle('install:uninstall', async (event, { profile, gamePath }) => {
    if (!gamePath || !fs.existsSync(gamePath)) {
        return { success: false, message: `Game folder not found:\n${gamePath}\n\nCheck the Game Folder path.` };
    }

    // Files installed by Geo-11 / 3DMigoto / HelixMod
    const GEO11_FILES = [...new Set([
        // Hook DLLs (any of these may be the ReShade or Geo-11 hook)
        'd3d11.dll', 'dxgi.dll', 'd3d9.dll', 'd3d12.dll', 'opengl32.dll',
        // Geo-11 / 3DMigoto core
        'd3dxdm.ini', profile.ini_file || 'd3dxdm.ini',
        'd3dcompiler_46.dll', 'd3dcompiler_47.dll', 'd3dcompiler_43.dll',
        'nvapi64.dll', 'nvapi32.dll',
        // Geo-11 generated files
        'd3d11_log.txt', 'nvapi_log.txt', 'd3dx.ini',
        // ReShade files
        'ReShade.ini', 'ReShade.log',
        // Misc fix artefacts
        'Uninstall.bat',
        // 3DGameBridge addon files (match by extension below, but common names)
        'srReshade_v2.1.0.addon64', 'srReshade_v2.1.0.addon32',
    ])];

    // Directories installed by fix tools
    const UNINSTALL_DIRS = [
        'ShaderFixes',     // standard 3DMigoto shader fix folder
        'ShaderFixesDM',   // Geo-11 variant
        'ShaderCache',     // Geo-11 shader cache
        'ShaderCacheDM',   // Geo-11 DM shader cache
        'DMAutoPatchCache',
        'DMAutoPatchFailures',
        'reshade-shaders', // ReShade shader install folder
    ];

    const removed  = [];
    const locked   = [];
    const skipped  = [];

    // Remove known files
    GEO11_FILES.forEach(f => {
        const p = path.join(gamePath, f);
        if (!fs.existsSync(p)) return;
        try { fs.unlinkSync(p); removed.push(f); }
        catch (e) { locked.push(`${f} (${e.code})`); }
    });

    // Remove any .addon64 / .addon32 files (3DGameBridge addons — version-named)
    try {
        fs.readdirSync(gamePath)
            .filter(f => f.endsWith('.addon64') || f.endsWith('.addon32'))
            .forEach(f => {
                try { fs.unlinkSync(path.join(gamePath, f)); removed.push(f); }
                catch (e) { locked.push(`${f} (${e.code})`); }
            });
    } catch { /* ignore */ }

    // Remove screenshots / jpg artefacts that match game-specific names
    // (e.g. FalloutShelter003_085.jpg written by Geo-11 on startup)
    try {
        fs.readdirSync(gamePath)
            .filter(f => /^[A-Za-z0-9_]+\d{3}_\d{3}\.jpg$/.test(f))
            .forEach(f => {
                try { fs.unlinkSync(path.join(gamePath, f)); removed.push(f); }
                catch (e) { skipped.push(f); }
            });
    } catch { /* ignore */ }

    // Remove directories
    UNINSTALL_DIRS.forEach(d => {
        const p = path.join(gamePath, d);
        if (!fs.existsSync(p)) return;
        try { fs.rmSync(p, { recursive: true, force: true }); removed.push(d + '/'); }
        catch (e) { locked.push(`${d}/ (${e.code})`); }
    });

    if (locked.length > 0) {
        return { success: false, message: `Some files are in use (close the game first):\n${locked.join('\n')}` };
    }

    markUninstalled(profile.id);

    if (removed.length === 0) {
        return { success: true, message: 'No fix files found — may have been removed manually. Install record cleared.' };
    }
    return { success: true, message: `Removed ${removed.length} item(s):\n${removed.join(', ')}` };
});

// ── installState extra fields ─────────────────────────────────
ipcMain.handle('installState:setExtra', (_, { fixId, extra }) => {
    try { setInstallExtra(fixId, extra); return { success: true }; }
    catch (e) { return { success: false, message: e.message }; }
});

// Also add to markInstalled so install:fix handler can pass extra
// ── UE3D (Monitor 3D) install ─────────────────────────────────
ipcMain.handle('install:ue3d', async (event, { profile, gamePath, exeName }) => {
    try {
        const result = await installUE3D(profile, gamePath, exeName, (progress) => {
            event.sender.send('install:progress', progress);
        });
        return { success: true, ...result };
    } catch (e) {
        return { success: false, message: e.message };
    }
});

// ── UEVR config.txt read/write ────────────────────────────────
ipcMain.handle('uevr:readConfig', async (_, { exeName }) => {
    try { return { success: true, config: readUEVRConfig(exeName) }; }
    catch (e) { return { success: false, message: e.message }; }
});
ipcMain.handle('uevr:writeConfig', async (_, { exeName, values }) => {
    try { const p = writeUEVRConfig(exeName, values); return { success: true, path: p }; }
    catch (e) { return { success: false, message: e.message }; }
});

// ── UEVR auto-config (Stereopticon integration) ────────────────
// Writes config that Lua plugin will pick up after injection
ipcMain.handle('uevr:writeAutoConfig', async (_, { gameName, config }) => {
    try {
        const configPath = await writeUEVRAutoConfig(gameName, config);
        return { success: true, configPath: String(configPath) };
    } catch (e) {
        return { success: false, message: String(e.message) };
    }
});

// ── UEVR game name marker (for Lua plugin identification) ──────
ipcMain.handle('uevr:writeGameMarker', async (_, { gameName }) => {
    try {
        const markerPath = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 
                                      'UnrealVRMod', 'stereopticon_current_game.txt');
        const markerDir = path.dirname(markerPath);
        if (!fs.existsSync(markerDir)) {
            fs.mkdirSync(markerDir, { recursive: true });
        }
        fs.writeFileSync(markerPath, gameName, 'utf8');
        return { success: true, path: markerPath };
    } catch (e) {
        return { success: false, message: String(e.message) };
    }
});


// ── VRto3D config JSON read/write ─────────────────────────────
ipcMain.handle('vrto3d:readConfig', async () => {
    try { return { success: true, config: readVRto3DConfig() }; }
    catch (e) { return { success: false, message: e.message }; }
});
ipcMain.handle('vrto3d:writeConfig', async (_, { values }) => {
    try { const p = writeVRto3DConfig(values); return { success: true, path: p }; }
    catch (e) { return { success: false, message: e.message }; }
});

// ── VRto3D installation & status ──────────────────────────────
ipcMain.handle('vrto3d:isInstalled', async () => {
    try {
        const { isVRto3DInstalled } = require('../modules/installer');
        return { success: true, installed: isVRto3DInstalled() };
    } catch (e) {
        return { success: false, message: e.message };
    }
});

ipcMain.handle('vrto3d:install', async (event, { force = false } = {}) => {
    try {
        const { installVRto3D } = require('../modules/installer');
        const result = await installVRto3D((progress) => {
            event.sender.send('vrto3d:installProgress', progress);
        });
        return { success: true, ...result };
    } catch (e) {
        return { success: false, message: e.message };
    }
});

ipcMain.handle('vrto3d:writeGameProfile', async (_, { exeName, settings } = {}) => {
    try {
        const { writeVRto3DGameProfile } = require('../modules/installer');
        const result = writeVRto3DGameProfile(exeName, settings);
        return { success: true, path: result };
    } catch (e) {
        return { success: false, message: e.message };
    }
});

// ── ReShade INI patch (section-specific) ──────────────────────
ipcMain.handle('reshade:iniPatch', (_, { iniPath, section, patches }) => {
    try {
        if (!fs.existsSync(iniPath)) return { success: false, message: 'ReShade.ini not found' };
        let content = fs.readFileSync(iniPath, 'utf8');
        // Patch each key in the specified section
        for (const [key, value] of Object.entries(patches)) {
            const sectionRe = new RegExp(`(\\[${section}\\][\\s\\S]*?)^${key}=.*$`, 'm');
            if (sectionRe.test(content)) {
                content = content.replace(sectionRe, `$1${key}=${value}`);
            } else {
                // Key doesn't exist in section — add it
                const sectionHeader = `[${section}]`;
                if (content.includes(sectionHeader)) {
                    content = content.replace(sectionHeader, `${sectionHeader}\r\n${key}=${value}`);
                } else {
                    content += `\r\n[${section}]\r\n${key}=${value}\r\n`;
                }
            }
        }
        fs.writeFileSync(iniPath, content);
        return { success: true };
    } catch (e) {
        return { success: false, message: e.message };
    }
});

// ── ReShade 3DGameBridge control ──────────────────────────────
ipcMain.handle('reshade:toggle3DGameBridge', (_, { gamePath, enabled }) => {
    try {
        const iniPath = path.join(gamePath, 'ReShade.ini');
        if (!fs.existsSync(iniPath)) return { success: false, message: 'ReShade.ini not found' };
        
        let content = fs.readFileSync(iniPath, 'utf8');
        
        // In ReShade.ini, addon sections are [Addon] with Name= field
        // 3DGameBridge addon line looks like: ; srReshade_v2.1.0.addon64 or similar
        // We need to find the addon configuration and enable/disable it
        
        // Look for the srReshade or 3DGameBridge addon config section
        if (enabled) {
            // Enable: uncomment the line and set it active
            content = content.replace(
                /^[\s;]*srReshade_v[\d.]+\.addon64\s*=\s*(true|false|)\s*$/mi,
                'srReshade_v2.1.0.addon64 = true'
            );
            // Also try the 32-bit variant
            content = content.replace(
                /^[\s;]*srReshade_v[\d.]+\.addon32\s*=\s*(true|false|)\s*$/mi,
                'srReshade_v2.1.0.addon32 = true'
            );
        } else {
            // Disable: set to false or comment out
            content = content.replace(
                /^[\s;]*(srReshade_v[\d.]+\.addon(?:64|32))\s*=\s*true\s*$/mi,
                '; $1 = false'
            );
        }
        
        fs.writeFileSync(iniPath, content);
        return { success: true, message: `3DGameBridge ${enabled ? 'enabled' : 'disabled'}` };
    } catch (e) {
        return { success: false, message: e.message };
    }
});

// ── ReShade VRServer detection/application ────────────────────
ipcMain.handle('reshade:ensureVRServer', async () => {
    try {
        const { findSteamVRDriversDir } = require('../modules/installer');
        const steamVRPath = findSteamVRDriversDir();
        if (!steamVRPath) return { success: false, message: 'SteamVR not found' };
        
        // VRServer is typically at: Steam\steamapps\common\SteamVR\tools\bin\win64\vrserver.exe
        const vrServerDir = path.join(path.dirname(steamVRPath), '..', 'tools', 'bin', 'win64');
        const vrServerExe = path.join(vrServerDir, 'vrserver.exe');
        
        if (!fs.existsSync(vrServerExe)) {
            return { success: false, message: 'VRServer.exe not found at: ' + vrServerExe };
        }
        
        // Check if ReShade64.dll is already there
        const reshadeVRServerDll = path.join(vrServerDir, 'dxgi.dll');
        if (fs.existsSync(reshadeVRServerDll)) {
            return { success: true, message: 'ReShade already applied to VRServer', installed: true };
        }
        
        // Copy ReShade64.dll as dxgi.dll for VRServer (DXGI is what VRServer uses)
        const bundleRoot = path.join(__dirname, '..', 'resources', 'reshade');
        const reshade64 = path.join(bundleRoot, 'ReShade64.dll');
        
        if (!fs.existsSync(reshade64)) {
            return { success: false, message: 'ReShade64.dll not found in bundle' };
        }
        
        // Create VRServer ReShade directory if needed
        fs.mkdirSync(vrServerDir, { recursive: true });
        
        // Copy ReShade DLL
        fs.copyFileSync(reshade64, reshadeVRServerDll);
        
        // Create basic ReShade.ini for VRServer
        const iniPath = path.join(vrServerDir, 'ReShade.ini');
        if (!fs.existsSync(iniPath)) {
            // Minimal ReShade config for VRServer with 3DGameBridge addon
            const iniContent = `[GENERAL]
PresetPath=${path.join(vrServerDir, 'reshade-presets')}
TextureSearchPath=${path.join(vrServerDir, 'reshade-textures')}
EffectSearchPath=${path.join(vrServerDir, 'reshade-shaders/Shaders')}

[ADDON]
srReshade_v2.1.0.addon64 = false
`;
            fs.writeFileSync(iniPath, iniContent);
        }
        
        return { success: true, message: 'ReShade applied to VRServer', installed: true, path: vrServerDir };
    } catch (e) {
        return { success: false, message: e.message };
    }
});

// ── Post-launch hotkeys ───────────────────────────────────────
// Sends keyboard shortcut(s) to the game window after a delay.
// Uses PowerShell + SendKeys as a zero-dependency fallback.
// AHK is NOT required; fall back gracefully if unavailable.
ipcMain.handle('launch:sendKeys', async (_, { keys, delayMs = 2000 }) => {
    await new Promise(r => setTimeout(r, delayMs));
    // Convert AHK-style notation to PowerShell SendKeys notation
    // AHK: +3d (Shift+3+d)  →  PS: +3d  (same for basic combos)
    const ps = `Add-Type -Assembly 'System.Windows.Forms'; [System.Windows.Forms.SendKeys]::SendWait('${keys.replace(/'/g, "''")}')`;
    try {
        const { execSync } = require('child_process');
        execSync(`powershell -NoProfile -NonInteractive -Command "${ps}"`, { timeout: 5000 });
        return { success: true };
    } catch (e) {
        return { success: false, message: e.message };
    }
});

// ── Install state queries ─────────────────────────────────────
ipcMain.handle('install:isInstalled',    (_, { fixId })  => isInstalled(fixId));
ipcMain.handle('install:getRecord',      (_, { fixId })  => getInstallRecord(fixId));
ipcMain.handle('install:allInstalled',   ()              => getAllInstalled());
ipcMain.handle('install:installedGameIds', ()            => [...getInstalledGameIds()]);

// ── UEVR profile install ──────────────────────────────────────
ipcMain.handle('install:uevrProfile', async (event, { profile }) => {
    try {
        const result = await installUEVRProfile(profile, (progress) => {
            event.sender.send('install:progress', progress);
        });
        return { success: true, ...result };
    } catch (e) {
        return { success: false, message: e.message };
    }
});

// ── Pipeline executor (resolver-driven adapter dispatch) ─────
// Single entry point for "apply all the tool configs for this selection". The
// renderer calls this right before launching the game, replacing the scattered
// applyGeo11SettingsBeforeLaunch / 3DGameBridge inline block / etc.
ipcMain.handle('pipeline:execute', async (_, input) => {
    try {
        return await profileManager.executePipeline(input);
    } catch (e) {
        return { success: false, applied: [], errors: [e.message], warnings: [] };
    }
});

// ── Launch game ───────────────────────────────────────────────
ipcMain.handle('game:launch', async (_, { exePath }) => {
    if (!exePath) return { success: false, message: 'No executable path provided.' };
    if (!fs.existsSync(exePath)) {
        return { success: false, message: `Executable not found:\n${exePath}\n\nCheck the Game Folder path — it should be the folder containing the game exe.` };
    }
    try {
        const child = spawn(exePath, [], {
            detached: true,
            stdio:    'ignore',
            cwd:      path.dirname(exePath),
            shell:    false,
        });
        child.on('error', err => console.error('Launch error:', err));
        child.unref();
        return { success: true };
    } catch (e) {
        return { success: false, message: `Failed to launch:\n${e.message}` };
    }
});

// ── Launch game + UEVR Injector ───────────────────────────────
// For UEVR / UE3D fixes.
// Launches the game exe, then opens UEVRInjector.exe 2s later if present.
// If UEVRInjector.exe is missing, the game still launches — user injects manually.
// ── Updated game:launchWithUEVR handler ───────────────────────
// Replace the existing game:launchWithUEVR ipcMain.handle block in src/main.js
// with this version.
//
// Requires at top of main.js (add alongside other requires):
//   const { findUnrealShippingExe, isUnrealGame, waitForProcessAndInject } = require('../modules/gameEngineUtils');

ipcMain.handle('game:launchWithUEVR', async (event, { exePath }) => {
    if (!exePath) return { success: false, message: 'No executable path provided.' };
    if (!fs.existsSync(exePath)) {
        return { success: false, message: `Executable not found:\n${exePath}` };
    }

    const uevrDir      = path.join(__dirname, '..', 'resources', 'uevr');
    const injectorPath = path.join(uevrDir, 'UEVRInjector.exe');

    // ── Find the actual shipping exe if this is an Unreal launcher ──
    // e.g. user browses to Game.exe but the real target is
    // Game/Binaries/Win64/Game-Win64-Shipping.exe
    let targetExe = exePath;
    if (isUnrealGame(exePath)) {
        const shippingExe = findUnrealShippingExe(exePath);
        if (shippingExe !== exePath) {
            console.log(`[UEVR] Redirecting from launcher to shipping exe: ${shippingExe}`);
            targetExe = shippingExe;
        }
    }

    const exeBaseName = path.basename(targetExe);
    const exeDir      = path.dirname(targetExe);

    // ── Launch the game ──────────────────────────────────────
    try {
        const child = spawn(targetExe, [], {
            detached: true,
            stdio:    'ignore',
            cwd:      exeDir,
            shell:    false,
        });
        child.on('error', err => console.error('Game launch error:', err.message));
        child.unref();
    } catch (e) {
        return { success: false, message: `Failed to launch game:\n${e.message}` };
    }

    // ── Inject UEVR using Rai Pal watcher pattern ────────────
    if (!fs.existsSync(injectorPath)) {
        return {
            success:          true,
            injectorLaunched: false,
            shippingExe:      targetExe,
            message:          'Game launched. UEVRInjector.exe not found — run npm run setup to download it.',
        };
    }

    // Run injection watcher in background — don't await so launch returns immediately
    waitForProcessAndInject(exeBaseName, injectorPath, uevrDir, {
        timeoutMs:   60_000,   // wait up to 60s for process to appear
        stabilizeMs: 4_000,    // wait 4s after detection for game to finish loading
        onStatus: (msg) => {
            // Send progress updates to renderer during injection wait
            try { event.sender.send('uevr:injectStatus', { message: msg }); } catch {}
        },
    }).then(result => {
        try {
            event.sender.send('uevr:injectStatus', {
                message:  result.message,
                success:  result.success,
                done:     true,
            });
        } catch {}
    });

    return {
        success:          true,
        injectorLaunched: true,
        shippingExe:      targetExe,
        redirected:       targetExe !== exePath,
        message:          targetExe !== exePath
            ? `Launching ${exeBaseName} (redirected from launcher)`
            : `Launching ${exeBaseName}`,
    };
});

// ── Also add this IPC handler for the renderer to query shipping exe ──
// Used so the UI can show "will inject into Game-Win64-Shipping.exe"
// before the user clicks Launch.
ipcMain.handle('game:resolveShippingExe', async (_, { exePath }) => {
    if (!exePath || !fs.existsSync(exePath)) return { exePath, redirected: false };
    try {
        const shipping   = findUnrealShippingExe(exePath);
        const redirected = shipping !== exePath;
        return { exePath: shipping, redirected, original: exePath };
    } catch {
        return { exePath, redirected: false };
    }
});

// ── Ini editor ────────────────────────────────────────────────
ipcMain.handle('ini:getState', async (_, { fixId, iniPath }) => {
    try { return { success: true, ...getFullState(fixId, iniPath) }; }
    catch (e) { return { success: false, message: e.message }; }
});
ipcMain.handle('ini:apply', async (_, { fixId, iniPath, values }) => {
    try { applyAndSave(fixId, iniPath, values); return { success: true }; }
    catch (e) { return { success: false, message: e.message }; }
});
ipcMain.handle('ini:reset', async (_, { fixId, iniPath }) => {
    try { resetToDefaults(fixId, iniPath); return { success: true }; }
    catch (e) { return { success: false, message: e.message }; }
});
ipcMain.handle('ini:snapshot', async (_, { fixId, iniPath }) => {
    try { return { success: true, fields: snapshotDefaults(fixId, iniPath) }; }
    catch (e) { return { success: false, message: e.message }; }
});

// ── ReShade ───────────────────────────────────────────────────
ipcMain.handle('reshade:detect',       (_, { gamePath })              => detectReShadeInstall(gamePath));
ipcMain.handle('reshade:shadersForPipeline', (_, { steps })           => getShadersForPipeline(steps));
ipcMain.handle('reshade:status',       (_, { gamePath, profile })     => getReshadeStatus(gamePath, profile));
ipcMain.handle('reshade:updatePreset', (_, { gamePath, shaders })    => {
    try {
        const { writeReshadePreset } = require('../modules/reshade');
        writeReshadePreset(gamePath, shaders);
        return { success: true };
    } catch (e) {
        return { success: false, message: e.message };
    }
});
ipcMain.handle('reshade:detectApi',    (_, { gamePath, exePath, profile }) => detectGraphicsApi(gamePath, exePath, profile));
ipcMain.handle('reshade:install', async (event, { gamePath, exePath, profile, requiredShaders, geo11Installed }) => {
    try {
        const result = await installReshade({
            gamePath, exePath, profile,
            requiredShaders: requiredShaders || [],
            geo11Installed:  geo11Installed  || false,
            onProgress: data => event.sender.send('reshade:progress', data),
        });
        return result;
    } catch (e) {
        return { success: false, message: e.message };
    }
});

// ── Cache ─────────────────────────────────────────────────────
ipcMain.handle('install:cacheInfo',  ()  => getCacheInfo());
ipcMain.handle('install:clearCache', ()  => { clearCache(); return { success: true }; });

// ── Directory picker ──────────────────────────────────────────
ipcMain.handle('dialog:openDirectory', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return canceled ? null : filePaths[0];
});

// ── External URLs ─────────────────────────────────────────────
ipcMain.handle('shell:openExternal', (_, url) => shell.openExternal(url));
// Reveal a local folder in Explorer/Finder. Used by the game-list right-
// click "Browse local files" action. Falls back to the parent directory if
// the exact path doesn't exist (e.g. user passed an exe that hasn't been
// downloaded yet).
ipcMain.handle('shell:openPath', async (_, p) => {
    if (!p) return { success: false, error: 'no path' };
    try {
        const stat = fs.existsSync(p) ? fs.statSync(p) : null;
        const target = (stat && stat.isFile()) ? path.dirname(p) : p;
        const result = await shell.openPath(target);
        return { success: result === '', error: result };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// ── Window controls ───────────────────────────────────────────
// Sender-based window lookup — getFocusedWindow() can return null if focus
// shifted during the click roundtrip (Windows reportedly drops focus briefly
// on frameless-window non-drag clicks), which was causing minimize/maximize
// to silently no-op while close still worked by accident.
function senderWindow(e) {
    return BrowserWindow.fromWebContents(e.sender) || BrowserWindow.getFocusedWindow();
}
ipcMain.on('window:minimize', (e) => senderWindow(e)?.minimize());
ipcMain.on('window:maximize', (e) => {
    const w = senderWindow(e);
    if (!w) return;
    w.isMaximized() ? w.unmaximize() : w.maximize();
});
ipcMain.on('window:close', (e) => senderWindow(e)?.close());

// Launch the OpenTrack hub GUI directly so the user can fine-tune mappings.
// Looks in the standard locations the OpenTrack adapter also uses.
// App version — read from package.json so Settings shows the live build.
// Continues the Vireio Perception versioning lineage (v1-v4); Stereopticon
// is v5.0.0-alpha.X.
ipcMain.handle('app:version', () => {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
        return { version: pkg.version, name: pkg.name, productName: pkg.productName };
    } catch { return { version: '', name: 'stereopticon' }; }
});

ipcMain.handle('opentrack:open', () => {
    const candidates = [
        path.join(__dirname, '..', 'resources', 'opentrack', 'opentrack.exe'),
        path.join(__dirname, '..', 'lib', 'opentrack', 'opentrack.exe'),
        'C:\\Program Files\\opentrack\\opentrack.exe',
        'C:\\Program Files (x86)\\opentrack\\opentrack.exe',
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) {
            spawn(p, [], { detached: true, stdio: 'ignore', cwd: path.dirname(p) }).unref();
            return { success: true, path: p };
        }
    }
    return { success: false, message: 'OpenTrack not found — run setup or install OpenTrack manually.' };
});

app.whenReady().then(createWindow);

ipcMain.handle('game:scan', async (_, { title, exeName, steamAppId }) => {
    try { return await scanGame(title, exeName || null, steamAppId || null); }
    catch (e) { return { found: false, error: e.message }; }
});
ipcMain.handle('game:scanAll', async (_, { targets }) => {
    try { return await scanAllGames(targets || []); }
    catch (e) { return {}; }
});

const EXTERNAL_SOFTWARE = {
    'newaxis': {
        name: 'NewAxis', url: 'https://github.com/marcussacana/NewAxis/releases',
        exeFile: 'NewAxis.exe',
        searchPaths: [
            '%PROGRAMFILES%\\NewAxis', '%PROGRAMFILES(X86)%\\NewAxis',
            '%LOCALAPPDATA%\\NewAxis', '%APPDATA%\\NewAxis',
        ],
        regKeys: [],
    },
    'vorpx': {
        name: 'vorpX', url: 'https://www.vorpx.com/',
        exeFile: 'vorpControl.exe',
        searchPaths: [
            '%PROGRAMFILES%\\Ralf Ostertag\\vorpX',
            '%PROGRAMFILES(X86)%\\Ralf Ostertag\\vorpX',
        ],
        regKeys: ['HKCU\\SOFTWARE\\Ralf Ostertag\\vorpX', 'HKLM\\SOFTWARE\\Ralf Ostertag\\vorpX'],
    },
};
function expandEnvVars(p) { return p.replace(/%([^%]+)%/g, (_, v) => process.env[v] || ''); }
function findExe(softwareId) {
    const def = EXTERNAL_SOFTWARE[softwareId]; if (!def) return null;
    for (const key of (def.regKeys || [])) {
        try {
            const out = execSync(`reg query "${key}" /v InstallDir`, { encoding: 'utf8', timeout: 2000 });
            const m = out.match(/InstallDir\s+REG_SZ\s+(.+)/i);
            if (m) { const c = path.join(m[1].trim(), def.exeFile); if (fs.existsSync(c)) return c; }
        } catch {}
    }
    for (const p of def.searchPaths) {
        const c = path.join(expandEnvVars(p), def.exeFile);
        if (fs.existsSync(c)) return c;
    }
    return null;
}
ipcMain.handle('software:check', (_, { softwareId }) => {
    const def = EXTERNAL_SOFTWARE[softwareId];
    if (!def) return { found: false, name: softwareId, url: null };
    const exePath = findExe(softwareId);
    return { found: !!exePath, exePath: exePath || null, name: def.name, url: def.url };
});
ipcMain.handle('software:checkForFixType', (_, { fixType }) => {
    const map = { 'geo12': 'newaxis', 'vorpx': 'vorpx' };
    const softwareId = map[fixType]; if (!softwareId) return { found: false };
    const def = EXTERNAL_SOFTWARE[softwareId]; const exePath = findExe(softwareId);
    return { found: !!exePath, softwareId, exePath: exePath || null, name: def?.name, url: def?.url };
});
ipcMain.handle('software:launch', (_, { softwareId, exePathOverride }) => {
    const exePath = exePathOverride || findExe(softwareId);
    if (!exePath) { const def = EXTERNAL_SOFTWARE[softwareId]; return { success: false, notFound: true, url: def?.url }; }
    try { spawn(exePath, [], { detached: true, stdio: 'ignore', cwd: path.dirname(exePath) }).unref(); return { success: true }; }
    catch (e) { return { success: false, message: e.message }; }
});

// ─────────────────────────────────────────────────────────────────────────────
// Display & Profile IPC handlers
// ─────────────────────────────────────────────────────────────────────────────
// ── display:listFamilies ──────────────────────────────────────
// Returns all display family files as a flat list of family summaries.
// Used to populate the display family picker in the UI.
ipcMain.handle('display:listFamilies', async () => {
    try {
        if (!fs.existsSync(DISPLAYS_DIR)) return { success: true, families: [] };
        const files = fs.readdirSync(DISPLAYS_DIR).filter(f => f.endsWith('.json'));
        const families = files.map(f => {
            try {
                const data = JSON.parse(fs.readFileSync(path.join(DISPLAYS_DIR, f), 'utf8'));
                return {
                    family_id:   data.family_id,
                    family_name: data.family_name,
                    summary:     data.summary || '',
                    native_input: data.native_input,
                    device_count: (data.devices || []).length,
                    file: f,
                };
            } catch { return null; }
        }).filter(Boolean);
        return { success: true, families };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// ── display:getFamily ─────────────────────────────────────────
// Returns the full family profile including all devices.
// Used to populate the device picker and show software/headtracking info.
ipcMain.handle('display:getFamily', async (_, { familyId }) => {
    try {
        if (!fs.existsSync(DISPLAYS_DIR)) return { success: false, error: 'Displays dir not found' };
        const files = fs.readdirSync(DISPLAYS_DIR).filter(f => f.endsWith('.json'));
        for (const f of files) {
            const data = JSON.parse(fs.readFileSync(path.join(DISPLAYS_DIR, f), 'utf8'));
            if (data.family_id === familyId) return { success: true, family: data };
        }
        return { success: false, error: `Display family not found: ${familyId}` };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// ── display:getDevice ─────────────────────────────────────────
// Returns a single device's full merged profile (family defaults + device overrides).
// This is what the UI uses to show device-specific software, quirks, setup notes.
ipcMain.handle('display:getDevice', async (_, { familyId, deviceId }) => {
    try {
        const files = fs.readdirSync(DISPLAYS_DIR).filter(f => f.endsWith('.json'));
        let familyData = null;
        for (const f of files) {
            const data = JSON.parse(fs.readFileSync(path.join(DISPLAYS_DIR, f), 'utf8'));
            if (data.family_id === familyId) { familyData = data; break; }
        }
        if (!familyData) return { success: false, error: `Family not found: ${familyId}` };
        const device = (familyData.devices || []).find(d => d.id === deviceId);
        if (!device) return { success: false, error: `Device not found: ${deviceId}` };
        const merged = {
            family_id:            familyData.family_id,
            family_name:          familyData.family_name,
            native_input:         familyData.native_input,
            accepted_fix_outputs: familyData.accepted_fix_outputs,
            vr_drivers:           familyData.vr_drivers,
            headtracking:         { ...familyData.headtracking, ...(device.headtracking_support || {}) },
            family_software:      familyData.family_software || [],
            ...device,
            vrto3d_config: {
                ...(familyData.vr_drivers?.vrto3d?.config_base || {}),
                ...(device.vrto3d_config || {}),
            },
        };
        return { success: true, device: merged };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// ── display:getAllDevices ─────────────────────────────────────
// Returns a flat list of all devices across all families.
// Used for a combined device picker if the UI doesn't group by family.
ipcMain.handle('display:getAllDevices', async () => {
    try {
        if (!fs.existsSync(DISPLAYS_DIR)) return { success: true, devices: [] };
        const files = fs.readdirSync(DISPLAYS_DIR).filter(f => f.endsWith('.json'));
        const devices = [];
        for (const f of files) {
            const data = JSON.parse(fs.readFileSync(path.join(DISPLAYS_DIR, f), 'utf8'));
            for (const device of (data.devices || [])) {
                devices.push({
                    family_id:   data.family_id,
                    family_name: data.family_name,
                    id:          device.id,
                    name:        device.name,
                    vendor:      device.vendor,
                });
            }
        }
        return { success: true, devices };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// ── profile:preview ───────────────────────────────────────────
// Resolves the pipeline for a fix + display WITHOUT writing anything to disk.
// Used by the UI to show what steps will be applied before the user confirms.
//
// Returns:
// {
//   fixOutput:     string,       — format the fix produces (e.g. "sbs")
//   steps:         string[],     — intermediary software needed (e.g. ["3DGameBridge"])
//   vrDriver:      string|null,  — "vrto3d" | "xrgamebridge" | null
//   vrDriverConfig: object,      — config that would be written
//   warnings:      string[],     — non-fatal issues
//   incompatible:  bool,
//   displayNotes:  string|null,
// }
ipcMain.handle('profile:preview', async (_, { fix, familyId, deviceId, options = {} }) => {
    try {
        // Load and merge device profile
        const files = fs.readdirSync(DISPLAYS_DIR).filter(f => f.endsWith('.json'));
        let familyData = null;
        for (const f of files) {
            const data = JSON.parse(fs.readFileSync(path.join(DISPLAYS_DIR, f), 'utf8'));
            if (data.family_id === familyId) { familyData = data; break; }
        }
        if (!familyData) return { success: false, error: `Family not found: ${familyId}` };

        const device = (familyData.devices || []).find(d => d.id === deviceId);
        if (!device) return { success: false, error: `Device not found: ${deviceId}` };

        // Build a flat display object that resolvePipeline expects
        const display = {
            id:                   device.id,
            name:                 device.name,
            accepted_fix_outputs: familyData.accepted_fix_outputs,
            vr_drivers:           familyData.vr_drivers,
            headtracking:         familyData.headtracking,
        };

        // Inject device VRto3D config into driver config
        if (display.vr_drivers?.vrto3d) {
            display.vr_drivers.vrto3d.config = {
                ...(familyData.vr_drivers.vrto3d.config_base || {}),
                ...(device.vrto3d_config || {}),
            };
        }

        const pipeline = profileManager.resolvePipeline(fix, display, {
            graphicsApi:    options.graphicsApi || fix.graphics_api || null,
            preferVrDriver: options.preferVrDriver || null,
        });

        return { success: true, ...pipeline };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// ── profile:apply ─────────────────────────────────────────────
// Resolves and APPLIES the pipeline — writes VRto3D config, UEVR profile, etc.
// Call this when the user confirms the launch setup.
//
// options: {
//   graphicsApi:             string|null,
//   preferVrDriver:          string|null,   — force "vrto3d" or "xrgamebridge"
//   enableHeadtracking:      bool,
//   headtrackingMethod:      string|null,   — "vertoxr" | "opentrack" | "leiatrack"
//   headtrackingLaunchScript: string|null,  — e.g. "start vertoxr://steamvr"
//   gameOverrides:           object,        — per-game override values
// }
ipcMain.handle('profile:apply', async (_, { fix, familyId, deviceId, options = {} }) => {
    try {
        const files = fs.readdirSync(DISPLAYS_DIR).filter(f => f.endsWith('.json'));
        let familyData = null;
        for (const f of files) {
            const data = JSON.parse(fs.readFileSync(path.join(DISPLAYS_DIR, f), 'utf8'));
            if (data.family_id === familyId) { familyData = data; break; }
        }
        if (!familyData) return { success: false, error: `Family not found: ${familyId}` };

        const device = (familyData.devices || []).find(d => d.id === deviceId);
        if (!device) return { success: false, error: `Device not found: ${deviceId}` };

        const display = {
            id:                   device.id,
            name:                 device.name,
            accepted_fix_outputs: familyData.accepted_fix_outputs,
            vr_drivers:           familyData.vr_drivers,
            headtracking:         familyData.headtracking,
        };
        if (display.vr_drivers?.vrto3d) {
            display.vr_drivers.vrto3d.config = {
                ...(familyData.vr_drivers.vrto3d.config_base || {}),
                ...(device.vrto3d_config || {}),
            };
        }

        // Resolve pipeline
        const pipeline = profileManager.resolvePipeline(fix, display, {
            graphicsApi:    options.graphicsApi || fix.graphics_api || null,
            preferVrDriver: options.preferVrDriver || null,
        });

        if (pipeline.incompatible) {
            return { success: false, error: 'No compatible pipeline', warnings: pipeline.warnings };
        }

        const applied  = [];
        const errors   = [];
        const warnings = [...pipeline.warnings];

        // Apply VRto3D config
        if (pipeline.vrDriver === 'vrto3d') {
            const gameVROverrides = options.gameOverrides?.vrto3d || {};
            const r = profileManager.applyVRto3DConfig(pipeline.vrDriverConfig, gameVROverrides);
            if (r.success) applied.push(`VRto3D default config written → ${r.path}`);
            else errors.push(`VRto3D config: ${r.error}`);

            // Per-game VRto3D profile
            if (fix.exe_name) {
                const gameProfile = {
                    ...(fix.vrto3d_profile || {}),
                    ...(options.gameOverrides?.vrto3d_game || {}),
                };
                if (Object.keys(gameProfile).length > 0) {
                    const gp = profileManager.applyVRto3DGameProfile(fix.exe_name, gameProfile);
                    if (gp.success) applied.push(`VRto3D game profile written → ${gp.path}`);
                    else errors.push(`VRto3D game profile: ${gp.error}`);
                }
            }

            // Headtracking
            if (options.enableHeadtracking) {
                const port = familyData.headtracking?.open_track_port || 4242;
                const method = options.headtrackingMethod || familyData.headtracking?.default_method;
                if (['opentrack', 'vertoxr', 'leiatrack'].includes(method)) {
                    const ht = profileManager.enableVRto3DOpenTrack(port);
                    if (ht.success) applied.push('OpenTrack enabled in VRto3D config');
                }
                if (options.headtrackingLaunchScript) {
                    profileManager.setVRto3DLaunchScript(options.headtrackingLaunchScript);
                    applied.push(`Launch script set: ${options.headtrackingLaunchScript}`);
                }
            }
        }

        // Apply UEVR profile
        if (['uevr', 'reframework'].includes(fix.type) && fix.uevr_profile && fix.uevr_game_name) {
            const ur = profileManager.applyUEVRProfile(fix.uevr_game_name, fix.uevr_profile);
            if (ur.success) applied.push(`UEVR profile written → ${ur.path}`);
            else errors.push(`UEVR profile: ${ur.error}`);
        }

        return {
            success:  errors.length === 0,
            pipeline,
            applied,
            warnings,
            errors,
        };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// ── profile:getSoftwareStatus ─────────────────────────────────
// Checks which software items in a display profile are actually installed.
// Returns the software list with an `installed: bool` field on each.
// Used by the display settings panel to show a checklist.
ipcMain.handle('profile:getSoftwareStatus', async (_, { familyId, deviceId }) => {
    try {
        const files = fs.readdirSync(DISPLAYS_DIR).filter(f => f.endsWith('.json'));
        let familyData = null;
        for (const f of files) {
            const data = JSON.parse(fs.readFileSync(path.join(DISPLAYS_DIR, f), 'utf8'));
            if (data.family_id === familyId) { familyData = data; break; }
        }
        if (!familyData) return { success: false, error: `Family not found: ${familyId}` };

        const device = deviceId
            ? (familyData.devices || []).find(d => d.id === deviceId)
            : null;

        // Collect all relevant software entries
        const allSoftware = [
            ...(familyData.family_software || []),
            ...(device?.device_software || []),
        ];

        // Check installation for each entry using existing software:check infrastructure
        // This calls the same EXTERNAL_SOFTWARE / findExe logic already in main.js
        const results = await Promise.all(allSoftware.map(async sw => {
            // Map software id to something checkable — extend EXTERNAL_SOFTWARE as needed
            let installed = null;
            try {
                // Try to detect via known paths or registry
                installed = checkSoftwareInstalled(sw.id);
            } catch { installed = null; }
            return { ...sw, installed };
        }));

        return { success: true, software: results };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// Helper — extend this as you add more software detection
function checkSoftwareInstalled(softwareId) {
    const { execSync } = require('child_process');
    const checks = {
        'leiasr_platform': () => {
            const p = 'C:\\Program Files\\LeiaSR\\Platform\\bin';
            return require('fs').existsSync(p);
        },
        'acer_truegame': () => {
            const p = 'C:\\Program Files\\Acer\\TrueGame';
            return require('fs').existsSync(p);
        },
        'newaxis': () => {
            const p = 'C:\\Program Files\\NewAxis';
            return require('fs').existsSync(p);
        },
        '3dgamebridge': () => {
            // Installed as a ReShade addon — check resources dir
            const addonDir = require('path').join(__dirname, '..', 'resources', 'reshade', 'addons');
            return require('fs').readdirSync(addonDir).some(f => f.startsWith('srReshade'));
        },
        'vertoxr': () => {
            try { execSync('where vertoxr', { stdio: 'pipe' }); return true; } catch { return false; }
        },
    };
    return checks[softwareId] ? checks[softwareId]() : null;
}