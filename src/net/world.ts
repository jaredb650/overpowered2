import * as THREE from 'three';
import { CG, type Ctx, type DamageInfo, type PlayerDamage, type PlayerSystem } from '../core/contracts';
import type { DamageResult, EnemyInstance, ExplosionSpec, ShotSpec, WeaponId } from '../core/gameplay';
import type { Enemy } from '../enemies/Enemy';
import type { EnemyManager } from '../enemies/EnemyManager';
import type { PlayerSense } from '../enemies/aiWorld';
import type { Foe } from '../enemies/outpost/soldier';
import { soldierOf } from '../enemies/outpost/soldier';
import { RULES } from '../enemies/outpost/chatter/lines';
import { NAME_LIST, speakerTag } from '../enemies/outpost/chatter/names';
import { lineText } from '../enemies/outpost/chatter/rules';
import { VOICE_COUNT } from '../enemies/outpost/chatter/voices';
import type { CommsLine } from '../enemies/outpost/events';
import { RANKS, type Rank } from '../enemies/outpost/rank';
import { HELMET } from '../enemies/wounds/armour';
import { Route, RouteFinder, type NavGrid } from '../enemies/outpost/routes';
import { closestSegmentPoints } from '../weapons/geometry';
import { EXPLOSIONS, WEAPONS } from '../weapons/data';
import type { KillEvent } from '../core/gameplay';
import type { ExplosionKind } from '../core/contracts';
import { ClaimValidator, claimKind, selectTarget } from './authority';
import { isMelee } from '../weapons/melee/data';
import { Team, TeamLife } from './team';
import { CoopMission } from './mission';
import { CAPTURABLE, decodeWorld, encodeWorld, ENEMY_IDS, packDamage, POSTURES, REGIONS, SNAPSHOT_MS, validVec, type EnemyFrame, type PostureId, type Vec, type WireDamage, type WorldEvent, type WorldFrame } from './worldProtocol';
import type { GroundModel } from '../enemies/vehicles/models';
import type { Vehicle } from '../enemies/vehicles/vehicle';
import { ALLY_TYPES, type AllyType } from '../allies/data';
import type { CharacterInstance } from '../core/contracts';
import type { DroppedGuns } from '../weapons/dropped';

const ALLY_KINDS = Object.keys(ALLY_TYPES) as AllyType[];
/** Garrison tracers mirrored per second, at most. */
const ASHOTS_PER_SECOND = 30;
import type { CoopSession } from './index';

interface Replica { enemy: Enemy; from: EnemyFrame; to: EnemyFrame; at: number }
const RANK_IDS = Object.keys(RANKS) as Rank[];
const nameId = (id: unknown): number => typeof id === 'number' && Number.isInteger(id) && NAME_LIST[id] !== undefined ? id : -1;
interface PlayerTarget { id: string; player: PlayerSystem; life: TeamLife; foe: Foe }
/** Slow-mo every player shares: the host's world slows, so it slows on every screen. Everything else (hit-stop, the fan) is dropped. */
const SHARED_SLOW = /^(slowmo|timeWarp|bossDeath|coop:)/;
/** Explosions mirrored to other screens per second, at most: an AC-130 or a rotary of explosive rounds stays affordable. */
const BOOMS_PER_SECOND = 24;

/** The posture a man is held in by his animator (postures.ts), as the snapshot carries it. */
function postureOf(enemy: Enemy): PostureId {
  const name = (enemy.char.anim as unknown as { posture?: { name?: string } }).posture?.name;
  return (POSTURES as readonly string[]).includes(name ?? '') ? name as PostureId : 'stand';
}
/** A man who has given up and can still be cuffed. */
function capturable(enemy: Enemy): boolean {
  const s = soldierOf(enemy);
  return !!s && s.surrendered && !s.released && !s.collared && !s.cuffed && s.fate === 'surrender';
}

export class CoopWorld {
  readonly stats = { snapshotBytes: 0, eventBytes: 0, snapshotPackets: 0, eventPackets: 0, accepted: 0, rejected: 0, since: performance.now() };
  readonly team: Team;
  readonly mission: CoopMission;
  readonly validator = new ClaimValidator();
  /** Host: who killed each enemy that died lately (lobby id), for kill pay and score (`notMine`). */
  private readonly killedBy = new Map<number, { id: string; at: number }>();
  /** Host: the last player to land a claim on each enemy, for a kill by bleeding or fire after the hit. */
  private readonly lastHitter = new Map<number, string>();
  /** Host: the guest whose claim is being applied right now. */
  private applying: string | null = null;
  private booms = 0;
  private boomSecond = 0;
  /** Host: slow-mo a guest's perk asked for, by request id, until when. */
  private readonly slows = new Map<string, number>();
  /** Host: who cuffed each prisoner (lobby id), so the bounty reaches them. */
  private readonly captors = new Map<number, string>();
  /** Guest: seconds E has been held on a surrendered man, and the prompt over him. */
  private captureHeld = -1;
  private capturePrompt: { uid: number; off: () => void } | null = null;
  /** Host: an id for each vehicle; guest: the drawn copies. */
  private readonly vehicleIds = new WeakMap<Vehicle, number>();
  private vehicleSerial = 0;
  private nextVehicles = 0;
  private readonly puppets = new Map<number, { model: GroundModel; from: THREE.Vector3; to: THREE.Vector3; q: THREE.Quaternion; turret: number; at: number; kind: string }>();
  private readonly replicas = new Map<number, Replica>();
  private readonly dead = new Set<number>();
  private readonly selections = new Map<number, string>();
  private readonly sight = new Map<number, { target: string; at: number; visible: boolean }>();
  private readonly adapters = new Map<string, PlayerTarget>();
  private readonly finder = new RouteFinder();
  private readonly routes = new Map<number, { route: Route; at: number; target: THREE.Vector3 }>();
  private searchFrame = -1;
  private ready = false;
  private pendingSnapshot: ArrayBuffer | null = null;
  private readonly off: (() => void)[] = [];
  private readonly sendSnapshot: (data: ArrayBuffer) => number;
  private readonly sendAction: (data: WorldEvent, to?: string) => number;
  private nextSnapshot = 0;
  private seq = 0;
  private receivedSeq: number | null = null;
  private shot = 0;
  private firedAt = -Infinity;
  private weapon = '';
  private delayed: { at: number; run: () => void }[] = [];
  private readonly heard: CommsLine = { kind: 'contact', text: '', squad: '', speaker: null, enemy: null, position: new THREE.Vector3(), row: -1, name: -1, dead: -1 };
  targetPlayer: PlayerSystem | null = null;
  receivingDamage = false;

