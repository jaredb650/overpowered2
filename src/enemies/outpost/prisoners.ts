/**
 * Giving up, and what comes after it. Surrender used to be a morale bar and a coin, so men threw their hands up on one bad round in a
 * fight they were winning. Now a man has to look around and see that the fight has really turned.
 *
 * A man weighs five signs: his squad has collapsed, nobody is near him, his side is losing the field, he is out of ammunition, and he is
 * badly hurt. Rank says how many it takes. A round never decides it, because `hitAt` holds the judgement off until he has had a moment.
 *
 * Once kneeling he is not furniture. Shot and alive, he runs, because that was his answer. Friends firing nearby is the moment to go for his
 * gun or the gate. Left alone and out of sight, some men think again. And the player can get hold of him: tap E to question him, tap
 * again to let him go, hold E to cuff him, and the drone snatches him away (airlift.ts). The human shield (hold E to take him by the
 * collar and put him between you and his friends) is switched off by `HOSTAGES.on` for now.
 */
import * as THREE from 'three';
import type { PlayerDamage } from '../../core/contracts';
import { chance, clamp } from '../../core/math';
import type { AiWorld } from '../aiWorld';
import { finishAttack } from '../brain';
import { Airlift } from './airlift';
import { gesture, holdFill } from './capture';
import type { Outpost } from './index';
import { FEAR } from './morale';
import { pose, type Soldier } from './soldier';
import { soldierAttacks } from './weapons';

/** Seconds between a man's looks at how the fight is going. */
const JUDGE_EVERY = 1;
/** Seconds after being hit before he can decide anything. A round is never the reason. */
const HIT_GRACE = 2.5;
/** What the fight has to look like. */
const ISOLATED = 14;
const LOST_SHARE = 0.34;
const BADLY_HURT = 0.45;
/** Share of a failed look that keeps him from trying again soon. */
const AFTER_NO = 3;

/** Metres an ally's gunfire counts as a rescue, how fresh it must be, and how close his own gun must be to go for it. */
const RESCUE_RANGE = 24;
const RESCUE_FRESH = 2;
const GUN_REACH = 7;
const GOES_FOR_GUN = 0.55;
/** The player this close and looking, he stays on his knees whatever is going on. */
const STARED_DOWN = 4;
/** Seconds unwatched, and metres from the player, before he starts to feel safe. */
const SAFE_SECONDS = 6;
const SAFE_RANGE = 12;
/** Seconds before a man who decided against it looks again. */
const SAFE_LOOK_AGAIN = 15;
/** A prisoner left alone this long gets up and walks out. */
const PRISONER_SECONDS = 45;

/** Metres he can be reached from, and the cone he has to be in. */
const REACH = 3.1;
const REACH_COS = 0.55;
/** Seconds of holding the key on the man held by the collar that cuff him. Only with `HOSTAGES`. */
const CUFF_SECONDS = 0.6;
/**
 * The human shield (hold E: him by the collar, between you and his friends) is off for now (owner, 2026-11-15): hold E cuffs him
 * straight away. The grab and everything after it stay here, dormant; true brings them back, with hold E grabbing again.
 */
export const HOSTAGES = { on: false };
/** Seconds of holding the key on a man held by the collar that cuff him (the co-op guest's key reads it too). */
export const HOSTAGE_CUFF_SECONDS = CUFF_SECONDS;
/** The cone a held man covers, the place he is held, and the pace with him in front: a co-op guest's own screen applies the same. */
export const SHIELD = { coversCos: 0.42, forward: 1.0, side: 0.34, speed: 5.5, seconds: 14 } as const;

