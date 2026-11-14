/**
 * Sounds that follow from an event rather than from any one system's logic. Audio hears every event, so the
 * layers that make a fight read by ear live here: casings, hit confirmation, the wet detail under a kill, armor
 * and combo stingers, and fire on burning bodies. Whoever owns the action keeps playing its main sound.
 */
import { Vector3 } from 'three';
import {
  CG, type AudioSystem, type Ctx, type DamageInfo, type DamageType, type GameEvents, type LoopHandle, type PlayOptions, type RayHit,
  type SurfaceKind,
} from '../core/contracts';
import type { DamageResult, EnemyId, EnemyInstance } from '../core/gameplay';
import type { ZoneId } from '../enemies/wounds/rules';
import { clamp, lerp, rand } from '../core/math';
import { WEAPONS } from '../weapons/data';
import { ALLY_SOURCE } from '../allies/data';
import type { RoomId } from './reverb';
import { DEAD_HANDLE } from './voices';

const CASINGS: Record<GameEvents['fx:casing']['kind'], string> = {
  pistol: 'casing_brass', rifle: 'casing_brass', shotgun: 'casing_shotgun', cannon: 'casing_heavy',
};

/** An SMG's brass bounces 60 times a second. That much tinkle is rain, so the quiet bounces give way. */
const CASING_GAP = 0.05;
const CASING_LOUD = 0.6;
/** Well under the SMG's 75 ms, so every bullet gets its tick. */
const MARKER_GAP = 0.04;
const COMBO_WORTH_MOURNING = 3;
/** Pickups have their own sounds. Below this a heal is a tick of something like Regen. */
const REGEN_TICK_MAX = 8;
const REGEN_TICK_GAP = 0.5;
/** Burning bodies heard at once. The 3D pool has to keep room for gunfire. */
const FIRE_SLOTS = 4;
const FIRE_RANGE = 50;
const FIRE_SCAN_SECONDS = 0.25;

interface FireSlot {
  enemy: EnemyInstance | null;
  uid: number;
  handle: LoopHandle;
}

const isMachine = (e: EnemyInstance) => e.id === 'skitter' || e.id === 'drone';

/** Landings past this range are never worth a voice. */
const LANDING_RANGE = 55;
/**
 * Landings heard per second and how many can arrive at once. Gore already spaces each body out, so this is what stands
 * between a pile of forty bodies and the mixer. A burst of a few reads as a body hitting the floor; more reads as rain.
 */
const LANDING_RATE = 9;
const LANDING_BURST = 5;
/** How far below a landing to look for what it landed on. */
const SURFACE_PROBE = 1.6;
/** Strength past which a landing adds its second, wetter layer. */
const WET_LAYER_AT = 0.55;
/** Share of hard body landings that also slide. */
const DRAG_CHANCE = 0.3;
const DRAG_AT = 0.7;
/** Share of organ landings that leave a drip behind. */
const DRIP_CHANCE = 0.35;
const HARD_SURFACES: ReadonlySet<SurfaceKind> = new Set<SurfaceKind>(['metal', 'grate', 'armor']);
/**
 * A contact under this strength is a ragdoll rolling or sliding, not landing: a short knock, `ragdoll_bump`, instead of a
 * whole body fall played quietly. Organs are wet at any speed and keep their own sounds.
 */
const BUMP_BELOW = 0.25;
/**
 * Knocks heard per second and at once, apart from the landings' budget. Gore spaces each body's contacts out (`cooldown`
 * in gore/impacts.ts), so this is the cap over a pile of them: a few knocks a second read as weight, more as a drum.
 */
const BUMP_RATE = 6;
const BUMP_BURST = 3;

/** A wound that slows a man, and one that ends his fight. A heart or a head kills him, and the kill is the sound. */
const MINOR_ZONES: ReadonlySet<ZoneId> = new Set<ZoneId>(['thigh', 'hand', 'arm', 'shoulder']);
const CRIPPLING_ZONES: ReadonlySet<ZoneId> = new Set<ZoneId>(['innerThigh', 'gut', 'lung', 'spine', 'pelvis', 'carotid']);
const ARTERIES: ReadonlySet<ZoneId> = new Set<ZoneId>(['innerThigh', 'carotid']);
/** A hole in the lung or the throat takes the voice with it, as the wound system's `mute` does. */
const VOICELESS: ReadonlySet<ZoneId> = new Set<ZoneId>(['lung', 'carotid']);
/** Shortest gap between two arterial sprays anywhere, so a swarm losing limbs is not one long hiss. */
const SPRAY_GAP = 1.2;

