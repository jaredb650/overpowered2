/**
 * The damage model with the facts off: what a co-op guest runs on its copy of the host's enemy (`predict`, `show`,
 * `severShown`, `killShown`). The real EnemyManager and DamageModel, with gore, effects and sound counted instead of drawn.
 */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { archetypeById, rigFor } from '../characters/archetypes';
import type { GoreRegion } from '../characters/rig';
import { HumanoidBone as B } from '../characters/rig';
import type { CharacterInstance, Ctx, DamageInfo, GameEvents } from '../core/contracts';
import type { EnemyId } from '../core/gameplay';
import { makeCtx } from '../sandbox/harness';
import { WEAPONS } from '../weapons/data';
import { newFacts, poolStrengths, type HitFacts } from './damage';
import { EnemyManager } from './EnemyManager';

function character(id: EnemyId): CharacterInstance {
  const rig = rigFor(archetypeById(id));
  const root = new THREE.Group();
  new THREE.Scene().add(root);
  const bones = rig.bones.map(() => new THREE.Bone());
  rig.bones.forEach((def, i) => (def.parent >= 0 ? bones[def.parent]! : root).add(bones[i]!));
  const anim = { flinch: vi.fn(), stumble: vi.fn(), play: vi.fn(), daze: vi.fn(), guard: vi.fn(), holdWound: vi.fn(), getUp: vi.fn(), setLocomotion: vi.fn(), update: vi.fn() };
  return { archetype: id, rig, root, bones, severed: new Set(), anim, hitFlash: vi.fn(), setBloodiness: vi.fn(), isFractured: () => false,
    attachProp: (bone: number, prop: THREE.Object3D) => bones[bone]!.add(prop), release: vi.fn(), setLod: vi.fn() } as unknown as CharacterInstance;
}

const lose = (char: CharacterInstance, region: GoreRegion) => (char.severed as Set<GoreRegion>).add(region);

/** A world with one real enemy manager in it. `knock`: whether gore has room to take a body down. */
function world(knock = true) {
  const player = { position: new THREE.Vector3(0, 0, 0), eye: new THREE.Vector3(0, 1.6, 0), velocity: new THREE.Vector3(), forward: new THREE.Vector3(0, 0, -1),
    grounded: true, alive: true, sliding: false, wallRunning: false, speed: 0 };
  const gore = {
    wound: vi.fn((_char: CharacterInstance, _d: DamageInfo, _severity: number) => false), headPellets: vi.fn(() => 1),
    sever: vi.fn((char: CharacterInstance, region: GoreRegion) => { lose(char, region); return { regions: [region], stump: new THREE.Vector3() }; }),
    knockdown: vi.fn(() => knock), downed: vi.fn(() => null), handedBack: vi.fn(() => null), rouse: vi.fn(),
    ragdoll: vi.fn(), collapse: vi.fn(), headshot: vi.fn(), gib: vi.fn(), slice: vi.fn(), blowOut: vi.fn(), vaporize: vi.fn(), owns: () => false,
  };
  const sounds: string[] = [];
  const ctx = makeCtx({
    gore: gore as unknown as Ctx['gore'], player: player as unknown as Ctx['player'],
    characters: { spawn: (id: EnemyId) => character(id) } as unknown as Ctx['characters'],
    audio: { play: (id: string) => { sounds.push(id); }, playOneOf: () => {}, startLoop: () => null } as unknown as Ctx['audio'],
  });
  (ctx as { progression: unknown }).progression = { isActive: () => false };
  const manager = new EnemyManager(ctx);
  const events = { hits: [] as GameEvents['enemy:hit'][], kills: 0, severs: [] as GameEvents['enemy:severed'][] };
  ctx.events.on('enemy:hit', e => events.hits.push({ ...e, result: { ...e.result } }));
  ctx.events.on('enemy:killed', () => events.kills++);
  ctx.events.on('enemy:severed', e => events.severs.push(e));
  const spawn = (id: EnemyId, z = -6): ReturnType<EnemyManager['spawn']> & object => {
    const e = manager.spawn(id, new THREE.Vector3(0, 0, z))!;
    e.dist = Math.abs(z);
    e.inView = true;
    return e;
  };
  return { ctx, manager, gore, events, sounds, spawn, player };
}

