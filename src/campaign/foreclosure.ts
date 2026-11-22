/**
 * Foreclosure's set pieces and director (`campaign/missions/foreclosure.ts`, `docs/proposals/mission-2-plan.md`):
 * everything specific to Holdfast that no general system owns, reached by `fc.*` calls from the mission script.
 *
 *   flak        Real 4-gun FlakTower (`enemies/vehicles/flakTower.ts`) on the harbour wall roof.
 *   mother      Old Mother (`enemies/vehicles/crawler.ts`), 30 m salt crawler across `pans`, `mother`, `deck`, `ending`.
 *   slip        Crashed courier fuselage + torn-off level-3 door gun emplacement + scrolling Council T&C boot bar.
 *   sappers     Militia sappers rushing the Frame's legs during `foreclosure` (`frame.attachSapper`).
 *   surrender   The Harbourmaster kneeling on Old Mother's stern deck after the engine breaks: cuff (`E`) or shoot.
 *   posters     Bureau red-goggles wanted posters placed along Holdfast's main route (story thread from `STORY.md`).
 */
import * as THREE from 'three';
import type { Ctx, EmitterHandle } from '../core/contracts';
import { clamp, rand } from '../core/math';
import type { Enemy } from '../enemies/Enemy';
import type { EnemyManager } from '../enemies/EnemyManager';
import { pose, soldierOf } from '../enemies/outpost/soldier';
import { FlakTower } from '../enemies/vehicles/flakTower';
import { OldMother } from '../enemies/vehicles/crawler';
import type { VehicleSystem } from '../enemies/vehicles';
import type { Frame } from '../frame/seat';
import { ModelBuilder, ModelMaterials } from '../progression/modelkit';
import { div, Label, span } from '../ui/dom';
import type { Emplacement, Emplacements } from '../vehicles/emplacement';
import type { GameHost } from './host';
import type { CampaignHud } from './hud';
import type { MissionRunner } from './runner';
import type { Mark } from './types';
import { PLACES } from './missions/foreclosure.places';

/** Bureau T&C clauses scrolling beneath the Distraint Frame boot bar during `slip`. */
const BOOT_CLAUSES: readonly string[] = [
  'CLAUSE 1.1: BY OPERATING THIS FRAME THE CONTRACTOR ACCEPTS LIABILITY FOR ITS CONTENTS, EXTERIOR PAINT, AND MUNICIPAL ROAD WEAR.',
  'CLAUSE 4.7: REPLACEMENT HYDRAULIC FLUID IS BILLED AT 420% OF PLANETARY SPOT RATE.',
  'CLAUSE 9.2: OBJECTIONS TO FORECLOSURE ARE NOT A RECOGNISED FORM UNDER SECTION 12 (CONTINUED EXISTENCE).',
  'CLAUSE 14.B: THE OFFICE OF SOCIETAL COMPLIANCE DISCLAIMS ALL RESPONSIBILITY FOR DETACHMENT OF LIMBS, SPLEEN, OR HEIRS.',
  'CLAUSE 19.F: COLLATERAL DEMOLITION OF PRIVATELY OWNED STALLS AND SHACKS IS CLASSIFIED AS ASSET LIQUIDATION.',
  'CLAUSE 22.A: FRAME DEPRECIATION BEGINS THE INSTANT THE HATCH OPENS. NO REFUNDS ON BREACHED HULLS.',
  'CLAUSE 27.C: ANY RESIDENT ATTEMPTING TO REASON WITH THE CONTRACTOR SHALL BE BILLED AS AN ADMINISTRATIVE DELAY.',
  'CLAUSE 31.D: DETAINEES SCHEDULED FOR TALLOW RENDERING WORKS MUST ARRIVE WITH AT LEAST TWO WORKING LUNGS.',
  'CLAUSE 38.0: THANK YOU FOR CONTRACTING WITH THE COUNCIL. PLEASE DO NOT BLEED ON THE LEATHERETTE.',
];

