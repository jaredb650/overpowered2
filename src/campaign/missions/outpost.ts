/**
 * The Outpost: docs/campaign/MISSION.md as rows. Beat ids are the ones the plan uses and `?beat=` takes. A beat here is complete for
 * the runner today: what it cannot do yet, such as a tank, falls back in the host and the mission still plays start to end.
 */
import type { Beat, Loadout, Mission, Step } from '../types';
import { OUTPOST_LINES } from './outpost.lines';
import { DOORS, MARKS, ROUTES, ZONES } from './outpost.places';

const say = (id: string, wait = false): Step => ({ do: 'say', line: `mission.${id}`, wait });
const commander = (id: string, wait = false): Step => say(`cmd.${id}`, wait);
const council = (id: string, wait = false): Step => say(`council.${id}`, wait);
const pilot = (id: string, wait = false): Step => say(`radio.${id}`, wait);

/** The kit a checkpoint promises, as the player gets further. */
const KIT = {
  issued: { weapons: ['smg', 'sword'], grenades: 0 },
  shotgun: { weapons: ['smg', 'shotgun', 'sword'], grenades: 2 },
  launcher: { weapons: ['rocket', 'smg', 'shotgun', 'sword'], grenades: 2 },
  raid: { weapons: ['smg', 'shotgun', 'rocket', 'sword'], grenades: 3 },
  full: { weapons: ['smg', 'shotgun', 'rocket', 'autocannon', 'sword'], grenades: 3 },
} as const satisfies Record<string, Loadout>;

/** The armour that is on the apron from the heavy assault on. `ensure` brings it back after a restart, and leaves it alone otherwise. */
const ARMOUR: readonly Step[] = [
  { do: 'vehicle', tag: 'heavy.tank1', kind: 'tank', at: 'eastEdge', route: 'tankEast', ensure: true },
  { do: 'vehicle', tag: 'heavy.tank2', kind: 'tank', at: 'westEdge', route: 'tankWest', ensure: true },
];

