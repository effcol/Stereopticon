/**
 * installer.js
 *
 * Handles .zip and .7z archives.
 * Requires: npm install adm-zip 7zip-bin node-7z
 *
 * Install cases:
 *   A — fix has download_url → download archive, extract to game dir
 *   B — geo11 type, no download_url → download stock Geo-11 zip from GitHub
 *   C — uevr_profile_url → download profile zip to UEVR profiles dir
 *   D — no download, non-geo11 → return manual install message
 */

const fs    = require('fs');
const path  = require('path');
const https = require('https');
const http  = require('http');
const os    = require('os');

// ZIP support
let AdmZip;
try { AdmZip = require('adm-zip'); } catch { AdmZip = null; }

// 7z support
let sevenZip, sevenZipBin;
try {
    sevenZip    = require('node-7z');
    sevenZipBin = require('7zip-bin').path7za;
} catch { sevenZip = null; }

const CACHE_DIR = path.join(os.homedir(), '.stereopticon', 'cache');
const GEO11_RELEASE_API  = 'https://api.github.com/repos/bo3b/3Dmigoto/releases/latest';
const GEO11_FALLBACK_URL = 'https://github.com/bo3b/3Dmigoto/releases/latest/download/3Dmigoto.zip';

// wiz3D is staged at setup time by scripts/download-tools.js into resources/wiz3d/.
// At fix-install time we pick the right per-variant/per-arch subfolder and copy it
// into the game folder.
const WIZ3D_STAGE_DIR = path.join(__dirname, '..', 'resources', 'wiz3d');

// ─── Utilities ────────────────────────────────────────────────

function ensureDir(p) {
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function humanBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
}

function isSevenZip(filePath) {
    return filePath.toLowerCase().endsWith('.7z');
}

// ─── Download ─────────────────────────────────────────────────

function downloadFile(url, destPath, onProgress) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;
        ensureDir(path.dirname(destPath));

        const req = protocol.get(url, { headers: { 'User-Agent': 'Stereopticon/1.0' } }, res => {
            if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
                return downloadFile(res.headers.location, destPath, onProgress)
                    .then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) {
                return reject(new Error(`HTTP ${res.statusCode}: ${url}`));
            }

            const total = parseInt(res.headers['content-length'] || '0', 10);
            let received = 0;
            const out = fs.createWriteStream(destPath);

            res.on('data', chunk => {
                received += chunk.length;
                if (onProgress) onProgress({
                    received, total,
                    percent: total > 0 ? Math.round((received / total) * 100) : -1,
                    label: total > 0
                        ? `${humanBytes(received)} / ${humanBytes(total)}`
                        : `${humanBytes(received)} downloaded`
                });
            });

            res.pipe(out);
            out.on('finish', () => out.close(resolve));
            out.on('error', reject);
        });

        req.on('error', reject);
        req.setTimeout(30000, () => { req.destroy(); reject(new Error('Download timed out')); });
    });
}

// ─── Extraction ───────────────────────────────────────────────

function extractZip(zipPath, destDir, installFiles) {
    if (!AdmZip) throw new Error('adm-zip not installed. Run: npm install adm-zip');
    const zip = new AdmZip(zipPath);
    ensureDir(destDir);
    let count = 0;

    zip.getEntries().forEach(entry => {
        if (entry.isDirectory) return;
        if (installFiles?.length) {
            const match = installFiles.some(f =>
                entry.entryName.startsWith(f) || path.basename(entry.entryName) === f
            );
            if (!match) return;
        }
        const outPath = path.join(destDir, entry.entryName);
        ensureDir(path.dirname(outPath));
        fs.writeFileSync(outPath, entry.getData());
        count++;
    });

    return count;
}

function extract7z(archivePath, destDir, onProgress) {
    return new Promise((resolve, reject) => {
        if (!sevenZip) {
            return reject(new Error(
                'node-7z or 7zip-bin not installed.\nRun: npm install node-7z 7zip-bin'
            ));
        }
        ensureDir(destDir);
        let count = 0;

        const stream = sevenZip.extractFull(archivePath, destDir, {
            $bin: sevenZipBin,
            recursive: true,
            overwrite: 'a',
        });

        stream.on('data', data => {
            count++;
            if (onProgress) onProgress({ stage: 'extract', status: 'extracting', message: data.file || '' });
        });
        stream.on('end', () => resolve(count));
        stream.on('error', err => reject(new Error(`7z extraction failed: ${err.message}`)));
    });
}

async function extractArchive(archivePath, destDir, installFiles, onProgress) {
    if (isSevenZip(archivePath)) {
        // node-7z extracts everything; post-filter if install_files specified
        const count = await extract7z(archivePath, destDir, onProgress);

        // If install_files specified, remove files that weren't wanted
        // (simpler than filtering during extraction for 7z)
        if (installFiles?.length) {
            cleanUnwantedFiles(destDir, installFiles);
        }
        return count;
    } else {
        return extractZip(archivePath, destDir, installFiles);
    }
}

