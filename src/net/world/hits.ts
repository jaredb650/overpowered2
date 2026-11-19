/**
 * Damage to enemies, as every screen but the deciding one shows it. The host decides (its own hits, and a guest's claims:
 * claims.ts). Nothing of the gore crosses the wire: each screen runs the same damage model on its own copy of the body
 * (`DamageModel.predict` and `show`, src/enemies/damage.ts) from a small event, and makes its own wounds, blood, reactions,
 * limbs, ragdolls and corpses.
 *
 * - **A guest's own hit is drawn on the frame of the shot** (`predict`): the wound at its real size, blood, the flinch or
 *   fall, the hit marker and sounds, and a guess at the kill for the shooter's ears. It carries a number (`DamageInfo.claim`)
 *   through the claim; the host's answer (`ack`) carries it back with what the host found, and only what was guessed wrong is
 *   put right. The host never sends a shooter its own hit's picture.
 * - **Anyone else's hit** comes as `hitfx`: the round and the host's findings, and who fired, so that what gore sizes by range
 *   goes by the shooter's eye.
 * - **A limb** comes as `sever` and **a death** as `kill`, each through the damage model's one path, with what the host found
 *   that a screen cannot work out (the blast's roll, a frozen body, a bursting head).
 *
 * Whose kill it was is credit.ts's word (`by`), so each player's own browser pays and scores only their kills.
 */
import * as THREE from 'three';
import type { DamageInfo } from '../../core/contracts';
import type { DamageResult, EnemyId, EnemyInstance, KillEvent } from '../../core/gameplay';
import type { GoreRegion } from '../../characters/rig';
import { floors, newFacts, type HitFacts } from '../../enemies/damage';
import type { Enemy } from '../../enemies/Enemy';
import type { ReactionLevel } from '../../enemies/reactions';
import { killSounds } from '../../audio/reactions';
import type { Claims } from './claims';
import type { Credit } from './credit';
import type { WorldContext, WorldModule } from './context';
import { packFacts, packHit, packKill, unpackFacts, unpackHit, unpackKill, type WireFacts, type WireHit } from './hitWire';
import type { Replicas } from './replicas';
import { ENEMY_IDS, REGIONS, type Vec } from './wire';

export type HitEvent =
  /**
   * Host to every guest but the shooter: enemy `u` was hit. `d` the round (hitWire.ts), `f` what the host found, `by` the
   * shooter's slot, `h` and `a` its health and armour after, in tenths.
   */
  | { t: 'hitfx'; u: number; by: number; h: number; a: number; f: WireFacts; d: WireHit }
  /** Host to the shooter: the answer to its hit number `c`. `k`: it killed. */
  | { t: 'ack'; c: number; u: number; h: number; a: number; f: WireFacts; k: number }
  /**
   * `by` is the killer's slot (-1 the world's own), `head` the host's headshot verdict: the killer's browser pays itself.
   * `k` is what the host found about the death (hitWire.ts `packKill`), `d` the killing round.
   */
  | { t: 'kill'; uid: number; id: EnemyId; at: Vec; yaw: number; gib: boolean; by?: number; head?: boolean; k?: number; d: WireHit }
  /** A cut made at `region`, by the player in slot `by`. */
  | { t: 'sever'; uid: number; region: GoreRegion; by?: number; d: WireHit };

/** A guest's own hits still unanswered. A ring this long: an answer older than that many hits is not waited for. */
const PENDING = 256;
/** An unanswered hit is forgotten after this long: the host dropped the claim. */
const PENDING_MS = 2500;
/** How far a teammate's eye is taken to be above their feet. */
const EYE = 1.6;
/** Sources that are the world's own and never a player's claim (claims.ts answers these with nothing). */
const WORLD_SOURCES: readonly string[] = ['bleed', 'hazard', 'trample', 'coop'];

/** One of a guest's own hits, as it was drawn, waiting for the host's answer. */
interface Pending {
  live: boolean;
  claim: number;
  enemy: Enemy | null;
  at: number;
  /** Health the guest reckoned it took, counted in `Enemy.owed` until it is answered. */
  owed: number;
  blocked: boolean;
  level: ReactionLevel;
  /** The round, kept for putting right what was drawn wrong. */
  damage: DamageInfo;
}

const newPending = (): Pending => ({
  live: false, claim: 0, enemy: null, at: 0, owed: 0, blocked: false, level: 'flinch',
  damage: { amount: 0, type: 'bullet', point: new THREE.Vector3(), dir: new THREE.Vector3(), force: 0, source: '' },
});