const BEATS: readonly Beat[] = [
  {
    id: 'briefing',
    title: 'Notice of Extermination',
    start: [
      { do: 'music', state: 'menu' },
      council('brief.line'),
      council('brief.breach'),
      council('brief.officer'),
      council('brief.task'),
      council('brief.previous'),
      council('brief.thanks'),
      { do: 'cutscene', id: 'briefing' },
      { do: 'signal', name: 'briefed' },
    ],
    until: { signal: 'briefed' },
  },
  {
    id: 'insertion',
    title: 'Door gunner',
    start: [
      { do: 'music', state: 'easy' },
      { do: 'threat', level: 1 },
      { do: 'objective', id: 'mission', text: 'Remove the Commander' },
      pilot('in.wire'),
      { do: 'squad', tag: 'in.wall', men: ['trooper', 'trooper', 'brute', 'trooper'], at: 'wallWest', orders: 'hold' },
      { do: 'squad', tag: 'in.apron', men: ['trooper', 'gunner', 'trooper', 'gunner', 'trooper', 'trooper'], at: 'apronEast' },
      { do: 'ride', seat: 'doorGunner', route: 'insertion' },
      // The men the door gun did not reach have gone to ground. On foot, the player starts against four, not a garrison.
      { do: 'sweep' },
      { do: 'signal', name: 'landed' },
    ],
    cues: [
      { when: { any: [{ kills: 1 }, { after: 8 }] }, run: [commander('in.hello')] },
      {
        when: { any: [{ signal: 'ride:fly2' }, { after: 22 }] },
        run: [
          commander('in.door'),
          { do: 'squad', tag: 'in.yard', men: ['trooper', 'gunner', 'trooper', 'warden'], at: 'yardWest' },
          { do: 'squad', tag: 'in.road', men: ['trooper', 'trooper', 'gunner', 'trooper'], at: 'guardPost' },
        ],
      },
      {
        when: { any: [{ signal: 'ride:fly3' }, { after: 50 }] },
        run: [pilot('in.armour'), commander('in.tank'), { do: 'squad', tag: 'in.ring', men: ['trooper', 'rocketeer', 'trooper', 'trooper'], at: 'ringEast' }],
      },
      {
        when: { any: [{ signal: 'ride:fly5' }, { after: 80 }] },
        run: [{ do: 'squad', tag: 'in.north', men: ['trooper', 'brute', 'trooper', 'gunner', 'trooper'], at: 'ringWest' }],
      },
      { when: { any: [{ signal: 'ride:fly8' }, { after: 120 }] }, run: [pilot('in.missile'), commander('in.talk')] },
    ],
    until: { signal: 'landed' },
  },
  {
    id: 'lockout',
    title: 'Locked out',
    checkpoint: { at: 'lz', loadout: KIT.issued },
    start: [
      { do: 'threat', level: 1 },
      pilot('in.rental'),
      { do: 'objective', id: 'gate', text: 'Get to the main gate', at: 'gateMouth' },
      { do: 'hint', text: 'Jump at the wall and hold {forward} to climb it.', seconds: 9 },
      { do: 'squad', tag: 'lz.rim', men: ['trooper', 'gunner', 'trooper', 'brute'], at: 'lzRim' },
      { do: 'drop', item: 'health', at: 'lzHealth' },
    ],
    cues: [
      { when: { zone: 'lzCut', outside: true }, run: [commander('lz.file')] },
      // Only a strafe-jump at the top of its speed beats the gate. The story needs them outside it.
      { when: { zone: 'gateYard' }, run: [{ do: 'place', at: 'gateMouth' }] },
      {
        when: { zone: 'gateApproach' },
        run: [
          commander('lz.gate'),
          // Timed from the trigger: shut before a run with both dashes gets there.
          { do: 'door', door: 'mainGate', open: 0, seconds: 1, wait: true },
          commander('lz.hours', true),
          { do: 'done', id: 'gate' },
          commander('lz.trucks'),
          council('lz.account'),
          { do: 'signal', name: 'gateShut' },
        ],
      },
    ],
    until: { signal: 'gateShut' },
  },
  {
    id: 'softskins',
    title: 'Reinforcements',
    checkpoint: { at: 'gateMouth', loadout: KIT.issued },
    start: [
      { do: 'threat', level: 2 },
      { do: 'objective', id: 'trucks', text: 'Stop the reinforcements' },
      commander('soft.east'),
      { do: 'rack', weapon: 'shotgun', at: 'shotgunCrate' },
      { do: 'rack', weapon: 'judge', at: 'pumpRoof', optional: true },
      { do: 'drop', item: 'ammo', at: 'guardAmmo' },
      { do: 'vehicle', tag: 'soft.truck1', kind: 'humvee', at: 'eastEdge', route: 'eastRoad', crew: ['trooper', 'gunner', 'trooper'], crewTag: 'soft.first' },
      { do: 'wait', seconds: 4 },
      { do: 'vehicle', tag: 'soft.truck2', kind: 'truck', at: 'eastEdge', route: 'eastRoad', crew: ['trooper', 'trooper', 'brute', 'trooper', 'gunner'], crewTag: 'soft.first' },
      { do: 'squad', tag: 'soft.tower', men: ['brute'], at: 'towerTwo', orders: 'hold' },
    ],
    cues: [
      { when: { kills: 1, tag: 'soft.first' }, run: [commander('soft.driver')] },
      { when: { kills: 3, tag: 'soft.first' }, run: [commander('soft.left')] },
      { when: { after: 22 }, run: [commander('soft.tower')] },
      { when: { event: 'weapon:unlocked', where: { weapon: 'shotgun' } }, run: [{ do: 'grenades', count: 2 }, { do: 'hint', text: 'Shotguns end arguments at door range. {grenade} throws what you found with it.' }] },
      {
        when: { left: 2, tag: 'soft.first' },
        run: [
          commander('soft.west'),
          { do: 'vehicle', tag: 'soft.truck3', kind: 'humvee', at: 'westEdge', route: 'westRoad', crew: ['trooper', 'gunner', 'trooper', 'trooper'], crewTag: 'soft.second' },
          { do: 'wait', seconds: 3 },
          { do: 'vehicle', tag: 'soft.truck4', kind: 'truck', at: 'westEdge', route: 'westRoad', crew: ['trooper', 'gunner', 'rocketeer', 'trooper'], crewTag: 'soft.second' },
          { do: 'signal', name: 'secondWave' },
        ],
      },
    ],
    until: { all: [{ signal: 'secondWave' }, { cleared: ['soft.first', 'soft.second'] }] },
  },
  {
    id: 'breather',
    title: 'Breather',
    checkpoint: { at: 'apronRally', loadout: KIT.shotgun },
    start: [
      { do: 'done', id: 'trucks' },
      { do: 'music', state: 'easy' },
      commander('soft.names'),
      council('soft.receipts'),
      { do: 'adapt' },
      { do: 'drop', item: 'armor', at: 'apronAmmoWest' },
      { do: 'drop', item: 'ammo', at: 'apronAmmoEast' },
    ],
    until: { after: 18 },
  },
  {
    id: 'heavy',
    title: 'The heavy assault',
    checkpoint: { at: 'apronRally', loadout: KIT.shotgun },
    start: [
      { do: 'threat', level: 4 },
      { do: 'music', state: 'hard' },
      commander('heavy.roll'),
      { do: 'banner', text: 'ARMOUR', sub: 'east road' },
      { do: 'vehicle', tag: 'heavy.tank1', kind: 'tank', at: 'eastEdge', route: 'tankEast' },
      { do: 'vehicle', tag: 'heavy.truck1', kind: 'humvee', at: 'westEdge', route: 'westRoad', crew: ['trooper', 'gunner', 'trooper', 'trooper'], crewTag: 'heavy.men' },
      { do: 'squad', tag: 'heavy.towers', men: ['brute', 'sniper'], at: 'towerOne', orders: 'hold' },
      { do: 'wait', seconds: 6 },
      commander('heavy.look'),
      { do: 'wait', seconds: 10 },
      { do: 'vehicle', tag: 'heavy.tank2', kind: 'tank', at: 'westEdge', route: 'tankWest' },
    ],
    cues: [
      { when: { event: 'weapon:fired' }, run: [{ do: 'wait', seconds: 6 }, commander('heavy.knock')] },
      {
        when: { after: 26 },
        run: [
          council('heavy.salvage'),
          { do: 'objective', id: 'wreck', text: 'Find the old contractor\'s wreck', at: 'wreckFoot' },
          { do: 'signal', name: 'toldOfWreck' },
        ],
      },
      { when: { all: [{ signal: 'toldOfWreck' }, { zone: 'easternApron' }] }, run: [commander('heavy.buried')] },
    ],
    until: { all: [{ signal: 'toldOfWreck' }, { zone: 'easternApron' }] },
  },
  {
    id: 'wreck',
    title: 'The wreck',
    checkpoint: { at: 'wreckFoot', loadout: KIT.shotgun },
    start: [
      ...ARMOUR,
      { do: 'squad', tag: 'wreck.guard', men: ['trooper', 'gunner', 'trooper'], at: 'apronEast' },
      { do: 'hint', text: 'Too high for one jump. Stand close, press {jump} twice, and hold {forward} to catch the edge.', seconds: 10 },
      { do: 'rack', weapon: 'rocket', at: 'rocketRack' },
      { do: 'drop', item: 'ammo', at: 'wreckAmmo' },
    ],
    cues: [
      { when: { zone: 'wreckDeck' }, run: [commander('wreck.boots'), { do: 'done', id: 'wreck' }] },
    ],
    until: { signal: 'took:rocket' },
  },
  {
    id: 'turn',
    title: 'Turning it round',
    checkpoint: { at: 'wreckDeck', loadout: KIT.launcher },
    start: [
      ...ARMOUR,
      { do: 'objective', id: 'armour', text: 'Destroy the armour' },
      commander('wreck.changes'),
      council('wreck.balance'),
      { do: 'hint', text: 'Rockets go through armour on a direct hit. The blast beside it does little. Hit the tracks or the hull.', seconds: 10 },
      { do: 'field', answer: 'spread' },
      commander('turn.spread'),
    ],
    cues: [
      { when: { kills: 1, tag: 'heavy.tank1' }, run: [commander('turn.forty')] },
      {
        when: { any: [{ cleared: 'heavy.tank1' }, { cleared: 'heavy.tank2' }] },
        run: [
          commander('turn.bird'),
          { do: 'vehicle', tag: 'turn.chopper', kind: 'chopper', at: 'skyNorth', route: 'chopper' },
          { do: 'vehicle', tag: 'turn.truck', kind: 'humvee', at: 'eastEdge', route: 'eastRoad', crew: ['trooper', 'trooper', 'gunner', 'warden'], crewTag: 'turn.men' },
        ],
      },
      { when: { kills: 1, tag: 'turn.chopper' }, run: [commander('turn.form')] },
      {
        when: { cleared: ['heavy.tank1', 'heavy.tank2', 'turn.chopper'] },
        run: [
          { do: 'done', id: 'armour' },
          commander('turn.bulwark'),
          { do: 'objective', id: 'bulwark', text: 'Destroy Bulwark in the gate', at: 'gateMouth' },
          { do: 'door', door: 'mainGate', open: 0.6 },
          { do: 'vehicle', tag: 'turn.bulwark', kind: 'tank', at: 'gateInside', route: 'gateTank', holds: 'gateHold' },
          { do: 'drop', item: 'ammo', at: 'gateAmmo' },
        ],
      },
    ],
    until: { cleared: 'turn.bulwark' },
  },
  {
    id: 'breach',
    title: 'The breach',
    checkpoint: { at: 'gateMouth', loadout: KIT.launcher },
    start: [
      { do: 'done', id: 'bulwark' },
      commander('turn.jammed'),
      council('turn.fine'),
      { do: 'threat', level: 5 },
      { do: 'objective', id: 'citadel', text: 'Get inside the citadel', at: 'sallyHall' },
      { do: 'squad', tag: 'breach.west', men: ['trooper', 'brute', 'trooper'], at: 'sandbagsWest', orders: 'hold' },
      { do: 'squad', tag: 'breach.east', men: ['gunner', 'trooper', 'riot'], at: 'sandbagsEast', orders: 'hold' },
    ],
    cues: [
      { when: { zone: 'gateYard' }, run: [{ do: 'release', tag: 'breach.west' }, { do: 'release', tag: 'breach.east' }] },
      {
        when: { zone: 'blastLine' },
        run: [
          commander('breach.seal'),
          { do: 'hint', text: 'It will not wait. Run at it and press {slide}.', seconds: 6 },
          { do: 'door', door: 'blastDoor', open: 0 },
          { do: 'signal', name: 'sealing' },
        ],
      },
      // They still have men out here, so it comes up again: only as far as a body on the floor, so the lesson stands.
      {
        when: { all: [{ signal: 'sealing' }, { after: 9 }] },
        repeat: true,
        run: [{ do: 'door', door: 'blastDoor', open: 0.4, seconds: 1.2 }, { do: 'wait', seconds: 4 }, { do: 'door', door: 'blastDoor', open: 0, seconds: 1.2 }],
      },
    ],
    until: { zone: 'sallyHall' },
  },
  {
    id: 'barracks',
    title: 'The barracks',
    checkpoint: { at: 'sallyHall', loadout: KIT.raid },
    start: [
      { do: 'done', id: 'citadel' },
      { do: 'door', door: 'blastDoor', open: 0, seconds: 0.2 },
      { do: 'sweep' },
      commander('breach.under'),
      commander('breach.locked', true),
      { do: 'call', name: 'lights', arg: 'emergency' },
      commander('bar.lights', true),
      { do: 'wait', seconds: 2 },
      { do: 'door', door: 'sallyWest', open: 1 },
      { do: 'objective', id: 'way', text: 'Find a way through the block' },
      { do: 'field', answer: 'crossfire' },
      { do: 'squad', tag: 'bar.pin', men: ['brute', 'trooper', 'trooper'], at: 'corridorMg', orders: 'hold' },
      { do: 'squad', tag: 'bar.flank', men: ['trooper', 'gunner', 'gunner', 'trooper'], at: 'northCorridorEast', orders: 'hold' },
      { do: 'squad', tag: 'bar.bunks', men: ['gunner', 'riot', 'trooper'], at: 'bunkFour', orders: 'hold' },
      { do: 'drop', item: 'health', at: 'barracksHealth' },
    ],
    cues: [
      {
        when: { zone: 'southCorridor' },
        run: [
          commander('bar.circle'),
          { do: 'release', tag: 'bar.pin' },
          { do: 'wait', seconds: 3 },
          commander('bar.pin'),
          { do: 'release', tag: 'bar.flank' },
        ],
      },
      { when: { zone: 'bunks' }, run: [{ do: 'release', tag: 'bar.bunks' }] },
    ],
    until: { all: [{ cleared: ['bar.pin', 'bar.flank', 'bar.bunks'] }, { zone: 'northCorridor' }] },
  },
  {
    id: 'coolant',
    title: 'The bridge that went',
    checkpoint: { at: 'coolantNear', loadout: KIT.raid },
    start: [
      commander('bar.tired'),
      { do: 'adapt' },
      { do: 'objective', id: 'across', text: 'Cross the Coolant Hall' },
      { do: 'squad', tag: 'cool.sniper', men: ['sniper'], at: 'coolantFar', orders: 'hold' },
      { do: 'drop', item: 'armor', at: 'coolantArmor' },
    ],
    cues: [
      {
        when: { zone: 'coolantNear' },
        run: [
          commander('cool.audit', true),
          { do: 'release', tag: 'cool.sniper' },
          council('cool.dash'),
          { do: 'hint', text: 'Run, jump, jump again, and at the top of it press {dash}.', seconds: 10 },
        ],
      },
    ],
    until: { zone: 'coolantFar' },
  },
  {
    id: 'gallery',
    title: 'The cable gallery',
    checkpoint: { at: 'galleryNear', loadout: KIT.raid },
    start: [
      { do: 'done', id: 'across' },
      { do: 'objective', id: 'gallery', text: 'Cross the cable gallery' },
      commander('gal.walkway', true),
      council('gal.walls'),
      { do: 'hint', text: 'Jump at the lit wall on a shallow line and keep {forward} held. Press {jump} to leave it, then {jump} again.', seconds: 12 },
    ],
    until: { zone: 'galleryFar' },
  },
  {
    id: 'mess',
    title: 'The mess hall',
    checkpoint: { at: 'galleryFar', loadout: KIT.raid },
    start: [
      { do: 'done', id: 'gallery' },
      commander('gal.what'),
      { do: 'threat', level: 6 },
      { do: 'field', answer: 'hiders' },
      { do: 'objective', id: 'mess', text: 'Get through the mess hall' },
      { do: 'squad', tag: 'mess.floor', men: ['trooper', 'gunner', 'trooper', 'gunner'], at: 'messFloor', orders: 'hold' },
      { do: 'squad', tag: 'mess.west', men: ['trooper', 'trooper', 'brute'], at: 'messWest', orders: 'hold' },
      { do: 'squad', tag: 'mess.east', men: ['riot', 'gunner', 'trooper'], at: 'messEast', orders: 'hold' },
      { do: 'rack', weapon: 'kiln', at: 'kilnRack', optional: true },
    ],
    cues: [
      { when: { zone: 'messHall' }, run: [commander('mess.hold', true), { do: 'wait', seconds: 5 }, commander('mess.now'), { do: 'release', tag: 'mess.floor' }, { do: 'release', tag: 'mess.west' }, { do: 'release', tag: 'mess.east' }] },
    ],
    until: { cleared: ['mess.floor', 'mess.west', 'mess.east'] },
  },
  {
    id: 'armoury',
    title: 'The armoury',
    checkpoint: { at: 'armoury', loadout: KIT.raid },
    start: [
      { do: 'done', id: 'mess' },
      commander('mess.yesterday'),
      { do: 'music', state: 'easy' },
      { do: 'objective', id: 'arm', text: 'Take the autocannon', at: 'autocannonRack' },
      { do: 'rack', weapon: 'autocannon', at: 'autocannonRack' },
      { do: 'drop', item: 'health', at: 'armouryHealth' },
      { do: 'drop', item: 'armor', at: 'armouryArmor' },
      { do: 'adapt' },
    ],
    cues: [
      { when: { signal: 'took:autocannon' }, run: [{ do: 'done', id: 'arm' }, commander('arm.mine'), council('arm.take', true), { do: 'wait', seconds: 4 }, { do: 'signal', name: 'armed' }] },
    ],
    until: { signal: 'armed' },
  },
  {
    id: 'plates',
    title: 'Second Platoon',
    checkpoint: { at: 'armoury', loadout: KIT.full },
    start: [
      { do: 'threat', level: 7 },
      { do: 'music', state: 'hard' },
      commander('plate.walk'),
      { do: 'door', door: 'armourySouth', open: 1 },
      { do: 'door', door: 'sallyEast', open: 1 },
      { do: 'objective', id: 'plates', text: 'Break Second Platoon' },
      { do: 'hint', text: 'Plate shrugs off a blast. Put the rocket on the man in plate, and let the blast take the ones beside him.', seconds: 10 },
      { do: 'squad', tag: 'plate.front', men: ['brute', 'brute'], at: 'plateWest' },
      { do: 'squad', tag: 'plate.back', men: ['sniper', 'sniper', 'warden', 'sniper'], at: 'plateWest' },
      { do: 'wait', seconds: 12 },
      { do: 'squad', tag: 'plate.round', men: ['brute', 'trooper', 'gunner'], at: 'guardRoom' },
    ],
    cues: [
      { when: { kills: 1, tag: 'plate.front' }, run: [commander('plate.cost')] },
      { when: { cleared: ['plate.front', 'plate.back', 'plate.round'] }, run: [{ do: 'done', id: 'plates' }, commander('plate.report', true), { do: 'signal', name: 'platoonGone' }] },
    ],
    until: { signal: 'platoonGone' },
  },
  {
    id: 'stack',
    title: 'The Stack',
    checkpoint: { at: 'stackFloor', loadout: KIT.full },
    start: [
      { do: 'threat', level: 8 },
      { do: 'objective', id: 'climb', text: 'Climb the Stack', at: 'warRoomDoor' },
      commander('stack.above'),
      { do: 'squad', tag: 'stack.base', men: ['trooper', 'gunner', 'trooper'], at: 'stackBase' },
      { do: 'squad', tag: 'stack.lower', men: ['trooper', 'brute', 'rocketeer', 'trooper'], at: 'stackLower', orders: 'hold' },
      { do: 'squad', tag: 'stack.upper', men: ['sniper', 'trooper', 'gunner', 'riot'], at: 'stackUpper', orders: 'hold' },
      { do: 'drop', item: 'health', at: 'stackHealth' },
    ],
    cues: [
      { when: { after: 15 }, run: [commander('stack.posts')] },
      { when: { after: 45 }, run: [commander('stack.pension')] },
      { when: { left: 1, tag: 'stack.base' }, run: [{ do: 'release', tag: 'stack.lower' }] },
      { when: { left: 2, tag: 'stack.lower' }, run: [{ do: 'release', tag: 'stack.upper' }] },
    ],
    until: { zone: 'stackTop' },
  },
  {
    id: 'commander',
    title: 'The Commander',
    checkpoint: { at: 'warRoomDoor', loadout: KIT.full },
    start: [
      { do: 'threat', level: 9 },
      { do: 'done', id: 'climb' },
      commander('boss.stores'),
      { do: 'boss', tag: 'commander', at: 'warRoom' },
      { do: 'drop', item: 'ammo', at: 'roofAmmo' },
      { do: 'drop', item: 'health', at: 'roofHealth' },
    ],
    cues: [
      {
        when: { below: 0.6, tag: 'commander' },
        run: [
          { do: 'door', door: 'warRoomStairs', open: 1 },
          { do: 'call', name: 'commanderToRoof', arg: 'roofMast' },
          commander('boss.roof'),
          { do: 'squad', tag: 'boss.west', men: ['trooper', 'gunner', 'trooper'], at: 'roofWest' },
          { do: 'squad', tag: 'boss.east', men: ['trooper', 'rocketeer', 'trooper'], at: 'roofEast' },
        ],
      },
      { when: { below: 0.25, tag: 'commander' }, run: [council('boss.hours')] },
    ],
    until: { cleared: 'commander' },
  },
  {
    id: 'ending',
    title: 'Notice of Completion',
    start: [
      { do: 'done', id: 'mission' },
      { do: 'music', state: 'menu' },
      // His last words and the Council's receipt have the box to themselves.
      { do: 'wait', seconds: 8 },
      council('end.complete'),
      council('end.fee'),
      pilot('end.walk'),
      council('end.retained'),
      { do: 'cutscene', id: 'ending' },
      { do: 'finish' },
    ],
  },
];