/** Distant noises, so a quiet moment says the building is alive and failing. The open air zones stay open. */
const ROOM_NOISES: Partial<Record<RoomId, string>> = {
  foundry: 'metal_groan', refinery: 'steam_burst', transit: 'metal_groan', core: 'metal_groan',
};
const NOISE_EVERY: readonly [number, number] = [14, 32];
const NOISE_RANGE: readonly [number, number] = [22, 45];

/** A bomber's blast hurts its friends. Only what the player did gets confirmed. */
const ENEMY_SOURCES: ReadonlySet<string> = new Set<EnemyId>([
  'husk', 'trooper', 'gunner', 'brute', 'stalker', 'rocketeer', 'sniper', 'riot', 'leaper', 'bomber', 'burner', 'warden',
  'skitter', 'drone', 'juggernaut', 'titan',
]);
/** Not the player's: the enemy's own, or an ally's (src/allies), whose hits and kills are never confirmed to the player. */
const notPlayers = (source: string): boolean => ENEMY_SOURCES.has(source) || ALLY_SOURCE.test(source);

/**
 * Rounds that get a body hit. Every strike of these is one Combat plays aloud. Blasts, blades, fire and arcs strike
 * quietly and have their own sounds, and a rocket's contact is the first frame of its explosion.
 */
const BODY_HIT_TYPES: ReadonlySet<DamageType> = new Set<DamageType>(['bullet', 'pellet']);
/** Weight 0 is a Buzzsaw round and 1 a full Lance or a stake, on a log scale, because the ear hears weight as ratios. */
const LIGHT_ROUND = 12;
const HEAVY_ROUND = 240;
/** A shotgun blast is one hit to the ear and only its first pellet is played, so that pellet stands for most of the load. */
const PELLET_LOAD = 4;
/** Push counts as this much damage, so a slow heavy round weighs what it hits like, and a point-blank shotgun the most. */
const FORCE_WEIGHT = 2;
/**
 * Shortest gap between body hits: every SMG round at 800 a minute lands, even when 60 fps puts two of them 4 frames apart,
 * and the rotary cannon's 25 a second become a beat of about 18.
 */
const HIT_GAP = 0.055;
const HIT_GAP_LIGHT = 0.12;
/** Weights under this are spaced toward HIT_GAP_LIGHT. The SMG is 0.25. */
const LIGHT_BELOW = 0.2;
/** A machine's weight goes under its clank, which carries the metal: quieter and a little lower. */
const MACHINE_PUNCH = 0.6;
const MACHINE_PITCH = 0.85;

/** How heavy a round lands, 0 to 1, from what the hit already carries. */
export function hitWeight(amount: number, type: DamageType, force: number): number {
  const mass = Math.max(type === 'pellet' ? amount * PELLET_LOAD : amount, force * FORCE_WEIGHT);
  if (!(mass > LIGHT_ROUND)) return 0;
  return clamp(Math.log(mass / LIGHT_ROUND) / Math.log(HEAVY_ROUND / LIGHT_ROUND));
}

export interface BodyHitLevels {
  /** `hit_punch`, 3D at the hit. Heavier is louder and lower, so it is longer too. */
  punchVolume: number;
  punchPitch: number;
  /** `hit_confirm`, 2D. */
  confirmVolume: number;
  confirmPitch: number;
  /** Seconds before the next body hit may sound. */
  gap: number;
}

/** Levels for a weight. Measured against the SMG shot in docs/notes/audio.md, "Body hits". */
export function bodyHitLevels(weight: number): BodyHitLevels {
  const w = clamp(weight);
  return {
    punchVolume: lerp(0.62, 1.2, w),
    punchPitch: lerp(1.55, 1.05, w),
    confirmVolume: lerp(0.55, 1, w),
    confirmPitch: lerp(1.12, 0.9, w),
    gap: lerp(HIT_GAP_LIGHT, HIT_GAP, clamp(w / LIGHT_BELOW)),
  };
}

