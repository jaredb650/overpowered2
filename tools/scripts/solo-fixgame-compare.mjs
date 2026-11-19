// Compares two records of tools/scripts/solo-fixgame.mjs (the same scripted single-player run on two builds) and says, part
// by part, whether they are the same and where they first part ways.
//
//   node tools/scripts/solo-fixgame-compare.mjs <dir>/solo-dev.json <dir>/solo-mine.json
import { readFileSync } from 'node:fs';

const [a, b] = process.argv.slice(2).map(path => JSON.parse(readFileSync(path, 'utf8')));
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
const lines = [];
let differ = 0;
const say = (part, ok, detail = '') => { if (!ok) differ++; lines.push(`${ok ? 'same  ' : 'DIFFER'}  ${part}${detail ? `: ${detail}` : ''}`); };

if (a.errors?.length || b.errors?.length) say('errors', false, JSON.stringify({ [a.name]: a.errors, [b.name]: b.errors }).slice(0, 600));

// 1. The long run: sample by sample, field by field.
{
  let first = null;
  for (let i = 0; i < Math.max(a.run.length, b.run.length); i++) {
    const x = a.run[i], y = b.run[i];
    if (same(x, y)) continue;
    const fields = x && y ? Object.keys(x).filter(k => !same(x[k], y[k])) : ['missing'];
    first = { frame: (x ?? y).f, fields, [a.name]: x && Object.fromEntries(fields.map(k => [k, x[k]])), [b.name]: y && Object.fromEntries(fields.map(k => [k, y[k]])) };
    break;
  }
  const last = a.run.at(-1);
  say(`the long run (${a.run.length} samples, ${last ? last.f : 0} frames, ${last ? last.draws : 0} random draws, ${last ? last.enemies : 0} enemies at the end)`, first === null, first ? JSON.stringify(first).slice(0, 700) : '');
}

// 2. The pod.
{
  const facing = r => r.pod?.seen?.find(s => s?.phase === 'falling');
  const drawn = r => { const s = r.pod?.seen ?? []; const i = s.findIndex(x => x && x.draws > r.pod.atCall); return i < 0 ? null : s[i].phase; };
  say(`the pod's facing (${facing(a)?.yaw}), and that it is drawn as it starts to fall (${drawn(a)})`, same(a.pod, b.pod), same(a.pod, b.pod) ? '' : JSON.stringify({ [a.name]: [facing(a), drawn(a), a.pod?.atCall], [b.name]: [facing(b), drawn(b), b.pod?.atCall] }));
}

// 3. The call-ins.
for (const id of Object.keys(a.strikes ?? {})) {
  const x = a.strikes[id], y = b.strikes?.[id];
  const ok = same(x?.rounds, y?.rounds) && x?.yaw === y?.yaw;
  let detail = '';
  if (!ok) {
    const i = (x?.rounds ?? []).findIndex((r, k) => !same(r, y?.rounds?.[k]));
    detail = JSON.stringify({ count: [x?.rounds?.length, y?.rounds?.length], firstDifferent: i, [a.name]: x?.rounds?.[i] ?? x?.yaw, [b.name]: y?.rounds?.[i] ?? y?.yaw });
  }
  say(`${id}: ${x?.rounds?.length ?? 0} rounds${x?.yaw === null || x?.yaw === undefined ? '' : `, facing ${x.yaw}`}`, ok, detail);
}

// 4. The tank.
{
  const ok = same(a.tank?.said, b.tank?.said) && a.tank?.bomberAlive === b.tank?.bomberAlive;
  say(`a Bomber shot dead beside a bystander: ${a.tank?.said?.length ?? 0} sounds and markers (${[...new Set(a.tank?.said ?? [])].join(' ')})`, ok,
    ok ? '' : JSON.stringify({ [a.name]: a.tank?.said, [b.name]: b.tank?.said }).slice(0, 900));
}

console.log(`${a.name} against ${b.name}`);
for (const line of lines) console.log(`  ${line}`);
process.exit(differ ? 1 : 0);
