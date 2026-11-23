/**
 * Retraining: the tutorial (docs/design/tutorial.md), on the Annex (world/map/annex). One run north through every system: the
 * movement, the guns and their rounds, the shop, the blade, the brain chips, the prisoners in the Yard, and a nuke to finish.
 * Plain data, as every mission is. What no system does already (subjects held standing, the shop open outside a break, the
 * voluntary exit) is campaign/retraining.ts, reached through `tut.*` calls.
 */
import {
  BALCONY, CHIMNEY_TOP, JET_TOWER, DASH_LAND, DASH_PIT, DECK, DOORS, DUCT, EXIT, LEDGE, ROCKET_LEDGE, SLAM_PIT, SLOT, STAIRS_X, STAND,
  TOWN_SUBJECTS, WALL_LAND, WALL_PIT,
} from '../../world/map/annex/plan';
import type { Checkpoint, DoorDef, Loadout, Mark, Mission, Script, Zone } from '../types';
import { RETRAINING_LINES } from './retraining.lines';

const KIT: Loadout = { weapons: ['smg', 'sword'], grenades: 0 };
/** From the rocket ledge on, the launcher stays: a restart never takes back what a station gave. */
const ARMED: Loadout = { weapons: ['smg', 'rocket', 'sword'], grenades: 0 };
const YARD_KIT: Loadout = { weapons: ['smg', 'rivet', 'rocket', 'sword'], grenades: 1 };
const at = (mark: string, loadout = KIT): Checkpoint => ({ at: mark, loadout });
const say = (line: string): Script[number] => ({ do: 'say', line: `mission.council.tut.${line}` });
/** A station's first line: the last station's leftovers are dropped, so the Council talks about where the player is. */
const cut = (line: string): Script[number] => ({ do: 'say', line: `mission.council.tut.${line}`, now: true });
const tut = (name: string, arg?: string): Script[number] => ({ do: 'call', name: `tut.${name}`, ...(arg !== undefined ? { arg } : {}) });
const zone = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Zone => ({ min: [x0, y0, z0], max: [x1, y1, z1] });
const door = (d: { x: number; y: number; z: number; w: number }, height = 3.4): DoorDef =>
  ({ at: [d.x, d.y, d.z], yaw: 0, width: d.w, height, kind: 'shutter', seconds: 1, start: 0 });

/** Marks in a ring round a point. */
function ring(prefix: string, cx: number, cz: number, r: number, n: number, y = 0): Record<string, Mark> {
  const out: Record<string, Mark> = {};
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.3;
    out[`${prefix}${i}`] = { at: [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r] };
  }
  return out;
}
const names = (prefix: string, n: number): string => Array.from({ length: n }, (_, i) => `${prefix}${i}`).join(',');

/** Twenty clear street and square marks in the shantytown, never overlapping buildings. */
const TOWN_MARKS: Record<string, Mark> = Object.fromEntries(
  TOWN_SUBJECTS.map(([x, z], i) => [`town${i}`, { at: [x, 0, z] }]),
);

