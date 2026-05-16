#!/usr/bin/env node
/**
 * scripts/download-tools.js
 * Downloads all third-party tools and shaders required by Stereopticon.
 *
 * Usage:  node scripts/download-tools.js          (skip if cached)
 *         node scripts/download-tools.js --force  (re-download everything)
 * npm:    "setup":       "node scripts/download-tools.js"
 *         "setup:force": "node scripts/download-tools.js --force"
 *
 * Downloads:
 *   ReShade         — reshade.me (latest addon build)
 *   UEVR            — github.com/praydog/UEVR (latest)
 *   VRto3D          — github.com/oneup03/VRto3D (latest, SteamVR driver)
 *   XRGameBridge    — github.com/JoeyAnthony/XRGameBridge (latest, OpenXR driver, SR displays only)
 *   3DGameBridge    — github.com/JoeyAnthony/3DGameBridgeProjects (ReShade addon, SR Weave)
 *   dgVoodoo2       — github.com/dege-diosg/dgVoodoo2 (DX8/9→DX11 translation)
 *   RenDepth        — github.com/outmode/rendepth-reshade (2D→3D depth shader)
 *
 * Requires: 7-Zip installed (https://www.7-zip.org/)
 */
'use strict';

const fs            = require('fs');
const path          = require('path');
const https         = require('https');
const { execFileSync, execSync, spawnSync } = require('child_process');
const os            = require('os');

// ── Directory layout ──────────────────────────────────────────
const PROJECT_ROOT    = path.join(__dirname, '..');
const RESHADE_DIR     = path.join(PROJECT_ROOT, 'resources', 'reshade');
const SHADERS_DIR     = path.join(RESHADE_DIR,  'shaders');      // ReShade.fxh headers only
const SHADERS_SRC_DIR = path.join(RESHADE_DIR,  'shaders-src');  // game-specific .fx files
const ADDONS_DIR      = path.join(RESHADE_DIR,  'addons');       // .addon64/.addon32 files
const CACHE_DIR       = path.join(RESHADE_DIR,  'cache');        // permanent download cache
const TMP_DIR         = path.join(os.tmpdir(),  'stereopticon-setup');
const VERSION_FILE    = path.join(RESHADE_DIR,  'VERSION');

const UEVR_DIR        = path.join(PROJECT_ROOT, 'resources', 'uevr');
const DGVOODOO_DIR    = path.join(PROJECT_ROOT, 'resources', 'dgvoodoo2');
const XRGB_DIR        = path.join(PROJECT_ROOT, 'resources', 'xrgamebridge');
const WIZ3D_DIR       = path.join(PROJECT_ROOT, 'resources', 'wiz3d');
const OPENTRACK_DIR   = path.join(PROJECT_ROOT, 'resources', 'opentrack');

const FORCE = process.argv.includes('--force');

// ── Game-specific shader sources ──────────────────────────────
// Installed on-demand by installFix(), not during global setup.
// Add entries here only for generic conversion shaders useful across many games.
const GAME_SHADER_SOURCES = {};

// ── Direct-URL addon downloads ────────────────────────────────
const DIRECT_ADDON_SOURCES = {
    '3DGameBridge': {
        url:  'https://github.com/JoeyAnthony/3DGameBridgeProjects/releases/latest/download/srReshade.zip',
        desc: '3DGameBridge ReShade addon (SR Weave output)',
    },
};

// ── Shader zip packages ───────────────────────────────────────
const SHADER_ZIP_SOURCES = {
    'Rendepth': {
        url:  'https://github.com/outmode/rendepth-reshade/archive/refs/heads/main.zip',
        desc: 'RenDepth (2D→3D depth-map shader, MIT)',
        extract: [
            ['rendepth-reshade-main/Shaders/Rendepth.fx',     'shaders',  'Rendepth.fx'],
            ['rendepth-reshade-main/Shaders/Cursor_64px.png', 'textures', 'Cursor_64px.png', true],
        ],
    },
};

// ── Utilities ─────────────────────────────────────────────────
function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function find7z() {
    for (const p of [
        path.join(PROJECT_ROOT, 'bin', '7z.exe'),
        'C:\\Program Files\\7-Zip\\7z.exe',
        'C:\\Program Files (x86)\\7-Zip\\7z.exe',
    ]) { if (fs.existsSync(p)) return p; }
    try { execSync('7z i', { stdio: 'ignore' }); return '7z'; } catch {}
    throw new Error('7z.exe not found. Install 7-Zip from https://www.7-zip.org/');
}

function log(msg)  { process.stdout.write(`  ${msg}\n`); }
function step(msg) { process.stdout.write(`\n▸ ${msg}\n`); }

