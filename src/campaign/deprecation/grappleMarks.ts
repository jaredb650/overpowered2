/**
 * High-visibility Gaff grapple anchor beacons & crosshair reticle HUD overlay for Deprecation.
 *
 * - Places high-visibility safety-orange steel beacon rings + rotating diamond markers on
 *   designated skyline crane booms, billboard gantries, and ORION-0's Stage 3B shoulders.
 * - Reuses `HARPOON.maxRange` (`160 m`) from `src/weapons/harpoon.ts` without modifying core Gaff code.
 * - Projects active anchors to clean DOM HUD reticle indicators (`[RMB] GAFF`) when within
 *   Gaff range and near the player's crosshair, cleaning up all DOM & Three.js resources on `dispose()`.
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/contracts';
import { clamp } from '../../core/math';
import { HARPOON } from '../../weapons/harpoon';

export type Vec3Like = THREE.Vector3 | readonly [number, number, number];

export interface GrappleMarkDef {
  readonly id: string;
  /** World anchor position, or a dynamic provider (e.g., ORION-0 shoulder mount). */
  readonly position: Vec3Like | (() => THREE.Vector3 | null);
  /** Prompt text displayed beneath the reticle diamond (default `'[RMB] GAFF'`). */
  readonly label?: string;
  /** Maximum grapple highlight distance in meters (default `HARPOON.maxRange` = `160`). */
  readonly maxRange?: number;
  /** Minimum distance in meters below which the indicator hides (default `2.5`). */
  readonly minRange?: number;
  /** Half-angle cone in degrees around the player's crosshair for reticle activation (default `24`). */
  readonly aimConeDeg?: number;
  /** Visual radius of the 3D orange steel beacon ring in meters (default `1.2`). */
  readonly radius?: number;
  /** Higher priority breaks ties when multiple anchors lie inside the aim cone (default `0`). */
  readonly priority?: number;
  /** Whether the anchor starts enabled (default `true`). */
  readonly enabled?: boolean;
}

export interface GrappleMarkEvaluation {
  readonly visible: boolean;
  readonly inRange: boolean;
  readonly inAimCone: boolean;
  readonly distance: number;
  /** Cosine of the angle between the look vector and the vector toward the anchor (`-1..1`). */
  readonly dot: number;
  /** Angle off the crosshair in degrees (`0..180`). */
  readonly angleDeg: number;
}

export interface GrappleMarkView {
  readonly id: string;
  readonly label: string;
  readonly position: THREE.Vector3;
  readonly distance: number;
  readonly angleDeg: number;
  readonly priority: number;
  readonly focused: boolean;
  /** Normalized viewport coordinates `[0..1]` when a camera is available. */
  readonly screenX: number;
  readonly screenY: number;
}

export const GRAPPLE_MARK_DEFAULTS = {
  label: '[RMB] GAFF',
  maxRange: HARPOON.maxRange,
  minRange: 2.5,
  aimConeDeg: 24,
  radius: 1.2,
} as const;

const _toAnchor = new THREE.Vector3();
const _fwdNorm = new THREE.Vector3();
const _proj = new THREE.Vector3();

function toVec3(v: Vec3Like, out: THREE.Vector3): THREE.Vector3 {
  if (v instanceof THREE.Vector3) return out.copy(v);
  return out.set(v[0], v[1], v[2]);
}

/**
 * Pure headless-safe evaluator testing whether an anchor is within Gaff range and inside
 * the player's crosshair aim cone.
 */
export function evaluateGrappleAnchor(
  eye: THREE.Vector3,
  forward: THREE.Vector3,
  anchor: THREE.Vector3,
  maxRange: number = GRAPPLE_MARK_DEFAULTS.maxRange,
  aimConeDeg: number = GRAPPLE_MARK_DEFAULTS.aimConeDeg,
  minRange: number = GRAPPLE_MARK_DEFAULTS.minRange,
): GrappleMarkEvaluation {
  _toAnchor.subVectors(anchor, eye);
  const distance = _toAnchor.length();
  const inRange = distance >= minRange && distance <= maxRange;

  if (distance < 1e-6) {
    return { visible: false, inRange: false, inAimCone: false, distance: 0, dot: 1, angleDeg: 0 };
  }

  _toAnchor.divideScalar(distance);
  _fwdNorm.copy(forward);
  const fl = _fwdNorm.length();
  if (fl > 1e-6) _fwdNorm.divideScalar(fl);
  else _fwdNorm.set(0, 0, -1);

  const dot = clamp(_toAnchor.dot(_fwdNorm), -1, 1);
  const angleDeg = (Math.acos(dot) * 180) / Math.PI;
  const inAimCone = dot > 0 && angleDeg <= aimConeDeg;

  return {
    visible: inRange && inAimCone,
    inRange,
    inAimCone,
    distance,
    dot,
    angleDeg,
  };
}

