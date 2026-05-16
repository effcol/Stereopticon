/**
 * iniEditor.js
 *
 * Reads and writes Geo-11 d3dxdm.ini files.
 *
 * Philosophy:
 *   - The ini file on disk is always the live state.
 *   - On first open of a fix, we snapshot the fix-author's values to
 *     ~/.stereopticon/defaults/{fix_id}.json — these are the "fix defaults"
 *     shown in the UI as a reference.
 *   - User overrides are stored in ~/.stereopticon/overrides/{fix_id}.json.
 *     These persist across fix updates (the ini could be overwritten but the
 *     user's preferred values are safe).
 *   - We never reformat or reorder the ini — we only patch matching key lines
 *     in-place, preserving comments, section order, and whitespace exactly.
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const BASE_DIR     = path.join(os.homedir(), '.stereopticon');
const DEFAULTS_DIR = path.join(BASE_DIR, 'defaults');
const OVERRIDES_DIR = path.join(BASE_DIR, 'overrides');

function ensureDir(p) {
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

// ─── INI PARSING ─────────────────────────────────────────────
// Returns a flat map of key → { value, lineIndex, raw }
// Only processes key=value lines. Comments and section headers are preserved
// in the raw lines array but not surfaced in the map.

function parseIni(content) {
    const lines  = content.split(/\r?\n/);
    const values = {};

    lines.forEach((line, i) => {
        const stripped = line.trim();
        if (!stripped || stripped.startsWith(';') || stripped.startsWith('[')) return;

        const eq = line.indexOf('=');
        if (eq === -1) return;

        const key   = line.slice(0, eq).trim().toLowerCase();
        const value = line.slice(eq + 1).trim();

        // Last definition wins (mimics how Geo-11 reads the file)
        values[key] = { value, lineIndex: i, raw: line };
    });

    return { lines, values };
}

// ─── INI WRITING ─────────────────────────────────────────────
// Patches specific keys in the raw lines array, preserving everything else.
// If a key doesn't exist, appends it under a [Stereopticon] section at the end.

function applyPatchesToLines(lines, values, patches) {
    const patchedKeys   = new Set();
    const updatedLines  = lines.map(line => {
        const stripped = line.trim();
        if (!stripped || stripped.startsWith(';') || stripped.startsWith('[')) return line;
        const eq = line.indexOf('=');
        if (eq === -1) return line;

        const key = line.slice(0, eq).trim().toLowerCase();
        if (patches.hasOwnProperty(key)) {
            patchedKeys.add(key);
            // Preserve original spacing style: "key = value" or "key=value"
            const beforeEq = line.slice(0, eq);
            const afterEq  = line.slice(eq + 1);
            const hasSpace  = afterEq.startsWith(' ');
            return `${beforeEq}=${hasSpace ? ' ' : ''}${patches[key]}`;
        }
        return line;
    });

    // Append any keys we didn't find in the file
    const missing = Object.keys(patches).filter(k => !patchedKeys.has(k));
    if (missing.length > 0) {
        updatedLines.push('');
        updatedLines.push('; Added by Stereopticon');
        missing.forEach(k => updatedLines.push(`${k} = ${patches[k]}`));
    }

    return updatedLines;
}

// ─── KNOWN FIELDS ────────────────────────────────────────────
// The fields we expose in the UI, with metadata for rendering.

const KNOWN_FIELDS = {
    // ── Stereo depth controls (always accessible, top of modal) ──────────
    dm_separation: {
        label:   'Separation',
        type:    'range',
        min: 0, max: 100, step: 0.5,
        section: 'stereo',
        tip: 'Stereo depth / eye distance. Fix author defaults are tuned per-game — unlock advanced to override.',
    },
    dm_convergence: {
        label:   'Convergence',
        type:    'range',
        min: 0, max: 5000, step: 1,
        section: 'stereo',
        tip: 'Screen-plane position. Objects below this distance appear in front of the screen, above appear behind. Fix defaults are tuned carefully.',
    },
    dm_auto_convergence: {
        label:   'Auto-Convergence',
        type:    'checkbox',
        section: 'stereo',
        tip: 'Lets Geo-11 auto-adjust convergence from scene depth. Disable to lock to manual presets (F1/F2/F3 in-game).',
        trueValue: '1', falseValue: '0',
    },
    dm_hoz_depth_culling: {
        label:   'Horizon Depth Culling',
        type:    'checkbox',
        section: 'stereo',
        tip: 'Clips geometry at the sky/horizon to reduce depth artifacts at distant/sky boundaries.',
        trueValue: '1', falseValue: '0',
    },
    // ── Output — advanced (locked by default; set via main UI instead) ────
    direct_mode: {
        label:   'Output Mode (advanced)',
        type:    'select',
        options: [
            { value: 'sbs',          label: 'Side-by-Side (SBS)' },
            { value: 'tab',          label: 'Top-and-Bottom (TAB)' },
            { value: 'interlaced',   label: 'Interlaced / Row' },
            { value: 'checkerboard', label: 'Checkerboard' },
            { value: 'anaglyph',     label: 'Anaglyph' },
            { value: 'nvidia_dx11',  label: '3D Vision (nvidia_dx11)' },
            { value: 'nvidia_dx9',   label: '3D Vision DX9 (nvidia_dx9)' },
            { value: 'katanga_vr',   label: 'HelixVision VR (katanga_vr)' },
            { value: 'leia',         label: 'Leia / SR Weave' },
        ],
        section: 'output',
        tip: 'Normally set automatically by Stereopticon when you pick a display mode. Only override if something is wrong.',
    },
    // ── Developer / hunting (locked by default) ──────────────────────────
    hunting: {
        label:   'Hunting Mode',
        type:    'select',
        section: 'hunting',
        tip: `Master hunting mode value written to d3dxdm.ini. Use the individual mode toggles below instead of setting this directly.`,
        options: [
            { value: '0', label: '0 — Normal play (default)' },
            { value: '1', label: '1 — Convergence preset cycling (F1 / F2 / F3)' },
            { value: '2', label: '2 — Separation adjust (numpad +/-)' },
            { value: '3', label: '3 — Shader index hunt (mod authors only)' },
        ],
        hidden: true,
    },
    hunting_normal: {
        label:   '0 · Normal Play',
        type:    'info',
        section: 'hunting',
        tip:     'The default mode. Geo-11 runs normally — no hunting keys active. Always return here when done tuning.',
    },
    hunting_convergence: {
        label:   '1 · Convergence Tuning',
        type:    'hunting_toggle',
        huntingValue: '1',
        section: 'hunting',
        tip:     'Press F1 / F2 / F3 in-game to cycle through convergence presets. Useful for finding the ideal screen-plane depth for a scene. Set hunting back to 0 when done.',
    },
    hunting_separation: {
        label:   '2 · Separation Tuning',
        type:    'hunting_toggle',
        huntingValue: '2',
        section: 'hunting',
        tip:     'Use numpad + / − to adjust eye separation in real time. Useful for finding the best depth range for a game. Set hunting back to 0 when done.',
    },
    hunting_shader: {
        label:   '3 · Shader Index Hunt',
        type:    'hunting_toggle',
        huntingValue: '3',
        section: 'hunting',
        tip:     'Mod-author tool. Cycles through shader hashes with numpad keys to isolate specific render passes. Only useful when writing or debugging a Geo-11 fix. Not for regular play.',
    },
    force_stereo: {
        label:   'Force Stereo',
        type:    'checkbox',
        section: 'debug',
        tip: 'Must be 2 (enabled) for Geo-11 to produce stereo output. Disable only for troubleshooting.',
        trueValue: '2', falseValue: '0',
    },
    hunting_verbose: {
        label:   'Debug Overlay',
        type:    'checkbox',
        section: 'debug',
        tip: 'Shows the green Geo-11 debug info overlay. Keep off during normal play.',
        trueValue: '1', falseValue: '0',
    },
};

// ─── PUBLIC API ───────────────────────────────────────────────

/**
 * readIni(iniPath)
 * Returns { fields, raw } where fields is a map of known key → current value string,
 * and raw is the full parsed object for writing.
 */
