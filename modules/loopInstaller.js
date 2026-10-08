'use strict';
/**
 * modules/loopInstaller.js
 *
 * Downloads + installs Loop / itsloopyo head-tracking mods (the per-game
 * MelonLoader/BepInEx/Cecil/REFramework/ASI plugins that emit OpenTrack-
 * compatible head pose into Unity, RE Engine, etc. games).
 *
 * Distribution model: per-game, on-selection. Each Loop mod is a separate
 * GitHub repo with `<ModName>-vX.Y.Z-installer.zip` releases. We fetch the
 * latest release for the selected game, cache it, and run its install.cmd
 * with `/y` per the Loop launcher contract.
 */

const path  = require('path');
const fs    = require('fs');
const os    = require('os');
const https = require('https');
const { execFile, execFileSync } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const PROJECT_ROOT = path.join(__dirname, '..');
const LOOP_CACHE   = path.join(PROJECT_ROOT, 'resources', 'loop-mods');

function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }

function follow(url, depth = 0) {
    return new Promise((resolve, reject) => {
        if (depth > 5) return reject(new Error('too many redirects'));
        https.get(url, {
            headers: { 'User-Agent': 'Stereopticon-LoopInstaller' },
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                return follow(res.headers.location, depth + 1).then(resolve, reject);
            }
            resolve(res);
        }).on('error', reject);
    });
}