  constructor(private readonly ctx: Ctx, private readonly session: CoopSession) {
    this.sendSnapshot = session.lobby.gameplay<ArrayBuffer>('world', data => this.receiveSnapshot(data));
    this.sendAction = session.lobby.gameplay<WorldEvent>('action', (data, from) => this.receive(data, from));
    this.team = new Team(ctx, session, (event, to) => this.broadcast(event, to));
    // A mission's rides are everyone's: each guest's door gun counts through the host as a call-in.
    this.team.onArrived = id => { this.mission.catchUp(id); this.guns?.catchUp(id); };
    this.mission = new CoopMission(ctx, session, (event, to) => this.broadcast(event, to), this.team,
      () => { for (const p of session.lobby.players) if (!p.host) this.validator.callIn(p.id, performance.now()); });
    this.off.push(ctx.events.on('weapon:fired', event => this.fire(event.weapon, event.origin, event.dir)));
    this.off.push(ctx.events.on('callin:used', event => this.broadcast({ t: 'callin', id: event.id, slot: session.lobby.me?.slot })));
    // Sonar is shared; Thermal and Focus are each player's own and never sent.
    // A guest's Gun Kata: the host lets its burst through the fire-rate check (authority.ts `kata`).
    if (!session.hosting) this.off.push(ctx.events.on('chip:kata', () => this.broadcast({ t: 'kata' })));
    this.off.push(ctx.events.on('sonar:ping', event => this.broadcast({ t: 'sonar', at: event.origin.toArray() as Vec, slot: session.lobby.me?.slot })));
    if (!session.hosting) {
      this.off.push(ctx.events.on('perk:start', e => { if (e.id === 'slowmo' || e.id === 'timeWarp') this.broadcast({ t: 'slow', id: e.id, on: true }); }));
      this.off.push(ctx.events.on('perk:end', e => { if (e.id === 'slowmo' || e.id === 'timeWarp') this.broadcast({ t: 'slow', id: e.id, on: false }); }));
    }
    if (session.hosting) {
      // Registered before any system's own listener (systems listen in init, after this): who killed it is known first.
      this.off.push(ctx.events.on('enemy:killed', event => {
        const id = this.applying ?? (Object.hasOwn(WEAPONS, event.damage.source) || /^(grenade|sword)/.test(event.damage.source) ? session.lobby.you
          : this.lastHitter.get(event.enemy.uid) ?? session.lobby.you);
        this.killedBy.set(event.enemy.uid, { id, at: performance.now() });
      }));
      this.off.push(ctx.events.on('enemy:hit', event => this.broadcast({ t: 'hitfx', uid: event.enemy.uid, damage: packDamage(event.damage),
        health: event.enemy.health, armor: event.enemy.armor, blocked: event.result.blocked })));
      this.off.push(ctx.events.on('enemy:killed', event => {
        const by = this.session.lobby.players.find(p => p.id === this.killedBy.get(event.enemy.uid)?.id)?.slot ?? -1;
        this.broadcast({ t: 'kill', uid: event.enemy.uid, id: event.enemy.id, at: event.enemy.position.toArray() as Vec, yaw: event.enemy.yaw,
          damage: packDamage(event.damage), gib: event.gibbed, by, head: event.headshot });
      }));
      this.off.push(ctx.events.on('enemy:severed', event => this.broadcast({ t: 'sever', uid: event.enemy.uid, region: event.region, damage: packDamage(event.damage) })));
      // Every player hears the same man say the same words. Lines a caller wrote by hand stay the host's.
      this.off.push(ctx.events.on('comms:line', line => {
        if (line.row === undefined || line.row < 0) return;
        const rank = line.enemy ? soldierOf(line.enemy)?.rank : undefined;
        this.broadcast({ t: 'chatter', uid: line.enemy?.uid ?? 0, line: line.row, name: line.name ?? -1, dead: line.dead ?? -1,
          rank: rank ? RANK_IDS.indexOf(rank) : -1, squad: line.squad, voice: line.voice ?? -1, ...(line.slots ? { slots: line.slots } : {}) });
      }));
      this.off.push(ctx.events.on('comms:cut', cut => this.broadcast({ t: 'chatcut', uid: cut.enemy.uid, at: cut.at, radio: cut.radio })));
      // A guest's prisoner: the host's purse was paid by the drone, so the bounty goes on to the guest who cuffed him.
      this.off.push(ctx.events.on('prisoner:secured', e => {
        const captor = this.captors.get(e.enemy.uid);
        this.captors.delete(e.enemy.uid);
        if (!captor || captor === session.lobby.you || !(e.bounty > 0)) return;
        const wallet = ctx.contracts?.wallet as { credits?: number; earned?: number } | null | undefined;
        if (wallet && typeof wallet.credits === 'number') { wallet.credits -= e.bounty; if (typeof wallet.earned === 'number') wallet.earned -= e.bounty; }
        this.broadcast({ t: 'credit', amount: e.bounty, why: 'PRISONER BOUNTY' }, captor);
      }));
    }
  }

  private get manager(): EnemyManager { return this.ctx.enemies as EnemyManager; }

  /**
   * Not this player's: a kill (by uid) or a hit landed by a teammate. Score, combo, perks, kill pay and the run report skip it,
   * so each player's own browser pays and scores only what they did. Solo and guests' own replays read false.
   */
  notMine(enemy?: { uid: number }): boolean {
    if (this.applying !== null) return true;
    const killer = enemy ? this.killedBy.get(enemy.uid)?.id : undefined;
    return killer !== undefined && killer !== this.session.lobby.you;
  }