function readIni(iniPath) {
    if (!fs.existsSync(iniPath)) {
        throw new Error(`ini file not found: ${iniPath}`);
    }
    const content = fs.readFileSync(iniPath, 'utf8');
    const parsed  = parseIni(content);
    const fields  = {};

    Object.keys(KNOWN_FIELDS).forEach(key => {
        fields[key] = parsed.values[key]?.value ?? null;
    });

    return { fields, _parsed: parsed };
}

/**
 * snapshotDefaults(fixId, iniPath)
 * Reads the ini and saves a defaults snapshot if one doesn't already exist.
 * Call this immediately after installing a fix.
 */
function snapshotDefaults(fixId, iniPath) {
    ensureDir(DEFAULTS_DIR);
    const snapPath = path.join(DEFAULTS_DIR, `${fixId}.json`);

    // Don't overwrite — the point is to preserve what the fix author shipped
    if (fs.existsSync(snapPath)) return JSON.parse(fs.readFileSync(snapPath, 'utf8'));

    const { fields } = readIni(iniPath);
    fs.writeFileSync(snapPath, JSON.stringify({ fixId, fields, snapshotAt: new Date().toISOString() }, null, 2));
    return { fixId, fields };
}

/**
 * getDefaults(fixId)
 * Returns the fix-author's default values, or null if not yet snapshotted.
 */
