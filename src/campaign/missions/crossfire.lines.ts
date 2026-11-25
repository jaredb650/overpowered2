/**
 * Complete dialogue script for the 4-part "Crossfire" campaign
 * (`Form 7742-W: Cross-Border Liability Transfer`).
 *
 * All 72 lines are voiced via local Breeze TTS 2 in `public/audio/voice/mission.crossfire.*.mp3`
 * (see `docs/notes/voices.md` for voice IDs and casting).
 * Speaker mapping (dedicated Crossfire entries in `src/enemies/commander/lines.ts` & `src/ui/commander/portrait.ts`):
 *   council   — The Galactic Council / Bureau Compliance Officer (`council`)
 *   darrow    — Colonel Darrow, Northern Command CO at Valken Airbase (`co_darrow`)
 *   halvorsen — General Halvorsen, Southern Directorate CO at Fortress Halcyon (`co_halvorsen`)
 *   mercer    — Captain Mercer, Bureau Ground Force CO at Halcyon Beachhead (`tank_ironclad_sgt`)
 *   viper     — Viper Flight (buddy squad wingmen / B-1B co-pilot / air wing) (`pilot_serious_atc`)
 *   carrier   — CVN-91 Actual (Carrier Air Control / recovery net) (`pilot_airline_vet`)
 */
import type { Emotion, Line, Speaker } from '../../enemies/commander/lines';

const line = (id: string, speaker: Speaker, emotion: Emotion, text: string): Line => ({
  id: `mission.crossfire.${id}`,
  speaker,
  emotion,
  text,
});

// -------------------------------------------------------------------------------------------------
// Part 1 — Valken Airbase (`crossfireAirbase.ts`)
// -------------------------------------------------------------------------------------------------

