/**
 * Outpost Defense's radio (docs/notes/commander.md, "Outpost Defense"). The Commander is the one at the walls now, so he threatens, the
 * Council (the Office of Societal Compliance, the player's handler) says plainly what is coming and from where, and the player's own
 * men call things out on the squad feed in the bottom left.
 *
 *   Airwaves    one line on the box at a time. The Council's warnings queue and are never dropped; his threats give way when the
 *               channel is crowded or they have gone stale.
 *   SquadCalls  the allies' callouts on the comms feed, rate limited.
 *   DefenseRadio listens to what the director, the siege, the shops, the walls and the vehicles already do and already say, and
 *               turns it into the two. It touches nothing in the fight.
 *
 * Every line is text: none has a recording yet, so the box prints it and plays nothing (lines.ts, `voice-script.ts`).
 */
import * as THREE from 'three';
import type { Ally } from '../../allies/ally';
import type { Ctx, Structure, StructureStage } from '../../core/contracts';
import type { EnemyInstance } from '../../core/gameplay';
import type { Tone } from '../../enemies/commander/adaptations';
import { councilDefense, defenseLines, lineById, sidesWord, SIDE_WORDS, type DefenseEvent, type Line } from '../../enemies/commander/lines';
import type { CommsLine } from '../../enemies/outpost/events';
import { spoken, TYPE_RATE } from '../../ui/commander/pick';
import { RINGS, type RingId } from '../../world/map/fort/plan';
import { SHOP_ORDER, SHOPS, type ShopId } from './data';
import type { DefenseDirector } from './director';

/** Seconds a line stays up once typed, and the quiet between two. */
export const HOLD = 2.6;
const GAP = 0.5;
/** A threat of his still waiting after this long is old news, and goes. */
const STALE = 4;
/** Seconds between his lines. A wave starting may cut in. */
const COMMANDER_GAP = 13;
/** How often a threat comes with the warning, by event. The rest of the time the Council speaks alone. */
const THREAT: Readonly<Record<DefenseEvent, number>> = {
  open: 1, wave: 1, armour: 0.9, truck: 0.4, chopper: 0.9, juggernaut: 0.9, titan: 0.9, all: 1, mortar: 0.6, charge: 0.45, breach: 0.8,
  engineer: 0.4, shop: 0.6, lost: 0.9, repair: 0.7, losses: 1, long: 1, hire: 0.8, clear: 0.7, tankDown: 0.9, chopperDown: 0.9, playerDead: 1,
};
/** The owner's line goes first the first time a tank comes. */
const FIRST_OF: Partial<Record<DefenseEvent, string>> = { armour: 'cmd.def.armour.bitch' };
const TONES: readonly Tone[] = ['smug', 'irritated', 'rattled', 'cracked'];

const POLL = 0.25;
/** Men spawning further out than this came through the fence. */
const FENCE_LINE = 95;
/** After a wave's call, fresh men at the fence are reinforcements. They are gathered a few seconds, then named by side. */
const OPENING = 12;
const GATHER = 4;
const REINFORCE_GAP = 30;
const SHOP_GAP = 25;
const COVER_GAP = 40;
const BOMBER_GAP = 30;
const CHARGE_GAP = 12;
/** He mourns his men every this many. */
const LOSS_STEP = 12;
/** From this wave, every fourth wave he remarks on how long this has gone on. */
const LONG_FROM = 8;
const SOON = 10;

/** 0 north (-z), 1 east, 2 south, 3 west: the side of the fort a point is on. */
export const sideAt = (x: number, z: number): number => (Math.abs(z) >= Math.abs(x) ? (z < 0 ? 0 : 2) : x > 0 ? 1 : 3);

/** The ring a wall or gate belongs to: the one whose line it stands on. */
function ringOf(x: number, z: number): RingId {
  const d = Math.max(Math.abs(x), Math.abs(z));
  let best = RINGS[0]!;
  for (const r of RINGS) if (Math.abs(r.half - d) < Math.abs(best.half - d)) best = r;
  return best.id;
}

