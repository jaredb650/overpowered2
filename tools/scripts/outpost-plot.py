#!/usr/bin/env python3
"""Reads an Outpost trail and proves what the squads did, in numbers and in a top-down picture.

   python3 tools/scripts/outpost-plot.py tools/out/outpost-hold.json [panels] [t0] [t1]

Works on the JSON from outpost-sim.ts and from the browser run, outpost-trails.mjs. Writes a PNG beside the JSON: `panels` side
by side windows of time, each showing where every man went in that window. Blue and cyan are one squad's two teams, red and
orange the next. A filled dot is the end of a trail, X is a death, the white ring is the player.
"""
import json, math, sys
from collections import defaultdict
from PIL import Image, ImageDraw

path = sys.argv[1]
panels = int(sys.argv[2]) if len(sys.argv) > 2 else 4
d = json.load(open(path))
samples = d['samples']
T0 = float(sys.argv[3]) if len(sys.argv) > 3 else samples[0]['t']
T1 = float(sys.argv[4]) if len(sys.argv) > 4 else samples[-1]['t']
samples = [s for s in samples if T0 <= s['t'] <= T1]
plan = d['plan']
EXT, PX = 42, 9
SIZE = EXT * 2 * PX
TEAM = {
    0: [(70, 150, 255), (70, 230, 255)], 1: [(255, 80, 70), (255, 170, 60)], 2: [(120, 230, 90), (210, 240, 90)],
    3: [(220, 110, 255), (255, 130, 210)], 4: [(255, 255, 255), (190, 190, 190)],
}
sx = lambda x: (x + EXT) * PX
sy = lambda z: (z + EXT) * PX


def base():
    im = Image.new('RGB', (SIZE, SIZE), (14, 16, 20))
    g = ImageDraw.Draw(im)
    for s in plan['spots']:
        g.point((sx(s[0]), sy(s[2])), fill=(60, 70, 62) if s[1] < 1 else (40, 60, 90))
    for w in plan['walls']:
        g.line([sx(w['ax']), sy(w['az']), sx(w['bx']), sy(w['bz'])], fill=(120, 126, 136), width=max(2, int(w['half'] * 2 * PX)))
    for b in plan['blocks']:
        g.rectangle([sx(b['x0']), sy(b['z0']), sx(b['x1']), sy(b['z1'])], outline=(100, 104, 112))
    for o in plan['doors']:
        h = o['w'] / 2
        px, pz = -o['dz'] * h, o['dx'] * h
        g.line([sx(o['x'] - px), sy(o['z'] - pz), sx(o['x'] + px), sy(o['z'] + pz)], fill=(14, 16, 20), width=max(2, int(PX * 1.1)))
    for q in plan['gates']:
        g.rectangle([sx(q['x']) - 5, sy(q['z']) - 5, sx(q['x']) + 5, sy(q['z']) + 5], outline=(210, 60, 50))
    return im


squads = {}
for s in samples:
    for m in s['men']:
        if 'q' in m and m['q'] not in squads:
            squads[m['q']] = len(squads) % len(TEAM)