  /** Before the clock ticks: the host keeps the slow-mo everyone shares, a guest keeps none (its world is the host's). */
  clock(): void {
    const time = this.ctx.time;
    if (!this.session.hosting) return time.clearScales();
    const now = performance.now();
    for (const [id, until] of this.slows) if (now >= until) { time.popScale(id); this.slows.delete(id); }
    time.keepScales(id => SHARED_SLOW.test(id));
  }
  begin(): void {
    this.ready = true;
    this.mission.begin();
    if (this.pendingSnapshot) this.receiveSnapshot(this.pendingSnapshot);
    this.pendingSnapshot = null;
  }
  private life(id: string): TeamLife { return this.team.life(id); }
  private broadcast(event: WorldEvent, to?: string): void {
    const recipients = this.sendAction(event, to);
    this.stats.eventBytes += new TextEncoder().encode(JSON.stringify({ match: this.session.match.id, data: event })).byteLength * recipients;
    this.stats.eventPackets += recipients;
  }
  private unpack(damage: WireDamage): DamageInfo {
    return { ...damage, point: new THREE.Vector3(...damage.point), dir: new THREE.Vector3(...damage.dir),
      slicePlaneNormal: damage.slicePlaneNormal ? new THREE.Vector3(...damage.slicePlaneNormal) : undefined };
  }
  private fire(weapon: WeaponId, origin: THREE.Vector3, dir: THREE.Vector3): void {
    if (!this.ctx.player.alive) return;
    const now = performance.now();
    if (now - this.firedAt < 20 && weapon === this.weapon) return;
    this.shot++;
    this.firedAt = now;
    this.weapon = weapon;
    this.broadcast({ t: 'fire', shot: this.shot, weapon, origin: origin.toArray() as Vec, dir: dir.toArray() as Vec,
      slot: this.session.lobby.me?.slot, ...(this.ctx.weapons.akimbo ? { ak: 1 as const } : {}) });
  }
  claim(enemy: EnemyInstance, damage: DamageInfo): DamageResult {
    if (ENEMY_IDS.some(id => id === damage.source) || ['bleed', 'hazard', 'trample', 'coop'].includes(damage.source)) {
      return { dealt: 0, blocked: false, killed: false, headshot: false, severed: [] };
    }
    const weapon = this.ctx.weapons.current;
    // Only a gun's hit needs the shot it came from; a blast or a call-in's damage never draws a phantom tracer.
    if (claimKind(damage.source, damage.type) === 'shot'
      && (performance.now() - this.firedAt > Math.max(100, WEAPONS[weapon].interval * 1000) || this.weapon !== weapon)) this.fire(weapon, this.ctx.player.eye, this.ctx.player.forward);
    this.broadcast({ t: 'hit', shot: this.shot, target: enemy.uid, weapon, origin: this.ctx.player.eye.toArray() as Vec, damage: packDamage(damage) });
    const body = enemy as Enemy;
    const region = damage.region ?? 'chest';
    const facing = Math.sin(enemy.yaw) * damage.dir.x + Math.cos(enemy.yaw) * damage.dir.z;
    const shield = body.shield && facing <= -0.35 && !['armR', 'forearmR', 'shinL', 'shinR'].includes(region);
    const plate = body.plates.find(plate => plate.hp > 0 && plate.spec.regions.includes(region)
      && (!plate.spec.facing || (facing > 0) === (plate.spec.facing === 'back')));
    const flags = this.replicas.get(enemy.uid)?.to.flags ?? 0;
    const armoured = !!plate || shield || (flags & 96) !== 0;
    const blocked = (flags & 96) !== 0 || (shield && !damage.armorPiercing)
      || (!!plate && !damage.pierces && !damage.armorPiercing && damage.load !== 'ap');
    return { dealt: blocked ? 0 : damage.amount, blocked, killed: false, headshot: damage.region === 'head', severed: [], armour: armoured ? blocked ? 'stopped' : 'through' : undefined };
  }
  private receive(value: WorldEvent, from: string): void {
    if (!this.ready || !value || typeof value !== 'object' || typeof value.t !== 'string') return;
    try { this.handle(value, from); }
    catch (error) { console.warn('[coop] Dropped an event that could not be applied', value.t, error); }
  }

  private handle(value: WorldEvent, from: string): void {
    const now = performance.now();
    if (this.team.receive(value, from)) return;
    if (value.t === 'gun') return this.gunIn(value, from);
    if (value.t === 'boom') return this.boomIn(value, from);
    if (value.t === 'callin') {
      const player = this.session.hosting ? this.session.lobby.players.find(p => p.id === from) : this.session.lobby.players.find(p => p.slot === value.slot);
      const name = typeof value.id === 'string' ? value.id.replace(/[^a-zA-Z]/g, '').replace(/([A-Z])/g, ' $1').toUpperCase().slice(0, 24) : '';
      if (player && name) this.ctx.hud.feed(`${player.name} called in ${name}`, '#ffc14a');
      if (this.session.hosting && player) {
        this.validator.callIn(from, now);
        for (const peer of this.session.lobby.players) if (!peer.host && peer.id !== from) this.broadcast({ ...value, slot: player.slot }, peer.id);
      }
      return;
    }
    if (value.t === 'sonar') {
      const player = this.session.hosting ? this.session.lobby.players.find(p => p.id === from) : this.session.lobby.players.find(p => p.slot === value.slot);
      if (!player || player.id === this.session.lobby.you || !validVec(value.at)) return;
      this.ctx.hud.feed(`${player.name} used sonar`, '#39e0ff');
      this.ctx.contracts?.sonar.share?.(new THREE.Vector3(...value.at));
      if (this.session.hosting) for (const peer of this.session.lobby.players) if (!peer.host && peer.id !== from) this.broadcast({ ...value, slot: player.slot }, peer.id);
      return;
    }
    if (this.session.hosting) {
      if (value.t === 'slow' && (value.id === 'slowmo' || value.id === 'timeWarp')) {
        const id = `coop:${from}:${value.id}`;
        if (value.on) { this.ctx.time.pushScale(id, 0.25, 0.18, 0.4); this.slows.set(id, now + 8000); }
        else { this.ctx.time.popScale(id); this.slows.delete(id); }
        return;
      }
      const remote = this.session.remotes.get(from);
      if (!remote || !remote.buffer.sample(now)) return;
      if (value.t === 'capture') return this.captureFor(from, remote.char.root.position, value.uid);
      if (value.t === 'kata') { this.validator.kata(from, now); return; }
      const eye = remote.char.root.position.clone().add(new THREE.Vector3(0, 1.6, 0));
      if (value.t === 'fire' && validVec(value.origin) && validVec(value.dir) && new THREE.Vector3(...value.origin).distanceTo(eye) < 7
        && !this.life(from).down && this.validator.acceptFire(from, value.shot, value.weapon, now, value.ak === 1)) {
        const event = { ...value, slot: remote.player.slot };
        this.drawFire(event);
        for (const peer of this.session.lobby.players) if (!peer.host && peer.id !== from) this.broadcast(event, peer.id);
      } else if (value.t === 'hit') {
        const enemy = this.ctx.enemies.alive.find(enemy => enemy.uid === value.target);
        if (!enemy || this.life(from).down || !this.validator.validate(from, value, now, eye.toArray() as Vec, enemy.center.toArray() as Vec,
          (origin, target) => this.visible(origin, target))) { this.stats.rejected++; return; }
        this.stats.accepted++;
        const damage = this.unpack(value.damage);
        if (damage.bone !== undefined && damage.bone >= enemy.char.rig.bones.length) damage.bone = undefined;
        this.targetPlayer = this.players().find(player => player.id === from)?.player ?? this.ctx.player;
        this.lastHitter.set(enemy.uid, from);
        this.applying = from;
        try { this.manager.applyDamage(enemy, damage); }
        finally { this.targetPlayer = null; this.applying = null; }
      }
      return;
    }
    if (this.mission.receive(value)) return;
    switch (value.t) {
      case 'fire': this.drawFire(value); break;
      case 'ray': this.ctx.fx.tracer(new THREE.Vector3(...value.from), new THREE.Vector3(...value.to), 'enemy'); break;
      case 'hurt': {
        if (this.life(this.session.lobby.you).accepts(value.life) && Number.isFinite(value.amount) && value.amount > 0 && value.amount < 10000 && validVec(value.from)) {
          this.receivingDamage = true;
          try { this.ctx.player.takeDamage({ amount: value.amount, from: new THREE.Vector3(...value.from), type: value.type as PlayerDamage['type'], source: value.source }); }
          finally { this.receivingDamage = false; }
        }
        break;
      }
      case 'kill': {
        if (this.dead.has(value.uid)) break;
        this.dead.add(value.uid);
        let enemy = this.replicas.get(value.uid)?.enemy;
        if (!enemy) {
          enemy = this.manager.spawn(value.id, new THREE.Vector3(...value.at)) ?? undefined;
          if (enemy) { enemy.uid = value.uid; enemy.yaw = value.yaw; }
        }
        if (enemy) {
          const damage = this.unpack(value.damage);
          this.manager.replayDeath(enemy, damage, value.gib);
          // My own kill: my browser pays, scores and counts it, as the host's does its own.
          if (value.by === this.session.lobby.me?.slot) this.ownKill(enemy, damage, value.gib === true, value.head === true);
        }
        this.replicas.delete(value.uid);
        break;
      }
      case 'hitfx': {
        const enemy = this.replicas.get(value.uid)?.enemy;
        if (!enemy || this.dead.has(value.uid)) break;
        enemy.health = value.health; enemy.armor = value.armor;
        const damage = this.unpack(value.damage);
        if (value.blocked) this.ctx.fx.impact(damage.point, damage.dir.clone().negate(), 'armor');
        else { this.ctx.gore.wound(enemy.char, damage, 0.6); this.ctx.fx.bloodHit(damage.point, damage.dir); enemy.char.hitFlash(0.4); }
        break;
      }
      case 'chatter': this.hear(value); break;
      case 'credit': {
        const amount = Number.isFinite(value.amount) ? Math.max(0, Math.min(1e6, Math.round(value.amount))) : 0;
        const wallet = this.ctx.contracts?.wallet;
        if (amount && wallet) { wallet.earn(amount); this.ctx.hud.feed(`+${amount} CREDITS: ${String(value.why).slice(0, 24).toUpperCase()}`, '#ffc14a'); }
        break;
      }
      case 'vehicles': this.drawVehicles(value); break;
      case 'allies': this.drawAllies(value); break;
      case 'ashot': if (validVec(value.from) && validVec(value.to)) this.ctx.fx.tracer(new THREE.Vector3(...value.from), new THREE.Vector3(...value.to), 'bullet'); break;
      case 'chatcut': {
        const enemy = this.replicas.get(value.uid)?.enemy;
        if (enemy && Number.isInteger(value.at) && value.at >= 0) this.ctx.events.emit('comms:cut', { enemy, at: value.at, radio: value.radio === true });
        break;
      }
      case 'sever': {
        const enemy = this.replicas.get(value.uid)?.enemy;
        if (enemy && !enemy.char.severed.has(value.region)) this.ctx.gore.sever(enemy.char, value.region, this.unpack(value.damage));
        break;
      }
    }
  }

