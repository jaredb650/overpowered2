/**
 * Getting up off the floor, as keys on a body 1.85 m tall. Hips, spine and the four ends of the limbs are keyed and IK
 * does the rest, so one clip fits every humanoid, with any limb missing.
 *
 * Both clips end standing on the character's root, facing +Z. Face down the head lies toward +Z and the body climbs
 * back over its knees. Face up the feet lie toward +Z and it rocks forward over them. So the character's yaw comes from
 * how the body lies, and nothing has to turn on the way up.
 *
 * Every key keeps the hips above the floor, and a planted hand or foot stays on it. Those two are what stop a body
 * standing up through the ground.
 */
import * as THREE from 'three';

/** `crawl` has no clip: a body with no legs just takes up its crawl from where it lies. */
export type GetUpKind = 'prone' | 'supine' | 'crawl';

type V3 = readonly [number, number, number];

interface Key {
  t: number;
  hips: V3;
  /** Pelvis pitch and roll. Plus pitch tips the top of the body toward +Z. */
  pitch: number;
  roll: number;
  /** Forward bend of the whole spine, and the head's own pitch on top of it. */
  bend: number;
  head: number;
  /** Ankle targets and foot pitch. The lead leg moves first. */
  lead: V3;
  trail: V3;
  leadToe: number;
  trailToe: number;
  /** Wrist targets, and how far each hand is committed to its target rather than hanging free, 0..1. */
  leadHand: V3;
  trailHand: V3;
  leadGrip: number;
  trailGrip: number;
}

const PRONE: readonly Key[] = [
  {
    t: 0, hips: [0, 0.17, -0.34], pitch: 1.45, roll: 0, bend: -0.1, head: -0.5,
    lead: [0.13, 0.12, -1.22], trail: [-0.13, 0.12, -1.22], leadToe: 1.4, trailToe: 1.4,
    leadHand: [0.3, 0.05, 0.1], trailHand: [-0.3, 0.05, 0.05], leadGrip: 1, trailGrip: 1,
  },
  {
    t: 0.24, hips: [0, 0.3, -0.38], pitch: 1.1, roll: 0.05, bend: -0.05, head: -0.7,
    lead: [0.14, 0.1, -0.94], trail: [-0.13, 0.12, -1.16], leadToe: 1.3, trailToe: 1.4,
    leadHand: [0.3, 0.05, 0.1], trailHand: [-0.3, 0.05, 0.05], leadGrip: 1, trailGrip: 1,
  },
  {
    t: 0.46, hips: [0, 0.5, -0.44], pitch: 1.28, roll: 0.03, bend: 0.05, head: -0.65,
    lead: [0.14, 0.1, -0.86], trail: [-0.13, 0.1, -0.86], leadToe: 1.2, trailToe: 1.2,
    leadHand: [0.3, 0.05, 0.08], trailHand: [-0.3, 0.05, 0.05], leadGrip: 1, trailGrip: 1,
  },
  {
    t: 0.66, hips: [0, 0.54, -0.36], pitch: 0.95, roll: -0.04, bend: 0.32, head: -0.5,
    lead: [0.16, 0.07, -0.08], trail: [-0.13, 0.1, -0.8], leadToe: 0, trailToe: 1.2,
    leadHand: [0.2, 0.52, -0.04], trailHand: [-0.3, 0.05, 0.02], leadGrip: 0.9, trailGrip: 0.7,
  },
  {
    t: 0.84, hips: [0, 0.72, -0.12], pitch: 0.5, roll: -0.02, bend: 0.42, head: -0.3,
    lead: [0.15, 0.06, -0.03], trail: [-0.13, 0.08, -0.34], leadToe: 0, trailToe: 0.55,
    leadHand: [0.2, 0.62, 0], trailHand: [-0.3, 0.05, 0], leadGrip: 0.3, trailGrip: 0,
  },
  {
    t: 1, hips: [0, 0.9, 0], pitch: 0.05, roll: 0, bend: 0.12, head: 0,
    lead: [0.13, 0.06, 0], trail: [-0.13, 0.06, 0], leadToe: 0, trailToe: 0,
    leadHand: [0.2, 0.62, 0], trailHand: [-0.3, 0.05, 0], leadGrip: 0, trailGrip: 0,
  },
];

