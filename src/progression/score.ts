/**
 * Score: base + headshot + style bonuses, all times combo tier x speed tier. Numbers in data.ts.
 *
 * The first game paid +50 per headshot hit, lethal or not, so that stays. It also paid once per shotgun pellet, which
 * made three pellets one instant SLOWMO; hits on one enemy in one frame now count once.
 */
import type { Ctx } from '../core/contracts';
import type { DamageResult, EnemyInstance, KillEvent } from '../core/gameplay';
import { readHighScore, writeHighScore } from '../contracts/scores';
import { ACTIVE } from '../contracts/select';
import { Combo } from './counters';
import { GIFT_SOURCES, HEADSHOT_COLOR, MULTI_KILLS, SCORE, STYLE, STYLE_COLOR } from './data';

/** Sources the map owns. A kill from any of them is environmental. */
const ENVIRONMENT = /^(world|hazard|barrel|tank|lava|crusher|electric|env)/;
const FINISHER = /finisher/;
/** Float texts per frame. A nuke kills dozens at once and every one still scores. */
const MAX_FLOATS_PER_FRAME = 4;

function tier(table: readonly (readonly [number, number])[], value: number): number {
  let out = 1;
  for (const [at, mult] of table) if (value >= at) out = mult;
  return out;
}

export class ScoreKeeper {
  score = 0;
  kills = 0;
  headshots = 0;
  highScore = 0;

  private readonly multi = new Combo(SCORE.multiKillGap);
  private beatHighScore = false;
  private storedHighScore = 0;
  private lastHeadUid = -1;
  private lastHeadFrame = -1;
  private floatFrame = -1;
  private floats = 0;
  /** The kill being priced. Fields, so a nuke's dozens of kills build no closures. */
  private bonus = 0;
  private label = '';

  constructor(private readonly ctx: Ctx) {
    this.storedHighScore = ACTIVE.ranked ? readHighScore(ACTIVE.def) : 0;
    this.highScore = this.storedHighScore;
    // Closing the tab mid-wave is the last chance to keep a record set since the last wave clear.
    window.addEventListener('pagehide', () => this.persist());
  }

  comboTier(combo: number): number {
    return tier(SCORE.comboTiers, combo);
  }

  speedTier(): number {
    const v = this.ctx.player.velocity;
    return tier(SCORE.speedTiers, Math.hypot(v.x, v.z));
  }

  update(dt: number): void {
    this.multi.tick(dt);
  }

  /** Marks a headshot. Returns false if this enemy already scored one this frame. */
  noteHeadshot(enemy: EnemyInstance): boolean {
    const frame = this.ctx.time.frame;
    if (enemy.uid === this.lastHeadUid && frame === this.lastHeadFrame) return false;
    this.lastHeadUid = enemy.uid;
    this.lastHeadFrame = frame;
    this.headshots++;
    return true;
  }

  /** A non-lethal head hit: +50 and a feed line, the same as the first game. */
  onHeadshotHit(enemy: EnemyInstance, combo: number, result: DamageResult): void {
    if (result.killed) return;
    const pts = Math.round(SCORE.headshot * this.comboTier(combo) * this.speedTier());
    this.add(pts, 'headshot', enemy.center);
    this.ctx.hud.feed(`HEADSHOT! +${pts}`, HEADSHOT_COLOR);
    this.float(enemy, `+${pts} HEADSHOT`, HEADSHOT_COLOR);
  }

  /** A prisoner shot: paid on top of the kill itself, which 'enemy:killed' has already priced. */
  onExecution(enemy: EnemyInstance, combo: number): void {
    const { bonus, label } = STYLE.geneva;
    const pts = Math.round(bonus * this.comboTier(combo) * this.speedTier());
    this.add(pts, label, enemy.center);
    this.ctx.hud.feed(`${label} +${pts}`, STYLE_COLOR);
    this.float(enemy, `+${pts} ${label}`, STYLE_COLOR);
  }

  /** The first style names the kill; the rest are in the number. */
  private style(s: { label: string; bonus: number }): void {
    this.bonus += s.bonus;
    if (!this.label) this.label = s.label;
  }

