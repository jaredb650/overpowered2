/**
 * Every word the Commander, the Council and the intercepts say, in one file, so that it can be read, recorded and tested as a script
 * (sections 18 and 19). `tools/scripts/voice-script.ts` turns this into the sheet for the recording session.
 *
 * An id is built from a key written next to its line, not from where the line sits, so lines can be moved and the recordings stay
 * matched. Change a line's words and it wants recording again. Change its key and it has lost its audio.
 *
 * Slots are `{n}`, `{weapon}`, `{room}`, `{name}` and `{squad}`. The box prints the true number; the recording says the nearest band, so 212 shots
 * is a take of "two hundred". A line with two different slots would need every pairing recorded, so it stays text in the box.
 *
 * Nothing here imports three.js.
 */
import { CALLSIGNS } from '../outpost/doctrine';
import { ADAPTATIONS, TRICKS, type AdaptationId, type Tone, type TrickId } from './adaptations';

export type Speaker = 'commander' | 'council' | 'intercept' | 'radio';
/** The arc's four, plus what the others sound like. */
export type Emotion = Tone | 'orders' | 'deadpan' | 'urgent' | 'hushed';

export interface Line {
  /** Stable. Also the name of the audio file. */
  id: string;
  speaker: Speaker;
  emotion: Emotion;
  text: string;
}

/** What a reaction can be about. Each is a row in `pick.ts` that says when it applies. */
export type Topic =
  | 'door' | 'camp' | 'weapon' | 'headshots' | 'limbs' | 'executions' | 'untouched' | 'hurt' | 'sonar' | 'pickups' | 'callIns' | 'melee'
  | 'speed' | 'highGround' | 'room' | 'accuracy' | 'range' | 'quick' | 'slow' | 'fallen' | 'gift' | 'generic';

/** The drills he gives orders for. */
export type OrderDrill = 'flank' | 'frag' | 'flash' | 'cutOff' | 'rush' | 'baseOfFire';

export type TrapCause = 'mortar' | 'mine' | 'tripwire' | 'claymore' | 'snare' | 'rigged' | 'deadman' | 'sniper' | 'falseSurrender' | 'manpads';

type Keyed = Readonly<Record<string, string>>;

// -------------------------------------------------------------------------------------------------
// Reactions: what the Commander noticed about the round that just ended
// -------------------------------------------------------------------------------------------------