const round = (source: keyof typeof WEAPONS, region: DamageInfo['region'] = 'chest', extra: Partial<DamageInfo> = {}): DamageInfo => {
  const def = WEAPONS[source];
  return { amount: def.damage, type: def.pellets > 1 ? 'pellet' : 'bullet', point: new THREE.Vector3(0, 1.2, -5.8), dir: new THREE.Vector3(0, 0, -1),
    force: def.force, source, region, bone: region === 'head' ? B.head : B.chest, ...extra };
};
const told = (extra: Partial<HitFacts>): HitFacts => ({ ...newFacts(), ...extra });

describe('a guest draws its own hit with nothing decided', () => {
  it('wounds at the size the host will, and takes no health, armour or life', () => {
    const host = world(), guest = world();
    const there = host.spawn('trooper'), here = guest.spawn('trooper');
    const real = { ...host.manager.applyDamage(there, round('harrow')) };
    const guess = { ...guest.manager.predictDamage(here, round('harrow')) };
    expect(guess.dealt).toBe(real.dealt);
    expect(guess.blocked).toBe(false);
    // The same wound, at the same severity.
    expect(guest.gore.wound.mock.calls[0]![2]).toBe(host.gore.wound.mock.calls[0]![2]);
    expect(guest.gore.wound.mock.calls[0]![2]).toBeCloseTo(real.dealt / there.maxHealth, 6);
    expect(there.health).toBe(there.maxHealth - real.dealt);
    expect(here.health).toBe(here.maxHealth);
    expect(here.alive).toBe(true);
    // The hit flash, the blood on the skin and the flinch are the same lines on both.
    expect(here.char.hitFlash).toHaveBeenCalledTimes(1);
    expect(here.char.setBloodiness).toHaveBeenCalledTimes(1);
    // Its own `enemy:hit`, so the shooter's score events and hit sounds work as in single player.
    expect(guest.events.hits).toHaveLength(1);
    expect(guest.events.hits[0]!.result.killed).toBe(false);
  });

  it('tells the shooter of a kill once: a later round into a body already reckoned dead is a round into a corpse', () => {
    const { manager, gore, events, spawn } = world();
    const e = spawn('husk');
    e.health = 20;
    const first = { ...manager.predictDamage(e, round('shotgun')) };
    expect(first.killSoon).toBe(true);
    e.owed += first.dealt;
    const second = { ...manager.predictDamage(e, round('shotgun')) };
    expect(second.doomed).toBe(true);
    expect(second.killSoon).toBeFalsy();
    // It still marks the body, and it is nobody's `enemy:hit` (no marker, no hit sound, no score event).
    expect(gore.wound).toHaveBeenCalledTimes(2);
    expect(events.hits).toHaveLength(1);
  });

  it('never kills, cuts or bursts what the host has not: a round that would is only a guess for the shooter', () => {
    const { manager, gore, events, spawn } = world();
    const e = spawn('husk');
    e.health = 10;
    const res = manager.predictDamage(e, round('judge'));
    expect(res.killed).toBe(false);
    expect(res.killSoon).toBe(true);
    expect(e.alive).toBe(true);
    expect(e.health).toBe(10);
    expect(events.kills).toBe(0);
    // A limb's pool run out here cuts nothing: the limb comes off when the host says.
    for (let i = 0; i < 40; i++) manager.predictDamage(e, round('shotgun', 'armL', { bone: B.upperArmL }));
    expect(gore.sever).not.toHaveBeenCalled();
    for (const death of [gore.ragdoll, gore.collapse, gore.headshot, gore.gib, gore.slice]) expect(death).not.toHaveBeenCalled();
    expect(events.severs).toHaveLength(0);
  });

  it('guesses the kill from the health last heard less its own hits still unanswered, and never for a boss', () => {
    const { manager, spawn } = world();
    const e = spawn('husk');
    e.health = 100;
    expect(manager.predictDamage(e, round('smg')).killSoon).toBe(false);
    e.owed = 80;
    expect(manager.predictDamage(e, round('smg')).killSoon).toBe(true);
    // The rest of a blast on a body already reckoned dead: the kill was told once.
    e.owed = 120;
    const rest = manager.predictDamage(e, round('smg'));
    expect(rest.killSoon).toBeFalsy();
    expect(rest.doomed).toBe(true);
    e.owed = 80;
    e.isBoss = true;
    expect(manager.predictDamage(e, round('smg')).killSoon).toBe(false);
  });

  it('is stopped by the plate the host will stop it with, and wears its own copy of it', () => {
    const { manager, gore, sounds, spawn } = world();
    const e = spawn('brute');
    const armour = e.armor;
    const res = manager.predictDamage(e, round('rivet'));
    expect(res.blocked).toBe(true);
    expect(res.armour).toBe('stopped');
    expect(manager.model.found.stop).toBe('plate');
    expect(gore.wound).not.toHaveBeenCalled();
    // The armour number is the host's; the plate here is this machine's guess, and breaks off when it wears through.
    expect(e.armor).toBe(armour);
    const plate = e.plates[manager.model.found.plate]!;
    for (let i = 0; i < 60 && plate.hp > 0; i++) manager.predictDamage(e, round('rivet'));
    expect(plate.hp).toBeLessThanOrEqual(0);
    expect(sounds).toContain('armor_plate_off');
  });

  it('reacts on the frame of the hit: a round to the head that the body lives through puts it on the floor', () => {
    const { manager, gore, spawn } = world();
    const e = spawn('husk');
    e.health = e.maxHealth = 5000;
    e.limbHp.set('head', 1e6);
    manager.predictDamage(e, round('smg', 'head'));
    expect(manager.model.found.level).toBe('felled');
    expect(gore.knockdown).toHaveBeenCalledTimes(1);
    expect(e.downed).toBe(true);
  });
});