  private ownKill(enemy: Enemy, damage: DamageInfo, gibbed: boolean, headshot: boolean): void {
    const p = this.ctx.player;
    const event: KillEvent = { enemy, damage, headshot, gibbed, sliced: !!damage.slicePlaneNormal, severedCount: enemy.char.severed.size,
      playerAirborne: !p.grounded, playerSliding: p.sliding, playerWallRunning: p.wallRunning, playerSpeed: p.speed,
      distance: enemy.position.distanceTo(p.position), explosionId: damage.explosionId ?? null };
    this.ctx.events.emit('enemy:killed', event);
  }

  /** Someone else's explosion, drawn and heard here. It hurts nobody: whatever it did, the host has already counted. */
  private boomIn(value: Extract<WorldEvent, { t: 'boom' }>, from: string): void {
    if (!validVec(value.at) || !Object.hasOwn(EXPLOSIONS, value.kind) || !Number.isFinite(value.radius) || value.radius <= 0 || value.radius > 60) return;
    if (this.session.hosting) {
      if (!this.spendBoom()) return;
      const slot = this.session.lobby.players.find(p => p.id === from)?.slot;
      for (const peer of this.session.lobby.players) if (!peer.host && peer.id !== from) this.broadcast({ ...value, slot }, peer.id);
    }
    const at = new THREE.Vector3(...value.at);
    const kind = value.kind as ExplosionKind;
    // A guest's rocket on a truck: vehicles live only on the host, so its blast is applied to them here.
    if (this.session.hosting && Number.isFinite(value.damage) && value.damage! > 0 && typeof value.source === 'string') {
      this.ctx.enemies.vehicles?.blast(at, { radius: value.radius, damage: Math.min(3000, value.damage!), kind, source: value.source.slice(0, 32), team: 'player' });
    }
    this.ctx.fx.explosion(at, { radius: value.radius, kind });
    for (const sound of EXPLOSIONS[kind as keyof typeof EXPLOSIONS].sounds) this.ctx.audio.play(sound.id, { ...sound, position: at });
    const near = this.ctx.player.eye.distanceTo(at);
    if (near < value.radius * 4) this.ctx.camera.addTrauma(0.35 * (1 - near / (value.radius * 4)));
  }

  private spendBoom(): boolean {
    const second = Math.floor(performance.now() / 1000);
    if (second !== this.boomSecond) { this.boomSecond = second; this.booms = 0; }
    return ++this.booms <= BOOMS_PER_SECOND;
  }

  private hear(value: Extract<WorldEvent, { t: 'chatter' }>): void {
    const row = Number.isInteger(value.line) ? RULES[value.line] : undefined;
    if (!row || typeof value.squad !== 'string' || value.squad.length > 16) return;
    const line = this.heard;
    const enemy = value.uid ? this.replicas.get(value.uid)?.enemy ?? null : null;
    const rank = RANK_IDS[value.rank];
    line.kind = row.concept;
    line.row = value.line;
    line.name = nameId(value.name);
    line.dead = nameId(value.dead);
    const slots: Record<string, string> = {};
    // Only short words for known blanks: the host's slots fill a row, they never carry text of their own.
    for (const [k, v] of Object.entries(value.slots ?? {})) if (/^[a-z]{1,12}$/.test(k) && typeof v === 'string' && v.length <= 32) slots[k] = v;
    if (line.dead >= 0) slots.dead = NAME_LIST[line.dead]!;
    line.slots = value.slots ?? null;
    line.why = '';
    // The same man in the same voice on every machine.
    line.voice = Number.isInteger(value.voice) && value.voice! >= 0 && value.voice! < VOICE_COUNT ? value.voice! : -1;
    line.text = lineText(value.line, slots);
    line.squad = value.uid ? value.squad : 'Command';
    line.speaker = value.uid ? speakerTag(line.name, rank ? RANKS[rank].label : '', value.squad) : null;
    line.enemy = enemy;
    line.position.copy(enemy?.center ?? this.ctx.player.position);
    this.ctx.events.emit('comms:line', line);
  }

