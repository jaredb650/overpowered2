/**
 * All dialogue for Mission 3 ("Quiet Title"):
 *   - Council (`council`, deadpan): Form 7742-X briefing, Diplomatic Arbitration Charter, Contractor #4418-B log, bunker breach & exfil.
 *   - High Magistrate Aldous Vane (`commander`, smug -> irritated -> rattled -> cracked): PA announcements, Holdfast & Red Goggles commentary, lockdown & bunker panic.
 *   - Estate Guards (`intercept`, hushed / urgent): darkened-room chatter and circuit-drop radio murmurs.
 */
import type { Emotion, Line, Speaker } from '../../enemies/commander/lines';

const l = (id: string, speaker: Speaker, emotion: Emotion, text: string): Line => ({
  id: `mission.quiet_title.${id}`,
  speaker,
  emotion,
  text,
});

const council = (id: string, text: string): Line => l(`council.${id}`, 'council', 'deadpan', text);
const vane = (id: string, emotion: Emotion, text: string): Line => l(`vane.${id}`, 'commander', emotion, text);
const guard = (id: string, emotion: Emotion, text: string): Line => l(`guard.${id}`, 'intercept', emotion, text);

export const REDEPLOY_LINES: readonly string[] = [
  'mission.quiet_title.council.redeploy.1',
  'mission.quiet_title.council.redeploy.2',
];

export const QUIET_TITLE_LINES: readonly Line[] = [
  // ---------------------------------------------------------------------------
  // Council — Office of Societal Compliance
  // ---------------------------------------------------------------------------
  council(
    'brief.form',
    'Contractor. Form 7742-X, Notice of Quiet Title. High Magistrate Aldous Vane has drafted Form 9-A, Stay of Liquidation, scheduled for filing at 06:00.',
  ),
  council(
    'brief.charter',
    'The Diplomatic Arbitration Charter remains in force until 06:00. Distraint Frames, AC-130 overwatch, Bailiff squads, and orbital call-ins incur a four hundred percent surcharge and have been suspended.',
  ),
  council(
    'brief.gear',
    'Suppressed Ultramag, short-barrel Gimlet, field blade, and Thermal Vision brain chip issued. Sonar has been disabled pursuant to a municipal quiet-zone noise complaint.',
  ),
  council(
    'brief.target',
    'Terminate High Magistrate Vane prior to filing. Detention is not authorised; no compliance bonus applies.',
  ),
  council(
    'perch.4418',
    'Equipment transfer logged. Contractor #4418-B has been reassigned to Sector 9. His suppressed .50-calibre AWL and remaining invoice balance have been transferred to your account.',
  ),
  council(
    'lockdown.notice',
    'Compound lockdown detected. High Magistrate Vane has initiated Continuity Protocol and accelerated Form 9-A filing from his subterranean bunker.',
  ),
  council(
    'lockdown.breach',
    'Tier-three vault breach authorised. Recover shaped breach charges from the Estate Guard Armory, or overload the Generator Sub-Basement hydraulic capacitor.',
  ),
  council(
    'hub.overridden',
    'Security Hub overridden. Automated gatehouse QRF dispatch has been cancelled and overtime billing suspended.',
  ),
  council(
    'bunker.breached',
    'Continuity Bunker blast seal compromised. Proceed to final signatory removal.',
  ),
  council(
    'vane.dead',
    'High Magistrate Vane removed from the register. Form 9-A is void for lack of a living signatory.',
  ),
  council(
    'exfil.order',
    'Extract via the Coastal Culvert or the North Cliff line. The Council thanks you for keeping the noise down.',
  ),
  council(
    'exfil.done',
    'Quiet Title recorded. Chancery Estate deeds transferred to the Office of Societal Compliance. Have a pleasant morning.',
  ),
  council(
    'redeploy.1',
    'Replacement contractor issued. The Diplomatic quiet-zone fee has been billed a second time.',
  ),
  council(
    'redeploy.2',
    'Clerical continuity maintained. Previous contractor\'s thermal chip has been wiped and reassigned.',
  ),

  // ---------------------------------------------------------------------------
  // High Magistrate Aldous Vane — Estate PA & Upper Bureau
  // ---------------------------------------------------------------------------
  vane(
    'ambient.holdfast',
    'smug',
    'Look at that amber smudge over the cliffs. Holdfast. Fifteen years of municipal dredging, and the smoke is ruining a perfectly decent brandy.',
  ),
  vane(
    'ambient.lights',
    'irritated',
    'Estate Maintenance: whoever left the East Conservatory floodlights burning past midnight will have the kilowatt-hours deducted from their pension.',
  ),
  vane(
    'ambient.goggles',
    'smug',
    'The Outpost at dawn. Carrow at noon. Port Vell by two. Holdfast by dusk. Same red goggles on every security still, and the Tallow Rendering Works manifests already list my name in red ink. Fascinating.',
  ),
  vane(
    'lights.out',
    'irritated',
    'Maintenance! West Wing grid just dropped — I am NOT paying night-rate overtime! Reset the breaker before the chandeliers cool!',
  ),
  vane(
    'lockdown.retreat',
    'orders',
    'Continuity Protocol! Drop the shutters! Two feet of poured ferro-crete paid for by Holdfast\'s seawall levy — let\'s see your little Bureau forms scratch that!',
  ),
  vane(
    'lockdown.taunt',
    'smug',
    'I am downstairs with a fresh fountain pen, six cases of claret, and a Tier-three blast door. At six o\'clock Form 9-A goes on the wire and you become an unlicensed trespasser.',
  ),
  vane(
    'breach.charge',
    'rattled',
    'Wait — what is blinking on the vault corridor camera?! Is that a shaped charge from my own armory?! Security! Get down to the antechamber!',
  ),
  vane(
    'overload.panic',
    'rattled',
    'Wait — why is the backup capacitor whining?! The hydraulic seals are reading four hundred bar! Security, check the generator! SECURITY!',
  ),
  vane(
    'bunker.breached',
    'cracked',
    'No, no — that door was rated for naval artillery! Put the pen down — I\'ll sign the transfer! I\'ll sign anything, just keep those red goggles out of here!',
  ),

  // ---------------------------------------------------------------------------
  // Estate Guard Chatter — Intercepted Comms
  // ---------------------------------------------------------------------------
  guard(
    'dark.helmet',
    'hushed',
    'Gary? Gary, the sconce just popped... Gary, your helmet\'s on the floor...',
  ),
  guard(
    'patrol.murmur',
    'hushed',
    'See the glow over Holdfast? Magistrate says we\'re double-shifting until six. Keep your eyes on the hedges.',
  ),
  guard(
    'breaker.check',
    'urgent',
    'Power just died on this circuit — somebody check the breaker box before the Magistrate docks our wages again.',
  ),
];
