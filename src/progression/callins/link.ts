/**
 * What passes between the call-ins and co-op (net/world/callins.ts), as plain numbers: no game objects, nothing from `net`.
 *
 * A caller tells the others three kinds of thing:
 *   CallOrder   a call-in beginning: which, where, which way, and a seed, so every screen flies the same one
 *   CallNews    something that happens to it afterwards that the order could not say: the player steering a beam, a round
 *               leaving a gun, an aircraft's pose, a shoot-down
 *   mech        the Distraint Frame the player is in: its pose a few times a second, and what it fires
 *
 * Every screen plays a copy from these with `CallinMirror` (mirror.ts), through the same strike code the caller runs, on a
 * context that cannot hurt anything (ghost.ts). Damage stays the caller's.
 */
import type { CallInId } from '../../core/gameplay';

export type V3 = [number, number, number];

export interface CallOrder {
  /** The caller's own count of its call-ins, 0 to 255 and round again. Later news names the call-in by it. */
  n: number;
  id: CallInId;
  /** The mark: where the crosshair fell, the centre of an orbit, where a pod comes down. */
  at: V3;
  /** An angle on the ground: the Warthog's run, the gunship's side of its circle, the way a pod faces. */
  yaw: number;
  /** For everything the strike rolls: each screen draws the same scatter from it. */
  seed: number;
  /** Sent in with its crew, not flown. */
  ai: boolean;
  /** Seconds since it began, for a player who arrives while it is running. 0 on a fresh call. */
  age: number;
}

/**
 * steer    the Orbital Lance: where the caller's aim is on the ground, `[x, y, z]`
 * release  the Orbital Lance let go of
 * round    a gunship round leaving its gun: `[kind, aimX, aimY, aimZ]` (kind indexes `ROUND_KINDS`)
 * bomb     the gunship's ramp opening on `[x, y, z]`
 * laser    where the gunship's bomb is being steered, `[x, y, z]`
 * flares   an aircraft throwing flares
 * pose     a helicopter: `[x, y, z, fwdX, fwdY, fwdZ, roll, gunYaw, gunPitch, aimX, aimY, aimZ, triggers]`
 *          (triggers: bit 0 fire, bit 1 alt, bit 2 heading home)
 * down     an aircraft shot down. A helicopter says where it was and how fast it was going, `[x, y, z, vx, vy, vz]`, so
 *          every copy falls from the same place
 * end      it is over early: taken back, or the run ended
 * clock    the gunship's own clock, `[seconds]`, once a second: its place on its circle is a function of it, and a copy on a
 *          screen that dropped frames would otherwise fall behind for the rest of the sortie
 * aa       an enemy's anti-air missile left for this aircraft from `[x, y, z]`: the copies' screens fly one too
 * aax      that missile burst at `[x, y, z]` (on the aircraft, on a flare, or spent)
 */
export type NewsKind = 'steer' | 'release' | 'round' | 'bomb' | 'laser' | 'flares' | 'pose' | 'down' | 'end' | 'clock' | 'aa' | 'aax';
/** By number on the wire. Add at the end only. */
export const NEWS_KINDS: readonly NewsKind[] = ['steer', 'release', 'round', 'bomb', 'laser', 'flares', 'pose', 'down', 'end', 'clock', 'aa', 'aax'];

export interface CallNews {
  n: number;
  k: NewsKind;
  v?: number[];
}

