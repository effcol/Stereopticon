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

// wiz3D's config files keep commented-out template copies of real settings
// (e.g. <!-- <EnableStereo Value="${enableStereoValue}"/> -->). Searches run
// on a copy with comments blanked to spaces, same length, so they never match
// inside a comment and every position still lines up with the original text.
function maskComments(xml) {
    return xml.replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\r\n]/g, ' '));
}

// Span of the attribute value in the first <tag attr="..."> between from and to.
function findAttr(masked, tag, attr, from = 0, to = masked.length) {
    const re = new RegExp(`<${escape(tag)}\\s+${escape(attr)}="([^"]*)"\\s*/?>`, 'g');
    re.lastIndex = from;
    const m = re.exec(masked);
    if (!m || m.index >= to) return null;
    const start = m.index + m[0].indexOf('"') + 1;
    return { start, end: start + m[1].length };
}

// Inner span of the first element whose opening tag matches openPattern.
function findBlock(masked, openPattern, closeTag) {
    const open = new RegExp(openPattern).exec(masked);
    if (!open) return null;
    const innerStart = open.index + open[0].length;
    const close = masked.indexOf(`</${closeTag}>`, innerStart);
    return close < 0 ? null : { start: innerStart, end: close };
}

function setSpan(xml, span, value) {
    const before = xml.slice(span.start, span.end);
    const after  = String(value);
    if (before === after) return { patched: true, before, after, xml };
    return { patched: true, before, after, xml: xml.slice(0, span.start) + after + xml.slice(span.end) };
}

/**
 * Patch a single attribute on an element matching `tag`.
 *   <Tag Value="OLD"/>   →   <Tag Value="NEW"/>
 * Returns { patched: bool, before, after, xml } (for caller logging).
 */
function setElementAttribute(xml, tag, attr, value) {
    const span = findAttr(maskComments(xml), tag, attr);
    return span ? setSpan(xml, span, value) : { patched: false, before: null, after: null, xml };
}

/**
 * Patch a nested attribute, scoped to the first <Parent>...</Parent> block.
 */
function setNestedAttribute(xml, parent, child, attr, value) {
    const masked = maskComments(xml);
    const block = findBlock(masked, `<${escape(parent)}\\b[^>]*>`, parent);
    const span = block && findAttr(masked, child, attr, block.start, block.end);
    return span ? setSpan(xml, span, value) : { patched: false, xml };
}

/**
 * Patch a value inside <Preset Index="N"> ... </Preset>.
 */
function setPresetAttribute(xml, presetIndex, child, attr, value) {
    const masked = maskComments(xml);
    const block = findBlock(masked, `<Preset\\s+Index="${presetIndex}"\\s*>`, 'Preset');
    const span = block && findAttr(masked, child, attr, block.start, block.end);
    return span ? setSpan(xml, span, value) : { patched: false, xml };
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
                } else if (!p.optional) {
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
function buildPatches({ outputMode, outputDll, userOverrides = {} }) {
    const patches = [];
    if (outputMode !== undefined && outputMode !== null) {
        // wiz3D 0.4+: one numeric OutputMode for every path. An empty
        // OutputMethodDll lets wiz3D derive the legacy plugin name from it.
        patches.push({ kind: 'attr', tag: 'OutputMode', attr: 'Value', value: outputMode });
        patches.push({ kind: 'attr', tag: 'OutputMethodDll', attr: 'Value', value: '', optional: true });
    } else if (outputDll) {
        patches.push({ kind: 'attr', tag: 'OutputMethodDll', attr: 'Value', value: outputDll });
    }

    // Master enable, on unless explicitly disabled. Only the injector configs have it.
    patches.push({ kind: 'attr', tag: 'EnableStereo', attr: 'Value',
                   value: userOverrides.enable === false ? 0 : 1, optional: true });

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

// ── Output modes (wiz3D 0.4+) ──────────────────────────────────
// The numbering is shared by every wiz3D render path; see wiz3D's
// Shared/OutputModeNames.h. Stereopticon output ids → wiz3D OutputMode.
const OUTPUT_MODE = {
    sbs:                       1,   // Half Side-by-Side
    sbs_half:                  1,
    sbs_full:                  2,
    tab:                       3,   // Half Top-and-Bottom
    tab_half:                  3,
    tab_full:                  4,
    anaglyph:                  5,   // Red/Cyan (Dubois)
    anaglyph_red_cyan:         5,
    interleaved:               6,   // Row interleaved
    interleaved_row:           6,
    interleaved_col:           7,
    interleaved_column:        7,
    interleaved_checkerboard:  8,
    sr_weave:                  9,   // Simulated Reality weave
};

function outputModeFor(outputId) {
    return outputId ? OUTPUT_MODE[outputId] : undefined;
}

// Config file each wiz3D fix type reads.
const CONFIG_FILE = {
    wiz3d_wrapper:     'wiz3D_Config.xml',
    wiz3d_opengl:      'wiz3D_Config.xml',
    wiz3d_hd3d:        'HD3D_Config.xml',
    wiz3d_3dvision_dm: '3DVision_Config.xml',
};

/**
 * Write the launch-time settings (output mode, enable, tuning) into the
 * config file of an installed wiz3D fix. The file sits next to the game's
 * .exe; the install record says where, and the .exe search is the fallback.
 */
function applyLaunchConfig(ctx) {
    const path = require('path');
    const { fix, outputId, gameContext, userOverrides } = ctx;
    const result = { success: true, applied: [], errors: [], warnings: [] };
    const configFile = CONFIG_FILE[fix?.type];
    if (!configFile) return result;
    if (!gameContext?.gamePath) {
        result.warnings.push(`${fix.type}: skipped, no game folder`);
        return result;
    }

    const { getInstallRecord } = require('./installState');
    const { findGameExe } = require('./installer');
    const candidates = [
        getInstallRecord(fix.id)?.installDir,
        (() => { const exe = findGameExe(gameContext.gamePath, gameContext.exeName); return exe && path.dirname(exe); })(),
        gameContext.gamePath,
    ].filter(Boolean);
    const xmlPath = candidates.map(d => path.join(d, configFile)).find(f => fs.existsSync(f));
    if (!xmlPath) {
        result.warnings.push(`${configFile} not found next to the game; install wiz3D for this game first`);
        return result;
    }

    const outputMode = outputModeFor(outputId);
    if (outputId && outputMode === undefined) {
        result.warnings.push(`wiz3D has no output mode for "${outputId}"; leaving the configured mode unchanged`);
    }
    const r = applyPatches(xmlPath, buildPatches({ outputMode, userOverrides: userOverrides?.wiz3d || {} }));
    if (r.success === false) result.success = false;
    result.applied .push(...r.applied);
    result.errors  .push(...r.errors);
    result.warnings.push(...r.warnings);
    return result;
}

module.exports = {
    applyPatches,
    setElementAttribute,
    setNestedAttribute,
    setPresetAttribute,
    buildPatches,
    OUTPUT_DLL_WRAPPER,
    OUTPUT_DLL_DM,
    OUTPUT_MODE,
    CONFIG_FILE,
    outputModeFor,
    applyLaunchConfig,
};
