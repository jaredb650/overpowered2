/**
 * The host's garrison (squad allies) on guests: the host sends where each stands every SEND_MS, stamped with its clock, and each
 * tracer they fire, capped per second; a guest draws bodies only (no AI, no colliders), each a little in the past between two of
 * those states (motion.ts, as the enemies are), and the tracers, which hurt nothing there.
 *
 * A guest gives them orders as the host's player does, with the same key and the same prompts (allies/orders.ts, run here on
 * stand-ins for the bodies): a tap sends one man after the guest or back to his post, a hold the squad, and a longer hold on
 * a man who is down puts the guest's own stim into him. Each is asked of the host (`aorder`), which checks the guest is in
 * reach and does it; a man told to follow a guest follows that guest. A stim the host could not use comes back (`arefund`).
 */
import * as THREE from 'three';
import type { CharacterInstance, Ctx } from '../../core/contracts';
import type { Ally } from '../../allies/ally';
import { ALLY, ALLY_TEXT, ALLY_TYPES, type AllyType } from '../../allies/data';
import { Orders } from '../../allies/orders';
import type { PlayerSystem } from '../../core/contracts';
import type { Enemy } from '../../enemies/Enemy';
import type { WorldContext, WorldModule } from './context';
import { ListParts, SIDE, sendList } from './sideList';
import { HostClock, MotionBuffer, motionSample } from './motion';
import { postureOf, type Replicas } from './replicas';
import { POSTURES } from './snapshot';
import type { Targeting } from './targeting';
import { validVec, type Vec } from './wire';

export type AlliesEvent =
  /** Host: the garrison, 5 Hz: [id, type index, x, y, z, yaw, state (bit 0 down, bit 1 following a player), posture index], and the host's clock (ms). Drawn on guests. */
  | { t: 'allies'; at?: number; list: number[][] }
  /** Host: one of the garrison fired, for the guests' tracers. */
  | { t: 'ashot'; from: Vec; to: Vec }
  /** Guest to host: my E on man `id` (`toggle`: follow me or back to your post; `revive`: my stim is in him), or held for the squad. */
  | { t: 'aorder'; k: 'toggle' | 'squad' | 'revive'; id?: number }
  /** Host to one guest: the stim you spent on a man could not be used (he was up, dead or out of reach): have it back. */
  | { t: 'arefund' };

const ALLY_KINDS = Object.keys(ALLY_TYPES) as AllyType[];
/** Garrison tracers mirrored per second, at most. */
const ASHOTS_PER_SECOND = 30;
const SEND_MS = 200;
/** A guest's orders a second, at most, and the slack (m) on reach for where the host has that guest standing. */
const ORDERS_PER_SECOND = 6;
const REACH_SLACK = 3;

/** The host's allies system, as far as a guest's order needs it. */
interface AllySystem {
  allies?: Ally[];
  toggle(a: Ally, by: PlayerSystem | null): void;
  toggleSquad(by: PlayerSystem | null): void;
  reviveBy(a: Ally): boolean;
}
type Body = { char: CharacterInstance; type: AllyType; motion: MotionBuffer; state: number; posture: string; stand: Ally };

export class Allies implements WorldModule {
  /** Guest: the garrison as drawn here, by the host's id. */
  readonly bodies = new Map<number, Body>();
  /** Guest: the E key on the garrison, the game's own (allies/orders.ts), on stand-ins for the bodies drawn here. */
  private readonly orders: Orders | null;
  private readonly stands: Ally[] = [];
  private readonly standIds = new Map<Ally, number>();
  /** Host: each guest's orders this second. For the proofs: orders a guest has asked and the host has carried out. */
  private readonly asked = new Map<string, { second: number; n: number }>();
  readonly counts = { asked: 0, done: 0, refunds: 0 };
  /** Guest: the host's clock from these events alone, used until the enemies' lane (many more packets) has a better one. */
  private readonly clock = new HostClock();
  private readonly sample = motionSample();
  private lastFrame = 0;
  private readonly ids = new WeakMap<object, number>();
  private serial = 0;
  private next = 0;
  private readonly parts = new ListParts();
  private sent = false;
  private ashots = 0;
  private ashotSecond = 0;

