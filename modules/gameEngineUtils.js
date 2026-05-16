'use strict';
/**
 * modules/gameEngineUtils.js
 *
 * Ported from Rai Pal (GPL v3) — raicuparta/rai-pal
 * Original Rust source: backend/core/src/game_engines/unreal.rs, unity.rs
 *
 * Provides:
 *   findUnrealShippingExe(launchExePath)  — locate the actual UE shipping binary
 *   isUnrealGame(exePath)                 — detect Unreal Engine folder structure
 *   isUnityGame(exePath)                  — detect Unity _Data folder structure
 *   getUnityBackend(exePath)              — Il2Cpp vs Mono
 *   waitForProcessAndInject(exeName, injectorPath, uevrDir, timeoutMs)
 *                                         — UEVR injection watcher (Rai Pal pattern)
 */

const fs         = require('fs');
const path       = require('path');
const { spawn, execFileSync } = require('child_process');

// ── Unreal: detect and find shipping exe ──────────────────────

/**
 * Returns true if the folder structure looks like an Unreal game.
 * Checks both:
 *   - Root launcher pattern: Engine/Binaries/Win64 or Win32 exists as sibling
 *   - Shipping binary pattern: exe is inside a Binaries/Win64 folder
 *
 * Ported from: unreal.rs → is_unreal_exe()
 */
function isUnrealGame(exePath) {
    if (!fs.existsSync(exePath)) return false;
    const parent = path.dirname(exePath);
    const parentName = path.basename(parent);

    // Pattern 1: launcher exe at root, Engine/Binaries/Win64 exists as sibling
    const validFolders = ['Win64', 'Win32', 'ThirdParty'];
    for (const folder of validFolders) {
        if (fs.existsSync(path.join(parent, 'Engine', 'Binaries', folder))) return true;
    }

    // Pattern 2: exe is directly inside a Binaries/Win64 (or Win32/WinGDK) folder
    const validWinFolders = ['Win64', 'Win32', 'WinGDK'];
    if (validWinFolders.includes(parentName)) {
        const binaries = path.dirname(parent);
        if (path.basename(binaries) === 'Binaries') return true;
    }

    return false;
}

/**
 * Given a game exe path (possibly a launcher), find the actual Unreal shipping exe.
 * Falls back to the given exe if nothing better is found.
 *
 * Ported from: unreal.rs → get_shipping_exe()
 *
 * Priority:
 *   1. If given exe IS in a Win64/Win32/WinGDK folder and ends in -Shipping.exe → use it
 *   2. If given exe IS in a Win64 folder but isn't shipping → find sibling *Shipping.exe
 *   3. Otherwise (root launcher) → search GameName/Binaries/Win{64,32,GDK}/*.exe
 *      preferring *Shipping.exe if multiple found
 */
function findUnrealShippingExe(launchExePath) {
    if (!fs.existsSync(launchExePath)) return launchExePath;

    const parent     = path.dirname(launchExePath);
    const parentName = path.basename(parent);
    const exeName    = path.basename(launchExePath);
    const validWin   = ['Win64', 'Win32', 'WinGDK'];

    // Case 1 & 2: already in a Win* folder
    if (validWin.includes(parentName)) {
        // Already the shipping exe
        if (exeName.endsWith('-Shipping.exe') || exeName.endsWith('Shipping.exe')) {
            return launchExePath;
        }
        // Look for a sibling shipping exe
        const siblings = safeReadDir(parent).filter(f =>
            f.endsWith('-Shipping.exe') || f.endsWith('Shipping.exe')
        );
        if (siblings.length > 0) return path.join(parent, siblings[0]);
        // No sibling found — return what we have
        return launchExePath;
    }

    // Case 3: root-level launcher — dig into GameName/Binaries/Win64/
    // The immediate children of parent are game name folders (not "Engine")
    const candidates = [];
    for (const child of safeReadDir(parent)) {
        if (child === 'Engine') continue;
        const childPath = path.join(parent, child);
        if (!isDir(childPath)) continue;
        for (const winFolder of validWin) {
            const binPath = path.join(childPath, 'Binaries', winFolder);
            if (!isDir(binPath)) continue;
            for (const exe of safeReadDir(binPath)) {
                if (exe.endsWith('.exe')) {
                    candidates.push({ file: path.join(binPath, exe), isShipping: exe.includes('Shipping') });
                }
            }
        }
    }

    if (candidates.length === 0) return launchExePath;
    const shipping = candidates.find(c => c.isShipping);
    return (shipping || candidates[0]).file;
}

// ── Unity: detect backend ────────────────────────────────────

/**
 * Returns true if exePath looks like a Unity game
 * (checks for the GameName_Data folder next to the exe).
 * Ported from: unity.rs → is_unity_exe()
 */
function isUnityGame(exePath) {
    if (!fs.existsSync(exePath)) return false;
    const parent   = path.dirname(exePath);
    const stem     = path.basename(exePath, path.extname(exePath));
    const dataPath = path.join(parent, `${stem}_Data`);
    return isDir(dataPath);
}

