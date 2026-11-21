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
  /** Hull integrity, directional armor multipliers, and boarding/eject constants. */
  hull: {
    maxHealth: 4000,
    /** Small-arms fire chips off heavy armor plates with sparks; snipers punch deeper; heavy ordnance deals full damage. */
    bulletMult: 0.18,
    sniperMult: 0.45,
    heavyMult: 1.0,
    /** Hits from behind into the dorsal reactor slats deal bonus damage. */
    rearMult: 1.5,
    /** Blast when the Frame's hull fails and explodes. */
    explodeRadius: 12,
    explodeDamage: 320,
    /** Metres from a parked Frame at which E climbs back in. */
    boardReach: 5.2,
    /** Seconds of player invulnerability after an emergency eject on destruction. */
    exitGrace: 1.5,
  },
  stomp: {
    speed: 32,
    /** Below this over the ground a press does nothing: the stomp needs room to be one. */
    minHeight: 1.2,
    /** From this height or more it is the big one. */
    big: 4,
    /** The big slam's ring, twice the size: damage from `center` falling to `edge`, and everyone inside `knock` off their feet. */
    radius: 16, knock: 12, center: 240, edge: 60,
    /** A push that takes a man off his feet: the big slam's 420, and more for a body this size. */
    knockForce: 850,
    /** A stomp from lower: this share of the ring, damage and push. */
    small: 0.55,
    recover: 0.5,
    /** Of the speed it had, what the stomp keeps going sideways. */
    carry: 0.35,
  },
  charge: { speed: 18, seconds: 0.75, count: 2, refill: 3.5, damage: 240, force: 1150, reach: 3.2 },
  /** Wide 190-degree front sweep PLUS a 4 m 360-degree close-proximity sweep so enemies crowding around the legs get flattened. */
  backhand: { arc: 190 * DEG, reach: 7.2, closeRadius: 4.0, damage: 340, force: 1100, every: 0.72 },
  /** A planted foot crushes anyone under it, and walking continuously tramples anyone hugging the ankles. */
  crush: { radius: 2.0, damage: 450, trampleRadius: 1.85, trampleDamage: 160, trampleEvery: 0.45 },
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
    /** Heavy 20 mm Vulcan: snappy spin-up, 24 rounds/s, about 6.7 s to overheat, 2.2 s to vent. */
    rate: 24, spinUp: 0.25, spinDown: 0.9, fireAt: 0.65, barrelRate: 54, spread: 0.0075,
    damage: 68, severMult: 3.2, force: 38, burst: { radius: 0.7, damage: 22, scale: 1.6 }, penetrate: 1.5, bodyCost: 0.28, impactScale: 1.65,
    range: 420, tracerEvery: 2, flashEvery: 2, trauma: 0.045, kick: 0.0011,
    heatPerShot: 1 / 160, cool: 0.35, vent: 0.45,
  },
  /** The 40 mm autocannon: 10-round magazine, three shell types (HE / AP / FLAK), punchy flat trajectory. */
  cannon: { magazine: 10, reload: 3.8, interval: 0.28, speed: 145, spread: 0.0012, trauma: 0.24, kick: 0.022 },
  /** The 6-tube lock-on missile pod: fast painting, wide cone, heavy salvo, 8.5 s reload. */
  pod: { tubes: 6, reload: 8.5, paintEvery: 0.11, cone: 0.26, range: 200, gap: 0.08, damage: 145, blast: 115, radius: 4.2 },
  /** Regenerating countermeasures: flares, smoke wall, and a close-range concussive blast that clears the ankles. */
  smoke: { count: 3, lockout: 2.5, refill: 14, seconds: 9, size: 7, blastRadius: 6.5, blastDamage: 45, blastForce: 620 },
} as const;

/** The gunner's seat with a walking mount. Everything the seat does (arc, zoom, HUD, the way out) is the seat's. */
export function framePlan(): SeatPlan {
  return {
    label: 'DISTRAINT 4', tone: 'frame', seconds: Infinity, fov: 84, zoomFov: 42, aimZooms: false,
    arcCenter: 0, arcHalf: FRAME_TURN_FREE ? Math.PI : FRAME.turn.arc, pitchMin: -0.95, pitchMax: 0.62,
    lock: 0, roll: 1, eye: [0, 0, 0], reach: 420, grade: null, enemyColor: '#ff4a3a', grace: 0, shake: 1, exposed: true,
  };
}