interface AnchorVisuals {
  root: THREE.Group;
  ring: THREE.Mesh;
  diamond: THREE.Mesh;
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
}

interface GrappleAnchorInternal {
  readonly id: string;
  label: string;
  readonly position: THREE.Vector3;
  positionProvider: (() => THREE.Vector3 | null) | null;
  maxRange: number;
  minRange: number;
  aimConeDeg: number;
  radius: number;
  priority: number;
  enabled: boolean;
  readonly initialEnabled: boolean;
  readonly initialPosition: THREE.Vector3;
  visuals: AnchorVisuals | null;
  domEl: HTMLDivElement | null;
  domLabelEl: HTMLSpanElement | null;
  domDistEl: HTMLSpanElement | null;
}

export class GrappleMarkManager {
  private readonly anchors = new Map<string, GrappleAnchorInternal>();
  private readonly activeViews: GrappleMarkView[] = [];
  private focusedView: GrappleMarkView | null = null;
  private overlayRoot: HTMLDivElement | null = null;
  private clock = 0;
  private disposed = false;

  constructor(private readonly ctx: Ctx, private readonly mount?: HTMLElement | null) {}

  /** Total registered grapple marks (enabled or disabled). */
  get count(): number {
    return this.anchors.size;
  }

  /** Registers a grapple anchor beacon and builds its 3D ring/diamond and DOM reticle element. */
  add(def: GrappleMarkDef): void {
    if (this.disposed) return;
    if (this.anchors.has(def.id)) {
      this.remove(def.id);
    }

    const pos = new THREE.Vector3();
    let provider: (() => THREE.Vector3 | null) | null = null;
    if (typeof def.position === 'function') {
      provider = def.position;
      const initial = provider();
      if (initial) pos.copy(initial);
    } else {
      toVec3(def.position, pos);
    }

    const enabled = def.enabled !== false;
    const radius = def.radius ?? GRAPPLE_MARK_DEFAULTS.radius;
    const label = def.label ?? GRAPPLE_MARK_DEFAULTS.label;

    const anchor: GrappleAnchorInternal = {
      id: def.id,
      label,
      position: pos.clone(),
      positionProvider: provider,
      maxRange: def.maxRange ?? GRAPPLE_MARK_DEFAULTS.maxRange,
      minRange: def.minRange ?? GRAPPLE_MARK_DEFAULTS.minRange,
      aimConeDeg: def.aimConeDeg ?? GRAPPLE_MARK_DEFAULTS.aimConeDeg,
      radius,
      priority: def.priority ?? 0,
      enabled,
      initialEnabled: enabled,
      initialPosition: pos.clone(),
      visuals: this.buildAnchorVisuals(pos, radius, enabled),
      domEl: null,
      domLabelEl: null,
      domDistEl: null,
    };

    this.ensureDomElement(anchor);
    this.anchors.set(def.id, anchor);
  }

  /** Removes a grapple anchor and cleans up its 3D beacon and DOM reticle element. */
  remove(id: string): boolean {
    const anchor = this.anchors.get(id);
    if (!anchor) return false;
    this.disposeAnchorVisuals(anchor);
    anchor.domEl?.remove();
    anchor.domEl = null;
    anchor.domLabelEl = null;
    anchor.domDistEl = null;
    this.anchors.delete(id);
    return true;
  }

  /** Enables or disables a grapple anchor (hides both 3D beacon and HUD reticle when disabled). */
  setEnabled(id: string, enabled: boolean): void {
    const anchor = this.anchors.get(id);
    if (!anchor) return;
    anchor.enabled = enabled;
    if (anchor.visuals) {
      anchor.visuals.root.visible = enabled;
    }
    if (!enabled && anchor.domEl) {
      anchor.domEl.style.display = 'none';
    }
  }

  /** Updates a static anchor's world position dynamically (e.g. moving crane boom or boss shoulder). */
  setPosition(id: string, pos: Vec3Like): void {
    const anchor = this.anchors.get(id);
    if (!anchor) return;
    toVec3(pos, anchor.position);
    anchor.positionProvider = null;
    if (anchor.visuals) {
      anchor.visuals.root.position.copy(anchor.position);
    }
  }

  /** Returns all grapple marks currently within range and inside the player's aim cone, best first. */
  getActiveMarks(): readonly GrappleMarkView[] {
    return this.activeViews;
  }

  /** Returns the single highest-priority / closest-to-crosshair active grapple mark, or null. */
  getFocusedMark(): GrappleMarkView | null {
    return this.focusedView;
  }

