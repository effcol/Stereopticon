//

// renderer.js — full integrated version with ReShade support
function safeGetEl(id) {
    const el = document.getElementById(id);
    if (!el) console.warn(`Missing DOM element: ${id}`);
    return el;
}

window.addEventListener('error', ev => {
    console.error('Uncaught error caught in UI:', ev.error || ev.message, ev);
    const detailAreaEl = safeGetEl('detail-area');
    if (detailAreaEl) {
        detailAreaEl.innerHTML = `<div style="padding:20px;color:var(--danger);">UI error: ${String(ev.error || ev.message)}</div>`;
    }
});

window.addEventListener('unhandledrejection', ev => {
    console.error('Unhandled promise rejection:', ev.reason);
    const detailAreaEl = safeGetEl('detail-area');
    if (detailAreaEl) {
        detailAreaEl.innerHTML = `<div style="padding:20px;color:var(--danger);">Promise rejection: ${String(ev.reason)}</div>`;
    }
});

// installPath listener is added via delegation later — installPath now lives
// inside renderDetailView and is rebuilt per game.


// --- RUNTIME DATA ---
let PIPELINES        = {};
let GLOBAL_PIPELINES = {};
let OUTPUT_DEFINITIONS = {};

// --- GLOBAL STATE ---
let gamesData       = [];
let selectedGame    = null;
let selectedProfile = null;
let searchTerm      = '';
let filterMode      = 'all';
let sortMode        = 'alpha';
let selectedDisplay = null;

// --- INSTALL STATE ---
let installedFixIds  = new Set();
let installedGameIds = new Set();

// --- RESHADE STATE ---
let reshadeStatus = null;

// --- DOM (lazy-loaded) ---
let detailAreaCache    = null;
let configBarCache     = null;
let primarySelectCache = null;
let subSelectCache     = null;
let pipelineInfoCache  = null;

// detail-content is now the inner writable area; detail-area is the outer
// scroll container that also holds config-bar as a sibling of detail-content.
function getDetailArea()    { return detailAreaCache = detailAreaCache || document.getElementById('detail-content'); }
function getConfigBar()     { return configBarCache = configBarCache || document.getElementById('config-bar'); }
function getPrimarySelect() { return primarySelectCache = primarySelectCache || document.getElementById('primaryOutput'); }
function getSubSelect()     { return subSelectCache = subSelectCache || document.getElementById('subOutput'); }
function getPipelineInfo()  { return pipelineInfoCache = pipelineInfoCache || document.getElementById('pipelineInfo'); }

// Backward-compat getters so existing code doesn't need to change much
Object.defineProperty(window, 'detailArea', { get: getDetailArea, configurable: true });
Object.defineProperty(window, 'configBar', { get: getConfigBar, configurable: true });
Object.defineProperty(window, 'primarySelect', { get: getPrimarySelect, configurable: true });
Object.defineProperty(window, 'subSelect', { get: getSubSelect, configurable: true });
Object.defineProperty(window, 'pipelineInfo', { get: getPipelineInfo, configurable: true });

// ─── TITLEBAR ───────────────────────────────────────────────
function closeAllDropdowns() {
    document.querySelectorAll('.tb-dropdown').forEach(d => d.classList.remove('open'));
    document.querySelectorAll('.titlebar-btn, .titlebar-icon-btn').forEach(b => b.classList.remove('open'));
}
function toggleDropdown(dropdownId, triggerEl) {
    const dropdown = document.getElementById(dropdownId);
    const isOpen   = dropdown.classList.contains('open');
    closeAllDropdowns();
    if (!isOpen) {
        const rect = triggerEl.getBoundingClientRect();
        dropdown.style.left = rect.left + 'px';
        dropdown.style.top  = '42px';
        dropdown.classList.add('open');
        triggerEl.classList.add('open');
    }
}
document.addEventListener('click', e => {
    if (!e.target.closest('.tb-dropdown') && !e.target.closest('.titlebar-btn') && !e.target.closest('.titlebar-icon-btn')) closeAllDropdowns();
});
const btnDisplay = safeGetEl('btnDisplay');
if (btnDisplay) btnDisplay.addEventListener('click', function(e) { e.stopPropagation(); toggleDropdown('displayDropdown', this); });
document.querySelectorAll('#displayDropdown .dd-option').forEach(opt => {
    opt.addEventListener('click', function(e) {
        e.stopPropagation();
        selectedDisplay = this.dataset.value;
        window._selectedDisplayType  = this.dataset.value;
        window._selectedDisplayOutput = this.dataset.output || null;
        window._selectedDisplayNote   = this.dataset.note   || null;
        const txt = this.dataset.value === 'none' ? 'None Selected' : this.dataset.label.replace(/^Display:\s*/i, '');
        const displayLabel = safeGetEl('displayLabel');
        if (displayLabel) displayLabel.textContent = txt;
        const inlineLabel = safeGetEl('displayLabelInline');
        if (inlineLabel) inlineLabel.textContent = txt;
        document.querySelectorAll('#displayDropdown .dd-option').forEach(o => o.classList.remove('selected'));
        this.classList.add('selected');
        closeAllDropdowns();
        // Auto-select the correct output mode using data-output if present, else fall back to value
        const outputKey = this.dataset.output || this.dataset.value;
        applyDisplayToOutput(outputKey);
    });
});

function applyDisplayToOutput(displayValue) {
    if (!displayValue || displayValue === 'none') {
        // Reset label if none selected
        document.getElementById('displayLabel').textContent = 'Display: None Selected';
        return;
    }
    const mapping = DISPLAY_TO_OUTPUT[displayValue];
    if (!mapping) return;
    // Find the matching option (not disabled)
    const opts = Array.from(primarySelect.options);
    const match = opts.find(o => o.value === mapping.output && !o.disabled);
    if (match) {
        primarySelect.value = mapping.output;
        primarySelect.dispatchEvent(new Event('change'));
        // Set sub-option after updateSubOptions has rebuilt the sub-select
        if (mapping.sub) {
            setTimeout(() => {
                const subOpts = Array.from(subSelect.options);
                const subMatch = subOpts.find(o => o.value === mapping.sub || o.text === mapping.sub);
                if (subMatch) {
                    subSelect.value = subMatch.value;
                    subSelect.dispatchEvent(new Event('change'));
                }
            }, 0);
        }
    }
}
document.getElementById('btnHelp').addEventListener('click', function(e) {
    e.stopPropagation();
    const dd = document.getElementById('helpDropdown');
    const isOpen = dd.classList.contains('open');
    closeAllDropdowns();
    if (!isOpen) {
        const rect = this.getBoundingClientRect();
        dd.style.left = (rect.right - 200) + 'px';
        dd.style.top  = '42px';
        dd.classList.add('open');
        this.classList.add('open');
    }
});
document.getElementById('helpWebsite')?.addEventListener('click', () => { window.api.openUrl('https://stereopticon.org'); closeAllDropdowns(); });
document.getElementById('helpGithub')?.addEventListener('click', () => { window.api.openUrl('https://github.com/effcol/stereopticon'); closeAllDropdowns(); });
document.getElementById('helpIssues')?.addEventListener('click', () => { window.api.openUrl('https://github.com'); closeAllDropdowns(); });
function wireWindowControl(id, fn) {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.addEventListener('click', (e) => {
        try { fn(); } catch (err) { console.error(`[winctl] ${id} failed:`, err); }
    });
}
wireWindowControl('btnMin',   () => window.api.minimizeWindow());
wireWindowControl('btnMax',   () => window.api.maximizeWindow());
wireWindowControl('btnClose', () => window.api.closeWindow());

// ─── PATH ─────────────────────────────────────────────────────
function getInstallPath() { return document.getElementById('installPath')?.value?.trim() || ''; }
function setInstallPath(p) { const el = document.getElementById('installPath'); if (el) el.value = p; }

// Load saved game paths from localStorage
function loadSavedGamePaths() {
    const stored = localStorage.getItem('gamePaths');
    return stored ? JSON.parse(stored) : {};
}

function saveGamePathToStorage(gameId, folderPath) {
    const allPaths = loadSavedGamePaths();
    allPaths[gameId] = folderPath;
    localStorage.setItem('gamePaths', JSON.stringify(allPaths));
}

// Delegated handlers — browsePathBtn and installPath now live inside renderDetailView's
// innerHTML so they're recreated on every game switch. Delegation on document
// survives all rebuilds.
document.addEventListener('click', async (e) => {
    const btn = e.target.closest('#browsePathBtn');
    if (!btn) return;
    const folder = await window.api.openDirectoryDialog();
    if (folder) {
        setInstallPath(folder);
        if (selectedGame) saveGamePathToStorage(selectedGame.id, folder);
    }
});
document.addEventListener('change', (e) => {
    if (e.target?.id !== 'installPath') return;
    if (selectedGame && e.target.value.trim()) {
        saveGamePathToStorage(selectedGame.id, e.target.value.trim());
    }
});

// ─── INSTALL STATE ───────────────────────────────────────────
async function loadInstallState() {
    try {
        const ids = await window.api.getInstalledGameIds();
        installedGameIds = new Set(ids);
        const all = await window.api.getAllInstalled();
        installedFixIds  = new Set(Object.keys(all));
    } catch (e) { console.warn('Could not load install state:', e.message); }
}

// ─── PROGRESS TRAY ───────────────────────────────────────────
function showTray() { const t = document.getElementById('installTray'); if (t) t.style.display = 'block'; }
function hideTray() { const t = document.getElementById('installTray'); if (t) t.style.display = 'none'; }
function setProgress(percent, label, logLine) {
    showTray();
    const fill = document.getElementById('installProgressFill');
    const lbl  = document.getElementById('installProgressLabel');
    const log  = document.getElementById('installLog');
    if (fill && percent >= 0) fill.style.width = percent + '%';
    if (lbl  && label)   lbl.textContent = label;
    if (log  && logLine) { log.innerHTML += `<div>${logLine}</div>`; log.scrollTop = log.scrollHeight; }
}
function showResult(success, message) {
    showTray();
    const el = document.getElementById('installResult');
    if (!el) return;
    el.style.display    = 'block';
    el.style.background = success ? 'rgba(201,138,75,0.06)' : 'rgba(255,107,107,0.08)';
    el.style.borderLeft = `3px solid ${success ? 'var(--teal)' : 'var(--danger)'}`;
    el.innerHTML = `<strong style="color:${success ? 'var(--teal)' : 'var(--danger)'};">${success ? '✓' : '✗'}</strong>&nbsp;
        <span style="color:var(--text-secondary);font-size:10px;">${message.replace(/\n/g,'<br>')}</span>`;
    if (success) setTimeout(() => {
        el.style.display = 'none';
        if (!document.getElementById('installLog').textContent.trim()) hideTray();
    }, 4000);
}
function onProgress(data) {
    const label = data.message || `${data.stage}: ${data.status}`;
    setProgress(data.percent >= 0 ? data.percent : -1, label, data.status === 'downloading' ? data.label : null);
}
function resetTray() {
    const fill = document.getElementById('installProgressFill');
    const lbl  = document.getElementById('installProgressLabel');
    const log  = document.getElementById('installLog');
    const res  = document.getElementById('installResult');
    if (fill) fill.style.width = '0%';
    if (lbl)  lbl.textContent  = '';
    if (log)  log.innerHTML    = '';
    if (res)  res.style.display = 'none';
}

// ─── PIPELINE HELPERS ────────────────────────────────────────
// ── VRto3D output-mode sync ──────────────────────────────────
const VRTO3D_OUTPUT_MAP = {
    'sbs':                      { tab_enable: false },
    'tab':                      { tab_enable: true  },
    'interleaved':              { tab_enable: true  },
    'interleaved_row':          { tab_enable: true  },
    'interleaved_col':          { tab_enable: false },
    'interleaved_checkerboard': { tab_enable: false },
    'frame_packing':            { tab_enable: false, framepack_enable: true },
    'frame_sequential':         { tab_enable: false },
    'sr_weave':                 { tab_enable: false },
};
async function syncVRto3DOutput(outputId) {
    if (!selectedProfile || !['uevr','ue3d'].includes(selectedProfile.type)) return;
    const map = VRTO3D_OUTPUT_MAP[outputId];
    if (!map) return;
    try { await window.api.vrto3dWriteConfig(map); } catch { /* not installed yet */ }
}

function syncGeo11Output(outputId) {
    if (!selectedProfile || selectedProfile.type !== 'geo11') return;
    if (!outputId) return;
    
    // Skip anaglyph — Geo-11 doesn't support it (non-stereo output format)
    if (outputId.startsWith('anaglyph')) return;
    
    // Map our output IDs to Geo-11 direct_mode values
    const directModeMap = {
        'sbs':                     'sbs',
        'tab':                     'tab',
        'interleaved':             'interlaced',
        'interleaved_row':         'interlaced',
        'interleaved_col':         'interlaced',
        'interleaved_checkerboard': 'checkerboard',
        'katanga_vr':              'katanga_vr',  // Direct VR output to HelixVision
    };
    
    // sr_weave (simulated_reality) only works with Geo-11 v0.6.60.23
    if (selectedProfile.geo11_version === '0.6.60.23') {
        directModeMap['sr_weave'] = 'simulated_reality';
    }
    
    const directMode = directModeMap[outputId];
    if (directMode) {
        geoPending['direct_mode'] = directMode;
    }
}

// Apply Geo-11 settings to INI file RIGHT BEFORE launch
async function applyGeo11SettingsBeforeLaunch() {
    if (!selectedProfile || selectedProfile.type !== 'geo11') {
        console.log('[Geo11] Not a Geo-11 profile, skipping');
        return;
    }
    
    const gamePath = getInstallPath();
    if (!gamePath) {
        console.log('[Geo11] No game path, skipping');
        return;
    }
    
    const outputId = getEffectiveOutputIdFromSelects();
    if (!outputId) {
        console.log('[Geo11] No output ID, skipping');
        return;
    }
    
    console.log('[Geo11] Starting sync | Profile:', selectedProfile.id, '| Version:', selectedProfile.geo11_version, '| Output:', outputId);
    
    try {
        const iniPath = resolveIniPath(selectedProfile, gamePath);
        const settingsToApply = {};
        
        // If Geo modal was opened, use the accumulated geoPending changes
        if (geoState && Object.keys(geoPending).length > 0) {
            console.log('[Geo11] Merging pending modal changes:', Object.keys(geoPending));
            Object.assign(settingsToApply, geoPending);
        }
        
        // Always apply the output mode based on current selection
        // For anaglyph: set Geo-11 to SBS (anaglyph is handled via 3DtoElse shader)
        if (outputId.startsWith('anaglyph')) {
            settingsToApply['direct_mode'] = 'sbs';
            console.log('[Geo11] Anaglyph mode -> setting direct_mode = sbs');
        } else {
            // Map output to Geo-11 direct_mode
            const directModeMap = {
                'sbs':                     'sbs',
                'tab':                     'tab',
                'interleaved':             'interlaced',
                'interleaved_row':         'interlaced',
                'interleaved_col':         'interlaced',
                'interleaved_checkerboard': 'checkerboard',
                'katanga_vr':              'katanga_vr',
            };
            
            if (selectedProfile.geo11_version === '0.6.60.23') {
                directModeMap['sr_weave'] = 'simulated_reality';
            }
            
            const directMode = directModeMap[outputId];
            if (directMode) {
                settingsToApply['direct_mode'] = directMode;
                console.log('[Geo11] Standard output -> setting direct_mode =', directMode);
            } else {
                console.log('[Geo11] Output not mapped:', outputId);
            }
        }
        
        // Apply settings
        if (Object.keys(settingsToApply).length > 0) {
            console.log('[Geo11] Writing to INI:', iniPath, 'with settings:', settingsToApply);
            setProgress(93, 'Applying Geo-11 settings...', null);
            const result = await window.api.iniApply(selectedProfile.id, iniPath, settingsToApply);
            console.log('[Geo11] API response:', result);
            if (result?.success) {
                console.log('[Geo11] ✓ SUCCESS');
            } else {
                console.warn('[Geo11] ✗ FAILED:', result?.message || result?.error);
            }
        } else {
            console.log('[Geo11] No settings to apply');
        }
    } catch (e) {
        console.error('[Geo11] Exception:', e.message, e);
    }
}

// Returns compound outputId like 'anaglyph_red_cyan' or 'interleaved_row'
// when primary output has a meaningful sub-selection.
// Falls back to primary value for types where sub is purely cosmetic.
function getEffectiveOutputId(primary, sub) {
    if (!primary) return primary;
    if (primary === 'anaglyph' && sub) {
        const map = {
            'Red/Cyan':        'anaglyph_red_cyan',
            'Green/Magenta':   'anaglyph_green_magenta',
            'Amber/Blue':      'anaglyph_amber_blue',
            'red_cyan':        'anaglyph_red_cyan',
            'green_magenta':   'anaglyph_green_magenta',
            'amber_blue':      'anaglyph_amber_blue',
        };
        return map[sub] || primary;
    }
    if (primary === 'interleaved' && sub) {
        const map = {
            'Row':             'interleaved_row',
            'Column':          'interleaved_col',
            'Checkerboard':    'interleaved_checkerboard',
            'row':             'interleaved_row',
            'col':             'interleaved_col',
            'checkerboard':    'interleaved_checkerboard',
        };
        return map[sub] || primary;
    }
    return primary;
}

function getEffectiveOutputIdFromSelects() {
    // Phase 2b: per-game override wins over the global Settings value.
    if (selectedGame) {
        const ov = getOutputOverride(selectedGame.id);
        if (ov && ov.primary) return getEffectiveOutputId(ov.primary, ov.sub);
    }
    const primary = primarySelect?.value;
    const sub     = subSelect?.value;
    return getEffectiveOutputId(primary, sub);
}

// ── Per-game output override (Phase 2b) ──────────────────────
// Stored as { [gameId]: { primary, sub } } in localStorage. Absence of an
// entry means "use the global setting". A NON-null entry overrides the
// global Settings → Display & Output selection for this game only.
const SETTINGS_OVERRIDES_KEY = 'stereopticon.outputOverrides';

function loadAllOverrides() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_OVERRIDES_KEY) || '{}'); }
    catch { return {}; }
}
function saveAllOverrides(map) {
    try { localStorage.setItem(SETTINGS_OVERRIDES_KEY, JSON.stringify(map)); } catch {}
}
function getOutputOverride(gameId) {
    if (!gameId) return null;
    return loadAllOverrides()[gameId] || null;
}
function setOutputOverride(gameId, primary, sub) {
    if (!gameId) return;
    const m = loadAllOverrides();
    m[gameId] = { primary: primary || '', sub: sub || '' };
    saveAllOverrides(m);
}
function clearOutputOverride(gameId) {
    if (!gameId) return;
    const m = loadAllOverrides();
    delete m[gameId];
    saveAllOverrides(m);
}

// Mirror the global primaryOutput's option list into the override dropdown.
// Called whenever the global dropdown gets new options (game selection or
// fix change), or when the override bar is first revealed.
function cloneOptionsInto(srcSel, destSel) {
    if (!srcSel || !destSel) return;
    destSel.innerHTML = '';
    for (const o of srcSel.options) {
        const opt = document.createElement('option');
        opt.value = o.value;
        opt.textContent = o.textContent;
        destSel.appendChild(opt);
    }
}

// Populate the override bar based on the currently selected game and the
// current override state. Idempotent — safe to call repeatedly.
window.renderOutputOverrideBar = function() {
    const game = selectedGame;
    const bar  = document.getElementById('outputOverrideBar');
    if (!bar) return;
    if (!game) { bar.style.display = 'none'; return; }
    bar.style.display = 'flex';

    const ov         = getOutputOverride(game.id);
    const isOn       = !!(ov && ov.primary);
    const pill       = document.getElementById('outputOverrideToggle');
    const inline     = document.getElementById('outputOverrideInline');
    const dot        = pill?.querySelector('.ov-dot');
    const label      = pill?.querySelector('.ov-label');
    const overridePri = document.getElementById('overridePrimary');
    const overrideSub = document.getElementById('overrideSub');

    if (pill) {
        pill.style.borderColor = isOn ? 'var(--teal-border)' : 'var(--glass-border)';
        pill.style.color       = isOn ? 'var(--teal)'        : 'var(--text-dim)';
        if (dot)   dot.style.background  = isOn ? 'var(--teal)' : 'var(--text-faint)';
        if (label) label.textContent      = isOn ? 'Overridden for this game' : 'Using global output';
    }
    if (inline) inline.style.display = isOn ? 'inline-flex' : 'none';

    // Mirror options from the global selects. Do this every time so the
    // override dropdown stays in sync as the user adds/removes outputs
    // (e.g. SR display becoming available mid-session).
    cloneOptionsInto(primarySelect, overridePri);
    cloneOptionsInto(subSelect,     overrideSub);

    if (isOn && overridePri) {
        if ([...overridePri.options].some(o => o.value === ov.primary)) {
            overridePri.value = ov.primary;
        }
        if (overrideSub && ov.sub && [...overrideSub.options].some(o => o.value === ov.sub)) {
            overrideSub.value = ov.sub;
        }
    } else if (overridePri && primarySelect) {
        // Override OFF: pre-fill with current global so toggling ON feels
        // intuitive (the dropdowns reflect what the game is currently using).
        overridePri.value = primarySelect.value || overridePri.value;
        if (overrideSub && subSelect) overrideSub.value = subSelect.value || overrideSub.value;
    }
};

window.toggleOutputOverride = function() {
    const game = selectedGame;
    if (!game) return;
    const ov = getOutputOverride(game.id);
    if (ov && ov.primary) {
        clearOutputOverride(game.id);
    } else {
        // Snapshot the current global as the initial override value.
        const p = primarySelect?.value || '';
        const s = subSelect?.value     || '';
        setOutputOverride(game.id, p, s);
    }
    renderOutputOverrideBar();
    // Re-render the pipeline so the new effective output is reflected.
    if (typeof updateSubOptions === 'function') updateSubOptions();
};

// When the override dropdowns change, persist + re-render the pipeline.
document.addEventListener('DOMContentLoaded', () => {
    const overridePri = document.getElementById('overridePrimary');
    const overrideSub = document.getElementById('overrideSub');
    const onChange = () => {
        const game = selectedGame;
        if (!game || !overridePri) return;
        setOutputOverride(game.id, overridePri.value, overrideSub?.value || '');
        if (typeof updateSubOptions === 'function') updateSubOptions();
    };
    overridePri?.addEventListener('change', onChange);
    overrideSub?.addEventListener('change', onChange);
});

function getPipelineSteps(fixType, outputId) {
    const po = selectedProfile.pipeline_overrides;
    // Exact match first; fall back to base ID (e.g. 'anaglyph' if 'anaglyph_red_cyan' not set)
    const baseId = outputId.includes('_') ? outputId.replace(/_[^_]+$/, '') : null;
    if (po) {
        if (po[outputId] !== undefined) return po[outputId];
        if (baseId && po[baseId] !== undefined) return po[baseId];
    }
    if (selectedProfile.native_outputs?.includes(outputId)) return [];
    if (baseId && selectedProfile.native_outputs?.includes(baseId)) return [];
    // reshade_only profiles: outputs determined by native_outputs_reshade list
    if (fixType === 'reshade_only') {
        const reshadeOutputs = selectedProfile.native_outputs_reshade || [];
        if (reshadeOutputs.length === 0 || reshadeOutputs.includes(outputId)) {
            // Use the game-specific shader list, or the generic Anaglyph_to_SBS_or_TAB
            const shaders = selectedProfile.reshade_shaders || ['Anaglyph_to_SBS_or_TAB'];
            // Frame packing and SR Weave also need 3DtoElse as the packing step
            if (outputId === 'frame_packing' || outputId === 'sr_weave') {
                const base = shaders.filter(s => s !== '3DtoElse');
                return outputId === 'frame_packing'
                    ? [...base, '3DtoElse (Frame Packing)']
                    : [...base];  // shaders handle the conversion; XRGameBridge is the display output
            }
            return shaders;
        }
        return null;
    }
    const gpMap = GLOBAL_PIPELINES[fixType]; 
    if (!gpMap) return null;
    let steps = gpMap[outputId] !== undefined ? gpMap[outputId] : (baseId && gpMap[baseId] !== undefined ? gpMap[baseId] : null);
    
    // Add 'reshade' step if pipeline needs shaders, inserting it before output/display steps
    if (steps && !steps.includes('reshade') && !steps.includes('ReShade')) {
        const shaders = getShadersForPipeline(steps);
        if (shaders.length > 0) {
            // Find where to insert reshade (before 3dgamebridge, xrgamebridge, display steps)
            const displaySteps = ['3dgamebridge', '3DGameBridge', 'xrgamebridge', 'XRGameBridge', 'virtobridge', 'VirtoBridge'];
            const insertIdx = steps.findIndex(s => displaySteps.some(d => d.toLowerCase() === s.toLowerCase()));
            if (insertIdx >= 0) {
                steps = [...steps.slice(0, insertIdx), 'reshade', ...steps.slice(insertIdx)];
            } else {
                // No display step, just append
                steps = [...steps, 'reshade'];
            }
        }
    }
    
    return steps;
}

// ─── DISPLAY → OUTPUT MAPPING ────────────────────────────────
const DISPLAY_TO_OUTPUT = {
    'sbs':             { output: 'sbs',              sub: null },
    'tab':             { output: 'tab',              sub: null },
    'interleaved':     { output: 'interleaved',      sub: null },
    'frame_sequential':{ output: 'frame_sequential', sub: null },
    'lkg_quilt':       { output: 'lkg_quilt',        sub: null },
    'sr_weave':        { output: 'sr_weave',         sub: null },
    'anaglyph':        { output: 'anaglyph',         sub: 'Red/Cyan' },
    'vr_native':       { output: 'vr_native',        sub: null },
    'ar_headset':      { output: 'sbs',              sub: null },
    'frame_packing':   { output: 'frame_packing',    sub: null },
};

const FIX_TYPE_TO_SOFTWARE = {
    'geo12':  'newaxis',
    'vorpx':  'vorpx',
};

// What to show as the FINAL step in the pipeline chain
function getOutputTerminalLabel(outputId) {
    const getSubText = () => {
        if (!subSelect || subSelect.options.length === 0) return '';
        const idx = subSelect.selectedIndex;
        if (idx < 0) return '';
        return subSelect.options[idx].text || subSelect.value || '';
    };
    const subText = getSubText();

    if (outputId === 'anaglyph') {
        const colorMap = {
            'Red/Cyan':      'Red/Cyan Anaglyph',
            'Green/Magenta': 'Green/Magenta Anaglyph',
            'Amber/Blue':    'Amber/Blue Anaglyph',
            'red_cyan':      'Red/Cyan Anaglyph',
            'green_magenta': 'Green/Magenta Anaglyph',
            'amber_blue':    'Amber/Blue Anaglyph',
        };
        return colorMap[subText] || 'Red/Cyan Anaglyph';
    }

    if (outputId === 'interleaved')   return subText && subText !== 'Standard' ? subText : 'Row Interleaved';
    if (outputId === 'frame_packing') return subText && subText !== 'Standard' ? subText : '1080p Frame Packing';

    const map = {
        'sbs':              'Full Side-by-Side',
        'sbs_half':         'Half Side-by-Side',
        'tab':              'Full Top-and-Bottom',
        'tab_half':         'Half Top-and-Bottom',
        'sr_weave':         'Simulated Reality Weave',
        'lkg_quilt':        'Quilt',
        'frame_sequential': 'Frame Sequential',
        'vr_native':        'VR',
    };
    return map[outputId] || OUTPUT_DEFINITIONS[outputId]?.label || outputId;
}

// Local mirror of reshade.js PIPELINE_SHADERS
const PIPELINE_SHADERS_JS = {
    '3DGameBridge':                        ['3DGameBridge'],
    'Refract':                             ['Refract'],
    '3DtoElse':                            ['3DtoElse'],
    '3DtoElse (Frame Packing)':            ['3DtoElse'],
    '3DtoElse (Anaglyph GM)':              ['3DtoElse'],
    '3DtoElse (Anaglyph AB)':              ['3DtoElse'],
    '3DtoElse (Interleaved Row)':          ['3DtoElse'],
    '3DtoElse (Interleaved Col)':          ['3DtoElse'],
    '3DtoElse (Interleaved Checkerboard)': ['3DtoElse'],
    'Anaglyph_to_SBS_or_TAB':             ['Anaglyph_to_SBS_or_TAB'],
    'Anaglyph-to-SBS/TAB (FEZ variant)':  ['FEZ_Anaglyph_to_SBS_TAB'],
    'Limbo Anaglyph-to-SBS Shader':       ['Limbo_Anaglyph_to_SBS_TAB'],
};
function getShadersForPipeline(steps) {
    const out = new Set();
    (steps || []).forEach(s => { (PIPELINE_SHADERS_JS[s] || []).forEach(sh => out.add(sh)); });
    return [...out];
}
function pipelineNeedsReshade() {
    if (!selectedProfile || !primarySelect.value) return false;
    const steps = getPipelineSteps(selectedProfile.type, getEffectiveOutputIdFromSelects());
    return steps && getShadersForPipeline(steps).length > 0;
}

// ─── RESHADE STATUS & BUTTON ─────────────────────────────────
async function loadReshadeStatus() {
    const gamePath = getInstallPath();
    if (!gamePath || !selectedProfile) { reshadeStatus = null; updateReshadeButton(); return; }
    try { reshadeStatus = await window.api.reshadeStatus(gamePath, selectedProfile); }
    catch { reshadeStatus = null; }
    updateReshadeButton();
}

function updateReshadeButton() {
    // ReShade is now installed automatically alongside the fix.
    // The setup button is only shown if something is broken post-install.
    const btn = document.getElementById('btnReshadeSetup');
    if (!btn) return;
    if (!pipelineNeedsReshade() || !installedFixIds.has(selectedProfile?.id)) {
        btn.style.display = 'none'; return;
    }
    // Only surface the button if ReShade is expected but missing
    if (reshadeStatus?.installed && reshadeStatus.hasPreset && reshadeStatus.hasShaders) {
        btn.style.display = 'none'; return;
    }
    // Something is wrong — show warning
    btn.style.display = 'flex';
    btn.className   = 'action-btn btn-reshade-warn';
    btn.textContent = '🎨 ReShade ⚠';
    btn.title = 'ReShade shaders missing — click to repair';
}