kills = [e for e in d['log'] if e['type'] == 'enemy:killed']
step = (T1 - T0) / panels
sheet = Image.new('RGB', (SIZE * min(panels, 3), SIZE * ((panels + 2) // 3)), (0, 0, 0))
for p in range(panels):
    a, b = T0 + p * step, T0 + (p + 1) * step
    im = base()
    g = ImageDraw.Draw(im)
    trails = defaultdict(list)
    tags = {}
    for s in samples:
        if not a <= s['t'] < b:
            continue
        for m in s['men']:
            trails[m['u']].append((m['x'], m['z']))
            tags[m['u']] = m
    for u, pts in trails.items():
        m = tags[u]
        col = TEAM[squads.get(m.get('q'), 4)][m.get('tm', 0)]
        if len(pts) > 1:
            g.line([(sx(x), sy(z)) for x, z in pts], fill=col, width=2)
        x, z = pts[-1]
        r = 5 if m.get('l') else 3
        g.ellipse([sx(x) - r, sy(z) - r, sx(x) + r, sy(z) + r], fill=col)
        if m.get('f') == 'surrender':
            g.rectangle([sx(x) - 6, sy(z) - 6, sx(x) + 6, sy(z) + 6], outline=(255, 255, 255))
    for k in kills:
        if a <= k['t'] < b:
            x, z = sx(k['x']), sy(k['z'])
            g.line([x - 5, z - 5, x + 5, z + 5], fill=(255, 40, 40), width=2)
            g.line([x - 5, z + 5, x + 5, z - 5], fill=(255, 40, 40), width=2)
    ps = [s for s in samples if a <= s['t'] < b]
    if ps:
        g.line([(sx(s['px']), sy(s['pz'])) for s in ps], fill=(255, 255, 255), width=1)
        x, z = sx(ps[-1]['px']), sy(ps[-1]['pz'])
        g.ellipse([x - 8, z - 8, x + 8, z + 8], outline=(255, 255, 255), width=2)
    g.text((10, 8), f"t {a:.0f}-{b:.0f}s  dread {ps[-1]['dread'] if ps else 0}  hostile {ps[-1]['hostile'] if ps else 0}  prisoners {ps[-1]['prisoners'] if ps else 0}", fill=(230, 230, 230))
    sheet.paste(im, ((p % 3) * SIZE, (p // 3) * SIZE))
png = path.replace('.json', '.png')
sheet.save(png)

print(f"{d['scenario']} seed {d.get('seed')}  {samples[0]['t']:.0f}-{samples[-1]['t']:.0f}s  wave {samples[-1]['wave']}  {json.dumps(d.get('stats', {}))}")

# Speed: human, with short sprints.
speeds = [m['v'] for s in samples for m in s['men'] if m.get('v', 0) > 0.6]
if speeds:
    speeds.sort()
    print(f"speed m/s: median {speeds[len(speeds)//2]:.1f}  p95 {speeds[int(len(speeds)*.95)]:.1f}  max {speeds[-1]:.1f}  share over 4.6: {sum(v > 4.6 for v in speeds)/len(speeds):.0%}")

# Modes per squad, as a time line.
lines = defaultdict(list)
for s in samples:
    seen = set()
    for m in s['men']:
        if 'q' in m and m['q'] not in seen and m['f'] == 'none':
            seen.add(m['q'])
            if not lines[m['q']] or lines[m['q']][-1][0] != m['m']:
                lines[m['q']].append((m['m'], s['t']))
for q, l in lines.items():
    print(f"{q}: " + ' > '.join(f"{m}@{t:.0f}" for m, t in l))

# Bounding: of the time a squad is moving at all, how often does one team move while the other is still?
def team_motion(modes):
    stats = defaultdict(lambda: [0, 0, 0])
    order = defaultdict(list)
    for s in samples:
        moving = defaultdict(lambda: [0, 0])
        count = defaultdict(lambda: [0, 0])
        for m in s['men']:
            if 'q' not in m or m['m'] not in modes or m['f'] != 'none':
                continue
            count[m['q']][m['tm']] += 1
            if m['v'] > 1:
                moving[m['q']][m['tm']] += 1
        for q, c in count.items():
            if c[0] == 0 or c[1] == 0:
                continue
            a, b = moving[q]
            if a and b:
                stats[q][2] += 1
            elif a or b:
                stats[q][0 if a else 1] += 1
                t = 0 if a else 1
                if not order[q] or order[q][-1] != t:
                    order[q].append(t)
    return stats, order

for name, modes in (('bounding (advance)', ('advance',)), ('fire and manoeuvre (engage)', ('engage',)), ('fallback', ('fallback',))):
    stats, order = team_motion(modes)
    for q, (a, b, both) in stats.items():
        total = a + b + both
        if total:
            print(f"{name} {q}: one team moving {100*(a+b)/total:.0f}% of moving time, both {100*both/total:.0f}%, handovers {max(0, len(order[q])-1)}")

# Flanking: how far round the player do a squad's two teams get from each other, and two squads from each other?
def bearing(x, z, s):
    return math.atan2(x - s['px'], z - s['pz'])

def gap(a, b):
    return abs((a - b + math.pi) % (2 * math.pi) - math.pi)

spread = defaultdict(float)
cross = 0.0
for s in samples:
    cent = defaultdict(lambda: [0, 0, 0])
    sq = defaultdict(lambda: [0, 0, 0])
    for m in s['men']:
        if 'q' not in m or m['m'] != 'engage' or m['f'] != 'none':
            continue
        c = cent[(m['q'], m['tm'])]
        c[0] += m['x']; c[1] += m['z']; c[2] += 1
        c = sq[m['q']]
        c[0] += m['x']; c[1] += m['z']; c[2] += 1
    for (q, t), c in cent.items():
        o = cent.get((q, 1 - t))
        if o and o[2]:
            spread[q] = max(spread[q], gap(bearing(c[0]/c[2], c[1]/c[2], s), bearing(o[0]/o[2], o[1]/o[2], s)))
    keys = list(sq)
    for i in range(len(keys)):
        for j in range(i + 1, len(keys)):
            a, b = sq[keys[i]], sq[keys[j]]
            cross = max(cross, gap(bearing(a[0]/a[2], a[1]/a[2], s), bearing(b[0]/b[2], b[1]/b[2], s)))
for q, v in spread.items():
    print(f"flank {q}: teams up to {math.degrees(v):.0f} degrees apart around the player")
if cross:
    print(f"crossfire: squads up to {math.degrees(cross):.0f} degrees apart around the player")

# Fallback: squad distance from the player across each fallback, sampled.
for q in lines:
    runs, cur = [], None
    for s in samples:
        ms = [m for m in s['men'] if m.get('q') == q and m['f'] == 'none']
        if not ms:
            continue
        dist = sum(math.hypot(m['x'] - s['px'], m['z'] - s['pz']) for m in ms) / len(ms)
        if ms[0]['m'] == 'fallback':
            if cur is None:
                cur = []
                runs.append(cur)
            cur.append((s['t'], dist))
        else:
            cur = None
    for r in runs:
        print(f"fallback {q}: {r[0][0]:.0f}-{r[-1][0]:.0f}s, range {r[0][1]:.1f} m to {r[-1][1]:.1f} m")

# Posture and cover.
tally = defaultdict(int)
held = covered = 0
for s in samples:
    for m in s['men']:
        if 'pose' in m:
            tally[m['pose']] += 1
        if m.get('b') == 'hold':
            held += 1
            covered += m.get('sp', 0)
total = sum(tally.values()) or 1
print('poses: ' + ' '.join(f"{k} {100*v/total:.0f}%" for k, v in sorted(tally.items(), key=lambda kv: -kv[1])))
if held:
    print(f"holding men with a cover spot: {100*covered/held:.0f}%")

stalls = defaultdict(int)
worst = 0
for s in samples:
    for m in s['men']:
        if m.get('k') == 'move' and m['v'] < 0.3 and m.get('a', '') == '':
            stalls[m['u']] += 1
            worst = max(worst, stalls[m['u']])
        else:
            stalls[m['u']] = 0
print(f"longest stall while told to move: {worst * .25:.1f} s")

kinds = defaultdict(int)
for e in d['log']:
    if e['type'] == 'comms:line':
        kinds[e['kind']] += 1
    elif e['type'] != 'enemy:killed':
        kinds[e['type']] += 1
print('events: ' + ' '.join(f"{k}:{v}" for k, v in sorted(kinds.items())))
print(png)
