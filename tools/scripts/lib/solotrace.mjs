// Single-player trace: one scripted run recorded frame by frame, so two builds of the game can be compared exactly.
// Used by tools/scripts/solo-trace.mjs; the comparison is tools/solo-compare.mjs. docs/notes/devtools.md, "Comparing two builds".
//
// Three things make two builds comparable:
//  1. The frozen clock (lib/steady.mjs): every frame is 16 ms of page time on both builds.
//  2. Randomness **by caller**: Math.random is replaced before the page loads by one seeded stream per calling function
//     (source file + function name). A build that adds a random call in one function (a new blood puff) changes only that
//     function's later numbers, never an enemy's dodge roll or a wave's roster. The calls a frame made are counted per
//     caller, so the first frame where the two builds differ names the function that changed.
//  3. A recorder in the page: every game event (name and a short form of its payload) and, each frame, the player, the gun,
//     the wave, the score, the purse and every living enemy.

/** Runs in the page before any game code: Math.random by caller, with counts. */
export function keyedRandom(seed) {
  const mulberry = s => {
    let a = s >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  const hash = s => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
  };
  const streams = new Map();
  const counts = new Map();
  const total = new Map();
  // Helpers that only pass a random number on: the caller that matters is the one above them.
  // (callins/shared.ts: a strike alone rolls through `plain` and `roll` there, which are Math.random by another name.)
  const PASS = /\/src\/(core\/math|progression\/callins\/shared)\.ts$/;
  // A function that moved or was renamed between the builds compared keeps its old stream, so its draws stay the same
  // numbers: new name -> old name. Add a line when a comparison parts ways at a caller that only changed its name.
  const ALIAS = {
    'weapons/shot.ts#fillShot': 'weapons/Weapons.ts#fillShot',
    'weapons/Flames.ts#fillGlob': 'weapons/Flames.ts#spawnGlob',
    'enemies/damage.ts#run': 'enemies/damage.ts#apply',
    'enemies/bosses.ts#shockFx': 'enemies/bosses.ts#shockwave',
    // A hit's trip, fall and stagger rolls: `dice(0, n)` is Math.random alone, as `chance()` was inside chooseReaction.
    'enemies/reactions.ts#dice': 'enemies/reactions.ts#chooseReaction',
  };
  const sitesOnly = (_, sites) => sites;
  function random() {
    const prepare = Error.prepareStackTrace, limit = Error.stackTraceLimit;
    Error.stackTraceLimit = 8;
    Error.prepareStackTrace = sitesOnly;
    const holder = {};
    Error.captureStackTrace(holder, random);
    const sites = holder.stack;
    Error.prepareStackTrace = prepare;
    Error.stackTraceLimit = limit;
    let key = 'unknown';
    for (let i = 0; i < sites.length; i++) {
      const site = sites[i];
      let file = site.getFileName() || '';
      const q = file.indexOf('?');
      if (q >= 0) file = file.slice(0, q);
      const at = file.search(/\/(src|node_modules)\//);
      if (at < 0) continue;
      file = file.slice(at);
      if (PASS.test(file)) continue;
      if (file.startsWith('/node_modules/')) { key = file.replace(/^\/node_modules\/(\.vite\/deps\/)?/, 'npm:').replace(/\.js$/, ''); break; }
      key = `${file.slice(5)}#${site.getFunctionName() || site.getMethodName() || ''}`;
      key = ALIAS[key] ?? key;
      break;
    }
    let next = streams.get(key);
    if (!next) streams.set(key, (next = mulberry(hash(key) ^ seed)));
    counts.set(key, (counts.get(key) || 0) + 1);
    total.set(key, (total.get(key) || 0) + 1);
    return next();
  }
  Math.random = random;
  window.__soloRandom = {
    /** The callers since the last take, as { key: calls }. */
    take() { const out = Object.fromEntries(counts); counts.clear(); return out; },
    total: () => Object.fromEntries(total),
    /** Every caller's stream starts again from the seed, and the counts from zero. */
    reset() { streams.clear(); counts.clear(); total.clear(); },
  };
}

/**
 * Runs in the page once the game is up: wraps the event bus and sets up the per-frame record. `window.__solo.step(n, bot)`
 * then plays n frames: before each it runs the bot (a function of (ctx, game, frame, memo)), after each it records.
 */
export function recorder() {
  const { ctx, game } = window.__op2;
  const r3 = v => Math.round(v * 1000) / 1000;
  const short = (value, depth) => {
    if (value === null || value === undefined) return value ?? null;
    const t = typeof value;
    if (t === 'number') return Number.isFinite(value) ? r3(value) : String(value);
    if (t === 'string' || t === 'boolean') return value;
    if (t === 'function') return 'fn';
    if (value.isVector3) return [r3(value.x), r3(value.y), r3(value.z)];
    if (value.isVector2) return [r3(value.x), r3(value.y)];
    if (value.isObject3D || value.isMaterial || value.isBufferGeometry) return 'three';
    if (typeof value.uid === 'number' && typeof value.id === 'string' && value.position) return `enemy ${value.uid} ${value.id}`;
    if (depth <= 0) return Array.isArray(value) ? `[${value.length}]` : '{}';
    if (Array.isArray(value)) return value.length > 24 ? `[${value.length}]` : value.map(v => short(v, depth - 1));
    if (value instanceof Set || value instanceof Map) return `set ${value.size}`;
    if (ArrayBuffer.isView(value)) return `bytes ${value.length}`;
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = short(value[key], depth - 1);
    return out;
  };
  const solo = window.__solo = { frame: 0, events: [], frames: [], random: [], errors: [], memo: {} };
  const emit = ctx.events.emit.bind(ctx.events);
  ctx.events.emit = (type, payload) => {
    let text;
    try { text = JSON.stringify(short(payload, 2)); } catch { text = '"?"'; }
    solo.events.push([solo.frame, type, text]);
    return emit(type, payload);
  };
  // What the HUD is told to show (a prompt, a feed line, a banner, a screen, the hold ring): each call with its words, once
  // per change, as an event named hud.<method>.
  const hud = ctx.hud, said = {};
  const proto = hud ? Object.getPrototypeOf(hud) : null;
  for (const name of proto ? Object.getOwnPropertyNames(proto) : []) {
    if (['constructor', 'update', 'init', 'loading', 'mount', 'teamBoard', 'killerName', 'dazzle'].includes(name)) continue;
    const d = Object.getOwnPropertyDescriptor(proto, name);
    if (!d || typeof d.value !== 'function') continue;
    const real = d.value;
    hud[name] = function (...args) {
      let text;
      try { text = JSON.stringify(short(args, 2)); } catch { text = '"?"'; }
      if (said[name] !== text) { said[name] = text; solo.events.push([solo.frame, `hud.${name}`, text]); }
      return real.apply(this, args);
    };
  }
  window.addEventListener('error', e => solo.errors.push([solo.frame, String(e.message)]));
  window.addEventListener('unhandledrejection', e => solo.errors.push([solo.frame, String(e.reason?.message ?? e.reason)]));
  /** The gore system's own counts (ragdolls, corpses, limbs...), whatever this build reports. */
  const gore = () => {
    try { const s = ctx.gore?.stats?.(); if (!s) return null; const out = {}; for (const k of Object.keys(s)) if (typeof s[k] === 'number') out[k] = r3(s[k]); return out; } catch { return null; }
  };
  /** The scenario's own reading (`probe`), if it has one. */
  const extra = () => {
    if (!window.__soloProbe) return null;
    try { return short(window.__soloProbe(ctx, game), 2); } catch (e) { return `probe: ${e.message}`; }
  };
  const record = () => {
    const p = ctx.player, w = ctx.weapons, g = ctx.progression, waves = ctx.waves;
    let ammo = null;
    try { ammo = w?.ammo?.(); } catch { /* a holstered hand */ }
    const wallet = ctx.contracts?.wallet;
    const enemies = [];
    for (const e of ctx.enemies?.alive ?? []) enemies.push([e.uid, e.id, r3(e.position.x), r3(e.position.y), r3(e.position.z), r3(e.health), r3(e.armor ?? 0)]);
    enemies.sort((a, b) => a[0] - b[0]);
    solo.frames.push({
      state: game.state,
      screen: ctx.hud?.screens?.name ?? null,
      time: [r3(ctx.time.elapsed), r3(ctx.time.playerElapsed ?? 0), r3(ctx.time.scale)],
      player: [r3(p.position.x), r3(p.position.y), r3(p.position.z), r3(p.velocity.x), r3(p.velocity.y), r3(p.velocity.z), r3(p.yaw), r3(p.pitch), r3(p.health), r3(p.armor), p.state ?? ''],
      gun: [w?.current ?? '', ammo?.mag ?? ammo?.magazine ?? null, ammo?.reserve ?? null, w?.grenades ?? null, !!w?.reloading],
      run: [waves?.wave ?? null, waves?.phase ?? null, g?.score ?? null, g?.kills ?? null, g?.headshots ?? null, g?.combo ?? null, r3(g?.multiplier ?? 0), wallet?.credits ?? null,
        g?.callIns ? [...g.callIns].sort().join(',') : '', (g?.effects ?? []).map(e => e.id).sort().join(','), (g?.pickups ?? []).filter(k => k.active).length],
      enemies,
      gore: gore(),
      extra: extra(),
    });
    solo.random.push(window.__soloRandom.take());
    // The words on a menu screen, 20 frames after it comes up and whenever they change after that (checked every 40 frames).
    const name = ctx.hud?.screens?.name ?? 'none';
    if (name !== shown.name) { shown.name = name; shown.since = solo.frame; shown.text = null; }
    if (name !== 'none' && name !== 'loading' && solo.frame - shown.since >= 20 && (solo.frame - shown.since - 20) % 40 === 0) {
      const el = ctx.hud.screens.screens?.[name]?.el;
      const text = el ? (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 4000) : '';
      if (text !== shown.text) { shown.text = text; solo.events.push([solo.frame, 'screen.text', JSON.stringify({ name, text })]); }
    }
  };
  const shown = { name: 'none', since: 0, text: null };
  solo.step = async (n, botSource) => {
    const bot = botSource ? (0, eval)(`(${botSource})`) : null;
    const clock = globalThis.__pwClock.controller;
    for (let i = 0; i < n; i++) {
      if (bot) { try { bot(ctx, game, solo.frame, solo.memo); } catch (e) { solo.errors.push([solo.frame, `bot: ${e.message}`]); } }
      await clock.runFor(16);
      solo.frame++;
      record();
    }
    return solo.frame;
  };
  solo.take = () => {
    const out = { frames: solo.frames, events: solo.events, random: solo.random, errors: solo.errors };
    solo.frames = []; solo.events = []; solo.random = []; solo.errors = [];
    return out;
  };
  window.__soloRandom.take();
  return true;
}