export class Reactions {
  private readonly o: PlayOptions = {};
  private readonly noiseAt = new Vector3();
  private noiseClock = NOISE_EVERY[0];
  private readonly fires: FireSlot[] = Array.from({ length: FIRE_SLOTS }, () => ({ enemy: null, uid: -1, handle: DEAD_HANDLE }));
  private fireClock = 0;
  private lastCasing = -1;
  private lastMarker = -1;
  private lastBodyHit = -1;
  /** The frame's body hit, played at its end unless a headshot lands on the same frame. */
  private held = false;
  private heldMachine = false;
  private heldKill = false;
  private heldLevels: BodyHitLevels = bodyHitLevels(0);
  private readonly heldAt = new Vector3();
  private lastRegen = -1;
  private lastCombo = 0;
  private armor = 0;
  private landingTokens = LANDING_BURST;
  private bumpTokens = BUMP_BURST;
  /** The worst wound named this frame, played at its end in place of the crunch, unless he died of it. */
  private wound: 'wound_minor' | 'wound_crippling' | null = null;
  private woundEnemy: EnemyInstance | null = null;
  /** Men gone mortal or down this frame, who get their dying line at its end. */
  private readonly dying: EnemyInstance[] = [];
  /** Men who have had their dying line, or have no voice left to have it with. */
  private readonly voiced = new Set<number>();
  private lastSpray = -SPRAY_GAP;
  private readonly probeFrom = new Vector3();
  private readonly probeDown = new Vector3(0, -1, 0);
  private readonly probeHit: RayHit = { point: new Vector3(), normal: new Vector3(), distance: 0, surface: 'concrete', collider: null };

  constructor(private readonly ctx: Ctx, private readonly audio: AudioSystem) {
    const { events } = ctx;
    events.on('fx:casing', e => this.onCasing(e));
    events.on('combo:changed', e => this.onCombo(e.combo));
    events.on('enemy:hit', e => this.onHit(e));
    events.on('enemy:severed', e => this.onSevered(e));
    events.on('enemy:killed', e => this.onKilled(e));
    events.on('gore:impact', e => this.onLanding(e));
    events.on('enemy:wounded', e => this.onWounded(e));
    events.on('enemy:condition', ({ enemy, condition }) => {
      if ((condition === 'mortal' || condition === 'downed') && !this.voiced.has(enemy.uid)) this.dying.push(enemy);
    });
    events.on('player:damaged', () => this.onPlayerDamaged());
    events.on('player:healed', e => this.onHealed(e.amount));
    events.on('game:state', ({ from, to }) => {
      // A hit held over a pause would land after it, out of time with its shot.
      if (to === 'paused') {
        this.held = false;
        this.wound = null;
        this.play('ui_open');
      }
      else if (from === 'paused' && to === 'playing') this.play('ui_close');
      else if (to === 'gameover') this.play('game_over');
    });
  }

  /** No position means 2D. The options object is shared, because this can run many times a frame. */
  private play(id: string, position?: Vector3, volume = 1, pitch = 1, delay = 0): void {
    const o = this.o;
    o.position = position;
    o.volume = volume;
    o.pitch = pitch;
    o.delay = delay;
    this.audio.play(id, o);
  }

  private onCasing(e: GameEvents['fx:casing']): void {
    const now = this.ctx.time.realElapsed;
    if (e.strength < CASING_LOUD && now - this.lastCasing < CASING_GAP) return;
    this.lastCasing = now;
    this.play(CASINGS[e.kind], e.position, 0.3 + 0.7 * e.strength, e.kind === 'rifle' ? 0.88 : 1);
  }

  private onCombo(combo: number): void {
    if (combo === 0 && this.lastCombo >= COMBO_WORTH_MOURNING && !this.ctx.time.paused) this.play('combo_break');
    this.lastCombo = combo;
  }