// ─── RESHADE MODAL ───────────────────────────────────────────
window.openReshadeModal = async function() {
    const modal    = document.getElementById('reshadeModal');
    const body     = document.getElementById('reshadeModalBody');
    const statusEl = document.getElementById('reshadeModalStatus');
    const installBtn = document.getElementById('reshadeInstallBtn');
    const gamePath = getInstallPath();
    if (!gamePath) { showResult(false, 'Set the Game Folder path first.'); return; }

    modal.style.display = 'flex';
    body.innerHTML = '<div style="color:var(--text-dim);font-size:12px;padding:12px 0;">Detecting…</div>';
    statusEl.textContent = '';
    if (installBtn) { installBtn.disabled = false; installBtn.textContent = 'Install ReShade'; }

    // Use exe_name field; fall back to last segment of default_path only if not set
    const exeName = selectedGame.exe_name || selectedGame.default_path.split(/[/\\]/).pop();
    const exePath = gamePath.replace(/[/\\]$/, '') + '\\' + exeName;
    const apiInfo = await window.api.reshadeDetectApi(gamePath, exePath, selectedProfile);
    const steps   = getPipelineSteps(selectedProfile.type, getEffectiveOutputIdFromSelects()) || [];
    const shaders = getShadersForPipeline(steps);
    const geo11Installed = installedFixIds.has(selectedProfile.id) &&
        ['geo11','geo12','3dmigoto','helixmod'].includes(selectedProfile.type);

    const shaderRows = shaders.length
        ? shaders.map(s => `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--glass-border);">
            <span style="color:var(--teal);font-size:11px;">◈</span>
            <span style="font-size:12px;color:var(--text-secondary);">${s}</span></div>`).join('')
        : '<div style="color:var(--text-dim);font-size:12px;">No additional shaders needed.</div>';

    body.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:12px;">
            <div class="card" style="padding:12px 14px;">
                <h3>Graphics API</h3>
                <div style="display:flex;align-items:center;gap:12px;">
                    <div style="font-size:24px;">⚙</div>
                    <div>
                        <div style="font-size:14px;color:var(--text-primary);font-weight:500;">${apiInfo.api.toUpperCase()}</div>
                        <div style="font-size:10px;color:var(--text-dim);">
                            Hook DLL: <code style="color:var(--teal);">${apiInfo.hookDll}</code>
                            &nbsp;·&nbsp; detected via ${apiInfo.source}
                        </div>
                    </div>
                    ${reshadeStatus?.installed ? `<span class="badge badge-experimental" style="margin-left:auto;">Already Installed</span>` : ''}
                </div>
            </div>
            ${geo11Installed ? `
            <div style="padding:9px 12px;background:rgba(201,138,75,0.04);border:1px solid var(--teal-border);border-radius:8px;font-size:11px;color:var(--text-secondary);line-height:1.6;">
                <strong style="color:var(--teal);">⛓ Geo-11 Chain Mode</strong><br>
                Geo-11 is installed. ReShade will install as
                <code style="color:var(--teal);">dxgi.dll</code> and
                Geo-11's ini will be patched to proxy through it automatically.
            </div>` : ''}
            <div class="card" style="padding:12px 14px;">
                <h3>Shaders to Install</h3>
                ${shaderRows}
            </div>
            <div style="padding:9px 12px;background:rgba(255,255,255,0.02);border:1px solid var(--glass-border);border-radius:8px;font-size:10px;color:var(--text-dim);line-height:1.6;">
                Downloaded from <strong style="color:var(--text-secondary);">github.com/crosire/reshade</strong>
                (latest release, full add-on support build).<br>
                Cached at <code style="color:var(--text-dim);">~/.stereopticon/cache/reshade/</code> after first download.
            </div>
            <div class="card" style="padding:12px 14px;">
                <h3>Screenshot Settings</h3>
                <div style="display:flex;flex-direction:column;gap:10px;">
                    <label style="display:flex;align-items:center;justify-content:space-between;font-size:12px;color:var(--text-secondary);">
                        <span>Save screenshots to game folder</span>
                        <label class="geo-toggle"><input type="checkbox" id="ss-keep-in-folder" checked onchange="window.updateScreenshotPreview()"><span class="geo-toggle-track"></span></label>
                    </label>
                    <label style="display:flex;align-items:center;justify-content:space-between;font-size:12px;color:var(--text-secondary);">
                        <span>Save before effects applied</span>
                        <label class="geo-toggle"><input type="checkbox" id="ss-before" onchange="window.updateScreenshotPreview()"><span class="geo-toggle-track"></span></label>
                    </label>
                    <label style="display:flex;align-items:center;justify-content:space-between;font-size:12px;color:var(--text-secondary);">
                        <span>Save after effects applied</span>
                        <label class="geo-toggle"><input type="checkbox" id="ss-after" checked onchange="window.updateScreenshotPreview()"><span class="geo-toggle-track"></span></label>
                    </label>
                    <label style="display:flex;align-items:center;justify-content:space-between;font-size:12px;color:var(--text-secondary);">
                        <span>Format</span>
                        <select id="ss-format" class="geo-select" style="width:80px;" onchange="window.updateScreenshotPreview()">
                            <option value="PNG">PNG</option>
                            <option value="JPG">JPG</option>
                            <option value="BMP">BMP</option>
                        </select>
                    </label>
                    <div id="ss-preview" style="font-size:10px;color:var(--text-dim);padding:6px 8px;background:rgba(0,0,0,0.15);border-radius:4px;line-height:1.8;margin-top:2px;"></div>
                </div>
            </div>
        </div>`;

    modal._context = { gamePath, exePath, shaders, geo11Installed };
    setTimeout(() => window.updateScreenshotPreview?.(), 80);
};

window.closeReshadeModal = function() {
    document.getElementById('reshadeModal').style.display = 'none';
};

window.runReshadeInstall = async function() {
    const modal    = document.getElementById('reshadeModal');
    const ctx      = modal._context;
    if (!ctx) return;
    const installBtn = document.getElementById('reshadeInstallBtn');
    const statusEl   = document.getElementById('reshadeModalStatus');
    installBtn.disabled    = true;
    installBtn.textContent = 'Installing…';
    statusEl.innerHTML     = '';

    function onReshadeProgress(data) {
        const pct   = data.percent >= 0 ? `${data.percent}%` : '';
        const color = data.status === 'complete' ? 'var(--teal)' : 'var(--text-dim)';
        statusEl.innerHTML = `<div style="display:flex;gap:8px;font-size:11px;color:${color};">
            <div style="flex:1;">${data.label || ''}</div><div>${pct}</div></div>`;
    }
    const removeListener = window.api.onReshadeProgress(onReshadeProgress);

    try {
        const result = await window.api.reshadeInstall(
            ctx.gamePath, ctx.exePath, selectedProfile, ctx.shaders, ctx.geo11Installed,
            getScreenshotOptions());
        removeListener();
        if (result.success) {
            statusEl.innerHTML = `<div style="color:var(--teal);font-size:11px;">✓ ${result.message.replace(/\n/g,'<br>')}</div>`;
            installBtn.textContent = '✓ Installed';
            reshadeStatus = await window.api.reshadeStatus(ctx.gamePath, selectedProfile);
            updateReshadeButton();
            const body = document.getElementById('reshadeModalBody');
            body.innerHTML += `<div style="margin-top:10px;padding:10px;background:rgba(0,0,0,0.25);border-radius:6px;font-size:10px;font-family:monospace;color:var(--text-dim);line-height:1.7;">
                ${result.steps.map(s => `> ${s}`).join('<br>')}</div>`;
        } else {
            statusEl.innerHTML = `<div style="color:var(--danger);font-size:11px;">✗ ${result.message.replace(/\n/g,'<br>')}</div>`;
            installBtn.disabled = false; installBtn.textContent = 'Retry';
        }
    } catch (e) {
        removeListener();
        statusEl.innerHTML = `<div style="color:var(--danger);font-size:11px;">✗ ${e.message}</div>`;
        installBtn.disabled = false; installBtn.textContent = 'Retry';
    }
};

// ─── BOTTOM BAR ──────────────────────────────────────────────
function updateBottomBar() {
    if (!selectedProfile) return;
    const installed  = installedFixIds.has(selectedProfile.id);
    const btnInstall = document.getElementById('btnInstallFix');
    if (btnInstall) btnInstall.textContent = installed ? 'Update Fix' : 'Install Fix';
    const btnLaunch  = document.getElementById('btnLaunchGame');
    const btnUninst  = document.getElementById('btnUninstallMain');
    const modBtn     = document.getElementById('btnModSettings');

    if (installed) {
        btnInstall.textContent = '✓ Fix Installed';
        btnInstall.className   = 'hero-btn hero-btn-installed';
        btnInstall.disabled    = true;
    } else {
        btnInstall.textContent = '⇩ Install Fix';
        btnInstall.className   = 'hero-btn hero-btn-secondary';
        btnInstall.disabled    = false;
    }
    btnLaunch.className = installed ? 'hero-btn hero-btn-primary' : 'hero-btn hero-btn-secondary';
    btnLaunch.disabled  = false;
    if (btnUninst) btnUninst.style.display = installed ? 'flex' : 'none';
    const hasModSettings = ['geo11','geo12','3dmigoto','helixmod','uevr','ue3d'].includes(selectedProfile.type);
        // External software types: instead of install, show "Launch Software"
    const softwareType = FIX_TYPE_TO_SOFTWARE[selectedProfile?.type];
    if (softwareType) {
        btnInstall.textContent = '▶ Launch Software';
        btnInstall.className   = 'hero-btn hero-btn-primary';
        btnInstall.disabled    = false;
        btnLaunch.style.display  = 'none';   // hide game launch — software is the launcher
        if (btnUninst) btnUninst.style.display = 'none';
    } else {
        btnLaunch.style.display = '';
    }
    if (modBtn) modBtn.style.display = (hasModSettings && installed) ? 'flex' : 'none';
    updateHeadtrackingUI();
    updateReshadeButton();
}


async function refreshReshadePreset() {
    const gamePath = getInstallPath();
    if (!gamePath || !reshadeStatus?.installed) return;
    const steps   = getPipelineSteps(selectedProfile?.type, getEffectiveOutputIdFromSelects());
    const shaders = getShadersForPipeline(steps || []);
    if (!shaders.length) return;
    try { await window.api.reshadeUpdatePreset(gamePath, shaders); } catch { /* silent */ }
}

// ── UE3D / UEVR install + settings ──────────────────────────────

// After a ue3d/uevr fix installs, run the full component download chain
// and show a post-install guide in the result panel.
// Shows post-install launch guide for UEVR/UE3D fixes.
// The actual component download happens inside installFix() → installUE3D().
window.showUEVRGuide = function(profile) {
    const resultEl = document.getElementById('installResult');
    if (!resultEl) return;
 
    const isUE3D = profile.type === 'ue3d';
 
    // Steps match the praydog UEVR README flow.
    // Stereopticon auto-launches UEVRInjector.exe ~2s after the game.
    const steps = isUE3D ? [
        'Click <strong>Launch</strong> — your game and UEVR Injector will open automatically.',
        'In UEVR Injector, wait for your game to appear in the process dropdown list.',
        'Select your runtime: <strong>OpenXR</strong> (recommended) or OpenVR.',
        'Click <strong>Inject</strong>.',
        'In the UEVR <em>Monitor 3D</em> tab, enable <strong>LookAround</strong> only after loading into gameplay (not at the menu).',
        'Use <strong>Ctrl+F3/F4</strong> to adjust depth and <strong>Ctrl+F5/F6</strong> for convergence.',
    ] : [
        'Click <strong>Launch</strong> — your game and UEVR Injector will open automatically.',
        'In UEVR Injector, wait for your game to appear in the process dropdown list.',
        'Select your runtime: <strong>OpenXR</strong> (recommended) or OpenVR.',
        'Click <strong>Inject</strong>.',
        'Press <strong>Insert</strong> or <strong>L3+R3</strong> to open the UEVR in-game menu.',
    ];
 
    const div = document.createElement('div');
    div.style.cssText = 'margin-top:10px;padding:8px 10px;background:rgba(100,180,255,0.06);border:1px solid rgba(100,180,255,0.2);border-radius:6px;font-size:11px;';
    
    // Default profile guidance
    const defaultProfileNote = `
        <div style="background:rgba(100,255,180,0.08);border-left:2px solid rgba(100,255,180,0.4);padding:6px 8px;margin-bottom:8px;border-radius:3px;">
            <div style="color:var(--teal);font-weight:700;margin-bottom:3px;font-size:10px;">🎮 Default Profile Available</div>
            <div style="color:var(--text-secondary);font-size:10px;line-height:1.4;">
                A default UEVR configuration has been created with FOV set to <strong>90</strong> (standard for most games).<br/>
                <strong>To load it in UEVR:</strong> Open the game's config folder → <em>Settings → Game settings → Load profile</em> → select the default profile.<br/>
                <strong>To customize:</strong> Use <em>Mod Settings → UEVR tab</em> to adjust depth, FOV, convergence and other options.
            </div>
        </div>
    `;
    
    div.innerHTML =
        `<div style="color:var(--teal);font-weight:700;margin-bottom:6px;font-family:var(--font-display);text-transform:uppercase;letter-spacing:1px;font-size:10px;">${isUE3D ? 'UE3D Monitor Mode' : 'UEVR'} — Next steps</div>` +
        steps.map((s, i) => `<div style="padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.04);color:var(--text-secondary);"><span style="color:var(--teal);font-family:var(--font-mono);">${i + 1}.</span> ${s}</div>`).join('') +
        (isUE3D ? '<div style="color:rgba(255,200,100,0.8);margin-top:6px;font-size:10px;">⚠ LookAround must be enabled after loading into gameplay — enabling at the main menu causes cropping.</div>' : '') +
        (isUE3D ? '' : defaultProfileNote) +
        `<div style="color:var(--text-dim);font-size:10px;margin-top:6px;">Open <em>Mod Settings → UEVR tab</em> to adjust depth, convergence${isUE3D ? '' : ', FOV'} and rendering options.</div>`;
 
    // Clear any previous guide before appending
    const prev = resultEl.querySelector('.uevr-guide');
    if (prev) prev.remove();
    div.classList.add('uevr-guide');
 
    resultEl.style.display = 'block';
    resultEl.appendChild(div);
};

/**
 * renderer/uevr-settings.js
 * Plain JS — include via <script src="uevr-settings.js"></script> in index.html
 * Place this tag BEFORE <script src="renderer.js">
 */
// UEVR_SETTINGS and UEVR_SETTINGS_GROUPS are loaded from uevr-settings.js (included first in index.html)

// UEVR_SHORTCUTS is loaded from uevr-settings.js (included first in index.html)

function resolveUEVRConfig(downloadedProfile, userOverrides) {
    downloadedProfile = downloadedProfile || {};
    userOverrides     = userOverrides     || {};
    const defaults = {};
    Object.values(UEVR_SETTINGS).forEach(s => { defaults[s.key] = s.default; });
    return Object.assign({}, defaults, downloadedProfile, userOverrides);
}

/**
 * Builds the settings + shortcut HTML for the UEVR tab.
 * Called from populateUEVRTab() — replaces the hardcoded rows there.
 *
 * @param {object} uevr - config values keyed by UEVR_SETTINGS[x].key
 */
function buildUEVRSettingsHTML(uevr) {
    uevr = uevr || {};

    function row(label, inputHtml, hint) {
        return '<div style="display:flex;flex-direction:column;gap:3px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05);">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;">' +
            '<span style="color:var(--text-secondary);font-size:11px;">' + label + '</span>' +
            inputHtml + '</div>' +
            (hint ? '<div style="color:var(--text-dim);font-size:10px;">' + hint + '</div>' : '') +
            '</div>';
    }

    let html = '';

    UEVR_SETTINGS_GROUPS.forEach(function(group) {
        html += '<div style="color:var(--teal);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:10px 0 4px;">' + group.label + '</div>';

        group.keys.forEach(function(settingKey) {
            const s   = UEVR_SETTINGS[settingKey];
            if (!s) return;
            const val = uevr.hasOwnProperty(s.key) ? uevr[s.key] : s.default;

            if (s.type === 'select') {
                const opts = s.options.map(function(o) {
                    return '<option value="' + o.value + '"' + (String(val) === o.value ? ' selected' : '') + '>' + o.label + '</option>';
                }).join('');
                html += row(s.label,
                    '<select data-uevr="' + s.key + '" style="background:#0d1520;border:1px solid rgba(255,255,255,0.12);border-radius:4px;color:var(--text-primary);font-size:11px;padding:2px 6px;max-width:220px;">' + opts + '</select>',
                    s.notes);
            } else if (s.type === 'toggle') {
                html += row(s.label,
                    '<label style="cursor:pointer;"><input type="checkbox" data-uevr="' + s.key + '" value="' + s.trueValue + '" ' + (String(val) === String(s.trueValue) ? 'checked' : '') + ' style="accent-color:var(--teal);"></label>',
                    s.notes);
            } else if (s.type === 'range') {
                const cur = parseFloat(val) || s.default;
                const dec = String(s.step).includes('.') ? String(s.step).split('.')[1].length : 0;
                html += row(s.label,
                    '<div style="display:flex;align-items:center;gap:6px;">' +
                    '<input type="range" data-uevr="' + s.key + '" min="' + s.min + '" max="' + s.max + '" step="' + s.step + '" value="' + cur + '" style="width:90px;accent-color:var(--teal);" oninput="this.nextElementSibling.textContent=parseFloat(this.value).toFixed(' + dec + ')">' +
                    '<span style="color:var(--text-primary);font-family:monospace;font-size:11px;min-width:32px;text-align:right;">' + cur.toFixed(dec) + '</span></div>',
                    s.notes);
            }
        });
    });

    // Shortcut reference
    html += '<details style="margin-top:14px;"><summary style="font-size:10px;color:var(--text-dim);cursor:pointer;padding:4px 0;font-family:var(--font-display);text-transform:uppercase;letter-spacing:1px;">Keyboard shortcuts</summary><div style="margin-top:8px;display:flex;flex-direction:column;gap:10px;">';
    UEVR_SHORTCUTS.forEach(function(group) {
        html += '<div><div style="font-size:9px;color:var(--teal);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">' + group.category + '</div>';
        group.shortcuts.forEach(function(sc) {
            const keyHtml = sc.keys.map(function(k) {
                return '<kbd style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:3px;padding:1px 5px;font-size:10px;font-family:monospace;">' + k + '</kbd>';
            }).join(' + ');
            html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.04);"><span style="font-size:11px;color:var(--text-secondary);">' + sc.action + '</span><span style="white-space:nowrap;margin-left:12px;">' + keyHtml + '</span></div>';
        });
        html += '</div>';
    });
    html += '</div></details>';

    return html;
}

window.populateUEVRTab = async function() {
    const exeName = selectedGame?.exe_name;
    if (!exeName) return;
    const isUE3D = selectedProfile?.type === 'ue3d';

    const tab = document.getElementById('modTab-uevr');
    if (!tab) return;
    tab.innerHTML = '<div style="color:var(--text-dim);font-size:11px;padding:8px;">Loading UEVR settings…</div>';

    // Load both configs in parallel
    const [uevrRes, vrto3dRes] = await Promise.all([
        window.api.uevrReadConfig(exeName).catch(() => ({ success: false })),
        window.api.vrto3dReadConfig().catch(() => ({ success: false })),
    ]);

    const uevr   = uevrRes.success   ? (uevrRes.config   || {}) : null;
    const vrto3d = vrto3dRes.success  ? (vrto3dRes.config || {}) : null;

    const notInstalled = (label) =>
        `<div style="color:rgba(255,180,80,0.8);font-size:11px;padding:4px 0;">⚠ ${label} not found — install the fix first.</div>`;

    const row = (label, inputHtml, hint = '') =>
        `<div class="setting-row" style="display:flex;flex-direction:column;gap:3px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
            <div style="display:flex;justify-content:space-between;align-items:center;">
                <span style="color:var(--text-secondary);font-size:11px;">${label}</span>
                ${inputHtml}
            </div>
            ${hint ? `<div style="color:var(--text-dim);font-size:10px;">${hint}</div>` : ''}
        </div>`;

    let html = `<div style="padding:0 4px;">`;

    // ── UEVR Settings section (always show, even if no config exists yet) ──
    html += `<div style="color:var(--teal);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 6px;">UEVR Settings <span style="color:var(--text-dim);font-weight:400;font-size:9px;">(auto-apply on launch)</span></div>`;
    
    // Always show these settings with defaults
    const uevrDefaults = {
        enable_input_passthrough: (uevr || {}).enable_input_passthrough || '0',
        rendering_mode: (uevr || {}).rendering_mode || '0',
        world_scale: parseFloat((uevr || {}).world_scale || 1.0),
        depth: parseFloat((uevr || {}).depth || 0.5),
        convergence: parseFloat((uevr || {}).convergence || 0.0),
        fov: parseFloat((uevr || {}).fov || 0.0),  // 0 = use game default
    };
    
    html += row('Input Passthrough',
        `<label style="cursor:pointer;"><input type="checkbox" data-uevr="enable_input_passthrough" ${uevrDefaults.enable_input_passthrough === '1' ? 'checked' : ''} style="accent-color:var(--teal);"> Enable</label>`,
        'Send mouse/keyboard to VR. Press Ctrl+F8 in-game to toggle.'
    );
    
    html += row('Rendering Mode',
        `<select data-uevr="rendering_mode" style="background:#0d1520;border:1px solid rgba(255,255,255,0.12);border-radius:4px;color:var(--text-primary);font-size:11px;padding:2px 6px;max-width:220px;">
            <option value="0" ${uevrDefaults.rendering_mode === '0' ? 'selected' : ''}>Native Stereo (recommended)</option>
            <option value="1" ${uevrDefaults.rendering_mode === '1' ? 'selected' : ''}>Synced Sequential</option>
            <option value="2" ${uevrDefaults.rendering_mode === '2' ? 'selected' : ''}>AFR (Alternate Frame)</option>
        </select>`,
        'Changes how the stereo image is rendered. Some games prefer specific modes.'
    );
    
    html += row('World Scale',
        `<input type="range" data-uevr="world_scale" min="0.1" max="10.0" step="0.1" value="${uevrDefaults.world_scale}" style="width:100px;" oninput="this.nextSibling.textContent=parseFloat(this.value).toFixed(1)"><span style="color:var(--text-primary);font-family:var(--font-mono);font-size:11px;min-width:32px;text-align:right;">${uevrDefaults.world_scale.toFixed(1)}</span>`,
        '1.0 = normal scale. Adjust to match your VR setup.'
    );
    
    html += row('Depth',
        `<input type="range" data-uevr="depth" min="0.0" max="2.0" step="0.01" value="${uevrDefaults.depth}" style="width:100px;" oninput="this.nextSibling.textContent=parseFloat(this.value).toFixed(2)"><span style="color:var(--text-primary);font-family:var(--font-mono);font-size:11px;min-width:32px;text-align:right;">${uevrDefaults.depth.toFixed(2)}</span>`,
        'Eye separation / IPD adjustment. Higher = more 3D depth.'
    );
    
    html += row('Convergence',
        `<input type="range" data-uevr="convergence" min="-1.0" max="1.0" step="0.01" value="${uevrDefaults.convergence}" style="width:100px;" oninput="this.nextSibling.textContent=parseFloat(this.value).toFixed(2)"><span style="color:var(--text-primary);font-family:var(--font-mono);font-size:11px;min-width:32px;text-align:right;">${uevrDefaults.convergence.toFixed(2)}</span>`,
        'Zero-parallax plane. Adjust if objects feel too close or too far.'
    );
    
    html += row('Field of View (FOV)',
        `<input type="number" data-uevr="fov" min="40" max="110" step="1" value="${uevrDefaults.fov}" style="width:48px;font-family:var(--font-mono);" /><span style="color:var(--text-dim);font-size:10px;margin-left:8px;">0 = game default</span>`,
        'Override game FOV. Most games default to 90. Set to 0 to use game\'s native setting.'
    );

    // ── Keyboard Shortcuts Reference ──
    html += `<details style="margin-top:14px;"><summary style="font-size:10px;color:var(--text-dim);cursor:pointer;padding:4px 0;font-family:var(--font-display);text-transform:uppercase;letter-spacing:1px;">⌨ Keyboard Shortcuts</summary>
    <div style="margin-top:8px;display:flex;flex-direction:column;gap:8px;font-size:10px;">
        <div>
            <div style="font-size:9px;color:var(--teal);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">In-Game Controls</div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:2px 0;border-bottom:1px solid rgba(255,255,255,0.04);"><span style="color:var(--text-secondary);">UEVR Menu</span><span style="font-family:var(--font-mono);">Insert or L3+R3</span></div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:2px 0;border-bottom:1px solid rgba(255,255,255,0.04);"><span style="color:var(--text-secondary);">Toggle Passthrough</span><span style="font-family:var(--font-mono);">Ctrl+F8</span></div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:2px 0;"><span style="color:var(--text-secondary);">Focus Shift (Desktop)</span><span style="font-family:var(--font-mono);">Ctrl+Numpad8</span></div>
        </div>
    </div>
    </details>`;

    html += `</div>`;

    tab.innerHTML = html;
    
    // Apply disabled state if mod settings are locked
    if (modLocked) {
        tab.querySelectorAll('input, select').forEach(el => el.disabled = true);
    }
};

// ── Geo-11 post-install settings preview ─────────────────────
// Reads the freshly-installed d3dxdm.ini and shows key pre-configured
// values in the result panel so the user knows what the mod author set up.
window.showGeoPreview = async function(gamePath, profile) {
    const iniFile = profile.ini_file || 'd3dxdm.ini';
    const iniPath = gamePath.replace(/[\/\\]$/, '') + '\\' + iniFile;
    try {
        const state = await window.api.iniGetState(profile.id, iniPath);
        if (!state?.success || !state.current) return;
        const cur = state.current;

        // Key settings to surface — these exist in most Geo-11 ini files
        const KEYS_TO_SHOW = [
            { section: 'Constants', key: 'x1',   label: 'Separation' },
            { section: 'Constants', key: 'x2',   label: 'Convergence' },
            { section: 'Constants', key: 'x3',   label: 'Depth preset' },
            { section: 'stereoscopic', key: 'separation',   label: 'Separation' },
            { section: 'stereoscopic', key: 'convergence',  label: 'Convergence' },
        ];

        const found = [];
        for (const { section, key, label } of KEYS_TO_SHOW) {
            const sectionData = cur[section] || cur[section?.toLowerCase()];
            if (!sectionData) continue;
            const val = sectionData[key] ?? sectionData[key.toLowerCase()];
            if (val !== undefined && val !== null) {
                found.push({ label, val: String(val) });
            }
        }
        if (found.length === 0) return;

        // Append a compact settings summary to the result area
        const resultEl = document.getElementById('installResult');
        if (!resultEl) return;
        const preview = document.createElement('div');
        preview.style.cssText = 'margin-top:10px;padding:8px 10px;background:rgba(100,220,200,0.06);border:1px solid rgba(100,220,200,0.2);border-radius:6px;font-size:11px;';
        preview.innerHTML = `<div style="color:var(--teal);font-weight:700;margin-bottom:6px;font-family:var(--font-display);text-transform:uppercase;letter-spacing:1px;font-size:10px;">Pre-configured by mod author</div>` +
            found.map(f => `<div style="display:flex;justify-content:space-between;color:var(--text-secondary);padding:2px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
                <span>${f.label}</span><span style="color:var(--text-primary);font-family:var(--font-mono);">${f.val}</span>
            </div>`).join('') +
            `<div style="color:var(--text-dim);font-size:10px;margin-top:6px;">Open Mod Settings to adjust these values.</div>`;
        resultEl.appendChild(preview);
    } catch { /* ini not readable yet — skip */ }
};

async function handleInstallClick() {
    const _softwareType = FIX_TYPE_TO_SOFTWARE[selectedProfile?.type];
    if (_softwareType) {
        await handleLaunchSoftware(_softwareType);
        return;
    }
    const gamePath = getInstallPath();
    if (!gamePath) { showResult(false, 'Set the Game Folder path first — click Browse…'); return; }
    const btn = document.getElementById('btnInstallFix');
    btn.disabled = true;
    resetTray();
    const removeListener = window.api.onInstallProgress(onProgress);
    setProgress(0, 'Installing fix…', null);
    try {
        const result = await window.api.installFix(selectedProfile, selectedGame.id, gamePath, selectedGame.exe_name);
        setProgress(100, result.success ? 'Installation complete' : 'Install failed', null);
        showResult(result.success, result.message || (result.success ? 'Fix installed.' : 'Install failed.'));
        if (result.success) {
            installedFixIds.add(selectedProfile.id);
            installedGameIds.add(selectedGame.id);
            updateBottomBar();
            renderSidebar(gamesData);
            loadReshadeStatus();
            // Auto-install ReShade if this pipeline requires shaders
            // OR if the profile has reshade_shaders but empty pipeline (e.g., native outputs)
            const steps    = getPipelineSteps(selectedProfile.type, getEffectiveOutputIdFromSelects()) || [];
            const stepsOrFallback = steps.length > 0 ? steps : (selectedProfile.reshade_shaders || []);
            const shaders  = getShadersForPipeline(stepsOrFallback);
            
            if (stepsOrFallback.length > 0 && shaders.length >= 0) {
                setProgress(50, 'Installing ReShade…', null);
                try {
                    const exeName = selectedGame.exe_name
                        || selectedGame.default_path?.split(/[/\\]/).filter(s => /\.\w+$/.test(s)).pop()
                        || selectedGame.default_path?.split(/[/\\]/).pop();
                    const exePath  = gamePath.replace(/[/\\]$/, '') + '\\' + exeName;
                    const geo11OK  = installedFixIds.has(selectedProfile.id) &&
                        ['geo11','geo12','3dmigoto','helixmod'].includes(selectedProfile.type);
                    // Include game's graphics_api in profile for proper ReShade hook DLL detection
                    const profileWithApi = { ...selectedProfile, graphics_api: selectedGame.graphics_api };
                    const result   = await window.api.reshadeInstall(
                        gamePath, exePath, profileWithApi, shaders, geo11OK);
                    if (result?.success) {
                        setProgress(75, 'ReShade installed', null);
                        reshadeStatus = null;
                        await loadReshadeStatus();
                    } else if (result?.message) {
                        setProgress(75, `ReShade: ${result.message}`, null);
                    }
                } catch (reshadeErr) {
                    setProgress(75, `ReShade auto-install skipped: ${reshadeErr.message}`, null);
                }
            }
            setProgress(100, 'Ready', null);
            // For Geo-11/12 fixes: read the installed ini and show a preconfigured settings preview
            if (['geo11','geo12','3dmigoto','helixmod'].includes(selectedProfile.type)) {
                await window.showGeoPreview?.(gamePath, selectedProfile);
            }
            // For UE3D/UEVR: show post-install launch guide
            if (['ue3d','uevr'].includes(selectedProfile.type)) {
                window.showUEVRGuide?.(selectedProfile);
            }
        } else { btn.disabled = false; }
    } catch (e) { showResult(false, e.message); btn.disabled = false; }
    finally { removeListener(); }
}

async function handleLaunchClick() {
    const gamePath = getInstallPath();
    if (!gamePath) { showResult(false, 'Set the Game Folder path first — click Browse...'); return; }
 
    // exe_name is the authoritative field; fall back to the segment of default_path
    // that looks like a filename (has an extension), then last segment.
    const exeName = selectedGame.exe_name
        || selectedGame.default_path?.split(/[/\\]/).filter(s => /\.\w+$/.test(s)).pop()
        || selectedGame.default_path?.split(/[/\\]/).pop();
    const exePath = gamePath.replace(/[/\\]$/, '') + '\\' + exeName;
 
    resetTray();
    setProgress(80, 'Launching game...', null);
 
    // UEVR / UE3D: launch game + UEVRInjector.exe (opens automatically after 2s)
    const isUEVR = selectedProfile && ['uevr','ue3d'].includes(selectedProfile.type);
    
    // If UEVR, write auto-config before launching so Lua plugin picks it up
    if (isUEVR) {
        try {
            const gameName = selectedGame.title || selectedGame.id;
            
            // Write the game name marker file so the Lua plugin knows which game is being launched
            await window.api.writeGameMarker(gameName);
            
            const uevrSettings = {
                enable_input_passthrough: document.querySelector('[data-uevr="enable_input_passthrough"]')?.checked ? '1' : '0',
                rendering_mode: document.querySelector('[data-uevr="rendering_mode"]')?.value || '0',
                world_scale: parseFloat(document.querySelector('[data-uevr="world_scale"]')?.value || 1.0),
                depth: parseFloat(document.querySelector('[data-uevr="depth"]')?.value || 0.5),
                convergence: parseFloat(document.querySelector('[data-uevr="convergence"]')?.value || 0.0),
                fov: parseFloat(document.querySelector('[data-uevr="fov"]')?.value || 0),
            };
            // Filter out undefined values
            Object.keys(uevrSettings).forEach(k => uevrSettings[k] === undefined && delete uevrSettings[k]);
            
            const autoConfigResult = await window.api.uevrWriteAutoConfig(gameName, uevrSettings);
            if (autoConfigResult.success) {
                setProgress(85, 'Auto-config written, launching...', null);
            }
        } catch (e) {
            console.warn('Could not write UEVR auto-config:', e.message);
        }
        
        // Also write VRto3D game profile if this game supports multiple outputs
        try {
            const outputId = getEffectiveOutputIdFromSelects();
            const displayId = selectedDisplay;  // This is now a string ID like 'simulated_reality' or 'passive_3dtv'
            
            console.log(`[VRto3D] Launch config: display=${displayId}, output=${outputId}`);
            
            // Map output IDs to display profile keys
            const outputFormatMap = {
                'sbs': 'sbs',
                'sbs_ou': 'sbs',
                'tab': 'tab',
                'tab_ou': 'tab',
                'frame_packing': 'frame_packing',
                'framepacking_hdmi': 'frame_packing',
                'frame_sequential': 'frame_sequential',
                'sr_weave': 'sr_weave',
                'interlaced': 'interlaced_row',
                'interlaced_row': 'interlaced_row',
                'interlaced_col': 'interlaced_col',
                'anaglyph': 'anaglyph',
                'vr_native': 'sbs'  // fallback
            };
            
            const profileKey = outputFormatMap[outputId] || outputId;
            
            // Check if VRto3D needs configuration for this output
            const vrto3dNeeded = Object.keys(outputFormatMap).includes(outputId);
            
            if (vrto3dNeeded && displayId && displayId !== 'none') {
                // Ensure VRto3D is installed
                const checkInstall = await window.api.vrto3dIsInstalled();
                if (!checkInstall.success || !checkInstall.installed) {
                    setProgress(82, 'Installing VRto3D driver…', null);
                    const installResult = await window.api.vrto3dInstall({ force: false });
                    if (!installResult.success) {
                        console.warn('VRto3D installation failed:', installResult.message);
                    }
                }
                
                // Load display JSON to get output profile
                let displayProfile = null;
                try {
                    const displayResult = await window.api.loadDisplay(displayId);
                    if (displayResult?.success && displayResult.data?.vrto3d_output_profiles) {
                        if (displayResult.data.vrto3d_output_profiles[profileKey]) {
                            displayProfile = displayResult.data.vrto3d_output_profiles[profileKey];
                            console.log(`[VRto3D] Loaded display profile: ${displayId}/${profileKey}`);
                        }
                    } else if (displayResult?.message) {
                        console.warn(`[VRto3D] Could not load display: ${displayResult.message}`);
                    }
                } catch (e) {
                    console.warn(`[VRto3D] Error loading display ${displayId}:`, e.message);
                }
                
                if (displayProfile) {
                    // Start with the display-specific profile
                    const gameProfile = { ...displayProfile };
                    
                    // Override with user's manual VRto3D settings if provided
                    const userDepth = parseFloat(document.querySelector('[data-vrto3d="depth"]')?.value || '');
                    const userConvergence = parseFloat(document.querySelector('[data-vrto3d="convergence"]')?.value || '');
                    const userFov = parseFloat(document.querySelector('[data-vrto3d="fov"]')?.value || '');
                    
                    if (!isNaN(userDepth)) gameProfile.depth = userDepth;
                    if (!isNaN(userConvergence)) gameProfile.convergence = userConvergence;
                    if (!isNaN(userFov)) gameProfile.fov = userFov;
                    
                    // Extract game exe name and write multiple profile copies for UE4/5 compatibility
                    let exeName = selectedGame?.exe_name || selectedGame?.id || 'game';
                    exeName = exeName.replace(/\.exe$/i, ''); // Strip .exe extension
                    
                    const exeNames = [exeName]; // List of exe names to write profiles for
                    
                    // For Unreal Engine games, also write shipping exe variants (common with launchers)
                    // UE4/5 often uses: GAMENAME.exe (launcher) → GAMENAME-Win64-Shipping.exe (actual game)
                    if (selectedGame?.graphics_api?.includes('dx')) {
                        // Check if it looks like an UE game (short name that might be a launcher)
                        const shippingName = exeName + '-Win64-Shipping';
                        if (shippingName !== exeName && !exeName.includes('Win64')) {
                            exeNames.push(shippingName);
                        }
                    }
                    
                    // Write game-specific profile for each likely exe name so VRto3D can find them
                    for (const eName of exeNames) {
                        console.log(`[VRto3D] Writing profile for: ${eName}`);
                        const profileResult = await window.api.vrto3dWriteGameProfile(eName, gameProfile);
                        if (profileResult.success) {
                            setProgress(88, `VRto3D profile written for ${eName}, launching…`, null);
                            console.log(`[VRto3D] Profile written successfully: ${profileResult.path}`);
                        } else {
                            console.error(`[VRto3D] Failed to write profile for ${eName}:`, profileResult.message);
                        }
                    }
                } else {
                    console.log(`[VRto3D] No output profile found for display=${displayId}, output=${profileKey}. Display loaded but vrto3d_output_profiles missing or key not found.`);
                }
            }
        } catch (e) {
            console.warn('Could not configure VRto3D:', e.message);
        }
    }
    
    // Resolver-driven pipeline execution. Single call now replaces the
    // scattered per-tool config writes (ReShade 3DGameBridge toggle, VRServer
    // ReShade install, Geo-11 INI patch) that lived inline here. The
    // executePipeline IPC dispatches to modules/adapters/{tool}.js based on
    // the resolved fix → display → output → headtracking selection.
    try {
        const outputId = getEffectiveOutputIdFromSelects();
        const htState  = window.getHeadtrackingState?.() || { enabled: false, method: null };
        const displayId = window._selectedDisplayOutput
                         || (window._selectedDisplayDevice?.familyId)
                         || null;

        if (displayId && selectedProfile) {
            setProgress(90, 'Applying pipeline configuration…', null);
            const pipelineResult = await window.api.executePipeline({
                fix:         selectedProfile,
                displayId,
                outputId,
                gameContext: {
                    id:       selectedGame?.id || null,
                    exeName:  selectedProfile.exe_name || selectedGame?.exe_name || null,
                    gamePath: gamePath || null,
                },
                headtracking:  {
                    enabled:    htState.enabled,
                    method:     htState.method,
                    input_mode: htState.input_mode,
                    axes:       htState.axes,
                },
                userOverrides: {
                    geo11: (geoState ? geoPending : {}),
                    wiz3d: wiz3dPending,
                    opentrack: {
                        axes: htState.axes,
                    },
                },
                options:       { graphicsApi: selectedProfile.graphics_api || null },
            });
            for (const w of (pipelineResult?.warnings || [])) console.warn('[Pipeline]', w);
            for (const e of (pipelineResult?.errors   || [])) console.error('[Pipeline]', e);
            for (const a of (pipelineResult?.applied  || [])) console.log('[Pipeline]', a);
            if (pipelineResult?.success === false) {
                setProgress(92, 'Pipeline reported errors — see console', null);
            } else {
                setProgress(92, htState.enabled ? `Headtracking: ${htState.method || 'on'}` : 'Pipeline applied', null);
            }
        } else {
            console.warn('[Pipeline] Skipped (no displayId or no selectedProfile) — falling back to legacy Geo-11 sync');
            await applyGeo11SettingsBeforeLaunch();
        }
    } catch (e) {
        console.warn('Pipeline execution failed; falling back to legacy Geo-11 sync:', e.message);
        try { await applyGeo11SettingsBeforeLaunch(); } catch { /* swallow */ }
    }
    
    const result = isUEVR
        ? await window.api.launchWithUEVR(exePath)
        : await window.api.launchGame(exePath);

    // After the existing isUEVR / launchWithUEVR call succeeds,
    // wire up the injection status listener so the user sees progress:
    if (isUEVR && result.success) {
        // Show injection watcher progress in the tray
        const removeInjectListener = window.api.onUEVRInjectStatus((data) => {
            setProgress(data.done ? 100 : 85, data.message, null);
            if (data.done) {
                removeInjectListener();
                if (!data.success) {
                    showResult(false, `UEVR injection failed: ${data.message}`);
                } else {
                    setTimeout(hideTray, 3000);
                }
            }
        });
     
        // If the exe was redirected from a launcher to the shipping exe, tell the user
        if (result.redirected) {
            setProgress(82, `Redirected to shipping exe — waiting for game to start…`, null);
        } else {
            setProgress(82, `Game launched — waiting for process to start…`, null);
        }
    }
 
    if (!result.success) {
        showResult(false, result.message);
    } else {
        if (isUEVR && result.injectorLaunched === false && result.message) {
            // UEVRInjector.exe wasn't found — warn user
            showResult(false, result.message + '\n\nDownload UEVRInjector.exe from github.com/praydog/UEVR/releases and place it in resources/uevr/');
        } else {
            setProgress(100, 'Launched!', null);
        }
        // Clear pending UEVR guide now that the user has launched
        if (isUEVR) {
            window.api.setInstallExtra?.(selectedProfile.id, { pendingGuide: false });
            const res = document.getElementById('installResult');
            if (res) res.style.display = 'none';
        }
        const btn = document.getElementById('btnLaunchGame');
        const orig = btn.textContent;
        btn.textContent = '✓ Launched';
        setTimeout(() => { hideTray(); btn.textContent = orig; }, 2500);
        // Fire any post-launch hotkeys defined in the fix profile
        const hotkeys = selectedProfile?.post_launch_keys || [];
        for (const hk of hotkeys) {
            if (hk.keys) {
                window.api.sendKeys(hk.keys, hk.delay_ms ?? 3000)
                    .catch(() => { /* silent if sendKeys unavailable */ });
                if (hk.note) showResult(true, `⌨ ${hk.note}`, true);
            }
        }
    }
}
 
async function handleLaunchSoftware(softwareId) {
    // Check if installed
    const check = await window.api.softwareCheck(softwareId);
 
    if (!check.found) {
        // Not installed — show a clear message with a download link
        showResult(false,
            `${check.name} is not installed.\n` +
            `Download it from:\n${check.url}`
        );
        // Open the website after a short pause
        setTimeout(() => window.api.openUrl(check.url), 400);
        return;
    }
 
    // Launch it
    const btn = document.getElementById('btnInstallFix');
    btn.disabled = true;
    setProgress(80, `Launching ${check.name}…`, null);
 
    const result = await window.api.softwareLaunch(softwareId);
    if (result.success) {
        setProgress(100, 'Launched!', null);
        const orig = btn.textContent;
        btn.textContent = `✓ ${check.name} launched`;
        setTimeout(() => { btn.textContent = orig; btn.disabled = false; hideTray(); }, 3000);
    } else {
        showResult(false, result.message || 'Launch failed');
        btn.disabled = false;
    }
}

async function handleUninstallClick() {
    const gamePath = getInstallPath();
    if (!gamePath) { showResult(false, 'Set the Game Folder path first — click Browse…'); return; }

    // UEVR/UE3D doesn't install to the game folder — just mark as uninstalled
    if (['uevr','ue3d'].includes(selectedProfile.type)) {
        if (!confirm(`Uninstall ${selectedProfile.name}?\n\nThis removes the entry from Stereopticon. UEVR itself and the game profile in %AppData%\\UnrealVRMod are kept — remove those manually if needed.`)) return;
        installedFixIds.delete(selectedProfile.id);
        installedGameIds.delete(selectedGame.id);
        window.api.setInstallExtra?.(selectedProfile.id, { pendingGuide: false });
        // TODO: call uninstallFix for marking only — no file deletion needed
        updateBottomBar();
        renderSidebar(gamesData);
        showResult(true, `${selectedProfile.name} removed from Stereopticon.\n\nTo fully uninstall UEVR, delete:\n• resources/uevr/\n• %AppData%\\UnrealVRMod\\${selectedGame.exe_name?.replace(/\.exe$/i,'') || selectedGame.id}`);
        return;
    }

    if (!confirm(`Uninstall ${selectedProfile.name} from:\n${gamePath}\n\nThis will remove fix DLLs, ini, and ShaderFixes folder.`)) return;
    const btn = document.getElementById('btnUninstallMain');
    btn.disabled = true;
    resetTray();
    setProgress(10, 'Removing fix files…', null);
    const result = await window.api.uninstallFix(selectedProfile, gamePath);
    if (result.success) {
        setProgress(100, 'Uninstall complete', null);
        showResult(true, result.message);
        installedFixIds.delete(selectedProfile.id);
        const anyLeft = selectedGame.fixes.some(f => installedFixIds.has(f.id));
        if (!anyLeft) installedGameIds.delete(selectedGame.id);
        updateBottomBar();
        renderSidebar(gamesData);
        loadReshadeStatus();
    } else {
        setProgress(0, 'Uninstall failed', null);
        showResult(false, result.message);
    }
    btn.disabled = false;
}

// ─── MOD SETTINGS (universalised) ────────────────────────────
window.switchModTab = function(tab) {
    const geoPanel     = document.getElementById('geoPanel');
    const reshadePanel = document.getElementById('reshadePanel');
    const uevrPanel    = document.getElementById('uevrPanel');
    const vrto3dPanel  = document.getElementById('vrto3dPanel');
    const wiz3dPanel   = document.getElementById('wiz3dPanel');
    const geoLegend    = document.getElementById('geoLegend');
    const tabGeo       = document.getElementById('tabGeo');
    const tabReshade   = document.getElementById('tabReshade');
    const tabUEVR      = document.getElementById('tabUEVR');
    const tabVRto3D    = document.getElementById('tabVRto3D');
    const tabWiz3D     = document.getElementById('tabWiz3D');
    const allPanels    = [geoPanel, reshadePanel, uevrPanel, vrto3dPanel, wiz3dPanel].filter(Boolean);
    const allTabs      = [tabGeo, tabReshade, tabUEVR, tabVRto3D, tabWiz3D].filter(Boolean);
    // Hide all first
    allPanels.forEach(p => { p.style.display = 'none'; });
    allTabs.forEach(t => t.classList.remove('active'));
    if (geoLegend) geoLegend.style.display = 'none';

    if (tab === 'geo' && geoPanel) {
        geoPanel.style.display = 'flex';
        if (geoLegend) geoLegend.style.display = 'flex';
        tabGeo?.classList.add('active');
    } else if (tab === 'reshade' && reshadePanel) {
        reshadePanel.style.display = 'flex';
        tabReshade?.classList.add('active');
        window.populateReshadeTab?.();
        // Apply disabled state to ReShade inputs if locked
        if (modLocked) {
            setTimeout(() => {
                reshadePanel.querySelectorAll('input, select').forEach(el => el.disabled = true);
            }, 0);
        }
    } else if (tab === 'uevr' && uevrPanel) {
        uevrPanel.style.display = 'flex';
        tabUEVR?.classList.add('active');
        window.populateUEVRTab?.();
    } else if (tab === 'vrto3d' && vrto3dPanel) {
        vrto3dPanel.style.display = 'flex';
        tabVRto3D?.classList.add('active');
        window.populateVRto3DTab?.();
    } else if (tab === 'wiz3d' && wiz3dPanel) {
        wiz3dPanel.style.display = 'flex';
        tabWiz3D?.classList.add('active');
        window.populateWiz3DTab?.();
        if (modLocked) {
            setTimeout(() => {
                wiz3dPanel.querySelectorAll('input, select').forEach(el => el.disabled = true);
            }, 0);
        }
    }
};

window.populateReshadeTab = function() {
    // Show info and shaders for ReShade configuration
    const list = document.getElementById('reshadeShaderList');
    const apiEl = document.getElementById('reshadeGraphicsAPI');
    const chainModeRow = document.getElementById('reshadeChainModeRow');
    const chainModeEl = document.getElementById('reshadeChainMode');
    
    if (!selectedProfile || !selectedGame) return;
    
    // Show graphics API from game data
    const api = selectedGame.graphics_api || '—';
    if (apiEl) apiEl.textContent = api.toUpperCase();
    
    // Show chain mode for Geo-11
    if (selectedProfile.type === 'geo11' && chainModeRow) {
        chainModeRow.style.display = 'flex';
        const chainMode = selectedProfile.geo11_type || 'Shader Fix';
        if (chainModeEl) chainModeEl.textContent = chainMode;
    } else if (chainModeRow) {
        chainModeRow.style.display = 'none';
    }
    
    // List installed shaders
    const steps   = getPipelineSteps(selectedProfile.type, getEffectiveOutputIdFromSelects()) || [];
    const shaders = getShadersForPipeline(steps);
    if (!list) return;
    
    if (shaders.length === 0) {
        list.innerHTML = '<span style="color:var(--text-dim);font-size:11px;">No shaders configured for this fix.</span>';
    } else {
        list.innerHTML = shaders.map(s => `<div style="display:flex;align-items:center;gap:8px;">
            <span style="color:var(--teal);font-size:10px;">●</span>
            <span>${s}</span>
        </div>`).join('');
    }
    window.updateModScreenshotPreview();
};

window.populateVRto3DTab = async function() {
    const tab = document.getElementById('modTab-vrto3d');
    if (!tab) return;
    
    tab.innerHTML = '<div style="color:var(--text-dim);font-size:11px;padding:8px;">Loading VRto3D settings…</div>';
    
    try {
        const vrto3dRes = await window.api.vrto3dReadConfig();
        const vrto3d = vrto3dRes.success ? (vrto3dRes.config || {}) : null;
        
        const row = (label, inputHtml, hint = '') =>
            `<div class="setting-row" style="display:flex;flex-direction:column;gap:3px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <span style="color:var(--text-secondary);font-size:11px;">${label}</span>
                    ${inputHtml}
                </div>
                ${hint ? `<div style="color:var(--text-dim);font-size:10px;">${hint}</div>` : ''}
            </div>`;
        
        let html = `<div style="padding:0 4px;"><div style="color:var(--teal);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 6px;">VRto3D Depth & Convergence</div>`;
        
        if (!vrto3d) {
            html += `<div style="color:rgba(255,180,80,0.8);font-size:11px;padding:4px 0;">⚠ VRto3D default_config.json not found — launch SteamVR once after installing.</div>`;
        } else {
            const depth = vrto3d.depth ?? vrto3d.separation ?? 0.5;
            html += row('Depth (separation)',
                `<input type="range" data-vrto3d="depth" min="0.0" max="1.0" step="0.01" value="${depth}" style="width:100px;" oninput="this.nextSibling.textContent=parseFloat(this.value).toFixed(2)"><span style="color:var(--text-primary);font-family:var(--font-mono);font-size:11px;min-width:32px;text-align:right;">${parseFloat(depth).toFixed(2)}</span>`,
                'Ctrl+F3/F4 in-game. Higher = more 3D depth.'
            );
            const conv = vrto3d.convergence ?? 0.0;
            html += row('Convergence',
                `<input type="range" data-vrto3d="convergence" min="-1.0" max="1.0" step="0.01" value="${conv}" style="width:100px;" oninput="this.nextSibling.textContent=parseFloat(this.value).toFixed(2)"><span style="color:var(--text-primary);font-family:var(--font-mono);font-size:11px;min-width:32px;text-align:right;">${parseFloat(conv).toFixed(2)}</span>`,
                'Ctrl+F5/F6 in-game. Adjust zero-parallax plane.'
            );
            const display = vrto3d.display_index ?? 0;
            html += row('Display index',
                `<input type="number" data-vrto3d="display_index" value="${display}" min="0" max="8" style="width:48px;background:var(--bg-panel);border:1px solid rgba(255,255,255,0.12);border-radius:4px;color:var(--text-primary);font-size:11px;padding:2px 6px;">`,
                '0 = primary display.'
            );
        }
        
        html += `</div>`;
        
        tab.innerHTML = html;
        
        // Apply disabled state if mod settings are locked
        if (modLocked) {
            tab.querySelectorAll('input, select').forEach(el => el.disabled = true);
        }
    } catch (e) {
        tab.innerHTML = `<div style="color:var(--danger);font-size:11px;">Error: ${e.message}</div>`;
    }
};

window.populateWiz3DTab = function() {
    const tab = document.getElementById('modTab-wiz3d');
    if (!tab) return;

    // userOverrides shape (see modules/wiz3dConfig.js#buildPatches):
    //   enable, separation, convergence, autofocus, swap_eyes,
    //   separation_scale, sbs_gap, srgb
    const p = wiz3dPending;
    const outputId = (typeof getEffectiveOutputIdFromSelects === 'function')
        ? getEffectiveOutputIdFromSelects() : null;
    const isSbs       = (outputId === 'sbs' || outputId === 'sbs_half');
    const isSrWeave   = (outputId === 'sr_weave');

    const enable           = p.enable           !== undefined ? !!p.enable           : true;
    const separation       = p.separation       !== undefined ? +p.separation        : 0.18;
    const convergence      = p.convergence      !== undefined ? +p.convergence       : 0.12;
    const autofocus        = p.autofocus        !== undefined ? !!p.autofocus        : true;
    const swap_eyes        = p.swap_eyes        !== undefined ? !!p.swap_eyes        : false;
    const separation_scale = p.separation_scale !== undefined ? +p.separation_scale  : 1.0;
    const sbs_gap          = p.sbs_gap          !== undefined ? +p.sbs_gap           : 0;
    const srgb             = p.srgb             !== undefined ? !!p.srgb             : true;

    const row = (label, inputHtml, hint = '') =>
        `<div class="setting-row" style="display:flex;flex-direction:column;gap:3px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
            <div style="display:flex;justify-content:space-between;align-items:center;">
                <span style="color:var(--text-secondary);font-size:11px;">${label}</span>
                ${inputHtml}
            </div>
            ${hint ? `<div style="color:var(--text-dim);font-size:10px;">${hint}</div>` : ''}
        </div>`;

    let html = `<div style="padding:0 4px;">`;
    html += `<div style="color:var(--teal);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 6px;">wiz3D — Stereo</div>`;

    html += row('Enable stereo',
        `<label class="geo-toggle"><input type="checkbox" data-wiz3d="enable" ${enable?'checked':''} onchange="wiz3dPending.enable=this.checked"><span class="geo-toggle-track"></span></label>`,
        'Master switch — writes &lt;EnableStereo Value="1|0"/&gt; on launch.'
    );
    html += row('Separation (StereoBase)',
        `<input type="range" data-wiz3d="separation" min="0" max="0.8" step="0.01" value="${separation}" style="width:120px;" oninput="wiz3dPending.separation=parseFloat(this.value);this.nextSibling.textContent=parseFloat(this.value).toFixed(2)"><span style="color:var(--text-primary);font-family:var(--font-mono);font-size:11px;min-width:38px;text-align:right;">${separation.toFixed(2)}</span>`,
        'Eye spacing. Higher = stronger 3D, more eye strain.'
    );
    html += row('Convergence (1/ZPS)',
        `<input type="range" data-wiz3d="convergence" min="0" max="1.0" step="0.01" value="${convergence}" style="width:120px;" oninput="wiz3dPending.convergence=parseFloat(this.value);this.nextSibling.textContent=parseFloat(this.value).toFixed(2)"><span style="color:var(--text-primary);font-family:var(--font-mono);font-size:11px;min-width:38px;text-align:right;">${convergence.toFixed(2)}</span>`,
        'Zero-parallax plane (1 / ZPS). Adjusts what "lives in" the screen.'
    );
    html += row('Autofocus',
        `<label class="geo-toggle"><input type="checkbox" data-wiz3d="autofocus" ${autofocus?'checked':''} onchange="wiz3dPending.autofocus=this.checked"><span class="geo-toggle-track"></span></label>`,
        'Dynamic convergence based on scene depth (Preset[0]/AutoFocusEnable).'
    );
    html += row('Swap left/right eyes',
        `<label class="geo-toggle"><input type="checkbox" data-wiz3d="swap_eyes" ${swap_eyes?'checked':''} onchange="wiz3dPending.swap_eyes=this.checked"><span class="geo-toggle-track"></span></label>`,
        'Reverses stereo perspective if 3D looks inverted.'
    );
    html += row('Separation scale',
        `<input type="range" data-wiz3d="separation_scale" min="0.5" max="3.0" step="0.05" value="${separation_scale}" style="width:120px;" oninput="wiz3dPending.separation_scale=parseFloat(this.value);this.nextSibling.textContent=parseFloat(this.value).toFixed(2)"><span style="color:var(--text-primary);font-family:var(--font-mono);font-size:11px;min-width:38px;text-align:right;">${separation_scale.toFixed(2)}</span>`,
        'Global multiplier applied on top of StereoBase.'
    );

    if (isSbs) {
        html += `</div><div style="padding:0 4px;margin-top:10px;">`;
        html += `<div style="color:var(--teal);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 6px;">Side-by-Side</div>`;
        html += row('Gap (px)',
            `<input type="number" data-wiz3d="sbs_gap" min="0" max="100" step="1" value="${sbs_gap}" style="width:60px;background:var(--bg-panel);border:1px solid rgba(255,255,255,0.12);border-radius:4px;color:var(--text-primary);font-size:11px;padding:2px 6px;" onchange="wiz3dPending.sbs_gap=parseInt(this.value,10)||0">`,
            'Black gutter between the two views.'
        );
    }
    if (isSrWeave) {
        html += `</div><div style="padding:0 4px;margin-top:10px;">`;
        html += `<div style="color:var(--teal);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 6px;">SR Weave Output</div>`;
        html += row('sRGB',
            `<label class="geo-toggle"><input type="checkbox" data-wiz3d="srgb" ${srgb?'checked':''} onchange="wiz3dPending.srgb=this.checked"><span class="geo-toggle-track"></span></label>`,
            'Required for correct gamma on Acer SpatialLabs / Samsung Odyssey 3D / Asus Spatial Vision.'
        );
    }
    html += `</div>`;
    html += `<div style="font-size:10px;color:var(--text-dim);padding:8px 4px 0;line-height:1.6;">Patches the variant-specific Config.xml on launch (wiz3D_Config.xml / 3DVision_Config.xml / HD3D_Config.xml). Comments and formatting are preserved.</div>`;

    tab.innerHTML = html;

    if (modLocked) {
        tab.querySelectorAll('input, select').forEach(el => el.disabled = true);
    }
};

window.updateModScreenshotPreview = function() {
    const before   = document.getElementById('ms-ss-before')?.checked;
    const after    = document.getElementById('ms-ss-after')?.checked;
    const fmt      = document.getElementById('ms-ss-format')?.value || 'PNG';
    const inFolder = document.getElementById('ms-ss-folder')?.checked;
    const preview  = document.getElementById('ms-ss-preview');
    if (!preview) return;
    let lines = [];
    if (!before && !after) lines.push('📷 Screenshots disabled (Print Screen key)');
    else {
        if (before) lines.push(`📷 Before effects saved as ${fmt}`);
        if (after)  lines.push(`📷 After effects saved as ${fmt}`);
    }
    lines.push(inFolder ? '📁 Saved in game folder' : '📁 Default ReShade screenshots folder');
    preview.innerHTML = lines.join('<br>');
};

window.applyModScreenshotSettings = async function() {
    const gamePath = getInstallPath();
    if (!gamePath) return;
    const reshadeIni = gamePath.replace(/[/\\]$/, '') + '\\ReShade.ini';
    const before   = document.getElementById('ms-ss-before')?.checked  ?? false;
    const after    = document.getElementById('ms-ss-after')?.checked   ?? true;
    const fmt      = document.getElementById('ms-ss-format')?.value    || 'PNG';
    const inFolder = document.getElementById('ms-ss-folder')?.checked  ?? true;
    let beforeEffects = 0;
    if (before && after) beforeEffects = 1;
    else if (before)     beforeEffects = 2;
    const patches = {
        SaveFormat:            fmt,
        SaveBeforeUseEffects:  String(beforeEffects),
        SavePath:              inFolder ? '.\ ' : '',
    };
    // Use iniApply to patch the [SCREENSHOT] section
    const result = await window.api.reshadeIniPatch(reshadeIni, 'SCREENSHOT', patches);
    if (result?.success) {
        const btn = event?.target;
        if (btn) { const orig = btn.textContent; btn.textContent = '✓ Applied'; setTimeout(() => btn.textContent = orig, 1500); }
    }
};

openModSettings = async function() {
    const type = selectedProfile.type;
    if (['geo11','geo12','3dmigoto','helixmod'].includes(type)) {
        openGeoModal();
    } else if (['uevr','ue3d'].includes(type)) {
        // UE3D/UEVR uses the same modal as Geo-11 but starts on the UEVR tab
        openGeoModal({ defaultTab: 'uevr', hideGeoTab: true });
    }
};

function openUevrSettingsModal() {
    const modal = document.getElementById('uevrSettingsModal');
    if (!modal) return;
    document.getElementById('uevrModalTitle').textContent = `UEVR — ${selectedProfile.name}`;
    const gamePath   = getInstallPath();
    const profileUrl = selectedProfile.uevr_profile_url || null;
    const notes      = selectedProfile.uevr_notes || selectedProfile.notes || 'No specific UEVR notes.';
    const activation = selectedProfile.activation || null;
    document.getElementById('uevrModalBody').innerHTML = `
        <div style="display:flex;flex-direction:column;gap:14px;">
            <div class="card" style="padding:14px 16px;">
                <h3>Profile</h3>
                <p style="font-size:12px;color:var(--text-secondary);margin-bottom:10px;">${notes}</p>
                ${profileUrl ? `
                <button class="link-btn" style="border-color:var(--warn);color:var(--warn);"
                    onclick="window.api.openUrl('${profileUrl}')">Download UEVR Profile ⇩</button>
                <p style="font-size:10px;color:var(--text-dim);margin-top:8px;">
                    Place in <code style="color:var(--teal);">%APPDATA%\\UnrealVRMod\\[GameName]\\</code></p>`
                : `<p style="font-size:11px;color:var(--text-dim);">No separate profile needed — inject directly.</p>`}
            </div>
            ${activation ? `
            <div style="padding:10px 12px;background:rgba(201,138,75,0.04);border:1px solid var(--teal-border);border-radius:8px;">
                <div style="font-family:var(--font-display);font-size:9px;color:var(--teal);font-weight:700;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:6px;">Activation Notes</div>
                <p style="font-size:12px;color:var(--text-secondary);line-height:1.5;">${activation}</p>
            </div>` : ''}
            <div class="card" style="padding:14px 16px;">
                <h3>How to Use UEVR</h3>
                <div style="font-size:12px;color:var(--text-secondary);line-height:1.8;">
                    1. Launch the game normally<br>
                    2. Open UEVR injector and find the game process<br>
                    3. Click <strong style="color:var(--teal);">Inject</strong><br>
                    4. Put on your headset<br>
                    5. Use the UEVR in-VR menu (grip + menu) to adjust settings
                </div>
            </div>
        </div>`;
    modal.style.display = 'flex';
}
window.closeUevrSettingsModal = function() { const m = document.getElementById('uevrSettingsModal'); if (m) m.style.display = 'none'; };

// ─── STARTUP ────────────────────────────────────────────────
async function init() {
    try {
        // Lazy-load architecture: pull the light SIDEBAR projection at startup
        // (id/title/filter-relevant fields only — ~70% smaller than full
        // bundle). Full per-game data is fetched on demand via loadGameOne(id)
        // when the user selects a game. Massive cold-start speedup for the
        // 7,500-game catalogue.
        const sidebar = await window.api.loadGamesSidebar();
        const games = (sidebar && sidebar.games) || [];
        const pipelines = (sidebar && sidebar.pipelines) || await window.api.loadPipelines();
        const outputs   = (sidebar && sidebar.outputs)   || await window.api.loadOutputs();
        pipelines.forEach(p => { PIPELINES[p.id] = p; GLOBAL_PIPELINES[p.id] = p.supported_outputs || {}; });
        outputs.forEach(o => {
            OUTPUT_DEFINITIONS[o.id] = { label: o.name, status: o.status || 'active', subs: o.variants ? o.variants.map(v => v.name) : ['Standard'] };
        });

        if (!Array.isArray(games) || games.length === 0) {
            console.warn('No game data loaded. Ensure data/games/*.json exists and is valid JSON.');
            detailArea.innerHTML = `<div style="color:var(--danger);padding:20px;">No game entries found. If this is incorrect, restore data/game JSON files or reinstall.</div>`;
            gamesData = [];
            return;
        }

        gamesData = games;
        await loadInstallState();

        // Hydrate scan results from the last launch immediately — the
        // sidebar's availability tier ("installed" / "available") is derived
        // from _scannedPaths, and scanning 445 games from disk takes seconds.
        // Cached values give an instant first-render; we re-scan in the
        // background and re-render if results change.
        const SCAN_CACHE_KEY = 'stereopticon.scanCache.v1';
        const SCAN_CACHE_TTL_MS = 24 * 60 * 60 * 1000;   // 24h
        let cachedScan = null;
        try {
            const raw = localStorage.getItem(SCAN_CACHE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && parsed.ts && (Date.now() - parsed.ts) < SCAN_CACHE_TTL_MS) {
                    cachedScan = parsed.paths || {};
                }
            }
        } catch {}
        if (cachedScan) {
            window._scannedPaths = cachedScan;
        }

        renderSidebar(gamesData);
        autoSelectDisplayFromDetection();
        // Background game path scan. Wait a beat so the UI paints first.
        // If we hydrated from cache, this becomes a freshness check; if we
        // didn't, it's the first scan since install.
        // Filter the scan to plausibly-installable games only — anything
        // without a Steam app ID AND without an exe_name has nothing to
        // probe for. This drops the scan from 7,500 → ~500 candidates, the
        // dominant chunk of "took ages to be usable after launch".
        const scanCandidates = gamesData
            .filter(g => g.steam_app_id || g.exe_name || g.default_path)
            .map(g => ({
                id:          g.id,
                title:       g.title,
                exeName:     g.exe_name || g.fixes?.[0]?.exe_name || null,
                steamAppId:  g.steam_app_id || null,
            }));
        // Defer the scan until after the user can actually interact (1.5s)
        // and run it in the background. Cached results from previous launches
        // already power the sidebar; this just freshens them.
        setTimeout(async () => {
            try {
                const fresh = await window.api.gameScanAll(scanCandidates);
                window._scannedPaths = fresh;
                try {
                    localStorage.setItem(SCAN_CACHE_KEY, JSON.stringify({
                        ts:    Date.now(),
                        paths: fresh,
                        count: gamesData.length,
                    }));
                } catch {}
                const cachedKeys = cachedScan ? Object.keys(cachedScan).sort().join(',') : '';
                const freshKeys  = Object.keys(fresh).sort().join(',');
                if (cachedKeys !== freshKeys) renderSidebar(gamesData);
            } catch { /* silent */ }
        }, 1500);
    } catch (e) {
        console.error('Failed to load data:', e);
        detailArea.innerHTML = `<div style="color:var(--danger);padding:20px;">Error loading data: ${e.message}</div>`;
    }
}

// ─── SIDEBAR ────────────────────────────────────────────────
function filterAndSortGames(games) {
    const src = Array.isArray(games) ? games : gamesData;
    if (!Array.isArray(src) || src.length === 0) return [];

    const hidden          = loadHiddenGames();
    const showVrOnly      = isShowVrOnly();
    const showDeprecated  = isShowDeprecated();
    const excluded        = loadExcludedFilters();   // Set<filterId>

    // Build the predicates each excluded filter implies, ONCE per filter
    // call. Then for every game, check if it satisfies any excluded
    // predicate → if so, hide it.
    const excludePredicates = [...excluded].map(buildFilterPredicate).filter(Boolean);

    // Predicate for the currently active (positive) filter, if any.
    const activePred = (filterMode === 'all') ? null : buildFilterPredicate(filterMode);

    let filtered = src.filter(game => {
        if (!game || typeof game.title !== 'string') return false;
        if (hidden.has(game.id)) return false;
        if (!showVrOnly && game.is_vr_only) return false;
        if (!showDeprecated && game.is_deprecated_only) return false;
        if (!game.title.toLowerCase().includes(searchTerm.toLowerCase())) return false;
        if (filterMode === 'installed' && !installedGameIds.has(game.id)) return false;
        // Excluded filters: game is hidden if ANY excluded predicate matches.
        for (const p of excludePredicates) { if (p(game)) return false; }
        // Positive filter (if any non-'all' / non-'installed' chip is active).
        if (activePred && filterMode !== 'installed' && !activePred(game)) return false;
        return true;
    });
    if (sortMode === 'alpha') filtered.sort((a, b) => a.title.localeCompare(b.title));
    else if (sortMode === 'recent') filtered.sort((a, b) => {
        const tA = parseInt(localStorage.getItem(`recent_${a.id}`)) || 0;
        const tB = parseInt(localStorage.getItem(`recent_${b.id}`)) || 0;
        return tB - tA;
    });
    return filtered;
}

// Hash-derive a stable warm gradient for each game from its id (so the list
// has visual variety without needing real cover art). Returns {from,to} hex.
function gameGradient(gameId) {
    let h = 0;
    for (let i = 0; i < gameId.length; i++) h = (h * 31 + gameId.charCodeAt(i)) | 0;
    const hue1 = ((h >>> 0) % 360);                           // 0..359
    const hue2 = (hue1 + 28 + ((h >>> 8) % 24)) % 360;
    const toHex = (hue, sat, lit) => {
        const c = (1 - Math.abs(2 * lit - 1)) * sat;
        const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
        const m = lit - c / 2;
        let r, g, b;
        if      (hue <  60) [r,g,b] = [c, x, 0];
        else if (hue < 120) [r,g,b] = [x, c, 0];
        else if (hue < 180) [r,g,b] = [0, c, x];
        else if (hue < 240) [r,g,b] = [0, x, c];
        else if (hue < 300) [r,g,b] = [x, 0, c];
        else                [r,g,b] = [c, 0, x];
        const to = v => Math.round((v + m) * 255).toString(16).padStart(2, '0');
        return '#' + to(r) + to(g) + to(b);
    };
    return { from: toHex(hue1, 0.32, 0.18), to: toHex(hue2, 0.42, 0.36) };
}

// Steam CDN serves cover art for any app id under predictable URLs with no
// auth. Returns null when the game isn't on Steam — caller falls back to the
// hash-derived gradient. The image layer is just on top of the gradient in
// CSS multi-background, so a 404 cleanly reveals the gradient underneath.
function gameArtUrl(game, kind) {
    if (!game?.steam_app_id) return null;
    const base = `https://cdn.akamai.steamstatic.com/steam/apps/${game.steam_app_id}`;
    switch (kind) {
        case 'poster':  return `${base}/library_600x900.jpg`;   // 2:3 portrait
        case 'hero':    return `${base}/library_hero.jpg`;      // wide landscape
        case 'header':  return `${base}/header.jpg`;            // 460x215
    }
    return null;
}

