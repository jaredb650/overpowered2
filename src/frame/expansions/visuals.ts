/**
 * Sculpted translucent wireframe/hex-icosahedron 3D visuals for Core Expansions:
 * - Expanding orange-white Breacher Nova geodesic shock sphere + equatorial pressure ring (`novaProgress` 1 -> 0),
 * - Mobile cyan Aegis / blazing crimson Last-Stand Fuse geodesic energy barrier around the mech (`aegisAlpha`, `terminalActive`),
 * - World-space stationary 11 m hexagonal Bunker Dome with glowing emitter base ring & ground projector beacon (`domePos`, `domeAlpha`).
 */
import * as THREE from 'three';
import { clamp } from '../../core/math';
import type { FramePalette } from '../models/palette';
import type { ExpansionVisualState } from './types';

const DOME_RADIUS = 11;
const NOVA_OUTER_HEX = 0xff8830;
const NOVA_CORE_HEX = 0xfff0cc;
const AEGIS_CYAN_HEX = 0x38e8ff;
const TERMINAL_CRIMSON_HEX = 0xff2238;
const DOME_CYAN_HEX = 0x38d8ff;

/** Builds a faceted geodesic dome geometry of exact `radius` from an icosahedron clipped flat at `y = 0`. */
function createGeodesicDomeGeometry(radius: number, detail: number): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(radius, detail);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < 0) {
      // Project lower hemisphere vertices radially onto the ground perimeter ring at y = 0.
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const r = Math.hypot(x, z);
      if (r > 1e-4) {
        const s = radius / r;
        pos.setXYZ(i, x * s, 0, z * s);
      } else {
        pos.setY(i, 0);
      }
    }
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

export class ExpansionVisuals {
  readonly root = new THREE.Group();
  readonly domeGroup = new THREE.Group();

  private readonly novaGroup = new THREE.Group();
  private readonly novaWireMesh: THREE.Mesh;
  private readonly novaWireMat: THREE.MeshBasicMaterial;
  private readonly novaCoreMesh: THREE.Mesh;
  private readonly novaCoreMat: THREE.MeshBasicMaterial;
  private readonly novaRingMesh: THREE.Mesh;
  private readonly novaRingMat: THREE.MeshBasicMaterial;

  private readonly aegisGroup = new THREE.Group();
  private readonly aegisWireMesh: THREE.Mesh;
  private readonly aegisWireMat: THREE.MeshBasicMaterial;
  private readonly aegisShellMesh: THREE.Mesh;
  private readonly aegisShellMat: THREE.MeshBasicMaterial;
  private readonly aegisBandMesh: THREE.Mesh;
  private readonly aegisBandMat: THREE.MeshBasicMaterial;

  private readonly domeWireMesh: THREE.Mesh;
  private readonly domeWireMat: THREE.MeshBasicMaterial;
  private readonly domeShellMesh: THREE.Mesh;
  private readonly domeShellMat: THREE.MeshBasicMaterial;
  private readonly domeBaseRingMat: THREE.MeshBasicMaterial;
  private readonly domeBeaconMat: THREE.MeshBasicMaterial;

  private readonly aegisBaseColor = new THREE.Color(AEGIS_CYAN_HEX);
  private readonly domeBaseColor = new THREE.Color(DOME_CYAN_HEX);
  private clock = 0;

