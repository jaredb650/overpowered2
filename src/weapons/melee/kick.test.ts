/**
 * Sparta kick & grounded-enemy head stomp (`F` / `melee` action):
 *  - Weapons + Combat + Kick on real Rapier (makeRange): never draws/swings knife or sword, clears swarms,
 *    plays kick_swing on throw and kick_hit on chest contact, plays stomp_hit immediately on head stomp trigger,
 *    and effortlessly head-stomps ANY grounded opponent (downed ragdoll, rising, crawling prone, legless, collapsed).
 *  - Real EnemyManager + DamageModel: Sparta kick launches humans (and Riot shielders) into immediate flying
 *    ragdolls (`gore.knockdown`), and a follow-up head stomp kills & explodes any grounded enemy's head (`'burst'`).
 *  - Viewmodel Legs: drives swift, violent right-boot kick/stomp poses and weapon dip cleanly.
 */
import * as THREE from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { archetypeById, rigFor } from '../../characters/archetypes';
import { HumanoidBone as B, type GoreRegion } from '../../characters/rig';
import type { CharacterInstance, Ctx, DamageInfo } from '../../core/contracts';
import type { EnemyId, KickMove, WeaponId } from '../../core/gameplay';
import { EnemyManager } from '../../enemies/EnemyManager';
import { makeCtx } from '../../sandbox/harness';
import { makeRange, type Dummy, type Range } from '../testkit';
import { Kit } from '../viewmodels/kit/kit';
import { Legs } from '../viewmodels/legs';
import { KICK, STOMP, isCrawlingProne, isGroundedOpponent } from './Kick';

let r: Range;

beforeAll(async () => {
  r = await makeRange();
});

function setup(weapon: WeaponId = 'smg'): void {
  r.reset();
  r.player.position.set(0, 0, 0);
  r.player.eye.set(0, 1.6, 0);
  r.player.forward.set(0, 0, -1);
  r.player.yaw = 0;
  r.player.velocity.set(0, 0, 0);
  r.player.grounded = true;
  r.weapons.give(weapon);
  r.weapons.switchTo(weapon);
  r.run(0.5);
}

function press(action: 'melee' | 'fire' | 'aim'): void {
  r.input.simulate(action, true);
  r.run(1 / 60);
  r.input.simulate(action, false);
}

function makeGroundedDummy(
  x: number,
  z: number,
  mode: 'prone' | 'legless' | 'downed' | 'rising' | 'collapsed' = 'prone',
  headY = 0.25,
): Dummy {
  const d = r.enemies.add(x, z, 100);
  d.center.set(x, 0.35, z);
  const headIdx = d.char.rig.bones.findIndex(b => b.name === 'head');
  if (headIdx >= 0) {
    d.char.bones[headIdx]!.position.set(x, headY, z);
    d.char.bones[headIdx]!.updateMatrixWorld(true);
  }
  if (mode === 'prone') {
    (d.char as unknown as { anim: { prone: boolean } }).anim = { prone: true };
  } else if (mode === 'legless') {
    (d.char.severed as Set<GoreRegion>).add('legL');
    (d.char.severed as Set<GoreRegion>).add('legR');
  } else if (mode === 'downed') {
    (d as unknown as { downed: boolean }).downed = true;
  } else if (mode === 'rising') {
    (d as unknown as { rising: number }).rising = 0.4;
  }
  return d;
}

