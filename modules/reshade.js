/**
 * reshade.js — Bundled ReShade manager for Stereopticon
 *
 * Strategy: ReShade and all shaders ship INSIDE the app bundle under
 *   resources/reshade/
 *     ReShade64.dll
 *     ReShade32.dll
 *     shaders/
 *       3DGameBridge.fx  (+ .fxh files)
 *       SuperDepth3D.fx
 *       Refract.fx
 *       (etc.)
 *
 * At fix-install time we:
 *   1. Detect which DLL name the game needs (d3d9/dxgi/d3d12/opengl32)
 *   2. Copy ReShade64.dll → gamePath/<hookDll>
 *   3. Copy only the shaders required by this pipeline → gamePath/reshade-shaders/Shaders/
 *   4. Write ReShade.ini + reshade-presets/Stereopticon.ini
 *   5. If Geo-11 is also installed, patch d3dxdm.ini for chain mode
 *
 * No internet required after app install.
 * GPL-compatibility: ReShade = BSD 2-Clause, shaders = MIT — fine to bundle.
 */
'use strict';

const fs   = require('fs');
const path  = require('path');
const os    = require('os');
const https = require('https');

// ── Inline fxh download ──────────────────────────────────────
// Downloads ReShade.fxh + ReShadeUI.fxh from GitHub if missing.
// Called during installReshade so the game always has the headers.
async function ensureFxhInDir(targetDir) {
    const FXH = {
        'ReShade.fxh':   'https://raw.githubusercontent.com/crosire/reshade-shaders/master/Shaders/ReShade.fxh',
        'ReShadeUI.fxh': 'https://raw.githubusercontent.com/crosire/reshade-shaders/master/Shaders/ReShadeUI.fxh',
    };
    fs.mkdirSync(targetDir, { recursive: true });
    const results = {};
    for (const [filename, url] of Object.entries(FXH)) {
        const dest = path.join(targetDir, filename);
        if (fs.existsSync(dest)) { results[filename] = 'present'; continue; }
        await new Promise((resolve) => {
            const file = fs.createWriteStream(dest);
            https.get(url, (res) => {
                if (res.statusCode === 200) {
                    res.pipe(file);
                    file.on('finish', () => { file.close(); results[filename] = 'downloaded'; resolve(); });
                } else {
                    file.close();
                    try { fs.unlinkSync(dest); } catch {}
                    results[filename] = `http ${res.statusCode}`;
                    resolve();
                }
            }).on('error', (e) => {
                try { fs.unlinkSync(dest); } catch {}
                results[filename] = `error: ${e.message}`;
                resolve();
            });
        });
    }
    return results;
}

// ── Bundle paths ──────────────────────────────────────────────
function getBundleRoot() {
    // In packaged app: process.resourcesPath/reshade
    // In dev:          <project root>/resources/reshade
    const candidates = [
        path.join(process.resourcesPath || '', 'reshade'),
        path.join(__dirname, '..', 'resources', 'reshade'),
        path.join(__dirname, '..', '..', 'resources', 'reshade'),
    ];
    for (const p of candidates) { if (fs.existsSync(p)) return p; }
    return candidates[1]; // dev fallback — will fail gracefully if missing
}

function getBundledDll(is64 = true) {
    return path.join(getBundleRoot(), is64 ? 'ReShade64.dll' : 'ReShade32.dll');
}

function getBundledShaderDir() {
    // Headers only: ReShade.fxh, ReShadeUI.fxh — this dir is in EffectSearchPaths
    return path.join(getBundleRoot(), 'shaders');
}
function getBundledShaderSrcDir() {
    // Game-specific + generic .fx files — NOT in EffectSearchPaths (per-game copy only)
    return path.join(getBundleRoot(), 'shaders-src');
}

// ── Graphics API detection ────────────────────────────────────
const API_TO_DLL = {
    dx9:    'd3d9.dll',
    dx10:   'd3d10.dll',
    dx11:   'dxgi.dll',
    dx12:   'd3d12.dll',
    opengl: 'opengl32.dll',
    vulkan: null,   // Vulkan games use ShaderGlass — no injection
};