  private visible(origin: Vec, target: Vec): boolean {
    const start = new THREE.Vector3(...origin), direction = new THREE.Vector3(...target).sub(start);
    const range = direction.length();
    return range < 0.1 || !this.ctx.physics.raycast(start, direction.divideScalar(range), Math.max(0, range - 1), CG.World);
  }
  private drawFire(event: Extract<WorldEvent, { t: 'fire' }>): void {
    if (!validVec(event.origin) || !validVec(event.dir) || !Object.hasOwn(WEAPONS, event.weapon)) return;
    const def = WEAPONS[event.weapon as WeaponId];
    const origin = new THREE.Vector3(...event.origin), dir = new THREE.Vector3(...event.dir).normalize();
    const wall = this.ctx.physics.raycast(origin, dir, 100, CG.World);
    const end = wall?.point ?? origin.clone().addScaledVector(dir, 100);
    const remote = [...this.session.remotes.values()].find(remote => remote.player.slot === event.slot);
    // Flash and tracer leave the friend's own gun; the shot itself is still traced from their eye, as they aimed it.
    const muzzle = remote ? remote.muzzle(new THREE.Vector3()) : origin;
    if (!isMelee(event.weapon) && !/^sword/.test(event.weapon)) {
      this.ctx.fx.tracer(muzzle, end, 'bullet');
      this.ctx.fx.muzzleFlash(muzzle, dir, def.muzzle);
    }
    // Positional: a friend's gun is heard from where they stand.
    for (const sound of def.sounds) this.ctx.audio.play(sound.id, { ...sound, position: muzzle, volume: (sound.volume ?? 1) * 0.65 });
    remote?.char.anim.play('shoot', 1.4);
  }

  private frame(enemy: Enemy): EnemyFrame {
    return { uid: enemy.uid, id: enemy.id, position: enemy.position.toArray() as Vec, velocity: enemy.velocity.toArray() as Vec,
      yaw: enemy.yaw, health: enemy.health, maxHealth: enemy.maxHealth, armor: enemy.armor,
      flags: (enemy.airborne ? 1 : 0) | (enemy.downed ? 2 : 0) | (enemy.frozen > 0 ? 4 : 0) | (enemy.burning > 0 ? 8 : 0)
        | (enemy.shield ? 16 : 0) | (enemy.ward > 0 ? 32 : 0) | (enemy.entrance === 'boss' ? 64 : 0) | (capturable(enemy) ? CAPTURABLE : 0),
      posture: postureOf(enemy),
      animation: enemy.attack ? enemy.attackPhase === 'windup' ? 1 : 2 : enemy.stagger > 0 ? 3 : 0,
      severed: REGIONS.reduce((mask, region, index) => mask | (enemy.char.severed.has(region) ? 1 << index : 0), 0),
      plates: enemy.plates.reduce((mask, plate, index) => mask | (plate.hp > 0 ? 1 << index : 0), 0) };
  }
  private receiveSnapshot(data: ArrayBuffer): void {
    if (this.session.hosting) return;
    if (!this.ready) { this.pendingSnapshot = data; return; }
    const frame = decodeWorld(data);
    if (!frame || (this.receivedSeq !== null && ((frame.seq - this.receivedSeq) >>> 0) >= 0x80000000) || frame.seq === this.receivedSeq) return;
    this.receivedSeq = frame.seq;
    const now = performance.now();
    Object.assign(this.ctx.waves, { wave: frame.wave, phase: frame.phase, nextWaveIn: frame.nextWaveIn });
    const present = new Set<number>();
    for (const state of frame.enemies) {
      if (this.dead.has(state.uid)) continue;
      present.add(state.uid);
      let replica = this.replicas.get(state.uid);
      if (!replica) {
        const enemy = this.manager.spawn(state.id, new THREE.Vector3(...state.position));
        if (!enemy) continue;
        enemy.uid = state.uid;
        replica = { enemy, from: state, to: state, at: now };
        this.replicas.set(state.uid, replica);
      } else {
        replica.from = { ...replica.to, position: replica.enemy.position.toArray() as Vec, yaw: replica.enemy.yaw };
        replica.to = state; replica.at = now;
      }
      const enemy = replica.enemy;
      enemy.health = state.health; enemy.maxHealth = state.maxHealth;
      if (state.plates && enemy.plates.length === 0) this.manager.fitPlates(enemy, [HELMET]);
      enemy.armor = state.armor;
      enemy.airborne = (state.flags & 1) !== 0;
      enemy.shield = (state.flags & 16) !== 0;
      const skin = enemy.char as unknown as { setBurn?(amount: number): void; setFrost?(amount: number): void };
      skin.setBurn?.((state.flags & 8) !== 0 ? 1 : 0);
      skin.setFrost?.((state.flags & 4) !== 0 ? 1 : 0);
      if (state.animation !== replica.from.animation && state.animation !== 0) enemy.char.anim.play(state.animation === 1 ? 'attackMelee' : state.animation === 2 ? 'shoot' : 'stagger');
      enemy.plates.forEach((plate, index) => {
        plate.mesh.visible = (state.plates & 1 << index) !== 0;
        if (!plate.mesh.visible) plate.hp = 0;
      });
      for (let index = 0; index < REGIONS.length; index++) if ((state.severed & 1 << index) && !enemy.char.severed.has(REGIONS[index]!)) {
        const damage: DamageInfo = { amount: 1, type: 'slash', point: enemy.center.clone(), dir: new THREE.Vector3(0, 1, 0), force: 1, source: 'coop' };
        this.ctx.gore.sever(enemy.char, REGIONS[index]!, damage);
      }
    }
    for (const [uid, replica] of this.replicas) if (!present.has(uid) && now - replica.at > 500) {
      this.manager.withdraw(replica.enemy); this.replicas.delete(uid);
    }
  }
  updateGuests(): void {
    const now = performance.now();
    for (const puppet of this.puppets.values()) {
      const root = puppet.model.root;
      root.position.lerpVectors(puppet.from, puppet.to, Math.min(1, (now - puppet.at) / 200));
      root.quaternion.slerp(puppet.q, 0.25);
      if (puppet.model.turret) puppet.model.turret.rotation.y = puppet.turret;
    }
    for (const replica of this.replicas.values()) {
      const alpha = Math.max(0, Math.min(1, (now - replica.at) / SNAPSHOT_MS));
      const { enemy, from, to } = replica;
      enemy.position.fromArray(from.position).lerp(new THREE.Vector3(...to.position), alpha);
      enemy.yaw = from.yaw + Math.atan2(Math.sin(to.yaw - from.yaw), Math.cos(to.yaw - from.yaw)) * alpha;
      enemy.velocity.fromArray(to.velocity);
      this.manager.placeReplica(enemy, this.ctx.time.dt, (to.flags & 2) !== 0 ? 'downed' : to.posture ?? 'stand');
    }
  }