export const toneFor = (wave: number): Tone => TONES[Math.min(3, Math.floor(Math.max(0, wave - 1) / 5))]!;

/** Seconds a line is on the box: typed at the box's rate, then held. */
export const airtime = (text: string): number => text.length / TYPE_RATE + HOLD;

const textOf = (id: string, vars?: Readonly<Record<string, string>>): string => {
  const line = lineById(id);
  return line ? spoken(line, vars ?? {}, null).text : '';
};

// -------------------------------------------------------------------------------------------------
// The box: one speaker at a time
// -------------------------------------------------------------------------------------------------

interface Call {
  id: string;
  vars: Readonly<Record<string, string>> | undefined;
  /** The Council's warning. Never dropped. */
  warn: boolean;
  waited: number;
}

export class Airwaves {
  readonly queue: Call[] = [];
  private busy = 0;

  constructor(private readonly send: (id: string, vars: Readonly<Record<string, string>> | undefined, hold: number) => void) {}

  reset(): void {
    this.queue.length = 0;
    this.busy = 0;
  }

  /** A warning already waiting with the same words is not queued twice. */
  push(id: string, vars: Readonly<Record<string, string>> | undefined, warn: boolean): void {
    if (warn && this.queue.some(c => c.id === id && textOf(c.id, c.vars) === textOf(id, vars))) return;
    this.queue.push({ id, vars, warn, waited: 0 });
  }

  update(dt: number): void {
    this.busy -= dt;
    for (const c of this.queue) c.waited += dt;
    if (this.busy > 0) return;
    // His threats give way: one gone stale, or any while two warnings wait behind it.
    while (this.queue.length && !this.queue[0]!.warn && (this.queue[0]!.waited > STALE || this.queue.filter(c => c.warn).length >= 2)) this.queue.shift();
    const c = this.queue.shift();
    if (!c) return;
    this.busy = airtime(textOf(c.id, c.vars)) + GAP;
    this.send(c.id, c.vars, HOLD);
  }
}

// -------------------------------------------------------------------------------------------------
// The feed: the player's men
// -------------------------------------------------------------------------------------------------

export type SquadCall = 'breach' | 'gate' | 'contact' | 'charge' | 'tank' | 'chopper' | 'incoming' | 'manDown' | 'dead' | 'reload' | 'shop' | 'lost' | 'clear';

/** `{side}`, `{ring}`, `{shop}` and `{label}` are filled; a capital in the slot gives the word a capital. */
const SQUAD: Readonly<Record<SquadCall, readonly string[]>> = {
  breach: ['Breach! {Ring} wall, {side} side!', 'They\'re through the {ring} wall! {Side} side!', '{Side} wall\'s down! They\'re coming in!'],
  gate: ['{Side} gate\'s blown!', 'They took the {ring} gate! {Side} side!'],
  contact: ['Contact {side}! Through the fence!', 'Movement on the {side} fence!', 'Eyes on, {side} side! Here they come!'],
  charge: ['Charge on the {side} wall! Get clear!', 'They\'ve set a charge, {side} side!'],
  tank: ['Tank! {Side} road!', 'Armour, {side} side! Get a rocket on it!'],
  chopper: ['Helo inbound!', 'Chopper! Heads down!'],
  incoming: ['Incoming!', 'Mortars! Get down!', 'Shells! Off the wall!'],
  manDown: ['Man down!', '{Label}\'s hit!', 'I need a medic up here!'],
  dead: ['We lost one!', '{Label}\'s gone!'],
  reload: ['Reloading!', 'Changing mags!', 'Cover me, I\'m reloading!'],
  shop: ['They\'re hitting the {shop}!', 'Enemy at the {shop}!'],
  lost: ['{Shop}\'s gone! We lost it!', 'We lost the {shop}!'],
  clear: ['That\'s the last of them.', 'Clear! We held!', 'Check your ammo. They\'ll be back.'],
};

