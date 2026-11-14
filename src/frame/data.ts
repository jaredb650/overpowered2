/**
 * Every number the Distraint Frame is tuned by, in seconds, metres, radians and enemy hit points. Section 3 of
 * docs/proposals/mission-2-plan.md gives the defaults; the notes beside each say where play moved one.
 */
import type { SeatPlan } from '../vehicles/seat';

const query = typeof location === 'undefined' ? null : new URLSearchParams(location.search);

/** `?frame=1`: the player starts every run in a Frame (the Test Range is where it is meant to be tried). */
export const FRAME_ASKED = query?.get('frame') === '1';
/** `?frameturn=free`: the view takes the legs with it at once, with no 80 degree limit, to compare (question 2). */
export const FRAME_TURN_FREE = query?.get('frameturn') === 'free';

const DEG = Math.PI / 180;

export const FRAME = {
  /** The collision body: a capsule from `step` over the feet to `top`, so anything lower than a step is under it, not in its way. */
  body: { radius: 1.5, top: 6.2, step: 1.2, skin: 0.04, minWalkY: 0.62 },
  /** Ground is felt under the middle and four feet this far out, turned with the legs. */
  foot: 0.95,
  /** Eye over the feet, and how far ahead of the hips the cockpit pod sits. */
  eye: 5.2,
  podAhead: 0.9,
  /** Heavier than the player's 32 only in feel: the fall from a hover reads as weight. */
  gravity: 22,
  walk: {
    forward: 7, back: 4.5, side: 5,
    /** 1.1 s to reach 7 m/s, 0.6 s to stop. */
    accel: 7 / 1.1,
    decel: 7 / 0.6,
    /** Share of the control left in the air with the jets off. */
    air: 0.5,
    /** Each plant pushes: the speed swells and sags by this share over a stride, so it walks and does not glide. */
    surge: 0.08,
  },
  /** Metres between plants at full walk, which is 0.7 s at 7 m/s; shorter steps when slower. */
  stride: { full: 4.9, slow: 2.6, crush: 1.4 },
  turn: {
    /** The view is free this far either side of the legs. Past it, the mouse drags the whole Frame round at `rate`. */
    arc: 80 * DEG,
    rate: 140 * DEG,
    /** While walking the legs come round under the view on their own, slower than a drag. */
    walking: 70 * DEG,
    /** With `?frameturn=free`, how fast the legs catch the view (1/s). */
    free: 9,
  },
  jet: {
    /** Up 7 m in 0.8 s: off the ground at `launch`, slowing at `boost` net, then a hover held level for up to 1.5 s. */
    launch: 14,
    boost: -13.1,
    boostSeconds: 0.8,
    /** Fuel is seconds of thrust: the boost and the hover. */
    fuel: 2.3,
    /** Least fuel a launch from the ground takes. Less than this and the jets only catch a fall. */
    launchMin: 0.35,
    /** How hard a hover pulls the climb or the fall back to level (1/s). */
    hold: 5,
    /** A launch with a key held throws it that way at this much (m/s), and while they burn the jets steer: full control. */
    kick: 3,
    /** Seconds on the ground from empty to full, and the wait before it starts. */
    refill: 3,
    refillAfter: 0.25,
  },
  stomp: {
    speed: 30,
    /** Below this over the ground a press does nothing: the stomp needs room to be one. */
    minHeight: 1.5,
    /** From this height or more it is the big one. */
    big: 4,
    /** The big slam's ring, twice the size: damage from `center` falling to `edge`, and everyone inside `knock` off their feet. */
    radius: 14, knock: 10, center: 160, edge: 40,
    /** A push that takes a man off his feet: the big slam's 420, and more for a body this size. */
    knockForce: 650,
    /** A stomp from lower: this share of the ring, damage and push. */
    small: 0.5,
    recover: 0.6,
    /** Of the speed it had, what the stomp keeps going sideways. */
    carry: 0.3,
  },
  charge: { speed: 16, seconds: 0.7, count: 2, refill: 4, damage: 150, force: 900, reach: 2.4 },
  backhand: { arc: 120 * DEG, reach: 5.5, damage: 200, force: 750, every: 1 },
  /** A planted foot crushes anyone this close to it. */
  crush: { radius: 1.4, damage: 400 },
  /** The view's own weight, all of it in the feet and the eye, none in the aim. */
  feel: {
    /** Eye dip at a plant (m), the kick down (rad), trauma, and the sway either side over a stride (m, rad). */
    stepDip: 0.09, stepKick: 0.01, stepTrauma: 0.1, sway: 0.07, roll: 0.012,
    /** The eye's spring back after a dip (1/s). */
    spring: 9,
    /** Eye dip per m/s of landing speed, and its most. */
    landDip: 0.045, landDipMax: 1.1,
    stompDip: 1.3,
  },
  rotary: {
    /** The door gun's 20 mm round (heliData DOOR_GUN), at 20 a second. */
    rate: 20, spinUp: 0.4, spinDown: 1.1, fireAt: 0.75, barrelRate: 46, spread: 0.008,
    damage: 60, severMult: 3, force: 34, burst: { radius: 0.6, damage: 16, scale: 1.5 }, penetrate: 1.4, bodyCost: 0.3, impactScale: 1.6,
    range: 420, tracerEvery: 2, flashEvery: 2, trauma: 0.05, kick: 0.0012,
    /** The mounted gun's Heat: about 7 s to OVERHEAT at 20 a second, 2.5 s to vent. */
    heatPerShot: 1 / 140, cool: 0.3, vent: 0.4,
  },
  /** The AC-130's 40 mm, its magazine and three rounds as they are (ac130Data bofors), fired flat from the arm. */
  cannon: { magazine: 8, reload: 4.5, interval: 0.32, speed: 130, spread: 0.0015, trauma: 0.22, kick: 0.02 },
  /** The Quiver's painter on a six-tube pod. One salvo empties it, then 10 s to reload. */
  pod: { tubes: 6, reload: 10, paintEvery: 0.15, cone: 0.2, range: 180, gap: 0.09, damage: 110, blast: 90, radius: 3.5 },
  /** The seats' flares, three a beat, with the gunship's lockout after each pop, and a wall of smoke round the Frame. */
  smoke: { count: 3, lockout: 3, seconds: 9, size: 7 },
} as const;

/** The gunner's seat with a walking mount. Everything the seat does (arc, zoom, HUD, the way out) is the seat's. */
export function framePlan(): SeatPlan {
  return {
    label: 'DISTRAINT 4', tone: 'frame', seconds: Infinity, fov: 84, zoomFov: 42, aimZooms: false,
    arcCenter: 0, arcHalf: FRAME_TURN_FREE ? Math.PI : FRAME.turn.arc, pitchMin: -0.95, pitchMax: 0.62,
    lock: 0, roll: 1, eye: [0, 0, 0], reach: 420, grade: null, enemyColor: '#ff4a3a', grace: 0, shake: 1, exposed: true,
  };
}
