/** The lower level: service tunnels that link every zone below ground and make a full loop around the map. */
import type { Kit } from '../kit/kit';
import { cable, pipe, signPanel, vent } from '../kit/props';
import { signId, type SignName } from '../kit/signs';
import type { MapSpec } from './spec';
import { BOWL, LAVA, LEVEL, PIT, SUMP, TRENCH } from './layout';

const W = 11;

/** A straight tunnel. Keep the ceiling below y = -2, where the ground slab starts. */
export function tunnel(k: Kit, ax: number, ay: number, az: number, bx: number, by: number, bz: number, w = W, h = 5, sign?: SignName): void {
  const g = k.geo;
  k.along(ax, ay, az, bx, by, bz, len => {
    g.use('concreteDark').gridStep(0, 0, w / 2, len, 0, 0, 0, 0, -w, 3);
    k.collide(len / 2, -0.5, 0, len / 2, 0.5, w / 2 + 1, 'concrete');
    g.use('concreteDark').tint(0.7).gridStep(0, h, -w / 2, len, 0, 0, 0, 0, w, 3);
    g.tint(1);
    k.collide(len / 2, h + 0.5, 0, len / 2, 0.5, w / 2 + 1, 'concrete');

    const strip = { mat: 'emissiveCyan' as const, y: 1.25, h: 0.08 };
    k.push(0, 0, -w / 2 - 0.4);
    k.wallLocal(len, 0, h, { thick: 0.6, bay: 6, lift: 2.6, cap: false, strip, mat: 'panel', surface: 'concrete' });
    k.pop();
    k.push(len, 0, w / 2 + 0.4, Math.PI);
    k.wallLocal(len, 0, h, { thick: 0.6, bay: 6, lift: 2.6, cap: false, strip, mat: 'panel', surface: 'concrete' });
    k.pop();

    // Ribs and hanging services give the long run a rhythm you feel at speed.
    for (let u = 3; u < len; u += 6) {
      g.use('concrete').tint(0.72).bevel(u, h - 0.28, 0, 0.32, 0.28, w / 2, 0.05);
      g.tint(1);
    }
    for (let u = 6; u < len - 2; u += 12) k.lampBar(u, h - 0.58, 0, 0, 2.6, 'white', 13, 12);
    pipe(k, [0.4, h - 0.9, -w / 2 + 0.5, len - 0.4, h - 0.9, -w / 2 + 0.5], 0.22, 'steel', 8, 8);
    pipe(k, [0.4, h - 1.5, -w / 2 + 0.45, len - 0.4, h - 1.5, -w / 2 + 0.45], 0.14, 'steelDark', 8, 6);
    g.use('steelDark').bevel(len / 2, h - 0.8, w / 2 - 0.3, len / 2, 0.05, 0.25, 0.02);
    for (let u = 8; u < len; u += 16) cable(k, u, h - 0.75, w / 2 - 0.3, u + 8, h - 0.75, w / 2 - 0.3, 0.32, 0.03);
    if (sign) signPanel(k, len / 2, h - 1.6, w / 2 - 0.05, Math.PI, 4.4, 1.1, signId(sign));
  });
}