function httpGet(urlStr, extraHeaders = {}) {
    return new Promise((resolve, reject) => {
        const doGet = (u) => {
            const parsed = new URL(u);
            https.get({
                hostname: parsed.hostname, port: parsed.port || 443,
                path: parsed.pathname + parsed.search,
                headers: { 'User-Agent': 'Stereopticon-setup/1.0', ...extraHeaders },
            }, res => {
                if (res.statusCode === 301 || res.statusCode === 302)
                    return doGet(res.headers.location);
                if (res.statusCode !== 200)
                    return reject(new Error(`HTTP ${res.statusCode} for ${u}`));
                const chunks = [];
                res.on('data', c => chunks.push(c));
                res.on('end', () => resolve(Buffer.concat(chunks)));
                res.on('error', reject);
            }).on('error', reject);
        };
        doGet(urlStr);
    });
}

function downloadFile(urlStr, dest, extraHeaders = {}) {
    return new Promise((resolve, reject) => {
        const doGet = (u) => {
            const parsed = new URL(u);
            https.get({
                hostname: parsed.hostname, port: parsed.port || 443,
                path: parsed.pathname + parsed.search,
                headers: { 'User-Agent': 'Stereopticon-setup/1.0', ...extraHeaders },
            }, res => {
                if (res.statusCode === 301 || res.statusCode === 302) return doGet(res.headers.location);
                if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}: ${u}`));
                const total = parseInt(res.headers['content-length'] || '0', 10);
                let received = 0;
                const out = fs.createWriteStream(dest);
                res.on('data', chunk => {
                    received += chunk.length;
                    out.write(chunk);
                    if (total > 0) process.stdout.write(
                        `\r    ${Math.round(received/total*100)}%  (${(received/1024/1024).toFixed(1)}/${(total/1024/1024).toFixed(1)} MB)  `
                    );
                });
                res.on('end', () => {
                    out.end();
                    out.on('close', () => {
                        process.stdout.write('\r    Done.                              \n');
                        resolve(dest);
                    });
                });
                res.on('error', reject);
                out.on('error', reject);
            }).on('error', reject);
        };
        doGet(urlStr);
    });
}

// Fetch the latest GitHub release for a repo, return { tag_name, assets[] }
async function getLatestGithubRelease(repo) {
    const raw = await httpGet(`https://api.github.com/repos/${repo}/releases/latest`,
        { 'Accept': 'application/vnd.github+json' });
    return JSON.parse(raw.toString());
}

// ── ReShade ───────────────────────────────────────────────────
async function getLatestReshadeVersion() {
    log('Checking reshade.me for latest version…');
    const html = (await httpGet('https://reshade.me/', { 'Referer': 'https://reshade.me/' })).toString();
    const match = html.match(/Version\s+([\d.]+)\s+was released/i)
                || html.match(/ReShade_Setup_([\d.]+)_Addon\.exe/i)
                || html.match(/ReShade_Setup_([\d.]+)\.exe/i);
    if (!match) throw new Error('Could not parse ReShade version from reshade.me.');
    return match[1];
}

async function downloadReshade(sevenZip) {
    step('Fetching latest ReShade from reshade.me…');
    const version = await getLatestReshadeVersion();
    log(`Latest ReShade: ${version}`);

    if (!FORCE && fs.existsSync(VERSION_FILE)) {
        const cached = fs.readFileSync(VERSION_FILE, 'utf8').trim();
        if (cached === version && fs.existsSync(path.join(RESHADE_DIR, 'ReShade64.dll'))) {
            log(`Already at ${version}. Use --force to re-download.`);
            if (!fs.existsSync(path.join(SHADERS_DIR, 'ReShade.fxh'))) {
                await downloadReshadeHeaders();
            } else {
                log('  ReShade.fxh present ✓');
            }
            return version;
        }
    }

    const addonUrl = `https://reshade.me/downloads/ReShade_Setup_${version}_Addon.exe`;
    const stdUrl   = `https://reshade.me/downloads/ReShade_Setup_${version}.exe`;
    const referer  = { 'Referer': 'https://reshade.me/' };
    const installerPath = path.join(TMP_DIR, `ReShade_Setup_${version}_Addon.exe`);

    log(`Downloading ReShade ${version} (Addon build)…`);
    try { await downloadFile(addonUrl, installerPath, referer); }
    catch { log('Addon build unavailable, trying standard build…'); await downloadFile(stdUrl, installerPath, referer); }

    ensureDir(CACHE_DIR);
    const cachedInstaller = path.join(CACHE_DIR, path.basename(installerPath));
    if (!fs.existsSync(cachedInstaller)) { try { fs.copyFileSync(installerPath, cachedInstaller); } catch {} }

    log('Extracting ReShade DLLs with 7-Zip…');
    const extractTo = path.join(TMP_DIR, 'reshade-extract');
    ensureDir(extractTo);

    const tryExtract = (attempt = 1) => new Promise((res, rej) => {
        const args = attempt < 3
            ? ['e', installerPath, '-o' + extractTo, 'ReShade64.dll', 'ReShade32.dll', '-y']
            : ['e', installerPath, '-o' + extractTo, '-t#', 'ReShade64.dll', 'ReShade32.dll', '-y'];
        try { execFileSync(sevenZip, args, { stdio: 'pipe' }); res(); }
        catch (e) {
            const msg = e.stderr?.toString() || e.message || '';
            if (attempt < 4 && (msg.includes('being used') || msg.includes('Cannot open'))) {
                log(`  Attempt ${attempt} failed — retrying in ${attempt}s…`);
                setTimeout(() => tryExtract(attempt + 1).then(res).catch(rej), attempt * 1000);
            } else { rej(new Error(`7-Zip failed after ${attempt} attempts:\n${msg}`)); }
        }
    });
    await tryExtract();

    let copied = 0;
    for (const dll of ['ReShade64.dll', 'ReShade32.dll']) {
        const src = path.join(extractTo, dll);
        if (fs.existsSync(src)) { fs.copyFileSync(src, path.join(RESHADE_DIR, dll)); log(`  → ${dll}`); copied++; }
    }
    if (copied === 0) throw new Error('No ReShade DLLs extracted.');

    await downloadReshadeHeaders();
    fs.writeFileSync(VERSION_FILE, version);
    log(`ReShade ${version} installed ✓`);
    return version;
}

async function downloadReshadeHeaders() {
    ensureDir(SHADERS_DIR);
    const FXH = {
        'ReShade.fxh':   'https://raw.githubusercontent.com/crosire/reshade-shaders/master/Shaders/ReShade.fxh',
        'ReShadeUI.fxh': 'https://raw.githubusercontent.com/crosire/reshade-shaders/master/Shaders/ReShadeUI.fxh',
    };
    for (const [filename, url] of Object.entries(FXH)) {
        try {
            const dest = path.join(SHADERS_DIR, filename);
            await downloadFile(url, dest);
            log(`  → shaders/${filename}`);
        } catch (e) { log(`  ⚠ ${filename} download failed: ${e.message}`); }
    }
}

// ── UEVR ──────────────────────────────────────────────────────
// praydog's official release. No forks needed — the official build supports
// monitor mode via VRto3D/XRGameBridge output.
async function downloadUEVR() {
    step('Downloading UEVR (praydog official)…');
    ensureDir(UEVR_DIR);

    // Files we need from the UEVR.zip release
    const UEVR_FILES = [
        'UEVRInjector.exe', 'UEVRPluginNullifier.dll', 'UEVRInjector.dll.config',
        'UEVRBackend.dll', 'openvr_api.dll', 'openxr_loader.dll', 'LuaVR.dll',
    ];

    if (!FORCE && UEVR_FILES.every(f => fs.existsSync(path.join(UEVR_DIR, f)))) {
        log('  UEVR already present ✓');
        return;
    }

    let zipUrl, tagName;
    try {
        const release = await getLatestGithubRelease('praydog/UEVR');
        const asset   = release.assets?.find(a => a.name === 'UEVR.zip');
        if (!asset) throw new Error('UEVR.zip not in release assets');
        zipUrl  = asset.browser_download_url;
        tagName = release.tag_name;
        log(`  Latest UEVR: ${tagName}`);
    } catch (e) {
        log(`  ⚠ GitHub API failed (${e.message}) — using known fallback`);
        tagName = '1.05';
        zipUrl  = `https://github.com/praydog/UEVR/releases/download/${tagName}/UEVR.zip`;
    }

    ensureDir(CACHE_DIR);
    const cachePath = path.join(CACHE_DIR, `uevr-${tagName}.zip`);
    if (FORCE || !fs.existsSync(cachePath)) {
        log(`  Downloading UEVR.zip (${tagName})…`);
        await downloadFile(zipUrl, cachePath);
    } else {
        log(`  Using cached UEVR.zip (${tagName})`);
    }

    const sevenZip = find7z();
    const tmp      = path.join(TMP_DIR, 'uevr-extract');
    if (fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true });
    ensureDir(tmp);

    try {
        execFileSync(sevenZip, ['e', cachePath, '-o' + tmp, ...UEVR_FILES, '-y'], { stdio: 'pipe' });
    } catch (e) { log(`  ⚠ 7-Zip warning: ${(e.stderr?.toString()||'').slice(0,120)}`); }

    let count = 0;
    for (const f of UEVR_FILES) {
        const src = path.join(tmp, f);
        if (fs.existsSync(src)) { fs.copyFileSync(src, path.join(UEVR_DIR, f)); log(`  → ${f}`); count++; }
    }
    if (count === 0) log('  ✗ No UEVR files extracted — check github.com/praydog/UEVR/releases');
    else log(`  UEVR ${tagName} installed ✓`);
}

// ── VRto3D ────────────────────────────────────────────────────
// SteamVR virtual HMD driver — renders SBS/TAB/interlaced output on flat 3D displays.
// Works with any VR mod (UEVR, REFramework, etc.) and all 3D display types.
// Installed to SteamVR/drivers/vrto3d/ — user must launch SteamVR once after install.
async function downloadVRto3D() {
    step('Downloading VRto3D (oneup03 official)…');

    const steamVRDir = [
        path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Steam', 'steamapps', 'common', 'SteamVR', 'drivers'),
        path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Steam', 'steamapps', 'common', 'SteamVR', 'drivers'),
        path.join(os.homedir(), 'AppData', 'Local', 'Steam', 'steamapps', 'common', 'SteamVR', 'drivers'),
    ].find(d => fs.existsSync(d));

    if (!steamVRDir) {
        log('  ⚠ SteamVR not found — install SteamVR first, then re-run setup.');
        log('    VRto3D will not be installed.');
        return;
    }

    const target = path.join(steamVRDir, 'vrto3d');
    if (!FORCE && fs.existsSync(target)) { log('  VRto3D already present ✓'); return; }

    let zipUrl, tagName;
    try {
        const release = await getLatestGithubRelease('oneup03/VRto3D');
        const asset   = release.assets?.find(a => a.name === 'VRto3D.zip');
        if (!asset) throw new Error('VRto3D.zip not in release assets');
        zipUrl  = asset.browser_download_url;
        tagName = release.tag_name;
        log(`  Latest VRto3D: ${tagName}`);
    } catch (e) {
        log(`  ⚠ GitHub API failed (${e.message}) — using known fallback`);
        tagName = 'V4.0.2';
        zipUrl  = `https://github.com/oneup03/VRto3D/releases/download/${tagName}/VRto3D.zip`;
    }

    ensureDir(CACHE_DIR);
    const cachePath = path.join(CACHE_DIR, `vrto3d-${tagName}.zip`);
    if (FORCE || !fs.existsSync(cachePath)) {
        log('  Downloading VRto3D.zip…');
        await downloadFile(zipUrl, cachePath);
    } else { log(`  Using cached VRto3D.zip (${tagName})`); }

    const sevenZip = find7z();
    const tmp      = path.join(TMP_DIR, 'vrto3d-extract');
    if (fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true });
    ensureDir(tmp);

    try { execFileSync(sevenZip, ['x', cachePath, '-o' + tmp, '-y'], { stdio: 'pipe' }); }
    catch (e) { log(`  ⚠ 7-Zip warning: ${(e.stderr?.toString()||'').slice(0,120)}`); }

    function copyDir(src, dest) {
        if (!fs.existsSync(src)) return 0;
        ensureDir(dest);
        let n = 0;
        for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
            const s = path.join(src, ent.name), d = path.join(dest, ent.name);
            if (ent.isDirectory()) { n += copyDir(s, d); }
            else { fs.copyFileSync(s, d); n++; }
        }
        return n;
    }

    // Zip may have a vrto3d/ subfolder or extract flat
    const inner = path.join(tmp, 'vrto3d');
    const count = fs.existsSync(inner) ? copyDir(inner, target) : copyDir(tmp, target);
    log(`  VRto3D ${tagName} installed → ${target} (${count} files)`);
}

