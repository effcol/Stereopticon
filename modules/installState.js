/**
 * installState.js
 *
 * Tracks which fixes are installed and where.
 * Stored at: ~/.stereopticon/installed.json
 *
 * Schema:
 * {
 *   "fix_id": {
 *     "fixId": "falloutshelter_geo11",
 *     "gameId": "fallout_shelter",
 *     "gamePath": "C:\\Games\\Fallout Shelter",
 *     "installedAt": "2025-01-01T00:00:00.000Z",
 *     "downloadUrl": "https://..."
 *   }
 * }
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const STATE_PATH = path.join(os.homedir(), '.stereopticon', 'installed.json');

function ensureDir(p) {
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function loadState() {
    if (!fs.existsSync(STATE_PATH)) return {};
    try {
        return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    } catch {
        return {};
    }
}

function saveState(state) {
    ensureDir(path.dirname(STATE_PATH));
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function markInstalled(fixId, gameId, gamePath, downloadUrl, extra = {}) {
    const state = loadState();
    state[fixId] = {
        fixId,
        gameId,
        gamePath,
        downloadUrl: downloadUrl || null,
        installedAt: new Date().toISOString(),
        ...extra,               // e.g. { pendingGuide: true } for UEVR
    };
    saveState(state);
}

function setInstallExtra(fixId, extra) {
    const state = loadState();
    if (!state[fixId]) return;
    Object.assign(state[fixId], extra);
    saveState(state);
}

function markUninstalled(fixId) {
    const state = loadState();
    delete state[fixId];
    saveState(state);
}

function isInstalled(fixId) {
    return !!loadState()[fixId];
}

function getInstallRecord(fixId) {
    return loadState()[fixId] || null;
}

// Returns set of gameIds that have at least one fix installed
function getInstalledGameIds() {
    const state = loadState();
    return new Set(Object.values(state).map(r => r.gameId));
}

// Returns all installed fix records
function getAllInstalled() {
    return loadState();
}

module.exports = {
    markInstalled,
    markUninstalled,
    isInstalled,
    getInstallRecord,
    getInstalledGameIds,
    getAllInstalled,
    setInstallExtra,
};