async function fetchJson(url) {
    const res = await follow(url);
    const chunks = [];
    for await (const c of res) chunks.push(c);
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function downloadTo(url, outPath) {
    const res = await follow(url);
    if (res.statusCode !== 200) throw new Error(`HTTP ${res.statusCode} fetching ${url}`);
    await new Promise((resolve, reject) => {
        const f = fs.createWriteStream(outPath);
        res.pipe(f);
        f.on('finish', resolve);
        f.on('error', reject);
    });
}

/**
 * Resolve the installer-zip asset URL from a Loop mod's GitHub repo.
 * Loop's release naming: `<ModName>-v<version>-installer.zip` (the launcher-driven
 * variant) — the one we want, never the `-nexus.zip` flavour.
 */
async function resolveInstallerAsset(repo) {
    const releaseUrl = `https://api.github.com/repos/${repo}/releases/latest`;
    const release = await fetchJson(releaseUrl);
    const asset = release.assets?.find(a => /-installer\.zip$/i.test(a.name))
               || release.assets?.find(a => /\.zip$/i.test(a.name));
    if (!asset) throw new Error(`No installer .zip asset in latest release of ${repo}`);
    return { url: asset.browser_download_url, name: asset.name, tag: release.tag_name };
}

async function extractZip(zipPath, destDir) {
    ensureDir(destDir);
    // tar.exe ships with Windows 10+ and handles zip transparently — no 7z dependency.
    await execFileAsync(
        path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'),
        ['-xf', zipPath, '-C', destDir],
    );
}

/**
 * Install a Loop mod into a game folder.
 *
 * @param {object} fix              Stereopticon fix profile (must have loop_repo, name)
 * @param {string} gamePath         Game install root (where install.cmd's first arg goes)
 * @param {function} [onProgress]   Optional (pct, msg) callback
 * @returns {Promise<{success, applied, errors, warnings}>}
 */
async function installLoopMod(fix, gamePath, onProgress = () => {}) {
    const result = { success: true, applied: [], errors: [], warnings: [] };

    if (!fix?.loop_repo) {
        result.success = false;
        result.errors.push('Loop fix profile missing `loop_repo` field');
        return result;
    }
    if (!gamePath || !fs.existsSync(gamePath)) {
        result.success = false;
        result.errors.push(`Game path does not exist: ${gamePath}`);
        return result;
    }

    const slug = fix.loop_repo.split('/').pop();
    const cacheDir = path.join(LOOP_CACHE, slug);
    ensureDir(cacheDir);

    onProgress(10, `Resolving latest ${slug} release…`);
    let asset;
    try {
        asset = await resolveInstallerAsset(fix.loop_repo);
    } catch (e) {
        result.success = false;
        result.errors.push(`Could not resolve ${fix.loop_repo} release: ${e.message}`);
        return result;
    }

    const zipPath = path.join(cacheDir, asset.name);
    if (!fs.existsSync(zipPath)) {
        onProgress(30, `Downloading ${asset.name}…`);
        try {
            await downloadTo(asset.url, zipPath);
        } catch (e) {
            result.success = false;
            result.errors.push(`Download failed: ${e.message}`);
            return result;
        }
    }
    result.applied.push(`Loop mod release: ${asset.tag}`);

    onProgress(60, 'Extracting installer…');
    const extractDir = path.join(cacheDir, `extracted-${asset.tag}`);
    if (!fs.existsSync(extractDir)) {
        try {
            await extractZip(zipPath, extractDir);
        } catch (e) {
            result.success = false;
            result.errors.push(`Extract failed: ${e.message}`);
            return result;
        }
    }

    // Loop installers always ship an install.cmd at the extracted root.
    const installCmd = path.join(extractDir, 'install.cmd');
    if (!fs.existsSync(installCmd)) {
        result.success = false;
        result.errors.push(`install.cmd not found in extracted ZIP at ${extractDir}`);
        return result;
    }

    onProgress(80, `Running ${slug} install.cmd…`);
    try {
        // Loop's CLI contract: install.cmd <GAME_PATH> /y → exit 0 on success.
        // A .cmd file cannot be spawned directly on current Node; run it through cmd.exe.
        execFileSync('cmd.exe', ['/d', '/s', '/c', `""${installCmd}" "${gamePath}" /y"`], {
            windowsVerbatimArguments: true,
            cwd:         extractDir,
            stdio:       'pipe',
            windowsHide: true,
            timeout:     120_000,
        });
        result.applied.push(`Installed to ${gamePath} via install.cmd /y`);
    } catch (e) {
        result.success = false;
        const stderr = (e.stderr?.toString() || '').slice(-400);
        result.errors.push(`install.cmd exited ${e.status ?? '?'}: ${stderr || e.message}`);
        return result;
    }

    onProgress(100, 'Loop mod installed.');
    return result;
}

// OWML (Outer Wilds Mod Loader) — mod-loader infrastructure for Outer Wilds.
// Located at %APPDATA%\OuterWildsModManager\OWML\ when installed via OWMM.
// Loop's Outer Wilds head-tracking mod requires it.
function owmlRoot() {
    return path.join(os.homedir(), 'AppData', 'Roaming', 'OuterWildsModManager', 'OWML');
}

function isOWMLInstalled() {
    // OWML.Launcher.exe is the canonical marker — present in every OWML release.
    return fs.existsSync(path.join(owmlRoot(), 'OWML.Launcher.exe'));
}

async function installOWML(onProgress = () => {}) {
    const result = { success: true, applied: [], errors: [], warnings: [] };
    if (isOWMLInstalled()) {
        result.applied.push('OWML already installed (skipping)');
        return result;
    }

    onProgress(10, 'Fetching latest OWML release…');
    let asset;
    try {
        const release = await fetchJson('https://api.github.com/repos/ow-mods/owml/releases/latest');
        asset = release.assets?.find(a => /^OWML\.zip$/i.test(a.name))
             || release.assets?.find(a => /\.zip$/i.test(a.name));
        if (!asset) throw new Error('no .zip asset in latest OWML release');
    } catch (e) {
        result.success = false;
        result.errors.push(`Could not resolve OWML release: ${e.message}`);
        return result;
    }

    const cacheDir = path.join(LOOP_CACHE, '_owml');
    ensureDir(cacheDir);
    const zipPath = path.join(cacheDir, asset.name);
    if (!fs.existsSync(zipPath)) {
        onProgress(40, `Downloading OWML ${asset.name}…`);
        try {
            await downloadTo(asset.browser_download_url, zipPath);
        } catch (e) {
            result.success = false;
            result.errors.push(`OWML download failed: ${e.message}`);
            return result;
        }
    }
    result.applied.push(`OWML release fetched: ${asset.name}`);

    const target = owmlRoot();
    ensureDir(target);
    onProgress(80, `Extracting OWML to ${target}…`);
    try {
        await extractZip(zipPath, target);
        ensureDir(path.join(target, 'Mods'));   // mod manifest directory
        result.applied.push(`OWML installed at ${target}`);
    } catch (e) {
        result.success = false;
        result.errors.push(`OWML extract failed: ${e.message}`);
        return result;
    }

    onProgress(100, 'OWML installed.');
    return result;
}

/**
 * Install an OWML-based Loop mod (Outer Wilds). Auto-installs OWML first if
 * it's not detected. The Loop mod ZIP contains a manifest.json + DLL, copied
 * into %APPDATA%\OuterWildsModManager\OWML\Mods\<uniqueName>\.
 */
async function installLoopModOWML(fix, onProgress = () => {}) {
    const result = { success: true, applied: [], errors: [], warnings: [] };

    if (!fix?.loop_repo || !fix?.owml_unique_name) {
        result.success = false;
        result.errors.push('OWML Loop fix profile missing `loop_repo` or `owml_unique_name`');
        return result;
    }

    const slug = fix.loop_repo.split('/').pop();
    const cacheDir = path.join(LOOP_CACHE, slug);
    ensureDir(cacheDir);

    onProgress(10, `Resolving latest ${slug} release…`);
    let asset;
    try {
        asset = await resolveInstallerAsset(fix.loop_repo);
    } catch (e) {
        result.success = false;
        result.errors.push(`Could not resolve ${fix.loop_repo} release: ${e.message}`);
        return result;
    }

    const zipPath = path.join(cacheDir, asset.name);
    if (!fs.existsSync(zipPath)) {
        onProgress(30, `Downloading ${asset.name}…`);
        try {
            await downloadTo(asset.url, zipPath);
        } catch (e) {
            result.success = false;
            result.errors.push(`Download failed: ${e.message}`);
            return result;
        }
    }
    result.applied.push(`Loop mod release: ${asset.tag}`);

    // Auto-install OWML if missing — user shouldn't need to run OWMM separately.
    if (!isOWMLInstalled()) {
        onProgress(50, 'OWML not detected — installing now…');
        const owml = await installOWML(onProgress);
        result.applied.push(...owml.applied);
        result.warnings.push(...owml.warnings);
        if (!owml.success) {
            result.success = false;
            result.errors.push(...owml.errors);
            return result;
        }
    } else {
        result.applied.push('OWML detected (using existing install)');
    }
    const owmlModsDir = path.join(owmlRoot(), 'Mods');
    ensureDir(owmlModsDir);

    const targetDir = path.join(owmlModsDir, fix.owml_unique_name);
    ensureDir(targetDir);

    onProgress(70, `Extracting to ${targetDir}…`);
    try {
        await extractZip(zipPath, targetDir);
        result.applied.push(`Installed to ${targetDir}`);
    } catch (e) {
        result.success = false;
        result.errors.push(`Extract failed: ${e.message}`);
        return result;
    }

    onProgress(100, 'Outer Wilds Loop mod installed.');
    return result;
}

module.exports = {
    installLoopMod,
    installLoopModOWML,
    installOWML,
    isOWMLInstalled,
};
