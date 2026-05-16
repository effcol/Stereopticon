'use strict';
/**
 * modules/gameRegistry.js
 *
 * Locates game install folders on the user's PC.
 *
 * Resolution order per game:
 *   1. steam_app_id  → read appmanifest_XXXX.acf from every Steam library
 *   2. Title + exe fuzzy search across all Steam library /common/ folders
 *   3. GOG: check HKLM\SOFTWARE\GOG.com\Games
 *   4. Epic: check %PROGRAMDATA%\Epic\UnrealEngineLauncher\LauncherInstalled.dat
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ── Steam ────────────────────────────────────────────────────────

/**
 * Returns all known Steam 'steamapps/common' paths, reading
 * libraryfolders.vdf so non-default drives (E:\SteamLibrary etc) are found.
 */
function getSteamCommonPaths() {
    const steamRoots = new Set();

    // 1. Registry (most reliable on Windows)
    try {
        const { execSync } = require('child_process');
        const out = execSync(
            'reg query "HKCU\\SOFTWARE\\Valve\\Steam" /v SteamPath',
            { encoding: 'utf8', timeout: 3000, stdio: ['pipe','pipe','pipe'] }
        );
        const m = out.match(/SteamPath\s+REG_SZ\s+(.+)/i);
        if (m) steamRoots.add(m[1].trim().replace(/\//g, '\\'));
    } catch {}

    // 2. Common fallbacks
    for (const p of [
        'C:\\Program Files (x86)\\Steam',
        'C:\\Program Files\\Steam',
        path.join(os.homedir(), '.steam', 'steam'),
    ]) steamRoots.add(p);

    const commonPaths = new Set();

    for (const root of steamRoots) {
        const vdf = path.join(root, 'steamapps', 'libraryfolders.vdf');
        if (!fs.existsSync(vdf)) continue;

        // The root itself is always a library
        const rootCommon = path.join(root, 'steamapps', 'common');
        if (fs.existsSync(rootCommon)) commonPaths.add(rootCommon);

        // Parse additional library paths (supports both old text format and new JSON format)
        try {
            const content = fs.readFileSync(vdf, 'utf8');
            
            // Try JSON format first (modern Steam v2 format)
            try {
                const json = JSON.parse(content);
                if (json.libraryfolders) {
                    Object.values(json.libraryfolders).forEach(lib => {
                        if (lib.path && typeof lib.path === 'string') {
                            const commonPath = path.join(lib.path, 'steamapps', 'common');
                            if (fs.existsSync(commonPath)) commonPaths.add(commonPath);
                        }
                    });
                }
            } catch (jsonErr) {
                // Fall back to old text format (KeyValue format)
                for (const m of content.matchAll(/"path"\s+"([^"]+)"/gi)) {
                    const libPath    = m[1].replace(/\\\\/g, '\\');
                    const commonPath = path.join(libPath, 'steamapps', 'common');
                    if (fs.existsSync(commonPath)) commonPaths.add(commonPath);
                }
            }
        } catch {}
    }

    return [...commonPaths];
}

/**
 * Looks up a game by Steam app ID using appmanifest_XXXXX.acf.
 * Returns the install directory path or null.
 */
function findBySteamAppId(commonPaths, appId) {
    for (const commonPath of commonPaths) {
        const steamapps  = path.dirname(commonPath);
        const manifest   = path.join(steamapps, `appmanifest_${appId}.acf`);
        if (!fs.existsSync(manifest)) continue;
        try {
            const content = fs.readFileSync(manifest, 'utf8');
            const m = content.match(/"installdir"\s+"([^"]+)"/i);
            if (m) {
                const dir = path.join(commonPath, m[1]);
                if (fs.existsSync(dir)) return dir;
            }
        } catch {}
    }
    return null;
}

/**
 * Fuzzy folder-name search across all Steam common paths.
 */