/** Seconds before the same call again (per key, so contact is per side). */
const SQUAD_GAP: Partial<Record<SquadCall, number>> = {
  contact: 20, reload: 14, incoming: 20, chopper: 30, shop: 20, tank: 15, charge: 6, clear: 30, manDown: 3, dead: 3, lost: 5, breach: 4, gate: 4,
};
/** Spacing between any two, so the feed stays readable. A breach, a man down or a machine cuts in. */
const SQUAD_ANY = 2;
const SQUAD_URGENT: ReadonlySet<SquadCall> = new Set<SquadCall>(['breach', 'gate', 'manDown', 'dead', 'lost', 'tank', 'chopper']);

const fill = (text: string, words: Readonly<Record<string, string>>): string =>
  text.replace(/\{(\w+)\}/g, (_, k: string) => {
    const w = words[k.toLowerCase()] ?? '';
    return k[0] === k[0]!.toUpperCase() ? w.charAt(0).toUpperCase() + w.slice(1) : w;
  });

export class SquadCalls {
  private nextAt = 0;
  private readonly at = new Map<string, number>();
  private readonly last = new Map<SquadCall, number>();
  private readonly line: CommsLine = { kind: 'ally', text: '', squad: 'Garrison', speaker: null, enemy: null, position: new THREE.Vector3() };

  constructor(private readonly ctx: Ctx, private readonly roll: () => number) {}

  reset(): void {
    this.nextAt = 0;
    this.at.clear();
  }

  /** A man still standing says it: the nearest to `near`, or anyone. False when nobody can, or it is too soon. */
  call(kind: SquadCall, now: number, near: THREE.Vector3 | null, words: Readonly<Record<string, string>> = {}, key: string = kind): boolean {
    if (now < (this.at.get(key) ?? 0)) return false;
    if (now < this.nextAt && !SQUAD_URGENT.has(kind)) return false;
    const who = this.speaker(near);
    if (!who) return false;
    this.at.set(key, now + (SQUAD_GAP[kind] ?? 6));
    this.nextAt = now + SQUAD_ANY;
    const lines = SQUAD[kind];
    const prev = this.last.get(kind) ?? -1;
    const i = lines.length < 2 ? 0 : (prev + 1 + Math.floor(this.roll() * (lines.length - 1))) % lines.length;
    this.last.set(kind, i);
    const { line } = this;
    line.text = fill(lines[i]!, { label: who.def.label, ...words });
    line.speaker = who.def.label;
    line.position.copy(who.center);
    this.ctx.events.emit('comms:line', line);
    return true;
  }

  private speaker(near: THREE.Vector3 | null): Ally | null {
    let best: Ally | null = null;
    let bestD = Infinity;
    for (const a of this.ctx.allies?.allies ?? []) {
      if (a.state !== 'up') continue;
      const d = near ? a.center.distanceToSquared(near) : this.roll();
      if (d < bestD) {
        bestD = d;
        best = a;
      }
    }
    return best;
  }
}

// -------------------------------------------------------------------------------------------------
// What happens, and who says what about it
// -------------------------------------------------------------------------------------------------

/** What this reads off the director. `fronts` is the wave's sides, read only if the director has it. */
type DirectorView = Pick<DefenseDirector, 'wave' | 'phase' | 'nextWaveIn' | 'plan' | 'siege'> & { readonly fronts?: readonly number[] };

interface VehicleView {
  readonly def: { readonly kind: string };
  readonly position: THREE.Vector3;
}

const STAGE_RANK: Record<StructureStage, number> = { intact: 0, damaged: 1, breached: 2 };

export class DefenseRadio {
  readonly air: Airwaves;
  readonly squad: SquadCalls;
  private now = 0;
  private pollAt = 0;
  private lastCmd = -99;
  private readonly said = new Set<string>();
  private readonly seen = new WeakSet<object>();
  private readonly reloads = new WeakMap<Ally, number>();
  private watching = false;
  private deployed = false;
  private allies = 0;
  private waveAt = -99;
  private kills = 0;
  private soonFor = -1;
  private salvos = 0;
  private coverAt = -99;
  private bomberAt = -99;
  private readonly chargeAt = new Map<string, number>();
  private readonly health = {} as Record<ShopId, number>;
  private readonly shopAt = {} as Record<ShopId, number>;
  private readonly fresh = new Set<number>();
  private gatherUntil = 0;
  private reinforceAt = 0;