  private players(): PlayerTarget[] {
    const localId = this.session.lobby.you;
    const result: PlayerTarget[] = [];
    for (const roster of this.session.lobby.players) {
      const remote = this.session.remotes.get(roster.id);
      if (roster.id !== localId && (!remote || !remote.buffer.sample(performance.now()))) continue;
      let adapter = this.adapters.get(roster.id);
      if (!adapter) {
        const position = new THREE.Vector3(), eye = new THREE.Vector3(), velocity = new THREE.Vector3(), forward = new THREE.Vector3();
        const life = this.life(roster.id);
        const player = roster.id === localId ? this.ctx.player : new Proxy(this.ctx.player, {
          get: (target, key) => {
            switch (key) {
              case 'position': return position;
              case 'eye': return eye;
              case 'velocity': return velocity;
              case 'forward': return forward;
              case 'alive': return !life.down;
              case 'grounded': return true;
              case 'takeDamage': return (damage: PlayerDamage) => this.hurt(roster.id, damage);
              case 'launch': case 'push': return () => {};
              default: return Reflect.get(target, key);
            }
          },
        });
        const foe: Foe = {
          get alive() { return player.alive; }, get center() { return eye; },
          shotAt: (from, damage, miss, source) => {
            const end = eye.clone().add(new THREE.Vector3((Math.random() - 0.5) * miss, (Math.random() - 0.5) * miss, 0));
            const dir = end.sub(from).normalize();
            this.ctx.combat.fireRay(from, dir, { damage, source, team: 'enemy', tracer: 'enemy' });
          },
          blast: (at, radius, damage, delay, source) => this.delayed.push({ at: performance.now() + delay * 1000,
            run: () => this.ctx.combat.explode(at, { radius, damage, source, team: 'enemy', kind: 'enemy' }) }),
        };
        adapter = { id: roster.id, player, life, foe };
        this.adapters.set(roster.id, adapter);
      }
      if (remote) {
        adapter.player.position.copy(remote.char.root.position);
        adapter.player.eye.copy(remote.char.root.position).y += 1.6;
        const pose = remote.buffer.sample(performance.now())!;
        adapter.player.velocity.fromArray(pose.velocity);
        adapter.player.forward.set(-Math.sin(pose.yaw), 0, -Math.cos(pose.yaw));
      }
      result.push(adapter);
    }
    return result;
  }
  select(enemy: Enemy, sense: PlayerSense): void {
    const players = this.players();
    const selected = selectTarget(enemy.position.toArray(), players.map(target => ({ id: target.id, alive: target.player.alive, position: target.player.position.toArray() })), this.selections.get(enemy.uid));
    const target = players.find(player => player.id === selected?.id);
    this.targetPlayer = target?.player ?? this.ctx.player;
    const player = this.targetPlayer;
    if (target) this.selections.set(enemy.uid, target.id);
    sense.position.copy(player.position); sense.eye.copy(player.eye); sense.chest.copy(player.position).y += 1;
    sense.velocity.copy(player.velocity); sense.forward.copy(player.forward); sense.speed = player.velocity.length();
    sense.alive = !!target && player.alive; sense.grounded = player.grounded; sense.ghost = false;
    sense.evasion = Math.max(0, Math.min(1, (sense.speed - 2) / 9.5));
    if (target) {
      let sight = this.sight.get(enemy.uid);
      if (!sight || sight.target !== target.id || performance.now() >= sight.at) {
        sight = { target: target.id, at: performance.now() + 200, visible: this.visible(enemy.center.toArray() as Vec, player.eye.toArray() as Vec) };
        this.sight.set(enemy.uid, sight);
      }
      enemy.hasLos = sight.visible;
    }
    const soldier = soldierOf(enemy);
    if (soldier) soldier.foe = target && target.id !== this.session.lobby.you ? target.foe : null;
  }
  isRemoteTarget(): boolean { return !!this.targetPlayer && this.targetPlayer !== this.ctx.player; }
  allowsLocalDamage(damage: PlayerDamage): boolean {
    return this.receivingDamage || damage.type === 'hazard' || Object.hasOwn(WEAPONS, damage.source) || damage.source === 'grenade';
  }
  steer(enemy: Enemy, direction: THREE.Vector3): boolean {
    if (!this.isRemoteTarget()) return false;
    const target = this.targetPlayer!.position;
    if (enemy.hasLos) { direction.subVectors(target, enemy.position).setY(0).normalize(); return true; }
    const grid = this.ctx.world.nav as unknown as NavGrid;
    if (!grid.nodeCount) return false;
    if (!this.finder.ready) this.finder.build(grid);
    let cached = this.routes.get(enemy.uid);
    const now = performance.now();
    if ((!cached || now >= cached.at || cached.target.distanceToSquared(target) > 16) && this.searchFrame !== this.ctx.time.frame) {
      this.searchFrame = this.ctx.time.frame;
      if (!cached) { cached = { route: new Route(), at: 0, target: new THREE.Vector3() }; this.routes.set(enemy.uid, cached); }
      cached.at = now + 1200; cached.target.copy(target);
      this.finder.find(enemy.position, target, cached.route, null, 2000);
    }
    if (!cached || cached.route.done) return false;
    const route = cached.route;
    while (!route.done) {
      direction.set(route.x[route.next]!, route.y[route.next]!, route.z[route.next]!).sub(enemy.position);
      if (direction.lengthSq() > 0.75 * 0.75) break;
      route.next++;
    }
    if (route.done) { cached.at = 0; return false; }
    direction.setY(0).normalize();
    return true;
  }
  private hurt(id: string, damage: PlayerDamage): void {
    const life = this.life(id);
    if (life.down || damage.amount <= 0) return;
    this.broadcast({ t: 'hurt', amount: damage.amount, from: (damage.from ?? this.ctx.player.position).toArray() as Vec,
      type: damage.type, source: damage.source, life: life.life }, id);
  }
  enemyRay(from: THREE.Vector3, to: THREE.Vector3, damage: number, source: string, trace = true): THREE.Vector3 | null {
    if (!this.session.hosting) return null;
    let nearest = 2;
    let target: PlayerTarget | undefined;
    for (const candidate of this.players()) {
      if (!candidate.player.alive) continue;
      const hit = closestSegmentPoints(from, to, candidate.player.position, candidate.player.eye);
      if (hit.dist2 < 0.4 * 0.4 && hit.s < nearest) { nearest = hit.s; target = candidate; }
    }
    const end = target ? from.clone().lerp(to, nearest) : to;
    if (trace) this.broadcast({ t: 'ray', from: from.toArray() as Vec, to: end.toArray() as Vec });
    if (!target || target.id === this.session.lobby.you) return null;
    this.hurt(target.id, { amount: damage, from, type: 'bullet', source });
    return end;
  }
  projectile(from: THREE.Vector3, dir: THREE.Vector3): void {
    if (!this.session.hosting) return;
    const wall = this.ctx.physics.raycast(from, dir, 100, CG.World);
    const to = wall?.point ?? from.clone().addScaledVector(dir, 100);
    this.broadcast({ t: 'ray', from: from.toArray() as Vec, to: to.toArray() as Vec });
  }
  blast(center: THREE.Vector3, spec: ExplosionSpec): void {
    // Every explosion this game makes is drawn on the others': the host's for everyone, a guest's through the host.
    if (!spec.worldObject && this.ready && this.spendBoom()) {
      this.broadcast({ t: 'boom', at: center.toArray() as Vec, kind: spec.kind, radius: spec.radius, slot: this.session.lobby.me?.slot,
        ...(spec.team === 'player' && !this.session.hosting ? { damage: spec.damage, source: spec.source } : {}) });
    }
    if (!this.session.hosting || spec.team !== 'enemy') return;
    const def = EXPLOSIONS[spec.kind];
    for (const target of this.players()) {
      if (target.id === this.session.lobby.you || !target.player.alive) continue;
      const distance = target.player.eye.distanceTo(center);
      if (distance > spec.radius || (!def.ignoresCover && !this.visible(center.toArray() as Vec, target.player.eye.toArray() as Vec))) continue;
      this.hurt(target.id, { amount: spec.damage * (1 - distance / spec.radius * (1 - def.edgeDamage)), from: center, type: 'explosive', source: spec.source });
    }
  }
  update(): void {
    if (!this.ready) return;
    const now = performance.now();
    this.team.update(now, this.ctx.time.realDt);
    this.mission.update();
    if (!this.session.hosting) this.captureKey(this.ctx.time.realDt);
    else if (now >= this.nextVehicles) { this.nextVehicles = now + 200; this.sendVehicles(); this.sendAllies(); }
    if (!this.session.hosting) this.animateAllies(this.ctx.time.realDt);
    for (const id of this.adapters.keys()) if (!this.session.lobby.players.some(player => player.id === id)) {
      this.adapters.delete(id); this.validator.forget(id);
    }
    for (const [uid, kill] of this.killedBy) if (now - kill.at > 3000) this.killedBy.delete(uid);
    const due = this.delayed.filter(event => event.at <= now);
    this.delayed = this.delayed.filter(event => event.at > now);
    for (const event of due) event.run();
    if (!this.session.hosting || now < this.nextSnapshot) return;
    this.nextSnapshot = now + SNAPSHOT_MS;
    const frame: WorldFrame = { seq: this.seq++ >>> 0, wave: this.ctx.waves.wave, phase: this.ctx.waves.phase, nextWaveIn: this.ctx.waves.nextWaveIn,
      enemies: this.manager.alive.map(enemy => this.frame(enemy)) };
    const buffer = encodeWorld(frame);
    const recipients = this.sendSnapshot(buffer);
    this.stats.snapshotBytes += buffer.byteLength * recipients;
    this.stats.snapshotPackets += recipients;
    const alive = new Set(this.manager.alive.map(enemy => enemy.uid));
    for (const uid of this.selections.keys()) if (!alive.has(uid)) { this.selections.delete(uid); this.sight.delete(uid); this.routes.delete(uid); }
    for (const uid of this.lastHitter.keys()) if (!alive.has(uid)) this.lastHitter.delete(uid);
  }
  private get guns(): DroppedGuns | undefined {
    return (this.ctx.weapons as unknown as { dropped?: DroppedGuns }).dropped;
  }

