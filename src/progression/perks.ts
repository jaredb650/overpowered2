/**
 * Perk and powerup runtime: activation, countdowns, stacking, and the single place that writes
 * weapons.modifiers and player.modifiers.
 *
 * Modifiers are rebuilt from the active list every frame instead of being toggled on start and end. Two effects that
 * touch the same field then can never leave it stale, and Overdrive can follow live speed for free.
 *
 * Timers run on time.realDt as the first game's did: durations stay true in SLOWMO, and the player's clock is the
 * one the player feels. update() only runs while playing, so pause holds them, which the first game got wrong.
 */
import type { Ctx } from '../core/contracts';
import type { ActiveEffect, PowerupId } from '../core/gameplay';
import { clamp, invLerp } from '../core/math';
import { EFFECTS, POWERUPS, SHOT_LAYERS, STACK, TRACER_ORDER, type EffectDef, type EffectId } from './data';

export interface EffectListener {
  onEffectStart?(id: EffectId): void;
  onEffectEnd?(id: EffectId): void;
}

const GRADE_BLEND = 0.25;
/** Slower back to neutral than into a perk, so an ending grade reads as a release and not a cut. */
const GRADE_RELEASE = 0.6;

export class PerkRunner {
  /** Live list in activation order. The HUD reads it directly. */
  readonly effects: ActiveEffect[] = [];
  private readonly pool = new Map<EffectId, ActiveEffect>();
  private readonly listeners: EffectListener[] = [];
  private grade: string = 'default';
  private wasInvulnerable = false;

  constructor(private readonly ctx: Ctx) {
    for (const id of Object.keys(EFFECTS) as EffectId[]) {
      const def = EFFECTS[id];
      this.pool.set(id, { id, label: def.label, color: def.color, remaining: 0, duration: def.seconds, stacks: 0 });
    }
  }

  listen(listener: EffectListener): void {
    this.listeners.push(listener);
  }

  isActive(id: EffectId): boolean {
    return this.pool.get(id)!.stacks > 0;
  }

  stacks(id: EffectId): number {
    return this.pool.get(id)!.stacks;
  }

  /** Starts an effect, or applies its retrigger rule when it already runs. */
  grant(id: EffectId): void {
    const def = EFFECTS[id];
    const effect = this.pool.get(id)!;

    if (effect.stacks > 0) {
      if (def.retrigger === 'ignore') return;
      effect.remaining = def.seconds;
      if (def.retrigger === 'stack' && effect.stacks < def.maxStacks) {
        effect.stacks++;
        // Silent at max stacks, as in the first game: the timer refreshes but nothing new happened.
        this.announce(def, effect.stacks);
      }
      return;
    }

    for (const l of this.listeners) l.onEffectStart?.(id);
    // One-shot powerups fire through the listener and never join the list.
    if (def.seconds <= 0) {
      this.announce(def, 1);
      this.ctx.events.emit('perk:start', { id, seconds: 0, label: def.label, color: def.color });
      this.ctx.events.emit('perk:end', { id });
      return;
    }
    effect.stacks = 1;
    effect.remaining = def.seconds;
    this.effects.push(effect);
    this.announce(def, 1);
    this.ctx.events.emit('perk:start', { id, seconds: def.seconds, label: def.label, color: def.color });
  }

  private announce(def: EffectDef, stacks: number): void {
    const { audio, camera, hud, render, time } = this.ctx;
    const m = def.moment;
    audio.play(def.sound);
    render.post.flash(def.color, m.flash[0], m.flash[1]);
    render.post.chromatic(m.chromatic[0], m.chromatic[1]);
    render.post.radialBlur(m.blur[0], m.blur[1]);
    camera.fovPunch(m.fov[0], m.fov[1]);
    camera.addTrauma(m.trauma);
    if (m.hitStop) time.hitStop(m.hitStop);
    hud.banner(stacks > 1 ? `${def.banner} x${stacks}` : def.banner, def.tagline, def.color);
  }

