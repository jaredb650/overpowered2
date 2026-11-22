/** Tests for the Point Defence active protection turret plug-in and its 3D model. */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Ctx, DamageInfo } from '../../core/contracts';
import type { EnemyInstance } from '../../core/gameplay';
import type { MechKind } from '../../progression/callins/link';
import { ModelBuilder } from '../../progression/modelkit';
import type { GunnerWeapon } from '../../vehicles/hud';
import { buildPointDef, SHOULDER_POINTDEF } from '../models/shoulder-pointdef';
import {
  POINTDEF_COOLDOWN,
  POINTDEF_INTERCEPT_RADIUS,
  POINTDEF_MAX_CHARGES,
  POINTDEF_PLUGIN,
  POINTDEF_REFILL_SECONDS,
  POINTDEF_ZAP_DAMAGE,
  POINTDEF_ZAP_RADIUS,
  POINTDEF_ZAP_RATE,
  PointDefShoulder,
} from './pointdef';
import type { ShoulderUpdateContext } from './types';

const DT = 1 / 60;

interface MockThreat {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  live: boolean;
}

function makeEnemy(uid: number, x: number, z: number, y = 0): EnemyInstance {
  return {
    uid,
    id: 'trooper',
    char: null as unknown as EnemyInstance['char'],
    position: new THREE.Vector3(x, y, z),
    velocity: new THREE.Vector3(),
    yaw: 0,
    health: 100,
    maxHealth: 100,
    armor: 0,
    alive: true,
    score: 100,
    center: new THREE.Vector3(x, y + 1, z),
    isBoss: false,
    frozen: 0,
    burning: 0,
    machine: false,
  };
}

function makeHarness(enemiesList: EnemyInstance[] = [], threats: MockThreat[] = []) {
  const hits = new Map<number, number[]>();
  const tracers: { from: THREE.Vector3; to: THREE.Vector3; kind: string }[] = [];
  const sounds: string[] = [];
  const news: { kind: MechKind; values: number[] }[] = [];
  let interceptRadiusSeen = 0;

  const ctx = {
    combat: {
      interceptEnemyProjectiles: (
        center: THREE.Vector3,
        radius: number,
        max: number,
        onIntercept?: (at: THREE.Vector3) => void,
      ): number => {
        interceptRadiusSeen = radius;
        const r2 = radius * radius;
        let n = 0;
        for (const t of threats) {
          if (!t.live || n >= max) continue;
          if (t.pos.distanceToSquared(center) <= r2) {
            t.live = false;
            onIntercept?.(t.pos);
            n++;
          }
        }
        return n;
      },
    },
    enemies: {
      alive: enemiesList,
      query: (origin: THREE.Vector3, radius: number, out: EnemyInstance[]) => {
        out.length = 0;
        const r2 = radius * radius;
        for (const e of enemiesList) {
          if (e.alive && e.position.distanceToSquared(origin) <= r2) out.push(e);
        }
        return out.length;
      },
      applyDamage: (e: EnemyInstance, info: DamageInfo) => {
        const list = hits.get(e.uid) ?? [];
        list.push(info.amount);
        hits.set(e.uid, list);
        e.health -= info.amount;
        if (e.health <= 0) e.alive = false;
      },
    },
    physics: {
      raycast: () => null,
    },
    fx: {
      tracer: (from: THREE.Vector3, to: THREE.Vector3, kind: string) => {
        tracers.push({ from: from.clone(), to: to.clone(), kind });
      },
      muzzleFlash: () => undefined,
      sparks: () => undefined,
      ring: () => undefined,
      smoke: () => undefined,
    },
    audio: {
      play: (id: string) => sounds.push(id),
    },
    render: {
      lights: { flash: () => undefined },
    },
  } as unknown as Ctx;

  const makeUpdate = (online = true): ShoulderUpdateContext => ({
    ctx,
    rounds: null as unknown as ShoulderUpdateContext['rounds'],
    slot: 0,
    keyLabel: 'G',
    cycleKeyLabel: '3',
    sight: {
      view: { position: new THREE.Vector3(0, 5, 0) } as ShoulderUpdateContext['sight']['view'],
      aim: new THREE.Vector3(0, 0, -1),
      point: new THREE.Vector3(0, 1, -40),
      range: 40,
    },
    mountPos: out => out.set(1.5, 6.2, -0.5),
    feet: new THREE.Vector3(0, 0, 0),
    torsoYaw: 0,
    held: false,
    pressed: false,
    cyclePressed: false,
    online,
    gatherTargets: () => [],
    onMissile: null,
    onNews: (kind, values) => news.push({ kind, values }),
    popFreeFlares: () => undefined,
  });

  return { ctx, hits, tracers, sounds, news, getRadius: () => interceptRadiusSeen, makeUpdate };
}