export const OUTPOST: Mission = {
  id: 'outpost',
  title: 'The Outpost',
  loadout: KIT.issued,
  zones: ZONES,
  marks: MARKS,
  routes: ROUTES,
  doors: DOORS,
  cutscenes: {
    // Down through the cloud to the compound, then along the gate, while the Council reads the notice.
    briefing: {
      shots: [
        { from: [240, 150, 240], to: [150, 90, 170], lookFrom: [0, 0, -30], lookTo: [0, 4, -30], seconds: 16 },
        { from: [-90, 34, 58], to: [20, 30, 50], lookFrom: [-20, 6, 12], lookTo: [0, 6, 12], seconds: 14 },
        { from: [0, 40, -100], to: [0, 24, -96], lookFrom: [0, 14, -70], lookTo: [0, 16, -70], seconds: 12 },
        { from: [-12, 22, -74], to: [-4, 18, -72], lookFrom: [0, 12, -70], lookTo: [0, 12, -70], seconds: 10 },
      ],
    },
    // From the roof, over the burning apron and up.
    ending: {
      shots: [
        { from: [0, 18, -34], to: [0, 30, -10], lookFrom: [0, 4, 30], lookTo: [0, 0, 50], seconds: 12 },
        { from: [0, 30, -10], to: [0, 70, 30], lookFrom: [0, 0, 50], lookTo: [0, 0, 20], seconds: 12 },
      ],
    },
  },
  lines: OUTPOST_LINES,
  redeployLines: ['mission.council.redeploy.fee', 'mission.cmd.redeploy.another', 'mission.council.redeploy.keep', 'mission.cmd.redeploy.told'],
  beats: BEATS,
};
