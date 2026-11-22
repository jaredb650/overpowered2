/**
 * Wall-mounted compound alarm panels and the central Security Hub override console ("Quiet Title").
 *
 * - Active wall panels are exposed via `activePanelPositions()` so Stealth AI alarm-callers
 *   know which station to sprint toward when raising a compound lockdown.
 * - Players can disable wall panels loudly by shooting them (`damageCollider`, sparks + 10 m
 *   sound) or silently up close with `[E]` (`interact(id)`), or cut their circuit via
 *   `setGroupPower(group, false)`.
 * - Interacting `[E]` with the Security Hub console (`isHub: true`) overrides the estate alarm
 *   grid (`onHubOverride`), silencing alarm klaxons and halting fresh QRF reinforcement waves.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Ctx } from '../core/contracts';
import { Geo, type Mat } from './kit/geo';

export interface AlarmPanelSpec {
  id: string;
  position: readonly [number, number, number];
  yaw: number;
  group?: string;
  /** True for the central Security Hub override console (silences lockdown QRF sweeps). */
  isHub?: boolean;
}

export interface AlarmInteractable {
  readonly id: string;
  readonly label: string;
  readonly isHub: boolean;
  readonly position: THREE.Vector3;
}

export interface AlarmSystemOptions {
  /** Fired when the player overrides the Security Hub console (`isHub: true`). */
  onHubOverride?: (hubId: string, position: THREE.Vector3) => void;
  /** Fired when a wall alarm panel is destroyed by gunfire (10 m sound radius). */
  onPanelDestroyed?: (position: THREE.Vector3, panelId: string, soundRadius: number) => void;
  /** Fired when a wall alarm panel is silently disabled via [E]. */
  onPanelDisabled?: (position: THREE.Vector3, panelId: string) => void;
  /** Optional world material lookup matching World.material. */
  material?: (mat: Mat) => THREE.Material;
}

/** Read-only runtime state view of an alarm panel or Security Hub console. */
export interface AlarmPanelState {
  readonly id: string;
  readonly group: string | undefined;
  readonly isHub: boolean;
  readonly position: THREE.Vector3;
  readonly yaw: number;
  readonly powered: boolean;
  readonly disabled: boolean;
  readonly destroyed: boolean;
  readonly overridden: boolean;
  readonly active: boolean;
  readonly collider: RAPIER.Collider | null;
}

export const ALARM_DESTROY_SOUND_RADIUS = 10;
export const ALARM_DEFAULT_INTERACT_DIST = 2.6;

const COLOR_LED_ACTIVE = 0x38ff88;
const COLOR_LED_HUB_ACTIVE = 0xff7a22;
const COLOR_LED_HUB_OVERRIDE = 0x22ff99;
const COLOR_LED_OFF = 0x101418;

const COLOR_SCREEN_ACTIVE = 0x38c8ff;
const COLOR_SCREEN_OVERRIDE = 0x20e080;
const COLOR_SCREEN_OFF = 0x0b1116;

const UP = new THREE.Vector3(0, 1, 0);
const WALL_COLLIDER_HALF = new THREE.Vector3(0.24, 0.28, 0.12);
const HUB_COLLIDER_HALF = new THREE.Vector3(0.62, 0.56, 0.42);
const _quat = new THREE.Quaternion();
const _center = new THREE.Vector3();