// First-letter-of-each-word, up to 3 chars. Used as the no-art thumb fallback
// so unreleased games still show a labelled placeholder, not a blank gradient.
function gameInitial(title) {
    return String(title || '')
        .split(/[\s:!?'",.]+/)
        .map(w => w[0] || '')
        .filter(c => /[A-Za-z0-9]/.test(c))
        .slice(0, 3)
        .join('')
        .toUpperCase();
}

// Fix types that produce stereo by riding the game's own native stereo
// pipeline (AMD HD3D, OpenGL quad-buffer stereo, Nvidia 3D Vision Direct
// Mode) — the game itself renders both eyes; wiz3D (or a similar shim)
// just unlocks the path. Built-in stereo modes like Elite Dangerous'
// OpenVR output and Mankind Divided's in-engine SBS also count.
const NATIVE_STEREO_TYPES = new Set([
    'wiz3d_hd3d',
    'wiz3d_opengl',
    'wiz3d_3dvision_dm',
    'native_stereo',
    'native_legacy',
]);

function isNativeStereo(fix) {
    if (!fix) return false;
    if (NATIVE_STEREO_TYPES.has(fix.type)) return true;
    return /^native stereo output$/i.test(String(fix.rendering_method || ''));
}

// Five canonical rendering methods. "Native Stereo Output" was unified
// into "Dual-View Rendering" — the render-path classification is the same.
// Games with native built-in stereo are surfaced via the Features → "Native
// stereo" filter, not as a separate rendering method.
// loop_headtrack fixes don't render stereo so they return '—'.
const RENDERING_METHODS = ['Multi-View Rendering', 'Dual-View Rendering', 'Sequential-View Rendering', 'Depth Map Reprojection', 'AI Reprojection'];

// Mapping for the `stereoscopy` field that the 3D/VR Compatibility Database
// uses. The Airtable source labels its two camps "Geo 3D" (geometry-based,
// renders true left/right eyes) and "Depth3D" (single-view + depth-buffer
// reprojection). Translate those to our canonical labels so the renderer
// shows consistent terminology across all data sources.
function normaliseStereoscopy(stereoscopy) {
    const s = String(stereoscopy || '').trim().toLowerCase().replace(/\s+/g, '');
    if (s === 'geo3d')   return 'Dual-View Rendering';
    if (s === 'depth3d') return 'Depth Map Reprojection';
    if (s === 'none')    return 'None';
    return stereoscopy || '';
}

function normaliseRenderingMethod(fix) {
    if (!fix) return '—';
    if (fix.type === 'loop_headtrack') return '—';
    // Native-stereo fix types use the same Dual-View render path; the
    // distinction is preserved as a Feature flag (filter chip), not as a
    // separate rendering method.
    if (isNativeStereo(fix)) return 'Dual-View Rendering';
    // 1) If the fix already declares one of the canonical names, accept it.
    const raw = String(fix.rendering_method || '');
    for (const m of RENDERING_METHODS) {
        if (raw.toLowerCase().includes(m.toLowerCase())) return m;
    }
    // 2) Look at keywords / fix type to pick the best match.
    const t = fix.type || '';
    if (/reproject|depth|2d to 3d|2d3d/i.test(raw)) {
        if (/ai|neural|ml/i.test(raw)) return 'AI Reprojection';
        return 'Depth Map Reprojection';
    }
    if (/multi.?view|quilt|holograph|looking.?glass/i.test(raw)) return 'Multi-View Rendering';
    if (/sequential|shutter|frame.?sequential|page.?flip/i.test(raw)) return 'Sequential-View Rendering';
    if (/dual.?view|side.?by.?side|stereo|geometry|injection|camera|view.?matrix|wrapper/i.test(raw)) return 'Dual-View Rendering';
    // 3) Default by mod family. wiz3d_wrapper still uses dual-view rendering;
    //    the native variants are caught by step 0 above.
    if (/^geo|^helix|^3dmigoto|^wiz3d|^tridef|^iz3d|^vorpx/i.test(t)) return 'Dual-View Rendering';
    if (/^reshade|^superdepth|^rendepth/i.test(t)) return 'Depth Map Reprojection';
    if (/^ue3d|^uevr|^vrto3d|^vireio/i.test(t)) return 'Dual-View Rendering';
    if (/^lkg|looking_glass/i.test(t)) return 'Multi-View Rendering';
    return 'Dual-View Rendering';
}

function compatClassFor(game) {
    const isInstalled = installedGameIds.has(game.id);
    if (isInstalled) return 'compat-native';
    const f = game.fixes?.[0];
    if (!f) return 'compat-untested';
    if (f.recommended || (Array.isArray(f.native_outputs) && f.native_outputs.length)) return 'compat-fix';
    return 'compat-untested';
}

// Maps filterMode/sortMode → label shown alongside "Library" when active.
function activeFilterLabel() {
    if (sortMode === 'recent' && filterMode === 'all') return 'Recent';
    const labels = {
        installed:                  'Installed',
        sr_weave:                   'Simulated Reality',
        vr_native:                  'Virtual Reality',
        sbs:                        'Full Side-by-Side',
        sbs_half:                   'Half Side-by-Side',
        tab:                        'Full Top-and-Bottom',
        tab_half:                   'Half Top-and-Bottom',
        frame_sequential:           'Active shutter',
        interlaced:                 'Interlaced',
        anaglyph:                   'Anaglyph',
        native_stereo:              'Native stereo',
        headtracking:               'Head tracking',
        render_dual_view:           'Dual-View',
        render_depth_reproj:        'Depth Reproject',
        render_multi_view:          'Multi-View',
        render_sequential:          'Sequential',
        render_ai_reproj:           'AI Reproject',
    };
    return (filterMode !== 'all' && labels[filterMode]) ? labels[filterMode] : '';
}

// ── Sidebar — virtualized (windowed) rendering ────────────────
// With 7,000+ games in the catalogue, rendering every nav-item to the DOM
// makes scrolling janky and first-paint slow. Instead: a tall spacer
// gives the scrollbar the right total height, and only the rows that
// actually fall within the viewport (+ a small buffer above/below) get
// DOM elements. Same UI as before — feels like one continuous list —
// without the per-item DOM cost. Approach mirrors what Steam, Discord,
// Spotify, VS Code's file tree, and GOG Galaxy all do.

const SIDEBAR_ITEM_HEIGHT = 36;     // px — set in CSS to match (see .nav-item-v rule)
const SIDEBAR_BUFFER_ROWS = 6;      // extra rows above/below viewport

function _sidebarItemHTML(game, topPx) {
    const isInstalled = installedGameIds.has(game.id);
    const isAvailable = window._scannedPaths?.[game.id] || (selectedGame && selectedGame.id === game.id && getInstallPath());
    const classes = ['nav-item', 'nav-item-v',
        isInstalled ? 'installed' : (isAvailable ? 'available' : ''),
        (selectedGame && game.id === selectedGame.id) ? 'active' : '',
    ].filter(Boolean).join(' ');
    const grad      = gameGradient(game.id);
    const posterUrl = gameArtUrl(game, 'poster');
    const headerUrl = gameArtUrl(game, 'header');
    const initial   = gameInitial(game.title);
    const artLayers = [posterUrl, headerUrl].filter(Boolean).map(u => `url('${u}') center/cover`).join(',');
    const artDiv    = artLayers ? `<div class="game-thumb-art" style="background:${artLayers};"></div>` : '';
    const safeTitle = String(game.title).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    // Right-click on the row opens a context menu (Hide / Browse local files).
    // No always-visible buttons on the row itself — keeps the list clean.
    return `<div class="${classes}" data-game-id="${game.id}" style="top:${topPx}px;">
        <div class="game-thumb" data-initial="${initial}" style="background:linear-gradient(135deg,${grad.from},${grad.to});">${artDiv}</div>
        <span class="game-title">${safeTitle}</span>
        <span class="game-compat-dot ${compatClassFor(game)}"></span>
    </div>`;
}

function _renderSidebarWindow() {
    const list = safeGetEl('sidebar-list');
    if (!list) return;
    const filtered = list._filtered || [];
    const spacer   = list._spacer;
    if (!spacer) return;
    const scrollTop = list.scrollTop;
    const viewportH = list.clientHeight || 600;
    const startIdx  = Math.max(0, Math.floor(scrollTop / SIDEBAR_ITEM_HEIGHT) - SIDEBAR_BUFFER_ROWS);
    const endIdx    = Math.min(filtered.length, Math.ceil((scrollTop + viewportH) / SIDEBAR_ITEM_HEIGHT) + SIDEBAR_BUFFER_ROWS);
    let html = '';
    for (let i = startIdx; i < endIdx; i++) {
        html += _sidebarItemHTML(filtered[i], i * SIDEBAR_ITEM_HEIGHT);
    }
    spacer.innerHTML = html;
}

function renderSidebar(games) {
    const filtered = filterAndSortGames(games);
    const list = safeGetEl('sidebar-list');
    const countEl = safeGetEl('libraryCount');
    if (countEl) {
        const filt = activeFilterLabel();
        countEl.innerHTML = filt
            ? `<span class="library-filter">(${filt})</span><span class="library-count">${filtered.length}</span>`
            : `<span class="library-count">${filtered.length || ''}</span>`;
    }
    if (!list) {
        console.error('sidebar-list element is missing');
        return;
    }

    list._filtered = filtered;

    if (filtered.length === 0) {
        list.innerHTML = '<div style="padding:14px;color:var(--text-dim);font-size:12px;">No games found (check your data/game JSON files or your filters).</div>';
        list._spacer = null;
        return;
    }

    // One-time scaffold install: spacer + delegated click + scroll listener.
    let spacer = list._spacer;
    if (!spacer || !list.contains(spacer)) {
        list.innerHTML = '<div class="vlist-spacer" style="position:relative;width:100%;"></div>';
        spacer = list.firstElementChild;
        list._spacer = spacer;
        list.addEventListener('scroll', _renderSidebarWindow, { passive: true });
        list.addEventListener('click', (e) => {
            const item = e.target.closest('.nav-item');
            if (!item) return;
            const id = item.dataset.gameId;
            const g  = (list._filtered || []).find(x => x.id === id);
            if (g) {
                selectGame(g);
                try { localStorage.setItem(`recent_${g.id}`, Date.now().toString()); } catch {}
            }
        });
        list.addEventListener('contextmenu', (e) => {
            const item = e.target.closest('.nav-item');
            if (!item) return;
            e.preventDefault();
            const id = item.dataset.gameId;
            const g  = (list._filtered || []).find(x => x.id === id);
            if (g) showGameContextMenu(e.clientX, e.clientY, g);
        });
        window.addEventListener('resize', () => _renderSidebarWindow(), { passive: true });
    }

    spacer.style.height = (filtered.length * SIDEBAR_ITEM_HEIGHT) + 'px';
    list.scrollTop = 0;             // reset to top on every filter/sort change
    _renderSidebarWindow();
    _renderAzStrip(filtered);

    if (!selectedGame && filtered.length > 0 && !searchTerm && filterMode === 'all') selectGame(filtered[0]);
}

// A-Z jump strip — renders the alphabet down the right edge of the
// sidebar. Click a letter to scroll the virtualized list to the first
// game starting with it. Letters with no matching games render dim.
function _firstLetterIndex(games) {
    const map = new Map();
    games.forEach((g, i) => {
        const c = String(g.title || '?').toUpperCase().replace(/^(THE\s+|A\s+|AN\s+)/, '');
        const ch = c[0] || '#';
        const key = /[A-Z]/.test(ch) ? ch : '#';
        if (!map.has(key)) map.set(key, i);
    });
    return map;
}

function _renderAzStrip(filtered) {
    const strip = document.getElementById('azStrip');
    if (!strip) return;
    if (!filtered || filtered.length < 30) { strip.style.display = 'none'; return; }
    strip.style.display = 'flex';
    const idxMap = _firstLetterIndex(filtered);
    const letters = ['#', ...Array.from({length: 26}, (_, i) => String.fromCharCode(65 + i))];
    strip.innerHTML = letters.map(L => {
        const present = idxMap.has(L);
        return `<span class="${present ? '' : 'disabled'}" data-letter="${L}">${L}</span>`;
    }).join('');
    // Delegated click handler — installed once.
    if (!strip._wired) {
        strip._wired = true;
        strip.addEventListener('click', (e) => {
            const el = e.target.closest('span[data-letter]');
            if (!el || el.classList.contains('disabled')) return;
            const list = document.getElementById('sidebar-list');
            if (!list) return;
            const idx = _firstLetterIndex(list._filtered || []).get(el.dataset.letter);
            if (idx === undefined) return;
            list.scrollTop = idx * SIDEBAR_ITEM_HEIGHT;
        });
    }
}

const searchBox = safeGetEl('searchBox');
const searchAffix = safeGetEl('scanAllBtn');
function updateSearchAffix() {
    if (!searchAffix) return;
    if (searchBox && searchBox.value.trim()) {
        searchAffix.dataset.mode = 'clear';
        searchAffix.textContent = '✕';
        searchAffix.title = 'Clear search';
    } else {
        searchAffix.dataset.mode = 'refresh';
        searchAffix.textContent = '↻';
        searchAffix.title = 'Re-scan Steam / GOG / Epic for game folders';
    }
}
if (searchAffix) {
    // Replace the inline onclick=runScanAll() with delegated behaviour so the
    // button can also clear the search when in 'clear' mode.
    searchAffix.removeAttribute('onclick');
    searchAffix.addEventListener('click', () => {
        if (searchAffix.dataset.mode === 'clear' && searchBox) {
            searchBox.value = '';
            searchTerm = '';
            updateSearchAffix();
            renderSidebar(gamesData);
            searchBox.focus();
        } else {
            window.runScanAll?.();
        }
    });
}
if (searchBox) {
    searchBox.addEventListener('input', e => { searchTerm = e.target.value; updateSearchAffix(); renderSidebar(gamesData); });
    updateSearchAffix();
}
const filterSelect = safeGetEl('filterSelect');
if (filterSelect) filterSelect.addEventListener('change', e => { filterMode = e.target.value; renderSidebar(gamesData); });
const sortSelect = safeGetEl('sortSelect');
if (sortSelect) sortSelect.addEventListener('change', e => { sortMode = e.target.value; renderSidebar(gamesData); });

// ─── Filter pane (Phase 2) ───────────────────────────────────
// Currently a thin shim over the existing filterMode/sortMode globals — the
// filter-pane buttons just set the hidden #filterSelect and #sortSelect values,
// then trigger renderSidebar. Lets us add real multi-faceted filtering later
// (e.g. cross-cut by output + feature) without reshaping the data model now.
const FILTER_GROUPS = [
    { title: 'Library', items: [
        { id: 'all',         label: 'All games',         icon: '▦' },
        { id: 'installed',   label: 'Installed',         icon: '●' },
        { id: 'recent',      label: 'Recently played',   icon: '↻', sort: 'recent' },
    ]},
    { title: 'Output', items: [
        { id: 'sr_weave',         label: 'Simulated Reality',   icon: '◈' },
        { id: 'vr_native',        label: 'Virtual Reality',     icon: '⊡' },
        { id: 'sbs',              label: 'Full Side-by-Side',   icon: '▥' },
        { id: 'sbs_half',         label: 'Half Side-by-Side',   icon: '▥' },
        { id: 'tab',              label: 'Full Top-and-Bottom', icon: '▤' },
        { id: 'tab_half',         label: 'Half Top-and-Bottom', icon: '▤' },
        { id: 'frame_sequential', label: 'Active shutter',      icon: '▣' },
        { id: 'interlaced',       label: 'Interlaced',          icon: '☰' },
        { id: 'anaglyph',         label: 'Anaglyph',            icon: '◍' },
    ]},
    { title: 'Features', items: [
        { id: 'native_stereo', label: 'Native stereo',     icon: '◆' },
        { id: 'headtracking',  label: 'Head tracking',     icon: '◐' },
    ]},
    { title: 'Rendering', items: [
        { id: 'render_dual_view',       label: 'Dual-View Rendering',      icon: '⊟' },
        { id: 'render_depth_reproj',    label: 'Depth Map Reprojection',   icon: '◭' },
        { id: 'render_multi_view',      label: 'Multi-View Rendering',     icon: '◫' },
        { id: 'render_sequential',      label: 'Sequential-View',          icon: '▣' },
        { id: 'render_ai_reproj',       label: 'AI Reprojection',          icon: '✦' },
    ]},
    { title: 'Mods', items: [
        { id: 'mod_uevr',         label: 'UEVR',                       icon: '⊕' },
        { id: 'mod_geo11',        label: 'Geo-11',                     icon: '◆' },
        { id: 'mod_3dmigoto',     label: '3DMigoto',                   icon: '◇' },
        { id: 'mod_wiz3d',        label: 'wiz3D',                      icon: '✦' },
        { id: 'mod_hd3d',         label: 'AMD HD3D Native',            icon: '▦' },
        { id: 'mod_ogl_qbs',      label: 'OpenGL Quad-Buffer',         icon: '▣' },
        { id: 'mod_3dv_dm',       label: '3D Vision Direct Mode',      icon: '◈' },
        { id: 'mod_3d_vision',    label: '3D Vision Automatic Mode',   icon: '◐' },
        { id: 'mod_helixmod',     label: 'HelixMod',                   icon: '⊞' },
        { id: 'mod_helixvision',  label: 'HelixVision',                icon: '⊠' },
        { id: 'mod_vorpx',        label: 'vorpX',                      icon: '⊡' },
        { id: 'mod_tridef',       label: 'TriDef 3D',                  icon: '△' },
        { id: 'mod_superdepth3d', label: 'SuperDepth3D',               icon: '◭' },
        { id: 'mod_3dgame_bridge',label: '3DGame Bridge',              icon: '⊟' },
        { id: 'mod_vireio',       label: 'Vireio Perception',          icon: '◉' },
    ]},
];

const RENDER_FILTER_TO_METHOD = {
    render_dual_view:     'Dual-View Rendering',
    render_depth_reproj:  'Depth Map Reprojection',
    render_multi_view:    'Multi-View Rendering',
    render_sequential:    'Sequential-View Rendering',
    render_ai_reproj:     'AI Reprojection',
};

// Maps mod-filter IDs to the underlying fix.type strings stored in each
// game's sidebar projection. A filter chip matches a game iff the chip's
// type is present in `game.fix_types`. wiz3D variants (HD3D / Quad-Buffer /
// 3DV-DM) share the wiz3D family but map to distinct fix types — listed
// separately so users can drill in.
const MOD_FILTER_TO_TYPE = {
    mod_uevr:          'uevr',
    mod_geo11:         'geo11',
    mod_3dmigoto:      '3dmigoto',
    mod_wiz3d:         'wiz3d_wrapper',
    mod_hd3d:          'wiz3d_hd3d',
    mod_ogl_qbs:       'wiz3d_opengl',
    mod_3dv_dm:        'wiz3d_3dvision_dm',
    mod_3d_vision:     '3d-vision',
    mod_helixmod:      'helixmod',
    mod_helixvision:   'helixvision',
    mod_vorpx:         'vorpx',
    mod_tridef:        'tridef',
    mod_superdepth3d:  'superdepth3d',
    mod_3dgame_bridge: '3dgamebridge',
    mod_vireio:        'vireio',
};

// Excluded-filters persistence. The "−" button on each filter chip is a
// TOGGLE: pressing it once flips the filter into "exclude mode" — games
// matching that filter are hidden from the library. Press it again to
// turn exclusion off. The chip itself stays visible regardless. Excluded
// filters compose with OR (a game is hidden if it matches ANY excluded
// filter), and they're mutually exclusive with the chip's positive-filter
// state (clicking the chip body always sets the active filter and clears
// any exclusion of that same chip).
const EXCLUDED_FILTERS_KEY  = 'stereopticon.excludedFilters';
const ALWAYS_VISIBLE_FILTERS = new Set(['all']);

function loadExcludedFilters() {
    try { return new Set(JSON.parse(localStorage.getItem(EXCLUDED_FILTERS_KEY) || '[]')); }
    catch { return new Set(); }
}
function saveExcludedFilters(set) {
    try { localStorage.setItem(EXCLUDED_FILTERS_KEY, JSON.stringify([...set])); } catch {}
}
window.toggleFilterExclude = function(id) {
    if (!id || ALWAYS_VISIBLE_FILTERS.has(id)) return;
    const ex = loadExcludedFilters();
    if (ex.has(id)) ex.delete(id);
    else            ex.add(id);
    saveExcludedFilters(ex);
    // Can't be both active AND excluded; if you just excluded the active
    // filter, fall back to 'all'.
    if (ex.has(id) && filterMode === id) { filterMode = 'all'; }
    renderFilterPane();
    renderSidebar(gamesData);
};

// Collapsible filter groups — each group header is clickable; collapse
// state persists per group title.
const COLLAPSED_GROUPS_KEY = 'stereopticon.collapsedFilterGroups';
function loadCollapsedGroups() {
    try { return new Set(JSON.parse(localStorage.getItem(COLLAPSED_GROUPS_KEY) || '[]')); }
    catch { return new Set(); }
}
function saveCollapsedGroups(set) {
    try { localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify([...set])); } catch {}
}
window.toggleFilterGroup = function(title) {
    if (!title) return;
    const c = loadCollapsedGroups();
    if (c.has(title)) c.delete(title);
    else              c.add(title);
    saveCollapsedGroups(c);
    renderFilterPane();
};

// Build a predicate fn for a given filter ID. Returns null if the ID
// doesn't correspond to a filter that excludes/includes by attribute
// (e.g., 'all' or 'installed' which are handled inline).
function buildFilterPredicate(id) {
    if (id === 'headtracking')  return g => !!g.has_headtracking;
    if (id === 'native_stereo') return g => !!g.has_native_stereo;
    if (RENDER_FILTER_TO_METHOD[id]) {
        const target = RENDER_FILTER_TO_METHOD[id];
        return g => (g.rendering_methods || []).includes(target);
    }
    if (MOD_FILTER_TO_TYPE[id]) {
        const target = MOD_FILTER_TO_TYPE[id];
        return g => (g.fix_types || []).includes(target);
    }
    // Otherwise assume it's an output ID (sbs, tab, vr_native, etc.).
    return g => (g.native_outputs || []).includes(id);
}

function renderFilterPane() {
    const root = document.getElementById('filterGroups');
    if (!root) return;
    const excluded  = loadExcludedFilters();
    const collapsed = loadCollapsedGroups();
    let html = '';
    for (const group of FILTER_GROUPS) {
        const isCollapsed = collapsed.has(group.title);
        // Group header is a clickable row that toggles collapse state.
        html += `<div class="filter-group"><div class="filter-group-label is-collapsible" data-group="${group.title}">
            <span class="group-chevron">${isCollapsed ? '▸' : '▾'}</span>${group.title}
        </div>`;
        if (!isCollapsed) {
            for (const item of group.items) {
                const isActive    = item.sort
                    ? (sortMode === item.sort && filterMode === 'all')
                    : (filterMode === item.id);
                const isExcluded  = excluded.has(item.id);
                const hideBtn     = ALWAYS_VISIBLE_FILTERS.has(item.id)
                    ? ''
                    : `<button class="filter-hide-btn${isExcluded ? ' active' : ''}" data-hide-filter="${item.id}" title="${isExcluded ? 'Showing — click to hide games matching this' : 'Hide games matching this filter'}" aria-label="${isExcluded ? 'Un' : ''}Hide games matching ${item.label}">${isExcluded ? '✕' : '−'}</button>`;
                html += `<button class="filter-row${isActive ? ' active' : ''}${isExcluded ? ' excluded' : ''}" data-filter="${item.id}" data-sort="${item.sort || ''}">
                    <span class="filter-row-icon">${item.icon}</span>
                    <span class="filter-row-label">${item.label}</span>
                    ${hideBtn}
                </button>`;
            }
        }
        html += `</div>`;
    }
    root.innerHTML = html;
    if (!root._wired) {
        root._wired = true;
        root.addEventListener('click', (e) => {
            // Hide-button intercept first.
            const hide = e.target.closest('.filter-hide-btn');
            if (hide) {
                e.stopPropagation();
                e.preventDefault();
                window.toggleFilterExclude(hide.dataset.hideFilter);
                return;
            }
            // Group collapse intercept.
            const groupHead = e.target.closest('.filter-group-label.is-collapsible');
            if (groupHead) {
                window.toggleFilterGroup(groupHead.dataset.group);
                return;
            }
            // Filter chip activation.
            const row = e.target.closest('.filter-row');
            if (!row || !row.dataset.filter) return;
            window.setLibraryFilter(row.dataset.filter, row.dataset.sort || '');
        });
    }
    const sub = document.getElementById('filterPaneSub');
    if (sub) {
        const count = (filterMode !== 'all' ? 1 : 0) + (sortMode !== 'alpha' ? 1 : 0);
        sub.textContent = count ? `${count} active` : 'Refine your library';
    }
}

window.setLibraryFilter = function(filterId, sortId) {
    if (sortId) {
        // Sort-based filter (e.g. 'recent'): leave filterMode='all', set sortMode.
        sortMode = sortId;
        filterMode = 'all';
    } else {
        // Toggle: clicking the active filter resets to 'all'.
        filterMode = (filterMode === filterId) ? 'all' : filterId;
        if (filterMode === 'all') sortMode = 'alpha';
    }
    // Mirror state into the hidden selects so any old code paths stay in sync.
    if (filterSelect) filterSelect.value = filterMode;
    if (sortSelect)   sortSelect.value   = sortMode;
    renderFilterPane();
    renderSidebar(gamesData);
};

window.toggleFilterPane = function() {
    const pane = document.getElementById('filterPane');
    const expand = document.getElementById('filterExpandBtn');
    if (!pane) return;
    const willCollapse = !pane.classList.contains('collapsed');
    pane.classList.toggle('collapsed', willCollapse);
    if (expand) expand.style.display = willCollapse ? '' : 'none';
    try { localStorage.setItem('stereopticon.filterPane', willCollapse ? 'collapsed' : 'open'); } catch {}
};

(function applyStoredFilterPane(){
    try {
        if (localStorage.getItem('stereopticon.filterPane') === 'collapsed') {
            const pane = document.getElementById('filterPane');
            const expand = document.getElementById('filterExpandBtn');
            if (pane) pane.classList.add('collapsed');
            if (expand) expand.style.display = '';
        }
    } catch {}
})();

document.addEventListener('DOMContentLoaded', renderFilterPane);

// ─── DETAIL VIEW ────────────────────────────────────────────
async function autoScanGamePath(game) {
    if (!game) return;
    const pathInput = document.getElementById('installPath');
    if (!pathInput) return;
    if (pathInput.value.trim()) return; // already set by user
    
    // Check pre-scanned cache first (fastest)
    const cached = window._scannedPaths?.[game.id];
    if (cached) {
        pathInput.value = cached;
        pathInput.style.borderColor = 'var(--teal-border)';
        setTimeout(() => { pathInput.style.borderColor = ''; }, 2000);
        loadReshadeStatus();
        return;
    }
    async function checkShippingExeRedirect() {
    const gamePath = getInstallPath();
    if (!gamePath || !selectedProfile) return;
    if (!['uevr','ue3d'].includes(selectedProfile.type)) return;
 
    const exeName = selectedGame.exe_name
        || selectedGame.default_path?.split(/[/\\]/).filter(s => /\.\w+$/.test(s)).pop()
        || selectedGame.default_path?.split(/[/\\]/).pop();
    if (!exeName) return;
 
    const exePath = gamePath.replace(/[/\\]$/, '') + '\\' + exeName;
    try {
        const result = await window.api.resolveShippingExe(exePath);
        if (result?.redirected) {
            const shippingName = result.exePath.split(/[/\\]/).pop();
            // Show a small note in the tray area
            const tray = document.getElementById('installTray');
            if (tray && tray.style.display === 'none') {
                showTray();
                document.getElementById('installProgressLabel').textContent =
                    `UEVR will inject into ${shippingName} (shipping exe)`;
                setTimeout(hideTray, 4000);
            }
        }
    } catch { /* silent */ }
}
    
    const exeName = game.exe_name || game.fixes?.[0]?.exe_name || null;
    try {
        const result = await window.api.gameScan(game.title, exeName, game.steam_app_id || null);
        if (result?.found && result.path) {
            pathInput.value = result.path;
            pathInput.style.borderColor = 'var(--teal-border)';
            setTimeout(() => { pathInput.style.borderColor = ''; }, 2000);
            loadReshadeStatus();
        }
    } catch { /* scan failed silently */ }
}

// ── Hidden-games persistence ─────────────────────────────────
// Each nav-item has a hover-only "−" button that lets the user dismiss
// games they're not interested in. Hidden IDs persist in localStorage so
// the list stays curated across launches. Unhide via Settings → "Show
// hidden games" (TODO) or by clearing the storage key.
const HIDDEN_GAMES_KEY = 'stereopticon.hiddenGames';
function loadHiddenGames() {
    try { return new Set(JSON.parse(localStorage.getItem(HIDDEN_GAMES_KEY) || '[]')); }
    catch { return new Set(); }
}
function saveHiddenGames(set) {
    try { localStorage.setItem(HIDDEN_GAMES_KEY, JSON.stringify([...set])); } catch {}
}
// Right-click context menu on a sidebar row. Currently exposes:
//   * Hide from list
//   * Browse local files (opens the game's install folder in Explorer)
// Anchored at the click position; dismisses on next click or Escape.
let _gameCtxMenuEl = null;
function showGameContextMenu(x, y, game) {
    // Tear down any prior menu.
    if (_gameCtxMenuEl) { _gameCtxMenuEl.remove(); _gameCtxMenuEl = null; }

    // Resolve a local install path if we have one — prefer scanned path,
    // then any saved Stereopticon path, then the game's default_path.
    const saved   = loadSavedGamePaths()[game.id];
    const scanned = window._scannedPaths?.[game.id];
    const localPath = saved || scanned || game.default_path || '';

    const menu = document.createElement('div');
    _gameCtxMenuEl = menu;
    menu.className = 'game-ctx-menu';
    menu.innerHTML = `
        <button class="ctx-item" data-action="browse" ${localPath ? '' : 'disabled'}>
            <span class="ctx-icon">📁</span>Browse local files
            ${localPath ? '' : '<span class="ctx-hint">no path</span>'}
        </button>
        <div class="ctx-sep"></div>
        <button class="ctx-item ctx-danger" data-action="hide">
            <span class="ctx-icon">−</span>Hide from list
        </button>`;
    document.body.appendChild(menu);

    // Position with viewport clamping so the menu doesn't spill off-screen.
    const pad = 6;
    const w = menu.offsetWidth || 200;
    const h = menu.offsetHeight || 80;
    menu.style.left = Math.min(x, window.innerWidth  - w - pad) + 'px';
    menu.style.top  = Math.min(y, window.innerHeight - h - pad) + 'px';

    menu.addEventListener('click', async (e) => {
        const btn = e.target.closest('.ctx-item');
        if (!btn || btn.disabled) return;
        const action = btn.dataset.action;
        _gameCtxMenuEl?.remove();
        _gameCtxMenuEl = null;
        if (action === 'hide')   window.hideGame(game.id);
        if (action === 'browse') {
            try { await window.api.openLocalPath(localPath); }
            catch (err) { console.error('[ctx] openLocalPath failed', err); }
        }
    });
}
// Dismiss on outside click / Escape.
document.addEventListener('click', () => {
    if (_gameCtxMenuEl) { _gameCtxMenuEl.remove(); _gameCtxMenuEl = null; }
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && _gameCtxMenuEl) { _gameCtxMenuEl.remove(); _gameCtxMenuEl = null; }
});