  /** Updates 3D beacon pulse/spin, filters by Gaff range & crosshair cone, and projects HUD reticles. */
  update(dt: number): void {
    if (this.disposed) return;
    if (dt > 0) this.clock += dt;

    this.activeViews.length = 0;
    this.focusedView = null;

    const player = this.ctx.player;
    const camera = this.ctx.render?.camera;
    const eye = player?.eye ?? player?.position ?? null;
    const forward = player?.forward ?? null;
    const canShowHud = Boolean(player && player.alive && !player.parked && eye && forward);

    interface Candidate {
      anchor: GrappleAnchorInternal;
      evalRes: GrappleMarkEvaluation;
      screenX: number;
      screenY: number;
      score: number;
    }
    const candidates: Candidate[] = [];

    for (const anchor of this.anchors.values()) {
      if (anchor.positionProvider) {
        const next = anchor.positionProvider();
        if (next) {
          anchor.position.copy(next);
          if (anchor.visuals) anchor.visuals.root.position.copy(next);
        } else {
          if (anchor.visuals) anchor.visuals.root.visible = false;
          if (anchor.domEl) anchor.domEl.style.display = 'none';
          continue;
        }
      }

      if (anchor.visuals) {
        anchor.visuals.root.visible = anchor.enabled;
        if (anchor.enabled) {
          const pulse = 1 + Math.sin(this.clock * 5.0) * 0.1;
          anchor.visuals.ring.scale.setScalar(pulse);
          anchor.visuals.diamond.rotation.y += Math.max(0, dt) * 1.8;
          anchor.visuals.diamond.rotation.z = Math.sin(this.clock * 2.6) * 0.2;
          if (eye) {
            anchor.visuals.ring.lookAt(eye);
          }
        }
      }

      if (!anchor.enabled || !canShowHud || !eye || !forward) {
        if (anchor.domEl) anchor.domEl.style.display = 'none';
        continue;
      }

      const evalRes = evaluateGrappleAnchor(
        eye,
        forward,
        anchor.position,
        anchor.maxRange,
        anchor.aimConeDeg,
        anchor.minRange,
      );

      if (!evalRes.visible) {
        if (anchor.domEl) anchor.domEl.style.display = 'none';
        continue;
      }

      let screenX = 0.5;
      let screenY = 0.5;
      if (camera && typeof camera.projectionMatrix !== 'undefined') {
        _proj.copy(anchor.position).project(camera);
        if (_proj.z > 1) {
          if (anchor.domEl) anchor.domEl.style.display = 'none';
          continue;
        }
        screenX = (_proj.x + 1) * 0.5;
        screenY = (1 - _proj.y) * 0.5;
      }

      // Higher priority wins; within same priority smaller angle off crosshair wins.
      const score = anchor.priority * 100 - evalRes.angleDeg - evalRes.distance * 0.02;
      candidates.push({ anchor, evalRes, screenX, screenY, score });
    }

    candidates.sort((a, b) => b.score - a.score);

    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i]!;
      const focused = i === 0;
      const view: GrappleMarkView = {
        id: c.anchor.id,
        label: c.anchor.label,
        position: c.anchor.position.clone(),
        distance: c.evalRes.distance,
        angleDeg: c.evalRes.angleDeg,
        priority: c.anchor.priority,
        focused,
        screenX: c.screenX,
        screenY: c.screenY,
      };
      this.activeViews.push(view);
      if (focused) this.focusedView = view;

