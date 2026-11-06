/**
 * Dev controls: the panel, the time controls and the aim readout. Game.ts loads this only on /?map=range or with
 * ?dev=1, so a normal run never downloads it. Everything else the lab changes goes through DevFlags, or through the
 * public scale request on the clock.
 *
 * The world is paused with a scale of zero, not with `time.paused`, because the player's clock ignores slow motion:
 * the camera can walk round a frozen body and fire into it, then step the world on a frame at a time.
 */
import type { Ctx } from '../core/contracts';
import { DevFlags, ON_RANGE } from '../core/devflags';
import type { Game } from '../core/Game';
import { WEAPON_ORDER } from '../weapons/data';
import { AimOverlay } from './overlay';
import { LabPanel } from './panel';
import { applyFlags, loadSettings, saveSettings } from './settings';
import { LabSpawner } from './spawn';

const SCALE_ID = 'lab';
const MIN_SPEED = 0.05;
const STEP_SECONDS = 1 / 60;
const STATUS_REFRESH = 0.25;
/** Enough grenades to throw without counting, and well under the carry limit. */
const GRENADE_FLOOR = 3;

const isField = (t: EventTarget | null): boolean => t instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName);

export class Lab {
  readonly settings = loadSettings();
  readonly flags = DevFlags;
  readonly spawner: LabSpawner;
  readonly overlay: AimOverlay;
  paused = false;
  private readonly panel: LabPanel;
  private readonly hint = document.createElement('div');
  private opened = false;
  private steps = 0;
  private statusClock = 0;

  constructor(private readonly ctx: Ctx, private readonly game: Game) {
    applyFlags(this.settings);
    this.spawner = new LabSpawner(ctx);
    this.overlay = new AimOverlay(ctx);
    this.panel = new LabPanel(this.settings, {
      changed: () => this.changed(),
      spawn: n => this.spawn(n),
      killAll: () => this.spawner.killAll(),
      clearBodies: () => this.spawner.clearBodies(),
      togglePause: () => this.togglePause(),
      step: n => this.step(n),
      setSpeed: s => this.setSpeed(s),
    });
    this.hint.className = 'lab-hint';
    this.hint.textContent = 'Click for the mouse. F1 or ` opens the panel.';
    this.hint.style.display = 'none';
    document.body.appendChild(this.hint);

    // The HUD reads a lost mouse as a pause. Here the panel took it on purpose, so the run carries on behind it.
    const hud = ctx.hud as unknown as { pause(): void };
    const pause = hud.pause.bind(hud);
    hud.pause = () => {
      if (!this.opened) pause();
    };

    ctx.events.on('game:state', e => {
      if (e.to !== 'playing' || e.from === 'paused') return;
      if (ON_RANGE) ctx.waves.reset?.();
      this.applyPlayer();
    });
    window.addEventListener('keydown', e => this.onKey(e), true);
    document.getElementById('game')!.addEventListener('mousedown', () => {
      if (!this.opened && !ctx.input.locked && game.state === 'playing') ctx.input.requestLock();
    });
    requestAnimationFrame(this.frame);
  }

  private changed(): void {
    applyFlags(this.settings);
    saveSettings(this.settings);
    this.applyPlayer();
  }

  private applyPlayer(): void {
    const { player, weapons } = this.ctx;
    player.modifiers.invulnerable = this.settings.god;
    if (!this.settings.arsenal) return;
    for (const id of WEAPON_ORDER) if (!weapons.owned.has(id)) weapons.give(id);
  }

  get open(): boolean {
    return this.opened;
  }

  setOpen(open: boolean): void {
    if (open === this.opened) return;
    this.opened = open;
    this.panel.el.classList.toggle('open', open);
    const { input } = this.ctx;
    if (open) input.releaseLock();
    else {
      (document.activeElement as HTMLElement | null)?.blur();
      if (this.game.state === 'playing') input.requestLock();
    }
  }

  spawn(count: number): number {
    return this.spawner.atCrosshair(this.settings.spawn, this.settings.ai, count);
  }

  togglePause(): void {
    this.paused = !this.paused;
    this.panel.syncTime(this.paused);
  }

  /** Runs the world on for `frames` of 1/60 s, then holds it. */
  step(frames: number): void {
    if (!this.paused) this.togglePause();
    this.steps += frames;
  }

  setSpeed(speed: number): void {
    this.settings.speed = Math.min(1, Math.max(MIN_SPEED, speed));
    this.panel.syncTime(this.paused);
    this.changed();
  }

  private onKey(e: KeyboardEvent): void {
    if (e.code === 'F1' || e.code === 'Backquote') {
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) this.setOpen(!this.opened);
      return;
    }
    if (e.code === 'Escape' && this.opened) {
      e.stopPropagation();
      this.setOpen(false);
      return;
    }
    if (e.repeat || isField(e.target) || this.game.state !== 'playing') return;
    switch (e.code) {
      case 'KeyP': this.togglePause(); break;
      case 'Period': this.step(1); break;
      case 'BracketLeft': this.setSpeed(this.settings.speed * 0.5); break;
      case 'BracketRight': this.setSpeed(this.settings.speed * 2); break;
      case 'KeyO': this.spawn(1); break;
      case 'KeyK': this.spawner.killAll(); break;
      case 'KeyL': this.spawner.clearBodies(); break;
    }
  }

  private updateTime(): void {
    const { time } = this.ctx;
    let scale = this.paused ? 0 : this.settings.speed;
    if (this.steps > 0) {
      this.steps--;
      scale = Math.min(1, STEP_SECONDS / Math.max(time.realDt, 1 / 240));
    }
    if (scale >= 1) time.popScale(SCALE_ID);
    else time.pushScale(SCALE_ID, scale, 0, 0);
  }

  private updateStatus(): void {
    this.statusClock -= this.ctx.time.realDt;
    if (this.statusClock > 0) return;
    this.statusClock = STATUS_REFRESH;
    const { enemies, time } = this.ctx;
    const stats = this.game.stats();
    const world = this.paused ? 'paused' : `${time.slowmo.toFixed(2)}x`;
    this.panel.setStatus(`alive ${enemies.alive.length} / 48   world ${world}\n${String(stats.fps)} fps   ${String(stats.cpuMs)} ms`);
  }

  private readonly frame = (): void => {
    requestAnimationFrame(this.frame);
    const { ctx, game, settings } = this;
    const playing = game.state === 'playing';
    if (playing) {
      this.updateTime();
      // Progression rewrites the modifiers every frame, after weapons have read them.
      if (settings.arsenal) {
        ctx.weapons.modifiers.bottomlessMag = true;
        if (ctx.weapons.grenades < GRENADE_FLOOR) ctx.weapons.addGrenades(GRENADE_FLOOR);
      }
    }
    this.overlay.update(settings.overlay);
    this.hint.style.display = playing && !this.opened && !ctx.input.locked ? 'block' : 'none';
    if (this.opened) this.updateStatus();
  };
}

export function createLab(ctx: Ctx, game: Game): Lab {
  const lab = new Lab(ctx, game);
  (window as unknown as { __lab: Lab }).__lab = lab;
  return lab;
}
