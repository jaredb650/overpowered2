/**
 * Every word of the Outpost mission. The shape is the Commander's `Line`, so the voice script can take these as they are.
 *
 * The Commander's arc is section 18's: smug and professional, then irritated, rattled, cracked. Under it runs the one thing the rest of
 * the game has never said, that these people have killed one of you before and kept the boots. The Council never raises its voice.
 * Changing a line's words wants a new take. Changing its id loses the take.
 */
import type { Emotion, Line, Speaker } from '../../enemies/commander/lines';

const l = (id: string, speaker: Speaker, emotion: Emotion, text: string): Line => ({ id: `mission.${id}`, speaker, emotion, text });
const council = (id: string, text: string): Line => l(`council.${id}`, 'council', 'deadpan', text);
const commander = (id: string, emotion: Emotion, text: string): Line => l(`cmd.${id}`, 'commander', emotion, text);
const pilot = (id: string, text: string): Line => l(`radio.${id}`, 'radio', 'urgent', text);

export const OUTPOST_LINES: readonly Line[] = [
  // Briefing
  council('brief.line', 'Contractor. This is the Office of Societal Compliance. You are on a recorded line.'),
  council('brief.breach', 'Form 7742-C. The garrison at The Outpost is in breach of Section 12, Continued Existence. A notice was displayed on their planet for the statutory thirty days.'),
  council('brief.officer', 'Their commanding officer declined to sign for it. He has been added to the invoice.'),
  council('brief.task', 'You will remove him, and everyone who reports to him. Transport is included one way.'),
  council('brief.previous', 'A previous contractor was assigned to this account. That file is closed. Please do not ask about the deposit.'),
  council('brief.thanks', 'The door gun is a courtesy. The Council thanks you for your continued compliance.'),

  // Insertion
  pilot('in.wire', 'Two minutes to the wire. Door\'s yours, contractor. Anything on that compound is billable.'),
  pilot('in.armour', 'That\'s armour in the yard. Save your belt, it just bounces.'),
  pilot('in.missile', 'Missile! Missile! We\'re hit! Putting her down outside the wire. Brace!'),
  pilot('in.rental', 'This is as far as the rental goes. Good luck with the paperwork.'),
  commander('in.hello', 'smug', 'Good afternoon. This is the Commander of this outpost. You are firing on a recognised military installation.'),
  commander('in.door', 'smug', 'A door gun. How traditional. All squads, get under something.'),
  commander('in.tank', 'smug', 'That is a main battle tank. You are not scratching the paint. Do carry on.'),
  commander('in.talk', 'smug', 'There. Now we can talk properly.'),

  // Locked out
  commander('lz.file', 'smug', 'You\'re on my ground now. I\'ve read your file, contractor. You\'re not the first.'),
  commander('lz.gate', 'smug', 'Close the gate.'),
  commander('lz.hours', 'smug', 'We don\'t take deliveries after four.'),
  commander('lz.trucks', 'orders', 'All stations, this is Command. One hostile, on foot, outside the wire. Send the trucks.'),
  council('lz.account', 'Your transport has been marked as damaged. This has been added to your account.'),

  // Soft skins
  commander('soft.east', 'smug', 'Two trucks on the east road. Light work. Try to keep up with them.'),
  commander('soft.driver', 'smug', 'You shot the driver. Good. That\'s what I\'d have done.'),
  commander('soft.left', 'smug', 'Bravo is going round your left. I\'m telling you so that you can watch it happen.'),
  commander('soft.tower', 'smug', 'Tower Two has you. He\'ll stop when you stop.'),
  commander('soft.west', 'irritated', 'West road. Everything we have with wheels.'),
  commander('soft.names', 'irritated', 'Twelve men. I knew nine of them by name.'),
  council('soft.receipts', 'Your progress has been noted. Please retain your receipts.'),

  // The heavy assault
  commander('heavy.roll', 'irritated', 'Enough. All armour, roll out.'),
  commander('heavy.look', 'smug', 'That is a tank. I\'d like you to look at it. Now look at your little gun.'),
  commander('heavy.knock', 'smug', 'You\'re knocking. Nobody\'s home.'),
  council('heavy.salvage', 'Contractor. Our records place a previous contractor\'s equipment in the south-east corner of the site. Retrieval is at your own risk. It is not covered.'),
  commander('heavy.buried', 'irritated', 'I know where you\'re going. We buried him. We didn\'t bury his kit. I have always regretted that.'),

  // The wreck
  commander('wreck.boots', 'smug', 'That one lasted nine days. I kept his boots. They didn\'t fit.'),
  commander('wreck.changes', 'irritated', 'Ah. Well. That does change the conversation.'),
  council('wreck.balance', 'Item recovered. Its previous owner\'s balance has been transferred to you.'),

  // Turning it round
  commander('turn.spread', 'irritated', 'All units, he has a launcher. Spread out. Do not bunch up.'),
  commander('turn.forty', 'irritated', 'That was forty tonnes. That was signed out in my name.'),
  commander('turn.bird', 'irritated', 'Get the bird up. Put it on his head.'),
  commander('turn.form', 'rattled', 'Do you know what one of those costs? I do. It\'s on a form.'),
  commander('turn.bulwark', 'rattled', 'Back Bulwark into the gate. Nothing gets past Bulwark.'),
  commander('turn.jammed', 'rattled', 'It\'s in the gate. The gate won\'t close. The gate will not close.'),
  council('turn.fine', 'The Council reminds you that wreckage left in a public gateway may incur a fine.'),

  // The breach
  commander('breach.seal', 'rattled', 'Seal the citadel! Drop the blast door! Now, now, now!'),
  commander('breach.under', 'rattled', 'He went under it. Who taught him that?'),
  commander('breach.locked', 'smug', 'You\'ve spent twenty minutes trying to get in here. Let\'s see how you like it.'),

  // The raid
  commander('bar.lights', 'hushed', 'Lights.'),
  commander('bar.circle', 'smug', 'Every corridor in this block goes round in a circle. My men know that. You don\'t.'),
  commander('bar.pin', 'orders', 'Contact south corridor. Pin him. Second team, through the bunks.'),
  commander('bar.tired', 'irritated', 'You\'re still going. I\'d hoped you\'d be tired. Do you get tired?'),
  commander('cool.audit', 'irritated', 'The bridge went in the last audit. Nobody signed for the repair. Do enjoy the view.'),
  council('cool.dash', 'Your movement suite includes a lateral burst. This is not a recommendation. It is a reminder that you were billed for it.'),
  commander('gal.walkway', 'hushed', 'Nobody comes down here. I had the walkway taken out. There is no way across.'),
  council('gal.walls', 'Your boots are rated for vertical surfaces. The Council accepts no liability for walls.'),
  commander('gal.what', 'rattled', 'That was a wall. You ran on the wall. What are you?'),
  commander('mess.hold', 'hushed', 'Everybody hold your fire. Let him come in. Let him sit down.'),
  commander('mess.now', 'orders', 'Now.'),
  commander('mess.yesterday', 'rattled', 'They were eating in here yesterday.'),
  commander('arm.mine', 'rattled', 'That\'s my armoury. Those are signed for. Put those back.'),
  council('arm.take', 'Ordnance recovered on site is not deducted from your fee. Take what you can carry.'),
  commander('plate.walk', 'rattled', 'Second Platoon. Full plate. Walk, do not run. Let him empty that thing into your chests.'),
  commander('plate.cost', 'rattled', 'Those plates cost more than you do.'),
  commander('plate.report', 'cracked', 'Second Platoon? Second Platoon, report. Anybody.'),
  commander('stack.above', 'cracked', 'You\'re in the Stack. There is nothing above you but me.'),
  commander('stack.posts', 'cracked', 'Every man on every landing. Anyone who leaves his post, I\'ll shoot myself. I mean I\'ll shoot him. I mean, you know what I mean.'),
  commander('stack.pension', 'cracked', 'Fourteen months. I had fourteen months left. Do you know what a pension is?'),

  // The Commander
  commander('boss.stores', 'cracked', 'Right. I\'ve had this sent up from stores. Stay exactly where you are.'),
  commander('boss.roof', 'cracked', 'Look at it. Look what you did to my yard.'),
  council('boss.hours', 'Contractor. Please conclude. You are approaching your billable hours.'),

  // The end
  council('end.complete', 'Notice of Completion. Form 7742-C is discharged. The Outpost has been removed from the register.'),
  council('end.fee', 'Your fee has been calculated. Deductions: one helicopter, one gate, one previous contractor. Balance: see reverse.'),
  pilot('end.walk', 'Contractor, this is Packmule 2-3. The Council says you can walk.'),
  council('end.retained', 'The Commander\'s service record has been retained. Deceased personnel remain eligible to serve at the Kill House.'),

  // Back from the dead
  council('redeploy.fee', 'Replacement contractor issued. The fee has been deducted.'),
  commander('redeploy.another', 'smug', 'You again. Or another one of you. Does it matter?'),
  council('redeploy.keep', 'Your replacement has been briefed. Please try to keep this one.'),
  commander('redeploy.told', 'smug', 'We\'ve done this part. I\'ve told the men where you\'ll be.'),
];