function findByTitle(commonPaths, title, exeName) {
    const titleSlug  = title.toLowerCase().replace(/[^a-z0-9]/g, '');
    const titleWords = title.toLowerCase()
        .replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2);

    for (const commonPath of commonPaths) {
        let entries;
        try { entries = fs.readdirSync(commonPath); } catch { continue; }

        for (const entry of entries) {
            const entrySlug  = entry.toLowerCase().replace(/[^a-z0-9]/g, '');
            const shortTitle = titleSlug.slice(0, 8);
            const shortEntry = entrySlug.slice(0, 8);
            const overlap    = entrySlug.includes(shortTitle) || titleSlug.includes(shortEntry);
            const wordMatch  = titleWords.some(w => entrySlug.includes(w));
            if (!overlap && !wordMatch) continue;

            const fullPath = path.join(commonPath, entry);
            if (exeName) {
                if (fs.existsSync(path.join(fullPath, exeName))) return fullPath;
                // Check one subfolder level for games that nest their exe
                try {
                    for (const sub of fs.readdirSync(fullPath)) {
                        if (fs.existsSync(path.join(fullPath, sub, exeName))) return fullPath;
                    }
                } catch {}
            } else {
                return fullPath;
            }
        }
    }
    return null;
}

// ── GOG ──────────────────────────────────────────────────────────

function findGOGGame(title, exeName) {
    try {
        const { execSync } = require('child_process');
        
        // Try both 32-bit and 64-bit registry hives
        const regPaths = [
            'HKLM\\SOFTWARE\\GOG.com\\Games',
            'HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games'
        ];
        
        const titleSlug = title.toLowerCase().replace(/[^a-z0-9]/g, '');
        const titleWords = title.toLowerCase()
            .replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2);
        
        for (const regPath of regPaths) {
            try {
                const out = execSync(
                    `reg query "${regPath}" /s /v path`,
                    { encoding: 'utf8', timeout: 5000, stdio: ['pipe','pipe','pipe'] }
                );
                
                for (const m of out.matchAll(/path\s+REG_SZ\s+(.+)/gi)) {
                    const p    = m[1].trim();
                    const slug = p.toLowerCase().replace(/[^a-z0-9]/g, '');
                    
                    // Match if slug contains title, or title contains slug, or any word matches
                    const hasMatch = slug.includes(titleSlug.slice(0, 5)) || 
                                    titleSlug.includes(slug.slice(0, 5)) ||
                                    titleWords.some(w => slug.includes(w));
                    
                    if (!hasMatch) continue;
                    if (!exeName || fs.existsSync(path.join(p, exeName))) return p;
                }
            } catch {}
        }
    } catch {}
    return null;
}

// ── Epic ─────────────────────────────────────────────────────────

let _epicCache = null;
function getEpicInstalls() {
    if (_epicCache) return _epicCache;
    const dat = path.join(
        process.env.PROGRAMDATA || 'C:\\ProgramData',
        'Epic', 'UnrealEngineLauncher', 'LauncherInstalled.dat'
    );
    try {
        _epicCache = JSON.parse(fs.readFileSync(dat, 'utf8')).InstallationList || [];
        console.log(`[GameRegistry] Epic launcher found ${_epicCache.length} games`);
    } catch (e) {
        console.log('[GameRegistry] Epic launcher data not found or unreadable');
        _epicCache = [];
    }
    return _epicCache;
}