/** Deck crew spawn offsets in Old Mother's local frame (on the walkable deck behind cover crates). */
const DECK_POSTS: readonly (readonly [number, number, number])[] = [
  [-2.6, 6.55, -5.0],
  [2.6, 6.55, -4.5],
  [-2.2, 6.55, 1.5],
  [2.2, 6.55, 2.0],
  [0, 6.55, -8.5],
  [-3.2, 6.55, -1.5],
];

const SAPPER_INTERVAL = 13;
const SAPPER_REACH = 5.4;
const CUFF_REACH = 4.2;
const WANTED_PLACES: readonly { at: readonly [number, number, number]; yaw: number }[] = [
  { at: [65.4, 2.2, 49.4], yaw: 0 },        // Main gate south face
  { at: [58.4, 2.1, 28.0], yaw: Math.PI / 2 }, // Market Square west face
  { at: [49.4, 2.4, -4.0], yaw: Math.PI / 2 }, // Crane aisle container face
  { at: [75.8, 7.6, -59.0], yaw: Math.PI }, // Quay crane cab wall
];

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

interface CallinsAccess {
  callInsManager?: {
    frame: Frame;
    emplacements: Emplacements;
  };
}

export class Foreclosure {
  private readonly materials: ModelMaterials;
  private flak: FlakTower | null = null;
  private crawler: OldMother | null = null;
  private posters: THREE.Group | null = null;
  private wreckGroup: THREE.Group | null = null;
  private wreckLight: THREE.PointLight | null = null;
  private wreckSmoke: EmitterHandle | null = null;
  private doorGun: Emplacement | null = null;
  private builtWorld = false;

  // Slip boot progress HUD
  private readonly bootEl: HTMLElement;
  private readonly bootPct: Label;
  private readonly bootFill: HTMLElement;
  private readonly bootClause: Label;
  private bootTotal = 0;
  private bootElapsed = 0;
  private bootActive = false;
  private bootDoneSignalled = false;

  // Boss integrity HUD (Old Mother)
  private readonly bossEl: HTMLElement;
  private readonly bossPhase: Label;
  private readonly bossPct: Label;
  private readonly bossFill: HTMLElement;
  private readonly bossPips: Map<string, HTMLElement>;
  private bossVisible = false;

  // Sappers during `foreclosure`
  private sappersOn = false;
  private sapperIn = 7;
  private activeSapper: Enemy | null = null;
  private sapperUnmark: (() => void) | null = null;

  // Deck relocation tracking
  private deckActive = false;
  private deckPostIdx = 0;
  private readonly deckRelocated = new Set<number>();

  // Harbourmaster surrender
  private harbourBody: Enemy | null = null;
  private harbourUnmark: (() => void) | null = null;
  private harbourUnprompt: (() => void) | null = null;
  private harbourResolved = false;

  constructor(
    private readonly ctx: Ctx,
    private readonly runner: MissionRunner,
    private readonly ui: CampaignHud,
  ) {
    this.materials = new ModelMaterials(ctx);

    // Build Slip Boot HUD bar
    const bootPctEl = span('fc-pct', '0%');
    this.bootFill = div('fc-fill');
    const bootClauseEl = div('fc-clause');
    this.bootEl = div(
      'fc-bar fc-boot',
      div('fc-head', span('fc-title', 'DISTRAINT 4 // SYSTEM BOOT'), bootPctEl),
      div('fc-track', this.bootFill),
      bootClauseEl,
    );
    this.bootPct = new Label(bootPctEl);
    this.bootClause = new Label(bootClauseEl);

    // Build Old Mother Boss HUD bar
    const bossPhaseEl = span('fc-phase', 'PHASE I — HUNT');
    const bossPctEl = span('fc-pct', '100%');
    this.bossFill = div('fc-fill boss');
    this.bossPips = new Map<string, HTMLElement>();
    const pipDefs: readonly [string, string][] = [
      ['trackL', 'PORT TRACK'],
      ['trackR', 'STBD TRACK'],
      ['turretF', 'FORE GUN'],
      ['turretA', 'AFT GUN'],
      ['launcher', 'POD'],
      ['engine', 'ENGINE'],
    ];
    const pipRow = div('fc-pips');
    for (const [id, label] of pipDefs) {
      const pip = span('fc-pip', label);
      this.bossPips.set(id, pip);
      pipRow.append(pip);
    }
    this.bossEl = div(
      'fc-bar fc-boss',
      div('fc-head', span('fc-title', 'OLD MOTHER // SALT CRAWLER'), bossPhaseEl, bossPctEl),
      div('fc-track', this.bossFill),
      pipRow,
    );
    this.bossPhase = new Label(bossPhaseEl);
    this.bossPct = new Label(bossPctEl);

    this.ui.el.append(this.bootEl, this.bossEl);

    // Track Harbourmaster kill or deck crew arrivals
    ctx.events.on('enemy:killed', e => {
      if (this.harbourBody && e.enemy.uid === this.harbourBody.uid && !this.harbourResolved) {
        this.resolveHarbour(false);
      }
      if (this.activeSapper && e.enemy.uid === this.activeSapper.uid) {
        this.clearSapperTrack();
      }
    });
    ctx.events.on('enemy:spawned', e => {
      if (this.deckActive && this.crawler?.root.visible && this.crawler.state.phase === 'deck') {
        this.relocateToDeck(e.enemy as Enemy);
      }
    });
  }

