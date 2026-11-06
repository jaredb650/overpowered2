/**
 * Targeting mode. The first game's lasted one frame because the same held button started and confirmed it.
 *
 * Here the key enters, a fresh press confirms, RMB cancels. The Warthog adds one thing: holding the click pins the
 * corridor and dragging swings its heading, while a plain click keeps the first game's across-the-view run.
 */
import * as THREE from 'three';
import { CG, type Ctx, type LoopHandle } from '../../core/contracts';
import type { CallInId } from '../../core/gameplay';
import { AIRSTRIKE, BLACK_SUN, CALLINS, WARTHOG } from '../data';
import { GroundRing, GroundStrip } from './ground';

const MAX_RANGE = 420;
/** Surfaces flatter than this count as ground. Anything steeper drops the aim to the floor below it. */
const GROUND_NORMAL = 0.35;
/** Drag this far from the pin before the heading follows the mouse. */
const DRAG_DEADZONE = 4;
const DANGER = '#ff2020';

const _below = new THREE.Vector3(0, -1, 0);
const _from = new THREE.Vector3();
const _d = new THREE.Vector3();

export type TargetingResult = 'none' | 'confirm' | 'cancel';

export class Targeting {
  id: CallInId | null = null;
  /** False when aiming at the sky. */
  valid = false;
  readonly point = new THREE.Vector3();
  readonly heading = new THREE.Vector3(1, 0, 0);
  /** Set while the Warthog's corridor is pinned and the mouse is swinging it. */
  dragging = false;

  private readonly pin = new THREE.Vector3();
  private readonly aim = new THREE.Vector3();
  private readonly ring: GroundRing;
  private readonly strip: GroundStrip;
  private hum: LoopHandle | null = null;
  private clock = 0;

  constructor(private readonly ctx: Ctx) {
    this.ring = new GroundRing(ctx);
    this.strip = new GroundStrip(ctx);
  }

  enter(id: CallInId): void {
    this.id = id;
    this.valid = false;
    this.dragging = false;
    this.hum?.stop(0.05);
    this.hum = this.ctx.audio.startLoop('callin_target_loop');
  }

  exit(): void {
    this.id = null;
    this.dragging = false;
    this.ring.hide();
    this.strip.hide();
    this.hum?.stop(0.1);
    this.hum = null;
  }

  /**
   * Where the crosshair lands on the map. Writes `out` and returns false for the sky, the fix for a first-game strike
   * that landed at world origin whenever the aim missed the floor.
   */
  solve(out: THREE.Vector3): boolean {
    const { physics, player } = this.ctx;
    const hit = physics.raycast(player.eye, player.forward, MAX_RANGE, CG.World);
    if (!hit) return false;
    if (hit.normal.y >= GROUND_NORMAL) {
      out.copy(hit.point);
      return true;
    }
    _from.copy(hit.point).addScaledVector(hit.normal, 0.6);
    const floor = physics.raycast(_from, _below, 120, CG.World);
    if (!floor) return false;
    out.copy(floor.point);
    return true;
  }

  private acrossView(out: THREE.Vector3): void {
    const f = this.ctx.player.forward;
    out.set(-f.z, 0, f.x);
    if (out.lengthSq() < 1e-4) out.set(1, 0, 0);
    out.normalize();
  }

  update(dt: number): TargetingResult {
    const id = this.id;
    if (!id) return 'none';
    const { input } = this.ctx;
    this.clock += dt;

    if (this.dragging) {
      if (input.pressed('aim')) {
        this.dragging = false;
        this.ctx.audio.play('callin_cancel');
      } else {
        if (this.solve(this.aim)) {
          _d.subVectors(this.aim, this.pin).setY(0);
          if (_d.length() > DRAG_DEADZONE) this.heading.copy(_d.normalize());
        }
        this.point.copy(this.pin);
        this.valid = true;
        this.drawPreview(id);
        return input.released('fire') ? 'confirm' : 'none';
      }
    }

    if (input.pressed('aim')) return 'cancel';

    this.valid = this.solve(this.point);
    this.acrossView(this.heading);
    this.drawPreview(id);

    if (!input.pressed('fire')) return 'none';
    if (!this.valid) {
      this.ctx.audio.play('callin_denied');
      return 'none';
    }
    if (id === 'warthog') {
      this.pin.copy(this.point);
      this.dragging = true;
      return 'none';
    }
    return 'confirm';
  }

  private drawPreview(id: CallInId): void {
    if (!this.valid) {
      this.ring.hide();
      this.strip.hide();
      return;
    }
    const def = CALLINS[id];
    const inside = this.ctx.player.position.distanceTo(this.point) < def.radius && id !== 'nuke';
    const color = inside ? DANGER : def.color;
    const opacity = 0.8 + Math.sin(this.clock * 7) * 0.15;
    if (id === 'warthog') {
      this.strip.show(this.point, this.heading, WARTHOG.length, (WARTHOG.scatter + WARTHOG.shellRadius) * 2, WARTHOG.scatter / (WARTHOG.scatter + WARTHOG.shellRadius));
      this.strip.setColor(def.color);
      this.strip.setOpacity(opacity);
      this.strip.tick(this.clock);
      return;
    }
    const inner = id === 'airstrike' ? AIRSTRIKE.scatter : id === 'blackSun' ? BLACK_SUN.implodeRadius : 0;
    this.ring.show(this.point, def.radius, inner);
    this.ring.setColor(color);
    this.ring.setOpacity(opacity);
    this.ring.tick(this.clock);
  }

  /** True when the blast would catch the player. The HUD hint warns on it. */
  get dangerClose(): boolean {
    return !!this.id && this.valid && this.id !== 'nuke' && this.ctx.player.position.distanceTo(this.point) < CALLINS[this.id].radius;
  }
}