window.hideGame = function(id) {
    if (!id) return;
    const h = loadHiddenGames();
    h.add(id);
    saveHiddenGames(h);
    // If the hidden game is the currently selected one, clear the detail view.
    if (selectedGame && selectedGame.id === id) {
        selectedGame = null;
        selectedProfile = null;
        const el = document.getElementById('detail-content');
        if (el) el.innerHTML = '';
        const cb = document.getElementById('config-bar');
        if (cb) cb.style.display = 'none';
    }
    renderSidebar(gamesData);
};

function selectGame(game) {
    // Save previous game's path before switching
    if (selectedGame && selectedGame.id !== game.id) {
        const prev = getInstallPath();
        if (prev) {
            saveGamePathToStorage(selectedGame.id, prev);
        }
    }
    // The sidebar passes a LIGHT projection; fetch the full game record
    // (fixes / compat / paths / etc.) before rendering the detail view.
    // Cache it on `game._full` so re-selecting doesn't re-hit IPC.
    if (game && !game._full) {
        window.api.loadGameOne(game.id).then(full => {
            if (full) {
                // Merge full data onto the light row in-place so any sidebar
                // references keep working.
                Object.assign(game, full);
                game._full = true;
                _continueSelectGame(game);
            } else {
                _continueSelectGame(game);
            }
        }).catch(() => _continueSelectGame(game));
        return;
    }
    _continueSelectGame(game);
}