describe('a guest is shown a hit the host decided', () => {
  it('wounds at the host\'s severity, with the host\'s headshot verdict, and tells nobody it was theirs', () => {
    const { manager, gore, events, spawn } = world();
    const e = spawn('trooper');
    const res = manager.showDamage(e, round('smg', 'head'), told({ amount: 37, headshot: true }), null);
    expect(gore.wound.mock.calls[0]![2]).toBeCloseTo(37 / e.maxHealth, 6);
    expect(res.dealt).toBe(37);
    expect(res.headshot).toBe(true);
    expect(e.health).toBe(e.maxHealth);
    // A teammate's hit is not this player's news: no hit marker sound, no score event.
    expect(events.hits).toHaveLength(0);
  });

  it('does what the host\'s body did: down when it went down, on its feet when it did not', () => {
    const felled = world(), flinched = world();
    const a = felled.spawn('husk'), b = flinched.spawn('husk');
    felled.manager.showDamage(a, round('smg'), told({ amount: 25, level: 'felled', strength: 0.6 }), null);
    expect(felled.gore.knockdown).toHaveBeenCalledTimes(1);
    // The same round to the head would floor it here: the host says it only flinched.
    flinched.manager.showDamage(b, round('smg', 'head'), told({ amount: 25, level: 'flinch', headshot: true }), null);
    expect(flinched.gore.knockdown).not.toHaveBeenCalled();
    expect(b.char.anim.flinch).toHaveBeenCalled();
  });

  it('shows a stopped round as stopped, and shoots the plate off when the host broke it', () => {
    const { manager, gore, sounds, spawn } = world();
    const e = spawn('brute');
    const res = manager.showDamage(e, round('rivet'), told({ amount: 30, stop: 'plate', armour: 'broken', plate: 0, broke: true }), null);
    expect(res.blocked).toBe(true);
    expect(res.armour).toBe('broken');
    expect(gore.wound).not.toHaveBeenCalled();
    expect(e.plates[0]!.hp).toBe(0);
    expect(sounds).toContain('armor_plate_off');
  });

  it('sizes what gore sizes by range from the shooter\'s eye, not the watcher\'s', () => {
    const { manager, gore, spawn } = world();
    const e = spawn('trooper', -40);
    const eye = new THREE.Vector3(0, 1.6, -39);
    manager.showDamage(e, round('shotgun', 'chest', { point: new THREE.Vector3(0, 1.2, -39.8) }), told({ amount: 26 }), eye);
    const seen = gore.wound.mock.calls[0]![1];
    expect(seen.from).toBeDefined();
    expect(seen.from!.distanceTo(seen.point)).toBeLessThan(2);
    // The local player's own hit carries none: gore reads the local eye.
    manager.predictDamage(e, round('shotgun'));
    expect(gore.wound.mock.calls[1]![1].from).toBeUndefined();
  });

  it('cuts a limb through the model\'s own path: the sound, the scream, and what is left of the body read again', () => {
    const { manager, gore, sounds, events, spawn } = world();
    const e = spawn('trooper');
    manager.showSever(e, 'legL', round('shotgun', 'legL'), null, false);
    expect(gore.sever).toHaveBeenCalledTimes(1);
    expect(sounds).toContain('limb_sever');
    expect(e.maim.legs).toBe(1);
    expect(e.limbHp.has('legL')).toBe(false);
    // A teammate's cut is not this player's `enemy:severed`; the shooter's own is.
    expect(events.severs).toHaveLength(0);
    manager.showSever(e, 'legR', round('shotgun', 'legR'), null, true);
    expect(e.maim.legs).toBe(0);
    expect(events.severs).toHaveLength(1);
    // Twice told is once cut.
    manager.showSever(e, 'legR', round('shotgun', 'legR'), null, true);
    expect(gore.sever).toHaveBeenCalledTimes(2);
  });

  it('dies the death the host found: a frozen body shatters, a blast\'s roll is the host\'s, and nothing is cut on the way', () => {
    const shattered = world();
    const frozen = shattered.spawn('husk');
    shattered.manager.replayDeath(frozen, round('smg'), false, { blast: null, shatter: true, heavyHead: false });
    expect(shattered.gore.gib).toHaveBeenCalledTimes(1);
    expect(frozen.alive).toBe(false);
    expect(shattered.events.kills).toBe(0);

    const torn = world();
    const body = torn.spawn('trooper');
    torn.manager.replayDeath(body, { ...round('rocket'), type: 'explosive', bone: undefined }, false, { blast: 'waist', shatter: false, heavyHead: false });
    // The waist cut and the limbs a blast took came ahead of the death as cuts of their own: none is made here.
    expect(torn.gore.sever).not.toHaveBeenCalled();
    expect(torn.gore.ragdoll).toHaveBeenCalledTimes(1);

    // The killing round leaves its wound on the way, at the size the host found, as it does where the kill was decided.
    const marked = world();
    const shot = marked.spawn('trooper');
    marked.manager.replayDeath(shot, round('harrow'), false, { blast: null, shatter: false, heavyHead: false, wound: 60 });
    expect(marked.gore.wound).toHaveBeenCalledTimes(1);
    expect(marked.gore.wound.mock.calls[0]![2]).toBeCloseTo(60 / shot.maxHealth, 6);

    const burst = world();
    const head = burst.spawn('husk');
    burst.manager.replayDeath(head, round('smg', 'head', { amount: 20 }), false, { blast: null, shatter: false, heavyHead: true });
    expect(burst.gore.headshot.mock.calls[0]![3]).toBe('burst');
  });
});

