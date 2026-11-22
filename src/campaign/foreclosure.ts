/**
 * Foreclosure's set pieces and director (`campaign/missions/foreclosure.ts`, `docs/proposals/mission-2-plan.md`):
 * everything specific to Holdfast that no general system owns, reached by `fc.*` calls from the mission script.
 *
 *   flak        Physics-enabled 26-block destructible 4-gun FlakTower (`enemies/vehicles/flakTower.ts`).
 *   mother      Old Mother (`enemies/vehicles/crawler.ts`), active 3-stage 30 m salt crawler boss.
 *   rival       Harbourmaster's Ironclad RivalFrame (`enemies/vehicles/rivalFrame.ts`) Mech-vs-Mech duel.
 *   upgradePod  Golden orbital 105mm Howitzer UpgradePod (`progression/pickups/upgradePod.ts`).
 *   slip        Crashed courier fuselage + torn-off door gun + interactive `[E]` Frame boot & T&C ticker.
 *   barracks    Live Holdfast garrison barracks spawners coupled to `world.objects.destruction` clusters.
 *   rampage     Mech Rampage demolition tracker + Gantry/Quay Crane collapse Sabot Rifle drop.
 *   surrender   Real Outpost surrendered Harbourmaster (native Hold-`E` cuffing + Bureau Extraction Drone +$5,000 bonus).
 *   nuke        Council-authorised free Tactical Nuke (`[N]` from Frame or foot) targeted at Holdfast `[65, 0, -10]`.
 *   ledger      Bureau Asset Liquidation HUD Ticker listening to `'world:liquidated'`.
 *   posters     Bureau red-goggles wanted posters placed along Holdfast's main route (story thread from `STORY.md`).
 */
import * as THREE from 'three';
import type { Ctx, EmitterHandle, StructuralClusterLike } from '../core/contracts';
import type { EnemyId } from '../core/gameplay';
import { clamp, rand } from '../core/math';
import type { Enemy } from '../enemies/Enemy';
import type { EnemyManager } from '../enemies/EnemyManager';
import { pose, soldierOf } from '../enemies/outpost/soldier';
import { FlakTower } from '../enemies/vehicles/flakTower';
import { OldMother } from '../enemies/vehicles/crawler';
import { RivalFrame } from '../enemies/vehicles/rivalFrame';
import type { VehicleSystem } from '../enemies/vehicles';
import type { Frame } from '../frame/seat';
import { ModelBuilder, ModelMaterials } from '../progression/modelkit';
import { UpgradePod } from '../progression/pickups/upgradePod';
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

/** Deck crew spawn offsets in Old Mother's local frame (kept for legacy deck support). */
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
const SLIP_BOOT_REACH = 7.2;
const CUFF_REACH = 4.2;
const HARBOUR_CAPTURE_BONUS = 5000;
const BARRACKS_SPAWN_MIN = 13;
const BARRACKS_SPAWN_MAX = 18;
const BARRACKS_POP_CAP = 16;
const LEDGER_MAX_ITEMS = 5;
const LEDGER_ITEM_TTL = 6.5;

/** Heart of Holdfast (Market/Stacks/Quay nexus): Ground Zero for the final Tactical Nuke liquidation. */
const NUKE_TARGET = new THREE.Vector3(65, 0, -10);

/** Rampage target cluster tags tracked during the `foreclosure` Mech Rampage beat (Tier 1 & Tier 2 only, never Tier-3 quayCrane). */
const RAMPAGE_TAGS: readonly string[] = [
  'cannery',
  'marketHall.west',
  'marketHall.east',
  'gantryCrane',
  'barracks.cannery',
  'barracks.stacks',
  'barracks.market',
];

const WANTED_PLACES: readonly { at: readonly [number, number, number]; yaw: number }[] = [
  { at: [65.4, 2.2, 49.4], yaw: 0 },        // Main gate south face
  { at: [58.4, 2.1, 28.0], yaw: Math.PI / 2 }, // Market Square west face
  { at: [49.4, 2.4, -4.0], yaw: Math.PI / 2 }, // Crane aisle container face
  { at: [75.8, 7.6, -59.0], yaw: Math.PI }, // Quay crane cab wall
];

const FLAK_PIP_DEFS: readonly [string, string][] = [
  ['gun0', 'FLAK 1'],
  ['gun1', 'FLAK 2'],
  ['gun2', 'FLAK 3'],
  ['gun3', 'FLAK 4'],
  ['core', 'CORE'],
];

const MOTHER_PIP_DEFS: readonly [string, string][] = [
  ['trackL', 'PORT TRACK'],
  ['trackR', 'STBD TRACK'],
  ['turretF', 'FORE GUN'],
  ['turretA', 'AFT GUN'],
  ['launcher', 'POD'],
  ['engine', 'ENGINE'],
];

const RIVAL_PIP_DEFS: readonly [string, string][] = [
  ['rotary', 'ROTARY ARM'],
  ['cannon', 'HEAVY CANNON'],
  ['jets', 'JUMP JETS'],
];

type BossMode = 'none' | 'flak' | 'mother' | 'rival';

interface BarracksSpawner {
  tag: string;
  timer: number;
  unmark: (() => void) | null;
}

