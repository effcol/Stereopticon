'use strict';
/**
 * modules/wiz3dManager.js
 *
 * Downloads and updates wiz3D itself from its GitHub releases (effcol/wiz3D).
 *
 * Layout under appPaths.toolDir('wiz3d'):
 *   versions/<tag>/      one extracted release, without its top "wiz3D/" folder
 *   current.json         { tag, name, installedAt } of the version in use
 *
 * The two most recent versions are kept, so a broken new release can be
 * rolled back by editing current.json.
 */

const fs     = require('fs');
const path   = require('path');
const https  = require('https');
const AdmZip = require('adm-zip');
const { toolDir } = require('./appPaths');

const REPO       = 'effcol/wiz3D';
const USER_AGENT = 'Stereopticon';
const KEEP_VERSIONS = 2;

const rootDir     = () => toolDir('wiz3d');
const versionsDir = () => path.join(rootDir(), 'versions');
const currentFile = () => path.join(rootDir(), 'current.json');

function readCurrent() {
    try {
        const cur = JSON.parse(fs.readFileSync(currentFile(), 'utf8'));
        const dir = path.join(versionsDir(), cur.tag);
        return fs.existsSync(dir) ? { ...cur, dir } : null;
    } catch {
        return null;
    }
}

/** Folder of the wiz3D version in use, or null if none is installed. */
function currentDir() {
    return readCurrent()?.dir || null;
}

// ── Network ───────────────────────────────────────────────────

function request(url, { json = false, redirects = 5 } = {}) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, {
            headers: {
                'User-Agent': USER_AGENT,
                ...(json ? { Accept: 'application/vnd.github+json' } : {}),
            },
        }, res => {
            if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
                res.resume();
                resolve(request(new URL(res.headers.location, url).toString(), { json, redirects: redirects - 1 }));
                return;
            }
            if (res.statusCode !== 200) {
                res.resume();
                const hint = res.statusCode === 403 ? ' (GitHub rate limit; try again in an hour)' : '';
                reject(new Error(`GitHub returned HTTP ${res.statusCode} for ${url}${hint}`));
                return;
            }
            resolve(res);
        });
        req.setTimeout(30000, () => req.destroy(new Error(`Timed out connecting to ${new URL(url).host}`)));
        req.on('error', reject);
    });
}

async function fetchJson(url) {
    const res = await request(url, { json: true });
    let body = '';
    for await (const chunk of res) body += chunk;
    return JSON.parse(body);
}

/** Latest published release: { tag, name, publishedAt, assetName, assetUrl, size }. */
async function getLatestRelease() {
    const rel = await fetchJson(`https://api.github.com/repos/${REPO}/releases/latest`);
    const asset = (rel.assets || []).find(a => /\.zip$/i.test(a.name));
    if (!asset) throw new Error(`wiz3D release ${rel.tag_name} has no .zip download`);
    return {
        tag:         rel.tag_name,
        name:        rel.name || rel.tag_name,
        publishedAt: rel.published_at,
        assetName:   asset.name,
        assetUrl:    asset.browser_download_url,
        size:        asset.size,
    };
}

async function download(url, dest, size, onProgress) {
    const res = await request(url);
    const total = Number(res.headers['content-length']) || size || 0;
    let done = 0;
    await new Promise((resolve, reject) => {
        const out = fs.createWriteStream(dest);
        res.on('data', chunk => {
            done += chunk.length;
            if (total) onProgress({ stage: 'download', percent: Math.round(done / total * 100), done, total });
        });
        res.on('error', reject);
        out.on('error', reject);
        out.on('finish', resolve);
        res.pipe(out);
    });
    if (total && done !== total) throw new Error(`Download incomplete (${done} of ${total} bytes)`);
}

// ── Install ───────────────────────────────────────────────────

// Extract a release zip, dropping its single top-level folder ("wiz3D/").
function extractRelease(zipPath, destDir) {
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries().filter(e => !e.isDirectory);
    const tops = new Set(entries.map(e => e.entryName.split('/')[0]));
    const strip = tops.size === 1 && entries.every(e => e.entryName.includes('/')) ? [...tops][0] + '/' : '';
    for (const e of entries) {
        const rel = strip ? e.entryName.slice(strip.length) : e.entryName;
        const out = path.join(destDir, rel);
        const back = path.relative(destDir, out);
        if (!rel || back.startsWith('..') || path.isAbsolute(back)) continue;   // never write outside destDir
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, e.getData());
    }
}

function pruneOldVersions(keepTag) {
    let dirs;
    try { dirs = fs.readdirSync(versionsDir(), { withFileTypes: true }).filter(d => d.isDirectory()); }
    catch { return; }
    const byAge = dirs
        .map(d => ({ name: d.name, mtime: fs.statSync(path.join(versionsDir(), d.name)).mtimeMs }))
        .filter(d => d.name !== keepTag && !d.name.endsWith('.partial'))
        .sort((a, b) => b.mtime - a.mtime);
    for (const d of byAge.slice(KEEP_VERSIONS - 1)) {
        fs.rmSync(path.join(versionsDir(), d.name), { recursive: true, force: true });
    }
}

/**
 * Download and switch to a release (the latest when none is given).
 * onProgress receives { stage: 'check'|'download'|'extract'|'done', percent, message }.
 */
async function installRelease(release = null, onProgress = () => {}) {
    onProgress({ stage: 'check', percent: 0, message: 'Checking the latest wiz3D release…' });
    const rel = release || await getLatestRelease();

    const finalDir = path.join(versionsDir(), rel.tag);
    if (!fs.existsSync(finalDir)) {
        const partial = finalDir + '.partial';
        const zipPath = path.join(versionsDir(), `${rel.tag}.zip`);
        fs.mkdirSync(versionsDir(), { recursive: true });
        fs.rmSync(partial, { recursive: true, force: true });
        try {
            await download(rel.assetUrl, zipPath, rel.size, p =>
                onProgress({ ...p, message: `Downloading wiz3D ${rel.tag}… ${p.percent}%` }));
            onProgress({ stage: 'extract', percent: 100, message: `Extracting wiz3D ${rel.tag}…` });
            extractRelease(zipPath, partial);
            fs.renameSync(partial, finalDir);
        } finally {
            fs.rmSync(zipPath, { force: true });
            fs.rmSync(partial, { recursive: true, force: true });
        }
    }

    fs.writeFileSync(currentFile(), JSON.stringify({
        tag: rel.tag, name: rel.name, installedAt: new Date().toISOString(),
    }, null, 2));
    pruneOldVersions(rel.tag);
    onProgress({ stage: 'done', percent: 100, message: `wiz3D ${rel.tag} ready` });
    return { tag: rel.tag, name: rel.name, dir: finalDir };
}

/** Installed wiz3D, downloading the latest release first if there is none. */
async function ensureInstalled(onProgress) {
    return readCurrent() || installRelease(null, onProgress);
}

/**
 * { installed: {tag,name,installedAt}|null, latest: {...}|null, updateAvailable, error }
 * The network check is skipped when offline; `error` then says why.
 */
async function status({ checkOnline = true } = {}) {
    const installed = readCurrent();
    let latest = null, error = null;
    if (checkOnline) {
        try { latest = await getLatestRelease(); }
        catch (e) { error = e.message; }
    }
    const info = installed && { tag: installed.tag, name: installed.name, installedAt: installed.installedAt };
    return {
        installed: info || null,
        latest,
        updateAvailable: !!(latest && (!installed || installed.tag !== latest.tag)),
        error,
    };
}

module.exports = { currentDir, getLatestRelease, installRelease, ensureInstalled, status, extractRelease };
