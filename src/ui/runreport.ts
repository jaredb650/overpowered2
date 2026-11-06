/** Everything the game-over screen and Tab overlay show. Fed by events, so nothing in gameplay knows it exists. */
import type { Ctx } from '../core/contracts';
import type { PerkId, PowerupId, WeaponId } from '../core/gameplay';
import { WEAPONS } from './data';

export class RunReport {
  score = 0;
  highAtStart = 0;
  kills = 0;
  headshots = 0;
  wave = 0;
  seconds = 0;
  shots = 0;
  hits = 0;
  bestCombo = 0;
  bestMultiplier = 1;
  topSpeed = 0;
  limbs = 0;
  gibs = 0;
  slices = 0;
  damageTaken = 0;
  callIns = 0;
  killedBy = '';
  private hitFrame = -1;
  readonly weaponKills = new Map<string, number>();
  readonly perks = new Map<PerkId | PowerupId, number>();

  constructor(private readonly ctx: Ctx) {
    const on = ctx.events;
    on.on('weapon:fired', () => { this.shots++; });
    on.on('enemy:hit', e => {
      // Accuracy is shots that landed. Six pellets are one shot, and a call-in was never a shot at all.
      if (!WEAPONS[e.damage.source as WeaponId] || this.hitFrame === this.ctx.time.frame) return;
      this.hitFrame = this.ctx.time.frame;
      this.hits++;
    });
    on.on('enemy:killed', e => {
      // Every sword move is the sword, in a table of what did the killing.
      const source = e.damage.source.startsWith('sword') ? 'sword' : e.damage.source;
      this.weaponKills.set(source, (this.weaponKills.get(source) ?? 0) + 1);
      if (e.gibbed) this.gibs++;
      if (e.sliced) this.slices++;
    });
    on.on('enemy:severed', () => { this.limbs++; });
    on.on('perk:start', e => { this.perks.set(e.id, (this.perks.get(e.id) ?? 0) + 1); });
    on.on('callin:used', () => { this.callIns++; });
    on.on('combo:changed', e => { if (e.combo > this.bestCombo) this.bestCombo = e.combo; });
    on.on('player:damaged', e => { this.damageTaken += e.amount; });
    on.on('player:died', e => { this.killedBy = e.source; });
  }

  begin(highScore: number): void {
    this.score = this.kills = this.headshots = this.wave = this.seconds = 0;
    this.shots = this.hits = this.bestCombo = this.topSpeed = 0;
    this.limbs = this.gibs = this.slices = this.damageTaken = this.callIns = 0;
    this.bestMultiplier = 1;
    this.killedBy = '';
    this.hitFrame = -1;
    this.highAtStart = highScore;
    this.weaponKills.clear();
    this.perks.clear();
  }

  /** Called each frame of a run. */
  sample(dt: number, speed: number, multiplier: number, score: number, kills: number, wave: number): void {
    this.seconds += dt;
    if (speed > this.topSpeed) this.topSpeed = speed;
    if (multiplier > this.bestMultiplier) this.bestMultiplier = multiplier;
    this.score = score;
    this.kills = kills;
    this.wave = wave;
    const headshots = this.ctx.progression.headshots;
    if (typeof headshots === 'number') this.headshots = headshots;
  }

  get accuracy(): number {
    return this.shots > 0 ? Math.min(1, this.hits / this.shots) : 0;
  }

  get isHighScore(): boolean {
    return this.score > 0 && this.score > this.highAtStart;
  }

  /** Top weapons by kills, most first. Runs once per screen, never per frame. */
  topWeapons(limit: number): [string, number][] {
    return [...this.weaponKills.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
  }
}
