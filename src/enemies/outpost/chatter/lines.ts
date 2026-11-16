/**
 * Every enemy line, as rows (docs/proposals/squad-chatter.md, 4.9 and 5). Plain data: rules.ts matches them.
 *
 * Registers follow the speaker's nerve. Professional (confident, steady): "tango", "hostile", "the subject", "he", no swearing.
 * Scared (shaken, panicked, broken): "it". Shaken rows slip from "he" to "it" and start to swear; panicked rows say "that thing"
 * and "that monster" and swear in full. The scared rows hold every line `comms.ts` had before the table, word for word.
 *
 * Ids are `ch.<faction>.<concept>.<register>.<n>`, counted from 1 within a register. Append; never reorder, since phase 2 names
 * its files by id.
 */
import type { CommsKind } from '../events';
import type { ChatterChannel, ChatterEmotion, ChatterRule, ChatterState } from './rules';

type Register = 'scared' | 'pro' | 'shaken' | 'panicked' | 'named' | 'namedPro' | 'buddy' | 'buddyPro';

const STATES: Record<Register, readonly ChatterState[]> = {
  scared: ['shaken', 'panicked', 'broken'],
  pro: ['confident', 'steady'],
  shaken: ['shaken'],
  panicked: ['panicked', 'broken'],
  named: ['shaken', 'panicked', 'broken'],
  namedPro: ['confident', 'steady'],
  buddy: ['shaken', 'panicked', 'broken'],
  buddyPro: ['confident', 'steady'],
};

/** The emotion of a concept's professional rows, then its scared rows. */
const EMOTION: Partial<Record<CommsKind, readonly [ChatterEmotion, ChatterEmotion]>> = {
  contact: ['urgent', 'urgent'], lost: ['calm', 'afraid'], noise: ['hushed', 'afraid'], manDown: ['urgent', 'grief'], leaderDown: ['urgent', 'grief'],
  takingCommand: ['calm', 'urgent'], medic: ['urgent', 'pain'], reloading: ['urgent', 'urgent'], moving: ['urgent', 'urgent'], covering: ['urgent', 'urgent'],
  flanking: ['calm', 'urgent'], frag: ['urgent', 'urgent'], flash: ['urgent', 'urgent'], breach: ['urgent', 'urgent'], fallback: ['calm', 'afraid'],
  regroup: ['calm', 'urgent'], fear: ['calm', 'panic'], panic: ['afraid', 'panic'], surrender: ['calm', 'pleading'], fix: ['calm', 'calm'],
  squadGone: ['calm', 'panic'], hit: ['pain', 'pain'], dying: ['pain', 'pain'], beg: ['defiant', 'pleading'], scream: ['pain', 'pain'],
  rescue: ['urgent', 'urgent'], lastStand: ['defiant', 'defiant'], pinning: ['urgent', 'urgent'], flushing: ['urgent', 'urgent'], rushing: ['urgent', 'urgent'],
  cutoff: ['urgent', 'urgent'], ambushSet: ['hushed', 'hushed'], spring: ['urgent', 'urgent'], opening: ['cocky', 'urgent'], wounded: ['cocky', 'urgent'],
  dry: ['calm', 'afraid'], refused: ['calm', 'panic'], hostage: ['urgent', 'urgent'], clearShot: ['calm', 'calm'], obey: ['calm', 'calm'], behindUs: ['urgent', 'panic'],
};

/**
 * How often a concept is better left unsaid (5.2): the chance a moment passes in silence. Silence still keeps the concept's gap.
 * Only the drills that come round every few seconds need it.
 */
export const NOTHING: Partial<Record<CommsKind, number>> = { moving: 0.3, fix: 0.2, contact: 0.15 };

/** Lines that come out as a scream, not a voice on the radio. */
const SCREAMED: ReadonlySet<CommsKind> = new Set<CommsKind>(['panic', 'surrender', 'scream', 'dying', 'beg', 'lastStand', 'refused']);
const RADIO: ReadonlySet<CommsKind> = new Set<CommsKind>(['fix']);

