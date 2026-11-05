'use strict';
/**
 * scripts/merge-duplicate-games.js
 *
 * Merges catalogue entries that share an `id` (the same game imported twice
 * under slightly different file names, e.g. bioshock-2.json / bioshock2.json).
 * The app indexes games by id, so with duplicates the sidebar could list one
 * entry and the game page open the other.
 *
 * For each group: all fixes are kept, empty fields are filled from the other
 * entries, the title comes from the entry with the most fixes from the 3D/VR
 * Compatibility Database (its names are hand-curated), and the other files
 * are deleted. Run with --dry-run to see the plan without writing.
 */

const fs   = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'data', 'games');
const dryRun = process.argv.includes('--dry-run');

const isEmpty = v => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

const byId = new Map();
for (const file of fs.readdirSync(DIR).filter(f => f.endsWith('.json'))) {
    const game = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
    if (!byId.has(game.id)) byId.set(game.id, []);
    byId.get(game.id).push({ file, game });
}

let merged = 0, removed = 0;
for (const [id, entries] of byId) {
    if (entries.length < 2) continue;

    // Base: the entry with the most filled-in fields (exe, Steam id, path...).
    const filled = e => Object.values(e.game).filter(v => !isEmpty(v)).length;
    const base = [...entries].sort((a, b) => filled(b) - filled(a))[0];
    // Title: the entry with the most compatibility-database fixes, then the longer title.
    const curated = e => e.game.fixes.filter(f => f.source).length;
    const titled = [...entries].sort((a, b) => curated(b) - curated(a) || b.game.title.length - a.game.title.length)[0];

    const out = JSON.parse(JSON.stringify(base.game));
    for (const e of entries) {
        if (e === base) continue;
        for (const [k, v] of Object.entries(e.game)) {
            if (k === 'fixes') continue;
            if (isEmpty(out[k]) && !isEmpty(v)) out[k] = v;
        }
        const have = new Set(out.fixes.map(f => f.id));
        for (const f of e.game.fixes) if (!have.has(f.id)) out.fixes.push(f);
    }
    out.title = titled.game.title;

    const exes = new Set(entries.map(e => e.game.exe_name).filter(Boolean));
    const note = exes.size > 1 ? `  (exe names differed: ${[...exes].join(', ')}; kept ${out.exe_name})` : '';
    console.log(`${id}: ${entries.map(e => e.file).join(' + ')} → ${titled.file} "${out.title}", ${out.fixes.length} fixes${note}`);

    if (!dryRun) {
        fs.writeFileSync(path.join(DIR, titled.file), JSON.stringify(out, null, 2) + '\n');
        for (const e of entries) {
            if (e.file !== titled.file) { fs.unlinkSync(path.join(DIR, e.file)); removed++; }
        }
    }
    merged++;
}
console.log(`${dryRun ? 'Would merge' : 'Merged'} ${merged} duplicate groups${dryRun ? '' : `, removed ${removed} files`}.`);