  constructor(private readonly ctx: Ctx, private readonly roll: () => number = Math.random) {
    this.air = new Airwaves((id, vars, hold) => ctx.events.emit('commander:bark', { id, vars, hold }));
    this.squad = new SquadCalls(ctx, roll);
  }

  init(): void {
    const { events } = this.ctx;
    events.on('wave:start', e => this.onWave(e.wave));
    events.on('wave:clear', () => this.onClear());
    events.on('enemy:spawned', e => this.onSpawn(e.enemy));
    events.on('enemy:killed', () => {
      if (this.director?.phase === 'intermission') return;
      if (++this.kills % LOSS_STEP === 0) this.threat('losses');
    });
    events.on('vehicle:destroyed', e => {
      if (e.kind === 'tank') this.pair('tankDown', 'tankDown');
      else if (e.kind === 'chopper') this.pair('chopperDown', 'chopperDown');
    });
    events.on('ally:down', e => this.squad.call('manDown', this.now, e.ally.center, { label: e.ally.def.label }));
    events.on('ally:dead', e => this.squad.call('dead', this.now, e.ally.center, { label: e.ally.def.label }));
    events.on('player:died', () => this.threat('playerDead', true));
  }

  reset(): void {
    this.air.reset();
    this.squad.reset();
    this.now = this.pollAt = 0;
    this.lastCmd = this.waveAt = this.coverAt = this.bomberAt = -99;
    this.said.clear();
    this.deployed = false;
    this.kills = this.salvos = 0;
    this.soonFor = -1;
    this.chargeAt.clear();
    this.fresh.clear();
    this.gatherUntil = this.reinforceAt = 0;
    for (const id of SHOP_ORDER) {
      this.health[id] = SHOPS[id].health;
      this.shopAt[id] = 0;
    }
  }

  update(): void {
    this.now += this.ctx.time.realDt;
    this.air.update(this.ctx.time.realDt);
    if (this.now < this.pollAt) return;
    this.pollAt = this.now + POLL;
    this.watchWalls();
    this.poll();
  }

  private get director(): DirectorView | null {
    const w = this.ctx.waves as unknown as Partial<DirectorView> | undefined;
    return w && 'siege' in w ? (w as DirectorView) : null;
  }

  // ---- saying it ------------------------------------------------------------------------------------------------

  /** His line first, if he is due one, then the Council's. */
  private pair(ev: DefenseEvent, key: string, vars?: Record<string, string>, force = false): void {
    this.threat(ev, force);
    this.warn(key, vars);
  }

  private threat(ev: DefenseEvent, force = false): void {
    if (!force && (this.now - this.lastCmd < COMMANDER_GAP || this.roll() > THREAT[ev])) return;
    const line = this.pick(ev);
    if (!line) return;
    this.lastCmd = this.now;
    this.air.push(line.id, undefined, false);
  }

  private warn(key: string, vars?: Record<string, string>): void {
    const list = councilDefense(key);
    if (list.length) this.air.push(list[Math.floor(this.roll() * list.length)]!.id, vars, true);
  }

  /** A line he has not said this run, as close to his mood as there is. He gets worse as the waves go on. */
  private pick(ev: DefenseEvent): Line | null {
    const all = defenseLines(ev);
    let left = all.filter(l => !this.said.has(l.id));
    if (!left.length) {
      for (const l of all) this.said.delete(l.id);
      left = all;
    }
    const first = FIRST_OF[ev];
    let line = first ? left.find(l => l.id === first) : undefined;
    if (!line) {
      const mood = TONES.indexOf(toneFor(this.director?.wave ?? 1));
      const off = (l: Line): number => Math.abs(TONES.indexOf(l.emotion as Tone) - mood);
      const best = Math.min(...left.map(off));
      const pool = left.filter(l => off(l) === best);
      line = pool[Math.floor(this.roll() * pool.length)];
    }
    if (line) this.said.add(line.id);
    return line ?? null;
  }

  // ---- events ---------------------------------------------------------------------------------------------------