/**
 * Returns 'il2cpp' | 'mono' | null
 * Ported from: unity.rs → get_unity_backend()
 */
function getUnityBackend(exePath) {
    const parent = path.dirname(exePath);
    if (fs.existsSync(path.join(parent, 'GameAssembly.dll')) ||
        fs.existsSync(path.join(parent, 'GameAssembly.so'))) {
        return 'il2cpp';
    }
    // If no GameAssembly.dll, it's likely Mono
    return 'mono';
}

// ── UEVR: process watcher + injector ─────────────────────────

/**
 * Rai Pal injection pattern:
 * Rather than launching the injector with --attach (unconfirmed flag),
 * we watch for the game process to appear, then call the injector's
 * command-line inject interface.
 *
 * UEVR's CLI injection via UEVRInjector.exe:
 *   UEVRInjector.exe [game.exe name without extension]
 *   (or) UEVRInjector.exe --inject [game.exe name]
 *
 * This function:
 *   1. Polls the process list every 500ms for up to timeoutMs
 *   2. When the game process appears, waits an additional stabilizeMs for it to load
 *   3. Launches UEVRInjector.exe targeting that process
 *
 * @param {string}   exeName       — just the filename, e.g. "Game-Win64-Shipping.exe"
 * @param {string}   injectorPath  — full path to UEVRInjector.exe
 * @param {string}   uevrDir       — working directory for injector
 * @param {object}   opts
 * @param {number}   opts.timeoutMs    — how long to wait for the process (default 60s)
 * @param {number}   opts.stabilizeMs  — how long to wait after detection before injecting (default 4s)
 * @param {function} opts.onStatus     — callback(string) for status updates
 * @returns {Promise<{success: bool, message: string}>}
 */
function waitForProcessAndInject(exeName, injectorPath, uevrDir, opts = {}) {
    const {
        timeoutMs   = 60_000,
        stabilizeMs = 4_000,
        onStatus    = () => {},
    } = opts;

    const exeBaseName = path.basename(exeName);           // "Game-Win64-Shipping.exe"
    const processName = exeBaseName.replace(/\.exe$/i, ''); // "Game-Win64-Shipping"

    return new Promise((resolve) => {
        onStatus(`Waiting for ${exeBaseName} to start…`);

        const pollInterval = 500;
        let elapsed       = 0;
        let detected      = false;

        const poll = setInterval(() => {
            elapsed += pollInterval;

            if (elapsed > timeoutMs) {
                clearInterval(poll);
                resolve({ success: false, message: `Timed out waiting for ${exeBaseName} to start.` });
                return;
            }

            if (!isProcessRunning(exeBaseName)) return;
            if (detected) return; // already found, waiting to stabilize
            detected = true;
            clearInterval(poll);

            onStatus(`${exeBaseName} detected — waiting ${stabilizeMs / 1000}s for game to load…`);
            setTimeout(() => {
                onStatus(`Injecting UEVR…`);
                try {
                    injectUEVR(injectorPath, uevrDir, exeBaseName);
                    resolve({ success: true, message: `UEVR injected into ${exeBaseName}` });
                } catch (e) {
                    resolve({ success: false, message: `Injection failed: ${e.message}` });
                }
            }, stabilizeMs);
        }, pollInterval);
    });
}

/**
 * Call UEVRInjector.exe to inject into a running process.
 * UEVRInjector accepts the exe name (with or without .exe) as positional arg.
 */
function injectUEVR(injectorPath, uevrDir, exeBaseName) {
    if (!fs.existsSync(injectorPath)) {
        throw new Error(`UEVRInjector.exe not found at ${injectorPath}`);
    }
    // Spawn detached so the injector closes after injection
    const child = spawn(injectorPath, [exeBaseName], {
        detached: true,
        stdio:    'ignore',
        cwd:      uevrDir,
        shell:    false,
    });
    child.on('error', err => console.error('UEVRInjector error:', err.message));
    child.unref();
}

/**
 * Check if a process is running by name using WMIC.
 * Returns true/false synchronously.
 */
function isProcessRunning(exeBaseName) {
    try {
        const name = exeBaseName.replace(/\.exe$/i, '');
        const out  = execFileSync('tasklist', ['/FI', `IMAGENAME eq ${exeBaseName}`, '/NH'], {
            encoding: 'utf8',
            timeout:  2000,
            stdio:    ['ignore', 'pipe', 'ignore'],
        });
        return out.toLowerCase().includes(name.toLowerCase());
    } catch {
        return false;
    }
}

// ── Helpers ───────────────────────────────────────────────────

function safeReadDir(dir) {
    try { return fs.readdirSync(dir); } catch { return []; }
}

function isDir(p) {
    try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

// ── Exports ───────────────────────────────────────────────────

module.exports = {
    isUnrealGame,
    findUnrealShippingExe,
    isUnityGame,
    getUnityBackend,
    waitForProcessAndInject,
    isProcessRunning,
};