/** A player other than this browser's own who has a man by the collar (co-op host): where they stand and look, and whether they still can. */
export interface Holder {
  readonly position: THREE.Vector3;
  readonly forward: THREE.Vector3;
  readonly alive: boolean;
}
/** Where he is held, from the player, and how fast a man can go with someone in front of him. */
const HOLD_FORWARD = SHIELD.forward;
const HOLD_SIDE = SHIELD.side;
const HOLD_SPEED = SHIELD.speed;
/** Seconds before he twists free. */
const HOLD_SECONDS = SHIELD.seconds;
/** Cosine of the half angle he covers. Anything from outside it goes past him. */
const COVERS_COS = SHIELD.coversCos;
const PROMPT_COLOR = '#ffc14a';
const LIE_COLOR = '#ffc14a';
/** Seconds what he said stays on the map. */
const REVEAL_SECONDS = 9;
const MAX_MARKS = 4;
/** Letting one go is noticed. Each man freed moves the odds for the next, up to this. */
const MERCY_STEP = 0.06;
const MERCY_MAX = 0.24;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

export class Prisoners {
  /** The man this browser's own player has by the collar. */
  private mine: Soldier | null = null;
  /** Co-op host: the men other players have by the collar, by who holds them. */
  private readonly others = new Map<Holder, { s: Soldier; at: number }>();
  /** What the last question put on the map, for the co-op host to pass on (`prisoner:questioned`). */
  private readonly said: { at: THREE.Vector3; label: string }[] = [];
  /** Men let go this run. Word gets round. */
  freed = 0;
  /** Men shot on their knees this run. That gets round too (flight.ts). */
  executed = 0;
  private heldAt = 0;
  private focus: Soldier | null = null;

  /** A man some player has by the collar: this browser's own first. His friends hold their fire for it. */
  get held(): Soldier | null {
    if (this.mine) return this.mine;
    for (const hold of this.others.values()) return hold.s;
    return null;
  }
  private keyHeld = -1;
  private unprompt: (() => void) | null = null;
  private prompted = '';
  private readonly marks: (() => void)[] = [];
  private marksUntil = 0;
  private revealUntil = 0;
  private readonly lit: THREE.Object3D[] = [];
  /** Cuffed men and the drones that take them. */
  readonly airlift: Airlift;

  constructor(private readonly w: AiWorld, private readonly o: Outpost) {
    this.airlift = new Airlift(w, o);
  }

  init(): void {
    this.w.ctx.player.interceptor = d => this.intercept(d);
  }

  reset(): void {
    this.mine = this.focus = null;
    this.others.clear();
    this.freed = this.executed = 0;
    this.keyHeld = -1;
    this.clearPrompt();
    this.clearMarks();
    this.revealUntil = 0;
    this.airlift.reset();
  }

  // -------------------------------------------------------------------------------------------
  // Giving up
  // -------------------------------------------------------------------------------------------

  /** How many of the five signs he can see from where he stands. */
  signs(s: Soldier): number {
    const { o } = this;
    const e = s.e;
    const q = s.squad;
    let n = 0;
    if (q.fighters() * 2 <= q.strength) n++;
    let friends = 0;
    for (const m of o.soldiers) if (m !== s && m.fighting && m.e.position.distanceToSquared(e.position) < ISOLATED * ISOLATED) friends++;
    if (friends === 0) n++;
    if (o.hostile <= o.peakHostile * LOST_SHARE) n++;
    if (s.weapon !== 'primary' || (s.mag <= 0 && s.reserve <= 0)) n++;
    if (e.health < e.maxHealth * BADLY_HURT || s.injuries.condition === 'mortal') n++;
    return n;
  }

  /** The odds he takes it, once he has seen enough. */
  private willingness(s: Soldier): number {
    return clamp(s.rankDef.gives + Math.min(this.freed * MERCY_STEP, MERCY_MAX) * (s.rank === 'elite' ? 0 : 1));
  }

  /** A man takes stock. Runs on the morale tick. */
  judge(s: Soldier, now: number): void {
    const { o } = this;
    if (!s.fighting || now < s.judgeAt || !o.doctrine.surrender || s.squad.directed || s.state === 'steady') return;
    s.judgeAt = now + JUDGE_EVERY;
    if (now - s.hitAt < HIT_GRACE || this.signs(s) < s.rankDef.signs) return;
    if (chance(this.willingness(s))) o.collapse(s, 'surrender');
    else s.judgeAt = now + AFTER_NO;
  }