  private onWave(wave: number): void {
    const d = this.director;
    this.waveAt = this.now;
    this.kills = 0;
    this.fresh.clear();
    this.gatherUntil = 0;
    this.reinforceAt = this.now + OPENING;
    const boss = d?.plan?.wave === wave ? d.plan.boss : null;
    const dir = sidesWord(d?.fronts ?? []);
    const vars = { n: String(wave), dir: dir || 'fence' };
    const ev: DefenseEvent = boss === 'tanks' ? 'armour' : boss === 'choppers' ? 'chopper' : boss ?? (wave >= LONG_FROM && wave % 4 === 0 ? 'long' : 'wave');
    // A new wave is worth his breath even if he spoke a moment ago.
    this.pair(ev, boss ? `boss.${boss}` : 'wave', vars, true);
  }

  private onClear(): void {
    this.pair('clear', 'clear');
    this.squad.call('clear', this.now, null);
  }

  private onSpawn(e: EnemyInstance): void {
    const p = e.position;
    const side = sideAt(p.x, p.z);
    const dir = SIDE_WORDS[side]!;
    if (e.id === 'juggernaut' || e.id === 'titan') {
      this.pair(e.id, e.id, { dir });
      return;
    }
    if (e.id === 'bomber') {
      if (this.now < this.bomberAt) return;
      this.bomberAt = this.now + BOMBER_GAP;
      this.warn('bombers', { dir });
      return;
    }
    if (Math.max(Math.abs(p.x), Math.abs(p.z)) < FENCE_LINE) return;
    this.squad.call('contact', this.now, p, { side: dir }, `contact:${side}`);
    if (this.now < this.waveAt + OPENING) return;
    this.fresh.add(side);
    if (!this.gatherUntil) this.gatherUntil = this.now + GATHER;
  }

  // ---- what is only seen, not said ------------------------------------------------------------------------------

  /** Breaches and repairs, from the walls themselves. Subscribed once: the pieces live as long as the map. */
  private watchWalls(): void {
    const pieces = this.ctx.world.objects.structures;
    if (this.watching || !pieces?.length) return;
    this.watching = true;
    for (const piece of pieces) {
      if (piece.kind === 'shack') continue;
      piece.onStageChange((stage, from) => this.onStage(piece, stage, from));
    }
  }

  private onStage(piece: Structure, stage: StructureStage, from: StructureStage): void {
    // A new run puts every wall back before the loadout is picked: that is not the player repairing anything.
    if (!this.deployed) return;
    if (STAGE_RANK[stage] < STAGE_RANK[from]) {
      this.threat('repair');
      return;
    }
    if (stage !== 'breached') return;
    const spec = (piece as Structure & { spec?: { x: number; z: number } }).spec;
    if (!spec) return;
    const ring = ringOf(spec.x, spec.z);
    const side = SIDE_WORDS[sideAt(spec.x, spec.z)]!;
    const gate = piece.kind === 'gate';
    this.pair('breach', `${gate ? 'gate' : 'breach'}.${ring}`, { dir: side });
    this.squad.call(gate ? 'gate' : 'breach', this.now, new THREE.Vector3(spec.x, 0, spec.z), { side, ring });
  }

  private poll(): void {
    const defense = this.ctx.contracts.defense;
    if (!defense) return;
    if (!this.deployed) {
      if (defense.needLoadout) return;
      // Deploy: the garrison is already up, so only a man bought after this is a hire.
      this.deployed = true;
      this.allies = this.ctx.allies?.allies.length ?? 0;
      this.warn('open');
      this.threat('open', true);
    }
    this.hires();
    this.shops(defense.shops);
    this.reloading();
    const d = this.director;
    if (!d) return;
    if (d.phase === 'intermission') {
      if (this.soonFor !== d.wave && d.nextWaveIn <= SOON && d.nextWaveIn > SOON - 2) {
        this.soonFor = d.wave;
        this.warn('soon');
      }
      return;
    }
    this.siege(d);
    this.vehicles();
    if (this.gatherUntil && this.now >= this.gatherUntil) {
      if (this.now >= this.reinforceAt) {
        this.reinforceAt = this.now + REINFORCE_GAP;
        this.warn('reinforce', { dir: sidesWord(this.fresh) });
      }
      this.fresh.clear();
      this.gatherUntil = 0;
    }
  }