interface LedgerRow {
  el: HTMLElement;
  age: number;
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _from = new THREE.Vector3();

interface CallinsAccess {
  callInsManager?: {
    frame: Frame;
    emplacements: Emplacements;
    shut: boolean;
    held: Set<string>;
    targeting?: { exit(): void };
    cooldowns?: Record<string, number>;
    mark?: { point: THREE.Vector3; heading: THREE.Vector3; seed?: number };
    fly?(id: string): void;
    grant?(id: string): void;
  };
}

function formatDollars(amount: number): string {
  return `$${Math.round(amount).toLocaleString('en-US')}`;
}

export class Foreclosure {
  private readonly materials: ModelMaterials;
  private flak: FlakTower | null = null;
  private crawler: OldMother | null = null;
  private rivalFrame: RivalFrame | null = null;
  private upgradePod: UpgradePod | null = null;
  private posters: THREE.Group | null = null;
  private wreckGroup: THREE.Group | null = null;
  private wreckLight: THREE.PointLight | null = null;
  private wreckSmoke: EmitterHandle | null = null;
  private doorGun: Emplacement | null = null;
  private builtWorld = false;

  // Slip interactive boot & progress HUD
  private readonly bootEl: HTMLElement;
  private readonly bootPct: Label;
  private readonly bootFill: HTMLElement;
  private readonly bootClause: Label;
  private bootTotal = 85;
  private bootElapsed = 0;
  private bootWaiting = false;
  private bootActive = false;
  private bootWave1Sent = false;
  private bootWave2Sent = false;
  private bootDoneSignalled = false;
  private bootUnprompt: (() => void) | null = null;
  private bootUnmark: (() => void) | null = null;

  // Unified Boss HUD (Flak Tower / Old Mother / Harbourmaster Rival Frame)
  private readonly bossEl: HTMLElement;
  private readonly bossTitle: Label;
  private readonly bossPhase: Label;
  private readonly bossPct: Label;
  private readonly bossFill: HTMLElement;
  private readonly bossPipRow: HTMLElement;
  private readonly bossPips = new Map<string, HTMLElement>();
  private bossMode: BossMode = 'none';

  // Bureau Asset Liquidation HUD Ticker
  private readonly ledgerEl: HTMLElement;
  private readonly ledgerTotal: Label;
  private readonly ledgerItemsEl: HTMLElement;
  private readonly ledgerRows: LedgerRow[] = [];
  private ledgerTarget = 0;
  private ledgerDisplay = 0;
  private ledgerFlash = 0;

  // Tactical Nuke Authorization Prompt
  private readonly nukePromptEl: HTMLElement;
  private readonly nukePromptText: Label;
  private nukeAuthorized = false;
  private nukeLaunched = false;
  private nukeDetonated = false;

  // Sappers during `foreclosure`
  private sappersOn = false;
  private sapperIn = 7;
  private activeSapper: Enemy | null = null;
  private sapperUnmark: (() => void) | null = null;

  // Barracks garrison doorway spawners
  private readonly barracksSpawners = new Map<string, BarracksSpawner>();

  // Mech Rampage structural liquidation tracker + crane sabotage Sabot drop
  private rampageActive = false;
  private rampageDoneSignalled = false;
  private readonly rampageTargets = new Set<string>();
  private readonly rampageMarkers = new Map<string, () => void>();
  private craneSabotDropped = false;

  // Deck relocation tracking (legacy fallback)
  private deckActive = false;
  private deckPostIdx = 0;
  private readonly deckRelocated = new Set<number>();

  // Harbourmaster surrender (native Outpost prisoner + airlift extraction drone)
  private harbourBody: Enemy | null = null;
  private harbourUsesNativePrisoner = false;
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

    // Build unified Boss HUD bar (Flak Tower / Old Mother / Rival Frame)
    const bossTitleEl = span('fc-title', 'OLD MOTHER // SALT CRAWLER');
    const bossPhaseEl = span('fc-phase', 'PHASE I — HUNT');
    const bossPctEl = span('fc-pct', '100%');
    this.bossFill = div('fc-fill boss');
    this.bossPipRow = div('fc-pips');
    this.bossEl = div(
      'fc-bar fc-boss',
      div('fc-head', bossTitleEl, bossPhaseEl, bossPctEl),
      div('fc-track', this.bossFill),
      this.bossPipRow,
    );
    this.bossTitle = new Label(bossTitleEl);
    this.bossPhase = new Label(bossPhaseEl);
    this.bossPct = new Label(bossPctEl);

    // Build Bureau Asset Liquidation HUD Ticker
    const ledgerTotalEl = span('fc-ledger-total', '$0');
    this.ledgerItemsEl = div('fc-ledger-items');
    this.ledgerEl = div(
      'fc-ledger',
      div('fc-ledger-head', span('fc-ledger-tag', 'BUREAU ASSET LIQUIDATION'), ledgerTotalEl),
      this.ledgerItemsEl,
    );
    this.ledgerTotal = new Label(ledgerTotalEl);

    // Build Tactical Nuke authorization prompt
    const nukeTextEl = span('fc-nuke-text', 'PRESS [N] OR CALL IN NUKE — LIQUIDATE HOLDFAST');
    this.nukePromptEl = div(
      'fc-nuke-prompt',
      span('fc-nuke-badge', 'COUNCIL FINAL AUTHORISATION'),
      nukeTextEl,
    );
    this.nukePromptText = new Label(nukeTextEl);

    this.ui.el.append(this.bootEl, this.bossEl, this.ledgerEl, this.nukePromptEl);

    // Track Harbourmaster kill, native cuffing, escape fallback, and sapper deaths
    ctx.events.on('enemy:killed', e => {
      if (this.harbourBody && e.enemy.uid === this.harbourBody.uid && !this.harbourResolved) {
        this.resolveHarbour(false);
      }
      if (this.activeSapper && e.enemy.uid === this.activeSapper.uid) {
        this.clearSapperTrack();
      }
    });
    ctx.events.on('prisoner:cuffed', e => {
      if (this.harbourBody && e.enemy.uid === this.harbourBody.uid && !this.harbourResolved) {
        this.resolveHarbour(true);
      }
    });
    ctx.events.on('enemy:escaped', e => {
      if (this.harbourBody && e.enemy.uid === this.harbourBody.uid && !this.harbourResolved) {
        this.resolveHarbour(true);
      }
    });
    ctx.events.on('enemy:spawned', e => {
      if (this.deckActive && this.crawler?.root.visible && this.crawler.state.phase === 'deck') {
        this.relocateToDeck(e.enemy as Enemy);
      }
    });

