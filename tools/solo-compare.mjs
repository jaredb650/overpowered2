#!/usr/bin/env node
// Compares two traces made by tools/scripts/solo-trace.mjs (one scripted single-player run on each of two builds) and says
// where they first differ: the frame, which numbers, which events, and which functions drew a different number of random
// numbers up to there (that names the code that changed). docs/notes/devtools.md, "Comparing two builds".
//
//   node tools/solo-compare.mjs a.trace.json b.trace.json [--skip-events "coop:,fx:puff"] [--skip-random "fx/,gore/blood"]
//                               [--context 3] [--json]
//
// --skip-events   event names (prefixes, comma separated) left out of the comparison: events only the new build has
// --skip-random   callers (substrings) whose random-call counts are not reported
// --tol <n>       numbers within n count as equal (default 0: exact, at the trace's 0.001 rounding)
// Exit code 0 when the two runs are the same to the last frame, 1 when they differ, 3 when the play is the same in every
// frame and event and only the gore system's counts differ (bodies and limbs come to rest differently: a body already on
// the floor when the run starts got another idle phase). `music:track` is never compared: a track ends in real time.
import { readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const files = argv.filter(a => !a.startsWith('--') && argv[argv.indexOf(a) - 1]?.startsWith('--') !== true || a.endsWith('.json')).filter(a => a.endsWith('.json'));
const flag = name => { const i = argv.indexOf(`--${name}`); return i < 0 ? null : argv[i + 1] ?? ''; };
if (files.length !== 2) { console.error('usage: node tools/solo-compare.mjs a.trace.json b.trace.json'); process.exit(2); }
const skipEvents = (flag('skip-events') ?? '').split(',').filter(Boolean);
const skipRandom = (flag('skip-random') ?? '').split(',').filter(Boolean);
const context = Number(flag('context') ?? 2);
const tol = Number(flag('tol') ?? 0);
const [a, b] = files.map(f => JSON.parse(readFileSync(f, 'utf8')));

const same = (x, y) => {
  if (x === y || (x == null && y == null)) return true;
  if (typeof x === 'number' && typeof y === 'number') return Math.abs(x - y) <= tol;
  if (Array.isArray(x) && Array.isArray(y)) return x.length === y.length && x.every((v, i) => same(v, y[i]));
  return false;
};
// A music track changes when its file ends, in real time: not the frozen clock's to say.
const REAL_TIME = ['music:track'];
const keepEvent = e => !skipEvents.some(p => e[1].startsWith(p)) && !REAL_TIME.includes(e[1]);
const byFrame = events => {
  const map = new Map();
  for (const e of events) { if (!keepEvent(e)) continue; if (!map.has(e[0])) map.set(e[0], []); map.get(e[0]).push([e[1], e[2]]); }
  return map;
};
/** Payload keys that only one build has (a new field on an old event): noted, and not counted as a difference. */
const extraKeys = new Map();
const note = (name, key, side) => { const k = `${name}.${key}`; if (!extraKeys.has(k)) extraKeys.set(k, side); };
/** True when two events are the same once the keys only one side has are set aside. */
function sameEvent(x, y) {
  if (x[0] !== y[0]) return false;
  if (x[1] === y[1]) return true;
  let p, q;
  try { p = JSON.parse(x[1]); q = JSON.parse(y[1]); } catch { return false; }
  const walk = (m, n, path) => {
    if (m === n) return true;
    if (typeof m === 'number' && typeof n === 'number') return Math.abs(m - n) <= tol;
    if (Array.isArray(m) && Array.isArray(n)) return m.length === n.length && m.every((v, i) => walk(v, n[i], path));
    if (m && n && typeof m === 'object' && typeof n === 'object' && !Array.isArray(m) && !Array.isArray(n)) {
      for (const key of new Set([...Object.keys(m), ...Object.keys(n)])) {
        if (!(key in m)) { note(x[0], path + key, 'second'); continue; }
        if (!(key in n)) { note(x[0], path + key, 'first'); continue; }
        if (!walk(m[key], n[key], `${path}${key}.`)) return false;
      }
      return true;
    }
    return false;
  };
  return walk(p, q, '');
}
const ea = byFrame(a.events), eb = byFrame(b.events);
const frames = Math.min(a.frames.length, b.frames.length);

/** What differs at frame f: a list of lines, empty when nothing does. */
function differs(f, play = false) {
  const out = [];
  const x = a.frames[f], y = b.frames[f];
  for (const key of ['state', 'time', 'player', 'gun', 'run', 'extra']) if (!same(x[key], y[key])) out.push(`${key}: ${JSON.stringify(x[key])} | ${JSON.stringify(y[key])}`);
  if (!same(x.enemies, y.enemies)) {
    const ax = new Map(x.enemies.map(e => [e[0], e])), bx = new Map(y.enemies.map(e => [e[0], e]));
    let shown = 0;
    for (const [uid, e] of ax) {
      const o = bx.get(uid);
      if (!o) { if (shown++ < 4) out.push(`enemy ${uid} ${e[1]}: only in the first`); } else if (!same(e, o) && shown++ < 4) out.push(`enemy ${uid}: ${JSON.stringify(e)} | ${JSON.stringify(o)}`);
    }
    for (const [uid, e] of bx) if (!ax.has(uid) && shown++ < 4) out.push(`enemy ${uid} ${e[1]}: only in the second`);
    if (shown > 4) out.push(`... ${shown - 4} more enemies differ (${x.enemies.length} | ${y.enemies.length} alive)`);
  }
  // Events of this frame happened during frame f + 1's step: they carry the frame number at emit time.
  // `play`: only what the game is, not how the dead lie (the gore counts, a body part's knock on the floor).
  const evA = (ea.get(f) ?? []).filter(e => !play || e[0] !== 'gore:impact'), evB = (eb.get(f) ?? []).filter(e => !play || e[0] !== 'gore:impact');
  if (evA.length !== evB.length || evA.some((e, i) => !sameEvent(e, evB[i]))) {
    const onlyA = evA.filter(e => !evB.some(o => sameEvent(e, o))), onlyB = evB.filter(e => !evA.some(o => sameEvent(o, e)));
    if (onlyA.length || onlyB.length) {
      for (const e of onlyA.slice(0, 6)) out.push(`event only in the first:  ${`${e[0]} ${e[1]}`.slice(0, 400)}`);
      for (const e of onlyB.slice(0, 6)) out.push(`event only in the second: ${`${e[0]} ${e[1]}`.slice(0, 400)}`);
    } else if (evA.length !== evB.length) out.push(`events repeated a different number of times: ${evA.map(e => e[0]).join(',')} | ${evB.map(e => e[0]).join(',')}`);
    else out.push(`events in another order: ${evA.map(e => e[0]).join(',')} | ${evB.map(e => e[0]).join(',')}`);
  }
  if (!play && !same(x.gore ?? null, y.gore ?? null) && JSON.stringify(x.gore) !== JSON.stringify(y.gore)) out.push(`gore: ${JSON.stringify(x.gore)} | ${JSON.stringify(y.gore)}`);
  return out;
}

/** Random calls by caller that differ in frames [from, to]. */
function randomDiff(from, to) {
  const out = [];
  for (let f = Math.max(0, from); f <= to && f < frames; f++) {
    const x = a.random[f] ?? {}, y = b.random[f] ?? {};
    for (const key of new Set([...Object.keys(x), ...Object.keys(y)])) {
      if (skipRandom.some(s => key.includes(s))) continue;
      if ((x[key] ?? 0) !== (y[key] ?? 0)) out.push({ frame: f, caller: key, first: x[key] ?? 0, second: y[key] ?? 0 });
    }
  }
  return out;
}

let first = -1;
for (let f = 0; f < frames; f++) if (differs(f).length) { first = f; break; }
// The first frame where the play itself differs: later than `first`, or never, when only the dead lie differently.
let firstPlay = -1;
if (first >= 0) for (let f = first; f < frames; f++) if (differs(f, true).length) { firstPlay = f; break; }
const bodiesOnly = first >= 0 && firstPlay < 0 && a.frames.length === b.frames.length;

// The earliest frame where any caller drew a different count: usually before the game state shows it.
let firstRandom = null;
for (let f = 0; f < frames && !firstRandom; f++) { const d = randomDiff(f, f); if (d.length) firstRandom = d; }

const eventNames = t => { const n = {}; for (const e of t.events) n[e[1]] = (n[e[1]] ?? 0) + 1; return n; };
const na = eventNames(a), nb = eventNames(b);
const names = {};
for (const key of new Set([...Object.keys(na), ...Object.keys(nb)])) if ((na[key] ?? 0) !== (nb[key] ?? 0)) names[key] = [na[key] ?? 0, nb[key] ?? 0];
const totals = {};
for (const key of new Set([...Object.keys(a.randomTotals ?? {}), ...Object.keys(b.randomTotals ?? {})])) {
  const x = a.randomTotals?.[key] ?? 0, y = b.randomTotals?.[key] ?? 0;
  if (x !== y && !skipRandom.some(s => key.includes(s))) totals[key] = [x, y];
}

const result = {
  first: `${a.scenario}.${a.label}`, second: `${b.scenario}.${b.label}`, frames: [a.frames.length, b.frames.length],
  same: first < 0 && a.frames.length === b.frames.length && JSON.stringify(a.memo) === JSON.stringify(b.memo) && JSON.stringify(a.after) === JSON.stringify(b.after),
  // Every frame of play and every event the same; only the gore system's counts (how bodies and limbs lie) differ.
  bodiesOnly: bodiesOnly && JSON.stringify(a.memo) === JSON.stringify(b.memo) && JSON.stringify(a.after) === JSON.stringify(b.after),
  firstPlayDifference: firstPlay,
  firstDifference: first < 0 ? null : { frame: first, seconds: +(first * 0.016).toFixed(2), what: differs(first) },
  firstRandomDifference: firstRandom,
  eventCounts: names, randomTotals: totals, newPayloadKeys: Object.fromEntries(extraKeys), errors: [a.errors, b.errors],
  after: same(JSON.stringify(a.after), JSON.stringify(b.after)) ? 'same' : [a.after, b.after],
  memo: JSON.stringify(a.memo) === JSON.stringify(b.memo) ? 'same' : [a.memo, b.memo],
};
if (argv.includes('--json')) console.log(JSON.stringify(result));
else {
  console.log(`${result.first} against ${result.second}: ${result.frames[0]} and ${result.frames[1]} frames`);
  if (result.same) console.log('SAME: every frame, every event.');
  else if (first < 0 && a.frames.length !== b.frames.length) console.log(`Same for the ${frames} frames both have; the lengths differ.`);
  else if (first < 0) console.log('Every frame and event is the same; the end state or the bot\'s notebook is not.');
  else {
    if (result.bodiesOnly) console.log('SAME PLAY: every frame of play and every event; only how the dead lie differs (the gore counts), from the frame below.');
    else if (firstPlay > first) console.log(`The play itself first differs at frame ${firstPlay} (${(firstPlay * 0.016).toFixed(2)} s); before that only how the dead lie.`);
    console.log(`FIRST DIFFERENCE at frame ${first} (${result.firstDifference.seconds} s):`);
    for (const line of result.firstDifference.what) console.log(`  ${line}`);
    for (let f = first + 1; f <= first + context && f < frames; f++) { const d = differs(f); if (d.length) { console.log(`  frame ${f}:`); for (const line of d.slice(0, 8)) console.log(`    ${line}`); } }
    const r = randomDiff(first - 3, first + 1);
    if (r.length) { console.log('  random calls that differ around it (caller: first | second):'); for (const d of r.slice(0, 12)) console.log(`    frame ${d.frame} ${d.caller}: ${d.first} | ${d.second}`); }
  }
  if (firstRandom) { console.log(`First frame where a caller drew a different number of random numbers: ${firstRandom[0].frame}`); for (const d of firstRandom.slice(0, 8)) console.log(`  ${d.caller}: ${d.first} | ${d.second}`); }
  if (extraKeys.size) console.log(`Payload fields only one build has (set aside): ${[...extraKeys].map(([k, side]) => `${k} (${side})`).join(', ')}`);
  if (Object.keys(names).length) { console.log('Event counts that differ over the whole run (first | second):'); for (const [k, v] of Object.entries(names)) console.log(`  ${k}: ${v[0]} | ${v[1]}`); }
  if (Object.keys(totals).length) { console.log('Random calls by caller that differ over the whole run (first | second):'); for (const [k, v] of Object.entries(totals).slice(0, 40)) console.log(`  ${k}: ${v[0]} | ${v[1]}`); }
  if (a.errors.length || b.errors.length) console.log(`Page errors: ${a.errors.length} | ${b.errors.length}`, a.errors.slice(0, 3), b.errors.slice(0, 3));
  if (result.after !== 'same') console.log('End state:', JSON.stringify(a.after), '|', JSON.stringify(b.after));
  if (result.memo !== 'same') console.log("The bot's notebook differs:", JSON.stringify(a.memo).slice(0, 2000), '|', JSON.stringify(b.memo).slice(0, 2000));
}
// 0 the same; 3 the same play with the dead lying differently; 1 different.
process.exit(result.same ? 0 : result.bodiesOnly ? 3 : 1);
