/**
 * Foreclosure, mission 2: the sixteen beats of docs/proposals/mission-2-plan.md as rows, built so far as its skeleton (stage 6).
 * docs/campaign/FORECLOSURE.md says what is real and what stands in. Beat ids are the plan's, and `?beat=` takes them.
 *
 * Every beat runs end to end with stand-ins: a small squad or two where the plan has a fight, a tank for Grandad and for Old Mother,
 * and the `frame` steps answered by a banner until the Frame (src/frame) provides them.
 *
 * The places are Holdfast's (src/world/map/holdfast), by name in `foreclosure.places.ts`.
 */
import type { AllyType } from '../../allies/data';
import type { EnemyId } from '../../core/gameplay';
import type { Beat, Cue, Loadout, Mission, Step } from '../types';
import { CALLS, FORECLOSURE_LINES, FRONTS } from './foreclosure.lines';
import { BATTLES, MARKS, OVERWATCH, ROUTES, SKY_ROUTES, ZONES } from './foreclosure.places';

const say = (id: string, wait = false): Step => ({ do: 'say', line: `mission.foreclosure.${id}`, wait });
const council = (id: string, wait = false): Step => say(`council.${id}`, wait);
const harbour = (id: string, wait = false): Step => say(`harbour.${id}`, wait);
const radio = (id: string, wait = false): Step => say(`radio.${id}`, wait);

/** The kit a checkpoint promises. Start: SMG, shotgun, sword, 2 grenades. Satchels on the flats, launcher at the wall, Thresher at the quay. */
const KIT = {
  issued: { weapons: ['smg', 'shotgun', 'sword'], grenades: 2 },
  satchel: { weapons: ['smg', 'shotgun', 'satchel', 'sword'], grenades: 2 },
  launcher: { weapons: ['smg', 'shotgun', 'rocket', 'sword'], grenades: 2 },
  quay: { weapons: ['smg', 'thresher', 'rocket', 'sword'], grenades: 3 },
  deck: { weapons: ['smg', 'thresher', 'rocket', 'autocannon', 'sword'], grenades: 3 },
} as const satisfies Record<string, Loadout>;

/** The 14th Recoveries: six land, one is lost in the market, one in the stacks, and four hold the Slip. */
const FOURTEENTH = ['rifleman', 'gunner', 'rifleman', 'medic', 'rocketeer', 'shotgunner'] as const;
const squadOf = (n: number, at: string): Step => ({ do: 'roster', men: FOURTEENTH.slice(0, n), at });

/** Another squad's fight beside the player's (src/campaign/war.ts): its Bailiffs at `at`, the militia across at `from` (BATTLES). */
const battle = (id: keyof typeof BATTLES, bailiffs: readonly AllyType[], militia: readonly EnemyId[], ensure = false): Step => ({
  do: 'battle', id, bailiffs, at: BATTLES[id]!.at, militia, from: BATTLES[id]!.from, ensure,
});
/** The squad under the wall east of the gate, from the wall to the Square. */
const EAST_STREET = battle('eastStreet', ['rifleman', 'gunner', 'rocketeer'], ['trooper', 'gunner'], true);
/** The militia coming back at a battle each time it is cleared: its counter-attack, booked under the battle so the war holds it there. */
const counter = (id: keyof typeof BATTLES, men: readonly EnemyId[]): Cue => ({
  when: { left: 0, tag: id }, repeat: true, run: [{ do: 'squad', tag: id, men, at: BATTLES[id]!.from, orders: 'hold' }],
});
/** A squad, held on its mark until shot at or walked up on, put back after a restart. */
const posted = (tag: string, men: readonly EnemyId[], at: string): Step => ({ do: 'squad', tag, men, at, orders: 'hold', ensure: true });
/** A militiaman on a mounted gun: the man and the gun (`spec.emplacements` index: the wall guns 0 and 1, the roof guns 2 and 3). */
const gunner = (tag: string, at: string, gun: number): Step[] => [posted(tag, ['gunner'], at), { do: 'call', name: 'crew', arg: `${tag}:${gun}` }];
/** The two technicals, on their tracks from the flats' edge to the gate, crew out at the end. */
const TECHNICALS: readonly Step[] = [
  { do: 'vehicle', tag: 'technical.west', kind: 'humvee', at: 'techW0', route: 'technicalWest', crew: ['trooper', 'gunner'], crewTag: 'technical.crew', ensure: true },
  { do: 'vehicle', tag: 'technical.east', kind: 'humvee', at: 'techE0', route: 'technicalEast', crew: ['trooper', 'rocketeer'], crewTag: 'technical.crew', ensure: true },
];

