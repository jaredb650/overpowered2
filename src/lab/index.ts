/**
 * Dev controls: the panel, the time controls and the aim readout. Game.ts loads this on /?map=range, with ?dev=1, and on
 * every page of the dev server unless ?dev=0 (core/devflags.ts), so the public site's normal run never downloads it.
 * Everything else the lab changes goes through DevFlags, or through the public scale request on the clock.
 *
 * A dev server page that did not ask for the lab plays as the real game until the panel is first opened: no hint, no
 * hotkeys but F1 and backquote, and every cheat off (settings.ts).
 *
 * The world is paused with a scale of zero, not with `time.paused`, because the player's clock ignores slow motion:
 * the camera can walk round a frozen body and fire into it, then step the world on a frame at a time.
 */
import * as THREE from 'three';
import type { Ctx } from '../core/contracts';
import { DEV_ASKED, DevFlags, ON_RANGE } from '../core/devflags';
import type { Game } from '../core/Game';
import type { WeaponId } from '../core/gameplay';
import { MAX_ALIVE } from '../enemies/waves';
import { WEAPON_ORDER } from '../weapons/data';
import { AimOverlay } from './overlay';
import { ANIM } from '../player/moveAnim';
import { MOVE } from '../player/tuning';
import { LabPanel, type MoveSwitch } from './panel';
import { PARKOUR } from './parkour';
import { GALLERY } from './range';
import { applyFlags, loadSettings, saveSettings } from './settings';
import { LabSpawner } from './spawn';

const SCALE_ID = 'lab';
const MIN_SPEED = 0.05;
const STEP_SECONDS = 1 / 60;
const STATUS_REFRESH = 0.25;
/** Enough grenades to throw without counting, and well under the carry limit. */
const GRENADE_FLOOR = 3;
/** Extinction per metre on the range. The game's haze suits a city and hides a body at the far wall. */
const RANGE_FOG = 0.0012;
const _at = new THREE.Vector3();
/** Meters from the eye to the front of each body the melee reach test stands. */
const MELEE_LINE: readonly number[] = [1.5, 2.5, 3.5, 5, 8];

const isField = (t: EventTarget | null): boolean => t instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName);

interface Bindings {
  conflicts?(code: string): readonly unknown[];
}

export class Lab {
  readonly settings = loadSettings();
  readonly flags = DevFlags;
  readonly spawner: LabSpawner;
  readonly overlay: AimOverlay;
  paused = false;
  private readonly panel: LabPanel;
  private readonly hint = document.createElement('div');
  private opened = false;
  /** The time and spawn keys answer. From the start where the lab was asked for, elsewhere once the panel has been opened. */
  private armed = DEV_ASKED;
  /** The panel let the mouse go mid-run, so the hint says how to take it back. */
  private tookMouse = false;
  private steps = 0;
  private statusClock = 0;

  constructor(private readonly ctx: Ctx, private readonly game: Game) {
    applyFlags(this.settings);
    if (ON_RANGE) (ctx.render as unknown as { fog: { density: number } }).fog.density = RANGE_FOG;
    this.spawner = new LabSpawner(ctx);
    this.overlay = new AimOverlay(ctx);
    this.panel = new LabPanel(this.settings, {
      changed: () => this.changed(),
      spawn: n => this.spawn(n),
      vehicle: kind => this.spawner.vehicle(kind, this.settings.ai),
      killAll: () => this.spawner.killAll(),
      clearBodies: () => this.spawner.clearBodies(),
      grant: id => ctx.progression.grant(id),
      grantCallIn: id => ctx.progression.grantCallIn(id),
      setCombo: combo => ctx.progression.setCombo(combo),
      togglePause: () => this.togglePause(),
      step: n => this.step(n),
      setSpeed: s => this.setSpeed(s),
      weapon: id => this.draw(id),
      gallery: () => this.gallery(),
      swarm: () => this.swarm(),
      melee: backs => this.melee(backs),
      lance: n => this.lance(n),
      parkour: () => this.parkour(),
      move: (key, on) => this.moveSwitch(key, on),
    }, (ctx.enemies as unknown as { vehicles?: unknown }).vehicles != null);
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
    // Straight into the set: `give` would raise an unlock banner for each one, on every boot.
    for (const id of WEAPON_ORDER) (weapons.owned as Set<WeaponId>).add(id);
  }

  get open(): boolean {
    return this.opened;
  }

  /** Straight into the set, as the arsenal cheat does: `give` would raise an unlock banner. */
  draw(id: WeaponId): void {
    const { weapons } = this.ctx;
    (weapons.owned as Set<WeaponId>).add(id);
    weapons.switchTo(id);
  }