export class Hits implements WorldModule {
  /** Guest: its own hits the host has not answered, by hit number. */
  private readonly pending: Pending[] = Array.from({ length: PENDING }, newPending);
  private claim = 0;
  /** Guest: enemies the shooter has already been told it killed (by its own guess), and when. */
  private readonly toldKill = new Map<number, number>();
  /** Guest: what to do to a body of this player's when the host says it died (a stake's pin, a blade's fling). */
  private readonly onKill = new Map<number, ((enemy: EnemyInstance) => void)[]>();
  private readonly facts: HitFacts = newFacts();
  private readonly eye = new THREE.Vector3();
  /** For the proofs: what this screen has drawn, and how long the host took to answer. */
  readonly seen = { predicted: 0, shown: 0, acks: 0, corrected: 0, lateKills: 0, severs: 0, kills: 0, ackMs: 0, ackMsMax: 0 };

  /** `credit` is built first: its `enemy:killed` listener has named the killer before this one sends the death. */
  constructor(private readonly w: WorldContext, private readonly replicas: Replicas, private readonly credit: Credit, private readonly claims: Claims) {
    if (w.hosting) {
      w.listen('enemy:hit', event => this.hitOut(event.enemy as Enemy, event.damage, event.result));
      w.listen('enemy:killed', event => {
        const by = this.credit.slot(event.enemy.uid);
        w.send({ t: 'kill', uid: event.enemy.uid, id: event.enemy.id, at: event.enemy.position.toArray() as Vec, yaw: event.enemy.yaw,
          gib: event.gibbed, by, head: event.headshot, k: packKill(w.manager.model.foundKill), d: packHit(event.damage) });
      });
      // One event a cut, at the region it was made: a cut that takes two regions is still one limb.
      w.listen('enemy:severed', event => {
        if (event.cut) w.send({ t: 'sever', uid: event.enemy.uid, region: event.cut, by: this.shooterSlot(), d: packHit(event.damage) });
      });
    }
    w.router.guest('kill', value => this.killIn(value));
    w.router.guest('hitfx', value => this.hitfxIn(value));
    w.router.guest('ack', (value, _from, now) => this.ackIn(value, now));
    w.router.guest('sever', value => this.severIn(value));
  }

  // -------------------------------------------------------------------------------------------
  // Host: what a hit did, to the screens that did not decide it
  // -------------------------------------------------------------------------------------------

  /** Host: the slot of whoever's damage is being applied: the guest whose claim it is, else the host's own. */
  private shooterSlot(): number {
    const { lobby } = this.w.session;
    const id = this.claims.applying ?? lobby.you;
    return lobby.players.find(p => p.id === id)?.slot ?? -1;
  }

  private hitOut(enemy: Enemy, damage: DamageInfo, result: DamageResult): void {
    const { w } = this;
    const shooter = this.claims.applying;
    const h = Math.round(enemy.health * 10), a = Math.round(enemy.armor * 10);
    const f = packFacts(w.manager.model.found);
    if (shooter === null) {
      w.send({ t: 'hitfx', u: enemy.uid, by: this.shooterSlot(), h, a, f, d: packHit(damage) });
      return;
    }
    // A guest's claim. The shooter drew it when it fired: it gets the answer and no picture. Everyone else gets the hit.
    const claim = damage.claim;
    if (typeof claim === 'number' && Number.isInteger(claim) && claim > 0 && claim <= 0xffff) w.send({ t: 'ack', c: claim, u: enemy.uid, h, a, f, k: result.killed ? 1 : 0 }, shooter);
    if (w.session.lobby.players.length > 2) w.relay({ t: 'hitfx', u: enemy.uid, by: this.shooterSlot(), h, a, f, d: packHit(damage) }, shooter);
    // And the host's own screen, which the guest's gun never drew on: the blood or the sparks where it landed.
    w.ctx.combat.remoteHit?.(enemy, damage, result);
  }

  // -------------------------------------------------------------------------------------------
  // Guest: its own hit, drawn at once
  // -------------------------------------------------------------------------------------------