describe('F key Sparta kick and head stomp (Weapons + Combat)', () => {
  it('kicks on F without ever drawing or swinging the knife or sword, playing kick_swing on throw and kick_hit on hit', () => {
    setup('smg');
    const vm = r.ctx.viewmodel as unknown as {
      equip: ReturnType<typeof vi.fn>;
      swing: ReturnType<typeof vi.fn>;
      kick?: ReturnType<typeof vi.fn>;
    };
    const equipSpy = vi.spyOn(vm, 'equip');
    const swingSpy = vi.spyOn(vm, 'swing');
    const audioPlay = vi.spyOn(r.ctx.audio, 'play');
    const kickCalls: { move: KickMove; seconds: number }[] = [];
    vm.kick = vi.fn((move: KickMove, seconds: number) => kickCalls.push({ move, seconds }));

    const target = r.enemies.add(0, -1.6);
    press('melee');
    expect(audioPlay.mock.calls.some(call => call[0] === 'kick_swing')).toBe(true);
    r.run(KICK.impactAt + 0.05);

    expect(kickCalls).toEqual([{ move: 'kick', seconds: KICK.duration }]);
    expect(equipSpy).not.toHaveBeenCalled();
    expect(swingSpy).not.toHaveBeenCalled();
    expect(target.hits).toHaveLength(1);
    expect(target.hits[0]!.source).toBe('kick');
    expect(target.hits[0]!.type).toBe('melee');
    expect(target.hits[0]!.force).toBe(KICK.force);
    expect(audioPlay.mock.calls.some(call => call[0] === 'kick_hit')).toBe(true);

    r.run(0.5);
    expect(r.weapons.current).toBe('smg');
    expect(equipSpy).not.toHaveBeenCalled();
    audioPlay.mockRestore();
  });

  it('still kicks on F when knife or sword is equipped, while left click slashes normally', () => {
    setup('knife');
    const target = r.enemies.add(0, -1.3);

    press('melee');
    r.run(KICK.impactAt + 0.05);
    expect(target.hits).toHaveLength(1);
    expect(target.hits[0]!.source).toBe('kick');

    // Wait out kick + cooldown, then verify left click slashes with the equipped knife.
    r.run(KICK.duration + KICK.cooldown + 0.05);
    expect(r.weapons.current).toBe('knife');
    press('fire');
    r.run(0.05);
    expect(target.hits).toHaveLength(2);
    expect(target.hits[1]!.source).toBe('knife');
  });

  it('clears a swarm in a wide front arc and fans flanking enemies outward, ignoring enemies behind or walled off', () => {
    setup('smg');
    const center = r.enemies.add(0, -1.8);
    const leftFlank = r.enemies.add(-1.1, -1.4);
    const rightFlank = r.enemies.add(1.1, -1.4);
    const behind = r.enemies.add(0, 1.4);

    press('melee');
    r.run(KICK.impactAt + 0.05);

    expect(center.hits).toHaveLength(1);
    expect(leftFlank.hits).toHaveLength(1);
    expect(rightFlank.hits).toHaveLength(1);
    expect(behind.hits).toHaveLength(0);

    // Center flies straight back along -Z; flanks fan outward to open breathing room.
    expect(center.hits[0]!.dir.z).toBeLessThan(-0.95);
    expect(leftFlank.hits[0]!.dir.x).toBeLessThan(-0.15);
    expect(rightFlank.hits[0]!.dir.x).toBeGreaterThan(0.15);

    // Enemy behind a wall is not struck even inside reach.
    const wx = 120;
    r.wall(-0.9, 0.3, 'concrete', wx, 2.5);
    r.player.position.set(wx, 0, 0);
    r.player.eye.set(wx, 1.6, 0);
    r.run(KICK.duration + KICK.cooldown + 0.1);
    const walled = r.enemies.add(wx, -1.7);
    press('melee');
    r.run(KICK.impactAt + 0.05);
    expect(walled.hits).toHaveLength(0);
  });

  it('executes a lethal head stomp on ANY grounded opponent (downed ragdoll, rising, prone, legless, collapsed) and plays stomp_hit on trigger', () => {
    for (const mode of ['prone', 'legless', 'downed', 'rising', 'collapsed'] as const) {
      setup('smg');
      const kickCalls: KickMove[] = [];
      (r.ctx.viewmodel as unknown as { kick?: (m: KickMove) => void }).kick = (m: KickMove) => kickCalls.push(m);
      const audioPlay = vi.spyOn(r.ctx.audio, 'play');

      const grounded = makeGroundedDummy(0, -1.6, mode);
      grounded.health = 100;
      if (mode === 'prone' || mode === 'legless') expect(isCrawlingProne(grounded)).toBe(true);
      expect(isGroundedOpponent(grounded, undefined, 0.25)).toBe(true);

      press('melee');
      expect(kickCalls).toEqual(['stomp']);
      // Head stomp sound plays immediately when triggered (not kick_swing).
      expect(audioPlay.mock.calls.some(call => call[0] === 'stomp_hit')).toBe(true);
      expect(audioPlay.mock.calls.some(call => call[0] === 'kick_swing')).toBe(false);
      // Should not connect before heel slams down.
      r.run(0.04);
      expect(grounded.hits).toHaveLength(0);

      // Connects at STOMP.impactAt with lethal head-piercing stomp.
      r.run(STOMP.impactAt);
      expect(grounded.hits).toHaveLength(1);
      const hit = grounded.hits[0]!;
      expect(hit.source).toBe('stomp');
      expect(hit.type).toBe('melee');
      expect(hit.region).toBe('head');
      expect(hit.amount).toBeGreaterThanOrEqual(STOMP.damage);
      expect(hit.dir.y).toBeLessThan(-0.7);
      expect(grounded.alive).toBe(false);
      audioPlay.mockRestore();
    }
  });

  it('makes head stomp easy to land from generous reach (2.8 m) with lunge step-in and from underfoot angles', () => {
    // 1) Long reach (2.8 m ahead) triggers stomp and adds crisp forward step-in velocity toward the skull.
    setup('smg');
    const kickCalls: KickMove[] = [];
    (r.ctx.viewmodel as unknown as { kick?: (m: KickMove) => void }).kick = (m: KickMove) => kickCalls.push(m);
    const farDowned = makeGroundedDummy(0, -2.8, 'downed');
    press('melee');
    expect(kickCalls).toEqual(['stomp']);
    expect(r.player.velocity.z).toBeLessThan(-3);
    r.run(STOMP.impactAt + 0.05);
    expect(farDowned.alive).toBe(false);
    expect(farDowned.hits[0]!.source).toBe('stomp');

    // 2) Underfoot grounded enemy slightly behind/beside player (within STOMP.underfoot) still stomps cleanly.
    setup('smg');
    kickCalls.length = 0;
    (r.ctx.viewmodel as unknown as { kick?: (m: KickMove) => void }).kick = (m: KickMove) => kickCalls.push(m);
    const sideDowned = makeGroundedDummy(1.1, 0.4, 'downed');
    press('melee');
    expect(kickCalls).toEqual(['stomp']);
    r.run(STOMP.impactAt + 0.05);
    expect(sideDowned.alive).toBe(false);
    expect(sideDowned.hits[0]!.source).toBe('stomp');
  });

  it('does not head-stomp a downed enemy still flying high in midair, and Sparta-kicks a point-blank standing threat ahead', () => {
    setup('smg');
    const kickCalls: KickMove[] = [];
    (r.ctx.viewmodel as unknown as { kick?: (m: KickMove) => void }).kick = (m: KickMove) => kickCalls.push(m);

    // Midair flying body (head 1.8 m high) is not stomped.
    makeGroundedDummy(0, -1.5, 'downed', 1.8);
    press('melee');
    expect(kickCalls).toEqual(['kick']);

    // Standing enemy point-blank straight ahead wins over a farther grounded enemy when looking level.
    setup('smg');
    kickCalls.length = 0;
    (r.ctx.viewmodel as unknown as { kick?: (m: KickMove) => void }).kick = (m: KickMove) => kickCalls.push(m);
    const standing = r.enemies.add(0, -1.0);
    makeGroundedDummy(0, -1.9, 'prone');

    press('melee');
    r.run(KICK.impactAt + 0.05);
    expect(kickCalls).toEqual(['kick']);
    expect(standing.hits).toHaveLength(1);
    expect(standing.hits[0]!.source).toBe('kick');
  });
});