function _continueSelectGame(game) {
    selectedGame    = game;
    // Many of the imported compat-database entries (7,000+ stubs from the
    // Airtable export) have no `fixes` yet — only community-rating data.
    // Default `selectedProfile` to null in that case; renderDetailView()
    // renders an empty-fix state below.
    selectedProfile = Array.isArray(game.fixes) && game.fixes.length
        ? (game.fixes.find(f => f.recommended) || game.fixes[0])
        : null;
    configBar.style.display = 'block';
    hideTray(); resetTray();
    reshadeStatus = null;

    // Hide per-game bars immediately so they don't briefly show the previous
    // game's state while the new game's renderers run. Each renderer below
    // re-shows its bar if appropriate for the new game.
    ['htAxesBar', 'outputOverrideBar', 'tuningPanel'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    renderDetailView();   // builds the installPath input among other things

    // Restore path: user-set > scanned > default. Must run AFTER renderDetailView
    // since the installPath input now lives inside the detail-view innerHTML.
    const savedPaths  = loadSavedGamePaths();
    const savedPath   = savedPaths[game.id];
    const scannedPath = window._scannedPaths?.[game.id];
    const defaultPath = game.default_path.replace(/[/\\][^/\\]+\.\w+$/i, '');
    setInstallPath(savedPath || scannedPath || defaultPath);

    updateBottomBar();
    loadReshadeStatus();
    // Refresh the per-game override bar — must run after updateSubOptions has
    // populated primaryOutput options so the override clone has options to mirror.
    setTimeout(() => { try { window.renderOutputOverrideBar?.(); } catch {} }, 60);
    // Load the inline tuning panel (Phase 2d) — only fires for Geo-11 fixes
    // and a path. The panel hides itself for everything else.
    setTimeout(() => { try { loadTuningPanel(); } catch (e) { console.error(e); } }, 120);
    // Auto-populate the inline Mod Settings card (formerly the geoModal).
    // Same data-load + render flow that the old "Mod Settings" button used
    // to trigger — now happens automatically when a game is selected.
    setTimeout(() => {
        try {
            if (selectedProfile && getInstallPath() && typeof openModSettings === 'function') {
                openModSettings();
            }
        } catch (e) { console.error('[mod-settings inline]', e); }
    }, 150);
    // Render the per-game HT axes pill bar (Phase 2e). Hides itself when no
    // HT method is active for this game.
    setTimeout(() => { try { window.renderHtAxesPills?.(); } catch {} }, 130);
    // Auto-detect if no path saved or scanned yet
    if (!savedPath && !scannedPath) autoScanGamePath(game);
    // Show pending UEVR guide if this fix was just installed and hasn't launched yet
    setTimeout(() => checkPendingUEVRGuide(game), 100);
}

// Shows the UEVR guide in the result tray if pendingGuide is set in installState.
// Clears the flag after the user clicks Launch (handled in handleLaunchClick).
async function checkPendingUEVRGuide(game) {
    const installed = await window.api.loadInstallState?.() || {};
    for (const fix of (game.fixes || [])) {
        const record = installed[fix.id];
        if (record?.pendingGuide && ['uevr','ue3d'].includes(fix.type)) {
            showTray();
            showUEVRGuide(fix);
            return;
        }
    }
}

function formatModType(t, profile) {
    const map = {
        'geo11':              'Geo-11',
        'geo12':              'Geo-12',
        'geo3d':              'Geo-3D',
        'uevr':               'UEVR',
        'uuvr':               'UUVR',
        'shaderglass':        'ShaderGlass',
        'reshade_only':       'ReShade Shader',
        '3dmigoto':           '3DMigoto',
        'helixmod':           'HelixMod',
        'vorpx':              'vorpX',
        'tridef':             'TriDef',
        'iz3d':               'iZ3D',
        'vks3d':              'VKS3D',
        'vrscreencap':        'VR Screencap',
        'xr3dv':              'XR3DV',
        'native':             'Native',
        'native_legacy':      'Native (Legacy)',
        'nvidia_3d_vision':   'NVIDIA 3D Vision',
        'amd_hd3d':           'AMD HD3D',
        'windows_dxgi_stereo':'Windows DXGI Stereo',
    };
    const base = map[t] || (t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Unknown');
    const variant = profile?.geo11_variant || profile?.variant;
    return variant ? `${base} · ${variant}` : base;
}

function formatHeadtracking(val) {
    if (!val || val === 'none' || val === 'No' || val === false) return 'No';
    if (val === true || val === 'yes') return 'Yes';
    if (Array.isArray(val)) {
        if (val.length === 0) return 'No';
        const methods = val.map(v => getHeadtrackingMethodLabel(v)).join(' / ');
        return `Yes — ${methods}`;
    }
    const label = getHeadtrackingMethodLabel(String(val).toLowerCase());
    return label ? `Yes — ${label}` : val;
}

function getHeadtrackingMethodLabel(method) {
    const labels = {
        '6dof': '6DOF',
        '3dof': '3DOF',
        'opentrack': 'OpenTrack',
        'steamvr': 'SteamVR',
        'openxr': 'OpenXR',
        'leiatrack': 'Leia Track',
        'vertoxr': 'VertoXR',
        'vr': 'VR',
    };
    return labels[method.toLowerCase()] || method;
}

function buildCostBadge(p) {
    if (p.cost !== 'paid') return '';
    const click = p.cost_url ? `onclick="window.api.openUrl('${p.cost_url}')"` : '';
    return `<span class="badge badge-paid" ${click} style="${p.cost_url?'cursor:pointer;':''}">PAID${p.cost_url?' ↗':''}</span>`;
}
function buildStatusBadge(p) {
    if (p.deprecated) return `<span class="badge badge-deprecated">DEPRECATED</span>`;
    const pl = PIPELINES[p.type]; if (!pl) return '';
    return ({defunct:`<span class="badge badge-defunct">DEFUNCT</span>`,experimental:`<span class="badge badge-experimental">EXPERIMENTAL</span>`,legacy:`<span class="badge badge-legacy">LEGACY</span>`,legacy_active:`<span class="badge badge-legacy">LEGACY</span>`})[pl.status] || '';
}
function buildDeprecatedWarning(p) {
    if (!p.deprecated) return '';
    const extra = (p.type==='tridef'||p.type==='iz3d') ? " License servers are offline." : '';
    return `<div class="deprecated-warning"><span style="font-size:16px;flex-shrink:0;">⚠</span>
        <div><strong>Deprecated / Discontinued</strong><br>Documented for historical reference only.${extra}</div></div>`;
}

function renderDetailView() {
    // Defensive guard: any game that somehow ended up with zero fix profiles
    // (shouldn't happen after the CSV importer maps softwares to fix types,
    // but safe to handle). Show a compact message inside the normal layout
    // rather than an entire custom hero.
    if (!selectedProfile) {
        detailArea.innerHTML = `
            <div style="padding:48px 32px;text-align:center;color:var(--text-dim);font-size:13px;">
                <div style="font-family:var(--font-display);font-size:14px;color:var(--text-secondary);margin-bottom:6px;">${selectedGame.title}</div>
                No fix profiles wired up for this game yet. Either add one to <code>data/games/${selectedGame.id}.json</code>
                or re-run <code>node scripts/import-compat-database.js</code> after updating the source CSV.
            </div>`;
        return;
    }

    const fixOptions = selectedGame.fixes.map(fix => {
        const pl  = PIPELINES[fix.type];
        const ver = fix.geo11_version || fix.wiz3d_version || fix.ue3d_version
                 || fix.uevr_version  || fix.vireio_version || '';
        const tags = [fix.recommended?'★':'',fix.cost==='paid'?'[PAID]':'',fix.deprecated?'[DEPRECATED]':'',(pl?.status==='defunct'||pl?.status==='legacy')?'[LEGACY]':''].filter(Boolean).join(' ');
        const label = ver ? `${fix.name} ${ver}` : fix.name;
        return `<option value="${fix.id}" ${fix.id===selectedProfile.id?'selected':''}>${label}${tags?' '+tags:''}</option>`;
    }).join('');
    const authors  = selectedProfile.authors?.join(', ') || 'Community';
    const pipeline = PIPELINES[selectedProfile.type];
    const uevrBtn  = selectedProfile.uevr_profile_url ? `<button class="link-btn" style="border-color:var(--warn);color:var(--warn);" onclick="window.api.openUrl('${selectedProfile.uevr_profile_url}')">Download UEVR Profile ⇩</button>` : '';
    // Author list becomes a single anchor opening the fix page (replaces the
    // old "Visit Fix Page" button). Falls back to a plain span if no URL.
    const fixUrl = selectedProfile.url || '';
    const authorsHtml = fixUrl
        ? `<a href="#" class="fix-credit-link" onclick="window.api.openUrl('${fixUrl}');return false;" title="Open fix page ↗">${authors}</a>`
        : `<span>${authors}</span>`;
    const reqHtml  = (selectedProfile.prerequisites||[]).map(r=>`<span class="req-badge">REQ: ${r}</span>`).join('');
    // Build a single "Mod" descriptor: pipeline-name + version (if available).
    // E.g. "Geo-11 v0.6.56", "wiz3D v0.4.2", "Vireio Perception v4.1".
    const modName = pipeline?.name || (selectedProfile.type||'').toUpperCase();
    const modVersion = selectedProfile.geo11_version
                    || selectedProfile.wiz3d_version
                    || selectedProfile.ue3d_version
                    || selectedProfile.uevr_version
                    || selectedProfile.vireio_version
                    || '';
    const modText = modVersion ? `${modName} ${modVersion}` : modName;
    const modLink = pipeline?.url
        ? `<a href="#" onclick="window.api.openUrl('${pipeline.url}')" class="pipeline-type-link" title="${pipeline.summary||''}">${modText} ↗</a>`
        : `<span>${modText}</span>`;
    const issuesHtml = (selectedProfile.issues||[]).length ? selectedProfile.issues.map(i=>`<div class="issue-item">• ${i}</div>`).join('') : `<span style="color:var(--text-dim);font-size:12px;">No reported issues.</span>`;

    const grad = gameGradient(selectedGame.id);
    const compatCls = compatClassFor(selectedGame);
    const compatLabel = compatCls === 'compat-native' ? 'Installed' : compatCls === 'compat-fix' ? 'Available' : 'Untested';
    const posterUrl = gameArtUrl(selectedGame, 'poster');
    const heroUrl   = gameArtUrl(selectedGame, 'hero');
    const headerUrl = gameArtUrl(selectedGame, 'header');
    const initial   = gameInitial(selectedGame.title);
    const gradFallback = `linear-gradient(135deg,${grad.from},${grad.to})`;
    const layer = (url) => url ? `url('${url}') center/cover, ` : '';
    const coverBg = `${layer(heroUrl)}${layer(headerUrl)}${gradFallback}`;
    // Hero thumb: nested .detail-hero-thumb-art div paints art ABOVE the
    // ::before initial — if art 404s, initial shows on the gradient.
    const thumbArtLayers = [posterUrl, headerUrl].filter(Boolean).map(u => `url('${u}') center/cover`).join(',');
    const thumbArtHtml = thumbArtLayers ? `<div class="detail-hero-thumb-art" style="background:${thumbArtLayers};"></div>` : '';
    detailArea.innerHTML = `
        <div class="detail-hero">
            <div class="detail-hero-cover" style="background:${coverBg};"></div>
            <div class="detail-hero-fade"></div>
            <div class="detail-hero-sides"></div>
            <div class="detail-hero-content">
                <div class="detail-hero-thumb" data-initial="${initial}" style="background:${gradFallback};">${thumbArtHtml}</div>
                <div class="detail-hero-text">
                    <div class="detail-hero-compat"><span class="game-compat-dot ${compatCls}"></span>${compatLabel}</div>
                    <div class="detail-hero-title">${selectedGame.title}</div>
                    <div class="detail-hero-meta">${selectedGame.developer ? `Studio: <span class="hero-meta-value">${selectedGame.developer}</span>` : ''}</div>
                    <div class="detail-hero-credits">Fix Credits: ${authorsHtml}</div>
                </div>
                <div class="detail-hero-actions">
                    <button id="btnInstallFix" class="hero-btn hero-btn-secondary" onclick="handleInstallClick()">⇩ Install Fix</button>
                    <button id="btnLaunchGame" class="hero-btn hero-btn-primary" onclick="handleLaunchClick()">▶ Launch</button>
                    <button id="btnUninstallMain" class="hero-btn hero-btn-ghost" title="Uninstall Fix" onclick="handleUninstallClick()" style="display:none;">🗑</button>
                </div>
            </div>
        </div>
        <div class="header-section">
            <div class="credits-row">
                <h1 style="display:none;">${selectedGame.title}</h1>
                <div style="display:flex;gap:8px;align-items:center;flex-shrink:0;margin-left:auto;">${uevrBtn}</div>
            </div>
            <div style="margin-bottom:10px;display:flex;flex-wrap:wrap;gap:6px;align-items:center;">${reqHtml}${buildCostBadge(selectedProfile)}${buildStatusBadge(selectedProfile)}</div>
            ${buildDeprecatedWarning(selectedProfile)}
            <div class="profile-selector" style="display:grid;grid-template-columns:1fr 1fr 1.4fr;gap:14px;">
                <div>
                    <label>Stereo Fix</label>
                    <select class="csel-target" style="margin-top:0;width:100%;" onchange="switchProfile(this.value)">${fixOptions}</select>
                </div>
                <div>
                    <label>Head Tracking Fix</label>
                    <select id="headtrackingMethod" class="csel-target" style="margin-top:0;width:100%;" onchange="handleHeadtrackingChange()"></select>
                </div>
                <div style="min-width:0;">
                    <label>Game Folder</label>
                    <div style="display:flex;gap:6px;align-items:stretch;width:100%;min-width:0;">
                        <input type="text" id="installPath" placeholder="Browse…" title="Game folder path"
                            style="flex:1 1 0;min-width:0;height:34px;padding:0 10px;background:var(--surface-2);border:1px solid var(--glass-border);color:var(--text-primary);border-radius:6px;font-family:var(--font-body);font-size:12px;outline:none;transition:border-color 0.15s;text-overflow:ellipsis;"
                            onfocus="this.style.borderColor='var(--glass-border-bright)'" onblur="this.style.borderColor='var(--glass-border)'">
                        <button id="browsePathBtn" class="action-btn btn-launch-dim" title="Browse for folder…" style="height:34px;width:34px;padding:0;flex-shrink:0;display:flex;align-items:center;justify-content:center;">
                            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round" style="pointer-events:none;">
                                <path d="M2 4.5 a1 1 0 0 1 1 -1 h3.2 l1.6 1.8 H13 a1 1 0 0 1 1 1 v6 a1 1 0 0 1 -1 1 H3 a1 1 0 0 1 -1 -1 Z"/>
                            </svg>
                        </button>
                    </div>
                </div>
            </div>
        </div>
        <span id="metaHeadtracking" style="display:none;"></span>
        <div class="info-grid">
            <!-- Info card (LEFT): Render Method row first, then "Info" heading and notes. -->
            <div class="card">
                <div class="render-method-row">
                    <span class="render-method-label">Rendering Method</span>
                    <span class="render-method-value">${normaliseRenderingMethod(selectedProfile)}</span>
                </div>
                <h3 style="margin-bottom:10px;">Info</h3>
                ${selectedProfile.pros ? `<p class="pro-text">${selectedProfile.pros}</p>` : ''}
                <p style="color:var(--text-secondary);font-size:13px;line-height:1.6;font-family:var(--font-serif);letter-spacing:0.1px;margin-top:8px;">${selectedProfile.notes||'No additional notes.'}</p>
                ${selectedProfile.activation?`<div style="margin-top:12px;padding:10px 12px;background:var(--surface-2);border:1px solid var(--glass-border);border-left:2px solid var(--teal);border-radius:6px;">
                    <div style="font-family:var(--font-display);font-size:10px;color:var(--text-dim);font-weight:600;text-transform:uppercase;letter-spacing:1.1px;margin-bottom:6px;">Activation</div>
                    <p style="color:var(--text-secondary);font-size:12.5px;line-height:1.55;font-family:var(--font-serif);">${selectedProfile.activation}</p>
                </div>`:''}
            </div>
            <!-- Known Issues card (RIGHT): cons line as first item, then issues. -->
            <div class="card">
                <h3>Known Issues</h3>
                ${selectedProfile.cons ? `<div class="issue-item">${selectedProfile.cons}</div>` : ''}
                ${issuesHtml}
            </div>
        </div>`;
    updateConfigBar();
    customizeAllPendingSelects();   // hero & fix-profile select were just rebuilt
}

window.switchProfile = fixId => { selectedProfile = selectedGame.fixes.find(f=>f.id===fixId); renderDetailView(); updateBottomBar(); loadReshadeStatus(); updateHeadtrackingUI(); };
window.openUrl = url => { if (url) window.api.openExternal(url); };

// ═══ HEADTRACKING SYSTEM ═════════════════════════════════════════
function supportsHeadtracking(profile) {
    if (!profile || !profile.headtracking) return false;
    if (profile.headtracking === 'none' || profile.headtracking === false) return false;
    if (Array.isArray(profile.headtracking) && profile.headtracking.length === 0) return false;
    return true;
}

function getAvailableHeadtrackingMethods(profile) {
    if (!supportsHeadtracking(profile)) return [];
    const ht = profile.headtracking;
    if (Array.isArray(ht)) return ht;
    if (typeof ht === 'string') return [ht];
    return [];
}

function getDefaultHeadtrackingMethod(profile) {
    const methods = getAvailableHeadtrackingMethods(profile);
    if (methods.length === 0) return null;
    
    // Profile-type aware priority
    // Geo-11/Geo-12: prefer OpenTrack (best for flat displays)
    // Native VR: prefer SteamVR (native runtime)
    // Default: follow standard priority
    
    let priority = ['opentrack', 'steamvr', 'openxr', '6dof', '3dof'];
    
    if (profile?.type === 'geo11' || profile?.type === 'geo12') {
        // For Geo-11/12: OpenTrack is best for flat stereo displays with tracking
        priority = ['opentrack', 'steamvr', 'openxr', '6dof', '3dof'];
    } else if (profile?.type === 'native' || profile?.type === 'uevr' || profile?.type === 'ue3d') {
        // For VR modes: SteamVR usually best, but could be native VR runtime
        priority = ['steamvr', 'openxr', 'vr', '6dof', 'opentrack', '3dof'];
    }
    
    for (const p of priority) {
        if (methods.includes(p)) return p;
    }
    return methods[0];
}

function updateHeadtrackingUI() {
    const row          = document.getElementById('configRowHeadtrack');
    const control      = document.getElementById('headtrackingControl');
    const methodSelect = document.getElementById('headtrackingMethod');

    if (!control || !methodSelect) return;

    const hasGameTracking    = supportsHeadtracking(selectedProfile);
    const hasDisplayTracking = true; // TODO: wire to display capabilities

    const visible = hasGameTracking && hasDisplayTracking;
    if (row) row.classList.toggle('hidden', !visible);
    control.style.display = visible ? 'block' : 'none';

    if (!visible) {
        methodSelect.innerHTML = '';
        return;
    }
    
    // Populate available tracking methods with display-aware labels:
    //   none / Lopari / Lopari OpenTrack / OpenTrack / SR OpenTrack Bridge
    const methods = getAvailableHeadtrackingMethods(selectedProfile);
    methodSelect.innerHTML = '';
    const noneOpt = document.createElement('option');
    noneOpt.value = 'none';
    noneOpt.text  = 'None';
    methodSelect.appendChild(noneOpt);

    const isSR      = currentDisplayFamily() === 'sr_display';
    const fixIsLoop = selectedProfile?.type === 'loop_headtrack';
    const labelFor = (method) => {
        if (fixIsLoop) return 'Lopari OpenTrack';
        if (method === 'vireio') return 'Vireio Perception';
        if (method === 'opentrack' || method === 'leia_track') {
            return isSR ? 'SR OpenTrack Bridge' : 'OpenTrack';
        }
        return getHeadtrackingMethodLabel(method) || method;
    };
    methods.forEach(method => {
        const opt = document.createElement('option');
        opt.value = method;
        opt.text  = labelFor(method);
        methodSelect.appendChild(opt);
    });
    // Vireio Perception headtracking is a generic injector — offer it for any
    // game with a stereo (non-Loop) fix, on top of whatever the fix natively
    // provides. The vireio adapter picks up method='vireio' at pipeline time.
    if (!fixIsLoop && !methods.includes('vireio')) {
        const opt = document.createElement('option');
        opt.value = 'vireio';
        opt.text  = 'Vireio Perception';
        methodSelect.appendChild(opt);
    }
    
    // Populate the OpenTrack input-mode select once (cheap, idempotent).
    // (tracker source is auto-resolved — no UI selector to populate)

    // Select default method. Smart default-on policy: SR/VR/AR displays start
    // with headtracking enabled; normal 3D defaults to None even if the game
    // supports it (neural-webcam tracking can surprise users).
    if (methods.length > 0) {
        const familyId = currentDisplayFamily();
        const autoOn = isHeadtrackingDefaultOn(familyId);
        const defaultMethod = autoOn ? (getDefaultHeadtrackingMethod(selectedProfile) || 'none') : 'none';
        methodSelect.value = defaultMethod;
    } else {
        methodSelect.value = 'none';
    }

    // Trigger change to update meta and show/hide OpenTrack-specific selectors
    handleHeadtrackingChange();
}

// ─── OpenTrack input-mode + axis selectors ───────────────────
// Tracker module IDs from modules/opentrackProfile.js#INPUT_MODE_TO_MODULE.
// Order matters — first matching default_for entry wins per display family.
const OPENTRACK_INPUT_MODES = [
    { id: 'freetrack_passthrough', label: 'FreeTrack passthrough (chained from SR-bridge / Vireio / Loop)' },
    { id: 'neuralnet',             label: 'Neural webcam (no extra hardware)' },
    { id: 'tracker-xreal-one',     label: 'Xreal AR glasses' },
    { id: 'pt',                    label: 'Point Tracker (IR LEDs / TrackHat)' },
    { id: 'aruco',                 label: 'ArUco fiducial markers' },
    { id: 'wii',                   label: 'Wii Remote' },
    { id: 'hatire',                label: 'Hatire (Arduino / DIY IR hat)' },
    { id: 'steamvr',               label: 'SteamVR headset pose' },
    { id: 'headcam',               label: 'Loop HeadCam (iPhone)' },
];

const OPENTRACK_AXIS_PRESETS = {
    '6dof':        { x:1, y:1, z:1, yaw:1, pitch:1, roll:1 },
    'rotation':    { x:0, y:0, z:0, yaw:1, pitch:1, roll:1 },
    'translation': { x:1, y:1, z:1, yaw:0, pitch:0, roll:0 },
    'yaw_pitch':   { x:0, y:0, z:0, yaw:1, pitch:1, roll:0 },
    'yaw_only':    { x:0, y:0, z:0, yaw:1, pitch:0, roll:0 },
};

// Smart default per output type: SR/VR/AR auto-on with sensible source, normal 3D opt-in.
function defaultOpenTrackInputFor(outputId, displayFamily) {
    if (displayFamily === 'sr_display')  return 'freetrack_passthrough';
    if (displayFamily === 'vr_headset')  return 'steamvr';
    if (displayFamily === 'ar_glasses')  return 'tracker-xreal-one';
    return 'neuralnet';
}

function currentDisplayFamily() {
    // selectedDisplay is a top-level let bound in this file (display dropdown's data-value).
    // Matches data/displays/*.json family_id values for the SR / VR cases.
    return (typeof selectedDisplay === 'string') ? selectedDisplay : null;
}

function populateOpenTrackInputSelect() {
    const sel = document.getElementById('opentrackInputMode');
    if (!sel) return;
    sel.innerHTML = '';
    for (const mode of OPENTRACK_INPUT_MODES) {
        const opt = document.createElement('option');
        opt.value = mode.id;
        opt.text  = mode.label;
        sel.appendChild(opt);
    }
}

window.handleOpenTrackInputChange = function() {
    // Hook for any future side-effects (preview, validation). Value is read at launch.
};

window.handleOpenTrackAxesChange = function() {
    // Same — read at launch by getHeadtrackingState.
};

function isHeadtrackingDefaultOn(displayFamily) {
    // Auto-on for SR/VR/AR outputs; opt-in for normal 3D (anaglyph/SBS/interlaced
    // on a regular monitor) since the neural-webcam path may surprise users.
    return ['sr_display', 'vr_headset', 'ar_glasses'].includes(displayFamily);
}

window.handleHeadtrackingChange = function() {
    const methodSelect = document.getElementById('headtrackingMethod');
    const metaHT       = document.getElementById('metaHeadtracking');
    const axesControl  = document.getElementById('opentrackAxesControl');

    if (!methodSelect || !metaHT) return;

    const selectedMethod = methodSelect.value;

    if (selectedMethod === 'none') {
        metaHT.textContent = 'No';
        if (axesControl) axesControl.style.display = 'none';
        const openBtn = document.getElementById('btnOpenOpenTrack');
        if (openBtn) openBtn.style.display = 'none';
        return;
    }

    metaHT.textContent = `Yes — ${getHeadtrackingMethodLabel(selectedMethod)}`;

    // Tracker source is auto-resolved from the stereo display (no UI selector).
    const isOT = selectedMethod === 'opentrack' || selectedMethod === 'leia_track';
    // 'block' (not 'flex') keeps the label above its dropdown like the other config-items.
    if (axesControl) axesControl.style.display = isOT ? 'block' : 'none';
    const openBtn = document.getElementById('btnOpenOpenTrack');
    if (openBtn) openBtn.style.display = isOT ? '' : 'none';
    // Refresh the pipeline chain so the headtracking step appears/disappears.
    try { updateSubOptions?.(); } catch {}
    // Refresh the per-game HT axes pill bar (Phase 2e) — shows when HT is on,
    // hides when off.
    try { window.renderHtAxesPills?.(); } catch {}
};

window.getHeadtrackingState = function() {
    const methodSelect = document.getElementById('headtrackingMethod');
    if (!methodSelect) return { enabled: false, method: null };

    const selectedMethod = methodSelect.value;
    if (selectedMethod === 'none') return { enabled: false, method: null };

    const state = { enabled: true, method: selectedMethod };

    if (selectedMethod === 'opentrack' || selectedMethod === 'leia_track') {
        // input_mode is auto-derived from the chosen stereo display family —
        // no manual selector. SR → freetrack_passthrough, VR → steamvr, etc.
        state.input_mode  = defaultOpenTrackInputFor(getEffectiveOutputIdFromSelects?.(), currentDisplayFamily());
        const axesSelect  = document.getElementById('opentrackAxes');
        state.axes_preset = axesSelect?.value || '6dof';
        state.axes        = OPENTRACK_AXIS_PRESETS[state.axes_preset] || OPENTRACK_AXIS_PRESETS['6dof'];
    }
    return state;
};



// ─── CONFIG BAR ──────────────────────────────────────────────
function updateConfigBar() {
    primarySelect.innerHTML = '';
    // Geo-12 only supports SR Weave
    const geo12Only = selectedProfile?.type === 'geo12';
    Object.keys(OUTPUT_DEFINITIONS).forEach(key => {
        const def = OUTPUT_DEFINITIONS[key];
        const steps = getPipelineSteps(selectedProfile.type, key);
        const opt = document.createElement('option');
        opt.value = key; opt.innerText = def.label;
        if (steps === null || (geo12Only && key !== 'sr_weave')) {
            opt.disabled = true;
            if (geo12Only && key !== 'sr_weave') opt.innerText += ' (SR only)';
            else opt.innerText += ' (N/A)';
        }
        if (def.status === 'deprecated' || def.status === 'defunct') opt.innerText += ' [Legacy]';
        primarySelect.appendChild(opt);
    });
    const valid = Array.from(primarySelect.options).find(o => !o.disabled);
    if (valid) { primarySelect.value = valid.value; primarySelect.dispatchEvent(new Event('change')); }
    
    // Update headtracking UI
    updateHeadtrackingUI();
}

function updateSubOptions() {
    const mode = primarySelect.value;
    const def  = OUTPUT_DEFINITIONS[mode];
    if (!def) return;
    subSelect.innerHTML = '';
    def.subs.forEach(s => { const opt = document.createElement('option'); opt.value = opt.innerText = s; subSelect.appendChild(opt); });
    // Hide format dropdown for SR Weave (4-way Leia weave is deprecated)
    // Show it for all others including frame_packing (1080p / 720p) and interleaved/anaglyph
    const subContainer = subSelect.closest('.config-item') || subSelect.parentElement;
    if (subContainer) {
        const hideSub = (mode === 'sr_weave');
        subContainer.style.display = hideSub ? 'none' : '';
    }
    const extraSteps = getPipelineSteps(selectedProfile.type, mode);
    if (extraSteps === null) { pipelineInfo.style.display = 'none'; updateReshadeButton(); return; }

    const chain = [];

    // dgVoodoo2 (or other wrappers) shown BEFORE the game if in prerequisites
    const prereqs = selectedProfile.prerequisites || [];
    const hasDgVoodoo = prereqs.some(p => /dgvoodoo/i.test(p));
    if (hasDgVoodoo) {
        chain.push(`<span class="pipeline-step" style="border-color:rgba(155,89,182,0.6);color:rgba(155,89,182,0.9);">dgVoodoo2</span>`);
    }

    chain.push(`<span class="pipeline-step" style="border-color:var(--glass-border-bright);">${selectedGame.title}</span>`);

    // Pipeline order: Game → Head Tracking (if on) → 3D Mod → Output
    // Head pose flows from game through the OpenTrack hub before the stereo mod
    // consumes it for per-eye rendering.
    const ht = window.getHeadtrackingState?.();
    if (ht?.enabled && ht.method && ht.method !== 'none') {
        const htLabel = getHeadtrackingMethodLabel(ht.method) || ht.method;
        chain.push(`<span class="pipeline-step" style="border-color:var(--teal-border);">${htLabel}</span>`);
    }

    const terminalStep = `<span class="pipeline-step" style="border-color:rgba(201,138,75,0.4);background:rgba(201,138,75,0.06);color:var(--teal);">${getOutputTerminalLabel(mode)}</span>`;

    if (extraSteps.length === 0) {
        const label = selectedProfile.type === 'native_legacy' ? `Native ${mode.toUpperCase()}` : selectedProfile.name;
        chain.push(`<span class="pipeline-step" style="border-color:var(--teal-border);">${label}</span>`);
        chain.push(terminalStep);
        pipelineInfo.style.borderLeftColor = 'var(--teal)';
    } else {
        const baseLabel = (selectedProfile.type==='uevr'&&selectedProfile.native_outputs?.includes('vr')) ? 'Native VR' : selectedProfile.name;
        chain.push(`<span class="pipeline-step" style="border-color:var(--teal-border);">${baseLabel}</span>`);
        extraSteps.forEach(step => chain.push(`<span class="pipeline-step" style="border-color:rgba(255,159,67,0.5);">${step}</span>`));
        chain.push(terminalStep);
        pipelineInfo.style.borderLeftColor = '#ff9f43';
    }
    pipelineInfo.innerHTML = `<strong>Pipeline</strong>
        <div>${chain.join(' <span class="pipeline-arrow">→</span> ')}</div>`;
    pipelineInfo.style.display = 'block';
    updateReshadeButton();
}
primarySelect.addEventListener('change', () => {
    updateSubOptions();
    syncVRto3DOutput(getEffectiveOutputIdFromSelects());
    syncGeo11Output(getEffectiveOutputIdFromSelects());
});
subSelect.addEventListener('change', () => {
    // Re-render ONLY the pipeline display when format changes (interleaved type, anaglyph colour)
    // Don't call full updateSubOptions — that would reset the sub dropdown
    if (!selectedProfile || !primarySelect.value) return;
    const mode = primarySelect.value;
    const def  = OUTPUT_DEFINITIONS[mode];
    if (!def) return;
    const extraSteps = getPipelineSteps(selectedProfile.type, getEffectiveOutputIdFromSelects());
    if (extraSteps === null) { pipelineInfo.style.display = 'none'; return; }
    const chain = [];
    const prereqs = selectedProfile.prerequisites || [];
    if (prereqs.some(p => /dgvoodoo/i.test(p))) {
        chain.push(`<span class="pipeline-step" style="border-color:rgba(155,89,182,0.6);color:rgba(155,89,182,0.9);">dgVoodoo2</span>`);
    }
    chain.push(`<span class="pipeline-step" style="border-color:var(--glass-border-bright);">${selectedGame.title}</span>`);
    // Game → Head Tracking → Mod → Output
    const ht2 = window.getHeadtrackingState?.();
    if (ht2?.enabled && ht2.method && ht2.method !== 'none') {
        const htLabel2 = getHeadtrackingMethodLabel(ht2.method) || ht2.method;
        chain.push(`<span class="pipeline-step" style="border-color:var(--teal-border);">${htLabel2}</span>`);
    }
    const terminalStep = `<span class="pipeline-step" style="border-color:rgba(201,138,75,0.4);background:rgba(201,138,75,0.06);color:var(--teal);">${getOutputTerminalLabel(mode)}</span>`;
    if (extraSteps.length === 0) {
        const label = selectedProfile.type === 'native_legacy' ? `Native ${mode.toUpperCase()}` : selectedProfile.name;
        chain.push(`<span class="pipeline-step" style="border-color:var(--teal-border);">${label}</span>`);
        chain.push(terminalStep);
        pipelineInfo.style.borderLeftColor = 'var(--teal)';
    } else {
        const baseLabel = (selectedProfile.type==='uevr'&&selectedProfile.native_outputs?.includes('vr')) ? 'Native VR' : selectedProfile.name;
        chain.push(`<span class="pipeline-step" style="border-color:var(--teal-border);">${baseLabel}</span>`);
        extraSteps.forEach(step => chain.push(`<span class="pipeline-step" style="border-color:rgba(255,159,67,0.5);">${step}</span>`));
        chain.push(terminalStep);
        pipelineInfo.style.borderLeftColor = '#ff9f43';
    }
    // Append the active headtracking step so the chain shows where head pose flows.
    const ht = window.getHeadtrackingState?.();
    if (ht?.enabled && ht.method) {
        const htLabel = getHeadtrackingMethodLabel(ht.method) || ht.method;
        chain.push(`<span class="pipeline-step" style="border-color:var(--teal-border);">${htLabel}</span>`);
    }
    pipelineInfo.innerHTML = `<strong>Pipeline</strong>
        <div>${chain.join(' <span class="pipeline-arrow">→</span> ')}</div>`;
    pipelineInfo.style.display = 'block';
    updateReshadeButton();
    syncVRto3DOutput(getEffectiveOutputIdFromSelects());
    syncGeo11Output(getEffectiveOutputIdFromSelects());
});

// ─── GEO MODAL ───────────────────────────────────────────────
let geoState = null, geoIniPath = null, geoFixId = null, geoPending = {};
let wiz3dPending = {};   // userOverrides shape consumed by modules/wiz3dConfig.js#buildPatches
let geoSettingsLocked = true;   // advanced sections (output, debug, hunting)
let geoDepthLocked = false;     // depth section (separation/convergence) — locked when fix has presets
let modLocked = true;           // mod tab settings (UEVR, ReShade, VRto3D) — locked by default
function resolveIniPath(profile, gamePath) { return `${gamePath}\\${profile.ini_file||'d3dxdm.ini'}`; }
function fmtVal(v, field) { if (v===null||v===undefined) return '—'; if (field.type==='checkbox') return v===field.trueValue?'On':'Off'; return v; }
function isOverridden(key) { return geoState?.overrides?.hasOwnProperty(key); }
function countDecimals(step) { const s=String(step); return s.includes('.')?s.split('.')[1].length:0; }

function buildGeoModalHTML() {
    if (!geoState) return '<p style="color:var(--danger)">Failed to load ini state.</p>';
    const { effective, defaults, knownFields } = geoState;
    const PRIORITY_KEYS = ['dm_separation','dm_convergence','dm_auto_convergence'];
    // Build sections — Depth comes first with the key stereo settings
    const sections = {};
    PRIORITY_KEYS.forEach(key => {
        if (!knownFields[key]) return;
        if (!sections['Depth']) sections['Depth'] = [];
        sections['Depth'].push({key, field:knownFields[key], val: effective[key] ?? defaults?.[key] ?? null});
    });
    Object.entries(knownFields).forEach(([key, field]) => {
        if (PRIORITY_KEYS.includes(key)) return;
        const s = field.section||'Other'; if(!sections[s]) sections[s]=[];
        sections[s].push({key, field, val: effective[key] ?? defaults?.[key] ?? null});
    });
    let html = '';
    Object.entries(sections).forEach(([section, items]) => {
        // Hide 'output' section — main UI pipeline selector handles this
        if (section === 'output' || section === 'Output') return;
        const isDepthSection = section === 'Depth' || section === 'stereo';
        const sectionLocked  = isDepthSection ? geoDepthLocked : geoSettingsLocked;
        const lockNote = sectionLocked
            ? ` <span style="font-size:9px;color:var(--text-dim);font-weight:400;letter-spacing:0;">🔒 <span class="geo-lock-link" onclick="window.toggleGeoLock()" style="cursor:pointer;color:var(--text-dim);text-decoration:underline;text-underline-offset:2px;">unlock</span></span>`
            : '';
        html += `<div class="geo-section${sectionLocked?' locked-section':''}"><div class="geo-section-label">${section}${lockNote}</div>`;
        items.forEach(({key,field,val}) => {
            // Skip hidden fields (like the master hunting select)
            if (field.hidden) return;
            // Info rows: just a labelled tip, no control
            if (field.type === 'info') {
                const isActive = geoState?.effective?.hunting === '0' || !geoState?.effective?.hunting;
                html += `<div class="geo-row geo-row-info"><div class="geo-row-left"><span class="geo-dot ${isActive?'dot-default':'dot-none'}"></span>
                    <div><div class="geo-row-label">${field.label}</div><div class="geo-row-tip">${field.tip}</div></div></div>
                    <div class="geo-row-right"><span style="font-size:10px;padding:3px 8px;border-radius:4px;background:rgba(201,138,75,0.08);color:${isActive?'var(--teal)':'var(--text-dim)'};">${isActive?'Active':''}</span></div></div>`;
                return;
            }
            // Hunting toggle rows: radio-style buttons
            if (field.type === 'hunting_toggle') {
                const isActive = String(geoState?.effective?.hunting ?? '0') === field.huntingValue;
                const locked   = geoSettingsLocked;
                html += `<div class="geo-row" id="row_${key}"><div class="geo-row-left"><span class="geo-dot ${isActive?'dot-override':'dot-none'}"></span>
                    <div><div class="geo-row-label">${field.label}</div><div class="geo-row-tip">${field.tip}</div></div></div>
                    <div class="geo-row-right">
                        <button class="geo-hunt-btn${isActive?' active':''}" ${locked?'disabled':''} onclick="setHuntingMode('${field.huntingValue}')"
                            style="${locked?'opacity:0.4;cursor:not-allowed;':''}">
                            ${isActive ? 'Active — click to deactivate' : 'Activate'}
                        </button>
                    </div></div>`;
                return;
            }
            const defVal=defaults?.[key]??null, overridden=isOverridden(key);
            const dotClass=overridden?'dot-override':(defVal!==null?'dot-default':'dot-none');
            const dotTitle=overridden?'Your override active':(defVal!==null?'Fix-author default':'Not set in this fix');
            html += `<div class="geo-row" id="row_${key}"><div class="geo-row-left"><span class="geo-dot ${dotClass}" title="${dotTitle}"></span>
                <div><div class="geo-row-label">${field.label}</div><div class="geo-row-tip">${field.tip}</div></div></div><div class="geo-row-right">`;
            const isDepthField = field.section === 'stereo' || PRIORITY_KEYS.includes(key);
            const rowLocked = isDepthField ? geoDepthLocked : geoSettingsLocked;
            if (field.type==='select') {
                html += `<select class="geo-select" data-key="${key}" ${rowLocked?'disabled':''}  onchange="geoPending['${key}']=this.value;updateGeoRowState('${key}')" style="${rowLocked?'opacity:0.4;pointer-events:none;':''}">`;
                field.options.forEach(opt=>{html+=`<option value="${opt.value}" ${String(val)===String(opt.value)?'selected':''}>${opt.label}</option>`;});
                html += `</select>`;
            } else if (field.type==='range') {
                const cur=val!==null?parseFloat(val):field.min;
                html += `<div style="display:flex;align-items:center;gap:8px;">
                    <input type="range" class="geo-range" data-key="${key}" min="${field.min}" max="${field.max}" step="${field.step}" value="${cur}"
                        oninput="geoPending['${key}']=this.value;document.getElementById('num_${key}').value=parseFloat(this.value).toFixed(countDecimals(${field.step}));updateGeoRowState('${key}')">
                    <input type="number" id="num_${key}" class="geo-number" min="${field.min}" max="${field.max}" step="${field.step}" value="${cur!==null?parseFloat(cur).toFixed(countDecimals(field.step)):''}"
                        oninput="geoPending['${key}']=this.value;document.querySelector('[data-key=${key}].geo-range').value=this.value;updateGeoRowState('${key}')"></div>`;
            } else if (field.type==='checkbox') {
                html += `<label class="geo-toggle"><input type="checkbox" data-key="${key}" ${val===field.trueValue?'checked':''}
                    onchange="geoPending['${key}']=this.checked?'${field.trueValue}':'${field.falseValue}';updateGeoRowState('${key}')">
                    <span class="geo-toggle-track"></span></label>`;
            }
            if (defVal!==null) html+=`<button class="geo-default-pill" id="pill_${key}" title="Fix default: ${fmtVal(defVal,field)}" onclick="revertField('${key}')">↺ ${fmtVal(defVal,field)}</button>`;
            html += `</div></div>`;
        });
        html += `</div>`;
    });
    
    // Add Eye Swap section for Geo-11
    if (selectedProfile?.type === 'geo11') {
        const eyeSwapVal = geoState?.effective?.eye_swap ?? geoState?.defaults?.eye_swap ?? '0';
        const eyeSwapOverridden = String(geoState?.overrides?.eye_swap) !== 'undefined';
        const eyeSwapDot = eyeSwapOverridden ? 'dot-override' : (geoState?.defaults?.eye_swap !== undefined ? 'dot-default' : 'dot-none');
        
        html += `<div class="geo-section"><div class="geo-section-label">Eye Swap</div>`;
        html += `<div class="geo-row" id="row_eye_swap">`;
        html += `<div class="geo-row-left"><span class="geo-dot ${eyeSwapDot}" title="${eyeSwapOverridden?'Your override active':(geoState?.defaults?.eye_swap !== undefined?'Fix-author default':'Not set in this fix')}"></span>`;
        html += `<div><div class="geo-row-label">Swap Left/Right Eyes</div><div class="geo-row-tip">Reverses stereo view perspective. Enable if game renders eyes in opposite order.</div></div></div>`;
        html += `<div class="geo-row-right">`;
        html += `<label class="geo-toggle"><input type="checkbox" data-key="eye_swap" ${String(eyeSwapVal)==='1'?'checked':''} ${geoSettingsLocked?'disabled':''}
            onchange="geoPending['eye_swap']=this.checked?'1':'0';updateGeoRowState('eye_swap')">
            <span class="geo-toggle-track"></span></label>`;
        if (geoState?.defaults?.eye_swap !== undefined) {
            html += `<button class="geo-default-pill" id="pill_eye_swap" title="Fix default: ${geoState.defaults.eye_swap==='1'?'On':'Off'}" onclick="revertField('eye_swap')" style="display:${eyeSwapOverridden?'block':'none'}">↺ ${geoState.defaults.eye_swap==='1'?'On':'Off'}</button>`;
        }
        html += `</div></div>`;
        html += `</div>`;
    }
    
    return html;
}
function updateGeoRowState(key) {
    const row=document.getElementById(`row_${key}`); if(!row) return;
    const defVal=geoState.defaults?.[key], newVal=geoPending[key]??geoState.effective[key];
    const dot=row.querySelector('.geo-dot'), pill=document.getElementById(`pill_${key}`);
    const isChange=defVal!==null&&String(newVal)!==String(defVal);
    row.classList.toggle('row-overridden',isChange);
    dot.className=isChange?'geo-dot dot-override':(defVal!==null?'geo-dot dot-default':'geo-dot dot-none');
    dot.title=isChange?'Your override active':(defVal!==null?'Fix-author default':'Not set in this fix');
    if(pill) pill.classList.toggle('pill-visible',isChange);
}
function revertField(key) {
    const defVal=geoState.defaults?.[key]; if(!defVal) return;
    delete geoPending[key];
    const field=geoState.knownFields[key];
    if(field.type==='select'){const el=document.querySelector(`[data-key="${key}"].geo-select`);if(el)el.value=defVal;}
    else if(field.type==='range'){const range=document.querySelector(`[data-key="${key}"].geo-range`),num=document.getElementById(`num_${key}`);if(range)range.value=defVal;if(num)num.value=parseFloat(defVal).toFixed(countDecimals(field.step));}
    else if(field.type==='checkbox'){const cb=document.querySelector(`[data-key="${key}"]`);if(cb)cb.checked=(defVal===field.trueValue);}
    updateGeoRowState(key);
}
async function openGeoModal(opts = {}) {
    // The Mod Settings "modal" content was relocated inline onto the game
    // page in the 2026-05-17 refit — see #modSettingsInline in index.html.
    // This function still does its setup (state load, tab + button toggling,
    // build HTML) but no longer toggles a modal overlay. Called automatically
    // when the user selects a game.
    const { defaultTab = 'geo', hideGeoTab = false } = opts;
    const type = selectedProfile?.type || '';
    const isUEVR = ['uevr','ue3d'].includes(type);
    const isWiz3D = type.startsWith('wiz3d');
    const tabUEVR = document.getElementById('tabUEVR');
    const tabVRto3D = document.getElementById('tabVRto3D');
    const tabWiz3D = document.getElementById('tabWiz3D');
    const tabGeo  = document.getElementById('tabGeo');
    if (tabUEVR) tabUEVR.style.display = isUEVR ? '' : 'none';
    if (tabVRto3D) tabVRto3D.style.display = isUEVR ? '' : 'none';
    if (tabWiz3D) tabWiz3D.style.display = isWiz3D ? '' : 'none';
    const hideGeo = hideGeoTab || isWiz3D;
    if (tabGeo)  tabGeo.style.display  = hideGeo ? 'none' : '';

    // Update button label based on profile type
    const saveBtn = document.getElementById('geoSaveBtn');
    if (saveBtn) {
        saveBtn.textContent = isUEVR ? 'Save Settings' : (isWiz3D ? 'Save Settings' : 'Save to ini');
    }

    // Switch to the appropriate default tab
    setTimeout(() => window.switchModTab?.(defaultTab), 50);

    const gamePath=getInstallPath(); if(!gamePath){alert('Set the Game Folder path first.');return;}
    geoFixId=selectedProfile.id; geoIniPath=resolveIniPath(selectedProfile,gamePath); geoPending={};
    wiz3dPending = {};
    geoSettingsLocked = true;
    modLocked = true;  // Start with mod settings locked

    // Update lock button state
    const lockBtn = document.getElementById('geoLockBtn');
    if (lockBtn) {
        lockBtn.textContent = '🔒 Locked';
        lockBtn.style.color = 'var(--text-dim)';
    }

    const body=document.getElementById('geoModalBody'),statusEl=document.getElementById('geoModalStatus');
    document.getElementById('geoModalTitle').textContent=`${selectedProfile.name}`;
    document.getElementById('geoModalSubtitle').textContent='Mod Settings';
    body.innerHTML='<div style="color:var(--text-dim);font-size:12px;padding:20px 0;">Loading ini…</div>';
    statusEl.textContent='';
    // Modal show removed — content lives inline at #modSettingsInline since
    // the 2026-05-17 refit. Just populate the in-place elements.
    // For UEVR/UE3D fixes, start on UEVR tab; for wiz3D start on wiz3D tab
    if (isWiz3D) {
        window.switchModTab('wiz3d');
    } else if (isUEVR) {
        window.switchModTab('uevr');
    } else {
        window.switchModTab('geo');
    }
    const reshadeInstalled = reshadeStatus?.installed;
    const tabsEl = document.getElementById('modSettingsTabs');
    const tabReshade = document.getElementById('tabReshade');

    // Show tabs if ReShade is installed OR it's a UEVR/wiz3D fix
    if (tabsEl) tabsEl.style.display = (reshadeInstalled || isUEVR || isWiz3D) ? 'flex' : 'none';

    // Hide ReShade tab button specifically if ReShade isn't actually available
    if (tabReshade) {
        tabReshade.style.display = reshadeInstalled ? '' : 'none';
    }

    // wiz3D fixes don't use the Geo-11 ini — skip iniGetState entirely
    if (isWiz3D) {
        statusEl.innerHTML = `<span style="color:var(--text-dim);">● wiz3D settings — patches Config.xml on launch</span>`;
        return;
    }

    const result=await window.api.iniGetState(geoFixId,geoIniPath);
    if(!result.success && !isUEVR){body.innerHTML=`<div style="color:var(--danger);font-size:12px;">${result.message}<br><br><span style="color:var(--text-dim);">Install the fix first, then open Mod Settings.</span></div>`;return;}
    if (!isUEVR) {
        geoState={current:result.current,defaults:result.defaults,overrides:result.overrides,effective:result.effective,knownFields:result.knownFields};
        // If fix has tuned defaults (it's a proper preset), lock depth so user doesn't
        // accidentally break the author's carefully tuned convergence/separation values.
        // User can still unlock with a single click.
        geoDepthLocked = !!(geoState.defaults && Object.keys(geoState.defaults).length > 0);
        body.innerHTML=buildGeoModalHTML();
        Object.keys(geoState.overrides).forEach(k=>updateGeoRowState(k));
        statusEl.innerHTML=result.defaults?`<span style="color:var(--text-dim);">● Fix defaults loaded · overrides shown in teal</span>`:`<span style="color:var(--warn);">⚠ No defaults snapshot yet.</span>`;
    }
}

window.toggleAllLocks = function() {
    // Toggle all locks at once: geo settings, depth, and mod settings
    const newLocked = !(geoSettingsLocked && geoDepthLocked && modLocked);
    geoSettingsLocked = newLocked;
    geoDepthLocked = newLocked;
    modLocked = newLocked;
    
    const btn = document.getElementById('geoLockBtn');
    if (btn) {
        btn.textContent = newLocked ? '🔒 Locked' : '🔓 Unlocked';
        btn.style.color = newLocked ? 'var(--text-dim)' : 'var(--teal)';
        btn.style.borderColor = newLocked ? '' : 'var(--teal-border)';
    }
    
    // Update geo modal body if present
    if (geoState && document.getElementById('geoModalBody')) {
        document.getElementById('geoModalBody').innerHTML = buildGeoModalHTML();
        Object.keys(geoState.overrides).forEach(k => updateGeoRowState(k));
    }
    
    // Disable/enable all inputs in mod tabs
    document.querySelectorAll('#modTab-reshade input, #modTab-reshade select, #modTab-uevr input, #modTab-uevr select, #modTab-vrto3d input, #modTab-vrto3d select, #modTab-wiz3d input, #modTab-wiz3d select').forEach(el => {
        el.disabled = newLocked;
    });
};

window.setHuntingMode = function(val) {
    if (!geoState) return;
    // Toggle: clicking active mode deactivates it (returns to 0)
    const current = String(geoState?.effective?.hunting ?? '0');
    const newVal  = current === val ? '0' : val;
    geoPending['hunting'] = newVal;
    if (geoState.effective) geoState.effective.hunting = newVal;
    document.getElementById('geoModalBody').innerHTML = buildGeoModalHTML();
};
// closeGeoModal kept as a compatibility no-op — the modal is gone, but
// some legacy callsites still invoke it (e.g., post-save success path).
// Just clears the in-memory state so the next game switch reloads cleanly.
window.closeGeoModal = function(){
    const m = document.getElementById('geoModal');
    if (m) m.style.display = 'none';   // no-op: hollow stub element is already display:none
    geoState=null;
    geoPending={};
};
window.saveGeoModal = async function(){
    const type = selectedProfile?.type || '';
    const isUEVR  = ['uevr','ue3d'].includes(type);
    const isWiz3D = type.startsWith('wiz3d');
    if (isUEVR) {
        saveUEVRModSettings();
        return;
    }
    // wiz3D fixes have no ini — wiz3dPending is consumed by executePipeline at launch.
    // Just close the modal; the values stay in memory for the upcoming launch.
    if (isWiz3D) {
        const statusEl = document.getElementById('geoModalStatus');
        if (statusEl) statusEl.innerHTML = '<span style="color:var(--teal);">✓ Settings will be applied on next launch</span>';
        setTimeout(() => window.closeGeoModal(), 600);
        return;
    }
    
    const statusEl=document.getElementById('geoModalStatus'),saveBtn=document.getElementById('geoSaveBtn');
    if(!statusEl || !saveBtn) return;
    
    saveBtn.disabled=true; statusEl.innerHTML='<span style="color:var(--text-dim);">Saving…</span>';
    
    // Also save ReShade screenshot settings if ReShade is installed
    const reshadeInstalled = reshadeStatus?.installed;
    const promises = [];
    
    // Save Geo-11 INI if present
    if (geoState) {
        promises.push(window.api.iniApply(geoFixId, geoIniPath, geoPending));
    }
    
    // Save ReShade screenshot settings if available
    if (reshadeInstalled) {
        const gamePath = getInstallPath();
        if (gamePath) {
            const reshadeIni = gamePath.replace(/[/\\]$/, '') + '\\ReShade.ini';
            const before   = document.getElementById('ms-ss-before')?.checked  ?? false;
            const after    = document.getElementById('ms-ss-after')?.checked   ?? true;
            const fmt      = document.getElementById('ms-ss-format')?.value    || 'PNG';
            const inFolder = document.getElementById('ms-ss-folder')?.checked  ?? true;
            let beforeEffects = 0;
            if (before && after) beforeEffects = 1;
            else if (before)     beforeEffects = 2;
            const patches = {
                SaveFormat:            fmt,
                SaveBeforeUseEffects:  String(beforeEffects),
                SavePath:              inFolder ? '.\ ' : '',
            };
            promises.push(window.api.reshadeIniPatch(reshadeIni, 'SCREENSHOT', patches));
        }
    }
    
    // Wait for all saves
    Promise.all(promises).then(results => {
        const allSuccess = results.every(r => r?.success);
        if (allSuccess) {
            if (geoState) {
                Object.assign(geoState.effective, geoPending);
                Object.assign(geoState.overrides, geoPending);
                geoPending = {};
                document.getElementById('geoModalBody').innerHTML = buildGeoModalHTML();
                Object.keys(geoState.overrides).forEach(k => updateGeoRowState(k));
            }
            statusEl.innerHTML = `<span style="color:var(--teal);">✓ Saved</span>`;
        } else {
            const errMsg = results.find(r => r?.message)?.message || 'Unknown error';
            statusEl.innerHTML = `<span style="color:var(--danger);">✗ ${errMsg}</span>`;
        }
        saveBtn.disabled = false;
    }).catch(e => {
        statusEl.innerHTML = `<span style="color:var(--danger);">✗ ${e.message}</span>`;
        saveBtn.disabled = false;
    });
};

// Save UEVR and VRto3D settings from mod tabs
function saveUEVRModSettings() {
    const exeName = selectedGame?.exe_name;
    if (!exeName) return;
    
    const statusEl = document.getElementById('geoModalStatus');
    const saveBtn = document.getElementById('geoSaveBtn');
    if (!statusEl || !saveBtn) return;
    
    saveBtn.disabled = true;
    statusEl.innerHTML = '<span style="color:var(--text-dim);">Saving…</span>';
    
    // Gather UEVR settings
    const uevrTab = document.getElementById('modTab-uevr');
    const uevrValues = {};
    if (uevrTab) {
        uevrTab.querySelectorAll('[data-uevr]').forEach(el => {
            const key = el.dataset.uevr;
            if (el.type === 'checkbox') uevrValues[key] = el.checked ? '1' : '0';
            else uevrValues[key] = el.value;
        });
    }
    
    // Gather VRto3D settings
    const vrto3dTab = document.getElementById('modTab-vrto3d');
    const vrto3dValues = {};
    if (vrto3dTab) {
        vrto3dTab.querySelectorAll('[data-vrto3d]').forEach(el => {
            const key = el.dataset.vrto3d;
            if (el.type === 'checkbox') vrto3dValues[key] = el.checked;
            else if (el.type === 'number' || el.type === 'range') vrto3dValues[key] = parseFloat(el.value);
            else vrto3dValues[key] = el.value;
        });
    }
    
    // Save both
    Promise.all([
        Object.keys(uevrValues).length   ? window.api.uevrWriteConfig(exeName, uevrValues)   : Promise.resolve({ success: true }),
        Object.keys(vrto3dValues).length  ? window.api.vrto3dWriteConfig(vrto3dValues)        : Promise.resolve({ success: true }),
    ]).then(([ur, vr]) => {
        if (ur.success && vr.success) {
            statusEl.innerHTML = '<span style="color:var(--teal);">✓ UEVR and VRto3D settings saved</span>';
        } else {
            statusEl.innerHTML = `<span style="color:var(--danger);">✗ ${ur.message || vr.message}</span>`;
        }
        saveBtn.disabled = false;
    }).catch(e => {
        statusEl.innerHTML = `<span style="color:var(--danger);">✗ Error: ${e.message}</span>`;
        saveBtn.disabled = false;
    });
}

window.resetGeoToDefaults = async function(){
    if(!geoState?.defaults){document.getElementById('geoModalStatus').innerHTML=`<span style="color:var(--warn);">No defaults snapshot found.</span>`;return;}
    if(!confirm('Reset all values to fix-author defaults?')) return;
    const statusEl=document.getElementById('geoModalStatus');
    statusEl.innerHTML='<span style="color:var(--text-dim);">Resetting…</span>';
    const result=await window.api.iniReset(geoFixId,geoIniPath);
    if(result.success){geoPending={};const fresh=await window.api.iniGetState(geoFixId,geoIniPath);
        if(fresh.success){geoState=fresh;document.getElementById('geoModalBody').innerHTML=buildGeoModalHTML();}
        statusEl.innerHTML=`<span style="color:var(--teal);">✓ Reset to fix-author defaults</span>`;
    }else{statusEl.innerHTML=`<span style="color:var(--danger);">✗ ${result.message}</span>`;}
};

// ─── SETTINGS MODAL ──────────────────────────────────────────────
 
window.openSettingsModal = async function() {
    document.getElementById('settingsModal').style.display = 'flex';
    // Surface the build version + Vireio lineage line.
    try {
        const info = await window.api.getAppVersion?.();
        const el = document.getElementById('settingsVersion');
        if (el && info?.version) el.textContent = `v${info.version} (continuation of Vireio Perception)`;
    } catch {}
    switchSettingsTab('display');
};

window.closeSettingsModal = function() {
    document.getElementById('settingsModal').style.display = 'none';
};

window.switchSettingsTab = async function(tab) {
    // Tab button state
    document.querySelectorAll('[id^="settingsTab-"]').forEach(b => b.classList.remove('active'));
    const activeBtn = document.getElementById(`settingsTab-${tab}`);
    if (activeBtn) activeBtn.classList.add('active');

    // Show/hide persistent tab content sections (NOT innerHTML-replace —
    // the display tab contains live controls with wired event listeners).
    document.querySelectorAll('[id^="settingsTabContent-"]').forEach(el => {
        el.style.display = (el.id === `settingsTabContent-${tab}`) ? 'block' : 'none';
    });

    if (tab === 'monitors') await renderMonitorsTab();
};

// ── HT axes per-game + experimental roll (Phase 2e) ──────────
// Surfaces a simple pill picker on the game page when an HT method is
// active. Persists per-game in localStorage. The legacy #opentrackAxes
// select is kept in sync so downstream getHeadtrackingState() still works.
const HT_AXES_KEY            = 'stereopticon.htAxes';
const EXPERIMENTAL_ROLL_KEY  = 'stereopticon.experimentalRoll';

function isExperimentalRollOn() {
    try { return localStorage.getItem(EXPERIMENTAL_ROLL_KEY) === 'true'; }
    catch { return false; }
}
window.toggleExperimentalRoll = function(on) {
    try { localStorage.setItem(EXPERIMENTAL_ROLL_KEY, on ? 'true' : 'false'); } catch {}
    // Re-render the pill bar so the roll-included option appears/disappears.
    try { renderHtAxesPills(); } catch {}
};

// Show-VR-only-games toggle. Off by default — most users have flat-stereo
// displays and don't want UEVR-only titles cluttering their library.
const SHOW_VR_ONLY_KEY = 'stereopticon.showVrOnly';
function isShowVrOnly() {
    try { return localStorage.getItem(SHOW_VR_ONLY_KEY) === 'true'; }
    catch { return false; }
}
window.toggleShowVrOnly = function(on) {
    try { localStorage.setItem(SHOW_VR_ONLY_KEY, on ? 'true' : 'false'); } catch {}
    renderSidebar(gamesData);
};

// Show-deprecated-stereo3D-tech toggle. OFF by default — games whose
// only stereo path is Native-3D-Vision-driver / TriDef / HelixVision
// can't actually be played in 3D on modern systems without wiz3D help
// (which they don't have a profile for). The toggle reveals them anyway
// for users who want to see the full catalogue.
const SHOW_DEPRECATED_KEY = 'stereopticon.showDeprecated';
function isShowDeprecated() {
    try { return localStorage.getItem(SHOW_DEPRECATED_KEY) === 'true'; }
    catch { return false; }
}
window.toggleShowDeprecated = function(on) {
    try { localStorage.setItem(SHOW_DEPRECATED_KEY, on ? 'true' : 'false'); } catch {}
    renderSidebar(gamesData);
};

// Per-game axes are stored as a flat object of booleans:
//   { x, y, z, pitch, yaw, roll }
// X / Y / Z are positional, Pitch / Yaw are head rotation. Roll is off by
// default and only shown in the UI when the experimental flag is on.
const HT_AXES_DEFAULT = { x: true, y: true, z: true, pitch: true, yaw: true, roll: false };
const HT_AXES_ORDER   = [
    { key: 'x',     label: 'X',     tip: 'Lean left / right (head sway).' },
    { key: 'y',     label: 'Y',     tip: 'Lean up / down (head rise).' },
    { key: 'z',     label: 'Z',     tip: 'Lean forward / back (head depth).' },
    { key: 'pitch', label: 'Pitch', tip: 'Look up / down.' },
    { key: 'yaw',   label: 'Yaw',   tip: 'Turn left / right.' },
    { key: 'roll',  label: 'Roll',  tip: 'Tilt head side to side. Experimental — most stereo mods do not compose roll cleanly.' },
];

function loadAllHtAxes() {
    try { return JSON.parse(localStorage.getItem(HT_AXES_KEY) || '{}'); }
    catch { return {}; }
}
function saveAllHtAxes(map) {
    try { localStorage.setItem(HT_AXES_KEY, JSON.stringify(map)); } catch {}
}
function getHtAxesForGame(gameId) {
    if (!gameId) return { ...HT_AXES_DEFAULT };
    const stored = loadAllHtAxes()[gameId];
    if (!stored || typeof stored !== 'object') return { ...HT_AXES_DEFAULT };
    return { ...HT_AXES_DEFAULT, ...stored };
}
function setHtAxesForGame(gameId, axes) {
    if (!gameId) return;
    const m = loadAllHtAxes();
    m[gameId] = axes;
    saveAllHtAxes(m);
}

// Map the per-axis booleans to the closest legacy opentrackAxes value so
// existing launch-time consumers keep working until they're refactored to
// read the full axis bitmap.
function axesToLegacyValue(a) {
    const trans = a.x || a.y || a.z;
    const rot   = a.pitch || a.yaw || a.roll;
    if (trans && rot) {
        if (a.roll) return '6dof';            // includes roll → full rotation
        if (a.x && a.y && a.z) return '6dof'; // 5DOF closest legacy
        if (a.x && a.y && !a.z) return 'xy_yawpitch';
        return 'yaw_pitch';
    }
    if (rot && !trans) {
        if (a.yaw && !a.pitch && !a.roll) return 'yaw_only';
        if (a.roll) return 'rotation';
        return 'yaw_pitch';
    }
    if (trans && !rot) return 'translation';
    return 'yaw_pitch';
}

window.renderHtAxesPills = function() {
    const bar    = document.getElementById('htAxesBar');
    const pills  = document.getElementById('htAxesPills');
    const note   = document.getElementById('htAxesExperimentalNote');
    if (!bar || !pills) return;

    // Show only when an HT method is active for this game.
    const ht = window.getHeadtrackingState?.();
    const htOn = !!(ht?.enabled && ht.method && ht.method !== 'none');
    if (!htOn || !selectedGame) { bar.style.display = 'none'; return; }
    bar.style.display = 'flex';

    const game    = selectedGame;
    const axes    = getHtAxesForGame(game.id);
    const rollOn  = isExperimentalRollOn();
    const visible = HT_AXES_ORDER.filter(o => o.key !== 'roll' || rollOn);

    pills.innerHTML = visible.map(o => {
        const isOn = !!axes[o.key];
        return `<button class="ht-axes-pill" data-axis="${o.key}" title="${o.tip}"
            style="padding:5px 12px;background:${isOn ? 'rgba(201,138,75,0.12)' : 'transparent'};border:1px solid ${isOn ? 'var(--teal-border)' : 'var(--glass-border)'};color:${isOn ? 'var(--teal)' : 'var(--text-dim)'};border-radius:12px;font-size:11px;font-family:var(--font-display);font-weight:600;letter-spacing:0.6px;cursor:pointer;transition:all 0.15s;min-width:42px;">
            ${o.label}
        </button>`;
    }).join('');

    pills.querySelectorAll('.ht-axes-pill').forEach(btn => {
        btn.addEventListener('click', () => {
            const key = btn.dataset.axis;
            const next = { ...axes, [key]: !axes[key] };
            setHtAxesForGame(game.id, next);
            // Mirror to legacy select so launch-time still gets a value.
            const legacy = axesToLegacyValue(next);
            const sel = document.getElementById('opentrackAxes');
            if (sel) {
                if (![...sel.options].some(o => o.value === legacy)) {
                    const optEl = document.createElement('option');
                    optEl.value = legacy; optEl.textContent = legacy;
                    sel.appendChild(optEl);
                }
                sel.value = legacy;
                sel.dispatchEvent(new Event('change'));
            }
            renderHtAxesPills();
        });
    });

    if (note) note.style.display = rollOn ? 'inline' : 'none';
};

// Restore the Settings toggles to their persisted state on load.
document.addEventListener('DOMContentLoaded', () => {
    const cb = document.getElementById('experimentalRollToggle');
    if (cb) cb.checked = isExperimentalRollOn();
    const vr = document.getElementById('showVrOnlyToggle');
    if (vr) vr.checked = isShowVrOnly();
    const dp = document.getElementById('showDeprecatedToggle');
    if (dp) dp.checked = isShowDeprecated();
});

// ── Inline tuning sliders (Phase 2d, Geo-11 first) ───────────
// On game-page load we read the active mod's ini and surface the most-
// tweaked values as inline sliders. Locked by default — user must press
// 🔒 to unlock before edits land in the ini.
//
// Only Geo-11 is wired here. Vireio v5 / wiz3D / VRto3D get their own
// readers once this pattern is proven.
let tuningState = null;     // { fixId, iniPath, defaults, effective, mod }
let tuningLocked = true;

// Which mod-side ini keys to surface, with slider config. We try both
// modern (dm_*) and legacy (Constants.x1 etc) naming variants — Geo-11
// fixes are a mix and the iniApply accepts the flat key as-is.
const TUNING_KNOBS_GEO11 = [
    { key: 'dm_separation',      label: 'Separation',    tip: 'Eye-to-eye distance. Higher = stronger 3D pop, more strain.',   min: 0,  max: 2,    step: 0.01, fallbacks: ['x1', 'separation'] },
    { key: 'dm_convergence',     label: 'Convergence',   tip: 'Distance to the zero-parallax plane. Tune so the in-game cursor lands at screen depth.', min: 0,  max: 5,    step: 0.01, fallbacks: ['x2', 'convergence'] },
    { key: 'dm_auto_convergence',label: 'Auto-converge', tip: 'Let Geo-11 pick the convergence per-frame based on what the player is looking at.', type: 'toggle', fallbacks: [] },
];

function resolveIniPathForProfile(profile, gamePath) {
    if (!profile || !gamePath) return null;
    const iniFile = profile.ini_file || 'd3dxdm.ini';
    return gamePath.replace(/[\/\\]$/, '') + '\\' + iniFile;
}

async function loadTuningPanel() {
    const panel = document.getElementById('tuningPanel');
    if (!panel) return;
    panel.style.display = 'none';
    tuningState = null;
    tuningLocked = true;

    const profile = selectedProfile;
    const gamePath = typeof getInstallPath === 'function' ? getInstallPath() : null;
    if (!profile || !gamePath) return;
    if (profile.type !== 'geo11') return;  // Phase 2d: Geo-11 only for now.

    const iniPath = resolveIniPathForProfile(profile, gamePath);
    if (!iniPath) return;

    let result;
    try { result = await window.api.iniGetState?.(profile.id, iniPath); }
    catch { return; }
    if (!result?.success) return;

    tuningState = {
        fixId:    profile.id,
        iniPath,
        defaults: result.defaults  || {},
        effective:result.effective || {},
        overrides:result.overrides || {},
        mod:      'geo11',
    };
    // Show panel + render sliders.
    document.getElementById('tuningModName').textContent = '· ' + (profile.name || 'Geo-11');
    panel.style.display = 'block';
    renderTuningSliders();
    updateTuningLockUI();
    updateTuningRestoreVisibility();
}

function tuningValueFor(knob) {
    if (!tuningState) return null;
    const eff = tuningState.effective;
    if (eff[knob.key] !== undefined) return eff[knob.key];
    for (const f of (knob.fallbacks || [])) {
        if (eff[f] !== undefined) return eff[f];
    }
    return null;
}

function renderTuningSliders() {
    const root = document.getElementById('tuningSliders');
    if (!root || !tuningState) return;
    const locked = tuningLocked;
    let html = '';
    for (const knob of TUNING_KNOBS_GEO11) {
        const raw = tuningValueFor(knob);
        const present = raw !== null && raw !== undefined;
        const dimStyle = locked ? 'opacity:0.55;pointer-events:none;' : '';
        if (knob.type === 'toggle') {
            const checked = String(raw) === '1' || raw === true;
            html += `
            <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;padding:8px 0;border-top:1px solid var(--glass-border);">
                <div style="flex:1;">
                    <div style="font-size:12px;color:var(--text-primary);">${knob.label}${!present ? ' <span style="font-size:9px;color:var(--text-faint);letter-spacing:0.5px;">NOT IN INI</span>' : ''}</div>
                    <div style="font-size:10.5px;color:var(--text-dim);">${knob.tip}</div>
                </div>
                <label class="geo-toggle" style="${dimStyle}">
                    <input type="checkbox" data-tuning-key="${knob.key}" ${checked ? 'checked' : ''} ${locked ? 'disabled' : ''}
                        onchange="onTuningChange('${knob.key}', this.checked ? '1' : '0')">
                    <span class="geo-toggle-track"></span>
                </label>
            </div>`;
            continue;
        }
        const num = present ? parseFloat(raw) : (knob.min + (knob.max - knob.min) / 2);
        const numStr = isFinite(num) ? num.toFixed(2) : '—';
        html += `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;padding:8px 0;border-top:1px solid var(--glass-border);">
            <div style="flex:1;min-width:0;">
                <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;">
                    <span style="font-size:12px;color:var(--text-primary);">${knob.label}${!present ? ' <span style="font-size:9px;color:var(--text-faint);letter-spacing:0.5px;">NOT IN INI</span>' : ''}</span>
                    <span style="font-size:10px;color:var(--text-dim);font-family:monospace;">${numStr}</span>
                </div>
                <div style="font-size:10.5px;color:var(--text-dim);margin-top:1px;">${knob.tip}</div>
            </div>
            <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;width:200px;${dimStyle}">
                <input type="range" data-tuning-key="${knob.key}" min="${knob.min}" max="${knob.max}" step="${knob.step}" value="${num}"
                    ${locked ? 'disabled' : ''}
                    oninput="onTuningSliderInput('${knob.key}', this.value)" onchange="onTuningChange('${knob.key}', this.value)"
                    style="flex:1;">
            </div>
        </div>`;
    }
    root.innerHTML = html;
}

window.onTuningSliderInput = function(key, value) {
    // Mirror the value into the row's number label (so users see the value
    // update live while dragging). Actual write happens on `change`.
    const rows = document.querySelectorAll(`#tuningSliders [data-tuning-key="${key}"]`);
    rows.forEach(r => {
        const monospaceLabel = r.closest('div')?.previousElementSibling?.querySelector('span[style*="monospace"]');
        if (monospaceLabel) monospaceLabel.textContent = parseFloat(value).toFixed(2);
        // The numeric badge above the slider lives one level up — find by structure.
        const wrap = r.closest('div[style*="display:flex;align-items:center;justify-content:space-between"]');
        if (wrap) {
            const badge = wrap.querySelector('span[style*="monospace"]');
            if (badge) badge.textContent = parseFloat(value).toFixed(2);
        }
    });
};

window.onTuningChange = async function(key, value) {
    if (!tuningState || tuningLocked) return;
    const patch = { [key]: String(value) };
    try {
        const r = await window.api.iniApply(tuningState.fixId, tuningState.iniPath, patch);
        if (r?.success) {
            tuningState.effective[key] = value;
            tuningState.overrides[key] = value;
            updateTuningRestoreVisibility();
        }
    } catch (e) {
        console.error('[tuning] iniApply failed', e);
    }
};

window.toggleTuningLock = function() {
    tuningLocked = !tuningLocked;
    renderTuningSliders();
    updateTuningLockUI();
};

function updateTuningLockUI() {
    const icon  = document.getElementById('tuningLockIcon');
    const label = document.getElementById('tuningLockLabel');
    const btn   = document.getElementById('tuningLockBtn');
    if (!btn) return;
    if (tuningLocked) {
        if (icon)  icon.textContent  = '🔒';
        if (label) label.textContent = 'Locked';
        btn.style.borderColor = 'var(--glass-border)';
        btn.style.color       = 'var(--text-dim)';
    } else {
        if (icon)  icon.textContent  = '🔓';
        if (label) label.textContent = 'Unlocked';
        btn.style.borderColor = 'var(--teal-border)';
        btn.style.color       = 'var(--teal)';
    }
}

function updateTuningRestoreVisibility() {
    const btn = document.getElementById('tuningRestoreBtn');
    if (!btn) return;
    const hasOverrides = tuningState && Object.keys(tuningState.overrides || {}).length > 0;
    btn.style.display = hasOverrides ? 'inline-flex' : 'none';
}

window.restoreTuningOriginals = async function() {
    if (!tuningState) return;
    try {
        const r = await window.api.iniReset?.(tuningState.fixId, tuningState.iniPath);
        if (r?.success) {
            // Re-load to pick up the post-reset state.
            await loadTuningPanel();
        }
    } catch (e) {
        console.error('[tuning] iniReset failed', e);
    }
};

// ── First-run output picker (Phase 2c) ───────────────────────
// On first launch we probe for a stereo display. If we can confidently pick
// one (exactly one detected profile, not the "default") we set it silently.
// Otherwise we show a modal asking the user.
const FIRST_RUN_KEY = 'stereopticon.firstRunComplete';

function isFirstRunDone() {
    try { return localStorage.getItem(FIRST_RUN_KEY) === 'true'; }
    catch { return false; }
}
function markFirstRunDone() {
    try { localStorage.setItem(FIRST_RUN_KEY, 'true'); } catch {}
}

// Apply a DISPLAY_TO_OUTPUT mapping to the global selects. Same wiring the
// display chip uses — change events propagate to updateSubOptions etc.
function applyDisplayMappingToGlobalSelects(profileId) {
    const mapping = DISPLAY_TO_OUTPUT[profileId];
    const primary = document.getElementById('primaryOutput');
    if (!mapping || !primary) return false;
    const opts = Array.from(primary.options);
    const match = opts.find(o => o.value === mapping.output && !o.disabled);
    if (!match) return false;
    primary.value = mapping.output;
    primary.dispatchEvent(new Event('change'));
    if (mapping.sub) {
        setTimeout(() => {
            const sub = document.getElementById('subOutput');
            if (!sub) return;
            const subMatch = Array.from(sub.options).find(o => o.value === mapping.sub || o.text === mapping.sub);
            if (subMatch) { sub.value = subMatch.value; sub.dispatchEvent(new Event('change')); }
        }, 0);
    }
    return true;
}

async function runFirstRunCheck() {
    if (isFirstRunDone()) return;
    let detected = [];
    let detectedHardwareLabel = '';   // E.g. "Acer SpatialLabs View 27" — surfaced at the top of the picker.
    try {
        const result = await window.api.displayGetSettings?.();
        if (result?.success && Array.isArray(result.profiles)) {
            detected = result.profiles.filter(p => p.detected && p.id !== 'default' && DISPLAY_TO_OUTPUT[p.id]);
            // Pull the manufacturer/model string if the backend supplied one.
            // displayGetSettings can include `hardware_label` / `model` /
            // `detected_label` per profile — surface whichever exists.
            for (const p of detected) {
                const hw = p.hardware_label || p.detected_label || p.model || p.display_name;
                if (hw) { detectedHardwareLabel = hw; break; }
            }
        }
    } catch {}

    // High-confidence single match → set silently.
    if (detected.length === 1) {
        if (applyDisplayMappingToGlobalSelects(detected[0].id)) {
            markFirstRunDone();
            return;
        }
    }

    const detectedIds = new Set(detected.map(p => p.id));
    showFirstRunPicker(detectedIds, detectedHardwareLabel, detected.length > 1
        ? "Stereopticon found a few possible stereo displays. Pick the one you're using:"
        : "Stereopticon couldn't auto-detect a stereo display. Pick what you have:");
}

function showFirstRunPicker(detectedIds, detectedHardwareLabel, message) {
    const modal = document.getElementById('firstRunOutputModal');
    const msg   = document.getElementById('firstRunMessage');
    const opts  = document.getElementById('firstRunOptions');
    if (!modal || !opts) return;
    // Surface the actual detected hardware (if any) above the message so the
    // user knows what we saw before they make their pick.
    const hardwareBanner = detectedHardwareLabel
        ? `<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:rgba(201,138,75,0.08);border:1px solid var(--teal-border);border-radius:8px;margin-bottom:10px;">
              <span style="font-size:14px;">🔍</span>
              <span style="flex:1;font-size:11.5px;line-height:1.45;">
                <span style="color:var(--text-dim);font-family:var(--font-display);font-size:9.5px;letter-spacing:1px;text-transform:uppercase;">Detected hardware</span><br>
                <span style="color:var(--teal);font-weight:500;">${detectedHardwareLabel}</span>
              </span>
           </div>`
        : '';
    msg.innerHTML = hardwareBanner + `<div>${message}</div>`;
    const presets = [
        { id: 'sbs',              icon: '▥', title: 'Side-by-side',           sub: 'Any monitor, via a passive 3D viewer or HMD passthrough' },
        { id: 'anaglyph',         icon: '◍', title: 'Anaglyph (red/cyan)',    sub: 'Any monitor + red/cyan glasses' },
        { id: 'vr_native',        icon: '⊡', title: 'VR headset',             sub: 'OpenVR / OpenXR HMD via SteamVR' },
        { id: 'sr_weave',         icon: '◈', title: 'Simulated Reality display', sub: 'Acer SpatialLabs / Sony Spatial Reality / other glasses-free SR panel (4-way weave)' },
        { id: 'frame_sequential', icon: '▣', title: 'Active shutter 3D',      sub: 'Nvidia 3D Vision / 120 Hz shutter glasses' },
        { id: 'tab',              icon: '▤', title: 'Top-and-bottom',         sub: 'Frame-packed 3D over HDMI 1.4' },
    ];
    opts.innerHTML = presets.map(p => `
        <button class="first-run-option" data-id="${p.id}"
            style="display:flex;align-items:flex-start;gap:12px;padding:12px 14px;background:rgba(237,230,218,0.02);border:1px solid ${detectedIds.has(p.id) ? 'var(--teal-border)' : 'var(--glass-border)'};border-radius:10px;color:inherit;cursor:pointer;text-align:left;transition:all 0.15s;">
            <span style="font-size:16px;line-height:1;margin-top:1px;">${p.icon}</span>
            <span style="flex:1;">
                <span style="display:block;font-family:var(--font-display);font-size:13px;font-weight:600;color:var(--text-primary);margin-bottom:2px;">${p.title}${detectedIds.has(p.id) ? ' <span style=\"font-size:9px;color:var(--teal);letter-spacing:1px;\">DETECTED</span>' : ''}</span>
                <span style="display:block;font-size:11px;color:var(--text-dim);">${p.sub}</span>
            </span>
        </button>`).join('');
    opts.querySelectorAll('.first-run-option').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.id;
            applyDisplayMappingToGlobalSelects(id);
            markFirstRunDone();
            modal.style.display = 'none';
        });
        btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(237,230,218,0.06)'; });
        btn.addEventListener('mouseleave', () => { btn.style.background = 'rgba(237,230,218,0.02)'; });
    });
    modal.style.display = 'flex';
}

