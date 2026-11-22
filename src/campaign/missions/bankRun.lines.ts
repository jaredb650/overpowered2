/**
 * Every spoken line in Mission 4 ("Bank Run", Form 7742-B).
 *
 * Voices:
 *   council   — Galactic Council / Office of Societal Compliance (deadpan bureaucratic lethality)
 *   radio     — Packmule 2-3 insertion pilot & Bailiff getaway Humvee driver
 *   governor  — Governor Reginald Sterling, Chairman of the Brine Central Reserve
 *               (arc: smug -> irritated -> rattled -> cracked, including the Day-2 Red-Goggles reveal)
 */
import type { Emotion, Line, Speaker } from '../../enemies/commander/lines';

const line = (id: string, speaker: Speaker, emotion: Emotion, text: string): Line => ({
  id: `mission.bank_run.${id}`,
  speaker,
  emotion,
  text,
});

export const LINES: readonly Line[] = [
  // ---- Act 1: Opening & Rooftop Fast-Rope ----
  line('council.intro.1', 'council', 'deadpan', 'Form 7742-B. With High Magistrate Vane unavailable at 06:00, the Stay of Liquidation has expired.'),
  line('council.intro.2', 'council', 'deadpan', 'The Brine Central Reserve is now past due. Please withdraw the bullion principal in person. Bagging fees apply.'),
  line('radio.fastrope', 'radio', 'orders', 'Packmule 2-3 over the pad! Ropes out — drop hot, roof detail has eyes on us!'),
  line('governor.roof.lock', 'governor', 'smug', 'Sir, this Reserve opens at 09:30, and you have just voided the helipad insurance. Sealing the stairwell blast doors now.'),
  line('council.skylight', 'council', 'deadpan', 'Stairwell access declined. The central glass skylight dome is rated Tier-1 masonry. Please use your Satchel Charges.'),
  line('governor.skylight.blown', 'governor', 'irritated', 'Did you just detonate forty tons of heritage skylight over my marble floor?! Security — bill him for the atrium and shoot him twice!'),

  // ---- Act 2: Vault Drill Defense ----
  line('council.drill.order', 'council', 'deadpan', 'Proceed to the Planetary Bullion Vault in the north wing and mount the Bureau Thermal Lance Drill.'),
  line('governor.drill.planted', 'governor', 'irritated', 'That thermal lance is not Underwriters-approved! Drop the lobby shutters and scramble Rapid Response through the roof hole!'),
  line('council.drill.25', 'council', 'deadpan', 'Thermal lance at twenty-five percent. Reserve SWAT fast-roping through your skylight aperture. Do try to keep the drill upright.'),
  line('governor.drill.jam1', 'governor', 'smug', 'Ha! Our titanium alloy just choked your discount Bureau drill! Sappers — get down there and blow that contraption off my vault!'),
  line('council.drill.50', 'council', 'deadpan', 'Fifty percent penetration. Heavy Reserve Enforcers entering the hall. Note that lost drills incur a two-thousand-five-hundred credit surcharge.'),
  line('governor.goggles.reveal', 'governor', 'rattled', 'Wait — freeze that lobby feed! The red goggles! You are the man from the Chancery! And Holdfast! My brother works at the Carrow branch — he says you are standing in his lobby RIGHT NOW!'),
  line('governor.drill.jam2', 'governor', 'rattled', 'How many of you ARE there?! Thermal stall again — tech team, plant the demolition charge on that lance before he gets inside!'),
  line('council.drill.75', 'council', 'deadpan', 'Seventy-five percent. Final security wave inbound. Reminder: the Council does not recognise claims of bilocation.'),
  line('governor.saboteur', 'governor', 'irritated', 'Demolition charge armed on the lance! Six seconds until your liquidation becomes my write-off!'),
  line('governor.vault.open', 'governor', 'cracked', 'NO! The planetary vault! That is three hundred years of sovereign gold backing! Seal the avenue — bring every BearCat in the district!'),

  // ---- Act 3: Bullion Plunder & Getaway Humvee ----
  line('council.plunder.start', 'council', 'deadpan', 'Vault open. Bag four mandatory gold bullion duffels. Additional pallets qualify for a bonus commission.'),
  line('radio.humvee.arrived', 'radio', 'orders', 'Bailiff 4-Actual on the front marble steps! Tailgate is down — heave the gold into the bed and jump on the fifty-cal!'),
  line('council.bags.quota', 'council', 'deadpan', 'Minimum withdrawal quota met. Mount the Humvee roof turret when ready, or secure remaining pallets for overtime.'),
  line('governor.breakout', 'governor', 'cracked', 'He is throwing solid bullion down my staircase! Prep AUDITOR-1 on the annex pad! If he makes the expressway, I am auditing him personally!'),

  // ---- Act 4: Highway .50 cal Chase & AUDITOR-1 Boss ----
  line('radio.highway.start', 'radio', 'urgent', 'Through the barricade! Hold onto the pintle — sixty cruisers on our tail down the Coastal Expressway!'),
  line('radio.highway.wave2', 'radio', 'urgent', 'SWAT BearCats closing from the rear! Watch those fuel tankers in the outer lanes — light them up!'),
  line('governor.boss.arrive', 'governor', 'cracked', 'THIS IS GOVERNOR STERLING ON AUDITOR-1! DROP THE GOLD STANDARD IMMEDIATELY OR I WILL LIQUIDATE YOUR CHASSIS!'),
  line('governor.boss.tail', 'governor', 'cracked', 'MY TAIL ROTOR! DO YOU KNOW WHAT THE QUARTERLY DEPRECIATION ON THIS AIRFRAME IS?!'),
  line('governor.boss.down', 'governor', 'cracked', 'MAYDAY! MAYDAY! THE BOARD WILL HEAR ABOUT THIS — TELL THEM TO SHORT BRINE—'),
  line('council.complete', 'council', 'deadpan', 'AUDITOR-1 written off. Coastal extraction tunnel reached. Principal secured. Notice of Completion will follow by post.'),

  // ---- Redeploy Lines ----
  line('council.redeploy.1', 'council', 'deadpan', 'Replacement contractor issued. Please avoid dropping the gold on your own feet.'),
  line('council.redeploy.2', 'council', 'deadpan', 'A ten percent administrative replacement fee has been deducted from your withdrawal.'),
  line('council.redeploy.3', 'council', 'deadpan', 'Governor Sterling remains solvent. Resuming audit.'),
];

export const REDEPLOY_LINES: readonly string[] = [
  'mission.bank_run.council.redeploy.1',
  'mission.bank_run.council.redeploy.2',
  'mission.bank_run.council.redeploy.3',
];