// -------------------------------------------------------------------------------------------
// Real EnemyManager + DamageModel integration (Sparta ragdoll + grounded head-stomp burst)
// -------------------------------------------------------------------------------------------

function character(id: EnemyId): CharacterInstance {
  const rig = rigFor(archetypeById(id));
  const root = new THREE.Group();
  new THREE.Scene().add(root);
  const bones = rig.bones.map(() => new THREE.Bone());
  rig.bones.forEach((def, i) => (def.parent >= 0 ? bones[def.parent]! : root).add(bones[i]!));
  const anim = {
    prone: false,
    flinch: vi.fn(), stumble: vi.fn(), play: vi.fn(), daze: vi.fn(), guard: vi.fn(),
    holdWound: vi.fn(), getUp: vi.fn(), setLocomotion: vi.fn(), update: vi.fn(),
  };
  return {
    archetype: id, rig, root, bones, severed: new Set(), anim,
    hitFlash: vi.fn(), setBloodiness: vi.fn(), isFractured: () => false,
    attachProp: (bone: number, prop: THREE.Object3D) => bones[bone]!.add(prop),
    release: vi.fn(), setLod: vi.fn(),
  } as unknown as CharacterInstance;
}

function makeDamageWorld() {
  const player = {
    position: new THREE.Vector3(0, 0, 0),
    eye: new THREE.Vector3(0, 1.6, 0),
    velocity: new THREE.Vector3(),
    forward: new THREE.Vector3(0, 0, -1),
    grounded: true, alive: true, sliding: false, wallRunning: false, speed: 0,
  };
  const knockdownCalls: { velocity: THREE.Vector3; stumble: unknown; impulse: THREE.Vector3 | null }[] = [];
  const headshotCalls: { outcome: string; source: string; hadVelocity: boolean }[] = [];
  const gore = {
    wound: vi.fn(() => false),
    headPellets: vi.fn(() => 1),
    sever: vi.fn((char: CharacterInstance, region: GoreRegion) => {
      (char.severed as Set<GoreRegion>).add(region);
      return { regions: [region], stump: new THREE.Vector3() };
    }),
    knockdown: vi.fn((_char: CharacterInstance, opts: { velocity?: THREE.Vector3; stumble?: unknown; impulses?: { impulse: THREE.Vector3 }[] }) => {
      knockdownCalls.push({
        velocity: opts.velocity ? opts.velocity.clone() : new THREE.Vector3(),
        stumble: opts.stumble,
        impulse: opts.impulses?.[0]?.impulse ? opts.impulses[0].impulse.clone() : null,
      });
      return true;
    }),
    downed: vi.fn(() => null),
    handedBack: vi.fn(() => null),
    rouse: vi.fn(),
    ragdoll: vi.fn(),
    collapse: vi.fn(),
    headshot: vi.fn((_char: CharacterInstance, d: DamageInfo, vel?: THREE.Vector3, outcome?: string) => {
      headshotCalls.push({ outcome: outcome ?? '', source: d.source, hadVelocity: vel !== undefined });
      (_char.severed as Set<GoreRegion>).add('head');
    }),
    gib: vi.fn(),
    slice: vi.fn(),
    blowOut: vi.fn(),
    vaporize: vi.fn(),
    owns: () => false,
  };
  const ctx = makeCtx({
    gore: gore as unknown as Ctx['gore'],
    player: player as unknown as Ctx['player'],
    characters: { spawn: (id: EnemyId) => character(id) } as unknown as Ctx['characters'],
    audio: { play: vi.fn(), playOneOf: vi.fn(), startLoop: () => null } as unknown as Ctx['audio'],
  });
  (ctx as { progression: unknown }).progression = { isActive: () => false };
  const manager = new EnemyManager(ctx);
  const spawn = (id: EnemyId, z = -1.6) => {
    const e = manager.spawn(id, new THREE.Vector3(0, 0, z))!;
    e.dist = Math.abs(z);
    e.inView = true;
    return e;
  };
  return { manager, gore, knockdownCalls, headshotCalls, spawn };
}