window.firstRunDismiss = function(markDone) {
    if (markDone) markFirstRunDone();
    document.getElementById('firstRunOutputModal').style.display = 'none';
};

// Manually re-trigger the first-run picker from Settings — clears the
// "done" flag so the probe re-runs, then closes Settings and shows the
// picker (or silently auto-applies if there's a single confident match).
window.redoFirstRunPicker = function() {
    try { localStorage.removeItem(FIRST_RUN_KEY); } catch {}
    try { closeSettingsModal?.(); } catch {}
    setTimeout(() => { try { runFirstRunCheck(); } catch {} }, 100);
};

// Kick off the first-run check shortly after page load — wait long enough
// for the output dropdowns to have populated their options (otherwise
// applyDisplayMappingToGlobalSelects has nothing to match against).
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => { try { runFirstRunCheck(); } catch {} }, 400);
});

// ── Global output settings persistence (Phase 2a) ─────────────
// primaryOutput + subOutput values live in localStorage as a global app
// setting. Restored on app load; written on every change.
const SETTINGS_OUTPUT_KEY = 'stereopticon.output';
function loadGlobalOutputSettings() {
    try {
        const raw = localStorage.getItem(SETTINGS_OUTPUT_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch { return null; }
}
function saveGlobalOutputSettings() {
    const primary = document.getElementById('primaryOutput');
    const sub     = document.getElementById('subOutput');
    if (!primary) return;
    try {
        localStorage.setItem(SETTINGS_OUTPUT_KEY, JSON.stringify({
            primary: primary.value || '',
            sub:     sub?.value     || '',
        }));
    } catch {}
}
function applyStoredGlobalOutputSettings() {
    const stored = loadGlobalOutputSettings();
    if (!stored) return;
    const primary = document.getElementById('primaryOutput');
    const sub     = document.getElementById('subOutput');
    if (primary && stored.primary) {
        // Wait for primary dropdown to be populated before restoring.
        const restore = () => {
            if (![...primary.options].some(o => o.value === stored.primary)) {
                setTimeout(restore, 80);
                return;
            }
            primary.value = stored.primary;
            primary.dispatchEvent(new Event('change'));
            if (sub && stored.sub) {
                setTimeout(() => {
                    if ([...sub.options].some(o => o.value === stored.sub)) {
                        sub.value = stored.sub;
                        sub.dispatchEvent(new Event('change'));
                    }
                }, 60);
            }
        };
        restore();
    }
}
document.addEventListener('DOMContentLoaded', () => {
    const primary = document.getElementById('primaryOutput');
    const sub     = document.getElementById('subOutput');
    primary?.addEventListener('change', saveGlobalOutputSettings);
    sub    ?.addEventListener('change', saveGlobalOutputSettings);
    // Restore after the page initial render has populated the dropdown opts.
    setTimeout(applyStoredGlobalOutputSettings, 200);
});
 
async function renderMonitorsTab() {
    const body = document.getElementById('settingsBody');
    body.innerHTML = '<div style="color:var(--text-dim);font-size:12px;padding:12px 0;">Detecting display hardware...</div>';
 
    let result;
    try { result = await window.api.displayGetSettings(); }
    catch (e) { body.innerHTML = `<div style="color:var(--danger);font-size:12px;">Error: ${e.message}</div>`; return; }
 
    if (!result.success) {
        body.innerHTML = `<div style="color:var(--danger);font-size:12px;">${result.message}</div>`;
        return;
    }
 
    const profiles = result.profiles;
    const detected = profiles.filter(p => p.detected);
    const undetected = profiles.filter(p => !p.detected);
 
    let html = '';
 
    // ── Detected hardware ──
    if (detected.length === 0) {
        html += `
        <div style="padding:14px 16px;background:rgba(255,255,255,0.02);border:1px solid var(--glass-border);border-radius:10px;margin-bottom:16px;">
            <div style="font-size:13px;color:var(--text-dim);text-align:center;">No supported display hardware detected.</div>
            <div style="font-size:11px;color:var(--text-dim);text-align:center;margin-top:6px;opacity:0.6;">Settings appear here automatically when supported hardware is connected.</div>
        </div>`;
    } else {
        for (const profile of detected) {
            html += buildProfileCard(profile, true);
        }
    }
 
    // ── Not detected (collapsed list so users know what's supported) ──
    if (undetected.length > 0) {
        html += `<details style="margin-top:8px;">
            <summary style="font-size:10px;color:var(--text-dim);cursor:pointer;padding:4px 0;font-family:var(--font-display);text-transform:uppercase;letter-spacing:1px;">
                Also supported (not detected)
            </summary>
            <div style="margin-top:8px;display:flex;flex-direction:column;gap:6px;">`;
        for (const profile of undetected) {
            html += `<div style="padding:8px 12px;background:rgba(255,255,255,0.01);border:1px solid var(--glass-border);border-radius:8px;opacity:0.5;display:flex;align-items:center;gap:8px;">
                <span style="font-size:14px;">${profile.icon}</span>
                <span style="font-size:12px;color:var(--text-dim);">${profile.label}</span>
                <span style="margin-left:auto;font-size:10px;color:var(--text-dim);">Not detected</span>
            </div>`;
        }
        html += '</div></details>';
    }
 
    body.innerHTML = html;
 
    // Wire up toggles
    body.querySelectorAll('[data-display-profile]').forEach(el => {
        el.addEventListener('change', async function() {
            const profileId = this.dataset.displayProfile;
            const settingId = this.dataset.displaySetting;
            const value     = this.checked;
            const statusEl  = document.getElementById(`display-status-${profileId}-${settingId}`);
 
            if (statusEl) statusEl.textContent = 'Saving...';
 
            const res = await window.api.displayWriteSetting(profileId, settingId, value);
 
            if (statusEl) {
                if (res.success) {
                    statusEl.textContent = '✓ Saved';
                    statusEl.style.color = 'var(--teal)';
                    setTimeout(() => { statusEl.textContent = ''; }, 2000);
                } else if (res.needsAdmin) {
                    statusEl.textContent = '⚠ Needs admin';
                    statusEl.style.color = 'var(--warn)';
                    // Revert the toggle visually since the write failed
                    this.checked = !value;
                    // Show a clear explanation
                    showAdminWarning();
                } else {
                    statusEl.textContent = `✗ ${res.message || 'Failed'}`;
                    statusEl.style.color = 'var(--danger)';
                    this.checked = !value;
                }
            }
        });
    });
}
 
function buildProfileCard(profile, detected) {
    const headerColor = detected ? 'var(--teal)' : 'var(--text-dim)';
    let rows = '';
 
    for (const s of profile.settings) {
        const currentVal = profile.values[s.id];
        const isOn = currentVal === s.onValue;
 
        rows += `
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
            <div style="flex:1;min-width:0;">
                <div style="font-size:13px;color:var(--text-primary);margin-bottom:2px;">${s.label}</div>
                <div style="font-size:10px;color:var(--text-dim);line-height:1.4;">${s.tip}</div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
                <span id="display-status-${profile.id}-${s.id}" style="font-size:10px;min-width:60px;text-align:right;"></span>
                <label class="geo-toggle">
                    <input type="checkbox"
                        data-display-profile="${profile.id}"
                        data-display-setting="${s.id}"
                        ${isOn ? 'checked' : ''}
                        ${currentVal === null ? 'disabled title="Value not found in registry"' : ''}>
                    <span class="geo-toggle-track"></span>
                </label>
            </div>
        </div>`;
    }
 
    return `
    <div class="card" style="margin-bottom:16px;padding:14px 16px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
            <span style="font-size:20px;">${profile.icon}</span>
            <div>
                <div style="font-family:var(--font-display);font-size:13px;font-weight:700;color:${headerColor};">${profile.label}</div>
                <div style="font-size:10px;color:var(--text-dim);">
                    ${detected
                        ? '<span style="color:var(--ok);">● Detected</span>'
                        : '<span style="color:var(--text-dim);">○ Not detected</span>'}
                </div>
            </div>
        </div>
        ${rows}
        <div style="margin-top:10px;padding:7px 10px;background:rgba(255,255,255,0.02);border-radius:6px;font-size:10px;color:var(--text-dim);line-height:1.5;">
            ⓘ Changes write to the Windows registry and take effect immediately.
            Some changes may require restarting the SpatialLabs service or your display.
        </div>
    </div>`;
}
 
function showAdminWarning() {
    const body = document.getElementById('settingsBody');
    const existing = document.getElementById('admin-warning');
    if (existing) return;
    const div = document.createElement('div');
    div.id = 'admin-warning';
    div.style.cssText = 'padding:10px 12px;background:rgba(230,126,34,0.08);border:1px solid rgba(230,126,34,0.3);border-radius:8px;margin-bottom:12px;font-size:11px;color:rgba(230,126,34,0.9);line-height:1.6;';
    div.innerHTML = `<strong>Administrator required</strong><br>
        Writing to <code style="font-size:10px;">HKEY_LOCAL_MACHINE</code> requires admin privileges.<br>
        Right-click Stereopticon → <em>Run as administrator</em>, then try again.`;
    body.prepend(div);
}

// Maps hardware detection profile IDs → display-dropdown values. Add new
// entries when adding new DISPLAY_PROFILES in modules/displaySettings.js.
const DETECTED_HARDWARE_TO_DISPLAY = {
    acer_spatiallabs:      'sr_display',
    samsung_odyssey_3d:    'sr_display',
    asus_spatial_vision:   'sr_display',
    looking_glass:         'looking_glass',
    xreal_one:             'ar_glasses',
};

async function autoSelectDisplayFromDetection() {
    try {
        const result = await window.api.displayGetSettings?.();
        const detected = result?.profiles?.find(p => p.detected);
        if (!detected) return;
        const target = DETECTED_HARDWARE_TO_DISPLAY[detected.id];
        if (!target) return;
        // Don't override an already-selected display.
        if (selectedDisplay && selectedDisplay !== 'none') return;
        const opt = document.querySelector(`#displayDropdown .dd-option[data-value="${target}"]`);
        if (opt) opt.click();   // reuses the existing click handler that wires output/etc.
    } catch (e) {
        console.warn('[autoDetect] display detection failed:', e.message);
    }
}

// ─── Custom select component ─────────────────────────────────
// Native <select> open-list ignores accent-color on Windows and shows the
// OS accent (bright blue). We hide the native element and overlay our own
// popover; the underlying <select> still carries form state so all existing
// change-event handlers keep working unmodified.
function customizeSelect(sel) {
    if (!sel || sel.dataset.cselReady) return;
    sel.dataset.cselReady = '1';

    const wrap = document.createElement('div');
    wrap.className = 'csel';
    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(sel);
    sel.style.display = 'none';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'csel-btn';
    btn.innerHTML = '<span class="csel-label"></span><span class="csel-arrow">▾</span>';
    wrap.appendChild(btn);

    const list = document.createElement('div');
    list.className = 'csel-list';
    wrap.appendChild(list);

    function refreshLabel() {
        const opt = sel.options[sel.selectedIndex];
        btn.querySelector('.csel-label').textContent = opt ? opt.text : '';
        btn.disabled = sel.disabled;
    }
    refreshLabel();

    sel.addEventListener('change', refreshLabel);
    new MutationObserver(refreshLabel).observe(sel, { childList: true, attributes: true, attributeFilter: ['value', 'disabled'] });

    function closeList() { wrap.classList.remove('open'); list.classList.remove('open', 'flip-up'); }

    function openList() {
        list.innerHTML = '';
        for (const o of sel.options) {
            const item = document.createElement('div');
            item.className = 'csel-item'
                + (o.value === sel.value ? ' selected' : '')
                + (o.disabled ? ' disabled' : '');
            item.textContent = o.text;
            item.dataset.value = o.value;
            if (!o.disabled) {
                item.onclick = (ev) => {
                    ev.stopPropagation();
                    sel.value = o.value;
                    sel.dispatchEvent(new Event('change', { bubbles: true }));
                    refreshLabel();
                    closeList();
                };
            }
            list.appendChild(item);
        }
        wrap.classList.add('open');
        list.classList.add('open');
        const rect = btn.getBoundingClientRect();
        const listH = list.offsetHeight;
        if (rect.bottom + listH + 8 > window.innerHeight && rect.top > listH + 8) {
            list.classList.add('flip-up');
        }
    }

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (sel.disabled) return;
        wrap.classList.contains('open') ? closeList() : openList();
    });

    document.addEventListener('click', closeList);
}