  constructor(scene: THREE.Scene) {
    const ico = new THREE.IcosahedronGeometry(1, 2);

    // ---- 1. Expanding Orange-White Breacher Nova Shock Sphere ----
    this.novaWireMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(NOVA_OUTER_HEX).multiplyScalar(3.2),
      wireframe: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.novaWireMesh = new THREE.Mesh(ico, this.novaWireMat);

    this.novaCoreMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(NOVA_CORE_HEX).multiplyScalar(2.4),
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.novaCoreMesh = new THREE.Mesh(ico, this.novaCoreMat);
    this.novaCoreMesh.scale.setScalar(0.92);

    const eqGeo = new THREE.TorusGeometry(1, 0.045, 8, 36);
    eqGeo.rotateX(Math.PI / 2);
    this.novaRingMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(NOVA_CORE_HEX).multiplyScalar(3.6),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.novaRingMesh = new THREE.Mesh(eqGeo, this.novaRingMat);

    this.novaGroup.position.y = 0.8;
    this.novaGroup.add(this.novaWireMesh, this.novaCoreMesh, this.novaRingMesh);
    this.novaGroup.visible = false;
    this.root.add(this.novaGroup);

    // ---- 2. Mobile Cyan Aegis / Crimson Terminal Geodesic Energy Barrier ----
    this.aegisWireMat = new THREE.MeshBasicMaterial({
      color: this.aegisBaseColor.clone().multiplyScalar(2.6),
      wireframe: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.aegisWireMesh = new THREE.Mesh(ico, this.aegisWireMat);

    this.aegisShellMat = new THREE.MeshBasicMaterial({
      color: this.aegisBaseColor.clone().multiplyScalar(1.4),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.aegisShellMesh = new THREE.Mesh(ico, this.aegisShellMat);
    this.aegisShellMesh.scale.setScalar(0.97);

    const bandGeo = new THREE.TorusGeometry(1.03, 0.024, 6, 32);
    bandGeo.rotateX(Math.PI / 2);
    this.aegisBandMat = new THREE.MeshBasicMaterial({
      color: this.aegisBaseColor.clone().multiplyScalar(3.2),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.aegisBandMesh = new THREE.Mesh(bandGeo, this.aegisBandMat);

    this.aegisGroup.scale.set(3.4, 3.85, 3.4);
    this.aegisGroup.position.y = 0.95;
    this.aegisGroup.add(this.aegisWireMesh, this.aegisShellMesh, this.aegisBandMesh);
    this.aegisGroup.visible = false;
    this.root.add(this.aegisGroup);

    // ---- 3. World-Space Stationary 11 m Hexagonal Bunker Dome + Glowing Base Ring ----
    const domeGeo = createGeodesicDomeGeometry(DOME_RADIUS, 2);
    this.domeWireMat = new THREE.MeshBasicMaterial({
      color: this.domeBaseColor.clone().multiplyScalar(2.2),
      wireframe: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.domeWireMesh = new THREE.Mesh(domeGeo, this.domeWireMat);

    this.domeShellMat = new THREE.MeshBasicMaterial({
      color: this.domeBaseColor.clone().multiplyScalar(1.2),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.domeShellMesh = new THREE.Mesh(domeGeo, this.domeShellMat);
    this.domeShellMesh.scale.setScalar(0.992);

    // Glowing 11 m perimeter emitter torus + flat ground halo ring.
    const baseTorusGeo = new THREE.TorusGeometry(DOME_RADIUS, 0.14, 8, 42);
    baseTorusGeo.rotateX(Math.PI / 2);
    this.domeBaseRingMat = new THREE.MeshBasicMaterial({
      color: this.domeBaseColor.clone().multiplyScalar(3.4),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const baseTorus = new THREE.Mesh(baseTorusGeo, this.domeBaseRingMat);
    baseTorus.position.y = 0.12;

    const baseHaloGeo = new THREE.RingGeometry(DOME_RADIUS - 0.55, DOME_RADIUS + 0.18, 42);
    baseHaloGeo.rotateX(-Math.PI / 2);
    const baseHalo = new THREE.Mesh(baseHaloGeo, this.domeBaseRingMat);
    baseHalo.position.y = 0.06;

    // Ground projector emitter beacon disc at center of the dome.
    const beaconGeo = new THREE.CylinderGeometry(0.9, 1.22, 0.26, 8);
    this.domeBeaconMat = new THREE.MeshBasicMaterial({
      color: this.domeBaseColor.clone().multiplyScalar(2.8),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
    });
    const beacon = new THREE.Mesh(beaconGeo, this.domeBeaconMat);
    beacon.position.y = 0.13;

    this.domeGroup.add(this.domeWireMesh, this.domeShellMesh, baseTorus, baseHalo, beacon);
    this.domeGroup.visible = false;

    this.root.name = 'frame.expansion';
    this.domeGroup.name = 'frame.expansion.dome';
    if (scene && typeof scene.add === 'function') {
      scene.add(this.domeGroup);
    }
  }

  setPalette(palette: FramePalette): void {
    // Keep Aegis/Dome strongly legible in cyan-tinted palette hues while Nova stays incandescent orange-white.
    this.aegisBaseColor.set(AEGIS_CYAN_HEX).lerp(new THREE.Color(palette.glow), 0.35);
    this.domeBaseColor.set(DOME_CYAN_HEX).lerp(new THREE.Color(palette.thruster), 0.3);
    this.domeWireMat.color.copy(this.domeBaseColor).multiplyScalar(2.2);
    this.domeShellMat.color.copy(this.domeBaseColor).multiplyScalar(1.2);
    this.domeBaseRingMat.color.copy(this.domeBaseColor).multiplyScalar(3.4);
    this.domeBeaconMat.color.copy(this.domeBaseColor).multiplyScalar(2.8);
  }

  sync(state: ExpansionVisualState | null, dt: number, inside: boolean): void {
    const h = Math.max(0, dt);
    this.clock += h;

    if (!state) {
      this.hide();
      return;
    }

    // ---- Breacher Nova expanding orange-white shock sphere (`novaProgress` animates 1 -> 0) ----
    const np = clamp(state.novaProgress, 0, 1);
    if (np > 0.001) {
      const expand = 1 - np;
      const radius = 2.4 + expand * 14.2;
      this.novaGroup.visible = true;
      this.novaGroup.scale.setScalar(radius);
      this.novaWireMesh.rotation.y += h * 1.4;
      this.novaWireMesh.rotation.x += h * 0.6;
      const fade = np;
      this.novaWireMat.opacity = fade * (inside ? 0.42 : 0.82);
      this.novaCoreMat.opacity = fade * fade * (inside ? 0.14 : 0.34);
      this.novaRingMat.opacity = fade * (inside ? 0.36 : 0.78);
    } else {
      this.novaGroup.visible = false;
    }

    // ---- Mobile Cyan Aegis / Blazing Crimson Last-Stand Barrier ----
    const alpha = clamp(state.aegisAlpha, 0, 1);
    if (alpha > 0.01) {
      this.aegisGroup.visible = true;
      const isTerminal = state.terminalActive === true;
      const pulse = 0.88 + Math.sin(this.clock * (isTerminal ? 14 : 6)) * 0.12;

      if (isTerminal) {
        this.aegisWireMat.color.setHex(TERMINAL_CRIMSON_HEX).multiplyScalar(3.2 * pulse);
        this.aegisShellMat.color.setHex(TERMINAL_CRIMSON_HEX).multiplyScalar(1.6 * pulse);
        this.aegisBandMat.color.setHex(0xff7050).multiplyScalar(3.6 * pulse);
      } else {
        this.aegisWireMat.color.copy(this.aegisBaseColor).multiplyScalar(2.6 * pulse);
        this.aegisShellMat.color.copy(this.aegisBaseColor).multiplyScalar(1.3 * pulse);
        this.aegisBandMat.color.copy(this.aegisBaseColor).multiplyScalar(3.2 * pulse);
      }

      this.aegisWireMesh.rotation.y += h * (isTerminal ? 1.4 : 0.75);
      this.aegisShellMesh.rotation.y -= h * 0.4;
      this.aegisBandMesh.rotation.z = Math.sin(this.clock * 2.2) * 0.32;
      this.aegisBandMesh.rotation.y -= h * 1.6;

      this.aegisWireMat.opacity = alpha * (inside ? 0.18 : 0.56);
      this.aegisShellMat.opacity = alpha * (inside ? 0.06 : 0.18);
      this.aegisBandMat.opacity = alpha * (inside ? 0.2 : 0.64);
    } else {
      this.aegisGroup.visible = false;
    }

    // ---- World-Space Stationary 11 m Hexagonal Bunker Dome ----
    const dAlpha = clamp(state.domeAlpha, 0, 1);
    if (state.domePos && dAlpha > 0.01) {
      this.domeGroup.position.copy(state.domePos);
      this.domeGroup.visible = true;
      this.domeWireMesh.rotation.y += h * 0.22;
      this.domeShellMesh.rotation.y -= h * 0.1;
      const pulse = 0.9 + Math.sin(this.clock * 4.5) * 0.1;
      this.domeWireMat.opacity = dAlpha * 0.44 * pulse;
      this.domeShellMat.opacity = dAlpha * 0.12 * pulse;
      this.domeBaseRingMat.opacity = dAlpha * 0.78 * pulse;
      this.domeBeaconMat.opacity = dAlpha * 0.85;
    } else {
      this.domeGroup.visible = false;
    }
  }

  hide(): void {
    this.novaGroup.visible = false;
    this.aegisGroup.visible = false;
    this.domeGroup.visible = false;
  }
}