function cleanUnwantedFiles(dir, keepPatterns) {
    // Walk extracted dir, remove files not matching keepPatterns
    // keepPatterns like ["d3dxdm.ini", "ShaderFixes/"]
    function walk(current, relative) {
        fs.readdirSync(current).forEach(name => {
            const full = path.join(current, name);
            const rel  = relative ? `${relative}/${name}` : name;
            const stat = fs.statSync(full);

            if (stat.isDirectory()) {
                walk(full, rel);
                // Remove empty dirs after cleanup
                try { if (fs.readdirSync(full).length === 0) fs.rmdirSync(full); } catch {}
            } else {
                const keep = keepPatterns.some(p =>
                    rel === p ||
                    rel.startsWith(p) ||
                    path.basename(rel) === p
                );
                if (!keep) {
                    try { fs.unlinkSync(full); } catch {}
                }
            }
        });
    }
    walk(dir, '');
}

// ─── Stock Geo-11 ─────────────────────────────────────────────

async function getGeo11LatestUrl() {
    return new Promise(resolve => {
        https.get(GEO11_RELEASE_API, { headers: { 'User-Agent': 'Stereopticon/1.0' } }, res => {
            let data = '';
            res.on('data', d => data += d);
            res.on('end', () => {
                try {
                    const release = JSON.parse(data);
                    const asset = release.assets?.find(a => a.name.endsWith('.zip'));
                    resolve(asset ? asset.browser_download_url : GEO11_FALLBACK_URL);
                } catch { resolve(GEO11_FALLBACK_URL); }
            });
        }).on('error', () => resolve(GEO11_FALLBACK_URL));
    });
}

async function downloadStockGeo11(onProgress) {
    const cacheZip = path.join(CACHE_DIR, 'geo11-latest.zip');
    if (fs.existsSync(cacheZip)) {
        onProgress({ stage: 'download', status: 'cached', percent: 100, message: 'Using cached Geo-11' });
        return cacheZip;
    }
    onProgress({ stage: 'download', status: 'fetching', percent: 0, message: 'Fetching latest Geo-11 release…' });
    const url = await getGeo11LatestUrl();
    onProgress({ stage: 'download', status: 'downloading', percent: 0, message: 'Downloading stock Geo-11…' });
    await downloadFile(url, cacheZip, p => onProgress({ stage: 'download', status: 'downloading', ...p }));
    return cacheZip;
}

// ─── Main install ─────────────────────────────────────────────

async function installFix(profile, gamePath, onProgress = () => {}, exeName = null) {
    if (!gamePath) throw new Error('No game path provided');
    if (!fs.existsSync(gamePath)) {
        throw new Error(`Game directory not found:\n${gamePath}\n\nBrowse to the folder containing the game executable.`);
    }

    const isGeo11Type = ['geo11', 'geo12', '3dmigoto', 'helixmod'].includes(profile.type);
    const isNativeShader = profile.type === 'native' && profile.download_url?.toLowerCase().endsWith('.fx');

    // ── Case A: Single shader file (native type) ──────────────
    if (isNativeShader) {
        const shaderName = path.basename(profile.download_url);
        const cachePath = path.join(CACHE_DIR, shaderName);
        const shaderDir = path.join(gamePath, 'reshade-shaders', 'Shaders');

        onProgress({ stage: 'download', status: 'start', percent: 0, message: `Downloading shader ${shaderName}…` });
        await downloadFile(profile.download_url, cachePath, p =>
            onProgress({ stage: 'download', status: 'downloading', message: `Downloading… ${p.label}`, ...p })
        );

        onProgress({ stage: 'extract', status: 'extracting', percent: 85, message: 'Installing shader…' });
        ensureDir(shaderDir);
        fs.copyFileSync(cachePath, path.join(shaderDir, shaderName));

        onProgress({ stage: 'done', status: 'done', percent: 100, message: `${shaderName} installed` });
        return { success: true, message: `Shader installed to:\n${shaderDir}` };
    }

    // ── Case B: archive URL provided ──────────────────────────
    if (profile.download_url) {
        const ext      = profile.download_url.toLowerCase().endsWith('.7z') ? '.7z' : '.zip';
        const cachePath = path.join(CACHE_DIR, `${profile.id}${ext}`);

        onProgress({ stage: 'download', status: 'start', percent: 0, message: `Downloading ${profile.name}…` });
        await downloadFile(profile.download_url, cachePath, p =>
            onProgress({ stage: 'download', status: 'downloading', message: `Downloading… ${p.label}`, ...p })
        );

        onProgress({ stage: 'extract', status: 'extracting', percent: 85, message: 'Extracting to game folder…' });
        const count = await extractArchive(cachePath, gamePath, profile.install_files || null,
            p => onProgress({ stage: 'extract', ...p })
        );

        onProgress({ stage: 'done', status: 'done', percent: 100, message: `${count} files installed` });
        return { success: true, message: `${count} files installed to:\n${gamePath}` };
    }

    // ── Case C: Geo-11 type, no fix zip — stock Geo-11 ───────
    if (isGeo11Type) {
        const zipPath = await downloadStockGeo11(p => onProgress(p));
        onProgress({ stage: 'extract', status: 'extracting', percent: 85, message: 'Extracting stock Geo-11…' });
        const count = await extractArchive(zipPath, gamePath, null, p => onProgress({ stage: 'extract', ...p }));
        onProgress({ stage: 'done', status: 'done', percent: 100, message: `Stock Geo-11 installed (${count} files)` });
        return {
            success: true,
            message: `Stock Geo-11 installed to:\n${gamePath}\n\nThis game may need a game-specific fix for best results. Visit the fix page for details.`
        };
    }

    // ── Case D: UEVR / UE3D — download UEVR + VRto3D + profile ─
    if (['uevr', 'ue3d'].includes(profile.type)) {
        const result = await installUE3D(profile, gamePath, exeName || '', onProgress);
        return result;
    }

    // ── Case E: wiz3D variants — copy staged wiz3D files into game folder ─
    if (typeof profile.type === 'string' && profile.type.startsWith('wiz3d')) {
        return await installWiz3D(profile, gamePath, exeName || '', onProgress);
    }

    // ── Case F: no download ───────────────────────────────────
    onProgress({ stage: 'done', status: 'manual', percent: 100, message: 'No download available' });
    return {
        success: false,
        message: `No automatic download available for "${profile.name}".\nVisit the fix page to download and install manually.`
    };
}