  constructor(private readonly w: WorldContext, private readonly replicas: Replicas, private readonly targeting: Targeting) {
    // The state rides the unreliable lane in parts (sideList.ts); a whole list is drawn as it always was.
    w.side(SIDE.allies, (value, now) => {
      const whole = this.parts.take(value);
      if (whole) this.draw({ t: 'allies', at: whole.at, list: whole.list as number[][] }, now);
    });
    w.router.guest('allies', (value, _from, now) => this.draw(value, now));
    w.router.host('aorder', (value, from, now) => this.orderIn(value, from, now));
    w.router.guest('arefund', () => {
      this.counts.refunds++;
      this.stims()?.give?.(1);
    });
    const { ctx } = w;
    this.orders = w.hosting ? null : new Orders(ctx, {
      allies: this.stands,
      get stims() { return (ctx.progression as unknown as { stims?: { count: number; spend(): boolean } }).stims ?? null; },
      toggle: a => {
        this.ask('toggle', a);
        ctx.audio.play('ui_confirm', { volume: 0.6 });
        ctx.hud.floatText?.(a.body.center.clone().setY(a.body.center.y + 1.1), a.order === 'follow' ? 'HOLDING POST' : 'ON ME', ALLY_TEXT);
      },
      toggleSquad: () => {
        this.ask('squad', null);
        ctx.hud.feed(this.stands.some(a => a.state === 'up' && a.order === 'post') ? 'SQUAD: ON ME' : 'SQUAD: BACK TO POSTS', ALLY_TEXT);
        ctx.audio.play('ui_confirm', { volume: 0.8 });
      },
      playerRevive: a => {
        const kit = this.stims();
        if (a.state !== 'down') return false;
        if (kit && !kit.spend()) {
          ctx.audio.play('ui_error');
          ctx.hud.feed('NO STIMS', ALLY_TEXT);
          return false;
        }
        this.ask('revive', a);
        return true;
      },
    });
    w.router.guest('ashot', value => {
      if (validVec(value.from) && validVec(value.to)) w.ctx.fx.tracer(new THREE.Vector3(...value.from), new THREE.Vector3(...value.to), 'bullet');
    });
  }

  /** Host: an ally fired. Guests draw the tracer; it hurts nothing there. */
  allyShot(from: THREE.Vector3, to: THREE.Vector3): void {
    if (!this.w.hosting || !this.w.ready) return;
    const second = Math.floor(performance.now() / 1000);
    if (second !== this.ashotSecond) { this.ashotSecond = second; this.ashots = 0; }
    if (++this.ashots <= ASHOTS_PER_SECOND) this.w.send({ t: 'ashot', from: from.toArray() as Vec, to: to.toArray() as Vec });
  }

  private stims(): { count: number; spend(): boolean; give?(n: number): number } | null {
    return (this.w.ctx.progression as unknown as { stims?: { count: number; spend(): boolean; give?(n: number): number } }).stims ?? null;
  }

  /** Guest: asks the host for what the E key just meant. */
  private ask(k: 'toggle' | 'squad' | 'revive', a: Ally | null): void {
    this.counts.asked++;
    const id = a ? this.standIds.get(a) : undefined;
    this.w.send(id === undefined ? { t: 'aorder', k } : { t: 'aorder', k, id });
  }

  /** Host: a guest's order, checked (their body is here and up, the man is in their reach, not a flood) and carried out. */
  private orderIn(value: Extract<AlliesEvent, { t: 'aorder' }>, from: string, now: number): void {
    const refund = (): void => { if (value.k === 'revive') this.w.send({ t: 'arefund' }, from); };
    const remote = this.w.sender(from, now);
    const system = this.w.ctx.allies as unknown as AllySystem | undefined;
    const leader = this.targeting.players().find(p => p.id === from)?.player;
    if (!remote || !leader || !system?.allies || this.w.life(from).down) return refund();
    const second = Math.floor(now / 1000);
    const rate = this.asked.get(from) ?? { second, n: 0 };
    if (rate.second !== second) { rate.second = second; rate.n = 0; }
    this.asked.set(from, rate);
    if (++rate.n > ORDERS_PER_SECOND) return refund();
    const at = remote.char.root.position;
    if (value.k === 'squad') {
      if (!system.allies.some(a => !a.detached && a.state === 'up' && a.body.position.distanceTo(at) < ALLY.squadReach + REACH_SLACK)) return;
      system.toggleSquad(leader);
      this.counts.done++;
      return;
    }
    const a = system.allies.find(a => this.ids.get(a) === value.id);
    if (!a || a.body.position.distanceTo(at) > ALLY.reach + REACH_SLACK) return refund();
    if (value.k === 'toggle') system.toggle(a, leader);
    else if (value.k !== 'revive' || !system.reviveBy(a)) return refund();
    this.counts.done++;
  }

  update(now: number): void {
    if (!this.w.hosting) {
      this.animate(now, this.w.ctx.time.realDt);
      this.orders?.update(this.w.ctx.time.playerDt ?? this.w.ctx.time.realDt);
    } else if (now >= this.next) { this.next = now + SEND_MS; this.send(); }
  }

  /** Host: where the garrison stands, for the guests to draw. */
  private send(): void {
    const allies = (this.w.ctx.allies as unknown as { allies?: { body: Enemy; type: AllyType; state: string; order?: string; leader?: PlayerSystem | null }[] } | undefined)?.allies;
    if (!allies?.length && !this.sent) return;
    // A man following a friend who has left the match follows the host again.
    if (allies?.some(a => a.leader)) {
      const here = this.targeting.players();
      for (const a of allies) if (a.leader && !here.some(p => p.player === a.leader)) a.leader = null;
    }
    this.sent = !!allies?.length;
    const round = (n: number) => Math.round(n * 100) / 100;
    const list = (allies ?? []).filter(a => a.state !== 'dead').slice(0, 24).map(a => {
      let id = this.ids.get(a);
      if (id === undefined) this.ids.set(a, id = ++this.serial);
      const p = a.body.position;
      return [id, ALLY_KINDS.indexOf(a.type), round(p.x), round(p.y), round(p.z), round(a.body.yaw), (a.state === 'down' ? 1 : 0) | (a.order === 'follow' ? 2 : 0), POSTURES.indexOf(postureOf(a.body))];
    });
    sendList(this.w, SIDE.allies, Math.round(performance.now()), list);
  }

