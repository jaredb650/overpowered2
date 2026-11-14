/**
 * Foreclosure, mission 2: the sixteen beats of docs/proposals/mission-2-plan.md as rows, built so far as its skeleton (stage 6).
 * docs/campaign/FORECLOSURE.md says what is real and what stands in. Beat ids are the plan's, and `?beat=` takes them.
 *
 * Every beat runs end to end with stand-ins: a small squad or two where the plan has a fight, a tank for Grandad and for Old Mother,
 * and the `frame` steps answered by a banner until the Frame (src/frame) provides them.
 *
 * The places are Holdfast's (src/world/map/holdfast), by name in `foreclosure.places.ts`.
 */
import type { Beat, Loadout, Mission, Step } from '../types';
import { FORECLOSURE_LINES } from './foreclosure.lines';
import { MARKS, ROUTES, ZONES } from './foreclosure.places';

const say = (id: string, wait = false): Step => ({ do: 'say', line: `mission.foreclosure.${id}`, wait });
const council = (id: string, wait = false): Step => say(`council.${id}`, wait);
const harbour = (id: string, wait = false): Step => say(`harbour.${id}`, wait);
const radio = (id: string, wait = false): Step => say(`radio.${id}`, wait);

/** The kit a checkpoint promises. Start: SMG, shotgun, sword, 2 grenades. The launcher at the wall, the Thresher at the quay, the autocannon on the deck. */
const KIT = {
  issued: { weapons: ['smg', 'shotgun', 'sword'], grenades: 2 },
  launcher: { weapons: ['smg', 'shotgun', 'rocket', 'sword'], grenades: 2 },
  quay: { weapons: ['smg', 'thresher', 'shotgun', 'rocket', 'sword'], grenades: 3 },
  deck: { weapons: ['smg', 'thresher', 'shotgun', 'rocket', 'autocannon', 'sword'], grenades: 3 },
} as const satisfies Record<string, Loadout>;

/** The 14th Recoveries: six land, one is lost in the market, one in the stacks, and four hold the Slip. */
const FOURTEENTH = ['rifleman', 'gunner', 'rifleman', 'medic', 'rocketeer', 'shotgunner'] as const;
const squadOf = (n: number, at: string): Step => ({ do: 'roster', men: FOURTEENTH.slice(0, n), at });