const REACTIONS: Record<Topic, Record<Tone, Keyed>> = {
  door: {
    smug: {
      office: '{n} shots from that same doorway. We\'ve started calling it your office.',
      mat: 'You fired {n} times from one doorway. We\'re having a mat made.',
      commit: '{n} rounds from a single door. I\'ve had men hold a position with less commitment.',
    },
    irritated: {
      rent: '{n} shots from that doorway. At this point you owe us rent.',
      plaque: 'Same door. {n} shots. There\'s a plaque on it now.',
      council: '{n} rounds through one door frame. That frame was listed.',
    },
    rattled: {
      others: 'We have eleven other doors. They\'re lovely. {n} shots, and you won\'t even look at them.',
      leave: '{n} shots from one door. Do you ever leave? Is something wrong with the others?',
    },
    cracked: {
      eyes: '{n} shots. I see that doorway when I close my eyes. I\'ve stopped closing my eyes.',
      stood: 'I went to your door. I stood where you stand. I understand nothing.',
    },
  },
  camp: {
    smug: {
      furniture: 'You stood still for {n} seconds. We marked you down as furniture.',
      salute: '{n} seconds without moving. One of my men tried to salute you.',
      hopes: 'Motionless for {n} seconds. We thought you\'d died. We got our hopes up.',
    },
    irritated: {
      residency: '{n} seconds in one spot. Under Outpost regulations, that\'s a residency.',
      watered: '{n} seconds without moving. Someone watered you.',
      meeting: 'You stood there for {n} seconds. I\'ve been to budget meetings with more movement.',
    },
    rattled: {
      waiting: '{n} seconds. You just stand there. We don\'t know what for. Nobody is sleeping.',
      why: 'Why do you stand so still? Hunters move. What are you doing?',
    },
    cracked: {
      blink: '{n} seconds and you never blinked. I counted. I count everything now.',
      joined: 'I\'ve started standing still too. {n} seconds. It helps. I can see why you do it.',
    },
  },
  weapon: {
    smug: {
      wall: 'The {weapon} again. We\'ve ordered something that stops it. It\'s a wall. We\'ve ordered a wall.',
      others: 'The {weapon}. Again. There are other guns. You\'re carrying them.',
    },
    irritated: {
      form: 'My men have filed a complaint about the {weapon}. There\'s a form. There\'s now a queue for the form.',
      imagination: 'The {weapon}, every round. It\'s like fighting a very violent man with no imagination.',
    },
    rattled: {
      courtesy: 'Could you use something other than the {weapon}? For one round. As a courtesy.',
      sleep: 'The men can hear the {weapon} in their sleep. The ones who sleep. All three of them.',
    },
    cracked: {
      hum: 'The {weapon}. I hum it now. Clive said to stop. Clive is dead. I hum it for Clive.',
      chapel: 'If you love the {weapon} so much, marry it. We have a chapel. We had a chapel.',
    },
  },
  headshots: {
    smug: {
      bidder: '{n} headshots. Adequate. Our helmets went to the lowest bidder.',
      keep: '{n} headshots. I\'m told that\'s good. I wouldn\'t know. I keep mine in an office.',
    },
    irritated: {
      made: '{n} headshots. We are not made of heads.',
      paperwork: '{n} headshots. Do you have any idea how much paperwork a head is?',
    },
    rattled: {
      lower: '{n} heads. Could you aim lower? Even slightly? This is me asking.',
      second: '{n} headshots. We\'re issuing a second helmet. It goes on top of the first helmet. Morale has not improved.',
    },
    cracked: {
      wall: '{n} heads. I\'ve stopped filing them. I keep a list on the wall. The wall is also a list.',
      mine: 'You want a head? I have one. I\'ve been saving it.',
    },
  },
  limbs: {
    smug: {
      spares: '{n} limbs. We do keep spares, but they\'re mostly left ones.',
      tidy: '{n} limbs. You\'ll want to tidy those up. Nobody else will. We\'re all very busy.',
    },
    irritated: {
      lost: '{n} limbs. Lost Property is now a department. It has its own budget.',
      stores: '{n} limbs. Stores has asked me to stop sending them back.',
    },
    rattled: {
      labels: '{n} limbs this round. We\'ve started labelling them. Please don\'t mix them up.',
      using: '{n} limbs. Those were being used.',
    },
    cracked: {
      pairs: '{n} limbs. I\'ve been sorting them into pairs. It\'s calming.',
      applause: 'Nobody here has two hands left to applaud you. I hope you\'re happy.',
    },
  },
  executions: {
    smug: {
      room: '{n} prisoners executed. It\'s on your file. Your file is now a room.',
      someone: 'You shot {n} men with their hands up. I\'ve written to someone. I don\'t know who. There\'s a form.',
    },
    irritated: {
      ruined: 'Fine. {n} prisoners. You\'ve ruined surrendering for everybody.',
      convention: '{n} men on their knees. There\'s a Convention about that, you know. We had a copy. It was in that room.',
    },
    rattled: {
      correctly: '{n} men surrendered and you shot them. They\'d filled in the form correctly. I checked.',
      means: 'Hands up means stop. I don\'t know how else to put it. Hands up means stop.',
    },
    cracked: {
      flag: 'We\'ve stopped putting our hands up. We\'ve stopped putting anything up. The flag\'s gone as well.',
      closer: 'Next time the hands go up, see what\'s in them. Get close. Have a good look.',
    },
  },
  untouched: {
    smug: {
      luck: 'Not a scratch. We\'re calling that beginner\'s luck. We\'ll call it that for as long as we can.',
      warmup: 'Not a scratch. That was the warm-up. I\'ll have you know it was a very good warm-up.',
    },
    irritated: {
      rounds: 'Not one scratch. We have fired four million rounds this year. Not one scratch.',
      accounts: 'You took no damage. Accounts would like to know what exactly we\'ve been firing.',
    },
    rattled: {
      rude: 'Nothing. We hit you with nothing. What are you made of? Is that a rude question?',
      melon: 'We\'ve checked the bullets. They\'re real bullets. We shot a melon. It isn\'t the bullets.',
    },
    cracked: {
      melon: 'The melon is fine. I mean the melon died. I mean you should be the melon.',
      notHere: 'Nothing touched you. Perhaps you aren\'t here. Perhaps I\'m the one who isn\'t here. Would somebody tell me.',
    },
  },
  hurt: {
    smug: {
      floor: '{n} damage. You\'re leaking on my floor. That\'s a cleaning charge.',
      numbers: 'We hit you for {n}. So you do have a number. Good. Numbers go down.',
    },
    irritated: {
      manager: '{n} damage, and you\'re still walking. I\'d like to speak to whoever\'s in charge of you.',
      keep: '{n} damage. Stop getting up. It\'s bad for morale.',
    },
    rattled: {
      lot: '{n} damage! That\'s a lot! Isn\'t it? Someone tell me that\'s a lot.',
      cheer: 'We hit you for {n} and the men cheered. Then you got up. They\'ve stopped cheering.',
    },
    cracked: {
      wall: '{n} damage. I painted it on the wall. It\'s the best day we\'ve had.',
      keep: '{n}. I\'m keeping that one. Nobody can take that one away from me.',
    },
  },
  sonar: {
    smug: {
      knock: 'You tapped your helmet {n} times. We can hear that, you know. It\'s very rude.',
      nervous: '{n} sonar pings. Anyone would think you were nervous.',
    },
    irritated: {
      doorbell: '{n} pings this round. There\'s a doorbell. We\'d rather you used it.',
      know: '{n} pings. We know where we are. We didn\'t need telling.',
    },
    rattled: {
      back: '{n} pings. One of the men has started pinging back. With his mouth. He\'s having a lie down.',
      changed: '{n} pings. You can see through walls. We\'ve stopped getting changed.',
    },
    cracked: {
      answer: 'Ping. Ping. Ping. I answer them now. I tap the desk. Did you get my messages?',
      winning: 'You saw all of us {n} times. Did it look like we were winning? Be honest.',
    },
  },
  pickups: {
    smug: {
      supermarket: '{n} pickups. This is a military installation, not a supermarket.',
      cleaner: 'You picked {n} things up off my floor. Thank you. The cleaner was one of the first to go.',
    },
    irritated: {
      names: '{n} items stolen from my base. Those have our names on. Some of those names are not using them.',
      stores: '{n} pickups. Stores has reported you to Stores.',
    },
    rattled: {
      gary: '{n} pickups. Leave something. Please. That was Gary\'s inhaler.',
      counted: '{n} items gone. We counted. We have time to count now.',
    },
    cracked: {
      unattended: 'Take it. Take all of it. The floor is yours. The gift shop is unattended.',
      shelf: '{n} things. I\'ve left you a shelf. Your name\'s on it. It says Him.',
    },
  },
  callIns: {
    smug: {
      backup: 'You called for backup {n} times. Against infantry. I\'d be embarrassed.',
      already: 'Calling for help already? We\'d only just started.',
    },
    irritated: {
      plan: '{n} aircraft over my base, and not one has filed a flight plan.',
      sign: 'That is restricted airspace. There\'s a sign. There was a sign.',
    },
    rattled: {
      fair: '{n} strikes from the sky. We only have a ground floor. How is that fair?',
      roof: 'We\'ve asked about a roof. Procurement says eighteen months.',
    },
    cracked: {
      arrested: 'I\'ve had the sky arrested. It won\'t come quietly.',
      wave: '{n} call-ins. I wave at them now. The pilots never wave back.',
    },
  },
  melee: {
    smug: {
      guns: '{n} men killed by hand. You do know about guns? You\'re covered in them.',
      personal: '{n} kills at arm\'s length. I do hope that wasn\'t personal.',
    },
    irritated: {
      touching: '{n} melee kills. Stop touching my staff.',
      workplace: '{n} men at arm\'s length. HR has asked me to remind you this is a workplace.',
    },
    rattled: {
      nicely: '{n} men, by hand. Please stay back. They\'ve asked me to say it nicely. Please stay back.',
      smell: 'They say they can smell you before they die. Do you know what you smell of? It\'s bothering them.',
    },
    cracked: {
      come: 'Come here, then. Come and do me. I\'ve been working out. I haven\'t. Come here.',
      hands: '{n}. With your hands. I looked at my hands today. For about an hour.',
    },
  },
  speed: {
    smug: {
      chased: 'You do run about a lot. Is somebody chasing you? We are, but at a sensible pace.',
      hurry: 'Always in a hurry. Nobody gets through this base any faster than the post does.',
    },
    irritated: {
      signs: 'No running in the corridors. There are signs. We put up signs.',
      blur: 'My men describe you as "a blur, then some noise". That is not a contact report.',
    },
    rattled: {
      knees: 'We can\'t keep up. We do three and a half metres a second. In kit. On these knees.',
      where: 'Where are you? Don\'t answer that. Please don\'t answer that.',
    },
    cracked: {
      stop: 'Stop moving. Stop moving. Stop moving. I\'ve got the men saying it too.',
      slowly: 'I saw you go past. I\'ve been waving for some time. Slowly. It\'s all slow now.',
    },
  },
  highGround: {
    smug: {
      railing: 'Enjoying the catwalks? Mind the railing. We never finished the railing.',
      view: 'Nice view from up there. You\'ll have seen the car park. That\'s mine.',
    },
    irritated: {
      ticket: 'Those catwalks are for authorised maintenance staff. Do you have a hard hat? Do you have a ticket?',
      request: 'Come down from there. This is not a request. It\'s somewhat of a request.',
    },
    rattled: {
      looking: 'You look down at us from up there. We can feel it. Stop looking at Dennis.',
      pigeons: 'Up on the catwalks, like a pigeon. A pigeon that kills. We can\'t get the nets.',
    },
    cracked: {
      bird: 'It\'s a bird. It\'s up there. I\'ve told the men it\'s a bird.',
      fall: 'Jump. Go on. See if I care. I\'d care. Jump.',
    },
  },
  room: {
    smug: {
      post: 'You spent most of that round in {room}. Should we forward your post?',
      nice: '{room} is nice, isn\'t it? We were going to put a pool table in there.',
    },
    irritated: {
      utilities: 'You\'ve been in {room} so long we\'ve started billing you for the utilities.',
      cleaned: 'Nobody has been able to clean {room} since you moved in.',
    },
    rattled: {
      things: 'Please leave {room}. People left things in {room}. Sentimental things.',
    },
    cracked: {
      map: '{room}. {room}. {room}. It\'s on every map I draw now.',
    },
  },
  accuracy: {
    smug: {
      littered: '{n} rounds. We\'re not being shot at, we\'re being littered at.',
      instructor: '{n} rounds for that many men. Whoever trained you should be exterminated. By you, ideally. At close range.',
    },
    irritated: {
      wall: '{n} rounds fired. Most of them hit my wall. I liked that wall.',
      recycling: '{n} spent cases on my floor. There\'s a recycling scheme.',
    },
    rattled: {
      shop: '{n} rounds. You just don\'t stop. Who\'s supplying you? Is there a shop? We have a shop.',
    },
    cracked: {
      casings: '{n} rounds. I\'ve been collecting the casings. I\'m building something. Don\'t worry about it.',
    },
  },
  range: {
    smug: {
      inside: 'Your longest kill was {n} metres. You could come inside, you know. We\'d put the kettle on.',
      shy: '{n} metres. That\'s very far away, for something so confident.',
    },
    irritated: {
      postcode: '{n} metres. He was in a different postcode. He was on his break.',
      ranges: 'We have a firing range. It\'s {n} metres. You\'ve been using it from the wrong end.',
    },
    rattled: {
      where: '{n} metres. They didn\'t even hear it. They just fell over mid-sentence.',
    },
    cracked: {
      telescope: '{n} metres. I\'ve bought a telescope. I look at you, and you look at me.',
    },
  },
  quick: {
    smug: {
      manual: 'That was quick. Those men were new. We\'ll send some who\'ve read the manual.',
    },
    irritated: {
      months: '{n} seconds. Training that squad took nine months.',
    },
    rattled: {
      sandwich: '{n} seconds. I\'d just sat down. I hadn\'t even opened my sandwich.',
    },
    cracked: {
      clock: '{n} seconds. I\'ve stopped the clock in my office. I\'d like the time back.',
    },
  },
  slow: {
    smug: {
      party: 'Took your time there. {n} seconds. We assumed you\'d gone home. We had a small party.',
    },
    irritated: {
      overtime: '{n} seconds. Some of those men were on overtime.',
    },
    rattled: {
      tired: '{n} seconds of that. You must be tired. We\'re very tired. Shall we all stop?',
    },
    cracked: {
      dennis: '{n} seconds. That\'s the longest Dennis has ever been alive. Well done, Dennis.',
    },
  },
  fallen: {
    smug: {
      roster: 'You killed {name}. We have more. That\'s what the second page of the roster is for.',
      leave: '{name} is dead. Regrettable. I\'d signed off his leave for Tuesday. It\'ll be a long leave.',
    },
    irritated: {
      tea: 'You killed {name}. He still owes the tea fund six pounds. That\'s on you now.',
      fills: '{name} is dead. Do you know who usually fills in the form for that? {name}.',
    },
    rattled: {
      boat: '{name} had a wife and a boat. Nobody knows how to sail the boat.',
      generator: 'You killed {name}. He was the last one who knew how the generator works.',
    },
    cracked: {
      rota: '{name} is still on the rota. I\'ve left him on. I\'m going to keep calling his name.',
      chess: '{name} taught me chess. He let me win. You didn\'t have to do that. He was letting me win.',
    },
  },
  gift: {
    smug: {
      planned: '{n} of our own, under our own shells. That was planned. You may quote me. Don\'t quote me.',
      thinning: '{n} friendly casualties. We call that thinning the herd. We don\'t call it that to the herd.',
    },
    irritated: {
      score: '{n} of my men, killed by my own fire, and I\'m told that counts towards your score. Unbelievable.',
      who: 'Who authorised that fire mission? I did. Oh. Well. {n} men. Right.',
    },
    rattled: {
      families: '{n} friendly casualties. I\'ve written to their families. I\'ve written to yours. I don\'t know why.',
    },
    cracked: {
      house: 'You\'re welcome. {n} men. That one\'s on the house. It\'s all on the house. There is no house.',
    },
  },
  generic: {
    smug: {
      first: 'You\'ve met our first team. They\'re the ones we could spare.',
      pests: 'We\'ve handled pests before. There was a rat in Hangar Six. It took eleven weeks, but we got it.',
      chair: 'Take your time. I have a chair, and a very good view of your mistakes.',
      ministry: 'I\'ve fought insurgents, floods and the Ministry of Defence. You\'re an infestation with a budget.',
      morning: 'Competent. We\'ll have someone look at it in the morning. Do carry on dying whenever you\'re ready.',
    },
    irritated: {
      shotsign: 'This is a restricted area. There is a sign. You shot the sign.',
      rifle: 'Do you know what a rifle costs? Do you? Neither did I, until Thursday.',
      course: 'We are learning, you know. Through you killing us. It\'s an expensive course.',
      minutes: 'The minutes of this morning\'s meeting read, in full: "No."',
      whiteboard: 'I have a whiteboard with your name on it. We don\'t know your name. It says Him.',
      catering: 'Catering has stopped. Not because of you. Well. Because of you.',
    },
    rattled: {
      giftshop: 'Please. We have families. We have a gift shop.',
      rate: 'Could we talk? Just you and me. I can do you a good rate on the east wing.',
      mugs: 'Is it mugs? Do you want mugs? They say "I Survived The Outpost". We\'ll have to reprint them.',
      match: 'Who\'s paying you? We can match it. We can match about forty percent of it.',
      pension: 'I have fourteen months to my pension. Thirteen. Twelve. I\'m counting the wrong way, aren\'t I?',
      armoury: 'Dennis has locked himself in the armoury. We\'ve asked him to pass the rifles out first.',
    },
    cracked: {
      desk: 'I\'ve moved my desk into the corridor. It\'s safer. There\'s no reason for that. It just feels safer.',
      everything: 'Everything in the gift shop is half price. Everything must go. Everything\'s going.',
      singing: 'The men have started singing. There aren\'t any men. I\'ve started singing.',
      incident: 'Days since last incident: zero. I\'ve nailed the sign to the zero.',
      want: 'What do you want? No, seriously. Nobody\'s asked. What do you actually want?',
    },
  },
};

