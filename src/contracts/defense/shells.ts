/**
 * Mortar rounds in flight, for both sides of Outpost Defense: the enemy's teams in the field pits and the player's own teams in the
 * middle ring. The Commander's tube is the model for all of it (enemies/commander/mortars.ts): the thump and flash at the tube, the
 * whistle timed so its tail is the landing, a ring on the floor before it lands, a scorch after. What this adds is the arc: a round
 * you can watch go up, with a smoke trail, and come down. What a landing does is the owner's `burst`.
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/contracts';
import { rand, TAU } from '../../core/math';

/** The whistle's length (`mortar_whistle`), so the last of it is the landing. */
const WHISTLE_LEAD = 2.05;
const RING_LEAD = 1.2;
const SMOKE_EVERY = 0.07;
const MAX_SHELLS = 20;

const _a = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export interface Shell {
  live: boolean;
  readonly from: THREE.Vector3;
  readonly to: THREE.Vector3;
  launchAt: number;
  landAt: number;
  apex: number;
  radius: number;
  damage: number;
  source: string;
  /** The floor ring's colour, or null for none. */
  ring: number | null;
  ringed: boolean;
  whistled: boolean;
  smokeAt: number;
  mesh: THREE.Mesh | null;
}

export interface ShellOrder {
  radius: number;
  damage: number;
  source: string;
  ring: number | null;
  /** Seconds in the air. */
  flight: number;
}

/** Where a round is `t` of the way along its flight: a parabola `apex` metres over the straight line. */
export function arcAt(from: THREE.Vector3, to: THREE.Vector3, apex: number, t: number, out: THREE.Vector3): THREE.Vector3 {
  out.lerpVectors(from, to, t);
  out.y += 4 * apex * t * (1 - t);
  return out;
}

export class Shells {
  readonly list: Shell[] = Array.from({ length: MAX_SHELLS }, () => ({
    live: false, from: new THREE.Vector3(), to: new THREE.Vector3(), launchAt: 0, landAt: 0, apex: 0, radius: 0, damage: 0, source: '',
    ring: null, ringed: false, whistled: false, smokeAt: 0, mesh: null,
  }));
  private geometry: THREE.SphereGeometry | null = null;
  private material: THREE.MeshBasicMaterial | null = null;

  /** `zone` draws a ring on the floor; `burst` is what a landing does to whoever is there. */
  constructor(
    private readonly ctx: Ctx,
    private readonly burst: (s: Shell) => void,
    private readonly zone: (at: THREE.Vector3, radius: number, seconds: number, color: number) => void,
  ) {}

  /** Out of the tube at `from`, onto `to`. False when every round is already in the air. */
  fire(from: THREE.Vector3, to: THREE.Vector3, order: ShellOrder, delay = 0): boolean {
    const s = this.list.find(x => !x.live);
    if (!s) return false;
    const now = this.ctx.time.elapsed;
    s.live = true;
    s.from.copy(from);
    s.to.copy(to);
    s.launchAt = now + delay;
    s.landAt = s.launchAt + order.flight;
    s.apex = Math.max(18, from.distanceTo(to) * 0.45);
    s.radius = order.radius;
    s.damage = order.damage;
    s.source = order.source;
    s.ring = order.ring;
    s.ringed = s.whistled = false;
    s.smokeAt = s.launchAt;
    if (delay <= 0) this.thump(from);
    else s.smokeAt = -s.launchAt;
    return true;
  }

  get flying(): number {
    let n = 0;
    for (const s of this.list) if (s.live) n++;
    return n;
  }

  update(): void {
    const now = this.ctx.time.elapsed;
    const { audio, fx } = this.ctx;
    for (const s of this.list) {
      if (!s.live) continue;
      if (now < s.launchAt) continue;
      // A delayed round thumps out of the tube when its time comes.
      if (s.smokeAt < 0) {
        s.smokeAt = now;
        this.thump(s.from);
      }
      if (s.ring !== null && !s.ringed && now >= s.landAt - RING_LEAD) {
        s.ringed = true;
        this.zone(s.to, s.radius, RING_LEAD, s.ring);
      }
      if (!s.whistled && now >= s.landAt - WHISTLE_LEAD) {
        s.whistled = true;
        audio.play('mortar_whistle', { position: s.to, pitch: rand(0.92, 1.08) });
      }
      if (now >= s.landAt) {
        this.land(s);
        continue;
      }
      const t = (now - s.launchAt) / (s.landAt - s.launchAt);
      arcAt(s.from, s.to, s.apex, t, _a);
      const mesh = (s.mesh ??= this.round());
      mesh.visible = true;
      mesh.position.copy(_a);
      if (now >= s.smokeAt) {
        s.smokeAt = now + SMOKE_EVERY;
        fx.smoke(_a, 0xb8b8b8, 0.9, 1.4);
      }
    }
  }

  private round(): THREE.Mesh {
    // A burning fuse, so a round reads against the night sky from the walls, a hundred metres off.
    this.geometry ??= new THREE.SphereGeometry(0.22, 8, 6);
    this.material ??= new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffa040).multiplyScalar(4), toneMapped: false, fog: false });
    const m = new THREE.Mesh(this.geometry, this.material);
    this.ctx.render.scene.add(m);
    return m;
  }

  private thump(at: THREE.Vector3): void {
    const { fx, audio, render } = this.ctx;
    _a.copy(at);
    _a.y += 1.4;
    fx.smoke(_a, 0x9aa2aa, 1.2, 1.2);
    render.lights.flash(_a, 0xffb060, 8, 9, 0.12);
    audio.play('mortar_tube', { position: _a });
  }

  private land(s: Shell): void {
    s.live = false;
    if (s.mesh) s.mesh.visible = false;
    this.burst(s);
    this.ctx.render.decals.add('scorch', s.to, _up, s.radius * 0.5, rand(0, TAU));
  }

  reset(): void {
    for (const s of this.list) {
      s.live = false;
      if (s.mesh) s.mesh.visible = false;
    }
  }
}
