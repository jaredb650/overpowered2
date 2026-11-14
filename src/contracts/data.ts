/**
 * Every contract, as data. A contract is one society to exterminate: its world, its enemies and its rules. Adding a
 * society is a new row in CONTRACTS. Nothing here imports three.js, so the menu, the map table and tests can all read it.
 *
 * Which rule set a row names is read through `ACTIVE` in select.ts. The rule sets themselves live with their systems:
 * `waves` and `ai` in src/enemies, `wounds` in the damage model.
 */
import type { MapId } from '../world/map/maps';

/**
 * `outpost` is Endless Humans. The id is older than the campaign, and URLs and score tables are keyed on it. `defense` is
 * Outpost Defense, Endless Humans' tower defense (docs/proposals/outpost-defense.md).
 */
export type ContractId = 'campaign' | 'crucible' | 'outpost' | 'defense';

/** Who lives there. Section 15's faction rules hang off this: pain, fear, bleeding, gib thresholds. */
export type FactionId = 'swarm' | 'humans';
/** How a wave is composed: the swarm roster, or squads. */
export type WaveSource = 'swarm' | 'squads';
/** How enemies think. */
export type AiRules = 'swarm' | 'outpost';
/** What a hit does short of killing. 'limbs' is the swarm's limb pools, 'anatomy' is section 14's wounds. */
export type WoundRules = 'limbs' | 'anatomy';

/**
 * How hard a faction's bodies are to break (section 15). Read through `FACTIONS`, and per body rather than per contract, because
 * the Test Range and a late wave can put a husk on the Outpost: what bursts a man is decided by what he is.
 */
export interface FactionRules {
  /** Bleeds, panics, crawls and dies in stages. The rest die the moment their health is gone. */
  anatomy: boolean;
  /** Chance an explosive hit outside the rings in src/enemies/blast.ts works a limb pool: a rocket's contact, a boss in a blast. */
  blastLimb: number;
  /** Multiplies what a hit takes from a limb pool. Under 1, a limb needs sustained fire or a heavy weapon. */
  limbWear: number;
}

export const FACTIONS: Record<FactionId, FactionRules> = {
  swarm: { anatomy: false, blastLimb: 0.65, limbWear: 1 },
  humans: { anatomy: true, blastLimb: 0.22, limbWear: 0.3 },
};

export interface Briefing {
  /** Form number, printed in the header. */
  ref: string;
  /** Who the notice is served on. */
  subject: string;
  /** Short paragraphs, written to be read aloud by the Council's voice later. */
  body: readonly string[];
  /** Label and value rows under the text. */
  terms: readonly (readonly [string, string])[];
}

export interface ContractRewards {
  /** Damage multiplier on hits from behind. 1 turns it off. */
  backShot: number;
}

export interface ContractDef {
  id: ContractId;
  name: string;
  map: MapId;
  faction: FactionId;
  waves: WaveSource;
  ai: AiRules;
  wounds: WoundRules;
  rewards: ContractRewards;
  briefing: Briefing;
  /** A row of MISSIONS in src/campaign/missions. Set, the contract plays that from start to end and has no waves. */
  mission?: string;
  /** Shut until the campaign has been beaten once. See unlocks.ts. */
  locked?: boolean;
  /**
   * Credits, a loadout screen, shops and breaks (contracts/defense). Call-ins are bought, not earned by combo, and no weapon
   * cache, kill drop or wave-end ammo floor hands out what the shops sell.
   */
  economy?: boolean;
  /** localStorage key of this contract's high score. */
  scoreKey: string;
}

/** Every notice ends the same way. */
export const COUNCIL_OFFICE = 'Galactic Council / Office of Societal Compliance';
export const NOTICE_TITLE = 'Notice of Extermination';
export const NOTICE_FOOTER = 'Failure to exterminate within the permitted period may result in a fine.';

