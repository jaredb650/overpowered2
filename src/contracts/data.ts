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
export type ContractId = 'campaign' | 'foreclosure' | 'quiet_title' | 'bank_run' | 'desert_raid' | 'crucible' | 'outpost' | 'rooftop' | 'defense' | 'retraining';

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
  /** Shut in the menu until this mission has been won: the next mission of the campaign. Only the Outpost records a win so far. */
  opensAfter?: 'outpost';
  /**
   * Credits, a loadout screen, shops and breaks (contracts/defense). Call-ins are bought, not earned by combo, and no weapon
   * cache, kill drop or wave-end ammo floor hands out what the shops sell.
   */
  economy?: boolean;
  /** The tutorial (docs/design/tutorial.md): reached from Play > Training and a first launch, never listed with the missions. */
  training?: boolean;
  /** Disables The Commander entirely (no briefings, barks, adaptations, or boss spawn) for truly endless human survival modes like Rooftop. */
  noCommander?: boolean;
  /** localStorage key of this contract's high score. */
  scoreKey: string;
  /**
   * Other maps these rules also play on, each with its own notice. The rules, shop, guns, waves and AI are the contract's own; the
   * score is kept apart, under `scoreKey` plus the map (contracts/scores.ts). The menu lists the mode under each map.
   */
  alsoOn?: Partial<Record<MapId, Briefing>>;
}

/** Every notice ends the same way. */
export const COUNCIL_OFFICE = 'Galactic Council / Office of Societal Compliance';
export const NOTICE_TITLE = 'Notice of Extermination';
export const NOTICE_FOOTER = 'Failure to exterminate within the permitted period may result in a fine.';

