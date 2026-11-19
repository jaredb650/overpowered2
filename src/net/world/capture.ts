/**
 * Prisoners for every player (Endless Humans), as the game designs them: tap E on a kneeling man to question him, tap again to
 * let him go, hold E 0.4 s to capture him, with the same prompt and the same fill ring as the host's own key
 * (enemies/outpost/prisoners.ts, capture.ts). The men and what becomes of them are the host's. The snapshot marks a man who can
 * be reached CAPTURABLE; a guest's key sends `capture` with what it asked for; the host checks the guest stands by him and does
 * it through the same code its own key runs, so two players on one man are settled by whichever reaches the host first.
 * What he gives up when questioned is shown to the whole team; the bounty goes to whoever cuffed him.
 *
 * The human shield (hold E takes him by the collar) is switched off in the game (`HOSTAGES.on`, the owner's decision). It is
 * built here for the day it comes back: `grab`, `drop`, the held man following the guest on every screen, the guest's own
 * screen stopping rounds on him (`shield`) and walking at his pace.
 */
import * as THREE from 'three';
import type { PlayerDamage } from '../../core/contracts';
import type { Enemy } from '../../enemies/Enemy';
import { gesture, holdFill } from '../../enemies/outpost/capture';
import { HOSTAGE_CUFF_SECONDS, HOSTAGES, SHIELD, type Holder, type Prisoners } from '../../enemies/outpost/prisoners';
import { soldierOf } from '../../enemies/outpost/soldier';
import type { WorldContext, WorldModule } from './context';
import type { Late } from './late';
import type { Replica, Replicas } from './replicas';
import { CAPTURABLE } from './snapshot';
import type { Targeting } from './targeting';
import { validVec, type Vec } from './wire';

type Act = 'question' | 'release' | 'cuff' | 'grab' | 'drop' | 'shield';
const ACTS: readonly Act[] = ['question', 'release', 'cuff', 'grab', 'drop', 'shield'];

export type CaptureEvent =
  /**
   * Guest to host: my key on kneeling man `uid`. `act` absent is `cuff` (the older message). `drop`: I let go of the man I hold.
   * `shield`: the man I hold took a round of `amount` from `from` for me.
   */
  | { t: 'capture'; uid: number; act?: Act; amount?: number; from?: Vec; source?: string }
  /** Host to one guest: credits earned on the host's side for them (a prisoner's bounty). */
  | { t: 'credit'; amount: number; why: string }
  /**
   * Host to every guest: what became of a prisoner, and who did it (`slot`). `questioned` carries what he gave up: `marks`
   * ([x, y, z, label]) for `seconds`, and `reveal` when it was the truth (every fighting man lit through the walls).
   * `state`: for a player who has just arrived, the men already questioned and who holds whom.
   */
  | { t: 'prisoner'; op: 'questioned' | 'freed' | 'cuffed' | 'held' | 'dropped' | 'state'; uid: number; slot: number;
      marks?: [number, number, number, string][]; seconds?: number; reveal?: boolean; questioned?: number[]; holds?: [number, number][] };

/** Metres a guest may stand from the man its key is on, as the host sees the two bodies (the key's own reach is 3.1). */
const REACH_ON_HOST = 4.5;
const REACH = 3.1;
const REACH_COS = 0.55;
const PROMPT_COLOR = '#ffc14a';
const FEED_COLOR = '#79f1ad';
const KEYS_PER_SECOND = 20;
/** Postures of a man who is out of the fight: a question's reveal lights everyone else. */
const OUT_OF_IT = new Set(['handsUp', 'kneel', 'cower', 'cuffed', 'downed', 'drag']);

