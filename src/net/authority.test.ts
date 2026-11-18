import { describe, expect, it } from 'vitest';
import { ClaimValidator, claimKind, selectTarget } from './authority';
import { BLEED_MS, TeamLife, cleanCard, wiped } from './team';
import type { HitClaim, Vec } from './worldProtocol';

const eye: Vec = [0, 1.6, 0], target: Vec = [0, 1, -10];
const claim = (): HitClaim => ({ t: 'hit', shot: 1, target: 42, weapon: 'smg', origin: eye,
  damage: { amount: 12, type: 'bullet', source: 'smg', force: 12, region: 'chest', point: target, dir: [0, 0, -1] } });

describe('friends-only hit sanity checks', () => {
  it('allows normal AP, HP and Raufoss plate inputs without bypassing the damage model', () => {
    const validator = new ClaimValidator();
    expect(validator.acceptFire('guest', 1, 'smg', 100)).toBe(true);
    for (const load of ['ap', 'hp'] as const) {
      const value = claim(); value.damage.load = load;
      expect(validator.validate('guest', value, 120, eye, target, () => true)).toBe(true);
    }
    const inside = claim(); inside.damage.type = 'pellet'; inside.damage.pierces = true; inside.damage.headshotMult = 1.5;
    expect(validator.validate('guest', inside, 140, eye, target, () => true)).toBe(true);
  });
  it('rejects no shot, wrong identity, replay, rate, range, cover and non-finite inputs', () => {
    const validator = new ClaimValidator();
    expect(validator.validate('guest', claim(), 100, eye, target, () => true)).toBe(false);
    expect(validator.acceptFire('guest', 1, 'smg', 100)).toBe(true);
    expect(validator.acceptFire('guest', 1, 'smg', 200)).toBe(false);
    expect(validator.acceptFire('guest', 2, 'smg', 101)).toBe(false);
    expect(validator.acceptFire('other', 1, '__proto__', 100)).toBe(false);
    expect(validator.validate('other', claim(), 120, eye, target, () => true)).toBe(false);
    expect(validator.validate('guest', claim(), 120, eye, target, () => false)).toBe(false);
    expect(validator.validate('guest', claim(), 120, [100, 1, 0], target, () => true)).toBe(false);
    expect(validator.validate('guest', claim(), 120, eye, [0, 0, -400], () => true)).toBe(false);
    for (const bad of [NaN, Infinity, -1, 1e9]) {
      const value = claim(); value.damage.amount = bad;
      expect(validator.validate('guest', value, 120, eye, target, () => true)).toBe(false);
    }
    const forged = claim(); forged.damage.headshotMult = Infinity;
    expect(validator.validate('guest', forged, 120, eye, target, () => true)).toBe(false);
    expect(validator.validate('guest', null, 120, eye, target, () => true)).toBe(false);
    validator.forget('guest');
    expect(validator.validate('guest', claim(), 120, eye, target, () => true)).toBe(false);
  });
  it('caps pellets and secondary damage per shot while allowing a complete Raufoss burst', () => {
    const validator = new ClaimValidator(); validator.acceptFire('guest', 1, 'smg', 0);
    for (let index = 0; index < 64; index++) expect(validator.validate('guest', claim(), 120, eye, target, () => true)).toBe(true);
    expect(validator.validate('guest', claim(), 120, eye, target, () => true)).toBe(false);
  });
});

describe('all-player enemy target selection', () => {
  const players = [{ id: 'host', alive: true, position: [10, 0, 0] }, { id: 'guest', alive: true, position: [3, 0, 0] }];
  it('chooses a nearer guest, retains close calls, switches and excludes dead players', () => {
    expect(selectTarget([0, 0, 0], players)?.id).toBe('guest');
    expect(selectTarget([0, 0, 0], [{ ...players[0]!, position: [3.2, 0, 0] }, players[1]!], 'host')?.id).toBe('host');
    expect(selectTarget([0, 0, 0], players, 'host')?.id).toBe('guest');
    expect(selectTarget([0, 0, 0], [players[0]!, { ...players[1]!, alive: false }])?.id).toBe('host');
    expect(selectTarget([0, 0, 0], [])).toBeUndefined();
  });
});