  private get manager(): EnemyManager {
    return this.ctx.enemies as EnemyManager;
  }

  private get vehicles(): VehicleSystem | null {
    return this.manager.vehicles ?? null;
  }

  private get callins(): CallinsAccess['callInsManager'] | undefined {
    return (this.ctx.progression as unknown as CallinsAccess).callInsManager;
  }

  private get frame(): Frame | null {
    return this.callins?.frame ?? null;
  }

  /**
   * Wraps `host.frame` so an `eject` step always lands the player squarely on Old Mother's real walkable deck
   * wherever she halted on the salt pans, and activates Old Mother's deck colliders just before launch.
   */
  wrapFrame(host: GameHost): void {
    const base = host.frame.bind(host);
    host.frame = (act, at, done) => {
      if (act === 'eject' && this.crawler?.root.visible) {
        this.crawler.enterDeck(false);
        const landing = this.crawler.deckLandingPoint(_v);
        const mark: Mark = { at: [landing.x, landing.y, landing.z], yaw: this.crawler.yaw };
        base(act, mark, done);
        return;
      }
      base(act, at, done);
    };
  }

  /** Ensures persistent Holdfast entities (FlakTower, OldMother, Wanted posters) exist once the scene is open. */
  ensureBuilt(): void {
    if (this.builtWorld) return;
    this.builtWorld = true;
    this.flak = new FlakTower(this.ctx, this.vehicles);
    this.crawler = new OldMother(this.ctx, this.vehicles);
    this.crawler.setSeizeHook(() => {
      const f = this.frame;
      if (f) f.breach = true;
      this.ctx.camera.addTrauma(0.95);
    });
    this.buildWantedPosters();
    this.buildSlipWreck();
  }

  /** Dispatches `fc.*` mission script calls. */
  call(name: string, arg = ''): void {
    this.ensureBuilt();
    switch (name) {
      case 'fc.flakSalvo': {
        const mark = this.runner.mission.marks[arg || 'courierHit'];
        if (mark && this.flak) {
          this.flak.salvoAt(_v.set(...mark.at));
        }
        return;
      }
      case 'fc.slipWreck':
        this.showSlipWreck(true);
        return;
      case 'fc.slipBoot': {
        const secs = Math.max(10, Number(arg) || 85);
        this.showSlipWreck(true);
        this.startSlipBoot(secs);
        return;
      }
      case 'fc.slipBootOff':
        this.stopSlipBoot();
        return;
      case 'fc.sappers':
        this.sappersOn = arg !== 'off';
        if (!this.sappersOn) this.clearSapperTrack();
        else this.sapperIn = 6;
        return;
      case 'fc.flakStart':
        this.sappersOn = false;
        this.clearSapperTrack();
        this.flak?.setActive(true);
        return;
      case 'fc.motherReveal':
        this.flak?.setActive(false);
        this.crawler?.reveal();
        return;
      case 'fc.motherFight':
        this.flak?.setActive(false);
        this.deckActive = false;
        this.deckRelocated.clear();
        this.crawler?.startFight();
        this.bossVisible = true;
        this.bossEl.classList.add('on');
        return;
      case 'fc.motherDeck':
        this.enterDeckStage();
        return;
      case 'fc.surrender':
        this.spawnHarbourmaster();
        return;
      case 'fc.hideBoss':
        this.bossVisible = false;
        this.bossEl.classList.remove('on');
        return;
      default:
        console.warn(`[foreclosure] unknown call ${name}`);
    }
  }