// -------------------------------------------------------------------------------------------------
// Gloating: the player walked into something the Commander put there
// -------------------------------------------------------------------------------------------------

const GLOATS: Record<TrapCause, Record<Tone, string>> = {
  mortar: {
    smug: 'That was a mortar. They\'re the ones that come from above. We did send a note.',
    irritated: 'You stood in red smoke. I don\'t know how we could have made that clearer.',
    rattled: 'We hit you! With the mortar! Did you see? I want it noted that we hit you!',
    cracked: 'The mortar\'s name is Margaret. She says hello. She says a lot of things. She\'s a mortar.',
  },
  mine: {
    smug: 'You found one of our mines. With your foot. That\'s the traditional method.',
    irritated: 'It was blinking. It has a light on it so that people like you will look down.',
    rattled: 'It worked! The mine worked! Somebody tell Clive! Somebody tell Clive\'s widow!',
    cracked: 'Boom. I say it when I\'m alone. Boom.',
  },
  tripwire: {
    smug: 'That thin red line in the doorway was a tripwire. I\'m told you have eyes.',
    irritated: 'You walked through a glowing wire. You are meant to be an apex predator.',
    rattled: 'The wire got you. A bit of wire! Eleven thousand men, and it was a bit of wire.',
    cracked: 'It\'s all wire, you know. I\'ve wired my office. I\'ve wired my chair. Do sit down.',
  },
  claymore: {
    smug: 'The side that says Front Toward Enemy was facing you. As advertised.',
    irritated: 'Those come with instructions. We read them. You might try it.',
    rattled: 'Seven hundred steel balls and you\'re still walking? What do we pay for those?',
    cracked: 'Front Toward Enemy. I\'ve written it on my door. I don\'t know which way I\'m facing.',
  },
  snare: {
    smug: 'Nice trip? We call that one the Cable. We are not a creative people.',
    irritated: 'You have destroyed a battalion. You have just been tripped up by a cable.',
    rattled: 'You fell over! They saw you fall over! That\'s the best news we\'ve had since the siege!',
    cracked: 'Walk. That\'s all I ask. There\'s a sign. Walk.',
  },
  rigged: {
    smug: 'You do pick things up without looking, don\'t you? So do raccoons.',
    irritated: 'It was ticking. It was next to a health pack and it was ticking. What did you think that was?',
    rattled: 'You touched it! It was wired and you touched it! We have something that works!',
    cracked: 'Everything is wired now. The kettle is wired. Don\'t ask how I know about the kettle.',
  },
  deadman: {
    smug: 'A dead man\'s thumb. Even now, he outranks you.',
    irritated: 'He held on to the very end. That\'s more than I can say for Catering.',
    rattled: 'He said he\'d take you with him. He didn\'t. But he got some of you. That\'s a start.',
    cracked: 'We\'re all holding the button now. Nobody let go. That\'s it. Nobody let go.',
  },
  sniper: {
    smug: 'You didn\'t see Sergeant Hale. That\'s the service he provides.',
    irritated: 'There was a laser pointing at your chest. You were warned by a laser.',
    rattled: 'He hit you! From up there! His hands were shaking and he hit you!',
    cracked: 'He says he sees you when he closes his eyes. So we don\'t let him close his eyes. It\'s working.',
  },
  falseSurrender: {
    smug: 'Hands up, pin out. You\'d be amazed what fits in a surrender.',
    irritated: 'You taught us that one. You\'ll remember shooting the last lot.',
    rattled: 'He had his hands up! That\'s your fault! You taught him that!',
    cracked: 'Everybody\'s surrendering! Everybody! Come closer and accept it!',
  },
  manpads: {
    smug: 'Your aircraft had a brief and unsuccessful career.',
    irritated: 'That was a very expensive plane, I assume. We have no idea who makes them.',
    rattled: 'We hit the plane! A man with a tube! We\'ve never hit anything in the sky!',
    cracked: 'The sky has been arrested. I told you. It came quietly.',
  },
};