/** Every line `comms.ts` had before the rule table, word for word. All of them say "it", so all of them are scared rows. */
const PORTED: Partial<Record<CommsKind, readonly string[]>> = {
  contact: ['Contact!', 'Contact front!', 'Eyes on! Eyes on it!', 'Got it, moving in the open!', 'There! There!'],
  lost: ['Lost visual.', 'Where did it go?', 'I have nothing. Anyone?', 'It was right there.'],
  noise: ['You hear that?', 'Movement. Somewhere close.', 'Shots fired, close.', 'Stay sharp, something is moving.'],
  manDown: ['Man down!', 'He\'s down! He\'s down!', 'We lost one!', 'Oh God. He\'s gone.'],
  leaderDown: ['Sarge is down!', 'They got the sergeant!', 'We lost the lead!'],
  takingCommand: ['I have the squad! On me!', 'I\'m in command! Hold it together!', 'Form on me!'],
  medic: ['Medic!', 'I need a medic here!', 'Got wounded, need help!'],
  reloading: ['Reloading!', 'Changing mag!', 'I\'m dry!', 'Cover me, reloading!'],
  moving: ['Moving!', 'Bounding!', 'Team two, go!', 'Next cover, go go!'],
  covering: ['Covering!', 'Suppressing!', 'Keep its head down!', 'I\'ve got you, move!'],
  flanking: ['Flanking left!', 'Going wide!', 'Get round it!', 'Hit it from the side!'],
  frag: ['Frag out!', 'Grenade!', 'Throwing!'],
  flash: ['Flash out!', 'Banger going in!', 'Eyes!'],
  breach: ['Stack up!', 'On the door!', 'Breaching, breaching!', 'Go, go, go!'],
  fallback: ['Fall back!', 'Back, get back!', 'Pull out, by teams!', 'We can\'t hold this!'],
  regroup: ['Rally on me!', 'Regroup!', 'Form up!'],
  fear: ['What IS that thing?', 'It doesn\'t stop!', 'Bullets don\'t do anything!', 'That\'s not a man!', 'Did you see what it did to him?'],
  panic: ['I\'m not dying here!', 'Run! Just run!', 'Oh God, oh God, oh God!', 'Get away from me!'],
  surrender: ['Don\'t shoot!', 'I give up! I give up!', 'Please, please!', 'I have a family!', 'I\'m unarmed!'],
  fix: ['All units, Command has a fix. Sending it now.', 'Thermal has a rough position. Move.'],
  squadGone: ['We\'ve lost a whole squad!', 'They\'re all dead! All of them!', 'Nobody\'s left out there!'],
  hit: ['I\'m hit!', 'I\'m hit, I\'m hit!', 'Agh! My leg!', 'It got me!', 'Ah, Christ!'],
  dying: ['I can\'t feel my legs!', 'Don\'t leave me!', 'Tell them I tried.', 'Oh God, there\'s so much blood.', 'I don\'t want to die here.'],
  beg: ['Please. Please, no.', 'Don\'t. I\'m done, I\'m done.', 'I have kids!', 'Just leave me.'],
  scream: ['Help me! Somebody!', 'Medic! MEDIC!', 'Oh God, it hurts!', 'Don\'t leave me out here!', 'Get me out of here!'],
  rescue: ['I\'m going for him!', 'Cover me, I\'ll get him!', 'Hold on, I\'m coming!', 'We don\'t leave him!'],
  lastStand: ['Come on then!', 'You\'re coming with me!', 'Taking you with me!'],
  pinning: ['Keep it pinned!', 'Hold it there! Don\'t let it up!', 'Rounds on that corner, keep them on it!', 'Nobody stops firing!'],
  flushing: ['Flush it out!', 'It\'s dug in! Frag it!', 'Grenade on that position, move it!', 'Get it out of there!'],
  rushing: ['Everyone in! Now!', 'Go, go, go! Push!', 'All of you, on it, now!', 'Close it down!'],
  cutoff: ['It\'s running! Cut it off!', 'Get ahead of it!', 'Block that exit!', 'It\'s heading for the door! Beat it there!'],
  ambushSet: ['On the door. Not a sound.', 'Set up here. Wait for it.', 'Weapons on the frame. Nobody fires till I say.', 'Quiet. Let it come to us.'],
  spring: ['Now! Now! Now!', 'Light it up!', 'Open fire!', 'Take it! Take it!'],
  opening: ['It\'s reloading! Push!', 'It\'s dry! Move, move!', 'Now, while it\'s changing mags!'],
  wounded: ['It\'s hurt! Stay on it!', 'That hit it! Finish it!', 'It\'s bleeding! Don\'t let up!'],
  dry: ['I\'m out! I\'m out!', 'That\'s my last mag!', 'Nothing left! Anyone got a mag?'],
  refused: ['It shot me! It shot me!', 'It doesn\'t take prisoners! Run!', 'It doesn\'t care! Run!'],
  hostage: ['Hold fire! It\'s got one of ours!', 'Check fire, check fire!', 'Don\'t hit him! Get round the side!'],
  clearShot: ['He\'s gone anyway. Take the shot.', 'Sorry, son. Fire.', 'Shoot through him. That\'s an order.'],
  obey: ['Copy.', 'Copy that, moving.', 'Understood, sir.', 'On it.', 'Doing it now.'],
  behindUs: ['It\'s behind us!', 'Rear! Rear! Turn around!', 'It came round the back!'],
};

