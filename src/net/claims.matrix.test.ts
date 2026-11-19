/**
 * The claims matrix: every weapon, mod load, melee weapon, grenade, call-in and perk, at the fastest the game really lets it
 * go, fed to the real `ClaimValidator` the way each would reach the host: on a clean link, on a bad one, and with the host
 * hitching. Not one honest claim may be refused or cut. The cadences here are worked out from the weapon table by this file's
 * own arithmetic (Weapons.ts's rules), not from `limitsOf`, so the two check each other.
 *
 * `CLAIMS_MATRIX_OUT=<file> npx vitest run src/net/claims.matrix.test.ts` writes the table as JSON.
 */
import fs from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import type { ModId, WeaponId } from '../core/gameplay';
import { CAPS } from '../progression/implants';
import { STACK } from '../progression/data';
import { TUNING, WEAPONS, type WeaponDef } from '../weapons/data';
import { KATA } from '../weapons/kata';
import { ENERGY, isMelee } from '../weapons/melee/data';
import { MODS, MOD_ORDER, moddedDef } from '../weapons/mods';
import { MOUNT_LEVELS } from '../vehicles/emplacement';
import { ClaimValidator, type ClaimScene } from './authority';
import type { HitClaim, Vec } from './worldProtocol';

const eye: Vec = [0, 1.6, 0], target: Vec = [0, 1, -20];
const scene: ClaimScene = { eye, target, visible: () => true, size: 2, speed: 4, ping: 120 };

/** Every perk's fire rate at once with implants on (the cap), and off (Berserk 3, Haste 1.5, five Geneva stacks). */
const RATE = { capped: CAPS.fireRate, uncapped: 3 * STACK.fireRate.haste * (1 + 5 * STACK.genevaFireRatePerStack) };
const DAMAGE = CAPS.damage;

type Link = 'clean' | 'bad' | 'hitch';
const LINKS: readonly Link[] = ['clean', 'bad', 'hitch'];

/** A seeded roll, so a failure is the same failure every run. */
function rolls(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
}

/**
 * When each claim, made at `at` on the shooter's clock, is read by the host. `clean`: 20 ms. `bad`: 120 ms with 40 ms of
 * jitter and 5% loss on an ordered channel (a lost message holds up everything behind it for a resend). `hitch`: the host
 * runs at 15 frames a second and stalls outright for 400 ms now and then.
 */
function arrivals(at: readonly number[], link: Link, roll: () => number): number[] {
  const out: number[] = [];
  let last = -Infinity;
  for (const time of at) {
    let now = time + 20;
    if (link === 'bad') now = time + 120 + (roll() * 2 - 1) * 40 + (roll() < 0.05 ? 250 : 0);
    if (link === 'hitch') {
      now = Math.ceil((time + 20) / 66.7) * 66.7;
      const stall = Math.floor(now / 1500) * 1500 + 300;
      if (now > stall && now < stall + 400) now = stall + 400;
    }
    last = Math.max(last, now);
    out.push(last);
  }
  return out;
}

interface Row { what: string; link: Link; shots: number; claims: number; accepted: number; cut: number; perSecond: number; refused: string }
const table: Row[] = [];

interface Fire {
  what: string;
  source: string;
  type?: string;
  /** Seconds between shots. */
  interval: number;
  /** Shots fired, or seconds of fire when `seconds` is given instead. */
  shots?: number;
  seconds?: number;
  /** Hits each shot lands. */
  hits?: number;
  amount: number;
  /** The shooter's own frame time, ms: shots inside one frame are claimed at the same moment. */
  frame?: number;
  /** Shots between two pauses of `rest` s (a burst, a fan, a magazine). */
  group?: number;
  rest?: number;
  load?: HitClaim['damage']['load'];
  blastKind?: string;
  /** Hits that share one shot id for this long (a beam, a round in flight): the guest's `STALE_MS` rule. */
  shared?: number;
  point?: Vec;
  where?: Partial<ClaimScene>;
  called?: boolean;
}