// ── XRGameBridge ──────────────────────────────────────────────
// OpenXR runtime driver for SR (Simulated Reality) displays.
// Unlike VRto3D (SteamVR driver), XRGameBridge uses OpenXR directly.
// SR displays only (Acer SpatialLabs, Asus Spatial Vision, Samsung Odyssey 3D).
// Games/mods that support OpenXR can use this instead of VRto3D for lower latency.
async function downloadXRGameBridge() {
    step('Downloading XRGameBridge (OpenXR SR driver)…');
    ensureDir(XRGB_DIR);

    // XRGameBridge is from the same author as 3DGameBridgeProjects (JoeyAnthony / 3DNovum)
    // Repo: github.com/JoeyAnthony/XRGameBridge
    // NOTE: If this repo doesn't exist yet or has a different name, update the URL below.
    let zipUrl  = 'https://github.com/JoeyAnthony/XRGameBridge/releases/download/v0.1.0/XRGB_v0.1.0.zip';
    let tagName = 'v0.1.0';
    try {
        const raw      = await httpGet('https://api.github.com/repos/JoeyAnthony/XRGameBridge/releases',
            { 'Accept': 'application/vnd.github+json' });
        const releases = JSON.parse(raw.toString());
        const latest   = releases?.[0];
        const asset    = latest?.assets?.find(a => a.name.endsWith('.zip'));
        if (asset) { zipUrl = asset.browser_download_url; tagName = latest.tag_name; }
        log(`  Latest XRGameBridge: ${tagName}`);
    } catch (e) {
        log(`  Using known XRGameBridge release: ${tagName}`);
        log(`  ⚠ XRGameBridge download failed: ${e.message}`);
        log('    XRGameBridge is only needed for SR displays (Acer SpatialLabs, etc.).');
        log('    Download manually from github.com/JoeyAnthony/XRGameBridge/releases');
        log('    and extract to resources/xrgamebridge/');
        return;
    }

    ensureDir(CACHE_DIR);
    const cachePath = path.join(CACHE_DIR, `xrgamebridge-${tagName}.zip`);
    if (FORCE || !fs.existsSync(cachePath)) {
        log('  Downloading XRGameBridge…');
        await downloadFile(zipUrl, cachePath);
    } else { log(`  Using cached XRGameBridge (${tagName})`); }

    const sevenZip = find7z();
    const tmp      = path.join(TMP_DIR, 'xrgb-extract');
    if (fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true });
    ensureDir(tmp);

    try { execFileSync(sevenZip, ['x', cachePath, '-o' + tmp, '-y'], { stdio: 'pipe' }); }
    catch (e) { log(`  ⚠ 7-Zip warning: ${(e.stderr?.toString()||'').slice(0,120)}`); }

    // Copy everything to xrgamebridge dir
    let count = 0;
    function copyAll(src, dest) {
        if (!fs.existsSync(src)) return;
        ensureDir(dest);
        for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
            const s = path.join(src, ent.name), d = path.join(dest, ent.name);
            if (ent.isDirectory()) copyAll(s, d);
            else { fs.copyFileSync(s, d); count++; }
        }
    }
    copyAll(tmp, XRGB_DIR);
    if (count > 0) log(`  XRGameBridge ${tagName} installed ✓ (${count} files)`);
    else log('  ⚠ No files extracted from XRGameBridge zip');
}