// ─── wiz3D install ───────────────────────────────────────────────
// Copies the right per-variant + per-arch subfolder from resources/wiz3d/
// into the game folder. The folder layout (per `lib/wiz3D build/wiz3D/`):
//
//   resources/wiz3d/
//     dx7/                              ← no arch split for legacy APIs
//     dx8/                              ← no arch split
//     dx9/{x86,x64}/                    ← wrapper variants need arch
//     dx10-11/{x86,x64}/
//     dx12/{x86,x64}/                   ← planned (not working yet)
//     vulkan/{x86,x64}/                 ← planned
//     3d-vision-direct/{dx9,dx10,dx11}/{x86,x64}/
//     hd3d/{x86,x64}/                   ← planned
//     opengl-quad-buffer-stereo/{x86,x64}/
//
// Working APIs (per data/tools/wiz3d-*.json graphics_api_status.working):
//   wiz3d_wrapper       → dx8, dx9
//   wiz3d_3dvision_dm   → dx9 (only)
//   wiz3d_hd3d          → none yet (planned dx11)
//   wiz3d_opengl        → opengl-quad-buffer-stereo
async function installWiz3D(profile, gamePath, exeName, onProgress) {
    onProgress({ stage: 'preflight', status: 'start', percent: 5, message: 'Locating wiz3D staging…' });

    if (!fs.existsSync(WIZ3D_STAGE_DIR)) {
        return {
            success: false,
            message: `wiz3D is not staged on this machine.\n\n` +
                     `Run \`npm run setup\` to fetch it from the upstream release, ` +
                     `or place a build at lib/wiz3D build/wiz3D/ for development use.`
        };
    }

    // Resolve which variant subfolder this fix maps to.
    const variantDir = resolveWiz3DVariantDir(profile);
    if (!variantDir) {
        return {
            success: false,
            message: `Unknown wiz3D variant or unsupported graphics API for fix "${profile.id}" ` +
                     `(type: ${profile.type}, graphics_api: ${profile.graphics_api || 'unspecified'}).`
        };
    }

    // Pick architecture (default x64). Some fixes declare cpu_architecture: "32bit"/"x86".
    const arch = pickWiz3DArch(profile);

    // Resolve the absolute source directory we'll copy from. Some variants have an
    // arch split (x86/x64) and some don't (dx7, dx8).
    let srcDir = path.join(WIZ3D_STAGE_DIR, variantDir, arch);
    if (!fs.existsSync(srcDir)) {
        // No arch split — fall back to the variantDir itself
        const noArch = path.join(WIZ3D_STAGE_DIR, variantDir);
        if (fs.existsSync(noArch) && fs.statSync(noArch).isDirectory() &&
            !fs.existsSync(path.join(noArch, 'x86')) && !fs.existsSync(path.join(noArch, 'x64'))) {
            srcDir = noArch;
        } else {
            return {
                success: false,
                message: `wiz3D ${variantDir}/${arch}/ is not present in resources/wiz3d/.\n\n` +
                         `This API/arch combination may not be implemented yet ` +
                         `(see data/tools/${profile.type.replace(/_/g, '-')}.json graphics_api_status). ` +
                         `Re-run \`npm run setup\` after a new wiz3D release if you expect this to work.`
            };
        }
    }

    onProgress({ stage: 'install', status: 'copying', percent: 30, message: `Installing wiz3D ${variantDir}…` });

    // Track installed files for later uninstall
    const installed = [];
    const copyAll = (from, intoSubdir) => {
        ensureDir(intoSubdir);
        for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
            const s = path.join(from, entry.name);
            const d = path.join(intoSubdir, entry.name);
            if (entry.isDirectory()) {
                copyAll(s, d);
            } else {
                fs.copyFileSync(s, d);
                installed.push(path.relative(gamePath, d));
            }
        }
    };
    try {
        copyAll(srcDir, gamePath);
    } catch (e) {
        return {
            success: false,
            message: `wiz3D install failed while copying ${srcDir} → ${gamePath}: ${e.message}`
        };
    }

    onProgress({ stage: 'done', status: 'done', percent: 100, message: `wiz3D installed (${installed.length} files)` });

    return {
        success: true,
        installedFiles: installed,
        variant: variantDir,
        arch:    arch,
        message: `wiz3D ${variantDir} (${arch}) installed to:\n${gamePath}\n\n` +
                 `${installed.length} file${installed.length === 1 ? '' : 's'} copied. ` +
                 `Edit wiz3D_Config.xml in the game folder (or use the per-tool settings in ` +
                 `Stereopticon's UI once the config adapter ships in S3.2) to tune output mode.`
    };
}