export const CROSSFIRE_AIRBASE_LINES: readonly Line[] = [
  // Opening & Section 1: South Perimeter & Radar Gate
  line(
    'airbase.council.brief.1',
    'council',
    'deadpan',
    'Form 7742-W: Cross-Border Liability Transfer. Northern Command and the Southern Directorate have declined to eliminate each other on budget.',
  ),
  line(
    'airbase.council.brief.2',
    'council',
    'deadpan',
    'Borrow a Northern B-1B Lancer with its live transponder intact and deliver its payload to Southern headquarters. Keep the receipt.',
  ),
  line(
    'airbase.wingman.perimeter.start',
    'viper',
    'orders',
    'Gate charge is blown — technicals and heavy armor punching through! Viper-2 and Viper-3 on your six, assault platoons rolling in. Push past the radar gate!',
  ),
  line(
    'airbase.darrow.perimeter.lockdown',
    'darrow',
    'orders',
    'This is Colonel Darrow! Southern Directorate raiders just blew the South Radar Gate — armored column and guntrucks pouring onto the base! Seal the Alert Hangar blast doors now!',
  ),
  line(
    'airbase.wingman.perimeter.clear',
    'viper',
    'orders',
    'South gate is ours. Push onto the fuel apron — watch the maintenance catwalks!',
  ),

  // Section 2: Fuel Apron & Hangar Row
  line(
    'airbase.darrow.apron.qrf',
    'darrow',
    'irritated',
    'Roll the west apron QRF trucks and lock down the hangar row! Do not let those Southern bastards reach the taxiway!',
  ),
  line(
    'airbase.wingman.apron.fuel',
    'viper',
    'orders',
    'Inner blast gate is locked down and their tank is blocking our armor! Blow the marked JP-8 fuel depots to rupture that red pipeline and crack their barricade wide open!',
  ),
  line(
    'airbase.wingman.apron.fuel_blown',
    'viper',
    'smug',
    'Pipeline detonation blew the inner blast gate clean off its hinges! Armor pushing through the smoke — move on the ATC tower!',
  ),

  // Section 3: 3-Level ATC Tower & Hangar Override / IFF Spoof Console
  line(
    'airbase.wingman.tower.enter',
    'viper',
    'orders',
    'Three flights up to Flight Ops. Clear the stairwell and hit the Hangar Override console — we need those blast doors open and the Northern IFF welded on.',
  ),
  line(
    'airbase.darrow.tower.warning',
    'darrow',
    'urgent',
    'Southern commandos are inside the control tower! Stop them before they reach the ops cab — if they crack the alert vault, that Lancer is loaded live!',
  ),
  line(
    'airbase.council.tower.iff',
    'council',
    'deadpan',
    'Reminder: Northern Command transponder encryption must remain active. An anonymous bombing is merely vandalism; a signed one is foreign policy.',
  ),
  line(
    'airbase.wingman.tower.override_done',
    'viper',
    'smug',
    'Blast doors cycling open and Northern IFF is locked solid! Wait — Darrow just rolled armor onto the alert apron!',
  ),
  line(
    'airbase.darrow.tower.breached',
    'darrow',
    'rattled',
    'Blast doors are open! Every gun on the runway — put a main battle tank in front of that hangar! Nobody takes that bomber!',
  ),

  // Section 4: Hardened Alert Hangar & QRF Armor Push
  line(
    'airbase.wingman.hangar.push',
    'viper',
    'urgent',
    'Northern tank rolling down the runway and QRF trucks closing fast! Our Aegis armor is engaging — smash their line while Viper-2 and Viper-3 sprint for the parked F-22s!',
  ),
  line(
    'airbase.wingman.hangar.raptors_boarding',
    'viper',
    'orders',
    'Viper-2 and Viper-3 are strapped into the Raptor cockpits — turbines spooling! Clear the apron and grab the big bird!',
  ),
  line(
    'airbase.darrow.hangar.desperate',
    'darrow',
    'rattled',
    'They are taking the Raptors too! Shoot the tires, shoot the intakes, stop them on the concrete!',
  ),

  // Section 5: Climb into the B-1B Lancer & Runway Takeoff
  line(
    'airbase.wingman.takeoff.board',
    'viper',
    'orders',
    'Apron is clear! Climb into the B-1B Lancer, roll her onto Runway Zero-One, and slam the afterburners — we are launching on your wings!',
  ),
  line(
    'airbase.wingman.takeoff.rolling',
    'viper',
    'urgent',
    'Lancer rolling! Viper flight releasing brakes — pull up at the north threshold and punch for the coast!',
  ),
  line(
    'airbase.darrow.takeoff.airborne',
    'darrow',
    'cracked',
    'She is airborne! Southern raiders just stole a live Northern Lancer and she is banking straight for the Strait! Get me Northern Air Command — scramble every interceptor we have!',
  ),
  line(
    'airbase.council.takeoff.handoff',
    'council',
    'deadpan',
    'Valken departure logged. Transferring neural seat from Contractor #7712-A to Contractor #7712-B in the escort F-22 Raptor.',
  ),

  // Part 1 Redeploy
  line('airbase.redeploy.1', 'viper', 'orders', 'Back on line, Viper Lead. Darrow still has that bomber locked up — push north.'),
  line('airbase.redeploy.2', 'council', 'deadpan', 'Replacement contractor billed to Northern Command under incidental staffing.'),
];

export const CROSSFIRE_AIRBASE_REDEPLOY: readonly string[] = [
  'mission.crossfire.airbase.redeploy.1',
  'mission.crossfire.airbase.redeploy.2',
];

// -------------------------------------------------------------------------------------------------
// Part 2 — Open-Sea Strait Outbound Escort (`crossfireStrait.ts`)
// -------------------------------------------------------------------------------------------------

