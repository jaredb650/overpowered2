/**
 * The Packmule's cabin for the menu: the real airframe from `vehicles/utilityModel.ts`, the real M134 on its pintle,
 * and what the menu adds to make it lived in: a radio and instrument panel on the forward bulkhead, two grab straps
 * that swing with the airframe, and the lights. The low sun comes in through the door and flickers as the rotor
 * blades cross it.
 *
 * Its materials are plain three.js. The world's are lit from the map's light volume, which this scene is not in.
 */
import * as THREE from 'three';
import { ModelBuilder } from '../../progression/modelkit';
import { UTILITY_AIRFRAME } from '../../vehicles/utilityModel';
import { M134 } from '../../vehicles/guns';
import { SUN_DIR, SKY } from './outside';

/** The pintle, from the airframe's own mounts. */
const MOUNT = UTILITY_AIRFRAME.mounts.door;
/** The gun parked swung forward along the fuselage, the way a door gun is stowed: its barrel cluster reads from behind. Level, so its pintle stands straight on the pedestal. */
const GUN_YAW = -2.75;
const GUN_PITCH = 0;
/** Blade passes a second as the shadow is seen. The real rate strobes at a menu's frame rate, so this is the rate a camera shutter would show. */
const FLICKER_HZ = 5.3;
const SUN_LUX = 5.5;

/** The door opening in the aircraft's frame, as the sun sees it: the plane it lies in, and its edges. */
const DOOR = { x: 1.3, back: -1.45, front: 1.75, floor: -1, top: 0.92, soft: 0.05 } as const;

/**
 * There are no shadow maps here, so the cabin would be lit by the low sun straight through its own walls. This gives the
 * sun the door's shape instead: a point inside the cabin is in sunlight only if the line from it toward the sun leaves
 * through the doorway. That puts a patch of sun on the floor and the far wall, and the rest of the cabin in shade, for
 * a few instructions. Chains onto any hook the material already has.
 */