  /**
   * Guest, before the claim is sent: numbers the local player's hit so the host's answer can be matched to it. False for
   * damage that is the world's own (an enemy's blast on another enemy, bleeding), which is never claimed and never guessed:
   * the host decides it and every screen is shown it.
   */
  stamp(damage: DamageInfo): boolean {
    if (ENEMY_IDS.some(id => id === damage.source) || WORLD_SOURCES.includes(damage.source)) {
      damage.claim = undefined;
      return false;
    }
    this.claim = this.claim >= 0xffff ? 1 : this.claim + 1;
    damage.claim = this.claim;
    return true;
  }

  /** Guest: draws the local player's own hit now (`stamp` came first). The result is this machine's guess at the host's. */
  predict(enemy: Enemy, damage: DamageInfo): DamageResult {
    const { manager } = this.w;
    this.mirror(enemy);
    const result = manager.predictDamage(enemy, damage);
    const found = manager.model.found;
    const slot = this.pending[damage.claim! % PENDING]!;
    if (slot.live) this.settle(slot);
    slot.live = true;
    slot.claim = damage.claim!;
    slot.enemy = enemy;
    slot.at = performance.now();
    slot.owed = result.blocked ? 0 : result.dealt;
    slot.blocked = result.blocked;
    slot.level = found.level;
    copyDamage(slot.damage, damage);
    enemy.owed += slot.owed;
    if (result.killSoon) this.toldKill.set(enemy.uid, slot.at);
    this.seen.predicted++;
    return result;
  }

  /** What the snapshot says of the host's body that the damage model reads off the enemy itself. */
  private mirror(enemy: Enemy): void {
    const state = this.replicas.map.get(enemy.uid)?.to;
    if (!state) return;
    enemy.entrance = (state.flags & 64) !== 0 ? 'boss' : 'none';
    enemy.ward = (state.flags & 32) !== 0 ? Math.max(enemy.ward, 1) : 0;
    // A plate the host still has (replicas.ts shows it) is on here too, with something left, whatever was guessed; one the
    // host has lost is already gone.
    for (const plate of enemy.plates) if (plate.mesh.visible && plate.hp <= 0) plate.hp = plate.spec.hp * enemy.maxHealth * 0.5;
  }

  /** An unanswered hit stops counting against its enemy's health. */
  private settle(slot: Pending): void {
    if (slot.enemy) slot.enemy.owed = Math.max(0, slot.enemy.owed - slot.owed);
    slot.live = false;
    slot.enemy = null;
  }

  /** Guest: the host's answer to one of this player's hits. Only what was drawn wrong is put right. */
  private ackIn(value: Extract<HitEvent, { t: 'ack' }>, now: number): void {
    const { manager, ctx } = this.w;
    if (!Number.isInteger(value.c) || value.c <= 0 || value.c > 0xffff) return;
    const slot = this.pending[value.c % PENDING]!;
    if (!slot.live || slot.claim !== value.c) return;
    const enemy = slot.enemy!;
    const took = now - slot.at;
    this.seen.acks++;
    this.seen.ackMs += took;
    this.seen.ackMsMax = Math.max(this.seen.ackMsMax, took);
    this.settle(slot);
    const facts = unpackFacts(value.f, this.facts);
    if (!facts || !enemy.alive || this.replicas.enemy(value.u) !== enemy) return;
    if (Number.isFinite(value.h)) enemy.health = value.h / 10;
    if (Number.isFinite(value.a)) enemy.armor = value.a / 10;
    const stopped = facts.stop !== 'none';
    if (stopped && !slot.blocked) {
      // Drawn as flesh, and armour had it: the sparks and the ring of it, late. The blood stays where it was thrown.
      this.seen.corrected++;
      ctx.combat.remoteHit?.(enemy, slot.damage, BLOCKED);
    } else if (!stopped && slot.blocked) {
      // Drawn as stopped, and it went in: the whole hit, now.
      this.seen.corrected++;
      const result = manager.showDamage(enemy, slot.damage, facts, null);
      ctx.combat.remoteHit?.(enemy, slot.damage, result);
    } else if (!stopped) {
      const down = floors(facts.level), drawn = floors(slot.level);
      // What the host's body did and this one did not: it goes down now; or it went down here alone, and gets up.
      if (down !== drawn) this.seen.corrected++;
      if (down && !drawn) manager.showReaction(enemy, slot.damage, facts);
      else if (!down && drawn) manager.rouseReplica(enemy);
      // A blast's ring is the host's roll: a body it laid open is opened now.
      else if (facts.blast === 'flesh') manager.showReaction(enemy, slot.damage, facts, false);
    }
  }