export const CROSSFIRE_STRAIT_LINES: readonly Line[] = [
  // Section 1: Outbound Probe
  line(
    'strait.wingman.outbound.formup',
    'viper',
    'orders',
    'Seat transfer clean — you are in the F-22 escort. Lancer is heavy, seven-five-zero-zero hull, flying straight north on auto-nav. Keep the sky off her back.',
  ),
  line(
    'strait.darrow.guard.warning',
    'darrow',
    'urgent',
    'NORTHERN AIR COMMAND, PRIORITY FLASH! This is Colonel Darrow at Valken! Southern raiders hijacked a live B-1B with our transponder active — launch the northern interceptor wing immediately—',
  ),
  line(
    'strait.council.jamming',
    'council',
    'deadpan',
    'Northern Air Command emergency frequency has been reassigned to static. Premature interceptor scrambles interfere with schedule.',
  ),
  line(
    'strait.wingman.probe.bogeys',
    'viper',
    'urgent',
    'Three Southern Hornets coming fast through the sea stacks! Weapons hot — do not let them touch the bomber!',
  ),
  line(
    'strait.wingman.probe.clear',
    'viper',
    'orders',
    'First wave splashed. Heads up — two Southern missile destroyers dead ahead in the channel.',
  ),

  // Section 2: Destroyer Gauntlet
  line(
    'strait.halvorsen.gauntlet.fury',
    'halvorsen',
    'irritated',
    'This is General Halvorsen at Fortress Halcyon. A Northern heavy bomber in our airspace with zero declaration? You bastards want a war — you just bought one.',
  ),
  line(
    'strait.halvorsen.gauntlet.fire',
    'halvorsen',
    'urgent',
    'Ironclad! Bastion! Weapons free on every Northern signature in the strait! Launch SeaRAMs and scramble the strike wing!',
  ),
  line(
    'strait.wingman.gauntlet.sams',
    'viper',
    'urgent',
    'Destroyers lighting up SeaRAMs and CIWS on the Lancer! Harriers and Warthogs diving from the flanks — shred the ships or pull their fire!',
  ),
  line(
    'strait.wingman.gauntlet.suppressed',
    'viper',
    'smug',
    'Destroyer SAM mounts silenced! Lancer is through the mid-strait gauntlet — Halcyon coast coming up in the smoke!',
  ),

  // Section 3: Coastal Aces & Feet-Dry Handoff
  line(
    'strait.halvorsen.coastal.aces',
    'halvorsen',
    'urgent',
    'Red-Wing Lead, scramble immediately! That Northern bomber does not cross our seawall — tear it out of the sky!',
  ),
  line(
    'strait.wingman.coastal.incoming',
    'viper',
    'urgent',
    'Southern Raptor Ace plus Hornet CAP dropping out of the coastal cloud deck! Clear the corridor so the Lancer hits feet-dry!',
  ),
  line(
    'strait.wingman.coastal.feet_dry',
    'viper',
    'smug',
    'Corridor clear! Lancer is crossing the coastline — Halcyon is wide open below us!',
  ),
  line(
    'strait.council.handoff.halcyon',
    'council',
    'deadpan',
    'Northern IFF confirmed on Southern radar. Returning neural seat to Contractor #7712-A inside the B-1B Lancer. Bomb bay doors armed.',
  ),

  // Part 2 Redeploy
  line('strait.redeploy.1', 'viper', 'urgent', 'Fresh F-22 on the wing. Lancer is still flying — stay between her and the bandits.'),
  line('strait.redeploy.2', 'council', 'deadpan', 'Escort aircraft loss deducted from mileage allowance. Re-engaging.'),
];

export const CROSSFIRE_STRAIT_REDEPLOY: readonly string[] = [
  'mission.crossfire.strait.redeploy.1',
  'mission.crossfire.strait.redeploy.2',
];

// -------------------------------------------------------------------------------------------------
// Part 3 — Fortress Halcyon Combined-Arms War (`crossfireHalcyon.ts`)
// -------------------------------------------------------------------------------------------------