  /** His nerve has gone. Whether he stops or keeps running depends on what he can see. */
  fateOf(s: Soldier, now: number): 'surrender' | 'flee' {
    const ready = this.o.doctrine.surrender && now - s.hitAt >= HIT_GRACE && this.signs(s) >= s.rankDef.signs - 1;
    return ready && chance(this.willingness(s)) ? 'surrender' : 'flee';
  }

  // -------------------------------------------------------------------------------------------
  // On his knees
  // -------------------------------------------------------------------------------------------

  /** What a kneeling man makes of things. Runs on his think tick. */
  look(s: Soldier, now: number): void {
    const e = s.e;
    if (s.collared || s.cuffed) return;
    if (e.hasLos && e.dist < 40) s.watchedAt = now;
    if (now < s.judgeAt) return;
    s.judgeAt = now + JUDGE_EVERY;
    if (this.friendsFiring(s, now) && e.dist > STARED_DOWN) {
      if (s.droppedAt && s.droppedAt.distanceTo(e.position) < GUN_REACH && chance(GOES_FOR_GUN)) this.rearm(s);
      else this.bolt(s);
      return;
    }
    if (now - s.watchedAt > SAFE_SECONDS && e.dist > SAFE_RANGE) {
      if (chance(s.rankDef.rearms)) {
        if (s.droppedAt) this.rearm(s);
        else this.bolt(s);
        return;
      }
      s.judgeAt = now + SAFE_LOOK_AGAIN;
    }
    if (now - s.surrenderedAt > PRISONER_SECONDS) this.o.release(s);
  }

  private friendsFiring(s: Soldier, now: number): boolean {
    const r2 = RESCUE_RANGE * RESCUE_RANGE;
    for (const m of this.o.soldiers) {
      if (m.fighting && now - m.firedAt < RESCUE_FRESH && m.e.position.distanceToSquared(s.e.position) < r2) return true;
    }
    return false;
  }

  /** Back on his feet and no longer anyone's prisoner. */
  private free(s: Soldier): void {
    if (this.mine === s) this.drop();
    this.dropFrom(s);
    if (s.surrendered) {
      s.surrendered = false;
      this.o.prisoners--;
    }
    s.released = false;
    s.fake = null;
    // Whatever he does next, a run starts a fresh clock.
    s.fledAt = -1;
    s.e.thinkAt = 0;
    s.e.behaviourUntil = 0;
  }

  /** Up and running for the exit. */
  private bolt(s: Soldier): void {
    this.free(s);
    s.fate = 'flee';
    s.refused = true;
    this.o.comms.say('panic', s);
  }

  /** He goes for his gun, and if he gets there he is a soldier again. */
  private rearm(s: Soldier): void {
    const { o, w } = this;
    this.free(s);
    s.fate = 'none';
    s.scramble = s.droppedAt;
    s.morale = Math.max(s.morale, 62);
    s.scaredAt = w.now;
    s.state = 'shaken';
    s.e.attacks = soldierAttacks(s.e.id);
    o.rejoin(s);
    w.ctx.events.emit('prisoner:rearmed', { enemy: s.e });
  }

  /**
   * Shot on his knees and still breathing. He has his answer. This is read a frame after the hit, because a shotgun shell is eight hits
   * and every one of them has to land on a man with his hands up.
   */
  private refuse(s: Soldier): void {
    const { o, w } = this;
    this.free(s);
    s.fate = 'flee';
    s.refused = true;
    o.comms.say('refused', s);
    const r2 = 14 * 14;
    for (const m of o.soldiers) if (m !== s && m.fighting && m.e.position.distanceToSquared(s.e.position) < r2) o.scare(m, FEAR.execution * 0.5);
    w.ctx.events.emit('prisoner:refused', { enemy: s.e });
  }

