/** The AA sentry: it shoots down drones and missiles, and leaves the men on the ground alone. */
import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Ctx } from '../../core/contracts';
import type { EnemyId } from '../../core/gameplay';
import { noop } from '../../core/stubs';
import { makeRange, type Dummy, type Range } from '../../weapons/testkit';
import { ASSIST_SOURCES, SENTRY } from '../data';
import { ModelMaterials } from '../modelkit';
import type { AntiAir, Missile } from './antiAir';
import { GroundProbe } from './ground';
import { Sentry, SentryRig } from './sentry';
import type { StrikeKit } from './shared';

let r: Range;
let kit: StrikeKit;
let rig: SentryRig;
let missiles: Missile[];
const sky = { get missiles() { return missiles; } } as unknown as AntiAir;
/** Seconds from the call to the guns being up. */
const UP = SENTRY.warn + SENTRY.height / SENTRY.speed + SENTRY.unfold + 0.2;

beforeEach(async () => {
  r = await makeRange();
  r.reset();
  missiles = [];
  const ctx = r.ctx as Ctx & Record<string, unknown>;
  const scene = new THREE.Scene();
  const render = ctx.render;
  ctx.render = new Proxy(render, {
    get: (t, k) => (k === 'scene' ? scene : k === 'materials' ? { patch: (m: THREE.Material) => m } : Reflect.get(t, k)),
  });
  ctx.hud = { feed() {}, marker: () => () => {}, follow: () => () => {}, hitMarker() {} } as unknown as Ctx['hud'];
  const materials = new ModelMaterials(r.ctx);
  kit = { ctx: r.ctx, probe: new GroundProbe(r.ctx), materials, ordnance: noop('ordnance'), jet: new THREE.Group() };
  rig = new SentryRig(materials, scene);
});

function add(id: EnemyId, x: number, z: number, y = 0, health = 100000): Dummy {
  const d = r.enemies.add(x, z, health, y);
  (d as { id: EnemyId }).id = id;
  return d;
}

function run(sentry: Sentry, seconds: number): boolean {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    r.ctx.time.tick(1 / 60);
    r.combat.update();
    if (sentry.update(1 / 60)) return true;
  }
  return false;
}

const call = () => new Sentry(kit, { point: new THREE.Vector3(0, 0, 0), heading: new THREE.Vector3(1, 0, 0) }, rig, sky);
const fromSentry = (d: Dummy) => d.hits.filter(h => h.source === 'sentry').length;

describe('the AA sentry', () => {
  it('shoots down a drone and never fires on the man under it', () => {
    const man = add('trooper', 9, -9);
    const drone = add('drone', 12, -20, 8, 70);
    const sentry = call();
    run(sentry, UP + 3);
    expect(drone.alive).toBe(false);
    expect(fromSentry(drone)).toBeGreaterThan(0);
    expect(fromSentry(man)).toBe(0);
    expect(r.record.tracers.length).toBeGreaterThan(0);
    // Its kills are a strike's: they pay, and climb the combo at the assist rate.
    expect(ASSIST_SOURCES.test('sentry')).toBe(true);
  });

  it('bursts a missile it holds in its sight', () => {
    const body = new THREE.Object3D();
    body.position.set(-20, 30, -30);
    r.ctx.render.scene.add(body);
    const missile = { body, velocity: new THREE.Vector3(), target: {}, decoy: null, age: 0, smokeIn: 0, reactAt: -1, reacted: false } as unknown as Missile;
    missiles = [missile];
    const sentry = call();
    run(sentry, UP + 1.5);
    expect(missile.target).toBeNull();
  });

  it('leaves out of range drones alone, and stands down after its minute', () => {
    const far = add('drone', 0, -(SENTRY.range + 20), 8);
    const sentry = call();
    expect(run(sentry, UP + SENTRY.life + 3)).toBe(true);
    expect(fromSentry(far)).toBe(0);
    expect(rig.root.visible).toBe(false);
  });
});
