'use strict';
/**
 * modules/appPaths.js
 *
 * Where Stereopticon keeps files it downloads at runtime (tools such as wiz3D).
 *
 *   Development (npm start, Stereopticon.cmd): <project>/resources/<tool>/
 *   Packaged build:                            %APPDATA%/Stereopticon/tools/<tool>/
 *
 * A packaged app's own folder is read-only (and may be inside an asar
 * archive), so downloads have to live in the user's data folder.
 * STEREOPTICON_DATA_DIR overrides both, which the tests use.
 */

const path = require('path');

let electronApp = null;
try {
    // Under plain Node (scripts, tests) require('electron') returns the path
    // to the Electron binary, so .app is undefined there.
    electronApp = require('electron').app || null;
} catch { /* not running under Electron */ }

const PROJECT_ROOT = path.join(__dirname, '..');

function isPackaged() {
    return !!(electronApp && electronApp.isPackaged);
}

function toolsRoot() {
    if (process.env.STEREOPTICON_DATA_DIR) return path.join(process.env.STEREOPTICON_DATA_DIR, 'tools');
    if (isPackaged()) return path.join(electronApp.getPath('userData'), 'tools');
    return path.join(PROJECT_ROOT, 'resources');
}

function toolDir(name) {
    return path.join(toolsRoot(), name);
}

module.exports = { PROJECT_ROOT, isPackaged, toolsRoot, toolDir };
