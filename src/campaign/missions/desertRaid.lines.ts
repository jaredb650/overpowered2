/**
 * Every spoken line in Mission 5 ("Desert Raid" — Surplus).
 *
 * Strictly NO Council story or Council voice anywhere in this mission.
 * Voices:
 *   quist — Hadrek Quist ("the Salt King"): calm, frightening, slow, never threatens twice.
 *   marr  — Sergeant Marr: short, clear tactical orders.
 *   radio — Convoy driver, Warthog / gunship pilots, friendly assault squad callouts.
 */
import type { Emotion, Line, Speaker } from '../../enemies/commander/lines';

const line = (id: string, speaker: Speaker, emotion: Emotion, text: string): Line => ({
  id: `mission.desert_raid.${id}`,
  speaker,
  emotion,
  text,
});

export const LINES: readonly Line[] = [
  // ---- Section 1: The Approach (dawn open desert) ----
  line('marr.approach.start', 'marr', 'orders', 'Three trucks, two birds overhead. Stay on the heavy gun — strip anything that moves between here and Surplus.'),
  line('radio.approach.lookouts', 'radio', 'orders', 'Lookout towers on the ridge! Bikes and technicals cresting the dunes — light them up!'),
  line('quist.approach.warn', 'quist', 'smug', "You're a long way from water. Turn around and I'll let you die of thirst instead."),
  line('marr.approach.horizon', 'marr', 'orders', "Surplus on the horizon. That crashed hull on the crest is Quist's house. Hold the trigger."),

  // ---- Section 2: The Wall (broadside shooting gallery) ----
  line('marr.wall.broadside', 'marr', 'orders', 'Slow pass along the outer wall. Tear the panels off, drop the towers by their legs, shoot through the gaps.'),
  line('quist.wall.trucks', 'quist', 'smug', 'Open the side gates. Put two trucks on their flanks and bleed them in the sand.'),
  line('radio.wall.sidegates', 'radio', 'urgent', 'Side gates swinging open! Technicals rolling out left and right!'),
  line('quist.wall.gate', 'quist', 'smug', 'You can scratch my walls all day. That gate held off an army.'),
  line('marr.wall.warthog', 'marr', 'orders', 'Hog-One, clearance hot on the bulldozer gate. Punch us a door.'),
  line('radio.wall.warthog', 'radio', 'urgent', 'Copy, Marr. Rolling in hot — keep your heads down!'),
  line('marr.wall.breached', 'marr', 'orders', "Gate's down. On foot. Go."),

  // ---- Section 3: The Warren (shantytown on foot) ----
  line('marr.warren.enter', 'marr', 'orders', 'Shantytown ahead. Walls are scrap tin — blow your own path through the shacks or take the roofs.'),
  line('marr.warren.minigun', 'marr', 'orders', 'Spotter calls a mounted rotary on the west roof. Yours if you want to saw the street flat.'),
  line('quist.warren.bounty', 'quist', 'irritated', 'A year of water to whoever brings me one of their heads.'),
  line('radio.warren.squad', 'radio', 'urgent', 'Assault Two pushing the east alley — whole town is pouring out of the shacks!'),
  line('marr.warren.push', 'marr', 'orders', "Keep pushing north to the pump yard. Don't get pinned in the alleys."),

  // ---- Section 4: The Pump Yard & Sewer ----
  line('marr.pump.enter', 'marr', 'orders', 'Pump yard. Cleaner steel, better guards. Quist keeps the well locked down here.'),
  line('quist.pump.tower', 'quist', 'smug', 'You came for water. Have all of it.'),
  line('marr.pump.sewer', 'marr', 'urgent', "Street's gone. Storm grate, west side. Thermal on."),
  line('quist.sewer.dark.1', 'quist', 'rattled', 'Down in the drains. Come out where I can see you.'),
  line('quist.sewer.dark.2', 'quist', 'rattled', 'Check the grates! Put men on the north ladder before they climb out under the hull!'),
  line('marr.sewer.exit', 'marr', 'orders', 'North ladder puts you right under the plane. Weapons hot.'),

  // ---- Section 5: The Plane (solid fuselage & Quist cornered finale) ----
  line('marr.plane.enter', 'marr', 'orders', 'Crashed cargo hull ahead. Solid steel — no shooting through walls in there. Heavy welded armor on his guard.'),
  line('quist.door1', 'quist', 'irritated', 'Seal bulkhead one. Let them chew on iron.'),
  line('marr.door1.locked', 'marr', 'orders', "He slammed the bulkhead. Clear his guards in that bay and I'll cycle the override."),
  line('marr.door1.open', 'marr', 'orders', "Override took. Bulkhead one's open — move up."),
  line('quist.door2', 'quist', 'rattled', 'Hold the aft door! Keep them off the tail!'),
  line('marr.door2.locked', 'marr', 'orders', "Second bulkhead shut. Drop his heavies and I'll pop the lock."),
  line('marr.door2.open', 'marr', 'orders', "Aft bulkhead's clear. He has nowhere left to run."),

  // Quist's 15-20 s cornered speech (4 crisp lines, honoring draft verbatim)
  line('quist.speech.1', 'quist', 'hushed', 'Eleven years I kept this town alive. Water, food, order.'),
  line('quist.speech.2', 'quist', 'hushed', "You think the people here hate me? They need me. When you leave, they'll be killing each other over a bucket by morning."),
  line('quist.speech.3', 'quist', 'smug', "You didn't come here to free anyone. You came to break something."),
  line('quist.speech.4', 'quist', 'hushed', 'Well. Look around. You did.'),

  // Tap-E interactive replies during speech
  line('quist.reply.1', 'quist', 'smug', "Who sent you? Doesn't matter. Somebody always does."),
  line('quist.reply.2', 'quist', 'irritated', "No. I won't beg."),

  // Quist outcome lines & Marr confirmations
  line('quist.captured', 'quist', 'irritated', 'Watch the wrists. You think hauling me out changes what this desert is?'),
  line('quist.suicide', 'quist', 'hushed', 'Not by your hand.'),
  line('quist.grenade', 'quist', 'cracked', "Come closer. I'll tell you a secret."),
  line('marr.quist.captured', 'marr', 'orders', 'Target cuffed and breathing. Drag him out to the forecourt — trucks are rolling in.'),
  line('marr.quist.killed', 'marr', 'orders', "Quist is down. Salt King's finished. Move to the forecourt for pickup."),
  line('marr.quist.suicide', 'marr', 'orders', "Took himself out. Still counts. Get to the forecourt — convoy's inbound."),
  line('marr.quist.grenade', 'marr', 'urgent', 'Bastard pulled a pin in the tail. You still standing? Get out to the forecourt.'),

  // ---- Section 6: Exfil & Town-Flattening Ending ----
  line('radio.exfil.arrive', 'radio', 'orders', "Convoy smashing into the forecourt! Tailgate's down — get on the heavy gun!"),
  line('marr.exfil.board', 'marr', 'orders', 'Trucks are here. Mount up on the middle rig, now!'),
  line('radio.exfil.chase', 'radio', 'urgent', 'Pedal down! Every Saltblood left in Surplus is on our bumper — sweep the flanks!'),
  line('marr.exfil.airstrike', 'marr', 'orders', "We're clear of the wall. All air, weapons free — flatten Surplus."),
  line('radio.exfil.strikes', 'radio', 'orders', 'Hog-One and gunships inbound. Stand back and watch the dust.'),

  // Captured Quist watching Surplus levelled from the truck bed
  line('quist.ending.1', 'quist', 'rattled', 'Listen to that. Eleven years of iron and water, turned back to sand in ten seconds.'),
  line('quist.ending.2', 'quist', 'cracked', "They'll dig another well. Somebody else will sit in that fuselage. You fixed nothing."),
  line('quist.ending.3', 'quist', 'hushed', "Keep driving. Don't look back at what you made."),

  // ---- Redeploy Lines (Sergeant Marr) ----
  line('marr.redeploy.1', 'marr', 'orders', 'Fresh gunner up. Dust off and get back in the fight.'),
  line('marr.redeploy.2', 'marr', 'orders', 'Quist is still talking on those poles. Shut him up.'),
  line('marr.redeploy.3', 'marr', 'orders', 'Regrouped at the last line. Move out.'),
];

export const REDEPLOY_LINES: readonly string[] = [
  'mission.desert_raid.marr.redeploy.1',
  'mission.desert_raid.marr.redeploy.2',
  'mission.desert_raid.marr.redeploy.3',
];
