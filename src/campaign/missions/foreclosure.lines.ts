/**
 * Every word of Foreclosure so far (docs/proposals/mission-2-plan.md). Nothing here is recorded and nothing will be generated: the lines
 * are rows with stable ids, `mission.foreclosure.<who>.<key>`, for the beat stages to rewrite and the voice script to take as they are.
 *
 * The Council's recorded opening and its redeploy lines are the Outpost's own rows, by id, so their takes play here too. The Harbourmaster
 * is her own speaker, the port's loudspeaker in the box (shortcut: no PA tone under her yet; a synth recipe when the voice pass comes).
 *
 * CALLS are the war's call-outs on the comms feed (src/campaign/war.ts), both sides: text only, never spoken, ids
 * `mission.foreclosure.call.<side>.<kind>.<n>`. FRONTS names each battle's squad on the feed and the word for where it is.
 */
import type { Emotion, Line, Speaker } from '../../enemies/commander/lines';
import type { CallKind, CallSide, Callout } from '../types';
import { OUTPOST_LINES } from './outpost.lines';

const l = (id: string, speaker: Speaker, emotion: Emotion, text: string): Line => ({ id: `mission.foreclosure.${id}`, speaker, emotion, text });
const council = (id: string, text: string): Line => l(`council.${id}`, 'council', 'deadpan', text);
const harbour = (id: string, text: string): Line => l(`harbour.${id}`, 'harbourmaster', 'hushed', text);
const radio = (id: string, text: string): Line => l(`radio.${id}`, 'radio', 'urgent', text);

/** The Outpost's takes this mission says again. */
export const REUSED = ['mission.council.brief.line', 'mission.council.redeploy.fee', 'mission.council.redeploy.keep'] as const;

export const FORECLOSURE_LINES: readonly Line[] = [
  ...OUTPOST_LINES.filter(line => (REUSED as readonly string[]).includes(line.id)),

  // briefing
  council('brief.form', 'Form 7742-F, Notice of Foreclosure. The free port of Holdfast garrisoned The Outpost. Its debts have transferred.'),
  council('brief.objection', 'Holdfast has filed an objection. Objections are not a recognised form.'),
  council('brief.frame', 'A Distraint Frame is available on request. Fees apply.'),

  // overwatch
  harbour('wave', 'Good morning, Holdfast. The tax man has come in person. Wave.'),
  radio('cover', 'Gunship, the 14th are going in on the flats. Keep their heads on.'),
  harbour('stove', 'To the gentleman in the sky: we read your notice. We used it to light the stove.'),
  council('lease', 'Gunship time is leased by the minute. Two minutes have been approved.'),
  harbour('lock', 'Danno, love, would you put one up at the gentleman for me?'),
  radio('lease', 'That is the end of the lease, contractor. You are on the ground.'),

  // landing
  harbour('landing', 'They\'re on the flats, Holdfast. Mind the salt, lads. It gets in your boots.'),
  council('revive', 'Stims are deducted from the contractor\'s fee. Bailiffs are deducted from the Office\'s. Revive at your discretion.'),

  // wall
  harbour('wall', 'That wall\'s older than your Office, love. It\'s had worse knocks than you.'),
  council('breach', 'A breaching charge has been issued to the 14th. Its Bailiff is not insured.'),

  // market
  harbour('market', 'Market\'s open. Everything\'s free today. Help yourselves.'),
  council('prisoners', 'Detainees are billable. Please do not damage them.'),
  harbour('lost', 'That\'s one of yours, Bailiffs. We\'ll keep him warm.'),

  // courier
  council('fees', 'Frame request received. A call-out fee, a delivery fee, and a fee for processing the fees. Approved.'),
  radio('courier', 'Courier is hit! Flak off the harbour wall! Going in by the dock!'),
  harbour('iron', 'That\'s a lot of iron to drop on a town that\'s behind on its rent.'),

  // slip, mount
  council('boot', 'By operating this Frame the contractor accepts liability for its contents.'),
  harbour('boot', 'They\'ve sent a suit of armour after a town of fishwives. Mother. Wake up.'),
  council('replacement', 'Replacement Frame issued. The fee has been deducted.'),

  // flak, pans
  council('sky', 'Airspace restored. Call-ins are available again, at the usual rates.'),
  harbour('mother', 'Mother\'s been pulling salt out of this flat since before your Office had a name.'),

  // mother
  council('eject', 'Hull breach. The Frame is a write-off. The contractor is not, yet.'),

  // ending
  harbour('form', 'Go on, then. Fill in your form.'),
  council('end.removed', 'Holdfast has been removed from the register.'),
  council('end.deductions', 'Deductions: one Distraint Frame, one courier, and the Bailiffs you lost.'),
  council('end.tallow', 'The residents are being shipped to Tallow for rendering. Tallow Rendering Works acknowledges receipt.'),
];

/** Each battle's squad on the feed, and the word for where it is fought (`{place}`). */
export const FRONTS: Readonly<Record<string, { name: string; place: string }>> = {
  flats: { name: '14th, second stick', place: 'flats' },
  eastStreet: { name: '9th Recoveries', place: 'step' },
  westWall: { name: '3rd Recoveries', place: 'wall' },
  marketCorner: { name: '9th Recoveries', place: 'corner' },
  squareCounter: { name: '22nd Recoveries', place: 'square' },
  quayRoad: { name: '22nd Recoveries', place: 'quay road' },
};

const said: Readonly<Record<CallSide, Partial<Record<CallKind, readonly string[]>>>> = {
  bureau: {
    contact: ['Contact! The {place}!', 'Hostiles on the {place}! Spread out!', 'Eyes on, they\'re dug in on the {place}!'],
    fire: ['Keep their heads down!', 'Suppressing!', 'Moving up, cover me!', 'Pushing left!', 'Hold this corner!', 'Rounds on that window!', 'Reloading! Cover!'],
    down: ['Man down!', '{Label}\'s hit! Pull him back!', 'Medic! Medic, on me!'],
    up: ['He\'s up! He\'s back in it!', 'Got him. On your feet.'],
    dead: ['We lost the {label}!', '{Label}\'s gone!'],
    charge: ['Setting the charge! Cover me!', 'Charge going on the wall! Keep them off me!'],
    breach: ['Breach! Breach! We\'re through!', 'Wall\'s down! Move, move!'],
    counter: ['Here they come again!', 'They\'re pushing back!'],
    clear: ['Clear on the {place}!', 'That\'s them done. Holding here.'],
  },
  militia: {
    contact: ['Bailiffs! On the {place}!', 'Black coats! There, there!', 'Here they come, the bloodsuckers!'],
    fire: ['Give them the gun!', 'Keep shooting!', 'Push them back to the water!', 'Shoot the red ones!', 'They bleed like anybody!', 'Not one step into the market!'],
    counter: ['With me! Take the {place} back!', 'Holdfast! Holdfast!', 'Now, while they\'re reloading! Go!'],
    gun: ['Gun\'s up!', 'I\'m on the gun! Get down!'],
  },
};

/** Every call-out, by side and kind, each with its own id. */
export const CALLS: readonly Callout[] = (Object.entries(said) as [CallSide, Partial<Record<CallKind, readonly string[]>>][]).flatMap(([side, kinds]) =>
  (Object.entries(kinds) as [CallKind, readonly string[]][]).flatMap(([kind, texts]) =>
    texts.map((text, i) => ({ id: `mission.foreclosure.call.${side}.${kind}.${i + 1}`, side, kind, text }))));
