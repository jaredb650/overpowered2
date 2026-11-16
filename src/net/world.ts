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
import type { CommsLine } from '../enemies/outpost/events';
import { RANKS, type Rank } from '../enemies/outpost/rank';
import { HELMET } from '../enemies/wounds/armour';
import { Route, RouteFinder, type NavGrid } from '../enemies/outpost/routes';
import { closestSegmentPoints } from '../weapons/geometry';
import { EXPLOSIONS, WEAPONS } from '../weapons/data';
import { ClaimValidator, RespawnClock, selectTarget } from './authority';
import { decodeWorld, encodeWorld, ENEMY_IDS, packDamage, REGIONS, SNAPSHOT_MS, validVec, type EnemyFrame, type Vec, type WireDamage, type WorldEvent, type WorldFrame } from './worldProtocol';
import type { CoopSession } from './index';

interface Replica { enemy: Enemy; from: EnemyFrame; to: EnemyFrame; at: number }
const RANK_IDS = Object.keys(RANKS) as Rank[];
const nameId = (id: unknown): number => typeof id === 'number' && Number.isInteger(id) && NAME_LIST[id] !== undefined ? id : -1;
interface PlayerTarget { id: string; player: PlayerSystem; life: RespawnClock; foe: Foe }

export class CoopWorld {
  readonly stats = { snapshotBytes: 0, eventBytes: 0, snapshotPackets: 0, eventPackets: 0, accepted: 0, rejected: 0, since: performance.now() };
  readonly lives = new Map<string, RespawnClock>();
  readonly validator = new ClaimValidator();
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
    this.off.push(ctx.events.on('weapon:fired', event => this.fire(event.weapon, event.origin, event.dir)));
    this.off.push(ctx.events.on('player:died', () => this.died(session.lobby.you)));
    if (session.hosting) {
      this.off.push(ctx.events.on('enemy:hit', event => this.broadcast({ t: 'hitfx', uid: event.enemy.uid, damage: packDamage(event.damage),
        health: event.enemy.health, armor: event.enemy.armor, blocked: event.result.blocked })));
      this.off.push(ctx.events.on('enemy:killed', event => this.broadcast({ t: 'kill', uid: event.enemy.uid, id: event.enemy.id,
        at: event.enemy.position.toArray() as Vec, yaw: event.enemy.yaw, damage: packDamage(event.damage), gib: event.gibbed })));
      this.off.push(ctx.events.on('enemy:severed', event => this.broadcast({ t: 'sever', uid: event.enemy.uid, region: event.region, damage: packDamage(event.damage) })));
      // Every player hears the same man say the same words. Lines a caller wrote by hand stay the host's.
      this.off.push(ctx.events.on('comms:line', line => {
        if (line.row === undefined || line.row < 0) return;
        const rank = line.enemy ? soldierOf(line.enemy)?.rank : undefined;
        this.broadcast({ t: 'chatter', uid: line.enemy?.uid ?? 0, line: line.row, name: line.name ?? -1, dead: line.dead ?? -1,
          rank: rank ? RANK_IDS.indexOf(rank) : -1, squad: line.squad, ...(line.slots ? { slots: line.slots } : {}) });
      }));
      this.off.push(ctx.events.on('comms:cut', cut => this.broadcast({ t: 'chatcut', uid: cut.enemy.uid, at: cut.at })));
    }
  }

  private get manager(): EnemyManager { return this.ctx.enemies as EnemyManager; }
  begin(): void {
    this.ready = true;
    if (this.pendingSnapshot) this.receiveSnapshot(this.pendingSnapshot);
    this.pendingSnapshot = null;
  }
  private life(id: string): RespawnClock {
    let life = this.lives.get(id);
    if (!life) this.lives.set(id, life = new RespawnClock());
    return life;
  }
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
      slot: this.session.lobby.me?.slot });
  }
  claim(enemy: EnemyInstance, damage: DamageInfo): DamageResult {
    if (ENEMY_IDS.some(id => id === damage.source) || ['bleed', 'hazard', 'trample', 'coop'].includes(damage.source)) {
      return { dealt: 0, blocked: false, killed: false, headshot: false, severed: [] };
    }
    const weapon = this.ctx.weapons.current;
    if (performance.now() - this.firedAt > Math.max(100, WEAPONS[weapon].interval * 1000) || this.weapon !== weapon) this.fire(weapon, this.ctx.player.eye, this.ctx.player.forward);
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
    if (!this.ready || !value || typeof value !== 'object') return;
    const now = performance.now();
    if (this.session.hosting) {
      const remote = this.session.remotes.get(from);
      if (!remote || !remote.buffer.sample(now)) return;
      const eye = remote.char.root.position.clone().add(new THREE.Vector3(0, 1.6, 0));
      if (value.t === 'fire' && validVec(value.origin) && validVec(value.dir) && new THREE.Vector3(...value.origin).distanceTo(eye) < 7
        && !this.life(from).down && this.validator.acceptFire(from, value.shot, value.weapon, now)) {
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
        try { this.manager.applyDamage(enemy, damage); }
        finally { this.targetPlayer = null; }
      } else if (value.t === 'life' && value.alive === false && value.life === this.life(from).life) this.died(from);
      return;
    }
    switch (value.t) {
      case 'fire': this.drawFire(value); break;
      case 'ray': this.ctx.fx.tracer(new THREE.Vector3(...value.from), new THREE.Vector3(...value.to), 'enemy'); break;
      case 'hurt': {
        if (this.life(this.session.lobby.you).accepts(value.life)) {
          this.receivingDamage = true;
          try { this.ctx.player.takeDamage({ amount: value.amount, from: new THREE.Vector3(...value.from), type: value.type as PlayerDamage['type'], source: value.source }); }
          finally { this.receivingDamage = false; }
        }
        break;
      }
      case 'life': {
        const player = this.session.lobby.players.find(player => player.slot === value.slot);
        if (!player) break;
        const life = this.life(player.id);
        if (!value.alive && value.life === life.life) life.die(now);
        if (value.alive && value.life === life.life + 1 && life.down) {
          life.update(Infinity);
          if (player.id === this.session.lobby.you) this.respawn();
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
        if (enemy) this.manager.replayDeath(enemy, this.unpack(value.damage), value.gib);
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
      case 'chatcut': {
        const enemy = this.replicas.get(value.uid)?.enemy;
        if (enemy && Number.isInteger(value.at) && value.at >= 0) this.ctx.events.emit('comms:cut', { enemy, at: value.at });
        break;
      }
      case 'sever': {
        const enemy = this.replicas.get(value.uid)?.enemy;
        if (enemy && !enemy.char.severed.has(value.region)) this.ctx.gore.sever(enemy.char, value.region, this.unpack(value.damage));
        break;
      }
    }
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
    this.ctx.fx.tracer(origin, end, 'bullet');
    this.ctx.fx.muzzleFlash(origin, dir, def.muzzle);
    for (const sound of def.sounds) this.ctx.audio.play(sound.id, { ...sound, position: origin, volume: (sound.volume ?? 1) * 0.65 });
    const remote = [...this.session.remotes.values()].find(remote => remote.player.slot === event.slot);
    remote?.char.anim.play('shoot', 1.4);
  }

  private frame(enemy: Enemy): EnemyFrame {
    return { uid: enemy.uid, id: enemy.id, position: enemy.position.toArray() as Vec, velocity: enemy.velocity.toArray() as Vec,
      yaw: enemy.yaw, health: enemy.health, maxHealth: enemy.maxHealth, armor: enemy.armor,
      flags: (enemy.airborne ? 1 : 0) | (enemy.downed ? 2 : 0) | (enemy.frozen > 0 ? 4 : 0) | (enemy.burning > 0 ? 8 : 0)
        | (enemy.shield ? 16 : 0) | (enemy.ward > 0 ? 32 : 0) | (enemy.entrance === 'boss' ? 64 : 0),
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
    for (const replica of this.replicas.values()) {
      const alpha = Math.max(0, Math.min(1, (now - replica.at) / SNAPSHOT_MS));
      const { enemy, from, to } = replica;
      enemy.position.fromArray(from.position).lerp(new THREE.Vector3(...to.position), alpha);
      enemy.yaw = from.yaw + Math.atan2(Math.sin(to.yaw - from.yaw), Math.cos(to.yaw - from.yaw)) * alpha;
      enemy.velocity.fromArray(to.velocity);
      this.manager.placeReplica(enemy, this.ctx.time.dt, (to.flags & 2) !== 0);
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
    if (!this.session.hosting || spec.team !== 'enemy') return;
    const def = EXPLOSIONS[spec.kind];
    for (const target of this.players()) {
      if (target.id === this.session.lobby.you || !target.player.alive) continue;
      const distance = target.player.eye.distanceTo(center);
      if (distance > spec.radius || (!def.ignoresCover && !this.visible(center.toArray() as Vec, target.player.eye.toArray() as Vec))) continue;
      this.hurt(target.id, { amount: spec.damage * (1 - distance / spec.radius * (1 - def.edgeDamage)), from: center, type: 'explosive', source: spec.source });
    }
  }
  private died(id: string): void {
    const life = this.life(id);
    if (!life.die(performance.now())) return;
    const player = this.session.lobby.players.find(player => player.id === id);
    this.broadcast({ t: 'life', slot: player?.slot ?? 0, alive: false, life: life.life });
    if (id === this.session.lobby.you) this.ctx.hud.feed('Respawning in 3.5 seconds…', '#ffb33d');
  }
  private respawn(): void {
    this.ctx.player.reset?.();
    const spawns = this.ctx.world.playerSpawns;
    const spawn = spawns[(this.session.lobby.me?.slot ?? 0) % spawns.length];
    if (spawn) this.ctx.player.teleport(spawn.position, spawn.yaw);
    this.ctx.hud.feed('Back in the fight.', '#79f1ad');
  }
  update(): void {
    if (!this.ready) return;
    const now = performance.now();
    for (const roster of this.session.lobby.players) {
      const life = this.life(roster.id);
      if (this.session.hosting && life.update(now)) {
        if (roster.id === this.session.lobby.you) this.respawn();
        this.broadcast({ t: 'life', slot: roster.slot, alive: true, life: life.life });
      }
      const remote = this.session.remotes.get(roster.id);
      if (remote) remote.char.root.visible = !life.down && !!remote.buffer.sample(now);
    }
    for (const id of this.adapters.keys()) if (!this.session.lobby.players.some(player => player.id === id)) {
      this.adapters.delete(id); this.lives.delete(id); this.validator.forget(id);
    }
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
  }
  selfDestruct(enemy: Enemy): void {
    if (!this.session.hosting) return;
    this.broadcast({ t: 'kill', uid: enemy.uid, id: enemy.id, at: enemy.position.toArray() as Vec, yaw: enemy.yaw, gib: true,
      damage: { amount: enemy.health + 1, type: 'explosive', point: enemy.center.toArray() as Vec, dir: [0, 1, 0], force: 300, source: enemy.id, gib: true } });
  }
  dispose(): void {
    for (const off of this.off) off();
    for (const replica of this.replicas.values()) if (replica.enemy.alive) this.manager.withdraw(replica.enemy);
    this.replicas.clear(); this.delayed = [];
  }
}
