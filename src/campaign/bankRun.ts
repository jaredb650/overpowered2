/**
 * Bank Run (Mission 4 — "Brine Central Reserve" -> "Coastal Elevated Expressway") runtime director.
 *
 * Orchestrates all bespoke set pieces reached via `bk.*` calls from `missions/bankRun.ts`:
 *   - Act 1: Packmule 2-3 first-person fast-rope insertion onto the rooftop helipad,
 *            Tier-1 Atrium Skylight Dome breach watcher + optional [E] breach charge,
 *            and safe skylight drop cushion into the Grand Banking Hall.
 *   - Bank Atmosphere: Animated Day-2 Red-Goggles LED financial ticker boards & shootable
 *            hanging brass/crystal chandeliers that crush SWAT below.
 *   - Act 2: VaultDrill (20-ton hinged vault door, Bureau Thermal Lance, 2 thermal jams,
 *            SWAT Tech Saboteurs & C4 defusal) + SWAT Fast-Rope drops through your blown skylight.
 *   - Act 3: LootBags (7 gold bullion pallets, carry encumbrance, [G] physics bag heave,
 *            armored Bureau Getaway Humvee cargo bed & turret mount).
 *   - Act 4: HighwayChase (scrolling Coastal Elevated Expressway treadmill, roof M2 .50 cal turret,
 *            locational police cruiser wrecks, BearCat vans, explosive fuel tankers) +
 *            GunshipBoss (Governor Reginald Sterling in AUDITOR-1 with 4 destructible subsystems).
 */
import * as THREE from 'three';
import type { Ctx, LoopHandle, SeatView } from '../core/contracts';
import type { EnemyId } from '../core/gameplay';
import { clamp } from '../core/math';
import type { Enemy } from '../enemies/Enemy';
import type { EnemyManager } from '../enemies/EnemyManager';
import { ModelBuilder, ModelMaterials } from '../progression/modelkit';
import {
  CHANDELIER_POSITIONS,
  LV,
  PACKMULE_HOVER,
  ROOF_HELIPAD,
  SKYLIGHT_CENTER,
  TICKER_POSITIONS,
} from '../world/map/bank/plan';
import { LootBags } from './heist/bags';
import { VaultDrill } from './heist/drill';
import { GunshipBoss } from './heist/gunshipBoss';
import { HighwayChase } from './heist/highway';
import type { CampaignHud } from './hud';
import type { MissionRunner } from './runner';
import { MARKS } from './missions/bankRun.places';

const TICKER_HEADLINES =
  '  +++ HOLDFAST PORT UNREACHABLE +++ CHANCERY MAGISTRATE ALDOUS VANE DEAD BEFORE 06:00 +++ RED-GOGGLED SUSPECT REPORTED AT EXCHANGES IN 14 CITIES SIMULTANEOUSLY +++ BRINE CENTRAL RESERVE GOLD TRADING HALTED +++ EMERGENCY LIQUIDITY LOCKDOWN IN EFFECT +++  ';

const FASTROPE_DURATION = 3.2;
const SKYLIGHT_PLANT_REACH = 5.4;
const SKYLIGHT_FUSE = 2.6;
const CHANDELIER_HIT_RADIUS = 1.65;
const CHANDELIER_CRUSH_RADIUS = 4.2;
const CHANDELIER_CRUSH_DAMAGE = 350;

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

interface ChandelierState {
  root: THREE.Group;
  chain: THREE.Mesh;
  anchor: THREE.Vector3;
  vy: number;
  state: 'hanging' | 'falling' | 'broken';
}

interface SkylightHeliDrop {
  root: THREE.Group;
  rotor: THREE.Group;
  ropes: THREE.Group;
  clock: number;
  dropped: boolean;
  loop: LoopHandle | null;
}