describe('the deciding machine says what it found', () => {
  it('records the amount, what stopped the round and what the body did, for the other screens', () => {
    const { manager, spawn } = world();
    const e = spawn('brute');
    manager.applyDamage(e, round('rivet'));
    expect(manager.model.found).toMatchObject({ stop: 'plate', armour: 'stopped', plate: 0, broke: false });
    const t = spawn('trooper');
    const res = manager.applyDamage(t, round('harrow'));
    expect(manager.model.found.stop).toBe('none');
    expect(manager.model.found.amount).toBe(res.dealt);
  });

  it('names a cut once, at the region it was made, however many regions it took', () => {
    const { manager, gore, events, spawn } = world();
    gore.sever.mockImplementation((char: CharacterInstance) => { lose(char, 'armL'); lose(char, 'forearmL'); return { regions: ['forearmL', 'armL'], stump: new THREE.Vector3() }; });
    const e = spawn('trooper');
    manager.model.sever(e, 'armL', round('shotgun', 'armL'), null);
    expect(events.severs.map(s => s.cut)).toEqual(['armL', undefined]);
  });

  it('single player is as it was: a kill is a kill, on the frame of the hit', () => {
    const { manager, gore, events, spawn } = world();
    const e = spawn('husk');
    const res = manager.applyDamage(e, round('judge', 'chest', { amount: 5000 }));
    expect(res.killed).toBe(true);
    expect(res.killSoon).toBeUndefined();
    expect(e.alive).toBe(false);
    expect(events.kills).toBe(1);
    expect(gore.wound.mock.calls[0]![1].from).toBeUndefined();
  });
});

