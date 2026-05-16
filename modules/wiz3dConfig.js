'use strict';
/**
 * modules/wiz3dConfig.js
 *
 * Shared XML patcher for the family of wiz3D config files:
 *   wiz3D_Config.xml     (used by DX7/8/9/10-11/12/Vulkan wrappers + opengl-qbs)
 *   3DVision_Config.xml  (used by the 3D Vision Direct Mode handler)
 *   HD3D_Config.xml      (used by the AMD HD3D handler)
 *
 * Philosophy (same as modules/iniEditor.js):
 *   - The XML on disk is the live state.
 *   - We never reformat — only patch matching attribute values + element bodies
 *     in-place. Comments, indentation, schema declarations, ordering all stay.
 *   - Each file's path is provided by the caller (the adapter knows where it lives).
 *
 * The wiz3D format is small enough (~440 lines max) that regex-based patching
 * handles every case we care about without pulling in a full XML library.
 */

const fs = require('fs');

/**
 * Patch a single attribute on an element matching `tag`.
 *   <Tag Value="OLD"/>   →   <Tag Value="NEW"/>
 * Returns { patched: bool, before, after } (for caller logging).
 */
function setElementAttribute(xml, tag, attr, value) {
    const re = new RegExp(`(<${escape(tag)}\\s+${escape(attr)}=")([^"]*)("\\s*/?>)`, 'm');
    const m = re.exec(xml);
    if (!m) return { patched: false, before: null, after: null, xml };
    const before = m[2];
    const after  = String(value);
    if (before === after) return { patched: true, before, after, xml };
    const patched = xml.replace(re, `$1${after}$3`);
    return { patched: true, before, after, xml: patched };
}

/**
 * Patch a nested attribute, scoped to a parent element.
 *   <Parent>
 *     <ChildTag Value="OLD"/>
 *   </Parent>
 * Restricts the replacement to the FIRST occurrence inside the first <Parent>...</Parent> block.
 */
function setNestedAttribute(xml, parent, child, attr, value) {
    const parentRe = new RegExp(`(<${escape(parent)}\\b[^>]*>)([\\s\\S]*?)(</${escape(parent)}>)`, 'm');
    const pm = parentRe.exec(xml);
    if (!pm) return { patched: false, xml };
    const inner = pm[2];
    const innerRe = new RegExp(`(<${escape(child)}\\s+${escape(attr)}=")([^"]*)("\\s*/?>)`, 'm');
    const cm = innerRe.exec(inner);
    if (!cm) return { patched: false, xml };
    const before = cm[2];
    const after  = String(value);
    if (before === after) return { patched: true, before, after, xml };
    const patchedInner = inner.replace(innerRe, `$1${after}$3`);
    const patchedXml   = xml.replace(parentRe, `$1${patchedInner}$3`);
    return { patched: true, before, after, xml: patchedXml };
}

/**
 * Patch a value inside an indexed nested element:
 *   <Presets>
 *     <Preset Index="0">
 *       <Field Value="OLD"/>
 *     </Preset>
 *   </Presets>
 * @param presetIndex - which Preset Index to target (e.g. 0, 1, 2)
 */
function setPresetAttribute(xml, presetIndex, child, attr, value) {
    const re = new RegExp(
        `(<Preset\\s+Index="${presetIndex}"\\s*>)([\\s\\S]*?)(</Preset>)`, 'm');
    const m = re.exec(xml);
    if (!m) return { patched: false, xml };
    const inner = m[2];
    const innerRe = new RegExp(`(<${escape(child)}\\s+${escape(attr)}=")([^"]*)("\\s*/?>)`, 'm');
    const cm = innerRe.exec(inner);
    if (!cm) return { patched: false, xml };
    const before = cm[2];
    const after  = String(value);
    if (before === after) return { patched: true, before, after, xml };
    const patchedInner = inner.replace(innerRe, `$1${after}$3`);
    const patchedXml   = xml.replace(re, `$1${patchedInner}$3`);
    return { patched: true, before, after, xml: patchedXml };
}