  private onHit({ enemy, damage, result }: GameEvents['enemy:hit']): void {
    const now = this.ctx.time.realElapsed;
    // Fire ticks on its own. Confirming every tick would drown out the shots that took aim.
    if (damage.type === 'fire' || notPlayers(damage.source)) return;
    this.bodyHit(enemy, damage, result, now);
    const armour = result.armour ?? (result.blocked ? 'stopped' : undefined);
    // A piece coming off is news even on a kill and inside the gap, so a Sabot headshot through a helmet is both sounds.
    // Only a helmet covers the head, so a broken piece on a head hit is a helmet, and gets the signature.
    if (armour === 'broken') this.play(damage.region === 'head' ? 'armour_broken' : 'plate_destroyed');
    if (result.killed || now - this.lastMarker < MARKER_GAP) return;
    this.lastMarker = now;
    if (armour === 'broken') return;
    this.play(armour === 'stopped' ? 'armour_stopped' : armour === 'through' ? 'armour_through' : result.headshot ? 'hit_marker_head' : 'hit_marker');
  }

  /**
   * The weight of a round landing, under the wet hit Combat plays: a punch where it struck, and on flesh a crunch played
   * 2D, so a hit 40 m away still reads. A kill's marker takes the crunch's place. A headshot keeps its signature to
   * itself, so for a moment nothing else lands under it, and a blocked round is armor's sound alone.
   */
  private bodyHit(enemy: EnemyInstance, damage: DamageInfo, result: DamageResult, now: number): void {
    // The player's own guns only. Sentinels and call-ins hit with Combat's sound, and must not spend the gap a trigger pull needs.
    if (result.blocked || !BODY_HIT_TYPES.has(damage.type) || !Object.hasOwn(WEAPONS, damage.source)) return;
    if (result.headshot) {
      // Pellets land in any order, so a body pellet ahead of this one on the frame is let go as well.
      this.held = false;
      this.lastBodyHit = now;
      return;
    }
    if (this.held && result.killed) this.heldKill = true;
    const levels = bodyHitLevels(hitWeight(damage.amount, damage.type, damage.force));
    // Same frame counts too: the rest of a shotgun's pellets, or a pierce through a line, are the same hit.
    if (now - this.lastBodyHit < levels.gap) return;
    this.lastBodyHit = now;
    this.held = true;
    this.heldMachine = isMachine(enemy);
    this.heldKill = result.killed;
    this.heldLevels = levels;
    this.heldAt.copy(damage.point);
  }

  /**
   * Plays the frame's body hit. Every pellet of a trigger pull has landed by now, so a headshot among them has been heard.
   * A wound named on a man who lived through it is what the hit meant, so its 2D tier takes the crunch's place.
   */
  private landBodyHit(): void {
    const wound = this.woundEnemy?.alive === true ? this.wound : null;
    this.wound = null;
    this.woundEnemy = null;
    const held = this.held;
    this.held = false;
    const l = this.heldLevels;
    if (held && this.heldMachine) this.play('hit_punch', this.heldAt, l.punchVolume * MACHINE_PUNCH, l.punchPitch * MACHINE_PITCH);
    else if (held) this.play('hit_punch', this.heldAt, l.punchVolume, l.punchPitch);
    if (wound) this.play(wound);
    // The kill marker is a kill's 2D confirmation, as it is the plain marker's.
    else if (held && !this.heldMachine && !this.heldKill) this.play('hit_confirm', undefined, l.confirmVolume, l.confirmPitch);
  }

  /** `enemy:wounded` comes once per man per zone, so each tier says something new. */
  private onWounded({ enemy, zone, damage }: GameEvents['enemy:wounded']): void {
    if (VOICELESS.has(zone)) this.voiced.add(enemy.uid);
    if (notPlayers(damage.source)) return;
    if (ARTERIES.has(zone)) this.spray(damage.point, 0.05);
    const tier = CRIPPLING_ZONES.has(zone) ? 'wound_crippling' : MINOR_ZONES.has(zone) ? 'wound_minor' : null;
    if (!tier || this.wound === 'wound_crippling') return;
    this.wound = tier;
    this.woundEnemy = enemy;
  }