  /**
   * Guest: runs `then` on this enemy's body when the host says this player killed it (a stake pins it, a blade flings it).
   * The body dies on the host's word, so what needs the corpse waits for that. Forgotten if the host never says so.
   */
  whenKilled(enemy: EnemyInstance, then: (enemy: EnemyInstance) => void): void {
    const list = this.onKill.get(enemy.uid);
    if (list) list.push(then);
    else this.onKill.set(enemy.uid, [then]);
  }

  // -------------------------------------------------------------------------------------------
  // Guest: what the host decided
  // -------------------------------------------------------------------------------------------

  /** Where the player in this slot is looking from, or null for the local player and the world. */
  private eyeOf(slot: number | undefined): THREE.Vector3 | null {
    const { lobby, remotes } = this.w.session;
    if (slot === undefined || slot < 0 || slot === lobby.me?.slot) return null;
    const player = lobby.players.find(p => p.slot === slot);
    const remote = player ? remotes.get(player.id) : undefined;
    if (!remote) return null;
    this.eye.copy(remote.char.root.position);
    this.eye.y += EYE;
    return this.eye;
  }

  private hitfxIn(value: Extract<HitEvent, { t: 'hitfx' }>): void {
    const { manager, ctx } = this.w;
    const enemy = this.replicas.enemy(value.u);
    // Not drawn here yet (this came reliably, its first state did not): kept a moment for it, not dropped.
    if (!enemy) { this.replicas.whenSeen(value.u, () => this.hitfxIn(value)); return; }
    if (!enemy.alive || this.replicas.dead.has(value.u)) return;
    const damage = unpackHit(value.d, enemy.char.rig.bones.length);
    const facts = unpackFacts(value.f, this.facts);
    if (!damage || !facts) return;
    if (Number.isFinite(value.h)) enemy.health = value.h / 10;
    if (Number.isFinite(value.a)) enemy.armor = value.a / 10;
    const result = manager.showDamage(enemy, damage, facts, this.eyeOf(value.by));
    // The world's own (bleeding, fire, a fall) has no round to land.
    if (!WORLD_SOURCES.includes(damage.source) && damage.source !== 'burn') ctx.combat.remoteHit?.(enemy, damage, result);
    this.seen.shown++;
  }

  private severIn(value: Extract<HitEvent, { t: 'sever' }>): void {
    const { manager, session, ctx } = this.w;
    const enemy = this.replicas.enemy(value.uid);
    if (!enemy) { this.replicas.whenSeen(value.uid, () => this.severIn(value)); return; }
    if (!REGIONS.includes(value.region) || enemy.char.severed.has(value.region)) return;
    const damage = unpackHit(value.d, enemy.char.rig.bones.length);
    if (!damage) return;
    const mine = value.by !== undefined && value.by === session.lobby.me?.slot;
    manager.showSever(enemy, value.region, damage, this.eyeOf(value.by), mine);
    // The shooter's own: the sound and the stop its gun gives a limb in single player. A teammate's is heard where it was
    // cut (the rip audio lays under every `enemy:severed`, which here is the shooter's news alone).
    if (mine) ctx.combat.severConfirm?.(damage.point);
    else if (enemy.def?.machine !== true) ctx.audio.play('limb_rip', { position: damage.point });
    this.seen.severs++;
  }

  private killIn(value: Extract<HitEvent, { t: 'kill' }>): void {
    const { manager, session, ctx } = this.w;
    if (this.replicas.dead.has(value.uid)) return;
    this.replicas.dead.add(value.uid);
    let enemy = this.replicas.enemy(value.uid);
    if (!enemy) {
      enemy = manager.spawn(value.id, new THREE.Vector3(...value.at)) ?? undefined;
      if (enemy) { enemy.uid = value.uid; enemy.yaw = value.yaw; }
    }
    const damage = enemy ? unpackHit(value.d, enemy.char.rig.bones.length) : null;
    // Whatever goes wrong drawing the death, the enemy is gone and the feed hears whose kill it was.
    try {
      if (enemy && damage) this.die(enemy, damage, value);
      else if (enemy) manager.withdraw(enemy);
    } finally {
      // Whose kill it was, for the kill feed (credit.ts).
      ctx.events.emit('coop:kill', { by: Number.isInteger(value.by) ? value.by! : -1, id: value.id, boss: enemy?.isBoss === true, head: value.head === true });
      this.toldKill.delete(value.uid);
      this.onKill.delete(value.uid);
      this.replicas.map.delete(value.uid);
    }
  }

