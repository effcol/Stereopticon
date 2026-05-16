#!/usr/bin/env node
/**
 * scripts/verify-steam-ids.js
 *
 * Checks every data/games/<game>.json with a steam_app_id by hitting the
 * Steam CDN for its library_600x900.jpg poster. Reports OK / 404 / NET.
 *
 *   node scripts/verify-steam-ids.js
 *
 * For misses, look up the right app id at https://steamdb.info or
 * https://store.steampowered.com/search and update the JSON.
 *
 * Optional: pass --resolve to also call the Steam Store search and suggest
 * candidate replacement ids by title. (Best-effort, manual review still needed.)
 */
'use strict';

const fs    = require('fs');
const path  = require('path');
const https = require('https');

const GAMES_DIR = path.join(__dirname, '..', 'data', 'games');
const RESOLVE   = process.argv.includes('--resolve');

function head(url) {
    return new Promise(resolve => {
        const req = https.request(url, { method: 'HEAD', timeout: 6000 }, res => {
            resolve(res.statusCode);
            res.resume();
        });
        req.on('error', () => resolve(0));
        req.on('timeout', () => { req.destroy(); resolve(0); });
        req.end();
    });
}

function get(url) {
    return new Promise(resolve => {
        https.get(url, { timeout: 8000 }, res => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        }).on('error', () => resolve('')).on('timeout', () => resolve(''));
    });
}

async function suggestId(title) {
    // Best-effort: parses the Steam store search results page for the first
    // app id matching the title. Imperfect — sometimes returns DLC/soundtracks.
    const html = await get(`https://store.steampowered.com/search/?term=${encodeURIComponent(title)}`);
    const m = html.match(/data-ds-appid="(\d+)"/);
    return m ? m[1] : null;
}

(async () => {
    const files = fs.readdirSync(GAMES_DIR).filter(f => f.endsWith('.json'));
    let okN = 0, missN = 0, skipN = 0;
    for (const f of files) {
        const game = JSON.parse(fs.readFileSync(path.join(GAMES_DIR, f), 'utf8'));
        if (!game.steam_app_id) { console.log(`SKIP  —          ${game.title}`); skipN++; continue; }
        const url    = `https://cdn.akamai.steamstatic.com/steam/apps/${game.steam_app_id}/library_600x900.jpg`;
        const status = await head(url);
        if (status === 200) { console.log(`OK    ${String(game.steam_app_id).padStart(8)}  ${game.title}`); okN++; continue; }
        let suffix = '';
        if (RESOLVE) {
            const suggested = await suggestId(game.title);
            if (suggested && suggested !== game.steam_app_id) suffix = `  →  suggested ${suggested}`;
        }
        console.log(`MISS  ${String(game.steam_app_id).padStart(8)}  ${game.title}${suffix}`);
        missN++;
    }
    console.log(`\n${okN} ok · ${missN} miss · ${skipN} skipped (no steam_app_id)`);
})();
