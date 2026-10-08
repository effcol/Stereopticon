/**
 * installManifest.js
 *
 * Records exactly what an install changed in a game folder so uninstall can
 * undo that and nothing else.
 *
 * Stored at: ~/.stereopticon/backups/<fixId>/
 *   manifest.json   what the install added and replaced
 *   files/<rel>     original copies of the files it replaced
 *
 * Usage:
 *   const session = begin(fixId, gamePath);
 *   ... run the installer, calling session.beforeWrite(absPath) where possible ...
 *   finish(session);                 // on success: writes / merges the manifest
 *   finish(session, { rollback: true });   // on failure: undoes this session
 *
 * The manifest is built by comparing the folder before and after, so it also
 * covers installers that give no per-file hook (7z extraction, ReShade).
 * Originals can only be restored if they were copied before being overwritten:
 * that happens for every beforeWrite() call and, up front, for the top-level
 * files a fix is most likely to replace (hook DLLs and small config files).
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const BACKUP_ROOT = path.join(os.homedir(), '.stereopticon', 'backups');

// Top-level files backed up before any install, because fixes commonly replace them.
const AT_RISK_NAMES = new Set([
    'd3d8.dll', 'd3d9.dll', 'd3d10.dll', 'd3d10_1.dll', 'd3d11.dll', 'd3d12.dll',
    'dxgi.dll', 'ddraw.dll', 'opengl32.dll', 'dinput.dll', 'dinput8.dll',
    'winmm.dll', 'version.dll',
    'd3dcompiler_43.dll', 'd3dcompiler_46.dll', 'd3dcompiler_47.dll',
    'nvapi.dll', 'nvapi32.dll', 'nvapi64.dll',
]);
const AT_RISK_EXTS     = new Set(['.ini', '.xml', '.cfg', '.json']);
const AT_RISK_MAX_SIZE = 2 * 1024 * 1024;

// Files and folders a tool writes at runtime, so they are never in a manifest.
// Only removed when the manifest shows that tool was installed.
const GEO11_TYPES     = ['geo11', 'geo12', '3dmigoto', 'helixmod'];
const GEO11_GENERATED = ['d3d11_log.txt', 'nvapi_log.txt', 'ShaderCache', 'ShaderCacheDM',
                         'DMAutoPatchCache', 'DMAutoPatchFailures'];
const RESHADE_GENERATED = ['ReShade.log'];

const toRel = p => p.split(path.sep).join('/');

function fixDir(fixId) {
    return path.join(BACKUP_ROOT, String(fixId).replace(/[^A-Za-z0-9._-]/g, '_'));
}

function loadManifest(fixId) {
    const p = path.join(fixDir(fixId), 'manifest.json');
    if (!fs.existsSync(p)) return null;
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
    catch { return null; }
}

function saveManifest(fixId, manifest) {
    fs.mkdirSync(fixDir(fixId), { recursive: true });
    fs.writeFileSync(path.join(fixDir(fixId), 'manifest.json'), JSON.stringify(manifest, null, 2));
}

// Recursive listing of a folder: every file with its size and mtime, plus every directory.
function snapshot(root) {
    const files = new Map();
    const dirs  = new Set();
    const stack = [''];
    while (stack.length) {
        const rel = stack.pop();
        let entries;
        try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); }
        catch { continue; }
        for (const e of entries) {
            const childRel = rel ? `${rel}/${e.name}` : e.name;
            if (e.isDirectory()) {
                dirs.add(childRel);
                stack.push(childRel);
            } else if (e.isFile()) {
                try {
                    const st = fs.statSync(path.join(root, childRel));
                    files.set(childRel, { size: st.size, mtimeMs: st.mtimeMs });
                } catch { /* vanished or unreadable */ }
            }
        }
    }
    return { files, dirs };
}

function begin(fixId, gamePath) {
    const staging = path.join(fixDir(fixId), 'staging');
    fs.rmSync(staging, { recursive: true, force: true });

    const session = {
        fixId,
        gamePath,
        staging,
        before: snapshot(gamePath),
        staged: new Set(),
    };

    // Copy the current version of a file aside, once, if it exists.
    const stage = rel => {
        if (session.staged.has(rel) || !session.before.files.has(rel)) return;
        const dest = path.join(staging, rel);
        try {
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.copyFileSync(path.join(gamePath, rel), dest);
            session.staged.add(rel);
        } catch { /* unreadable: treated as not backed up */ }
    };

    session.beforeWrite = absPath => {
        const rel = toRel(path.relative(gamePath, absPath));
        if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return;
        stage(rel);
    };

    for (const [rel, info] of session.before.files) {
        if (rel.includes('/')) continue;
        const lower = rel.toLowerCase();
        if (AT_RISK_NAMES.has(lower) ||
            (AT_RISK_EXTS.has(path.extname(lower)) && info.size <= AT_RISK_MAX_SIZE)) {
            stage(rel);
        }
    }
    return session;
}

