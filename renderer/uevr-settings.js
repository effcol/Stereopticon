/**
 * renderer/uevr-settings.js
 * Plain JS — include via <script src="uevr-settings.js"></script> in index.html
 * Place this tag BEFORE <script src="renderer.js">
 */

const UEVR_SETTINGS = {
    runtime: {
        key: 'VR_Runtime', label: 'VR Runtime', type: 'select',
        options: [
            { value: 'openvr',  label: 'OpenVR / SteamVR (VRto3D — all 3D displays)' },
            { value: 'openxr',  label: 'OpenXR (XRGameBridge — SR displays, lower latency)' },
        ],
        default: 'openvr',
        notes: 'OpenVR for VRto3D (any 3D display). OpenXR for XRGameBridge on SR displays.',
    },
    rendering_method: {
        key: 'VR_RenderingMethod', label: 'Rendering Method', type: 'select',
        options: [
            { value: '0', label: 'Native Stereo (best quality)' },
            { value: '1', label: 'Synced Sequential (safer, minor perf cost)' },
            { value: '2', label: 'Alternating / AFR (fallback)' },
        ],
        default: '0',
        notes: 'Native Stereo gives best image. Switch to Synced Sequential if game crashes or has artifacts.',
    },
    ghosting_fix: {
        key: 'VR_GhostingFix', label: 'TAA Ghosting Fix', type: 'toggle',
        trueValue: '1', falseValue: '0', default: '0',
        notes: 'Reduces TAA shimmer in Synced Sequential mode.',
    },
    decoupled_pitch: {
        key: 'VR_DecoupledPitch', label: 'Decoupled Pitch', type: 'toggle',
        trueValue: '1', falseValue: '0', default: '1',
        notes: 'Prevents camera tilting with head model. Strongly recommended for flat/3D monitor play.',
    },
    world_scale: {
        key: 'VR_WorldScale', label: 'World Scale',
        type: 'range', min: 0.1, max: 3.0, step: 0.05, default: 1.0,
        notes: '1.0 = default. Lower = shallower stereo effect.',
    },
    camera_forward_offset: {
        key: 'VR_CameraForwardOffset', label: 'Camera Forward Offset',
        type: 'range', min: -500, max: 500, step: 1, default: 0,
        notes: 'Moves camera forward/backward. Useful for 3rd person games.',
    },
    camera_up_offset: {
        key: 'VR_CameraUpOffset', label: 'Camera Up Offset',
        type: 'range', min: -500, max: 500, step: 1, default: 0,
        notes: 'Adjusts camera height.',
    },
    ui_scale: {
        key: 'VR_UIScale', label: 'UI Scale',
        type: 'range', min: 0.1, max: 3.0, step: 0.05, default: 1.0,
        notes: 'Scales in-game UI size in stereo view.',
    },
    controller_injection: {
        key: 'VR_ControllerInjection', label: 'Controller Injection', type: 'toggle',
        trueValue: '1', falseValue: '0', default: '1',
        notes: 'UEVR motion controller emulation. Disable for gamepad-only play.',
    },
    aim_method: {
        key: 'VR_AimMethod', label: 'Aim Method', type: 'select',
        options: [
            { value: '0', label: 'Game default' },
            { value: '1', label: 'Head (look to aim)' },
            { value: '2', label: 'Right controller' },
            { value: '3', label: 'Left controller' },
        ],
        default: '0', notes: 'Which direction aiming follows.',
    },
    movement_orientation: {
        key: 'VR_MovementOrientation', label: 'Movement Orientation', type: 'select',
        options: [
            { value: '0', label: 'Head direction' },
            { value: '1', label: 'Left controller' },
            { value: '2', label: 'Right controller' },
            { value: '3', label: 'HMD local' },
        ],
        default: '0', notes: 'Which direction forward movement follows.',
    },
};

const UEVR_SETTINGS_GROUPS = [
    { label: 'Runtime & Rendering', keys: ['runtime', 'rendering_method', 'ghosting_fix'] },
    { label: 'Camera & World',      keys: ['decoupled_pitch', 'world_scale', 'camera_forward_offset', 'camera_up_offset', 'ui_scale'] },
    { label: 'Input',               keys: ['controller_injection', 'aim_method', 'movement_orientation'] },
];

const UEVR_SHORTCUTS = [
    { category: 'UEVR Menu', shortcuts: [
        { keys: ['Insert'],        action: 'Open / close UEVR in-game menu' },
        { keys: ['Delete'],        action: 'Reset HMD orientation (re-center)' },
        { keys: ['End'],           action: 'Toggle VR mode on/off' },
    ]},
    { category: 'Camera', shortcuts: [
        { keys: ['Numpad 0'],      action: 'Toggle decoupled pitch' },
        { keys: ['Numpad 5'],      action: 'Reset camera offsets' },
        { keys: ['Ctrl', 'Num +'], action: 'Increase world scale' },
        { keys: ['Ctrl', 'Num −'], action: 'Decrease world scale' },
    ]},
    { category: 'Controller', shortcuts: [
        { keys: ['Numpad 7'],      action: 'Toggle left/right hand aim swap' },
        { keys: ['Numpad 8'],      action: 'Cycle aim method' },
        { keys: ['Numpad 9'],      action: 'Cycle movement orientation' },
    ]},
    { category: 'Rendering', shortcuts: [
        { keys: ['F1'],            action: 'Toggle Native Stereo / Synced Sequential' },
    ]},
];

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