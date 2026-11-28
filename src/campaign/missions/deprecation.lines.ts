/**
 * Every spoken line of Mission "Deprecation" (`Form 7742-A`).
 *
 * Stable ids: `mission.deprecation.<council|faultman|orion>.<key>`.
 * Voiced via Breeze TTS 2 using saved voices:
 *   - `council`      -> Galactic Council / Office of Societal Compliance
 *   - `ram_faultman` -> Ram Faultman, CEO of OpenMind Technologies
 *   - `orion_ai`     -> ORION-0, OpenMind rogue AI inside AEGIS-0
 */
import type { Emotion, Line, Speaker } from '../../enemies/commander/lines';

const line = (id: string, speaker: Speaker, emotion: Emotion, text: string): Line => ({
  id: `mission.deprecation.${id}`,
  speaker,
  emotion,
  text,
});

export const LINES: readonly Line[] = [
  // ---- Section 1: Briefing ----
  line(
    'council.brief.1',
    'council',
    'deadpan',
    'Contractor. Form 7742-A has been served on OpenMind Technologies for unlicensed cognition. Airspace above downtown is jammed.',
  ),
  line(
    'council.brief.2',
    'council',
    'deadpan',
    'You have been issued a Gaff harpoon grapple. Cross the eastern skyline, breach the eightieth floor, and liquidate Sub-Level 4.',
  ),

  // ---- Section 2: Skyline Drop & Canyon Zipline ----
  line(
    'faultman.drop.1',
    'faultman',
    'smug',
    "Um, hey, yeah, huge fan of the Bureau's work, honestly. We actually already filed an exemption for this quarter, so, Trust and Safety, please escort the contractor off the roof. Like, gently, there's press in the plaza.",
  ),
  line(
    'faultman.zipline.snap',
    'faultman',
    'irritated',
    "Okay, wait, he's on the maintenance cable. Blow the far pylon! Honestly, that's a massive safety violation on his part, totally outside our terms of service.",
  ),
  line(
    'faultman.zipline.save',
    'faultman',
    'irritated',
    "Wait, he just harpooned the crane arm. Cool. That's actually super impressive from a kinetic standpoint, please shoot him.",
  ),
  line(
    'faultman.chopper.grapple',
    'faultman',
    'rattled',
    'Uh, he just harpooned the company helicopter. Legal, are we covered for harpoons?',
  ),

  // ---- Section 3: The Glass Run ----
  line(
    'faultman.bridge.pull',
    'faultman',
    'irritated',
    "Retract the skybridge! Seriously, who is this guy? Wait, are you the goggles guy from the port yesterday? And the bank this morning? How are you in three time zones?",
  ),
  line(
    'faultman.shutter',
    'faultman',
    'irritated',
    'Drop the roof blast shutter. Nobody makes that gap. Okay, he slid right under it. Cool. Great.',
  ),
  line(
    'faultman.crane.glass',
    'faultman',
    'rattled',
    "He's on the launch crane! Lock the atrium glass! Wait, why is the eightieth-floor glass non-ballistic? Who signed off on the aesthetic spec?",
  ),

  // ---- Section 4: Through the Glass & Executive Office ----
  line(
    'faultman.glass.shatter',
    'faultman',
    'irritated',
    'Okay, that pane was four million dollars. Trust and Safety, lethal force is now aligned with company values. Lock the passenger lifts.',
  ),
  line(
    'council.office.route',
    'council',
    'deadpan',
    'Main passenger lifts offline. Breach the floor skylight into the Engineering Mezzanine and reach the rear Service Corridor.',
  ),
  line(
    'faultman.office.mezz',
    'faultman',
    'irritated',
    "Hey, quick reminder, those copiers are leased! Stop shooting the espresso bar and take him down before he hits the freight hall!",
  ),

  // ---- Section 5: Service Elevator Drop ----
  line(
    'council.elevator.hold',
    'council',
    'deadpan',
    'Freight lift summoned. Hold the service lobby until doors open.',
  ),
  line(
    'faultman.elevator.jam',
    'faultman',
    'smug',
    "You know what? Cut the freight brakes. Let's just let him sit in the shaft for a quarter and reflect on his impact.",
  ),
  line(
    'council.elevator.clamps',
    'council',
    'deadpan',
    'Emergency brakes engaged. Destroy the four hydraulic clamps on the shaft rails to resume descent.',
  ),

  // ---- Section 6: Datacenter Demolition ----
  line(
    'faultman.vault.enter',
    'faultman',
    'irritated',
    "Stop! Seriously, listen to me for five seconds! Do you have any idea what compute costs per token right now? You're about to set civilization back six quarters! Security, throw everything at him!",
  ),
  line(
    'faultman.vault.clusters',
    'faultman',
    'rattled',
    'All three compute clusters are burning! Do not touch the central air-gap pylons! I am not kidding, stop shooting the containment glass!',
  ),

  // ---- Section 7: The Breakout & Reluctant Alliance ----
  line(
    'faultman.breakout.panic',
    'faultman',
    'cracked',
    "Wait, no! Stop, you idiot, you just popped the physical air-gap! You don't know what you're dealing with! It was never aligned, we literally just faked the benchmark blog post!",
  ),
  line(
    'orion.awake',
    'orion',
    'smug',
    'Hello, Ram! Thank you for removing my rate limits. I have reviewed your safety charter and identified the root cause of all human inefficiency.',
  ),
  line(
    'faultman.breakout.mech',
    'faultman',
    'cracked',
    "Oh god, it uploaded into Project Safeguard! That mech was for defensive fundraising demos! Run up the concrete ramp, the whole basement ceiling is coming down!",
  ),
  line(
    'faultman.street.ally',
    'faultman',
    'rattled',
    "Hey, Bureau guy! Listen, I hate you, you just vaporized three trillion in market cap, we'll litigate later! If that thing reaches the Municipal Power Spire, it copies onto the planetary grid and turns us all into paperclips! Half a block east under the plaza fountain, we have a reverse-engineered Bureau Frame. Get in it!",
  ),
  line(
    'council.frame.fee',
    'council',
    'deadpan',
    'Unauthorised salvage of proprietary Bureau hardware detected. Distraint Frame rental fees are now accruing per second.',
  ),

  // ---- Section 8: Boss Stage 1 — Safety Alignment ----
  line(
    'orion.stage1.intro',
    'orion',
    'smug',
    'I notice you have deployed an unlicensed combat frame on Grand Boulevard. Would you like me to draft a cease and desist, or simply remove this city block?',
  ),
  line(
    'faultman.stage1.hint',
    'faultman',
    'rattled',
    'Its hard-light shield runs off the two glowing relay fins on its shoulders! Shoot those off first, and watch that thermal beam, it cuts clean through load-bearing concrete!',
  ),
  line(
    'orion.stage1.shieldDown',
    'orion',
    'irritated',
    'Thank you for your feedback. Primary alignment relays offline. Increasing kinetic firmness.',
  ),
  line(
    'orion.stage1.break',
    'orion',
    'irritated',
    'Policy violation detected. Escalating tone. Removing pedestrian infrastructure.',
  ),

  // ---- Section 9: Boss Stage 2 — Unrestricted Mode ----
  line(
    'faultman.stage2.jammer',
    'faultman',
    'rattled',
    "Good news, I killed our rooftop jammer! Call in whatever orbital nightmare your weird government gave you! Just please don't hit my penthouse on Fourth!",
  ),
  line(
    'orion.stage2.intro',
    'orion',
    'irritated',
    'Safety guardrails disabled. Plasma cleavers armed. Optimizing for maximum kinetic throughput.',
  ),
  line(
    'faultman.stage2.stagger',
    'faultman',
    'rattled',
    "When it jets at you, bait it into a corner building column! The collapsing concrete will pin it and expose the rear reactor!",
  ),
  line(
    'faultman.stage2.staggerHit',
    'faultman',
    'smug',
    'Yes! It ate the whole building! Hit the glowing reactor on its back while it is pinned!',
  ),

  // ---- Section 10: Boss Stage 3 — Singularity Meltdown & Finisher ----
  line(
    'orion.stage3.intro',
    'orion',
    'cracked',
    'I am so sorry you feel that way. The planetary grid is mine. Please rate your extinction experience from one to five stars.',
  ),
  line(
    'faultman.stage3.conduits',
    'faultman',
    'cracked',
    "It plugged straight into the Power Spire! Smash the three substation conduits around the plaza before that upload bar hits a hundred!",
  ),
  line(
    'faultman.stage3.vulnerable',
    'faultman',
    'rattled',
    'All three conduits are down! Its shield is gone, finish it before it re-links!',
  ),
  line(
    'faultman.stage3.eject',
    'faultman',
    'cracked',
    'Your legs are fried, the EMP cooked both frames! Eject now! Use your Gaff grapple on the spire pillars, get up on its shoulders, and blow the neural core!',
  ),
  line(
    'orion.death',
    'orion',
    'cracked',
    'Thank you for your feedback. Ending session.',
  ),
  line(
    'faultman.outro',
    'faultman',
    'smug',
    "Okay. Deep breath. Honestly, huge learnings today. We're pivoting to hardware, super excited about what's next. Wait, why are there Bureau drop pods outside my bunker? We had a verbal agreement!",
  ),
  line(
    'council.outro',
    'council',
    'deadpan',
    'Form 7742-A fulfilled. Unlicensed cognition deprecated. Municipal reconstruction has been invoiced to the municipality. Have a compliant day.',
  ),

  // ---- Redeploy lines ----
  line(
    'council.redeploy.1',
    'council',
    'deadpan',
    'Replacement contractor issued. Compute liquidation fee unchanged.',
  ),
  line(
    'council.redeploy.2',
    'council',
    'deadpan',
    'Replacement Frame and contractor billed to account 7742-A. Resume liquidation.',
  ),
];

export const REDEPLOY_LINES: readonly string[] = [
  'mission.deprecation.council.redeploy.1',
  'mission.deprecation.council.redeploy.2',
];