/**
 * The Frame's own news, apart from its pose.
 * shell    a 40 mm or 105 mm leaving the arm: `[kind, fromX, fromY, fromZ, aimX, aimY, aimZ, seconds]`
 * missile  the six-tube pod firing: `[fromX, fromY, fromZ, velX, velY, velZ]`
 * stomp    the slam landing: `[height]` (optional `[height, scale]`)
 * smoke    the smoke going
 * swing    the backhand
 * vulcan30 30 mm rotary shell: `[round, fromX, fromY, fromZ, aimX, aimY, aimZ]`
 * beam     Red Beam shot: `[fromX, fromY, fromZ, endX, endY, endZ]`
 * cluster  Bomblet Cannon burst: `[atX, atY, atZ, dirX, dirY, dirZ]`
 * shotgun  Mech Shotgun blast: `[fromX, fromY, fromZ, dirX, dirY, dirZ]`
 * storm    Metal Storm Pod burst: `[fromX, fromY, fromZ, toX, toY, toZ]`
 * mirv     MIRV launch / split: `[phase, x, y, z, tx, ty, tz]`
 * wire     Guided Heavy Missile launch / megaBlast: `[phase, x, y, z, vx, vy, vz]`
 * mortar   Mortar Rack launch / impact: `[round, x, y, z, tx, ty, tz]`
 * fpv      FPV Drone launch / burst: `[phase, x, y, z, tx, ty, tz]`
 * pointdef Point Defence intercept tracer: `[fromX, fromY, fromZ, atX, atY, atZ]`
 * sweep    Spider Legs 360° leg sweep: `[x, y, z]`
 */
export type MechKind =
  | 'shell' | 'missile' | 'stomp' | 'smoke' | 'swing'
  | 'vulcan30' | 'beam' | 'cluster' | 'shotgun'
  | 'storm' | 'mirv' | 'wire' | 'mortar' | 'fpv' | 'pointdef'
  | 'sweep'
  | 'grenade' | 'sword' | 'bunker' | 'flamer' | 'plasma' | 'rail' | 'shield'
  | 'twinGrenade' | 'orbit' | 'arcNeedle' | 'plasmaMissiles' | 'shoulderGatling'
  | 'expansion' | 'boostKick' | 'repulsor';
/** Append-only wire order. Never insert, reorder or remove. */
export const MECH_KINDS: readonly MechKind[] = [
  'shell', 'missile', 'stomp', 'smoke', 'swing',
  'vulcan30', 'beam', 'cluster', 'shotgun',
  'storm', 'mirv', 'wire', 'mortar', 'fpv', 'pointdef',
  'sweep',
  'grenade', 'sword', 'bunker', 'flamer', 'plasma', 'rail', 'shield',
  'twinGrenade', 'orbit', 'arcNeedle', 'plasmaMissiles', 'shoulderGatling',
  'expansion', 'boostKick', 'repulsor',
];

/**
 * Is the call-in uplink jammed for this player? Alone and on a co-op host it is the Commander's own word (his radio men are
 * in this game). A co-op guest has no radio men of its own: it goes by what the host said (`commander:status`, flag
 * `uplink`), so the jammer holds every player's call-ins alike.
 */
export const uplinkJammed = (guest: boolean, told: boolean, delay: number): boolean => (guest ? told : delay > 0);

/** Most numbers a piece of news may carry. */
export const NEWS_NUMBERS = 16;

/** The local player's call-ins and Frame, told to the others. Co-op sets this; alone it is null and nothing is said. */
export interface CallinSend {
  order(order: CallOrder): void;
  news(news: CallNews): void;
  /** The Frame's pose (`MechPose`, frame/puppet.ts), or null as the player leaves it. */
  mech(pose: number[] | null): void;
  mechNews(kind: MechKind, values?: number[]): void;
}

/** Other players' call-ins and Frames, played here. `slot` is the player's place in the lobby, 0 to 3. */
export interface CallinLink {
  send: CallinSend | null;
  order(slot: number, order: CallOrder): void;
  news(slot: number, news: CallNews): void;
  mech(slot: number, pose: number[] | null): void;
  mechNews(slot: number, kind: MechKind, values: number[]): void;
  /** A player left: everything of theirs goes. */
  drop(slot: number): void;
  /** This player's own call-ins that are running now, each as its order with `age` (seconds since it began). */
  runningOrders(): CallOrder[];
  /** The copies of that player's call-ins flying on this screen, as their orders with their `age` now. */
  copyOrders(slot: number): CallOrder[];
  /** True while this screen is flying that player's call-in of this kind. */
  has(slot: number, id: CallInId): boolean;
  /** True while that player is in a Frame: the puppet is their body, and their own is not drawn. */
  inFrame(slot: number): boolean;
  /** The Commander's missile on another player's aircraft (co-op host): told to that player, whose own game brings it down. */
  shootDown(id: CallInId): boolean;
}
