'use strict';
const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

// A fake wiz3D release in a temporary data folder, so no download happens.
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'stereopticon-data-'));
process.env.STEREOPTICON_DATA_DIR = data;
const release = path.join(data, 'tools', 'wiz3d', 'versions', 'vtest');
for (const rel of ['Stereo-Injector/DX9/32-bit', 'Stereo-Injector/DX9/64-bit', 'Stereo-Injector/DX10-11/64-bit',
                   'Stereo-Injector/DX8', 'HD3D/64-bit', '3D-Vision-Direct/DX11/64-bit']) {
    fs.mkdirSync(path.join(release, rel), { recursive: true });
    fs.writeFileSync(path.join(release, rel, 'wiz3D_Config.xml'), '<OutputMode Value="SRWeave"/>');
    fs.writeFileSync(path.join(release, rel, 'marker.txt'), rel);
}
fs.writeFileSync(path.join(data, 'tools', 'wiz3d', 'current.json'), JSON.stringify({ tag: 'vtest', name: 'test' }));

const installer = require('../modules/installer');
const peInfo    = require('../modules/peInfo');

test('the PE reader recognises a real executable', () => {
    const pe = peInfo.readPe(process.execPath);
    assert.ok(pe, 'node.exe parses');
    assert.strictEqual(pe.arch, process.arch === 'ia32' ? 'x86' : process.arch);
    assert.ok(pe.imports.includes('kernel32.dll'));
    assert.strictEqual(peInfo.readPe(__filename), null, 'a text file is not a PE');
});

test('graphics API detection from imports', () => {
    assert.strictEqual(peInfo.graphicsApiFromImports(['d3d9.dll']), 'dx9');
    assert.strictEqual(peInfo.graphicsApiFromImports(['d3dx9_43.dll']), 'dx9');
    assert.strictEqual(peInfo.graphicsApiFromImports(['dxgi.dll', 'd3d11.dll']), 'dx10-11');
    assert.strictEqual(peInfo.graphicsApiFromImports(['d3d9.dll', 'd3d11.dll']), null, 'ambiguous');
    assert.strictEqual(peInfo.graphicsApiFromImports(['d3d8.dll']), 'dx8');
    assert.strictEqual(peInfo.graphicsApiFromImports(['opengl32.dll']), 'opengl');
});

test('wiz3D target selection follows the catalogue and the architecture', () => {
    const t = (profile, pe) => installer.resolveWiz3DTarget(profile, null, pe);
    assert.deepStrictEqual(t({ type: 'wiz3d_wrapper', wiz3d_api_raw: 'DX9' }, { arch: 'x86', imports: [] }).rel,
                           ['Stereo-Injector', 'DX9', '32-bit']);
    assert.deepStrictEqual(t({ type: 'wiz3d_wrapper', wiz3d_api_raw: 'DX11' }, { arch: 'x64', imports: [] }).rel,
                           ['Stereo-Injector', 'DX10-11', '64-bit']);
    assert.deepStrictEqual(t({ type: 'wiz3d_wrapper', wiz3d_api_raw: 'DX8' }, { arch: 'x86', imports: [] }).rel,
                           ['Stereo-Injector', 'DX8']);
    assert.ok(t({ type: 'wiz3d_wrapper', wiz3d_api_raw: 'DX8' }, { arch: 'x64', imports: [] }).error, 'DX8 is 32-bit only');
    assert.deepStrictEqual(t({ type: 'wiz3d_wrapper' }, { arch: 'x64', imports: ['d3d9.dll'] }).rel,
                           ['Stereo-Injector', 'DX9', '64-bit'], 'imports are the fallback for the API');
    assert.ok(t({ type: 'wiz3d_wrapper' }, null).error, 'no API information at all');
    assert.deepStrictEqual(t({ type: 'wiz3d_hd3d', wiz3d_bits: 'x64' }, null).rel, ['HD3D', '64-bit']);
    assert.deepStrictEqual(t({ type: 'wiz3d_3dvision_dm', wiz3d_api_raw: 'DX11' }, null).rel,
                           ['3D-Vision-Direct', 'DX11', '64-bit']);
});

test('install copies the release next to the game exe, found in a subfolder', async () => {
    const game = fs.mkdtempSync(path.join(os.tmpdir(), 'stereopticon-game-'));
    fs.mkdirSync(path.join(game, 'Binaries', 'Win32'), { recursive: true });
    fs.writeFileSync(path.join(game, 'Binaries', 'Win32', 'Game.exe'), 'not a real exe');

    const written = [];
    const r = await installer.installFix(
        { id: 'g_wiz3d', type: 'wiz3d_wrapper', wiz3d_api_raw: 'DX9', wiz3d_bits: 'x86' },
        game, () => {}, 'game.exe', { beforeWrite: p => written.push(p) });

    assert.strictEqual(r.success, true, r.message);
    assert.strictEqual(r.installDir, path.join(game, 'Binaries', 'Win32'));
    assert.strictEqual(r.variant, 'Stereo-Injector/DX9/32-bit');
    assert.strictEqual(fs.readFileSync(path.join(r.installDir, 'marker.txt'), 'utf8'), 'Stereo-Injector/DX9/32-bit');
    assert.strictEqual(written.length, 2, 'beforeWrite is called for every file');
});

test('folder matching needs an exact name when there is no exe to confirm it', () => {
    const { folderMatches } = require('../modules/gameRegistry');
    assert.strictEqual(folderMatches('Alan Wake', 'Alan Wake', false), true);
    assert.strictEqual(folderMatches("Mirror's Edge", 'mirrors edge', false), true);
    assert.strictEqual(folderMatches('The Witcher', 'The Witcher 3', false), false);
    assert.strictEqual(folderMatches('Far Cry 2', 'Far Cry 3', false), false);
    assert.strictEqual(folderMatches('Batman: Arkham City', 'Batman Arkham City GOTY', true), true,
                       'a loose match is fine when the exe is checked afterwards');
});