const IMPORT_SIGNATURES = [
    { sig: 'd3d9.dll',     api: 'dx9'    },
    { sig: 'd3d10.dll',    api: 'dx10'   },
    { sig: 'd3d11.dll',    api: 'dx11'   },
    { sig: 'd3d12.dll',    api: 'dx12'   },
    { sig: 'opengl32.dll', api: 'opengl' },
    { sig: 'vulkan-1.dll', api: 'vulkan' },
];

function detectApiFromExe(exePath) {
    if (!exePath || !fs.existsSync(exePath)) return null;
    try {
        const size = Math.min(fs.statSync(exePath).size, 4 * 1024 * 1024);
        const buf  = Buffer.alloc(size);
        const fd   = fs.openSync(exePath, 'r');
        fs.readSync(fd, buf, 0, size, 0);
        fs.closeSync(fd);
        const content = buf.toString('latin1').toLowerCase();
        for (const { sig, api } of IMPORT_SIGNATURES) {
            if (content.includes(sig)) return api;
        }
    } catch {}
    return null;
}

function detectApiFromProfile(profile) {
    const fields = [
        profile.graphics_api,  // Game's graphics_api field (priority)
        profile.rendering_method,
        profile.dx_version,
        profile.geo11_type,
    ].map(f => (f || '').toLowerCase());
    for (const f of fields) {
        if (f.includes('dx12') || f.includes('d3d12'))   return 'dx12';
        if (f.includes('dx11') || f.includes('d3d11'))   return 'dx11';
        if (f.includes('dx9')  || f.includes('d3d9'))    return 'dx9';
        if (f.includes('dx10') || f.includes('d3d10'))   return 'dx10';
        if (f.includes('opengl') || f.includes('ogl'))   return 'opengl';
        if (f.includes('vulkan') || f.includes('vk'))    return 'vulkan';
    }
    return null;
}

function detectGraphicsApi(gamePath, exePath, profile) {
    const fromProfile = detectApiFromProfile(profile || {});
    if (fromProfile) return { api: fromProfile, source: 'profile', hookDll: API_TO_DLL[fromProfile] };
    const fromExe = detectApiFromExe(exePath);
    if (fromExe) return { api: fromExe, source: 'exe', hookDll: API_TO_DLL[fromExe] };
    const folderFiles = fs.existsSync(gamePath)
        ? fs.readdirSync(gamePath).map(f => f.toLowerCase()) : [];
    if (folderFiles.includes('vulkan-1.dll')) return { api: 'vulkan', source: 'folder', hookDll: null };
    if (folderFiles.includes('d3d12.dll'))    return { api: 'dx12',   source: 'folder', hookDll: 'd3d12.dll' };
    if (folderFiles.includes('d3d9.dll'))     return { api: 'dx9',    source: 'folder', hookDll: 'd3d9.dll'  };
    return { api: 'dx11', source: 'fallback', hookDll: 'dxgi.dll' };
}

// ── Shader catalogue ──────────────────────────────────────────
// Maps pipeline step name → file(s) in the bundle's shaders/ dir
const SHADER_FILES = {
    // 3DGameBridge is a ReShade ADDON (.addon64), not a shader (.fx) — handled by copyAddons()
    'Refract':                   ['Refract.fx', 'Refract.fxh'],
    '3DtoElse':                  ['3DtoElse.fx'],
    'Anaglyph_to_SBS_or_TAB':    ['Anaglyph_to_SBS_or_TAB.fx'],
    'Limbo_Anaglyph_to_SBS_TAB': ['Limbo_Anaglyph_to_SBS_TAB.fx'],
    'FEZ_Anaglyph_to_SBS_TAB':   ['FEZ_Anaglyph_to_SBS_TAB.fx'],
    'Pulfrich_to_SBS_or_TAB':    ['Pulfrich_to_SBS_or_TAB.fx'],
    'Rendepth':                  ['Rendepth.fx'],   // MIT — cybereality
};

// Addons (.addon64/.addon32) needed per pipeline entry
const ADDON_FILES = {
    // Keys here tell installReshade to use copyAddons() instead of copyShaders()
    // Values are hints — resolveAddonFiles() will also do a filename scan for version flexibility
    '3DGameBridge': ['srReshade_v2.1.0.addon64', 'srReshade_v2.1.0.addon32'],
};