  /** Guest: the host's garrison as bodies only: no AI, no colliders, moved toward each update. */
  private draw(value: Extract<AlliesEvent, { t: 'allies' }>, now: number): void {
    const { ctx } = this.w;
    if (!Array.isArray(value.list)) return;
    const stamped = typeof value.at === 'number' && Number.isFinite(value.at);
    const t = stamped ? value.at! : now;
    if (stamped) this.clock.observe(t, now); else this.clock.observe(now, now);
    const seen = new Set<number>();
    const lib = ctx.characters as Ctx['characters'] & { arm?(c: CharacterInstance, kit: readonly { model: string; socket: string }[], stance: string): void };
    for (const row of value.list.slice(0, 24)) {
      if (!Array.isArray(row) || row.length !== 8 || !row.every(Number.isFinite)) continue;
      const [id, typeIndex, x, y, z, yaw, state, posture] = row as number[];
      const type = ALLY_KINDS[typeIndex!];
      if (!type || !validVec([x, y, z])) continue;
      seen.add(id!);
      let body = this.bodies.get(id!);
      if (!body || body.type !== type) {
        body?.char.release();
        let char: CharacterInstance;
        try { char = ctx.characters.spawn(ALLY_TYPES[type].wears.model); } catch { continue; }
        lib.arm?.(char, ALLY_TYPES[type].wears.kit, ALLY_TYPES[type].wears.stance);
        ctx.render.scene.add(char.root);
        char.root.position.set(x!, y!, z!);
        char.root.rotation.y = yaw!;
        // What the E key reads of him (allies/orders.ts): where he is, whether he is down, what he was last told.
        const stand = { state: 'up', order: 'post', detached: false, def: ALLY_TYPES[type], body: { position: char.root.position, center: new THREE.Vector3() } } as unknown as Ally;
        this.standIds.set(stand, id!);
        body = { char, type, motion: new MotionBuffer(), state: 0, posture: 'stand', stand };
        body.motion.interval = SEND_MS;
        this.bodies.set(id!, body);
      }
      body.motion.place(t, x!, y!, z!, yaw!);
      body.state = state! & 1;
      body.posture = body.state === 1 ? 'downed' : POSTURES[posture!] ?? 'stand';
      body.stand.state = body.state === 1 ? 'down' : 'up';
      body.stand.order = (state! & 2) !== 0 ? 'follow' : 'post';
    }
    for (const [id, body] of this.bodies) if (!seen.has(id)) { body.char.release(); this.standIds.delete(body.stand); this.bodies.delete(id); }
    this.stands.length = 0;
    for (const body of this.bodies.values()) this.stands.push(body.stand);
  }

  private animate(now: number, dt: number): void {
    const frame = Math.max(0, Math.min(250, now - this.lastFrame));
    this.lastFrame = now;
    const clock = this.replicas.clock.empty ? this.clock : this.replicas.clock;
    if (clock.empty) return;
    const hostNow = clock.now(now), jitter = clock.jitter;
    for (const body of this.bodies.values()) {
      const root = body.char.root;
      const s = body.motion.advance(frame, hostNow, jitter, this.sample);
      if (s.mode === 2) continue;
      root.position.set(s.x, s.y, s.z);
      root.rotation.y = s.yaw;
      root.visible = true;
      // His gait from how fast the host's man is really moving between states, not from this frame's step.
      const speed = Math.min(8, Math.hypot(s.vx, s.vz));
      (body.char.anim as unknown as { setPosture?(p: string): void }).setPosture?.(body.posture);
      body.char.anim.setLocomotion({ speed, moveX: 0, moveZ: speed > 0.1 ? 1 : 0, aimYaw: 0, aimPitch: 0, grounded: true });
      body.char.anim.update(dt, 0);
      root.updateMatrixWorld(true);
      body.stand.body.center.set(s.x, s.y + (body.state === 1 ? 0.4 : 1.2), s.z);
    }
  }

  dispose(): void {
    this.orders?.reset();
    for (const body of this.bodies.values()) body.char.release();
    this.bodies.clear();
    this.stands.length = 0;
    this.standIds.clear();
  }
}

/** For a peer that is behind: which of this module's events may be left out (net/pressure.ts). A fact never is. */
export const ALLIES_WIRE: import('../pressure').WireClasses<AlliesEvent> = { allies: 'latest', ashot: 'cosmetic' };
