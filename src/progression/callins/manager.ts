/**
 * Call-in ownership, targeting flow and running strikes.
 *
 * Reward rule from the first game: a call-in is offered on any kill where the combo is high enough, it is not already
 * held, and its cooldown is over. The combo is not consumed, so 12 and 15 stay reachable.
 */
import * as THREE from 'three';
import type { Action, Ctx } from '../../core/contracts';
import type { CallInId } from '../../core/gameplay';
import { ModelMaterials } from '../modelkit';
import { CALLIN_ORDER, CALLINS } from '../data';
import { Airstrike } from './airstrike';
import { BlackSun, blackSunMaterials } from './blacksun';
import { GroundProbe, groundMaterials } from './ground';
import { Nuke, NukeAftermath, nukeFrontMaterial } from './nuke';
import { Orbital, orbitalMaterials } from './orbital';
import { Ordnance } from './ordnance';
import type { Strike, StrikeKit, StrikeOrder } from './shared';
import { Targeting } from './targeting';
import { Warthog, warthogModel } from './warthog';

const KEYS: Readonly<Record<CallInId, Action>> = {
  airstrike: 'streak',
  warthog: 'callinWarthog',
  orbital: 'callinOrbital',
  blackSun: 'callinBlackSun',
  nuke: 'callinNuke',
};

const UNDRAWN_LAYER = 31;
/** Seconds between the device leaving and the gun being drawn. */
const GUN_BACK_DELAY = 0.16;

export class CallInManager {
  readonly held = new Set<CallInId>();
  readonly targeting: Targeting;
  private readonly kit: StrikeKit;
  private readonly cooldowns: Record<CallInId, number> = { airstrike: 0, warthog: 0, orbital: 0, blackSun: 0, nuke: 0 };
  private readonly strikes: Strike[] = [];
  private readonly aftermath: NukeAftermath;
  private readonly order: StrikeOrder = { point: new THREE.Vector3(), heading: new THREE.Vector3(1, 0, 0) };
  /** The Orbital Lance keeps the designator up and the gun away until it finishes or the player lets go. */
  private steering: Orbital | null = null;
  private holstered = false;
  private gunBackIn = 0;

  constructor(private readonly ctx: Ctx, materials: ModelMaterials) {
    const probe = new GroundProbe(ctx);
    const ordnance = new Ordnance(ctx, materials);
    const jet = warthogModel(materials);
    jet.visible = false;
    ctx.render.scene.add(jet);
    this.kit = { ctx, probe, materials, ordnance, jet };
    this.targeting = new Targeting(ctx);
    this.aftermath = new NukeAftermath(ctx);
    this.warmShaders(materials);
  }

  /**
   * Strikes build their materials on launch, and a program compiled then stalls the frame of the biggest moment in the
   * game. The renderer's compile pass at load only walks visible objects, so these stand on a layer no camera draws.
   */
  private warmShaders(models: ModelMaterials): void {
    const nothing = new THREE.BufferGeometry();
    const all = [
      models.solid, models.glow, ...groundMaterials(), ...Object.values(orbitalMaterials()), ...Object.values(blackSunMaterials()),
      nukeFrontMaterial(), ...this.aftermath.materials,
    ];
    for (const material of all) {
      const stand = new THREE.Mesh(nothing, material);
      stand.layers.set(UNDRAWN_LAYER);
      this.ctx.render.scene.add(stand);
    }
  }

  cooldown(id: CallInId): number {
    return this.cooldowns[id];
  }

  /** What the off hand should be holding. The viewmodel reads this through `progression.targeting`. */
  get aiming(): CallInId | null {
    return this.targeting.id ?? (this.steering ? 'orbital' : null);
  }

  /** Called on every kill with the combo after it. */
  offer(combo: number): void {
    for (const id of CALLIN_ORDER) {
      const def = CALLINS[id];
      if (combo >= def.combo && !this.held.has(id) && this.cooldowns[id] <= 0) this.grant(id);
    }
  }

  grant(id: CallInId): void {
    if (this.held.has(id)) return;
    this.held.add(id);
    this.ctx.audio.play(id === 'airstrike' ? 'perk_airstrike' : id === 'warthog' ? 'perk_warthog' : 'callin_ready');
    // The HUD stamps READY off this event, with the player's real key binding.
    this.ctx.events.emit('callin:ready', { id });
  }

