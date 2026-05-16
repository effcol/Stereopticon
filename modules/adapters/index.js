'use strict';
/**
 * modules/adapters/index.js
 *
 * Tool adapter registry + pipeline executor.
 *
 * Each adapter lives in its own file (modules/adapters/{id}.js) and exposes:
 *
 *   {
 *     id:           string,              // matches fix.type or pipeline step id (lowercased)
 *     name:         string,              // display name
 *     applyConfig:  async (ctx) => result,
 *     cleanup:      async (ctx) => result, // optional
 *   }
 *
 * ctx (build by callers, normally profileManager.executePipeline) is:
 *
 *   {
 *     fix:         object,         // fix object from data/games/<game>.json
 *     display:     object,         // display profile from data/displays/<id>.json
 *     pipeline:    object,         // resolvePipeline() output
 *     outputId:    string,         // selected output id, e.g. "sbs_half"
 *     gameContext: {               // game-level info
 *       id:        string,
 *       exeName:   string,
 *       gamePath:  string,
 *     },
 *     headtracking: {              // optional, omitted if not requested
 *       enabled:   boolean,
 *       method:    string,         // "opentrack" | "leia_track" | ...
 *       port:      number,
 *     },
 *     userOverrides: {             // optional, modal-tweaked values per tool
 *       [adapterId]: { ... },
 *     },
 *   }
 *
 * applyConfig returns: { success, applied: [string], errors: [string], warnings: [string] }.
 */

const fs   = require('fs');
const path = require('path');

// ─── Adapter discovery ───────────────────────────────────────
// Auto-load every .js file in this directory except index.js itself.
const adapters = {};
const ADAPTER_DIR = __dirname;

function loadAdapters() {
    for (const f of fs.readdirSync(ADAPTER_DIR)) {
        if (!f.endsWith('.js') || f === 'index.js') continue;
        try {
            const adapter = require(path.join(ADAPTER_DIR, f));
            if (!adapter || typeof adapter !== 'object' || !adapter.id) {
                console.warn(`[adapters] ${f}: missing 'id', skipping`);
                continue;
            }
            const key = normalizeId(adapter.id);
            if (adapters[key]) {
                console.warn(`[adapters] duplicate id "${key}" — ${f} overwrites previous`);
            }
            adapters[key] = adapter;
            // Aliases let one adapter respond to multiple ids (e.g. opentrack handles both
            // 'opentrack' and 'leia_track' headtracking methods).
            if (Array.isArray(adapter.aliases)) {
                for (const alias of adapter.aliases) {
                    const aKey = normalizeId(alias);
                    if (!aKey || aKey === key) continue;
                    if (adapters[aKey]) {
                        console.warn(`[adapters] alias "${aKey}" of ${f} conflicts with existing adapter — skipped`);
                        continue;
                    }
                    adapters[aKey] = adapter;
                }
            }
        } catch (e) {
            console.warn(`[adapters] failed to load ${f}: ${e.message}`);
        }
    }
}

// Normalize "3DGameBridge" / "3dgamebridge" / "3D Game Bridge" → "3dgamebridge"
function normalizeId(id) {
    return String(id).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getAdapter(id) {
    if (!id) return null;
    return adapters[normalizeId(id)] || null;
}

function listAdapters() {
    return Object.values(adapters).map(a => ({ id: a.id, name: a.name || a.id }));
}

// ─── Pipeline execution ──────────────────────────────────────

function emptyResult() {
    return { success: true, applied: [], errors: [], warnings: [] };
}

function mergeResults(into, from, tag) {
    if (!from) return;
    if (from.success === false) into.success = false;
    if (Array.isArray(from.applied))  for (const a of from.applied)  into.applied.push(tag ? `${tag}: ${a}` : a);
    if (Array.isArray(from.errors))   for (const e of from.errors)   into.errors.push(tag ? `${tag}: ${e}` : e);
    if (Array.isArray(from.warnings)) for (const w of from.warnings) into.warnings.push(tag ? `${tag}: ${w}` : w);
}

async function callAdapter(adapter, ctx, tag, results) {
    try {
        const r = await adapter.applyConfig(ctx);
        mergeResults(results, r, tag);
    } catch (e) {
        results.success = false;
        results.errors.push(`${tag}: ${e.message}`);
    }
}

/**
 * Walk a resolved pipeline + invoke adapters in order:
 *
 *   1. Primary fix tool       (ctx.fix.type)
 *   2. Intermediate steps     (ctx.pipeline.steps[])
 *   3. VR driver if any       (ctx.pipeline.vrDriver)
 *   4. Headtracking if any    (ctx.headtracking.method)
 *
 * Missing adapters are skipped with a warning, not an error — this lets the
 * pattern be additive (add tool, add adapter, no other code changes needed).
 */
async function executePipeline(ctx) {
    const results = emptyResult();
    if (!ctx) {
        results.success = false;
        results.errors.push('executePipeline called with no context');
        return results;
    }

    const dispatched = new Set();

    // 1. Primary fix tool
    if (ctx.fix?.type) {
        const a = getAdapter(ctx.fix.type);
        if (a) {
            await callAdapter(a, ctx, ctx.fix.type, results);
            dispatched.add(normalizeId(a.id));
        } else {
            results.warnings.push(`No adapter registered for fix type "${ctx.fix.type}" — config skipped`);
        }
    }

    // 2. Intermediate pipeline steps (chained conversions like 3DGameBridge, ShaderGlass)
    const steps = ctx.pipeline?.steps || [];
    for (const step of steps) {
        const a = getAdapter(step);
        if (!a) {
            results.warnings.push(`No adapter registered for pipeline step "${step}" — skipped`);
            continue;
        }
        const key = normalizeId(a.id);
        if (dispatched.has(key)) continue;
        await callAdapter(a, ctx, step, results);
        dispatched.add(key);
    }

    // 3. VR driver (vrto3d / xrgamebridge etc.) — usually only set on VR fix types
    if (ctx.pipeline?.vrDriver) {
        const a = getAdapter(ctx.pipeline.vrDriver);
        if (a) {
            const key = normalizeId(a.id);
            if (!dispatched.has(key)) {
                await callAdapter(a, ctx, ctx.pipeline.vrDriver, results);
                dispatched.add(key);
            }
        }
    }

    // 4. Headtracking (S5 will wire SR-OpenTrack-Bridge in here)
    if (ctx.headtracking?.enabled && ctx.headtracking?.method) {
        const a = getAdapter(ctx.headtracking.method);
        if (a) {
            const key = normalizeId(a.id);
            if (!dispatched.has(key)) {
                await callAdapter(a, ctx, `headtracking/${ctx.headtracking.method}`, results);
                dispatched.add(key);
            }
        }
    }

    // 5. alwaysRun adapters — for tools that need to be re-evaluated every launch
    // even when not chained (e.g. 3DGameBridge needs to be DISABLED when the
    // output isn't sr_weave, so the addon doesn't stick across sessions).
    for (const adapter of Object.values(adapters)) {
        if (!adapter.alwaysRun) continue;
        const key = normalizeId(adapter.id);
        if (dispatched.has(key)) continue;
        await callAdapter(adapter, ctx, `${adapter.id} (alwaysRun)`, results);
        dispatched.add(key);
    }

    return results;
}

// ─── Init ────────────────────────────────────────────────────
loadAdapters();

module.exports = {
    executePipeline,
    getAdapter,
    listAdapters,
    normalizeId,
};