  // -------------------------------------------------------------------------------------------
  // The collar
  // -------------------------------------------------------------------------------------------

  private grab(s: Soldier, holder: Holder | null = null): void {
    const { o, w } = this;
    const e = s.e;
    if (e.attack) finishAttack(e, w, true);
    if (holder) this.others.set(holder, { s, at: w.now });
    else {
      this.mine = s;
      this.heldAt = w.now;
      this.keyHeld = -1;
    }
    s.collared = true;
    e.carried = true;
    e.thinkAt = 0;
    e.behaviourUntil = 0;
    pose(e, 'handsUp');
    w.ctx.audio.play('body_thud', { position: e.center, volume: 0.6, pitch: 1.2 });
    w.ctx.events.emit('prisoner:grabbed', { enemy: e });
    const near = this.nearestFighter();
    if (near) o.comms.say('hostage', near);
  }

  private nearestFighter(): Soldier | null {
    let best: Soldier | null = null;
    let bestD = Infinity;
    for (const m of this.o.soldiers) {
      if (m.fighting && m.e.dist < bestD) {
        bestD = m.e.dist;
        best = m;
      }
    }
    return best;
  }

  /** The player's hands open, for whatever reason. */
  private drop(): void {
    const s = this.mine;
    this.mine = null;
    if (!s) return;
    s.e.carried = false;
    s.collared = false;
  }

  /** Co-op host: whoever else has `s` by the collar lets go of him. */
  private dropFrom(s: Soldier): void {
    for (const [holder, hold] of this.others) {
      if (hold.s !== s) continue;
      this.others.delete(holder);
      s.e.carried = false;
      s.collared = false;
    }
  }

  /** Co-op host: the man `holder` has by the collar, if any. */
  heldBy(holder: Holder): Soldier | null {
    return this.others.get(holder)?.s ?? null;
  }

  // -------------------------------------------------------------------------------------------
  // Co-op host: another player's key on a kneeling man (net/world/capture.ts). The host's own key is `keys`.
  // -------------------------------------------------------------------------------------------

  /** True for a man on his knees whom a key still means something to. */
  private kneeling(s: Soldier): boolean {
    return s.surrendered && !s.released && !s.cuffed && s.fate === 'surrender' && s.e.alive;
  }

  /** A tap: he is asked. False if he was already, or is no longer anyone's to ask. */
  questionFor(s: Soldier): boolean {
    if (!this.kneeling(s) || s.collared || s.questioned) return false;
    this.question(s);
    return true;
  }

  /** A second tap: he is let go. */
  releaseFor(s: Soldier): boolean {
    if (!this.kneeling(s) || s.collared || !s.questioned) return false;
    this.letGo(s);
    return true;
  }

  /** A hold: the cuffs. `holder` set: he was in their hands. */
  cuffFor(s: Soldier, holder: Holder | null = null): boolean {
    if (!this.kneeling(s)) return false;
    if (s.collared && (!holder || this.heldBy(holder) !== s)) return false;
    this.dropFrom(s);
    this.airlift.cuff(s);
    return true;
  }

  /** The human shield, for another player (only with `HOSTAGES.on`): `holder` takes him by the collar. */
  grabFor(s: Soldier, holder: Holder): boolean {
    if (!HOSTAGES.on || !this.kneeling(s) || s.collared || this.others.has(holder)) return false;
    this.grab(s, holder);
    return true;
  }

  /** `holder` opens their hands: the man is let go, as the host's own tap lets one go. */
  dropFor(holder: Holder): boolean {
    const s = this.heldBy(holder);
    if (!s) return false;
    this.letGo(s);
    return true;
  }

