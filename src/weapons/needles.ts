/**
 * Flechettes in a wall (AMMO.flechette in data.ts): a dart that stops in a surface stands out of it a moment, a thin steel needle
 * along the line it flew, then is gone. One InstancedMesh, a ring of `MAX`, oldest out; one past its time is scaled to nothing.
 */
import * as THREE from 'three';
import type { Ctx } from '../core/contracts';

const MAX = 192;
/** Seconds a needle stands in the wall. */
const LIFE = 1.6;
const LENGTH = 0.1;
/** Of the needle, how much is in the wall. */
const BURIED = 0.25;

const AXIS = new THREE.Vector3(0, 1, 0);
const NONE = new THREE.Matrix4().makeScale(0, 0, 0);

export class Needles {
  private mesh: THREE.InstancedMesh | null = null;
  private readonly until = new Float32Array(MAX);
  private next = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();

  constructor(private readonly ctx: Ctx) {}

  /** A dart that stopped at `point` flying along `dir` (a unit vector): the tail stands out of the face, back toward the gun. */
  stick(point: THREE.Vector3, dir: THREE.Vector3): void {
    const mesh = this.mesh ?? this.build();
    const i = this.next;
    this.next = (i + 1) % MAX;
    const length = 0.8 + 0.4 * Math.random();
    this.q.setFromUnitVectors(AXIS, dir);
    this.p.copy(point).addScaledVector(dir, -LENGTH * length * (0.5 - BURIED));
    mesh.setMatrixAt(i, this.m.compose(this.p, this.q, this.s.set(1, length, 1)));
    mesh.instanceMatrix.needsUpdate = true;
    this.until[i] = this.ctx.time.elapsed + LIFE;
  }

  update(): void {
    const mesh = this.mesh;
    if (!mesh) return;
    const now = this.ctx.time.elapsed;
    for (let i = 0; i < MAX; i++) {
      if (this.until[i]! === 0 || now < this.until[i]!) continue;
      this.until[i] = 0;
      mesh.setMatrixAt(i, NONE);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  clear(): void {
    this.until.fill(this.ctx.time.elapsed - 1);
    this.update();
  }

  private build(): THREE.InstancedMesh {
    // Tip (+y) into the wall, the tail out: a tapered steel rod with a dark collar where the fins would be.
    const geo = new THREE.CylinderGeometry(0.0008, 0.003, LENGTH, 5, 2);
    const pos = geo.attributes.position!;
    const colors = new Float32Array(pos.count * 3);
    for (let v = 0; v < pos.count; v++) {
      const tail = pos.getY(v) < -LENGTH * 0.25;
      colors.set(tail ? [0.35, 0.37, 0.4] : [1, 1, 1], v * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.MeshStandardMaterial({ color: 0xdfe6ee, metalness: 0.35, roughness: 0.4, vertexColors: true });
    const mesh = new THREE.InstancedMesh(geo, mat, MAX);
    for (let i = 0; i < MAX; i++) mesh.setMatrixAt(i, NONE);
    // The instances are all over the map; the geometry's own sphere at the origin would cull them.
    mesh.frustumCulled = false;
    mesh.name = 'flechette-needles';
    this.ctx.render.scene.add(mesh);
    this.mesh = mesh;
    return mesh;
  }
}