/** Square junction room joining tunnels. `open` lists sides with no wall: n, e, s, w. */
function chamber(k: Kit, cx: number, cz: number, y: number, half: number, h: number, open: string): void {
  const g = k.geo;
  const x0 = cx - half, x1 = cx + half, z0 = cz - half, z1 = cz + half;
  k.floor('concreteDark', x0, z0, x1, z1, y, 1, 3);
  g.use('concreteDark').tint(0.7).gridStep(x0, y + h, z0, x1 - x0, 0, 0, 0, 0, z1 - z0, 3);
  g.tint(1);
  k.collide(cx, y + h + 0.5, cz, half + 1, 0.5, half + 1, 'concrete');
  const o = { thick: 0.6, bay: 7, lift: 2.6, cap: false, mat: 'panel' as const, surface: 'concrete' as const, strip: { mat: 'emissiveCyan' as const, y: y + 1.25, h: 0.08 } };
  const doorW = W + 1.6;
  const edge = (ax: number, az: number, bx: number, bz: number, isOpen: boolean) => {
    const len = Math.hypot(bx - ax, bz - az);
    const u0 = (len - doorW) / 2;
    k.wall(ax, az, bx, bz, y, y + h, isOpen ? { ...o, openings: [{ u0, u1: u0 + doorW, v0: y, v1: y + h }] } : o);
  };
  edge(x0, z0, x1, z0, open.includes('n'));
  edge(x1, z0, x1, z1, open.includes('e'));
  edge(x1, z1, x0, z1, open.includes('s'));
  edge(x0, z1, x0, z0, open.includes('w'));
  k.lampBar(cx, y + h - 0.25, cz, 0, 4, 'white', 30, 18);
  vent(k, x0 + 0.5, y + 2.4, cz, Math.PI / 2, 2.4, 1.4);
}

export function authorLower(k: Kit, spec: MapSpec): void {
  const r = BOWL.radius + 0.5;
  // Spokes from the arena doors. Arena floor is one meter below the rest of the lower level.
  tunnel(k, 0, LEVEL.arena, -r, 0, LAVA.galleryY, LAVA.galleryZ1, W, 5.2, 'FOUNDRY');
  tunnel(k, r, LEVEL.arena, 0, SUMP.x0, SUMP.y, 0, W, 5.2, 'REFINERY');
  tunnel(k, 0, LEVEL.arena, r, 0, PIT.y, PIT.z0, W, 5.2, 'SCRAPYARD');
  tunnel(k, -r, LEVEL.arena, 0, TRENCH.x1, TRENCH.y, 0, W, 5.2, 'TRANSIT');

  // Outer lower loop. Corners are junction chambers.
  const y = LEVEL.lower;
  const yOuter = 112, half = 8;
  // West end of Foundry gallery to the north end of the trench.
  chamber(k, -105, -100, y, half, 5, 'se');
  tunnel(k, -105, y, TRENCH.z0, -105, y, -100 + half, W, 5, 'TRANSIT');
  tunnel(k, -105 + half, y, -98, LAVA.x0, LAVA.galleryY, -98, W, 5, 'FOUNDRY');
  // East end of the gallery to the north end of the sump.
  chamber(k, 112, -100, y, half, 5, 'sw');
  tunnel(k, 112, y, SUMP.z0, 112, y, -100 + half, W, 5, 'REFINERY');
  tunnel(k, 112 - half, y, -98, LAVA.x1, LAVA.galleryY, -98, W, 5, 'FOUNDRY');
  // South end of the trench to the west side of the pit.
  chamber(k, -105, yOuter, y, half, 5, 'ne');
  tunnel(k, -105, y, TRENCH.z1, -105, y, yOuter - half, W, 5, 'TRANSIT');
  tunnel(k, -105 + half, y, yOuter, PIT.x0, PIT.y, yOuter, W, 5, 'SCRAPYARD');
  // South end of the sump to the east side of the pit.
  chamber(k, 112, yOuter, y, half, 5, 'nw');
  tunnel(k, 112, y, SUMP.z1, 112, y, yOuter - half, W, 5, 'REFINERY');
  tunnel(k, 112 - half, y, yOuter, PIT.x1, PIT.y, yOuter, W, 5, 'SCRAPYARD');

  spec.view('tunnel', 0, LEVEL.arena + 1.8, 56, 0, LEVEL.arena + 1.2, 90);
  spec.view('tunnel_outer', 4, y + 1.7, 112, 60, y + 1.6, 112);
  spec.gate('foundry', -105, y + 0.1, -100);
  spec.gate('refinery', 112, y + 0.1, -100);
  spec.gate('transit', -105, y + 0.1, yOuter);
  spec.gate('scrapyard', 112, y + 0.1, yOuter);
  spec.pickup(112, y + 1, yOuter);
  spec.pickup(-105, y + 1, -100);
}
