/** Finger poses. Curls are radians at each joint; thumb is [oppose, flex, middle, tip]; fingers are [base, mid, tip, spread]. */
import { packPose, type HandPose } from './arms';

const pose = (p: HandPose): Float32Array => packPose(p);

export const HANDS = {
  relaxed: pose({
    thumb: [0.3, 0.2, 0.25, 0.2], index: [0.25, 0.35, 0.2, 0.03], middle: [0.32, 0.42, 0.25, 0], ring: [0.38, 0.46, 0.28, -0.02], pinky: [0.45, 0.5, 0.3, -0.05],
  }),
  open: pose({
    thumb: [0.1, -0.1, 0.05, 0.05], index: [0.02, 0.06, 0.04, 0.07], middle: [0.03, 0.08, 0.05, 0.01], ring: [0.05, 0.08, 0.06, -0.05], pinky: [0.08, 0.1, 0.08, -0.12],
  }),
  /** Pistol grip: three fingers wrapped, index along the trigger, thumb over the top. */
  grip: pose({
    thumb: [0.9, 0.55, 0.4, 0.3], index: [0.62, 0.95, 0.5, 0.05], middle: [1.25, 1.5, 0.95, 0], ring: [1.3, 1.5, 1.0, 0], pinky: [1.35, 1.45, 1.0, -0.03],
  }),
  /** Cradling a handguard from below. */
  support: pose({
    thumb: [0.55, 0.35, 0.35, 0.25], index: [0.62, 0.8, 0.45, 0.04], middle: [0.72, 0.88, 0.5, 0], ring: [0.78, 0.9, 0.52, -0.02], pinky: [0.85, 0.92, 0.55, -0.05],
  }),
  /** Fist around a vertical bar. */
  foregrip: pose({
    thumb: [1.0, 0.6, 0.5, 0.4], index: [1.05, 1.3, 0.8, 0.02], middle: [1.15, 1.4, 0.9, 0], ring: [1.2, 1.4, 0.9, 0], pinky: [1.25, 1.4, 0.9, -0.02],
  }),
  /** Around a magazine. */
  cup: pose({
    thumb: [0.8, 0.4, 0.3, 0.2], index: [0.55, 0.7, 0.4, 0.05], middle: [0.62, 0.75, 0.42, 0], ring: [0.66, 0.78, 0.44, -0.02], pinky: [0.72, 0.8, 0.46, -0.04],
  }),
  /** A shell or cartridge between thumb and two fingers. */
  pinch: pose({
    thumb: [1.0, 0.75, 0.4, 0.3], index: [0.8, 0.85, 0.4, 0.02], middle: [0.85, 0.95, 0.45, 0], ring: [1.2, 1.45, 0.9, 0], pinky: [1.25, 1.45, 0.9, 0],
  }),
  /** Long hilt, both hands. */
  hilt: pose({
    thumb: [1.0, 0.7, 0.55, 0.4], index: [1.1, 1.4, 0.85, 0.02], middle: [1.18, 1.45, 0.9, 0], ring: [1.22, 1.45, 0.9, 0], pinky: [1.25, 1.42, 0.9, -0.02],
  }),
  /** Pressing a button with the thumb, fingers around a small box. */
  radio: pose({
    thumb: [0.7, 0.25, 0.2, 0.1], index: [0.85, 1.1, 0.7, 0.02], middle: [0.95, 1.2, 0.75, 0], ring: [1.0, 1.22, 0.78, 0], pinky: [1.05, 1.22, 0.8, -0.02],
  }),
  /** Two fingers out, the rest folded: a tap on the helmet. */
  tap: pose({
    thumb: [0.9, 0.5, 0.45, 0.3], index: [0.08, 0.14, 0.1, 0.05], middle: [0.1, 0.16, 0.12, -0.02], ring: [1.15, 1.4, 0.9, 0], pinky: [1.2, 1.4, 0.9, -0.02],
  }),
  /** Around a sphere the size of a fist. */
  ball: pose({
    thumb: [0.95, 0.5, 0.35, 0.3], index: [0.7, 0.85, 0.5, 0.1], middle: [0.75, 0.9, 0.55, 0.02], ring: [0.8, 0.92, 0.55, -0.05], pinky: [0.85, 0.95, 0.58, -0.1],
  }),
} as const;