  /** A dropped gun's news (weapons/dropped.ts): a guest's drop or take goes to the host, the host's word to everyone. */
  sendGun(event: Extract<WorldEvent, { t: 'gun' }>, to?: string): void {
    this.broadcast(event, to);
  }

  private gunIn(value: Extract<WorldEvent, { t: 'gun' }>, from: string): void {
    // The lobby lets a guest hear only the host (lobby.ts `gameplay`).
    if (!this.session.hosting) return this.guns?.guestIn(value);
    const remote = this.session.remotes.get(from);
    if (remote) this.guns?.hostIn(value, from, remote.char.root.position, remote.player.name);
  }

  /** Host: a guest held E on a surrendered man beside them. He is cuffed as if by the host, and the bounty is theirs. */
  private captureFor(from: string, at: THREE.Vector3, uid: unknown): void {
    const enemy = this.ctx.enemies.alive.find(e => e.uid === uid) as Enemy | undefined;
    const soldier = enemy ? soldierOf(enemy) : null;
    if (!enemy || !soldier || !capturable(enemy) || enemy.position.distanceTo(at) > 4.5) return;
    // The drone's own cuff (airlift.ts), not the prisoners' key path, which would also drop whatever the host is holding.
    const airlift = (this.manager as unknown as { outpost?: { captives?: { airlift?: { cuff(s: unknown): void } } } }).outpost?.captives?.airlift;
    if (!airlift) return;
    this.captors.set(enemy.uid, from);
    airlift.cuff(soldier);
    const name = this.session.lobby.players.find(p => p.id === from)?.name ?? 'A teammate';
    this.ctx.hud.feed(`${name} cuffed a prisoner`, '#79f1ad');
  }

  /** Guest: hold E on a surrendered man in reach and in view, and the host cuffs him for you. */
  private captureKey(dt: number): void {
    const { player, input, hud } = this.ctx;
    let best: Replica | null = null;
    let bestD = 3.1;
    if (player.alive && !player.parked) for (const replica of this.replicas.values()) {
      if (!(replica.to.flags & CAPTURABLE)) continue;
      const d = replica.enemy.position.distanceTo(player.position);
      if (d >= bestD) continue;
      const toward = replica.enemy.center.clone().sub(player.eye).normalize();
      if (toward.dot(player.forward) < 0.55) continue;
      best = replica; bestD = d;
    }
    const uid = best?.enemy.uid ?? -1;
    if (this.capturePrompt && this.capturePrompt.uid !== uid) { this.capturePrompt.off(); this.capturePrompt = null; }
    if (!best) { this.captureHeld = -1; return; }
    // The questions are the host's: a guest's E on a kneeling man is the capture alone, a 0.6 s hold with the ring.
    if (!this.capturePrompt) this.capturePrompt = { uid, off: hud.follow(best.enemy.center, `Hold [${input.labelFor?.('interact') ?? 'E'}] to capture`, '#ffc14a') };
    if (input.pressed('interact')) this.captureHeld = 0;
    if (this.captureHeld < 0) return;
    if (!input.isDown('interact')) { this.captureHeld = -1; return; }
    this.captureHeld += dt;
    hud.hold?.(Math.min(1, this.captureHeld / 0.6));
    if (this.captureHeld >= 0.6) { this.captureHeld = -1; this.broadcast({ t: 'capture', uid }); }
  }

  /** Host: where every truck, humvee and tank is, for the guests to draw. */
  private sendVehicles(): void {
    const live = (this.ctx.enemies.vehicles as unknown as { live?: Vehicle[] } | undefined)?.live;
    if (!live?.length && !this.puppetsSent) return;
    this.puppetsSent = !!live?.length;
    const list = (live ?? []).filter(v => v.alive && ['humvee', 'truck', 'tank'].includes(v.def.kind)).slice(0, 16).map(v => {
      let id = this.vehicleIds.get(v);
      if (id === undefined) this.vehicleIds.set(v, id = ++this.vehicleSerial);
      return { id, kind: v.def.kind, p: v.position.toArray() as Vec, q: v.quaternion.toArray() as [number, number, number, number],
        turret: (v as unknown as { turretYaw?: number }).turretYaw ?? 0 };
    });
    this.broadcast({ t: 'vehicles', list });
  }
  private puppetsSent = false;
  private readonly allyIds = new WeakMap<object, number>();
  private allySerial = 0;
  private alliesSent = false;
  private ashots = 0;
  private ashotSecond = 0;
  private readonly allyBodies = new Map<number, { char: CharacterInstance; type: AllyType; from: THREE.Vector3; to: THREE.Vector3; yaw: number; state: number; posture: string; at: number }>();