// -------------------------------------------------------------------------------------------------
// Announcements: the answer for the next wave, in his own words, and then as an order
// -------------------------------------------------------------------------------------------------

interface Answer {
  /** While he still thinks it will work. */
  early: string;
  /** Once he is hoping it will. */
  late: string;
  /** The order the player intercepts: what was noticed, what changes, and the one thing the men have been told to protect. */
  order: string;
}

const ANSWERS: Record<AdaptationId, Answer> = {
  mortars: {
    early: 'Stand still all you like. I\'ve brought something that prefers it.',
    late: 'Stand still, please. Keep standing still. Someone\'s adjusting the range.',
    order: 'Subject holds one position for long periods. Mortar team to the far gate. Spotter to get eyes on and mark with red smoke. Tubes are blind without him: protect the spotter.',
  },
  snipers: {
    early: 'You like a quiet corner. So does Sergeant Hale. He\'s found a better one, behind you.',
    late: 'I\'ve put Hale up top. He says he can see you. He says it a lot. He won\'t stop saying it.',
    order: 'Subject settles and does not check behind. Marksman to take a high perch at its back. Reposition if it moves.',
  },
  jammers: {
    early: 'Your little ping is very clever. We\'ve bought a man with a long aerial.',
    late: 'Ping away. We have a man with an aerial. He\'s all we have. Please don\'t kill him.',
    order: 'Subject relies on helmet sonar. Jamming team to a back room. Pack shows on its scope while live, so keep him out of reach. If he goes down, the sonar comes back.',
  },
  decoys: {
    early: 'Keep counting blips. Some of them are real. I won\'t say which. It\'s more fun.',
    late: 'There are men in that room. Or a box. We\'ve run out of men, so it\'s a box.',
    order: 'Subject trusts the scope. Decoy beacons in three rooms. They show as men and they do not move. Do not stand near them.',
  },
  hiders: {
    early: 'We\'ve wrapped some of the lads in foil. It\'s a very quiet room, that one.',
    late: 'We\'ve wrapped the last of them in foil. They\'re fine. They\'re cold. They\'re in there somewhere.',
    order: 'Subject pings before it enters. Ambush team under foil beside its usual door. Stay still, hold fire until it is inside seven metres. Foil does not work at close range.',
  },
  mines: {
    early: 'We\'ve been studying your commute. It\'s mined now.',
    late: 'There are mines in everything now. Mind how you go.',
    order: 'Subject uses the same doors. Mines on its busiest routes. Each blinks and clicks. Fuse is half a second, so it will clear them at a run. Lay them anyway.',
  },
  tripwires: {
    early: 'You do love a doorway. We\'ve run a bit of wire across yours. Mind your ankles.',
    late: 'Wire on every door you like. I tied them myself. I\'m good at knots now.',
    order: 'Wire across its busiest doors, shin height, post each side. It can jump them. It has not looked down yet.',
  },
  riggedPickups: {
    early: 'Help yourself to the health packs. We\'ve made some improvements.',
    late: 'Go on. Pick it up. It\'s free. It\'s all free. Pick it up.',
    order: 'Subject collects everything it sees. Charges beside its pickups, triggered on lift. Half a second on the fuse. A clean shot sets them off early.',
  },
  baitPickups: {
    early: 'We\'ve left something nice out for you. No reason. We\'re just generous.',
    late: 'There\'s a present by the door. It has your name on. It has quite a lot of laser on it too.',
    order: 'Subject cannot leave a prize alone. Mega health at the door it favours, two rifles on it from either side. Hold fire until it is in the open.',
  },
  spread: {
    early: 'You like explosives. So we\'ve stopped standing next to each other. It\'s called learning.',
    late: 'Nobody stand near anybody. That\'s the order. That\'s also how the canteen\'s been for weeks.',
    order: 'Subject favours blast weapons. All squads open out to five metres. No stacking on doors. One round, one man.',
  },
  shotguns: {
    early: 'You like it up close. I\'ve found some men who like it too. They have shotguns.',
    late: 'If you\'re not holding a shotgun, back away. That\'s the whole plan. That\'s all I have.',
    order: 'Subject closes to arm\'s length. Riflemen fall back and do not let it inside seven metres. Shotguns go in pairs. It cannot do this from range.',
  },
  claymores: {
    early: 'You keep running at us. I\'ve put something out that runs back.',
    late: 'There\'s something behind the door. It says Front Toward Enemy. We\'ve pointed it at you. Mostly.',
    order: 'Claymores behind its usual doors, facing the frame. Laser fan shows at close range. Harmless from behind. Do not walk in front of them.',
  },
  crossfire: {
    early: 'You\'re very quick. You still have to use the exits. We\'ve had a look at the exits.',
    late: 'You can\'t outrun a door. Every rifle we have left is on that door.',
    order: 'Subject outruns aimed fire. Two rifles to pre-aim its usual exit from either side, lasers on. Fire on the door, not on the target.',
  },
  snares: {
    early: 'You go so fast. It would be a pity if you met a cable.',
    late: 'There\'s a cable across the door. It\'s all we had. It\'s doing very well.',
    order: 'Cable at shin height on its fastest route. Stops it dead at a run. At a walk it only rings the alarm.',
  },
  smoke: {
    early: 'Enjoy the view from up there. We\'re going to do something about the view.',
    late: 'You\'ll get no view today. Smoke. We\'ve burned everything else.',
    order: 'Subject fights from the catwalks. Smoke at the foot of the deck, flanks from below, marksman on the deck line. Smoke will not stop its sonar.',
  },
  manpads: {
    early: 'Your friends in the sky have been noticed. One of my men has a tube, and a grudge.',
    late: 'That\'s it, call your plane. Bring it lower. He\'s been waiting all week.',
    order: 'Subject calls in aircraft. Anti-air team deployed. Three seconds from lock to launch. If the tube goes down, nothing launches.',
  },
  radioJammer: {
    early: 'Try your radio now. I\'ve had the line disconnected. There\'s a man sat on the switch.',
    late: 'Call for help. Go on. We have a man on the mast. Nobody\'s coming. For either of us.',
    order: 'Uplink jammer to a back room. Everything it calls in waits until he is dead. Keep him alive and it has no air.',
  },
  helmets: {
    early: 'We\'ve issued better hats. Try the head now.',
    late: 'We have visors. We have two helmets each. We\'ve taped them on. Try it now.',
    order: 'Subject aims for the head. New squads issued with heavy helmets and visors. Good for about three hits. Body armour unchanged.',
  },
  noSurrender: {
    early: 'Nobody\'s putting their hands up for you any more. That was your last freebie.',
    late: 'There\'s no more surrender. There\'s no point. You\'ve made that very clear.',
    order: 'Subject executes prisoners. Standing order withdrawn: no man is to surrender. Break and run for the gates.',
  },
  falseSurrender: {
    early: 'The next man to surrender to you will be holding a grenade. I thought you should know. It won\'t help.',
    late: 'Hands up, lads. Hands up and pin out. Walk towards it. God forgive me.',
    order: 'Subject walks up to prisoners. Broken men to raise their hands and keep the grenade. Keep your rifle on your back. Pull at six metres.',
  },
  riggedCasualties: {
    early: 'You do enjoy it when we come back for our wounded. So we\'ve improved the wounded.',
    late: 'He\'s screaming because I told him to. The vest is because you made me.',
    order: 'Subject shoots rescuers. Casualty wired and left on its route, screaming. Vest goes when it closes, or if it is shot. Nobody goes near him.',
  },
  radioSilence: {
    early: 'You\'ve been reading our mail. That\'s over. Nobody says a word from now on.',
    late: 'Not a word on the radio. Not one. Nobody has anything nice to say anyway.',
    order: 'Subject tracks our voice traffic. Full radio silence from next wave. Hand signals only. No exceptions for screaming.',
  },
  falseChatter: {
    early: 'You do listen to the radio, don\'t you? Good. Keep listening. Someone\'s in trouble in there.',
    late: 'A man\'s calling for help on channel two. You should go and see. You love to help.',
    order: 'Subject walks towards voices. False distress calls from a wired room. Use callsign seven: nobody real has one.',
  },
};