  private enterDeckStage(): void {
    this.deckActive = true;
    this.deckPostIdx = 0;
    this.deckRelocated.clear();
    if (!this.crawler) return;
    const alreadyOnDeck = this.crawler.root.visible && this.crawler.state.phase === 'deck';
    if (!alreadyOnDeck) {
      // Checkpoint / ?beat=deck start: place Old Mother at her default salt-pan position and put the player on deck.
      this.crawler.enterDeck(true);
      const land = this.crawler.deckLandingPoint(_v);
      this.ctx.player.teleport(land, this.crawler.yaw);
    }
    this.bossVisible = true;
    this.bossEl.classList.add('on');
    // Place the autocannon rack squarely on Old Mother's deck so it matches wherever she stopped.
    const gunAt = this.crawler.deckGunPoint(_v2);
    const host = this.runner.host as unknown as GameHost;
    if (host.racks) {
      host.racks.pull('autocannon');
      host.racks.add('autocannon', { at: [gunAt.x, gunAt.y, gunAt.z] }, () => this.runner.signal('took:autocannon'));
    }
  }

  private relocateToDeck(enemy: Enemy): void {
    if (!this.crawler || this.deckRelocated.has(enemy.uid)) return;
    if (this.harbourBody && enemy.uid === this.harbourBody.uid) return;
    this.deckRelocated.add(enemy.uid);
    const post = DECK_POSTS[this.deckPostIdx % DECK_POSTS.length]!;
    this.deckPostIdx++;
    const worldPos = this.crawler.localToWorld(post[0], post[1], post[2], _v);
    enemy.position.copy(worldPos);
    enemy.char?.root.position.copy(worldPos);
    enemy.velocity.set(0, 0, 0);
  }

  // -----------------------------------------------------------------------------------------------
  // Slip set piece: burning courier wreck + usable torn-off door gun + Bureau T&C boot ticker
  // -----------------------------------------------------------------------------------------------

  private buildSlipWreck(): void {
    const b = new ModelBuilder();
    // Crashed Bureau Packmule fuselage tail & crumpled wing on the Slip floor beside courierWreck.
    b.box(3.4, 2.2, 6.2, '#1f2328', { at: [0, 1.1, 0], rot: [0.12, 0.35, -0.26] });
    b.box(1.4, 1.6, 5.4, '#181b20', { at: [1.8, 1.6, -4.4], rot: [0.22, 0.55, -0.18] });
    b.box(5.8, 0.35, 1.8, '#282d34', { at: [-2.6, 1.0, 0.6], rot: [-0.08, 0.2, 0.34] });
    b.box(0.4, 2.0, 1.6, '#b82a20', { at: [2.4, 2.5, -6.4], rot: [0.18, 0.55, -0.24] });
    // Red Bureau warning beacon light housing on the broken fuselage spine.
    b.glow(new THREE.BoxGeometry(0.32, 0.18, 0.32), '#ff3322', 3.4, { at: [0.2, 2.35, 0.4] });
    // Scattered cargo crates & bent harness framing the Slip defence.
    b.box(1.8, 1.2, 2.2, '#3a4048', { at: [-4.6, 0.6, 2.8], rot: [0, 0.45, 0] });
    b.box(1.4, 0.9, 1.4, '#4c3e2e', { at: [-3.4, 0.45, 4.4], rot: [0, -0.2, 0] });
    b.box(1.6, 1.0, 2.0, '#3a4048', { at: [4.2, 0.5, 2.2], rot: [0, -0.5, 0] });
    const group = this.materials.group(b);

    const at = PLACES.courierWreck!.at;
    group.position.set(at[0], at[1], at[2]);
    group.visible = false;
    this.ctx.render.scene.add(group);
    this.wreckGroup = group;

    const fireLight = new THREE.PointLight(0xff6b22, 0, 22, 1.6);
    fireLight.position.set(at[0], at[1] + 2.8, at[2]);
    this.ctx.render.scene.add(fireLight);
    this.wreckLight = fireLight;
  }

