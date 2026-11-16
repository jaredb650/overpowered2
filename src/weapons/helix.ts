import * as THREE from 'three';
import { smoothstep } from '../core/math';

export interface HelixSpec {
  phase: number;
  reach: number;
  radius: number;
  pitch: number;
  startRadius: number;
  convergence: number;
}

export function helixOffset(out: THREE.Vector3, right: THREE.Vector3, up: THREE.Vector3, spec: HelixSpec, travel: number): THREE.Vector3 {
  const close = smoothstep(0, Math.min(spec.convergence, spec.reach), Math.max(0, spec.reach - travel));
  const radius = (spec.startRadius + (spec.radius - spec.startRadius) * smoothstep(0, 4, travel)) * close;
  const phase = spec.phase + travel * Math.PI * 2 / spec.pitch;
  return out.copy(right).multiplyScalar(Math.cos(phase) * radius).addScaledVector(up, Math.sin(phase) * radius);
}