// Which pipeline steps need which shaders
const PIPELINE_SHADERS = {
    // ReShade shader steps — values are SHADER_FILES keys to copy to game dir
    '3DGameBridge':                        ['3DGameBridge'],       // addon, handled by copyAddons()
    'Refract':                             ['Refract'],
    '3DtoElse':                            ['3DtoElse'],
    '3DtoElse (Frame Packing)':            ['3DtoElse'],           // frame-packing preset
    '3DtoElse (Anaglyph GM)':              ['3DtoElse'],           // → green/magenta anaglyph
    '3DtoElse (Anaglyph AB)':              ['3DtoElse'],           // → amber/blue anaglyph
    '3DtoElse (Interleaved Row)':          ['3DtoElse'],           // → row-interleaved
    '3DtoElse (Interleaved Col)':          ['3DtoElse'],           // → column-interleaved
    '3DtoElse (Interleaved Checkerboard)': ['3DtoElse'],           // → checkerboard
    'Anaglyph_to_SBS_or_TAB':             ['Anaglyph_to_SBS_or_TAB'],
    'Anaglyph-to-SBS/TAB (FEZ variant)':  ['FEZ_Anaglyph_to_SBS_TAB'],
    'Limbo Anaglyph-to-SBS Shader':       ['Limbo_Anaglyph_to_SBS_TAB'],
    'ShaderGlass':                         [],    // external app — no .fx to copy
    // External tool steps — no shader files, just informational labels in the pipeline display
    'UEVR':                                [],
    'VRto3D':                              [],
    'XRGameBridge':                        [],
    'HoloUEVR Plugin':                     [],
    'PortalVR':                            [],
    'Katanga':                             [],
    'VRScreenCap':                         [],
    // Pipeline-display labels for external software layers (no .fx files)
    'ReShade':                             [],    // ReShade itself as a host in Vulkan chains
    'VRto3D (EK fork)':                    [],    // Evil___Kermit VRto3D variant
    'dgVoodoo2':                           [],    // DX8/9 → DX11 wrapper step
};

function getShadersForPipeline(pipelineSteps) {
    const shaders = new Set();
    (pipelineSteps || []).forEach(step => {
        (PIPELINE_SHADERS[step] || []).forEach(s => shaders.add(s));
    });
    return [...shaders];
}

// ── Core install ──────────────────────────────────────────────
function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function copyShaders(shaderNames, destDir, onProgress) {
    const bundleShaderDir = getBundledShaderDir();
    const steps = [];
    ensureDir(destDir);
    for (const name of shaderNames) {
        const files = SHADER_FILES[name] || [`${name}.fx`];
        for (const file of files) {
            // Look in shaders/ (headers) first, then shaders-src/ (fx files)
            const srcA = path.join(bundleShaderDir, file);
            const srcB = path.join(getBundledShaderSrcDir(), file);
            const src  = fs.existsSync(srcA) ? srcA : (fs.existsSync(srcB) ? srcB : srcA);
            const dest = path.join(destDir, file);
            if (!fs.existsSync(src)) {
                steps.push(`⚠ Shader file not found in bundle: ${file}`);
                onProgress({ stage: 'shader', status: 'missing', label: `Missing: ${file}`, percent: -1 });
                continue;
            }
            fs.copyFileSync(src, dest);
            steps.push(`Shader: ${file}`);
            onProgress({ stage: 'shader', status: 'copied', label: file, percent: -1 });
        }
    }
    return steps;
}

function getBundledAddonDir() {
    return path.join(getBundleRoot(), 'addons');
}

// Detect the actual versioned addon filename from the bundle
function resolveAddonFiles(addonName) {
    const addonDir = getBundledAddonDir();
    if (!fs.existsSync(addonDir)) return [];
    // Try exact names first
    const exact = ADDON_FILES[addonName] || [];
    const found = exact.filter(f => fs.existsSync(path.join(addonDir, f)));
    if (found.length) return found;
    // Fall back: scan for anything matching the addon name (handles version changes)
    const pattern = addonName.toLowerCase().replace(/[^a-z0-9]/g, '');
    return fs.readdirSync(addonDir).filter(f => {
        const base = f.toLowerCase().replace(/[^a-z0-9]/g, '');
        return (f.endsWith('.addon64') || f.endsWith('.addon32')) && base.includes(pattern);
    });
}