/**
 * Steady and confident men: a radio voice. "Tango", "hostile", "the subject", "he". Never "it" for anything, so a test can hold
 * the register to it, and no swearing.
 */
const PRO: Partial<Record<CommsKind, readonly string[]>> = {
  contact: ['Contact. Tango in the open.', 'Hostile, eyes on. Engaging.', 'Contact front. One tango, armed.', 'Eyes on the subject. He is moving.', 'All call signs, contact. Hostile.'],
  lost: ['Lost visual on the tango.', 'Subject out of sight. Holding.', 'No eyes on the hostile. Report.', 'He broke contact. Watch the corners.'],
  noise: ['Movement. Check your sectors.', 'Shots fired, near. Possible hostile.', 'Heard something. Eyes open.', 'Noise on our flank. Stay sharp.'],
  manDown: ['Man down. Keep firing.', 'We have a casualty.', 'One down. Close the gap.', 'Casualty. Mark the spot, keep moving.'],
  leaderDown: ['Squad lead is down.', 'We lost the lead. Hold your positions.', 'Sergeant is down. Stand by.'],
  takingCommand: ['I have the squad. Form on me.', 'Taking command. Same plan.', 'I have command. Nobody runs.', 'Squad is mine. Eyes front.', 'I am lead now. Same orders.', 'Command passes to me. Hold.'],
  medic: ['Medic to my position.', 'Wounded here. Need a medic.', 'Casualty, still breathing. Medic.'],
  reloading: ['Changing mags.', 'Reloading. Cover.', 'Mag change.', 'Dry. Reloading.'],
  moving: ['Moving.', 'Bounding. Cover me.', 'Team two, move.', 'Next cover. Go.', 'Moving to the next cover.', 'Displacing. Cover.', 'Changing position.', 'On the move.'],
  covering: ['Covering.', 'Suppressing the tango.', 'Keep his head down.', 'You have cover. Move.'],
  flanking: ['Flanking left.', 'Going wide on the tango.', 'Taking his side. Keep him looking at you.', 'Moving to his flank.'],
  frag: ['Frag out.', 'Grenade. Heads down.', 'Throwing frag.', 'Frag. Get your heads down.', 'Grenade out. Count three.'],
  flash: ['Flash out.', 'Banger. Eyes.', 'Flash going in. Look away.'],
  breach: ['Stack up on the door.', 'Breaching on three.', 'On the door. Stand by.', 'Breach, breach.'],
  fallback: ['Fall back by teams.', 'Pull back to the next line.', 'Break contact. Move back.', 'Withdraw. Covering fire.'],
  regroup: ['Rally on me.', 'Regroup at my position.', 'Form up. Count off.'],
  fear: ['Be advised, the tango is not normal.', 'Rounds are hitting him. He does not care.', 'Command, the subject is still standing.', 'Whatever he is, he was not in the briefing.'],
  panic: ['Breaking off. I am breaking off.', 'Request permission to leave. Granted. Leaving.', 'Moving to the rear. Quickly.'],
  surrender: ['Weapon down. I am done.', 'Hands up. I surrender.', 'Not armed. Do not shoot.', 'I yield. Write that down.'],
  fix: [
    'All units, Command has a fix on the tango.', 'Thermal has the subject. Sending a grid.', 'Command: hostile position updated. Move.',
    'Command: thermal fix. Grid to follow.', 'Command to all: the subject is on thermal. Close in.', 'Fix confirmed. Move the net in.',
  ],
  squadGone: ['Lost contact with a whole squad.', 'A squad is not answering. Assume lost.', 'One squad gone. Adjust.'],
  hit: ['I am hit.', 'Hit. Still in the fight.', 'Took one. I am fine.', 'Hit in the arm. Carrying on.'],
  dying: ['Tell the sergeant I held.', 'I am done. Take my mags.', 'Bleeding out. Note the time.', 'Getting cold. Noted.'],
  beg: ['You won. Make the shot clean.', 'I am out of the fight. You can see that.', 'Leave me. I am no threat.'],
  scream: ['Medic! Man down at my position!', 'Wounded! Need extraction!', 'Somebody, I am down here!'],
  rescue: ['Going for him. Cover me.', 'I have him. Covering fire.', 'Moving to the wounded.', 'Nobody gets left. Going.'],
  lastStand: ['Last one. Make him pay.', 'Pin is out. Come closer.', 'Taking him with me.'],
  pinning: ['Keep him pinned.', 'Rounds on that corner. Keep them coming.', 'Hold him there.', 'Sustained fire. Nobody stops.'],
  flushing: ['Flush him out.', 'He is dug in. Frag the position.', 'Grenade on that corner.', 'Get the tango moving.'],
  rushing: ['All in. Now.', 'Push. Everyone on the tango.', 'Close the distance. Go.', 'Rush him.'],
  cutoff: ['He is running. Cut him off.', 'Get ahead of the tango.', 'Block that exit.', 'Hostile heading for the door. Beat him there.'],
  ambushSet: ['On the door. Silence.', 'Set here. Wait for him.', 'Weapons on the frame. Hold fire.', 'Quiet. Let him come.'],
  spring: ['Now.', 'Fire.', 'Engage. Engage.', 'Light him up.'],
  opening: ['Tango is reloading. Push.', 'He is dry. Move.', 'Hostile changing mags. Go.'],
  wounded: ['Tango is hit. Stay on him.', 'He is bleeding. Push him.', 'Subject is slowing. Do not let up.'],
  dry: ['Out of ammunition.', 'Last mag.', 'Anyone have a spare mag?'],
  refused: ['He shot a prisoner. Nobody surrenders.', 'He does not take prisoners. Fight on.', 'Prisoner down. Noted. Fight.'],
  hostage: ['Hold fire. He has one of ours.', 'Check fire. Friendly in the line.', 'Do not hit our man. Go round.'],
  clearShot: ['The hostage is lost. Fire.', 'Shoot through. I will sign for him.', 'Take the shot. His family gets the pension.'],
  obey: ['Copy.', 'Copy, moving.', 'Wilco.', 'Roger. Moving now.'],
  behindUs: ['Tango behind us.', 'Contact rear.', 'He came round the back. Turn.'],
};