  /** Host: an ally fired. Guests draw the tracer; it hurts nothing there. */
  allyShot(from: THREE.Vector3, to: THREE.Vector3): void {
    if (!this.session.hosting || !this.ready) return;
    const second = Math.floor(performance.now() / 1000);
    if (second !== this.ashotSecond) { this.ashotSecond = second; this.ashots = 0; }
    if (++this.ashots <= ASHOTS_PER_SECOND) this.broadcast({ t: 'ashot', from: from.toArray() as Vec, to: to.toArray() as Vec });
  }

  /** Host: where the garrison stands, for the guests to draw. */
  private sendAllies(): void {
    const allies = (this.ctx.allies as unknown as { allies?: { body: Enemy; type: AllyType; state: string }[] } | undefined)?.allies;
    if (!allies?.length && !this.alliesSent) return;
    this.alliesSent = !!allies?.length;
    const round = (n: number) => Math.round(n * 100) / 100;
    const list = (allies ?? []).filter(a => a.state !== 'dead').slice(0, 24).map(a => {
      let id = this.allyIds.get(a);
      if (id === undefined) this.allyIds.set(a, id = ++this.allySerial);
      const p = a.body.position;
      return [id, ALLY_KINDS.indexOf(a.type), round(p.x), round(p.y), round(p.z), round(a.body.yaw), a.state === 'down' ? 1 : 0, POSTURES.indexOf(postureOf(a.body))];
    });
    this.broadcast({ t: 'allies', list });
  }

  /** Guest: the host's garrison as bodies only: no AI, no colliders, moved toward each update. */
  private drawAllies(value: Extract<WorldEvent, { t: 'allies' }>): void {
    if (!Array.isArray(value.list)) return;
    const seen = new Set<number>();
    const now = performance.now();
    const lib = this.ctx.characters as Ctx['characters'] & { arm?(c: CharacterInstance, kit: readonly { model: string; socket: string }[], stance: string): void };
    for (const row of value.list.slice(0, 24)) {
      if (!Array.isArray(row) || row.length !== 8 || !row.every(Number.isFinite)) continue;
      const [id, typeIndex, x, y, z, yaw, state, posture] = row as number[];
      const type = ALLY_KINDS[typeIndex!];
      if (!type || !validVec([x, y, z])) continue;
      seen.add(id!);
      let body = this.allyBodies.get(id!);
      if (!body || body.type !== type) {
        body?.char.release();
        let char: CharacterInstance;
        try { char = this.ctx.characters.spawn(ALLY_TYPES[type].wears.model); } catch { continue; }
        lib.arm?.(char, ALLY_TYPES[type].wears.kit, ALLY_TYPES[type].wears.stance);
        this.ctx.render.scene.add(char.root);
        char.root.position.set(x!, y!, z!);
        body = { char, type, from: new THREE.Vector3(x, y, z), to: new THREE.Vector3(x, y, z), yaw: yaw!, state: 0, posture: 'stand', at: now };
        this.allyBodies.set(id!, body);
      }
      body.from.copy(body.char.root.position);
      body.to.set(x!, y!, z!);
      body.yaw = yaw!;
      body.state = state!;
      body.posture = state === 1 ? 'downed' : POSTURES[posture!] ?? 'stand';
      body.at = now;
    }
    for (const [id, body] of this.allyBodies) if (!seen.has(id)) { body.char.release(); this.allyBodies.delete(id); }
  }

  private animateAllies(dt: number): void {
    const now = performance.now();
    for (const body of this.allyBodies.values()) {
      const root = body.char.root;
      const before = root.position.clone();
      root.position.lerpVectors(body.from, body.to, Math.min(1, (now - body.at) / 200));
      root.rotation.y = body.yaw;
      root.visible = true;
      const speed = dt > 0 ? Math.min(8, before.distanceTo(root.position) / dt) : 0;
      (body.char.anim as unknown as { setPosture?(p: string): void }).setPosture?.(body.posture);
      body.char.anim.setLocomotion({ speed, moveX: 0, moveZ: speed > 0.1 ? 1 : 0, aimYaw: 0, aimPitch: 0, grounded: true });
      body.char.anim.update(dt, 0);
      root.updateMatrixWorld(true);
    }
  }

  /** Guest: the host's vehicles as models only, moved toward each update over the next 200 ms. */
  private drawVehicles(value: Extract<WorldEvent, { t: 'vehicles' }>): void {
    if (!Array.isArray(value.list)) return;
    const fleet = (this.ctx.enemies.vehicles as unknown as { fleet?: { ground(kind: string): GroundModel } } | undefined)?.fleet;
    const seen = new Set<number>();
    const now = performance.now();
    for (const v of value.list.slice(0, 16)) {
      if (!v || !Number.isInteger(v.id) || !['humvee', 'truck', 'tank'].includes(v.kind) || !validVec(v.p) || !Array.isArray(v.q) || v.q.length !== 4 || !v.q.every(Number.isFinite)) continue;
      seen.add(v.id);
      let puppet = this.puppets.get(v.id);
      if (!puppet || puppet.kind !== v.kind) {
        if (!fleet) continue;
        puppet?.model.root.removeFromParent();
        const model = fleet.ground(v.kind);
        model.root.position.fromArray(v.p);
        puppet = { model, from: new THREE.Vector3(...v.p), to: new THREE.Vector3(...v.p), q: new THREE.Quaternion(), turret: 0, at: now, kind: v.kind };
        this.puppets.set(v.id, puppet);
      }
      puppet.from.copy(puppet.model.root.position);
      puppet.to.fromArray(v.p);
      puppet.q.fromArray(v.q);
      puppet.turret = Number.isFinite(v.turret) ? v.turret : 0;
      puppet.at = now;
      puppet.model.root.visible = true;
    }
    for (const [id, puppet] of this.puppets) if (!seen.has(id)) { puppet.model.root.removeFromParent(); this.puppets.delete(id); }
  }

  selfDestruct(enemy: Enemy): void {
    if (!this.session.hosting) return;
    this.broadcast({ t: 'kill', uid: enemy.uid, id: enemy.id, at: enemy.position.toArray() as Vec, yaw: enemy.yaw, gib: true,
      damage: { amount: enemy.health + 1, type: 'explosive', point: enemy.center.toArray() as Vec, dir: [0, 1, 0], force: 300, source: enemy.id, gib: true } });
  }
  dispose(): void {
    for (const off of this.off) off();
    this.team.dispose();
    this.capturePrompt?.off();
    for (const puppet of this.puppets.values()) puppet.model.root.removeFromParent();
    this.puppets.clear();
    for (const body of this.allyBodies.values()) body.char.release();
    this.allyBodies.clear();
    for (const replica of this.replicas.values()) if (replica.enemy.alive) this.manager.withdraw(replica.enemy);
    this.replicas.clear(); this.delayed = [];
  }
}
