/**
 * The host's garrison (squad allies) on guests: the host sends where each stands every SEND_MS, stamped with its clock, and each
 * tracer they fire, capped per second; a guest draws bodies only (no AI, no colliders), each a little in the past between two of
 * those states (motion.ts, as the enemies are), and the tracers, which hurt nothing there.
 */
import * as THREE from 'three';
import type { CharacterInstance, Ctx } from '../../core/contracts';
import { ALLY_TYPES, type AllyType } from '../../allies/data';
import type { Enemy } from '../../enemies/Enemy';
import type { WorldContext, WorldModule } from './context';
import { HostClock, MotionBuffer, motionSample } from './motion';
import { postureOf, type Replicas } from './replicas';
import { POSTURES } from './snapshot';
import { validVec, type Vec } from './wire';

export type AlliesEvent =
  /** Host: the garrison, 5 Hz: [id, type index, x, y, z, yaw, state 0 up 1 down 2 dead, posture index], and the host's clock (ms). Drawn on guests. */
  | { t: 'allies'; at?: number; list: number[][] }
  /** Host: one of the garrison fired, for the guests' tracers. */
  | { t: 'ashot'; from: Vec; to: Vec };

const ALLY_KINDS = Object.keys(ALLY_TYPES) as AllyType[];
/** Garrison tracers mirrored per second, at most. */
const ASHOTS_PER_SECOND = 30;
const SEND_MS = 200;

export class Allies implements WorldModule {
  /** Guest: the garrison as drawn here, by the host's id. */
  readonly bodies = new Map<number, { char: CharacterInstance; type: AllyType; motion: MotionBuffer; state: number; posture: string }>();
  /** Guest: the host's clock from these events alone, used until the enemies' lane (many more packets) has a better one. */
  private readonly clock = new HostClock();
  private readonly sample = motionSample();
  private lastFrame = 0;
  private readonly ids = new WeakMap<object, number>();
  private serial = 0;
  private next = 0;
  private sent = false;
  private ashots = 0;
  private ashotSecond = 0;

  constructor(private readonly w: WorldContext, private readonly replicas: Replicas) {
    w.router.guest('allies', (value, _from, now) => this.draw(value, now));
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

  update(now: number): void {
    if (!this.w.hosting) this.animate(now, this.w.ctx.time.realDt);
    else if (now >= this.next) { this.next = now + SEND_MS; this.send(); }
  }

  /** Host: where the garrison stands, for the guests to draw. */
  private send(): void {
    const allies = (this.w.ctx.allies as unknown as { allies?: { body: Enemy; type: AllyType; state: string }[] } | undefined)?.allies;
    if (!allies?.length && !this.sent) return;
    this.sent = !!allies?.length;
    const round = (n: number) => Math.round(n * 100) / 100;
    const list = (allies ?? []).filter(a => a.state !== 'dead').slice(0, 24).map(a => {
      let id = this.ids.get(a);
      if (id === undefined) this.ids.set(a, id = ++this.serial);
      const p = a.body.position;
      return [id, ALLY_KINDS.indexOf(a.type), round(p.x), round(p.y), round(p.z), round(a.body.yaw), a.state === 'down' ? 1 : 0, POSTURES.indexOf(postureOf(a.body))];
    });
    this.w.send({ t: 'allies', at: Math.round(performance.now()), list });
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
        body = { char, type, motion: new MotionBuffer(), state: 0, posture: 'stand' };
        body.motion.interval = SEND_MS;
        this.bodies.set(id!, body);
      }
      body.motion.place(t, x!, y!, z!, yaw!);
      body.state = state!;
      body.posture = state === 1 ? 'downed' : POSTURES[posture!] ?? 'stand';
    }
    for (const [id, body] of this.bodies) if (!seen.has(id)) { body.char.release(); this.bodies.delete(id); }
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
    }
  }

  dispose(): void {
    for (const body of this.bodies.values()) body.char.release();
    this.bodies.clear();
  }
}