    // Bureau Asset Liquidation ticker + crane sabotage Sabot drop
    ctx.events.on('world:liquidated', e => {
      this.recordLiquidation(e.label, e.value);
      this.onStructureLiquidated(e.label, e.kind, e.position);
    });

    // Nuke call-in & detonation wiring
    ctx.events.on('callin:used', e => {
      if (e.id === 'nuke' && this.nukeAuthorized) {
        this.nukeLaunched = true;
        this.nukePromptEl.classList.remove('on');
      }
    });
    (ctx.events as unknown as { on(type: string, fn: (e: { position?: THREE.Vector3 }) => void): void }).on(
      'nuke:detonated',
      () => this.onNukeDetonated(),
    );
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
   * if ever invoked directly.
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

  /** Ensures persistent Holdfast entities (FlakTower, OldMother, RivalFrame, UpgradePod, Wanted posters) exist once open. */
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
    this.rivalFrame = new RivalFrame(this.ctx, this.vehicles);
    this.rivalFrame.onEjected = pos => {
      this.spawnHarbourmasterAt(pos);
    };
    this.upgradePod = new UpgradePod(this.ctx, this.materials);
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
        if (arg.startsWith('fastRope:')) {
          this.spawnFastRopeHeli(arg.slice('fastRope:'.length));
          return;
        }
        this.showSlipWreck(true);
        return;
      case 'fc.slipReady': {
        const secs = Math.max(10, Number(arg) || 85);
        this.showSlipWreck(true);
        this.armSlipReady(secs);
        return;
      }
      case 'fc.slipBoot': {
        if (arg.startsWith('ready:')) {
          const secs = Math.max(10, Number(arg.slice('ready:'.length)) || 85);
          this.showSlipWreck(true);
          this.armSlipReady(secs);
          return;
        }
        const secs = Math.max(10, Number(arg) || 85);
        this.showSlipWreck(true);
        this.startSlipBoot(secs);
        return;
      }
      case 'fc.slipBootOff':
        this.stopSlipBoot();
        return;
      case 'fc.fastRope':
        this.spawnFastRopeHeli(arg);
        return;
      case 'fc.barracksStart':
        this.startBarracks(arg);
        return;
      case 'fc.barracksStop':
        this.stopBarracks();
        return;
      case 'fc.sappers':
        if (arg === 'barracks:stop') {
          this.stopBarracks();
          return;
        }
        if (arg.startsWith('barracks:')) {
          this.startBarracks(arg.slice('barracks:'.length));
          return;
        }
        if (arg === 'rampage') {
          this.startRampage();
          return;
        }
        this.sappersOn = arg !== 'off';
        if (!this.sappersOn) this.clearSapperTrack();
        else this.sapperIn = 6;
        return;
      case 'fc.rampageStart':
        this.startRampage();
        return;
      case 'fc.dropHowitzerPod':
        this.dropHowitzerPod(arg || 'howitzerPod');
        return;
      case 'fc.equipHowitzer':
        this.frame?.installWeapon('howitzer105', true);
        return;
      case 'fc.flakStart':
        if (arg.startsWith('pod:')) {
          this.dropHowitzerPod(arg.slice('pod:'.length) || 'howitzerPod');
          return;
        }
        if (arg === 'equip') {
          this.frame?.installWeapon('howitzer105', true);
          return;
        }
        this.sappersOn = false;
        this.clearSapperTrack();
        this.flak?.setActive(true);
        this.setBossMode('flak');
        return;
      case 'fc.motherReveal':
        this.flak?.setActive(false);
        this.crawler?.reveal();
        return;
      case 'fc.motherFight':
        this.flak?.setActive(false);
        this.rivalFrame?.hide();
        this.deckActive = false;
        this.deckRelocated.clear();
        this.crawler?.startFight();
        this.setBossMode('mother');
        return;
      case 'fc.motherDeck':
        if (arg.startsWith('rival:')) {
          this.spawnRivalFrame(arg.slice('rival:'.length) || 'rivalSpawn');
          return;
        }
        this.enterDeckStage();
        return;
      case 'fc.rivalSpawn':
        this.spawnRivalFrame(arg || 'rivalSpawn');
        return;
      case 'fc.surrender':
        this.spawnHarbourmasterAt();
        return;
      case 'fc.nukeAuthorize':
        this.authorizeNuke();
        return;
      case 'fc.hideBoss':
        if (arg === 'nuke') {
          this.authorizeNuke();
          return;
        }
        this.setBossMode('none');
        return;
      default:
        console.warn(`[foreclosure] unknown call ${name}`);
    }
  }

  // -----------------------------------------------------------------------------------------------
  // Unified Boss HUD (Flak Tower / Old Mother / Harbourmaster Ironclad Frame)
  // -----------------------------------------------------------------------------------------------

  private setBossMode(mode: BossMode): void {
    this.bossMode = mode;
    this.bossPips.clear();
    this.bossPipRow.replaceChildren();
    if (mode === 'none') {
      this.bossEl.classList.remove('on');
      return;
    }
    const defs = mode === 'flak' ? FLAK_PIP_DEFS : mode === 'mother' ? MOTHER_PIP_DEFS : RIVAL_PIP_DEFS;
    for (const [id, label] of defs) {
      const pip = span('fc-pip', label);
      this.bossPips.set(id, pip);
      this.bossPipRow.append(pip);
    }
    if (mode === 'flak') {
      this.bossTitle.set('FLAK TOWER // HARBOUR WALL');
    } else if (mode === 'mother') {
      this.bossTitle.set('OLD MOTHER // SALT CRAWLER');
    } else {
      this.bossTitle.set('HARBOURMASTER // IRONCLAD FRAME');
    }
    this.bossEl.classList.add('on');
    this.updateBossHud();
  }

  private updateBossHud(): void {
    if (this.bossMode === 'none') return;

    if (this.bossMode === 'flak') {
      if (!this.flak) return;
      const pct = clamp(this.flak.barFraction());
      this.bossPct.set(`${Math.round(pct * 100)}%`);
      this.bossFill.style.transform = `scaleX(${pct.toFixed(4)})`;
      this.bossPhase.set(
        this.flak.flattened ? 'RAZED'
        : this.flak.collapsing ? 'STRUCTURAL COLLAPSE!'
        : this.flak.aliveCount > 0 ? `${this.flak.aliveCount}/4 GUNS · ${Math.round(this.flak.towerIntegrity * 100)}% CORE`
        : `CORE INTEGRITY ${Math.round(this.flak.towerIntegrity * 100)}%`,
      );
      for (let i = 0; i < 4; i++) {
        const pip = this.bossPips.get(`gun${i}`);
        if (pip) {
          const dead = i >= this.flak.aliveCount;
          pip.classList.toggle('dead', dead);
          pip.classList.toggle('hot', !dead);
        }
      }
      const corePip = this.bossPips.get('core');
      if (corePip) {
        const broken = this.flak.flattened || this.flak.collapsing;
        corePip.classList.toggle('dead', broken);
        corePip.classList.toggle('hot', !broken && this.flak.aliveCount === 0);
      }
      if (this.flak.flattened) this.setBossMode('none');
      return;
    }

    if (this.bossMode === 'mother') {
      if (!this.crawler || !this.crawler.root.visible) return;
      const st = this.crawler.state;
      const pct = clamp(st.barFraction());
      this.bossPct.set(`${Math.round(pct * 100)}%`);
      this.bossFill.style.transform = `scaleX(${pct.toFixed(4)})`;
      const phaseLabel =
        st.phase === 'hunt' ? 'PHASE I — HUNT'
        : st.phase === 'drag' ? 'PHASE II — ENRAGED'
        : st.phase === 'seizing' ? 'REACTOR OVERLOAD'
        : st.phase === 'deck' ? 'PHASE III — STERN ENGINE EXPOSED'
        : 'DESTROYED';
      this.bossPhase.set(phaseLabel);
      for (const [id, el] of this.bossPips) {
        const broken = st.hp[id as keyof typeof st.hp] <= 0;
        const highlight = st.phase === 'deck' && id === 'engine';
        el.classList.toggle('dead', broken);
        el.classList.toggle('hot', highlight && !broken);
      }
      if (st.phase === 'dead') this.setBossMode('none');
      return;
    }

    if (this.bossMode === 'rival') {
      if (!this.rivalFrame) return;
      const pct = clamp(this.rivalFrame.barFraction());
      this.bossPct.set(`${Math.round(pct * 100)}%`);
      this.bossFill.style.transform = `scaleX(${pct.toFixed(4)})`;
      const phaseLabel =
        this.rivalFrame.phase === 'ejecting' ? 'PILOT EJECTING!'
        : this.rivalFrame.phase === 'wrecked' ? 'DISABLED'
        : this.rivalFrame.staggerLeft > 0 ? 'STAGGERED!'
        : this.rivalFrame.attack === 'cannon' ? 'HEAVY CANNON LOCK'
        : this.rivalFrame.attack === 'missile' ? 'MISSILE SALVO'
        : this.rivalFrame.attack === 'jump' ? 'JUMP-JET STOMP'
        : this.rivalFrame.attack === 'rotary' ? 'ROTARY SUPPRESSION'
        : 'MECH DUEL';
      this.bossPhase.set(phaseLabel);
      this.bossPips.get('rotary')?.classList.toggle('hot', this.rivalFrame.attack === 'rotary');
      this.bossPips.get('cannon')?.classList.toggle('hot', this.rivalFrame.attack === 'cannon');
      this.bossPips.get('jets')?.classList.toggle('hot', this.rivalFrame.attack === 'jump');
      if (this.rivalFrame.phase === 'wrecked' || this.rivalFrame.phase === 'idle') {
        this.setBossMode('none');
      }
    }
  }

  // -----------------------------------------------------------------------------------------------
  // Bureau Asset Liquidation HUD Ticker
  // -----------------------------------------------------------------------------------------------

  private recordLiquidation(label: string, value: number): void {
    if (!Number.isFinite(value) || value <= 0) return;
    this.ledgerTarget += value;
    this.ledgerFlash = 0.55;
    this.ledgerEl.classList.add('on', 'pulse');

    const rowEl = div(
      'fc-ledger-row',
      span('fc-ledger-val', `+${formatDollars(value)}`),
      span('fc-ledger-name', label.toUpperCase()),
    );
    this.ledgerItemsEl.prepend(rowEl);
    this.ledgerRows.unshift({ el: rowEl, age: 0 });
    while (this.ledgerRows.length > LEDGER_MAX_ITEMS) {
      const oldest = this.ledgerRows.pop()!;
      oldest.el.remove();
    }
  }

  private updateLedger(dt: number): void {
    if (this.ledgerDisplay < this.ledgerTarget) {
      const gap = this.ledgerTarget - this.ledgerDisplay;
      const step = Math.max(gap * Math.min(1, dt * 6.5), Math.min(gap, Math.max(25000, gap * 0.25) * dt * 4));
      this.ledgerDisplay = Math.min(this.ledgerTarget, this.ledgerDisplay + step);
      this.ledgerTotal.set(formatDollars(this.ledgerDisplay));
    }
    if (this.ledgerFlash > 0) {
      this.ledgerFlash -= dt;
      if (this.ledgerFlash <= 0) this.ledgerEl.classList.remove('pulse');
    }
    for (let i = this.ledgerRows.length - 1; i >= 0; i--) {
      const row = this.ledgerRows[i]!;
      row.age += dt;
      if (row.age >= LEDGER_ITEM_TTL - 1.2) {
        row.el.classList.add('fading');
      }
      if (row.age >= LEDGER_ITEM_TTL) {
        row.el.remove();
        this.ledgerRows.splice(i, 1);
      }
    }
  }

  private resetLedger(): void {
    this.ledgerTarget = 0;
    this.ledgerDisplay = 0;
    this.ledgerFlash = 0;
    this.ledgerTotal.set('$0');
    this.ledgerEl.classList.remove('on', 'pulse');
    for (const row of this.ledgerRows) row.el.remove();
    this.ledgerRows.length = 0;
  }

  // -----------------------------------------------------------------------------------------------
  // Barracks Garrison Doorway Spawners
  // -----------------------------------------------------------------------------------------------

  private startBarracks(arg: string): void {
    const destruction = this.ctx.world.objects?.destruction;
    if (!destruction) return;
    const tags = arg.split(',').map(s => s.trim()).filter(Boolean);
    for (const tag of tags) {
      if (this.barracksSpawners.has(tag)) continue;
      if (!destruction.isClusterAlive(tag)) continue;
      const cluster = destruction.getCluster(tag);
      const pos = cluster?.spawnPoint ?? cluster?.center;
      const unmark = pos ? this.ctx.hud.marker(pos.clone().setY(pos.y + 4.2), 'BARRACKS', '#ff9f2e') : null;
      this.barracksSpawners.set(tag, {
        tag,
        timer: rand(3.5, 6.5),
        unmark,
      });
    }
  }

  private stopBarracks(): void {
    for (const spawner of this.barracksSpawners.values()) {
      spawner.unmark?.();
    }
    this.barracksSpawners.clear();
  }

  private updateBarracks(dt: number): void {
    if (this.barracksSpawners.size === 0) return;
    const destruction = this.ctx.world.objects?.destruction;
    if (!destruction) {
      this.stopBarracks();
      return;
    }
    const livingEnemies = this.ctx.enemies.alive.length;
    for (const [tag, spawner] of this.barracksSpawners) {
      if (!destruction.isClusterAlive(tag)) {
        spawner.unmark?.();
        this.barracksSpawners.delete(tag);
        this.ctx.hud.feed('GARRISON BARRACKS DEMOLISHED — REINFORCEMENTS CUT!', '#7ee787');
        continue;
      }
      spawner.timer -= dt;
      if (spawner.timer > 0) continue;
      spawner.timer = rand(BARRACKS_SPAWN_MIN, BARRACKS_SPAWN_MAX);
      if (livingEnemies >= BARRACKS_POP_CAP) continue;

      const cluster = destruction.getCluster(tag);
      const door = cluster?.spawnPoint ?? cluster?.center;
      if (!door) continue;
      const roster: readonly EnemyId[] = ['trooper', Math.random() < 0.45 ? 'rocketeer' : 'gunner'];
      for (let i = 0; i < roster.length; i++) {
        _v.set(door.x + (i === 0 ? -0.9 : 0.9), door.y, door.z + rand(-0.6, 0.6));
        this.manager.spawn(roster[i]!, _v);
      }
    }
  }

  // -----------------------------------------------------------------------------------------------
  // Mech Rampage Tracker & Crane Collapse Sabot Rifle Drop
  // -----------------------------------------------------------------------------------------------

  private startRampage(): void {
    this.clearRampage();
    this.rampageActive = true;
    this.rampageDoneSignalled = false;
    const destruction = this.ctx.world.objects?.destruction;
    if (!destruction) {
      this.rampageDoneSignalled = true;
      this.runner.signal('fc:rampageDone');
      return;
    }

    const candidates: StructuralClusterLike[] = [];
    for (const tag of RAMPAGE_TAGS) {
      if (destruction.isClusterAlive(tag)) {
        const c = destruction.getCluster(tag);
        if (c) candidates.push(c);
      }
    }
    // Also discover Tier-2 rampage clusters registered by kind (never Tier-3 quayCrane, which requires the 105mm Howitzer).
    for (const kind of ['cannery', 'marketHall', 'gantryCrane']) {
      for (const c of destruction.aliveClusters(kind)) {
        if (!candidates.includes(c)) candidates.push(c);
      }
    }

    if (candidates.length === 0) {
      this.rampageDoneSignalled = true;
      this.runner.signal('fc:rampageDone');
      return;
    }

    for (const c of candidates) {
      const key = c.tag || c.id;
      this.rampageTargets.add(key);
      if (c.kind === 'cannery' || c.kind === 'marketHall' || c.kind === 'gantryCrane') {
        const unmark = this.ctx.hud.marker(
          c.center.clone().setY(c.center.y + 6),
          c.kind === 'gantryCrane' ? 'GANTRY CRANE' : c.label.toUpperCase(),
          '#ff6b3d',
        );
        this.rampageMarkers.set(key, unmark);
      }
    }
  }

  private onStructureLiquidated(label: string, kind: string, position: THREE.Vector3): void {
    const isCrane = kind === 'gantryCrane' || kind === 'quayCrane' || /crane/i.test(label);
    if (isCrane && !this.craneSabotDropped) {
      this.craneSabotDropped = true;
      const dropPos = _v.set(position.x, 0, position.z);
      const host = this.runner.host as unknown as GameHost;
      if (host.racks) {
        host.racks.pull('sabot');
        host.racks.add('sabot', { at: [dropPos.x, dropPos.y, dropPos.z] }, () => this.runner.signal('took:sabot'));
      }
      this.ctx.hud.feed('CRANE DOWN — SABOT RIFLE DROPPED IN WRECKAGE!', '#ffd447');
      this.runner.signal('fc:craneDown');
    }
  }

  private updateRampage(): void {
    if (!this.rampageActive || this.rampageDoneSignalled) return;
    const destruction = this.ctx.world.objects?.destruction;
    if (!destruction) {
      this.rampageDoneSignalled = true;
      this.runner.signal('fc:rampageDone');
      return;
    }
    let alive = 0;
    for (const key of this.rampageTargets) {
      const isUp = destruction.isClusterAlive(key);
      if (isUp) {
        alive++;
      } else {
        const unmark = this.rampageMarkers.get(key);
        if (unmark) {
          unmark();
          this.rampageMarkers.delete(key);
        }
      }
    }
    if (alive === 0) {
      this.rampageDoneSignalled = true;
      this.ctx.hud.feed('HOLDFAST STRUCTURES LIQUIDATED — ADVANCE TO HARBOUR WALL', '#7ee787');
      this.runner.signal('fc:rampageDone');
    }
  }

  private clearRampage(): void {
    this.rampageActive = false;
    this.rampageDoneSignalled = false;
    this.rampageTargets.clear();
    for (const unmark of this.rampageMarkers.values()) unmark();
    this.rampageMarkers.clear();
  }

  // -----------------------------------------------------------------------------------------------
  // Fast-Roping Transport Helicopters
  // -----------------------------------------------------------------------------------------------

  private spawnFastRopeHeli(arg: string): void {
    if (!this.vehicles) return;
    const [fromName, lzName] = arg.split(':');
    const lzMark = this.runner.mission.marks[lzName || fromName || 'doorGun'];
    const fromMark = this.runner.mission.marks[fromName || lzName || 'slipNorth'];
    if (!lzMark) return;
    const lz = _v.set(...lzMark.at);
    const dirX = fromMark ? fromMark.at[0] - lz.x : 0;
    const dirZ = fromMark ? fromMark.at[2] - lz.z : -1;
    const len = Math.hypot(dirX, dirZ);
    const nx = len > 1 ? dirX / len : -0.35;
    const nz = len > 1 ? dirZ / len : -0.94;
    _from.set(lz.x + nx * 85, lz.y + 42, lz.z + nz * 85);
    this.vehicles.spawnTransport(_from, lz, lz.y + 13, ['trooper', 'gunner', 'rocketeer', 'trooper'], null);
  }

  // -----------------------------------------------------------------------------------------------
  // 105mm Howitzer Upgrade Pod & Rival Frame Boss
  // -----------------------------------------------------------------------------------------------

  private dropHowitzerPod(markName: string): void {
    const mark = this.runner.mission.marks[markName] ?? PLACES.howitzerPod;
    if (!mark || !this.upgradePod) return;
    this.upgradePod.drop(_v.set(...mark.at), {
      label: '105MM HOWITZER POD',
      holdSeconds: 1.4,
      onInstalled: () => {
        this.frame?.installWeapon('howitzer105');
      },
    });
  }

  private spawnRivalFrame(markName: string): void {
    const mark = this.runner.mission.marks[markName] ?? PLACES.rivalSpawn;
    if (!mark || !this.rivalFrame) return;
    this.flak?.setActive(false);
    this.crawler?.hide();
    this.rivalFrame.spawn(_v.set(...mark.at), mark.yaw ?? 0);
    this.setBossMode('rival');
  }

  // -----------------------------------------------------------------------------------------------
  // Legacy Old Mother deck fallback (if `fc.motherDeck` ever invoked directly)
  // -----------------------------------------------------------------------------------------------

  private enterDeckStage(): void {
    this.deckActive = true;
    this.deckPostIdx = 0;
    this.deckRelocated.clear();
    if (!this.crawler) return;
    const alreadyOnDeck = this.crawler.root.visible && this.crawler.state.phase === 'deck';
    if (!alreadyOnDeck) {
      this.crawler.enterDeck(true);
      const land = this.crawler.deckLandingPoint(_v);
      this.ctx.player.teleport(land, this.crawler.yaw);
    }
    this.setBossMode('mother');
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
  // Slip set piece: burning courier wreck + door gun + interactive `[E]` Frame boot & T&C ticker
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

  private armSlipReady(seconds: number): void {
    this.stopSlipBoot();
    this.bootTotal = seconds;
    this.bootElapsed = 0;
    this.bootWaiting = true;
    this.bootActive = false;
    this.bootWave1Sent = false;
    this.bootWave2Sent = false;
    this.bootDoneSignalled = false;

    const m = PLACES.frame!;
    const f = this.frame;
    if (f && !f.occupied) {
      f.stand(_v.set(...m.at), m.yaw ?? Math.PI);
    }
    this.bootUnmark = this.ctx.hud.marker(
      new THREE.Vector3(m.at[0], m.at[1] + 4.2, m.at[2]),
      'DISTRAINT FRAME',
      '#ffb400',
    );
  }

  private updateSlipReady(): void {
    if (!this.bootWaiting) return;
    const m = PLACES.frame!;
    const p = this.ctx.player.position;
    const d = Math.hypot(p.x - m.at[0], p.z - m.at[2]);
    const dy = Math.abs(p.y - m.at[1]);
    if (d <= SLIP_BOOT_REACH && dy <= 5.5) {
      if (!this.bootUnprompt) {
        const key = this.ctx.input.labelFor?.('interact') ?? 'E';
        this.bootUnprompt = this.ctx.hud.follow(
          new THREE.Vector3(m.at[0], m.at[1] + 3.2, m.at[2]),
          `PRESS [${key}] — INITIATE FRAME BOOT SEQUENCE`,
          '#ffd447',
        );
      }
      if (this.ctx.input.pressed('interact')) {
        this.bootWaiting = false;
        this.bootUnprompt?.();
        this.bootUnprompt = null;
        this.bootUnmark?.();
        this.bootUnmark = null;
        this.ctx.audio.play('steam_burst', { pitch: 0.9, volume: 0.85 });
        this.ctx.audio.play('metal_groan', { pitch: 0.75, volume: 0.85 });
        this.ctx.hud.feed('FRAME BOOT SEQUENCE INITIATED — HOLD THE SLIP!', '#ffb400');
        this.startSlipBoot(this.bootTotal);
        this.runner.signal('fc:bootStarted');
      }
    } else if (this.bootUnprompt) {
      this.bootUnprompt();
      this.bootUnprompt = null;
    }
  }

  private startSlipBoot(seconds: number): void {
    this.bootWaiting = false;
    this.bootUnprompt?.();
    this.bootUnprompt = null;
    this.bootUnmark?.();
    this.bootUnmark = null;
    this.bootTotal = seconds;
    this.bootElapsed = 0;
    this.bootActive = true;
    this.bootWave1Sent = false;
    this.bootWave2Sent = false;
    this.bootDoneSignalled = false;
    this.bootEl.classList.add('on');
    this.updateBootHud();
    // Pose the Distraint Frame standing/booting in the Slip so the player defends the real machine.
    const f = this.frame;
    if (f && !f.occupied) {
      const m = PLACES.frame!;
      f.stand(_v.set(...m.at), m.yaw ?? Math.PI);
    }
  }

  private stopSlipBoot(): void {
    this.bootWaiting = false;
    this.bootActive = false;
    this.bootUnprompt?.();
    this.bootUnprompt = null;
    this.bootUnmark?.();
    this.bootUnmark = null;
    this.bootEl.classList.remove('on');
  }

  private updateBootHud(): void {
    const pct = clamp(this.bootTotal > 0 ? this.bootElapsed / this.bootTotal : 1);
    const whole = Math.floor(pct * 100);
    this.bootPct.set(`${whole}%`);
    this.bootFill.style.transform = `scaleX(${pct.toFixed(4)})`;
    const idx = Math.floor(this.bootElapsed / 7.5) % BOOT_CLAUSES.length;
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
  // Harbourmaster surrender on the Salt Flats (real native Outpost prisoner + Bureau Extraction Drone)
  // -----------------------------------------------------------------------------------------------

  private spawnHarbourmasterAt(pos?: THREE.Vector3): void {
    if (this.harbourBody || this.harbourResolved) return;
    const at = pos
      ? _v.copy(pos)
      : this.rivalFrame?.active
        ? _v.copy(this.rivalFrame.ejectLandingPoint)
        : this.crawler?.root.visible
          ? this.crawler.harbourmasterPoint(_v)
          : _v.set(...PLACES.rivalSpawn!.at);
    at.y = Math.max(0, at.y);

    const e = this.manager.spawn('warden', at) as Enemy | null;
    if (!e) {
      this.resolveHarbour(true);
      return;
    }

    // Strip all armor/plates so she is an unarmored pilot, and DO NOT set e.dummy = true
    // so native Outpost prisoner Hold-`E` cuffing and Airlift Extraction Drone work automatically.
    for (const plate of e.plates) plate.mesh.visible = false;
    e.plates = [];
    e.armor = 0;
    e.maxHealth = 120;
    e.health = 120;

    const s = soldierOf(e);
    const outpost = this.manager.outpost;
    if (s && outpost) {
      this.harbourUsesNativePrisoner = true;
      s.holdout = false;
      outpost.collapse(s, 'surrender');
      outpost.onSurrender(s);
      // Keep her kneeling on the flats indefinitely so she never bolts or times out while the player disembarks.
      s.judgeAt = Infinity;
      s.watchedAt = Infinity;
      pose(e, 'handsUp');
    } else {
      // Fallback when Outpost AI is inactive (e.g. proof/sandbox contexts)
      this.harbourUsesNativePrisoner = false;
      e.attacks = [];
      e.behaviours = [];
      e.barkAt = Infinity;
      e.mode = 'hold';
      e.face = 'player';
      pose(e, 'handsUp');
    }

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
    // When native Outpost prisoner system is active, prisoners.ts handles Hold-`E` cuffing & airlift.ts emits `prisoner:cuffed`.
    if (this.harbourUsesNativePrisoner) {
      const s = soldierOf(h);
      if (s && s.cuffed) {
        this.resolveHarbour(true);
      }
      return;
    }
    // Fallback interactive cuff when Outpost is not active
    const p = this.ctx.player.position;
    const d = p.distanceTo(h.position);
    if (d <= CUFF_REACH && !this.ctx.player.parked) {
      if (!this.harbourUnprompt) {
        const key = this.ctx.input.labelFor?.('interact') ?? 'E';
        this.harbourUnprompt = this.ctx.hud.follow(
          _v.copy(h.position).setY(h.position.y + 2.0).clone(),
          `HOLD [${key}] CUFF HARBOURMASTER (+$5,000)`,
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
      this.ctx.progression.award(HARBOUR_CAPTURE_BONUS, 'HARBOURMASTER DETAINED', this.harbourBody?.position);
      this.ctx.hud.feed('HARBOURMASTER CUFFED — EXTRACTION DRONE INBOUND (+$5,000 BONUS)', '#ffc14a');
      this.runner.signal('fc:cuffed');
    } else {
      this.ctx.hud.feed('HARBOURMASTER REMOVED — PROCESSING FEE ADJUSTED', '#e23a2c');
      this.runner.signal('fc:killed');
    }
    this.runner.signal('fc:harbourDone');
  }

  // -----------------------------------------------------------------------------------------------
  // Final Tactical Nuke Authorization & Detonation (works in Frame OR on foot)
  // -----------------------------------------------------------------------------------------------

  private authorizeNuke(): void {
    this.nukeAuthorized = true;
    this.nukeLaunched = false;
    this.nukeDetonated = false;

    const cm = this.callins;
    if (cm) {
      cm.shut = false;
      if (cm.cooldowns) cm.cooldowns.nuke = 0;
      cm.grant?.('nuke');
    }

    const key = this.ctx.input.labelFor?.('callinNuke') ?? 'N';
    this.nukePromptText.set(`PRESS [${key}] OR CALL IN NUKE — LIQUIDATE HOLDFAST`);
    this.nukePromptEl.classList.add('on');
    this.ctx.hud.feed(`TACTICAL NUKE AUTHORISED — PRESS [${key}] TO LIQUIDATE HOLDFAST`, '#ff5b4c');
  }

  private updateNukeAuth(): void {
    if (!this.nukeAuthorized || this.nukeLaunched) return;
    if (!this.ctx.input.pressed('callinNuke')) return;

    // Launch real Tactical Nuke directly onto Holdfast Ground Zero [65, 0, -10] whether inside the Frame OR on foot.
    const cm = this.callins;
    if (cm && cm.fly && cm.mark) {
      this.nukeLaunched = true;
      this.nukePromptEl.classList.remove('on');
      cm.targeting?.exit();
      cm.held.delete('nuke');
      cm.mark.point.copy(NUKE_TARGET);
      cm.mark.heading.set(1, 0, 0);
      cm.fly('nuke');
      this.ctx.hud.feed('TACTICAL NUKE LAUNCHED — IMPACT ON HOLDFAST INBOUND!', '#ff5b4c');
    }
  }

  private onNukeDetonated(): void {
    if (this.nukeDetonated) return;
    this.nukeDetonated = true;
    this.nukeAuthorized = false;
    this.nukeLaunched = true;
    this.nukePromptEl.classList.remove('on');

    if (this.flak && !this.flak.flattened) {
      this.flak.nukeFlatten();
    }

    // Ensure the Bureau Asset Liquidation HUD Ledger rockets past $50M+ on Holdfast's total thermal liquidation.
    if (this.ledgerTarget < 50_000_000) {
      this.recordLiquidation('HOLDFAST HARBOUR INFRASTRUCTURE', 18_400_000);
      this.recordLiquidation('HOLDFAST SALT WORKS & QUAYS', 14_200_000);
      this.recordLiquidation('HOLDFAST MUNICIPAL REGISTER', 19_800_000);
    }
  }

  // -----------------------------------------------------------------------------------------------
  // Frame update & reset
  // -----------------------------------------------------------------------------------------------

  update(dt: number): void {
    if (!this.builtWorld) return;

    // Tick persistent Holdfast entities owned by Foreclosure
    this.flak?.update(dt);
    this.crawler?.update(dt);
    this.rivalFrame?.update(dt);
    this.upgradePod?.update(dt);

    if (this.wreckLight && this.wreckLight.intensity > 0) {
      this.wreckLight.intensity = 2.0 + Math.sin(this.ctx.time.elapsed * 9.3) * 0.45 + rand(-0.15, 0.15);
    }

    this.updateSlipReady();
    if (this.bootActive) {
      this.bootElapsed += dt;
      this.updateBootHud();
      if (!this.bootWave1Sent && this.bootElapsed >= 24) {
        this.bootWave1Sent = true;
        this.runner.signal('fc:slipWave1');
      }
      if (!this.bootWave2Sent && this.bootElapsed >= 50) {
        this.bootWave2Sent = true;
        this.runner.signal('fc:slipWave2');
      }
      if (this.bootElapsed >= this.bootTotal && !this.bootDoneSignalled) {
        this.bootDoneSignalled = true;
        this.stopSlipBoot();
        this.ctx.audio.play('steam_burst', { pitch: 0.7, volume: 0.9 });
        this.ctx.audio.play('metal_groan', { pitch: 0.65, volume: 0.9 });
        this.ctx.hud.feed('DISTRAINT 4 ONLINE — READY TO BOARD', '#7ee787');
        this.runner.signal('fc:booted');
      }
    }

    this.updateBarracks(dt);
    this.updateRampage();
    this.updateSappers(dt);
    this.updateHarbourmaster();
    this.updateNukeAuth();
    this.updateBossHud();
    this.updateLedger(dt);
  }

  clear(): void {
    this.stopSlipBoot();
    this.stopBarracks();
    this.clearRampage();
    this.craneSabotDropped = false;
    this.setBossMode('none');
    this.resetLedger();
    this.nukeAuthorized = false;
    this.nukeLaunched = false;
    this.nukeDetonated = false;
    this.nukePromptEl.classList.remove('on');
    this.sappersOn = false;
    this.clearSapperTrack();
    this.deckActive = false;
    this.deckRelocated.clear();
    this.showSlipWreck(false);
    this.flak?.reset();
    this.crawler?.hide();
    this.rivalFrame?.hide();
    this.upgradePod?.reset();
    if (this.harbourBody) {
      if (this.harbourBody.alive) this.manager.withdraw(this.harbourBody);
      this.harbourBody = null;
    }
    this.harbourUsesNativePrisoner = false;
    this.harbourUnmark?.();
    this.harbourUnmark = null;
    this.harbourUnprompt?.();
    this.harbourUnprompt = null;
    this.harbourResolved = false;
  }
}