  private spray(at: Vector3, delay: number): void {
    const now = this.ctx.time.realElapsed;
    if (now - this.lastSpray < SPRAY_GAP) return;
    this.lastSpray = now;
    this.play('blood_spray', at, 1, rand(0.92, 1.08), delay);
  }

  /** Gone mortal or down: the line is said from the body, once, by a man who still has a voice. His death has its own. */
  private sayDying(): void {
    for (const e of this.dying) {
      if (!e.alive || this.voiced.has(e.uid)) continue;
      this.voiced.add(e.uid);
      this.play('vox_dying_human', e.center, 0.7);
    }
    this.dying.length = 0;
  }

  /**
   * One recorded rip with its bone in it, over the synth `limb_sever` that whoever cut it plays, and the stump spraying
   * after it. It replaces the bone snap, tear and spill that used to be layered here, which together were mud.
   */
  private onSevered({ enemy, damage }: GameEvents['enemy:severed']): void {
    if (isMachine(enemy) || enemy.id === 'titan') return;
    this.play('limb_rip', damage.point, 1, 1, 0.01);
    this.spray(damage.point, 0.3);
  }

  private onKilled({ enemy, damage, gibbed, headshot }: GameEvents['enemy:killed']): void {
    if (!notPlayers(damage.source)) this.play('hit_marker_kill');
    if (isMachine(enemy)) return;
    if (gibbed) {
      this.play('blood_splatter', enemy.center, 1, 1, 0.03);
      // What went up coming down.
      this.play('gib_rain', enemy.center, 1, 1, 0.15);
    }
    else if (headshot) {
      this.play('head_pop', enemy.center);
      this.play('vox_gurgle', enemy.center, 0.8, rand(0.9, 1.1), 0.18);
    }
    // The body shot's partner to `headshot_puff`: a round from the player's gun that killed.
    else if (BODY_HIT_TYPES.has(damage.type) && Object.hasOwn(WEAPONS, damage.source)) this.play('kill_body');
  }

  /** What a body, limb, head or chunk sounds like landing. The payload is reused, so nothing here keeps it. */
  private onLanding({ position, strength, kind }: GameEvents['gore:impact']): void {
    if (!Number.isFinite(strength)) return;
    const { player } = this.ctx;
    if (position.distanceToSquared(player.position) > LANDING_RANGE * LANDING_RANGE) return;
    if (kind !== 'organ' && strength < BUMP_BELOW) {
      if (this.bumpTokens < 1) return;
      this.bumpTokens--;
      this.play('ragdoll_bump', position, 0.55 + 1.8 * strength, kind === 'body' ? rand(0.9, 1) : rand(1.05, 1.2));
      return;
    }
    if (this.landingTokens < 1) return;
    this.landingTokens--;
    const volume = 0.35 + 0.65 * strength;
    // Hard landings are lower as well as louder: it is the heavy parts that hit hard.
    const pitch = 1.08 - 0.16 * strength;
    const wet = strength > WET_LAYER_AT;
    switch (kind) {
      case 'body':
        this.play(this.onMetal(position) ? 'body_fall_metal' : 'body_fall_concrete', position, volume, pitch);
        if (wet) this.play('flesh_slosh', position, volume * 0.6, pitch, 0.03);
        if (strength > DRAG_AT && Math.random() < DRAG_CHANCE) this.play('body_drag', position, volume * 0.7, 1, 0.12);
        break;
      case 'limb':
        this.play('limb_thud', position, volume, pitch);
        if (wet) this.play('gore_splat', position, volume * 0.7, pitch, 0.01);
        break;
      case 'head':
        this.play('head_thud', position, volume, pitch);
        if (wet) this.play('wet_squelch', position, volume * 0.6, pitch, 0.02);
        break;
      case 'organ':
        this.play(wet ? (Math.random() < 0.5 ? 'gore_splat' : 'organ_splat') : 'wet_squelch', position, volume, pitch);
        if (Math.random() < DRIP_CHANCE) this.play('blood_drip', position, volume * 0.8, 1, rand(0.15, 0.4));
        break;
    }
  }

  private onMetal(position: Vector3): boolean {
    const from = this.probeFrom.copy(position);
    from.y += 0.3;
    return this.ctx.physics.raycastInto(from, this.probeDown, SURFACE_PROBE, CG.World, this.probeHit) && HARD_SURFACES.has(this.probeHit.surface);
  }