// ── dgVoodoo2 ─────────────────────────────────────────────────
// DX8/DX9 → DX11 translation layer for older games.
// Installed to resources/dgvoodoo2/{x64,x86}/ — installFix() copies DLLs per-game.
async function downloadDgVoodoo2() {
    step('Downloading dgVoodoo2…');

    const markerFile = path.join(DGVOODOO_DIR, 'x64', 'D3D9.dll');
    if (!FORCE && fs.existsSync(markerFile)) { log('  dgVoodoo2 already present ✓'); return; }

    // No GitHub API for dgVoodoo2 — hardcoded to latest known release.
    // Update URL when dege ships a new version: github.com/dege-diosg/dgVoodoo2/releases
    const URL   = 'https://github.com/dege-diosg/dgVoodoo2/releases/download/v2.86.5/dgVoodoo2_86_5.zip';
    const CACHE = path.join(CACHE_DIR, 'dgVoodoo2_86_5.zip');

    ensureDir(CACHE_DIR);
    try {
        if (FORCE || !fs.existsSync(CACHE)) {
            log('  Downloading dgVoodoo2…');
            await downloadFile(URL, CACHE);
        } else { log('  Using cached dgVoodoo2'); }

        ensureDir(DGVOODOO_DIR);
        const sevenZip = find7z();
        const tmp      = path.join(TMP_DIR, 'dgvoodoo2-extract');
        if (fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true });
        ensureDir(tmp);
        execFileSync(sevenZip, ['x', CACHE, '-o' + tmp, '-y'], { stdio: 'pipe' });

        // dgVoodoo2 zip structure: MS/x86_x64/ (64-bit) and MS/x86/ (32-bit)
        const x64src = path.join(tmp, 'MS', 'x86_x64');
        const x86src = path.join(tmp, 'MS', 'x86');
        ensureDir(path.join(DGVOODOO_DIR, 'x64'));
        ensureDir(path.join(DGVOODOO_DIR, 'x86'));

        for (const f of ['D3D8.dll', 'D3D9.dll', 'D3DImm.dll', 'DDraw.dll']) {
            if (fs.existsSync(path.join(x64src, f))) {
                fs.copyFileSync(path.join(x64src, f), path.join(DGVOODOO_DIR, 'x64', f));
                log(`  → x64/${f}`);
            }
            if (fs.existsSync(path.join(x86src, f))) {
                fs.copyFileSync(path.join(x86src, f), path.join(DGVOODOO_DIR, 'x86', f));
                log(`  → x86/${f}`);
            }
        }

        const conf = path.join(tmp, 'dgVoodoo.conf');
        if (fs.existsSync(conf)) {
            fs.copyFileSync(conf, path.join(DGVOODOO_DIR, 'dgVoodoo.conf'));
            log('  → dgVoodoo.conf');
        }
        log('  dgVoodoo2 installed ✓');
    } catch (e) {
        log(`  ⚠ dgVoodoo2 download failed: ${e.message}`);
        log('    Download manually from github.com/dege-diosg/dgVoodoo2/releases');
        log('    and extract MS/x86_x64/ to resources/dgvoodoo2/x64/');
    }
}