export const CROSSFIRE_HALCYON_LINES: readonly Line[] = [
  // Section 1: Beachhead Breach
  line(
    'halcyon.council.arrive',
    'council',
    'deadpan',
    'Welcome back to the B-1B Lancer. Four ordnance profiles are loaded: Snake-Eyes, CBU-105 Cluster, Napalm, and BLU-121 Thermobaric. Please avoid leaving intact real estate.',
  ),
  line(
    'halcyon.mercer.breach.call',
    'mercer',
    'urgent',
    'Lancer, this is Captain Mercer on the south beach! My Aegis tanks and Bastion APCs are pinned outside their seawall — blow a hole in Section B of their south blast wall and silence the two outer flak towers!',
  ),
  line(
    'halcyon.wingman.breach.escort',
    'viper',
    'orders',
    'Viper flight keeping enemy Hornets off your tail! Line up south-to-north and crack Section B wide open!',
  ),
  line(
    'halcyon.halvorsen.breach.shock',
    'halvorsen',
    'irritated',
    'Northern armor on my beach and a Northern B-1B overhead?! Sound general quarters — wire every coastal battery and call Directorate High Command for full retaliation!',
  ),
  line(
    'halcyon.mercer.breach.open',
    'mercer',
    'orders',
    'Section B is rubble and the outer flak is burning! All armor — punch through the gap! Follow the smoke!',
  ),

  // Section 2: Ridge Suppression & Valkyrie Fast-Rope Assault
  line(
    'halcyon.halvorsen.ridge.traps',
    'halvorsen',
    'smug',
    'Let their tanks roll into the courtyard. Unmask the forward mortar trenches and fire every SAM battery on the ridge!',
  ),
  line(
    'halcyon.mercer.ridge.pinned',
    'mercer',
    'urgent',
    'Mortar rain all over the breach and SAMs locking our inbound Valkyrie choppers! Drop CBU-105 Cluster on those mortar pits and wipe the outer SAM pads!',
  ),
  line(
    'halcyon.mercer.ridge.clear',
    'mercer',
    'orders',
    'Mortars are slag and the outer SAMs are gone! Valkyrie flight, you are green for inner courtyard fast-rope!',
  ),
  line(
    'halcyon.wingman.ridge.valkyries',
    'viper',
    'orders',
    'Valkyrie One and Two diving on the inner flanks — dropping Bureau assault squads right into their courtyard!',
  ),

  // Section 3: War Machine Open-Hunting Climax
  line(
    'halcyon.halvorsen.warmachine.unleash',
    'halvorsen',
    'urgent',
    'Open the west Tank Armory and scramble every bird in the hardened hangars! Grind their invasion into the tarmac!',
  ),
  line(
    'halcyon.mercer.warmachine.hunt',
    'mercer',
    'orders',
    'Full war down here, Lancer! Flatten their Tank Armory, hardened hangars, fuel farm, radar domes, and barracks — break Halcyon’s spine so our armor can take the plaza!',
  ),
  line(
    'halcyon.mercer.warmachine.armory_down',
    'mercer',
    'orders',
    'West Tank Armory just went up! No more enemy armor rolling out of that depot!',
  ),
  line(
    'halcyon.wingman.warmachine.airfield_down',
    'viper',
    'smug',
    'Hardened hangars and flight line are ashes! Halcyon has no runway left to scramble from!',
  ),
  line(
    'halcyon.mercer.warmachine.fuel_down',
    'mercer',
    'orders',
    'Fuel farm chain-detonated! Felt that shockwave through my tank hull!',
  ),
  line(
    'halcyon.halvorsen.warmachine.cracking',
    'halvorsen',
    'rattled',
    'My fuel farm, my hangars, my armor — all burning! Where is Directorate Air Command?! Tell them the North just razed Halcyon!',
  ),
  line(
    'halcyon.mercer.warmachine.broken',
    'mercer',
    'orders',
    'Their war machine is cooked! My tanks are ringing the central Citadel — only Halvorsen’s Command HQ is left standing!',
  ),

  // Section 4: Citadel Command HQ & Sea Egress
  line(
    'halcyon.halvorsen.citadel.seal',
    'halvorsen',
    'cracked',
    'Seal the blast shutters! Four meters of reinforced concrete — come and dig me out, you Northern cowards! Our missiles are already fueling for Valken!',
  ),
  line(
    'halcyon.mercer.citadel.thermobaric',
    'mercer',
    'urgent',
    'Citadel Command HQ is Tier-3 reinforced! Switch to BLU-121 Thermobaric and drop the whole roof on Halvorsen’s head!',
  ),
  line(
    'halcyon.halvorsen.citadel.final',
    'halvorsen',
    'cracked',
    'The ceiling is buckling— tell High Command... burn the North to the bedrock—',
  ),
  line(
    'halcyon.mercer.citadel.destroyed',
    'mercer',
    'orders',
    'Direct hit! Citadel HQ is a crater! Fortress Halcyon is flattened — get that smoking bomber back out to sea before their last fighters box you in!',
  ),
  line(
    'halcyon.wingman.egress.damage',
    'viper',
    'urgent',
    'Lancer’s port engine is trailing smoke and bomb bays are dry! Banking south over the strait — Red-Wing survivors are chasing us home!',
  ),
  line(
    'halcyon.council.handoff.return',
    'council',
    'deadpan',
    'Fortress Halcyon structural balance reduced to zero. Returning neural seat to Contractor #7712-B in the F-22 Raptor for dusk recovery.',
  ),

  // Part 3 Redeploy
  line('halcyon.redeploy.1', 'mercer', 'urgent', 'Lancer back on station! Line up your run — my squads need bombs on target!'),
  line('halcyon.redeploy.2', 'council', 'deadpan', 'Bomber hull reinstated from contingency reserve. Ordnance meter still running.'),
];