describe('a tank that goes up inside a hit does not take the hit\'s own findings with it', () => {
  /** A blast that, like the real one, runs a bystander's hit through the model before it returns. */
  function blasts(w: ReturnType<typeof world>, bystander: ReturnType<ReturnType<typeof world>['spawn']>): { count: number } {
    const seen = { count: 0 };
    (w.ctx as { combat: unknown }).combat = {
      explode: (center: THREE.Vector3, spec: { damage: number; source: string }) => {
        seen.count++;
        w.manager.applyDamage(bystander, { amount: 1, type: 'bullet', point: center.clone(), dir: new THREE.Vector3(0, 0, -1), force: 0, source: spec.source, region: 'chest', bone: B.chest });
      },
    };
    return seen;
  }

  it('a head shot that kills a Bomber: the hit and the kill say what that round found, not what its blast did to the next man', () => {
    const w = world();
    const bomber = w.spawn('bomber');
    const brute = w.spawn('brute', -8);
    const seen = blasts(w, brute);
    const at = { hit: null as HitFacts | null, wound: -1 };
    w.ctx.events.on('enemy:hit', e => { if (e.enemy === bomber) at.hit = { ...w.manager.model.found }; });
    w.ctx.events.on('enemy:killed', e => { if (e.enemy === bomber) at.wound = w.manager.model.foundKill.wound ?? -1; });
    bomber.health = 5;
    const res = w.manager.applyDamage(bomber, round('harrow', 'head'));
    expect(res.killed).toBe(true);
    expect(seen.count).toBe(1);
    // The bystander's plate stopped its round inside the blast: that is the bystander's finding, not the Bomber's.
    expect(at.hit).toMatchObject({ stop: 'none', plate: -1, amount: res.dealt });
    expect(at.wound).toBe(res.dealt);
  });

  it('a round into the tank itself: the hit that goes out is that round\'s, with nothing found of the bystander', () => {
    const w = world();
    const bomber = w.spawn('bomber');
    const brute = w.spawn('brute', -8);
    const seen = blasts(w, brute);
    let hit: HitFacts | null = null;
    w.ctx.events.on('enemy:hit', e => { if (e.enemy === bomber) hit = { ...w.manager.model.found }; });
    const res = w.manager.applyDamage(bomber, round('harrow', 'chest'));
    expect(res.killed).toBe(true);
    expect(seen.count).toBe(1);
    expect(hit).toMatchObject({ stop: 'none', plate: -1, armour: undefined });
  });
});