// ── Direct addon download ─────────────────────────────────────
// ── wiz3D ─────────────────────────────────────────────────────
// Per-API stereo-3D injection wrappers (effcol). Five wrapper variants
// (dx7, dx8, dx9, dx10-11, dx12, vulkan), plus three capture-and-reroute
// variants (3d-vision-direct, hd3d, opengl-quad-buffer-stereo). Each variant
// has its own per-arch (x86/x64) DLL set. Staging:
//
//     resources/wiz3d/
//       dx9/{x86,x64}/{d3d9.dll, S3DWrapperD3D9.dll, wiz3D_Config.xml, ...}
//       dx10-11/{x86,x64}/...
//       opengl-quad-buffer-stereo/{x86,x64}/...
//       3d-vision-direct/{dx9,dx10,dx11}/{x86,x64}/...
//       hd3d/{x86,x64}/...
//       ...
//
// At fix-install time, modules/installer.js picks the right variant + arch
// folder and copies its contents into the game folder next to the .exe.
//
// Dev convenience: if lib/wiz3D build/wiz3D/ exists (developer reference,
// gitignored), copy from there instead of fetching from GitHub. Pass
// --no-lib to force the GitHub-release path even when lib/ is present.
async function downloadWiz3D(sevenZip) {
    step('Downloading wiz3D (effcol)…');
    ensureDir(WIZ3D_DIR);

    const markerFile = path.join(WIZ3D_DIR, '.installed');
    if (!FORCE && fs.existsSync(markerFile)) {
        log('  wiz3D already present ✓');
        return;
    }

    // Dev fallback: lib/wiz3D build/wiz3D/ (gitignored dev reference, not redistributed)
    const libBuild = path.join(PROJECT_ROOT, 'lib', 'wiz3D build', 'wiz3D');
    if (fs.existsSync(libBuild) && !process.argv.includes('--no-lib')) {
        log('  Using lib/wiz3D build/ (dev fallback — bypassing GitHub fetch)');
        copyDirRecursiveSync(libBuild, WIZ3D_DIR);
        fs.writeFileSync(markerFile, `from lib/wiz3D build/ at ${new Date().toISOString()}\n`);
        log('  wiz3D staged from dev reference ✓');
        return;
    }

    // Production path: GitHub release
    let zipUrl, tagName;
    try {
        const release = await getLatestGithubRelease('effcol/wiz3D');
        const asset = release.assets?.find(a => a.name.toLowerCase().endsWith('.zip'));
        if (!asset) throw new Error('no .zip asset in latest wiz3D release');
        zipUrl  = asset.browser_download_url;
        tagName = release.tag_name;
        log(`  Latest wiz3D: ${tagName}`);
    } catch (e) {
        log(`  ⚠ Could not fetch wiz3D release (${e.message})`);
        log('    wiz3D fixes will be unavailable. Re-run `npm run setup` when a release is published,');
        log('    or drop a build at lib/wiz3D build/wiz3D/ for dev use.');
        return;
    }

    ensureDir(CACHE_DIR);
    const cachePath = path.join(CACHE_DIR, `wiz3D-${tagName}.zip`);
    if (FORCE || !fs.existsSync(cachePath)) {
        log(`  Downloading wiz3D ${tagName}…`);
        await downloadFile(zipUrl, cachePath);
    } else {
        log(`  Using cached wiz3D ${tagName}`);
    }

    // Extract with paths preserved (per-API/arch folder structure matters)
    try {
        execFileSync(sevenZip, ['x', cachePath, '-o' + WIZ3D_DIR, '-y'], { stdio: 'pipe' });
    } catch (e) {
        log(`  ⚠ 7-Zip extract warning: ${(e.stderr?.toString() || '').slice(0, 120)}`);
    }

    // Some releases nest contents under a top-level "wiz3D/" folder — flatten if so
    const innerWiz = path.join(WIZ3D_DIR, 'wiz3D');
    if (fs.existsSync(innerWiz)) {
        for (const entry of fs.readdirSync(innerWiz, { withFileTypes: true })) {
            fs.renameSync(path.join(innerWiz, entry.name), path.join(WIZ3D_DIR, entry.name));
        }
        try { fs.rmdirSync(innerWiz); } catch {}
    }

    fs.writeFileSync(markerFile, `${tagName} at ${new Date().toISOString()}\n`);
    log(`  wiz3D ${tagName} installed ✓`);
}

