/**
 * Every word of Foreclosure so far (docs/proposals/mission-2-plan.md). Nothing here is recorded and nothing will be generated: the lines
 * are rows with stable ids, `mission.foreclosure.<who>.<key>`, for the beat stages to rewrite and the voice script to take as they are.
 *
 * The Council's recorded opening and its redeploy lines are the Outpost's own rows, by id, so their takes play here too.
 *
 * shortcut: the Harbourmaster speaks as `intercept`, so the box calls her an intercepted transmission; she needs her own speaker (and the
 * port's PA tone) when the beats are written.
 */
import type { Emotion, Line, Speaker } from '../../enemies/commander/lines';
import { OUTPOST_LINES } from './outpost.lines';

const l = (id: string, speaker: Speaker, emotion: Emotion, text: string): Line => ({ id: `mission.foreclosure.${id}`, speaker, emotion, text });
const council = (id: string, text: string): Line => l(`council.${id}`, 'council', 'deadpan', text);
const harbour = (id: string, text: string): Line => l(`harbour.${id}`, 'intercept', 'hushed', text);
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
  harbour('stove', 'To the gentleman in the sky: we read your notice. We used it to light the stove.'),
  radio('lease', 'That is the end of the lease, contractor. You are on the ground.'),

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
