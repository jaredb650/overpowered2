/** Section 14 as arithmetic: where a round goes, what wounds add up to, and what bursts whom. No browser and no game. */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { HumanoidBone as B } from '../../characters/rig';
import { FACTIONS } from '../../contracts/data';
import type { DamageInfo } from '../../core/contracts';
import { Injuries } from './injuries';
import { bursts, WoundTuning, ZONES, type ZoneId } from './rules';
import { zoneOf, zoneOfRegion, type ZoneHit } from './zones';

const out: ZoneHit = { zone: 'thigh', side: 0, behind: false, glancing: false };
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
/** A round travelling toward his back, so in through his front. */
const FROM_FRONT = v(0, 0, -1);
/** A round travelling toward his front, so in through his back. */
const FROM_BEHIND = v(0, 0, 1);

const zone = (bone: number, p: THREE.Vector3, d: THREE.Vector3): ZoneId => zoneOf(bone, p, d, out).zone;

describe('zones', () => {
  it('finds the heart from either side, a little left of centre', () => {
    expect(zone(B.chest, v(0.035, 0.11, 0.17), FROM_FRONT)).toBe('heart');
    expect(zone(B.chest, v(0.035, 0.11, -0.16), FROM_BEHIND)).toBe('heart');
    expect(zone(B.chest, v(-0.12, 0.11, 0.15), FROM_FRONT)).toBe('lung');
    expect(zone(B.chest, v(0.2, 0.11, 0.1), FROM_FRONT)).toBe('lung');
  });

  it('only reaches the spine from behind', () => {
    expect(zone(B.spine, v(0, 0.08, -0.13), FROM_BEHIND)).toBe('spine');
    expect(zone(B.chest, v(-0.02, 0.2, -0.15), FROM_BEHIND)).toBe('spine');
    expect(zone(B.spine, v(0, 0.08, 0.13), FROM_FRONT)).toBe('gut');
    expect(zone(B.spine, v(0.1, 0.08, -0.1), FROM_BEHIND)).toBe('gut');
  });

  it('tells the belly from the pelvis on the hips bone', () => {
    expect(zone(B.hips, v(0, -0.05, 0.12), FROM_FRONT)).toBe('pelvis');
    expect(zone(B.hips, v(0, 0.09, 0.12), FROM_FRONT)).toBe('gut');
  });

  it('finds the femoral artery on the inside of the thigh, on both legs', () => {
    expect(zone(B.thighL, v(-0.038, -0.12, 0.08), FROM_FRONT)).toBe('innerThigh');
    expect(zone(B.thighR, v(0.038, -0.12, 0.08), FROM_FRONT)).toBe('innerThigh');
    expect(zone(B.thighL, v(0.06, -0.12, 0.06), FROM_FRONT)).toBe('thigh');
    expect(zone(B.thighL, v(-0.038, -0.4, 0.08), FROM_FRONT)).toBe('thigh');
  });

  it('calls shin and foot the leg, and keeps the side', () => {
    expect(zoneOf(B.shinR, v(0, -0.2, 0.06), FROM_FRONT, out).zone).toBe('thigh');
    expect(out.side).toBe(-1);
    expect(zoneOf(B.footL, v(0, -0.04, 0.1), FROM_FRONT, out).zone).toBe('thigh');
    expect(out.side).toBe(1);
  });

  it('splits an arm at the shoulder and keeps the hand apart', () => {
    expect(zone(B.upperArmL, v(0.02, -0.04, 0.06), FROM_FRONT)).toBe('shoulder');
    expect(zone(B.upperArmL, v(0.05, -0.2, 0.06), FROM_FRONT)).toBe('arm');
    expect(zone(B.foreArmR, v(0, -0.1, 0.05), FROM_FRONT)).toBe('arm');
    expect(zone(B.handR, v(0, -0.05, 0.05), FROM_FRONT)).toBe('hand');
  });

  it('takes a throat from the front or the side, and a neck from behind for the spine', () => {
    expect(zone(B.neck, v(0, 0.04, 0.06), FROM_FRONT)).toBe('carotid');
    expect(zone(B.neck, v(0.06, 0.04, 0), v(-1, 0, 0))).toBe('carotid');
    expect(zone(B.neck, v(0, 0.04, -0.06), FROM_BEHIND)).toBe('spine');
  });

  it('counts the underside of the head capsule as throat', () => {
    expect(zone(B.head, v(0.05, -0.05, 0.08), FROM_FRONT)).toBe('carotid');
    expect(zone(B.head, v(0, 0.12, 0.12), FROM_FRONT)).toBe('head');
  });

  it('lets a round skid off the edge of the skull and not the middle', () => {
    expect(zoneOf(B.head, v(0, 0.09, 0.125), FROM_FRONT, out).glancing).toBe(false);
    // Almost tangent: it enters at the side of the head, still travelling front to back.
    expect(zoneOf(B.head, v(0.105, 0.09, 0.03), FROM_FRONT, out).glancing).toBe(true);
    expect(out.zone).toBe('head');
  });

  it('falls back on the region for a hit with no bone', () => {
    expect(zoneOfRegion('armL', out).zone).toBe('arm');
    expect(out.side).toBe(1);
    expect(zoneOfRegion('shinR', out).zone).toBe('thigh');
    expect(zoneOfRegion('abdomen', out).zone).toBe('gut');
  });
});