// Map a fix profile (type + graphics_api) to a subfolder name inside resources/wiz3d/.
function resolveWiz3DVariantDir(profile) {
    const type = profile.type;
    const api  = (Array.isArray(profile.graphics_api) ? profile.graphics_api[0] : profile.graphics_api) || '';

    if (type === 'wiz3d_wrapper') {
        // Map graphics_api → wrapper subdir name. wiz3D bundles dx10 and dx11
        // together as "dx10-11".
        switch (api.toLowerCase()) {
            case 'dx7':           return 'dx7';
            case 'dx8':           return 'dx8';
            case 'dx9':           return 'dx9';
            case 'dx10':
            case 'dx11':          return 'dx10-11';
            case 'dx12':          return 'dx12';
            case 'vulkan':        return 'vulkan';
            default:              return null;
        }
    }
    if (type === 'wiz3d_3dvision_dm') {
        // 3D Vision Direct Mode has its own dx9/dx10/dx11 split under one tree
        switch (api.toLowerCase()) {
            case 'dx9':           return path.join('3d-vision-direct', 'dx9');
            case 'dx10':          return path.join('3d-vision-direct', 'dx10');
            case 'dx11':          return path.join('3d-vision-direct', 'dx11');
            default:              return null;
        }
    }
    if (type === 'wiz3d_hd3d')   return 'hd3d';
    if (type === 'wiz3d_opengl') return 'opengl-quad-buffer-stereo';
    return null;
}

// Determine x64 vs x86. Some game profiles declare cpu_architecture; otherwise default x64.
function pickWiz3DArch(profile) {
    const arch = String(profile.cpu_architecture || profile.arch || '').toLowerCase();
    if (arch === '32bit' || arch === 'x86' || arch === 'win32') return 'x86';
    return 'x64';
}

// ─── UEVR profile install ─────────────────────────────────────

async function installUEVRProfile(profile, onProgress = () => {}) {
    if (!profile.uevr_profile_url && !profile.download_url) {
        throw new Error('No UEVR profile URL on this fix');
    }
    const url = profile.uevr_profile_url || profile.download_url;
    const uevrDir = path.join(os.homedir(), 'AppData', 'Roaming', 'UnrealVRMod', 'profiles');
    ensureDir(uevrDir);

    const ext = url.toLowerCase().endsWith('.7z') ? '.7z' : '.zip';
    const zipPath = path.join(CACHE_DIR, `${profile.id}-uevr${ext}`);

    onProgress({ stage: 'download', status: 'downloading', percent: 0, message: 'Downloading UEVR profile…' });
    await downloadFile(url, zipPath, p =>
        onProgress({ stage: 'download', status: 'downloading', message: `Downloading… ${p.label}`, ...p })
    );

    onProgress({ stage: 'extract', status: 'extracting', percent: 90, message: 'Installing profile…' });
    const count = await extractArchive(zipPath, uevrDir, null, p => onProgress({ stage: 'extract', ...p }));

    onProgress({ stage: 'done', status: 'done', percent: 100, message: `Profile installed (${count} files)` });
    return { success: true, message: `UEVR profile installed to:\n${uevrDir}` };
}

// ── dgVoodoo2 auto-install ────────────────────────────────────
// Add this block inside installFix(), after fix files are extracted,
// before the final return { success: true }.
//
// Triggered when: fix.requires includes 'dgvoodoo2'
// OR fix.graphics_api is 'dx8' or 'dx9' (auto-detect)
//
// Copies appropriate DLLs from resources/dgvoodoo2/ to the game folder.
// Uses x64 DLLs for 64-bit games, x86 for 32-bit.

/**
 * Install dgVoodoo2 DLLs to a game folder.
 * Called automatically by installFix() when the fix profile requires it.
 *
 * @param {string} gamePath   - absolute path to game folder
 * @param {string} arch       - 'x64' | 'x86' (default: 'x64')
 * @param {string[]} dlls     - which DLLs to copy (default: all of them)
 * @param {function} onProgress - progress callback
 */