export function sunThroughDoor<T extends THREE.Material>(material: T): T {
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    prev.call(material, shader, renderer);
    shader.uniforms.uSunDir = { value: SUN_DIR };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDoorWorld;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvDoorWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vDoorWorld;
uniform vec3 uSunDir;
float op2Door(vec3 p) {
  if (p.x > ${DOOR.x.toFixed(2)}) return 1.0;
  vec3 h = p + uSunDir * ((${DOOR.x.toFixed(2)} - p.x) / max(uSunDir.x, 1e-3));
  float k = ${DOOR.soft.toFixed(3)};
  float z = smoothstep(${DOOR.back.toFixed(2)} - k, ${DOOR.back.toFixed(2)} + k, h.z) * (1.0 - smoothstep(${DOOR.front.toFixed(2)} - k, ${DOOR.front.toFixed(2)} + k, h.z));
  float y = smoothstep(${DOOR.floor.toFixed(2)} - k, ${DOOR.floor.toFixed(2)} + k, h.y) * (1.0 - smoothstep(${DOOR.top.toFixed(2)} - k, ${DOOR.top.toFixed(2)} + k, h.y));
  return z * y;
}`)
      .replace('getDirectionalLightInfo( directionalLight, directLight );', 'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= op2Door(vDoorWorld);');
  };
  material.customProgramCacheKey = () => `${prevKey.call(material)}:door`;
  material.needsUpdate = true;
  return material;
}

const STRAP_TOPS: readonly [number, number, number][] = [[0.82, 0.86, -0.25], [0.82, 0.86, 0.55]];
const STRAP_LENGTH = 0.46;

interface Strap {
  pivot: THREE.Group;
  /** Angle and rate about X and Z. */
  ax: number; vx: number; az: number; vz: number;
}

export class Cabin {
  readonly root = new THREE.Group();
  readonly sun = new THREE.DirectionalLight(SKY.sun, SUN_LUX);
  private readonly fill: THREE.HemisphereLight;
  /** The red work light in the roof: enough to show the seats and the far wall, so the cabin reads as a cabin. */
  private readonly redLight = new THREE.PointLight(0xff2a18, 2.6, 4.6, 2);
  private readonly panelLight = new THREE.PointLight(0x5cf0c8, 0.35, 2.4, 2);
  private readonly straps: Strap[] = [];
  private readonly owned: { dispose(): void }[] = [];

  constructor() {
    const solid = sunThroughDoor(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, metalness: 0.3, roughness: 0.62 }));
    const gunMat = sunThroughDoor(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, metalness: 0.55, roughness: 0.42 }));
    const glow = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    this.owned.push(solid, gunMat, glow);

    const body = new ModelBuilder();
    UTILITY_AIRFRAME.build(body);
    this.console(body);
    this.fittings(body);
    this.addMerged(body, solid, glow);

    const gun = new ModelBuilder();
    M134.build(gun);
    M134.moving(gun);
    // The ammunition can the feed chute runs down to, on an arm off the pintle. In the game the chute ends in the cabin
    // out of sight; parked out here its links would hang in the air with nothing at the end.
    gun.box(0.24, 0.22, 0.3, '#2b3238', { at: [-0.44, -0.56, 0.16] });
    gun.box(0.25, 0.006, 0.31, '#d9a21a', { at: [-0.44, -0.448, 0.16] });
    gun.box(0.34, 0.04, 0.05, '#1e2328', { at: [-0.2, -0.6, 0.06] });
    const gunGroup = new THREE.Group();
    this.addMerged(gun, gunMat, glow, gunGroup);
    gunGroup.position.set(MOUNT[0], MOUNT[1] + 0.05, MOUNT[2]);
    gunGroup.rotation.order = 'YXZ';
    gunGroup.rotation.set(GUN_PITCH, GUN_YAW, 0);
    this.root.add(gunGroup);

    // Grab straps from the roof rail, each a pivot so it can swing.
    const strapGeo = new THREE.BoxGeometry(0.035, STRAP_LENGTH, 0.008).translate(0, -STRAP_LENGTH / 2, 0);
    const loopGeo = new THREE.TorusGeometry(0.045, 0.008, 4, 10).translate(0, -STRAP_LENGTH - 0.04, 0);
    const strapMat = sunThroughDoor(new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.9 }));
    this.owned.push(strapGeo, loopGeo, strapMat);
    for (const [x, y, z] of STRAP_TOPS) {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, z);
      pivot.add(new THREE.Mesh(strapGeo, strapMat), new THREE.Mesh(loopGeo, strapMat));
      this.root.add(pivot);
      this.straps.push({ pivot, ax: 0, vx: 0, az: 0, vz: 0 });
    }

    // The sun is far off: a directional light, aimed through the door.
    this.sun.position.copy(SUN_DIR).multiplyScalar(10);
    this.sun.target.position.set(0, 0, 0);
    this.fill = new THREE.HemisphereLight(SKY.high.clone().multiplyScalar(9), new THREE.Color(0.03, 0.035, 0.05), 0.75);
    this.redLight.position.set(-0.6, 0.8, 0.2);
    this.panelLight.position.set(-0.2, 0.15, 2.2);
    this.root.add(this.sun, this.sun.target, this.fill, this.redLight, this.panelLight);
  }

  private addMerged(b: ModelBuilder, solid: THREE.Material, glow: THREE.Material, parent: THREE.Object3D = this.root): void {
    const s = b.solidGeometry();
    const g = b.glowGeometry();
    if (s) {
      parent.add(new THREE.Mesh(s, solid));
      this.owned.push(s);
    }
    if (g) {
      parent.add(new THREE.Mesh(g, glow));
      this.owned.push(g);
    }
  }

  /** Radio stack and a strip of small instruments on the forward bulkhead, inside face at z 2.45. */
  private console(b: ModelBuilder): void {
    const z = 2.42;
    // A lining over the bulkhead: its face and the nose's end cap share a plane, and they fight where both are seen.
    b.box(2.5, 1.96, 0.03, '#23292e', { at: [0, 0, 2.475] });
    b.box(1.1, 0.5, 0.08, '#1b2024', { at: [-0.25, 0.25, z] });
    b.box(0.5, 0.36, 0.1, '#15191c', { at: [-0.85, -0.35, z] });
    // Dim dials with a dark bezel, the way a cabin's instruments read at dusk: a faint face, a brighter needle.
    const faces: readonly [number, number, string][] = [
      [-0.62, 0.36, '#3fbf98'], [-0.44, 0.36, '#3fbf98'], [-0.26, 0.36, '#c98a3a'], [-0.08, 0.36, '#3fbf98'], [0.1, 0.36, '#5aa8c8'],
      [-0.55, 0.16, '#3fbf98'], [-0.33, 0.16, '#3fbf98'], [-0.11, 0.16, '#5aa8c8'],
    ];
    faces.forEach(([x, y, c], i) => {
      b.cyl(0.042, 0.042, 0.03, 12, '#0b0e10', { at: [x, y, z - 0.04], rot: [Math.PI / 2, 0, 0] });
      b.glow(new THREE.CircleGeometry(0.03, 12), c, 0.32, { at: [x, y, z - 0.056], rot: [0, Math.PI, 0] });
      b.glow(new THREE.PlaneGeometry(0.004, 0.026), c, 1.6, { at: [x, y + 0.008, z - 0.058], rot: [0, Math.PI, 0.6 + i * 1.3] });
    });
    b.glow(new THREE.PlaneGeometry(0.22, 0.04), '#3fbf98', 0.55, { at: [-0.25, 0.02, z - 0.045], rot: [0, Math.PI, 0] });
    for (let i = 0; i < 5; i++) b.glow(new THREE.PlaneGeometry(0.012, 0.012), i === 2 ? '#ff4a30' : '#ffb04a', 1.8, { at: [-0.98 + i * 0.05, -0.24, z - 0.055], rot: [0, Math.PI, 0] });
  }

  /**
   * What makes the doorway an aircraft's: a black rubber seal down the forward post, a yellow grab handle on its inside
   * face, a row of rivets, hazard striping along the sill, and a pedestal under the door gun's pintle so the gun stands
   * on the sill and does not hang in the air.
   */
  private fittings(b: ModelBuilder): void {
    const post = 1.75;
    b.box(0.13, 1.94, 0.025, '#0d0f11', { at: [1.33, 0, post - 0.01] });
    // The handle: a bar standing off the post on two feet.
    b.cyl(0.016, 0.016, 0.62, 8, '#d9a21a', { at: [1.18, 0.12, post - 0.07] });
    for (const y of [-0.17, 0.41]) b.box(0.03, 0.03, 0.07, '#111417', { at: [1.18, y, post - 0.035] });
    for (let i = 0; i < 9; i++) b.cyl(0.008, 0.008, 0.012, 6, '#5b666c', { at: [1.25, -0.85 + i * 0.21, post - 0.007], rot: [Math.PI / 2, 0, 0] });
    // Hazard stripes on the sill's top face, along the door.
    const back = -1.45;
    const length = post - back;
    b.box(0.07, 0.006, length, '#121416', { at: [1.31, -0.937, (post + back) / 2] });
    for (let z = back + 0.06; z < post - 0.05; z += 0.16) b.box(0.065, 0.008, 0.07, '#d9a21a', { at: [1.31, -0.935, z], rot: [0, 0.6, 0] });
    // The pedestal: straight down from the pintle to a foot bolted over the sill edge.
    const [mx, , mz] = MOUNT;
    b.cyl(0.055, 0.065, 0.5, 10, '#1e2328', { at: [mx, -0.69, mz] });
    b.box(0.26, 0.05, 0.22, '#1e2328', { at: [mx - 0.08, -0.915, mz] });
    b.box(0.04, 0.16, 0.2, '#1e2328', { at: [mx + 0.03, -1.01, mz] });
  }

  /**
   * `t` in seconds. `sway` is the airframe's roll and pitch, which the straps answer as pendulums. `still` holds the
   * light steady and the straps hanging.
   */
  update(t: number, dt: number, sway: THREE.Vector2, still: boolean): void {
    // Rotor shadow: a soft dip in the sunlight as each blade crosses the sun.
    const phase = (t * FLICKER_HZ) % 1;
    const blade = still ? 0 : Math.exp(-((phase - 0.5) ** 2) / 0.012);
    this.sun.intensity = SUN_LUX * (1 - 0.42 * blade);
    // Instruments breathe a little, as a dimmer and a supply would.
    this.panelLight.intensity = 0.32 + (still ? 0 : Math.sin(t * 0.7) * 0.03);
    for (const s of this.straps) {
      if (still) {
        s.pivot.rotation.set(0.04, 0, -0.03);
        continue;
      }
      // A damped pendulum driven by the airframe: when it rolls, the strap lags behind.
      const k = 22, c = 1.6;
      s.vx += (-k * (s.ax + sway.y * 1.6) - c * s.vx) * dt;
      s.vz += (-k * (s.az - sway.x * 1.6) - c * s.vz) * dt;
      s.ax += s.vx * dt;
      s.az += s.vz * dt;
      s.pivot.rotation.set(s.ax, 0, s.az);
    }
  }

  dispose(): void {
    for (const o of this.owned) o.dispose();
    this.sun.dispose();
    this.fill.dispose();
    this.redLight.dispose();
    this.panelLight.dispose();
  }
}