  update(dt: number): void {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i]!;
      e.remaining -= dt;
      if (e.remaining <= 0) this.end(i, true);
    }
    this.applyModifiers();
    this.applyGrade();
  }

  private end(index: number, audible: boolean): void {
    const effect = this.effects[index]!;
    const id = effect.id;
    this.effects.splice(index, 1);
    effect.stacks = 0;
    effect.remaining = 0;
    for (const l of this.listeners) l.onEffectEnd?.(id);
    this.ctx.events.emit('perk:end', { id });
    if (audible) this.ctx.audio.play(POWERUPS.includes(id as PowerupId) ? 'powerup_end' : 'perk_end');
  }

  /** Ends everything silently. For death and for a new run. */
  clear(): void {
    for (let i = this.effects.length - 1; i >= 0; i--) this.end(i, false);
    this.applyModifiers();
    this.applyGrade();
  }

  /** Drains the screen for the death sequence. A new run's clear() brings the neutral grade back. */
  showDeath(): void {
    this.grade = 'death';
    this.ctx.render.post.setGrade('death', GRADE_RELEASE);
  }

  private applyModifiers(): void {
    const { player, weapons } = this.ctx;
    const w = weapons.modifiers;
    const p = player.modifiers;
    const on = (id: EffectId) => this.pool.get(id)!.stacks > 0;
    const berserk = on('berserk');
    const hellfire = on('hellfire');
    const bloodthirst = on('bloodthirst');
    const haste = on('haste');

    let damage = 1;
    if (bloodthirst) damage *= STACK.damage.bloodthirst;
    if (berserk) damage *= STACK.damage.berserk;
    if (on('quad')) damage *= STACK.damage.quad;
    if (on('overdrive')) damage *= this.overdriveDamage();
    w.damage = damage;

    w.fireRate = (berserk ? STACK.fireRate.berserk : 1) * (haste ? STACK.fireRate.haste : 1);
    w.bottomlessMag = bloodthirst || berserk;
    w.pellets = (bloodthirst ? STACK.pellets.bloodthirst : 1) * (berserk ? STACK.pellets.berserk : 1);
    w.explosiveRounds = hellfire;
    w.blastRadius = hellfire ? STACK.hellfireBlast : 1;
    w.instakillBlast = hellfire;
    w.akimbo = berserk;
    w.ricochet = on('ricochet') ? STACK.ricochetBounces : 0;
    w.shockRounds = on('shock');
    w.alwaysSever = on('butcher');

    w.tracer = null;
    for (const id of TRACER_ORDER) {
      if (on(id)) {
        w.tracer = id;
        break;
      }
    }
    w.shotLayers.length = 0;
    for (const [id, sample] of SHOT_LAYERS) if (on(id)) w.shotLayers.push(sample);

    const adrenaline = 1 + this.pool.get('adrenaline')!.stacks * STACK.adrenalinePerStack;
    const speed = adrenaline * (berserk ? STACK.speed.berserk : 1) * (haste ? STACK.speed.haste : 1);
    p.speed = Math.min(speed, STACK.maxSpeed);
    // Written on the edge only: a debug god mode owns this flag the rest of the time.
    if (berserk !== this.wasInvulnerable) {
      this.wasInvulnerable = berserk;
      p.invulnerable = berserk;
    }
  }

  /** Damage multiplier at the player's current horizontal speed. */
  overdriveDamage(): number {
    const v = this.ctx.player.velocity;
    const t = invLerp(STACK.overdriveFloorSpeed, STACK.overdriveTopSpeed, Math.hypot(v.x, v.z));
    return 1 + clamp(t) * (STACK.overdriveMaxDamage - 1);
  }

  private applyGrade(): void {
    let best: EffectDef | null = null;
    for (const e of this.effects) {
      const def = EFFECTS[e.id];
      if (def.grade && (!best || def.gradeRank > best.gradeRank)) best = def;
    }
    const grade = best?.grade ?? 'default';
    if (grade === this.grade) return;
    this.grade = grade;
    this.ctx.render.post.setGrade(grade, grade === 'default' ? GRADE_RELEASE : GRADE_BLEND);
  }
}
