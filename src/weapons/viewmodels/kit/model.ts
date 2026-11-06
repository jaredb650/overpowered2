/**
 * Runtime side of a built weapon: a scene graph of parts, named sockets for hands and effects, emissive
 * materials the rig can drive, and canvas readouts.
 */
import * as THREE from 'three';
import { layerGeometry, type Layer, type Mesher, type PartNode, type V3 } from './mesher';
import type { VmMaterials } from './materials';
import { bakeAo } from './ao';

const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();

export interface ScreenHandle {
  canvas: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  material: THREE.MeshBasicMaterial;
}

export interface BuildOpts {
  /** Colour and HDR intensity per glow layer. Unlisted layers default to white. */
  glows?: Record<string, readonly [number, number]>;
  /** Pixel size per screen layer. */
  screens?: Record<string, readonly [number, number]>;
}

function decalGeometry(l: Layer): THREE.BufferGeometry {
  const g = layerGeometry(l, true);
  const alb = g.getAttribute('aAlb') as THREE.BufferAttribute;
  const color = new Float32Array(l.count * 3);
  for (let i = 0; i < l.count; i++) {
    color[i * 3] = Math.pow(alb.getX(i), 2.2);
    color[i * 3 + 1] = Math.pow(alb.getY(i), 2.2);
    color[i * 3 + 2] = Math.pow(alb.getZ(i), 2.2);
  }
  g.setAttribute('color', new THREE.BufferAttribute(color, 3));
  return g;
}

export class Model {
  readonly root = new THREE.Group();
  readonly parts: Record<string, THREE.Group> = {};
  readonly sockets: Record<string, THREE.Object3D> = {};
  readonly glows: Record<string, THREE.MeshBasicMaterial> = {};
  readonly screens: Record<string, ScreenHandle> = {};
  triangles = 0;
  draws = 0;
  private readonly rest: { node: THREE.Object3D; p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 }[] = [];

  constructor(m: Mesher, mats: VmMaterials, o: BuildOpts = {}) {
    bakeAo(m.tree);
    this.addPart(m.tree, this.root, mats, o);
  }

  private addPart(node: PartNode, group: THREE.Group, mats: VmMaterials, o: BuildOpts): void {
    group.name = node.name;
    for (const [name, layer] of node.layers) {
      if (layer.count === 0) continue;
      let mesh: THREE.Mesh;
      if (name === 'hard') {
        mesh = new THREE.Mesh(layerGeometry(layer, false), mats.hard);
      } else if (name === 'glass') {
        mesh = new THREE.Mesh(layerGeometry(layer, false), mats.glass);
        mesh.renderOrder = 2;
      } else if (name === 'decal') {
        mesh = new THREE.Mesh(decalGeometry(layer), mats.decal);
        mesh.renderOrder = 1;
      } else if (name.startsWith('glow:')) {
        const key = name.slice(5);
        const spec = o.glows?.[key] ?? [0xffffff, 1];
        const mat = (this.glows[key] ??= mats.glow(spec[0], spec[1]));
        mesh = new THREE.Mesh(layerGeometry(layer, false), mat);
      } else {
        const key = name.slice(7);
        const px = o.screens?.[key] ?? [128, 64];
        const screen = (this.screens[key] ??= makeScreen(px[0], px[1]));
        mesh = new THREE.Mesh(layerGeometry(layer, true), screen.material);
      }
      mesh.frustumCulled = false;
      this.triangles += (mesh.geometry.index?.count ?? 0) / 3;
      this.draws++;
      group.add(mesh);
    }
    for (const child of node.children) {
      const g = new THREE.Group();
      g.position.copy(child.pivot);
      group.add(g);
      this.parts[child.name] = g;
      this.rest.push({ node: g, p: g.position.clone(), q: g.quaternion.clone(), s: g.scale.clone() });
      this.addPart(child, g, mats, o);
    }
  }

  /** Adds a transform the rig can read, parented to a part when `part` is given. Rotation is Euler XYZ. */
  socket(name: string, pos: V3, rot: V3 = [0, 0, 0], part?: string): THREE.Object3D {
    const s = new THREE.Object3D();
    s.name = name;
    s.position.set(pos[0], pos[1], pos[2]);
    s.rotation.set(rot[0], rot[1], rot[2]);
    (part ? this.parts[part]! : this.root).add(s);
    this.sockets[name] = s;
    return s;
  }

  /**
   * Socket for a hand, authored by contact instead of by wrist. `contact` is where the middle of the palm presses
   * on the gun. `side` is the direction of the hand's +X (toward the pinky on a right hand, the thumb on a left).
   * `fingers` is the direction the fingers leave the palm.
   */
  hand(name: string, contact: V3, side: V3, fingers: V3, part?: string): THREE.Object3D {
    const z = _z.set(-fingers[0], -fingers[1], -fingers[2]).normalize();
    const x = _x.set(side[0], side[1], side[2]);
    x.addScaledVector(z, -x.dot(z)).normalize();
    const y = _y.crossVectors(z, x);
    _m.makeBasis(x, y, z);
    const s = new THREE.Object3D();
    s.name = name;
    s.quaternion.setFromRotationMatrix(_m);
    s.position.set(contact[0], contact[1], contact[2]);
    // Palm centre in hand space: the wrist sits behind and above it.
    s.position.sub(_v.set(0, -0.027, -0.062).applyQuaternion(s.quaternion));
    (part ? this.parts[part]! : this.root).add(s);
    this.sockets[name] = s;
    return s;
  }

  /** Back to the rest pose. Animation clips then write offsets on top. */
  resetParts(): void {
    for (const r of this.rest) {
      r.node.position.copy(r.p);
      r.node.quaternion.copy(r.q);
      r.node.scale.copy(r.s);
      r.node.visible = true;
    }
  }
}

function makeScreen(w: number, h: number): ScreenHandle {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  const material = new THREE.MeshBasicMaterial({ map: texture });
  material.color.multiplyScalar(2.2);
  return { canvas, g, texture, material };
}