function findEpicGame(title, exeName) {
    const titleSlug = title.toLowerCase().replace(/[^a-z0-9]/g, '');
    const titleWords = title.toLowerCase()
        .replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2);
    
    for (const entry of getEpicInstalls()) {
        const slug    = (entry.AppName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const dirSlug = (entry.InstallLocation || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        
        // Improved matching: check app name or directory
        const hasMatch = slug.includes(titleSlug.slice(0, 5)) || 
                        dirSlug.includes(titleSlug.slice(0, 5)) ||
                        titleWords.some(w => slug.includes(w) || dirSlug.includes(w));
        
        if (!hasMatch) continue;
        
        const dir = entry.InstallLocation;
        if (!dir || !fs.existsSync(dir)) continue;
        if (!exeName || fs.existsSync(path.join(dir, exeName))) return dir;
    }
    return null;
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Scan for a single game.
 */
async function scanGame(title, exeName, steamAppId) {
    const steam = getSteamCommonPaths();

    if (steamAppId) {
        const p = findBySteamAppId(steam, String(steamAppId));
        if (p) return { found: true, path: p };
    }

    const byTitle = findByTitle(steam, title, exeName);
    if (byTitle) return { found: true, path: byTitle };

    const gog = findGOGGame(title, exeName);
    if (gog) return { found: true, path: gog };

    const epic = findEpicGame(title, exeName);
    if (epic) return { found: true, path: epic };

    return { found: false };
}

/**
 * Batch scan — much faster than calling scanGame() in a loop because
 * we enumerate each library folder only once.
 *
 * @param {Array<{ id, title, exeName, steamAppId }>} targets
 * @returns {Object} { [gameId]: installPath }
 */
async function scanAllGames(targets) {
    const steam   = getSteamCommonPaths();
    console.log('[GameRegistry] Scanning common paths:', steam);
    const results = {};

    // Pass 1: app ID lookups — fast, no directory enumeration
    const remaining = [];
    for (const t of targets) {
        if (t.steamAppId) {
            const p = findBySteamAppId(steam, String(t.steamAppId));
            if (p) { 
                console.log(`[GameRegistry] Found ${t.title} by Steam app ID: ${p}`);
                results[t.id] = p; 
                continue; 
            }
        }
        remaining.push(t);
    }

    if (remaining.length === 0) return results;

    // Pass 2: build a slug → path index once, then match all games against it
    const slugIndex = new Map();
    for (const commonPath of steam) {
        let entries;
        try { entries = fs.readdirSync(commonPath); } catch { continue; }
        for (const entry of entries) {
            const slug = entry.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (!slugIndex.has(slug)) slugIndex.set(slug, path.join(commonPath, entry));
        }
    }

    console.log(`[GameRegistry] Built index with ${slugIndex.size} directories`);

    for (const t of remaining) {
        const titleSlug  = t.title.toLowerCase().replace(/[^a-z0-9]/g, '');
        const titleWords = t.title.toLowerCase()
            .replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2);

        let found = null;
        for (const [slug, fullPath] of slugIndex) {
            const shortTitle = titleSlug.slice(0, 8);
            const shortSlug  = slug.slice(0, 8);
            if (!slug.includes(shortTitle) && !titleSlug.includes(shortSlug) &&
                !titleWords.some(w => slug.includes(w))) continue;

            if (t.exeName) {
                if (fs.existsSync(path.join(fullPath, t.exeName))) { 
                    found = fullPath;
                    console.log(`[GameRegistry] Found ${t.title} in Steam (exe match): ${fullPath}`);
                    break; 
                }
                try {
                    for (const sub of fs.readdirSync(fullPath)) {
                        if (fs.existsSync(path.join(fullPath, sub, t.exeName))) { 
                            found = fullPath;
                            console.log(`[GameRegistry] Found ${t.title} in Steam (exe in subfolder): ${fullPath}`);
                            break; 
                        }
                    }
                } catch {}
                if (found) break;
            } else {
                found = fullPath; 
                console.log(`[GameRegistry] Found ${t.title} in Steam (path match): ${fullPath}`);
                break;
            }
        }

        if (found) { results[t.id] = found; continue; }

        const gog = findGOGGame(t.title, t.exeName);
        if (gog) { 
            console.log(`[GameRegistry] Found ${t.title} via GOG: ${gog}`);
            results[t.id] = gog; 
            continue; 
        }
        
        const epic = findEpicGame(t.title, t.exeName);
        if (epic) {
            console.log(`[GameRegistry] Found ${t.title} via Epic: ${epic}`);
            results[t.id] = epic;
        } else {
            console.log(`[GameRegistry] NOT FOUND: ${t.title} (exe: ${t.exeName})`);
        }
    }

    console.log(`[GameRegistry] Scan complete: ${Object.keys(results).length} / ${targets.length} games found`);
    return results;
}

module.exports = { scanGame, scanAllGames };