async function installDgVoodoo2(gamePath, arch = 'x64', dlls = null, onProgress = null) {
    const DGVOODOO_RESOURCE = path.join(__dirname, '..', 'resources', 'dgvoodoo2', arch);
    const DGVOODOO_CONF     = path.join(__dirname, '..', 'resources', 'dgvoodoo2', 'dgVoodoo.conf');

    if (!fs.existsSync(DGVOODOO_RESOURCE)) {
        throw new Error(
            `dgVoodoo2 ${arch} DLLs not found in resources/dgvoodoo2/${arch}/.\n` +
            `Run 'npm run setup' to download them.`
        );
    }

    // Default DLL set — copy all available unless a specific subset is requested
    const available = fs.readdirSync(DGVOODOO_RESOURCE).filter(f => f.endsWith('.dll'));
    const toCopy    = dlls ? available.filter(f => dlls.includes(f)) : available;

    if (toCopy.length === 0) {
        throw new Error(`No dgVoodoo2 DLLs found for arch=${arch}`);
    }

    onProgress?.({ stage: 'dgvoodoo2', status: 'installing', percent: 60,
        message: `Installing dgVoodoo2 (${arch})…` });

    const copied = [];
    for (const dll of toCopy) {
        const src  = path.join(DGVOODOO_RESOURCE, dll);
        const dest = path.join(gamePath, dll);
        fs.copyFileSync(src, dest);
        copied.push(dll);
    }

    // Also copy dgVoodoo.conf template if not already present
    const confDest = path.join(gamePath, 'dgVoodoo.conf');
    if (!fs.existsSync(confDest) && fs.existsSync(DGVOODOO_CONF)) {
        fs.copyFileSync(DGVOODOO_CONF, confDest);
        copied.push('dgVoodoo.conf');
    }

    onProgress?.({ stage: 'dgvoodoo2', status: 'complete', percent: 70,
        message: `dgVoodoo2 installed (${copied.join(', ')})` });

    return { success: true, copied };
}

// ── Integration point in installFix() ───────────────────────
// Add this block inside your installFix() function, after fix files are
// downloaded and extracted, before returning success:
//
//   const requiresDgVoodoo =
//       (profile.requires || []).includes('dgvoodoo2') ||
//       ['dx8', 'dx9'].includes(profile.graphics_api);
//
//   if (requiresDgVoodoo) {
//       const arch = profile.arch || 'x64';     // fix JSON can specify 'x86' for 32-bit games
//       const dgDlls = profile.dgvoodoo2_dlls || null;  // e.g. ["D3D9.dll"] for DX9-only
//       await installDgVoodoo2(gamePath, arch, dgDlls, onProgress);
//   }
//
// Example fix JSON fields:
//   "requires": ["dgvoodoo2"]
//   "graphics_api": "dx9"         ← also triggers auto-install
//   "arch": "x86"                 ← for 32-bit games
//   "dgvoodoo2_dlls": ["D3D9.dll"] ← optional: only copy specific DLLs

module.exports = { installDgVoodoo2 };

// ─── Cache management ─────────────────────────────────────────

function getCacheInfo() {
    if (!fs.existsSync(CACHE_DIR)) return { files: [], totalBytes: 0, totalHuman: '0 B' };
    const files = fs.readdirSync(CACHE_DIR).map(f => {
        const full = path.join(CACHE_DIR, f);
        const { size, mtime } = fs.statSync(full);
        return { name: f, path: full, size, modified: mtime };
    });
    const totalBytes = files.reduce((s, f) => s + f.size, 0);
    return { files, totalBytes, totalHuman: humanBytes(totalBytes) };
}

function clearCache(keepGeo11 = true) {
    if (!fs.existsSync(CACHE_DIR)) return;
    fs.readdirSync(CACHE_DIR).forEach(f => {
        if (keepGeo11 && f.startsWith('geo11-')) return;
        fs.unlinkSync(path.join(CACHE_DIR, f));
    });
}


// ─── UE3D (Evil___Kermit Monitor 3D fork) install ────────────
//
// Downloads three components from evilkermitreturns GitHub:
//   1. UEVR v2.2 EK fork  → resources/uevr/     (UEVRBackend.dll, openvr_api.dll)
//   2. VRto3D EK fork     → Steam/steamapps/common/SteamVR/drivers/vrto3d/
//   3. Game UEVR profile  → %AppData%/UnrealVRMod/profiles/<ExeName>/
// Optionally also installs Engine.ini if fix.engine_ini_url is set.
//
const UE3D_URLS = {
    uevr:   'https://github.com/evilkermitreturns/UEVR/releases/download/v2.2/uevr-MonitorMode.zip',
    vrto3d: 'https://github.com/evilkermitreturns/VRto3D/releases/download/v2.0/drivers-MonitorMode.zip',
};

// Standard (mainline) VRto3D — used when fix.type === 'uevr' without ue3d monitor mode
const VRTO3D_MAINLINE_URL = 'https://github.com/oneup03/VRto3D/releases/latest/download/VRto3D.zip';
const NEWAXIS_URL          = 'https://github.com/marcussacana/NewAxis/releases/download/v12/NewAxis.v12.7z';
// EK fork 3DGameBridge (for Monitor Mode — srReshade addon)
// TODO: verify exact asset filename on https://github.com/evilkermitreturns/3DGameBridgeProjects/releases/tag/v2.0
const EK_3DGAMEBRIDGE_URL  = 'https://github.com/evilkermitreturns/3DGameBridgeProjects/releases/download/v2.0/srReshade.addon64';