function copyAddons(addonNames, destDir, onProgress) {
    const steps = [];
    if (!addonNames || addonNames.length === 0) return steps;
    ensureDir(destDir);
    for (const name of addonNames) {
        const files = resolveAddonFiles(name);
        if (files.length === 0) {
            steps.push(`⚠ Addon not found in bundle: ${name}`);
            onProgress({ stage: 'addon', status: 'missing', label: `Missing addon: ${name}`, percent: -1 });
            continue;
        }
        for (const file of files) {
            const src  = path.join(getBundledAddonDir(), file);
            const dest = path.join(destDir, file);
            fs.copyFileSync(src, dest);
            steps.push(`Addon: ${file}`);
            onProgress({ stage: 'addon', status: 'copied', label: file, percent: -1 });
        }
    }
    return steps;
}

function writeReshadeIni(gamePath, hookDllName, shaderNames, addonNames = [], screenshotOptions = {}) {
    const lines = [
        '[GENERAL]',
        // Include bundle shaders dir so ReShade.fxh is always found even if copy fails
        `EffectSearchPaths=.\\reshade-shaders\\Shaders,${getBundledShaderDir()}`,
        `TextureSearchPaths=.\\reshade-shaders\\Textures,${path.join(getBundleRoot(), 'textures')}`,
    ];
    if (addonNames && addonNames.length > 0) {
        // AddonSearchPaths tells ReShade where to look for .addon64 files
        lines.push('AddonSearchPaths=.\\');
    }
    // Core ini settings
    const coreLines = [
        'PresetPath=.\\reshade-presets\\Stereopticon.ini',
        'PerformanceMode=0',
        'TutorialProgress=4',
        '',
        '[INPUT]',
        'KeyOverlay=36,0,0,0',
        'KeyScreenshot=44,0,0,0',  // Print Screen
        '',
        '[SCREENSHOT]',
        // Save path: game folder by default so screenshots stay with the game
     `SavePath=${screenshotOptions.savePath || '.\\'}`,
        `SaveFormat=${screenshotOptions.format || 'PNG'}`,
        // SaveBeforeUseEffects: 0=off, 1=before-only, 2=after-only, 4=both
        `SaveBeforeUseEffects=${screenshotOptions.beforeEffects ?? 0}`,
        '',
    ];    // Addon loading: ReShade 6.x requires each addon file to be explicitly
    // listed under [ADDON] to bypass the interactive security confirmation.
    // We resolve the actual filenames from the game folder.
    const addonLines = [];
    if (addonNames && addonNames.length > 0) {
        addonLines.push('[ADDON]');
        for (const addonName of addonNames) {
            // Use known addon filenames from ADDON_FILES map, then verify they
            // exist in the game folder. Falls back to a broad scan so version
            // bumps (e.g. srReshade_v2.2.0) are still found automatically.
            try {
                const gameFiles = fs.readdirSync(gamePath)
                    .filter(f => f.endsWith('.addon64') || f.endsWith('.addon32'));
                // 1. Known filenames from ADDON_FILES map
                const knownNames = ADDON_FILES[addonName] || [];
                const knownFound = knownNames.filter(n => gameFiles.includes(n));
                if (knownFound.length) {
                    knownFound.forEach(f => addonLines.push(`${f}=1`));
                } else {
                    // 2. Fuzzy fallback: addon name keywords present in filename
                    //    e.g. '3DGameBridge' → look for 'srreshade' OR '3dgamebridge'
                    const keywords = [
                        addonName.toLowerCase().replace(/[^a-z0-9]/g, ''),
                        // Add vendor aliases for known addons
                        ...(addonName === '3DGameBridge' ? ['srreshade', '3dgamebridge'] : []),
                    ];
                    const fuzzy = gameFiles.filter(f => {
                        const base = f.toLowerCase().replace(/[^a-z0-9]/g, '');
                        return keywords.some(k => base.includes(k));
                    });
                    fuzzy.forEach(f => addonLines.push(`${f}=1`));
                }
            } catch { /* gamePath not yet accessible — skip, user will accept prompt */ }
        }
        addonLines.push('');
    }
    const iniContent = lines.concat(coreLines).concat(addonLines).join('\r\n');
    fs.writeFileSync(path.join(gamePath, 'ReShade.ini'), iniContent);
    const presetDir = path.join(gamePath, 'reshade-presets');
    ensureDir(presetDir);
    const effects = shaderNames.map(s => `${s}.fx`).join(',');
    const presetContent = [
        'PreprocessorDefinitions=',
        `Effects=${effects}`,
        '',
        ...shaderNames.map(s => `[${s}.fx]`),
        '',
    ].join('\r\n');
    fs.writeFileSync(path.join(presetDir, 'Stereopticon.ini'), presetContent);
}

