/**
 * Rooftop Mode Paratrooper Jet Drop system (`ParatrooperSystem`).
 *
 * A high-speed transport jet streaks across the skyscraper skyline with jet-roar audio
 * and deploys a 3–5 man SWAT squad under parachute canopies over an open `ParatrooperZone`.
 *
 * Gameplay loop:
 *   - Paratroopers descend visibly under procedural dome canopies + shroud lines with
 *     gentle sway while remaining 100% shootable mid-air (full hitboxes & ragdolls).
 *   - Shooting a paratrooper mid-air immediately collapses and detaches their canopy.
 *   - Surviving paratroopers touch down on the rooftop deck, shed their canopy, and
 *     immediately join active SWAT squad combat.
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/contracts';
import type { EnemyId } from '../../core/gameplay';
import { clamp, rand } from '../../core/math';
import { ModelMaterials } from '../../progression/modelkit';
import { warthogModel } from '../../progression/callins/warthog';
import type { ParatrooperZone } from '../../world/map/rooftop/plan';
import type { Enemy } from '../Enemy';
import type { EnemyManager } from '../EnemyManager';
import type { Outpost } from '../outpost';
import type { OutpostSquad } from '../outpost/squad';

const JET_SPEED = 86;
const JET_ALT_OFFSET = 46;
const JET_ENTRY_DIST = 175;
const JET_EXIT_DIST = 175;
const DROP_START_ALONG = -16;
const DROP_INTERVAL = 0.24;
const DESCENT_SPEED = 5.6;
const CANOPY_COLLAPSE_AIR = 1.4;
const CANOPY_COLLAPSE_LAND = 0.55;
const FEED_COLOR = '#6ec8ff';

interface JetDrop {
  jet: THREE.Group;
  origin: THREE.Vector3;
  dir: THREE.Vector3;
  along: number;
  zone: ParatrooperZone;
  remaining: EnemyId[];
  squad: OutpostSquad | null;
  dropIn: number;
  dropIndex: number;
}

interface ActiveParatrooper {
  enemy: Enemy;
  canopy: THREE.Group;
  start: THREE.Vector3;
  landing: THREE.Vector3;
  phase: number;
  age: number;
}

interface FallingCanopy {
  canopy: THREE.Group;
  vel: THREE.Vector3;
  age: number;
  duration: number;
}

let sharedDomeGeo: THREE.SphereGeometry | null = null;
let sharedDomeMat: THREE.MeshStandardMaterial | null = null;
let sharedLineGeo: THREE.CylinderGeometry | null = null;
let sharedLineMat: THREE.MeshStandardMaterial | null = null;

function ensureCanopyAssets(): {
  domeGeo: THREE.SphereGeometry;
  domeMat: THREE.MeshStandardMaterial;
  lineGeo: THREE.CylinderGeometry;
  lineMat: THREE.MeshStandardMaterial;
} {
  if (!sharedDomeGeo) {
    sharedDomeGeo = new THREE.SphereGeometry(1.75, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.48);
  }
  if (!sharedDomeMat) {
    sharedDomeMat = new THREE.MeshStandardMaterial({
      color: '#cfd8e0',
      roughness: 0.88,
      metalness: 0.05,
      side: THREE.DoubleSide,
    });
  }
  if (!sharedLineGeo) {
    sharedLineGeo = new THREE.CylinderGeometry(0.015, 0.015, 1, 4, 1, true);
  }
  if (!sharedLineMat) {
    sharedLineMat = new THREE.MeshStandardMaterial({ color: '#2b3036', roughness: 0.9 });
  }
  return { domeGeo: sharedDomeGeo, domeMat: sharedDomeMat, lineGeo: sharedLineGeo, lineMat: sharedLineMat };
}

function buildCanopyMesh(): THREE.Group {
  const { domeGeo, domeMat, lineGeo, lineMat } = ensureCanopyAssets();
  const group = new THREE.Group();

  const dome = new THREE.Mesh(domeGeo, domeMat);
  dome.position.set(0, 3.1, 0);
  dome.castShadow = false;
  group.add(dome);

  // Four angled shroud lines linking the dome rim down to the trooper's harness (~y = 1.45).
  const rimY = 3.18;
  const harnessY = 1.45;
  const rimR = 1.6;
  const angles = [Math.PI * 0.25, Math.PI * 0.75, Math.PI * 1.25, Math.PI * 1.75];
  const top = new THREE.Vector3();
  const bot = new THREE.Vector3(0, harnessY, 0);
  const diff = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  for (const a of angles) {
    top.set(Math.cos(a) * rimR, rimY, Math.sin(a) * rimR);
    diff.subVectors(top, bot);
    const len = diff.length();
    const line = new THREE.Mesh(lineGeo, lineMat);
    line.position.copy(bot).addScaledVector(diff, 0.5);
    line.scale.set(1, len, 1);
    line.quaternion.setFromUnitVectors(up, diff.normalize());
    group.add(line);
  }

  return group;
}

const _pos = new THREE.Vector3();
const _target = new THREE.Vector3();
const _look = new THREE.Vector3();

export class ParatrooperSystem {
  private materials: ModelMaterials | null = null;
  private readonly drops: JetDrop[] = [];
  private readonly chutes: ActiveParatrooper[] = [];
  private readonly collapsed: FallingCanopy[] = [];

  /** Telemetry counters useful for HUD/debugging/tests. */
  shotMidAirCount = 0;
  landedCount = 0;
  dropsLaunched = 0;

  constructor(
    private readonly ctx: Ctx,
    private readonly outpost: Outpost,
    private readonly manager: EnemyManager,
  ) {}

  /** Troopers still onboard an incoming jet waiting to jump. */
  get pendingCount(): number {
    let n = 0;
    for (const d of this.drops) n += d.remaining.length;
    return n;
  }

  /** Troopers currently floating down under open canopies. */
  get descendingCount(): number {
    return this.chutes.length;
  }

  get activeJets(): number {
    return this.drops.length;
  }

  /** Launches a transport jet flyover that drops `squadIds` (typically 3–5 SWAT) above `zone`. */
  launchDrop(zone: ParatrooperZone, squadIds: readonly EnemyId[], bearing = rand(0, Math.PI * 2)): void {
    if (squadIds.length === 0) return;
    const { audio, hud, render } = this.ctx;
    this.materials ??= new ModelMaterials(this.ctx);

    const jet = warthogModel(this.materials);
    jet.scale.setScalar(1.15);
    const dir = new THREE.Vector3(Math.cos(bearing), 0, Math.sin(bearing)).normalize();
    const origin = new THREE.Vector3(zone.x, zone.y + JET_ALT_OFFSET, zone.z);

    _pos.copy(origin).addScaledVector(dir, -JET_ENTRY_DIST);
    jet.position.copy(_pos);
    _look.copy(_pos).add(dir);
    jet.lookAt(_look);
    render.scene.add(jet);

    const squad = this.outpost.muster(squadIds.length, _target.set(zone.x, zone.y, zone.z));
    this.drops.push({
      jet,
      origin,
      dir,
      along: -JET_ENTRY_DIST,
      zone,
      remaining: [...squadIds],
      squad,
      dropIn: 0,
      dropIndex: 0,
    });
    this.dropsLaunched++;

    audio.play('warthog_flyby', { position: _pos, volume: 1.35 });
    hud.feed('PARATROOPERS INBOUND', FEED_COLOR);
  }

  update(dt: number): void {
    this.updateDrops(dt);
    this.updateChutes(dt);
    this.updateCollapsed(dt);
  }

  private updateDrops(dt: number): void {
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i]!;
      d.along += JET_SPEED * dt;
      d.jet.position.copy(d.origin).addScaledVector(d.dir, d.along);

      if (d.along >= DROP_START_ALONG && d.remaining.length > 0) {
        d.dropIn -= dt;
        if (d.dropIn <= 0) {
          d.dropIn = DROP_INTERVAL;
          this.deployParatrooper(d);
        }
      }

      if (d.along >= JET_EXIT_DIST) {
        // Safety net: if a very large dt jumped past exit before deploying all troops, release remaining cleanly.
        while (d.remaining.length > 0) this.deployParatrooper(d);
        d.jet.removeFromParent();
        this.drops.splice(i, 1);
      }
    }
  }

  private deployParatrooper(d: JetDrop): void {
    const id = d.remaining.shift();
    if (!id) return;
    this.manager.queued = Math.max(0, this.manager.queued - 1);

    const idx = d.dropIndex++;
    const angle = idx * 2.399963 + rand(-0.25, 0.25);
    const radius = Math.min(d.zone.radius * 0.85, 1.4 + idx * 0.9);
    const landing = new THREE.Vector3(
      d.zone.x + Math.cos(angle) * radius,
      d.zone.y,
      d.zone.z + Math.sin(angle) * radius,
    );
    this.ctx.world.nav.nearest(landing, 6, landing);

    // Start directly beneath the jet's current corridor over the landing zone.
    const start = new THREE.Vector3(
      clamp(d.jet.position.x, d.zone.x - d.zone.radius * 1.4, d.zone.x + d.zone.radius * 1.4),
      d.origin.y - 2.2,
      clamp(d.jet.position.z, d.zone.z - d.zone.radius * 1.4, d.zone.z + d.zone.radius * 1.4),
    );

    const enemy = d.squad
      ? this.outpost.enlistInto(d.squad, id, start)
      : this.manager.spawn(id, start);
    if (!enemy) return;

    enemy.position.copy(start);
    enemy.groundY = landing.y;
    enemy.pinned = true;
    enemy.airborne = false;
    enemy.mode = 'hold';
    enemy.face = 'player';
    enemy.velocity.set(0, 0, 0);

    const canopy = buildCanopyMesh();
    canopy.position.copy(start);
    this.ctx.render.scene.add(canopy);

    this.chutes.push({
      enemy,
      canopy,
      start,
      landing,
      phase: rand(0, Math.PI * 2),
      age: 0,
    });
  }

  private updateChutes(dt: number): void {
    for (let i = this.chutes.length - 1; i >= 0; i--) {
      const c = this.chutes[i]!;
      const e = c.enemy;
      c.age += dt;

      if (!e.alive) {
        // Shot down mid-air: unpin ragdoll and collapse/detach the canopy.
        e.pinned = false;
        this.shotMidAirCount++;
        this.detachCanopy(c.canopy, CANOPY_COLLAPSE_AIR, rand(-1.8, 1.8), -2.6, rand(-1.8, 1.8));
        this.chutes.splice(i, 1);
        continue;
      }

      e.position.y -= DESCENT_SPEED * dt;
      const totalDrop = Math.max(1, c.start.y - c.landing.y);
      const frac = clamp(1 - (e.position.y - c.landing.y) / totalDrop, 0, 1);
      const swayEnvelope = Math.sin(frac * Math.PI);
      const swayX = Math.sin(c.age * 2.1 + c.phase) * 1.15 * swayEnvelope;
      const swayZ = Math.cos(c.age * 1.7 + c.phase) * 1.15 * swayEnvelope;

      e.position.x = c.start.x + (c.landing.x - c.start.x) * frac + swayX;
      e.position.z = c.start.z + (c.landing.z - c.start.z) * frac + swayZ;

      c.canopy.position.copy(e.position);
      c.canopy.rotation.z = Math.sin(c.age * 2.1 + c.phase) * 0.14 * swayEnvelope;
      c.canopy.rotation.x = Math.cos(c.age * 1.7 + c.phase) * 0.12 * swayEnvelope;

      if (e.position.y <= c.landing.y) {
        e.position.copy(c.landing);
        e.groundY = c.landing.y;
        e.groundSampleAt.set(c.landing.x, c.landing.z);
        e.pinned = false;
        e.airborne = false;
        e.verticalSpeed = 0;
        e.char.anim.play('land', 1.2);
        this.landedCount++;
        this.detachCanopy(c.canopy, CANOPY_COLLAPSE_LAND, rand(-0.6, 0.6), -1.1, rand(-0.6, 0.6));
        this.chutes.splice(i, 1);
      }
    }
  }

  private detachCanopy(canopy: THREE.Group, duration: number, vx: number, vy: number, vz: number): void {
    this.collapsed.push({
      canopy,
      vel: new THREE.Vector3(vx, vy, vz),
      age: 0,
      duration,
    });
  }

  private updateCollapsed(dt: number): void {
    for (let i = this.collapsed.length - 1; i >= 0; i--) {
      const f = this.collapsed[i]!;
      f.age += dt;
      const t = clamp(f.age / f.duration, 0, 1);
      f.canopy.position.addScaledVector(f.vel, dt);
      f.canopy.rotation.z += 1.4 * dt;
      const s = Math.max(0.05, 1 - t * 0.92);
      f.canopy.scale.set(s, Math.max(0.05, 1 - t * 0.85), s);
      if (f.age >= f.duration) {
        f.canopy.removeFromParent();
        this.collapsed.splice(i, 1);
      }
    }
  }

  reset(): void {
    for (const d of this.drops) {
      if (d.remaining.length > 0) {
        this.manager.queued = Math.max(0, this.manager.queued - d.remaining.length);
        d.remaining.length = 0;
      }
      d.jet.removeFromParent();
    }
    this.drops.length = 0;

    for (const c of this.chutes) {
      c.enemy.pinned = false;
      c.canopy.removeFromParent();
    }
    this.chutes.length = 0;

    for (const f of this.collapsed) {
      f.canopy.removeFromParent();
    }
    this.collapsed.length = 0;

    this.shotMidAirCount = 0;
    this.landedCount = 0;
    this.dropsLaunched = 0;
  }
}