  update(dt: number): void {
    for (const id of CALLIN_ORDER) if (this.cooldowns[id] > 0) this.cooldowns[id] = Math.max(0, this.cooldowns[id] - dt);

    if (this.ctx.player.alive) this.readKeys();

    const result = this.targeting.update(dt);
    if (result === 'cancel') this.leaveTargeting('callin_cancel');
    else if (result === 'confirm') this.confirm();

    this.kit.ordnance.update(this.ctx.time.dt);
    for (let i = this.strikes.length - 1; i >= 0; i--) {
      const strike = this.strikes[i]!;
      if (strike.update(dt)) {
        strike.dispose();
        this.strikes.splice(i, 1);
        if (strike === this.steering) this.lowerDevice();
      }
    }
    if (this.steering && this.ctx.input.pressed('aim')) {
      this.steering.release();
      this.lowerDevice();
    }

    if (this.holstered && !this.aiming) {
      this.gunBackIn -= dt;
      if (this.gunBackIn <= 0) this.drawGun();
    }
    this.aftermath.update(dt);
  }

  private readKeys(): void {
    const { input } = this.ctx;
    if (this.steering) return;
    for (const id of CALLIN_ORDER) {
      if (!input.pressed(KEYS[id])) continue;
      if (this.targeting.id === id) this.leaveTargeting('callin_cancel');
      else if (this.held.has(id)) this.enter(id);
      else this.deny(id);
      return;
    }
  }

  private deny(id: CallInId): void {
    const { audio, hud } = this.ctx;
    audio.play('callin_denied');
    const left = this.cooldowns[id];
    const def = CALLINS[id];
    // The first game failed silently here.
    hud.feed(left > 0 ? `${def.name} COOLDOWN ${Math.ceil(left)}s` : `${def.name} NOT READY`, def.color);
  }

  private enter(id: CallInId): void {
    const { audio, weapons } = this.ctx;
    audio.play('callin_confirm', { pitch: 1.3, volume: 0.6 });
    if (!this.holstered) {
      this.holstered = true;
      weapons.setHolstered(true);
    }
    this.targeting.enter(id);
  }

  private leaveTargeting(sound: string | null): void {
    if (sound) this.ctx.audio.play(sound);
    this.targeting.exit();
    this.lowerDevice();
  }

  /** The hand comes down, and the gun follows it up once it is out of the way. */
  private lowerDevice(): void {
    this.steering = null;
    this.gunBackIn = GUN_BACK_DELAY;
  }

  private drawGun(): void {
    this.holstered = false;
    this.ctx.weapons.setHolstered(false);
  }

  private confirm(): void {
    const id = this.targeting.id!;
    const def = CALLINS[id];
    const { audio, events } = this.ctx;
    this.order.point.copy(this.targeting.point);
    this.order.heading.copy(this.targeting.heading);
    this.held.delete(id);
    this.cooldowns[id] = def.cooldown;
    this.targeting.exit();
    audio.play('callin_confirm');
    const strike = this.launch(id);
    this.strikes.push(strike);
    if (strike instanceof Orbital) this.steering = strike;
    else this.lowerDevice();
    events.emit('callin:used', { id, position: this.order.point });
  }

  private launch(id: CallInId): Strike {
    switch (id) {
      case 'airstrike': return new Airstrike(this.kit, this.order);
      case 'warthog': return new Warthog(this.kit, this.order);
      case 'orbital': return new Orbital(this.kit, this.order, this.targeting);
      case 'blackSun': return new BlackSun(this.kit, this.order);
      case 'nuke': return new Nuke(this.kit, this.order, this.aftermath);
    }
  }

  /** The player died: nothing is left half-open, but strikes already called in still land. */
  onDeath(): void {
    if (this.targeting.id) this.leaveTargeting(null);
    this.steering?.release();
    this.steering = null;
    if (this.holstered) this.drawGun();
  }

  clear(): void {
    if (this.targeting.id) this.targeting.exit();
    this.steering = null;
    for (const strike of this.strikes) strike.dispose();
    this.strikes.length = 0;
    this.kit.ordnance.clear();
    this.aftermath.clear();
    this.held.clear();
    for (const id of CALLIN_ORDER) this.cooldowns[id] = 0;
    if (this.holstered) this.drawGun();
  }
}