async function downloadOpenTrack(sevenZip) {
    step('Downloading OpenTrack…');
    ensureDir(OPENTRACK_DIR);

    const markerFile = path.join(OPENTRACK_DIR, '.installed');
    if (!FORCE && fs.existsSync(markerFile)) {
        log('  OpenTrack already present ✓');
        return;
    }

    // Dev fallback — lib/opentrack/ (gitignored)
    const libCopy = path.join(PROJECT_ROOT, 'lib', 'opentrack');
    if (fs.existsSync(libCopy) && fs.existsSync(path.join(libCopy, 'opentrack.exe')) && !process.argv.includes('--no-lib')) {
        log('  Using lib/opentrack/ (dev fallback — bypassing GitHub fetch)');
        copyDirRecursiveSync(libCopy, OPENTRACK_DIR);
        fs.writeFileSync(markerFile, `from lib/opentrack/ at ${new Date().toISOString()}\n`);
        log('  OpenTrack staged from dev reference ✓');
        return;
    }

    // Prefer the .7z asset (silent extraction) over the .exe installer (interactive).
    let assetUrl, tagName;
    try {
        const release = await getLatestGithubRelease('opentrack/opentrack');
        const asset = release.assets?.find(a => /win64\.7z$/i.test(a.name))
                   || release.assets?.find(a => /win64.*\.zip$/i.test(a.name));
        if (!asset) throw new Error('no win64 .7z/.zip asset in latest OpenTrack release');
        assetUrl = asset.browser_download_url;
        tagName  = release.tag_name;
        log(`  Latest OpenTrack: ${tagName}`);
    } catch (e) {
        log(`  ⚠ Could not fetch OpenTrack release (${e.message})`);
        log('    Headtracking hub will fall back to a system-wide OpenTrack install if present.');
        return;
    }

    ensureDir(CACHE_DIR);
    const cachePath = path.join(CACHE_DIR, `opentrack-${tagName}.7z`);
    if (FORCE || !fs.existsSync(cachePath)) {
        log(`  Downloading OpenTrack ${tagName}…`);
        await downloadFile(assetUrl, cachePath);
    } else {
        log(`  Using cached OpenTrack ${tagName}`);
    }

    try {
        execFileSync(sevenZip, ['x', cachePath, '-o' + OPENTRACK_DIR, '-y'], { stdio: 'pipe' });
    } catch (e) {
        log(`  ⚠ 7-Zip extract warning: ${(e.stderr?.toString() || '').slice(0, 120)}`);
    }

    // The archive nests everything under "opentrack-<version>/" — flatten so
    // opentrack.exe ends up at resources/opentrack/opentrack.exe.
    for (const entry of fs.readdirSync(OPENTRACK_DIR, { withFileTypes: true })) {
        if (!entry.isDirectory() || !entry.name.toLowerCase().startsWith('opentrack')) continue;
        const inner = path.join(OPENTRACK_DIR, entry.name);
        for (const child of fs.readdirSync(inner, { withFileTypes: true })) {
            const dst = path.join(OPENTRACK_DIR, child.name);
            if (fs.existsSync(dst)) continue;  // never overwrite (handles already-flat archives)
            fs.renameSync(path.join(inner, child.name), dst);
        }
        try { fs.rmdirSync(inner); } catch {}
        break;
    }

    fs.writeFileSync(markerFile, `${tagName} at ${new Date().toISOString()}\n`);
    log(`  OpenTrack ${tagName} installed ✓`);
}