function patchGeo11ForReshade(gamePath, profile) {
    const iniPath = path.join(gamePath, profile.ini_file || 'd3dxdm.ini');
    if (!fs.existsSync(iniPath)) return { patched: false };
    let content = fs.readFileSync(iniPath, 'utf8');
    for (const line of ['proxy_d3d11 = 1', 'proxy_library = ReShade64.dll']) {
        const key = line.split('=')[0].trim();
        const re  = new RegExp(`^\\s*${key}\\s*=.*`, 'm');
        if (re.test(content)) content = content.replace(re, line);
        else content = content.includes('[Rendering]')
            ? content.replace('[Rendering]', `[Rendering]\n${line}`)
            : content + `\n${line}`;
    }
    fs.writeFileSync(iniPath, content);
    return { patched: true, iniPath };
}

// ── Main entry point ──────────────────────────────────────────
/**
 * installReshade — called at fix-install time.
 * All assets come from the bundle; no internet required.
 */
async function installReshade({ gamePath, exePath, profile, requiredShaders = [], geo11Installed = false, onProgress = () => {} }) {
    const steps = [];

    // 1. Validate bundle exists
    const bundledDll = getBundledDll(true);
    if (!fs.existsSync(bundledDll)) {
        return {
            success: false,
            message: `ReShade is not bundled in this installation.\nExpected: ${bundledDll}\n\nPlease re-install Stereopticon.`,
        };
    }

    // 2. Detect API
    onProgress({ stage: 'detect', status: 'detecting', label: 'Detecting graphics API…', percent: 5 });
    const apiInfo = detectGraphicsApi(gamePath, exePath, profile);
    steps.push(`API: ${apiInfo.api.toUpperCase()} (via ${apiInfo.source}) → ${apiInfo.hookDll || 'ShaderGlass (Vulkan)'}`);

    // Vulkan → can't inject in-process; caller should use ShaderGlass instead
    if (apiInfo.api === 'vulkan' || !apiInfo.hookDll) {
        return {
            success: false,
            message: `This game uses Vulkan — in-process ReShade injection is not possible.\nUse the ShaderGlass pipeline instead.`,
            requiresShaderGlass: true,
        };
    }

    // 3. Validate gamePath before touching filesystem
    if (!gamePath || !fs.existsSync(gamePath)) {
        return { success: false, message: `Game folder not found:\n${gamePath}\n\nCheck the Game Folder path in the app.` };
    }

    // 3b. Place ReShade DLL
    onProgress({ stage: 'install', status: 'placing', label: `Installing ReShade as ${apiInfo.hookDll}…`, percent: 20 });
    let hookDllName = apiInfo.hookDll;

    // Geo-11 conflict: both want dxgi.dll — keep ReShade as dxgi, patch Geo-11 to proxy through
    if (geo11Installed && (hookDllName === 'dxgi.dll' || hookDllName === 'd3d11.dll')) {
        hookDllName = 'dxgi.dll';
        steps.push('Geo-11 chain: ReShade → dxgi.dll, patching proxy settings');
        onProgress({ stage: 'install', status: 'chaining', label: 'Configuring Geo-11 → ReShade chain…', percent: 25 });
        const patch = patchGeo11ForReshade(gamePath, profile);
        if (patch.patched) steps.push(`Patched ${patch.iniPath}`);
    }

    fs.copyFileSync(bundledDll, path.join(gamePath, hookDllName));
    steps.push(`Placed ${hookDllName}`);
    onProgress({ stage: 'install', status: 'placed', label: `ReShade placed as ${hookDllName}`, percent: 40 });

    // 4a. Copy ALL bundled shaders (not just required ones) so ReShade has
    //     the full library available. The preset only enables the active ones.
    const shaderDestDir  = path.join(gamePath, 'reshade-shaders', 'Shaders');
    // Ensure ReShade.fxh is present in game's shader dir — download from GitHub if missing.
    // This runs async but we await it before the rest of install proceeds.
    try {
        const fxhResults = await ensureFxhInDir(shaderDestDir);
        for (const [f, r] of Object.entries(fxhResults)) {
            if (r === 'downloaded') onProgress({ stage: 'headers', status: 'complete', label: `${f} downloaded ✓`, percent: -1 });
            else if (r !== 'present') onProgress({ stage: 'headers', status: 'warn', label: `${f}: ${r}`, percent: -1 });
        }
        // Also ensure they're in the bundle shaders dir for future installs
        await ensureFxhInDir(getBundledShaderDir());
    } catch (fxhErr) {
        onProgress({ stage: 'headers', status: 'warn', label: `fxh download failed: ${fxhErr.message}`, percent: -1 });
    }
    const textureDestDir = path.join(gamePath, 'reshade-shaders', 'Textures');
    ensureDir(shaderDestDir);
    ensureDir(textureDestDir);
    onProgress({ stage: 'shaders', status: 'copying', label: 'Copying shaders…', percent: 45 });

    // Copy ALL shaders from bundle (full library)
    const bundleShaderDir   = getBundledShaderDir();
    const bundleTextureDir  = path.join(getBundleRoot(), 'textures');
    let shadersInstalled = 0;
    if (fs.existsSync(bundleShaderDir)) {
        for (const f of fs.readdirSync(bundleShaderDir)) {
            if (f.endsWith('.fx') || f.endsWith('.fxh')) {
                fs.copyFileSync(path.join(bundleShaderDir, f), path.join(shaderDestDir, f));
                shadersInstalled++;
            }
        }
    }
    // Copy ReShade standard headers — required at compile time by all .fx shaders.
    // Checked in order: bundle root → bundled shaders dir → permanent installer cache.
    const installerCacheDir = path.join(getBundleRoot(), 'cache');
    for (const fxh of ['ReShade.fxh', 'ReShadeUI.fxh']) {
        const destFxh = path.join(shaderDestDir, fxh);
        const candidates = [
            path.join(getBundleRoot(), fxh),
            path.join(getBundledShaderDir(), fxh),
        ];
        const headerSrc = candidates.find(p => fs.existsSync(p));
        if (headerSrc) {
            fs.copyFileSync(headerSrc, destFxh);
            onProgress({ stage: 'headers', status: 'complete', label: `${fxh} ✓`, percent: -1 });
        } else {
            // Last resort: extract directly from cached installer
            try {
                const cacheFiles = fs.existsSync(installerCacheDir) ? fs.readdirSync(installerCacheDir) : [];
                const installer  = cacheFiles.find(f => f.startsWith('ReShade_Setup_') && f.endsWith('.exe'));
                if (installer) {
                    const sevenZip = require('child_process').spawnSync(
                        'where', ['7z.exe'], { encoding: 'utf8' }).stdout?.trim()?.split('\n')[0]?.trim()
                        || 'C:\\Program Files\\7-Zip\\7z.exe';
                    const fxhExtractTmp = path.join(require('os').tmpdir(), 'stereo-fxh-tmp');
                    require('fs').mkdirSync(fxhExtractTmp, { recursive: true });
                    require('child_process').spawnSync(
                        sevenZip, ['e', path.join(installerCacheDir, installer), '-y', `-o${fxhExtractTmp}`],
                        { encoding: 'utf8' });
                    const extracted = require('path').join(fxhExtractTmp, fxh);
                    if (require('fs').existsSync(extracted)) {
                        require('fs').copyFileSync(extracted, destFxh);
                    }
                    if (fs.existsSync(destFxh)) {
                        onProgress({ stage: 'headers', status: 'complete', label: `${fxh} extracted ✓`, percent: -1 });
                    } else {
                        onProgress({ stage: 'headers', status: 'warn', label: `${fxh} missing — run npm run setup`, percent: -1 });
                    }
                } else {
                    onProgress({ stage: 'headers', status: 'warn', label: `${fxh} not in bundle — run npm run setup`, percent: -1 });
                }
            } catch (fxhErr) {
                onProgress({ stage: 'headers', status: 'warn', label: `${fxh} copy failed: ${fxhErr.message}`, percent: -1 });
            }
        }
    }
    if (fs.existsSync(bundleTextureDir)) {
        for (const f of fs.readdirSync(bundleTextureDir)) {
            fs.copyFileSync(path.join(bundleTextureDir, f), path.join(textureDestDir, f));
        }
    }
    steps.push(`Shaders: ${shadersInstalled} files copied from bundle`);
    onProgress({ stage: 'shaders', status: 'copied', label: `${shadersInstalled} shaders copied`, percent: 60 });

    // actualShaders = what to *enable* in the preset (addon entries excluded)
    const actualShaders = requiredShaders.filter(s => !ADDON_FILES[s]);
    const shaderSteps   = [];   // no need to copy individually — already done above

    // 4b. Copy addons next to the ReShade DLL (ReShade scans the game folder for .addon64 files)
    const addonNames = requiredShaders.filter(s => ADDON_FILES[s]);
    if (addonNames.length > 0) {
        onProgress({ stage: 'addons', status: 'copying', label: 'Copying addons…', percent: 70 });
        const addonSteps = copyAddons(addonNames, gamePath, onProgress);
        steps.push(...addonSteps);
    }

    // 5. Write config
    onProgress({ stage: 'config', status: 'writing', label: 'Writing configuration…', percent: 85 });
    writeReshadeIni(gamePath, hookDllName, actualShaders, addonNames);
    steps.push('Wrote ReShade.ini');
    steps.push('Wrote reshade-presets/Stereopticon.ini');

    onProgress({ stage: 'done', status: 'complete', label: 'ReShade configured', percent: 100 });

    return {
        success:    true,
        hookDll:    hookDllName,
        api:        apiInfo.api,
        geo11Chain: geo11Installed,
        shaders:    requiredShaders,
        steps,
        message: `ReShade installed as ${hookDllName}\nShaders: ${requiredShaders.join(', ') || 'none'}${geo11Installed ? '\nGeo-11 chain configured' : ''}`,
    };
}