/** The owner's line, for when the box has just been talking about that door. */
const MINES_IN_THE_DOOR = 'There are mines in it now.';

const TRICK_LINES: Record<TrickId, { say: string; order: string }> = {
  playDead: {
    say: 'Do check your corpses. Some of the dead are only resting.',
    order: 'Two men to lie among the dead on its route. Wait until it passes. Fire into the back. The scope still shows them, so stay down.',
  },
  riggedCorpses: {
    say: 'We can\'t bury them any more, so we\'ve given them something to do.',
    order: 'Charges on last round\'s bodies, where it fought. Each one blinks. Apologise to the families.',
  },
  sacrifice: {
    say: 'I\'ve told a squad to stand in the open. They know why. They\'ve been very good about it.',
    order: 'One squad to hold open ground in full view. When it closes, the tubes fire on their position. They have been told. Spotter or no spotter.',
  },
  dangerClose: {
    say: 'If you get in among my men, I\'ll shell them. All of them. I\'ve signed the form. I\'ve signed it twice.',
    order: 'Authority given: any man with the subject on top of him may call fire on his own position. Pop red smoke. Tell your families.',
  },
  deadMan: {
    say: 'Some of the lads are carrying something in their fist. Do kill them. I insist.',
    order: 'One man in three carries a dead man\'s switch. A second and a half after the thumb comes off. Six metres is safe. Do not tell it that.',
  },
  riggedRooms: {
    say: 'We\'ve wired the building. We started with the rooms you like best.',
    order: 'Its favourite room is wired. Klaxon on entry, three seconds. It will hear it. Most of it will not get out.',
  },
  barricades: {
    say: 'I\'ve had some of your doors taken away. Steel. There\'s a form for that. It\'s on the other side.',
    order: 'Shutter on the door it uses most. Explosives will take it down in two. Every room still has another way out. It does not know that yet.',
  },
};

