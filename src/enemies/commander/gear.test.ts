/**
 * What a man wears says what he is (section 16.5: a tell on everything). In co-op the host says it for each man and a
 * guest dresses its copy by that word: a guest's own Commander fields nothing and its own roll of a man's rank is not the
 * host's, so the tells were missing or on the wrong man on a guest's screen.
 *
 * The real Commander and his real props on a stand-in Outpost and world.
 */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { Ctx, PlayerSystem } from '../../core/contracts';
import { noop } from '../../core/stubs';
import { makeCtx } from '../../sandbox/harness';
import type { AiWorld } from '../aiWorld';
import { PlayerSense } from '../aiWorld';
import { Enemy } from '../Enemy';
import type { EnemyManager } from '../EnemyManager';
import type { Outpost } from '../outpost';
import { defaultDoctrine } from '../outpost/doctrine';
import { Soldier } from '../outpost/soldier';
import { Commander } from './index';
import { GEAR_HEAVY, PROP_KINDS } from './props';

const bit = (kind: (typeof PROP_KINDS)[number]): number => 1 << PROP_KINDS.indexOf(kind);

/** A Commander on a page that is alone or hosting (`guest` false), or a co-op guest's. */
function make(guest = false) {
  const player = { position: new THREE.Vector3(), eye: new THREE.Vector3(0, 1.6, 0), velocity: new THREE.Vector3(), forward: new THREE.Vector3(0, 0, -1), alive: true, grounded: true, health: 100, maxHealth: 100 } as unknown as PlayerSystem;
  const ctx = makeCtx({ player }) as Ctx & Record<string, unknown>;
  Object.assign(ctx, {
    render: { scene: new THREE.Scene(), materials: { patch: (m: THREE.Material) => m, world: () => new THREE.MeshBasicMaterial() }, highlight: vi.fn(), lights: { flash: vi.fn() }, decals: { add: vi.fn() } },
    physics: { ...noop<object>('physics'), raycast: vi.fn(() => null), radialListeners: new Set() },
    world: { zoneAt: () => null, zones: [], nav: { nearest: (p: THREE.Vector3, _r: number, out: THREE.Vector3) => (out.copy(p), true) }, spawnPoints: [] },
    progression: { pickups: [] },
    coop: guest ? { world: {}, hosting: false } : undefined,
  });
  const laser = { acquireLaser: vi.fn(() => 1), releaseLaser: vi.fn(), aimLaser: vi.fn(), zone: vi.fn() };
  const w = { ctx, player: new PlayerSense(), now: 0, director: { clearLine: () => false }, telegraphs: laser, enemies: {} } as unknown as AiWorld;
  const o = {
    crowd: null, soldiers: [], squads: [], doors: [], hostile: 1, doctrine: defaultDoctrine(), noise: vi.fn(), comms: { relay: vi.fn(), say: vi.fn() },
    waves: { phase: 'spawning', nextWaveIn: 0 }, cover: { spots: [] }, routes: { setClosed: vi.fn() },
    focus: () => {}, playerDistance: () => 30, seenByAny: () => false, quarryOf: () => null,
  } as unknown as Outpost;
  const c = new Commander(w, o, {} as EnemyManager);
  c.init();
  c.reset();
  return c;
}

/** A man with a helmet on, as the Outpost hands him to the Commander. */
function man(rank: Soldier['rank'] = 'regular'): Soldier {
  const e = new Enemy();
  e.alive = true;
  const bones = Array.from({ length: 40 }, () => new THREE.Bone());
  e.char = { bones, root: new THREE.Group() } as unknown as Enemy['char'];
  const helmet = { spec: { regions: ['head'] }, hp: 30, mesh: new THREE.Mesh(), worn: true };
  (e as unknown as { plates: unknown[] }).plates = [helmet];
  e.armor = 30;
  const s = new Soldier();
  s.e = e; s.rank = rank; s.seat = 2;
  s.squad = { directed: false, members: [s] } as unknown as Soldier['squad'];
  return s;
}
const field = (c: Commander, id: string): void => void (c as unknown as { have: Set<string> }).have.add(id);
const helmetOf = (s: Soldier) => s.e.plates[0]!;

describe('what a man wears, alone and on the host', () => {
  it('an elite wears a visor, and nobody else wears anything', () => {
    const c = make();
    const elite = man('elite'), plain = man();
    c.onSpawn(elite); c.onSpawn(plain);
    expect(c.gearOf(elite)).toBe(bit('visor'));
    expect(c.gearOf(plain)).toBe(0);
    expect(helmetOf(elite).hp).toBe(30);
  });

  it('with helmets fielded every man has the heavy one: three times the plate, a size up, and the visor', () => {
    const c = make();
    field(c, 'helmets');
    const s = man();
    c.onSpawn(s);
    expect(c.gearOf(s)).toBe(bit('visor') | GEAR_HEAVY);
    expect(helmetOf(s).hp).toBe(90);
    expect(s.e.armor).toBe(90);
    expect(helmetOf(s).mesh.scale.x).toBeCloseTo(1.1, 6);
  });

  it('a pooled body comes back to the gate with nothing on it', () => {
    const c = make();
    field(c, 'helmets');
    const s = man();
    c.onSpawn(s);
    (c as unknown as { have: Set<string> }).have.clear();
    // The manager fits him a fresh helmet as he is handed out again (`fitPlates`).
    helmetOf(s).hp = 30; s.e.armor = 30;
    c.onSpawn(s);
    expect(c.gearOf(s)).toBe(0);
    expect(helmetOf(s).hp).toBe(30);
  });
});

describe('a co-op guest dresses its copy by the host\'s word', () => {
  it('fits nothing by its own roll of his rank or its own Commander', () => {
    const c = make(true);
    field(c, 'helmets');
    const s = man('elite');
    c.onSpawn(s);
    expect(c.gearOf(s)).toBe(0);
    expect(helmetOf(s).hp).toBe(30);
  });

  it('wears what the host says: the jammer\'s whip, the visor, and the heavy helmet with its plate, once', () => {
    const host = make(), guest = make(true);
    field(host, 'helmets');
    const there = man(), here = man('elite');
    host.onSpawn(there);
    (host as unknown as { props: { fit(char: unknown, kind: string): void } }).props.fit(there.e.char, 'whip');
    guest.onSpawn(here);
    const gear = host.gearOf(there);
    expect(gear).toBe(bit('whip') | bit('visor') | GEAR_HEAVY);
    guest.wear(here, gear);
    expect(guest.gearOf(here)).toBe(gear);
    expect(helmetOf(here).hp).toBe(helmetOf(there).hp);
    expect(here.e.armor).toBe(there.e.armor);
    // Told again (the row is sent again when anything he wears changes): the plate is not thickened twice.
    guest.wear(here, gear | bit('grenade'));
    expect(guest.gearOf(here)).toBe(gear | bit('grenade'));
    expect(helmetOf(here).hp).toBe(90);
    // He drops the pack: it comes off the copy.
    guest.wear(here, bit('visor') | GEAR_HEAVY);
    expect(guest.gearOf(here)).toBe(bit('visor') | GEAR_HEAVY);
    const worn = here.e.char.bones.reduce((n, b) => n + b.children.length, 0);
    expect(worn).toBe(1);
  });
});