function buildChopperModel(materials: ModelMaterials, bodyColor: string, accentColor: string): {
  root: THREE.Group;
  rotor: THREE.Group;
  tailRotor: THREE.Group;
} {
  const root = new THREE.Group();
  const b = new ModelBuilder();
  // Fuselage
  b.box(2.3, 1.8, 6.4, bodyColor, { at: [0, 0, 0] });
  b.box(1.9, 1.1, 2.2, '#1d2630', { at: [0, -0.1, -3.6] });
  b.box(2.4, 0.24, 6.2, accentColor, { at: [0, 0.2, 0] });
  // Tail boom & vertical fin
  b.box(0.6, 0.7, 5.2, bodyColor, { at: [0, 0.35, 5.2] });
  b.box(0.24, 1.9, 1.0, accentColor, { at: [0, 1.1, 7.6] });
  // Landing skids
  for (const s of [-1, 1]) {
    b.box(0.14, 0.14, 4.6, '#2b3036', { at: [s * 1.35, -1.45, -0.2] });
    b.box(0.12, 0.7, 0.12, '#2b3036', { at: [s * 1.25, -1.1, -1.4] });
    b.box(0.12, 0.7, 0.12, '#2b3036', { at: [s * 1.25, -1.1, 1.2] });
  }
  root.add(materials.group(b));

  // Main rotor
  const rb = new ModelBuilder();
  rb.cyl(0.22, 0.24, 0.55, 8, '#2b3036', { at: [0, 0.25, 0] });
  rb.box(11.4, 0.06, 0.28, '#1a1e24', { at: [0, 0.5, 0] });
  rb.box(0.28, 0.06, 11.4, '#1a1e24', { at: [0, 0.5, 0] });
  const rotor = materials.group(rb);
  rotor.position.set(0, 1.05, -0.3);
  root.add(rotor);

  // Tail rotor
  const tb = new ModelBuilder();
  tb.box(0.08, 1.8, 0.16, '#1a1e24', { at: [0, 0, 0] });
  tb.box(0.08, 0.16, 1.8, '#1a1e24', { at: [0, 0, 0] });
  const tailRotor = materials.group(tb);
  tailRotor.position.set(0.38, 1.25, 7.6);
  root.add(tailRotor);

  return { root, rotor, tailRotor };
}

export class BankRun {
  private built = false;
  private materials: ModelMaterials | null = null;
  private readonly propsRoot = new THREE.Group();
  private readonly ownedGeos: THREE.BufferGeometry[] = [];
  private readonly ownedMats: THREE.Material[] = [];
  private readonly unsubs: (() => void)[] = [];

  // Core heist gameplay modules
  drill: VaultDrill | null = null;
  bags: LootBags | null = null;
  highway: HighwayChase | null = null;
  boss: GunshipBoss | null = null;

  // Act 1: Packmule fast-rope insertion
  private fastRopeActive = false;
  private fastRopeClock = 0;
  private packmulePeelClock = -1;
  private packmule: { root: THREE.Group; rotor: THREE.Group; tailRotor: THREE.Group } | null = null;
  private fastRopeMesh: THREE.Mesh | null = null;
  private fastRopeLoop: LoopHandle | null = null;
  private readonly fastRopeView: SeatView = {
    position: new THREE.Vector3(),
    yaw: 0,
    pitch: -0.22,
    roll: 0,
    shake: 0.4,
  };

  // Act 1: Skylight breach watcher & optional [E] breach charge
  private skylightWatchActive = false;
  private skylightBlown = false;
  private skylightChargePlanted = false;
  private skylightFuse = 0;
  private skylightBeep = 0;
  private skylightPromptOff: (() => void) | null = null;
  private skylightChargeMesh: THREE.Group | null = null;
  private dropCushionTimer = 0;

  // Act 2: Skylight SWAT Fast-Rope Helicopters
  private readonly skylightHelis: SkylightHeliDrop[] = [];

  // Grand Banking Hall atmosphere: animated LED tickers & shootable chandeliers
  private tickerCanvas: HTMLCanvasElement | null = null;
  private tickerCtx: CanvasRenderingContext2D | null = null;
  private tickerTex: THREE.CanvasTexture | null = null;
  private tickerScroll = 0;
  private tickerRedrawClock = 0;
  private readonly chandeliers: ChandelierState[] = [];

  constructor(
    private readonly ctx: Ctx,
    private readonly runner: MissionRunner,
    private readonly _ui: CampaignHud,
  ) {
    this.propsRoot.name = 'bank-run-props';
  }

  private get manager(): EnemyManager {
    return this.ctx.enemies as EnemyManager;
  }

  private signal = (name: string): void => {
    this.runner.signal(name);
  };