function getDefaults(fixId) {
    const snapPath = path.join(DEFAULTS_DIR, `${fixId}.json`);
    if (!fs.existsSync(snapPath)) return null;
    return JSON.parse(fs.readFileSync(snapPath, 'utf8')).fields;
}

/**
 * getOverrides(fixId)
 * Returns the user's saved overrides, or {} if none.
 */
function getOverrides(fixId) {
    ensureDir(OVERRIDES_DIR);
    const p = path.join(OVERRIDES_DIR, `${fixId}.json`);
    if (!fs.existsSync(p)) return {};
    return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/**
 * saveOverrides(fixId, overrides)
 * Persists user overrides to disk.
 */
function saveOverrides(fixId, overrides) {
    ensureDir(OVERRIDES_DIR);
    const p = path.join(OVERRIDES_DIR, `${fixId}.json`);
    fs.writeFileSync(p, JSON.stringify(overrides, null, 2));
}

/**
 * writeIni(iniPath, patches)
 * Applies a key→value map to the ini file in-place.
 * Preserves all comments, section structure, and whitespace.
 */
function writeIni(iniPath, patches) {
    const content = fs.readFileSync(iniPath, 'utf8');
    const { lines, values } = parseIni(content);
    const updated = applyPatchesToLines(lines, values, patches);
    fs.writeFileSync(iniPath, updated.join('\n'), 'utf8');
}

/**
 * getFullState(fixId, iniPath)
 * Returns everything the UI needs:
 *   - current:   values as they are in the ini file right now
 *   - defaults:  fix-author values (may be null on first run pre-snapshot)
 *   - overrides: user's saved overrides
 *   - effective: what will actually be applied (overrides > current)
 *   - knownFields: metadata for rendering controls
 */
function getFullState(fixId, iniPath) {
    const { fields: current } = readIni(iniPath);
    const defaults  = getDefaults(fixId);
    const overrides = getOverrides(fixId);

    // effective = current ini, with overrides layered on top
    const effective = { ...current };
    Object.keys(overrides).forEach(k => { effective[k] = overrides[k]; });

    return { current, defaults, overrides, effective, knownFields: KNOWN_FIELDS };
}

/**
 * applyAndSave(fixId, iniPath, userValues)
 * Takes the UI form values, saves them as overrides, and writes to the ini.
 * userValues: { key: stringValue, ... } for every field shown in the form
 */
function applyAndSave(fixId, iniPath, userValues) {
    // Determine what's actually changed from the fix defaults
    // Everything the user set goes into overrides
    saveOverrides(fixId, userValues);
    writeIni(iniPath, userValues);
}

/**
 * resetToDefaults(fixId, iniPath)
 * Clears user overrides and restores the fix-author defaults to the ini.
 */
function resetToDefaults(fixId, iniPath) {
    const defaults = getDefaults(fixId);
    if (!defaults) throw new Error('No defaults snapshot found — install the fix first.');

    // Clear only keys that have defaults; null means the fix didn't set them
    const patches = {};
    Object.entries(defaults).forEach(([k, v]) => {
        if (v !== null) patches[k] = v;
    });

    saveOverrides(fixId, {});
    writeIni(iniPath, patches);
}

module.exports = {
    readIni,
    writeIni,
    snapshotDefaults,
    getDefaults,
    getOverrides,
    saveOverrides,
    getFullState,
    applyAndSave,
    resetToDefaults,
    KNOWN_FIELDS,
};