/** A beat in the Frame starts in a fresh one, so a restart gets one. */
const inFrame = (at: string): Step => ({ do: 'frame', act: 'board', at });
const REPLACEMENT = ['mission.foreclosure.council.replacement'];

const BEATS: readonly Beat[] = [
  {
    id: 'briefing',
    title: 'Notice of Foreclosure',
    start: [
      { do: 'music', state: 'menu' },
      // The Outpost's recorded take, by its id.
      { do: 'say', line: 'mission.council.brief.line' },
      council('brief.form'),
      council('brief.objection'),
      council('brief.frame'),
      { do: 'cutscene', id: 'briefing' },
      { do: 'signal', name: 'briefed' },
    ],
    until: { signal: 'briefed' },
  },
  {
    id: 'overwatch',
    title: 'Overwatch',
    // A restart here is another go in the gunship, not another sitting through the notice.
    checkpoint: { at: 'lz', loadout: KIT.issued },
    start: [
      { do: 'music', state: 'hard' },
      { do: 'threat', level: 1 },
      { do: 'objective', id: 'mission', text: 'Foreclose on Holdfast' },
      { do: 'objective', id: 'cover', text: 'Cover the 14th\'s landing', at: 'lz' },
      squadOf(6, 'lz'),
      // The second stick, fighting into the east shanties beside the first.
      battle('flats', ['rifleman', 'gunner', 'medic'], ['trooper', 'gunner']),
      // Out of the shanties at the LZ, in the open: the first thing under the crosshair.
      { do: 'squad', tag: 'ow.rush', men: ['trooper', 'trooper', 'gunner', 'rocketeer'], at: 'openGround' },
      ...gunner('ow.roofWest', 'roofGunWest', 2),
      ...gunner('ow.roofEast', 'roofGunEast', 3),
      // The anti-air: a rocketeer at each end of the flats, hunting the gunship (callins/antiAir.ts).
      posted('ow.aaWest', ['rocketeer'], 'aaWest'),
      posted('ow.aaEast', ['rocketeer'], 'aaEast'),
      ...TECHNICALS,
      // A trench for the white phosphorus, and the fuel farm with men round it for the glide bomb.
      posted('ow.trench', ['trooper', 'trooper', 'trooper'], 'trench'),
      posted('ow.fuel', ['trooper', 'rocketeer', 'trooper'], 'fuelDepot'),
      harbour('wave'),
      radio('cover'),
      council('lease'),
      { do: 'hint', text: 'The anti-air locks on with a rising tone: {jump} throws flares.', seconds: 8 },
      { do: 'call', name: 'fc.sappers', arg: 'barracks:barracks.flats,barracks.shantiesWest,barracks.shantiesEast,barracks.shantiesNorth' },
      { do: 'sortie', over: OVERWATCH.over },
      { do: 'done', id: 'cover' },
      radio('lease'),
      { do: 'signal', name: 'landed' },
    ],
    cues: [
      { when: { after: 22 }, run: [harbour('stove')] },
      { when: { after: 50 }, run: [harbour('lock')] },
      // The shanties keep coming while the gunship is up: more men in the open, and a hunter for every one shot off the anti-air.
      { when: { left: 1, tag: 'ow.rush' }, repeat: true, run: [{ do: 'squad', tag: 'ow.rush', men: ['trooper', 'gunner', 'trooper'], at: 'outerShacks' }] },
      { when: { left: 0, tag: 'ow.trench' }, repeat: true, run: [{ do: 'squad', tag: 'ow.trench', men: ['trooper', 'trooper', 'rocketeer'], at: 'trench', orders: 'hold' }] },
      { when: { left: 0, tag: 'ow.aaEast' }, repeat: true, run: [{ do: 'squad', tag: 'ow.aaEast', men: ['rocketeer', 'trooper'], at: 'aaEast', orders: 'hold' }] },
      counter('flats', ['trooper', 'gunner']),
    ],
    until: { signal: 'landed' },
  },
  {
    id: 'landing',
    title: 'The Flats',
    checkpoint: { at: 'lz', loadout: KIT.issued },
    start: [
      { do: 'music', state: 'hard' },
      { do: 'threat', level: 2 },
      // The gunship's far targets are not the landing's fight, and the draw budget wants their bodies back.
      { do: 'sweep', tag: 'ow.fuel' },
      { do: 'sweep', tag: 'ow.aaWest' },
      { do: 'sweep', tag: 'ow.aaEast' },
      squadOf(6, 'lz'),
      battle('flats', ['rifleman', 'gunner', 'medic'], ['trooper', 'gunner'], true),
      { do: 'rack', weapon: 'satchel', at: 'satchelRack' },
      { do: 'call', name: 'fc.sappers', arg: 'barracks:barracks.flats,barracks.shantiesWest,barracks.shantiesEast,barracks.shantiesNorth' },
      { do: 'objective', id: 'shanties', text: 'Clear the outer shanties & demolish the Flats Barracks', at: 'outerShacks' },
      harbour('landing'),
      council('satchel'),
      { do: 'hint', text: 'Grab Satchel Charges at the LZ (Slot 3: LMB throws, RMB detonates) to level garrison barracks. Tap {interact} on Bailiffs for squad orders.', seconds: 10 },
      ...TECHNICALS,
      posted('shacks', ['trooper', 'gunner', 'trooper', 'rocketeer'], 'outerShacks'),
      // In the shack, behind boards: one satchel or rocket flattens the shack and him in it.
      posted('sniper', ['sniper'], 'sniperShack'),
    ],
    cues: [
      { when: { after: 10 }, run: [harbour('barracks.flats')] },
      // The sniper's first round puts one of the six down: the revive, taught on a man who needs it.
      {
        when: { after: 16 },
        run: [
          { do: 'call', name: 'wound', arg: 'rocketeer@sniperShack' },
          { do: 'hint', text: 'Bailiff down. Hold {interact} on him: a stim gets him up.', seconds: 9 },
          council('revive'),
        ],
      },
      counter('flats', ['trooper', 'rocketeer']),
    ],
    // Not the technicals' crews: a crew that got out before a checkpoint is not put back by `ensure` with its burnt-out technical.
    until: { cleared: ['shacks', 'sniper', 'technical.west', 'technical.east'] },
  },
  {
    id: 'wall',
    title: 'The Wall',
    checkpoint: { at: 'shanties', loadout: KIT.satchel },
    start: [
      { do: 'done', id: 'shanties' },
      { do: 'music', state: 'hard' },
      { do: 'threat', level: 3 },
      squadOf(6, 'shanties'),
      { do: 'stop', battle: 'flats' },
      { do: 'call', name: 'fc.sappers', arg: 'barracks:stop' },
      { do: 'objective', id: 'wall', text: 'Break through the wall', at: 'gate' },
      { do: 'rack', weapon: 'rocket', at: 'breachKit' },
      // The painted segment and the gate: whichever goes first, by the charge, satchels, or rockets, is the way in.
      { do: 'call', name: 'watch', arg: 'breach,gate' },
      harbour('wall'),
      // Pinned in the trench under the west wall gun, and the squad under the wall east of the gate.
      battle('westWall', ['rifleman', 'rifleman', 'medic'], ['trooper', 'rocketeer'], true),
      EAST_STREET,
      ...gunner('wallGun.west', 'wallGunWest', 0),
      ...gunner('wallGun.east', 'wallGunEast', 1),
      { do: 'hint', text: 'The launcher is on the 14th\'s breaching kit. Rockets or Satchel Charges blow the gate and wall.', seconds: 8 },
    ],
    cues: [
      // Under the wall, or after a while: a Bailiff goes for the painted segment with the charge.
      {
        when: { any: [{ zone: 'wallFoot' }, { after: 45 }] },
        run: [
          council('breach'),
          { do: 'call', name: 'charge', arg: 'breach' },
          { do: 'hint', text: 'A Bailiff is setting a charge on the painted segment. Keep him alive for ten seconds.', seconds: 8 },
        ],
      },
      counter('westWall', ['trooper', 'trooper']),
    ],
    until: { all: [{ cleared: ['wallGun.west', 'wallGun.east'] }, { signal: 'war:breached' }] },
  },
  {
    id: 'market',
    title: 'The Market',
    checkpoint: { at: 'gate', loadout: KIT.launcher },
    start: [
      { do: 'done', id: 'wall' },
      { do: 'music', state: 'hard' },
      { do: 'threat', level: 3 },
      squadOf(6, 'gate'),
      { do: 'stop', battle: 'westWall' },
      EAST_STREET,
      battle('marketCorner', ['rifleman', 'gunner', 'medic'], ['trooper', 'gunner'], true),
      { do: 'call', name: 'fc.sappers', arg: 'barracks:barracks.market' },
      { do: 'objective', id: 'square', text: 'Push through the Market to the Square', at: 'square' },
      harbour('market'),
      // Riot shields in the lane with a Warden behind them, riflemen on the roofs over it.
      posted('lanes', ['riot', 'trooper', 'riot', 'warden'], 'lanes'),
      posted('roof.west', ['trooper'], 'marketRoofWest'),
      posted('roof.north', ['sniper'], 'marketRoofNorth'),
      posted('roof.east', ['trooper'], 'marketRoofEast'),
    ],
    cues: [
      { when: { after: 8 }, run: [harbour('barracks.market')] },
      // A round off the north roof, and one of the six does not get up.
      { when: { after: 20 }, run: [{ do: 'call', name: 'lose', arg: 'shotgunner@marketRoofNorth' }, harbour('lost')] },
      { when: { after: 30 }, run: [{ do: 'squad', tag: 'lanes', men: ['brute', 'trooper'], at: 'lanes', orders: 'hold' }] },
      {
        when: { event: 'enemy:surrendered' },
        run: [
          { do: 'hint', text: 'Hands up. Walk up and {interact} to question him; hold {interact} to cuff him.', seconds: 8 },
          council('prisoners'),
        ],
      },
      counter('marketCorner', ['trooper', 'rocketeer']),
    ],
    until: { cleared: ['lanes', 'roof.west', 'roof.north', 'roof.east'] },
  },
  {
    id: 'courier',
    title: 'The Square',
    start: [
      { do: 'done', id: 'square' },
      { do: 'music', state: 'easy' },
      { do: 'stop', battle: 'eastStreet' },
      { do: 'stop', battle: 'marketCorner' },
      { do: 'call', name: 'fc.sappers', arg: 'barracks:stop' },
      { do: 'callins', held: true },
      // The breath: the 22nd hold the Square's north side while the militia regroup on Crane Street.
      battle('squareCounter', ['rifleman', 'gunner', 'medic'], ['trooper', 'trooper']),
      council('fees', true),
      { do: 'objective', id: 'courier', text: 'The Frame is coming in. Watch the north', at: 'courierWreck' },
      { do: 'call', name: 'courier', arg: 'courierWreck' },
      { do: 'call', name: 'fc.flakSalvo', arg: 'courierHit' },
    ],
    cues: [
      { when: { signal: 'war:hit' }, run: [radio('courier'), harbour('iron'), { do: 'call', name: 'fc.flakSalvo', arg: 'courierBurning' }] },
      // Then their counter-attack into the Square, as the courier burns.
      {
        when: { signal: 'war:downed' },
        run: [
          { do: 'done', id: 'courier' },
          { do: 'squad', tag: 'squareCounter', men: ['trooper', 'gunner', 'trooper', 'rocketeer'], at: 'counterMilitia', orders: 'hold' },
        ],
      },
    ],
    until: { signal: 'war:downed' },
  },
  {
    id: 'stacks',
    title: 'The Stacks',
    checkpoint: { at: 'square', loadout: KIT.launcher },
    start: [
      { do: 'music', state: 'hard' },
      { do: 'threat', level: 3 },
      { do: 'stop', battle: 'squareCounter' },
      { do: 'call', name: 'wreck', arg: 'courierWreck' },
      { do: 'call', name: 'fc.slipWreck', arg: 'doorGun' },
      squadOf(5, 'square'),
      { do: 'callins', held: true },
      battle('quayRoad', ['rifleman', 'gunner', 'medic'], ['trooper', 'gunner'], true),
      { do: 'call', name: 'fc.sappers', arg: 'barracks:barracks.stacks,barracks.cannery' },
      // Said again so a jump straight here has it. A restart has it anyway: objectives are saved with the checkpoint.
      { do: 'objective', id: 'smoke', text: 'Break through the stacks and destroy Grandad', at: 'quayRoad' },
      { do: 'rack', weapon: 'sabot', at: 'craneCab', optional: true },
      posted('stacks.aisle', ['trooper', 'gunner', 'trooper', 'rocketeer'], 'stacks'),
      posted('stacks.sniperA', ['sniper'], 'stacksSniperA'),
      posted('stacks.sniperB', ['sniper'], 'stacksSniperB'),
      { do: 'vehicle', tag: 'grandad', kind: 'tank', at: 'quayRoad', ensure: true },
      { do: 'call', name: 'mark', arg: 'grandad' },
      harbour('stacks.grandad'),
      { do: 'hint', text: 'Grandad owns the crane aisle. Flank over the stacks, satchel the barracks, or drop rockets through his roof hatch.', seconds: 9 },
    ],
    cues: [
      { when: { after: 6 }, run: [harbour('barracks.stacks')] },
      { when: { after: 11 }, run: [harbour('stacks.goggles')] },
      { when: { after: 24 }, run: [{ do: 'call', name: 'lose', arg: 'medic@stacksSniperA' }, harbour('stacks.lost')] },
      { when: { cleared: 'grandad' }, run: [harbour('grandad.down')] },
      counter('quayRoad', ['trooper', 'rocketeer']),
    ],
    until: { cleared: ['stacks.aisle', 'stacks.sniperA', 'stacks.sniperB', 'grandad'] },
  },
  {
    id: 'quay',
    title: 'The Quay',
    checkpoint: { at: 'quay', loadout: KIT.launcher },
    start: [
      { do: 'done', id: 'smoke' },
      { do: 'music', state: 'easy' },
      { do: 'stop', battle: 'quayRoad' },
      { do: 'call', name: 'fc.sappers', arg: 'barracks:stop' },
      { do: 'call', name: 'wreck', arg: 'courierWreck' },
      { do: 'call', name: 'fc.slipWreck', arg: 'doorGun' },
      squadOf(4, 'quay'),
      { do: 'callins', held: true },
      { do: 'drop', item: 'health', at: 'quayHealth' },
      { do: 'drop', item: 'armor', at: 'quayArmour' },
      { do: 'objective', id: 'thresher', text: 'Take the Thresher and drop into the Slip', at: 'thresherRack' },
      { do: 'rack', weapon: 'thresher', at: 'thresherRack' },
      council('quay.meter'),
      harbour('quay.warn'),
    ],
    until: { signal: 'took:thresher' },
  },
  {
    id: 'slip',
    title: 'The Slip',
    checkpoint: { at: 'slip', loadout: KIT.quay },
    start: [
      { do: 'done', id: 'thresher' },
      { do: 'music', state: 'hard' },
      { do: 'threat', level: 4 },
      { do: 'call', name: 'wreck', arg: 'courierWreck' },
      { do: 'call', name: 'fc.slipBoot', arg: 'ready:85' },
      squadOf(4, 'slip'),
      { do: 'callins', held: true },
      { do: 'objective', id: 'initBoot', text: 'Initiate the Distraint Frame boot sequence', at: 'frame' },
      council('slip.ready'),
      { do: 'hint', text: 'Approach the Distraint Frame in the dry dock and press {interact} to start the boot sequence.', seconds: 10 },
    ],
    cues: [
      {
        when: { signal: 'fc:bootStarted' },
        run: [
          { do: 'done', id: 'initBoot' },
          { do: 'objective', id: 'hold', text: 'Hold the Slip until the Frame finishes booting', at: 'frame' },
          council('boot'),
          { do: 'hint', text: 'The courier\'s torn-off door gun is mounted ahead. Hold the three ramps until the boot hits 100%.', seconds: 9 },
          { do: 'squad', tag: 'slip.north', men: ['trooper', 'trooper', 'gunner'], at: 'slipNorth' },
          { do: 'squad', tag: 'slip.east', men: ['trooper', 'rocketeer', 'trooper'], at: 'slipEast' },
          { do: 'squad', tag: 'slip.west', men: ['trooper', 'brute', 'gunner'], at: 'slipWest' },
        ],
      },
      {
        when: { signal: 'fc:slipWave1' },
        run: [
          harbour('slip.trucks'),
          { do: 'vehicle', tag: 'slip.tech', kind: 'humvee', at: 'slipWest', crew: ['trooper', 'gunner'], crewTag: 'slip.w2' },
          { do: 'vehicle', tag: 'slip.truck1', kind: 'truck', at: 'slipEast', crew: ['trooper', 'rocketeer'], crewTag: 'slip.w2' },
          { do: 'vehicle', tag: 'slip.truck2', kind: 'truck', at: 'slipNorth', crew: ['trooper', 'gunner'], crewTag: 'slip.w2' },
        ],
      },
      {
        when: { signal: 'fc:slipWave2' },
        run: [
          harbour('slip.ropes'),
          harbour('slip.bird'),
          { do: 'call', name: 'fc.slipWreck', arg: 'fastRope:slipNorth:doorGun' },
          { do: 'vehicle', tag: 'slip.chopper', kind: 'chopper', at: 'slipNorth' },
          { do: 'squad', tag: 'slip.jug', men: ['juggernaut', 'trooper'], at: 'slipWest' },
        ],
      },
    ],
    until: { signal: 'fc:booted' },
  },
  {
    id: 'mount',
    title: 'The Frame',
    checkpoint: { at: 'slip', loadout: KIT.quay },
    start: [
      { do: 'done', id: 'initBoot' },
      { do: 'done', id: 'hold' },
      { do: 'music', state: 'easy' },
      { do: 'sweep' },
      { do: 'call', name: 'fc.slipBootOff' },
      { do: 'call', name: 'fc.slipWreck', arg: 'doorGun' },
      squadOf(4, 'slip'),
      { do: 'callins', held: true },
      harbour('boot'),
      { do: 'objective', id: 'board', text: 'Board the Distraint Frame', at: 'frame' },
      { do: 'hint', text: 'Walk up to the kneeling Distraint Frame and press {interact} to climb into the cockpit.', seconds: 9 },
      { do: 'frame', act: 'kneel', at: 'frame' },
      { do: 'done', id: 'board' },
      { do: 'signal', name: 'mounted' },
    ],
    until: { signal: 'mounted' },
  },
  {
    id: 'foreclosure',
    title: 'Foreclosure',
    checkpoint: { at: 'frame', loadout: KIT.quay },
    redeployLines: REPLACEMENT,
    start: [
      // The 14th hold the Slip. Friendlies at the Frame's feet would be crushed.
      { do: 'music', state: 'hard' },
      { do: 'threat', level: 4 },
      { do: 'roster', men: [] },
      { do: 'callins', held: true },
      inFrame('frame'),
      { do: 'call', name: 'fc.sappers', arg: 'on' },
      { do: 'call', name: 'fc.sappers', arg: 'barracks:barracks.cannery,barracks.stacks,barracks.market' },
      { do: 'call', name: 'fc.sappers', arg: 'rampage' },
      { do: 'objective', id: 'back', text: 'Level the Cannery, Market Halls, Gantry Crane & counterattack', at: 'backStreet' },
      council('foreclosure.rampage'),
      { do: 'hint', text: 'LMB rotary (hold 1 for Airburst), RMB 40mm ({reload} cycles HE/AP/FLAK — AP pierces armour), hold G rockets, {jump} jets, {dash} charge, F melee.', seconds: 11 },
      { do: 'squad', tag: 'back.aisle', men: ['trooper', 'rocketeer', 'trooper', 'gunner'], at: 'stacks' },
      { do: 'squad', tag: 'back.men', men: ['rocketeer', 'trooper', 'riot', 'trooper', 'rocketeer'], at: 'backStreet' },
      { do: 'vehicle', tag: 'back.technical', kind: 'humvee', at: 'stacks', crew: ['trooper', 'gunner'], crewTag: 'back.crew' },
      { do: 'vehicle', tag: 'back.truck', kind: 'truck', at: 'backStreet', crew: ['trooper', 'brute'], crewTag: 'back.crew' },
      { do: 'vehicle', tag: 'back.tank', kind: 'tank', at: 'backTank' },
      { do: 'call', name: 'mark', arg: 'back.tank' },
    ],
    cues: [
      { when: { after: 6 }, run: [harbour('foreclosure.start')] },
      { when: { after: 18 }, run: [harbour('foreclosure.sappers')] },
      { when: { after: 28 }, run: [council('foreclosure.stalls')] },
      { when: { signal: 'fc:craneDown' }, run: [harbour('foreclosure.crane'), council('foreclosure.crane')] },
      { when: { cleared: 'back.tank' }, run: [harbour('foreclosure.tank')] },
    ],
    until: { all: [{ cleared: ['back.aisle', 'back.men', 'back.crew', 'back.tank'] }, { signal: 'fc:rampageDone' }] },
  },
  {
    id: 'flak',
    title: 'The Harbour Wall',
    checkpoint: { at: 'harbour', loadout: KIT.quay },
    redeployLines: REPLACEMENT,
    start: [
      { do: 'done', id: 'back' },
      { do: 'music', state: 'hard' },
      { do: 'threat', level: 4 },
      { do: 'roster', men: [] },
      { do: 'callins', held: true },
      inFrame('harbour'),
      { do: 'call', name: 'fc.sappers', arg: 'barracks:stop' },
      { do: 'call', name: 'fc.sappers', arg: 'barracks:barracks.harbour' },
      { do: 'call', name: 'fc.flakStart', arg: 'pod:howitzerPod' },
      { do: 'objective', id: 'howitzer', text: 'Install the 105mm Howitzer upgrade pod', at: 'howitzerPod' },
      council('flak.pod'),
      { do: 'hint', text: 'Move beside the golden Upgrade Pod and hold {interact} to mount the 105mm Howitzer on your Frame.', seconds: 10 },
      { do: 'squad', tag: 'flak', men: ['gunner', 'rocketeer', 'trooper', 'rocketeer'], at: 'flakTower', orders: 'hold' },
    ],
    cues: [
      {
        when: { signal: 'upgrade:howitzer' },
        run: [
          { do: 'done', id: 'howitzer' },
          { do: 'call', name: 'fc.flakStart' },
          { do: 'objective', id: 'flak', text: 'Flatten the Flak Tower with the 105mm Howitzer', at: 'flakTower' },
          council('flak.howitzer'),
          harbour('flak.start'),
          { do: 'hint', text: 'Blast the Flak Tower\'s reinforced concrete piers and roof guns with your 105mm Howitzer (RMB) until it collapses!', seconds: 10 },
        ],
      },
      { when: { signal: 'flak:gun' }, run: [harbour('flak.hit')] },
      { when: { signal: 'flak:cleared' }, run: [harbour('flak.collapse')] },
    ],
    until: { signal: 'flak:flattened' },
  },
  {
    id: 'pans',
    title: 'The Pans',
    checkpoint: { at: 'harbour', loadout: KIT.quay },
    redeployLines: REPLACEMENT,
    start: [
      { do: 'done', id: 'flak' },
      { do: 'music', state: 'hard' },
      { do: 'threat', level: 4 },
      { do: 'roster', men: [] },
      { do: 'callins', held: false },
      { do: 'call', name: 'fc.sappers', arg: 'barracks:stop' },
      { do: 'call', name: 'fc.hideBoss' },
      inFrame('harbour'),
      { do: 'call', name: 'fc.flakStart', arg: 'equip' },
      { do: 'call', name: 'fc.motherReveal' },
      council('sky'),
      council('pans.breach'),
      harbour('mother'),
      { do: 'objective', id: 'salt', text: 'Blast through the West Wall onto the Salt Flats', at: 'pans' },
      { do: 'hint', text: 'Use your 105mm Howitzer to punch straight through the reinforced West Wall (or take the West Gate) onto the Salt Flats.', seconds: 9 },
    ],
    cues: [
      {
        when: { zone: 'westGate' },
        run: [
          { do: 'done', id: 'salt' },
          harbour('pans.convoy'),
          { do: 'objective', id: 'convoy', text: 'Destroy the Salt Flats Armored Convoy', at: 'convoyTank1' },
          { do: 'vehicle', tag: 'convoy.truck1', kind: 'truck', at: 'convoyTruck1', crew: ['trooper', 'gunner', 'rocketeer'], crewTag: 'convoy.crew' },
          { do: 'vehicle', tag: 'convoy.truck2', kind: 'truck', at: 'convoyTruck2', crew: ['trooper', 'brute', 'gunner'], crewTag: 'convoy.crew' },
          { do: 'vehicle', tag: 'convoy.truck3', kind: 'truck', at: 'convoyTruck3', crew: ['trooper', 'rocketeer', 'trooper'], crewTag: 'convoy.crew' },
          { do: 'vehicle', tag: 'convoy.tank1', kind: 'tank', at: 'convoyTank1' },
          { do: 'vehicle', tag: 'convoy.tank2', kind: 'tank', at: 'convoyTank2' },
          { do: 'call', name: 'mark', arg: 'convoy.tank1' },
          { do: 'call', name: 'mark', arg: 'convoy.tank2' },
          { do: 'call', name: 'fc.slipWreck', arg: 'fastRope:convoyLz1:convoyLz1' },
          { do: 'call', name: 'fc.slipWreck', arg: 'fastRope:convoyLz2:convoyLz2' },
        ],
      },
    ],
    until: { all: [{ zone: 'westGate' }, { cleared: ['convoy.truck1', 'convoy.truck2', 'convoy.truck3', 'convoy.tank1', 'convoy.tank2'] }] },
  },
  {
    id: 'mother',
    title: 'Old Mother',
    checkpoint: { at: 'pans', loadout: KIT.quay },
    redeployLines: REPLACEMENT,
    start: [
      { do: 'done', id: 'salt' },
      { do: 'done', id: 'convoy' },
      { do: 'music', state: 'hard' },
      { do: 'threat', level: 5 },
      { do: 'roster', men: [] },
      { do: 'callins', held: false },
      inFrame('pans'),
      { do: 'call', name: 'fc.flakStart', arg: 'equip' },
      { do: 'call', name: 'fc.motherFight' },
      { do: 'objective', id: 'mother', text: 'Break Old Mother\'s tracks, guns, and Stern Engine', at: 'mother' },
      harbour('mother.hunt'),
      { do: 'hint', text: 'Hammer Old Mother\'s tracks and turrets with the 105mm Howitzer (RMB) and G missiles. Pop Q smoke on lock tones.', seconds: 9 },
      { do: 'squad', tag: 'mother.crew', men: ['trooper', 'rocketeer', 'gunner'], at: 'deckCrew', orders: 'hold' },
    ],
    cues: [
      {
        when: { signal: 'mother:drag' },
        run: [
          harbour('mother.drag'),
          { do: 'hint', text: 'Both tracks broken! Dodge her thruster lunges and mortar rings, and strip her remaining guns!', seconds: 8 },
        ],
      },
      {
        when: { signal: 'mother:exposed' },
        run: [
          harbour('mother.exposed'),
          { do: 'hint', text: 'Stern Reactor shroud blown open! Blast her glowing Stern Engine with the 105mm Howitzer!', seconds: 9 },
        ],
      },
    ],
    until: { signal: 'mother:destroyed' },
  },
  {
    id: 'deck',
    title: 'The Harbourmaster',
    checkpoint: { at: 'pans', loadout: KIT.quay },
    redeployLines: REPLACEMENT,
    start: [
      { do: 'done', id: 'mother' },
      { do: 'music', state: 'hard' },
      { do: 'threat', level: 5 },
      { do: 'roster', men: [] },
      { do: 'callins', held: false },
      inFrame('pans'),
      { do: 'call', name: 'fc.flakStart', arg: 'equip' },
      { do: 'call', name: 'fc.motherDeck', arg: 'rival:rivalSpawn' },
      { do: 'objective', id: 'rival', text: 'Defeat the Harbourmaster\'s Ironclad Frame', at: 'rivalSpawn' },
      council('mother.destroyed'),
      harbour('rival.enter'),
      council('rival.detect'),
      { do: 'hint', text: 'Mech-vs-Mech duel! Stagger her Ironclad Frame with 105mm Howitzer shells, watch her cannon telegraph, and dodge jump-jet stomps.', seconds: 10 },
    ],
    cues: [
      {
        when: { signal: 'harbour:ejected' },
        run: [
          { do: 'done', id: 'rival' },
          { do: 'music', state: 'easy' },
          { do: 'call', name: 'fc.hideBoss' },
          { do: 'call', name: 'fc.surrender' },
          harbour('rival.eject'),
          harbour('form'),
          council('rival.cuff'),
          { do: 'objective', id: 'harbour', text: 'Detain (Hold E) or eliminate the Harbourmaster' },
          { do: 'hint', text: 'Press {interact} to exit your Frame, approach the surrendering Harbourmaster, and HOLD {interact} to cuff her for a +$5,000 bonus — or shoot.', seconds: 12 },
        ],
      },
      { when: { signal: 'fc:cuffed' }, run: [council('end.cuffed.bonus', true)] },
      { when: { signal: 'fc:killed' }, run: [council('end.killed', true)] },
    ],
    until: { signal: 'fc:harbourDone' },
  },
  {
    id: 'ending',
    title: 'Notice of Completion',
    checkpoint: { at: 'pans', loadout: KIT.quay },
    redeployLines: REPLACEMENT,
    start: [
      { do: 'done', id: 'harbour' },
      { do: 'roster', men: [] },
      { do: 'callins', held: false },
      { do: 'call', name: 'fc.hideBoss' },
      { do: 'sweep' },
      { do: 'music', state: 'easy' },
      inFrame('pans'),
      { do: 'call', name: 'fc.flakStart', arg: 'equip' },
      { do: 'call', name: 'fc.hideBoss', arg: 'nuke' },
      council('nuke.auth'),
      { do: 'objective', id: 'nuke', text: 'Press [N] to launch Tactical Nuke — Liquidate Holdfast', at: 'square' },
      { do: 'hint', text: 'Tactical Nuke authorised at zero surcharge. Press {callinNuke} (from inside the Frame or on foot) to liquidate Holdfast.', seconds: 12 },
    ],
    cues: [
      {
        when: { signal: 'nuke:detonated' },
        run: [
          { do: 'done', id: 'nuke' },
          { do: 'done', id: 'mission' },
          { do: 'music', state: 'menu' },
          { do: 'wait', seconds: 7.5 },
          council('nuke.detonated'),
          council('end.removed'),
          council('end.deductions'),
          council('end.tallow'),
          { do: 'cutscene', id: 'ending' },
          { do: 'finish' },
        ],
      },
    ],
  },
];