  /**
   * A reach test for key 5: the selected enemy at 1.5, 2.5, 3.5, 5 and 8 m from the eye to its front, a little to either
   * side of the crosshair in turn, so a swing shows what it reaches and what it does not. `backs` turns them all away, for
   * the Shiv. Draws nothing: hold whichever weapon is to be tried. Returns how many stood.
   */
  melee(backs = false): number {
    return this.spawner.reachLine(this.settings.spawn, this.settings.ai, MELEE_LINE, backs);
  }

  /** The Quiver in hand and five of the selected enemy spread ahead to paint. Returns how many stood. */
  swarm(): number {
    this.draw('quiver');
    return this.spawner.spread(this.settings.spawn, this.settings.ai, 5);
  }

  /**
   * The Lance in hand with a full cell, and `count` of the selected enemy one behind another down the crosshair with a few
   * bystanders beside the line, for a beam and its bursts. Returns how many stood.
   */
  lance(count = 8): number {
    this.draw('lance');
    this.ctx.weapons.refillMagazines();
    return this.spawner.column(this.settings.spawn, this.settings.ai, count);
  }

  /**
   * The range's piercing gallery: the player at its near end looking down the lane, one of the selected enemy in the bay
   * behind each wall. Returns how many were placed.
   */
  gallery(): number {
    if (!ON_RANGE) return 0;
    const { player } = this.ctx;
    const z = (GALLERY.z0 + GALLERY.z1) / 2;
    player.teleport(_at.set(GALLERY.stand[0], 0.1, GALLERY.stand[1]), -Math.PI / 2);
    let placed = 0;
    for (const x of GALLERY.bays) {
      if (this.spawner.place(this.settings.spawn, _at.set(x, 0, z), this.settings.ai)) placed++;
    }
    return placed;
  }

  /** The start of the range's parkour strip, looking down it. */
  parkour(): boolean {
    if (!ON_RANGE) return false;
    this.ctx.player.teleport(_at.set(PARKOUR.start[0], 0.1, PARKOUR.start[1]), 0);
    return true;
  }

  /** Movement switches belong to the player and reset with the page, like the URL flags they mirror. */
  moveSwitch(key: MoveSwitch, on?: boolean): boolean {
    if (key === 'autoVault') {
      if (on !== undefined) MOVE.vaultAuto = on;
      return MOVE.vaultAuto;
    }
    if (key === 'camera') {
      if (on !== undefined) ANIM.camera = on ? 1 : 0;
      return ANIM.camera > 0;
    }
    const field = key === 'anim' ? 'enabled' : 'legs';
    if (on !== undefined) ANIM[field] = on;
    return ANIM[field];
  }

  setOpen(open: boolean): void {
    if (open === this.opened) return;
    this.opened = open;
    this.panel.el.classList.toggle('open', open);
    const { input } = this.ctx;
    if (open) {
      this.armed = true;
      if (this.game.state === 'playing') this.tookMouse = true;
      input.releaseLock();
    } else {
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
    if (this.opened && this.game.state !== 'playing') {
      // A menu sits behind the panel, and Enter there would start a run that takes the mouse from under it. Keys inside
      // the panel never leave it (panel.ts).
      if (!(e.target instanceof Node && this.panel.el.contains(e.target))) e.stopPropagation();
      return;
    }
    if (e.repeat || !this.armed || isField(e.target) || this.game.state !== 'playing') return;
    // A key the player has bound to the game is the game's.
    if ((this.ctx.input as unknown as Bindings).conflicts?.(e.code)?.length) return;
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
    this.panel.setStatus(`alive ${enemies.alive.length} / ${MAX_ALIVE}   world ${world}\n${String(stats.fps)} fps   ${String(stats.cpuMs)} ms`);
  }

  private readonly frame = (): void => {
    requestAnimationFrame(this.frame);
    const { ctx, game, settings } = this;
    const playing = game.state === 'playing';
    if (playing) {
      this.updateTime();
      // Held every frame, not set once: a restart, a mission's loadout, a checkpoint redeploy and the end of Berserk all
      // put the player and the guns back to neutral.
      if (settings.god) ctx.player.modifiers.invulnerable = true;
      // Progression rewrites the modifiers every frame, after weapons have read them.
      if (settings.arsenal) {
        for (const id of WEAPON_ORDER) (ctx.weapons.owned as Set<WeaponId>).add(id);
        ctx.weapons.modifiers.bottomlessMag = true;
        if (ctx.weapons.grenades < GRENADE_FLOOR) ctx.weapons.addGrenades(GRENADE_FLOOR);
      }
    }
    if (ctx.input.locked) this.tookMouse = false;
    this.overlay.update(settings.overlay);
    const hint = playing && !this.opened && !ctx.input.locked && (DEV_ASKED || this.tookMouse);
    this.hint.style.display = hint ? 'block' : 'none';
    if (this.opened) this.updateStatus();
  };
}

export function createLab(ctx: Ctx, game: Game): Lab {
  const lab = new Lab(ctx, game);
  (window as unknown as { __lab: Lab }).__lab = lab;
  return lab;
}