// Locate SteamVR driver directory by checking the Steam install registry key or common paths
function findSteamVRDriversDir() {
    const candidates = [
        path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Steam', 'steamapps', 'common', 'SteamVR', 'drivers'),
        path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Steam', 'steamapps', 'common', 'SteamVR', 'drivers'),
        path.join(os.homedir(), 'AppData', 'Local', 'Steam', 'steamapps', 'common', 'SteamVR', 'drivers'),
    ];
    for (const c of candidates) {
        if (fs.existsSync(c)) return c;
    }
    return candidates[0]; // default if Steam not found (user can fix)
}

// Find the UEVR AppData profile dir for a given exe name
function uevrProfileDir(exeName) {
    const base = exeName.replace(/\.exe$/i, '');
    return path.join(os.homedir(), 'AppData', 'Roaming', 'UnrealVRMod', 'profiles', base);
}

// Read UEVR config.txt (flat key=value, no sections)
function readUEVRConfig(exeName) {
    const configPath = path.join(os.homedir(), 'AppData', 'Roaming', 'UnrealVRMod', exeName.replace(/\.exe$/i, ''), 'config.txt');
    if (!fs.existsSync(configPath)) return null;
    const result = {};
    fs.readFileSync(configPath, 'utf8').split('\n').forEach(line => {
        const m = line.match(/^([^=]+)=(.*)$/);
        if (m) result[m[1].trim()] = m[2].trim();
    });
    return result;
}

function writeUEVRConfig(exeName, values) {
    const dir = path.join(os.homedir(), 'AppData', 'Roaming', 'UnrealVRMod', exeName.replace(/\.exe$/i, ''));
    ensureDir(dir);
    const configPath = path.join(dir, 'config.txt');
    const existing = readUEVRConfig(exeName) || {};
    const merged = { ...existing, ...values };
    const lines = Object.entries(merged).map(([k, v]) => `${k}=${v}`).join('\n');
    fs.writeFileSync(configPath, lines, 'utf8');
    return configPath;
}

// Read VRto3D default_config.json
function findVRto3DConfigPath() {
    // VRto3D V3.x+ stores config in Documents\My Games\vrto3d
    // Older versions used Steam\config\vrto3d — check both
    const candidates = [
        path.join(os.homedir(), 'Documents', 'My Games', 'vrto3d', 'default_config.json'),
        path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Steam', 'config', 'vrto3d', 'default_config.json'),
        path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Steam', 'config', 'vrto3d', 'default_config.json'),
        path.join(os.homedir(), 'AppData', 'Local', 'Steam', 'config', 'vrto3d', 'default_config.json'),
    ];
    for (const f of candidates) {
        if (fs.existsSync(f)) return f;
    }
    return null;
}