describe('kill prediction: a guest starts a death it is sure of on the frame of the shot', () => {
  const sure = (manager: EnemyManager, on = true) => { (manager.model as unknown as { predictKills: boolean }).predictKills = on; };

  it('is off unless asked for: the result never says `sure`, and the body reacts as a living one', () => {
    const { manager, gore, spawn } = world();
    const e = spawn('husk');
    e.health = 5;
    const res = manager.predictDamage(e, round('judge'));
    expect(res.killSoon).toBe(true);
    expect(res.sure).toBeUndefined();
    expect(gore.knockdown.mock.calls.every(call => (call as unknown[])[1] === undefined || (call as unknown as [unknown, { knockout?: boolean }])[1].knockout !== true)).toBe(true);
  });

  it('drops the body for dead when the hit is clearly over what it has left, and only then', () => {
    const { manager, gore, events, spawn } = world();
    sure(manager);
    const e = spawn('husk');
    const smg = WEAPONS.smg.damage;
    // Gore is handed one reused options object: whether a knockdown was a knock-out is read as it comes.
    const colds: boolean[] = [];
    (gore.knockdown as unknown as { mockImplementation(run: (char: unknown, o?: { knockout?: boolean }) => boolean): void })
      .mockImplementation((_char, o) => { colds.push(o?.knockout === true); return true; });
    // Plenty left: a hit, not a kill.
    e.health = e.maxHealth;
    expect(manager.predictDamage(e, round('smg')).sure).toBeUndefined();
    // A kill by the numbers, but by a hair: the marker says kill, the body waits for the host.
    e.health = smg - 1;
    const close = { ...manager.predictDamage(e, round('smg')) };
    expect(close.killSoon).toBe(true);
    expect(close.sure).toBeUndefined();
    // (Whatever a living body does about such a round, it is not knocked cold.)
    const cold = () => colds.filter(Boolean).length;
    expect(cold()).toBe(0);
    // Clearly dead: what is left is under the round by more than the margin. It goes down limp, now, and is not a corpse.
    const f = spawn('husk', -8);
    f.health = 2;
    const clear = { ...manager.predictDamage(f, round('smg')) };
    expect(clear.sure).toBe('fall');
    expect(cold()).toBe(1);
    expect(f.alive).toBe(true);
    expect(f.downed).toBe(true);
    expect(f.health).toBe(2);
    expect(events.kills).toBe(0);
    for (const death of [gore.ragdoll, gore.collapse, gore.headshot, gore.gib, gore.slice]) expect(death).not.toHaveBeenCalled();
  });

  it('counts its own hits still in the air: the round that takes the last of it is the one that drops it', () => {
    const { manager, spawn } = world();
    sure(manager);
    const e = spawn('husk');
    const smg = WEAPONS.smg.damage;
    e.health = smg * 2 + 2;
    expect(manager.predictDamage(e, round('smg')).sure).toBeUndefined();
    e.owed = smg;
    expect(manager.predictDamage(e, round('smg')).sure).toBeUndefined();
    e.owed = smg * 2;
    expect(manager.predictDamage(e, round('smg')).sure).toBe('fall');
  });

  it('plays the whole death itself only beyond doubt: three times what is left and half its health to spare, and never a blast', () => {
    const { manager, gore, spawn } = world();
    sure(manager);
    const e = spawn('husk');
    e.health = 4;
    const big = round('judge', 'chest', { amount: e.maxHealth });
    const res = { ...manager.predictDamage(e, big) };
    expect(res.sure).toBe('kill');
    // The model leaves the body standing for the caller's kill flow: no knockdown, no flinch of a living body.
    expect(gore.knockdown).not.toHaveBeenCalled();
    expect(e.char.anim.flinch).not.toHaveBeenCalled();
    // The same numbers as a blast: the ring is the host's to roll, so the body only drops.
    const f = spawn('husk', -8);
    f.health = 4;
    expect(manager.predictDamage(f, { ...big, type: 'explosive', region: undefined, bone: undefined, source: 'launcher' }).sure).toBe('fall');
  });

  it('is never sure of a death that is not plain arithmetic: a boss, a man with anatomy, armour in the way, a ward, frost, a tank, a drone', () => {
    const { manager, spawn } = world();
    sure(manager);
    const big = (e: { maxHealth: number }) => round('judge', 'chest', { amount: e.maxHealth * 2 });
    const boss = spawn('husk'); boss.health = 3; boss.isBoss = true;
    expect(manager.predictDamage(boss, big(boss)).sure).toBeUndefined();
    const warded = spawn('husk', -7); warded.health = 3; warded.ward = 50;
    expect(manager.predictDamage(warded, big(warded)).sure).toBeUndefined();
    const frozen = spawn('husk', -8); frozen.health = 3; frozen.frozen = 2;
    expect(manager.predictDamage(frozen, big(frozen)).sure).toBeUndefined();
    const shielded = spawn('husk', -9); shielded.health = 3; shielded.shield = true;
    expect(manager.predictDamage(shielded, big(shielded)).sure).toBeUndefined();
    const drone = spawn('drone', -10); drone.health = 1;
    expect(manager.predictDamage(drone, { ...big(drone), bone: 0 }).sure).toBeUndefined();
    const burner = spawn('burner', -11); burner.health = 1;
    expect(manager.predictDamage(burner, big(burner)).sure).toBeUndefined();
  });

  it('a head it is sure of bursts the way the host would burst it', () => {
    const host = world(), guest = world();
    sure(guest.manager);
    const there = host.spawn('husk'), here = guest.spawn('husk');
    there.health = here.health = 3;
    const shot = () => round('judge', 'head', { amount: there.maxHealth * 2 });
    host.manager.applyDamage(there, shot());
    const heavy = host.manager.model.foundKill.heavyHead;
    const res = { ...guest.manager.predictDamage(here, shot()) };
    expect(res.sure).toBe('kill');
    const told = guest.manager.model.guessKill(here, shot(), { blast: null, shatter: false, heavyHead: false, wound: 0 });
    expect(told).toMatchObject({ blast: null, shatter: false, heavyHead: heavy, wound: 0 });
    // The whole death, through the one kill flow: the same death the host picked.
    guest.manager.replayDeath(here, shot(), false, told, null);
    expect(here.alive).toBe(false);
    expect(guest.gore.headshot).toHaveBeenCalledTimes(host.gore.headshot.mock.calls.length);
    expect(guest.gore.ragdoll).toHaveBeenCalledTimes(host.gore.ragdoll.mock.calls.length);
    // Decided nothing: no kill event of this machine's own.
    expect(guest.events.kills).toBe(0);
  });

  it('the host\'s kill turns a body dropped for dead into the corpse where it lies', () => {
    const { manager, gore, events, spawn } = world();
    sure(manager);
    const e = spawn('husk');
    e.health = 2;
    expect(manager.predictDamage(e, round('smg')).sure).toBe('fall');
    expect(e.downed).toBe(true);
    manager.replayDeath(e, round('smg', 'chest', { force: 0.01 }), false, { blast: null, shatter: false, heavyHead: false, wound: 0 }, null);
    expect(e.alive).toBe(false);
    expect(gore.ragdoll).toHaveBeenCalledTimes(1);
    expect(gore.collapse).not.toHaveBeenCalled();
    expect(events.kills).toBe(0);
  });
});

