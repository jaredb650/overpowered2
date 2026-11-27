/**
 * Every spoken line in Mission 5 ("Desert Raid" — Surplus).
 *
 * Voices:
 *   quist  — Hadrek Quist ("the Salt King"): calm, frightening, slow, never threatens twice.
 *   tiamat — TIAMAT: angry Council alien ogre-robot, grandiose maniacal trash-talker mocking Quist & his walls.
 *   radio  — Convoy driver, Warthog / gunship pilots, friendly assault squad callouts.
 */
import type { Emotion, Line, Speaker } from '../../enemies/commander/lines';

const line = (id: string, speaker: Speaker, emotion: Emotion, text: string): Line => ({
  id: `mission.desert_raid.${id}`,
  speaker,
  emotion,
  text,
});

export const LINES: readonly Line[] = [
  // ---- Section 1: The Approach (dawn open desert, Jackal .50-cal HMG + 40mm AGL turret) ----
  line(
    'tiamat.approach.start',
    'tiamat',
    'orders',
    'YOUR SPECIES HAS BEEN DECLARED FORFEIT BY THE COUNCIL! PREPARE FOR EXTINCTION, INSECT! Contractor — man the fifty-cal and forty-mil and vaporize everything crawling on those dunes!',
  ),
  line(
    'council.approach.scold',
    'council',
    'deadpan',
    'Tiamat. This is an unencrypted desert band. Per Clause Nine, you are not authorized to announce the Galactic Council to local warlords.',
  ),
  line(
    'tiamat.approach.defiant',
    'tiamat',
    'orders',
    'WHO IS GOING TO REPORT US, MADAM SECRETARY?! ASHES DO NOT FILE COMPLAINTS! EVERY LAST BUG IN THIS CANYON WILL BE VAPORIZED BEFORE LUNCH!',
  ),
  line('radio.approach.lookouts', 'radio', 'orders', 'Lookout towers on the ridge! Bikes, quads, and technicals cresting the dunes — light them up!'),
  line('radio.approach.bikes', 'radio', 'urgent', 'Second pack of Saltblood bikes, quads, and gun trucks flanking hard! Hit them with everything!'),
  line('quist.approach.warn', 'quist', 'smug', "You're a long way from water. Turn around and I'll let you die of thirst instead."),
  line(
    'tiamat.approach.horizon',
    'tiamat',
    'orders',
    "Behold the pathetic dust-heap of Surplus! That rotting tin fuselage is the Salt King's throne?! HAHAHA! Keep the trigger pinned, Contractor — I want his kingdom reduced to gravel!",
  ),

  // ---- Section 2: The Wall (broadside shooting gallery) ----
  line(
    'tiamat.wall.broadside',
    'tiamat',
    'orders',
    "THESE WALLS ARE THE BEST DEFENSES YOU'VE GOT?! WHAT A JOKE! CONTRACTOR, BRING THEM DOWN! Blast his sheet-metal panels with forty-mil and snap those toothpick watchtowers at the knees!",
  ),
  line('quist.wall.trucks', 'quist', 'smug', 'Open the side gates. Put two trucks on their flanks and bleed them in the sand.'),
  line('radio.wall.sidegates', 'radio', 'urgent', 'Side gates swinging open! Technicals rolling out left and right!'),
  line('quist.wall.gate', 'quist', 'smug', 'You can scratch my walls all day. That gate held off an army.'),
  line(
    'tiamat.wall.warthog',
    'tiamat',
    'orders',
    'Held off an army?! HA! Your scrap-iron gate is an insult to metallurgy! Hog-One, vaporize that glorified barn door right now!',
  ),
  line('radio.wall.warthog', 'radio', 'urgent', 'Copy, Tiamat! Rolling in hot — keep your heads down!'),
  line(
    'tiamat.wall.breached',
    'tiamat',
    'orders',
    'HAHAHAHA! SO MUCH FOR YOUR MIGHTY GATE, SALT KING! Contractor — on foot! Go tear his ant-hill apart!',
  ),

  // ---- Section 3: The Warren (shantytown on foot) ----
  line(
    'tiamat.warren.enter',
    'tiamat',
    'orders',
    'Look at this cardboard slum! Tin shacks held together by rust and prayers! Blow straight through his pathetic walls, Contractor, or butcher them from the roofs!',
  ),
  line(
    'tiamat.warren.minigun',
    'tiamat',
    'orders',
    'My optics detect a mounted rotary cannon on the west roof! Seize it, Contractor, and turn his miserable street into confetti!',
  ),
  line('quist.warren.bounty', 'quist', 'irritated', 'A year of water to whoever brings me one of their heads.'),
  line('radio.warren.squad', 'radio', 'urgent', 'Assault Two pushing the east alley — whole town is pouring out of the shacks!'),
  line(
    'quist.warren.banter',
    'quist',
    'irritated',
    'Wait. What the hell is screaming on my radio? Are you using a broken megaphone or are you actually a toaster?',
  ),
  line(
    'tiamat.warren.push',
    'tiamat',
    'orders',
    'A TOASTER?! I AM TIAMAT, WORLD-BREAKER OF THE GALACTIC COUNCIL! AND YOU BRIBE YOUR VERMIN WITH PUDDLE SLUDGE?! Push north to his pump yard, Contractor — crush every last one of them!',
  ),
  line(
    'council.warren.scold',
    'council',
    'deadpan',
    'Tiamat. You just said Galactic Council over a public town loudspeaker. Again. I am deducting two hundred credits from your lubricant stipend.',
  ),
  line(
    'tiamat.warren.defiant',
    'tiamat',
    'urgent',
    'DEDUCT WHATEVER YOU WANT! THERE WILL BE ZERO WITNESSES WHEN WE ARE DONE!',
  ),

  // ---- Section 4: The Pump Yard & Extended Dark Storm Sewer ----
  line(
    'tiamat.pump.enter',
    'tiamat',
    'orders',
    'The Pump Yard! Slightly thicker garbage steel, still worthless! Quist hoards his little mud-well here — shatter his guards!',
  ),
  line('quist.pump.tower', 'quist', 'smug', 'You came for water. Have all of it.'),
  line(
    'tiamat.pump.sewer',
    'tiamat',
    'urgent',
    'He dropped his own water tower to block the street?! COWARD! Into the west storm grate, Contractor — engage Thermal and hunt the rats in the dark!',
  ),
  line('quist.sewer.dark.1', 'quist', 'rattled', 'Down in the drains. Come out where I can see you.'),
  line(
    'tiamat.sewer.ambush',
    'tiamat',
    'urgent',
    'Thermal blooms ahead! His filthy tunnel-worms are cowering behind the pillars! Purge the drain, Contractor!',
  ),
  line('quist.sewer.dark.2', 'quist', 'rattled', 'Check the grates! Put men on the terrace ridge before they climb out of the drain!'),
  line(
    'tiamat.sewer.exit',
    'tiamat',
    'orders',
    'Up the north ladder! Climb out of his cesspit and storm the High Terraces! Weapons hot!',
  ),

  // ---- Section 5: The High Terraces ("The Perches" — vertical village) ----
  line(
    'tiamat.terraces.start',
    'tiamat',
    'orders',
    'Stilted tents and matchstick watchtowers?! THIS is his citadel?! Contractor, chew through the timber supports and drop his whole ridge into the dirt!',
  ),
  line('quist.terraces.mock', 'quist', 'smug', 'Look up, little soldier. Every sniper in Surplus is staring down at your helmet.'),
  line(
    'quist.terraces.banter',
    'quist',
    'smug',
    'And tell your screaming alien robot to take a breath before he blows a fuse. Those stilts cost me three months of salvage.',
  ),
  line(
    'tiamat.terraces.push',
    'tiamat',
    'orders',
    'THREE MONTHS OF SALVAGE?! MY TOASTER HAS BETTER STRUCTURAL INTEGRITY! Tear down those miserable perches, Contractor, and breach the Salt Cave!',
  ),

  // ---- Section 6: The Salt Cave ("The Cistern Tunnels") ----
  line(
    'tiamat.cave.start',
    'tiamat',
    'orders',
    'Into his miserable little salt hole! Rotten timber shoring overhead and his elite vermin hiding in the dark — slaughter them all!',
  ),
  line('quist.cave.warn', 'quist', 'irritated', 'You crawled into my cisterns. Bury them under the rock and salt.'),
  line(
    'tiamat.cave.push',
    'tiamat',
    'orders',
    'Daylight ahead! Smash through his vanguard, Contractor — the Salt King is cowering inside his broken metal bird!',
  ),

  // ---- Section 7: The Plane (solid fuselage & Quist cornered finale) ----
  line(
    'tiamat.plane.enter',
    'tiamat',
    'orders',
    "At last — Quist's rusted cargo coffin! Solid fuselage steel, so your rounds won't pierce the hull. Rip through his welded-armor pets!",
  ),
  line('quist.door1', 'quist', 'irritated', 'Seal bulkhead one. Let them chew on iron.'),
  line(
    'tiamat.door1.locked',
    'tiamat',
    'orders',
    'He slammed bulkhead one like a frightened beetle! Annihilate his guards in that bay and I will rip the override wide open!',
  ),
  line(
    'tiamat.door1.open',
    'tiamat',
    'orders',
    'HAHA! Your precious iron lock lasted three seconds! Bulkhead one is open — advance, Contractor!',
  ),
  line('quist.door2', 'quist', 'rattled', 'Hold the aft door! Keep them off the tail!'),
  line(
    'tiamat.door2.locked',
    'tiamat',
    'orders',
    'A SECOND door?! Pathetic! Purge his heavies, Contractor, and I will crack his little tin can open!',
  ),
  line(
    'tiamat.door2.open',
    'tiamat',
    'orders',
    'Aft bulkhead breached! Nowhere left to slither, Salt King! Go finish him, Contractor!',
  ),

  // Quist's 15-20 s cornered speech (4 crisp lines, honoring draft verbatim)
  line('quist.speech.1', 'quist', 'hushed', 'Eleven years I kept this town alive. Water, food, order.'),
  line('quist.speech.2', 'quist', 'hushed', "You think the people here hate me? They need me. When you leave, they'll be killing each other over a bucket by morning."),
  line('quist.speech.3', 'quist', 'smug', "You didn't come here to free anyone. You came to break something."),
  line('quist.speech.4', 'quist', 'hushed', 'Well. Look around. You did.'),

  // Tap-E interactive replies during speech
  line('quist.reply.1', 'quist', 'smug', "Who sent you? Doesn't matter. Somebody always does."),
  line('quist.reply.2', 'quist', 'irritated', "No. I won't beg."),

  // Quist outcome lines & TIAMAT confirmations
  line('quist.captured', 'quist', 'irritated', 'Watch the wrists. You think hauling me out changes what this desert is?'),
  line('quist.suicide', 'quist', 'hushed', 'Not by your hand.'),
  line('quist.grenade', 'quist', 'cracked', "Come closer. I'll tell you a secret."),
  line(
    'tiamat.quist.captured',
    'tiamat',
    'orders',
    'HAHAHA! The mighty Salt King in chains! Drag the sniveling insect to the forecourt, Contractor — the trucks are rolling in!',
  ),
  line(
    'tiamat.quist.killed',
    'tiamat',
    'orders',
    'EXTINCTION CONFIRMED! The Salt King is paste! March to the forecourt for extraction, Contractor!',
  ),
  line(
    'tiamat.quist.suicide',
    'tiamat',
    'orders',
    'HAHA! The coward vaporized himself to avoid my wrath! Still fulfills the Council quota! Get to the forecourt!',
  ),
  line(
    'tiamat.quist.grenade',
    'tiamat',
    'urgent',
    'He pulled a pin in the tail?! What a desperate little bug! Still breathing, Contractor? Stomp out to the forecourt!',
  ),

  // ---- Section 8: Escort & Exfil + Town-Flattening Ending ----
  line('radio.exfil.arrive', 'radio', 'orders', "Convoy smashing into the forecourt! Tailgate's down — get on the turret!"),
  line(
    'tiamat.exfil.board',
    'tiamat',
    'orders',
    'The rigs have arrived! Mount the middle turret now, Contractor — time to leave this dust-pit in flames!',
  ),
  line(
    'tiamat.escort.start',
    'tiamat',
    'orders',
    'March the pathetic warlord to the middle truck! And keep falling debris off his skull — the Council prefers its specimens intact!',
  ),
  line(
    'tiamat.escort.crushed',
    'tiamat',
    'orders',
    'HAHAHA! His own rotten junkyard fell on his head! Glorious poetic justice! Get on the rig, Contractor — we roll!',
  ),
  line(
    'tiamat.escort.shot',
    'tiamat',
    'orders',
    'Executive termination! I approve of your enthusiasm, Contractor! Climb on the middle rig — we are moving!',
  ),
  line('radio.exfil.chase', 'radio', 'urgent', 'Pedal down! Every Saltblood left in Surplus is on our bumper — sweep the flanks!'),
  line(
    'tiamat.exfil.airstrike',
    'tiamat',
    'orders',
    'Clear of his pathetic wall! All air units — OBLITERATE SURPLUS! Leave not one wall standing!',
  ),
  line('radio.exfil.strikes', 'radio', 'orders', 'Hog-One and gunships inbound. Stand back and watch the dust.'),
  line(
    'council.exfil.scold',
    'council',
    'deadpan',
    'For the record, Tiamat, flattening an entire settlement with close air support is not what the Bureau calls a covert extraction.',
  ),
  line(
    'tiamat.exfil.defiant',
    'tiamat',
    'orders',
    'HAHAHA! LOOK AT THAT DUST CLOUD, MADAM SECRETARY! NO SURVIVORS, NO WITNESSES, NO PAPERWORK! MISSION ACCOMPLISHED!',
  ),

  // Captured Quist watching Surplus levelled from the truck bed
  line('quist.ending.1', 'quist', 'rattled', 'Listen to that. Eleven years of iron and water, turned back to sand in ten seconds.'),
  line('quist.ending.2', 'quist', 'cracked', "They'll dig another well. Somebody else will sit in that fuselage. You fixed nothing."),
  line('quist.ending.3', 'quist', 'hushed', "Keep driving. Don't look back at what you made."),

  // ---- Redeploy Lines (TIAMAT) ----
  line('tiamat.redeploy.1', 'tiamat', 'orders', 'GET BACK UP, CONTRACTOR! The Council did not authorize your expiration — go crush his walls!'),
  line('tiamat.redeploy.2', 'tiamat', 'orders', 'That insect Quist is still yammering on his loudspeakers! Silence him at once!'),
  line('tiamat.redeploy.3', 'tiamat', 'orders', 'Fresh frame deployed! Stop bleeding and resume the extinction, Contractor!'),
];

export const REDEPLOY_LINES: readonly string[] = [
  'mission.desert_raid.tiamat.redeploy.1',
  'mission.desert_raid.tiamat.redeploy.2',
  'mission.desert_raid.tiamat.redeploy.3',
];