/** Fires it on every kind of link and expects every claim taken, whole. */
function fire(spec: Fire): void {
  for (const link of LINKS) {
    const validator = new ClaimValidator();
    if (spec.called) validator.callIn('guest', 0);
    const roll = rolls(7);
    const frame = spec.frame ?? 1000 / 60;
    const total = spec.shots ?? Math.max(1, Math.round(spec.seconds! / spec.interval));
    const made: number[] = [];
    let clock = 1000;
    for (let shot = 0; shot < total; shot++) {
      // Fired when the cooldown says, claimed in the frame that runs it.
      made.push(Math.ceil(clock / frame) * frame);
      clock += spec.interval * 1000;
      if (spec.group && (shot + 1) % spec.group === 0) clock += (spec.rest ?? 0) * 1000;
    }
    const read = arrivals(made, link, roll);
    let accepted = 0, claims = 0, id = 0, idAt = -Infinity;
    const reasons = new Set<string>();
    for (let shot = 0; shot < total; shot++) {
      if (!spec.shared || made[shot]! - idAt > spec.shared) { id++; idAt = made[shot]!; }
      for (let hit = 0; hit < (spec.hits ?? 1); hit++) {
        const claim: HitClaim = { t: 'hit', shot: id, at: Math.round(made[shot]!), target: 1 + hit, weapon: 'smg', origin: eye,
          damage: { amount: spec.amount, type: (spec.type ?? 'bullet') as never, source: spec.source, force: 10, region: 'chest', point: spec.point ?? target, dir: [0, 0, -1],
            ...(spec.load ? { load: spec.load } : {}), ...(spec.blastKind ? { blastKind: spec.blastKind as never } : {}) } };
        const verdict = validator.check('guest', claim, read[shot]!, { ...scene, ...spec.where });
        claims++;
        if (verdict.ok && claim.damage.amount === spec.amount) accepted++;
        else reasons.add(verdict.ok ? 'cut' : verdict.why);
      }
    }
    const seconds = Math.max(0.001, (made[made.length - 1]! - made[0]!) / 1000);
    table.push({ what: spec.what, link, shots: total, claims, accepted, cut: validator.clamped, perSecond: Math.round(total / seconds * 10) / 10, refused: [...reasons].join(',') });
    expect(accepted, `${spec.what} on a ${link} link: ${[...reasons].join(',')}`).toBe(claims);
  }
}

/** Seconds between shots as Weapons.ts works it out: the row's interval over the perks' rate, not under its bolt's cycle, halved by akimbo. */
const cadence = (row: WeaponDef, rate: number, interval = row.interval): number => Math.max(row.cycleTime ?? 0, interval / rate) / (row.akimbo ? 2 : 1);
const modsOf = (id: WeaponId): ModId[] => MOD_ORDER.filter(mod => MODS[mod].weapon === id);
/** The rows a gun can be: bare, each mod alone, and every mod together (rate mods stack). */
const rowsOf = (id: WeaponId): { name: string; row: WeaponDef }[] => [
  { name: 'bare', row: WEAPONS[id] },
  ...modsOf(id).map(mod => ({ name: mod, row: moddedDef(id, new Set<ModId>([mod])) })),
  { name: 'every mod', row: moddedDef(id, new Set<ModId>(modsOf(id))) },
];
/** Pellets one pull throws: every barrel together, and the pellet perks' cap. */
const pellets = (row: WeaponDef): number => row.pellets > 1 ? row.pellets * (row.altBoth ? row.magSize : 1) * CAPS.pellets : 1;

const GUNS = (Object.keys(WEAPONS) as WeaponId[]).filter(id => !isMelee(id));
const BLADES = (Object.keys(WEAPONS) as WeaponId[]).filter(id => isMelee(id));