export const CROSSFIRE_HALCYON_REDEPLOY: readonly string[] = [
  'mission.crossfire.halcyon.redeploy.1',
  'mission.crossfire.halcyon.redeploy.2',
];

// -------------------------------------------------------------------------------------------------
// Part 4 — Strait Dusk Egress & Finale (`crossfireReturn.ts`)
// -------------------------------------------------------------------------------------------------

export const CROSSFIRE_RETURN_LINES: readonly Line[] = [
  // Section 1: Dusk Ambush
  line(
    'return.wingman.ambush.start',
    'viper',
    'urgent',
    'You are back in the F-22! Lancer is leaking fuel and running on three engines — two Ace Raptors and four Hornets diving out of the dusk clouds straight at her!',
  ),
  line(
    'return.wingman.ambush.lancer',
    'viper',
    'urgent',
    'This is Lancer! Bomb bays are empty, flares almost spent — keep Red-Wing off my tail until we reach the carrier!',
  ),
  line(
    'return.wingman.ambush.broken',
    'viper',
    'smug',
    'Red-Wing lead is down! Keep pushing south — CVN-91 is on radar!',
  ),

  // Section 2: Carrier Umbrella
  line(
    'return.wingman.carrier.approach',
    'carrier',
    'orders',
    'CVN-91 Actual to Viper flight: we have your wounded bomber on scope. Hold off the last pursuers until she crosses the four-forty recovery line!',
  ),
  line(
    'return.wingman.carrier.umbrella_hot',
    'viper',
    'urgent',
    'Lancer crossing the umbrella! Harbinger and Resolute opening CIWS and SeaRAMs — clear the sky!',
  ),
  line(
    'return.wingman.carrier.safe',
    'viper',
    'smug',
    'Lancer is inside the carrier bubble and trailing clean! Pursuers are breaking off — we made it home!',
  ),

  // Section 3: Council Deadpan Debrief
  line(
    'return.council.debrief.1',
    'council',
    'deadpan',
    'Form 7742-W status: complete. Sixteen minutes ago, Southern Directorate strategic forces launched full-scale retaliation against Northern Command.',
  ),
  line(
    'return.council.debrief.2',
    'council',
    'deadpan',
    'Northern Command has responded in kind across every contested border. Mutual liquidation is now self-funding, yielding a 42 percent Bureau cost reduction.',
  ),
  line(
    'return.council.debrief.3',
    'council',
    'deadpan',
    'Commendation noted on your file. An invoice for thirty-eight tons of borrowed Northern munitions has been deducted from your retainer. Dismissed.',
  ),

  // Part 4 Redeploy
  line('return.redeploy.1', 'viper', 'urgent', 'Back in the dusk sky — keep that smoking Lancer alive until the carrier guns cover us!'),
  line('return.redeploy.2', 'council', 'deadpan', 'Recovery window re-opened. Please return the bomber in reusable scrap condition.'),
];

export const CROSSFIRE_RETURN_REDEPLOY: readonly string[] = [
  'mission.crossfire.return.redeploy.1',
  'mission.crossfire.return.redeploy.2',
];

/** Combined catalogue of every Crossfire line across all 4 parts (for global uniqueness tests). */
export const CROSSFIRE_ALL_LINES: readonly Line[] = [
  ...CROSSFIRE_AIRBASE_LINES,
  ...CROSSFIRE_STRAIT_LINES,
  ...CROSSFIRE_HALCYON_LINES,
  ...CROSSFIRE_RETURN_LINES,
];
