#!/usr/bin/env node
/**
 * scripts/fill-steam-ids.js
 *
 * Walks data/games/*.json. For any entry without a steam_app_id (or
 * where the existing one 404s on Steam's CDN), hits the Steam Store
 * search HTML page and writes back the first data-ds-appid match.
 *
 * Best-effort. Manually review the results — sometimes the first match
 * is the wrong edition / DLC / soundtrack. Skipped entries are reported.
 *
 *   node scripts/fill-steam-ids.js [--dry-run]
 */
'use strict';

const fs    = require('fs');
const path  = require('path');
const https = require('https');

const GAMES   = path.join(__dirname, '..', 'data', 'games');
const DRY     = process.argv.includes('--dry-run');

function get(url) {
    return new Promise(resolve => {
        https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 }, res => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        }).on('error', () => resolve('')).on('timeout', () => resolve(''));
    });
}

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

// Throttled fetch — wait between requests + exponential backoff on 403/429.
let lastFetchAt = 0;
const MIN_DELAY_MS = 1500;
async function throttledGet(url) {
    const wait = Math.max(0, MIN_DELAY_MS - (Date.now() - lastFetchAt));
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastFetchAt = Date.now();
    return get(url);
}

async function searchSteam(title) {
    const url = `https://store.steampowered.com/search/?category1=998&term=${encodeURIComponent(title)}`;
    let html  = '';
    let delay = 5000;
    for (let attempt = 0; attempt < 4; ++attempt) {
        html = await throttledGet(url);
        // Empty body / 403 page → back off and retry.
        if (html && /<title>[^<]+<\/title>/i.test(html) && !/Access Denied|429 Too Many Requests/i.test(html)) break;
        console.log(`      ratelimited / empty — sleeping ${delay/1000}s and retrying…`);
        await new Promise(r => setTimeout(r, delay));
        delay *= 2;
    }
    const re = /<a[^>]*?data-ds-appid="(\d+)"[^>]*?>([\s\S]*?)<\/a>/g;
    let m;
    while ((m = re.exec(html)) !== null) {
        const id   = m[1];
        const body = m[2];
        if (/soundtrack|OST\b|original score/i.test(body)) continue;
        return id;
    }
    return null;
}

async function verifyExisting(id) {
    if (!id) return false;
    const status = await head(`https://cdn.akamai.steamstatic.com/steam/apps/${id}/library_600x900.jpg`);
    if (status === 200) return true;
    const headerStatus = await head(`https://cdn.akamai.steamstatic.com/steam/apps/${id}/header.jpg`);
    return headerStatus === 200;
}

(async () => {
    const files = fs.readdirSync(GAMES).filter(f => f.endsWith('.json'));
    let filled = 0, skipped = 0, okExisting = 0;
    for (const f of files) {
        const p   = path.join(GAMES, f);
        const g   = JSON.parse(fs.readFileSync(p, 'utf8'));
        const has = g.steam_app_id != null && String(g.steam_app_id).length > 0;
        if (has) {
            const ok = await verifyExisting(g.steam_app_id);
            if (ok) { okExisting++; continue; }
            console.log(`STALE ${String(g.steam_app_id).padStart(8)} → searching for "${g.title}"…`);
        } else {
            console.log(`MISS  ........ → searching for "${g.title}"…`);
        }
        const found = await searchSteam(g.title);
        if (!found) {
            console.log(`      not found — leave empty.`);
            skipped++;
            continue;
        }
        console.log(`      →  ${found}`);
        if (!DRY) {
            g.steam_app_id = found;
            fs.writeFileSync(p, JSON.stringify(g, null, 2) + '\n', 'utf8');
        }
        filled++;
    }
    console.log(`\nDone: ${filled} filled, ${skipped} not found, ${okExisting} already valid.${DRY ? ' (dry-run — no writes)' : ''}`);
})();