  private onPlayerDamaged(): void {
    const armor = this.ctx.player.armor;
    if (this.armor > 0 && armor <= 0) this.play('armor_break');
    else if (armor < this.armor) this.play('armor_hit');
    this.armor = armor;
  }

  private onHealed(amount: number): void {
    const now = this.ctx.time.realElapsed;
    if (amount > REGEN_TICK_MAX || now - this.lastRegen < REGEN_TICK_GAP) return;
    this.lastRegen = now;
    this.play('heal_tick');
  }

  /** Runs after Weapons and Combat in the frame order, so on the frame the hits landed. */
  update(dt: number, room: RoomId | null): void {
    this.landBodyHit();
    if (this.dying.length > 0) this.sayDying();
    const { enemies, player } = this.ctx;
    this.armor = player.armor;
    this.landingTokens = Math.min(LANDING_BURST, this.landingTokens + LANDING_RATE * dt);
    this.bumpTokens = Math.min(BUMP_BURST, this.bumpTokens + BUMP_RATE * dt);
    this.noiseClock -= dt;
    if (this.noiseClock <= 0) this.roomNoise(room, player.position);
    const alive = enemies.alive;
    // Sandboxes stub this with something that is not an array.
    if (!Array.isArray(alive)) return;
    this.fireClock -= dt;
    if (this.fireClock <= 0) {
      this.fireClock = FIRE_SCAN_SECONDS;
      this.assignFires(alive, player.position);
    }
    for (const slot of this.fires) if (slot.enemy) slot.handle.setPosition(slot.enemy.center);
  }

  private roomNoise(room: RoomId | null, listener: Vector3): void {
    this.noiseClock = rand(NOISE_EVERY[0], NOISE_EVERY[1]);
    const id = room ? ROOM_NOISES[room] : undefined;
    if (!id) return;
    const angle = rand(0, Math.PI * 2);
    const distance = rand(NOISE_RANGE[0], NOISE_RANGE[1]);
    this.noiseAt.set(listener.x + Math.cos(angle) * distance, listener.y + rand(4, 14), listener.z + Math.sin(angle) * distance);
    this.play(id, this.noiseAt, 1, rand(0.85, 1.1));
  }

  /** Nearest burning bodies get a voice. The rest are quiet until a slot frees up. */
  private assignFires(alive: readonly EnemyInstance[], listener: Vector3): void {
    for (const slot of this.fires) {
      const e = slot.enemy;
      if (e && (e.uid !== slot.uid || !e.alive || e.burning <= 0)) this.release(slot);
    }
    for (const slot of this.fires) {
      if (slot.enemy) continue;
      let best: EnemyInstance | null = null;
      let bestD = FIRE_RANGE * FIRE_RANGE;
      for (let i = 0; i < alive.length; i++) {
        const e = alive[i]!;
        if (!e.alive || e.burning <= 0 || this.burning(e)) continue;
        const d = e.position.distanceToSquared(listener);
        if (d < bestD) {
          bestD = d;
          best = e;
        }
      }
      if (!best) return;
      slot.enemy = best;
      slot.uid = best.uid;
      slot.handle = this.audio.startLoop('flame_burn_loop', { position: best.center });
    }
  }

  private burning(e: EnemyInstance): boolean {
    for (const slot of this.fires) if (slot.enemy === e) return true;
    return false;
  }

  private release(slot: FireSlot): void {
    slot.handle.stop();
    slot.handle = DEAD_HANDLE;
    slot.enemy = null;
  }

  reset(): void {
    for (const slot of this.fires) if (slot.enemy) this.release(slot);
    this.noiseClock = NOISE_EVERY[0];
    this.lastBodyHit = -1;
    this.held = false;
    this.lastCombo = 0;
    this.armor = 0;
    this.landingTokens = LANDING_BURST;
    this.bumpTokens = BUMP_BURST;
    this.wound = null;
    this.woundEnemy = null;
    this.dying.length = 0;
    this.voiced.clear();
    this.lastSpray = -SPRAY_GAP;
  }
}