/** In menu order. */
export const CONTRACTS: readonly ContractDef[] = [
  {
    id: 'campaign',
    name: 'The Outpost',
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
    id: 'foreclosure',
    name: 'Foreclosure',
    map: 'holdfast',
    faction: 'humans',
    waves: 'squads',
    ai: 'outpost',
    wounds: 'anatomy',
    rewards: { backShot: 1.5 },
    mission: 'foreclosure',
    opensAfter: 'outpost',
    briefing: {
      ref: 'Form 7742-F',
      subject: 'The free port of Holdfast, its residents, and everything they owe',
      body: [
        'Holdfast garrisoned The Outpost. Its debts have transferred. Holdfast has filed an objection. Objections are not a recognised form.',
        'You will land with a squad of the 14th Recoveries, under air cover. They are not to be spoken to.',
        'A Distraint Frame is available on request. Fees apply.',
      ],
      terms: [
        ['Site', 'Holdfast, a shipyard on the salt flats of Brine'],
        ['Occupants', 'Dockers, salt-cutters, a harbourmaster'],
        ['Duration', 'Twenty to thirty minutes, billed'],
        ['Appeals', 'Not a recognised form'],
      ],
    },
    scoreKey: 'op2_highscore.foreclosure',
  },
  {
    id: 'quiet_title',
    name: 'Quiet Title',
    map: 'chancery',
    faction: 'humans',
    waves: 'squads',
    ai: 'outpost',
    wounds: 'anatomy',
    rewards: { backShot: 1.5 },
    mission: 'quiet_title',
    opensAfter: 'outpost',
    noCommander: true,
    briefing: {
      ref: 'Form 7742-X',
      subject: 'High Magistrate Aldous Vane, Comptroller of Civil Continuity, and his personal security detail',
      body: [
        'High Magistrate Vane is scheduled to sign a Form 9-A Stay of Liquidation at 06:00. A stay would freeze regional collections and require a second meeting. His signature must be rendered unavailable before dawn.',
        'The Chancery Estate is covered by the Diplomatic Arbitration Charter. Deploying a Distraint Frame, an AC-130, or Bailiffs incurs a 400% Jurisdictional Surcharge payable by the contractor. You are therefore entering alone and at reasonable volume.',
        'Active Sonar pulses are suspended in quiet zones. A Thermal Vision brain chip has been fitted in its place, together with suppressed sidearms. A previous contractor left equipment in the east bell tower; his invoice has been settled.',
      ],
      terms: [
        ['Site', 'The Chancery Estate, grounds, bureau, and sub-level vault'],
        ['Target', 'High Magistrate Aldous Vane, before 06:00'],
        ['Equipment', 'Suppressed sidearms, Thermal Vision chip; heavy support surcharged'],
        ['Appeals', 'Form 9-A, unsigned'],
      ],
    },
    scoreKey: 'op2_highscore.quiet_title',
  },
  {
    id: 'bank_run',
    name: 'Bank Run',
    map: 'bank',
    faction: 'humans',
    waves: 'squads',
    ai: 'outpost',
    wounds: 'anatomy',
    rewards: { backShot: 1.5 },
    mission: 'bank_run',
    opensAfter: 'outpost',
    noCommander: true,
    briefing: {
      ref: 'Form 7742-B',
      subject: 'Governor Reginald Sterling, Chairman of the Brine Central Reserve, and all bullion reserves on deposit',
      body: [
        'With High Magistrate Vane\'s failure to execute Form 9-A prior to 06:00, the Stay of Liquidation has expired. The planetary bullion reserve is now past due.',
        'Packmule 2-3 will fast-rope you onto the Reserve rooftop at 09:15. Breach the central atrium skylight, drill the Planetary Bullion Vault, and heave four mandatory recovery duffels into your waiting Bailiff Humvee.',
        'Governor Sterling has requisitioned armoured air support for the Coastal Expressway. A roof-mounted M2 .50 cal has been bolted to your getaway vehicle. Bagging fees apply.',
      ],
      terms: [
        ['Site', 'Brine Central Reserve -> Coastal Elevated Expressway'],
        ['Principal', '4 mandatory gold duffels (+3 optional bonus pallets)'],
        ['Opposition', 'Reserve SWAT, Tech Saboteurs, Interceptors, AUDITOR-1'],
        ['Appeals', 'Shorted at market open'],
      ],
    },
    scoreKey: 'op2_highscore.bank_run',
  },
  {
    id: 'desert_raid',
    name: 'Desert Raid',
    map: 'desert',
    faction: 'humans',
    waves: 'squads',
    ai: 'outpost',
    wounds: 'anatomy',
    rewards: { backShot: 1.5 },
    mission: 'desert_raid',
    opensAfter: 'outpost',
    noCommander: true,
    briefing: {
      ref: 'Raid Order 09-S',
      subject: 'Hadrek Quist ("the Salt King") and the Saltblood gang at Surplus',
      body: [
        'Hadrek Quist holds the only water well within forty miles and rules the shantytown of Surplus from a crashed cargo plane at its north end. He hangs prisoners off the outer wall and raids every caravan on the salt road.',
        'Three open trucks with mounted heavy guns are rolling across the dunes at dawn under two escort gunships. You man the heavy gun on the middle truck: strip the outer sheet-metal wall and guard towers, then storm the shantytown on foot beside Sergeant Marr\'s assault squads.',
        'Everything in Surplus breaks except the plane. Cut your own path through the shacks, corner Quist in his fuselage, and decide how he leaves. Air support flattens what is left on the way out.',
      ],
      terms: [
        ['Site', 'Surplus — outer dunes, wall, the Warren, Pump Yard, and crashed cargo plane'],
        ['Target', 'Hadrek Quist — kill or capture'],
        ['Support', '3-truck convoy, friendly assault squads, scripted Warthog & gunship strikes'],
        ['Gear', 'Mounted heavy gun, optional Warren minigun, Thermal brain chip for the sewer'],
      ],
    },
    scoreKey: 'op2_highscore.desert_raid',
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
    alsoOn: {
      office: {
        ref: 'Form 7741-O',
        subject: 'All occupants of Regional Processing Office 9, living or otherwise',
        body: [
          'The branch was overrun during a routine audit. The audit is continuing. Staff have been reclassified as occupants.',
          'You are authorised to remove them in full, on every floor, in the car park and on the roof. Furniture is not a protected class.',
          'Breakages will be itemised. Copiers are known to be volatile. Please do not use the lift.',
        ],
        terms: [
          ['Site', 'Regional Processing Office 9, two floors and grounds'],
          ['Occupants', 'Husks, machines, former staff'],
          ['Morale', 'None on record'],
          ['Appeals', 'Take a number'],
        ],
      },
    },
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
    alsoOn: {
      office: {
        ref: 'Form 7742-O',
        subject: 'Building security at Regional Processing Office 9, and their replacements',
        body: [
          'A notice was addressed to the building. Security declined to sign for it on the building\'s behalf, and have barricaded the lobby.',
          'They are trained, armed and paid by the hour, and they know the floor plan. Further shifts are on their way.',
          'Damage to Council property will be deducted from your fee. The Council owns the property. The Council sets the fee.',
        ],
        terms: [
          ['Site', 'Regional Processing Office 9, two floors and grounds'],
          ['Occupants', 'Humans, in squads, by the shift'],
          ['Morale', 'Present. Unionised'],
          ['Appeals', 'Take a number'],
        ],
      },
    },
  },
  {
    id: 'rooftop',
    name: 'Rooftop',
    map: 'rooftop',
    faction: 'humans',
    waves: 'squads',
    ai: 'outpost',
    wounds: 'anatomy',
    rewards: { backShot: 1.5 },
    noCommander: true,
    briefing: {
      ref: 'Form 7742-S',
      subject: 'Tactical response squads deployed across the Skyline rooftops',
      body: [
        'The Skyline complex has been sealed at street level. Response teams are breaching from the stairwells, fast-roping from utility choppers, and dropping from overhead transport jets.',
        'There is no Commander on this channel and no final wave. Expect heavy gunships and armored drop-ins every fifth wave.',
        'Watch the drop between towers. Council insurance does not cover gravity.',
      ],
      terms: [
        ['Site', 'Skyline Rooftops, seven towers and skybridges'],
        ['Occupants', 'SWAT squads, airborne reinforcements, gunships'],
        ['Duration', 'Endless'],
        ['Appeals', 'Dropped over the parapet'],
      ],
    },
    scoreKey: 'op2_highscore.rooftop',
  },
  {
    id: 'defense',
    name: 'Outpost Defense',
    map: 'fort',
    faction: 'humans',
    waves: 'squads',
    ai: 'outpost',
    wounds: 'anatomy',
    rewards: { backShot: 1.5 },
    locked: true,
    economy: true,
    briefing: {
      ref: 'Form 7742-G',
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
  {
    id: 'retraining',
    name: 'Retraining',
    map: 'annex',
    faction: 'humans',
    waves: 'squads',
    ai: 'outpost',
    wounds: 'anatomy',
    rewards: { backShot: 1.5 },
    mission: 'retraining',
    training: true,
    briefing: {
      ref: 'Form 7742-R',
      subject: 'The contractor, selected for retraining',
      body: [
        'You have been selected for retraining. The reasons are on file. The file is not available to you.',
        'Attendance is voluntary. You are free to leave at any time, through the door behind you. You are highly encouraged not to.',
        'Live subjects are provided. They have been processed for your convenience.',
      ],
      terms: [
        ['Site', 'The Retraining Annex'],
        ['Subjects', 'Held, and some not'],
        ['Duration', 'Brief, if you are'],
        ['Attendance', 'Voluntary'],
      ],
    },
    scoreKey: 'op2_highscore.retraining',
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
