/**
 * What The Commander can do, as data. Section 16.2's table is one row here per answer, each with the tell and the counterplay section
 * 16.5 demands, so a test can hold every row to that. Section 16.3's tricks and section 16.4's arc sit beside it.
 *
 * Nothing here imports three.js: the lines, the script export and the tests all read it.
 */

/** A thing the player does too much of. */
export type HabitId =
  | 'camping' | 'sonar' | 'routes' | 'pickups' | 'explosives' | 'melee' | 'speed' | 'highGround' | 'callIns' | 'headshots' | 'executions' | 'baiting' | 'chatter' | 'range';

export type AdaptationId =
  | 'mortars' | 'snipers'
  | 'jammers' | 'decoys' | 'hiders'
  | 'mines' | 'tripwires'
  | 'riggedPickups' | 'baitPickups'
  | 'spread'
  | 'shotguns' | 'claymores'
  | 'crossfire' | 'snares'
  | 'smoke'
  | 'manpads' | 'radioJammer'
  | 'helmets'
  | 'noSurrender' | 'falseSurrender'
  | 'riggedCasualties'
  | 'radioSilence' | 'falseChatter';

export type TrickId = 'playDead' | 'riggedCorpses' | 'sacrifice' | 'dangerClose' | 'deadMan' | 'riggedRooms' | 'barricades';

export interface AdaptationDef {
  id: AdaptationId;
  habit: HabitId;
  /** First wave this answer can be fielded on. */
  from: number;
  /** What the player can see or hear before it hurts. */
  tell: string;
  /** What the player can do about it. */
  counterplay: string;
}

/** In the order they are built and preferred on a tie. Answers to the same habit follow each other. */
export const ADAPTATIONS: readonly AdaptationDef[] = [
  { id: 'mortars', habit: 'camping', from: 2, tell: 'A spotter with a red designator paints the player. Red smoke lands, then shells', counterplay: 'Move out of the smoke. Kill the spotter and the tubes go blind; kill the crew and they stop' },
  { id: 'snipers', habit: 'camping', from: 2, tell: 'A laser and a muzzle glint from a perch behind the player, with a charge-up whine', counterplay: 'Break the line. Sonar shows the perch. Hunt him' },
  { id: 'jammers', habit: 'sonar', from: 2, tell: 'A soldier with a whip antenna on his back. The chip reads JAMMED, and the ping lights him through any wall', counterplay: 'Kill the operator and sonar comes back at once' },
  { id: 'decoys', habit: 'sonar', from: 3, tell: 'Ghost blips never move and flicker. Each one is a blinking box on the floor', counterplay: 'Watch which blips move. Shoot the box' },
  { id: 'hiders', habit: 'sonar', from: 3, tell: 'A radio click at about 14 m. Foil on their backs. Inside 10 m a ping still finds them, faintly', counterplay: 'Ping close. Grenade the room first. They break cover if the rest of the wave dies' },
  { id: 'mines', habit: 'routes', from: 2, tell: 'A red blink on the floor and a click when you step on it, half a second before it goes', counterplay: 'Shoot it, blast it, or keep moving: the fuse is long enough to clear it at a run' },
  { id: 'tripwires', habit: 'routes', from: 3, tell: 'A thin red line across the door, with a blinking post at each end', counterplay: 'Jump it, or shoot a post' },
  { id: 'riggedPickups', habit: 'pickups', from: 2, tell: 'A blinking charge beside the pickup, ticking when close', counterplay: 'Shoot the charge first, or grab it at speed and clear the fuse' },
  { id: 'baitPickups', habit: 'pickups', from: 3, tell: 'A prize alone in the open with laser sights crossing on it', counterplay: 'Kill the men holding the lasers first, or leave it' },
  { id: 'spread', habit: 'explosives', from: 2, tell: 'Men stand well apart and no longer stack on doors', counterplay: 'One blast takes one man now. Change weapon, or hunt them singly' },
  { id: 'shotguns', habit: 'melee', from: 2, tell: 'Pairs of shotguns, a flamer later, and riflemen who back away as you close', counterplay: 'Stop chasing. Shoot from range' },
  { id: 'claymores', habit: 'melee', from: 3, tell: 'A green box on legs with a fan of laser in front of it, and a click', counterplay: 'Shoot it from outside the fan, or come at it from behind' },
  { id: 'crossfire', habit: 'speed', from: 2, tell: 'Laser sights already crossing on the exit before you reach it', counterplay: 'Take another door, or kill one of the two' },
  { id: 'snares', habit: 'speed', from: 3, tell: 'A bright cable at shin height across the corridor', counterplay: 'Jump it, shoot a post, or slow down. Below a run it only trips the alarm' },
  { id: 'smoke', habit: 'highGround', from: 2, tell: 'A canister rattles along the catwalk, then a grey wall. A sniper laser finds the deck', counterplay: 'Get off the high ground. Sonar sees through smoke' },
  { id: 'manpads', habit: 'callIns', from: 2, tell: 'A man with a long tube. AA LOCK shows when a call-in goes up, three seconds before the launch', counterplay: 'Kill him before you call it. A dead team cannot fire' },
  { id: 'radioJammer', habit: 'callIns', from: 3, tell: 'A man with a mast on his pack. Call-ins read UPLINK JAMMED and wait', counterplay: 'Kill the operator: everything waiting goes at once' },
  { id: 'helmets', habit: 'headshots', from: 2, tell: 'A visor and a thicker helmet you can see', counterplay: 'Three head hits strip one, or aim for the body' },
  { id: 'noSurrender', habit: 'executions', from: 2, tell: 'Broken men run. Nobody kneels', counterplay: 'None needed. You earned this one' },
  { id: 'falseSurrender', habit: 'executions', from: 3, tell: 'Hands up, but he kept his gun, and there is a live grenade in the raised hand. The pin clicks at 6 m', counterplay: 'Shoot him from range, or give him six metres' },
  { id: 'riggedCasualties', habit: 'baiting', from: 3, tell: 'A screaming man with a blinking vest, beeping faster as you close', counterplay: 'Shoot him from over 7 m. It takes anyone near him too' },
  { id: 'radioSilence', habit: 'chatter', from: 2, tell: 'The feed goes quiet', counterplay: 'Use your ears and your sonar instead' },
  { id: 'falseChatter', habit: 'chatter', from: 3, tell: 'A callsign that cannot exist: squads have six seats and this one says seven', counterplay: 'Ping before you go. The room it names is empty and wired' },
];