function readVRto3DConfig() {
    const p = findVRto3DConfigPath();
    if (!p) return null;
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function writeVRto3DConfig(values) {
    const p = findVRto3DConfigPath();
    if (!p) throw new Error('VRto3D default_config.json not found — launch SteamVR once to generate it');
    const existing = JSON.parse(fs.readFileSync(p, 'utf8'));
    const merged   = { ...existing, ...values };
    fs.writeFileSync(p, JSON.stringify(merged, null, 2), 'utf8');
    return p;
}

async function installUE3D(profile, gamePath, exeName, onProgress = () => {}) {
    const send = (msg, pct) => onProgress({ stage: 'ue3d', status: 'installing', message: msg, percent: pct });

    // ── 1. Download & cache EK UEVR ──────────────────────────
    send('Downloading UEVR (Monitor 3D fork)…', 5);
    const uevrCachePath = path.join(CACHE_DIR, 'ue3d-uevr-v2.2.zip');
    if (!fs.existsSync(uevrCachePath)) {
        await downloadFile(UE3D_URLS.uevr, uevrCachePath,
            p => send(`UEVR download: ${p.label}`, 5 + Math.round(p.percent * 0.2)));
    }

    // ── 2. Extract UEVRBackend.dll + openvr_api.dll to resources/uevr/ ──
    send('Installing UEVR files…', 25);
    const uevrDestDir = path.join(path.dirname(path.dirname(__dirname)), 'resources', 'uevr');
    ensureDir(uevrDestDir);
    // Back up existing if present
    const toBackup = ['UEVRBackend.dll', 'openvr_api.dll'];
    for (const f of toBackup) {
        const existing = path.join(uevrDestDir, f);
        if (fs.existsSync(existing)) {
            fs.copyFileSync(existing, existing + '.bak');
        }
    }
    await extractArchive(uevrCachePath, uevrDestDir, toBackup, p => send(`Extracting UEVR…`, 25));

    // ── 3. Download & install EK VRto3D ──────────────────────
    send('Downloading VRto3D (Monitor 3D fork)…', 35);
    const vrto3dCachePath = path.join(CACHE_DIR, 'ek-vrto3d-v2.0.zip');
    if (!fs.existsSync(vrto3dCachePath)) {
        await downloadFile(UE3D_URLS.vrto3d, vrto3dCachePath,
            p => send(`VRto3D download: ${p.label}`, 35 + Math.round(p.percent * 0.2)));
    }

    send('Installing VRto3D driver…', 55);
    const steamVRDriversDir = findSteamVRDriversDir();
    ensureDir(steamVRDriversDir);
    // Back up existing vrto3d if present
    const vrto3dTarget = path.join(steamVRDriversDir, 'vrto3d');
    if (fs.existsSync(vrto3dTarget)) {
        const backup = vrto3dTarget + '.bak';
        if (!fs.existsSync(backup)) {
            fs.cpSync(vrto3dTarget, backup, { recursive: true });
        }
    }
    // Extract vrto3d/ folder from zip into drivers/
    await extractArchive(vrto3dCachePath, steamVRDriversDir, null, p => send('Extracting VRto3D…', 55));

    // ── 4. Install game UEVR profile ─────────────────────────
    const profileUrl = profile.download_url;
    if (profileUrl) {
        send('Downloading game profile…', 70);
        const profileCachePath = path.join(CACHE_DIR, `${profile.id}-ue3d-profile.zip`);
        await downloadFile(profileUrl, profileCachePath,
            p => send(`Profile download: ${p.label}`, 70 + Math.round(p.percent * 0.1)));

        send('Installing game profile…', 80);
        const profDir = uevrProfileDir(exeName);
        ensureDir(profDir);
        await extractArchive(profileCachePath, profDir, null, p => send('Installing profile…', 80));
    }

    // ── 4.5 Install Stereopticon Lua script ──────────────────
    send('Installing Lua script…', 82);
    try {
        const luaScriptSrc = path.join(__dirname, '..', 'resources', 'uevr', 'stereopticon_autoconfig.lua');
        // Lua scripts go to %APPDATA%/UnrealVRMod/{GameName}/scripts/ per UEVR docs
        const gameConfigDir = path.join(os.homedir(), 'AppData', 'Roaming', 'UnrealVRMod', exeName.replace(/\.exe$/i, ''));
        const scriptsDir = path.join(gameConfigDir, 'scripts');
        ensureDir(scriptsDir);
        const luaScriptDest = path.join(scriptsDir, 'stereopticon_autoconfig.lua');
        if (fs.existsSync(luaScriptSrc)) {
            fs.copyFileSync(luaScriptSrc, luaScriptDest);
            console.log(`[UE3D] Copied Lua script to: ${luaScriptDest}`);
            
            // Create marker file so Lua script can identify the game
            // Write to a fixed location in UnrealVRMod root that Lua script can easily find
            const uevr_base = path.join(os.homedir(), 'AppData', 'Roaming', 'UnrealVRMod');
            ensureDir(uevr_base);
            const markerPath = path.join(uevr_base, 'stereopticon_current_game.txt');
            // Extract game name from exe name (remove .exe and path)
            const gameName = exeName.replace(/\.exe$/i, '').replace(/.*[/\\]/, '');
            fs.writeFileSync(markerPath, gameName, 'utf8');
            console.log(`[UE3D] Created game marker file: ${markerPath} → "${gameName}"`);
        } else {
            console.warn(`[UE3D] Lua script not found at: ${luaScriptSrc}`);
        }
    } catch (e) {
        console.warn('[UE3D] Could not install Lua script:', e.message);
    }

    // ── 5. Install Engine.ini if provided ────────────────────
    if (profile.engine_ini_url) {
        send('Downloading Engine.ini…', 88);
        const engineIniDir = path.join(
            process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
            ...(profile.engine_ini_local_path || 'Saved/Config/Windows').split('/')
        );
        ensureDir(engineIniDir);
        const engineIniPath = path.join(engineIniDir, 'Engine.ini');
        if (fs.existsSync(engineIniPath)) {
            fs.copyFileSync(engineIniPath, engineIniPath + '.bak');
        }
        await downloadFile(profile.engine_ini_url, engineIniPath, p => send('Downloading Engine.ini…', 88));
    }

    send('Done!', 100);
    return {
        success: true,
        uevrDir: path.join(path.dirname(path.dirname(__dirname)), 'resources', 'uevr'),
        vrto3dDir: findSteamVRDriversDir(),
    };
}

// ─── VRto3D Installation & Config Management ──────────────────

// Mainline VRto3D URL (v4.0.2)
const VRTO3D_DOWNLOAD_URL = 'https://github.com/oneup03/VRto3D/releases/download/V4.0.2/VRto3D.zip';

// Determine SteamVR drivers directory (where vrto3d folder goes)
function getSteamVRDriversPath() {
    const candidates = [
        path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Steam', 'steamapps', 'common', 'SteamVR', 'drivers'),
        path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Steam', 'steamapps', 'common', 'SteamVR', 'drivers'),
        path.join(os.homedir(), 'AppData', 'Local', 'Steam', 'steamapps', 'common', 'SteamVR', 'drivers'),
    ];
    for (const c of candidates) {
        if (fs.existsSync(c)) return c;
    }
    return candidates[0]; // default fallback
}

// Check if VRto3D is already installed
function isVRto3DInstalled() {
    const driversPath = getSteamVRDriversPath();
    const vrto3dPath = path.join(driversPath, 'vrto3d');
    const dllPath = path.join(vrto3dPath, 'bin', 'win64', 'vrto3d.dll');
    return fs.existsSync(dllPath) || fs.existsSync(vrto3dPath);
}

// Get VRto3D config directory (creates if needed)
function getVRto3DConfigDir() {
    const steamPath = process.env.STEAM_ROOT || 
        path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Steam') ||
        path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Steam');
    const configDir = path.join(steamPath, 'config', 'vrto3d');
    ensureDir(configDir);
    return configDir;
}

// Install/update mainline VRto3D
async function installVRto3D(onProgress = () => {}) {
    const send = (msg, pct) => onProgress({ stage: 'vrto3d', status: 'installing', message: msg, percent: pct });
    
    send('Checking VRto3D status…', 0);
    const isInstalled = isVRto3DInstalled();
    const driversPath = getSteamVRDriversPath();
    const vrto3dPath = path.join(driversPath, 'vrto3d');
    
    if (isInstalled) {
        send('VRto3D already installed', 30);
    } else {
        send('Downloading VRto3D…', 10);
        const cachePath = path.join(CACHE_DIR, 'vrto3d-4.0.2.zip');
        if (!fs.existsSync(cachePath)) {
            await downloadFile(VRTO3D_DOWNLOAD_URL, cachePath,
                p => send(`Downloading VRto3D… ${p.label}`, 10 + Math.round(p.percent * 0.2)));
        }
        
        send('Extracting VRto3D…', 30);
        // Back up existing vrto3d if present
        if (fs.existsSync(vrto3dPath)) {
            const backup = vrto3dPath + '.bak-' + Date.now();
            fs.cpSync(vrto3dPath, backup, { recursive: true });
            console.log(`[VRto3D] Backed up existing: ${backup}`);
        }
        
        // Extract vrto3d folder from zip to drivers
        ensureDir(driversPath);
        await extractArchive(cachePath, driversPath, null,
            p => send('Extracting VRto3D…', 30 + Math.round(p.percent * 0.2)));
    }
    
    send('Setting up configuration…', 50);
    try {
        const configDir = getVRto3DConfigDir();
        const defaultConfigPath = path.join(configDir, 'default_config.json');
        
        // Create default config if it doesn't exist, or user wants to reset it
        if (!fs.existsSync(defaultConfigPath)) {
            const defaultConfig = {
                "display_index": 0,
                "render_width": 1920,
                "render_height": 1080,
                "hmd_height": 1.0,
                "hmd_x": 0.0,
                "hmd_y": 0.0,
                "hmd_yaw": 0.0,
                "aspect_ratio": 1.77778,
                "fov": 90.0,
                "depth": 0.1,
                "convergence": 1.0,
                "async_enable": false,
                "disable_hotkeys": false,
                "tab_enable": false,
                "framepack_offset": 0,
                "reverse_enable": false,
                "vd_fsbs_hack": false,
                "dash_enable": false,
                "auto_focus": true,
                "display_latency": 0.011,
                "display_frequency": 60.0,
                "pitch_enable": false,
                "yaw_enable": false,
                "use_open_track": false,
                "open_track_port": 4242,
                "launch_script": "",
                "pose_reset_key": "VK_NUMPAD7",
                "ctrl_toggle_key": "VK_NUMPAD8",
                "ctrl_toggle_type": "toggle",
                "pitch_radius": 0.0,
                "ctrl_deadzone": 0.05,
                "ctrl_sensitivity": 1.0,
                "user_settings": []
            };
            fs.writeFileSync(defaultConfigPath, JSON.stringify(defaultConfig, null, 2), 'utf8');
            console.log(`[VRto3D] Created default config at: ${defaultConfigPath}`);
        }
    } catch (e) {
        console.warn('[VRto3D] Could not setup config:', e.message);
    }
    
    send('Done', 100);
    return {
        success: true,
        installed: isInstalled,
        message: isInstalled ? 'VRto3D is installed' : 'VRto3D installed successfully',
        vrto3dPath,
        configDir: getVRto3DConfigDir(),
    };
}

// Write a game-specific VRto3D profile
function writeVRto3DGameProfile(exeName, settings = {}) {
    const configDir = getVRto3DConfigDir();
    const profilePath = path.join(configDir, `${exeName}_config.json`);
    
    // Read existing profile or create new one from default
    let profile = {};
    const defaultConfigPath = path.join(configDir, 'default_config.json');
    if (fs.existsSync(defaultConfigPath)) {
        try {
            const defaults = JSON.parse(fs.readFileSync(defaultConfigPath, 'utf8'));
            profile = { ...defaults };
        } catch (e) {
            console.warn('[VRto3D] Could not read default config:', e.message);
        }
    }
    
    // Merge in provided settings (only update the provided keys)
    profile = { ...profile, ...settings };
    
    // Write profile
    fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2), 'utf8');
    console.log(`[VRto3D] Wrote game profile to: ${profilePath}`);
    return profilePath;
}

module.exports = { installFix, installUEVRProfile, installUE3D, readUEVRConfig, writeUEVRConfig, readVRto3DConfig, writeVRto3DConfig, findSteamVRDriversDir, installVRto3D, isVRto3DInstalled, getVRto3DConfigDir, writeVRto3DGameProfile, getCacheInfo, clearCache };