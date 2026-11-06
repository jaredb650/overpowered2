/**
 * Where a hit landed, in anatomy. The hit capsules stay as they are: a capsule says which bone, and the ray's path through it
 * in bone space says what was inside. That is why organs and arteries need no geometry of their own.
 *
 * Everything is measured from the path of the round, not just where it went in, so a heart can be hit from the back and an
 * artery from either side. Numbers are metres on a body 1.85 m tall, in bone axes: +X is his left, +Z his front.
 */
import * as THREE from 'three';
import { HumanoidBone as B, type GoreRegion } from '../../characters/rig';
import type { ZoneId } from './rules';

/** Inside the chest bone, a little left of centre. */
const HEART = new THREE.Vector3(0.035, 0.115, 0.05);
const HEART_RADIUS = 0.062;
/** The spinal column runs up the back of the chest and spine bones, along Y. */
const SPINE_Z = -0.1;
const SPINE_RADIUS = 0.05;
/** The femoral artery runs down the inside front of the thigh, and is out of reach of a round past the middle of it. */
const FEMORAL_X = 0.038;
const FEMORAL_Z = 0.03;
const FEMORAL_RADIUS = 0.03;
const FEMORAL_END = -0.3;
/** Height on the hips bone under which a hit is in the pelvis rather than the belly. */
const PELVIS_TOP = 0.045;
/** Up the upper arm from here is the shoulder. */
const SHOULDER_END = -0.1;
/** Centre of the head's capsule axis. */
const SKULL_BASE = 0.04;
const SKULL_TOP = 0.14;
const SKULL_Z = 0.015;
/** Cosine between the round and the skull's surface under which it glances: about the outer fifth of what he shows you. */
const GLANCE_COS = 0.42;
/** Dot of the round's path with his front under which it counts as from behind. */
const BEHIND = 0.35;

export interface ZoneHit {
  zone: ZoneId;
  /** 1 for his left, -1 for his right, 0 on his midline. */
  side: 1 | -1 | 0;
  /** It came in through his back. */
  behind: boolean;
  /** It skidded off the skull. */
  glancing: boolean;
}

const _p = new THREE.Vector3();
const _d = new THREE.Vector3();
const _inverse = new THREE.Matrix4();

/** How close the ray gets to a point, ahead of it. */
function rayMiss(p: THREE.Vector3, d: THREE.Vector3, x: number, y: number, z: number): number {
  const vx = x - p.x, vy = y - p.y, vz = z - p.z;
  const t = Math.max(0, vx * d.x + vy * d.y + vz * d.z);
  return Math.hypot(vx - d.x * t, vy - d.y * t, vz - d.z * t);
}

/** The same for a line running along Y at (x, z), so a round at any height is tested. Returns the height it passes at through `at`. */
function tubeMiss(p: THREE.Vector3, d: THREE.Vector3, x: number, z: number, at: { y: number }): number {
  const flat = d.x * d.x + d.z * d.z;
  // Straight down the bone, it passes the tube where it entered.
  const t = flat < 1e-6 ? 0 : Math.max(0, ((x - p.x) * d.x + (z - p.z) * d.z) / flat);
  at.y = p.y + d.y * t;
  return Math.hypot(x - p.x - d.x * t, z - p.z - d.z * t);
}

const _height = { y: 0 };

function trunk(fromBack: boolean, p: THREE.Vector3, d: THREE.Vector3, out: ZoneHit, otherwise: ZoneId): ZoneHit {
  out.zone = fromBack && tubeMiss(p, d, 0, SPINE_Z, _height) < SPINE_RADIUS ? 'spine' : otherwise;
  return out;
}

function skull(p: THREE.Vector3, d: THREE.Vector3, out: ZoneHit): ZoneHit {
  const y = Math.min(SKULL_TOP, Math.max(SKULL_BASE, p.y));
  const nx = p.x, ny = p.y - y, nz = p.z - SKULL_Z;
  const n = Math.hypot(nx, ny, nz) || 1;
  out.zone = 'head';
  out.glancing = -(d.x * nx + d.y * ny + d.z * nz) / n < GLANCE_COS;
  return out;
}

/** `p` and `d` are the entry point and the direction of the round in bone axes, scaled to a 1.85 m body. */
export function zoneOf(bone: number, p: THREE.Vector3, d: THREE.Vector3, out: ZoneHit): ZoneHit {
  const behind = d.z > BEHIND;
  out.behind = behind;
  out.glancing = false;
  out.side = 0;
  switch (bone) {
    case B.head:
      return skull(p, d, out);
    case B.neck:
      out.zone = behind && Math.abs(p.x) < SPINE_RADIUS ? 'spine' : 'carotid';
      return out;
    case B.chest:
      out.zone = 'lung';
      out.side = p.x >= 0 ? 1 : -1;
      if (rayMiss(p, d, HEART.x, HEART.y, HEART.z) < HEART_RADIUS) {
        out.zone = 'heart';
        return out;
      }
      return trunk(behind, p, d, out, 'lung');
    case B.spine:
      return trunk(behind, p, d, out, 'gut');
    case B.hips:
      return trunk(behind, p, d, out, p.y < PELVIS_TOP ? 'pelvis' : 'gut');
    case B.upperArmL:
    case B.upperArmR:
      out.zone = p.y > SHOULDER_END ? 'shoulder' : 'arm';
      out.side = bone === B.upperArmL ? 1 : -1;
      return out;
    case B.foreArmL:
    case B.foreArmR:
      out.zone = 'arm';
      out.side = bone === B.foreArmL ? 1 : -1;
      return out;
    case B.handL:
    case B.handR:
      out.zone = 'hand';
      out.side = bone === B.handL ? 1 : -1;
      return out;
    case B.thighL:
    case B.thighR: {
      const side = bone === B.thighL ? 1 : -1;
      out.side = side;
      const near = tubeMiss(p, d, -side * FEMORAL_X, FEMORAL_Z, _height) < FEMORAL_RADIUS && _height.y > FEMORAL_END;
      out.zone = near ? 'innerThigh' : 'thigh';
      return out;
    }
    default:
      out.zone = 'thigh';
      out.side = bone === B.shinL || bone === B.footL ? 1 : -1;
      return out;
  }
}

/** For a hit with no bone: a stray test, or a rig with no capsules. Region is all there is to go on. */
export function zoneOfRegion(region: GoreRegion, out: ZoneHit): ZoneHit {
  out.behind = out.glancing = false;
  out.side = region.endsWith('L') ? 1 : region.endsWith('R') ? -1 : 0;
  if (region === 'head') out.zone = 'head';
  else if (region === 'chest') out.zone = 'lung';
  else if (region === 'abdomen') out.zone = 'gut';
  else if (region.startsWith('arm') || region.startsWith('forearm')) out.zone = 'arm';
  else out.zone = 'thigh';
  return out;
}

/** Writes the zone of a hit on a live skeleton. `scale` is the body's height over 1.85 m. */
export function resolveZone(
  boneObject: THREE.Object3D | undefined, bone: number | undefined, region: GoreRegion, point: THREE.Vector3, dir: THREE.Vector3, scale: number, out: ZoneHit,
): ZoneHit {
  if (bone === undefined || !boneObject) return zoneOfRegion(region, out);
  _inverse.copy(boneObject.matrixWorld).invert();
  _p.copy(point).applyMatrix4(_inverse).multiplyScalar(1 / scale);
  _d.copy(dir).transformDirection(_inverse);
  return zoneOf(bone, _p, _d, out);
}