  private hires(): void {
    const n = this.ctx.allies?.allies.length ?? 0;
    if (n > this.allies) this.threat('hire');
    this.allies = n;
  }

  private shops(shops: Readonly<Record<ShopId, { health: number; readonly lost: boolean }>>): void {
    for (const id of SHOP_ORDER) {
      const s = shops[id];
      const was = this.health[id];
      this.health[id] = s.health;
      if (s.health >= was) continue;
      const name = SHOPS[id].name;
      if (s.lost) {
        this.pair('lost', `lost.${id}`);
        this.squad.call('lost', this.now, null, { shop: name });
      } else if (this.now >= this.shopAt[id]) {
        this.shopAt[id] = this.now + SHOP_GAP;
        this.pair('shop', `shop.${id}`);
        this.squad.call('shop', this.now, null, { shop: name }, `shop:${id}`);
      }
    }
  }

  private reloading(): void {
    for (const a of this.ctx.allies?.allies ?? []) {
      if (a.reloadUntil === (this.reloads.get(a) ?? 0)) continue;
      this.reloads.set(a, a.reloadUntil);
      if (a.state === 'up' && this.roll() < 0.35) this.squad.call('reload', this.now, a.center);
    }
  }

  private siege(d: DirectorView): void {
    const s = d.siege;
    for (const x of s.satchels) {
      if (this.seen.has(x)) continue;
      this.seen.add(x);
      const ring = ringOf(x.piece.spec.x, x.piece.spec.z);
      const side = sideAt(x.at.x, x.at.z);
      const key = `${ring}:${side}`;
      if (this.now < (this.chargeAt.get(key) ?? 0)) continue;
      this.chargeAt.set(key, this.now + CHARGE_GAP);
      this.pair('charge', `charge.${ring}`, { dir: SIDE_WORDS[side]! });
      this.squad.call('charge', this.now, x.at, { side: SIDE_WORDS[side]! });
    }
    for (const t of s.teams) {
      if (!t.live || !t.tube || this.seen.has(t)) continue;
      this.seen.add(t);
      this.pair('mortar', 'mortar', { dir: SIDE_WORDS[sideAt(t.pos.x, t.pos.z)]! });
    }
    if (s.counts.salvos > this.salvos) this.squad.call('incoming', this.now, null);
    this.salvos = s.counts.salvos;
    for (const p of s.pads) {
      if (this.seen.has(p)) continue;
      this.seen.add(p);
      this.pair('engineer', 'pad', { dir: SIDE_WORDS[sideAt(p.piece.spec.x, p.piece.spec.z)]! });
    }
    for (const c of s.covers) {
      if (this.seen.has(c)) continue;
      this.seen.add(c);
      if (this.now < this.coverAt) continue;
      this.coverAt = this.now + COVER_GAP;
      this.pair('engineer', 'cover', { dir: SIDE_WORDS[sideAt(c.at.x, c.at.z)]! });
    }
  }

  private vehicles(): void {
    const live = (this.ctx.enemies as unknown as { vehicles?: { live: readonly VehicleView[] } | null }).vehicles?.live ?? [];
    for (const v of live) {
      if (this.seen.has(v)) continue;
      this.seen.add(v);
      const dir = SIDE_WORDS[sideAt(v.position.x, v.position.z)]!;
      switch (v.def.kind) {
        case 'tank':
          this.pair('armour', 'tank', { dir });
          this.squad.call('tank', this.now, v.position, { side: dir });
          break;
        case 'truck':
          this.pair('truck', 'truck', { dir });
          break;
        case 'humvee':
          this.pair('truck', 'humvee', { dir });
          break;
        case 'chopper':
          this.pair('chopper', 'chopper', { dir });
          this.squad.call('chopper', this.now, null);
          break;
        default:
          break;
      }
    }
  }
}