/** The other squad on the street, beside the player's from the wall to the Square. */
const EAST_STREET: Step = {
  do: 'battle', id: 'eastStreet', bailiffs: ['rifleman', 'rifleman', 'gunner', 'rocketeer'], at: 'eastBureau',
  militia: ['trooper', 'trooper', 'gunner'], from: 'eastMilitia', ensure: true,
};

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
      { do: 'music', state: 'easy' },
      { do: 'threat', level: 1 },
      { do: 'objective', id: 'mission', text: 'Foreclose on Holdfast' },
      { do: 'objective', id: 'cover', text: 'Cover the 14th\'s landing', at: 'lz' },
      squadOf(6, 'lz'),
      { do: 'squad', tag: 'flats', men: ['trooper', 'trooper', 'gunner', 'rocketeer'], at: 'outerShacks', orders: 'hold' },
      harbour('wave'),
      { do: 'sortie', over: 'lz' },
      { do: 'done', id: 'cover' },
      radio('lease'),
      { do: 'signal', name: 'landed' },
    ],
    cues: [{ when: { after: 20 }, run: [harbour('stove')] }],
    until: { signal: 'landed' },
  },
  {
    id: 'landing',
    title: 'The Flats',
    checkpoint: { at: 'lz', loadout: KIT.issued },
    start: [
      squadOf(6, 'lz'),
      { do: 'objective', id: 'shanties', text: 'Clear the outer shanties', at: 'outerShacks' },
      { do: 'hint', text: 'Tap {interact} on a Bailiff: on me, or hold here. Hold {interact}: the whole squad.' },
      { do: 'squad', tag: 'flats', men: ['trooper', 'trooper', 'gunner'], at: 'outerShacks', ensure: true },
      { do: 'vehicle', tag: 'technical', kind: 'humvee', at: 'shanties', crew: ['trooper', 'gunner'], crewTag: 'technical.crew' },
    ],
    until: { cleared: ['flats', 'technical.crew'] },
  },
  {
    id: 'wall',
    title: 'The Wall',
    checkpoint: { at: 'shanties', loadout: KIT.issued },
    start: [
      { do: 'done', id: 'shanties' },
      squadOf(6, 'shanties'),
      { do: 'objective', id: 'wall', text: 'Break through the wall', at: 'gate' },
      { do: 'rack', weapon: 'rocket', at: 'breachKit' },
      EAST_STREET,
      { do: 'squad', tag: 'wallGuns', men: ['gunner', 'gunner'], at: 'wallGuns', orders: 'hold' },
    ],
    until: { all: [{ cleared: 'wallGuns' }, { signal: 'took:rocket' }] },
  },
  {
    id: 'market',
    title: 'The Market',
    checkpoint: { at: 'gate', loadout: KIT.launcher },
    start: [
      { do: 'done', id: 'wall' },
      squadOf(6, 'gate'),
      EAST_STREET,
      { do: 'objective', id: 'square', text: 'Push through the Market to the Square', at: 'square' },
      { do: 'squad', tag: 'lanes', men: ['riot', 'trooper', 'trooper', 'warden'], at: 'lanes', orders: 'hold' },
    ],
    until: { cleared: 'lanes' },
  },
  {
    id: 'courier',
    title: 'The Square',
    start: [
      { do: 'done', id: 'square' },
      { do: 'stop', battle: 'eastStreet' },
      council('fees', true),
      { do: 'banner', text: 'THE COURIER', sub: 'Stand-in: it burns and goes down in the dry dock' },
      { do: 'callins', held: true },
      radio('courier'),
      harbour('iron'),
      { do: 'objective', id: 'smoke', text: 'Reach the smoke', at: 'slip' },
      { do: 'wait', seconds: 4 },
      { do: 'signal', name: 'downed' },
    ],
    until: { signal: 'downed' },
  },
  {
    id: 'stacks',
    title: 'The Stacks',
    checkpoint: { at: 'square', loadout: KIT.launcher },
    start: [
      squadOf(5, 'square'),
      { do: 'callins', held: true },
      // Said again so a jump straight here has it. A restart has it anyway: objectives are saved with the checkpoint.
      { do: 'objective', id: 'smoke', text: 'Reach the smoke', at: 'slip' },
      { do: 'rack', weapon: 'sabot', at: 'craneCab', optional: true },
      { do: 'squad', tag: 'stacks', men: ['sniper', 'sniper', 'trooper', 'rocketeer'], at: 'stacks', orders: 'hold' },
      { do: 'vehicle', tag: 'grandad', kind: 'tank', at: 'quayRoad' },
    ],
    until: { cleared: ['stacks', 'grandad'] },
  },
  {
    id: 'quay',
    title: 'The Quay',
    checkpoint: { at: 'quay', loadout: KIT.launcher },
    start: [
      squadOf(4, 'quay'),
      { do: 'callins', held: true },
      { do: 'drop', item: 'health', at: 'quayHealth' },
      { do: 'drop', item: 'armor', at: 'quayArmour' },
      { do: 'objective', id: 'thresher', text: 'Take the Thresher', at: 'thresherRack' },
      { do: 'rack', weapon: 'thresher', at: 'thresherRack' },
    ],
    until: { signal: 'took:thresher' },
  },
  {
    id: 'slip',
    title: 'The Slip',
    checkpoint: { at: 'slip', loadout: KIT.quay },
    start: [
      { do: 'done', id: 'thresher' },
      { do: 'done', id: 'smoke' },
      squadOf(4, 'slip'),
      { do: 'callins', held: true },
      { do: 'objective', id: 'hold', text: 'Hold the Slip while the Frame boots', at: 'frame' },
      council('boot'),
      { do: 'squad', tag: 'slip.north', men: ['trooper', 'trooper', 'gunner'], at: 'slipNorth' },
      { do: 'squad', tag: 'slip.east', men: ['trooper', 'rocketeer'], at: 'slipEast' },
      { do: 'squad', tag: 'slip.west', men: ['trooper', 'brute'], at: 'slipWest' },
    ],
    // The plan's boot is 120 s. A stand-in hold is shorter.
    until: { all: [{ after: 30 }, { cleared: ['slip.north', 'slip.east', 'slip.west'] }] },
  },
  {
    id: 'mount',
    title: 'The Frame',
    checkpoint: { at: 'slip', loadout: KIT.quay },
    start: [
      { do: 'done', id: 'hold' },
      squadOf(4, 'slip'),
      { do: 'callins', held: true },
      harbour('boot'),
      { do: 'objective', id: 'board', text: 'Board the Frame', at: 'frame' },
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
      { do: 'roster', men: [] },
      { do: 'callins', held: true },
      inFrame('frame'),
      { do: 'objective', id: 'back', text: 'Back through the stacks and the market' },
      { do: 'squad', tag: 'back.men', men: ['rocketeer', 'trooper', 'trooper', 'rocketeer'], at: 'backStreet' },
      { do: 'vehicle', tag: 'back.technical', kind: 'humvee', at: 'stacks', crew: ['trooper', 'gunner'], crewTag: 'back.crew' },
      { do: 'vehicle', tag: 'back.tank', kind: 'tank', at: 'backTank' },
    ],
    until: { cleared: ['back.men', 'back.crew', 'back.tank'] },
  },
  {
    id: 'flak',
    title: 'The Harbour Wall',
    checkpoint: { at: 'harbour', loadout: KIT.quay },
    redeployLines: REPLACEMENT,
    start: [
      { do: 'done', id: 'back' },
      { do: 'roster', men: [] },
      { do: 'callins', held: true },
      inFrame('harbour'),
      { do: 'objective', id: 'flak', text: 'Break the flak tower', at: 'flakTower' },
      { do: 'squad', tag: 'flak', men: ['gunner', 'rocketeer', 'gunner'], at: 'flakTower', orders: 'hold' },
    ],
    until: { cleared: 'flak' },
  },
  {
    id: 'pans',
    title: 'The Pans',
    start: [
      { do: 'done', id: 'flak' },
      { do: 'callins', held: false },
      council('sky'),
      harbour('mother'),
      { do: 'objective', id: 'salt', text: 'Out of the west gate, onto the salt', at: 'pans' },
    ],
    until: { zone: 'westGate' },
  },
  {
    id: 'mother',
    title: 'Old Mother',
    checkpoint: { at: 'pans', loadout: KIT.quay },
    redeployLines: REPLACEMENT,
    start: [
      { do: 'done', id: 'salt' },
      { do: 'roster', men: [] },
      { do: 'callins', held: false },
      inFrame('pans'),
      { do: 'objective', id: 'mother', text: 'Stop Old Mother', at: 'mother' },
      { do: 'vehicle', tag: 'mother', kind: 'tank', at: 'mother' },
      { do: 'squad', tag: 'mother.crew', men: ['trooper', 'rocketeer'], at: 'deckCrew', orders: 'hold' },
    ],
    // With both tracks gone, or after 75 s of the drag, the cutter wheel takes the Frame and throws the player onto the deck.
    cues: [{
      when: { any: [{ cleared: 'mother' }, { after: 75 }] },
      run: [
        council('eject'),
        { do: 'frame', act: 'eject', at: 'deck' },
        { do: 'goto', beat: 'deck' },
      ],
    }],
  },
  {
    id: 'deck',
    title: 'The Deck',
    checkpoint: { at: 'deck', loadout: KIT.quay },
    start: [
      { do: 'done', id: 'mother' },
      { do: 'objective', id: 'engine', text: 'Break the engine' },
      { do: 'rack', weapon: 'autocannon', at: 'deckGun' },
      { do: 'squad', tag: 'deck.crew', men: ['trooper', 'trooper', 'gunner'], at: 'deckCrew' },
    ],
    until: { cleared: 'deck.crew' },
  },
  {
    id: 'ending',
    title: 'Notice of Completion',
    checkpoint: { at: 'deck', loadout: KIT.deck },
    start: [
      { do: 'done', id: 'engine' },
      { do: 'done', id: 'mission' },
      { do: 'sweep' },
      { do: 'music', state: 'menu' },
      harbour('form', true),
      council('end.removed'),
      council('end.deductions'),
      council('end.tallow'),
      { do: 'cutscene', id: 'ending' },
      { do: 'finish' },
    ],
  },
];

export const FORECLOSURE: Mission = {
  id: 'foreclosure',
  title: 'Foreclosure',
  loadout: KIT.issued,
  zones: ZONES,
  marks: MARKS,
  routes: ROUTES,
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
  redeployLines: ['mission.council.redeploy.fee', 'mission.council.redeploy.keep'],
  beats: BEATS,
};
