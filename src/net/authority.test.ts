import { describe, expect, it } from 'vitest';
import { ClaimValidator, DAMAGE_ROOM, INSTAKILL, NUKE, claimClass, claimKind, limitsOf, selectTarget, type ClaimScene } from './authority';
import { BLEED_MS, TeamLife, cleanCard, wiped } from './team';
import type { HitClaim, Vec } from './worldProtocol';
import { WEAPONS } from '../weapons/data';
import { KATA } from '../weapons/kata';

const eye: Vec = [0, 1.6, 0], target: Vec = [0, 1, -10];
const claim = (shot = 1, at = 100): HitClaim => ({ t: 'hit', shot, at, target: 42, weapon: 'smg', origin: eye,
  damage: { amount: 12, type: 'bullet', source: 'smg', force: 12, region: 'chest', point: target, dir: [0, 0, -1] } });
const scene = (over: Partial<ClaimScene> = {}): ClaimScene => ({ eye, target, visible: () => true, ...over });
const wall = scene({ visible: () => false });

describe('friends-only hit sanity checks', () => {
  it('allows normal AP, HP and Raufoss plate inputs without bypassing the damage model', () => {
    const validator = new ClaimValidator();
    for (const load of ['ap', 'hp'] as const) {
      const value = claim(); value.damage.load = load;
      expect(validator.check('guest', value, 120, scene()).ok).toBe(true);
    }
    const inside = claim(); inside.damage.type = 'pellet'; inside.damage.pierces = true; inside.damage.headshotMult = 1.5;
    expect(validator.check('guest', inside, 140, scene()).ok).toBe(true);
  });
  it('needs no fire event: a claim carries its own shot', () => {
    const validator = new ClaimValidator();
    expect(validator.check('guest', claim(), 100, scene())).toEqual({ ok: true, kind: 'gun' });
  });
  it('rejects a shot from where the shooter is not, out of range, off the enemy, and non-finite inputs', () => {
    const validator = new ClaimValidator();
    const why = (value: unknown, where = scene()) => { const verdict = validator.check('guest', value, 120, where); return verdict.ok ? 'ok' : verdict.why; };
    expect(why(claim(), scene({ eye: [100, 1, 0] }))).toBe('eye');
    expect(why(claim(), scene({ target: [0, 0, -900] }))).toBe('range');
    expect(why(claim(), scene({ target: [0, 0, -400] }))).toBe('point');
    for (const bad of [NaN, Infinity, -1, 0]) {
      const value = claim(); value.damage.amount = bad;
      expect(why(value)).toBe('shape');
    }
    const forged = claim(); forged.damage.headshotMult = Infinity;
    expect(why(forged)).toBe('shape');
    expect(why(null)).toBe('shape');
    expect(why({ t: 'hit', target: 'all' })).toBe('shape');
    const typed = claim(); typed.damage.type = 'magic' as never;
    expect(why(typed)).toBe('shape');
    expect(validator.refused.shape).toBe(8);
  });
  it('cuts a claim over its cap to the cap instead of throwing it away', () => {
    const validator = new ClaimValidator();
    const big = claim(); big.damage.amount = 1e9;
    expect(validator.check('guest', big, 120, scene()).ok).toBe(true);
    expect(big.damage.amount).toBe(Math.max(2000, limitsOf('smg')!.damage * DAMAGE_ROOM));
    expect(validator.clamped).toBe(1);
    // A blade's claim of 9999 is a blade's hit, not a refusal.
    const blade = claim(2); blade.damage.source = 'sword'; blade.damage.type = 'slash'; blade.damage.amount = 99999;
    expect(validator.check('guest', blade, 130, scene()).ok).toBe(true);
    expect(blade.damage.amount).toBe(20000);
    // Under the cap nothing changes, with every perk at once (6x) on the heaviest round.
    const sabot = claim(3); sabot.damage.source = 'sabot'; sabot.damage.amount = WEAPONS.sabot.damage * 6;
    expect(validator.check('guest', sabot, 140, scene()).ok).toBe(true);
    expect(sabot.damage.amount).toBe(WEAPONS.sabot.damage * 6);
  });
  it('lets every hit of a shot in once the shot is in, up to far more than a shot can land', () => {
    const validator = new ClaimValidator();
    for (let index = 0; index < 256; index++) expect(validator.check('guest', claim(), 120, scene()).ok).toBe(true);
    expect(validator.check('guest', claim(), 120, scene())).toEqual({ ok: false, why: 'hits' });
    expect(validator.check('guest', claim(2), 120, scene()).ok).toBe(true);
  });
  it('counts shots on the shooter\'s clock: a burst that arrives together passes, a flood does not', () => {
    const validator = new ClaimValidator();
    // Two seconds of an SMG under Berserk and Haste (37.5 ms a shot), every shot arriving in the same host frame.
    for (let shot = 1; shot <= 53; shot++) expect(validator.check('guest', claim(shot, shot * 37.5), 5000, scene()).ok).toBe(true);
    // The same gun claiming a shot a millisecond for two seconds: the bucket runs dry.
    const flood = new ClaimValidator();
    let accepted = 0;
    for (let shot = 1; shot <= 2000; shot++) if (flood.check('guest', claim(shot, shot), shot, scene()).ok) accepted++;
    expect(accepted).toBeLessThan(1000);
    expect(flood.refused.rate).toBeGreaterThan(1000);
    // A clock that runs ahead of the host's buys nothing past the first few seconds.
    const fast = new ClaimValidator();
    let ahead = 0;
    for (let shot = 1; shot <= 2000; shot++) if (fast.check('guest', claim(shot, shot * 1000), shot, scene()).ok) ahead++;
    expect(ahead).toBeLessThan(1900);
  });
  it('follows a shooter whose clock starts again (a reloaded page)', () => {
    const validator = new ClaimValidator();
    for (let shot = 1; shot <= 200; shot++) validator.check('guest', claim(shot, 600_000 + shot * 75), 1000 + shot * 75, scene());
    for (let shot = 1; shot <= 200; shot++) expect(validator.check('guest', claim(1000 + shot, shot * 75), 20_000 + shot * 75, scene()).ok).toBe(true);
  });
  it('tests sight only for a straight shot from a gun that cannot pass walls, and gives odd cases the benefit of the doubt', () => {
    const validator = new ClaimValidator();
    const far = (shot: number, source = 'shotgun'): HitClaim => {
      const value = claim(shot, shot * 600); value.damage.source = source; value.damage.type = source === 'shotgun' ? 'pellet' : 'bullet'; return value;
    };
    // Eight odd cases pass, then a wall is a wall.
    for (let shot = 1; shot <= 8; shot++) expect(validator.check('guest', far(shot), 100, wall).ok).toBe(true);
    expect(validator.check('guest', far(9), 100, wall)).toEqual({ ok: false, why: 'sight' });
    expect(validator.doubted).toBe(8);
    // Guns that go through walls, AP and API loads, a hop, a flame, and anything at arm's length are never tested.
    for (const source of ['lance', 'sabot', 'piledriver', 'awl', 'harrow']) expect(validator.check('guest', far(10, source), 100, wall).ok).toBe(true);
    const ap = far(11, 'smg'); ap.damage.load = 'ap';
    expect(validator.check('guest', ap, 100, wall).ok).toBe(true);
    const hop = far(12); hop.hop = 1;
    expect(validator.check('guest', hop, 100, wall).ok).toBe(true);
    const near = far(13); near.damage.point = [0, 1, -4];
    expect(validator.check('guest', near, 100, scene({ target: [0, 1, -4], visible: () => false })).ok).toBe(true);
    // The allowance comes back at one a second.
    expect(validator.check('guest', far(14), 100, wall).ok).toBe(false);
    expect(validator.check('guest', far(15), 1200, wall).ok).toBe(true);
    // Seen from the host's own copy of the eye, or to the enemy as the host has it: a second look saves the hit.
    const second = new ClaimValidator();
    const peek = (from: Vec, to: Vec) => from === eye && to === target;
    const moved = far(1); moved.origin = [1.5, 1.6, 0];
    expect(second.check('guest', moved, 100, scene({ visible: peek })).ok).toBe(true);
    expect(second.doubted).toBe(0);
  });
  it('lets a dash on a slow link through, and a Titan\'s size', () => {
    const validator = new ClaimValidator();
    // 26 m/s for half a second of pose age and ping.
    const dashed = claim(); dashed.origin = [13, 1.6, 0];
    expect(validator.check('guest', dashed, 100, scene({ ping: 200 })).ok).toBe(true);
    const titan = claim(2); titan.damage.point = [0, 9, -10];
    expect(validator.check('guest', titan, 100, scene({ size: 6 })).ok).toBe(true);
    // The Lance's beam names its far end: the enemy is somewhere along it, up to 400 m out.
    const beam = claim(3); beam.damage.source = 'lance'; beam.damage.type = 'fire'; beam.damage.point = [0, 1.6, -400];
    expect(validator.check('guest', beam, 100, scene({ target: [0.5, 1, -380] })).ok).toBe(true);
  });
  it('knows each gun\'s fastest from the weapon table', () => {
    expect(limitsOf('smg')!.fastest).toBeCloseTo(Math.min(60 / (60 / WEAPONS.smg.interval + 100) / 2, KATA.step));
    expect(limitsOf('judge')!.fastest).toBeCloseTo(WEAPONS.judge.altFan!.gap / 2);
    expect(limitsOf('rivet')!.fastest).toBeCloseTo(WEAPONS.rivet.interval / 2);
    expect(limitsOf('shotgun')!.fastest).toBeCloseTo(WEAPONS.shotgun.interval);
    expect(limitsOf('ultramag')!.fastest).toBeCloseTo(Math.min(WEAPONS.ultramag.interval / 1.25 / 1.15 / 2, KATA.step));
    expect(limitsOf('autocannon')!.instakill).toBe(true);
    expect(limitsOf('lance')!.pierces).toBe(true);
    expect(limitsOf('shotgun')!.pierces).toBe(false);
    expect(limitsOf('smg')!.pierces).toBe(false);
    expect(limitsOf('deuce')!.pellets).toBeGreaterThanOrEqual(WEAPONS.deuce.pellets * 4 * 3.5);
    expect(limitsOf('__proto__')).toBeNull();
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

describe('blast, call-in, perk and body claims', () => {
  const blast = (source: string): HitClaim => ({ ...claim(), damage: { ...claim().damage, type: 'explosive', source, amount: 300 } });
  it('sorts claims by what made them', () => {
    expect(claimClass('smg', 'bullet')).toBe('gun');
    expect(claimClass('rocket', 'explosive')).toBe('blast');
    expect(claimClass('grenade', 'explosive')).toBe('blast');
    expect(claimClass('airstrike', 'explosive')).toBe('callin');
    expect(claimClass('ac130_105', 'explosive')).toBe('callin');
    expect(claimClass('frame_rotary', 'bullet')).toBe('callin');
    expect(claimClass('sword', 'slash')).toBe('melee');
    expect(claimClass('sword_flurry', 'slash')).toBe('melee');
    expect(claimClass('knife', 'melee')).toBe('melee');
    expect(claimClass('sword_wave', 'explosive')).toBe('blast');
    // Not a gun's shot, and not a call-in: each passes on its own count.
    expect(claimClass('chain_storm', 'shock')).toBe('perk');
    expect(claimClass('chain_reaction', 'explosive')).toBe('perk');
    expect(claimClass('skyfall', 'explosive')).toBe('perk');
    expect(claimClass('emplacement', 'bullet')).toBe('mounted');
    expect(claimClass('slam', 'crush')).toBe('body');
    expect(claimClass('sword_deflect', 'bullet')).toBe('body');
    expect(claimClass('gib', 'bullet')).toBe('body');
    expect(claimClass('mortar', 'explosive')).toBe('world');
    expect(claimClass('something_new', 'bullet')).toBe('other');
    expect(claimKind('smg', 'bullet')).toBe('shot');
    expect(claimKind('rocket', 'explosive')).toBe('blast');
    expect(claimKind('airstrike', 'explosive')).toBe('assist');
  });
  it('reads every weapon in the table as a gun or a blade, and its blast as a blast', () => {
    for (const id of Object.keys(WEAPONS)) {
      expect(['gun', 'melee'], id).toContain(claimClass(id, 'bullet'));
      expect(claimClass(id, 'explosive'), id).toBe('blast');
      expect(limitsOf(id), id).not.toBeNull();
    }
  });
  it('takes a grenade round a corner without a shot, but not a flood', () => {
    const validator = new ClaimValidator();
    expect(validator.check('guest', blast('grenade'), 1000, wall).ok).toBe(true);
    let accepted = 0;
    for (let i = 0; i < 4000; i++) if (validator.check('guest', blast('grenade'), 1500, scene()).ok) accepted++;
    expect(accepted).toBeLessThan(1000);
    expect(validator.refused.flood).toBeGreaterThan(3000);
    const later = blast('grenade'); later.at = 5000;
    expect(validator.check('guest', later, 5500, scene()).ok).toBe(true);
  });
  it('takes a perk, a slam, a parry and a mounted gun with no shot and no call-in', () => {
    const validator = new ClaimValidator();
    for (const [source, type] of [['chain_storm', 'shock'], ['chain_reaction', 'explosive'], ['skyfall', 'explosive'], ['slam', 'crush'],
      ['sword_deflect', 'bullet'], ['emplacement', 'bullet'], ['gib', 'bullet'], ['rigged', 'explosive'], ['drop_pod', 'explosive'], ['frame_rotary', 'bullet']] as const) {
      const value = claim(); value.damage.source = source; value.damage.type = type;
      expect(validator.check('guest', value, 500_000, scene()).ok, source).toBe(true);
    }
  });
  it('takes a call-in from anywhere on the map, long after it was called', () => {
    const validator = new ClaimValidator();
    const far = blast('ac130_105'); far.damage.point = [0, 1, -1200];
    expect(validator.check('guest', far, 2000, scene({ target: [0, 1, -1200], visible: () => false })).ok).toBe(true);
    // A sentry still standing ten minutes on, a mech still walking.
    expect(validator.check('guest', blast('sentry'), 700_000, wall).ok).toBe(true);
    expect(validator.check('guest', blast('frame_pod'), 700_000, wall).ok).toBe(true);
  });
  it('keeps a downed shooter\'s gun quiet, but not what was already in the air or stands by itself', () => {
    const validator = new ClaimValidator();
    const down = scene({ down: true });
    expect(validator.check('guest', claim(), 100, down)).toEqual({ ok: false, why: 'down' });
    expect(validator.check('guest', blast('grenade'), 100, down).ok).toBe(true);
    expect(validator.check('guest', blast('sentry'), 100, down).ok).toBe(true);
  });
  it('takes the instakills a guest really has, at the host\'s number, and cuts a forged one to the cap', () => {
    const kill = (source: string, blastKind: string, amount = 99999): HitClaim => {
      const value = blast(source); value.damage.amount = amount; value.damage.blastKind = blastKind as never; return value;
    };
    const amount = (validator: ClaimValidator, value: HitClaim, now: number): number => {
      expect(validator.check('guest', value, now, wall).ok).toBe(true);
      return value.damage.amount;
    };
    const validator = new ClaimValidator();
    // The autocannon's HE shell: a direct hit is a bullet at 99999, its 5 m splash an instakill blast.
    const direct = claim(); direct.weapon = 'autocannon'; direct.damage.source = 'autocannon'; direct.damage.amount = 99999 * 6;
    expect(amount(validator, direct, 1100)).toBe(INSTAKILL);
    expect(amount(validator, kill('autocannon', 'shell', 123456), 1200)).toBe(INSTAKILL);
    // Not from a gun that makes them: a grenade, or the wrong blast kind. Cut to the cap, never thrown away.
    expect(amount(validator, kill('grenade', 'grenade'), 1300)).toBe(20000);
    expect(amount(validator, kill('autocannon', 'hellfire'), 1300)).toBe(20000);
    expect(amount(validator, kill('smg', 'shell'), 1300)).toBe(20000);
    // Hellfire rockets off a launcher.
    expect(amount(validator, kill('rocket', 'hellfire'), 10_100)).toBe(INSTAKILL);
    expect(amount(validator, kill('rocket', 'rocket'), 10_100)).toBe(20000);
    // Call-ins: the airstrike's finale, the Black Sun, the AC-130's bomb and the nuke, once one was called in.
    expect(amount(validator, kill('airstrike', 'hellfire'), 12_000)).toBe(20000);
    validator.callIn('guest', 12_000);
    expect(amount(validator, kill('airstrike', 'hellfire'), 12_100)).toBe(INSTAKILL);
    expect(amount(validator, kill('black_sun', 'finisher'), 12_100)).toBe(INSTAKILL);
    expect(amount(validator, kill('ac130_bomb', 'finisher'), 12_100)).toBe(INSTAKILL);
    expect(amount(validator, kill('mech', 'hellfire'), 12_100)).toBe(20000);
    const nuke = kill('nuke', 'x', 999999); nuke.damage.type = 'true'; delete nuke.damage.blastKind;
    expect(amount(validator, nuke, 12_200)).toBe(NUKE);
    // Under the cap nothing changes: an armoured man's shaped-charge share of the shell is the guest's number.
    expect(amount(validator, kill('autocannon', 'shell', 400), 13_100)).toBe(400);
  });
  it('takes fire, frost and a live bolt, each cut to the longest the game gives', () => {
    const validator = new ClaimValidator();
    expect(validator.status('guest', { t: 'status', uid: 4, kind: 'burn', s: 6, at: 100 }, 100)).toBe(6);
    expect(validator.status('guest', { t: 'status', uid: 4, kind: 'freeze', s: 9999, at: 100 }, 100)).toBe(20);
    expect(validator.status('guest', { t: 'status', uid: 4, kind: 'bolt', s: 1.5, at: 100 }, 100)).toBe(1.5);
    for (const bad of [{ t: 'status', uid: 4, kind: 'melt', s: 1 }, { t: 'status', uid: -1, kind: 'burn', s: 1 }, { t: 'status', uid: 4, kind: 'burn', s: NaN },
      { t: 'status', uid: 4, kind: '__proto__', s: 1 }, null]) expect(validator.status('guest', bad, 100)).toBeNull();
  });
  it('takes a round and a blast on a vehicle', () => {
    const validator = new ClaimValidator();
    const round = { t: 'vhit', id: 3, part: 'engine', point: [0, 1, 0], amount: 60, source: 'harrow', at: 100 };
    expect(validator.vehicle('guest', round, 100)).toBe(true);
    const shell = { t: 'vhit', id: 1, point: [0, 1, 0], amount: 1e9, source: 'autocannon', at: 100, kind: 'shell', radius: 5, inst: 1 };
    expect(validator.vehicle('guest', shell, 100)).toBe(true);
    expect(shell.amount).toBe(INSTAKILL);
    for (const bad of [{ ...round, id: 0 }, { ...round, amount: -1 }, { ...round, point: [0, NaN, 0] }, { ...round, radius: 1e6 }, null]) expect(validator.vehicle('guest', bad, 100)).toBe(false);
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