const SUPINE: readonly Key[] = [
  {
    t: 0, hips: [0, 0.15, -0.72], pitch: -1.45, roll: 0, bend: 0.05, head: 0.35,
    lead: [0.14, 0.1, 0.18], trail: [-0.14, 0.1, 0.18], leadToe: -1.1, trailToe: -1.1,
    leadHand: [0.36, 0.06, -0.95], trailHand: [-0.36, 0.06, -0.95], leadGrip: 1, trailGrip: 1,
  },
  {
    t: 0.24, hips: [0, 0.15, -0.68], pitch: -0.78, roll: 0, bend: 0.78, head: 0.2,
    lead: [0.13, 0.07, -0.24], trail: [-0.16, 0.09, 0.02], leadToe: 0, trailToe: -0.5,
    leadHand: [0.34, 0.05, -0.96], trailHand: [-0.34, 0.05, -0.96], leadGrip: 1, trailGrip: 1,
  },
  {
    t: 0.48, hips: [0.05, 0.21, -0.56], pitch: -0.22, roll: -0.22, bend: 0.82, head: 0.1,
    lead: [0.14, 0.06, -0.2], trail: [-0.14, 0.07, -0.14], leadToe: 0, trailToe: 0,
    leadHand: [0.22, 0.56, -0.12], trailHand: [-0.4, 0.05, -0.72], leadGrip: 0.8, trailGrip: 1,
  },
  {
    t: 0.7, hips: [0, 0.43, -0.3], pitch: 0.26, roll: -0.05, bend: 0.74, head: -0.2,
    lead: [0.15, 0.06, -0.08], trail: [-0.15, 0.06, -0.12], leadToe: 0, trailToe: 0,
    leadHand: [0.2, 0.6, -0.04], trailHand: [-0.4, 0.05, -0.5], leadGrip: 0.5, trailGrip: 0.3,
  },
  {
    t: 0.86, hips: [0, 0.68, -0.1], pitch: 0.35, roll: 0, bend: 0.5, head: -0.15,
    lead: [0.14, 0.06, -0.02], trail: [-0.14, 0.06, -0.04], leadToe: 0, trailToe: 0,
    leadHand: [0.2, 0.62, 0], trailHand: [-0.3, 0.05, 0], leadGrip: 0, trailGrip: 0,
  },
  {
    t: 1, hips: [0, 0.9, 0], pitch: 0.05, roll: 0, bend: 0.12, head: 0,
    lead: [0.13, 0.06, 0], trail: [-0.13, 0.06, 0], leadToe: 0, trailToe: 0,
    leadHand: [0.2, 0.62, 0], trailHand: [-0.3, 0.05, 0], leadGrip: 0, trailGrip: 0,
  },
];

/** One moment of a get-up, at 1.85 m. Reused, so a clip allocates nothing while it plays. */
export class GetUpPose {
  readonly hips = new THREE.Vector3();
  pitch = 0;
  roll = 0;
  bend = 0;
  head = 0;
  readonly lead = new THREE.Vector3();
  readonly trail = new THREE.Vector3();
  leadToe = 0;
  trailToe = 0;
  readonly leadHand = new THREE.Vector3();
  readonly trailHand = new THREE.Vector3();
  leadGrip = 0;
  trailGrip = 0;
}

const ease = (t: number) => t * t * (3 - 2 * t);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const mixV = (out: THREE.Vector3, a: V3, b: V3, t: number) => out.set(mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t));

/** Writes the clip at `u`, 0..1, into `out`. */
export function sampleGetUp(kind: GetUpKind, u: number, out: GetUpPose): void {
  const keys = kind === 'supine' ? SUPINE : PRONE;
  let i = 1;
  while (i < keys.length - 1 && u > keys[i]!.t) i++;
  const a = keys[i - 1]!;
  const b = keys[i]!;
  const span = b.t - a.t;
  const t = ease(Math.min(1, Math.max(0, (u - a.t) / span)));
  mixV(out.hips, a.hips, b.hips, t);
  out.pitch = mix(a.pitch, b.pitch, t);
  out.roll = mix(a.roll, b.roll, t);
  out.bend = mix(a.bend, b.bend, t);
  out.head = mix(a.head, b.head, t);
  mixV(out.lead, a.lead, b.lead, t);
  mixV(out.trail, a.trail, b.trail, t);
  out.leadToe = mix(a.leadToe, b.leadToe, t);
  out.trailToe = mix(a.trailToe, b.trailToe, t);
  mixV(out.leadHand, a.leadHand, b.leadHand, t);
  mixV(out.trailHand, a.trailHand, b.trailHand, t);
  out.leadGrip = mix(a.leadGrip, b.leadGrip, t);
  out.trailGrip = mix(a.trailGrip, b.trailGrip, t);
}

declare module '../../core/contracts' {
  /** Humanoids only, which is how gore and the enemies know whether a body can do any of this. */
  interface CharacterAnimation {
    /**
     * Knocked off balance. The feet take quick steps to catch the body, the arms go out, and a leg hit buckles the knee.
     * `strength` is 0..1. The root is the caller's to move: the feet follow it.
     */
    stumble?(worldDir: THREE.Vector3, strength: number, bone: number): void;
    /** A hand goes to a wound and stays until `seconds` run out. This is the hold that section 14.6 of the design asks for. */
    holdWound?(bone: number, worldPoint: THREE.Vector3, seconds: number): void;
    /** Hands come up in front of the face. */
    guard?(seconds: number): void;
    /** Swaying and stupid: a hand to the head and no real balance, while the caller keeps it from acting. */
    daze?(seconds: number): void;
    /**
     * Takes over from the pose on the bones right now, without a pop, and plays the get-up. `seconds` is the whole clip.
     * The root must already be where it will stand. Returns how long it runs, 0 once the body has only to settle.
     */
    getUp?(kind: GetUpKind, seconds: number, hurt: number): number;
    /** Writes the first frame of a get-up onto the bones, and where its hips sit relative to the root into `hips`. */
    poseGetUpStart?(kind: GetUpKind, hips: THREE.Vector3): void;
  }
}