// ── Status check ──────────────────────────────────────────────
function detectReShadeInstall(gamePath) {
    if (!gamePath || !fs.existsSync(gamePath)) return { found: false };
    for (const dll of ['dxgi.dll', 'd3d11.dll', 'd3d9.dll', 'd3d12.dll', 'opengl32.dll']) {
        const p = path.join(gamePath, dll);
        if (!fs.existsSync(p)) continue;
        try {
            if (fs.readFileSync(p).includes('ReShade')) {
                return { found: true, dllName: dll, hasConfig: fs.existsSync(path.join(gamePath, 'ReShade.ini')) };
            }
        } catch {}
    }
    return { found: false };
}

function getReshadeStatus(gamePath, profile) {
    const r = detectReShadeInstall(gamePath);
    if (!r.found) return { installed: false };
    return {
        installed:  true,
        hookDll:    r.dllName,
        hasConfig:  r.hasConfig,
        hasPreset:  fs.existsSync(path.join(gamePath, 'reshade-presets', 'Stereopticon.ini')),
        hasShaders: fs.existsSync(path.join(gamePath, 'reshade-shaders', 'Shaders')),
    };
}

function isBundlePresent() {
    return fs.existsSync(getBundledDll(true));
}

/**
 * writeReshadePreset — update only the preset file to enable/disable shaders.
 * Called when the user changes output mode after ReShade is already installed.
 */
function writeReshadePreset(gamePath, shaderNames) {
    const presetDir = path.join(gamePath, 'reshade-presets');
    ensureDir(presetDir);
    const effects = shaderNames.map(s => `${s}.fx`).join(',');
    const presetContent = [
        'PreprocessorDefinitions=',
        `Effects=${effects}`,
        '',
        ...shaderNames.map(s => `[${s}.fx]\nenabled=1`),
        '',
    ].join('\r\n');
    fs.writeFileSync(path.join(presetDir, 'Stereopticon.ini'), presetContent);
}

module.exports = {
    installReshade,
    writeReshadePreset,
    detectReShadeInstall,
    detectGraphicsApi,
    getReshadeStatus,
    getShadersForPipeline,
    isBundlePresent,
    getBundleRoot,
    PIPELINE_SHADERS,
    SHADER_FILES,
    API_TO_DLL,
};