export const FORECLOSURE: Mission = {
  id: 'foreclosure',
  title: 'Foreclosure',
  loadout: KIT.issued,
  zones: ZONES,
  marks: MARKS,
  routes: { ...ROUTES, ...SKY_ROUTES },
  doors: {},
  cutscenes: {
    // Over Holdfast: in from the sea over the flak tower and the stacks, then down over the wall to the Flats where the 14th land.
    briefing: {
      shots: [
        { from: [150, 70, -160], to: [90, 50, -90], lookFrom: [60, 0, -40], lookTo: [60, 0, 0], seconds: 8, fadeIn: 2, caption: 'Holdfast' },
        { from: [20, 30, 80], to: [60, 22, 74], lookFrom: [70, 4, 30], lookTo: [70, 2, 50], seconds: 6, fadeOut: 1.2, caption: 'Form 7742-F' },
      ],
    },
    ending: {
      shots: [{ from: [-60, 12, 10], to: [-20, 60, 60], lookFrom: [-90, 2, 0], lookTo: [60, 0, 0], seconds: 10, fadeIn: 1, fadeOut: 3 }],
      endsBlack: true,
    },
  },
  lines: FORECLOSURE_LINES,
  // The draw budget (docs/campaign/FORECLOSURE.md, Measured): every man, dead or alive, is about six draws and 15k triangles.
  corpses: 8,
  calls: CALLS,
  fronts: FRONTS,
  redeployLines: ['mission.council.redeploy.fee', 'mission.council.redeploy.keep'],
  beats: BEATS,
};