  onKill(e: KillEvent, combo: number): number {
    this.kills++;
    const multiCount = this.multi.hit();
    let base = e.enemy.score;
    if (FINISHER.test(e.damage.source)) base *= SCORE.finisherMultiplier;
    this.bonus = 0;
    this.label = '';
    let color: string | undefined;

    if (e.headshot) {
      this.bonus += SCORE.headshot;
      this.label = 'HEADSHOT';
      color = HEADSHOT_COLOR;
    }
    if (e.enemy.frozen > 0) this.style(STYLE.shatter);
    if (e.sliced) this.style(STYLE.sliced);
    if (ENVIRONMENT.test(e.damage.source)) this.style(STYLE.environment);
    if (GIFT_SOURCES.test(e.damage.source)) this.style(STYLE.gift);
    if (e.playerWallRunning) this.style(STYLE.wallRun);
    if (e.playerSliding) this.style(STYLE.slide);
    if (e.playerAirborne && !e.playerWallRunning) this.style(STYLE.airborne);
    // Both are measured from the body, which is not where the player is while seated.
    if (!this.ctx.player.parked) {
      if (e.distance <= SCORE.pointBlank) this.style(STYLE.pointBlank);
      if (e.distance >= SCORE.longShot) this.style(STYLE.longShot);
    }
    if (e.playerSpeed >= SCORE.blurSpeed) this.style(STYLE.blur);
    if (e.severedCount > 0) this.style(STYLE.dismember);
    if (e.gibbed) this.style(STYLE.gibbed);
    if (this.ctx.player.health <= SCORE.closeCallHealth) this.style(STYLE.closeCall);

    // Each rung pays once. Past the top one a call-in would otherwise print money for every body in the blast.
    const multi = multiCount < MULTI_KILLS.length ? MULTI_KILLS[multiCount]! : MULTI_KILLS[0]!;
    this.bonus += multi.bonus;
    const { bonus, label } = this;

    const mult = this.comboTier(combo) * this.speedTier();
    const points = Math.round((base + bonus) * mult);
    this.add(points, label || 'kill', e.enemy.center);

    const { audio, hud } = this.ctx;
    if (multi.label) {
      audio.play('multikill', { pitch: 1 + Math.min(multiCount, 8) * 0.06 });
      hud.feed(`${multi.label} +${multi.bonus}`, STYLE_COLOR);
      this.float(e.enemy, multi.label, STYLE_COLOR);
      if (multiCount >= 5) hud.banner(multi.label, `${multiCount} KILLS`, STYLE_COLOR);
    }
    if (bonus > 0 && label && label !== 'HEADSHOT') audio.play('style_bonus');

    this.float(e.enemy, label ? `+${points} ${label}` : `+${points}`, color ?? (label ? STYLE_COLOR : undefined));
    hud.feed(label ? `${label} +${points}` : `Enemy eliminated +${points}`, color ?? (label ? STYLE_COLOR : undefined));
    return points;
  }

  private float(enemy: EnemyInstance, text: string, color?: string): void {
    const frame = this.ctx.time.frame;
    if (frame !== this.floatFrame) {
      this.floatFrame = frame;
      this.floats = 0;
    }
    if (this.floats++ < MAX_FLOATS_PER_FRAME) this.ctx.hud.floatText(enemy.center, text, color);
  }

  add(points: number, reason: string, position?: EnemyInstance['center']): void {
    this.score += points;
    this.ctx.events.emit('score:gain', { points, reason, position });
    if (this.score > this.highScore) {
      this.highScore = this.score;
      if (!this.beatHighScore && this.storedHighScore > 0) {
        this.beatHighScore = true;
        this.ctx.audio.play('highscore');
        this.ctx.hud.feed('NEW HIGH SCORE!', STYLE_COLOR);
      }
    }
  }

  /** Writes the high score out. Called at wave clears and at the end of a run. */
  persist(): void {
    if (this.highScore <= this.storedHighScore) return;
    this.storedHighScore = this.highScore;
    if (ACTIVE.ranked) writeHighScore(ACTIVE.def, this.highScore);
  }

  reset(): void {
    this.persist();
    this.score = 0;
    this.kills = 0;
    this.headshots = 0;
    this.multi.clear();
    this.beatHighScore = false;
    this.lastHeadUid = -1;
    this.lastHeadFrame = -1;
  }
}
