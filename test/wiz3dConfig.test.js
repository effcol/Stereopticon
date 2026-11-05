'use strict';
const test   = require('node:test');
const assert = require('node:assert');
const c      = require('../modules/wiz3dConfig');

const XML = [
    '<A>',
    '<!-- <EnableStereo Value="${t}"/> -->',
    '<EnableStereo Value="0"/>',
    '<OutputMode Value="SRWeave"/>',
    '<Presets><Preset Index="0"><!-- <StereoBase Value="9"/> --><StereoBase Value="0.16" /></Preset>',
    '<Preset Index="1"><StereoBase Value="0.1"/></Preset></Presets>',
    '<SideBySideOutput><Gap Value="0"/></SideBySideOutput></A>',
].join('\r\n');

test('attribute patches skip commented-out template lines', () => {
    const r = c.setElementAttribute(XML, 'EnableStereo', 'Value', 1);
    assert.strictEqual(r.before, '0');
    assert.ok(r.xml.includes('<!-- <EnableStereo Value="${t}"/> -->'));
    assert.ok(r.xml.includes('<EnableStereo Value="1"/>'));
});

test('preset patches touch only the requested preset', () => {
    let r = c.setPresetAttribute(XML, 1, 'StereoBase', 'Value', 0.3);
    assert.strictEqual(r.before, '0.1');
    assert.ok(r.xml.includes('<StereoBase Value="0.16" />'));
    r = c.setPresetAttribute(r.xml, 0, 'StereoBase', 'Value', 0.2);
    assert.strictEqual(r.before, '0.16');
    assert.ok(r.xml.includes('<!-- <StereoBase Value="9"/> -->'));
});

test('nested patches stay inside their parent element', () => {
    const r = c.setNestedAttribute(XML, 'SideBySideOutput', 'Gap', 'Value', 5);
    assert.strictEqual(r.before, '0');
    assert.ok(r.xml.includes('<Gap Value="5"/>'));
});

test('missing elements are reported, not invented', () => {
    assert.strictEqual(c.setElementAttribute(XML, 'Nope', 'Value', 1).patched, false);
});

test('output ids map onto wiz3D OutputMode numbers', () => {
    assert.strictEqual(c.outputModeFor('sbs'), 1);
    assert.strictEqual(c.outputModeFor('sbs_full'), 2);
    assert.strictEqual(c.outputModeFor('tab_half'), 3);
    assert.strictEqual(c.outputModeFor('anaglyph_red_cyan'), 5);
    assert.strictEqual(c.outputModeFor('interleaved_col'), 7);
    assert.strictEqual(c.outputModeFor('sr_weave'), 9);
    assert.strictEqual(c.outputModeFor('vr_native'), undefined);
});