  /** A round `holder`'s own screen says the man in their hands took for them. */
  shieldHit(holder: Holder, amount: number, from: THREE.Vector3, source: string): void {
    const s = this.heldBy(holder);
    if (!s || !s.e.alive) return;
    const e = s.e;
    _a.subVectors(e.center, from).normalize();
    this.w.enemies.applyDamage(e, { amount, type: 'bullet', point: e.center, dir: _a, force: 0, source, region: 'chest' });
  }

  /** He is in the way of a round coming from the front. It hits him and it does not hit the player. */
  private intercept(d: PlayerDamage): boolean {
    const h = this.mine;
    if (!h || !d.from || (d.type !== 'bullet' && d.type !== 'pellet')) return false;
    const { player } = this.w.ctx;
    _a.subVectors(d.from, player.position).setY(0);
    const reach = _a.length();
    if (reach < 0.1) return false;
    _b.copy(player.forward).setY(0).normalize();
    if (_a.dot(_b) / reach < COVERS_COS) return false;
    const e = h.e;
    _a.subVectors(e.center, d.from).normalize();
    this.w.enemies.applyDamage(e, { amount: d.amount, type: 'bullet', point: e.center, dir: _a, force: 0, source: d.source, region: 'chest' });
    return true;
  }

  /** One of his own has the player in front of him. Whether that stops him depends on what he is. */
  stopsFire(s: Soldier): boolean {
    const { player, now } = this.w;
    let h = this.mine;
    let since = this.heldAt;
    // Co-op host: `player` is whoever this soldier is after, who may be the one with a man in front of them.
    for (const [holder, hold] of this.others) {
      if (holder.position.distanceToSquared(player.position) > 1) continue;
      h = hold.s;
      since = hold.at;
    }
    if (!h || h === s) return false;
    _a.subVectors(s.e.position, player.position).setY(0).normalize();
    _b.copy(player.forward).setY(0).normalize();
    if (_a.dot(_b) < COVERS_COS) return false;
    if (now - since < s.rankDef.hesitates) return true;
    this.o.comms.say('clearShot', s);
    return false;
  }

  /** Co-op host: each man another player holds stays in front of them; dead, down or out of time, he is free. */
  private carryOthers(): void {
    const now = this.w.now;
    for (const [holder, hold] of this.others) {
      const e = hold.s.e;
      if (!e.alive || !holder.alive || now - hold.at > HOLD_SECONDS) {
        this.dropFrom(hold.s);
        if (e.alive) this.bolt(hold.s);
        continue;
      }
      _b.copy(holder.forward).setY(0).normalize();
      const p = holder.position;
      e.position.set(p.x + _b.x * HOLD_FORWARD + _b.z * HOLD_SIDE, p.y, p.z + _b.z * HOLD_FORWARD - _b.x * HOLD_SIDE);
      e.groundY = p.y;
      e.yaw = Math.atan2(_b.x, _b.z);
    }
  }

  private carry(dt: number): void {
    if (this.others.size > 0) this.carryOthers();
    const h = this.mine;
    if (!h) return;
    const { w } = this;
    const { player } = w.ctx;
    if (!h.e.alive || !player.alive || player.parked || w.now - this.heldAt > HOLD_SECONDS) {
      const s = h;
      this.drop();
      if (s.e.alive) this.bolt(s);
      return;
    }
    const e = h.e;
    _b.copy(player.forward).setY(0).normalize();
    // Off to one side of the view, the way a man holds someone he means to shoot past.
    e.position.set(player.position.x + _b.x * HOLD_FORWARD + _b.z * HOLD_SIDE, player.position.y, player.position.z + _b.z * HOLD_FORWARD - _b.x * HOLD_SIDE);
    e.groundY = player.position.y;
    e.yaw = Math.atan2(_b.x, _b.z);
    const v = player.velocity;
    const speed = Math.hypot(v.x, v.z);
    // Written to velocity and not modifiers.speed, because progression rewrites that field every frame.
    if (speed > HOLD_SPEED) {
      const k = 1 - (1 - HOLD_SPEED / speed) * Math.min(1, dt * 14);
      v.x *= k;
      v.z *= k;
    }
  }

