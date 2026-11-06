/**
 * Every contract, as data. A contract is one society to exterminate: its world, its enemies and its rules. Adding a
 * society is a new row in CONTRACTS. Nothing here imports three.js, so the menu, the map table and tests can all read it.
 *
 * Which rule set a row names is read through `ACTIVE` in select.ts. The rule sets themselves live with their systems:
 * `waves` and `ai` in src/enemies, `wounds` in the damage model.
 */
import type { MapId } from '../world/map/maps';

export type ContractId = 'crucible' | 'outpost';

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
  /** Only a direct hit, or a blast inside Combat's gib zone that also reaches `blastBurst`, bursts this body. */
  pointBlankOnly: boolean;
  /** Share of max health a blast has to do to burst a body. */
  blastBurst: number;
  /** Chance a blast that does not kill takes a limb. */
  blastLimb: number;
  /** Multiplies what a hit takes from a limb pool. Under 1, a limb needs sustained fire or a heavy weapon. */
  limbWear: number;
}

export const FACTIONS: Record<FactionId, FactionRules> = {
  swarm: { anatomy: false, pointBlankOnly: false, blastBurst: 1, blastLimb: 0.65, limbWear: 1 },
  // A grenade lands 175 on a man of 70 from a metre off, and a rocket's splash never reaches 2.5: that takes a direct hit.
  humans: { anatomy: true, pointBlankOnly: true, blastBurst: 2.5, blastLimb: 0.22, limbWear: 0.3 },
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
  /** localStorage key of this contract's high score. */
  scoreKey: string;
}

/** Every notice ends the same way. */
export const COUNCIL_OFFICE = 'Galactic Council / Office of Societal Compliance';
export const NOTICE_TITLE = 'Notice of Extermination';
export const NOTICE_FOOTER = 'Failure to exterminate within the permitted period may result in a fine.';

/** First row is the default. */
export const CONTRACTS: readonly ContractDef[] = [
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
    name: 'The Outpost',
    map: 'killhouse',
    faction: 'humans',
    waves: 'squads',
    ai: 'outpost',
    wounds: 'anatomy',
    rewards: { backShot: 1.5 },
    briefing: {
      ref: 'Form 7742-C',
      subject: 'The human garrison at The Outpost',
      body: [
        'Following a routine audit, the above are in breach of Section 12 (Continued Existence). A notice was displayed on their planet for the statutory 30 days.',
        'Occupants are trained, armed, and may attempt to reason with you. They have been advised that this will not affect the outcome.',
        'Surrender is not a recognised method of payment. The Geneva Suggestion remains advisory. Please do not leave survivors unattended.',
      ],
      terms: [
        ['Site', 'The Kill House, yard and catwalks'],
        ['Occupants', 'Humans, in squads'],
        ['Morale', 'Present. Declining'],
        ['Appeals', 'In writing, to an address now destroyed'],
      ],
    },
    scoreKey: 'op2_highscore.outpost',
  },
];

export const DEFAULT_CONTRACT: ContractDef = CONTRACTS[0]!;

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