describe('claims matrix: every gun, at its fastest, on every link', () => {
  for (const id of GUNS) {
    it(`${id}: bare, every mod, every perk`, () => {
      for (const { name, row } of rowsOf(id)) {
        const type = row.pellets > 1 ? 'pellet' : id === 'kiln' ? 'fire' : 'bullet';
        // Each pellet through three bodies; a round through three.
        const hits = pellets(row) * 3;
        const amount = row.damage >= 9999 ? row.damage : row.damage * DAMAGE;
        fire({ what: `${id} / ${name}`, source: id, type, interval: cadence(row, 1), seconds: 3, hits, amount, load: row.load });
        fire({ what: `${id} / ${name} / rate cap ${RATE.capped}x`, source: id, type, interval: cadence(row, RATE.capped), seconds: 3, hits, amount, load: row.load });
        fire({ what: `${id} / ${name} / implants off ${RATE.uncapped.toFixed(1)}x`, source: id, type, interval: cadence(row, RATE.uncapped), seconds: 3, hits, amount, load: row.load });
        // The shooter at 15 frames a second: several shots claimed in one frame.
        fire({ what: `${id} / ${name} / rate cap, shooter at 15 fps`, source: id, type, interval: cadence(row, RATE.capped), seconds: 3, hits, amount, load: row.load, frame: 66.7 });
        if (row.smart) fire({ what: `${id} / ${name} / smart aim`, source: id, interval: cadence(row, RATE.capped, row.smart.interval), seconds: 3, amount });
        const burst = row.select?.burst ?? row.pullBurst;
        if (burst) fire({ what: `${id} / ${name} / bursts`, source: id, interval: cadence(row, RATE.capped), seconds: 3, amount, group: burst.rounds, rest: burst.recover / RATE.capped / (row.akimbo ? 2 : 1) });
        if (row.altFan && !row.akimbo) {
          fire({ what: `${id} / ${name} / fan of ${row.altFan.bars}`, source: id, interval: row.altFan.gap, shots: row.altFan.bars * 6, amount, group: row.altFan.bars, rest: row.altFan.recover / RATE.capped });
        }
      }
    });
  }
  it('Gun Kata: fourteen rounds from two guns, one every 85 ms, kata after kata', () => {
    for (const id of GUNS.filter(id => rowsOf(id).some(r => r.row.akimbo) || id === 'smg')) {
      fire({ what: `${id} / Gun Kata`, source: id, interval: KATA.step, shots: KATA.most * 3, amount: WEAPONS[id].damage * DAMAGE, group: KATA.most, rest: 0.2 });
    }
  });
  it('the Lance: rail through walls, the beam on a crowd out to 400 m, balls and bursts', () => {
    const beam = TUNING.lance.beam;
    fire({ what: 'lance / rail through two walls, 31 bodies', source: 'lance', interval: WEAPONS.lance.interval / RATE.capped, seconds: 3, hits: 31, amount: WEAPONS.lance.damage * DAMAGE, where: { visible: () => false } });
    // Every 50 ms on 24 bodies, for three beams back to back: far past the old 64 hits a shot.
    fire({ what: 'lance / beam on 24 bodies', source: 'lance', type: 'fire', interval: beam.tick, seconds: 3, hits: 24, amount: beam.dps * beam.tick * DAMAGE, shared: 100 });
    fire({ what: 'lance / beam at 380 m', source: 'lance', type: 'fire', interval: beam.tick, seconds: 1, amount: beam.dps * beam.tick, shared: 100,
      point: [0, 1.6, -400], where: { target: [0, 1, -380] } });
    fire({ what: 'lance / rail bursts and balls', source: 'lance', type: 'explosive', blastKind: 'plasmaBurst', interval: 0.1, seconds: 3, hits: 12, amount: 160 * DAMAGE });
    fire({ what: 'lance / giant ball', source: 'lance', type: 'explosive', blastKind: 'plasma', interval: 0.7, seconds: 3, hits: 40, amount: TUNING.lance.giant.damage * DAMAGE });
  });
  it('the Kiln: thirty globs a second licking a crowd, and napalm patches', () => {
    fire({ what: 'kiln / stream on 12 bodies', source: 'kiln', type: 'fire', interval: WEAPONS.kiln.interval / RATE.capped, seconds: 3, hits: 12, amount: WEAPONS.kiln.damage * DAMAGE });
  });
  it('rounds in flight: stakes, rockets, shells, grenades, flak, Hellfire rounds', () => {
    // A stake lands long after its shot, with another gun in hand by then: its own shot id (the guest's stale rule).
    fire({ what: 'stakegun / stakes landing', source: 'stakegun', interval: WEAPONS.stakegun.interval / RATE.capped, seconds: 3, amount: WEAPONS.stakegun.damage * DAMAGE, shared: 100 });
    for (const [source, kind] of [['rocket', 'rocket'], ['quiver', 'rocket'], ['grenade', 'grenade'], ['stakegun', 'grenade'], ['gimlet', 'grenade']] as const) {
      fire({ what: `${source} / splash on a crowd, round a corner`, source, type: 'explosive', blastKind: kind, interval: 0.1, seconds: 3, hits: 24, amount: 400 * DAMAGE, where: { visible: () => false } });
    }
    fire({ what: 'rocket / Hellfire rocket (instakill)', source: 'rocket', type: 'explosive', blastKind: 'hellfire', interval: 0.25, seconds: 3, hits: 24, amount: 99999 });
    fire({ what: 'autocannon / HE shell splash (instakill)', source: 'autocannon', type: 'explosive', blastKind: 'shell', interval: WEAPONS.autocannon.interval / RATE.capped, seconds: 3, hits: 24, amount: 99999 });
    fire({ what: 'autocannon / shell direct (instakill)', source: 'autocannon', interval: WEAPONS.autocannon.interval / RATE.capped, seconds: 3, amount: 99999 });
    fire({ what: 'autocannon / flak fragments', source: 'autocannon', type: 'pellet', interval: WEAPONS.autocannon.interval / RATE.capped, seconds: 3, hits: 40, amount: 60 * DAMAGE, shared: 100 });
    fire({ what: 'smg / Hellfire rounds', source: 'smg', type: 'explosive', blastKind: 'hellfireBullet', interval: cadence(WEAPONS.smg, RATE.capped) / 2, seconds: 3, hits: 6, amount: 200 });
    fire({ what: 'shock rounds / arcs', source: 'smg', type: 'shock', interval: cadence(WEAPONS.smg, RATE.capped) / 2, seconds: 3, hits: 4, amount: 40 });
  });
});