  /** Out of the player's hands and into cuffs. airlift.ts has him from here. */
  private cuff(s: Soldier): void {
    this.drop();
    this.keyHeld = -1;
    this.airlift.cuff(s);
  }

  // -------------------------------------------------------------------------------------------
  // Asking him
  // -------------------------------------------------------------------------------------------

  private question(s: Soldier): void {
    const { w } = this;
    s.questioned = true;
    const truthful = chance(s.rankDef.talks);
    this.clearMarks();
    this.said.length = 0;
    if (truthful) this.tell(s);
    else this.lie(s);
    w.ctx.audio.play('vox_pain', { position: s.e.center, volume: 0.5, pitch: 1.15 });
    w.ctx.events.emit('prisoner:questioned', { enemy: s.e, truthful, marks: this.said, seconds: REVEAL_SECONDS });
    // He has said too much to be any use to them, and he knows it.
    s.morale = Math.min(s.morale, 15);
  }

  /** Everyone still fighting, on the map and through the walls, for as long as his word holds. */
  private tell(s: Soldier): void {
    const { o, w } = this;
    const { ctx } = w;
    let told = '';
    let most = 0;
    let n = 0;
    for (const q of o.squads) {
      const men = q.fighters();
      if (men === 0 || n >= MAX_MARKS) continue;
      const lead = q.leader?.e ?? q.members[0]!.e;
      this.marks.push(ctx.hud.marker(lead.center.clone(), `${q.name} ${men}`, PROMPT_COLOR));
      this.said.push({ at: lead.center.clone(), label: `${q.name} ${men}` });
      n++;
      // He gives up what he thinks will save him: the biggest thing out there, and an ambush above anything.
      const worth = men + (q.goal === 'waylay' ? 10 : 0);
      if (worth <= most) continue;
      most = worth;
      const place = (ctx.world.zoneAt(lead.position)?.name ?? 'the yard').toLowerCase();
      told = q.goal === 'waylay' ? `${q.name}, ${men} men, waiting on the door by the ${place}!` : `${q.name}, ${men} men, by the ${place}!`;
    }
    o.comms.relay(n > 0 ? `${told} Please. That's all I know.` : 'There\'s nobody left! It\'s just me!', s, null);
    this.revealUntil = w.now + REVEAL_SECONDS;
    this.marksUntil = w.now + REVEAL_SECONDS;
  }

  /** A brave man, or a clever one. He names somewhere nobody is. */
  private lie(s: Soldier): void {
    const { o, w } = this;
    const { ctx } = w;
    const p = w.player.position;
    let far = 0;
    let at: THREE.Vector3 | null = null;
    for (const g of ctx.world.spawnPoints) {
      if (g.kind === 'air') continue;
      let clear = true;
      for (const m of o.soldiers) if (m.fighting && m.e.position.distanceToSquared(g.position) < 225) clear = false;
      const d = g.position.distanceTo(p);
      if (clear && d > far) {
        far = d;
        at = g.position;
      }
    }
    if (at) {
      const place = (ctx.world.zoneAt(at)?.name ?? 'yard').toLowerCase();
      this.marks.push(ctx.hud.marker(_a.copy(at).setY(at.y + 1.2).clone(), 'SQUAD?', LIE_COLOR));
      this.said.push({ at: _a.clone(), label: 'SQUAD?' });
      this.marksUntil = w.now + REVEAL_SECONDS;
      o.comms.relay(`They all pulled back to the ${place}! I swear!`, s, null);
    } else o.comms.relay('I don\'t know anything! I swear!', s, null);
  }

  private clearMarks(): void {
    for (const unmark of this.marks) unmark();
    this.marks.length = 0;
  }

  // -------------------------------------------------------------------------------------------
  // The key
  // -------------------------------------------------------------------------------------------

  private clearPrompt(): void {
    this.unprompt?.();
    this.unprompt = null;
    this.prompted = '';
  }