      if (c.anchor.domEl) {
        c.anchor.domEl.style.display = 'flex';
        c.anchor.domEl.style.left = `${(c.screenX * 100).toFixed(2)}%`;
        c.anchor.domEl.style.top = `${(c.screenY * 100).toFixed(2)}%`;
        c.anchor.domEl.style.opacity = focused ? '1' : '0.68';
        c.anchor.domEl.style.transform = focused
          ? 'translate(-50%, -50%) scale(1.08)'
          : 'translate(-50%, -50%) scale(0.86)';
        if (c.anchor.domLabelEl) {
          c.anchor.domLabelEl.textContent = focused ? c.anchor.label : '';
        }
        if (c.anchor.domDistEl) {
          c.anchor.domDistEl.textContent = `${Math.round(c.evalRes.distance)}m`;
        }
      }
    }
  }

  /** Restores all anchors to their initial enabled state & positions and hides active reticle state. */
  reset(): void {
    this.clock = 0;
    this.activeViews.length = 0;
    this.focusedView = null;
    for (const anchor of this.anchors.values()) {
      anchor.enabled = anchor.initialEnabled;
      if (!anchor.positionProvider) {
        anchor.position.copy(anchor.initialPosition);
      }
      if (anchor.visuals) {
        anchor.visuals.root.position.copy(anchor.position);
        anchor.visuals.root.visible = anchor.enabled;
      }
      if (anchor.domEl) {
        anchor.domEl.style.display = 'none';
      }
    }
  }

  /** Cleans up all 3D beacons, geometries, materials, and DOM overlay elements. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.activeViews.length = 0;
    this.focusedView = null;
    for (const anchor of this.anchors.values()) {
      this.disposeAnchorVisuals(anchor);
      anchor.domEl?.remove();
      anchor.domEl = null;
      anchor.domLabelEl = null;
      anchor.domDistEl = null;
    }
    this.anchors.clear();
    this.overlayRoot?.remove();
    this.overlayRoot = null;
  }

  // -------------------------------------------------------------------------------------------
  // Internal 3D & DOM helpers
  // -------------------------------------------------------------------------------------------

  private buildAnchorVisuals(pos: THREE.Vector3, radius: number, enabled: boolean): AnchorVisuals | null {
    const scene = this.ctx.render?.scene;
    if (!scene) return null;

    const root = new THREE.Group();
    root.position.copy(pos);
    root.visible = enabled;

    const ringGeo = new THREE.TorusGeometry(radius, 0.09, 8, 24);
    const diamondGeo = new THREE.OctahedronGeometry(radius * 0.34, 0);
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0xff6a1a,
      emissive: 0xff5a00,
      emissiveIntensity: 1.5,
      roughness: 0.35,
      metalness: 0.65,
    });
    const diamondMat = new THREE.MeshStandardMaterial({
      color: 0xffc857,
      emissive: 0xff8c1a,
      emissiveIntensity: 1.8,
      roughness: 0.2,
      metalness: 0.4,
    });

    const ring = new THREE.Mesh(ringGeo, ringMat);
    const diamond = new THREE.Mesh(diamondGeo, diamondMat);
    root.add(ring, diamond);
    scene.add(root);

    return {
      root,
      ring,
      diamond,
      geometries: [ringGeo, diamondGeo],
      materials: [ringMat, diamondMat],
    };
  }

  private disposeAnchorVisuals(anchor: GrappleAnchorInternal): void {
    const v = anchor.visuals;
    if (!v) return;
    this.ctx.render?.scene?.remove?.(v.root);
    for (const g of v.geometries) g.dispose();
    for (const m of v.materials) m.dispose();
    anchor.visuals = null;
  }

  private ensureOverlayRoot(): HTMLDivElement | null {
    if (this.overlayRoot) return this.overlayRoot;
    if (typeof document === 'undefined' || !document.body) return null;
    const host = this.mount ?? document.querySelector<HTMLElement>('.hud') ?? document.body;
    const root = document.createElement('div');
    root.className = 'dp-grapple-overlay';
    root.style.position = 'fixed';
    root.style.inset = '0';
    root.style.pointerEvents = 'none';
    root.style.zIndex = '22';
    root.style.overflow = 'hidden';
    host.appendChild(root);
    this.overlayRoot = root;
    return root;
  }

  private ensureDomElement(anchor: GrappleAnchorInternal): void {
    const root = this.ensureOverlayRoot();
    if (!root) return;

    const el = document.createElement('div');
    el.className = 'dp-grapple-mark';
    el.style.position = 'absolute';
    el.style.display = 'none';
    el.style.flexDirection = 'column';
    el.style.alignItems = 'center';
    el.style.gap = '4px';
    el.style.fontFamily = 'monospace, sans-serif';
    el.style.userSelect = 'none';

    const diamond = document.createElement('div');
    diamond.style.width = '18px';
    diamond.style.height = '18px';
    diamond.style.border = '2px solid #ff7b24';
    diamond.style.boxShadow = '0 0 10px rgba(255, 123, 36, 0.85)';
    diamond.style.transform = 'rotate(45deg)';
    diamond.style.background = 'rgba(255, 123, 36, 0.16)';

    const labelEl = document.createElement('span');
    labelEl.style.color = '#ffd27d';
    labelEl.style.fontSize = '11px';
    labelEl.style.fontWeight = '700';
    labelEl.style.letterSpacing = '0.08em';
    labelEl.style.textShadow = '0 1px 4px rgba(0, 0, 0, 0.9)';
    labelEl.style.marginTop = '4px';
    labelEl.textContent = anchor.label;

    const distEl = document.createElement('span');
    distEl.style.color = '#ff9d4d';
    distEl.style.fontSize = '10px';
    distEl.style.textShadow = '0 1px 3px rgba(0, 0, 0, 0.9)';

    el.append(diamond, labelEl, distEl);
    root.appendChild(el);
    anchor.domEl = el;
    anchor.domLabelEl = labelEl;
    anchor.domDistEl = distEl;
  }
}