// -------------------------------------------------------------------------------------------------
// The Council
// -------------------------------------------------------------------------------------------------

/** By how the Commander sounded, because the joke is that the reply takes no notice of it. */
const COUNCIL: Record<Tone, Keyed> = {
  smug: {
    extinctions: 'Your appeal has been received. Processing time is 6-8 extinctions.',
    collection: 'Extermination takes place Monday to Sunday. Please have your civilisation out for collection.',
    road: 'The extermination in your area is now in progress. Please keep your species off the road.',
    permit: 'The contractor is reminded to display their permit somewhere visible. The wreckage will do.',
    queue: 'Thank you for your patience. You are number 4,112 in the queue for mercy.',
    validated: 'Your extinction has been validated for four hours.',
    casenumber: 'Commander, you have been assigned a case number. Please do not contact us.',
    survey: 'A survey of your settlement found it to be in breach of being a settlement.',
  },
  irritated: {
    box: 'Form 7742-C does not have a box for "No". Please do not draw one.',
    outrage: 'Correspondence containing the word "outrage" will be returned unread.',
    person: 'Appeals must be lodged in person. Our offices are in another galaxy. We close at four.',
    fire: 'Your letter was unsigned. Your letter was also on fire.',
    stamped: 'Please enclose a stamped addressed planet.',
    tone: 'The Council does not respond to tone.',
    capitals: 'Complaints written entirely in capitals are filed under Weather.',
    amended: 'Your complaint has been amended to read "Thank you". No further action is required.',
  },
  rattled: {
    bribes: 'Bribes must be submitted in triplicate to the Bribes Office, which has been exterminated.',
    mugs: 'The Council has reviewed your offer of mugs. The offer is noted. The mugs have been destroyed.',
    partial: 'Partial extermination is not a service we offer.',
    families: '"Families" is not a recognised exemption. See also: "children", "please".',
    hold: 'Your call is important to us. You are no longer important to us. Please hold.',
    rebate: 'You may be eligible for a 5% discount on your own extinction. Terms apply. Terms are extinction.',
    pension: 'Pensions will be honoured in full for all surviving recipients.',
    giftvoucher: 'Gift vouchers cannot be exchanged for continued existence.',
  },
  cracked: {
    leaflet: 'The Council notes you have stopped using full sentences. A leaflet is on its way.',
    heritage: 'The gift shop is not a protected heritage site.',
    thursday: 'We are sorry for your loss. Your loss is scheduled for Thursday.',
    rating: 'How did we do? Please rate your extermination from 1 to 5. There will be no survivors to thank.',
    singing: 'Please stop singing on the emergency channel.',
    sky: 'The Council cannot process the arrest of the sky.',
    margaret: 'Your mortar is not a dependant.',
    closing: 'This office will close when you do.',
  },
};

/** When the round gave the Council something to file. */
const COUNCIL_TOPICS: Partial<Record<Topic, string>> = {
  executions: 'The Geneva Suggestion remains advisory.',
  limbs: 'Limbs left in the zone are left at the owner\'s risk.',
  gift: 'Self-extermination is eligible for a small rebate.',
  door: 'The contractor\'s doorway has been registered as a fixed place of business.',
  sonar: 'Sonar use in an extinction zone is permitted until 11pm.',
  pickups: 'Items removed from the site remain the property of nobody, shortly.',
  camp: 'The contractor is reminded that loitering is only an offence for the locals.',
  callIns: 'Aircraft above the site are authorised. Aircraft below the site are your problem.',
  highGround: 'The contractor is not required to wear a hard hat.',
  fallen: 'The Council extends its condolences to the next of kin, whom it will be seeing shortly.',
};

// -------------------------------------------------------------------------------------------------
// The end of a run
// -------------------------------------------------------------------------------------------------

const FIRST_WORDS: Keyed = {
  welcome: 'This is the Commander of the Outpost. You are trespassing. Leave your weapons at the gate and wipe your feet.',
  notice: 'I have received your notice of extermination. I have used it to level a table.',
  visitor: 'All visitors must sign in. My men will bring you the book.',
};

const LAST_STAND: Keyed = {
  suit: 'Stay right there. I\'ve found the key to the big suit.',
  coming: 'I\'m coming down. I want that noted. I am coming down there myself.',
  everyone: 'That\'s everyone. That\'s everyone I have. It\'s only me now, and the gift shop.',
};

const IN_PERSON_LINES: Keyed = {
  arrive: 'Right. Stay where you are. I\'ve read the manual for this thing. Most of it.',
  loud: 'It\'s very loud in here. Is this what it\'s like? It\'s very loud.',
  paint: 'You\'ve scratched the paintwork! This is signed out in my name!',
  callIt: 'Fire on me! Yes! I know where I\'m standing!',
  pension: 'Fourteen months! Did I mention? Fourteen months to my pension!',
  refunds: 'There are no refunds at the gift shop! There are no refunds!',
  please: 'Please. We have a gift shop.',
};

const DEAD: Keyed = {
  form: 'Tell the Council. Somebody should have to read the form.',
  margaret: 'Margaret. Tell Margaret I left the mortar on.',
};

const COUNCIL_FINAL: Keyed = {
  fulfilled: 'Contract 7742-C is fulfilled. Please leave the site as you found it. Absent.',
  invoice: 'Thank you for choosing extermination. The gift shop has been added to your invoice.',
};

/** The box after the player dies. He is allowed this. */
const PLAYER_DEAD: Keyed = {
  file: 'Mark that one closed. Someone tell the gift shop. We\'re open.',
};

// -------------------------------------------------------------------------------------------------
// The radio: heard on the comms feed, by the men, mid-wave
// -------------------------------------------------------------------------------------------------