// Recursive directory copy — sync, simple, used for dev-fallback staging.
function copyDirRecursiveSync(src, dst) {
    ensureDir(dst);
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, entry.name);
        const d = path.join(dst, entry.name);
        if (entry.isDirectory()) copyDirRecursiveSync(s, d);
        else                     fs.copyFileSync(s, d);
    }
}

async function downloadDirectAddon(name, source, sevenZip) {
    step(`Downloading addon: ${name}…`);
    const filename = source.url.split('/').pop();
    const zipPath  = path.join(TMP_DIR, filename);

    if (!FORCE && fs.existsSync(zipPath)) { log(`  ${filename} already cached`); }
    else { log(`  ${source.desc}…`); await downloadFile(source.url, zipPath); }

    ensureDir(ADDONS_DIR);
    const extractTo = path.join(TMP_DIR, `addon-${name}`);
    if (fs.existsSync(extractTo)) fs.rmSync(extractTo, { recursive: true });
    ensureDir(extractTo);

    try { execFileSync(sevenZip, ['x', zipPath, '-o' + extractTo, '-y'], { stdio: 'pipe' }); }
    catch (e) { log(`⚠ 7-Zip warning: ${(e.stderr?.toString()||'').slice(0,120)}`); }

    let count = 0;
    function copyRecursive(dir) {
        if (!fs.existsSync(dir)) return;
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
            if (ent.isDirectory()) { copyRecursive(path.join(dir, ent.name)); continue; }
            const ext = path.extname(ent.name).toLowerCase();
            if (['.addon64', '.addon32', '.addon', '.fx', '.fxh'].includes(ext)) {
                const dest = (ext === '.fx' || ext === '.fxh') ? SHADERS_DIR : ADDONS_DIR;
                fs.copyFileSync(path.join(dir, ent.name), path.join(dest, ent.name));
                log(`  → ${ext.includes('addon') ? 'addons/' : 'shaders/'}${ent.name}`);
                count++;
            }
        }
    }
    copyRecursive(extractTo);
    if (count === 0) log(`⚠ No files found in ${filename}`);
}