function buildBevelBoxGeo(hx: number, hy: number, hz: number, bevel: number): THREE.BufferGeometry {
  const geo = new Geo();
  geo.use('steelDark').bevel(0, 0, 0, hx, hy, hz, bevel);
  const b = [...geo.buckets.values()][0]!;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(b.p.slice(0, b.nv * 3), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(b.n.slice(0, b.nv * 3), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(b.uv.slice(0, b.nv * 2), 2));
  g.setAttribute('color', new THREE.BufferAttribute(b.c.slice(0, b.nv * 4), 4, true));
  g.setIndex(new THREE.BufferAttribute(b.idx.slice(0, b.ni), 1));
  g.computeBoundingSphere();
  return g;
}

interface AlarmRuntime {
  readonly id: string;
  readonly group: string | undefined;
  readonly isHub: boolean;
  readonly position: THREE.Vector3;
  readonly colliderCenter: THREE.Vector3;
  readonly yaw: number;
  powered: boolean;
  disabled: boolean;
  destroyed: boolean;
  overridden: boolean;
  collider: RAPIER.Collider | null;
  readonly groupNode: THREE.Group;
  readonly thermalTarget: THREE.Mesh;
  readonly ledMat: THREE.MeshBasicMaterial;
  readonly screenMat: THREE.MeshBasicMaterial | null;
  readonly interactInfo: AlarmInteractable;
  readonly active: boolean;
}

export class AlarmSystem {
  readonly root = new THREE.Group();
  private readonly list: AlarmRuntime[] = [];
  private readonly byId = new Map<string, AlarmRuntime>();
  private readonly byCollider = new Map<number, AlarmRuntime>();
  private readonly activePosCache: THREE.Vector3[] = [];
  private readonly thermalCache: THREE.Object3D[] = [];
  private readonly ownedGeos: THREE.BufferGeometry[] = [];
  private readonly ownedMats: THREE.Material[] = [];
  private readonly onHubOverride?: (hubId: string, position: THREE.Vector3) => void;
  private readonly onPanelDestroyed?: (position: THREE.Vector3, panelId: string, soundRadius: number) => void;
  private readonly onPanelDisabled?: (position: THREE.Vector3, panelId: string) => void;
  private _hubOverridden = false;

  constructor(
    private readonly ctx: Ctx,
    specs: readonly AlarmPanelSpec[],
    options: AlarmSystemOptions = {},
  ) {
    this.root.name = 'alarm-panels';
    this.onHubOverride = options.onHubOverride;
    this.onPanelDestroyed = options.onPanelDestroyed;
    this.onPanelDisabled = options.onPanelDisabled;

    const steelDarkMat = this.resolveMat(options.material, 'steelDark', 0x2c333d, 0.72, 0.45);
    const steelMat = this.resolveMat(options.material, 'steel', 0x677482, 0.68, 0.4);
    const redMat = this.resolveMat(options.material, 'paintRed', 0xc62a24, 0.25, 0.45);
    const keyMat = new THREE.MeshStandardMaterial({ color: 0x1a2028, metalness: 0.35, roughness: 0.65 });
    this.ownedMats.push(keyMat);

    // Wall alarm box shared geometry
    const wallHousingGeo = buildBevelBoxGeo(0.2, 0.25, 0.08, 0.02);
    const wallFrameGeo = new THREE.BoxGeometry(0.32, 0.36, 0.03);
    const pullBarGeo = new THREE.BoxGeometry(0.2, 0.06, 0.06);
    const pullPlateGeo = new THREE.BoxGeometry(0.14, 0.16, 0.035);
    const ledGeo = new THREE.SphereGeometry(0.026, 8, 6);

    // Security Hub console desk shared geometry
    const hubBaseGeo = buildBevelBoxGeo(0.56, 0.44, 0.34, 0.03);
    const hubDeskGeo = new THREE.BoxGeometry(1.16, 0.08, 0.72);
    const hubScreenHoodGeo = new THREE.BoxGeometry(0.92, 0.52, 0.12);
    const hubScreenGeo = new THREE.PlaneGeometry(0.8, 0.4);
    const hubKeypadGeo = new THREE.BoxGeometry(0.36, 0.04, 0.22);
    const hubBeaconGeo = new THREE.CylinderGeometry(0.035, 0.04, 0.06, 10);

    this.ownedGeos.push(
      wallHousingGeo, wallFrameGeo, pullBarGeo, pullPlateGeo, ledGeo,
      hubBaseGeo, hubDeskGeo, hubScreenHoodGeo, hubScreenGeo, hubKeypadGeo, hubBeaconGeo,
    );

    for (const spec of specs) {
      const isHub = spec.isHub === true;
      const position = new THREE.Vector3(spec.position[0], spec.position[1], spec.position[2]);
      const colliderCenter = new THREE.Vector3(
        position.x,
        isHub ? position.y + 0.56 : position.y,
        position.z,
      );

      const groupNode = new THREE.Group();
      groupNode.name = `${isHub ? 'hub' : 'alarm'}_${spec.id}`;
      groupNode.position.copy(position);
      groupNode.rotation.y = spec.yaw;

      let thermalTarget: THREE.Mesh;
      let ledMat: THREE.MeshBasicMaterial;
      let screenMat: THREE.MeshBasicMaterial | null = null;

      if (isHub) {
        const base = new THREE.Mesh(hubBaseGeo, steelDarkMat);
        base.position.set(0, 0.44, 0);
        base.castShadow = true;
        base.receiveShadow = true;
        groupNode.add(base);

        const desk = new THREE.Mesh(hubDeskGeo, steelMat);
        desk.position.set(0, 0.89, 0.03);
        desk.rotation.x = 0.16;
        desk.castShadow = true;
        desk.receiveShadow = true;
        groupNode.add(desk);

        const screenHood = new THREE.Mesh(hubScreenHoodGeo, steelDarkMat);
        screenHood.position.set(0, 1.18, -0.2);
        screenHood.rotation.x = -0.26;
        screenHood.castShadow = true;
        groupNode.add(screenHood);
        thermalTarget = screenHood;

        screenMat = new THREE.MeshBasicMaterial({ color: COLOR_SCREEN_ACTIVE, toneMapped: false });
        this.ownedMats.push(screenMat);
        const screen = new THREE.Mesh(hubScreenGeo, screenMat);
        screen.position.set(0, 1.18, -0.135);
        screen.rotation.x = -0.26;
        groupNode.add(screen);

        const keypad = new THREE.Mesh(hubKeypadGeo, keyMat);
        keypad.position.set(0.24, 0.94, 0.16);
        keypad.rotation.x = 0.16;
        groupNode.add(keypad);

        ledMat = new THREE.MeshBasicMaterial({ color: COLOR_LED_HUB_ACTIVE, toneMapped: false });
        this.ownedMats.push(ledMat);
        const beacon = new THREE.Mesh(hubBeaconGeo, ledMat);
        beacon.position.set(-0.44, 1.47, -0.24);
        groupNode.add(beacon);
      } else {
        const housing = new THREE.Mesh(wallHousingGeo, steelDarkMat);
        housing.castShadow = true;
        housing.receiveShadow = true;
        groupNode.add(housing);
        thermalTarget = housing;

        const frame = new THREE.Mesh(wallFrameGeo, steelMat);
        frame.position.set(0, 0, 0.075);
        groupNode.add(frame);

        const plate = new THREE.Mesh(pullPlateGeo, redMat);
        plate.position.set(0, -0.04, 0.095);
        groupNode.add(plate);

        const pullBar = new THREE.Mesh(pullBarGeo, redMat);
        pullBar.position.set(0, -0.02, 0.125);
        groupNode.add(pullBar);

        ledMat = new THREE.MeshBasicMaterial({ color: COLOR_LED_ACTIVE, toneMapped: false });
        this.ownedMats.push(ledMat);
        const led = new THREE.Mesh(ledGeo, ledMat);
        led.position.set(0, 0.145, 0.1);
        groupNode.add(led);
      }

      this.root.add(groupNode);

      const collider = this.createCollider(colliderCenter, spec.yaw, isHub);

      const interactInfo: AlarmInteractable = {
        id: spec.id,
        label: isHub ? 'OVERRIDE SECURITY HUB' : 'DISABLE ALARM PANEL',
        isHub,
        position,
      };

      const runtime: AlarmRuntime = {
        id: spec.id,
        group: spec.group,
        isHub,
        position,
        colliderCenter,
        yaw: spec.yaw,
        powered: true,
        disabled: false,
        destroyed: false,
        overridden: false,
        collider,
        groupNode,
        thermalTarget,
        ledMat,
        screenMat,
        interactInfo,
        get active() {
          return this.isHub
            ? !this.overridden
            : this.powered && !this.disabled && !this.destroyed;
        },
      };

      this.list.push(runtime);
      this.byId.set(spec.id, runtime);
      if (collider) this.byCollider.set(collider.handle, runtime);
    }

    this.rebuildCaches();
  }

  private resolveMat(
    lookup: ((mat: Mat) => THREE.Material) | undefined,
    name: Mat,
    fallbackColor: number,
    metalness: number,
    roughness: number,
  ): THREE.Material {
    if (lookup) return lookup(name);
    const m = new THREE.MeshStandardMaterial({ color: fallbackColor, metalness, roughness });
    this.ownedMats.push(m);
    return m;
  }

  private createCollider(center: THREE.Vector3, yaw: number, isHub: boolean): RAPIER.Collider | null {
    if (!this.ctx.physics?.addStaticBox) return null;
    _quat.setFromAxisAngle(UP, yaw);
    _center.copy(center);
    return this.ctx.physics.addStaticBox(_center, isHub ? HUB_COLLIDER_HALF : WALL_COLLIDER_HALF, _quat, 'metal');
  }

  private removeCollider(panel: AlarmRuntime): void {
    if (!panel.collider) return;
    this.byCollider.delete(panel.collider.handle);
    this.ctx.physics?.world?.removeCollider(panel.collider, false);
    panel.collider = null;
  }

  private updateVisual(panel: AlarmRuntime): void {
    if (panel.isHub) {
      if (panel.overridden) {
        panel.ledMat.color.setHex(COLOR_LED_HUB_OVERRIDE);
        panel.screenMat?.color.setHex(COLOR_SCREEN_OVERRIDE);
      } else if (!panel.powered) {
        panel.ledMat.color.setHex(COLOR_LED_OFF);
        panel.screenMat?.color.setHex(COLOR_SCREEN_OFF);
      } else {
        panel.ledMat.color.setHex(COLOR_LED_HUB_ACTIVE);
        panel.screenMat?.color.setHex(COLOR_SCREEN_ACTIVE);
      }
      return;
    }

    const online = panel.powered && !panel.disabled && !panel.destroyed;
    panel.ledMat.color.setHex(online ? COLOR_LED_ACTIVE : COLOR_LED_OFF);
  }

  private rebuildCaches(): void {
    this.activePosCache.length = 0;
    this.thermalCache.length = 0;
    for (let i = 0; i < this.list.length; i++) {
      const p = this.list[i]!;
      if (!p.isHub && p.powered && !p.disabled && !p.destroyed) {
        this.activePosCache.push(p.position);
      }
      if (p.powered && !p.destroyed && (!p.disabled || p.isHub)) {
        this.thermalCache.push(p.thermalTarget);
      }
    }
  }

  /** True once the central Security Hub has been overridden. */
  get hubOverridden(): boolean {
    return this._hubOverridden;
  }

  /** Positions of all active wall alarm panels that AI alarm-callers can trigger. */
  activePanelPositions(): readonly THREE.Vector3[] {
    return this.activePosCache;
  }

  /** Powered alarm hardware & hub console meshes that glow warm in Thermal Vision. */
  thermalMeshes(): readonly THREE.Object3D[] {
    return this.thermalCache;
  }

  /** True if `collider` belongs to an alarm panel or Security Hub console. */
  isCollider(collider: RAPIER.Collider | null): boolean {
    return collider !== null && this.byCollider.has(collider.handle);
  }

  /**
   * Shooting a wall alarm panel destroys it with sparks and a 10 m sound radius.
   * Shooting the Security Hub console sparks harmlessly so the `[E]` override stays intact.
   */
  damageCollider(collider: RAPIER.Collider | null, amount = 1): boolean {
    if (!collider || amount <= 0) return false;
    const panel = this.byCollider.get(collider.handle);
    if (!panel) return false;

    if (panel.isHub) {
      this.ctx.fx?.sparks?.(panel.colliderCenter, UP, 10, 0xdce4ee);
      this.ctx.audio?.play?.('metal_clang', { position: panel.colliderCenter, volume: 0.5, pitch: 1.2 });
      return true;
    }

    if (panel.destroyed) return false;
    this.destroyPanel(panel);
    return true;
  }

  /** Destroys every intact non-hub wall alarm panel within `radius` of `center`. Returns how many were destroyed. */
  blast(center: THREE.Vector3, radius: number): number {
    if (radius <= 0) return 0;
    const r2 = radius * radius;
    let hits = 0;
    for (let i = 0; i < this.list.length; i++) {
      const p = this.list[i]!;
      if (p.isHub || p.destroyed) continue;
      if (p.position.distanceToSquared(center) <= r2) {
        this.destroyPanel(p);
        hits++;
      }
    }
    return hits;
  }

  private destroyPanel(panel: AlarmRuntime): void {
    panel.destroyed = true;
    panel.disabled = true;
    this.removeCollider(panel);
    this.updateVisual(panel);

    this.ctx.fx?.sparks?.(panel.position, UP, 18, 0xffcc55);
    this.ctx.fx?.smoke?.(panel.position, 0x2c323a, 0.6, 1.3);
    this.ctx.audio?.play?.('electric_zap', { position: panel.position, volume: 0.65, pitch: 1.15 });
    this.ctx.audio?.play?.('metal_clang', { position: panel.position, volume: 0.5, pitch: 1.45 });

    this.rebuildCaches();
    this.onPanelDestroyed?.(panel.position, panel.id, ALARM_DESTROY_SOUND_RADIUS);
  }

  /**
   * Handles `[E]` interaction:
   * - Wall panel: silently disables/hacks it offline (no gunshot noise).
   * - Security Hub (`isHub: true`): overrides the estate alarm grid and fires `onHubOverride`.
   */
  interact(id: string): boolean {
    const panel = this.byId.get(id);
    if (!panel) return false;

    if (panel.isHub) {
      if (panel.overridden) return false;
      panel.overridden = true;
      this._hubOverridden = true;
      this.updateVisual(panel);
      this.ctx.audio?.play?.('stake_beep', { position: panel.position, volume: 0.6, pitch: 1.3 });
      this.rebuildCaches();
      this.onHubOverride?.(panel.id, panel.position);
      return true;
    }

    if (!panel.powered || panel.disabled || panel.destroyed) return false;
    panel.disabled = true;
    this.updateVisual(panel);
    this.ctx.audio?.play?.('stake_beep', { position: panel.position, volume: 0.35, pitch: 0.72 });
    this.rebuildCaches();
    this.onPanelDisabled?.(panel.position, panel.id);
    return true;
  }

  /** Cuts or restores breaker circuit power for all panels in `group`. */
  setGroupPower(group: string, powered: boolean): void {
    let changed = false;
    for (let i = 0; i < this.list.length; i++) {
      const p = this.list[i]!;
      if (p.group !== group || p.powered === powered) continue;
      p.powered = powered;
      this.updateVisual(p);
      changed = true;
    }
    if (changed) this.rebuildCaches();
  }

  /** Nearest interactable wall alarm panel or Security Hub within `maxDist` meters (zero allocations). */
  nearestInteractable(playerPos: THREE.Vector3, maxDist = ALARM_DEFAULT_INTERACT_DIST): AlarmInteractable | null {
    let best: AlarmRuntime | null = null;
    let bestDistSq = maxDist * maxDist;

    for (let i = 0; i < this.list.length; i++) {
      const p = this.list[i]!;
      if (p.isHub) {
        if (p.overridden) continue;
      } else {
        if (!p.powered || p.disabled || p.destroyed) continue;
      }

      const dSq = p.position.distanceToSquared(playerPos);
      if (dSq <= bestDistSq) {
        bestDistSq = dSq;
        best = p;
      }
    }

    return best ? best.interactInfo : null;
  }

  /** Read-only inspection of a panel by id. */
  getPanel(id: string): AlarmPanelState | undefined {
    return this.byId.get(id);
  }

  /** All panels as read-only state views. */
  get panels(): readonly AlarmPanelState[] {
    return this.list;
  }

  /** Restores all wall panels and the Security Hub to initial armed state. */
  reset(): void {
    this._hubOverridden = false;
    for (let i = 0; i < this.list.length; i++) {
      const p = this.list[i]!;
      p.powered = true;
      p.disabled = false;
      p.destroyed = false;
      p.overridden = false;
      this.updateVisual(p);
      if (!p.collider) {
        const collider = this.createCollider(p.colliderCenter, p.yaw, p.isHub);
        p.collider = collider;
        if (collider) this.byCollider.set(collider.handle, p);
      }
    }
    this.rebuildCaches();
  }

  /** Removes colliders, detaches from scene, and disposes owned GPU resources. */
  dispose(): void {
    for (let i = 0; i < this.list.length; i++) {
      this.removeCollider(this.list[i]!);
    }
    this.root.removeFromParent();
    for (let i = 0; i < this.ownedGeos.length; i++) this.ownedGeos[i]!.dispose();
    for (let i = 0; i < this.ownedMats.length; i++) this.ownedMats[i]!.dispose();
    this.ownedGeos.length = 0;
    this.ownedMats.length = 0;
    this.activePosCache.length = 0;
    this.thermalCache.length = 0;
  }
}