/** Shaken: the slip from "he" to "it", and the first swears. */
const SHAKEN: Partial<Record<CommsKind, readonly string[]>> = {
  contact: ['Contact! He\'s... it\'s right there!', 'Eyes on him. On it. Christ.', 'There he is. There it is. Bloody hell.'],
  lost: ['Where the hell did he... where did it go?', 'Lost him. Lost it. It was right there.', 'He\'s gone. It\'s gone. Anyone?'],
  noise: ['Did you hear that? Tell me you heard that.', 'Something\'s out there. Hell.'],
  hit: ['Christ, I\'m hit!', 'Bloody hell, it got me.'],
  reloading: ['Reloading! Keep him... keep it off me!', 'Changing mags. Bloody hurry up.'],
  fear: ['He should be down. Why isn\'t it down?', 'Christ. Did you see that? Did you see it?'],
  covering: ['Keep him... keep it down! Covering!'],
  wounded: ['It\'s hurt! He\'s hurt, stay on it!'],
};

/** Panicked and broken: "that thing", "that monster", and swearing in full. */
const PANICKED: Partial<Record<CommsKind, readonly string[]>> = {
  contact: ['That thing! It\'s there! Fuck!', 'It\'s that monster! Shoot it!', 'Shit, shit, it\'s right there!'],
  lost: ['Where the fuck is it?', 'That thing\'s gone. Where\'s it gone?', 'I lost it. I fucking lost it.'],
  fear: ['What the fuck is that thing?', 'Bullets just bounce off the fucking thing!', 'That\'s a monster. That\'s an actual monster.'],
  panic: ['Fuck this, fuck this!', 'Get that thing away from me!', 'I\'m not dying to that monster!'],
  hit: ['Fuck! It got me!', 'Shit, I\'m bleeding, I\'m bleeding!'],
  reloading: ['I\'m dry, I\'m fucking dry!', 'Cover me, it\'s coming!'],
  dry: ['Nothing left! Fuck!', 'I\'m out and it\'s still coming!'],
  manDown: ['It fucking killed him!', 'That thing tore him apart!'],
  covering: ['Shoot it! Shoot the fucking thing!', 'Keep firing at that monster!'],
  fallback: ['Back! Get back from that thing!', 'Run! Fall back! Fuck!'],
  behindUs: ['It\'s behind us! How is it behind us?', 'Fuck, it\'s round the back!'],
  moving: ['Move, move, fuck, move!'],
};

