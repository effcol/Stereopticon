'use strict';
const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

// Keep backups out of the real ~/.stereopticon.
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stereopticon-home-'));
process.env.USERPROFILE = home;
process.env.HOME = home;
const im = require('../modules/installManifest');

function makeGame() {
    const g = fs.mkdtempSync(path.join(os.tmpdir(), 'stereopticon-game-'));
    const w = (rel, text) => {
        fs.mkdirSync(path.dirname(path.join(g, rel)), { recursive: true });
        fs.writeFileSync(path.join(g, rel), text);
    };
    w('game.exe', 'EXE');
    w('d3d9.dll', 'ORIGINAL');
    w('data/big.pak', 'PAK');
    w('settings.ini', 'USER=1');
    w('ShaderFixes/keep.txt', 'OTHER MOD');
    return { g, w, read: rel => fs.readFileSync(path.join(g, rel), 'utf8'), exists: rel => fs.existsSync(path.join(g, rel)) };
}
const tick = () => new Promise(r => setTimeout(r, 30));

test('uninstall removes what the install added and restores what it replaced', async () => {
    const { g, w, read, exists } = makeGame();
    await tick();

    let s = im.begin('fix_a', g);
    s.beforeWrite(path.join(g, 'd3d9.dll'));
    w('d3d9.dll', 'MOD');
    w('d3d11.dll', 'FIX');
    w('ShaderFixes/a.txt', 'A');
    w('New/deep/b.txt', 'B');
    w('data/big.pak', 'PAKMOD');          // overwritten with no backup taken
    w('settings.ini', 'USER=2');           // top-level ini: backed up up front
    let m = im.finish(s);
    assert.deepStrictEqual(m.added.sort(), ['New/deep/b.txt', 'ShaderFixes/a.txt', 'd3d11.dll']);
    assert.deepStrictEqual(m.replaced.sort(), ['d3d9.dll', 'settings.ini']);
    assert.deepStrictEqual(m.unrecoverable, ['data/big.pak']);
    await tick();

    // A second step for the same fix overwrites the fix's own file.
    s = im.begin('fix_a', g);
    w('d3d11.dll', 'RESHADE');
    w('ReShade.ini', '[x]');
    w('d3d9.dll', 'MOD AGAIN');
    m = im.finish(s);
    assert.ok(!m.replaced.includes('d3d11.dll'), 'a file the fix added is never treated as an original');
    assert.strictEqual(m.replaced.filter(x => x === 'd3d9.dll').length, 1);

    // Other mods and runtime artefacts appear afterwards.
    w('dxgi.dll', 'OTHER MOD');
    w('ShaderCache/c.bin', 'c');
    w('ReShade.log', 'log');

    const u = im.uninstall('fix_a', 'geo11');
    assert.strictEqual(u.success, true);
    assert.strictEqual(read('d3d9.dll'), 'ORIGINAL', 'the earliest original is restored');
    assert.strictEqual(read('settings.ini'), 'USER=1');
    for (const gone of ['d3d11.dll', 'ShaderFixes/a.txt', 'New', 'ReShade.ini', 'ShaderCache', 'ReShade.log']) {
        assert.ok(!exists(gone), `${gone} should be removed`);
    }
    for (const kept of ['game.exe', 'dxgi.dll', 'ShaderFixes/keep.txt', 'data/big.pak']) {
        assert.ok(exists(kept), `${kept} should be kept`);
    }
    assert.deepStrictEqual(u.unrecoverable, ['data/big.pak']);
    assert.strictEqual(im.loadManifest('fix_a'), null);
    assert.strictEqual(im.uninstall('fix_a', 'geo11'), null, 'no manifest means the legacy path');
});

test('a failed install is rolled back', async () => {
    const { g, w, read, exists } = makeGame();
    await tick();
    const s = im.begin('fix_b', g);
    s.beforeWrite(path.join(g, 'd3d9.dll'));
    w('d3d9.dll', 'HALF');
    w('partial/x.bin', 'x');
    assert.strictEqual(im.finish(s, { rollback: true }), null);
    assert.strictEqual(read('d3d9.dll'), 'ORIGINAL');
    assert.ok(!exists('partial'));
    assert.strictEqual(im.loadManifest('fix_b'), null);
});