function escape(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/**
 * Read → patch → write a wiz3D config file. `patches` is a list of
 * { kind: 'attr'|'nested'|'preset', ...args } that map to the helpers above.
 *
 * Example:
 *   applyPatches('C:\\game\\wiz3D_Config.xml', [
 *     { kind: 'attr',    tag: 'OutputMethodDll', attr: 'Value', value: 'SimulatedRealityWeaveOutput' },
 *     { kind: 'attr',    tag: 'EnableStereo',    attr: 'Value', value: 1 },
 *     { kind: 'preset',  presetIndex: 0, child: 'AutoFocusEnable', attr: 'Value', value: 1 },
 *     { kind: 'preset',  presetIndex: 0, child: 'StereoBase',      attr: 'Value', value: 0.18 },
 *     { kind: 'preset',  presetIndex: 0, child: 'One_div_ZPS',     attr: 'Value', value: 0.12 },
 *     { kind: 'nested',  parent: 'SimulatedRealityWeaveOutput', child: 'sRGB', attr: 'Value', value: 1 },
 *   ]);
 *
 * Returns { success, applied: [string], warnings: [string], errors: [string] }.
 */
function applyPatches(xmlPath, patches) {
    const result = { success: true, applied: [], warnings: [], errors: [] };
    if (!fs.existsSync(xmlPath)) {
        result.success = false;
        result.errors.push(`wiz3D config not found: ${xmlPath}`);
        return result;
    }

    let xml = fs.readFileSync(xmlPath, 'utf8');
    let mutated = false;

    for (const p of patches) {
        let r;
        switch (p.kind) {
            case 'attr':
                r = setElementAttribute(xml, p.tag, p.attr, p.value);
                if (r.patched) {
                    if (r.before !== r.after) {
                        mutated = true;
                        result.applied.push(`${p.tag}@${p.attr}: ${r.before} → ${r.after}`);
                    }
                } else {
                    result.warnings.push(`${p.tag}@${p.attr} not found in ${xmlPath}`);
                }
                xml = r.xml;
                break;
            case 'nested':
                r = setNestedAttribute(xml, p.parent, p.child, p.attr, p.value);
                if (r.patched) {
                    if (r.before !== r.after) {
                        mutated = true;
                        result.applied.push(`${p.parent}/${p.child}@${p.attr}: ${r.before} → ${r.after}`);
                    }
                } else {
                    result.warnings.push(`${p.parent}/${p.child}@${p.attr} not found`);
                }
                xml = r.xml;
                break;
            case 'preset':
                r = setPresetAttribute(xml, p.presetIndex, p.child, p.attr, p.value);
                if (r.patched) {
                    if (r.before !== r.after) {
                        mutated = true;
                        result.applied.push(`Preset[${p.presetIndex}]/${p.child}@${p.attr}: ${r.before} → ${r.after}`);
                    }
                } else {
                    result.warnings.push(`Preset[${p.presetIndex}]/${p.child}@${p.attr} not found`);
                }
                xml = r.xml;
                break;
            default:
                result.warnings.push(`Unknown patch kind: ${p.kind}`);
        }
    }

    if (mutated) {
        try { fs.writeFileSync(xmlPath, xml); }
        catch (e) {
            result.success = false;
            result.errors.push(`Failed to write ${xmlPath}: ${e.message}`);
        }
    }
    return result;
}

// ── Output-DLL map for the two output catalogues ────────────────
// (matches the wiz3d_output_classes blocks in data/tools/wiz3d-*.json)

// Used by wiz3d_wrapper + wiz3d_opengl variants
const OUTPUT_DLL_WRAPPER = {
    'sbs':              'SideBySideOutput',
    'sbs_half':         'SideBySideOutput',
    'anaglyph':         'AnaglyphOutput',
    'interlaced':       'InterlacedOutput',
    'frame_sequential': 'ShutterOutput',
    'sr_weave':         'SimulatedRealityWeaveOutput',
};

// Used by wiz3d_3dvision_dm + wiz3d_hd3d variants (different naming convention,
// the binaries are different — these names match wiz3D's 3D-Vision-DM and HD3D
// modules, not the wrapper output DLLs.)
const OUTPUT_DLL_DM = {
    'sbs':                      'FullSideBySide',
    'sbs_half':                 'HalfSideBySide',
    'tab':                      'FullTopAndBottom',
    'tab_half':                 'HalfTopAndBottom',
    'interleaved':              'RowInterleaved',
    'interleaved_row':          'RowInterleaved',
    'interleaved_col':          'ColumnInterleaved',
    'interleaved_checkerboard': 'Checkerboard',
    'anaglyph':                 'AnaglyphRedCyan',
    'anaglyph_red_cyan':        'AnaglyphRedCyan',
    'anaglyph_green_magenta':   'AnaglyphGreenMagenta',
    'anaglyph_amber_blue':      'AnaglyphAmberBlue',
    'sr_weave':                 'SimulatedRealityWeave',
};

/**
 * Build the canonical patch list for a wiz3D variant from a Stereopticon adapter
 * context. Each adapter wraps this and passes its config file path + output map.
 *
 * userOverrides shape (all optional):
 *   {
 *     separation:   0..0.8     → Preset[0]/StereoBase
 *     convergence:  0..1.0     → Preset[0]/One_div_ZPS
 *     autofocus:    boolean    → Preset[0]/AutoFocusEnable
 *     swap_eyes:    boolean    → SwapEyes
 *     separation_scale: float  → SeparationScale (global multiplier)
 *     sbs_gap:      0..100     → SideBySideOutput/Gap
 *     srgb:         boolean    → SimulatedRealityWeaveOutput/sRGB
 *     enable:       boolean    → EnableStereo
 *   }
 */
function buildPatches({ outputDll, userOverrides = {} }) {
    const patches = [];
    if (outputDll) patches.push({ kind: 'attr', tag: 'OutputMethodDll', attr: 'Value', value: outputDll });

    // Master enable — default on unless explicitly disabled
    if (userOverrides.enable !== undefined) {
        patches.push({ kind: 'attr', tag: 'EnableStereo', attr: 'Value', value: userOverrides.enable ? 1 : 0 });
    } else {
        patches.push({ kind: 'attr', tag: 'EnableStereo', attr: 'Value', value: 1 });
    }

    // Per-preset tuning (Preset 0 = active preset on first run)
    if (userOverrides.separation !== undefined) {
        patches.push({ kind: 'preset', presetIndex: 0, child: 'StereoBase', attr: 'Value', value: userOverrides.separation });
    }
    if (userOverrides.convergence !== undefined) {
        patches.push({ kind: 'preset', presetIndex: 0, child: 'One_div_ZPS', attr: 'Value', value: userOverrides.convergence });
    }
    if (userOverrides.autofocus !== undefined) {
        patches.push({ kind: 'preset', presetIndex: 0, child: 'AutoFocusEnable', attr: 'Value', value: userOverrides.autofocus ? 1 : 0 });
    }

    // Global modifiers
    if (userOverrides.swap_eyes !== undefined) {
        patches.push({ kind: 'attr', tag: 'SwapEyes', attr: 'Value', value: userOverrides.swap_eyes ? 1 : 0 });
    }
    if (userOverrides.separation_scale !== undefined) {
        patches.push({ kind: 'attr', tag: 'SeparationScale', attr: 'Value', value: userOverrides.separation_scale });
    }

    // Per-output extras
    if (userOverrides.sbs_gap !== undefined) {
        patches.push({ kind: 'nested', parent: 'SideBySideOutput', child: 'Gap', attr: 'Value', value: userOverrides.sbs_gap });
    }
    if (userOverrides.srgb !== undefined) {
        patches.push({ kind: 'nested', parent: 'SimulatedRealityWeaveOutput', child: 'sRGB', attr: 'Value', value: userOverrides.srgb ? 1 : 0 });
    }

    return patches;
}

module.exports = {
    applyPatches,
    setElementAttribute,
    setNestedAttribute,
    setPresetAttribute,
    buildPatches,
    OUTPUT_DLL_WRAPPER,
    OUTPUT_DLL_DM,
};