function customizeAllPendingSelects(root = document) {
    root.querySelectorAll('select.csel-target:not([data-csel-ready])').forEach(customizeSelect);
}

// ─── Theme (light/dark) ──────────────────────────────────────
// Persistence: localStorage('stereopticon.theme') = 'light' | 'dark' | (unset → system).
// Applies via [data-theme] on <html>; CSS variables in index.html switch on that.
function updateThemeButtonGlyph(theme) {
    const btn = document.getElementById('btnTheme');
    if (!btn) return;
    const glyph = theme === 'light' ? '◑' : '◐';
    const iconSpan = btn.querySelector('.icon');
    if (iconSpan) iconSpan.textContent = glyph;
    else          btn.textContent = glyph;  // legacy titlebar-icon-btn fallback
}

window.toggleTheme = function() {
    const cur = document.documentElement.getAttribute('data-theme');
    const sysLight = window.matchMedia?.('(prefers-color-scheme: light)').matches;
    const next = !cur ? (sysLight ? 'dark' : 'light') : (cur === 'dark' ? 'light' : 'dark');
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('stereopticon.theme', next); } catch {}
    updateThemeButtonGlyph(next);
};

(function applyStoredTheme(){
    try {
        const stored = localStorage.getItem('stereopticon.theme');
        if (stored === 'light' || stored === 'dark') {
            document.documentElement.setAttribute('data-theme', stored);
            updateThemeButtonGlyph(stored);
        }
    } catch {}
})();