describe('Point Defence active protection plug-in', () => {
  it('passively intercepts enemy projectiles within 15 m, respects 6 charges and 0.6 s cooldown, and refills 1 every 3.0 s', () => {
    const threats: MockThreat[] = [
      { pos: new THREE.Vector3(0, 2, -12), vel: new THREE.Vector3(0, 0, 20), live: true },
      { pos: new THREE.Vector3(0, 2, -10), vel: new THREE.Vector3(0, 0, 20), live: true },
      { pos: new THREE.Vector3(0, 2, -25), vel: new THREE.Vector3(0, 0, 20), live: true }, // out of 15 m range
    ];
    const h = makeHarness([], threats);
    const pd = POINTDEF_PLUGIN.create(h.ctx) as PointDefShoulder;

    expect(pd.charges).toBe(POINTDEF_MAX_CHARGES);

    // Passive update with no key pressed intercepts threat #1 immediately.
    pd.update(DT, h.makeUpdate());
    expect(h.getRadius()).toBe(POINTDEF_INTERCEPT_RADIUS);
    expect(threats[0]!.live).toBe(false);
    expect(threats[1]!.live).toBe(true); // held back by 0.6 s cooldown
    expect(threats[2]!.live).toBe(true); // outside 15 m
    expect(pd.charges).toBe(5);
    expect(h.tracers.some(t => t.kind === 'heavy')).toBe(true);
    expect(h.news.some(n => n.kind === 'pointdef' && n.values[6] === 1)).toBe(true);

    // Still on cooldown at 0.5 s.
    for (let i = 0; i < 30; i++) pd.update(DT, h.makeUpdate());
    expect(threats[1]!.live).toBe(true);
    expect(pd.charges).toBe(5);

    // Past 0.6 s cooldown, threat #2 is intercepted.
    for (let i = 0; i < 8; i++) pd.update(DT, h.makeUpdate());
    expect(threats[1]!.live).toBe(false);
    expect(pd.charges).toBe(4);

    // Drain remaining charges (note: 5 x 0.6 s = 3.0 s refills 1 charge mid-barrage, so 5 more intercepts reach 0).
    for (let k = 0; k < 5; k++) {
      threats.push({ pos: new THREE.Vector3(5, 2, -5), vel: new THREE.Vector3(0, 0, 10), live: true });
      for (let t = 0; t < POINTDEF_COOLDOWN + 0.02; t += DT) pd.update(DT, h.makeUpdate());
    }
    expect(pd.charges).toBe(0);

    // At 0 charges, a new threat cannot be intercepted until a charge refills.
    const blocked: MockThreat = { pos: new THREE.Vector3(2, 2, -2), vel: new THREE.Vector3(0, 0, 10), live: true };
    threats.push(blocked);
    for (let t = 0; t < POINTDEF_COOLDOWN + 0.02; t += DT) pd.update(DT, h.makeUpdate());
    expect(blocked.live).toBe(true);
    expect(pd.charges).toBe(0);

    // Refill 1 charge every 3.0 s (also works via idleUpdate).
    for (let t = 0; t < POINTDEF_REFILL_SECONDS + 0.05; t += DT) pd.idleUpdate(DT);
    expect(pd.charges).toBe(1);
  });

  it('zaps alive infantry within 6 m for 12 damage 3 times per second and spares distant enemies', () => {
    const close = makeEnemy(1, 0, -4);
    const edge = makeEnemy(2, POINTDEF_ZAP_RADIUS, 0);
    const far = makeEnemy(3, 0, -8);
    const h = makeHarness([close, edge, far], []);
    const pd = POINTDEF_PLUGIN.create(h.ctx) as PointDefShoulder;

    // Run for exactly 1.0 s (60 frames at 1/60).
    for (let i = 0; i < 60; i++) pd.update(DT, h.makeUpdate());

    expect(h.hits.get(1)).toEqual(Array(POINTDEF_ZAP_RATE).fill(POINTDEF_ZAP_DAMAGE));
    expect(h.hits.get(2)).toEqual(Array(POINTDEF_ZAP_RATE).fill(POINTDEF_ZAP_DAMAGE));
    expect(h.hits.has(3)).toBe(false);
    expect(close.health).toBe(100 - POINTDEF_ZAP_DAMAGE * POINTDEF_ZAP_RATE);
    // Close-in zap does not consume APS intercept charges.
    expect(pd.charges).toBe(POINTDEF_MAX_CHARGES);
  });

  it('populates the APS POINT DEFENCE HUD row and replays co-op remoteNews', () => {
    const threats: MockThreat[] = [{ pos: new THREE.Vector3(0, 2, -8), vel: new THREE.Vector3(), live: true }];
    const h = makeHarness([], threats);
    const pd = POINTDEF_PLUGIN.create(h.ctx) as PointDefShoulder;
    const row: GunnerWeapon = { name: '', ammo: 0, max: 0, reload: -1 };

    pd.fillRow(row, 'G', '3', true);
    expect(row.name).toBe('APS POINT DEFENCE');
    expect(row.ammo).toBe(6);
    expect(row.max).toBe(6);
    expect(row.reload).toBe(-1);

    // Spend 1 charge and check refill progress on row.
    pd.update(DT, h.makeUpdate());
    pd.idleUpdate(1.5);
    pd.fillRow(row, 'G', '3', true);
    expect(row.ammo).toBe(5);
    expect(row.reload).toBeCloseTo(0.5, 1);

    // Remote news replays intercept tracer & sound.
    const tracersBefore = h.tracers.length;
    POINTDEF_PLUGIN.remoteNews?.(h.ctx, 'pointdef', [1.5, 6.2, -0.5, 0, 2, -8, 1]);
    expect(h.tracers.length).toBe(tracersBefore + 1);
    expect(h.sounds).toContain('bullet_snap');
  });

  it('builds a valid 3D Point Defence dome turret model with solid and glow geometry', () => {
    const b = new ModelBuilder();
    SHOULDER_POINTDEF(b);
    expect(SHOULDER_POINTDEF).toBe(buildPointDef);
    expect(b.solidGeometry()).not.toBeNull();
    expect(b.glowGeometry()).not.toBeNull();
  });
});