describe('a guest and the host roll the same for the same hit', () => {
  /** How a body took `count` body hits of the same gun, one every `gap` seconds: each hit's reaction level, in order. */
  const levels = (w: ReturnType<typeof world>, guest: boolean, count: number, numbered: boolean, gun: keyof typeof WEAPONS = 'harrow') => {
    const e = w.spawn('trooper');
    e.health = e.maxHealth = 1e7;
    for (const region of [...e.limbHp.keys()]) e.limbHp.set(region, 1e9);
    const out: string[] = [];
    for (let i = 1; i <= count; i++) {
      const d = round(gun, i % 3 === 0 ? 'legL' : 'chest', numbered ? { claim: i } : {});
      if (guest) w.manager.predictDamage(e, d);
      else w.manager.applyDamage(e, d);
      out.push(w.manager.model.found.level);
      // The next hit meets it on its feet again, as a still target is after it gets up: this compares the rolls.
      e.downed = false; e.rising = 0; e.fallIn = 0; e.stagger = 0; e.reactAt = 0;
    }
    return out;
  };

  it('a hit with the guest\'s number on it does the same to the body on both machines, hit after hit', () => {
    // `knock` false: gore takes no body down, so each machine's own physics is out of it and only the rule is compared.
    const host = world(false), guest = world(false);
    const there = levels(host, false, 120, true), here = levels(guest, true, 120, true);
    expect(here).toEqual(there);
    // And it is not all one answer: the gun does knock them about.
    expect(new Set(there).size).toBeGreaterThan(1);
  });

  it('a hit with no number (single player, the host\'s own gun) is this machine\'s own dice, as it always was', () => {
    const a = levels(world(false), false, 120, false), b = levels(world(false), false, 120, false);
    expect(a).not.toEqual(b);
  });
});