describe('claims matrix: melee', () => {
  for (const id of BLADES) {
    it(`${id}: swings as fast as it goes, on a crowd`, () => {
      // A swing's time shrinks by the square root of the fire rate, and by the energy blade's speed.
      const swing = WEAPONS[id].interval / Math.sqrt(RATE.uncapped) / ENERGY.speed;
      const type = id === 'sword' || id === 'knife' ? 'slash' : 'melee';
      fire({ what: `${id} / swings on 8 bodies`, source: id, type, interval: swing, seconds: 3, hits: 8, amount: WEAPONS[id].damage * DAMAGE * 3 });
    });
  }
  it('the katana: specials, the dash cut, the wave', () => {
    for (const special of ['flurry', 'dash', 'spin', 'plunge', 'lock']) {
      fire({ what: `sword / ${special}`, source: `sword_${special}`, type: 'slash', interval: 0.08, seconds: 2, hits: 6, amount: 600 });
    }
    fire({ what: 'sword / wave', source: 'sword_wave', type: 'slash', interval: 0.1, seconds: 2, hits: 8, amount: 400, where: { target: [0, 1, -32] }, point: [0, 1, -32] });
    fire({ what: 'sword / wave burst', source: 'sword_wave', type: 'explosive', blastKind: 'finisher', interval: 0.3, seconds: 2, hits: 8, amount: 400 });
  });
});

describe('claims matrix: call-ins, perks, the body, mounted guns', () => {
  it('call-ins', () => {
    fire({ what: 'airstrike / finale (instakill)', source: 'airstrike', type: 'explosive', blastKind: 'hellfire', interval: 0.05, seconds: 2, hits: 12, amount: 99999, called: true, where: { visible: () => false } });
    fire({ what: 'ac130 / bomb (instakill)', source: 'ac130_bomb', type: 'explosive', blastKind: 'finisher', interval: 2, shots: 3, hits: 48, amount: 99999, called: true });
    fire({ what: 'ac130 / 105, 40, 25 and flak, nine minutes in', source: 'ac130_flak', type: 'pellet', interval: 0.02, seconds: 3, hits: 6, amount: 400, called: true, where: { target: [0, 1, -900] }, point: [0, 1, -900] });
    fire({ what: 'black sun (instakill)', source: 'black_sun', type: 'explosive', blastKind: 'finisher', interval: 5, shots: 1, hits: 48, amount: 99999, called: true });
    fire({ what: 'nuke', source: 'nuke', type: 'true', interval: 5, shots: 1, hits: 48, amount: 999999, called: true });
    for (const source of ['warthog', 'chopper_cannon', 'chopper_rocket', 'door_gun', 'gunship_rocket', 'orbital', 'sentry', 'drop_pod', 'frame_rotary', 'frame_flak', 'frame_pod', 'frame_stomp', 'frame_charge']) {
      fire({ what: `${source}, with no call-in announced`, source, type: /rocket|pod|orbital|stomp|flak/.test(source) ? 'explosive' : 'bullet', interval: 0.02, seconds: 3, hits: 4, amount: 900 });
    }
  });
  it('perks and the body', () => {
    fire({ what: 'chain storm, with no call-in', source: 'chain_storm', type: 'shock', interval: 0.05, seconds: 3, hits: 6, amount: 300 });
    fire({ what: 'chain reaction, with no call-in', source: 'chain_reaction', type: 'explosive', interval: 0.1, seconds: 3, hits: 12, amount: 300 });
    fire({ what: 'skyfall', source: 'skyfall', type: 'explosive', interval: 0.5, seconds: 3, hits: 20, amount: 600 });
    fire({ what: 'ground slam', source: 'slam', type: 'crush', interval: 0.4, seconds: 3, hits: 12, amount: 300 });
    fire({ what: 'parried round', source: 'sword_deflect', interval: 0.05, seconds: 3, amount: 900 });
    fire({ what: 'barrel set off', source: 'barrel', type: 'explosive', blastKind: 'barrel', interval: 0.2, seconds: 3, hits: 12, amount: 400 });
  });
  it('mounted guns, every level', () => {
    for (const level of MOUNT_LEVELS) {
      fire({ what: `emplacement / ${level.name}`, source: 'emplacement', interval: 1 / level.roundsPerSecond, seconds: 3, hits: 3, amount: level.damage,
        where: { eye: [30, 1.6, 0] } });
    }
  });
});

afterAll(() => {
  const out = process.env.CLAIMS_MATRIX_OUT;
  if (out) fs.writeFileSync(out, JSON.stringify(table, null, 1));
});