export interface TrickDef {
  id: TrickId;
  /** First wave it can happen. Tricks are the humans' own and do not wait for a habit. */
  from: number;
  tell: string;
  counterplay: string;
}

export const TRICKS: readonly TrickDef[] = [
  { id: 'playDead', from: 4, tell: 'No blood under him, and sonar lights him as alive', counterplay: 'Ping before you walk past. Shoot the body. Corpses cost nothing' },
  { id: 'riggedCorpses', from: 5, tell: 'A blinking charge on a body from last round', counterplay: 'Shoot it, or walk round it' },
  { id: 'sacrifice', from: 6, tell: 'A squad stands in the open and will not take cover. Red smoke follows', counterplay: 'Do not go to them. Kill the spotter' },
  { id: 'dangerClose', from: 6, tell: 'A man shouts it and drops red smoke at his own feet', counterplay: 'Leave. Whoever stays gets the shells, and the gift score is yours' },
  { id: 'deadMan', from: 7, tell: 'A red light in his fist. When he drops, it beeps fast', counterplay: 'Kill him at range, or get six metres away in a second and a half' },
  { id: 'riggedRooms', from: 8, tell: 'Blinking charges on the walls, then a klaxon three seconds before they go', counterplay: 'Get out of the room when you hear it, or shoot a charge from the door' },
  { id: 'barricades', from: 8, tell: 'A steel shutter slams across a door with a klaxon and a stamped warning', counterplay: 'Another door always exists. Explosives break the shutter' },
];

export type Phase = 'contact' | 'adaptation' | 'desperation' | 'lastStand';
/** Section 18: the Commander's voice follows the phase. */
export type Tone = 'smug' | 'irritated' | 'rattled' | 'cracked';

export const TONE_OF: Record<Phase, Tone> = { contact: 'smug', adaptation: 'irritated', desperation: 'rattled', lastStand: 'cracked' };

/** The wave the Commander comes down himself. A run that gets here is at its end. */
export const FINAL_WAVE = 10;

/** Section 16.4's arc, in waves. The box after a wave speaks in the phase of the wave to come. */
export function phaseOf(wave: number): Phase {
  if (wave <= 2) return 'contact';
  if (wave <= 5) return 'adaptation';
  if (wave <= 8) return 'desperation';
  return 'lastStand';
}

export const adaptationDef = (id: AdaptationId): AdaptationDef => ADAPTATIONS.find(a => a.id === id)!;