/** A friend's death, by name. These beat the plain rows whenever there is a name to say. */
const NAMED: Partial<Record<CommsKind, readonly string[]>> = {
  manDown: ['{dead}! No, no, {dead}!', 'It got {dead}. It just... it got {dead}.', '{dead}? {dead}, talk to me!', 'It killed {dead}. Oh Christ.'],
  leaderDown: ['They got {dead}! They got the sergeant!', '{dead}\'s gone! Who\'s got the squad?'],
};
const NAMED_PRO: Partial<Record<CommsKind, readonly string[]>> = {
  manDown: ['{dead} is down. Keep firing.', 'Lost {dead}. Close the gap.', 'Casualty: {dead}. Mark him.', '{dead} is down. I need a medic on {dead}, now.'],
  leaderDown: ['{dead} is down. That was the lead.', '{dead} is dead. Hold your positions.'],
};
/** The dead man's pair. More personal again. */
const BUDDY: Partial<Record<CommsKind, readonly string[]>> = {
  manDown: ['{dead}! I had him, I had him right here!', 'No. Not {dead}. Not {dead}.', '{dead}, get up. Get up, {dead}.'],
};
const BUDDY_PRO: Partial<Record<CommsKind, readonly string[]>> = {
  manDown: ['{dead} is down. I was right next to him.', 'That was {dead}. That was my man.', '{dead}. Copy. Moving on. Moving on.'],
};

const SETS: readonly (readonly [Register, Partial<Record<CommsKind, readonly string[]>>])[] = [
  ['scared', PORTED], ['pro', PRO], ['shaken', SHAKEN], ['panicked', PANICKED],
  ['named', NAMED], ['namedPro', NAMED_PRO], ['buddy', BUDDY], ['buddyPro', BUDDY_PRO],
];

function build(): ChatterRule[] {
  const rows: ChatterRule[] = [];
  for (const [register, set] of SETS) {
    for (const concept of Object.keys(set) as CommsKind[]) {
      const [proFeel, scaredFeel] = EMOTION[concept] ?? ['calm', 'afraid'];
      const pro = register === 'pro' || register === 'namedPro' || register === 'buddyPro';
      const channel: ChatterChannel = SCREAMED.has(concept) ? 'scream' : RADIO.has(concept) ? 'radio' : 'shout';
      set[concept]!.forEach((text, i) => {
        const row: ChatterRule = {
          id: `ch.garrison.${concept}.${register}.${i + 1}`, concept, faction: 'garrison', text, channel,
          emotion: pro ? proFeel : register === 'panicked' && scaredFeel !== 'pain' ? 'panic' : register.startsWith('named') || register.startsWith('buddy') ? 'grief' : scaredFeel,
          who: { states: STATES[register] },
        };
        if (register.startsWith('named') || register.startsWith('buddy')) row.when = { dead: true };
        if (register.startsWith('buddy')) row.who!.buddy = true;
        // A panicked man mostly sounds it, though the plain scared rows still match him.
        if (register === 'panicked') row.weight = 2;
        rows.push(row);
      });
    }
  }
  return rows;
}

export const RULES: readonly ChatterRule[] = build();