  /** Builds all heist modules, Packmule fast-rope rig, animated LED tickers, and shootable chandeliers once. */
  ensureBuilt(): void {
    if (this.built) return;
    this.built = true;

    const { ctx } = this;
    this.materials = new ModelMaterials(ctx);
    ctx.render.scene.add(this.propsRoot);

    this.drill = new VaultDrill(ctx, this.signal);
    this.bags = new LootBags(ctx, this.signal);
    this.highway = new HighwayChase(ctx, this.signal);
    this.boss = new GunshipBoss(ctx, this.signal);

    // Wire .50 cal highway shots straight into AUDITOR-1 (rockets + 4 subsystems + hull)
    this.highway.registerExtraShotHandler((origin, dir, maxDist, damage) => {
      if (!this.boss || !this.boss.active) return null;
      return this.boss.hitRay(origin, dir, maxDist, damage);
    });

    this.buildPackmuleRig();
    this.buildSkylightChargeVisual();
    this.buildTickerBoards();
    this.buildChandeliers();

    // Listen for bullet / blast impacts near chandeliers
    this.unsubs.push(
      ctx.events.on('weapon:impact', (payload: unknown) => {
        const p = payload as { position?: THREE.Vector3 } | undefined;
        if (p?.position) this.checkChandelierHit(p.position, CHANDELIER_HIT_RADIUS);
      }),
    );

    // Expose cleanly on __op2 for dev inspection & visual proof captures
    const op2 = (window as unknown as { __op2?: Record<string, unknown> }).__op2;
    if (op2) op2.bankRun = this;
  }

  private buildPackmuleRig(): void {
    if (!this.materials) return;
    const heli = buildChopperModel(this.materials, '#263038', '#d99a24');
    heli.root.position.set(PACKMULE_HOVER[0], PACKMULE_HOVER[1], PACKMULE_HOVER[2]);
    heli.root.visible = false;
    this.propsRoot.add(heli.root);
    this.packmule = heli;

    // Braided fast-rope hanging from Packmule cabin down to helipad
    const ropeH = PACKMULE_HOVER[1] - ROOF_HELIPAD[1];
    const ropeGeo = new THREE.CylinderGeometry(0.045, 0.045, ropeH, 6);
    const ropeMat = new THREE.MeshStandardMaterial({ color: '#c4b48a', roughness: 0.9, metalness: 0.05 });
    this.ownedGeos.push(ropeGeo);
    this.ownedMats.push(ropeMat);
    const rope = new THREE.Mesh(ropeGeo, ropeMat);
    rope.position.set(ROOF_HELIPAD[0], ROOF_HELIPAD[1] + ropeH * 0.5, ROOF_HELIPAD[2] - 0.45);
    rope.visible = false;
    this.propsRoot.add(rope);
    this.fastRopeMesh = rope;
  }

  private buildSkylightChargeVisual(): void {
    if (!this.materials) return;
    const b = new ModelBuilder();
    b.box(0.45, 0.14, 0.3, '#2d3238', { at: [0, 0.07, 0] });
    b.box(0.36, 0.05, 0.18, '#d99a24', { at: [0, 0.15, 0] });
    const grp = this.materials.group(b);
    const ledGeo = new THREE.SphereGeometry(0.055, 8, 8);
    const ledMat = new THREE.MeshBasicMaterial({ color: '#ff3420', toneMapped: false });
    this.ownedGeos.push(ledGeo);
    this.ownedMats.push(ledMat);
    const led = new THREE.Mesh(ledGeo, ledMat);
    led.position.set(0, 0.21, 0);
    grp.add(led);
    grp.position.set(SKYLIGHT_CENTER[0], SKYLIGHT_CENTER[1] + 0.4, SKYLIGHT_CENTER[2] + 3.2);
    grp.visible = false;
    this.propsRoot.add(grp);
    this.skylightChargeMesh = grp;
  }

  private buildTickerBoards(): void {
    if (typeof document === 'undefined') return;
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 96;
    const g = canvas.getContext('2d');
    if (!g) return;
    this.tickerCanvas = canvas;
    this.tickerCtx = g;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    this.tickerTex = tex;

    const screenMat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    const frameMat = new THREE.MeshStandardMaterial({ color: '#1b1e24', metalness: 0.7, roughness: 0.4 });
    this.ownedMats.push(screenMat, frameMat);

    for (const spec of TICKER_POSITIONS) {
      const grp = new THREE.Group();
      grp.position.set(spec.pos[0], spec.pos[1], spec.pos[2]);
      grp.rotation.y = spec.yaw;

      const frameGeo = new THREE.BoxGeometry(spec.width + 0.4, spec.height + 0.35, 0.26);
      const planeGeo = new THREE.PlaneGeometry(spec.width, spec.height);
      this.ownedGeos.push(frameGeo, planeGeo);

      const frame = new THREE.Mesh(frameGeo, frameMat);
      const screen = new THREE.Mesh(planeGeo, screenMat);
      screen.position.z = 0.14;
      grp.add(frame, screen);
      this.propsRoot.add(grp);
    }
    this.redrawTicker(0);
  }