export const RETRAINING: Mission = {
  id: 'retraining',
  title: 'Retraining',
  loadout: KIT,
  zones: {
    exit: zone(EXIT.x0, -1, EXIT.z0 + 2, EXIT.x1, 4.5, EXIT.z1),
    hall: zone(-8, -1, -4, 8, 6, -0.6),
    ductEnd: zone(-8, -1, DUCT.z0 - 4, 8, 5, DUCT.z0 - 0.4),
    slot: zone(-8, -1, SLOT.z0, 8, 1.4, SLOT.z1),
    slotEnd: zone(-8, -1, SLOT.z0 - 5, 8, 5, SLOT.z0 - 0.4),
    dashPit: zone(-8, -8, DASH_PIT.z0, 8, -1.5, DASH_PIT.z1),
    dashLand: zone(-8, DECK - 0.5, DASH_LAND.z0, 8, DECK + 20, DASH_LAND.z1),
    wallPit: zone(-8, -8, WALL_PIT.z0, 8, -1.5, WALL_PIT.z1),
    wallLand: zone(-8, DECK - 0.5, WALL_LAND.z0, 8, DECK + 20, WALL_LAND.z1),
    chimneyTop: zone(-3, CHIMNEY_TOP - 1, -106, 3, CHIMNEY_TOP + 20, -100),
    slamPit: zone(-8, -1, SLAM_PIT.z0 - 2, 8, 3, SLAM_PIT.z1),
    ledgeTop: zone(-8, LEDGE - 0.5, ROCKET_LEDGE.z0, 8, LEDGE + 20, ROCKET_LEDGE.z1),
    jetTop: zone(JET_TOWER.x0, LEDGE + JET_TOWER.h - 0.5, JET_TOWER.z0, JET_TOWER.x1, LEDGE + JET_TOWER.h + 20, JET_TOWER.z1),
    balcony: zone(STAND.x0, BALCONY - 1, STAND.z0, STAND.x1, BALCONY + 8, STAND.z1),
  },
  marks: {
    spawn: { at: [0, 0.3, 8.5], yaw: 0 },
    exitFront: { at: [0, 0, 11], yaw: Math.PI },
    exitTarget: { at: [0, 1.2, EXIT.z0 + 4] },
    hallDoor: { at: [0, 0, -2] },
    ductEnd: { at: [0, 0, DUCT.z0 - 2] },
    slideStart: { at: [0, 0, -20], yaw: 0 },
    slotEnd: { at: [0, 0, SLOT.z0 - 2] },
    dashStart: { at: [0, DECK, -43], yaw: 0 },
    dashLand: { at: [0, DECK, -65] },
    wallStart: { at: [0, DECK, -65], yaw: 0 },
    wallLand: { at: [0, DECK, -97] },
    chimney: { at: [0, DECK, -101] },
    slamTop: { at: [0, CHIMNEY_TOP, -104.5], yaw: 0 },
    slamTarget: { at: [SLAM_PIT.cx, 0, SLAM_PIT.cz] },
    rocketStart: { at: [0, 0, -121], yaw: 0 },
    ledge: { at: [0, LEDGE, -129] },
    jetTop: { at: [(JET_TOWER.x0 + JET_TOWER.x1) / 2, LEDGE + JET_TOWER.h, (JET_TOWER.z0 + JET_TOWER.z1) / 2] },
    galleryLanding: { at: [0, LEDGE, -135], yaw: 0 },
    laneA: { at: [-4, 0, -170] },
    laneB: { at: [4, 0, -178] },
    podPad: { at: [8, 0, -162] },
    trench0: { at: [-3, 0, -193.5] },
    trench1: { at: [0.5, 0, -194.5] },
    trench2: { at: [3.5, 0, -193.5] },
    bladeDoor: { at: [0, 0, -203.5], yaw: 0 },
    blade0: { at: [-3, 0, -214] },
    blade1: { at: [0, 0, -216] },
    blade2: { at: [3, 0, -214] },
    quietDoor: { at: [0, 0, -229.5], yaw: 0 },
    hidden0: { at: [-11, 0, -240] },
    hidden1: { at: [11, 0, -240] },
    hidden2: { at: [0, 0, -249] },
    ringCentre: { at: [0, 0, -258] },
    ...ring('kata', 0, -258, 9, 8),
    yardDoor: { at: [0, 0, -273.5], yaw: 0 },
    yardA: { at: [-10, 0, -299] },
    shed: { at: [19, 0, -319] },
    stairs: { at: [STAIRS_X, 0, -320] },
    balcony: { at: [0, BALCONY, -341], yaw: 0 },
    townCenter: { at: [0, 0, -372] },
    ...ring('slam', SLAM_PIT.cx, SLAM_PIT.cz, 3.2, 5),
    ...TOWN_MARKS,
  },
  routes: {},
  doors: {
    gallery: door(DOORS.gallery),
    blade: door(DOORS.blade),
    quiet: door(DOORS.quiet),
    yard: door(DOORS.yard, 3.6),
  },
  cutscenes: {},
  lines: RETRAINING_LINES,
  redeployLines: ['mission.council.tut.redeploy.1', 'mission.council.tut.redeploy.2', 'mission.council.tut.redeploy.3'],
  beats: [
    // Intake: the clone bay, the voluntary exit behind the pod, and the way on.
    {
      id: 'intake',
      title: 'Intake',
      checkpoint: at('spawn'),
      start: [
        tut('begin'),
        say('i0.line'), say('i0.welcome'), say('i0.policy'), say('i0.encourage'), say('i0.subjects'),
        { do: 'objective', id: 'hall', text: 'Walk through to the hall', at: 'hallDoor' },
        { do: 'hint', text: 'Move with {forward} {left} {back} {right}. The door behind you is the voluntary exit.', seconds: 9 },
      ],
      until: { zone: 'hall' },
    },
    {
      id: 'crouch',
      title: 'Mobility',
      start: [
        { do: 'done', id: 'hall' },
        cut('m.crouch'),
        { do: 'objective', id: 'duct', text: 'Crouch through the duct', at: 'ductEnd' },
        { do: 'hint', text: 'Hold {slide} to crouch. Then run and {jump} at the low wall to vault it.', seconds: 9 },
      ],
      until: { zone: 'ductEnd' },
    },
    {
      id: 'slide',
      title: 'Mobility',
      start: [
        { do: 'done', id: 'duct' },
        cut('m.slide'),
        { do: 'objective', id: 'slide', text: 'Slide under the slot', at: 'slotEnd' },
        { do: 'hint', text: 'Running at full speed, press and hold {slide} to slide under. {jump} out of a slide to keep the speed.', seconds: 9 },
        tut('drill', 'slide'),
        tut('zones', 'slot,slotEnd,slideStart,exit,exitFront'),
      ],
      until: { signal: 'ok:slide' },
    },
    {
      id: 'dash',
      title: 'Mobility',
      checkpoint: at('dashStart'),
      start: [
        { do: 'done', id: 'slide' },
        cut('m.dash'),
        { do: 'objective', id: 'dash', text: 'Climb the ledge and dash the gap', at: 'dashLand' },
        { do: 'hint', text: '{jump} at the ledge and hold {forward} to climb up. Then {jump}, {jump} again in the air, and {dash}.', seconds: 10 },
      ],
      cues: [{ when: { zone: 'dashPit' }, repeat: true, run: [{ do: 'place', at: 'dashStart' }, say('m.pit'), { do: 'hint', text: 'Jump, jump again near the top, then {dash}. You have two dashes.', seconds: 6 }] }],
      until: { zone: 'dashLand' },
    },
    {
      id: 'wallrun',
      title: 'Mobility',
      start: [
        { do: 'done', id: 'dash' },
        cut('m.wallrun'),
        { do: 'objective', id: 'wall', text: 'Wall-run across the pit', at: 'wallLand' },
        { do: 'hint', text: 'At full speed, {jump} at a wall at a shallow angle and hold {forward}. {jump} again to kick off it.', seconds: 10 },
      ],
      cues: [{ when: { zone: 'wallPit' }, repeat: true, run: [{ do: 'place', at: 'wallStart' }, { do: 'hint', text: 'Run along the cyan stripe: {jump} toward the wall, hold {forward}, and steer slightly into it.', seconds: 7 }] }],
      until: { zone: 'wallLand' },
    },
    {
      id: 'chimney',
      title: 'Mobility',
      start: [
        { do: 'done', id: 'wall' },
        cut('m.chimney'),
        { do: 'objective', id: 'chimney', text: 'Climb the chimney', at: 'chimney' },
        { do: 'hint', text: '{jump} straight at a wall and hold {forward} to climb. {jump} again on the wall to turn and kick onto the other one.', seconds: 11 },
      ],
      until: { zone: 'chimneyTop' },
    },
    {
      id: 'slam',
      title: 'Mobility',
      start: [
        { do: 'done', id: 'chimney' },
        tut('held', `slam:light:${names('slam', 5)}`),
        cut('m.slam'),
        { do: 'objective', id: 'slam', text: 'Slam into the ring below', at: 'slamTarget' },
        { do: 'hint', text: 'Jump off, and in the air press {slide} to slam. From this high it knocks down everyone near.', seconds: 9 },
        tut('drill', 'slam'),
        tut('zones', 'slamPit,slamTop'),
      ],
      until: { event: 'player:slam', where: { big: true } },
    },
    {
      id: 'rocket',
      title: 'Mobility',
      checkpoint: at('rocketStart'),
      start: [
        { do: 'done', id: 'slam' },
        cut('m.slamDone'),
        { do: 'give', weapon: 'rocket' },
        say('m.rocket'),
        { do: 'objective', id: 'rocket', text: 'Rocket-jump onto the ledge', at: 'ledge' },
        { do: 'hint', text: 'Look at your feet, {jump}, and {fire} as you leave the ground. {jump} again at the top.', seconds: 10 },
      ],
      until: { zone: 'ledgeTop' },
    },
    {
      id: 'jet',
      title: 'Mobility',
      start: [
        { do: 'done', id: 'rocket' },
        tut('jumpjet', 'on'),
        cut('m.jet'),
        { do: 'objective', id: 'jet', text: 'Jet onto the tower', at: 'jetTop' },
        { do: 'hint', text: 'The Jump Jet replaces your double jump: {jump}, then {jump} again in the air or hold {jump} to burn. The tank refills.', seconds: 11 },
      ],
      until: { zone: 'jetTop' },
    },

    // The Gallery: guns, rounds, the shop, grenades and stims.
    {
      id: 'lane',
      title: 'The Gallery',
      checkpoint: at('galleryLanding', ARMED),
      start: [
        { do: 'done', id: 'jet' },
        tut('jumpjet', 'off'),
        { do: 'door', door: 'gallery', open: 1 },
        tut('sweep'),
        tut('fit', 'smgHp'),
        { do: 'callins', held: true },
        tut('held', 'lane:light:laneA'),
        cut('w.lane'),
        { do: 'objective', id: 'lane', text: 'Shoot the subject on the left', at: 'laneA' },
        { do: 'hint', text: '{aim} to aim. Aimed, hold {dash} to focus: one held breath. {reload} reloads.', seconds: 10 },
      ],
      until: { signal: 'clear:lane' },
    },
    {
      id: 'armour',
      title: 'The Gallery',
      start: [
        { do: 'done', id: 'lane' },
        say('w.hp'),
        tut('held', 'armoured:plated:laneB'),
        // Nothing but armour-piercing ends him: hollow points that miss the plate wound him, never kill him.
        tut('sturdy', 'armoured'),
        cut('w.armour'),
        { do: 'objective', id: 'armour', text: 'Shoot the armoured subject', at: 'laneB' },
      ],
      until: { signal: 'stopped:armoured' },
    },
    {
      id: 'shop',
      title: 'The Gallery',
      start: [
        cut('w.bounce'),
        tut('credits', '1000'),
        tut('pod', 'podPad'),
        say('w.pod'),
        { do: 'objective', id: 'shop', text: 'Buy and fit AP rounds at the supply pod', at: 'podPad' },
        { do: 'hint', text: '{interact} at the pod opens the shop. Mods, then SMG, then AP rounds: Enter buys and fits.', seconds: 12 },
        tut('await', 'fitted:smgAp'),
      ],
      until: { signal: 'fitted:smgAp' },
    },
    {
      id: 'ap',
      title: 'The Gallery',
      start: [
        { do: 'done', id: 'shop' },
        tut('mortal', 'armoured'),
        tut('await', 'clear:armoured'),
        cut('w.fitted'),
        say('w.rounds'),
      ],
      until: { signal: 'clear:armoured' },
    },
    {
      id: 'grenade',
      title: 'The Gallery',
      start: [
        { do: 'done', id: 'armour' },
        cut('w.apDone'),
        { do: 'grenades', count: 2 },
        tut('held', `trench:light:${names('trench', 3)}`),
        say('w.grenade'),
        { do: 'objective', id: 'grenade', text: 'Grenade the trench', at: 'trench1' },
        { do: 'hint', text: 'Hold {grenade} to cook, release to throw.', seconds: 8 },
      ],
      until: { signal: 'clear:trench' },
    },
    {
      id: 'stim',
      title: 'The Gallery',
      start: [
        { do: 'done', id: 'grenade' },
        tut('hurt', '35'),
        cut('w.stim'),
        { do: 'objective', id: 'stim', text: 'Use a stim' },
        { do: 'hint', text: '{stim} injects a stim. Health also comes back by itself once you stop being hurt.', seconds: 9 },
      ],
      until: { event: 'stim:inject' },
    },

    // The Cutting Room.
    {
      id: 'blade',
      title: 'The Cutting Room',
      checkpoint: at('bladeDoor', ARMED),
      start: [
        { do: 'done', id: 'stim' },
        { do: 'door', door: 'blade', open: 1 },
        tut('sweep'),
        tut('drain'),
        cut('k.drain'),
        say('k.blade'),
        tut('held', `blade:light:${names('blade', 3)}`),
        { do: 'objective', id: 'blade', text: 'Kill the subjects with the blade', at: 'blade1' },
        { do: 'hint', text: '{melee} strikes from any gun. {weapon5} draws the blade: {fire} three times chains, {aim} stabs, hold {aim} to guard. Running at one, {fire} dashes to him.', seconds: 14 },
      ],
      until: { signal: 'clear:blade' },
    },
    {
      id: 'energy',
      title: 'The Cutting Room',
      start: [
        { do: 'done', id: 'blade' },
        cut('k.energy'),
        tut('fit', 'swordEnergy'),
        tut('held', 'energy:plated:blade1'),
        { do: 'objective', id: 'energy', text: 'Cut the armoured subject with the energy blade', at: 'blade1' },
        { do: 'hint', text: 'Energy blade fitted: faster swings, a longer lunge, and it cuts through plate. {aim} stabs.', seconds: 10 },
      ],
      until: { signal: 'clear:energy' },
    },

    // The Quiet Room: sonar in the dark, then the Ring.
    {
      id: 'sonar',
      title: 'The Quiet Room',
      checkpoint: at('quietDoor', ARMED),
      start: [
        { do: 'done', id: 'energy' },
        say('k.done'),
        tut('unfit', 'swordEnergy'),
        { do: 'door', door: 'quiet', open: 1 },
        tut('sweep'),
        tut('refill'),
        { do: 'call', name: 'lights', arg: 'emergency' },
        tut('held', `hidden:light:${names('hidden', 3)}`),
        cut('c.sonar'),
        { do: 'objective', id: 'sonar', text: 'Find the three hidden subjects' },
        { do: 'hint', text: '{sonar} pings your sonar: every living body through the walls for a few seconds.', seconds: 10 },
      ],
      until: { all: [{ event: 'sonar:ping' }, { signal: 'clear:hidden' }] },
    },
    {
      id: 'kata',
      title: 'The Quiet Room',
      start: [
        { do: 'done', id: 'sonar' },
        { do: 'call', name: 'lights', arg: 'normal' },
        { do: 'give', weapon: 'rivet' },
        tut('fit', 'rivetAkimbo'),
        tut('equip', 'rivet'),
        { do: 'call', name: 'chip', arg: 'kata' },
        tut('held', `kata:light:${names('kata', 8)}`),
        cut('c.kata'),
        { do: 'objective', id: 'kata', text: 'Stand in the ring and use Gun Kata', at: 'ringCentre' },
        { do: 'hint', text: 'Pistols in both hands. Hold {sonar} until Gun Kata is charged, then let it go. Thermal and Focus are brain chips on the same key.', seconds: 12 },
      ],
      until: { event: 'chip:kata' },
    },

    // The Yard: live men, outdoors. Recovery across all four Yard beats is enforced continuously by Retraining.watchYard.
    {
      id: 'surrender',
      title: 'The Yard',
      checkpoint: at('yardDoor', YARD_KIT),
      start: [
        { do: 'done', id: 'kata' },
        say('c.kataDone'),
        { do: 'door', door: 'yard', open: 1 },
        tut('sweep'),
        { do: 'call', name: 'chip', arg: 'sonar' },
        { do: 'threat', level: 1, grade: 'conscript' },
        tut('yield', 'a'),
        { do: 'squad', tag: 'a', men: ['trooper', 'trooper', 'trooper'], at: 'yardA', orders: 'hold', light: true },
        { do: 'squad', tag: 'b', men: ['trooper', 'trooper'], at: 'shed', orders: 'ambush', light: true },
        cut('y.intro'),
        say('y.live'),
        { do: 'objective', id: 'surrender', text: 'Make one of them surrender', at: 'yardA' },
        { do: 'hint', text: 'Kill two of his squad and stop shooting the last one. He will drop to his knees.', seconds: 10 },
      ],
      until: { event: 'enemy:surrendered' },
    },
    {
      id: 'question',
      title: 'The Yard',
      start: [
        { do: 'done', id: 'surrender' },
        cut('y.kneel'),
        { do: 'objective', id: 'question', text: 'Question him' },
        { do: 'hint', text: 'Walk up to the kneeling man and tap {interact} to question him.', seconds: 9 },
      ],
      until: { event: 'prisoner:questioned' },
    },
    {
      id: 'release',
      title: 'The Yard',
      start: [
        { do: 'done', id: 'question' },
        cut('y.reveal'),
        say('y.release'),
        { do: 'objective', id: 'release', text: 'Let him go' },
        { do: 'hint', text: 'Tap {interact} on him again to release him.', seconds: 8 },
        tut('await', 'released'),
      ],
      until: { signal: 'released' },
    },
    {
      id: 'capture',
      title: 'The Yard',
      start: [
        { do: 'done', id: 'release' },
        cut('y.capture'),
        { do: 'release', tag: 'b' },
        tut('yield', 'b'),
        { do: 'objective', id: 'capture', text: 'Capture a man from the shed', at: 'shed' },
        { do: 'hint', text: 'Kill one at the shed, let the last surrender, then HOLD {interact} on him to cuff him.', seconds: 10 },
      ],
      until: { event: 'prisoner:secured' },
    },

    // The finale.
    {
      id: 'balcony',
      title: 'Graduation',
      checkpoint: at('stairs', YARD_KIT),
      start: [
        { do: 'done', id: 'capture' },
        cut('y.paid'),
        tut('yield', 'off'),
        tut('town', names('town', 20)),
        say('n.balcony'),
        { do: 'objective', id: 'balcony', text: 'Go up to the balcony', at: 'balcony' },
      ],
      until: { zone: 'balcony' },
    },
    {
      id: 'nuke',
      title: 'Graduation',
      start: [
        { do: 'done', id: 'balcony' },
        cut('n.capable'),
        say('n.access'),
        { do: 'callins', held: false },
        tut('callin', 'nuke'),
        { do: 'objective', id: 'nuke', text: 'Call it in', at: 'townCenter' },
        { do: 'hint', text: '{callinNuke} to aim the Tactical Nuke, click to confirm.', seconds: 12 },
      ],
      cues: [{ when: { after: 9 }, run: [say('n.fraction')] }],
      until: { event: 'callin:used', where: { id: 'nuke' } },
    },
    {
      id: 'after',
      title: 'Graduation',
      start: [
        { do: 'done', id: 'nuke' },
        cut('n.anywhere'),
        { do: 'wait', seconds: 9 },
        say('n.after'),
        { do: 'wait', seconds: 3 },
        tut('home'),
        say('n.door'),
        { do: 'objective', id: 'leave', text: 'Leave through the door', at: 'exitTarget' },
      ],
      // Nothing in the mission ends it: the door does (retraining.ts), through the menu, so no mission-complete screen comes up.
      until: { signal: 'never' },
    },
  ],
};