describe('injuries', () => {
  const hit = (b: Injuries, zone: ZoneId, side: 1 | -1 | 0, share = 0.3, amount = 25) => b.add(zone, side, 0, 0, 0, 0, share, 'bullet', amount);

  it('stacks: two wounds slow and bleed more than either', () => {
    const b = new Injuries();
    hit(b, 'thigh', 1);
    const one = { speed: b.speed, bleed: b.bleed, aim: b.aim };
    hit(b, 'gut', 0);
    expect(b.speed).toBeLessThan(one.speed);
    expect(b.bleed).toBeGreaterThan(one.bleed);
    expect(b.aim).toBeGreaterThan(one.aim);
    expect(b.count).toBe(2);
  });

  it('deepens a wound rather than listing it twice', () => {
    const b = new Injuries();
    hit(b, 'thigh', 1);
    const bleed = b.bleed;
    hit(b, 'thigh', 1);
    expect(b.count).toBe(1);
    expect(b.bleed).toBeCloseTo(bleed * 2);
    hit(b, 'thigh', -1);
    expect(b.count).toBe(2);
  });

  it('wears a leg out: three SMG rounds destroy it, one Judge round does it alone', () => {
    const b = new Injuries();
    hit(b, 'thigh', 1, 0.27);
    hit(b, 'thigh', 1, 0.27);
    expect(b.legDestroyed).toBe(false);
    hit(b, 'thigh', 1, 0.27);
    expect(b.legDestroyed).toBe(true);
    const heavy = new Injuries();
    heavy.add('thigh', -1, 0, 0, 0, 0, 0.5, 'bullet', 120);
    expect(heavy.legDestroyed).toBe(true);
  });

  it('weapon character: a shotgun tears, fire seals', () => {
    const round = new Injuries();
    round.add('gut', 0, 0, 0, 0, 0, 0.3, 'bullet', 20);
    const pellet = new Injuries();
    pellet.add('gut', 0, 0, 0, 0, 0, 0.3, 'pellet', 20);
    expect(pellet.bleed).toBeGreaterThan(round.bleed);
    pellet.cauterise();
    expect(pellet.bleed).toBeLessThan(round.bleed * 0.2);
  });

  it('femoral takes him off his feet in about 8 s, even with a hand on it', () => {
    const b = new Injuries();
    hit(b, 'innerThigh', 1);
    b.held = b.worst();
    b.refresh();
    expect((1 - 0.3) / b.bleed).toBeGreaterThan(6);
    expect((1 - 0.3) / b.bleed).toBeLessThan(10);
  });

  it('a carotid has no voice and a clock of about 3 s', () => {
    const b = new Injuries();
    hit(b, 'carotid', 1);
    expect(b.mute).toBe(true);
    expect(ZONES.carotid.gone).toBe(3);
  });

  it('pressure slows the bleed, and costs a hand', () => {
    const b = new Injuries();
    hit(b, 'gut', 0);
    const open = { bleed: b.bleed, aim: b.aim };
    b.held = b.worst();
    b.refresh();
    expect(b.bleed).toBeCloseTo(open.bleed * (1 - WoundTuning.pressure));
    expect(b.aim).toBeGreaterThan(open.aim);
  });

  it('a dressing all but stops the worst wound, and the next is next', () => {
    const b = new Injuries();
    hit(b, 'innerThigh', 1);
    hit(b, 'arm', -1);
    const total = b.bleed;
    expect(b.worst()!.zone).toBe('innerThigh');
    expect(b.dressWorst()).toBe(true);
    expect(b.bleed).toBeLessThan(total * 0.3);
    expect(b.worst()!.zone).toBe('arm');
  });

  it('rapid hits pile up, and slow ones do not', () => {
    const b = new Injuries();
    expect(b.piledOn(0.36, 0)).toBe(false);
    expect(b.piledOn(0.36, 0.05)).toBe(false);
    expect(b.piledOn(0.36, 0.1)).toBe(true);
    const slow = new Injuries();
    for (let i = 0; i < 6; i++) expect(slow.piledOn(0.36, i * 1.5)).toBe(false);
  });

  it('a mortal man\'s aim collapses as he goes', () => {
    const b = new Injuries();
    hit(b, 'lung', 1);
    b.condition = 'mortal';
    b.mortalFrom = 10;
    b.mortalUntil = 14;
    expect(b.aimNow(14)).toBeGreaterThan(b.aimNow(10) * 3);
  });

  it('counts both arms, in any mix of arm and hand', () => {
    const b = new Injuries();
    b.handL = true;
    expect(b.armless).toBe(false);
    b.armR = true;
    expect(b.armless).toBe(true);
  });

  it('comes out of the pool whole', () => {
    const b = new Injuries();
    hit(b, 'spine', 0);
    b.floored = true;
    b.clear();
    expect(b.whole).toBe(true);
    expect(b.canStand).toBe(true);
    expect(b.count).toBe(0);
    expect(b.bleed).toBe(0);
  });

  it('spine and pelvis are a man who will not stand again', () => {
    for (const z of ['spine', 'pelvis'] as const) {
      const b = new Injuries();
      hit(b, z, 0);
      expect(b.paralysed).toBe(true);
      expect(b.canStand).toBe(false);
    }
  });
});