  /** Guest: the host's death of this copy, drawn, and told to whoever's it was. */
  private die(enemy: Enemy, damage: DamageInfo, value: Extract<HitEvent, { t: 'kill' }>): void {
    const { manager, session, ctx } = this.w;
    {
      const mine = value.by !== undefined && value.by === session.lobby.me?.slot;
      const told = unpackKill(value.k);
      // The shooter drew the killing round itself, when it fired.
      if (mine && this.toldKill.has(value.uid)) told.wound = 0;
      manager.replayDeath(enemy, damage, value.gib, told, this.eyeOf(value.by));
      this.seen.kills++;
      if (mine) {
        // A kill this player's gun did not announce when it fired (the host knew better, or it is a man's wounds that
        // decided): the marker, the headshot's sound and the mist, now.
        if (!this.toldKill.has(value.uid)) {
          this.seen.lateKills++;
          ctx.combat.killConfirm?.(damage.point, value.head === true);
        }
        const then = this.onKill.get(value.uid);
        if (then) for (const run of then) run(enemy);
        // My own kill: my browser pays, scores and counts it, as the host's does its own.
        this.ownKill(enemy, damage, value.gib === true, value.head === true);
      } else {
        // Somebody else's killing round, where it landed: blood and the thud of it, or for a head its red mist. And what
        // the death sounds like there, which this player's own kills get from their `enemy:killed`.
        if ((told.wound ?? 0) > 0 && !WORLD_SOURCES.includes(damage.source)) ctx.combat.remoteHit?.(enemy, damage, value.head === true ? HEAD_KILL : BODY_KILL);
        if (enemy.def?.machine !== true && (value.gib === true || value.head === true)) killSounds(ctx.audio, enemy.center, value.gib === true);
      }
    }
  }

  private ownKill(enemy: Enemy, damage: DamageInfo, gibbed: boolean, headshot: boolean): void {
    const { ctx } = this.w;
    const p = ctx.player;
    const event: KillEvent = { enemy, damage, headshot, gibbed, sliced: !!damage.slicePlaneNormal, severedCount: enemy.char.severed.size,
      playerAirborne: !p.grounded, playerSliding: p.sliding, playerWallRunning: p.wallRunning, playerSpeed: p.speed,
      distance: enemy.position.distanceTo(p.position), explosionId: damage.explosionId ?? null };
    ctx.events.emit('enemy:killed', event);
  }

  /** Host: an enemy that blew itself up dies on the guests' screens too. */
  selfDestruct(enemy: Enemy): void {
    if (!this.w.hosting) return;
    this.w.send({ t: 'kill', uid: enemy.uid, id: enemy.id, at: enemy.position.toArray() as Vec, yaw: enemy.yaw, gib: true,
      d: packHit({ amount: enemy.health + 1, type: 'explosive', point: enemy.center, dir: UP, force: 300, source: enemy.id, gib: true }) });
  }

  update(now: number): void {
    if (this.w.hosting) return;
    for (const slot of this.pending) if (slot.live && now - slot.at > PENDING_MS) this.settle(slot);
    for (const [uid, at] of this.toldKill) if (now - at > PENDING_MS) this.toldKill.delete(uid);
    for (const uid of this.onKill.keys()) if (!this.replicas.map.has(uid)) this.onKill.delete(uid);
  }
}

const UP = new THREE.Vector3(0, 1, 0);
/** A round armour stopped, and a headshot that killed, as `Combat.remoteHit` reads them. */
const BLOCKED: DamageResult = { dealt: 0, killed: false, headshot: false, severed: [], blocked: true, armour: 'stopped' };
const HEAD_KILL: DamageResult = { dealt: 0, killed: true, headshot: true, severed: [], blocked: false };
const BODY_KILL: DamageResult = { dealt: 0, killed: true, headshot: false, severed: [], blocked: false };

/** What of a round is kept to show it again: where, how hard, with what. */
function copyDamage(out: DamageInfo, d: DamageInfo): void {
  out.amount = d.amount;
  out.type = d.type;
  out.point.copy(d.point);
  out.dir.copy(d.dir);
  out.force = d.force;
  out.source = d.source;
  out.region = d.region;
  out.bone = d.bone;
  out.load = d.load;
  out.pierces = d.pierces;
  out.armorPiercing = d.armorPiercing;
  out.severMult = d.severMult;
}
