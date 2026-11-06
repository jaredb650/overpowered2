/**
 * Hero munitions with an impact callback: the airstrike finale and the nuke. combat.spawnProjectile carries the rank
 * and file, but it cannot say when it landed, and these two are timed to the frame of the flash.
 */
import * as THREE from 'three';
import { CG, type Ctx, type EmitterHandle } from '../../core/contracts';
import { ModelBuilder, type ModelMaterials } from '../modelkit';

export type MissileKind = 'finale' | 'nuke';

interface Shot {
  kind: MissileKind;
  group: THREE.Group;
  velocity: THREE.Vector3;
  trail: EmitterHandle | null;
  onImpact: (point: THREE.Vector3, normal: THREE.Vector3) => void;
  live: boolean;
}

const _dir = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _nose = new THREE.Vector3(0, -1, 0);

function missileModel(materials: ModelMaterials, length: number, radius: number, band: string): THREE.Group {
  const b = new ModelBuilder();
  const bodyH = length * 0.72;
  b.cyl(radius, radius, bodyH, 10, '#d7dde4', { at: [0, 0, 0] });
  // The nose points down the model's -Y, so a falling missile needs no rotation at launch.
  b.solid(new THREE.ConeGeometry(radius, length * 0.28, 10), '#1c2128', { at: [0, -bodyH / 2 - length * 0.14, 0], rot: [Math.PI, 0, 0] });
  b.cyl(radius * 1.03, radius * 1.03, length * 0.05, 10, band, { at: [0, -bodyH * 0.22, 0] });
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    b.box(radius * 1.9, length * 0.2, radius * 0.14, '#39424c', {
      at: [Math.cos(a) * radius * 1.25, bodyH * 0.42, Math.sin(a) * radius * 1.25], rot: [0, -a, 0],
    });
  }
  b.glow(new THREE.CylinderGeometry(radius * 0.7, radius * 0.3, length * 0.1, 8), '#ffb060', 6, { at: [0, bodyH / 2 + length * 0.05, 0] });
  return materials.group(b);
}

export class Ordnance {
  private readonly shots: Shot[] = [];

  constructor(private readonly ctx: Ctx, materials: ModelMaterials) {
    const make = (kind: MissileKind, length: number, radius: number, band: string) => {
      const group = missileModel(materials, length, radius, band);
      group.visible = false;
      ctx.render.scene.add(group);
      this.shots.push({ kind, group, velocity: new THREE.Vector3(), trail: null, onImpact: () => undefined, live: false });
    };
    // Two finales can overlap once a cooldown is skipped by debug grants.
    make('finale', 5, 0.34, '#ff6600');
    make('finale', 5, 0.34, '#ff6600');
    make('nuke', 11, 0.62, '#ffd400');
  }

  /** `speed` world units per second, straight along `from -> target`. */
  launch(kind: MissileKind, from: THREE.Vector3, velocity: THREE.Vector3, onImpact: Shot['onImpact']): void {
    const shot = this.shots.find(s => s.kind === kind && !s.live) ?? this.shots.find(s => s.kind === kind)!;
    shot.trail?.stop();
    shot.live = true;
    shot.onImpact = onImpact;
    shot.velocity.copy(velocity);
    shot.group.position.copy(from);
    shot.group.quaternion.setFromUnitVectors(_nose, _dir.copy(velocity).normalize());
    shot.group.visible = true;
    shot.trail = this.ctx.fx.attachEmitter(shot.group, kind === 'nuke' ? 'fireTrail' : 'rocketTrail', _up.clone().multiplyScalar(3));
  }

  update(dt: number): void {
    if (dt <= 0) return;
    for (const shot of this.shots) {
      if (!shot.live) continue;
      const pos = shot.group.position;
      const speed = shot.velocity.length();
      _dir.copy(shot.velocity).divideScalar(speed);
      const step = speed * dt;
      const hit = this.ctx.physics.raycast(pos, _dir, step + 0.5, CG.World);
      if (hit) {
        shot.live = false;
        shot.group.visible = false;
        shot.trail?.stop();
        shot.trail = null;
        shot.onImpact(hit.point, hit.normal);
        continue;
      }
      pos.addScaledVector(_dir, step);
    }
  }

  clear(): void {
    for (const shot of this.shots) {
      shot.live = false;
      shot.group.visible = false;
      shot.trail?.stop();
      shot.trail = null;
    }
  }
}