// ─── GO ──────────────────────────────────────────────────────
function bootstrap() {
    init();
    customizeAllPendingSelects();
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
} else {
    bootstrap();
}

// ─── SHADERGLASS 3D WINDOW ───────────────────────────────────────────────────

// Map display/output IDs to sgOutput values
const DISPLAY_TO_SG_OUTPUT = {
    'sr_weave':           'sr_weave',
    'sbs':                'sbs',
    'tab':                'tab',
    'interleaved':        'interleaved_row',
    'frame_packing':      'frame_packing_1080p',
    'frame_sequential':   null,     // no SG equivalent
    'anaglyph':           'anaglyph_rc',
    'lkg_quilt':          'lkg_quilt',
    'ar_headset':         'sbs',
    'vr_native':          null,
};

const SG_INPUT_LABELS  = { sbs:'SBS', sbs_half:'SBS Half', tab:'TAB', tab_half:'TAB Half', interleaved_row:'Row Interleaved', interleaved_col:'Col Interleaved', checkerboard:'Checkerboard', frame_sequential:'Frame Sequential', frame_packing:'Frame Packing', anaglyph_rc:'Anaglyph R/C', anaglyph_gm:'Anaglyph G/M', anaglyph_ab:'Anaglyph A/B', mono:'Mono' };
const SG_OUTPUT_LABELS = { sr_weave:'SR Weave', sbs:'SBS', tab:'TAB', interleaved_row:'Row Interleaved', interleaved_col:'Col Interleaved', checkerboard:'Checkerboard', frame_packing_1080p:'Frame Packing 1080p', frame_packing_720p:'Frame Packing 720p', anaglyph_rc:'Anaglyph R/C', anaglyph_gm:'Anaglyph G/M', anaglyph_ab:'Anaglyph A/B', lkg_quilt:'LKG Quilt' };

let sgPulfrichActive = false;

function getSgShaderChain(input, output, pulfrich) {
    const shaders = [];
    if (pulfrich) shaders.push({ label: 'Pulfrich_to_SBS_or_TAB', cls: 'purple' });
    const isAnagIn = input.startsWith('anaglyph');
    if (isAnagIn) shaders.push({ label: 'Anaglyph_to_SBS_or_TAB', cls: 'orange' });
    if (output === 'sr_weave') shaders.push({ label: '3DGameBridge', cls: 'orange' });
    if (output === 'lkg_quilt') shaders.push({ label: '3DGameBridge (LKG)', cls: 'orange' });
    if (output?.startsWith('frame_packing') || output === 'sr_weave') shaders.push({ label: '3DtoElse', cls: 'orange' });
    return shaders;
}

function updateSgConvertBadge() {
    const input   = document.getElementById('sgInput')?.value || '';
    const output  = document.getElementById('sgOutput')?.value || '';
    const badge   = document.getElementById('sgConvertBadge');
    if (!badge) return;

    const shaders = getSgShaderChain(input, output, sgPulfrichActive);
    const inLabel  = SG_INPUT_LABELS[input]  || input;
    const outLabel = SG_OUTPUT_LABELS[output] || output;

    let parts = [`<span class="sg-chip">${inLabel}</span>`];
    shaders.forEach(s => {
        parts.push(`<span class="sg-arrow-text">→</span>`);
        parts.push(`<span class="sg-chip ${s.cls}">${s.label}</span>`);
    });
    parts.push(`<span class="sg-arrow-text">→</span>`);
    parts.push(`<span class="sg-chip teal">${outLabel}</span>`);
    badge.innerHTML = parts.join('');
    saveSgPrefs();
}

function togglePulfrich() {
    sgPulfrichActive = !sgPulfrichActive;
    const row = document.getElementById('sgPulfrichRow');
    const tog = document.getElementById('sgPulfrichToggle');
    const sub = document.getElementById('sgPulfrichSub');
    row?.classList.toggle('active', sgPulfrichActive);
    tog?.classList.toggle('on', sgPulfrichActive);
    sub?.classList.toggle('visible', sgPulfrichActive);
    updateSgConvertBadge();
}





// Auto-select sgOutput when the main display dropdown changes
function syncSgOutputToDisplay() {
    const primaryVal = primarySelect?.value;
    if (!primaryVal) return;
    const sgVal = DISPLAY_TO_SG_OUTPUT[primaryVal];
    if (!sgVal) return;
    const sgOut = document.getElementById('sgOutput');
    if (!sgOut) return;
    // Check the option exists before setting
    const opt = Array.from(sgOut.options).find(o => o.value === sgVal);
    if (opt) {
        sgOut.value = sgVal;
        const note = document.getElementById('sgOutputNote');
        if (note) note.textContent = '— from display setting';
        updateSgConvertBadge();
    }
}

// Call syncSgOutputToDisplay whenever primary output changes
primarySelect?.addEventListener('change', () => {
    if (document.getElementById('sgPanel')?.classList.contains('open')) {
        setTimeout(syncSgOutputToDisplay, 10);
    }
});

async function checkSgInstalled() {
    const badge  = document.getElementById('sgStatusBadge');
    if (!badge) return;
    try {
        const result = await window.api.checkShaderGlass?.();
        badge.style.display = result?.installed ? 'none' : 'inline-flex';
        const launchBtn = document.getElementById('sgLaunchBtn');
        if (launchBtn) launchBtn.disabled = false;
    } catch {
        badge.style.display = 'none';
    }
}

async function launchShaderGlass() {
    const input   = document.getElementById('sgInput')?.value;
    const output  = document.getElementById('sgOutput')?.value;
    const pulfrichMode = document.getElementById('sgPulfrichMode')?.value;
    const pulfrichEye  = document.getElementById('sgPulfrichEye')?.value;
    const btn    = document.getElementById('sgLaunchBtn');
    const status = document.getElementById('sgStatus');
    if (btn) btn.disabled = true;
    if (status) status.textContent = 'Launching…';
    try {
        const result = await window.api.launchShaderGlass?.({ input, output, pulfrich: sgPulfrichActive, pulfrichMode, pulfrichEye });
        if (result?.success) {
            if (status) status.textContent = '✓ ShaderGlass launched';
            setTimeout(() => { if (status) status.textContent = ''; }, 3000);
        } else {
            if (status) status.textContent = result?.error || 'Launch IPC not yet connected';
        }
    } catch (e) {
        if (status) status.textContent = `⚠ ${e.message}`;
    } finally {
        if (btn) btn.disabled = false;
    }
}

function saveSgPrefs() {
    try {
        window.api.saveAppSetting?.('shaderglass_prefs', JSON.stringify({
            input:   document.getElementById('sgInput')?.value,
            output:  document.getElementById('sgOutput')?.value,
            pulfrich: sgPulfrichActive,
        }));
    } catch {}
}

function loadSgPrefs() {
    try {
        const raw = window.api.getAppSetting?.('shaderglass_prefs');
        if (!raw) return;
        const p = JSON.parse(raw);
        if (p.input)  { const el = document.getElementById('sgInput');  if (el) el.value = p.input; }
        if (p.output) { const el = document.getElementById('sgOutput'); if (el) el.value = p.output; }
        if (p.pulfrich !== undefined && p.pulfrich !== sgPulfrichActive) togglePulfrich();
    } catch {}
}




async function runScanAll() {
    const btn = document.getElementById('scanAllBtn');
    if (btn) { btn.style.animation = 'spin 1s linear infinite'; btn.style.display = 'inline-flex'; btn.title = 'Scanning…'; }
    try {
            const targets = gamesData.map(g => ({
        id:          g.id,
        title:       g.title,
        exeName:     g.exe_name || g.fixes?.[0]?.exe_name || null,
        steamAppId:  g.steam_app_id || null,   // ← ADD THIS
    }));
        window._scannedPaths = await window.api.gameScanAll(targets);
        // Update current game path if it wasn't set
        if (selectedGame) autoScanGamePath(selectedGame);
        // Re-render sidebar so availability tiers update
        renderSidebar(gamesData);
        const n = Object.keys(window._scannedPaths || {}).length;
        if (btn) btn.title = `Scan complete — ${n} game${n !== 1 ? 's' : ''} found`;
    } catch (e) {
        if (btn) btn.title = `Scan failed: ${e.message}`;
    } finally {
        if (btn) btn.style.animation = '';
    }
}

// ─── 3D BUTTON ───────────────────────────────────────────────────────────────
document.getElementById('btn3D')?.addEventListener('click', async () => {
    // Try to launch ShaderGlass if IPC available, otherwise open download page
    try {
        const result = await window.api.launchShaderGlass?.({});
        if (!result || result.error) {
            window.api.openUrl('https://github.com/mausimus/ShaderGlass/releases');
        }
    } catch {
        window.api.openUrl('https://github.com/mausimus/ShaderGlass/releases');
    }
});// ─── SCREENSHOT HELPERS ──────────────────────────────────────
window.updateScreenshotPreview = function() {
    const before   = document.getElementById('ss-before')?.checked;
    const after    = document.getElementById('ss-after')?.checked;
    const fmt      = document.getElementById('ss-format')?.value || 'PNG';
    const inFolder = document.getElementById('ss-keep-in-folder')?.checked;
    const preview  = document.getElementById('ss-preview');
    if (!preview) return;
    let lines = [];
    if (!before && !after) lines.push('📷 Screenshots disabled');
    else {
        if (before) lines.push(`📷 Save BEFORE effects (${fmt})`);
        if (after)  lines.push(`📷 Save AFTER effects (${fmt})`);
    }
    lines.push(inFolder ? '📁 Saved to game folder' : '📁 Default ReShade screenshot folder');
    preview.innerHTML = lines.join('<br>');
};

function getScreenshotOptions() {
    const before   = document.getElementById('ss-before')?.checked  ?? false;
    const after    = document.getElementById('ss-after')?.checked   ?? true;
    const fmt      = document.getElementById('ss-format')?.value    || 'PNG';
    const inFolder = document.getElementById('ss-keep-in-folder')?.checked ?? true;
    // ReShade SaveBeforeUseEffects: 0=off, 1=before+after both, 2=before only
    let beforeEffects = 0;
    if (before && after) beforeEffects = 1;
    else if (before)     beforeEffects = 2;
    return { savePath: inFolder ? '.\ ' : undefined, format: fmt, beforeEffects };
}