  private redrawTicker(dt: number): void {
    const g = this.tickerCtx;
    const canvas = this.tickerCanvas;
    if (!g || !canvas || !this.tickerTex) return;
    this.tickerScroll = (this.tickerScroll + dt * 140) % 2600;
    g.fillStyle = '#0a0c12';
    g.fillRect(0, 0, canvas.width, canvas.height);
    // Subtle LED scanlines
    g.fillStyle = '#1b0d0f';
    for (let y = 0; y < canvas.height; y += 6) g.fillRect(0, y, canvas.width, 2);
    g.strokeStyle = '#c9a13e';
    g.lineWidth = 4;
    g.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
    g.font = 'bold 42px monospace';
    g.fillStyle = '#ff4b36';
    g.textBaseline = 'middle';
    const x = 1024 - this.tickerScroll;
    g.fillText(TICKER_HEADLINES, x, 50);
    g.fillText(TICKER_HEADLINES, x + 2600, 50);
    this.tickerTex.needsUpdate = true;
  }

  private buildChandeliers(): void {
    const brassMat = this.ctx.render.materials.patch(
      new THREE.MeshStandardMaterial({ color: '#d4a63a', metalness: 0.85, roughness: 0.25 }),
    );
    const crystalMat = new THREE.MeshBasicMaterial({ color: '#fff3d4', toneMapped: false });
    const chainMat = new THREE.MeshStandardMaterial({ color: '#7a6328', metalness: 0.8, roughness: 0.35 });
    this.ownedMats.push(brassMat, crystalMat, chainMat);

    const ringGeo = new THREE.TorusGeometry(1.45, 0.09, 8, 20);
    const innerRingGeo = new THREE.TorusGeometry(0.85, 0.07, 8, 16);
    const bulbGeo = new THREE.OctahedronGeometry(0.16, 0);
    const chainGeo = new THREE.CylinderGeometry(0.035, 0.035, 2.6, 6);
    this.ownedGeos.push(ringGeo, innerRingGeo, bulbGeo, chainGeo);

    for (const pos of CHANDELIER_POSITIONS) {
      const root = new THREE.Group();
      root.position.set(pos[0], pos[1], pos[2]);

      const outer = new THREE.Mesh(ringGeo, brassMat);
      outer.rotation.x = Math.PI / 2;
      const inner = new THREE.Mesh(innerRingGeo, brassMat);
      inner.rotation.x = Math.PI / 2;
      inner.position.y = -0.35;
      root.add(outer, inner);

      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const bulb = new THREE.Mesh(bulbGeo, crystalMat);
        bulb.position.set(Math.cos(a) * 1.45, -0.18, Math.sin(a) * 1.45);
        root.add(bulb);
      }

      const chain = new THREE.Mesh(chainGeo, chainMat);
      chain.position.set(pos[0], pos[1] + 1.3, pos[2]);

      this.propsRoot.add(root, chain);
      this.chandeliers.push({
        root,
        chain,
        anchor: new THREE.Vector3(pos[0], pos[1], pos[2]),
        vy: 0,
        state: 'hanging',
      });
    }
  }

  private checkChandelierHit(point: THREE.Vector3, radius: number): void {
    for (const ch of this.chandeliers) {
      if (ch.state !== 'hanging') continue;
      if (ch.root.position.distanceTo(point) <= radius) {
        ch.state = 'falling';
        ch.vy = -1.5;
        ch.chain.visible = false;
        this.ctx.fx.sparks(ch.root.position, _v.set(0, -1, 0), 14, '#ffd478');
        this.ctx.audio.play('glass_break', { position: ch.root.position, volume: 0.7 });
      }
    }
  }

  // -----------------------------------------------------------------------------------------------
  // Mission Script Call Dispatch (`bk.*`)
  // -----------------------------------------------------------------------------------------------

  call(name: string, arg: string | undefined): void {
    this.ensureBuilt();
    switch (name) {
      case 'bk.fastRope':
        this.startFastRope();
        return;
      case 'bk.skylightWatch':
        this.skylightWatchActive = true;
        return;
      case 'bk.ensureSkylightOpen':
        this.forceOpenSkylight();
        return;
      case 'bk.drillArm':
        this.drill?.arm();
        return;
      case 'bk.vaultForceOpen':
        this.drill?.forceOpen();
        return;
      case 'bk.sendSaboteur':
        this.spawnSaboteur(arg ?? 'vaultEastSpawn');
        return;
      case 'bk.skylightDrop':
        this.launchSkylightSwatDrop();
        return;
      case 'bk.plunderStart':
        this.bags?.activate();
        return;
      case 'bk.highwayStart':
        this.startHighway(1);
        return;
      case 'bk.highwayWave2':
        this.highway?.startWave2();
        return;
      case 'bk.bossStart':
        this.startBoss();
        return;
      case 'bk.finishTunnel':
        this.highway?.playExtractionTunnel();
        return;
      default:
        console.warn(`[bankRun] unknown call "${name}"`);
    }
  }

  // -----------------------------------------------------------------------------------------------
  // Act 1: First-Person Fast-Rope & Skylight Breach
  // -----------------------------------------------------------------------------------------------

  private startFastRope(): void {
    this.fastRopeActive = true;
    this.fastRopeClock = 0;
    this.packmulePeelClock = -1;
    if (this.packmule) {
      this.packmule.root.position.set(PACKMULE_HOVER[0], PACKMULE_HOVER[1], PACKMULE_HOVER[2]);
      this.packmule.root.rotation.set(0, 0, 0);
      this.packmule.root.visible = true;
    }
    if (this.fastRopeMesh) this.fastRopeMesh.visible = true;

    this.ctx.player.park(_v.set(ROOF_HELIPAD[0], ROOF_HELIPAD[1], ROOF_HELIPAD[2]));
    this.fastRopeView.position.set(ROOF_HELIPAD[0], PACKMULE_HOVER[1] - 1.5, ROOF_HELIPAD[2] - 0.5);
    this.fastRopeView.yaw = 0;
    this.fastRopeView.pitch = -0.35;
    this.fastRopeView.roll = 0;
    this.ctx.camera.setSeat(this.fastRopeView);

    if (this.ctx.audio.has('chopper_rotor_loop')) {
      this.fastRopeLoop?.stop();
      this.fastRopeLoop = this.ctx.audio.startLoop('chopper_rotor_loop', { volume: 0.45, pitch: 1.0 });
    }
  }

  private finishFastRope(): void {
    if (!this.fastRopeActive) return;
    this.fastRopeActive = false;
    this.packmulePeelClock = 0;
    if (this.fastRopeMesh) this.fastRopeMesh.visible = false;
    this.ctx.camera.setSeat(null);
    this.ctx.player.teleport(_v.set(ROOF_HELIPAD[0], ROOF_HELIPAD[1], ROOF_HELIPAD[2]), 0);
    this.ctx.player.unpark(1.8);
    this.ctx.camera.addTrauma(0.28);
    this.signal('bk:fastrope_done');
  }

  private forceOpenSkylight(): void {
    if (this.skylightBlown) return;
    this.skylightBlown = true;
    this.skylightWatchActive = false;
    this.clearSkylightPrompt();
    const dest = this.ctx.world.objects.destruction;
    if (dest?.isClusterAlive('bank.skylight')) {
      dest.blast(_v.set(SKYLIGHT_CENTER[0], SKYLIGHT_CENTER[1], SKYLIGHT_CENTER[2]), 10, 1200, 'breach_charge');
    }
  }

  private detonateSkylightCharge(): void {
    this.skylightChargePlanted = false;
    if (this.skylightChargeMesh) this.skylightChargeMesh.visible = false;
    _v.set(SKYLIGHT_CENTER[0], SKYLIGHT_CENTER[1] + 0.2, SKYLIGHT_CENTER[2]);
    this.ctx.fx.explosion(_v, { radius: 8.5, kind: 'grenade', scale: 1.45 });
    this.ctx.fx.impact(_v, _v2.set(0, 1, 0), 'glass', 3);
    this.ctx.audio.play('glass_break', { position: _v, volume: 1 });
    this.ctx.camera.addTrauma(0.85);
    this.ctx.world.objects.destruction?.blast(_v, 11, 1600, 'breach_charge');
    this.markSkylightBlown();
  }

  private markSkylightBlown(): void {
    if (this.skylightBlown) return;
    this.skylightBlown = true;
    this.skylightWatchActive = false;
    this.dropCushionTimer = 8;
    this.clearSkylightPrompt();
    this.signal('bk:skylight_blown');
  }

  private clearSkylightPrompt(): void {
    this.skylightPromptOff?.();
    this.skylightPromptOff = null;
  }

  // -----------------------------------------------------------------------------------------------
  // Act 2: SWAT Tech Saboteurs & Skylight Fast-Rope SWAT Drops
  // -----------------------------------------------------------------------------------------------

  private spawnSaboteur(markName: string): void {
    const mark = MARKS[markName] ?? MARKS.vaultEastSpawn!;
    _v.set(mark.at[0], mark.at[1], mark.at[2]);
    const enemy = this.ctx.enemies.spawn('gunner', _v) as Enemy | null;
    if (!enemy) return;
    this.ctx.campaign.enlist(enemy, 'swat_saboteur');
    this.drill?.registerSaboteur(enemy);
    this.ctx.hud.feed('SWAT TECH SABOTEUR INBOUND TO THE DRILL!', '#ffb400');
  }

  private launchSkylightSwatDrop(): void {
    if (!this.materials) return;
    const heli = buildChopperModel(this.materials, '#1c2432', '#d9483b');
    heli.root.position.set(SKYLIGHT_CENTER[0] - 42, LV.roof + 14, SKYLIGHT_CENTER[2]);
    this.propsRoot.add(heli.root);

    const ropes = new THREE.Group();
    const ropeH = LV.roof + 12.5;
    const geo = new THREE.CylinderGeometry(0.04, 0.04, ropeH, 5);
    const mat = new THREE.MeshStandardMaterial({ color: '#1b1d20', roughness: 0.9 });
    this.ownedGeos.push(geo);
    this.ownedMats.push(mat);
    for (const dx of [-1.2, 1.2]) {
      const r = new THREE.Mesh(geo, mat);
      r.position.set(dx, -ropeH * 0.5, 0);
      ropes.add(r);
    }
    ropes.visible = false;
    heli.root.add(ropes);

    let loop: LoopHandle | null = null;
    if (this.ctx.audio.has('chopper_rotor_loop')) {
      loop = this.ctx.audio.startLoop('chopper_rotor_loop', {
        position: heli.root.position,
        volume: 0.36,
        pitch: 1.06,
      });
    }

    this.skylightHelis.push({
      root: heli.root,
      rotor: heli.rotor,
      ropes,
      clock: 0,
      dropped: false,
      loop,
    });
  }

  // -----------------------------------------------------------------------------------------------
  // Act 4: Highway Chase & AUDITOR-1 Pursuit Gunship Boss
  // -----------------------------------------------------------------------------------------------

  private startHighway(wave: 1 | 2): void {
    this.bags?.clear();
    this.boss?.clear();
    this.highway?.start(wave);
  }

  private startBoss(): void {
    if (!this.highway || !this.boss) return;
    this.highway.enterBossPhase();
    this.boss.spawn(
      () => this.highway!.humveePosition,
      (amount, from, source) => this.highway!.damageHumvee(amount, from, source),
    );
  }

  // -----------------------------------------------------------------------------------------------
  // Per-frame Update
  // -----------------------------------------------------------------------------------------------

  update(dt: number): void {
    if (!this.built) return;

    // 1. Animated Day-2 LED financial ticker boards (redraw at ~18 Hz)
    this.tickerRedrawClock += dt;
    if (this.tickerRedrawClock >= 0.055) {
      this.redrawTicker(this.tickerRedrawClock);
      this.tickerRedrawClock = 0;
    }

    // 2. Packmule 2-3 Fast-Rope Descent & Peel-Off
    if (this.fastRopeActive && this.packmule) {
      this.fastRopeClock += dt;
      const t = clamp(this.fastRopeClock / FASTROPE_DURATION, 0, 1);
      // Smooth accelerate-then-brake fast-rope glide
      const ease = t < 0.8 ? (t / 0.8) * 0.9 : 0.9 + ((t - 0.8) / 0.2) * 0.1;
      const eyeY = THREE.MathUtils.lerp(PACKMULE_HOVER[1] - 1.5, ROOF_HELIPAD[1] + 1.62, ease);
      this.fastRopeView.position.set(
        ROOF_HELIPAD[0] + Math.sin(this.fastRopeClock * 3.2) * 0.14 * (1 - t),
        eyeY,
        ROOF_HELIPAD[2] - 0.45 + Math.cos(this.fastRopeClock * 2.5) * 0.08 * (1 - t),
      );
      this.fastRopeView.pitch = THREE.MathUtils.lerp(-0.42, -0.04, t);
      this.fastRopeView.roll = Math.sin(this.fastRopeClock * 2.8) * 0.03 * (1 - t);
      this.packmule.rotor.rotation.y += dt * 26;
      this.packmule.tailRotor.rotation.x += dt * 32;
      if (this.fastRopeClock >= FASTROPE_DURATION) this.finishFastRope();
    } else if (this.packmulePeelClock >= 0 && this.packmule) {
      this.packmulePeelClock += dt;
      this.packmule.rotor.rotation.y += dt * 26;
      this.packmule.tailRotor.rotation.x += dt * 32;
      this.packmule.root.position.x += dt * 18;
      this.packmule.root.position.y += dt * 4.5;
      this.packmule.root.position.z -= dt * 10;
      this.packmule.root.rotation.z = -0.22;
      if (this.packmulePeelClock > 4.2) {
        this.packmule.root.visible = false;
        this.packmulePeelClock = -1;
        this.fastRopeLoop?.stop();
        this.fastRopeLoop = null;
      }
    }

    // 3. Skylight Breach Watcher & Optional [E] Breach Charge
    if (this.skylightWatchActive && !this.skylightBlown) {
      const dest = this.ctx.world.objects.destruction;
      if (dest && !dest.isClusterAlive('bank.skylight')) {
        this.markSkylightBlown();
      } else if (this.skylightChargePlanted) {
        this.skylightFuse -= dt;
        this.skylightBeep -= dt;
        if (this.skylightBeep <= 0) {
          this.skylightBeep = Math.max(0.14, this.skylightFuse * 0.18);
          this.ctx.audio.play('walkietalkie_fire', { pitch: 1.65, volume: 0.35 });
        }
        if (this.skylightFuse <= 0) this.detonateSkylightCharge();
      } else {
        const dist = _v
          .set(SKYLIGHT_CENTER[0], SKYLIGHT_CENTER[1], SKYLIGHT_CENTER[2])
          .distanceTo(this.ctx.player.position);
        const onRoof = this.ctx.player.position.y >= LV.roof - 1.5;
        if (onRoof && dist <= SKYLIGHT_PLANT_REACH) {
          if (!this.skylightPromptOff && this.ctx.hud?.follow) {
            this.skylightPromptOff = this.ctx.hud.follow(
              new THREE.Vector3(SKYLIGHT_CENTER[0], SKYLIGHT_CENTER[1] + 1.1, SKYLIGHT_CENTER[2]),
              `[${this.ctx.input.labelFor('interact')}] PLANT SKYLIGHT BREACH CHARGE`,
              '#ffb400',
            );
          }
          if (this.ctx.input.pressed('interact')) {
            this.skylightChargePlanted = true;
            this.skylightFuse = SKYLIGHT_FUSE;
            this.skylightBeep = 0;
            this.clearSkylightPrompt();
            if (this.skylightChargeMesh) this.skylightChargeMesh.visible = true;
            this.ctx.hud.feed('BREACH CHARGE ARMED — STAND BACK!', '#ffb400');
          }
        } else {
          this.clearSkylightPrompt();
        }
      }
    }

    // 4. Safe skylight drop cushion so leaping 14 m straight into the Banking Hall never hurts
    if (this.dropCushionTimer > 0) {
      this.dropCushionTimer -= dt;
      if (this.ctx.player.position.y < LV.roof - 2 && this.ctx.player.velocity.y < -9) {
        this.ctx.player.velocity.y = -9;
      }
    }

    // 5. Hanging / Falling Chandeliers
    for (const ch of this.chandeliers) {
      if (ch.state !== 'falling') continue;
      ch.vy -= 22 * dt;
      ch.root.position.y += ch.vy * dt;
      ch.root.rotation.x += dt * 1.8;
      if (ch.root.position.y <= LV.hall + 0.35) {
        ch.root.position.y = LV.hall + 0.35;
        ch.state = 'broken';
        ch.root.visible = false;
        this.ctx.fx.impact(ch.root.position, _v.set(0, 1, 0), 'glass', 3.2);
        this.ctx.fx.sparks(ch.root.position, _v.set(0, 1, 0), 22, '#ffd478');
        this.ctx.audio.play('glass_break', { position: ch.root.position, volume: 1 });
        this.ctx.camera.addTrauma(0.35);
        // Crush any SWAT caught beneath the fallen chandelier
        for (const e of [...this.manager.alive]) {
          if (e.position.distanceTo(ch.root.position) <= CHANDELIER_CRUSH_RADIUS) {
            this.manager.applyDamage(e, {
              amount: CHANDELIER_CRUSH_DAMAGE,
              point: e.position.clone(),
              dir: new THREE.Vector3(0, -1, 0),
              force: 30,
              type: 'melee',
              source: 'chandelier',
              gib: true,
            });
          }
        }
      }
    }

    // 6. Skylight SWAT Fast-Rope Helicopters
    for (let i = this.skylightHelis.length - 1; i >= 0; i--) {
      const h = this.skylightHelis[i]!;
      h.clock += dt;
      h.rotor.rotation.y += dt * 26;
      if (h.clock < 2.2) {
        const t = h.clock / 2.2;
        h.root.position.x = THREE.MathUtils.lerp(SKYLIGHT_CENTER[0] - 42, SKYLIGHT_CENTER[0], 1 - (1 - t) * (1 - t));
      } else if (h.clock < 5.2) {
        h.root.position.x = SKYLIGHT_CENTER[0];
        h.ropes.visible = true;
        if (!h.dropped && h.clock >= 3.2) {
          h.dropped = true;
          const roles: readonly EnemyId[] = ['trooper', 'gunner', 'riot'];
          for (let k = 0; k < roles.length; k++) {
            _v.set(SKYLIGHT_CENTER[0] + (k - 1) * 1.6, LV.hall + 0.2, SKYLIGHT_CENTER[2] + (k % 2) * 1.2);
            const man = this.ctx.enemies.spawn(roles[k]!, _v);
            if (man) this.ctx.campaign.enlist(man, 'swat_skylight');
          }
          this.ctx.hud.feed('SWAT FAST-ROPING THROUGH THE SKYLIGHT!', '#ff7a45');
        }
      } else {
        h.ropes.visible = false;
        h.root.position.x += dt * 22;
        h.root.position.y += dt * 4;
        if (h.clock >= 8.2) {
          h.loop?.stop();
          this.propsRoot.remove(h.root);
          this.skylightHelis.splice(i, 1);
        }
      }
    }

    // 7. Update all 4 core heist subsystems
    this.drill?.update(dt);
    this.bags?.update(dt);
    this.highway?.update(dt);
    this.boss?.update(dt);
  }

  // -----------------------------------------------------------------------------------------------
  // Lifecycle Cleanup
  // -----------------------------------------------------------------------------------------------

  clear(): void {
    if (this.fastRopeActive) {
      this.fastRopeActive = false;
      this.ctx.camera.setSeat(null);
      this.ctx.player.unpark(0);
    }
    this.fastRopeClock = 0;
    this.packmulePeelClock = -1;
    if (this.packmule) this.packmule.root.visible = false;
    if (this.fastRopeMesh) this.fastRopeMesh.visible = false;
    this.fastRopeLoop?.stop();
    this.fastRopeLoop = null;

    this.skylightWatchActive = false;
    this.skylightBlown = false;
    this.skylightChargePlanted = false;
    this.skylightFuse = 0;
    this.dropCushionTimer = 0;
    this.clearSkylightPrompt();
    if (this.skylightChargeMesh) this.skylightChargeMesh.visible = false;

    for (const h of this.skylightHelis) {
      h.loop?.stop();
      this.propsRoot.remove(h.root);
    }
    this.skylightHelis.length = 0;

    for (const ch of this.chandeliers) {
      ch.state = 'hanging';
      ch.vy = 0;
      ch.root.position.copy(ch.anchor);
      ch.root.rotation.set(0, 0, 0);
      ch.root.visible = true;
      ch.chain.visible = true;
    }

    this.drill?.clear();
    this.bags?.clear();
    this.highway?.clear();
    this.boss?.clear();
  }

  reset(): void {
    this.clear();
  }
}