/** A man who has given up and can still be cuffed. */
export function capturable(enemy: Enemy): boolean {
  const s = soldierOf(enemy);
  return !!s && s.surrendered && !s.released && !s.collared && !s.cuffed && s.fate === 'surrender';
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

export class Capture implements WorldModule {
  /** Host: who cuffed each prisoner (lobby id), so the bounty reaches them. */
  private readonly captors = new Map<number, string>();
  /** Host: the guest whose key is being carried out right now, and who holds whom (lobby id to uid). */
  private acting: string | null = null;
  private readonly holds = new Map<string, number>();
  private readonly spent = new Map<string, { second: number; n: number }>();
  /** Guest: seconds E has been down on a man, the prompt over him, the men already questioned, and the man in this player's hands. */
  private keyHeld = -1;
  private prompt: { uid: number; text: string; off: () => void } | null = null;
  private readonly questioned = new Set<number>();
  private readonly held = new Map<number, number>();
  private holding = -1;
  private before: ((damage: PlayerDamage) => boolean) | null = null;
  /** Guest: what the last man questioned put on the map. */
  private marks: (() => void)[] = [];
  private marksUntil = 0;
  private revealUntil = 0;
  private readonly lit: THREE.Object3D[] = [];

  /** `late` (host): keeps a guest's key for a moment when it arrives before that guest's body does (world/late.ts). */
  constructor(private readonly w: WorldContext, private readonly replicas: Replicas, private readonly targeting: Targeting, private readonly late?: Late) {
    const { ctx, session } = w;
    if (w.hosting) {
      // A guest's prisoner: the host's purse was paid by the drone, so the bounty goes on to the guest who cuffed him.
      w.listen('prisoner:secured', e => {
        const captor = this.captors.get(e.enemy.uid);
        this.captors.delete(e.enemy.uid);
        if (!captor || captor === session.lobby.you || !(e.bounty > 0)) return;
        // The captor may have dropped or reloaded since the cuff: the team pays their seat (team.ts `payee`), or nobody.
        const to = w.team.payee(captor, e.bounty);
        if (to === undefined) return;
        const wallet = ctx.contracts?.wallet as { credits?: number; earned?: number } | null | undefined;
        if (wallet && typeof wallet.credits === 'number') { wallet.credits -= e.bounty; if (typeof wallet.earned === 'number') wallet.earned -= e.bounty; }
        if (to) w.send({ t: 'credit', amount: e.bounty, why: 'PRISONER BOUNTY' }, to);
      });
      // What becomes of a prisoner on the host, by anyone's key, is news for every screen.
      w.listen('prisoner:questioned', e => this.tell({ t: 'prisoner', op: 'questioned', uid: e.enemy.uid, slot: this.slot(),
        marks: (e.marks ?? []).slice(0, 8).map(m => [m.at.x, m.at.y, m.at.z, m.label]), seconds: e.seconds ?? 9, reveal: e.truthful }));
      w.listen('prisoner:freed', e => this.tell({ t: 'prisoner', op: 'freed', uid: e.enemy.uid, slot: this.slot() }));
      w.listen('prisoner:cuffed', e => this.tell({ t: 'prisoner', op: 'cuffed', uid: e.enemy.uid, slot: this.slot() }));
      w.listen('prisoner:grabbed', e => this.tell({ t: 'prisoner', op: 'held', uid: e.enemy.uid, slot: this.slot() }));
    }
    w.router.host('capture', (value, from, now) => {
      if (this.late) this.late.with(from, now, 'capture', (_remote, at) => this.keyIn(value, from, at));
      else this.keyIn(value, from, now);
    });
    w.router.guest('credit', value => {
      const amount = Number.isFinite(value.amount) ? Math.max(0, Math.min(1e6, Math.round(value.amount))) : 0;
      const wallet = ctx.contracts?.wallet;
      if (amount && wallet) { wallet.earn(amount); ctx.hud.feed(`+${amount} CREDITS: ${String(value.why).slice(0, 24).toUpperCase()}`, '#ffc14a'); }
    });
    w.router.guest('prisoner', value => this.newsIn(value));
  }

  private get prisoners(): Prisoners | null {
    return (this.w.manager as unknown as { outpost?: { captives?: Prisoners } } | undefined)?.outpost?.captives ?? null;
  }

  private tell(event: CaptureEvent, to?: string): void {
    if (this.w.ready) this.w.send(event, to);
  }

  /** Host: the slot of whoever's key is being carried out: a guest's, or the host's own. */
  private slot(): number {
    const { lobby } = this.w.session;
    return lobby.players.find(p => p.id === (this.acting ?? lobby.you))?.slot ?? 0;
  }

  // ---- Host --------------------------------------------------------------------------------------------------------

  /** Host: a guest as someone who can hold a man: the same stand-in the enemies aim at (targeting.ts), one per player. */
  private holder(id: string): Holder | null {
    return this.targeting.players().find(target => target.id === id)?.player ?? null;
  }

  /** Host: a guest's key. It is theirs to use if they are up, stand by the man, and he is still on his knees. */
  private keyIn(value: Extract<CaptureEvent, { t: 'capture' }>, from: string, now: number): void {
    const { ctx, session } = this.w;
    const prisoners = this.prisoners;
    const remote = this.w.sender(from, now);
    const act: Act = value.act === undefined ? 'cuff' : value.act;
    if (!prisoners || !remote || !ACTS.includes(act) || this.w.life(from).down) return;
    let s = this.spent.get(from);
    if (!s) this.spent.set(from, s = { second: 0, n: 0 });
    const second = Math.floor(now / 1000);
    if (second !== s.second) { s.second = second; s.n = 0; }
    if (++s.n > KEYS_PER_SECOND) return;
    const holder = this.holder(from);
    this.acting = from;
    try {
      if (act === 'drop') { if (holder) prisoners.dropFor(holder); return; }
      if (act === 'shield') {
        if (holder && Number.isFinite(value.amount) && value.amount! > 0 && validVec(value.from)) {
          prisoners.shieldHit(holder, Math.min(500, value.amount!), new THREE.Vector3(...value.from), String(value.source ?? 'coop').slice(0, 32));
        }
        return;
      }
      const enemy = ctx.enemies.alive.find(e => e.uid === value.uid) as Enemy | undefined;
      const soldier = enemy ? soldierOf(enemy) : null;
      if (!enemy || !soldier || enemy.position.distanceTo(remote.char.root.position) > REACH_ON_HOST) return;
      const inHand = !!holder && prisoners.heldBy(holder) === soldier;
      if (act === 'question') prisoners.questionFor(soldier);
      else if (act === 'release') prisoners.releaseFor(soldier);
      else if (act === 'grab') { if (holder) prisoners.grabFor(soldier, holder); }
      else if (inHand || capturable(enemy)) {
        // The bounty is the captor's (above). The cuffs are the drone's own, as for the host's key.
        this.captors.set(enemy.uid, from);
        if (prisoners.cuffFor(soldier, inHand ? holder : null)) {
          const name = session.lobby.players.find(p => p.id === from)?.name ?? 'A teammate';
          ctx.hud.feed(`${name} cuffed a prisoner`, FEED_COLOR);
        } else this.captors.delete(enemy.uid);
      }
    } finally {
      this.acting = null;
    }
  }

  /** Host: who holds whom, kept for the guests: a hold that ended (he twisted free, died, was cuffed) is told as `dropped`. */
  private hostHolds(): void {
    const prisoners = this.prisoners;
    if (!prisoners) return;
    for (const target of this.targeting.players()) {
      const uid = prisoners.heldBy(target.player)?.e.uid ?? -1;
      const was = this.holds.get(target.id) ?? -1;
      if (uid === was) continue;
      const slot = this.w.session.lobby.players.find(p => p.id === target.id)?.slot ?? 0;
      if (was >= 0) this.tell({ t: 'prisoner', op: 'dropped', uid: was, slot });
      if (uid >= 0) this.holds.set(target.id, uid);
      else this.holds.delete(target.id);
    }
  }

  /** Host: for a player who has just arrived: which kneeling men have been questioned, and who holds whom. */
  catchUp(id: string): void {
    if (!this.w.hosting) return;
    const questioned: number[] = [];
    for (const enemy of this.w.ctx.enemies.alive) if (soldierOf(enemy as Enemy)?.questioned) questioned.push(enemy.uid);
    const holds: [number, number][] = [];
    for (const [holder, uid] of this.holds) holds.push([uid, this.w.session.lobby.players.find(p => p.id === holder)?.slot ?? 0]);
    if (questioned.length || holds.length) this.tell({ t: 'prisoner', op: 'state', uid: -1, slot: 0, questioned: questioned.slice(0, 64), holds }, id);
  }

  // ---- Guest -------------------------------------------------------------------------------------------------------

  private newsIn(value: Extract<CaptureEvent, { t: 'prisoner' }>): void {
    const { ctx, session } = this.w;
    const uid = value.uid, me = session.lobby.me?.slot;
    const who = session.lobby.players.find(p => p.slot === value.slot)?.name ?? 'A teammate';
    switch (value.op) {
      case 'questioned': {
        if (!Number.isInteger(uid)) return;
        this.questioned.add(uid);
        for (const off of this.marks) off();
        this.marks = [];
        const seconds = Number.isFinite(value.seconds) ? Math.max(0, Math.min(30, value.seconds!)) : 9;
        if (Array.isArray(value.marks)) for (const m of value.marks.slice(0, 8)) {
          if (!Array.isArray(m) || !validVec(m.slice(0, 3))) continue;
          this.marks.push(ctx.hud.marker(new THREE.Vector3(m[0], m[1], m[2]), String(m[3] ?? '').slice(0, 24), PROMPT_COLOR));
        }
        this.marksUntil = ctx.time.elapsed + seconds;
        if (value.reveal === true) this.revealUntil = ctx.time.elapsed + seconds;
        const enemy = this.replicas.enemy(uid);
        if (enemy) ctx.audio.play('vox_pain', { position: enemy.center, volume: 0.5, pitch: 1.15 });
        if (value.slot !== me) ctx.hud.feed(`${who} questioned a prisoner`, FEED_COLOR);
        break;
      }
      case 'freed':
        this.questioned.delete(uid);
        this.unhold(uid);
        if (value.slot !== me) ctx.hud.feed(`${who} let a prisoner go`, FEED_COLOR);
        break;
      case 'cuffed':
        this.unhold(uid);
        // The captor reads what the host's own screen says for its own cuff.
        ctx.hud.feed(value.slot === me ? 'PRISONER CUFFED' : `${who} cuffed a prisoner`, FEED_COLOR);
        break;
      case 'held':
        if (!Number.isInteger(uid)) return;
        this.held.set(uid, value.slot);
        if (value.slot === me) this.take(uid);
        break;
      case 'dropped':
        this.unhold(uid);
        break;
      case 'state':
        this.questioned.clear();
        if (Array.isArray(value.questioned)) for (const id of value.questioned.slice(0, 64)) if (Number.isInteger(id)) this.questioned.add(id);
        this.held.clear();
        if (Array.isArray(value.holds)) for (const h of value.holds.slice(0, 4)) if (Array.isArray(h) && Number.isInteger(h[0])) this.held.set(h[0], h[1]);
        break;
    }
  }

  /** Guest: this player has a man by the collar: rounds from the front stop on him, on this screen, where they land. */
  private take(uid: number): void {
    const { player } = this.w.ctx;
    this.holding = uid;
    this.keyHeld = -1;
    this.before = player.interceptor;
    player.interceptor = damage => this.shield(damage) || (this.before?.(damage) ?? false);
  }

  private unhold(uid: number): void {
    this.held.delete(uid);
    if (this.holding !== uid) return;
    this.holding = -1;
    this.w.ctx.player.interceptor = this.before;
    this.before = null;
  }

  /** Guest: a round from the front hits the man in this player's hands, not the player. The host is told, and he takes it there. */
  private shield(damage: PlayerDamage): boolean {
    if (this.holding < 0 || !damage.from || (damage.type !== 'bullet' && damage.type !== 'pellet')) return false;
    const { player } = this.w.ctx;
    _a.subVectors(damage.from, player.position).setY(0);
    const reach = _a.length();
    if (reach < 0.1) return false;
    _b.copy(player.forward).setY(0).normalize();
    if (_a.dot(_b) / reach < SHIELD.coversCos) return false;
    this.w.send({ t: 'capture', uid: this.holding, act: 'shield', amount: damage.amount, from: damage.from.toArray() as Vec, source: damage.source });
    return true;
  }

  /** The nearest kneeling man in reach and in view, as the host's own key finds one. */
  private nearest(): Replica | null {
    const { player } = this.w.ctx;
    let best: Replica | null = null;
    let bestD = REACH;
    if (player.alive && !player.parked) for (const replica of this.replicas.map.values()) {
      if (!(replica.to.flags & CAPTURABLE)) continue;
      const d = replica.enemy.position.distanceTo(player.position);
      if (d >= bestD) continue;
      _a.subVectors(replica.enemy.center, player.eye).normalize();
      if (_a.dot(player.forward) < REACH_COS) continue;
      best = replica; bestD = d;
    }
    return best;
  }

  private show(replica: Replica | null, text: string): void {
    const uid = replica?.enemy.uid ?? -1;
    if (this.prompt && (this.prompt.uid !== uid || this.prompt.text !== text)) { this.prompt.off(); this.prompt = null; }
    if (replica && !this.prompt) this.prompt = { uid, text, off: this.w.ctx.hud.follow(replica.enemy.center, text, PROMPT_COLOR) };
  }

  /** Guest: the E key on a kneeling man, read exactly as the host's own is (prisoners.ts `keys`, capture.ts `gesture`). */
  private key(dt: number): void {
    const { player, input, hud } = this.w.ctx;
    const mine = this.holding >= 0 ? this.replicas.map.get(this.holding) ?? null : null;
    if (this.holding >= 0 && (!mine || !player.alive)) this.unhold(this.holding);
    const target = mine ?? this.nearest();
    if (!target) { this.show(null, ''); this.keyHeld = -1; return; }
    const uid = target.enemy.uid;
    const key = `[${input.labelFor?.('interact') ?? 'E'}]`;
    const hold = `Hold ${key} to ${HOSTAGES.on ? 'grab' : 'capture'}`;
    this.show(target, mine ? `${key} let go · Hold ${key} to capture` : `Tap ${key} to ${this.questioned.has(uid) ? 'release' : 'question'} · ${hold}`);
    if (input.pressed('interact')) this.keyHeld = 0;
    if (this.keyHeld < 0) return;
    const down = input.isDown('interact');
    if (down) this.keyHeld += dt;
    if (mine) {
      if (down && this.keyHeld >= HOSTAGE_CUFF_SECONDS) { this.keyHeld = -1; this.w.send({ t: 'capture', uid, act: 'cuff' }); }
      else if (!down) { this.keyHeld = -1; this.w.send({ t: 'capture', uid, act: 'drop' }); }
      return;
    }
    const g = gesture(this.keyHeld, down, this.questioned.has(uid));
    if (down) hud.hold?.(holdFill(this.keyHeld));
    if (!g) return;
    this.keyHeld = -1;
    this.w.send({ t: 'capture', uid, act: g === 'cuff' ? (HOSTAGES.on ? 'grab' : 'cuff') : g === 'letGo' ? 'release' : 'question' });
  }

  /** Guest: with a man in front of them a player goes at his pace, as the host's own does (prisoners.ts `carry`). */
  private pace(dt: number): void {
    const v = this.w.ctx.player.velocity;
    const speed = Math.hypot(v.x, v.z);
    if (speed <= SHIELD.speed) return;
    const k = 1 - (1 - SHIELD.speed / speed) * Math.min(1, dt * 14);
    v.x *= k;
    v.z *= k;
  }

  /** Guest: what a questioned man gave up stays on the map for its seconds, and the truth lights every fighting man through the walls. */
  private reveal(): void {
    const { ctx } = this.w;
    const now = ctx.time.elapsed;
    if (this.marks.length > 0 && !(now < this.marksUntil)) { for (const off of this.marks) off(); this.marks = []; }
    if (!(now < this.revealUntil)) return;
    const { lit } = this;
    lit.length = 0;
    for (const replica of this.replicas.map.values()) {
      if (!soldierOf(replica.enemy) && !['trooper', 'gunner', 'sniper', 'rocketeer', 'riot'].includes(replica.enemy.id)) continue;
      if (!OUT_OF_IT.has(replica.to.posture) && !(replica.to.flags & CAPTURABLE)) lit.push(replica.enemy.char.mesh);
    }
    ctx.render.highlight(lit, PROMPT_COLOR, Math.min(1, (this.revealUntil - now) / 1.5));
  }

  update(): void {
    if (this.w.hosting) { this.hostHolds(); return; }
    const dt = this.w.ctx.time.dt;
    this.key(dt);
    if (this.holding >= 0) this.pace(dt);
    this.reveal();
    // A man who is gone takes his place in the lists with him.
    if (this.questioned.size > 32) for (const uid of this.questioned) if (!this.replicas.map.has(uid)) this.questioned.delete(uid);
  }

  dispose(): void {
    this.prompt?.off();
    for (const off of this.marks) off();
    if (this.holding >= 0) this.unhold(this.holding);
  }
}