describe('DamageModel Sparta kick ragdoll & head stomp skull burst', () => {
  it('launches a standing human trooper straight back into a flying physics ragdoll on Sparta kick', () => {
    const w = makeDamageWorld();
    const trooper = w.spawn('trooper', -1.6);
    const dmg: DamageInfo = {
      amount: KICK.damage,
      type: 'melee',
      point: new THREE.Vector3(0, 1.1, -1.6),
      dir: new THREE.Vector3(0, 0, -1),
      force: KICK.force,
      source: 'kick',
      region: 'chest',
      bone: B.chest,
      severMult: 0,
    };

    const res = w.manager.applyDamage(trooper, dmg);
    expect(res.killed).toBe(false);
    expect(trooper.downed).toBe(true);
    expect(w.knockdownCalls).toHaveLength(1);
    const call = w.knockdownCalls[0]!;
    // Strong backward launch along -Z with upward arc and immediate ragdoll (no stumble delay).
    expect(call.velocity.z).toBeLessThan(-6);
    expect(call.velocity.y).toBeGreaterThan(1.5);
    expect(call.stumble).toBeUndefined();
    expect(call.impulse).not.toBeNull();
    expect(call.impulse!.z).toBeLessThan(-80);
  });

  it('knocks back a Riot shielder through his shield into a ragdoll on Sparta kick', () => {
    const w = makeDamageWorld();
    const riot = w.spawn('riot', -1.6);
    // Face player (+Z) so a front kick hits the shield.
    riot.yaw = 0;
    const dmg: DamageInfo = {
      amount: KICK.damage,
      type: 'melee',
      point: new THREE.Vector3(0, 1.1, -1.4),
      dir: new THREE.Vector3(0, 0, -1),
      force: KICK.force,
      source: 'kick',
      region: 'chest',
      bone: B.chest,
      severMult: 0,
    };

    const res = w.manager.applyDamage(riot, dmg);
    expect(res.blocked).toBe(true);
    expect(riot.downed).toBe(true);
    expect(w.knockdownCalls).toHaveLength(1);
    expect(w.knockdownCalls[0]!.velocity.z).toBeLessThan(-4);
  });

  it('punts an already-downed enemy further along the floor when kicked again', () => {
    const w = makeDamageWorld();
    const trooper = w.spawn('trooper', -1.6);
    trooper.downed = true;
    const dmg: DamageInfo = {
      amount: KICK.damage,
      type: 'melee',
      point: new THREE.Vector3(0, 0.4, -1.6),
      dir: new THREE.Vector3(0, 0, -1),
      force: KICK.force,
      source: 'kick',
      region: 'chest',
      bone: B.chest,
      severMult: 0,
    };

    w.manager.applyDamage(trooper, dmg);
    expect(w.knockdownCalls).toHaveLength(1);
    expect(w.knockdownCalls[0]!.impulse!.z).toBeLessThan(-150);
    expect(w.knockdownCalls[0]!.impulse!.y).toBeGreaterThan(30);
  });

  it('combos a Sparta-kicked downed trooper directly into a grounded head stomp bursting their head', () => {
    const w = makeDamageWorld();
    const trooper = w.spawn('trooper', -1.5);
    const kickDmg: DamageInfo = {
      amount: KICK.damage,
      type: 'melee',
      point: new THREE.Vector3(0, 1.1, -1.5),
      dir: new THREE.Vector3(0, 0, -1),
      force: KICK.force,
      source: 'kick',
      region: 'chest',
      bone: B.chest,
      severMult: 0,
    };
    w.manager.applyDamage(trooper, kickDmg);
    expect(trooper.alive).toBe(true);
    expect(trooper.downed).toBe(true);

    const stompDmg: DamageInfo = {
      amount: STOMP.damage,
      type: 'melee',
      point: new THREE.Vector3(0, 0.25, -2.2),
      dir: new THREE.Vector3(0, -0.92, -0.39).normalize(),
      force: STOMP.force,
      source: 'stomp',
      region: 'head',
      bone: B.head,
      severMult: 0,
      armorPiercing: true,
      pierces: true,
    };
    const res = w.manager.applyDamage(trooper, stompDmg);
    expect(res.killed).toBe(true);
    expect(res.headshot).toBe(true);
    expect(trooper.alive).toBe(false);
    expect(w.headshotCalls).toEqual([{ outcome: 'burst', source: 'stomp', hadVelocity: false }]);
    expect(trooper.char.severed.has('head')).toBe(true);
  });
});

describe('First-person viewmodel Legs kick & stomp animation', () => {
  it('animates the right boot swiftly forward for Sparta kick and down for stomp, dipping the held weapon', () => {
    const mat = new THREE.MeshStandardMaterial();
    const mats = new Proxy({}, { get: () => mat });
    const legs = new Legs(new Kit(mats as never));

    legs.kick('kick', KICK.duration);
    expect(legs.kicking).toBe(true);
    legs.update(null, 0, 0.06);
    expect(legs.root.visible).toBe(true);
    expect(legs.kickDip).toBeGreaterThan(0.5);
    legs.update(null, 0, KICK.duration);
    expect(legs.kicking).toBe(false);
    expect(legs.kickDip).toBe(0);

    legs.kick('stomp', STOMP.duration);
    expect(legs.kicking).toBe(true);
    legs.update(null, 0, 0.10);
    expect(legs.root.visible).toBe(true);
    expect(legs.kickDip).toBeGreaterThan(0.5);
    legs.update(null, 0, STOMP.duration);
    expect(legs.kicking).toBe(false);
  });
});