/** What he tells a squad to do, mid-fight, on the open channel. The first word is always who it is for. Keyed by drill, so that orders.ts can find them. */
const ORDERS: Readonly<Record<OrderDrill, Keyed>> = {
  flank: {
    round: '{squad}, go round it. I want it looking the wrong way.',
    side: '{squad}. It is watching the front. Take the side.',
    wide: '{squad}, wide and quiet. Come up behind it.',
  },
  frag: {
    move: '{squad}, it has stopped moving. Give it a reason.',
    out: '{squad}, grenades. Get it out of there.',
  },
  flash: {
    bang: '{squad}, bang it and go in behind the bang.',
    eyes: '{squad}. Take its eyes, then take the rest.',
  },
  cutOff: {
    ahead: '{squad}, it is running. Be there first.',
    exit: '{squad}, it has one way out of that. Close it.',
  },
  rush: {
    now: '{squad}, it is hurt and it is alone. All of you. Now.',
    close: '{squad}, stop being polite. Close it down.',
  },
  baseOfFire: {
    pin: '{squad}, keep it pinned. Nobody lifts a finger off that trigger.',
    lane: '{squad}, own that lane. If it moves, it moves into you.',
  },
};

const RADIO: Keyed = {
  'radio.spotter.eyes.a': 'Spotter has eyes on. Lasing.',
  'radio.spotter.eyes.b': 'Target painted. Hold it there.',
  'radio.spotter.eyes.c': 'I have it. Stand by the tubes.',
  'radio.spotter.fire.a': 'Fire mission, fire mission!',
  'radio.spotter.fire.b': 'Rounds out! Smoke on target!',
  'radio.spotter.fire.c': 'Shot, over. Get clear of the red!',
  'radio.mortar.tubeLost.a': 'Tube\'s gone! We\'re out of it!',
  'radio.mortar.tubeLost.b': 'Mortar\'s down! No more fire support!',
  'radio.posts.abandon.a': 'All posts, all posts. There\'s nobody left. Go and find it.',
  'radio.posts.abandon.b': 'Leave your posts. Everyone. That\'s an order.',
  'radio.ambush.spring.a': 'Now! Now! Now!',
  'radio.ambush.spring.b': 'Foil off! Light it up!',
  'radio.bait.hold.a': 'Holding here. Just like he said.',
  'radio.bait.hold.b': 'We\'re in position. In the open. As ordered.',
  'radio.bait.sprung.a': 'It\'s coming. Tell my wife.',
  'radio.bait.sprung.b': 'Danger close, on us. Do it.',
  'radio.possum.rise.a': 'Got you.',
  'radio.possum.rise.b': 'Surprise.',
  'radio.barricade.down.a': 'Shutter down. That door\'s gone.',
  'radio.barricade.down.b': 'Door sealed. Let it find another way.',
  'radio.room.armed.a': '{room} is live. Three seconds.',
  'radio.room.armed.b': 'It\'s in {room}! Blow it!',
  'radio.smoke.out.a': 'Smoke out!',
  'radio.smoke.out.b': 'Popping smoke on the deck!',
  'radio.manpads.lock.a': 'Tone. I have tone.',
  'radio.manpads.lock.b': 'Aircraft! Locked on!',
  'radio.manpads.hit.a': 'Splash one!',
  'radio.manpads.hit.b': 'Hit! It\'s breaking off!',
  'radio.manpads.miss.a': 'Missile away. No hit.',
  'radio.dangerClose.a': 'It\'s on top of us! Danger close!',
  'radio.dangerClose.b': 'Fire on my position! Do it!',
  'radio.dangerClose.c': 'Red smoke, on me! Bring it down!',
};

/** Lies. `{room}` is a wired room, and the callsign the code gives them has a seat no squad has. */
const CHATTER: Keyed = {
  'chatter.pinned': 'I\'m hit, I\'m in {room}, I can\'t move!',
  'chatter.medic': 'Medic! Medic to {room}! We\'ve got three down!',
  'chatter.ammo': 'Ammo cache in {room} is unguarded, repeat, unguarded.',
  'chatter.prisoner': 'We have the Commander pinned in {room}. He\'s alone.',
  'chatter.gone': 'Nobody\'s covering {room}. I say again, nobody in {room}.',
  'chatter.help': 'Is anyone there? I\'m in {room}. Please. Anyone.',
};

// -------------------------------------------------------------------------------------------------
// Everything above, as lines
// -------------------------------------------------------------------------------------------------

function table(prefix: string, speaker: Speaker, emotion: Emotion, keyed: Keyed): Line[] {
  return Object.keys(keyed).map(key => ({ id: `${prefix}.${key}`, speaker, emotion, text: keyed[key]! }));
}

const reactionTable = (): Line[] => {
  const out: Line[] = [];
  for (const topic of Object.keys(REACTIONS) as Topic[]) {
    for (const tone of Object.keys(REACTIONS[topic]) as Tone[]) out.push(...table(`cmd.${topic}.${tone}`, 'commander', tone, REACTIONS[topic][tone]));
  }
  return out;
};

const gloatTable = (): Line[] => {
  const out: Line[] = [];
  for (const cause of Object.keys(GLOATS) as TrapCause[]) {
    for (const tone of Object.keys(GLOATS[cause]) as Tone[]) out.push({ id: `cmd.gloat.${cause}.${tone}`, speaker: 'commander', emotion: tone, text: GLOATS[cause][tone] });
  }
  return out;
};

const answerTable = (): Line[] => {
  const out: Line[] = [];
  for (const a of ADAPTATIONS) {
    const row = ANSWERS[a.id];
    out.push(
      { id: `cmd.answer.${a.id}.early`, speaker: 'commander', emotion: 'smug', text: row.early },
      { id: `cmd.answer.${a.id}.late`, speaker: 'commander', emotion: 'rattled', text: row.late },
      { id: `intercept.${a.id}`, speaker: 'intercept', emotion: 'orders', text: row.order },
    );
  }
  out.push({ id: 'cmd.answer.mines.door', speaker: 'commander', emotion: 'smug', text: MINES_IN_THE_DOOR });
  for (const t of TRICKS) {
    const row = TRICK_LINES[t.id];
    out.push(
      { id: `cmd.trick.${t.id}`, speaker: 'commander', emotion: 'rattled', text: row.say },
      { id: `intercept.trick.${t.id}`, speaker: 'intercept', emotion: 'orders', text: row.order },
    );
  }
  return out;
};

const councilTable = (): Line[] => {
  const out: Line[] = [];
  for (const tone of Object.keys(COUNCIL) as Tone[]) out.push(...table(`council.${tone}`, 'council', 'deadpan', COUNCIL[tone]));
  for (const topic of Object.keys(COUNCIL_TOPICS) as Topic[]) out.push({ id: `council.topic.${topic}`, speaker: 'council', emotion: 'deadpan', text: COUNCIL_TOPICS[topic]! });
  out.push(...table('council.final', 'council', 'deadpan', COUNCIL_FINAL));
  return out;
};

const radioTable = (): Line[] => [
  ...Object.keys(RADIO).map(id => ({ id, speaker: 'radio' as const, emotion: 'urgent' as const, text: RADIO[id]! })),
  ...Object.keys(CHATTER).map(id => ({ id, speaker: 'radio' as const, emotion: 'urgent' as const, text: CHATTER[id]! })),
];