  private prompt(s: Soldier | null): void {
    const { hud, input } = this.w.ctx;
    if (!s) {
      if (this.unprompt) this.clearPrompt();
      return;
    }
    const key = `[${input.labelFor?.('interact') ?? 'E'}]`;
    const hold = `Hold ${key} to ${HOSTAGES.on ? 'grab' : 'capture'}`;
    const text = s === this.mine ? `${key} let go · Hold ${key} to capture` : `Tap ${key} to ${s.questioned ? 'release' : 'question'} · ${hold}`;
    if (text === this.prompted) return;
    this.clearPrompt();
    this.prompted = text;
    this.unprompt = hud.follow(s.e.center, text, PROMPT_COLOR);
  }

  private nearest(): Soldier | null {
    const p = this.w.player;
    let best: Soldier | null = null;
    let bestD = REACH;
    for (const s of this.o.soldiers) {
      if (!s.surrendered || s.released || s.collared || s.cuffed || s.fate !== 'surrender') continue;
      const d = s.e.position.distanceTo(p.position);
      if (d >= bestD) continue;
      _a.subVectors(s.e.center, p.eye).normalize();
      if (_a.dot(p.forward) < REACH_COS) continue;
      best = s;
      bestD = d;
    }
    return best;
  }

  private keys(dt: number): void {
    const { w } = this;
    const { input } = w.ctx;
    const target = this.mine ?? this.focus;
    if (input.pressed('interact') && target) this.keyHeld = 0;
    if (this.keyHeld < 0) return;
    if (!target) {
      this.keyHeld = -1;
      return;
    }
    const down = input.isDown('interact');
    if (down) this.keyHeld += dt;
    if (target === this.mine) {
      if (down && this.keyHeld >= CUFF_SECONDS) this.cuff(target);
      else if (!down) {
        this.keyHeld = -1;
        this.letGo(target);
      }
      return;
    }
    const g = gesture(this.keyHeld, down, target.questioned);
    if (down) w.ctx.hud.hold?.(holdFill(this.keyHeld));
    if (!g) return;
    this.keyHeld = -1;
    if (g === 'cuff') {
      if (HOSTAGES.on) this.grab(target);
      else this.cuff(target);
    } else if (g === 'letGo') this.letGo(target);
    else this.question(target);
  }

  private letGo(s: Soldier): void {
    const { o, w } = this;
    if (this.mine === s) this.drop();
    this.dropFrom(s);
    o.release(s);
    this.freed++;
    w.ctx.events.emit('prisoner:freed', { enemy: s.e });
  }

  update(dt: number): void {
    const { o, w } = this;
    const { ctx, now } = w;
    this.carry(dt);
    if (o.prisoners > 0 || this.mine || this.others.size > 0) {
      for (let i = o.soldiers.length - 1; i >= 0; i--) {
        const s = o.soldiers[i]!;
        if (s.surrendered && !s.collared && !s.cuffed && s.hitAt >= s.surrenderedAt) this.refuse(s);
      }
      this.focus = this.mine ? null : this.nearest();
      this.prompt(this.mine ?? this.focus);
      this.keys(dt);
    } else if (this.unprompt) this.clearPrompt();
    if (this.marks.length > 0 && now >= this.marksUntil) this.clearMarks();
    if (now < this.revealUntil) {
      const { lit } = this;
      lit.length = 0;
      for (const s of o.soldiers) if (s.fighting) lit.push(s.e.char.mesh);
      ctx.render.highlight(lit, PROMPT_COLOR, Math.min(1, (this.revealUntil - now) / 1.5));
    }
    this.airlift.update(dt);
  }

  /** The man he was. For a body that has gone: nothing of him stays held. */
  gone(s: Soldier): void {
    if (this.mine === s) this.drop();
    this.dropFrom(s);
    if (this.focus === s) this.focus = null;
    this.airlift.gone(s);
  }
}