describe('blast and call-in claims', () => {
  const blast = (source: string): HitClaim => ({ ...claim(), damage: { ...claim().damage, type: 'explosive', source, amount: 300 } });
  it('sorts claims by what made them', () => {
    expect(claimKind('smg', 'bullet')).toBe('shot');
    expect(claimKind('rocket', 'explosive')).toBe('blast');
    expect(claimKind('airstrike', 'explosive')).toBe('assist');
    expect(claimKind('ac130_105', 'explosive')).toBe('assist');
  });
  it('takes a grenade round a corner without a shot, but not a flood', () => {
    const validator = new ClaimValidator();
    expect(validator.validate('guest', blast('grenade'), 1000, eye, target, () => false)).toBe(true);
    let accepted = 0;
    for (let i = 0; i < 400; i++) if (validator.validate('guest', blast('grenade'), 1500, eye, target, () => true)) accepted++;
    expect(accepted).toBeLessThan(200);
    expect(validator.validate('guest', blast('grenade'), 2500, eye, target, () => true)).toBe(true);
  });
  it('takes a call-in only from a guest who called one in lately', () => {
    const validator = new ClaimValidator();
    expect(validator.validate('guest', blast('airstrike'), 1000, eye, target, () => false)).toBe(false);
    validator.callIn('guest', 1000);
    const far = blast('airstrike'); far.damage.point = [0, 1, -600];
    expect(validator.validate('guest', far, 2000, eye, [0, 1, -600], () => false)).toBe(true);
    expect(validator.validate('guest', blast('airstrike'), 400_000, eye, target, () => false)).toBe(false);
    // A drop pod lands on its own clock.
    expect(validator.validate('guest', blast('drop_pod'), 500_000, eye, target, () => false)).toBe(true);
  });
  it('takes the instakills a guest really has, at the host\'s number, and no forged one', () => {
    const kill = (source: string, blastKind: string, amount = 99999): HitClaim => {
      const value = blast(source); value.damage.amount = amount; value.damage.blastKind = blastKind as never; return value;
    };
    const validator = new ClaimValidator();
    // The autocannon's HE shell: a direct hit is a bullet at 99999 (under the gun's own cap), its 5 m splash an instakill blast.
    expect(validator.acceptFire('guest', 1, 'autocannon', 1000)).toBe(true);
    const direct = claim(); direct.weapon = 'autocannon'; direct.damage.source = 'autocannon'; direct.damage.amount = 99999;
    expect(validator.validate('guest', direct, 1100, eye, target, () => true)).toBe(true);
    const splash = kill('autocannon', 'shell', 123456);
    expect(validator.validate('guest', splash, 1200, eye, target, () => false)).toBe(true);
    expect(splash.damage.amount).toBe(99999);
    // Not from a gun that makes them: a grenade, the wrong blast kind, or a shell past the shot's 8 s.
    expect(validator.validate('guest', kill('grenade', 'grenade'), 1300, eye, target, () => true)).toBe(false);
    expect(validator.validate('guest', kill('autocannon', 'hellfire'), 1300, eye, target, () => true)).toBe(false);
    expect(validator.validate('guest', kill('autocannon', 'shell'), 9500, eye, target, () => true)).toBe(false);
    // Hellfire rockets off the launcher that fired, not off a gun that fires none.
    expect(validator.acceptFire('guest', 2, 'rocket', 10_000)).toBe(true);
    expect(validator.validate('guest', kill('rocket', 'hellfire'), 10_100, eye, target, () => true)).toBe(true);
    expect(validator.validate('guest', kill('rocket', 'rocket'), 10_100, eye, target, () => true)).toBe(false);
    expect(validator.acceptFire('guest', 3, 'smg', 11_000)).toBe(true);
    expect(validator.validate('guest', kill('smg', 'shell'), 11_100, eye, target, () => true)).toBe(false);
    // Call-ins: the airstrike's finale, the Black Sun and the nuke, only once one was called in.
    expect(validator.validate('guest', kill('airstrike', 'hellfire'), 12_000, eye, target, () => false)).toBe(false);
    validator.callIn('guest', 12_000);
    expect(validator.validate('guest', kill('airstrike', 'hellfire'), 12_100, eye, target, () => false)).toBe(true);
    expect(validator.validate('guest', kill('black_sun', 'finisher'), 12_100, eye, target, () => false)).toBe(true);
    expect(validator.validate('guest', kill('mech', 'hellfire'), 12_100, eye, target, () => false)).toBe(false);
    const nuke = kill('nuke', 'x', 999999); nuke.damage.type = 'true'; delete nuke.damage.blastKind;
    expect(validator.validate('guest', nuke, 12_200, eye, target, () => false)).toBe(true);
    expect(nuke.damage.amount).toBe(999999);
    // Under the cap nothing changes: an armoured man's shaped-charge share of the shell is the guest's number.
    const armour = kill('autocannon', 'shell', 400);
    validator.acceptFire('guest', 4, 'autocannon', 13_000);
    expect(validator.validate('guest', armour, 13_100, eye, target, () => true)).toBe(true);
    expect(armour.damage.amount).toBe(400);
  });
});

describe('down, revive, bleed-out and respawn', () => {
  it('goes down once, revives only from down, bleeds out on time and respawns the dead', () => {
    const life = new TeamLife();
    expect(life.accepts(0)).toBe(true);
    expect(life.fall(100)).toBe(true); expect(life.fall(150)).toBe(false);
    expect(life.accepts(0)).toBe(false);
    expect(life.revive()).toBe(true); expect(life.life).toBe(1); expect(life.revive()).toBe(false);
    expect(life.accepts(0)).toBe(false); expect(life.accepts(1)).toBe(true);
    expect(life.fall(1000)).toBe(true);
    expect(life.bleed(1000 + BLEED_MS - 1)).toBe(false);
    expect(life.bleed(1000 + BLEED_MS)).toBe(true); expect(life.state).toBe('dead');
    expect(life.revive()).toBe(false);
    expect(life.respawn()).toBe(true); expect(life.state).toBe('up'); expect(life.life).toBe(2);
    expect(life.respawn()).toBe(false);
  });
  it('wipes only when nobody at all is up', () => {
    const a = new TeamLife(), b = new TeamLife();
    expect(wiped([])).toBe(false);
    a.fall(0);
    expect(wiped([a, b])).toBe(false);
    b.fall(0); b.bleed(BLEED_MS);
    expect(wiped([a, b])).toBe(true);
  });
  it('clamps a card from another browser and refuses a bad slot', () => {
    expect(cleanCard({ slot: 9 })).toBeNull();
    expect(cleanCard('x')).toBeNull();
    const card = cleanCard({ slot: 1, state: 'zombie', hp: -5, credits: 1e12, kills: NaN, max: 0, bleed: 99 })!;
    expect(card).toMatchObject({ slot: 1, state: 'up', hp: 0, credits: 1e9, kills: 0, max: 100, bleed: 60 });
  });
});