/** The whole script. */
export const LINES: readonly Line[] = [
  ...reactionTable(),
  ...gloatTable(),
  ...answerTable(),
  ...councilTable(),
  ...table('cmd.first', 'commander', 'smug', FIRST_WORDS),
  ...table('cmd.lastStand', 'commander', 'cracked', LAST_STAND),
  ...table('cmd.person', 'commander', 'cracked', IN_PERSON_LINES),
  ...table('cmd.dead', 'commander', 'cracked', DEAD),
  ...table('cmd.playerDead', 'commander', 'smug', PLAYER_DEAD),
  ...(Object.keys(ORDERS) as OrderDrill[]).flatMap(drill => table(`cmd.order.${drill}`, 'commander', 'smug', ORDERS[drill])),
  ...radioTable(),
];

const BY_ID = new Map(LINES.map(l => [l.id, l]));
export const lineById = (id: string): Line | undefined => BY_ID.get(id);

const lines = (prefix: string): Line[] => LINES.filter(l => l.id.startsWith(prefix));

/** One line for a family such as `radio.spotter.eyes`, varied so a voice does not repeat itself. */
export function radioLine(family: string): Line | null {
  const list = lines(`${family}.`);
  return list.length > 0 ? list[Math.floor(Math.random() * list.length)]! : null;
}

/** One way of telling a squad to do this. */
export const orderLine = (drill: OrderDrill): Line => {
  const list = lines(`cmd.order.${drill}.`);
  return list[Math.floor(Math.random() * list.length)]!;
};

export const reactions = (topic: Topic, tone: Tone): Line[] => lines(`cmd.${topic}.${tone}.`);
export const gloat = (cause: TrapCause, tone: Tone): Line | undefined => lineById(`cmd.gloat.${cause}.${tone}`);
export const answer = (id: AdaptationId, late: boolean): Line => lineById(`cmd.answer.${id}.${late ? 'late' : 'early'}`)!;
export const order = (id: AdaptationId): Line => lineById(`intercept.${id}`)!;
export const trickSay = (id: TrickId): Line => lineById(`cmd.trick.${id}`)!;
export const trickOrder = (id: TrickId): Line => lineById(`intercept.trick.${id}`)!;
export const councilFor = (tone: Tone): Line[] => lines(`council.${tone}.`);
export const councilOn = (topic: Topic): Line | undefined => lineById(`council.topic.${topic}`);
export const FIRST: readonly Line[] = lines('cmd.first.');
export const LAST: readonly Line[] = lines('cmd.lastStand.');
export const IN_PERSON: readonly Line[] = lines('cmd.person.');
export const LAST_WORDS: readonly Line[] = lines('cmd.dead.');
export const FINAL_COUNCIL: readonly Line[] = lines('council.final.');
export const PLAYER_DOWN: readonly Line[] = lines('cmd.playerDead.');
export const FALSE_CHATTER: readonly Line[] = lines('chatter.');

// -------------------------------------------------------------------------------------------------
// Slots: what is recorded for each
// -------------------------------------------------------------------------------------------------

/** How a weapon is said, by id. A voice actor needs words, not ids. The last three have words and no takes yet: the box prints them. */
export const WEAPON_WORDS: Readonly<Record<string, string>> = {
  smg: 'SMG', shotgun: 'shotgun', rocket: 'rocket launcher', autocannon: 'autocannon', sword: 'sword', judge: 'Judge', lance: 'Lance', buzzsaw: 'Buzzsaw', kiln: 'Kiln', stakegun: 'Stakegun',
  harrow: 'Harrow', rivet: 'Rivet', sabot: 'Sabot',
  knife: 'knife', crowbar: 'crowbar', shovel: 'shovel', baton: 'baton',
};

/** The word for a weapon. One with no entry yet is said by its name, so a new gun never reaches the box as a raw id. */
export const weaponWord = (id: string): string => WEAPON_WORDS[id] ?? id.charAt(0).toUpperCase() + id.slice(1);

/** The Kill House's spaces, as `world.zones` names them. */
export const ROOM_WORDS: readonly string[] = ['TYRES', 'LANES', 'CRATES', 'STREET', 'SANDBAGS', 'PLYWOOD', 'TILES', 'PLANT', 'COURT', 'RING', 'YARD'];

/** The squads, in the order they are raised. */
export const SQUAD_WORDS: readonly string[] = CALLSIGNS;

/** Squad leaders get these, in turn, so the box can mourn someone. */
export const NAMES: readonly string[] = ['Dennis', 'Okafor', 'Whitlock', 'Marsh', 'Novak', 'Reyes', 'Big Tom', 'Sully'];

/** The numbers each topic gets recorded at, spoken. A real count says the highest of these it has reached. */
const SMALL: readonly (readonly [number, string])[] = [[2, 'two'], [5, 'five'], [10, 'ten'], [20, 'twenty']];
const SHOTS: readonly (readonly [number, string])[] = [[50, 'fifty'], [100, 'a hundred'], [200, 'two hundred'], [500, 'five hundred']];
const SECONDS: readonly (readonly [number, string])[] = [[10, 'ten'], [30, 'thirty'], [60, 'sixty'], [120, 'a hundred and twenty']];
const DAMAGE: readonly (readonly [number, string])[] = [[50, 'fifty'], [100, 'a hundred'], [200, 'two hundred']];

export const COUNT_BANDS: Readonly<Partial<Record<Topic, readonly (readonly [number, string])[]>>> = {
  door: SHOTS, accuracy: SHOTS, range: [[20, 'twenty'], [30, 'thirty'], [40, 'forty'], [60, 'sixty']], camp: SECONDS, quick: SECONDS, slow: [[120, 'a hundred and twenty'], [180, 'a hundred and eighty'], [300, 'three hundred']], hurt: DAMAGE,
  headshots: SMALL, limbs: SMALL, executions: SMALL, sonar: SMALL, pickups: SMALL, callIns: SMALL, melee: SMALL, gift: SMALL,
};

const SLOT = /\{(n|weapon|room|name|squad)\}/g;

/** The different slots in a line. */
export const slotsOf = (text: string): string[] => [...new Set([...text.matchAll(SLOT)].map(m => m[1]!))];

/** True when no small set of takes can cover this line, so it stays as text. */
export const textOnly = (line: Line): boolean => slotsOf(line.text).length > 1;

/** The band a real number falls in: the highest it has reached, or the lowest there is. */
export function bandFor(bands: readonly (readonly [number, string])[], n: number): readonly [number, string] {
  let best = bands[0]!;
  for (const b of bands) if (n >= b[0]) best = b;
  return best;
}

/** Which topic a `cmd.<topic>.<tone>.<key>` line belongs to. */
export const topicOf = (id: string): Topic | null => {
  const [, topic] = id.split('.');
  return topic && topic in REACTIONS ? (topic as Topic) : null;
};
