/**
 * Sounds that follow from an event rather than from any one system's logic. Audio hears every event, so the
 * layers that make a fight read by ear live here: casings, hit confirmation, the wet detail under a kill, armor
 * and combo stingers, and fire on burning bodies. Whoever owns the action keeps playing its main sound.
 */
import { Vector3 } from 'three';
import { CG, type AudioSystem, type Ctx, type GameEvents, type LoopHandle, type PlayOptions, type RayHit, type SurfaceKind } from '../core/contracts';
import type { EnemyId, EnemyInstance } from '../core/gameplay';
import { rand } from '../core/math';
import type { RoomId } from './reverb';
import { DEAD_HANDLE } from './voices';

const CASINGS: Record<GameEvents['fx:casing']['kind'], string> = {
  pistol: 'casing_brass', rifle: 'casing_brass', shotgun: 'casing_shotgun', cannon: 'casing_heavy',
};

/** An SMG's brass bounces 60 times a second. That much tinkle is rain, so the quiet bounces give way. */
const CASING_GAP = 0.05;
const CASING_LOUD = 0.6;
/** Shorter than the SMG's 50 ms, so every bullet gets its tick. */
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

export class Reactions {
  private readonly o: PlayOptions = {};
  private readonly noiseAt = new Vector3();
  private noiseClock = NOISE_EVERY[0];
  private readonly fires: FireSlot[] = Array.from({ length: FIRE_SLOTS }, () => ({ enemy: null, uid: -1, handle: DEAD_HANDLE }));
  private fireClock = 0;
  private lastCasing = -1;
  private lastMarker = -1;
  private lastRegen = -1;
  private lastCombo = 0;
  private armor = 0;
  private landingTokens = LANDING_BURST;
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
    events.on('player:damaged', () => this.onPlayerDamaged());
    events.on('player:healed', e => this.onHealed(e.amount));
    events.on('game:state', ({ from, to }) => {
      if (to === 'paused') this.play('ui_open');
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

  private onHit({ damage, result }: GameEvents['enemy:hit']): void {
    const now = this.ctx.time.realElapsed;
    // Fire ticks on its own. Confirming every tick would drown out the shots that took aim.
    if (result.killed || damage.type === 'fire' || ENEMY_SOURCES.has(damage.source) || now - this.lastMarker < MARKER_GAP) return;
    this.lastMarker = now;
    this.play(result.blocked ? 'hit_marker_armor' : result.headshot ? 'hit_marker_head' : 'hit_marker');
  }

  private onSevered({ enemy, damage }: GameEvents['enemy:severed']): void {
    if (isMachine(enemy) || enemy.id === 'titan') return;
    this.play('bone_snap', damage.point, 0.9, 1, 0.015);
    this.play('flesh_tear', damage.point, 0.7, 1, 0.02);
    this.play('blood_spurt', damage.point, 0.8, 1, 0.07);
  }

  private onKilled({ enemy, damage, gibbed, headshot }: GameEvents['enemy:killed']): void {
    if (!ENEMY_SOURCES.has(damage.source)) this.play('hit_marker_kill');
    if (isMachine(enemy)) return;
    if (gibbed) this.play('blood_splatter', enemy.center, 1, 1, 0.03);
    else if (headshot) {
      this.play('head_pop', enemy.center);
      this.play('vox_gurgle', enemy.center, 0.8, rand(0.9, 1.1), 0.18);
    }
  }

  /** What a body, limb, head or chunk sounds like landing. The payload is reused, so nothing here keeps it. */
  private onLanding({ position, strength, kind }: GameEvents['gore:impact']): void {
    if (this.landingTokens < 1 || !Number.isFinite(strength)) return;
    const { player } = this.ctx;
    if (position.distanceToSquared(player.position) > LANDING_RANGE * LANDING_RANGE) return;
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
        if (wet) this.play('wet_slap', position, volume * 0.7, pitch, 0.01);
        break;
      case 'head':
        this.play('head_thud', position, volume, pitch);
        if (wet) this.play('wet_squelch', position, volume * 0.6, pitch, 0.02);
        break;
      case 'organ':
        this.play(wet ? 'organ_splat' : 'wet_squelch', position, volume, pitch);
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

  update(dt: number, room: RoomId | null): void {
    const { enemies, player } = this.ctx;
    this.armor = player.armor;
    this.landingTokens = Math.min(LANDING_BURST, this.landingTokens + LANDING_RATE * dt);
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
    this.lastCombo = 0;
    this.armor = 0;
    this.landingTokens = LANDING_BURST;
  }
}