describe('what bursts a body', () => {
  const d = (over: Partial<DamageInfo>): DamageInfo => ({
    amount: 100, type: 'explosive', point: v(0, 0, 0), dir: v(0, 1, 0), force: 0, source: 'test', ...over,
  });
  const { humans, swarm } = FACTIONS;

  it('the swarm bursts exactly as it always has', () => {
    const old = (x: DamageInfo, max: number, overkill: boolean) => x.gib === true || (x.type === 'explosive' && (overkill || x.amount >= max));
    for (const type of ['explosive', 'bullet', 'pellet', 'slash', 'fire'] as const) {
      for (const gib of [undefined, true]) {
        for (const bone of [undefined, 2]) {
          for (const amount of [10, 50, 100, 400]) {
            for (const overkill of [false, true]) {
              const x = d({ type, gib, bone, amount });
              expect(bursts(swarm, x, 70, overkill)).toBe(old(x, 70, overkill));
            }
          }
        }
      }
    }
  });

  it('a direct rocket or cannon round bursts a man', () => {
    expect(bursts(humans, d({ gib: true, bone: 2 }), 70, false)).toBe(true);
    expect(bursts(humans, d({ type: 'bullet', gib: true, bone: 2, amount: 99999 }), 70, false)).toBe(true);
  });

  it('a blast beside him does not, however much it hurts', () => {
    expect(bursts(humans, d({ amount: 100 }), 70, true)).toBe(false);
    expect(bursts(humans, d({ gib: true, amount: 90 }), 70, false)).toBe(false);
    expect(bursts(humans, d({ gib: true, amount: 150 }), 70, false)).toBe(false);
  });

  it('point-blank explosives do', () => {
    expect(bursts(humans, d({ gib: true, amount: 180 }), 70, false)).toBe(true);
    expect(bursts(humans, d({ gib: true, amount: 99999 }), 70, false)).toBe(true);
  });

  it('a bullet never does', () => {
    expect(bursts(humans, d({ type: 'bullet', amount: 500 }), 70, true)).toBe(false);
  });
});