function diff(session) {
    const after = snapshot(session.gamePath);
    const added = [], changed = [], addedDirs = [];
    for (const [rel, info] of after.files) {
        const prev = session.before.files.get(rel);
        if (!prev) added.push(rel);
        else if (prev.size !== info.size || prev.mtimeMs !== info.mtimeMs) changed.push(rel);
    }
    for (const d of after.dirs) if (!session.before.dirs.has(d)) addedDirs.push(d);
    return { added, changed, addedDirs };
}

// Remove directories that are now empty, deepest first.
function removeEmptyDirs(gamePath, dirs) {
    [...dirs].sort((a, b) => b.length - a.length).forEach(d => {
        try { fs.rmdirSync(path.join(gamePath, d)); } catch { /* not empty or already gone */ }
    });
}

function finish(session, { rollback = false } = {}) {
    const { fixId, gamePath, staging } = session;
    const { added, changed, addedDirs } = diff(session);

    if (rollback) {
        for (const rel of added) {
            try { fs.unlinkSync(path.join(gamePath, rel)); } catch { /* leave it */ }
        }
        for (const rel of changed) {
            if (!session.staged.has(rel)) continue;
            try { fs.copyFileSync(path.join(staging, rel), path.join(gamePath, rel)); } catch { /* leave it */ }
        }
        removeEmptyDirs(gamePath, addedDirs);
        fs.rmSync(staging, { recursive: true, force: true });
        return null;
    }

    const manifest = loadManifest(fixId) || {
        version: 1, fixId, gamePath, added: [], replaced: [], unrecoverable: [], addedDirs: [],
    };
    manifest.gamePath = gamePath;
    const has = (list, rel) => manifest[list].includes(rel);

    for (const rel of added) {
        if (!has('added', rel) && !has('replaced', rel)) manifest.added.push(rel);
    }
    for (const rel of changed) {
        // Already ours, or already backed up by an earlier step of the same fix.
        if (has('added', rel) || has('replaced', rel)) continue;
        if (session.staged.has(rel)) {
            const kept = path.join(fixDir(fixId), 'files', rel);
            fs.mkdirSync(path.dirname(kept), { recursive: true });
            fs.copyFileSync(path.join(staging, rel), kept);
            manifest.replaced.push(rel);
        } else if (!has('unrecoverable', rel)) {
            manifest.unrecoverable.push(rel);
        }
    }
    for (const d of addedDirs) if (!has('addedDirs', d)) manifest.addedDirs.push(d);

    fs.rmSync(staging, { recursive: true, force: true });
    saveManifest(fixId, manifest);
    return manifest;
}

/**
 * Undo an install from its manifest.
 * Returns null when the fix has no manifest (installed before manifests existed).
 */
function uninstall(fixId, fixType) {
    const manifest = loadManifest(fixId);
    if (!manifest) return null;

    const gamePath = manifest.gamePath;
    if (!gamePath || !fs.existsSync(gamePath)) {
        return { success: false, removed: [], restored: [], locked: [],
                 message: `Game folder not found:\n${gamePath}` };
    }

    const removed = [], restored = [], locked = [];
    const remaining = { added: [], replaced: [] };

    for (const rel of manifest.added) {
        try { fs.unlinkSync(path.join(gamePath, rel)); removed.push(rel); }
        catch (e) {
            if (e.code !== 'ENOENT') { locked.push(`${rel} (${e.code})`); remaining.added.push(rel); }
        }
    }
    for (const rel of manifest.replaced) {
        try {
            fs.copyFileSync(path.join(fixDir(fixId), 'files', rel), path.join(gamePath, rel));
            restored.push(rel);
        } catch (e) {
            locked.push(`${rel} (${e.code})`);
            remaining.replaced.push(rel);
        }
    }

    if (locked.length) {
        // Keep what is still outstanding so a retry finishes the job.
        saveManifest(fixId, { ...manifest, ...remaining });
        return { success: false, removed, restored, locked };
    }

    const generated = [];
    if (GEO11_TYPES.includes(fixType)) generated.push(...GEO11_GENERATED);
    if (manifest.added.some(rel => rel.toLowerCase() === 'reshade.ini')) generated.push(...RESHADE_GENERATED);
    for (const name of generated) {
        const p = path.join(gamePath, name);
        if (!fs.existsSync(p)) continue;
        try { fs.rmSync(p, { recursive: true, force: true }); removed.push(name); }
        catch { /* runtime artefact: not worth failing the uninstall over */ }
    }

    removeEmptyDirs(gamePath, manifest.addedDirs);
    fs.rmSync(fixDir(fixId), { recursive: true, force: true });
    return { success: true, removed, restored, locked, unrecoverable: manifest.unrecoverable };
}

module.exports = { begin, finish, uninstall, loadManifest, GEO11_TYPES };