// ── Shader zip packages ───────────────────────────────────────
async function downloadShaderZips(sevenZip) {
    if (Object.keys(SHADER_ZIP_SOURCES).length === 0) return;
    step('Downloading shader packages…');
    const TEXTURES_DIR = path.join(RESHADE_DIR, 'textures');
    ensureDir(TEXTURES_DIR);

    for (const [name, source] of Object.entries(SHADER_ZIP_SOURCES)) {
        const allPresent = source.extract.every(([, destType, destFile]) => {
            const destDir = destType === 'textures' ? TEXTURES_DIR
                : (destFile.endsWith('.fxh') ? SHADERS_DIR : SHADERS_SRC_DIR);
            return !FORCE && fs.existsSync(path.join(destDir, destFile));
        });
        if (allPresent) { log(`  ${name} already present`); continue; }

        log(`  Downloading ${source.desc}…`);
        const zipPath = path.join(TMP_DIR, `${name}.zip`);
        await downloadFile(source.url, zipPath);

        for (const [zipInternalPath, destType, destFile, optional] of source.extract) {
            const destDir  = destType === 'textures' ? TEXTURES_DIR : SHADERS_DIR;
            const destPath = path.join(destDir, destFile);
            let extracted  = false;
            for (const pattern of [zipInternalPath, destFile]) {
                spawnSync(sevenZip, ['e', zipPath, pattern, `-o${destDir}`, '-y'], { encoding: 'utf8' });
                if (fs.existsSync(destPath)) { extracted = true; break; }
            }
            if (extracted) log(`  → ${destType}/${destFile}`);
            else if (optional) log(`  (optional) ${destFile} not found — skipping`);
            else log(`  ✗ Failed to extract ${destFile} from ${name}`);
        }
        try { fs.unlinkSync(zipPath); } catch {}
    }
}

// ── Game-specific shaders ─────────────────────────────────────
function copyLocalShaders() {
    if (!fs.existsSync(SHADERS_SRC_DIR)) return;
    const files = fs.readdirSync(SHADERS_SRC_DIR).filter(f => f.endsWith('.fx'));
    if (files.length) log(`  shaders-src/ has ${files.length} game shader(s) ready for per-game install`);
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
    console.log('\n╔══════════════════════════════════════╗');
    console.log('║  Stereopticon — Setup                ║');
    console.log('╚══════════════════════════════════════╝\n');

    ensureDir(RESHADE_DIR);
    ensureDir(SHADERS_DIR);
    ensureDir(CACHE_DIR);
    ensureDir(TMP_DIR);

    const sevenZip = find7z();
    log(`7-Zip: ${sevenZip}`);

    const version = await downloadReshade(sevenZip);
    await downloadUEVR();
    await downloadVRto3D();
    await downloadXRGameBridge();
    await downloadDgVoodoo2();
    await downloadWiz3D(sevenZip);
    await downloadOpenTrack(sevenZip);

    for (const [name, source] of Object.entries(DIRECT_ADDON_SOURCES)) {
        await downloadDirectAddon(name, source, sevenZip);
    }

    await downloadShaderZips(sevenZip);

    step('Checking local game-specific shaders…');
    copyLocalShaders();

    try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch {}

    console.log(`\n✓ Setup complete! ReShade ${version} · UEVR · VRto3D · XRGameBridge · dgVoodoo2 · wiz3D · OpenTrack\n`);
}

main()
    .then(() => process.exit(0))
    .catch(e => { console.error(`\n✗ ${e.message}`); process.exit(1); });