  private showSlipWreck(on: boolean): void {
    if (this.wreckGroup) this.wreckGroup.visible = on;
    if (this.wreckLight) this.wreckLight.intensity = on ? 2.4 : 0;
    if (on && !this.wreckSmoke && this.wreckGroup) {
      this.wreckSmoke = this.ctx.fx.attachEmitter(this.wreckGroup, 'fireTrail', undefined, 900);
    }
    if (!on && this.wreckSmoke) {
      this.wreckSmoke.stop();
      this.wreckSmoke = null;
    }
    // Place the torn-off courier door gun as a usable Level 3 Minigun emplacement facing the Slip's north/west ramps.
    if (on && !this.doorGun && this.callins?.emplacements) {
      const dg = PLACES.doorGun!;
      this.doorGun = this.callins.emplacements.place({
        pos: new THREE.Vector3(...dg.at),
        yaw: dg.yaw ?? 0,
        arc: Math.PI * 0.72,
        level: 3,
      });
    }
  }

  private startSlipBoot(seconds: number): void {
    this.bootTotal = seconds;
    this.bootElapsed = 0;
    this.bootActive = true;
    this.bootDoneSignalled = false;
    this.bootEl.classList.add('on');
    this.updateBootHud();
    // Pose the Distraint Frame kneeling/booting in the Slip so the player is defending the real machine.
    const f = this.frame;
    if (f && !f.occupied) {
      const m = PLACES.frame!;
      f.stand(_v.set(...m.at), m.yaw ?? Math.PI);
    }
  }

  private stopSlipBoot(): void {
    this.bootActive = false;
    this.bootEl.classList.remove('on');
  }

  private updateBootHud(): void {
    const pct = clamp(this.bootTotal > 0 ? this.bootElapsed / this.bootTotal : 1);
    const whole = Math.floor(pct * 100);
    this.bootPct.set(`${whole}%`);
    this.bootFill.style.transform = `scaleX(${pct.toFixed(4)})`;
    const idx = Math.floor((this.bootElapsed / 7.5)) % BOOT_CLAUSES.length;
    this.bootClause.set(BOOT_CLAUSES[idx]!);
  }

  // -----------------------------------------------------------------------------------------------
  // Environmental storytelling: Bureau Red-Goggles Wanted Posters
  // -----------------------------------------------------------------------------------------------