/** In menu order. */
export const CONTRACTS: readonly ContractDef[] = [
  {
    id: 'campaign',
    name: 'Campaign',
    map: 'outpost',
    faction: 'humans',
    waves: 'squads',
    ai: 'outpost',
    wounds: 'anatomy',
    rewards: { backShot: 1.5 },
    mission: 'outpost',
    briefing: {
      ref: 'Form 7742-C',
      subject: 'The commanding officer of The Outpost, and everyone who reports to him',
      body: [
        'The above are in breach of Section 12 (Continued Existence). A notice was displayed on their planet for the statutory 30 days. Their commanding officer declined to sign for it.',
        'Transport is included one way. You will be issued a submachine gun, and you will find the rest. A previous contractor was assigned to this account. That file is closed.',
        'Occupants are trained, armed, and may attempt to reason with you. They have been advised that this will not affect the outcome.',
      ],
      terms: [
        ['Site', 'The Outpost, from the wire to the roof'],
        ['Occupants', 'A garrison, with armour'],
        ['Duration', 'Twenty to thirty minutes, billed'],
        ['Appeals', 'In writing, to an address now destroyed'],
      ],
    },
    scoreKey: 'op2_highscore.campaign',
  },
  {
    id: 'crucible',
    name: 'The Crucible',
    map: 'crucible',
    faction: 'swarm',
    waves: 'swarm',
    ai: 'swarm',
    wounds: 'limbs',
    rewards: { backShot: 1 },
    briefing: {
      ref: 'Form 7741-B',
      subject: 'All occupants of The Crucible, living or otherwise',
      body: [
        'The above have exceeded the maximum permitted stay. Occupants were notified by post. The post was eaten.',
        'You are authorised to remove them in full. They feel no pain and no fear, and they will not form an orderly queue.',
        'Removal is charged per head, where a head remains. Limbs left in the zone are left at the owner\'s risk.',
      ],
      terms: [
        ['Site', 'The Crucible, all levels'],
        ['Occupants', 'Husks, machines, mixed stock'],
        ['Morale', 'None on record'],
        ['Appeals', 'None received. None legible'],
      ],
    },
    // The name the one shared table had, so the record set before contracts existed stays with the game it was set in.
    scoreKey: 'op2_highscore',
  },
  {
    id: 'outpost',
    name: 'Endless Humans',
    map: 'killhouse',
    faction: 'humans',
    waves: 'squads',
    ai: 'outpost',
    wounds: 'anatomy',
    rewards: { backShot: 1.5 },
    locked: true,
    briefing: {
      ref: 'Form 7742-D',
      subject: 'The human garrison at the Kill House',
      body: [
        'The Commander\'s service record has been retained. Deceased personnel remain eligible to serve at the Kill House. He will be directing the men, and they will obey him.',
        'This account does not close. Occupants are trained, armed, and learning from every man they lose.',
        'Surrender is not a recognised method of payment. The Geneva Suggestion remains advisory. Please do not leave survivors unattended.',
      ],
      terms: [
        ['Site', 'The Kill House, yard and catwalks'],
        ['Occupants', 'Humans, in squads, for ever'],
        ['Morale', 'Present. Declining'],
        ['Appeals', 'In writing, to an address now destroyed'],
      ],
    },
    scoreKey: 'op2_highscore.outpost',
  },
  {
    id: 'defense',
    name: 'Outpost Defense',
    // shortcut: the Test Range stands in until the fort map lands; then this is 'fort' (and MAP_IDS in select.ts gains it).
    map: 'range',
    faction: 'humans',
    waves: 'squads',
    ai: 'outpost',
    wounds: 'anatomy',
    rewards: { backShot: 1.5 },
    locked: true,
    economy: true,
    briefing: {
      ref: 'Form 7742-F',
      subject: 'Every human force advancing on the fort, now and in future',
      body: [
        'The fort is Council property. The humans outside dispute this, in waves. You are contracted to hold it until they stop, which on current projections they will not.',
        'You arrive with a budget, not a gun. Everything else is bought: troops, ammunition, weapons, repairs and air support. Each wave held is paid for.',
        'Shops lost to the enemy may be rebuilt at the contractor\'s expense. The Council does not reimburse walls.',
      ],
      terms: [
        ['Site', 'The fort, three rings deep'],
        ['Occupants', 'Yours, if you pay them'],
        ['Duration', 'Open-ended'],
        ['Appeals', 'In writing, to an address now destroyed'],
      ],
    },
    scoreKey: 'op2_highscore.defense',
  },
];

/** What `/` runs. The swarm game is what the page has always opened on, and what a bare URL must go on meaning. */
export const DEFAULT_CONTRACT: ContractDef = CONTRACTS.find(c => c.id === 'crucible')!;

/** Key T. Numbers from DESIGN 14.5. */
export const SONAR = {
  /** How long enemies stay lit. */
  reveal: 4,
  cooldown: 8,
  /** The cooldown once few enough enemies are left. A straggler must never extend a round. */
  lastCooldown: 3,
  /** At or under this many left, the short cooldown applies. */
  lastEnemies: 3,
  /** Seconds from the key to the fingers reaching the helmet. The ping goes out on contact. */
  tapLead: 0.14,
  /** Seconds the ring takes to cross the map, whatever its size. Enemies light up as it reaches them. */
  sweepSeconds: 1.6,
  /** How far it goes, as a share of the map's diagonal. From a corner that still reaches nearly all of it. */
  sweepShare: 0.75,
  /** Seconds the silhouettes take to go out, at the end of the reveal. */
  fade: 0.7,
  /** Heat on a cold map. Hunters see warm bodies. */
  enemyColor: '#ff3414',
  ringColor: '#39e0ff',
} as const;