describe('a copy of an enemy with more health than this page would have given it', () => {
  it('has limbs as whole as the host\'s: the pools follow the host\'s health, a fixed head pool does not', () => {
    const host = world(), guest = world();
    // The host's wave is deep (or its rules say double health): its enemy is made with three times the health.
    (host.manager as unknown as { tuning: { health: number } }).tuning.health = 3;
    const there = host.spawn('trooper'), here = guest.spawn('trooper');
    expect(there.maxHealth).toBeCloseTo(here.maxHealth * 3, 6);
    const whole = (e: typeof here) => poolStrengths(e, { legL: 0, legR: 0, armL: 0, armR: 0, trunk: 0, neck: 0 });
    expect(whole(there)).toMatchObject({ legL: 1, legR: 1, armL: 1, armR: 1 });
    // The snapshot's health alone, as it was: every limb reads a third gone (0.66), and worse the deeper the wave.
    const head = here.limbHp.get('head')!;
    const built = here.maxHealth;
    here.maxHealth = there.maxHealth;
    expect(whole(here).legL).toBeLessThan(0.7);
    // Fitted: the same as the host's, limb for limb and pool for pool.
    here.maxHealth = built;
    guest.manager.fitReplicaHealth(here, there.maxHealth);
    expect(here.maxHealth).toBe(there.maxHealth);
    expect(whole(here)).toMatchObject({ legL: 1, legR: 1, armL: 1, armR: 1 });
    for (const region of ['legL', 'shinR', 'armL', 'forearmR', 'abdomen'] as const) expect(here.limbHp.get(region)).toBeCloseTo(there.limbHp.get(region)!, 6);
    expect(here.limbHp.get('head')).toBeCloseTo(there.limbHp.get('head')!, 6);
    expect(head).toBeGreaterThan(0);
    // The same health: nothing moves.
    const before = [...here.limbHp.values()];
    guest.manager.fitReplicaHealth(here, there.maxHealth);
    expect([...here.limbHp.values()]).toEqual(before);
  });
});
