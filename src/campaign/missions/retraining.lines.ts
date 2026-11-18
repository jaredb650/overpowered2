/**
 * Every word of Retraining (docs/design/tutorial.md). The Council's, in her own box, shown as subtitles: no takes are recorded yet,
 * and a line with no clip is shown for its reading time. The subjects speak only through the garrison's own begging lines.
 * The voice never names a key: the hints on screen carry the player's own binding.
 */
import type { Line } from '../../enemies/commander/lines';

const council = (id: string, text: string): Line => ({ id: `mission.council.tut.${id}`, speaker: 'council', emotion: 'deadpan', text });

export const RETRAINING_LINES: readonly Line[] = [
  // Intake
  council('i0.line', 'Contractor. Good morning. This is the Office of Societal Compliance. You are on a recorded line.'),
  council('i0.welcome', 'Welcome to your voluntary retraining. You have been selected. The reasons are on file. The file is not available to you.'),
  council('i0.policy', 'Under a new Compliance policy, I am obliged to inform you that you are free to leave at any time, through the door behind you.'),
  council('i0.encourage', 'You are, however, highly encouraged to complete your retraining. There is no penalty for leaving. A note will be made.'),
  council('i0.subjects', 'Today\'s exercises use live subjects. They have been processed for your convenience. You may hear them. That is normal.'),
  // Leaving by the door
  council('exit.now', 'Contractor has declined retraining in under a minute. This has been noted as decisive. Have a productive day.'),
  council('exit.early', 'Retraining incomplete. Your file will say so, in a small font. Nobody reads the small font. I read the small font.'),
  council('exit.half', 'You were nearly useful. The remaining modules will be held for you. They do not expire. Neither do notes.'),
  council('exit.late', 'You have left before the part with the explosion. This is unusual. It has been flagged as unusual.'),
  council('exit.done', 'Retraining complete. You may now leave through the door you were always free to leave through.'),

  // Mobility
  council('m.crouch', 'Basic locomotion. You can already walk. This is to confirm it for the record. Crouch through the duct.'),
  council('m.slide', 'The slot ahead is long. Walking under it is slow. Run, and slide. Gravity is free. It is one of very few things that are.'),
  council('m.slideAgain', 'That was a walk. The Council asked for a slide. Again.'),
  council('m.dash', 'Climb the ledge. Then the gap: jump, jump again, and use your lateral burst. You were billed for it.'),
  council('m.wallrun', 'There was a walkway here. It has been removed from the budget. Your boots are rated for vertical surfaces. The Council accepts no liability for walls.'),
  council('m.chimney', 'The chimney. Two walls, twenty metres of up. There are no stairs. There were never going to be stairs.'),
  council('m.slam', 'Downward travel. Crouch in the air and you drive into the ground. The subjects below have been arranged for this.'),
  council('m.slamAgain', 'That was a landing. Landings are free. Slam.'),
  council('m.slamDone', 'Ground slam certified. The subjects who are still conscious have been noted as resilient.'),
  council('m.rocket', 'Assisted elevation. A rocket at your own feet will throw you. Everywhere else this is a hazard. Here it is a lesson.'),
  council('m.jet', 'Your suite has been fitted with a Jump Jet, on trial. The tower is seven metres. The jet is not. Trials are free until they are not.'),
  council('m.pit', 'The pit is padded. The padding is billed per use.'),

  // The Gallery
  council('w.lane', 'The Gallery. Your rounds have no spread. They go where you point them. Your SMG is loaded with hollow points. Shoot the subject.'),
  council('w.hp', 'Hollow points open inside the body. They are very effective on a man in a shirt.'),
  council('w.armour', 'This subject is wearing a plate. Shoot him anyway. For the record.'),
  council('w.bounce', 'Hollow points do nothing to a plate. You may have noticed. He certainly has.'),
  council('w.pod', 'A supply pod has been delivered. Open it. Buy armour-piercing rounds for the SMG and fit them.'),
  council('w.fitted', 'Fitted. Armour-piercing goes through the plate. It is slightly worse on a shirt. Nothing is free, including that.'),
  council('w.rounds', 'The pod also sells plus-P, flechettes for the shotguns, incendiary, Raufoss, and flak for the autocannon. Each defeats something. The catalogue explains what.'),
  council('w.apDone', 'The subject is deceased. The plate is intact. The plate has been returned to stores.'),
  council('w.grenade', 'Subjects in the trench. Hold to pull the pin, release to throw. The longer you hold, the less time they have.'),
  council('w.stim', 'The floor has administered a corrective charge. Use a stim. You cannot shoot while injecting. Choose your moment better than this.'),

  // The Cutting Room
  council('k.drain', 'Your ammunition has been withdrawn. This happens in the field without notice. Here, you have been given notice.'),
  council('k.blade', 'Contractor, when you run out of ammunition, here is your standard issue blade. It is never empty. It is never billed.'),
  council('k.energy', 'The energy blade. It is offered to senior contractors. You are not one. It does not acknowledge plates. Neither, now, do you.'),
  council('k.done', 'Blade certified. The subjects have been notified that the contractor is still armed. They have taken it badly.'),

  // The Quiet Room
  council('c.sonar', 'The lights have been switched off. Three subjects are hiding. Your sonar shows every living body through walls. Hidden men. Running men. All of them.'),
  council('c.kata', 'The Ring. Eight subjects. They have been told this is a group exercise. Your brain chip is now Gun Kata. It needs a pistol in each hand.'),
  council('c.kataDone', 'Gun Kata certified. The Ring will be reset for the next contractor. It takes longer to reset than to use.'),

  // The Yard
  council('y.intro', 'The Yard. Capturing delinquent subjects is beneficial to Council operations. You will be paid for every one you bring in alive.'),
  council('y.live', 'These subjects are armed, and have not been told this is training. A man surrenders when he can see it is over. Kill his friends, and leave him.'),
  council('y.kneel', 'He has surrendered. Do not shoot him. Walk up to him and ask. Subjects who are questioned tend to share.'),
  council('y.reveal', 'He has told you where his friends are. They are marked. They do not know they are marked. That is the useful part.'),
  council('y.release', 'You may let him go. Ask again and he walks out of the gate. Released men talk, and the next one kneels sooner. This is called reputation. It is not called mercy.'),
  council('y.capture', 'Now bring one in. Break the men in the shed, then hold, do not tap. A drone will collect him. You will be paid as he leaves the ground.'),
  council('y.paid', 'Bounty secured. He will be processed. Perhaps one day he will be back here, helping with your retraining.'),
  council('y.lesson', 'That was the last one. He was the lesson. Another has been provided.'),

  // The finale
  council('n.balcony', 'Retraining is nearly complete. Please proceed to the balcony.'),
  council('n.capable', 'Contractor. The Council\'s capabilities are beyond your imagination. You are not expected to imagine them. Only to know that they exist.'),
  council('n.access', 'High-performing contractors are given access to the most powerful weaponry in the known universe. You have been given access. Call it in.'),
  council('n.fraction', 'What you are about to witness is a fraction of what the Council is capable of. A small fraction.'),
  council('n.anywhere', 'The Council can deliver this anywhere in the universe. On command. Any planet. Any town. Any address.'),
  council('n.after', 'Retraining complete. Your conduct has been noted. Please remember what you saw. The Council will.'),
  council('n.door', 'The exit is the door you were shown when you arrived. It is still unlocked. It is now recommended.'),

  // A death
  council('redeploy.1', 'Replacement contractor issued. The previous one did not complete this module. You will.'),
  council('redeploy.2', 'Another replacement. Retraining is billed per contractor. Please pace yourself.'),
  council('redeploy.3', 'You again. The module has been reset. So have you.'),
];