  private buildWantedPosters(): void {
    if (typeof document === 'undefined') return;
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 360;
    const g = canvas.getContext('2d');
    if (!g) return;
    // Salt-stained weathered paper
    g.fillStyle = '#ddd2ba';
    g.fillRect(0, 0, 256, 360);
    g.fillStyle = '#181c20';
    g.fillRect(14, 14, 228, 48);
    g.fillStyle = '#e23a2c';
    g.font = 'bold 34px monospace';
    g.textAlign = 'center';
    g.fillText('WANTED', 128, 50);
    // Silhouette of the contractor helmet + glowing red goggles
    g.fillStyle = '#14171c';
    g.beginPath();
    g.arc(128, 152, 54, 0, Math.PI * 2);
    g.fill();
    g.fillRect(66, 178, 124, 64);
    // Glowing red visor slit / goggles
    g.fillStyle = '#ff2a1f';
    g.fillRect(88, 140, 80, 18);
    g.fillStyle = '#ff9880';
    g.fillRect(94, 145, 68, 7);
    // Warning copy
    g.fillStyle = '#14171c';
    g.font = 'bold 18px monospace';
    g.fillText('REPORT RED GOGGLES', 128, 274);
    g.font = 'bold 14px monospace';
    g.fillText('SIGHTED: PORT VELL / CARROW', 128, 302);
    g.fillText('11 PORTS — DAY 1 — DO NOT ENGAGE', 128, 326);
    g.strokeStyle = '#181c20';
    g.lineWidth = 4;
    g.strokeRect(10, 10, 236, 340);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, metalness: 0.05 });
    const geo = new THREE.PlaneGeometry(1.15, 1.62);
    const group = new THREE.Group();
    for (const p of WANTED_PLACES) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(p.at[0], p.at[1], p.at[2]);
      m.rotation.y = p.yaw;
      group.add(m);
    }
    this.ctx.render.scene.add(group);
    this.posters = group;
  }

  // -----------------------------------------------------------------------------------------------
  // Sappers during `foreclosure`
  // -----------------------------------------------------------------------------------------------

  private updateSappers(dt: number): void {
    const f = this.frame;
    if (!this.sappersOn || !f || !f.occupied) return;

    if (this.activeSapper) {
      const e = this.activeSapper;
      if (!e.alive || e.health <= 0) {
        this.clearSapperTrack();
        return;
      }
      const d = Math.hypot(e.position.x - f.walker.feet.x, e.position.z - f.walker.feet.z);
      if (d <= SAPPER_REACH && !f.hasSapper) {
        f.attachSapper(5);
        this.clearSapperTrack();
        this.sapperIn = SAPPER_INTERVAL;
      }
      return;
    }

    if (f.hasSapper) return;
    this.sapperIn -= dt;
    if (this.sapperIn > 0) return;

    // Pick nearest living mobile human enemy within 38 m to rush the Frame's legs.
    let best: Enemy | null = null;
    let bestD = 38;
    for (const raw of this.ctx.enemies.alive) {
      const e = raw as Enemy;
      if (!e.alive || e.dummy) continue;
      if (e.id !== 'trooper' && e.id !== 'brute' && e.id !== 'gunner') continue;
      const d = Math.hypot(e.position.x - f.walker.feet.x, e.position.z - f.walker.feet.z);
      if (d < 6 || d > bestD) continue;
      bestD = d;
      best = e;
    }
    if (!best) {
      this.sapperIn = 3;
      return;
    }
    this.activeSapper = best;
    this.sapperUnmark = this.ctx.hud.marker(best.position, 'SAPPER', '#ffae33');
    this.ctx.hud.feed('SAPPER CLOSING ON LEGS — SHOOT OR STOMP', '#ffae33');
    this.sapperIn = SAPPER_INTERVAL;
  }

  private clearSapperTrack(): void {
    this.sapperUnmark?.();
    this.sapperUnmark = null;
    this.activeSapper = null;
  }

  // -----------------------------------------------------------------------------------------------
  // Harbourmaster surrender on Old Mother's stern deck
  // -----------------------------------------------------------------------------------------------

  private spawnHarbourmaster(): void {
    if (this.harbourBody || this.harbourResolved || !this.crawler) return;
    const at = this.crawler.harbourmasterPoint(_v);
    const e = this.manager.spawn('warden', at) as Enemy | null;
    if (!e) {
      this.resolveHarbour(true);
      return;
    }
    e.attacks = [];
    e.behaviours = [];
    e.barkAt = Infinity;
    e.mode = 'hold';
    e.face = 'player';
    e.dummy = true;
    for (const plate of e.plates) plate.mesh.visible = false;
    e.plates = [];
    e.armor = 0;
    e.maxHealth = 120;
    e.health = 120;
    const s = soldierOf(e);
    if (s) s.holdout = true;
    pose(e, 'handsUp');
    this.harbourBody = e;
    this.harbourUnmark = this.ctx.hud.marker(e.position, 'HARBOURMASTER', '#ffc14a');
  }

  private updateHarbourmaster(): void {
    const h = this.harbourBody;
    if (!h || this.harbourResolved) return;
    if (!h.alive) {
      this.resolveHarbour(false);
      return;
    }
    const p = this.ctx.player.position;
    const d = p.distanceTo(h.position);
    if (d <= CUFF_REACH) {
      if (!this.harbourUnprompt) {
        const key = this.ctx.input.labelFor?.('interact') ?? 'E';
        this.harbourUnprompt = this.ctx.hud.follow(
          _v.copy(h.position).setY(h.position.y + 2.0).clone(),
          `${key} CUFF HARBOURMASTER`,
          '#ffc14a',
        );
      }
      if (this.ctx.input.pressed('interact')) {
        this.resolveHarbour(true);
      }
    } else if (this.harbourUnprompt) {
      this.harbourUnprompt();
      this.harbourUnprompt = null;
    }
  }

  private resolveHarbour(cuffed: boolean): void {
    if (this.harbourResolved) return;
    this.harbourResolved = true;
    this.harbourUnmark?.();
    this.harbourUnmark = null;
    this.harbourUnprompt?.();
    this.harbourUnprompt = null;
    if (cuffed) {
      this.ctx.audio.play('metal_clang', { pitch: 1.35, volume: 0.65 });
      this.ctx.hud.feed('HARBOURMASTER DETAINED — SCHEDULED FOR TALLOW', '#ffc14a');
      this.runner.signal('fc:cuffed');
    } else {
      this.ctx.hud.feed('HARBOURMASTER REMOVED — PROCESSING FEE ADJUSTED', '#e23a2c');
      this.runner.signal('fc:killed');
    }
    this.runner.signal('fc:harbourDone');
  }

  // -----------------------------------------------------------------------------------------------
  // Boss HUD update
  // -----------------------------------------------------------------------------------------------

  private updateBossHud(): void {
    if (!this.bossVisible || !this.crawler || !this.crawler.root.visible) return;
    const st = this.crawler.state;
    const pct = clamp(st.barFraction());
    this.bossPct.set(`${Math.round(pct * 100)}%`);
    this.bossFill.style.transform = `scaleX(${pct.toFixed(4)})`;
    const phaseLabel =
      st.phase === 'hunt' ? 'PHASE I — HUNT'
      : st.phase === 'drag' ? 'PHASE II — DRAG'
      : st.phase === 'seizing' ? 'HULL BREACH'
      : st.phase === 'deck' ? 'PHASE III — STERN ENGINE'
      : 'DISABLED';
    this.bossPhase.set(phaseLabel);
    for (const [id, el] of this.bossPips) {
      const broken = st.hp[id as keyof typeof st.hp] <= 0;
      const highlight = st.phase === 'deck' && id === 'engine';
      el.classList.toggle('dead', broken);
      el.classList.toggle('hot', highlight && !broken);
    }
    if (st.phase === 'dead') {
      this.bossVisible = false;
      this.bossEl.classList.remove('on');
    }
  }

  // -----------------------------------------------------------------------------------------------
  // Frame update & reset
  // -----------------------------------------------------------------------------------------------

  update(dt: number): void {
    if (!this.builtWorld) return;
    if (this.wreckLight && this.wreckLight.intensity > 0) {
      this.wreckLight.intensity = 2.0 + Math.sin(this.ctx.time.elapsed * 9.3) * 0.45 + rand(-0.15, 0.15);
    }
    if (this.bootActive) {
      this.bootElapsed += dt;
      this.updateBootHud();
      if (this.bootElapsed >= this.bootTotal && !this.bootDoneSignalled) {
        this.bootDoneSignalled = true;
        this.stopSlipBoot();
        this.ctx.audio.play('steam_burst', { pitch: 0.7, volume: 0.9 });
        this.ctx.audio.play('metal_groan', { pitch: 0.65, volume: 0.9 });
        this.ctx.hud.feed('DISTRAINT 4 ONLINE — READY TO BOARD', '#7ee787');
        this.runner.signal('fc:booted');
      }
    }
    this.updateSappers(dt);
    this.updateHarbourmaster();
    this.updateBossHud();
  }

  clear(): void {
    this.stopSlipBoot();
    this.bossVisible = false;
    this.bossEl.classList.remove('on');
    this.sappersOn = false;
    this.clearSapperTrack();
    this.deckActive = false;
    this.deckRelocated.clear();
    this.showSlipWreck(false);
    this.flak?.reset();
    this.crawler?.hide();
    if (this.harbourBody) {
      if (this.harbourBody.alive) this.manager.withdraw(this.harbourBody);
      this.harbourBody = null;
    }
    this.harbourUnmark?.();
    this.harbourUnmark = null;
    this.harbourUnprompt?.();
    this.harbourUnprompt = null;
    this.harbourResolved = false;
  }
}
